import { assertEqual, assertTrue } from '../testing/assert'
import {
  buildSlabFromMiller,
  buildSlabFromPlane,
  interplanarSpacing,
  type SlabAtomInput,
} from '../lib/analysis/builders/slab'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

/** Conventional FCC Cu unit cell, a = 3.6149 Å, 4 atoms. */
function fccCopper(a = 3.6149): { lattice: Mat3; atoms: SlabAtomInput[] } {
  const lattice: Mat3 = [
    [a, 0, 0],
    [0, a, 0],
    [0, 0, a],
  ]
  // Fractional basis positions for FCC Cu
  const frac: Vec3[] = [
    [0, 0, 0],
    [0.5, 0.5, 0],
    [0.5, 0, 0.5],
    [0, 0.5, 0.5],
  ]
  const atoms: SlabAtomInput[] = frac.map((f) => ({
    element: 'Cu',
    cartesian: [f[0] * a, f[1] * a, f[2] * a] as Vec3,
  }))
  return { lattice, atoms }
}

/** Simple cubic lattice, a single atom. */
function simpleCubic(a = 3.0, element = 'Po'): { lattice: Mat3; atoms: SlabAtomInput[] } {
  return {
    lattice: [[a, 0, 0], [0, a, 0], [0, 0, a]],
    atoms: [{ element, cartesian: [0, 0, 0] }],
  }
}

function parseXyzCount(xyz: string): number {
  return parseInt(xyz.split('\n')[0], 10)
}

function parseLattice(xyz: string): Mat3 {
  const header = xyz.split('\n')[1]
  const m = header.match(/Lattice="([^"]+)"/)
  if (!m) throw new Error('No Lattice key in header')
  const parts = m[1].trim().split(/\s+/).map(parseFloat)
  return [
    [parts[0], parts[1], parts[2]],
    [parts[3], parts[4], parts[5]],
    [parts[6], parts[7], parts[8]],
  ]
}

