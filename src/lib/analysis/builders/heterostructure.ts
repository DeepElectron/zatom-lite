/**
 * Heterostructure stacker.
 *
 * Given two periodic structures (current atoms + lattice), stack them along
 * z with `vacuum` separation. The two cells must share a common in-plane
 * (x,y) extent; we don't do lattice matching here — caller is expected to
 * pre-strain or supercell-match the substrate. Result is loaded as a new
 * structure replacing the viewport contents.
 */

import type { Atom } from '../../crystal/types'
import type { BuilderResult } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

interface LayerInput {
  atoms: Pick<Atom, 'element' | 'cartesian' | 'position'>[]
  lattice: Mat3
  label: string
}

export interface HeterostructureOptions {
  bottom: LayerInput
  top: LayerInput
  /** Vacuum gap above the top layer (Å). */
  vacuum: number
  /** Interlayer distance between the highest bottom atom and lowest top atom (Å). */
  interlayer_gap: number
  /** Shift the top layer in-plane to align registry. */
  top_offset?: [number, number]
}

function cartesian(atom: Pick<Atom, 'element' | 'cartesian' | 'position'>, lattice: Mat3): Vec3 {
  if (atom.cartesian) return atom.cartesian
  const [fx, fy, fz] = atom.position
  return [
    fx * lattice[0][0] + fy * lattice[1][0] + fz * lattice[2][0],
    fx * lattice[0][1] + fy * lattice[1][1] + fz * lattice[2][1],
    fx * lattice[0][2] + fy * lattice[1][2] + fz * lattice[2][2],
  ]
}

export function buildHeterostructure(opts: HeterostructureOptions): BuilderResult {
  const offset = opts.top_offset ?? [0, 0]
  const bottomCart = opts.bottom.atoms.map((a) => ({
    el: a.element,
    pos: cartesian(a, opts.bottom.lattice),
  }))
  const topCart = opts.top.atoms.map((a) => ({
    el: a.element,
    pos: cartesian(a, opts.top.lattice),
  }))

  const bottomZ = bottomCart.length ? Math.max(...bottomCart.map((a) => a.pos[2])) : 0
  const topMinZ = topCart.length ? Math.min(...topCart.map((a) => a.pos[2])) : 0
  const dz = bottomZ + opts.interlayer_gap - topMinZ

  const allAtoms = [
    ...bottomCart.map((a) => ({ el: a.el, pos: [a.pos[0], a.pos[1], a.pos[2]] as Vec3 })),
    ...topCart.map((a) => ({
      el: a.el,
      pos: [a.pos[0] + offset[0], a.pos[1] + offset[1], a.pos[2] + dz] as Vec3,
    })),
  ]
  // The new unit cell c starts from z=0. The lowest atom must be returned to z=0, otherwise it has been translated
  // The structure (minZ ≠ 0) will fall outside the periodic boundary.
  const minZ = allAtoms.length ? Math.min(...allAtoms.map((a) => a.pos[2])) : 0
  for (const atom of allAtoms) atom.pos[2] -= minZ
  const maxZ = Math.max(...allAtoms.map((a) => a.pos[2]), 0)
  // Reuse bottom's in-plane lattice; extend c to fit everything plus vacuum.
  const inPlaneA = opts.bottom.lattice[0]
  const inPlaneB = opts.bottom.lattice[1]
  const cellC: Vec3 = [0, 0, maxZ + opts.vacuum]
  const lines: string[] = []
  lines.push(String(allAtoms.length))
  const latStr = [...inPlaneA, ...inPlaneB, ...cellC].map((v) => v.toFixed(6)).join(' ')
  lines.push(`Lattice="${latStr}" Heterostructure ${opts.bottom.label}|${opts.top.label}`)
  for (const atom of allAtoms) {
    lines.push(`${atom.el} ${atom.pos[0].toFixed(6)} ${atom.pos[1].toFixed(6)} ${atom.pos[2].toFixed(6)}`)
  }
  return {
    xyz: lines.join('\n'),
    description: `Heterostructure · ${opts.bottom.label} (${bottomCart.length}) | ${opts.top.label} (${topCart.length}) · gap ${opts.interlayer_gap.toFixed(2)} Å`,
    n_atoms: allAtoms.length,
  }
}
