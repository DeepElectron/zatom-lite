/**
 * Host-neutral contracts for tools exposed to an agent or an MCP server.
 *
 * Coordinates in this module are always Cartesian Angstrom.  The explicit
 * schema version and coordinate convention prevent the fractional/cartesian
 * ambiguity that exists in the interactive crystal store.
 */

export const ZATOM_STRUCTURE_SCHEMA = 'zatom.structure/v1' as const
export const ZATOM_TRAJECTORY_SCHEMA = 'zatom.trajectory/v1' as const

export type Vec3 = [number, number, number]
export type Mat3 = [Vec3, Vec3, Vec3]
export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface ZatomStructureAtom {
  /** Stable inside this structure artifact. */
  id: string
  element: string
  /** Cartesian position in Angstrom. */
  position: Vec3
  properties?: Record<string, JsonValue>
}

export type ZatomBondOrder = 1 | 1.5 | 2 | 3

export interface ZatomStructureBond {
  /** Stable inside this structure artifact. */
  id: string
  /** IDs of the two bonded atoms. */
  atomIds: [string, string]
  /** Numeric bond order; 1.5 represents aromatic delocalization. */
  order: ZatomBondOrder
  properties?: Record<string, JsonValue>
}

export interface ZatomLattice {
  /** Row vectors a, b, c in Angstrom. */
  vectors: Mat3
  periodic: [boolean, boolean, boolean]
}

export interface ZatomStructure {
  schemaVersion: typeof ZATOM_STRUCTURE_SCHEMA
  atoms: ZatomStructureAtom[]
  /** Explicit molecular/topological bonds. Omit when topology is unknown. */
  bonds?: ZatomStructureBond[]
  lattice?: ZatomLattice
  label?: string
  metadata?: Record<string, JsonValue>
}

export interface ZatomTrajectoryFrame {
  /** Engine timestep; strictly increasing across the artifact. */
  step: number
  /** Physical elapsed time in picoseconds; strictly increasing after frame zero. */
  timePs: number
  /** Cartesian Angstrom positions aligned exactly to trajectory.atomIds. */
  positions: Vec3[]
  /** Optional Cartesian velocities in Angstrom/picosecond, same atom order. */
  velocitiesAperPs?: Vec3[]
  /** Optional Cartesian forces in eV/Angstrom, same atom order. */
  forcesEvPerA?: Vec3[]
  /** Variable-cell row lattice vectors for this frame; present on every frame or none. */
  lattice?: ZatomLattice
  /** Finite frame-level observables with explicit unit-bearing keys. */
  scalars?: Record<string, number>
}

