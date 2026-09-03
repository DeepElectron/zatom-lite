import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomTrajectory } from '../contracts'
import { ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  analyzeTrajectoryStationarity,
  TrajectoryDiagnosticsInputError,
} from '../trajectory-diagnostics'
import { fingerprintTrajectory } from '../trajectory'

function scalarTrajectory(options: {
  frameCount?: number
  drifting?: boolean
  nonuniformFinalInterval?: boolean
} = {}): ZatomTrajectory {
  const frameCount = options.frameCount ?? 128
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['diagnostic-probe'],
    coordinateMode: 'cartesian',
    label: options.drifting ? 'synthetic drifting trace' : 'synthetic stationary trace',
    frames: Array.from({ length: frameCount }, (_, index) => ({
      step: index,
      timePs: index * 0.01 + (options.nonuniformFinalInterval && index === frameCount - 1 ? 0.005 : 0),
      positions: [[index * 0.001, 0, 0]],
      scalars: {
        temperatureK: options.drifting
          ? 300 + index * 0.5 + Math.sin(index * 1.7)
          : 300 + 2 * Math.sin(index * 2.399963) + 0.5 * Math.cos(index * 0.71),
        volumeA3: options.drifting
          ? 1000 + index * 2 + Math.cos(index * 1.3)
          : 1000 + 3 * Math.cos(index * 1.731) + 0.4 * Math.sin(index * 0.43),
        constantControl: 7,
      },
    })),
  }
}

const metricGates = [
  {
    scalarKey: 'temperatureK',
    maximumDriftSigma: 0.5,
    maximumHalfMeanShiftSigma: 0.3,
    maximumBlockMeanRangeSigma: 0.8,
    minimumEffectiveSamples: 10,
  },
  {
    scalarKey: 'volumeA3',
    maximumDriftSigma: 0.5,
    maximumHalfMeanShiftSigma: 0.3,
    maximumBlockMeanRangeSigma: 0.8,
    minimumEffectiveSamples: 10,
  },
  {
    scalarKey: 'constantControl',
    maximumDriftSigma: 0,
    maximumHalfMeanShiftSigma: 0,
    maximumBlockMeanRangeSigma: 0,
    minimumEffectiveSamples: 100,
  },
]

function testStableSeriesPassesDescriptiveGates() {
  const trajectory = scalarTrajectory()
  const result = analyzeTrajectoryStationarity({
    trajectory,
    metrics: metricGates,
    minimumFrames: 100,
    blockCount: 8,
    maximumAutocorrelationLag: 40,
  })
  assertEqual(result.trajectoryFingerprint, fingerprintTrajectory(trajectory))
  assertEqual(result.frameRange.frameCount, 128)
  assertEqual(result.metrics.length, 3)
  assertEqual(result.sampling.uniform, true)
  assertTrue(result.checks.every((check) => check.status !== 'fail'))
  assertEqual(result.metrics[2].standardDeviation, 0)
  assertEqual(result.metrics[2].effectiveSampleSize, 128)
  assertTrue(result.inspectionTargets.length >= 3)
  assertTrue(result.inspectionTargets.every((target) => target.trajectoryFrameIndex !== undefined))
  assertTrue(result.checks.some((check) => check.id === 'trajectory_diagnostics.stationarity_scope' && check.status === 'warn'))
}

function testDriftingSeriesFailsMultipleStationarityGates() {
  const result = analyzeTrajectoryStationarity({
    trajectory: scalarTrajectory({ drifting: true }),
    metrics: metricGates.slice(0, 2),
    minimumFrames: 100,
    blockCount: 8,
    maximumAutocorrelationLag: 40,
  })
  assertTrue(result.checks.filter((check) => check.status === 'fail').length >= 4)
  assertTrue(result.metrics.every((metric) => !metric.gates.drift))
  assertTrue(result.metrics.every((metric) => !metric.gates.halfMeanShift))
  assertTrue(result.metrics.every((metric) => !metric.gates.blockMeanRange))
}

function testNonuniformCadenceFailsAndSkipsEffectiveSampleGate() {
  const result = analyzeTrajectoryStationarity({
    trajectory: scalarTrajectory({ nonuniformFinalInterval: true }),
    metrics: metricGates.slice(0, 1),
    minimumFrames: 100,
    blockCount: 8,
  })
  assertEqual(result.sampling.uniform, false)
  assertTrue(result.checks.some((check) => check.id === 'trajectory_diagnostics.uniform_sampling' && check.status === 'fail'))
  assertTrue(result.checks.some((check) => check.id.endsWith('.effective_samples') && check.status === 'skipped'))
  assertEqual(result.metrics[0].gates.effectiveSamples, null)
}

function testMissingScalarAndShortWindowAreRejected() {
  let missingScalar = false
  try {
    analyzeTrajectoryStationarity({
      trajectory: scalarTrajectory(),
      metrics: [{ scalarKey: 'missingScalar' }],
    })
  } catch (error) {
    missingScalar = error instanceof TrajectoryDiagnosticsInputError && error.code === 'trajectory_scalar_missing'
  }
  assertTrue(missingScalar)

  let tooShort = false
  try {
    analyzeTrajectoryStationarity({
      trajectory: scalarTrajectory({ frameCount: 16 }),
      metrics: [{ scalarKey: 'temperatureK' }],
      minimumFrames: 20,
    })
  } catch (error) {
    tooShort = error instanceof TrajectoryDiagnosticsInputError && error.code === 'insufficient_trajectory_frames'
  }
  assertTrue(tooShort)
}

async function testMcpReadsActiveTrajectoryAndReturnsFrameTargets() {
  const trajectory = scalarTrajectory()
  const response = await callZatomMcpTool('trajectory_analyze_stationarity', {
    metrics: metricGates.slice(0, 2),
    minimumFrames: 100,
    blockCount: 8,
    maximumAutocorrelationLag: 40,
  }, {
    readTrajectory: () => trajectory,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as ReturnType<typeof analyzeTrajectoryStationarity>
  assertEqual(data.trajectoryFingerprint, fingerprintTrajectory(trajectory))
  assertTrue(data.checks.every((check) => check.status !== 'fail'))
  assertTrue(data.inspectionTargets.some((target) => target.trajectoryFrameIndex === data.metrics[0].maximumFrameIndex))

  const missing = await callZatomMcpTool('trajectory_analyze_stationarity', {
    metrics: [{ scalarKey: 'temperatureK' }],
  })
  assertEqual(missing.structuredContent.ok, false)
  assertEqual(missing.structuredContent.error?.code, 'no_active_trajectory')
}

async function main() {
  testStableSeriesPassesDescriptiveGates()
  testDriftingSeriesFailsMultipleStationarityGates()
  testNonuniformCadenceFailsAndSkipsEffectiveSampleGate()
  testMissingScalarAndShortWindowAreRejected()
  await testMcpReadsActiveTrajectoryAndReturnsFrameTargets()
  console.log('agent trajectory diagnostics tests passed')
}

void main()
