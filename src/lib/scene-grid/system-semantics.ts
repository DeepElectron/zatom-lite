/**
 * System semantics — what kind of thing is on screen.
 *
 * `scene_grid` tells an agent *where* atoms are; this module tells it *what the
 * scene is*: where the vacuum is, how many layers a slab has, which atoms form
 * one connected unit, and a classification with the evidence spelled out so the
 * agent can disagree with the label instead of trusting it blindly.
 *
 * Pure functions over `ZatomStructure`; no store access.
 */

import type { Vec3, ZatomLattice, ZatomStructure } from '../../agent/contracts'
import { cartesianToFractional, createCertifiedMinimumImageCalculator, enumeratePeriodicImagesWithinCutoff } from '../../agent/structure-math'
import { getMaxBondDistance } from '../crystal/bonds'
import { buildResidueIndex } from './residue-index'
import { MIN_VACUUM_A } from '../analysis/builders/adsorbate'
import { NeighborGrid } from './neighbor-grid'

// ---------------------------------------------------------------------------
// Vacuum
// ---------------------------------------------------------------------------

export interface VacuumAxis {
  axis: 0 | 1 | 2
  /** Largest empty gap along the axis, in Angstrom. */
  gapA: number
  /** Same gap as a fraction of the axis length. */
  gapFrac: number
  /** Extent occupied by atoms along the axis (axis length minus the gap). */
  slabSpanA: number
  /** Fractional coordinate at the middle of the vacuum gap. */
  gapCenterFrac: number
}

const VACUUM_MIN_FRAC = 0.3

/** Perpendicular spacing of one lattice period along the axis plane normal. */
const axisSpacing = (lattice: ZatomLattice, axis: 0 | 1 | 2): number => {
  const [first, second] = ([0, 1, 2] as const).filter((candidate) => candidate !== axis)
  const a = lattice.vectors[0]
  const b = lattice.vectors[1]
  const c = lattice.vectors[2]
  const volume = Math.abs(dot(a, cross(b, c)))
  const u = lattice.vectors[first]
  const v = lattice.vectors[second]
  const area = Math.hypot(...cross(u, v))
  return area > 1e-12 ? volume / area : 0
}

/**
 * A periodic axis is "vacuum" when its largest cyclic gap between atoms is both
 * at least the shared surface threshold and a large share of the perpendicular
 * cell spacing. Both thresholds matter:
 * a 4 A gap in a 5 A cell is bulk spacing, and a 9 A gap in a 60 A cell is a
 * pore, not a surface.
 */
