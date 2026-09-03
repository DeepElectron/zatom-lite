/**
 * Single-atom catalyst (SAC) builder — one metal atom on a 2D support.
 *
 * Builds an n×n honeycomb support sheet (graphene C–C, or h-BN B/N) and places a
 * single metal atom above the central hollow site at an adsorption height. The
 * canonical SAC starting geometry for a metal-adatom / metal-on-2D single-point;
 * the true M–N₄ pyridinic site needs a di-vacancy + N substitution applied after
 * relaxation, so this is an *idealised adatom* start, not a relaxed N₄ pocket.
 *
 *   graphene a = 2.46 Å (C–C 1.42), h-BN a = 2.51 Å. Metal height ≈ 2.0 Å.
 *
 * Pure-parameter (metal + support + size). Vacuum padding along z.
 */
import type { BuilderResult } from './types'

export interface SingleAtomOptions {
  /** Adsorbed metal element, e.g. 'Pt', 'Fe', 'Ni', 'Co'. */
  metal: string
  /** Support: 'graphene' (C) or 'bn' (h-BN). */
  support?: 'graphene' | 'bn'
  /** Supercell repeats (n×n). */
  n?: number
  /** Metal adsorption height above the sheet (Å). */
  height?: number
  /** Vacuum along z (Å). */
  vacuum?: number
}

export function buildSingleAtom(opts: SingleAtomOptions): BuilderResult {
  const metal = (opts.metal || 'Pt').trim()
  const support = opts.support === 'bn' ? 'bn' : 'graphene'
  const n = Math.max(2, Math.min(8, Math.floor(opts.n ?? 4)))
  const height = Math.max(1, opts.height ?? 2.0)
  const vac = Math.max(8, opts.vacuum ?? 15)

  const a = support === 'bn' ? 2.51 : 2.46
  // Honeycomb primitive: a1=(a,0), a2=(a/2, a√3/2); two-atom basis at (0,0),(1/3,1/3).
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
        atoms.push({
          el: b.el,
          x: fx * a1[0] + fy * a2[0],
          y: fx * a1[1] + fy * a2[1],
          z: 0,
        })
      }
    }
  }

  // Metal above the centre of the sheet.
  const cx = atoms.reduce((s, p) => s + p.x, 0) / atoms.length
  const cy = atoms.reduce((s, p) => s + p.y, 0) / atoms.length
  atoms.push({ el: metal, x: cx, y: cy, z: height })

  // Vacuum box: sheet spans a*n in-plane; z gets the metal height + vacuum.
  const Lx = n * a1[0]
  const Ly = n * a2[1]
  const Lz = height + 2 * vac
  const zShift = vac
  const lat = [Lx, 0, 0, a2[0] * n, Ly, 0, 0, 0, Lz].map((v) => v.toFixed(6)).join(' ')
  const lines: string[] = [
    String(atoms.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 SAC ${metal}@${support} (${n}×${n}, h=${height} Å)`,
  ]
  for (const atom of atoms) {
    lines.push(`${atom.el} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${(atom.z + zShift).toFixed(6)}`)
  }
  return {
    xyz: lines.join('\n'),
    description: `SAC ${metal}@${support} · ${n}×${n} · ${atoms.length} atoms (idealised adatom)`,
    n_atoms: atoms.length,
  }
}
