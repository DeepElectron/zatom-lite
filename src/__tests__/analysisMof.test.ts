/**
 * Tests for the MOF analysis module (SBU detection + RAC descriptors).
 *
 * Uses synthetic Cartesian fragments (no PBC) — the algorithm always
 * operates on the supplied image only. See `sbu-detect.ts` header for
 * the PBC discussion.
 */
import { assertEqual, assertTrue } from '../testing/assert'
import {
  computeRac,
  describeSbuTopology,
  detectSbus,
  isAlkaliOrAlkalineEarth,
  isMetal,
  isTransitionMetal,
} from '../lib/analysis/mof'

type Vec3 = [number, number, number]

interface TAtom {
  id: string
  element: string
  cartesian: Vec3
}
interface TBond {
  atom1Id: string
  atom2Id: string
}

function atom(id: string, element: string, cartesian: Vec3): TAtom {
  return { id, element, cartesian }
}
function bond(a: string, b: string): TBond {
  return { atom1Id: a, atom2Id: b }
}

// ---------------------------------------------------------------------------
// Test a — Cu paddle-wheel
// ---------------------------------------------------------------------------
//
// Geometry:
//   Cu1 at (0, 0, 0), Cu2 at (2.6, 0, 0)
//   4 carboxylate carbons in a square at ~2.0 Å midway between Cu1/Cu2:
//     C1 (1.3,  2.0, 0)
//     C2 (1.3, -2.0, 0)
//     C3 (1.3, 0,  2.0)
//     C4 (1.3, 0, -2.0)
//   Each carbon binds two oxygens. Each oxygen sits near one Cu so the
//   metal-O distance is ~2.0 Å.
//
// Expected: 1 paddle-wheel SBU + 1 linker SBU (the 4-carbon+8-oxygen
// system is connected through O atoms? no — through C-C bonds we are
// NOT adding, so they end up as separate capping groups). For this test
// we focus on the metal cluster classification.
function buildPaddleWheel(): { atoms: TAtom[]; bonds: TBond[]; cu1: string; cu2: string } {
  const atoms: TAtom[] = [
    atom('Cu1', 'Cu', [0, 0, 0]),
    atom('Cu2', 'Cu', [2.6, 0, 0]),
    // Carboxylate carbons (positioned around the midpoint)
    atom('C1', 'C', [1.3, 2.0, 0]),
    atom('C2', 'C', [1.3, -2.0, 0]),
    atom('C3', 'C', [1.3, 0, 2.0]),
    atom('C4', 'C', [1.3, 0, -2.0]),
    // Each carbon has two oxygens, one near each Cu
    atom('O1a', 'O', [0.3, 1.4, 0]),
    atom('O1b', 'O', [2.3, 1.4, 0]),
    atom('O2a', 'O', [0.3, -1.4, 0]),
    atom('O2b', 'O', [2.3, -1.4, 0]),
    atom('O3a', 'O', [0.3, 0, 1.4]),
    atom('O3b', 'O', [2.3, 0, 1.4]),
    atom('O4a', 'O', [0.3, 0, -1.4]),
    atom('O4b', 'O', [2.3, 0, -1.4]),
  ]
  const bonds: TBond[] = [
    // C-O carboxylate bonds (each C bonded to its two oxygens)
    bond('C1', 'O1a'), bond('C1', 'O1b'),
    bond('C2', 'O2a'), bond('C2', 'O2b'),
    bond('C3', 'O3a'), bond('C3', 'O3b'),
    bond('C4', 'O4a'), bond('C4', 'O4b'),
    // Metal-O coordination bonds
    bond('Cu1', 'O1a'), bond('Cu2', 'O1b'),
    bond('Cu1', 'O2a'), bond('Cu2', 'O2b'),
    bond('Cu1', 'O3a'), bond('Cu2', 'O3b'),
    bond('Cu1', 'O4a'), bond('Cu2', 'O4b'),
  ]
  return { atoms, bonds, cu1: 'Cu1', cu2: 'Cu2' }
}

function testCuPaddleWheelDetection() {
  const { atoms, bonds } = buildPaddleWheel()
  const result = detectSbus(atoms, bonds)
  const paddlewheels = result.sbus.filter((s) => s.kind === 'metal_paddlewheel')
  assertEqual(paddlewheels.length, 1, `expected 1 paddle-wheel, got ${paddlewheels.length}`)
  assertEqual(paddlewheels[0].atom_ids.length, 2, 'paddle-wheel should contain 2 metal atoms')

  // The 4 separate C-O-O carboxylate fragments are each 3 atoms (=capping
  // by the small-group rule). Verify that we DID detect the carbons and
  // oxygens at all (not lost).
  const linkerOrCap = result.sbus.filter((s) => s.kind === 'linker' || s.kind === 'capping')
  assertTrue(linkerOrCap.length >= 1, 'should have at least one organic SBU')

  // Topology label should mention paddle-wheel.
  const label = describeSbuTopology(paddlewheels[0], atoms, bonds)
  assertTrue(label.includes('paddle-wheel'), `expected paddle-wheel label, got "${label}"`)
}

