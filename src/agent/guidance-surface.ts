/**
 * Binds the agent-facing guidance contract to the in-page guidance store.
 * Atom-id anchored annotations are resolved to world positions here, against
 * the active viewport, so the store only ever holds plain coordinates.
 */

import { useAgentGuidance, type GuidanceAnnotation } from '../orchestration/agentGuidanceStore'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { useViewportManager } from '../orchestration/viewportManager'
import { unresolvedProposal } from '../orchestration/agentProposalStore'
import { useAgentOperationReview } from '../orchestration/agentOperationReviewStore'
import { readWorkspaceRevision } from '../orchestration/workspaceRevisionTracker'
import type {
  GuidanceAnnotationInput,
  GuidanceCandidateStatus,
  GuidanceSnapshot,
  Vec3,
  ZatomGuidanceSurface,
} from './contracts'

export class GuidanceInputError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GuidanceInputError'
    this.code = code
  }
}

function snapshot(api = getActiveViewportStoreApi()): GuidanceSnapshot {
  const { plan, annotations, candidates } = useAgentGuidance.getState()
  const viewportKey = api as unknown as object
  return {
    plan: plan ? { steps: plan.steps.map((s) => ({ ...s })), caption: plan.caption } : null,
    annotations: annotations
      .filter((annotation) => annotation.viewportKey === viewportKey)
      .map((a) => ({ id: a.id, position: [...a.position] as Vec3, label: a.label, kind: a.kind })),
    candidates: candidates?.viewportKey === viewportKey
      ? {
          id: candidates.id,
          label: candidates.label,
          focusedIndex: candidates.focusedIndex,
          decision: { ...candidates.decision },
          items: candidates.items.map((c) => ({
            index: c.index,
            atomIds: [...c.atomIds],
            position: [...c.position] as Vec3,
            anchorPositions: c.anchorPositions.map((position) => [...position] as Vec3),
            label: c.label,
            detail: c.detail,
          })),
        }
      : null,
  }
}

let candidateSetCounter = 0

function targetForApi(api: ReturnType<typeof getActiveViewportStoreApi>) {
  const manager = useViewportManager.getState()
  const viewportId = Object.entries(manager.viewports).find(([, slot]) => (
    slot.kind === 'crystal'
      && (slot.storeInstance as unknown as object) === (api as unknown as object)
  ))?.[0]
  if (!viewportId) throw new GuidanceInputError('viewport_missing', 'The guidance viewport no longer exists.')
  return {
    api,
    viewportKey: api as unknown as object,
    viewportId,
    workspaceRevision: readWorkspaceRevision(api as never),
  }
}

function currentTarget() {
  return targetForApi(getActiveViewportStoreApi())
}

function centroidOfAtoms(atomIds: string[], api = getActiveViewportStoreApi()): Vec3 {
  const atoms = api?.getState().atoms ?? []
  const wanted = new Set(atomIds)
  let n = 0
  const c: [number, number, number] = [0, 0, 0]
  for (const atom of atoms) {
    if (!wanted.has(atom.id)) continue
    const p = atom.cartesian ?? atom.position
    c[0] += p[0]; c[1] += p[1]; c[2] += p[2]
    n++
  }
  if (n === 0) {
    throw new GuidanceInputError('unknown_atom_ids', `None of the atom ids ${atomIds.join(', ')} exist in the active structure`)
  }
  return [c[0] / n, c[1] / n, c[2] / n]
}

let annotationCounter = 0

function resolveAnnotation(input: GuidanceAnnotationInput): GuidanceAnnotation {
  const target = currentTarget()
  const position = 'position' in input ? ([...input.position] as Vec3) : centroidOfAtoms(input.atomIds)
  return {
    id: input.id ?? `ann-${++annotationCounter}`,
    position,
    label: input.label,
    kind: input.kind ?? 'info',
    viewportKey: target.viewportKey,
    viewportId: target.viewportId,
    workspaceRevision: target.workspaceRevision,
  }
}

