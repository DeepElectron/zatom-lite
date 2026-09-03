import { assertTrue, assertEqual } from '../testing/assert'
import { makeRng } from '../lib/polycrystal/rng'
import { placeSeeds, SeedGrid, nearestSeedBruteForce } from '../lib/polycrystal/seeds'
import { randomRotationMatrix } from '../lib/polycrystal/orientation'
import { fillGrains } from '../lib/polycrystal/voronoi-fill'
import type { BaseCell, Grain } from '../lib/polycrystal/types'

// simple cubic, lattice param 3.0, single atom basis
const BASE: BaseCell = {
  latticeVectors: { a: [3, 0, 0], b: [0, 3, 0], c: [0, 0, 3] },
  basis: [{ element: 'Cu', frac: [0, 0, 0] }],
}

function buildGrains(boxSize: number, n: number, seed: number): { grains: Grain[]; grid: SeedGrid } {
  const rng = makeRng(seed)
  const seeds = placeSeeds(n, boxSize, 0, rng)
  const grains: Grain[] = seeds.map((s) => ({ seed: s, rotation: randomRotationMatrix(rng) }))
  return { grains, grid: new SeedGrid(seeds, boxSize) }
}

function testEveryAtomBelongsToNearestSeed() {
  const boxSize = 24
  const { grains, grid } = buildGrains(boxSize, 6, 11)
  const seeds = grains.map((g) => g.seed)
  const out = fillGrains(BASE, grains, boxSize, grid, 100_000)
  assertTrue(out.count > 0, 'produced atoms')
  for (let i = 0; i < out.count; i++) {
    const p: [number, number, number] = [out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]]
    assertEqual(out.grainId[i], nearestSeedBruteForce(p, seeds), `atom ${i} grain == nearest seed`)
    for (const c of p) assertTrue(c >= -1e-6 && c <= boxSize + 1e-6, 'atom inside box')
  }
}

function testDensityRoughlyMatchesVolume() {
  const boxSize = 30
  const { grains, grid } = buildGrains(boxSize, 4, 5)
  const out = fillGrains(BASE, grains, boxSize, grid, 100_000)
  // simple cubic a=3 → 1 atom per 27 Å³. Expected ≈ V/27.
  const expected = (boxSize ** 3) / 27
  assertTrue(out.count > expected * 0.6 && out.count < expected * 1.4, `count ${out.count} near expected ${expected | 0}`)
}

function run() {
  testEveryAtomBelongsToNearestSeed()
  testDensityRoughlyMatchesVolume()
  console.log('polycrystal voronoi-fill tests passed')
}

run()
