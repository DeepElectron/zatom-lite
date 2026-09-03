import { assertEqual, assertTrue, assertDefined } from '../../testing/assert'
import { getActiveViewportStoreApi, useActiveCrystalStore } from '../ViewportContext'
import { useViewportManager } from '../viewportManager'

function run() {
  // getActiveViewportStoreApi returns a valid store.
  const api = getActiveViewportStoreApi()
  assertDefined(api)
  assertTrue(typeof api.getState === 'function')
  assertTrue(typeof api.setState === 'function')
  assertTrue(typeof api.subscribe === 'function')
  console.log('  ✓ getActiveViewportStoreApi returns valid store API')

  // getState returns an object with an atoms field.
  const state = api.getState()
  assertDefined(state)
  assertTrue(Array.isArray(state.atoms))
  assertTrue(typeof state.periodic === 'boolean')
  console.log('  ✓ getState returns CrystalStore state')

  // useActiveCrystalStore.getState() delegates to the active viewport.
  const proxyState = useActiveCrystalStore.getState()
  assertDefined(proxyState)
  assertTrue(Array.isArray(proxyState.atoms))
  console.log('  ✓ useActiveCrystalStore.getState() delegates correctly')

  // useActiveCrystalStore.subscribe is callable.
  let callCount = 0
  const unsub = useActiveCrystalStore.subscribe(() => { callCount++ })
  assertTrue(typeof unsub === 'function')
  unsub()
  console.log('  ✓ useActiveCrystalStore.subscribe returns unsubscribe fn')

  // After switching viewports, getActiveViewportStoreApi returns the new store.
  useViewportManager.getState().setLayout('1x2')
  useViewportManager.getState().setActive('vp-2')

  const api2 = getActiveViewportStoreApi()
  assertDefined(api2)
  const state2 = api2.getState()
  assertTrue(Array.isArray(state2.atoms))
  assertEqual(state2.atoms.length, 0)
  console.log('  ✓ after setActive(vp-2), getActiveViewportStoreApi returns vp-2 store')

  // useActiveCrystalStore.getState + setState writes to the active viewport.
  const prevPeriodic = api2.getState().periodic
  api2.setState({ periodic: !prevPeriodic })
  assertEqual(api2.getState().periodic, !prevPeriodic)
  api2.setState({ periodic: prevPeriodic })
  console.log('  ✓ active viewport store setState works correctly')

  // Restore.
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')

  console.log('viewportContext tests passed')
}

run()
