'use client'

// AtomRenderer - Renders individual atoms with selection, hover, and drag states
// Unit geometries and mutable shader uniforms are shared to avoid per-atom GPU churn.

import { useMemo, useCallback, useRef, useEffect } from 'react'
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atom, ViewMode } from '../../../lib/crystal/types'
import { applyRadiusVariance } from '../../../lib/crystal/elements'
import { getCpkElementVisual, getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import { outlinedAtomRadius } from '../../../lib/render/bond-contact'
import { isMobileLikeRuntime, shouldDisableGeometrySelection } from '../../../lib/performance/adaptive-performance'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { resolveAtomOverlayColor } from '../../../orchestration/slices/atom-attributes-slice'
import { grainColorHex } from '../../../lib/polycrystal/grain-colors'
import { atomScalarValue, scalarColorHex, scalarRangeCached } from '../../../lib/viz/trajectory-color'
import { entranceProgress, easeOutBack, forgetEntrance, isExiting, exitProgress, clearExit } from '../../../orchestration/atomEntranceSchedule'
import { applySelectionTransformPreviewToPosition } from '../../../lib/selection-transform-preview'
import { useDisplayPositions } from './use-display-positions'
import { dispatchExactAtomClick } from '../../../lib/measurement/atom-click-dispatch'
import { atomBelongsToGroup } from '../../../orchestration/slices/structure-groups-slice'
import { markDoubleClickConsumedBy3D } from '../viewport-grid/double-click-arbiter'
import { StylizedMaterial } from './stylized-material'
import type { LayerRenderOverride } from './layer-render-override'
import {
  SELECTION_RIM_COLOR,
  PENDING_BOND_RIM_COLOR,
  PENDING_MEASURE_RIM_COLOR,
  DELETE_HOVER_RIM_COLOR,
  HOVER_RIM_COLOR,
  SELECTION_RIM_SCALE,
  HOVER_RIM_SCALE,
  SELECTION_RIM_POWER,
  SELECTION_RIM_STRENGTH,
  HOVER_RIM_STRENGTH,
  RIM_VERTEX_SHADER,
  RIM_FRAGMENT_SHADER,
} from '../../../lib/render/selection-visual'

const FIXED_MARKER_GEOMETRY = new THREE.BoxGeometry(2, 2, 2)
// Constraint state uses a neutral wire cage so it remains distinct from selection color.
const FIXED_MARKER_COLOR = '#5E6470'
const FIXED_MARKER_SCALE = 1.16

// Radius-one spheres are cached by detail and scaled per atom.
const unitSphereCache = new Map<number, THREE.SphereGeometry>()
const RIM_SPHERE_DETAIL = 24

function getUnitSphere(detail: number): THREE.SphereGeometry {
  let geo = unitSphereCache.get(detail)
  if (!geo) {
    geo = new THREE.SphereGeometry(1, detail, Math.max(8, Math.round(detail / 2)))
    unitSphereCache.set(detail, geo)
  }
  return geo
}

function AtomRimMaterial({ color, strength, opacity }: { color: string; strength: number; opacity: number }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  // Keep the uniform object stable and mutate values below to avoid shader recompilation.
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uPower: { value: SELECTION_RIM_POWER },
      uStrength: { value: strength },
      uOpacity: { value: opacity },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uColor.value.set(color)
    material.uniforms.uStrength.value = strength
    material.uniforms.uOpacity.value = opacity
  }, [color, strength, opacity])

  return (
    <shaderMaterial
      ref={materialRef}
      uniforms={uniforms}
      vertexShader={RIM_VERTEX_SHADER}
      fragmentShader={RIM_FRAGMENT_SHADER}
      transparent
      side={THREE.BackSide}
      depthWrite={false}
      blending={THREE.AdditiveBlending}
    />
  )
}

