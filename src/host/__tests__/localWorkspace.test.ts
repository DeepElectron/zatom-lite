import { assertEqual, assertTrue } from '../../testing/assert'
import type { WorkspaceFrame } from '../ports'
import {
  appendLocalWorkspaceFrame,
  createLocalWorkspaceState,
  parseLocalWorkspaceState,
  replaceLocalWorkspaceFrame,
} from '../localWorkspace'

function frame(id: string, x: number): WorkspaceFrame {
  return {
    id,
    label: id,
    createdAt: '2026-08-05T00:00:00.000Z',
    atoms: [{ element: 14, position: [x, 0, 0], selected: 0 }],
    settings: {
      stiffness: 100,
      cutoff: 2,
      forceField: 'none',
      method: 'steepest_descent',
    },
    meta: {
      eventType: 'FUNCTION_SNAPSHOT_MANUAL',
      functionId: 'test',
      runState: 'idle',
    },
  }
}

function testCanonicalStateAndFrameLifecycle() {
  const initial = createLocalWorkspaceState('2026-08-05T00:00:00.000Z')
  const workspace = initial.workspaces[0]
  const batch = workspace.batches[0]
  const appended = appendLocalWorkspaceFrame(initial, workspace.id, batch.id, frame('frame-1', 0), true)

  assertEqual(appended.workspaces[0].batches[0].activeFrameId, 'frame-1')
  assertEqual(appended.workspaces[0].assets['frame-1'].atoms[0].position[0], 0)
  assertEqual(appended.workspaces[0].frames.length, 1)
  assertEqual(appended.workspaces[0].currentIndex, 0)

  const replaced = replaceLocalWorkspaceFrame(appended, workspace.id, batch.id, 'frame-1', frame('frame-1', 2))
  assertEqual(replaced.workspaces[0].assets['frame-1'].atoms[0].position[0], 2)
  assertEqual(replaced.workspaces[0].frames[0].atoms[0].position[0], 2)
}

function testParserRejectsNonCanonicalSchema() {
  assertEqual(parseLocalWorkspaceState({ version: 0, activeWorkspaceId: null, workspaces: [] }), null)
  assertTrue(parseLocalWorkspaceState(createLocalWorkspaceState()) !== null)
}

testCanonicalStateAndFrameLifecycle()
testParserRejectsNonCanonicalSchema()
console.log('local workspace tests passed')
