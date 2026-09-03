import { assertEqual, assertTrue } from '../testing/assert'
import { AtomTileGrid, type FrustumPlane } from '../lib/render/atom-tile-grid'

const BBOX = { min: [0, 0, 0] as [number, number, number], max: [100, 100, 100] as [number, number, number] }
const EDGE = 25 // → nx=ny=nz=4

/** One atom at the center of every (i,j,k) tile; atom index == lexicographic position. */
function oneAtomPerTile(): Float32Array {
  const p: number[] = []
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        p.push((i + 0.5) * EDGE, (j + 0.5) * EDGE, (k + 0.5) * EDGE)
  return Float32Array.from(p)
}

/** Inward axis-aligned box frustum selecting [lo,hi]^3 (inside = n·p + c ≥ 0). */
function boxFrustum(lo: number, hi: number): FrustumPlane[] {
  return [
    { nx: 1, ny: 0, nz: 0, c: -lo }, { nx: -1, ny: 0, nz: 0, c: hi },
    { nx: 0, ny: 1, nz: 0, c: -lo }, { nx: 0, ny: -1, nz: 0, c: hi },
    { nx: 0, ny: 0, nz: 1, c: -lo }, { nx: 0, ny: 0, nz: -1, c: hi },
  ]
}

function frustumList(grid: AtomTileGrid, planes: FrustumPlane[]): number[] {
  return [...grid.frustumCandidates(planes)]
}

function tileAabbTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const a = grid.tileAabb(0, 0, 0)
  assertEqual(a.min[0], 0, 'tile(0,0,0) min x'); assertEqual(a.max[0], 25, 'tile(0,0,0) max x')
  const b = grid.tileAabb(3, 3, 3)
  assertEqual(b.min[0], 75, 'tile(3,3,3) min x'); assertEqual(b.max[0], 100, 'tile(3,3,3) max x')
}

/** An atom exactly at bbox.max lands in the boundary tile that CONTAINS it (unclamped) and stays selectable. */
function bboxMaxBoundaryTests() {
  const grid = new AtomTileGrid(Float32Array.from([100, 100, 100]), BBOX, EDGE)
  const got = frustumList(grid, boxFrustum(-1, 101))
  assertEqual(got.length, 1, 'boundary atom kept'); assertEqual(got[0], 0, 'boundary atom index')
}

/** Lazy generator yields non-empty tiles in lexicographic (i,j,k) order = ascending atom index. */
function lexicographicOrderTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const got = frustumList(grid, boxFrustum(-1, 101))
  assertEqual(got.length, 64, 'all 64 atoms')
  for (let n = 0; n < 64; n++) assertEqual(got[n], n, `lexicographic position ${n}`)
}

/** positive-vertex AABB cull: tiles overlapping [10,40]^3 are candidates; fully-outside tiles are not. */
function frustumInclusionTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const got = frustumList(grid, boxFrustum(10, 40))
  assertEqual(got.length, 8, '8 straddling/inside tiles') // i,j,k each in {0,1}
  for (const idx of got) {
    const i = (idx >> 4) & 3, j = (idx >> 2) & 3, k = idx & 3
    assertTrue(i <= 1 && j <= 1 && k <= 1, `atom ${idx} in an overlapping tile`)
  }
}

/** An oblique plane: tiles whose positive vertex is inside are kept; tiles fully on the far side dropped. */
function obliquePlaneTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const plane: FrustumPlane = { nx: 1, ny: 1, nz: 0, c: -150 } // x+y ≥ 150
  const got = frustumList(grid, [plane])
  for (const idx of got) {
    const i = (idx >> 4) & 3, j = (idx >> 2) & 3
    assertTrue(i + j >= 4, `kept tile i+j=${i + j} ≥ 4`) // positive vertex 25(i+1)+25(j+1) ≥ 150
  }
  assertTrue(!got.includes(0), 'tile(0,0,0) excluded by oblique plane')
}

/** Ray candidate collection: a ray along +x at a fixed (y,z) hits that tile column. */
function rayCandidateTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const res = grid.collectRayCandidates([-10, 12.5, 12.5], [1, 0, 0], 0, 1000)
  assertEqual(res.indices.length, 4, 'ray hits the 4-tile column')
  for (const idx of res.indices) { assertEqual((idx >> 2) & 3, 0, 'j=0'); assertEqual(idx & 3, 0, 'k=0') }
}

/** Ray candidate cap truncates to exactly maxAtoms. */
function rayCapTests() {
  const grid = new AtomTileGrid(oneAtomPerTile(), BBOX, EDGE)
  const res = grid.collectRayCandidates([-10, 12.5, 12.5], [1, 0, 0], 0, 2)
  assertEqual(res.indices.length, 2, 'capped to 2'); assertTrue(res.truncated, 'truncated flag')
}

