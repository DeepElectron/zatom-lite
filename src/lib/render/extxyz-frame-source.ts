import type { CompactStructure } from './compact-structure'
import type { AsyncFrameSource } from './frame-source'

/**
 * Streaming multi-frame extended-XYZ source (B2 v2): the file is never fully
 * resident. One chunked pass builds a byte index of frame offsets (~16B/frame);
 * playback decodes only a sliding window of frames around the playhead
 * (Blob.slice → text → Float32Array), with lookahead prefetch and LRU eviction.
 * A backend-artifact source later swaps Blob.slice for HTTP Range requests.
 */

const CHUNK = 8 * 1024 * 1024 // index-scan chunk (bytes)
const NL = 0x0a

export interface ExtxyzFrameIndex {
  /** byte offset of each frame's count line */
  offsets: number[]
  /** byte end (exclusive) of each frame */
  ends: number[]
  atomCount: number
}

/**
 * Chunked newline scan + state machine (count line → comment → N atom lines).
 * Validates a uniform atom count across frames.
 */
export async function indexExtxyzFrames(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<ExtxyzFrameIndex> {
  const decoder = new TextDecoder()
  const offsets: number[] = []
  let atomCount = -1
  // state: 0 = expecting count line, 1 = expecting comment, 2 = expecting atom lines
  let state = 0
  let atomsRemaining = 0
  let lineStart = 0 // absolute byte offset of the current line's first byte
  let countLineBytes: number[] = [] // accumulated bytes of a (possibly chunk-split) count line

  for (let base = 0; base < file.size; base += CHUNK) {
    const buf = new Uint8Array(await file.slice(base, Math.min(base + CHUNK, file.size)).arrayBuffer())
    for (let k = 0; k < buf.length; k++) {
      const byte = buf[k]
      if (byte !== NL) {
        if (state === 0) countLineBytes.push(byte)
        continue
      }
      const abs = base + k
      if (state === 0) {
        const text = decoder.decode(new Uint8Array(countLineBytes)).trim()
        countLineBytes = []
        if (text.length === 0) { lineStart = abs + 1; continue } // tolerate blank separators
        const n = parseInt(text, 10)
        if (!Number.isFinite(n) || n <= 0) throw new Error(`frame ${offsets.length}: expected atom count, got "${text.slice(0, 30)}"`)
        if (atomCount === -1) atomCount = n
        else if (n !== atomCount) throw new Error(`frame ${offsets.length}: atom count ${n} ≠ ${atomCount} (variable counts unsupported)`)
        offsets.push(lineStart)
        state = 1
      } else if (state === 1) {
        state = 2
        atomsRemaining = atomCount
      } else {
        atomsRemaining--
        if (atomsRemaining === 0) state = 0
      }
      lineStart = abs + 1
    }
    onProgress?.(Math.min(1, (base + CHUNK) / file.size))
  }
  // file may end without a trailing newline on the last atom line — that's fine,
  // the frame's byte end is the file size either way.
  if (offsets.length === 0 || atomCount <= 0) throw new Error('no extXYZ frames found')
  const ends = offsets.slice(1).concat([file.size])
  return { offsets, ends, atomCount }
}

/** Parse one frame's text → positions (xyz triplets) into `out`. */
export function parseFramePositions(text: string, atomCount: number, out: Float32Array): void {
  const lines = text.split('\n')
  if (lines.length < atomCount + 2) throw new Error(`frame text truncated: ${lines.length} lines < ${atomCount + 2}`)
  for (let i = 0; i < atomCount; i++) {
    const parts = lines[i + 2].trim().split(/\s+/)
    out[i * 3] = parseFloat(parts[1])
    out[i * 3 + 1] = parseFloat(parts[2])
    out[i * 3 + 2] = parseFloat(parts[3])
  }
}

/** Frame 0 → CompactStructure (species table + bbox; no grainId — region solids
 *  fall back to layer detection). */
export function buildStructureFromFrame(text: string, atomCount: number): CompactStructure {
  const lines = text.split('\n')
  if (lines.length < atomCount + 2) throw new Error('frame 0 truncated')
  const positions = new Float32Array(atomCount * 3)
  const elementIndex = new Uint8Array(atomCount)
  const elements: string[] = []
  const elemIdx = new Map<string, number>()
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < atomCount; i++) {
    const parts = lines[i + 2].trim().split(/\s+/)
    const el = parts[0]
    let ei = elemIdx.get(el)
    if (ei === undefined) { ei = elements.length; elements.push(el); elemIdx.set(el, ei) }
    if (ei > 255) throw new Error('more than 256 element species unsupported')
    elementIndex[i] = ei
    const x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3])
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
  }
  return {
    positions, elementIndex, elements, count: atomCount,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  }
}

