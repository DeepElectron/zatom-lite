import { create } from 'zustand'

import {
  applyStructureCandidate,
  applyTrajectoryCandidate,
  type CandidateEnvelope,
  type StructureCandidate,
  type TrajectoryCandidate,
} from '../../agent/candidate-tool'
import type {
  CapturedImage,
  InspectionTarget,
  ValidationCheck,
  ZatomStructure,
  ZatomToolManifest,
  ZatomToolResult,
  ZatomTrajectory,
} from '../../agent/contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../../agent/contracts'
import type { ZatomDiscoveredProviderManifest } from '../../agent/provider'
import { executeZatomAgentTool } from '../../agent/tools'
import {
  activeViewportToolContext,
  activeViewportWorkspaceRevisionContext,
} from '../../agent/viewer-context'
import { fingerprintCanonicalJson, fingerprintStructure } from '../../agent/structure-math'
import { parseZatomStructure } from '../../agent/structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from '../../agent/trajectory'
import {
  captureAgentWorkspaceSnapshot,
  composeAgentWorkspaceRevision,
  parseAgentWorkspaceRevision,
  replaceAgentWorkspaceSnapshot,
  restoreAgentWorkspaceRevision,
  workspaceIdentityMatches,
  workspaceRevisionPosition as classifyAgentWorkspaceRevision,
  workspaceSnapshotIdentity,
  type AgentWorkspaceIdentity,
  type AgentWorkspaceRevision,
  type AgentWorkspaceRevisionPosition,
  type AgentWorkspaceSnapshot,
} from '../../agent/workspace-revision'
import { useViewportManager } from '../../orchestration/viewportManager'
import {
  selectPendingReview,
  useAgentOperationReview,
} from '../../orchestration/agentOperationReviewStore'
import { abortChoreography } from '../../orchestration/modelingChoreographer'
import {
  agentModelingOriginMismatch,
  type AgentModelingOrigin,
} from './agent-modeling-origin'

export type AgentModelingRunStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled'
export const ZATOM_AGENT_MODELING_RUN_SCHEMA = 'zatom.agent-modeling-run/v2'
export const AGENT_MODELING_RUN_HISTORY_LIMIT = 12

export interface AgentModelingRunRecord {
  id: number
  tool: string
  title: string
  summary: string
  status: Exclude<AgentModelingRunStatus, 'idle' | 'running'>
  startedAt: number
  durationMs: number
  checks: { pass: number; warn: number; fail: number; skipped: number }
  application?: 'candidate' | 'applied' | 'verified' | 'blocked'
  completedRun: AgentModelingCompletedRun | null
}

export interface AgentModelingCompletedRun {
  id: number
  manifest: ZatomToolManifest
  input: Record<string, unknown>
  result: ZatomToolResult
  candidate: AgentModelingCandidate | null
  application: CandidateEnvelope<AgentModelingCandidate> | null
  startedAt: number
  durationMs: number
  origin: AgentModelingOrigin
  workspaceRevision: AgentWorkspaceRevision | null
  targetEvidenceBundle: AgentModelingTargetEvidence[]
}

export interface AgentModelingTargetEvidence {
  target: AgentModelingInspectionTarget
  image: CapturedImage
  checks: ValidationCheck[]
  summary: string
  structureFingerprint: string
  trajectoryFingerprint?: string
  capturedAt: number
}

export interface AgentModelingRunArtifact {
  schemaVersion: typeof ZATOM_AGENT_MODELING_RUN_SCHEMA
  fingerprint: string
  runId: number
  tool: ZatomToolManifest
  input: Record<string, unknown>
  result: ZatomToolResult
  candidate: AgentModelingCandidate | null
  application: CandidateEnvelope<AgentModelingCandidate> | null
  targetEvidenceBundle: AgentModelingTargetEvidence[]
  origin: AgentModelingOrigin
  workspaceRevision: AgentWorkspaceRevision | null
  startedAt: string
  durationMs: number
}

export class AgentModelingRunArtifactError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentModelingRunArtifactError'
    this.code = code
  }
}

export interface AgentModelingVisualBinding {
  expectedStructureFingerprint: string
  expectedTrajectoryFingerprint?: string
}

export type AgentModelingWorkspaceIdentity = AgentWorkspaceIdentity

export interface AgentModelingInspectionTarget extends InspectionTarget {
  /** Exact structure identity inherited from the artifact that owns this target. */
  expectedStructureFingerprint?: string
  /** Exact trajectory identity inherited from the artifact that owns this target. */
  expectedTrajectoryFingerprint?: string
}

export type AgentModelingCandidate =
  | ({ kind: 'structure' } & StructureCandidate)
  | ({ kind: 'trajectory' } & TrajectoryCandidate)

interface AgentModelingStore {
  status: AgentModelingRunStatus
  runningTool: ZatomToolManifest | null
  current: AgentModelingCompletedRun | null
  history: AgentModelingRunRecord[]
  historyStatus: 'idle' | 'loading' | 'saving' | 'ready' | 'error'
  historyPersistenceError: string | null
  providers: ZatomDiscoveredProviderManifest[]
  providersStatus: 'idle' | 'loading' | 'ready' | 'error'
  providersError: string | null
  focusingTargetKey: string | null
  visualError: string | null
  workspaceRevisionPosition: AgentWorkspaceRevisionPosition | null
  workspaceRevisionStatus: 'idle' | 'checking' | 'restoring'
  workspaceRevisionError: string | null
  runTool: (manifest: ZatomToolManifest, input: Record<string, unknown>) => Promise<void>
  cancelRun: () => void
  applyCurrentCandidate: (captureAfter?: boolean) => Promise<void>
  refreshCurrentWorkspaceRevision: () => Promise<void>
  restoreCurrentWorkspaceRevision: (direction: 'undo' | 'redo') => Promise<boolean>
  focusCurrentTarget: (target: AgentModelingInspectionTarget) => Promise<boolean>
  openHistoryRun: (id: number) => boolean
  refreshProviders: () => Promise<void>
  clearHistory: () => void
}

let runSequence = 0
let activeController: AbortController | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidationCheck(value: unknown): value is ValidationCheck {
  return isRecord(value)
    && typeof value.id === 'string'
    && ['pass', 'warn', 'fail', 'skipped'].includes(String(value.status))
    && typeof value.message === 'string'
}

export function countAgentModelingChecks(checks: readonly ValidationCheck[] | undefined) {
  const result = { pass: 0, warn: 0, fail: 0, skipped: 0 }
  for (const check of checks ?? []) result[check.status] += 1
  return result
}

function canonicalCandidateStructure(value: unknown): ZatomStructure | null {
  try {
    return parseZatomStructure(value)
  } catch {
    return null
  }
}

function canonicalCandidateTrajectory(
  value: unknown,
  structure?: ZatomStructure,
): ZatomTrajectory | null {
  try {
    return parseZatomTrajectory(value, structure ? { structure } : {})
  } catch {
    return null
  }
}

