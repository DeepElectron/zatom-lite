import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomTrajectory } from '../contracts'
import { ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  analyzeTrajectoryReplicas,
  TrajectoryReplicaDiagnosticsInputError,
  type AnalyzeTrajectoryReplicasOptions,
  type TrajectoryReplicaInput,
} from '../trajectory-replica-diagnostics'

function replicaTrajectory(replicaIndex: number, options: {
  frameCount?: number
  meanOffset?: number
  nonuniformFinalInterval?: boolean
  conditionTemperatureK?: number
  omitTemperatureFrame?: number
} = {}): ZatomTrajectory {
  const frameCount = options.frameCount ?? 128
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['replica-probe'],
    coordinateMode: 'cartesian',
    label: `synthetic replica ${replicaIndex}`,
    metadata: {
      'test.engine': 'deterministic-synthetic-v1',
      'test.temperatureK': options.conditionTemperatureK ?? 300,
      'test.runSeed': 1000 + replicaIndex,
    },
    frames: Array.from({ length: frameCount }, (_, index) => {
      const temperatureK = 300
        + (options.meanOffset ?? 0)
        + 2 * Math.sin((index + replicaIndex * 19) * 2.399963)
        + 0.5 * Math.cos((index + replicaIndex * 7) * 0.71)
      const scalars: Record<string, number> = {
        temperatureK,
        volumeA3: 1000
          + (options.meanOffset ?? 0) * 2
          + 3 * Math.cos((index + replicaIndex * 13) * 1.731)
          + 0.4 * Math.sin((index + replicaIndex * 5) * 0.43),
        constantControl: 7,
      }
      if (options.omitTemperatureFrame === index) delete scalars.temperatureK
      return {
        step: index,
        timePs: index * 0.01 + (options.nonuniformFinalInterval && index === frameCount - 1 ? 0.005 : 0),
        positions: [[index * 0.001, replicaIndex * 0.01, 0]],
        scalars,
      }
    }),
  }
}

function replicas(
  options: { offsetLast?: number; nonuniformLast?: boolean; mismatchedCondition?: boolean } = {},
): TrajectoryReplicaInput[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `replica-${index + 1}`,
    declaredIndependentRunId: `seed-${1000 + index}`,
    trajectory: replicaTrajectory(index, {
      meanOffset: index === 3 ? options.offsetLast : 0,
      nonuniformFinalInterval: index === 3 && options.nonuniformLast,
      conditionTemperatureK: index === 3 && options.mismatchedCondition ? 310 : 300,
    }),
  }))
}

const metricGates = [
  {
    scalarKey: 'temperatureK',
    maximumSplitRhat: 1.1,
    maximumReplicaMeanSpreadSigma: 0.3,
    maximumPairwiseMeanZ: 3,
    minimumCombinedEffectiveSamples: 40,
  },
  {
    scalarKey: 'volumeA3',
    maximumSplitRhat: 1.1,
    maximumReplicaMeanSpreadSigma: 0.3,
    maximumPairwiseMeanZ: 3,
    minimumCombinedEffectiveSamples: 40,
  },
  {
    scalarKey: 'constantControl',
    maximumSplitRhat: 1,
    maximumReplicaMeanSpreadSigma: 0,
    maximumPairwiseMeanZ: 0,
    minimumCombinedEffectiveSamples: 400,
  },
]

function baseOptions(): AnalyzeTrajectoryReplicasOptions {
  return {
    replicas: replicas(),
    metrics: metricGates,
    minimumFramesPerReplica: 100,
    maximumAutocorrelationLag: 40,
    independenceMetadataKey: 'test.runSeed',
    requiredMatchingMetadataKeys: ['test.engine', 'test.temperatureK'],
  }
}

function findCheck(result: ReturnType<typeof analyzeTrajectoryReplicas>, id: string) {
  return result.checks.find((check) => check.id === id)
}

function testConsistentReplicasPassNamedObservableGates() {
  const result = analyzeTrajectoryReplicas(baseOptions())
  const failures = result.checks.filter((check) => check.status === 'fail')
  assertTrue(failures.length === 0, JSON.stringify(failures))
  assertEqual(result.replicas.length, 4)
  assertEqual(result.metrics.length, 3)
  assertEqual(result.metrics[2].splitRhat, 1)
  assertEqual(result.metrics[2].maximumReplicaMeanSpreadSigma, 0)
  assertEqual(result.metrics[2].maximumPairwiseMeanZ, 0)
  assertEqual(result.metrics[2].combinedEffectiveSamples, 512)
  assertEqual(findCheck(result, 'replica_diagnostics.condition_metadata')?.status, 'pass')
  assertEqual(findCheck(result, 'replica_diagnostics.independence_metadata')?.status, 'pass')
  assertEqual(findCheck(result, 'replica_diagnostics.convergence_scope')?.status, 'warn')
  assertTrue(result.inspectionTargets.length >= 2)
  assertTrue(result.inspectionTargets.every((target) => (
    target.replicaIndex >= 0 && target.trajectoryFrameIndex !== undefined && !!target.trajectoryFingerprint
  )))
}

function testOffsetReplicaFailsDistributionAndMeanGates() {
  const result = analyzeTrajectoryReplicas({
    ...baseOptions(),
    replicas: replicas({ offsetLast: 15 }),
  })
  assertEqual(findCheck(result, 'replica_diagnostics.metric_1.split_rhat')?.status, 'fail')
  assertEqual(findCheck(result, 'replica_diagnostics.metric_1.replica_mean_spread')?.status, 'fail')
  assertEqual(findCheck(result, 'replica_diagnostics.metric_1.pairwise_mean_error')?.status, 'fail')
  assertTrue(result.metrics[0].worstMeanPair.includes(3))
}

