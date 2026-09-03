/**
 * Viewport and asset-batch tools.
 *
 * These expose grid layout, batch mounting, and batch organization, which the
 * app already implements internally but never offered to an agent. Every tool
 * fails closed when the host does not provide the matching surface, matching
 * the existing focus/capture tools: a CLI agent must get an explicit error
 * rather than a plausible-looking success for a viewport that isn't there.
 */

import type {
  ZatomAssetBatchView,
  ZatomAssetsSurface,
  ZatomAppInstanceView,
  ZatomMountRequestStructure,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomViewportView,
} from './contracts'
import { GRID_SPECS, type GridLayout } from '../orchestration/viewportManager'
import {
  decideMount,
  describeMountPlan,
  MOUNT_CONFIRMATION_THRESHOLD,
  planMount,
  type MountPlan,
} from './mount-proposal'
import { toolError } from './tool-helpers'
import { assertAgentMayMutateWorkspace } from '../orchestration/agentOperationReviewStore'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, required }
}

const GRID_LAYOUT_NAMES = Object.keys(GRID_SPECS)
const LAYOUT_NAMES = [...GRID_LAYOUT_NAMES, 'free-right', 'free-bottom', 'free-l-shape']

function requireLayout(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const layout = String(value)
  if (!LAYOUT_NAMES.includes(layout)) {
    throw new Error(`Unknown layout "${layout}". Available layouts: ${LAYOUT_NAMES.join(', ')}`)
  }
  return layout
}

function requireGridLayout(value: unknown): GridLayout | undefined {
  if (value === undefined) return undefined
  const layout = String(value)
  if (!GRID_LAYOUT_NAMES.includes(layout)) {
    throw new Error(`Mount layout must be one of ${GRID_LAYOUT_NAMES.join(', ')}`)
  }
  return layout as GridLayout
}

/**
 * Names the target window. A host can bridge several app instances, so a write
 * must say which one it means; omitting this is only safe when exactly one is
 * connected, and the host fails closed otherwise. Use `app_instances` to list
 * the ids.
 */
const INSTANCE_ID_FIELD = {
  type: 'string',
  description: 'Target app instance id, from app_instances. Omit only when a single instance is connected.',
} as const

function optionalInstanceId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const id = String(value).trim()
  return id.length > 0 ? id : undefined
}

function summarizeViewport(view: ZatomViewportView): string {
  const filled = view.slots.filter((slot) => slot.structureLabel !== null).length
  const base = `${view.layout} grid on ${view.instanceId}: ${filled}/${view.slots.length} slots filled`
  // Put takeover guidance in the summary instead of leaving it only in data.
  // Models attend to the summary more reliably, and must not miss a rejection.
  if (!view.userTakeover) return base
  const { revertedLabel, intent } = view.userTakeover
  // Each rejection intent requires a different next step. A generic "reverted"
  // message would encourage the model to resubmit the action the user rejected.
  const guidance = {
    user_took_over:
      `The user reverted your last operation (${revertedLabel}) and is now editing by hand.`
      + ' Do not modify the structure until they hand control back; read-only inspection is still fine.',
    retry_differently:
      `The user reverted your last operation (${revertedLabel}) but still wants it done —`
      + ' just not that way. Propose a different approach; resubmitting the same operation will be rejected again.',
    replan_from_edits:
      `The user reverted your last operation (${revertedLabel}), edited the structure by hand, and handed control back.`
      + ' Re-read the current structure and re-plan from it — your earlier plan may no longer apply.',
    // This is the only record that is not a rejection: the plan is valid and
    // the user only wanted a preview. Preserve that distinction so the model
    // does not misread "show me the supercell" as a rejected supercell plan.
    preview_only:
      `The user asked to preview ${revertedLabel} and undid it after looking — this was not a rejection.`
      + ' Your plan still stands; continue with it as if the preview had not happened.',
  }[intent]
  return `${base}. ${guidance}`
}

