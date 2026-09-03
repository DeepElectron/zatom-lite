import { listZatomAgentTools } from '../../agent/tools'
import { AgentModelingPlanError } from '../../agent/modeling-plan'
import {
  localJsonArtifactReference,
  sha256Hex,
  utf8Bytes,
  ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA,
  ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA,
  type LocalJsonArtifactReference,
  type StoredLocalJsonArtifact,
} from './agent-modeling-local-artifact'
import { useAgentModelingStore } from './agent-modeling-store'
import {
  composeAgentModelingTaskRunArtifact,
  parseAgentModelingTaskRunArtifact,
  ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES,
  type AgentModelingTaskRunArtifact,
  type AgentModelingTaskStateForArtifact,
} from './agent-modeling-task-artifact'
import {
  hydrateAgentModelingTaskRun,
  setAgentModelingTaskPersistenceState,
  useAgentModelingTaskStore,
} from './agent-modeling-task-store'

const DB_NAME = 'zatom-agent-modeling-task'
const DB_VERSION = 2
const TASK_STORE_NAME = 'task'
const ARTIFACT_STORE_NAME = 'artifacts'
const CURRENT_TASK_KEY = 'current'
const TASK_INDEX_SCHEMA = 'zatom.agent-modeling-task-index/v2'

export interface AgentModelingTaskIndex {
  key: typeof CURRENT_TASK_KEY
  schemaVersion: typeof TASK_INDEX_SCHEMA
  rootArtifact: LocalJsonArtifactReference
}

export interface AgentModelingTaskSnapshot {
  task: AgentModelingTaskIndex | null
  artifacts: StoredLocalJsonArtifact[]
}

interface AgentModelingTaskPersistenceRuntime {
  db: IDBDatabase
  writeQueue: Promise<void>
  unsubscribeTask: () => void
  unsubscribeRuns: () => void
}

let runtime: AgentModelingTaskPersistenceRuntime | null = null
let initialization: Promise<void> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function persistenceMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A task is deliberately bound to the exact tool registry that admitted it.
 * Once that registry or an input contract changes, the verified artifact is
 * obsolete rather than corrupt and must not prevent the rest of zatom opening.
 */
function isObsoleteTaskArtifact(error: unknown): boolean {
  return error instanceof AgentModelingPlanError && [
    'unsupported_agent_modeling_plan_schema',
    'agent_modeling_plan_tool_unavailable',
    'invalid_agent_modeling_plan_tool_input',
    'invalid_agent_modeling_plan_route',
  ].includes(error.code)
}

function taskStateForArtifact(): AgentModelingTaskStateForArtifact {
  const state = useAgentModelingTaskStore.getState()
  return {
    taskId: state.taskId,
    plan: state.plan,
    status: state.status,
    activeStepIndex: state.activeStepIndex,
    steps: state.steps,
    message: state.message,
  }
}

function sameTaskState(
  left: AgentModelingTaskStateForArtifact,
  right: AgentModelingTaskStateForArtifact,
): boolean {
  return left.taskId === right.taskId
    && left.plan === right.plan
    && left.status === right.status
    && left.activeStepIndex === right.activeStepIndex
    && left.steps === right.steps
    && left.message === right.message
}

export async function prepareAgentModelingTaskSnapshot(
  state: AgentModelingTaskStateForArtifact,
  history = useAgentModelingStore.getState().history,
): Promise<AgentModelingTaskSnapshot> {
  if (!state.taskId && !state.plan && state.status === 'idle') return { task: null, artifacts: [] }
  const taskRun = composeAgentModelingTaskRunArtifact(state, listZatomAgentTools(), history)
  const json = JSON.stringify(taskRun)
  const bytes = utf8Bytes(json)
  if (bytes.byteLength > ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES) {
    throw new Error(`Task run artifact is ${bytes.byteLength} bytes above limit ${ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES}`)
  }
  const stored: StoredLocalJsonArtifact = {
    schemaVersion: ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA,
    sha256: await sha256Hex(bytes),
    mediaType: 'application/json',
    bytes: bytes.byteLength,
    json,
  }
  return {
    task: {
      key: CURRENT_TASK_KEY,
      schemaVersion: TASK_INDEX_SCHEMA,
      rootArtifact: localJsonArtifactReference(stored),
    },
    artifacts: [stored],
  }
}

function openTaskDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is required for persistent Agent tasks'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
      db.createObjectStore(TASK_STORE_NAME, { keyPath: 'key' })
      db.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: 'sha256' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open persistent Agent task'))
    request.onblocked = () => reject(new Error('Persistent Agent task is blocked by another tab'))
  })
}

function assertTaskDbSchema(db: IDBDatabase): void {
  const stores = new Set(Array.from(db.objectStoreNames))
  if (stores.size !== 2 || !stores.has(TASK_STORE_NAME) || !stores.has(ARTIFACT_STORE_NAME)) {
    throw new Error('Agent task database must contain only the task and artifacts v2 stores')
  }
  const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
  const task = transaction.objectStore(TASK_STORE_NAME)
  const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
  if (task.keyPath !== 'key' || task.autoIncrement || task.indexNames.length
    || artifacts.keyPath !== 'sha256' || artifacts.autoIncrement || artifacts.indexNames.length) {
    throw new Error('Agent task database stores do not match the v2 key contracts')
  }
}

function readTaskSnapshot(db: IDBDatabase): Promise<{ tasks: unknown[]; artifacts: unknown[] }> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
    const tasks = transaction.objectStore(TASK_STORE_NAME).getAll()
    const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME).getAll()
    transaction.oncomplete = () => resolve({
      tasks: tasks.result as unknown[],
      artifacts: artifacts.result as unknown[],
    })
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to read persistent Agent task'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Persistent Agent task read was aborted'))
  })
}

function parseArtifactReference(value: unknown): LocalJsonArtifactReference {
  if (!isRecord(value) || !hasExactFields(value, ['schemaVersion', 'sha256', 'mediaType', 'bytes'])
    || value.schemaVersion !== ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)
    || value.mediaType !== 'application/json'
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1) {
    throw new Error('Persistent Agent task root reference is invalid')
  }
  return value as unknown as LocalJsonArtifactReference
}

function parseTaskIndex(value: unknown): AgentModelingTaskIndex {
  if (!isRecord(value) || !hasExactFields(value, ['key', 'schemaVersion', 'rootArtifact'])
    || value.key !== CURRENT_TASK_KEY || value.schemaVersion !== TASK_INDEX_SCHEMA) {
    throw new Error('Persistent Agent task index is invalid')
  }
  return {
    key: CURRENT_TASK_KEY,
    schemaVersion: TASK_INDEX_SCHEMA,
    rootArtifact: parseArtifactReference(value.rootArtifact),
  }
}

function parseStoredArtifact(value: unknown): StoredLocalJsonArtifact {
  if (!isRecord(value) || !hasExactFields(value, ['schemaVersion', 'sha256', 'mediaType', 'bytes', 'json'])
    || value.schemaVersion !== ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)
    || value.mediaType !== 'application/json'
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1
    || typeof value.json !== 'string') {
    throw new Error('Persistent Agent task JSON artifact is invalid')
  }
  return value as unknown as StoredLocalJsonArtifact
}

async function verifyLoadedTaskSnapshot(
  raw: { tasks: readonly unknown[]; artifacts: readonly unknown[] },
): Promise<AgentModelingTaskRunArtifact | null> {
  if (!raw.tasks.length && !raw.artifacts.length) return null
  if (raw.tasks.length !== 1 || raw.artifacts.length !== 1) {
    throw new Error('Persistent Agent task must contain exactly one index and one referenced artifact')
  }
  const task = parseTaskIndex(raw.tasks[0])
  const stored = parseStoredArtifact(raw.artifacts[0])
  if (stored.sha256 !== task.rootArtifact.sha256 || stored.mediaType !== task.rootArtifact.mediaType
    || stored.bytes !== task.rootArtifact.bytes || stored.bytes > ZATOM_AGENT_MODELING_TASK_RUN_MAX_BYTES) {
    throw new Error('Persistent Agent task artifact metadata is inconsistent')
  }
  const bytes = utf8Bytes(stored.json)
  if (bytes.byteLength !== stored.bytes || await sha256Hex(bytes) !== stored.sha256) {
    throw new Error('Persistent Agent task artifact SHA-256 does not match its stored content')
  }
  let value: unknown
  try {
    value = JSON.parse(stored.json)
  } catch {
    throw new Error('Persistent Agent task artifact is not valid JSON')
  }
  return parseAgentModelingTaskRunArtifact(
    value,
    listZatomAgentTools(),
    useAgentModelingStore.getState().history,
  )
}

