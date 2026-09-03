import 'fake-indexeddb/auto'

import { assertEqual } from '../../../testing/assert'
import { initializeAgentModelingRunHistory } from '../agent-modeling-history-db'
import { initializeAgentModelingTaskPersistence } from '../agent-modeling-task-db'
import { useAgentModelingStore } from '../agent-modeling-store'
import { useAgentModelingTaskStore } from '../agent-modeling-task-store'

// fake-indexeddb installs a global database that outlives per-file module resets.
// Delete it first so opening the legacy schema never becomes a version downgrade
// after another test has already opened the current schema.
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`))
    // deleteDatabase must never remain blocked by leaked test connections.
    // Fail explicitly rather than hanging the entire suite.
    request.onblocked = () => reject(new Error(`Delete blocked by open connection: ${name}`))
  })
}

function seedLegacyDatabase(
  name: string,
  stores: Array<{ name: string; keyPath: string; value: Record<string, unknown> }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      for (const store of stores) request.result.createObjectStore(store.name, { keyPath: store.keyPath })
    }
    request.onerror = () => reject(request.error ?? new Error(`Failed to seed ${name}`))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(stores.map((store) => store.name), 'readwrite')
      for (const store of stores) transaction.objectStore(store.name).put(store.value)
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => reject(transaction.error ?? new Error(`Failed to write ${name}`))
    }
  })
}

async function main() {
  await deleteDatabase('zatom-agent-modeling')
  await deleteDatabase('zatom-agent-modeling-task')

  await seedLegacyDatabase('zatom-agent-modeling', [
    { name: 'runs', keyPath: 'runId', value: { runId: 1, schemaVersion: 'legacy' } },
    { name: 'artifacts', keyPath: 'sha256', value: { sha256: 'legacy', json: '{}' } },
  ])
  await seedLegacyDatabase('zatom-agent-modeling-task', [
    { name: 'task', keyPath: 'key', value: { key: 'current', schemaVersion: 'legacy' } },
    { name: 'artifacts', keyPath: 'sha256', value: { sha256: 'legacy', json: '{}' } },
  ])

  await initializeAgentModelingRunHistory()
  await initializeAgentModelingTaskPersistence()
  assertEqual(useAgentModelingStore.getState().historyStatus, 'ready')
  assertEqual(useAgentModelingStore.getState().history.length, 0)
  assertEqual(useAgentModelingTaskStore.getState().persistenceStatus, 'ready')
  assertEqual(useAgentModelingTaskStore.getState().status, 'idle')
}

void main()
