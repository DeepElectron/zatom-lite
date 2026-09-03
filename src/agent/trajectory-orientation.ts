import type {
  InspectionTarget,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomTrajectory,
} from './contracts'
import {
  certifiedMinimumImageVector,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export const TRAJECTORY_ORIENTATION_VERSION = '1.0.0'

export interface TrajectoryOrientationDirectorInput {
  id: string
  fromAtomId: string
  toAtomId: string
}

export interface AnalyzeTrajectoryOrientationOptions {
  structure: ZatomStructure
  trajectory: ZatomTrajectory
  directors: TrajectoryOrientationDirectorInput[]
  referenceAxis: Vec3
  periodic: boolean
  maximumDirectorLengthA?: number
  minimumMeanReferenceP2?: number
  maximumMeanReferenceP2?: number
  startFrameIndex?: number
  endFrameIndex?: number
  frameStride?: number
  maxDirectorFrameEvaluations?: number
  maxPeriodicImageCandidates?: number
}

export interface TrajectoryOrientationSample {
  directorId: string
  fromAtomId: string
  toAtomId: string
  frameIndex: number
  timePs: number
  vector: Vec3
  unitVector: Vec3
  lengthA: number
  fractionalImage: [number, number, number]
  fromPosition: Vec3
  toImagePosition: Vec3
  cosTheta: number
  absoluteCosTheta: number
  referenceP2: number
}

export interface TrajectoryOrientationTensorSummary {
  tensor: Mat3
  eigenvalues: [number, number, number]
  principalOrder: number
  principalDirector: Vec3 | null
  principalEigenvalueGap: number
  directorResolved: boolean
}

export interface TrajectoryOrientationFrameSummary extends TrajectoryOrientationTensorSummary {
  frameIndex: number
  timePs: number
  directorCount: number
  meanCosTheta: number
  meanAbsoluteCosTheta: number
  meanReferenceP2: number
}

export interface TrajectoryOrientationDirectorSummary {
  id: string
  fromAtomId: string
  toAtomId: string
  sampleCount: number
  meanCosTheta: number
  meanAbsoluteCosTheta: number
  meanReferenceP2: number
  minimumLengthA: number
  maximumLengthA: number
  minimumReferenceP2Sample: TrajectoryOrientationSample
  maximumReferenceP2Sample: TrajectoryOrientationSample
}

export interface TrajectoryOrientationResult {
  structureFingerprint: string
  trajectoryFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-explicit-director-orientation'
    engineVersion: typeof TRAJECTORY_ORIENTATION_VERSION
    directorIdentity: 'caller-declared-ordered-atom-pairs'
    referenceStatistic: 'second-legendre-polynomial'
    tensorConvention: 'mean((3*u*uT-I)/2)'
    weighting: 'equal-director-equal-frame'
    periodicVectors: 'certified-minimum-image'
  }
  periodic: boolean
  referenceAxis: Vec3
  criteria: {
    maximumDirectorLengthA: number
    minimumMeanReferenceP2: number | null
    maximumMeanReferenceP2: number | null
  }
  frameRange: {
    startFrameIndex: number
    endFrameIndex: number
    frameStride: number
    frameIndices: number[]
    frameCount: number
    cadencePs: number
    maximumCadenceRelativeError: number
  }
  directorFrameEvaluations: number
  periodicImageCandidateEvaluations: number
  meanCosTheta: number
  meanAbsoluteCosTheta: number
  meanReferenceP2: number
  referenceTensorProjectionP2: number
  referenceTensorProjectionError: number
  tensor: TrajectoryOrientationTensorSummary
  frames: TrajectoryOrientationFrameSummary[]
  directors: TrajectoryOrientationDirectorSummary[]
  extrema: {
    minimumReferenceP2: TrajectoryOrientationSample
    maximumReferenceP2: TrajectoryOrientationSample
    minimumCosTheta: TrajectoryOrientationSample
    maximumCosTheta: TrajectoryOrientationSample
    maximumLength: TrajectoryOrientationSample
  }
  verdict: 'warn' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class TrajectoryOrientationInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryOrientationInputError'
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
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_parameter',
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
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_parameter',
      `${field} must be finite and in [${minimum}, ${maximum}]`,
    )
  }
  return parsed
}

function optionalP2(value: number | undefined, field: string): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value) || value < -0.5 || value > 1) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_parameter',
      `${field} must be finite and in [-0.5, 1]`,
    )
  }
  return value
}

