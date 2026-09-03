import { assertEqual, assertTrue } from '../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { fractionalToCartesian } from '../structure-math'
import {
  analyzeTrajectoryDensityProfile,
  TrajectoryDensityProfileInputError,
} from '../trajectory-density-profile'

const lattice = {
  vectors: [[2, 0, 0], [0.5, 2, 0], [0.2, 0.3, 4]] as [[number, number, number], [number, number, number], [number, number, number]],
  periodic: [true, true, false] as [boolean, boolean, boolean],
}
const firstPosition = fractionalToCartesian([0.25, 0.25, 0.1], lattice.vectors)
const secondPosition = fractionalToCartesian([0.75, 0.75, 0.9], lattice.vectors)

const structure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice,
  atoms: [
    { id: 'si', element: 'Si', position: firstPosition },
    { id: 'o', element: 'O', position: secondPosition },
  ],
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['si', 'o'],
  coordinateMode: 'cartesian',
  lattice,
  frames: [
    { step: 0, timePs: 0, positions: [firstPosition, secondPosition] },
    { step: 1, timePs: 0.5, positions: [firstPosition, secondPosition] },
  ],
}

function approximate(actual: number, expected: number, tolerance = 1e-12) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testSkewCellNumberDensityAndIntegration() {
  const result = analyzeTrajectoryDensityProfile({
    structure,
    trajectory,
    latticeAxis: 'c',
    binCount: 4,
  })
  assertEqual(result.verdict, 'warn')
  approximate(result.cellVolumeA3, 16)
  approximate(result.lateralAreaA2, 4)
  approximate(result.cellHeightA, 4)
  approximate(result.bins[0].totalNumberDensityPerA3, 0.25)
  approximate(result.bins[3].totalNumberDensityPerA3, 0.25)
  approximate(result.bins[0].speciesNumberDensityPerA3.Si, 0.25)
  approximate(result.bins[3].speciesNumberDensityPerA3.O, 0.25)
  approximate(result.integratedMeanAtomCount, 2)
  assertEqual(result.inspectionTargets[0].trajectoryFrameIndex, 0)
}

function testFiniteAxisContainmentFailsClosed() {
  const outside = fractionalToCartesian([0.25, 0.25, 1.1], lattice.vectors)
  let error: unknown = null
  try {
    analyzeTrajectoryDensityProfile({
      structure: { ...structure, atoms: [{ ...structure.atoms[0], position: outside }, structure.atoms[1]] },
      trajectory: {
        ...trajectory,
        frames: [
          { step: 0, timePs: 0, positions: [outside, secondPosition] },
          { step: 1, timePs: 0.5, positions: [outside, secondPosition] },
        ],
      },
      latticeAxis: 'c',
    })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof TrajectoryDensityProfileInputError)
  assertEqual((error as TrajectoryDensityProfileInputError).code, 'density_atom_outside_cell')
}

async function testMcpContract() {
  const response = await callZatomMcpTool('trajectory_analyze_density_profile', {
    structure,
    trajectory,
    latticeAxis: 'c',
    binCount: 4,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    integratedMeanAtomCount: number
    bins: Array<{ totalNumberDensityPerA3: number }>
    checks: Array<{ id: string; status: string }>
  }
  assertEqual(data.verdict, 'warn')
  approximate(data.integratedMeanAtomCount, 2)
  approximate(data.bins[0].totalNumberDensityPerA3, 0.25)
  assertTrue(data.checks.some((check) => check.id === 'trajectory_density.normalization' && check.status === 'pass'))
}

async function main() {
  testSkewCellNumberDensityAndIntegration()
  testFiniteAxisContainmentFailsClosed()
  await testMcpContract()
}

void main()
