'use client'

/** Root R3F viewport and DOM overlays for a crystal or biomolecular document. */
import { useRef, useEffect, Suspense, useCallback, useState, useMemo } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { CrystalScene } from './crystal-scene'
import { AdaptivePerformanceController } from './adaptive-performance-controller'
import { CameraController } from './camera-controller'
import { isBioSelectionReplaceMiss, SelectionBox, SelectionOverlay } from './selection-box'
import { SurfaceColorBar } from './surface-color-bar'
import { SelectionManipulationHandler } from './selection-manipulation-handler'
import { AtomDragHandler } from './atom-drag-handler'
import { CellResizeGizmo } from './cell-resize-gizmo'
import { MergePlacementPreview } from './merge-placement-preview'
import { AdsorbateSiteMarkers } from './adsorbate-site-markers'
import { AmbientOcclusionPass } from './ambient-occlusion-pass'
import { PathTracingPass } from './path-tracing-pass'
import { BondAnnotationLayer, GenericContactLayer } from './bond-annotation-layer'
import { AdsorbateGhostPreview } from './adsorbate-ghost-preview'
import { ProceduralVolumeLayer } from './procedural-volume-layer'
import { buildSnapLines, type Vec3 } from '../../../lib/geometry-snap'
import {
  MAX_SNAP_ATOMS,
  needsSnapLines,
  pickSnapFeature,
  type ActiveFeature,
} from '../../../lib/geometry-snap-pick'
import { SnapFeatureOverlay } from './snap-feature-overlay'
import { EmptyState } from './empty-state'
import { ViewportContextMenu } from './viewport-context-menu'
import { PhysicsStepper } from './physics-stepper'
import { ViewportCaptureRegistrar } from './viewport-capture-registrar'
import { AgentInspectionOverlay } from './agent-inspection-overlay'
import { AgentGuidanceAnnotations } from './agent-guidance-annotations'
import { AgentProposalGhostLayer } from './agent-proposal-ghost-layer'
import { useViewportStore as useCrystalStore, useViewportStoreApi } from '../../../orchestration/ViewportContext'
import { useViewportManager } from '../../../orchestration/viewportManager'
import { useAgentProposalStore } from '../../../orchestration/agentProposalStore'
import { useIsMobile } from '../../../ui-kit/use-mobile'
import { resolveViewportTheme } from '../../../host'
import { resolveViewportLighting, scaleLightingForStudio } from '../../../lib/lighting'
import { ViewportLights } from '../viewport-lights'
import { StudioStage } from '../studio-stage'
import {
  isMassiveScene,
  isVeryLargeScene,
} from '../../../lib/performance/adaptive-performance'
// Assembly 3D interactions handled by AssemblyViewer directly