/** Bounded in-memory coordinate evidence tied to one stable atom ordering. */
export interface ZatomTrajectory {
  schemaVersion: typeof ZATOM_TRAJECTORY_SCHEMA
  atomIds: string[]
  coordinateMode: 'cartesian' | 'unwrapped-cartesian'
  frames: ZatomTrajectoryFrame[]
  /** A fixed lattice shared by every frame. Mutually exclusive with frame lattices. */
  lattice?: ZatomLattice
  label?: string
  metadata?: Record<string, JsonValue>
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped'

export interface ValidationCheck {
  id: string
  status: CheckStatus
  message: string
  metrics?: Record<string, number | string | boolean | null>
  atomIds?: string[]
}

/** A camera/annotation target that lets an agent inspect a numeric finding. */
export interface InspectionTarget {
  id: string
  reason: string
  center: Vec3
  radius: number
  atomIds: string[]
  atomIdsTruncated?: boolean
  /** Optional zero-based frame to seek before focusing/capturing this target. */
  trajectoryFrameIndex?: number
}

/** Screen-space localization measured by the exact viewport camera used for evidence capture. */
export interface ViewportTargetPlacement {
  centerNdc: Vec3
  centerPx: [number, number]
  viewportSizePx: [number, number]
  projectedRadiusPx: number
  centerVisible: boolean
  regionVisible: boolean
}

export interface StructureValidationReport {
  verdict: 'pass' | 'warn' | 'fail'
  checks: ValidationCheck[]
  atomCount: number
  bondCount: number | null
  elementCounts: Record<string, number>
  bounds: { min: Vec3; max: Vec3; center: Vec3; radius: number } | null
  minPairDistanceA: number | null
  closestPair: [string, string] | null
  inspectionTargets: InspectionTarget[]
}

export interface StructureChangeEntry {
  atomId: string
  fromElement: string
  toElement: string
  position: Vec3
}

export interface StructureAddedEntry {
  atomId: string
  element: string
  position: Vec3
}

export interface StructureRemovedEntry {
  atomId: string
  element: string
  position: Vec3
}

export interface StructureMovedEntry {
  atomId: string
  element: string
  fromPosition: Vec3
  toPosition: Vec3
  displacementA: number
}

export interface StructureBondChangedEntry {
  bondId: string
  before: ZatomStructureBond
  after: ZatomStructureBond
}

export interface StructureAtomPropertiesChangedEntry {
  atomId: string
  before?: Record<string, JsonValue>
  after?: Record<string, JsonValue>
}

export interface StructureChangeSet {
  kind: 'create' | 'replace' | 'relabel' | 'mutate'
  sourceAtomCount: number
  resultAtomCount: number
  addedCount?: number
  added?: StructureAddedEntry[]
  addedTruncated?: boolean
  removedCount?: number
  removed?: StructureRemovedEntry[]
  removedTruncated?: boolean
  movedCount?: number
  moved?: StructureMovedEntry[]
  movedTruncated?: boolean
  relabeledCount: number
  relabeled: StructureChangeEntry[]
  relabeledTruncated: boolean
  addedBondCount?: number
  addedBonds?: ZatomStructureBond[]
  addedBondsTruncated?: boolean
  removedBondCount?: number
  removedBonds?: ZatomStructureBond[]
  removedBondsTruncated?: boolean
  changedBondCount?: number
  changedBonds?: StructureBondChangedEntry[]
  changedBondsTruncated?: boolean
  changedAtomPropertiesCount?: number
  changedAtomProperties?: StructureAtomPropertiesChangedEntry[]
  changedAtomPropertiesTruncated?: boolean
  structureMetadataChanged?: boolean
  latticeChanged?: boolean
  /** Substitution-only builders must keep this exactly zero. */
  maxPositionDisplacementA: number
  changedBounds?: { min: Vec3; max: Vec3; center: Vec3; radius: number } | null
}

export interface StructureProvenance {
  engine: string
  engineVersion: string
  sourceFingerprint: string
  /** Present when this result continued from a canonical trajectory frame. */
  sourceTrajectoryFingerprint?: string
  /** Zero-based frame selected by the continuation contract. */
  sourceTrajectoryFrameIndex?: number
  resultFingerprint: string
  trajectoryFingerprint?: string
  /** Present when a provider returned a validated fixed-topology structural ensemble. */
  structureEnsembleFingerprint?: string
  /** Present when a provider returned a validated periodic-cell structural ensemble. */
  periodicStructureEnsembleFingerprint?: string
  /** Present when a provider consumed a broker-validated force-field package. */
  inputForceFieldPackageFingerprint?: string
  /** Present when a provider consumed a broker-validated molecular chemical-state ensemble. */
  inputChemicalStateEnsembleFingerprint?: string
  /** Present when a provider returned a validated canonical force-field package. */
  forceFieldPackageFingerprint?: string
  /** Present when a provider returned a validated molecular chemical-state ensemble. */
  chemicalStateEnsembleFingerprint?: string
  /** Present when a provider returned a validated all-state molecular source-structure catalog. */
  chemicalStateStructureCatalogFingerprint?: string
  /** Present when a provider returned a validated joint chemical-state/structure distribution. */
  chemicalStateStructuralDistributionFingerprint?: string
  /** Present when a provider returned validated, structure-bound microscopic pKa site evidence. */
  microPkaEvidenceFingerprint?: string
  /** Present when a provider returned a validated chemical-microstate transition graph. */
  microstateTransitionGraphFingerprint?: string
  /** Present when a provider returned a validated state-universe coverage assessment. */
  microstateStateCoverageFingerprint?: string
  /** Present when a provider returned validated joint samples of equilibrium state potentials. */
  microstateEquilibriumPotentialEnsembleFingerprint?: string
  /** Present when a provider returned recomputed diagnostics for ordered potential-sample chains. */
  microstatePotentialSampleDiagnosticsFingerprint?: string
  /** Present when a provider returned canonical structure-bound SQS quality evidence. */
  sqsQualityEvidenceFingerprint?: string
  /** Present when a provider returned canonical structure-bound continuum-dislocation evidence. */
  continuumDislocationEvidenceFingerprint?: string
  /** Present when a provider returned canonical fully periodic screw-dipole evidence. */
  periodicDislocationDipoleEvidenceFingerprint?: string
  /** Present when a provider returned canonical source/result-bound fixed-cell relaxation evidence. */
  fixedCellRelaxationEvidenceFingerprint?: string
  seed?: number
  parameters: Record<string, JsonValue>
}

export interface CapturedImage {
  imageBase64: string
  mimeType: string
  width: number
  height: number
}

/**
 * Presentation state of the active viewport that an agent may read and patch.
 * Deliberately the figure-making subset — style preset, hydrogen visibility,
 * isosurface appearance, decorations — not the whole visual-settings record,
 * so the tool schema stays small and every field maps to one store action.
 */
export interface ViewerStyleSnapshot {
  stylePresetId: string
  viewMode: string
  cameraProjection: 'perspective' | 'orthographic'
  hideHydrogens: boolean
  /** Ordinal keep-list text as shown in the panel, e.g. "1-3, 7". */
  keptHydrogens: string
  showAtomRings: boolean
  /** Scalar colour field sampled on the active constructed reference plane. */
  fieldSlice: {
    enabled: boolean
    mode: 'overlay' | 'slice-only'
    opacity: number
    contours: number
  }
  /** Null when no cube / Molden data is loaded. */
  surface: {
    sourceType: 'cub' | 'molden'
    sourceName: string | null
    visible: boolean
    isoValue: number
    resolution: number
    opacity: number
    /** Molden only. */
    selectedOrbitalIndex: number | null
    orbitalCount: number | null
    colorField: {
      sourceName: string | null
      colormap: string
      /** Null = symmetric auto range. */
      range: { min: number; max: number } | null
      showExtrema: boolean
      /** Effective range and extrema after the last render, when available. */
      stats: {
        range: { min: number; max: number }
        sampled: { min: number; max: number }
        extrema: Array<{ kind: 'min' | 'max'; value: number; position: Vec3 }>
      } | null
    } | null
  } | null
  /** Catalogue the agent can choose from. */
  available: {
    stylePresets: Array<{ id: string; label: string }>
    surfaceColormaps: string[]
  }
}

export interface ViewerStylePatch {
  stylePresetId?: string
  cameraProjection?: 'perspective' | 'orthographic'
  hideHydrogens?: boolean
  keptHydrogens?: string
  showAtomRings?: boolean
  fieldSlice?: {
    enabled?: boolean
    mode?: 'overlay' | 'slice-only'
    opacity?: number
    contours?: number
  }
  surface?: {
    visible?: boolean
    isoValue?: number
    resolution?: number
    opacity?: number
    selectedOrbitalIndex?: number
    colormap?: string
    /** Null resets to auto. */
    range?: { min: number; max: number } | null
    showExtrema?: boolean
  }
}

export interface ZatomViewerStyleSurface {
  read: () => ViewerStyleSnapshot | Promise<ViewerStyleSnapshot>
  /** Applies the patch through the same store actions the panel uses; returns the resulting snapshot. */
  apply: (patch: ViewerStylePatch) => ViewerStyleSnapshot | Promise<ViewerStyleSnapshot>
}

// ---------------------------------------------------------------------------
// Camera — "show the user where to look"
// ---------------------------------------------------------------------------

export type StandardView =
  | 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso'
  /** Look down the a / b / c lattice axis (periodic structures only). */
  | 'a' | 'b' | 'c'

export type CameraViewSpec = StandardView | { direction: Vec3 } | { hkl: [number, number, number] }

export type CameraTargetSpec =
  | { atomIds: string[] }
  | { point: Vec3; radius?: number }
  | 'selection'
  | 'all'

export interface CameraLookAtRequest {
  target: CameraTargetSpec
  view?: CameraViewSpec
  durationMs?: number
}

export interface CameraFlightResult {
  center: Vec3
  distance: number
  /** Unit vector from the target towards the camera. */
  direction: Vec3
  atomIds: string[]
  /** True when the user grabbed the camera before the flight landed. */
  interrupted: boolean
}

export interface ZatomCameraSurface {
  lookAt: (request: CameraLookAtRequest, signal?: AbortSignal) => Promise<CameraFlightResult>
  /** Re-orient around the current look-at point without changing it. */
  setView: (view: CameraViewSpec, durationMs?: number, signal?: AbortSignal) => Promise<CameraFlightResult>
}

export interface HistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  /** Number of edits that can be undone / redone from here. */
  undoDepth: number
  redoDepth: number
  /** Fingerprint of the active structure after the step, when one is loaded. */
  structureFingerprint: string | null
}

