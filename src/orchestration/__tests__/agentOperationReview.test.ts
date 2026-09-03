/**
 * Behavioral tests for agent-operation review and user takeover.
 *
 * They protect three required behaviors rather than implementation details:
 *  1. Reverting leaves a takeover note that is consumed exactly once; otherwise
 *     the agent treats every later turn as a fresh rejection.
 *  2. Keeping a change leaves no takeover note; approval is not rejection.
 *  3. The takeover note reaches viewport_describe's summary, which is how the
 *     agent receives it; placing it only in data would not deliver it.
 */

import { assertEqual, assertTrue, assertThrows } from '../../testing/assert'
import {
  useAgentOperationReview,
  readAgentTakeoverNote,
  setReviewHistoryIndexReader,
  selectPendingReview,
  selectManualControl,
} from '../agentOperationReviewStore'
import { summarizeViewportForTest } from '../../agent/viewport-tools'
import { useAgentProposalStore } from '../agentProposalStore'
import { useAgentGuidance } from '../agentGuidanceStore'
import { ZATOM_STRUCTURE_SCHEMA } from '../../agent/contracts'

function reset() {
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  useAgentProposalStore.setState({ current: null, history: [] })
  useAgentGuidance.getState().clear('all')
}

async function testPendingCandidateDecisionBlocksWorkspaceMutation() {
  reset()
  useAgentGuidance.getState().setCandidates({
    id: 'candidate-before-write',
    label: 'Which surface atom?',
    items: [{
      index: 1,
      atomIds: ['a'],
      position: [0, 0, 0],
      anchorPositions: [],
      label: 'site A',
      detail: null,
      viewportKey: {},
    }],
    focusedIndex: null,
    decision: { status: 'pending', index: null, at: null },
    viewportKey: {},
    viewportId: 'vp-1',
    workspaceRevision: 1,
    selectionBefore: [],
  })
  let blocked: unknown = null
  try {
    await (await import('../agentOperationReviewStore')).assertAgentMayMutateWorkspace('apply a structure change')
  } catch (error) {
    blocked = error
  }
  assertTrue(blocked instanceof Error, 'an unanswered candidate question must block workspace writes')
  assertTrue((blocked as Error).message.includes('Confirm or Cancel'))

  useAgentGuidance.getState().resolveCandidate({ status: 'confirmed', index: 1, at: Date.now() })
  await (await import('../agentOperationReviewStore')).assertAgentMayMutateWorkspace('apply the confirmed choice')
}

function testPendingProposalAndReviewCannotCoexist() {
  reset()
  const proposal = useAgentProposalStore.getState().propose({
    id: 'exclusive-decision',
    intent: 'preview one change',
    baseFingerprint: 'base',
    viewportId: 'vp-1',
    workspaceRevision: 1,
    viewportKey: {},
    candidate: {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'a', element: 'C', position: [0, 0, 0] }],
    },
    diff: { added: [], removed: [], moved: [], addedCount: 0, removedCount: 0, movedCount: 0, summary: 'preview', bounds: null },
  })
  assertThrows(() => useAgentOperationReview.getState().openReview({
    label: 'must not coexist',
    subject: { kind: 'structure', atomDelta: 0, revert: () => undefined },
  }))
  assertEqual(pendingReview(), null)
  assertEqual(useAgentProposalStore.getState().current?.id, proposal.id)
  useAgentProposalStore.getState().resolve(proposal.id, 'discarded')
}

const pendingReview = () => selectPendingReview(useAgentOperationReview.getState())
const manualControl = () => selectManualControl(useAgentOperationReview.getState())

function testRevertLeavesTakeoverNoteDeliveredExactlyOnce() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  assertEqual(pendingReview()?.label, 'Supercell 2x2x1')

  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertEqual(pendingReview(), null)

  assertEqual(readAgentTakeoverNote()?.revertedLabel, 'Supercell 2x2x1')
  // Reading consumes the note, so later turns do not repeat the same concession.
  assertEqual(readAgentTakeoverNote(), null)
}