export const activeViewportGuidanceSurface: ZatomGuidanceSurface = {
  read: snapshot,
  setPlan: (steps, activeIndex, caption) => {
    useAgentGuidance.getState().setPlan(steps, activeIndex, caption)
    return snapshot()
  },
  advance: (activeIndex, caption) => {
    useAgentGuidance.getState().advance(activeIndex, caption)
    return snapshot()
  },
  setCaption: (caption) => {
    useAgentGuidance.getState().setCaption(caption)
    return snapshot()
  },
  annotate: (annotations, replace) => {
    useAgentGuidance.getState().setAnnotations(annotations.map(resolveAnnotation), replace)
    return snapshot()
  },
  presentCandidates: (label, items) => {
    if (!items.length) throw new GuidanceInputError('empty_candidates', 'Present at least one candidate.')
    const proposal = unresolvedProposal()
    if (proposal) {
      throw new GuidanceInputError(
        'decision_already_pending',
        `Proposal ${proposal.id} is waiting for Apply or Discard. Finish that decision before asking the user to choose candidates.`,
      )
    }
    const control = useAgentOperationReview.getState().control
    if (control.phase !== 'idle') {
      throw new GuidanceInputError(
        'decision_already_pending',
        control.phase === 'awaiting_review'
          ? `The user is still reviewing "${control.review.label}". Finish that decision before asking another question.`
          : control.phase === 'animating'
            ? `The Agent is still showing "${control.operation.label}". Wait for it to finish before asking another question.`
            : 'The user is editing manually. Wait until they resume the Agent before asking another candidate question.',
      )
    }
    const existing = useAgentGuidance.getState().candidates
    if (existing) {
      throw new GuidanceInputError(
        existing.decision.status === 'pending' ? 'candidate_decision_pending' : 'candidate_not_cleared',
        `Candidate set ${existing.id} is ${existing.decision.status}. Read its status, then clear it before presenting another choice.`,
      )
    }
    const target = currentTarget()
    const resolved = items.map((item, i) => {
      const atomIds = item.atomIds ? [...item.atomIds] : []
      if (!atomIds.length && !item.position) {
        throw new GuidanceInputError(
          'candidate_target_missing',
          `Candidate ${i + 1} needs atomIds, position, or both.`,
        )
      }
      return {
        index: i + 1,
        atomIds,
        position: item.position ? [...item.position] as Vec3 : centroidOfAtoms(atomIds),
        anchorPositions: item.anchorPositions?.map((position) => [...position] as Vec3) ?? [],
        label: item.label,
        detail: item.detail ?? null,
        viewportKey: target.viewportKey,
      }
    })
    useAgentGuidance.getState().setCandidates({
      id: `cand-${++candidateSetCounter}`,
      label,
      items: resolved,
      focusedIndex: null,
      decision: { status: 'pending', index: null, at: null },
      viewportKey: target.viewportKey,
      viewportId: target.viewportId,
      workspaceRevision: target.workspaceRevision,
      selectionBefore: [...target.api.getState().selectedAtomIds],
    })
    return snapshot()
  },
  focusCandidate: (index) => focusGuidanceCandidateInViewport(index),
  candidateStatus: (candidateSetId, waitMs = 0, signal) => (
    waitForGuidanceCandidateDecision(candidateSetId, waitMs, signal)
  ),
  clear: (scope) => {
    const current = useAgentGuidance.getState().candidates
    if ((scope === undefined || scope === 'all' || scope === 'candidates') && current) {
      const activeApi = getActiveViewportStoreApi()
      const activeTarget = targetForApi(activeApi)
      if (current.viewportKey !== (activeApi as unknown as object)
        || current.viewportId !== activeTarget.viewportId) {
        throw new GuidanceInputError(
          'candidate_viewport_mismatch',
          `Candidate set ${current.id} belongs to ${current.viewportId}, not the active viewport ${activeTarget.viewportId}. Activate its viewport before clearing that choice.`,
        )
      }
      if (current.workspaceRevision !== activeTarget.workspaceRevision) {
        // The old ownership snapshot no longer describes this structure. Mark
        // it stale so clearing cannot restore an obsolete atom selection.
        useAgentGuidance.getState().invalidateCandidate()
      } else if (current.decision.status === 'pending') {
        restoreSelectionIfCandidateOwnedIt(current, activeApi)
      }
    }
    useAgentGuidance.getState().clear(scope)
    return snapshot()
  },
}

