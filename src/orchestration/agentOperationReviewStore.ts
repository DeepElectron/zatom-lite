/**
 * agentOperationReviewStore is the review and takeover channel for agent operations.
 *
 * After the agent commits a structure, the reveal animation shows what happened
 * but cannot establish whether the user wants it. This store adds that decision:
 *
 *   reveal settles → openReview({label, atomDelta})
 *     → Keep:   dismissReview(), then continue
 *     → Revert: revertAndTakeOver(), restore the prior state, and leave a takeover note
 *
 * The takeover note is for the **agent**. On its next turn, it learns that the
 * previous step was rejected and the user took control, preventing the same
 * rejected operation from being resubmitted. readAgentTakeoverNote() consumes it once.
 *
 * Review state remains outside viewport stores because it is globally unique
 * across viewports and must not rerender structure-data subscribers.
 */

import { create } from 'zustand'
import { unresolvedProposal } from './agentProposalStore'
import { useAgentGuidance } from './agentGuidanceStore'

/**
 * The UI layer injects this hook at startup to read the active viewport's
 * historyIndex when a card opens. Importing ViewportContext here would pull React
 * viewport state into non-UI agent paths and create a circular dependency.
 */
let readHistoryIndex: (() => number | null) | null = null
export function setReviewHistoryIndexReader(reader: () => number | null) {
  readHistoryIndex = reader
}

let readWorkspaceRevision: (() => number | null) | null = null
export function setReviewWorkspaceRevisionReader(reader: () => number | null) {
  readWorkspaceRevision = reader
}

/**
 * Structure-health result produced by summarizeStructureHealth. This minimal
 * render shape avoids a reverse dependency from orchestration to agent types.
 */
export interface AgentReviewHealth {
  verdict: 'pass' | 'warn' | 'fail'
  lines: { status: 'pass' | 'warn' | 'fail' | 'skipped'; message: string }[]
}

/**
 * The review subject distinguishes **structure** changes from **workspace** changes,
 * determining both card content and rollback behavior.
 *
 * A discriminated union prevents invalid combinations such as atom counts on a
 * layout review and forces render branches to handle every subject explicitly.
 *
 * Rollback belongs to the subject because mechanisms differ. Structure changes
 * use their canonical rollback path, while workspace layout changes do not enter
 * structure history, so the caller captures and supplies a restore closure. This
 * store never reaches into viewport state directly.
 */
export type AgentReviewSubject =
  /** Structure changes such as supercells, cuts, vacuum layers, or adsorbate placement. */
  | {
    kind: 'structure'
    /** Immutable viewport target captured when the commit began. */
    viewportId?: string
    /** Monotonic workspace revision of the exact result being reviewed. */
    workspaceRevision?: number
    /** Atom-count change, providing an objective check such as +24, -8, or 0. */
    atomDelta: number
    /** Exact canonical rollback; store-local undo is insufficient for Agent writes. */
    revert: () => void | Promise<void>
    /**
     * Health result for the settled structure. The card exposes issues such as
     * abnormal bond lengths or insufficient vacuum that animation alone cannot show.
     */
    health?: AgentReviewHealth
  }
  /** Workspace changes such as grid-layout switches; these affect layout, not atoms. */
  | {
    kind: 'workspace'
    /** Objective check such as "1x1 → 2x2," analogous to atomDelta for structures. */
    summary: string
    /**
     * Restores the pre-operation workspace. The caller captures this before the
     * change because workspace state is not in structure history.
     */
    revert: () => void | Promise<void>
  }

export interface PendingAgentReview {
  /** Human-readable operation label, such as "Supercell 2×2×1." */
  label: string
  /** Whether the agent changed structure or workspace, controlling rendering and rollback. */
  subject: AgentReviewSubject
  /**
   * Viewport historyIndex when the card opened. If it changes while the card is
   * visible, the user has edited the structure; reverting must then take control
   * without undoing the user's own edit.
   */
  historyIndexAtOpen: number | null
  openedAt: number
}

/**
 * What the user wants to happen **next** after rejecting a step.
 *
 * A rejection alone is ambiguous; the agent needs the intent to choose the
 * correct branch instead of guessing and resubmitting the same operation.
 *
 * - `user_took_over`: The user took control; do not mutate until control returns.
 * - `retry_differently`: The user still wants the agent to act, but with a new approach.
 * - `replan_from_edits`: The user edited the structure; reread it and replan from current state.
 * - `preview_only`: The user only wanted to inspect this step; do not commit or retry it.
 */
export type AgentTakeoverIntent =
  | 'user_took_over'
  | 'retry_differently'
  | 'replan_from_edits'
  | 'preview_only'

