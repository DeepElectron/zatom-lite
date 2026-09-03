import { assertEqual, assertTrue } from '../testing/assert'
import { AtomSpatialGrid } from '../lib/render/atom-spatial-grid'
import { makeRng } from '../lib/polycrystal/rng'

function randomPositions(n: number, box: number, seed: number): Float32Array {
  const rng = makeRng(seed)
  const p = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) p[i] = rng() * box
  return p
}

function testNeighborhoodMatchesBrute() {
  const p = randomPositions(300, 40, 1)
  const grid = new AtomSpatialGrid(p, 40)
  const i = 42
  const r = 6
  const got = new Set(grid.neighborhood(i, r))
  const cx = p[i * 3], cy = p[i * 3 + 1], cz = p[i * 3 + 2]
  const expect = new Set<number>()
  for (let j = 0; j < 300; j++) {
    const dx = p[j * 3] - cx, dy = p[j * 3 + 1] - cy, dz = p[j * 3 + 2] - cz
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= r) expect.add(j)
  }
  assertEqual(got.size, expect.size, 'neighborhood size matches brute force')
  for (const e of expect) assertTrue(got.has(e), `neighborhood contains ${e}`)
}

function testRaycastNearestMatchesBrute() {
  const p = randomPositions(200, 40, 5)
  const grid = new AtomSpatialGrid(p, 40)
  const target = 17
  const tx = p[target * 3], ty = p[target * 3 + 1]
  const origin: [number, number, number] = [tx, ty, 200]
  const dir: [number, number, number] = [0, 0, -1]
  const hit = grid.raycastNearest(origin, dir, 1.0)
  assertTrue(hit !== -1, 'ray hits an atom')
  const hx = p[hit * 3], hy = p[hit * 3 + 1]
  assertTrue(Math.hypot(hx - tx, hy - ty) <= 1.0 + 1e-6, 'hit is near the ray line')
}

function run() {
  testNeighborhoodMatchesBrute()
  testRaycastNearestMatchesBrute()
  console.log('atom-spatial-grid tests passed')
}

run()
