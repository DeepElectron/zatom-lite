/**
 * Geometric core of paste-and-graft. Placement follows the anchor's open-valence
 * direction, uses a covalent-radius bond length, and translates outward until
 * clashes clear. The fragment remains rigid and keeps its copied orientation.
 * Vacuum expansion is reported separately because it is meaningful only for an
 * existing slab, not a bulk periodic crystal.
 */

import { getElement } from '../crystal/elements'

type Vec3 = [number, number, number]

const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]]
const add = (u: Vec3, v: Vec3): Vec3 => [u[0] + v[0], u[1] + v[1], u[2] + v[2]]
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]
const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const norm = (v: Vec3): number => Math.sqrt(dot(v, v))

function normalize(v: Vec3): Vec3 | null {
  const n = norm(v)
  if (n < 1e-9) return null
  return [v[0] / n, v[1] / n, v[2] / n]
}

function centroid(points: readonly Vec3[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const p of points) {
    c[0] += p[0]
    c[1] += p[1]
    c[2] += p[2]
  }
  const k = points.length || 1
  return [c[0] / k, c[1] / k, c[2] / k]
}

/** Ideal single-bond length from the covalent-radius sum. */
function idealBondLength(a: string, b: string): number {
  return getElement(a).radius + getElement(b).radius
}

/** Clash threshold as a fraction of the covalent-radius sum. */
const CLASH_FACTOR = 0.75

/**
 * Neighborhood radius (Å): Determine which atoms around the anchor point are considered "local".
 */
const NEIGHBORHOOD_A = 3.2

export interface GraftAtom {
  element: string
  cartesian: Vec3
}

export interface GraftFragmentOptions {
  /**
  * The fragment to be placed (clipboard content), the coordinates are the original Cartesian when copied.
  */
  fragment: readonly GraftAtom[]
  /**
  * All atoms already in the structure.
  */
  hostAtoms: readonly GraftAtom[]
  /**
  * Atomic coordinates + elements of the selection (branch target). An empty array indicates no selection.
  */
  anchorAtoms: readonly GraftAtom[]
  /** Fallback direction, normally the surface normal; defaults to +z. */
  fallbackDirection?: Vec3
}

export interface GraftFragmentResult {
  /**
  * The coordinates of each atom in the fragment after placement, in the same order as the input parameter fragment.
  */
  cartesians: Vec3[]
  /**
  * The actual direction of the connection (unit vector).
  */
  direction: Vec3
  /**
  * Anchor point position.
  */
  anchor: Vec3
  /**
  * Final spacing (Å) between pairs of contacting atoms - used to communicate placement results to the user.
  */
  bondLength: number
  /**
  * Extra distance (Å) to extrapolate to eliminate collisions. 0 means there is no collision after one placement.
  */
  pushedOut: number
}

/**
 * Calculate the landing point where the clip is connected to the selection.
 *
 * Returns null if the fragment is empty or has no anchor - the caller should fall back to normal offset pasting.
 */
export function graftFragment(options: GraftFragmentOptions): GraftFragmentResult | null {
  const { fragment, hostAtoms, anchorAtoms } = options
  if (fragment.length === 0 || anchorAtoms.length === 0) return null

  const anchorPoints = anchorAtoms.map((a) => a.cartesian)
  const anchor = centroid(anchorPoints)

  const direction = resolveDirection({
    anchor,
    anchorAtoms,
    hostAtoms,
    fallback: options.fallbackDirection,
  })

  // Use the fragment atom facing the body as the contact point, not its centroid.
  const fragCentroid = centroid(fragment.map((a) => a.cartesian))
  let contactIndex = 0
  let minProj = Infinity
  for (let i = 0; i < fragment.length; i++) {
    const proj = dot(sub(fragment[i].cartesian, fragCentroid), direction)
    if (proj < minProj) {
      minProj = proj
      contactIndex = i
    }
  }

  // For multiselection anchors, pair with the selected atom nearest the centroid.
  let anchorAtom = anchorAtoms[0]
  let bestAnchorDist = Infinity
  for (const a of anchorAtoms) {
    const d = norm(sub(a.cartesian, anchor))
    if (d < bestAnchorDist) {
      bestAnchorDist = d
      anchorAtom = a
    }
  }

  const bondLength = idealBondLength(anchorAtom.element, fragment[contactIndex].element)

  // Rigidly place the contact atom at anchor + direction × bondLength.
  const target = add(anchor, scale(direction, bondLength))
  const shift = sub(target, fragment[contactIndex].cartesian)
  let placed = fragment.map((a) => add(a.cartesian, shift) as Vec3)

  // Resolve clashes by translating the whole fragment along the graft direction.
  const step = 0.25
  const maxSteps = 40
  let pushedOut = 0
  for (let s = 0; s < maxSteps; s++) {
    if (!hasClash(placed, fragment, hostAtoms)) break
    placed = placed.map((p) => add(p, scale(direction, step)) as Vec3)
    pushedOut += step
  }

  return {
    cartesians: placed,
    direction,
    anchor,
    bondLength: bondLength + pushedOut,
    pushedOut,
  }
}

