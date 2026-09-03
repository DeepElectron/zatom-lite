import { assertEqual, assertTrue } from '../testing/assert'
import { buildWulffShape, type WulffFace } from '../lib/analysis/builders/wulff'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

/** Cubic lattice a = 1 (canonical orientation). */
const CUBIC: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

/** Pre-expanded {100} family (6 faces). */
const CUBE_FACES: WulffFace[] = [
  { hkl: [ 1,  0,  0], surface_energy: 1.0 },
  { hkl: [-1,  0,  0], surface_energy: 1.0 },
  { hkl: [ 0,  1,  0], surface_energy: 1.0 },
  { hkl: [ 0, -1,  0], surface_energy: 1.0 },
  { hkl: [ 0,  0,  1], surface_energy: 1.0 },
  { hkl: [ 0,  0, -1], surface_energy: 1.0 },
]

/** Pre-expanded {111} family (8 faces). */
const OCT_FACES: WulffFace[] = [
  { hkl: [ 1,  1,  1], surface_energy: 1.0 },
  { hkl: [-1,  1,  1], surface_energy: 1.0 },
  { hkl: [ 1, -1,  1], surface_energy: 1.0 },
  { hkl: [ 1,  1, -1], surface_energy: 1.0 },
  { hkl: [-1, -1,  1], surface_energy: 1.0 },
  { hkl: [-1,  1, -1], surface_energy: 1.0 },
  { hkl: [ 1, -1, -1], surface_energy: 1.0 },
  { hkl: [-1, -1, -1], surface_energy: 1.0 },
]

function testCubeShape() {
  const result = buildWulffShape({
    lattice: CUBIC,
    faces: CUBE_FACES,
    element: 'Au',
    size_angstrom: 10,
  })
  const poly = result.polyhedron!
  // Cube: 6 faces, 8 vertices, volume = (2·10)³ = 8000
  assertEqual(poly.faces.length, 6, `expected 6 faces for cube (got ${poly.faces.length})`)
  assertEqual(poly.vertices.length, 8, `expected 8 vertices for cube (got ${poly.vertices.length})`)
  // Volume should be approximately (2·size)³ since each face at d=size.
  const expected = (2 * 10) ** 3
  assertTrue(
    Math.abs(poly.volume - expected) < 1.0,
    `cube volume ${poly.volume} differs from expected ${expected}`,
  )
}

function testOctahedronShape() {
  const result = buildWulffShape({
    lattice: CUBIC,
    faces: OCT_FACES,
    element: 'Au',
    size_angstrom: 10,
  })
  const poly = result.polyhedron!
  // Regular octahedron: 8 faces, 6 vertices.
  assertEqual(poly.faces.length, 8, `expected 8 faces for octahedron (got ${poly.faces.length})`)
  assertEqual(poly.vertices.length, 6, `expected 6 vertices for octahedron (got ${poly.vertices.length})`)
  // Volume of regular octahedron with vertex distance v from centre:
  //   V = (4/3) v³ where v = d × √3 (face-to-vertex for unit cube planes
  //   becomes vertex at distance d√3 for octahedron, but here our planes are
  //   ±(1,1,1)/√3 with d=size, so vertex sits along ±axis at √3·size).
  // V = (4/3)(√3·size)³
  const v = Math.sqrt(3) * 10
  const expected = (4 / 3) * v ** 3
  assertTrue(
    Math.abs(poly.volume - expected) < 1.0,
    `octahedron volume ${poly.volume} differs from expected ${expected}`,
  )
}

function testTruncatedOctahedron() {
  // Cube + octahedron faces with γ_111/γ_100 = 1.15 truncates the cube vertices.
  // Result: 14 faces total (6 squares from {100} + 8 hexagons from {111}).
  const faces: WulffFace[] = [
    ...CUBE_FACES.map((f) => ({ ...f, surface_energy: 1.0 })),
    ...OCT_FACES.map((f) => ({ ...f, surface_energy: 1.15 })),
  ]
  const result = buildWulffShape({
    lattice: CUBIC,
    faces,
    element: 'Au',
    size_angstrom: 10,
  })
  const poly = result.polyhedron!
  assertEqual(
    poly.faces.length,
    14,
    `expected 14 faces for truncated octahedron (got ${poly.faces.length})`,
  )
  // Each face should have ≥ 4 vertices (squares + hexagons). Count types.
  const squareFaces = poly.faces.filter((f) => f.vertex_indices.length === 4)
  const hexFaces = poly.faces.filter((f) => f.vertex_indices.length === 6)
  assertEqual(squareFaces.length, 6, `expected 6 square faces (got ${squareFaces.length})`)
  assertEqual(hexFaces.length, 8, `expected 8 hexagonal faces (got ${hexFaces.length})`)
}

function testCubeMarkers() {
  // The xyz output should contain 1 centre marker + 1 marker per face = 7.
  const result = buildWulffShape({
    lattice: CUBIC,
    faces: CUBE_FACES,
    element: 'Au',
    size_angstrom: 8,
    vacuum_angstrom: 4,
  })
  assertEqual(result.n_atoms, 7, `expected 7 marker atoms (got ${result.n_atoms})`)
  // Header should have a Lattice key.
  const header = result.xyz.split('\n')[1]
  assertTrue(header.includes('Lattice="'), 'header has Lattice key')
  assertTrue(header.includes('Wulff faces=6'), 'header tags face count')
}

function testRejectsDegenerate() {
  // Only one plane — clearly doesn't bound a polyhedron.
  let caught = false
  try {
    buildWulffShape({
      lattice: CUBIC,
      faces: [{ hkl: [1, 0, 0], surface_energy: 1 }],
      element: 'Au',
    })
  } catch (err) {
    caught = true
    assertTrue(err instanceof Error, 'expected an Error from degenerate input')
  }
  assertTrue(caught, 'single-plane input should throw')
}

function testRejectsBadGamma() {
  let caught = false
  try {
    buildWulffShape({
      lattice: CUBIC,
      faces: CUBE_FACES.map((f, i) => (i === 0 ? { ...f, surface_energy: -1 } : f)),
      element: 'Au',
    })
  } catch {
    caught = true
  }
  assertTrue(caught, 'negative surface_energy should throw')
}

function run() {
  testCubeShape()
  testOctahedronShape()
  testTruncatedOctahedron()
  testCubeMarkers()
  testRejectsDegenerate()
  testRejectsBadGamma()
  console.log('analysis Wulff tests passed')
}

run()