// Invisible plane for add-atom click detection
function AddAtomClickHandler() {
  const { camera, gl } = useThree()
  const meshRef = useRef<THREE.Mesh>(null)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const selectedElement = useCrystalStore((s) => s.selectedElement)
  const addAtomToSupercell = useCrystalStore((s) => s.addAtomToSupercell)
  const cameraTarget = useCrystalStore((s) => s.cameraTarget)
  const geometrySnapEnabled = useCrystalStore((s) => s.geometrySnapEnabled)
  const geometrySnapTargets = useCrystalStore((s) => s.geometrySnapTargets)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const supercell = useCrystalStore((s) => s.supercellParams)
  const periodic = useCrystalStore((s) => s.periodic)
  const showLattice = useCrystalStore((s) => s.showLattice)
  const showCellGrid = useCrystalStore((s) => s.showCellGrid)

  const snapLines = useMemo(
    () => (geometrySnapEnabled && toolMode === 'add-atom' && needsSnapLines(geometrySnapTargets)
      ? buildSnapLines(atoms, bonds, latticeVectors, selectedAtomIds, {
          supercell,
          visible: periodic && showLattice,
          showCellGrid,
        })
      : []),
    [geometrySnapEnabled, geometrySnapTargets, toolMode, atoms, bonds, latticeVectors, selectedAtomIds, supercell, periodic, showLattice, showCellGrid],
  )
  const atomPoints = useMemo(
    () => (geometrySnapEnabled && geometrySnapTargets.atomCenter && toolMode === 'add-atom' && atoms.length <= MAX_SNAP_ATOMS
      ? atoms
          .map((a) => ({ id: a.id, pos: (a.cartesian ?? a.position) as Vec3 | undefined }))
          .filter((a): a is { id: string; pos: Vec3 } => Array.isArray(a.pos))
      : []),
    [geometrySnapEnabled, geometrySnapTargets.atomCenter, toolMode, atoms],
  )

  const [active, setActive] = useState<ActiveFeature | null>(null)
  const activeRef = useRef<ActiveFeature | null>(null)
  activeRef.current = active
  const downPosRef = useRef<{ x: number; y: number } | null>(null)

  // Keep plane facing camera
  useEffect(() => {
    if (meshRef.current && toolMode === 'add-atom') {
      meshRef.current.lookAt(camera.position)
    }
  })

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (toolMode !== 'add-atom') return
    if (!snapLines.length && !atomPoints.length) { if (active) setActive(null); return }
    const rect = gl.domElement.getBoundingClientRect()
    const next = pickSnapFeature({
      camera,
      rect,
      clientX: e.nativeEvent.clientX,
      clientY: e.nativeEvent.clientY,
      snapLines,
      atomPoints,
      targets: geometrySnapTargets,
    })
    setActive(next)
  }, [toolMode, snapLines, atomPoints, geometrySnapTargets, gl.domElement, camera, active])

  const handlePointerOut = useCallback(() => setActive(null), [])

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (toolMode !== 'add-atom') return
    downPosRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY }
  }, [toolMode])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (toolMode !== 'add-atom') return
    e.stopPropagation()
    if (!e.point) return
    const down = downPosRef.current
    downPosRef.current = null
    if (down) {
      const moved = Math.hypot(e.nativeEvent.clientX - down.x, e.nativeEvent.clientY - down.y)
      if (moved > 6) return
    }
    const snap = activeRef.current?.snap
    const pos: [number, number, number] = snap ? snap.pos : [e.point.x, e.point.y, e.point.z]
    addAtomToSupercell(selectedElement, pos)
  }, [toolMode, selectedElement, addAtomToSupercell])

  if (toolMode !== 'add-atom') return null

  // Position plane at camera target
  const targetPos: number[] = Array.isArray(cameraTarget)
    ? cameraTarget
    : cameraTarget && 'lookAt' in cameraTarget && Array.isArray((cameraTarget as { lookAt: unknown }).lookAt)
      ? ((cameraTarget as { lookAt: number[] }).lookAt)
      : [0, 0, 0]

  // Large invisible plane to catch clicks - positioned at scene center
  return (
    <>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        position={[targetPos[0], targetPos[1], targetPos[2]]}
        renderOrder={-1}
      >
        <planeGeometry args={[500, 500]} />
        <meshBasicMaterial
          visible={false}
          side={THREE.DoubleSide}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
      <SnapFeatureOverlay active={active} />
    </>
  )
}

function DragSnapFeedback() {
  const toolMode = useCrystalStore((s) => s.toolMode)
  const dragSnapFeature = useCrystalStore((s) => s.dragSnapFeature)
  if (toolMode !== 'drag-atom') return null
  return <SnapFeatureOverlay active={dragSnapFeature} />
}

