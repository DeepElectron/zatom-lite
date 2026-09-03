/** Cross-replica scalar diagnostics for canonical trajectory evidence. */

import type {
  InspectionTarget,
  ValidationCheck,
  ZatomTrajectory,
} from './contracts'
import { boundsOfPositions, canonicalJsonIdentity } from './structure-math'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

const MAX_REPLICAS = 16
const MAX_METRICS = 16
const MAX_MATCHING_METADATA_KEYS = 32
const MAX_INSPECTION_TARGETS = 16
const HARD_MAX_TOTAL_FRAMES = 10_000
const HARD_MAX_TOTAL_ATOM_FRAMES = 10_000_000

export class TrajectoryReplicaDiagnosticsInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryReplicaDiagnosticsInputError'
    this.code = code
  }
}

export interface TrajectoryReplicaInput {
  id: string
  /** Caller-declared seed/run identifier. Uniqueness is checked, independence is not inferred. */
  declaredIndependentRunId: string
  trajectory: ZatomTrajectory
  startFrameIndex?: number
  endFrameIndex?: number
}

export interface TrajectoryReplicaMetricGate {
  scalarKey: string
  /** Maximum of rank-normalized bulk and folded split-R-hat. */
  maximumSplitRhat?: number
  /** Largest replica-mean difference divided by pooled within-replica sample SD. */
  maximumReplicaMeanSpreadSigma?: number
  /** Largest pairwise mean difference divided by correlation-adjusted MC standard error. */
  maximumPairwiseMeanZ?: number
  /** Sum of per-replica initial-positive-sequence effective sample estimates. */
  minimumCombinedEffectiveSamples?: number
}

export interface AnalyzeTrajectoryReplicasOptions {
  replicas: TrajectoryReplicaInput[]
  metrics: TrajectoryReplicaMetricGate[]
  minimumFramesPerReplica?: number
  maximumAutocorrelationLag?: number
  maximumRelativeTimeStepDeviation?: number
  /** Metadata field expected to be present and distinct across replicas, e.g. a provider seed. */
  independenceMetadataKey?: string
  requiredMatchingMetadataKeys?: string[]
  maxTotalFrames?: number
  maxTotalAtomFrames?: number
}

export interface TrajectoryReplicaSummary {
  replicaIndex: number
  id: string
  declaredIndependentRunId: string
  trajectoryFingerprint: string
  frameRange: {
    startFrameIndex: number
    endFrameIndex: number
    frameCount: number
    startStep: number
    endStep: number
    startTimePs: number
    endTimePs: number
    durationPs: number
  }
  sampling: {
    meanIntervalPs: number
    minimumIntervalPs: number
    maximumIntervalPs: number
    maximumRelativeDeviation: number
    uniform: boolean
  }
}

export interface TrajectoryReplicaMetricPerReplica {
  replicaIndex: number
  replicaId: string
  mean: number
  standardDeviation: number
  minimum: number
  minimumFrameIndex: number
  maximum: number
  maximumFrameIndex: number
  effectiveSampleSize: number
  integratedAutocorrelationTimeFrames: number
}

export interface TrajectoryReplicaMetricDiagnostics {
  scalarKey: string
  perReplica: TrajectoryReplicaMetricPerReplica[]
  pooledWithinReplicaStandardDeviation: number
  maximumReplicaMeanDifference: number
  maximumReplicaMeanSpreadSigma: number | null
  maximumPairwiseMeanZ: number | null
  worstMeanPair: [number, number]
  rankNormalizedSplitRhat: number | null
  foldedRankNormalizedSplitRhat: number | null
  splitRhat: number | null
  combinedEffectiveSamples: number
  thresholds: {
    maximumSplitRhat: number
    maximumReplicaMeanSpreadSigma: number
    maximumPairwiseMeanZ: number
    minimumCombinedEffectiveSamples: number
  }
  gates: {
    splitRhat: boolean
    replicaMeanSpread: boolean
    pairwiseMeanZ: boolean | null
    combinedEffectiveSamples: boolean | null
  }
}

export interface TrajectoryReplicaInspectionTarget extends InspectionTarget {
  replicaIndex: number
  replicaId: string
  trajectoryFingerprint: string
}

export interface AnalyzeTrajectoryReplicasResult {
  replicas: TrajectoryReplicaSummary[]
  metrics: TrajectoryReplicaMetricDiagnostics[]
  independenceMetadataKey: string | null
  requiredMatchingMetadataKeys: string[]
  checks: ValidationCheck[]
  inspectionTargets: TrajectoryReplicaInspectionTarget[]
  provenance: {
    engine: 'zatom-trajectory-replica-diagnostics'
    engineVersion: '1.0.0'
    trajectoryFingerprints: string[]
    parameters: Record<string, unknown>
  }
}

interface ParsedReplica {
  id: string
  declaredIndependentRunId: string
  trajectory: ZatomTrajectory
  fingerprint: string
  startFrameIndex: number
  endFrameIndex: number
  frames: ZatomTrajectory['frames']
  summary: TrajectoryReplicaSummary
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_diagnostics_parameter',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return resolved
}

