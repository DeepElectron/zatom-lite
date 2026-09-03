import { useCallback, useMemo, useSyncExternalStore } from 'react'

import type {
  WorkspaceBatch,
  WorkspaceCollectionStateView,
  WorkspaceFrame,
  WorkspaceLayer,
  WorkspaceLayersView,
} from './ports'
import { isBiomoleculePresentationArtifactV2 } from '../lib/biomolecule/presentation-contract'
import { isCrystalPresentationArtifactV2 } from '../lib/crystal/presentation-contract'

const DB_NAME = 'zatom-workspace'
const DB_VERSION = 1
const STORE_NAME = 'workspace'
const RECORD_KEY = 'current'
const WORKSPACE_SCHEMA = 'zatom.workspace/v1'

export interface LocalWorkspaceState extends WorkspaceCollectionStateView {
  version: 1
}

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

export function createLocalWorkspaceState(now = new Date().toISOString()): LocalWorkspaceState {
  const workspaceId = 'workspace-local'
  const batchId = 'batch-default'
  return {
    version: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [{
      id: workspaceId,
      name: 'Local workspace',
      createdAt: now,
      assets: {},
      batches: [{
        id: batchId,
        name: 'Batch 1',
        createdAt: now,
        frameIds: [],
        activeFrameId: null,
      }],
      activeBatchId: batchId,
      frames: [],
      currentIndex: -1,
    }],
  }
}

function isWorkspaceBatch(value: unknown): value is WorkspaceBatch {
  if (!value || typeof value !== 'object') return false
  const batch = value as Partial<WorkspaceBatch>
  return typeof batch.id === 'string'
    && typeof batch.name === 'string'
    && typeof batch.createdAt === 'string'
    && Array.isArray(batch.frameIds)
    && (batch.activeFrameId === null || typeof batch.activeFrameId === 'string')
}

function isWorkspaceLayer(value: unknown): value is WorkspaceLayer {
  if (!value || typeof value !== 'object') return false
  const workspace = value as Partial<WorkspaceLayer>
  return typeof workspace.id === 'string'
    && typeof workspace.name === 'string'
    && typeof workspace.createdAt === 'string'
    && !!workspace.assets
    && typeof workspace.assets === 'object'
    && Array.isArray(workspace.batches)
    && workspace.batches.length > 0
    && workspace.batches.every(isWorkspaceBatch)
    && typeof workspace.activeBatchId === 'string'
    && workspace.batches.some((batch) => batch.id === workspace.activeBatchId)
    && Array.isArray(workspace.frames)
    && typeof workspace.currentIndex === 'number'
}

function isWorkspaceAtom(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const atom = value as Record<string, unknown>
  const vector3 = (candidate: unknown) => Array.isArray(candidate)
    && candidate.length === 3
    && candidate.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  const integerVector3 = (candidate: unknown) => Array.isArray(candidate)
    && candidate.length === 3
    && candidate.every((entry) => Number.isInteger(entry) && Number(entry) >= 0)
  return Number.isInteger(atom.element)
    && Number(atom.element) > 0
    && vector3(atom.position)
    && (atom.selected === 0 || atom.selected === 1)
    && (atom.id === undefined || (typeof atom.id === 'string' && atom.id.length > 0))
    && (atom.fractionalPosition === undefined || vector3(atom.fractionalPosition))
    && (atom.cellIndex === undefined || integerVector3(atom.cellIndex))
    && (atom.siteIndex === undefined || (Number.isInteger(atom.siteIndex) && Number(atom.siteIndex) >= 0))
}

function hasValidFrameArtifact(value: unknown): value is WorkspaceFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const frame = value as WorkspaceFrame
  if (!Array.isArray(frame.atoms) || !frame.atoms.every(isWorkspaceAtom)) return false
  const hasBiomolecule = frame.biomoleculePresentation !== undefined
  const hasCrystal = frame.crystalPresentation !== undefined
  if (hasBiomolecule && hasCrystal) return false
  if (hasCrystal && frame.atoms.some((atom) => (
    !atom.id || !atom.fractionalPosition || atom.siteIndex === undefined
  ))) return false
  return (!hasBiomolecule || isBiomoleculePresentationArtifactV2(frame.biomoleculePresentation))
    && (!hasCrystal || isCrystalPresentationArtifactV2(frame.crystalPresentation))
}

