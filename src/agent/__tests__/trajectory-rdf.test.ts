import { assertEqual, assertTrue } from '../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  analyzeTrajectoryRdf,
  TrajectoryRdfInputError,
} from '../trajectory-rdf'

const structure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice: {
    vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    periodic: [true, true, true],
  },
  atoms: [{ id: 'site', element: 'Si', position: [0, 0, 0] }],
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['site'],
  coordinateMode: 'cartesian',
  lattice: structure.lattice,
  frames: [
    { step: 0, timePs: 0, positions: [[0, 0, 0]] },
    { step: 1, timePs: 0.5, positions: [[0, 0, 0]] },
  ],
}

function approximate(actual: number, expected: number, tolerance = 1e-12) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testPeriodicSelfImagesAndDensityNormalization() {
  const result = analyzeTrajectoryRdf({
    structure,
    trajectory,
    cutoffA: 1.01,
    binCount: 10,
    centerElements: ['Si'],
    neighborElements: ['Si'],
  })
  assertEqual(result.verdict, 'warn')
  assertEqual(result.totalPairImageCount, 12)
  assertEqual(result.bins[9].pairImageCount, 12)
  assertEqual(result.bins[9].cumulativeCoordination, 6)
  approximate(result.bins[9].gR, 6 / result.bins[9].shellVolumeA3)
  assertEqual(result.closestPair?.distanceA, 1)
  assertEqual(result.inspectionTargets[0].trajectoryFrameIndex, 0)
}

function testMixedPbcAndImageBudgetFailClosed() {
  let boundaryError: unknown = null
  try {
    analyzeTrajectoryRdf({
      structure: { ...structure, lattice: { ...structure.lattice!, periodic: [true, true, false] } },
      trajectory: {
        ...trajectory,
        lattice: { ...trajectory.lattice!, periodic: [true, true, false] },
      },
      cutoffA: 1,
    })
  } catch (error) {
    boundaryError = error
  }
  assertTrue(boundaryError instanceof TrajectoryRdfInputError)
  assertEqual((boundaryError as TrajectoryRdfInputError).code, 'full_periodic_lattice_required')

  let budgetError: unknown = null
  try {
    analyzeTrajectoryRdf({
      structure,
      trajectory,
      cutoffA: 1.01,
      maxPeriodicImageCandidates: 1,
    })
  } catch (error) {
    budgetError = error
  }
  assertTrue(budgetError instanceof TrajectoryRdfInputError)
  assertEqual((budgetError as TrajectoryRdfInputError).code, 'rdf_image_budget_exceeded')
}

async function testMcpContract() {
  const response = await callZatomMcpTool('trajectory_analyze_rdf', {
    structure,
    trajectory,
    cutoffA: 1.01,
    binCount: 10,
    centerElements: ['Si'],
    neighborElements: ['Si'],
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    totalPairImageCount: number
    bins: Array<{ cumulativeCoordination: number }>
    checks: Array<{ id: string; status: string }>
  }
  assertEqual(data.verdict, 'warn')
  assertEqual(data.totalPairImageCount, 12)
  assertEqual(data.bins[9].cumulativeCoordination, 6)
  assertTrue(data.checks.some((check) => check.id === 'trajectory_rdf.normalization' && check.status === 'pass'))
}

async function main() {
  testPeriodicSelfImagesAndDensityNormalization()
  testMixedPbcAndImageBudgetFailClosed()
  await testMcpContract()
}

void main()