function boundedNumber(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_diagnostics_parameter',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return resolved
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || value.includes('\0')) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_identity',
      `${field} must be a non-empty string of at most 256 characters without NUL bytes`,
    )
  }
  return value.trim()
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleVariance(values: readonly number[], mean = average(values)): number {
  if (values.length < 2) return 0
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function autocorrelation(values: readonly number[], mean: number, variance: number, lag: number): number {
  if (variance <= 0) return 0
  let covariance = 0
  for (let index = 0; index < values.length - lag; index++) {
    covariance += (values[index] - mean) * (values[index + lag] - mean)
  }
  return covariance / ((values.length - lag) * variance)
}

function effectiveSampleSize(values: readonly number[], maximumLag: number): {
  integratedAutocorrelationTimeFrames: number
  effectiveSampleSize: number
} {
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const scale = Math.max(...values.map(Math.abs), 1)
  if (variance <= (scale * 1e-12) ** 2) {
    return { integratedAutocorrelationTimeFrames: 0.5, effectiveSampleSize: values.length }
  }
  let tau = 0.5
  for (let firstLag = 1; firstLag <= maximumLag; firstLag += 2) {
    const first = autocorrelation(values, mean, variance, firstLag)
    const second = firstLag + 1 <= maximumLag
      ? autocorrelation(values, mean, variance, firstLag + 1)
      : 0
    const pairSum = first + second
    if (pairSum <= 0) break
    tau += pairSum
  }
  const finiteTau = Math.max(0.5, Math.min(tau, values.length / 2))
  return {
    integratedAutocorrelationTimeFrames: finiteTau,
    effectiveSampleSize: Math.max(1, Math.min(values.length, values.length / (2 * finiteTau))),
  }
}

/** Peter J. Acklam's inverse-normal approximation, with finite open-interval input. */
function inverseNormalCdf(probability: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lower = 0.02425
  const upper = 1 - lower
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = probability - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

function rankNormalize(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((left, right) => (
    left.value - right.value || left.index - right.index
  ))
  const ranks = new Array<number>(values.length)
  let start = 0
  while (start < indexed.length) {
    let end = start + 1
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++
    const averageRank = ((start + 1) + end) / 2
    for (let index = start; index < end; index++) ranks[indexed[index].index] = averageRank
    start = end
  }
  return ranks.map((rank) => inverseNormalCdf((rank - 3 / 8) / (values.length + 1 / 4)))
}

function splitChains(chains: readonly number[][]): number[][] {
  const halfLength = Math.floor(chains[0].length / 2)
  return chains.flatMap((chain) => [
    chain.slice(0, halfLength),
    chain.slice(chain.length - halfLength),
  ])
}

function rhat(chains: readonly number[][]): number | null {
  const sampleCount = chains[0].length
  const means = chains.map((chain) => average(chain))
  const withinVariance = average(chains.map((chain, index) => sampleVariance(chain, means[index])))
  const betweenVariance = sampleCount * sampleVariance(means)
  const scale = Math.max(...chains.flat().map(Math.abs), 1)
  const epsilon = (scale * 1e-12) ** 2
  if (withinVariance <= epsilon) return betweenVariance <= epsilon ? 1 : null
  const varianceEstimate = (sampleCount - 1) / sampleCount * withinVariance + betweenVariance / sampleCount
  const estimate = Math.sqrt(Math.max(0, varianceEstimate / withinVariance))
  return Number.isFinite(estimate) ? Math.max(1, estimate) : null
}

function rankNormalizedSplitRhats(chains: readonly number[][]): {
  rankNormalized: number | null
  folded: number | null
  maximum: number | null
} {
  const chainLength = chains[0].length
  const flattened = chains.flat()
  const normalized = rankNormalize(flattened)
  const normalizedChains = chains.map((_, index) => normalized.slice(index * chainLength, (index + 1) * chainLength))
  const center = median(flattened)
  const foldedRaw = flattened.map((value) => Math.abs(value - center))
  const foldedNormalized = rankNormalize(foldedRaw)
  const foldedChains = chains.map((_, index) => foldedNormalized.slice(index * chainLength, (index + 1) * chainLength))
  const rankNormalized = rhat(splitChains(normalizedChains))
  const folded = rhat(splitChains(foldedChains))
  return {
    rankNormalized,
    folded,
    maximum: rankNormalized === null || folded === null ? null : Math.max(rankNormalized, folded),
  }
}

function normalizedMetric(metric: TrajectoryReplicaMetricGate, index: number): Required<TrajectoryReplicaMetricGate> {
  if (!metric || typeof metric !== 'object' || typeof metric.scalarKey !== 'string'
    || !metric.scalarKey.trim() || metric.scalarKey.includes('\0')) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_metric',
      `metrics[${index}].scalarKey must be a non-empty string without NUL bytes`,
    )
  }
  return {
    scalarKey: metric.scalarKey.trim(),
    maximumSplitRhat: boundedNumber(metric.maximumSplitRhat, 1.05, `metrics[${index}].maximumSplitRhat`, 1, 1_000_000),
    maximumReplicaMeanSpreadSigma: boundedNumber(
      metric.maximumReplicaMeanSpreadSigma,
      0.5,
      `metrics[${index}].maximumReplicaMeanSpreadSigma`,
      0,
      1_000_000,
    ),
    maximumPairwiseMeanZ: boundedNumber(
      metric.maximumPairwiseMeanZ,
      3,
      `metrics[${index}].maximumPairwiseMeanZ`,
      0,
      1_000_000,
    ),
    minimumCombinedEffectiveSamples: boundedNumber(
      metric.minimumCombinedEffectiveSamples,
      20,
      `metrics[${index}].minimumCombinedEffectiveSamples`,
      1,
      1_000_000,
    ),
  }
}

