import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  analyzeTrajectoryOrientation,
} from '../trajectory-orientation'

function approximate(actual: number, expected: number, tolerance = 1e-12) {
  assertTrue(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

const finiteStructure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: [
    { id: 'origin', element: 'C', position: [0, 0, 0] },
    { id: 'tip', element: 'C', position: [0, 0, -1] },
  ],
  bonds: [{ id: 'director-bond', atomIds: ['origin', 'tip'], order: 1 }],
}

const finiteTrajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['origin', 'tip'],
  coordinateMode: 'cartesian',
  frames: [
    { step: 0, timePs: 0, positions: [[0, 0, 0], [0, 0, 1]] },
    { step: 1, timePs: 0.5, positions: [[0, 0, 0], [1, 0, 0]] },
    { step: 2, timePs: 1, positions: [[0, 0, 0], [0, 0, -1]] },
  ],
}

function testReferenceP2AndIndependentTensor() {
  const result = analyzeTrajectoryOrientation({
    structure: finiteStructure,
    trajectory: finiteTrajectory,
    directors: [{ id: 'molecular-axis', fromAtomId: 'origin', toAtomId: 'tip' }],
    referenceAxis: [0, 0, 4],
    periodic: false,
  })
  approximate(result.meanCosTheta, 0)
  approximate(result.meanAbsoluteCosTheta, 2 / 3)
  approximate(result.meanReferenceP2, 0.5)
  approximate(result.referenceTensorProjectionP2, result.meanReferenceP2)
  approximate(result.referenceTensorProjectionError, 0)
  approximate(result.frames[0].meanReferenceP2, 1)
  approximate(result.frames[1].meanReferenceP2, -0.5)
  approximate(result.tensor.principalOrder, 0.5)
  assertTrue(result.tensor.directorResolved)
  assertDeepEqual(result.tensor.principalDirector, [0, 0, 1])
  assertEqual(result.extrema.minimumReferenceP2.frameIndex, 1)
  assertEqual(result.extrema.maximumReferenceP2.frameIndex, 0)
  assertEqual(result.inspectionTargets[1].trajectoryFrameIndex, 1)
}

function testPeriodicCrossingUsesCertifiedMinimumImage() {
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    lattice: {
      vectors: [[10, 0, 0], [3, 8, 0], [1, 2, 7]],
      periodic: [true, true, true],
    },
    atoms: [
      { id: 'from', element: 'C', position: [9.8, 0, 0] },
      { id: 'to', element: 'C', position: [0.2, 0, 0] },
    ],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['from', 'to'],
    coordinateMode: 'cartesian',
    lattice: structure.lattice,
    frames: [0, 1].map((frameIndex) => ({
      step: frameIndex,
      timePs: frameIndex,
      positions: structure.atoms.map((atom) => atom.position),
    })),
  }
  const result = analyzeTrajectoryOrientation({
    structure,
    trajectory,
    directors: [{ id: 'crossing', fromAtomId: 'from', toAtomId: 'to' }],
    referenceAxis: [1, 0, 0],
    periodic: true,
    maximumDirectorLengthA: 1,
  })
  approximate(result.directors[0].maximumLengthA, 0.4, 1e-10)
  approximate(result.meanCosTheta, 1, 1e-12)
  approximate(result.meanReferenceP2, 1, 1e-12)
  assertDeepEqual(result.extrema.maximumReferenceP2.fractionalImage, [1, 0, 0])
  assertTrue(result.periodicImageCandidateEvaluations > 0)
}

function testReferenceOrderGateFailsClosed() {
  const result = analyzeTrajectoryOrientation({
    structure: finiteStructure,
    trajectory: finiteTrajectory,
    directors: [{ id: 'molecular-axis', fromAtomId: 'origin', toAtomId: 'tip' }],
    referenceAxis: [0, 0, 1],
    periodic: false,
    minimumMeanReferenceP2: 0.6,
  })
  assertEqual(result.verdict, 'fail')
  assertTrue(result.checks.some((check) => (
    check.id === 'trajectory_orientation.reference_order' && check.status === 'fail'
  )))
}

function testOffAxisPrincipalDirector() {
  const inverseSqrtTwo = 1 / Math.sqrt(2)
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'from', element: 'N', position: [0, 0, 0] },
      { id: 'to', element: 'N', position: [1, 1, 0] },
    ],
  }
  const trajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['from', 'to'],
    coordinateMode: 'cartesian',
    frames: [0, 1].map((frameIndex) => ({
      step: frameIndex,
      timePs: frameIndex,
      positions: structure.atoms.map((atom) => atom.position),
    })),
  }
  const result = analyzeTrajectoryOrientation({
    structure,
    trajectory,
    directors: [{ id: 'diagonal', fromAtomId: 'from', toAtomId: 'to' }],
    referenceAxis: [1, 1, 0],
    periodic: false,
  })
  assertTrue(result.tensor.principalDirector !== null)
  approximate(result.tensor.principalOrder, 1)
  approximate(result.tensor.principalDirector![0], inverseSqrtTwo)
  approximate(result.tensor.principalDirector![1], inverseSqrtTwo)
  approximate(result.tensor.principalDirector![2], 0)
}

async function testMcpContract() {
  const response = await callZatomMcpTool('trajectory_analyze_orientation', {
    structure: finiteStructure,
    trajectory: finiteTrajectory,
    directors: [{ id: 'molecular-axis', fromAtomId: 'origin', toAtomId: 'tip' }],
    referenceAxis: [0, 0, 1],
    periodic: false,
  })
  assertTrue(response.structuredContent.ok, response.structuredContent.summary)
  const data = response.structuredContent.data as {
    meanReferenceP2: number
    tensor: { principalOrder: number }
    checks: Array<{ id: string; status: string }>
  }
  approximate(data.meanReferenceP2, 0.5)
  approximate(data.tensor.principalOrder, 0.5)
  assertTrue(data.checks.some((check) => check.id === 'trajectory_orientation.identity' && check.status === 'pass'))
}

async function main() {
  testReferenceP2AndIndependentTensor()
  testPeriodicCrossingUsesCertifiedMinimumImage()
  testReferenceOrderGateFailsClosed()
  testOffAxisPrincipalDirector()
  await testMcpContract()
}

void main()
