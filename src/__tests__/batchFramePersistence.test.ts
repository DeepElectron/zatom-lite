import type { WorkspaceFrame } from '../host'
import type { Atom, Bond, LatticeVectors } from '../lib/crystal/types'
import { assertDeepEqual, assertEqual } from '../testing/assert'
import { replaceWorkspaceFrameStructure } from '../ui/panels/batch-frame'
import { createStructureAssetFrame } from '../orchestration/record-structure-asset'
import { workspaceFrameBondsToCrystalBonds } from '../lib/assembly/workspace-frame-block'

const original: WorkspaceFrame = {
  id: 'frame-1',
  label: 'Methyl',
  createdAt: '2026-08-09T12:00:00.000Z',
  atoms: [{ element: 6, position: [0, 0, 0], selected: 0 }],
  periodicity: 'molecular',
  settings: { stiffness: 25, cutoff: 3, forceField: 'uff', method: 'steepest_descent' },
  meta: { eventType: 'FUNCTION_TICK', functionId: 'fragment', sourceTaskId: 'task-1' },
  contentHash: 'original-provenance',
}
const editedAtoms: WorkspaceFrame['atoms'] = [
  { element: 6, position: [0.2, 0, 0], selected: 0 },
  { element: 8, position: [1.4, 0, 0], selected: 0 },
]
const editedBonds: WorkspaceFrame['bonds'] = [{ from: 0, to: 1, type: 'double' }]

const updated = replaceWorkspaceFrameStructure(original, editedAtoms, editedBonds, undefined)

assertEqual(updated.id, original.id, 'auto-save must preserve frame identity')
assertEqual(updated.label, 'Methyl', 'auto-save must preserve the user-visible Asset name')
assertEqual(updated.createdAt, original.createdAt, 'auto-save must preserve creation time')
assertDeepEqual(updated.settings, original.settings, 'auto-save must preserve simulation settings')
assertDeepEqual(updated.meta, original.meta, 'auto-save must preserve provenance metadata')
assertEqual(updated.contentHash, original.contentHash, 'auto-save must preserve external provenance fields')
assertDeepEqual(updated.atoms, editedAtoms, 'auto-save must replace the edited atom payload')
assertDeepEqual(updated.bonds, editedBonds, 'auto-save must replace the edited bond topology')
assertEqual(updated.periodicity, 'molecular', 'an edit without a lattice must remain molecular')

// Periodic image offsets must round-trip with asset frames; otherwise restored bonds span the cell.
const periodicLattice: LatticeVectors = {
  a: [4, 0, 0],
  b: [0, 4, 0],
  c: [0, 0, 4],
}
const periodicAtoms: Atom[] = [
  { id: 'a0', element: 'Cu', position: [0.05, 0.5, 0.5], cartesian: [0.2, 2, 2] },
  { id: 'a1', element: 'Cu', position: [0.95, 0.5, 0.5], cartesian: [3.8, 2, 2] },
]
const crossingBond: Bond = {
  id: 'b0',
  atom1Id: 'a0',
  atom2Id: 'a1',
  type: 'single',
  latticeOffset: [-1, 0, 0],
}
const archived = createStructureAssetFrame(
  'frame-pbc',
  'Cu cell',
  'import',
  periodicAtoms,
  [crossingBond],
  true,
  periodicLattice,
  { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
  { nx: 1, ny: 1, nz: 1 },
)

assertDeepEqual(
  archived.bonds?.[0]?.latticeOffset,
  [-1, 0, 0],
  'archiving a boundary-crossing bond must keep its periodic image offset',
)

const restored = workspaceFrameBondsToCrystalBonds(archived, periodicAtoms, periodicLattice)
assertEqual(restored.length, 1, 'the boundary-crossing bond must survive the round trip')
assertDeepEqual(
  restored[0]?.latticeOffset,
  [-1, 0, 0],
  'restoring an asset frame must keep the image offset, else the bond cuts through the cell',
)

console.log('batch frame persistence tests passed')
