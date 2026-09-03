import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomStructure, ZatomTrajectory } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from '../contracts'
import { fingerprintStructure } from '../structure-math'
import { fingerprintTrajectory } from '../trajectory'
import {
  AgentWorkspaceRevisionError,
  captureAgentWorkspaceSnapshot,
  composeAgentWorkspaceRevision,
  parseAgentWorkspaceRevision,
  restoreAgentWorkspaceRevision,
  workspaceRevisionPosition,
  type AgentWorkspaceRevisionContext,
} from '../workspace-revision'

function structure(id: string, offset: number): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `structure ${id}`,
    lattice: {
      vectors: [[8, 0, 0], [0, 9, 0], [0, 0, 3]],
      periodic: [false, false, true],
    },
    atoms: [
      {
        id: `${id}-a`,
        element: 'C',
        position: [offset, 0, 0],
        properties: { residue: { name: 'FIX', index: 1 }, formalCharge: 0 },
      },
      { id: `${id}-b`, element: 'N', position: [offset + 1.2, 0, 0] },
    ],
    bonds: [{
      id: `${id}-bond`,
      atomIds: [`${id}-a`, `${id}-b`],
      order: 1,
      properties: { source: 'explicit' },
    }],
    metadata: { provenance: { engine: 'revision-test', id } },
  }
}

function trajectory(value: ZatomStructure, shift: number): ZatomTrajectory {
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: value.atoms.map((atom) => atom.id),
    coordinateMode: 'unwrapped-cartesian',
    lattice: value.lattice,
    metadata: { purpose: 'revision-test' },
    frames: [
      {
        step: 0,
        timePs: 0,
        positions: value.atoms.map((atom) => [atom.position[0] + shift, atom.position[1], atom.position[2]]),
      },
      { step: 1, timePs: 0.001, positions: value.atoms.map((atom) => [...atom.position]) },
    ],
  }
}

function memoryContext(initialStructure: ZatomStructure | null, initialTrajectory: ZatomTrajectory | null) {
  let currentStructure = structuredClone(initialStructure)
  let currentTrajectory = structuredClone(initialTrajectory)
  let corruptAfterNextWrite = false
  let corruptRead = false
  const context: AgentWorkspaceRevisionContext = {
    viewportId: () => 'vp-test',
    readStructure: () => {
      if (corruptRead) {
        corruptRead = false
        return currentStructure ? {
          ...structuredClone(currentStructure),
          metadata: { ...currentStructure.metadata, corruptReadback: true },
        } : null
      }
      return structuredClone(currentStructure)
    },
    readTrajectory: () => structuredClone(currentTrajectory),
    writeStructure: (value) => {
      currentStructure = structuredClone(value)
      currentTrajectory = null
      if (corruptAfterNextWrite) {
        corruptAfterNextWrite = false
        corruptRead = true
      }
    },
    writeTrajectory: (value) => { currentTrajectory = structuredClone(value) },
    clearTrajectory: () => { currentTrajectory = null },
    clearWorkspace: () => {
      currentStructure = null
      currentTrajectory = null
    },
  }
  return {
    context,
    set(value: ZatomStructure | null, frames: ZatomTrajectory | null) {
      currentStructure = structuredClone(value)
      currentTrajectory = structuredClone(frames)
    },
    corruptReadbackAfterNextWrite() { corruptAfterNextWrite = true },
  }
}

