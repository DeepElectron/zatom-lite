/**
 * Biomolecular rendering and picking layer. Representation ownership comes from
 * the layer composition, while drill and selection overlays preserve element
 * colors and avoid mutating the user's configured base color scheme.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { ConvexGeometry } from 'three-stdlib'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { atomBelongsToGroup, hiddenGroupIds } from '../../../orchestration/slices/structure-groups-slice'
import { exportLegacyPdb } from '../../../lib/biomolecule/pdb-export'
import { parseLegacyPdb } from '../../../lib/biomolecule/pdb'
import { bioChainColor, computeBioAtomColors, computeBioResidueColors } from '../../../lib/biomolecule/coloring'
import { getDefaultCrystalElementVisual } from '../../../lib/render/crystal-visuals'
import { SHADING_MODE_MAP } from '../../../lib/render/stylized-material'
import { resolveBioLayerComposition } from '../../../lib/biomolecule/layer-composition'
import {
  applyBioPickOperation,
  bioPickOperationFromModifiers,
  expandBioPick,
} from '../../../lib/biomolecule/picking'
import { buildBioCartoonGeometry } from '../../../lib/biomolecule/cartoon-geometry'
import {
  bioVdwRadius,
  buildBioSurfaceGeometryFromJob,
  createBioSurfaceWorkerJob,
  type BioSurfaceMeshData,
} from '../../../lib/biomolecule/surface-geometry'
import type {
  BioSurfaceWorkerRequest,
  BioSurfaceWorkerResponse,
} from '../../../lib/biomolecule/surface-worker-types'
import { evaluateBioStyleTrack, evaluateBioVisibility } from '../../../lib/biomolecule/style-track'
import { bioShadingModeToRenderStyle } from '../../../lib/biomolecule/shading'
import { biomoleculePlaceholderDisplayNames, biomoleculeSelectionLabels } from '../../../lib/biomolecule/selection-label'
import { markDoubleClickConsumedBy3D } from '../viewport-grid/double-click-arbiter'
import { drillEmphasisForLevel, fadeUnfocusedColors } from '../../../lib/biomolecule/drill-emphasis'
import {
  bioFocusOpacity,
  bioCartoonOutlineNdcWidth,
  resolveBioAtomicElementRadius,
  resolveBioAtomicGeometry,
} from '../../../lib/biomolecule/atomic-geometry'
import {
  bioBaseChannelAtomSets,
  bioDisulfideAtomPairs,
  bioPocketAtomIndices,
  classifyBioSubsystemAtoms,
} from '../../../lib/biomolecule/subsystems'
import {
  detectBioCandidateInteractions,
  type BioCandidateInteraction,
  type BioCandidateInteractionType,
} from '../../../lib/biomolecule/interactions'
import type {
  BioLayer,
  BioLayerColor,
  BioLayerShadingOverride,
  BioRepresentation,
  BioStructure,
} from '../../../lib/biomolecule/types'
import type { Atom, Bond, ViewMode } from '../../../lib/crystal/types'
import { AtomMesh } from './atom-renderer'
import { BondMesh } from './bond-mesh'
import { InstancedAtoms } from './instanced-atoms'
import { InstancedBonds } from './bond-instances'
import { HyperStickPresentationLayer } from './hyper-stick-bonds'
import { StylizedMaterial } from './stylized-material'
import type { LayerRenderOverride } from './layer-render-override'
import { ViewerLabelSprite, type ViewerLabelItem } from './viewer-label-sprite'
import { BiomoleculeAlignmentGhost } from './biomolecule-alignment-ghost'

type AtomicBioRepresentation = Exclude<BioRepresentation, 'cartoon' | 'surface' | 'coordination-polyhedra'>

const REPRESENTATION_VIEW_MODE: Readonly<Record<AtomicBioRepresentation, ViewMode>> = {
  'ball-and-stick': 'ball-stick',
  'space-filling': 'space-fill',
  sticks: 'ball-stick',
  lines: 'wireframe',
}

const MAX_RENDERED_CANDIDATE_CONTACTS = 2_000

const INTERACTION_SORT_ORDER: Readonly<Record<BioCandidateInteractionType, number>> = {
  'hydrogen-bond-candidate': 0,
  'salt-bridge-candidate': 1,
  'pi-stacking-candidate': 2,
  'hydrophobic-contact-candidate': 3,
}

function BioHullOutline({
  geometry, position, outlineWidth, color, opacity,
}: {
  geometry: THREE.BufferGeometry
  position: [number, number, number]
  outlineWidth: number
  color: string
  opacity: number
}) {
  const invalidate = useThree((state) => state.invalidate)
  const size = useThree((state) => state.size)
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() },
      uWidth: { value: 0 },
      uAspect: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      uniform float uWidth;
      uniform float uAspect;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vec4 clip = projectionMatrix * view;
        // Project a unit step along the normal; the NDC delta gives the screen-space outward direction.
        vec4 clipAhead = projectionMatrix * vec4(view.xyz + normalize(normalMatrix * normal), 1.0);
        // Vertices at the eye plane have unstable NDC and will be clipped, so leave them unexpanded.
        if (clip.w > 1e-5 && clipAhead.w > 1e-5) {
          vec2 delta = clipAhead.xy / clipAhead.w - clip.xy / clip.w;
          // Normalize in pixel-aspect space so outline thickness is uniform on wide viewports.
          vec2 pixelDir = vec2(delta.x * uAspect, delta.y);
          float len = length(pixelDir);
          if (len > 1e-6) {
            pixelDir /= len;
            // Multiply by clip.w to keep the NDC displacement constant under perspective.
            clip.xy += vec2(pixelDir.x / uAspect, pixelDir.y) * uWidth * clip.w;
          }
        }
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }
    `,
    side: THREE.BackSide,
  }), [])
  useEffect(() => {
    material.uniforms.uColor.value.setStyle(color, THREE.NoColorSpace)
    material.uniforms.uWidth.value = bioCartoonOutlineNdcWidth(outlineWidth, size.height)
    material.uniforms.uAspect.value = size.height > 0 ? size.width / size.height : 1
    material.uniforms.uOpacity.value = opacity
    material.transparent = opacity < 1
    material.depthWrite = opacity >= 1
    material.needsUpdate = true
    invalidate()
  }, [color, invalidate, material, opacity, outlineWidth, size])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} position={position} material={material} raycast={() => {}} renderOrder={4} />
}

export function capBioCandidateInteractions(
  interactions: readonly BioCandidateInteraction[],
  limit = MAX_RENDERED_CANDIDATE_CONTACTS,
): { items: BioCandidateInteraction[]; total: number; truncated: number } {
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  const items = [...interactions].sort((left, right) => (
    INTERACTION_SORT_ORDER[left.type] - INTERACTION_SORT_ORDER[right.type]
    || left.distance - right.distance
    || left.atomIndex1 - right.atomIndex1
    || left.atomIndex2 - right.atomIndex2
    || left.residueIndex1 - right.residueIndex1
    || left.residueIndex2 - right.residueIndex2
  )).slice(0, boundedLimit)
  return { items, total: interactions.length, truncated: Math.max(0, interactions.length - items.length) }
}

function renderStyleMode(mode: BioLayerShadingOverride['mode'] | undefined): number | undefined {
  if (!mode) return undefined
  return SHADING_MODE_MAP[bioShadingModeToRenderStyle(mode)]
}

function currentBioStructure(structure: BioStructure, atoms: readonly Atom[]): BioStructure {
  const positions = new Map(atoms.map((atom) => [atom.id, atom.cartesian]))
  let changed = false
  const nextAtoms = structure.atoms.map((atom) => {
    const position = positions.get(atom.id)
    if (!position) return atom
    if (atom.position[0] === position[0] && atom.position[1] === position[1] && atom.position[2] === position[2]) return atom
    changed = true
    return { ...atom, position: [...position] as [number, number, number] }
  })
  if (!changed) return structure
  const nextLigands = structure.ligands.map((ligand) => {
    const centroid: [number, number, number] = [0, 0, 0]
    for (const atomIndex of ligand.atomIndices) {
      const position = nextAtoms[atomIndex]?.position
      if (!position) continue
      centroid[0] += position[0]
      centroid[1] += position[1]
      centroid[2] += position[2]
    }
    const count = Math.max(1, ligand.atomIndices.length)
    return { ...ligand, centroid: [centroid[0] / count, centroid[1] / count, centroid[2] / count] as [number, number, number] }
  })
  return {
    ...structure,
    atoms: nextAtoms,
    ligands: nextLigands,
  }
}

export function visibleBioStructure(
  source: BioStructure | null,
  allAtoms: readonly Atom[],
  hiddenAtomIds: ReadonlySet<string> | null,
): BioStructure | null {
  if (!source) return null
  if (!hiddenAtomIds || hiddenAtomIds.size === 0) return currentBioStructure(source, allAtoms)
  if (source.atoms.every((atom) => hiddenAtomIds.has(atom.id))) return null
  try {
    const positions = new Map<string, [number, number, number]>()
    for (const atom of allAtoms) {
      if (atom.cartesian) positions.set(atom.id, atom.cartesian as [number, number, number])
    }
    const visible = parseLegacyPdb(
      exportLegacyPdb(source, { currentAtomPositions: positions, excludeAtomIds: hiddenAtomIds }),
    )
    return visible.atoms.length > 0 ? visible : null
  } catch {
    return currentBioStructure(source, allAtoms)
  }
}

function layerColors(
  structure: BioStructure,
  color: BioLayerColor,
  inheritedScheme: Parameters<typeof computeBioAtomColors>[1],
) {
  if (color.mode === 'custom') {
    return {
      atoms: new Array(structure.atoms.length).fill(color.value),
      residues: new Array(structure.residues.length).fill(color.value),
    }
  }
  const scheme = color.mode === 'scheme' ? color.scheme : inheritedScheme
  return { atoms: computeBioAtomColors(structure, scheme), residues: computeBioResidueColors(structure, scheme) }
}

function bioLayerColorKey(color: BioLayerColor): string {
  if (color.mode === 'inherit') return 'inherit'
  return color.mode === 'custom' ? `custom:${color.value}` : `scheme:${color.scheme}`
}

function nearestBioAtomIndex(structure: BioStructure, point: THREE.Vector3): number | null {
  let nearest: number | null = null
  let distanceSquared = Infinity
  for (const atom of structure.atoms) {
    const dx = atom.position[0] - point.x
    const dy = atom.position[1] - point.y
    const dz = atom.position[2] - point.z
    const next = dx * dx + dy * dy + dz * dz
    if (next < distanceSquared) {
      nearest = atom.index
      distanceSquared = next
    }
  }
  return nearest
}

function useBioGeometryPick(structure: BioStructure) {
  const selectAtoms = useCrystalStore((state) => state.selectAtoms)
  const focusOnAtoms = useCrystalStore((state) => state.focusOnAtoms)
  const clearFocusedAtoms = useCrystalStore((state) => state.clearFocusedAtoms)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  return useCallback((event: ThreeEvent<MouseEvent>, level: 'residue' | 'molecule') => {
    const state = useCrystalStore.getState()
    if (state.toolMode === 'add-bond') {
      event.stopPropagation()
      const atomIndex = nearestBioAtomIndex(structure, event.point)
      if (atomIndex == null) return
      const atomId = structure.atoms[atomIndex]?.id
      if (!atomId) return
      state.handleBondToolClick(atomId)
      return
    }
    if (state.toolMode === 'delete') {
      event.stopPropagation()
      const atomIndex = nearestBioAtomIndex(structure, event.point)
      if (atomIndex == null) return
      const doomed = expandBioPick(structure, atomIndex, event.nativeEvent.altKey ? 'atom' : level)
      const ids = [...doomed].flatMap((index) => {
        const id = structure.atoms[index]?.id
        return id ? [id] : []
      })
      if (ids.length > 0) state.deleteBioAtoms(new Set(ids))
      return
    }
    if (state.toolMode !== 'select') return
    event.stopPropagation()
    const atomIndex = nearestBioAtomIndex(structure, event.point)
    if (atomIndex == null) return
    const previous = new Set<number>()
    const byId = new Map(structure.atoms.map((atom) => [atom.id, atom.index]))
    for (const id of selectedAtomIds) {
      const index = byId.get(id)
      if (index != null) previous.add(index)
    }
    const operation = bioPickOperationFromModifiers(event.nativeEvent)
    const picked = expandBioPick(structure, atomIndex, event.nativeEvent.altKey ? 'atom' : level)
    const next = applyBioPickOperation(previous, picked, operation)
    const ids = [...next].map((index) => structure.atoms[index]?.id).filter((id): id is string => Boolean(id))
    selectAtoms(ids)
    if (ids.length === 0) clearFocusedAtoms()
    else if (useCrystalStore.getState().autoFocusOnAtom) focusOnAtoms(ids)
  }, [clearFocusedAtoms, focusOnAtoms, selectAtoms, selectedAtomIds, structure])
}

function BioCartoonMesh({
  structure, residueColors, residueIndices, layer, opacity,
}: {
  structure: BioStructure
  residueColors: string[]
  residueIndices: ReadonlySet<number>
  layer: BioLayer
  opacity: number
}) {
  const pick = useBioGeometryPick(structure)
  const measurementMode = useCrystalStore((state) => state.measurementMode)
  const model = useCrystalStore((state) => state.bioCartoonModel)
  const quality = useCrystalStore((state) => state.bioCartoonQuality)
  const smooth = useCrystalStore((state) => state.bioCartoonSmooth)
  const width = useCrystalStore((state) => state.bioRibbonWidth)
  const thickness = useCrystalStore((state) => state.bioRibbonThickness)
  const outline = useCrystalStore((state) => state.outline)
  const outlineWidth = useCrystalStore((state) => state.outlineWidth)
  const outlineColor = useCrystalStore((state) => state.outlineColor)
  const center = useMemo(() => {
    const point: [number, number, number] = [0, 0, 0]
    let count = 0
    for (const residueIndex of residueIndices) {
      const atomIndex = structure.residues[residueIndex]?.representativeAtomIndex
      const position = atomIndex == null ? null : structure.atoms[atomIndex]?.position
      if (!position) continue
      point[0] += position[0]
      point[1] += position[1]
      point[2] += position[2]
      count += 1
    }
    return count > 0
      ? [point[0] / count, point[1] / count, point[2] / count] as [number, number, number]
      : [0, 0, 0] as [number, number, number]
  }, [residueIndices, structure])
  const geometry = useMemo(() => {
    const data = buildBioCartoonGeometry(structure, residueColors, {
      model, quality, smooth, width, thickness,
      residueFilter: (index) => residueIndices.has(index),
    })
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    next.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    next.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return next
  }, [model, quality, residueColors, residueIndices, smooth, structure, thickness, width])
  useEffect(() => () => geometry.dispose(), [geometry])
  if (!geometry.getAttribute('position')?.count) return null
  return (
    <group position={center} scale={layer.scale}>
      <mesh
        geometry={geometry}
        position={[-center[0], -center[1], -center[2]]}
        onClick={measurementMode === 'none' ? (event) => pick(event, 'residue') : undefined}
        onDoubleClick={measurementMode === 'none' ? (event) => { markDoubleClickConsumedBy3D(); pick(event, 'molecule') } : undefined}
      >
        <StylizedMaterial
          color="#ffffff"
          vertexColors
          side={THREE.DoubleSide}
          opacity={opacity}
          transparent={opacity < 1}
          depthWrite={opacity >= 1}
          mode={renderStyleMode(layer.shading?.mode)}
          ambient={layer.shading?.ambient}
          diffuse={layer.shading?.diffuse}
          specularStrength={layer.shading?.specular}
          shininess={layer.shading?.shininess}
          fresnel={layer.shading?.rim}
        />
      </mesh>
      {outline && (
        <BioHullOutline
          geometry={geometry}
          position={[-center[0], -center[1], -center[2]]}
          outlineWidth={outlineWidth}
          color={outlineColor}
          opacity={opacity}
        />
      )}
    </group>
  )
}

function BioSurfaceMesh({ structure, atomIndices, atomColors, layer, opacity }: {
  structure: BioStructure
  atomIndices: number[]
  atomColors: string[]
  layer: BioLayer
  opacity: number
}) {
  const pick = useBioGeometryPick(structure)
  const measurementMode = useCrystalStore((state) => state.measurementMode)
  const spacing = useCrystalStore((state) => state.bioSurfaceSpacing)
  const workerRef = useRef<Worker | null>(null)
  const latestRequestRef = useRef<string | null>(null)
  const requestCounterRef = useRef(0)
  const [result, setResult] = useState<{ data: BioSurfaceMeshData; center: [number, number, number] } | null>(null)
  const job = useMemo(
    () => createBioSurfaceWorkerJob(structure, atomIndices, atomColors, spacing),
    [atomColors, atomIndices, spacing, structure],
  )

  useEffect(() => () => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setResult(null)
    if (!job) {
      latestRequestRef.current = null
      return
    }
    const requestId = `bio-surface:${++requestCounterRef.current}`
    latestRequestRef.current = requestId
    if (typeof Worker === 'undefined') {
      // SSR/test environments have no worker. Browser rendering always takes
      // the worker branch so field construction and marching cubes stay off UI.
      const data = buildBioSurfaceGeometryFromJob(job)
      setResult(data ? { data, center: job.center } : null)
      return
    }
    const worker = new Worker(
      new URL('../../../lib/biomolecule/surface.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerRef.current = worker
    let disposed = false
    const handleMessage = (event: MessageEvent<BioSurfaceWorkerResponse>) => {
      if (disposed || event.data.requestId !== latestRequestRef.current) return
      if (event.data.error) {
        console.error('Biomolecular surface worker failed', event.data.error)
        setResult(null)
      } else {
        setResult(event.data.result ? { data: event.data.result, center: job.center } : null)
      }
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    const handleError = (event: ErrorEvent) => {
      if (disposed || requestId !== latestRequestRef.current) return
      console.error('Biomolecular surface worker failed', event.message)
      setResult(null)
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
    worker.addEventListener('message', handleMessage)
    worker.addEventListener('error', handleError)
    const request: BioSurfaceWorkerRequest = { requestId, job }
    // Keep the compact input buffer owned by React. Strict Mode may replay this
    // effect; only the much larger completed mesh is transferred back.
    worker.postMessage(request)
    return () => {
      disposed = true
      worker.removeEventListener('message', handleMessage)
      worker.removeEventListener('error', handleError)
      if (workerRef.current === worker) {
        worker.terminate()
        workerRef.current = null
      }
    }
  }, [job])
  const geometry = useMemo(() => {
    if (!result) return null
    const { data } = result
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    next.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
    next.setAttribute('color', new THREE.BufferAttribute(data.colors, 3))
    next.setIndex(new THREE.BufferAttribute(data.indices, 1))
    return next
  }, [result])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry || !result) return null
  const center = result.center
  return (
    <group position={center} scale={layer.scale}>
      {/* Presentation-only scaling around the selected atoms' centroid. */}
      <mesh
        geometry={geometry}
        renderOrder={10}
        position={[-center[0], -center[1], -center[2]]}
        onClick={measurementMode === 'none' ? (event) => pick(event, 'residue') : undefined}
        onDoubleClick={measurementMode === 'none' ? (event) => { markDoubleClickConsumedBy3D(); pick(event, 'molecule') } : undefined}
      >
        <StylizedMaterial
          color="#ffffff" vertexColors side={THREE.DoubleSide}
          opacity={opacity} transparent={opacity < 1} depthWrite={opacity >= 1}
          mode={renderStyleMode(layer.shading?.mode)}
          ambient={layer.shading?.ambient} diffuse={layer.shading?.diffuse}
          specularStrength={layer.shading?.specular} shininess={layer.shading?.shininess}
          fresnel={layer.shading?.rim}
        />
      </mesh>
    </group>
  )
}

