import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

const store = createCrystalStore()
const initialAtom = {
  id: 'C-1',
  element: 'C',
  position: [0, 0, 0] as [number, number, number],
  cartesian: [0, 0, 0] as [number, number, number],
}
const optimizedAtom = {
  ...initialAtom,
  position: [0.25, 0, 0] as [number, number, number],
  cartesian: [0.25, 0, 0] as [number, number, number],
}

store.setState({ atoms: [initialAtom], history: [], historyIndex: -1 })
store.getState().setAtomsDirectly([optimizedAtom])

assertEqual(store.getState().canUndo(), true, 'a direct coordinate edit must enable Undo')
store.getState().undo()
assertEqual(store.getState().atoms[0]?.cartesian?.[0], 0, 'Undo must restore pre-edit coordinates')
assertEqual(store.getState().canRedo(), true, 'Undo must immediately enable Redo')
store.getState().redo()
assertEqual(store.getState().atoms[0]?.cartesian?.[0], 0.25, 'Redo must restore edited coordinates')

store.getState().resetStructureHistory()
assertEqual(store.getState().canUndo(), false, 'a newly loaded Asset must not inherit another Asset history')
assertEqual(store.getState().canRedo(), false, 'a newly loaded Asset must not inherit another Asset redo state')

store.getState().createScene('Scene')
const sceneId = store.getState().assemblyScenes[0]?.id
if (!sceneId) throw new Error('scene was not created')
store.getState().enterScene(sceneId)
store.getState().pushAssemblyHistory()
assertEqual(store.getState().canUndoAssembly(), true, 'scene edit history must enable Assembly Undo')
store.getState().undoAssembly()
assertEqual(store.getState().canRedoAssembly(), true, 'Assembly Undo must immediately enable Assembly Redo')

console.log('history control tests passed')
