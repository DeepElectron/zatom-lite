import { assertEqual } from '../testing/assert'
import { createCrystalStore } from '../orchestration/crystalStore'

function testProjectionModeCanSwitchToOrthographic() {
  const store = createCrystalStore()

  assertEqual(store.getState().cameraProjection, 'perspective')

  store.setState({
    savedCameraState: { position: [9, 8, 7], target: [1, 2, 3] },
    cameraTarget: { position: [4, 5, 6], lookAt: [1, 1, 1] },
    isAnimatingCamera: true,
    focusedAtomIds: new Set(['focused']),
    massiveSceneVisualFocusAtomIds: new Set(['focused']),
    massiveSceneVisualFocusCenter: [1, 2, 3],
    massiveSceneVisualFocusDistance: 12,
  })
  store.getState().setCameraProjection('orthographic')

  assertEqual(store.getState().cameraProjection, 'orthographic')
  assertEqual(store.getState().savedCameraState, null)
  assertEqual(store.getState().cameraTarget, null)
  assertEqual(store.getState().isAnimatingCamera, false)
  assertEqual(store.getState().focusedAtomIds.size, 0)
  assertEqual(store.getState().massiveSceneVisualFocusAtomIds.size, 0)
  assertEqual(store.getState().massiveSceneVisualFocusCenter, null)
  assertEqual(store.getState().massiveSceneVisualFocusDistance, null)
}

testProjectionModeCanSwitchToOrthographic()
console.log('view settings projection tests passed')
