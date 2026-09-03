import { createCrystalStore } from '../orchestration/crystalStore'
import { assertDeepEqual, assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.getState().selectAtoms(['atom-1', 'atom-2'])
const firstSelection = store.getState().selectedAtomIds

store.getState().selectAtoms(['atom-1', 'atom-2'])
assertEqual(
  store.getState().selectedAtomIds,
  firstSelection,
  'Repeating an unchanged live box selection must not publish redundant state',
)

store.getState().clearSelection()
store.getState().selectAtoms(['atom-1', 'atom-2'])
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-1', 'atom-2'],
  'A box selection must be committed again after another tool clears it',
)

store.getState().clearSelection()
store.getState().selectAtom('atom-1')
store.getState().selectAtom('atom-1')
assertEqual(
  store.getState().selectedAtomIds.size,
  0,
  'Clicking the only selected atom again must deselect it',
)

store.getState().selectAtom('atom-1')
store.getState().selectAtom('atom-2', true)
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-1', 'atom-2'],
  'Shift-click must add another atom to the live selection',
)

store.getState().selectAtom('atom-1', true)
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-2'],
  'Shift-clicking an already selected atom must remove only that atom',
)

store.getState().clearSelection()
store.getState().setStickyMultiSelect(true)
store.getState().selectAtom('atom-1')
store.getState().selectAtom('atom-2')
store.getState().selectAtom('atom-3')
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-1', 'atom-2', 'atom-3'],
  'Sticky multi-select must accumulate plain clicks so 3 atoms can be picked for a plane',
)

store.getState().selectAtom('atom-2')
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-1', 'atom-3'],
  'Clicking a picked atom again in sticky mode must remove only that atom',
)

store.getState().setStickyMultiSelect(false)
store.getState().selectAtom('atom-1')
assertDeepEqual(
  Array.from(store.getState().selectedAtomIds),
  ['atom-1'],
  'Leaving sticky mode must restore single-select clicks',
)

for (const [label, select, selected] of [
  ['edge', store.getState().selectEdge, () => store.getState().selectedEdgeIds],
  ['face', store.getState().selectFace, () => store.getState().selectedFaceIds],
  ['bond', store.getState().selectBond, () => store.getState().selectedBondIds],
] as const) {
  select(`${label}-1`)
  select(`${label}-1`)
  assertEqual(selected().size, 0, `Clicking the selected ${label} again must deselect it`)
}

console.log('selection deduplication tests passed')
