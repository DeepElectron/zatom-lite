import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomLattice, ZatomTrajectory } from '../contracts'
import { ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import { stitchZatomTrajectories, ZatomTrajectoryStitchInputError } from '../trajectory-stitch'
import { fingerprintTrajectory } from '../trajectory'

const fixedLattice: ZatomLattice = {
  vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
  periodic: [true, true, true],
}

function parentTrajectory(periodic = false): ZatomTrajectory {
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['left', 'right'],
    coordinateMode: periodic ? 'unwrapped-cartesian' : 'cartesian',
    ...(periodic ? { lattice: fixedLattice } : {}),
    label: 'parent segment',
    frames: [
      {
        step: 0,
        timePs: 0,
        positions: [[0, 0, 0], [1, 0, 0]],
        velocitiesAperPs: [[0.1, 0, 0], [-0.1, 0, 0]],
        scalars: { totalEnergyEv: -1 },
      },
      {
        step: 10,
        timePs: 0.002,
        positions: [[0.01, 0, 0], [0.99, 0, 0]],
        velocitiesAperPs: [[0.2, 0.01, 0], [-0.2, -0.01, 0]],
        scalars: { totalEnergyEv: -0.9 },
      },
    ],
  }
}

function childTrajectory(parent: ZatomTrajectory, options: {
  boundaryOffsetA?: number
  declaredParentFingerprint?: string | null
  includeVelocities?: boolean
  lattice?: ZatomLattice
} = {}): ZatomTrajectory {
  const final = parent.frames[parent.frames.length - 1]
  const offset = options.boundaryOffsetA ?? 0
  const declared = options.declaredParentFingerprint === undefined
    ? fingerprintTrajectory(parent)
    : options.declaredParentFingerprint
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: [...parent.atomIds],
    coordinateMode: parent.coordinateMode,
    ...(options.lattice ? { lattice: options.lattice } : parent.lattice ? { lattice: parent.lattice } : {}),
    label: 'child segment',
    ...(declared === null ? {} : {
      metadata: { 'zatom.provider.sourceTrajectoryFingerprint': declared },
    }),
    frames: [
      {
        step: final.step,
        timePs: final.timePs,
        positions: final.positions.map((position, index) => index === 0
          ? [position[0] + offset, position[1], position[2]]
          : [...position]),
        ...(options.includeVelocities === false ? {} : {
          velocitiesAperPs: final.velocitiesAperPs?.map((velocity) => [...velocity]),
        }),
        scalars: { totalEnergyEv: -0.9 },
      },
      {
        step: final.step + 10,
        timePs: final.timePs + 0.002,
        positions: [[0.02, 0, 0], [0.98, 0, 0]],
        velocitiesAperPs: [[0.3, 0.02, 0], [-0.3, -0.02, 0]],
        scalars: { totalEnergyEv: -0.8 },
      },
    ],
  }
}

function check(result: ReturnType<typeof stitchZatomTrajectories>, id: string) {
  return result.checks.find((item) => item.id === id)
}

function testExactFixedCellStitchIsDeterministic() {
  const parent = parentTrajectory(true)
  const child = childTrajectory(parent)
  const first = stitchZatomTrajectories({ segments: [parent, child] })
  const replay = stitchZatomTrajectories({ segments: [parent, child] })
  assertDeepEqual(first.trajectory.frames.map((frame) => frame.step), [0, 10, 20])
  assertDeepEqual(first.trajectory.frames.map((frame) => frame.timePs), [0, 0.002, 0.004])
  assertDeepEqual(first.trajectory.lattice, fixedLattice)
  assertTrue(first.trajectory.frames.every((frame) => frame.lattice === undefined))
  assertEqual(first.boundaries[0].stitchedFrameIndex, 1)
  assertEqual(first.boundaries[0].maximumPositionErrorA, 0)
  assertEqual(first.boundaries[0].maximumVelocityErrorAperPs, 0)
  assertEqual(check(first, 'trajectory_stitch.boundary_step_time')?.status, 'pass')
  assertEqual(check(first, 'trajectory_stitch.boundary_positions')?.status, 'pass')
  assertEqual(check(first, 'trajectory_stitch.boundary_velocities')?.status, 'pass')
  assertEqual(check(first, 'trajectory_stitch.boundary_lattice')?.status, 'pass')
  assertEqual(check(first, 'trajectory_stitch.parent_fingerprint_chain')?.status, 'pass')
  assertEqual(check(first, 'trajectory_stitch.model_scope')?.status, 'warn')
  assertEqual(fingerprintTrajectory(first.trajectory), fingerprintTrajectory(replay.trajectory))
  assertDeepEqual(first.provenance.segmentFingerprints, [
    fingerprintTrajectory(parent),
    fingerprintTrajectory(child),
  ])
}

function testVariableAndFixedSegmentsNormalizeToPerFrameCells() {
  const parent = parentTrajectory(true)
  const expandedParent: ZatomTrajectory = {
    ...parent,
    lattice: undefined,
    frames: parent.frames.map((frame, index) => ({
      ...frame,
      lattice: {
        vectors: [[10 + index * 0.1, 0, 0], [0, 10, 0], [0, 0, 10]],
        periodic: [true, true, true],
      },
    })),
  }
  const childCell = expandedParent.frames[1].lattice!
  const child = childTrajectory(expandedParent, { lattice: childCell })
  const result = stitchZatomTrajectories({ segments: [expandedParent, child] })
  assertEqual(result.trajectory.lattice, undefined)
  assertTrue(result.trajectory.frames.every((frame) => frame.lattice !== undefined))
  assertEqual(result.trajectory.frames[0].lattice?.vectors[0][0], 10)
  assertEqual(result.trajectory.frames[1].lattice?.vectors[0][0], 10.1)
  assertEqual(result.trajectory.frames[2].lattice?.vectors[0][0], 10.1)
  assertEqual(check(result, 'trajectory_stitch.boundary_lattice')?.status, 'pass')
}

