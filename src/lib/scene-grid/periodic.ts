/**
 * Periodic scaffold analysis — how much of a periodic scene is redundant, and
 * where that redundancy breaks.
 *
 * `site-deviation.ts` answers "which atoms depart from bulk coordination". This
 * module answers the complementary question the periodic regime needs first:
 * *at what scale does this scene repeat?* A 4x4x4 supercell of fcc Cu is 256
 * atoms carrying one cell of information; telling the model "this repeats 4x4x4"
 * converts a wall of identical symbols into a single fact plus its exceptions.
 *
 * Two things fall out of one mechanism. Testing whether a 1/n translation maps
 * the atom set onto itself detects the supercell multiplicity; counting the
 * atoms that fail to find a partner under that same translation detects the
 * defects. So repeats and vacancies/interstitials are reported together rather
 * than by two independent heuristics that could disagree.
 *
 * Pure module: structure in, analysis out. No store, no three.js.
 */

import type { ZatomStructure } from '../../agent/contracts'
import {
  invert3x3,
  isValidLattice,
  toFractional,
  type LatticeLike,
  type Vec3,
} from '../crystal/lattice-math'

// ---------------------------------------------------------------------------
// Rounding primitives
// ---------------------------------------------------------------------------

/**
 * Which cell contains a fractional coordinate. `floor`, not `round`.
 *
 * f = 1.3 lies in cell 1; f = -0.2 lies in cell -1. This is the "which box am I
 * in" question, and `Math.round` answers a different one (it would put -0.2 in
 * cell 0 and 1.6 in cell 2, so cells would not tile the axis).
 */
export const cellIndex = (f: number): number => Math.floor(f)

/**
 * Fractional offset of a coordinate within its own cell, always in [0, 1).
 *
 * Uses `cellIndex`, so negative coordinates wrap correctly: -0.2 -> 0.8. A bare
 * `f % 1` returns -0.2 here, which then compares unequal to the 0.8 of an
 * otherwise identical atom and silently breaks symmetry matching.
 */
export const cellOffset = (f: number): number => f - cellIndex(f)

/**
 * Shortest fractional separation between two coordinates under periodicity —
 * the minimum image convention. `round`, not `floor`.
 *
 * This is the counterpart to `cellIndex` and the reason both exist by name.
 * For a *displacement*, the nearest image is wanted: a separation of 0.9 cells
 * is really -0.1 cells the other way round the boundary. `round` gives that;
 * `floor` would map 0.9 to 0.9 and report atoms across a boundary as maximally
 * far apart when they are in fact touching. Using the cell-index rule here is
 * an easy and near-invisible error, because it stays correct for every pair
 * that does not straddle a face.
 */
export const minimumImageDelta = (df: number): number => df - Math.round(df)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Per-axis repeat multiplicity along the three lattice vectors. */
export type AxisRepeats = [number, number, number]

export interface PeriodicScaffoldOptions {
  /**
  * Fractional coordinate tolerance for calling two sites coincident. 0.02 of a
  * cell edge is ~0.08 A on a 4 A cell, comfortably tighter than any real
  * interatomic distance and loose enough for relaxed//rounded coordinates.
  */
  tolerance?: number
  /**
  * Largest repeat multiplicity to test per axis. Supercells beyond 16x are
  * rare, and the scan is O(maxRepeat x N) so this only bounds the constant.
  */
  maxRepeat?: number
  /**
  * Fraction of atoms allowed to fail translation matching while still calling
  * the axis periodic. This is what makes defect detection possible: a perfect
  * match requirement would reject a supercell containing a single vacancy and
  * report no periodicity at all, losing both facts at once.
  */
  defectTolerance?: number
}