function requireValidWorkspaceFrame(frame: WorkspaceFrame): void {
  const frameId = frame.id
  if (!hasValidFrameArtifact(frame)) {
    throw new Error(`Invalid workspace frame: ${frameId || '(missing id)'}`)
  }
}

export function parseLocalWorkspaceState(value: unknown): LocalWorkspaceState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<LocalWorkspaceState>
  if (state.version !== 1
    || typeof state.activeWorkspaceId !== 'string'
    || !Array.isArray(state.workspaces)
    || state.workspaces.length === 0
    || !state.workspaces.every(isWorkspaceLayer)) {
    return null
  }
  if (!state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) return null
  if (!state.workspaces.every((workspace) => (
    Object.values(workspace.assets).every(hasValidFrameArtifact)
    && workspace.frames.every(hasValidFrameArtifact)
  ))) return null
  return state as LocalWorkspaceState
}

function activeWorkspace(state: LocalWorkspaceState): WorkspaceLayer {
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
    ?? state.workspaces[0]
  if (!workspace) throw new Error('Local workspace has no active workspace')
  return workspace
}

function replaceWorkspace(
  state: LocalWorkspaceState,
  workspace: WorkspaceLayer,
): LocalWorkspaceState {
  return {
    ...state,
    activeWorkspaceId: workspace.id,
    workspaces: state.workspaces.map((candidate) => candidate.id === workspace.id ? workspace : candidate),
  }
}

function requireBatch(workspace: WorkspaceLayer, batchId: string): WorkspaceBatch {
  const batch = workspace.batches.find((candidate) => candidate.id === batchId)
  if (!batch) throw new Error(`Workspace batch not found: ${batchId}`)
  return batch
}

export function appendLocalWorkspaceFrame(
  state: LocalWorkspaceState,
  workspaceId: string,
  batchId: string,
  frame: WorkspaceFrame,
  activate = false,
): LocalWorkspaceState {
  const nextFrame = structuredClone(frame)
  requireValidWorkspaceFrame(nextFrame)
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const batch = requireBatch(workspace, batchId)
  const nextBatch = {
    ...batch,
    frameIds: batch.frameIds.includes(nextFrame.id) ? batch.frameIds : [...batch.frameIds, nextFrame.id],
    activeFrameId: activate || batch.activeFrameId === null ? nextFrame.id : batch.activeFrameId,
  }
  const existingFrameIndex = workspace.frames.findIndex((candidate) => candidate.id === nextFrame.id)
  const frames = existingFrameIndex >= 0
    ? workspace.frames.map((candidate) => candidate.id === nextFrame.id ? nextFrame : candidate)
    : [...workspace.frames, nextFrame]
  return replaceWorkspace(state, {
    ...workspace,
    assets: { ...workspace.assets, [nextFrame.id]: nextFrame },
    batches: workspace.batches.map((candidate) => candidate.id === batchId ? nextBatch : candidate),
    activeBatchId: activate ? batchId : workspace.activeBatchId,
    frames,
    currentIndex: activate || workspace.currentIndex < 0 ? frames.findIndex((candidate) => candidate.id === nextFrame.id) : workspace.currentIndex,
  })
}

export function replaceLocalWorkspaceFrame(
  state: LocalWorkspaceState,
  workspaceId: string,
  batchId: string,
  frameId: string,
  frame: WorkspaceFrame,
): LocalWorkspaceState {
  const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const batch = requireBatch(workspace, batchId)
  if (!batch.frameIds.includes(frameId) || !workspace.assets[frameId]) {
    throw new Error(`Workspace frame not found: ${frameId}`)
  }
  const nextFrame = structuredClone(frame.id === frameId ? frame : { ...frame, id: frameId })
  requireValidWorkspaceFrame(nextFrame)
  return replaceWorkspace(state, {
    ...workspace,
    assets: { ...workspace.assets, [frameId]: nextFrame },
    frames: workspace.frames.map((candidate) => candidate.id === frameId ? nextFrame : candidate),
  })
}

