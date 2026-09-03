/** Native in-page viewport/layout surface used by WebMCP. */

import { atomicNumberToSymbol } from '../chemistry/periodic-table'
import { readLocalWorkspaceState } from '../host/localWorkspace'
import {
  assertAgentMayMutateWorkspace,
  assertAgentMayMutateWorkspaceNow,
  readAgentTakeoverNote,
  useAgentOperationReview,
} from '../orchestration/agentOperationReviewStore'
import {
  captureViewportManagerTransaction,
  GRID_SPECS,
  restoreViewportManagerTransaction,
  useViewportManager,
  type GridLayout,
} from '../orchestration/viewportManager'
import type {
  ZatomAppInstanceView,
  ZatomMountRequestStructure,
  ZatomStructure,
  ZatomTrajectory,
  ZatomViewportSurface,
  ZatomViewportView,
  ZatomWorkspaceIdentity,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import {
  importStructureText,
  ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS,
  type ZatomStructureTextImportFormat,
} from './structure-text-io'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_IN_PAGE_INSTANCE_ID = 'in-page'

type ViewportStore = {
  getState(): Record<string, unknown>
  setState(state: Record<string, unknown>): void
}

const MOUNT_PRESENTATION_KEYS = [
  'selectedAtomIds', 'selectedBondIds', 'selectedFaceIds', 'selectedEdgeIds', 'selectedCompactIndices',
  'focusedAtomIds', 'massiveSceneVisualFocusAtomIds', 'massiveSceneVisualFocusCenter',
  'massiveSceneVisualFocusDistance', 'hoveredAtomId', 'cameraTarget', 'initialCameraPosition',
  'initialCameraLookAt', 'history', 'historyIndex', 'atomAttributes', 'ptmAnalysis',
  'showPtmColoring', 'userDeletedPositions', 'userAddedAtomIds', 'trajectoryCurrentFrame',
  'trajectoryPlaying',
  'molecularOrbital', 'constructedPlane', 'show2DPlaneView', 'clippingEnabled',
  'clippingAxis', 'clippingOffset', 'clippingNormal', 'volumeField', 'sliceEnabled',
  'sliceClip', 'sliceIsolate', 'measurements', 'measurementMode', 'pendingMeasurementAtoms',
  'activeMeasurementEdit', 'structureGroups', 'activeGroupId', 'crystalLayers',
  'bioStructure', 'bioLayers', 'bioSuppressedBondKeys', 'bioAlignmentGhost',
  'bioDrillGhost', 'bioDrillLevel', 'regionSeeds', 'showRegionSolids',
  'hideAtomsInRegionView', 'showGrainColoring', 'domainWallReview',
] as const

type MountPresentation = Record<(typeof MOUNT_PRESENTATION_KEYS)[number], unknown>

function clonePresentationValue(value: unknown): unknown {
  if (value === undefined || typeof value === 'function') return value
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function captureMountPresentation(store: ViewportStore): MountPresentation {
  const state = store.getState()
  return Object.fromEntries(MOUNT_PRESENTATION_KEYS.map((key) => [key, clonePresentationValue(state[key])])) as MountPresentation
}

function hasAttachedPaneContent(store: ViewportStore): boolean {
  const state = store.getState()
  const surface = state.molecularOrbital as {
    cubData?: unknown
    moldenData?: unknown
    colorField?: unknown
  } | undefined
  return surface?.cubData != null
    || surface?.moldenData != null
    || surface?.colorField != null
    || state.constructedPlane != null
    || (Array.isArray(state.measurements) && state.measurements.length > 0)
    || (Array.isArray(state.structureGroups) && state.structureGroups.length > 0)
    || (Array.isArray(state.crystalLayers) && state.crystalLayers.length > 0)
    || state.domainWallReview != null
    || state.regionSeeds != null
}

function comparablePresentation(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (item instanceof Set) return [...item].sort()
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]))
    }
    return item
  }
  try {
    return JSON.stringify(normalize(value))
  } catch {
    return String(value)
  }
}

