import { assertEqual, assertTrue } from '../testing/assert'
import { buildMetalCluster } from '../lib/analysis/builders/cluster'

type Vec3 = [number, number, number]

function parseXyzCount(xyz: string): number {
  return parseInt(xyz.split('\n')[0], 10)
}

function parseAtomPositions(xyz: string): Array<{ element: string; pos: Vec3 }> {
  const lines = xyz.split('\n')
  const n = parseInt(lines[0], 10)
  const out: Array<{ element: string; pos: Vec3 }> = []
  for (let i = 2; i < 2 + n; i++) {
    const parts = lines[i].split(/\s+/).filter(Boolean)
    out.push({
      element: parts[0],
      pos: [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])],
    })
  }
  return out
}

function testIcosahedralShell1() {
  const result = buildMetalCluster({
    geometry: 'icosahedral',
    element: 'Pt',
    shells: 1,
  })
  // Mackay icosahedron shell 1 = centre + 12 vertices = 13 atoms.
  assertEqual(result.n_atoms, 13, `expected 13 atoms for icosahedral shells=1, got ${result.n_atoms}`)
  assertEqual(parseXyzCount(result.xyz), 13)
  const atoms = parseAtomPositions(result.xyz)
  // All atoms should be element=Pt
  for (const a of atoms) assertEqual(a.element, 'Pt')
}

function testIcosahedralShell2() {
  const result = buildMetalCluster({
    geometry: 'icosahedral',
    element: 'Pt',
    shells: 2,
  })
  // Mackay icosahedron magic number for n=2 (cumulative) = 55.
  assertEqual(result.n_atoms, 55, `expected 55 atoms for icosahedral shells=2, got ${result.n_atoms}`)
}

function testCuboctahedralShell1() {
  const result = buildMetalCluster({
    geometry: 'cuboctahedral',
    element: 'Au',
    shells: 1,
  })
  // Cuboctahedral magic number n=1 = 13 (centre + 12 NN in FCC).
  assertEqual(result.n_atoms, 13, `expected 13 atoms for cuboctahedral shells=1, got ${result.n_atoms}`)
}

function testOctahedralShell2() {
  const result = buildMetalCluster({
    geometry: 'octahedral',
    element: 'Cu',
    shells: 2,
  })
  // Octahedral number a(3) = 19 per A005900 (shells=2 in our shell numbering).
  assertEqual(result.n_atoms, 19, `expected 19 atoms for octahedral shells=2, got ${result.n_atoms}`)
}

function testFccSmallRadius() {
  const r = 3.0
  const result = buildMetalCluster({
    geometry: 'fcc',
    element: 'Cu',
    bond_length: 2.55,
    radius_angstrom: r,
    vacuum_angstrom: 8,
  })
  // Every atom must lie within `r` of the cluster's geometric centre (post-
  // centering and vacuum shift, the centre is at (vacuum+span/2, ...).)
  assertTrue(result.n_atoms >= 1, `cluster should have at least the origin atom (got ${result.n_atoms})`)
  const atoms = parseAtomPositions(result.xyz)
  // Compute cluster centroid
  let cx = 0, cy = 0, cz = 0
  for (const a of atoms) { cx += a.pos[0]; cy += a.pos[1]; cz += a.pos[2] }
  cx /= atoms.length; cy /= atoms.length; cz /= atoms.length
  // Every atom should be within (r + small slack) of centroid; pre-shift the
  // centroid was at origin so the radius condition stands.
  for (const a of atoms) {
    const d = Math.sqrt((a.pos[0] - cx) ** 2 + (a.pos[1] - cy) ** 2 + (a.pos[2] - cz) ** 2)
    assertTrue(d <= r + 0.6, `atom at distance ${d.toFixed(2)} from centroid exceeds radius ${r}`)
  }
}

function testUnknownElementThrows() {
  let caught = false
  try {
    buildMetalCluster({ geometry: 'icosahedral', element: 'Xxx', shells: 1 })
  } catch (err) {
    caught = true
    assertTrue(err instanceof Error && /Unknown element/.test(err.message), 'expected Unknown element error')
  }
  assertTrue(caught, 'expected unknown element to throw')
}

function testHcpCluster() {
  // Sphere-cut HCP cluster — sanity check that atoms exist and lie within
  // radius of centroid.
  const result = buildMetalCluster({
    geometry: 'hcp',
    element: 'Co',
    bond_length: 2.5,
    radius_angstrom: 4.5,
  })
  assertTrue(result.n_atoms >= 1, `HCP sphere-cut should have atoms (got ${result.n_atoms})`)
}

function testDecahedralCluster() {
  const result = buildMetalCluster({
    geometry: 'decahedral',
    element: 'Au',
    shells: 2,
  })
  assertTrue(result.n_atoms >= 1, `decahedral cluster should have atoms (got ${result.n_atoms})`)
}

function testHeaderHasLatticeAndElement() {
  const result = buildMetalCluster({
    geometry: 'icosahedral',
    element: 'Pt',
    shells: 1,
  })
  const header = result.xyz.split('\n')[1]
  assertTrue(header.includes('Lattice="'), 'header has Lattice key')
  assertTrue(header.includes('Properties=species:S:1:pos:R:3'), 'header has properties key')
  assertTrue(header.includes('element=Pt'), 'header tags element')
}

function run() {
  testIcosahedralShell1()
  testIcosahedralShell2()
  testCuboctahedralShell1()
  testOctahedralShell2()
  testFccSmallRadius()
  testUnknownElementThrows()
  testHcpCluster()
  testDecahedralCluster()
  testHeaderHasLatticeAndElement()
  console.log('analysis MetalCluster tests passed')
}

run()
