import { assertEqual, assertTrue } from '../../../testing/assert'
import type { ZatomStructure, ZatomToolManifest, ZatomTrajectory } from '../../../agent/contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../../../agent/contracts'
import { fingerprintStructure } from '../../../agent/structure-math'
import { fingerprintTrajectory } from '../../../agent/trajectory'
import { listZatomAgentTools, registerZatomAgentTool } from '../../../agent/tools'
import {
  activeViewportToolContext,
  readActiveViewportStructure,
  readActiveViewportTrajectory,
  writeActiveViewportStructure,
  writeActiveViewportTrajectory,
} from '../../../agent/viewer-context'
import { useAgentOperationReview } from '../../../orchestration/agentOperationReviewStore'
import {
  agentModelingOriginMismatch,
  type AgentModelingOrigin,
} from '../agent-modeling-origin'
import {
  AgentModelingRunArtifactError,
  agentModelingVisualBinding,
  agentModelingInspectionTargetKey,
  collectAgentInspectionTargets,
  composeAgentModelingRunArtifact,
  parseAgentModelingRunArtifact,
  upsertAgentModelingTargetEvidence,
  useAgentModelingStore,
} from '../agent-modeling-store'

const origin: AgentModelingOrigin = {
  viewportId: 'vp-1',
  structureFingerprint: 'structure:a',
  trajectoryFingerprint: 'trajectory:a',
}

/**
 * Each test in this file commits a structure, which opens a keep-or-revert review
 * card. Nothing here plays the user, so the card would still be awaiting an answer
 * when the next test commits — and the review store correctly refuses to stack a
 * second card on an unanswered one. Answering as the user between tests keeps each
 * test independent without weakening that guard.
 */
function answerPendingReviewAsUser() {
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
}

function structure(id: string, element: string): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: id,
    atoms: [{ id, element, position: [0, 0, 0] }],
  }
}

function testOriginComparison() {
  assertEqual(agentModelingOriginMismatch(origin, { ...origin }), null)
  assertEqual(
    agentModelingOriginMismatch(origin, { ...origin, viewportId: 'vp-2' }),
    'Active viewport changed from vp-1 to vp-2',
  )
  assertEqual(
    agentModelingOriginMismatch(origin, { ...origin, structureFingerprint: 'structure:b' }),
    'The active structure changed after this candidate was generated',
  )
  assertEqual(
    agentModelingOriginMismatch(origin, { ...origin, trajectoryFingerprint: null }),
    'The active trajectory changed after this candidate was generated',
  )
}

function testNestedReviewTargetsRemainIdentityBound() {
  const target = {
    id: 'state-review-target',
    reason: 'Inspect one state-conditioned member',
    center: [0, 0, 0] as [number, number, number],
    radius: 2,
    atomIds: ['state-atom'],
  }
  const targets = collectAgentInspectionTargets({
    stateVisualReviews: [
      { stateId: 'state-a', structureFingerprint: 'structure:state-a', inspectionTargets: [target] },
      { stateId: 'state-b', structureFingerprint: 'structure:state-b', inspectionTargets: [target] },
    ],
  })
  assertEqual(targets.length, 2)
  assertEqual(targets[0].id, target.id)
  assertEqual(targets[0].expectedStructureFingerprint, 'structure:state-a')
  assertEqual(targets[1].expectedStructureFingerprint, 'structure:state-b')
  assertTrue(agentModelingInspectionTargetKey(targets[0]) !== agentModelingInspectionTargetKey(targets[1]))
}