async function main() {
  const beforeStructure = structure('before', 0)
  const beforeTrajectory = trajectory(beforeStructure, 0.05)
  const afterStructure = structure('after', 2)
  const afterTrajectory = trajectory(afterStructure, -0.02)
  const memory = memoryContext(beforeStructure, beforeTrajectory)
  const before = await captureAgentWorkspaceSnapshot(memory.context)
  memory.set(afterStructure, afterTrajectory)
  const after = await captureAgentWorkspaceSnapshot(memory.context)
  const revision = composeAgentWorkspaceRevision({
    runId: 7,
    tool: 'test_replace_workspace',
    createdAt: '2026-08-08T12:00:00.000Z',
    before,
    after,
  })
  assertEqual(parseAgentWorkspaceRevision(revision).fingerprint, revision.fingerprint)
  assertEqual(workspaceRevisionPosition(revision, after), 'after')

  await restoreAgentWorkspaceRevision({ revision, direction: 'undo', context: memory.context })
  let restored = await captureAgentWorkspaceSnapshot(memory.context)
  assertEqual(restored.structureFingerprint, fingerprintStructure(beforeStructure))
  assertEqual(restored.trajectoryFingerprint, fingerprintTrajectory(beforeTrajectory))
  assertEqual(workspaceRevisionPosition(revision, restored), 'before')

  await restoreAgentWorkspaceRevision({ revision, direction: 'redo', context: memory.context })
  restored = await captureAgentWorkspaceSnapshot(memory.context)
  assertEqual(restored.structureFingerprint, fingerprintStructure(afterStructure))
  assertEqual(restored.trajectoryFingerprint, fingerprintTrajectory(afterTrajectory))

  memory.set(structure('drift', 5), null)
  const driftFingerprint = fingerprintStructure((await captureAgentWorkspaceSnapshot(memory.context)).structure!)
  let driftError: unknown = null
  try {
    await restoreAgentWorkspaceRevision({ revision, direction: 'undo', context: memory.context })
  } catch (error) {
    driftError = error
  }
  assertTrue(driftError instanceof AgentWorkspaceRevisionError)
  assertEqual((driftError as AgentWorkspaceRevisionError).code, 'workspace_revision_source_mismatch')
  assertEqual(fingerprintStructure((await captureAgentWorkspaceSnapshot(memory.context)).structure!), driftFingerprint)

  memory.set(afterStructure, afterTrajectory)
  memory.corruptReadbackAfterNextWrite()
  let readbackError: unknown = null
  try {
    await restoreAgentWorkspaceRevision({ revision, direction: 'undo', context: memory.context })
  } catch (error) {
    readbackError = error
  }
  assertTrue(readbackError instanceof AgentWorkspaceRevisionError)
  assertEqual((readbackError as AgentWorkspaceRevisionError).code, 'workspace_revision_readback_mismatch')
  const rolledBack = await captureAgentWorkspaceSnapshot(memory.context)
  assertEqual(rolledBack.structureFingerprint, fingerprintStructure(afterStructure))
  assertEqual(rolledBack.trajectoryFingerprint, fingerprintTrajectory(afterTrajectory))

  const emptyMemory = memoryContext(null, null)
  const emptyBefore = await captureAgentWorkspaceSnapshot(emptyMemory.context)
  emptyMemory.set(afterStructure, null)
  const populatedAfter = await captureAgentWorkspaceSnapshot(emptyMemory.context)
  const firstStructureRevision = composeAgentWorkspaceRevision({
    runId: 8,
    tool: 'test_create_workspace',
    createdAt: '2026-08-08T12:01:00.000Z',
    before: emptyBefore,
    after: populatedAfter,
  })
  await restoreAgentWorkspaceRevision({
    revision: firstStructureRevision,
    direction: 'undo',
    context: emptyMemory.context,
  })
  assertEqual((await captureAgentWorkspaceSnapshot(emptyMemory.context)).structure, null)
  await restoreAgentWorkspaceRevision({
    revision: firstStructureRevision,
    direction: 'redo',
    context: emptyMemory.context,
  })
  assertEqual(
    (await captureAgentWorkspaceSnapshot(emptyMemory.context)).structureFingerprint,
    fingerprintStructure(afterStructure),
  )

  let tamperError: unknown = null
  try {
    parseAgentWorkspaceRevision({ ...revision, tool: 'tampered' })
  } catch (error) {
    tamperError = error
  }
  assertTrue(tamperError instanceof AgentWorkspaceRevisionError)
  assertEqual((tamperError as AgentWorkspaceRevisionError).code, 'workspace_revision_fingerprint_mismatch')
}

void main()
