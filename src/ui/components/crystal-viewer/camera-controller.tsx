'use client'

/** Coordinate orbit input, authored camera flights, framing, and camera tracks. */
import { useRef, useEffect, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsType } from 'three-stdlib'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { useIsMobile } from '../../../ui-kit/use-mobile'
import { isMassiveScene } from '../../../lib/performance/adaptive-performance'
import { evaluateBioCameraTrack } from '../../../lib/biomolecule/camera-track'
import {
  beginCameraManualInteraction,
  createCameraInteractionGuardState,
  endCameraManualInteraction,
  recordCameraManualActivity,
  recordCameraPointerDown,
  recordCameraPointerRelease,
  releaseAllCameraPointers,
  watchdogCameraInteraction,
} from '../../../lib/render/camera-interaction-guard'
import {
  cameraBoundsFromPoints,
  cameraPoseApproximatelyEqual,
  cameraViewClearanceFromBounds,
  cameraViewClearanceFromPoints,
  defaultCameraPoseForBounds,
  defaultCameraPoseForPeriodicCell,
  orthographicZoomForSpan,
  preservedViewCameraPosition,
  resolvedFocusDistance,
} from '../../../lib/render/camera-framing'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const CAMERA_FOCUS_DURATION_MS = 1_200

export function CameraController() {
  const controlsRef = useRef<OrbitControlsType>(null)
  const defaultFitTriggerRef = useRef<{
    camera: THREE.Camera
    projection: 'perspective' | 'orthographic'
    resetVersion: number
    width: number
    height: number
    pose: {
      position: [number, number, number]
      target: [number, number, number]
      zoom?: number
    }
  } | null>(null)
  const massiveSceneVisualFocusDriftStartRef = useRef<number | null>(null)
  const { camera, gl, invalidate, size: canvasSize } = useThree()
  const setEvents = useThree((s) => s.setEvents)
  const isMobile = useIsMobile()

  const {
    atoms,
    periodic,
    cameraTarget,
    isAnimatingCamera,
    setIsAnimatingCamera,
    setCameraTarget,
    abortCameraFlight,
    setInitialCameraPosition,
    setInteractionPerformanceActive,
    latticeVectors,
    supercellParams,
    boxSelectModeEnabled,
    toolMode,
    draggingAtomId,
    massiveSceneVisualFocusCenter,
    massiveSceneVisualFocusDistance,
    clearMassiveSceneVisualFocus,
    cameraAutoResetVersion,
    cameraControlPreset,
    cameraProjection,
    compactStructure,
  } = useCrystalStore()

  // Pointer events are off for the whole flight. Every atom is its own mesh
  // with onPointerOver, so a one-pixel mouse twitch raycasts against all N of
  // them; and with the camera moving, the atom under a *still* cursor changes
  // every frame, so hover enter/leave (state update, rim/outline
  // re-render) fired continuously and fought the animation for frame time.
  // Hover during a flight carries no information anyway. Also release any hover
  // that was live when the flight started, so no atom stays highlighted.
  const setHoveredAtom = useCrystalStore((s) => s.setHoveredAtom)
  useEffect(() => {
    if (!isAnimatingCamera) return
    setEvents({ enabled: false })
    setHoveredAtom(null)
    document.body.style.cursor = 'auto'
    return () => setEvents({ enabled: true })
  }, [isAnimatingCamera, setEvents, setHoveredAtom])

  const mouseButtonsForPreset = (() => {
    switch (cameraControlPreset) {
      case 'maestro':
        return { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY }
      case 'gaussian':
        return { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
      case 'default':
      default:
        return { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    }
  })()

  const animationRef = useRef({
    startTime: 0,
    duration: CAMERA_FOCUS_DURATION_MS,
    startPosition: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endPosition: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    startZoom: 1,
    endZoom: 1,
    animateZoom: false,
  })

  const animatedTargetRef = useRef<typeof cameraTarget | null>(null)

  const massiveSceneMode = isMassiveScene(atoms.length, {
    mobileLike: isMobile,
  })
  const isDragMode = toolMode === 'drag-atom'
  const isAddAtomMode = toolMode === 'add-atom'
  const isCurrentlyDragging = !!draggingAtomId
  const selectionManipActive = useCrystalStore((s) => s.selectionManipActive)
  const cellResizeDragging = useCrystalStore((s) => s.cellResizeDragging)
  const autoRotate = useCrystalStore((s) => s.autoRotate)
  const savedCameraState = useCrystalStore((s) => s.savedCameraState)
  const setSavedCameraState = useCrystalStore((s) => s.setSavedCameraState)
  const presentationPlaying = useCrystalStore((s) => s.presentationPlaying)
  const presentationFrame = useCrystalStore((s) => s.presentationFrame)
  const cameraKeyframes = useCrystalStore((s) => s.cameraKeyframes)
  const pausePresentation = useCrystalStore((s) => s.pausePresentation)
  const cameraTrackInteractionRef = useRef(createCameraInteractionGuardState())
  const cameraTrackAppliedFrameRef = useRef<number | null>(null)

  useEffect(() => {
    if (presentationPlaying) {
      // Explicit Play resumes the recorded track from the current playhead.
      cameraTrackInteractionRef.current = createCameraInteractionGuardState()
      cameraTrackAppliedFrameRef.current = null
    }
  }, [presentationPlaying])

  useEffect(() => {
    // Replacing/removing a key at the current playhead is itself a new camera
    // sample even though the numeric frame did not move.
    cameraTrackAppliedFrameRef.current = null
    invalidate()
  }, [cameraKeyframes, invalidate])

  useEffect(() => {
    const canvas = gl.domElement
    const now = () => performance.now()
    const onPointerDown = (event: PointerEvent) => {
      cameraTrackInteractionRef.current = recordCameraPointerDown(
        cameraTrackInteractionRef.current,
        event.pointerId,
        now(),
      )
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!cameraTrackInteractionRef.current.activePointerIds.includes(event.pointerId)) return
      cameraTrackInteractionRef.current = recordCameraManualActivity(
        cameraTrackInteractionRef.current,
        now(),
      )
    }
    const onPointerRelease = (event: PointerEvent) => {
      const previous = cameraTrackInteractionRef.current
      const next = recordCameraPointerRelease(
        previous,
        event.pointerId,
        now(),
      )
      cameraTrackInteractionRef.current = next
      if (previous.manualActive && !next.manualActive) {
        setInteractionPerformanceActive(false)
      }
    }
    const onWindowDeactivate = () => {
      cameraTrackInteractionRef.current = releaseAllCameraPointers(
        cameraTrackInteractionRef.current,
        now(),
      )
      setInteractionPerformanceActive(false)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') onWindowDeactivate()
    }

    // Capture pointerdown before OrbitControls starts, then observe release at
    // window scope. This remains reliable when the controls component loses
    // pointer capture or never dispatches its `end` event.
    canvas.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerRelease, true)
    window.addEventListener('pointercancel', onPointerRelease, true)
    canvas.addEventListener('lostpointercapture', onPointerRelease, true)
    window.addEventListener('blur', onWindowDeactivate)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', onPointerRelease, true)
      window.removeEventListener('pointercancel', onPointerRelease, true)
      canvas.removeEventListener('lostpointercapture', onPointerRelease, true)
      window.removeEventListener('blur', onWindowDeactivate)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [gl, setInteractionPerformanceActive])

  useEffect(() => {
    // The renderer may stop requesting frames after damping settles, so a
    // useFrame-only watchdog is insufficient in demand mode. Keep this timer
    // independent of rendering; it is normally a no-op and only mutates state
    // when a browser/OrbitControls lifecycle was actually lost.
    const watchdogTimer = window.setInterval(() => {
      const previous = cameraTrackInteractionRef.current
      const next = watchdogCameraInteraction(previous, performance.now())
      if (next === previous) return
      cameraTrackInteractionRef.current = next
      if (previous.manualActive && !next.manualActive) {
        setInteractionPerformanceActive(false)
        invalidate()
      }
    }, 250)
    return () => window.clearInterval(watchdogTimer)
  }, [invalidate, setInteractionPerformanceActive])
  void isAddAtomMode
  const dragModeLock = isDragMode && isCurrentlyDragging
  const shouldLockCamera = dragModeLock || selectionManipActive || cellResizeDragging

  // The ad-hoc modifier rubber band (see SelectionOverlay) lives outside Box
  // Select mode, so orbit has to yield to it. Suppression starts on the modifier
  // key rather than on isBoxSelecting because OrbitControls handles pointerdown
  // before the box is promoted — waiting for the box would let the view spin for
  // the first few pixels of every drag. Tracked locally: a new store field would
  // not survive HMR without a full reload.
  const isBoxSelecting = useCrystalStore((s) => s.isBoxSelecting)
  const translateMode = useCrystalStore((s) => s.translateMode)

  // Ctrl/Meta must NOT suppress orbit: the viewer's own hint advertises
  // "Ctrl + drag to rotate", and a marquee can only start from the explicit
  // box-select tool (`boxSelectModeEnabled`, handled separately below) — never
  // from a bare modifier in plain Select mode. Only Shift is an additive-pick
  // modifier that a drag could confuse with an orbit.
  const [additivePickModifierHeld, setAdditivePickModifierHeld] = useState(false)

  useEffect(() => {
    const sync = (event: KeyboardEvent) => setAdditivePickModifierHeld(event.shiftKey)
    const clear = () => setAdditivePickModifierHeld(false)

    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

  const suppressOrbitForSelection =
    toolMode === 'select' &&
    !translateMode &&
    ((isBoxSelecting && boxSelectModeEnabled) || additivePickModifierHeld)
  // Unlike shouldLockCamera, a stale draggingAtomId must also defer a requested
  // document fit. Keeping this boolean in the fit effect dependencies lets an
  // unconsumed reset retry exactly once on release; ordinary drag release does
  // not refit because its resetVersion was already consumed.
  const cameraFitLocked = isCurrentlyDragging || selectionManipActive || cellResizeDragging

  useEffect(() => {
    // Do not consume a fit trigger while a geometry interaction owns the
    // camera. Because cameraFitLocked is a dependency, release retries a
    // pending reset; without a changed resetVersion, a normal drag release only
    // refreshes the stored Home pose and leaves the live camera untouched.
    if (cameraFitLocked) return
    const pose = compactStructure
      ? defaultCameraPoseForBounds(compactStructure.bbox, canvasSize.width, canvasSize.height)
      : atoms.length === 0
        ? null
        : periodic
          ? defaultCameraPoseForPeriodicCell(
              latticeVectors.a,
              latticeVectors.b,
              latticeVectors.c,
              [supercellParams.nx, supercellParams.ny, supercellParams.nz],
              canvasSize.width,
              canvasSize.height,
            )
          : (() => {
              const bounds = cameraBoundsFromPoints(atoms.map((atom) => atom.cartesian ?? atom.position))
              return bounds ? defaultCameraPoseForBounds(bounds, canvasSize.width, canvasSize.height) : null
            })()
    if (!pose) return

    setInitialCameraPosition(pose.position, pose.target, pose.zoom)
    const previousTrigger = defaultFitTriggerRef.current
    const sameCameraDocument = previousTrigger != null
      && previousTrigger.camera === camera
      && previousTrigger.projection === cameraProjection
      && previousTrigger.resetVersion === cameraAutoResetVersion
    const viewportChanged = previousTrigger != null
      && (previousTrigger.width !== canvasSize.width || previousTrigger.height !== canvasSize.height)
    const livePose = controlsRef.current
      ? {
          position: [camera.position.x, camera.position.y, camera.position.z] as [number, number, number],
          target: [
            controlsRef.current.target.x,
            controlsRef.current.target.y,
            controlsRef.current.target.z,
          ] as [number, number, number],
          ...(camera instanceof THREE.OrthographicCamera ? { zoom: camera.zoom } : {}),
        }
      : null
    const liveWasPreviousDefault = previousTrigger != null
      && livePose != null
      && cameraPoseApproximatelyEqual(livePose, previousTrigger.pose)
    const shouldApplyDefault = !sameCameraDocument
      || (viewportChanged && liveWasPreviousDefault)
    defaultFitTriggerRef.current = {
      camera,
      projection: cameraProjection,
      resetVersion: cameraAutoResetVersion,
      width: canvasSize.width,
      height: canvasSize.height,
      pose: {
        position: pose.position,
        target: pose.target,
        ...(camera instanceof THREE.OrthographicCamera ? { zoom: pose.zoom } : {}),
      },
    }
    if (shouldApplyDefault) {
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      if (camera instanceof THREE.OrthographicCamera) {
        camera.zoom = pose.zoom
        camera.updateProjectionMatrix()
      }
      if (controlsRef.current) {
        controlsRef.current.target.set(...pose.target)
        controlsRef.current.update()
      }
      invalidate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, cameraAutoResetVersion, cameraFitLocked, cameraProjection, canvasSize.height, canvasSize.width, latticeVectors, periodic, setInitialCameraPosition, supercellParams, compactStructure])

  // Restore the Asset pose after the default-fit effect. Both may run during
  // navigation: the fit must always establish this document's exact Home pose,
  // while the saved pose remains authoritative for the live camera.
  useEffect(() => {
    if (!savedCameraState) return
    camera.position.set(...savedCameraState.position)
    if (
      camera instanceof THREE.OrthographicCamera
      && savedCameraState.zoom !== undefined
      && Number.isFinite(savedCameraState.zoom)
      && savedCameraState.zoom > 0
    ) {
      camera.zoom = savedCameraState.zoom
      camera.updateProjectionMatrix()
    }
    if (controlsRef.current) {
      controlsRef.current.target.set(...savedCameraState.target)
      controlsRef.current.update()
    } else {
      camera.lookAt(...savedCameraState.target)
    }
    cameraTrackAppliedFrameRef.current = useCrystalStore.getState().presentationFrame
    invalidate()
  }, [camera, invalidate, savedCameraState])

  const cameraTargetKey = cameraTarget ? JSON.stringify(cameraTarget) : ''

  const initCameraAnimation = (target: NonNullable<typeof cameraTarget>) => {
    if (!controlsRef.current) return
    const anim = animationRef.current
    anim.startTime = Date.now()
    anim.duration = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : typeof target.durationMs === 'number' && Number.isFinite(target.durationMs)
        ? Math.max(target.durationMs, 0)
        : CAMERA_FOCUS_DURATION_MS
    anim.startPosition.copy(camera.position)
    anim.startTarget.set(
      controlsRef.current.target.x,
      controlsRef.current.target.y,
      controlsRef.current.target.z,
    )
    anim.endTarget.set(...target.lookAt)

    const isOrtho = camera instanceof THREE.OrthographicCamera

    if (isOrtho && !target.preserveViewDirection && !target.forceOrientation) {
      const offset = new THREE.Vector3().subVectors(anim.startPosition, anim.startTarget)
      if (offset.lengthSq() < 1e-6) offset.set(0, 0, 1)
      anim.endPosition.copy(anim.endTarget).add(offset)
    } else if (target.preserveViewDirection && target.distance) {
      const viewDirection: [number, number, number] = [
        anim.startPosition.x - anim.startTarget.x,
        anim.startPosition.y - anim.startTarget.y,
        anim.startPosition.z - anim.startTarget.z,
      ]
      const perspectiveClearance = compactStructure
        ? cameraViewClearanceFromBounds(
            compactStructure.bbox,
            target.lookAt,
            viewDirection,
            target.scenePadding,
          )
        : cameraViewClearanceFromPoints(
            atoms.map((atom) => atom.cartesian ?? atom.position),
            target.lookAt,
            viewDirection,
            target.scenePadding,
          )
      const endPosition = preservedViewCameraPosition(
        [anim.startPosition.x, anim.startPosition.y, anim.startPosition.z],
        [anim.startTarget.x, anim.startTarget.y, anim.startTarget.z],
        target.lookAt,
        resolvedFocusDistance(
          target.distance,
          isOrtho ? target.sceneClearance : perspectiveClearance,
        ),
      )
      anim.endPosition.set(...endPosition)
    } else {
      anim.endPosition.set(...target.position)
    }

    // Pose targets carry an exact zoom; focus targets carry an explicit world
    // span. Positional targets without either preserve the current scale.
    if (isOrtho) {
      anim.startZoom = camera.zoom
      anim.endZoom = target.zoom !== undefined && Number.isFinite(target.zoom) && target.zoom > 0
        ? target.zoom
        : target.framingSpan !== undefined && Number.isFinite(target.framingSpan) && target.framingSpan > 0
          ? orthographicZoomForSpan(target.framingSpan, canvasSize.width, canvasSize.height)
          : camera.zoom
      anim.animateZoom = Math.abs(anim.endZoom - anim.startZoom) > 1e-3
    } else {
      anim.animateZoom = false
    }
    animatedTargetRef.current = target
  }

  useEffect(() => {
    if (cameraTarget && isAnimatingCamera && controlsRef.current) {
      initCameraAnimation(cameraTarget)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, cameraTarget, cameraTargetKey, isAnimatingCamera, setInteractionPerformanceActive])

  useFrame(() => {
    if (!isAnimatingCamera || !cameraTarget || !controlsRef.current) return

    // Manual input wins immediately over an authored camera flight.
    if (cameraTrackInteractionRef.current.manualActive) {
      const position = camera.position
      const target = controlsRef.current.target
      setSavedCameraState({
        position: [position.x, position.y, position.z],
        target: [target.x, target.y, target.z],
        ...(camera instanceof THREE.OrthographicCamera ? { zoom: camera.zoom } : {}),
      })
      abortCameraFlight()
      return
    }

    if (animatedTargetRef.current !== cameraTarget) {
      initCameraAnimation(cameraTarget)
    }

    const anim = animationRef.current
    const elapsed = Date.now() - anim.startTime
    const progress = anim.duration <= 0 ? 1 : Math.min(elapsed / anim.duration, 1)
    const eased = easeInOutCubic(progress)

    camera.position.lerpVectors(anim.startPosition, anim.endPosition, eased)

    // Orthographic framing must animate zoom; moving the camera alone does not magnify.
    if (anim.animateZoom && camera instanceof THREE.OrthographicCamera) {
      camera.zoom = anim.startZoom * Math.pow(anim.endZoom / anim.startZoom, eased)
      camera.updateProjectionMatrix()
    }

    const newTarget = new THREE.Vector3()
    newTarget.lerpVectors(anim.startTarget, anim.endTarget, eased)
    controlsRef.current.target.copy(newTarget)
    controlsRef.current.update()

    if (progress >= 1) {
      const p = camera.position
      const t = controlsRef.current.target
      setSavedCameraState({
        position: [p.x, p.y, p.z],
        target: [t.x, t.y, t.z],
        ...(camera instanceof THREE.OrthographicCamera ? { zoom: camera.zoom } : {}),
      })
      setIsAnimatingCamera(false)
      setCameraTarget(null)
    } else {
      invalidate()
    }
  })

  // Camera keyframes share the presentation playhead with style and molecular
  // trajectory channels. A paused scrub still previews the recorded pose, but
  // manual OrbitControls remain authoritative until the playhead moves again.
  // The grace period absorbs the damping tail instead of snapping the camera.
  useFrame(() => {
    const previousInteraction = cameraTrackInteractionRef.current
    const currentInteraction = watchdogCameraInteraction(previousInteraction, performance.now())
    if (currentInteraction !== previousInteraction) {
      cameraTrackInteractionRef.current = currentInteraction
      if (previousInteraction.manualActive && !currentInteraction.manualActive) {
        setInteractionPerformanceActive(false)
      }
    }
    if (cameraKeyframes.length === 0 || !controlsRef.current) return
    // Read the imperative command state synchronously so a focus action issued
    // just before this R3F frame cannot be overwritten by a stale React closure.
    const liveCameraState = useCrystalStore.getState()
    if (liveCameraState.isAnimatingCamera || liveCameraState.cameraTarget) return
    if (currentInteraction.manualActive) return
    const scrubNeedsPreview = cameraTrackAppliedFrameRef.current !== presentationFrame
    // Damping at the same playhead yields to the grace window. An explicit
    // scrub changes the frame and is itself a newer user command, so preview it
    // immediately; onStart already paused playback and pinned the applied frame.
    if (!scrubNeedsPreview && performance.now() < currentInteraction.graceUntil) return
    if (!scrubNeedsPreview) return
    if (presentationPlaying && typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const pose = evaluateBioCameraTrack(cameraKeyframes, presentationFrame)
    if (!pose) return
    camera.position.set(...pose.position)
    controlsRef.current.target.set(...pose.target)
    if (camera instanceof THREE.OrthographicCamera && pose.zoom !== undefined) {
      camera.zoom = pose.zoom
      camera.updateProjectionMatrix()
    }
    camera.lookAt(...pose.target)
    controlsRef.current.update()
    cameraTrackAppliedFrameRef.current = presentationFrame
    setSavedCameraState({
      position: [...pose.position],
      target: [...pose.target],
      ...(camera instanceof THREE.OrthographicCamera ? { zoom: pose.zoom ?? camera.zoom } : {}),
    })
    invalidate()
  })

  useFrame(() => {
    if (
      !massiveSceneMode
      || isAnimatingCamera
      || !controlsRef.current
      || !massiveSceneVisualFocusCenter
      || massiveSceneVisualFocusDistance == null
    ) {
      massiveSceneVisualFocusDriftStartRef.current = null
      return
    }

    const focusCenter = new THREE.Vector3(
      massiveSceneVisualFocusCenter[0],
      massiveSceneVisualFocusCenter[1],
      massiveSceneVisualFocusCenter[2],
    )
    const currentTarget = controlsRef.current.target
    const targetDx = currentTarget.x - focusCenter.x
    const targetDy = currentTarget.y - focusCenter.y
    const targetDz = currentTarget.z - focusCenter.z
    const targetDrift = Math.sqrt(targetDx * targetDx + targetDy * targetDy + targetDz * targetDz)
    const cameraDx = camera.position.x - currentTarget.x
    const cameraDy = camera.position.y - currentTarget.y
    const cameraDz = camera.position.z - currentTarget.z
    const currentDistance = Math.sqrt(cameraDx * cameraDx + cameraDy * cameraDy + cameraDz * cameraDz)
    const maxAllowedDistance = Math.max(massiveSceneVisualFocusDistance * 1.8, massiveSceneVisualFocusDistance + 8)
    const maxAllowedTargetDrift = Math.max(2.5, massiveSceneVisualFocusDistance * 0.45)

    if (currentDistance > maxAllowedDistance || targetDrift > maxAllowedTargetDrift) {
      if (massiveSceneVisualFocusDriftStartRef.current == null) {
        massiveSceneVisualFocusDriftStartRef.current = Date.now()
        return
      }

      if (Date.now() - massiveSceneVisualFocusDriftStartRef.current < 420) {
        return
      }

      clearMassiveSceneVisualFocus()
      massiveSceneVisualFocusDriftStartRef.current = null
      return
    }

    massiveSceneVisualFocusDriftStartRef.current = null
  })

  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

  useEffect(() => {
    const canvas = gl.domElement
    canvas.style.touchAction = shouldLockCamera || isCurrentlyDragging ? 'none' : 'pan-x pan-y'

    return () => {
      canvas.style.touchAction = 'pan-x pan-y'
    }
  }, [gl, isCurrentlyDragging, shouldLockCamera])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!isTouchDevice && !massiveSceneMode}
      dampingFactor={massiveSceneMode ? 0.04 : 0.08}
        enableRotate={!boxSelectModeEnabled && !shouldLockCamera && !suppressOrbitForSelection}
        enablePan={!boxSelectModeEnabled && !shouldLockCamera && !suppressOrbitForSelection}
      rotateSpeed={massiveSceneMode ? (isTouchDevice ? 1.15 : 0.7) : (isTouchDevice ? 1.0 : 0.5)}
      zoomSpeed={massiveSceneMode ? (isTouchDevice ? 1.3 : 0.95) : (isTouchDevice ? 1.2 : 0.8)}
      panSpeed={massiveSceneMode ? (isTouchDevice ? 0.9 : 0.6) : (isTouchDevice ? 0.8 : 0.5)}
      minDistance={0.1}
      maxDistance={Infinity}
      autoRotate={autoRotate}
      autoRotateSpeed={1.2}
      onChange={() => {
        cameraTrackInteractionRef.current = recordCameraManualActivity(
          cameraTrackInteractionRef.current,
          performance.now(),
        )
      }}
      onStart={() => {
        // Camera motion is always interruptible from its current presentation
        // value; grabbing the viewport immediately hands control back to the user.
        if (isAnimatingCamera) {
          animatedTargetRef.current = null
          setIsAnimatingCamera(false)
          setCameraTarget(null)
        }
        setInteractionPerformanceActive(true)
        cameraTrackInteractionRef.current = beginCameraManualInteraction(
          cameraTrackInteractionRef.current,
          performance.now(),
        )
        cameraTrackAppliedFrameRef.current = presentationFrame
        if (presentationPlaying) pausePresentation()
      }}
      onEnd={() => {
        setInteractionPerformanceActive(false)
        cameraTrackInteractionRef.current = endCameraManualInteraction(
          cameraTrackInteractionRef.current,
          performance.now(),
        )
        if (controlsRef.current) {
          const p = camera.position
          const t = controlsRef.current.target
          setSavedCameraState({
            position: [p.x, p.y, p.z],
            target: [t.x, t.y, t.z],
            ...(camera instanceof THREE.OrthographicCamera ? { zoom: camera.zoom } : {}),
          })
        }
      }}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
      mouseButtons={mouseButtonsForPreset}
      enabled={!isCurrentlyDragging && !shouldLockCamera}
    />
  )
}
