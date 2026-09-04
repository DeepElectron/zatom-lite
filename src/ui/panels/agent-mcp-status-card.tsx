import { useMemo } from 'react'
import {
  Cable,
  Cpu,
  Eye,
  Globe,
  Loader2,
  RefreshCw,
  Users,
  Wrench,
} from 'lucide-react'

import { createZatomWebMcpRuntimeProfile } from '../../agent/webmcp-runtime-profile'
import type { ZatomDiscoveredProviderManifest } from '../../agent/provider'
import { useHostAccess } from '../../orchestration/hostAccessStore'
import { selectCurrentActivity, useAgentActivity } from '../../orchestration/agentActivityStore'
import { selectManualControl, useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import { useWebMcpAccess } from '../../orchestration/webMcpAccessStore'
import { useAgentToolDomains } from './agent-tool-domain-prefs'
import { HostWriteModeControl, hostWriteModeBadge } from './host-access-controls'

interface AgentMcpStatusCardProps {
  providers: readonly ZatomDiscoveredProviderManifest[]
  providersStatus: 'idle' | 'loading' | 'ready' | 'error'
  providersError: string | null
  onRefreshProviders: () => void
}

function Fact({ label, value, title = value }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-lg px-2.5 py-2" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
      <dt className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>{label}</dt>
      <dd className="mt-1 truncate" title={title} style={{ fontSize: 11, fontWeight: 650, color: 'var(--panel-text)' }}>{value}</dd>
    </div>
  )
}


