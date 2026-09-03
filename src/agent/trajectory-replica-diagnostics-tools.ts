/** MCP read-only tool for independent-replica scalar diagnostics. */

import type {
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import {
  analyzeTrajectoryReplicas,
  TrajectoryReplicaDiagnosticsInputError,
  type AnalyzeTrajectoryReplicasResult,
  type TrajectoryReplicaInput,
  type TrajectoryReplicaMetricGate,
} from './trajectory-replica-diagnostics'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function numberOption(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_diagnostics_parameter',
      `${field} must be finite`,
    )
  }
  return value
}

function stringOption(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new TrajectoryReplicaDiagnosticsInputError('invalid_replica_identity', `${field} must be a string`)
  }
  return value
}

function parseReplicas(value: unknown): TrajectoryReplicaInput[] {
  if (!Array.isArray(value)) {
    throw new TrajectoryReplicaDiagnosticsInputError('invalid_trajectory_replicas', 'replicas must be an array')
  }
  return value.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.id !== 'string'
      || typeof raw.declaredIndependentRunId !== 'string' || raw.trajectory === undefined) {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'invalid_trajectory_replica',
        `replicas[${index}] must contain id, declaredIndependentRunId, and trajectory`,
      )
    }
    return {
      id: raw.id,
      declaredIndependentRunId: raw.declaredIndependentRunId,
      trajectory: raw.trajectory as ZatomTrajectory,
      startFrameIndex: numberOption(raw.startFrameIndex, `replicas[${index}].startFrameIndex`),
      endFrameIndex: numberOption(raw.endFrameIndex, `replicas[${index}].endFrameIndex`),
    }
  })
}

function parseMetrics(value: unknown): TrajectoryReplicaMetricGate[] {
  if (!Array.isArray(value)) {
    throw new TrajectoryReplicaDiagnosticsInputError('invalid_replica_metrics', 'metrics must be an array')
  }
  return value.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.scalarKey !== 'string') {
      throw new TrajectoryReplicaDiagnosticsInputError(
        'invalid_replica_metric',
        `metrics[${index}] must contain scalarKey`,
      )
    }
    return {
      scalarKey: raw.scalarKey,
      maximumSplitRhat: numberOption(raw.maximumSplitRhat, `metrics[${index}].maximumSplitRhat`),
      maximumReplicaMeanSpreadSigma: numberOption(
        raw.maximumReplicaMeanSpreadSigma,
        `metrics[${index}].maximumReplicaMeanSpreadSigma`,
      ),
      maximumPairwiseMeanZ: numberOption(raw.maximumPairwiseMeanZ, `metrics[${index}].maximumPairwiseMeanZ`),
      minimumCombinedEffectiveSamples: numberOption(
        raw.minimumCombinedEffectiveSamples,
        `metrics[${index}].minimumCombinedEffectiveSamples`,
      ),
    }
  })
}

function parseMetadataKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
    throw new TrajectoryReplicaDiagnosticsInputError(
      'invalid_replica_metadata_keys',
      'requiredMatchingMetadataKeys must be a string array',
    )
  }
  return value as string[]
}

const replicaSchema = objectSchema({
  id: { type: 'string', minLength: 1, maxLength: 256 },
  declaredIndependentRunId: {
    type: 'string',
    minLength: 1,
    maxLength: 256,
    description: 'Caller-declared seed/run identifier. The tool checks uniqueness but cannot prove RNG independence.',
  },
  trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
  startFrameIndex: {
    type: 'integer',
    minimum: 0,
    description: 'Explicit first comparison frame after a caller-justified burn-in; defaults to 0.',
  },
  endFrameIndex: {
    type: 'integer',
    minimum: 1,
    description: 'Inclusive comparison-window end; defaults to this trajectory final frame.',
  },
}, ['id', 'declaredIndependentRunId', 'trajectory'])

const metricSchema = objectSchema({
  scalarKey: {
    type: 'string',
    minLength: 1,
    description: 'Exact unit-bearing frames[].scalars key present throughout every selected replica window.',
  },
  maximumSplitRhat: {
    type: 'number',
    minimum: 1,
    maximum: 1_000_000,
    default: 1.05,
    description: 'Maximum of rank-normalized bulk and folded split-R-hat.',
  },
  maximumReplicaMeanSpreadSigma: {
    type: 'number',
    minimum: 0,
    maximum: 1_000_000,
    default: 0.5,
    description: 'Maximum pairwise replica-mean difference divided by pooled within-replica sample SD.',
  },
  maximumPairwiseMeanZ: {
    type: 'number',
    minimum: 0,
    maximum: 1_000_000,
    default: 3,
    description: 'Maximum pairwise replica-mean difference in correlation-adjusted Monte Carlo standard errors.',
  },
  minimumCombinedEffectiveSamples: {
    type: 'number',
    minimum: 1,
    maximum: 1_000_000,
    default: 20,
    description: 'Minimum sum of per-replica initial-positive-sequence effective sample estimates.',
  },
}, ['scalarKey'])

const replicaDiagnosticsManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_replicas',
  title: 'Analyze scalar consistency across independent trajectory replicas',
  version: '1.0.0',
  description: 'Compare equal-length explicit windows from 2-16 canonical trajectory replicas using distinct artifact/run-identity checks, exact optional condition metadata, physical cadence, rank-normalized and folded split-R-hat, within-replica autocorrelation estimates, replica-mean spread, and pairwise Monte Carlo mean error. Results include replica/frame-specific visual targets and never claim that finite named-observable agreement proves equilibration or RNG independence.',
  inputSchema: objectSchema({
    replicas: { type: 'array', minItems: 2, maxItems: 16, items: replicaSchema },
    metrics: { type: 'array', minItems: 1, maxItems: 16, items: metricSchema },
    minimumFramesPerReplica: { type: 'integer', minimum: 8, maximum: 10_000, default: 20 },
    maximumAutocorrelationLag: { type: 'integer', minimum: 1, maximum: 9999 },
    maximumRelativeTimeStepDeviation: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 1e-6,
      description: 'Maximum within-replica interval and cross-replica cadence/duration deviation.',
    },
    independenceMetadataKey: {
      type: 'string',
      minLength: 1,
      maxLength: 256,
      description: 'Provider provenance metadata key that must be present and distinct across replicas, such as zatom.openmm.requestSeed.',
    },
    requiredMatchingMetadataKeys: {
      type: 'array',
      maxItems: 32,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 256 },
      description: 'Exact trajectory metadata keys that must be present and equal, such as engine, force-field, ensemble, temperature, pressure, timestep, and friction identity.',
    },
    maxTotalFrames: { type: 'integer', minimum: 16, maximum: 10_000, default: 10_000 },
    maxTotalAtomFrames: { type: 'integer', minimum: 16, maximum: 10_000_000, default: 10_000_000 },
  }, ['replicas', 'metrics']),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['trajectory', 'replica', 'convergence', 'rhat', 'autocorrelation', 'nvt', 'npt', 'diagnostics', 'validation', 'agent'],
}

const replicaDiagnosticsTool: ZatomToolDefinition<AnalyzeTrajectoryReplicasResult> = {
  manifest: replicaDiagnosticsManifest,
  execute: async (input) => {
    try {
      const result = analyzeTrajectoryReplicas({
        replicas: parseReplicas(input.replicas),
        metrics: parseMetrics(input.metrics),
        minimumFramesPerReplica: numberOption(input.minimumFramesPerReplica, 'minimumFramesPerReplica'),
        maximumAutocorrelationLag: numberOption(input.maximumAutocorrelationLag, 'maximumAutocorrelationLag'),
        maximumRelativeTimeStepDeviation: numberOption(
          input.maximumRelativeTimeStepDeviation,
          'maximumRelativeTimeStepDeviation',
        ),
        independenceMetadataKey: stringOption(input.independenceMetadataKey, 'independenceMetadataKey'),
        requiredMatchingMetadataKeys: parseMetadataKeys(input.requiredMatchingMetadataKeys),
        maxTotalFrames: numberOption(input.maxTotalFrames, 'maxTotalFrames'),
        maxTotalAtomFrames: numberOption(input.maxTotalAtomFrames, 'maxTotalAtomFrames'),
      })
      const failures = result.checks.filter((check) => check.status === 'fail').length
      return {
        ok: true,
        tool: replicaDiagnosticsManifest.name,
        summary: `Compared ${result.replicas.length} declared replicas across ${result.metrics.length} scalar observables; ${failures} gate(s) failed. Passing gates are finite-window named-observable evidence, not proof of equilibration or independent RNG streams.`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(replicaDiagnosticsManifest.name, error)
    }
  },
}

export const TRAJECTORY_REPLICA_DIAGNOSTICS_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  replicaDiagnosticsTool,
]
