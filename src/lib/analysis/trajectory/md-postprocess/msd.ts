/**
 * Mean-square displacement (MSD) → self-diffusion coefficient.
 *
 *   MSD(τ) = ⟨|r_i(t + τ) − r_i(t)|²⟩
 *
 * where ⟨·⟩ averages over time origins t and over all atoms i belonging
 * to the chosen species. We use the windowed time-origin estimator
 * (a.k.a. the "all-pairs" formulation): for each lag τ ∈ [1, max_tau]
 * we sum |r(t+τ) − r(t)|² over every (t, t+τ) pair with t+τ < N_frames.
 *
 * Periodic-boundary unwrapping (default ON) detects per-axis cell jumps
 * larger than ½·L between consecutive frames and removes them by adding
 * back integer cell vectors. This recovers the true trajectory before
 * computing displacements.
 *
 * Diffusion coefficient: from the Einstein relation
 *
 *   MSD(τ) = 2·d·D·τ            (in the linear-diffusive regime)
 *
 * with d = dimensionality (3 for "xyz", 2 for "xy", 1 for any single
 * axis). We fit MSD vs τ over the user-supplied window (or the middle
 * 40 % of the τ range by default — early lags are sub-diffusive, late
 * lags are noisy) by ordinary least squares, then return
 *
 *   D = slope / (2·d)
 *
 * in units of (Å²/frame). The caller multiplies by 1/timestep to convert
 * to physical units if they care; this module is unit-agnostic by design.
 *
 * Returns MSD per species (element symbol → tau-series). When `species`
 * is supplied, only those species are computed; otherwise every element
 * present in the first frame is computed.
 */
import type { XYZFrame } from '../../../crystal/xyz-parser'

export type MsdDirections = 'xyz' | 'xy' | 'xz' | 'yz' | 'x' | 'y' | 'z'

export interface MsdOptions {
  /** Restrict computation to these element symbols. Default: every element in frame 0. */
  species?: string[]
  /** Maximum lag (in frames) to evaluate. Default: floor(N_frames / 2). */
  max_tau?: number
  /**
  * Direction subset used in the displacement norm. Setting this to e.g. "z"
  * computes a 1-D MSD along z and uses d = 1 in the Einstein fit.
  */
  directions?: MsdDirections
  /**
  * Unwrap periodic-boundary cell jumps. Requires `latticeVectors` on every
  * frame; if missing, raw Cartesian deltas are used. Default true.
  */
  unwrap_pbc?: boolean
  /**
  * Linear-fit τ window in frames as [tau_min, tau_max]. If omitted, the
  * middle 40 % (i.e. 30 %–70 %) of the τ range is used.
  */
  fit_range?: [number, number]
}

export interface MsdSpeciesResult {
  /** MSD(τ) in Å² for τ = 1, 2, …, max_tau. (No τ = 0 entry — it's trivially 0.) */
  msd: number[]
  /** Number of atoms of this species contributing to the average. */
  n_atoms: number
  /** Best-fit slope (Å²/frame) over the chosen window. `null` if fit is undefined. */
  fit_slope: number | null
  /** Best-fit intercept (Å²). */
  fit_intercept: number | null
  /** R² of the linear fit ∈ [0, 1]. */
  fit_r_squared: number | null
  /** Self-diffusion coefficient D = slope / (2·d) in Å²/frame. */
  diffusion_coefficient: number | null
  /** [tau_min, tau_max] (frames) that actually entered the fit. */
  fit_tau_window: [number, number] | null
}

export interface MsdResult {
  /** Lag axis τ = 1 … max_tau (frames). */
  tau: number[]
  /** Per-species MSD curves + fit + D. */
  per_species: Record<string, MsdSpeciesResult>
  /** Dimensionality d used in D = slope / (2·d). */
  dimensionality: number
  /** Echo of the chosen direction subset, for the UI. */
  directions: MsdDirections
}

type Vec3 = readonly [number, number, number]
type Lattice = { a: Vec3; b: Vec3; c: Vec3 }

function axisMaskAndD(dirs: MsdDirections): { mask: [boolean, boolean, boolean]; d: number } {
  switch (dirs) {
    case 'xyz':
      return { mask: [true, true, true], d: 3 }
    case 'xy':
      return { mask: [true, true, false], d: 2 }
    case 'xz':
      return { mask: [true, false, true], d: 2 }
    case 'yz':
      return { mask: [false, true, true], d: 2 }
    case 'x':
      return { mask: [true, false, false], d: 1 }
    case 'y':
      return { mask: [false, true, false], d: 1 }
    case 'z':
      return { mask: [false, false, true], d: 1 }
    default:
      return { mask: [true, true, true], d: 3 }
  }
}

/**
 * Add `k · v` (k integer, v a lattice basis vector) to point `p`. The lattice
 * vectors come from XYZFrame['latticeVectors']; we treat each as a row.
 */
