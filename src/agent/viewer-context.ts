/** Default tool context backed by the active zatom viewport. */

import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { useAgentInspectionOverlayStore } from '../orchestration/agentInspectionOverlayStore'
import {
  performAppliedResultReveal,
  awaitChoreographyIdle,
  claimChoreographySlot,
} from '../orchestration/modelingChoreographer'
import { useChoreographyNarration } from '../orchestration/choreographyNarrationStore'
import {
  useAgentOperationReview,
  assertAgentMayMutateWorkspaceNow,
  selectManualControl,
  assertAgentMayMutateWorkspace,
} from '../orchestration/agentOperationReviewStore'
import { captureViewport, getViewportLogicalSize, getViewportPose, measureViewportTarget } from '../orchestration/viewportCaptureRegistry'
import { readWorkspaceRevision } from '../orchestration/workspaceRevisionTracker'
import { activeViewportStyleSurface } from './viewer-style-surface'
import { createActiveViewportCameraSurface, readLastCameraFocus } from './camera-surface'
import { activeViewportGuidanceSurface } from './guidance-surface'
import { activeViewportProposalSurface } from './proposal-surface'
import { createActiveViewportHistorySurface, recordCanonicalWrite } from './history-surface'
import { pendingProposal, toProposalSnapshot, useAgentProposalStore } from '../orchestration/agentProposalStore'
import type { ProposalSnapshot } from './contracts'
import { GRID_SPECS, useViewportManager } from '../orchestration/viewportManager'
import type { Atom, Bond } from '../lib/crystal/types'
import type { AuxValue, XYZFrame } from '../lib/crystal/xyz-parser'
import type { TrajectoryFrameMetadata } from '../lib/analysis/trajectory'
import {
  stripDerivedAtomAttributes,
  stripPtmAtomAttributes,
  type AtomAttributes,
} from '../orchestration/slices/atom-attributes-slice'
import type { JsonValue, Mat3, Vec3, ZatomStructure, ZatomToolContext, ZatomTrajectory, ZatomWorkspaceIdentity } from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import type { AgentWorkspaceRevisionContext } from './workspace-revision'
import {
  parseZatomOvitoPtmAnnotation,
  ZATOM_OVITO_PTM_METADATA_KEY,
  ZATOM_OVITO_PTM_PROPERTY_PREFIX,
} from './ovito-ptm-annotation'
import {
  hasZatomSpglibStructureAnnotation,
  ZATOM_SPGLIB_EXPANSION_METADATA_KEY,
  ZATOM_SPGLIB_EXPANSION_PROPERTY_PREFIX,
  ZATOM_SPGLIB_SYMMETRY_METADATA_KEY,
  ZATOM_SPGLIB_SYMMETRY_PROPERTY_PREFIX,
} from './spglib-symmetry-annotation'
import { auditStructureHealth, summarizeStructureHealth } from './structure-health'
import { parseZatomStructure, validateStructure } from './structure-validation'
import { inPageAssetsSurface } from './workspace-assets-surface'
import { createInPageViewportSurface } from './in-page-viewport-surface'
import { fingerprintStructure } from './structure-math'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

interface CompactStructureView {
  positions: Float32Array
  elementIndex: Uint8Array
  elements: string[]
  count: number
}

const EXPLICIT_TOPOLOGY_PROP = 'zatom.explicitBondTopology'
const TRAJECTORY_AUX_PROPS = new Set(['velocityAperPs', 'forceEvPerA'])

interface CanonicalStructureSidecar {
  atomIdentity: Array<{ id: string; element: string }>
  atomProperties: Map<string, Record<string, JsonValue>>
  bondProperties: Map<string, Record<string, JsonValue>>
  metadata: Record<string, JsonValue>
  /** Exact finite or mixed-PBC cell; the viewport store has only one global periodic toggle. */
  nonFullyPeriodicLattice?: ZatomStructure['lattice']
  /** Accepted final model state; trajectory frame changes are presentation-only. */
  trajectoryResultStructure?: ZatomStructure
  /** Accepted trajectory artifact; rendered frames are presentation-only. */
  trajectoryArtifact?: ZatomTrajectory
  /** Clears structure-bound analysis/construction evidence when canonical geometry changes. */
  analysisUnsubscribe?: () => void
}

