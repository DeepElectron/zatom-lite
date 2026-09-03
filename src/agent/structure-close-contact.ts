/** Complete cutoff contact audit: Cartesian buckets for finite systems, reciprocal-safe buckets for lattices. */

import type { Vec3, ZatomStructure } from './contracts'
import {
  cartesianToFractional,
  certifiedShortestPeriodicTranslation,
  createCertifiedMinimumImageCalculator,
  invert3,
} from './structure-math'

export interface StructureCloseContactAuditOptions {
  cutoffA: number
  violationFloorA: number
  maxPairCandidates: number
  maxMinimumImageCandidateEvaluations: number
  /** Reuse a self-image certificate already charged to an outer aggregate budget. */
  precomputedPeriodicSelfImage?: NonNullable<ReturnType<typeof certifiedShortestPeriodicTranslation>> | null
}

export interface StructureCloseContactAudit {
  minimumDistanceA: number | null
  distanceLowerBoundA: number
  closestPair: [number, number] | null
  closestVector: Vec3 | null
  distinctPairViolations: number
  selfImageViolation: boolean
  pairCandidates: number
  minimumImageCandidateEvaluations: number
}

/**
 * Certify that no distinct-atom or periodic-self contact lies below `cutoffA`.
 * Finite structures use ordinary Cartesian cutoff-sized buckets. Fractional
 * bucket widths use reciprocal-vector norms when a lattice exists, so the 27
 * adjacent buckets remain complete for acute/triclinic cells; shortlisted
 * periodic pairs then use the exact lattice closest-vector solver rather than
 * component-wise rounding.
 */