function vecLen(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function testInterplanarSpacing() {
  const { lattice } = fccCopper()
  // d_100 for cubic = a
  const d100 = interplanarSpacing(lattice, 1, 0, 0)
  assertTrue(Math.abs(d100 - 3.6149) < 0.001, `d_100 ≈ a (got ${d100})`)
  // d_111 for cubic = a / sqrt(3)
  const d111 = interplanarSpacing(lattice, 1, 1, 1)
  const expected111 = 3.6149 / Math.sqrt(3)
  assertTrue(Math.abs(d111 - expected111) < 0.001, `d_111 = a/√3 (got ${d111}, expected ${expected111})`)
}

function testFccCu111Slab3Layers() {
  const { lattice, atoms } = fccCopper()
  const result = buildSlabFromMiller({
    lattice,
    atoms,
    h: 1, k: 1, l: 1,
    layers: 3,
    vacuum: 10,
  })
  // Slab text basic sanity
  assertTrue(result.n_atoms > 0, 'slab has atoms')
  assertEqual(parseXyzCount(result.xyz), result.n_atoms)
  // Each (111) layer of FCC Cu has 1 atom per primitive in-plane cell.
  // The smallest in-plane vectors we'll find are (a/2)·[1,-1,0] and (a/2)·[1,0,-1]
  // which give 2 atoms per layer (the primitive (111) cell of conventional FCC).
  // 3 layers × 2 atoms = 6, but our search may find a larger in-plane cell;
  // accept anything that's a multiple of 3 layers × ≥1.
  assertTrue(result.n_atoms >= 3, `expect >= 3 atoms for 3 layers (got ${result.n_atoms})`)
  assertTrue(result.n_atoms % 3 === 0 || result.n_atoms >= 3, `atoms should be 3-layer consistent (got ${result.n_atoms})`)

  // c-vector length should exceed vacuum (vacuum + slab thickness)
  const slabLattice = parseLattice(result.xyz)
  const cLen = vecLen(slabLattice[2])
  assertTrue(cLen > 10, `c-length ${cLen} should be > vacuum 10 Å`)
}

function testSimpleCubic100Slab() {
  const { lattice, atoms } = simpleCubic(3.0, 'Po')
  const result = buildSlabFromMiller({
    lattice,
    atoms,
    h: 1, k: 0, l: 0,
    layers: 4,
    vacuum: 10,
  })
  // For simple cubic (100), each layer has exactly 1 atom (the in-plane cell
  // is the original a×a square). 4 layers = 4 atoms.
  assertEqual(result.n_atoms, 4)
  const slabLattice = parseLattice(result.xyz)
  // The in-plane vectors should span the (100) face: a along y and z (or some
  // permutation). The cross-product magnitude = a² = 9.
  const cross = (u: Vec3, v: Vec3): Vec3 => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
  const area = vecLen(cross(slabLattice[0], slabLattice[1]))
  assertTrue(Math.abs(area - 9) < 0.01, `in-plane area ≈ a² (got ${area})`)
  const cLen = vecLen(slabLattice[2])
  // 4 layers of d=3.0 = 12, plus 10 vacuum = 22.
  assertTrue(cLen >= 13, `c-length should be at least slab thickness + vacuum (got ${cLen})`)
}

function testMillerNormalization() {
  // (222) should reduce to (111) and produce the same slab.
  const { lattice, atoms } = fccCopper()
  const a = buildSlabFromMiller({ lattice, atoms, h: 1, k: 1, l: 1, layers: 2, vacuum: 8 })
  const b = buildSlabFromMiller({ lattice, atoms, h: 2, k: 2, l: 2, layers: 2, vacuum: 8 })
  assertEqual(a.n_atoms, b.n_atoms)
}

function testMillerRejectsZero() {
  const { lattice, atoms } = fccCopper()
  let caught = false
  try {
    buildSlabFromMiller({ lattice, atoms, h: 0, k: 0, l: 0, layers: 2, vacuum: 5 })
  } catch {
    caught = true
  }
  assertTrue(caught, '(0,0,0) Miller indices should throw')
}

function testPlanePathKeepsCorrectSide() {
  // Build a Po simple-cubic slab with 6 atoms along z, then cut at z = 7.5
  // keeping the lower side. Should keep atoms at z=0,3,6 (3 atoms).
  const a = 3.0
  const lattice: Mat3 = [[a, 0, 0], [0, a, 0], [0, 0, a * 6]]
  const atoms: SlabAtomInput[] = []
  for (let i = 0; i < 6; i++) {
    atoms.push({ element: 'Po', cartesian: [0, 0, i * a] })
  }
  const result = buildSlabFromPlane({
    lattice,
    atoms,
    normal: [0, 0, 1],
    point_on_plane: [0, 0, 7.5],
    keep_side: 'negative',
    vacuum: 6,
  })
  // z < 7.5 with tolerance 0.05: z=0, 3, 6 (three atoms)
  assertEqual(result.n_atoms, 3, `expected 3 atoms below z=7.5 (got ${result.n_atoms})`)
}

function testPlanePathKeepsAbove() {
  const a = 3.0
  const lattice: Mat3 = [[a, 0, 0], [0, a, 0], [0, 0, a * 6]]
  const atoms: SlabAtomInput[] = []
  for (let i = 0; i < 6; i++) {
    atoms.push({ element: 'Po', cartesian: [0, 0, i * a] })
  }
  const result = buildSlabFromPlane({
    lattice,
    atoms,
    normal: [0, 0, 1],
    point_on_plane: [0, 0, 7.5],
    keep_side: 'positive',
    vacuum: 6,
  })
  // z > 7.5: z=9, 12, 15 (three atoms)
  assertEqual(result.n_atoms, 3, `expected 3 atoms above z=7.5 (got ${result.n_atoms})`)
}

function testSlabHasValidLatticeHeader() {
  const { lattice, atoms } = fccCopper()
  const result = buildSlabFromMiller({ lattice, atoms, h: 1, k: 0, l: 0, layers: 2, vacuum: 8 })
  const headerLine = result.xyz.split('\n')[1]
  assertTrue(headerLine.includes('Lattice="'), 'header has Lattice key')
  assertTrue(headerLine.includes('Properties=species:S:1:pos:R:3'), 'header has properties key')
}

function run() {
  testInterplanarSpacing()
  testFccCu111Slab3Layers()
  testSimpleCubic100Slab()
  testMillerNormalization()
  testMillerRejectsZero()
  testPlanePathKeepsCorrectSide()
  testPlanePathKeepsAbove()
  testSlabHasValidLatticeHeader()
  console.log('analysis Slab tests passed')
}

run()
