'use client'

/** Review gate for pending agent mutations, including stale-revision protection. */
import { useEffect, useRef, useState } from 'react'
import {
  useAgentOperationReview,
  setReviewHistoryIndexReader,
  setReviewWorkspaceRevisionReader,
  selectPendingReview,
  type AgentTakeoverIntent,
} from '../../../orchestration/agentOperationReviewStore'
import { getActiveViewportStoreApi } from '../../../orchestration/ViewportContext'
import { readWorkspaceRevision } from '../../../orchestration/workspaceRevisionTracker'
import { useViewportManager } from '../../../orchestration/viewportManager'

setReviewHistoryIndexReader(() => getActiveViewportStoreApi()?.getState().historyIndex ?? null)
setReviewWorkspaceRevisionReader(() => {
  const api = getActiveViewportStoreApi()
  return api ? readWorkspaceRevision(api as never) : null
})

export function AgentOperationReview() {
  const pending = useAgentOperationReview(selectPendingReview)
  const dismissReview = useAgentOperationReview((s) => s.dismissReview)
  const revertAndTakeOver = useAgentOperationReview((s) => s.revertAndTakeOver)
  const pendingOperations = useAgentOperationReview((s) => s.pendingOperations)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const activeViewportId = useViewportManager((state) => state.activeViewportId)
  const maximizedViewportId = useViewportManager((state) => state.maximizedViewportId)
  const reviewViewportId = pending?.subject.kind === 'structure' ? pending.subject.viewportId : undefined
  const reviewIsHidden = !!reviewViewportId && (
    activeViewportId !== reviewViewportId
    || (maximizedViewportId !== null && maximizedViewportId !== reviewViewportId)
  )

  useEffect(() => {
    busyRef.current = false
    setBusy(false)
    setError(null)
  }, [pending?.openedAt])

  const keep = () => {
    if (busyRef.current) return
    dismissReview()
  }

  const showReviewedViewport = () => {
    if (!reviewViewportId) return
    const manager = useViewportManager.getState()
    if (manager.maximizedViewportId && manager.maximizedViewportId !== reviewViewportId) {
      manager.toggleMaximized(reviewViewportId)
    } else {
      manager.setActive(reviewViewportId)
    }
  }

  const revert = async (intent: AgentTakeoverIntent) => {
    if (busyRef.current) return
    const subject = pending?.subject
    if (!subject) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await subject.revert()
      revertAndTakeOver(intent, { reverted: true })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // Taking control must never be held hostage by a failed rollback. Keep
      // the user's edit, mark it as paused (not reverted), and stop the Agent.
      if (intent === 'user_took_over') {
        revertAndTakeOver(intent, { reverted: false })
      } else {
        setError(message)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (busyRef.current) return
      // Never let a global shortcut decide a result the user cannot see.
      if (reviewIsHidden) return
      if (e.key === 'Enter') {
        e.preventDefault()
        keep()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        void revert('user_took_over')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, reviewIsHidden])

  if (!pending) return null

  const subject = pending.subject
  const anchorText = subject.kind === 'structure'
    ? (subject.atomDelta === 0
      ? 'same atom count'
      : `${subject.atomDelta > 0 ? '+' : ''}${subject.atomDelta} atoms`)
    : subject.summary
  const problems = subject.kind === 'structure'
    ? subject.health?.lines.filter((line) => line.status !== 'pass') ?? []
    : []

  return (
    <div
      role="dialog"
      aria-label="Review agent operation"
      className="flex max-w-full flex-col gap-1.5 self-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3.5 py-2 text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      style={{ pointerEvents: 'auto' }}
    >
      {problems.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-[11px] leading-relaxed">
          {problems.map((line, index) => (
            <li key={index} className="flex items-start gap-1.5">
              <span
                aria-hidden
                className="mt-[5px] size-1.5 shrink-0 rounded-full"
                style={{ background: line.status === 'fail' ? 'var(--panel-danger, #e5484d)' : 'var(--panel-warning, #f5a524)' }}
              />
              <span className={line.status === 'fail' ? 'font-medium' : 'text-[var(--panel-text-secondary)]'}>
                <span className="sr-only">{line.status === 'fail' ? 'Failed check: ' : 'Warning: '}</span>
                {line.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {subject.kind === 'structure' ? (
        <p className="text-[10px] font-medium text-[var(--panel-text-tertiary)]">
          {subject.health
            ? subject.health.verdict === 'pass' ? 'Checks passed' : `${problems.length} check issue${problems.length === 1 ? '' : 's'}`
            : 'Checks unavailable'}
          {subject.viewportId ? ` · ${subject.viewportId}` : ''}
          {subject.workspaceRevision === undefined ? '' : ` · r${subject.workspaceRevision}`}
        </p>
      ) : null}
      {pendingOperations > 1 ? (
        <p className="text-[10px] text-[var(--panel-text-tertiary)]">
          {pendingOperations - 1} later operation{pendingOperations === 2 ? '' : 's'} queued until you decide
        </p>
      ) : null}

      {/* Long operation labels truncate while the nonwrapping action group moves as a unit. */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
      <span className="flex min-w-0 max-w-full items-baseline gap-2 text-[12px]">
        <span className="min-w-0 truncate font-semibold" title={pending.label}>{pending.label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--panel-text-tertiary)]">{anchorText}</span>
      </span>

      <span className="shrink-0 text-[11.5px] text-[var(--panel-text-secondary)]">
        {problems.length ? 'Keep anyway?' : 'Look right?'}
      </span>

      <div className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
        {reviewIsHidden ? (
          <button
            type="button"
            onClick={showReviewedViewport}
            className="zatom-pressable inline-flex h-7 items-center rounded-full px-3 text-[11.5px] font-semibold"
            style={{ background: 'var(--panel-accent)', color: '#fff' }}
          >
            Show result in {reviewViewportId}
          </button>
        ) : <>
        <button
          type="button"
          onClick={keep}
          disabled={busy}
          className="zatom-pressable inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11.5px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--panel-accent)', color: '#fff' }}
        >
          Keep
          <kbd className="rounded-[3px] bg-white/25 px-1 text-[8.5px] leading-[13px] font-normal">↵</kbd>
        </button>
        <button
          type="button"
          onClick={() => { void revert('user_took_over') }}
          disabled={busy}
          title="Undo the agent's change and take over manually"
          className="zatom-pressable inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11.5px] font-medium hover:bg-[var(--panel-hover)]"
        >
          Revert &amp; I&apos;ll do it
          <kbd className="rounded-[3px] bg-[var(--panel-hover)] px-1 text-[8.5px] leading-[13px] font-normal text-[var(--panel-text-secondary)]">
            esc
          </kbd>
        </button>
        <details className="group relative">
          <summary className="zatom-pressable flex h-7 cursor-pointer list-none items-center rounded-full px-2.5 text-[11px] font-medium text-[var(--panel-text-secondary)] hover:bg-[var(--panel-hover)] [&::-webkit-details-marker]:hidden">
            More
          </summary>
          <span className="absolute right-0 bottom-[calc(100%+6px)] z-20 flex min-w-40 flex-col rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1.5 shadow-[0_10px_32px_rgba(0,0,0,0.24)] backdrop-blur-xl">
            {/* A preview-only request is not a rejection and must not pause the Agent. */}
            <button
              type="button"
              onClick={() => { void revert('preview_only') }}
              disabled={busy}
              title="Undo the change — you just wanted to see what it looks like"
              className="zatom-pressable h-7 rounded-lg px-2.5 text-left text-[11.5px] font-medium hover:bg-[var(--panel-hover)]"
            >
              Seen it, undo
            </button>
            <button
              type="button"
              onClick={() => { void revert('retry_differently') }}
              disabled={busy}
              title="Undo this change and let the agent try a different approach"
              className="zatom-pressable h-7 rounded-lg px-2.5 text-left text-[11.5px] font-medium hover:bg-[var(--panel-hover)]"
            >
              Try another way
            </button>
          </span>
        </details>
        </>}
      </div>
      </div>
      {error ? <p role="alert" className="text-[10px] text-[var(--status-red)]">{error}</p> : null}
    </div>
  )
}