function AtomicLayer({ structure, atoms, bonds, representation, scale, bondScale, colors, opacity, shading, inheritGlobalGeometry = false, useVdwRadii = false }: {
  structure: BioStructure
  atoms: Atom[]
  bonds: Bond[]
  representation: AtomicBioRepresentation
  scale: number
  bondScale: number
  colors: string[]
  opacity: number
  shading: BioLayerShadingOverride | null
  inheritGlobalGeometry?: boolean
  useVdwRadii?: boolean
}) {
  const viewMode = useCrystalStore((state) => state.viewMode)
  const radiusScale = useCrystalStore((state) => state.radiusScale)
  const sourceBondRadius = useCrystalStore((state) => state.bondRadius)
  const elementOverrides = useCrystalStore((state) => state.elementOverrides)
  const lodThreshold = useCrystalStore((state) => state.lodThreshold)
  const geometryGlobals = useMemo(() => ({
    viewMode,
    radiusScale,
    bondRadius: sourceBondRadius,
    elementOverrides,
  }), [elementOverrides, radiusScale, sourceBondRadius, viewMode])
  const geometry = useMemo(() => resolveBioAtomicGeometry({
    representation: inheritGlobalGeometry ? 'inherit' : representation,
    scale,
    bondScale,
    globals: geometryGlobals,
  }), [bondScale, geometryGlobals, inheritGlobalGeometry, representation, scale])
  const renderViewMode = REPRESENTATION_VIEW_MODE[geometry.representation]
  const selectAtoms = useCrystalStore((state) => state.selectAtoms)
  const focusOnAtoms = useCrystalStore((state) => state.focusOnAtoms)
  const clearFocusedAtoms = useCrystalStore((state) => state.clearFocusedAtoms)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const atomIndexById = useMemo(() => new Map(structure.atoms.map((atom) => [atom.id, atom.index])), [structure])
  const colorByAtomId = useMemo(() => new Map(structure.atoms.map((atom) => [atom.id, colors[atom.index] ?? '#b8bdc7'])), [colors, structure])
  const atomRadiusByAtomId = useMemo(() => new Map(atoms.map((atom) => [
    atom.id,
    useVdwRadii
      ? geometryGlobals.elementOverrides[atom.element]?.radius ?? bioVdwRadius(atom.element)
      : resolveBioAtomicElementRadius(
          geometry,
          atom.element,
          geometryGlobals.elementOverrides[atom.element]?.radius ?? getDefaultCrystalElementVisual(atom.element).radius,
        ),
  ])), [atoms, geometry, geometryGlobals.elementOverrides, useVdwRadii])
  const renderOverride = useMemo<LayerRenderOverride>(() => ({
    colorByAtomId,
    atomScale: scale,
    atomRadiusByAtomId,
    bondRadius: geometry.bondRadius,
    suppressGlobalFocusFade: true,
    opacity,
    mode: renderStyleMode(shading?.mode),
    ambient: shading?.ambient,
    diffuse: shading?.diffuse,
    specularStrength: shading?.specular,
    shininess: shading?.shininess,
    fresnel: shading?.rim,
  }), [atomRadiusByAtomId, colorByAtomId, geometry.bondRadius, opacity, scale, shading])
  const pick = useCallback((event: ThreeEvent<MouseEvent>, atomId: string, level: 'atom' | 'residue' | 'molecule') => {
    const state = useCrystalStore.getState()
    if (state.toolMode === 'add-bond') {
      event.stopPropagation()
      state.handleBondToolClick(atomId)
      return
    }
    if (state.toolMode === 'delete') {
      event.stopPropagation()
      const atomIndex = atomIndexById.get(atomId)
      if (atomIndex == null) return
      const doomed = expandBioPick(structure, atomIndex, event.nativeEvent.altKey ? 'atom' : level)
      const ids = [...doomed].flatMap((index) => {
        const id = structure.atoms[index]?.id
        return id ? [id] : []
      })
      if (ids.length > 0) state.deleteBioAtoms(new Set(ids))
      return
    }
    if (state.toolMode !== 'select') return
    event.stopPropagation()
    const atomIndex = atomIndexById.get(atomId)
    if (atomIndex == null) return
    const previous = new Set<number>()
    for (const selectedId of selectedAtomIds) {
      const selectedIndex = atomIndexById.get(selectedId)
      if (selectedIndex != null) previous.add(selectedIndex)
    }
    const operation = bioPickOperationFromModifiers(event.nativeEvent)
    const expanded = expandBioPick(structure, atomIndex, event.nativeEvent.altKey ? 'atom' : level)
    const next = applyBioPickOperation(previous, expanded, operation)
    const ids = [...next].map((index) => structure.atoms[index]?.id).filter((id): id is string => Boolean(id))
    selectAtoms(ids)
    if (ids.length === 0) clearFocusedAtoms()
    else if (useCrystalStore.getState().autoFocusOnAtom) focusOnAtoms(ids)
  }, [atomIndexById, clearFocusedAtoms, focusOnAtoms, selectAtoms, selectedAtomIds, structure])
  const useInstances = atoms.length > lodThreshold
  if (geometry.hyperStick) {
    return <HyperStickPresentationLayer
      atoms={atoms}
      bonds={bonds}
      atomScale={scale}
      renderOverride={renderOverride}
      onAtomClick={(event, atom) => pick(event, atom.id, 'residue')}
      onAtomDoubleClick={(event, atom) => pick(event, atom.id, 'molecule')}
      atomKeyPrefix="bio-hyper-stick"
    />
  }
  if (useInstances) {
    return <>{geometry.drawAtoms && <InstancedAtoms atoms={atoms} viewMode={renderViewMode} scale={1} renderOverride={renderOverride} onAtomClick={(event, atom) => pick(event, atom.id, 'residue')} onAtomDoubleClick={(event, atom) => pick(event, atom.id, 'molecule')} />}{geometry.drawBonds && <InstancedBonds atoms={atoms} bonds={bonds} viewMode={renderViewMode} scale={1} renderOverride={renderOverride} />}</>
  }
  const atomMap = new Map(atoms.map((atom) => [atom.id, atom]))
  return <>{geometry.drawAtoms && atoms.map((atom) => <AtomMesh key={atom.id} atom={atom} viewMode={renderViewMode} scale={1} renderOverride={renderOverride} onAtomClick={(event) => pick(event, atom.id, 'residue')} onAtomDoubleClick={(event) => pick(event, atom.id, 'molecule')} />)}{geometry.drawBonds && bonds.map((bond) => <BondMesh key={bond.id} atomMap={atomMap} atoms={atoms} bond={bond} viewMode={renderViewMode} scale={1} renderOverride={renderOverride} />)}</>
}

