import type { AgentModelingRunArtifact, AgentModelingRunRecord } from './agent-modeling-store'
import {
  composeAgentModelingDependencyGraph,
  parseAgentModelingDependencyGraph,
} from './agent-modeling-provenance'
import {
  AGENT_MODELING_RUN_HISTORY_LIMIT,
  AgentModelingRunArtifactError,
  composeAgentModelingRunArtifact,
  hydrateAgentModelingRunHistory,
  parseAgentModelingRunArtifact,
  setAgentModelingHistoryPersistenceState,
  useAgentModelingStore,
} from './agent-modeling-store'
import {
  localJsonArtifactReference,
  sha256Hex,
  utf8Bytes,
  ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA,
  ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA,
  type LocalJsonArtifactReference,
  type StoredLocalJsonArtifact,
} from './agent-modeling-local-artifact'

const DB_NAME = 'zatom-agent-modeling'
const DB_VERSION = 2
const RUN_STORE_NAME = 'runs'
const ARTIFACT_STORE_NAME = 'artifacts'
const RUN_INDEX_SCHEMA = 'zatom.agent-modeling-run-index/v2'

export const MAX_PERSISTED_AGENT_MODELING_RUNS = AGENT_MODELING_RUN_HISTORY_LIMIT
export const MAX_PERSISTED_AGENT_MODELING_RUN_BYTES = 32 * 1024 * 1024
export const MAX_PERSISTED_AGENT_MODELING_GRAPH_BYTES = 1024 * 1024
export const MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES = 128 * 1024 * 1024

export type { LocalJsonArtifactReference, StoredLocalJsonArtifact } from './agent-modeling-local-artifact'

export interface AgentModelingRunIndex {
  schemaVersion: typeof RUN_INDEX_SCHEMA
  runId: number
  rootArtifact: LocalJsonArtifactReference
  dependencyGraphArtifact: LocalJsonArtifactReference
}

export interface AgentModelingHistorySnapshot {
  runs: AgentModelingRunIndex[]
  artifacts: StoredLocalJsonArtifact[]
}

interface AgentModelingHistoryRuntime {
  db: IDBDatabase
  writeQueue: Promise<void>
  unsubscribe: () => void
}

let runtime: AgentModelingHistoryRuntime | null = null
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

async function storeJsonArtifact(
  value: unknown,
  maximumBytes: number,
  label: string,
): Promise<StoredLocalJsonArtifact> {
  const json = JSON.stringify(value)
  const bytes = utf8Bytes(json)
  if (bytes.byteLength > maximumBytes) {
    throw new AgentModelingRunArtifactError(
      'agent_run_artifact_too_large',
      `${label} is ${bytes.byteLength} bytes above limit ${maximumBytes}`,
    )
  }
  return {
    schemaVersion: ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA,
    sha256: await sha256Hex(bytes),
    mediaType: 'application/json',
    bytes: bytes.byteLength,
    json,
  }
}

