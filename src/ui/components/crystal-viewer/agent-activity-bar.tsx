'use client'

/**
 * Consolidated viewport activity caption. Short operations are delayed to avoid
 * flashes; the action fast-forwards only skippable choreography to its final state.
 */
import { useEffect, useState } from 'react'
import { useChoreographyNarration } from '../../../orchestration/choreographyNarrationStore'
import {
  useAgentActivity,
  selectCurrentActivity,
  selectHasSkippableAnimation,
} from '../../../orchestration/agentActivityStore'
import { abortChoreography } from '../../../orchestration/modelingChoreographer'

const REVEAL_DELAY_MS = 400

export function AgentActivityBar() {
  const caption = useChoreographyNarration((s) => s.caption)
  const activity = useAgentActivity(selectCurrentActivity)
  const skippable = useAgentActivity(selectHasSkippableAnimation)

  const hasActivity = activity !== null
  const [delayPassed, setDelayPassed] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!hasActivity) {
      setDelayPassed(false)
      return
    }
    if (activity?.tier !== 'observe') {
      setDelayPassed(true)
      return
    }
    const timer = setTimeout(() => setDelayPassed(true), REVEAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [hasActivity, activity?.tier])

  useEffect(() => {
    if (!activity) {
      setElapsedSeconds(0)
      return
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - activity.startedAt) / 1000)))
    update()
    const timer = setInterval(update, 1_000)
    return () => clearInterval(timer)
  }, [activity?.id])

  const text = caption ?? activity?.label ?? null
  const visible = text !== null && (caption !== null || delayPassed)
  if (!visible) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        alignSelf: 'center',
        padding: skippable ? '5px 6px 5px 14px' : '6px 14px',
        borderRadius: 999,
        background: 'var(--panel-bg, rgba(28,28,30,0.85))',
        border: '1px solid var(--panel-border, rgba(255,255,255,0.1))',
        color: 'var(--panel-text, rgba(235,235,245,0.9))',
        fontSize: 12,
        fontWeight: 500,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        pointerEvents: skippable ? 'auto' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        data-agent-activity-dot
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: '#0A84FF',
          animation: 'zatom-activity-pulse 1.2s ease-in-out infinite',
        }}
      />
      <span>{text}</span>
      {activity?.viewportId ? (
        <span style={{ color: 'var(--panel-text-tertiary)', fontSize: 10 }}>
          {activity.host === 'webmcp' ? 'WebMCP · ' : ''}{activity.viewportId}
          {activity.workspaceRevision === undefined ? '' : ` · r${activity.workspaceRevision}`}
          {elapsedSeconds < 2 ? '' : ` · ${elapsedSeconds}s`}
        </span>
      ) : null}

      {skippable ? (
        <button
          type="button"
          onClick={() => abortChoreography()}
          style={{
            marginLeft: 4,
            padding: '3px 10px',
            borderRadius: 999,
            border: '1px solid var(--panel-border, rgba(255,255,255,0.18))',
            background: 'transparent',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Skip animation
        </button>
      ) : null}

      <style>{`
        @keyframes zatom-activity-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
        @media (prefers-reduced-motion: reduce) { [data-agent-activity-dot] { animation: none !important; } }
      `}</style>
    </div>
  )
}
