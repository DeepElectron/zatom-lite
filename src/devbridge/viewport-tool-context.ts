/** Request-local tool context backed by the live browser viewport. */

import type {
  CameraFlightResult,
  CameraLookAtRequest,
  CameraViewSpec,
  GuidanceAnnotationInput,
  GuidanceCandidateInput,
  GuidanceCandidateStatus,
  GuidanceClearScope,
  GuidanceSnapshot,
  ProposalCandidateSnapshot,
  ProposalSnapshot,
  ViewerStylePatch,
  ViewerStyleSnapshot,
  ZatomAppInstanceView,
  ZatomAssetBatchView,
  ZatomViewportView,
  CapturedImage,
  InspectionTarget,
  ViewportTargetPlacement,
  ZatomHostWriteMode,
  ZatomStructure,
  ZatomToolContext,
  ZatomTrajectory,
  ZatomViewerScene,
  ZatomWorkspaceIdentity,
} from '../agent/contracts'
import { fingerprintStructure } from '../agent/structure-math'
import { parseZatomStructure } from '../agent/structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from '../agent/trajectory'
import type { ZatomViewportBridgeOperation } from './viewport-contracts'

export type ZatomViewportBridgeInvoker = (
  operation: ZatomViewportBridgeOperation,
  payload?: unknown,
  timeoutMs?: number | null,
  signal?: AbortSignal,
) => Promise<unknown>

type ViewportBinding = ZatomWorkspaceIdentity

