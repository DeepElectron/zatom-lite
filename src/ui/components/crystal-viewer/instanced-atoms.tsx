'use client'

// High-performance instanced rendering for large atom counts using InstancedMesh
// Analytic ray-sphere picking avoids per-instance matrix inversion and triangle tests.
import { useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { Atom, ViewMode } from '../../../lib/crystal/types'
import { applyRadiusVariance } from '../../../lib/crystal/elements'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import { outlinedAtomRadius } from '../../../lib/render/bond-contact'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { resolveAtomOverlayColor } from '../../../orchestration/slices/atom-attributes-slice'
import { atomScalarValue, scalarColorHex, scalarRangeCached } from '../../../lib/viz/trajectory-color'
import { grainColorHex } from '../../../lib/polycrystal/grain-colors'

const _pickRayOrigin = new THREE.Vector3()
const _pickRayDir = new THREE.Vector3()
const _pickInverse = new THREE.Matrix4()
const _pickIdentity = new THREE.Matrix4()
import { applySelectionTransformPreviewToPosition, isNonZeroVector } from '../../../lib/selection-transform-preview'
import { useDisplayPositions } from './use-display-positions'
import { dispatchExactAtomClick } from '../../../lib/measurement/atom-click-dispatch'
import { StylizedMaterial } from './stylized-material'
import type { LayerRenderOverride } from './layer-render-override'
import { markDoubleClickConsumedBy3D } from '../viewport-grid/double-click-arbiter'

interface InstancedAtomsProps {
  atoms: Atom[]
  viewMode: ViewMode
  scale: number
  radialSegments?: number
  hiddenAtomIds?: ReadonlySet<string>
  renderOverride?: LayerRenderOverride
  onAtomClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  onAtomDoubleClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
}

type Vec3 = [number, number, number]

// Group atoms by element for efficient instanced rendering
function groupAtomsByElement(atoms: Atom[]): Map<string, Atom[]> {
  const groups = new Map<string, Atom[]>()
  for (const atom of atoms) {
    const existing = groups.get(atom.element)
    if (existing) {
      existing.push(atom)
    } else {
      groups.set(atom.element, [atom])
    }
  }
  return groups
}

// Single element instanced mesh - uses element color directly instead of vertexColors
function ElementInstancedMesh({
  element,
  atoms,
  viewMode,
  scale,
  radialSegments = 12,
  unwrapMap,
  renderOverride,
  outlineSuppressed = false,
  onAtomClick,
  onAtomDoubleClick,
}: {
  element: string
  atoms: Atom[]
  viewMode: ViewMode
  scale: number
  radialSegments?: number
  unwrapMap: ReadonlyMap<string, Vec3> | null
  renderOverride?: LayerRenderOverride
  outlineSuppressed?: boolean
  onAtomClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
  onAtomDoubleClick?: (event: ThreeEvent<MouseEvent>, atom: Atom) => void
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const outlineRef = useRef<THREE.InstancedMesh>(null)
  const colorArrayRef = useRef<Float32Array | null>(null)
  const invalidate = useThree((state) => state.invalidate)
  const elementData = useMemo(() => getDefaultCrystalElementVisual(element), [element])
  const elementOverrides = useCrystalStore((s) => s.elementOverrides)
  const elementVisual = elementOverrides[element] ?? elementData
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const translationPreview = useCrystalStore((s) => s.translationPreview)
  const rotationPreview = useCrystalStore((s) => s.rotationPreview)
  const selectionTransformOrigin = useCrystalStore((s) => s.selectionTransformOrigin)
  const elementRadiusVariance = useCrystalStore((s) => s.elementRadiusVariance)
  const bondScale = useCrystalStore((s) => s.bondScale)
  const sourceBondRadius = useCrystalStore((s) => s.bondRadius)
  const showPtmColoring = useCrystalStore((s) => s.showPtmColoring)
  // MOF SBU coloring takes priority over PTM when both are on.
  const showMofSbuColoring = useCrystalStore((s) => s.showMofSbuColoring)
  // Polycrystal: per-grain coloring, keyed off atom.props.grain_id.
  const showGrainColoring = useCrystalStore((s) => s.showGrainColoring)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const sphereDetail = useCrystalStore((s) => s.sphereDetail)
  const outline = useCrystalStore((s) => s.outline)
  const outlineWidth = useCrystalStore((s) => s.outlineWidth)
  const outlineColor = useCrystalStore((s) => s.outlineColor)
  // Trajectory "color by" scalar overlay (extended-XYZ props: charge, |force|, …).
  const trajectoryColorProp = useCrystalStore((s) => s.trajectoryColorProp)
  const trajectoryColormap = useCrystalStore((s) => s.trajectoryColormap)
  const trajectoryColorRange = useCrystalStore((s) => s.trajectoryColorRange)
  const allAtoms = useCrystalStore((s) => s.atoms)
  // Effective colour range: pinned [min,max] (stable across frames) or auto over
  // ALL atoms of the active frame (not just this element's subset).
  const effectiveScalarRange = useMemo(
    () => (trajectoryColorProp ? (trajectoryColorRange ?? scalarRangeCached(allAtoms, trajectoryColorProp)) : null),
    [trajectoryColorProp, trajectoryColorRange, allAtoms],
  )

  const radius = useMemo(() => {
    const exactRadius = renderOverride?.atomRadiusByAtomId?.get(atoms[0]?.id)
    // Exact layer radii are already expressed in world space.
    if (exactRadius !== undefined) return Math.max(0.001, exactRadius)
    const baseRadius = applyRadiusVariance(elementVisual.radius, elementRadiusVariance) * 0.5
    switch (viewMode) {
      case 'space-fill':
        return baseRadius * 2.5 * scale
      case 'wireframe':
        return baseRadius * 0.3 * scale
      case 'stick':
        return sourceBondRadius
      case 'hyper-stick':
        return 0.08 * bondScale
      case 'ball-stick':
      default:
        return baseRadius * scale
    }
  }, [atoms, bondScale, elementVisual.radius, elementRadiusVariance, renderOverride?.atomRadiusByAtomId, sourceBondRadius, viewMode, scale])

  // Update instance matrices — debounce when 2D plane view is open
  const show2DPlaneView = useCrystalStore((s) => s.show2DPlaneView)
  const pendingUpdate = useRef<ReturnType<typeof setTimeout> | null>(null)

  const previewActive = isNonZeroVector(translationPreview) || isNonZeroVector(rotationPreview)
  const selectionMatrixDep = previewActive ? selectedAtomIds : null
  const selectedAtomIdsRef = useRef(selectedAtomIds)
  selectedAtomIdsRef.current = selectedAtomIds

  const pickPositionsRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    const doUpdate = () => {
      if (!meshRef.current) return
      const meshes = [meshRef.current, outlineRef.current].filter((mesh): mesh is THREE.InstancedMesh => Boolean(mesh))
      const matrix = new THREE.Matrix4()
      let pick = pickPositionsRef.current
      if (!pick || pick.length !== atoms.length * 3) {
        pick = new Float32Array(atoms.length * 3)
        pickPositionsRef.current = pick
      }

      atoms.forEach((atom, i) => {
        if (!atom.cartesian) {
          matrix.makeScale(0, 0, 0)
          for (const mesh of meshes) mesh.setMatrixAt(i, matrix)
          pick![i * 3] = NaN
          return
        }
        const isSelected = selectedAtomIdsRef.current.has(atom.id)
        const [x, y, z] = applySelectionTransformPreviewToPosition(
          atom.cartesian,
          isSelected,
          selectionTransformOrigin,
          translationPreview,
          rotationPreview,
          unwrapMap?.get(atom.id) ?? null,
        )
        matrix.makeTranslation(x, y, z)
        for (const mesh of meshes) mesh.setMatrixAt(i, matrix)
        pick![i * 3] = x; pick![i * 3 + 1] = y; pick![i * 3 + 2] = z
      })
      for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true
      invalidate()
    }

    if (show2DPlaneView && atoms.length > 5000) {
      if (pendingUpdate.current) clearTimeout(pendingUpdate.current)
      pendingUpdate.current = setTimeout(doUpdate, 300)
    } else {
      doUpdate()
    }

    return () => {
      if (pendingUpdate.current) clearTimeout(pendingUpdate.current)
    }
  }, [atoms, selectionMatrixDep, translationPreview, rotationPreview, selectionTransformOrigin, show2DPlaneView, unwrapMap, outline, invalidate])

  const analyticRaycast = useCallback(function (
    this: THREE.InstancedMesh,
    raycaster: THREE.Raycaster,
    intersects: THREE.Intersection[],
  ) {
    const pick = pickPositionsRef.current
    if (!pick) return
    _pickRayOrigin.copy(raycaster.ray.origin)
    _pickRayDir.copy(raycaster.ray.direction)
    const hasTransform = !_pickIdentity.equals(this.matrixWorld)
    if (hasTransform) {
      _pickInverse.copy(this.matrixWorld).invert()
      _pickRayOrigin.applyMatrix4(_pickInverse)
      _pickRayDir.transformDirection(_pickInverse)
    }
    const r2 = radius * radius
    const ox = _pickRayOrigin.x, oy = _pickRayOrigin.y, oz = _pickRayOrigin.z
    const dx = _pickRayDir.x, dy = _pickRayDir.y, dz = _pickRayDir.z
    const count = pick.length / 3
    for (let i = 0; i < count; i++) {
      const cx = pick[i * 3]
      if (Number.isNaN(cx)) continue
      const lx = cx - ox, ly = pick[i * 3 + 1] - oy, lz = pick[i * 3 + 2] - oz
      const tca = lx * dx + ly * dy + lz * dz
      if (tca + radius < 0) continue
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca
      if (d2 > r2) continue
      const thc = Math.sqrt(r2 - d2)
      let t = tca - thc
      if (t < 0) t = tca + thc
      if (t < 0) continue
      const point = new THREE.Vector3(ox + t * dx, oy + t * dy, oz + t * dz)
      if (hasTransform) point.applyMatrix4(this.matrixWorld)
      const distance = raycaster.ray.origin.distanceTo(point)
      if (distance < raycaster.near || distance > raycaster.far) continue
      intersects.push({ distance, point, object: this, instanceId: i })
    }
  }, [radius])

  const selectAtom = useCrystalStore((s) => s.selectAtom)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const clearFocusedAtoms = useCrystalStore((s) => s.clearFocusedAtoms)
  const toolMode = useCrystalStore((s) => s.toolMode)
  const measurementMode = useCrystalStore((s) => s.measurementMode)
  const addMeasurementAtom = useCrystalStore((s) => s.addMeasurementAtom)

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (toolMode !== 'select' && toolMode !== 'add-bond' && measurementMode === 'none') return
    e.stopPropagation()
    const instanceId = e.instanceId
    if (instanceId == null || instanceId < 0 || instanceId >= atoms.length) return

    const atom = atoms[instanceId]
    if (!atom) return
    if (toolMode === 'add-bond' && measurementMode === 'none') {
      useCrystalStore.getState().handleBondToolClick(atom.id)
      return
    }
    const atomDispatch = dispatchExactAtomClick({
      measurementActive: measurementMode !== 'none',
      atomId: atom.id,
      event: e,
      atom,
      addMeasurementAtom,
      onAtomClick,
      overrideEnabled: toolMode === 'select',
    })
    if (atomDispatch !== 'default') return
    if (toolMode !== 'select') return

    // Adsorbate click-to-place: same branch as atom-renderer.tsx — clicking an
    // atom infers a top site and places the active fragment directly.
    if (useCrystalStore.getState().adsorbateClickPlace) {
      void useCrystalStore.getState().placeFragmentAtAtom(atom.id)
      return
    }

    const multi = e.nativeEvent.shiftKey
    selectAtom(atom.id, multi)

    setTimeout(() => {
      const { selectedAtomIds: current, autoFocusOnAtom } = useCrystalStore.getState()
      if (current.size === 0) {
        clearFocusedAtoms()
      } else if (autoFocusOnAtom) {
        focusOnAtoms(Array.from(current))
      }
    }, 50)
  }, [addMeasurementAtom, atoms, toolMode, measurementMode, onAtomClick, selectedAtomIds, selectAtom, focusOnAtoms, clearFocusedAtoms])

  const handleDoubleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (!onAtomDoubleClick) return
    event.stopPropagation()
    if (measurementMode !== 'none') return
    const instanceId = event.instanceId
    if (instanceId == null || instanceId < 0 || instanceId >= atoms.length) return
    markDoubleClickConsumedBy3D()
    onAtomDoubleClick(event, atoms[instanceId])
  }, [atoms, measurementMode, onAtomDoubleClick])

  // Write per-instance colors when any per-atom colouring overlay is active.
  // MOF SBU coloring takes priority over PTM if both are on; atoms
  // without an attribute assignment fall through to the element's default.
  const trajColorActive = !!(trajectoryColorProp && effectiveScalarRange)
  useLayoutEffect(() => {
    if (!meshRef.current) return
    const mesh = meshRef.current
    const layerColors = renderOverride?.colorByAtomId
    if (!layerColors && !showPtmColoring && !showMofSbuColoring && !trajColorActive && !showGrainColoring) {
      // Clear any prior per-instance color override so the material color
      if (mesh.instanceColor) {
        mesh.instanceColor = null
        const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const entry of material) entry.needsUpdate = true
      }
      invalidate()
      return
    }
    let colors = colorArrayRef.current
    if (!colors || colors.length !== atoms.length * 3) {
      colors = new Float32Array(atoms.length * 3)
      colorArrayRef.current = colors
    }
    const tmp = new THREE.Color()
    for (let i = 0; i < atoms.length; i++) {
      const attrs = atomAttributes[atoms[i].id]
      // Trajectory scalar → colormap hex (highest priority); null when this atom
      // lacks the active property.
      let trajColor: string | null = null
      if (trajColorActive && trajectoryColorProp && effectiveScalarRange) {
        const v = atomScalarValue(atoms[i].props, trajectoryColorProp)
        if (v !== null) trajColor = scalarColorHex(v, effectiveScalarRange, trajectoryColormap)
      }
      let hex: string
      const gp = atoms[i].props?.grain_id
      const layerColor = layerColors?.get(atoms[i].id)
      if (layerColor) {
        hex = layerColor
      } else if (showGrainColoring && gp && gp.kind === 'scalar') {
        hex = grainColorHex(gp.value)
      } else {
        hex = resolveAtomOverlayColor(elementVisual.color, attrs, showMofSbuColoring, showPtmColoring, trajColor)
      }
      tmp.setStyle(hex, THREE.NoColorSpace)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    if (!mesh.instanceColor || mesh.instanceColor.array !== colors) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3)
      const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const entry of material) entry.needsUpdate = true
    }
    mesh.instanceColor.needsUpdate = true
    invalidate()
  }, [showPtmColoring, showMofSbuColoring, showGrainColoring, atomAttributes, atoms, elementVisual.color, trajColorActive, trajectoryColorProp, trajectoryColormap, effectiveScalarRange, invalidate, renderOverride?.colorByAtomId])

  if (atoms.length === 0) return null

  const hasInstanceColors = Boolean(renderOverride?.colorByAtomId) || showPtmColoring || showMofSbuColoring || showGrainColoring || trajColorActive
  const layerOpacity = renderOverride?.opacity ?? 1
  const segments = Math.max(6, Math.min(radialSegments, sphereDetail))
  const heightSegments = Math.max(4, Math.ceil(segments / 2))

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, atoms.length]}
        frustumCulled={false}
        castShadow={viewMode !== 'wireframe' && layerOpacity >= 1}
        receiveShadow
        raycast={analyticRaycast}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <sphereGeometry args={[radius, segments, heightSegments]} />
        <StylizedMaterial
          color={hasInstanceColors ? '#ffffff' : elementVisual.color}
          instanceColors={hasInstanceColors}
          opacity={viewMode === 'wireframe' ? 0 : layerOpacity}
          transparent={viewMode === 'wireframe' || layerOpacity < 1}
          depthWrite={viewMode !== 'wireframe' && layerOpacity >= 1}
          mode={renderOverride?.mode}
          ambient={renderOverride?.ambient}
          diffuse={renderOverride?.diffuse}
          specularStrength={renderOverride?.specularStrength}
          shininess={renderOverride?.shininess}
          fresnel={renderOverride?.fresnel}
        />
      </instancedMesh>
      {outline && !outlineSuppressed && viewMode !== 'wireframe' && layerOpacity > 0 && (
        <instancedMesh
          ref={outlineRef}
          args={[undefined, undefined, atoms.length]}
          frustumCulled={false}
          raycast={() => {}}
          renderOrder={4}
        >
          <sphereGeometry args={[outlinedAtomRadius(radius, outlineWidth), segments, heightSegments]} />
          <meshBasicMaterial color={outlineColor} side={THREE.BackSide} transparent={layerOpacity < 1} opacity={layerOpacity} depthWrite={layerOpacity >= 1} />
        </instancedMesh>
      )}
    </>
  )
}

