import { ATOMIC_SCATTERING_PARAMS } from '../xrd/atomic-scattering-params'
import type { XrdStructure } from '../xrd/types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const HKL_CAP = 256

export interface EdiffOptions {
  /** Max |g| (Å⁻¹) to enumerate (default 12). */
  gMax?: number
  /** Number of radial bins (default 256). */
  nBins?: number
  /** Beam voltage (kV) — informational; the radial profile itself does not need λ. */
  voltage_kV?: number
}

export interface EdiffPattern {
  /** |g| bin centers (Å⁻¹). */
  x: number[]
  /** Radially-averaged kinematic electron-diffraction intensity (normalized to 100). */
  y: number[]
}

function matrixInverse3(m: Mat3): Mat3 | null {
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  if (Math.abs(det) < 1e-12) return null
  const i = 1 / det
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * i,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * i,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * i,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * i,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * i,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * i,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * i,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * i,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * i,
    ],
  ]
}

function reciprocalRows(lattice: Mat3): Mat3 {
  const inv = matrixInverse3(lattice)
  if (!inv) throw new Error('Singular lattice — cannot compute reciprocal vectors')
  // transpose(inv): rows = reciprocal vectors b1,b2,b3 (crystallographer convention, no 2π)
  return [
    [inv[0][0], inv[1][0], inv[2][0]],
    [inv[0][1], inv[1][1], inv[2][1]],
    [inv[0][2], inv[1][2], inv[2][2]],
  ]
}

/**
 * Kinematic diffraction RADIAL profile I(|g|) — a powder-like radial average of
 * |F(g)|², NOT a zone-axis SAED spot pattern (PRD §5.3). Same reciprocal-lattice
 * + structure-factor machinery as XRD, plotted directly against |g| (no Bragg-2θ,
 * no Lorentz-polarization).
 *
 * SCATTERING FACTOR — honest limitation: this uses the X-ray atomic form factor
 * f_x(s) = Σ aᵢ exp(-bᵢ s²) from the shared Cromer–Mann table (same as calc-xrd).
 * **Peak positions / reflections (d-spacings) are exact** — they depend only on the
 * lattice — which is the primary use (crystalline/phase identification). Relative
 * intensities are X-ray-form-factor-weighted, an electron-diffraction *proxy*.
 * A true electron scattering factor (Mott–Bethe needs f_x in electron units with
 * f_x(0)=Z, or a Doyle–Turner/Kirkland electron-coefficient table) is a follow-up;
 * this table's Σaᵢ is NOT the atomic number, so Mott–Bethe was intentionally NOT
 * applied here rather than computed with inconsistent units.
 */
export function computeEdiffRadial(structure: XrdStructure, options: EdiffOptions = {}): EdiffPattern {
  const gMax = options.gMax ?? 12
  const nBins = options.nBins ?? 256
  const recip = reciprocalRows(structure.lattice as Mat3)
  const [b1, b2, b3] = recip
  const n1 = Math.max(Math.hypot(b1[0], b1[1], b1[2]), 1e-12)
  const n2 = Math.max(Math.hypot(b2[0], b2[1], b2[2]), 1e-12)
  const n3 = Math.max(Math.hypot(b3[0], b3[1], b3[2]), 1e-12)
  const hMax = Math.ceil(gMax / n1) + 1
  const kMax = Math.ceil(gMax / n2) + 1
  const lMax = Math.ceil(gMax / n3) + 1
  if (Math.max(hMax, kMax, lMax) > HKL_CAP) {
    throw new Error(`Electron-diffraction enumeration exceeds cap (${HKL_CAP}); gMax too large for this cell.`)
  }

  const sites = structure.sites.map((site) => {
    const raw = ATOMIC_SCATTERING_PARAMS[site.element]
    if (!raw) throw new Error(`No atomic scattering coefficients for element "${site.element}".`)
    const a = raw.map(([ai]) => ai)
    const b = raw.map(([, bi]) => bi)
    return { a, b, frac: site.frac, occ: site.occupancy ?? 1 }
  })

  const bins = new Array<number>(nBins).fill(0)
  const binW = gMax / nBins
  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue
        const gx = h * b1[0] + k * b2[0] + l * b3[0]
        const gy = h * b1[1] + k * b2[1] + l * b3[1]
        const gz = h * b1[2] + k * b2[2] + l * b3[2]
        const g = Math.hypot(gx, gy, gz)
        if (g <= 0 || g > gMax) continue
        const s2 = (g / 2) * (g / 2)
        let fReal = 0
        let fImag = 0
        for (const st of sites) {
          let fx = 0
          for (let t = 0; t < st.a.length; t++) fx += st.a[t] * Math.exp(-st.b[t] * s2)
          const phase = 2 * Math.PI * (h * st.frac[0] + k * st.frac[1] + l * st.frac[2])
          const w = fx * st.occ
          fReal += w * Math.cos(phase)
          fImag += w * Math.sin(phase)
        }
        const bin = Math.min(nBins - 1, Math.floor(g / binW))
        bins[bin] += fReal * fReal + fImag * fImag
      }
    }
  }

  const maxI = Math.max(...bins, 1e-30)
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < nBins; i++) {
    x.push((i + 0.5) * binW)
    y.push((bins[i] / maxI) * 100)
  }
  return { x, y }
}