type VisualWorkspaceExpectation = {
  expectedViewportId: string
  expectedRevision: number
  expectedStructureFingerprint: string | null
  expectedTrajectoryFingerprint: string | null
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactRecord(value: unknown, label: string, fields: readonly string[]): Record<string, unknown> {
  const parsed = record(value, label)
  const unknown = Object.keys(parsed).filter((field) => !fields.includes(field))
  if (unknown.length) throw new Error(`${label} has unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`)
  return parsed
}

function finiteVec3(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    throw new Error(`${label} must contain exactly three finite numbers`)
  }
  return [value[0] as number, value[1] as number, value[2] as number]
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`)
  }
  return [...value] as string[]
}

function parseWorkspaceIdentity(value: unknown, label: string): ZatomWorkspaceIdentity {
  const identity = exactRecord(value, label, [
    'viewportId', 'revision', 'structureFingerprint', 'trajectoryFingerprint',
  ])
  if (typeof identity.viewportId !== 'string' || !identity.viewportId
    || typeof identity.revision !== 'number' || !Number.isInteger(identity.revision) || identity.revision < 0
    || (identity.structureFingerprint !== null && typeof identity.structureFingerprint !== 'string')
    || (identity.trajectoryFingerprint !== null && typeof identity.trajectoryFingerprint !== 'string')) {
    throw new Error(`${label} is malformed`)
  }
  return {
    viewportId: identity.viewportId,
    revision: identity.revision,
    structureFingerprint: identity.structureFingerprint as string | null,
    trajectoryFingerprint: identity.trajectoryFingerprint as string | null,
  }
}

function parseViewerScene(value: unknown): ZatomViewerScene | null {
  if (value === null) return null
  const scene = exactRecord(value, 'Renderer viewer scene', [
    'pose', 'viewportSizePx', 'selectedAtomIds', 'selectedBondIds', 'selectedFaceIds',
    'selectedEdgeIds', 'boxSelectionActive', 'hoveredAtomId', 'lastFocus',
  ])
  let pose: ZatomViewerScene['pose'] = null
  if (scene.pose !== null) {
    const input = exactRecord(scene.pose, 'Renderer camera pose', ['position', 'lookAt', 'up', 'zoom'])
    if (input.zoom !== undefined && (typeof input.zoom !== 'number' || !Number.isFinite(input.zoom))) {
      throw new Error('Renderer camera pose zoom must be finite')
    }
    pose = {
      position: finiteVec3(input.position, 'Renderer camera position'),
      lookAt: finiteVec3(input.lookAt, 'Renderer camera lookAt'),
      up: finiteVec3(input.up, 'Renderer camera up'),
      ...(input.zoom === undefined ? {} : { zoom: input.zoom }),
    }
  }
  let viewportSizePx: [number, number] | null = null
  if (scene.viewportSizePx !== null) {
    if (!Array.isArray(scene.viewportSizePx)
      || scene.viewportSizePx.length !== 2
      || scene.viewportSizePx.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0)) {
      throw new Error('Renderer viewport size must contain two non-negative finite numbers')
    }
    viewportSizePx = [scene.viewportSizePx[0] as number, scene.viewportSizePx[1] as number]
  }
  const hoveredAtomId = scene.hoveredAtomId
  if (hoveredAtomId !== null && typeof hoveredAtomId !== 'string') {
    throw new Error('Renderer hovered atom id must be a string or null')
  }
  if (typeof scene.boxSelectionActive !== 'boolean') {
    throw new Error('Renderer box selection state must be boolean')
  }
  let lastFocus: ZatomViewerScene['lastFocus'] = null
  if (scene.lastFocus !== null) {
    const input = exactRecord(scene.lastFocus, 'Renderer last camera focus', ['atomIds', 'center', 'at'])
    if (typeof input.at !== 'number' || !Number.isFinite(input.at)) throw new Error('Renderer last camera focus time must be finite')
    lastFocus = {
      atomIds: stringArray(input.atomIds, 'Renderer last camera focus atom ids'),
      center: finiteVec3(input.center, 'Renderer last camera focus center'),
      at: input.at,
    }
  }
  return {
    pose,
    viewportSizePx,
    selectedAtomIds: stringArray(scene.selectedAtomIds, 'Renderer selected atom ids'),
    selectedBondIds: stringArray(scene.selectedBondIds, 'Renderer selected bond ids'),
    selectedFaceIds: stringArray(scene.selectedFaceIds, 'Renderer selected face ids'),
    selectedEdgeIds: stringArray(scene.selectedEdgeIds, 'Renderer selected edge ids'),
    boxSelectionActive: scene.boxSelectionActive === true,
    hoveredAtomId,
    lastFocus,
  }
}

function parseCameraFlight(value: unknown): CameraFlightResult {
  const flight = exactRecord(value, 'Renderer camera flight', [
    'center', 'distance', 'direction', 'atomIds', 'interrupted',
  ])
  if (typeof flight.distance !== 'number' || !Number.isFinite(flight.distance) || flight.distance < 0) {
    throw new Error('Renderer camera flight distance must be non-negative and finite')
  }
  if (typeof flight.interrupted !== 'boolean') throw new Error('Renderer camera flight interrupted must be boolean')
  return {
    center: finiteVec3(flight.center, 'Renderer camera flight center'),
    distance: flight.distance,
    direction: finiteVec3(flight.direction, 'Renderer camera flight direction'),
    atomIds: stringArray(flight.atomIds, 'Renderer camera flight atom ids'),
    interrupted: flight.interrupted,
  }
}

function parseGuidanceSnapshot(value: unknown): GuidanceSnapshot {
  const snapshot = exactRecord(value, 'Renderer guidance snapshot', ['plan', 'annotations', 'candidates'])
  if (!Array.isArray(snapshot.annotations)) throw new Error('Renderer guidance annotations must be an array')
  const annotations = snapshot.annotations.map((entry, index) => {
    const item = exactRecord(entry, `Renderer annotation ${index}`, ['id', 'position', 'label', 'kind'])
    if (typeof item.id !== 'string' || typeof item.label !== 'string'
      || (item.kind !== 'info' && item.kind !== 'target' && item.kind !== 'warn')) {
      throw new Error(`Renderer annotation ${index} is malformed`)
    }
    return {
      id: item.id,
      position: finiteVec3(item.position, `Renderer annotation ${index} position`),
      label: item.label,
      kind: item.kind as 'info' | 'target' | 'warn',
    }
  })
  let plan: GuidanceSnapshot['plan'] = null
  if (snapshot.plan !== null) {
    const input = exactRecord(snapshot.plan, 'Renderer guidance plan', ['steps', 'caption'])
    if (!Array.isArray(input.steps) || (input.caption !== null && typeof input.caption !== 'string')) {
      throw new Error('Renderer guidance plan is malformed')
    }
    plan = {
      steps: input.steps.map((entry, index) => {
        const step = exactRecord(entry, `Renderer guidance step ${index}`, ['label', 'status'])
        if (typeof step.label !== 'string' || !['pending', 'active', 'done'].includes(String(step.status))) {
          throw new Error(`Renderer guidance step ${index} is malformed`)
        }
        return { label: step.label, status: step.status as 'pending' | 'active' | 'done' }
      }),
      caption: input.caption as string | null,
    }
  }
  let candidates: GuidanceSnapshot['candidates'] = null
  if (snapshot.candidates !== null) {
    const input = exactRecord(snapshot.candidates, 'Renderer guidance candidates', ['id', 'label', 'items', 'focusedIndex', 'decision'])
    if (typeof input.id !== 'string' || typeof input.label !== 'string' || !Array.isArray(input.items)
      || (input.focusedIndex !== null && (typeof input.focusedIndex !== 'number' || !Number.isInteger(input.focusedIndex)))) {
      throw new Error('Renderer guidance candidates are malformed')
    }
    const rawDecision = exactRecord(input.decision, 'Renderer guidance candidate decision', ['status', 'index', 'at'])
    const decisionStatus = String(rawDecision.status)
    const pendingDecision = decisionStatus === 'pending' && rawDecision.index === null && rawDecision.at === null
    const confirmedDecision = decisionStatus === 'confirmed'
      && typeof rawDecision.index === 'number' && Number.isInteger(rawDecision.index) && rawDecision.index > 0
      && typeof rawDecision.at === 'number' && Number.isFinite(rawDecision.at)
    const closedDecision = (decisionStatus === 'cancelled' || decisionStatus === 'stale')
      && rawDecision.index === null
      && typeof rawDecision.at === 'number' && Number.isFinite(rawDecision.at)
    if (!pendingDecision && !confirmedDecision && !closedDecision) {
      throw new Error('Renderer guidance candidate decision is malformed')
    }
    const decision = pendingDecision
      ? { status: 'pending' as const, index: null, at: null }
      : confirmedDecision
        ? { status: 'confirmed' as const, index: rawDecision.index as number, at: rawDecision.at as number }
        : {
            status: decisionStatus as 'cancelled' | 'stale',
            index: null,
            at: rawDecision.at as number,
          }
    candidates = {
      id: input.id,
      label: input.label,
      focusedIndex: input.focusedIndex as number | null,
      decision,
      items: input.items.map((entry, index) => {
        const item = exactRecord(entry, `Renderer candidate ${index}`, [
          'index', 'atomIds', 'position', 'anchorPositions', 'label', 'detail',
        ])
        if (typeof item.index !== 'number' || !Number.isInteger(item.index) || typeof item.label !== 'string'
          || (item.detail !== null && typeof item.detail !== 'string')) {
          throw new Error(`Renderer candidate ${index} is malformed`)
        }
        return {
          index: item.index,
          atomIds: stringArray(item.atomIds, `Renderer candidate ${index} atom ids`),
          position: finiteVec3(item.position, `Renderer candidate ${index} position`),
          anchorPositions: Array.isArray(item.anchorPositions)
            ? item.anchorPositions.map((position, anchorIndex) => finiteVec3(
                position,
                `Renderer candidate ${index} anchor position ${anchorIndex}`,
              ))
            : [],
          label: item.label,
          detail: item.detail as string | null,
        }
      }),
    }
  }
  return { plan, annotations, candidates }
}

function parseGuidanceCandidateStatus(value: unknown): GuidanceCandidateStatus {
  const input = exactRecord(value, 'Renderer guidance candidate status', [
    'candidateSetId', 'status', 'focusedIndex', 'choice', 'decidedAt', 'timedOut',
  ])
  if (typeof input.candidateSetId !== 'string' || !input.candidateSetId
    || !['pending', 'confirmed', 'cancelled', 'stale'].includes(String(input.status))
    || (input.focusedIndex !== null && (typeof input.focusedIndex !== 'number' || !Number.isInteger(input.focusedIndex)))
    || (input.decidedAt !== null && (typeof input.decidedAt !== 'number' || !Number.isFinite(input.decidedAt)))
    || typeof input.timedOut !== 'boolean') {
    throw new Error('Renderer guidance candidate status is malformed')
  }
  let choice: GuidanceCandidateStatus['choice'] = null
  if (input.choice !== null) {
    const item = exactRecord(input.choice, 'Renderer guidance candidate choice', [
      'index', 'atomIds', 'position', 'label', 'detail',
    ])
    if (typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 1
      || typeof item.label !== 'string' || (item.detail !== null && typeof item.detail !== 'string')) {
      throw new Error('Renderer guidance candidate choice is malformed')
    }
    choice = {
      index: item.index,
      atomIds: stringArray(item.atomIds, 'Renderer guidance candidate choice atom ids'),
      position: finiteVec3(item.position, 'Renderer guidance candidate choice position'),
      label: item.label,
      detail: item.detail as string | null,
    }
  }
  if ((input.status === 'confirmed') !== (choice !== null)
    || (input.status === 'pending') !== (input.decidedAt === null)
    || (input.status !== 'pending' && input.timedOut === true)) {
    throw new Error('Renderer guidance candidate status fields are inconsistent')
  }
  return {
    candidateSetId: input.candidateSetId,
    status: input.status as GuidanceCandidateStatus['status'],
    focusedIndex: input.focusedIndex as number | null,
    choice,
    decidedAt: input.decidedAt as number | null,
    timedOut: input.timedOut,
  }
}

function parseViewerStyleSnapshot(value: unknown): ViewerStyleSnapshot {
  const snapshot = exactRecord(value, 'Renderer viewer style snapshot', [
    'stylePresetId', 'viewMode', 'cameraProjection', 'hideHydrogens', 'keptHydrogens',
    'showAtomRings', 'fieldSlice', 'surface', 'available',
  ])
  if (typeof snapshot.stylePresetId !== 'string' || !snapshot.stylePresetId
    || typeof snapshot.viewMode !== 'string' || !snapshot.viewMode
    || (snapshot.cameraProjection !== 'perspective' && snapshot.cameraProjection !== 'orthographic')
    || typeof snapshot.hideHydrogens !== 'boolean' || typeof snapshot.keptHydrogens !== 'string'
    || typeof snapshot.showAtomRings !== 'boolean') {
    throw new Error('Renderer viewer style snapshot is malformed')
  }

  const fieldSlice = exactRecord(snapshot.fieldSlice, 'Renderer field-slice style', [
    'enabled', 'mode', 'opacity', 'contours',
  ])
  if (typeof fieldSlice.enabled !== 'boolean'
    || (fieldSlice.mode !== 'overlay' && fieldSlice.mode !== 'slice-only')
    || typeof fieldSlice.opacity !== 'number' || !Number.isFinite(fieldSlice.opacity)
    || fieldSlice.opacity < 0.1 || fieldSlice.opacity > 1
    || typeof fieldSlice.contours !== 'number' || !Number.isInteger(fieldSlice.contours)
    || fieldSlice.contours < 0 || fieldSlice.contours > 20) {
    throw new Error('Renderer field-slice style is malformed')
  }

  const parseRange = (input: unknown, label: string, allowEqual = false) => {
    const range = exactRecord(input, label, ['min', 'max'])
    if (typeof range.min !== 'number' || !Number.isFinite(range.min)
      || typeof range.max !== 'number' || !Number.isFinite(range.max)
      || (allowEqual ? range.min > range.max : range.min >= range.max)) {
      throw new Error(`${label} is malformed`)
    }
    return { min: range.min, max: range.max }
  }

  let surface: ViewerStyleSnapshot['surface'] = null
  if (snapshot.surface !== null) {
    const input = exactRecord(snapshot.surface, 'Renderer surface style', [
      'sourceType', 'sourceName', 'visible', 'isoValue', 'resolution', 'opacity',
      'selectedOrbitalIndex', 'orbitalCount', 'colorField',
    ])
    if ((input.sourceType !== 'cub' && input.sourceType !== 'molden')
      || (input.sourceName !== null && typeof input.sourceName !== 'string')
      || typeof input.visible !== 'boolean'
      || typeof input.isoValue !== 'number' || !Number.isFinite(input.isoValue) || input.isoValue <= 0
      || typeof input.resolution !== 'number' || !Number.isInteger(input.resolution)
      || input.resolution < 12 || input.resolution > 80
      || typeof input.opacity !== 'number' || !Number.isFinite(input.opacity)
      || input.opacity < 0 || input.opacity > 1
      || (input.selectedOrbitalIndex !== null
        && (typeof input.selectedOrbitalIndex !== 'number' || !Number.isInteger(input.selectedOrbitalIndex)))
      || (input.orbitalCount !== null
        && (typeof input.orbitalCount !== 'number' || !Number.isInteger(input.orbitalCount) || input.orbitalCount < 0))) {
      throw new Error('Renderer surface style is malformed')
    }

    let colorField: NonNullable<ViewerStyleSnapshot['surface']>['colorField'] = null
    if (input.colorField !== null) {
      const color = exactRecord(input.colorField, 'Renderer surface colour field', [
        'sourceName', 'colormap', 'range', 'showExtrema', 'stats',
      ])
      if ((color.sourceName !== null && typeof color.sourceName !== 'string')
        || typeof color.colormap !== 'string' || !color.colormap
        || typeof color.showExtrema !== 'boolean') {
        throw new Error('Renderer surface colour field is malformed')
      }
      let stats: NonNullable<NonNullable<ViewerStyleSnapshot['surface']>['colorField']>['stats'] = null
      if (color.stats !== null) {
        const inputStats = exactRecord(color.stats, 'Renderer surface colour stats', [
          'range', 'sampled', 'extrema',
        ])
        if (!Array.isArray(inputStats.extrema)) throw new Error('Renderer surface colour extrema must be an array')
        stats = {
          range: parseRange(inputStats.range, 'Renderer surface colour range', true),
          sampled: parseRange(inputStats.sampled, 'Renderer sampled colour range', true),
          extrema: inputStats.extrema.map((entry, index) => {
            const extremum = exactRecord(entry, `Renderer surface extremum ${index}`, ['kind', 'value', 'position'])
            if ((extremum.kind !== 'min' && extremum.kind !== 'max')
              || typeof extremum.value !== 'number' || !Number.isFinite(extremum.value)) {
              throw new Error(`Renderer surface extremum ${index} is malformed`)
            }
            return {
              kind: extremum.kind,
              value: extremum.value,
              position: finiteVec3(extremum.position, `Renderer surface extremum ${index} position`),
            }
          }),
        }
      }
      colorField = {
        sourceName: color.sourceName as string | null,
        colormap: color.colormap,
        range: color.range === null ? null : parseRange(color.range, 'Renderer configured colour range'),
        showExtrema: color.showExtrema,
        stats,
      }
    }

    surface = {
      sourceType: input.sourceType,
      sourceName: input.sourceName as string | null,
      visible: input.visible,
      isoValue: input.isoValue,
      resolution: input.resolution,
      opacity: input.opacity,
      selectedOrbitalIndex: input.selectedOrbitalIndex as number | null,
      orbitalCount: input.orbitalCount as number | null,
      colorField,
    }
  }

  const catalogue = exactRecord(snapshot.available, 'Renderer viewer style catalogue', [
    'stylePresets', 'surfaceColormaps',
  ])
  if (!Array.isArray(catalogue.stylePresets)) throw new Error('Renderer style preset catalogue must be an array')
  const stylePresets = catalogue.stylePresets.map((entry, index) => {
    const preset = exactRecord(entry, `Renderer style preset ${index}`, ['id', 'label'])
    if (typeof preset.id !== 'string' || !preset.id || typeof preset.label !== 'string' || !preset.label) {
      throw new Error(`Renderer style preset ${index} is malformed`)
    }
    return { id: preset.id, label: preset.label }
  })

  return {
    stylePresetId: snapshot.stylePresetId,
    viewMode: snapshot.viewMode,
    cameraProjection: snapshot.cameraProjection,
    hideHydrogens: snapshot.hideHydrogens,
    keptHydrogens: snapshot.keptHydrogens,
    showAtomRings: snapshot.showAtomRings,
    fieldSlice: {
      enabled: fieldSlice.enabled,
      mode: fieldSlice.mode,
      opacity: fieldSlice.opacity,
      contours: fieldSlice.contours,
    },
    surface,
    available: {
      stylePresets,
      surfaceColormaps: stringArray(catalogue.surfaceColormaps, 'Renderer surface colormap catalogue'),
    },
  }
}

function parseProposalSnapshot(value: unknown): ProposalSnapshot | null {
  if (value === null) return null
  const proposal = exactRecord(value, 'Renderer proposal snapshot', [
    'id', 'intent', 'status', 'diff', 'viewportId', 'workspaceRevision', 'baseFingerprint',
    'candidateFingerprint', 'previewRevision', 'checks', 'inspectionTargets', 'previewComplete',
  ])
  const diff = record(proposal.diff, 'Renderer proposal diff')
  if (typeof proposal.id !== 'string' || typeof proposal.intent !== 'string'
    || !['pending', 'applying', 'applied', 'discarded', 'superseded'].includes(String(proposal.status))
    || typeof proposal.viewportId !== 'string'
    || typeof proposal.workspaceRevision !== 'number' || !Number.isInteger(proposal.workspaceRevision) || proposal.workspaceRevision < 0
    || (proposal.baseFingerprint !== null && typeof proposal.baseFingerprint !== 'string')
    || typeof proposal.candidateFingerprint !== 'string' || !proposal.candidateFingerprint
    || typeof proposal.previewRevision !== 'number' || !Number.isInteger(proposal.previewRevision) || proposal.previewRevision < 1
    || typeof diff.summary !== 'string') {
    throw new Error('Renderer proposal snapshot is malformed')
  }
  return structuredClone(proposal) as unknown as ProposalSnapshot
}

function parseProposalCandidateSnapshot(value: unknown): ProposalCandidateSnapshot {
  const payload = exactRecord(value, 'Renderer proposal candidate', ['proposal', 'candidate'])
  const proposal = parseProposalSnapshot(payload.proposal)
  if (!proposal || proposal.status !== 'pending') {
    throw new Error('Renderer proposal candidate is not pending')
  }
  const candidate = parseZatomStructure(payload.candidate)
  const candidateFingerprint = fingerprintStructure(candidate)
  if (candidateFingerprint !== proposal.candidateFingerprint) {
    throw new Error(
      `Renderer proposal candidate fingerprint ${candidateFingerprint} does not match ${proposal.candidateFingerprint}`,
    )
  }
  return { proposal, candidate }
}

/**
 * One request-local context. Reads bind subsequent writes to the same viewport
 * and source fingerprint, so a stale batch is rejected before renderer commit.
 */
export function createViewportBridgeToolContext(
  invokeViewport: ZatomViewportBridgeInvoker,
  /** Supplied by hosts that bridge more than one app instance, such as the dev bridge. */
  listAppInstances?: () => ZatomAppInstanceView[] | Promise<ZatomAppInstanceView[]>,
): ZatomToolContext {
  let binding: ViewportBinding | null = null
  let observedViewportId: string | null = null
  let structureObserved = false

  const expectedViewportId = (): string | undefined => binding?.viewportId ?? observedViewportId ?? undefined
  const viewportScope = (): { expectedViewportId?: string } => {
    const expected = expectedViewportId()
    return expected === undefined ? {} : { expectedViewportId: expected }
  }
  const acceptViewportId = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || !value) throw new Error(`${label} has no viewport identity`)
    const expected = expectedViewportId()
    if (expected !== undefined && expected !== value) {
      throw new Error(`Active viewport changed from ${expected} to ${value} during the MCP call`)
    }
    observedViewportId = value
    return value
  }
  const viewportResult = (value: unknown, label: string, key: string): unknown => {
    const envelope = exactRecord(value, label, ['viewportId', key])
    acceptViewportId(envelope.viewportId, label)
    return envelope[key]
  }

  const readWorkspaceIdentity = async (signal?: AbortSignal): Promise<ZatomWorkspaceIdentity> => {
    const identity = parseWorkspaceIdentity(viewportResult(
      await invokeViewport('read-workspace-identity', viewportScope(), undefined, signal),
      'Renderer workspace identity response',
      'identity',
    ), 'Renderer workspace identity')
    if (identity.viewportId !== observedViewportId) {
      throw new Error(`Renderer workspace identity belongs to ${identity.viewportId}, not ${observedViewportId}`)
    }
    if (binding && (
      identity.revision !== binding.revision
      || identity.structureFingerprint !== binding.structureFingerprint
      || identity.trajectoryFingerprint !== binding.trajectoryFingerprint
    )) {
      throw new Error(
        `Active workspace changed during the MCP call; expected ${binding.viewportId}@r${binding.revision}, `
        + `received ${identity.viewportId}@r${identity.revision}`,
      )
    }
    return identity
  }

  /**
   * Visual mutations need the same request-local compare-and-set boundary as
   * canonical structure writes. A camera/guidance/style tool often starts in a
   * fresh MCP request and therefore has no structure read to bind it. In that
   * case observe the complete identity first; if an earlier read already bound
   * the request, preserve that older identity so user edits since the read are
   * rejected rather than silently rebasing the visual action onto new state.
   */
  const visualWorkspaceExpectation = async (signal?: AbortSignal): Promise<VisualWorkspaceExpectation> => {
    const source = binding ?? await readWorkspaceIdentity(signal)
    binding ??= source
    return {
      expectedViewportId: source.viewportId,
      expectedRevision: source.revision,
      expectedStructureFingerprint: source.structureFingerprint,
      expectedTrajectoryFingerprint: source.trajectoryFingerprint,
    }
  }

  // Policy lives in the page. The probe carries the tool's own instanceId so a
  // multi-window host asks the page the tool is about to address; failures
  // (no window bound, ambiguous target) propagate and the registry refuses the
  // call with that reason. A malformed reply is treated as read-only.
  const readWriteMode = async (input: Record<string, unknown>): Promise<ZatomHostWriteMode> => {
    const instanceId = typeof input.instanceId === 'string' ? input.instanceId : undefined
    const value = record(
      await invokeViewport('read-host-write-mode', { host: 'cli-bridge', ...(instanceId ? { instanceId } : {}) }),
      'Host write mode',
    )
    return value.mode === 'read-write' || value.mode === 'propose-only' ? value.mode : 'read-only'
  }

  const readStructure = async (): Promise<ZatomStructure | null> => {
    const value = record(await invokeViewport('read-structure', viewportScope()), 'Renderer structure snapshot')
    const viewportId = acceptViewportId(value.viewportId, 'Renderer structure snapshot')
    const structure = value.structure === null ? null : parseZatomStructure(value.structure)
    const identity = parseWorkspaceIdentity(value.identity, 'Renderer structure workspace identity')
    const structureFingerprint = structure ? fingerprintStructure(structure) : null
    if (identity.viewportId !== viewportId || identity.structureFingerprint !== structureFingerprint) {
      throw new Error('Renderer structure snapshot does not match its workspace identity')
    }
    binding = identity
    structureObserved = true
    return structure
  }

/**
 * A write guard must use the state the Agent observed before writing.
 *
 * This previously used `if (!binding) await readStructure()`. Reading on demand
 * compared the current state with itself and always passed, leaving unobserved
 * writes unguarded. Candidate tools also read back only after writing through
 * `applyStructureCandidate`, so the whole candidate path fell into that branch.
 *
 * A missing binding now rejects the write. The Agent must read once before it
 * writes, making the expected fingerprint meaningful. The extra read ensures
 * that a user's manual edit between turns produces a fingerprint conflict instead
 * of being overwritten silently.
 */
  const ensureBinding = (): ViewportBinding => {
    if (!binding || !structureObserved) {
      throw new Error(
        'Read the active structure before writing: this host binds every write to the '
        + 'structure fingerprint you last observed, so an unobserved write cannot be checked '
        + 'for conflicts. Call the structure read tool first, then retry this write.',
      )
    }
    return binding
  }

  /** Grid describe/mount replies share one shape, so they share one parser. */
  const viewportView = (value: unknown): ZatomViewportView => {
    const grid = record(value, 'Renderer viewport description')
    if (typeof grid.layout !== 'string' || !Array.isArray(grid.slots)) {
      throw new Error('Renderer viewport description is malformed')
    }
    // Forward takeover records explicitly. This parser rebuilds objects field by
    // field and silently drops omitted fields, which would otherwise hide a user's
    // rejection from the Agent across the bridge boundary.
    const takeoverRaw = grid.userTakeover
    const takeover = takeoverRaw && typeof takeoverRaw === 'object'
      ? (takeoverRaw as { revertedLabel?: unknown; intent?: unknown; at?: unknown })
      : null
    // The intent determines whether the Agent stops, tries another approach, or
    // replans. Losing it across processes reduces distinct outcomes to a generic
    // "reverted", forcing the model to guess. Default to the conservative
    // `user_took_over`: waiting for one more user action is safer than overwriting.
    // Keep `preview_only` in the allowlist because it is the sole non-rejection;
    // downgrading it to takeover would stop a plan the user never rejected.
    const knownIntents: NonNullable<ZatomViewportView['userTakeover']>['intent'][] =
      ['retry_differently', 'replan_from_edits', 'preview_only']
    const intent: NonNullable<ZatomViewportView['userTakeover']>['intent'] =
      knownIntents.find((candidate) => candidate === takeover?.intent) ?? 'user_took_over'
    const userTakeover = takeover && typeof takeover.revertedLabel === 'string'
      ? {
        revertedLabel: takeover.revertedLabel,
        intent,
        at: typeof takeover.at === 'number' ? takeover.at : Date.now(),
      }
      : undefined
    const controlRaw = grid.agentControl && typeof grid.agentControl === 'object'
      ? grid.agentControl as Record<string, unknown>
      : null
    const controlPhase = controlRaw?.phase
    const agentControl: ZatomViewportView['agentControl'] = controlRaw
      && (controlPhase === 'idle' || controlPhase === 'animating'
        || controlPhase === 'awaiting-review' || controlPhase === 'user-takeover')
      && (controlRaw.label === null || typeof controlRaw.label === 'string')
      && Number.isSafeInteger(controlRaw.pendingOperations)
      && Number.isSafeInteger(controlRaw.queuedOperations)
      ? {
        phase: controlPhase as NonNullable<ZatomViewportView['agentControl']>['phase'],
        label: controlRaw.label as string | null,
        pendingOperations: Number(controlRaw.pendingOperations),
        queuedOperations: Number(controlRaw.queuedOperations),
      }
      : undefined
    return {
      ...(userTakeover ? { userTakeover } : {}),
      ...(agentControl ? { agentControl } : {}),
      instanceId: typeof grid.instanceId === 'string' ? grid.instanceId : 'local',
      layout: grid.layout,
      availableLayouts: Array.isArray(grid.availableLayouts)
        ? grid.availableLayouts.filter((entry): entry is string => typeof entry === 'string')
        : [],
      slots: grid.slots.map((entry) => {
        const slot = record(entry, 'viewport slot')
        const structureFingerprint = slot.structureFingerprint === null || typeof slot.structureFingerprint === 'string'
          ? slot.structureFingerprint
          : undefined
        const workspaceRevision = slot.workspaceRevision === null
          || (typeof slot.workspaceRevision === 'number' && Number.isInteger(slot.workspaceRevision) && slot.workspaceRevision >= 0)
          ? slot.workspaceRevision
          : undefined
        const trajectoryFingerprint = slot.trajectoryFingerprint === null || typeof slot.trajectoryFingerprint === 'string'
          ? slot.trajectoryFingerprint
          : undefined
        return {
          slotId: String(slot.slotId),
          slotIndex: Number(slot.slotIndex),
          kind: String(slot.kind),
          label: typeof slot.label === 'string' ? slot.label : null,
          structureLabel: typeof slot.structureLabel === 'string' ? slot.structureLabel : null,
          atomCount: typeof slot.atomCount === 'number' ? slot.atomCount : null,
          active: slot.active === true,
          ...(structureFingerprint === undefined ? {} : { structureFingerprint }),
          ...(trajectoryFingerprint === undefined ? {} : { trajectoryFingerprint }),
          ...(workspaceRevision === undefined ? {} : { workspaceRevision }),
        }
      }),
    }
  }

  const batchViews = (value: unknown): ZatomAssetBatchView[] => {
    const payload = record(value, 'Renderer batch listing')
    if (!Array.isArray(payload.batches)) throw new Error('Renderer batch listing is malformed')
    return payload.batches.map((entry) => {
      const batch = record(entry, 'workspace batch')
      return {
        id: String(batch.id),
        name: String(batch.name),
        frameIds: Array.isArray(batch.frameIds) ? batch.frameIds.map(String) : [],
        activeFrameId: typeof batch.activeFrameId === 'string' ? batch.activeFrameId : null,
        active: batch.active === true,
      }
    })
  }

  return {
    ...(listAppInstances ? { listAppInstances } : {}),
    access: { host: 'cli-bridge', mode: readWriteMode },
    bindExpectedWorkspace: (expected) => {
      binding = structuredClone(expected)
      observedViewportId = expected.viewportId
      structureObserved = true
    },
    viewport: {
      // instanceId rides in the payload because that is where the bridge's
      // target resolution reads it; omitting it means "the sole instance".
      describe: async (instanceId) => viewportView(
        await invokeViewport('viewport-describe', instanceId === undefined ? {} : { instanceId }),
      ),
      activate: async (slotId, options) => {
        const view = viewportView(await invokeViewport('viewport-activate', {
          slotId,
          expectedViewportId: options.expectedActiveViewportId,
          ...(options.instanceId === undefined ? {} : { instanceId: options.instanceId }),
        }, null, options.signal))
        const activeSlots = view.slots.filter((slot) => slot.active)
        if (activeSlots.length !== 1 || activeSlots[0].slotId !== slotId) {
          throw new Error(`Renderer did not activate the requested viewport pane ${slotId}`)
        }
        // This request-local context may be reused by programmatic callers.
        // Following calls must bind to the pane we just activated, never the
        // source pane observed before the switch.
        observedViewportId = slotId
        binding = null
        structureObserved = false
        return view
      },
      setLayout: async (layout, instanceId, signal) => viewportView(await invokeViewport('viewport-set-layout', {
        layout,
        ...(instanceId === undefined ? {} : { instanceId }),
      }, null, signal)),
      clear: async (slotId, clearOptions) => viewportView(await invokeViewport('viewport-clear', {
        slotId,
        targetStructureFingerprint: clearOptions.expectedTarget.structureFingerprint,
        targetTrajectoryFingerprint: clearOptions.expectedTarget.trajectoryFingerprint,
        targetWorkspaceRevision: clearOptions.expectedTarget.workspaceRevision,
        ...(clearOptions.instanceId === undefined ? {} : { instanceId: clearOptions.instanceId }),
      }, null, clearOptions.signal)),
      mount: async (structures, mountOptions) => viewportView(await invokeViewport('viewport-mount', {
        structures,
        ...(mountOptions.layout === undefined ? {} : { layout: mountOptions.layout }),
        ...(mountOptions.preserveExisting === undefined ? {} : { preserveExisting: mountOptions.preserveExisting }),
        ...(mountOptions.targetSlotIds === undefined ? {} : { targetSlotIds: mountOptions.targetSlotIds }),
        ...(mountOptions.expectedTargets === undefined ? {} : { expectedTargets: mountOptions.expectedTargets }),
        ...(mountOptions.instanceId === undefined ? {} : { instanceId: mountOptions.instanceId }),
      }, null, mountOptions.signal)),
    },
    assets: {
      // instanceId rides in the payload for the same reason as the viewport
      // calls above: each window owns a separate workspace, so the bridge needs
      // the target to route a batch write to the right one.
      listBatches: async (instanceId) => batchViews(
        await invokeViewport('assets-list-batches', instanceId === undefined ? {} : { instanceId }),
      ),
      createBatch: async (name, instanceId) => batchViews(await invokeViewport('assets-create-batch', {
        ...(name === undefined ? {} : { name }),
        ...(instanceId === undefined ? {} : { instanceId }),
      })),
      renameBatch: async (batchId, name, instanceId) => batchViews(await invokeViewport('assets-rename-batch', {
        batchId,
        name,
        ...(instanceId === undefined ? {} : { instanceId }),
      })),
      moveFrames: async (frameIds, toBatchId, instanceId) => batchViews(await invokeViewport('assets-move-frames', {
        frameIds,
        toBatchId,
        ...(instanceId === undefined ? {} : { instanceId }),
      })),
    },
    workspaceIdentity: readWorkspaceIdentity,
    readViewerScene: async (signal): Promise<ZatomViewerScene | null> => parseViewerScene(
      viewportResult(
        await invokeViewport('read-viewer-scene', viewportScope(), undefined, signal),
        'Renderer viewer scene response',
        'scene',
      ),
    ),
    camera: {
      lookAt: async (request: CameraLookAtRequest, signal?: AbortSignal): Promise<CameraFlightResult> => {
        const expectedWorkspace = await visualWorkspaceExpectation(signal)
        return parseCameraFlight(viewportResult(
          await invokeViewport('camera-look-at', { request, ...expectedWorkspace }, null, signal),
          'Renderer camera look-at response',
          'result',
        ))
      },
      setView: async (
        view: CameraViewSpec,
        durationMs?: number,
        signal?: AbortSignal,
      ): Promise<CameraFlightResult> => {
        const expectedWorkspace = await visualWorkspaceExpectation(signal)
        return parseCameraFlight(viewportResult(
          await invokeViewport('camera-set-view', {
            view,
            ...(durationMs === undefined ? {} : { durationMs }),
            ...expectedWorkspace,
          }, null, signal),
          'Renderer camera set-view response',
          'result',
        ))
      },
    },
    guidance: {
      read: async (): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-read', viewportScope()),
        'Renderer guidance read response',
        'snapshot',
      )),
      setPlan: async (steps, activeIndex, caption): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-set-plan', {
          steps, activeIndex, caption, ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance set-plan response',
        'snapshot',
      )),
      advance: async (activeIndex, caption): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-advance', {
          activeIndex,
          ...(caption === undefined ? {} : { caption }),
          ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance advance response',
        'snapshot',
      )),
      setCaption: async (caption): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-set-caption', { caption, ...await visualWorkspaceExpectation() }),
        'Renderer guidance caption response',
        'snapshot',
      )),
      annotate: async (
        annotations: GuidanceAnnotationInput[],
        replace: boolean,
      ): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-annotate', {
          annotations, replace, ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance annotation response',
        'snapshot',
      )),
      presentCandidates: async (
        label: string,
        items: GuidanceCandidateInput[],
      ): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-present-candidates', {
          label, items, ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance candidate response',
        'snapshot',
      )),
      focusCandidate: async (index): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-focus-candidate', {
          index, ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance focus-candidate response',
        'snapshot',
      )),
      candidateStatus: async (candidateSetId, waitMs = 0, signal): Promise<GuidanceCandidateStatus> => {
        const status = parseGuidanceCandidateStatus(viewportResult(
          await invokeViewport('guidance-candidate-status', {
            candidateSetId,
            waitMs,
            ...viewportScope(),
          }, waitMs > 0 ? waitMs + 2_000 : undefined, signal),
          'Renderer guidance candidate-status response',
          'status',
        ))
        if (status.candidateSetId !== candidateSetId) {
          throw new Error(`Renderer returned candidate set ${status.candidateSetId}, not ${candidateSetId}`)
        }
        return status
      },
      clear: async (scope?: GuidanceClearScope): Promise<GuidanceSnapshot> => parseGuidanceSnapshot(viewportResult(
        await invokeViewport('guidance-clear', {
          ...(scope === undefined ? {} : { scope }),
          ...await visualWorkspaceExpectation(),
        }),
        'Renderer guidance clear response',
        'snapshot',
      )),
    },
    viewerStyle: {
      read: async (): Promise<ViewerStyleSnapshot> => parseViewerStyleSnapshot(viewportResult(
        await invokeViewport('viewer-style-read', viewportScope()),
        'Renderer viewer style read response',
        'snapshot',
      )),
      apply: async (patch: ViewerStylePatch): Promise<ViewerStyleSnapshot> => parseViewerStyleSnapshot(viewportResult(
        await invokeViewport('viewer-style-apply', { patch, ...await visualWorkspaceExpectation() }),
        'Renderer viewer style apply response',
        'snapshot',
      )),
    },
    proposal: {
      propose: async ({
        intent, baseFingerprint, viewportId, workspaceRevision, candidate, checks, inspectionTargets, signal,
      }): Promise<ProposalSnapshot> => {
        const expected = expectedViewportId()
        if (expected !== undefined && expected !== viewportId) {
          throw new Error(`Proposal targets viewport ${viewportId}, but this call is bound to ${expected}`)
        }
        const proposal = parseProposalSnapshot(viewportResult(
          await invokeViewport('proposal-propose', {
            intent,
            baseFingerprint,
            workspaceRevision,
            candidate: parseZatomStructure(structuredClone(candidate)),
            ...(checks?.length ? { checks: structuredClone(checks) } : {}),
            ...(inspectionTargets?.length ? { inspectionTargets: structuredClone(inspectionTargets) } : {}),
            expectedViewportId: viewportId,
          }, undefined, signal),
          'Renderer proposal response',
          'proposal',
        ))
        if (!proposal) throw new Error('Renderer did not publish the structure proposal')
        if (proposal.viewportId !== viewportId || proposal.workspaceRevision !== workspaceRevision
          || proposal.baseFingerprint !== baseFingerprint) {
          throw new Error('Renderer published a proposal for a different workspace revision')
        }
        return proposal
      },
      readCandidate: async ({
        id, expectedPreviewRevision, expectedCandidateFingerprint, signal,
      }): Promise<ProposalCandidateSnapshot> => {
        const candidate = parseProposalCandidateSnapshot(viewportResult(
          await invokeViewport('proposal-read-candidate', {
            proposalId: id,
            expectedPreviewRevision,
            expectedCandidateFingerprint,
            ...await visualWorkspaceExpectation(signal),
          }, undefined, signal),
          'Renderer proposal candidate response',
          'candidate',
        ))
        if (candidate.proposal.id !== id
          || candidate.proposal.previewRevision !== expectedPreviewRevision
          || candidate.proposal.candidateFingerprint !== expectedCandidateFingerprint) {
          throw new Error(`Renderer returned a different generation of proposal ${id}`)
        }
        return candidate
      },
      revise: async ({
        id, expectedPreviewRevision, expectedCandidateFingerprint,
        intent, candidate, checks, inspectionTargets, signal,
      }): Promise<ProposalSnapshot> => {
        const parsedCandidate = parseZatomStructure(structuredClone(candidate))
        const proposal = parseProposalSnapshot(viewportResult(
          await invokeViewport('proposal-revise', {
            proposalId: id,
            expectedPreviewRevision,
            expectedCandidateFingerprint,
            intent,
            candidate: parsedCandidate,
            ...(checks?.length ? { checks: structuredClone(checks) } : {}),
            ...(inspectionTargets?.length ? { inspectionTargets: structuredClone(inspectionTargets) } : {}),
            ...await visualWorkspaceExpectation(signal),
          }, undefined, signal),
          'Renderer revised proposal response',
          'proposal',
        ))
        if (!proposal) throw new Error(`Renderer did not revise proposal ${id}`)
        const revisedFingerprint = fingerprintStructure(parsedCandidate)
        if (proposal.id !== id
          || proposal.status !== 'pending'
          || proposal.previewRevision !== expectedPreviewRevision + 1
          || proposal.candidateFingerprint !== revisedFingerprint) {
          throw new Error(`Renderer returned an inconsistent revision of proposal ${id}`)
        }
        return proposal
      },
      status: async (proposalId, signal): Promise<ProposalSnapshot | null> => {
        const proposal = parseProposalSnapshot(viewportResult(
          await invokeViewport('proposal-status', { proposalId, ...viewportScope() }, undefined, signal),
          'Renderer proposal status response',
          'proposal',
        ))
        if (proposal && (proposal.id !== proposalId || proposal.viewportId !== expectedViewportId())) {
          throw new Error(
            `Renderer returned proposal ${proposal.id} from viewport ${proposal.viewportId}, not ${proposalId} in ${expectedViewportId()}`,
          )
        }
        return proposal
      },
      withdraw: async (proposalId, signal): Promise<ProposalSnapshot | null> => {
        const proposal = parseProposalSnapshot(viewportResult(
          await invokeViewport('proposal-withdraw', { proposalId, ...viewportScope() }, undefined, signal),
          'Renderer proposal withdrawal response',
          'proposal',
        ))
        if (proposal && (proposal.id !== proposalId || proposal.viewportId !== expectedViewportId())) {
          throw new Error(
            `Renderer returned proposal ${proposal.id} from viewport ${proposal.viewportId}, not ${proposalId} in ${expectedViewportId()}`,
          )
        }
        return proposal
      },
    },
    readStructure,
    readTrajectory: async (): Promise<ZatomTrajectory | null> => {
      const value = record(await invokeViewport('read-trajectory', viewportScope()), 'Renderer trajectory snapshot')
      const viewportId = acceptViewportId(value.viewportId, 'Renderer trajectory snapshot')
      const trajectory = value.trajectory === null ? null : parseZatomTrajectory(value.trajectory)
      const identity = parseWorkspaceIdentity(value.identity, 'Renderer trajectory workspace identity')
      const trajectoryFingerprint = trajectory ? fingerprintTrajectory(trajectory) : null
      if (identity.viewportId !== viewportId || identity.trajectoryFingerprint !== trajectoryFingerprint) {
        throw new Error('Renderer trajectory snapshot does not match its workspace identity')
      }
      return trajectory
    },
    writeStructure: async (structure, _expected, signal): Promise<void> => {
      const source = ensureBinding()
      const next = parseZatomStructure(structuredClone(structure))
      const value = record(await invokeViewport('commit-structure', {
        structure: next,
        expectedViewportId: source.viewportId,
        expectedStructureFingerprint: source.structureFingerprint,
        expectedRevision: source.revision,
      }, null, signal), 'Renderer structure commit')
      const viewportId = acceptViewportId(value.viewportId, 'Renderer structure commit')
      const identity = parseWorkspaceIdentity(value.identity, 'Renderer committed workspace identity')
      if (identity.viewportId !== viewportId || identity.structureFingerprint !== fingerprintStructure(next)) {
        throw new Error('Renderer structure commit does not match its resulting workspace identity')
      }
      binding = identity
    },
    writeWorkspace: async (structure, trajectory, _expected, signal): Promise<void> => {
      const source = ensureBinding()
      const next = parseZatomStructure(structuredClone(structure))
      const nextTrajectory = parseZatomTrajectory(structuredClone(trajectory), { structure: next })
      const value = record(await invokeViewport('commit-workspace', {
        structure: next,
        trajectory: nextTrajectory,
        expectedViewportId: source.viewportId,
        expectedStructureFingerprint: source.structureFingerprint,
        expectedRevision: source.revision,
      }, null, signal), 'Renderer workspace commit')
      const viewportId = acceptViewportId(value.viewportId, 'Renderer workspace commit')
      const identity = parseWorkspaceIdentity(value.identity, 'Renderer committed workspace identity')
      if (identity.viewportId !== viewportId
        || identity.structureFingerprint !== fingerprintStructure(next)
        || identity.trajectoryFingerprint !== fingerprintTrajectory(nextTrajectory)) {
        throw new Error('Renderer workspace commit does not match its resulting workspace identity')
      }
      binding = identity
    },
    writeTrajectory: async (trajectory, _expected, signal): Promise<void> => {
      const source = ensureBinding()
      const value = parseZatomTrajectory(structuredClone(trajectory))
      const response = record(await invokeViewport('write-trajectory', {
        trajectory: value,
        expectedViewportId: source.viewportId,
        expectedStructureFingerprint: source.structureFingerprint,
        expectedRevision: source.revision,
      }, null, signal), 'Renderer trajectory commit')
      const viewportId = acceptViewportId(response.viewportId, 'Renderer trajectory commit')
      const identity = parseWorkspaceIdentity(response.identity, 'Renderer trajectory workspace identity')
      if (identity.viewportId !== viewportId || identity.trajectoryFingerprint !== fingerprintTrajectory(value)) {
        throw new Error('Renderer trajectory commit does not match its resulting workspace identity')
      }
      binding = identity
    },
    focusInspectionTarget: async (target: InspectionTarget): Promise<ViewportTargetPlacement | null> => (
      invokeViewport('focus-target', {
        target,
        ...await visualWorkspaceExpectation(),
      }, null) as Promise<ViewportTargetPlacement | null>
    ),
    applyViewerSelection: async (atomIds: string[]): Promise<void> => {
      await invokeViewport('apply-viewer-selection', {
        atomIds,
        ...await visualWorkspaceExpectation(),
      }, null)
    },
    captureViewport: (options): Promise<CapturedImage | null> => (
      invokeViewport('capture-viewport', {
        options,
        ...viewportScope(),
      }, null) as Promise<CapturedImage | null>
    ),
  }
}
