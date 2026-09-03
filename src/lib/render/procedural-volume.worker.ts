/// <reference lib="webworker" />

import { generateProceduralVolume } from './procedural-volume'
import type {
  ProceduralVolumeWorkerRequest,
  ProceduralVolumeWorkerResponse,
} from './procedural-volume-worker-types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<ProceduralVolumeWorkerRequest>) => {
  const { requestId, job } = event.data
  try {
    const result = generateProceduralVolume(job)
    const transferables: Transferable[] = [result.volume.data.buffer as Transferable]
    for (const surface of [result.positive, result.negative]) {
      if (!surface) continue
      transferables.push(
        surface.vertices.buffer as Transferable,
        surface.normals.buffer as Transferable,
        surface.faces.buffer as Transferable,
      )
    }
    const response: ProceduralVolumeWorkerResponse = { requestId, result }
    workerScope.postMessage(response, transferables)
  } catch (error) {
    const response: ProceduralVolumeWorkerResponse = {
      requestId,
      result: null,
      error: error instanceof Error ? error.message : String(error),
    }
    workerScope.postMessage(response)
  }
})

export {}
