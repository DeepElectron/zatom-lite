import { assertTrue, assertEqual } from '../testing/assert'
import { makeRng } from '../lib/polycrystal/rng'
import { placeSeeds, SeedGrid, nearestSeedBruteForce } from '../lib/polycrystal/seeds'

function testCountAndInBox() {
  const seeds = placeSeeds(20, 30, 0, makeRng(1))
  assertEqual(seeds.length, 20, 'count matches')
  for (const s of seeds) for (const c of s) assertTrue(c >= 0 && c <= 30, 'seed inside box')
}

function testMinDistanceRespected() {
  const minD = 4
  const seeds = placeSeeds(15, 30, minD, makeRng(2))
  for (let i = 0; i < seeds.length; i++)
    for (let j = i + 1; j < seeds.length; j++) {
      const dx = seeds[i][0] - seeds[j][0], dy = seeds[i][1] - seeds[j][1], dz = seeds[i][2] - seeds[j][2]
      assertTrue(Math.sqrt(dx * dx + dy * dy + dz * dz) >= minD - 1e-9, 'respects min distance')
    }
}

function testGridMatchesBruteForce() {
  const seeds = placeSeeds(40, 50, 0, makeRng(3))
  const grid = new SeedGrid(seeds, 50)
  const rng = makeRng(123)
  for (let t = 0; t < 500; t++) {
    const p: [number, number, number] = [rng() * 50, rng() * 50, rng() * 50]
    assertEqual(grid.nearest(p), nearestSeedBruteForce(p, seeds), 'grid == brute force')
  }
}

function testImpossibleMinimumDistanceFailsClosed() {
  let failed = false
  try {
    placeSeeds(2, 1, 2, makeRng(9))
  } catch (error) {
    failed = error instanceof Error && error.message.includes('Could not place seed')
  }
  assertTrue(failed, 'infeasible seed separation must fail rather than fall back')
}

function run() {
  testCountAndInBox()
  testMinDistanceRespected()
  testGridMatchesBruteForce()
  testImpossibleMinimumDistanceFailsClosed()
  console.log('polycrystal seeds tests passed')
}

run()
