/** Browser-page executor for requests from the Vite CLI bridge. */

import type {
  CameraLookAtRequest,
  CameraTargetSpec,
  CameraViewSpec,
  GuidanceAnnotationInput,
  GuidanceCandidateInput,
  GuidanceClearScope,
  InspectionTarget,
  ValidationCheck,
  ViewerStylePatch,
  Vec3,
  ZatomMountRequestStructure,
  ZatomWorkspaceIdentity,
} from '../agent/contracts'
import {
  activeViewportToolContext,
  commitActiveViewportStructure,
  commitActiveViewportWorkspace,
  readActiveViewportStructure,
  readActiveViewportTrajectory,
  readActiveViewportWorkspaceIdentity,
} from '../agent/viewer-context'
import { fingerprintStructure } from '../agent/structure-math'
import { buildStructureChangeSet } from '../agent/operations'
import { parseZatomStructure } from '../agent/structure-validation'
import { useAgentActivity, type AgentActivityTier } from '../orchestration/agentActivityStore'
import { parseZatomTrajectory } from '../agent/trajectory'
import { readHostWriteMode } from '../orchestration/hostAccessStore'
import { useViewportManager } from '../orchestration/viewportManager'
import {
  commitLocalWorkspaceState,
  createLocalWorkspaceBatch,
  moveLocalWorkspaceFrames,
  readLocalWorkspaceState,
  renameLocalWorkspaceBatch,
} from '../host/localWorkspace'
import {
  parseZatomViewportBridgeRequest,
  ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
  type ZatomViewportBridgeRequest,
  type ZatomViewportBridgeResponse,
  type ZatomViewportCaptureRequest,
} from './viewport-contracts'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactRecord(value: unknown, label: string, fields: readonly string[]): Record<string, unknown> {
  const parsed = record(value, label)
  const unknown = Object.keys(parsed).filter((field) => !fields.includes(field))
  if (unknown.length) throw new Error(`${label} has unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`)
  return parsed
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`)
  return value
}

function boundedString(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > maxLength) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} string of at most ${maxLength} characters`)
  }
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function parseVec3(value: unknown, label: string, integer = false): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain exactly three numbers`)
  const vector = value.map((entry, index) => finiteNumber(entry, `${label}[${index}]`)) as Vec3
  if (integer && vector.some((entry) => !Number.isInteger(entry))) throw new Error(`${label} must contain integers`)
  return vector
}

function parseAtomIds(value: unknown, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new Error(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`)
  }
  return value.map((entry, index) => boundedString(entry, `${label}[${index}]`, 256))
}

const STANDARD_CAMERA_VIEWS = new Set(['front', 'back', 'top', 'bottom', 'left', 'right', 'iso', 'a', 'b', 'c'])

function parseCameraView(value: unknown, label: string): CameraViewSpec {
  if (typeof value === 'string') {
    if (!STANDARD_CAMERA_VIEWS.has(value)) throw new Error(`${label} is not a supported standard view`)
    return value as CameraViewSpec
  }
  const input = record(value, label)
  if ('direction' in input) {
    const exact = exactRecord(input, label, ['direction'])
    return { direction: parseVec3(exact.direction, `${label}.direction`) }
  }
  if ('hkl' in input) {
    const exact = exactRecord(input, label, ['hkl'])
    return { hkl: parseVec3(exact.hkl, `${label}.hkl`, true) }
  }
  throw new Error(`${label} requires direction or hkl`)
}

function parseCameraTarget(value: unknown, label: string): CameraTargetSpec {
  if (value === 'selection' || value === 'all') return value
  const input = record(value, label)
  if ('atomIds' in input) {
    const exact = exactRecord(input, label, ['atomIds'])
    return { atomIds: parseAtomIds(exact.atomIds, `${label}.atomIds`) }
  }
  if ('point' in input) {
    const exact = exactRecord(input, label, ['point', 'radius'])
    const radius = exact.radius === undefined ? undefined : finiteNumber(exact.radius, `${label}.radius`)
    if (radius !== undefined && (radius < 0.1 || radius > 1_000_000)) {
      throw new Error(`${label}.radius must be within [0.1, 1000000]`)
    }
    return {
      point: parseVec3(exact.point, `${label}.point`),
      ...(radius === undefined ? {} : { radius }),
    }
  }
  throw new Error(`${label} requires atomIds or point`)
}

function parseDuration(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  const duration = finiteNumber(value, label)
  if (duration < 0 || duration > 8_000) throw new Error(`${label} must be within [0, 8000]`)
  return duration
}

function parseCameraLookAtRequest(value: unknown, label: string): CameraLookAtRequest {
  const input = exactRecord(value, label, ['target', 'view', 'durationMs'])
  if (input.target === undefined) throw new Error(`${label} requires target`)
  return {
    target: parseCameraTarget(input.target, `${label}.target`),
    ...(input.view === undefined ? {} : { view: parseCameraView(input.view, `${label}.view`) }),
    ...(input.durationMs === undefined ? {} : { durationMs: parseDuration(input.durationMs, `${label}.durationMs`) }),
  }
}

function parseCaption(value: unknown, label: string): string | null {
  if (value === null) return null
  return boundedString(value, label, 140, true)
}

function parseGuidanceAnnotations(value: unknown): GuidanceAnnotationInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw new Error('annotations must contain 1 to 24 entries')
  }
  return value.map((entry, index) => {
    const label = `annotations[${index}]`
    const input = exactRecord(entry, label, ['id', 'atomIds', 'position', 'label', 'kind'])
    const hasAtomIds = input.atomIds !== undefined
    const hasPosition = input.position !== undefined
    if (hasAtomIds === hasPosition) throw new Error(`${label} requires exactly one of atomIds or position`)
    const id = input.id === undefined ? undefined : boundedString(input.id, `${label}.id`, 40)
    const text = boundedString(input.label, `${label}.label`, 60)
    const kind = input.kind === undefined ? undefined : input.kind
    if (kind !== undefined && kind !== 'info' && kind !== 'target' && kind !== 'warn') {
      throw new Error(`${label}.kind must be info, target, or warn`)
    }
    return hasAtomIds
      ? {
          ...(id === undefined ? {} : { id }),
          atomIds: parseAtomIds(input.atomIds, `${label}.atomIds`),
          label: text,
          ...(kind === undefined ? {} : { kind }),
        }
      : {
          ...(id === undefined ? {} : { id }),
          position: parseVec3(input.position, `${label}.position`),
          label: text,
          ...(kind === undefined ? {} : { kind }),
        }
  })
}