async function testChangedViewportContentBlocksApplication() {
  const before = structure('before', 'C')
  const replacement = structure('replacement', 'He')
  await writeActiveViewportStructure(before)
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'molecule_create_from_template')
  assertTrue(!!manifest)
  await useAgentModelingStore.getState().runTool(manifest!, { template: 'water' })
  assertTrue(useAgentModelingStore.getState().current?.candidate?.kind === 'structure')

  await writeActiveViewportStructure(replacement)
  await useAgentModelingStore.getState().applyCurrentCandidate(false)

  const state = useAgentModelingStore.getState()
  const active = readActiveViewportStructure()
  assertEqual(state.status, 'error')
  assertTrue(state.current?.result.checks?.some((check) => check.id === 'candidate.origin_identity' && check.status === 'fail') === true)
  assertEqual(fingerprintStructure(active!), fingerprintStructure(replacement))
}

async function testVerifiedCandidateRevisionUndoRedo() {
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'revision origin',
    lattice: { vectors: [[9, 0, 0], [0, 10, 0], [0, 0, 3]], periodic: [false, false, true] },
    atoms: [{
      id: 'revision-origin',
      element: 'C',
      position: [1, 2, 0],
      properties: { residue: { name: 'ORG', index: 4 }, formalCharge: 0 },
    }],
    metadata: { provenance: { engine: 'origin-fixture' } },
  }
  const beforeTrajectory: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['revision-origin'],
    coordinateMode: 'unwrapped-cartesian',
    lattice: before.lattice,
    metadata: { ensemble: 'origin' },
    frames: [
      { step: 0, timePs: 0, positions: [[1.05, 2, 0]] },
      { step: 1, timePs: 0.001, positions: [[1, 2, 0]] },
    ],
  }
  await writeActiveViewportStructure(before)
  await writeActiveViewportTrajectory(beforeTrajectory)
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'molecule_create_from_template')!
  await useAgentModelingStore.getState().runTool(manifest, { template: 'water' })
  await useAgentModelingStore.getState().applyCurrentCandidate(false)
  const applied = useAgentModelingStore.getState().current!
  assertTrue(!!applied.workspaceRevision)
  assertEqual(useAgentModelingStore.getState().workspaceRevisionPosition, 'after')
  assertEqual(applied.workspaceRevision?.before.structureFingerprint, fingerprintStructure(before))
  assertEqual(applied.workspaceRevision?.before.trajectoryFingerprint, fingerprintTrajectory(beforeTrajectory))
  assertEqual(applied.workspaceRevision?.after.structureFingerprint, fingerprintStructure(applied.candidate!.kind === 'structure' ? applied.candidate!.structure : before))
  assertEqual(applied.workspaceRevision?.after.trajectoryFingerprint, null)
  assertEqual(parseAgentModelingRunArtifact(composeAgentModelingRunArtifact(applied)).workspaceRevision?.fingerprint, applied.workspaceRevision?.fingerprint)

  assertTrue(await useAgentModelingStore.getState().restoreCurrentWorkspaceRevision('undo'))
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  assertEqual(fingerprintTrajectory(readActiveViewportTrajectory()!), fingerprintTrajectory(beforeTrajectory))
  assertEqual(useAgentModelingStore.getState().workspaceRevisionPosition, 'before')

  assertTrue(await useAgentModelingStore.getState().restoreCurrentWorkspaceRevision('redo'))
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), applied.workspaceRevision?.after.structureFingerprint)
  assertEqual(readActiveViewportTrajectory(), null)
  assertEqual(useAgentModelingStore.getState().workspaceRevisionPosition, 'after')

  const drift = structure('revision-drift', 'Ne')
  await writeActiveViewportStructure(drift)
  assertEqual(await useAgentModelingStore.getState().restoreCurrentWorkspaceRevision('undo'), false)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(drift))
  assertEqual(useAgentModelingStore.getState().workspaceRevisionPosition, 'diverged')
}

