/**
 * Client for all seven Boltz cloud pipelines. Transport is delegated to the
 * same-origin web proxy; this module owns request shapes, response normalization
 * and error semantics. User-provided keys travel only in request headers.
 */

import {
  type BoltzJobStatus,
  type BoltzPipelineId,
  getPipeline,
  normalizeStatus,
} from './boltz-pipelines'
import { boltzApi, BoltzApiError } from './boltz-transport'

const API_KEY_SESSION_KEY = 'zatom.boltz.apiKey'

export type { BoltzJobStatus }

/** Test keys run synthetic jobs without reserving a GPU or incurring cost. */
export function isBoltzTestKey(key: string): boolean {
  return /_test_/.test(key)
}

export function readBoltzApiKey(): string {
  try {
    const stored = window.sessionStorage.getItem(API_KEY_SESSION_KEY)
    if (stored) return stored
  } catch {
    // Restricted storage falls back to the development environment value.
  }
  // The development default is injected at build time; no key lives in source.
  return import.meta.env.VITE_BOLTZ_API_KEY ?? ''
}

export function writeBoltzApiKey(key: string): void {
  try {
    const trimmed = key.trim()
    if (trimmed) window.sessionStorage.setItem(API_KEY_SESSION_KEY, trimmed)
    else window.sessionStorage.removeItem(API_KEY_SESSION_KEY)
  } catch {
    // Storage availability does not prevent using the key in this tab.
  }
}

export interface BoltzArtifact {
  url: string
  url_expires_at?: string
}

/**
 * Metrics vary by pipeline and engine version: predictions provide complex_plddt/iptm, designs
 * add binding_confidence/optimization_score, and ADME returns physicochemical properties. Keep a
 * scalar dictionary so new service fields remain visible instead of being silently discarded.
 */
export type BoltzMetrics = Record<string, number | string | null>

export interface BoltzArtifactSet {
  structure?: BoltzArtifact
  ligand_structure?: BoltzArtifact
  archive?: BoltzArtifact
}

/** Normalized candidate for designs, screens, redesigns, or prediction samples. */
export interface BoltzCandidate {
  id: string
  /** Designed-molecule SMILES; absent for protein candidates. */
  smiles?: string
  /** Protein candidate sequences, possibly spanning multiple chains. */
  sequences?: { chainIds: string[]; value: string }[]
  metrics: BoltzMetrics
  artifacts: BoltzArtifactSet
}

export interface BoltzJob {
  id: string
  status: BoltzJobStatus
  /** Service progress string such as "7/10", passed through to the UI. */
  progress?: string
  error?: string
  /** Artifacts and metrics from a single-result pipeline. */
  candidates: BoltzCandidate[]
  metrics: BoltzMetrics
}

// Error semantics belong to the transport layer; re-export its single error type.
export { BoltzApiError }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collect scalar metrics and skip nested values such as residue_distribution. */
function collectMetrics(source: unknown): BoltzMetrics {
  if (!isRecord(source)) return {}
  const out: BoltzMetrics = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number' || typeof value === 'string' || value === null) out[key] = value
  }
  return out
}

function readArtifact(value: unknown): BoltzArtifact | undefined {
  if (!isRecord(value) || typeof value.url !== 'string') return undefined
  return {
    url: value.url,
    ...(typeof value.url_expires_at === 'string' ? { url_expires_at: value.url_expires_at } : {}),
  }
}

function readArtifactSet(value: unknown): BoltzArtifactSet {
  if (!isRecord(value)) return {}
  return {
    ...(readArtifact(value.structure) ? { structure: readArtifact(value.structure)! } : {}),
    ...(readArtifact(value.ligand_structure) ? { ligand_structure: readArtifact(value.ligand_structure)! } : {}),
    ...(readArtifact(value.archive) ? { archive: readArtifact(value.archive)! } : {}),
  }
}

/** Path versioning and HTTP error normalization live in the shared web transport. */
const boltzFetch = boltzApi

/**
 * Normalize job responses, flattening samples from single-result output into candidates.
 */