// The rendering store intentionally accepts only numeric scalar/vector props.
// Keep the rest of a canonical artifact (residue names, provenance metadata,
// bond annotations, etc.) beside that store so write/readback identity remains
// lossless without polluting the renderer's AuxValue contract.
const canonicalStructureSidecars = new WeakMap<object, CanonicalStructureSidecar>()

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function cloneJsonRecord(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> | undefined {
  if (!value) return undefined
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function removePtmFromSidecar(sidecar: CanonicalStructureSidecar): void {
  for (const [atomId, properties] of sidecar.atomProperties) {
    for (const key of Object.keys(properties)) {
      if (key.startsWith(`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.`)) delete properties[key]
    }
    if (!Object.keys(properties).length) sidecar.atomProperties.delete(atomId)
  }
  delete sidecar.metadata[ZATOM_OVITO_PTM_METADATA_KEY]
}

function removeSpglibFromSidecar(sidecar: CanonicalStructureSidecar): void {
  for (const [atomId, properties] of sidecar.atomProperties) {
    for (const key of Object.keys(properties)) {
      if (key.startsWith(`${ZATOM_SPGLIB_SYMMETRY_PROPERTY_PREFIX}.`)
        || key.startsWith(`${ZATOM_SPGLIB_EXPANSION_PROPERTY_PREFIX}.`)) delete properties[key]
    }
    if (!Object.keys(properties).length) sidecar.atomProperties.delete(atomId)
  }
  delete sidecar.metadata[ZATOM_SPGLIB_SYMMETRY_METADATA_KEY]
  delete sidecar.metadata[ZATOM_SPGLIB_EXPANSION_METADATA_KEY]
}

function matchingSidecar(
  api: object,
  atoms: readonly Atom[],
): CanonicalStructureSidecar | undefined {
  const sidecar = canonicalStructureSidecars.get(api)
  if (!sidecar) return undefined
  const matches = atoms.length === sidecar.atomIdentity.length && atoms.every((atom, index) => (
    atom.id === sidecar.atomIdentity[index].id && atom.element === sidecar.atomIdentity[index].element
  ))
  if (matches) return sidecar
  canonicalStructureSidecars.delete(api)
  return undefined
}

export function viewportIdForStore(api: ReturnType<typeof getActiveViewportStoreApi>): string | null {
  const manager = useViewportManager.getState()
  for (const [viewportId, slot] of Object.entries(manager.viewports)) {
    if (slot.kind === 'crystal'
      && (slot.storeInstance as unknown as object) === (api as unknown as object)) return viewportId
  }
  return null
}

function viewportLabel(api: ReturnType<typeof getActiveViewportStoreApi>): string | undefined {
  const manager = useViewportManager.getState()
  const viewportId = viewportIdForStore(api)
  const slot = viewportId ? manager.viewports[viewportId] : undefined
  return slot?.kind === 'crystal' ? slot.structureName ?? undefined : undefined
}

function canonicalProperties(props: Record<string, AuxValue> | undefined): Record<string, JsonValue> | undefined {
  if (!props) return undefined
  const entries = Object.entries(props)
    .filter(([key]) => key !== EXPLICIT_TOPOLOGY_PROP && !TRAJECTORY_AUX_PROPS.has(key))
    .map(([key, value]) => [
      key,
      key === 'formalCharge' && value.kind === 'scalar' ? value.value : value,
    ])
  return entries.length ? Object.fromEntries(entries) as unknown as Record<string, JsonValue> : undefined
}

function viewerProperties(properties: Record<string, JsonValue> | undefined, explicitTopology = false): Record<string, AuxValue> | undefined {
  const props: Record<string, AuxValue> = {}
  for (const [key, raw] of Object.entries(properties ?? {})) {
    if (key === 'formalCharge' && typeof raw === 'number' && Number.isFinite(raw)) {
      props[key] = { kind: 'scalar', value: raw }
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const value = raw as Record<string, JsonValue>
    if (value.kind === 'scalar' && typeof value.value === 'number' && Number.isFinite(value.value)) {
      props[key] = { kind: 'scalar', value: value.value }
    } else if (value.kind === 'vector' && Array.isArray(value.value) && value.value.length === 3
      && value.value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      props[key] = { kind: 'vector', value: [...value.value] as [number, number, number] }
    }
  }
  if (explicitTopology) props[EXPLICIT_TOPOLOGY_PROP] = { kind: 'scalar', value: 1 }
  return Object.keys(props).length ? props : undefined
}

function canonicalBondOrder(type: Bond['type']): 1 | 1.5 | 2 | 3 {
  if (type === 'double') return 2
  if (type === 'triple') return 3
  if (type === 'aromatic') return 1.5
  return 1
}

function viewerBondType(order: 1 | 1.5 | 2 | 3): Bond['type'] {
  if (order === 2) return 'double'
  if (order === 3) return 'triple'
  if (order === 1.5) return 'aromatic'
  return 'single'
}

export function readViewportStructure(
  api: ReturnType<typeof getActiveViewportStoreApi>,
): ZatomStructure | null {
  const state = api.getState()
  const sidecar = state.atoms.length ? matchingSidecar(api as object, state.atoms) : undefined
  const compact = state.compactStructure as CompactStructureView | null
  const trajectoryResult = state.trajectoryFormatKind === 'zatom_agent' && state.trajectoryFrames?.length
    ? sidecar?.trajectoryResultStructure
    : undefined
  const selectedIds = state.selectedAtomIds ?? new Set<string>()
  const atoms = trajectoryResult
    ? trajectoryResult.atoms.map((atom) => ({
        ...atom,
        position: [...atom.position] as Vec3,
        ...(atom.properties ? { properties: cloneJsonRecord(atom.properties)! } : {}),
      }))
    : state.atoms.length
    ? state.atoms.map((atom) => {
        const renderedProperties = canonicalProperties(atom.props)
        const preservedProperties = sidecar?.atomProperties.get(atom.id)
        const properties = preservedProperties || renderedProperties
          ? { ...(preservedProperties ?? {}), ...(renderedProperties ?? {}) }
          : undefined
        return {
          id: atom.id,
          element: atom.element,
          position: [...(atom.cartesian ?? atom.position)] as Vec3,
          ...(properties ? { properties } : {}),
        }
      })
    : compact
      ? Array.from({ length: compact.count }, (_, index) => ({
          id: `compact-${index}`,
          element: compact.elements[compact.elementIndex[index]] ?? 'X',
          position: [compact.positions[index * 3], compact.positions[index * 3 + 1], compact.positions[index * 3 + 2]] as Vec3,
        }))
      : []
  if (!atoms.length) return null
  const explicitTopology = state.atoms.some((atom) => {
    const marker = atom.props?.[EXPLICIT_TOPOLOGY_PROP]
    return marker?.kind === 'scalar' && marker.value === 1
  })
  const bonds = explicitTopology ? state.bonds.map((bond) => ({
    id: bond.id,
    atomIds: [bond.atom1Id, bond.atom2Id] as [string, string],
    order: canonicalBondOrder(bond.type),
    ...(sidecar?.bondProperties.get(bond.id) ? {
      properties: cloneJsonRecord(sidecar.bondProperties.get(bond.id))!,
    } : {}),
  })) : undefined

  const selectedIndices: number[] = []
  if (state.atoms.length) state.atoms.forEach((atom, index) => { if (selectedIds.has(atom.id)) selectedIndices.push(index) })
  else if (compact) selectedIndices.push(...[...(state.selectedCompactIndices ?? new Set<number>())].sort((a, b) => a - b))

  const metadata: Record<string, JsonValue> = {
    ...(cloneJsonRecord(sidecar?.metadata) ?? {}),
    viewer: {
      selectedIndices: selectedIndices.slice(0, 200),
      selectedCount: selectedIndices.length,
      selectedIndicesTruncated: selectedIndices.length > 200,
      compactMode: !!compact,
    },
  }
  let lattice: ZatomStructure['lattice']
  if (trajectoryResult?.lattice) {
    lattice = {
      vectors: trajectoryResult.lattice.vectors.map((vector) => [...vector]) as Mat3,
      periodic: [...trajectoryResult.lattice.periodic] as [boolean, boolean, boolean],
    }
  } else if (state.periodic && !compact) {
    const { a, b, c } = state.latticeVectors
    const { nx, ny, nz } = state.supercellParams
    lattice = {
      vectors: [
        a.map((v) => v * nx) as Vec3,
        b.map((v) => v * ny) as Vec3,
        c.map((v) => v * nz) as Vec3,
      ] as Mat3,
      periodic: [true, true, true],
    }
  } else if (!state.periodic && sidecar?.nonFullyPeriodicLattice) {
    lattice = {
      vectors: sidecar.nonFullyPeriodicLattice.vectors.map((vector) => [...vector]) as Mat3,
      periodic: [...sidecar.nonFullyPeriodicLattice.periodic] as [boolean, boolean, boolean],
    }
  }
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    ...(bonds ? { bonds } : {}),
    ...(lattice ? { lattice } : {}),
    ...(viewportLabel(api) ? { label: viewportLabel(api) } : {}),
    metadata,
  }
}

export function readActiveViewportStructure(): ZatomStructure | null {
  return readViewportStructure(getActiveViewportStoreApi())
}

export function structureToExtxyz(structure: ZatomStructure): string {
  const lattice = structure.lattice?.periodic.every(Boolean) ? structure.lattice : undefined
  const label = (structure.label ?? 'zatom structure').replace(/[\r\n]+/g, ' ')
  const comment = lattice
    ? `Lattice="${lattice.vectors.flat().map((v) => Number(v).toPrecision(12)).join(' ')}" Properties=species:S:1:pos:R:3 pbc="${lattice.periodic.map((v) => v ? 'T' : 'F').join(' ')}" ${label}`
    : `Properties=species:S:1:pos:R:3 ${label}`
  return [
    String(structure.atoms.length),
    comment,
    ...structure.atoms.map((atom) => `${atom.element} ${atom.position[0].toPrecision(12)} ${atom.position[1].toPrecision(12)} ${atom.position[2].toPrecision(12)}`),
  ].join('\n')
}

export async function writeActiveViewportStructure(
  structure: ZatomStructure,
  options: { beforeStructureReplace?: () => void; recordHistory?: boolean } = {},
): Promise<void> {
  const manager = useViewportManager.getState()
  const viewportId = manager.activeViewportId
  const api = manager.getActiveStore()
  return writeViewportStructure(api, viewportId, structure, options)
}

/** Write one exact viewport store without consulting whichever pane is active later. */
export async function writeViewportStructure(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  viewportId: string,
  structure: ZatomStructure,
  options: { beforeStructureReplace?: () => void; recordHistory?: boolean } = {},
): Promise<void> {
  if (viewportIdForStore(api) !== viewportId) {
    throw new Error(`Viewport ${viewportId} is no longer bound to the structure store being written`)
  }
  const validation = validateStructure(structure)
  if (validation.verdict === 'fail') {
    const failures = validation.checks.filter((check) => check.status === 'fail').map((check) => check.message)
    throw new Error(`Active viewport rejected invalid structure: ${failures.join('; ')}`)
  }
  // Every canonical write is undoable via the agent history surface, except
  // the undo/redo writes themselves.
  if (options.recordHistory !== false) {
    recordCanonicalWrite(readViewportStructure(api), api as object, readViewportTrajectory(api))
  }
  const ptmAnnotation = parseZatomOvitoPtmAnnotation(structure)
  const spglibAnnotation = hasZatomSpglibStructureAnnotation(structure)
  const previousState = api.getState()
  const preservesAtomIdentity = previousState.atoms.length === structure.atoms.length
    && previousState.atoms.every((atom, index) => (
      atom.id === structure.atoms[index].id && atom.element === structure.atoms[index].element
    ))
  const atomAttributes: Record<string, AtomAttributes> = preservesAtomIdentity
    ? stripDerivedAtomAttributes(previousState.atomAttributes)
    : {}
  if (ptmAnnotation) {
    for (const [atomId, annotation] of ptmAnnotation.atoms) {
      atomAttributes[atomId] = {
        ...(atomAttributes[atomId] ?? {}),
        ptmAnalyzed: annotation.analyzed,
        ptmStructureType: annotation.structureType,
        ptmRmsd: annotation.rmsd,
        ...(annotation.interatomicDistanceA === null
          ? {}
          : { ptmInteratomicDistanceA: annotation.interatomicDistanceA }),
        ...(annotation.orderingType === null ? {} : { ptmOrderingType: annotation.orderingType }),
        ...(annotation.elasticGreenLagrangeStrainMagnitude === null
          ? {}
          : { ptmElasticStrainMagnitude: annotation.elasticGreenLagrangeStrainMagnitude }),
        ...(annotation.elasticVolumeRatio === null
          ? {}
          : { ptmElasticVolumeRatio: annotation.elasticVolumeRatio }),
      }
    }
  }
  const result = await api.getState().loadFromXYZ(structureToExtxyz(structure), {
    beforeStructureReplace: () => {
      options.beforeStructureReplace?.()
      canonicalStructureSidecars.get(api as object)?.analysisUnsubscribe?.()
    },
  })
  if (!result.success) throw new Error(`Active viewport rejected generated structure: ${result.error}`)
  const loaded = api.getState()
  if (loaded.atoms.length !== structure.atoms.length) {
    throw new Error(`Active viewport loaded ${loaded.atoms.length} atoms, expected ${structure.atoms.length}`)
  }

  // loadFromXYZ deliberately creates fresh UI IDs. Restore artifact IDs so
  // inspectionTargets/change sets returned to an agent address the same atoms
  // that are visible in the viewport. Bonds are remapped transactionally.
  const idMap = new Map<string, string>()
  const explicitTopology = structure.bonds !== undefined
  const remapAtom = (atom: Atom, index: number): Atom => {
    const canonical = structure.atoms[index]
    const props = viewerProperties(canonical.properties, explicitTopology)
    idMap.set(atom.id, canonical.id)
    return {
      ...atom,
      id: canonical.id,
      element: canonical.element,
      ...(props ? { props } : {}),
    }
  }
  const atoms = loaded.atoms.map(remapAtom)
  const unitCellAtoms = loaded.periodic && loaded.unitCellAtoms.length === structure.atoms.length
    ? loaded.unitCellAtoms.map((atom, index) => {
        const props = viewerProperties(structure.atoms[index].properties, explicitTopology)
        return {
          ...atom,
          id: structure.atoms[index].id,
          element: structure.atoms[index].element,
          ...(props ? { props } : {}),
        }
      })
    : loaded.periodic ? loaded.unitCellAtoms : []
  const bonds: Bond[] = structure.bonds
    ? structure.bonds.map((bond) => ({
        id: bond.id,
        atom1Id: bond.atomIds[0],
        atom2Id: bond.atomIds[1],
        type: viewerBondType(bond.order),
      }))
    : loaded.bonds.map((bond) => ({
        ...bond,
        atom1Id: idMap.get(bond.atom1Id) ?? bond.atom1Id,
        atom2Id: idMap.get(bond.atom2Id) ?? bond.atom2Id,
      }))
  api.setState({
    atoms,
    unitCellAtoms,
    bonds,
    atomAttributes,
    ptmAnalysis: ptmAnnotation?.summary ?? null,
    showPtmColoring: ptmAnnotation !== null,
    // Mixed PBC is rendered as a finite object; the exact axes remain in the
    // canonical sidecar and are restored on readback.
    periodic: structure.lattice?.periodic.every(Boolean) ?? false,
    // Canonical Agent writes are complete workspace replacements. Coordinate-only
    // history cannot safely restore sidecars, trajectories, or
    // mixed PBC, so it must never survive across this boundary.
    history: [],
    historyIndex: -1,
  })
  const sidecar: CanonicalStructureSidecar = {
    atomIdentity: structure.atoms.map((atom) => ({ id: atom.id, element: atom.element })),
    atomProperties: new Map(structure.atoms.flatMap((atom) => {
      const properties = cloneJsonRecord(atom.properties)
      return properties ? [[atom.id, properties] as const] : []
    })),
    bondProperties: new Map((structure.bonds ?? []).flatMap((bond) => {
      const properties = cloneJsonRecord(bond.properties)
      return properties ? [[bond.id, properties] as const] : []
    })),
    metadata: Object.fromEntries(
      Object.entries(cloneJsonRecord(structure.metadata) ?? {}).filter(([key]) => key !== 'viewer'),
    ),
    ...(structure.lattice && !structure.lattice.periodic.every(Boolean) ? {
      nonFullyPeriodicLattice: {
        vectors: structure.lattice.vectors.map((vector) => [...vector]) as Mat3,
        periodic: [...structure.lattice.periodic] as [boolean, boolean, boolean],
      },
    } : {}),
  }
  canonicalStructureSidecars.set(api as object, sidecar)
  useViewportManager.getState().setStructureName(viewportId, structure.label ?? 'Generated structure')
  if (ptmAnnotation || spglibAnnotation) {
    sidecar.analysisUnsubscribe = api.subscribe((state, previous) => {
      const structureStateChanged = state.atoms !== previous.atoms
        || state.unitCellAtoms !== previous.unitCellAtoms
        || state.bonds !== previous.bonds
        || state.latticeVectors !== previous.latticeVectors
        || state.supercellParams !== previous.supercellParams
        || state.periodic !== previous.periodic
      if (!structureStateChanged) return
      sidecar.analysisUnsubscribe?.()
      sidecar.analysisUnsubscribe = undefined
      if (ptmAnnotation) removePtmFromSidecar(sidecar)
      if (spglibAnnotation) removeSpglibFromSidecar(sidecar)
      if (ptmAnnotation) {
        api.setState({
          atomAttributes: stripPtmAtomAttributes(api.getState().atomAttributes),
          ptmAnalysis: null,
          showPtmColoring: false,
        })
      }
    })
  }
}

export interface ActiveViewportStructureCommitGuard {
  expectedViewportId?: string
  expectedStructureFingerprint?: string | null
  expectedRevision?: number
  /** Internal user authorization for applying exactly one pending ghost. */
  authorizedProposalId?: string
  /** Request-owned cancellation. Checked before queueing and at the exact CAS boundary. */
  signal?: AbortSignal
  /** Called after the final pre-write CAS, immediately before canonical state changes. */
  onCommitStart?: () => void
}

function throwIfCommitCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Workspace commit was cancelled')
}

async function awaitCommitStage<T>(stage: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  throwIfCommitCancelled(signal)
  if (!signal) return stage
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(signal.reason instanceof Error ? signal.reason : new Error('Workspace commit was cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    stage.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
    if (signal.aborted) onAbort()
  })
}

/**
 * Commit gate: serialize Agent structure writes so only one runs at a time.
 *
 * Without this gate, consecutive commits such as supercell followed by surface
 * cutting can land concurrently. The second can replace the structure while the
 * first review card is still open, leaving the user to keep or revert the wrong
 * model. The queue lets each write complete the full write, reveal, and review
 * cycle before the next commit starts.
 *
 * A failure must release the next entry as well. Converting rejection to
 * resolution keeps one exception from permanently blocking the gate.
 */
let commitGate: Promise<unknown> = Promise.resolve()
let pendingCommitCount = 0
function enqueueCommit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  // A request cancelled during candidate computation must not even occupy the
  // queue. The tracked task repeats this check when its predecessor releases.
  throwIfCommitCancelled(signal)
  pendingCommitCount += 1
  useAgentOperationReview.getState().setPendingOperations(pendingCommitCount)
  const tracked = async () => {
    try {
      throwIfCommitCancelled(signal)
      return await task()
    } finally {
      pendingCommitCount = Math.max(0, pendingCommitCount - 1)
      useAgentOperationReview.getState().setPendingOperations(pendingCommitCount)
    }
  }
  const run = commitGate.then(tracked, tracked)
  commitGate = run.catch(() => undefined)
  return run
}

