import { create } from 'zustand'

import type { AgentModelingPlan } from '../../agent/modeling-plan'
import type { ZatomToolManifest } from '../../agent/contracts'
import { fingerprintStructure } from '../../agent/structure-math'
import { fingerprintTrajectory } from '../../agent/trajectory'
import { listZatomAgentTools } from '../../agent/tools'
import { activeViewportToolContext } from '../../agent/viewer-context'
import { useViewportManager } from '../../orchestration/viewportManager'
import type { AgentModelingTaskRunArtifact } from './agent-modeling-task-artifact'
import {
  agentModelingVerifiedTargetEvidence,
  agentModelingVisualBinding,
  agentModelingWorkspaceAfterRun,
  collectAgentInspectionTargets,
  countAgentModelingChecks,
  type AgentModelingCompletedRun,
  useAgentModelingStore,
} from './agent-modeling-store'

export type AgentModelingTaskStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'completed'
  | 'cancelled'

export type AgentModelingTaskStepStatus =
  | 'pending'
  | 'running'
  | 'review'
  | 'completed'
  | 'blocked'
  | 'cancelled'

export interface AgentModelingTaskStepState {
  id: string
  tool: string
  title: string
  status: AgentModelingTaskStepStatus
  runId?: number
  summary?: string
  limitationsAcknowledged: boolean
}

export interface AgentModelingTaskReview {
  blockedReason: string | null
  requiresCandidateApplication: boolean
  requiresLimitationAcknowledgement: boolean
  warningCount: number
  skippedCount: number
  targetCount: number
  missingTargetCount: number
  unboundTargetCount: number
}

export interface AgentModelingTaskStore {
  taskId: string | null
  plan: AgentModelingPlan | null
  status: AgentModelingTaskStatus
  activeStepIndex: number | null
  steps: AgentModelingTaskStepState[]
  message: string | null
  persistenceStatus: 'idle' | 'loading' | 'saving' | 'ready' | 'error'
  persistenceError: string | null
  loadPlan: (plan: AgentModelingPlan) => void
  startTask: () => Promise<void>
  resumeTask: () => Promise<void>
  cancelTask: () => void
  clearTask: () => void
}

let taskEpoch = 0

function createTaskId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Web Crypto randomUUID is required for persistent Agent task identity')
  }
  return `task-${globalThis.crypto.randomUUID()}`
}

function manifestFor(tool: string): ZatomToolManifest | null {
  return listZatomAgentTools().find((manifest) => manifest.name === tool) ?? null
}

function updateTaskStep(
  steps: readonly AgentModelingTaskStepState[],
  index: number,
  patch: Partial<AgentModelingTaskStepState>,
): AgentModelingTaskStepState[] {
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step)
}

export function inspectAgentModelingTaskRun(
  current: AgentModelingCompletedRun,
  limitationsAcknowledged = false,
): AgentModelingTaskReview {
  const checks = countAgentModelingChecks(current.result.checks)
  const requiresCandidateApplication = !!current.candidate
    && current.application?.applicationVerified !== true
  let blockedReason: string | null = null
  if (!current.result.ok) blockedReason = current.result.error?.message ?? current.result.summary
  else if (checks.fail) {
    const firstFailure = current.result.checks?.find((check) => check.status === 'fail')
    const remaining = checks.fail - 1
    blockedReason = firstFailure
      ? `${firstFailure.message}${remaining ? ` · ${remaining} more failing check${remaining === 1 ? '' : 's'}` : ''}`
      : `${checks.fail} failing numeric check${checks.fail === 1 ? '' : 's'} blocked the task`
  }
  else if (current.application?.applicationBlocked) blockedReason = 'Candidate application was blocked'
  else if (current.application?.applicationVerified === false) blockedReason = 'Workspace readback did not match the candidate'

  const targets = collectAgentInspectionTargets(current.result)
  let missingTargetCount = 0
  let unboundTargetCount = 0
  if (!requiresCandidateApplication && !blockedReason) {
    for (const target of targets) {
      if (!agentModelingVisualBinding(current, target)) unboundTargetCount++
      else if (!agentModelingVerifiedTargetEvidence(current, target)) missingTargetCount++
    }
    if (unboundTargetCount) {
      blockedReason = `${unboundTargetCount} visual target${unboundTargetCount === 1 ? '' : 's'} cannot be bound to the fingerprint-verified active workspace`
    }
  }
  return {
    blockedReason,
    requiresCandidateApplication,
    requiresLimitationAcknowledgement: !limitationsAcknowledged && (checks.warn > 0 || checks.skipped > 0),
    warningCount: checks.warn,
    skippedCount: checks.skipped,
    targetCount: targets.length,
    missingTargetCount,
    unboundTargetCount,
  }
}

