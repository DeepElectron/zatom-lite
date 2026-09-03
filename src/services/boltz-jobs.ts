/**
 * Persistent Boltz job queue.
 *
 * Jobs have a lifecycle independent of structures and survive refreshes and structure changes, so
 * they live in a small localStorage-backed store rather than adding unrelated crystal-store subscriptions.
 *
 * Persist job metadata, not result artifacts. Artifacts are fetched on demand, keeping storage
 * bounded. API keys are never persisted here.
 */

import {
  type BoltzJobStatus,
  type BoltzPipelineId,
  isPipelineId,
  isTerminalStatus,
} from './boltz-pipelines'

/** Allowed states used to validate persisted data. */
const VALID_STATUSES: readonly BoltzJobStatus[] = ['pending', 'running', 'completed', 'failed', 'stopped']

const STORAGE_KEY = 'boltz-job-queue/v1'
/** Maximum retained jobs; oldest terminal jobs are discarded first. */
const MAX_JOBS = 200

/** Persisted queue record, distinct from the BoltzJob API response. */
export interface BoltzQueuedJob {
  /** Local id created before submission to provide a stable UI key. */
  localId: string
  /** Remote id populated after successful submission. */
  remoteId: string | null
  pipelineId: BoltzPipelineId
  /** Human-readable display title supplied by the caller. */
  title: string
  status: BoltzJobStatus
  /** Service progress string such as "7/10", available for design and screening jobs. */
  progress?: string
  /** USD estimate returned before submission. */
  estimatedCostUsd?: number
  /** Submission or remote job failure reason. */
  error?: string
  createdAt: number
  updatedAt: number
}

function load(): BoltzQueuedJob[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Discard malformed entries and pipeline ids no longer present in the registry before polling starts.
    return parsed.filter((j): j is BoltzQueuedJob =>
      !!j && typeof j === 'object'
      && typeof (j as BoltzQueuedJob).localId === 'string'
      && isPipelineId((j as { pipelineId: unknown }).pipelineId)
      && VALID_STATUSES.includes((j as BoltzQueuedJob).status))
  } catch {
    return []
  }
}

function persist(jobs: BoltzQueuedJob[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
  } catch {
    // Keep the in-memory queue usable when storage is unavailable or full.
  }
}

/**
 * Minimal publish-subscribe store usable from both React and the polling loop.
 */
class BoltzJobStore {
  private jobs: BoltzQueuedJob[] = load()
  private listeners = new Set<() => void>()
  /** localId to timer, preventing duplicate pollers for one job. */
  private pollers = new Map<string, ReturnType<typeof setTimeout>>()

  getSnapshot = (): BoltzQueuedJob[] => this.jobs

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    persist(this.jobs)
    for (const l of this.listeners) l()
  }

  private write(next: BoltzQueuedJob[]): void {
    // Trim oldest terminal jobs first; fall back to the oldest active jobs only when necessary.
    let trimmed = next
    if (trimmed.length > MAX_JOBS) {
      const sorted = [...trimmed].sort((a, b) => a.createdAt - b.createdAt)
      const removable = sorted.filter((j) => isTerminalStatus(j.status))
      const victims = new Set(
        (removable.length > 0 ? removable : sorted).slice(0, trimmed.length - MAX_JOBS).map((j) => j.localId),
      )
      trimmed = trimmed.filter((j) => !victims.has(j.localId))
    }
    this.jobs = trimmed
    this.emit()
  }

  upsert(job: BoltzQueuedJob): void {
    const idx = this.jobs.findIndex((j) => j.localId === job.localId)
    if (idx === -1) this.write([job, ...this.jobs])
    else {
      const next = [...this.jobs]
      next[idx] = job
      this.write(next)
    }
  }

  patch(localId: string, patch: Partial<BoltzQueuedJob>): BoltzQueuedJob | undefined {
    const idx = this.jobs.findIndex((j) => j.localId === localId)
    if (idx === -1) return undefined
    const updated = { ...this.jobs[idx], ...patch, updatedAt: Date.now() }
    const next = [...this.jobs]
    next[idx] = updated
    this.write(next)
    return updated
  }

  remove(localId: string): void {
    this.clearPoller(localId)
    this.write(this.jobs.filter((j) => j.localId !== localId))
  }

  get(localId: string): BoltzQueuedJob | undefined {
    return this.jobs.find((j) => j.localId === localId)
  }

  registerPoller(localId: string, timer: ReturnType<typeof setTimeout>): void {
    this.clearPoller(localId)
    this.pollers.set(localId, timer)
  }

  clearPoller(localId: string): void {
    const t = this.pollers.get(localId)
    if (t) clearTimeout(t)
    this.pollers.delete(localId)
  }

  hasPoller(localId: string): boolean {
    return this.pollers.has(localId)
  }
}

export const boltzJobStore = new BoltzJobStore()

export function makeLocalId(): string {
  return `bz-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
