/**
 * In-page workspace assets surface.
 *
 * The browser workspace lives in this document, so batch calls go straight to
 * the `localWorkspace` mutators used by the Assets panel. Both surfaces share
 * one canonical definition of a valid workspace.
 */

import type { WorkspaceCollectionStateView } from '../host/ports'
import {
  commitLocalWorkspaceState,
  createLocalWorkspaceBatch,
  moveLocalWorkspaceFrames,
  readLocalWorkspaceState,
  renameLocalWorkspaceBatch,
  type LocalWorkspaceState,
} from '../host/localWorkspace'
import type { ZatomAssetBatchView, ZatomAssetsSurface } from './contracts'

/**
 * The in-page host owns exactly one workspace and publishes no instance
 * registry, so it cannot validate an `instanceId`. It rejects one instead of
 * ignoring it: `app_instances` is unavailable here, so any id an agent supplies
 * was invented, and quietly accepting it would report success for a write that
 * never targeted what the agent asked for.
 */
function rejectInstanceTargeting(instanceId: string | undefined): void {
  if (instanceId === undefined || instanceId === 'in-page') return
  throw new Error(
    'The in-page host serves only the current browser tab. '
    + `Use instanceId "in-page" or omit it (received ${JSON.stringify(instanceId)}).`,
  )
}

function activeWorkspace(state: WorkspaceCollectionStateView): WorkspaceCollectionStateView['workspaces'][number] {
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
  if (!workspace) throw new Error('The local workspace has no active workspace')
  return workspace
}

function batchViews(state: LocalWorkspaceState): ZatomAssetBatchView[] {
  const workspace = activeWorkspace(state)
  return workspace.batches.map((batch) => ({
    id: batch.id,
    name: batch.name,
    frameIds: [...batch.frameIds],
    activeFrameId: batch.activeFrameId,
    active: batch.id === workspace.activeBatchId,
  }))
}

export const inPageAssetsSurface: ZatomAssetsSurface = {
  listBatches: (instanceId) => {
    rejectInstanceTargeting(instanceId)
    return batchViews(readLocalWorkspaceState())
  },
  createBatch: (name, instanceId) => {
    rejectInstanceTargeting(instanceId)
    return batchViews(commitLocalWorkspaceState((state) => createLocalWorkspaceBatch(state, name)))
  },
  renameBatch: (batchId, name, instanceId) => {
    rejectInstanceTargeting(instanceId)
    return batchViews(commitLocalWorkspaceState((state) => renameLocalWorkspaceBatch(state, batchId, name)))
  },
  moveFrames: (frameIds, toBatchId, instanceId) => {
    rejectInstanceTargeting(instanceId)
    return batchViews(commitLocalWorkspaceState((state) => moveLocalWorkspaceFrames(state, frameIds, toBatchId)))
  },
}