interface WorkspaceRecord {
  key: typeof RECORD_KEY
  schema: typeof WORKSPACE_SCHEMA
  state: LocalWorkspaceState
  savedAt: number
}

interface LocalWorkspaceSnapshot {
  workspaceState: LocalWorkspaceState
  persistenceError: string | null
}

interface LocalWorkspaceRuntime {
  db: IDBDatabase
  state: LocalWorkspaceState
  persistenceError: string | null
  snapshot: LocalWorkspaceSnapshot
  listeners: Set<() => void>
  writeQueue: Promise<void>
}

let runtime: LocalWorkspaceRuntime | null = null
let initialization: Promise<void> | null = null

function openWorkspaceDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is required for the local workspace'))
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open the local workspace database'))
    request.onblocked = () => reject(new Error('The local workspace database upgrade is blocked by another tab'))
  })
}

function readWorkspaceRecord(db: IDBDatabase): Promise<WorkspaceRecord | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(RECORD_KEY)
    request.onsuccess = () => resolve((request.result as WorkspaceRecord | undefined) ?? null)
    request.onerror = () => reject(request.error ?? new Error('Failed to read the local workspace'))
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to read the local workspace'))
  })
}

function writeWorkspaceRecord(db: IDBDatabase, state: LocalWorkspaceState): Promise<void> {
  if (parseLocalWorkspaceState(state) === null) {
    return Promise.reject(new Error('Refusing to save an invalid local workspace'))
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({
      key: RECORD_KEY,
      schema: WORKSPACE_SCHEMA,
      state,
      savedAt: Date.now(),
    } satisfies WorkspaceRecord)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save the local workspace'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Local workspace save was aborted'))
  })
}

function requireRuntime(): LocalWorkspaceRuntime {
  if (!runtime) throw new Error('Local workspace has not been initialized')
  return runtime
}

function publish(current: LocalWorkspaceRuntime): void {
  current.snapshot = {
    workspaceState: current.state,
    persistenceError: current.persistenceError,
  }
  current.listeners.forEach((listener) => listener())
  notifyFrameListeners()
}

function persistenceMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Appends a batch and makes it active. Shared by the hook and the MCP host. */
export function createLocalWorkspaceBatch(
  state: LocalWorkspaceState,
  name?: string,
): LocalWorkspaceState {
  const workspace = activeWorkspace(state)
  const batch: WorkspaceBatch = {
    id: id('batch'),
    name: name?.trim() || `Batch ${workspace.batches.length + 1}`,
    createdAt: new Date().toISOString(),
    frameIds: [],
    activeFrameId: null,
  }
  return replaceWorkspace(state, {
    ...workspace,
    batches: [...workspace.batches, batch],
    activeBatchId: batch.id,
  })
}

/** Renames an existing batch. Shared by the hook and the MCP host. */
export function renameLocalWorkspaceBatch(
  state: LocalWorkspaceState,
  batchId: string,
  name: string,
): LocalWorkspaceState {
  const workspace = activeWorkspace(state)
  requireBatch(workspace, batchId)
  const nextName = name.trim()
  if (!nextName) throw new Error('Workspace batch name is required')
  return replaceWorkspace(state, {
    ...workspace,
    batches: workspace.batches.map((batch) => batch.id === batchId ? { ...batch, name: nextName } : batch),
  })
}

/**
 * Renames one asset. Shared by the hook and the MCP host.
 *
 * A frame is stored twice — under `assets` keyed by id, and in the `frames`
 * timeline array — so both have to move together or the Assets list and the
 * timeline would show different names for the same structure.
 */
export function renameLocalWorkspaceFrame(
  state: LocalWorkspaceState,
  frameId: string,
  label: string,
): LocalWorkspaceState {
  const workspace = activeWorkspace(state)
  const existing = workspace.assets[frameId]
  if (!existing) throw new Error(`Workspace frame not found: ${frameId}`)
  const nextLabel = label.trim()
  if (!nextLabel) throw new Error('Asset name is required')
  if (nextLabel === existing.label) return state
  return replaceWorkspace(state, {
    ...workspace,
    assets: { ...workspace.assets, [frameId]: { ...existing, label: nextLabel } },
    frames: workspace.frames.map((frame) => frame.id === frameId ? { ...frame, label: nextLabel } : frame),
  })
}

