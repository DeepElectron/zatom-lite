// Quick empirical geometry "clean-up" — pure front-end, no backend / DFT / RDKit.
//
// Goal: take a freshly built / fragment-assembled molecule (often planar z=0,
// overlapping, with irregular bond lengths/angles) and produce sane 3D geometry
// fast and robustly. This is NOT a real force field minimizer — it is a distance
// geometry / spring relaxation by steepest descent, designed to never blow up.
//
// Energy terms (all expressed as physical targets so an already-good structure
// stays put because the net force is ~0):
//   1. Bond stretch:   E = kb·(r - r0)²,  r0 = covalent-radii sum × bond-order factor
//   2. Bond angle (via 1-3 distance spring, avoids divergent angle gradients):
//        target 1-3 distance r13 = √(r_ij² + r_jk² − 2·r_ij·r_jk·cosθ0)
//   3. Non-bonded soft repulsion: only for pairs that are NOT 1-2 / 1-3 bonded,
//        E = kr·(d_min − d)²  when d < d_min ≈ 0.8·(vdW_i + vdW_j)  (repel-only)
//
// Stability measures:
//   - deterministic seeded jitter (LCG by atom index) before optimizing so planar
//     structures can develop a 3rd dimension (coplanar forces stay in-plane).
//   - steepest descent with PER-STEP DISPLACEMENT CLAMP (≤ maxStep Å / atom) so a
//     large force can never launch an atom; adaptive step that decays over time.
//   - minimum-image convention when a lattice matrix is supplied (PBC-safe), but
//     the cell itself is NEVER optimized (cell relax needs a real DFT backend).
//   - fixedIds atoms are frozen (anchor the rest, optimize only a fragment).

// ---------------------------------------------------------------------------
// Self-contained radii tables (Å). Covalent radii (Cordero-ish, single bond)
// and van der Waals radii (Bondi / common values). Fallbacks for unknowns.
// ---------------------------------------------------------------------------

const COVALENT_RADII: Record<string, number> = {
  H: 0.31, He: 0.28,
  Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
  Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
  K: 2.03, Ca: 1.76, Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Mn: 1.39, Fe: 1.32,
  Co: 1.26, Ni: 1.24, Cu: 1.32, Zn: 1.22, Ga: 1.22, Ge: 1.2, As: 1.19, Se: 1.2,
  Br: 1.2, Kr: 1.16,
  Rb: 2.2, Sr: 1.95, Y: 1.9, Zr: 1.75, Nb: 1.64, Mo: 1.54, Ru: 1.46, Rh: 1.42,
  Pd: 1.39, Ag: 1.45, Cd: 1.44, In: 1.42, Sn: 1.39, Sb: 1.39, Te: 1.38, I: 1.39,
  Xe: 1.4,
  Cs: 2.44, Ba: 2.15, La: 2.07, W: 1.62, Pt: 1.36, Au: 1.36, Hg: 1.32, Pb: 1.46,
}

const VDW_RADII: Record<string, number> = {
  H: 1.2, He: 1.4,
  Li: 1.82, Be: 1.53, B: 1.92, C: 1.7, N: 1.55, O: 1.52, F: 1.47, Ne: 1.54,
  Na: 2.27, Mg: 1.73, Al: 1.84, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75, Ar: 1.88,
  K: 2.75, Ca: 2.31, Ni: 1.63, Cu: 1.4, Zn: 1.39, Ga: 1.87, Ge: 2.11, As: 1.85,
  Se: 1.9, Br: 1.85, Kr: 2.02,
  Rb: 3.03, Sr: 2.49, Pd: 1.63, Ag: 1.72, Cd: 1.58, In: 1.93, Sn: 2.17,
  Sb: 2.06, Te: 2.06, I: 1.98, Xe: 2.16,
  Cs: 3.43, Ba: 2.68, Pt: 1.75, Au: 1.66, Hg: 1.55, Pb: 2.02,
}

const DEFAULT_COVALENT = 0.77
const DEFAULT_VDW = 1.7