export function extractAgentModelingCandidate(result: ZatomToolResult): AgentModelingCandidate | null {
  if (!result.ok) return null
  const envelope = isRecord(result.data) ? result.data : null
  const candidate = envelope && isRecord(envelope.result) ? envelope.result : null
  if (!candidate || !Array.isArray(candidate.checks) || !candidate.checks.every(isValidationCheck)) return null
  const rawStructure = candidate.structure
  const structure = rawStructure === undefined ? null : canonicalCandidateStructure(rawStructure)
  if (rawStructure !== undefined && !structure) return null
  const rawTrajectory = candidate.trajectory
  const trajectory = rawTrajectory === undefined
    ? null
    : canonicalCandidateTrajectory(rawTrajectory, structure ?? undefined)
  if (rawTrajectory !== undefined && !trajectory) return null
  if (structure) {
    return {
      kind: 'structure',
      structure,
      ...(trajectory ? { trajectory } : {}),
      checks: candidate.checks,
    }
  }
  return trajectory ? { kind: 'trajectory', trajectory, checks: candidate.checks } : null
}

export function agentToolProducesCandidate(manifest: ZatomToolManifest): boolean {
  return manifest.name === 'trajectory_stitch_segments'
    || (manifest.effects.workspace === 'write'
      && (manifest.effects.structure === 'create' || manifest.effects.structure === 'replace'))
}

/** Exact active workspace state that must remain after this run before a task may continue. */
export function agentModelingWorkspaceAfterRun(
  current: AgentModelingCompletedRun,
): AgentModelingWorkspaceIdentity {
  if (current.workspaceRevision) return workspaceSnapshotIdentity(current.workspaceRevision.after)
  if (current.candidate && current.application?.applicationVerified === true) {
    return {
      viewportId: current.origin.viewportId,
      structureFingerprint: current.candidate.kind === 'structure'
        ? fingerprintStructure(current.candidate.structure)
        : current.origin.structureFingerprint,
      trajectoryFingerprint: current.candidate.kind === 'trajectory'
        ? fingerprintTrajectory(current.candidate.trajectory)
        : current.candidate.trajectory ? fingerprintTrajectory(current.candidate.trajectory) : null,
    }
  }
  return {
    viewportId: current.origin.viewportId,
    structureFingerprint: current.origin.structureFingerprint,
    trajectoryFingerprint: current.origin.trajectoryFingerprint,
  }
}

/** Conservatively detect an explicit structure/trajectory anywhere in a tool input. */
export function agentInputContainsWorkspaceArtifact(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  const seen = new Set<object>()
  let visited = 0
  while (pending.length) {
    const current = pending.pop()!
    if (!current.value || typeof current.value !== 'object') continue
    if (seen.has(current.value as object)) continue
    seen.add(current.value as object)
    if (++visited > 4096 || current.depth > 8) return true
    if (!Array.isArray(current.value)) {
      const record = current.value as Record<string, unknown>
      if (record.schemaVersion === ZATOM_STRUCTURE_SCHEMA || record.schemaVersion === ZATOM_TRAJECTORY_SCHEMA) return true
      for (const nested of Object.values(record)) pending.push({ value: nested, depth: current.depth + 1 })
    } else {
      for (const nested of current.value) pending.push({ value: nested, depth: current.depth + 1 })
    }
  }
  return false
}

export function agentModelingVisualBinding(
  current: AgentModelingCompletedRun,
  target: AgentModelingInspectionTarget,
): AgentModelingVisualBinding | null {
  const exactBinding = (binding: AgentModelingVisualBinding): AgentModelingVisualBinding | null => {
    if (target.expectedStructureFingerprint
      && target.expectedStructureFingerprint !== binding.expectedStructureFingerprint) return null
    if (target.expectedTrajectoryFingerprint
      && target.expectedTrajectoryFingerprint !== binding.expectedTrajectoryFingerprint) return null
    return binding
  }
  if (current.candidate) {
    if (current.application?.applicationVerified !== true) return null
    const structureFingerprint = current.candidate.kind === 'structure'
      ? fingerprintStructure(current.candidate.structure)
      : current.origin.structureFingerprint
    const trajectoryFingerprint = current.candidate.kind === 'trajectory'
      ? fingerprintTrajectory(current.candidate.trajectory)
      : current.candidate.trajectory
        ? fingerprintTrajectory(current.candidate.trajectory)
        : undefined
    if (!structureFingerprint || (target.trajectoryFrameIndex !== undefined && !trajectoryFingerprint)) return null
    return exactBinding({
      expectedStructureFingerprint: structureFingerprint,
      ...(trajectoryFingerprint ? { expectedTrajectoryFingerprint: trajectoryFingerprint } : {}),
    })
  }

  const envelope = isRecord(current.result.data) ? current.result.data : null
  const appliedResult = envelope && envelope.appliedToWorkspace === true && envelope.applicationVerified === true
    && isRecord(envelope.result) ? envelope.result : null
  const appliedStructure = appliedResult
    ? canonicalCandidateStructure(appliedResult.structure)
    : null
  const appliedTrajectory = appliedResult?.trajectory === undefined
    ? null
    : canonicalCandidateTrajectory(appliedResult.trajectory, appliedStructure ?? undefined)
  if (appliedStructure) {
    if (target.trajectoryFrameIndex !== undefined && !appliedTrajectory) return null
    return exactBinding({
      expectedStructureFingerprint: fingerprintStructure(appliedStructure),
      ...(appliedTrajectory ? { expectedTrajectoryFingerprint: fingerprintTrajectory(appliedTrajectory) } : {}),
    })
  }

  if (current.manifest.effects.workspace !== 'read'
    || agentInputContainsWorkspaceArtifact(current.input)
    || !current.origin.structureFingerprint
    || (target.trajectoryFrameIndex !== undefined && !current.origin.trajectoryFingerprint)) return null
  return exactBinding({
    expectedStructureFingerprint: current.origin.structureFingerprint,
    ...(target.trajectoryFrameIndex !== undefined && current.origin.trajectoryFingerprint
      ? { expectedTrajectoryFingerprint: current.origin.trajectoryFingerprint }
      : {}),
  })
}

function capturedImage(value: unknown): value is CapturedImage {
  return isRecord(value)
    && typeof value.imageBase64 === 'string'
    && typeof value.mimeType === 'string'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
}

function isInspectionTarget(value: unknown): value is InspectionTarget {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.reason === 'string'
    && Array.isArray(value.center) && value.center.length === 3
    && value.center.every((item) => typeof item === 'number' && Number.isFinite(item))
    && typeof value.radius === 'number' && Number.isFinite(value.radius)
    && Array.isArray(value.atomIds) && value.atomIds.every((item) => typeof item === 'string')
}

export function agentModelingInspectionTargetKey(target: AgentModelingInspectionTarget): string {
  return [
    target.expectedStructureFingerprint ?? '',
    target.expectedTrajectoryFingerprint ?? '',
    target.id,
  ].join('\u0000')
}

/**
 * Return evidence only when it belongs to the target's exact active artifact
 * and proves both an image capture and full screen-space target placement.
 */