/** Shared validated path for both MCP focus calls and badge clicks. */
export function focusGuidanceCandidateInViewport(
  index: number | null,
  api = getActiveViewportStoreApi(),
): GuidanceSnapshot {
    const current = useAgentGuidance.getState().candidates
    if (!current) throw new GuidanceInputError('no_candidates', 'No candidate set is being shown.')
    if (current.decision.status !== 'pending') {
      throw new GuidanceInputError(
        'candidate_already_resolved',
        `Candidate set ${current.id} is already ${current.decision.status}. Clear it before starting another choice.`,
      )
    }
    if (index !== null && !current.items.some((c) => c.index === index)) {
      throw new GuidanceInputError('unknown_candidate', `Candidate ${index} does not exist (1..${current.items.length}).`)
    }
    const target = targetForApi(api)
    if (current.viewportKey !== target.viewportKey
      || current.viewportId !== target.viewportId
      || current.workspaceRevision !== target.workspaceRevision) {
      useAgentGuidance.getState().invalidateCandidate()
      throw new GuidanceInputError(
        'stale_candidates',
        'The candidate viewport or structure changed. Recompute and present candidates from the current workspace.',
      )
    }
    // Moving away from an atom-backed preview first releases the temporary
    // selection it owned. This matters when the next candidate is a point:
    // point-only focus deliberately does not select atoms, so without this
    // hand-off the previous candidate's atoms would remain selected forever.
    if (index !== current.focusedIndex) restoreSelectionIfCandidateOwnedIt(current, target.api)
    useAgentGuidance.getState().focusCandidate(index)
    const item = index === null ? null : current.items.find((candidate) => candidate.index === index) ?? null
    if (item) {
      const state = target.api.getState()
      const visible = new Set(state.atoms.map((atom) => atom.id))
      // A point-only target deliberately leaves the user's atom selection
      // alone. It still receives the same camera focus and exact marker.
      if (item.atomIds.length) state.selectAtoms(item.atomIds.filter((id) => visible.has(id)))
      state.focusOnPoint(item.position, 2.5)
    }
    return snapshot(api)
}

function sameIds(left: ReadonlySet<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((id) => left.has(id))
}

function restoreSelectionIfCandidateOwnedIt(
  candidates: NonNullable<ReturnType<typeof useAgentGuidance.getState>['candidates']>,
  api: ReturnType<typeof getActiveViewportStoreApi>,
): void {
  if (candidates.focusedIndex === null) return
  const focused = candidates.items.find((item) => item.index === candidates.focusedIndex)
  // A point-only focus never changed the atom selection, so there is nothing
  // to restore. For atom targets, only roll back while our exact selection is
  // still present; a newer manual selection always wins.
  if (!focused?.atomIds.length) return
  const state = api.getState()
  const visibleFocused = focused.atomIds.filter((id) => state.atoms.some((atom) => atom.id === id))
  if (!sameIds(state.selectedAtomIds, visibleFocused)) return
  const visible = new Set(state.atoms.map((atom) => atom.id))
  state.selectAtoms(candidates.selectionBefore.filter((id) => visible.has(id)))
}

function assertCandidateStillCurrent(
  api: ReturnType<typeof getActiveViewportStoreApi>,
) {
  const current = useAgentGuidance.getState().candidates
  if (!current) throw new GuidanceInputError('no_candidates', 'No candidate set is being shown.')
  const target = targetForApi(api)
  if (current.viewportKey !== target.viewportKey
    || current.viewportId !== target.viewportId
    || current.workspaceRevision !== target.workspaceRevision) {
    if (current.decision.status === 'pending') {
      useAgentGuidance.getState().invalidateCandidate()
    }
    throw new GuidanceInputError(
      'stale_candidates',
      'The candidate viewport or structure changed. Recompute and present candidates from the current workspace.',
    )
  }
  return current
}

/** User-facing decision path shared by the strip buttons and keyboard shortcut. */
export function confirmGuidanceCandidateInViewport(
  api = getActiveViewportStoreApi(),
): GuidanceSnapshot {
  const current = assertCandidateStillCurrent(api)
  if (current.decision.status !== 'pending') return snapshot(api)
  if (current.focusedIndex === null) {
    throw new GuidanceInputError('candidate_not_focused', 'Focus one candidate before confirming it.')
  }
  useAgentGuidance.getState().resolveCandidate({
    status: 'confirmed',
    index: current.focusedIndex,
    at: Date.now(),
  })
  return snapshot(api)
}