function testBoundaryAndLineageFailuresRemainInspectable() {
  const parent = parentTrajectory()
  const discontinuous = childTrajectory(parent, { boundaryOffsetA: 0.1 })
  const positionFailure = stitchZatomTrajectories({
    segments: [parent, discontinuous],
    maximumBoundaryPositionErrorA: 0.01,
  })
  assertEqual(check(positionFailure, 'trajectory_stitch.boundary_positions')?.status, 'fail')
  assertEqual(positionFailure.inspectionTargets[0].trajectoryFrameIndex, 1)
  assertDeepEqual(positionFailure.inspectionTargets[0].atomIds, ['left'])

  const missingVelocity = childTrajectory(parent, { includeVelocities: false })
  const velocityFailure = stitchZatomTrajectories({ segments: [parent, missingVelocity] })
  assertEqual(check(velocityFailure, 'trajectory_stitch.boundary_velocities')?.status, 'fail')
  const velocityWarning = stitchZatomTrajectories({
    segments: [parent, missingVelocity],
    requireBoundaryVelocities: false,
  })
  assertEqual(check(velocityWarning, 'trajectory_stitch.boundary_velocities')?.status, 'warn')

  const wrongLineage = childTrajectory(parent, { declaredParentFingerprint: 'fnv1a64:00000000deadbeef' })
  const lineageFailure = stitchZatomTrajectories({ segments: [parent, wrongLineage] })
  assertEqual(check(lineageFailure, 'trajectory_stitch.parent_fingerprint_chain')?.status, 'fail')

  const missingLineage = childTrajectory(parent, { declaredParentFingerprint: null })
  const relaxedLineage = stitchZatomTrajectories({
    segments: [parent, missingLineage],
    requireParentFingerprintChain: false,
  })
  assertEqual(check(relaxedLineage, 'trajectory_stitch.parent_fingerprint_chain')?.status, 'warn')
}

function testUnconstructableIdentityAndBudgetMismatchFailClosed() {
  const parent = parentTrajectory()
  const child = childTrajectory(parent)
  let identityError: unknown
  try {
    stitchZatomTrajectories({
      segments: [parent, { ...child, atomIds: ['right', 'left'] }],
    })
  } catch (error) {
    identityError = error
  }
  assertTrue(identityError instanceof ZatomTrajectoryStitchInputError)
  assertEqual((identityError as ZatomTrajectoryStitchInputError).code, 'trajectory_atom_identity_mismatch')

  let budgetError: unknown
  try {
    stitchZatomTrajectories({ segments: [parent, child], maxFrames: 2 })
  } catch (error) {
    budgetError = error
  }
  assertTrue(budgetError instanceof ZatomTrajectoryStitchInputError)
  assertEqual((budgetError as ZatomTrajectoryStitchInputError).code, 'trajectory_stitch_budget_exceeded')
}

async function testMcpApplicationGateAndReadback() {
  const parent = parentTrajectory()
  const child = childTrajectory(parent)
  let active: ZatomTrajectory | null = null
  const applied = await callZatomMcpTool('trajectory_stitch_segments', {
    segments: [parent, child],
    applyToWorkspace: true,
    captureAfter: true,
  }, {
    writeTrajectory: (trajectory) => { active = trajectory },
    readTrajectory: () => active,
    captureViewport: () => ({ imageBase64: 'c3RpdGNo', mimeType: 'image/png', width: 320, height: 200 }),
  })
  assertTrue(applied.structuredContent.ok, applied.structuredContent.summary)
  const data = applied.structuredContent.data as {
    appliedToWorkspace: boolean
    applicationBlocked: boolean
    applicationVerified: boolean | null
    result: ReturnType<typeof stitchZatomTrajectories>
  }
  assertEqual(data.appliedToWorkspace, true)
  assertEqual(data.applicationBlocked, false)
  assertEqual(data.applicationVerified, true)
  assertEqual((active as ZatomTrajectory | null)?.frames.length, 3)
  assertTrue(data.result.checks.some((item) => item.id === 'trajectory_stitch.readback_identity' && item.status === 'pass'))
  assertEqual(applied.content.filter((block) => block.type === 'image').length, 1)

  let writes = 0
  const blocked = await callZatomMcpTool('trajectory_stitch_segments', {
    segments: [parent, childTrajectory(parent, { boundaryOffsetA: 0.2 })],
    maximumBoundaryPositionErrorA: 0.01,
    applyToWorkspace: true,
  }, { writeTrajectory: () => { writes++ } })
  assertTrue(blocked.structuredContent.ok)
  const blockedData = blocked.structuredContent.data as {
    applicationBlocked: boolean
    result: ReturnType<typeof stitchZatomTrajectories>
  }
  assertEqual(blockedData.applicationBlocked, true)
  assertEqual(writes, 0)
  assertTrue(blockedData.result.checks.some((item) => item.id === 'trajectory_stitch.application_gate' && item.status === 'fail'))
}

async function main() {
  testExactFixedCellStitchIsDeterministic()
  testVariableAndFixedSegmentsNormalizeToPerFrameCells()
  testBoundaryAndLineageFailuresRemainInspectable()
  testUnconstructableIdentityAndBudgetMismatchFailClosed()
  await testMcpApplicationGateAndReadback()
}

void main()
