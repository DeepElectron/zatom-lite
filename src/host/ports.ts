/**
 * Host injection points — the runtime half of the host contract.
 *
 * Everything here is something the app *calls* but does not own. Required ports
 * fail explicitly when unwired; optional product surfaces are removed by callers.
 *
 * Types here are consumer-driven views: they declare the fields the kit reads,
 * so the host's richer types stay structurally assignable to them.
 */
import type { BiomoleculePresentationArtifactV2 } from '../lib/biomolecule/presentation-contract'
import type { CrystalPresentationArtifactV2 } from '../lib/crystal/presentation-contract'

// ─── Workspace ───────────────────────────────────────────────────────────────

export interface WorkspaceAtomSnapshot {
  element: number
  position: [number, number, number]
  selected: 0 | 1
  /** Stable editor identity and crystal coordinates for lossless presentation Assets. */
  id?: string
  fractionalPosition?: [number, number, number]
  cellIndex?: [number, number, number]
  siteIndex?: number
  magmom?: number
  magmomTheta?: number
  magmomPhi?: number
  /** Composite-structure sublayer membership persisted with the asset. */
  groupId?: string
}

/** Composite-structure layer metadata persisted as part of the asset. */
export interface WorkspaceStructureGroup {
  id: string
  name: string
  visible: boolean
  /**
   * Biomolecular membership by residue identity. Biomolecular atoms mirror bioStructure rather
   * than storing atom.groupId, so membership must persist with the layer. Periodic groups use
   * atom.groupId and omit this field.
   */
  bioResidueKeys?: readonly string[]
}

export interface WorkspaceBondSnapshot {
  from: number
  to: number
  type: 'single' | 'double' | 'triple' | 'aromatic' | 'partial'
  /**
   * Periodic image offset of `to` relative to `from`, in integer display-box
   * translations (same convention as `Bond.latticeOffset`). Dropping it on
   * archive makes a boundary-crossing bond restore as a straight line cutting
   * through the cell interior, so it must round-trip with the frame.
   */
  latticeOffset?: [number, number, number]
}

export interface WorkspaceSimulationSettings {
  stiffness: number
  cutoff: number
  forceField: string
  method: string
}

export type WorkspaceTimelineEventType =
  | 'FUNCTION_RUN_STARTED'
  | 'FUNCTION_TICK'
  | 'FUNCTION_RUN_PAUSED'
  | 'FUNCTION_RUN_STOPPED'
  | 'FUNCTION_SNAPSHOT_MANUAL'

export type WorkspaceRunState = 'idle' | 'running' | 'paused' | 'stopped'

export interface WorkspaceFrameMeta {
  eventType: WorkspaceTimelineEventType
  functionId?: string
  runId?: string
  runState?: WorkspaceRunState
  sourceTaskId?: string
  candidateId?: string
  databaseSource?: string
  formula?: string
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R'
  spaceGroupNumber?: number
}

/**
 * Complete, restorable biomolecular presentation state owned by one Asset.
 *
 * BioStructure is the canonical topology and also carries compatible PDB MODEL
 * coordinate frames. Layer-local style tracks live on BioLayer; the remaining
 * presentation tracks share the single playhead below.
 */
export type WorkspaceBiomoleculePresentationArtifactV2 = BiomoleculePresentationArtifactV2
export type WorkspaceCrystalPresentationArtifactV2 = CrystalPresentationArtifactV2

/** Consumer-owned copy of the frame fields exchanged with a workspace host. */
export interface WorkspaceFrame {
  id: string
  label: string
  createdAt: string
  atoms: WorkspaceAtomSnapshot[]
  /** Exact topology when the producing editor has it; coordinate-only artifacts omit it. */
  bonds?: WorkspaceBondSnapshot[]
  latticeMatrix?: [number, number, number][]
  periodicity?: 'periodic' | 'molecular'
  /** Composite layer tree, omitted for structures without sublayers. */
  structureGroups?: WorkspaceStructureGroup[]
  settings: WorkspaceSimulationSettings
  meta: WorkspaceFrameMeta
  /** Present only for biomolecular presentation Assets. */
  biomoleculePresentation?: WorkspaceBiomoleculePresentationArtifactV2
  /** Present only for ordinary crystal/molecular presentation Assets. */
  crystalPresentation?: WorkspaceCrystalPresentationArtifactV2
  valueKind?: string
  materialization?: 'inline' | 'artifact_ref'
  contentHash?: string
  sizeBytes?: number
  contentType?: string
  uploadedAtIso?: string
  artifactRef?: string
  producedByRunId?: string
  producedAtIso?: string
  producedByNodeId?: string
}

export interface WorkspaceBatch {
  id: string
  name: string
  createdAt: string
  frameIds: string[]
  activeFrameId: string | null
}

export interface WorkspaceLayer {
  id: string
  name: string
  createdAt: string
  assets: Record<string, WorkspaceFrame>
  batches: WorkspaceBatch[]
  activeBatchId: string | null
  frames: WorkspaceFrame[]
  currentIndex: number
}

export interface WorkspaceCollectionStateView {
  activeWorkspaceId: string | null
  workspaces: WorkspaceLayer[]
}

export interface WorkspaceLayersView {
  workspaceState: WorkspaceCollectionStateView
  persistenceError: string | null
  appendFrameToBatch(
    workspaceId: string,
    batchId: string,
    frame: WorkspaceFrame,
    activate?: boolean,
  ): WorkspaceCollectionStateView
  replaceFrameInBatch(
    workspaceId: string,
    batchId: string,
    frameId: string,
    frame: WorkspaceFrame,
  ): WorkspaceCollectionStateView
  createBatch(name?: string): WorkspaceCollectionStateView
  switchBatch(batchId: string): WorkspaceCollectionStateView
  removeBatch(batchId: string): WorkspaceCollectionStateView
  renameBatch(batchId: string, name: string): WorkspaceCollectionStateView
  /**
   * Renames one asset. `WorkspaceFrame.label` was always persisted, but nothing
   * could write it: the label was whatever the producing loader happened to call
   * the structure, so two frames captured from the same template were literally
   * indistinguishable in the Assets list. Naming an asset is what makes it
   * addressable — to the eye here, and to catalog search once saved.
   */
  renameFrame(frameId: string, label: string): WorkspaceCollectionStateView
  removeFramesFromActiveBatch(frameIds: string[]): WorkspaceCollectionStateView
  moveFramesToBatch(frameIds: string[], toBatchId: string): WorkspaceCollectionStateView
}

type WorkspaceLayersHook = () => WorkspaceLayersView

let workspaceLayersHook: WorkspaceLayersHook | null = null

export function setWorkspaceLayersHook(hook: WorkspaceLayersHook | null): void {
  workspaceLayersHook = hook
}

/**
 * Proxy for the host's workspace hook. The host wires it before React renders
 * any kit view, so the branch taken here is stable for a given mount — swapping
 * implementations mid-session would violate the rules of hooks and is not a
 * supported host behaviour.
 */
export function useWorkspaceLayers(): WorkspaceLayersView {
  if (!workspaceLayersHook) throw new Error('Workspace host is not configured')
  return workspaceLayersHook()
}

// ─── Capability manifest (host platform registration) ────────────────────────

/**
 * Shape the host's capability registry expects from `modelerCapabilityManifest`.
 * Consumer-driven: the kit only fills these fields, so the host's richer
 * AppCapabilityManifest stays structurally compatible.
 */
export interface AppCapabilityManifest {
  capabilityId: string
}
