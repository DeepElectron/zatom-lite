import { assertEqual, assertTrue } from '../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  analyzeTrajectoryHydrogenBonds,
  TrajectoryHydrogenBondInputError,
} from '../trajectory-hydrogen-bonds'

const periodicStructure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  lattice: {
    vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
    periodic: [true, false, false],
  },
  atoms: [
    { id: 'donor', element: 'O', position: [0.2, 0, 0] },
    { id: 'hydrogen', element: 'H', position: [9.2, 0, 0] },
    { id: 'acceptor', element: 'O', position: [8, 0, 0] },
  ],
  bonds: [{ id: 'donor-h', atomIds: ['donor', 'hydrogen'], order: 1 }],
}

const periodicTrajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['donor', 'hydrogen', 'acceptor'],
  coordinateMode: 'cartesian',
  lattice: periodicStructure.lattice,
  frames: [
    { step: 0, timePs: 0, positions: periodicStructure.atoms.map((atom) => atom.position) },
    { step: 1, timePs: 0.5, positions: periodicStructure.atoms.map((atom) => atom.position) },
  ],
}

function approximate(actual: number, expected: number, tolerance = 1e-12) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

function testConsistentPeriodicTripletGeometry() {
  const result = analyzeTrajectoryHydrogenBonds({
    structure: periodicStructure,
    trajectory: periodicTrajectory,
    donorAtomIds: ['donor'],
    acceptorAtomIds: ['acceptor'],
    periodic: true,
  })
  assertEqual(result.verdict, 'warn')
  assertEqual(result.eventCount, 2)
  assertEqual(result.hydrogenBonds.length, 1)
  approximate(result.frames[0].events[0].donorHydrogenDistanceA, 1)
  approximate(result.frames[0].events[0].donorAcceptorDistanceA, 2.2)
  approximate(result.frames[0].events[0].dhaAngleDeg, 180)
  assertEqual(result.frames[0].events[0].donorFractionalImage[0], 1)
  assertEqual(result.hydrogenBonds[0].occurrenceFraction, 1)
  approximate(result.hydrogenBonds[0].continuousRuns.maximumSpanPs, 0.5)
  assertEqual(result.inspectionTargets[0].trajectoryFrameIndex, 0)
}

function testContinuousRunsAndTopologyGate() {
  const finite: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'd', element: 'O', position: [0, 0, 0] },
      { id: 'h', element: 'H', position: [1, 0, 0] },
      { id: 'a', element: 'O', position: [2.8, 0, 0] },
    ],
    bonds: [{ id: 'd-h', atomIds: ['d', 'h'], order: 1 }],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['d', 'h', 'a'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[0, 0, 0], [1, 0, 0], [2.8, 0, 0]] },
      { step: 1, timePs: 0.5, positions: [[0, 0, 0], [1, 0, 0], [1, 2, 0]] },
      { step: 2, timePs: 1, positions: [[0, 0, 0], [1, 0, 0], [2.8, 0, 0]] },
    ],
  }
  const result = analyzeTrajectoryHydrogenBonds({
    structure: finite,
    trajectory,
    donorAtomIds: ['d'],
    acceptorAtomIds: ['a'],
    periodic: false,
  })
  assertEqual(result.eventCount, 2)
  approximate(result.hydrogenBonds[0].occurrenceFraction, 2 / 3)
  assertEqual(result.hydrogenBonds[0].continuousRuns.count, 2)
  assertEqual(result.hydrogenBonds[0].continuousRuns.maximumSampleCount, 1)

  let error: unknown = null
  try {
    analyzeTrajectoryHydrogenBonds({
      structure: { ...finite, bonds: undefined },
      trajectory,
      donorAtomIds: ['d'],
      acceptorAtomIds: ['a'],
      periodic: false,
    })
  } catch (caught) {
    error = caught
  }
  assertTrue(error instanceof TrajectoryHydrogenBondInputError)
  assertEqual((error as TrajectoryHydrogenBondInputError).code, 'explicit_topology_required')
}

async function testMcpContract() {
  const response = await callZatomMcpTool('trajectory_analyze_hydrogen_bonds', {
    structure: periodicStructure,
    trajectory: periodicTrajectory,
    donorAtomIds: ['donor'],
    acceptorAtomIds: ['acceptor'],
    periodic: true,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    verdict: string
    eventCount: number
    hydrogenBonds: Array<{ occurrenceFraction: number }>
    checks: Array<{ id: string; status: string }>
  }
  assertEqual(data.verdict, 'warn')
  assertEqual(data.eventCount, 2)
  assertEqual(data.hydrogenBonds[0].occurrenceFraction, 1)
  assertTrue(data.checks.some((check) => check.id === 'trajectory_hydrogen_bond.topology' && check.status === 'pass'))
}

async function main() {
  testConsistentPeriodicTripletGeometry()
  testContinuousRunsAndTopologyGate()
  await testMcpContract()
}

void main()