/** Live compare-and-set identity for the viewport workspace. */
export interface ZatomWorkspaceIdentity {
  viewportId: string
  /** Monotonic for this viewport store; detects A → B → A changes. */
  revision: number
  structureFingerprint: string | null
  trajectoryFingerprint: string | null
}

export interface ZatomHistorySurface {
  read: () => HistorySnapshot
  /** Both throw when nothing is available; they run through the agent mutation gate. */
  undo: () => Promise<HistorySnapshot>
  redo: () => Promise<HistorySnapshot>
}

/** What the user is looking at right now, as read from the live viewport. */
export interface ZatomViewerScene {
  /** Null when no viewport is mounted. `up` is the camera's world up. */
  pose: { position: Vec3; lookAt: Vec3; up: Vec3; zoom?: number } | null
  /** Viewport size in CSS pixels, when a canvas is mounted. */
  viewportSizePx: [number, number] | null
  selectedAtomIds: string[]
  selectedBondIds: string[]
  selectedFaceIds: string[]
  selectedEdgeIds: string[]
  boxSelectionActive: boolean
  hoveredAtomId: string | null
  /** Where the agent last landed the camera (viewer_look_at / viewer_tour). */
  lastFocus: { atomIds: string[]; center: Vec3; at: number } | null
}

// ---------------------------------------------------------------------------
// Guidance — plan / caption / 3D annotations the user sees
// ---------------------------------------------------------------------------

