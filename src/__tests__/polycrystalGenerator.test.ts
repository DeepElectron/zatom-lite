import { assertEqual, assertTrue } from '../testing/assert'
import { generatePolycrystal } from '../lib/polycrystal/polycrystal-generator'
import { polycrystalToXYZ } from '../lib/polycrystal/polycrystal-to-xyz'
import type { BaseCell, PolycrystalOptions } from '../lib/polycrystal/types'

const BASE: BaseCell = {
  latticeVectors: { a: [3, 0, 0], b: [0, 3, 0], c: [0, 0, 3] },
  basis: [{ element: 'Cu', frac: [0, 0, 0] }],
}
const OPTS: PolycrystalOptions = {
  baseTemplateKey: 'fcc', boxSize: 24, grainCount: 5,
  minSeedDistance: 0, overlapDmin: 0, seed: 2024,
  maxAtoms: 100_000,
}

function testDeterministic() {
  const a = generatePolycrystal(OPTS, BASE)
  const b = generatePolycrystal(OPTS, BASE)
  assertEqual(a.count, b.count, 'same options → same count')
  assertEqual(a.positions[0], b.positions[0], 'same first coord')
  assertEqual(a.grainId[a.count - 1], b.grainId[b.count - 1], 'same last grain')
}

function testGrainIdsWithinRange() {
  const r = generatePolycrystal(OPTS, BASE)
  assertTrue(r.count > 0, 'produced atoms')
  for (let i = 0; i < r.count; i++) assertTrue(r.grainId[i] < OPTS.grainCount, 'grainId in range')
  assertEqual(r.rotations.length, OPTS.grainCount * 9, 'one rotation matrix per grain')
  assertEqual(r.basisIndex.length, r.count, 'source basis identity per atom')
}

function testAtomBudgetFailsClosed() {
  let failed = false
  try {
    generatePolycrystal({ ...OPTS, maxAtoms: 1 }, BASE)
  } catch (error) {
    failed = error instanceof Error && error.message.includes('generation budget')
  }
  assertTrue(failed, 'atom budget must stop generation')
}

function testXYZSerialization() {
  const r = generatePolycrystal(OPTS, BASE)
  const xyz = polycrystalToXYZ(r)
  const lines = xyz.split('\n')
  assertEqual(parseInt(lines[0]), r.count, 'first line = atom count')
  assertTrue(lines[1].includes('Lattice='), 'has extended-xyz Lattice header')
  assertTrue(lines[2].startsWith('Cu '), 'first atom row has element symbol')
}

function run() {
  testDeterministic()
  testGrainIdsWithinRange()
  testAtomBudgetFailsClosed()
  testXYZSerialization()
  console.log('polycrystal generator tests passed')
}

run()
