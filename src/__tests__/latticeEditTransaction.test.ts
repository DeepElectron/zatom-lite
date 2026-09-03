import { createCrystalStore } from '../orchestration/crystalStore'
import { calculateVolume } from '../lib/crystal/lattice'
import { assertEqual, assertTrue } from '../testing/assert'

const store = createCrystalStore()
store.getState().bindToFrame('workspace', 'batch', 'frame')

const initialParams = { ...store.getState().latticeParams }
const initialVolume = calculateVolume(store.getState().latticeVectors)

assertEqual(store.getState().setLatticeParams({ a: 0 }), false, 'zero-length lattice edits must be rejected')
assertEqual(store.getState().latticeParams.a, initialParams.a, 'an invalid edit must preserve the existing cell')
assertEqual(store.getState().canUndo(), false, 'an invalid edit must not create history')
assertEqual(store.getState().boundFrameDirty, false, 'an invalid edit must not dirty the bound Asset')

assertEqual(store.getState().setLatticeParams({ a: 5 }), true, 'a valid lattice edit must commit')
assertEqual(store.getState().latticeParams.a, 5, 'the edited lattice length must be stored')
assertEqual(store.getState().latticeParams.b, 5, 'cubic constraints must keep b equal to a')
assertEqual(store.getState().latticeParams.c, 5, 'cubic constraints must keep c equal to a')
assertTrue(store.getState().canUndo(), 'a valid lattice edit must create one Undo transaction')
assertEqual(store.getState().boundFrameDirty, true, 'a valid lattice edit must dirty the bound Asset')

store.getState().undo()
assertEqual(store.getState().latticeParams.a, initialParams.a, 'Undo must restore lattice parameters')
assertTrue(Math.abs(calculateVolume(store.getState().latticeVectors) - initialVolume) < 1e-9, 'Undo must restore lattice vectors')

store.getState().redo()
assertEqual(store.getState().latticeParams.a, 5, 'Redo must restore the edited lattice parameters')
assertTrue(Math.abs(calculateVolume(store.getState().latticeVectors) - 125) < 1e-9, 'Redo must restore the edited lattice vectors')

store.getState().resetStructureHistory()
store.setState({ boundFrameDirty: false })
store.getState().setSupercellParams({ nx: 1 })
assertEqual(store.getState().canUndo(), false, 'an unchanged supercell value must not create history')
assertEqual(store.getState().boundFrameDirty, false, 'an unchanged supercell value must not dirty the Asset')

store.getState().setSupercellParams({ nx: 2 })
assertEqual(store.getState().supercellParams.nx, 2, 'a valid supercell edit must commit')
assertTrue(store.getState().canUndo(), 'a valid supercell edit must create one Undo transaction')
store.getState().undo()
assertEqual(store.getState().supercellParams.nx, 1, 'Undo must restore supercell dimensions')

console.log('lattice edit transaction tests passed')
