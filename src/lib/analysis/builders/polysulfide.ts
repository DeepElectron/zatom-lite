/**
 * Lithium polysulfide builder — Li₂Sₓ (x = 1..8).
 *
 * The discharge intermediates of a Li–S battery: a sulfur chain S_x capped by two
 * Li. For x=1 it's Li₂S (a bent Li–S–Li); for x≥2 a zig-zag S_x chain with a Li on
 * each terminal sulfur. Built as an isolated molecule (large vacuum box) for a
 * cluster/molecular DFT single-point — the species whose binding/free energies set
 * the Li–S voltage profile and the polysulfide shuttle.
 *
 *   S–S ≈ 2.05 Å (chain),  Li–S ≈ 2.15 Å (terminal cap),  S–S–S ≈ 108° zig-zag.
 *
 * Pure-parameter (x). Geometry is an idealised starting guess for relaxation, not
 * a relaxed structure.
 */
import type { BuilderResult } from './types'

export interface PolysulfideOptions {
  /** Number of sulfur atoms x in Li₂Sₓ (1–8). */
  x: number
  /** Vacuum padding around the molecule (Å). */
  vacuum?: number
}

const D_SS = 2.05
const D_LIS = 2.15
const ANGLE = (108 * Math.PI) / 180

export function buildPolysulfide(opts: PolysulfideOptions): BuilderResult {
  const x = Math.max(1, Math.min(8, Math.floor(opts.x || 2)))
  const vac = Math.max(6, opts.vacuum ?? 12)

  const atoms: Array<{ el: string; x: number; y: number; z: number }> = []

  if (x === 1) {
    // Li₂S — bent Li–S–Li (~109°), S at origin.
    const half = ANGLE / 2
    atoms.push({ el: 'S', x: 0, y: 0, z: 0 })
    atoms.push({ el: 'Li', x: D_LIS * Math.sin(half), y: D_LIS * Math.cos(half), z: 0 })
    atoms.push({ el: 'Li', x: -D_LIS * Math.sin(half), y: D_LIS * Math.cos(half), z: 0 })
  } else {
    // Zig-zag S_x chain in the x–y plane; Li caps on the two terminal sulfurs.
    const dx = D_SS * Math.sin(ANGLE / 2)
    const dy = D_SS * Math.cos(ANGLE / 2)
    const sPos: Array<[number, number]> = []
    for (let i = 0; i < x; i++) {
      sPos.push([i * dx, (i % 2 === 0 ? 0 : dy)])
    }
    for (const [sx, sy] of sPos) atoms.push({ el: 'S', x: sx, y: sy, z: 0 })
    // Li on first sulfur (pointing −y/−x) and last sulfur (pointing +y/+x).
    const [fx, fy] = sPos[0]
    const [lx, ly] = sPos[sPos.length - 1]
    atoms.push({ el: 'Li', x: fx - D_LIS * 0.7, y: fy - D_LIS * 0.7, z: 0 })
    atoms.push({ el: 'Li', x: lx + D_LIS * 0.7, y: ly + D_LIS * 0.7, z: 0 })
  }

  // Centre in a vacuum box.
  const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y), zs = atoms.map((a) => a.z)
  const minX = Math.min(...xs), minY = Math.min(...ys), minZ = Math.min(...zs)
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY, spanZ = Math.max(...zs) - minZ
  const Lx = spanX + 2 * vac, Ly = spanY + 2 * vac, Lz = spanZ + 2 * vac
  const shifted = atoms.map((a) => ({ el: a.el, x: a.x - minX + vac, y: a.y - minY + vac, z: a.z - minZ + vac }))

  const lat = [Lx, 0, 0, 0, Ly, 0, 0, 0, Lz].map((v) => v.toFixed(6)).join(' ')
  const lines: string[] = [
    String(shifted.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 Li2S${x} polysulfide (molecular, vacuum=${vac} Å)`,
  ]
  for (const a of shifted) lines.push(`${a.el} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`)
  return {
    xyz: lines.join('\n'),
    description: `Li₂S${x} polysulfide · ${shifted.length} atoms (2 Li + ${x} S) · molecular`,
    n_atoms: shifted.length,
  }
}