function lastRequestLabel(value: string | null): string {
  if (!value) return 'None yet'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Invalid timestamp' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function AgentMcpStatusCard({
  providers,
  providersStatus,
  providersError,
  onRefreshProviders,
}: AgentMcpStatusCardProps) {
  const webMcpRegistration = useHostAccess((state) => state.webMcpRegistration)
  const latestWebMcpCall = useHostAccess((state) => state.activities.find((entry) => entry.host === 'webmcp') ?? null)
  const inPageAvailable = webMcpRegistration.state === 'registered'
  const { domains: agentDomains } = useAgentToolDomains()
  const inPage = useMemo(() => createZatomWebMcpRuntimeProfile({ domains: agentDomains }), [agentDomains])
  const webMcpMode = useHostAccess((state) => state.modes.webmcp)
  const currentAgentActivity = useAgentActivity(selectCurrentActivity)
  const pendingAccessRequests = useWebMcpAccess((state) => state.pendingRequests.length)
  const manualControl = useAgentOperationReview(selectManualControl)
  const localStatus = providersStatus === 'loading' || providersStatus === 'idle'
    ? 'Checking…'
    : 'Browser registry'
  const webMcpPresence = pendingAccessRequests > 0
    ? { label: 'Waiting for your choice', detail: 'A capability request is open in the shared viewport.', color: 'var(--status-amber)' }
    : manualControl
      ? { label: 'Paused — manual control', detail: 'The Agent can observe, but workspace edits stay paused until you hand control back.', color: 'var(--status-amber)' }
      : currentAgentActivity?.host === 'webmcp'
        ? { label: 'Agent active now', detail: currentAgentActivity.label, color: 'var(--status-green)' }
        : inPageAvailable
          ? { label: 'Ready for Agent', detail: 'In-page tools are ready. This does not imply that an Agent is currently connected.', color: 'var(--status-green)' }
          : webMcpRegistration.state === 'registering'
            ? { label: 'Preparing…', detail: 'Registering the current capability surface.', color: 'var(--status-neutral)' }
            : webMcpRegistration.state === 'error'
              ? { label: 'Registration failed', detail: webMcpRegistration.error ?? 'The in-page tool surface could not start.', color: 'var(--status-red)' }
              : { label: 'Stopped', detail: 'This page is not exposing WebMCP tools.', color: 'var(--status-neutral)' }

  return (
    <section aria-labelledby="agent-mcp-status-title" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
      <div
        aria-label="In-page WebMCP status"
        className="mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
        style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}
      >
        <Globe className="size-4 shrink-0" style={{ color: webMcpPresence.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--panel-text)' }}>In-page WebMCP</span>
            <span className="text-[8px] font-bold uppercase tracking-wide" style={{ color: webMcpPresence.color }}>{webMcpPresence.label}</span>
          </div>
          <p className="mt-0.5 truncate text-[9px]" title={webMcpPresence.detail} style={{ color: 'var(--panel-text-tertiary)' }}>
            {webMcpPresence.detail}
          </p>
        </div>
        <span className="shrink-0 text-[8px]" style={{ color: 'var(--panel-text-tertiary)' }}>
          {webMcpRegistration.registeredTools} tools
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 shrink-0" style={{ color: 'var(--control-selected-text)' }} />
        <h3 id="agent-mcp-status-title" style={{ fontSize: 13, fontWeight: 680, color: 'var(--panel-text)' }}>Web Agent Access</h3>
      </div>
      <p className="mt-1.5" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>
        WebMCP operates directly on this browser viewport. The development CLI bridge is shown separately when available.
      </p>

      <details className="mt-3 rounded-lg" style={{ border: '1px solid var(--panel-border)' }}>
        <summary className="zatom-pressable flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-2.5 text-[10px] font-semibold" style={{ color: 'var(--panel-text-secondary)' }}>
          <span className="flex items-center gap-2"><Globe className="h-3.5 w-3.5" /> In-page WebMCP</span>
          <span className="flex items-center gap-1.5 uppercase" style={{ fontSize: 8 }}>
            <span style={{ color: 'var(--panel-text-tertiary)' }}>{hostWriteModeBadge(webMcpMode)}</span>
            <span style={{ color: inPageAvailable ? 'var(--status-green)' : 'var(--status-neutral)' }}>
              {webMcpRegistration.state === 'registered'
                ? `${webMcpRegistration.registeredTools} tools registered`
                : webMcpRegistration.state === 'registering' ? 'Registering…'
                  : webMcpRegistration.state === 'error' ? 'Registration failed' : 'No agent host'}
            </span>
          </span>
        </summary>
        <div className="px-2.5 pb-2.5">
          <dl className="grid grid-cols-2 gap-2">
            <Fact label="Port" value="None" />
            <Fact label="Configured callable" value={inPage.tools.callable.toLocaleString()} />
            <Fact label="Tools registered" value={`${webMcpRegistration.registeredTools}/${inPage.tools.registered}`} />
            <Fact label="Core directly visible" value={inPage.tools.core.length.toLocaleString()} />
            <Fact label="Facade" value={inPage.tools.facade.length.toLocaleString()} />
            <Fact label="Access handshake" value={inPage.tools.system.length ? 'Available' : 'Unavailable'} />
            <Fact label="Last sync" value={lastRequestLabel(latestWebMcpCall?.at ?? null)} />
          </dl>
          {webMcpRegistration.error ? (
            <p role="alert" className="mt-2 text-[9px]" style={{ color: 'var(--status-red)' }}>{webMcpRegistration.error}</p>
          ) : null}
          <HostWriteModeControl host="webmcp" />
          <div className="mt-2 grid gap-1.5 text-[9px]" style={{ color: 'var(--panel-text-tertiary)' }}>
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><Cable className="h-3 w-3" /> Endpoint</span><code>{inPage.transport.endpoint}</code></div>
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><Wrench className="h-3 w-3" /> Read-only tools</span><span>{inPage.tools.readOnly}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><Eye className="h-3 w-3" /> Focus &amp; capture</span><span>{inPage.visual.focus && inPage.visual.capture ? 'Available' : 'Unavailable'}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><Users className="h-3 w-3" /> Workspace</span><span>Shared with you</span></div>
          </div>
          <p className="mt-2" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
            When registration succeeds, the page exposes the enabled portion of {inPage.tools.core.length} essential collaboration tools directly, keeps {inPage.tools.facade.length} discovery tools for the rest of the registry, and leaves the access handshake available. Direct tools appear or disappear as access changes; stale calls are still rejected at execution. This stays below the browser&apos;s descriptor budget while avoiding discovery work for ordinary tasks. Visual tools run against the live viewport and share its workspace with you. This host defaults to Propose only: it may build and ghost, you press Apply. Exposure ends on navigation.
          </p>
        </div>
      </details>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5" style={{ fontSize: 10, fontWeight: 650, color: 'var(--panel-text)' }}>
            <Cpu className="h-3.5 w-3.5" /> Available modeling providers
          </div>
          <p className="mt-0.5 truncate" role={providersError ? 'alert' : undefined} style={{ fontSize: 9, color: providersError ? 'var(--status-red)' : 'var(--panel-text-tertiary)' }}>
            {providersError ?? `${localStatus} · ${providers.length} modeling provider${providers.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh modeling provider status"
          title="Refresh modeling provider status"
          disabled={providersStatus === 'loading'}
          onClick={onRefreshProviders}
          className="zatom-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-40"
          style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}
        >
          {providersStatus === 'loading' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
    </section>
  )
}