export type GuidanceAnnotationInput =
  | { id?: string; atomIds: string[]; label: string; kind?: 'info' | 'target' | 'warn' }
  | { id?: string; position: Vec3; label: string; kind?: 'info' | 'target' | 'warn' }

/** One numbered option the agent shows the user for disambiguation. */
export type GuidanceCandidateInput = {
  /** Exact periodic images of the anchor atoms, used for viewport leader lines. */
  anchorPositions?: Vec3[]
  label: string
  /** Free-form hint such as "1.83 Å from CO" that the user sees under the number. */
  detail?: string
} & (
  | {
    atomIds: string[]
    /** Exact site/region center; required for periodic-image bridge/hollow sites. */
    position?: Vec3
  }
  | {
    /** A point candidate need not pretend that an atom exists at the target. */
    atomIds?: string[]
    position: Vec3
  }
)

export type GuidanceCandidateDecision =
  | { status: 'pending'; index: null; at: null }
  | { status: 'confirmed'; index: number; at: number }
  | { status: 'cancelled' | 'stale'; index: null; at: number }

export interface GuidanceCandidateStatus {
  candidateSetId: string
  status: GuidanceCandidateDecision['status']
  focusedIndex: number | null
  choice: { index: number; atomIds: string[]; position: Vec3; label: string; detail: string | null } | null
  decidedAt: number | null
  /** True only when waitMs elapsed and the choice is still pending. */
  timedOut: boolean
}

export interface GuidanceCandidateSet {
  id: string
  /** What the choice is about, e.g. "Which hollow site?" */
  label: string
  items: Array<{ index: number; atomIds: string[]; position: Vec3; anchorPositions?: Vec3[]; label: string; detail: string | null }>
  focusedIndex: number | null
  /** A focus is only a preview. Confirm/Cancel is the user's explicit answer. */
  decision: GuidanceCandidateDecision
}

export interface GuidanceSnapshot {
  plan: { steps: Array<{ label: string; status: 'pending' | 'active' | 'done' }>; caption: string | null } | null
  annotations: Array<{ id: string; position: Vec3; label: string; kind: 'info' | 'target' | 'warn' }>
  candidates: GuidanceCandidateSet | null
}

export type GuidanceClearScope = 'all' | 'plan' | 'annotations' | 'candidates' | 'caption'

export interface ZatomGuidanceSurface {
  read: () => GuidanceSnapshot | Promise<GuidanceSnapshot>
  setPlan: (steps: string[], activeIndex: number, caption: string | null) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  advance: (activeIndex: number, caption?: string | null) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  setCaption: (caption: string | null) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  annotate: (annotations: GuidanceAnnotationInput[], replace: boolean) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  /** Replace the candidate set shown as numbered badges. */
  presentCandidates: (label: string, items: GuidanceCandidateInput[]) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  focusCandidate: (index: number | null) => GuidanceSnapshot | Promise<GuidanceSnapshot>
  /** Read immediately, or wait briefly for the user's Confirm/Cancel answer. */
  candidateStatus: (
    candidateSetId: string,
    waitMs?: number,
    signal?: AbortSignal,
  ) => GuidanceCandidateStatus | Promise<GuidanceCandidateStatus>
  clear: (scope?: GuidanceClearScope) => GuidanceSnapshot | Promise<GuidanceSnapshot>
}

