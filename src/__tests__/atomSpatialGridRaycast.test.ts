import { assertEqual, assertTrue } from '../testing/assert'
import { AtomSpatialGrid } from '../lib/render/atom-spatial-grid'

type Vec3 = [number, number, number]

/** Deterministic PRNG (mulberry32) so an oracle mismatch is reproducible, not flaky. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomCloud(n: number, extent: number, seed: number): { positions: Float32Array; box: number } {
  const r = rng(seed)
  const positions = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) positions[i] = (r() - 0.5) * extent
  return { positions, box: extent }
}

/** The gridded ray pick must return the byte-identical atom index as the brute oracle
 *  for the same inputs — over random clouds and many random queries. */
function oracleEquivalenceTests() {
  const { positions, box } = randomCloud(2000, 100, 12345)
  const grid = new AtomSpatialGrid(positions, box)
  const r = rng(999)
  let checked = 0
  for (let q = 0; q < 400; q++) {
    const origin: Vec3 = [(r() - 0.5) * 140, (r() - 0.5) * 140, (r() - 0.5) * 140]
    // unnormalized direction on purpose (length != 1)
    const dir: Vec3 = [(r() - 0.5) * 8, (r() - 0.5) * 8, (r() - 0.5) * 8]
    const pickRadius = 0.5 + r() * 6 // spans below and above the ~3.7 Å fine cell
    const brute = grid.raycastNearest(origin, dir, pickRadius)
    const gridded = grid.raycastNearestGridded(origin, dir, pickRadius)
    assertEqual(gridded, brute, `query ${q}: gridded ${gridded} != brute ${brute}`)
    checked++
  }
  assertTrue(checked === 400, 'all queries compared')
}

/** Equal-t tie: two atoms equidistant along the ray must both resolve to the LOWEST index. */
function tieBreakTests() {
  // atoms 0 and 1 at the same t (x=10), symmetric off-axis; atom 2 farther.
  const positions = Float32Array.from([10, 1, 0, 10, -1, 0, 30, 0, 0])
  const grid = new AtomSpatialGrid(positions, 60)
  const origin: Vec3 = [0, 0, 0]
  const dir: Vec3 = [1, 0, 0]
  const brute = grid.raycastNearest(origin, dir, 2)
  const gridded = grid.raycastNearestGridded(origin, dir, 2)
  assertEqual(brute, 0, 'brute tie → lowest index 0')
  assertEqual(gridded, 0, 'gridded tie → lowest index 0')
}

/** Direction edge cases must agree with brute exactly. */
function directionEdgeTests() {
  const { positions, box } = randomCloud(500, 80, 42)
  const grid = new AtomSpatialGrid(positions, box)
  // zero direction → defined brute behavior (all t=0); gridded must delegate identically
  assertEqual(grid.raycastNearestGridded([0, 0, 0], [0, 0, 0], 5), grid.raycastNearest([0, 0, 0], [0, 0, 0], 5), 'zero dir')
  // ray pointing away from the cloud center from far outside → both miss (-1) or agree
  assertEqual(grid.raycastNearestGridded([200, 200, 200], [1, 1, 1], 1), grid.raycastNearest([200, 200, 200], [1, 1, 1], 1), 'ray away from cloud')
  // origin deep inside the cloud
  assertEqual(grid.raycastNearestGridded([0, 0, 0], [0.3, 1, 0.1], 4), grid.raycastNearest([0, 0, 0], [0.3, 1, 0.1], 4), 'origin inside')
  // pickRadius far larger than the fine cell
  assertEqual(grid.raycastNearestGridded([-60, 0, 0], [1, 0, 0], 40), grid.raycastNearest([-60, 0, 0], [1, 0, 0], 40), 'large pickRadius')
}

/** Empty grid never throws and returns -1. */
function emptyGridTests() {
  const grid = new AtomSpatialGrid(new Float32Array(0), 10)
  assertEqual(grid.raycastNearestGridded([0, 0, 0], [1, 0, 0], 5), -1, 'empty grid → -1')
}

/** Non-finite / huge pickRadius must agree with brute AND terminate (no Infinity-span hang). */
function pathologicalRadiusTests() {
  const { positions, box } = randomCloud(800, 90, 7)
  const grid = new AtomSpatialGrid(positions, box)
  const origin: Vec3 = [-80, 0, 0]
  const dir: Vec3 = [1, 0.05, -0.02]
  // Infinity span would make maxSteps/tEnd Infinity and the DDA loop never terminate.
  assertEqual(grid.raycastNearestGridded(origin, dir, Infinity), grid.raycastNearest(origin, dir, Infinity), 'Infinity pickRadius == brute')
  // NaN pickRadius: both reject everything (pr² is NaN) → -1.
  assertEqual(grid.raycastNearestGridded(origin, dir, NaN), grid.raycastNearest(origin, dir, NaN), 'NaN pickRadius == brute')
  // Huge but finite span (band engulfs the whole grid) must still equal brute and not blow up.
  assertEqual(grid.raycastNearestGridded(origin, dir, 1e6), grid.raycastNearest(origin, dir, 1e6), 'huge finite pickRadius == brute')
}

function run() {
  oracleEquivalenceTests()
  tieBreakTests()
  directionEdgeTests()
  emptyGridTests()
  pathologicalRadiusTests()
  console.log('atom-spatial-grid raycast tests passed')
}

run()
