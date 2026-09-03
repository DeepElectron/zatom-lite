import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

function testHistoryMarksOnlyTheFrameThatWasActuallyEdited() {
  const store = createCrystalStore()

  store.getState().bindToFrame('workspace', 'batch-a', 'frame-a')
  store.getState().pushHistory()
  assertEqual(
    store.getState().boundFrameDirty,
    true,
    'an edit must synchronously mark its bound frame so an immediate switch cannot lose it',
  )
  store.getState().bindToFrame('workspace', 'batch-b', 'frame-b')

  assertEqual(
    store.getState().boundFrameDirty,
    false,
    'loading another frame must not inherit the previous frame dirty marker',
  )

  store.getState().pushHistory()

  assertEqual(
    store.getState().boundFrameDirty,
    true,
    'an edit must mark the still-bound frame dirty',
  )

  verifyUndoRedoDirtyState(store)
}

function verifyUndoRedoDirtyState(store: ReturnType<typeof createCrystalStore>) {
  const initialAtom = {
    id: 'C-1',
    element: 'C',
    position: [0, 0, 0] as [number, number, number],
    cartesian: [0, 0, 0] as [number, number, number],
  }
  const editedAtom = {
    ...initialAtom,
    position: [1, 0, 0] as [number, number, number],
    cartesian: [1, 0, 0] as [number, number, number],
  }

  store.setState({ atoms: [initialAtom], history: [], historyIndex: -1, boundFrameDirty: false })
  store.getState().setAtomsDirectly([editedAtom])
  store.setState({ boundFrameDirty: false }) // simulate the debounce save completing
  store.getState().undo()
  assertEqual(store.getState().boundFrameDirty, true, 'Undo must dirty the bound frame it changes')

  store.setState({ boundFrameDirty: false })
  store.getState().redo()
  assertEqual(store.getState().boundFrameDirty, true, 'Redo must dirty the bound frame it changes')
}

testHistoryMarksOnlyTheFrameThatWasActuallyEdited()
console.log('bound frame dirty tests passed')
