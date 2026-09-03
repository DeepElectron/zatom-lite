/**
 * React binding for the job queue.
 *
 * useSyncExternalStore subscribes directly to the module-level store, so polling outside React
 * still rerenders the UI and jobs survive component unmounts.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { estimateCost, submitJob } from './boltz-client'
import { resumeAllJobs, startPolling, stopQueuedJob } from './boltz-job-controller'
import { boltzJobStore, makeLocalId, type BoltzQueuedJob } from './boltz-jobs'
import type { BoltzPipelineId } from './boltz-pipelines'

export interface SubmitOptions {
  pipelineId: BoltzPipelineId
  /** Request body already assembled by boltz-requests. */
  body: unknown
  /** Display title. */
  title: string
}

export interface BoltzJobsApi {
  jobs: BoltzQueuedJob[]
  /** Estimate the USD cost for pre-submission confirmation. */
  estimate: (options: Pick<SubmitOptions, 'pipelineId' | 'body'>) => Promise<number>
  /** Submit a job, start polling, and return its local id. */
  submit: (options: SubmitOptions & { estimatedCostUsd?: number }) => Promise<string>
  stop: (localId: string) => Promise<void>
  remove: (localId: string) => void
}

export function useBoltzJobs(apiKey: string): BoltzJobsApi {
  const jobs = useSyncExternalStore(boltzJobStore.subscribe, boltzJobStore.getSnapshot, boltzJobStore.getSnapshot)

  // Reconnect unfinished jobs on mount and when a key becomes available.
  useEffect(() => {
    if (apiKey) resumeAllJobs(apiKey)
  }, [apiKey])

  const estimate = useCallback(async (options: Pick<SubmitOptions, 'pipelineId' | 'body'>) => {
    const result = await estimateCost(apiKey, options.pipelineId, options.body)
    return result.totalUsd
  }, [apiKey])

  const submit = useCallback(async (options: SubmitOptions & { estimatedCostUsd?: number }) => {
    const localId = makeLocalId()
    const now = Date.now()
    // Create a pending record first so the UI responds immediately during submission.
    boltzJobStore.upsert({
      localId,
      remoteId: null,
      pipelineId: options.pipelineId,
      title: options.title,
      status: 'pending',
      ...(options.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: options.estimatedCostUsd }),
      createdAt: now,
      updatedAt: now,
    })

    try {
      // submitJob returns a normalized job, allowing immediate status updates before the first poll.
      const job = await submitJob(apiKey, options.pipelineId, options.body)
      boltzJobStore.patch(localId, {
        remoteId: job.id,
        status: job.status,
        ...(job.progress === undefined ? {} : { progress: job.progress }),
      })
      startPolling(localId, apiKey)
    } catch (error) {
      boltzJobStore.patch(localId, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return localId
  }, [apiKey])

  const stop = useCallback(async (localId: string) => {
    const job = boltzJobStore.get(localId)
    if (job) await stopQueuedJob(job, apiKey)
  }, [apiKey])

  const remove = useCallback((localId: string) => { boltzJobStore.remove(localId) }, [])

  return { jobs, estimate, submit, stop, remove }
}
