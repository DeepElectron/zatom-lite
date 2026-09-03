/**
 * Live view of the dev-server CLI bridge: how to attach a terminal agent, and
 * how much that agent may change. What it has done is in the shared activity
 * list below this card.
 */

import { useEffect, useState } from 'react'
import { Clipboard, PlugZap, Terminal } from 'lucide-react'

import { useCliBridgeActivity, type ZatomCliBridgeConnection } from '../../orchestration/cliBridgeActivity'
import { zatomBridgeInstanceId } from '../../devbridge/browser-viewport-host'
import { ZATOM_TOOL_DOMAINS } from '../../agent/domains'
import { HostWriteModeControl } from './host-access-controls'

interface BridgeInstance {
  instanceId: string
  label: string
  openUrl: string
}

/**
 * Peers attached to the same bridge, polled from the dev-server health route.
 *
 * The page cannot learn this from its own stream — each tab only sees its own
 * traffic — and a stale list is worse than none, because the ids are what an
 * agent pastes to target a window. Polling keeps it honest as tabs come and go.
 */
function useBridgeInstances(active: boolean): BridgeInstance[] {
  const [instances, setInstances] = useState<BridgeInstance[]>([])
  useEffect(() => {
    if (!active) {
      setInstances([])
      return
    }
    let cancelled = false
    const read = async () => {
      try {
        const response = await fetch('/__zatom-cli/health', { headers: { accept: 'application/json' } })
        if (!response.ok) return
        const payload = await response.json() as { instances?: BridgeInstance[] }
        if (!cancelled) setInstances(Array.isArray(payload.instances) ? payload.instances : [])
      } catch {
        // The bridge only exists under the dev server; a failed poll just means
        // no peer list this tick, so keep the last good one.
      }
    }
    void read()
    const timer = window.setInterval(() => { void read() }, 5_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [active])
  return instances
}

function connectionTone(connection: ZatomCliBridgeConnection): { badge: string; detail: string; color: string; border: string; background: string } {
  if (connection === 'connected') {
    return {
      badge: 'Bound',
      detail: 'This tab is attached to the bridge as its own instance. CLI tool calls read and commit its active viewport directly.',
      color: 'var(--status-green)',
      border: 'var(--status-green-border)',
      background: 'var(--status-green-bg)',
    }
  }
  if (connection === 'connecting') {
    return {
      badge: 'Connecting',
      detail: 'Attaching this tab to the dev-server bridge. CLI calls fail closed until the stream is open.',
      color: 'var(--status-amber)',
      border: 'var(--status-amber-border)',
      background: 'var(--status-amber-bg)',
    }
  }
  if (connection === 'error') {
    return {
      badge: 'Disconnected',
      detail: 'The bridge stream closed. Reload this tab to re-register it with the bridge.',
      color: 'var(--status-red)',
      border: 'var(--status-red-border, var(--panel-border))',
      background: 'var(--status-red-bg, var(--panel-elevated))',
    }
  }
  return {
    badge: 'Unavailable',
    detail: 'The CLI bridge runs only under the local development server.',
    color: 'var(--status-neutral)',
    border: 'var(--status-neutral-border)',
    background: 'var(--status-neutral-bg)',
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setState('failed')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
      window.setTimeout(() => setState('idle'), 1_800)
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <span className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>{label}</span>
        <button
          type="button"
          className="zatom-pressable flex min-h-7 items-center gap-1.5 rounded-md px-2"
          style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}
          onClick={() => { void copy() }}
          aria-live="polite"
        >
          <Clipboard className="h-3 w-3" /> {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <code className="mt-1.5 block select-all break-all" style={{ fontSize: 9, lineHeight: 1.5, color: 'var(--panel-text)' }}>{value}</code>
    </div>
  )
}

export function AgentCliBridgeCard() {
  const connection = useCliBridgeActivity((state) => state.connection)
  const registerCodex = useCliBridgeActivity((state) => state.registerCodex)
  const registerClaude = useCliBridgeActivity((state) => state.registerClaude)
  const endpoint = useCliBridgeActivity((state) => state.endpoint)
  // Must run before the early return below, or the hook order changes between
  // renders as the connection state settles.
  const instances = useBridgeInstances(connection === 'connected')

  if (connection === 'unsupported' && !endpoint) return null

  const tone = connectionTone(connection)
  const instanceId = zatomBridgeInstanceId()
  const defaultDomains = ZATOM_TOOL_DOMAINS.filter((domain) => domain.enabledByDefault)

  return (
    <section aria-labelledby="agent-cli-bridge-title" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PlugZap className="h-4 w-4 shrink-0" style={{ color: 'var(--control-selected-text)' }} />
            <h3 id="agent-cli-bridge-title" style={{ fontSize: 13, fontWeight: 680, color: 'var(--panel-text)' }}>Terminal CLI bridge</h3>
          </div>
          <p className="mt-1.5" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{tone.detail}</p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-1 uppercase" style={{ fontSize: 8, fontWeight: 750, color: tone.color, border: `1px solid ${tone.border}`, background: tone.background }}>
          {tone.badge}
        </span>
      </div>

      {endpoint ? (
        <div className="mt-3 rounded-lg px-2.5 py-2" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <div className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>Endpoint</div>
          <code className="mt-1 block truncate" title={endpoint} style={{ fontSize: 9, color: 'var(--panel-text)' }}>{endpoint}</code>
          {connection === 'connected' ? (
            <>
              <div className="mt-2 uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>
                Attached instance{instances.length > 1 ? `s (${instances.length})` : ''}
              </div>
              <ul className="mt-1 grid gap-1">
                {(instances.length > 0 ? instances : [{ instanceId, label: '', openUrl: '' }]).map((peer) => {
                  const isSelf = peer.instanceId === instanceId
                  return (
                    <li key={peer.instanceId} className="flex items-center justify-between gap-2">
                      <code className="min-w-0 truncate" title={peer.instanceId} style={{ fontSize: 9, color: isSelf ? 'var(--panel-text)' : 'var(--panel-text-secondary)' }}>
                        {peer.instanceId}
                      </code>
                      {isSelf ? (
                        <span className="shrink-0 rounded-full px-1.5 uppercase" style={{ fontSize: 8, fontWeight: 750, color: 'var(--status-green)', border: '1px solid var(--status-green-border)' }}>
                          This tab
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <p className="mt-1" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
                {instances.length > 1
                  ? <>Several tabs are attached, so a write must name its target — pass one of these as <code>instanceId</code>.</>
                  : <>With more than one tab open, pass this as <code>instanceId</code> to target this window.</>}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {registerCodex && registerClaude ? (
        <details className="mt-3 rounded-lg" style={{ border: '1px solid var(--panel-border)' }}>
          <summary className="zatom-pressable flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 text-[10px] font-semibold" style={{ color: 'var(--panel-text-secondary)' }}>
            <Terminal className="h-3.5 w-3.5" /> Attach Codex or Claude Code
          </summary>
          <div className="grid gap-2 px-2.5 pb-2.5">
            <CopyRow label="Codex" value={registerCodex} />
            <CopyRow label="Claude Code" value={registerClaude} />
            <p style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
              Loopback only, with a new bearer token each dev-server start. The same values are written to
              {' '}<code>.zatom/cli-bridge.json</code>, which is git-ignored.
            </p>
          </div>
        </details>
      ) : null}

      <details className="mt-3 rounded-lg" style={{ border: '1px solid var(--panel-border)' }}>
        <summary className="zatom-pressable flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 text-[10px] font-semibold" style={{ color: 'var(--panel-text-secondary)' }}>
          <span>Tool domains</span>
          <span style={{ fontSize: 9, fontWeight: 500, color: 'var(--panel-text-tertiary)' }}>
            {defaultDomains.length} on by default
          </span>
        </summary>
        <div className="grid gap-1 px-2.5 pb-2.5">
          {ZATOM_TOOL_DOMAINS.map((domain) => (
            <div key={domain.name} className="flex items-baseline justify-between gap-2">
              <code style={{ fontSize: 9, color: domain.enabledByDefault ? 'var(--panel-text)' : 'var(--panel-text-tertiary)' }}>{domain.name}</code>
              <span className="shrink-0" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
                {domain.tools.length} tool{domain.tools.length === 1 ? '' : 's'}{domain.enabledByDefault ? '' : ' · on request'}
              </span>
            </div>
          ))}
          <p style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
            A fresh connection lists only the default domains, keeping the tool listing small. An agent opens
            the rest with <code>zatom_enable_domains</code>; which ones are live is per-CLI-session, so it is
            not shown here.
          </p>
        </div>
      </details>

      <HostWriteModeControl host="cli-bridge" />
    </section>
  )
}