function Scene() {
  const background = useCrystalStore(s => s.background)
  const isDark = resolveViewportTheme(background) === 'dark'
  const isolateScalarSlice = useCrystalStore(s => s.volumeField !== 'none' && s.sliceEnabled && s.sliceIsolate)
  const [scalarLayerRenderable, setScalarLayerRenderable] = useState(false)
  const userAmbient = useCrystalStore(s => s.lightAmbient)
  const userKey = useCrystalStore(s => s.lightKey)
  const userFill = useCrystalStore(s => s.lightFill)
  const userAzim = useCrystalStore(s => s.lightAzimuth)
  const userElev = useCrystalStore(s => s.lightElevation)
  const followCamera = useCrystalStore(s => s.lightFollowsCamera)
  const renderStyle = useCrystalStore(s => s.renderStyle)
  const pathTracingEnabled = useCrystalStore(s => s.pathTracing)
  const pathTracingActive = renderStyle === 'studio' && pathTracingEnabled
  const baseLighting = resolveViewportLighting(isDark, userAmbient, userKey, userFill)
  const lighting = renderStyle === 'studio' ? scaleLightingForStudio(baseLighting) : baseLighting
  return (
    <>
      <ClippingController />
      {renderStyle !== 'studio' && <color attach="background" args={[background]} />}
      {renderStyle === 'studio' && <StudioStage />}
      <ViewportLights
        lighting={lighting}
        azimuth={userAzim}
        elevation={userElev}
        followCamera={followCamera}
        castShadows={renderStyle === 'studio'}
      />
      <CrystalScene hidePrimaryStructure={isolateScalarSlice && scalarLayerRenderable} />
      <BondAnnotationLayer />
      <AdsorbateGhostPreview />
      <GenericContactLayer />
      <ProceduralVolumeLayer onRenderableChange={setScalarLayerRenderable} />
      <Suspense fallback={null}>
        <AgentInspectionOverlay />
        <AgentGuidanceAnnotations />
        <AgentProposalGhostLayer />
      </Suspense>
      <SelectionBox />
      <AddAtomClickHandler />
      <SelectionManipulationHandler />
      <AtomDragHandler />
      <DragSnapFeedback />
      <CellResizeGizmo />
      <MergePlacementPreview />
      <AdsorbateSiteMarkers />
      {pathTracingActive ? <PathTracingPass /> : <AmbientOcclusionPass />}
    </>
  )
}

function ClippingController() {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const clippingEnabled = useCrystalStore((state) => state.clippingEnabled)
  const clippingAxis = useCrystalStore((state) => state.clippingAxis)
  const clippingOffset = useCrystalStore((state) => state.clippingOffset)
  const clippingNormal = useCrystalStore((state) => state.clippingNormal)
  const scalarSliceClipping = useCrystalStore((state) => (
    state.volumeField !== 'none' && state.sliceEnabled && state.sliceClip !== 'none'
  ))
  const clippingPlanes = useMemo(() => {
    if (!clippingEnabled) return []
    const normal = clippingNormal
      ? new THREE.Vector3(...clippingNormal).normalize()
      : new THREE.Vector3(
          clippingAxis === 'x' ? 1 : 0,
          clippingAxis === 'y' ? 1 : 0,
          clippingAxis === 'z' ? 1 : 0,
        )
    return [new THREE.Plane(normal, -clippingOffset)]
  }, [clippingAxis, clippingEnabled, clippingNormal, clippingOffset])

  useEffect(() => {
    gl.localClippingEnabled = clippingEnabled || scalarSliceClipping
    gl.clippingPlanes = clippingPlanes
    invalidate()
    return () => {
      gl.clippingPlanes = []
      gl.localClippingEnabled = false
      invalidate()
    }
  }, [clippingEnabled, clippingPlanes, gl, invalidate, scalarSliceClipping])
  return null
}