export function agentModelingVerifiedTargetEvidence(
  current: AgentModelingCompletedRun,
  target: AgentModelingInspectionTarget,
): AgentModelingTargetEvidence | null {
  const binding = agentModelingVisualBinding(current, target)
  if (!binding) return null
  return current.targetEvidenceBundle.find((evidence) => (
    evidence.target.id === target.id
    && evidence.structureFingerprint === binding.expectedStructureFingerprint
    && evidence.trajectoryFingerprint === binding.expectedTrajectoryFingerprint
    && evidence.checks.some((check) => check.id === 'visual.structure_identity' && check.status === 'pass')
    && (!binding.expectedTrajectoryFingerprint
      || evidence.checks.some((check) => check.id === 'visual.trajectory_identity' && check.status === 'pass'))
    && evidence.checks.some((check) => check.id === 'visual.target_screen_placement' && check.status === 'pass')
    && evidence.checks.some((check) => check.id === 'visual.viewport_capture' && check.status === 'pass')
  )) ?? null
}

/** Retain one immutable visual proof per exact artifact-bound target identity. */
export function upsertAgentModelingTargetEvidence(
  bundle: readonly AgentModelingTargetEvidence[],
  evidence: AgentModelingTargetEvidence,
): AgentModelingTargetEvidence[] {
  const key = agentModelingInspectionTargetKey(evidence.target)
  const existingIndex = bundle.findIndex((item) => agentModelingInspectionTargetKey(item.target) === key)
  if (existingIndex < 0) return [...bundle, evidence]
  return bundle.map((item, index) => index === existingIndex ? evidence : item)
}

/** Compose the immutable JSON export consumed by later persistent artifact storage. */
export function composeAgentModelingRunArtifact(
  run: AgentModelingCompletedRun,
): AgentModelingRunArtifact {
  const payload = {
    schemaVersion: ZATOM_AGENT_MODELING_RUN_SCHEMA,
    runId: run.id,
    tool: run.manifest,
    input: run.input,
    result: run.result,
    candidate: run.candidate,
    application: run.application,
    targetEvidenceBundle: run.targetEvidenceBundle,
    origin: run.origin,
    workspaceRevision: run.workspaceRevision,
    startedAt: new Date(run.startedAt).toISOString(),
    durationMs: run.durationMs,
  }
  const jsonSafe = JSON.parse(JSON.stringify(payload)) as Omit<AgentModelingRunArtifact, 'fingerprint'>
  return {
    ...jsonSafe,
    fingerprint: fingerprintCanonicalJson(jsonSafe),
  }
}

function archivedCandidate(value: unknown, field: string): AgentModelingCandidate | null {
  if (value === null) return null
  if (!isRecord(value) || (value.kind !== 'structure' && value.kind !== 'trajectory')
    || !Array.isArray(value.checks) || !value.checks.every(isValidationCheck)) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', `${field} is not a canonical candidate`)
  }
  if (value.kind === 'structure') {
    const structure = canonicalCandidateStructure(value.structure)
    if (!structure) {
      throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', `${field}.structure is invalid`)
    }
    const trajectory = value.trajectory === undefined
      ? null
      : canonicalCandidateTrajectory(value.trajectory, structure)
    if (value.trajectory !== undefined && !trajectory) {
      throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', `${field}.trajectory is invalid`)
    }
    return {
      kind: 'structure',
      structure,
      ...(trajectory ? { trajectory } : {}),
      checks: value.checks,
    }
  }
  const trajectory = canonicalCandidateTrajectory(value.trajectory)
  if (!trajectory) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', `${field}.trajectory is invalid`)
  }
  return { kind: 'trajectory', trajectory, checks: value.checks }
}

function archivedApplication(
  value: unknown,
  candidate: AgentModelingCandidate | null,
): CandidateEnvelope<AgentModelingCandidate> | null {
  if (value === null) return null
  if (!candidate || !isRecord(value)
    || typeof value.appliedToWorkspace !== 'boolean'
    || typeof value.applicationBlocked !== 'boolean'
    || (value.applicationVerified !== null && typeof value.applicationVerified !== 'boolean')
    || (value.visualEvidence !== null && !capturedImage(value.visualEvidence))) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'application is invalid')
  }
  const result = archivedCandidate(value.result, 'application.result')
  if (!result || fingerprintCanonicalJson(result) !== fingerprintCanonicalJson(candidate)) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      'application.result must exactly match the archived candidate',
    )
  }
  return {
    result,
    appliedToWorkspace: value.appliedToWorkspace,
    applicationBlocked: value.applicationBlocked,
    applicationVerified: value.applicationVerified,
    visualEvidence: value.visualEvidence,
    proposal: null,
  }
}

function archivedManifest(value: unknown): ZatomToolManifest {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.title !== 'string'
    || typeof value.version !== 'string' || typeof value.description !== 'string'
    || !isRecord(value.inputSchema) || !isRecord(value.effects)
    || (value.outputSchema !== undefined && !isRecord(value.outputSchema))
    || !['none', 'read', 'create', 'replace'].includes(String(value.effects.structure))
    || !['none', 'read', 'write'].includes(String(value.effects.workspace))
    || !['none', 'read', 'write'].includes(String(value.effects.visual))
    || !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string')) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'tool manifest is invalid')
  }
  return value as unknown as ZatomToolManifest
}

function archivedResult(value: unknown, toolName: string): ZatomToolResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean' || value.tool !== toolName
    || typeof value.summary !== 'string'
    || (value.checks !== undefined && (!Array.isArray(value.checks) || !value.checks.every(isValidationCheck)))) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'tool result is invalid')
  }
  if (value.error !== undefined && (!isRecord(value.error)
    || typeof value.error.code !== 'string' || typeof value.error.message !== 'string')) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'tool result error is invalid')
  }
  return value as unknown as ZatomToolResult
}

function archivedEvidence(value: unknown, index: number): AgentModelingTargetEvidence {
  if (!isRecord(value) || !isInspectionTarget(value.target) || !capturedImage(value.image)
    || !Array.isArray(value.checks) || !value.checks.every(isValidationCheck)
    || typeof value.summary !== 'string' || typeof value.structureFingerprint !== 'string'
    || (value.trajectoryFingerprint !== undefined && typeof value.trajectoryFingerprint !== 'string')
    || !Number.isFinite(value.capturedAt)) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `targetEvidenceBundle[${index}] is invalid`,
    )
  }
  const target = value.target as AgentModelingInspectionTarget
  if (typeof target.expectedStructureFingerprint !== 'string'
    || target.expectedStructureFingerprint !== value.structureFingerprint) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `targetEvidenceBundle[${index}] structure fingerprint binding is invalid`,
    )
  }
  if (target.expectedTrajectoryFingerprint !== value.trajectoryFingerprint) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `targetEvidenceBundle[${index}] trajectory fingerprint binding is invalid`,
    )
  }
  return value as unknown as AgentModelingTargetEvidence
}

