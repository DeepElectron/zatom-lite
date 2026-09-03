export type { CompactStructure } from './compact-structure'
import type { CompactStructure } from './compact-structure'

/** Encode index+1 into 3 RGB bytes (24-bit, reserve 0 = background/miss). */
export function encodeId(index: number): [number, number, number] {
  const v = index + 1
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff]
}

/** Decode RGB bytes back to an index, or -1 for the background (0). */
export function decodeId(r: number, g: number, b: number): number {
  const v = r + g * 256 + b * 65536
  return v === 0 ? -1 : v - 1
}

/** Uint8 per-instance flag (1=selected) for the impostor highlight attribute. */
export function buildSelectedFlags(count: number, selected: Set<number>): Uint8Array {
  const out = new Uint8Array(count)
  for (const i of selected) if (i >= 0 && i < count) out[i] = 1
  return out
}

/** New CompactStructure with the selected indices removed (typed arrays compacted, bbox recomputed). */
export function deleteIndices(c: CompactStructure, selected: Set<number>): CompactStructure {
  const keep = c.count - [...selected].filter((i) => i >= 0 && i < c.count).length
  const positions = new Float32Array(keep * 3)
  const elementIndex = new Uint8Array(keep)
  const grainId = c.grainId ? new Uint32Array(keep) : undefined
  let w = 0
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < c.count; i++) {
    if (selected.has(i)) continue
    const x = c.positions[i * 3], y = c.positions[i * 3 + 1], z = c.positions[i * 3 + 2]
    positions[w * 3] = x; positions[w * 3 + 1] = y; positions[w * 3 + 2] = z
    elementIndex[w] = c.elementIndex[i]
    if (grainId && c.grainId) grainId[w] = c.grainId[i]
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
    w++
  }
  if (keep === 0) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0 }
  return {
    positions, elementIndex, elements: c.elements, grainId, count: keep,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  }
}

/** Extended-XYZ of just the selected atoms. */
export function selectedToXYZ(c: CompactStructure, selected: Set<number>): string {
  const idx = [...selected].filter((i) => i >= 0 && i < c.count)
  const lx = (c.bbox.max[0] - c.bbox.min[0]) || 1, ly = (c.bbox.max[1] - c.bbox.min[1]) || 1, lz = (c.bbox.max[2] - c.bbox.min[2]) || 1
  const lines: string[] = [String(idx.length), `Lattice="${lx} 0 0 0 ${ly} 0 0 0 ${lz}" Properties=species:S:1:pos:R:3`]
  for (const i of idx) {
    lines.push(`${c.elements[c.elementIndex[i]]} ${c.positions[i * 3].toFixed(5)} ${c.positions[i * 3 + 1].toFixed(5)} ${c.positions[i * 3 + 2].toFixed(5)}`)
  }
  return lines.join('\n')
}

/** Centroid + max distance from centroid over the selected atoms. */
export function selectionCentroidSpread(c: CompactStructure, selected: Set<number>): { center: [number, number, number]; spread: number } {
  const idx = [...selected].filter((i) => i >= 0 && i < c.count)
  if (idx.length === 0) return { center: [0, 0, 0], spread: 1 }
  let cx = 0, cy = 0, cz = 0
  for (const i of idx) { cx += c.positions[i * 3]; cy += c.positions[i * 3 + 1]; cz += c.positions[i * 3 + 2] }
  cx /= idx.length; cy /= idx.length; cz /= idx.length
  let spread = 0
  for (const i of idx) {
    const dx = c.positions[i * 3] - cx, dy = c.positions[i * 3 + 1] - cy, dz = c.positions[i * 3 + 2] - cz
    spread = Math.max(spread, Math.sqrt(dx * dx + dy * dy + dz * dz))
  }
  return { center: [cx, cy, cz], spread: Math.max(spread, 1) }
}
