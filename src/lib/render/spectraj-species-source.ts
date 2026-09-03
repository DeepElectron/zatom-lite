import type { AsyncSpeciesSource } from './frame-source'

/** Expand a packbits (MSB-first) row → per-atom species index {0,1}. out length = atomCount. */
export function unpackSpeciesRow(packed: Uint8Array, atomCount: number, out: Uint8Array): void {
  for (let i = 0; i < atomCount; i++) {
    const byte = packed[i >> 3]
    out[i] = (byte >> (7 - (i & 7))) & 1
  }
}

const WINDOW = 96         // decoded packed rows kept around the playhead
const PREFETCH_AHEAD = 24 // lookahead fired on every hit

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream: typeof DecompressionStream }).DecompressionStream
  const stream = new Blob([buf]).stream().pipeThrough(new DS('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * Sliding-window LRU cache of decoded packed mask rows over a .spectraj mask blob —
 * the species analogue of ExtxyzWindowSource. The blob is never fully resident: each
 * frame's row is sliced + (optionally) gunzipped on demand and evicted by LRU, so RAM
 * is bounded by the window regardless of frameCount.
 */
export class SpectrajWindowSource implements AsyncSpeciesSource {
  readonly frameCount: number
  readonly atomCount: number
  private cache = new Map<number, Uint8Array>() // packed rows; insertion order ≈ LRU
  private inflight = new Map<number, Promise<void>>()
  private disposed = false
  private rowBytes: number
  private maskBlob: Blob
  private offsets: number[]
  private codec: 'gzip-rows' | 'raw'

  /** `offsets` length = frameCount+1, byte offsets into `maskBlob`. */
  constructor(maskBlob: Blob, offsets: number[], atomCount: number, codec: 'gzip-rows' | 'raw') {
    this.maskBlob = maskBlob
    this.offsets = offsets
    this.atomCount = atomCount
    this.codec = codec
    this.frameCount = offsets.length - 1
    this.rowBytes = Math.ceil(atomCount / 8)
  }

  tryGetSpecies(i: number, out: Uint8Array): boolean {
    const packed = this.cache.get(i)
    if (!packed) { void this.prefetch(i); return false }
    unpackSpeciesRow(packed, this.atomCount, out)
    this.touch(i)
    for (let k = i + 1; k <= Math.min(i + PREFETCH_AHEAD, this.frameCount - 1); k++) void this.prefetch(k)
    return true
  }

  prefetch(i: number): Promise<void> {
    if (i < 0 || i >= this.frameCount || this.disposed) return Promise.resolve()
    if (this.cache.has(i)) return Promise.resolve()
    const pending = this.inflight.get(i)
    if (pending) return pending
    const p = this.decode(i)
      .then((row) => { if (!this.disposed) { this.cache.set(i, row); this.evict(i) } })
      .finally(() => { this.inflight.delete(i) })
    this.inflight.set(i, p)
    return p
  }

  dispose() { this.disposed = true; this.cache.clear(); this.inflight.clear() }

  private async decode(i: number): Promise<Uint8Array> {
    const buf = await this.maskBlob.slice(this.offsets[i], this.offsets[i + 1]).arrayBuffer()
    if (this.codec === 'raw') return new Uint8Array(buf)
    const row = await gunzip(buf)
    return row.length === this.rowBytes ? row : row.slice(0, this.rowBytes)
  }

  /** re-insert to mark as recently used (Map preserves insertion order) */
  private touch(i: number) {
    const f = this.cache.get(i)
    if (f) { this.cache.delete(i); this.cache.set(i, f) }
  }

  private evict(current: number) {
    while (this.cache.size > WINDOW) {
      const oldest = this.cache.keys().next().value as number
      if (oldest >= current && oldest <= current + PREFETCH_AHEAD && this.cache.size <= WINDOW + PREFETCH_AHEAD) break
      this.cache.delete(oldest)
    }
  }
}
