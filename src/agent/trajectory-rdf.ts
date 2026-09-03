import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomTrajectory,
} from './contracts'
import {
  determinant3,
  enumeratePeriodicImagesWithinCutoff,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export const TRAJECTORY_RDF_VERSION = '1.0.0'

export interface AnalyzeTrajectoryRdfOptions {
  structure: ZatomStructure
  trajectory: ZatomTrajectory
  cutoffA: number
  binCount?: number
  centerElements?: string[]
  neighborElements?: string[]
  startFrameIndex?: number
  endFrameIndex?: number
  frameStride?: number
  maxPairEvaluations?: number
  maxPeriodicImageCandidates?: number
}

export interface TrajectoryRdfRepresentativePair {
  centerAtomId: string
  neighborAtomId: string
  frameIndex: number
  distanceA: number
  fractionalImage: [number, number, number]
  vector: Vec3
  centerPosition: Vec3
  neighborImagePosition: Vec3
}

export interface TrajectoryRdfBin {
  index: number
  minimumRadiusA: number
  maximumRadiusA: number
  centerRadiusA: number
  shellVolumeA3: number
  pairImageCount: number
  meanPairImageCountPerFrame: number
  gR: number
  cumulativeCoordination: number
  representativePair?: TrajectoryRdfRepresentativePair
}

export interface TrajectoryRdfResult {
  structureFingerprint: string
  trajectoryFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-trajectory-rdf'
    engineVersion: typeof TRAJECTORY_RDF_VERSION
    estimator: 'instantaneous-pair-histogram-then-frame-mean'
    normalization: 'center-count-times-neighbor-number-density-times-exact-shell-volume'
    periodicImageMethod: 'singular-value-bounded-complete-enumeration'
  }
  cutoffA: number
  binCount: number
  centerElements: string[]
  neighborElements: string[]
  centerAtomCount: number
  neighborAtomCount: number
  frameRange: {
    startFrameIndex: number
    endFrameIndex: number
    frameStride: number
    frameIndices: number[]
    frameCount: number
    cadencePs: number | null
    maximumCadenceRelativeError: number | null
  }
  minimumCellVolumeA3: number
  maximumCellVolumeA3: number
  pairEvaluations: number
  periodicImageCandidateEvaluations: number
  totalPairImageCount: number
  bins: TrajectoryRdfBin[]
  closestPair: TrajectoryRdfRepresentativePair | null
  verdict: 'warn'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class TrajectoryRdfInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryRdfInputError'
    this.code = code
  }
}

function canonicalElement(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TrajectoryRdfInputError('invalid_rdf_elements', `${field} must be an element symbol`)
  }
  const text = value.trim()
  const symbol = text[0].toUpperCase() + text.slice(1).toLowerCase()
  if (symbolToAtomicNumber(symbol) <= 0) {
    throw new TrajectoryRdfInputError('invalid_rdf_elements', `${field} uses unknown element ${value}`)
  }
  return symbol
}

function selectedElements(
  requested: string[] | undefined,
  availableInOrder: string[],
  field: string,
): string[] {
  if (requested === undefined) return [...availableInOrder]
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TrajectoryRdfInputError('invalid_rdf_elements', `${field} must be a non-empty array when supplied`)
  }
  const parsed = requested.map((value, index) => canonicalElement(value, `${field}[${index}]`))
  if (new Set(parsed).size !== parsed.length) {
    throw new TrajectoryRdfInputError('invalid_rdf_elements', `${field} must not contain duplicates`)
  }
  const available = new Set(availableInOrder)
  const absent = parsed.filter((element) => !available.has(element))
  if (absent.length) {
    throw new TrajectoryRdfInputError(
      'rdf_elements_missing',
      `${field} contains elements absent from the structure: ${absent.join(', ')}`,
    )
  }
  return parsed
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
    throw new TrajectoryRdfInputError('invalid_rdf_parameter', `${field} must be an integer in [${minimum}, ${maximum}]`)
  }
  return parsed
}