/** Cancel the question and safely restore the selection that preceded it. */
export function cancelGuidanceCandidatesInViewport(
  api = getActiveViewportStoreApi(),
): GuidanceSnapshot {
  const current = assertCandidateStillCurrent(api)
  if (current.decision.status !== 'pending') return snapshot(api)
  restoreSelectionIfCandidateOwnedIt(current, api)
  useAgentGuidance.getState().resolveCandidate({ status: 'cancelled', index: null, at: Date.now() })
  return snapshot(api)
}

function candidateStatus(candidateSetId: string, timedOut: boolean): GuidanceCandidateStatus {
  let current = useAgentGuidance.getState().candidates
  if (!current || current.id !== candidateSetId) {
    throw new GuidanceInputError(
      'unknown_candidate_set',
      `Candidate set ${candidateSetId} is not available. It may have been cleared; present the choices again if they are still relevant.`,
    )
  }
  const activeApi = getActiveViewportStoreApi()
  const activeTarget = targetForApi(activeApi)
  if (current.viewportKey !== (activeApi as unknown as object)
    || current.viewportId !== activeTarget.viewportId) {
    throw new GuidanceInputError(
      'candidate_viewport_mismatch',
      `Candidate set ${candidateSetId} belongs to ${current.viewportId}, not the active viewport ${activeTarget.viewportId}. Activate its viewport before reading that choice.`,
    )
  }
  if (activeTarget.workspaceRevision !== current.workspaceRevision
    && current.decision.status !== 'stale') {
    useAgentGuidance.getState().invalidateCandidate()
    current = useAgentGuidance.getState().candidates!
  }
  const chosenIndex = current.decision.status === 'confirmed' ? current.decision.index : null
  const chosen = chosenIndex === null
    ? null
    : current.items.find((item) => item.index === chosenIndex) ?? null
  return {
    candidateSetId,
    status: current.decision.status,
    focusedIndex: current.focusedIndex,
    choice: chosen ? {
      index: chosen.index,
      atomIds: [...chosen.atomIds],
      position: [...chosen.position] as Vec3,
      label: chosen.label,
      detail: chosen.detail,
    } : null,
    decidedAt: current.decision.at,
    timedOut,
  }
}

function candidateWaitAbortError(signal: AbortSignal): Error & { code: string } {
  return new GuidanceInputError(
    'tool_execution_aborted',
    signal.reason instanceof Error
      ? signal.reason.message
      : 'Waiting for the candidate decision was cancelled',
  )
}

/**
 * Long-poll one exact candidate set. It returns immediately after Confirm,
 * Cancel, or staleness, while timeout is a successful still-pending snapshot.
 */
export function waitForGuidanceCandidateDecision(
  candidateSetId: string,
  waitMs = 0,
  signal?: AbortSignal,
): Promise<GuidanceCandidateStatus> {
  if (signal?.aborted) return Promise.reject(candidateWaitAbortError(signal))
  const initial = candidateStatus(candidateSetId, false)
  if (initial.status !== 'pending' || waitMs <= 0) return Promise.resolve(initial)
  const boundedWaitMs = Math.min(30_000, Math.max(0, Math.trunc(waitMs)))
  const waitingSet = useAgentGuidance.getState().candidates!
  const viewportApi = waitingSet.viewportKey as ReturnType<typeof getActiveViewportStoreApi>
  return new Promise<GuidanceCandidateStatus>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      unsubscribe()
      unsubscribeWorkspace()
      unsubscribeActiveViewport()
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (value: GuidanceCandidateStatus) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      if (settled || !signal) return
      settled = true
      cleanup()
      reject(candidateWaitAbortError(signal))
    }
    const timer = setTimeout(() => {
      try {
        finish(candidateStatus(candidateSetId, true))
      } catch (error) {
        fail(error)
      }
    }, boundedWaitMs)
    const unsubscribe = useAgentGuidance.subscribe((state) => {
      const current = state.candidates
      if (!current || current.id !== candidateSetId) {
        fail(new GuidanceInputError(
          'unknown_candidate_set',
          `Candidate set ${candidateSetId} was cleared while waiting.`,
        ))
        return
      }
      if (current.decision.status !== 'pending') finish(candidateStatus(candidateSetId, false))
    })
    const onViewportChange = () => {
      try {
        const current = candidateStatus(candidateSetId, false)
        if (current.status !== 'pending') finish(current)
      } catch (error) {
        fail(error)
      }
    }
    const unsubscribeWorkspace = viewportApi.subscribe(onViewportChange)
    const unsubscribeActiveViewport = useViewportManager.subscribe(onViewportChange)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}