function testReplayConditionAndDeclaredIdentityFailuresRemainExplicit() {
  const source = replicaTrajectory(0)
  const replayResult = analyzeTrajectoryReplicas({
    ...baseOptions(),
    replicas: [
      { id: 'original', declaredIndependentRunId: 'seed-a', trajectory: source },
      { id: 'replay', declaredIndependentRunId: 'seed-b', trajectory: source },
    ],
  })
  assertEqual(findCheck(replayResult, 'replica_diagnostics.distinct_artifacts')?.status, 'fail')
  assertEqual(findCheck(replayResult, 'replica_diagnostics.independence_metadata')?.status, 'fail')

  const duplicateRunIds = replicas().map((replica, index) => ({
    ...replica,
    declaredIndependentRunId: index < 2 ? 'same-seed' : replica.declaredIndependentRunId,
  }))
  const identityResult = analyzeTrajectoryReplicas({ ...baseOptions(), replicas: duplicateRunIds })
  assertEqual(findCheck(identityResult, 'replica_diagnostics.declared_independence')?.status, 'fail')

  const conditionResult = analyzeTrajectoryReplicas({
    ...baseOptions(),
    replicas: replicas({ mismatchedCondition: true }),
  })
  assertEqual(findCheck(conditionResult, 'replica_diagnostics.condition_metadata')?.status, 'fail')

  const unscopedConditions = analyzeTrajectoryReplicas({
    ...baseOptions(),
    requiredMatchingMetadataKeys: [],
  })
  assertEqual(findCheck(unscopedConditions, 'replica_diagnostics.condition_metadata')?.status, 'warn')

  const uncorroboratedIndependence = analyzeTrajectoryReplicas({
    ...baseOptions(),
    independenceMetadataKey: undefined,
  })
  assertEqual(findCheck(uncorroboratedIndependence, 'replica_diagnostics.independence_metadata')?.status, 'warn')
}

function testNonuniformSamplingFailsAndSkipsCorrelationAdjustedGates() {
  const result = analyzeTrajectoryReplicas({
    ...baseOptions(),
    replicas: replicas({ nonuniformLast: true }),
  })
  assertEqual(findCheck(result, 'replica_diagnostics.uniform_sampling')?.status, 'fail')
  assertEqual(findCheck(result, 'replica_diagnostics.metric_1.pairwise_mean_error')?.status, 'skipped')
  assertEqual(findCheck(result, 'replica_diagnostics.metric_1.combined_effective_samples')?.status, 'skipped')
  assertEqual(result.metrics[0].gates.pairwiseMeanZ, null)
}

function expectInputError(
  options: AnalyzeTrajectoryReplicasOptions,
  code: string,
) {
  let caught: unknown
  try {
    analyzeTrajectoryReplicas(options)
  } catch (error) {
    caught = error
  }
  assertTrue(caught instanceof TrajectoryReplicaDiagnosticsInputError)
  assertEqual((caught as TrajectoryReplicaDiagnosticsInputError).code, code)
}

function testUnconstructableComparisonsFailClosed() {
  const identityMismatch = replicas()
  identityMismatch[1] = {
    ...identityMismatch[1],
    trajectory: { ...identityMismatch[1].trajectory, atomIds: ['different-probe'] },
  }
  expectInputError({ ...baseOptions(), replicas: identityMismatch }, 'replica_atom_identity_mismatch')

  const unequalWindows = replicas()
  unequalWindows[1] = { ...unequalWindows[1], startFrameIndex: 1 }
  expectInputError({ ...baseOptions(), replicas: unequalWindows }, 'replica_window_length_mismatch')

  const missingScalar = replicas()
  missingScalar[2] = {
    ...missingScalar[2],
    trajectory: replicaTrajectory(2, { omitTemperatureFrame: 50 }),
  }
  expectInputError({ ...baseOptions(), replicas: missingScalar }, 'replica_scalar_missing')

  expectInputError({ ...baseOptions(), maxTotalFrames: 100 }, 'replica_diagnostics_budget_exceeded')
  expectInputError({
    ...baseOptions(),
    requiredMatchingMetadataKeys: ['test.runSeed'],
  }, 'conflicting_replica_metadata_key')
}

async function testMcpReturnsReplicaAwareVisualTargets() {
  const options = baseOptions()
  const response = await callZatomMcpTool('trajectory_analyze_replicas', {
    replicas: options.replicas,
    metrics: options.metrics,
    minimumFramesPerReplica: options.minimumFramesPerReplica,
    maximumAutocorrelationLag: options.maximumAutocorrelationLag,
    independenceMetadataKey: options.independenceMetadataKey,
    requiredMatchingMetadataKeys: options.requiredMatchingMetadataKeys,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const result = response.structuredContent.data as ReturnType<typeof analyzeTrajectoryReplicas>
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  assertTrue(result.inspectionTargets.every((target) => target.replicaId.startsWith('replica-')))
  assertTrue(response.structuredContent.summary.includes('finite-window'))

  const invalid = await callZatomMcpTool('trajectory_analyze_replicas', {
    replicas: [],
    metrics: metricGates,
  })
  assertEqual(invalid.structuredContent.ok, false)
  assertEqual(invalid.structuredContent.error?.code, 'invalid_tool_input')
}

async function main() {
  testConsistentReplicasPassNamedObservableGates()
  testOffsetReplicaFailsDistributionAndMeanGates()
  testReplayConditionAndDeclaredIdentityFailuresRemainExplicit()
  testNonuniformSamplingFailsAndSkipsCorrelationAdjustedGates()
  testUnconstructableComparisonsFailClosed()
  await testMcpReturnsReplicaAwareVisualTargets()
  console.log('agent trajectory replica diagnostics tests passed')
}

void main()