/** Inward axis-aligned box frustum over an arbitrary range (not just a cube). */
function axisBox(lo: [number, number, number], hi: [number, number, number]): FrustumPlane[] {
  return [
    { nx: 1, ny: 0, nz: 0, c: -lo[0] }, { nx: -1, ny: 0, nz: 0, c: hi[0] },
    { nx: 0, ny: 1, nz: 0, c: -lo[1] }, { nx: 0, ny: -1, nz: 0, c: hi[1] },
    { nx: 0, ny: 0, nz: 1, c: -lo[2] }, { nx: 0, ny: 0, nz: -1, c: hi[2] },
  ]
}

/** Regression (#1): an atom outside the supplied bounding box must still be placed in a tile that
 *  contains it, not clamped into an edge tile whose
 *  AABB excludes it — else the frustum cull silently drops it. */
function outOfBboxAtomStillSelectableTests() {
  const positions = Float32Array.from([150, 50, 50]) // x=150 is well outside BBOX (max 100)
  const grid = new AtomTileGrid(positions, BBOX, EDGE)
  const got = [...grid.frustumCandidates(axisBox([140, 40, 40], [160, 60, 60]))] // a box around the TRUE location
  assertEqual(got.length, 1, 'an out-of-bbox atom is bucketed into a tile that contains it')
  assertEqual(got[0], 0, 'the out-of-bbox atom is selectable at its true location')
}

/** Regression (#2): tile-focus ray pick offers an atom within pickRadius of the ray even when its
 *  centre sits just across a tile face the ray centreline never enters. */
function rayPickRadiusBandTests() {
  // atom at y=26 (tile j=1); ray at y=24 (tile j=0). The centreline never enters tile j=1.
  const positions = Float32Array.from([50, 26, 12.5])
  const grid = new AtomTileGrid(positions, BBOX, EDGE)
  const noBand = grid.collectRayCandidates([-10, 24, 12.5], [1, 0, 0], 0, 1000)
  assertEqual(noBand.indices.length, 0, 'with no pickRadius band the straddling atom is missed')
  const withBand = grid.collectRayCandidates([-10, 24, 12.5], [1, 0, 0], 3, 1000) // |26−24|=2 < 3
  assertEqual(withBand.indices.length, 1, 'pickRadius band offers the atom across the tile face')
  assertEqual(withBand.indices[0], 0, 'the straddling atom is the offered candidate')
}

/**
 * Regression for the 2^53 packed-key collision: with a huge bbox the numeric key (i*ny+j)*nz+k
 * would collapse two distinct tiles to one JS number, mis-bucketing an atom. With string keys each
 * tile stays distinct, so a frustum selecting only one tile returns only that tile's atom.
 */
function keyCollisionDistinctTilesTests() {
  const E = 32
  const center = (t: number) => (t + 0.5) * E
  // A known colliding pair: keys (i*ny+j)*nz+k = 2^53 and 2^53+1 for ny=nz=208064.
  const A = [center(208063), center(102378), center(26752)] // tile k=26752
  const B = [center(208063), center(102378), center(26753)] // tile k=26753 (numeric key would collide with A)
  const positions = Float32Array.from([...A, ...B])
  const bbox = { min: [0, 0, 0] as [number, number, number], max: [6658048, 6658048, 6658048] as [number, number, number] }
  const grid = new AtomTileGrid(positions, bbox, E)
  // plane z ≥ 856097 keeps only tile B (z∈[856096,856128]); tile A max z = 856096 < 856097 → rejected.
  const onlyB = [...grid.frustumCandidates([{ nx: 0, ny: 0, nz: 1, c: -856097 }])]
  assertEqual(onlyB.length, 1, 'only tile B selected'); assertEqual(onlyB[0], 1, 'atom B (index 1)')
  // plane z ≤ 856095 keeps only tile A; tile B min z = 856096 → rejected.
  const onlyA = [...grid.frustumCandidates([{ nx: 0, ny: 0, nz: -1, c: 856095 }])]
  assertEqual(onlyA.length, 1, 'only tile A selected'); assertEqual(onlyA[0], 0, 'atom A (index 0)')
}

function run() {
  tileAabbTests()
  bboxMaxBoundaryTests()
  lexicographicOrderTests()
  frustumInclusionTests()
  obliquePlaneTests()
  rayCandidateTests()
  rayCapTests()
  outOfBboxAtomStillSelectableTests()
  rayPickRadiusBandTests()
  keyCollisionDistinctTilesTests()
  console.log('atom-tile-grid tests passed')
}

run()
