'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useIsMobile } from '../../../ui-kit/use-mobile'
import {
  clampAdaptivePerformanceLevel,
  getAdaptiveTargetDpr,
  getLargeSceneThresholds,
  getTransientAdaptivePerformanceLevel,
  isMassiveScene,
  isVeryLargeScene,
} from '../../../lib/performance/adaptive-performance'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

/**
 * DPR held during a camera flight on a large scene. 1.5 on a 2x display is 44%
 * fewer pixels — enough to keep a 1.2 s flight smooth — while the snap back to
 * full resolution, which happens with the camera already still, stays subtle.
 */
const CAMERA_FLIGHT_DPR_WIDE_VIEWPORT = 1.5
const CAMERA_FLIGHT_DPR_MOBILE = 1.0

export function AdaptivePerformanceController() {
  const isMobile = useIsMobile()
  const { gl, size, invalidate } = useThree()

  const atomCount = useCrystalStore((s) => s.atoms.length)
  const lodThreshold = useCrystalStore((s) => s.lodThreshold)
  const ultraLowThreshold = useCrystalStore((s) => s.ultraLowThreshold)
  const adaptivePerformanceEnabled = useCrystalStore((s) => s.adaptivePerformanceEnabled)
  const adaptivePerformanceLevel = useCrystalStore((s) => s.adaptivePerformanceLevel)
  const setAdaptivePerformanceLevel = useCrystalStore((s) => s.setAdaptivePerformanceLevel)
  const setAdaptivePerformanceDpr = useCrystalStore((s) => s.setAdaptivePerformanceDpr)
  const interactionPerformanceActive = useCrystalStore((s) => s.interactionPerformanceActive)
  const cameraFlightActive = useCrystalStore((s) => s.isAnimatingCamera)
  const trajectoryPlaying = useCrystalStore((s) => s.trajectoryPlaying)
  const viewMode = useCrystalStore((s) => s.viewMode)
  // Compact impostor mode IS the performance path (one draw call) — adaptive DPR
  // degradation during trajectory playback just makes dense lattices collapse into
  // sub-pixel moiré dots. Keep full resolution while compact mode is active.
  const compactActive = useCrystalStore((s) => s.compactStructure !== null)

  const mobileLikeRuntime = isMobile
  const largeSceneThresholdOptions = useMemo(
    () => ({ mobileLike: mobileLikeRuntime }),
    [mobileLikeRuntime],
  )
  const { veryLargeSceneAtomThreshold } = useMemo(
    () => getLargeSceneThresholds(largeSceneThresholdOptions),
    [largeSceneThresholdOptions],
  )
  const deviceDpr = useMemo(() => {
    if (typeof window === 'undefined') {
      return 1
    }

    return Math.min(window.devicePixelRatio || 1, 2)
  }, [])

  const sampleRef = useRef({
    elapsed: 0,
    frames: 0,
    lowFpsStreak: 0,
    highFpsStreak: 0,
  })

  const minimumAdaptiveAtomCount = mobileLikeRuntime ? 400 : 1200
  const shouldActivelyTune = adaptivePerformanceEnabled && atomCount >= minimumAdaptiveAtomCount
  // Camera flights use a fixed DPR budget but do not trigger geometry LOD swaps.
  const transientInteractionActive = interactionPerformanceActive || trajectoryPlaying
  const transientAdaptiveLevel = shouldActivelyTune
    ? getTransientAdaptivePerformanceLevel(adaptivePerformanceLevel, transientInteractionActive)
    : adaptivePerformanceLevel
  const adaptiveTargetDpr = shouldActivelyTune
    ? Math.min(
        getAdaptiveTargetDpr(deviceDpr, transientAdaptiveLevel, largeSceneThresholdOptions),
        isVeryLargeScene(atomCount, largeSceneThresholdOptions)
          ? mobileLikeRuntime ? 0.85 : 1.2
          : isMassiveScene(atomCount, largeSceneThresholdOptions)
            ? mobileLikeRuntime ? 1 : 1.45
            : deviceDpr,
      )
    : deviceDpr

  // Hyper-stick shading is pixel-heavy, so large moving scenes receive an extra DPR cap.
  const hyperStickInteractionActive =
    viewMode === 'hyper-stick' && (transientInteractionActive || cameraFlightActive) && atomCount >= lodThreshold
  // Camera flight is deliberately NOT a transient interaction: the transient
  // level also drives sphere/bond segment profiles in crystal-scene, and
  // regenerating geometry at flight start and end is itself a hitch plus a
  // visible pop. Pixel count is the one lever with no geometric side effect, so
  // a flight on a large scene renders at a fixed lower DPR — every pass
  // (GTAO included) gets proportionally cheaper, and the camera is stationary
  // when full resolution returns.
  const targetDpr = compactActive
    ? deviceDpr
    : hyperStickInteractionActive
      ? Math.min(adaptiveTargetDpr, mobileLikeRuntime ? 0.5 : 0.65)
      : cameraFlightActive && shouldActivelyTune
        ? Math.min(adaptiveTargetDpr, mobileLikeRuntime ? CAMERA_FLIGHT_DPR_MOBILE : CAMERA_FLIGHT_DPR_WIDE_VIEWPORT)
        : adaptiveTargetDpr

  useEffect(() => {
    gl.setPixelRatio(targetDpr)
    gl.setSize(size.width, size.height, false)
    invalidate()
    setAdaptivePerformanceDpr(targetDpr)
  }, [gl, invalidate, setAdaptivePerformanceDpr, size.height, size.width, targetDpr])

  useEffect(() => {
    sampleRef.current = {
      elapsed: 0,
      frames: 0,
      lowFpsStreak: 0,
      highFpsStreak: 0,
    }

    if (!adaptivePerformanceEnabled || atomCount < minimumAdaptiveAtomCount) {
      if (adaptivePerformanceLevel !== 0) {
        setAdaptivePerformanceLevel(0)
      }
      return
    }

    if (atomCount > ultraLowThreshold * 0.85 && adaptivePerformanceLevel < 2) {
      setAdaptivePerformanceLevel(2)
      return
    }

    if (atomCount >= veryLargeSceneAtomThreshold && adaptivePerformanceLevel < 3) {
      setAdaptivePerformanceLevel(3)
      return
    }

    if (isMassiveScene(atomCount, largeSceneThresholdOptions) && adaptivePerformanceLevel < 2) {
      setAdaptivePerformanceLevel(2)
      return
    }

    if (atomCount > lodThreshold * 1.75 && adaptivePerformanceLevel < 1) {
      setAdaptivePerformanceLevel(1)
    }
  }, [
    adaptivePerformanceEnabled,
    adaptivePerformanceLevel,
    atomCount,
    largeSceneThresholdOptions,
    lodThreshold,
    minimumAdaptiveAtomCount,
    mobileLikeRuntime,
    setAdaptivePerformanceLevel,
    ultraLowThreshold,
    veryLargeSceneAtomThreshold,
  ])

  useFrame((_, delta) => {
    if (!shouldActivelyTune) {
      return
    }

    sampleRef.current.elapsed += delta
    sampleRef.current.frames += 1

    if (sampleRef.current.elapsed < 1.25) {
      return
    }

    const averageFps = sampleRef.current.frames / sampleRef.current.elapsed
    sampleRef.current.elapsed = 0
    sampleRef.current.frames = 0

    if (averageFps < 18) {
      sampleRef.current.lowFpsStreak = 0
      sampleRef.current.highFpsStreak = 0

      if (adaptivePerformanceLevel < 3) {
        setAdaptivePerformanceLevel(clampAdaptivePerformanceLevel(adaptivePerformanceLevel + 1))
      }
      return
    }

    if (averageFps < 27) {
      sampleRef.current.lowFpsStreak += 1
      sampleRef.current.highFpsStreak = 0

      if (sampleRef.current.lowFpsStreak >= 2 && adaptivePerformanceLevel < 3) {
        sampleRef.current.lowFpsStreak = 0
        setAdaptivePerformanceLevel(clampAdaptivePerformanceLevel(adaptivePerformanceLevel + 1))
      }
      return
    }

    if (averageFps > 52) {
      sampleRef.current.highFpsStreak += 1
      sampleRef.current.lowFpsStreak = 0

      if (sampleRef.current.highFpsStreak >= 4 && adaptivePerformanceLevel > 0) {
        sampleRef.current.highFpsStreak = 0
        setAdaptivePerformanceLevel(clampAdaptivePerformanceLevel(adaptivePerformanceLevel - 1))
      }
      return
    }

    sampleRef.current.lowFpsStreak = 0
    sampleRef.current.highFpsStreak = 0
  })

  return null
}