function archivedWorkspaceRevision(
  value: unknown,
  runId: number,
  tool: string,
  origin: AgentModelingOrigin,
): AgentWorkspaceRevision | null {
  if (value === null) return null
  let revision: AgentWorkspaceRevision
  try {
    revision = parseAgentWorkspaceRevision(value)
  } catch (error) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `workspaceRevision is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (revision.runId !== runId || revision.tool !== tool
    || !workspaceIdentityMatches(revision.before, origin)) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      'workspaceRevision must bind the exact run, tool, and origin workspace',
    )
  }
  return revision
}

/** Parse one untrusted persisted/exported run and verify its complete replay fingerprint. */
export function parseAgentModelingRunArtifact(value: unknown): AgentModelingRunArtifact {
  if (!isRecord(value) || value.schemaVersion !== ZATOM_AGENT_MODELING_RUN_SCHEMA
    || typeof value.fingerprint !== 'string') {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `Run artifact must use ${ZATOM_AGENT_MODELING_RUN_SCHEMA}`,
    )
  }
  const allowed = new Set([
    'schemaVersion', 'fingerprint', 'runId', 'tool', 'input', 'result', 'candidate', 'application',
    'targetEvidenceBundle', 'origin', 'workspaceRevision', 'startedAt', 'durationMs',
  ])
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key)).sort()
  if (unsupported.length) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `Run artifact contains unsupported fields: ${unsupported.join(', ')}`,
    )
  }
  const { fingerprint, ...payload } = value
  const expectedFingerprint = fingerprintCanonicalJson(payload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentModelingRunArtifactError(
      'agent_run_fingerprint_mismatch',
      `Run artifact fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  if (!Number.isSafeInteger(value.runId) || Number(value.runId) < 1
    || !isRecord(value.input) || typeof value.startedAt !== 'string'
    || !Number.isFinite(Date.parse(value.startedAt))
    || new Date(Date.parse(value.startedAt)).toISOString() !== value.startedAt
    || !Number.isFinite(value.durationMs) || Number(value.durationMs) < 0
    || !isRecord(value.origin)
    || typeof value.origin.viewportId !== 'string'
    || (value.origin.structureFingerprint !== null && typeof value.origin.structureFingerprint !== 'string')
    || (value.origin.trajectoryFingerprint !== null && typeof value.origin.trajectoryFingerprint !== 'string')
    || !Array.isArray(value.targetEvidenceBundle)) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'Run artifact metadata is invalid')
  }
  const tool = archivedManifest(value.tool)
  const result = archivedResult(value.result, tool.name)
  const candidate = archivedCandidate(value.candidate, 'candidate')
  const application = archivedApplication(value.application, candidate)
  const targetEvidenceBundle = value.targetEvidenceBundle.map(archivedEvidence)
  const workspaceRevision = archivedWorkspaceRevision(
    value.workspaceRevision,
    Number(value.runId),
    tool.name,
    value.origin as unknown as AgentModelingOrigin,
  )
  const evidenceKeys = targetEvidenceBundle.map((evidence) => agentModelingInspectionTargetKey(evidence.target))
  if (new Set(evidenceKeys).size !== evidenceKeys.length) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      'targetEvidenceBundle contains duplicate artifact-bound target identities',
    )
  }
  return {
    schemaVersion: ZATOM_AGENT_MODELING_RUN_SCHEMA,
    fingerprint,
    runId: Number(value.runId),
    tool,
    input: value.input,
    result,
    candidate,
    application,
    targetEvidenceBundle,
    origin: value.origin as unknown as AgentModelingOrigin,
    workspaceRevision,
    startedAt: value.startedAt,
    durationMs: Number(value.durationMs),
  }
}

/** Find result targets while retaining the exact artifact identities that own them. */
export function collectAgentInspectionTargets(value: unknown): AgentModelingInspectionTarget[] {
  const result: AgentModelingInspectionTarget[] = []
  const seenObjects = new Set<object>()
  const seenKeys = new Set<string>()
  const maximumVisitedObjects = 4096
  let visitedObjects = 0
  const visit = (
    current: unknown,
    depth: number,
    expectedStructureFingerprint?: string,
    expectedTrajectoryFingerprint?: string,
  ) => {
    if (!current || typeof current !== 'object' || depth > 8 || seenObjects.has(current as object)) return
    if (visitedObjects >= maximumVisitedObjects) return
    seenObjects.add(current as object)
    visitedObjects++
    if (Array.isArray(current)) {
      if (current.length && current.every(isInspectionTarget)) {
        for (const target of current) {
          const boundTarget: AgentModelingInspectionTarget = {
            ...target,
            ...(expectedStructureFingerprint ? { expectedStructureFingerprint } : {}),
            ...(expectedTrajectoryFingerprint ? { expectedTrajectoryFingerprint } : {}),
          }
          const key = agentModelingInspectionTargetKey(boundTarget)
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            result.push(boundTarget)
          }
        }
      } else {
        for (const nested of current) {
          if (visitedObjects >= maximumVisitedObjects) break
          visit(nested, depth + 1, expectedStructureFingerprint, expectedTrajectoryFingerprint)
        }
      }
      return
    }
    const record = current as Record<string, unknown>
    const nestedStructureFingerprint = typeof record.structureFingerprint === 'string'
      ? record.structureFingerprint
      : expectedStructureFingerprint
    const nestedTrajectoryFingerprint = typeof record.trajectoryFingerprint === 'string'
      ? record.trajectoryFingerprint
      : expectedTrajectoryFingerprint
    const directTargets = record.inspectionTargets
    if (Array.isArray(directTargets)) {
      for (const target of directTargets) {
        if (isInspectionTarget(target)) {
          const boundTarget: AgentModelingInspectionTarget = {
            ...target,
            ...(nestedStructureFingerprint ? { expectedStructureFingerprint: nestedStructureFingerprint } : {}),
            ...(nestedTrajectoryFingerprint ? { expectedTrajectoryFingerprint: nestedTrajectoryFingerprint } : {}),
          }
          const key = agentModelingInspectionTargetKey(boundTarget)
          if (!seenKeys.has(key)) {
            seenKeys.add(key)
            result.push(boundTarget)
          }
        }
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      if (visitedObjects >= maximumVisitedObjects) break
      if (['atoms', 'bonds', 'frames', 'positions', 'velocitiesAperPs', 'forcesEvPerA', 'imageBase64'].includes(key)) continue
      if (key !== 'inspectionTargets') {
        visit(nested, depth + 1, nestedStructureFingerprint, nestedTrajectoryFingerprint)
      }
    }
  }
  visit(value, 0)
  return result
}

function inspectionTargetToolInput(target: AgentModelingInspectionTarget): InspectionTarget {
  return {
    id: target.id,
    reason: target.reason,
    center: [...target.center],
    radius: target.radius,
    atomIds: [...target.atomIds],
    ...(target.atomIdsTruncated === undefined ? {} : { atomIdsTruncated: target.atomIdsTruncated }),
    ...(target.trajectoryFrameIndex === undefined ? {} : { trajectoryFrameIndex: target.trajectoryFrameIndex }),
  }
}

function previewInput(manifest: ZatomToolManifest, input: Record<string, unknown>): Record<string, unknown> {
  if (!agentToolProducesCandidate(manifest)) return input
  const properties = isRecord(manifest.inputSchema.properties) ? manifest.inputSchema.properties : {}
  return {
    ...input,
    ...('applyToWorkspace' in properties ? { applyToWorkspace: false } : {}),
    ...('captureAfter' in properties ? { captureAfter: false } : {}),
  }
}