/** Compose the complete content-addressed snapshot written by the browser boundary. */
export async function prepareAgentModelingHistorySnapshot(
  history: readonly AgentModelingRunRecord[],
): Promise<AgentModelingHistorySnapshot> {
  const completed = history.filter((record) => record.completedRun !== null)
  if (completed.length > MAX_PERSISTED_AGENT_MODELING_RUNS) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Agent run history contains ${completed.length} complete records above limit ${MAX_PERSISTED_AGENT_MODELING_RUNS}`,
    )
  }
  const runIds = completed.map((record) => record.id)
  if (new Set(runIds).size !== runIds.length) {
    throw new AgentModelingRunArtifactError(
      'duplicate_agent_run_id',
      'Agent run history contains duplicate run IDs',
    )
  }

  const artifacts = new Map<string, StoredLocalJsonArtifact>()
  const runs: AgentModelingRunIndex[] = []
  for (const record of completed) {
    if (record.completedRun!.id !== record.id) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_run_artifact',
        `Run record ${record.id} owns completed run ${record.completedRun!.id}`,
      )
    }
    const runArtifact = parseAgentModelingRunArtifact(
      composeAgentModelingRunArtifact(record.completedRun!),
    )
    const root = await storeJsonArtifact(
      runArtifact,
      MAX_PERSISTED_AGENT_MODELING_RUN_BYTES,
      `Run ${record.id} root artifact`,
    )
    const graph = await storeJsonArtifact(
      parseAgentModelingDependencyGraph(composeAgentModelingDependencyGraph(runArtifact)),
      MAX_PERSISTED_AGENT_MODELING_GRAPH_BYTES,
      `Run ${record.id} dependency graph`,
    )
    artifacts.set(root.sha256, root)
    artifacts.set(graph.sha256, graph)
    runs.push({
      schemaVersion: RUN_INDEX_SCHEMA,
      runId: record.id,
      rootArtifact: localJsonArtifactReference(root),
      dependencyGraphArtifact: localJsonArtifactReference(graph),
    })
  }
  const uniqueArtifacts = [...artifacts.values()]
  const totalBytes = uniqueArtifacts.reduce((total, artifact) => total + artifact.bytes, 0)
  if (totalBytes > MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Agent run artifacts use ${totalBytes} unique bytes above limit ${MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES}`,
    )
  }
  return { runs, artifacts: uniqueArtifacts }
}

function openHistoryDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is required for persistent Agent modeling history'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of Array.from(db.objectStoreNames)) db.deleteObjectStore(name)
      db.createObjectStore(RUN_STORE_NAME, { keyPath: 'runId' })
      db.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: 'sha256' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open Agent modeling history'))
    request.onblocked = () => reject(new Error('Agent modeling history is blocked by another tab'))
  })
}

function assertHistoryDbSchema(db: IDBDatabase): void {
  const stores = new Set(Array.from(db.objectStoreNames))
  if (stores.size !== 2 || !stores.has(RUN_STORE_NAME) || !stores.has(ARTIFACT_STORE_NAME)) {
    throw new Error('Agent modeling history must contain only the runs and artifacts v2 stores')
  }
  const transaction = db.transaction([RUN_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
  const runs = transaction.objectStore(RUN_STORE_NAME)
  const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
  if (runs.keyPath !== 'runId' || runs.autoIncrement || runs.indexNames.length
    || artifacts.keyPath !== 'sha256' || artifacts.autoIncrement || artifacts.indexNames.length) {
    throw new Error('Agent modeling history stores do not match the v2 key contracts')
  }
}

function readHistorySnapshot(db: IDBDatabase): Promise<{ runs: unknown[]; artifacts: unknown[] }> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RUN_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
    const runsRequest = transaction.objectStore(RUN_STORE_NAME).getAll()
    const artifactsRequest = transaction.objectStore(ARTIFACT_STORE_NAME).getAll()
    transaction.oncomplete = () => resolve({
      runs: runsRequest.result as unknown[],
      artifacts: artifactsRequest.result as unknown[],
    })
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to read Agent modeling history'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Agent modeling history read was aborted'))
  })
}

function parseArtifactReference(value: unknown, field: string): LocalJsonArtifactReference {
  if (!isRecord(value) || !hasExactFields(value, ['schemaVersion', 'sha256', 'mediaType', 'bytes'])
    || value.schemaVersion !== ZATOM_LOCAL_ARTIFACT_REFERENCE_SCHEMA
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)
    || value.mediaType !== 'application/json'
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', `${field} is invalid`)
  }
  return value as unknown as LocalJsonArtifactReference
}