function covalent(el: string): number {
  return COVALENT_RADII[el] ?? COVALENT_RADII[normElem(el)] ?? DEFAULT_COVALENT
}
function vdw(el: string): number {
  return VDW_RADII[el] ?? VDW_RADII[normElem(el)] ?? DEFAULT_VDW
}
// Normalize element strings like "CL" / "cl" -> "Cl".
function normElem(el: string): string {
  if (!el) return el
  return el.charAt(0).toUpperCase() + el.slice(1).toLowerCase()
}

// Bond-order shortening factor applied to the covalent-radii sum.
function orderFactor(type: string | undefined): number {
  switch (type) {
    case 'triple': return 0.84
    case 'double': return 0.91
    case 'aromatic': return 0.94
    default: return 1.0 // single / partial / unknown
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OptAtom {
  id: string
  element: string
  cartesian?: [number, number, number]
  position?: [number, number, number]
}

export interface OptBond {
  atom1Id: string
  atom2Id: string
  type?: string
}

export interface QuickOptimizeOptions {
  /** 3×3 lattice as row vectors; if supplied all distances use minimum image. */
  latticeMatrix?: [[number, number, number], [number, number, number], [number, number, number]]
  /** atom ids that must not move (anchor the rest, optimize a fragment). */
  fixedIds?: Set<string>
  /** max steepest-descent iterations (default 300). */
  maxIters?: number
}

export interface QuickOptimizeStats {
  iters: number
  maxMove: number
  clashesBefore: number
  clashesAfter: number
  rmsForce: number
}

export interface QuickOptimizeResult {
  positions: Record<string, [number, number, number]>
  stats: QuickOptimizeStats
}

type Vec3 = [number, number, number]

// ---------------------------------------------------------------------------
// Deterministic PRNG (LCG) — seeded purely by atom index so the same input
// always yields the same output (reproducibility + stable tests). NEVER Math.random.
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    // Numerical Recipes LCG constants
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296 // [0,1)
  }
}

// ---------------------------------------------------------------------------
// Force-field constants (arbitrary spring stiffnesses, balanced empirically).
// ---------------------------------------------------------------------------

const KB = 1.0   // bond stretch
const KA = 0.35  // 1-3 distance (angle) spring — softer than bonds
const KR = 0.8   // non-bonded repulsion
const NONBOND_FACTOR = 0.8 // d_min = 0.8 × (vdW_i + vdW_j)
const JITTER = 0.05        // ± Å initial perturbation

// ---------------------------------------------------------------------------
// Ideal angle (degrees) for the central atom j based on its coordination
// number and whether any incident bond is double/triple.
// ---------------------------------------------------------------------------

function idealAngleDeg(coordination: number, hasTriple: boolean, hasDouble: boolean): number {
  if (coordination <= 1) return 180
  if (coordination === 2) {
    if (hasTriple) return 180   // sp (e.g. alkyne, CO2)
    if (hasDouble) return 120   // sp2 bent-ish; use trigonal
    return 109.5                // sp3 bent (e.g. water/ether)
  }
  if (coordination === 3) {
    return hasDouble ? 120 : 109.5 // sp2 trigonal planar vs sp3 pyramidal
  }
  // 4 or more -> tetrahedral
  return 109.5
}

// ---------------------------------------------------------------------------
// Minimum-image helper. With a lattice matrix, wrap a displacement vector into
// the nearest periodic image. Uses an inverse-matrix fractional round trip.
// ---------------------------------------------------------------------------

function invert3(m: number[][]): number[][] | null {
  const [a, b, c] = m
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  if (Math.abs(det) < 1e-12) return null
  const id = 1 / det
  return [
    [
      (b[1] * c[2] - b[2] * c[1]) * id,
      (a[2] * c[1] - a[1] * c[2]) * id,
      (a[1] * b[2] - a[2] * b[1]) * id,
    ],
    [
      (b[2] * c[0] - b[0] * c[2]) * id,
      (a[0] * c[2] - a[2] * c[0]) * id,
      (a[2] * b[0] - a[0] * b[2]) * id,
    ],
    [
      (b[0] * c[1] - b[1] * c[0]) * id,
      (a[1] * c[0] - a[0] * c[1]) * id,
      (a[0] * b[1] - a[1] * b[0]) * id,
    ],
  ]
}