export function detectVacuum(structure: ZatomStructure): VacuumAxis[] {
  const lattice = structure.lattice
  if (!lattice || structure.atoms.length === 0) return []
  const fractional = structure.atoms
    .map((atom) => cartesianToFractional(atom.position, lattice.vectors))
    .filter((f): f is Vec3 => f !== null)
  if (fractional.length === 0) return []
  const out: VacuumAxis[] = []
  for (const axis of [0, 1, 2] as const) {
    const spacing = axisSpacing(lattice, axis)
    if (spacing < 1e-6) continue
    const coords = fractional.map((f) => f[axis] - Math.floor(f[axis])).sort((a, b) => a - b)
    let bestGap = 0
    let bestStart = 0
    for (let i = 0; i < coords.length; i += 1) {
      const next = i + 1 < coords.length ? coords[i + 1] : coords[0] + 1
      const gap = next - coords[i]
      if (gap > bestGap) {
        bestGap = gap
        bestStart = coords[i]
      }
    }
    const gapA = bestGap * spacing
    if (gapA >= MIN_VACUUM_A && bestGap >= VACUUM_MIN_FRAC) {
      const center = bestStart + bestGap / 2
      out.push({
        axis,
        gapA,
        gapFrac: bestGap,
        slabSpanA: spacing - gapA,
        gapCenterFrac: center - Math.floor(center),
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Surface normal + layers
// ---------------------------------------------------------------------------

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normalize = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2])
  return n < 1e-9 ? null : [v[0] / n, v[1] / n, v[2] / n]
}
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Surface normal for a slab-like cell: the normal of the two in-plane lattice
 * vectors, oriented so that +normal points *from atoms into vacuum*. Null when
 * the structure has no lattice or no distinguished out-of-plane axis.
 */
export function resolveSurfaceNormal(
  structure: ZatomStructure,
  vacuum: VacuumAxis[] = detectVacuum(structure),
): { normal: Vec3; axis: 0 | 1 | 2 } | null {
  const lattice = structure.lattice
  if (!lattice) return null
  const aperiodic = ([0, 1, 2] as const).filter((i) => !lattice.periodic[i])
  const axis: 0 | 1 | 2 | null =
    aperiodic.length === 1 ? aperiodic[0] : vacuum.length === 1 ? vacuum[0].axis : null
  if (axis === null) return null
  const inPlane = ([0, 1, 2] as const).filter((i) => i !== axis)
  const n = normalize(cross(lattice.vectors[inPlane[0]], lattice.vectors[inPlane[1]]))
  if (!n) return null
  // Convention: "up" is the +axis direction. In a periodic cell the single
  // vacuum gap touches the atom block from both sides, so there is no
  // geometric "vacuum side" to orient by; the slab builder and the
  // adsorption-site detector both assume +axis, and so does the agent.
  const up: Vec3 = dot(lattice.vectors[axis], n) >= 0 ? n : [-n[0], -n[1], -n[2]]
  return { normal: up, axis }
}

export interface SystemLayer {
  /** 0 = outermost layer on the +normal (vacuum) side. */
  index: number
  /** Mean signed height along the normal, in Angstrom. */
  heightA: number
  atomIds: string[]
  elementCounts: Record<string, number>
}

export interface LayerAnalysis {
  normal: Vec3
  layers: SystemLayer[]
  /** Centre-to-centre gaps between consecutive layers (index i = between layer i and i+1). */
  spacingsA: number[]
}

const countElements = (structure: ZatomStructure, ids: readonly string[]): Record<string, number> => {
  const byId = new Map(structure.atoms.map((a) => [a.id, a.element]))
  const counts: Record<string, number> = {}
  for (const id of ids) {
    const el = byId.get(id)
    if (el) counts[el] = (counts[el] ?? 0) + 1
  }
  return counts
}

/**
 * Single-linkage clustering of atoms along `normal`. Layer 0 is the one closest
 * to vacuum so "top layer", "second layer", "the layer below" map to indices
 * 0, 1, index+1 without further thought.
 */
export function detectLayers(
  structure: ZatomStructure,
  normal: Vec3,
  toleranceA = 0.5,
): LayerAnalysis {
  const unit = normalize(normal)
  if (!unit || structure.atoms.length === 0) return { normal, layers: [], spacingsA: [] }
  const projected = structure.atoms
    .map((atom) => ({ id: atom.id, d: dot(atom.position, unit) }))
    .sort((p, q) => q.d - p.d) // descending: vacuum side first
  const groups: { ids: string[]; sum: number }[] = []
  let previous = Number.NaN
  for (const { id, d } of projected) {
    const current = groups[groups.length - 1]
    if (!current || previous - d > toleranceA) groups.push({ ids: [id], sum: d })
    else {
      current.ids.push(id)
      current.sum += d
    }
    previous = d
  }
  const layers = groups.map((g, index) => ({
    index,
    heightA: g.sum / g.ids.length,
    atomIds: g.ids,
    elementCounts: countElements(structure, g.ids),
  }))
  const spacingsA = layers.slice(1).map((l, i) => layers[i].heightA - l.heightA)
  return { normal: unit, layers, spacingsA }
}

// ---------------------------------------------------------------------------
// Fragments (PBC-aware connected components)
// ---------------------------------------------------------------------------

export interface SystemFragment {
  id: string
  atomIds: string[]
  formula: string
  centroid: Vec3
  /**
  * True when at least one bond in the component closes through a periodic
  * image: the unit is a slab, framework or crystal skeleton rather than a
  * discrete molecule or adsorbate.
  */
  isPeriodicNetwork: boolean
  /** PBC-unwrapped positions for finite fragments; periodic networks stay canonical. */
  unwrappedPositions: Record<string, Vec3>
}

const hillFormula = (counts: Record<string, number>): string => {
  const keys = Object.keys(counts).sort((a, b) => {
    if (a === 'C') return -1
    if (b === 'C') return 1
    if (a === 'H') return -1
    if (b === 'H') return 1
    return a.localeCompare(b)
  })
  return keys.map((k) => (counts[k] === 1 ? k : `${k}${counts[k]}`)).join('')
}

export function detectFragments(structure: ZatomStructure): SystemFragment[] {
  const atoms = structure.atoms
  const n = atoms.length
  if (n === 0) return []
  const index = new Map(atoms.map((a, i) => [a.id, i]))
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  const wrappingEdge = new Set<number>() // root index marker set later

  // Explicit bonds are authoritative for the atoms they touch. Atoms that carry
  // no bond at all (typical for a metal slab built without a bond list) are
  // connected by covalent-radius distance, but only among themselves: a bonded
  // adsorbate sitting 2 A above a bare slab must stay its own fragment, which
  // is exactly the distinction "slab-with-adsorbates" depends on.
  const edges: [number, number][] = []
  const covered = new Uint8Array(n)
  for (const bond of structure.bonds ?? []) {
    const a = index.get(bond.atomIds[0])
    const b = index.get(bond.atomIds[1])
    if (a !== undefined && b !== undefined) {
      edges.push([a, b])
      covered[a] = 1
      covered[b] = 1
    }
  }
  const uncovered: number[] = []
  for (let i = 0; i < n; i += 1) if (!covered[i]) uncovered.push(i)
  // Infer uncovered connectivity with the shared spatial grid. The old O(M²)
  // loop silently stopped at 5,000 atoms, leaving the rest as fake isolated
  // fragments and blocking the browser main thread on much smaller slabs.
  if (uncovered.length > 1) {
    const uncoveredSet = new Set(uncovered)
    const elements = [...new Set(uncovered.map((index) => atoms[index].element))]
    let maximumCutoff = 0
    for (const left of elements) for (const right of elements) {
      maximumCutoff = Math.max(maximumCutoff, getMaxBondDistance(left, right, 0.3))
    }
    const grid = new NeighborGrid(structure, { cutoff: maximumCutoff })
    for (const i of uncovered) {
      for (const hit of grid.neighborsOf(atoms[i].position, undefined, i)) {
        const j = hit.atomIndex
        if (j <= i || !uncoveredSet.has(j)) continue
        const cutoff = getMaxBondDistance(atoms[i].element, atoms[j].element, 0.3)
        if (hit.distance <= cutoff) edges.push([i, j])
      }
    }
  }
  // A component is a periodic network when it bonds to one of its own images:
  // either an edge's shortest image is not the direct one, or a bonded pair
  // has more than one image within bond range (bulk crystals, where every
  // atom sits inside the cell but still bonds across the boundary).
  const lattice = structure.lattice
  const wraps: boolean[] = edges.map(([a, b]) => {
    if (!lattice) return false
    const pa = atoms[a].position
    const pb = atoms[b].position
    const cutoff = getMaxBondDistance(atoms[a].element, atoms[b].element, 0.3)
    const delta: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]
    // One edge crossing a cell boundary is still a finite molecule. It becomes
    // a periodic network only when several images of the same pair are bonded,
    // or when a graph cycle has non-zero lattice winding (checked below).
    return enumeratePeriodicImagesWithinCutoff(delta, lattice, cutoff, 10_000).images.length > 1
  })
  edges.forEach(([a, b]) => union(a, b))
  edges.forEach(([a], k) => {
    if (wraps[k]) wrappingEdge.add(find(a))
  })

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) {
    const root = find(i)
    const list = groups.get(root)
    if (list) list.push(i)
    else groups.set(root, [i])
  }
  const fragments: SystemFragment[] = []
  const adjacency = new Map<number, number[]>()
  for (const [a, b] of edges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b])
    adjacency.set(b, [...(adjacency.get(b) ?? []), a])
  }
  const minimumImage = structure.lattice ? createCertifiedMinimumImageCalculator(structure.lattice) : null
  for (const [root, members] of groups) {
    const ids = members.map((i) => atoms[i].id)
    const counts = countElements(structure, ids)
    const unwrapped = new Map<number, Vec3>()
    let periodicNetwork = wrappingEdge.has(root)
    if (minimumImage && members.length) {
      const memberSet = new Set(members)
      const seed = members[0]
      unwrapped.set(seed, [...atoms[seed].position] as Vec3)
      const queue = [seed]
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const parentIndex = queue[cursor]
        const parentPosition = unwrapped.get(parentIndex)!
        for (const childIndex of adjacency.get(parentIndex) ?? []) {
          if (!memberSet.has(childIndex)) continue
          const rawDelta: Vec3 = [
            atoms[childIndex].position[0] - atoms[parentIndex].position[0],
            atoms[childIndex].position[1] - atoms[parentIndex].position[1],
            atoms[childIndex].position[2] - atoms[parentIndex].position[2],
          ]
          const delta = minimumImage(rawDelta).vector
          const predicted: Vec3 = [
            parentPosition[0] + delta[0],
            parentPosition[1] + delta[1],
            parentPosition[2] + delta[2],
          ]
          const existing = unwrapped.get(childIndex)
          if (existing) {
            if (Math.hypot(
              existing[0] - predicted[0],
              existing[1] - predicted[1],
              existing[2] - predicted[2],
            ) > 0.5) periodicNetwork = true
            continue
          }
          unwrapped.set(childIndex, predicted)
          queue.push(childIndex)
        }
      }
    }
    const unwrappedPositions: Record<string, Vec3> = {}
    const centroid: Vec3 = [0, 0, 0]
    for (const i of members) {
      const position = unwrapped.get(i) ?? atoms[i].position
      unwrappedPositions[atoms[i].id] = [...position] as Vec3
      centroid[0] += position[0]
      centroid[1] += position[1]
      centroid[2] += position[2]
    }
    centroid[0] /= members.length
    centroid[1] /= members.length
    centroid[2] /= members.length
    fragments.push({
      id: '',
      atomIds: ids,
      formula: hillFormula(counts),
      centroid,
      isPeriodicNetwork: periodicNetwork,
      unwrappedPositions,
    })
  }
  // Largest first; ids are positional in that order so "F0" is the host.
  fragments.sort((a, b) => b.atomIds.length - a.atomIds.length || a.formula.localeCompare(b.formula))
  fragments.forEach((f, i) => {
    f.id = `F${i}`
  })
  return fragments
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const SYSTEM_KINDS = [
  'molecule',
  'cluster',
  'biomolecule',
  'crystal',
  'defective-crystal',
  'slab',
  'slab-with-adsorbates',
  '2d-material',
  'interface',
  'unknown',
] as const
export type SystemKind = (typeof SYSTEM_KINDS)[number]