interface AtomMeshProps {
  atom: Atom
  viewMode: ViewMode
  scale: number
  hiddenAtomIds?: ReadonlySet<string>
  renderOverride?: LayerRenderOverride
  onAtomClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  onAtomDoubleClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  /** Final world position used when focusing a periodic image. */
  focusDisplayPosition?: [number, number, number]
  /** Periodic images share the source id but already carry their final position. */
  isPeriodicImage?: boolean
}

export function AtomMesh({ atom, viewMode, scale, hiddenAtomIds, renderOverride, onAtomClick, onAtomDoubleClick, focusDisplayPosition, isPeriodicImage }: AtomMeshProps) {
  const { gl, invalidate } = useThree()

  // Per-atom booleans keep a hover change from rerendering every AtomMesh instance.
  const isSelected = useCrystalStore((s) => s.selectedAtomIds.has(atom.id))
  const isHovered = useCrystalStore((s) => s.hoveredAtomId === atom.id)
  const selectAtom = useCrystalStore((s) => s.selectAtom)
  const setHoveredAtom = useCrystalStore((s) => s.setHoveredAtom)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const selectMode = useCrystalStore((s) => s.selectMode)
  const faceSelectMethod = useCrystalStore((s) => s.faceSelectMethod)
  const deleteAtom = useCrystalStore((s) => s.deleteAtom)
  const isPendingBond = useCrystalStore((s) => s.pendingBondAtomId === atom.id)
  const isFocused = useCrystalStore((s) => s.focusedAtomIds.has(atom.id))
  const hasFocusedAtoms = useCrystalStore((s) => s.focusedAtomIds.size > 0)
  const measurementMode = useCrystalStore((s) => s.measurementMode)
  const addMeasurementAtom = useCrystalStore((s) => s.addMeasurementAtom)
  const isPendingMeasurement = useCrystalStore((s) => s.pendingMeasurementAtoms.includes(atom.id))
  const focusedAtomOpacity = useCrystalStore((s) => s.focusedAtomOpacity)
  const clearFocusedAtoms = useCrystalStore((s) => s.clearFocusedAtoms)
  const isDraggingAny = useCrystalStore((s) => Boolean(s.draggingAtomId))
  const setDraggingAtom = useCrystalStore((s) => s.setDraggingAtom)
  const boxSelectModeEnabled = useCrystalStore((s) => s.boxSelectModeEnabled)
  const showBZOverlay = useCrystalStore((s) => s.showBZOverlay)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)
  const selectionTransformOrigin = useCrystalStore((s) => s.selectionTransformOrigin)
  const translateMode = useCrystalStore((s) => s.translateMode)
  const showPtmColoring = useCrystalStore((s) => s.showPtmColoring)
  const showMofSbuColoring = useCrystalStore((s) => s.showMofSbuColoring)
  const showGrainColoring = useCrystalStore((s) => s.showGrainColoring)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const elementOverrides = useCrystalStore((s) => s.elementOverrides)
  const sphereDetail = useCrystalStore((s) => s.sphereDetail)
  const outline = useCrystalStore((s) => s.outline)
  const outlineWidth = useCrystalStore((s) => s.outlineWidth)
  const outlineColor = useCrystalStore((s) => s.outlineColor)
  // Trajectory "color by" scalar overlay (extended-XYZ props).
  const trajectoryColorProp = useCrystalStore((s) => s.trajectoryColorProp)
  const trajectoryColormap = useCrystalStore((s) => s.trajectoryColormap)
  const trajectoryColorRange = useCrystalStore((s) => s.trajectoryColorRange)
  const allAtoms = useCrystalStore((s) => s.atoms)
  const effectiveScalarRange = useMemo(
    () => (trajectoryColorProp ? (trajectoryColorRange ?? scalarRangeCached(allAtoms, trajectoryColorProp)) : null),
    [trajectoryColorProp, trajectoryColorRange, allAtoms],
  )

  const bonds = useCrystalStore((s) => s.bonds)
  const unwrapMap = useDisplayPositions(allAtoms, bonds)

  // ── Entrance animation refs (mutated imperatively in useFrame, no React re-render) ──
  const entranceGroupRef = useRef<THREE.Group>(null)
  const entranceMatRef = useRef<THREE.Material | null>(null)
  const setEntranceMaterial = useCallback((material: THREE.Material | null) => {
    entranceMatRef.current = material
  }, [])

  const setEntranceOpacity = (opacity: number) => {
    const material = entranceMatRef.current
    if (!material) return
    material.opacity = opacity
    if (material instanceof THREE.ShaderMaterial && material.uniforms.uOpacity) {
      material.uniforms.uOpacity.value = opacity
    }
  }
  const entranceDoneRef = useRef(false)
  // M3: live ref so focus-fade changes mid-entrance are applied immediately
  // (avoids the stale __targetOpacity monkey-patch on the material object).
  const targetOpacityRef = useRef<number>(1)

  // Cleanup birth record when atom unmounts
  useEffect(() => {
    entranceDoneRef.current = false
    return () => { forgetEntrance(atom.id); clearExit(atom.id) }
  }, [atom.id])

  const activeGroupId = useCrystalStore((s) => s.activeGroupId)
  const structureGroups = useCrystalStore((s) => s.structureGroups)
  const isGroupDimmed = activeGroupId !== null && !atomBelongsToGroup(atom, activeGroupId, structureGroups)
  const isFaded = (
    !renderOverride?.suppressGlobalFocusFade
    && hasFocusedAtoms
    && !isFocused
  ) || showBZOverlay || isGroupDimmed
  const isDragMode = toolMode === 'drag-atom'

  // M3: update the live opacity target every render so focus-fade changes
  // mid-entrance are picked up immediately by the useFrame below.
  const layerOpacity = renderOverride?.opacity ?? 1
  targetOpacityRef.current = viewMode === 'hyper-stick'
    ? (isSelected ? 0.2 : 0)
    : viewMode === 'wireframe'
      ? 0
      : (isFaded ? focusedAtomOpacity : 1) * layerOpacity

  useFrame(() => {
    const now = performance.now()
    if (isExiting(atom.id)) {
      const e = exitProgress(atom.id, now)
      if (entranceGroupRef.current) entranceGroupRef.current.scale.setScalar(Math.max(0, 1 - e))
      setEntranceOpacity(targetOpacityRef.current * Math.max(0, 1 - e))
      if (e < 1) invalidate()
      return
    }
    if (entranceDoneRef.current) return
    const t = entranceProgress(atom.id, now)
    const p = easeOutBack(t)
    if (entranceGroupRef.current) {
      entranceGroupRef.current.scale.setScalar(p)
    }
    setEntranceOpacity(targetOpacityRef.current * Math.min(1, p))
    if (t >= 1) {
      entranceDoneRef.current = true
      if (entranceGroupRef.current) entranceGroupRef.current.scale.setScalar(1)
      setEntranceOpacity(targetOpacityRef.current)
    } else {
      // Demand rendering must be invalidated until the entrance animation settles.
      invalidate()
    }
  })

  const vanDerWaalsSpaceFill = useCrystalStore((s) => s.vanDerWaalsSpaceFill)
  const useCpk = vanDerWaalsSpaceFill && viewMode === 'space-fill'
  const elementData = useMemo(
    () => (useCpk ? getCpkElementVisual(atom.element) : getDefaultCrystalElementVisual(atom.element)),
    [atom.element, useCpk],
  )
  const elementVisual = elementOverrides[atom.element] ?? elementData
  const elementRadiusVariance = useCrystalStore((s) => s.elementRadiusVariance)
  const bondScale = useCrystalStore((s) => s.bondScale)
  const sourceBondRadius = useCrystalStore((s) => s.bondRadius)

  const radius = useMemo(() => {
    const exactRadius = renderOverride?.atomRadiusByAtomId?.get(atom.id)
    // `atomRadiusByAtomId` is deliberately an exact world-space contract.
    // Layer scaling is already folded into biomolecular radii before this pass.
    if (exactRadius !== undefined) return Math.max(0.001, exactRadius)
    const compressed = applyRadiusVariance(elementVisual.radius, elementRadiusVariance)
    const baseRadius = compressed * 0.5
    if (viewMode === 'space-fill') return baseRadius * 2.5 * scale
    if (viewMode === 'wireframe') return baseRadius * 0.3 * scale
    if (viewMode === 'stick') return sourceBondRadius
    if (viewMode === 'hyper-stick') return 0.08 * bondScale
    return baseRadius * scale
  }, [atom.id, bondScale, elementVisual.radius, elementRadiusVariance, renderOverride?.atomRadiusByAtomId, sourceBondRadius, viewMode, scale])

  let trajColor: string | null = null
  if (trajectoryColorProp && effectiveScalarRange) {
    const v = atomScalarValue(atom.props, trajectoryColorProp)
    if (v !== null) trajColor = scalarColorHex(v, effectiveScalarRange, trajectoryColormap)
  }
  const grainProp = atom.props?.grain_id
  const colorHex = (showGrainColoring && grainProp && grainProp.kind === 'scalar')
    ? grainColorHex(grainProp.value)
    : resolveAtomOverlayColor(
        elementVisual.color,
        atomAttributes[atom.id],
        showMofSbuColoring,
        showPtmColoring,
        trajColor,
      )
  const displayColor = isSelected && viewMode === 'hyper-stick'
    ? '#00aaff'
    : renderOverride?.colorByAtomId?.get(atom.id) ?? colorHex

  // State is encoded in a Fresnel rim so the element color remains authoritative.
  const rimColor = useMemo(() => {
    if (isPendingMeasurement) return PENDING_MEASURE_RIM_COLOR
    if (isPendingBond) return PENDING_BOND_RIM_COLOR
    if (isSelected) return SELECTION_RIM_COLOR
    if (toolMode === 'delete' && isHovered) return DELETE_HOVER_RIM_COLOR
    return HOVER_RIM_COLOR
  }, [isPendingBond, isPendingMeasurement, isSelected, toolMode, isHovered])

  const rimStrength = useMemo(() => {
    if (isPendingMeasurement || isPendingBond) return SELECTION_RIM_STRENGTH
    if (isSelected) return SELECTION_RIM_STRENGTH
    if (isHovered) return HOVER_RIM_STRENGTH
    return 0
  }, [isHovered, isPendingBond, isPendingMeasurement, isSelected])

  const rimScale = useMemo(() => {
    if (isPendingMeasurement || isPendingBond || isSelected) return radius * SELECTION_RIM_SCALE
    if (isHovered) return radius * HOVER_RIM_SCALE
    return radius * HOVER_RIM_SCALE
  }, [isHovered, isPendingBond, isPendingMeasurement, isSelected, radius])

  // A separate cage lets persistent constraints coexist with transient state rims.
  const fixedMarker = useMemo(() => {
    const fixed = atom.fixed
    if (!fixed) return null
    const lockedAxes = (fixed[0] ? 1 : 0) + (fixed[1] ? 1 : 0) + (fixed[2] ? 1 : 0)
    if (lockedAxes === 0) return null
    const full = lockedAxes === 3
    return {
      size: radius * (full ? FIXED_MARKER_SCALE : FIXED_MARKER_SCALE * 0.82),
      opacity: full ? 1 : 0.55,
    }
  }, [atom.fixed, radius])
  // The mesh only initiates dragging; AtomDragHandler owns global motion and release.
  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!isDragMode || translateMode) return
    e.stopPropagation()
    const wp = e.object.getWorldPosition(new THREE.Vector3())
    setDraggingAtom(atom.id, [wp.x, wp.y, wp.z])
    try { gl.domElement.setPointerCapture(e.nativeEvent.pointerId) } catch { /* noop */ }
    gl.domElement.style.cursor = 'grabbing'
  }, [isDragMode, translateMode, atom.id, setDraggingAtom, gl.domElement])

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (boxSelectModeEnabled) return
    e.stopPropagation()
    const atomDispatch = dispatchExactAtomClick({
      measurementActive: measurementMode !== 'none',
      atomId: atom.id,
      event: e,
      atom,
      addMeasurementAtom,
      onAtomClick,
      overrideEnabled: !isDragMode && !translateMode,
    })
    if (atomDispatch !== 'default') return
    if (isDragMode || translateMode) return

    // Adsorbate click-to-place: armed via the Adsorbate panel. Clicking an
    // atom infers a top site from it and places the active fragment directly.
    // Missed clicks never reach this handler, so camera orbit is untouched.
    if (toolMode === 'select' && useCrystalStore.getState().adsorbateClickPlace) {
      void useCrystalStore.getState().placeFragmentAtAtom(atom.id)
      return
    }

    if (toolMode === 'delete') {
      deleteAtom(atom.id)
      return
    }

    if (toolMode === 'add-bond') {
      useCrystalStore.getState().handleBondToolClick(atom.id)
      return
    }

    const geometrySelectionDisabled = shouldDisableGeometrySelection(useCrystalStore.getState().atoms.length, {
      mobileLike: isMobileLikeRuntime(),
    })
    const canSelect = (selectMode === 'atom' && toolMode === 'select') ||
                      (!geometrySelectionDisabled && selectMode === 'face' && faceSelectMethod === 'three-atoms')
    if (canSelect) {
      const multi = e.nativeEvent.shiftKey || (!geometrySelectionDisabled && selectMode === 'face' && faceSelectMethod === 'three-atoms')
      selectAtom(
        atom.id,
        multi,
        isPeriodicImage ? ((atom.cartesian ?? atom.position) as [number, number, number]) : undefined,
      )
      if (selectMode === 'atom') {
        setTimeout(() => {
          const { selectedAtomIds: currentSelection, autoFocusOnAtom } = useCrystalStore.getState()
          if (currentSelection.size === 0) {
            clearFocusedAtoms()
            return
          }
          if (autoFocusOnAtom) {
      focusOnAtoms(
        Array.from(currentSelection),
        currentSelection.size === 1 ? focusDisplayPosition : undefined,
      )
    }
        }, 50)
      }
    }
  }, [isDragMode, translateMode, onAtomClick, measurementMode, toolMode, selectMode,
  faceSelectMethod, atom, addMeasurementAtom, deleteAtom,
  selectAtom, boxSelectModeEnabled, clearFocusedAtoms, focusOnAtoms, focusDisplayPosition])

  const handlePointerOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (boxSelectModeEnabled) return
    const geometrySelectionDisabled = shouldDisableGeometrySelection(useCrystalStore.getState().atoms.length, {
      mobileLike: isMobileLikeRuntime(),
    })
    const canInteract = (selectMode === 'atom' && toolMode === 'select') ||
                        (!geometrySelectionDisabled && selectMode === 'face' && faceSelectMethod === 'three-atoms') ||
                        toolMode === 'delete' || toolMode === 'add-bond' ||
                        toolMode === 'drag-atom' || measurementMode !== 'none'
    if (!canInteract) return
    e.stopPropagation()
    setHoveredAtom(atom.id)
    const cursor = measurementMode !== 'none' ? 'crosshair' :
                   toolMode === 'delete' ? 'not-allowed' :
                   toolMode === 'add-bond' ? 'crosshair' :
                   toolMode === 'drag-atom' ? (isDraggingAny ? 'grabbing' : 'grab') : 'pointer'
    document.body.style.cursor = cursor
  }, [selectMode, toolMode, faceSelectMethod, measurementMode, isDraggingAny, atom.id, setHoveredAtom, boxSelectModeEnabled])

  const handlePointerOut = useCallback(() => {
    if (!isDraggingAny) {
      setHoveredAtom(null)
      document.body.style.cursor = 'auto'
    }
  }, [isDraggingAny, setHoveredAtom])

  if (!atom.cartesian || hiddenAtomIds?.has(atom.id)) return null

  const position: [number, number, number] = applySelectionTransformPreviewToPosition(
    atom.cartesian,
    isPeriodicImage ? false : isSelected,
    selectionTransformOrigin,
    translationPreview,
    rotationPreview,
    isPeriodicImage ? null : unwrapMap?.get(atom.id) ?? null,
  )

  const draggable = !isPeriodicImage

  return (
    <group position={position} ref={entranceGroupRef}>
      <mesh
        onClick={handleClick}
        onDoubleClick={onAtomDoubleClick ? (event) => {
          event.stopPropagation()
          if (measurementMode !== 'none') return
          markDoubleClickConsumedBy3D()
          onAtomDoubleClick(event, atom)
        } : undefined}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onPointerDown={draggable ? handlePointerDown : undefined}
        renderOrder={isFocused ? 10 : isFaded ? 1 : 5}
        castShadow={viewMode !== 'hyper-stick' && viewMode !== 'wireframe' && !isFaded && layerOpacity >= 1}
        receiveShadow
        geometry={getUnitSphere(sphereDetail)}
        scale={[radius, radius, radius]}
      >
        <StylizedMaterial
          color={displayColor}
          opacity={targetOpacityRef.current}
          transparent={viewMode === 'hyper-stick' || viewMode === 'wireframe' || isFaded || layerOpacity < 1}
          depthWrite={viewMode !== 'hyper-stick' && viewMode !== 'wireframe' && !isFaded && layerOpacity >= 1}
          mode={renderOverride?.mode}
          ambient={renderOverride?.ambient}
          diffuse={renderOverride?.diffuse}
          specularStrength={renderOverride?.specularStrength}
          shininess={renderOverride?.shininess}
          fresnel={renderOverride?.fresnel}
          materialRef={setEntranceMaterial}
        />
      </mesh>
      {outline && viewMode !== 'hyper-stick' && viewMode !== 'wireframe' && (
        <mesh
          raycast={() => {}}
          renderOrder={4}
          geometry={getUnitSphere(sphereDetail)}
          scale={new Array(3).fill(outlinedAtomRadius(radius, outlineWidth)) as [number, number, number]}
        >
          <meshBasicMaterial color={outlineColor} side={THREE.BackSide} transparent={isFaded || layerOpacity < 1} opacity={(isFaded ? focusedAtomOpacity : 1) * layerOpacity} depthWrite={!isFaded && layerOpacity >= 1} />
        </mesh>
      )}
      {rimStrength > 0 && (
        // Shared unit sphere, like the body mesh above. This shell mounts and
        // unmounts on every hover change; a JSX <sphereGeometry> here allocated
        // and uploaded a fresh 24x24 sphere each time and disposed it on leave —
        // a hitch per hovered atom, worst while the camera is moving.
        <mesh scale={[rimScale, rimScale, rimScale]} raycast={() => {}} renderOrder={5} geometry={getUnitSphere(RIM_SPHERE_DETAIL)}>
          <AtomRimMaterial
            color={rimColor}
            strength={rimStrength}
            opacity={(isFaded ? focusedAtomOpacity : 1) * layerOpacity}
          />
        </mesh>
      )}
      {fixedMarker !== null && (
        <lineSegments raycast={() => {}} renderOrder={6} scale={[fixedMarker.size, fixedMarker.size, fixedMarker.size]}>
          <edgesGeometry args={[FIXED_MARKER_GEOMETRY]} />
          <lineBasicMaterial
            color={FIXED_MARKER_COLOR}
            transparent
            opacity={(isFaded ? focusedAtomOpacity : 1) * layerOpacity * fixedMarker.opacity}
            depthWrite={false}
          />
        </lineSegments>
      )}
    </group>
  )
}