function replaceTaskSnapshot(db: IDBDatabase, snapshot: AgentModelingTaskSnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TASK_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite')
    const tasks = transaction.objectStore(TASK_STORE_NAME)
    const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
    tasks.clear()
    artifacts.clear()
    for (const artifact of snapshot.artifacts) artifacts.put(artifact)
    if (snapshot.task) tasks.put(snapshot.task)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save Agent task'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Agent task save was aborted'))
  })
}

function enqueueTaskWrite(
  current: AgentModelingTaskPersistenceRuntime,
  taskState: AgentModelingTaskStateForArtifact,
  history = useAgentModelingStore.getState().history,
): void {
  setAgentModelingTaskPersistenceState('saving')
  current.writeQueue = current.writeQueue.then(async () => {
    try {
      const snapshot = await prepareAgentModelingTaskSnapshot(taskState, history)
      await replaceTaskSnapshot(current.db, snapshot)
      if (sameTaskState(taskStateForArtifact(), taskState)
        && useAgentModelingStore.getState().history === history) {
        setAgentModelingTaskPersistenceState('ready')
      }
    } catch (error) {
      if (sameTaskState(taskStateForArtifact(), taskState)) {
        setAgentModelingTaskPersistenceState(
          'error',
          `Agent task is not saved: ${persistenceMessage(error)}`,
        )
      }
    }
  })
}

/** Restore and then continuously persist the one current task after run history is ready. */
export function initializeAgentModelingTaskPersistence(): Promise<void> {
  if (runtime) return Promise.resolve()
  if (initialization) return initialization
  if (useAgentModelingStore.getState().historyStatus !== 'ready') {
    return Promise.reject(new Error('Agent run history must be verified before restoring an Agent task'))
  }
  setAgentModelingTaskPersistenceState('loading')
  initialization = (async () => {
    let db: IDBDatabase | null = null
    try {
      db = await openTaskDb()
      db.onversionchange = () => {
        db?.close()
        setAgentModelingTaskPersistenceState(
          'error',
          'Agent task is not saved: the task database version changed in another tab',
        )
      }
      assertTaskDbSchema(db)
      let artifact: AgentModelingTaskRunArtifact | null
      try {
        artifact = await verifyLoadedTaskSnapshot(await readTaskSnapshot(db))
      } catch (error) {
        if (!isObsoleteTaskArtifact(error)) throw error
        await replaceTaskSnapshot(db, { task: null, artifacts: [] })
        artifact = null
      }
      if (artifact) hydrateAgentModelingTaskRun(artifact)
      const current: AgentModelingTaskPersistenceRuntime = {
        db,
        writeQueue: Promise.resolve(),
        unsubscribeTask: () => {},
        unsubscribeRuns: () => {},
      }
      current.unsubscribeTask = useAgentModelingTaskStore.subscribe((state, previous) => {
        if (state.taskId === previous.taskId && state.plan === previous.plan
          && state.status === previous.status && state.activeStepIndex === previous.activeStepIndex
          && state.steps === previous.steps && state.message === previous.message) return
        enqueueTaskWrite(current, taskStateForArtifact())
      })
      current.unsubscribeRuns = useAgentModelingStore.subscribe((state, previous) => {
        if (state.history === previous.history || !useAgentModelingTaskStore.getState().plan) return
        enqueueTaskWrite(current, taskStateForArtifact(), state.history)
      })
      runtime = current
      setAgentModelingTaskPersistenceState('ready')
      if ((!artifact && useAgentModelingTaskStore.getState().plan)
        || (artifact && useAgentModelingTaskStore.getState().status !== artifact.status)) {
        enqueueTaskWrite(current, taskStateForArtifact())
      }
    } catch (error) {
      db?.close()
      setAgentModelingTaskPersistenceState(
        'error',
        `Cannot open persistent Agent task: ${persistenceMessage(error)}`,
      )
      throw error
    }
  })()
  return initialization
}