/** Test seam: the takeover hand-off is only useful if it actually reaches the summary. */
export const summarizeViewportForTest = summarizeViewport

// ── viewport_describe ─────────────────────────────────────────────

const describeManifest: ZatomToolManifest = {
  name: 'viewport_describe',
  title: 'Describe the viewport grid',
  version: '1.0.0',
  description: 'Read the current viewport layout and every slot, including which structure occupies each slot and its atom count. Call this before mounting or rearranging so slot indices refer to what the user is actually seeing.',
  inputSchema: objectSchema({ instanceId: INSTANCE_ID_FIELD }),
  effects: { structure: 'none', workspace: 'read', visual: 'read' },
  tags: ['viewport', 'layout', 'agent'],
}

const viewportDescribeTool: ZatomToolDefinition<ZatomViewportView> = {
  manifest: describeManifest,
  execute: async (input, context) => {
    try {
      if (!context.viewport) throw new Error('This host did not provide a viewport surface')
      const view = await context.viewport.describe(optionalInstanceId(input.instanceId))
      return { ok: true, tool: describeManifest.name, summary: summarizeViewport(view), data: view }
    } catch (error) {
      return toolError(describeManifest.name, error)
    }
  },
}

// ── viewport_activate ─────────────────────────────────────────────

const activateManifest: ZatomToolManifest = {
  name: 'viewport_activate',
  title: 'Activate a viewport pane',
  version: '1.0.0',
  description:
    'Switch the active modeling workspace to one visible crystal pane from viewport_describe. '
    + 'This is the Agent equivalent of the user clicking a pane: subsequent viewer/scene/structure tools target it. '
    + 'Pass the currently active slot as expectedActiveViewportId; after switching, call viewer_observe before acting in the new pane.',
  inputSchema: objectSchema({
    slotId: {
      type: 'string',
      minLength: 1,
      description: 'Visible crystal pane to activate, from viewport_describe slots[].slotId.',
    },
    expectedActiveViewportId: {
      type: 'string',
      minLength: 1,
      description:
        'Pane that was active in viewport_describe. Optional only through WebMCP, where zatom_call_tool.expectedWorkspace supplies it.',
    },
    instanceId: INSTANCE_ID_FIELD,
  }, ['slotId']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['viewport', 'selection', 'agent'],
}

const viewportActivateTool: ZatomToolDefinition<ZatomViewportView> = {
  manifest: activateManifest,
  execute: async (input, context) => {
    try {
      if (!context.viewport) throw new Error('This host did not provide a viewport surface')
      const slotId = String(input.slotId ?? '').trim()
      if (!slotId) throw new Error('slotId is required')
      const expectedActiveViewportId = optionalInstanceId(input.expectedActiveViewportId)
        ?? context.expectedWorkspace?.viewportId
      if (!expectedActiveViewportId) {
        throw new Error(
          'expectedActiveViewportId is required. Call viewport_describe and pass the slot whose active field is true.',
        )
      }
      const view = await context.viewport.activate(slotId, {
        expectedActiveViewportId,
        instanceId: optionalInstanceId(input.instanceId),
        signal: context.signal,
      })
      const active = view.slots.find((slot) => slot.active)
      return {
        ok: true,
        tool: activateManifest.name,
        summary: `Active viewport is ${active?.slotId ?? slotId}${active?.structureLabel ? ` (${active.structureLabel})` : ''}. Re-observe it before the next operation.`,
        data: view,
      }
    } catch (error) {
      return toolError(activateManifest.name, error)
    }
  },
}

// ── viewport_set_layout ───────────────────────────────────────────

const setLayoutManifest: ZatomToolManifest = {
  name: 'viewport_set_layout',
  title: 'Set the viewport grid layout',
  version: '1.0.0',
  description: `Switch the viewport to a named layout. Grids: ${GRID_LAYOUT_NAMES.map((name) => `${name} (${GRID_SPECS[name as GridLayout].total})`).join(', ')}. Focused comparison layouts: free-right, free-bottom, free-l-shape.`,
  inputSchema: objectSchema({
    layout: { enum: LAYOUT_NAMES, description: 'Target grid layout' },
    instanceId: INSTANCE_ID_FIELD,
  }, ['layout']),
  effects: { structure: 'none', workspace: 'read', visual: 'write' },
  tags: ['viewport', 'layout', 'agent'],
}

const viewportSetLayoutTool: ZatomToolDefinition<ZatomViewportView> = {
  manifest: setLayoutManifest,
  execute: async (input, context) => {
    try {
      if (!context.viewport) throw new Error('This host did not provide a viewport surface')
      const layout = requireLayout(input.layout)
      if (!layout) throw new Error('layout is required')
      const view = await context.viewport.setLayout(layout, optionalInstanceId(input.instanceId), context.signal)
      return { ok: true, tool: setLayoutManifest.name, summary: summarizeViewport(view), data: view }
    } catch (error) {
      return toolError(setLayoutManifest.name, error)
    }
  },
}

// ── viewport_clear_pane ───────────────────────────────────────────

const clearManifest: ZatomToolManifest = {
  name: 'viewport_clear_pane',
  title: 'Clear a viewport pane',
  version: '1.0.0',
  description:
    'Empty one visible crystal pane without removing it or changing the layout. '
    + 'Copy its slot id, fingerprints, and revision from viewport_describe; stale targets fail closed. '
    + 'A review card lets the user restore it.',
  inputSchema: objectSchema({
    slotId: {
      type: 'string',
      minLength: 1,
    },
    targetStructureFingerprint: {
      type: ['string', 'null'],
    },
    targetTrajectoryFingerprint: {
      type: ['string', 'null'],
    },
    targetWorkspaceRevision: {
      type: 'integer',
      minimum: 0,
    },
    instanceId: INSTANCE_ID_FIELD,
  }, [
    'slotId',
    'targetStructureFingerprint',
    'targetTrajectoryFingerprint',
    'targetWorkspaceRevision',
  ]),
  effects: { structure: 'replace', workspace: 'write', visual: 'write' },
  tags: ['viewport', 'clear', 'workspace', 'agent'],
}

function requiredNullableFingerprint(value: unknown, field: string): string | null {
  if (value === null) return null
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`${field} must be a fingerprint string or null`)
}

