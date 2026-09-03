import type { ZatomToolManifest } from '../../agent/contracts'
import {
  parseAgentModelingPlan,
  type AgentModelingPlan,
} from '../../agent/modeling-plan'
import { fingerprintCanonicalJson } from '../../agent/structure-math'
import {
  composeAgentModelingRunArtifact,
  type AgentModelingRunRecord,
} from './agent-modeling-store'
import type {
  AgentModelingTaskStatus,
  AgentModelingTaskStepState,
  AgentModelingTaskStepStatus,
} from './agent-modeling-task-store'

export const ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA = 'zatom.agent-modeling-task-run/v2' as const
export const ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES = 384 * 1024

type PersistedAgentModelingTaskStatus = Exclude<AgentModelingTaskStatus, 'idle'>

export interface AgentModelingTaskRunReference {
  runId: number
  fingerprint: string
}

export interface AgentModelingTaskRunStepArtifact {
  id: string
  tool: string
  status: AgentModelingTaskStepStatus
  run: AgentModelingTaskRunReference | null
  summary: string | null
  limitationsAcknowledged: boolean
}

export interface AgentModelingTaskRunArtifact {
  schemaVersion: typeof ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA
  fingerprint: string
  taskId: string
  plan: AgentModelingPlan
  status: PersistedAgentModelingTaskStatus
  activeStepIndex: number | null
  steps: AgentModelingTaskRunStepArtifact[]
  message: string | null
}

export interface AgentModelingTaskStateForArtifact {
  taskId: string | null
  plan: AgentModelingPlan | null
  status: AgentModelingTaskStatus
  activeStepIndex: number | null
  steps: readonly AgentModelingTaskStepState[]
  message: string | null
}

export class AgentModelingTaskRunArtifactError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentModelingTaskRunArtifactError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function parseRunReference(value: unknown, field: string): AgentModelingTaskRunReference | null {
  if (value === null) return null
  if (!isRecord(value) || !hasExactFields(value, ['runId', 'fingerprint'])
    || !Number.isSafeInteger(value.runId) || Number(value.runId) < 1
    || typeof value.fingerprint !== 'string' || !/^fnv1a64:[0-9a-f]{16}$/.test(value.fingerprint)) {
    throw new AgentModelingTaskRunArtifactError(
      'invalid_agent_modeling_task_run',
      `${field} must be null or an exact run ID and fingerprint reference`,
    )
  }
  return { runId: Number(value.runId), fingerprint: value.fingerprint }
}

function validateTaskState(
  status: PersistedAgentModelingTaskStatus,
  activeStepIndex: number | null,
  steps: readonly AgentModelingTaskRunStepArtifact[],
): void {
  if (status === 'ready') {
    if (activeStepIndex !== null || steps.some((step) => (
      step.status !== 'pending' || step.run !== null || step.summary !== null || step.limitationsAcknowledged
    ))) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        'A ready task must contain only pending steps and no active step or run references',
      )
    }
    return
  }
  if (status === 'completed') {
    if (activeStepIndex !== steps.length - 1
      || steps.some((step) => step.status !== 'completed' || step.run === null)) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        'A completed task must bind every completed step to one exact run',
      )
    }
    return
  }
  if (activeStepIndex === null || activeStepIndex < 0 || activeStepIndex >= steps.length) {
    throw new AgentModelingTaskRunArtifactError(
      'invalid_agent_modeling_task_run',
      `${status} task must identify its active step`,
    )
  }
  const expectedActiveStatus: AgentModelingTaskStepStatus = status
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    const expected = index < activeStepIndex
      ? 'completed'
      : index === activeStepIndex ? expectedActiveStatus : 'pending'
    if (step.status !== expected) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        `Task step ${step.id} has status ${step.status}; expected ${expected}`,
      )
    }
    if (step.status === 'completed' && step.run === null) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        `Completed task step ${step.id} must reference its exact run`,
      )
    }
    if (step.status === 'review' && step.run === null) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        `Reviewed task step ${step.id} must reference its exact run`,
      )
    }
    if (step.status === 'pending' && (step.run !== null || step.summary !== null || step.limitationsAcknowledged)) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        `Pending task step ${step.id} cannot contain run or acknowledgement state`,
      )
    }
  }
}

