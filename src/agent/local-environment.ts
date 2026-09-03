import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import {
  enumeratePeriodicImagesWithinCutoff,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'

export const LOCAL_ENVIRONMENT_VERSION = '1.0.0'

export interface AnalyzeLocalEnvironmentOptions {
  structure: ZatomStructure
  cutoffA: number
  periodic: boolean
  centralAtomIds?: string[]
  neighborElements?: string[]
  minimumCoordination?: number
  maximumCoordination?: number
  maxPairEvaluations?: number
  maxPeriodicImageCandidates?: number
}

export interface LocalEnvironmentNeighbor {
  atomId: string
  element: string
  distanceA: number
  fractionalImage: [number, number, number]
  vector: Vec3
  imagePosition: Vec3
}

export interface LocalEnvironmentCenter {
  atomId: string
  element: string
  coordination: number
  neighborElementCounts: Record<string, number>
  passed: boolean
  neighbors: LocalEnvironmentNeighbor[]
}

export interface LocalEnvironmentResult {
  structureFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-local-environment'
    engineVersion: typeof LOCAL_ENVIRONMENT_VERSION
    neighborDefinition: 'finite-distance' | 'all-declared-periodic-images-within-cutoff'
    periodicImageMethod: 'none' | 'singular-value-bounded-complete-enumeration'
  }
  cutoffA: number
  periodic: boolean
  centralAtomCount: number
  candidateNeighborAtomCount: number
  totalNeighborImageCount: number
  pairEvaluations: number
  periodicImageCandidateEvaluations: number
  centers: LocalEnvironmentCenter[]
  statistics: {
    minimumCoordination: number
    meanCoordination: number
    maximumCoordination: number
    coordinationHistogram: Record<string, number>
  }
  gates: {
    minimumCoordination?: number
    maximumCoordination?: number
  }
  verdict: 'pass' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class LocalEnvironmentInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LocalEnvironmentInputError'
    this.code = code
  }
}

function finiteNumber(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new LocalEnvironmentInputError(
      'invalid_local_environment_number',
      `${field} must be finite and in [${minimum}, ${maximum}]`,
    )
  }
  return value
}

function positiveBudget(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const parsed = value ?? fallback
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new LocalEnvironmentInputError(
      'invalid_local_environment_budget',
      `${field} must be an integer in [1, ${maximum}]`,
    )
  }
  return parsed
}

function optionalCoordination(value: number | undefined, field: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new LocalEnvironmentInputError(
      'invalid_coordination_gate',
      `${field} must be an integer in [0, 1000000]`,
    )
  }
  return value
}

function canonicalElement(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new LocalEnvironmentInputError('invalid_neighbor_element', `${field} must be an element symbol`)
  }
  const text = value.trim()
  const symbol = text[0].toUpperCase() + text.slice(1).toLowerCase()
  if (symbolToAtomicNumber(symbol) <= 0) {
    throw new LocalEnvironmentInputError('invalid_neighbor_element', `${field} uses unknown element ${value}`)
  }
  return symbol
}

function exactUniqueIds(value: string[] | undefined, available: Map<string, number>): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new LocalEnvironmentInputError(
      'invalid_central_atom_ids',
      'centralAtomIds must be a non-empty array of canonical atom IDs',
    )
  }
  const ids = value.map((item) => item.trim())
  if (new Set(ids).size !== ids.length) {
    throw new LocalEnvironmentInputError('invalid_central_atom_ids', 'centralAtomIds must not contain duplicates')
  }
  const missing = ids.filter((id) => !available.has(id))
  if (missing.length) {
    throw new LocalEnvironmentInputError(
      'local_environment_atoms_missing',
      `centralAtomIds references absent atoms: ${missing.join(', ')}`,
    )
  }
  return ids
}

