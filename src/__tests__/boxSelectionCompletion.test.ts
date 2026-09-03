import { createCrystalStore } from '../orchestration/crystalStore'
import { assertDeepEqual, assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.getState().setToolMode('select')
store.getState().setBoxSelectModeEnabled(true)
store.getState().startBoxSelection(12, 24)
store.getState().updateBoxSelection(96, 128)
store.getState().endBoxSelection()

assertEqual(store.getState().isBoxSelecting, false, 'Pointer release must finish the active drag')
assertDeepEqual(
  store.getState().boxStart,
  { x: 12, y: 24 },
  'The completed box must remain available for the final selection frame',
)
assertDeepEqual(
  store.getState().boxEnd,
  { x: 96, y: 128 },
  'The completed box endpoint must remain available for the final selection frame',
)

store.getState().setBoxSelectModeEnabled(false)

assertEqual(store.getState().boxStart, null, 'Leaving box-select mode must clear the completed box')
assertEqual(store.getState().boxEnd, null, 'Leaving box-select mode must clear the completed box endpoint')

console.log('box selection completion tests passed')