function restoreMountPresentation(
  store: ViewportStore,
  before: MountPresentation,
  afterMount: MountPresentation,
  userStateBeforeRestore: MountPresentation,
): void {
  const patch: Record<string, unknown> = {}
  for (const key of MOUNT_PRESENTATION_KEYS) {
    // A user edit made while the review was open wins over the old snapshot.
    if (comparablePresentation(userStateBeforeRestore[key]) === comparablePresentation(afterMount[key])) {
      patch[key] = clonePresentationValue(before[key])
    }
  }
  store.setState(patch)
  const frameIndex = patch.trajectoryCurrentFrame
  const setTrajectoryFrame = store.getState().setTrajectoryFrame
  if (typeof frameIndex === 'number' && typeof setTrajectoryFrame === 'function') {
    ;(setTrajectoryFrame as (index: number) => void)(frameIndex)
  }
}

function sameIdentity(left: ZatomWorkspaceIdentity, right: ZatomWorkspaceIdentity): boolean {
  return left.viewportId === right.viewportId
    && left.revision === right.revision
    && left.structureFingerprint === right.structureFingerprint
    && left.trajectoryFingerprint === right.trajectoryFingerprint
}

function throwIfViewportOperationCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Viewport operation was cancelled')
}

interface MountedPaneTransaction {
  viewportId: string
  store: ViewportStore
  beforeIdentity: ZatomWorkspaceIdentity
  beforeStructure: ZatomStructure | null
  beforeTrajectory: ZatomTrajectory | null
  beforePresentation: MountPresentation
  afterIdentity?: ZatomWorkspaceIdentity
  afterPresentation?: MountPresentation
}

async function restoreMountedPane(
  deps: InPageViewportSurfaceDependencies,
  transaction: MountedPaneTransaction,
): Promise<boolean> {
  const assertStillRestorable = () => {
    const slot = useViewportManager.getState().viewports[transaction.viewportId]
    if (!slot || slot.kind !== 'crystal'
      || (slot.storeInstance as unknown as ViewportStore) !== transaction.store) {
      throw new Error(`Mounted pane ${transaction.viewportId} is no longer bound to its reviewed store`)
    }
    if (transaction.afterIdentity
      && !sameIdentity(deps.readIdentity(transaction.store), transaction.afterIdentity)) {
      throw new Error(`Mounted pane ${transaction.viewportId} changed before rollback`)
    }
  }
  try {
    assertStillRestorable()
  } catch {
    return false
  }
  const userPresentation = captureMountPresentation(transaction.store)
  if (transaction.beforeStructure) {
    try {
      await deps.writeStructure(
        transaction.store,
        transaction.viewportId,
        transaction.beforeStructure,
        { recordHistory: false, beforeStructureReplace: assertStillRestorable },
      )
    } catch {
      return false
    }
    if (transaction.beforeTrajectory) {
      const restoredStructureIdentity = deps.readIdentity(transaction.store)
      try {
        await deps.writeTrajectory(
          transaction.store,
          transaction.viewportId,
          transaction.beforeTrajectory,
          {
            beforeTrajectoryReplace: () => {
              const slot = useViewportManager.getState().viewports[transaction.viewportId]
              if (!slot || slot.kind !== 'crystal'
                || (slot.storeInstance as unknown as ViewportStore) !== transaction.store
                || !sameIdentity(deps.readIdentity(transaction.store), restoredStructureIdentity)) {
                throw new Error(`Mounted pane ${transaction.viewportId} changed before trajectory rollback`)
              }
            },
          },
        )
      } catch {
        return false
      }
    }
  } else {
    try {
      assertStillRestorable()
    } catch {
      return false
    }
    deps.clearWorkspace(transaction.store, transaction.viewportId)
  }
  restoreMountPresentation(
    transaction.store,
    transaction.beforePresentation,
    transaction.afterPresentation ?? userPresentation,
    userPresentation,
  )
  return true
}

export interface InPageViewportSurfaceDependencies {
  readStructure(store: ViewportStore): ZatomStructure | null
  readIdentity(store: ViewportStore): ZatomWorkspaceIdentity
  readTrajectory(store: ViewportStore): ZatomTrajectory | null
  writeStructure(
    store: ViewportStore,
    viewportId: string,
    structure: ZatomStructure,
    options?: { recordHistory?: boolean; beforeStructureReplace?: () => void },
  ): Promise<void>
  clearWorkspace(store: ViewportStore, viewportId: string): void
  writeTrajectory(
    store: ViewportStore,
    viewportId: string,
    trajectory: ZatomTrajectory,
    options?: { beforeTrajectoryReplace?: () => void },
  ): Promise<void>
}

