/**
 * Undo/redo for the active viewport, exposed to the agent.
 *
 * Two segments make one timeline:
 *
 * - The store's history-slice holds the user's own edits (atom drags, CRUD)
 *   made since the last canonical agent write. Every canonical write clears
 *   it — those coordinate-only snapshots cannot restore sidecars, mixed PBC
 *   or trajectories — so store entries are always the NEWER segment.
 * - The canonical stack here holds the full ZatomStructure that each agent
 *   write replaced. Undoing one re-runs the canonical write path, which
 *   restores everything the store history cannot.
 *
 * undo() therefore consumes store history first, then the canonical stack;
 * redo() mirrors it. A new agent write drops any canonical redo. Both
 * mutations pass through assertAgentMayMutateWorkspace: once the user has
 * taken over, the agent may not rewind their edits either.
 */

import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import {
  assertAgentMayMutateWorkspace,
  assertAgentMayMutateWorkspaceNow,
} from '../orchestration/agentOperationReviewStore'
import type { HistorySnapshot, ZatomHistorySurface, ZatomStructure, ZatomTrajectory } from './contracts'
import { fingerprintStructure } from './structure-math'
import { fingerprintTrajectory } from './trajectory'

export class HistoryInputError extends Error {
  readonly code: 'nothing_to_undo' | 'nothing_to_redo'
  constructor(code: 'nothing_to_undo' | 'nothing_to_redo', message: string) {
    super(message)
    this.name = 'HistoryInputError'
    this.code = code
  }
}

const CANONICAL_LIMIT = 20

interface CanonicalEntry {
  structure: ZatomStructure
  trajectory: ZatomTrajectory | null
  /** Fingerprint the workspace had right after the write that this entry can undo/redo to. */
  fingerprint: string
}

interface CanonicalHistoryState {
  undoStack: CanonicalEntry[]
  /** Each entry remembers the fingerprint it was undone FROM; a user edit in between makes it stale. */
  redoStack: Array<CanonicalEntry & { validFrom: string }>
}

const histories = new WeakMap<object, CanonicalHistoryState>()

function historyFor(key: object): CanonicalHistoryState {
  const existing = histories.get(key)
  if (existing) return existing
  const created: CanonicalHistoryState = { undoStack: [], redoStack: [] }
  histories.set(key, created)
  return created
}

/**
 * Called by the canonical write path with the structure it is about to
 * replace. A write with no prior structure (first load) is not undoable here.
 */
export function recordCanonicalWrite(
  prior: ZatomStructure | null,
  key: object = getActiveViewportStoreApi() as object,
  priorTrajectory: ZatomTrajectory | null = null,
): void {
  const { undoStack, redoStack } = historyFor(key)
  redoStack.length = 0
  if (!prior) return
  undoStack.push({ structure: prior, trajectory: priorTrajectory, fingerprint: fingerprintStructure(prior) })
  if (undoStack.length > CANONICAL_LIMIT) undoStack.shift()
}

