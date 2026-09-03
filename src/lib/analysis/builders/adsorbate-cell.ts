/**
 * Resolve the cell written with an adsorbate structure.
 *
 * Supercell atoms are already expanded, while `latticeVectors` still describes
 * the primitive cell, so the emitted lattice must include the supercell repeat.
 * The normal cell extent must also leave `vacuumA` between the combined
 * slab/adsorbate and its next periodic image.
 */

import type { LatticeVectors, SupercellParams } from '../../crystal/types'

export type LatticeRows = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
]

/** Conventional minimum vacuum for a slab, in Å. */
export const DEFAULT_ADSORBATE_VACUUM_A = 10

type Vec3 = [number, number, number]

const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k]

const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
]

const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]

const norm = (v: Vec3): number => Math.sqrt(dot(v, v))

export interface ResolveAdsorbateCellOptions {
  latticeVectors: LatticeVectors | null | undefined
  supercell: SupercellParams | null | undefined
  /** Cartesian coordinates of the slab and new adsorbate. */
  atomCartesians: readonly Vec3[]
  /** Target vacuum thickness in Å; zero disables vacuum expansion. */
  vacuumA?: number
}

/** Return the cell to emit, or `undefined` for an aperiodic XYZ structure. */
export function resolveAdsorbateCell(
  options: ResolveAdsorbateCellOptions,
): LatticeRows | undefined {
  const { latticeVectors, supercell, atomCartesians } = options
  if (!latticeVectors) return undefined

  // Expand the primitive vectors to the explicit cell represented by the atoms.
  const nx = Math.max(1, supercell?.nx ?? 1)
  const ny = Math.max(1, supercell?.ny ?? 1)
  const nz = Math.max(1, supercell?.nz ?? 1)
  const A = scale(latticeVectors.a as Vec3, nx)
  const B = scale(latticeVectors.b as Vec3, ny)
  let C = scale(latticeVectors.c as Vec3, nz)

  const vacuumA = options.vacuumA ?? DEFAULT_ADSORBATE_VACUUM_A
  if (vacuumA <= 0 || atomCartesians.length === 0) return [A, B, C]

  // Measure height along the surface normal. In a skewed cell, |c| may
  // overestimate the available normal-space vacuum.
  const nRaw = cross(A, B)
  const nLen = norm(nRaw)
  if (nLen < 1e-9) return [A, B, C]
  const nHat: Vec3 = [nRaw[0] / nLen, nRaw[1] / nLen, nRaw[2] / nLen]

  // The projection of c onto the normal is the physical cell height.
  const height = Math.abs(dot(C, nHat))
  if (height < 1e-9) return [A, B, C]

  let lo = Infinity
  let hi = -Infinity
  for (const p of atomCartesians) {
    const proj = dot(p, nHat)
    if (proj < lo) lo = proj
    if (proj > hi) hi = proj
  }
  const thickness = hi - lo
  const needed = thickness + vacuumA
  if (height >= needed) return [A, B, C]

  // Expand only; sufficient existing vacuum must leave the cell unchanged.
  C = scale(C, needed / height)
  return [A, B, C]
}
