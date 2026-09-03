import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity,
  Box,
  Check,
  ChevronRight,
  Clock3,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FlaskConical,
  History,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Upload,
  X,
} from 'lucide-react'

import type { ZatomToolManifest } from '../../agent/contracts'
import type {
  ZatomDiscoveredProviderCapability,
  ZatomDiscoveredProviderManifest,
} from '../../agent/provider'
import { listZatomAgentTools } from '../../agent/tools'
import { ZATOM_TOOL_DOMAINS, zatomToolDomain, zatomToolDomainNames } from '../../agent/domains'
import { isReadOnlyTool } from '../../agent/webmcp-adapter'
import { createZatomWebMcpRuntimeProfile } from '../../agent/webmcp-runtime-profile'
import { useAgentToolDomains } from './agent-tool-domain-prefs'
import { readActiveViewportStructure } from '../../agent/viewer-context'
import { useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui-kit/dialog'
import { AgentSchemaFields } from './agent-modeling-fields'
import {
  agentFieldIsAdvanced,
  createAgentInputDraft,
  type AgentInputSchema,
  parseAgentInputDraft,
} from './agent-modeling-input'
import {
  initializeAgentModelingRunHistory,
  MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES,
} from './agent-modeling-history-db'
import {
  composeAgentModelingHistoryBundle,
  parseAgentModelingHistoryBundle,
  type AgentModelingHistoryBundle,
} from './agent-modeling-history-bundle'
import { AgentModelingResult } from './agent-modeling-result'
import { AgentModelingProjectTransfer } from './agent-modeling-project-transfer'
import { AgentMcpStatusCard } from './agent-mcp-status-card'
import { HostActivityList } from './host-access-controls'
import { AgentModelingTask } from './agent-modeling-task'
import { initializeAgentModelingTaskPersistence } from './agent-modeling-task-db'
import {
  agentToolProducesCandidate,
  countAgentModelingChecks,
  replaceAgentModelingRunHistory,
  useAgentModelingStore,
} from './agent-modeling-store'
import {
  agentModelingTaskOwnsWorkspace,
  useAgentModelingTaskStore,
} from './agent-modeling-task-store'

type WorkspaceTab = 'task' | 'tools' | 'engines' | 'runs'
/** Domain name, or 'all'. Domains come from the registry, not from this panel. */
type DomainFilter = string

interface ProviderSelection {
  provider: ZatomDiscoveredProviderManifest
  capability: ZatomDiscoveredProviderCapability
}

const manifests = listZatomAgentTools().sort((left, right) => left.title.localeCompare(right.title))
const DevAgentCliBridgeCard = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import('./agent-cli-bridge-card')
      return { default: module.AgentCliBridgeCard }
    })
  : null

/**
 * Grouping follows the registry's domains, because a domain is the unit the
 * agent actually gates on. The panel previously grouped by six hand-written
 * categories whose membership cut across domains — `build` alone drew from six
 * of them — so the set a user saw under a heading was not the set
 * `zatom_enable_domains` would turn on. Reusing the registry's map removes that
 * whole class of mismatch: there is one grouping, and both sides read it.
 */
const domainOrder: readonly string[] = zatomToolDomainNames()
const domainByName = new Map(ZATOM_TOOL_DOMAINS.map((domain) => [domain.name, domain] as const))
const toolsByDomain = new Map<string, ZatomToolManifest[]>(
  domainOrder.map((name) => [name, manifests.filter((tool) => zatomToolDomain(tool.name) === name)]),
)

