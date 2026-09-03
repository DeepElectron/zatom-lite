/**
 * Pure coordinate-only structure placement: wrap, center, and align. These
 * operations preserve elements, bonds, and lattice. Drag-boundary policy remains
 * in `applyBoundaryToAtoms`; both paths share `wrapFractional`.
 */

import type { Atom, LatticeVectors } from './types'
import { cartesianToFractional, fractionalToCartesian, wrapFractional } from './lattice'

/**
 * Periodic switch, the shape is consistent with periodicDirs of view-settings-slice.
 */
export interface PeriodicDirs {
  a: boolean
  b: boolean
  c: boolean
}

type Vec3 = [number, number, number]

function cartOf(atom: Atom): Vec3 {
  return (atom.cartesian ?? atom.position) as Vec3
}

/**
 * Wrap only periodic axes and clear display-image offsets. Wrapping an aperiodic
 * vacuum axis would tear the structure across a physical boundary.
 */
export function wrapAtomsIntoCell(
  atoms: Atom[],
  latticeVectors: LatticeVectors,
  periodicDirs: PeriodicDirs,
): Atom[] {
  const axisOn: [boolean, boolean, boolean] = [periodicDirs.a, periodicDirs.b, periodicDirs.c]
  if (!axisOn[0] && !axisOn[1] && !axisOn[2]) return atoms

  return atoms.map((atom) => {
    const frac = cartesianToFractional(cartOf(atom), latticeVectors)
    const wrapped: Vec3 = [
      axisOn[0] ? wrapFractional(frac[0]) : frac[0],
      axisOn[1] ? wrapFractional(frac[1]) : frac[1],
      axisOn[2] ? wrapFractional(frac[2]) : frac[2],
    ]
    const moved =
      wrapped[0] !== frac[0] || wrapped[1] !== frac[1] || wrapped[2] !== frac[2]
    if (!moved && !atom.displayImage) return atom

    const next: Atom = {
      ...atom,
      position: wrapped,
      cartesian: fractionalToCartesian(wrapped, latticeVectors),
    }
    delete next.displayImage
    return next
  })
}

/** Cartesian center of the structure's visual bounding box. */
function boundingBoxCenter(atoms: Atom[]): Vec3 {
  let min: Vec3 = [Infinity, Infinity, Infinity]
  let max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const atom of atoms) {
    const c = cartOf(atom)
    min = [Math.min(min[0], c[0]), Math.min(min[1], c[1]), Math.min(min[2], c[2])]
    max = [Math.max(max[0], c[0]), Math.max(max[1], c[1]), Math.max(max[2], c[2])]
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

/**
 * Translate the entire structure so that the center of the bounding box falls on the target. Rigid body operation, the internal geometry remains completely unchanged.
 */
function centerAtomsOn(atoms: Atom[], target: Vec3, latticeVectors: LatticeVectors): Atom[] {
  if (atoms.length === 0) return atoms

  const center = boundingBoxCenter(atoms)
  const delta: Vec3 = [target[0] - center[0], target[1] - center[1], target[2] - center[2]]
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) return atoms

  return translateAll(atoms, delta, latticeVectors)
}

/**
 * Translate the entire structure so that its geometric center lies at the cell center (fractional coordinates 0.5, 0.5, 0.5).
 *
 * Only meaningful for **periodic structures**. In aperiodic mode, the unit cell does not participate in rendering (crystal-scene's
 * effectiveShowLattice requires periodic), centering a cell that does not exist on the screen is a blind operation,
 * The amount of displacement also depends on the default lattice parameters which are never set by the user - use centerAtomsAtOrigin in that case.
 */
export function centerAtomsInCell(atoms: Atom[], latticeVectors: LatticeVectors): Atom[] {
  return centerAtomsOn(atoms, fractionalToCartesian([0.5, 0.5, 0.5], latticeVectors), latticeVectors)
}

/**
 * Translate the entire structure so that its geometric center falls on the Cartesian origin.
 *
 * This is the correct meaning of "centered" in non-periodic (numerator) mode: the origin is the reference point of the camera and axis indicators,
 * Also the only anchor that remains visible and predictable without a unit cell.
 */