export interface AgentTakeoverNote {
  /** Label of the reverted operation, identifying the rejected step. */
  revertedLabel: string
  /** The user's requested next step, which the agent must branch on. */
  intent: AgentTakeoverIntent
  at: number
}

/**
 * Manual-control state is user-facing and distinct from the agent-facing takeover
 * note. readAgentTakeoverNote() consumes the note once, while this state must stay
 * visible until the user explicitly returns control.
 *
 * Persisting it makes agent authority clear and provides a path out of takeover.
 */
export interface ManualControlState {
  /** Operation that triggered takeover, used by the status bar for context. */
  revertedLabel: string
  /** False when takeover began directly from guidance without reverting an operation. */
  reverted: boolean
  /**
   * historyIndex at takeover. The status bar uses changes from this baseline to
   * offer replanning only when the user has actually edited the structure.
   */
  historyIndexAtTakeover: number | null
  /**
   * Monotonic structure/trajectory revision at takeover. Unlike historyIndex,
   * this catches canonical writes and A→B→A edits that do not leave a history
   * index difference, so "re-plan from my edits" never silently disappears.
   */
  workspaceRevisionAtTakeover: number | null
  since: number
}

/**
 * Explicit, mutually exclusive control phases.
 *
 * A discriminated union makes invalid combinations unrepresentable, preventing
 * review controls and manual-control UI from targeting the same structure at once:
 *
 *   idle ──openReview──> awaiting_review ──dismissReview──> idle
 *                              │
 *                     revertAndTakeOver
 *                              ↓
 *                       manual_control ──resumeAgent──> idle
 *
 * The takeover note remains separate because it is a one-shot agent outbox whose
 * lifetime is independent of the UI phase; it may remain unread after control returns.
 */
export type AgentControlPhase =
  | { phase: 'idle' }
  | {
    phase: 'animating'
    operation: {
      label: string
      viewportId: string
      startedAt: number
      /** User interrupted the reveal and is waiting for the exact Keep/Revert card. */
      decisionRequested: boolean
    }
  }
  | { phase: 'awaiting_review'; review: PendingAgentReview }
  | { phase: 'manual_control'; control: ManualControlState }

interface AgentOperationReviewState {
  control: AgentControlPhase
  takeover: AgentTakeoverNote | null
  /** Structure/layout operations submitted but not fully resolved. */
  pendingOperations: number

  beginAnimation: (operation: { label: string; viewportId: string }) => void
  clearAnimation: () => void
  setPendingOperations: (count: number) => void
  /** The store reads historyIndexAtOpen when opening; callers describe only the operation. */
  openReview: (review: Omit<PendingAgentReview, 'openedAt' | 'historyIndexAtOpen'>) => void
  /** Accepts the operation by closing the card without changing the structure. */
  dismissReview: () => void
  /**
   * Rejects the operation by closing the card and recording takeover. The caller
   * performs the actual rollback so this store remains independent of viewport state.
   *
   * intent determines authority: `user_took_over` enters manual control, while
   * agent-owned follow-ups return directly to idle so work can continue immediately.
   */
  revertAndTakeOver: (intent: AgentTakeoverIntent, outcome?: { reverted: boolean }) => void
  /**
   * Lets the user take control when no review card is pending. It reverts nothing
   * and blocks agent writes until resumeAgent. Non-idle phases ignore this request;
   * an open review must use its own revert-and-take-over action.
   */
  takeOver: (contextLabel: string) => void
  /** Clears the takeover note after the agent reads it, preventing repeated consumption. */
  acknowledgeTakeover: () => void
  /**
   * Returns control to the agent, the only exit from manual control.
   *
   * intent distinguishes replanning from manual edits (`replan_from_edits`) from
   * resuming the prior plan when the user made no structure change (`user_took_over`).
   */
  resumeAgent: (intent?: AgentTakeoverIntent) => void
}

