import { assertEqual, assertTrue } from '../testing/assert'
import { buildVoxelSurface } from '../lib/render/region-voxel-surface'

function testSingleVoxelCube() {
  // one atom → one voxel → a unit cube: 6 quads = 12 tris = 36 verts
  const pos = new Float32Array([0.5, 0.5, 0.5])
  const regionOf = new Int32Array([0])
  const m = buildVoxelSurface(pos, 1, regionOf, 1.0)
  assertEqual(m.vertexCount, 36, `single voxel verts ${m.vertexCount}`)
  // all verts track atom 0; offsets reproduce vertex position
  for (let v = 0; v < m.vertexCount; v++) {
    assertEqual(m.atomIndex[v], 0, 'atomIndex')
    for (let a = 0; a < 3; a++) {
      const reconstructed = pos[a] + m.offsets[v * 3 + a]
      assertTrue(Math.abs(reconstructed - m.positions[v * 3 + a]) < 1e-5, 'offset reconstructs vertex')
    }
  }
}

function testGreedyMergeSameRegion() {
  // two same-region voxels along x → a 2×1×1 box still meshes as 6 rects = 36 verts
  const pos = new Float32Array([0.5, 0.5, 0.5, 1.5, 0.5, 0.5])
  const regionOf = new Int32Array([0, 0])
  const m = buildVoxelSurface(pos, 2, regionOf, 1.0)
  assertEqual(m.vertexCount, 36, `merged box verts ${m.vertexCount} (greedy merge)`)
}

function testBoundaryBetweenRegions() {
  // two adjacent voxels, DIFFERENT regions → two full cubes incl. both boundary faces:
  // 12 quads = 72 verts
  const pos = new Float32Array([0.5, 0.5, 0.5, 1.5, 0.5, 0.5])
  const regionOf = new Int32Array([0, 1])
  const m = buildVoxelSurface(pos, 2, regionOf, 1.0)
  assertEqual(m.vertexCount, 72, `two-region verts ${m.vertexCount}`)
}

function testNoiseSkippedAndColorStable() {
  // region -1 (noise) voxel must not be meshed; colorIdOf maps both regions to one label color
  const pos = new Float32Array([0.5, 0.5, 0.5, 2.5, 0.5, 0.5, 4.5, 0.5, 0.5])
  const regionOf = new Int32Array([0, -1, 1])
  const m = buildVoxelSurface(pos, 3, regionOf, 1.0, () => 7)
  // two isolated cubes (noise one skipped): 2 × 36
  assertEqual(m.vertexCount, 72, `noise skipped ${m.vertexCount}`)
  // same colorId → identical RGB for a vertex of each cube
  const r0 = [m.colors[0], m.colors[1], m.colors[2]]
  const r1 = [m.colors[36 * 3], m.colors[36 * 3 + 1], m.colors[36 * 3 + 2]]
  for (let a = 0; a < 3; a++) assertTrue(Math.abs(r0[a] - r1[a]) < 1e-6, 'label-stable colors')
}

function run() {
  testSingleVoxelCube()
  testGreedyMergeSameRegion()
  testBoundaryBetweenRegions()
  testNoiseSkippedAndColorStable()
  console.log('region-voxel-surface tests passed')
}

run()
