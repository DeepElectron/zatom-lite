import 'fake-indexeddb/auto'

import { createHash } from 'node:crypto'

import { assertEqual, assertTrue } from '../../../testing/assert'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../../../agent/contracts'
import { fingerprintCanonicalJson, fingerprintStructure } from '../../../agent/structure-math'
import { listZatomAgentTools } from '../../../agent/tools'
import {
  initializeAgentModelingRunHistory,
  prepareAgentModelingHistorySnapshot,
  type AgentModelingHistorySnapshot,
  type StoredLocalJsonArtifact,
} from '../agent-modeling-history-db'
import {
  composeAgentModelingHistoryBundle,
  parseAgentModelingHistoryBundle,
} from '../agent-modeling-history-bundle'
import {
  parseAgentModelingRunArtifact,
  replaceAgentModelingRunHistory,
  type AgentModelingCompletedRun,
  type AgentModelingRunRecord,
  useAgentModelingStore,
} from '../agent-modeling-store'
import {
  parseAgentModelingDependencyGraph,
  type AgentModelingDependencyGraph,
} from '../agent-modeling-provenance'

const DB_NAME = 'zatom-agent-modeling'
const RUN_STORE_NAME = 'runs'
const ARTIFACT_STORE_NAME = 'artifacts'

function seedSnapshot(snapshot: AgentModelingHistorySnapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(RUN_STORE_NAME, { keyPath: 'runId' })
      request.result.createObjectStore(ARTIFACT_STORE_NAME, { keyPath: 'sha256' })
    }
    request.onerror = () => reject(request.error ?? new Error('Failed to seed run history'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([RUN_STORE_NAME, ARTIFACT_STORE_NAME], 'readwrite')
      const runs = transaction.objectStore(RUN_STORE_NAME)
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME)
      for (const run of snapshot.runs) runs.put(run)
      for (const artifact of snapshot.artifacts) artifacts.put(artifact)
      transaction.oncomplete = () => {
        db.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to seed run history'))
      transaction.onabort = () => reject(transaction.error ?? new Error('Run history seed was aborted'))
    }
  })
}

function readSnapshot(): Promise<{ runs: unknown[]; artifacts: unknown[] }> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onerror = () => reject(request.error ?? new Error('Failed to inspect run history'))
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction([RUN_STORE_NAME, ARTIFACT_STORE_NAME], 'readonly')
      const runs = transaction.objectStore(RUN_STORE_NAME).getAll()
      const artifacts = transaction.objectStore(ARTIFACT_STORE_NAME).getAll()
      transaction.oncomplete = () => {
        db.close()
        resolve({ runs: runs.result as unknown[], artifacts: artifacts.result as unknown[] })
      }
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to inspect run history'))
    }
  })
}

