import { describe, expect, it } from 'vitest'
import { createCrystalStore } from '../orchestration/crystalStore'

/**
 * Verify physical site positions through the real store path.
 *
 * A three-layer Cu slab with high vacuum guards against markers drifting to the vacuum ceiling or
 * below the slab instead of sitting on the top surface.
 */

const D = 2.556 // FCC(100) in-plane nearest-neighbor distance.
const LAYER_DZ = 1.8
const Z0 = 8

const rows: string[] = []
for (let L = 0; L < 3; L++) {
  const z = Z0 + L * LAYER_DZ
  // Offset alternating layers by half a grid spacing to model FCC stacking.
  const off = L % 2 === 1 ? D / 2 : 0
  for (const [x, y] of [
    [0, 0],
    [D, 0],
    [0, D],
    [D, D],
  ]) {
    rows.push(`Cu ${(x + off).toFixed(4)} ${(y + off).toFixed(4)} ${z.toFixed(4)}`)
  }
}

const SLAB_XYZ = [
  String(rows.length),
  `Lattice="${(D * 2).toFixed(4)} 0.0 0.0 0.0 ${(D * 2).toFixed(4)} 0.0 0.0 0.0 25.0" Properties=species:S:1:pos:R:3`,
  ...rows,
  '',
].join('\n')

describe('store 路径下位点的物理位置', () => {
  it('位点贴在顶面之上，不飘到真空顶部也不钻到 slab 底下', async () => {
    const store = createCrystalStore()
    const s = () => store.getState()

    await s().loadFromXYZ(SLAB_XYZ)
    expect(s().atoms.length).toBe(rows.length)

    s().detectAdsorbateSites()
    const sites = s().detectedSites
    expect(sites.length).toBeGreaterThan(0)

    const zs = s().atoms.map((a) => a.cartesian![2])
    const topZ = Math.max(...zs)
    const botZ = Math.min(...zs)
    const cellZ = s().latticeVectors!.c[2]

    for (const site of sites) {
      const z = site.position[2]
      // Sites must lie one adsorption height above the top layer.
      expect(z).toBeGreaterThan(topZ + 0.3)
      expect(z).toBeLessThan(topZ + 3.0)
      // Exclude both observed failure modes explicitly.
      expect(z).toBeLessThan(cellZ - 1) // Not at the vacuum ceiling.
      expect(z).toBeGreaterThan(botZ) // Not below the slab.
    }

    // Sites must span two in-plane dimensions rather than collapse onto one line.
    const xs = new Set(sites.map((p) => Math.round(p.position[0] * 10) / 10))
    const ys = new Set(sites.map((p) => Math.round(p.position[1] * 10) / 10))
    expect(xs.size).toBeGreaterThan(1)
    expect(ys.size).toBeGreaterThan(1)
  })

  it('位点不与任何表面原子重叠', async () => {
    const store = createCrystalStore()
    const s = () => store.getState()
    await s().loadFromXYZ(SLAB_XYZ)
    s().detectAdsorbateSites()

    const atoms = s().atoms.map((a) => a.cartesian!)
    for (const site of s().detectedSites) {
      let best = Infinity
      for (const a of atoms) {
        const d = Math.hypot(
          site.position[0] - a[0],
          site.position[1] - a[1],
          site.position[2] - a[2],
        )
        if (d < best) best = d
      }
      expect(best).toBeGreaterThan(1.2)
    }
  })
})