async function testFailedCandidateWriteRollsBackCanonicalWorkspace() {
  const before = structure('rollback-origin', 'Si')
  await writeActiveViewportStructure(before)
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'molecule_create_from_template')!
  await useAgentModelingStore.getState().runTool(manifest, { template: 'methane' })
  const originalWrite = activeViewportToolContext.writeStructure!
  activeViewportToolContext.writeStructure = async (value) => {
    await originalWrite(value)
    throw new Error('injected post-write failure')
  }
  try {
    await useAgentModelingStore.getState().applyCurrentCandidate(false)
  } finally {
    activeViewportToolContext.writeStructure = originalWrite
  }
  const failed = useAgentModelingStore.getState().current!
  assertEqual(useAgentModelingStore.getState().status, 'error')
  assertEqual(failed.workspaceRevision, null)
  assertTrue(failed.result.checks?.some((check) => (
    check.id === 'workspace.transaction_rollback' && check.status === 'pass'
  )) === true)
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
}

async function testDirectWorkspaceWriteCreatesRevision() {
  const before = structure('direct-before', 'Al')
  const after = structure('direct-after', 'Cu')
  await writeActiveViewportStructure(before)
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'workspace_set_active_structure')!
  await useAgentModelingStore.getState().runTool(manifest, {
    structure: after,
    captureAfter: false,
  })
  const run = useAgentModelingStore.getState().current!
  assertEqual(run.candidate, null)
  assertTrue(!!run.workspaceRevision)
  assertEqual(run.workspaceRevision?.before.structureFingerprint, fingerprintStructure(before))
  assertEqual(run.workspaceRevision?.after.structureFingerprint, fingerprintStructure(after))
  assertTrue(await useAgentModelingStore.getState().restoreCurrentWorkspaceRevision('undo'))
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(before))
  assertTrue(await useAgentModelingStore.getState().restoreCurrentWorkspaceRevision('redo'))
  assertEqual(fingerprintStructure(readActiveViewportStructure()!), fingerprintStructure(after))
}

async function testOnlyVerifiedWorkspaceTargetsCanFocus() {
  await writeActiveViewportStructure(structure('origin', 'C'))
  const moleculeManifest = listZatomAgentTools().find((tool) => tool.name === 'molecule_create_from_template')!
  await useAgentModelingStore.getState().runTool(moleculeManifest, { template: 'water' })
  const preview = useAgentModelingStore.getState().current!
  const target = collectAgentInspectionTargets(preview.result)[0]
  assertTrue(!!target)
  assertEqual(agentModelingVisualBinding(preview, target), null)

  await useAgentModelingStore.getState().applyCurrentCandidate(false)
  const applied = useAgentModelingStore.getState().current!
  const binding = agentModelingVisualBinding(applied, target)
  assertTrue(!!binding?.expectedStructureFingerprint)
  assertEqual(agentModelingVisualBinding(applied, {
    ...target,
    expectedStructureFingerprint: 'fnv1a64:wrong-structure',
  }), null)

  useAgentModelingStore.setState({
    current: {
      ...applied,
      targetEvidenceBundle: [{
        target,
        image: { imageBase64: 'cHJldmlvdXM=', mimeType: 'image/jpeg', width: 2, height: 2 },
        checks: [],
        summary: 'previous evidence',
        structureFingerprint: binding!.expectedStructureFingerprint,
        capturedAt: Date.now(),
      }],
    },
  })
  await writeActiveViewportStructure(structure('stale', 'N'))
  assertEqual(await useAgentModelingStore.getState().focusCurrentTarget(target), false)
  assertEqual(useAgentModelingStore.getState().current?.targetEvidenceBundle.length, 1)
  assertTrue(useAgentModelingStore.getState().visualError?.includes('does not match expected') === true)

  const validateManifest = listZatomAgentTools().find((tool) => tool.name === 'structure_validate')!
  await useAgentModelingStore.getState().runTool(validateManifest, {
    structure: {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        { id: 'explicit-a', element: 'H', position: [0, 0, 0] },
        { id: 'explicit-b', element: 'H', position: [0.4, 0, 0] },
      ],
    },
  })
  const explicit = useAgentModelingStore.getState().current!
  const explicitTarget = collectAgentInspectionTargets(explicit.result)[0]
  assertTrue(!!explicitTarget)
  assertEqual(agentModelingVisualBinding(explicit, explicitTarget), null)
}