function parseGuidanceCandidates(value: unknown): GuidanceCandidateInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 9) {
    throw new Error('items must contain 1 to 9 candidates')
  }
  return value.map((entry, index) => {
    const label = `items[${index}]`
    const input = exactRecord(entry, label, ['atomIds', 'position', 'anchorPositions', 'label', 'detail'])
    const hasAtomIds = input.atomIds !== undefined
    const hasPosition = input.position !== undefined
    if (!hasAtomIds && !hasPosition) throw new Error(`${label} requires atomIds, position, or both`)
    if (input.anchorPositions !== undefined && !Array.isArray(input.anchorPositions)) {
      throw new Error(`${label}.anchorPositions must be an array`)
    }
    const parsed = {
      ...(hasAtomIds ? { atomIds: parseAtomIds(input.atomIds, `${label}.atomIds`) } : {}),
      ...(hasPosition ? { position: parseVec3(input.position, `${label}.position`) } : {}),
      ...(input.anchorPositions === undefined ? {} : {
        anchorPositions: input.anchorPositions.map((position, anchorIndex) => (
          parseVec3(position, `${label}.anchorPositions[${anchorIndex}]`)
        )),
      }),
      label: boundedString(input.label, `${label}.label`, 40),
      ...(input.detail === undefined ? {} : { detail: boundedString(input.detail, `${label}.detail`, 80, true) }),
    }
    return parsed as GuidanceCandidateInput
  })
}

function parseViewerStylePatch(value: unknown): ViewerStylePatch {
  const input = exactRecord(value, 'viewer style patch', [
    'stylePresetId', 'cameraProjection', 'hideHydrogens', 'keptHydrogens', 'showAtomRings',
    'fieldSlice', 'surface',
  ])
  const patch: ViewerStylePatch = {}
  if (input.stylePresetId !== undefined) patch.stylePresetId = boundedString(input.stylePresetId, 'stylePresetId', 128)
  if (input.cameraProjection !== undefined) {
    if (input.cameraProjection !== 'perspective' && input.cameraProjection !== 'orthographic') {
      throw new Error('cameraProjection must be perspective or orthographic')
    }
    patch.cameraProjection = input.cameraProjection
  }
  if (input.hideHydrogens !== undefined) {
    if (typeof input.hideHydrogens !== 'boolean') throw new Error('hideHydrogens must be boolean')
    patch.hideHydrogens = input.hideHydrogens
  }
  if (input.keptHydrogens !== undefined) patch.keptHydrogens = boundedString(input.keptHydrogens, 'keptHydrogens', 10_000, true)
  if (input.showAtomRings !== undefined) {
    if (typeof input.showAtomRings !== 'boolean') throw new Error('showAtomRings must be boolean')
    patch.showAtomRings = input.showAtomRings
  }
  if (input.fieldSlice !== undefined) {
    const fieldSlice = exactRecord(input.fieldSlice, 'fieldSlice style patch', [
      'enabled', 'mode', 'opacity', 'contours',
    ])
    const parsed: NonNullable<ViewerStylePatch['fieldSlice']> = {}
    if (fieldSlice.enabled !== undefined) {
      if (typeof fieldSlice.enabled !== 'boolean') throw new Error('fieldSlice.enabled must be boolean')
      parsed.enabled = fieldSlice.enabled
    }
    if (fieldSlice.mode !== undefined) {
      if (fieldSlice.mode !== 'overlay' && fieldSlice.mode !== 'slice-only') {
        throw new Error('fieldSlice.mode must be overlay or slice-only')
      }
      parsed.mode = fieldSlice.mode
    }
    if (fieldSlice.opacity !== undefined) {
      const opacity = finiteNumber(fieldSlice.opacity, 'fieldSlice.opacity')
      if (opacity < 0.1 || opacity > 1) throw new Error('fieldSlice.opacity must be within [0.1, 1]')
      parsed.opacity = opacity
    }
    if (fieldSlice.contours !== undefined) {
      const contours = nonNegativeInteger(fieldSlice.contours, 'fieldSlice.contours')
      if (contours > 20) throw new Error('fieldSlice.contours must be within [0, 20]')
      parsed.contours = contours
    }
    patch.fieldSlice = parsed
  }
  if (input.surface !== undefined) {
    const surface = exactRecord(input.surface, 'surface style patch', [
      'visible', 'isoValue', 'resolution', 'opacity', 'selectedOrbitalIndex', 'colormap', 'range', 'showExtrema',
    ])
    const parsed: NonNullable<ViewerStylePatch['surface']> = {}
    if (surface.visible !== undefined) {
      if (typeof surface.visible !== 'boolean') throw new Error('surface.visible must be boolean')
      parsed.visible = surface.visible
    }
    if (surface.isoValue !== undefined) parsed.isoValue = finiteNumber(surface.isoValue, 'surface.isoValue')
    if (surface.resolution !== undefined) {
      const resolution = nonNegativeInteger(surface.resolution, 'surface.resolution')
      if (resolution < 12 || resolution > 80) throw new Error('surface.resolution must be within [12, 80]')
      parsed.resolution = resolution
    }
    if (surface.opacity !== undefined) parsed.opacity = finiteNumber(surface.opacity, 'surface.opacity')
    if (surface.selectedOrbitalIndex !== undefined) {
      parsed.selectedOrbitalIndex = nonNegativeInteger(surface.selectedOrbitalIndex, 'surface.selectedOrbitalIndex')
    }
    if (surface.colormap !== undefined) parsed.colormap = boundedString(surface.colormap, 'surface.colormap', 128)
    if (surface.range !== undefined) {
      if (surface.range === null) parsed.range = null
      else {
        const range = exactRecord(surface.range, 'surface.range', ['min', 'max'])
        parsed.range = {
          min: finiteNumber(range.min, 'surface.range.min'),
          max: finiteNumber(range.max, 'surface.range.max'),
        }
      }
    }
    if (surface.showExtrema !== undefined) {
      if (typeof surface.showExtrema !== 'boolean') throw new Error('surface.showExtrema must be boolean')
      parsed.showExtrema = surface.showExtrema
    }
    patch.surface = parsed
  }
  return patch
}

