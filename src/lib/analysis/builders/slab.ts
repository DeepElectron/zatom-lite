/**
 * Slab generation — two paths producing extended-XYZ that the standard
 * loadFromXYZ pipeline ingests.
 *
 *   (a) buildSlabFromMiller — rigorous Miller-index slab. For a crystal cell
 *       a1, a2, a3 and indices (h, k, l), find two integer in-plane vectors
 *       perpendicular to G = h·b1 + k·b2 + l·b3 (G is the reciprocal lattice
 *       direction normal to the (hkl) plane). The shortest non-zero lattice
 *       translation along the G direction becomes the out-of-plane vector;
 *       repeat it `layers` times then pad with vacuum.
 *
 *   (b) buildSlabFromPlane — rough cut through 3 atoms or an arbitrary plane.
 *       Keeps atoms on one side of the plane and rebuilds a cell with c along
 *       the plane normal. In-plane lattice is heuristic — original (a, b)
 *       projected onto the plane, which only yields a meaningful periodic cell
 *       when the plane happens to align with two lattice vectors. Use it for
 *       quick "rough cut" cases.
 *
 * Output is an extended-XYZ string with Lattice="..." header so the existing
 * loadFromXYZ path picks it up as a periodic structure.
 */

import type { BuilderResult } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

export interface SlabAtomInput {
  element: string
  /** Cartesian coordinates (Å). */
  cartesian: Vec3
}

export interface BuildSlabFromMillerOptions {
  /** Lattice vectors of the source crystal (row vectors a1, a2, a3). */
  lattice: Mat3
  atoms: SlabAtomInput[]
  /** Miller indices, integers, not all zero. */
  h: number
  k: number
  l: number
  /** Number of layers (out-of-plane repetitions). Default 4. */
  layers?: number
  /** Vacuum padding along c (Å). Default 10. */
  vacuum?: number
  /** Maximum |coefficient| for in-plane vector search. Default 4. */
  search_max?: number
  /** Flip the out-of-plane vector direction (cut from the other side).
  *  Default false. Mirrors Matter Craft's "reverse" toggle on step 1. */
  reverse?: boolean
  /** When true (default), the slab sits at the middle of the cell with
  *  vacuum/2 on each side. When false, slab bottom is at the cell origin
  *  with all vacuum above. */
  center?: boolean
}

export interface BuildSlabFromPlaneOptions {
  lattice: Mat3
  atoms: SlabAtomInput[]
  /** Plane normal (does not need to be unit length). */
  normal: Vec3
  /** A point on the plane. */
  point_on_plane: Vec3
  /** Which side of the plane to keep. */
  keep_side: 'positive' | 'negative'
  /** Vacuum padding (Å). Default 10. */
  vacuum?: number
  /** Tolerance (Å) for "on the plane" — atoms within ± this distance are kept. */
  tolerance?: number
  /** Center slab in cell (default true). Same semantics as Miller path. */
  center?: boolean
}

// ── Math helpers (no external deps) ────────────────────────────────────────

function gcd(a: number, b: number): number {
  const aa = Math.abs(Math.round(a))
  const bb = Math.abs(Math.round(b))
  // Stop non-finite values here: NaN modulo NaN remains NaN, so Euclid's
  // recursion would never reach its zero base case.
  if (!Number.isFinite(aa) || !Number.isFinite(bb)) return 0
  if (bb === 0) return aa
  return gcd(bb, aa % bb)
}

function gcd3(a: number, b: number, c: number): number {
  return gcd(gcd(a, b), c)
}

function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
}

function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
}

function norm(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function add(u: Vec3, v: Vec3): Vec3 {
  return [u[0] + v[0], u[1] + v[1], u[2] + v[2]]
}

function sub(u: Vec3, v: Vec3): Vec3 {
  return [u[0] - v[0], u[1] - v[1], u[2] - v[2]]
}

function det3(m: Mat3): number {
  const [a, b, c] = m
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  )
}

