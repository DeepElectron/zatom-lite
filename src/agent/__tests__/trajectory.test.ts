import { assertDeepEqual, assertEqual, assertTrue } from '../../testing/assert'
import { finalizeStructureCandidate } from '../candidate-tool'
import { callZatomMcpTool } from '../mcp-adapter'
import type { ZatomModelingProvider, ZatomProviderCapability } from '../provider'
import { normalizeProviderOutput, ZATOM_PROVIDER_SCHEMA, ZatomProviderError } from '../provider'
import type { ZatomStructure, ZatomToolContext, ZatomTrajectory } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import {
  compareCanonicalText,
  createFnv1a64Hasher,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from '../structure-math'
import { parseZatomStructure, ZatomStructureInputError } from '../structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory, ZatomTrajectoryInputError } from '../trajectory'

const finalStructure: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'trajectory final',
  atoms: [
    { id: 'c-left', element: 'C', position: [0.1, 0, 0] },
    { id: 'c-right', element: 'C', position: [1.5, 0, 0] },
  ],
  bonds: [{ id: 'c-c', atomIds: ['c-left', 'c-right'], order: 1 }],
}

const trajectory: ZatomTrajectory = {
  schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
  atomIds: ['c-left', 'c-right'],
  coordinateMode: 'cartesian',
  label: 'bounded two-frame evidence',
  frames: [
    {
      step: 0,
      timePs: 0,
      positions: [[0, 0, 0], [1.4, 0, 0]],
      velocitiesAperPs: [[0.1, 0, 0], [-0.1, 0, 0]],
      forcesEvPerA: [[0.2, 0, 0], [-0.2, 0, 0]],
      scalars: { temperatureK: 100, potentialEnergyEv: -1 },
    },
    {
      step: 10,
      timePs: 0.01,
      positions: [[0.1, 0, 0], [1.5, 0, 0]],
      velocitiesAperPs: [[0.05, 0, 0], [-0.05, 0, 0]],
      forcesEvPerA: [[0.01, 0, 0], [-0.01, 0, 0]],
      scalars: { potentialEnergyEv: -1.2, temperatureK: 80 },
    },
  ],
}

const variableCellFinalStructure: ZatomStructure = {
  ...finalStructure,
  label: 'variable-cell trajectory final',
  lattice: { vectors: [[3.2, 0, 0], [0, 3.2, 0], [0, 0, 3.2]], periodic: [true, true, true] },
}

const variableCellTrajectory: ZatomTrajectory = {
  ...trajectory,
  coordinateMode: 'unwrapped-cartesian',
  label: 'bounded variable-cell evidence',
  frames: [
    {
      ...trajectory.frames[0],
      lattice: { vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], periodic: [true, true, true] },
    },
    {
      ...trajectory.frames[1],
      lattice: variableCellFinalStructure.lattice!,
    },
  ],
}

function expectTrajectoryError(value: unknown, code: string, options: Parameters<typeof parseZatomTrajectory>[1] = {}) {
  let caught: unknown
  try {
    parseZatomTrajectory(value, options)
  } catch (error) {
    caught = error
  }
  assertTrue(caught instanceof ZatomTrajectoryInputError)
  assertEqual((caught as ZatomTrajectoryInputError).code, code)
}

function expectStructureError(value: unknown, code: string) {
  let caught: unknown
  try {
    parseZatomStructure(value)
  } catch (error) {
    caught = error
  }
  assertTrue(caught instanceof ZatomStructureInputError)
  assertEqual((caught as ZatomStructureInputError).code, code)
}