function normalize(vector: readonly number[], field: string): Vec3 {
  if (vector.length !== 3 || vector.some((value) => !Number.isFinite(value))) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_axis',
      `${field} must contain three finite Cartesian components`,
    )
  }
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length <= 1e-12) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_axis',
      `${field} must have nonzero length`,
    )
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function canonicalizeEigenvector(vector: readonly number[]): Vec3 {
  const normalized = normalize(vector, 'principal eigenvector')
  let pivot = 0
  for (let axis = 1; axis < 3; axis++) {
    if (Math.abs(normalized[axis]) > Math.abs(normalized[pivot]) + 1e-15) pivot = axis
  }
  return normalized[pivot] < 0
    ? [-normalized[0], -normalized[1], -normalized[2]]
    : normalized
}

/** Deterministic Jacobi eigendecomposition for one finite symmetric 3x3 matrix. */
function symmetricEigenDecomposition(matrix: Mat3): {
  eigenvalues: [number, number, number]
  eigenvectors: [Vec3, Vec3, Vec3]
} {
  const work = matrix.map((row) => [...row] as Vec3) as Mat3
  const vectors: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 50; sweep++) {
    let p: 0 | 1 | 2 = 0
    let q: 0 | 1 | 2 = 1
    let largest = Math.abs(work[0][1])
    for (const [row, column] of [[0, 2], [1, 2]] as const) {
      const value = Math.abs(work[row][column])
      if (value > largest) {
        largest = value
        p = row
        q = column
      }
    }
    const scale = Math.max(1, Math.abs(work[0][0]), Math.abs(work[1][1]), Math.abs(work[2][2]))
    if (largest <= 1e-14 * scale) break
    const angle = 0.5 * Math.atan2(2 * work[p][q], work[q][q] - work[p][p])
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const app = work[p][p]
    const aqq = work[q][q]
    const apq = work[p][q]
    work[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq
    work[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq
    work[p][q] = 0
    work[q][p] = 0
    for (const axis of [0, 1, 2] as const) {
      if (axis === p || axis === q) continue
      const aip = work[axis][p]
      const aiq = work[axis][q]
      work[axis][p] = cosine * aip - sine * aiq
      work[p][axis] = work[axis][p]
      work[axis][q] = sine * aip + cosine * aiq
      work[q][axis] = work[axis][q]
    }
    for (const axis of [0, 1, 2] as const) {
      const vip = vectors[axis][p]
      const viq = vectors[axis][q]
      vectors[axis][p] = cosine * vip - sine * viq
      vectors[axis][q] = sine * vip + cosine * viq
    }
  }
  const entries = ([0, 1, 2] as const).map((axis) => ({
    value: work[axis][axis],
    vector: canonicalizeEigenvector([vectors[0][axis], vectors[1][axis], vectors[2][axis]]),
  })).sort((left, right) => right.value - left.value)
  return {
    eigenvalues: entries.map((entry) => entry.value) as [number, number, number],
    eigenvectors: entries.map((entry) => entry.vector) as [Vec3, Vec3, Vec3],
  }
}

function tensorSummary(samples: readonly TrajectoryOrientationSample[]): TrajectoryOrientationTensorSummary {
  const tensor: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (const sample of samples) {
    for (const row of [0, 1, 2] as const) {
      for (const column of [0, 1, 2] as const) {
        tensor[row][column] += (3 * sample.unitVector[row] * sample.unitVector[column]
          - (row === column ? 1 : 0)) / 2
      }
    }
  }
  for (const row of [0, 1, 2] as const) {
    for (const column of [0, 1, 2] as const) tensor[row][column] /= samples.length
  }
  const { eigenvalues, eigenvectors } = symmetricEigenDecomposition(tensor)
  const principalEigenvalueGap = eigenvalues[0] - eigenvalues[1]
  const directorResolved = principalEigenvalueGap > 1e-10
  return {
    tensor,
    eigenvalues,
    principalOrder: eigenvalues[0],
    principalDirector: directorResolved ? eigenvectors[0] : null,
    principalEigenvalueGap,
    directorResolved,
  }
}

function latticeForFrame(
  trajectory: ZatomTrajectory,
  frameIndex: number,
  periodic: boolean,
): ZatomLattice | undefined {
  if (!periodic) return undefined
  const lattice = trajectory.lattice ?? trajectory.frames[frameIndex].lattice
  if (!lattice || !lattice.periodic.some(Boolean)) {
    throw new TrajectoryOrientationInputError(
      'periodic_orientation_lattice_required',
      `Periodic orientation analysis requires a lattice with at least one periodic axis at frame ${frameIndex}`,
    )
  }
  return lattice
}

function sampleCenter(sample: TrajectoryOrientationSample): Vec3 {
  return [
    (sample.fromPosition[0] + sample.toImagePosition[0]) / 2,
    (sample.fromPosition[1] + sample.toImagePosition[1]) / 2,
    (sample.fromPosition[2] + sample.toImagePosition[2]) / 2,
  ]
}

function sampleTarget(id: string, reason: string, sample: TrajectoryOrientationSample): InspectionTarget {
  return {
    id,
    reason,
    center: sampleCenter(sample),
    radius: Math.max(1, sample.lengthA / 2),
    atomIds: [sample.fromAtomId, sample.toAtomId],
    trajectoryFrameIndex: sample.frameIndex,
  }
}

/** Analyze explicit atom-pair directors without guessing molecular identity from proximity. */
export function analyzeTrajectoryOrientation(
  options: AnalyzeTrajectoryOrientationOptions,
): TrajectoryOrientationResult {
  if (typeof options.periodic !== 'boolean') {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_periodicity',
      'periodic must explicitly state whether declared periodic images are used',
    )
  }
  const atomIndexById = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
  if (atomIndexById.size !== options.structure.atoms.length) {
    throw new TrajectoryOrientationInputError('duplicate_atom_ids', 'Orientation analysis requires unique atom IDs')
  }
  if (!Array.isArray(options.directors) || !options.directors.length) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_directors',
      'directors must contain at least one explicit ordered atom pair',
    )
  }
  const directorIds = new Set<string>()
  const pairKeys = new Set<string>()
  const directors = options.directors.map((director, index): TrajectoryOrientationDirectorInput => {
    if (!director || typeof director !== 'object') {
      throw new TrajectoryOrientationInputError(
        'invalid_orientation_directors',
        `directors[${index}] must be an object`,
      )
    }
    const id = String(director.id ?? '').trim()
    const fromAtomId = String(director.fromAtomId ?? '').trim()
    const toAtomId = String(director.toAtomId ?? '').trim()
    if (!id || !fromAtomId || !toAtomId) {
      throw new TrajectoryOrientationInputError(
        'invalid_orientation_directors',
        `directors[${index}] requires non-empty id, fromAtomId, and toAtomId`,
      )
    }
    if (directorIds.has(id)) {
      throw new TrajectoryOrientationInputError(
        'duplicate_orientation_director',
        `Director ID ${id} is duplicated`,
      )
    }
    if (fromAtomId === toAtomId) {
      throw new TrajectoryOrientationInputError(
        'invalid_orientation_directors',
        `Director ${id} must connect two distinct atoms`,
      )
    }
    const missing = [fromAtomId, toAtomId].filter((atomId) => !atomIndexById.has(atomId))
    if (missing.length) {
      throw new TrajectoryOrientationInputError(
        'orientation_atoms_missing',
        `Director ${id} references absent atoms: ${missing.join(', ')}`,
      )
    }
    const pairKey = [fromAtomId, toAtomId].sort().join('\u0000')
    if (pairKeys.has(pairKey)) {
      throw new TrajectoryOrientationInputError(
        'duplicate_orientation_director',
        `Director ${id} repeats an atom pair already present in the equally weighted director set`,
      )
    }
    directorIds.add(id)
    pairKeys.add(pairKey)
    return { id, fromAtomId, toAtomId }
  })

  const frameCount = options.trajectory.frames.length
  if (frameCount < 2) {
    throw new TrajectoryOrientationInputError('insufficient_orientation_frames', 'At least two frames are required')
  }
  const structureAtomIds = options.structure.atoms.map((atom) => atom.id)
  if (structureAtomIds.length !== options.trajectory.atomIds.length
    || structureAtomIds.some((atomId, index) => atomId !== options.trajectory.atomIds[index])) {
    throw new TrajectoryOrientationInputError(
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
    throw new TrajectoryOrientationInputError(
      'trajectory_structure_identity_mismatch',
      'trajectory final positions must match the exact result structure',
    )
  }

  const referenceAxis = normalize(options.referenceAxis, 'referenceAxis')
  const maximumDirectorLengthA = finiteNumber(
    options.maximumDirectorLengthA,
    10,
    'maximumDirectorLengthA',
    Number.MIN_VALUE,
    1_000_000,
  )
  const minimumMeanReferenceP2 = optionalP2(options.minimumMeanReferenceP2, 'minimumMeanReferenceP2')
  const maximumMeanReferenceP2 = optionalP2(options.maximumMeanReferenceP2, 'maximumMeanReferenceP2')
  if (minimumMeanReferenceP2 !== null && maximumMeanReferenceP2 !== null
    && minimumMeanReferenceP2 > maximumMeanReferenceP2) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_parameter',
      'minimumMeanReferenceP2 must not exceed maximumMeanReferenceP2',
    )
  }
  const startFrameIndex = boundedInteger(options.startFrameIndex, 0, 'startFrameIndex', 0, frameCount - 1)
  const endFrameIndex = boundedInteger(options.endFrameIndex, frameCount - 1, 'endFrameIndex', 0, frameCount - 1)
  if (endFrameIndex < startFrameIndex) {
    throw new TrajectoryOrientationInputError(
      'invalid_orientation_frame_range',
      'endFrameIndex must not precede startFrameIndex',
    )
  }
  const frameStride = boundedInteger(options.frameStride, 1, 'frameStride', 1, frameCount)
  const frameIndices: number[] = []
  for (let index = startFrameIndex; index <= endFrameIndex; index += frameStride) frameIndices.push(index)
  if (frameIndices.length < 2) {
    throw new TrajectoryOrientationInputError(
      'insufficient_orientation_frames',
      'The selected frame range and stride must retain at least two frames',
    )
  }
  const cadencePs = options.trajectory.frames[frameIndices[1]].timePs
    - options.trajectory.frames[frameIndices[0]].timePs
  let maximumCadenceRelativeError = 0
  for (let ordinal = 2; ordinal < frameIndices.length; ordinal++) {
    const currentCadence = options.trajectory.frames[frameIndices[ordinal]].timePs
      - options.trajectory.frames[frameIndices[ordinal - 1]].timePs
    maximumCadenceRelativeError = Math.max(
      maximumCadenceRelativeError,
      Math.abs(currentCadence - cadencePs) / Math.max(Math.abs(cadencePs), 1e-30),
    )
  }
  if (!Number.isFinite(cadencePs) || cadencePs <= 0 || maximumCadenceRelativeError > 1e-6) {
    throw new TrajectoryOrientationInputError(
      'nonuniform_orientation_cadence',
      'Selected frames must have a uniform positive physical cadence for equal-frame time averaging',
    )
  }

  const directorFrameEvaluations = directors.length * frameIndices.length
  const maxDirectorFrameEvaluations = boundedInteger(
    options.maxDirectorFrameEvaluations,
    5_000_000,
    'maxDirectorFrameEvaluations',
    1,
    100_000_000,
  )
  if (!Number.isSafeInteger(directorFrameEvaluations)
    || directorFrameEvaluations > maxDirectorFrameEvaluations) {
    throw new TrajectoryOrientationInputError(
      'orientation_evaluation_budget_exceeded',
      `Orientation analysis requires ${directorFrameEvaluations} director-frame evaluations above budget ${maxDirectorFrameEvaluations}`,
    )
  }
  const maxPeriodicImageCandidates = boundedInteger(
    options.maxPeriodicImageCandidates,
    50_000_000,
    'maxPeriodicImageCandidates',
    1,
    1_000_000_000,
  )

  const samples: TrajectoryOrientationSample[] = []
  const samplesByFrame = new Map<number, TrajectoryOrientationSample[]>()
  const samplesByDirector = new Map(directors.map((director) => [director.id, [] as TrajectoryOrientationSample[]]))
  let periodicImageCandidateEvaluations = 0
  for (const frameIndex of frameIndices) {
    const frame = options.trajectory.frames[frameIndex]
    const lattice = latticeForFrame(options.trajectory, frameIndex, options.periodic)
    const frameSamples: TrajectoryOrientationSample[] = []
    for (const director of directors) {
      const fromPosition = frame.positions[atomIndexById.get(director.fromAtomId)!]
      const toPosition = frame.positions[atomIndexById.get(director.toAtomId)!]
      const rawVector = subtract(toPosition, fromPosition)
      let vector = rawVector
      let fractionalImage: [number, number, number] = [0, 0, 0]
      if (lattice) {
        const remainingBudget = maxPeriodicImageCandidates - periodicImageCandidateEvaluations
        if (remainingBudget < 1) {
          throw new TrajectoryOrientationInputError(
            'periodic_image_budget_exceeded',
            `Periodic orientation geometry exhausted image candidate budget ${maxPeriodicImageCandidates}`,
          )
        }
        try {
          const image = certifiedMinimumImageVector(rawVector, lattice, remainingBudget)
          vector = image.vector
          fractionalImage = image.fractionalImage
          periodicImageCandidateEvaluations += image.candidateEvaluations
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new TrajectoryOrientationInputError(
            message.includes('above budget') ? 'periodic_image_budget_exceeded' : 'invalid_orientation_lattice',
            message,
          )
        }
      }
      const lengthA = Math.hypot(vector[0], vector[1], vector[2])
      if (!Number.isFinite(lengthA) || lengthA <= 1e-10) {
        throw new TrajectoryOrientationInputError(
          'zero_length_orientation_director',
          `Director ${director.id} has zero length at frame ${frameIndex}`,
        )
      }
      const unitVector: Vec3 = [vector[0] / lengthA, vector[1] / lengthA, vector[2] / lengthA]
      const cosTheta = Math.max(-1, Math.min(1, dot(unitVector, referenceAxis)))
      const sample: TrajectoryOrientationSample = {
        directorId: director.id,
        fromAtomId: director.fromAtomId,
        toAtomId: director.toAtomId,
        frameIndex,
        timePs: frame.timePs,
        vector,
        unitVector,
        lengthA,
        fractionalImage,
        fromPosition: [...fromPosition] as Vec3,
        toImagePosition: add(fromPosition, vector),
        cosTheta,
        absoluteCosTheta: Math.abs(cosTheta),
        referenceP2: (3 * cosTheta * cosTheta - 1) / 2,
      }
      samples.push(sample)
      frameSamples.push(sample)
      samplesByDirector.get(director.id)!.push(sample)
    }
    samplesByFrame.set(frameIndex, frameSamples)
  }

  const mean = (items: readonly TrajectoryOrientationSample[], select: (sample: TrajectoryOrientationSample) => number) => (
    items.reduce((sum, sample) => sum + select(sample), 0) / items.length
  )
  const frames = frameIndices.map((frameIndex): TrajectoryOrientationFrameSummary => {
    const frameSamples = samplesByFrame.get(frameIndex)!
    return {
      frameIndex,
      timePs: options.trajectory.frames[frameIndex].timePs,
      directorCount: frameSamples.length,
      meanCosTheta: mean(frameSamples, (sample) => sample.cosTheta),
      meanAbsoluteCosTheta: mean(frameSamples, (sample) => sample.absoluteCosTheta),
      meanReferenceP2: mean(frameSamples, (sample) => sample.referenceP2),
      ...tensorSummary(frameSamples),
    }
  })
  const directorSummaries = directors.map((director): TrajectoryOrientationDirectorSummary => {
    const directorSamples = samplesByDirector.get(director.id)!
    return {
      ...director,
      sampleCount: directorSamples.length,
      meanCosTheta: mean(directorSamples, (sample) => sample.cosTheta),
      meanAbsoluteCosTheta: mean(directorSamples, (sample) => sample.absoluteCosTheta),
      meanReferenceP2: mean(directorSamples, (sample) => sample.referenceP2),
      minimumLengthA: Math.min(...directorSamples.map((sample) => sample.lengthA)),
      maximumLengthA: Math.max(...directorSamples.map((sample) => sample.lengthA)),
      minimumReferenceP2Sample: directorSamples.reduce((best, sample) => (
        sample.referenceP2 < best.referenceP2 ? sample : best
      )),
      maximumReferenceP2Sample: directorSamples.reduce((best, sample) => (
        sample.referenceP2 > best.referenceP2 ? sample : best
      )),
    }
  })
  const extrema = {
    minimumReferenceP2: samples.reduce((best, sample) => sample.referenceP2 < best.referenceP2 ? sample : best),
    maximumReferenceP2: samples.reduce((best, sample) => sample.referenceP2 > best.referenceP2 ? sample : best),
    minimumCosTheta: samples.reduce((best, sample) => sample.cosTheta < best.cosTheta ? sample : best),
    maximumCosTheta: samples.reduce((best, sample) => sample.cosTheta > best.cosTheta ? sample : best),
    maximumLength: samples.reduce((best, sample) => sample.lengthA > best.lengthA ? sample : best),
  }
  const meanCosTheta = mean(samples, (sample) => sample.cosTheta)
  const meanAbsoluteCosTheta = mean(samples, (sample) => sample.absoluteCosTheta)
  const meanReferenceP2 = mean(samples, (sample) => sample.referenceP2)
  const tensor = tensorSummary(samples)
  const referenceTensorProjectionP2 = referenceAxis.reduce((sum, rowValue, row) => (
    sum + rowValue * referenceAxis.reduce((inner, columnValue, column) => (
      inner + tensor.tensor[row][column] * columnValue
    ), 0)
  ), 0)
  const referenceTensorProjectionError = Math.abs(referenceTensorProjectionP2 - meanReferenceP2)
  const tensorProjectionPassed = referenceTensorProjectionError <= 1e-10
  const lengthPassed = extrema.maximumLength.lengthA <= maximumDirectorLengthA + 1e-12
  const referenceOrderPassed = (minimumMeanReferenceP2 === null || meanReferenceP2 >= minimumMeanReferenceP2 - 1e-12)
    && (maximumMeanReferenceP2 === null || meanReferenceP2 <= maximumMeanReferenceP2 + 1e-12)
  const structureFingerprint = fingerprintStructure(options.structure)
  const trajectoryFingerprint = fingerprintTrajectory(options.trajectory)
  const method = {
    engine: 'zatom-explicit-director-orientation',
    engineVersion: TRAJECTORY_ORIENTATION_VERSION,
    directorIdentity: 'caller-declared-ordered-atom-pairs',
    referenceStatistic: 'second-legendre-polynomial',
    tensorConvention: 'mean((3*u*uT-I)/2)',
    weighting: 'equal-director-equal-frame',
    periodicVectors: 'certified-minimum-image',
  } as const
  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_orientation.identity',
      status: 'pass',
      message: 'Orientation analysis binds exact structure/trajectory atom order, final coordinates, and fingerprints',
      metrics: { structureFingerprint, trajectoryFingerprint, atomCount: options.structure.atoms.length },
    },
    {
      id: 'trajectory_orientation.directors',
      status: 'pass',
      message: `Analyzed ${directors.length} distinct caller-declared ordered atom-pair directors without proximity inference`,
      metrics: { directorCount: directors.length, referenceAxisX: referenceAxis[0], referenceAxisY: referenceAxis[1], referenceAxisZ: referenceAxis[2] },
    },
    {
      id: 'trajectory_orientation.cadence',
      status: 'pass',
      message: `Selected frames have uniform ${cadencePs} ps cadence within relative error ${maximumCadenceRelativeError}`,
      metrics: { cadencePs, maximumCadenceRelativeError, selectedFrameCount: frameIndices.length },
    },
    {
      id: 'trajectory_orientation.evaluation_budget',
      status: 'pass',
      message: `Evaluated ${directorFrameEvaluations.toLocaleString()} of ${maxDirectorFrameEvaluations.toLocaleString()} director-frame pairs`,
      metrics: { directorFrameEvaluations, maxDirectorFrameEvaluations },
    },
    {
      id: 'trajectory_orientation.periodic_image_budget',
      status: 'pass',
      message: options.periodic
        ? `Periodic vectors used ${periodicImageCandidateEvaluations.toLocaleString()} of ${maxPeriodicImageCandidates.toLocaleString()} image candidates`
        : 'Periodic images were explicitly disabled',
      metrics: { periodic: options.periodic, periodicImageCandidateEvaluations, maxPeriodicImageCandidates },
    },
    {
      id: 'trajectory_orientation.director_length',
      status: lengthPassed ? 'pass' : 'fail',
      message: lengthPassed
        ? `Every director remains within the declared ${maximumDirectorLengthA} Å length gate`
        : `Director ${extrema.maximumLength.directorId} reaches ${extrema.maximumLength.lengthA} Å above the ${maximumDirectorLengthA} Å gate`,
      metrics: { maximumObservedDirectorLengthA: extrema.maximumLength.lengthA, maximumDirectorLengthA },
      atomIds: [extrema.maximumLength.fromAtomId, extrema.maximumLength.toAtomId],
    },
    {
      id: 'trajectory_orientation.reference_order',
      status: minimumMeanReferenceP2 === null && maximumMeanReferenceP2 === null
        ? 'skipped'
        : referenceOrderPassed ? 'pass' : 'fail',
      message: minimumMeanReferenceP2 === null && maximumMeanReferenceP2 === null
        ? `Mean reference-axis P2 is ${meanReferenceP2}; no acceptance interval was requested`
        : `Mean reference-axis P2 ${meanReferenceP2} ${referenceOrderPassed ? 'is inside' : 'is outside'} requested interval [${minimumMeanReferenceP2 ?? -0.5}, ${maximumMeanReferenceP2 ?? 1}]`,
      metrics: {
        meanReferenceP2,
        minimumMeanReferenceP2,
        maximumMeanReferenceP2,
      },
    },
    {
      id: 'trajectory_orientation.tensor_projection',
      status: tensorProjectionPassed ? 'pass' : 'fail',
      message: tensorProjectionPassed
        ? `Reference-axis P2 independently matches n^TQn within ${referenceTensorProjectionError}`
        : `Reference-axis P2 and n^TQn differ by ${referenceTensorProjectionError}`,
      metrics: { meanReferenceP2, referenceTensorProjectionP2, referenceTensorProjectionError },
    },
    {
      id: 'trajectory_orientation.principal_director_resolution',
      status: tensor.directorResolved ? 'pass' : 'warn',
      message: tensor.directorResolved
        ? `The global principal director is resolved with eigenvalue gap ${tensor.principalEigenvalueGap}`
        : `The global principal director is not unique at eigenvalue gap ${tensor.principalEigenvalueGap}; no arbitrary direction is reported`,
      metrics: { principalOrder: tensor.principalOrder, principalEigenvalueGap: tensor.principalEigenvalueGap },
    },
    {
      id: 'trajectory_orientation.scope',
      status: 'warn',
      message: 'Explicit atom-pair geometry and finite uniformly sampled averages do not prove molecular identity, equilibrium, phase identity, or convergence; signed cos(theta) depends on from/to order while P2 and the tensor are head-tail symmetric',
      metrics: { frameCount: frameIndices.length, directorCount: directors.length },
    },
  ]
  const inspectionTargets = [
    sampleTarget(
      'trajectory-orientation-most-aligned',
      `Inspect maximum reference-axis P2 ${extrema.maximumReferenceP2.referenceP2} for director ${extrema.maximumReferenceP2.directorId}`,
      extrema.maximumReferenceP2,
    ),
    sampleTarget(
      'trajectory-orientation-most-transverse',
      `Inspect minimum reference-axis P2 ${extrema.minimumReferenceP2.referenceP2} for director ${extrema.minimumReferenceP2.directorId}`,
      extrema.minimumReferenceP2,
    ),
  ]
  if (!lengthPassed && extrema.maximumLength !== extrema.maximumReferenceP2
    && extrema.maximumLength !== extrema.minimumReferenceP2) {
    inspectionTargets.push(sampleTarget(
      'trajectory-orientation-longest-director',
      `Inspect director ${extrema.maximumLength.directorId} at ${extrema.maximumLength.lengthA} Å above its length gate`,
      extrema.maximumLength,
    ))
  }
  const criteria = {
    maximumDirectorLengthA,
    minimumMeanReferenceP2,
    maximumMeanReferenceP2,
  }
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    trajectoryFingerprint,
    method,
    periodic: options.periodic,
    referenceAxis,
    criteria,
    frameIndices,
    frames,
    directors: directorSummaries,
    extrema,
  })
  return {
    structureFingerprint,
    trajectoryFingerprint,
    fingerprint,
    method,
    periodic: options.periodic,
    referenceAxis,
    criteria,
    frameRange: {
      startFrameIndex,
      endFrameIndex,
      frameStride,
      frameIndices,
      frameCount: frameIndices.length,
      cadencePs,
      maximumCadenceRelativeError,
    },
    directorFrameEvaluations,
    periodicImageCandidateEvaluations,
    meanCosTheta,
    meanAbsoluteCosTheta,
    meanReferenceP2,
    referenceTensorProjectionP2,
    referenceTensorProjectionError,
    tensor,
    frames,
    directors: directorSummaries,
    extrema,
    verdict: lengthPassed && referenceOrderPassed && tensorProjectionPassed ? 'warn' : 'fail',
    checks,
    inspectionTargets,
  }
}
