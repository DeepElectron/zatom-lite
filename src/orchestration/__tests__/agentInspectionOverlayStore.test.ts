import { assertEqual, assertTrue } from '../../testing/assert'
import type { InspectionTarget } from '../../agent/contracts'
import { useAgentInspectionOverlayStore } from '../agentInspectionOverlayStore'

const target: InspectionTarget = {
  id: 'closest-contact',
  reason: 'Inspect the closest pair',
  center: [1, 2, 3],
  radius: 1.5,
  atomIds: ['a', 'b'],
}

interface FakeState {
  atoms: object
  unitCellAtoms: object
  bonds: object
  latticeVectors: object
  supercellParams: object
  periodic: boolean
  compactStructure: null
  trajectoryCurrentFrame: number
}

function fakeViewport() {
  let state: FakeState = {
    atoms: {},
    unitCellAtoms: {},
    bonds: {},
    latticeVectors: {},
    supercellParams: {},
    periodic: false,
    compactStructure: null,
    trajectoryCurrentFrame: 0,
  }
  const listeners = new Set<(next: FakeState, previous: FakeState) => void>()
  return {
    getState: () => state,
    subscribe: (listener: (next: FakeState, previous: FakeState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update: (patch: Partial<FakeState>) => {
      const previous = state
      state = { ...state, ...patch }
      for (const listener of listeners) listener(state, previous)
    },
    listenerCount: () => listeners.size,
  }
}

function run() {
  const viewport = fakeViewport()
  const store = useAgentInspectionOverlayStore.getState()
  store.setOverlay(viewport, { target })
  const stored = useAgentInspectionOverlayStore.getState().byViewport.get(viewport)
  assertEqual(stored?.target.id, target.id)
  assertTrue(stored?.target.center !== target.center)
  assertEqual(viewport.listenerCount(), 1)

  // Camera/focus-only state is intentionally outside the structural subscription.
  viewport.update({})
  assertTrue(useAgentInspectionOverlayStore.getState().byViewport.has(viewport))

  viewport.update({ atoms: {} })
  assertTrue(!useAgentInspectionOverlayStore.getState().byViewport.has(viewport))
  assertEqual(viewport.listenerCount(), 0)
  console.log('agent inspection overlay identity tests passed')
}

run()
