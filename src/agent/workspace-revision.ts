import type { ZatomStructure, ZatomTrajectory } from './contracts'
import { fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

export const ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA = 'zatom.agent-workspace-snapshot/v1' as const
export const ZATOM_AGENT_WORKSPACE_REVISION_SCHEMA = 'zatom.agent-workspace-revision/v1' as const

export interface AgentWorkspaceIdentity {
  viewportId: string
  structureFingerprint: string | null
  trajectoryFingerprint: string | null
}

export interface AgentWorkspaceSnapshot extends AgentWorkspaceIdentity {
  schemaVersion: typeof ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA
  structure: ZatomStructure | null
  trajectory: ZatomTrajectory | null
}

export interface AgentWorkspaceRevision {
  schemaVersion: typeof ZATOM_AGENT_WORKSPACE_REVISION_SCHEMA
  fingerprint: string
  runId: number
  tool: string
  createdAt: string
  before: AgentWorkspaceSnapshot
  after: AgentWorkspaceSnapshot
}

export interface AgentWorkspaceRevisionContext {
  viewportId: () => string
  readStructure: () => ZatomStructure | null | Promise<ZatomStructure | null>
  readTrajectory: () => ZatomTrajectory | null | Promise<ZatomTrajectory | null>
  writeStructure: (structure: ZatomStructure) => void | Promise<void>
  writeTrajectory: (trajectory: ZatomTrajectory) => void | Promise<void>
  clearTrajectory: () => void | Promise<void>
  clearWorkspace: () => void | Promise<void>
}

export type AgentWorkspaceRevisionPosition = 'before' | 'after' | 'diverged'

export class AgentWorkspaceRevisionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentWorkspaceRevisionError'
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

function canonicalSnapshot(value: unknown): AgentWorkspaceSnapshot {
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'viewportId', 'structureFingerprint', 'trajectoryFingerprint', 'structure', 'trajectory',
  ]) || value.schemaVersion !== ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA
    || typeof value.viewportId !== 'string' || !value.viewportId
    || (value.structureFingerprint !== null && typeof value.structureFingerprint !== 'string')
    || (value.trajectoryFingerprint !== null && typeof value.trajectoryFingerprint !== 'string')) {
    throw new AgentWorkspaceRevisionError(
      'invalid_workspace_snapshot',
      `Workspace snapshot must use the closed ${ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA} contract`,
    )
  }
  let structure: ZatomStructure | null
  let trajectory: ZatomTrajectory | null
  try {
    structure = value.structure === null ? null : parseZatomStructure(value.structure)
    if (!structure && value.trajectory !== null) {
      throw new Error('A trajectory snapshot requires a structure')
    }
    trajectory = value.trajectory === null
      ? null
      : parseZatomTrajectory(value.trajectory, { structure: structure! })
  } catch (error) {
    throw new AgentWorkspaceRevisionError(
      'invalid_workspace_snapshot',
      error instanceof Error ? error.message : String(error),
    )
  }
  const structureFingerprint = structure ? fingerprintStructure(structure) : null
  const trajectoryFingerprint = trajectory ? fingerprintTrajectory(trajectory) : null
  if (value.structureFingerprint !== structureFingerprint
    || value.trajectoryFingerprint !== trajectoryFingerprint) {
    throw new AgentWorkspaceRevisionError(
      'workspace_snapshot_fingerprint_mismatch',
      `Workspace snapshot fingerprints must be ${structureFingerprint ?? 'null'} and ${trajectoryFingerprint ?? 'null'}`,
    )
  }
  return {
    schemaVersion: ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA,
    viewportId: value.viewportId,
    structureFingerprint,
    trajectoryFingerprint,
    structure,
    trajectory,
  }
}

export function workspaceSnapshotIdentity(
  snapshot: AgentWorkspaceSnapshot,
): AgentWorkspaceIdentity {
  return {
    viewportId: snapshot.viewportId,
    structureFingerprint: snapshot.structureFingerprint,
    trajectoryFingerprint: snapshot.trajectoryFingerprint,
  }
}

export function workspaceIdentityMatches(
  left: AgentWorkspaceIdentity,
  right: AgentWorkspaceIdentity,
): boolean {
  return left.viewportId === right.viewportId
    && left.structureFingerprint === right.structureFingerprint
    && left.trajectoryFingerprint === right.trajectoryFingerprint
}

export function workspaceRevisionPosition(
  revision: AgentWorkspaceRevision,
  identity: AgentWorkspaceIdentity,
): AgentWorkspaceRevisionPosition {
  if (workspaceIdentityMatches(identity, revision.before)) return 'before'
  if (workspaceIdentityMatches(identity, revision.after)) return 'after'
  return 'diverged'
}

export async function captureAgentWorkspaceSnapshot(
  context: AgentWorkspaceRevisionContext,
): Promise<AgentWorkspaceSnapshot> {
  const viewportId = context.viewportId()
  const structure = await context.readStructure()
  const trajectory = await context.readTrajectory()
  const finalViewportId = context.viewportId()
  if (finalViewportId !== viewportId) {
    throw new AgentWorkspaceRevisionError(
      'workspace_viewport_changed',
      `Active viewport changed from ${viewportId} to ${finalViewportId} while capturing workspace state`,
    )
  }
  return canonicalSnapshot({
    schemaVersion: ZATOM_AGENT_WORKSPACE_SNAPSHOT_SCHEMA,
    viewportId,
    structureFingerprint: structure ? fingerprintStructure(structure) : null,
    trajectoryFingerprint: trajectory ? fingerprintTrajectory(trajectory) : null,
    structure,
    trajectory,
  })
}