function rejectInstance(instanceId: string | undefined): void {
  if (instanceId === undefined || instanceId === ZATOM_IN_PAGE_INSTANCE_ID) return
  throw new Error(`The in-page WebMCP host serves ${ZATOM_IN_PAGE_INSTANCE_ID}, not ${instanceId}`)
}

function layoutLabel(): string {
  const { layout, freeLayout } = useViewportManager.getState()
  return freeLayout
    ? `free(${freeLayout.placement}, 1+${freeLayout.subViewportIds.length})`
    : layout
}

function visibleSlotIds(): string[] {
  const { layout, freeLayout } = useViewportManager.getState()
  if (freeLayout) return [freeLayout.mainViewportId, ...freeLayout.subViewportIds]
  return Array.from({ length: GRID_SPECS[layout].total }, (_, index) => `vp-${index + 1}`)
}

function managerSnapshot() {
  return captureViewportManagerTransaction()
}

function restoreManager(snapshot: ReturnType<typeof managerSnapshot>): void {
  restoreViewportManagerTransaction(snapshot)
}

function describe(deps: InPageViewportSurfaceDependencies, consumeTakeover = true): ZatomViewportView {
  const manager = useViewportManager.getState()
  const slots: ZatomViewportView['slots'] = []
  for (const [slotIndex, slotId] of visibleSlotIds().entries()) {
    const slot = manager.viewports[slotId]
    if (!slot) continue
    if (slot.kind !== 'crystal') {
      slots.push({
        slotId,
        slotIndex,
        kind: slot.kind,
        label: slot.label,
        structureLabel: null,
        atomCount: null,
        active: slotId === manager.activeViewportId,
        structureFingerprint: null,
        trajectoryFingerprint: null,
        workspaceRevision: null,
      })
      continue
    }
    const store = slot.storeInstance as unknown as ViewportStore
    const structure = deps.readStructure(store)
    const identity = deps.readIdentity(store)
    slots.push({
      slotId,
      slotIndex,
      kind: slot.kind,
      label: slot.label,
      structureLabel: slot.structureName || null,
      atomCount: structure?.atoms.length ?? 0,
      active: slotId === manager.activeViewportId,
      structureFingerprint: identity.structureFingerprint,
      trajectoryFingerprint: identity.trajectoryFingerprint,
      workspaceRevision: identity.revision,
    })
  }
  const takeover = consumeTakeover ? readAgentTakeoverNote() : null
  const operationState = useAgentOperationReview.getState()
  const control = operationState.control
  const phase = control.phase === 'awaiting_review'
    ? 'awaiting-review' as const
    : control.phase === 'manual_control'
      ? 'user-takeover' as const
      : control.phase
  const label = control.phase === 'awaiting_review'
    ? control.review.label
    : control.phase === 'manual_control'
      ? control.control.revertedLabel
      : control.phase === 'animating' ? control.operation.label : null
  return {
    instanceId: ZATOM_IN_PAGE_INSTANCE_ID,
    layout: layoutLabel(),
    availableLayouts: [...Object.keys(GRID_SPECS), 'free-right', 'free-bottom', 'free-l-shape'],
    slots,
    agentControl: {
      phase,
      label,
      pendingOperations: operationState.pendingOperations,
      queuedOperations: Math.max(0, operationState.pendingOperations - 1),
    },
    ...(takeover ? { userTakeover: takeover } : {}),
  }
}

function frameStructure(frameId: string, label: string): ZatomStructure {
  const state = readLocalWorkspaceState()
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
  const frame = workspace?.assets[frameId]
  if (!frame) throw new Error(`Unknown workspace frame "${frameId}"`)
  return parseZatomStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    atoms: frame.atoms.map((atom, atomIndex) => ({
      id: atom.id ?? `a${atomIndex + 1}`,
      element: atomicNumberToSymbol(atom.element),
      position: [...atom.position],
    })),
    ...(frame.latticeMatrix ? {
      lattice: { vectors: frame.latticeMatrix.map((row) => [...row]), periodic: [true, true, true] },
    } : {}),
  })
}