export interface SystemClassification {
  kind: SystemKind
  /** 0..1; how many of the decisive tests agreed. */
  confidence: number
  /** Every test that fired, in the order it was evaluated. */
  evidence: string[]
}

export interface SystemSemantics {
  system: SystemClassification
  vacuum: VacuumAxis[]
  surfaceNormal: Vec3 | null
  layers: LayerAnalysis | null
  fragments: SystemFragment[]
}

export interface ClassifyOptions {
  /** Atom ids the periodic scaffold analysis could not match (defect candidates). */
  unmatchedAtomIds?: readonly string[]
}

/**
 * The structure restricted to periodic-network atoms. Falls back to the whole
 * structure when nothing is periodic (a lone 2D sheet built without bonds may
 * legitimately have no wrapping edge).
 */
export function hostOnly(structure: ZatomStructure, fragments: readonly SystemFragment[]): ZatomStructure {
  const host = new Set(fragments.filter((f) => f.isPeriodicNetwork).flatMap((f) => f.atomIds))
  if (host.size === 0 || host.size === structure.atoms.length) return structure
  return { ...structure, atoms: structure.atoms.filter((a) => host.has(a.id)) }
}

export function analyzeSystem(structure: ZatomStructure, options: ClassifyOptions = {}): SystemSemantics {
  const vacuum = detectVacuum(structure)
  const normalInfo = resolveSurfaceNormal(structure, vacuum)
  const fragments = detectFragments(structure)
  // Layers describe the host: when adsorbates are present they would otherwise
  // claim "layer 0" and shift every slab layer index by one.
  const layers = normalInfo ? detectLayers(hostOnly(structure, fragments), normalInfo.normal) : null
  const evidence: string[] = []
  const atomCount = structure.atoms.length
  const lattice = structure.lattice

  let kind: SystemKind = 'unknown'
  let confidence = 0.5

  if (atomCount === 0) {
    return { system: { kind: 'unknown', confidence: 1, evidence: ['no atoms'] }, vacuum, surfaceNormal: null, layers, fragments }
  }

  if (!lattice) {
    evidence.push('no lattice')
    const residues = buildResidueIndex(structure)
    const polymer = [...residues.residues.values()].some((r) => r.polymerKind !== 'none')
    if (polymer) {
      evidence.push(`${residues.residueCount} residues with polymer identity`)
      kind = 'biomolecule'
      confidence = 0.9
    } else if (atomCount < 200) {
      evidence.push(`${atomCount} atoms < 200`)
      kind = 'molecule'
      confidence = fragments.length === 1 ? 0.9 : 0.7
      if (fragments.length > 1) evidence.push(`${fragments.length} disconnected fragments`)
    } else {
      evidence.push(`${atomCount} atoms without residue identity`)
      kind = 'cluster'
      confidence = 0.7
    }
    return { system: { kind, confidence, evidence }, vacuum, surfaceNormal: null, layers, fragments }
  }

  const periodicCount = lattice.periodic.filter(Boolean).length
  evidence.push(`lattice periodic on ${periodicCount} axes`)
  if (vacuum.length) evidence.push(`vacuum along ${vacuum.map((v) => `${'abc'[v.axis]} (${v.gapA.toFixed(1)} A)`).join(', ')}`)
  const networks = fragments.filter((f) => f.isPeriodicNetwork)
  const discrete = fragments.filter((f) => !f.isPeriodicNetwork)
  evidence.push(`${networks.length} periodic network(s), ${discrete.length} discrete fragment(s)`)

  const aperiodic = lattice.periodic.filter((p) => !p).length
  const openAxes = Math.max(vacuum.length, aperiodic)

  if (openAxes >= 2) {
    evidence.push('two or more open axes: boxed molecule/cluster')
    kind = atomCount < 200 ? 'molecule' : 'cluster'
    confidence = 0.8
  } else if (openAxes === 1) {
    const layerCount = layers?.layers.length ?? 0
    evidence.push(`${layerCount} layer(s) along the surface normal`)
    if (networks.length === 0 && discrete.length > 0 && layerCount <= 2) {
      evidence.push('no periodic network: isolated layer of unbonded atoms')
    }
    if (discrete.length > 0 && networks.length > 0) {
      evidence.push(`${discrete.length} discrete fragment(s) above a periodic network: adsorbates`)
      kind = 'slab-with-adsorbates'
      confidence = 0.9
    } else if (layerCount <= 2) {
      kind = '2d-material'
      confidence = 0.8
    } else {
      kind = 'slab'
      confidence = 0.85
    }
  } else {
    const unmatched = options.unmatchedAtomIds?.length ?? 0
    if (unmatched > 0) {
      evidence.push(`${unmatched} atom(s) break the translation map: defects`)
      kind = 'defective-crystal'
      confidence = 0.75
    } else if (networks.length >= 2 && new Set(networks.map((f) => f.formula)).size >= 2) {
      evidence.push('two periodic networks of different composition: interface')
      kind = 'interface'
      confidence = 0.6
    } else {
      kind = 'crystal'
      confidence = 0.85
    }
  }

  return {
    system: { kind, confidence, evidence },
    vacuum,
    surfaceNormal: normalInfo?.normal ?? null,
    layers,
    fragments,
  }
}
