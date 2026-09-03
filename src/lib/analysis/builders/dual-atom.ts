/**
 * Dual-atom catalyst (DAC) builder — two metal atoms on a 2D support.
 *
 * Like the single-atom builder but anchors a homo- or hetero-metal PAIR on a
 * graphene / h-BN support, separated by a chosen M–M distance above the central
 * hollow. The starting geometry for a M₁M₂@support dual-atom-catalyst single-point
 * (idealised adatom dimer — apply N-doping + relax for a true M₂–N₆ pocket).
 */
import type { BuilderResult } from './types'

export interface DualAtomOptions {
  /** First metal element. */
  metalA: string
  /** Second metal element (may equal metalA for a homo-dimer). */
  metalB?: string
  /** Support: 'graphene' (C) or 'bn' (h-BN). */
  support?: 'graphene' | 'bn'
  /** Supercell repeats (n×n). */
  n?: number
  /** Metal adsorption height above the sheet (Å). */
  height?: number
  /** M–M separation (Å). */
  separation?: number
  /** Vacuum along z (Å). */
  vacuum?: number
}

export function buildDualAtom(opts: DualAtomOptions): BuilderResult {
  const mA = (opts.metalA || 'Fe').trim()
  const mB = (opts.metalB || mA).trim()
  const support = opts.support === 'bn' ? 'bn' : 'graphene'
  const n = Math.max(2, Math.min(8, Math.floor(opts.n ?? 5)))
  const height = Math.max(1, opts.height ?? 1.9)
  const sep = Math.max(1.5, opts.separation ?? 2.5)
  const vac = Math.max(8, opts.vacuum ?? 15)

  const a = support === 'bn' ? 2.51 : 2.46
  const a1: [number, number] = [a, 0]
  const a2: [number, number] = [a / 2, (a * Math.sqrt(3)) / 2]
  const [elA, elB] = support === 'bn' ? ['B', 'N'] : ['C', 'C']
  const basis: Array<{ el: string; f: [number, number] }> = [
    { el: elA, f: [0, 0] },
    { el: elB, f: [1 / 3, 1 / 3] },
  ]

  const atoms: Array<{ el: string; x: number; y: number; z: number }> = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (const b of basis) {
        const fx = b.f[0] + i, fy = b.f[1] + j
        atoms.push({ el: b.el, x: fx * a1[0] + fy * a2[0], y: fx * a1[1] + fy * a2[1], z: 0 })
      }
    }
  }

  // Metal pair centred on the sheet, separated along x by `sep`.
  const cx = atoms.reduce((s, p) => s + p.x, 0) / atoms.length
  const cy = atoms.reduce((s, p) => s + p.y, 0) / atoms.length
  atoms.push({ el: mA, x: cx - sep / 2, y: cy, z: height })
  atoms.push({ el: mB, x: cx + sep / 2, y: cy, z: height })

  const Lx = n * a1[0]
  const Ly = n * a2[1]
  const Lz = height + 2 * vac
  const lat = [Lx, 0, 0, a2[0] * n, Ly, 0, 0, 0, Lz].map((v) => v.toFixed(6)).join(' ')
  const lines: string[] = [
    String(atoms.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 DAC ${mA}${mB}@${support} (${n}×${n}, sep=${sep} Å)`,
  ]
  for (const atom of atoms) {
    lines.push(`${atom.el} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${(atom.z + vac).toFixed(6)}`)
  }
  return {
    xyz: lines.join('\n'),
    description: `DAC ${mA}${mB}@${support} · ${n}×${n} · ${atoms.length} atoms (M–M ${sep} Å)`,
    n_atoms: atoms.length,
  }
}
