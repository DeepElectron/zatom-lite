/**
 * wyckoff —— Assign atoms in a unit cell to Wyckoff sites.
 *
 * Algorithm shape:
 * 1. Use the space group operation (R, t) to generate orbit for each atom - all g·r equivalent positions, modulo 1 taking decimals.
 * 2. Orbit size = multiplicity. The only orbit corresponds to a Wyckoff site.
 * 3. Use representative in `wyckoff-table.ts` and fit the first point of orbit (find x/y/z),
 * Then verify multiplicity is consistent.
 *
 * Input only requires atoms + space group number + (optional) operations list given by the backend. When there is no operations
 * Can only be pressed multiplicity-only fallback (enough for most common structures).
 */

import {
  getSpaceGroupData,
  type SpaceGroupWyckoff,
  type WyckoffCoordExpr,
  type WyckoffSite,
} from './wyckoff-table'

export type FractionalCoord = readonly [number, number, number]

export interface WyckoffAtomInput {
  /** atom index in caller's array (for round-tripping back to UI) */
  index: number
  element: string
  frac: FractionalCoord
}

export interface SymmetryOperation {
  /** 3x3 rotation/reflection in fractional basis */
  rotation: readonly (readonly number[])[]
  /** translation in fractional basis */
  translation: readonly number[]
}

export interface WyckoffAssignment {
  /** atom indices (caller-supplied) belonging to this orbit */
  atomIndices: number[]
  /** distinct element symbol across orbit (one element per orbit by definition) */
  element: string
  /** the Wyckoff site matched (or null if multiplicity didn't fit any site) */
  site: WyckoffSite | null
  /** the matched site label like '4a' (or '?'+ orbit size when site=null) */
  label: string
  /** representative fractional coordinate of the first atom in this orbit */
  representative: FractionalCoord
}

export interface WyckoffAnalysis {
  spaceGroup: SpaceGroupWyckoff
  assignments: WyckoffAssignment[]
  /** atoms whose orbit couldn't be classified (e.g. SG not in table) */
  unclassified: number[]
}

// ── coord helpers ────────────────────────────────────────────────────────────

/** wrap a fractional value to [0, 1) with tolerance for near-1 values. */
function wrap(x: number, tol = 1e-6): number {
  let v = x - Math.floor(x)
  if (Math.abs(v - 1) < tol) v = 0
  if (v < tol) v = 0
  return v
}

function wrapFrac(f: FractionalCoord, tol = 1e-6): FractionalCoord {
  return [wrap(f[0], tol), wrap(f[1], tol), wrap(f[2], tol)]
}

function fracsEqual(a: FractionalCoord, b: FractionalCoord, tol = 1e-4): boolean {
  return (
    Math.abs(a[0] - b[0]) < tol &&
    Math.abs(a[1] - b[1]) < tol &&
    Math.abs(a[2] - b[2]) < tol
  )
}

function applyOp(op: SymmetryOperation, f: FractionalCoord): FractionalCoord {
  const r = op.rotation
  const t = op.translation
  const x = r[0][0] * f[0] + r[0][1] * f[1] + r[0][2] * f[2] + t[0]
  const y = r[1][0] * f[0] + r[1][1] * f[1] + r[1][2] * f[2] + t[1]
  const z = r[2][0] * f[0] + r[2][1] * f[1] + r[2][2] * f[2] + t[2]
  return wrapFrac([x, y, z])
}

/** Generate orbit of f under given operations, deduplicated (mod 1). */
export function generateOrbit(
  f: FractionalCoord,
  ops: readonly SymmetryOperation[],
  tol = 1e-4,
): FractionalCoord[] {
  const orbit: FractionalCoord[] = []
  for (const op of ops) {
    const p = applyOp(op, f)
    let dup = false
    for (const q of orbit) {
      if (fracsEqual(p, q, tol)) { dup = true; break }
    }
    if (!dup) orbit.push(p)
  }
  return orbit
}

// ── orbit-based grouping ─────────────────────────────────────────────────────

/**
 * Group atoms into orbits using the supplied symmetry operations.
 * Two atoms are in the same orbit if one is reachable from the other via any op.
 */
export function groupAtomsByOrbit(
  atoms: readonly WyckoffAtomInput[],
  ops: readonly SymmetryOperation[],
  tol = 1e-4,
): WyckoffAtomInput[][] {
  const groups: WyckoffAtomInput[][] = []
  const assigned = new Set<number>()

  for (const atom of atoms) {
    if (assigned.has(atom.index)) continue
    const orbitFracs = generateOrbit(wrapFrac(atom.frac, tol), ops, tol)
    const members: WyckoffAtomInput[] = []
    for (const other of atoms) {
      if (assigned.has(other.index)) continue
      if (other.element !== atom.element) continue
      const otherWrapped = wrapFrac(other.frac, tol)
      const hit = orbitFracs.some((q) => fracsEqual(q, otherWrapped, tol))
      if (hit) {
        members.push(other)
        assigned.add(other.index)
      }
    }
    if (members.length > 0) groups.push(members)
  }
  return groups
}