function taskInputMatchesRun(
  planInput: Readonly<Record<string, unknown>>,
  runInput: Readonly<Record<string, unknown>>,
): boolean {
  for (const [key, value] of Object.entries(planInput)) {
    if (!(key in runInput) || fingerprintCanonicalJson(runInput[key]) !== fingerprintCanonicalJson(value)) return false
  }
  return Object.entries(runInput).every(([key, value]) => (
    key in planInput || ((key === 'applyToWorkspace' || key === 'captureAfter') && value === false)
  ))
}

function verifyRunReferences(
  artifact: AgentModelingTaskRunArtifact,
  history: readonly AgentModelingRunRecord[],
): void {
  const runsById = new Map(history
    .filter((record) => record.completedRun !== null)
    .map((record) => [record.id, record.completedRun!]))
  const seen = new Set<number>()
  let previousRunId = 0
  for (let index = 0; index < artifact.steps.length; index++) {
    const step = artifact.steps[index]
    if (!step.run) continue
    if (seen.has(step.run.runId) || step.run.runId <= previousRunId) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run_reference',
        'Task run references must be unique and strictly ordered by step execution',
      )
    }
    seen.add(step.run.runId)
    previousRunId = step.run.runId
    const run = runsById.get(step.run.runId)
    if (!run) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run_reference',
        `Task step ${step.id} references unavailable run ${step.run.runId}`,
      )
    }
    const runArtifact = composeAgentModelingRunArtifact(run)
    if (runArtifact.fingerprint !== step.run.fingerprint || run.manifest.name !== step.tool
      || !taskInputMatchesRun(artifact.plan.steps[index].input, run.input)) {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run_reference',
        `Task step ${step.id} does not match the exact referenced run`,
      )
    }
  }
}