export function InstancedAtoms({ atoms, viewMode, scale, radialSegments = 12, hiddenAtomIds, renderOverride, onAtomClick, onAtomDoubleClick }: InstancedAtomsProps) {
  const visibleAtoms = useMemo(
    () => hiddenAtomIds && hiddenAtomIds.size > 0 ? atoms.filter((atom) => !hiddenAtomIds.has(atom.id)) : atoms,
    [atoms, hiddenAtomIds],
  )

  const atomGroups = useMemo(() => groupAtomsByElement(visibleAtoms), [visibleAtoms])

  const bonds = useCrystalStore((s) => s.bonds)
  const unwrapMap = useDisplayPositions(atoms, bonds)

  const massiveSceneThreshold = useCrystalStore((s) => s.massiveSceneThreshold)
  const outlineSuppressed = visibleAtoms.length > massiveSceneThreshold

  return (
    <group>
      {Array.from(atomGroups.entries()).map(([element, elementAtoms]) => (
        <ElementInstancedMesh
          key={element}
          element={element}
          atoms={elementAtoms}
          viewMode={viewMode}
          scale={scale}
          radialSegments={radialSegments}
          unwrapMap={unwrapMap}
          renderOverride={renderOverride}
          outlineSuppressed={outlineSuppressed}
          onAtomClick={onAtomClick}
          onAtomDoubleClick={onAtomDoubleClick}
        />
      ))}
    </group>
  )
}