function requiredWorkspaceRevision(value: unknown): number {
  const revision = Number(value)
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error('targetWorkspaceRevision must be a non-negative integer')
  }
  return revision
}

const viewportClearTool: ZatomToolDefinition<ZatomViewportView> = {
  manifest: clearManifest,
  execute: async (input, context) => {
    try {
      if (!context.viewport) throw new Error('This host did not provide a viewport surface')
      const slotId = String(input.slotId ?? '').trim()
      if (!slotId) throw new Error('slotId is required')
      const view = await context.viewport.clear(slotId, {
        instanceId: optionalInstanceId(input.instanceId),
        expectedTarget: {
          slotId,
          structureFingerprint: requiredNullableFingerprint(
            input.targetStructureFingerprint,
            'targetStructureFingerprint',
          ),
          trajectoryFingerprint: requiredNullableFingerprint(
            input.targetTrajectoryFingerprint,
            'targetTrajectoryFingerprint',
          ),
          workspaceRevision: requiredWorkspaceRevision(input.targetWorkspaceRevision),
        },
        signal: context.signal,
      })
      const target = view.slots.find((slot) => slot.slotId === slotId)
      return {
        ok: true,
        tool: clearManifest.name,
        summary: target?.atomCount === 0
          ? `Cleared ${slotId}; the pane remains in ${view.layout} and is ready for another structure.`
          : `${slotId} was already empty.`,
        data: view,
      }
    } catch (error) {
      return toolError(clearManifest.name, error)
    }
  },
}

// ── viewport_mount_structures ─────────────────────────────────────