async function testEvidenceBundleAndHistoryReopen() {
  const inspected: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'a', element: 'C', position: [0, 0, 0] },
      { id: 'b', element: 'C', position: [1, 0, 0] },
      { id: 'c', element: 'C', position: [1, 1, 0] },
    ],
  }
  await writeActiveViewportStructure(inspected)
  useAgentModelingStore.setState({
    status: 'idle',
    runningTool: null,
    current: null,
    history: [],
    focusingTargetKey: null,
    visualError: null,
  })
  const originalFocus = activeViewportToolContext.focusInspectionTarget
  const originalCapture = activeViewportToolContext.captureViewport
  let captureCount = 0
  activeViewportToolContext.focusInspectionTarget = async () => null
  activeViewportToolContext.captureViewport = async () => ({
    imageBase64: Buffer.from(`evidence-${++captureCount}`).toString('base64'),
    mimeType: 'image/jpeg',
    width: 4,
    height: 3,
  })
  try {
    const geometryManifest = listZatomAgentTools().find((tool) => tool.name === 'structure_measure_geometry')!
    await useAgentModelingStore.getState().runTool(geometryManifest, {
      measurements: [
        { id: 'ab', kind: 'distance', atomIds: ['a', 'b'], periodic: false },
        { id: 'abc', kind: 'angle', atomIds: ['a', 'b', 'c'], periodic: false },
      ],
    })
    const targets = collectAgentInspectionTargets(useAgentModelingStore.getState().current?.result)
    assertEqual(targets.length, 2)
    assertTrue(await useAgentModelingStore.getState().focusCurrentTarget(targets[0]))
    assertTrue(await useAgentModelingStore.getState().focusCurrentTarget(targets[1]))
    const inspectedRun = useAgentModelingStore.getState().current!
    assertEqual(inspectedRun.targetEvidenceBundle.length, 2)
    const firstTargetKey = agentModelingInspectionTargetKey(targets[0])
    const firstEvidence = inspectedRun.targetEvidenceBundle.find((item) => (
      agentModelingInspectionTargetKey(item.target) === firstTargetKey
    ))!
    assertTrue(await useAgentModelingStore.getState().focusCurrentTarget(targets[0]))
    const recapturedRun = useAgentModelingStore.getState().current!
    assertEqual(recapturedRun.targetEvidenceBundle.length, 2)
    const recapturedFirst = recapturedRun.targetEvidenceBundle.find((item) => (
      agentModelingInspectionTargetKey(item.target) === firstTargetKey
    ))!
    assertTrue(recapturedFirst.capturedAt >= firstEvidence.capturedAt)
    assertTrue(recapturedFirst.image.imageBase64 !== firstEvidence.image.imageBase64)
    const artifact = composeAgentModelingRunArtifact(recapturedRun)
    assertEqual(artifact.schemaVersion, 'zatom.agent-modeling-run/v2')
    assertEqual(artifact.targetEvidenceBundle.length, 2)
    assertTrue(artifact.fingerprint.startsWith('fnv1a64:'))
    assertEqual(composeAgentModelingRunArtifact(recapturedRun).fingerprint, artifact.fingerprint)
    assertEqual(parseAgentModelingRunArtifact(artifact).runId, recapturedRun.id)
    let fingerprintError: unknown = null
    try {
      parseAgentModelingRunArtifact({ ...artifact, durationMs: artifact.durationMs + 1 })
    } catch (error) {
      fingerprintError = error
    }
    assertTrue(fingerprintError instanceof AgentModelingRunArtifactError)
    assertEqual((fingerprintError as AgentModelingRunArtifactError).code, 'agent_run_fingerprint_mismatch')

    const archivedRunId = recapturedRun.id
    const validateManifest = listZatomAgentTools().find((tool) => tool.name === 'structure_validate')!
    await useAgentModelingStore.getState().runTool(validateManifest, {})
    assertTrue(useAgentModelingStore.getState().current?.id !== archivedRunId)
    assertTrue(useAgentModelingStore.getState().openHistoryRun(archivedRunId))
    assertEqual(useAgentModelingStore.getState().current?.id, archivedRunId)
    assertEqual(useAgentModelingStore.getState().current?.targetEvidenceBundle.length, 2)
  } finally {
    activeViewportToolContext.focusInspectionTarget = originalFocus
    activeViewportToolContext.captureViewport = originalCapture
  }
}