function applyCellShift(
  p: [number, number, number],
  shift: [number, number, number],
  lat: Lattice,
): void {
  p[0] += shift[0] * lat.a[0] + shift[1] * lat.b[0] + shift[2] * lat.c[0]
  p[1] += shift[0] * lat.a[1] + shift[1] * lat.b[1] + shift[2] * lat.c[1]
  p[2] += shift[0] * lat.a[2] + shift[1] * lat.b[2] + shift[2] * lat.c[2]
}

/**
 * Solve a 3×3 linear system L^T · n = d for n by inverting L^T. Used during
 * PBC unwrapping to convert a Cartesian displacement back into fractional
 * cell-unit deltas (which we then round to the nearest integer).
 *
 * For orthorhombic cells (the typical MD case) the inverse is diagonal and
 * cheap. We do a general 3×3 inverse for the rare triclinic case; this is
 * still O(1) per frame per atom.
 */
function solveCellDelta(disp: readonly [number, number, number], lat: Lattice): [number, number, number] {
  // L^T columns are a, b, c expressed in Cartesian.
  const m00 = lat.a[0], m10 = lat.a[1], m20 = lat.a[2]
  const m01 = lat.b[0], m11 = lat.b[1], m21 = lat.b[2]
  const m02 = lat.c[0], m12 = lat.c[1], m22 = lat.c[2]
  // Cofactors
  const c00 = m11 * m22 - m12 * m21
  const c01 = -(m10 * m22 - m12 * m20)
  const c02 = m10 * m21 - m11 * m20
  const det = m00 * c00 + m01 * c01 + m02 * c02
  if (Math.abs(det) < 1e-12) return [0, 0, 0]
  const c10 = -(m01 * m22 - m02 * m21)
  const c11 = m00 * m22 - m02 * m20
  const c12 = -(m00 * m21 - m01 * m20)
  const c20 = m01 * m12 - m02 * m11
  const c21 = -(m00 * m12 - m02 * m10)
  const c22 = m00 * m11 - m01 * m10
  // Inverse · disp
  const inv = det
  const n0 = (c00 * disp[0] + c10 * disp[1] + c20 * disp[2]) / inv
  const n1 = (c01 * disp[0] + c11 * disp[1] + c21 * disp[2]) / inv
  const n2 = (c02 * disp[0] + c12 * disp[1] + c22 * disp[2]) / inv
  return [n0, n1, n2]
}

/**
 * Walk the trajectory and produce per-atom unwrapped Cartesian trajectories.
 * `unwrapped[i][f]` is the cumulative-unwrap position of atom i at frame f.
 *
 * Strategy: at each step compute the raw displacement Δ = r(t+1) − r(t), map
 * it to fractional cell-unit deltas, round to the nearest integer to identify
 * the PBC wrap, then subtract that wrap from r(t+1) and accumulate.
 */
export function unwrapTrajectory(
  frames: ReadonlyArray<XYZFrame>,
  enable: boolean,
): [number, number, number][][] {
  const F = frames.length
  if (F === 0) return []
  const N = frames[0].atoms.length
  // Initialise from frame 0.
  const out: [number, number, number][][] = []
  for (let i = 0; i < N; i++) {
    out.push([])
    const c = frames[0].atoms[i].cartesian
    out[i].push([c[0], c[1], c[2]])
  }
  if (F === 1) return out
  // Walk frame by frame, applying wrap correction if enabled and a lattice is present.
  for (let f = 1; f < F; f++) {
    const prev = frames[f - 1]
    const curr = frames[f]
    const lat = curr.latticeVectors ?? prev.latticeVectors
    for (let i = 0; i < N; i++) {
      if (i >= curr.atoms.length) {
        out[i].push(out[i][out[i].length - 1].slice() as [number, number, number])
        continue
      }
      const last = out[i][out[i].length - 1]
      const cart = curr.atoms[i].cartesian
      // Tentative raw position implied by no-wrap continuation: prev raw was at
      // frames[f-1].atoms[i].cartesian + accumulated shifts; we accumulate by
      // diffing against the last accumulated position, not against the raw
      // previous Cartesian. To do that we need the "raw" previous Cartesian
      // (without wrap correction), which is frames[f-1].atoms[i].cartesian.
      const prevRaw = prev.atoms[i]?.cartesian ?? cart
      const disp: [number, number, number] = [cart[0] - prevRaw[0], cart[1] - prevRaw[1], cart[2] - prevRaw[2]]
      if (enable && lat) {
        const n = solveCellDelta(disp, lat)
        const wrap: [number, number, number] = [Math.round(n[0]), Math.round(n[1]), Math.round(n[2])]
        // Subtract the wrap (lattice-vector linear combination) from disp.
        applyCellShift(disp, [-wrap[0], -wrap[1], -wrap[2]], lat)
      }
      // Accumulate.
      const next: [number, number, number] = [last[0] + disp[0], last[1] + disp[1], last[2] + disp[2]]
      out[i].push(next)
    }
  }
  return out
}

