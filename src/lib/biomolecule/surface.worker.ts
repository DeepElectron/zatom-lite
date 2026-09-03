/// <reference lib="webworker" />

import { buildBioSurfaceGeometryFromJob } from './surface-geometry'
import {
  bioSurfaceTransferables,
  type BioSurfaceWorkerRequest,
  type BioSurfaceWorkerResponse,
} from './surface-worker-types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<BioSurfaceWorkerRequest>) => {
  const { requestId, job } = event.data
  try {
    const result = buildBioSurfaceGeometryFromJob(job)
    const response: BioSurfaceWorkerResponse = { requestId, result }
    workerScope.postMessage(response, bioSurfaceTransferables(result))
  } catch (error) {
    const response: BioSurfaceWorkerResponse = {
      requestId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }
    workerScope.postMessage(response)
  }
})

export {}