function testEvidenceUpsertUsesBoundTargetIdentity() {
  const base = {
    target: {
      id: 'same-id',
      reason: 'first structure',
      center: [0, 0, 0] as [number, number, number],
      radius: 1,
      atomIds: ['a'],
      expectedStructureFingerprint: 'structure:a',
    },
    image: { imageBase64: 'YQ==', mimeType: 'image/jpeg', width: 1, height: 1 },
    checks: [],
    summary: 'first',
    structureFingerprint: 'structure:a',
    capturedAt: 1,
  }
  const secondIdentity = {
    ...base,
    target: { ...base.target, expectedStructureFingerprint: 'structure:b' },
    structureFingerprint: 'structure:b',
    capturedAt: 2,
  }
  const replaced = { ...base, capturedAt: 3 }
  const two = upsertAgentModelingTargetEvidence([base], secondIdentity)
  assertEqual(two.length, 2)
  const stillTwo = upsertAgentModelingTargetEvidence(two, replaced)
  assertEqual(stillTwo.length, 2)
  assertEqual(stillTwo[0].capturedAt, 3)
  assertEqual(stillTwo[1].structureFingerprint, 'structure:b')
}

async function testMalformedDeclaredCandidateFailsClosed() {
  const manifest: ZatomToolManifest = {
    name: 'test_invalid_candidate_output',
    title: 'Invalid candidate fixture',
    version: '1.0.0',
    description: 'Return a malformed candidate to verify the Workbench output boundary.',
    inputSchema: { type: 'object', additionalProperties: false },
    effects: { structure: 'create', workspace: 'write', visual: 'none' },
    tags: ['test'],
  }
  const unregister = registerZatomAgentTool({
    manifest,
    execute: async () => ({
      ok: true,
      tool: manifest.name,
      summary: 'Malformed fixture candidate',
      data: {
        result: {
          structure: {
            schemaVersion: ZATOM_STRUCTURE_SCHEMA,
            atoms: [{ id: 'bad', element: 'C', position: [0, 0, 0], unsupported: true }],
          },
          checks: [],
        },
      },
    }),
  })
  try {
    await useAgentModelingStore.getState().runTool(manifest, {})
    const state = useAgentModelingStore.getState()
    assertEqual(state.status, 'error')
    assertEqual(state.current?.candidate, null)
    assertEqual(state.current?.result.error?.code, 'invalid_tool_candidate_output')
    assertTrue(state.current?.result.checks?.some((check) => (
      check.id === 'candidate.output_contract' && check.status === 'fail'
    )) === true)
  } finally {
    unregister()
  }
}

async function main() {
  testOriginComparison()
  testNestedReviewTargetsRemainIdentityBound()
  testEvidenceUpsertUsesBoundTargetIdentity()
  await testChangedViewportContentBlocksApplication()
  answerPendingReviewAsUser()
  await testVerifiedCandidateRevisionUndoRedo()
  answerPendingReviewAsUser()
  await testFailedCandidateWriteRollsBackCanonicalWorkspace()
  answerPendingReviewAsUser()
  await testDirectWorkspaceWriteCreatesRevision()
  answerPendingReviewAsUser()
  await testOnlyVerifiedWorkspaceTargetsCanFocus()
  answerPendingReviewAsUser()
  await testEvidenceBundleAndHistoryReopen()
  answerPendingReviewAsUser()
  await testMalformedDeclaredCandidateFailsClosed()
  console.log('agent modeling origin tests passed')
}

void main()
