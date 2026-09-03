import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.getState().addAtomToSupercell('C', [1, 2, 3])

assertEqual(store.getState().atoms.length, 1, 'Add Atom must create exactly one atom')
assertEqual(store.getState().history.length, 1, 'One Add Atom operation must create one undo step')

store.getState().undo()
assertEqual(store.getState().atoms.length, 0, 'One Undo must remove the atom added by one click')

store.getState().redo()
assertEqual(store.getState().atoms.length, 1, 'Redo must restore the atom added by the click')

console.log('add atom history tests passed')
