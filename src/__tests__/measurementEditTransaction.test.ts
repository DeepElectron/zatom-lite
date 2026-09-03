import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual, assertTrue } from '../testing/assert'

const atom = (id: string, x: number) => ({
  id,
  element: id.startsWith('C') ? 'C' : 'H',
  position: [x, 0, 0] as [number, number, number],
  cartesian: [x, 0, 0] as [number, number, number],
})

const store = createCrystalStore()
store.setState({
  periodic: false,
  atoms: [atom('C-1', 0), atom('H-1', 1), atom('H-2', 2)],
  bonds: [
    { id: 'b-1', atom1Id: 'C-1', atom2Id: 'H-1', type: 'single' },
    { id: 'b-2', atom1Id: 'H-1', atom2Id: 'H-2', type: 'single' },
  ],
  measurements: [{ id: 'm-1', type: 'distance', atomIds: ['C-1', 'H-1'], value: 1 }],
})
store.getState().bindToFrame('workspace', 'batch', 'frame')

store.getState().startMeasurementEdit('m-1', [0])
assertEqual(store.getState().canUndo(), false, 'opening measurement edit must not create history')
assertEqual(store.getState().boundFrameDirty, false, 'opening measurement edit must not dirty the Asset')

store.getState().updateMeasurementEditTarget(1.5)
assertEqual(store.getState().atoms[1]?.cartesian?.[0], 1.5, 'measurement edit must preview the target distance')
assertEqual(store.getState().atoms[2]?.cartesian?.[0], 2.5, 'distance preview must move the connected fragment')
assertEqual(store.getState().boundFrameDirty, false, 'measurement preview must remain unsaved')

store.getState().cancelMeasurementEdit()
assertEqual(store.getState().atoms[1]?.cartesian?.[0], 1, 'Cancel must restore the measured atom')
assertEqual(store.getState().atoms[2]?.cartesian?.[0], 2, 'Cancel must restore every moved fragment atom')
assertEqual(store.getState().measurements[0]?.value, 1, 'Cancel must restore the measurement value')
assertEqual(store.getState().canUndo(), false, 'Cancel must not leave an Undo entry')

store.getState().startMeasurementEdit('m-1', [0])
store.getState().updateMeasurementEditTarget(1.5)
store.getState().applyMeasurementEdit()
assertTrue(store.getState().canUndo(), 'Apply must create one Undo transaction')
assertEqual(store.getState().boundFrameDirty, true, 'Apply must dirty the bound Asset')
assertEqual(store.getState().measurements[0]?.value, 1.5, 'Apply must retain the edited value')

store.getState().undo()
assertEqual(store.getState().atoms[1]?.cartesian?.[0], 1, 'Undo must restore pre-edit geometry')
assertEqual(store.getState().atoms[2]?.cartesian?.[0], 2, 'Undo must restore the connected fragment')
assertEqual(store.getState().measurements[0]?.value, 1, 'Undo must restore the measurement value with geometry')

console.log('measurement edit transaction tests passed')