export function parseAgentModelingTaskRunArtifact(
  value: unknown,
  manifests: readonly ZatomToolManifest[],
  history: readonly AgentModelingRunRecord[],
): AgentModelingTaskRunArtifact {
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'fingerprint', 'taskId', 'plan', 'status', 'activeStepIndex', 'steps', 'message',
  ]) || value.schemaVersion !== ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA
    || typeof value.fingerprint !== 'string') {
    throw new AgentModelingTaskRunArtifactError(
      'invalid_agent_modeling_task_run',
      `Task run artifact must use the closed ${ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA} contract`,
    )
  }
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    throw new AgentModelingTaskRunArtifactError('invalid_agent_modeling_task_run', 'Task run artifact must be JSON')
  }
  const bytes = new TextEncoder().encode(json).byteLength
  if (bytes > ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES) {
    throw new AgentModelingTaskRunArtifactError(
      'agent_modeling_task_run_too_large',
      `Task run artifact is ${bytes} bytes above limit ${ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES}`,
    )
  }
  const { fingerprint, ...payload } = value
  const expectedFingerprint = fingerprintCanonicalJson(payload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentModelingTaskRunArtifactError(
      'agent_modeling_task_run_fingerprint_mismatch',
      `Task run fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  if (typeof value.taskId !== 'string'
    || !/^task-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.taskId)
    || !['ready', 'running', 'review', 'blocked', 'completed', 'cancelled'].includes(String(value.status))
    || (value.activeStepIndex !== null && (!Number.isSafeInteger(value.activeStepIndex) || Number(value.activeStepIndex) < 0))
    || !Array.isArray(value.steps)
    || (value.message !== null && (typeof value.message !== 'string' || value.message.length > 10_000))) {
    throw new AgentModelingTaskRunArtifactError('invalid_agent_modeling_task_run', 'Task run metadata is invalid')
  }
  const plan = parseAgentModelingPlan(value.plan, manifests)
  if (!isRecord(value.plan) || value.plan.fingerprint !== plan.fingerprint
    || value.steps.length !== plan.steps.length) {
    throw new AgentModelingTaskRunArtifactError(
      'invalid_agent_modeling_task_run',
      'Task run must contain its canonical fingerprinted plan and one state for every plan step',
    )
  }
  const steps = value.steps.map((rawStep, index): AgentModelingTaskRunStepArtifact => {
    if (!isRecord(rawStep) || !hasExactFields(rawStep, [
      'id', 'tool', 'status', 'run', 'summary', 'limitationsAcknowledged',
    ]) || rawStep.id !== plan.steps[index].id || rawStep.tool !== plan.steps[index].tool
      || !['pending', 'running', 'review', 'completed', 'blocked', 'cancelled'].includes(String(rawStep.status))
      || (rawStep.summary !== null && (typeof rawStep.summary !== 'string' || rawStep.summary.length > 10_000))
      || typeof rawStep.limitationsAcknowledged !== 'boolean') {
      throw new AgentModelingTaskRunArtifactError(
        'invalid_agent_modeling_task_run',
        `Task run step ${index + 1} does not match its canonical plan step`,
      )
    }
    return {
      id: rawStep.id as string,
      tool: rawStep.tool as string,
      status: rawStep.status as AgentModelingTaskStepStatus,
      run: parseRunReference(rawStep.run, `steps[${index}].run`),
      summary: rawStep.summary as string | null,
      limitationsAcknowledged: rawStep.limitationsAcknowledged,
    }
  })
  const artifact: AgentModelingTaskRunArtifact = {
    schemaVersion: ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA,
    fingerprint,
    taskId: value.taskId,
    plan,
    status: value.status as PersistedAgentModelingTaskStatus,
    activeStepIndex: value.activeStepIndex === null ? null : Number(value.activeStepIndex),
    steps,
    message: value.message as string | null,
  }
  validateTaskState(artifact.status, artifact.activeStepIndex, artifact.steps)
  verifyRunReferences(artifact, history)
  return artifact
}

export function composeAgentModelingTaskRunArtifact(
  state: AgentModelingTaskStateForArtifact,
  manifests: readonly ZatomToolManifest[],
  history: readonly AgentModelingRunRecord[],
): AgentModelingTaskRunArtifact {
  if (!state.taskId || !state.plan || state.status === 'idle') {
    throw new AgentModelingTaskRunArtifactError(
      'agent_modeling_task_run_empty',
      'An active or terminal Agent task is required to compose a task run artifact',
    )
  }
  const runsById = new Map(history
    .filter((record) => record.completedRun !== null)
    .map((record) => [record.id, record.completedRun!]))
  const payload = {
    schemaVersion: ZATOM_AGENT_MODELING_TASK_RUN_SCHEMA,
    taskId: state.taskId,
    plan: state.plan,
    status: state.status,
    activeStepIndex: state.activeStepIndex,
    steps: state.steps.map((step) => {
      const run = step.runId === undefined ? null : runsById.get(step.runId)
      if (step.runId !== undefined && !run) {
        throw new AgentModelingTaskRunArtifactError(
          'invalid_agent_modeling_task_run_reference',
          `Task step ${step.id} references unavailable run ${step.runId}`,
        )
      }
      return {
        id: step.id,
        tool: step.tool,
        status: step.status,
        run: run ? {
          runId: run.id,
          fingerprint: composeAgentModelingRunArtifact(run).fingerprint,
        } : null,
        summary: step.summary ?? null,
        limitationsAcknowledged: step.limitationsAcknowledged,
      }
    }),
    message: state.message,
  }
  const artifact = {
    ...payload,
    fingerprint: fingerprintCanonicalJson(payload),
  }
  return parseAgentModelingTaskRunArtifact(artifact, manifests, history)
}