export interface PeriodicScaffold {
  /** Repeat multiplicity per lattice axis; 1 means "already primitive". */
  repeats: AxisRepeats
  /** True when any axis repeats more than once. */
  isSupercell: boolean
  /** Product of `repeats` — how many primitive cells the scene contains. */
  cellCount: number
  /**
  * Atom ids that found no translation partner under the detected repeats.
  * These are the defect candidates: vacancy neighbourhoods and interstitials
  * both surface here, since both break the translation map.
  */
  unmatchedAtomIds: string[]
  /**
  * Empty positions implied by the detected translation map. These are
  * hypotheses, not definitive defect labels: a vacancy is normally supported
  * by predecessors along several repeated axes, while an interstitial or a
  * strongly relaxed site often produces isolated one-axis breaks.
  */
  missingSiteCandidates: PeriodicMissingSiteCandidate[]
  /** Human-readable summary, echoed to the model so the lens is never implicit. */
  reason: string
}

export interface PeriodicMissingSiteCandidate {
  element: string
  fractional: Vec3
  position: Vec3
  sourceAtomIds: string[]
  supportingAxes: Array<'a' | 'b' | 'c'>
  /** supportingAxes / repeated axes, bounded to 0..1. */
  confidence: number
}

export interface SlabLayer {
  /** Signed distance along the surface normal, in Angstrom. */
  position: number
  atomIds: string[]
}

export interface SlabLayering {
  /** Index of the aperiodic lattice axis this layering runs along (0=a,1=b,2=c). */
  axis: 0 | 1 | 2
  layers: SlabLayer[]
  /** Median centre-to-centre spacing in Angstrom, or null with fewer than 2 layers. */
  medianSpacing: number | null
  reason: string
}

// ---------------------------------------------------------------------------
// Lattice plumbing
// ---------------------------------------------------------------------------

/** `ZatomLattice.vectors` is documented as row vectors a, b, c. */
const asLatticeLike = (vectors: readonly Vec3[]): LatticeLike => ({
  a: [vectors[0][0], vectors[0][1], vectors[0][2]],
  b: [vectors[1][0], vectors[1][1], vectors[1][2]],
  c: [vectors[2][0], vectors[2][1], vectors[2][2]],
})

const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
]

const norm = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])

// ---------------------------------------------------------------------------
// Repeat detection
// ---------------------------------------------------------------------------

/**
 * Spatial hash over wrapped fractional coordinates, keyed by element.
 *
 * Bin size is the match tolerance and lookups probe the 27 surrounding bins, so
 * a partner sitting just across a bin edge is still found. Quantizing to a
 * single bin per site and comparing keys directly would miss exactly those
 * boundary pairs, which are common because atoms sit at cell faces by design.
 */
class FractionalIndex {
  private readonly bins = new Map<string, number[]>()
  private readonly frac: Vec3[]
  private readonly tolerance: number

  constructor(frac: Vec3[], elements: string[], tolerance: number) {
    this.frac = frac
    this.tolerance = tolerance
    for (let i = 0; i < frac.length; i++) {
      const key = this.binKey(frac[i], elements[i])
      const bucket = this.bins.get(key)
      if (bucket) bucket.push(i)
      else this.bins.set(key, [i])
    }
  }

  private binKey(f: Vec3, element: string, offset: readonly [number, number, number] = [0, 0, 0]): string {
    const q = (value: number, d: number) => Math.floor(cellOffset(value) / this.tolerance) + d
    return `${element}|${q(f[0], offset[0])}|${q(f[1], offset[1])}|${q(f[2], offset[2])}`
  }

  /** Index of an atom of the same element coincident with `target`, or -1. */
  find(target: Vec3, element: string): number {
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        for (let dc = -1; dc <= 1; dc++) {
          // The element is part of the bin key, so a bucket only ever holds
          // atoms of the requested element and no second element check is
          // needed here. That matters for correctness, not just speed: a 1/2
          // shift that maps Na onto Cl is not a translation symmetry, and
          // without the element in the key a rock-salt cell folds in half.
          const bucket = this.bins.get(this.binKey(target, element, [da, db, dc]))
          if (!bucket) continue
          for (const i of bucket) {
            if (this.coincident(this.frac[i], target)) return i
          }
        }
      }
    }
    return -1
  }

  private coincident(u: Vec3, v: Vec3): boolean {
    for (let k = 0; k < 3; k++) {
      // Compare across the periodic boundary: 0.999 and 0.001 are neighbours.
      if (Math.abs(minimumImageDelta(u[k] - v[k])) > this.tolerance) return false
    }
    return true
  }
}