// ---------------------------------------------------------------------------
// Test b — Zn4O cluster
// ---------------------------------------------------------------------------
function testZn4OClusterDetection() {
  // 4 Zn at tetrahedral vertices around a central O at the origin.
  // Tetrahedron edge length ≈ 1.95 × √(8/3) ≈ 3.18 Å so M-M > cutoff.
  const r = 1.95
  const a = (r / Math.sqrt(3))
  const atoms: TAtom[] = [
    atom('O0', 'O', [0, 0, 0]),
    atom('Zn1', 'Zn', [a,  a,  a]),
    atom('Zn2', 'Zn', [a, -a, -a]),
    atom('Zn3', 'Zn', [-a,  a, -a]),
    atom('Zn4', 'Zn', [-a, -a,  a]),
  ]
  const bonds: TBond[] = [
    bond('O0', 'Zn1'),
    bond('O0', 'Zn2'),
    bond('O0', 'Zn3'),
    bond('O0', 'Zn4'),
  ]
  // metal_metal_cutoff default 3.5 would group them anyway; use a
  // smaller cutoff to force bridging-O detection to do the work.
  const result = detectSbus(atoms, bonds, { metal_metal_cutoff: 2.5 })
  const oxos = result.sbus.filter((s) => s.kind === 'metal_oxocluster')
  assertEqual(oxos.length, 1, `expected 1 oxocluster, got ${oxos.length} (kinds: ${result.sbus.map((s) => s.kind).join(',')})`)
  assertEqual(oxos[0].atom_ids.length, 4, 'oxocluster should contain 4 Zn atoms')
  const label = describeSbuTopology(oxos[0], atoms, bonds)
  assertEqual(label, 'Zn4O (basic zinc acetate)')
}

// ---------------------------------------------------------------------------
// Test c — Cu monomer with 4 capping ligands
// ---------------------------------------------------------------------------
function testSingleCuMonomer() {
  const atoms: TAtom[] = [
    atom('Cu', 'Cu', [0, 0, 0]),
    // Four terminal water-like O atoms (no other bonds → capping).
    atom('O1', 'O', [2.0, 0, 0]),
    atom('O2', 'O', [-2.0, 0, 0]),
    atom('O3', 'O', [0, 2.0, 0]),
    atom('O4', 'O', [0, -2.0, 0]),
  ]
  // No bonds between O atoms; only Cu–O coordination bonds.
  const bonds: TBond[] = [
    bond('Cu', 'O1'),
    bond('Cu', 'O2'),
    bond('Cu', 'O3'),
    bond('Cu', 'O4'),
  ]
  // Increase the oxo-bridge cutoff to something below 2.0 so the 4 oxygens
  // are NOT merged with each other through Cu (they're not anyway since
  // they each only see one Cu). Default is fine.
  const result = detectSbus(atoms, bonds, { oxo_bridge_cutoff: 1.5 })
  const monomers = result.sbus.filter((s) => s.kind === 'metal_monomer')
  assertEqual(monomers.length, 1, `expected 1 monomer, got ${monomers.length}`)
  assertEqual(monomers[0].atom_ids[0], 'Cu')

  const cappings = result.sbus.filter((s) => s.kind === 'capping')
  // Each O atom is its own 1-atom group → 4 cappings.
  assertEqual(cappings.length, 4, `expected 4 cappings, got ${cappings.length}`)
}

// ---------------------------------------------------------------------------
// Test d — Metal table coverage
// ---------------------------------------------------------------------------
function testMetalTable() {
  assertEqual(isMetal('Cu'), true, 'Cu should be metal')
  assertEqual(isMetal('Zn'), true, 'Zn should be metal')
  assertEqual(isMetal('Fe'), true, 'Fe should be metal')
  assertEqual(isMetal('Na'), true, 'Na should be metal')
  assertEqual(isMetal('C'), false, 'C should NOT be metal')
  assertEqual(isMetal('B'), false, 'B should NOT be metal (boundary)')
  assertEqual(isMetal('H'), false, 'H should NOT be metal')
  assertEqual(isMetal('Si'), false, 'Si should NOT be metal (boundary)')
  assertEqual(isMetal('Te'), false, 'Te should NOT be metal (boundary)')

  assertEqual(isTransitionMetal('Fe'), true)
  assertEqual(isTransitionMetal('Cu'), true)
  assertEqual(isTransitionMetal('Ca'), false, 'Ca is not transition')
  assertEqual(isTransitionMetal('C'), false)

  assertEqual(isAlkaliOrAlkalineEarth('Na'), true)
  assertEqual(isAlkaliOrAlkalineEarth('Mg'), true)
  assertEqual(isAlkaliOrAlkalineEarth('Cu'), false)
}

