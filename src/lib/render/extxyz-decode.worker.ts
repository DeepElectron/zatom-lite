/// <reference lib="webworker" />
/**
 * Trajectory decode worker: indexes a multi-frame extXYZ blob and decodes
 * requested frames off the main thread (byte-level parser, transferred
 * Float32Arrays). The main thread never parses frame text — that's what keeps
 * 650k-atom playback smooth.
 *
 * Protocol:
 *   → { kind: 'init', file: Blob }
 *   ← { kind: 'progress', fraction }
 *   ← { kind: 'ready', frameCount, atomCount, structure: {positions, elementIndex, elements, bbox} }
 *   → { kind: 'frame', i }
 *   ← { kind: 'frame', i, positions } (transferred)
 *   ← { kind: 'error', message }
 */
import { indexExtxyzFrames, buildStructureFromFrame, type ExtxyzFrameIndex } from './extxyz-frame-source'
import { parseFrameBytes } from './extxyz-bytes'

const scope = self as unknown as DedicatedWorkerGlobalScope

let file: Blob | null = null
let index: ExtxyzFrameIndex | null = null

scope.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.kind === 'init') void init(msg.file as Blob)
  else if (msg.kind === 'frame') void decode(msg.i as number)
}

async function init(f: Blob) {
  try {
    file = f
    let lastPct = -1
    index = await indexExtxyzFrames(f, (fraction) => {
      const pct = Math.round(fraction * 100)
      if (pct !== lastPct) { lastPct = pct; scope.postMessage({ kind: 'progress', fraction }) }
    })
    const frame0 = await f.slice(index.offsets[0], index.ends[0]).text()
    const s = buildStructureFromFrame(frame0, index.atomCount)
    scope.postMessage(
      {
        kind: 'ready',
        frameCount: index.offsets.length,
        atomCount: index.atomCount,
        structure: { positions: s.positions, elementIndex: s.elementIndex, elements: s.elements, bbox: s.bbox },
      },
      [s.positions.buffer, s.elementIndex.buffer],
    )
  } catch (err) {
    scope.postMessage({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

async function decode(i: number) {
  try {
    if (!file || !index) throw new Error('decode before init')
    const buf = await file.slice(index.offsets[i], index.ends[i]).arrayBuffer()
    const out = new Float32Array(index.atomCount * 3)
    parseFrameBytes(new Uint8Array(buf), index.atomCount, out)
    scope.postMessage({ kind: 'frame', i, positions: out }, [out.buffer])
  } catch (err) {
    scope.postMessage({ kind: 'error', message: `frame ${i}: ${err instanceof Error ? err.message : String(err)}` })
  }
}