/** Invert a 3×3 matrix (rows). Returns null if singular. */
function invert3(m: Mat3): Mat3 | null {
  const d = det3(m)
  if (Math.abs(d) < 1e-12) return null
  const [a, b, c] = m
  const inv: Mat3 = [
    [
      (b[1] * c[2] - b[2] * c[1]) / d,
      (a[2] * c[1] - a[1] * c[2]) / d,
      (a[1] * b[2] - a[2] * b[1]) / d,
    ],
    [
      (b[2] * c[0] - b[0] * c[2]) / d,
      (a[0] * c[2] - a[2] * c[0]) / d,
      (a[2] * b[0] - a[0] * b[2]) / d,
    ],
    [
      (b[0] * c[1] - b[1] * c[0]) / d,
      (a[1] * c[0] - a[0] * c[1]) / d,
      (a[0] * b[1] - a[1] * b[0]) / d,
    ],
  ]
  return inv
}

/** Multiply column vector v by matrix m (rows): result = m * v (treating m as row-major). */
function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

/** Integer triple A = u1·a1 + u2·a2 + u3·a3. */
function integerLatticeCombo(u: [number, number, number], lattice: Mat3): Vec3 {
  const [u1, u2, u3] = u
  return [
    u1 * lattice[0][0] + u2 * lattice[1][0] + u3 * lattice[2][0],
    u1 * lattice[0][1] + u2 * lattice[1][1] + u3 * lattice[2][1],
    u1 * lattice[0][2] + u2 * lattice[1][2] + u3 * lattice[2][2],
  ]
}

/** Compute |a|, |b|, |c|, α, β, γ from row-vector lattice matrix.
 *  α = angle(b,c), β = angle(a,c), γ = angle(a,b) — standard crystallographic. */
function cellParametersOf(lattice: Mat3): { aLen: number; bLen: number; cLen: number; alphaDeg: number; betaDeg: number; gammaDeg: number } {
  const a = lattice[0], b = lattice[1], c = lattice[2]
  const aLen = norm(a), bLen = norm(b), cLen = norm(c)
  const rad2deg = (r: number) => r * 180 / Math.PI
  const angle = (u: Vec3, v: Vec3) => {
    const c = dot(u, v) / (norm(u) * norm(v))
    return rad2deg(Math.acos(Math.max(-1, Math.min(1, c))))
  }
  return {
    aLen, bLen, cLen,
    alphaDeg: angle(b, c),
    betaDeg: angle(a, c),
    gammaDeg: angle(a, b),
  }
}

/** Cartesian bounding box of an atom list. */
function atomBBoxOf(atoms: Array<{ cart: Vec3 }>): { min: Vec3; max: Vec3 } {
  if (atoms.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const a of atoms) {
    for (let d = 0; d < 3; d++) {
      if (a.cart[d] < min[d]) min[d] = a.cart[d]
      if (a.cart[d] > max[d]) max[d] = a.cart[d]
    }
  }
  return { min, max }
}

/** Defensive PBC wrap of atom Cartesian positions along a/b of a slab cell.
 *  c is the layer/vacuum direction — never wrap (otherwise vacuum semantics
 *  break). Filters atoms whose c-fractional ends up outside [-tol, 1+tol).
 *
 *  Why we need this: atom positions are computed by stacking layers along
 *  the slab's c-step in source Cartesian, but if `cSlab` has any in-plane
 *  component (very common — cSlab is rarely orthogonal to the slab plane in
 *  oblique cells), each layer drifts in a, b. The drift accumulates with
 *  `layers`. Without wrapping, the top layers can sit outside [0,1) in
 *  a, b → atoms render outside the cell parallelepiped.
 *
 *  Returns wrapped/filtered atoms PLUS count of atoms dropped (debug aid). */
function wrapAtomsInSlabCell(
  atoms: Array<{ element: string; cart: Vec3 }>,
  baseMatrix: Mat3,
  cellOrigin: Vec3 = [0, 0, 0],
): { wrapped: Array<{ element: string; cart: Vec3 }>; dropped: number } {
  // Build slt = columns of baseMatrix, invert.
  const slt: Mat3 = [
    [baseMatrix[0][0], baseMatrix[1][0], baseMatrix[2][0]],
    [baseMatrix[0][1], baseMatrix[1][1], baseMatrix[2][1]],
    [baseMatrix[0][2], baseMatrix[1][2], baseMatrix[2][2]],
  ]
  const inv = invert3(slt)
  if (!inv) return { wrapped: atoms, dropped: 0 }
  const a = baseMatrix[0], b = baseMatrix[1], c = baseMatrix[2]
  const tol = 1e-4
  let dropped = 0
  const out: Array<{ element: string; cart: Vec3 }> = []
  for (const atom of atoms) {
    const rel: Vec3 = [
      atom.cart[0] - cellOrigin[0],
      atom.cart[1] - cellOrigin[1],
      atom.cart[2] - cellOrigin[2],
    ]
    const f = matVec(inv, rel)
    // Wrap a/b; keep c untouched. Floor to [0,1) along a,b.
    const fa = f[0] - Math.floor(f[0])
    const fb = f[1] - Math.floor(f[1])
    const fc = f[2]
    if (fc < -tol || fc > 1 + tol) {
      // Atom drifted out along c → likely a logic bug, drop it loudly.
      dropped++
      continue
    }
    const wrappedCart: Vec3 = [
      cellOrigin[0] + fa * a[0] + fb * b[0] + fc * c[0],
      cellOrigin[1] + fa * a[1] + fb * b[1] + fc * c[1],
      cellOrigin[2] + fa * a[2] + fb * b[2] + fc * c[2],
    ]
    out.push({ element: atom.element, cart: wrappedCart })
  }
  return { wrapped: out, dropped }
}

