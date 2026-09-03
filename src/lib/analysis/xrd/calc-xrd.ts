import { ATOMIC_SCATTERING_PARAMS } from './atomic-scattering-params'
import {
  WAVELENGTHS,
  type Hkl,
  type HklObj,
  type RadiationKey,
  type XrdOptions,
  type XrdPattern,
  type XrdStructure,
} from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const TWO_THETA_TOL = 1e-5
const SCALED_INTENSITY_TOL = 1e-3
const HKL_ENUMERATION_CAP = 512

function matrixDet3(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function matrixInverse3(m: Mat3): Mat3 | null {
  const det = matrixDet3(m)
  if (Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * inv,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * inv,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * inv,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * inv,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * inv,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * inv,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * inv,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * inv,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * inv,
    ],
  ]
}

function transpose3(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ]
}

function vecLen(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

/**
 * Group Miller indices by absolute-value permutations (cubic equivalence).
 * Returns Map<repr_key, multiplicity> where repr_key is "h,k,l" of the chosen
 * representative. Matches pymatgen.get_unique_families ordering for downstream
 * compatibility.
 */
export function getUniqueFamilies(hkls: Hkl[]): Map<string, number> {
  const groups = new Map<string, Hkl[]>()
  for (const hkl of hkls) {
    const key = hkl.map((v) => Math.abs(v)).sort((a, b) => a - b).join(',')
    const list = groups.get(key)
    if (list) list.push(hkl)
    else groups.set(key, [hkl])
  }
  const out = new Map<string, number>()
  for (const group of groups.values()) {
    let rep = group[0]
    for (const candidate of group) {
      const better =
        candidate[0] > rep[0] ||
        (candidate[0] === rep[0] && candidate[1] > rep[1]) ||
        (candidate[0] === rep[0] && candidate[1] === rep[1] && candidate[2] > rep[2])
      if (better) rep = candidate
    }
    out.set(rep.join(','), group.length)
  }
  return out
}

function reciprocalRows(lattice: Mat3): Mat3 {
  const inv = matrixInverse3(lattice)
  if (!inv) throw new Error('Singular lattice — cannot compute reciprocal vectors')
  return transpose3(inv)
}

interface RecipPoint {
  hkl: Hkl
  g_norm: number
}

function enumerateReciprocalPoints(
  recip: Mat3,
  minRadius: number,
  maxRadius: number,
): RecipPoint[] {
  const [b1, b2, b3] = recip
  const n1 = Math.max(vecLen(b1), 1e-12)
  const n2 = Math.max(vecLen(b2), 1e-12)
  const n3 = Math.max(vecLen(b3), 1e-12)
  const hMax = Math.ceil(maxRadius / n1) + 2
  const kMax = Math.ceil(maxRadius / n2) + 2
  const lMax = Math.ceil(maxRadius / n3) + 2
  if (Math.max(hMax, kMax, lMax) > HKL_ENUMERATION_CAP) {
    throw new Error(
      `XRD enumeration would exceed HKL cap (${HKL_ENUMERATION_CAP}); cell is unusually small for this 2θ range.`,
    )
  }

  const points: RecipPoint[] = []
  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue
        const gx = h * b1[0] + k * b2[0] + l * b3[0]
        const gy = h * b1[1] + k * b2[1] + l * b3[1]
        const gz = h * b1[2] + k * b2[2] + l * b3[2]
        const g_norm = Math.hypot(gx, gy, gz)
        if (g_norm < minRadius || g_norm > maxRadius) continue
        points.push({ hkl: [h, k, l], g_norm })
      }
    }
  }
  points.sort((a, b) => {
    if (a.g_norm !== b.g_norm) return a.g_norm - b.g_norm
    // Tie-break by hkl descending to match pymatgen ordering.
    if (a.hkl[0] !== b.hkl[0]) return b.hkl[0] - a.hkl[0]
    if (a.hkl[1] !== b.hkl[1]) return b.hkl[1] - a.hkl[1]
    return b.hkl[2] - a.hkl[2]
  })
  return points
}

function resolveWavelength(input: number | RadiationKey | undefined): number {
  const value = input ?? 'CuKa'
  if (typeof value === 'number') return value
  const looked = WAVELENGTHS[value as RadiationKey]
  if (!looked) throw new Error(`Unknown radiation source: ${String(value)}`)
  return looked
}

/**
 * Powder XRD pattern: 2θ peaks + scaled intensities.
 *
 * Algorithm (after pymatgen.analysis.diffraction.xrd):
 *   1. Enumerate reciprocal-lattice vectors G with |G| ∈ [r_min, r_max], where
 *      r = 2 sin(θ)/λ comes from the Bragg condition.
 *   2. For each G, compute structure factor F(G) = Σ_j f_j(s) · occu_j ·
 *      exp(2πi G·r_j) · exp(-B_j · s²).
 *   3. Apply Lorentz–polarization correction
 *      LP(θ) = (1 + cos²2θ) / (sin²θ · |cosθ|).
 *   4. Merge peaks within `peak_merge_tol` degrees of 2θ; collapse |hkl|
 *      permutations into family representatives.
 *   5. Optionally rescale so the strongest peak = 100.
 *
 * Symmetry refinement (symprec) is intentionally NOT implemented — we operate
 * on the primitive cell as-given. Caller can pre-reduce via spglib if needed.
 */