function effectivePeriodicFlags(trajectory: ZatomTrajectory): [boolean, boolean, boolean] | null {
  const lattice = trajectory.lattice ?? trajectory.frames[0].lattice
  return lattice ? [...lattice.periodic] : null
}

function parseMetadataKeys(value: string[] | undefined): string[] {
  const keys = value ?? []
  if (!Array.isArray(keys) || keys.length > MAX_MATCHING_METADATA_KEYS) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_metadata_keys',
      `requiredMatchingMetadataKeys must contain at most ${MAX_MATCHING_METADATA_KEYS} keys`,
    )
  }
  const normalized = keys.map((key, index) => requiredIdentifier(key, `requiredMatchingMetadataKeys[${index}]`))
  if (new Set(normalized).size !== normalized.length) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'duplicate_replica_metadata_key',
      'requiredMatchingMetadataKeys must not contain duplicates',
    )
  }
  return normalized
}

function makeInspectionTarget(
  replica: ParsedReplica,
  frameIndex: number,
  id: string,
  reason: string,
): TrajectoryReplicaInspectionTarget {
  const frame = replica.trajectory.frames[frameIndex]
  const bounds = boundsOfPositions(frame.positions)!
  return {
    id,
    reason,
    center: bounds.center,
    radius: Math.max(1.5, bounds.radius + 0.5),
    atomIds: replica.trajectory.atomIds.slice(0, 80),
    atomIdsTruncated: replica.trajectory.atomIds.length > 80,
    trajectoryFrameIndex: frameIndex,
    replicaIndex: replica.summary.replicaIndex,
    replicaId: replica.id,
    trajectoryFingerprint: replica.fingerprint,
  }
}

/**
 * Compare explicitly selected scalar windows from caller-declared independent replicas.
 * The result is convergence evidence for named observables, never proof of equilibrium.
 */