/**
 * Largest n <= maxRepeat such that translating every atom by 1/n along `axis`
 * maps the atom set onto itself, together with the atoms that failed to match.
 *
 * The largest working n is the answer, not the smallest. If a 1/4 translation is
 * a symmetry then so is 2/4, so every divisor of the true multiplicity also
 * "works"; taking the smallest would report 2 for a 4x supercell and understate
 * the redundancy.
 */
const detectAxisRepeat = (
  frac: Vec3[],
  elements: string[],
  index: FractionalIndex,
  axis: 0 | 1 | 2,
  maxRepeat: number,
  allowedMisses: number,
): { repeat: number; unmatched: number[] } => {
  let best = { repeat: 1, unmatched: [] as number[] }
  const limit = Math.min(maxRepeat, frac.length)
  for (let n = 2; n <= limit; n++) {
    const shift = 1 / n
    const unmatched: number[] = []
    for (let i = 0; i < frac.length; i++) {
      const target: Vec3 = [frac[i][0], frac[i][1], frac[i][2]]
      target[axis] = target[axis] + shift
      if (index.find(target, elements[i]) < 0) {
        unmatched.push(i)
        if (unmatched.length > allowedMisses) break
      }
    }
    if (unmatched.length <= allowedMisses) best = { repeat: n, unmatched }
  }
  return best
}

/**
 * Detect the repeat multiplicity of a periodic scene and the atoms that break it.
 *
 * Returns null when there is no usable lattice, which is the honest answer for a
 * molecular scene rather than a scaffold of all ones.
 */
