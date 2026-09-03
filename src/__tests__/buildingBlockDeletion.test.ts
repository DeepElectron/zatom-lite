import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

const store = createCrystalStore()
store.setState({
  buildingBlocks: [{
    id: 'block-1',
    name: 'QA Block',
    type: 'molecule',
    atoms: [],
    bonds: [],
    createdAt: 1,
  }],
  sceneObjects: [{
    id: 'object-1',
    blockId: 'block-1',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    supercell: { a: 1, b: 1, c: 1 },
  }],
})

store.getState().removeBuildingBlock('block-1')
assertEqual(store.getState().buildingBlocks.length, 0, 'deleting a block must remove the target')
assertEqual(store.getState().sceneObjects.length, 0, 'deleting a block must remove dependent scene objects')
assertEqual(store.getState().canUndoAssembly(), true, 'building block deletion must be undoable')
assertEqual(store.getState().lastHistoryDomain, 'assembly', 'Undo controls must target the Building Block deletion')

store.getState().undoAssembly()
assertEqual(store.getState().buildingBlocks.length, 1, 'Assembly Undo must restore the deleted block')
assertEqual(store.getState().sceneObjects.length, 1, 'Assembly Undo must restore dependent scene objects')
assertEqual(store.getState().canRedoAssembly(), true, 'Assembly Undo must enable Redo')

console.log('building block deletion tests passed')
