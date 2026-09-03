import { fingerprintCanonicalJson } from '../../agent/structure-math'
import {
  AGENT_MODELING_RUN_HISTORY_LIMIT,
  AgentModelingRunArtifactError,
  composeAgentModelingRunArtifact,
  parseAgentModelingRunArtifact,
  type AgentModelingRunArtifact,
  type AgentModelingRunRecord,
} from './agent-modeling-store'

export const ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA = 'zatom.agent-modeling-history-bundle/v2'

export interface AgentModelingHistoryBundle {
  schemaVersion: typeof ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA
  fingerprint: string
  runs: AgentModelingRunArtifact[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function compareRuns(left: AgentModelingRunArtifact, right: AgentModelingRunArtifact): number {
  return Date.parse(right.startedAt) - Date.parse(left.startedAt) || right.runId - left.runId
}

function canonicalRunOrder(runs: readonly AgentModelingRunArtifact[]): AgentModelingRunArtifact[] {
  return [...runs].sort(compareRuns)
}

/** Compose one portable, exact-replay archive from complete browser-local runs. */
export function composeAgentModelingHistoryBundle(
  history: readonly AgentModelingRunRecord[],
): AgentModelingHistoryBundle {
  const runs = canonicalRunOrder(history
    .filter((record) => record.completedRun !== null)
    .map((record) => parseAgentModelingRunArtifact(
      composeAgentModelingRunArtifact(record.completedRun!),
    )))
  if (!runs.length) {
    throw new AgentModelingRunArtifactError(
      'agent_run_bundle_empty',
      'A modeling history bundle requires at least one complete run',
    )
  }
  if (runs.length > AGENT_MODELING_RUN_HISTORY_LIMIT) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Modeling history bundle contains ${runs.length} runs above limit ${AGENT_MODELING_RUN_HISTORY_LIMIT}`,
    )
  }
  const ids = runs.map((run) => run.runId)
  if (new Set(ids).size !== ids.length) {
    throw new AgentModelingRunArtifactError(
      'duplicate_agent_run_id',
      'Modeling history bundle contains duplicate run IDs',
    )
  }
  const payload: Omit<AgentModelingHistoryBundle, 'fingerprint'> = {
    schemaVersion: ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA,
    runs,
  }
  return { ...payload, fingerprint: fingerprintCanonicalJson(payload) }
}

/** Parse an untrusted portable archive and replay every nested run fingerprint. */
export function parseAgentModelingHistoryBundle(value: unknown): AgentModelingHistoryBundle {
  if (!isRecord(value) || !hasExactFields(value, ['schemaVersion', 'fingerprint', 'runs'])
    || value.schemaVersion !== ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA
    || typeof value.fingerprint !== 'string' || !Array.isArray(value.runs)
    || value.runs.length < 1 || value.runs.length > AGENT_MODELING_RUN_HISTORY_LIMIT) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_bundle',
      `Modeling history bundle must use ${ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA} with 1-${AGENT_MODELING_RUN_HISTORY_LIMIT} runs`,
    )
  }
  const { fingerprint, ...rawPayload } = value
  const expectedFingerprint = fingerprintCanonicalJson(rawPayload)
  if (fingerprint !== expectedFingerprint) {
    throw new AgentModelingRunArtifactError(
      'agent_run_bundle_fingerprint_mismatch',
      `Modeling history bundle fingerprint ${fingerprint} does not match ${expectedFingerprint}`,
    )
  }
  const runs = value.runs.map(parseAgentModelingRunArtifact)
  const ids = runs.map((run) => run.runId)
  if (new Set(ids).size !== ids.length) {
    throw new AgentModelingRunArtifactError(
      'duplicate_agent_run_id',
      'Modeling history bundle contains duplicate run IDs',
    )
  }
  const fingerprints = runs.map((run) => run.fingerprint)
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_bundle',
      'Modeling history bundle contains duplicate run artifacts',
    )
  }
  const ordered = canonicalRunOrder(runs)
  if (ordered.some((run, index) => run.fingerprint !== runs[index]?.fingerprint)) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_bundle',
      'Modeling history bundle runs are not in canonical newest-first order',
    )
  }
  return {
    schemaVersion: ZATOM_AGENT_MODELING_HISTORY_BUNDLE_SCHEMA,
    fingerprint,
    runs,
  }
}