// ---------------------------------------------------------------------------
// Proposal — preview a structure change as ghosts before the user approves
// ---------------------------------------------------------------------------

export type ProposalStatus = 'pending' | 'applying' | 'applied' | 'discarded' | 'superseded'

export interface ProposalDiff {
  added: StructureAddedEntry[]
  removed: StructureRemovedEntry[]
  moved: StructureMovedEntry[]
  addedCount: number
  removedCount: number
  movedCount: number
  summary: string
  bounds: { center: Vec3; radius: number } | null
}

export interface ProposalSnapshot {
  id: string
  intent: string
  status: ProposalStatus
  diff: ProposalDiff
  /** Exact viewport/store generation this proposal belongs to. */
  viewportId: string
  /** Monotonic base revision; prevents same-fingerprint ABA application. */
  workspaceRevision: number
  /** Fingerprint of the structure the proposal was computed against. */
  baseFingerprint: string | null
  /** Fingerprint of the exact ghost candidate currently visible to the user. */
  candidateFingerprint: string
  /** Monotonic ghost generation. Starts at 1 and increments on every in-place refinement. */
  previewRevision: number
  /** Scientific checks attached to the exact candidate the user is seeing. */
  checks?: ValidationCheck[]
  /** Changed/unsafe regions the Agent can focus while explaining the preview. */
  inspectionTargets?: InspectionTarget[]
  /** False when diff detail was truncated even though aggregate counts remain exact. */
  previewComplete?: boolean
}

export interface ProposalCandidateSnapshot {
  proposal: ProposalSnapshot
  /** Trusted host-only payload used to compute the next relative refinement. */
  candidate: ZatomStructure
}

export interface ProposalPreviewGuard {
  id: string
  expectedPreviewRevision: number
  expectedCandidateFingerprint: string
  signal?: AbortSignal
}

export interface ZatomProposalSurface {
  /** Publish the single pending proposal; an unresolved decision must be finished or cancelled first. */
  propose: (input: {
    intent: string
    baseFingerprint: string | null
    viewportId: string
    workspaceRevision: number
    candidate: ZatomStructure
    changeSet: StructureChangeSet
    checks?: ValidationCheck[]
    inspectionTargets?: InspectionTarget[]
    signal?: AbortSignal
  }) => ProposalSnapshot | Promise<ProposalSnapshot>
  /** Read the exact pending ghost. Both guards are required so relative edits cannot double-apply. */
  readCandidate: (
    input: ProposalPreviewGuard,
  ) => ProposalCandidateSnapshot | Promise<ProposalCandidateSnapshot>
  /** Atomically replace the pending ghost while preserving its id and active-workspace baseline. */
  revise: (input: ProposalPreviewGuard & {
    intent: string
    candidate: ZatomStructure
    changeSet: StructureChangeSet
    checks?: ValidationCheck[]
    inspectionTargets?: InspectionTarget[]
  }) => ProposalSnapshot | Promise<ProposalSnapshot>
  status: (id: string, signal?: AbortSignal) => ProposalSnapshot | null | Promise<ProposalSnapshot | null>
  /** Agent-side withdrawal (user Discard goes through the store directly). */
  withdraw: (id: string, signal?: AbortSignal) => ProposalSnapshot | null | Promise<ProposalSnapshot | null>
}

export interface ZatomToolManifest {
  name: string
  title: string
  version: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  effects: {
    structure: 'none' | 'read' | 'create' | 'replace'
    workspace: 'none' | 'read' | 'write'
    visual: 'none' | 'read' | 'write'
  }
  tags: string[]
}

export interface ZatomToolResult<T = unknown> {
  ok: boolean
  tool: string
  summary: string
  data?: T
  error?: { code: string; message: string; details?: JsonValue }
  checks?: ValidationCheck[]
}

/**
 * The browser application supplies these functions. Tests may provide a small
 * in-memory implementation for contract verification.
 */
/** One slot of the app's viewport grid. */
export interface ZatomViewportSlotView {
  slotId: string
  slotIndex: number
  kind: string
  label: string | null
  structureLabel: string | null
  atomCount: number | null
  active: boolean
  structureFingerprint?: string | null
  trajectoryFingerprint?: string | null
  workspaceRevision?: number | null
}

