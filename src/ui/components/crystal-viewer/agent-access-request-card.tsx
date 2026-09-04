import { Clock3, ShieldCheck } from 'lucide-react'

import { ZATOM_TOOL_DOMAINS } from '../../../agent/domains'
import { ZATOM_HOST_WRITE_MODE_LABEL } from '../../../agent/host-access-policy'
import { useHostAccess } from '../../../orchestration/hostAccessStore'
import {
  useWebMcpAccess,
  webMcpAccessBroker,
  type WebMcpAccessDecision,
} from '../../../orchestration/webMcpAccessStore'
import { useAgentToolDomains } from '../../panels/agent-tool-domain-prefs'

const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  session: 'Zatom session',
  guide: 'Visual guidance',
  viewport: 'Shared viewport',
  assets: 'Local assets',
  io: 'Structure import and export',
  edit: 'Modeling previews',
  'direct-edit': 'Direct structure edits',
  surface: 'Surface modeling',
  build: 'Structure builders',
  trajectory: 'Trajectory analysis',
  chemstate: 'Chemical-state analysis',
  evidence: 'Scientific evidence tools',
  provider: 'External providers',
}
const DOMAIN_IMPACT: Readonly<Record<string, string>> = {
  session: 'Lets the Agent inspect Zatom capabilities. It cannot change the workspace.',
  guide: 'Lets the Agent point, label, highlight, and ask about candidates. It cannot change atoms.',
  viewport: 'Lets the Agent inspect the scene and guide your camera or layout. Workspace changes still follow the current Apply policy.',
  assets: 'May inspect compatible files in a folder you already chose and mount an asset into the workspace.',
  io: 'May prepare structure imports or exports. Applying an imported structure still follows the current preview and review policy.',
  edit: 'Lets the Agent measure, select, and prepare ghost edits for you to inspect before Apply.',
  'direct-edit': 'May change the live structure without a ghost preview. Review and Undo remain available.',
  surface: 'Lets the Agent analyze surfaces and prepare slab, vacuum, and adsorption candidates.',
  build: 'Lets the Agent create candidate crystals, molecules, interfaces, and other structures.',
  trajectory: 'Lets the Agent run trajectory analyses without changing the active structure.',
  chemstate: 'Lets the Agent analyze chemical states, populations, and structural ensembles.',
  evidence: 'Lets the Agent compose and validate scientific evidence records.',
  provider: 'May invoke a local or remote modeling provider. A remote provider can receive model data outside this browser; spending still requires a separate exact-price approval.',
}

const TOOL_IMPACT: Readonly<Record<string, string>> = {
  compute_prepare_boltz_job: 'Sends the prepared Boltz request payload to the configured Boltz service to obtain a cost estimate. This does not spend credits; the exact price still requires a separate confirmation.',
}

// File access, direct writes, and providers are too broad to make permanent
// from a conversational request. They can still be configured deliberately in
// Agent Access, where the complete domain is visible.
const CONVERSATIONAL_ALWAYS_DOMAINS = new Set([
  'guide',
  'viewport',
  'io',
  'edit',
  'surface',
  'build',
  'trajectory',
  'chemstate',
  'evidence',
])

const CONVERSATIONAL_SESSION_DOMAINS = new Set(CONVERSATIONAL_ALWAYS_DOMAINS)

/**
 * A just-in-time WebMCP permission handshake inside the shared viewport.
 * The Agent can wait on the request, while the user stays in the modeling
 * context and can grant the smallest useful scope without hunting in Settings.
 */