function BioDisulfideBonds({ structure, opacity }: { structure: BioStructure; opacity: number }) {
  const pairs = useMemo(() => bioDisulfideAtomPairs(structure), [structure])
  const cylinders = useMemo(() => pairs.flatMap(([leftIndex, rightIndex]) => {
    const left = structure.atoms[leftIndex]
    const right = structure.atoms[rightIndex]
    if (!left || !right) return []
    const start = new THREE.Vector3(...left.position)
    const end = new THREE.Vector3(...right.position)
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (length < .01) return []
    return [{
      key: `${left.id}:${right.id}`,
      position: start.add(end).multiplyScalar(.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
      length,
    }]
  }), [pairs, structure])
  return <>{cylinders.map((cylinder) => <mesh key={cylinder.key} position={cylinder.position} quaternion={cylinder.quaternion} renderOrder={14}>
    <cylinderGeometry args={[.22, .22, cylinder.length, 10]} />
    <StylizedMaterial color="#e6c229" opacity={opacity} transparent={opacity < 1} depthWrite={opacity >= 1} />
  </mesh>)}</>
}

function CoordinationPolyhedraLayer({ structure, atomIndices, colors, layer, opacity }: {
  structure: BioStructure
  atomIndices: ReadonlySet<number>
  colors: string[]
  layer: BioLayer
  opacity: number
}) {
  const geometries = useMemo(() => {
    const selected = [...atomIndices]
    const result: Array<{ key: string; geometry: ConvexGeometry; color: string }> = []
    for (const centerIndex of selected) {
      const center = structure.atoms[centerIndex]
      if (!center || !['FE', 'ZN', 'MG', 'MN', 'CA', 'CU', 'CO', 'NI'].includes(center.element.toUpperCase())) continue
      // The layer selects coordination centres. Ligands are searched across the
      // whole structure so `element Zn` still produces its surrounding donor
      // geometry without forcing users to hand-expand the selection.
      const vertices = structure.atoms.flatMap((candidate) => {
        const candidateIndex = candidate.index
        if (candidateIndex === centerIndex) return []
        if (!['N', 'O', 'S'].includes(candidate.element.toUpperCase())) return []
        const dx = candidate.position[0] - center.position[0]
        const dy = candidate.position[1] - center.position[1]
        const dz = candidate.position[2] - center.position[2]
        const distance = Math.hypot(dx, dy, dz)
        return distance >= 1.2 && distance <= 3 ? [new THREE.Vector3(...candidate.position)] : []
      })
      if (vertices.length < 4) continue
      try {
        result.push({ key: center.id, geometry: new ConvexGeometry(vertices), color: colors[center.index] ?? '#77bdf0' })
      } catch { /* Degenerate coordination points do not define a polyhedron. */ }
    }
    return result
  }, [atomIndices, colors, structure])
  useEffect(() => () => { for (const entry of geometries) entry.geometry.dispose() }, [geometries])
  return <>{geometries.map((entry) => <mesh key={entry.key} geometry={entry.geometry} renderOrder={9}><StylizedMaterial color={entry.color} opacity={opacity} transparent={opacity < 1} depthWrite={opacity >= 1} side={THREE.DoubleSide} mode={renderStyleMode(layer.shading?.mode)} ambient={layer.shading?.ambient} diffuse={layer.shading?.diffuse} specularStrength={layer.shading?.specular} shininess={layer.shading?.shininess} fresnel={layer.shading?.rim} /></mesh>)}</>
}

function BioVisualLayer({ structure, layer, atomIndexSet, residueIndexSet, currentAtoms, currentBonds, focusActive, focusedOpacity }: {
  structure: BioStructure
  layer: BioLayer
  atomIndexSet: ReadonlySet<number>
  residueIndexSet: ReadonlySet<number>
  currentAtoms: Atom[]
  currentBonds: Bond[]
  focusActive: boolean
  focusedOpacity: number
}) {
  const scheme = useCrystalStore((state) => state.bioColorScheme)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const defaults = useCrystalStore(useShallow((state) => ({
    ambient: state.ambientIntensity, diffuse: state.diffuseIntensity,
    specular: state.specularIntensity, shininess: state.atomShininess, rim: state.rimIntensity,
    lightAmbient: state.lightAmbient, lightKey: state.lightKey,
  })))
  const atomIndices = useMemo(() => [...atomIndexSet], [atomIndexSet])
  const atomIds = useMemo(
    () => new Set(atomIndices.map((index) => structure.atoms[index]?.id).filter((id): id is string => Boolean(id))),
    [atomIndices, structure],
  )
  const atoms = useMemo(() => currentAtoms.filter((atom) => atomIds.has(atom.id)), [atomIds, currentAtoms])
  const bonds = useMemo(
    () => currentBonds.filter((bond) => atomIds.has(bond.atom1Id) && atomIds.has(bond.atom2Id)),
    [atomIds, currentBonds],
  )
  const evaluated = evaluateBioStyleTrack(layer.styleTrack, frame, {
    representation: layer.representation,
    color: layer.color,
    opacity: layer.opacity,
    scale: layer.scale,
    bondScale: layer.bondScale,
    shading: layer.shading,
  }, {
    ambient: defaults.lightAmbient ?? defaults.ambient,
    diffuse: defaults.lightKey ?? defaults.diffuse,
    specular: defaults.specular,
    shininess: defaults.shininess,
    rim: defaults.rim,
  })
  const visible = evaluateBioVisibility(layer.styleTrack, frame, layer.visible)
  const effective = evaluated ? {
    ...layer,
    representation: evaluated.representation ?? layer.representation,
    color: evaluated.color ?? layer.color,
    opacity: evaluated.opacity,
    scale: evaluated.scale,
    bondScale: evaluated.bondScale,
    shading: {
      mode: evaluated.mode, ambient: evaluated.ambient, diffuse: evaluated.diffuse,
      specular: evaluated.specular, shininess: evaluated.shininess, rim: evaluated.rim,
    },
  } : layer
  const colorKey = bioLayerColorKey(effective.color)
  const colors = useMemo(
    () => layerColors(structure, effective.color, scheme),
    // A new evaluated style object is produced each frame. Color arrays should
    // change only when the effective color semantics change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colorKey, scheme, structure],
  )
  if (!visible || atomIndexSet.size === 0) return null
  const opacity = bioFocusOpacity(effective.opacity, focusActive, focusedOpacity)
  if (effective.representation === 'cartoon') return <BioCartoonMesh structure={structure} residueColors={colors.residues} residueIndices={residueIndexSet} layer={effective} opacity={opacity} />
  if (effective.representation === 'surface') return <BioSurfaceMesh structure={structure} atomIndices={atomIndices} atomColors={colors.atoms} layer={effective} opacity={opacity} />
  if (effective.representation === 'coordination-polyhedra') return <CoordinationPolyhedraLayer structure={structure} atomIndices={atomIndexSet} colors={colors.atoms} layer={effective} opacity={opacity} />
  return <AtomicLayer structure={structure} atoms={atoms} bonds={bonds} representation={effective.representation} scale={effective.scale} bondScale={effective.bondScale} colors={colors.atoms} opacity={opacity} shading={effective.shading} />
}

function BioLabels({ structure }: { structure: BioStructure }) {
  const chainLabels = useCrystalStore((state) => state.bioShowChainLabels)
  const termini = useCrystalStore((state) => state.bioShowTerminiLabels)
  const ligandLabels = useCrystalStore((state) => state.bioShowLigandLabels)
  const interval = useCrystalStore((state) => state.bioResidueLabelInterval)
  const size = useCrystalStore((state) => state.bioLabelSize)
  const color = useCrystalStore((state) => state.bioLabelColor)
  const background = useCrystalStore((state) => state.background)
  const labels = useMemo(() => {
    const items: BioLabelItem[] = []
    if (chainLabels) for (const chain of structure.chains) {
      if (chain.polymerType === 'other') continue
      const points = chain.residueIndices.flatMap((index) => {
        const atomIndex = structure.residues[index].representativeAtomIndex
        return atomIndex == null ? [] : [structure.atoms[atomIndex].position]
      })
      if (!points.length) continue
      items.push({ key: `chain-${chain.id}`, text: chain.identifier || '∅', position: [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length, points.reduce((s, p) => s + p[2], 0) / points.length], scale: 2.2, bold: true, color: bioChainColor(chain.index) })
    }
    if (termini) for (const chain of structure.chains) {
      if (chain.polymerType === 'other') continue
      const trace = chain.residueIndices.filter((index) => structure.residues[index].representativeAtomIndex != null)
      if (trace.length < 2) continue
      const first = structure.atoms[structure.residues[trace[0]].representativeAtomIndex!].position
      const last = structure.atoms[structure.residues[trace[trace.length - 1]].representativeAtomIndex!].position
      const [start, end] = chain.polymerType === 'nucleic' ? ["5′", "3′"] : ['N', 'C']
      const suffix = structure.chains.length > 1
        ? `(${chain.identifier || '∅'})`
        : ''
      items.push(
        { key: `start-${chain.id}`, text: `${start}${suffix}`, position: [first[0], first[1] + 1.2, first[2]], scale: 1.4, bold: true, color },
        { key: `end-${chain.id}`, text: `${end}${suffix}`, position: [last[0], last[1] + 1.2, last[2]], scale: 1.4, bold: true, color },
      )
    }
    if (ligandLabels) for (const ligand of structure.ligands) items.push({ key: ligand.id, text: ligand.name, position: [ligand.centroid[0], ligand.centroid[1] + 1.6, ligand.centroid[2]], scale: 1.3, bold: true, color })
    if (interval > 0) for (const residue of structure.residues) {
      if (!residue.isStandard || residue.representativeAtomIndex == null || residue.identity.sequenceNumber % interval !== 0) continue
      const position = structure.atoms[residue.representativeAtomIndex].position
      items.push({ key: residue.id, text: `${residue.name}${residue.identity.sequenceNumber}${residue.identity.insertionCode}`, position: [position[0], position[1] + .9, position[2]], scale: .85, bold: false, color })
    }
    return items
  }, [chainLabels, color, interval, ligandLabels, structure, termini])
  const adaptiveSize = Math.max(.7, structure.radius * .045) * size
  return <>{labels.map((label) => <ViewerLabelSprite key={label.key} item={label} baseSize={adaptiveSize} outlineColor={background} />)}</>
}

function BioSelectionLabels({
  structure,
  selectedAtomIds,
}: {
  structure: BioStructure
  selectedAtomIds: ReadonlySet<string>
}) {
  const size = useCrystalStore((state) => state.bioLabelSize)
  const color = useCrystalStore((state) => state.bioLabelColor)
  const background = useCrystalStore((state) => state.background)
  const showAtomDetails = useCrystalStore((state) => state.bioShowSelectedAtomDetails)
  const selectionGroups = useCrystalStore((state) => state.structureGroups)
  const displayNames = useMemo(
    () => biomoleculePlaceholderDisplayNames(structure, selectionGroups),
    [structure, selectionGroups],
  )
  const labels = useMemo(() => biomoleculeSelectionLabels(
    structure,
    selectedAtomIds,
    showAtomDetails,
    displayNames,
  ).map((label) => ({ ...label, position: [...label.position] as [number, number, number], scale: 1, bold: true, color })), [color, displayNames, selectedAtomIds, showAtomDetails, structure])
  const adaptiveSize = Math.max(.62, Math.min(1.15, structure.radius * .035)) * size
  return <group name="biomolecule-selection-labels">{labels.map((label) => (
    <ViewerLabelSprite key={label.key} item={label} baseSize={adaptiveSize} outlineColor={background} />
  ))}</group>
}

interface BioLabelItem extends ViewerLabelItem {
  key: string
  scale: number
  bold: boolean
}

const INTERACTION_COLOR: Record<BioCandidateInteractionType, string> = {
  'hydrogen-bond-candidate': '#38bdf8',
  'salt-bridge-candidate': '#f59e0b',
  'pi-stacking-candidate': '#a78bfa',
  'hydrophobic-contact-candidate': '#9ca3af',
}

export function CandidateDashGroup({ items, color }: { items: Array<Pick<BioCandidateInteraction, 'start' | 'end'>>; color: string }) {
  const geometry = useMemo(() => new THREE.CylinderGeometry(.05, .05, 1, 6, 1, true), [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false }), [color])
  const object = useMemo(() => {
    const segments: { position: THREE.Vector3; quaternion: THREE.Quaternion; length: number }[] = []
    const up = new THREE.Vector3(0, 1, 0)
    for (const item of items) {
      const start = new THREE.Vector3(...item.start)
      const end = new THREE.Vector3(...item.end)
      const direction = end.clone().sub(start)
      const length = direction.length()
      if (length < .1) continue
      direction.normalize()
      const dash = .28
      const gap = .2
      const count = Math.max(2, Math.floor(length / (dash + gap)))
      const used = count * dash + (count - 1) * gap
      let along = (length - used) / 2 + dash / 2
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction)
      for (let index = 0; index < count; index += 1) {
        segments.push({ position: start.clone().addScaledVector(direction, along), quaternion, length: dash })
        along += dash + gap
      }
    }
    const mesh = new THREE.InstancedMesh(geometry, material, segments.length)
    const matrix = new THREE.Matrix4()
    for (let index = 0; index < segments.length; index += 1) {
      matrix.compose(segments[index].position, segments[index].quaternion, new THREE.Vector3(1, segments[index].length, 1))
      mesh.setMatrixAt(index, matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 25
    return mesh
  }, [geometry, items, material])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  return <primitive object={object} />
}

function BioCandidateInteractions({ structure }: { structure: BioStructure }) {
  const panelEnabled = useCrystalStore((state) => state.bioShowInteractions)
  const contactsToolActive = useCrystalStore((state) => state.toolMode === 'add-bond' && state.bondToolSubmode === 'contacts')
  const enabled = panelEnabled || contactsToolActive
  const hbond = useCrystalStore((state) => state.bioInteractionHBond)
  const salt = useCrystalStore((state) => state.bioInteractionSaltBridge)
  const pi = useCrystalStore((state) => state.bioInteractionPiStacking)
  const hydrophobic = useCrystalStore((state) => state.bioInteractionHydrophobic)
  const panelScope = useCrystalStore((state) => state.bioInteractionScope)
  const labels = useCrystalStore((state) => state.bioInteractionLabels)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const scope = contactsToolActive ? 'all' as const : panelScope
  const detected = useMemo(() => enabled ? detectBioCandidateInteractions(structure, {
    hydrogenBonds: hbond, saltBridges: salt, piStacking: pi,
    hydrophobicContacts: hydrophobic, scope,
  }) : [], [enabled, hbond, hydrophobic, pi, salt, scope, structure])
  const scoped = useMemo(() => {
    if (selectedAtomIds.size === 0) return detected
    const selectedIndices = new Set<number>()
    for (const atom of structure.atoms) {
      if (selectedAtomIds.has(atom.id)) selectedIndices.add(atom.index)
    }
    if (selectedIndices.size === 0) return detected
    return detected.filter((item) =>
      selectedIndices.has(item.atomIndex1) || selectedIndices.has(item.atomIndex2))
  }, [detected, selectedAtomIds, structure])
  const interactions = useMemo(() => capBioCandidateInteractions(scoped), [scoped])
  const grouped = useMemo(() => {
    const result = new Map<BioCandidateInteractionType, BioCandidateInteraction[]>()
    for (const item of interactions.items) {
      const bucket = result.get(item.type)
      if (bucket) bucket.push(item)
      else result.set(item.type, [item])
    }
    return result
  }, [interactions])
  return <group>
    {[...grouped].map(([type, items]) => <CandidateDashGroup key={type} items={items} color={INTERACTION_COLOR[type]} />)}
    {labels && interactions.items.slice(0, 120).map((item, index) => (
      <ViewerLabelSprite
        key={`${item.type}-${index}`}
        item={{
          text: `${item.distance.toFixed(1)}Å`,
          position: [(item.start[0] + item.end[0]) / 2, (item.start[1] + item.end[1]) / 2, (item.start[2] + item.end[2]) / 2],
          scale: 1,
          bold: true,
          color: INTERACTION_COLOR[item.type],
        }}
        baseSize={Math.max(.6, structure.radius * .02)}
        outlineColor="#ffffff"
      />
    ))}
    {interactions.truncated > 0 && (
      <Html position={structure.center as [number, number, number]} center style={{ pointerEvents: 'none' }}>
        <span className="rounded px-1.5 py-1 text-[9px] font-medium" style={{ color: 'var(--status-amber)', background: 'var(--glass-bg)', border: '1px solid var(--status-amber-border)' }}>
          Showing {interactions.items.length.toLocaleString()} of {interactions.total.toLocaleString()} candidate contacts
        </span>
      </Html>
    )}
  </group>
}

function BiomoleculePresentation({ structure, currentAtoms }: {
  structure: BioStructure
  currentAtoms: Atom[]
}) {
  const layers = useCrystalStore((state) => state.bioLayers)
  const currentBonds = useCrystalStore((state) => state.bonds)
  const colorScheme = useCrystalStore((state) => state.bioColorScheme)
  const baseSettings = useCrystalStore(useShallow((state) => ({
    showCartoon: state.bioShowCartoon,
    showSticks: state.bioShowSticks,
    showSpacefill: state.bioShowSpacefill,
    showSurface: state.bioShowSurface,
    surfaceOpacity: state.bioSurfaceOpacity,
    polymerRepresentation: state.bioPolymerRepresentation,
    polymerColor: state.bioPolymerColor,
    polymerScale: state.bioPolymerScale,
  })))
  const subsystemSettings = useCrystalStore(useShallow((state) => ({
    showLigand: state.bioShowLigand,
    ligandRepresentation: state.bioLigandRepresentation,
    ligandColor: state.bioLigandColor,
    ligandScale: state.bioLigandScale,
    showIons: state.bioShowIons,
    ionRepresentation: state.bioIonRepresentation,
    ionColor: state.bioIonColor,
    ionScale: state.bioIonScale,
    showPocket: state.bioShowPocket,
    pocketRadius: state.bioPocketRadius,
    pocketRepresentation: state.bioPocketRepresentation,
    pocketColor: state.bioPocketColor,
    pocketScale: state.bioPocketScale,
    hideWater: state.bioHideWater,
    showSSBonds: state.bioShowSSBonds,
  })))
  const focusedAtomOpacity = useCrystalStore((state) => state.focusedAtomOpacity)
  const selectedAtomIds = useCrystalStore((state) => state.selectedAtomIds)
  const focusedAtomIds = useCrystalStore((state) => state.focusedAtomIds)
  const drillLevel = useCrystalStore((state) => state.bioDrillLevel)
  const background = useCrystalStore((state) => state.background)
  const frame = useCrystalStore((state) => state.presentationFrame)
  const presentationPlaying = useCrystalStore((state) => state.presentationPlaying)
  const composition = useMemo(
    () => resolveBioLayerComposition(structure, layers, frame),
    [frame, layers, structure],
  )
  const claimedLayerAtomIndices = composition.claimedAtomIndices
  const polymerRepresentation: AtomicBioRepresentation = baseSettings.polymerRepresentation === 'inherit'
    ? 'ball-and-stick'
    : baseSettings.polymerRepresentation
  const classified = useMemo(() => classifyBioSubsystemAtoms(structure), [structure])
  const baseChannels = useMemo(
    () => bioBaseChannelAtomSets(classified, subsystemSettings.hideWater),
    [classified, subsystemSettings.hideWater],
  )
  const ligandIndices = useMemo(() => subsystemSettings.showLigand
    ? new Set([...classified.ligand].filter((index) => !claimedLayerAtomIndices.has(index)))
    : new Set<number>(), [claimedLayerAtomIndices, classified.ligand, subsystemSettings.showLigand])
  const ionIndices = useMemo(() => subsystemSettings.showIons
    ? new Set([...classified.ion].filter((index) => !claimedLayerAtomIndices.has(index)))
    : new Set<number>(), [claimedLayerAtomIndices, classified.ion, subsystemSettings.showIons])
  const pocketIndices = useMemo(() => subsystemSettings.showPocket
    ? new Set([...bioPocketAtomIndices(structure, classified.ligand, subsystemSettings.pocketRadius)]
      .filter((index) => !claimedLayerAtomIndices.has(index)))
    : new Set<number>(), [claimedLayerAtomIndices, classified.ligand, structure, subsystemSettings.pocketRadius, subsystemSettings.showPocket])
  const polymerAtomIndices = useMemo(
    () => [...baseChannels.polymer].filter((index) => !claimedLayerAtomIndices.has(index)),
    [baseChannels.polymer, claimedLayerAtomIndices],
  )
  const atomicBaseIndices = useMemo(
    () => [...baseChannels.atomic].filter((index) => !claimedLayerAtomIndices.has(index)),
    [baseChannels.atomic, claimedLayerAtomIndices],
  )
  const claimedLayerResidueIndices = composition.claimedResidueIndices
  const baseResidues = useMemo(() => new Set(structure.residues.flatMap((residue) => (
    residue.isStandard && !claimedLayerResidueIndices.has(residue.index)
      ? [residue.index]
      : []
  ))), [claimedLayerResidueIndices, structure])
  const atomicBaseAtomIds = useMemo(
    () => new Set(atomicBaseIndices.map((index) => structure.atoms[index]?.id).filter((id): id is string => Boolean(id))),
    [atomicBaseIndices, structure],
  )
  const atomicBaseAtoms = useMemo(() => currentAtoms.filter((atom) => atomicBaseAtomIds.has(atom.id)), [atomicBaseAtomIds, currentAtoms])
  const atomicBaseBonds = useMemo(
    () => currentBonds.filter((bond) => atomicBaseAtomIds.has(bond.atom1Id) && atomicBaseAtomIds.has(bond.atom2Id)),
    [atomicBaseAtomIds, currentBonds],
  )
  const emphasis = drillEmphasisForLevel(drillLevel)
  const focusedResidueIndices = useMemo(() => {
    if (!emphasis.fadeOthers || focusedAtomIds.size === 0) return null
    const focused = new Set<number>()
    for (const residue of structure.residues) {
      for (const atomIndex of residue.atomIndices) {
        const id = structure.atoms[atomIndex]?.id
        if (id !== undefined && focusedAtomIds.has(id)) {
          focused.add(residue.index)
          break
        }
      }
    }
    return focused
  }, [emphasis.fadeOthers, focusedAtomIds, structure])
  const fadeActive = focusedResidueIndices !== null
    && !presentationPlaying
    && focusedAtomIds.size < currentAtoms.length
  const fadeKeep = Math.min(focusedAtomOpacity, .16)
  const fadeAtoms = useCallback((atomColors: string[]) => (
    fadeActive
      ? fadeUnfocusedColors(atomColors, background, fadeKeep, (index) => {
        const id = structure.atoms[index]?.id
        return id !== undefined && focusedAtomIds.has(id)
      })
      : atomColors
  ), [background, fadeActive, fadeKeep, focusedAtomIds, structure])
  const colors = useMemo(() => {
    const base = layerColors(structure, { mode: 'scheme', scheme: colorScheme }, colorScheme)
    if (!fadeActive || !focusedResidueIndices) return base
    return {
      atoms: fadeAtoms(base.atoms),
      residues: fadeUnfocusedColors(base.residues, background, fadeKeep, (index) => focusedResidueIndices.has(index)),
    }
  }, [background, colorScheme, fadeActive, fadeAtoms, fadeKeep, focusedResidueIndices, structure])
  const subsystem = useCallback((indices: ReadonlySet<number>, color: BioLayerColor) => {
    const atomIds = new Set([...indices].map((index) => structure.atoms[index]?.id).filter((id): id is string => Boolean(id)))
    return {
      atoms: currentAtoms.filter((atom) => atomIds.has(atom.id)),
      bonds: currentBonds.filter((bond) => atomIds.has(bond.atom1Id) && atomIds.has(bond.atom2Id)),
      colors: fadeAtoms(layerColors(structure, color, colorScheme).atoms),
    }
  }, [colorScheme, currentAtoms, currentBonds, fadeAtoms, structure])
  const ligand = useMemo(() => subsystem(ligandIndices, subsystemSettings.ligandColor), [ligandIndices, subsystem, subsystemSettings.ligandColor])
  const ions = useMemo(() => subsystem(ionIndices, subsystemSettings.ionColor), [ionIndices, subsystem, subsystemSettings.ionColor])
  const pocket = useMemo(() => subsystem(pocketIndices, subsystemSettings.pocketColor), [pocketIndices, subsystem, subsystemSettings.pocketColor])
  const polymer = useMemo(() => subsystem(new Set(atomicBaseIndices), baseSettings.polymerColor), [atomicBaseIndices, baseSettings.polymerColor, subsystem])
  const cartoonLayer: BioLayer = { id: 'bio-cartoon-base', name: 'Cartoon base', selection: 'protein or nucleic', representation: 'cartoon', color: { mode: 'inherit' }, visible: baseSettings.showCartoon, opacity: 1, scale: 1, bondScale: 1, shading: null, materialPresetId: null }
  const surfaceLayer: BioLayer = { id: 'bio-surface-base', name: 'Surface base', selection: 'protein or nucleic', representation: 'surface', color: { mode: 'inherit' }, visible: baseSettings.showSurface, opacity: baseSettings.surfaceOpacity, scale: 1, bondScale: 1, shading: null, materialPresetId: null }
  const selectedAtoms = useMemo(() => currentAtoms.filter((atom) => selectedAtomIds.has(atom.id)), [currentAtoms, selectedAtomIds])
  const selectedBonds = useMemo(
    () => currentBonds.filter((bond) => selectedAtomIds.has(bond.atom1Id) && selectedAtomIds.has(bond.atom2Id)),
    [currentBonds, selectedAtomIds],
  )
  const emphasisAtoms = useMemo(
    () => emphasis.overlay ? currentAtoms.filter((atom) => focusedAtomIds.has(atom.id)) : [],
    [currentAtoms, emphasis.overlay, focusedAtomIds],
  )
  const emphasisBonds = useMemo(
    () => emphasis.overlay
      ? currentBonds.filter((bond) => focusedAtomIds.has(bond.atom1Id) && focusedAtomIds.has(bond.atom2Id))
      : [],
    [currentBonds, emphasis.overlay, focusedAtomIds],
  )
  const elementColors = useMemo(() => computeBioAtomColors(structure, 'element'), [structure])
  // Selection is an editing affordance, not presentation content. During
  // playback it must not dim or cover the material being authored.
  const focusActive = selectedAtoms.length > 0 && !presentationPlaying
  const focusOpacity = focusActive ? Math.min(focusedAtomOpacity, .16) : 1
  return <group>
    {baseSettings.showCartoon && <BioCartoonMesh structure={structure} residueColors={colors.residues} residueIndices={baseResidues} layer={cartoonLayer} opacity={focusOpacity} />}
    {baseSettings.showSticks && <AtomicLayer structure={structure} atoms={polymer.atoms} bonds={polymer.bonds} representation={polymerRepresentation} inheritGlobalGeometry={baseSettings.polymerRepresentation === 'inherit'} scale={baseSettings.polymerScale} bondScale={baseSettings.polymerScale} colors={polymer.colors} opacity={focusOpacity} shading={null} />}
    {baseSettings.showSpacefill && <AtomicLayer structure={structure} atoms={atomicBaseAtoms} bonds={atomicBaseBonds} representation="space-filling" useVdwRadii scale={1} bondScale={1} colors={colors.atoms} opacity={focusOpacity} shading={null} />}
    {baseSettings.showSurface && <BioSurfaceMesh structure={structure} atomIndices={polymerAtomIndices} atomColors={colors.atoms} layer={surfaceLayer} opacity={bioFocusOpacity(baseSettings.surfaceOpacity, focusActive, focusOpacity)} />}
    {ligand.atoms.length > 0 && <AtomicLayer structure={structure} atoms={ligand.atoms} bonds={ligand.bonds} representation={subsystemSettings.ligandRepresentation} scale={subsystemSettings.ligandScale} bondScale={subsystemSettings.ligandScale} colors={ligand.colors} opacity={focusOpacity} shading={null} />}
    {ions.atoms.length > 0 && <AtomicLayer structure={structure} atoms={ions.atoms} bonds={ions.bonds} representation={subsystemSettings.ionRepresentation} scale={subsystemSettings.ionScale} bondScale={subsystemSettings.ionScale} colors={ions.colors} opacity={focusOpacity} shading={null} />}
    {pocket.atoms.length > 0 && <AtomicLayer structure={structure} atoms={pocket.atoms} bonds={pocket.bonds} representation={subsystemSettings.pocketRepresentation} scale={subsystemSettings.pocketScale} bondScale={subsystemSettings.pocketScale} colors={pocket.colors} opacity={focusOpacity} shading={null} />}
    {subsystemSettings.showSSBonds && <BioDisulfideBonds structure={structure} opacity={focusOpacity} />}
    {[...layers].reverse().map((layer) => <BioVisualLayer
      key={layer.id}
      structure={structure}
      layer={layer}
      atomIndexSet={composition.layerAtomIndices.get(layer.id) ?? new Set<number>()}
      residueIndexSet={composition.layerResidueIndices.get(layer.id) ?? new Set<number>()}
          currentAtoms={currentAtoms}
          currentBonds={currentBonds}
          focusActive={false}
          focusedOpacity={focusOpacity}
        />)}
    {emphasis.overlay && emphasisAtoms.length > 0 && <AtomicLayer structure={structure} atoms={emphasisAtoms} bonds={emphasisBonds} representation={emphasis.overlay} scale={1} bondScale={1} colors={elementColors} opacity={1} shading={null} />}
    {/* Redraw selected atoms at full element color and add a translucent amber selection halo. */}
    {selectedAtoms.length > 0 && !presentationPlaying && <AtomicLayer structure={structure} atoms={selectedAtoms} bonds={selectedBonds} representation="ball-and-stick" scale={1} bondScale={1} colors={elementColors} opacity={1} shading={null} />}
    {selectedAtoms.length > 0 && !presentationPlaying && <BioSelectionHalo atoms={selectedAtoms} />}
    {selectedAtoms.length > 0 && !presentationPlaying && <BioSelectionLabels structure={structure} selectedAtomIds={selectedAtomIds} />}
    <BiomoleculeAlignmentGhost />
    <BioCandidateInteractions structure={structure} />
    <BioLabels structure={structure} />
  </group>
}

const BIO_SELECTION_HALO_COLOR = new THREE.Color('#f59e0b')

function BioSelectionHalo({ atoms }: { atoms: readonly Atom[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    atoms.forEach((atom, i) => {
      const c = atom.cartesian ?? [0, 0, 0]
      const radius = Math.max(getDefaultCrystalElementVisual(atom.element).radius * 0.5, 0.3) * 1.3
      matrix.makeScale(radius, radius, radius)
      matrix.setPosition(c[0], c[1], c[2])
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = atoms.length
  }, [atoms])
  if (atoms.length === 0) return null
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, atoms.length]} renderOrder={20} frustumCulled={false}>
      <sphereGeometry args={[1, 20, 20]} />
      <meshBasicMaterial
        color={BIO_SELECTION_HALO_COLOR}
        transparent
        opacity={0.3}
        depthWrite={false}
        side={THREE.BackSide}
      />
    </instancedMesh>
  )
}

