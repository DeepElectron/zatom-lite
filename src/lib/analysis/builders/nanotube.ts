/**
 * (n, m) graphene-derived nanotube roller.
 *
 * The standard graphene primitive vectors:
 *   a1 = a · (√3, 0)              with a = 2.46 Å (C–C bond × √3)
 *   a2 = a · (√3/2, 3/2)          rotated 60°.
 * Chiral vector C = n a1 + m a2 has |C| = a · √(n² + n·m + m²). Roll the sheet
 * along that vector and the resulting tube has circumference |C|, so radius
 * r = |C|/(2π). Translational vector T is perpendicular to C in the sheet plane
 * with length L_T = |C| · √3 / gcd(2n+m, 2m+n).
 *
 * For BNNT, use ('B', 'N') as the basis elements; for CNT use ('C','C').
 */

import type { BuilderResult } from './types'

const A_CC = 1.42 // C–C bond length in Å

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b)
}

export interface NanotubeOptions {
  n: number
  m: number
  /** Number of translational unit cells to repeat along the tube axis. */
  n_units?: number
  /** Bond length override (default 1.42 Å for graphene). */
  bond_length?: number
  /** Tuple of two element symbols. CNT = ['C','C']; BNNT = ['B','N']. */
  elements?: [string, string]
  /** Vacuum padding (Å) around the tube in the perpendicular directions. */
  vacuum?: number
}

export function buildNanotube(opts: NanotubeOptions): BuilderResult {
  const n = Math.max(1, Math.floor(opts.n))
  const m = Math.max(0, Math.floor(opts.m))
  const nUnits = Math.max(1, Math.floor(opts.n_units ?? 4))
  const a = (opts.bond_length ?? A_CC) * Math.sqrt(3)
  const [elA, elB] = opts.elements ?? ['C', 'C']
  const vacuum = opts.vacuum ?? 10

  const chiralLength = a * Math.sqrt(n * n + n * m + m * m)
  const radius = chiralLength / (2 * Math.PI)

  // Reduce (2n+m, 2m+n) to find translation period.
  const dR = gcd(2 * n + m, 2 * m + n)
  const tx = (2 * m + n) / dR
  const ty = -(2 * n + m) / dR
  const tLen = a * Math.sqrt(tx * tx + tx * ty + ty * ty)
  // Number of hexagons in one chiral × translational rectangle:
  const nHex = (2 * (n * n + n * m + m * m)) / dR
  const atomsPerUnit = Math.round(2 * nHex)

  // Build the sheet basis vectors in 2D
  // a1 = (sqrt(3)/2, -1/2) * a ;  a2 = (sqrt(3)/2, +1/2) * a   (using armchair-x convention)
  const a1: [number, number] = [Math.sqrt(3) / 2 * a, -a / 2]
  const a2: [number, number] = [Math.sqrt(3) / 2 * a, a / 2]
  // Chiral vector and translational vector in sheet 2D coords.
  const cVec: [number, number] = [n * a1[0] + m * a2[0], n * a1[1] + m * a2[1]]
  const tVec: [number, number] = [tx * a1[0] + ty * a2[0], tx * a1[1] + ty * a2[1]]
  // Basis atoms in graphene (two sites per primitive).
  const basis: Array<{ el: string; pos: [number, number] }> = [
    { el: elA, pos: [0, 0] },
    { el: elB, pos: [(a1[0] + a2[0]) / 3, (a1[1] + a2[1]) / 3] },
  ]
  // Enumerate sites in a generous range that covers the chiral×translation rectangle.
  const enumeration: Array<{ el: string; pos: [number, number] }> = []
  const span = Math.ceil(Math.max(Math.abs(n), Math.abs(m), Math.abs(tx), Math.abs(ty)) + 2)
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const ox = i * a1[0] + j * a2[0]
      const oy = i * a1[1] + j * a2[1]
      for (const b of basis) {
        enumeration.push({ el: b.el, pos: [b.pos[0] + ox, b.pos[1] + oy] })
      }
    }
  }
  // Project onto the (c, t) basis to keep sites with 0 ≤ s < 1 and 0 ≤ u < 1.
  const cLenSq = cVec[0] ** 2 + cVec[1] ** 2
  const tLenSq = tVec[0] ** 2 + tVec[1] ** 2
  const kept: Array<{ el: string; s: number; u: number }> = []
  for (const site of enumeration) {
    const s = (site.pos[0] * cVec[0] + site.pos[1] * cVec[1]) / cLenSq
    const u = (site.pos[0] * tVec[0] + site.pos[1] * tVec[1]) / tLenSq
    if (s >= -1e-6 && s < 1 - 1e-6 && u >= -1e-6 && u < 1 - 1e-6) {
      kept.push({ el: site.el, s, u })
    }
  }

  // Roll into 3D: angle = 2π · s, axial = u · tLen.
  const lines: string[] = []
  const cellLen = nUnits * tLen
  const totalAtoms = kept.length * nUnits
  lines.push(String(totalAtoms))
  // Cell: x = 2(r + vac), y = 2(r + vac), z = tube axis length.
  const cellX = 2 * (radius + vacuum)
  const cellY = 2 * (radius + vacuum)
  lines.push(`Lattice="${cellX} 0 0 0 ${cellY} 0 0 0 ${cellLen}" Properties=species:S:1:pos:R:3 (${n},${m}) nanotube`)
  for (let u = 0; u < nUnits; u++) {
    for (const site of kept) {
      const theta = 2 * Math.PI * site.s
      const x = (radius + 0) * Math.cos(theta) + cellX / 2
      const y = (radius + 0) * Math.sin(theta) + cellY / 2
      const z = site.u * tLen + u * tLen
      lines.push(`${site.el} ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`)
    }
  }

  return {
    xyz: lines.join('\n'),
    description: `(${n},${m}) ${elA}${elA === elB ? '' : elB} nanotube · r = ${radius.toFixed(2)} Å · ${nUnits}×T = ${cellLen.toFixed(2)} Å · ${totalAtoms} atoms (predicted ${atomsPerUnit * nUnits})`,
    n_atoms: totalAtoms,
  }
}