/**
 * A commit opens its review card asynchronously after the reveal animation.
 * If the next commit passes `assertAgentMayMutateWorkspace` before then, the
 * cards collide: `openReview` throws after the structure has already changed,
 * and the user answers the old question while viewing the new structure.
 * Therefore each commit waits for the preceding card to open before asking
 * whether another write may proceed.
 */
let pendingReviewOpen: Promise<void> = Promise.resolve()

/**
 * Compare-and-set boundary used by the browser viewport bridge. A batch tool
 * computes and validates its complete candidate before reaching this method;
 * stale viewport/source identity therefore fails before any renderer write.
 *
 * A successful commit triggers `performAppliedResultReveal`, which replays the
 * applied result as a visible incremental animation: remove old atoms, add new
 * atoms, focus the changed region, then return to the overview. Captions flow
 * through `choreographyNarrationStore`. This is fire-and-forget so the MCP call
 * returns immediately; the animation is purely presentational and settles on
 * the committed next state. The choreographer has a single-flight guard, so
 * later reveals are skipped when the Agent submits changes in rapid succession.
 */
export async function commitActiveViewportStructure(
  structure: ZatomStructure,
  guard: ActiveViewportStructureCommitGuard = {},
): Promise<void> {
  return commitActiveViewportWorkspace(structure, undefined, guard)
}