export function createActiveViewportHistorySurface(deps: {
  readStructure: () => ZatomStructure | null
  readTrajectory: () => ZatomTrajectory | null
  /** Must NOT record into the canonical stack (it is the undo itself). */
  writeStructure: (structure: ZatomStructure) => Promise<void>
  writeTrajectory: (trajectory: ZatomTrajectory) => Promise<void>
  clearTrajectory: () => void
}): ZatomHistorySurface {
  const currentFingerprint = () => {
    const structure = deps.readStructure()
    return structure ? fingerprintStructure(structure) : null
  }
  const currentWorkspaceFingerprint = () => {
    const structure = deps.readStructure()
    const trajectory = deps.readTrajectory()
    return `${structure ? fingerprintStructure(structure) : 'empty'}|${trajectory ? fingerprintTrajectory(trajectory) : 'none'}`
  }
  const writeWorkspace = async (entry: Pick<CanonicalEntry, 'structure' | 'trajectory'>) => {
    await deps.writeStructure(entry.structure)
    if (entry.trajectory) await deps.writeTrajectory(entry.trajectory)
    else deps.clearTrajectory()
  }
  const pruneStaleRedo = (redoStack: CanonicalHistoryState['redoStack']) => {
    const now = currentWorkspaceFingerprint()
    while (redoStack.length && redoStack[redoStack.length - 1].validFrom !== now) redoStack.pop()
  }
  const snapshot = (): HistorySnapshot => {
    const api = getActiveViewportStoreApi()
    const { undoStack, redoStack } = historyFor(api as object)
    pruneStaleRedo(redoStack)
    const state = api.getState()
    const storeUndo = Math.max(0, state.historyIndex + 1)
    const storeRedo = Math.max(0, state.history.length - state.historyIndex - 2)
    return {
      canUndo: storeUndo > 0 || undoStack.length > 0,
      canRedo: storeRedo > 0 || redoStack.length > 0,
      undoDepth: storeUndo + undoStack.length,
      redoDepth: storeRedo + redoStack.length,
      structureFingerprint: currentFingerprint(),
    }
  }
  return {
    read: snapshot,
    undo: async () => {
      const api = getActiveViewportStoreApi()
      const { undoStack, redoStack } = historyFor(api as object)
      const state = api.getState()
      if (state.canUndo()) {
        await assertAgentMayMutateWorkspace('undo the last edit')
        assertAgentMayMutateWorkspaceNow('undo the last edit')
        if (getActiveViewportStoreApi() !== api) {
          throw new Error('Active viewport changed while waiting to undo; re-read history for the new viewport')
        }
        state.undo()
        return snapshot()
      }
      const entry = undoStack[undoStack.length - 1]
      if (!entry) throw new HistoryInputError('nothing_to_undo', 'Nothing to undo.')
      await assertAgentMayMutateWorkspace('undo the last edit')
      assertAgentMayMutateWorkspaceNow('undo the last edit')
      if (getActiveViewportStoreApi() !== api) {
        throw new Error('Active viewport changed while waiting to undo; re-read history for the new viewport')
      }
      const current = deps.readStructure()
      const currentTrajectory = deps.readTrajectory()
      undoStack.pop()
      await writeWorkspace(entry)
      if (current) {
        redoStack.push({
          structure: current,
          trajectory: currentTrajectory,
          fingerprint: fingerprintStructure(current),
          validFrom: currentWorkspaceFingerprint(),
        })
      }
      return snapshot()
    },
    redo: async () => {
      const api = getActiveViewportStoreApi()
      const { undoStack, redoStack } = historyFor(api as object)
      const state = api.getState()
      if (state.canRedo()) {
        await assertAgentMayMutateWorkspace('redo the undone edit')
        assertAgentMayMutateWorkspaceNow('redo the undone edit')
        if (getActiveViewportStoreApi() !== api) {
          throw new Error('Active viewport changed while waiting to redo; re-read history for the new viewport')
        }
        state.redo()
        return snapshot()
      }
      pruneStaleRedo(redoStack)
      const entry = redoStack[redoStack.length - 1]
      if (!entry) throw new HistoryInputError('nothing_to_redo', 'Nothing to redo.')
      await assertAgentMayMutateWorkspace('redo the undone edit')
      assertAgentMayMutateWorkspaceNow('redo the undone edit')
      if (getActiveViewportStoreApi() !== api) {
        throw new Error('Active viewport changed while waiting to redo; re-read history for the new viewport')
      }
      const current = deps.readStructure()
      const currentTrajectory = deps.readTrajectory()
      redoStack.pop()
      await writeWorkspace(entry)
      if (current) undoStack.push({
        structure: current,
        trajectory: currentTrajectory,
        fingerprint: fingerprintStructure(current),
      })
      return snapshot()
    },
  }
}
