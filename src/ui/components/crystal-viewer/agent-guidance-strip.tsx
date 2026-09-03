'use client'

/** Show the active guidance plan and hand control back to the user when requested. */
import { useEffect } from 'react'
import {
  selectGuidanceCandidates,
  selectGuidancePlan,
  useAgentGuidance,
} from '../../../orchestration/agentGuidanceStore'
import {
  selectManualControl,
  selectPendingReview,
  useAgentOperationReview,
} from '../../../orchestration/agentOperationReviewStore'
import { abortChoreography } from '../../../orchestration/modelingChoreographer'
import {
  cancelGuidanceCandidatesInViewport,
  confirmGuidanceCandidateInViewport,
} from '../../../agent/guidance-surface'
import { useAgentProposalStore } from '../../../orchestration/agentProposalStore'

export function AgentGuidanceStrip() {
  const plan = useAgentGuidance(selectGuidancePlan)
  const candidates = useAgentGuidance(selectGuidanceCandidates)
  const manualControl = useAgentOperationReview(selectManualControl)
  const pendingReview = useAgentOperationReview(selectPendingReview)
  const takeOver = useAgentOperationReview((s) => s.takeOver)
  const proposalDecisionPending = useAgentProposalStore((state) => (
    state.current?.status === 'pending' || state.current?.status === 'applying'
  ))

  const answerCandidate = (answer: 'confirm' | 'cancel') => {
    try {
      if (answer === 'confirm') {
        confirmGuidanceCandidateInViewport()
      } else {
        cancelGuidanceCandidatesInViewport()
      }
    } catch {
      // Guidance can expire after the workspace changes; the store resolves that stale state.
    }
  }

  const candidatePending = candidates?.decision.status === 'pending'
  const canAnswerCandidate = Boolean(candidatePending && !pendingReview && !proposalDecisionPending)

  useEffect(() => {
    if (!canAnswerCandidate) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.key === 'Enter' && candidates?.focusedIndex !== null) {
        event.preventDefault()
        event.stopImmediatePropagation()
        answerCandidate('confirm')
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        answerCandidate('cancel')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canAnswerCandidate, candidates?.focusedIndex])

  if (!plan && !candidates) return null

  // A pending choice takes the caption slot: it is the one thing the user
  // must do before the agent can continue.
  const choice = candidates
    ? candidates.decision.status === 'confirmed'
      ? `${candidates.label} — confirmed #${candidates.decision.index} ${candidates.items.find((c) => c.index === candidates.decision.index)?.label ?? ''}`
      : candidates.decision.status === 'cancelled'
        ? `${candidates.label} — cancelled`
        : candidates.decision.status === 'stale'
          ? `${candidates.label} — expired after the workspace changed`
          : candidates.focusedIndex
            ? `${candidates.label} — #${candidates.focusedIndex} ${candidates.items.find((c) => c.index === candidates.focusedIndex)?.label ?? ''}`
            : `${candidates.label} (pick 1–${candidates.items.length} in the view)`
    : null

  const candidateControls = candidatePending ? (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      <button
        type="button"
        disabled={!canAnswerCandidate || candidates.focusedIndex === null}
        onClick={() => answerCandidate('confirm')}
        title={candidates.focusedIndex === null ? 'Focus a numbered candidate first' : 'Confirm the focused candidate'}
        className="zatom-pressable inline-flex h-6.5 items-center gap-1 rounded-full px-3 text-[11.5px] font-semibold disabled:opacity-45"
        style={{ background: 'var(--panel-accent)', color: '#fff' }}
      >
        Confirm
        <kbd className="rounded-[3px] bg-white/25 px-1 text-[8.5px] leading-[13px] font-normal">↵</kbd>
      </button>
      <button
        type="button"
        disabled={!canAnswerCandidate}
        onClick={() => answerCandidate('cancel')}
        title="Cancel this choice without applying any candidate"
        className="zatom-pressable inline-flex h-6.5 items-center gap-1 rounded-full px-3 text-[11.5px] font-medium hover:bg-[var(--panel-hover)] disabled:opacity-45"
      >
        Cancel
        <kbd className="rounded-[3px] border border-[var(--panel-border)] px-1 text-[8.5px] leading-[13px] font-normal">Esc</kbd>
      </button>
    </span>
  ) : null

  if (!plan) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-2 text-[12px] text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
        style={{ pointerEvents: 'auto', borderRadius: 6 }}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: '#ff8a00' }} aria-hidden />
        <span className="max-w-[480px] truncate">{choice}</span>
        {candidateControls}
      </div>
    )
  }

  const activeIndex = plan.steps.findIndex((s) => s.status === 'active')
  const allDone = activeIndex < 0
  const total = plan.steps.length
  const activeLabel = allDone ? 'Done' : plan.steps[activeIndex].label
  const canTakeOver = !manualControl && !pendingReview && !allDone
  const caption = choice ?? plan.caption

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-4 border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-2 text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      style={{ pointerEvents: 'auto', borderRadius: 6 }}
    >
      <ol className="flex items-center gap-1.5" aria-label={`${total} steps`}>
        {plan.steps.map((step, index) => (
          <li
            key={index}
            title={`${index + 1}. ${step.label}`}
            aria-current={step.status === 'active' ? 'step' : undefined}
            className="size-2 shrink-0 rounded-full transition-colors"
            style={{
              background:
                step.status === 'done'
                  ? 'var(--panel-accent)'
                  : step.status === 'active'
                    ? 'var(--panel-accent)'
                    : 'transparent',
              border: `1.5px solid ${step.status === 'pending' ? 'var(--panel-text-tertiary)' : 'var(--panel-accent)'}`,
              opacity: step.status === 'done' ? 0.45 : 1,
            }}
          />
        ))}
      </ol>

      <div className="flex min-w-0 flex-col leading-tight">
        <span className="flex items-baseline gap-2 whitespace-nowrap text-[12px]">
          <span className="font-mono text-[10.5px] text-[var(--panel-text-tertiary)]">
            {allDone ? `${total}/${total}` : `${activeIndex + 1}/${total}`}
          </span>
          <span className="font-semibold">{activeLabel}</span>
        </span>
        {caption ? (
          <span
            className="max-w-[420px] truncate text-[11px]"
            style={{ color: choice ? '#ff8a00' : 'var(--panel-text-secondary)' }}
          >
            {caption}
          </span>
        ) : null}
      </div>

      {candidateControls}

      {canTakeOver ? (
        <button
          type="button"
          onClick={() => {
            // If a committed result is currently being revealed, skip the
            // camera flourish and preserve its exact Keep/Revert review. The
            // review store marks this as a decision request rather than
            // silently dropping the rollback closure into manual mode.
            abortChoreography()
            takeOver(activeLabel)
          }}
          title="Pause the agent and edit the structure yourself. Resume any time."
          className="zatom-pressable inline-flex h-6.5 items-center whitespace-nowrap rounded-full border border-[var(--panel-border)] px-3 text-[11.5px] font-medium hover:bg-[var(--panel-hover)]"
        >
          I&apos;ll take over
        </button>
      ) : null}
    </div>
  )
}