export function computeXrdPattern(structure: XrdStructure, options: XrdOptions = {}): XrdPattern {
  const wavelength = resolveWavelength(options.wavelength)
  const peakMergeTol = options.peak_merge_tol ?? TWO_THETA_TOL
  const scaledTol = options.scaled_intensity_tol ?? SCALED_INTENSITY_TOL
  const dwFactors = options.debye_waller_factors ?? {}

  const recip = reciprocalRows(structure.lattice)

  const twoThetaRange = options.two_theta_range === null ? null : (options.two_theta_range ?? [0, 180])
  let minRadius: number
  let maxRadius: number
  if (twoThetaRange === null) {
    minRadius = 0
    maxRadius = 2 / wavelength
  } else {
    const [tMin, tMax] = twoThetaRange
    minRadius = (2 * Math.sin(((tMin / 2) * Math.PI) / 180)) / wavelength
    maxRadius = (2 * Math.sin(((tMax / 2) * Math.PI) / 180)) / wavelength
  }

  const points = enumerateReciprocalPoints(recip, minRadius, maxRadius)

  // Flatten sites with scattering coefficients + occupancy + DW factors.
  type Coeffs = { a: number[]; b: number[] }
  const coeffs: Coeffs[] = []
  const fracs: [number, number, number][] = []
  const occus: number[] = []
  const dws: number[] = []

  for (const site of structure.sites) {
    const raw = ATOMIC_SCATTERING_PARAMS[site.element]
    if (!raw) {
      throw new Error(`No atomic scattering coefficients for element "${site.element}".`)
    }
    coeffs.push({
      a: raw.map(([a]) => a),
      b: raw.map(([_, b]) => b),
    })
    fracs.push(site.frac)
    occus.push(site.occupancy ?? 1)
    dws.push(dwFactors[site.element] ?? 0)
  }

  interface PeakAccum {
    intensity: number
    hkls: Hkl[]
    d_hkl: number
  }
  const peakByAngle = new Map<number, PeakAccum>()
  const knownAngles: number[] = []

  for (const point of points) {
    const { hkl, g_norm } = point
    if (g_norm === 0) continue
    const asinArg = Math.min(1, Math.max(-1, (wavelength * g_norm) / 2))
    const theta = Math.asin(asinArg)
    const s = g_norm / 2
    const s2 = s * s

    let fReal = 0
    let fImag = 0
    for (let j = 0; j < coeffs.length; j++) {
      const { a, b } = coeffs[j]
      let fScatter = 0
      const terms = Math.min(a.length, b.length)
      for (let t = 0; t < terms; t++) {
        fScatter += a[t] * Math.exp(-b[t] * s2)
      }
      const dw = Math.exp(-dws[j] * s2)
      const phase = 2 * Math.PI * (hkl[0] * fracs[j][0] + hkl[1] * fracs[j][1] + hkl[2] * fracs[j][2])
      const weight = fScatter * occus[j] * dw
      fReal += weight * Math.cos(phase)
      fImag += weight * Math.sin(phase)
    }

    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)
    const denom = Math.max(sinTheta * sinTheta * Math.abs(cosTheta), 1e-12)
    const lp = (1 + Math.cos(2 * theta) ** 2) / denom
    const intensity = (fReal * fReal + fImag * fImag) * lp
    const twoTheta = (2 * theta * 180) / Math.PI

    let merged: number | null = null
    for (const known of knownAngles) {
      if (Math.abs(known - twoTheta) < peakMergeTol) {
        merged = known
        break
      }
    }
    if (merged !== null) {
      const acc = peakByAngle.get(merged)
      if (acc) {
        acc.intensity += intensity
        acc.hkls.push([hkl[0], hkl[1], hkl[2]])
      }
    } else {
      peakByAngle.set(twoTheta, { intensity, hkls: [[hkl[0], hkl[1], hkl[2]]], d_hkl: 1 / g_norm })
      knownAngles.push(twoTheta)
    }
  }

  if (peakByAngle.size === 0) return { x: [], y: [] }

  const allIntensities = Array.from(peakByAngle.values()).map((p) => p.intensity)
  const maxIntensity = Math.max(...allIntensities, 1e-30)

  const sortedAngles = Array.from(peakByAngle.keys()).sort((a, b) => a - b)
  const xs: number[] = []
  const ys: number[] = []
  const hklsOut: HklObj[][] = []
  const dOut: number[] = []
  for (const angle of sortedAngles) {
    const acc = peakByAngle.get(angle)!
    const scaled = (acc.intensity / maxIntensity) * 100
    if (scaled <= scaledTol) continue
    xs.push(angle)
    ys.push(acc.intensity)
    const fam = getUniqueFamilies(acc.hkls)
    const famArray: HklObj[] = []
    for (const [key, multiplicity] of fam.entries()) {
      const repr = key.split(',').map((n) => parseInt(n, 10)) as Hkl
      famArray.push({ hkl: repr, multiplicity })
    }
    hklsOut.push(famArray)
    dOut.push(acc.d_hkl)
  }

  if (options.scaled ?? true) {
    const yMax = Math.max(1, ...ys)
    for (let i = 0; i < ys.length; i++) ys[i] = (ys[i] / yMax) * 100
  }

  return { x: xs, y: ys, hkls: hklsOut, d_hkls: dOut }
}