// ---------------------------------------------------------------------------
// Test e — RAC vector sanity on Cu paddle-wheel
// ---------------------------------------------------------------------------
function testRacOnCuPaddleWheel() {
  const { atoms, bonds, cu1 } = buildPaddleWheel()
  const rac = computeRac(atoms, bonds, cu1, { depths: [1, 2, 3] })
  // 6 props × 3 depths × 2 (P/D) = 36 entries.
  assertEqual(rac.features.length, 36, `expected 36 RAC entries, got ${rac.features.length}`)
  for (const f of rac.features) {
    assertTrue(Number.isFinite(f.value), `feature ${f.property}-${f.depth}-${f.kind} not finite: ${f.value}`)
  }

  // Cu1 is bonded to 4 oxygens directly (depth=1 neighbours).
  // Identity product at depth 1 should equal 1 × 1 × 4 = 4.
  const idP1 = rac.features.find((f) => f.property === 'I' && f.depth === 1 && f.kind === 'P')!
  assertEqual(idP1.value, 4, `identity-P at depth 1 should equal neighbour count, got ${idP1.value}`)

  // Z product at depth 1 = 29 (Cu) × sum_of_Z_of_neighbours.
  // The 4 depth-1 neighbours are 4 oxygens → 29 × (4 × 8) = 928.
  const zP1 = rac.features.find((f) => f.property === 'Z' && f.depth === 1 && f.kind === 'P')!
  assertEqual(zP1.value, 29 * 4 * 8, `Z product at depth 1 should be 29 × 4 × 8, got ${zP1.value}`)

  // chi difference squared at depth 1: 4 × (1.90 - 3.44)² ≈ 4 × 2.3716 ≈ 9.49
  const chiD1 = rac.features.find((f) => f.property === 'chi' && f.depth === 1 && f.kind === 'D')!
  assertTrue(Math.abs(chiD1.value - 4 * Math.pow(1.90 - 3.44, 2)) < 1e-6, `chi-D at depth 1 mismatch: ${chiD1.value}`)
}

// ---------------------------------------------------------------------------
// Test f — PBC documentation / warning behaviour
// ---------------------------------------------------------------------------
function testPbcWarningWhenMetalsLookCellSpanning() {
  // Two single metal atoms placed at "opposite" edges of a 10 Å box.
  // The bond list contains NO inter-metal bond (mimicking a PBC-spanning
  // bridge that the caller forgot to include). The algorithm should
  // therefore NOT detect them as a cluster.
  const atoms: TAtom[] = [
    atom('Cu1', 'Cu', [0.1, 5, 5]),
    atom('Cu2', 'Cu', [9.9, 5, 5]),
    // A bridging O at fractional 0.99 of the same axis — sits next to
    // Cu2 only in this image.
    atom('Obridge', 'O', [9.0, 5, 5]),
  ]
  const bonds: TBond[] = [
    bond('Cu2', 'Obridge'), // Cu1 is "across the cell" but no bond
  ]
  const result = detectSbus(atoms, bonds)

  // Cu1 and Cu2 should be in separate SBUs (no false-positive grouping
  // since the algorithm works on the supplied Cartesian image only).
  const monomers = result.sbus.filter((s) => s.kind === 'metal_monomer')
  assertEqual(monomers.length, 2, `expected 2 monomers (no PBC-aware grouping), got ${monomers.length}`)

  // Now bring them close in real space (within metal_metal_cutoff * 1.5
  // but not within the cutoff itself) to make sure the warning fires.
  const atoms2: TAtom[] = [
    atom('Cu1', 'Cu', [0, 0, 0]),
    atom('Cu2', 'Cu', [4.5, 0, 0]), // > 3.5 (default M-M cutoff), < 1.5×3.5 = 5.25
  ]
  const result2 = detectSbus(atoms2, [])
  assertTrue(
    result2.warnings.some((w) => w.includes('supercelling')),
    `expected a supercell warning, got: ${JSON.stringify(result2.warnings)}`,
  )
}

function run() {
  testCuPaddleWheelDetection()
  testZn4OClusterDetection()
  testSingleCuMonomer()
  testMetalTable()
  testRacOnCuPaddleWheel()
  testPbcWarningWhenMetalsLookCellSpanning()
}

run()
console.log('analysis MOF tests passed')
