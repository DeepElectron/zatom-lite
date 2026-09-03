import type { CompactStructure } from './compact-structure'
import type { AsyncFrameSource } from './frame-source'
import type { ExtxyzTrajectory } from './extxyz-frame-source'

/** Window sizing by memory budget: ~192MB of decoded frames, 6..96 frames. */
function windowSizeFor(atomCount: number): number {
  return Math.max(6, Math.min(96, Math.floor(192e6 / (atomCount * 12))))
}

/**
 * Worker-backed streaming source: indexing AND per-frame decoding run in a
 * dedicated worker (byte-level parser, transferred buffers) so the main thread
 * never parses frame text — large-atom-count playback stays smooth.
 */
export class WorkerExtxyzSource implements AsyncFrameSource {
  readonly frameCount: number
  readonly atomCount: number
  private cache = new Map<number, Float32Array>() // insertion order ≈ LRU via touch()
  private inflight = new Map<number, { promise: Promise<void>; resolve: () => void }>()
  private worker: Worker
  private window: number
  private ahead: number
  private disposed = false

  constructor(worker: Worker, frameCount: number, atomCount: number) {
    this.worker = worker
    this.frameCount = frameCount
    this.atomCount = atomCount
    this.window = windowSizeFor(atomCount)
    this.ahead = Math.max(2, Math.min(16, this.window >> 2))
    worker.addEventListener('message', (e: MessageEvent) => {
      const msg = e.data
      if (msg.kind !== 'frame' || this.disposed) return
      this.cache.set(msg.i as number, msg.positions as Float32Array)
      this.evict(msg.i as number)
      const inf = this.inflight.get(msg.i as number)
      if (inf) { this.inflight.delete(msg.i as number); inf.resolve() }
    })
  }

  tryGetFrame(i: number, out: Float32Array): boolean {
    const f = this.cache.get(i)
    if (!f) {
      void this.prefetch(i)
      return false
    }
    out.set(f)
    this.touch(i)
    this.prefetchAhead(i)
    return true
  }

  prefetch(i: number): Promise<void> {
    if (i < 0 || i >= this.frameCount || this.disposed) return Promise.resolve()
    if (this.cache.has(i)) return Promise.resolve()
    const pending = this.inflight.get(i)
    if (pending) return pending.promise
    let resolve!: () => void
    const promise = new Promise<void>((res) => { resolve = res })
    this.inflight.set(i, { promise, resolve })
    this.worker.postMessage({ kind: 'frame', i })
    return promise
  }

  dispose() {
    this.disposed = true
    this.cache.clear()
    for (const inf of this.inflight.values()) inf.resolve()
    this.inflight.clear()
    this.worker.terminate()
  }

  private prefetchAhead(i: number) {
    // bounded queue: don't flood the worker — at most `ahead` outstanding decodes
    if (this.inflight.size >= this.ahead) return
    for (let k = i + 1; k <= Math.min(i + this.ahead, this.frameCount - 1); k++) {
      if (this.inflight.size >= this.ahead) break
      void this.prefetch(k)
    }
  }

  private touch(i: number) {
    const f = this.cache.get(i)
    if (f) { this.cache.delete(i); this.cache.set(i, f) }
  }

  private evict(current: number) {
    while (this.cache.size > this.window) {
      const oldest = this.cache.keys().next().value as number
      if (oldest >= current && oldest <= current + this.ahead && this.cache.size <= this.window + this.ahead) break
      this.cache.delete(oldest)
    }
  }
}

/** Browser entry: index + decode in a worker; resolves once playable. */
export function createWorkerExtxyzFileSource(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<ExtxyzTrajectory> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./extxyz-decode.worker.ts', import.meta.url), { type: 'module' })
    const onMessage = async (e: MessageEvent) => {
      const msg = e.data
      if (msg.kind === 'progress') onProgress?.(msg.fraction as number)
      else if (msg.kind === 'error') {
        worker.removeEventListener('message', onMessage)
        worker.terminate()
        reject(new Error(msg.message as string))
      } else if (msg.kind === 'ready') {
        worker.removeEventListener('message', onMessage)
        if (msg.frameCount < 2) { worker.terminate(); reject(new Error('trajectory needs at least 2 frames')); return }
        const s = msg.structure
        const structure: CompactStructure = {
          positions: s.positions, elementIndex: s.elementIndex, elements: s.elements,
          count: msg.atomCount, bbox: s.bbox,
        }
        const source = new WorkerExtxyzSource(worker, msg.frameCount as number, msg.atomCount as number)
        // warm the first frames so playback starts immediately
        await Promise.all([source.prefetch(0), source.prefetch(1), source.prefetch(2)])
        resolve({ source, structure, frameCount: msg.frameCount as number })
      }
    }
    worker.addEventListener('message', onMessage)
    worker.postMessage({ kind: 'init', file })
  })
}