export interface ZatomViewportView {
  instanceId: string
  layout: string
  availableLayouts: string[]
  slots: ZatomViewportSlotView[]
  agentControl?: {
    phase: 'idle' | 'animating' | 'awaiting-review' | 'user-takeover'
    label: string | null
    pendingOperations: number
    queuedOperations: number
  }
  /**
   * Present when the user rejected the agent's last structure operation on the
   * review card and reverted it. The agent calls viewport_describe every round,
   * so this is the natural delivery point. Cleared once read.
   *
   * `intent` is what the user wants to happen next, and the three cases call for
   * completely different behaviour. Without it the agent can only guess, and the
   * most common guess — resubmitting the same operation — is exactly what the
   * user just rejected:
   *
   * - `user_took_over`    stop editing; wait until they hand control back.
   * - `retry_differently` they still want you to do it, but not that way.
   * - `replan_from_edits` they changed the structure by hand; re-read it and
   *                       re-plan, since the original plan may be void.
   * - `preview_only`      they only wanted to see it, not keep it. Nothing is
   *                       wrong with the plan — carry on with it.
   */
  userTakeover?: {
    revertedLabel: string
    intent: 'user_took_over' | 'retry_differently' | 'replan_from_edits' | 'preview_only'
    at: number
  }
}

export interface ZatomMountRequestStructure {
  label: string
  atomCount?: number
  /** Frame id of an already-saved workspace asset. */
  frameId?: string
  /** Inline structure text, paired with `format`. */
  text?: string
  format?: string
}

export interface ZatomMountTargetExpectation {
  slotId: string
  structureFingerprint: string | null
  trajectoryFingerprint: string | null
  workspaceRevision: number
}

/**
 * Viewport layout and mounting. Distinct from the single-structure
 * focus/capture hooks above: these address the grid itself.
 */
/**
 * Each method takes the target instance, because a host may bridge several
 * windows and a write must address one explicitly rather than landing on
 * whichever page answered last. Omit it only when a single instance is
 * connected; the host resolves the sole target then, and fails closed when the
 * choice would be ambiguous.
 */
export interface ZatomViewportSurface {
  describe: (instanceId?: string) => ZatomViewportView | Promise<ZatomViewportView>
  /**
   * Make one visible crystal pane the active workspace. The source id is
   * required so a delayed Agent call cannot switch away from a pane the user
   * selected after the Agent last described the grid.
   */
  activate: (
    slotId: string,
    options: { instanceId?: string; expectedActiveViewportId: string; signal?: AbortSignal },
  ) => ZatomViewportView | Promise<ZatomViewportView>
  setLayout: (layout: string, instanceId?: string, signal?: AbortSignal) => ZatomViewportView | Promise<ZatomViewportView>
  /**
   * Empty one visible crystal pane without removing the pane from its layout.
   * The exact target identity is mandatory so a delayed clear cannot erase a
   * structure the user mounted after the Agent last described the grid.
   */
  clear: (
    slotId: string,
    options: {
      instanceId?: string
      expectedTarget: ZatomMountTargetExpectation
      signal?: AbortSignal
    },
  ) => ZatomViewportView | Promise<ZatomViewportView>
  mount: (
    structures: ZatomMountRequestStructure[],
    options: {
      layout?: string
      instanceId?: string
      /** Default true: fill empty/new panes without replacing the user's main structure. */
      preserveExisting?: boolean
      /** Exact slots from the confirmed mount plan. */
      targetSlotIds?: string[]
      /** Exact plan-time target identities; checked again at the surface CAS boundary. */
      expectedTargets?: ZatomMountTargetExpectation[]
      signal?: AbortSignal
    },
  ) => ZatomViewportView | Promise<ZatomViewportView>
}

export interface ZatomAssetBatchView {
  id: string
  name: string
  frameIds: string[]
  activeFrameId: string | null
  active: boolean
}

/**
 * Batch organization for saved structures.
 *
 * Every method takes the same trailing `instanceId` as the viewport surface,
 * because each bridged window owns its own workspace: without it a batch call
 * lands on whichever page answered last. Omit it only when a single instance is
 * connected; the host fails closed when the choice would be ambiguous.
 */
