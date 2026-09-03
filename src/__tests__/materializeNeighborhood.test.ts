import { assertEqual, assertTrue } from '../testing/assert'
import { materializeNeighborhood } from '../lib/render/materialize-neighborhood'
import type { CompactStructure } from '../lib/render/compact-structure'

function makeCompact(): CompactStructure {
  return {
    positions: new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6]),
    elementIndex: new Uint8Array([0, 1, 0]),
    elements: ['Cu', 'O'],
    grainId: new Uint32Array([5, 9, 5]),
    count: 3,
    bbox: { min: [0, 0, 0], max: [4, 5, 6] },
  }
}

function testMaterialize() {
  const c = makeCompact()
  const atoms = materializeNeighborhood(c, [1, 2])
  assertEqual(atoms.length, 2, 'two atoms')
  assertEqual(atoms[0].element, 'O', 'index 1 → O')
  assertEqual(atoms[1].element, 'Cu', 'index 2 → Cu')
  assertEqual(atoms[0].cartesian![0], 1, 'cartesian x')
  assertEqual(atoms[0].cartesian![1], 2, 'cartesian y')
  assertEqual(atoms[0].cartesian![2], 3, 'cartesian z')
  assertEqual(atoms[0].id, 'c1', 'stable id c<index>')
  const gp = atoms[0].props?.grain_id
  assertTrue(!!gp && gp.kind === 'scalar' && gp.value === 9, 'grain_id prop set')
}

function run() {
  testMaterialize()
  console.log('materialize-neighborhood tests passed')
}

run()