function resolveMount(entry: ZatomMountRequestStructure, index: number): ZatomStructure {
  const label = entry.label || `Structure ${index + 1}`
  const hasFrame = typeof entry.frameId === 'string' && entry.frameId.length > 0
  const hasText = typeof entry.text === 'string' && entry.text.length > 0
  if (hasFrame === hasText) throw new Error(`structures[${index}] requires exactly one of frameId or text`)
  if (hasFrame) return frameStructure(entry.frameId!, label)
  if (!entry.format || !(ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS as readonly string[]).includes(entry.format)) {
    throw new Error(`Unsupported import format "${entry.format ?? ''}"`)
  }
  return importStructureText({
    format: entry.format as ZatomStructureTextImportFormat,
    text: entry.text!,
    label,
  }).structure
}

function setRequestedLayout(layout: string): void {
  const manager = useViewportManager.getState()
  if (layout === 'free-right' || layout === 'free-bottom' || layout === 'free-l-shape') {
    manager.enterFreeMode(layout === 'free-l-shape' ? 'l-shape' : layout === 'free-bottom' ? 'bottom' : 'right')
    return
  }
  if (!(layout in GRID_SPECS)) throw new Error(`Unknown viewport layout ${layout}`)
  manager.setLayout(layout as GridLayout)
}

function layoutStateSignature(deps: InPageViewportSurfaceDependencies): string {
  const state = useViewportManager.getState()
  const transaction = captureViewportManagerTransaction()
  const identities: Array<[string, ZatomWorkspaceIdentity | null]> = Object.entries(state.viewports)
    .map(([id, slot]) => slot.kind === 'crystal'
      ? [id, deps.readIdentity(slot.storeInstance as unknown as ViewportStore)]
      : [id, null])
  return JSON.stringify({
    layout: state.layout,
    columnSplit: state.columnSplit,
    maximizedViewportId: state.maximizedViewportId,
    freeLayout: state.freeLayout,
    identities,
    detached: transaction.detached.map(([id, slot]) => [
      id,
      slot.kind === 'crystal'
        ? deps.readIdentity(slot.storeInstance as unknown as ViewportStore)
        : { kind: slot.kind, sourceViewportId: slot.sourceViewportId },
    ]),
  })
}

