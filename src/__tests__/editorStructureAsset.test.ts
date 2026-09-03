import { createStructureAssetFrame } from '../orchestration/record-structure-asset'
import { assertDeepEqual, assertEqual } from '../testing/assert'
import { createCrystalStore } from '../orchestration/crystalStore'
import { createCrystalPresentationArtifact } from '../orchestration/crystal-presentation-artifact'
import { ZATOM_STRUCTURE_SCHEMA } from '../agent/contracts'
import { validateStructure } from '../agent/structure-validation'

const frame = createStructureAssetFrame(
  'frame-editor',
  'C6H6',
  'editor',
  Array.from({ length: 12 }, (_, index) => ({
    id: `atom-${index}`,
    element: index < 6 ? 'C' : 'H',
    position: [index, 0, 0] as [number, number, number],
    cartesian: [index, 0, 0] as [number, number, number],
  })),
  [{ id: 'bond-0', atom1Id: 'atom-0', atom2Id: 'atom-1', type: 'aromatic' }],
  false,
  { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] },
  { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90, centeringType: 'P', spaceGroupNumber: 1 },
  { nx: 1, ny: 1, nz: 1 },
)

assertEqual(frame.label, 'C6H6', '2D Editor assets must keep the molecular formula label')
assertEqual(frame.atoms.length, 12, '2D Editor assets must snapshot every generated atom')
assertEqual(frame.bonds?.[0]?.type, 'aromatic', '2D Editor assets must preserve exact bond topology')
assertEqual(frame.periodicity, 'molecular', '2D Editor assets must remain non-periodic')
assertEqual(frame.latticeMatrix, undefined, 'Molecular editor assets must not invent a lattice')
assertEqual(frame.meta.functionId, 'structure_editor', 'Editor provenance must identify its source')

const fccFrame = createStructureAssetFrame(
  'frame-fcc',
  'FCC Cu',
  'template',
  [
    { id: 'cu-0', element: 'Cu', position: [0, 0, 0], cartesian: [0, 0, 0] },
    { id: 'cu-1', element: 'Cu', position: [0.5, 0, 0], cartesian: [4, 0, 0] },
  ],
  [],
  true,
  { a: [4, 0, 0], b: [0, 4, 0], c: [0, 0, 4] },
  { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90, centeringType: 'F', spaceGroupNumber: 225 },
  { nx: 2, ny: 1, nz: 1 },
)

assertEqual(fccFrame.meta.centeringType, 'F', 'periodic Assets must preserve conventional centering for BZ reconstruction')
assertEqual(fccFrame.meta.spaceGroupNumber, 225, 'periodic Assets must preserve space-group identity for the k-path')
assertEqual(fccFrame.latticeMatrix?.[0][0], 8, 'periodic Assets must serialize the complete materialized supercell')
const fccValidation = validateStructure({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms: fccFrame.atoms.map((atom, index) => ({
    id: `saved-cu-${index}`,
    element: 'Cu',
    position: atom.position,
  })),
  lattice: {
    vectors: fccFrame.latticeMatrix as [[number, number, number], [number, number, number], [number, number, number]],
    periodic: [true, true, true],
  },
})
assertEqual(fccValidation.verdict, 'pass', 'reloading a materialized periodic Asset must not create zero-distance periodic copies')
assertEqual(fccValidation.minPairDistanceA, 4, 'the saved supercell must retain its physical nearest-image distance')

const crystalStore = createCrystalStore()
crystalStore.setState({
  atoms: [
    { id: 'cu-0', element: 'Cu', position: [0, 0, 0], cartesian: [0, 0, 0] },
    { id: 'cu-copy', element: 'Cu', position: [.5, 0, 0], cartesian: [4, 0, 0], cellIndex: [1, 0, 0] },
  ],
  unitCellAtoms: [{ id: 'cu-0', element: 'Cu', position: [0, 0, 0], cartesian: [0, 0, 0] }],
  supercellParams: { nx: 2, ny: 1, nz: 1 },
})
const presentedFcc = createStructureAssetFrame(
  'frame-fcc-presentation', 'FCC Cu presentation', 'template',
  crystalStore.getState().atoms, [], true,
  { a: [4, 0, 0], b: [0, 4, 0], c: [0, 0, 4] },
  { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
  { nx: 2, ny: 1, nz: 1 }, undefined,
  createCrystalPresentationArtifact(crystalStore.getState()),
)
assertEqual(presentedFcc.latticeMatrix?.[0][0], 4, 'presentation Assets must retain the canonical unit-cell lattice')
assertDeepEqual(presentedFcc.crystalPresentation?.supercell.params, { nx: 2, ny: 1, nz: 1 }, 'presentation Assets must retain supercell dimensions separately')
assertEqual(presentedFcc.crystalPresentation?.supercell.unitCellAtoms.length, 1, 'presentation Assets must retain only canonical unit-cell atoms in the supercell payload')
assertDeepEqual(presentedFcc.atoms.map(atom => atom.id), ['cu-0', 'cu-copy'], 'presentation Assets must retain stable materialized atom IDs')
assertDeepEqual(presentedFcc.atoms.map(atom => atom.fractionalPosition), [[0, 0, 0], [.5, 0, 0]], 'presentation Assets must retain normalized supercell fractional coordinates')

console.log('editor structure asset tests passed')
