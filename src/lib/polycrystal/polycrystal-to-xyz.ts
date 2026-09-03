import type { PolycrystalResult } from './types'

/** Serialize to extended-XYZ (orthorhombic box from bbox). grain_id as an extra column. */
export function polycrystalToXYZ(r: PolycrystalResult): string {
  const lx = (r.bbox.max[0] - r.bbox.min[0]) || 1
  const ly = (r.bbox.max[1] - r.bbox.min[1]) || 1
  const lz = (r.bbox.max[2] - r.bbox.min[2]) || 1
  const lattice = `${lx} 0 0 0 ${ly} 0 0 0 ${lz}`
  const lines: string[] = []
  lines.push(String(r.count))
  lines.push(`Lattice="${lattice}" Properties=species:S:1:pos:R:3:grain_id:I:1`)
  for (let i = 0; i < r.count; i++) {
    const sym = r.elements[r.elementIndex[i]]
    lines.push(
      `${sym} ${r.positions[i * 3].toFixed(5)} ${r.positions[i * 3 + 1].toFixed(5)} ${r.positions[i * 3 + 2].toFixed(5)} ${r.grainId[i]}`,
    )
  }
  return lines.join('\n')
}
