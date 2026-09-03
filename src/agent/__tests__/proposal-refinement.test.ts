import { beforeEach, describe, expect, it } from 'vitest'

import { selectPendingReview, useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import { useAgentProposalStore } from '../../orchestration/agentProposalStore'
import { useAgentGuidance } from '../../orchestration/agentGuidanceStore'
import { abortChoreography, awaitChoreographyIdle } from '../../orchestration/modelingChoreographer'
import { useViewportManager } from '../../orchestration/viewportManager'
import { buildStructureChangeSet } from '../operations'
import { fingerprintStructure } from '../structure-math'
import { executeZatomAgentTool } from '../tools'
import { activeViewportGuidanceSurface } from '../guidance-surface'
import {
  activeViewportToolContext,
  applyPendingProposal,
  readActiveViewportStructure,
  readActiveViewportWorkspaceIdentity,
  writeActiveViewportStructure,
} from '../viewer-context'
import { ZATOM_STRUCTURE_SCHEMA, type ProposalSnapshot, type ZatomStructure } from '../contracts'

const base: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'surface baseline',
  atoms: [{ id: 'surface-Cu', element: 'Cu', position: [0, 0, 0] }],
}

const waterGhost: ZatomStructure = {
  ...base,
  label: 'water adsorption preview',
  atoms: [
    ...base.atoms,
    { id: 'water-O', element: 'O', position: [0, 0, 3] },
    { id: 'water-H1', element: 'H', position: [0.96, 0, 3] },
    { id: 'water-H2', element: 'H', position: [-0.24, 0.93, 3] },
  ],
  bonds: [
    { id: 'water-O-H1', atomIds: ['water-O', 'water-H1'], order: 1 },
    { id: 'water-O-H2', atomIds: ['water-O', 'water-H2'], order: 1 },
  ],
}

function refinementInput(proposal: ProposalSnapshot) {
  return {
    proposalId: proposal.id,
    expectedPreviewRevision: proposal.previewRevision,
    expectedCandidateFingerprint: proposal.candidateFingerprint,
    componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
    anchorAtomId: 'water-O',
    directionAtomIds: ['water-H1'],
    target: { kind: 'vector', vector: [0, 0, 1] },
    applyToWorkspace: true,
  }
}

describe('pending proposal refinement', () => {
  beforeEach(async () => {
    abortChoreography()
    await awaitChoreographyIdle()
    useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
    useAgentProposalStore.setState({ current: null, history: [] })
    useAgentGuidance.getState().clear('all')
    useViewportManager.getState().setLayout('1x1')
    useViewportManager.getState().setActive('vp-1')
    await writeActiveViewportStructure(base)
  })

  it('revises one ghost in place and applies only the final candidate', async () => {
    const identity = readActiveViewportWorkspaceIdentity()
    const original = await activeViewportToolContext.proposal!.propose({
      intent: 'Place water above copper',
      baseFingerprint: identity.structureFingerprint,
      viewportId: identity.viewportId,
      workspaceRevision: identity.revision,
      candidate: waterGhost,
      changeSet: buildStructureChangeSet(base, waterGhost),
    })
    const baselineFingerprint = fingerprintStructure(readActiveViewportStructure()!)

    const refined = await executeZatomAgentTool(
      'structure_pose_component',
      refinementInput(original),
      { ...activeViewportToolContext, expectedWorkspace: identity },
    )
    expect(refined.ok).toBe(true)
    const revised = (refined.data as { proposal: ProposalSnapshot }).proposal
    expect(revised.id).toBe(original.id)
    expect(revised.previewRevision).toBe(original.previewRevision + 1)
    expect(revised.candidateFingerprint).not.toBe(original.candidateFingerprint)
    expect(revised.workspaceRevision).toBe(original.workspaceRevision)
    expect(revised.baseFingerprint).toBe(original.baseFingerprint)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(baselineFingerprint)
    expect(useAgentProposalStore.getState().current?.diff.addedCount).toBe(3)

    const status = await executeZatomAgentTool(
      'structure_proposal_status',
      { proposalId: revised.id },
      activeViewportToolContext,
    )
    expect(status.data).toMatchObject({
      proposalId: revised.id,
      previewRevision: revised.previewRevision,
      candidateFingerprint: revised.candidateFingerprint,
    })

    const stale = await executeZatomAgentTool(
      'structure_pose_component',
      refinementInput(original),
      { ...activeViewportToolContext, expectedWorkspace: identity },
    )
    expect(stale.ok).toBe(false)
    expect(stale.error?.code).toBe('stale_proposal_preview')
    expect(useAgentProposalStore.getState().current?.previewRevision).toBe(revised.previewRevision)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(baselineFingerprint)

    const finalCandidate = structuredClone(useAgentProposalStore.getState().current!.candidate)
    const applying = useAgentProposalStore.getState().claim(revised.id)
    expect(applying?.status).toBe('applying')
    const tooLate = await executeZatomAgentTool(
      'structure_pose_component',
      refinementInput(revised),
      { ...activeViewportToolContext, expectedWorkspace: identity },
    )
    expect(tooLate.ok).toBe(false)
    expect(tooLate.error?.code).toBe('proposal_not_pending')
    useAgentProposalStore.getState().release(revised.id)

    const applied = await applyPendingProposal()
    expect(applied.ok).toBe(true)
    abortChoreography()
    await awaitChoreographyIdle()
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(fingerprintStructure(finalCandidate))
    expect(useAgentProposalStore.getState().current).toMatchObject({
      id: original.id,
      status: 'applied',
      previewRevision: revised.previewRevision,
      candidateFingerprint: revised.candidateFingerprint,
    })
    selectPendingReview(useAgentOperationReview.getState()) && useAgentOperationReview.getState().dismissReview()
  })

  it('does not publish a ghost before the user answers the current candidate question', () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['surface-Cu'], label: 'copper site' },
    ])
    const identity = readActiveViewportWorkspaceIdentity()
    expect(() => activeViewportToolContext.proposal!.propose({
      intent: 'Must wait for the site decision',
      baseFingerprint: identity.structureFingerprint,
      viewportId: identity.viewportId,
      workspaceRevision: identity.revision,
      candidate: waterGhost,
      changeSet: buildStructureChangeSet(base, waterGhost),
    })).toThrow(/still waiting for the user/i)
    expect(useAgentProposalStore.getState().current).toBeNull()
  })

  it('does not ask a new candidate question while a proposal decision is pending', async () => {
    const identity = readActiveViewportWorkspaceIdentity()
    const proposal = await activeViewportToolContext.proposal!.propose({
      intent: 'Review water placement',
      baseFingerprint: identity.structureFingerprint,
      viewportId: identity.viewportId,
      workspaceRevision: identity.revision,
      candidate: waterGhost,
      changeSet: buildStructureChangeSet(base, waterGhost),
    })
    expect(() => activeViewportGuidanceSurface.presentCandidates('Another decision?', [
      { atomIds: ['surface-Cu'], label: 'copper site' },
    ])).toThrow(/waiting for Apply or Discard/i)
    expect(useAgentGuidance.getState().candidates).toBeNull()
    await activeViewportToolContext.proposal!.withdraw(proposal.id)
  })
})
