import { assertEqual, assertTrue } from '../testing/assert'
import {
  __internal__ as waterLayerInternal,
  buildWaterLayer,
  type WaterFillOptions,
  type WaterSoluteAtom,
  type Vec3,
} from '../lib/analysis/builders/water-layer'

type Mat3 = [Vec3, Vec3, Vec3]

function parseAtoms(xyz: string): Array<{ element: string; pos: Vec3 }> {
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

function countElement(atoms: Array<{ element: string }>, el: string): number {
  let c = 0
  for (const a of atoms) if (a.element === el) c++
  return c
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** 20×20×20 cube. */
function cubicLattice(side = 20): Mat3 {
  return [
    [side, 0, 0],
    [0, side, 0],
    [0, 0, side],
  ]
}

// ── Tests ──────────────────────────────────────────────────────────────────

function testBoxFillEmptyCube() {
  // 20×20×20 = 8000 Å³, ~265 waters at 1.0 g/cm³.
  const opts: WaterFillOptions = {
    mode: 'box',
    lattice: cubicLattice(20),
    density: 1.0,
    water_model: 'SPC/E',
    seed: 1234,
  }
  const res = buildWaterLayer(opts)
  const atoms = parseAtoms(res.xyz)
  const oCount = countElement(atoms, 'O')
  const hCount = countElement(atoms, 'H')
  // Hydrogen count must be 2× oxygen.
  assertEqual(hCount, 2 * oCount, `H count should be 2x O (got ${hCount} vs ${oCount})`)
  // Expect roughly 265 waters; allow a generous tolerance because MC can fail
  // to place a handful at higher density. ≥ 220 is comfortably above the noise.
  assertTrue(
    oCount >= 220 && oCount <= 280,
    `expected ~265 waters in 20×20×20 box at 1 g/cm³ (got ${oCount})`,
  )
  // n_atoms in result matches atoms in xyz block.
  assertEqual(res.n_atoms, atoms.length, 'n_atoms mismatch')
}

function testBoxFillReproducibleWithSeed() {
  const opts: WaterFillOptions = {
    mode: 'box',
    lattice: cubicLattice(15),
    density: 1.0,
    water_model: 'SPC/E',
    seed: 42,
  }
  const r1 = buildWaterLayer(opts)
  const r2 = buildWaterLayer(opts)
  assertEqual(r1.n_atoms, r2.n_atoms, 'seeded runs should yield same atom count')
  const a1 = parseAtoms(r1.xyz)
  const a2 = parseAtoms(r2.xyz)
  // First oxygen line should be identical.
  const o1 = a1.find((a) => a.element === 'O')!
  const o2 = a2.find((a) => a.element === 'O')!
  assertTrue(
    Math.abs(o1.pos[0] - o2.pos[0]) < 1e-6 &&
      Math.abs(o1.pos[1] - o2.pos[1]) < 1e-6 &&
      Math.abs(o1.pos[2] - o2.pos[2]) < 1e-6,
    `seeded first-O positions should match: ${o1.pos} vs ${o2.pos}`,
  )
}

function testBoxFillFixedCount() {
  const opts: WaterFillOptions = {
    mode: 'box',
    lattice: cubicLattice(25),
    target_count: 10,
    seed: 7,
  }
  const res = buildWaterLayer(opts)
  const atoms = parseAtoms(res.xyz)
  const oCount = countElement(atoms, 'O')
  assertEqual(oCount, 10, `expected exactly 10 waters (got ${oCount})`)
}

function testSurfaceFillOffsetConstraint() {
  // Build a tiny "slab": Cu atoms on a flat sheet at z = 0..2 Å spanning 10×10.
  const slab: WaterSoluteAtom[] = []
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      slab.push({ element: 'Cu', cartesian: [i * 2.5, j * 2.5, 0] })
      slab.push({ element: 'Cu', cartesian: [i * 2.5, j * 2.5, 2] })
    }
  }
  const lattice: Mat3 = [
    [10, 0, 0],
    [0, 10, 0],
    [0, 0, 20],
  ]
  const res = buildWaterLayer({
    mode: 'surface',
    lattice,
    solute_atoms: slab,
    layer_thickness: 6,
    surface_offset: 2.5,
    side: 'top',
    density: 1.0,
    water_model: 'SPC/E',
    seed: 99,
  })
  const atoms = parseAtoms(res.xyz)
  const oxygens = atoms.filter((a) => a.element === 'O')
  // We require at least one water placed in a 10×10×6 layer.
  assertTrue(oxygens.length > 0, `expected some waters above slab (got ${oxygens.length})`)
  const topSlabZ = 2
  // Every O–slab distance must be ≥ default min_solute_distance (2.3 Å) and
  // every O must sit above the slab (z >= topSlabZ + something).
  for (const o of oxygens) {
    assertTrue(
      o.pos[2] >= topSlabZ + 1.0,
      `oxygen at z=${o.pos[2].toFixed(2)} should be above slab top z=${topSlabZ}`,
    )
    for (const s of slab) {
      const d = dist(o.pos, s.cartesian)
      assertTrue(
        d >= 2.3 - 1e-3,
        `oxygen at ${o.pos} too close to slab atom (d=${d.toFixed(3)} Å)`,
      )
    }
  }
}