export function centerAtomsAtOrigin(atoms: Atom[], latticeVectors: LatticeVectors): Atom[] {
  return centerAtomsOn(atoms, [0, 0, 0], latticeVectors)
}

/**
 * Target axis: Cartesian three-axis.
 */
export type AlignAxis = 'x' | 'y' | 'z'

const AXIS_VECTOR: Record<AlignAxis, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}

/**
 * The rigid body rotates the entire structure so that the vector fromId → toId is aligned with the specified Cartesian axis.
 *
 * Rotate around the fromId atom (rather than around the origin or center of mass) - the first atom selected by the user is his mental anchor point,
 * That atom stays in place as you orbit it, making it visually predictable.
 *
 * Note: **should not be called under periodic structure**. The lattice vector does not follow the rotation, and rotating atoms will destroy the periodicity.
 * Get something that is not equivalent to the original structure. It is the caller's responsibility to disable this operation in periodic mode.
 */
export function alignVectorToAxis(
  atoms: Atom[],
  fromId: string,
  toId: string,
  axis: AlignAxis,
  latticeVectors: LatticeVectors,
): Atom[] {
  const from = atoms.find((a) => a.id === fromId)
  const to = atoms.find((a) => a.id === toId)
  if (!from || !to) return atoms

  const origin = cartOf(from)
  const tip = cartOf(to)
  const v: Vec3 = [tip[0] - origin[0], tip[1] - origin[1], tip[2] - origin[2]]
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-9) return atoms

  const u: Vec3 = [v[0] / len, v[1] / len, v[2] / len]
  const t = AXIS_VECTOR[axis]
  const dot = u[0] * t[0] + u[1] * t[1] + u[2] * t[2]

  // Does not move when aligned (including reverse). The opposite direction counts as alignment: the axis is undirected, and flipping it 180° will only confuse the user.
  if (Math.abs(dot) > 1 - 1e-9) return atoms

  // Rodrigues rotation: axis = u × t, angle = acos(dot)
  const k: Vec3 = [
    u[1] * t[2] - u[2] * t[1],
    u[2] * t[0] - u[0] * t[2],
    u[0] * t[1] - u[1] * t[0],
  ]
  const kLen = Math.hypot(k[0], k[1], k[2])
  if (kLen < 1e-12) return atoms
  const kn: Vec3 = [k[0] / kLen, k[1] / kLen, k[2] / kLen]
  const cos = Math.max(-1, Math.min(1, dot))
  const sin = Math.sqrt(1 - cos * cos)

  return atoms.map((atom) => {
    const c = cartOf(atom)
    const p: Vec3 = [c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]]
    const kCrossP: Vec3 = [
      kn[1] * p[2] - kn[2] * p[1],
      kn[2] * p[0] - kn[0] * p[2],
      kn[0] * p[1] - kn[1] * p[0],
    ]
    const kDotP = kn[0] * p[0] + kn[1] * p[1] + kn[2] * p[2]
    const rotated: Vec3 = [
      p[0] * cos + kCrossP[0] * sin + kn[0] * kDotP * (1 - cos),
      p[1] * cos + kCrossP[1] * sin + kn[1] * kDotP * (1 - cos),
      p[2] * cos + kCrossP[2] * sin + kn[2] * kDotP * (1 - cos),
    ]
    const nextCart: Vec3 = [
      rotated[0] + origin[0],
      rotated[1] + origin[1],
      rotated[2] + origin[2],
    ]
    return {
      ...atom,
      cartesian: nextCart,
      position: cartesianToFractional(nextCart, latticeVectors),
    }
  })
}

function translateAll(atoms: Atom[], delta: Vec3, latticeVectors: LatticeVectors): Atom[] {
  return atoms.map((atom) => {
    const c = cartOf(atom)
    const nextCart: Vec3 = [c[0] + delta[0], c[1] + delta[1], c[2] + delta[2]]
    return {
      ...atom,
      cartesian: nextCart,
      position: cartesianToFractional(nextCart, latticeVectors),
    }
  })
}
