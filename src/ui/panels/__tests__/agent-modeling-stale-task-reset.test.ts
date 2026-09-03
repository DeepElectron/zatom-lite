import 'fake-indexeddb/auto'

import { composeAgentModelingCapabilityRoute } from '../../../agent/modeling-routing'
import { parseAgentModelingPlan, ZATOM_AGENT_MODELING_PLAN_SCHEMA } from '../../../agent/modeling-plan'
import { listZatomAgentTools, registerZatomAgentTool } from '../../../agent/tools'
import { assertDeepEqual, assertEqual } from '../../../testing/assert'
import {
  initializeAgentModelingTaskPersistence,
  prepareAgentModelingTaskSnapshot,
  type AgentModelingTaskSnapshot,
} from '../agent-modeling-task-db'
import { useAgentModelingStore } from '../agent-modeling-store'
import { useAgentModelingTaskStore } from '../agent-modeling-task-store'

const DB_NAME = 'zatom-agent-modeling-task'
const TASK_STORE_NAME = 'task'
const ARTIFACT_STORE_NAME = 'artifacts'

function validationPlan() {
  const manifests = listZatomAgentTools()
  const goal = 'Validate the active atomic structure.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'validate',
      objective: goal,
      requiredTags: ['validation', 'position'],
      providerPolicy: 'built-in-only',
    }],
  }, manifests)
  return parseAgentModelingPlan({
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Registry-bound validation',
    goal,
    routing: {
      route,
      selections: [{ stageId: 'validate', stepId: 'validate', source: 'built-in' }],
    },
    steps: [{ id: 'validate', tool: 'structure_validate', input: {} }],
  }, manifests)
}

function replaceSnapshot(snapshot: AgentModelingTaskSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TASK_STORE_NAME, { keyPath: 'key' })
      request.result.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: 'sha256' })
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to seed stale Agent task'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite')
      const tasks = transaction.objectStore(TASK_STORE_NAME)
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
      if (snapshot.task) tasks.put(snapshot.task)
      for (const artifact of snapshot.artifacts) artifacts.put(artifact)
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to seed stale Agent task'))
    }
  })
}

function storedCounts(): Promise<[number, number]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onerror = () => reject(request.error ?? new Error('Failed to inspect Agent task storage'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
      const tasks = transaction.objectStore(TASK_STORE_NAME).count()
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME).count()
      transaction.oncomplete = () => { db.close(); resolve([tasks.result, artifacts.result]) }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to inspect Agent task storage'))
    }
  })
}

async function main(): Promise<void> {
  useAgentModelingStore.setState({ history: [], historyStatus: 'ready' })
  const plan = validationPlan()
  await replaceSnapshot(await prepareAgentModelingTaskSnapshot({
    taskId: 'task-00000000-0000-4000-8000-000000000002',
    plan,
    status: 'ready',
    activeStepIndex: null,
    steps: [{
      id: 'validate',
      tool: 'structure_validate',
      title: 'Validate atomic structure',
      status: 'pending',
      limitationsAcknowledged: false,
    }],
    message: null,
  }, []))

  const unregister = registerZatomAgentTool({
    manifest: {
      name: 'test_registry_change',
      title: 'Test registry change',
      version: '1.0.0',
      description: 'Changes the exact registry fingerprint for stale-task recovery.',
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: false },
      effects: { structure: 'none', workspace: 'none', visual: 'none' },
      tags: ['test'],
    },
    execute: async () => ({
      ok: true,
      tool: 'test_registry_change',
      summary: 'Test registry change',
    }),
  })
  try {
    await initializeAgentModelingTaskPersistence()
  } finally {
    unregister()
  }

  assertEqual(useAgentModelingTaskStore.getState().persistenceStatus, 'ready')
  assertEqual(useAgentModelingTaskStore.getState().status, 'idle')
  assertDeepEqual(await storedCounts(), [0, 0])
  console.log('stale Agent task reset tests passed')
}

void main()