function frameLattice(trajectory: ZatomTrajectory, frameIndex: number): ZatomLattice {
  const lattice = trajectory.lattice ?? trajectory.frames[frameIndex].lattice
  if (!lattice || !lattice.periodic.every(Boolean)) {
    throw new TrajectoryRdfInputError(
      'full_periodic_lattice_required',
      `trajectory frame ${frameIndex} requires a fully periodic 3D lattice for RDF normalization`,
    )
  }
  return lattice
}

function zeroImage(image: readonly number[]): boolean {
  return image[0] === 0 && image[1] === 0 && image[2] === 0
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

/** Compute a time-averaged, fully periodic 3D radial distribution function. */
export function analyzeTrajectoryRdf(options: AnalyzeTrajectoryRdfOptions): TrajectoryRdfResult {
  if (!Number.isFinite(options.cutoffA) || options.cutoffA <= 0 || options.cutoffA > 1_000_000) {
    throw new TrajectoryRdfInputError('invalid_rdf_parameter', 'cutoffA must be finite and in (0, 1000000]')
  }
  const cutoffA = options.cutoffA
  const binCount = boundedInteger(options.binCount, 200, 'binCount', 1, 4096)
  const frameCount = options.trajectory.frames.length
  if (frameCount < 2) {
    throw new TrajectoryRdfInputError('insufficient_rdf_frames', 'Trajectory RDF requires at least two canonical frames')
  }
  const structureAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (structureAtomIds.length !== options.trajectory.atomIds.length
    || structureAtomIds.some((atomId, index) => atomId !== options.trajectory.atomIds[index])) {
    throw new TrajectoryRdfInputError(
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
    throw new TrajectoryRdfInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory final positions must match the exact result structure',
    )
  }
  const startFrameIndex = boundedInteger(options.startFrameIndex, 0, 'startFrameIndex', 0, frameCount - 1)
  const endFrameIndex = boundedInteger(options.endFrameIndex, frameCount - 1, 'endFrameIndex', 0, frameCount - 1)
  if (endFrameIndex < startFrameIndex) {
    throw new TrajectoryRdfInputError('invalid_rdf_frame_range', 'endFrameIndex must not precede startFrameIndex')
  }
  const frameStride = boundedInteger(options.frameStride, 1, 'frameStride', 1, frameCount)
  const frameIndices: number[] = []
  for (let frameIndex = startFrameIndex; frameIndex <= endFrameIndex; frameIndex += frameStride) {
    frameIndices.push(frameIndex)
  }
  if (!frameIndices.length) {
    throw new TrajectoryRdfInputError('invalid_rdf_frame_range', 'The selected RDF frame range is empty')
  }

  const availableElements = [...new Set(options.structure.atoms.map((atom) => atom.element))]
  const centerElements = selectedElements(options.centerElements, availableElements, 'centerElements')
  const neighborElements = selectedElements(options.neighborElements, availableElements, 'neighborElements')
  const centerElementSet = new Set(centerElements)
  const neighborElementSet = new Set(neighborElements)
  const centerIndices = options.structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => centerElementSet.has(atom.element))
    .map(({ index }) => index)
  const neighborIndices = options.structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => neighborElementSet.has(atom.element))
    .map(({ index }) => index)
  const maxPairEvaluations = boundedInteger(
    options.maxPairEvaluations,
    5_000_000,
    'maxPairEvaluations',
    1,
    100_000_000,
  )
  const maxPeriodicImageCandidates = boundedInteger(
    options.maxPeriodicImageCandidates,
    50_000_000,
    'maxPeriodicImageCandidates',
    1,
    1_000_000_000,
  )
  const pairEvaluations = frameIndices.length * centerIndices.length * neighborIndices.length
  if (!Number.isSafeInteger(pairEvaluations) || pairEvaluations > maxPairEvaluations) {
    throw new TrajectoryRdfInputError(
      'rdf_pair_budget_exceeded',
      `RDF requires ${pairEvaluations} center-neighbor comparisons above budget ${maxPairEvaluations}`,
    )
  }

  const intervals = frameIndices.slice(1).map((frameIndex, index) => (
    options.trajectory.frames[frameIndex].timePs - options.trajectory.frames[frameIndices[index]].timePs
  ))
  const cadencePs = intervals.length
    ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    : null
  const maximumCadenceRelativeError = cadencePs === null
    ? null
    : Math.max(...intervals.map((value) => Math.abs(value - cadencePs) / cadencePs))
  if (cadencePs !== null && (!Number.isFinite(cadencePs) || cadencePs <= 0
    || maximumCadenceRelativeError! > 1e-7)) {
    throw new TrajectoryRdfInputError(
      'nonuniform_rdf_cadence',
      `Time-averaged RDF requires uniform selected-frame cadence; maximum relative error is ${maximumCadenceRelativeError}`,
    )
  }

  const binWidthA = cutoffA / binCount
  const counts = new Array<number>(binCount).fill(0)
  const gSums = new Array<number>(binCount).fill(0)
  const coordinationSums = new Array<number>(binCount).fill(0)
  const representatives = new Array<TrajectoryRdfRepresentativePair | undefined>(binCount)
  const volumes: number[] = []
  let periodicImageCandidateEvaluations = 0
  let closestPair: TrajectoryRdfRepresentativePair | null = null

  for (const frameIndex of frameIndices) {
    const frame = options.trajectory.frames[frameIndex]
    const lattice = frameLattice(options.trajectory, frameIndex)
    const volumeA3 = Math.abs(determinant3(lattice.vectors))
    if (!Number.isFinite(volumeA3) || volumeA3 <= 1e-12) {
      throw new TrajectoryRdfInputError('invalid_rdf_lattice', `trajectory frame ${frameIndex} has invalid cell volume`)
    }
    volumes.push(volumeA3)
    const frameCounts = new Array<number>(binCount).fill(0)
    for (const centerIndex of centerIndices) {
      const centerPosition = frame.positions[centerIndex]
      for (const neighborIndex of neighborIndices) {
        const neighborPosition = frame.positions[neighborIndex]
        const delta: Vec3 = [
          neighborPosition[0] - centerPosition[0],
          neighborPosition[1] - centerPosition[1],
          neighborPosition[2] - centerPosition[2],
        ]
        const remaining = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
        if (remaining < 1) {
          throw new TrajectoryRdfInputError(
            'rdf_image_budget_exceeded',
            `Periodic-image candidate budget ${maxPeriodicImageCandidates} is exhausted`,
          )
        }
        let enumerated
        try {
          enumerated = enumeratePeriodicImagesWithinCutoff(delta, lattice, cutoffA, remaining)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new TrajectoryRdfInputError(
            message.includes('above budget') ? 'rdf_image_budget_exceeded' : 'rdf_periodic_enumeration_failed',
            message,
          )
        }
        periodicImageCandidateEvaluations += enumerated.candidateEvaluations
        for (const image of enumerated.images) {
          if (centerIndex === neighborIndex && zeroImage(image.fractionalImage)) continue
          const binIndex = Math.min(binCount - 1, Math.floor(image.distance / binWidthA))
          frameCounts[binIndex] += 1
          counts[binIndex] += 1
          const pair: TrajectoryRdfRepresentativePair = {
            centerAtomId: options.structure.atoms[centerIndex].id,
            neighborAtomId: options.structure.atoms[neighborIndex].id,
            frameIndex,
            distanceA: image.distance,
            fractionalImage: image.fractionalImage,
            vector: image.vector,
            centerPosition: [...centerPosition] as Vec3,
            neighborImagePosition: add(centerPosition, image.vector),
          }
          representatives[binIndex] ??= pair
          if (!closestPair || pair.distanceA < closestPair.distanceA - 1e-14) closestPair = pair
        }
      }
    }
    let cumulativeFrameCount = 0
    for (let binIndex = 0; binIndex < binCount; binIndex++) {
      const inner = binIndex * binWidthA
      const outer = (binIndex + 1) * binWidthA
      const shellVolumeA3 = 4 * Math.PI * (outer ** 3 - inner ** 3) / 3
      const expectedCount = centerIndices.length * neighborIndices.length * shellVolumeA3 / volumeA3
      gSums[binIndex] += expectedCount > 0 ? frameCounts[binIndex] / expectedCount : 0
      cumulativeFrameCount += frameCounts[binIndex]
      coordinationSums[binIndex] += cumulativeFrameCount / centerIndices.length
    }
  }

  const bins = counts.map((pairImageCount, index): TrajectoryRdfBin => {
    const minimumRadiusA = index * binWidthA
    const maximumRadiusA = (index + 1) * binWidthA
    const shellVolumeA3 = 4 * Math.PI * (maximumRadiusA ** 3 - minimumRadiusA ** 3) / 3
    return {
      index,
      minimumRadiusA,
      maximumRadiusA,
      centerRadiusA: (minimumRadiusA + maximumRadiusA) / 2,
      shellVolumeA3,
      pairImageCount,
      meanPairImageCountPerFrame: pairImageCount / frameIndices.length,
      gR: gSums[index] / frameIndices.length,
      cumulativeCoordination: coordinationSums[index] / frameIndices.length,
      ...(representatives[index] ? { representativePair: representatives[index] } : {}),
    }
  })
  const totalPairImageCount = counts.reduce((sum, value) => sum + value, 0)
  const structureFingerprint = fingerprintStructure(options.structure)
  const trajectoryFingerprint = fingerprintTrajectory(options.trajectory)
  const minimumCellVolumeA3 = Math.min(...volumes)
  const maximumCellVolumeA3 = Math.max(...volumes)
  const method = {
    engine: 'zatom-trajectory-rdf',
    engineVersion: TRAJECTORY_RDF_VERSION,
    estimator: 'instantaneous-pair-histogram-then-frame-mean',
    normalization: 'center-count-times-neighbor-number-density-times-exact-shell-volume',
    periodicImageMethod: 'singular-value-bounded-complete-enumeration',
  } as const
  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_rdf.identity',
      status: 'pass',
      message: 'RDF binds exact ordered structure/trajectory identity and matching final coordinates',
      metrics: { structureFingerprint, trajectoryFingerprint, atomCount: options.structure.atoms.length },
    },
    {
      id: 'trajectory_rdf.boundary',
      status: 'pass',
      message: `All ${frameIndices.length} selected frames provide fully periodic nonsingular 3D cells`,
      metrics: { frameCount: frameIndices.length, minimumCellVolumeA3, maximumCellVolumeA3 },
    },
    {
      id: 'trajectory_rdf.cadence',
      status: cadencePs === null ? 'skipped' : 'pass',
      message: cadencePs === null
        ? 'One selected frame defines an instantaneous RDF without time averaging'
        : `Selected frames have uniform ${cadencePs} ps cadence within relative error ${maximumCadenceRelativeError}`,
      metrics: { cadencePs, maximumCadenceRelativeError },
    },
    {
      id: 'trajectory_rdf.pair_budget',
      status: 'pass',
      message: `Evaluated ${pairEvaluations.toLocaleString()} of ${maxPairEvaluations.toLocaleString()} center-neighbor pairs`,
      metrics: { pairEvaluations, maxPairEvaluations },
    },
    {
      id: 'trajectory_rdf.periodic_image_budget',
      status: 'pass',
      message: `Complete image enumeration used ${periodicImageCandidateEvaluations.toLocaleString()} of ${maxPeriodicImageCandidates.toLocaleString()} candidates`,
      metrics: { periodicImageCandidateEvaluations, maxPeriodicImageCandidates },
    },
    {
      id: 'trajectory_rdf.normalization',
      status: 'pass',
      message: 'Each instantaneous histogram is normalized by center count, neighbor number density, and exact spherical-shell volume before arithmetic frame averaging',
      metrics: { centerAtomCount: centerIndices.length, neighborAtomCount: neighborIndices.length, binCount, cutoffA },
    },
    {
      id: 'trajectory_rdf.nonempty',
      status: totalPairImageCount ? 'pass' : 'warn',
      message: totalPairImageCount
        ? `Observed ${totalPairImageCount.toLocaleString()} pair images inside the cutoff`
        : 'No pair images fall inside the cutoff; enlarge it or review the element selections',
      metrics: { totalPairImageCount },
    },
    {
      id: 'trajectory_rdf.scope',
      status: 'warn',
      message: 'A finite time-averaged 3D RDF does not prove equilibration, phase identity, independent sampling, or cutoff/bin/trajectory/system-size convergence',
      metrics: { selectedFrameCount: frameIndices.length },
    },
  ]
  const inspectionTargets: InspectionTarget[] = []
  if (closestPair) {
    inspectionTargets.push({
      id: 'trajectory-rdf-closest-pair',
      reason: `Inspect closest counted RDF pair image at ${closestPair.distanceA} Å`,
      center: [
        (closestPair.centerPosition[0] + closestPair.neighborImagePosition[0]) / 2,
        (closestPair.centerPosition[1] + closestPair.neighborImagePosition[1]) / 2,
        (closestPair.centerPosition[2] + closestPair.neighborImagePosition[2]) / 2,
      ],
      radius: Math.max(1, closestPair.distanceA / 2),
      atomIds: [...new Set([closestPair.centerAtomId, closestPair.neighborAtomId])],
      trajectoryFrameIndex: closestPair.frameIndex,
    })
  }
  const peakBin = bins.reduce<TrajectoryRdfBin | null>((best, bin) => (
    bin.representativePair && (!best || bin.gR > best.gR) ? bin : best
  ), null)
  if (peakBin?.representativePair) {
    const pair = peakBin.representativePair
    inspectionTargets.push({
      id: 'trajectory-rdf-maximum-bin',
      reason: `Inspect a representative pair from maximum g(r) bin ${peakBin.index} centered at ${peakBin.centerRadiusA} Å`,
      center: [
        (pair.centerPosition[0] + pair.neighborImagePosition[0]) / 2,
        (pair.centerPosition[1] + pair.neighborImagePosition[1]) / 2,
        (pair.centerPosition[2] + pair.neighborImagePosition[2]) / 2,
      ],
      radius: Math.max(1, pair.distanceA / 2),
      atomIds: [...new Set([pair.centerAtomId, pair.neighborAtomId])],
      trajectoryFrameIndex: pair.frameIndex,
    })
  }
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    trajectoryFingerprint,
    method,
    cutoffA,
    binCount,
    centerElements,
    neighborElements,
    frameIndices,
    bins,
  })
  return {
    structureFingerprint,
    trajectoryFingerprint,
    fingerprint,
    method,
    cutoffA,
    binCount,
    centerElements,
    neighborElements,
    centerAtomCount: centerIndices.length,
    neighborAtomCount: neighborIndices.length,
    frameRange: {
      startFrameIndex,
      endFrameIndex,
      frameStride,
      frameIndices,
      frameCount: frameIndices.length,
      cadencePs,
      maximumCadenceRelativeError,
    },
    minimumCellVolumeA3,
    maximumCellVolumeA3,
    pairEvaluations,
    periodicImageCandidateEvaluations,
    totalPairImageCount,
    bins,
    closestPair,
    verdict: 'warn',
    checks,
    inspectionTargets,
  }
}