function parseRunIndex(value: unknown): AgentModelingRunIndex {
  if (!isRecord(value) || !hasExactFields(value, [
    'schemaVersion', 'runId', 'rootArtifact', 'dependencyGraphArtifact',
  ])
    || value.schemaVersion !== RUN_INDEX_SCHEMA
    || !Number.isSafeInteger(value.runId) || Number(value.runId) < 1) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'Persistent run index is invalid')
  }
  return {
    schemaVersion: RUN_INDEX_SCHEMA,
    runId: Number(value.runId),
    rootArtifact: parseArtifactReference(value.rootArtifact, `run ${String(value.runId)} rootArtifact`),
    dependencyGraphArtifact: parseArtifactReference(
      value.dependencyGraphArtifact,
      `run ${String(value.runId)} dependencyGraphArtifact`,
    ),
  }
}

function parseStoredArtifact(value: unknown): StoredLocalJsonArtifact {
  if (!isRecord(value) || !hasExactFields(value, ['schemaVersion', 'sha256', 'mediaType', 'bytes', 'json'])
    || value.schemaVersion !== ZATOM_LOCAL_JSON_ARTIFACT_SCHEMA
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)
    || value.mediaType !== 'application/json'
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1
    || typeof value.json !== 'string') {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'Persistent JSON artifact is invalid')
  }
  return value as unknown as StoredLocalJsonArtifact
}

async function resolveStoredJsonArtifact(
  artifactsByDigest: ReadonlyMap<string, StoredLocalJsonArtifact>,
  reference: LocalJsonArtifactReference,
  maximumBytes: number,
  label: string,
): Promise<unknown> {
  const stored = artifactsByDigest.get(reference.sha256)
  if (!stored) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `${label} ${reference.sha256} is missing`,
    )
  }
  const bytes = utf8Bytes(stored.json)
  if (bytes.byteLength !== stored.bytes || stored.bytes !== reference.bytes
    || stored.mediaType !== reference.mediaType || stored.bytes > maximumBytes) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `${label} metadata is inconsistent`,
    )
  }
  const digest = await sha256Hex(bytes)
  if (digest !== stored.sha256) {
    throw new AgentModelingRunArtifactError(
      'agent_run_artifact_sha256_mismatch',
      `${label} SHA-256 ${stored.sha256} does not match ${digest}`,
    )
  }
  try {
    return JSON.parse(stored.json)
  } catch {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `${label} is not valid JSON`,
    )
  }
}

