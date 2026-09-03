import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { assertEqual, assertTrue } from '../../../testing/assert'
import { parseAgentModelingPlan, ZATOM_AGENT_MODELING_PLAN_SCHEMA } from '../../../agent/modeling-plan'
import { composeAgentModelingCapabilityRoute } from '../../../agent/modeling-routing'
import { listZatomAgentTools } from '../../../agent/tools'
import {
  initializeAgentModelingTaskPersistence,
  prepareAgentModelingTaskSnapshot,
  type AgentModelingTaskSnapshot,
} from '../agent-modeling-task-db'
import type { StoredLocalJsonArtifact } from '../agent-modeling-local-artifact'
import { useAgentModelingStore } from '../agent-modeling-store'
import { useAgentModelingTaskStore } from '../agent-modeling-task-store'

const DB_NAME = 'zatom-agent-modeling-task'
const TASK_STORE_NAME = 'task'
const ARTIFACT_STORE_NAME = 'artifacts'

function validationPlan() {
  const manifests = listZatomAgentTools()
  const goal = 'Prove that an in-flight task is never silently resumed after restart.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'validate',
      objective: 'Validate the active structure.',
      requiredTags: ['validation', 'position'],
      providerPolicy: 'built-in-only',
    }],
  }, manifests)
  return parseAgentModelingPlan({
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Interrupted local validation',
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
    request.onerror = () => reject(request.error ?? new Error('Failed to seed Agent task'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite')
      const tasks = transaction.objectStore(TASK_STORE_NAME)
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
      tasks.clear()
      artifacts.clear()
      if (snapshot.task) tasks.put(snapshot.task)
      for (const artifact of snapshot.artifacts) artifacts.put(artifact)
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to seed Agent task'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Agent task seed was aborted'))
    }
  })
}

function readSnapshot(): Promise<{ tasks: unknown[]; artifacts: StoredLocalJsonArtifact[] }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onerror = () => reject(request.error ?? new Error('Failed to inspect Agent task'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
      const tasks = transaction.objectStore(TASK_STORE_NAME).getAll()
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME).getAll()
      transaction.oncomplete = () => {
        db.close()
        resolve({ tasks: tasks.result as unknown[], artifacts: artifacts.result as StoredLocalJsonArtifact[] })
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to inspect Agent task'))
    }
  })
}

async function waitForStatus(expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await readSnapshot()
    if (!snapshot.artifacts.length && expected === 'empty') return
    if (snapshot.artifacts.length === 1
      && (JSON.parse(snapshot.artifacts[0].json) as { status?: string }).status === expected) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Persistent Agent task did not reach ${expected}`)
}

async function main(): Promise<void> {
  useAgentModelingStore.setState({
    status: 'idle',
    runningTool: null,
    current: null,
    history: [],
    historyStatus: 'ready',
    historyPersistenceError: null,
  })
  const plan = validationPlan()
  const seeded = await prepareAgentModelingTaskSnapshot({
    taskId: 'task-00000000-0000-4000-8000-000000000001',
    plan,
    status: 'running',
    activeStepIndex: 0,
    steps: [{
      id: 'validate',
      tool: 'structure_validate',
      title: 'Validate atomic structure',
      status: 'running',
      limitationsAcknowledged: false,
    }],
    message: 'Running Validate atomic structure',
  }, [])
  assertEqual(seeded.artifacts.length, 1)
  assertEqual(
    seeded.artifacts[0].sha256,
    createHash('sha256').update(seeded.artifacts[0].json, 'utf8').digest('hex'),
  )
  await replaceSnapshot(seeded)

  await initializeAgentModelingTaskPersistence()
  assertEqual(useAgentModelingTaskStore.getState().status, 'blocked')
  assertEqual(useAgentModelingTaskStore.getState().steps[0]?.status, 'blocked')
  assertTrue(useAgentModelingTaskStore.getState().message?.includes('was not resumed') === true)
  await waitForStatus('blocked')

  useAgentModelingTaskStore.getState().clearTask()
  await waitForStatus('empty')
  assertEqual(useAgentModelingTaskStore.getState().status, 'idle')
  console.log('agent modeling task IndexedDB recovery tests passed')
}

void main()
