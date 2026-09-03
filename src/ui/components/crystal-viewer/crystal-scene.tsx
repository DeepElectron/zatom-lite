'use client'

/** Select the appropriate atom, bond, biomolecule, and analysis layers for one scene. */
import { useEffect, useMemo, useRef } from 'react'
import type { Atom } from '../../../lib/crystal/types'
import { useIsMobile } from '../../../ui-kit/use-mobile'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { AtomMesh } from './atom-renderer'
import { BondMesh } from './bond-mesh'
import { LatticeGrid } from './lattice-grid'
import { ConstructedPlaneMesh } from './constructed-plane-mesh'
import { InstancedAtoms } from './instanced-atoms'
import { PeriodicImageAtoms } from './periodic-image-atoms'
import { InstancedBonds } from './bond-instances'
import { CompactAtoms } from './compact-atoms'
import { FusedAtomSurface } from './fused-atom-surface'
import { RegionSolids } from './region-solids'
import { createPlaybackChannel } from '../../../lib/render/playback-channel'
import { hiddenHydrogenIds } from '../../../lib/render/hydrogen-visibility'
import { MeasurementVisualization } from './measurement-visualization'
import { BrillouinZoneOverlay } from './brillouin-zone-overlay'
import { SymmetryOverlay } from './symmetry-overlay'
import { SelectionRegionPreview } from './selection-region-preview'
import { SelectionTransformGizmo } from './selection-transform-gizmo'
import { HyperStickBonds } from './hyper-stick-bonds'
import { MolecularOrbitalLayer } from './molecular-orbital-layer'
import { SurfaceExtremumMarkers } from './surface-extremum-markers'
import { AtomRingDecoration } from './atom-ring-decoration'
import { CoordinationPolyhedra, useCoordinationAnalysis } from './coordination-polyhedra'
import { BaderLabels } from './bader-labels'
import { MagmomLabels } from './magmom-labels'
import { TrajectoryVectorField } from './trajectory-vector-field'
import { VoidSurfaceLayer } from './void-surface-layer'
import { BiomoleculeLayer } from './biomolecule-layer'
import { BiomoleculeDrillGhost } from './biomolecule-drill-ghost'
import { CrystalSemanticLayers } from './crystal-semantic-layers'
import { AtomLabels } from './atom-labels'
import { crystalBaseAtomRadii, crystalBaseBondRadius } from '../../../lib/crystal/base-presentation'
import { atomBelongsToGroup, hiddenGroupIds } from '../../../orchestration/slices/structure-groups-slice'
import type { LayerRenderOverride } from './layer-render-override'
import {
  getAdaptiveAtomQualityProfile,
  getAdaptiveBondQualityProfile,
  getLargeSceneHiResNeighborTargets,
  getTransientAdaptivePerformanceLevel,
  isMassiveScene,
  isVeryLargeScene,
} from '../../../lib/performance/adaptive-performance'

const MASSIVE_SCENE_HIRES_SELECTION_CAP = 70

