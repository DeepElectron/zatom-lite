'use client'

/** Manual-control handoff for interruptible agent activity. */
import { useEffect, useState } from 'react'
import {
  useAgentOperationReview,
  selectManualControl,
  type AgentTakeoverIntent,
} from '../../../orchestration/agentOperationReviewStore'
import { getActiveViewportStoreApi } from '../../../orchestration/ViewportContext'
import { readWorkspaceRevision } from '../../../orchestration/workspaceRevisionTracker'

export function ManualControlBar() {
  const manualControl = useAgentOperationReview(selectManualControl)
  const resumeAgent = useAgentOperationReview((s) => s.resumeAgent)

  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null)
  useEffect(() => {
    if (!manualControl) return
    const api = getActiveViewportStoreApi()
    if (!api) return
    setHistoryIndex(api.getState().historyIndex)
    setWorkspaceRevision(readWorkspaceRevision(api as never))
    return api.subscribe((s) => {
      setHistoryIndex(s.historyIndex)
      setWorkspaceRevision(readWorkspaceRevision(api as never))
    })
  }, [manualControl])

  if (!manualControl) return null

  const editedByRevision = manualControl.workspaceRevisionAtTakeover != null
    && workspaceRevision != null
    && workspaceRevision !== manualControl.workspaceRevisionAtTakeover
  const editedByHistory = manualControl.historyIndexAtTakeover != null
    && historyIndex != null
    && historyIndex !== manualControl.historyIndexAtTakeover
  const edited = editedByRevision || editedByHistory

  const resume = (intent: AgentTakeoverIntent) => {
    resumeAgent(intent)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 self-center rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3.5 py-1.5 text-[var(--panel-text)] shadow-[0_10px_32px_rgba(0,0,0,0.22)] backdrop-blur-xl"
      style={{ pointerEvents: 'auto' }}
    >
      <span className="flex items-center gap-2 text-[12px] whitespace-nowrap">
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--panel-warning, #f5a524)' }}
        />
        <span className="font-semibold">You&apos;re editing manually</span>
        <span className="text-[11px] text-[var(--panel-text-tertiary)]">
          {manualControl.reverted ? 'reverted' : 'paused'} {manualControl.revertedLabel}
        </span>
      </span>

      <span className="inline-flex items-center gap-1">
        {edited && (
          <button
            type="button"
            onClick={() => resume('replan_from_edits')}
            title="Hand control back and have the agent re-plan from the structure as you left it"
            className="zatom-pressable inline-flex h-6.5 items-center rounded-full px-3 text-[11.5px] font-medium hover:bg-[var(--panel-hover)]"
          >
            Re-plan from my edits
          </button>
        )}
        <button
          type="button"
          onClick={() => resume('user_took_over')}
          title="Hand control back to the agent so it can modify the structure again"
          className="zatom-pressable inline-flex h-6.5 items-center rounded-full px-3 text-[11.5px] font-semibold"
          style={{ background: 'var(--panel-accent)', color: '#fff' }}
        >
          Resume agent
        </button>
      </span>
    </div>
  )
}