/**
 * Moves frames between batches within the active workspace. Frames live in
 * `assets` keyed by id and batches only hold id lists, so a move is a pure
 * reordering of those lists and never copies or drops frame payloads.
 */
export function moveLocalWorkspaceFrames(
  state: LocalWorkspaceState,
  frameIds: readonly string[],
  toBatchId: string,
): LocalWorkspaceState {
  const workspace = activeWorkspace(state)
  const target = requireBatch(workspace, toBatchId)
  const moving = frameIds.filter((frameId) => workspace.assets[frameId] !== undefined)
  const unknown = frameIds.filter((frameId) => workspace.assets[frameId] === undefined)
  if (unknown.length > 0) throw new Error(`Workspace frames not found: ${unknown.join(', ')}`)
  const moved = new Set(moving)
  const batches = workspace.batches.map((batch) => {
    if (batch.id === target.id) {
      const additions = moving.filter((frameId) => !batch.frameIds.includes(frameId))
      const frameIdsNext = [...batch.frameIds, ...additions]
      return { ...batch, frameIds: frameIdsNext, activeFrameId: batch.activeFrameId ?? frameIdsNext[0] ?? null }
    }
    const frameIdsNext = batch.frameIds.filter((frameId) => !moved.has(frameId))
    if (frameIdsNext.length === batch.frameIds.length) return batch
    return {
      ...batch,
      frameIds: frameIdsNext,
      activeFrameId: batch.activeFrameId !== null && moved.has(batch.activeFrameId)
        ? frameIdsNext[0] ?? null
        : batch.activeFrameId,
    }
  })
  return replaceWorkspace(state, { ...workspace, batches })
}

/**
 * Imperative commit for non-React callers such as the CLI bridge. It shares
 * the hook's validate-then-persist path so both surfaces cannot diverge on
 * what a valid workspace is.
 */
export function commitLocalWorkspaceState(
  mutate: (state: LocalWorkspaceState) => LocalWorkspaceState,
): LocalWorkspaceState {
  return commitLocalWorkspace(mutate)
}

/** Reads the current workspace state outside React. */
export function readLocalWorkspaceState(): LocalWorkspaceState {
  return requireRuntime().state
}

function commitLocalWorkspace(mutate: (state: LocalWorkspaceState) => LocalWorkspaceState): LocalWorkspaceState {
  const current = requireRuntime()
  const next = mutate(current.state)
  if (parseLocalWorkspaceState(next) === null) {
    throw new Error('Refusing to commit an invalid local workspace')
  }
  current.state = next
  publish(current)
  current.writeQueue = current.writeQueue
    .then(() => writeWorkspaceRecord(current.db, next))
    .then(() => {
      if (current.state !== next || current.persistenceError === null) return
      current.persistenceError = null
      publish(current)
    })
    .catch((error) => {
      current.persistenceError = `Workspace changes are not saved: ${persistenceMessage(error)}`
      publish(current)
    })
  return next
}

export function initializeLocalWorkspace(): Promise<void> {
  if (runtime) return Promise.resolve()
  if (initialization) return initialization
  initialization = (async () => {
    const db = await openWorkspaceDb()
    db.onversionchange = () => db.close()
    const record = await readWorkspaceRecord(db)
    let state: LocalWorkspaceState
    if (record) {
      if (record.schema !== WORKSPACE_SCHEMA) {
        db.close()
        throw new Error(`Local workspace schema is ${String(record.schema)}, expected ${WORKSPACE_SCHEMA}`)
      }
      const parsed = parseLocalWorkspaceState(record.state)
      if (!parsed) {
        db.close()
        throw new Error(`Local workspace does not match ${WORKSPACE_SCHEMA}`)
      }
      state = parsed
    } else {
      state = createLocalWorkspaceState()
      await writeWorkspaceRecord(db, state)
    }
    runtime = {
      db,
      state,
      persistenceError: null,
      snapshot: { workspaceState: state, persistenceError: null },
      listeners: new Set(),
      writeQueue: Promise.resolve(),
    }
    /**
     * Anyone who subscribed while the database was still opening saw an empty
     * frame list; tell them the real one is available now.
     */
    notifyFrameListeners()
  })()
  return initialization
}

