import type {
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomTrajectory,
} from './contracts'
import {
  certifiedMinimumImageVector,
  enumeratePeriodicImagesWithinCutoff,
  fingerprintCanonicalJson,
  fingerprintStructure,
  type PeriodicImageWithinCutoff,
} from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export const TRAJECTORY_HYDROGEN_BOND_VERSION = '1.0.0'

export interface AnalyzeTrajectoryHydrogenBondsOptions {
  structure: ZatomStructure
  trajectory: ZatomTrajectory
  donorAtomIds: string[]
  acceptorAtomIds: string[]
  periodic: boolean
  donorAcceptorCutoffA?: number
  minimumDhaAngleDeg?: number
  maximumDonorHydrogenDistanceA?: number
  startFrameIndex?: number
  endFrameIndex?: number
  frameStride?: number
  maxTripleEvaluations?: number
  maxPeriodicImageCandidates?: number
}

export interface HydrogenBondEvent {
  id: string
  donorAtomId: string
  hydrogenAtomId: string
  acceptorAtomId: string
  frameIndex: number
  timePs: number
  donorHydrogenDistanceA: number
  donorAcceptorDistanceA: number
  dhaAngleDeg: number
  donorFractionalImage: [number, number, number]
  acceptorFractionalImage: [number, number, number]
  unwrappedPositions: [Vec3, Vec3, Vec3]
}

export interface HydrogenBondAggregate {
  id: string
  donorAtomId: string
  hydrogenAtomId: string
  acceptorAtomId: string
  observationCount: number
  occurrenceFraction: number
  presenceFrameIndices: number[]
  meanDonorAcceptorDistanceA: number
  minimumDonorAcceptorDistanceA: number
  meanDhaAngleDeg: number
  maximumDhaAngleDeg: number
  continuousRuns: {
    count: number
    meanSampleCount: number
    maximumSampleCount: number
    meanSpanPs: number
    maximumSpanPs: number
  }
  representativeEvent: HydrogenBondEvent
}

export interface TrajectoryHydrogenBondResult {
  structureFingerprint: string
  trajectoryFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-topology-hydrogen-bonds'
    engineVersion: typeof TRAJECTORY_HYDROGEN_BOND_VERSION
    donorHydrogenIdentity: 'explicit-structure-bonds'
    geometry: 'donor-acceptor-distance-and-donor-hydrogen-acceptor-angle'
    periodicImages: 'consistent-hydrogen-centered-complete-acceptor-enumeration'
  }
  periodic: boolean
  criteria: {
    donorAcceptorCutoffA: number
    minimumDhaAngleDeg: number
    maximumDonorHydrogenDistanceA: number
  }
  donorHydrogenPairs: Array<{ donorAtomId: string; hydrogenAtomId: string; bondId: string }>
  acceptorAtomIds: string[]
  excludedCovalentlyBondedCandidateCount: number
  frameRange: {
    startFrameIndex: number
    endFrameIndex: number
    frameStride: number
    frameIndices: number[]
    frameCount: number
    cadencePs: number
    maximumCadenceRelativeError: number
  }
  tripleEvaluations: number
  periodicImageCandidateEvaluations: number
  eventCount: number
  frames: Array<{ frameIndex: number; timePs: number; events: HydrogenBondEvent[] }>
  hydrogenBonds: HydrogenBondAggregate[]
  verdict: 'warn' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class TrajectoryHydrogenBondInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryHydrogenBondInputError'
    this.code = code
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ?? fallback
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_parameter',
      `${field} must be an integer in [${minimum}, ${maximum}]`,
    )
  }
  return parsed
}

function finiteNumber(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value ?? fallback
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_parameter',
      `${field} must be finite and in [${minimum}, ${maximum}]`,
    )
  }
  return parsed
}