/**
 * Commit one complete structure/trajectory document behind a single CAS,
 * queue entry and review.  The trajectory is deliberately written before the
 * reveal starts; if that second write fails or the request is cancelled, the
 * exact pre-call workspace is restored through the raw pinned-store writers.
 */
export async function commitActiveViewportWorkspace(
  structure: ZatomStructure,
  trajectory: ZatomTrajectory | undefined,
  guard: ActiveViewportStructureCommitGuard = {},
): Promise<void> {
  // Bind at invocation, not when this queued operation eventually starts.
  // Otherwise a user switching panes while an earlier review is open silently
  // retargets the queued write.
  const manager = useViewportManager.getState()
  const targetViewportId = manager.activeViewportId
  const targetApi = manager.getActiveStore()
  const initialStructure = readViewportStructure(targetApi)
  const initialRevision = readWorkspaceRevision(targetApi as never)
  const boundGuard: ActiveViewportStructureCommitGuard = {
    expectedViewportId: guard.expectedViewportId ?? targetViewportId,
    expectedStructureFingerprint: guard.expectedStructureFingerprint
      ?? (initialStructure ? fingerprintStructure(initialStructure) : null),
    expectedRevision: guard.expectedRevision ?? initialRevision,
    ...(guard.authorizedProposalId ? { authorizedProposalId: guard.authorizedProposalId } : {}),
    ...(guard.signal ? { signal: guard.signal } : {}),
    ...(guard.onCommitStart ? { onCommitStart: guard.onCommitStart } : {}),
  }
  throwIfCommitCancelled(boundGuard.signal)
  return enqueueCommit(() => commitActiveViewportStructureNow(
    structure,
    trajectory,
    boundGuard,
    { viewportId: targetViewportId, api: targetApi },
  ), boundGuard.signal)
}