function wrap01(x: number): number {
  return ((x % 1) + 1) % 1
}

// ── Reciprocal-lattice direction & in-plane vector search ──────────────────

/** Compute reciprocal lattice (rows = b1, b2, b3) without 2π factor.
 *  b1 = (a2 × a3) / V, etc. */
function reciprocal(lattice: Mat3): Mat3 {
  const [a1, a2, a3] = lattice
  const V = det3(lattice)
  const b1 = scale(cross(a2, a3), 1 / V)
  const b2 = scale(cross(a3, a1), 1 / V)
  const b3 = scale(cross(a1, a2), 1 / V)
  return [b1, b2, b3]
}

/** Normal to the (hkl) plane in cartesian (Å^-1 units, direction matters only). */
function planeNormal(lattice: Mat3, h: number, k: number, l: number): Vec3 {
  const [b1, b2, b3] = reciprocal(lattice)
  return [
    h * b1[0] + k * b2[0] + l * b3[0],
    h * b1[1] + k * b2[1] + l * b3[1],
    h * b1[2] + k * b2[2] + l * b3[2],
  ]
}

/**
 * Recover the primitive translation lattice from a (possibly centred)
 * conventional cell. Any difference between two same-element atoms that maps
 * the whole basis onto itself is a pure translation; together with the cell
 * vectors these generate the full lattice, from which the three shortest
 * independent generators are taken. Falls back to the input cell if the greedy
 * basis does not reproduce every generator with integer coefficients.
 *
 * Without this, fcc(111) is cut on the conventional cell and comes out as a
 * 2×2 surface supercell (4 atoms/layer) instead of the 1-atom primitive cell,
 * and fcc(100) "layers" are whole conventional cells (2 atomic planes each).
 */
function primitiveLattice(lattice: Mat3, atomsFrac: Array<{ element: string; frac: Vec3 }>): Mat3 {
  if (atomsFrac.length < 2) return lattice
  const fracTol = 1e-3
  const wrapDelta = (x: number) => { const w = x - Math.round(x); return Math.abs(w) }
  const isTranslation = (t: Vec3) =>
    atomsFrac.every((a) =>
      atomsFrac.some((b) =>
        b.element === a.element &&
        wrapDelta(a.frac[0] + t[0] - b.frac[0]) < fracTol &&
        wrapDelta(a.frac[1] + t[1] - b.frac[1]) < fracTol &&
        wrapDelta(a.frac[2] + t[2] - b.frac[2]) < fracTol,
      ),
    )
  const generators: Vec3[] = [lattice[0], lattice[1], lattice[2]]
  const first = atomsFrac[0]
  for (let i = 1; i < atomsFrac.length; i++) {
    const other = atomsFrac[i]
    if (other.element !== first.element) continue
    const t: Vec3 = [wrap01(other.frac[0] - first.frac[0]), wrap01(other.frac[1] - first.frac[1]), wrap01(other.frac[2] - first.frac[2])]
    if (!isTranslation(t)) continue
    generators.push(integerLatticeCombo([t[0], t[1], t[2]], lattice))
  }
  if (generators.length === 3) return lattice

  const sorted = [...generators].sort((u, v) => norm(u) - norm(v))
  const basis: Vec3[] = []
  for (const v of sorted) {
    if (basis.length === 0) { basis.push(v); continue }
    if (basis.length === 1) { if (norm(cross(basis[0], v)) > 1e-6 * norm(basis[0]) * norm(v)) basis.push(v); continue }
    if (Math.abs(det3([basis[0], basis[1], v])) > 1e-6) { basis.push(v); break }
  }
  if (basis.length < 3) return lattice
  const prim: Mat3 = [basis[0], basis[1], basis[2]]
  const inv = invert3([
    [prim[0][0], prim[1][0], prim[2][0]],
    [prim[0][1], prim[1][1], prim[2][1]],
    [prim[0][2], prim[1][2], prim[2][2]],
  ])
  if (!inv) return lattice
  const generatesAll = generators.every((g) => matVec(inv, g).every((c) => Math.abs(c - Math.round(c)) < 1e-6))
  return generatesAll ? prim : lattice
}