export function analyzeTrajectoryReplicas(
  options: AnalyzeTrajectoryReplicasOptions,
): AnalyzeTrajectoryReplicasResult {
  if (!Array.isArray(options.replicas) || options.replicas.length < 2 || options.replicas.length > MAX_REPLICAS) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_trajectory_replicas',
      `replicas must contain 2-${MAX_REPLICAS} trajectory records`,
    )
  }
  if (!Array.isArray(options.metrics) || !options.metrics.length || options.metrics.length > MAX_METRICS) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_metrics',
      `metrics must contain 1-${MAX_METRICS} scalar gate records`,
    )
  }
  const metrics = options.metrics.map(normalizedMetric)
  if (new Set(metrics.map((metric) => metric.scalarKey)).size !== metrics.length) {
    throw new TrajectoryReplicaDiagnosticsInputError('duplicate_replica_metric', 'metrics must not repeat scalarKey values')
  }
  const minimumFramesPerReplica = boundedInteger(
    options.minimumFramesPerReplica,
    20,
    'minimumFramesPerReplica',
    8,
    HARD_MAX_TOTAL_FRAMES,
  )
  const maxTotalFrames = boundedInteger(
    options.maxTotalFrames,
    HARD_MAX_TOTAL_FRAMES,
    'maxTotalFrames',
    16,
    HARD_MAX_TOTAL_FRAMES,
  )
  const maxTotalAtomFrames = boundedInteger(
    options.maxTotalAtomFrames,
    HARD_MAX_TOTAL_ATOM_FRAMES,
    'maxTotalAtomFrames',
    16,
    HARD_MAX_TOTAL_ATOM_FRAMES,
  )
  const allowedTimeDeviation = boundedNumber(
    options.maximumRelativeTimeStepDeviation,
    1e-6,
    'maximumRelativeTimeStepDeviation',
    0,
    1,
  )
  const independenceMetadataKey = options.independenceMetadataKey === undefined
    ? null
    : requiredIdentifier(options.independenceMetadataKey, 'independenceMetadataKey')
  const requiredMatchingMetadataKeys = parseMetadataKeys(options.requiredMatchingMetadataKeys)
  if (independenceMetadataKey && requiredMatchingMetadataKeys.includes(independenceMetadataKey)) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'conflicting_replica_metadata_key',
      'independenceMetadataKey must differ across replicas and cannot also be required to match',
    )
  }

  const parsed: ParsedReplica[] = options.replicas.map((raw, replicaIndex) => {
    if (!raw || typeof raw !== 'object') {
      throw new TrajectoryReplicaDiagnosticsInputError('invalid_trajectory_replica', `replicas[${replicaIndex}] is invalid`)
    }
    const id = requiredIdentifier(raw.id, `replicas[${replicaIndex}].id`)
    const declaredIndependentRunId = requiredIdentifier(
      raw.declaredIndependentRunId,
      `replicas[${replicaIndex}].declaredIndependentRunId`,
    )
    const trajectory = parseZatomTrajectory(raw.trajectory)
    const startFrameIndex = boundedInteger(
      raw.startFrameIndex,
      0,
      `replicas[${replicaIndex}].startFrameIndex`,
      0,
      trajectory.frames.length - 2,
    )
    const endFrameIndex = boundedInteger(
      raw.endFrameIndex,
      trajectory.frames.length - 1,
      `replicas[${replicaIndex}].endFrameIndex`,
      startFrameIndex + 1,
      trajectory.frames.length - 1,
    )
    const frames = trajectory.frames.slice(startFrameIndex, endFrameIndex + 1)
    if (frames.length < minimumFramesPerReplica) {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'insufficient_replica_frames',
        `replicas[${replicaIndex}] selected window contains ${frames.length} frames below minimum ${minimumFramesPerReplica}`,
      )
    }
    const intervals = frames.slice(1).map((frame, index) => frame.timePs - frames[index].timePs)
    const meanIntervalPs = average(intervals)
    const maximumRelativeDeviation = Math.max(...intervals.map((interval) => Math.abs(interval / meanIntervalPs - 1)))
    const fingerprint = fingerprintTrajectory(trajectory)
    return {
      id,
      declaredIndependentRunId,
      trajectory,
      fingerprint,
      startFrameIndex,
      endFrameIndex,
      frames,
      summary: {
        replicaIndex,
        id,
        declaredIndependentRunId,
        trajectoryFingerprint: fingerprint,
        frameRange: {
          startFrameIndex,
          endFrameIndex,
          frameCount: frames.length,
          startStep: frames[0].step,
          endStep: frames[frames.length - 1].step,
          startTimePs: frames[0].timePs,
          endTimePs: frames[frames.length - 1].timePs,
          durationPs: frames[frames.length - 1].timePs - frames[0].timePs,
        },
        sampling: {
          meanIntervalPs,
          minimumIntervalPs: Math.min(...intervals),
          maximumIntervalPs: Math.max(...intervals),
          maximumRelativeDeviation,
          uniform: maximumRelativeDeviation <= allowedTimeDeviation + 1e-15,
        },
      },
    }
  })

  if (new Set(parsed.map((replica) => replica.id)).size !== parsed.length) {
    throw new TrajectoryReplicaDiagnosticsInputError('duplicate_replica_id', 'replica ids must be unique')
  }
  const selectedFrameCount = parsed[0].frames.length
  if (parsed.some((replica) => replica.frames.length !== selectedFrameCount)) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'replica_window_length_mismatch',
      'Every selected replica window must contain the same number of frames for split-chain comparison',
    )
  }
  const totalFrames = parsed.reduce((sum, replica) => sum + replica.frames.length, 0)
  const totalAtomFrames = parsed.reduce((sum, replica) => (
    sum + replica.frames.length * replica.trajectory.atomIds.length
  ), 0)
  if (totalFrames > maxTotalFrames || totalAtomFrames > maxTotalAtomFrames) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'replica_diagnostics_budget_exceeded',
      `Selected replicas contain ${totalFrames} frames/${totalAtomFrames} atom-frames above limits ${maxTotalFrames}/${maxTotalAtomFrames}`,
    )
  }
  const first = parsed[0].trajectory
  const firstPeriodic = effectivePeriodicFlags(first)
  for (let index = 1; index < parsed.length; index++) {
    const trajectory = parsed[index].trajectory
    if (trajectory.atomIds.length !== first.atomIds.length
      || trajectory.atomIds.some((id, atomIndex) => id !== first.atomIds[atomIndex])) {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'replica_atom_identity_mismatch',
        `replicas[${index}] atom IDs/order do not match replicas[0]`,
      )
    }
    if (trajectory.coordinateMode !== first.coordinateMode) {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'replica_coordinate_mode_mismatch',
        `replicas[${index}] coordinate mode does not match replicas[0]`,
      )
    }
    const periodic = effectivePeriodicFlags(trajectory)
    if ((periodic === null) !== (firstPeriodic === null)
      || periodic?.some((value, axis) => value !== firstPeriodic![axis])) {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'replica_periodicity_mismatch',
        `replicas[${index}] periodic flags do not match replicas[0]`,
      )
    }
  }

  for (const metric of metrics) {
    for (let replicaIndex = 0; replicaIndex < parsed.length; replicaIndex++) {
      const missingIndex = parsed[replicaIndex].frames.findIndex((frame) => frame.scalars?.[metric.scalarKey] === undefined)
      if (missingIndex >= 0) {
        throw new TrajectoryReplicaDiagnosticsInputError(
          'replica_scalar_missing',
          `Scalar ${JSON.stringify(metric.scalarKey)} is absent from replica ${replicaIndex} frame ${parsed[replicaIndex].startFrameIndex + missingIndex}`,
        )
      }
    }
  }

  const maximumAutocorrelationLag = boundedInteger(
    options.maximumAutocorrelationLag,
    Math.min(100, Math.floor(selectedFrameCount / 2)),
    'maximumAutocorrelationLag',
    1,
    selectedFrameCount - 1,
  )
  const meanCadence = average(parsed.map((replica) => replica.summary.sampling.meanIntervalPs))
  const cadenceMismatch = Math.max(...parsed.map((replica) => (
    Math.abs(replica.summary.sampling.meanIntervalPs / meanCadence - 1)
  )))
  const meanDuration = average(parsed.map((replica) => replica.summary.frameRange.durationPs))
  const durationMismatch = Math.max(...parsed.map((replica) => (
    Math.abs(replica.summary.frameRange.durationPs / meanDuration - 1)
  )))
  const samplingComparable = parsed.every((replica) => replica.summary.sampling.uniform)
    && cadenceMismatch <= allowedTimeDeviation + 1e-15
    && durationMismatch <= allowedTimeDeviation + 1e-15

  const fingerprints = parsed.map((replica) => replica.fingerprint)
  const duplicateFingerprintCount = fingerprints.length - new Set(fingerprints).size
  const runIds = parsed.map((replica) => replica.declaredIndependentRunId)
  const duplicateRunIdCount = runIds.length - new Set(runIds).size
  const independenceMetadataValues = independenceMetadataKey
    ? parsed.map((replica) => replica.trajectory.metadata?.[independenceMetadataKey])
    : []
  const missingIndependenceMetadataCount = independenceMetadataValues.filter((value) => value === undefined).length
  const presentIndependenceMetadataIdentities = independenceMetadataValues.flatMap((value) => (
    value === undefined ? [] : [canonicalJsonIdentity(value)]
  ))
  const duplicateIndependenceMetadataCount = presentIndependenceMetadataIdentities.length
    - new Set(presentIndependenceMetadataIdentities).size
  const metadataMismatches: Array<{ key: string; missingReplicaIndices: number[]; differingReplicaIndices: number[] }> = []
  for (const key of requiredMatchingMetadataKeys) {
    const values = parsed.map((replica) => replica.trajectory.metadata?.[key])
    const missingReplicaIndices = values.flatMap((value, index) => value === undefined ? [index] : [])
    const reference = values[0] === undefined ? null : canonicalJsonIdentity(values[0])
    const differingReplicaIndices = values.flatMap((value, index) => (
      value !== undefined && reference !== null && canonicalJsonIdentity(value) !== reference ? [index] : []
    ))
    if (missingReplicaIndices.length || differingReplicaIndices.length) {
      metadataMismatches.push({ key, missingReplicaIndices, differingReplicaIndices })
    }
  }

  const metricResults: TrajectoryReplicaMetricDiagnostics[] = metrics.map((metric) => {
    const chains = parsed.map((replica) => replica.frames.map((frame) => frame.scalars![metric.scalarKey]))
    const perReplica = chains.map((values, replicaIndex) => {
      const mean = average(values)
      const standardDeviation = Math.sqrt(sampleVariance(values, mean))
      const minimum = Math.min(...values)
      const maximum = Math.max(...values)
      const effective = effectiveSampleSize(values, maximumAutocorrelationLag)
      return {
        replicaIndex,
        replicaId: parsed[replicaIndex].id,
        mean,
        standardDeviation,
        minimum,
        minimumFrameIndex: parsed[replicaIndex].startFrameIndex + values.indexOf(minimum),
        maximum,
        maximumFrameIndex: parsed[replicaIndex].startFrameIndex + values.indexOf(maximum),
        effectiveSampleSize: effective.effectiveSampleSize,
        integratedAutocorrelationTimeFrames: effective.integratedAutocorrelationTimeFrames,
      }
    })
    const pooledWithinVariance = average(perReplica.map((item) => item.standardDeviation ** 2))
    const pooledWithinReplicaStandardDeviation = Math.sqrt(pooledWithinVariance)
    let maximumReplicaMeanDifference = -1
    let maximumPairwiseMeanZ: number | null = 0
    let worstMeanPair: [number, number] = [0, 1]
    for (let left = 0; left < perReplica.length; left++) {
      for (let right = left + 1; right < perReplica.length; right++) {
        const difference = Math.abs(perReplica[left].mean - perReplica[right].mean)
        if (difference > maximumReplicaMeanDifference) {
          maximumReplicaMeanDifference = difference
          worstMeanPair = [left, right]
        }
        const standardError = Math.sqrt(
          perReplica[left].standardDeviation ** 2 / perReplica[left].effectiveSampleSize
          + perReplica[right].standardDeviation ** 2 / perReplica[right].effectiveSampleSize,
        )
        const scale = Math.max(
          Math.abs(perReplica[left].mean),
          Math.abs(perReplica[right].mean),
          perReplica[left].standardDeviation,
          perReplica[right].standardDeviation,
          1,
        )
        const pairZ = standardError > scale * 1e-12
          ? difference / standardError
          : difference <= scale * 1e-12 ? 0 : null
        if (pairZ === null) maximumPairwiseMeanZ = null
        else if (maximumPairwiseMeanZ !== null) maximumPairwiseMeanZ = Math.max(maximumPairwiseMeanZ, pairZ)
      }
    }
    const meanScale = Math.max(...perReplica.map((item) => Math.abs(item.mean)), 1)
    const maximumReplicaMeanSpreadSigma = pooledWithinReplicaStandardDeviation > meanScale * 1e-12
      ? maximumReplicaMeanDifference / pooledWithinReplicaStandardDeviation
      : maximumReplicaMeanDifference <= meanScale * 1e-12 ? 0 : null
    const rhats = rankNormalizedSplitRhats(chains)
    const combinedEffectiveSamples = perReplica.reduce((sum, item) => sum + item.effectiveSampleSize, 0)
    return {
      scalarKey: metric.scalarKey,
      perReplica,
      pooledWithinReplicaStandardDeviation,
      maximumReplicaMeanDifference,
      maximumReplicaMeanSpreadSigma,
      maximumPairwiseMeanZ,
      worstMeanPair,
      rankNormalizedSplitRhat: rhats.rankNormalized,
      foldedRankNormalizedSplitRhat: rhats.folded,
      splitRhat: rhats.maximum,
      combinedEffectiveSamples,
      thresholds: {
        maximumSplitRhat: metric.maximumSplitRhat,
        maximumReplicaMeanSpreadSigma: metric.maximumReplicaMeanSpreadSigma,
        maximumPairwiseMeanZ: metric.maximumPairwiseMeanZ,
        minimumCombinedEffectiveSamples: metric.minimumCombinedEffectiveSamples,
      },
      gates: {
        splitRhat: rhats.maximum !== null && rhats.maximum <= metric.maximumSplitRhat + 1e-12,
        replicaMeanSpread: maximumReplicaMeanSpreadSigma !== null
          && maximumReplicaMeanSpreadSigma <= metric.maximumReplicaMeanSpreadSigma + 1e-12,
        pairwiseMeanZ: samplingComparable
          ? maximumPairwiseMeanZ !== null && maximumPairwiseMeanZ <= metric.maximumPairwiseMeanZ + 1e-12
          : null,
        combinedEffectiveSamples: samplingComparable
          ? combinedEffectiveSamples + 1e-12 >= metric.minimumCombinedEffectiveSamples
          : null,
      },
    }
  })

  const checks: ValidationCheck[] = [
    {
      id: 'replica_diagnostics.contract',
      status: 'pass',
      message: `Parsed ${parsed.length} canonical replicas with ${totalFrames} selected frames/${totalAtomFrames} atom-frames`,
      metrics: { replicaCount: parsed.length, selectedFrameCountPerReplica: selectedFrameCount, totalFrames, totalAtomFrames },
    },
    {
      id: 'replica_diagnostics.system_identity',
      status: 'pass',
      message: `Every replica uses the same ordered ${first.atomIds.length}-atom identity, ${first.coordinateMode} coordinates, and periodic flags`,
      metrics: {
        atomCount: first.atomIds.length,
        coordinateMode: first.coordinateMode,
        periodic: firstPeriodic ? firstPeriodic.map((value) => value ? '1' : '0').join('') : 'none',
      },
    },
    {
      id: 'replica_diagnostics.distinct_artifacts',
      status: duplicateFingerprintCount ? 'fail' : 'pass',
      message: duplicateFingerprintCount
        ? `${duplicateFingerprintCount} replica artifact(s) duplicate another complete trajectory fingerprint and are replay evidence, not independent evidence`
        : `All ${parsed.length} complete trajectory fingerprints are distinct`,
      metrics: { replicaCount: parsed.length, uniqueFingerprintCount: new Set(fingerprints).size, duplicateFingerprintCount },
    },
    {
      id: 'replica_diagnostics.declared_independence',
      status: duplicateRunIdCount ? 'fail' : 'pass',
      message: duplicateRunIdCount
        ? `${duplicateRunIdCount} declared independent run ID(s) are duplicated`
        : `Caller supplied ${parsed.length} distinct declared independent run IDs`,
      metrics: { replicaCount: parsed.length, uniqueDeclaredRunIdCount: new Set(runIds).size, duplicateRunIdCount },
    },
    {
      id: 'replica_diagnostics.independence_metadata',
      status: independenceMetadataKey === null
        ? 'warn'
        : missingIndependenceMetadataCount || duplicateIndependenceMetadataCount ? 'fail' : 'pass',
      message: independenceMetadataKey === null
        ? 'No provider provenance metadata key was selected to corroborate the caller-declared independent run IDs'
        : missingIndependenceMetadataCount
          ? `${missingIndependenceMetadataCount} replica(s) omit independence metadata ${independenceMetadataKey}`
          : duplicateIndependenceMetadataCount
            ? `${duplicateIndependenceMetadataCount} replica(s) duplicate another ${independenceMetadataKey} value`
            : `Every replica has a distinct ${independenceMetadataKey} provenance value`,
      metrics: {
        independenceMetadataKey: independenceMetadataKey ?? 'none',
        missingCount: missingIndependenceMetadataCount,
        duplicateCount: duplicateIndependenceMetadataCount,
        uniqueValueCount: new Set(presentIndependenceMetadataIdentities).size,
      },
    },
    {
      id: 'replica_diagnostics.condition_metadata',
      status: !requiredMatchingMetadataKeys.length ? 'warn' : metadataMismatches.length ? 'fail' : 'pass',
      message: !requiredMatchingMetadataKeys.length
        ? 'No matching metadata keys were required; atom identity alone does not establish equal thermodynamic/model conditions'
        : metadataMismatches.length
          ? `${metadataMismatches.length} required condition metadata key(s) are missing or differ across replicas`
          : `All ${requiredMatchingMetadataKeys.length} required model/ensemble metadata keys match exactly across replicas`,
      metrics: {
        requiredKeyCount: requiredMatchingMetadataKeys.length,
        mismatchCount: metadataMismatches.length,
        mismatchingKeys: metadataMismatches.map((item) => item.key).join(','),
      },
    },
    {
      id: 'replica_diagnostics.window_alignment',
      status: 'pass',
      message: `Every explicit comparison window contains ${selectedFrameCount} frames; split chains use ${Math.floor(selectedFrameCount / 2)} frames per half`,
      metrics: { frameCountPerReplica: selectedFrameCount, splitChainLength: Math.floor(selectedFrameCount / 2) },
    },
    {
      id: 'replica_diagnostics.uniform_sampling',
      status: samplingComparable ? 'pass' : 'fail',
      message: samplingComparable
        ? `Every replica is uniformly sampled and cross-replica cadence/duration agree within ${allowedTimeDeviation}`
        : 'One or more replica windows have nonuniform sampling or mismatched physical cadence/duration; correlation-adjusted gates are invalid',
      metrics: {
        maximumWithinReplicaRelativeDeviation: Math.max(...parsed.map((replica) => replica.summary.sampling.maximumRelativeDeviation)),
        maximumCrossReplicaCadenceDeviation: cadenceMismatch,
        maximumCrossReplicaDurationDeviation: durationMismatch,
        allowedMaximumRelativeDeviation: allowedTimeDeviation,
      },
    },
    {
      id: 'replica_diagnostics.scalar_coverage',
      status: 'pass',
      message: `Every selected frame contains all ${metrics.length} requested finite scalar series`,
      metrics: { scalarCount: metrics.length, replicaCount: parsed.length, frameCountPerReplica: selectedFrameCount },
    },
  ]

  for (let index = 0; index < metricResults.length; index++) {
    const metric = metricResults[index]
    const prefix = `replica_diagnostics.metric_${index + 1}`
    checks.push(
      {
        id: `${prefix}.split_rhat`,
        status: metric.gates.splitRhat ? 'pass' : 'fail',
        message: metric.splitRhat === null
          ? `${metric.scalarKey} rank-normalized/folded split-R-hat is unbounded because within-replica variation is degenerate while replicas differ`
          : `${metric.scalarKey} maximum rank-normalized/folded split-R-hat is ${metric.splitRhat.toFixed(6)} against ${metric.thresholds.maximumSplitRhat.toFixed(6)}`,
        metrics: {
          rankNormalizedSplitRhat: metric.rankNormalizedSplitRhat,
          foldedRankNormalizedSplitRhat: metric.foldedRankNormalizedSplitRhat,
          splitRhat: metric.splitRhat,
          maximumSplitRhat: metric.thresholds.maximumSplitRhat,
        },
      },
      {
        id: `${prefix}.replica_mean_spread`,
        status: metric.gates.replicaMeanSpread ? 'pass' : 'fail',
        message: metric.maximumReplicaMeanSpreadSigma === null
          ? `${metric.scalarKey} replica means differ while pooled within-replica variance is numerically zero`
          : `${metric.scalarKey} maximum replica-mean spread is ${metric.maximumReplicaMeanSpreadSigma.toFixed(6)} within-replica σ against ${metric.thresholds.maximumReplicaMeanSpreadSigma.toFixed(6)}`,
        metrics: {
          maximumReplicaMeanDifference: metric.maximumReplicaMeanDifference,
          pooledWithinReplicaStandardDeviation: metric.pooledWithinReplicaStandardDeviation,
          maximumReplicaMeanSpreadSigma: metric.maximumReplicaMeanSpreadSigma,
          allowedMaximumReplicaMeanSpreadSigma: metric.thresholds.maximumReplicaMeanSpreadSigma,
          worstReplicaPair: metric.worstMeanPair.join(','),
        },
      },
      {
        id: `${prefix}.pairwise_mean_error`,
        status: metric.gates.pairwiseMeanZ === null ? 'skipped' : metric.gates.pairwiseMeanZ ? 'pass' : 'fail',
        message: metric.gates.pairwiseMeanZ === null
          ? `${metric.scalarKey} correlation-adjusted pairwise mean gate is unresolved because sampling cadence is not comparable`
          : metric.maximumPairwiseMeanZ === null
            ? `${metric.scalarKey} pairwise mean error is unbounded because estimated Monte Carlo standard error is zero while means differ`
            : `${metric.scalarKey} maximum pairwise mean difference is ${metric.maximumPairwiseMeanZ.toFixed(6)} estimated standard errors against ${metric.thresholds.maximumPairwiseMeanZ.toFixed(6)}`,
        metrics: {
          maximumPairwiseMeanZ: metric.maximumPairwiseMeanZ,
          allowedMaximumPairwiseMeanZ: metric.thresholds.maximumPairwiseMeanZ,
        },
      },
      {
        id: `${prefix}.combined_effective_samples`,
        status: metric.gates.combinedEffectiveSamples === null
          ? 'skipped'
          : metric.gates.combinedEffectiveSamples ? 'pass' : 'fail',
        message: metric.gates.combinedEffectiveSamples === null
          ? `${metric.scalarKey} combined within-replica effective sample evidence is unresolved because sampling cadence is not comparable`
          : `${metric.scalarKey} sum of within-replica effective sample estimates is ${metric.combinedEffectiveSamples.toFixed(4)} against minimum ${metric.thresholds.minimumCombinedEffectiveSamples.toFixed(4)}`,
        metrics: {
          combinedEffectiveSamples: metric.combinedEffectiveSamples,
          minimumCombinedEffectiveSamples: metric.thresholds.minimumCombinedEffectiveSamples,
          maximumAutocorrelationLag,
        },
      },
    )
  }
  checks.push({
    id: 'replica_diagnostics.convergence_scope',
    status: 'warn',
    message: 'Passing named-observable replica gates is finite-window evidence, not proof of independent RNG streams, equilibration, ergodicity, distributional equality, adequate burn-in/observable coverage, or timestep/system-size/long-time convergence; declared run IDs and matching metadata must be backed by provider provenance',
  })

  const inspectionTargets: TrajectoryReplicaInspectionTarget[] = []
  for (let metricIndex = 0; metricIndex < metricResults.length && inspectionTargets.length < MAX_INSPECTION_TARGETS; metricIndex++) {
    const metric = metricResults[metricIndex]
    for (const replicaIndex of metric.worstMeanPair) {
      if (inspectionTargets.length >= MAX_INSPECTION_TARGETS) break
      const replica = parsed[replicaIndex]
      const values = replica.frames.map((frame) => frame.scalars![metric.scalarKey])
      const targetMean = metric.perReplica[replicaIndex].mean
      const localFrameIndex = values.reduce((best, value, index) => (
        Math.abs(value - targetMean) < Math.abs(values[best] - targetMean) ? index : best
      ), 0)
      const frameIndex = replica.startFrameIndex + localFrameIndex
      inspectionTargets.push(makeInspectionTarget(
        replica,
        frameIndex,
        `replica-${metricIndex + 1}-${replicaIndex + 1}-mean-representative`,
        `Inspect replica ${replica.id} near its ${metric.scalarKey} mean; paired with replica ${parsed[metric.worstMeanPair[0] === replicaIndex ? metric.worstMeanPair[1] : metric.worstMeanPair[0]].id} for the largest mean difference`,
      ))
    }
  }
  if (metricResults.length * 2 > MAX_INSPECTION_TARGETS) {
    checks.push({
      id: 'replica_diagnostics.target_coverage',
      status: 'warn',
      message: `Returned ${inspectionTargets.length} representative targets under the cap ${MAX_INSPECTION_TARGETS}; all metric results retain exact replica/frame indices`,
      metrics: { targetCount: inspectionTargets.length, maximumTargets: MAX_INSPECTION_TARGETS },
    })
  }

  return {
    replicas: parsed.map((replica) => replica.summary),
    metrics: metricResults,
    independenceMetadataKey,
    requiredMatchingMetadataKeys,
    checks,
    inspectionTargets,
    provenance: {
      engine: 'zatom-trajectory-replica-diagnostics',
      engineVersion: '1.0.0',
      trajectoryFingerprints: fingerprints,
      parameters: {
        replicas: parsed.map((replica) => ({
          id: replica.id,
          declaredIndependentRunId: replica.declaredIndependentRunId,
          startFrameIndex: replica.startFrameIndex,
          endFrameIndex: replica.endFrameIndex,
        })),
        metrics,
        minimumFramesPerReplica,
        maximumAutocorrelationLag,
        maximumRelativeTimeStepDeviation: allowedTimeDeviation,
        independenceMetadataKey,
        requiredMatchingMetadataKeys,
        maxTotalFrames,
        maxTotalAtomFrames,
      },
    },
  }
}