const WINDOW = 96         // decoded frames kept around the playhead
const PREFETCH_AHEAD = 24 // lookahead fired on every hit

/** Sliding-window decoded-frame cache over an indexed extXYZ blob. */
export class ExtxyzWindowSource implements AsyncFrameSource {
  readonly frameCount: number
  readonly atomCount: number
  private cache = new Map<number, Float32Array>() // insertion order ≈ LRU via touch()
  private inflight = new Map<number, Promise<void>>()
  private disposed = false
  private file: Blob
  private index: ExtxyzFrameIndex

  constructor(file: Blob, index: ExtxyzFrameIndex) {
    this.file = file
    this.index = index
    this.frameCount = index.offsets.length
    this.atomCount = index.atomCount
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
    if (pending) return pending
    const p = this.decode(i)
      .then((data) => {
        if (this.disposed) return
        this.cache.set(i, data)
        this.evict(i)
      })
      .finally(() => { this.inflight.delete(i) })
    this.inflight.set(i, p)
    return p
  }

  dispose() {
    this.disposed = true
    this.cache.clear()
    this.inflight.clear()
  }

  private async decode(i: number): Promise<Float32Array> {
    const text = await this.file.slice(this.index.offsets[i], this.index.ends[i]).text()
    const out = new Float32Array(this.atomCount * 3)
    parseFramePositions(text, this.atomCount, out)
    return out
  }

  private prefetchAhead(i: number) {
    for (let k = i + 1; k <= Math.min(i + PREFETCH_AHEAD, this.frameCount - 1); k++) void this.prefetch(k)
  }

  /** re-insert to mark as recently used (Map preserves insertion order) */
  private touch(i: number) {
    const f = this.cache.get(i)
    if (f) { this.cache.delete(i); this.cache.set(i, f) }
  }

  private evict(current: number) {
    while (this.cache.size > WINDOW) {
      // evict the least-recently-used entry that isn't immediately ahead of the playhead
      const oldest = this.cache.keys().next().value as number
      if (oldest >= current && oldest <= current + PREFETCH_AHEAD && this.cache.size <= WINDOW + PREFETCH_AHEAD) break
      this.cache.delete(oldest)
    }
  }
}

export interface ExtxyzTrajectory {
  source: AsyncFrameSource
  structure: CompactStructure
  frameCount: number
}

export interface ExtxyzTrajectory {
  source: AsyncFrameSource
  structure: CompactStructure
  frameCount: number
}

/** Index a multi-frame extXYZ blob and prepare it for compact playback. */
export async function createExtxyzFileSource(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<ExtxyzTrajectory> {
  const index = await indexExtxyzFrames(file, onProgress)
  if (index.offsets.length < 2) throw new Error('trajectory needs at least 2 frames')
  const frame0Text = await file.slice(index.offsets[0], index.ends[0]).text()
  const structure = buildStructureFromFrame(frame0Text, index.atomCount)
  const source = new ExtxyzWindowSource(file, index)
  // warm the window so playback starts immediately
  await Promise.all([source.prefetch(0), source.prefetch(1), source.prefetch(2)])
  return { source, structure, frameCount: index.offsets.length }
}