async function commitActiveViewportStructureNow(
  structure: ZatomStructure,
  trajectory: ZatomTrajectory | undefined,
  guard: ActiveViewportStructureCommitGuard,
  target: { viewportId: string; api: ReturnType<typeof getActiveViewportStoreApi> },
): Promise<void> {
  throwIfCommitCancelled(guard.signal)
  await awaitCommitStage(pendingReviewOpen, guard.signal)
  throwIfCommitCancelled(guard.signal)
  await assertAgentMayMutateWorkspace('replace the active structure', {
    authorizedProposalId: guard.authorizedProposalId,
    signal: guard.signal,
  })
  throwIfCommitCancelled(guard.signal)
  // Presentation is non-authoritative, but destructive commits still serialize
  // so each result gets one unambiguous user decision.
  await awaitChoreographyIdle(guard.signal)
  throwIfCommitCancelled(guard.signal)

  const assertSourceIdentity = () => {
    // Parsing and choreography both yield to the user. Re-check manual control
    // at the synchronous pre-write boundary so takeover always wins the race.
    assertAgentMayMutateWorkspaceNow('replace the active structure', {
      authorizedProposalId: guard.authorizedProposalId,
      signal: guard.signal,
    })
    throwIfCommitCancelled(guard.signal)
    const manager = useViewportManager.getState()
    if (viewportIdForStore(target.api) !== target.viewportId) {
      throw new Error(`Viewport ${target.viewportId} was replaced before commit`)
    }
    if (manager.activeViewportId !== target.viewportId) {
      throw new Error(
        `Active viewport changed from ${target.viewportId} to ${manager.activeViewportId} before commit`,
      )
    }
    if (guard.expectedStructureFingerprint !== undefined) {
      const current = readViewportStructure(target.api)
      const actual = current ? fingerprintStructure(current) : null
      if (actual !== guard.expectedStructureFingerprint) {
        throw new Error(
          `Active structure changed before commit; expected ${guard.expectedStructureFingerprint ?? 'empty'}, received ${actual ?? 'empty'}`,
        )
      }
    }
    if (guard.expectedRevision !== undefined) {
      const actualRevision = readWorkspaceRevision(target.api as never)
      if (actualRevision !== guard.expectedRevision) {
        throw new Error(
          `Active workspace revision changed before commit; expected r${guard.expectedRevision}, received r${actualRevision}`,
        )
      }
    }
  }
  assertSourceIdentity()
  // The reveal needs prior and next snapshots. Capture prior before the write,
  // then read next from the store because the writer can remap ids and bonds;
  // only the stored version is the canonical settled state.
  const priorApi = target.api
  const priorState = priorApi.getState()
  const priorStructure = readViewportStructure(priorApi)
  const priorTrajectory = readViewportTrajectory(priorApi)
  const priorAtoms = priorState?.atoms ? [...priorState.atoms] : []
  const priorBonds = priorState?.bonds ? [...priorState.bonds] : []
  // Validate trajectory identity before the first mutation. The writer parses
  // again at its own boundary, but this keeps ordinary schema errors from ever
  // producing a transient structure-only viewport.
  const parsedTrajectory = trajectory
    ? parseZatomTrajectory(trajectory, { structure })
    : undefined
  useAgentOperationReview.getState().beginAnimation({
    label: structure.label ?? 'Agent operation',
    viewportId: target.viewportId,
  })
  try {
    // Record canonical history only after the complete document lands. A
    // failed two-part write must leave neither workspace state nor an undo
    // entry claiming that an operation happened.
    await writeViewportStructure(target.api, target.viewportId, structure, {
      beforeStructureReplace: () => {
        assertSourceIdentity()
        guard.onCommitStart?.()
      },
      recordHistory: false,
    })
    if (parsedTrajectory) {
      throwIfCommitCancelled(guard.signal)
      await writeViewportTrajectory(target.api, target.viewportId, parsedTrajectory, {
        beforeTrajectoryReplace: () => {
          throwIfCommitCancelled(guard.signal)
          assertAgentMayMutateWorkspaceNow('replace the active structure and trajectory', {
            authorizedProposalId: guard.authorizedProposalId,
            signal: guard.signal,
          })
          if (viewportIdForStore(target.api) !== target.viewportId
            || useViewportManager.getState().activeViewportId !== target.viewportId) {
            throw new Error(`Viewport ${target.viewportId} changed during the workspace transaction`)
          }
        },
      })
      // Cancellation wins until both synchronous store replacements have
      // completed. An abort between the two awaits therefore rolls back too.
      throwIfCommitCancelled(guard.signal)
    }
    recordCanonicalWrite(priorStructure, target.api as object, priorTrajectory)
  } catch (error) {
    try {
      const currentStructure = readViewportStructure(target.api)
      const currentStructureFingerprint = currentStructure ? fingerprintStructure(currentStructure) : null
      const priorStructureFingerprint = priorStructure ? fingerprintStructure(priorStructure) : null
      const candidateStructureFingerprint = fingerprintStructure(structure)
      const alreadyRestored = currentStructureFingerprint === priorStructureFingerprint
        && (() => {
          const currentTrajectory = readViewportTrajectory(target.api)
          return (currentTrajectory ? fingerprintTrajectory(currentTrajectory) : null)
            === (priorTrajectory ? fingerprintTrajectory(priorTrajectory) : null)
        })()
      if (!alreadyRestored) {
        // Do not overwrite a newer manual edit that raced the failed host
        // operation. Exact candidate identity is the authority to compensate.
        if (currentStructureFingerprint !== candidateStructureFingerprint) {
          throw new Error('Workspace changed during failed transaction; newer state was kept instead of overwritten.')
        }
        const rollbackSource = readViewportWorkspaceIdentity(target.api)
        const assertRollbackSource = () => {
          const latest = readViewportWorkspaceIdentity(target.api)
          if (latest.viewportId !== rollbackSource.viewportId
            || latest.revision !== rollbackSource.revision
            || latest.structureFingerprint !== rollbackSource.structureFingerprint
            || latest.trajectoryFingerprint !== rollbackSource.trajectoryFingerprint) {
            throw new Error('Workspace changed while transaction rollback was preparing; newer state was kept.')
          }
        }
        if (priorStructure) {
          await writeViewportStructure(target.api, target.viewportId, priorStructure, {
            recordHistory: false,
            beforeStructureReplace: assertRollbackSource,
          })
          if (priorTrajectory) {
            const structureRestoredSource = readViewportWorkspaceIdentity(target.api)
            await writeViewportTrajectory(target.api, target.viewportId, priorTrajectory, {
              beforeTrajectoryReplace: () => {
                const latest = readViewportWorkspaceIdentity(target.api)
                if (latest.viewportId !== structureRestoredSource.viewportId
                  || latest.revision !== structureRestoredSource.revision
                  || latest.structureFingerprint !== structureRestoredSource.structureFingerprint
                  || latest.trajectoryFingerprint !== structureRestoredSource.trajectoryFingerprint) {
                  throw new Error('Workspace changed while trajectory rollback was preparing; newer state was kept.')
                }
              },
            })
          }
          else clearViewportTrajectory(target.api, target.viewportId)
        } else {
          assertRollbackSource()
          clearViewportWorkspace(target.api, target.viewportId)
        }
      }
      const restoredStructure = readViewportStructure(target.api)
      const restoredTrajectory = readViewportTrajectory(target.api)
      if ((restoredStructure ? fingerprintStructure(restoredStructure) : null) !== priorStructureFingerprint
        || (restoredTrajectory ? fingerprintTrajectory(restoredTrajectory) : null)
          !== (priorTrajectory ? fingerprintTrajectory(priorTrajectory) : null)) {
        throw new Error('Workspace transaction rollback did not restore the exact pre-write document.')
      }
    } catch (rollbackError) {
      useAgentOperationReview.getState().clearAnimation()
      throw new Error(
        `Workspace transaction failed (${error instanceof Error ? error.message : String(error)}) and exact rollback failed `
        + `(${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
      )
    }
    useAgentOperationReview.getState().clearAnimation()
    throw error
  }
  const nextState = target.api.getState()
  if (nextState?.atoms?.length) {
    const label = structure.label ? `Applying: ${structure.label}` : 'Applying agent operation…'
    const nextAtoms = [...nextState.atoms]
    // Ask only after the animation so the user first sees what changed and then
    // decides whether it is correct. Otherwise the review card competes with the
    // camera move for attention.
    //
    // Opening the card cannot depend solely on this reveal completing because
    // the choreographer has a single-flight guard. A later reveal is skipped for
    // rapid commits such as supercell followed by surface cutting. In that case,
    // wait for the earlier camera move, then ask; the question still appears and
    // its card describes the final state.
    //
    // A reveal temporarily rolls atoms back to prior, plays the delta, and only
    // then settles on next. That rollback window (starting around 700 ms) is toxic
    // to callers: a candidate tool reads immediately after commit to verify its
    // fingerprint and could otherwise see prior, misreporting a successful write
    // as "applied without verified readback".
    //
    // Therefore next must be readable from the store before this function
    // returns. The write above already guarantees that; the remaining hazard is
    // a reveal rolling it back before the caller reads it. Claim the slot
    // synchronously and defer the reveal by one task so the store remains at next
    // between commit return and the caller's verification read.
    const revealSlot = claimChoreographySlot()
    pendingReviewOpen = (async () => {
      // Yield one task so the candidate tool's synchronous verification read after
      // commit return occurs before the reveal rolls back to prior. The slot was
      // claimed synchronously, so no other reveal can enter in the meantime.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const outcome = await performAppliedResultReveal(
        priorAtoms,
        priorBonds,
        nextAtoms,
        [...nextState.bonds],
        {
          ...(revealSlot ? { claimedSlot: revealSlot } : {}),
          viewportApi: priorApi,
          onCaption: (text) =>
            useChoreographyNarration.getState().setCaption(text ? `${label} · ${text}` : null),
        },
      ).catch(() => {
        useChoreographyNarration.getState().setCaption(null)
        // Release a claimed slot when its owner fails. Otherwise `running` remains
        // true forever and every later reveal is reported as skipped.
        revealSlot?.release()
        return 'played' as const
      })
      if (outcome === 'skipped') await awaitChoreographyIdle()
      // Inspect the settled state rather than the input. The write path can remap
      // ids and recompute bonds, and the report must describe the version visible
      // on screen. Inspection does not block the commit; it gives the user evidence
      // for deciding whether to keep or revert the result.
      const settled = readViewportStructure(target.api)
      const settledTrajectory = readViewportTrajectory(target.api)
      if (!settled) {
        // Clearing the workspace during a camera reveal is a user edit. It
        // cancels this review, pauses the Agent, and must not strand the global
        // control state in `animating` forever.
        useAgentOperationReview.getState().clearAnimation()
        useAgentOperationReview.getState().takeOver(structure.label ?? 'Agent operation')
        return
      }
      const settledFingerprint = fingerprintStructure(settled)
      const intendedFingerprint = fingerprintStructure(structure)
      if (settledFingerprint !== intendedFingerprint) {
        // The user edited during the non-authoritative camera reveal. Their
        // world state wins; do not open a review for a result no longer shown.
        useAgentOperationReview.getState().clearAnimation()
        useAgentOperationReview.getState().takeOver(structure.label ?? 'Agent operation')
        return
      }
      if (viewportIdForStore(target.api) !== target.viewportId) {
        // A layout change detached/replaced the pane while the reveal was
        // running. The saved store remains untouched, but there is no visible
        // target on which an exact review can act. Treat the layout change as
        // user takeover and release the queue instead of opening a hidden card.
        useAgentOperationReview.getState().clearAnimation()
        useAgentOperationReview.getState().takeOver(structure.label ?? 'Agent operation')
        return
      }
      const settledTrajectoryFingerprint = settledTrajectory ? fingerprintTrajectory(settledTrajectory) : null
      const settledRevision = readWorkspaceRevision(target.api as never)
      useAgentOperationReview.getState().openReview({
        label: structure.label ?? 'Agent operation',
        subject: {
          kind: 'structure',
          viewportId: target.viewportId,
          workspaceRevision: settledRevision,
          atomDelta: nextAtoms.length - priorAtoms.length,
          health: settled ? summarizeStructureHealth(auditStructureHealth(settled)) : undefined,
          revert: async () => {
            if (viewportIdForStore(target.api) !== target.viewportId) {
              throw new Error(`The reviewed viewport ${target.viewportId} no longer exists.`)
            }
            const current = readViewportStructure(target.api)
            const currentTrajectory = readViewportTrajectory(target.api)
            const currentFingerprint = current ? fingerprintStructure(current) : null
            const currentTrajectoryFingerprint = currentTrajectory ? fingerprintTrajectory(currentTrajectory) : null
            const currentRevision = readWorkspaceRevision(target.api as never)
            if (currentFingerprint !== settledFingerprint
              || currentTrajectoryFingerprint !== settledTrajectoryFingerprint
              || currentRevision !== settledRevision) {
              throw new Error(
                'The reviewed workspace changed after the Agent operation. '
                + 'It was not reverted, so your newer edits remain intact.',
              )
            }
            useViewportManager.getState().setActive(target.viewportId)
            const assertStillReviewed = () => {
              const latest = readViewportStructure(target.api)
              const latestFingerprint = latest ? fingerprintStructure(latest) : null
              if (latestFingerprint !== settledFingerprint) {
                throw new Error('The workspace changed while rollback was preparing; no overwrite was made.')
              }
            }
            if (priorStructure) {
              await writeViewportStructure(target.api, target.viewportId, priorStructure, {
                recordHistory: false,
                beforeStructureReplace: assertStillReviewed,
              })
              if (priorTrajectory) {
                await writeViewportTrajectory(target.api, target.viewportId, priorTrajectory)
              } else {
                clearViewportTrajectory(target.api, target.viewportId)
              }
            } else {
              assertStillReviewed()
              clearViewportWorkspace(target.api, target.viewportId)
            }
            const restored = readViewportStructure(target.api)
            const restoredFingerprint = restored ? fingerprintStructure(restored) : null
            const expectedPriorFingerprint = priorStructure ? fingerprintStructure(priorStructure) : null
            if (restoredFingerprint !== expectedPriorFingerprint) {
              throw new Error('Rollback readback did not match the exact pre-operation structure.')
            }
          },
        },
      })
    })().catch(() => {
      // A user takeover during the animation intentionally makes openReview
      // fail; clearAnimation is phase-safe and will not erase manual control.
      useAgentOperationReview.getState().clearAnimation()
    }).finally(() => {
      // Every reveal exit must leave the transitional phase. openReview and
      // takeover already replace it; clearAnimation is phase-safe for both.
      useAgentOperationReview.getState().clearAnimation()
    })
  }
}

function frameAuxValues(
  velocity: Vec3 | undefined,
  force: Vec3 | undefined,
): Record<string, AuxValue> | undefined {
  const result: Record<string, AuxValue> = {}
  if (velocity) result.velocityAperPs = { kind: 'vector', value: [...velocity] as Vec3 }
  if (force) result.forceEvPerA = { kind: 'vector', value: [...force] as Vec3 }
  return Object.keys(result).length ? result : undefined
}

export async function writeActiveViewportTrajectory(
  value: ZatomTrajectory,
  expected?: ZatomWorkspaceIdentity,
  signal?: AbortSignal,
  onCommitStart?: () => void,
): Promise<void> {
  throwIfCommitCancelled(signal)
  const manager = useViewportManager.getState()
  const viewportId = manager.activeViewportId
  const api = manager.getActiveStore()
  const control = useAgentOperationReview.getState().control
  // A structure+trajectory candidate writes its trajectory immediately after
  // the structure commit started the non-authoritative reveal. This is one
  // logical transaction, so allow that exact revision-bound continuation;
  // independent trajectory calls still wait for review/manual control.
  const currentBeforeGate = expected ? readViewportWorkspaceIdentity(api) : null
  const sameCandidateContinuation = !!expected
    && control.phase === 'animating'
    && control.operation.viewportId === viewportId
    && currentBeforeGate?.viewportId === expected.viewportId
    && currentBeforeGate.revision === expected.revision
    && currentBeforeGate.structureFingerprint === expected.structureFingerprint
    && currentBeforeGate.trajectoryFingerprint === expected.trajectoryFingerprint
  if (!sameCandidateContinuation) {
    await assertAgentMayMutateWorkspace('replace the active trajectory', { signal })
    throwIfCommitCancelled(signal)
    assertAgentMayMutateWorkspaceNow('replace the active trajectory', { signal })
  }
  throwIfCommitCancelled(signal)
  if (useViewportManager.getState().activeViewportId !== viewportId) {
    throw new Error(`Active viewport changed from ${viewportId} before trajectory write`)
  }
  if (expected) {
    const current = readViewportWorkspaceIdentity(api)
    if (current.viewportId !== expected.viewportId
      || current.revision !== expected.revision
      || current.structureFingerprint !== expected.structureFingerprint
      || current.trajectoryFingerprint !== expected.trajectoryFingerprint) {
      throw new Error('The workspace changed before trajectory write; re-observe and retry.')
    }
  }
  return writeViewportTrajectory(api, viewportId, value, {
    beforeTrajectoryReplace: () => {
      throwIfCommitCancelled(signal)
      if (!sameCandidateContinuation) {
        assertAgentMayMutateWorkspaceNow('replace the active trajectory', { signal })
      }
      onCommitStart?.()
    },
  })
}

export async function writeViewportTrajectory(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  viewportId: string,
  value: ZatomTrajectory,
  options: { beforeTrajectoryReplace?: () => void } = {},
): Promise<void> {
  if (viewportIdForStore(api) !== viewportId) {
    throw new Error(`Viewport ${viewportId} is no longer bound to the trajectory store being written`)
  }
  const active = readViewportStructure(api)
  if (!active) throw new Error('Cannot apply a trajectory without an active structure')
  const trajectory = parseZatomTrajectory(value, { structure: active })
  const elementById = new Map(active.atoms.map((atom) => [atom.id, atom.element]))
  const trajectoryLatticeMode = trajectory.lattice
    ? 'fixed' as const
    : trajectory.frames.every((frame) => frame.lattice !== undefined)
      ? 'per-frame' as const
      : 'none' as const
  const frames: XYZFrame[] = trajectory.frames.map((frame, frameIndex) => {
    const frameLattice = frame.lattice ?? trajectory.lattice
    const latticeVectors = frameLattice?.periodic.every(Boolean) ? {
      a: [...frameLattice.vectors[0]] as Vec3,
      b: [...frameLattice.vectors[1]] as Vec3,
      c: [...frameLattice.vectors[2]] as Vec3,
    } : undefined
    return {
      atoms: trajectory.atomIds.map((id, atomIndex) => ({
        id,
        element: elementById.get(id)!,
        position: [0, 0, 0],
        cartesian: [...frame.positions[atomIndex]] as Vec3,
        ...(frame.velocitiesAperPs || frame.forcesEvPerA ? {
          props: frameAuxValues(frame.velocitiesAperPs?.[atomIndex], frame.forcesEvPerA?.[atomIndex]),
        } : {}),
      })),
      comment: `${trajectory.label ?? 'zatom Agent trajectory'} frame ${frameIndex + 1}, step ${frame.step}`,
      ...(latticeVectors ? { latticeVectors } : {}),
      propSchema: [
        ...(frame.velocitiesAperPs ? [{ name: 'velocityAperPs', kind: 'vector' as const, cols: 3 }] : []),
        ...(frame.forcesEvPerA ? [{ name: 'forceEvPerA', kind: 'vector' as const, cols: 3 }] : []),
      ],
      frameScalars: { step: frame.step, timePs: frame.timePs, ...(frame.scalars ?? {}) },
    }
  })
  const metadata: TrajectoryFrameMetadata[] = trajectory.frames.map((frame, index) => ({
    frame: index + 1,
    step: frame.step,
    ...(frame.scalars?.potentialEnergyEv === undefined ? {} : { energy: frame.scalars.potentialEnergyEv }),
    ...(frame.scalars?.maximumForceEvPerA === undefined ? {} : { max_force: frame.scalars.maximumForceEvPerA }),
    ...(frame.scalars?.pressureBar === undefined ? {} : { pressure: frame.scalars.pressureBar / 1000 }),
    ...(frame.scalars?.temperatureK === undefined ? {} : { temperature: frame.scalars.temperatureK }),
    extra: { timePs: frame.timePs, ...(frame.scalars ?? {}) },
  }))
  // Parsing a large trajectory yields a sizeable cancellation window. This is
  // its exact compare-and-set boundary: after this callback returns, the two
  // synchronous store writes constitute the accepted transaction.
  options.beforeTrajectoryReplace?.()
  api.setState({
    trajectoryFrames: frames,
    trajectoryCurrentFrame: 0,
    trajectoryTotalFrames: frames.length,
    trajectoryPlaying: false,
    trajectoryIntervalId: null,
    trajectoryFormatLabel: trajectory.label ?? 'zatom Agent trajectory',
    trajectoryFormatKind: 'zatom_agent',
    trajectoryCoordinateMode: trajectory.coordinateMode,
    trajectoryLatticeMode,
    trajectoryMetadata: metadata,
    history: [],
    historyIndex: -1,
  })
  api.getState().setTrajectoryFrame(frames.length - 1)
  const sidecar = matchingSidecar(api as object, api.getState().atoms)
  if (sidecar) {
    sidecar.trajectoryResultStructure = parseZatomStructure(structuredClone(active))
    sidecar.trajectoryArtifact = parseZatomTrajectory(structuredClone(trajectory))
  }
}

export function readViewportTrajectory(
  api: ReturnType<typeof getActiveViewportStoreApi>,
): ZatomTrajectory | null {
  const state = api.getState()
  const frames = state.trajectoryFrames
  if (!frames?.length || state.trajectoryFormatKind !== 'zatom_agent'
    || !state.trajectoryCoordinateMode || !state.trajectoryLatticeMode) return null
  const sidecar = state.atoms.length ? matchingSidecar(api as object, state.atoms) : undefined
  return sidecar?.trajectoryArtifact
    ? parseZatomTrajectory(structuredClone(sidecar.trajectoryArtifact))
    : null
}

export function readActiveViewportTrajectory(): ZatomTrajectory | null {
  return readViewportTrajectory(getActiveViewportStoreApi())
}

export function readViewportWorkspaceIdentity(
  api: ReturnType<typeof getActiveViewportStoreApi>,
): ZatomWorkspaceIdentity {
  const viewportId = viewportIdForStore(api)
  if (!viewportId) throw new Error('The viewport store is no longer mounted')
  return readViewportWorkspaceIdentityForId(api, viewportId)
}

/** Read identity for a caller that already bound this store to an exact pane. */
export function readViewportWorkspaceIdentityForId(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  viewportId: string,
): ZatomWorkspaceIdentity {
  const structure = readViewportStructure(api)
  const trajectory = readViewportTrajectory(api)
  return {
    viewportId,
    revision: readWorkspaceRevision(api as never),
    structureFingerprint: structure ? fingerprintStructure(structure) : null,
    trajectoryFingerprint: trajectory ? fingerprintTrajectory(trajectory) : null,
  }
}

export function readActiveViewportWorkspaceIdentity(): ZatomWorkspaceIdentity {
  return readViewportWorkspaceIdentity(getActiveViewportStoreApi())
}

export function clearActiveViewportTrajectory(): void {
  const manager = useViewportManager.getState()
  clearViewportTrajectory(manager.getActiveStore(), manager.activeViewportId)
}

export function clearViewportTrajectory(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  viewportId: string,
): void {
  if (viewportIdForStore(api) !== viewportId) {
    throw new Error(`Viewport ${viewportId} is no longer bound to the trajectory store being cleared`)
  }
  api.getState().clearTrajectory()
  api.setState({ history: [], historyIndex: -1 })
  const sidecar = canonicalStructureSidecars.get(api as object)
  if (sidecar) {
    delete sidecar.trajectoryArtifact
    delete sidecar.trajectoryResultStructure
  }
}

/** Clear the complete canonical structure/trajectory boundary for exact revision restore. */
export function clearActiveViewportWorkspace(): void {
  const manager = useViewportManager.getState()
  clearViewportWorkspace(manager.getActiveStore(), manager.activeViewportId)
}

export function clearViewportWorkspace(
  api: ReturnType<typeof getActiveViewportStoreApi>,
  viewportId: string,
): void {
  if (viewportIdForStore(api) !== viewportId) {
    throw new Error(`Viewport ${viewportId} is no longer bound to the workspace store being cleared`)
  }
  canonicalStructureSidecars.get(api as object)?.analysisUnsubscribe?.()
  canonicalStructureSidecars.delete(api as object)
  useAgentInspectionOverlayStore.getState().clearOverlay(api as object)
  api.getState().clearStructure()
  api.setState({ history: [], historyIndex: -1 })
  useViewportManager.getState().setStructureName(viewportId, null)
}

export const activeViewportWorkspaceRevisionContext: AgentWorkspaceRevisionContext = {
  viewportId: () => useViewportManager.getState().activeViewportId,
  readStructure: readActiveViewportStructure,
  readTrajectory: readActiveViewportTrajectory,
  writeStructure: writeActiveViewportStructure,
  writeTrajectory: writeActiveViewportTrajectory,
  clearTrajectory: clearActiveViewportTrajectory,
  clearWorkspace: clearActiveViewportWorkspace,
}

const inPageViewportHost = createInPageViewportSurface({
  readStructure: (store) => readViewportStructure(store as never),
  readTrajectory: (store) => readViewportTrajectory(store as never),
  readIdentity: (store) => readViewportWorkspaceIdentity(store as never),
  writeStructure: (store, viewportId, structure, options) => writeViewportStructure(
    store as never,
    viewportId,
    structure,
    options,
  ),
  clearWorkspace: (store, viewportId) => clearViewportWorkspace(store as never, viewportId),
  writeTrajectory: (store, viewportId, trajectory, options) => writeViewportTrajectory(
    store as never,
    viewportId,
    trajectory,
    options,
  ),
})

export const activeViewportToolContext: ZatomToolContext = {
  viewport: inPageViewportHost.viewport,
  listAppInstances: inPageViewportHost.listAppInstances,
  assets: inPageAssetsSurface,
  viewerStyle: activeViewportStyleSurface,
  camera: createActiveViewportCameraSurface(readActiveViewportStructure),
  guidance: activeViewportGuidanceSurface,
  proposal: activeViewportProposalSurface,
  history: createActiveViewportHistorySurface({
    readStructure: readActiveViewportStructure,
    readTrajectory: readActiveViewportTrajectory,
    writeStructure: (structure) => writeActiveViewportStructure(structure, { recordHistory: false }),
    writeTrajectory: (trajectory) => writeActiveViewportTrajectory(trajectory),
    clearTrajectory: clearActiveViewportTrajectory,
  }),
  readStructure: readActiveViewportStructure,
  readTrajectory: readActiveViewportTrajectory,
  workspaceIdentity: readActiveViewportWorkspaceIdentity,
  /**
   * Agent structure writes use the gated commit path so takeover, review and
   * incremental reveal have one canonical safety boundary for every web host.
   */
  writeStructure: (structure, expected, signal, onCommitStart) => commitActiveViewportStructure(structure, expected ? {
    expectedViewportId: expected.viewportId,
    expectedStructureFingerprint: expected.structureFingerprint,
    expectedRevision: expected.revision,
    signal,
    ...(onCommitStart ? { onCommitStart } : {}),
  } : { signal, ...(onCommitStart ? { onCommitStart } : {}) }),
  writeWorkspace: (structure, trajectory, expected, signal, onCommitStart) => commitActiveViewportWorkspace(
    structure,
    trajectory,
    expected ? {
      expectedViewportId: expected.viewportId,
      expectedStructureFingerprint: expected.structureFingerprint,
      expectedRevision: expected.revision,
      signal,
      ...(onCommitStart ? { onCommitStart } : {}),
    } : { signal, ...(onCommitStart ? { onCommitStart } : {}) },
  ),
  writeTrajectory: (trajectory, expected, signal, onCommitStart) => writeActiveViewportTrajectory(trajectory, expected, signal, onCommitStart),
  readViewerScene: () => {
    const api = getActiveViewportStoreApi()
    const pose = getViewportPose(api)
    const size = getViewportLogicalSize(api)
    const state = api.getState()
    return {
      pose: pose
        ? { position: pose.position, lookAt: pose.lookAt, up: pose.up ?? [0, 1, 0], ...(pose.zoom !== undefined ? { zoom: pose.zoom } : {}) }
        : null,
      viewportSizePx: size ? [size.width, size.height] : null,
      selectedAtomIds: [...state.selectedAtomIds],
      selectedBondIds: [...state.selectedBondIds],
      selectedFaceIds: [...state.selectedFaceIds],
      selectedEdgeIds: [...state.selectedEdgeIds],
      boxSelectionActive: state.boxSelectModeEnabled,
      hoveredAtomId: state.hoveredAtomId ?? null,
      lastFocus: readLastCameraFocus(api),
    }
  },
  applyViewerSelection: (atomIds) => {
    const api = getActiveViewportStoreApi()
    const state = api.getState()
    const visible = new Set(state.atoms.map((atom) => atom.id))
    const ids = atomIds.filter((id) => visible.has(id))
    // Use the same action as a manual click. `selectAtoms` owns selection state,
    // the information overlay, and manual move/delete/replace actions
    // operate on this exact state after the user takes over.
    state.selectAtoms(ids)
    if (!ids.length) return
    // Match manual navigation with an eased camera flight that frames the
    // selection with margin. A minimum radius avoids crowding a single atom.
    const positions = state.atoms.filter((atom) => ids.includes(atom.id)).map((atom) => atom.position)
    const center: [number, number, number] = [0, 1, 2].map(
      (axis) => positions.reduce((sum, p) => sum + p[axis], 0) / positions.length,
    ) as [number, number, number]
    const radius = Math.max(
      2,
      ...positions.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])),
    )
    state.focusOnPoint(center, radius * 1.5)
  },
  focusInspectionTarget: async (target) => {
    const api = getActiveViewportStoreApi()
    if (target.trajectoryFrameIndex !== undefined) {
      const state = api.getState()
      if (!state.trajectoryFrames || target.trajectoryFrameIndex < 0
        || target.trajectoryFrameIndex >= state.trajectoryFrames.length) {
        throw new Error(`Trajectory frame ${target.trajectoryFrameIndex} is unavailable in the active viewport`)
      }
      state.setTrajectoryFrame(target.trajectoryFrameIndex)
    }
    const state = api.getState()
    const visibleIds = new Set(state.atoms.map((atom) => atom.id))
    const focusedIds = target.atomIds.filter((id) => visibleIds.has(id))
    api.setState({
      focusedAtomIds: new Set(focusedIds),
      massiveSceneVisualFocusAtomIds: new Set<string>(),
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
    })
    const structure = readActiveViewportStructure()
    if (!structure) throw new Error('Cannot bind an inspection overlay without an active structure')
    useAgentInspectionOverlayStore.getState().setOverlay(api as object, {
      target,
    })
    // Inspection evidence needs the complete target radius, not merely its
    // center, inside the capture. Add framing room without changing the target.
    state.focusOnPoint(target.center, target.radius * 1.5)

    // Wait for the deliberate, eased fly-to to settle so a following projection
    // measurement and capture share the final camera. The motion remains
    // user-interruptible; this bound only covers an uninterrupted flight.
    const deadline = Date.now() + 1_600
    while (api.getState().isAnimatingCamera && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    const placement = await measureViewportTarget(target, api)
    if (placement && (!placement.centerVisible || !placement.regionVisible)) {
      useAgentInspectionOverlayStore.getState().clearOverlay(api as object)
      throw new Error('The complete inspection target remained outside the active camera framing after focusing')
    }
    return placement
  },
  captureViewport: async (options) => {
    const api = getActiveViewportStoreApi()
    const shot = await captureViewport(options, api)
    if (!shot) return null
    const comma = shot.dataUrl.indexOf(',')
    return {
      imageBase64: comma >= 0 ? shot.dataUrl.slice(comma + 1) : shot.dataUrl,
      mimeType: shot.mimeType,
      width: shot.width,
      height: shot.height,
    }
  },
}

// ---------------------------------------------------------------------------
// Proposal decisions made by the *user* on the viewport card. They live here
// because Apply must go through the same commit gate as any agent write.
// ---------------------------------------------------------------------------

export type ApplyProposalOutcome =
  | { ok: true; proposal: ProposalSnapshot }
  | { ok: false; reason: 'none_pending' | 'stale_base' | 'manual_control' | 'decision_pending' | 'target_missing' | 'target_hidden' | 'commit_failed'; message: string }

export async function applyPendingProposal(): Promise<ApplyProposalOutcome> {
  const proposal = pendingProposal()
  if (!proposal) return { ok: false, reason: 'none_pending', message: 'No pending proposal.' }
  // Apply is the *user* speaking, but the commit below runs through the agent
  // gate. Translate accordingly: manual control means "I am editing" — a
  // proposal computed before those edits must not land on top of them; and a
  // still-open review card for the previous step is answered by pressing
  // Apply on the next one (you approve what is on screen by building on it).
  const review = useAgentOperationReview.getState()
  if (selectManualControl(review)) {
    return {
      ok: false,
      reason: 'manual_control',
      message: 'You are editing manually. Resume the agent before applying its proposal.',
    }
  }
  if (review.control.phase === 'awaiting_review') {
    return {
      ok: false,
      reason: 'decision_pending',
      message: `Finish reviewing "${review.control.review.label}" before applying another proposal.`,
    }
  }
  const targetApi = proposal.viewportKey as ReturnType<typeof getActiveViewportStoreApi>
  if (viewportIdForStore(targetApi) !== proposal.viewportId) {
    useAgentProposalStore.getState().resolve(proposal.id, 'discarded')
    return {
      ok: false,
      reason: 'target_missing',
      message: `The proposal viewport ${proposal.viewportId} no longer exists; the proposal was discarded.`,
    }
  }
  const currentIdentity = readViewportWorkspaceIdentity(targetApi)
  if (currentIdentity.structureFingerprint !== proposal.baseFingerprint
    || currentIdentity.revision !== proposal.workspaceRevision) {
    useAgentProposalStore.getState().resolve(proposal.id, 'discarded')
    return {
      ok: false,
      reason: 'stale_base',
      message: 'The target viewport changed since this was proposed; the proposal was discarded. Ask the agent to re-observe and propose again.',
    }
  }
  const manager = useViewportManager.getState()
  const visibleIds = manager.freeLayout
    ? [manager.freeLayout.mainViewportId, ...manager.freeLayout.subViewportIds]
    : Array.from({ length: GRID_SPECS[manager.layout].total }, (_, index) => `vp-${index + 1}`)
  if (!visibleIds.includes(proposal.viewportId)) {
    return {
      ok: false,
      reason: 'target_hidden',
      message: `Proposal ${proposal.id} belongs to hidden pane ${proposal.viewportId}. Restore a layout that shows it, inspect the ghost, then apply or discard.`,
    }
  }
  if (manager.activeViewportId !== proposal.viewportId
    || (manager.maximizedViewportId !== null && manager.maximizedViewportId !== proposal.viewportId)) {
    if (manager.maximizedViewportId && manager.maximizedViewportId !== proposal.viewportId) {
      manager.toggleMaximized(proposal.viewportId)
    } else {
      manager.setActive(proposal.viewportId)
    }
    return {
      ok: false,
      reason: 'target_hidden',
      message: `Showing proposal ${proposal.id} in ${proposal.viewportId}. Inspect the ghost, then press Apply again to commit it.`,
    }
  }
  const claimed = useAgentProposalStore.getState().claim(proposal.id)
  if (!claimed) {
    return {
      ok: false,
      reason: 'decision_pending',
      message: `Proposal ${proposal.id} is already being applied or was resolved by another decision.`,
    }
  }
  try {
    await commitActiveViewportStructure(proposal.candidate, {
      expectedViewportId: proposal.viewportId,
      expectedStructureFingerprint: proposal.baseFingerprint,
      expectedRevision: proposal.workspaceRevision,
      authorizedProposalId: proposal.id,
    })
  } catch (error) {
    useAgentProposalStore.getState().release(proposal.id)
    return { ok: false, reason: 'commit_failed', message: error instanceof Error ? error.message : String(error) }
  }
  const resolved = useAgentProposalStore.getState().resolve(proposal.id, 'applied')
  return { ok: true, proposal: toProposalSnapshot(resolved ?? proposal) }
}

export function discardPendingProposal(): void {
  const proposal = pendingProposal()
  if (proposal) useAgentProposalStore.getState().resolve(proposal.id, 'discarded')
}