function reviewRequired(review: AgentModelingTaskReview): boolean {
  return review.requiresCandidateApplication
    || review.requiresLimitationAcknowledgement
    || review.missingTargetCount > 0
}

function reviewMessage(review: AgentModelingTaskReview): string {
  if (review.requiresCandidateApplication) {
    return 'Review the numeric checks, then explicitly apply and fingerprint-verify this candidate.'
  }
  if (review.missingTargetCount) {
    return `Focus and capture ${review.missingTargetCount} remaining target${review.missingTargetCount === 1 ? '' : 's'} before continuing.`
  }
  if (review.requiresLimitationAcknowledgement) {
    const parts = [
      review.warningCount ? `${review.warningCount} warning${review.warningCount === 1 ? '' : 's'}` : '',
      review.skippedCount ? `${review.skippedCount} skipped check${review.skippedCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    return `Review and acknowledge ${parts.join(' and ')} before continuing.`
  }
  return 'Review this step before continuing.'
}

function blockTask(index: number, message: string, runId?: number): void {
  useAgentModelingTaskStore.setState((state) => ({
    status: 'blocked',
    activeStepIndex: index,
    message,
    steps: updateTaskStep(state.steps, index, {
      status: 'blocked',
      summary: message,
      ...(runId === undefined ? {} : { runId }),
    }),
  }))
}

async function taskWorkspaceMismatch(current: AgentModelingCompletedRun): Promise<string | null> {
  const expected = agentModelingWorkspaceAfterRun(current)
  try {
    const [structure, trajectory] = await Promise.all([
      activeViewportToolContext.readStructure?.() ?? null,
      activeViewportToolContext.readTrajectory?.() ?? null,
    ])
    const actualViewportId = useViewportManager.getState().activeViewportId
    const actualStructureFingerprint = structure ? fingerprintStructure(structure) : null
    const actualTrajectoryFingerprint = trajectory ? fingerprintTrajectory(trajectory) : null
    if (actualViewportId === expected.viewportId
      && actualStructureFingerprint === expected.structureFingerprint
      && actualTrajectoryFingerprint === expected.trajectoryFingerprint) return null
    return `The active workspace changed before this task could continue: expected viewport ${expected.viewportId}, structure ${expected.structureFingerprint ?? 'none'}, trajectory ${expected.trajectoryFingerprint ?? 'none'}; received viewport ${actualViewportId}, structure ${actualStructureFingerprint ?? 'none'}, trajectory ${actualTrajectoryFingerprint ?? 'none'}.`
  } catch (error) {
    return `The active workspace could not be fingerprint-verified before continuing: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function executeTaskFrom(startIndex: number, epoch: number): Promise<void> {
  const plan = useAgentModelingTaskStore.getState().plan
  if (!plan) return
  for (let index = startIndex; index < plan.steps.length; index++) {
    if (epoch !== taskEpoch) return
    const planStep = plan.steps[index]
    const manifest = manifestFor(planStep.tool)
    if (!manifest) {
      blockTask(index, `Tool ${planStep.tool} is no longer available in this host`)
      return
    }
    useAgentModelingTaskStore.setState((state) => ({
      status: 'running',
      activeStepIndex: index,
      message: `Running ${manifest.title}`,
      steps: updateTaskStep(state.steps, index, {
        status: 'running',
        summary: undefined,
        limitationsAcknowledged: false,
      }),
    }))
    await useAgentModelingStore.getState().runTool(manifest, planStep.input)
    if (epoch !== taskEpoch) return
    const modeling = useAgentModelingStore.getState()
    const current = modeling.current
    if (!current || current.manifest.name !== planStep.tool) {
      blockTask(index, `Step ${planStep.id} did not produce its expected run artifact`)
      return
    }
    const review = inspectAgentModelingTaskRun(current)
    if (review.blockedReason) {
      blockTask(index, review.blockedReason, current.id)
      return
    }
    if (reviewRequired(review)) {
      useAgentModelingTaskStore.setState((state) => ({
        status: 'review',
        activeStepIndex: index,
        message: reviewMessage(review),
        steps: updateTaskStep(state.steps, index, {
          status: 'review',
          runId: current.id,
          summary: current.result.summary,
        }),
      }))
      return
    }
    useAgentModelingTaskStore.setState((state) => ({
      steps: updateTaskStep(state.steps, index, {
        status: 'completed',
        runId: current.id,
        summary: current.result.summary,
      }),
    }))
  }
  if (epoch !== taskEpoch) return
  useAgentModelingTaskStore.setState({
    status: 'completed',
    activeStepIndex: plan.steps.length - 1,
    message: `Completed all ${plan.steps.length} modeling steps`,
  })
}

export const useAgentModelingTaskStore = create<AgentModelingTaskStore>((set, get) => ({
  taskId: null,
  plan: null,
  status: 'idle',
  activeStepIndex: null,
  steps: [],
  message: null,
  persistenceStatus: 'idle',
  persistenceError: null,

  loadPlan: (plan) => {
    if (get().status === 'running') return
    taskEpoch++
    set({
      taskId: createTaskId(),
      plan,
      status: 'ready',
      activeStepIndex: null,
      message: 'Plan verified. The active workspace remains unchanged until you start.',
      steps: plan.steps.map((step) => ({
        id: step.id,
        tool: step.tool,
        title: manifestFor(step.tool)?.title ?? step.tool,
        status: 'pending',
        limitationsAcknowledged: false,
      })),
    })
  },

  startTask: async () => {
    if (get().status !== 'ready' || !get().plan) return
    if (get().persistenceStatus !== 'ready') {
      set({ message: 'Wait until this task is saved locally before starting.' })
      return
    }
    const modeling = useAgentModelingStore.getState()
    if (modeling.historyStatus !== 'ready' || modeling.status === 'running') {
      set({ message: 'Wait until saved runs are verified and the current modeling action is idle.' })
      return
    }
    const epoch = ++taskEpoch
    await executeTaskFrom(0, epoch)
  },

  resumeTask: async () => {
    const state = get()
    const index = state.activeStepIndex
    if (state.status !== 'review' || index === null) return
    if (state.persistenceStatus !== 'ready') {
      set({ message: 'Wait until the reviewed task state is saved locally before continuing.' })
      return
    }
    const step = state.steps[index]
    const current = useAgentModelingStore.getState().current
    if (!current || current.id !== step.runId || current.manifest.name !== step.tool) {
      blockTask(index, 'The reviewed run was replaced before this task step completed')
      return
    }
    const workspaceMismatch = await taskWorkspaceMismatch(current)
    const latest = get()
    if (latest.status !== 'review' || latest.activeStepIndex !== index
      || useAgentModelingStore.getState().current?.id !== current.id) return
    if (workspaceMismatch) {
      blockTask(index, workspaceMismatch)
      return
    }
    let review = inspectAgentModelingTaskRun(current, step.limitationsAcknowledged)
    if (review.blockedReason) {
      blockTask(index, review.blockedReason)
      return
    }
    if (!review.requiresCandidateApplication && review.missingTargetCount) return
    const epoch = ++taskEpoch
    set((currentState) => ({
      status: 'running',
      message: review.requiresCandidateApplication ? 'Applying and verifying the candidate' : 'Continuing the verified plan',
      steps: updateTaskStep(currentState.steps, index, {
        status: 'running',
        limitationsAcknowledged: true,
      }),
    }))
    if (review.requiresCandidateApplication) {
      await useAgentModelingStore.getState().applyCurrentCandidate(true)
      if (epoch !== taskEpoch) return
    }
    const applied = useAgentModelingStore.getState().current
    if (!applied || applied.id !== step.runId) {
      blockTask(index, 'The candidate run identity changed while applying this task step')
      return
    }
    review = inspectAgentModelingTaskRun(applied, true)
    if (review.blockedReason) {
      blockTask(index, review.blockedReason)
      return
    }
    if (reviewRequired(review)) {
      set((currentState) => ({
        status: 'review',
        activeStepIndex: index,
        message: reviewMessage(review),
        steps: updateTaskStep(currentState.steps, index, {
          status: 'review',
          runId: applied.id,
          summary: applied.result.summary,
          limitationsAcknowledged: true,
        }),
      }))
      return
    }
    set((currentState) => ({
      steps: updateTaskStep(currentState.steps, index, {
        status: 'completed',
        runId: applied.id,
        summary: applied.result.summary,
        limitationsAcknowledged: true,
      }),
    }))
    await executeTaskFrom(index + 1, epoch)
  },

  cancelTask: () => {
    const state = get()
    if (!state.plan || !['running', 'review'].includes(state.status)) return
    const modeling = useAgentModelingStore.getState()
    if (modeling.status === 'running' && modeling.current?.candidate) return
    taskEpoch++
    if (modeling.status === 'running') {
      modeling.cancelRun()
    }
    const index = state.activeStepIndex
    set({
      status: 'cancelled',
      activeStepIndex: index,
      message: 'Task stopped. Previously verified workspace writes and saved runs were retained.',
      ...(index === null ? {} : {
        steps: updateTaskStep(state.steps, index, { status: 'cancelled' }),
      }),
    })
  },

  clearTask: () => {
    if (get().status === 'running') return
    taskEpoch++
    set({ taskId: null, plan: null, status: 'idle', activeStepIndex: null, steps: [], message: null })
  },
}))

export function setAgentModelingTaskPersistenceState(
  status: AgentModelingTaskStore['persistenceStatus'],
  error: string | null = null,
): void {
  useAgentModelingTaskStore.setState({ persistenceStatus: status, persistenceError: error })
}

/** Restore exactly one verified local task after run history has hydrated. */
export function hydrateAgentModelingTaskRun(artifact: AgentModelingTaskRunArtifact): void {
  const state = useAgentModelingTaskStore.getState()
  if (state.taskId || state.plan || state.status !== 'idle') {
    throw new Error('Persistent Agent task must hydrate before a session task is loaded')
  }
  taskEpoch++
  let status: AgentModelingTaskStatus = artifact.status
  let message = artifact.message
  const steps: AgentModelingTaskStepState[] = artifact.steps.map((step) => ({
    id: step.id,
    tool: step.tool,
    title: manifestFor(step.tool)?.title ?? step.tool,
    status: step.status,
    ...(step.run ? { runId: step.run.runId } : {}),
    ...(step.summary === null ? {} : { summary: step.summary }),
    limitationsAcknowledged: step.limitationsAcknowledged,
  }))
  const activeIndex = artifact.activeStepIndex
  if (artifact.status === 'running' && activeIndex !== null) {
    status = 'blocked'
    steps[activeIndex] = { ...steps[activeIndex], status: 'blocked' }
    message = 'This task was interrupted when zatom closed. The in-flight step was not resumed; verified writes and saved runs were retained.'
  } else if (artifact.status === 'review' && activeIndex !== null) {
    const current = useAgentModelingStore.getState().current
    const active = steps[activeIndex]
    if (!current || current.id !== active.runId || current.manifest.name !== active.tool) {
      status = 'blocked'
      steps[activeIndex] = { ...active, status: 'blocked' }
      message = 'The run awaiting review is no longer the exact current run, so this recovered task cannot continue.'
    }
  }
  useAgentModelingTaskStore.setState({
    taskId: artifact.taskId,
    plan: artifact.plan,
    status,
    activeStepIndex: artifact.activeStepIndex,
    steps,
    message,
  })
}

export function agentModelingTaskOwnsWorkspace(status: AgentModelingTaskStatus): boolean {
  return status === 'running' || status === 'review'
}