export const useAgentOperationReview = create<AgentOperationReviewState>((set, get) => ({
  control: { phase: 'idle' },
  takeover: null,
  pendingOperations: 0,

  setPendingOperations: (count) => set({ pendingOperations: Math.max(0, Math.trunc(count)) }),

  beginAnimation: (operation) => {
    const current = get().control
    if (current.phase !== 'idle') {
      throw new Error(`Cannot animate "${operation.label}" while Agent control is ${current.phase}.`)
    }
    set({
      control: {
        phase: 'animating',
        operation: { ...operation, startedAt: Date.now(), decisionRequested: false },
      },
    })
  },

  clearAnimation: () => {
    if (get().control.phase === 'animating') set({ control: { phase: 'idle' } })
  },

  /**
   * Invalid transitions throw instead of silently replacing state.
   *
   * Opening a second review would replace the version under inspection, making
   * Keep/Revert target unseen state. Opening one during manual control would ignore
   * user authority. Both indicate that the agent-side commit gate was bypassed.
   */
  openReview: (review) => {
    const current = get().control
    const proposal = unresolvedProposal()
    if (proposal) {
      throw new Error(
        `Cannot review "${review.label}" while proposal ${proposal.id} is still waiting for Apply or Discard.`,
      )
    }
    if (current.phase === 'awaiting_review') {
      throw new Error(
        `Cannot open a review for "${review.label}": "${current.review.label}" is still awaiting `
        + 'the user\'s keep-or-revert answer. Wait for that answer before committing again.',
      )
    }
    if (current.phase === 'manual_control') {
      throw new Error(
        `Cannot open a review for "${review.label}": the user took over after reverting `
        + `"${current.control.revertedLabel}" and has not handed control back yet.`,
      )
    }
    set({
      control: {
        phase: 'awaiting_review',
        review: {
          ...review,
          historyIndexAtOpen: readHistoryIndex?.() ?? null,
          openedAt: Date.now(),
        },
      },
    })
  },

  // User-driven answer transitions ignore phase mismatches. Duplicate clicks or
  // rerendered cards are normal, so idempotence is preferable to throwing.
  dismissReview: () => {
    if (get().control.phase !== 'awaiting_review') return
    set({ control: { phase: 'idle' } })
  },

  revertAndTakeOver: (intent, outcome = { reverted: true }) => {
    const current = get().control
    if (current.phase !== 'awaiting_review') return
    const at = Date.now()
    const revertedLabel = current.review.label
    set({
      // Only "I'll do it" enters manual control. Alternative approaches return
      // authority to the agent immediately.
      control: intent === 'user_took_over'
        // Manual state and the takeover note share an origin but not a lifetime:
        // the note is consumed once, while this remains visible until control returns.
        ? {
          phase: 'manual_control',
          // Rollback has already completed in the caller, so this captures the
          // takeover baseline; later historyIndex changes are the user's edits.
          control: {
            revertedLabel,
            reverted: outcome.reverted,
            historyIndexAtTakeover: readHistoryIndex?.() ?? null,
            workspaceRevisionAtTakeover: readWorkspaceRevision?.() ?? null,
            since: at,
          },
        }
        : { phase: 'idle' },
      takeover: { revertedLabel, intent, at },
    })
  },

  takeOver: (contextLabel) => {
    const current = get().control
    if (current.phase === 'awaiting_review' || current.phase === 'manual_control') return
    // The canonical result already exists while its camera reveal is playing.
    // Going straight to manual control here used to discard the exact rollback
    // closure that is prepared at the end of the reveal. Keep the animation
    // phase (and therefore the mutation gate) closed, ask the presenter to
    // finish immediately, then surface the normal Keep/Revert decision.
    if (current.phase === 'animating') {
      set({
        control: {
          phase: 'animating',
          operation: { ...current.operation, decisionRequested: true },
        },
      })
      return
    }
    const at = Date.now()
    set({
      control: {
        phase: 'manual_control',
        control: {
          revertedLabel: contextLabel,
          reverted: false,
          historyIndexAtTakeover: readHistoryIndex?.() ?? null,
          workspaceRevisionAtTakeover: readWorkspaceRevision?.() ?? null,
          since: at,
        },
      },
      takeover: { revertedLabel: contextLabel, intent: 'user_took_over', at },
    })
  },

  acknowledgeTakeover: () => set({ takeover: null }),

  resumeAgent: (intent = 'user_took_over') => {
    const current = get().control
    if (current.phase !== 'manual_control') return
    set({
      control: { phase: 'idle' },
      // Replace the note when control returns so manual edits trigger replanning
      // from current state instead of replaying the original rejection context.
      takeover: { revertedLabel: current.control.revertedLabel, intent, at: Date.now() },
    })
  },
}))

/** Pending review shared by components and agent paths; null outside awaiting_review. */
export function selectPendingReview(state: AgentOperationReviewState): PendingAgentReview | null {
  return state.control.phase === 'awaiting_review' ? state.control.review : null
}

/** User takeover state; null outside manual_control. */
export function selectManualControl(state: AgentOperationReviewState): ManualControlState | null {
  return state.control.phase === 'manual_control' ? state.control.control : null
}

/**
 * Destructive agent writes queue here while a review is unanswered. Otherwise a
 * later commit could replace the version under review and make Keep/Revert target
 * the wrong state. The promise resolves when no review remains pending.
 *
 * Timeout throws instead of authorizing the write, giving the agent an actionable
 * unanswered-review error without hanging indefinitely or bypassing user judgment.
 */
export const REVIEW_WAIT_TIMEOUT_MS = 120_000

