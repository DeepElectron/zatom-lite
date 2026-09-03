import { createCrystalStore } from '../orchestration/crystalStore'
import { assertDeepEqual, assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.setState({
  toolMode: 'add-atom',
  boxSelectModeEnabled: true,
  pendingMeasurementAtoms: ['atom-1'],
  selectionRegionPreview: { type: 'sphere', center: [0, 0, 0], radius: 3 },
})
store.getState().setMeasurementMode('distance')

assertEqual(store.getState().toolMode, 'select', 'Measure must own the pointer interaction')
assertEqual(store.getState().boxSelectModeEnabled, false, 'Measure must exit box selection')
assertEqual(store.getState().selectionRegionPreview, null, 'Measure must clear selection geometry previews')

store.setState({ pendingMeasurementAtoms: ['atom-1'] })
store.getState().setToolMode('add-atom')

assertEqual(store.getState().measurementMode, 'none', 'Add Atom must exit Measure')
assertDeepEqual(store.getState().pendingMeasurementAtoms, [], 'Add Atom must clear pending measurement atoms')

store.getState().setMeasurementMode('angle')
store.setState({ pendingMeasurementAtoms: ['atom-1'] })
store.getState().setToolMode('select')
store.getState().setBoxSelectModeEnabled(true)

assertEqual(store.getState().measurementMode, 'none', 'Box Select must exit Measure through the Select tool')
assertEqual(store.getState().boxSelectModeEnabled, true, 'Box Select must remain enabled after the mode handoff')

store.setState({
  selectMode: 'face',
  selectedFaceIds: new Set(['face-1']),
  hoveredFaceId: 'face-1',
})
store.getState().setToolMode('delete')

assertEqual(store.getState().selectMode, 'atom', 'An editing tool must leave geometry selection mode')
assertEqual(store.getState().selectedFaceIds.size, 0, 'An editing tool must clear selected face overlays')
assertEqual(store.getState().hoveredFaceId, null, 'An editing tool must clear hovered face overlays')

console.log('tool mode exclusivity tests passed')