const mountManifest: ZatomToolManifest = {
  name: 'viewport_mount_structures',
  title: 'Mount structures into viewport slots',
  version: '1.0.0',
  description: `Mount one or more structures into the viewport grid, choosing the smallest layout that fits unless a layout is given. Batches of more than ${MOUNT_CONFIRMATION_THRESHOLD} structures return a plan with a confirmationToken instead of acting; read the plan back to the user, then call again with that token to apply it. Reference saved structures by frameId or supply inline text with a format.`,
  inputSchema: objectSchema({
    structures: {
      type: 'array',
      minItems: 1,
      description: 'Structures to mount, in slot order',
      items: objectSchema({
        label: { type: 'string', minLength: 1, description: 'Name shown for this structure' },
        frameId: { type: 'string', description: 'Id of a saved workspace frame' },
        text: { type: 'string', description: 'Inline structure text; requires format' },
        format: { type: 'string', description: 'Format of inline text, e.g. cif, xyz, pdb' },
        atomCount: { type: 'integer', minimum: 0, description: 'Known atom count, used for the cost estimate' },
      }, ['label']),
    },
    layout: { enum: GRID_LAYOUT_NAMES, description: 'Force a specific grid instead of the smallest that preserves existing panes and fits the candidates' },
    preserveExisting: {
      type: 'boolean',
      default: true,
      description: 'Fill empty/new panes and preserve existing structures. Set false only when the user explicitly wants replacement.',
    },
    instanceId: INSTANCE_ID_FIELD,
    confirmationToken: { type: 'string', description: 'Token from a previous plan, to apply that plan' },
  }, ['structures']),
  effects: { structure: 'none', workspace: 'read', visual: 'write' },
  tags: ['viewport', 'mount', 'layout', 'agent'],
}

interface MountToolData {
  status: 'mounted' | 'confirmation-required'
  plan: MountPlan
  confirmationToken?: string
  viewport?: ZatomViewportView
}

const viewportMountStructuresTool: ZatomToolDefinition<MountToolData> = {
  manifest: mountManifest,
  execute: async (input, context) => {
    try {
      if (!context.viewport) throw new Error('This host did not provide a viewport surface')
      const requested = input.structures as ZatomMountRequestStructure[]
      for (const structure of requested) {
        if (structure.text !== undefined && structure.format === undefined) {
          throw new Error(`Structure "${structure.label}" supplies text without a format`)
        }
        if (structure.text === undefined && structure.frameId === undefined) {
          throw new Error(`Structure "${structure.label}" needs either a frameId or text with a format`)
        }
      }
      const layout = requireGridLayout(input.layout)
      // The plan is keyed to the instance it targets so a token cannot be
      // replayed against a different window than the user approved.
      const target = optionalInstanceId(input.instanceId)
      const current = await context.viewport.describe(target)
      const preserveExisting = input.preserveExisting !== false
      const plan = planMount(current.instanceId, requested, layout, {
        preserveExisting,
        occupiedSlotIndices: current.slots
          .filter((slot) => (slot.atomCount ?? 0) > 0)
          .map((slot) => slot.slotIndex),
        slotBindings: current.slots.map((slot) => ({
          slotIndex: slot.slotIndex,
          slotId: slot.slotId,
          structureFingerprint: slot.structureFingerprint ?? null,
          trajectoryFingerprint: slot.trajectoryFingerprint ?? null,
          workspaceRevision: slot.workspaceRevision ?? null,
        })),
      })
      const decision = decideMount(plan, {
        confirmationToken: input.confirmationToken === undefined ? undefined : String(input.confirmationToken),
      })
      if (decision.kind === 'confirm') {
        return {
          ok: true,
          tool: mountManifest.name,
          summary: `Confirm before mounting: ${describeMountPlan(plan)}`,
          data: { status: 'confirmation-required', plan, confirmationToken: decision.confirmationToken },
        }
      }
      if (input.confirmationToken !== undefined && plan.unboundTargetCount > 0) {
        throw new Error(
          'This confirmed mount includes panes that were not visible when planned. '
          + `Set the viewport to ${plan.layout}, then call viewport_mount_structures again to bind every target revision before confirming.`,
        )
      }
      const mountable = requested.slice(0, plan.assignments.length)
      // Address the same window the plan was keyed to, so a confirmed batch
      // cannot land in a different viewport than the one described back.
      const view = await context.viewport.mount(mountable, {
        ...(input.layout === undefined && current.layout.startsWith('free(') ? {} : { layout: plan.layout }),
        instanceId: current.instanceId,
        preserveExisting,
        targetSlotIds: plan.assignments.map((assignment) => (
          assignment.slotId
          ?? current.slots.find((slot) => slot.slotIndex === assignment.slotIndex)?.slotId
          ?? `vp-${assignment.slotIndex + 1}`
        )),
        expectedTargets: plan.assignments.flatMap((assignment) => (
          assignment.slotId && assignment.expectedWorkspaceRevision !== null
            ? [{
                slotId: assignment.slotId,
                structureFingerprint: assignment.expectedStructureFingerprint,
                trajectoryFingerprint: assignment.expectedTrajectoryFingerprint,
                workspaceRevision: assignment.expectedWorkspaceRevision,
              }]
            : []
        )),
        signal: context.signal,
      })
      return {
        ok: true,
        tool: mountManifest.name,
        summary: `Mounted ${describeMountPlan(plan)}`,
        data: { status: 'mounted', plan, viewport: view },
      }
    } catch (error) {
      return toolError(mountManifest.name, error)
    }
  },
}

