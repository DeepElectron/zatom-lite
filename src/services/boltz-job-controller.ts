/**
 * Job polling controller: the active half of the persistent queue.
 *
 * Polling follows remoteId rather than React component lifecycles. `resumeAllJobs()` restarts all
 * non-terminal persisted jobs after a refresh, while module-level timers survive UI unmounts.
 *
 * Design and screening jobs can run for tens of minutes, so polling backs off from 2 to 30 seconds
 * instead of issuing thousands of fixed-interval requests.
 */

import { getJob, stopJob } from './boltz-client'
import { boltzJobStore, type BoltzQueuedJob } from './boltz-jobs'
import { isTerminalStatus } from './boltz-pipelines'

const INITIAL_POLL_MS = 2_000
const MAX_POLL_MS = 30_000
/** A 1.5x backoff reaches the 30-second cap after roughly eight polls. */
const POLL_BACKOFF = 1.5

function nextInterval(current: number): number {
  return Math.min(Math.round(current * POLL_BACKOFF), MAX_POLL_MS)
}

/**
 * Start polling one job idempotently so resume and submit cannot create duplicate requests.
 */
export function startPolling(localId: string, apiKey: string): void {
  if (boltzJobStore.hasPoller(localId)) return

  const tick = async (intervalMs: number): Promise<void> => {
    const job = boltzJobStore.get(localId)
    // Stop when the job was removed or has not received a remote id.
    if (!job || !job.remoteId) {
      boltzJobStore.clearPoller(localId)
      return
    }

    try {
      const remote = await getJob(apiKey, job.pipelineId, job.remoteId)
      boltzJobStore.patch(localId, {
        status: remote.status,
        ...(remote.progress === undefined ? {} : { progress: remote.progress }),
        ...(remote.error === undefined ? {} : { error: remote.error }),
      })
      if (isTerminalStatus(remote.status)) {
        boltzJobStore.clearPoller(localId)
        return
      }
    } catch (error) {
      // Record transient network or gateway errors but keep polling; only a remote failed state is terminal.
      boltzJobStore.patch(localId, {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    boltzJobStore.registerPoller(localId, setTimeout(() => { void tick(nextInterval(intervalMs)) }, intervalMs))
  }

  // Poll immediately so the UI does not wait for the initial interval.
  boltzJobStore.registerPoller(localId, setTimeout(() => { void tick(INITIAL_POLL_MS) }, 0))
}

/**
 * Reconnect unfinished jobs after a refresh. Without a key, defer until one is provided.
 */
export function resumeAllJobs(apiKey: string): number {
  if (!apiKey) return 0
  const pending = boltzJobStore.getSnapshot().filter(
    (job) => job.remoteId !== null && !isTerminalStatus(job.status),
  )
  for (const job of pending) startPolling(job.localId, apiKey)
  return pending.length
}

/** Request a remote stop, then mark the local record stopped even if the request fails. */
export async function stopQueuedJob(job: BoltzQueuedJob, apiKey: string): Promise<void> {
  boltzJobStore.clearPoller(job.localId)
  if (job.remoteId) {
    try {
      await stopJob(apiKey, job.pipelineId, job.remoteId)
    } catch (error) {
      boltzJobStore.patch(job.localId, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  boltzJobStore.patch(job.localId, { status: 'stopped' })
}