export function CrystalScene({ hidePrimaryStructure = false }: { hidePrimaryStructure?: boolean }) {
  const isMobile = useIsMobile()
  const {
    atoms,
    bonds: allBonds,
    latticeVectors,
    supercellParams,
    viewMode,
    showBonds,
    showLattice,
    atomScale,
    bondScale,
    lodThreshold,
    useLowDetailMode,
    useUltraLowMode,
    adaptivePerformanceEnabled,
    adaptivePerformanceLevel,
    interactionPerformanceActive,
    trajectoryPlaying,
    setUseLowDetailMode,
    setUseUltraLowMode,
    fastCellIndices,
    detailCellIndices,
    selectedAtomIds,
    focusedAtomIds,
    massiveSceneVisualFocusAtomIds,
    massiveSceneVisualFocusCenter,
    showBZOverlay,
    periodic,
    compactStructure,
    focusAtoms,
    hideAtomsInRegionView,
    showCoordinationPolyhedra,
    polyStyle,
  } = useCrystalStore()
  const bioStructure = useCrystalStore((state) => state.bioStructure)
  const crystalLayers = useCrystalStore((state) => state.crystalLayers)
  const radiusScale = useCrystalStore((state) => state.radiusScale)
  const sourceBondRadius = useCrystalStore((state) => state.bondRadius)
  const elementRadiusVariance = useCrystalStore((state) => state.elementRadiusVariance)
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const fusedAtomSurface = useCrystalStore((state) => state.fusedAtomSurface)
  const hideHydrogens = useCrystalStore((state) => state.hideHydrogens)
  const keptHydrogens = useCrystalStore((state) => state.keptHydrogens)
  const baseRenderOverride = useMemo<LayerRenderOverride>(() => ({
    ...(viewMode === 'hyper-stick' || viewMode === 'wireframe' ? {} : { atomRadiusByAtomId: crystalBaseAtomRadii(atoms, viewMode, {
      radiusScale,
      bondRadius: sourceBondRadius,
      elementRadiusVariance,
      elementOverrides,
    }) }),
    ...(viewMode === 'hyper-stick' || viewMode === 'wireframe' || viewMode === 'space-fill'
      ? {}
      : { bondRadius: crystalBaseBondRadius({ bondRadius: sourceBondRadius }) }),
  }), [atoms, elementOverrides, elementRadiusVariance, radiusScale, sourceBondRadius, viewMode])
  const hyperStickBaseOverride = useMemo<LayerRenderOverride>(() => ({
    atomRadiusByAtomId: crystalBaseAtomRadii(atoms, 'ball-stick', {
      radiusScale,
      bondRadius: sourceBondRadius,
      elementRadiusVariance,
      elementOverrides,
    }),
    atomScale,
    bondScale,
    bondRadius: crystalBaseBondRadius({ bondRadius: sourceBondRadius }),
  }), [atomScale, atoms, bondScale, elementOverrides, elementRadiusVariance, radiusScale, sourceBondRadius])
  // Phase C: live playback buffers shared from CompactAtoms to RegionSolids (mutable, non-reactive)
  const compactPlaybackRef = useRef(createPlaybackChannel())
  const showRegionSolids = useCrystalStore((s) => s.showRegionSolids)
  const compactSpeciesSource = useCrystalStore((s) => s.compactSpeciesSource)
  // Normal Atom[] mode supports explicit polycrystal grain ids only. Build this
  // typed source lazily while the region view is active.
  const normalRegionSource = useMemo(() => {
    if (!showRegionSolids || compactStructure || atoms.length === 0) return null
    const n = atoms.length
    const positions = new Float32Array(n * 3)
    let grain: Uint32Array | undefined
    for (let i = 0; i < n; i++) {
      const c = atoms[i].cartesian ?? atoms[i].position ?? [0, 0, 0]
      positions[i * 3] = c[0]; positions[i * 3 + 1] = c[1]; positions[i * 3 + 2] = c[2]
      const gp = atoms[i].props?.grain_id
      if (gp && gp.kind === 'scalar') {
        if (!grain) grain = new Uint32Array(n)
        grain[i] = gp.value
      }
    }
    return grain ? { positions, count: n, grainId: grain } : null
  }, [showRegionSolids, compactStructure, atoms])
  const normalRegionOnlyView = showRegionSolids && hideAtomsInRegionView && normalRegionSource !== null
  const compactHasRegions = !!compactStructure?.grainId
    || (!!compactSpeciesSource && compactSpeciesSource.atomCount === compactStructure?.count)
  const compactRegionOnlyView = showRegionSolids && hideAtomsInRegionView && compactHasRegions

  const massiveSceneThreshold = useCrystalStore((s) => s.massiveSceneThreshold)
  const veryLargeSceneThreshold = useCrystalStore((s) => s.veryLargeSceneThreshold)
  const largeSceneThresholdOptions = useMemo(
    () => ({ mobileLike: isMobile, customMassiveThreshold: massiveSceneThreshold, customVeryLargeThreshold: veryLargeSceneThreshold }),
    [isMobile, massiveSceneThreshold, veryLargeSceneThreshold],
  )
  const hiResNeighborTargets = useMemo(
    () => getLargeSceneHiResNeighborTargets(largeSceneThresholdOptions),
    [largeSceneThresholdOptions],
  )
  const transientInteractionActive = interactionPerformanceActive || trajectoryPlaying
  const massiveSceneMode = isMassiveScene(atoms.length, largeSceneThresholdOptions)
  const veryLargeSceneMode = isVeryLargeScene(atoms.length, largeSceneThresholdOptions)
  const transientAdaptiveLevel = useMemo(
    () => getTransientAdaptivePerformanceLevel(adaptivePerformanceLevel, transientInteractionActive),
    [adaptivePerformanceLevel, transientInteractionActive],
  )

  // Geometry LOD follows the user threshold only; transient interaction changes
  // DPR instead, avoiding hot swaps between mesh and instanced render paths.
  const shouldUseLowDetail = useMemo(() => atoms.length > lodThreshold, [atoms.length, lodThreshold])
  const solidBoxManual = useCrystalStore((s) => s.solidBoxManual)
  const shouldUseUltraLow = solidBoxManual

  useEffect(() => {
    if (shouldUseLowDetail !== useLowDetailMode) {
      setUseLowDetailMode(shouldUseLowDetail)
    }
  }, [setUseLowDetailMode, shouldUseLowDetail, useLowDetailMode])

  useEffect(() => {
    if (shouldUseUltraLow !== useUltraLowMode) {
      setUseUltraLowMode(shouldUseUltraLow)
    }
  }, [setUseUltraLowMode, shouldUseUltraLow, useUltraLowMode])

  const isInFocusMode = focusedAtomIds.size > 0
  const effectiveShowBonds = showBonds && !showBZOverlay && !massiveSceneMode
  const effectiveShowLattice = periodic && showLattice && !massiveSceneMode
  const showCrystalOnlyOverlays = periodic

  const atomMap = useMemo(() => {
    const nextMap = new Map<string, Atom>()
    for (const atom of atoms) {
      nextMap.set(atom.id, atom)
    }
    return nextMap
  }, [atoms])

  const coordinationAnalysis = useCoordinationAnalysis()

  const polyhedronLigandAtomIdsBase = useMemo(() => {
    if (
      !showCoordinationPolyhedra
      || (polyStyle !== 'solid' && polyStyle !== 'paper')
    ) return new Set<string>()
    const hidden = new Set<string>()
    for (const environment of coordinationAnalysis?.environments ?? []) {
      if (environment.faces.length === 0) continue
      for (const atomId of environment.vertexAtomIds) hidden.add(atomId)
    }
    return hidden
  }, [coordinationAnalysis, polyStyle, showCoordinationPolyhedra])

  const structureGroups = useCrystalStore((s) => s.structureGroups)
  const soloGroupId = useCrystalStore((s) => s.soloGroupId)
  const hiddenGroups = useMemo(
    () => hiddenGroupIds(structureGroups, soloGroupId),
    [structureGroups, soloGroupId],
  )
  const hiddenHydrogens = useMemo(
    () => hiddenHydrogenIds(atoms, { hideHydrogens, keptHydrogens }),
    [atoms, hideHydrogens, keptHydrogens],
  )

  const polyhedronLigandAtomIds = useMemo(() => {
    if (hiddenGroups.size === 0 && hiddenHydrogens.size === 0) return polyhedronLigandAtomIdsBase
    const hidden = new Set(polyhedronLigandAtomIdsBase)
    for (const id of hiddenHydrogens) hidden.add(id)
    for (const atom of atoms) {
      for (const groupId of hiddenGroups) {
        if (atomBelongsToGroup(atom, groupId, structureGroups)) {
          hidden.add(atom.id)
          break
        }
      }
    }
    return hidden
  }, [polyhedronLigandAtomIdsBase, structureGroups, hiddenGroups, hiddenHydrogens, atoms])

  const bonds = useMemo(() => {
    if (hiddenGroups.size === 0 && hiddenHydrogens.size === 0) return allBonds
    return allBonds.filter(
      (bond) => !polyhedronLigandAtomIds.has(bond.atom1Id) && !polyhedronLigandAtomIds.has(bond.atom2Id),
    )
  }, [allBonds, polyhedronLigandAtomIds, hiddenGroups, hiddenHydrogens])

  const massiveSceneHiResPlan = useMemo(() => {
    if (!massiveSceneMode) {
      return {
        enabled: false,
        excludedAtomIds: new Set<string>(),
        meshAtoms: [] as typeof atoms,
        instancedAtoms: [] as typeof atoms,
      }
    }

    const seedIds = selectedAtomIds.size > 0
      ? new Set<string>(selectedAtomIds)
      : massiveSceneVisualFocusAtomIds.size > 0
        ? new Set<string>(massiveSceneVisualFocusAtomIds)
        : new Set<string>(focusedAtomIds)

    if (seedIds.size === 0 || seedIds.size > MASSIVE_SCENE_HIRES_SELECTION_CAP) {
      return {
        enabled: false,
        excludedAtomIds: new Set<string>(),
        meshAtoms: [] as typeof atoms,
        instancedAtoms: [] as typeof atoms,
      }
    }

    const seedAtoms: typeof atoms = []
    let sumX = 0
    let sumY = 0
    let sumZ = 0

    for (const atomId of seedIds) {
      const atom = atomMap.get(atomId)
      if (!atom?.cartesian) continue
      seedAtoms.push(atom)
      sumX += atom.cartesian[0]
      sumY += atom.cartesian[1]
      sumZ += atom.cartesian[2]
    }

    if (seedAtoms.length === 0) {
      return {
        enabled: false,
        excludedAtomIds: new Set<string>(),
        meshAtoms: [] as typeof atoms,
        instancedAtoms: [] as typeof atoms,
      }
    }

    const useVisualCenter = seedAtoms.length === 1 && massiveSceneVisualFocusCenter
    const centerX = useVisualCenter ? massiveSceneVisualFocusCenter[0] : sumX / seedAtoms.length
    const centerY = useVisualCenter ? massiveSceneVisualFocusCenter[1] : sumY / seedAtoms.length
    const centerZ = useVisualCenter ? massiveSceneVisualFocusCenter[2] : sumZ / seedAtoms.length
    const neighborTarget = veryLargeSceneMode
      ? hiResNeighborTargets.veryLargeSceneHiResNeighborCount
      : hiResNeighborTargets.massiveSceneHiResNeighborCount

    let seedRadiusSq = 0
    for (const atom of seedAtoms) {
      if (useVisualCenter) break
      const dx = atom.cartesian![0] - centerX
      const dy = atom.cartesian![1] - centerY
      const dz = atom.cartesian![2] - centerZ
      const distanceSq = dx * dx + dy * dy + dz * dz
      if (distanceSq > seedRadiusSq) {
        seedRadiusSq = distanceSq
      }
    }

    const baseNeighborhoodRadius = Math.max(
      Math.sqrt(seedRadiusSq) * 1.6,
      veryLargeSceneMode ? 6.5 : 8.5,
    )

    const heap = new Float64Array(neighborTarget)
    let heapSize = 0
    const siftUp = (i: number) => {
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (heap[parent] >= heap[i]) break
        const t = heap[parent]; heap[parent] = heap[i]; heap[i] = t
        i = parent
      }
    }
    const siftDown = () => {
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let largest = i
        if (l < heapSize && heap[l] > heap[largest]) largest = l
        if (r < heapSize && heap[r] > heap[largest]) largest = r
        if (largest === i) break
        const t = heap[largest]; heap[largest] = heap[i]; heap[i] = t
        i = largest
      }
    }

    let candidateCount = 0
    for (const atom of atoms) {
      if (!atom.cartesian || seedIds.has(atom.id)) continue
      candidateCount++
      const dx = atom.cartesian[0] - centerX
      const dy = atom.cartesian[1] - centerY
      const dz = atom.cartesian[2] - centerZ
      const distanceSq = dx * dx + dy * dy + dz * dz
      if (heapSize < neighborTarget) {
        heap[heapSize] = distanceSq
        siftUp(heapSize)
        heapSize++
      } else if (distanceSq < heap[0]) {
        heap[0] = distanceSq
        siftDown()
      }
    }

    const expandedRadiusSq = candidateCount >= neighborTarget
      ? Math.max(baseNeighborhoodRadius * baseNeighborhoodRadius, heap[0])
      : baseNeighborhoodRadius * baseNeighborhoodRadius

    const nearbyAtoms: typeof atoms = []
    for (const atom of atoms) {
      if (!atom.cartesian || seedIds.has(atom.id)) continue
      const dx = atom.cartesian[0] - centerX
      const dy = atom.cartesian[1] - centerY
      const dz = atom.cartesian[2] - centerZ
      if (dx * dx + dy * dy + dz * dz <= expandedRadiusSq) nearbyAtoms.push(atom)
    }

    const excludedAtomIds = new Set<string>(seedAtoms.map((atom) => atom.id))
    for (const atom of nearbyAtoms) {
      excludedAtomIds.add(atom.id)
    }

    return {
      enabled: excludedAtomIds.size > 0,
      excludedAtomIds,
      meshAtoms: seedAtoms,
      instancedAtoms: nearbyAtoms,
    }
  }, [
    atomMap,
    atoms,
    focusedAtomIds,
    hiResNeighborTargets,
    massiveSceneMode,
    massiveSceneVisualFocusAtomIds,
    massiveSceneVisualFocusCenter,
    selectedAtomIds,
    veryLargeSceneMode,
  ])

  const massiveSceneBaseAtoms = useMemo(
    () => (massiveSceneHiResPlan.enabled
      ? atoms.filter((atom) => !massiveSceneHiResPlan.excludedAtomIds.has(atom.id))
      : atoms),
    [atoms, massiveSceneHiResPlan],
  )

  const useInstancedRendering = (shouldUseLowDetail || massiveSceneMode) && !shouldUseUltraLow
  const useSolidBoxRendering = shouldUseUltraLow && !isInFocusMode
  const useFocusFastMode = shouldUseUltraLow && isInFocusMode

  const supercellBox = useMemo(() => {
    // Defensive: never crash if latticeVectors is missing (e.g. a molecule with no
    // cell). The box is gated out of rendering elsewhere; we just need safe numbers.
    const { a, b, c } = latticeVectors ?? { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }
    const { nx, ny, nz } = supercellParams

    const corners = []
    for (let i = 0; i <= 1; i++) {
      for (let j = 0; j <= 1; j++) {
        for (let k = 0; k <= 1; k++) {
          const x = i * nx * a[0] + j * ny * b[0] + k * nz * c[0]
          const y = i * nx * a[1] + j * ny * b[1] + k * nz * c[1]
          const z = i * nx * a[2] + j * ny * b[2] + k * nz * c[2]
          corners.push([x, y, z])
        }
      }
    }

    const center = corners.reduce(
      (acc, c) => [acc[0] + c[0] / 8, acc[1] + c[1] / 8, acc[2] + c[2] / 8],
      [0, 0, 0],
    ) as [number, number, number]

    const minX = Math.min(...corners.map((corner) => corner[0]))
    const maxX = Math.max(...corners.map((corner) => corner[0]))
    const minY = Math.min(...corners.map((corner) => corner[1]))
    const maxY = Math.max(...corners.map((corner) => corner[1]))
    const minZ = Math.min(...corners.map((corner) => corner[2]))
    const maxZ = Math.max(...corners.map((corner) => corner[2]))

    return {
      center,
      size: [maxX - minX, maxY - minY, maxZ - minZ] as [number, number, number],
    }
  }, [latticeVectors, supercellParams])

  const { detailAtoms, fastAtoms } = useMemo(() => {
    if (massiveSceneMode) {
      return { detailAtoms: [] as typeof atoms, fastAtoms: atoms }
    }

    const detail: typeof atoms = []
    const fast: typeof atoms = []

    atoms.forEach((atom) => {
      const atomCellKey = atom.cellIndex?.join('-')
      if (atomCellKey && detailCellIndices.has(atomCellKey)) {
        detail.push(atom)
      } else if (atomCellKey && fastCellIndices.has(atomCellKey)) {
        fast.push(atom)
      }
    })

    return { detailAtoms: detail, fastAtoms: fast }
  }, [atoms, detailCellIndices, fastCellIndices, massiveSceneMode])

  const instancedAtoms = useMemo(() => {
    if (useSolidBoxRendering) {
      return fastAtoms
    }
    if (useInstancedRendering) {
      return atoms.filter((atom) => {
        const key = atom.cellIndex?.join('-')
        return !key || !detailCellIndices.has(key)
      })
    }
    return []
  }, [atoms, detailCellIndices, fastAtoms, useInstancedRendering, useSolidBoxRendering])

  const focusedInstancedAtoms = useMemo(
    () => isInFocusMode ? instancedAtoms.filter((atom) => focusedAtomIds.has(atom.id)) : [],
    [focusedAtomIds, instancedAtoms, isInFocusMode],
  )
  const backgroundInstancedAtoms = useMemo(
    () => focusedInstancedAtoms.length > 0
      ? instancedAtoms.filter((atom) => !focusedAtomIds.has(atom.id))
      : instancedAtoms,
    [focusedAtomIds, focusedInstancedAtoms.length, instancedAtoms],
  )
  const focusedAtomOpacity = useCrystalStore((s) => s.focusedAtomOpacity)
  const dimmedRenderOverride = useMemo<LayerRenderOverride>(
    () => ({ ...baseRenderOverride, opacity: focusedAtomOpacity }),
    [baseRenderOverride, focusedAtomOpacity],
  )

  const hyperStickPickOverride = useMemo<LayerRenderOverride>(
    () => ({ ...hyperStickBaseOverride, opacity: 0 }),
    [hyperStickBaseOverride],
  )
  const hyperStickMeshAtoms = useMemo(() => {
    if (viewMode !== 'hyper-stick' || selectedAtomIds.size === 0) return detailAtoms
    const detailIds = new Set(detailAtoms.map((a) => a.id))
    const extra = atoms.filter((a) => selectedAtomIds.has(a.id) && !detailIds.has(a.id))
    return extra.length > 0 ? [...detailAtoms, ...extra] : detailAtoms
  }, [viewMode, atoms, detailAtoms, selectedAtomIds])

  const { detailBonds, fastBonds } = useMemo(() => {
    const detailAtomIds = new Set(detailAtoms.map((atom) => atom.id))
    const fastAtomIds = new Set(fastAtoms.map((atom) => atom.id))
    const detail: typeof bonds = []
    const fast: typeof bonds = []

    bonds.forEach((bond) => {
      const atom1InDetail = detailAtomIds.has(bond.atom1Id)
      const atom2InDetail = detailAtomIds.has(bond.atom2Id)
      const atom1InFast = fastAtomIds.has(bond.atom1Id)
      const atom2InFast = fastAtomIds.has(bond.atom2Id)

      if (atom1InDetail || atom2InDetail) {
        detail.push(bond)
      } else if (atom1InFast || atom2InFast) {
        fast.push(bond)
      }
    })

    return { detailBonds: detail, fastBonds: fast }
  }, [bonds, detailAtoms, fastAtoms])

  const instancedBonds = useMemo(() => {
    if (useSolidBoxRendering) {
      return fastBonds
    }
    if (useInstancedRendering || useFocusFastMode) {
      const detailAtomIds = new Set(detailAtoms.map((atom) => atom.id))
      return bonds.filter((bond) => !detailAtomIds.has(bond.atom1Id) && !detailAtomIds.has(bond.atom2Id))
    }
    return []
  }, [bonds, detailAtoms, fastBonds, useFocusFastMode, useInstancedRendering, useSolidBoxRendering])

  const bondQualityProfile = useMemo(
    () =>
      getAdaptiveBondQualityProfile({
        adaptiveEnabled: adaptivePerformanceEnabled,
        adaptiveLevel: transientAdaptiveLevel,
        bondCount: bonds.length,
      }),
    [adaptivePerformanceEnabled, bonds.length, transientAdaptiveLevel],
  )

  const atomQualityProfile = useMemo(
    () =>
      getAdaptiveAtomQualityProfile({
        adaptiveEnabled: adaptivePerformanceEnabled,
        adaptiveLevel: transientAdaptiveLevel,
        atomCount: atoms.length,
      }),
    [adaptivePerformanceEnabled, atoms.length, transientAdaptiveLevel],
  )

  // Compact mode: render the typed-array bulk via sphere impostors (one draw call,
  // no Atom[] pipeline) + the materialized focus patch via the existing detail path.
  // Must precede the atoms.length===0 guard (store.atoms is empty in compact mode).
  if (compactStructure) {
    // The compact contract is positions/species only and deliberately has no
    // bond topology. The UI and store reject `stick`; retain a hard guard here
    // so future callers cannot silently display a different geometry.
    if (viewMode === 'stick') return null
    const compactViewMode = viewMode === 'hyper-stick' ? 'ball-stick' : viewMode
    return (
      <group>
        <group visible={!hidePrimaryStructure}>
          <CompactAtoms compact={compactStructure} scale={atomScale} viewMode={compactViewMode} visible={!compactRegionOnlyView} playback={compactPlaybackRef} />
          {focusAtoms.map((atom, i) => (
            <AtomMesh key={`focus-${atom.id}-${i}`} atom={atom} viewMode={compactViewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} />
          ))}
          <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>
        <RegionSolids source={compactStructure} playback={compactPlaybackRef} />
      </group>
    )
  }

  if (atoms.length === 0) {
    return null
  }

  // Biomolecules remain in this same CrystalScene/Canvas so capture, clipping,
  // viewport isolation and the canonical camera controller keep working. The
  // base atom/bond mirrors stay mounted only when requested by the bio layer.
  if (bioStructure) {
    return (
      <group>
        {!hidePrimaryStructure && <BiomoleculeLayer />}
        <BiomoleculeDrillGhost />
        <MeasurementVisualization />
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  // The fused preset is intentionally a static, high-quality path. It replaces
  // every atom sphere and bond with one continuous implicit surface while the
  // analytical overlays remain available.
  if (fusedAtomSurface) {
    return (
      <group>
        <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />
        <group visible={!hidePrimaryStructure}>
          <FusedAtomSurface atoms={atoms} elementOverrides={elementOverrides} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>
        <ConstructedPlaneMesh />
        {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
        <BaderLabels />
        <MagmomLabels />
        <TrajectoryVectorField />
        <VoidSurfaceLayer />
        <MolecularOrbitalLayer />
        <SurfaceExtremumMarkers />
        <AtomRingDecoration hiddenAtomIds={polyhedronLigandAtomIds} />
        <MeasurementVisualization />
        {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
        {showCrystalOnlyOverlays && <SymmetryOverlay />}
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  // Semantic crystal layers own one complete presentation pass so replaceBase
  // can subtract both atoms and their bonds without forking renderer logic.
  if (crystalLayers.length > 0) {
    return (
      <group>
        <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />
        <group visible={!hidePrimaryStructure}>
          <CrystalSemanticLayers showBonds={effectiveShowBonds} />
          <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>
        <ConstructedPlaneMesh />
        {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
        <BaderLabels />
        <MagmomLabels />
        <TrajectoryVectorField />
        <VoidSurfaceLayer />
        <MolecularOrbitalLayer />
        <SurfaceExtremumMarkers />
        <AtomRingDecoration hiddenAtomIds={polyhedronLigandAtomIds} />
        <MeasurementVisualization />
        {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
        {showCrystalOnlyOverlays && <SymmetryOverlay />}
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  if (massiveSceneMode) {
    const massiveViewMode = viewMode === 'hyper-stick' ? 'ball-stick' : viewMode
    const massiveRadialSegments = Math.max(4, veryLargeSceneMode ? 5 : atomQualityProfile.instancedRadialSegments)
    const localEnhancedRadialSegments = Math.max(18, massiveRadialSegments + 10)

    return (
      <group>
        <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />

        {/* Phase C: region solids over the massive Atom[] branch */}
        {normalRegionSource && <RegionSolids source={normalRegionSource} />}

        <group visible={!hidePrimaryStructure}>
          {!normalRegionOnlyView && (
            <>
            <InstancedAtoms
              atoms={massiveSceneBaseAtoms}
              hiddenAtomIds={polyhedronLigandAtomIds}
              viewMode={massiveViewMode}
              scale={atomScale}
              radialSegments={massiveRadialSegments}
              renderOverride={isInFocusMode ? dimmedRenderOverride : baseRenderOverride}
            />

            {massiveSceneHiResPlan.instancedAtoms.length > 0 && (
              <InstancedAtoms
                atoms={massiveSceneHiResPlan.instancedAtoms}
                hiddenAtomIds={polyhedronLigandAtomIds}
                viewMode={massiveViewMode}
                scale={atomScale}
                radialSegments={localEnhancedRadialSegments}
                renderOverride={baseRenderOverride}
              />
            )}

            {massiveSceneHiResPlan.meshAtoms.map((atom) => (
              <AtomMesh key={`massive-hq-${atom.id}`} atom={atom} viewMode={massiveViewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
            ))}
            {viewMode === 'stick' && showBonds && bonds.length > 0 && (
              <InstancedBonds
                bonds={bonds}
                atoms={atoms}
                viewMode={massiveViewMode}
                scale={bondScale}
                radialSegments={massiveRadialSegments}
                renderOverride={baseRenderOverride}
              />
            )}
            </>
          )}
          <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>

        <ConstructedPlaneMesh />
        {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
        <BaderLabels />
        <MagmomLabels />
        <TrajectoryVectorField />
        <VoidSurfaceLayer />
        <MeasurementVisualization />
        {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
        {showCrystalOnlyOverlays && <SymmetryOverlay />}
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  if (useSolidBoxRendering) {
    const hasLockedCells = fastCellIndices.size > 0 || detailCellIndices.size > 0

    return (
      <group>
        <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />

        <group visible={!hidePrimaryStructure}>
        <mesh position={supercellBox.center} renderOrder={-1}>
          <boxGeometry args={supercellBox.size} />
          <meshStandardMaterial
            color="#CD7F32"
            roughness={0.3}
            metalness={0.4}
            transparent
            opacity={hasLockedCells ? 0.2 : 0.4}
            side={2}
            depthWrite={false}
          />
        </mesh>

        <mesh position={supercellBox.center} renderOrder={-1}>
          <boxGeometry args={supercellBox.size} />
          <meshBasicMaterial color="#FFD700" wireframe transparent opacity={0.5} depthWrite={false} />
        </mesh>

        {viewMode === 'hyper-stick' && (
          <>
            <HyperStickBonds atoms={atoms} bonds={bonds} atomScale={atomScale} renderOverride={hyperStickBaseOverride} />
            {instancedAtoms.length > 0 && (
              <InstancedAtoms
                atoms={instancedAtoms}
                hiddenAtomIds={polyhedronLigandAtomIds}
                viewMode={viewMode}
                scale={atomScale}
                radialSegments={atomQualityProfile.instancedRadialSegments}
                renderOverride={hyperStickPickOverride}
              />
            )}
            {hyperStickMeshAtoms.map((atom) => (
              <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={hyperStickBaseOverride} />
            ))}
          </>
        )}

        {viewMode !== 'hyper-stick' && fastAtoms.length > 0 && (
          <InstancedAtoms
            atoms={fastAtoms}
            hiddenAtomIds={polyhedronLigandAtomIds}
            viewMode={viewMode}
            scale={atomScale}
            radialSegments={atomQualityProfile.instancedRadialSegments}
            renderOverride={baseRenderOverride}
          />
        )}

        {viewMode !== 'hyper-stick' && fastAtoms.length > 0 && effectiveShowBonds && fastBonds.length > 0 && (
          <InstancedBonds
            bonds={fastBonds}
            atoms={atoms}
            viewMode={viewMode}
            scale={bondScale}
            radialSegments={bondQualityProfile.instancedRadialSegments}
            renderOverride={baseRenderOverride}
          />
        )}

        {viewMode !== 'hyper-stick' && detailAtoms.map((atom) => (
          <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
        ))}

        {viewMode !== 'hyper-stick' && effectiveShowBonds && detailBonds.map((bond) => (
          <BondMesh
            key={bond.id}
            bond={bond}
            atoms={atoms}
            atomMap={atomMap}
            viewMode={viewMode}
            scale={bondScale}
            radialSegments={bondQualityProfile.detailRadialSegments}
            dashedSegmentCount={bondQualityProfile.dashedSegmentCount}
            renderOverride={baseRenderOverride}
          />
        ))}
        <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>

        <ConstructedPlaneMesh />
        {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
        <BaderLabels />
        <MagmomLabels />
        <TrajectoryVectorField />
        <VoidSurfaceLayer />
        <MolecularOrbitalLayer />
        <SurfaceExtremumMarkers />
        <AtomRingDecoration hiddenAtomIds={polyhedronLigandAtomIds} />
        <MeasurementVisualization />
        {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
        {showCrystalOnlyOverlays && <SymmetryOverlay />}
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  if (useFocusFastMode) {
    return (
      <group>
        <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />

        <group visible={!hidePrimaryStructure}>
        {viewMode === 'hyper-stick' && (
          <>
            <HyperStickBonds atoms={atoms} bonds={bonds} atomScale={atomScale} renderOverride={hyperStickBaseOverride} />
            {detailAtoms.map((atom) => (
              <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={hyperStickBaseOverride} />
            ))}
          </>
        )}

        {viewMode !== 'hyper-stick' && atoms.length > 0 && (
          <InstancedAtoms
            atoms={atoms.filter((atom) => {
              const key = atom.cellIndex?.join('-')
              return !key || !detailCellIndices.has(key)
            })}
            hiddenAtomIds={polyhedronLigandAtomIds}
            viewMode={viewMode}
            scale={atomScale}
            radialSegments={atomQualityProfile.instancedRadialSegments}
            renderOverride={baseRenderOverride}
          />
        )}

        {viewMode !== 'hyper-stick' && detailAtoms.map((atom) => (
          <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
        ))}

        {viewMode !== 'hyper-stick' && effectiveShowBonds && (
          <InstancedBonds
            bonds={bonds.filter((bond) => {
              const detailAtomIds = new Set(detailAtoms.map((atom) => atom.id))
              return !detailAtomIds.has(bond.atom1Id) && !detailAtomIds.has(bond.atom2Id)
            })}
            atoms={atoms}
            viewMode={viewMode}
            scale={bondScale}
            radialSegments={bondQualityProfile.instancedRadialSegments}
            renderOverride={baseRenderOverride}
          />
        )}

        {viewMode !== 'hyper-stick' && effectiveShowBonds && detailBonds.map((bond) => (
          <BondMesh
            key={bond.id}
            bond={bond}
            atoms={atoms}
            atomMap={atomMap}
            viewMode={viewMode}
            scale={bondScale}
            radialSegments={bondQualityProfile.detailRadialSegments}
            dashedSegmentCount={bondQualityProfile.dashedSegmentCount}
            renderOverride={baseRenderOverride}
          />
        ))}
        <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
        </group>

        <ConstructedPlaneMesh />
        {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
        <BaderLabels />
        <MagmomLabels />
        <TrajectoryVectorField />
        <VoidSurfaceLayer />
        <MolecularOrbitalLayer />
        <SurfaceExtremumMarkers />
        <AtomRingDecoration hiddenAtomIds={polyhedronLigandAtomIds} />
        <MeasurementVisualization />
        {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
        {showCrystalOnlyOverlays && <SymmetryOverlay />}
        <SelectionRegionPreview />
        <SelectionTransformGizmo />
      </group>
    )
  }

  return (
    <group>
      <LatticeGrid latticeVectors={latticeVectors} supercell={supercellParams} visible={effectiveShowLattice} />

      {/* Phase C: region solids over normal Atom[] structures (junctions / SQS / small polycrystals) */}
      {normalRegionSource && <RegionSolids source={normalRegionSource} />}

      <group visible={!hidePrimaryStructure}>
      {!normalRegionOnlyView && viewMode === 'hyper-stick' && (
        <>
          <HyperStickBonds atoms={atoms} bonds={bonds} atomScale={atomScale} renderOverride={hyperStickBaseOverride} />
          {useInstancedRendering ? (
            <>
              {instancedAtoms.length > 0 && (
                <InstancedAtoms
                  atoms={instancedAtoms}
                  hiddenAtomIds={polyhedronLigandAtomIds}
                  viewMode={viewMode}
                  scale={atomScale}
                  radialSegments={atomQualityProfile.instancedRadialSegments}
                  renderOverride={hyperStickPickOverride}
                />
              )}
              {hyperStickMeshAtoms.map((atom) => (
                <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={hyperStickBaseOverride} />
              ))}
            </>
          ) : (
            atoms.map((atom) => (
              <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={hyperStickBaseOverride} />
            ))
          )}
        </>
      )}

      {!normalRegionOnlyView && viewMode !== 'hyper-stick' && (
        useInstancedRendering ? (
          <>
            {backgroundInstancedAtoms.length > 0 && (
              <InstancedAtoms
                atoms={backgroundInstancedAtoms}
                hiddenAtomIds={polyhedronLigandAtomIds}
                viewMode={viewMode}
                scale={atomScale}
                radialSegments={atomQualityProfile.instancedRadialSegments}
                renderOverride={isInFocusMode ? dimmedRenderOverride : baseRenderOverride}
              />
            )}
            {focusedInstancedAtoms.map((atom) => (
              <AtomMesh key={`focused-instance-${atom.id}`} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
            ))}
            {detailAtoms.map((atom) => (
              <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
            ))}
          </>
        ) : (
          atoms.map((atom) => (
            <AtomMesh key={atom.id} atom={atom} viewMode={viewMode} scale={atomScale} hiddenAtomIds={polyhedronLigandAtomIds} renderOverride={baseRenderOverride} />
          ))
        )
      )}

      {!normalRegionOnlyView && viewMode !== 'hyper-stick' && effectiveShowBonds && (
        useInstancedRendering ? (
          <>
            {instancedBonds.length > 0 && (
              <InstancedBonds
                bonds={instancedBonds}
                atoms={atoms}
                viewMode={viewMode}
                scale={bondScale}
                radialSegments={bondQualityProfile.instancedRadialSegments}
                renderOverride={isInFocusMode ? dimmedRenderOverride : baseRenderOverride}
              />
            )}
            {detailBonds.map((bond) => (
              <BondMesh
                key={bond.id}
                bond={bond}
                atoms={atoms}
                atomMap={atomMap}
                viewMode={viewMode}
                scale={bondScale}
                radialSegments={bondQualityProfile.detailRadialSegments}
                dashedSegmentCount={bondQualityProfile.dashedSegmentCount}
                renderOverride={baseRenderOverride}
              />
            ))}
          </>
        ) : (
          bonds.map((bond) => (
            <BondMesh
              key={bond.id}
              bond={bond}
              atoms={atoms}
              atomMap={atomMap}
              viewMode={viewMode}
              scale={bondScale}
              radialSegments={bondQualityProfile.detailRadialSegments}
              dashedSegmentCount={bondQualityProfile.dashedSegmentCount}
              renderOverride={baseRenderOverride}
            />
          ))
        )
      )}
      <PeriodicImageAtoms viewMode={viewMode === 'hyper-stick' ? 'ball-stick' : viewMode} scale={atomScale} renderOverride={baseRenderOverride} hiddenAtomIds={polyhedronLigandAtomIds} />
          <AtomLabels hiddenAtomIds={polyhedronLigandAtomIds} />
      </group>

      <ConstructedPlaneMesh />
      {!hidePrimaryStructure && <CoordinationPolyhedra analysis={coordinationAnalysis} />}
      <BaderLabels />
      <MagmomLabels />
      <TrajectoryVectorField />
      <VoidSurfaceLayer />
      <MolecularOrbitalLayer />
      <SurfaceExtremumMarkers />
      <AtomRingDecoration hiddenAtomIds={polyhedronLigandAtomIds} />
      <MeasurementVisualization />
      {showCrystalOnlyOverlays && <BrillouinZoneOverlay />}
      {showCrystalOnlyOverlays && <SymmetryOverlay />}
      <SelectionRegionPreview />
      <SelectionTransformGizmo />
    </group>
  )
}