/** Find two short lattice vectors of `basis` lying in the (hkl) plane, i.e.
 *  G · v = 0 for the plane's reciprocal vector G. They form the slab (a, b). */
function findInPlaneBasis(
  normal: Vec3,
  basis: Mat3,
  searchMax: number,
  label: string,
): { aVec: Vec3; bVec: Vec3 } {
  // Enumerate integer triples with |·| <= searchMax and G·v = 0. Sort by
  // cartesian length; pick the shortest, then the shortest non-parallel one —
  // in 2D the two successive minima always form a lattice basis.
  const candidates: Array<{ vec: Vec3; len: number }> = []
  for (let u1 = -searchMax; u1 <= searchMax; u1++) {
    for (let u2 = -searchMax; u2 <= searchMax; u2++) {
      for (let u3 = -searchMax; u3 <= searchMax; u3++) {
        if (u1 === 0 && u2 === 0 && u3 === 0) continue
        const vec = integerLatticeCombo([u1, u2, u3], basis)
        const len = norm(vec)
        if (len < 1e-6) continue
        if (Math.abs(dot(normal, vec)) > 1e-6) continue
        candidates.push({ vec, len })
      }
    }
  }
  candidates.sort((a, b) => a.len - b.len)
  if (candidates.length === 0) {
    throw new Error(`No in-plane lattice vectors found for ${label} within search range ${searchMax}`)
  }
  const first = candidates[0]
  // Find a second vector that is not parallel to the first.
  let second: { vec: Vec3; len: number } | null = null
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]
    const cr = cross(first.vec, c.vec)
    if (norm(cr) > 1e-6 * first.len * c.len) {
      second = c
      break
    }
  }
  if (!second) {
    throw new Error(`Could not find a second independent in-plane vector for ${label}`)
  }
  return { aVec: first.vec, bVec: second.vec }
}

/** Find the lattice translation of `basis` with the smallest positive
 *  component along the plane normal — the step between successive atomic
 *  planes. On the primitive lattice this is one atomic layer; on a centred
 *  conventional cell it could span several. */
function findOutOfPlaneVector(
  normal: Vec3,
  basis: Mat3,
  searchMax: number,
  label: string,
): { vec: Vec3 } {
  let best: { vec: Vec3; proj: number; len: number } | null = null
  const normalU = scale(normal, 1 / norm(normal))
  for (let u1 = -searchMax; u1 <= searchMax; u1++) {
    for (let u2 = -searchMax; u2 <= searchMax; u2++) {
      for (let u3 = -searchMax; u3 <= searchMax; u3++) {
        if (u1 === 0 && u2 === 0 && u3 === 0) continue
        const vec = integerLatticeCombo([u1, u2, u3], basis)
        const proj = dot(vec, normalU)
        if (proj <= 1e-6) continue  // want positive projection
        // Smallest positive projection first, then the shortest such vector.
        if (!best || proj < best.proj - 1e-6 || (Math.abs(proj - best.proj) < 1e-6 && norm(vec) < best.len)) {
          best = { vec, proj, len: norm(vec) }
        }
      }
    }
  }
  if (!best) {
    throw new Error(`No out-of-plane vector found for ${label}`)
  }
  return { vec: best.vec }
}

/** Returns the inter-planar distance d_hkl = 1 / |G|. */
export function interplanarSpacing(lattice: Mat3, h: number, k: number, l: number): number {
  const G = planeNormal(lattice, h, k, l)
  const g = norm(G)
  return g > 0 ? 1 / g : 0
}

// ── Miller path ────────────────────────────────────────────────────────────

