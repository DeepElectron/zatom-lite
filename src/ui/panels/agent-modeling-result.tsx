import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  GitBranch,
  Loader2,
  Redo2,
  ShieldAlert,
  Target,
  Undo2,
  XCircle,
} from 'lucide-react'

import type { InspectionTarget, ValidationCheck } from '../../agent/contracts'
import {
  agentModelingVisualBinding,
  agentModelingInspectionTargetKey,
  agentModelingVerifiedTargetEvidence,
  collectAgentInspectionTargets,
  composeAgentModelingRunArtifact,
  countAgentModelingChecks,
  useAgentModelingStore,
} from './agent-modeling-store'
import {
  composeAgentModelingDependencyGraph,
  type AgentModelingDependencyGraph,
  type AgentModelingDependencyNode,
} from './agent-modeling-provenance'

type ResultTab = 'checks' | 'targets' | 'provenance' | 'details'

const statusColor = {
  pass: 'var(--status-green)',
  warn: 'var(--status-amber)',
  fail: 'var(--status-red)',
  skipped: 'var(--status-neutral)',
} as const

const statusBackground = {
  pass: 'var(--status-green-bg)',
  warn: 'var(--status-amber-bg)',
  fail: 'var(--status-red-bg)',
  skipped: 'var(--status-neutral-bg)',
} as const

const statusBorder = {
  pass: 'var(--status-green-border)',
  warn: 'var(--status-amber-border)',
  fail: 'var(--status-red-border)',
  skipped: 'var(--status-neutral-border)',
} as const

function StatusIcon({ status }: { status: ValidationCheck['status'] }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5" />
  if (status === 'warn') return <AlertTriangle className="h-3.5 w-3.5" />
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5" />
  return <span className="h-3.5 w-3.5 rounded-full border" />
}

interface DependencyNodeTone {
  foreground: string
  border: string
}

function dependencyNodeTone(node: AgentModelingDependencyNode): DependencyNodeTone {
  if (node.kind === 'run') return { foreground: 'var(--control-selected-text)', border: 'var(--control-selected-border)' }
  if (node.kind === 'provider' || node.kind === 'engine') return { foreground: 'var(--panel-text-secondary)', border: 'var(--panel-border-focus)' }
  if (node.kind === 'visual-evidence') return { foreground: 'var(--status-green)', border: 'var(--status-green-border)' }
  if (node.kind === 'domain-artifact') return { foreground: 'var(--panel-text-secondary)', border: 'var(--panel-border-focus)' }
  return { foreground: 'var(--panel-text-secondary)', border: 'var(--panel-border)' }
}

function DependencyNodeCard({ node }: { node: AgentModelingDependencyNode }) {
  const tone = dependencyNodeTone(node)
  return (
    <div className="min-w-0 rounded-lg p-2" style={{ border: `1px solid ${tone.border}`, background: 'var(--panel-elevated)' }}>
      <div className="truncate" title={node.label} style={{ fontSize: 10, fontWeight: 650, color: tone.foreground }}>{node.label}</div>
      <div className="mt-0.5 uppercase" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>{node.kind}</div>
      <code className="mt-1 block truncate" title={node.fingerprint} style={{ fontSize: 8, color: 'var(--panel-text-secondary)' }}>{node.fingerprint}</code>
    </div>
  )
}