export const analyzePeriodicScaffold = (
  structure: ZatomStructure,
  options: PeriodicScaffoldOptions = {},
): PeriodicScaffold | null => {
  const lattice = structure.lattice
  if (!lattice) return null
  const latticeLike = asLatticeLike(lattice.vectors)
  if (!isValidLattice(latticeLike)) return null
  const inv = invert3x3(latticeLike)
  if (!inv) return null

  const atoms = structure.atoms
  if (atoms.length === 0) {
    return {
      repeats: [1, 1, 1],
      isSupercell: false,
      cellCount: 1,
      unmatchedAtomIds: [],
      missingSiteCandidates: [],
      reason: 'empty structure',
    }
  }

  const tolerance = options.tolerance ?? 0.02
  const maxRepeat = options.maxRepeat ?? 16
  const defectTolerance = options.defectTolerance ?? 0.1
  const allowedMisses = Math.floor(atoms.length * defectTolerance)

  const frac: Vec3[] = atoms.map((atom) => {
    const p = atom.position
    return toFractional(inv, p[0], p[1], p[2])
  })
  const elements = atoms.map((atom) => atom.element)
  const index = new FractionalIndex(frac, elements, tolerance)

  const repeats: AxisRepeats = [1, 1, 1]
  const unmatchedIdx = new Set<number>()
  const periodic = lattice.periodic
  for (const axis of [0, 1, 2] as const) {
    // An aperiodic axis has a real boundary, not a wrapped one; a translation
    // along it is not a symmetry of the scene and testing it would invent one.
    if (!periodic[axis]) continue
    const found = detectAxisRepeat(frac, elements, index, axis, maxRepeat, allowedMisses)
    repeats[axis] = found.repeat
    if (found.repeat > 1) for (const i of found.unmatched) unmatchedIdx.add(i)
  }

  const cellCount = repeats[0] * repeats[1] * repeats[2]
  const unmatchedAtomIds = [...unmatchedIdx].map((i) => atoms[i].id)
  const isSupercell = cellCount > 1
  const repeatedAxes = ([0, 1, 2] as const).filter((axis) => repeats[axis] > 1)
  type CandidateAccumulator = {
    element: string
    fractional: Vec3
    sourceAtomIds: Set<string>
    supportingAxes: Set<0 | 1 | 2>
  }
  const candidateBins = new Map<string, number[]>()
  const candidates: CandidateAccumulator[] = []
  const binCount = Math.max(1, Math.round(1 / tolerance))
  const binCoordinate = (value: number) => {
    const rounded = Math.round(cellOffset(value) * binCount)
    return ((rounded % binCount) + binCount) % binCount
  }
  const candidateKey = (element: string, fractional: Vec3, offset: readonly [number, number, number] = [0, 0, 0]) => {
    const component = (value: number, delta: number) => {
      const bin = binCoordinate(value) + delta
      return ((bin % binCount) + binCount) % binCount
    }
    return `${element}|${component(fractional[0], offset[0])}|${component(fractional[1], offset[1])}|${component(fractional[2], offset[2])}`
  }
  const findCandidate = (element: string, fractional: Vec3): number => {
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
      for (const candidateIndex of candidateBins.get(candidateKey(element, fractional, [da, db, dc])) ?? []) {
        const candidate = candidates[candidateIndex]
        if ([0, 1, 2].every((axis) => Math.abs(minimumImageDelta(
          candidate.fractional[axis] - fractional[axis],
        )) <= tolerance)) return candidateIndex
      }
    }
    return -1
  }
  for (const axis of repeatedAxes) {
    const shift = 1 / repeats[axis]
    for (let atomIndex = 0; atomIndex < atoms.length; atomIndex++) {
      const target: Vec3 = [...frac[atomIndex]]
      target[axis] = cellOffset(target[axis] + shift)
      if (index.find(target, elements[atomIndex]) >= 0) continue
      let candidateIndex = findCandidate(elements[atomIndex], target)
      if (candidateIndex < 0) {
        candidateIndex = candidates.length
        candidates.push({
          element: elements[atomIndex],
          fractional: target,
          sourceAtomIds: new Set(),
          supportingAxes: new Set(),
        })
        const key = candidateKey(elements[atomIndex], target)
        const bucket = candidateBins.get(key)
        if (bucket) bucket.push(candidateIndex)
        else candidateBins.set(key, [candidateIndex])
      }
      candidates[candidateIndex].sourceAtomIds.add(atoms[atomIndex].id)
      candidates[candidateIndex].supportingAxes.add(axis)
    }
  }
  const vectors = [latticeLike.a, latticeLike.b, latticeLike.c]
  const toCartesian = (fractional: Vec3): Vec3 => [
    fractional[0] * vectors[0][0] + fractional[1] * vectors[1][0] + fractional[2] * vectors[2][0],
    fractional[0] * vectors[0][1] + fractional[1] * vectors[1][1] + fractional[2] * vectors[2][1],
    fractional[0] * vectors[0][2] + fractional[1] * vectors[1][2] + fractional[2] * vectors[2][2],
  ]
  const axisNames = ['a', 'b', 'c'] as const
  const missingSiteCandidates: PeriodicMissingSiteCandidate[] = candidates
    .map((candidate) => ({
      element: candidate.element,
      fractional: [...candidate.fractional] as Vec3,
      position: toCartesian(candidate.fractional),
      sourceAtomIds: [...candidate.sourceAtomIds].sort(),
      supportingAxes: [...candidate.supportingAxes].sort().map((axis) => axisNames[axis]),
      confidence: repeatedAxes.length ? candidate.supportingAxes.size / repeatedAxes.length : 0,
    }))
    .sort((left, right) => right.confidence - left.confidence
      || left.element.localeCompare(right.element)
      || left.fractional[0] - right.fractional[0]
      || left.fractional[1] - right.fractional[1]
      || left.fractional[2] - right.fractional[2])
  const reason = isSupercell
    ? `translation symmetry maps the scene onto itself at ${repeats.join('x')}` +
      ` (${cellCount} primitive cells, ${atoms.length} atoms)` +
      (unmatchedAtomIds.length > 0 ? `; ${unmatchedAtomIds.length} atoms break it` : '')
    : `no sub-cell translation symmetry found (${atoms.length} atoms); cell is already primitive`

  return { repeats, isSupercell, cellCount, unmatchedAtomIds, missingSiteCandidates, reason }
}

