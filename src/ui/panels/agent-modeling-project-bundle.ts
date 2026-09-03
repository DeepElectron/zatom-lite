import type { ZatomStructure, ZatomToolManifest, ZatomTrajectory } from '../../agent/contracts'
import { fingerprintCanonicalJson, fingerprintStructure } from '../../agent/structure-math'
import { parseZatomStructure } from '../../agent/structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from '../../agent/trajectory'
import {
  composeAgentModelingHistoryBundle,
  parseAgentModelingHistoryBundle,
  type AgentModelingHistoryBundle,
} from './agent-modeling-history-bundle'
import {
  restoreAgentModelingRunArtifact,
  type AgentModelingRunRecord,
} from './agent-modeling-store'
import {
  composeAgentModelingTaskRunArtifact,
  parseAgentModelingTaskRunArtifact,
  type AgentModelingTaskRunArtifact,
  type AgentModelingTaskStateForArtifact,
} from './agent-modeling-task-artifact'

export const ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA = 'zatom.agent-modeling-project-bundle/v2' as const
export const ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA = 'zatom.agent-modeling-project-workspace/v1' as const
export const ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES = 256 * 1024 * 1024

export interface AgentModelingProjectWorkspace {
  schemaVersion: typeof ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA
  structureFingerprint: string
  trajectoryFingerprint: string | null
  structure: ZatomStructure
  trajectory: ZatomTrajectory | null
}

export interface AgentModelingProjectBundle {
  schemaVersion: typeof ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA
  fingerprint: string
  workspace: AgentModelingProjectWorkspace
  history: AgentModelingHistoryBundle | null
  task: AgentModelingTaskRunArtifact | null
}

export interface AgentModelingProjectSource {
  structure: ZatomStructure
  trajectory: ZatomTrajectory | null
  history: readonly AgentModelingRunRecord[]
  task: AgentModelingTaskStateForArtifact | null
}

export class AgentModelingProjectBundleError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentModelingProjectBundleError'
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

function jsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_bundle',
      'Modeling project bundle must be finite JSON',
    )
  }
}

function parseWorkspace(value: unknown): AgentModelingProjectWorkspace {
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'structureFingerprint', 'trajectoryFingerprint', 'structure', 'trajectory',
  ]) || value.schemaVersion !== ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA
    || typeof value.structureFingerprint !== 'string'
    || (value.trajectoryFingerprint !== null && typeof value.trajectoryFingerprint !== 'string')) {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_workspace',
      `Project workspace must use the closed ${ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA} contract`,
    )
  }
  let structure: ZatomStructure
  let trajectory: ZatomTrajectory | null
  try {
    structure = parseZatomStructure(value.structure)
    trajectory = value.trajectory === null
      ? null
      : parseZatomTrajectory(value.trajectory, { structure })
  } catch (error) {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_workspace',
      error instanceof Error ? error.message : String(error),
    )
  }
  const structureFingerprint = fingerprintStructure(structure)
  const trajectoryFingerprint = trajectory ? fingerprintTrajectory(trajectory) : null
  if (value.structureFingerprint !== structureFingerprint
    || value.trajectoryFingerprint !== trajectoryFingerprint) {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_workspace_fingerprint_mismatch',
      `Project workspace fingerprints must be ${structureFingerprint} and ${trajectoryFingerprint ?? 'null'}`,
    )
  }
  return {
    schemaVersion: ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA,
    structureFingerprint,
    trajectoryFingerprint,
    structure,
    trajectory,
  }
}

export function parseAgentModelingProjectBundle(
  value: unknown,
  manifests: readonly ZatomToolManifest[],
): AgentModelingProjectBundle {
  const bytes = jsonBytes(value)
  if (bytes > ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES) {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_bundle_too_large',
      `Modeling project bundle is ${bytes} bytes; the limit is ${ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES}`,
    )
  }
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'fingerprint', 'workspace', 'history', 'task',
  ]) || value.schemaVersion !== ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA
    || typeof value.fingerprint !== 'string') {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_bundle',
      `Modeling project bundle must use the closed ${ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA} contract`,
    )
  }
  const { fingerprint, ...rawPayload } = value
  const expectedFingerprint = fingerprintCanonicalJson(rawPayload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_bundle_fingerprint_mismatch',
      `Modeling project bundle fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  const workspace = parseWorkspace(value.workspace)
  let history: AgentModelingHistoryBundle | null
  try {
    history = value.history === null ? null : parseAgentModelingHistoryBundle(value.history)
  } catch (error) {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_history',
      error instanceof Error ? error.message : String(error),
    )
  }
  const historyRecords = (history?.runs ?? []).map((run) => restoreAgentModelingRunArtifact(run).record)
  let task: AgentModelingTaskRunArtifact | null
  try {
    task = value.task === null
      ? null
      : parseAgentModelingTaskRunArtifact(value.task, manifests, historyRecords)
  } catch (error) {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_task',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (task?.status === 'running' || task?.status === 'review') {
    throw new AgentModelingProjectBundleError(
      'agent_modeling_project_task_unstable',
      'A portable project cannot contain a running task or a task awaiting live workspace review',
    )
  }
  return {
    schemaVersion: ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA,
    fingerprint,
    workspace,
    history,
    task,
  }
}

export function composeAgentModelingProjectBundle(
  source: AgentModelingProjectSource,
  manifests: readonly ZatomToolManifest[],
): AgentModelingProjectBundle {
  let structure: ZatomStructure
  let trajectory: ZatomTrajectory | null
  try {
    structure = parseZatomStructure(source.structure)
    trajectory = source.trajectory === null
      ? null
      : parseZatomTrajectory(source.trajectory, { structure })
  } catch (error) {
    throw new AgentModelingProjectBundleError(
      'invalid_agent_modeling_project_workspace',
      error instanceof Error ? error.message : String(error),
    )
  }
  const completeRunCount = source.history.filter((record) => record.completedRun !== null).length
  const history = completeRunCount ? composeAgentModelingHistoryBundle(source.history) : null
  const task = source.task === null || source.task.status === 'idle'
    ? null
    : composeAgentModelingTaskRunArtifact(source.task, manifests, source.history)
  const payload: Omit<AgentModelingProjectBundle, 'fingerprint'> = {
    schemaVersion: ZATOM_AGENT_MODELING_PROJECT_BUNDLE_SCHEMA,
    workspace: {
      schemaVersion: ZATOM_AGENT_MODELING_PROJECT_WORKSPACE_SCHEMA,
      structureFingerprint: fingerprintStructure(structure),
      trajectoryFingerprint: trajectory ? fingerprintTrajectory(trajectory) : null,
      structure,
      trajectory,
    },
    history,
    task,
  }
  return parseAgentModelingProjectBundle({
    ...payload,
    fingerprint: fingerprintCanonicalJson(payload),
  }, manifests)
}