function viewportEnvelope(viewportId: string, key: string, value: unknown): Record<string, unknown> {
  return { viewportId, [key]: value }
}

async function activeWorkspaceIdentity() {
  const read = activeViewportToolContext.workspaceIdentity
  if (!read) throw new Error('The active viewport does not expose workspace revision identity')
  return read()
}

function assertActiveViewport(expectedViewportId: string | undefined): string {
  const activeViewportId = useViewportManager.getState().activeViewportId
  if (expectedViewportId !== undefined && activeViewportId !== expectedViewportId) {
    throw new Error(`Active viewport changed from ${expectedViewportId} to ${activeViewportId}`)
  }
  return activeViewportId
}

/**
 * A fingerprint guard is mandatory for destructive operations.
 *
 * `undefined` is rejected rather than interpreted as "skip validation". The old
 * boundary treated a missing field as permission, so clients that omitted it,
 * including the dev bridge and hand-written MCP clients, could replace a structure
 * without a guard. An explicit `null` is the only way to state that an empty
 * workspace is expected.
 */
function requiredFingerprint(value: unknown, label: string): string | null {
  if (value === undefined) {
    throw new Error(
      `${label} is required for destructive operations: pass the structure fingerprint you `
      + 'last read, or null if you expect an empty workspace. This is what makes a stale '
      + 'overwrite fail instead of silently discarding newer state.',
    )
  }
  if (value === null) return null
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} must be a non-empty string or null`)
  }
  return value
}

const VISUAL_WORKSPACE_EXPECTATION_FIELDS = [
  'expectedViewportId',
  'expectedRevision',
  'expectedStructureFingerprint',
  'expectedTrajectoryFingerprint',
] as const

function requiredWorkspaceFingerprint(value: unknown, label: string): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value) {
    throw new Error(`${label} is required and must be a non-empty string or null`)
  }
  return value
}

function parseVisualWorkspaceExpectation(
  payload: Record<string, unknown>,
  label: string,
): ZatomWorkspaceIdentity {
  return {
    viewportId: boundedString(payload.expectedViewportId, `${label}.expectedViewportId`, 128),
    revision: nonNegativeInteger(payload.expectedRevision, `${label}.expectedRevision`),
    structureFingerprint: requiredWorkspaceFingerprint(
      payload.expectedStructureFingerprint,
      `${label}.expectedStructureFingerprint`,
    ),
    trajectoryFingerprint: requiredWorkspaceFingerprint(
      payload.expectedTrajectoryFingerprint,
      `${label}.expectedTrajectoryFingerprint`,
    ),
  }
}

/**
 * Renderer-side compare-and-set for UI mutations. The out-of-process host
 * observes this identity in one bridge message and sends it in the next; pane
 * switches and canonical edits in that gap must fail before the first visual
 * store action runs.
 */
function assertVisualWorkspace(
  payload: Record<string, unknown>,
  operation: string,
): string {
  const expected = parseVisualWorkspaceExpectation(payload, operation)
  assertActiveViewport(expected.viewportId)
  // Deliberately synchronous: these reads and the following surface call run
  // in one renderer turn, leaving no await/microtask window in which a pane or
  // structure can change after the comparison but before the visual action.
  const actual = readActiveViewportWorkspaceIdentity()
  if (actual.viewportId !== expected.viewportId
    || actual.revision !== expected.revision
    || actual.structureFingerprint !== expected.structureFingerprint
    || actual.trajectoryFingerprint !== expected.trajectoryFingerprint) {
    throw new Error(
      `Active workspace changed before ${operation}; expected ${expected.viewportId}@r${expected.revision}, `
      + `received ${actual.viewportId}@r${actual.revision}`,
    )
  }
  return expected.viewportId
}

function assertStructureIdentity(expected: string | null): void {
  const current = readActiveViewportStructure()
  const actual = current ? fingerprintStructure(current) : null
  if (actual !== expected) {
    throw new Error(`Active structure changed; expected ${expected ?? 'empty'}, received ${actual ?? 'empty'}`)
  }
}

function describeWorkspaceBatches(): Record<string, unknown>[] {
  const state = readLocalWorkspaceState()
  const workspace = state.workspaces.find((candidate) => candidate.id === state.activeWorkspaceId)
  if (!workspace) return []
  return workspace.batches.map((batch) => ({
    id: batch.id,
    name: batch.name,
    frameIds: [...batch.frameIds],
    activeFrameId: batch.activeFrameId,
    active: batch.id === workspace.activeBatchId,
  }))
}

/**
 * Human-readable wording and severity for each operation in the Agent activity bar.
 *
 * Show a sentence, not an internal operation name: "Reading the current structure"
 * tells a user whether to wait, while `read-structure` does not. Keep tiers aligned
 * with domains.ts. Only operations that replace what the user sees are mutations;
 * camera and selection changes remain allowed during takeover.
 */
const OPERATION_ACTIVITY: Record<
  Exclude<ZatomViewportBridgeRequest['operation'], 'read-host-write-mode'>,
  { label: string; tier: AgentActivityTier }
> = {
  'read-structure': { label: 'Reading the current structure', tier: 'observe' },
  'read-trajectory': { label: 'Reading the trajectory', tier: 'observe' },
  'read-workspace-identity': { label: 'Reading the workspace revision', tier: 'observe' },
  'commit-structure': { label: 'Applying a structure change', tier: 'mutate' },
  'commit-workspace': { label: 'Applying a structure and trajectory', tier: 'mutate' },
  'write-trajectory': { label: 'Applying a trajectory', tier: 'mutate' },
  'focus-target': { label: 'Moving the camera', tier: 'observe' },
  'apply-viewer-selection': { label: 'Updating the selection', tier: 'observe' },
  'capture-viewport': { label: 'Capturing the viewport', tier: 'observe' },
  'read-viewer-scene': { label: 'Reading the live viewport', tier: 'observe' },
  'camera-look-at': { label: 'Moving the camera', tier: 'observe' },
  'camera-set-view': { label: 'Changing the viewing angle', tier: 'observe' },
  'guidance-read': { label: 'Reading viewport guidance', tier: 'observe' },
  'guidance-set-plan': { label: 'Showing the modeling plan', tier: 'observe' },
  'guidance-advance': { label: 'Updating the modeling plan', tier: 'observe' },
  'guidance-set-caption': { label: 'Updating the viewport caption', tier: 'observe' },
  'guidance-annotate': { label: 'Marking the viewport', tier: 'observe' },
  'guidance-present-candidates': { label: 'Showing candidate sites', tier: 'observe' },
  'guidance-focus-candidate': { label: 'Highlighting a candidate site', tier: 'observe' },
  'guidance-candidate-status': { label: 'Waiting for your candidate choice', tier: 'observe' },
  'guidance-clear': { label: 'Clearing viewport guidance', tier: 'observe' },
  'viewer-style-read': { label: 'Reading the viewport style', tier: 'observe' },
  'viewer-style-apply': { label: 'Updating the viewport style', tier: 'observe' },
  'proposal-propose': { label: 'Previewing a structure change', tier: 'compute' },
  'proposal-read-candidate': { label: 'Reading the current structure preview', tier: 'observe' },
  'proposal-revise': { label: 'Adjusting the structure preview', tier: 'compute' },
  'proposal-status': { label: 'Checking the structure preview', tier: 'observe' },
  'proposal-withdraw': { label: 'Withdrawing the structure preview', tier: 'observe' },
  'viewport-describe': { label: 'Inspecting the viewport', tier: 'observe' },
  'viewport-activate': { label: 'Switching the active viewport', tier: 'observe' },
  'viewport-set-layout': { label: 'Changing the viewport layout', tier: 'mutate' },
  'viewport-clear': { label: 'Clearing a viewport pane', tier: 'mutate' },
  'viewport-mount': { label: 'Mounting structures into the viewport', tier: 'mutate' },
  'assets-list-batches': { label: 'Listing asset batches', tier: 'observe' },
  'assets-create-batch': { label: 'Creating an asset batch', tier: 'compute' },
  'assets-rename-batch': { label: 'Renaming an asset batch', tier: 'compute' },
  'assets-move-frames': { label: 'Moving frames between batches', tier: 'compute' },
}

async function executeRequest(
  request: ZatomViewportBridgeRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Viewport bridge request was cancelled')
  }
  switch (request.operation) {
    case 'read-structure': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'read-structure payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const structure = readActiveViewportStructure()
      const identity = await activeWorkspaceIdentity()
      if (identity.viewportId !== viewportId) throw new Error('Workspace identity changed while reading the structure')
      return { viewportId, structure, identity }
    }
    case 'read-trajectory': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'read-trajectory payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const trajectory = readActiveViewportTrajectory()
      const identity = await activeWorkspaceIdentity()
      if (identity.viewportId !== viewportId) throw new Error('Workspace identity changed while reading the trajectory')
      return { viewportId, trajectory, identity }
    }
    case 'read-workspace-identity': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'read-workspace-identity payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const identity = await activeWorkspaceIdentity()
      if (identity.viewportId !== viewportId) throw new Error('Workspace identity does not match the active viewport')
      return { viewportId, identity }
    }
    case 'commit-structure': {
      const payload = record(request.payload, 'commit-structure payload')
      const expectedViewportId = optionalString(payload.expectedViewportId, 'expectedViewportId')
      const expectedStructureFingerprint = requiredFingerprint(
        payload.expectedStructureFingerprint,
        'expectedStructureFingerprint',
      )
      const expectedRevision = nonNegativeInteger(payload.expectedRevision, 'expectedRevision')
      const structure = parseZatomStructure(payload.structure)
      await commitActiveViewportStructure(structure, {
        ...(expectedViewportId ? { expectedViewportId } : {}),
        expectedStructureFingerprint,
        expectedRevision,
        signal,
      })
      const identity = await activeWorkspaceIdentity()
      return {
        viewportId: expectedViewportId ?? useViewportManager.getState().activeViewportId,
        structureFingerprint: fingerprintStructure(structure),
        identity,
      }
    }
    case 'commit-workspace': {
      const payload = record(request.payload, 'commit-workspace payload')
      const expectedViewportId = optionalString(payload.expectedViewportId, 'expectedViewportId')
      const expectedStructureFingerprint = requiredFingerprint(
        payload.expectedStructureFingerprint,
        'expectedStructureFingerprint',
      )
      const expectedRevision = nonNegativeInteger(payload.expectedRevision, 'expectedRevision')
      const structure = parseZatomStructure(payload.structure)
      const trajectory = parseZatomTrajectory(payload.trajectory, { structure })
      await commitActiveViewportWorkspace(structure, trajectory, {
        ...(expectedViewportId ? { expectedViewportId } : {}),
        expectedStructureFingerprint,
        expectedRevision,
        signal,
      })
      const identity = await activeWorkspaceIdentity()
      return {
        viewportId: expectedViewportId ?? useViewportManager.getState().activeViewportId,
        structureFingerprint: fingerprintStructure(structure),
        identity,
      }
    }
    case 'write-trajectory': {
      const payload = record(request.payload, 'write-trajectory payload')
      const expectedViewportId = optionalString(payload.expectedViewportId, 'expectedViewportId')
      assertActiveViewport(expectedViewportId)
      assertStructureIdentity(requiredFingerprint(
        payload.expectedStructureFingerprint,
        'expectedStructureFingerprint',
      ))
      const expectedRevision = nonNegativeInteger(payload.expectedRevision, 'expectedRevision')
      const before = await activeWorkspaceIdentity()
      if (before.revision !== expectedRevision) {
        throw new Error(`Active workspace revision changed; expected r${expectedRevision}, received r${before.revision}`)
      }
      const structure = readActiveViewportStructure()
      if (!structure) throw new Error('Cannot write a trajectory without an active structure')
      const trajectory = parseZatomTrajectory(payload.trajectory, { structure })
      await activeViewportToolContext.writeTrajectory!(trajectory, before, signal)
      return {
        viewportId: expectedViewportId ?? useViewportManager.getState().activeViewportId,
        identity: await activeWorkspaceIdentity(),
      }
    }
    case 'focus-target': {
      const payload = exactRecord(request.payload, 'focus-target payload', [
        'target', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (!payload.target || typeof payload.target !== 'object' || Array.isArray(payload.target)) {
        throw new Error('focus-target payload requires target')
      }
      assertVisualWorkspace(payload, 'focus-target')
      return activeViewportToolContext.focusInspectionTarget!(payload.target as InspectionTarget)
    }
    case 'apply-viewer-selection': {
      const payload = exactRecord(request.payload, 'apply-viewer-selection payload', [
        'atomIds', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (!Array.isArray(payload.atomIds) || payload.atomIds.some((id) => typeof id !== 'string')) {
        throw new Error('apply-viewer-selection payload requires atomIds: string[]')
      }
      assertVisualWorkspace(payload, 'apply-viewer-selection')
      await activeViewportToolContext.applyViewerSelection!(payload.atomIds as string[])
      return null
    }
    case 'capture-viewport': {
      const payload = request.payload === undefined ? {} : record(request.payload, 'capture-viewport payload')
      assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const options = payload.options === undefined
        ? undefined
        : record(payload.options, 'capture options') as ZatomViewportCaptureRequest['options']
      return activeViewportToolContext.captureViewport!(options)
    }
    case 'read-viewer-scene': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'read-viewer-scene payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const read = activeViewportToolContext.readViewerScene
      if (!read) throw new Error('The active viewport does not expose live scene observation')
      return viewportEnvelope(viewportId, 'scene', await read(signal))
    }
    case 'camera-look-at': {
      const payload = exactRecord(request.payload, 'camera-look-at payload', [
        'request', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (payload.request === undefined) throw new Error('camera-look-at payload requires request')
      const camera = activeViewportToolContext.camera
      if (!camera) throw new Error('The active viewport does not expose camera control')
      const input = parseCameraLookAtRequest(payload.request, 'camera-look-at request')
      const viewportId = assertVisualWorkspace(payload, 'camera-look-at')
      return viewportEnvelope(viewportId, 'result', await camera.lookAt(input, signal))
    }
    case 'camera-set-view': {
      const payload = exactRecord(request.payload, 'camera-set-view payload', [
        'view', 'durationMs', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (payload.view === undefined) throw new Error('camera-set-view payload requires view')
      const camera = activeViewportToolContext.camera
      if (!camera) throw new Error('The active viewport does not expose camera control')
      const view = parseCameraView(payload.view, 'camera-set-view view')
      const durationMs = parseDuration(payload.durationMs, 'durationMs')
      const viewportId = assertVisualWorkspace(payload, 'camera-set-view')
      return viewportEnvelope(viewportId, 'result', await camera.setView(view, durationMs, signal))
    }
    case 'guidance-read': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'guidance-read payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.read())
    }
    case 'guidance-set-plan': {
      const payload = exactRecord(request.payload, 'guidance-set-plan payload', [
        'steps', 'activeIndex', 'caption', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (!Array.isArray(payload.steps) || payload.steps.length === 0 || payload.steps.length > 8) {
        throw new Error('steps must contain 1 to 8 entries')
      }
      const steps = payload.steps.map((step, index) => boundedString(step, `steps[${index}]`, 60))
      const activeIndex = nonNegativeInteger(payload.activeIndex, 'activeIndex')
      if (!('caption' in payload)) throw new Error('guidance-set-plan payload requires caption')
      const caption = parseCaption(payload.caption, 'caption')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertVisualWorkspace(payload, 'guidance-set-plan')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.setPlan(steps, activeIndex, caption))
    }
    case 'guidance-advance': {
      const payload = exactRecord(request.payload, 'guidance-advance payload', [
        'activeIndex', 'caption', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      const activeIndex = nonNegativeInteger(payload.activeIndex, 'activeIndex')
      const caption = payload.caption === undefined ? undefined : parseCaption(payload.caption, 'caption')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertVisualWorkspace(payload, 'guidance-advance')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.advance(activeIndex, caption))
    }
    case 'guidance-set-caption': {
      const payload = exactRecord(request.payload, 'guidance-set-caption payload', [
        'caption', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (!('caption' in payload)) throw new Error('guidance-set-caption payload requires caption')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertVisualWorkspace(payload, 'guidance-set-caption')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.setCaption(parseCaption(payload.caption, 'caption')))
    }
    case 'guidance-annotate': {
      const payload = exactRecord(request.payload, 'guidance-annotate payload', [
        'annotations', 'replace', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (typeof payload.replace !== 'boolean') throw new Error('replace must be boolean')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const annotations = parseGuidanceAnnotations(payload.annotations)
      const viewportId = assertVisualWorkspace(payload, 'guidance-annotate')
      return viewportEnvelope(
        viewportId,
        'snapshot',
        await guidance.annotate(annotations, payload.replace),
      )
    }
    case 'guidance-present-candidates': {
      const payload = exactRecord(request.payload, 'guidance-present-candidates payload', [
        'label', 'items', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      const label = boundedString(payload.label, 'label', 80)
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const items = parseGuidanceCandidates(payload.items)
      const viewportId = assertVisualWorkspace(payload, 'guidance-present-candidates')
      return viewportEnvelope(
        viewportId,
        'snapshot',
        await guidance.presentCandidates(label, items),
      )
    }
    case 'guidance-focus-candidate': {
      const payload = exactRecord(request.payload, 'guidance-focus-candidate payload', [
        'index', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      const index = payload.index === null ? null : nonNegativeInteger(payload.index, 'index')
      if (index === 0) throw new Error('index must be null or a positive integer')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertVisualWorkspace(payload, 'guidance-focus-candidate')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.focusCandidate(index))
    }
    case 'guidance-candidate-status': {
      const payload = exactRecord(request.payload, 'guidance-candidate-status payload', [
        'candidateSetId', 'waitMs', 'expectedViewportId',
      ])
      const candidateSetId = boundedString(payload.candidateSetId, 'candidateSetId', 128)
      const waitMs = payload.waitMs === undefined ? 0 : nonNegativeInteger(payload.waitMs, 'waitMs')
      if (waitMs > 30_000) throw new Error('waitMs must be at most 30000')
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      return viewportEnvelope(
        viewportId,
        'status',
        await guidance.candidateStatus(candidateSetId, waitMs, signal),
      )
    }
    case 'guidance-clear': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'guidance-clear payload', [
            'scope', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
          ])
      const scope = payload.scope
      if (scope !== undefined && !['all', 'plan', 'annotations', 'candidates', 'caption'].includes(String(scope))) {
        throw new Error('scope must be all, plan, annotations, candidates, or caption')
      }
      const guidance = activeViewportToolContext.guidance
      if (!guidance) throw new Error('The active viewport does not expose guidance overlays')
      const viewportId = assertVisualWorkspace(payload, 'guidance-clear')
      return viewportEnvelope(viewportId, 'snapshot', await guidance.clear(scope as GuidanceClearScope | undefined))
    }
    case 'viewer-style-read': {
      const payload = request.payload === undefined
        ? {}
        : exactRecord(request.payload, 'viewer-style-read payload', ['expectedViewportId'])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const style = activeViewportToolContext.viewerStyle
      if (!style) throw new Error('The active viewport does not expose presentation settings')
      return viewportEnvelope(viewportId, 'snapshot', await style.read())
    }
    case 'viewer-style-apply': {
      const payload = exactRecord(request.payload, 'viewer-style-apply payload', [
        'patch', ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      if (payload.patch === undefined) throw new Error('viewer-style-apply payload requires patch')
      const style = activeViewportToolContext.viewerStyle
      if (!style) throw new Error('The active viewport does not expose presentation settings')
      const patch = parseViewerStylePatch(payload.patch)
      const viewportId = assertVisualWorkspace(payload, 'viewer-style-apply')
      return viewportEnvelope(viewportId, 'snapshot', await style.apply(patch))
    }
    case 'proposal-propose': {
      const payload = exactRecord(request.payload, 'proposal-propose payload', [
        'intent', 'baseFingerprint', 'workspaceRevision', 'candidate', 'expectedViewportId',
        'checks', 'inspectionTargets',
      ])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const intent = boundedString(payload.intent, 'intent', 240)
      const baseFingerprint = payload.baseFingerprint === null
        ? null
        : boundedString(payload.baseFingerprint, 'baseFingerprint', 256)
      const workspaceRevision = nonNegativeInteger(payload.workspaceRevision, 'workspaceRevision')
      const current = readActiveViewportStructure()
      const currentFingerprint = current ? fingerprintStructure(current) : null
      if (currentFingerprint !== baseFingerprint) {
        throw new Error(`Active structure changed; expected ${baseFingerprint}, received ${currentFingerprint}`)
      }
      const identity = await activeWorkspaceIdentity()
      if (identity.viewportId !== viewportId || identity.revision !== workspaceRevision) {
        throw new Error(
          `Active workspace changed before preview; expected ${viewportId}@r${workspaceRevision}, `
          + `received ${identity.viewportId}@r${identity.revision}`,
        )
      }
      const candidate = parseZatomStructure(payload.candidate)
      if (payload.checks !== undefined && !Array.isArray(payload.checks)) {
        throw new Error('proposal-propose checks must be an array')
      }
      if (payload.inspectionTargets !== undefined && !Array.isArray(payload.inspectionTargets)) {
        throw new Error('proposal-propose inspectionTargets must be an array')
      }
      const proposal = activeViewportToolContext.proposal
      if (!proposal) throw new Error('The active viewport does not expose structure proposals')
      return viewportEnvelope(viewportId, 'proposal', await proposal.propose({
        intent,
        baseFingerprint,
        viewportId,
        workspaceRevision,
        candidate,
        changeSet: buildStructureChangeSet(
          current ?? { schemaVersion: 'zatom.structure/v1', atoms: [] },
          candidate,
        ),
        checks: structuredClone((payload.checks ?? []) as ValidationCheck[]),
        inspectionTargets: structuredClone((payload.inspectionTargets ?? []) as InspectionTarget[]),
        signal,
      }))
    }
    case 'proposal-read-candidate': {
      const payload = exactRecord(request.payload, 'proposal-read-candidate payload', [
        'proposalId', 'expectedPreviewRevision', 'expectedCandidateFingerprint',
        ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      const viewportId = assertVisualWorkspace(payload, 'proposal-read-candidate')
      const proposalId = boundedString(payload.proposalId, 'proposalId', 256)
      const expectedPreviewRevision = nonNegativeInteger(payload.expectedPreviewRevision, 'expectedPreviewRevision')
      if (expectedPreviewRevision < 1) throw new Error('expectedPreviewRevision must be at least 1')
      const expectedCandidateFingerprint = boundedString(
        payload.expectedCandidateFingerprint,
        'expectedCandidateFingerprint',
        256,
      )
      const proposal = activeViewportToolContext.proposal
      if (!proposal) throw new Error('The active viewport does not expose structure proposals')
      const value = await proposal.readCandidate({
        id: proposalId,
        expectedPreviewRevision,
        expectedCandidateFingerprint,
        signal,
      })
      if (value.proposal.viewportId !== viewportId) {
        throw new Error(`Proposal ${proposalId} belongs to viewport ${value.proposal.viewportId}, not ${viewportId}`)
      }
      return viewportEnvelope(viewportId, 'candidate', value)
    }
    case 'proposal-revise': {
      const payload = exactRecord(request.payload, 'proposal-revise payload', [
        'proposalId', 'expectedPreviewRevision', 'expectedCandidateFingerprint',
        'intent', 'candidate', 'checks', 'inspectionTargets',
        ...VISUAL_WORKSPACE_EXPECTATION_FIELDS,
      ])
      const viewportId = assertVisualWorkspace(payload, 'proposal-revise')
      const proposalId = boundedString(payload.proposalId, 'proposalId', 256)
      const expectedPreviewRevision = nonNegativeInteger(payload.expectedPreviewRevision, 'expectedPreviewRevision')
      if (expectedPreviewRevision < 1) throw new Error('expectedPreviewRevision must be at least 1')
      const expectedCandidateFingerprint = boundedString(
        payload.expectedCandidateFingerprint,
        'expectedCandidateFingerprint',
        256,
      )
      const intent = boundedString(payload.intent, 'intent', 240)
      const candidate = parseZatomStructure(payload.candidate)
      if (payload.checks !== undefined && !Array.isArray(payload.checks)) {
        throw new Error('proposal-revise checks must be an array')
      }
      if (payload.inspectionTargets !== undefined && !Array.isArray(payload.inspectionTargets)) {
        throw new Error('proposal-revise inspectionTargets must be an array')
      }
      const current = readActiveViewportStructure()
      const proposal = activeViewportToolContext.proposal
      if (!proposal) throw new Error('The active viewport does not expose structure proposals')
      const value = await proposal.revise({
        id: proposalId,
        expectedPreviewRevision,
        expectedCandidateFingerprint,
        intent,
        candidate,
        changeSet: buildStructureChangeSet(
          current ?? { schemaVersion: 'zatom.structure/v1', atoms: [] },
          candidate,
        ),
        checks: structuredClone((payload.checks ?? []) as ValidationCheck[]),
        inspectionTargets: structuredClone((payload.inspectionTargets ?? []) as InspectionTarget[]),
        signal,
      })
      if (value.viewportId !== viewportId) {
        throw new Error(`Proposal ${proposalId} belongs to viewport ${value.viewportId}, not ${viewportId}`)
      }
      return viewportEnvelope(viewportId, 'proposal', value)
    }
    case 'proposal-status':
    case 'proposal-withdraw': {
      const payload = exactRecord(request.payload, `${request.operation} payload`, [
        'proposalId', 'expectedViewportId',
      ])
      const viewportId = assertActiveViewport(optionalString(payload.expectedViewportId, 'expectedViewportId'))
      const proposalId = boundedString(payload.proposalId, 'proposalId', 256)
      const proposal = activeViewportToolContext.proposal
      if (!proposal) throw new Error('The active viewport does not expose structure proposals')
      const value = request.operation === 'proposal-status'
        ? await proposal.status(proposalId, signal)
        : await proposal.withdraw(proposalId, signal)
      if (value && value.id !== proposalId) {
        throw new Error(`Proposal lookup returned ${value.id}, not requested ${proposalId}`)
      }
      if (value && value.viewportId !== viewportId) {
        throw new Error(`Proposal ${proposalId} belongs to viewport ${value.viewportId}, not ${viewportId}`)
      }
      return viewportEnvelope(viewportId, 'proposal', value)
    }
    case 'viewport-describe': {
      // Hosts that bridge several tabs address one by instanceId; echoing it
      // back lets the caller tell which instance answered.
      const payload = request.payload === undefined ? {} : record(request.payload, 'viewport-describe payload')
      const instanceId = optionalString(payload.instanceId, 'instanceId')
      const surface = activeViewportToolContext.viewport
      if (!surface) throw new Error('The renderer has no viewport surface')
      return { ...(await surface.describe()), ...(instanceId ? { instanceId } : {}) }
    }
    case 'viewport-activate': {
      const payload = exactRecord(request.payload, 'viewport-activate payload', [
        'slotId', 'expectedViewportId', 'instanceId',
      ])
      const slotId = boundedString(payload.slotId, 'slotId', 128)
      const expectedViewportId = boundedString(payload.expectedViewportId, 'expectedViewportId', 128)
      const instanceId = optionalString(payload.instanceId, 'instanceId')
      const surface = activeViewportToolContext.viewport
      if (!surface) throw new Error('The renderer has no viewport surface')
      const view = await surface.activate(slotId, { expectedActiveViewportId: expectedViewportId, signal })
      return { ...view, ...(instanceId ? { instanceId } : {}) }
    }
    case 'viewport-set-layout': {
      const payload = record(request.payload, 'viewport-set-layout payload')
      const layout = optionalString(payload.layout, 'layout')
      if (!layout) throw new Error('viewport-set-layout requires layout')
      const instanceId = optionalString(payload.instanceId, 'instanceId')
      const surface = activeViewportToolContext.viewport
      if (!surface) throw new Error('The renderer has no viewport surface')
      const view = await surface.setLayout(layout, undefined, signal)
      return { ...view, ...(instanceId ? { instanceId } : {}) }
    }
    case 'viewport-clear': {
      const payload = exactRecord(request.payload, 'viewport-clear payload', [
        'slotId', 'targetStructureFingerprint', 'targetTrajectoryFingerprint',
        'targetWorkspaceRevision', 'instanceId',
      ])
      const slotId = boundedString(payload.slotId, 'slotId', 128)
      if (payload.targetStructureFingerprint !== null
        && typeof payload.targetStructureFingerprint !== 'string') {
        throw new Error('targetStructureFingerprint must be string or null')
      }
      if (payload.targetTrajectoryFingerprint !== null
        && typeof payload.targetTrajectoryFingerprint !== 'string') {
        throw new Error('targetTrajectoryFingerprint must be string or null')
      }
      const instanceId = optionalString(payload.instanceId, 'instanceId')
      const surface = activeViewportToolContext.viewport
      if (!surface) throw new Error('The renderer has no viewport surface')
      const view = await surface.clear(slotId, {
        expectedTarget: {
          slotId,
          structureFingerprint: payload.targetStructureFingerprint as string | null,
          trajectoryFingerprint: payload.targetTrajectoryFingerprint as string | null,
          workspaceRevision: nonNegativeInteger(payload.targetWorkspaceRevision, 'targetWorkspaceRevision'),
        },
        signal,
      })
      return { ...view, ...(instanceId ? { instanceId } : {}) }
    }
    case 'viewport-mount': {
      const payload = record(request.payload, 'viewport-mount payload')
      if (!Array.isArray(payload.structures)) {
        throw new Error('viewport-mount payload requires structures')
      }
      const instanceId = optionalString(payload.instanceId, 'instanceId')
      const layout = optionalString(payload.layout, 'layout')
      const preserveExisting = payload.preserveExisting === undefined ? true : payload.preserveExisting
      if (typeof preserveExisting !== 'boolean') throw new Error('preserveExisting must be boolean')
      const targetSlotIds = payload.targetSlotIds === undefined
        ? undefined
        : parseAtomIds(payload.targetSlotIds, 'targetSlotIds')
      const expectedTargets = payload.expectedTargets === undefined
        ? undefined
        : (() => {
            if (!Array.isArray(payload.expectedTargets)) throw new Error('expectedTargets must be an array')
            return payload.expectedTargets.map((entry, index) => {
              const expected = exactRecord(entry, `expectedTargets[${index}]`, [
                'slotId', 'structureFingerprint', 'trajectoryFingerprint', 'workspaceRevision',
              ])
              if (expected.structureFingerprint !== null && typeof expected.structureFingerprint !== 'string') {
                throw new Error(`expectedTargets[${index}].structureFingerprint must be string or null`)
              }
              if (expected.trajectoryFingerprint !== null && typeof expected.trajectoryFingerprint !== 'string') {
                throw new Error(`expectedTargets[${index}].trajectoryFingerprint must be string or null`)
              }
              return {
                slotId: boundedString(expected.slotId, `expectedTargets[${index}].slotId`, 128),
                structureFingerprint: expected.structureFingerprint as string | null,
                trajectoryFingerprint: expected.trajectoryFingerprint as string | null,
                workspaceRevision: nonNegativeInteger(
                  expected.workspaceRevision,
                  `expectedTargets[${index}].workspaceRevision`,
                ),
              }
            })
          })()
      const surface = activeViewportToolContext.viewport
      if (!surface) throw new Error('The renderer has no viewport surface')
      const view = await surface.mount(payload.structures as ZatomMountRequestStructure[], {
        ...(layout ? { layout } : {}),
        preserveExisting,
        ...(targetSlotIds ? { targetSlotIds } : {}),
        ...(expectedTargets ? { expectedTargets } : {}),
        signal,
      })
      return { ...view, ...(instanceId ? { instanceId } : {}) }
    }
    case 'assets-list-batches': {
      return { batches: describeWorkspaceBatches() }
    }
    case 'assets-create-batch': {
      const payload = request.payload === undefined ? {} : record(request.payload, 'assets-create-batch payload')
      const name = optionalString(payload.name, 'name')
      commitLocalWorkspaceState((state) => createLocalWorkspaceBatch(state, name))
      return { batches: describeWorkspaceBatches() }
    }
    case 'assets-rename-batch': {
      const payload = record(request.payload, 'assets-rename-batch payload')
      const batchId = optionalString(payload.batchId, 'batchId')
      const name = optionalString(payload.name, 'name')
      if (!batchId || !name) throw new Error('assets-rename-batch requires batchId and name')
      commitLocalWorkspaceState((state) => renameLocalWorkspaceBatch(state, batchId, name))
      return { batches: describeWorkspaceBatches() }
    }
    case 'assets-move-frames': {
      const payload = record(request.payload, 'assets-move-frames payload')
      const toBatchId = optionalString(payload.toBatchId, 'toBatchId')
      if (!toBatchId) throw new Error('assets-move-frames requires toBatchId')
      if (!Array.isArray(payload.frameIds) || payload.frameIds.length === 0) {
        throw new Error('assets-move-frames requires a non-empty frameIds array')
      }
      const frameIds = payload.frameIds.map((frameId, index) => {
        if (typeof frameId !== 'string' || !frameId) throw new Error(`frameIds[${index}] must be a non-empty string`)
        return frameId
      })
      commitLocalWorkspaceState((state) => moveLocalWorkspaceFrames(state, frameIds, toBatchId))
      return { batches: describeWorkspaceBatches() }
    }
    case 'read-host-write-mode': {
      const payload = record(request.payload, 'read-host-write-mode payload')
      const host = optionalString(payload.host, 'host')
      if (host !== 'cli-bridge') {
        throw new Error('read-host-write-mode requires host = cli-bridge')
      }
      return { mode: readHostWriteMode(host) }
    }
  }
}

function rendererFailure(error: unknown): { error: string; errorCode?: string } {
  const message = error instanceof Error ? error.message : String(error)
  const rawCode = error instanceof Error ? (error as Error & { code?: unknown }).code : undefined
  return {
    error: message,
    ...(typeof rawCode === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(rawCode)
      ? { errorCode: rawCode }
      : {}),
  }
}

export async function handleZatomViewportBridgeRequest(
  rawRequest: ZatomViewportBridgeRequest,
  signal?: AbortSignal,
): Promise<ZatomViewportBridgeResponse> {
  let request: ZatomViewportBridgeRequest
  try {
    request = parseZatomViewportBridgeRequest(rawRequest)
  } catch (error) {
    return {
      schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
      requestId: rawRequest && typeof rawRequest.requestId === 'string' ? rawRequest.requestId : 'invalid',
      ok: false,
      ...rendererFailure(error),
    }
  }
  // A policy probe is not an Agent operation. The registry asks the page what
  // this host may change before every write-capable tool call. Return the answer
  // directly without showing activity.
  if (request.operation === 'read-host-write-mode') {
    try {
      return {
        schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
        requestId: request.requestId,
        ok: true,
        value: await executeRequest(request, signal),
      }
    } catch (error) {
      return {
        schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
        requestId: request.requestId,
        ok: false,
        ...rendererFailure(error),
      }
    }
  }
  // Start activity only after parsing. An invalid request shape is not a meaningful
  // operation, and flashing the indicator for an immediate failure adds noise.
  const activity = OPERATION_ACTIVITY[request.operation]
  const endActivity = useAgentActivity.getState().begin({
    label: activity.label,
    tier: activity.tier,
    // Tool calls are not interruptible. Cancelling a structure write halfway can
    // leave inconsistent state, which is worse than waiting for completion. Only
    // reveal animations may be skipped, and the choreographer queues those itself.
    interruptible: false,
  })
  try {
    return {
      schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
      requestId: request.requestId,
      ok: true,
      value: await executeRequest(request, signal),
    }
  } catch (error) {
    return {
      schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
      requestId: request.requestId,
      ok: false,
      ...rendererFailure(error),
    }
  } finally {
    endActivity()
  }
}