// ── assets_* ──────────────────────────────────────────────────────

function summarizeBatches(batches: ZatomAssetBatchView[]): string {
  const active = batches.find((batch) => batch.active)
  return `${batches.length} batches; active: ${active ? `${active.name} (${active.frameIds.length} frames)` : 'none'}`
}

function assetsManifest(
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
  /**
   * Whether the tool mutates the workspace. Passed explicitly because it cannot
   * be inferred from the argument list: `assets_create_batch` takes only an
   * optional name yet writes, and MCP derives its readOnly/destructive hints
   * from this, so guessing would mislabel a mutation as a safe read.
   */
  workspace: 'read' | 'write' = 'write',
): ZatomToolManifest {
  return {
    name,
    title,
    version: '1.0.0',
    // Every batch tool accepts a target window on top of its own arguments.
    inputSchema: objectSchema({ ...properties, instanceId: INSTANCE_ID_FIELD }, required),
    description,
    effects: { structure: 'none', workspace, visual: 'none' },
    tags: ['assets', 'batch', 'workspace', 'agent'],
  }
}

function assetsTool(
  manifest: ZatomToolManifest,
  run: (
    input: Record<string, unknown>,
    surface: ZatomAssetsSurface,
    instanceId: string | undefined,
  ) => Promise<ZatomAssetBatchView[]>,
): ZatomToolDefinition<{ batches: ZatomAssetBatchView[] }> {
  return {
    manifest,
    execute: async (input, context) => {
      try {
        if (!context.assets) throw new Error('This host did not provide a workspace assets surface')
        // Batch tools that write workspace state must honor the takeover gate.
        // After the user chooses "Revert, I'll take over", creating or renaming
        // batches or moving frames would still rearrange the workspace they are
        // editing. That is an unauthorized write even if atom coordinates stay put.
        //
        // Derive this decision from the manifest's existing workspace effect,
        // rather than maintaining another tool list. New batch tools receive the
        // guard when they declare 'write', and the exhaustive domains test catches
        // an omitted declaration.
        if (manifest.effects.workspace === 'write') {
          await assertAgentMayMutateWorkspace(manifest.title.toLowerCase())
        }
        const batches = await run(input, context.assets, optionalInstanceId(input.instanceId))
        return { ok: true, tool: manifest.name, summary: summarizeBatches(batches), data: { batches } }
      } catch (error) {
        return toolError(manifest.name, error)
      }
    },
  }
}