export function BiomoleculeLayer() {
  const source = useCrystalStore((state) => state.bioStructure)
  const allAtoms = useCrystalStore((state) => state.atoms)
  const structureGroups = useCrystalStore((state) => state.structureGroups)
  const soloGroupId = useCrystalStore((state) => state.soloGroupId)

  const hiddenAtomIds = useMemo(() => {
    const hidden = hiddenGroupIds(structureGroups, soloGroupId)
    if (hidden.size === 0) return null
    const ids = new Set<string>()
    for (const atom of allAtoms) {
      for (const groupId of hidden) {
        if (atomBelongsToGroup(atom, groupId, structureGroups)) {
          ids.add(atom.id)
          break
        }
      }
    }
    return ids.size > 0 ? ids : null
  }, [allAtoms, structureGroups, soloGroupId])

  const currentAtoms = useMemo(
    () => hiddenAtomIds ? allAtoms.filter((atom) => !hiddenAtomIds.has(atom.id)) : allAtoms,
    [allAtoms, hiddenAtomIds],
  )

  const structure = useMemo(
    () => visibleBioStructure(source, allAtoms, hiddenAtomIds),
    [source, allAtoms, hiddenAtomIds],
  )

  if (!structure) return null
  return <BiomoleculePresentation structure={structure} currentAtoms={currentAtoms} />
}