export interface ZatomAssetsSurface {
  listBatches: (instanceId?: string) => ZatomAssetBatchView[] | Promise<ZatomAssetBatchView[]>
  createBatch: (name?: string, instanceId?: string) => ZatomAssetBatchView[] | Promise<ZatomAssetBatchView[]>
  renameBatch: (batchId: string, name: string, instanceId?: string) => ZatomAssetBatchView[] | Promise<ZatomAssetBatchView[]>
  moveFrames: (frameIds: string[], toBatchId: string, instanceId?: string) => ZatomAssetBatchView[] | Promise<ZatomAssetBatchView[]>
}

export interface ZatomAppInstanceView {
  instanceId: string
  label: string | null
  layout: string
  occupiedSlots: number
  totalSlots: number
  current: boolean
  /** URL that opens another instance of the app. */
  openUrl: string | null
}

/**
 * Per-connection tool-domain enablement, supplied by the MCP server. Passed
 * through the context rather than held in a module singleton because the
 * development bridge transport builds a server per request and several can overlap.
 */
export interface ZatomToolDomainController {
  enabledDomains: () => readonly string[]
  enableDomains: (domains: readonly string[]) => void
}

/** Where an Agent call entered the browser application. */
export type ZatomAgentHost = 'webmcp' | 'cli-bridge'

/** Ceiling on the tool tier axis (read < compute < mutate); see host-access-policy.ts. */
export type ZatomHostWriteMode = 'read-only' | 'propose-only' | 'read-write'

export interface ZatomHostAccess {
  host: ZatomAgentHost
  /**
   * Current mode for this host, read per call so a panel change applies
   * immediately. Receives the tool input so a multi-page host can ask the same
   * page the tool is about to address. May throw when the page cannot answer;
   * the registry then refuses the call and reports the reason.
   */
  mode: (input: Record<string, unknown>) => ZatomHostWriteMode | Promise<ZatomHostWriteMode>
}

export interface ZatomToolContext {
  /** Domain discovery and expansion for this connection. */
  domains?: ZatomToolDomainController
  /**
   * Which host the call arrived through and how much it may change. The
   * registry refuses tools above the host's write mode before running them.
   * Tests may omit this policy and exercise the underlying tool contract directly.
   */
  access?: ZatomHostAccess
  /** Grid layout and mounting, when the host exposes a viewport. */
  viewport?: ZatomViewportSurface
  /** Batch organization, when the host exposes a workspace. */
  assets?: ZatomAssetsSurface
  /** Connected app instances, when the host bridges more than one. */
  listAppInstances?: () => ZatomAppInstanceView[] | Promise<ZatomAppInstanceView[]>
  /** Registry-owned current tool catalog. Callers cannot override this during registry execution. */
  listTools?: () => ZatomToolManifest[]
  readStructure?: () => ZatomStructure | null | Promise<ZatomStructure | null>
  readTrajectory?: () => ZatomTrajectory | null | Promise<ZatomTrajectory | null>
  /** Exact live target identity used by WebMCP and renderer write guards. */
  workspaceIdentity?: () => ZatomWorkspaceIdentity | Promise<ZatomWorkspaceIdentity>
  /** Caller-supplied identity from the observation that motivated this call. */
  expectedWorkspace?: ZatomWorkspaceIdentity
  /** Viewport bridge hook: bind one request to its explicit observed identity. */
  bindExpectedWorkspace?: (expected: ZatomWorkspaceIdentity) => void | Promise<void>
  writeStructure?: (
    structure: ZatomStructure,
    expected?: ZatomWorkspaceIdentity,
    signal?: AbortSignal,
    onCommitStart?: () => void,
  ) => void | Promise<void>
  writeTrajectory?: (
    trajectory: ZatomTrajectory,
    expected?: ZatomWorkspaceIdentity,
    signal?: AbortSignal,
    onCommitStart?: () => void,
  ) => void | Promise<void>
  /**
   * Atomically replace the complete structure + trajectory workspace.
   *
   * A host implementing this method guarantees that either both artifacts
   * become visible, or the exact pre-call structure/trajectory pair is
   * restored before rejection.  Candidate tools use this boundary whenever a
   * result carries trajectory frames; two independent writes can otherwise
   * strand the new structure when the trajectory write fails or is cancelled.
   */
  writeWorkspace?: (
    structure: ZatomStructure,
    trajectory: ZatomTrajectory,
    expected?: ZatomWorkspaceIdentity,
    signal?: AbortSignal,
    onCommitStart?: () => void,
  ) => void | Promise<void>
  focusInspectionTarget?: (
    target: InspectionTarget,
  ) => ViewportTargetPlacement | null | Promise<ViewportTargetPlacement | null>
  /**
   * Make atoms the viewport's REAL selection — the same state manual clicking
   * sets — and fly the camera to it. Distinct from focusInspectionTarget,
   * which only paints a view-only focus overlay: a real selection is what the
   * user takes over from (move/delete/replace act on it immediately), so an
   * agent that "picked these adsorption anchors" hands them to the user
   * ready to manipulate, exactly like a manual selection.
   */
  applyViewerSelection?: (atomIds: string[]) => void | Promise<void>
  captureViewport?: (options?: { maxDim?: number; format?: 'jpeg' | 'png' }) => CapturedImage | null | Promise<CapturedImage | null>
  /** Presentation read/patch for the active viewport. */
  viewerStyle?: ZatomViewerStyleSurface
  /** Camera flights for guiding the user's attention. */
  camera?: ZatomCameraSurface
  /** Plan, caption, and 3D annotations shown to the user. */
  guidance?: ZatomGuidanceSurface
  /** Ghost-previewed structure proposals awaiting user approval. */
  proposal?: ZatomProposalSurface
  /** Undo/redo over the workspace's edit history. */
  history?: ZatomHistorySurface
  /**
   * Live viewer observation: the user's camera pose, selection, hover and the
   * Agent's last camera landing. The pose is null when no viewport is mounted.
   */
  readViewerScene?: (signal?: AbortSignal) => ZatomViewerScene | null | Promise<ZatomViewerScene | null>
  /** Optional caller-owned cancellation signal for the active tool call. */
  signal?: AbortSignal
}