export function buildSlabFromMiller(opts: BuildSlabFromMillerOptions): BuilderResult {
  let { h, k, l } = opts
  h = Math.round(h)
  k = Math.round(k)
  l = Math.round(l)
  if (h === 0 && k === 0 && l === 0) {
    throw new Error('Miller indices (0,0,0) are invalid')
  }
  const g = gcd3(h, k, l)
  if (g > 1) {
    h = h / g
    k = k / g
    l = l / g
  }
  const layers = Math.max(1, Math.floor(opts.layers ?? 4))
  const vacuum = opts.vacuum ?? 10
  const searchMax = Math.max(2, Math.floor(opts.search_max ?? 4))
  const center = opts.center ?? true
  const reverse = !!opts.reverse

  const lattice = opts.lattice

  // Source fractional coords for each input atom (also needed to detect the
  // primitive translations of a centred cell).
  const lt: Mat3 = [
    [lattice[0][0], lattice[1][0], lattice[2][0]],
    [lattice[0][1], lattice[1][1], lattice[2][1]],
    [lattice[0][2], lattice[1][2], lattice[2][2]],
  ]
  const invSrcLt = invert3(lt)
  if (!invSrcLt) {
    throw new Error('Source lattice is singular')
  }
  const atomsFracSrc: Array<{ element: string; frac: Vec3 }> = opts.atoms.map((atom) => {
    const f = matVec(invSrcLt, atom.cartesian)
    return { element: atom.element, frac: [wrap01(f[0]), wrap01(f[1]), wrap01(f[2])] }
  })

  // Miller indices refer to the conventional cell, so the plane normal G is
  // taken from it; the in-plane and stacking translations are searched on the
  // primitive lattice so the surface cell is the smallest one.
  const label = `(${h},${k},${l})`
  const normal = planeNormal(lattice, h, k, l)
  const primitive = primitiveLattice(lattice, atomsFracSrc)
  const { aVec, bVec } = findInPlaneBasis(normal, primitive, searchMax, label)
  const { vec: cStepRaw } = findOutOfPlaneVector(normal, primitive, searchMax, label)

  // `reverse` flips the cut direction: same (hkl) plane orientation, but the
  // slab extends in the opposite half-space. We negate the c-step vector;
  // atoms below the plane become the "top" and vice versa.
  const cStep = reverse ? scale(cStepRaw, -1) : cStepRaw

  // The new lattice for one repeat-unit is (aVec, bVec, cStep). We may have
  // a left-handed system — check the determinant; if negative, flip aVec so
  // the slab is right-handed.
  let aSlab = aVec
  const bSlab = bVec
  const cSlab = cStep
  const slabMatrix: Mat3 = [aSlab, bSlab, cSlab]
  if (det3(slabMatrix) < 0) {
    aSlab = scale(aSlab, -1)
  }
  const baseMatrix: Mat3 = [aSlab, bSlab, cSlab]

  // Enumerate source-cell atoms within enough images to fill the slab cell.
  // We need to cover the parallelepiped defined by (aSlab, bSlab, cSlab·layers)
  // expressed in source-lattice fractional coordinates. Strategy: build atoms
  // in fractional coords of the *slab* cell directly.

  // Inverse of slab matrix (as column vectors)
  const slt: Mat3 = [
    [baseMatrix[0][0], baseMatrix[1][0], baseMatrix[2][0]],
    [baseMatrix[0][1], baseMatrix[1][1], baseMatrix[2][1]],
    [baseMatrix[0][2], baseMatrix[1][2], baseMatrix[2][2]],
  ]
  const invSlab = invert3(slt)
  if (!invSlab) {
    throw new Error('Slab lattice is singular')
  }

  // Determine how many source-cell images we need to enumerate to fully cover
  // the slab base cell. Conservative bound: the 8 corners of the slab cell in
  // source-fractional space + a margin.
  const slabCorners: Vec3[] = []
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      for (let kk = 0; kk < 2; kk++) {
        const cart: Vec3 = [
          i * baseMatrix[0][0] + j * baseMatrix[1][0] + kk * baseMatrix[2][0],
          i * baseMatrix[0][1] + j * baseMatrix[1][1] + kk * baseMatrix[2][1],
          i * baseMatrix[0][2] + j * baseMatrix[1][2] + kk * baseMatrix[2][2],
        ]
        slabCorners.push(matVec(invSrcLt, cart))
      }
    }
  }
  const fracMin: Vec3 = [Infinity, Infinity, Infinity]
  const fracMax: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const corner of slabCorners) {
    for (let d = 0; d < 3; d++) {
      if (corner[d] < fracMin[d]) fracMin[d] = corner[d]
      if (corner[d] > fracMax[d]) fracMax[d] = corner[d]
    }
  }
  // Margin for atoms that sit right on a boundary
  const iMin = Math.floor(fracMin[0]) - 1
  const iMax = Math.ceil(fracMax[0]) + 1
  const jMin = Math.floor(fracMin[1]) - 1
  const jMax = Math.ceil(fracMax[1]) + 1
  const kMin = Math.floor(fracMin[2]) - 1
  const kMax = Math.ceil(fracMax[2]) + 1

  // Enumerate atoms in [0, 1) of slab base cell (one layer).
  type EmittedAtom = { element: string; cart: Vec3 }
  const layerAtoms: EmittedAtom[] = []
  const seenKey = new Set<string>()
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      for (let kk = kMin; kk <= kMax; kk++) {
        for (const a of atomsFracSrc) {
          const fSrc: Vec3 = [a.frac[0] + i, a.frac[1] + j, a.frac[2] + kk]
          const cart: Vec3 = [
            fSrc[0] * lattice[0][0] + fSrc[1] * lattice[1][0] + fSrc[2] * lattice[2][0],
            fSrc[0] * lattice[0][1] + fSrc[1] * lattice[1][1] + fSrc[2] * lattice[2][1],
            fSrc[0] * lattice[0][2] + fSrc[1] * lattice[1][2] + fSrc[2] * lattice[2][2],
          ]
          // Now express in slab base-cell fractional
          const slabFrac = matVec(invSlab, cart)
          // Keep if within [0, 1) in all three axes with small tolerance
          const tol = 1e-6
          const inA = slabFrac[0] >= -tol && slabFrac[0] < 1 - tol
          const inB = slabFrac[1] >= -tol && slabFrac[1] < 1 - tol
          const inC = slabFrac[2] >= -tol && slabFrac[2] < 1 - tol
          if (!(inA && inB && inC)) continue
          // De-duplicate via rounded fractional key
          const key = `${a.element}|${slabFrac[0].toFixed(4)}|${slabFrac[1].toFixed(4)}|${slabFrac[2].toFixed(4)}`
          if (seenKey.has(key)) continue
          seenKey.add(key)
          layerAtoms.push({ element: a.element, cart })
        }
      }
    }
  }

  // Stack `layers` copies along cSlab — the crystal translation between
  // successive (hkl) planes, which is generally oblique to the plane.
  const stacked: EmittedAtom[] = []
  for (let layer = 0; layer < layers; layer++) {
    const shift: Vec3 = scale(cSlab, layer)
    for (const atom of layerAtoms) {
      stacked.push({ element: atom.element, cart: add(atom.cart, shift) })
    }
  }

  // The final c vector points along the TRUE plane normal, not along cSlab.
  // A slab is non-periodic across the vacuum, so c is free to be perpendicular
  // to the surface; using the oblique cSlab instead (the previous behaviour)
  // gave fcc(111) a β=135° cell whose vacuum measured along the normal was
  // only 7.9 Å for a requested 10 Å, and made every "height" a skewed axis.
  let cUnit: Vec3 = scale(normal, 1 / norm(normal))
  if (dot(cUnit, cSlab) < 0) cUnit = scale(cUnit, -1) // stack direction is "up"

  // Slab thickness measured along the normal:
  let zMin = Infinity
  let zMax = -Infinity
  for (const atom of stacked) {
    const projZ = dot(atom.cart, cUnit)
    if (projZ < zMin) zMin = projZ
    if (projZ > zMax) zMax = projZ
  }
  const slabThickness = stacked.length > 0 ? zMax - zMin : 0
  // Cell height = thickness + vacuum, floored at `layers` atomic-plane steps
  // so a zero-vacuum or empty request still yields a nonsingular cell.
  const layerStep = Math.abs(dot(cSlab, cUnit))
  const totalCLen = Math.max(slabThickness + vacuum, layerStep * layers, 1e-3)
  const cFinal: Vec3 = scale(cUnit, totalCLen)
  // Shift atoms: center=true sits slab in the middle (vacuum/2 above + below);
  // center=false anchors slab bottom at cell origin (all vacuum above).
  const baseShift: Vec3 = stacked.length > 0
    ? scale(cUnit, (center ? (totalCLen - slabThickness) / 2 : 0) - zMin)
    : [0, 0, 0]
  const preWrapAtoms = stacked.map((a) => ({ element: a.element, cart: add(a.cart, baseShift) }))

  // Defensive PBC wrap along a, b of the FINAL cell (a=aSlab, b=bSlab, c=cFinal).
  // Atoms drifting outside [0,1) in a/b due to oblique cSlab get wrapped back in,
  // c stays untouched (vacuum direction). Atoms outside c [0,1) get dropped with
  // a warning prefix in the description (very likely indicates a logic bug upstream).
  const finalCell: Mat3 = [aSlab, bSlab, cFinal]
  const { wrapped: shiftedAtoms, dropped: droppedCount } = wrapAtomsInSlabCell(preWrapAtoms, finalCell)

  // Emit extended-XYZ
  const lines: string[] = []
  lines.push(String(shiftedAtoms.length))
  const lat: Vec3[] = [aSlab, bSlab, cFinal]
  const latStr = lat.flatMap((v) => v.map((x) => x.toFixed(6))).join(' ')
  const reverseTag = reverse ? ' reverse=true' : ''
  const centerTag = center ? '' : ' center=false'
  lines.push(
    `Lattice="${latStr}" Properties=species:S:1:pos:R:3 Slab(${h}${k}${l}) layers=${layers} vacuum=${vacuum}${reverseTag}${centerTag}`
  )
  for (const atom of shiftedAtoms) {
    lines.push(
      `${atom.element} ${atom.cart[0].toFixed(6)} ${atom.cart[1].toFixed(6)} ${atom.cart[2].toFixed(6)}`
    )
  }
  const composition: Record<string, number> = {}
  for (const a of shiftedAtoms) composition[a.element] = (composition[a.element] ?? 0) + 1
  const cellParams = cellParametersOf(finalCell)
  const bbox = atomBBoxOf(shiftedAtoms)
  const dropNote = droppedCount > 0 ? ` (${droppedCount} atoms outside c bounds dropped)` : ''
  return {
    xyz: lines.join('\n'),
    description: `Slab (${h}${k}${l}) · ${layers} layers · vacuum ${vacuum} Å · ${shiftedAtoms.length} atoms${dropNote}`,
    n_atoms: shiftedAtoms.length,
    composition,
    cellParams,
    atomBBox: { min: bbox.min, max: bbox.max },
  }
}

