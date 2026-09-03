/**
 * The two controls that turn the Agent Access panel from a status board into a
 * control surface: the per-host write mode, and the cross-host call timeline.
 * Both read the same store the registry consults, so what is shown is what is
 * enforced.
 */

import { Ban, Globe, Terminal } from 'lucide-react'

import {
  ZATOM_AGENT_HOST_LABEL,
  ZATOM_HOST_WRITE_MODES,
  ZATOM_HOST_WRITE_MODE_LABEL,
  type ZatomAgentHost,
  type ZatomHostWriteMode,
} from '../../agent/host-access-policy'
import { useHostAccess, type ZatomHostActivity } from '../../orchestration/hostAccessStore'

const HOST_ICON: Record<ZatomAgentHost, typeof Globe> = {
  webmcp: Globe,
  'cli-bridge': Terminal,
}

const HOST_SHORT: Record<ZatomAgentHost, string> = {
  webmcp: 'WebMCP',
  'cli-bridge': 'CLI',
}

export function hostWriteModeBadge(mode: ZatomHostWriteMode): string {
  return ZATOM_HOST_WRITE_MODE_LABEL[mode].title
}

/** Segmented control for one host's write mode. Applies on the next tool call. */
export function HostWriteModeControl({ host }: { host: ZatomAgentHost }) {
  const mode = useHostAccess((state) => state.modes[host])
  const setMode = useHostAccess((state) => state.setMode)
  const groupId = `host-write-mode-${host}`
  return (
    <div className="mt-2 rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <div className="flex items-center justify-between gap-2">
        <span id={groupId} className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>
          Write mode
        </span>
        <span style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>{ZATOM_AGENT_HOST_LABEL[host]}</span>
      </div>
      <div role="radiogroup" aria-labelledby={groupId} className="mt-1.5 grid grid-cols-3 gap-1">
        {ZATOM_HOST_WRITE_MODES.map((candidate) => {
          const selected = candidate === mode
          return (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(host, candidate)}
              className="zatom-pressable min-h-7 rounded-md px-1.5"
              style={{
                fontSize: 9,
                fontWeight: selected ? 700 : 550,
                color: selected ? 'var(--control-selected-text)' : 'var(--panel-text-secondary)',
                background: selected ? 'var(--control-selected-bg)' : 'transparent',
                border: `1px solid ${selected ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
              }}
            >
              {ZATOM_HOST_WRITE_MODE_LABEL[candidate].title}
            </button>
          )
        })}
      </div>
      <p className="mt-1.5" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
        {ZATOM_HOST_WRITE_MODE_LABEL[mode].detail}
      </p>
    </div>
  )
}

function timeLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function ActivityRow({ entry }: { entry: ZatomHostActivity }) {
  const Icon = HOST_ICON[entry.host]
  const verdict = entry.deniedByPolicy ? 'denied' : entry.ok ? 'ok' : 'failed'
  const verdictColor = entry.ok ? 'var(--status-green)' : entry.deniedByPolicy ? 'var(--status-amber)' : 'var(--status-red)'
  return (
    <li className="rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3 w-3 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} aria-hidden />
          <span className="sr-only">{ZATOM_AGENT_HOST_LABEL[entry.host]}</span>
          <span className="truncate" style={{ fontSize: 10, fontWeight: 650, color: 'var(--panel-text)' }}>{entry.tool}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 uppercase" style={{ fontSize: 8, fontWeight: 750, color: verdictColor }}>
          {entry.deniedByPolicy ? <Ban className="h-2.5 w-2.5" aria-hidden /> : null}
          {verdict}
        </span>
      </div>
      {entry.argsSummary ? (
        <code className="mt-0.5 block truncate" title={entry.argsSummary} style={{ fontSize: 9, color: 'var(--panel-text-secondary)' }}>{entry.argsSummary}</code>
      ) : null}
      {entry.error && !entry.deniedByPolicy ? (
        <p className="mt-0.5" role="alert" style={{ fontSize: 9, lineHeight: 1.4, color: 'var(--status-red)' }}>{entry.error}</p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
        <span>{HOST_SHORT[entry.host]}</span>
        <span>{timeLabel(entry.at)}</span>
        <span>{entry.durationMs.toLocaleString()} ms</span>
        {entry.viewportOps === undefined ? null : <span>{entry.viewportOps} viewport op{entry.viewportOps === 1 ? '' : 's'}</span>}
        {entry.atomCount === undefined ? null : <span>{entry.atomCount.toLocaleString()} atoms committed</span>}
      </div>
    </li>
  )
}

/** Every agent call from every host, newest first. */
export function HostActivityList() {
  const activities = useHostAccess((state) => state.activities)
  const denied = activities.filter((entry) => entry.deniedByPolicy).length
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>Live activity · all hosts</span>
        <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>
          {activities.length} call{activities.length === 1 ? '' : 's'}{denied > 0 ? ` · ${denied} denied` : ''}
        </span>
      </div>
      {activities.length === 0 ? (
        <p className="mt-1.5 rounded-lg px-2.5 py-2" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
          No agent tool calls yet. Calls from the in-page agent and the CLI bridge appear here, tagged by host, the moment they land.
        </p>
      ) : (
        <ol className="mt-1.5 grid max-h-64 gap-1.5 overflow-y-auto" aria-live="polite">
          {activities.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
        </ol>
      )}
    </div>
  )
}