function subscribe(listener: () => void): () => void {
  const current = requireRuntime()
  current.listeners.add(listener)
  return () => current.listeners.delete(listener)
}

function getSnapshot(): LocalWorkspaceSnapshot {
  return requireRuntime().snapshot
}

/**
 * Read-only frame index for consumers outside the React tree — currently the
 * model catalog, which needs to list batch assets alongside bundled models.
 *
 * Deliberately narrow and separate from `useLocalWorkspaceLayers`: the catalog
 * only needs to enumerate and search frames, so handing it the mutating surface
 * would let a search UI write to the workspace. Returns an empty list before
 * initialization instead of throwing, because the catalog is read during render
 * and a workspace that is still opening is a normal state, not an error.
 */
const NO_FRAMES: readonly WorkspaceFrame[] = []

/**
 * Derived-array cache keyed on the state object it was built from.
 *
 * `useSyncExternalStore` compares snapshots by reference, so returning a freshly
 * built array on every call reports a change on every render and re-renders
 * forever. Workspace state is replaced wholesale on each commit, so its identity
 * is an exact validity key for anything derived from it.
 */
let framesCacheKey: LocalWorkspaceState | null = null
let framesCacheValue: readonly WorkspaceFrame[] = NO_FRAMES

export function getWorkspaceFramesSnapshot(): readonly WorkspaceFrame[] {
  if (!runtime) return NO_FRAMES
  if (framesCacheKey === runtime.state) return framesCacheValue
  /**
   * Frames hang off batches rather than sitting in a flat list, so this walks
   * the active workspace's batches. Only the active workspace is indexed: the
   * catalog is a way to reuse what you are currently working on, and pulling in
   * every frame from every workspace would fill search with rows that cannot be
   * traced back to any batch visible in the panel.
   */
  const state = runtime.state
  const active = state.workspaces.find((item) => item.id === state.activeWorkspaceId)
  if (!active) {
    framesCacheKey = state
    framesCacheValue = NO_FRAMES
    return framesCacheValue
  }
  /**
   * A batch stores only frameIds; the frame entities live in the layer's flat
   * `frames` list. Resolving through frameIds rather than returning `frames`
   * directly keeps the index limited to frames that some batch actually owns,
   * so a search hit always corresponds to a row visible in the Assets panel.
   */
  const byId = new Map(active.frames.map((frame) => [frame.id, frame]))
  const seen = new Set<string>()
  const owned: WorkspaceFrame[] = []
  for (const batch of active.batches) {
    for (const frameId of batch.frameIds) {
      if (seen.has(frameId)) continue
      const frame = byId.get(frameId)
      if (!frame) continue
      seen.add(frameId)
      owned.push(frame)
    }
  }
  framesCacheKey = state
  framesCacheValue = owned
  return framesCacheValue
}

/**
 * Subscribe to workspace changes without the mutating surface.
 *
 * Listeners are held module-side rather than on the runtime because the catalog
 * subscribes during first render, which can happen before IndexedDB finishes
 * opening. Registering on the runtime would silently drop those subscriptions —
 * React only calls `subscribe` again when the store function itself changes — so
 * the grid would stay empty until some unrelated re-render.
 */
const frameListeners = new Set<() => void>()

export function subscribeWorkspaceFrames(listener: () => void): () => void {
  frameListeners.add(listener)
  return () => frameListeners.delete(listener)
}

function notifyFrameListeners(): void {
  frameListeners.forEach((listener) => listener())
}