function toJob(pipelineId: BoltzPipelineId, raw: unknown): BoltzJob {
  if (!isRecord(raw) || typeof raw.id !== 'string') {
    throw new BoltzApiError('Boltz returned a job without an id.')
  }
  const errorValue = raw.error
  const job: BoltzJob = {
    id: raw.id,
    status: normalizeStatus(raw.status),
    candidates: [],
    metrics: {},
    ...(typeof raw.progress === 'string' ? { progress: raw.progress } : {}),
    ...(isRecord(errorValue) && typeof errorValue.message === 'string'
      ? { error: errorValue.message }
      : typeof errorValue === 'string' ? { error: errorValue } : {}),
  }

  const output = raw.output
  if (!isRecord(output)) return job

  // Each ADME output.molecules entry carries its own properties.
  const molecules = output.molecules
  if (Array.isArray(molecules)) {
    job.candidates = molecules.map((molecule, index) => {
      const record = isRecord(molecule) ? molecule : {}
      return {
        id: typeof record.id === 'string' ? record.id : `molecule-${index}`,
        ...(typeof record.smiles === 'string' ? { smiles: record.smiles } : {}),
        // ADME properties may be flat or nested under properties; collect both.
        metrics: { ...collectMetrics(record), ...collectMetrics(record.properties) },
        artifacts: readArtifactSet(record.artifacts),
      }
    })
    return job
  }

  // Predictions expose all_sample_results or best_sample plus separate binding_metrics.
  const samples = output.all_sample_results
  const sampleList = Array.isArray(samples) && samples.length > 0
    ? samples
    : isRecord(output.best_sample) ? [output.best_sample] : []
  if (sampleList.length > 0) {
    job.candidates = sampleList.map((sample, index) => {
      const record = isRecord(sample) ? sample : {}
      return {
        id: `sample-${index}`,
        metrics: collectMetrics(record.metrics),
        artifacts: {
          ...readArtifactSet(record),
          // The archive belongs to output, so attach it to the first sample for PAE access.
          ...(index === 0 && readArtifact(output.archive)
            ? { archive: readArtifact(output.archive)! }
            : {}),
        },
      }
    })
  }
  job.metrics = { ...collectMetrics(output.binding_metrics), ...collectMetrics(output.metrics) }
  void getPipeline(pipelineId)
  return job
}

export async function submitJob(
  apiKey: string,
  pipelineId: BoltzPipelineId,
  body: unknown,
  signal?: AbortSignal,
): Promise<BoltzJob> {
  const pipeline = getPipeline(pipelineId)
  const raw = await boltzFetch<unknown>(`/${pipeline.path}`, apiKey, { method: 'POST', body, ...(signal ? { signal } : {}) })
  return toJob(pipelineId, raw)
}

export async function getJob(
  apiKey: string,
  pipelineId: BoltzPipelineId,
  jobId: string,
  signal?: AbortSignal,
): Promise<BoltzJob> {
  const pipeline = getPipeline(pipelineId)
  const raw = await boltzFetch<unknown>(`/${pipeline.path}/${jobId}`, apiKey, signal ? { signal } : {})
  return toJob(pipelineId, raw)
}

/** List paged candidates, which can arrive incrementally before the job completes. */
export async function listJobResults(
  apiKey: string,
  pipelineId: BoltzPipelineId,
  jobId: string,
  signal?: AbortSignal,
): Promise<BoltzCandidate[]> {
  const pipeline = getPipeline(pipelineId)
  const page = await boltzFetch<{ data?: unknown[] }>(
    `/${pipeline.path}/${jobId}/results`,
    apiKey,
    signal ? { signal } : {},
  )
  const rows = Array.isArray(page.data) ? page.data : []
  return rows.map((row, index) => {
    const record = isRecord(row) ? row : {}
    const entities = Array.isArray(record.entities) ? record.entities : []
    const sequences = entities.flatMap((entity) => {
      if (!isRecord(entity) || typeof entity.value !== 'string') return []
      const chainIds = Array.isArray(entity.chain_ids) ? entity.chain_ids.filter((c): c is string => typeof c === 'string') : []
      return [{ chainIds, value: entity.value }]
    })
    return {
      id: typeof record.id === 'string' ? record.id : `result-${index}`,
      ...(typeof record.smiles === 'string' ? { smiles: record.smiles } : {}),
      ...(sequences.length > 0 ? { sequences } : {}),
      metrics: collectMetrics(record.metrics),
      artifacts: readArtifactSet(record.artifacts),
    }
  })
}

/** Stop a long-running job; callers treat 4xx responses for terminal jobs as idempotent. */
export async function stopJob(
  apiKey: string,
  pipelineId: BoltzPipelineId,
  jobId: string,
  signal?: AbortSignal,
): Promise<void> {
  const pipeline = getPipeline(pipelineId)
  await boltzFetch<unknown>(`/${pipeline.path}/${jobId}/stop`, apiKey, {
    method: 'POST',
    ...(signal ? { signal } : {}),
  })
}

export interface BoltzCostEstimate {
  totalUsd: number
  units?: number
  unitUsd?: number
  disclaimer?: string
}

/**
 * Free pre-submission cost check that also performs full request validation, preventing users from
 * paying for or waiting on malformed jobs.
 */
export async function estimateCost(
  apiKey: string,
  pipelineId: BoltzPipelineId,
  body: unknown,
  signal?: AbortSignal,
): Promise<BoltzCostEstimate> {
  const pipeline = getPipeline(pipelineId)
  const raw = await boltzFetch<Record<string, unknown>>(`/${pipeline.path}/estimate-cost`, apiKey, {
    method: 'POST',
    body,
    ...(signal ? { signal } : {}),
  })
  const breakdown = isRecord(raw.breakdown) ? raw.breakdown : {}
  return {
    totalUsd: Number(raw.estimated_cost_usd ?? 0),
    ...(typeof breakdown.num_units === 'number' ? { units: breakdown.num_units } : {}),
    ...(breakdown.cost_per_unit_usd !== undefined ? { unitUsd: Number(breakdown.cost_per_unit_usd) } : {}),
    ...(typeof raw.disclaimer === 'string' ? { disclaimer: raw.disclaimer } : {}),
  }
}