export function AgentAccessRequestCard() {
  const request = useWebMcpAccess((state) => state.pendingRequests[0] ?? null)
  const pendingCount = useWebMcpAccess((state) => state.pendingRequests.length)
  const { domains, setDomains } = useAgentToolDomains()
  const writeMode = useHostAccess((state) => state.modes.webmcp)

  if (!request) return null

  const domain = ZATOM_TOOL_DOMAINS.find((candidate) => candidate.name === request.domain)
  const label = DOMAIN_LABELS[request.domain] ?? request.domain
  const impact = TOOL_IMPACT[request.tool]
    ?? DOMAIN_IMPACT[request.domain]
    ?? domain?.summary
    ?? 'Makes this Zatom capability available to the Agent.'
  const canAlwaysAllow = CONVERSATIONAL_ALWAYS_DOMAINS.has(request.domain)
  const canAllowForSession = CONVERSATIONAL_SESSION_DOMAINS.has(request.domain)

  const decide = (decision: WebMcpAccessDecision) => {
    // Persist first so an Always grant survives navigation. The broker also
    // grants it immediately, avoiding a race with React's next render.
    if (decision === 'always' && !domains.includes(request.domain)) {
      setDomains([...domains, request.domain])
    }
    webMcpAccessBroker.resolve(request.id, decision)
  }

  return (
    <section
      role="dialog"
      aria-labelledby="agent-access-request-title"
      aria-describedby="agent-access-request-impact"
      className="pointer-events-auto flex w-[min(620px,calc(100vw-32px))] max-w-full flex-col gap-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 text-[var(--panel-text)] shadow-[0_14px_40px_rgba(0,0,0,0.24)] backdrop-blur-xl"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ color: 'var(--control-selected-text)', background: 'var(--control-selected-bg)' }}
        >
          <ShieldCheck className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h2 id="agent-access-request-title" className="text-[12px] font-semibold">
              Agent requests {label}
            </h2>
            {request.tool ? (
              <code className="max-w-full truncate text-[9.5px] text-[var(--panel-text-tertiary)]" title={request.tool}>
                {request.tool}
              </code>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--panel-text-secondary)]">
            {request.reason}
          </p>
        </div>
      </div>

      <p
        id="agent-access-request-impact"
        className="rounded-lg px-2.5 py-2 text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]"
        style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}
      >
        {impact}
      </p>

      {request.details?.length ? (
        <div className="rounded-lg px-2.5 py-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
          <p className="text-[8.5px] font-semibold uppercase tracking-wide text-[var(--panel-text-tertiary)]">
            Verified request details
          </p>
          <ul className="mt-1 grid gap-0.5 text-[9.5px] leading-relaxed text-[var(--panel-text-secondary)]">
            {request.details.map((detail) => (
              <li key={detail} className="break-words">{detail}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[9px] text-[var(--panel-text-tertiary)]">
        Current apply policy: <strong className="font-semibold text-[var(--panel-text-secondary)]">{ZATOM_HOST_WRITE_MODE_LABEL[writeMode].title}</strong>
        {' · '}{ZATOM_HOST_WRITE_MODE_LABEL[writeMode].detail}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => decide('once')}
          className="zatom-pressable min-h-8 rounded-full px-3 text-[10.5px] font-semibold"
          style={{ color: '#fff', background: 'var(--panel-accent)' }}
        >
          Allow once
        </button>
        {canAllowForSession ? (
          <button
            type="button"
            onClick={() => decide('session')}
            className="zatom-pressable min-h-8 rounded-full px-3 text-[10.5px] font-medium"
            style={{ color: 'var(--panel-text)', border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}
          >
            This session
          </button>
        ) : null}
        {canAlwaysAllow ? (
          <button
            type="button"
            onClick={() => decide('always')}
            className="zatom-pressable min-h-8 rounded-full px-3 text-[10.5px] font-medium"
            style={{ color: 'var(--panel-text-secondary)' }}
          >
            Always allow
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => decide('deny')}
          className="zatom-pressable ml-auto min-h-8 rounded-full px-3 text-[10.5px] font-medium"
          style={{ color: 'var(--panel-text-secondary)' }}
        >
          Deny
        </button>
        <span className="flex items-center gap-1 text-[9px] text-[var(--panel-text-tertiary)]" title="The Agent stops waiting after 15 seconds">
          <Clock3 className="size-3" aria-hidden /> 15s
        </span>
      </div>

      {pendingCount > 1 ? (
        <p className="text-[9px] text-[var(--panel-text-tertiary)]">
          {pendingCount - 1} more access request{pendingCount === 2 ? '' : 's'} waiting
        </p>
      ) : null}
    </section>
  )
}
