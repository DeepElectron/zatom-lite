/// <reference lib="webworker" />

import { generatePolycrystal } from './polycrystal-generator'
import type {
  PolycrystalWorkerRequest,
  PolycrystalWorkerResponse,
} from './polycrystal-worker-types'

const workerScope = self as unknown as DedicatedWorkerGlobalScope

workerScope.addEventListener('message', (event: MessageEvent<PolycrystalWorkerRequest>) => {
  const { requestId, options, base } = event.data
  try {
    let lastSent = 0
    const result = generatePolycrystal(options, base, (fraction) => {
      // throttle progress posts to ~5% steps
      if (fraction - lastSent >= 0.05 || fraction === 1) {
        lastSent = fraction
        const p: PolycrystalWorkerResponse = { requestId, kind: 'progress', fraction }
        workerScope.postMessage(p)
      }
    })
    const response: PolycrystalWorkerResponse = {
      requestId,
      kind: 'result',
      positions: result.positions,
      elementIndex: result.elementIndex,
      grainId: result.grainId,
      basisIndex: result.basisIndex,
      elements: result.elements,
      count: result.count,
      bbox: result.bbox,
      seeds: result.seeds,
      rotations: result.rotations,
    }
    workerScope.postMessage(response, [
      result.positions.buffer as Transferable,
      result.elementIndex.buffer as Transferable,
      result.grainId.buffer as Transferable,
      result.basisIndex.buffer as Transferable,
      result.seeds.buffer as Transferable,
      result.rotations.buffer as Transferable,
    ])
  } catch (error) {
    const response: PolycrystalWorkerResponse = {
      requestId,
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
    workerScope.postMessage(response)
  }
})

export {}