/**
 * The takeover gate must authorize by **risk tier**, not call path.
 *
 * This is why assertAgentMayMutateWorkspace is shared. A check embedded only in
 * commit lets layout-mutating calls such as viewport-set-layout and viewport-mount
 * bypass takeover, allowing the agent to rearrange viewports after the user takes control.
 *
 * Reads must remain allowed during takeover so the agent can observe manual edits
 * and resume from the actual state when control returns.
 */
async function testTakeoverBlocksMutationsButNotReads() {
  reset()
  const { assertAgentMayMutateWorkspace } = await import('../agentOperationReviewStore')

  // Mutations pass when there is no takeover; the default cannot block all agent work.
  await assertAgentMayMutateWorkspace('replace the active structure')

  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertTrue(manualControl() !== null, 'takeover should be recorded')

  // During takeover, mutations throw with the blocked intent so the agent knows
  // which step was rejected and that it must wait for control to be returned.
  for (const intent of [
    'replace the active structure',
    'change the viewport layout',
    'mount structures into the viewport',
  ]) {
    let blocked: unknown = null
    try {
      await assertAgentMayMutateWorkspace(intent)
    } catch (error) {
      blocked = error
    }
    assertTrue(blocked instanceof Error, `${intent} should be blocked during takeover`)
    const message = (blocked as Error).message
    assertTrue(message.includes(intent), `error should name the blocked intent: ${message}`)
    assertTrue(
      message.includes('resume the agent'),
      `error should tell the agent how to recover: ${message}`,
    )
  }

  // Writes resume immediately when control is returned; Resume is a real exit from takeover.
  useAgentOperationReview.getState().resumeAgent()
  assertEqual(manualControl(), null)
  await assertAgentMayMutateWorkspace('replace the active structure')
}

/**
 * Regression: the second write is waiting for the first review. Choosing
 * "Revert & I'll do it" removes that review and wakes the waiter, but it also
 * enters manual control. The waiter must re-check the new phase and reject;
 * otherwise it lands on top of the user's takeover.
 */
async function testQueuedMutationCannotCrossIntoManualControl() {
  reset()
  const { assertAgentMayMutateWorkspace } = await import('../agentOperationReviewStore')
  useAgentOperationReview.getState().openReview({
    label: 'First operation',
    subject: { kind: 'structure', atomDelta: 1, revert: () => undefined },
  })

  const queued = assertAgentMayMutateWorkspace('apply the queued second operation')
  await Promise.resolve()
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')

  let blocked: unknown = null
  try {
    await queued
  } catch (error) {
    blocked = error
  }
  assertTrue(blocked instanceof Error, 'queued mutation must reject after takeover')
  assertTrue(
    (blocked as Error).message.includes('resume the agent'),
    `queued mutation needs an actionable takeover error: ${(blocked as Error).message}`,
  )
}

function testKeepingTheResultLeavesNoTakeoverNote() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Slab (111)', subject: { kind: 'structure', atomDelta: -8, revert: () => undefined } })
  useAgentOperationReview.getState().dismissReview()

  assertEqual(pendingReview(), null)
  assertEqual(readAgentTakeoverNote(), null)
}

/**
 * Control phases are mutually exclusive. The discriminated union prevents pending
 * review and manual control from coexisting, which would make Keep/Revert target a
 * structure the user has already taken over.
 *
 * Opening a review across either boundary must throw an actionable error rather
 * than overwrite state; reaching it means the agent commit gate was bypassed.
 */
function testOpeningAReviewOverAnUnansweredOneIsRejected() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  assertThrows(() => {
    useAgentOperationReview.getState().openReview({ label: 'Slab (111)', subject: { kind: 'structure', atomDelta: -8, revert: () => undefined } })
  })
  // Preserve the original card and the exact version the user is reviewing.
  assertEqual(pendingReview()?.label, 'Supercell 2x2x1')
}

function testOpeningAReviewDuringManualControlIsRejected() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')

  assertThrows(() => {
    useAgentOperationReview.getState().openReview({ label: 'Vacuum 15 A', subject: { kind: 'structure', atomDelta: 0, revert: () => undefined } })
  })
  // Manual control remains active instead of being replaced by a new card.
  assertEqual(manualControl()?.revertedLabel, 'Supercell 2x2x1')
  assertEqual(pendingReview(), null)
}

