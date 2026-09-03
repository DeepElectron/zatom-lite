/**
 * Pure boundary analysis shared by merge preview and commit. Periodic axes wrap
 * to canonical fractional coordinates; aperiodic axes expand to preserve
 * Cartesian placement. The result also reports overlap risks for preview UI.
 */

import type { LatticeVectors } from './types'
import { cartesianToFractional, fractionalToCartesian, calculateVolume } from './lattice'

/** Minimum distance in Å before a placement is flagged as overlapping. */
const MIN_ATOM_DISTANCE = 0.75

export type MergeAtomStatus = 'ok' | 'wrap' | 'extend'

/** `wrap` canonicalizes periodic positions; `extend` preserves atoms and grows the cell. */
export type BoundaryOverflowMode = 'wrap' | 'extend'

export interface MergeBoundaryReport {
  /** Final Cartesian position of every incoming atom. */
  finalPositions: [number, number, number][]
  /** Boundary action for each atom, used by preview coloring. */
  atomStatus: MergeAtomStatus[]
  /** New length in Å for each axis that must expand. */
  extendAxes: { axis: 'a' | 'b' | 'c'; newUnitLength: number }[]
  /** Whole-group Cartesian translation required by negative aperiodic overflow. */
  shift: [number, number, number]
  /** Whether each final atom lies too close to existing structure. */
  tooClose: boolean[]
  /** Number of overlapping atoms for the preview summary. */
  tooCloseCount: number
}

const AXES = ['a', 'b', 'c'] as const

/**
 * Wrap the placement anchor on periodic axes so cursor and molecule remain
 * colocated. Aperiodic axes preserve vacuum placement, and `extend` mode leaves
 * every axis untouched because the cell will grow around the placement.
 */
export function wrapAnchorIntoBox(
  position: [number, number, number],
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number },
  periodicDirs: { a: boolean; b: boolean; c: boolean },
  periodic: boolean,
  overflowMode: BoundaryOverflowMode,
): [number, number, number] {
  if (overflowMode === 'extend') return position
  if (!periodic || calculateVolume(latticeVectors) < 1e-9) return position
  if (!periodicDirs.a && !periodicDirs.b && !periodicDirs.c) return position

  const box: LatticeVectors = {
    a: scale(latticeVectors.a, supercell.nx),
    b: scale(latticeVectors.b, supercell.ny),
    c: scale(latticeVectors.c, supercell.nz),
  }
  const frac = cartesianToFractional(position, box)
  const wrapped: [number, number, number] = [frac[0], frac[1], frac[2]]
  AXES.forEach((axis, i) => {
    if (periodicDirs[axis]) wrapped[i] = wrapped[i] - Math.floor(wrapped[i])
  })
  return fractionalToCartesian(wrapped, box)
}

export function analyzeMergeBoundary(
  positions: [number, number, number][],
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number },
  periodicDirs: { a: boolean; b: boolean; c: boolean },
  periodic: boolean,
  existingPositions: [number, number, number][],
  overflowMode: BoundaryOverflowMode,
): MergeBoundaryReport {
  const passthrough = (): MergeBoundaryReport => {
    const tooClose = markTooClose(positions, existingPositions)
    return {
      finalPositions: positions,
      atomStatus: positions.map(() => 'ok' as const),
      extendAxes: [],
      shift: [0, 0, 0],
      tooClose,
      tooCloseCount: tooClose.filter(Boolean).length,
    }
  }

  // Aperiodic or degenerate structures only receive overlap analysis.
  if (!periodic || calculateVolume(latticeVectors) < 1e-9) return passthrough()

  // The visible box is the supercell-scaled lattice.
  const counts = { a: supercell.nx, b: supercell.ny, c: supercell.nz }
  const box: LatticeVectors = {
    a: scale(latticeVectors.a, counts.a),
    b: scale(latticeVectors.b, counts.b),
    c: scale(latticeVectors.c, counts.c),
  }

  const fracs = positions.map((p) => cartesianToFractional(p, box))

  // Aperiodic axes always expand; `extend` applies the same rule to periodic axes.
  const growsToFit = (axis: 'a' | 'b' | 'c') => overflowMode === 'extend' || !periodicDirs[axis]

  // Expanding axes preserve the group as a rigid placement.
  const shiftFrac: [number, number, number] = [0, 0, 0]
  const extendAxes: MergeBoundaryReport['extendAxes'] = []
  const extendedAxis = { a: false, b: false, c: false }

  AXES.forEach((axis, i) => {
    if (!growsToFit(axis)) return
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const f of fracs) {
      if (f[i] < min) min = f[i]
      if (f[i] > max) max = f[i]
    }
    // `extend` preserves negative coordinates; the caller expands the cell origin
    // rather than translating only the edited subset and tearing its geometry.
    if (min < 0 && overflowMode !== 'extend') shiftFrac[i] = -min
    const required = max + shiftFrac[i]
    if (required > 1) {
      const boxLen = norm(box[axis])
      extendAxes.push({ axis, newUnitLength: (required * boxLen) / counts[axis] })
      extendedAxis[axis] = true
    } else if (shiftFrac[i] > 0) {
      extendedAxis[axis] = true // Only translation also belongs to boundary processing, mark prompt
    } else if (min < 0) {
      // Retain negative coordinates but mark them as extending for preview UI.
      extendedAxis[axis] = true
    }
  })

  const shift = fractionalToCartesian(shiftFrac, box)

  // Wrap the remaining periodic axes atom by atom.
  const finalPositions: [number, number, number][] = []
  const atomStatus: MergeAtomStatus[] = []
  fracs.forEach((f) => {
    const shifted: [number, number, number] = [f[0] + shiftFrac[0], f[1] + shiftFrac[1], f[2] + shiftFrac[2]]
    let status: MergeAtomStatus = 'ok'
    AXES.forEach((axis, i) => {
      if (!growsToFit(axis)) {
        const wrapped = shifted[i] - Math.floor(shifted[i])
        if (Math.abs(wrapped - shifted[i]) > 1e-9) status = 'wrap'
        shifted[i] = wrapped
      } else if (extendedAxis[axis] && (f[i] < 0 || f[i] > 1)) {
        if (status === 'ok') status = 'extend'
      }
    })
    finalPositions.push(fractionalToCartesian(shifted, box))
    atomStatus.push(status)
  })

  const tooClose = markTooClose(finalPositions, existingPositions)
  return {
    finalPositions,
    atomStatus,
    extendAxes,
    shift,
    tooClose,
    tooCloseCount: tooClose.filter(Boolean).length,
  }
}

function markTooClose(
  positions: [number, number, number][],
  existing: [number, number, number][],
): boolean[] {
  if (existing.length === 0) return positions.map(() => false)
  const minSq = MIN_ATOM_DISTANCE * MIN_ATOM_DISTANCE
  return positions.map((p) => {
    for (const q of existing) {
      const dx = p[0] - q[0]
      const dy = p[1] - q[1]
      const dz = p[2] - q[2]
      if (dx * dx + dy * dy + dz * dz < minSq) return true
    }
    return false
  })
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function norm(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2])
}