function testCanonicalValidationAndFingerprinting() {
  const knownHasher = createFnv1a64Hasher()
  knownHasher.feed('hello')
  assertEqual(knownHasher.digest(), 'fnv1a64:a430d84680aabd0b')
  const unicodeHasher = createFnv1a64Hasher()
  unicodeHasher.feed('é')
  assertEqual(unicodeHasher.digest(), 'fnv1a64:0ac21707b7181e01')
  assertTrue(compareCanonicalText('z', 'ä') < 0)
  assertEqual(fingerprintCanonicalJson({ b: 'é', a: 1 }), fingerprintCanonicalJson({ a: 1, b: 'é' }))
  const parsed = parseZatomTrajectory(trajectory, { structure: finalStructure })
  assertEqual(parsed.frames.length, 2)
  assertDeepEqual(parsed.atomIds, finalStructure.atoms.map((atom) => atom.id))
  const reorderedScalars = structuredClone(trajectory)
  reorderedScalars.frames[0].scalars = { potentialEnergyEv: -1, temperatureK: 100 }
  assertEqual(
    fingerprintTrajectory(parsed),
    fingerprintTrajectory(parseZatomTrajectory(reorderedScalars, { structure: finalStructure })),
  )
  const changedScalar = structuredClone(trajectory)
  changedScalar.frames[1].scalars!.temperatureK = 81
  assertTrue(fingerprintTrajectory(parsed) !== fingerprintTrajectory(changedScalar))
  assertTrue(fingerprintStructure(finalStructure).startsWith('fnv1a64:'))
  assertTrue(fingerprintTrajectory(parsed).startsWith('fnv1a64:'))

  const topologyUnknown = structuredClone(finalStructure)
  delete topologyUnknown.bonds
  assertTrue(fingerprintStructure(topologyUnknown) !== fingerprintStructure({ ...topologyUnknown, bonds: [] }))
  assertTrue(fingerprintStructure(topologyUnknown) !== fingerprintStructure({
    ...topologyUnknown,
    lattice: { vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], periodic: [false, false, false] },
  }))

  const changedMetadata = structuredClone(trajectory)
  changedMetadata.metadata = { replay: 'different' }
  assertTrue(fingerprintTrajectory(parsed) !== fingerprintTrajectory(changedMetadata))

  const variable = parseZatomTrajectory(variableCellTrajectory, { structure: variableCellFinalStructure })
  assertEqual(variable.frames[0].lattice?.vectors[0][0], 3)
  assertEqual(variable.frames[1].lattice?.vectors[0][0], 3.2)
  const changedCell = structuredClone(variableCellTrajectory)
  changedCell.frames[0].lattice!.vectors[0][0] = 3.01
  assertTrue(fingerprintTrajectory(variable) !== fingerprintTrajectory(changedCell))
}

function testMalformedAndOverBudgetTrajectoriesFailClosed() {
  const wrongOrder = structuredClone(trajectory)
  wrongOrder.atomIds.reverse()
  expectTrajectoryError(wrongOrder, 'invalid_trajectory', { structure: finalStructure })

  const nonMonotonic = structuredClone(trajectory)
  nonMonotonic.frames[1].timePs = 0
  expectTrajectoryError(nonMonotonic, 'invalid_trajectory')

  const wrongFinal = structuredClone(trajectory)
  wrongFinal.frames[1].positions[0][0] += 0.01
  expectTrajectoryError(wrongFinal, 'invalid_trajectory', { structure: finalStructure })

  const threeFrames = structuredClone(trajectory)
  threeFrames.frames.splice(1, 0, {
    step: 5,
    timePs: 0.005,
    positions: [[0.05, 0, 0], [1.45, 0, 0]],
  })
  expectTrajectoryError(threeFrames, 'invalid_trajectory', { maxFrames: 2 })
  expectTrajectoryError(trajectory, 'invalid_trajectory_budget', { maxAtomFrames: 3 })

  const partialFrameLattice = structuredClone(variableCellTrajectory)
  delete partialFrameLattice.frames[0].lattice
  expectTrajectoryError(partialFrameLattice, 'invalid_trajectory', { structure: variableCellFinalStructure })

  const fixedAndVariable = structuredClone(variableCellTrajectory)
  fixedAndVariable.lattice = variableCellFinalStructure.lattice
  expectTrajectoryError(fixedAndVariable, 'invalid_trajectory', { structure: variableCellFinalStructure })

  const wrongFinalLattice = structuredClone(variableCellTrajectory)
  wrongFinalLattice.frames[1].lattice!.vectors[2][2] = 3.3
  expectTrajectoryError(wrongFinalLattice, 'invalid_trajectory', { structure: variableCellFinalStructure })

  const changingBoundaryMode = structuredClone(variableCellTrajectory)
  changingBoundaryMode.frames[0].lattice!.periodic[2] = false
  expectTrajectoryError(changingBoundaryMode, 'invalid_trajectory', { structure: variableCellFinalStructure })
}

