/**
 * agentProposalStore holds agent-proposed structure changes for user approval.
 *
 * Unlike agentOperationReviewStore's after-the-fact review, proposals are
 * **pre-commit**. The agent stores a candidate structure and diff; the scene
 * renders added or moved atoms as ghosts and presents Apply / Discard. Apply then
 * writes the workspace through the normal review path, preserving one
 * preview → commit → review flow.
 *
 * Only one proposal may be pending. A second is rejected instead of replacing the
 * visible decision, so the user faces exactly one Apply / Discard choice at a time.
 */

import { create } from 'zustand'
import type {
  InspectionTarget,
  ProposalDiff,
  ProposalSnapshot,
  ProposalStatus,
  ValidationCheck,
  ZatomStructure,
} from '../agent/contracts'
import { fingerprintStructure } from '../agent/structure-math'

export interface AgentProposal extends ProposalSnapshot {
  /** In-process immutable store identity; never serialized to an Agent. */
  viewportKey: object
  candidate: ZatomStructure
  createdAt: number
  resolvedAt: number | null
}

interface AgentProposalState {
  /** Most recent proposal, whatever its status; the UI only renders while pending. */
  current: AgentProposal | null
  /** Short history so structure_proposal_status can answer recently resolved ids. */
  history: AgentProposal[]
  propose: (input: {
    id: string
    intent: string
    baseFingerprint: string | null
    viewportId: string
    workspaceRevision: number
    viewportKey: object
    candidate: ZatomStructure
    diff: ProposalDiff
    checks?: ValidationCheck[]
    inspectionTargets?: InspectionTarget[]
    previewComplete?: boolean
  }) => AgentProposal
  readCandidate: (input: {
    id: string
    expectedPreviewRevision: number
    expectedCandidateFingerprint: string
  }) => AgentProposal
  /**
   * Replace only the ghost candidate while preserving the proposal decision.
   * The two preview guards make an Agent retry fail closed instead of applying
   * the same relative pose twice to a newer ghost.
   */
  revise: (input: {
    id: string
    expectedPreviewRevision: number
    expectedCandidateFingerprint: string
    intent: string
    candidate: ZatomStructure
    diff: ProposalDiff
    checks?: ValidationCheck[]
    inspectionTargets?: InspectionTarget[]
    previewComplete?: boolean
  }) => AgentProposal
  claim: (id: string) => AgentProposal | null
  release: (id: string) => AgentProposal | null
  resolve: (id: string, status: Exclude<ProposalStatus, 'pending' | 'applying'>) => AgentProposal | null
  find: (id: string) => AgentProposal | null
}

const HISTORY_LIMIT = 8

export class AgentProposalRevisionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentProposalRevisionError'
    this.code = code
  }
}

function assertRefinableProposal(
  current: AgentProposal | null,
  id: string,
  expectedPreviewRevision: number,
  expectedCandidateFingerprint: string,
): AgentProposal {
  if (!current || current.id !== id) {
    throw new AgentProposalRevisionError(
      'proposal_not_pending',
      `Proposal ${id} is no longer the decision shown to the user. Read its status before trying another pose.`,
    )
  }
  if (current.status !== 'pending') {
    throw new AgentProposalRevisionError(
      'proposal_not_pending',
      current.status === 'applying'
        ? `Proposal ${id} is already being applied and can no longer be adjusted.`
        : `Proposal ${id} is already ${current.status} and can no longer be adjusted.`,
    )
  }
  if (current.previewRevision !== expectedPreviewRevision
    || current.candidateFingerprint !== expectedCandidateFingerprint) {
    throw new AgentProposalRevisionError(
      'stale_proposal_preview',
      `Proposal ${id} preview changed from r${expectedPreviewRevision}/${expectedCandidateFingerprint} `
        + `to r${current.previewRevision}/${current.candidateFingerprint}. Read its status and refine the latest ghost.`,
    )
  }
  return current
}

export const useAgentProposalStore = create<AgentProposalState>((set, get) => ({
  current: null,
  history: [],

  propose: ({
    id, intent, baseFingerprint, viewportId, workspaceRevision, viewportKey,
    candidate, diff, checks = [], inspectionTargets = [], previewComplete = true,
  }) => {
    const now = Date.now()
    const previous = get().current
    if (previous?.status === 'pending' || previous?.status === 'applying') {
      throw new Error(
        `Proposal ${previous.id} is still waiting for the user. Poll its status instead of replacing the decision on screen.`,
      )
    }
    const proposal: AgentProposal = {
      id, intent, baseFingerprint, candidate, diff,
      viewportId,
      workspaceRevision,
      viewportKey,
      checks,
      inspectionTargets,
      previewComplete,
      candidateFingerprint: fingerprintStructure(candidate),
      previewRevision: 1,
      status: 'pending', createdAt: now, resolvedAt: null,
    }
    set((state) => ({
      current: proposal,
      history: state.history,
    }))
    return proposal
  },

  readCandidate: ({ id, expectedPreviewRevision, expectedCandidateFingerprint }) => (
    assertRefinableProposal(get().current, id, expectedPreviewRevision, expectedCandidateFingerprint)
  ),

  revise: ({
    id, expectedPreviewRevision, expectedCandidateFingerprint, intent,
    candidate, diff, checks = [], inspectionTargets = [], previewComplete = true,
  }) => {
    const current = assertRefinableProposal(
      get().current,
      id,
      expectedPreviewRevision,
      expectedCandidateFingerprint,
    )
    const revised: AgentProposal = {
      ...current,
      intent,
      candidate,
      candidateFingerprint: fingerprintStructure(candidate),
      previewRevision: current.previewRevision + 1,
      diff,
      checks,
      inspectionTargets,
      previewComplete,
    }
    set({ current: revised })
    return revised
  },

  claim: (id) => {
    const current = get().current
    if (!current || current.id !== id || current.status !== 'pending') return null
    const applying: AgentProposal = { ...current, status: 'applying' }
    set({ current: applying })
    return applying
  },

  release: (id) => {
    const current = get().current
    if (!current || current.id !== id || current.status !== 'applying') return null
    const pending: AgentProposal = { ...current, status: 'pending' }
    set({ current: pending })
    return pending
  },

  resolve: (id, status) => {
    const { current } = get()
    if (!current || current.id !== id
      || (current.status !== 'pending' && current.status !== 'applying')) return null
    // Once Apply owns the proposal, only that owner may finish it as applied.
    if (current.status === 'applying' && status !== 'applied') return null
    const resolved: AgentProposal = { ...current, status, resolvedAt: Date.now() }
    set((state) => ({ current: resolved, history: [resolved, ...state.history].slice(0, HISTORY_LIMIT) }))
    return resolved
  },

  find: (id) => {
    const { current, history } = get()
    if (current?.id === id) return current
    return history.find((entry) => entry.id === id) ?? null
  },
}))

export function pendingProposal(): AgentProposal | null {
  const { current } = useAgentProposalStore.getState()
  return current?.status === 'pending' ? current : null
}

export function unresolvedProposal(): AgentProposal | null {
  const { current } = useAgentProposalStore.getState()
  return current?.status === 'pending' || current?.status === 'applying' ? current : null
}

export function toProposalSnapshot(proposal: AgentProposal): ProposalSnapshot {
  const { candidate: _candidate, viewportKey: _viewportKey, createdAt: _c, resolvedAt: _r, ...snapshot } = proposal
  return snapshot
}