const assetsListBatchesTool = assetsTool(
  assetsManifest(
    'assets_list_batches',
    'List workspace asset batches',
    'List every asset batch in the active workspace with its frame ids, so structures can be filed into or moved between batches by id.',
    {},
    [],
    'read',
  ),
  async (_input, assets, instanceId) => assets.listBatches(instanceId),
)

const assetsCreateBatchTool = assetsTool(
  assetsManifest(
    'assets_create_batch',
    'Create an asset batch',
    'Create a named asset batch in the active workspace and make it active. Use this to group related structures, for example one batch per calculation run.',
    { name: { type: 'string', minLength: 1, description: 'Batch name; defaults to a numbered name' } },
  ),
  async (input, assets, instanceId) => assets.createBatch(
    input.name === undefined ? undefined : String(input.name),
    instanceId,
  ),
)

const assetsRenameBatchTool = assetsTool(
  assetsManifest(
    'assets_rename_batch',
    'Rename an asset batch',
    'Rename an existing asset batch. Use assets_list_batches first to get the batch id.',
    {
      batchId: { type: 'string', minLength: 1 },
      name: { type: 'string', minLength: 1 },
    },
    ['batchId', 'name'],
  ),
  async (input, assets, instanceId) => assets.renameBatch(String(input.batchId), String(input.name), instanceId),
)

const assetsMoveFramesTool = assetsTool(
  assetsManifest(
    'assets_move_frames',
    'Move frames into an asset batch',
    'Move saved structure frames into another asset batch. Frames keep their data; only their batch membership changes.',
    {
      frameIds: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
      toBatchId: { type: 'string', minLength: 1 },
    },
    ['frameIds', 'toBatchId'],
  ),
  async (input, assets, instanceId) => assets.moveFrames(
    (input.frameIds as unknown[]).map(String),
    String(input.toBatchId),
    instanceId,
  ),
)

// ── app_instances ─────────────────────────────────────────────────

const appInstancesManifest: ZatomToolManifest = {
  name: 'app_instances',
  title: 'List connected app instances',
  version: '1.0.0',
  description: 'List every connected app window with its layout and slot usage. Pass an instanceId to viewport tools to target a specific window, or open the returned openUrl to start another one.',
  inputSchema: objectSchema({}),
  effects: { structure: 'none', workspace: 'read', visual: 'read' },
  tags: ['session', 'instances', 'agent'],
}

const appInstancesTool: ZatomToolDefinition<{ instances: ZatomAppInstanceView[] }> = {
  manifest: appInstancesManifest,
  execute: async (_input, context) => {
    try {
      if (!context.listAppInstances) throw new Error('This host did not provide app instance discovery')
      const instances = await context.listAppInstances()
      const current = instances.find((instance) => instance.current)
      return {
        ok: true,
        tool: appInstancesManifest.name,
        summary: `${instances.length} connected instance(s); current: ${current?.instanceId ?? 'none'}`,
        data: { instances },
      }
    } catch (error) {
      return toolError(appInstancesManifest.name, error)
    }
  },
}

export const VIEWPORT_ZATOM_AGENT_TOOLS: ZatomToolDefinition<unknown>[] = [
  viewportDescribeTool as ZatomToolDefinition<unknown>,
  viewportActivateTool as ZatomToolDefinition<unknown>,
  viewportSetLayoutTool as ZatomToolDefinition<unknown>,
  viewportClearTool as ZatomToolDefinition<unknown>,
  viewportMountStructuresTool as ZatomToolDefinition<unknown>,
  assetsListBatchesTool as ZatomToolDefinition<unknown>,
  assetsCreateBatchTool as ZatomToolDefinition<unknown>,
  assetsRenameBatchTool as ZatomToolDefinition<unknown>,
  assetsMoveFramesTool as ZatomToolDefinition<unknown>,
  appInstancesTool as ZatomToolDefinition<unknown>,
]
