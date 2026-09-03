import { listZatomAgentTools } from '../../agent/tools'
import {
  AgentWorkspaceRevisionError,
  replaceAgentWorkspaceSnapshot,
  ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA,
} from '../../agent/workspace-revision'
import {
  activeViewportWorkspaceRevisionContext,
  readActiveViewportStructure,
  readActiveViewportTrajectory,
} from '../../agent/viewer-context'
import { fingerprintStructure } from '../../agent/structure-math'
import { fingerprintTrajectory } from '../../agent/trajectory'
import {
  composeAgentModelingProjectBundle,
  parseAgentModelingProjectBundle,
  AgentModelingProjectBundleError,
  type AgentModelingProjectBundle,
} from './agent-modeling-project-bundle'
import {
  agentModelingWorkspaceAfterRun,
  replaceAgentModelingRunHistory,
  useAgentModelingStore,
} from './agent-modeling-store'
import {
  hydrateAgentModelingTaskRun,
  useAgentModelingTaskStore,
} from './agent-modeling-task-store'

function assertProjectTransferIdle(): void {
  const modeling = useAgentModelingStore.getState()
  const task = useAgentModelingTaskStore.getState()
  if (modeling.status === 'running' || modeling.focusingTargetKey) {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_busy',
      'Wait for modeling execution and visual capture to finish before transferring a project',
    )
  }
  if (modeling.historyStatus !== 'ready') {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_history_unavailable',
      'Saved modeling runs must be verified before transferring a project',
    )
  }
  if (task.status === 'running' || task.status === 'review') {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_task_unstable',
      'Finish, stop, or resolve the current Task review before transferring a project',
    )
  }
  if (task.persistenceStatus !== 'ready') {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_task_unsaved',
      'The current Task store must be saved and verified before transferring a project',
    )
  }
}

/** Capture the one stable browser-local project boundary without mutating it. */
export function captureAgentModelingProjectBundle(): AgentModelingProjectBundle {
  assertProjectTransferIdle()
  const structure = readActiveViewportStructure()
  if (!structure) {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_workspace_empty',
      'Load or build one canonical structure before exporting a project',
    )
  }
  const modeling = useAgentModelingStore.getState()
  const task = useAgentModelingTaskStore.getState()
  const trajectory = readActiveViewportTrajectory()
  if (task.status === 'completed') {
    const terminalRunId = task.steps.at(-1)?.runId
    const terminalRun = modeling.history.find((record) => record.id === terminalRunId)?.completedRun
    if (!terminalRun) {
      throw new AgentModelingProjectBundleError(
        'agent_modeling_project_task_workspace_unbound',
        'The completed Task no longer references its exact terminal run',
      )
    }
    const expected = agentModelingWorkspaceAfterRun(terminalRun)
    const actualTrajectoryFingerprint = trajectory ? fingerprintTrajectory(trajectory) : null
    if (expected.viewportId !== activeViewportWorkspaceRevisionContext.viewportId()
      || expected.structureFingerprint !== fingerprintStructure(structure)
      || expected.trajectoryFingerprint !== actualTrajectoryFingerprint) {
      throw new AgentModelingProjectBundleError(
        'agent_modeling_project_task_workspace_mismatch',
        'The active workspace no longer matches the completed Task terminal revision',
      )
    }
  }
  return composeAgentModelingProjectBundle({
    structure,
    trajectory,
    history: modeling.history,
    task: task.status === 'idle' ? null : task,
  }, listZatomAgentTools())
}

export async function replaceAgentModelingProjectBundle(
  value: unknown,
): Promise<AgentModelingProjectBundle> {
  assertProjectTransferIdle()
  const project = parseAgentModelingProjectBundle(value, listZatomAgentTools())
  try {
    await replaceAgentWorkspaceSnapshot({
      target: {
        schemaVersion: ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA,
        viewportId: activeViewportWorkspaceRevisionContext.viewportId(),
        structureFingerprint: project.workspace.structureFingerprint,
        trajectoryFingerprint: project.workspace.trajectoryFingerprint,
        structure: project.workspace.structure,
        trajectory: project.workspace.trajectory,
      },
      context: activeViewportWorkspaceRevisionContext,
    })
  } catch (error) {
    const rollbackFailed = error instanceof AgentWorkspaceRevisionError
      && error.code === 'workspace_revision_rollback_failed'
    throw new AgentModelingProjectBundleError(
      rollbackFailed ? 'agent_modeling_project_rollback_failed' : 'agent_modeling_project_workspace_readback_mismatch',
      error instanceof Error ? error.message : String(error),
    )
  }

  const task = useAgentModelingTaskStore.getState()
  task.clearTask()
  replaceAgentModelingRunHistory(project.history?.runs ?? [])
  if (project.task) hydrateAgentModelingTaskRun(project.task)
  return project
}