function historyRecord(
  id: number,
  manifest: ZatomToolManifest,
  result: ZatomToolResult,
  startedAt: number,
  durationMs: number,
  status: AgentModelingRunRecord['status'],
  completedRun: AgentModelingCompletedRun | null,
): AgentModelingRunRecord {
  return {
    id,
    tool: manifest.name,
    title: manifest.title,
    summary: result.summary,
    status,
    startedAt,
    durationMs,
    checks: countAgentModelingChecks(result.checks),
    completedRun,
  }
}

function updateHistoryRun(
  history: AgentModelingRunRecord[],
  completedRun: AgentModelingCompletedRun,
  patch: Partial<Pick<AgentModelingRunRecord, 'status' | 'summary' | 'checks' | 'application'>> = {},
): AgentModelingRunRecord[] {
  return history.map((record) => record.id === completedRun.id
    ? { ...record, ...patch, completedRun }
    : record)
}

function archivedApplicationState(
  completedRun: AgentModelingCompletedRun,
): AgentModelingRunRecord['application'] {
  if (completedRun.application?.applicationBlocked) return 'blocked'
  if (completedRun.application?.appliedToWorkspace) {
    return completedRun.application.applicationVerified === true ? 'verified' : 'applied'
  }
  return completedRun.candidate ? 'candidate' : undefined
}

export function restoreAgentModelingRunArtifact(
  value: unknown,
): { artifact: AgentModelingRunArtifact; completedRun: AgentModelingCompletedRun; record: AgentModelingRunRecord } {
  const artifact = parseAgentModelingRunArtifact(value)
  const completedRun: AgentModelingCompletedRun = {
    id: artifact.runId,
    manifest: artifact.tool,
    input: artifact.input,
    result: artifact.result,
    candidate: artifact.candidate,
    application: artifact.application,
    startedAt: Date.parse(artifact.startedAt),
    durationMs: artifact.durationMs,
    origin: artifact.origin,
    workspaceRevision: artifact.workspaceRevision,
    targetEvidenceBundle: artifact.targetEvidenceBundle,
  }
  const status: AgentModelingRunRecord['status'] = artifact.result.error?.code === 'tool_execution_aborted'
    ? 'cancelled'
    : artifact.result.ok ? 'success' : 'error'
  const record = historyRecord(
    completedRun.id,
    completedRun.manifest,
    completedRun.result,
    completedRun.startedAt,
    completedRun.durationMs,
    status,
    completedRun,
  )
  const application = archivedApplicationState(completedRun)
  if (application) record.application = application
  return { artifact, completedRun, record }
}

function cancelledResult(tool: string): ZatomToolResult {
  return {
    ok: false,
    tool,
    summary: 'Run cancelled',
    error: { code: 'tool_execution_aborted', message: 'Run cancelled by the user' },
  }
}

async function captureAgentModelingOrigin(): Promise<AgentModelingOrigin> {
  const viewportId = useViewportManager.getState().activeViewportId
  const structure = await activeViewportToolContext.readStructure?.() ?? null
  const trajectory = await activeViewportToolContext.readTrajectory?.() ?? null
  const currentViewportId = useViewportManager.getState().activeViewportId
  if (currentViewportId !== viewportId) {
    throw new Error(`Active viewport changed from ${viewportId} to ${currentViewportId} while capturing the candidate origin`)
  }
  return {
    viewportId,
    structureFingerprint: structure ? fingerprintStructure(structure) : null,
    trajectoryFingerprint: trajectory ? fingerprintTrajectory(trajectory) : null,
  }
}

function originFromWorkspaceSnapshot(snapshot: AgentWorkspaceSnapshot): AgentModelingOrigin {
  return workspaceSnapshotIdentity(snapshot)
}

function directWorkspaceWrite(manifest: ZatomToolManifest): boolean {
  return manifest.effects.workspace === 'write' && !agentToolProducesCandidate(manifest)
}

/**
 * Roll back a write that may already be in its non-authoritative reveal.
 * Using the review's exact closure prevents our own rollback from looking like
 * a competing user edit and incorrectly entering manual-control mode.
 */
async function restoreAfterAgentWrite(
  target: AgentWorkspaceSnapshot,
  expectedCurrent?: AgentWorkspaceSnapshot,
): Promise<AgentWorkspaceSnapshot> {
  let control = useAgentOperationReview.getState().control
  if (control.phase === 'manual_control') {
    throw new Error('The user is editing manually; their workspace was not overwritten by an automatic rollback')
  }
  if (control.phase === 'animating') abortChoreography()
  if (control.phase === 'animating' || control.phase === 'awaiting_review') {
    const deadline = Date.now() + 3_000
    let review = selectPendingReview(useAgentOperationReview.getState())
    while (!review && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      control = useAgentOperationReview.getState().control
      if (control.phase === 'manual_control') {
        throw new Error('The user took over while rollback was preparing; their workspace was kept')
      }
      review = selectPendingReview(useAgentOperationReview.getState())
    }
    if (review?.subject.kind === 'structure' && review.subject.revert) {
      if (expectedCurrent) {
        const current = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
        if (!workspaceIdentityMatches(current, expectedCurrent)) {
          throw new Error('The workspace changed before rollback; newer state was kept')
        }
      }
      await review.subject.revert()
      useAgentOperationReview.getState().dismissReview()
      const restored = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
      if (!workspaceIdentityMatches(restored, target)) {
        throw new Error('The exact operation rollback did not restore the expected workspace snapshot')
      }
      return restored
    }
    throw new Error('The operation review did not become ready after its animation was skipped')
  }
  return replaceAgentWorkspaceSnapshot({
    target,
    context: activeViewportWorkspaceRevisionContext,
    ...(expectedCurrent ? { expectedCurrent } : {}),
  })
}

async function finalizeDirectWorkspaceTransaction(options: {
  runId: number
  manifest: ZatomToolManifest
  startedAt: number
  before: AgentWorkspaceSnapshot
  result: ZatomToolResult
}): Promise<{ result: ZatomToolResult; workspaceRevision: AgentWorkspaceRevision | null }> {
  let after: AgentWorkspaceSnapshot
  try {
    after = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
  } catch (error) {
    try {
      await restoreAfterAgentWrite(options.before)
    } catch (rollbackError) {
      const message = `Workspace verification failed (${error instanceof Error ? error.message : String(error)}) and rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`
      return {
        workspaceRevision: null,
        result: {
          ...options.result,
          ok: false,
          summary: message,
          error: { code: 'workspace_transaction_rollback_failed', message },
        },
      }
    }
    const message = `Workspace verification failed and the original state was restored: ${error instanceof Error ? error.message : String(error)}`
    return {
      workspaceRevision: null,
      result: {
        ...options.result,
        ok: false,
        summary: message,
        error: { code: 'workspace_application_unverified', message },
        checks: [...(options.result.checks ?? []), {
          id: 'workspace.transaction_rollback',
          status: 'pass',
          message: 'Restored the exact pre-run workspace after verification failed',
        }],
      },
    }
  }
  if (workspaceIdentityMatches(options.before, after)) {
    return { result: options.result, workspaceRevision: null }
  }
  const envelope = isRecord(options.result.data) ? options.result.data : null
  const verified = options.result.ok
    && envelope?.appliedToWorkspace === true
    && envelope.applicationVerified === true
  if (verified) {
    return {
      result: options.result,
      workspaceRevision: composeAgentWorkspaceRevision({
        runId: options.runId,
        tool: options.manifest.name,
        createdAt: options.startedAt,
        before: options.before,
        after,
      }),
    }
  }
  try {
    await restoreAfterAgentWrite(options.before, after)
  } catch (error) {
    const message = `Unverified workspace mutation could not be rolled back: ${error instanceof Error ? error.message : String(error)}`
    return {
      workspaceRevision: null,
      result: {
        ...options.result,
        ok: false,
        summary: message,
        error: { code: 'workspace_transaction_rollback_failed', message },
      },
    }
  }
  const message = options.result.ok
    ? 'Tool changed the active workspace without a verified application contract; restored the exact pre-run state'
    : `${options.result.summary}; restored the exact pre-run workspace after the failed write`
  return {
    workspaceRevision: null,
    result: {
      ...options.result,
      ok: false,
      summary: message,
      error: options.result.ok
        ? { code: 'workspace_application_unverified', message }
        : options.result.error,
      checks: [...(options.result.checks ?? []), {
        id: 'workspace.transaction_rollback',
        status: 'pass',
        message: 'Restored the exact pre-run workspace after an unverified or failed write',
      }],
    },
  }
}

