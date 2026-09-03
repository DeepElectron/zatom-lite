import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Download,
  FileJson,
  Loader2,
  Pause,
  Play,
  ShieldCheck,
  Square,
  Target,
  Upload,
  X,
  XCircle,
} from 'lucide-react'

import {
  parseAgentModelingPlan,
  ZATOM_AGENT_MODELING_PLAN_MAX_BYTES,
  ZATOM_AGENT_MODELING_PLAN_SCHEMA,
} from '../../agent/modeling-plan'
import { composeAgentModelingCapabilityRoute } from '../../agent/modeling-routing'
import { listZatomAgentTools } from '../../agent/tools'
import { useAgentModelingStore } from './agent-modeling-store'
import { composeAgentModelingTaskRunArtifact } from './agent-modeling-task-artifact'
import {
  inspectAgentModelingTaskRun,
  useAgentModelingTaskStore,
  type AgentModelingTaskStatus,
  type AgentModelingTaskStepStatus,
} from './agent-modeling-task-store'

const examplePlan = (() => {
  const goal = 'Confirm numeric integrity and visually inspect every returned target.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'validate',
      objective: 'Validate the active atomic positions.',
      requiredTags: ['validation', 'position'],
      providerPolicy: 'built-in-only',
    }],
  }, listZatomAgentTools())
  return JSON.stringify({
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Validate active structure',
    goal,
    routing: {
      route,
      selections: [{ stageId: 'validate', stepId: 'validate', source: 'built-in' }],
    },
    steps: [{ id: 'validate', tool: 'structure_validate', input: {} }],
  }, null, 2)
})()

function StepIcon({ status }: { status: AgentModelingTaskStepStatus }) {
  if (status === 'completed') return <Check className="h-3.5 w-3.5" strokeWidth={3} />
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (status === 'review') return <Pause className="h-3.5 w-3.5 fill-current" />
  if (status === 'blocked' || status === 'cancelled') return <XCircle className="h-3.5 w-3.5" />
  return <Circle className="h-3.5 w-3.5" />
}

interface StatusTone {
  foreground: string
  background: string
  border: string
}

const successTone: StatusTone = {
  foreground: 'var(--status-green)',
  background: 'var(--status-green-bg)',
  border: 'var(--status-green-border)',
}
const warningTone: StatusTone = {
  foreground: 'var(--status-amber)',
  background: 'var(--status-amber-bg)',
  border: 'var(--status-amber-border)',
}
const errorTone: StatusTone = {
  foreground: 'var(--status-red)',
  background: 'var(--status-red-bg)',
  border: 'var(--status-red-border)',
}
const neutralTone: StatusTone = {
  foreground: 'var(--status-neutral)',
  background: 'var(--status-neutral-bg)',
  border: 'var(--status-neutral-border)',
}
const activeTone: StatusTone = {
  foreground: 'var(--control-selected-text)',
  background: 'var(--control-selected-bg)',
  border: 'var(--control-selected-border)',
}

function statusTone(status: AgentModelingTaskStatus | AgentModelingTaskStepStatus): StatusTone {
  if (status === 'completed') return successTone
  if (status === 'running' || status === 'ready') return activeTone
  if (status === 'review') return warningTone
  if (status === 'blocked') return errorTone
  if (status === 'cancelled') return neutralTone
  return neutralTone
}