/**
 * Choose graft direction from a single anchor's open valence, then local outward
 * exposure, then the supplied fallback. Geometry is used because clipboard bonds
 * may not yet have been recomputed.
 */
function resolveDirection(args: {
  anchor: Vec3
  anchorAtoms: readonly GraftAtom[]
  hostAtoms: readonly GraftAtom[]
  fallback?: Vec3
}): Vec3 {
  const { anchor, anchorAtoms, hostAtoms, fallback } = args

  const anchorKeys = new Set(anchorAtoms.map((a) => a.cartesian.join(',')))
  const neighborhood = hostAtoms.filter((h) => {
    if (anchorKeys.has(h.cartesian.join(','))) return false
    return norm(sub(h.cartesian, anchor)) <= NEIGHBORHOOD_A
  })

  // Invert the sum of neighbor unit vectors to point into the coordination gap.
  if (anchorAtoms.length === 1 && neighborhood.length > 0) {
    let acc: Vec3 = [0, 0, 0]
    for (const n of neighborhood) {
      const u = normalize(sub(n.cartesian, anchor))
      if (u) acc = add(acc, u)
    }
    const free = normalize(scale(acc, -1))
    // Near-zero sum means no distinct open-valence direction; use local exposure.
    if (free) return free
  }

  // Local-centroid-to-anchor is a stable outward direction for multiselection.
  if (neighborhood.length > 0) {
    const away = normalize(sub(anchor, centroid(neighborhood.map((n) => n.cartesian))))
    if (away) return away
  }

  // Fall back to the supplied surface direction.
  return normalize(fallback ?? [0, 0, 1]) ?? [0, 0, 1]
}

/**
 * Whether there are atomic pairs between the fragment and the body that are close to CLASH_FACTOR × the ideal bond length.
 */
function hasClash(
  placed: readonly Vec3[],
  fragment: readonly GraftAtom[],
  hostAtoms: readonly GraftAtom[],
): boolean {
  for (let i = 0; i < placed.length; i++) {
    for (const h of hostAtoms) {
      const limit = CLASH_FACTOR * idealBondLength(fragment[i].element, h.element)
      const d = sub(placed[i], h.cartesian)
      // Compare the square first and save most of the sqrt.
      if (dot(d, d) < limit * limit) return true
    }
  }
  return false
}

export interface VacuumNeedOptions {
  /**
  * Cartesian of all atoms (body + new fragment).
  */
  atomCartesians: readonly Vec3[]
  /**
  * Three row vectors of the actual box on the screen (including supercell scaling).
  */
  cellRows: readonly [Vec3, Vec3, Vec3]
  /**
  * Target vacuum thickness (Å).
  */
  vacuumA: number
}

export interface VacuumNeed {
  /**
  * Along the normal direction of the surface, c is the magnification factor required. 1 means no cell expansion is required.
  */
  scaleC: number
  /**
  * Current available vacuum (Å).
  */
  currentVacuumA: number
}

/**
 * Report remaining normal-space vacuum and required c-axis expansion. Measure
 * along a×b rather than |c| for skewed cells, and never shrink a sufficient cell.
 */
export function computeVacuumNeed(options: VacuumNeedOptions): VacuumNeed | null {
  const { atomCartesians, cellRows, vacuumA } = options
  if (atomCartesians.length === 0 || vacuumA <= 0) return null

  const [A, B, C] = cellRows
  const nRaw: Vec3 = [
    A[1] * B[2] - A[2] * B[1],
    A[2] * B[0] - A[0] * B[2],
    A[0] * B[1] - A[1] * B[0],
  ]
  const nLen = norm(nRaw)
  if (nLen < 1e-9) return null
  const nHat: Vec3 = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen]

  const height = Math.abs(dot(C, nHat))
  if (height < 1e-9) return null

  let lo = Infinity
  let hi = -Infinity
  for (const p of atomCartesians) {
    const proj = dot(p, nHat)
    if (proj < lo) lo = proj
    if (proj > hi) hi = proj
  }
  const thickness = hi - lo
  const currentVacuumA = height - thickness
  const needed = thickness + vacuumA
  if (height >= needed) return { scaleC: 1, currentVacuumA }

  return { scaleC: needed / height, currentVacuumA }
}
