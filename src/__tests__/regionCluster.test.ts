import { assertEqual, assertTrue } from '../testing/assert'
import { estimateNeighborCutoff, buildNeighborPairs, clusterFromPairs } from '../lib/render/region-cluster'

/** Build positions for a W×H grid (spacing 1, z=0), row-major. */
function grid(W: number, H: number): Float32Array {
  const p = new Float32Array(W * H * 3)
  let k = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { p[k * 3] = x; p[k * 3 + 1] = y; k++ }
  return p
}

function testEstimateCutoff() {
  const p = grid(5, 5)
  const c = estimateNeighborCutoff(p, 25)
  // median NN distance = 1.0 → cutoff = 1.35
  assertTrue(Math.abs(c - 1.35) < 1e-6, `cutoff ${c} ≈ 1.35`)
}

function testPairsNoDiagonals() {
  const p = grid(2, 2)
  const pairs = buildNeighborPairs(p, 4, 1.1)
  // 4-connectivity edges of a 2×2: 4 pairs; diagonal (√2) excluded
  assertEqual(pairs.length, 8, `pair count ${pairs.length / 2} = 4`)
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i], b = pairs[i + 1]
    const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1]
    assertTrue(Math.abs(dx) + Math.abs(dy) === 1, 'only unit-distance pairs')
  }
}

function testCheckerboardAllNoise() {
  const W = 4, H = 4
  const p = grid(W, H)
  const labels = new Uint8Array(16)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) labels[y * W + x] = (x + y) % 2
  const pairs = buildNeighborPairs(p, 16, 1.1)
  // checkerboard: no equal-label 4-neighbors → all singletons; minSize=2 filters all
  const r = clusterFromPairs(pairs, labels, 16, 2)
  assertEqual(r.regionIds.length, 0, 'all filtered')
  for (let i = 0; i < 16; i++) assertEqual(r.regionOf[i], -1, `atom ${i} noise`)
}

function testStripesTwoClusters() {
  const W = 4, H = 4
  const p = grid(W, H)
  const labels = new Uint8Array(16)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) labels[y * W + x] = x < 2 ? 0 : 1
  const pairs = buildNeighborPairs(p, 16, 1.1)
  const r = clusterFromPairs(pairs, labels, 16, 2)
  assertEqual(r.regionIds.length, 2, 'two stripe clusters')
  assertEqual(r.regionLabel.length, 2, 'labels recorded')
  // each region's label matches its atoms' label
  for (let i = 0; i < 16; i++) {
    const reg = r.regionOf[i]
    assertTrue(reg === 0 || reg === 1, 'assigned')
    assertEqual(r.regionLabel[reg], labels[i], `atom ${i} label matches region label`)
  }
  // atoms in the same column half share a region
  assertEqual(r.regionOf[0], r.regionOf[5], 'left stripe connected')
  assertEqual(r.regionOf[2], r.regionOf[7], 'right stripe connected')
  assertTrue(r.regionOf[0] !== r.regionOf[2], 'stripes distinct')
}

function testMinSizeFilter() {
  // 1 isolated odd-label atom in a sea of label 0
  const W = 3, H = 3
  const p = grid(W, H)
  const labels = new Uint8Array(9) // all 0
  labels[4] = 1 // center atom different
  const pairs = buildNeighborPairs(p, 9, 1.1)
  const r = clusterFromPairs(pairs, labels, 9, 2)
  assertEqual(r.regionOf[4], -1, 'isolated atom filtered as noise')
  assertTrue(r.regionOf[0] >= 0, 'majority cluster kept')
}

function run() {
  testEstimateCutoff()
  testPairsNoDiagonals()
  testCheckerboardAllNoise()
  testStripesTwoClusters()
  testMinSizeFilter()
  console.log('region-cluster tests passed')
}

run()
