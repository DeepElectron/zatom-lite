import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.getState().createScene('Scene 1')
const sceneId = store.getState().assemblyScenes[0]?.id
if (!sceneId) throw new Error('scene was not created')

assertEqual(store.getState().builderMode, 'structure', 'creating or browsing scene assets must not leave structure editing')

store.getState().enterScene(sceneId)
assertEqual(store.getState().builderMode, 'assembly', 'entering a scene must own assembly mode')

store.getState().exitScene()
assertEqual(store.getState().builderMode, 'structure', 'exiting a scene must restore structure mode')

store.getState().enterScene(sceneId)
store.getState().deleteScene(sceneId)
assertEqual(store.getState().builderMode, 'structure', 'deleting the active scene must restore structure mode')

console.log('scene mode ownership tests passed')
