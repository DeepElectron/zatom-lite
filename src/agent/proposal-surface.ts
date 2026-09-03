/**
 * WebMCP implementation of `ZatomProposalSurface` plus the viewport-card
 * apply/discard actions. Applying always uses the canonical commit path, which
 * enforces takeover and opens review. The baseline fingerprint is checked again
 * at apply time so a proposal cannot overwrite edits made while it was pending.
 */

import {
  AgentProposalRevisionError,
  toProposalSnapshot,
  useAgentProposalStore,
  type AgentProposal,
} from '../orchestration/agentProposalStore'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { useViewportManager } from '../orchestration/viewportManager'
import { useAgentOperationReview } from '../orchestration/agentOperationReviewStore'
import { useAgentGuidance } from '../orchestration/agentGuidanceStore'
import { readWorkspaceRevision } from '../orchestration/workspaceRevisionTracker'
import type { ProposalDiff, StructureChangeSet, ZatomProposalSurface } from './contracts'

let counter = 0
function nextProposalId(): string {
  counter += 1
  return `proposal-${Date.now().toString(36)}-${counter}`
}

function throwIfProposalCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Proposal operation was cancelled')
}

function assertProposalWorkspaceIsCurrent(proposal: AgentProposal): void {
  const manager = useViewportManager.getState()
  if (manager.activeViewportId !== proposal.viewportId) {
    throw new AgentProposalRevisionError(
      'workspace_conflict',
      `Proposal ${proposal.id} belongs to ${proposal.viewportId}, but ${manager.activeViewportId} is active. Re-observe before adjusting it.`,
    )
  }
  const viewportApi = getActiveViewportStoreApi()
  if ((viewportApi as unknown as object) !== proposal.viewportKey) {
    throw new AgentProposalRevisionError(
      'workspace_conflict',
      `Proposal ${proposal.id} is no longer attached to the active viewport store. Re-observe before adjusting it.`,
    )
  }
  const currentRevision = readWorkspaceRevision(viewportApi as never)
  if (currentRevision !== proposal.workspaceRevision) {
    throw new AgentProposalRevisionError(
      'workspace_conflict',
      `Proposal ${proposal.id} was based on ${proposal.viewportId}@r${proposal.workspaceRevision}, `
        + `but the active workspace is now r${currentRevision}. Re-observe and create a new proposal.`,
    )
  }
}

export function proposalDiffFromChangeSet(changeSet: StructureChangeSet): ProposalDiff {
  const addedCount = changeSet.addedCount ?? changeSet.added?.length ?? 0
  const removedCount = changeSet.removedCount ?? changeSet.removed?.length ?? 0
  const movedCount = changeSet.movedCount ?? changeSet.moved?.length ?? 0
  const parts: string[] = []
  if (addedCount) parts.push(`+${addedCount} atom${addedCount === 1 ? '' : 's'}`)
  if (removedCount) parts.push(`−${removedCount} atom${removedCount === 1 ? '' : 's'}`)
  if (movedCount) parts.push(`${movedCount} moved`)
  if (changeSet.relabeledCount) parts.push(`${changeSet.relabeledCount} relabeled`)
  if (changeSet.latticeChanged) parts.push('lattice changed')
  const bondChanges = (changeSet.addedBondCount ?? 0) + (changeSet.removedBondCount ?? 0) + (changeSet.changedBondCount ?? 0)
  if (bondChanges) parts.push(`${bondChanges} bond change${bondChanges === 1 ? '' : 's'}`)
  return {
    added: changeSet.added ?? [],
    removed: changeSet.removed ?? [],
    moved: changeSet.moved ?? [],
    addedCount,
    removedCount,
    movedCount,
    summary: parts.length ? parts.join(', ') : 'no atom changes',
    bounds: changeSet.changedBounds ? { center: changeSet.changedBounds.center, radius: changeSet.changedBounds.radius } : null,
  }
}