export function AgentModelingTask() {
  const plan = useAgentModelingTaskStore((state) => state.plan)
  const taskId = useAgentModelingTaskStore((state) => state.taskId)
  const status = useAgentModelingTaskStore((state) => state.status)
  const steps = useAgentModelingTaskStore((state) => state.steps)
  const activeStepIndex = useAgentModelingTaskStore((state) => state.activeStepIndex)
  const message = useAgentModelingTaskStore((state) => state.message)
  const persistenceStatus = useAgentModelingTaskStore((state) => state.persistenceStatus)
  const persistenceError = useAgentModelingTaskStore((state) => state.persistenceError)
  const loadPlan = useAgentModelingTaskStore((state) => state.loadPlan)
  const startTask = useAgentModelingTaskStore((state) => state.startTask)
  const resumeTask = useAgentModelingTaskStore((state) => state.resumeTask)
  const cancelTask = useAgentModelingTaskStore((state) => state.cancelTask)
  const clearTask = useAgentModelingTaskStore((state) => state.clearTask)
  const modelingStatus = useAgentModelingStore((state) => state.status)
  const historyStatus = useAgentModelingStore((state) => state.historyStatus)
  const history = useAgentModelingStore((state) => state.history)
  const current = useAgentModelingStore((state) => state.current)
  const [rawPlan, setRawPlan] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [planExportPrepared, setPlanExportPrepared] = useState(false)
  const [taskExportPrepared, setTaskExportPrepared] = useState(false)
  const [taskExportError, setTaskExportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const admitPlan = (text: string) => {
    try {
      const bytes = new TextEncoder().encode(text).byteLength
      if (bytes > ZATOM_AGENT_MODELING_PLAN_MAX_BYTES) {
        throw new Error(`Plan is ${bytes} bytes; the limit is ${ZATOM_AGENT_MODELING_PLAN_MAX_BYTES}`)
      }
      const parsed = parseAgentModelingPlan(JSON.parse(text) as unknown, listZatomAgentTools())
      loadPlan(parsed)
      setError(null)
      setPlanExportPrepared(false)
      setTaskExportPrepared(false)
      setTaskExportError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importFile = async (file: File) => {
    if (file.size > ZATOM_AGENT_MODELING_PLAN_MAX_BYTES) {
      setError(`Plan is ${file.size} bytes; the limit is ${ZATOM_AGENT_MODELING_PLAN_MAX_BYTES}`)
      return
    }
    const text = await file.text()
    setRawPlan(text)
    admitPlan(text)
  }

  if (!plan) {
    return (
      <section aria-label="Advanced Agent plan runner" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
        <details className="group">
          <summary className="zatom-pressable flex cursor-pointer list-none items-start gap-2.5 rounded-lg [&::-webkit-details-marker]:hidden">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color: 'var(--control-selected-text)', background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}>
              <FileJson className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 style={{ fontSize: 12, fontWeight: 650, color: 'var(--panel-text)' }}>Verified Agent plan</h3>
                <span className="rounded-full px-1.5 py-0.5 uppercase" style={{ fontSize: 7, fontWeight: 700, color: 'var(--status-neutral)', background: 'var(--status-neutral-bg)', border: '1px solid var(--status-neutral-border)' }}>Advanced</span>
              </div>
              <p className="mt-1" style={{ fontSize: 9, lineHeight: 1.45, color: 'var(--panel-text-tertiary)' }}>
                Import JSON returned by an external MCP Agent. Validation does not run or modify the structure.
              </p>
            </div>
            <ChevronRight className="mt-2 h-3.5 w-3.5 shrink-0 transition-transform duration-300 group-open:rotate-90" aria-hidden="true" style={{ color: 'var(--panel-text-tertiary)' }} />
          </summary>
          <div className="mt-3" style={{ borderTop: '1px solid var(--panel-border)', paddingTop: 12 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Choose Agent modeling plan"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void importFile(file)
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="zatom-pressable flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold"
            style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
          >
            <Upload className="h-3.5 w-3.5" /> Import JSON
          </button>
          <button
            type="button"
            onClick={() => { setRawPlan(examplePlan); setError(null);  }}
            className="zatom-pressable min-h-9 rounded-lg px-3 py-2 text-[10px] font-semibold"
            style={{ color: 'var(--panel-text-secondary)', border: '1px solid var(--panel-border)' }}
          >
            Load one-step example
          </button>
        </div>
        <label className="mt-3 block" htmlFor="agent-modeling-plan-json" style={{ fontSize: 10, fontWeight: 600, color: 'var(--panel-text-secondary)' }}>
          Or paste plan JSON
        </label>
        <textarea
          id="agent-modeling-plan-json"
          value={rawPlan}
          onChange={(event) => { setRawPlan(event.target.value); if (error) setError(null) }}
          spellCheck={false}
          rows={8}
          placeholder={`Paste the complete ${ZATOM_AGENT_MODELING_PLAN_SCHEMA} JSON returned by modeling_validate_plan`}
          className="mt-1.5 w-full resize-y rounded-lg p-2.5 font-mono text-[9px] leading-relaxed"
          style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: `1px solid ${error ? errorTone.border : 'var(--panel-border)'}` }}
        />
        {error ? <p className="mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" role="alert" style={{ color: errorTone.foreground, background: errorTone.background, border: `1px solid ${errorTone.border}` }}>{error}</p> : null}
        {persistenceError ? <p className="mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" role="alert" style={{ color: errorTone.foreground, background: errorTone.background, border: `1px solid ${errorTone.border}` }}>{persistenceError}</p> : null}
        <button
          type="button"
          disabled={!rawPlan.trim()}
          onClick={() => admitPlan(rawPlan)}
          className="zatom-primary zatom-pressable mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ShieldCheck className="h-3.5 w-3.5" /> Validate plan contract
        </button>
          </div>
        </details>
      </section>
    )
  }

  const completedCount = steps.filter((step) => step.status === 'completed').length
  const taskTone = statusTone(status)
  const progress = status === 'completed'
    ? 100
    : ((completedCount + (activeStepIndex === null ? 0 : 0.5)) / steps.length) * 100
  const activeStep = activeStepIndex === null ? null : steps[activeStepIndex]
  const review = status === 'review' && current && activeStep?.runId === current.id
    ? inspectAgentModelingTaskRun(current, activeStep.limitationsAcknowledged)
    : null
  const waitingForTargets = !!review?.missingTargetCount && !review.requiresCandidateApplication
  const canStart = status === 'ready' && historyStatus === 'ready'
    && persistenceStatus === 'ready' && modelingStatus !== 'running'
  const applyingCandidate = status === 'running' && modelingStatus === 'running' && !!current?.candidate

  const exportPlan = () => {
    const payload = JSON.stringify(plan)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `zatom-agent-plan-${plan.fingerprint.replace(':', '-')}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setPlanExportPrepared(true)
  }

  const exportTaskRecord = () => {
    try {
      const artifact = composeAgentModelingTaskRunArtifact({
        taskId,
        plan,
        status,
        activeStepIndex,
        steps,
        message,
      }, listZatomAgentTools(), history)
      const payload = JSON.stringify(artifact)
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `zatom-agent-task-${artifact.fingerprint.replace(':', '-')}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setTaskExportPrepared(true)
      setTaskExportError(null)
    } catch (cause) {
      setTaskExportError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const primaryLabel = review?.requiresCandidateApplication
    ? review.warningCount || review.skippedCount ? 'Apply with limitations' : 'Apply & verify'
    : review?.requiresLimitationAcknowledgement
      ? 'Acknowledge & continue'
      : 'Continue'

  return (
    <section aria-labelledby="active-agent-task-title" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: taskTone.foreground }} />
            <h3 id="active-agent-task-title" className="truncate" title={plan.title} style={{ fontSize: 13, fontWeight: 650, color: 'var(--panel-text)' }}>{plan.title}</h3>
          </div>
          <p className="mt-1" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>{plan.goal}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={planExportPrepared ? 'Agent plan export prepared' : 'Export verified Agent plan'}
            onClick={exportPlan}
            className="zatom-pressable flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ color: planExportPrepared ? successTone.foreground : 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            title={planExportPrepared ? 'Save dialog opened' : 'Export fingerprinted plan JSON'}
          >
            {planExportPrepared ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Download className="h-3.5 w-3.5" />}
          </button>
          <span className="rounded-full px-2 py-1 uppercase" style={{ fontSize: 8, fontWeight: 700, color: taskTone.foreground, background: taskTone.background, border: `1px solid ${taskTone.border}` }}>{status}</span>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full" role="progressbar" aria-label="Agent task progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} style={{ background: 'var(--panel-elevated)' }}>
        <div className="h-full rounded-full transition-[width] duration-200 ease-[cubic-bezier(.23,1,.32,1)]" style={{ width: `${progress}%`, background: taskTone.foreground }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
        <span>{completedCount}/{steps.length} steps complete</span>
        <code className="max-w-[145px] truncate" title={`Plan ${plan.fingerprint}`}>Plan · {plan.fingerprint}</code>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2" style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}>
        <span>Route verified · {plan.routing.route.stages.length} stage{plan.routing.route.stages.length === 1 ? '' : 's'}</span>
        <code className="max-w-[145px] truncate" title={`Route ${plan.routing.route.fingerprint}`}>Route · {plan.routing.route.fingerprint}</code>
      </div>
      <div className="mt-1.5 flex items-center gap-1" role="status" aria-live="polite" style={{ fontSize: 8, color: persistenceStatus === 'error' ? errorTone.foreground : persistenceStatus === 'ready' ? successTone.foreground : 'var(--panel-text-tertiary)' }}>
        {persistenceStatus === 'loading' || persistenceStatus === 'saving'
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : persistenceStatus === 'ready' ? <Check className="h-3 w-3" strokeWidth={3} /> : <AlertTriangle className="h-3 w-3" />}
        <span>{persistenceStatus === 'loading' ? 'Restoring local task…'
          : persistenceStatus === 'saving' ? 'Saving locally…'
            : persistenceStatus === 'ready' ? 'Saved locally'
              : persistenceError ?? 'Local task persistence is unavailable'}</span>
      </div>

      <ol className="mt-3 flex flex-col gap-1.5" aria-label="Agent task steps">
        {steps.map((step, index) => {
          const tone = statusTone(step.status)
          const selection = plan.routing.selections[index]
          return (
            <li key={step.id} className="rounded-lg px-2.5 py-2" aria-current={activeStepIndex === index ? 'step' : undefined} style={{ border: `1px solid ${activeStepIndex === index ? tone.border : 'var(--panel-border)'}`, background: activeStepIndex === index ? tone.background : 'var(--panel-elevated)' }}>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0" style={{ color: tone.foreground }}><StepIcon status={step.status} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span style={{ fontSize: 10, fontWeight: 600, lineHeight: 1.4, color: 'var(--panel-text)' }}>{step.title}</span>
                    <span style={{ fontSize: 8, color: tone.foreground }}>{index + 1}</span>
                  </div>
                  <code
                    className="mt-0.5 block truncate"
                    title={`${selection.stageId} → ${step.tool} · ${selection.source}`}
                    style={{ fontSize: 8, color: 'var(--panel-text-tertiary)' }}
                  >
                    {selection.stageId} → {step.tool} · {selection.source}
                  </code>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      {message ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg p-2.5" role="status" aria-live="polite" style={{ color: status === 'running' ? 'var(--panel-text-secondary)' : taskTone.foreground, border: `1px solid ${status === 'running' ? 'var(--panel-border)' : taskTone.border}`, background: status === 'running' ? 'var(--panel-elevated)' : taskTone.background }}>
          {status === 'running' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            : status === 'review' ? review?.missingTargetCount ? <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              : status === 'blocked' || status === 'cancelled' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                : <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span style={{ fontSize: 10, lineHeight: 1.5 }}>{message}</span>
        </div>
      ) : null}
      {taskExportError ? (
        <p className="mt-3 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" role="alert" style={{ color: errorTone.foreground, background: errorTone.background, border: `1px solid ${errorTone.border}` }}>{taskExportError}</p>
      ) : null}

      {status === 'ready' ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => {  void startTask() }}
            className="zatom-primary zatom-pressable flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5 fill-current" /> Start task
          </button>
          <button
            type="button"
            aria-label="Discard verified Agent plan"
            onClick={() => { clearTask(); setRawPlan(''); setError(null);  }}
            className="zatom-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            title="Discard this plan without running it"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {status === 'running' ? (
        <button
          type="button"
          disabled={applyingCandidate}
          onClick={() => { cancelTask();  }}
          className="zatom-pressable mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:cursor-wait disabled:opacity-70"
          style={{ color: applyingCandidate ? 'var(--panel-text-secondary)' : errorTone.foreground, background: applyingCandidate ? 'var(--panel-elevated)' : errorTone.background, border: `1px solid ${applyingCandidate ? 'var(--panel-border)' : errorTone.border}` }}
        >
          {applyingCandidate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
          {applyingCandidate ? 'Committing verified write…' : 'Stop task'}
        </button>
      ) : null}

      {status === 'review' ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={waitingForTargets || persistenceStatus !== 'ready'}
            onClick={() => {  void resumeTask() }}
            className="zatom-primary zatom-pressable flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {waitingForTargets ? <Target className="h-3.5 w-3.5" />
              : persistenceStatus !== 'ready' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            {waitingForTargets ? `Inspect ${review?.missingTargetCount}`
              : persistenceStatus !== 'ready' ? 'Saving…' : primaryLabel}
          </button>
          <button
            type="button"
            aria-label="Stop Agent task"
            onClick={() => { cancelTask();  }}
            className="zatom-pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
            style={{ color: errorTone.foreground, border: `1px solid ${errorTone.border}`, background: errorTone.background }}
            title="Stop task; verified writes remain"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        </div>
      ) : null}

      {status === 'blocked' || status === 'cancelled' || status === 'completed' ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={persistenceStatus !== 'ready'}
            onClick={exportTaskRecord}
            className="zatom-pressable flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: taskExportPrepared ? successTone.foreground : 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
          >
            {taskExportPrepared ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <Download className="h-3.5 w-3.5" />}
            {taskExportPrepared ? 'Record prepared' : 'Export record'}
          </button>
          <button
            type="button"
            onClick={() => { clearTask(); setRawPlan(''); setError(null); setPlanExportPrepared(false); setTaskExportPrepared(false); setTaskExportError(null);  }}
            className="zatom-pressable min-h-10 flex-1 rounded-lg px-3 py-2 text-[11px] font-semibold"
            style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
          >
            Close task
          </button>
        </div>
      ) : null}
    </section>
  )
}