export interface ZatomToolDefinition<T = unknown> {
  manifest: ZatomToolManifest
  execute: (input: Record<string, unknown>, context: ZatomToolContext) => Promise<ZatomToolResult<T>>
}

/** JSON Schema fragment shared by MCP tool manifests. */
export const ZATOM_STRUCTURE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'atoms'],
  properties: {
    schemaVersion: { const: ZATOM_STRUCTURE_SCHEMA },
    label: { type: 'string' },
    atoms: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'element', 'position'],
        properties: {
          id: { type: 'string' },
          element: { type: 'string' },
          position: {
            type: 'array',
            minItems: 3,
            maxItems: 3,
            items: { type: 'number' },
            description: 'Cartesian coordinates in Angstrom',
          },
          properties: { type: 'object' },
        },
      },
    },
    bonds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'atomIds', 'order'],
        properties: {
          id: { type: 'string' },
          atomIds: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: { type: 'string' },
          },
          order: { enum: [1, 1.5, 2, 3] },
          properties: { type: 'object' },
        },
      },
    },
    lattice: {
      type: 'object',
      additionalProperties: false,
      required: ['vectors', 'periodic'],
      properties: {
        vectors: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          description: 'Row lattice vectors a, b, c in Angstrom',
        },
        periodic: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'boolean' },
        },
      },
    },
    metadata: { type: 'object' },
  },
}

/** JSON Schema fragment for bounded dynamic evidence returned by providers. */
export const ZATOM_TRAJECTORY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'atomIds', 'coordinateMode', 'frames'],
  properties: {
    schemaVersion: { const: ZATOM_TRAJECTORY_SCHEMA },
    atomIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } },
    coordinateMode: { enum: ['cartesian', 'unwrapped-cartesian'] },
    frames: {
      type: 'array',
      minItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'timePs', 'positions'],
        properties: {
          step: { type: 'integer', minimum: 0 },
          timePs: { type: 'number', minimum: 0 },
          positions: {
            type: 'array',
            items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
            description: 'Cartesian coordinates in Angstrom aligned to atomIds',
          },
          velocitiesAperPs: {
            type: 'array',
            items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          },
          forcesEvPerA: {
            type: 'array',
            items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          },
          lattice: {
            type: 'object',
            additionalProperties: false,
            required: ['vectors', 'periodic'],
            properties: {
              vectors: {
                type: 'array',
                minItems: 3,
                maxItems: 3,
                items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
                description: 'Variable row lattice vectors a, b, c in Angstrom for this frame',
              },
              periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
            },
          },
          scalars: { type: 'object', additionalProperties: { type: 'number' } },
        },
      },
    },
    lattice: {
      type: 'object',
      additionalProperties: false,
      required: ['vectors', 'periodic'],
      properties: {
        vectors: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          description: 'Fixed row lattice vectors a, b, c in Angstrom',
        },
        periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
      },
    },
    label: { type: 'string' },
    metadata: { type: 'object' },
  },
}