async function waitForRunCount(expected: number): Promise<{ runs: unknown[]; artifacts: unknown[] }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const snapshot = await readSnapshot()
    if (snapshot.runs.length === expected && snapshot.artifacts.length === expected * 2) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Persistent run history did not reach ${expected} root references and artifacts`)
}

async function main() {
  const manifest = listZatomAgentTools().find((tool) => tool.name === 'modeling_run_provider')!
  const sourceStructure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'source', element: 'C', position: [0, 0, 0] }],
  }
  const resultStructure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'result', element: 'N', position: [0, 0, 0] }],
  }
  const candidateChecks = [{ id: 'fixture', status: 'pass' as const, message: 'Fixture passed' }]
  const restoredRun: AgentModelingCompletedRun = {
    id: 41,
    manifest,
    input: { fixture: 'reload' },
    result: {
      ok: true,
      tool: manifest.name,
      summary: 'Persisted validation fixture',
      checks: candidateChecks,
      data: {
        result: {
          structure: resultStructure,
          checks: candidateChecks,
          provenance: {
            engine: 'fixture-engine',
            engineVersion: '1.0.0',
            sourceFingerprint: fingerprintStructure(sourceStructure),
            sourceTrajectoryFingerprint: 'fnv1a64:fixture-parent-trajectory',
            sourceTrajectoryFrameIndex: 3,
            resultFingerprint: fingerprintStructure(resultStructure),
            inputChemicalStateEnsembleFingerprint: 'fnv1a64:fixture-input-state',
            forceFieldPackageFingerprint: 'fnv1a64:fixture-output-force-field',
            parameters: {},
          },
          provider: {
            id: 'fixture.provider',
            title: 'Fixture provider',
            adapterVersion: '1.0.0',
            engine: { name: 'fixture-engine', version: '1.0.0' },
            capability: 'fixture.capability',
            fidelity: 'engine-native',
            execution: 'browser',
          },
        },
        appliedToWorkspace: false,
        applicationBlocked: false,
        applicationVerified: null,
        visualEvidence: null,
      },
    },
    candidate: { kind: 'structure', structure: resultStructure, checks: candidateChecks },
    application: null,
    startedAt: Date.parse('2026-08-05T12:00:00.000Z'),
    durationMs: 12,
    origin: {
      viewportId: 'viewport-persisted',
      structureFingerprint: fingerprintStructure(sourceStructure),
      trajectoryFingerprint: null,
    },
    workspaceRevision: null,
    targetEvidenceBundle: [],
  }
  const restoredRecord: AgentModelingRunRecord = {
    id: restoredRun.id,
    tool: manifest.name,
    title: manifest.title,
    summary: restoredRun.result.summary,
    status: 'success',
    startedAt: restoredRun.startedAt,
    durationMs: restoredRun.durationMs,
    checks: { pass: 1, warn: 0, fail: 0, skipped: 0 },
    completedRun: restoredRun,
  }
  const portable = composeAgentModelingHistoryBundle([restoredRecord])
  assertEqual(parseAgentModelingHistoryBundle(portable).runs[0]?.runId, 41)
  const driftedRun = { ...portable.runs[0]!, durationMs: portable.runs[0]!.durationMs + 1 }
  const driftedPayload = { schemaVersion: portable.schemaVersion, runs: [driftedRun] }
  let nestedFingerprintRejected = false
  try {
    parseAgentModelingHistoryBundle({
      ...driftedPayload,
      fingerprint: fingerprintCanonicalJson(driftedPayload),
    })
  } catch {
    nestedFingerprintRejected = true
  }
  assertTrue(nestedFingerprintRejected)

  const seeded = await prepareAgentModelingHistorySnapshot([restoredRecord])
  assertEqual(
    seeded.artifacts[0]?.sha256,
    createHash('sha256').update(seeded.artifacts[0]!.json, 'utf8').digest('hex'),
  )
  const seededByDigest = new Map(seeded.artifacts.map((artifact) => [artifact.sha256, artifact]))
  const seededIndex = seeded.runs[0]!
  const seededGraph = parseAgentModelingDependencyGraph(JSON.parse(
    seededByDigest.get(seededIndex.dependencyGraphArtifact.sha256)!.json,
  ))
  assertTrue(seededGraph.edges.some((edge) => edge.relation === 'continued-from'))
  assertTrue(seededGraph.edges.some((edge) => edge.relation === 'executed-by'))
  assertTrue(seededGraph.edges.some((edge) => edge.relation === 'consumed'))
  assertTrue(seededGraph.edges.some((edge) => edge.relation === 'produced'))
  const { fingerprint: _fingerprint, ...cyclicPayload } = seededGraph
  const cyclicGraph: AgentModelingDependencyGraph = {
    ...cyclicPayload,
    edges: [...seededGraph.edges, { from: 'result-structure', to: 'run', relation: 'source' }],
    fingerprint: '',
  }
  const { fingerprint: _empty, ...cyclicFingerprintPayload } = cyclicGraph
  cyclicGraph.fingerprint = fingerprintCanonicalJson(cyclicFingerprintPayload)
  let cycleRejected = false
  try {
    parseAgentModelingDependencyGraph(cyclicGraph)
  } catch {
    cycleRejected = true
  }
  assertTrue(cycleRejected)
  await seedSnapshot(seeded)

  await initializeAgentModelingRunHistory()
  assertEqual(useAgentModelingStore.getState().historyStatus, 'ready')
  assertEqual(useAgentModelingStore.getState().current?.id, restoredRun.id)
  assertEqual(useAgentModelingStore.getState().history[0]?.summary, restoredRun.result.summary)

  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'persisted-next', element: 'C', position: [0, 0, 0] }],
  }
  const validateManifest = listZatomAgentTools().find((tool) => tool.name === 'structure_validate')!
  await useAgentModelingStore.getState().runTool(validateManifest, { structure })
  assertEqual(useAgentModelingStore.getState().current?.id, 42)

  const snapshot = await waitForRunCount(2)
  const storedByDigest = new Map((snapshot.artifacts as StoredLocalJsonArtifact[])
    .map((artifact) => [artifact.sha256, artifact]))
  const parsed = (snapshot.runs as AgentModelingHistorySnapshot['runs']).map((run) => {
    const root = storedByDigest.get(run.rootArtifact.sha256)!
    const graph = storedByDigest.get(run.dependencyGraphArtifact.sha256)!
    assertTrue(/^[0-9a-f]{64}$/.test(root.sha256))
    assertEqual(parseAgentModelingDependencyGraph(JSON.parse(graph.json)).runId, run.runId)
    return parseAgentModelingRunArtifact(JSON.parse(root.json))
  })
  assertTrue(parsed.some((artifact) => artifact.runId === 41))
  assertTrue(parsed.some((artifact) => artifact.runId === 42))

  const exported = composeAgentModelingHistoryBundle(useAgentModelingStore.getState().history)
  assertEqual(exported.runs.length, 2)
  assertEqual(exported.runs[0]?.runId, 42)
  const reorderedPayload = {
    schemaVersion: exported.schemaVersion,
    runs: [...exported.runs].reverse(),
  }
  let nonCanonicalOrderRejected = false
  try {
    parseAgentModelingHistoryBundle({
      ...reorderedPayload,
      fingerprint: fingerprintCanonicalJson(reorderedPayload),
    })
  } catch {
    nonCanonicalOrderRejected = true
  }
  assertTrue(nonCanonicalOrderRejected)

  useAgentModelingStore.getState().clearHistory()
  const cleared = await waitForRunCount(0)
  assertEqual(cleared.runs.length, 0)
  assertEqual(cleared.artifacts.length, 0)

  replaceAgentModelingRunHistory(parseAgentModelingHistoryBundle(exported).runs)
  assertEqual(useAgentModelingStore.getState().history.length, 2)
  assertEqual(useAgentModelingStore.getState().current?.id, 42)
  assertEqual(useAgentModelingStore.getState().historyStatus, 'saving')
  const imported = await waitForRunCount(2)
  assertEqual(useAgentModelingStore.getState().historyStatus, 'ready')
  assertEqual(imported.runs.length, 2)
  assertEqual(imported.artifacts.length, 4)

  useAgentModelingStore.getState().clearHistory()
  await waitForRunCount(0)
  console.log('agent modeling history IndexedDB tests passed')
}

void main()
