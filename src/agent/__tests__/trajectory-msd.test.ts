import { assertEqual, assertTrue } from '../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'
import {
  analyzeTrajectoryMsd,
  TrajectoryMsdInputError,
} from '../trajectory-msd'
import { callZatomMcpTool } from '../mcp-adapter'
import { fingerprintStructure } from '../structure-math'
import { fingerprintTrajectory } from '../trajectory'

const structure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice: {
    vectors: [[2, 0, 0], [0, 2, 0], [0, 0, 2]],
    periodic: [true, true, true],
  },
  atoms: [{ id: 'li', element: 'Li', position: [5, 0, 0] }],
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['li'],
  coordinateMode: 'unwrapped-cartesian',
  lattice: structure.lattice,
  frames: [0, 1, 2, 3, 4, 5].map((x, index) => ({
    step: index,
    timePs: index * 0.5,
    positions: [[x, 0, 0]],
  })),
}

function approximate(actual: number, expected: number, tolerance = 1e-12) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testPhysicalTimeUnitsAndLocalization() {
  const result = analyzeTrajectoryMsd({
    structure,
    trajectory,
    species: ['Li'],
    directions: 'x',
    maxLagFrames: 3,
    fitLagRangeFrames: [1, 3],
    minimumFitRSquared: 0.95,
  })
  assertEqual(result.verdict, 'pass')
  assertEqual(result.species[0].points.length, 3)
  approximate(result.species[0].points[0].valueA2, 1)
  approximate(result.species[0].points[1].valueA2, 4)
  approximate(result.species[0].fit!.slopeA2PerPs, 8)
  approximate(result.species[0].diffusionCoefficientA2PerPs!, 4)
  assertEqual(result.species[0].maximumObservedDisplacement.toFrameIndex, 3)
  assertEqual(result.inspectionTargets[0].trajectoryFrameIndex, 3)
  assertEqual(result.structureFingerprint, fingerprintStructure(structure))
  assertEqual(result.trajectoryFingerprint, fingerprintTrajectory(trajectory))
}

function testWrappedPeriodicCoordinatesFailClosed() {
  let error: unknown = null
  try {
    analyzeTrajectoryMsd({
      structure,
      trajectory: { ...trajectory, coordinateMode: 'cartesian' },
      directions: 'x',
    })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof TrajectoryMsdInputError)
  assertEqual((error as TrajectoryMsdInputError).code, 'unwrapped_trajectory_required')
}

async function testMcpContract() {
  const response = await callZatomMcpTool('trajectory_analyze_msd', {
    structure,
    trajectory,
    species: ['Li'],
    directions: 'x',
    maxLagFrames: 3,
    fitLagRangeFrames: [1, 3],
    minimumFitRSquared: 0.95,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    cadencePs: number
    species: Array<{ diffusionCoefficientA2PerPs: number }>
    checks: Array<{ id: string; status: string }>
  }
  assertEqual(data.verdict, 'pass')
  approximate(data.cadencePs, 0.5)
  approximate(data.species[0].diffusionCoefficientA2PerPs, 4)
  assertTrue(data.checks.some((check) => check.id === 'trajectory_msd.Li' && check.status === 'pass'))
}

async function main() {
  testPhysicalTimeUnitsAndLocalization()
  testWrappedPeriodicCoordinatesFailClosed()
  await testMcpContract()
}

void main()