interface MIC {
  m: number[][]
  inv: number[][]
}

function minImage(d: Vec3, mic: MIC | null): Vec3 {
  if (!mic) return d
  const { m, inv } = mic
  // displacement -> fractional
  let fx = inv[0][0] * d[0] + inv[1][0] * d[1] + inv[2][0] * d[2]
  let fy = inv[0][1] * d[0] + inv[1][1] * d[1] + inv[2][1] * d[2]
  let fz = inv[0][2] * d[0] + inv[1][2] * d[1] + inv[2][2] * d[2]
  fx -= Math.round(fx)
  fy -= Math.round(fy)
  fz -= Math.round(fz)
  // fractional -> cartesian (row-vector lattice)
  return [
    fx * m[0][0] + fy * m[1][0] + fz * m[2][0],
    fx * m[0][1] + fy * m[1][1] + fz * m[2][1],
    fx * m[0][2] + fy * m[1][2] + fz * m[2][2],
  ]
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export function quickOptimizeGeometry(
  atoms: OptAtom[],
  bonds: OptBond[],
  opts: QuickOptimizeOptions = {},
): QuickOptimizeResult {
  const n = atoms.length
  const maxIters = opts.maxIters ?? (n > 800 ? 120 : 300)
  const fixedIds = opts.fixedIds ?? new Set<string>()

  const mic: MIC | null = (() => {
    if (!opts.latticeMatrix) return null
    const inv = invert3(opts.latticeMatrix as unknown as number[][])
    if (!inv) return null
    return { m: opts.latticeMatrix as unknown as number[][], inv }
  })()

  // --- index map & coordinate buffer -------------------------------------
  const idToIdx = new Map<string, number>()
  atoms.forEach((a, i) => idToIdx.set(a.id, i))

  const pos: Vec3[] = atoms.map((a) => {
    const p = a.cartesian ?? a.position ?? [0, 0, 0]
    return [p[0], p[1], p[2]]
  })
  const fixed: boolean[] = atoms.map((a) => fixedIds.has(a.id))
  const elems = atoms.map((a) => normElem(a.element))
  // Preserve the pre-jitter centroid so repeated relaxation cannot drift rigidly.
  const initPos: Vec3[] = pos.map((p) => [p[0], p[1], p[2]])

  // Trivial cases — nothing to optimize.
  if (n === 0) {
    return { positions: {}, stats: { iters: 0, maxMove: 0, clashesBefore: 0, clashesAfter: 0, rmsForce: 0 } }
  }

  // --- bond list (validated) & adjacency ---------------------------------
  interface BE { i: number; j: number; r0: number }
  const bondEdges: BE[] = []
  const adjacency: Array<Array<{ idx: number; type: string | undefined }>> = atoms.map(() => [])
  for (const b of bonds) {
    const i = idToIdx.get(b.atom1Id)
    const j = idToIdx.get(b.atom2Id)
    if (i === undefined || j === undefined || i === j) continue
    const r0 = (covalent(elems[i]) + covalent(elems[j])) * orderFactor(b.type)
    bondEdges.push({ i, j, r0 })
    adjacency[i].push({ idx: j, type: b.type })
    adjacency[j].push({ idx: i, type: b.type })
  }

  // --- 1-3 (angle) pairs via shared center -------------------------------
  interface AnglePair { i: number; k: number; r13: number }
  const anglePairs: AnglePair[] = []
  const oneThreeSet = new Set<number>() // packed i*n+k (i<k) to exclude from non-bond
  const oneTwoSet = new Set<number>()
  for (const e of bondEdges) {
    const a = Math.min(e.i, e.j), b = Math.max(e.i, e.j)
    oneTwoSet.add(a * n + b)
  }
  for (let j = 0; j < n; j++) {
    const nbrs = adjacency[j]
    const coord = nbrs.length
    const hasTriple = nbrs.some((x) => x.type === 'triple')
    const hasDouble = nbrs.some((x) => x.type === 'double' || x.type === 'aromatic')
    const theta = (idealAngleDeg(coord, hasTriple, hasDouble) * Math.PI) / 180
    const cosT = Math.cos(theta)
    for (let p = 0; p < nbrs.length; p++) {
      for (let q = p + 1; q < nbrs.length; q++) {
        const i = nbrs[p].idx
        const k = nbrs[q].idx
        if (i === k) continue
        const rij = (covalent(elems[i]) + covalent(elems[j])) * orderFactor(nbrs[p].type)
        const rjk = (covalent(elems[k]) + covalent(elems[j])) * orderFactor(nbrs[q].type)
        const r13sq = rij * rij + rjk * rjk - 2 * rij * rjk * cosT
        const r13 = Math.sqrt(Math.max(r13sq, 1e-6))
        anglePairs.push({ i, k, r13 })
        const lo = Math.min(i, k), hi = Math.max(i, k)
        oneThreeSet.add(lo * n + hi)
      }
    }
  }

  // --- non-bonded min distances (precompute) -----------------------------
  const dminPair = (i: number, j: number) => NONBOND_FACTOR * (vdw(elems[i]) + vdw(elems[j]))

  // --- clash counter (uses current pos) ----------------------------------
  const countClashes = (): number => {
    let c = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = i * n + j
        if (oneTwoSet.has(key) || oneThreeSet.has(key)) continue
        const d = minImage([pos[j][0] - pos[i][0], pos[j][1] - pos[i][1], pos[j][2] - pos[i][2]], mic)
        const dist = Math.hypot(d[0], d[1], d[2])
        if (dist < dminPair(i, j)) c++
      }
    }
    return c
  }

  const clashesBefore = countClashes()

  // --- deterministic seeded jitter (break planarity) ---------------------
  // Each atom gets an LCG seeded by its index; bias a little extra on z so a
  // fully planar (z=0) structure can pop into 3D.
  // Break planarity only for aperiodic molecules; repeated crystal jitter accumulates noise.
  if (!mic) {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue
      const rng = lcg((i + 1) * 2654435761)
      pos[i][0] += (rng() * 2 - 1) * JITTER
      pos[i][1] += (rng() * 2 - 1) * JITTER
      pos[i][2] += (rng() * 2 - 1) * JITTER * 1.5
    }
  }

  // --- steepest descent with per-step displacement clamp -----------------
  const MAX_STEP = 0.1 // Å hard cap on single-atom displacement per iteration
  let step = 0.08
  let maxMove = 0
  let rmsForce = 0
  let iter = 0

  const forces: Vec3[] = atoms.map(() => [0, 0, 0])

  for (; iter < maxIters; iter++) {
    for (let i = 0; i < n; i++) { forces[i][0] = 0; forces[i][1] = 0; forces[i][2] = 0 }

    // 1. bond stretch
    for (const e of bondEdges) {
      const d = minImage([pos[e.j][0] - pos[e.i][0], pos[e.j][1] - pos[e.i][1], pos[e.j][2] - pos[e.i][2]], mic)
      const r = Math.hypot(d[0], d[1], d[2]) || 1e-6
      // F on i along +d proportional to (r - r0); pulls toward r0
      const coeff = (2 * KB * (r - e.r0)) / r
      forces[e.i][0] += coeff * d[0]; forces[e.i][1] += coeff * d[1]; forces[e.i][2] += coeff * d[2]
      forces[e.j][0] -= coeff * d[0]; forces[e.j][1] -= coeff * d[1]; forces[e.j][2] -= coeff * d[2]
    }

    // 2. angle (1-3 distance spring)
    for (const ap of anglePairs) {
      const d = minImage([pos[ap.k][0] - pos[ap.i][0], pos[ap.k][1] - pos[ap.i][1], pos[ap.k][2] - pos[ap.i][2]], mic)
      const r = Math.hypot(d[0], d[1], d[2]) || 1e-6
      const coeff = (2 * KA * (r - ap.r13)) / r
      forces[ap.i][0] += coeff * d[0]; forces[ap.i][1] += coeff * d[1]; forces[ap.i][2] += coeff * d[2]
      forces[ap.k][0] -= coeff * d[0]; forces[ap.k][1] -= coeff * d[1]; forces[ap.k][2] -= coeff * d[2]
    }

    // 3. non-bonded soft repulsion (repel-only)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = i * n + j
        if (oneTwoSet.has(key) || oneThreeSet.has(key)) continue
        const d = minImage([pos[j][0] - pos[i][0], pos[j][1] - pos[i][1], pos[j][2] - pos[i][2]], mic)
        const r = Math.hypot(d[0], d[1], d[2]) || 1e-6
        const dmin = dminPair(i, j)
        if (r >= dmin) continue
        // E = kr (dmin - r)^2 ; force pushes i away from j
        const coeff = (2 * KR * (r - dmin)) / r // negative -> i moves toward -d (away from j)
        forces[i][0] += coeff * d[0]; forces[i][1] += coeff * d[1]; forces[i][2] += coeff * d[2]
        forces[j][0] -= coeff * d[0]; forces[j][1] -= coeff * d[1]; forces[j][2] -= coeff * d[2]
      }
    }

    // move: descent direction = -gradient. Each term above accumulates the
    // PHYSICAL FORCE (= -gradient) into `forces` (e.g. a stretched bond with
    // r>r0 gives coeff·d which points i toward j, pulling the bond shorter).
    // Steepest descent therefore steps ALONG +forces.
    maxMove = 0
    let sumF2 = 0
    let nonFixed = 0
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue
      nonFixed++
      const fx = forces[i][0], fy = forces[i][1], fz = forces[i][2]
      sumF2 += fx * fx + fy * fy + fz * fz
      let dx = step * fx, dy = step * fy, dz = step * fz
      // per-step displacement clamp
      const dlen = Math.hypot(dx, dy, dz)
      if (dlen > MAX_STEP) {
        const s = MAX_STEP / dlen
        dx *= s; dy *= s; dz *= s
      }
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue
      pos[i][0] += dx; pos[i][1] += dy; pos[i][2] += dz
      const moved = Math.hypot(dx, dy, dz)
      if (moved > maxMove) maxMove = moved
    }
    rmsForce = nonFixed > 0 ? Math.sqrt(sumF2 / nonFixed) : 0

    // adaptive / decaying step + convergence
    step *= 0.997
    if (maxMove < 1e-4) { iter++; break }
  }

  // Remove the force field's zero-energy rigid translation when no anchors exist.
  // Do not wrap atoms individually after relaxation: that would tear a molecule
  // across a periodic boundary. Canonical in-cell display is a separate,
  // reversible rendering concern.
  if (fixedIds.size === 0 && n > 0) {
    let dix = 0, diy = 0, diz = 0
    for (let i = 0; i < n; i++) { dix += pos[i][0] - initPos[i][0]; diy += pos[i][1] - initPos[i][1]; diz += pos[i][2] - initPos[i][2] }
    dix /= n; diy /= n; diz /= n
    for (let i = 0; i < n; i++) { pos[i][0] -= dix; pos[i][1] -= diy; pos[i][2] -= diz }
  }

  const clashesAfter = countClashes()

  // --- assemble result ----------------------------------------------------
  const positions: Record<string, [number, number, number]> = {}
  for (let i = 0; i < n; i++) {
    // Guard against any NaN/Inf — fall back to original input on corruption.
    const p = pos[i]
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      const orig = atoms[i].cartesian ?? atoms[i].position ?? [0, 0, 0]
      positions[atoms[i].id] = [orig[0], orig[1], orig[2]]
    } else {
      positions[atoms[i].id] = [p[0], p[1], p[2]]
    }
  }

  return {
    positions,
    stats: {
      iters: iter,
      maxMove,
      clashesBefore,
      clashesAfter,
      rmsForce,
    },
  }
}