export function auditStructureCloseContacts(
  structure: ZatomStructure,
  options: StructureCloseContactAuditOptions,
): StructureCloseContactAudit {
  if (!Number.isFinite(options.cutoffA) || options.cutoffA <= 0) throw new Error('cutoffA must be finite and positive')
  if (!Number.isFinite(options.violationFloorA) || options.violationFloorA < 0 || options.violationFloorA > options.cutoffA) {
    throw new Error('violationFloorA must be finite from zero through cutoffA')
  }
  if (!Number.isSafeInteger(options.maxPairCandidates) || options.maxPairCandidates < 1) {
    throw new Error('maxPairCandidates must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.maxMinimumImageCandidateEvaluations)
    || options.maxMinimumImageCandidateEvaluations < 1) {
    throw new Error('maxMinimumImageCandidateEvaluations must be a positive safe integer')
  }
  const lattice = structure.lattice
  const inverse = lattice ? invert3(lattice.vectors) : null
  if (lattice && !inverse) throw new Error('Close-contact audit cannot invert the lattice')
  const bucketCounts = inverse
    ? [0, 1, 2].map((axis) => {
        const reciprocalNorm = Math.hypot(inverse[0][axis], inverse[1][axis], inverse[2][axis])
        return Math.max(1, Math.floor(1 / Math.max(options.cutoffA * reciprocalNorm, 1e-12)))
      }) as [number, number, number]
    : null
  const buckets = new Map<string, number[]>()
  const key = (indices: readonly number[]): string => `${indices[0]},${indices[1]},${indices[2]}`
  const cellOf = (position: Vec3): [number, number, number] => {
    if (!lattice || !bucketCounts) {
      return position.map((value) => Math.floor(value / options.cutoffA)) as [number, number, number]
    }
    const fractional = cartesianToFractional(position, lattice.vectors)!
    return [0, 1, 2].map((axis) => {
      const value = lattice.periodic[axis]
        ? fractional[axis] - Math.floor(fractional[axis])
        : Math.min(1, Math.max(0, fractional[axis]))
      return Math.min(bucketCounts[axis] - 1, Math.max(0, Math.floor(value * bucketCounts[axis])))
    }) as [number, number, number]
  }
  const nearby = (position: Vec3): number[] => {
    const center = cellOf(position)
    const result: number[] = []
    const seen = new Set<string>()
    for (let first = -1; first <= 1; first++) for (let second = -1; second <= 1; second++) for (let third = -1; third <= 1; third++) {
      const offsets = [first, second, third]
      const indices = [0, 1, 2].map((axis) => {
        const raw = center[axis] + offsets[axis]
        return lattice?.periodic[axis] && bucketCounts
          ? ((raw % bucketCounts[axis]) + bucketCounts[axis]) % bucketCounts[axis]
          : raw
      })
      if (bucketCounts && indices.some((value, axis) => value < 0 || value >= bucketCounts[axis])) continue
      const bucketKey = key(indices)
      if (seen.has(bucketKey)) continue
      seen.add(bucketKey)
      result.push(...(buckets.get(bucketKey) ?? []))
    }
    return result
  }
  let minimumDistanceA = Infinity
  let closestPair: [number, number] | null = null
  let closestVector: Vec3 | null = null
  let distinctPairViolations = 0
  let selfImageViolation = false
  let pairCandidates = 0
  let minimumImageCandidateEvaluations = 0
  const hasPrecomputedSelfImage = options.precomputedPeriodicSelfImage !== undefined
  const selfImage = hasPrecomputedSelfImage
    ? options.precomputedPeriodicSelfImage ?? null
    : lattice?.periodic.some(Boolean)
      ? certifiedShortestPeriodicTranslation(
          lattice,
          options.maxMinimumImageCandidateEvaluations,
        )
      : null
  if (selfImage) {
    if (!hasPrecomputedSelfImage) minimumImageCandidateEvaluations += selfImage.candidateEvaluations
    if (selfImage.distance <= options.cutoffA * (1 + 1e-12)) {
      minimumDistanceA = selfImage.distance
      closestPair = [0, 0]
      closestVector = selfImage.vector
    }
    selfImageViolation = selfImage.distance < options.violationFloorA
  }
  const exactMinimumImage = lattice?.periodic.some(Boolean)
    ? createCertifiedMinimumImageCalculator(lattice)
    : null
  for (let right = 0; right < structure.atoms.length; right++) {
    const rightAtom = structure.atoms[right]
    for (const left of nearby(rightAtom.position)) {
      pairCandidates += 1
      if (pairCandidates > options.maxPairCandidates) {
        throw new Error(`Close-contact spatial audit exceeded ${options.maxPairCandidates.toLocaleString()} candidate pairs`)
      }
      const leftAtom = structure.atoms[left]
      const direct: Vec3 = [
        rightAtom.position[0] - leftAtom.position[0],
        rightAtom.position[1] - leftAtom.position[1],
        rightAtom.position[2] - leftAtom.position[2],
      ]
      let displacement = direct
      let distanceA = Math.hypot(...direct)
      if (exactMinimumImage) {
        const remaining = options.maxMinimumImageCandidateEvaluations - minimumImageCandidateEvaluations
        if (remaining < 1) throw new Error('Close-contact minimum-image audit exhausted its candidate budget')
        const resolved = exactMinimumImage(direct, remaining)
        minimumImageCandidateEvaluations += resolved.candidateEvaluations
        displacement = resolved.vector
        distanceA = resolved.distance
      }
      if (distanceA < options.violationFloorA) distinctPairViolations += 1
      if (distanceA <= options.cutoffA * (1 + 1e-12) && distanceA < minimumDistanceA) {
        minimumDistanceA = distanceA
        closestPair = [left, right]
        closestVector = displacement
      }
    }
    const bucketKey = key(cellOf(rightAtom.position))
    const bucket = buckets.get(bucketKey)
    if (bucket) bucket.push(right)
    else buckets.set(bucketKey, [right])
  }
  return {
    minimumDistanceA: Number.isFinite(minimumDistanceA) ? minimumDistanceA : null,
    distanceLowerBoundA: Number.isFinite(minimumDistanceA) ? minimumDistanceA : options.cutoffA,
    closestPair,
    closestVector,
    distinctPairViolations,
    selfImageViolation,
    pairCandidates,
    minimumImageCandidateEvaluations,
  }
}