// ── Wyckoff site matching ────────────────────────────────────────────────────

/**
 * Try to match an orbit to a Wyckoff site.
 * Match rule:
 *  - multiplicity must equal orbit size, OR (atoms/multiplicity ratio is integer for primitive vs centered cells)
 *  - if site representative is fully numeric (no free params), the orbit must contain the representative
 *  - otherwise (free params x,y,z) match via "satisfies fixed coordinates" (numeric components agree)
 *
 * orbitSize=actual atom count in the orbit. Returns null if no match.
 */
export function matchOrbitToSite(
  representativeFrac: FractionalCoord,
  orbitSize: number,
  sg: SpaceGroupWyckoff,
  tol = 1e-3,
): WyckoffSite | null {
  // sort candidates by multiplicity match first, then by specificity (fewer free params first).
  const candidates = sg.sites
    .filter((s) => s.multiplicity === orbitSize)
    .sort((a, b) => freeParamCount(a) - freeParamCount(b))

  for (const site of candidates) {
    if (siteMatchesRepresentative(site, representativeFrac, tol)) return site
  }
  // fallback: closest multiplicity (handles cases where setup mismatch but user wants something)
  return null
}

function freeParamCount(site: WyckoffSite): number {
  return site.representative.filter((c: WyckoffCoordExpr) => typeof c !== 'number').length
}

/**
 * Does the representative fractional coord satisfy the Wyckoff site's representative pattern?
 * Fixed numeric components must match (within tol); free param components are accepted as-is.
 */
function siteMatchesRepresentative(
  site: WyckoffSite,
  frac: FractionalCoord,
  tol: number,
): boolean {
  // free-param tracking: if 'x' appears twice it must take same numeric value.
  const bound: Partial<Record<'x' | 'y' | 'z', number>> = {}
  for (let i = 0; i < 3; i++) {
    const expr = site.representative[i]
    const v = frac[i]
    if (typeof expr === 'number') {
      // Fixed coord, must equal v (mod 1 small slack)
      if (!nearMod1(v, expr, tol)) return false
    } else if (expr === 'x' || expr === 'y' || expr === 'z') {
      if (bound[expr] !== undefined) {
        if (!nearMod1(v, bound[expr]!, tol)) return false
      } else {
        bound[expr] = v
      }
    }
    // 'free' = anything, always passes
  }
  return true
}

function nearMod1(a: number, b: number, tol: number): boolean {
  const diff = ((a - b) % 1 + 1) % 1
  return diff < tol || diff > 1 - tol
}

// ── full pipeline ────────────────────────────────────────────────────────────

/**
 * Assign Wyckoff positions for all atoms in a unit cell.
 *
 * @param atoms      atoms with caller-supplied indices + fractional coords
 * @param sgNumber   space group number (1-230)
 * @param operations symmetry ops (R, t) in conventional fractional basis;
 *                   typically from backend `structure_symmetry_analyze`.
 * @param tol        fractional-coord tolerance (default 1e-4)
 */
export function assignWyckoffPositions(
  atoms: readonly WyckoffAtomInput[],
  sgNumber: number,
  operations: readonly SymmetryOperation[],
  tol = 1e-4,
): WyckoffAnalysis | null {
  const sg = getSpaceGroupData(sgNumber)
  if (!sg) return null

  const orbits = groupAtomsByOrbit(atoms, operations, tol)
  const assignments: WyckoffAssignment[] = []
  const unclassified: number[] = []

  for (const orbit of orbits) {
    const rep = wrapFrac(orbit[0].frac, tol)
    const site = matchOrbitToSite(rep, orbit.length, sg, 5e-3)
    assignments.push({
      atomIndices: orbit.map((a) => a.index).sort((a, b) => a - b),
      element: orbit[0].element,
      site,
      label: site ? `${site.multiplicity}${site.letter}` : `?${orbit.length}`,
      representative: rep,
    })
    if (!site) for (const a of orbit) unclassified.push(a.index)
  }

  // stable order: by Wyckoff multiplicity desc, then letter
  assignments.sort((a, b) => {
    const am = a.site?.multiplicity ?? -1
    const bm = b.site?.multiplicity ?? -1
    if (am !== bm) return bm - am
    return (a.site?.letter ?? '').localeCompare(b.site?.letter ?? '')
  })

  return {
    spaceGroup: sg,
    assignments,
    unclassified,
  }
}