export function composeAgentWorkspaceRevision(options: {
  runId: number
  tool: string
  createdAt: number | string
  before: AgentWorkspaceSnapshot
  after: AgentWorkspaceSnapshot
}): AgentWorkspaceRevision {
  const before = canonicalSnapshot(options.before)
  const after = canonicalSnapshot(options.after)
  const createdAt = typeof options.createdAt === 'number'
    ? new Date(options.createdAt).toISOString()
    : options.createdAt
  if (!Number.isSafeInteger(options.runId) || options.runId < 1
    || typeof options.tool !== 'string' || !options.tool
    || !Number.isFinite(Date.parse(createdAt))
    || new Date(Date.parse(createdAt)).toISOString() !== createdAt) {
    throw new AgentWorkspaceRevisionError('invalid_workspace_revision', 'Workspace revision metadata is invalid')
  }
  if (before.viewportId !== after.viewportId) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_viewport_mismatch',
      'A workspace revision cannot cross viewport identities',
    )
  }
  if (workspaceIdentityMatches(before, after)) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_unchanged',
      'A workspace revision requires a canonical structure or trajectory change',
    )
  }
  const payload = {
    schemaVersion: ZATOM_AGENT_WORKSPACE_REVISION_SCHEMA,
    runId: options.runId,
    tool: options.tool,
    createdAt,
    before,
    after,
  }
  return { ...payload, fingerprint: fingerprintCanonicalJson(payload) }
}

export function parseAgentWorkspaceRevision(value: unknown): AgentWorkspaceRevision {
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'fingerprint', 'runId', 'tool', 'createdAt', 'before', 'after',
  ]) || value.schemaVersion !== ZATOM_AGENT_WORKSPACE_REVISION_SCHEMA
    || typeof value.fingerprint !== 'string'
    || !Number.isSafeInteger(value.runId) || Number(value.runId) < 1
    || typeof value.tool !== 'string' || !value.tool
    || typeof value.createdAt !== 'string') {
    throw new AgentWorkspaceRevisionError(
      'invalid_workspace_revision',
      `Workspace revision must use the closed ${ZATOM_AGENT_WORKSPACE_REVISION_SCHEMA} contract`,
    )
  }
  const { fingerprint, ...payload } = value
  const expectedFingerprint = fingerprintCanonicalJson(payload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_fingerprint_mismatch',
      `Workspace revision fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  const revision = composeAgentWorkspaceRevision({
    runId: Number(value.runId),
    tool: value.tool,
    createdAt: value.createdAt,
    before: canonicalSnapshot(value.before),
    after: canonicalSnapshot(value.after),
  })
  if (revision.fingerprint !== fingerprint) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_fingerprint_mismatch',
      'Workspace revision canonicalization changed its fingerprint',
    )
  }
  return revision
}

async function applyWorkspaceSnapshot(
  snapshot: AgentWorkspaceSnapshot,
  context: AgentWorkspaceRevisionContext,
): Promise<void> {
  if (context.viewportId() !== snapshot.viewportId) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_viewport_mismatch',
      `Workspace revision belongs to ${snapshot.viewportId}, not active viewport ${context.viewportId()}`,
    )
  }
  if (snapshot.structure) {
    await context.writeStructure(snapshot.structure)
    if (snapshot.trajectory) await context.writeTrajectory(snapshot.trajectory)
    else await context.clearTrajectory()
  } else {
    await context.clearWorkspace()
  }
  const readback = await captureAgentWorkspaceSnapshot(context)
  if (!workspaceIdentityMatches(readback, snapshot)) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_readback_mismatch',
      `Workspace restore produced structure ${readback.structureFingerprint ?? 'none'} and trajectory ${readback.trajectoryFingerprint ?? 'none'}; expected ${snapshot.structureFingerprint ?? 'none'} and ${snapshot.trajectoryFingerprint ?? 'none'}`,
    )
  }
}

/** Replace one exact workspace state and restore the original state if any write/readback step fails. */
export async function replaceAgentWorkspaceSnapshot(options: {
  target: AgentWorkspaceSnapshot
  context: AgentWorkspaceRevisionContext
  expectedCurrent?: AgentWorkspaceIdentity
}): Promise<AgentWorkspaceSnapshot> {
  const target = canonicalSnapshot(options.target)
  const current = await captureAgentWorkspaceSnapshot(options.context)
  if (options.expectedCurrent && !workspaceIdentityMatches(current, options.expectedCurrent)) {
    throw new AgentWorkspaceRevisionError(
      'workspace_revision_source_mismatch',
      'The active workspace no longer matches the state this revision expects to replace',
    )
  }
  if (workspaceIdentityMatches(current, target)) return current
  try {
    await applyWorkspaceSnapshot(target, options.context)
    return target
  } catch (error) {
    try {
      await applyWorkspaceSnapshot(current, options.context)
    } catch (rollbackError) {
      throw new AgentWorkspaceRevisionError(
        'workspace_revision_rollback_failed',
        `Workspace restore failed (${error instanceof Error ? error.message : String(error)}) and rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
      )
    }
    throw error
  }
}

export async function restoreAgentWorkspaceRevision(options: {
  revision: AgentWorkspaceRevision
  direction: 'undo' | 'redo'
  context: AgentWorkspaceRevisionContext
}): Promise<AgentWorkspaceSnapshot> {
  const revision = parseAgentWorkspaceRevision(options.revision)
  const source = options.direction === 'undo' ? revision.after : revision.before
  const target = options.direction === 'undo' ? revision.before : revision.after
  return replaceAgentWorkspaceSnapshot({
    target,
    context: options.context,
    expectedCurrent: source,
  })
}
