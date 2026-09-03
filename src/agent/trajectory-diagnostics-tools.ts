/** Agent/MCP read-only tool for scalar trajectory stationarity diagnostics. */

import type {
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import {
  analyzeTrajectoryStationarity,
  TrajectoryDiagnosticsInputError,
  type TrajectoryMetricGate,
} from './trajectory-diagnostics'
import { parseZatomTrajectory } from './trajectory'
import { objectSchema, toolError } from './tool-helpers'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function numberOption(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  const result = Number(value)
  if (!Number.isFinite(result)) {
    throw new TrajectoryDiagnosticsInputError('invalid_trajectory_diagnostics_parameter', `${field} must be finite`)
  }
  return result
}

function parseMetrics(value: unknown): TrajectoryMetricGate[] {
  if (!Array.isArray(value)) {
    throw new TrajectoryDiagnosticsInputError('invalid_trajectory_metrics', 'metrics must be an array')
  }
  return value.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.scalarKey !== 'string') {
      throw new TrajectoryDiagnosticsInputError(
        'invalid_trajectory_metric',
        `metrics[${index}] must contain scalarKey`,
      )
    }
    return {
      scalarKey: raw.scalarKey,
      maximumDriftSigma: numberOption(raw.maximumDriftSigma, `metrics[${index}].maximumDriftSigma`),
      maximumHalfMeanShiftSigma: numberOption(
        raw.maximumHalfMeanShiftSigma,
        `metrics[${index}].maximumHalfMeanShiftSigma`,
      ),
      maximumBlockMeanRangeSigma: numberOption(
        raw.maximumBlockMeanRangeSigma,
        `metrics[${index}].maximumBlockMeanRangeSigma`,
      ),
      minimumEffectiveSamples: numberOption(
        raw.minimumEffectiveSamples,
        `metrics[${index}].minimumEffectiveSamples`,
      ),
    }
  })
}

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
): Promise<ZatomTrajectory> {
  if (input.trajectory !== undefined) return parseZatomTrajectory(input.trajectory)
  const trajectory = await context.readTrajectory?.()
  if (!trajectory) {
    throw new TrajectoryDiagnosticsInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(trajectory)
}

const metricSchema = objectSchema({
  scalarKey: {
    type: 'string',
    minLength: 1,
    description: 'Exact unit-bearing key present in frames[].scalars for every selected frame.',
  },
  maximumDriftSigma: {
    type: 'number',
    minimum: 0,
    default: 1,
    description: 'Maximum absolute fitted change over the analysis window divided by the series sample standard deviation.',
  },
  maximumHalfMeanShiftSigma: {
    type: 'number',
    minimum: 0,
    default: 0.5,
    description: 'Maximum absolute first-half/second-half mean difference divided by the series sample standard deviation.',
  },
  maximumBlockMeanRangeSigma: {
    type: 'number',
    minimum: 0,
    default: 1,
    description: 'Maximum range of contiguous block means divided by the series sample standard deviation.',
  },
  minimumEffectiveSamples: {
    type: 'number',
    minimum: 1,
    default: 5,
    description: 'Minimum initial-positive-sequence effective sample estimate; only gated for uniform frame spacing.',
  },
}, ['scalarKey'])

const stationarityManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_stationarity',
  title: 'Analyze scalar trajectory stationarity',
  version: '1.0.0',
  description: 'Audit an explicit canonical trajectory window for scalar completeness, uniform cadence, fitted drift, first/second-half mean shift, contiguous block-mean stability, and autocorrelation-adjusted effective sample count; returns exact extrema frame targets and a mandatory warning that finite-trace stationarity does not prove equilibration.',
  inputSchema: objectSchema({
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    metrics: { type: 'array', minItems: 1, maxItems: 32, items: metricSchema },
    startFrameIndex: {
      type: 'integer',
      minimum: 0,
      description: 'Explicit first analyzed frame after any user-justified burn-in; default 0.',
    },
    endFrameIndex: {
      type: 'integer',
      minimum: 1,
      description: 'Inclusive last analyzed frame; defaults to the trajectory end.',
    },
    minimumFrames: { type: 'integer', minimum: 8, maximum: 10_000, default: 20 },
    blockCount: {
      type: 'integer',
      minimum: 4,
      maximum: 5000,
      default: 8,
      description: 'Contiguous blocks; each selected block must contain at least two frames.',
    },
    maximumAutocorrelationLag: {
      type: 'integer',
      minimum: 1,
      maximum: 9999,
      description: 'Frame-lag ceiling for the initial-positive-sequence autocorrelation estimate.',
    },
    maximumRelativeTimeStepDeviation: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 1e-6,
      description: 'Maximum relative deviation of selected frame intervals from their mean before uniform-sampling failure.',
    },
  }, ['metrics']),
  effects: { structure: 'none', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'stationarity', 'equilibration', 'diagnostics', 'autocorrelation', 'nvt', 'npt', 'validation', 'agent'],
}

const stationarityTool: ZatomToolDefinition = {
  manifest: stationarityManifest,
  execute: async (input, context) => {
    try {
      const result = analyzeTrajectoryStationarity({
        trajectory: await resolveTrajectory(input, context),
        metrics: parseMetrics(input.metrics),
        startFrameIndex: numberOption(input.startFrameIndex, 'startFrameIndex'),
        endFrameIndex: numberOption(input.endFrameIndex, 'endFrameIndex'),
        minimumFrames: numberOption(input.minimumFrames, 'minimumFrames'),
        blockCount: numberOption(input.blockCount, 'blockCount'),
        maximumAutocorrelationLag: numberOption(input.maximumAutocorrelationLag, 'maximumAutocorrelationLag'),
        maximumRelativeTimeStepDeviation: numberOption(
          input.maximumRelativeTimeStepDeviation,
          'maximumRelativeTimeStepDeviation',
        ),
      })
      const failing = result.checks.filter((check) => check.status === 'fail')
      return {
        ok: true,
        tool: stationarityManifest.name,
        summary: `Analyzed ${result.frameRange.frameCount} frames and ${result.metrics.length} scalar series; ${failing.length} stationarity gate(s) failed. Passing gates remain finite-window evidence, not proof of equilibration.`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(stationarityManifest.name, error)
    }
  },
}

export const TRAJECTORY_DIAGNOSTICS_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [stationarityTool]
