/// <reference lib="webworker" />

import { generateOrbitalSurface } from './orbital-surface-generator'
import type {
  OrbitalSurfaceWorkerRequest,
  OrbitalSurfaceWorkerResponse,
} from './orbital-surface-worker-types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<OrbitalSurfaceWorkerRequest>) => {
  const { requestId, job } = event.data

  try {
    const result = generateOrbitalSurface(job)
    const transferables: Transferable[] = []

    if (result.positive) {
      transferables.push(
        result.positive.vertices.buffer as Transferable,
        result.positive.normals.buffer as Transferable,
        result.positive.faces.buffer as Transferable,
      )
    }

    if (result.negative) {
      transferables.push(
        result.negative.vertices.buffer as Transferable,
        result.negative.normals.buffer as Transferable,
        result.negative.faces.buffer as Transferable,
      )
    }

    const response: OrbitalSurfaceWorkerResponse = {
      requestId,
      result,
    }

    workerScope.postMessage(response, transferables)
  } catch (error) {
    const response: OrbitalSurfaceWorkerResponse = {
      requestId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }

    workerScope.postMessage(response)
  }
})

export {}