export function SelectionInfoOverlay() {
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectedBondIds = useCrystalStore((s) => s.selectedBondIds)
  const boxSelectModeEnabled = useCrystalStore((s) => s.boxSelectModeEnabled)
  const compactStructure = useCrystalStore((s) => s.compactStructure)
  const selectedCompactIndices = useCrystalStore((s) => s.selectedCompactIndices)
  const atoms = useCrystalStore((s) => s.atoms)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const translateMode = useCrystalStore((s) => s.translateMode)

  const atomCount = compactStructure ? selectedCompactIndices.size : selectedAtomIds.size
  const showManipHint = atomCount > 0 && !translateMode && (toolMode === 'select' || toolMode === 'drag-atom')
  const bondCount = selectedBondIds.size
  const selection = useMemo(() => {
    const coordinateLabel = (position: readonly [number, number, number]) =>
      `x ${position[0].toFixed(2)} · y ${position[1].toFixed(2)} · z ${position[2].toFixed(2)}`

    if (compactStructure) {
      const composition = new Map<string, number>()
      for (const index of selectedCompactIndices) {
        if (index < 0 || index >= compactStructure.count) continue
        const symbol = compactStructure.elements[compactStructure.elementIndex[index]]
        if (symbol) composition.set(symbol, (composition.get(symbol) ?? 0) + 1)
      }
      const detail = [...composition.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([symbol, count]) => `${symbol}${count > 1 ? ` ×${count}` : ''}`)
        .join(' · ')
      return { primary: `${atomCount} atoms selected`, detail }
    }

    if (bioStructure) {
      const selected = bioStructure.atoms.filter((atom) => selectedAtomIds.has(atom.id))
      if (selected.length === 1) {
        const atom = selected[0]
        const residue = bioStructure.residues[atom.residueIndex]
        const chain = residue ? bioStructure.chains[residue.chainIndex] : undefined
        const residueLabel = residue
          ? `${residue.name} ${(chain?.identifier || '∅')}${residue.identity.sequenceNumber}${residue.identity.insertionCode}`
          : 'Unknown residue'
        return {
          primary: `${atom.element} · ${atom.name} · ${residueLabel}`,
          detail: `serial ${atom.serial} · ${coordinateLabel(atom.position)}`,
        }
      }
      const composition = new Map<string, number>()
      for (const atom of selected) composition.set(atom.element, (composition.get(atom.element) ?? 0) + 1)
      const detail = [...composition.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([symbol, count]) => `${symbol}${count > 1 ? ` ×${count}` : ''}`)
        .join(' · ')
      return { primary: `${atomCount} atoms selected`, detail }
    }

    const selected = atoms.filter((atom) => selectedAtomIds.has(atom.id))
    if (selected.length === 1) {
      const atom = selected[0]
      const position = atom.cartesian ?? atom.position
      return {
        primary: `${atom.element} · ${atom.id}`,
        detail: coordinateLabel(position),
      }
    }
    const composition = new Map<string, number>()
    for (const atom of selected) composition.set(atom.element, (composition.get(atom.element) ?? 0) + 1)
    const detail = [...composition.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([symbol, count]) => `${symbol}${count > 1 ? ` ×${count}` : ''}`)
      .join(' · ')
    return { primary: `${atomCount} atoms selected`, detail }
  }, [atomCount, atoms, bioStructure, compactStructure, selectedAtomIds, selectedCompactIndices])

  if (atomCount === 0 && bondCount === 0) return null

  return (
    <div
      className="pointer-events-none max-w-full rounded-lg px-4 py-2 text-center"
      style={{ background: 'var(--glass-bg)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)', backdropFilter: 'var(--glass-blur)' }}
    >
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {atomCount > 0 && (
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-medium">{selection.primary}</span>
            {selection.detail && <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--panel-text-tertiary)]">{selection.detail}</span>}
          </span>
        )}
        {bondCount > 0 && <span className="text-[11px]">{bondCount} bond{bondCount > 1 ? 's' : ''} selected</span>}
        {boxSelectModeEnabled && <span className="text-[10px] text-blue-400">Press Delete to remove</span>}
      </div>
      {showManipHint && (
        <div className="mt-1.5 border-t pt-1.5 text-[9px] text-[var(--panel-text-tertiary)]" style={{ borderColor: 'var(--glass-border)' }}>
          <span className="font-mono">Ctrl</span> + drag to rotate
          <span className="mx-1.5 opacity-40">·</span>
          <span className="font-mono">Shift+Ctrl</span> + drag to move
        </div>
      )}
    </div>
  )
}

