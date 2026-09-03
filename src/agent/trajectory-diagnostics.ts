/** Descriptive stationarity diagnostics for canonical scalar trajectory evidence. */

import type {
  InspectionTarget,
  ValidationCheck,
  ZatomTrajectory,
} from './contracts'
import { boundsOfPositions } from './structure-math'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

const MAX_METRICS = 32
const MAX_METRIC_TARGETS = 16
const MAX_ANALYSIS_FRAMES = 10_000
const MAX_ANALYSIS_ATOM_FRAMES = 10_000_000

export class TrajectoryDiagnosticsInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TrajectoryDiagnosticsInputError'
    this.code = code
  }
}

export interface TrajectoryMetricGate {
  scalarKey: string
  /** Absolute fitted change over the analysis window divided by sample standard deviation. */
  maximumDriftSigma?: number
  /** Absolute second-half minus first-half mean divided by sample standard deviation. */
  maximumHalfMeanShiftSigma?: number
  /** Range of contiguous block means divided by sample standard deviation. */
  maximumBlockMeanRangeSigma?: number
  /** Initial-positive-sequence estimate; descriptive and valid only for uniform sampling. */
  minimumEffectiveSamples?: number
}

export interface AnalyzeTrajectoryStationarityOptions {
  trajectory: ZatomTrajectory
  metrics: TrajectoryMetricGate[]
  startFrameIndex?: number
  endFrameIndex?: number
  minimumFrames?: number
  blockCount?: number
  maximumAutocorrelationLag?: number
  maximumRelativeTimeStepDeviation?: number
}

export interface TrajectoryMetricDiagnostics {
  scalarKey: string
  frameCount: number
  mean: number
  standardDeviation: number
  minimum: number
  minimumFrameIndex: number
  maximum: number
  maximumFrameIndex: number
  slopePerPs: number
  fittedDriftAcrossWindow: number
  driftSigma: number
  firstHalfMean: number
  secondHalfMean: number
  halfMeanShift: number
  halfMeanShiftSigma: number
  blockMeans: number[]
  blockMeanRange: number
  blockMeanRangeSigma: number
  integratedAutocorrelationTimeFrames: number
  effectiveSampleSize: number
  autocorrelationLagLimit: number
  thresholds: {
    maximumDriftSigma: number
    maximumHalfMeanShiftSigma: number
    maximumBlockMeanRangeSigma: number
    minimumEffectiveSamples: number
  }
  gates: {
    drift: boolean
    halfMeanShift: boolean
    blockMeanRange: boolean
    effectiveSamples: boolean | null
  }
}