/** Canonical IndexedDB workspace implementation used by the standalone app. */
export function useLocalWorkspaceLayers(): WorkspaceLayersView {
  const { workspaceState, persistenceError } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const commit = useCallback((mutate: (state: LocalWorkspaceState) => LocalWorkspaceState) => (
    commitLocalWorkspace(mutate)
  ), [])

  const appendFrameToBatch = useCallback((workspaceId: string, batchId: string, frame: WorkspaceFrame, activate = false) => (
    commit((state) => appendLocalWorkspaceFrame(state, workspaceId, batchId, frame, activate))
  ), [commit])

  const replaceFrameInBatch = useCallback((workspaceId: string, batchId: string, frameId: string, frame: WorkspaceFrame) => (
    commit((state) => replaceLocalWorkspaceFrame(state, workspaceId, batchId, frameId, frame))
  ), [commit])

  const createBatch = useCallback((name?: string) => (
    commit((state) => createLocalWorkspaceBatch(state, name))
  ), [commit])

  const switchBatch = useCallback((batchId: string) => commit((state) => {
    const workspace = activeWorkspace(state)
    requireBatch(workspace, batchId)
    return replaceWorkspace(state, { ...workspace, activeBatchId: batchId })
  }), [commit])

  const removeBatch = useCallback((batchId: string) => commit((state) => {
    const workspace = activeWorkspace(state)
    requireBatch(workspace, batchId)
    if (workspace.batches.length === 1) throw new Error('The final workspace batch cannot be removed')
    const batches = workspace.batches.filter((candidate) => candidate.id !== batchId)
    const referencedFrameIds = new Set(batches.flatMap((batch) => batch.frameIds))
    const assets = Object.fromEntries(Object.entries(workspace.assets).filter(([frameId]) => referencedFrameIds.has(frameId)))
    const frames = workspace.frames.filter((frame) => referencedFrameIds.has(frame.id))
    return replaceWorkspace(state, {
      ...workspace,
      assets,
      batches,
      activeBatchId: workspace.activeBatchId === batchId ? batches[0].id : workspace.activeBatchId,
      frames,
      currentIndex: frames.length === 0 ? -1 : Math.min(workspace.currentIndex, frames.length - 1),
    })
  }), [commit])

  const renameBatch = useCallback((batchId: string, name: string) => (
    commit((state) => renameLocalWorkspaceBatch(state, batchId, name))
  ), [commit])

  const renameFrame = useCallback((frameId: string, label: string) => (
    commit((state) => renameLocalWorkspaceFrame(state, frameId, label))
  ), [commit])

  const removeFramesFromActiveBatch = useCallback((frameIds: string[]) => commit((state) => {
    const workspace = activeWorkspace(state)
    if (!workspace.activeBatchId) throw new Error('Workspace has no active batch')
    const batch = requireBatch(workspace, workspace.activeBatchId)
    const removed = new Set(frameIds)
    const nextFrameIds = batch.frameIds.filter((frameId) => !removed.has(frameId))
    const batches = workspace.batches.map((candidate) => candidate.id === batch.id
      ? {
          ...candidate,
          frameIds: nextFrameIds,
          activeFrameId: candidate.activeFrameId && removed.has(candidate.activeFrameId)
            ? nextFrameIds[0] ?? null
            : candidate.activeFrameId,
        }
      : candidate)
    const referencedFrameIds = new Set(batches.flatMap((candidate) => candidate.frameIds))
    const assets = Object.fromEntries(Object.entries(workspace.assets).filter(([frameId]) => referencedFrameIds.has(frameId)))
    const frames = workspace.frames.filter((frame) => referencedFrameIds.has(frame.id))
    return replaceWorkspace(state, {
      ...workspace,
      assets,
      batches,
      frames,
      currentIndex: frames.length === 0 ? -1 : Math.min(workspace.currentIndex, frames.length - 1),
    })
  }), [commit])

  const moveFramesToBatch = useCallback((frameIds: string[], toBatchId: string) => (
    commit((state) => moveLocalWorkspaceFrames(state, frameIds, toBatchId))
  ), [commit])

  return useMemo(() => ({
    workspaceState,
    persistenceError,
    appendFrameToBatch,
    replaceFrameInBatch,
    createBatch,
    switchBatch,
    removeBatch,
    renameBatch,
    renameFrame,
    removeFramesFromActiveBatch,
    moveFramesToBatch,
  }), [
    workspaceState,
    persistenceError,
    appendFrameToBatch,
    replaceFrameInBatch,
    createBatch,
    switchBatch,
    removeBatch,
    renameBatch,
    renameFrame,
    removeFramesFromActiveBatch,
    moveFramesToBatch,
  ])
}
