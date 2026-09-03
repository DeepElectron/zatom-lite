import type { CompactStructure } from './compact-structure'
import { SpectrajWindowSource } from './spectraj-species-source'
import type { AsyncSpeciesSource } from './frame-source'

/**
 * .spectraj — a streaming per-frame *species* trajectory. Positions are stored once;
 * each frame is a packbits 1-bit-per-atom species mask, sliced + decoded on demand by
 * SpectrajWindowSource so RAM stays bounded regardless of frameCount.
 *
 * Layout (little-endian except the big-endian magic):
 *   [0:4]  magic "SPCT"
 *   [4:8]  uint32 headerLen
 *   [8:H]  header JSON (see SpectrajHeader)
 *   [H:..] Float32 positions (positionsBytes)
 *   [..]   Uint32 frameOffsets[frameCount+1] (byte offsets into the mask blob)
 *   [..]   mask blob: per-frame packed rows (gzip-rows each gzipped, or raw)
 */

const MAGIC = 0x53504354 // "SPCT" (big-endian)

export interface SpectrajHeader {
  version: number
  count: number
  frameCount: number
  elements: string[]
  palette?: number[][]
  trajFps: number
  a: number
  d: number
  W: number
  H: number
  layers: number
  rowBytes: number
  codec: 'gzip-rows' | 'raw'
  positionsBytes: number
  offsetTableBytes: number
  /** per-atom thermal vibration amplitude (Å) applied procedurally at render time; 0 = static. */
  amplitude?: number
}

export interface SpectrajTrajectory {
  structure: CompactStructure
  source: AsyncSpeciesSource
  frameCount: number
  trajFps: number
  amplitude: number
}

export async function parseSpectrajHeader(file: Blob): Promise<{ header: SpectrajHeader; bodyStart: number }> {
  const head = new DataView(await file.slice(0, 8).arrayBuffer())
  if (head.getUint32(0, false) !== MAGIC) throw new Error('not a .spectraj file (bad magic)')
  const headerLen = head.getUint32(4, true)
  const headerText = await file.slice(8, 8 + headerLen).text()
  return { header: JSON.parse(headerText) as SpectrajHeader, bodyStart: 8 + headerLen }
}

export async function createSpectrajSource(file: Blob): Promise<SpectrajTrajectory> {
  const { header: h, bodyStart } = await parseSpectrajHeader(file)
  const posStart = bodyStart
  const offStart = posStart + h.positionsBytes
  const maskStart = offStart + h.offsetTableBytes

  const positions = new Float32Array(await file.slice(posStart, offStart).arrayBuffer())
  const offsets = Array.from(new Uint32Array(await file.slice(offStart, maskStart).arrayBuffer()))
  const palette = h.palette ? Float32Array.from(h.palette.flat()) : undefined

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < h.count; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
  }

  // mask blob is the tail; offsets are relative to it.
  const source = new SpectrajWindowSource(file.slice(maskStart), offsets, h.count, h.codec)
  // frame 0 species → initial elementIndex so the static frame already shows the image.
  await source.prefetch(0)
  const elementIndex = new Uint8Array(h.count)
  source.tryGetSpecies(0, elementIndex)

  const structure: CompactStructure = {
    positions, elementIndex, elements: h.elements, count: h.count,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    palette,
  }
  // warm a couple more frames so playback starts smoothly.
  await Promise.all([source.prefetch(1), source.prefetch(2)])
  return { structure, source, frameCount: h.frameCount, trajFps: h.trajFps, amplitude: h.amplitude ?? 0 }
}