export function createInPageViewportSurface(
  deps: InPageViewportSurfaceDependencies,
): { viewport: ZatomViewportSurface; listAppInstances: () => ZatomAppInstanceView[] } {
  const viewport: ZatomViewportSurface = {
    describe: (instanceId) => {
      rejectInstance(instanceId)
      return describe(deps)
    },

    activate: async (slotId, options) => {
      rejectInstance(options.instanceId)
      await assertAgentMayMutateWorkspace('activate a different viewport pane', { signal: options.signal })
      assertAgentMayMutateWorkspaceNow('activate a different viewport pane', { signal: options.signal })
      throwIfViewportOperationCancelled(options.signal)
      const manager = useViewportManager.getState()
      if (manager.activeViewportId !== options.expectedActiveViewportId) {
        throw new Error(
          `Active viewport changed from ${options.expectedActiveViewportId} to ${manager.activeViewportId}; `
          + 'describe the viewport again before switching panes.',
        )
      }
      if (!visibleSlotIds().includes(slotId)) {
        throw new Error(`Viewport pane ${slotId} is not visible in the current layout`)
      }
      const slot = manager.viewports[slotId]
      if (!slot) throw new Error(`Unknown viewport pane ${slotId}`)
      if (slot.kind !== 'crystal') {
        throw new Error(`Viewport pane ${slotId} is a ${slot.kind} view and cannot become the modeling workspace`)
      }

      // Preserve the user's maximized viewing mode while making the requested
      // pane genuinely visible. Merely changing activeViewportId would leave a
      // different maximized pane covering it and the Agent/user would be
      // looking at different structures.
      if (manager.maximizedViewportId && manager.maximizedViewportId !== slotId) {
        manager.toggleMaximized(slotId)
      } else {
        manager.setActive(slotId)
      }
      if (useViewportManager.getState().activeViewportId !== slotId) {
        throw new Error(`Viewport pane ${slotId} could not be activated`)
      }
      return describe(deps)
    },

    setLayout: async (layout, instanceId, signal) => {
      rejectInstance(instanceId)
      await assertAgentMayMutateWorkspace('change the viewport layout', { signal })
      assertAgentMayMutateWorkspaceNow('change the viewport layout', { signal })
      throwIfViewportOperationCancelled(signal)
      const before = managerSnapshot()
      const beforeLabel = layoutLabel()
      setRequestedLayout(layout)
      const afterLabel = layoutLabel()
      if (beforeLabel !== afterLabel || before.freeLayout !== useViewportManager.getState().freeLayout) {
        const expected = layoutStateSignature(deps)
        useAgentOperationReview.getState().openReview({
          label: 'Viewport layout',
          subject: {
            kind: 'workspace',
            summary: `${beforeLabel} → ${afterLabel}`,
            revert: () => {
              if (layoutStateSignature(deps) !== expected) {
                throw new Error('The viewport changed after this layout operation; newer user changes were kept.')
              }
              restoreManager(before)
            },
          },
        })
      }
      return describe(deps)
    },

    clear: async (slotId, options) => {
      rejectInstance(options.instanceId)
      await assertAgentMayMutateWorkspace('clear a viewport pane', { signal: options.signal })
      assertAgentMayMutateWorkspaceNow('clear a viewport pane', { signal: options.signal })
      throwIfViewportOperationCancelled(options.signal)

      if (!visibleSlotIds().includes(slotId)) {
        throw new Error(`Viewport pane ${slotId} is not visible in the current layout`)
      }
      if (options.expectedTarget.slotId !== slotId) {
        throw new Error(`Clear target ${slotId} does not match the expected pane ${options.expectedTarget.slotId}`)
      }
      const slot = useViewportManager.getState().viewports[slotId]
      if (!slot || slot.kind !== 'crystal') {
        throw new Error(`Viewport pane ${slotId} is unavailable or is not a crystal pane`)
      }
      const store = slot.storeInstance as unknown as ViewportStore
      const beforeIdentity = deps.readIdentity(store)
      const expectation = options.expectedTarget
      if (beforeIdentity.revision !== expectation.workspaceRevision
        || beforeIdentity.structureFingerprint !== expectation.structureFingerprint
        || beforeIdentity.trajectoryFingerprint !== expectation.trajectoryFingerprint) {
        throw new Error(`Viewport pane ${slotId} changed after it was described; describe the viewport again before clearing it`)
      }

      const beforeStructure = deps.readStructure(store)
      const beforeTrajectory = deps.readTrajectory(store)
      if (!beforeStructure && !beforeTrajectory && !hasAttachedPaneContent(store)) return describe(deps)

      const transaction: MountedPaneTransaction = {
        viewportId: slotId,
        store,
        beforeIdentity,
        beforeStructure,
        beforeTrajectory,
        beforePresentation: captureMountPresentation(store),
      }
      const assertTargetUnchanged = () => {
        const current = useViewportManager.getState().viewports[slotId]
        if (!current || current.kind !== 'crystal'
          || current.storeInstance as unknown as ViewportStore !== store
          || !sameIdentity(deps.readIdentity(store), beforeIdentity)) {
          throw new Error(`Viewport pane ${slotId} changed before it could be cleared; no content was removed`)
        }
      }

      useAgentOperationReview.getState().beginAnimation({
        label: 'Clearing viewport pane',
        viewportId: slotId,
      })
      let clearStarted = false
      try {
        assertTargetUnchanged()
        clearStarted = true
        deps.clearWorkspace(store, slotId)
        transaction.afterIdentity = deps.readIdentity(store)
        transaction.afterPresentation = captureMountPresentation(store)
        throwIfViewportOperationCancelled(options.signal)
        useAgentOperationReview.getState().openReview({
          label: `Clear ${slotId}`,
          subject: {
            kind: 'structure',
            viewportId: slotId,
            workspaceRevision: transaction.afterIdentity.revision,
            atomDelta: beforeStructure?.atoms.length ? -beforeStructure.atoms.length : 0,
            revert: async () => {
              if (!await restoreMountedPane(deps, transaction)) {
                throw new Error(`Viewport pane ${slotId} changed after it was cleared; newer user changes were kept.`)
              }
            },
          },
        })
      } catch (error) {
        if (clearStarted) {
          transaction.afterIdentity ??= deps.readIdentity(store)
          transaction.afterPresentation ??= captureMountPresentation(store)
        }
        if (clearStarted && !await restoreMountedPane(deps, transaction)) {
          useAgentOperationReview.getState().clearAnimation()
          throw new Error(`Clear failed and ${slotId} changed before rollback; newer user state was kept. ${error instanceof Error ? error.message : String(error)}`)
        }
        useAgentOperationReview.getState().clearAnimation()
        throw error
      }
      return describe(deps)
    },

    mount: async (structures, options) => {
      rejectInstance(options.instanceId)
      // Parse and validate the whole batch before the first visible mutation.
      const resolved = structures.map(resolveMount)
      await assertAgentMayMutateWorkspace('mount structures into the viewport', { signal: options.signal })
      assertAgentMayMutateWorkspaceNow('mount structures into the viewport', { signal: options.signal })
      throwIfViewportOperationCancelled(options.signal)
      const beforeManager = managerSnapshot()
      if (options.layout) setRequestedLayout(options.layout)
      const manager = useViewportManager.getState()
      const visible = visibleSlotIds()
      const empty = visible.filter((id) => {
        const slot = manager.viewports[id]
        return slot?.kind === 'crystal'
          && deps.readStructure(slot.storeInstance as unknown as ViewportStore) === null
      })
      const candidates = options.preserveExisting === false
        ? visible.filter((id) => manager.viewports[id]?.kind === 'crystal')
        : empty
      const targetIds = [...(options.targetSlotIds?.length ? options.targetSlotIds : candidates)]
      if (new Set(targetIds).size !== targetIds.length) {
        restoreManager(beforeManager)
        throw new Error('Mount targetSlotIds must be unique')
      }
      if (targetIds.length < resolved.length) {
        restoreManager(beforeManager)
        throw new Error(`Mount needs ${resolved.length} empty target panes, but only ${targetIds.length} are available`)
      }
      for (const viewportId of targetIds.slice(0, resolved.length)) {
        if (!visible.includes(viewportId)) {
          restoreManager(beforeManager)
          throw new Error(`Mount target pane ${viewportId} is not visible in the requested layout`)
        }
        const slot = manager.viewports[viewportId]
        if (!slot || slot.kind !== 'crystal') {
          restoreManager(beforeManager)
          throw new Error(`Mount target pane ${viewportId} is unavailable or is not a crystal pane`)
        }
        if (options.preserveExisting !== false
          && deps.readStructure(slot.storeInstance as unknown as ViewportStore) !== null) {
          restoreManager(beforeManager)
          throw new Error(`Mount target pane ${viewportId} became occupied; describe the viewport and prepare a new mount plan`)
        }
      }
      for (const expectation of options.expectedTargets ?? []) {
        const slot = manager.viewports[expectation.slotId]
        if (!slot || slot.kind !== 'crystal') {
          restoreManager(beforeManager)
          throw new Error(`Planned mount target ${expectation.slotId} is no longer a crystal pane`)
        }
        const identity = deps.readIdentity(slot.storeInstance as unknown as ViewportStore)
        if (identity.revision !== expectation.workspaceRevision
          || identity.structureFingerprint !== expectation.structureFingerprint
          || identity.trajectoryFingerprint !== expectation.trajectoryFingerprint) {
          restoreManager(beforeManager)
          throw new Error(
            `Planned mount target ${expectation.slotId} changed after confirmation; describe the viewport and prepare a new plan`,
          )
        }
      }

      const transactions = targetIds.slice(0, resolved.length).map((viewportId): MountedPaneTransaction => {
        const slot = useViewportManager.getState().viewports[viewportId]
        if (!slot || slot.kind !== 'crystal') throw new Error(`Target pane ${viewportId} is unavailable`)
        const store = slot.storeInstance as unknown as ViewportStore
        return {
          viewportId,
          store,
          beforeIdentity: deps.readIdentity(store),
          beforeStructure: deps.readStructure(store),
          beforeTrajectory: deps.readTrajectory(store),
          beforePresentation: captureMountPresentation(store),
        }
      })

      const changed: MountedPaneTransaction[] = []
      useAgentOperationReview.getState().beginAnimation({
        label: 'Mounting viewport candidates',
        viewportId: useViewportManager.getState().activeViewportId,
      })
      try {
        for (let index = 0; index < resolved.length; index++) {
          throwIfViewportOperationCancelled(options.signal)
          const transaction = transactions[index]
          const assertTargetUnchanged = () => {
            const slot = useViewportManager.getState().viewports[transaction.viewportId]
            if (!slot || slot.kind !== 'crystal'
              || slot.storeInstance as unknown as ViewportStore !== transaction.store
              || !sameIdentity(deps.readIdentity(transaction.store), transaction.beforeIdentity)) {
              throw new Error(`Target pane ${transaction.viewportId} changed before mount; no overwrite was made`)
            }
          }
          assertTargetUnchanged()
          changed.push(transaction)
          await deps.writeStructure(
            transaction.store,
            transaction.viewportId,
            resolved[index],
            {
              recordHistory: false,
              beforeStructureReplace: () => {
                throwIfViewportOperationCancelled(options.signal)
                assertTargetUnchanged()
              },
            },
          )
          throwIfViewportOperationCancelled(options.signal)
          transaction.afterIdentity = deps.readIdentity(transaction.store)
          transaction.afterPresentation = captureMountPresentation(transaction.store)
        }
      } catch (error) {
        let rollbackConflict = false
        for (const transaction of changed.reverse()) {
          if (!await restoreMountedPane(deps, transaction)) rollbackConflict = true
        }
        useAgentOperationReview.getState().clearAnimation()
        if (rollbackConflict) {
          throw new Error(`Mount failed and a target pane changed before rollback; newer user state was kept. ${error instanceof Error ? error.message : String(error)}`)
        }
        restoreManager(beforeManager)
        throw error
      }

      try {
        throwIfViewportOperationCancelled(options.signal)
        const expected = layoutStateSignature(deps)
        useAgentOperationReview.getState().openReview({
          label: 'Mounted viewport candidates',
          subject: {
            kind: 'workspace',
            summary: `${resolved.length} structure${resolved.length === 1 ? '' : 's'} → ${targetIds.slice(0, resolved.length).join(', ')}`,
            revert: async () => {
              if (layoutStateSignature(deps) !== expected) {
                throw new Error('A mounted pane changed after this operation; newer user changes were kept.')
              }
              for (const transaction of [...transactions].reverse()) {
                if (!await restoreMountedPane(deps, transaction)) {
                  throw new Error(`Mounted pane ${transaction.viewportId} changed while rollback was preparing; newer user state was kept.`)
                }
              }
              restoreManager(beforeManager)
            },
          },
        })
      } catch (error) {
        let rollbackConflict = false
        for (const transaction of [...transactions].reverse()) {
          if (!await restoreMountedPane(deps, transaction)) rollbackConflict = true
        }
        useAgentOperationReview.getState().clearAnimation()
        if (rollbackConflict) {
          throw new Error(`Mount could not open its review and a target changed before rollback; newer state was kept. ${error instanceof Error ? error.message : String(error)}`)
        }
        restoreManager(beforeManager)
        throw error
      }
      return describe(deps)
    },
  }

  return {
    viewport,
    listAppInstances: () => {
      const view = describe(deps, false)
      return [{
        instanceId: ZATOM_IN_PAGE_INSTANCE_ID,
        label: 'This browser tab',
        layout: view.layout,
        occupiedSlots: view.slots.filter((slot) => (slot.atomCount ?? 0) > 0).length,
        totalSlots: view.slots.length,
        current: true,
        openUrl: typeof window === 'undefined' ? null : window.location.href,
      }]
    },
  }
}