function isZeroImage(image: readonly number[]): boolean {
  return image[0] === 0 && image[1] === 0 && image[2] === 0
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

/** Analyze exact cutoff coordination for finite systems or all declared periodic images. */
export function analyzeLocalEnvironment(options: AnalyzeLocalEnvironmentOptions): LocalEnvironmentResult {
  const cutoffA = finiteNumber(options.cutoffA, 'cutoffA', 0, 1_000_000)
  if (cutoffA === 0) {
    throw new LocalEnvironmentInputError('invalid_local_environment_number', 'cutoffA must be greater than zero')
  }
  if (typeof options.periodic !== 'boolean') {
    throw new LocalEnvironmentInputError(
      'invalid_local_environment_periodicity',
      'periodic must explicitly state whether declared periodic images are included',
    )
  }
  if (options.periodic && (!options.structure.lattice || !options.structure.lattice.periodic.some(Boolean))) {
    throw new LocalEnvironmentInputError(
      'periodic_lattice_required',
      'Periodic local-environment analysis requires a lattice with at least one periodic axis',
    )
  }
  const minimumCoordination = optionalCoordination(options.minimumCoordination, 'minimumCoordination')
  const maximumCoordination = optionalCoordination(options.maximumCoordination, 'maximumCoordination')
  if (minimumCoordination !== undefined && maximumCoordination !== undefined
    && minimumCoordination > maximumCoordination) {
    throw new LocalEnvironmentInputError(
      'invalid_coordination_gate',
      'minimumCoordination must not exceed maximumCoordination',
    )
  }
  const maxPairEvaluations = positiveBudget(options.maxPairEvaluations, 5_000_000, 'maxPairEvaluations', 100_000_000)
  const maxPeriodicImageCandidates = positiveBudget(
    options.maxPeriodicImageCandidates,
    50_000_000,
    'maxPeriodicImageCandidates',
    1_000_000_000,
  )
  const atomIndexById = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
  if (!options.structure.atoms.length) {
    throw new LocalEnvironmentInputError('empty_structure', 'Local-environment analysis requires at least one atom')
  }
  if (atomIndexById.size !== options.structure.atoms.length) {
    throw new LocalEnvironmentInputError('duplicate_atom_ids', 'Local-environment analysis requires unique atom IDs')
  }
  const centralAtomIds = exactUniqueIds(options.centralAtomIds, atomIndexById)
  const centralIndices = centralAtomIds
    ? centralAtomIds.map((id) => atomIndexById.get(id)!)
    : options.structure.atoms.map((_, index) => index)

  let neighborElementSet: Set<string> | undefined
  if (options.neighborElements !== undefined) {
    if (!Array.isArray(options.neighborElements) || options.neighborElements.length === 0) {
      throw new LocalEnvironmentInputError(
        'invalid_neighbor_elements',
        'neighborElements must be a non-empty array when supplied',
      )
    }
    const elements = options.neighborElements.map((item, index) => canonicalElement(item, `neighborElements[${index}]`))
    if (new Set(elements).size !== elements.length) {
      throw new LocalEnvironmentInputError('invalid_neighbor_elements', 'neighborElements must not contain duplicates')
    }
    neighborElementSet = new Set(elements)
    const absent = elements.filter((element) => !options.structure.atoms.some((atom) => atom.element === element))
    if (absent.length) {
      throw new LocalEnvironmentInputError(
        'neighbor_elements_missing',
        `neighborElements are absent from the structure: ${absent.join(', ')}`,
      )
    }
  }
  const neighborIndices = options.structure.atoms
    .map((_, index) => index)
    .filter((index) => !neighborElementSet || neighborElementSet.has(options.structure.atoms[index].element))
  let projectedPairEvaluations = centralIndices.length * neighborIndices.length
  if (!options.periodic) {
    const neighborIndexSet = new Set(neighborIndices)
    projectedPairEvaluations -= centralIndices.filter((index) => neighborIndexSet.has(index)).length
  }
  if (!Number.isSafeInteger(projectedPairEvaluations) || projectedPairEvaluations > maxPairEvaluations) {
    throw new LocalEnvironmentInputError(
      'local_environment_pair_budget_exceeded',
      `Local-environment analysis requires ${projectedPairEvaluations} center-neighbor comparisons above budget ${maxPairEvaluations}`,
    )
  }

  let pairEvaluations = 0
  let periodicImageCandidateEvaluations = 0
  const centers = centralIndices.map((centerIndex): LocalEnvironmentCenter => {
    const center = options.structure.atoms[centerIndex]
    const neighbors: LocalEnvironmentNeighbor[] = []
    for (const neighborIndex of neighborIndices) {
      const neighbor = options.structure.atoms[neighborIndex]
      if (!options.periodic && centerIndex === neighborIndex) continue
      pairEvaluations += 1
      const delta: Vec3 = [
        neighbor.position[0] - center.position[0],
        neighbor.position[1] - center.position[1],
        neighbor.position[2] - center.position[2],
      ]
      if (!options.periodic) {
        const distanceA = Math.hypot(delta[0], delta[1], delta[2])
        if (distanceA <= cutoffA + Math.max(1e-12, cutoffA * 1e-12)) {
          neighbors.push({
            atomId: neighbor.id,
            element: neighbor.element,
            distanceA,
            fractionalImage: [0, 0, 0],
            vector: delta,
            imagePosition: [...neighbor.position] as Vec3,
          })
        }
        continue
      }
      const remaining = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
      if (remaining < 1) {
        throw new LocalEnvironmentInputError(
          'local_environment_image_budget_exceeded',
          `Periodic-image candidate budget ${maxPeriodicImageCandidates} is exhausted`,
        )
      }
      let enumerated
      try {
        enumerated = enumeratePeriodicImagesWithinCutoff(delta, options.structure.lattice!, cutoffA, remaining)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new LocalEnvironmentInputError(
          message.includes('above budget') ? 'local_environment_image_budget_exceeded' : 'local_environment_periodic_enumeration_failed',
          message,
        )
      }
      periodicImageCandidateEvaluations += enumerated.candidateEvaluations
      for (const image of enumerated.images) {
        if (centerIndex === neighborIndex && isZeroImage(image.fractionalImage)) continue
        neighbors.push({
          atomId: neighbor.id,
          element: neighbor.element,
          distanceA: image.distance,
          fractionalImage: image.fractionalImage,
          vector: image.vector,
          imagePosition: add(center.position, image.vector),
        })
      }
    }
    neighbors.sort((left, right) => (
      left.distanceA - right.distanceA
      || atomIndexById.get(left.atomId)! - atomIndexById.get(right.atomId)!
      || left.fractionalImage[0] - right.fractionalImage[0]
      || left.fractionalImage[1] - right.fractionalImage[1]
      || left.fractionalImage[2] - right.fractionalImage[2]
    ))
    const neighborElementCounts = new Map<string, number>()
    for (const neighbor of neighbors) {
      neighborElementCounts.set(neighbor.element, (neighborElementCounts.get(neighbor.element) ?? 0) + 1)
    }
    const passed = (minimumCoordination === undefined || neighbors.length >= minimumCoordination)
      && (maximumCoordination === undefined || neighbors.length <= maximumCoordination)
    return {
      atomId: center.id,
      element: center.element,
      coordination: neighbors.length,
      neighborElementCounts: Object.fromEntries([...neighborElementCounts].sort(([left], [right]) => left.localeCompare(right))),
      passed,
      neighbors,
    }
  })
  const coordinationValues = centers.map((center) => center.coordination)
  const minimumObserved = Math.min(...coordinationValues)
  const maximumObserved = Math.max(...coordinationValues)
  const meanObserved = coordinationValues.reduce((sum, value) => sum + value, 0) / coordinationValues.length
  const histogram = new Map<number, number>()
  for (const value of coordinationValues) histogram.set(value, (histogram.get(value) ?? 0) + 1)
  const coordinationHistogram = Object.fromEntries([...histogram].sort(([left], [right]) => left - right).map(([key, value]) => [String(key), value]))
  const failedCenters = centers.filter((center) => !center.passed)
  const structureFingerprint = fingerprintStructure(options.structure)
  const method = {
    engine: 'zatom-local-environment',
    engineVersion: LOCAL_ENVIRONMENT_VERSION,
    neighborDefinition: options.periodic ? 'all-declared-periodic-images-within-cutoff' : 'finite-distance',
    periodicImageMethod: options.periodic ? 'singular-value-bounded-complete-enumeration' : 'none',
  } as const
  const checks: ValidationCheck[] = [
    {
      id: 'local_environment.structure_identity',
      status: 'pass',
      message: `Local environments bind exact structure ${structureFingerprint}`,
      metrics: { structureFingerprint, atomCount: options.structure.atoms.length },
    },
    {
      id: 'local_environment.pair_budget',
      status: 'pass',
      message: `Evaluated ${pairEvaluations.toLocaleString()} of ${maxPairEvaluations.toLocaleString()} allowed center-neighbor pairs`,
      metrics: { pairEvaluations, maxPairEvaluations },
    },
    {
      id: 'local_environment.periodic_image_budget',
      status: 'pass',
      message: options.periodic
        ? `Complete periodic-image enumeration used ${periodicImageCandidateEvaluations.toLocaleString()} of ${maxPeriodicImageCandidates.toLocaleString()} candidates`
        : 'Periodic images were explicitly disabled',
      metrics: { periodic: options.periodic, periodicImageCandidateEvaluations, maxPeriodicImageCandidates },
    },
    {
      id: 'local_environment.coordination_gate',
      status: failedCenters.length ? 'fail' : 'pass',
      message: failedCenters.length
        ? `${failedCenters.length.toLocaleString()} centers fall outside the requested coordination bounds`
        : `All ${centers.length.toLocaleString()} centers satisfy the requested coordination bounds`,
      metrics: {
        centralAtomCount: centers.length,
        failedCenterCount: failedCenters.length,
        minimumObserved,
        meanObserved,
        maximumObserved,
        minimumRequired: minimumCoordination ?? null,
        maximumAllowed: maximumCoordination ?? null,
      },
      ...(failedCenters.length ? { atomIds: failedCenters.map((center) => center.atomId) } : {}),
    },
  ]

  const interesting = new Set<string>(failedCenters.map((center) => center.atomId))
  interesting.add(centers.find((center) => center.coordination === minimumObserved)!.atomId)
  interesting.add(centers.find((center) => center.coordination === maximumObserved)!.atomId)
  const inspectionTargets = centers.filter((center) => interesting.has(center.atomId)).map((environment, index) => {
    const center = options.structure.atoms[atomIndexById.get(environment.atomId)!]
    const atomIds = [environment.atomId, ...new Set(environment.neighbors.map((neighbor) => neighbor.atomId))]
    return {
      id: `local-environment-${index}-${environment.atomId}`,
      reason: `${environment.passed ? 'Inspect extremal' : 'Inspect failed'} coordination center ${environment.atomId}: ${environment.coordination} neighbor images within ${cutoffA} Å`,
      center: [...center.position] as Vec3,
      radius: Math.max(1, cutoffA * 1.1),
      atomIds,
    }
  })
  const totalNeighborImageCount = centers.reduce((sum, center) => sum + center.coordination, 0)
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    method,
    cutoffA,
    periodic: options.periodic,
    centralAtomIds: centers.map((center) => center.atomId),
    neighborElements: neighborElementSet ? [...neighborElementSet].sort() : null,
    gates: { minimumCoordination, maximumCoordination },
    centers,
  })
  return {
    structureFingerprint,
    fingerprint,
    method,
    cutoffA,
    periodic: options.periodic,
    centralAtomCount: centers.length,
    candidateNeighborAtomCount: neighborIndices.length,
    totalNeighborImageCount,
    pairEvaluations,
    periodicImageCandidateEvaluations,
    centers,
    statistics: {
      minimumCoordination: minimumObserved,
      meanCoordination: meanObserved,
      maximumCoordination: maximumObserved,
      coordinationHistogram,
    },
    gates: {
      ...(minimumCoordination === undefined ? {} : { minimumCoordination }),
      ...(maximumCoordination === undefined ? {} : { maximumCoordination }),
    },
    verdict: failedCenters.length ? 'fail' : 'pass',
    checks,
    inspectionTargets,
  }
}