function ProvenanceGraph({ graph }: { graph: AgentModelingDependencyGraph }) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg p-2.5" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" style={{ color: 'var(--control-selected-text)', fontSize: 11, fontWeight: 650 }}>
            <GitBranch className="h-3.5 w-3.5" /> Replayable dependency DAG
          </div>
          <span style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{graph.nodes.length} nodes · {graph.edges.length} edges</span>
        </div>
        <code className="mt-1 block truncate" title={graph.fingerprint} style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>{graph.fingerprint}</code>
      </div>
      {graph.edges.map((edge, index) => {
        const from = nodes.get(edge.from)!
        const to = nodes.get(edge.to)!
        return (
          <div key={`${edge.from}-${edge.relation}-${edge.to}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-lg p-2" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
            <DependencyNodeCard node={from} />
            <div className="flex flex-col items-center gap-0.5">
              <span className="uppercase" style={{ fontSize: 7, color: 'var(--panel-text-tertiary)' }}>{edge.relation}</span>
              <span aria-hidden="true" style={{ color: 'var(--panel-text-tertiary)', fontSize: 12 }}>→</span>
              {edge.details?.frameIndex === undefined ? null : <span style={{ fontSize: 7, color: 'var(--panel-text-tertiary)' }}>frame {Number(edge.details.frameIndex) + 1}</span>}
            </div>
            <DependencyNodeCard node={to} />
          </div>
        )
      })}
      {!graph.edges.length ? <p className="rounded-lg p-3 text-center text-[10px]" style={{ color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}>This run has no proven dependency edge beyond its root identity.</p> : null}
      <p className="rounded-lg p-2 text-[10px] leading-relaxed" style={{ color: 'var(--status-amber)', background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' }}>{graph.checkpointScope}</p>
    </div>
  )
}

function safeDetails(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[nested data omitted]'
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (value.length > 30) return `[${value.length} items — export JSON to inspect]`
    return value.map((item) => safeDetails(item, depth + 1))
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
    if (key === 'imageBase64') return [key, '[image emitted separately]']
    if (['atoms', 'bonds', 'frames', 'positions', 'velocitiesAperPs', 'forcesEvPerA'].includes(key) && Array.isArray(nested)) {
      return [key, `[${nested.length} items — export JSON to inspect]`]
    }
    return [key, safeDetails(nested, depth + 1)]
  }))
}

function targetPlacementSummary(checks: readonly ValidationCheck[]): string | null {
  const metrics = checks.find((check) => (
    check.id === 'visual.target_screen_placement' && check.status === 'pass'
  ))?.metrics
  const x = metrics?.centerPxX
  const y = metrics?.centerPxY
  const radius = metrics?.projectedRadiusPx
  const width = metrics?.viewportWidthPx
  const height = metrics?.viewportHeightPx
  if (![x, y, radius, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) return null
  return `Screen verified · center ${Number(x).toFixed(0)}, ${Number(y).toFixed(0)} px · radius ${Number(radius).toFixed(0)} px · ${Number(width)}×${Number(height)}`
}

function exportRun() {
  const current = useAgentModelingStore.getState().current
  if (!current) return
  const payload = JSON.stringify(composeAgentModelingRunArtifact(current), null, 2)
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${current.manifest.name}-${new Date(current.startedAt).toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function CheckRow({ check }: { check: ValidationCheck }) {
  return (
    <div className="rounded-lg p-2.5" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <div className="flex items-start gap-2" style={{ color: statusColor[check.status] }}>
        <span className="mt-0.5 shrink-0"><StatusIcon status={check.status} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <span style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--panel-text)' }}>{check.message}</span>
            <span className="shrink-0 uppercase" style={{ fontSize: 9, fontWeight: 700 }}>{check.status}</span>
          </div>
          <code className="mt-1 block break-all" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>{check.id}</code>
          {check.metrics && Object.keys(check.metrics).length ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              {Object.entries(check.metrics).slice(0, 8).map(([name, value]) => (
                <div key={name} className="rounded px-1.5 py-1" style={{ background: 'var(--panel-hover)' }}>
                  <div className="truncate" title={name} style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>{name}</div>
                  <div className="truncate" title={String(value)} style={{ fontSize: 10, color: 'var(--panel-text-secondary)' }}>{String(value)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function TargetRow({
  target,
  disabled,
  focusing,
  captured,
  onFocus,
}: {
  target: InspectionTarget
  disabled: boolean
  focusing: boolean
  captured: boolean
  onFocus: () => Promise<boolean>
}) {
  const focus = async () => {
    if (disabled || focusing) return
    await onFocus()
  }
  return (
    <button
      type="button"
      disabled={disabled || focusing}
      onClick={() => void focus()}
      className="zatom-pressable w-full rounded-lg p-2.5 text-left disabled:opacity-45"
      style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}
    >
      <div className="flex items-start gap-2">
        {focusing ? <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : <Target className="mt-0.5 h-3.5 w-3.5" style={{ color: 'var(--control-selected-text)' }} />}
        <div className="min-w-0 flex-1">
          <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--panel-text)' }}>{target.reason}</div>
          <code className="mt-1 block truncate" title={target.id} style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>{target.id}</code>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)' }}>
            <span>{target.atomIds.length} atom{target.atomIds.length === 1 ? '' : 's'}</span>
            <span>r={target.radius.toFixed(2)} Å</span>
            <span>({target.center.map((value) => value.toFixed(2)).join(', ')}) Å</span>
            {target.trajectoryFrameIndex === undefined ? null : <span>frame {target.trajectoryFrameIndex + 1}</span>}
            {captured ? <span style={{ color: 'var(--status-green)' }}>localized evidence</span> : null}
          </div>
        </div>
        <Eye className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} />
      </div>
    </button>
  )
}

export function AgentModelingResult() {
  const status = useAgentModelingStore((state) => state.status)
  const current = useAgentModelingStore((state) => state.current)
  const applyCurrentCandidate = useAgentModelingStore((state) => state.applyCurrentCandidate)
  const focusCurrentTarget = useAgentModelingStore((state) => state.focusCurrentTarget)
  const refreshCurrentWorkspaceRevision = useAgentModelingStore((state) => state.refreshCurrentWorkspaceRevision)
  const restoreCurrentWorkspaceRevision = useAgentModelingStore((state) => state.restoreCurrentWorkspaceRevision)
  const workspaceRevisionPosition = useAgentModelingStore((state) => state.workspaceRevisionPosition)
  const workspaceRevisionStatus = useAgentModelingStore((state) => state.workspaceRevisionStatus)
  const workspaceRevisionError = useAgentModelingStore((state) => state.workspaceRevisionError)
  const focusingTargetKey = useAgentModelingStore((state) => state.focusingTargetKey)
  const visualError = useAgentModelingStore((state) => state.visualError)
  const [tab, setTab] = useState<ResultTab>('checks')
  const sectionRef = useRef<HTMLElement>(null)
  const previousStatus = useRef(status)
  const targets = useMemo(() => collectAgentInspectionTargets(current?.result), [current?.result])
  const dependency = useMemo(() => {
    if (!current) return { graph: null, error: null }
    try {
      return {
        graph: composeAgentModelingDependencyGraph(composeAgentModelingRunArtifact(current)),
        error: null,
      }
    } catch (error) {
      return { graph: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [current])
  useEffect(() => setTab('checks'), [current?.id])
  useEffect(() => {
    if (current?.workspaceRevision) void refreshCurrentWorkspaceRevision()
  }, [current?.workspaceRevision?.fingerprint, refreshCurrentWorkspaceRevision])
  useEffect(() => {
    const justCompleted = previousStatus.current === 'running' && status !== 'running'
    previousStatus.current = status
    if (!justCompleted || !current) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => sectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: reducedMotion ? 'auto' : 'smooth',
    }))
  }, [current, status])
  if (!current) return null
  const checks = current.result.checks ?? []
  const counts = countAgentModelingChecks(checks)
  const hasFailures = counts.fail > 0
  const resultSignal: ValidationCheck['status'] = !current.result.ok || hasFailures
    ? 'fail'
    : counts.warn > 0 || counts.skipped > 0
      ? 'warn'
      : counts.pass > 0 ? 'pass' : 'skipped'
  const applied = current.application?.appliedToWorkspace === true
  const verified = current.application?.applicationVerified === true
  const candidate = current.candidate
  const overviewScreenshot = current.application?.visualEvidence
  const targetEvidenceBundle = current.targetEvidenceBundle
  const targetBindings = new Map(targets.map((target) => [
    agentModelingInspectionTargetKey(target),
    agentModelingVisualBinding(current, target),
  ]))
  const hasFocusableTargets = [...targetBindings.values()].some(Boolean)
  const tabItems: Array<{ id: ResultTab; label: string; count?: number }> = [
    { id: 'checks', label: 'Checks', count: checks.length },
    { id: 'targets', label: 'Targets', count: targets.length },
    { id: 'provenance', label: 'Provenance', count: dependency.graph?.edges.length },
    { id: 'details', label: 'Details', count: targetEvidenceBundle.length || undefined },
  ]

  return (
    <section ref={sectionRef} aria-label="Latest modeling result" className="mt-4 scroll-mt-4 rounded-xl" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <p className="sr-only" role="status" aria-live="polite">{current.result.summary}</p>
      <div className="p-3" style={{ borderBottom: '1px solid var(--panel-border)' }}>
        <div className="flex items-start gap-2">
          {resultSignal === 'fail'
            ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: statusColor.fail }} />
            : resultSignal === 'warn'
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: statusColor.warn }} />
              : resultSignal === 'pass'
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: statusColor.pass }} />
                : <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border" style={{ borderColor: statusColor.skipped }} />}
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--panel-text)' }}>{current.manifest.title}</div>
            <p className="mt-1" style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{current.result.summary}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['pass', 'warn', 'fail', 'skipped'] as const).map((kind) => counts[kind] ? (
            <span key={kind} className="rounded-full px-2 py-1 uppercase" style={{ fontSize: 9, fontWeight: 700, color: statusColor[kind], border: `1px solid ${statusBorder[kind]}`, background: statusBackground[kind] }}>
              {counts[kind]} {kind}
            </span>
          ) : null)}
          <span className="rounded-full px-2 py-1" style={{ fontSize: 9, color: 'var(--panel-text-tertiary)', border: '1px solid var(--panel-border)' }}>
            {(current.durationMs / 1000).toFixed(2)}s
          </span>
        </div>

        {candidate ? (
          <div className="mt-3 rounded-lg p-2.5" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--panel-text)' }}>
                  {candidate.kind === 'structure'
                    ? `${candidate.structure.atoms.length.toLocaleString()} atom candidate`
                    : `${candidate.trajectory.frames.length.toLocaleString()} frame trajectory candidate`}
                </div>
                <div className="mt-0.5" style={{ fontSize: 10, color: 'var(--panel-text-tertiary)' }}>
                  {candidate.kind === 'structure'
                    ? `${candidate.structure.bonds ? `${candidate.structure.bonds.length.toLocaleString()} explicit bonds` : 'No explicit bond topology'}${candidate.trajectory ? ` · ${candidate.trajectory.frames.length.toLocaleString()} frames` : ''}`
                    : `${candidate.trajectory.atomIds.length.toLocaleString()} ordered atoms · ${candidate.trajectory.coordinateMode}`}
                </div>
              </div>
              {applied ? (
                <span className="rounded-full px-2 py-1" style={{ fontSize: 9, fontWeight: 700, color: current.application?.applicationVerified ? 'var(--status-green)' : 'var(--status-amber)', background: current.application?.applicationVerified ? 'var(--status-green-bg)' : 'var(--status-amber-bg)', border: `1px solid ${current.application?.applicationVerified ? 'var(--status-green-border)' : 'var(--status-amber-border)'}` }}>
                  {current.application?.applicationVerified ? 'VERIFIED' : 'APPLIED'}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={hasFailures || status === 'running'}
                  onClick={() => {  void applyCurrentCandidate(true) }}
                  className={hasFailures
                    ? 'zatom-pressable min-h-10 rounded-lg border border-[var(--status-red-border)] bg-[var(--status-red-bg)] px-3 py-2 text-[11px] font-semibold text-[var(--status-red)] disabled:cursor-not-allowed disabled:opacity-55'
                    : 'zatom-primary zatom-pressable min-h-10 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40'}
                  title={hasFailures ? 'Resolve failing numeric checks before applying' : counts.warn ? 'Apply candidate with acknowledged warnings' : 'Apply and verify candidate'}
                >
                  {status === 'running' ? 'Applying…' : counts.warn ? `Apply · ${counts.warn} warning${counts.warn === 1 ? '' : 's'}` : 'Apply & verify'}
                </button>
              )}
            </div>
            {hasFailures ? <p className="mt-2" role="alert" style={{ fontSize: 10, color: 'var(--status-red)' }}>Application is blocked by failing numeric checks.</p> : null}
          </div>
        ) : null}

        {current.workspaceRevision ? (
          <div
            className="mt-3 rounded-lg p-2.5"
            style={{
              border: `1px solid ${workspaceRevisionPosition === 'diverged' ? 'var(--status-amber-border)' : 'var(--panel-border)'}`,
              background: workspaceRevisionPosition === 'diverged' ? 'var(--status-amber-bg)' : 'var(--panel-elevated)',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 650, color: 'var(--panel-text)' }}>
                  {workspaceRevisionStatus !== 'idle'
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : workspaceRevisionPosition === 'before'
                      ? <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      : <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  {workspaceRevisionPosition === 'before'
                    ? 'Agent change undone'
                    : workspaceRevisionPosition === 'diverged'
                      ? 'Workspace changed'
                      : 'Reversible Agent change'}
                </div>
                <p className="mt-1 text-[9px] leading-relaxed" style={{ color: 'var(--panel-text-tertiary)' }}>
                  {workspaceRevisionPosition === 'diverged'
                    ? 'The active viewport matches neither side of this change. zatom will not overwrite it.'
                    : 'Restores the exact canonical structure, trajectory, metadata, and boundary state.'}
                </p>
              </div>
              <button
                type="button"
                disabled={workspaceRevisionStatus !== 'idle'
                  || (workspaceRevisionPosition !== 'after' && workspaceRevisionPosition !== 'before')}
                onClick={() => void restoreCurrentWorkspaceRevision(
                  workspaceRevisionPosition === 'before' ? 'redo' : 'undo',
                )}
                className="zatom-pressable min-h-9 shrink-0 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  color: 'var(--panel-text)',
                  background: 'var(--panel-hover)',
                  border: '1px solid var(--panel-border)',
                }}
              >
                {workspaceRevisionStatus === 'checking'
                  ? 'Checking…'
                  : workspaceRevisionStatus === 'restoring'
                    ? 'Restoring…'
                    : workspaceRevisionPosition === 'before'
                      ? 'Reapply change'
                      : 'Undo change'}
              </button>
            </div>
            {workspaceRevisionError ? (
              <p className="mt-2 text-[9px] leading-relaxed" role="alert" style={{ color: 'var(--status-amber)' }}>
                {workspaceRevisionError}
              </p>
            ) : null}
            <code className="mt-2 block truncate text-[8px]" title={current.workspaceRevision.fingerprint} style={{ color: 'var(--panel-text-tertiary)' }}>
              {current.workspaceRevision.fingerprint}
            </code>
          </div>
        ) : null}
      </div>

      <div role="tablist" aria-label="Modeling result sections" className="flex gap-1 p-2" style={{ borderBottom: '1px solid var(--panel-border)' }}>
        {tabItems.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className="zatom-pressable min-h-8 flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium"
            style={{ color: tab === item.id ? 'var(--panel-text)' : 'var(--panel-text-tertiary)', background: tab === item.id ? 'var(--panel-hover)' : 'transparent' }}
          >
            {item.label}{item.count === undefined ? '' : ` ${item.count}`}
          </button>
        ))}
      </div>

      <div className="max-h-[360px] overflow-y-auto p-2 custom-scrollbar">
        {tab === 'checks' && (
          <div className="flex flex-col gap-2">
            {checks.length ? checks.map((check, index) => <CheckRow key={`${check.id}-${index}`} check={check} />) : <p className="p-2 text-center text-[11px]" style={{ color: 'var(--panel-text-tertiary)' }}>This tool returned no numeric checks.</p>}
          </div>
        )}
        {tab === 'targets' && (
          <div className="flex flex-col gap-2">
            {current.candidate && !verified ? <p className="rounded-lg p-2 text-[10px]" style={{ color: 'var(--status-amber)', background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' }}>Apply and fingerprint-verify the candidate before focusing its atom targets.</p> : null}
            {targets.length && !hasFocusableTargets ? <p className="rounded-lg p-2 text-[10px]" style={{ color: 'var(--status-amber)', background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' }}>These targets are not bound to the current workspace. Rerun the inspection from the active workspace or apply its candidate first.</p> : null}
            {visualError ? <p className="rounded-lg p-2 text-[10px]" role="alert" style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}>{visualError}</p> : null}
            {targets.length ? targets.map((target) => {
              const targetKey = agentModelingInspectionTargetKey(target)
              return (
                <TargetRow
                  key={targetKey}
                  target={target}
                  disabled={!targetBindings.get(targetKey) || !!focusingTargetKey}
                  focusing={focusingTargetKey === targetKey}
                  captured={!!agentModelingVerifiedTargetEvidence(current, target)}
                  onFocus={() => focusCurrentTarget(target)}
                />
              )
            }) : <p className="p-2 text-center text-[11px]" style={{ color: 'var(--panel-text-tertiary)' }}>No spatial inspection targets were returned.</p>}
          </div>
        )}
        {tab === 'provenance' && (
          dependency.graph
            ? <ProvenanceGraph graph={dependency.graph} />
            : <p className="rounded-lg p-3 text-[10px]" role="alert" style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}>{dependency.error ?? 'Dependency graph is unavailable.'}</p>
        )}
        {tab === 'details' && (
          <div className="flex flex-col gap-2">
            {targetEvidenceBundle.map((evidence, index) => {
              const placementSummary = targetPlacementSummary(evidence.checks)
              return (
                <div key={agentModelingInspectionTargetKey(evidence.target)}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--status-green)' }}>
                    <span>Focused evidence · {evidence.target.id}</span>
                    <span style={{ color: 'var(--panel-text-tertiary)' }}>{index + 1}/{targetEvidenceBundle.length}</span>
                  </div>
                  {placementSummary ? <p className="mb-1.5 text-[9px]" style={{ color: 'var(--status-green)' }}>{placementSummary}</p> : null}
                  <img
                    alt={`Focused evidence for ${evidence.target.reason}`}
                    className="w-full rounded-lg"
                    src={`data:${evidence.image.mimeType};base64,${evidence.image.imageBase64}`}
                    style={{ border: '1px solid var(--panel-border)' }}
                  />
                  <p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--panel-text-tertiary)' }}>{evidence.target.reason}</p>
                </div>
              )
            })}
            {overviewScreenshot ? (
              <div>
                <div className="mb-1 text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>Post-apply overview</div>
                <img
                  alt="Post-apply viewport overview"
                  className="w-full rounded-lg"
                  src={`data:${overviewScreenshot.mimeType};base64,${overviewScreenshot.imageBase64}`}
                  style={{ border: '1px solid var(--panel-border)' }}
                />
              </div>
            ) : null}
            {visualError ? <p className="rounded-lg p-2 text-[10px]" role="alert" style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}>{visualError}</p> : null}
            <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg p-2 text-[9px] custom-scrollbar" style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}>
              {JSON.stringify(safeDetails({ input: current.input, result: current.result.data, targetEvidenceBundle: current.targetEvidenceBundle }), null, 2)}
            </pre>
            <button type="button" onClick={exportRun} className="zatom-pressable flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold" style={{ border: '1px solid var(--panel-border)', color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)' }}>
              <Download className="h-3.5 w-3.5" /> Export complete run JSON
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
