/**
 * Cubic perovskite ABX₃ builder (Pm-3m).
 *
 * The textbook cubic perovskite: A on the cube corners, B at the body centre,
 * X on the three face centres — 5 atoms per cell, stoichiometry ABX₃.
 *
 *   A: (0,0,0)
 *   B: (½,½,½)
 *   X: (½,½,0), (½,0,½), (0,½,½)
 *
 * Pure-parameter (lattice constant a + the three elements). An optional n×n×n
 * supercell tiles the cell. Tilting/octahedral rotations (orthorhombic GdFeO₃,
 * tetragonal) are NOT applied — this is the ideal cubic aristotype.
 */
import type { BuilderResult } from './types'

export interface PerovskiteOptions {
  /** Cubic lattice constant a (Å). */
  a: number
  /** A-site (corner) element, e.g. 'Sr', 'Ba', 'Cs'. */
  elementA?: string
  /** B-site (body-centre) element, e.g. 'Ti', 'Zr', 'Pb'. */
  elementB?: string
  /** X-site (anion, face-centre) element, e.g. 'O', 'Cl', 'Br'. */
  elementX?: string
  /** Supercell tiling (n×n×n). */
  supercell?: number
}

export function buildPerovskite(opts: PerovskiteOptions): BuilderResult {
  const a = opts.a > 0 ? opts.a : 3.9
  const A = (opts.elementA || 'Sr').trim()
  const B = (opts.elementB || 'Ti').trim()
  const X = (opts.elementX || 'O').trim()
  const n = Math.max(1, Math.min(8, Math.floor(opts.supercell ?? 1)))

  // Fractional basis of the 5-atom cubic cell.
  const basis: Array<{ el: string; f: [number, number, number] }> = [
    { el: A, f: [0, 0, 0] },
    { el: B, f: [0.5, 0.5, 0.5] },
    { el: X, f: [0.5, 0.5, 0] },
    { el: X, f: [0.5, 0, 0.5] },
    { el: X, f: [0, 0.5, 0.5] },
  ]

  const out: Array<{ el: string; x: number; y: number; z: number }> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        for (const b of basis) {
          out.push({
            el: b.el,
            x: (b.f[0] + i) * a,
            y: (b.f[1] + j) * a,
            z: (b.f[2] + k) * a,
          })
        }
      }
    }
  }

  const L = n * a
  const lat = [L, 0, 0, 0, L, 0, 0, 0, L].map((v) => v.toFixed(6)).join(' ')
  const lines: string[] = [
    String(out.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 cubic perovskite ${A}${B}${X}3 (a=${a} Å, ${n}×${n}×${n})`,
  ]
  for (const atom of out) {
    lines.push(`${atom.el} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${atom.z.toFixed(6)}`)
  }
  return {
    xyz: lines.join('\n'),
    description: `Cubic perovskite ${A}${B}${X}₃ · a = ${a} Å · ${n}×${n}×${n} · ${out.length} atoms`,
    n_atoms: out.length,
  }
}