function testSoluteRejectionReducesCount() {
  // Tighter packing so the central solute sphere actually crowds the box.
  // A 15³ Å cube saturates around ~110 waters (density ≈ 1 g/cm³); ask for
  // 180 so the MC has to exhaust attempts, then the solute sphere forces a
  // measurable reduction.
  const baseLattice = cubicLattice(15)
  const empty = buildWaterLayer({
    mode: 'box',
    lattice: baseLattice,
    target_count: 180,
    seed: 2025,
    max_attempts: 30,
  })
  const emptyO = countElement(parseAtoms(empty.xyz), 'O')

  // Same box, but pre-fill with a dense sphere of dummy solute atoms.
  const solute: WaterSoluteAtom[] = []
  const centre: Vec3 = [7.5, 7.5, 7.5]
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      for (let k = -3; k <= 3; k++) {
        const p: Vec3 = [centre[0] + i * 1.0, centre[1] + j * 1.0, centre[2] + k * 1.0]
        const dx = p[0] - centre[0], dy = p[1] - centre[1], dz = p[2] - centre[2]
        if (dx * dx + dy * dy + dz * dz <= 16) solute.push({ element: 'C', cartesian: p })
      }
    }
  }
  const blocked = buildWaterLayer({
    mode: 'box',
    lattice: baseLattice,
    solute_atoms: solute,
    target_count: 180,
    seed: 2025,
    max_attempts: 30,
  })
  const blockedO = countElement(parseAtoms(blocked.xyz), 'O')

  assertTrue(
    blockedO < emptyO,
    `solute-filled box should accept fewer waters than empty (${blockedO} vs ${emptyO})`,
  )
  // All solute atoms must be retained verbatim in the output.
  const cCount = countElement(parseAtoms(blocked.xyz), 'C')
  assertEqual(cCount, solute.length, `solute atoms (${cCount}) should equal input (${solute.length})`)
}

function testUnknownWaterModelRejects() {
  let caught = false
  try {
    buildWaterLayer({
      mode: 'box',
      lattice: cubicLattice(15),
      target_count: 1,
      water_model: 'TIP9000' as unknown as 'SPC/E',
    })
  } catch (err) {
    caught = true
    assertTrue(
      err instanceof Error && /Unknown water_model/.test(err.message),
      `expected Unknown water_model error, got ${err}`,
    )
  }
  assertTrue(caught, 'expected unknown water_model to throw')
}

function testHeaderHasLatticeAndModel() {
  const res = buildWaterLayer({
    mode: 'box',
    lattice: cubicLattice(15),
    target_count: 3,
    seed: 1,
    water_model: 'TIP3P',
  })
  const header = res.xyz.split('\n')[1]
  assertTrue(header.includes('Lattice="'), 'header has Lattice')
  assertTrue(header.includes('Properties=species:S:1:pos:R:3'), 'header has properties')
  assertTrue(header.includes('model=TIP3P'), `header tags model — got: ${header}`)
}