export const activeViewportProposalSurface: ZatomProposalSurface = {
  propose: ({
    intent, baseFingerprint, viewportId, workspaceRevision, candidate, changeSet,
    checks = [], inspectionTargets = [], signal,
  }) => {
    throwIfProposalCancelled(signal)
    const candidateDecision = useAgentGuidance.getState().candidates
    if (candidateDecision?.decision.status === 'pending') {
      throw new AgentProposalRevisionError(
        'candidate_decision_pending',
        `Candidate set ${candidateDecision.id} is still waiting for the user. Confirm or cancel that choice before proposing a structure change.`,
      )
    }
    const operationState = useAgentOperationReview.getState()
    const control = operationState.control
    if (control.phase === 'awaiting_review') {
      throw new Error(
        `The user is still reviewing "${control.review.label}". Wait for that decision before proposing another change.`,
      )
    }
    if (control.phase === 'manual_control') {
      throw new Error('The user is editing manually. Wait until they resume the Agent before proposing a change.')
    }
    if (control.phase === 'animating') {
      throw new Error(`The Agent is still showing "${control.operation.label}". Wait for its review before proposing another change.`)
    }
    if (operationState.pendingOperations > 0) {
      throw new Error(
        'A workspace operation has already been submitted. Wait for it to finish and receive the user\'s decision before proposing another change.',
      )
    }
    const failed = checks.filter((check) => check.status === 'fail')
    if (failed.length) {
      throw new Error(`Cannot publish an applyable proposal with failed checks: ${failed.map((check) => check.message).join('; ')}`)
    }
    const manager = useViewportManager.getState()
    if (manager.activeViewportId !== viewportId) {
      throw new Error(`Active viewport changed from ${viewportId} to ${manager.activeViewportId} before proposal publication`)
    }
    const viewportApi = getActiveViewportStoreApi()
    const viewportKey = viewportApi as unknown as object
    const currentRevision = readWorkspaceRevision(viewportApi as never)
    if (currentRevision !== workspaceRevision) {
      throw new Error(
        `Workspace revision changed from r${workspaceRevision} to r${currentRevision} before proposal publication. Re-observe and recompute.`,
      )
    }
    throwIfProposalCancelled(signal)
    const proposal = useAgentProposalStore.getState().propose({
      id: nextProposalId(),
      intent,
      baseFingerprint,
      viewportId,
      workspaceRevision,
      viewportKey,
      candidate: structuredClone(candidate),
      diff: proposalDiffFromChangeSet(changeSet),
      checks,
      inspectionTargets,
      previewComplete: (changeSet.added?.length ?? 0) >= (changeSet.addedCount ?? 0)
        && (changeSet.removed?.length ?? 0) >= (changeSet.removedCount ?? 0)
        && (changeSet.moved?.length ?? 0) >= (changeSet.movedCount ?? 0),
    })
    return toProposalSnapshot(proposal)
  },
  readCandidate: (input) => {
    throwIfProposalCancelled(input.signal)
    const proposal = useAgentProposalStore.getState().readCandidate(input)
    assertProposalWorkspaceIsCurrent(proposal)
    throwIfProposalCancelled(input.signal)
    return {
      proposal: toProposalSnapshot(proposal),
      candidate: structuredClone(proposal.candidate),
    }
  },
  revise: ({
    id, expectedPreviewRevision, expectedCandidateFingerprint, intent,
    candidate, changeSet, checks = [], inspectionTargets = [], signal,
  }) => {
    throwIfProposalCancelled(signal)
    const failed = checks.filter((check) => check.status === 'fail')
    if (failed.length) {
      throw new AgentProposalRevisionError(
        'proposal_refinement_failed_checks',
        `Cannot publish an adjusted proposal with failed checks: ${failed.map((check) => check.message).join('; ')}`,
      )
    }
    const current = useAgentProposalStore.getState().readCandidate({
      id,
      expectedPreviewRevision,
      expectedCandidateFingerprint,
    })
    assertProposalWorkspaceIsCurrent(current)
    throwIfProposalCancelled(signal)
    const revised = useAgentProposalStore.getState().revise({
      id,
      expectedPreviewRevision,
      expectedCandidateFingerprint,
      intent,
      candidate: structuredClone(candidate),
      diff: proposalDiffFromChangeSet(changeSet),
      checks,
      inspectionTargets,
      previewComplete: (changeSet.added?.length ?? 0) >= (changeSet.addedCount ?? 0)
        && (changeSet.removed?.length ?? 0) >= (changeSet.removedCount ?? 0)
        && (changeSet.moved?.length ?? 0) >= (changeSet.movedCount ?? 0),
    })
    return toProposalSnapshot(revised)
  },
  status: (id, signal) => {
    throwIfProposalCancelled(signal)
    const found = useAgentProposalStore.getState().find(id)
    return found ? toProposalSnapshot(found) : null
  },
  withdraw: (id, signal) => {
    throwIfProposalCancelled(signal)
    const resolved = useAgentProposalStore.getState().resolve(id, 'discarded')
    return resolved ? toProposalSnapshot(resolved) : null
  },
}