export function CrystalViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewportApi = useViewportStoreApi()
  const isMobile = useIsMobile()
  const background = useCrystalStore((s) => s.background)
  const autoRotate = useCrystalStore((s) => s.autoRotate)
  const atoms = useCrystalStore((s) => s.atoms)
  const compactStructure = useCrystalStore((s) => s.compactStructure)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const draggingAtomId = useCrystalStore((s) => s.draggingAtomId)
  const translateMode = useCrystalStore((s) => s.translateMode)
  const trajectoryPlaying = useCrystalStore((s) => s.trajectoryPlaying)
  const presentationPlaying = useCrystalStore((s) => s.presentationPlaying)
  const compactTrajectoryPlaying = useCrystalStore((s) => s.compactTrajectoryPlaying)
  const isAnimatingCamera = useCrystalStore((s) => s.isAnimatingCamera)
  const isBoxSelecting = useCrystalStore((s) => s.isBoxSelecting)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const measurementMode = useCrystalStore((s) => s.measurementMode)
  const boxSelectModeEnabled = useCrystalStore((s) => s.boxSelectModeEnabled)
  const clearSelection = useCrystalStore((s) => s.clearSelection)
  const clearFocusedAtoms = useCrystalStore((s) => s.clearFocusedAtoms)
  const hideContextMenu = useCrystalStore((s) => s.hideContextMenu)
  const interactionPerformanceActive = useCrystalStore((s) => s.interactionPerformanceActive)
  const cameraProjection = useCrystalStore((s) => s.cameraProjection)
  const isMultiViewport = useViewportManager((s) => s.layout !== '1x1' || s.freeLayout !== null)
  const isSimRunning = useCrystalStore((s) => s.isSimulationRunning)
  // Was: drop to on-demand rendering while the AI overlay is conversing, because
  // compositing backdrop-filter over a live WebGL canvas every frame is expensive.
  // No overlay can open in zatom, so this never fires.
  const aiOverlayConversing = false
  const shouldUseContinuousFrameloop =
    !aiOverlayConversing &&
    (autoRotate || isMultiViewport || isSimRunning || trajectoryPlaying || presentationPlaying || compactTrajectoryPlaying || isAnimatingCamera || isBoxSelecting || Boolean(draggingAtomId) || interactionPerformanceActive)
  const massiveSceneThreshold = useCrystalStore((s) => s.massiveSceneThreshold)
  const veryLargeSceneThreshold = useCrystalStore((s) => s.veryLargeSceneThreshold)
  const largeSceneThresholdOptions = {
    mobileLike: isMobile,
    customMassiveThreshold: massiveSceneThreshold,
    customVeryLargeThreshold: veryLargeSceneThreshold,
  }
  const massiveSceneMode = isMassiveScene(atoms.length, largeSceneThresholdOptions)
  const veryLargeSceneMode = isVeryLargeScene(atoms.length, largeSceneThresholdOptions)
  const canvasDpr: [number, number] = massiveSceneMode
    ? largeSceneThresholdOptions.mobileLike
      ? veryLargeSceneMode
        ? [0.75, 1]
        : [0.85, 1.15]
      : veryLargeSceneMode
        ? [0.9, 1.25]
        : [1, 1.5]
    : [1, 2]
  const hasBoundGhostProposal = useAgentProposalStore((state) => (
    (state.current?.status === 'pending' || state.current?.status === 'applying')
      && state.current.viewportKey === (viewportApi as unknown as object)
  ))

  return (
    <ViewportContextMenu>
    <div ref={containerRef}  className="w-full h-full relative select-none">
      {/* Keep the canvas mounted in add-atom mode so an empty document can receive its first atom. */}
      {(atoms && atoms.length > 0) || compactStructure || toolMode === 'add-atom' || hasBoundGhostProposal ? (
        <>
          <Canvas
            shadows={{ type: THREE.PCFSoftShadowMap }}
            gl={{ antialias: !massiveSceneMode, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
            dpr={canvasDpr}
            frameloop={shouldUseContinuousFrameloop ? 'always' : 'demand'}
            style={{ background }}
            onPointerMissed={(event) => {
              if (!isBioSelectionReplaceMiss({
                hasBiomolecule: Boolean(bioStructure),
                toolMode,
                measurementMode,
                translateMode,
                boxSelectModeEnabled,
              }, event)) return
              clearSelection()
              clearFocusedAtoms()
              hideContextMenu()
            }}
          >
            {cameraProjection === 'orthographic' ? (
              <OrthographicCamera key="orthographic-camera" makeDefault position={[0, 0, 20]} zoom={20} near={0.01} far={100000} />
            ) : (
              <PerspectiveCamera key="perspective-camera" makeDefault position={[0, 0, 20]} fov={50} near={0.01} far={100000} />
            )}
            <AdaptivePerformanceController />
            <CameraController />
            <PhysicsStepper />
            <ViewportCaptureRegistrar />
            <Scene />
          </Canvas>
          <SelectionOverlay containerRef={containerRef} />
          <SurfaceColorBar />
        </>
      ) : (
        <EmptyState />
      )}

    </div>
    </ViewportContextMenu>
  )
}