function ModelingWorkflow({ activeIndex, complete, candidate }: { activeIndex: number; complete: boolean; candidate: boolean }) {
  const labels = candidate ? ['Select', 'Configure', 'Run', 'Verify', 'Apply'] : ['Select', 'Configure', 'Run', 'Review']
  return (
    <ol className="grid gap-1" aria-label="Modeling workflow" style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}>
      {labels.map((label, index) => {
        const done = complete || index < activeIndex
        const current = !complete && index === activeIndex
        return (
          <li key={label} className="min-w-0 text-center" aria-current={current ? 'step' : undefined}>
            <div
              className="mx-auto flex h-6 w-6 items-center justify-center rounded-full"
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: done || current ? 'var(--control-primary-text)' : 'var(--panel-text-tertiary)',
                background: done || current ? 'var(--control-primary-bg)' : 'var(--panel-elevated)',
                border: `1px solid ${done || current ? 'var(--control-selected-border)' : 'var(--panel-border)'}`,
              }}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
            </div>
            <span
              className="mt-1 block truncate"
              style={{ fontSize: 9, fontWeight: current ? 650 : 500, color: current ? 'var(--panel-text)' : 'var(--panel-text-tertiary)' }}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * Subject-matter facet, kept only for the row icon and as extra search text.
 * This used to be the panel's grouping key; it is deliberately no longer that,
 * because it cuts across domains and so cannot describe what an agent gets when
 * a domain is enabled. Anything load-bearing reads `zatomToolDomain` instead.
 */
type ToolFacet = 'chemistry' | 'trajectory' | 'providers' | 'structure'

function facetForTool(tool: ZatomToolManifest): ToolFacet {
  const name = tool.name
  if (name === 'modeling_run_provider') return 'providers'
  if (name.startsWith('trajectory_')) return 'trajectory'
  if (name.startsWith('molecule_') || name.startsWith('chemical_state_') || name.startsWith('microstate_')
    || name.startsWith('micro_pka_') || name.startsWith('force_field_')) return 'chemistry'
  return 'structure'
}

/**
 * The write/read badge derives from the registry's effects via the same
 * predicate the WebMCP adapter uses for `readOnlyHint`. Restating the rule here
 * is how this badge previously came to disagree with it: both had a
 * `workspace/visual !== 'write'` test that missed `structure: 'create'`, so a
 * tool that replaces the structure could read as safe.
 */
function effectLabel(tool: ZatomToolManifest): string {
  if (tool.name === 'modeling_route_capabilities' || tool.name === 'modeling_validate_plan') return 'ANALYZE'
  if (tool.name.startsWith('modeling_')) return 'ENGINE'
  if (agentToolProducesCandidate(tool)) return 'CANDIDATE'
  if (!isReadOnlyTool(tool)) return 'ACTION'
  if (tool.effects.structure === 'read' || tool.effects.workspace === 'read' || tool.effects.visual === 'read') return 'READ'
  return 'ANALYZE'
}

/** Named inputs an agent must supply, so a tool card shows its call shape. */
function requiredInputNames(tool: ZatomToolManifest): readonly string[] {
  const schema = tool.inputSchema as { required?: unknown }
  return Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === 'string')
    : []
}

function historyStatusColor(
  status: string,
  checks: { fail: number; warn: number; skipped: number },
) {
  if (status === 'error' || checks.fail) return 'var(--status-red)'
  if (status === 'cancelled') return 'var(--status-neutral)'
  if (checks.warn || checks.skipped) return 'var(--status-amber)'
  if (status === 'success' || status === 'ready') return 'var(--status-green)'
  return 'var(--panel-text-tertiary)'
}

function historyStatusLabel(
  status: string,
  checks: { fail: number; warn: number; skipped: number },
): string {
  if (status === 'error') return 'Error'
  if (status === 'cancelled') return 'Cancelled'
  if (checks.fail) return 'Failed checks'
  if (checks.warn || checks.skipped) return 'Review'
  return status === 'success' ? 'Completed' : status
}

function ToolCatalogRow({ tool, selected, onClick }: { tool: ZatomToolManifest; selected: boolean; onClick: () => void }) {
  const facet = facetForTool(tool)
  const writes = !isReadOnlyTool(tool)
  const required = requiredInputNames(tool)
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="zatom-choice zatom-pressable w-full rounded-lg px-3 py-2.5 text-left"
      data-selected={selected}
      style={{
        background: selected ? undefined : 'transparent',
        borderColor: selected ? undefined : 'transparent',
      }}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: selected ? 'var(--control-selected-border)' : 'var(--panel-elevated)' }}>
          {facet === 'chemistry' ? <FlaskConical className="h-4 w-4" />
            : facet === 'trajectory' ? <Activity className="h-4 w-4" />
              : facet === 'providers' ? <Cpu className="h-4 w-4" />
                : <Box className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span style={{ fontSize: 11, lineHeight: 1.35, fontWeight: 600, color: 'var(--panel-text)' }}>{tool.title}</span>
            <span
              className="shrink-0 rounded px-1.5 py-0.5"
              style={{
                fontSize: 8,
                fontWeight: 650,
                color: writes ? 'var(--status-amber)' : selected ? 'var(--control-selected-text)' : 'var(--panel-text-tertiary)',
                background: writes ? 'var(--status-amber-bg)' : 'var(--panel-hover)',
              }}
            >
              {effectLabel(tool)}
            </span>
          </div>
          <code className="mt-1 block truncate" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{tool.name}</code>
          {required.length ? (
            <div className="mt-1 truncate" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>
              needs {required.join(', ')}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  )
}

function ProviderCard({
  provider,
  activeAtomCount,
  onConfigure,
}: {
  provider: ZatomDiscoveredProviderManifest
  activeAtomCount: number
  onConfigure: (selection: ProviderSelection) => void
}) {
  return (
    <div className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--panel-text)' }}>{provider.title}</div>
          <div className="mt-1 truncate" style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>{provider.engine.name} {provider.engine.version} · adapter {provider.adapterVersion}</div>
        </div>
        <span className="zatom-choice shrink-0 rounded-full px-2 py-1 uppercase" style={{ fontSize: 8, fontWeight: 700 }}>
          {provider.execution}
        </span>
      </div>
      <p className="mt-2" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{provider.description}</p>
      <div className="mt-3 flex flex-col gap-2">
        {provider.capabilities.map((capability) => {
          const blocked = capability.source === 'required' && activeAtomCount === 0
          return (
            <div key={capability.id} className="rounded-lg p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-text)' }}>{capability.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded px-1.5 py-0.5" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)', background: 'var(--panel-elevated)' }}>{capability.fidelity}</span>
                    <span className="rounded px-1.5 py-0.5" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)', background: 'var(--panel-elevated)' }}>{capability.deterministic ? 'deterministic' : 'non-deterministic'}</span>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Configure ${capability.title}`}
                  disabled={blocked}
                  onClick={() => onConfigure({ provider, capability })}
                  className="zatom-primary zatom-pressable min-h-8 shrink-0 rounded-md px-2.5 py-1.5 text-[10px] font-semibold disabled:opacity-40"
                  title={blocked ? 'Load a structure into the active viewport first' : 'Configure this capability'}
                >
                  Configure
                </button>
              </div>
              {blocked ? <p className="mt-1.5" style={{ fontSize: 10, color: 'var(--status-amber)' }}>Requires an active structure.</p> : null}
              {capability.applicability?.scopeWarning ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[10px]" style={{ color: 'var(--status-amber)' }}>Applicability scope</summary>
                  <p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--panel-text-tertiary)' }}>{capability.applicability.scopeWarning}</p>
                </details>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AgentModelingPanel() {
  const atomCount = useCrystalStore((state) => state.atoms.length || state.compactStructure?.count || 0)
  const periodic = useCrystalStore((state) => state.periodic)
  const trajectoryCount = useCrystalStore((state) => state.trajectoryFrames?.length ?? 0)
  const canonicalPbc = readActiveViewportStructure()?.lattice?.periodic
  const boundaryStatus = canonicalPbc?.some(Boolean) && !canonicalPbc.every(Boolean)
    ? `${canonicalPbc.map((axis) => axis ? 'T' : 'F').join('')} PBC · finite view`
    : periodic ? 'periodic' : 'finite'
  const status = useAgentModelingStore((state) => state.status)
  const runningTool = useAgentModelingStore((state) => state.runningTool)
  const current = useAgentModelingStore((state) => state.current)
  const history = useAgentModelingStore((state) => state.history)
  const historyStatus = useAgentModelingStore((state) => state.historyStatus)
  const historyPersistenceError = useAgentModelingStore((state) => state.historyPersistenceError)
  const focusingTargetKey = useAgentModelingStore((state) => state.focusingTargetKey)
  const providers = useAgentModelingStore((state) => state.providers)
  const providersStatus = useAgentModelingStore((state) => state.providersStatus)
  const providersError = useAgentModelingStore((state) => state.providersError)
  const runTool = useAgentModelingStore((state) => state.runTool)
  const cancelRun = useAgentModelingStore((state) => state.cancelRun)
  const refreshProviders = useAgentModelingStore((state) => state.refreshProviders)
  const openHistoryRun = useAgentModelingStore((state) => state.openHistoryRun)
  const clearHistory = useAgentModelingStore((state) => state.clearHistory)
  const taskStatus = useAgentModelingTaskStore((state) => state.status)
  const taskPersistenceStatus = useAgentModelingTaskStore((state) => state.persistenceStatus)
  const taskActiveStepIndex = useAgentModelingTaskStore((state) => state.activeStepIndex)
  const taskSteps = useAgentModelingTaskStore((state) => state.steps)
  const taskOwnsWorkspace = agentModelingTaskOwnsWorkspace(taskStatus)
  const taskShowsCurrentResult = taskActiveStepIndex !== null
    && current?.manifest.name === taskSteps[taskActiveStepIndex]?.tool

  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('task')
  const [selectedName, setSelectedName] = useState('structure_validate')
  const [query, setQuery] = useState('')
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all')
  const [accessExpanded, setAccessExpanded] = useState(false)
  const { domains: enabledDomains, setDomains: setEnabledDomains } = useAgentToolDomains()
  const webMcpProfile = useMemo(
    () => createZatomWebMcpRuntimeProfile({ domains: enabledDomains }),
    [enabledDomains],
  )
  const [libraryExpanded, setLibraryExpanded] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>(() => createAgentInputDraft(manifests.find((tool) => tool.name === 'structure_validate')?.inputSchema as AgentInputSchema))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [providerSelection, setProviderSelection] = useState<ProviderSelection | null>(null)
  const [providerDraft, setProviderDraft] = useState<Record<string, string>>({})
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({})
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [pendingHistoryBundle, setPendingHistoryBundle] = useState<{
    bundle: AgentModelingHistoryBundle
    fileName: string
  } | null>(null)
  const [historyBundleError, setHistoryBundleError] = useState<string | null>(null)
  const [historyBundleNotice, setHistoryBundleNotice] = useState<string | null>(null)
  const draftCache = useRef(new Map<string, Record<string, string>>())
  const panelRef = useRef<HTMLDivElement>(null)
  const libraryRef = useRef<HTMLElement>(null)
  const configurationRef = useRef<HTMLElement>(null)
  const historyBundleInputRef = useRef<HTMLInputElement>(null)

  const scrollToPanelStart = () => {
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'start' }))
  }

  const selected = manifests.find((tool) => tool.name === selectedName) ?? manifests[0]
  const selectedSchema = selected.inputSchema as AgentInputSchema
  const producesCandidate = agentToolProducesCandidate(selected)
  const hasAdvanced = Object.keys(selectedSchema.properties ?? {}).some(agentFieldIsAdvanced)
    || (providerSelection !== null
      && Object.keys(providerSelection.capability.inputSchema.properties ?? {}).some(agentFieldIsAdvanced))
  const missingActiveStructure = atomCount === 0
    && selected.name !== 'modeling_run_provider'
    && Object.prototype.hasOwnProperty.call(selectedSchema.properties ?? {}, 'structure')
    && !draft.structure?.trim()
  const filteredTools = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return manifests.filter((tool) => (
      (domainFilter === 'all' || zatomToolDomain(tool.name) === domainFilter)
      // The facet stays searchable so the old vocabulary ("chemistry",
      // "trajectory") still finds tools even though it no longer groups them.
      && (!needle || [tool.title, tool.name, tool.description, facetForTool(tool), ...tool.tags].join(' ').toLowerCase().includes(needle))
    ))
  }, [domainFilter, query])
  const currentMatchesSelection = current?.manifest.name === selected.name
  const currentChecks = countAgentModelingChecks(currentMatchesSelection ? current.result.checks : undefined)
  const completeHistoryCount = history.reduce((count, run) => count + (run.completedRun ? 1 : 0), 0)
  const historyBundleBusy = historyStatus !== 'ready' || status === 'running' || !!focusingTargetKey || taskOwnsWorkspace
  const projectTransferBusy = historyBundleBusy || taskPersistenceStatus !== 'ready'
  let workflowIndex = 1
  let workflowComplete = false
  if (status === 'running' && runningTool?.name === selected.name) {
    workflowIndex = 2
  } else if (currentMatchesSelection) {
    if (producesCandidate) {
      workflowIndex = current.candidate && currentChecks.fail === 0 ? 4 : 3
      workflowComplete = current.application?.applicationVerified === true
    } else {
      workflowIndex = 3
      workflowComplete = current.result.ok && currentChecks.fail === 0
    }
  }

  useEffect(() => {
    if ((workspaceTab === 'task' || workspaceTab === 'engines') && providersStatus === 'idle') void refreshProviders()
  }, [providersStatus, refreshProviders, workspaceTab])

  useEffect(() => {
    if (historyStatus === 'idle') void initializeAgentModelingRunHistory().catch(() => {})
  }, [historyStatus])

  useEffect(() => {
    if (historyStatus === 'ready' && taskPersistenceStatus === 'idle') {
      void initializeAgentModelingTaskPersistence().catch(() => {})
    }
  }, [historyStatus, taskPersistenceStatus])

  const chooseTool = (name: string, preset: Record<string, unknown> = {}, provider: ProviderSelection | null = null) => {
    draftCache.current.set(selectedName, draft)
    const tool = manifests.find((item) => item.name === name)
    if (!tool) return
    const cached = draftCache.current.get(name)
    setSelectedName(name)
    setDraft(cached && !Object.keys(preset).length ? cached : createAgentInputDraft(tool.inputSchema as AgentInputSchema, preset))
    setErrors({})
    setShowAdvanced(false)
    setProviderSelection(provider)
    setProviderDraft(provider ? createAgentInputDraft(provider.capability.inputSchema as AgentInputSchema) : {})
    setProviderErrors({})
    setWorkspaceTab('tools')
    setLibraryExpanded(false)
    requestAnimationFrame(() => configurationRef.current?.scrollIntoView({ block: 'start' }))
  }

  const configureProvider = (selection: ProviderSelection) => {
    chooseTool('modeling_run_provider', {
      providerId: selection.provider.id,
      capability: selection.capability.id,
      expectedProviderCapabilityFingerprint: selection.capability.fingerprint,
      useActiveStructure: selection.capability.source === 'required',
      useActiveTrajectory: selection.capability.continuation?.mode === 'required' ? true : undefined,
      seed: 42,
      parameters: {},
    }, selection)
  }

  const openToolLibrary = () => {
    setLibraryExpanded(true)
    requestAnimationFrame(() => libraryRef.current?.scrollIntoView({ block: 'start' }))
  }

  const execute = () => {
    if (historyStatus !== 'ready' || taskOwnsWorkspace) return
    const parsed = parseAgentInputDraft(selectedSchema, draft)
    let parameters: Record<string, unknown> | undefined
    let nestedErrors: Record<string, string> = {}
    if (providerSelection && selected.name === 'modeling_run_provider') {
      const nested = parseAgentInputDraft(providerSelection.capability.inputSchema as AgentInputSchema, providerDraft)
      parameters = nested.input
      nestedErrors = nested.errors
    }
    setErrors(parsed.errors)
    setProviderErrors(nestedErrors)
    if (Object.keys(parsed.errors).length || Object.keys(nestedErrors).length) {
      requestAnimationFrame(() => {
        const field = panelRef.current?.querySelector<HTMLElement>('[data-agent-field-error="true"]')
        field?.scrollIntoView({ block: 'center' })
        field?.querySelector<HTMLElement>('input, select, textarea')?.focus()
      })
      return
    }
    const input = parameters ? { ...parsed.input, parameters } : parsed.input
    void runTool(selected, input)
  }

  const exportHistoryBundle = () => {
    try {
      const bundle = composeAgentModelingHistoryBundle(history)
      const payload = JSON.stringify(bundle)
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `zatom-modeling-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setHistoryBundleError(null)
      setHistoryBundleNotice(`Exported ${bundle.runs.length} fingerprint-verified run${bundle.runs.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setHistoryBundleNotice(null)
      setHistoryBundleError(error instanceof Error ? error.message : String(error))
    }
  }

  const stageHistoryBundle = async (file: File) => {
    setHistoryBundleError(null)
    setHistoryBundleNotice(null)
    try {
      if (file.size > MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES) {
        throw new Error(`Run bundle is ${file.size} bytes; the limit is ${MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES} bytes`)
      }
      const text = await file.text()
      const bundle = parseAgentModelingHistoryBundle(JSON.parse(text) as unknown)
      setPendingHistoryBundle({ bundle, fileName: file.name })
    } catch (error) {
      setPendingHistoryBundle(null)
      setHistoryBundleError(error instanceof Error ? error.message : String(error))
    }
  }

  const importPendingHistoryBundle = () => {
    if (!pendingHistoryBundle) return
    try {
      replaceAgentModelingRunHistory(pendingHistoryBundle.bundle.runs)
      const count = pendingHistoryBundle.bundle.runs.length
      setHistoryBundleNotice(`Imported ${count} verified run${count === 1 ? '' : 's'} from ${pendingHistoryBundle.fileName}.`)
      setHistoryBundleError(null)
      setPendingHistoryBundle(null)
      setWorkspaceTab('runs')
      scrollToPanelStart()
    } catch (error) {
      setHistoryBundleNotice(null)
      setHistoryBundleError(error instanceof Error ? error.message : String(error))
      setPendingHistoryBundle(null)
    }
  }

  const tabs: Array<{ id: WorkspaceTab; label: string; icon: ReactNode; count?: number }> = [
    { id: 'task', label: 'MCP', icon: <Server className="h-3.5 w-3.5" /> },
    { id: 'tools', label: 'Tools', icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
    { id: 'engines', label: 'Engines', icon: <Cpu className="h-3.5 w-3.5" />, count: providers.length },
    { id: 'runs', label: 'Runs', icon: <History className="h-3.5 w-3.5" />, count: history.length },
  ]

  return (
    <div ref={panelRef} className="agent-modeling flex flex-col gap-4">
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Server className="h-[18px] w-[18px]" style={{ color: 'var(--control-selected-text)' }} />
              <h2 style={{ fontSize: 15, lineHeight: 1.2, fontWeight: 680, letterSpacing: '-0.01em', color: 'var(--panel-text)' }}>Agent Access</h2>
            </div>
            <p className="mt-1.5" style={{ maxWidth: 265, fontSize: 11, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>
              Inspect MCP access, local engines, and verified Agent operations.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="rounded-full px-2.5 py-1" style={{ fontSize: 10, fontWeight: 600, color: atomCount ? 'var(--panel-text-secondary)' : 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}>
              {atomCount.toLocaleString()} atoms
            </span>
            <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{boundaryStatus}{trajectoryCount ? ` · ${trajectoryCount} frames` : ''}</span>
          </div>
        </div>

        <div role="tablist" aria-label="Agent workspace sections" className="mt-4 grid grid-cols-4 gap-1 rounded-xl p-1" style={{ background: 'var(--panel-hover)', border: '1px solid var(--panel-border)' }}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={workspaceTab === item.id}
              disabled={taskOwnsWorkspace && item.id !== 'task'}
              onClick={() => { setWorkspaceTab(item.id); scrollToPanelStart();  }}
              className="zatom-pressable flex min-h-9 items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-35"
              style={{ color: workspaceTab === item.id ? 'var(--panel-text)' : 'var(--panel-text-tertiary)', background: workspaceTab === item.id ? 'var(--panel-hover)' : 'transparent' }}
            >
              {item.icon}{item.label}{item.count ? <span className="rounded-full px-1.5" style={{ fontSize: 8, background: 'var(--panel-hover)' }}>{item.count}</span> : null}
            </button>
          ))}
        </div>
      </header>

      {workspaceTab === 'tools' ? (
        <div className="rounded-xl p-3" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
          <ModelingWorkflow activeIndex={workflowIndex} complete={workflowComplete} candidate={producesCandidate} />
        </div>
      ) : null}

      {workspaceTab === 'task' && (
        <>
          <AgentMcpStatusCard
            providers={providers}
            providersStatus={providersStatus}
            providersError={providersError}
            onRefreshProviders={() => void refreshProviders()}
          />
          {DevAgentCliBridgeCard ? (
            <Suspense fallback={null}>
              <DevAgentCliBridgeCard />
            </Suspense>
          ) : null}
          <section aria-label="Agent activity across hosts" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
            <HostActivityList />
          </section>
          <AgentModelingTask />
          {taskShowsCurrentResult ? <AgentModelingResult /> : null}
        </>
      )}

      {historyStatus === 'idle' || historyStatus === 'loading' ? (
        <div className="flex items-center gap-2 rounded-xl p-3 text-[11px]" role="status" aria-live="polite" style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying saved modeling runs…
        </div>
      ) : null}
      {historyStatus === 'error' ? (
        <div className="rounded-xl p-3 text-[11px]" role="alert" style={{ color: 'var(--status-red)', border: '1px solid var(--status-red-border)', background: 'var(--status-red-bg)' }}>
          {historyPersistenceError ?? 'Persistent modeling run history is unavailable.'}
        </div>
      ) : null}

      {workspaceTab === 'tools' && (
        <>
          <section aria-labelledby="agent-tool-access-title" className="rounded-xl p-4" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="agent-tool-access-title" className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 650, color: 'var(--panel-text)' }}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Agent access
                </h3>
                <p className="mt-0.5" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-tertiary)' }}>
                  WebMCP exposes {webMcpProfile.tools.core.length} essential tools directly, plus {webMcpProfile.tools.facade.length} discovery tools for the {webMcpProfile.tools.available}-tool registry.
                  Domains limit what may run, and only you can widen access here.
                </p>
              </div>
              <button
                type="button"
                aria-expanded={accessExpanded}
                onClick={() => setAccessExpanded((value) => !value)}
                className="zatom-pressable flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[10px] font-medium"
                style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
              >
                <ChevronRight className={`h-3 w-3 transition-transform ${accessExpanded ? 'rotate-90' : ''}`} />
                {accessExpanded ? 'Hide' : 'Configure'}
              </button>
            </div>

            <p aria-live="polite" className="mt-2" style={{ fontSize: 10, color: 'var(--panel-text-secondary)' }}>
              Allowing{' '}
              <strong style={{ color: 'var(--panel-text)' }}>
                {webMcpProfile.tools.callable} of {webMcpProfile.tools.available} registry tools
              </strong>{' '}
              through {webMcpProfile.tools.registered} stable WebMCP descriptors across {enabledDomains.length} of {domainOrder.length} domains.
            </p>

            {accessExpanded ? (
              <ul className="mt-3 flex flex-col gap-1">
                {domainOrder.map((name) => {
                  const domain = domainByName.get(name)
                  const tools = toolsByDomain.get(name) ?? []
                  const on = enabledDomains.includes(name)
                  // `session` carries core discovery and routing tools. The
                  // registry keeps it enabled for every host, so the switch
                  // reflects that invariant instead of offering a choice that
                  // would be silently overridden.
                  const locked = name === 'session'
                  const writeCount = tools.filter((tool) => !isReadOnlyTool(tool)).length
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`Expose ${name} domain to agents`}
                        disabled={locked}
                        onClick={() => {
                          setEnabledDomains(on
                            ? enabledDomains.filter((entry) => entry !== name)
                            : [...enabledDomains, name])
                        }}
                        className="zatom-pressable flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left"
                        style={{
                          background: on ? 'var(--panel-hover)' : 'transparent',
                          border: '1px solid',
                          borderColor: on ? 'var(--panel-border)' : 'transparent',
                          cursor: locked ? 'default' : undefined,
                          opacity: locked ? 0.75 : 1,
                        }}
                      >
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded"
                          style={{
                            background: on ? 'var(--control-selected-border)' : 'var(--panel-bg)',
                            border: '1px solid var(--panel-border)',
                            color: 'var(--control-selected-text)',
                          }}
                        >
                          {on ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-text)' }}>{name}</span>
                            <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{tools.length} registry tools</span>
                            {writeCount ? (
                              <span className="rounded px-1" style={{ fontSize: 8, fontWeight: 650, color: 'var(--status-amber)', background: 'var(--status-amber-bg)' }}>
                                {writeCount} write
                              </span>
                            ) : null}
                            {locked ? (
                              <span className="rounded px-1" style={{ fontSize: 8, fontWeight: 650, color: 'var(--panel-text-tertiary)', background: 'var(--panel-bg)' }}>
                                always on
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block" style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
                            {domain?.summary ?? ''}
                          </span>
                        </span>
                        <span aria-hidden className="mt-0.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }}>
                          {on ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </section>

          <section ref={libraryRef} aria-labelledby="agent-tool-library-title" className="scroll-mt-4">
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h3 id="agent-tool-library-title" style={{ fontSize: 12, fontWeight: 650, color: 'var(--panel-text)' }}>Tool library</h3>
                <p className="mt-0.5" style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>Choose one narrow operation, then configure it below.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {libraryExpanded ? <span aria-live="polite" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{filteredTools.length} of {manifests.length}</span> : null}
                <button
                  type="button"
                  aria-expanded={libraryExpanded}
                  onClick={() => libraryExpanded ? setLibraryExpanded(false) : openToolLibrary()}
                  className="zatom-pressable flex min-h-8 items-center gap-1 rounded-lg px-2 text-[10px] font-medium"
                  style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
                >
                  <ChevronRight className={`h-3 w-3 transition-transform ${libraryExpanded ? 'rotate-90' : ''}`} />
                  {libraryExpanded ? 'Hide' : 'Change tool'}
                </button>
              </div>
            </div>
            {libraryExpanded ? <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4" style={{ color: 'var(--panel-text-tertiary)' }} />
              <input
                aria-label="Search modeling tools"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setQuery('') }}
                placeholder={`Search ${manifests.length} tools`}
                className="h-10 w-full rounded-xl pl-9 pr-10 text-[12px] outline-none"
                style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear tool search"
                  onClick={() => setQuery('')}
                  className="zatom-pressable absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg"
                  style={{ color: 'var(--panel-text-tertiary)' }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-1 custom-scrollbar" role="group" aria-label="Filter tools by domain">
              <button
                type="button"
                aria-pressed={domainFilter === 'all'}
                onClick={() => setDomainFilter('all')}
                className="zatom-choice zatom-pressable shrink-0 rounded-full px-3 py-1.5 text-[10px] font-medium"
                data-selected={domainFilter === 'all'}
              >
                All
              </button>
              {domainOrder.map((name) => {
                const count = toolsByDomain.get(name)?.length ?? 0
                const off = !enabledDomains.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={domainFilter === name}
                    onClick={() => setDomainFilter(name)}
                    className="zatom-choice zatom-pressable flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-medium"
                    data-selected={domainFilter === name}
                    // A withheld domain stays browsable — the catalog documents
                    // what zatom can do, not only what is switched on — but it
                    // must not read as available to an agent right now.
                    title={off ? `${name} — not exposed to agents` : name}
                  >
                    {off ? <EyeOff className="h-3 w-3" style={{ color: 'var(--panel-text-tertiary)' }} /> : null}
                    {name}
                    <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl p-1 custom-scrollbar" aria-label="Filtered modeling tools" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-bg)' }}>
              {filteredTools.length ? filteredTools.map((tool) => (
                <ToolCatalogRow key={tool.name} tool={tool} selected={tool.name === selected.name} onClick={() => chooseTool(tool.name)} />
              )) : <p className="p-5 text-center text-[11px]" style={{ color: 'var(--panel-text-tertiary)' }}>No tools match this search and domain.</p>}
            </div>
            </> : null}
          </section>

          <section ref={configurationRef} aria-labelledby="selected-modeling-tool" className="scroll-mt-4 rounded-xl p-4" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 id="selected-modeling-tool" style={{ fontSize: 13, lineHeight: 1.35, fontWeight: 650, color: 'var(--panel-text)' }}>{selected.title}</h3>
                <code className="mt-1 block truncate" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{selected.name} · v{selected.version}</code>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!libraryExpanded ? (
                  <button
                    type="button"
                    onClick={openToolLibrary}
                    className="zatom-pressable flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-medium"
                    style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
                  >
                    <Search className="h-3 w-3" /> Change
                  </button>
                ) : null}
                <span className="rounded px-2 py-1" style={{ fontSize: 8, fontWeight: 700, color: selected.effects.workspace === 'write' || selected.effects.visual === 'write' ? 'var(--status-amber)' : 'var(--control-selected-text)', background: selected.effects.workspace === 'write' || selected.effects.visual === 'write' ? 'var(--status-amber-bg)' : 'var(--control-selected-bg)' }}>
                  {effectLabel(selected)}
                </span>
              </div>
            </div>
            <p className="mt-2" style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--panel-text-secondary)' }}>{selected.description}</p>

            <div className="mt-3">
              <AgentSchemaFields
                schema={selectedSchema}
                draft={draft}
                errors={errors}
                showAdvanced={showAdvanced}
                omit={[
                  ...(producesCandidate ? ['applyToWorkspace', 'captureAfter'] : []),
                  ...(providerSelection && selected.name === 'modeling_run_provider'
                    ? [
                        'providerId',
                        'capability',
                        'expectedProviderCapabilityFingerprint',
                        'requiredProviderCapabilityTags',
                        'parameters',
                      ]
                    : []),
                ]}
                onChange={(name, value) => {
                  setDraft((current) => ({ ...current, [name]: value }))
                  if (errors[name]) setErrors((current) => ({ ...current, [name]: '' }))
                }}
              />
            </div>

            {providerSelection && selected.name === 'modeling_run_provider' ? (
              <div className="mt-4 rounded-lg p-3" style={{ border: '1px solid var(--control-selected-border)', background: 'var(--control-selected-bg)' }}>
                <div className="mb-3">
                  <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--panel-text)' }}>{providerSelection.capability.title}</div>
                  <p className="mt-1" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{providerSelection.capability.description}</p>
                  <code className="mt-1.5 block truncate" title={providerSelection.capability.fingerprint} style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
                    Engine identity · {providerSelection.capability.fingerprint}
                  </code>
                </div>
                <AgentSchemaFields
                  schema={providerSelection.capability.inputSchema as AgentInputSchema}
                  draft={providerDraft}
                  errors={providerErrors}
                  showAdvanced={showAdvanced}
                  onChange={(name, value) => {
                    setProviderDraft((current) => ({ ...current, [name]: value }))
                    if (providerErrors[name]) setProviderErrors((current) => ({ ...current, [name]: '' }))
                  }}
                />
              </div>
            ) : null}

            {hasAdvanced ? (
              <button type="button" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)} className="zatom-pressable mt-3 flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                <ChevronRight className={`h-3 w-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
                {showAdvanced ? 'Hide advanced parameters' : 'Show advanced parameters'}
              </button>
            ) : null}

            <div className="mt-4 flex gap-2">
              {status === 'running' ? (
                <>
                  <button type="button" disabled className="zatom-primary flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[11px] font-semibold" style={{ opacity: 0.75 }}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {current?.candidate ? 'Committing verified write…' : runningTool?.title ?? 'Running'}
                  </button>
                  {!current?.candidate ? (
                    <button type="button" aria-label="Cancel modeling run" onClick={cancelRun} className="zatom-pressable flex h-10 w-10 items-center justify-center rounded-lg" style={{ color: 'var(--status-red)', border: '1px solid var(--status-red-border)', background: 'var(--status-red-bg)' }} title="Cancel run">
                      <Square className="h-3.5 w-3.5 fill-current" />
                    </button>
                  ) : null}
                </>
              ) : (
                <button type="button" disabled={missingActiveStructure || historyStatus !== 'ready' || taskOwnsWorkspace} onClick={execute} className="zatom-primary zatom-pressable flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40">
                  <Play className="h-3.5 w-3.5 fill-current" /> {producesCandidate ? 'Generate candidate' : selected.effects.workspace === 'write' || selected.effects.visual === 'write' ? 'Run action' : 'Run inspection'}
                </button>
              )}
            </div>
            {producesCandidate ? (
              <div className="mt-2 flex items-start gap-1.5" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-tertiary)' }}>
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" style={{ color: 'var(--control-selected-text)' }} />
                The active workspace is unchanged until numeric checks pass and you press Apply.
              </div>
            ) : null}
            {missingActiveStructure ? (
              <p className="mt-2" role="status" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--status-amber)' }}>
                Load a structure into the active viewport, or provide an explicit structure artifact under Advanced.
              </p>
            ) : null}
          </section>

          <AgentModelingResult />
        </>
      )}

      {workspaceTab === 'engines' && (
        <section className="flex flex-col gap-3" role="tabpanel" aria-label="Engines">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--panel-text)' }}>Registered engines</div>
              <p className="mt-1" style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>Only host-verified capabilities are shown. Missing engines are never substituted.</p>
            </div>
            <button type="button" aria-label="Refresh provider discovery" onClick={() => void refreshProviders()} disabled={providersStatus === 'loading'} className="zatom-pressable flex h-9 w-9 items-center justify-center rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)' }} title="Refresh providers">
              <RefreshCw className={`h-3.5 w-3.5 ${providersStatus === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {providersStatus === 'loading' ? <div className="flex items-center justify-center gap-2 rounded-xl p-6 text-[11px]" role="status" style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}><Loader2 className="h-4 w-4 animate-spin" /> Discovering local capabilities…</div> : null}
          {providersStatus === 'error' ? <div className="rounded-xl p-3 text-[11px]" role="alert" style={{ color: 'var(--status-red)', border: '1px solid var(--status-red-border)', background: 'var(--status-red-bg)' }}>{providersError}</div> : null}
          {providersStatus === 'ready' && !providers.length ? <div className="rounded-xl p-4 text-center text-[11px]" style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}>No providers are registered in this browser. Built-in structure tools remain available in Workbench.</div> : null}
          {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} activeAtomCount={atomCount} onConfigure={configureProvider} />)}
        </section>
      )}

      {workspaceTab === 'runs' && (
        <section role="tabpanel" aria-label="Saved runs">
          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--panel-text)' }}>Projects & runs</div>
            <p className="mt-1" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-tertiary)' }}>Move one complete modeling project, or manage its individual fingerprinted run evidence.</p>
          </div>
          <div className="mt-3">
            <AgentModelingProjectTransfer activeAtomCount={atomCount} busy={projectTransferBusy} />
          </div>
          <div className="mt-4">
            <div style={{ fontSize: 11, fontWeight: 650, color: 'var(--panel-text)' }}>Run archive</div>
            <p className="mt-0.5" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>Reopen or transfer up to 12 complete runs without replacing the active structure.</p>
          </div>
          <input
            ref={historyBundleInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Choose modeling history bundle"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void stageHistoryBundle(file)
            }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={historyBundleBusy}
              onClick={() => historyBundleInputRef.current?.click()}
              className="zatom-pressable flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              <Upload className="h-3.5 w-3.5" /> Import bundle
            </button>
            {completeHistoryCount ? (
              <button
                type="button"
                disabled={historyBundleBusy}
                onClick={exportHistoryBundle}
                className="zatom-pressable flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
              >
                <Download className="h-3.5 w-3.5" /> Export {completeHistoryCount === history.length ? 'all' : completeHistoryCount}
              </button>
            ) : null}
            {history.length ? (
              <button
                type="button"
                disabled={historyBundleBusy}
                onClick={() => setConfirmClearHistory(true)}
                className="zatom-pressable min-h-9 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ border: '1px solid var(--status-red-border)', color: 'var(--status-red)', background: 'var(--status-red-bg)' }}
              >
                Delete all
              </button>
            ) : null}
          </div>
          {historyBundleNotice ? (
            <div className="mt-3 rounded-lg px-3 py-2 text-[10px] leading-relaxed" role="status" aria-live="polite" style={{ color: 'var(--status-green)', border: '1px solid var(--status-green-border)', background: 'var(--status-green-bg)' }}>
              {historyBundleNotice}
            </div>
          ) : null}
          {historyBundleError ? (
            <div className="mt-3 rounded-lg px-3 py-2 text-[10px] leading-relaxed" role="alert" style={{ color: 'var(--status-red)', border: '1px solid var(--status-red-border)', background: 'var(--status-red-bg)' }}>
              {historyBundleError}
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            {history.length ? history.map((run) => (
              <button
                key={run.id}
                type="button"
                disabled={!run.completedRun || status === 'running' || !!focusingTargetKey || taskOwnsWorkspace}
                onClick={() => {
                  if (!openHistoryRun(run.id)) return
                  setWorkspaceTab('tools')
                  scrollToPanelStart()
                }}
                className="zatom-choice zatom-pressable w-full rounded-xl p-3 text-left disabled:cursor-default"
                data-selected={current?.id === run.id}
                style={{
                  opacity: run.completedRun ? 1 : 0.7,
                }}
                title={run.completedRun ? 'Open the complete run and its visual evidence' : 'Cancelled before a complete run artifact was available'}
              >
                <div className="flex items-start gap-2">
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: historyStatusColor(run.status, run.checks) }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-text)' }}>{run.title}</span>
                      <span className="uppercase" style={{ fontSize: 8, fontWeight: 700, color: historyStatusColor(run.status, run.checks) }}>{historyStatusLabel(run.status, run.checks)}</span>
                    </div>
                    <p className="mt-1 line-clamp-2" style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--panel-text-secondary)' }}>{run.summary}</p>
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
                      <span>{(run.durationMs / 1000).toFixed(2)}s</span>
                      {run.checks.pass ? <span style={{ color: 'var(--status-green)' }}>{run.checks.pass} pass</span> : null}
                      {run.checks.warn ? <span style={{ color: 'var(--status-amber)' }}>{run.checks.warn} warn</span> : null}
                      {run.checks.fail ? <span style={{ color: 'var(--status-red)' }}>{run.checks.fail} fail</span> : null}
                      {run.application ? <span className="uppercase" style={{ color: run.application === 'verified' ? 'var(--status-green)' : run.application === 'blocked' ? 'var(--status-red)' : 'var(--status-amber)' }}>{run.application}</span> : null}
                      {run.completedRun?.targetEvidenceBundle.length ? <span style={{ color: 'var(--status-neutral)' }}>{run.completedRun.targetEvidenceBundle.length} evidence</span> : null}
                    </div>
                  </div>
                  {run.completedRun ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} /> : null}
                </div>
              </button>
            )) : <div className="rounded-xl p-6 text-center" style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text-tertiary)', fontSize: 11 }}>No saved modeling runs yet.</div>}
          </div>
        </section>
      )}

      <Dialog open={confirmClearHistory} onOpenChange={setConfirmClearHistory}>
        <DialogContent
          className="max-w-sm rounded-2xl"
          style={{ color: 'var(--panel-text)', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
        >
          <DialogHeader>
            <DialogTitle>Delete all saved runs?</DialogTitle>
            <DialogDescription style={{ color: 'var(--panel-text-secondary)' }}>
              This permanently removes every browser-local modeling run and its stored visual evidence. The active structure is not changed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => { setConfirmClearHistory(false);  }}
              className="zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold"
              style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              Keep runs
            </button>
            <button
              type="button"
              onClick={() => {
                clearHistory()
                setHistoryBundleNotice(null)
                setHistoryBundleError(null)
                setConfirmClearHistory(false)
              }}
              className="zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold"
              style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}
            >
              Delete saved runs
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingHistoryBundle !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingHistoryBundle(null)
          }
        }}
      >
        <DialogContent
          className="max-w-sm rounded-2xl"
          style={{ color: 'var(--panel-text)', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
        >
          <DialogHeader>
            <DialogTitle>{history.length ? 'Replace saved runs?' : 'Import verified run bundle?'}</DialogTitle>
            <DialogDescription style={{ color: 'var(--panel-text-secondary)' }}>
              {pendingHistoryBundle
                ? `${pendingHistoryBundle.fileName} contains ${pendingHistoryBundle.bundle.runs.length} complete, fingerprint-verified run${pendingHistoryBundle.bundle.runs.length === 1 ? '' : 's'}.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {pendingHistoryBundle ? (
            <div className="rounded-lg p-3" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
              <div className="uppercase" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.06em', color: 'var(--panel-text-tertiary)' }}>Bundle fingerprint</div>
              <code className="mt-1.5 block break-all" style={{ fontSize: 9, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{pendingHistoryBundle.bundle.fingerprint}</code>
            </div>
          ) : null}
          <p style={{ fontSize: 10, lineHeight: 1.55, color: history.length ? 'var(--status-amber)' : 'var(--panel-text-tertiary)' }}>
            {history.length ? `Import replaces all ${history.length} current browser-local run${history.length === 1 ? '' : 's'}. ` : ''}
            The active structure is unchanged. Imported screenshots remain bound to their original fingerprints; focusing them still requires the same active structure or trajectory identity.
          </p>
          <DialogFooter>
            <button
              type="button"
              onClick={() => { setPendingHistoryBundle(null);  }}
              className="zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold"
              style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              {history.length ? 'Keep current runs' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={importPendingHistoryBundle}
              className={history.length
                ? 'zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold text-[var(--status-amber)]'
                : 'zatom-primary zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold'}
              style={history.length ? { background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' } : undefined}
            >
              {history.length ? 'Replace and import' : 'Import bundle'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