// ── Plane path (three atoms or an arbitrary plane) ────────────────────────

export function buildSlabFromPlane(opts: BuildSlabFromPlaneOptions): BuilderResult {
  const vacuum = opts.vacuum ?? 10
  const tol = opts.tolerance ?? 0.05  // atoms within this distance of plane go to kept side
  const center = opts.center ?? true
  const n = norm(opts.normal)
  if (n < 1e-9) throw new Error('Plane normal has zero length')
  const unitN: Vec3 = scale(opts.normal, 1 / n)
  // Signed distance for each atom; keep atoms on requested side.
  const keepSign = opts.keep_side === 'positive' ? 1 : -1
  const kept: Array<{ element: string; cart: Vec3 }> = []
  for (const atom of opts.atoms) {
    const rel = sub(atom.cartesian, opts.point_on_plane)
    const d = dot(rel, unitN)
    if (keepSign === 1 && d >= -tol) {
      kept.push({ element: atom.element, cart: atom.cartesian })
    } else if (keepSign === -1 && d <= tol) {
      kept.push({ element: atom.element, cart: atom.cartesian })
    }
  }

  // In-plane lattice: project original (a1, a2, a3) onto plane and pick two
  // that span it best. Heuristic only — caller may need to rebuild.
  const a1 = opts.lattice[0]
  const a2 = opts.lattice[1]
  const a3 = opts.lattice[2]
  const projectInPlane = (v: Vec3): Vec3 => {
    const along = dot(v, unitN)
    return sub(v, scale(unitN, along))
  }
  const candidates: Array<{ vec: Vec3; len: number }> = [a1, a2, a3]
    .map((v) => {
      const p = projectInPlane(v)
      return { vec: p, len: norm(p) }
    })
    .filter((c) => c.len > 1e-6)
    .sort((a, b) => a.len - b.len)
  if (candidates.length < 2) {
    throw new Error('Could not derive in-plane lattice from original cell (plane is degenerate)')
  }
  let aPlane = candidates[0].vec
  let bPlane = candidates[1].vec
  // Ensure a, b not collinear; if so, try third.
  let crossAB = cross(aPlane, bPlane)
  if (norm(crossAB) < 1e-6 && candidates.length >= 3) {
    bPlane = candidates[2].vec
    crossAB = cross(aPlane, bPlane)
  }
  if (norm(crossAB) < 1e-6) {
    throw new Error('Could not derive two independent in-plane vectors')
  }
  // Pick out-of-plane vector along normal with magnitude = (slab thickness + vacuum)
  let zMin = Infinity
  let zMax = -Infinity
  for (const atom of kept) {
    const rel = sub(atom.cart, opts.point_on_plane)
    const d = dot(rel, unitN)
    if (d < zMin) zMin = d
    if (d > zMax) zMax = d
  }
  const thickness = kept.length > 0 ? Math.max(0, zMax - zMin) : 0
  const cLen = thickness + vacuum
  const cVec: Vec3 = scale(unitN, cLen)

  // Right-handed?
  const slabMat: Mat3 = [aPlane, bPlane, cVec]
  if (det3(slabMat) < 0) {
    aPlane = scale(aPlane, -1)
  }
  // Shift atoms into the new plane-cell coordinate system. The plane point is
  // the output origin before vacuum padding, so an atom's c-coordinate is its
  // signed distance from the cut plane plus the vacuum/bottom offset.
  const shift = kept.length > 0
    ? scale(unitN, (center ? vacuum / 2 : 0) - zMin)
    : [0, 0, 0] as Vec3
  const cellOrigin: Vec3 = [0, 0, 0]
  const preWrapAtoms = kept.map((a) => ({
    element: a.element,
    cart: add(sub(a.cart, opts.point_on_plane), shift),
  }))
  const planeCell: Mat3 = [aPlane, bPlane, cVec]
  const { wrapped: shiftedAtoms, dropped: droppedCount } = wrapAtomsInSlabCell(
    preWrapAtoms,
    planeCell,
    cellOrigin,
  )

  const lines: string[] = []
  lines.push(String(shiftedAtoms.length))
  const lat: Vec3[] = [aPlane, bPlane, cVec]
  const latStr = lat.flatMap((v) => v.map((x) => x.toFixed(6))).join(' ')
  const centerTag = center ? '' : ' center=false'
  lines.push(
    `Lattice="${latStr}" Properties=species:S:1:pos:R:3 SlabFromPlane side=${opts.keep_side} vacuum=${vacuum}${centerTag}`
  )
  for (const atom of shiftedAtoms) {
    lines.push(
      `${atom.element} ${atom.cart[0].toFixed(6)} ${atom.cart[1].toFixed(6)} ${atom.cart[2].toFixed(6)}`
    )
  }
  const composition: Record<string, number> = {}
  for (const a of shiftedAtoms) composition[a.element] = (composition[a.element] ?? 0) + 1
  const planeCellParams = cellParametersOf(planeCell)
  const planeBbox = atomBBoxOf(shiftedAtoms)
  const planeDropNote = droppedCount > 0 ? ` (${droppedCount} atoms outside c bounds dropped)` : ''
  return {
    xyz: lines.join('\n'),
    description: `Slab from plane · keep ${opts.keep_side} · vacuum ${vacuum} Å · ${shiftedAtoms.length} atoms (heuristic in-plane lattice)${planeDropNote}`,
    n_atoms: shiftedAtoms.length,
    composition,
    cellParams: planeCellParams,
    atomBBox: { min: planeBbox.min, max: planeBbox.max },
  }
}

// ── Composition helpers ───────────────────────────────────────────────────

/** Hill-order chemical formula from element → count map.
 *  Hill order: C first, H second, then other elements alphabetical. */
export function formatHillFormula(composition: Record<string, number>): string {
  const elements = Object.keys(composition).filter((el) => composition[el] > 0)
  const c = elements.includes('C') ? ['C'] : []
  const h = elements.includes('H') && elements.includes('C') ? ['H'] : []
  const rest = elements
    .filter((el) => !(el === 'C' && c.length) && !(el === 'H' && h.length))
    .sort()
  // Pure-inorganic: when no carbon, fall through to alphabetical of all elements.
  const order = c.length ? [...c, ...h, ...rest] : rest
  return order.map((el) => composition[el] > 1 ? `${el}${composition[el]}` : el).join('')
}