export const useAgentModelingStore = create<AgentModelingStore>((set, get) => ({
  status: 'idle',
  runningTool: null,
  current: null,
  history: [],
  historyStatus: 'idle',
  historyPersistenceError: null,
  providers: [],
  providersStatus: 'idle',
  providersError: null,
  focusingTargetKey: null,
  visualError: null,
  workspaceRevisionPosition: null,
  workspaceRevisionStatus: 'idle',
  workspaceRevisionError: null,

  runTool: async (manifest, input) => {
    activeController?.abort()
    const sequence = ++runSequence
    const controller = new AbortController()
    activeController = controller
    const startedAt = Date.now()
    const normalizedInput = previewInput(manifest, input)
    let origin: AgentModelingOrigin = {
      viewportId: useViewportManager.getState().activeViewportId,
      structureFingerprint: null,
      trajectoryFingerprint: null,
    }
    let workspaceBefore: AgentWorkspaceSnapshot | null = null
    set({
      status: 'running',
      runningTool: manifest,
      current: null,
      focusingTargetKey: null,
      visualError: null,
      workspaceRevisionPosition: null,
      workspaceRevisionStatus: 'idle',
      workspaceRevisionError: null,
    })
    let result: ZatomToolResult
    try {
      if (directWorkspaceWrite(manifest)) {
        workspaceBefore = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
        origin = originFromWorkspaceSnapshot(workspaceBefore)
      } else {
        origin = await captureAgentModelingOrigin()
      }
      result = await executeZatomAgentTool(manifest.name, normalizedInput, {
        ...activeViewportToolContext,
        signal: controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { ok: false, tool: manifest.name, summary: message, error: { code: 'tool_execution_failed', message } }
    }
    if (sequence !== runSequence) return
    activeController = null
    let workspaceRevision: AgentWorkspaceRevision | null = null
    if (workspaceBefore) {
      try {
        const transaction = await finalizeDirectWorkspaceTransaction({
          runId: sequence,
          manifest,
          startedAt,
          before: workspaceBefore,
          result,
        })
        result = transaction.result
        workspaceRevision = transaction.workspaceRevision
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result = {
          ...result,
          ok: false,
          summary: message,
          error: { code: 'workspace_transaction_failed', message },
        }
      }
    }
    const durationMs = Date.now() - startedAt
    const producesCandidate = agentToolProducesCandidate(manifest)
    const candidate = producesCandidate ? extractAgentModelingCandidate(result) : null
    if (producesCandidate && result.ok && !candidate) {
      const check: ValidationCheck = {
        id: 'candidate.output_contract',
        status: 'fail',
        message: 'Tool declared a workspace candidate effect but did not return a canonical structure/trajectory with valid checks',
      }
      result = {
        ...result,
        ok: false,
        summary: `${result.summary}; rejected invalid candidate output`,
        error: {
          code: 'invalid_tool_candidate_output',
          message: check.message,
        },
        checks: [...(result.checks ?? []), check],
      }
    }
    const status: AgentModelingRunStatus = result.ok ? 'success' : result.error?.code === 'tool_execution_aborted' ? 'cancelled' : 'error'
    const completedRun: AgentModelingCompletedRun = {
      id: sequence,
      manifest,
      input: normalizedInput,
      result,
      candidate,
      application: null,
      startedAt,
      durationMs,
      origin,
      workspaceRevision,
      targetEvidenceBundle: [],
    }
    const record = historyRecord(
      sequence,
      manifest,
      result,
      startedAt,
      durationMs,
      status === 'cancelled' ? 'cancelled' : result.ok ? 'success' : 'error',
      completedRun,
    )
    if (candidate) record.application = 'candidate'
    else if (isRecord(result.data)) {
      if (result.data.applicationBlocked === true) record.application = 'blocked'
      else if (result.data.appliedToWorkspace === true) {
        record.application = result.data.applicationVerified === true ? 'verified' : 'applied'
      }
    }
    set((state) => ({
      status,
      runningTool: null,
      current: completedRun,
      workspaceRevisionPosition: workspaceRevision ? 'after' : null,
      workspaceRevisionStatus: 'idle',
      workspaceRevisionError: null,
      history: [record, ...state.history].slice(0, AGENT_MODELING_RUN_HISTORY_LIMIT),
    }))
  },

  cancelRun: () => {
    const running = get().runningTool
    if (!running || get().status !== 'running') return
    const startedAt = Date.now()
    activeController?.abort()
    activeController = null
    const sequence = ++runSequence
    const result = cancelledResult(running.name)
    set((state) => ({
      status: 'cancelled',
      runningTool: null,
      current: null,
      focusingTargetKey: null,
      visualError: null,
      workspaceRevisionPosition: null,
      workspaceRevisionStatus: 'idle',
      workspaceRevisionError: null,
      history: [historyRecord(sequence, running, result, startedAt, 0, 'cancelled', null), ...state.history]
        .slice(0, AGENT_MODELING_RUN_HISTORY_LIMIT),
    }))
  },

  applyCurrentCandidate: async (captureAfter = true) => {
    const current = get().current
    if (!current?.candidate || get().status === 'running') return
    let transactionBefore: AgentWorkspaceSnapshot | null = null
    set({
      status: 'running',
      runningTool: current.manifest,
      current: { ...current, targetEvidenceBundle: [] },
      visualError: null,
      workspaceRevisionPosition: null,
      workspaceRevisionStatus: 'idle',
      workspaceRevisionError: null,
    })
    try {
      transactionBefore = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
      const activeOrigin = originFromWorkspaceSnapshot(transactionBefore)
      const originMismatch = agentModelingOriginMismatch(current.origin, activeOrigin)
      if (originMismatch) {
        const result: ZatomToolResult = {
          ...current.result,
          ok: false,
          summary: `${current.result.summary}; candidate application blocked because its origin changed`,
          checks: [...(current.result.checks ?? []), {
            id: 'candidate.origin_identity',
            status: 'fail',
            message: originMismatch,
            metrics: {
              expectedViewportId: current.origin.viewportId,
              actualViewportId: activeOrigin.viewportId,
              expectedStructureFingerprint: current.origin.structureFingerprint,
              actualStructureFingerprint: activeOrigin.structureFingerprint,
              expectedTrajectoryFingerprint: current.origin.trajectoryFingerprint,
              actualTrajectoryFingerprint: activeOrigin.trajectoryFingerprint,
            },
          }],
        }
        const completedRun: AgentModelingCompletedRun = {
          ...current,
          result,
          targetEvidenceBundle: [],
        }
        set((state) => ({
          status: 'error',
          runningTool: null,
          current: completedRun,
          workspaceRevisionPosition: null,
          workspaceRevisionStatus: 'idle',
          workspaceRevisionError: null,
          history: updateHistoryRun(state.history, completedRun, {
            status: 'error',
            summary: result.summary,
            checks: countAgentModelingChecks(result.checks),
            application: 'blocked',
          }),
        }))
        return
      }
      const candidate = {
        ...current.candidate,
        checks: [...current.candidate.checks, {
          id: 'candidate.origin_identity',
          status: 'pass' as const,
          message: `Candidate origin still matches active viewport ${current.origin.viewportId}`,
          metrics: {
            viewportId: current.origin.viewportId,
            structureFingerprint: current.origin.structureFingerprint,
            trajectoryFingerprint: current.origin.trajectoryFingerprint,
          },
        }],
      }
      let application: CandidateEnvelope<AgentModelingCandidate>
      if (candidate.kind === 'structure') {
        application = await applyStructureCandidate({
            result: candidate,
            requestedApply: true,
            captureAfter,
            context: activeViewportToolContext,
          })
      } else {
        application = await applyTrajectoryCandidate({
            result: candidate,
            requestedApply: true,
            captureAfter,
            context: activeViewportToolContext,
          })
      }
      const transactionAfter = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
      let workspaceRevision: AgentWorkspaceRevision | null = null
      const workspaceChanged = !workspaceIdentityMatches(transactionBefore, transactionAfter)
      if (application.appliedToWorkspace && application.applicationVerified === true) {
        if (workspaceChanged) {
          workspaceRevision = composeAgentWorkspaceRevision({
            runId: current.id,
            tool: current.manifest.name,
            createdAt: Date.now(),
            before: transactionBefore,
            after: transactionAfter,
          })
          application = {
            ...application,
            result: {
              ...application.result,
              checks: [...application.result.checks, {
                id: 'workspace.revision',
                status: 'pass',
                message: `Recorded reversible workspace revision ${workspaceRevision.fingerprint}`,
                metrics: { revisionFingerprint: workspaceRevision.fingerprint },
              }],
            },
          }
        }
      } else if (workspaceChanged) {
        await restoreAfterAgentWrite(transactionBefore, transactionAfter)
        application = {
          ...application,
          appliedToWorkspace: false,
          result: {
            ...application.result,
            checks: [...application.result.checks, {
              id: 'workspace.transaction_rollback',
              status: 'pass',
              message: 'Restored the exact pre-application workspace after the write was blocked or failed verification',
            }],
          },
        }
      }
      const result: ZatomToolResult = {
        ...current.result,
        ok: !application.applicationBlocked && application.applicationVerified !== false,
        summary: application.applicationVerified === true
          ? `${current.result.summary}; applied and fingerprint-verified in the active workspace`
          : application.applicationBlocked
            ? `${current.result.summary}; workspace application blocked`
            : `${current.result.summary}; applied without verified readback`,
        checks: application.result.checks,
      }
      const nextStatus = application.applicationBlocked || application.applicationVerified === false ? 'error' : 'success'
      const applicationStatus = application.applicationBlocked
        ? 'blocked'
        : application.applicationVerified === true
          ? 'verified'
          : 'applied'
      const completedRun: AgentModelingCompletedRun = {
        ...current,
        result,
        candidate: application.result,
        application,
        workspaceRevision,
        targetEvidenceBundle: [],
      }
      set((state) => ({
        status: nextStatus,
        runningTool: null,
        current: completedRun,
        workspaceRevisionPosition: workspaceRevision ? 'after' : null,
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: null,
        history: updateHistoryRun(state.history, completedRun, {
          status: nextStatus === 'success' ? 'success' : 'error',
          summary: result.summary,
          checks: countAgentModelingChecks(result.checks),
          application: applicationStatus,
        }),
      }))
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      if (transactionBefore) {
        try {
          await restoreAfterAgentWrite(transactionBefore)
          message = `${message}; restored the exact pre-application workspace`
        } catch (rollbackError) {
          message = `${message}; workspace rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        }
      }
      const result: ZatomToolResult = {
        ...current.result,
        ok: false,
        summary: message,
        error: { code: 'candidate_application_failed', message },
      }
      const completedRun: AgentModelingCompletedRun = {
        ...current,
        result,
        targetEvidenceBundle: [],
      }
      set((state) => ({
        status: 'error',
        runningTool: null,
        current: completedRun,
        workspaceRevisionPosition: null,
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: message,
        history: updateHistoryRun(state.history, completedRun, {
          status: 'error',
          summary: message,
          checks: countAgentModelingChecks(result.checks),
          application: 'blocked',
        }),
      }))
    }
  },

  refreshCurrentWorkspaceRevision: async () => {
    const current = get().current
    if (!current?.workspaceRevision || get().workspaceRevisionStatus === 'restoring') {
      set({
        workspaceRevisionPosition: null,
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: null,
      })
      return
    }
    const revisionFingerprint = current.workspaceRevision.fingerprint
    set({ workspaceRevisionStatus: 'checking', workspaceRevisionError: null })
    try {
      const snapshot = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
      if (get().current?.workspaceRevision?.fingerprint !== revisionFingerprint) return
      set({
        workspaceRevisionPosition: classifyAgentWorkspaceRevision(current.workspaceRevision, snapshot),
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: null,
      })
    } catch (error) {
      if (get().current?.workspaceRevision?.fingerprint !== revisionFingerprint) return
      set({
        workspaceRevisionPosition: 'diverged',
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: error instanceof Error ? error.message : String(error),
      })
    }
  },

  restoreCurrentWorkspaceRevision: async (direction) => {
    const current = get().current
    if (!current?.workspaceRevision || get().status === 'running'
      || get().workspaceRevisionStatus !== 'idle') return false
    const revisionFingerprint = current.workspaceRevision.fingerprint
    set({ workspaceRevisionStatus: 'restoring', workspaceRevisionError: null })
    try {
      const restored = direction === 'undo'
        ? await restoreAfterAgentWrite(current.workspaceRevision.before, current.workspaceRevision.after)
        : await restoreAgentWorkspaceRevision({
            revision: current.workspaceRevision,
            direction,
            context: activeViewportWorkspaceRevisionContext,
          })
      if (get().current?.workspaceRevision?.fingerprint !== revisionFingerprint) return false
      set({
        workspaceRevisionPosition: classifyAgentWorkspaceRevision(current.workspaceRevision, restored),
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: null,
        visualError: null,
      })
      return true
    } catch (error) {
      if (get().current?.workspaceRevision?.fingerprint !== revisionFingerprint) return false
      let position: AgentWorkspaceRevisionPosition = 'diverged'
      try {
        const snapshot = await captureAgentWorkspaceSnapshot(activeViewportWorkspaceRevisionContext)
        position = classifyAgentWorkspaceRevision(current.workspaceRevision, snapshot)
      } catch {
        // Preserve the original restore error; an unreadable workspace remains diverged.
      }
      set({
        workspaceRevisionPosition: position,
        workspaceRevisionStatus: 'idle',
        workspaceRevisionError: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  },

  focusCurrentTarget: async (target) => {
    const current = get().current
    if (!current || get().focusingTargetKey) return false
    const binding = agentModelingVisualBinding(current, target)
    if (!binding) {
      set({ visualError: 'This target is not bound to the fingerprint-verified active workspace. Apply its candidate or rerun the inspection from the active workspace.' })
      return false
    }
    const targetKey = agentModelingInspectionTargetKey(target)
    set({
      focusingTargetKey: targetKey,
      visualError: null,
    })
    try {
      const result = await executeZatomAgentTool('viewer_focus_target', {
        inspectionTarget: inspectionTargetToolInput(target),
        ...binding,
        captureAfter: true,
      }, activeViewportToolContext)
      if (!result.ok) throw new Error(result.error?.message ?? result.summary)
      const data = isRecord(result.data) ? result.data : null
      const image = data?.visualEvidence
      if (!capturedImage(image)) throw new Error('The target was focused, but the viewport did not return image evidence')
      const evidenceTarget: AgentModelingInspectionTarget = {
        ...target,
        expectedStructureFingerprint: binding.expectedStructureFingerprint,
        ...(binding.expectedTrajectoryFingerprint
          ? { expectedTrajectoryFingerprint: binding.expectedTrajectoryFingerprint }
          : {}),
      }
      const evidence: AgentModelingTargetEvidence = {
        target: evidenceTarget,
        image,
        checks: result.checks ?? [],
        summary: result.summary,
        structureFingerprint: binding.expectedStructureFingerprint,
        ...(binding.expectedTrajectoryFingerprint ? { trajectoryFingerprint: binding.expectedTrajectoryFingerprint } : {}),
        capturedAt: Date.now(),
      }
      let retained = false
      set((state) => {
        if (state.current?.id !== current.id) return { focusingTargetKey: null }
        retained = true
        const completedRun: AgentModelingCompletedRun = {
          ...state.current,
          targetEvidenceBundle: upsertAgentModelingTargetEvidence(
            state.current.targetEvidenceBundle,
            evidence,
          ),
        }
        return {
          focusingTargetKey: null,
          visualError: null,
          current: completedRun,
          history: updateHistoryRun(state.history, completedRun),
        }
      })
      return retained
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => state.current?.id === current.id
        ? { focusingTargetKey: null, visualError: message }
        : { focusingTargetKey: null })
      return false
    }
  },

  openHistoryRun: (id) => {
    if (get().status === 'running' || get().focusingTargetKey) return false
    const record = get().history.find((candidate) => candidate.id === id)
    if (!record?.completedRun) return false
    set({
      status: record.status,
      runningTool: null,
      current: record.completedRun,
      focusingTargetKey: null,
      visualError: null,
      workspaceRevisionPosition: null,
      workspaceRevisionStatus: 'idle',
      workspaceRevisionError: null,
    })
    return true
  },

  refreshProviders: async () => {
    if (get().providersStatus === 'loading') return
    set({ providersStatus: 'loading', providersError: null })
    try {
      const result = await executeZatomAgentTool(
        'modeling_list_providers',
        { includeSchemas: true, limit: 100 },
        activeViewportToolContext,
      )
      const data = isRecord(result.data) ? result.data : null
      const providers = data && Array.isArray(data.providers)
        ? data.providers as unknown as ZatomDiscoveredProviderManifest[]
        : []
      if (!result.ok) {
        set({
          providersStatus: 'error',
          providersError: result.error?.message ?? result.summary,
          providers: [],
        })
        return
      }
      set({ providersStatus: 'ready', providersError: null, providers })
    } catch (error) {
      set({
        providersStatus: 'error',
        providersError: error instanceof Error ? error.message : String(error),
        providers: [],
      })
    }
  },

  clearHistory: () => set({ history: [] }),
}))

export function setAgentModelingHistoryPersistenceState(
  status: AgentModelingStore['historyStatus'],
  error: string | null = null,
): void {
  useAgentModelingStore.setState({ historyStatus: status, historyPersistenceError: error })
}

function restoreAgentModelingHistory(values: readonly unknown[]) {
  const restored = values.map(restoreAgentModelingRunArtifact)
    .sort((left, right) => (
      right.completedRun.startedAt - left.completedRun.startedAt
      || right.completedRun.id - left.completedRun.id
    ))
  if (restored.length > AGENT_MODELING_RUN_HISTORY_LIMIT) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Persistent Agent run history contains ${restored.length} records above limit ${AGENT_MODELING_RUN_HISTORY_LIMIT}`,
    )
  }
  const ids = restored.map(({ completedRun }) => completedRun.id)
  if (new Set(ids).size !== ids.length) {
    throw new AgentModelingRunArtifactError(
      'duplicate_agent_run_id',
      'Persistent Agent run history contains duplicate run IDs',
    )
  }
  return restored
}

function installAgentModelingHistory(
  restored: ReturnType<typeof restoreAgentModelingHistory>,
): void {
  const ids = restored.map(({ completedRun }) => completedRun.id)
  runSequence = Math.max(runSequence, 0, ...ids)
  const latest = restored[0]
  useAgentModelingStore.setState({
    status: latest?.record.status ?? 'idle',
    runningTool: null,
    current: latest?.completedRun ?? null,
    history: restored.map(({ record }) => record),
    historyStatus: 'ready',
    historyPersistenceError: null,
    focusingTargetKey: null,
    visualError: null,
    workspaceRevisionPosition: null,
    workspaceRevisionStatus: 'idle',
    workspaceRevisionError: null,
  })
}

/** Replace browser-local history with exact imported artifacts; run identities are never rewritten. */
export function replaceAgentModelingRunHistory(values: readonly unknown[]): void {
  const state = useAgentModelingStore.getState()
  if (state.status === 'running' || state.focusingTargetKey) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_busy',
      'Modeling run history cannot be replaced while execution or visual capture is active',
    )
  }
  if (!values.length) {
    installAgentModelingHistory([])
    return
  }
  installAgentModelingHistory(restoreAgentModelingHistory(values))
}

/** Hydrate before Workbench execution; merging and ID rewriting are not permitted. */
export function hydrateAgentModelingRunHistory(values: readonly unknown[]): void {
  const state = useAgentModelingStore.getState()
  if (state.history.length || state.current || state.status === 'running') {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_already_active',
      'Persistent Agent run history must hydrate before any session run starts',
    )
  }
  installAgentModelingHistory(restoreAgentModelingHistory(values))
}