function testCanonicalArtifactsRejectUnknownFields() {
  expectStructureError({
    ...finalStructure,
    atoms: [{ ...finalStructure.atoms[0], formalCharge: 0 }, finalStructure.atoms[1]],
  }, 'unsupported_structure_field')

  expectStructureError({
    ...finalStructure,
    atoms: [{ ...finalStructure.atoms[0], properties: 'neutral' }, finalStructure.atoms[1]],
  }, 'invalid_structure_json')

  expectStructureError({
    ...finalStructure,
    atoms: [{ ...finalStructure.atoms[0], position: [Number.NaN, 0, 0] }, finalStructure.atoms[1]],
  }, 'invalid_vector')

  const misspelledVelocity = structuredClone(trajectory) as unknown as Record<string, unknown>
  const frames = misspelledVelocity.frames as Array<Record<string, unknown>>
  frames[0].velocityAperPs = frames[0].velocitiesAperPs
  delete frames[0].velocitiesAperPs
  expectTrajectoryError(misspelledVelocity, 'unsupported_trajectory_field')
  expectTrajectoryError({ ...trajectory, label: 4 }, 'invalid_trajectory')
}

function testProviderRejectsOutOfRangeFrameTargets() {
  const capability: ZatomProviderCapability = {
    id: 'test.trajectory',
    title: 'test trajectory',
    description: 'test only',
    fidelity: 'empirical',
    source: 'required',
    deterministic: true,
    inputSchema: { type: 'object' },
    requiredCheckIds: [],
    tags: ['test'],
  }
  const provider: ZatomModelingProvider = {
    manifest: {
      schemaVersion: ZATOM_PROVIDER_SCHEMA,
      id: 'test.trajectory-provider',
      title: 'test trajectory provider',
      description: 'test only',
      adapterVersion: '1.0.0',
      engine: { name: 'test', version: '1' },
      execution: 'browser',
      capabilities: [capability],
    },
    execute: () => ({ structure: finalStructure, trajectory, checks: [] }),
  }
  let caught: unknown
  try {
    normalizeProviderOutput({
      provider,
      capability,
      request: { capability: capability.id, source: finalStructure, continuation: null, parameters: {}, seed: 1 },
      output: {
        structure: finalStructure,
        trajectory,
        checks: [],
        inspectionTargets: [{
          id: 'bad-frame',
          reason: 'must fail',
          center: [0, 0, 0],
          radius: 1,
          atomIds: ['c-left'],
          trajectoryFrameIndex: 2,
        }],
      },
    })
  } catch (error) {
    caught = error
  }
  assertTrue(caught instanceof ZatomProviderError)
  assertEqual((caught as ZatomProviderError).code, 'invalid_provider_result')
}