/**
 * Ordinary least-squares fit of y = slope · x + intercept over the given
 * window. Returns slope/intercept/R² (or all-null if the window collapses).
 */
function olsFit(
  xs: number[],
  ys: number[],
  iMin: number,
  iMax: number,
): { slope: number; intercept: number; r2: number } | null {
  const n = iMax - iMin + 1
  if (n < 2) return null
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = iMin; i <= iMax; i++) {
    const x = xs[i]
    const y = ys[i]
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const mx = sx / n
  const my = sy / n
  const denom = sxx - n * mx * mx
  if (Math.abs(denom) < 1e-15) return null
  const slope = (sxy - n * mx * my) / denom
  const intercept = my - slope * mx
  // R²
  let ssRes = 0, ssTot = 0
  for (let i = iMin; i <= iMax; i++) {
    const pred = slope * xs[i] + intercept
    ssRes += (ys[i] - pred) ** 2
    ssTot += (ys[i] - my) ** 2
  }
  const r2 = ssTot < 1e-15 ? 0 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

export function computeMsd(frames: ReadonlyArray<XYZFrame>, options: MsdOptions = {}): MsdResult {
  const dirs = options.directions ?? 'xyz'
  const { mask, d } = axisMaskAndD(dirs)
  const F = frames.length

  // Empty / singleton trajectory → empty result.
  if (F < 2) {
    return { tau: [], per_species: {}, dimensionality: d, directions: dirs }
  }

  // Choose species set.
  const allowedSpecies = options.species
    ? new Set(options.species.map((s) => s.toUpperCase()))
    : null
  const speciesIndices: Record<string, number[]> = {}
  for (let i = 0; i < frames[0].atoms.length; i++) {
    const el = frames[0].atoms[i].element.toUpperCase()
    if (allowedSpecies && !allowedSpecies.has(el)) continue
    if (!speciesIndices[el]) speciesIndices[el] = []
    speciesIndices[el].push(i)
  }

  // Unwrap once for all species (uses lattice vectors if present).
  const unwrap = options.unwrap_pbc ?? true
  const traj = unwrapTrajectory(frames, unwrap)

  const maxTau = Math.min(options.max_tau ?? Math.floor(F / 2), F - 1)
  if (maxTau < 1) {
    return { tau: [], per_species: {}, dimensionality: d, directions: dirs }
  }

  const tau: number[] = []
  for (let t = 1; t <= maxTau; t++) tau.push(t)

  const per_species: Record<string, MsdSpeciesResult> = {}
  for (const [species, indices] of Object.entries(speciesIndices)) {
    const msd: number[] = new Array(maxTau).fill(0)
    const counts: number[] = new Array(maxTau).fill(0)
    for (const i of indices) {
      const ti = traj[i]
      // Windowed average: sum over all valid (t, t+τ) pairs.
      for (let τ = 1; τ <= maxTau; τ++) {
        let acc = 0
        let n = 0
        for (let t0 = 0; t0 + τ < ti.length; t0++) {
          const r0 = ti[t0]
          const r1 = ti[t0 + τ]
          let dx = 0
          if (mask[0]) dx += (r1[0] - r0[0]) ** 2
          if (mask[1]) dx += (r1[1] - r0[1]) ** 2
          if (mask[2]) dx += (r1[2] - r0[2]) ** 2
          acc += dx
          n += 1
        }
        if (n > 0) {
          msd[τ - 1] += acc / n
          counts[τ - 1] += 1
        }
      }
    }
    // Average across atoms of this species.
    for (let τ = 0; τ < maxTau; τ++) {
      if (counts[τ] > 0) msd[τ] /= counts[τ]
    }

    // Linear fit window: user-specified, else middle 40 %.
    let iMin = 0
    let iMax = 0
    let fit: ReturnType<typeof olsFit> = null
    if (maxTau >= 2) {
      iMin = Math.min(maxTau - 2, Math.max(0, Math.floor(maxTau * 0.3) - 1))
      iMax = Math.min(maxTau - 1, Math.max(iMin + 1, Math.floor(maxTau * 0.7) - 1))
      if (options.fit_range) {
        iMin = Math.min(maxTau - 2, Math.max(0, Math.trunc(options.fit_range[0]) - 1))
        iMax = Math.min(maxTau - 1, Math.max(iMin + 1, Math.trunc(options.fit_range[1]) - 1))
      }
      fit = olsFit(tau, msd, iMin, iMax)
    }
    per_species[species] = {
      msd,
      n_atoms: indices.length,
      fit_slope: fit?.slope ?? null,
      fit_intercept: fit?.intercept ?? null,
      fit_r_squared: fit?.r2 ?? null,
      diffusion_coefficient: fit ? fit.slope / (2 * d) : null,
      fit_tau_window: fit ? [tau[iMin], tau[iMax]] : null,
    }
  }

  return { tau, per_species, dimensionality: d, directions: dirs }
}

// Internal helpers re-exported for tests.
export const __internal__ = { axisMaskAndD, olsFit, unwrapTrajectory }