async function verifyLoadedHistorySnapshot(
  raw: { runs: readonly unknown[]; artifacts: readonly unknown[] },
): Promise<AgentModelingRunArtifact[]> {
  if (raw.runs.length > MAX_PERSISTED_AGENT_MODELING_RUNS) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Persistent Agent run history contains ${raw.runs.length} records above limit ${MAX_PERSISTED_AGENT_MODELING_RUNS}`,
    )
  }
  const runs = raw.runs.map(parseRunIndex)
  const runIds = runs.map((run) => run.runId)
  if (new Set(runIds).size !== runIds.length) {
    throw new AgentModelingRunArtifactError('duplicate_agent_run_id', 'Persistent run indexes contain duplicate IDs')
  }
  const storedArtifacts = raw.artifacts.map(parseStoredArtifact)
  const artifactsByDigest = new Map(storedArtifacts.map((artifact) => [artifact.sha256, artifact]))
  if (artifactsByDigest.size !== storedArtifacts.length) {
    throw new AgentModelingRunArtifactError('invalid_agent_run_artifact', 'Persistent artifacts contain duplicate digests')
  }
  const referencedDigests = new Set(runs.flatMap((run) => [
    run.rootArtifact.sha256,
    run.dependencyGraphArtifact.sha256,
  ]))
  const unreferenced = storedArtifacts.filter((artifact) => !referencedDigests.has(artifact.sha256))
  if (unreferenced.length) {
    throw new AgentModelingRunArtifactError(
      'invalid_agent_run_artifact',
      `Persistent history contains ${unreferenced.length} unreferenced artifacts`,
    )
  }
  const totalBytes = storedArtifacts.reduce((total, artifact) => total + artifact.bytes, 0)
  if (totalBytes > MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES) {
    throw new AgentModelingRunArtifactError(
      'agent_run_history_too_large',
      `Persistent Agent run artifacts use ${totalBytes} bytes above limit ${MAX_PERSISTED_AGENT_MODELING_HISTORY_BYTES}`,
    )
  }

  const result: AgentModelingRunArtifact[] = []
  for (const run of runs) {
    const artifact = parseAgentModelingRunArtifact(await resolveStoredJsonArtifact(
      artifactsByDigest,
      run.rootArtifact,
      MAX_PERSISTED_AGENT_MODELING_RUN_BYTES,
      `Run ${run.runId} root artifact`,
    ))
    if (artifact.runId !== run.runId) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_run_artifact',
        `Run index ${run.runId} resolves artifact ${artifact.runId}`,
      )
    }
    const graph = parseAgentModelingDependencyGraph(await resolveStoredJsonArtifact(
      artifactsByDigest,
      run.dependencyGraphArtifact,
      MAX_PERSISTED_AGENT_MODELING_GRAPH_BYTES,
      `Run ${run.runId} dependency graph`,
    ))
    const expectedGraph = composeAgentModelingDependencyGraph(artifact)
    if (graph.runId !== run.runId || graph.runFingerprint !== artifact.fingerprint
      || graph.fingerprint !== expectedGraph.fingerprint) {
      throw new AgentModelingRunArtifactError(
        'invalid_agent_dependency_graph',
        `Run ${run.runId} dependency graph does not replay from its exact root artifact`,
      )
    }
    result.push(artifact)
  }
  return result
}

function replaceHistorySnapshot(db: IDBDatabase, snapshot: AgentModelingHistorySnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RUN_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite')
    const runs = transaction.objectStore(RUN_STORE_NAME)
    const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
    runs.clear()
    artifacts.clear()
    for (const artifact of snapshot.artifacts) artifacts.put(artifact)
    for (const run of snapshot.runs) runs.put(run)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save Agent modeling history'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Agent modeling history save was aborted'))
  })
}

function enqueueHistoryWrite(
  current: AgentModelingHistoryRuntime,
  history: readonly AgentModelingRunRecord[],
): void {
  setAgentModelingHistoryPersistenceState('saving')
  current.writeQueue = current.writeQueue.then(async () => {
    try {
      const snapshot = await prepareAgentModelingHistorySnapshot(history)
      await replaceHistorySnapshot(current.db, snapshot)
      if (useAgentModelingStore.getState().history === history) {
        setAgentModelingHistoryPersistenceState('ready')
      }
    } catch (error) {
      if (useAgentModelingStore.getState().history === history) {
        setAgentModelingHistoryPersistenceState(
          'error',
          `Modeling runs are not saved: ${persistenceMessage(error)}`,
        )
      }
    }
  })
}

/** Open and verify the canonical browser-local run/artifact stores before Workbench use. */
export function initializeAgentModelingRunHistory(): Promise<void> {
  if (runtime) return Promise.resolve()
  if (initialization) return initialization
  setAgentModelingHistoryPersistenceState('loading')
  initialization = (async () => {
    let db: IDBDatabase | null = null
    try {
      db = await openHistoryDb()
      db.onversionchange = () => {
        db?.close()
        setAgentModelingHistoryPersistenceState(
          'error',
          'Modeling runs are not saved: the history database version changed in another tab',
        )
      }
      assertHistoryDbSchema(db)
      const artifacts = await verifyLoadedHistorySnapshot(await readHistorySnapshot(db))
      hydrateAgentModelingRunHistory(artifacts)
      const current: AgentModelingHistoryRuntime = {
        db,
        writeQueue: Promise.resolve(),
        unsubscribe: () => {},
      }
      current.unsubscribe = useAgentModelingStore.subscribe((state, previous) => {
        if (state.history === previous.history) return
        enqueueHistoryWrite(current, state.history)
      })
      runtime = current
    } catch (error) {
      db?.close()
      setAgentModelingHistoryPersistenceState(
        'error',
        `Cannot open modeling run history: ${persistenceMessage(error)}`,
      )
      throw error
    }
  })()
  return initialization
}
