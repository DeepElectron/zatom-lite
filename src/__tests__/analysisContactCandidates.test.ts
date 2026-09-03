import { assertEqual, assertTrue } from '../testing/assert'
import { detectGenericContactCandidates } from '../lib/analysis/contact-candidates'
import type { Atom, Bond } from '../lib/crystal/types'

function atom(id: string, element: string, cartesian: [number, number, number]): Atom {
  return { id, element, position: cartesian, cartesian }
}

// Two water molecules at a typical 2.8-angstrom O-O hydrogen-bond distance. Expect one O-O
// candidate, excluding hydrogens, bonded pairs, and 1-3 pairs.
const waterDimerAtoms: Atom[] = [
  atom('o1', 'O', [0, 0, 0]),
  atom('h1a', 'H', [0.96, 0, 0]),
  atom('h1b', 'H', [-0.24, 0.93, 0]),
  atom('o2', 'O', [2.8, 0, 0]),
  atom('h2a', 'H', [3.36, 0.78, 0]),
  atom('h2b', 'H', [3.36, -0.78, 0]),
]
const waterDimerBonds: Bond[] = [
  { id: 'b1', atom1Id: 'o1', atom2Id: 'h1a', type: 'single' },
  { id: 'b2', atom1Id: 'o1', atom2Id: 'h1b', type: 'single' },
  { id: 'b3', atom1Id: 'o2', atom2Id: 'h2a', type: 'single' },
  { id: 'b4', atom1Id: 'o2', atom2Id: 'h2b', type: 'single' },
]

export function testWaterDimerHasSingleContact(): void {
  const contacts = detectGenericContactCandidates(waterDimerAtoms, waterDimerBonds)
  assertEqual(contacts.length, 1, 'water dimer should yield exactly one O–O candidate')
  const [contact] = contacts
  assertTrue(
    (contact.atomId1 === 'o1' && contact.atomId2 === 'o2')
      || (contact.atomId1 === 'o2' && contact.atomId2 === 'o1'),
    'candidate should connect the two oxygens',
  )
  assertTrue(Math.abs(contact.distance - 2.8) < 1e-9, 'distance should equal O–O separation')
}

export function testBondedPairExcluded(): void {
  // A covalent O-O bond excludes the pair from contact candidates.
  const bonded: Bond[] = [
    ...waterDimerBonds,
    { id: 'b5', atom1Id: 'o1', atom2Id: 'o2', type: 'single' },
  ]
  const contacts = detectGenericContactCandidates(waterDimerAtoms, bonded)
  assertEqual(contacts.length, 0, 'covalently bonded pair must not be a contact candidate')
}

export function testOneThreeExcluded(): void {
  // O-C-O oxygens at 2.9 angstroms share bonded carbon and are excluded as a 1-3 pair.
  const atoms: Atom[] = [
    atom('oa', 'O', [0, 0, 0]),
    atom('c', 'C', [1.45, 0.9, 0]),
    atom('ob', 'O', [2.9, 0, 0]),
  ]
  const bonds: Bond[] = [
    { id: 'b1', atom1Id: 'oa', atom2Id: 'c', type: 'single' },
    { id: 'b2', atom1Id: 'c', atom2Id: 'ob', type: 'single' },
  ]
  assertEqual(
    detectGenericContactCandidates(atoms, bonds).length, 0,
    'atoms sharing a bonded neighbor (1-3) must be excluded',
  )
}

export function testDistanceWindow(): void {
  // Distances in bonding range at 2.0 or beyond contact range at 4.2 are not candidates.
  const near: Atom[] = [atom('n1', 'N', [0, 0, 0]), atom('n2', 'N', [2.0, 0, 0])]
  const far: Atom[] = [atom('n3', 'N', [0, 0, 0]), atom('n4', 'N', [4.2, 0, 0])]
  assertEqual(detectGenericContactCandidates(near, []).length, 0, 'below 2.4 Å is not a contact')
  assertEqual(detectGenericContactCandidates(far, []).length, 0, 'beyond 3.5 Å is not a contact')
}

export function testSelectionRestriction(): void {
  // Restricting a three-oxygen line to o3 retains only the o2-o3 contact.
  const atoms: Atom[] = [
    atom('o1', 'O', [0, 0, 0]),
    atom('o2', 'O', [3.0, 0, 0]),
    atom('o3', 'O', [6.0, 0, 0]),
  ]
  const all = detectGenericContactCandidates(atoms, [])
  assertEqual(all.length, 2, 'unrestricted detection should find both adjacent pairs')
  const restricted = detectGenericContactCandidates(atoms, [], new Set(['o3']))
  assertEqual(restricted.length, 1, 'restriction should keep only contacts touching o3')
  assertTrue(
    restricted[0].atomId1 === 'o3' || restricted[0].atomId2 === 'o3',
    'remaining contact must touch the restricted atom',
  )
}
