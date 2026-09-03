import { assertEqual } from '../../testing/assert'
import { useModelerBridge } from '../modelerBridge'

function testQueuedStructureLoading() {
  const bridge = useModelerBridge.getState()
  let switched = false
  bridge.setSwitchToModeler(() => { switched = true })
  bridge.loadFileInModeler('structure.xyz', '2\nfixture', 'xyz')

  assertEqual(switched, true)
  assertEqual(useModelerBridge.getState().consumePendingFile()?.name, 'structure.xyz')
  assertEqual(useModelerBridge.getState().consumePendingFile(), null)
}

function testQueuedMultiStructureLayout() {
  const files = Array.from({ length: 5 }, (_, index) => ({
    name: `structure-${index + 1}.xyz`,
    content: '0\nfixture',
    format: 'xyz' as const,
  }))
  useModelerBridge.getState().loadMultipleInModeler(files)

  const queued = useModelerBridge.getState().consumePendingMulti()
  assertEqual(queued?.layout, '2x3')
  assertEqual(queued?.files.length, 5)
  assertEqual(useModelerBridge.getState().consumePendingMulti(), null)
}

function testStructureSnapshotRegistration() {
  useModelerBridge.getState().setGetStructureSnapshot(() => ({
    atoms: [{ element: 6, position: [1, 2, 3] }],
    label: 'snapshot',
  }))

  const snapshot = useModelerBridge.getState().getStructureSnapshot?.()
  assertEqual(snapshot?.atoms[0]?.element, 6)
  assertEqual(snapshot?.label, 'snapshot')
}

testQueuedStructureLoading()
testQueuedMultiStructureLayout()
testStructureSnapshotRegistration()
console.log('modeler bridge tests passed')
