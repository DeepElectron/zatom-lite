/** Apply or discard a pending structure proposal for the targeted viewport. */
import { useEffect, useRef, useState } from 'react'
import { useAgentProposalStore } from '../../../orchestration/agentProposalStore'
import { applyPendingProposal, discardPendingProposal } from '../../../agent/viewer-context'
import { useViewportManager } from '../../../orchestration/viewportManager'

export function AgentProposalCard() {
  const proposal = useAgentProposalStore((s) => s.current)
  const pending = proposal?.status === 'pending' || proposal?.status === 'applying' ? proposal : null
  const storeApplying = pending?.status === 'applying'
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const activeViewportId = useViewportManager((state) => state.activeViewportId)
  const maximizedViewportId = useViewportManager((state) => state.maximizedViewportId)
  const proposalIsHidden = !!pending && (
    activeViewportId !== pending.viewportId
    || (maximizedViewportId !== null && maximizedViewportId !== pending.viewportId)
  )
  const issues = pending?.checks?.filter((check) => check.status === 'warn' || check.status === 'fail') ?? []
  const hasFailedChecks = issues.some((check) => check.status === 'fail')

  useEffect(() => {
    busyRef.current = false
    setError(null)
    setBusy(false)
  }, [pending?.id, pending?.previewRevision])

  useEffect(() => {
    if (!pending) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (busyRef.current) return
      if (event.key === 'Enter') {
        event.preventDefault()
        void apply()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        discard()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.id, pending?.previewRevision])

  async function apply() {
    if (busyRef.current) return
    if (hasFailedChecks) {
      setError('This candidate has failed scientific checks and cannot be applied.')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      const outcome = await applyPendingProposal()
      if (!outcome.ok) setError(outcome.message)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function discard() {
    if (busyRef.current) return
    discardPendingProposal()
  }

  if (!pending) return null

  return (
    <div
      role="dialog"
      aria-label="Agent proposal"
      className="pointer-events-auto flex max-w-full flex-col gap-1.5 self-center rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3.5 py-2 text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
    >
      <div className="flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
        <span className="flex min-w-0 max-w-full items-baseline gap-2 text-[12px] whitespace-nowrap">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--panel-text-tertiary)]">Proposal</span>
          <span className="min-w-0 max-w-72 truncate font-semibold" title={pending.intent}>{pending.intent}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--panel-text-tertiary)]">{pending.diff.summary}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--panel-text-tertiary)]">
            {pending.viewportId} · workspace r{pending.workspaceRevision} · preview r{pending.previewRevision}
          </span>
        </span>

        <span className="text-[11.5px] text-[var(--panel-text-secondary)] whitespace-nowrap">Apply this?</span>

        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || storeApplying || hasFailedChecks}
            className="zatom-pressable inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11.5px] font-semibold disabled:opacity-60"
            style={{ background: 'var(--panel-accent)', color: '#fff' }}
          >
            {busy || storeApplying ? (proposalIsHidden ? 'Showing…' : 'Applying…') : (proposalIsHidden ? 'Show proposal' : 'Apply')}
            <kbd className="rounded-[3px] bg-white/25 px-1 text-[8.5px] leading-[13px] font-normal">↵</kbd>
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={busy || storeApplying}
            className="zatom-pressable inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11.5px] font-medium hover:bg-[var(--panel-hover)] disabled:opacity-50"
          >
            Discard
            <kbd className="rounded-[3px] border border-[var(--panel-border)] px-1 text-[8.5px] leading-[13px] font-normal">Esc</kbd>
          </button>
        </span>
      </div>
      {(issues.length > 0 || pending.previewComplete === false) && (
        <ul className="flex max-w-full flex-col gap-0.5 text-[10.5px] leading-relaxed text-[var(--panel-text-secondary)]">
          {pending.previewComplete === false ? <li>Preview detail is truncated; aggregate change counts are exact.</li> : null}
          {issues.slice(0, 3).map((check) => (
            <li key={check.id} className={check.status === 'fail' ? 'font-medium text-[var(--status-red)]' : ''}>
              {check.status === 'fail' ? 'Failed: ' : 'Warning: '}{check.message}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[11px] text-[var(--panel-text-secondary)]">{error}</p>
      )}
    </div>
  )
}