/**
 * User-driven answer transitions may repeat after double-clicks or rerenders, so
 * they must be idempotent. A phase mismatch is ignored and cannot turn idle into
 * manual control.
 */
function testAnswersAreIdempotentOutsideTheirPhase() {
  reset()
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertEqual(manualControl(), null, 'idle 下回退不该凭空造出接管态')

  useAgentOperationReview.getState().dismissReview()
  assertEqual(pendingReview(), null)

  useAgentOperationReview.getState().openReview({ label: 'Slab (111)', subject: { kind: 'structure', atomDelta: -8, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertEqual(manualControl()?.revertedLabel, 'Slab (111)', '重复回退不该改写接管来源')
}

function testTakeoverNoteReachesTheDescribeSummary() {
  const slot = {
    slotId: 'slot-0',
    slotIndex: 0,
    kind: 'crystal',
    label: null,
    structureLabel: 'NaCl',
    atomCount: 8,
    active: true,
  }
  const base = { instanceId: 'app-test', layout: '1x1', availableLayouts: ['1x1'], slots: [slot] }

  const withTakeover = summarizeViewportForTest({
    ...base,
    userTakeover: { revertedLabel: 'Supercell 2x2x1', intent: 'user_took_over', at: Date.now() },
  })
  assertTrue(withTakeover.includes('reverted your last operation'))
  assertTrue(withTakeover.includes('Supercell 2x2x1'))

  assertTrue(!summarizeViewportForTest(base).includes('reverted'))

  // Each intent needs distinct guidance; a generic rejection can make the model
  // resubmit the exact action the user just rejected.
  const retry = summarizeViewportForTest({
    ...base,
    userTakeover: { revertedLabel: 'Slab (111)', intent: 'retry_differently', at: Date.now() },
  })
  assertTrue(retry.includes('different approach'), `retry 应要求换做法: ${retry}`)

  const replan = summarizeViewportForTest({
    ...base,
    userTakeover: { revertedLabel: 'Slab (111)', intent: 'replan_from_edits', at: Date.now() },
  })
  assertTrue(replan.includes('Re-read'), `replan 应要求重读现状: ${replan}`)

  // The takeover message must explicitly prohibit writes, not merely report manual editing.
  assertTrue(withTakeover.includes('Do not modify'), `停手应明确禁止写入: ${withTakeover}`)
}

/**
 * Snapshot historyIndex when opening the card to detect whether the structure is
 * still the agent's reviewed version. A missing index is null; it must never cause
 * the user's own edits to be undone.
 */
function testOpenReviewSnapshotsHistoryIndex() {
  reset()
  setReviewHistoryIndexReader(() => 7)
  useAgentOperationReview.getState().openReview({ label: 'Vacuum 15 A', subject: { kind: 'structure', atomDelta: 0, revert: () => undefined } })
  assertEqual(pendingReview()?.historyIndexAtOpen, 7)

  reset()
  setReviewHistoryIndexReader(() => null)
  useAgentOperationReview.getState().openReview({ label: 'Vacuum 15 A', subject: { kind: 'structure', atomDelta: 0, revert: () => undefined } })
  assertEqual(pendingReview()?.historyIndexAtOpen, null)
}

/**
 * Manual-control state and the takeover note have different lifetimes. The note
 * is consumed once, while manual control stays visible until the user returns
 * authority; consuming both together would remove the user's status and exit.
 */
function testManualControlOutlivesTheAgentFacingNote() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')

  assertEqual(manualControl()?.revertedLabel, 'Supercell 2x2x1')
  // Manual control survives note consumption, so the status bar remains visible.
  readAgentTakeoverNote()
  assertEqual(useAgentOperationReview.getState().takeover, null)
  assertEqual(manualControl()?.revertedLabel, 'Supercell 2x2x1')
}

/** Resume agent is the only exit from takeover; keeping an operation never enters it. */
function testResumeAgentIsTheOnlyExitFromManualControl() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Slab (111)', subject: { kind: 'structure', atomDelta: -8, revert: () => undefined } })
  useAgentOperationReview.getState().dismissReview()
  assertEqual(manualControl(), null)

  useAgentOperationReview.getState().openReview({ label: 'Vacuum 15 A', subject: { kind: 'structure', atomDelta: 0, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertTrue(manualControl() !== null)

  useAgentOperationReview.getState().resumeAgent()
  assertEqual(manualControl(), null)
}

/**
 * "Try a different approach" must not leave the user in manual control.
 *
 * Only "I'll do it" stops the agent. A retry request returns authority directly;
 * requiring a second hand-back click would introduce a meaningless intermediate state.
 */
function testRetryDifferentlyHandsControlStraightBack() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('retry_differently')

  // Return directly to idle so the agent can retry without another hand-back click.
  assertEqual(manualControl(), null, '换个做法不该进入接管态')
  assertEqual(pendingReview(), null)

  // Still deliver the intent so the agent does not resubmit the rejected approach.
  const note = readAgentTakeoverNote()
  assertEqual(note?.intent, 'retry_differently')
  assertEqual(note?.revertedLabel, 'Supercell 2x2x1')
}

/**
 * If the user edits during takeover, returning control must tell the agent to
 * reread current state and replan. The hand-back replaces the stale rejection note.
 */
function testResumeCarriesReplanIntent() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Slab (111)', subject: { kind: 'structure', atomDelta: -8, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  // The agent has consumed the initial takeover note.
  readAgentTakeoverNote()

  useAgentOperationReview.getState().resumeAgent('replan_from_edits')
  assertEqual(manualControl(), null)

  const note = readAgentTakeoverNote()
  assertEqual(note?.intent, 'replan_from_edits', '交还时的意图必须覆写旧记录')
  assertEqual(note?.revertedLabel, 'Slab (111)')
}

/**
 * Non-structure operations such as viewport layout changes must be reviewable.
 *
 * The discriminated subject must represent workspace changes without meaningless
 * structure-only fields such as atomDelta.
 *
 * Workspace changes do not enter structure history, so rollback must use the
 * closure captured by the initiating caller; otherwise Revert would close the
 * card without restoring the layout.
 */
function testWorkspaceReviewRevertsThroughItsOwnClosure() {
  reset()
  let restored = 0
  useAgentOperationReview.getState().openReview({
    label: '切换为 2×2 分屏',
    subject: { kind: 'workspace', summary: '1×1 → 2×2', revert: () => { restored += 1 } },
  })

  const review = pendingReview()
  assertEqual(review?.subject.kind, 'workspace', '分屏变化必须能进复核卡')
  // Structure-only fields must not exist on a workspace subject.
  assertEqual('atomDelta' in (review?.subject ?? {}), false, '工作区复核不该带原子增量')

  // The card invokes the closure; verify it is reachable and called exactly once.
  const subject = review?.subject
  if (subject?.kind === 'workspace') subject.revert()
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')
  assertEqual(restored, 1, '工作区回退必须经由发起方闭包还原')
  assertEqual(manualControl()?.revertedLabel, '切换为 2×2 分屏')
}

/**
 * "Preview only" is the only exit that is **not a rejection**.
 *
 * The user may inspect a result and revert it without objecting to the approach.
 * Treating that as takeover or rejection would either stop the agent or make it
 * alter a proposal that was never rejected.
 */
function testPreviewOnlyIsNotARejection() {
  reset()
  useAgentOperationReview.getState().openReview({ label: 'Supercell 3x3x1', subject: { kind: 'structure', atomDelta: 54, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('preview_only')

  // Do not enter takeover; the user did not request control and the plan can continue.
  assertEqual(manualControl(), null, '「只看结果」不该进入接管态')
  assertEqual(pendingReview(), null)

  const note = readAgentTakeoverNote()
  assertEqual(note?.intent, 'preview_only')

  // Agent-facing text must state that this is not a rejection.
  const summary = summarizeViewportForTest({
    instanceId: 'vp-1',
    layout: '1x1',
    slots: [{ slotIndex: 0, structureLabel: 'Pt', atomCount: 4 }],
    userTakeover: { revertedLabel: 'Supercell 3x3x1', intent: 'preview_only', at: Date.now() },
  } as Parameters<typeof summarizeViewportForTest>[0])
  assertEqual(summary.includes('not a rejection'), true, '预览摘要必须声明这不是否决')
  assertEqual(summary.includes('undefined'), false, '未覆盖的意图会让摘要出现 undefined')
}

/**
 * Batch-tool gating must follow the **manifest-declared level**, not a tool-name list.
 *
 * assets_create_batch, rename_batch, and move_frames declare workspace:'write'.
 * They must not bypass takeover merely because they reorganize assets instead of
 * atom coordinates; they still mutate the workspace the user is editing.
 *
 * Conversely, the read-only assets_list_batches must remain available during
 * takeover so the agent can observe the user's reorganization.
 */
async function testAssetsBatchToolsRespectTakeoverByDeclaredLevel() {
  reset()
  const { VIEWPORT_ZATOM_AGENT_TOOLS } = await import('../../agent/viewport-tools')

  const byName = new Map(VIEWPORT_ZATOM_AGENT_TOOLS.map((tool) => [tool.manifest.name, tool]))
  const batches = [{ id: 'b1', name: 'Run 1', active: true, frameIds: ['f1'] }]
  // Every call reaching this asset surface succeeds, so any block must come from
  // the gate rather than an unrelated failure.
  const context = {
    assets: {
      listBatches: async () => batches,
      createBatch: async () => batches,
      renameBatch: async () => batches,
      moveFrames: async () => batches,
    },
  } as never

  const writeCalls: [string, Record<string, unknown>][] = [
    ['assets_create_batch', { name: 'Run 2' }],
    ['assets_rename_batch', { batchId: 'b1', name: 'Renamed' }],
    ['assets_move_frames', { frameIds: ['f1'], toBatchId: 'b1' }],
  ]

  // With no takeover, all three write tools succeed; the gate cannot block by default.
  for (const [name, input] of writeCalls) {
    const result = await byName.get(name)!.execute(input, context)
    assertTrue(result.ok, `${name} should succeed with no takeover`)
  }

  useAgentOperationReview.getState().openReview({ label: 'Supercell 2x2x1', subject: { kind: 'structure', atomDelta: 24, revert: () => undefined } })
  useAgentOperationReview.getState().revertAndTakeOver('user_took_over')

  for (const [name, input] of writeCalls) {
    const result = await byName.get(name)!.execute(input, context)
    assertTrue(!result.ok, `${name} must be blocked during takeover`)
    const message = JSON.stringify(result)
    assertTrue(
      message.includes('resume the agent'),
      `${name} error should tell the agent how to recover: ${message}`,
    )
  }

  // Reads remain allowed.
  const listed = await byName.get('assets_list_batches')!.execute({}, context)
  assertTrue(listed.ok, 'assets_list_batches must stay allowed during takeover')

  useAgentOperationReview.getState().resumeAgent()
  const afterResume = await byName.get('assets_create_batch')!.execute({ name: 'Run 3' }, context)
  assertTrue(afterResume.ok, 'writes must resume after the user hands control back')
}

async function main() {
  testRevertLeavesTakeoverNoteDeliveredExactlyOnce()
  testRetryDifferentlyHandsControlStraightBack()
  testResumeCarriesReplanIntent()
  testKeepingTheResultLeavesNoTakeoverNote()
  testOpeningAReviewOverAnUnansweredOneIsRejected()
  testOpeningAReviewDuringManualControlIsRejected()
  testPendingProposalAndReviewCannotCoexist()
  testAnswersAreIdempotentOutsideTheirPhase()
  testTakeoverNoteReachesTheDescribeSummary()
  testOpenReviewSnapshotsHistoryIndex()
  testManualControlOutlivesTheAgentFacingNote()
  testResumeAgentIsTheOnlyExitFromManualControl()
  testWorkspaceReviewRevertsThroughItsOwnClosure()
  testPreviewOnlyIsNotARejection()
  await testTakeoverBlocksMutationsButNotReads()
  await testQueuedMutationCannotCrossIntoManualControl()
  await testPendingCandidateDecisionBlocksWorkspaceMutation()
  await testAssetsBatchToolsRespectTakeoverByDeclaredLevel()
  console.log('agent operation review / user takeover tests passed')
}

await main()