export function awaitAgentReviewResolved(
  timeoutMs = REVIEW_WAIT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<void> {
  const unresolved = () => {
    const control = useAgentOperationReview.getState().control
    return control.phase === 'animating' || control.phase === 'awaiting_review'
  }
  if (!unresolved()) {
    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Agent workspace mutation was cancelled'))
    }
    return Promise.resolve()
  }
  if (signal?.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Agent workspace mutation was cancelled'))
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      clearTimeout(timer)
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Agent workspace mutation was cancelled'))
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      const control = useAgentOperationReview.getState().control
      const label = control.phase === 'awaiting_review'
        ? control.review.label
        : control.phase === 'animating' ? control.operation.label : 'previous operation'
      reject(new Error(
        `Waiting for "${label}" to finish or receive the user's decision before writing again`,
      ))
    }, timeoutMs)
    const unsubscribe = useAgentOperationReview.subscribe((state) => {
      if (state.control.phase === 'animating' || state.control.phase === 'awaiting_review') return
      if (settled) return
      settled = true
      cleanup()
      resolve()
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

/**
 * Synchronous half of the mutation gate. Commit paths call this again at the
 * exact compare-and-set boundary after any parsing or animation wait: a user
 * can take control while an earlier await is suspended, and that decision must
 * win before the first workspace mutation runs.
 */
export interface AgentMutationGateOptions {
  /** The one pending ghost the user just chose to Apply. */
  authorizedProposalId?: string
  /** Caller-owned cancellation; a cancelled queued call never gains write authority. */
  signal?: AbortSignal
}

function throwIfMutationCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Agent workspace mutation was cancelled')
}

export function assertAgentMayMutateWorkspaceNow(
  intent: string,
  options: AgentMutationGateOptions = {},
): void {
  throwIfMutationCancelled(options.signal)
  const manual = selectManualControl(useAgentOperationReview.getState())
  if (manual) {
    throw new Error(
      `Cannot ${intent}: the user reverted "${manual.revertedLabel}" and is editing manually; `
      + 'ask them to resume the agent before writing again. '
      + 'You can still read the structure to follow their work.',
    )
  }
  const candidateDecision = useAgentGuidance.getState().candidates
  if (candidateDecision?.decision.status === 'pending') {
    const error = new Error(
      `Cannot ${intent}: candidate set ${candidateDecision.id} is waiting for the user's Confirm or Cancel decision. `
      + 'Resolve that spatial choice before changing the workspace.',
    ) as Error & { code: string }
    error.code = 'candidate_decision_pending'
    throw error
  }
  const proposal = unresolvedProposal()
  if (options.authorizedProposalId && proposal?.id !== options.authorizedProposalId) {
    throw new Error(
      `Cannot ${intent}: proposal ${options.authorizedProposalId} is no longer pending. `
      + 'Its Apply authorization was withdrawn before the workspace write boundary.',
    )
  }
  if (proposal && proposal.id !== options.authorizedProposalId) {
    throw new Error(
      `Cannot ${intent}: proposal ${proposal.id} ("${proposal.intent}") is waiting for the user's Apply or Discard decision. `
      + 'Resolve that proposal before changing the workspace.',
    )
  }
}

/**
 * Unified gate for destructive operations: reject writes during user control and
 * queue them while review remains unanswered.
 *
 * The gate belongs here because it depends only on review phase, not DOM or
 * viewport state, so every mutation path shares one check without importing
 * viewer-context.ts into the state module.
 *
 * Reads bypass the gate so the agent can observe manual edits and resume from the
 * actual state after control returns.
 *
 * @param intent Included in errors so the agent knows which step was blocked.
 */
export async function assertAgentMayMutateWorkspace(
  intent: string,
  options: AgentMutationGateOptions = {},
): Promise<void> {
  // A queued writer may wake because the review changed to manual_control.
  // Re-check after every wait instead of treating "review disappeared" as
  // permission: Revert & I'll do it resolves the review precisely by taking
  // permission away.
  for (;;) {
    throwIfMutationCancelled(options.signal)
    assertAgentMayMutateWorkspaceNow(intent, options)
    const phase = useAgentOperationReview.getState().control.phase
    if (phase !== 'animating' && phase !== 'awaiting_review') return
    await awaitAgentReviewResolved(REVIEW_WAIT_TIMEOUT_MS, options.signal)
    throwIfMutationCancelled(options.signal)
  }
}

/** Reads and consumes the takeover note from non-React agent code. */
export function readAgentTakeoverNote(): AgentTakeoverNote | null {
  const note = useAgentOperationReview.getState().takeover
  if (note) useAgentOperationReview.getState().acknowledgeTakeover()
  return note
}