function testWaterGeometry() {
  // For SPC/E: each O–H distance should be exactly 1.0 Å, ∠HOH ≈ 109.47°.
  const res = buildWaterLayer({
    mode: 'box',
    lattice: cubicLattice(15),
    target_count: 1,
    seed: 11,
    water_model: 'SPC/E',
  })
  const atoms = parseAtoms(res.xyz)
  const o = atoms.find((a) => a.element === 'O')!
  const hs = atoms.filter((a) => a.element === 'H')
  assertEqual(hs.length, 2, 'should have exactly 2 H atoms')
  for (const h of hs) {
    const d = dist(o.pos, h.pos)
    assertTrue(Math.abs(d - 1.0) < 1e-3, `SPC/E O–H should be 1.0 Å (got ${d.toFixed(4)})`)
  }
  // ∠HOH = arc-cos((OH1 · OH2) / |OH1| |OH2|)
  const oh1: Vec3 = [hs[0].pos[0] - o.pos[0], hs[0].pos[1] - o.pos[1], hs[0].pos[2] - o.pos[2]]
  const oh2: Vec3 = [hs[1].pos[0] - o.pos[0], hs[1].pos[1] - o.pos[1], hs[1].pos[2] - o.pos[2]]
  const cosA = (oh1[0] * oh2[0] + oh1[1] * oh2[1] + oh1[2] * oh2[2])
  const angDeg = Math.acos(cosA) * 180 / Math.PI
  assertTrue(Math.abs(angDeg - 109.47) < 0.1, `SPC/E ∠HOH should be 109.47° (got ${angDeg.toFixed(2)})`)
}

function testNonOrthogonalPbcMinimumImage() {
  const lattice: Mat3 = [
    [10, 0, 0],
    [5, 8, 0],
    [0, 0, 10],
  ]
  const ctx = waterLayerInternal.makePbcContext(lattice, [true, true, true])
  const p: Vec3 = [
    0.1 * lattice[0][0] + 0.1 * lattice[1][0] + 0.1 * lattice[2][0],
    0.1 * lattice[0][1] + 0.1 * lattice[1][1] + 0.1 * lattice[2][1],
    0.1 * lattice[0][2] + 0.1 * lattice[1][2] + 0.1 * lattice[2][2],
  ]
  const q: Vec3 = [
    0.9 * lattice[0][0] + 0.9 * lattice[1][0] + 0.9 * lattice[2][0],
    0.9 * lattice[0][1] + 0.9 * lattice[1][1] + 0.9 * lattice[2][1],
    0.9 * lattice[0][2] + 0.9 * lattice[1][2] + 0.9 * lattice[2][2],
  ]

  const d2 = waterLayerInternal.pbcDistanceSq(p, q, ctx)
  const expectedDx = 0.2 * lattice[0][0] + 0.2 * lattice[1][0] + 0.2 * lattice[2][0]
  const expectedDy = 0.2 * lattice[0][1] + 0.2 * lattice[1][1] + 0.2 * lattice[2][1]
  const expectedDz = 0.2 * lattice[0][2] + 0.2 * lattice[1][2] + 0.2 * lattice[2][2]
  const expected = expectedDx * expectedDx + expectedDy * expectedDy + expectedDz * expectedDz

  assertTrue(
    Math.abs(d2 - expected) < 1e-9,
    `non-orthogonal PBC distance should use row-lattice minimum image (${d2} vs ${expected})`,
  )
}

function run() {
  testBoxFillEmptyCube()
  testBoxFillReproducibleWithSeed()
  testBoxFillFixedCount()
  testSurfaceFillOffsetConstraint()
  testSoluteRejectionReducesCount()
  testUnknownWaterModelRejects()
  testHeaderHasLatticeAndModel()
  testWaterGeometry()
  testNonOrthogonalPbcMinimumImage()
  console.log('analysis WaterLayer tests passed')
}

run()