function exactIds(value: string[], field: string, available: Map<string, number>): string[] {
  if (!Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_atoms',
      `${field} must be a non-empty array of exact atom IDs`,
    )
  }
  const ids = value.map((item) => item.trim())
  if (new Set(ids).size !== ids.length) {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_atoms',
      `${field} must not contain duplicates`,
    )
  }
  const missing = ids.filter((id) => !available.has(id))
  if (missing.length) {
    throw new TrajectoryHydrogenBondInputError(
      'hydrogen_bond_atoms_missing',
      `${field} references absent atoms: ${missing.join(', ')}`,
    )
  }
  return ids
}

function norm(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function angleDeg(left: readonly number[], right: readonly number[]): number {
  const denominator = norm(left) * norm(right)
  if (denominator <= 1e-20) return Number.NaN
  const cosine = Math.max(-1, Math.min(1, (
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  ) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

function add(position: readonly number[], vector: readonly number[]): Vec3 {
  return [position[0] + vector[0], position[1] + vector[1], position[2] + vector[2]]
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function latticeForFrame(
  trajectory: ZatomTrajectory,
  frameIndex: number,
  periodic: boolean,
): ZatomLattice | undefined {
  if (!periodic) return undefined
  const lattice = trajectory.lattice ?? trajectory.frames[frameIndex].lattice
  if (!lattice || !lattice.periodic.some(Boolean)) {
    throw new TrajectoryHydrogenBondInputError(
      'periodic_hydrogen_bond_lattice_required',
      `Periodic hydrogen-bond analysis requires a lattice with a periodic axis at frame ${frameIndex}`,
    )
  }
  return lattice
}

function continuousRuns(presenceOrdinals: number[], cadencePs: number): HydrogenBondAggregate['continuousRuns'] {
  const lengths: number[] = []
  let length = 1
  for (let index = 1; index < presenceOrdinals.length; index++) {
    if (presenceOrdinals[index] === presenceOrdinals[index - 1] + 1) length += 1
    else {
      lengths.push(length)
      length = 1
    }
  }
  lengths.push(length)
  const meanSampleCount = lengths.reduce((sum, value) => sum + value, 0) / lengths.length
  const maximumSampleCount = Math.max(...lengths)
  return {
    count: lengths.length,
    meanSampleCount,
    maximumSampleCount,
    meanSpanPs: (meanSampleCount - 1) * cadencePs,
    maximumSpanPs: (maximumSampleCount - 1) * cadencePs,
  }
}

/** Detect geometric hydrogen bonds from explicit donor-hydrogen topology. */
export function analyzeTrajectoryHydrogenBonds(
  options: AnalyzeTrajectoryHydrogenBondsOptions,
): TrajectoryHydrogenBondResult {
  if (typeof options.periodic !== 'boolean') {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_periodicity',
      'periodic must explicitly state whether declared periodic images are used',
    )
  }
  if (!options.structure.bonds) {
    throw new TrajectoryHydrogenBondInputError(
      'explicit_topology_required',
      'Hydrogen-bond analysis requires explicit structure bonds for donor-hydrogen identity',
    )
  }
  const atomIndexById = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
  if (atomIndexById.size !== options.structure.atoms.length) {
    throw new TrajectoryHydrogenBondInputError('duplicate_atom_ids', 'Hydrogen-bond analysis requires unique atom IDs')
  }
  const donorAtomIds = exactIds(options.donorAtomIds, 'donorAtomIds', atomIndexById)
  const acceptorAtomIds = exactIds(options.acceptorAtomIds, 'acceptorAtomIds', atomIndexById)
  const hydrogenElements = new Set(['H'])
  if (donorAtomIds.some((id) => hydrogenElements.has(options.structure.atoms[atomIndexById.get(id)!].element))) {
    throw new TrajectoryHydrogenBondInputError('invalid_hydrogen_bond_atoms', 'donorAtomIds cannot contain hydrogen atoms')
  }
  if (acceptorAtomIds.some((id) => hydrogenElements.has(options.structure.atoms[atomIndexById.get(id)!].element))) {
    throw new TrajectoryHydrogenBondInputError('invalid_hydrogen_bond_atoms', 'acceptorAtomIds cannot contain hydrogen atoms')
  }
  const donorSet = new Set(donorAtomIds)
  const adjacency = new Map<string, Set<string>>()
  const pairByKey = new Map<string, { donorAtomId: string; hydrogenAtomId: string; bondId: string }>()
  for (const bond of options.structure.bonds) {
    const [first, second] = bond.atomIds
    if (!adjacency.has(first)) adjacency.set(first, new Set())
    if (!adjacency.has(second)) adjacency.set(second, new Set())
    adjacency.get(first)!.add(second)
    adjacency.get(second)!.add(first)
    const donorAtomId = donorSet.has(first) ? first : donorSet.has(second) ? second : null
    if (!donorAtomId) continue
    const otherAtomId = donorAtomId === first ? second : first
    const other = options.structure.atoms[atomIndexById.get(otherAtomId)!]
    if (!hydrogenElements.has(other.element)) continue
    const key = `${donorAtomId}\u0000${otherAtomId}`
    if (pairByKey.has(key)) {
      throw new TrajectoryHydrogenBondInputError(
        'duplicate_donor_hydrogen_topology',
        `Multiple explicit bonds connect donor ${donorAtomId} to hydrogen ${otherAtomId}`,
      )
    }
    pairByKey.set(key, { donorAtomId, hydrogenAtomId: otherAtomId, bondId: bond.id })
  }
  const donorHydrogenPairs = [...pairByKey.values()].sort((left, right) => (
    atomIndexById.get(left.donorAtomId)! - atomIndexById.get(right.donorAtomId)!
    || atomIndexById.get(left.hydrogenAtomId)! - atomIndexById.get(right.hydrogenAtomId)!
  ))
  const donorsWithoutHydrogen = donorAtomIds.filter((id) => (
    !donorHydrogenPairs.some((pair) => pair.donorAtomId === id)
  ))
  if (donorsWithoutHydrogen.length) {
    throw new TrajectoryHydrogenBondInputError(
      'donor_hydrogen_topology_missing',
      `Donors have no explicitly bonded hydrogen: ${donorsWithoutHydrogen.join(', ')}`,
    )
  }

  const donorAcceptorCutoffA = finiteNumber(
    options.donorAcceptorCutoffA,
    3,
    'donorAcceptorCutoffA',
    Number.MIN_VALUE,
    100,
  )
  const minimumDhaAngleDeg = finiteNumber(
    options.minimumDhaAngleDeg,
    150,
    'minimumDhaAngleDeg',
    0,
    180,
  )
  const maximumDonorHydrogenDistanceA = finiteNumber(
    options.maximumDonorHydrogenDistanceA,
    1.5,
    'maximumDonorHydrogenDistanceA',
    Number.MIN_VALUE,
    10,
  )
  const frameCount = options.trajectory.frames.length
  if (frameCount < 2) {
    throw new TrajectoryHydrogenBondInputError('insufficient_hydrogen_bond_frames', 'At least two frames are required')
  }
  const structureAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (structureAtomIds.length !== options.trajectory.atomIds.length
    || structureAtomIds.some((id, index) => id !== options.trajectory.atomIds[index])) {
    throw new TrajectoryHydrogenBondInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory.atomIds must exactly match the structure atom order',
    )
  }
  const finalPositions = options.trajectory.frames[frameCount - 1].positions
  const maximumFinalPositionErrorA = Math.max(...finalPositions.map((position, index) => Math.hypot(
    position[0] - options.structure.atoms[index].position[0],
    position[1] - options.structure.atoms[index].position[1],
    position[2] - options.structure.atoms[index].position[2],
  )))
  if (maximumFinalPositionErrorA > 1e-8) {
    throw new TrajectoryHydrogenBondInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory final positions must match the exact result structure',
    )
  }
  const startFrameIndex = boundedInteger(options.startFrameIndex, 0, 'startFrameIndex', 0, frameCount - 1)
  const endFrameIndex = boundedInteger(options.endFrameIndex, frameCount - 1, 'endFrameIndex', 0, frameCount - 1)
  if (endFrameIndex < startFrameIndex) {
    throw new TrajectoryHydrogenBondInputError(
      'invalid_hydrogen_bond_frame_range',
      'endFrameIndex must not precede startFrameIndex',
    )
  }
  const frameStride = boundedInteger(options.frameStride, 1, 'frameStride', 1, frameCount)
  const frameIndices: number[] = []
  for (let index = startFrameIndex; index <= endFrameIndex; index += frameStride) frameIndices.push(index)
  if (frameIndices.length < 2) {
    throw new TrajectoryHydrogenBondInputError(
      'insufficient_hydrogen_bond_frames',
      'The selected hydrogen-bond window must contain at least two frames',
    )
  }
  const intervals = frameIndices.slice(1).map((frameIndex, index) => (
    options.trajectory.frames[frameIndex].timePs - options.trajectory.frames[frameIndices[index]].timePs
  ))
  const cadencePs = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
  const maximumCadenceRelativeError = Math.max(...intervals.map((value) => Math.abs(value - cadencePs) / cadencePs))
  if (!Number.isFinite(cadencePs) || cadencePs <= 0 || maximumCadenceRelativeError > 1e-7) {
    throw new TrajectoryHydrogenBondInputError(
      'nonuniform_hydrogen_bond_cadence',
      `Hydrogen-bond occurrence/runs require uniform selected-frame cadence; maximum relative error is ${maximumCadenceRelativeError}`,
    )
  }
  let candidateTriplesPerFrame = 0
  let excludedCovalentlyBondedCandidateCount = 0
  for (const pair of donorHydrogenPairs) {
    for (const acceptorId of acceptorAtomIds) {
      if (acceptorId === pair.donorAtomId || acceptorId === pair.hydrogenAtomId
        || adjacency.get(pair.donorAtomId)?.has(acceptorId)) {
        excludedCovalentlyBondedCandidateCount += 1
      } else candidateTriplesPerFrame += 1
    }
  }
  const tripleEvaluations = candidateTriplesPerFrame * frameIndices.length
  const maxTripleEvaluations = boundedInteger(
    options.maxTripleEvaluations,
    5_000_000,
    'maxTripleEvaluations',
    1,
    100_000_000,
  )
  if (!Number.isSafeInteger(tripleEvaluations) || tripleEvaluations > maxTripleEvaluations) {
    throw new TrajectoryHydrogenBondInputError(
      'hydrogen_bond_triple_budget_exceeded',
      `Hydrogen-bond analysis requires ${tripleEvaluations} triples above budget ${maxTripleEvaluations}`,
    )
  }
  const maxPeriodicImageCandidates = boundedInteger(
    options.maxPeriodicImageCandidates,
    50_000_000,
    'maxPeriodicImageCandidates',
    1,
    1_000_000_000,
  )
  let periodicImageCandidateEvaluations = 0
  let minimumObservedDonorHydrogenDistanceA = Number.POSITIVE_INFINITY
  let maximumObservedDonorHydrogenDistanceA = 0
  let worstDonorHydrogen: { donorAtomId: string; hydrogenAtomId: string; frameIndex: number; distanceA: number } | null = null
  const frames: TrajectoryHydrogenBondResult['frames'] = []
  const eventsById = new Map<string, HydrogenBondEvent[]>()

  for (const frameIndex of frameIndices) {
    const frame = options.trajectory.frames[frameIndex]
    const lattice = latticeForFrame(options.trajectory, frameIndex, options.periodic)
    const events: HydrogenBondEvent[] = []
    for (const pair of donorHydrogenPairs) {
      const donorIndex = atomIndexById.get(pair.donorAtomId)!
      const hydrogenIndex = atomIndexById.get(pair.hydrogenAtomId)!
      const hydrogenPosition = frame.positions[hydrogenIndex]
      const directDonorVector = subtract(frame.positions[donorIndex], hydrogenPosition)
      let donorVector: Vec3 = directDonorVector
      let donorFractionalImage: [number, number, number] = [0, 0, 0]
      if (lattice) {
        const remaining = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
        if (remaining < 1) {
          throw new TrajectoryHydrogenBondInputError(
            'hydrogen_bond_image_budget_exceeded',
            `Periodic-image candidate budget ${maxPeriodicImageCandidates} is exhausted`,
          )
        }
        let resolved
        try {
          resolved = certifiedMinimumImageVector(directDonorVector, lattice, remaining)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new TrajectoryHydrogenBondInputError(
            message.includes('above budget') ? 'hydrogen_bond_image_budget_exceeded' : 'hydrogen_bond_periodic_geometry_failed',
            message,
          )
        }
        periodicImageCandidateEvaluations += resolved.candidateEvaluations
        donorVector = resolved.vector
        donorFractionalImage = resolved.fractionalImage
      }
      const donorHydrogenDistanceA = norm(donorVector)
      minimumObservedDonorHydrogenDistanceA = Math.min(minimumObservedDonorHydrogenDistanceA, donorHydrogenDistanceA)
      if (!worstDonorHydrogen || donorHydrogenDistanceA > maximumObservedDonorHydrogenDistanceA) {
        maximumObservedDonorHydrogenDistanceA = donorHydrogenDistanceA
        worstDonorHydrogen = {
          donorAtomId: pair.donorAtomId,
          hydrogenAtomId: pair.hydrogenAtomId,
          frameIndex,
          distanceA: donorHydrogenDistanceA,
        }
      }
      for (const acceptorAtomId of acceptorAtomIds) {
        if (acceptorAtomId === pair.donorAtomId || acceptorAtomId === pair.hydrogenAtomId
          || adjacency.get(pair.donorAtomId)?.has(acceptorAtomId)) continue
        const acceptorIndex = atomIndexById.get(acceptorAtomId)!
        const directAcceptorVector = subtract(frame.positions[acceptorIndex], hydrogenPosition)
        let acceptorImages: PeriodicImageWithinCutoff[]
        if (lattice) {
          const remaining = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
          if (remaining < 1) {
            throw new TrajectoryHydrogenBondInputError(
              'hydrogen_bond_image_budget_exceeded',
              `Periodic-image candidate budget ${maxPeriodicImageCandidates} is exhausted`,
            )
          }
          let enumerated
          try {
            enumerated = enumeratePeriodicImagesWithinCutoff(
              directAcceptorVector,
              lattice,
              donorAcceptorCutoffA + donorHydrogenDistanceA,
              remaining,
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            throw new TrajectoryHydrogenBondInputError(
              message.includes('above budget') ? 'hydrogen_bond_image_budget_exceeded' : 'hydrogen_bond_periodic_geometry_failed',
              message,
            )
          }
          periodicImageCandidateEvaluations += enumerated.candidateEvaluations
          acceptorImages = enumerated.images
        } else {
          acceptorImages = [{
            vector: directAcceptorVector,
            distance: norm(directAcceptorVector),
            fractionalImage: [0, 0, 0],
          }]
        }
        let best: { image: PeriodicImageWithinCutoff; donorAcceptorDistanceA: number; dhaAngleDeg: number } | null = null
        for (const image of acceptorImages) {
          const donorAcceptorDistanceA = norm(subtract(image.vector, donorVector))
          if (donorAcceptorDistanceA > donorAcceptorCutoffA + 1e-12) continue
          const dhaAngleDeg = angleDeg(donorVector, image.vector)
          if (!Number.isFinite(dhaAngleDeg) || dhaAngleDeg < minimumDhaAngleDeg - 1e-10) continue
          const earlierImage = best && (
            image.fractionalImage[0] < best.image.fractionalImage[0]
            || (image.fractionalImage[0] === best.image.fractionalImage[0]
              && image.fractionalImage[1] < best.image.fractionalImage[1])
            || (image.fractionalImage[0] === best.image.fractionalImage[0]
              && image.fractionalImage[1] === best.image.fractionalImage[1]
              && image.fractionalImage[2] < best.image.fractionalImage[2])
          )
          if (!best || donorAcceptorDistanceA < best.donorAcceptorDistanceA - 1e-12
            || (Math.abs(donorAcceptorDistanceA - best.donorAcceptorDistanceA) <= 1e-12
              && (dhaAngleDeg > best.dhaAngleDeg + 1e-10
                || (Math.abs(dhaAngleDeg - best.dhaAngleDeg) <= 1e-10 && earlierImage)))) {
            best = { image, donorAcceptorDistanceA, dhaAngleDeg }
          }
        }
        if (!best) continue
        const id = fingerprintCanonicalJson([pair.donorAtomId, pair.hydrogenAtomId, acceptorAtomId])
        const event: HydrogenBondEvent = {
          id,
          donorAtomId: pair.donorAtomId,
          hydrogenAtomId: pair.hydrogenAtomId,
          acceptorAtomId,
          frameIndex,
          timePs: frame.timePs,
          donorHydrogenDistanceA,
          donorAcceptorDistanceA: best.donorAcceptorDistanceA,
          dhaAngleDeg: best.dhaAngleDeg,
          donorFractionalImage,
          acceptorFractionalImage: best.image.fractionalImage,
          unwrappedPositions: [
            add(hydrogenPosition, donorVector),
            [...hydrogenPosition] as Vec3,
            add(hydrogenPosition, best.image.vector),
          ],
        }
        events.push(event)
        if (!eventsById.has(id)) eventsById.set(id, [])
        eventsById.get(id)!.push(event)
      }
    }
    events.sort((left, right) => (
      atomIndexById.get(left.donorAtomId)! - atomIndexById.get(right.donorAtomId)!
      || atomIndexById.get(left.hydrogenAtomId)! - atomIndexById.get(right.hydrogenAtomId)!
      || atomIndexById.get(left.acceptorAtomId)! - atomIndexById.get(right.acceptorAtomId)!
    ))
    frames.push({ frameIndex, timePs: frame.timePs, events })
  }

  const frameOrdinal = new Map(frameIndices.map((frameIndex, ordinal) => [frameIndex, ordinal]))
  const hydrogenBonds = [...eventsById.values()].map((samples): HydrogenBondAggregate => {
    const first = samples[0]
    const representativeEvent = samples.reduce((best, event) => (
      event.donorAcceptorDistanceA < best.donorAcceptorDistanceA ? event : best
    ), first)
    const presenceFrameIndices = samples.map((event) => event.frameIndex)
    const presenceOrdinals = presenceFrameIndices.map((frameIndex) => frameOrdinal.get(frameIndex)!)
    return {
      id: first.id,
      donorAtomId: first.donorAtomId,
      hydrogenAtomId: first.hydrogenAtomId,
      acceptorAtomId: first.acceptorAtomId,
      observationCount: samples.length,
      occurrenceFraction: samples.length / frameIndices.length,
      presenceFrameIndices,
      meanDonorAcceptorDistanceA: samples.reduce((sum, event) => sum + event.donorAcceptorDistanceA, 0) / samples.length,
      minimumDonorAcceptorDistanceA: Math.min(...samples.map((event) => event.donorAcceptorDistanceA)),
      meanDhaAngleDeg: samples.reduce((sum, event) => sum + event.dhaAngleDeg, 0) / samples.length,
      maximumDhaAngleDeg: Math.max(...samples.map((event) => event.dhaAngleDeg)),
      continuousRuns: continuousRuns(presenceOrdinals, cadencePs),
      representativeEvent,
    }
  }).sort((left, right) => (
    right.occurrenceFraction - left.occurrenceFraction
    || left.minimumDonorAcceptorDistanceA - right.minimumDonorAcceptorDistanceA
    || atomIndexById.get(left.donorAtomId)! - atomIndexById.get(right.donorAtomId)!
    || atomIndexById.get(left.hydrogenAtomId)! - atomIndexById.get(right.hydrogenAtomId)!
    || atomIndexById.get(left.acceptorAtomId)! - atomIndexById.get(right.acceptorAtomId)!
  ))
  const eventCount = frames.reduce((sum, frame) => sum + frame.events.length, 0)
  const donorHydrogenPassed = minimumObservedDonorHydrogenDistanceA > 1e-8
    && maximumObservedDonorHydrogenDistanceA <= maximumDonorHydrogenDistanceA + 1e-12
  const structureFingerprint = fingerprintStructure(options.structure)
  const trajectoryFingerprint = fingerprintTrajectory(options.trajectory)
  const method = {
    engine: 'zatom-topology-hydrogen-bonds',
    engineVersion: TRAJECTORY_HYDROGEN_BOND_VERSION,
    donorHydrogenIdentity: 'explicit-structure-bonds',
    geometry: 'donor-acceptor-distance-and-donor-hydrogen-acceptor-angle',
    periodicImages: 'consistent-hydrogen-centered-complete-acceptor-enumeration',
  } as const
  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_hydrogen_bond.identity',
      status: 'pass',
      message: 'Hydrogen-bond analysis binds exact structure/trajectory identity and final coordinates',
      metrics: { structureFingerprint, trajectoryFingerprint, atomCount: options.structure.atoms.length },
    },
    {
      id: 'trajectory_hydrogen_bond.topology',
      status: 'pass',
      message: `Resolved ${donorHydrogenPairs.length} donor-hydrogen pairs exclusively from explicit topology`,
      metrics: {
        donorAtomCount: donorAtomIds.length,
        donorHydrogenPairCount: donorHydrogenPairs.length,
        acceptorAtomCount: acceptorAtomIds.length,
        excludedCovalentlyBondedCandidateCount,
      },
    },
    {
      id: 'trajectory_hydrogen_bond.cadence',
      status: 'pass',
      message: `Selected frames have uniform ${cadencePs} ps cadence within relative error ${maximumCadenceRelativeError}`,
      metrics: { cadencePs, maximumCadenceRelativeError, selectedFrameCount: frameIndices.length },
    },
    {
      id: 'trajectory_hydrogen_bond.triple_budget',
      status: 'pass',
      message: `Evaluated ${tripleEvaluations.toLocaleString()} of ${maxTripleEvaluations.toLocaleString()} donor-hydrogen-acceptor triples`,
      metrics: { tripleEvaluations, maxTripleEvaluations },
    },
    {
      id: 'trajectory_hydrogen_bond.periodic_image_budget',
      status: 'pass',
      message: options.periodic
        ? `Periodic geometry used ${periodicImageCandidateEvaluations.toLocaleString()} of ${maxPeriodicImageCandidates.toLocaleString()} image candidates`
        : 'Periodic images were explicitly disabled',
      metrics: { periodic: options.periodic, periodicImageCandidateEvaluations, maxPeriodicImageCandidates },
    },
    {
      id: 'trajectory_hydrogen_bond.donor_hydrogen_distance',
      status: donorHydrogenPassed ? 'pass' : 'fail',
      message: donorHydrogenPassed
        ? `Every explicit donor-hydrogen bond remains within ${maximumDonorHydrogenDistanceA} Å`
        : minimumObservedDonorHydrogenDistanceA <= 1e-8
          ? 'An explicit donor-hydrogen bond has zero length'
          : `An explicit donor-hydrogen bond reaches ${maximumObservedDonorHydrogenDistanceA} Å above ${maximumDonorHydrogenDistanceA} Å`,
      metrics: {
        minimumObservedDonorHydrogenDistanceA,
        maximumObservedDonorHydrogenDistanceA,
        maximumDonorHydrogenDistanceA,
      },
      ...(worstDonorHydrogen ? { atomIds: [worstDonorHydrogen.donorAtomId, worstDonorHydrogen.hydrogenAtomId] } : {}),
    },
    {
      id: 'trajectory_hydrogen_bond.nonempty',
      status: eventCount ? 'pass' : 'warn',
      message: eventCount
        ? `Detected ${eventCount.toLocaleString()} hydrogen-bond observations across ${hydrogenBonds.length} exact triples`
        : 'No donor-hydrogen-acceptor triple satisfies the requested geometric criteria',
      metrics: { eventCount, uniqueHydrogenBondCount: hydrogenBonds.length },
    },
    {
      id: 'trajectory_hydrogen_bond.scope',
      status: 'warn',
      message: 'Caller-declared donor/acceptor chemistry plus a geometric cutoff does not prove electronic hydrogen bonding, equilibrium, or lifetime convergence; continuous sampled runs are not an autocorrelation lifetime',
      metrics: { donorAcceptorCutoffA, minimumDhaAngleDeg },
    },
  ]
  const inspectionTargets: InspectionTarget[] = []
  if (hydrogenBonds[0]) {
    const event = hydrogenBonds[0].representativeEvent
    const positions = event.unwrappedPositions
    inspectionTargets.push({
      id: 'trajectory-hydrogen-bond-primary',
      reason: `Inspect most persistent hydrogen-bond triple at ${event.donorAcceptorDistanceA} Å and ${event.dhaAngleDeg}°`,
      center: [
        (positions[0][0] + positions[1][0] + positions[2][0]) / 3,
        (positions[0][1] + positions[1][1] + positions[2][1]) / 3,
        (positions[0][2] + positions[1][2] + positions[2][2]) / 3,
      ],
      radius: Math.max(1, event.donorAcceptorDistanceA / 2),
      atomIds: [event.donorAtomId, event.hydrogenAtomId, event.acceptorAtomId],
      trajectoryFrameIndex: event.frameIndex,
    })
  }
  if (!donorHydrogenPassed && worstDonorHydrogen) {
    const donorIndex = atomIndexById.get(worstDonorHydrogen.donorAtomId)!
    const hydrogenIndex = atomIndexById.get(worstDonorHydrogen.hydrogenAtomId)!
    const frame = options.trajectory.frames[worstDonorHydrogen.frameIndex]
    inspectionTargets.push({
      id: 'trajectory-hydrogen-bond-worst-donor-bond',
      reason: `Inspect donor-hydrogen distance ${worstDonorHydrogen.distanceA} Å above its gate`,
      center: [
        (frame.positions[donorIndex][0] + frame.positions[hydrogenIndex][0]) / 2,
        (frame.positions[donorIndex][1] + frame.positions[hydrogenIndex][1]) / 2,
        (frame.positions[donorIndex][2] + frame.positions[hydrogenIndex][2]) / 2,
      ],
      radius: Math.max(1, worstDonorHydrogen.distanceA / 2),
      atomIds: [worstDonorHydrogen.donorAtomId, worstDonorHydrogen.hydrogenAtomId],
      trajectoryFrameIndex: worstDonorHydrogen.frameIndex,
    })
  }
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    trajectoryFingerprint,
    method,
    periodic: options.periodic,
    criteria: { donorAcceptorCutoffA, minimumDhaAngleDeg, maximumDonorHydrogenDistanceA },
    donorHydrogenPairs,
    acceptorAtomIds,
    frameIndices,
    frames,
  })
  return {
    structureFingerprint,
    trajectoryFingerprint,
    fingerprint,
    method,
    periodic: options.periodic,
    criteria: { donorAcceptorCutoffA, minimumDhaAngleDeg, maximumDonorHydrogenDistanceA },
    donorHydrogenPairs,
    acceptorAtomIds,
    excludedCovalentlyBondedCandidateCount,
    frameRange: {
      startFrameIndex,
      endFrameIndex,
      frameStride,
      frameIndices,
      frameCount: frameIndices.length,
      cadencePs,
      maximumCadenceRelativeError,
    },
    tripleEvaluations,
    periodicImageCandidateEvaluations,
    eventCount,
    frames,
    hydrogenBonds,
    verdict: donorHydrogenPassed ? 'warn' : 'fail',
    checks,
    inspectionTargets,
  }
}