export interface AnalyzeTrajectoryStationarityResult {
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
    allowedMaximumRelativeDeviation: number
    uniform: boolean
  }
  blockCount: number
  metrics: TrajectoryMetricDiagnostics[]
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  provenance: {
    engine: 'zatom-trajectory-stationarity'
    engineVersion: '1.0.0'
    trajectoryFingerprint: string
    parameters: Record<string, unknown>
  }
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
    throw new TrajectoryDiagnosticsInputError(
      'invalid_trajectory_diagnostics_parameter',
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
    throw new TrajectoryDiagnosticsInputError(
      'invalid_trajectory_diagnostics_parameter',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return resolved
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleVariance(values: readonly number[], mean = average(values)): number {
  if (values.length < 2) return 0
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
}

function normalizationScale(values: readonly number[], mean: number, standardDeviation: number): number {
  const maximumMagnitude = Math.max(...values.map(Math.abs), Math.abs(mean), 1)
  return Math.max(standardDeviation, maximumMagnitude * 1e-12, 1e-15)
}

function linearSlope(times: readonly number[], values: readonly number[]): number {
  const meanTime = average(times)
  const meanValue = average(values)
  let numerator = 0
  let denominator = 0
  for (let index = 0; index < times.length; index++) {
    numerator += (times[index] - meanTime) * (values[index] - meanValue)
    denominator += (times[index] - meanTime) ** 2
  }
  return denominator > 0 ? numerator / denominator : 0
}

function blockMeans(values: readonly number[], count: number): number[] {
  return Array.from({ length: count }, (_, blockIndex) => {
    const start = Math.floor(blockIndex * values.length / count)
    const end = Math.floor((blockIndex + 1) * values.length / count)
    return average(values.slice(start, end))
  })
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

function metricTarget(
  trajectory: ZatomTrajectory,
  frameIndex: number,
  id: string,
  reason: string,
): InspectionTarget {
  const frame = trajectory.frames[frameIndex]
  const bounds = boundsOfPositions(frame.positions)!
  return {
    id,
    reason,
    center: bounds.center,
    radius: Math.max(1.5, bounds.radius + 0.5),
    atomIds: trajectory.atomIds.slice(0, 80),
    atomIdsTruncated: trajectory.atomIds.length > 80,
    trajectoryFrameIndex: frameIndex,
  }
}

function normalizedMetric(metric: TrajectoryMetricGate, index: number): Required<TrajectoryMetricGate> {
  if (!metric || typeof metric !== 'object' || typeof metric.scalarKey !== 'string'
    || !metric.scalarKey.trim() || metric.scalarKey.includes('\0')) {
    throw new TrajectoryDiagnosticsInputError(
      'invalid_trajectory_metric',
      `metrics[${index}].scalarKey must be a non-empty string without NUL bytes`,
    )
  }
  return {
    scalarKey: metric.scalarKey.trim(),
    maximumDriftSigma: boundedNumber(metric.maximumDriftSigma, 1, `metrics[${index}].maximumDriftSigma`, 0, 1_000_000),
    maximumHalfMeanShiftSigma: boundedNumber(
      metric.maximumHalfMeanShiftSigma,
      0.5,
      `metrics[${index}].maximumHalfMeanShiftSigma`,
      0,
      1_000_000,
    ),
    maximumBlockMeanRangeSigma: boundedNumber(
      metric.maximumBlockMeanRangeSigma,
      1,
      `metrics[${index}].maximumBlockMeanRangeSigma`,
      0,
      1_000_000,
    ),
    minimumEffectiveSamples: boundedNumber(
      metric.minimumEffectiveSamples,
      5,
      `metrics[${index}].minimumEffectiveSamples`,
      1,
      1_000_000,
    ),
  }
}

/**
 * Analyze scalar stability over one explicitly selected trajectory window.
 * These are descriptive finite-trace gates, not a proof of equilibrium.
 */
export function analyzeTrajectoryStationarity(
  options: AnalyzeTrajectoryStationarityOptions,
): AnalyzeTrajectoryStationarityResult {
  const trajectory = parseZatomTrajectory(options.trajectory, {
    maxFrames: MAX_ANALYSIS_FRAMES,
    maxAtomFrames: MAX_ANALYSIS_ATOM_FRAMES,
  })
  if (!Array.isArray(options.metrics) || !options.metrics.length || options.metrics.length > MAX_METRICS) {
    throw new TrajectoryDiagnosticsInputError('invalid_trajectory_metrics', `metrics must contain 1-${MAX_METRICS} scalar gate records`)
  }
  const requestedMetrics = options.metrics.map(normalizedMetric)
  if (new Set(requestedMetrics.map((metric) => metric.scalarKey)).size !== requestedMetrics.length) {
    throw new TrajectoryDiagnosticsInputError('duplicate_trajectory_metric', 'metrics must not repeat scalarKey values')
  }
  const minimumFrames = boundedInteger(options.minimumFrames, 20, 'minimumFrames', 8, MAX_ANALYSIS_FRAMES)
  const startFrameIndex = boundedInteger(
    options.startFrameIndex,
    0,
    'startFrameIndex',
    0,
    trajectory.frames.length - 2,
  )
  const endFrameIndex = boundedInteger(
    options.endFrameIndex,
    trajectory.frames.length - 1,
    'endFrameIndex',
    startFrameIndex + 1,
    trajectory.frames.length - 1,
  )
  const frames = trajectory.frames.slice(startFrameIndex, endFrameIndex + 1)
  if (frames.length < minimumFrames) {
    throw new TrajectoryDiagnosticsInputError(
      'insufficient_trajectory_frames',
      `Selected window contains ${frames.length} frames below required minimumFrames ${minimumFrames}`,
    )
  }
  const blockCount = boundedInteger(
    options.blockCount,
    Math.min(8, Math.floor(frames.length / 2)),
    'blockCount',
    4,
    Math.floor(frames.length / 2),
  )
  const maximumAutocorrelationLag = boundedInteger(
    options.maximumAutocorrelationLag,
    Math.min(100, Math.floor(frames.length / 2)),
    'maximumAutocorrelationLag',
    1,
    frames.length - 1,
  )
  const allowedTimeDeviation = boundedNumber(
    options.maximumRelativeTimeStepDeviation,
    1e-6,
    'maximumRelativeTimeStepDeviation',
    0,
    1,
  )
  const intervals = frames.slice(1).map((frame, index) => frame.timePs - frames[index].timePs)
  const meanIntervalPs = average(intervals)
  const minimumIntervalPs = Math.min(...intervals)
  const maximumIntervalPs = Math.max(...intervals)
  const maximumRelativeDeviation = Math.max(...intervals.map((interval) => Math.abs(interval / meanIntervalPs - 1)))
  const uniform = maximumRelativeDeviation <= allowedTimeDeviation + 1e-15

  for (const metric of requestedMetrics) {
    const missing = frames.findIndex((frame) => frame.scalars?.[metric.scalarKey] === undefined)
    if (missing >= 0) {
      throw new TrajectoryDiagnosticsInputError(
        'trajectory_scalar_missing',
        `Scalar ${JSON.stringify(metric.scalarKey)} is absent from selected frame ${startFrameIndex + missing}`,
      )
    }
  }

  const times = frames.map((frame) => frame.timePs)
  const durationPs = times[times.length - 1] - times[0]
  const metricResults: TrajectoryMetricDiagnostics[] = requestedMetrics.map((metric) => {
    const values = frames.map((frame) => frame.scalars![metric.scalarKey])
    const mean = average(values)
    const standardDeviation = Math.sqrt(sampleVariance(values, mean))
    const scale = normalizationScale(values, mean, standardDeviation)
    const slopePerPs = linearSlope(times, values)
    const fittedDriftAcrossWindow = slopePerPs * durationPs
    const driftSigma = Math.abs(fittedDriftAcrossWindow) / scale
    const split = Math.floor(values.length / 2)
    const firstHalfMean = average(values.slice(0, split))
    const secondHalfMean = average(values.slice(split))
    const halfMeanShift = secondHalfMean - firstHalfMean
    const halfMeanShiftSigma = Math.abs(halfMeanShift) / scale
    const blocks = blockMeans(values, blockCount)
    const blockMeanRange = Math.max(...blocks) - Math.min(...blocks)
    const blockMeanRangeSigma = blockMeanRange / scale
    const autocorrelation = effectiveSampleSize(values, maximumAutocorrelationLag)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    return {
      scalarKey: metric.scalarKey,
      frameCount: values.length,
      mean,
      standardDeviation,
      minimum,
      minimumFrameIndex: startFrameIndex + values.indexOf(minimum),
      maximum,
      maximumFrameIndex: startFrameIndex + values.indexOf(maximum),
      slopePerPs,
      fittedDriftAcrossWindow,
      driftSigma,
      firstHalfMean,
      secondHalfMean,
      halfMeanShift,
      halfMeanShiftSigma,
      blockMeans: blocks,
      blockMeanRange,
      blockMeanRangeSigma,
      integratedAutocorrelationTimeFrames: autocorrelation.integratedAutocorrelationTimeFrames,
      effectiveSampleSize: autocorrelation.effectiveSampleSize,
      autocorrelationLagLimit: maximumAutocorrelationLag,
      thresholds: {
        maximumDriftSigma: metric.maximumDriftSigma,
        maximumHalfMeanShiftSigma: metric.maximumHalfMeanShiftSigma,
        maximumBlockMeanRangeSigma: metric.maximumBlockMeanRangeSigma,
        minimumEffectiveSamples: metric.minimumEffectiveSamples,
      },
      gates: {
        drift: driftSigma <= metric.maximumDriftSigma + 1e-12,
        halfMeanShift: halfMeanShiftSigma <= metric.maximumHalfMeanShiftSigma + 1e-12,
        blockMeanRange: blockMeanRangeSigma <= metric.maximumBlockMeanRangeSigma + 1e-12,
        effectiveSamples: uniform
          ? autocorrelation.effectiveSampleSize + 1e-12 >= metric.minimumEffectiveSamples
          : null,
      },
    }
  })

  const checks: ValidationCheck[] = [
    {
      id: 'trajectory_diagnostics.contract',
      status: 'pass',
      message: `Validated canonical trajectory ${fingerprintTrajectory(trajectory)} with ${trajectory.frames.length} frames and ${trajectory.atomIds.length} stable atom IDs`,
      metrics: { frameCount: trajectory.frames.length, atomCount: trajectory.atomIds.length },
    },
    {
      id: 'trajectory_diagnostics.window',
      status: 'pass',
      message: `Analyzed explicit frame window ${startFrameIndex}-${endFrameIndex} (${frames.length} frames, ${durationPs.toExponential(4)} ps)`,
      metrics: { startFrameIndex, endFrameIndex, frameCount: frames.length, durationPs, minimumFrames, blockCount },
    },
    {
      id: 'trajectory_diagnostics.uniform_sampling',
      status: uniform ? 'pass' : 'fail',
      message: uniform
        ? `Frame intervals are uniform within relative deviation ${maximumRelativeDeviation.toExponential(4)}`
        : `Frame intervals vary by relative deviation ${maximumRelativeDeviation.toExponential(4)} above ${allowedTimeDeviation.toExponential(4)}; frame-lag autocorrelation/effective-sample analysis is invalid`,
      metrics: {
        meanIntervalPs,
        minimumIntervalPs,
        maximumIntervalPs,
        maximumRelativeDeviation,
        allowedMaximumRelativeDeviation: allowedTimeDeviation,
      },
    },
    {
      id: 'trajectory_diagnostics.scalar_coverage',
      status: 'pass',
      message: `Every selected frame contains all ${requestedMetrics.length} requested finite scalar series`,
      metrics: { scalarCount: requestedMetrics.length, frameCount: frames.length },
    },
  ]
  for (let index = 0; index < metricResults.length; index++) {
    const result = metricResults[index]
    const prefix = `trajectory_diagnostics.metric_${index + 1}`
    checks.push(
      {
        id: `${prefix}.drift`,
        status: result.gates.drift ? 'pass' : 'fail',
        message: `${result.scalarKey} fitted window drift is ${result.driftSigma.toExponential(4)} σ against maximum ${result.thresholds.maximumDriftSigma.toExponential(4)} σ`,
        metrics: {
          slopePerPs: result.slopePerPs,
          fittedDriftAcrossWindow: result.fittedDriftAcrossWindow,
          driftSigma: result.driftSigma,
          maximumDriftSigma: result.thresholds.maximumDriftSigma,
        },
      },
      {
        id: `${prefix}.half_mean_shift`,
        status: result.gates.halfMeanShift ? 'pass' : 'fail',
        message: `${result.scalarKey} half-window mean shift is ${result.halfMeanShiftSigma.toExponential(4)} σ against maximum ${result.thresholds.maximumHalfMeanShiftSigma.toExponential(4)} σ`,
        metrics: {
          firstHalfMean: result.firstHalfMean,
          secondHalfMean: result.secondHalfMean,
          halfMeanShift: result.halfMeanShift,
          halfMeanShiftSigma: result.halfMeanShiftSigma,
          maximumHalfMeanShiftSigma: result.thresholds.maximumHalfMeanShiftSigma,
        },
      },
      {
        id: `${prefix}.block_mean_range`,
        status: result.gates.blockMeanRange ? 'pass' : 'fail',
        message: `${result.scalarKey} range across ${blockCount} contiguous block means is ${result.blockMeanRangeSigma.toExponential(4)} σ against maximum ${result.thresholds.maximumBlockMeanRangeSigma.toExponential(4)} σ`,
        metrics: {
          blockCount,
          blockMeanRange: result.blockMeanRange,
          blockMeanRangeSigma: result.blockMeanRangeSigma,
          maximumBlockMeanRangeSigma: result.thresholds.maximumBlockMeanRangeSigma,
        },
      },
      {
        id: `${prefix}.effective_samples`,
        status: result.gates.effectiveSamples === null
          ? 'skipped'
          : result.gates.effectiveSamples ? 'pass' : 'fail',
        message: result.gates.effectiveSamples === null
          ? `${result.scalarKey} effective sample size is unresolved because selected frame spacing is nonuniform`
          : `${result.scalarKey} estimated effective sample size is ${result.effectiveSampleSize.toFixed(4)} against minimum ${result.thresholds.minimumEffectiveSamples.toFixed(4)}`,
        metrics: {
          effectiveSampleSize: result.effectiveSampleSize,
          minimumEffectiveSamples: result.thresholds.minimumEffectiveSamples,
          integratedAutocorrelationTimeFrames: result.integratedAutocorrelationTimeFrames,
          maximumAutocorrelationLag,
        },
      },
    )
  }
  checks.push({
    id: 'trajectory_diagnostics.stationarity_scope',
    status: 'warn',
    message: 'Passing finite-window scalar stationarity gates is necessary evidence, not proof of equilibration: burn-in/window/observable choices remain explicit, sparse cadence can hide modes, and independent replicas plus timestep/system-size/longer-time convergence may still be required',
  })

  const inspectionTargets: InspectionTarget[] = []
  for (let index = 0; index < metricResults.length && inspectionTargets.length < MAX_METRIC_TARGETS; index++) {
    const result = metricResults[index]
    inspectionTargets.push(metricTarget(
      trajectory,
      result.minimumFrameIndex,
      `trajectory-${index + 1}-minimum`,
      `Inspect the frame with minimum ${result.scalarKey} (${result.minimum.toExponential(6)})`,
    ))
    if (result.maximumFrameIndex !== result.minimumFrameIndex && inspectionTargets.length < MAX_METRIC_TARGETS) {
      inspectionTargets.push(metricTarget(
        trajectory,
        result.maximumFrameIndex,
        `trajectory-${index + 1}-maximum`,
        `Inspect the frame with maximum ${result.scalarKey} (${result.maximum.toExponential(6)})`,
      ))
    }
  }
  if (metricResults.length * 2 > MAX_METRIC_TARGETS) {
    checks.push({
      id: 'trajectory_diagnostics.target_coverage',
      status: 'warn',
      message: `Returned ${inspectionTargets.length} extrema targets under the visual-target cap ${MAX_METRIC_TARGETS}; all scalar metrics retain exact frame indices`,
      metrics: { targetCount: inspectionTargets.length, maximumTargets: MAX_METRIC_TARGETS },
    })
  }

  const trajectoryFingerprint = fingerprintTrajectory(trajectory)
  return {
    trajectoryFingerprint,
    frameRange: {
      startFrameIndex,
      endFrameIndex,
      frameCount: frames.length,
      startStep: frames[0].step,
      endStep: frames[frames.length - 1].step,
      startTimePs: frames[0].timePs,
      endTimePs: frames[frames.length - 1].timePs,
      durationPs,
    },
    sampling: {
      meanIntervalPs,
      minimumIntervalPs,
      maximumIntervalPs,
      maximumRelativeDeviation,
      allowedMaximumRelativeDeviation: allowedTimeDeviation,
      uniform,
    },
    blockCount,
    metrics: metricResults,
    checks,
    inspectionTargets,
    provenance: {
      engine: 'zatom-trajectory-stationarity',
      engineVersion: '1.0.0',
      trajectoryFingerprint,
      parameters: {
        metrics: requestedMetrics,
        startFrameIndex,
        endFrameIndex,
        minimumFrames,
        blockCount,
        maximumAutocorrelationLag,
        maximumRelativeTimeStepDeviation: allowedTimeDeviation,
      },
    },
  }
}