// ---------------------------------------------------------------------------
// Slab layering
// ---------------------------------------------------------------------------

/**
 * Decompose a slab into atomic layers along its aperiodic axis.
 *
 * Layer position is measured along the **surface normal** (a x b for an
 * aperiodic c), not along the aperiodic lattice vector itself. For a tilted
 * cell — common after building a slab from a non-orthogonal bulk — the c vector
 * is not perpendicular to the surface, so projecting onto c mixes in-plane
 * displacement into the layer coordinate and smears distinct layers together.
 *
 * Returns null when the structure has no single aperiodic axis, since "layers"
 * is then not the right description: a fully periodic bulk has no surface, and
 * a wire or molecule needs a different decomposition.
 */
export const analyzeSlabLayering = (
  structure: ZatomStructure,
  options: { layerGap?: number } = {},
): SlabLayering | null => {
  const lattice = structure.lattice
  if (!lattice) return null
  const aperiodic = ([0, 1, 2] as const).filter((i) => !lattice.periodic[i])
  if (aperiodic.length !== 1) return null
  const axis = aperiodic[0]
  const atoms = structure.atoms
  if (atoms.length === 0) return null

  const latticeLike = asLatticeLike(lattice.vectors)
  if (!isValidLattice(latticeLike)) return null

  // Surface normal = cross product of the two in-plane (periodic) vectors.
  const inPlane = ([0, 1, 2] as const).filter((i) => i !== axis)
  const vecs = [latticeLike.a, latticeLike.b, latticeLike.c]
  const n = cross(vecs[inPlane[0]], vecs[inPlane[1]])
  const nLen = norm(n)
  if (nLen < 1e-9) return null
  const unit: Vec3 = [n[0] / nLen, n[1] / nLen, n[2] / nLen]

  const projected = atoms.map((atom, i) => ({
    i,
    d: atom.position[0] * unit[0] + atom.position[1] * unit[1] + atom.position[2] * unit[2],
  }))
  projected.sort((p, q) => p.d - q.d)

  // Single-linkage clustering: a gap wider than `layerGap` starts a new layer.
  // 0.8 A is well under any real interlayer spacing (~2 A and up) and well over
  // the in-layer corrugation of a relaxed surface.
  const layerGap = options.layerGap ?? 0.8
  const layers: SlabLayer[] = []
  let current: { sum: number; ids: string[] } | null = null
  let previous = Number.NaN
  for (const { i, d } of projected) {
    if (current === null || d - previous > layerGap) {
      if (current) layers.push({ position: current.sum / current.ids.length, atomIds: current.ids })
      current = { sum: 0, ids: [] }
    }
    current.sum += d
    current.ids.push(atoms[i].id)
    previous = d
  }
  if (current) layers.push({ position: current.sum / current.ids.length, atomIds: current.ids })

  let medianSpacing: number | null = null
  if (layers.length >= 2) {
    const gaps = layers.slice(1).map((l, k) => l.position - layers[k].position)
    gaps.sort((a, b) => a - b)
    const mid = gaps.length >> 1
    medianSpacing = gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2
  }

  return {
    axis,
    layers,
    medianSpacing,
    reason:
      `${layers.length} layers along the aperiodic ${'abc'[axis]} axis, measured on the surface normal` +
      (medianSpacing !== null ? `; median spacing ${medianSpacing.toFixed(2)} A` : ''),
  }
}