async function testCandidateTrajectoryHandoffIsFingerprintVerified() {
  let activeStructure: ZatomStructure | null = null
  let activeTrajectory: ZatomTrajectory | null = null
  const finalized = await finalizeStructureCandidate({
    tool: 'test_trajectory_handoff',
    result: { structure: finalStructure, trajectory, checks: [] },
    requestedApply: true,
    captureAfter: false,
    context: {
      writeStructure: (value) => { activeStructure = value },
      readStructure: () => activeStructure,
      writeTrajectory: (value) => { activeTrajectory = value },
      readTrajectory: () => activeTrajectory,
      writeWorkspace: (structureValue, trajectoryValue) => {
        activeStructure = structureValue
        activeTrajectory = trajectoryValue
      },
    },
    summary: () => 'done',
  })
  assertTrue(finalized.ok)
  assertEqual(finalized.data?.applicationVerified, true)
  assertTrue(finalized.checks?.some((check) => check.id === 'candidate.trajectory_handoff' && check.status === 'pass') === true)
  assertTrue(finalized.checks?.some((check) => check.id === 'candidate.trajectory_readback_identity' && check.status === 'pass') === true)
}

async function testCandidateRefusesSplitStructureAndTrajectoryWriters() {
  let structureWrites = 0
  let trajectoryWrites = 0
  const finalized = await finalizeStructureCandidate({
    tool: 'test_split_trajectory_handoff',
    result: { structure: finalStructure, trajectory, checks: [] },
    requestedApply: true,
    captureAfter: false,
    context: {
      writeStructure: () => { structureWrites += 1 },
      writeTrajectory: () => { trajectoryWrites += 1 },
    },
    summary: () => 'split writer refused',
  })
  assertTrue(finalized.ok)
  assertEqual(finalized.data?.appliedToWorkspace, false)
  assertEqual(finalized.data?.applicationBlocked, true)
  assertEqual(structureWrites, 0)
  assertEqual(trajectoryWrites, 0)
  assertTrue(finalized.checks?.some((check) => (
    check.id === 'candidate.application_gate'
    && check.status === 'fail'
    && check.message.includes('atomic workspace writer')
  )) === true)
}

async function testFrameFocusRequiresExactStructureAndTrajectoryIdentity() {
  let focusedFrame: number | undefined
  const context: ZatomToolContext = {
    readStructure: () => finalStructure,
    readTrajectory: () => trajectory,
    focusInspectionTarget: (target) => { focusedFrame = target.trajectoryFrameIndex; return null },
  }
  const input = {
    inspectionTarget: {
      id: 'initial-frame',
      reason: 'inspect initial frame',
      center: [0.7, 0, 0],
      radius: 2,
      atomIds: ['c-left', 'c-right'],
      trajectoryFrameIndex: 0,
    },
    expectedStructureFingerprint: fingerprintStructure(finalStructure),
    expectedTrajectoryFingerprint: fingerprintTrajectory(trajectory),
    captureAfter: false,
  }
  const focused = await callZatomMcpTool('viewer_focus_target', input, context)
  assertTrue(focused.structuredContent.ok)
  assertEqual(focusedFrame, 0)
  assertTrue(focused.structuredContent.checks?.some((check) => check.id === 'visual.trajectory_identity' && check.status === 'pass') === true)

  const missingIdentity = await callZatomMcpTool('viewer_focus_target', {
    ...input,
    expectedTrajectoryFingerprint: undefined,
  }, context)
  assertEqual(missingIdentity.structuredContent.error?.code, 'missing_visual_trajectory_identity')

  const stale = await callZatomMcpTool('viewer_focus_target', {
    ...input,
    expectedTrajectoryFingerprint: 'fnv1a64:0000000000000000',
  }, context)
  assertEqual(stale.structuredContent.error?.code, 'visual_trajectory_identity_mismatch')
}

async function main() {
  testCanonicalValidationAndFingerprinting()
  testMalformedAndOverBudgetTrajectoriesFailClosed()
  testCanonicalArtifactsRejectUnknownFields()
  testProviderRejectsOutOfRangeFrameTargets()
  await testCandidateTrajectoryHandoffIsFingerprintVerified()
  await testCandidateRefusesSplitStructureAndTrajectoryWriters()
  await testFrameFocusRequiresExactStructureAndTrajectoryIdentity()
  console.log('agent trajectory contract tests passed')
}

void main()
