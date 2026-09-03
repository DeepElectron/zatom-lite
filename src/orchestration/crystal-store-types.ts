/**
 * Local data shapes used by the crystal store.
 *
 * These internal interfaces cover four groups:
 *   - Camera/process: CameraTarget
 *   - Measurement: MeasurementMode / Measurement / MeasurementEdit
 *   - Filter/history: ElementFilter / HistoryState / AssemblyHistoryState
 *   - Assembly + selection: BuilderMode / BuildingBlock / SceneObject / AssemblyScene
 *     / AssemblyTransformMode / SelectionRegionPreview / PlacementStep / PlacementState
 */

import type {
  Atom,
  Bond,
  ConstructedPlane,
  CrystalSystem,
  FaceSelectMethod,
  LatticeParameters,
  LatticeVectors,
  SelectMode,
  SupercellParams,
  ToolMode,
  ViewMode,
} from '../lib/crystal/types'

// Re-export common types so slices can import them from one module.
export type {
  Atom,
  Bond,
  ConstructedPlane,
  CrystalSystem,
  FaceSelectMethod,
  LatticeParameters,
  LatticeVectors,
  SelectMode,
  SupercellParams,
  ToolMode,
  ViewMode,
}
import type { XYZFrame } from '../lib/crystal/xyz-parser'
import type { BiomoleculePresentationArtifactV2 } from '../lib/biomolecule/presentation-contract'

export interface CameraTarget {
  position: [number, number, number]
  lookAt: [number, number, number]
  preserveViewDirection?: boolean
  /** Perspective dolly distance for a focus request. */
  distance?: number
  /** Full world-space span to fit in an orthographic viewport. */
  framingSpan?: number
  /** Conservative distance that keeps an orthographic camera outside the complete scene. */
  sceneClearance?: number
  /** Largest rendered primitive radius, used for view-direction perspective clearance. */
  scenePadding?: number
  /** Exact orthographic magnification for a pose/reset request. */
  zoom?: number
  /** Forces the viewing direction implied by position even in orthographic mode,
   *  for explicitly oriented views such as axis views. By default, orthographic
   *  mode preserves direction and only recenters and zooms (see camera-controller). */
  forceOrientation?: boolean
  /**
   * Suggested duration for this camera flight in milliseconds. camera-controller
   * uses 1200 ms when omitted.
   *
   * Drill-down scales duration by visual span: moving from an assembly to one
   * residue covers far more distance than moving between adjacent residues.
   * Reduced-motion settings take precedence and reduce this to zero.
   */
  durationMs?: number
}

// Bond tool submodes:
//   select   Select an existing bond for deletion or bond-order changes.
//   create   Create a real covalent bond with two clicks.
//   link     Add an annotation link with two clicks without changing chemical topology.
//   contacts Show automatic contact analysis such as hydrogen bonds and salt bridges.
//
// These modes share one axis because they all operate on bonds, differing only in
// read/write semantics. The Bond button is the single entry point, and its submode
// determines the meaning of a click.
export type BondToolSubmode = 'select' | 'create' | 'link' | 'contacts'

/** A manual link annotation. This view state does not modify bonds or enter undo history. */
export interface BondAnnotation {
  id: string
  atomId1: string
  atomId2: string
  kind: 'custom' | 'hydrogen-bond' | 'salt-bridge'
}

// Measurement types
export type MeasurementMode = 'none' | 'distance' | 'angle' | 'dihedral'

export interface Measurement {
  id: string
  type: 'distance' | 'angle' | 'dihedral'
  atomIds: string[]
  value: number  // Distance in Angstroms or angle in degrees
}

// Measurement editing state
export interface MeasurementEdit {
  measurementId: string
  fixedAtomIndices: number[]  // Indices of atoms to keep fixed (0-based)
  targetValue: number
  originalValue: number  // Original measurement value for cancel
  originalPositions: { atomId: string; position: [number, number, number] }[]
}

// Element filter
export interface ElementFilter {
  elements: Set<string>  // Elements to show (empty = show all)
  showFiltered: boolean   // If false, hide filtered atoms; if true, dim them
}

export interface BondSettings {
  defaultRadius: number
  elementPairRadii: Record<string, number>
  /** If true, pairs absent from elementPairRadii are never auto-bonded. */
  restrictToConfiguredPairs: boolean
  /**
   * Extra tolerance in Å beyond the sum of covalent radii. The automatic criterion
   * is r1 + r2 + tolerance; this is its only empirical parameter.
   */
  tolerance: number
  /**
   * Whether to search for bonds across cell boundaries. This applies only when the
   * store is periodic; disabling it limits the search to the current cell.
   */
  periodicBonds: boolean
}

// History state for undo functionality
export interface HistoryState {
  atoms: Atom[]
  bonds: Bond[]
  measurements: Measurement[]
  crystalSystem: CrystalSystem
  latticeParams: LatticeParameters
  latticeVectors: LatticeVectors
  unitCellAtoms: Atom[]
  userDeletedPositions: Set<string>
  userAddedAtomIds: Set<string>
  supercellParams: SupercellParams
  bondSettings: BondSettings
  /**
   * Biomolecular editing is one document transaction, not just an Atom[] edit.
   * Keep the full scientific/presentation artifact with the active MODEL frame
   * so Undo cannot restore coordinates into the wrong conformer or orphan the
   * residue/layer metadata after a topology edit.
   */
  biomoleculePresentation: BiomoleculePresentationArtifactV2 | null
  trajectoryCurrentFrame: number
  /** Coordinates are mirrored here for canonical trajectory playback. */
  trajectoryFrames: XYZFrame[] | null
  /** Composite structure layers; undo/redo keeps them aligned with atom snapshots. */
  structureGroups: StructureGroup[]
  activeGroupId: string | null
}

// Assembly undo/redo history.
export interface AssemblyHistoryState {
  sceneObjects: SceneObject[]
  buildingBlocks: BuildingBlock[]
  assemblyScenes: AssemblyScene[]
}

export type BuilderMode = 'structure' | 'assembly'

// Assembly mode types - for scene building with pre-built structures
export interface BuildingBlock {
  id: string
  name: string
  type: 'crystal' | 'molecule'
  atoms: Atom[]
  bonds: Bond[]
  createdAt: number
  // Crystal-specific data (preserved for lattice display)
  latticeVectors?: LatticeVectors
  showLattice?: boolean
  /** Supercell parameters at save time, used as defaults when creating a SceneObject. */
  defaultSupercell?: { a: number; b: number; c: number }
}

export interface SceneObject {
  id: string
  blockId: string  // Reference to building block
  position: [number, number, number]
  rotation: [number, number, number]  // Euler angles in radians
  supercell: { a: number; b: number; c: number }  // Supercell expansion for crystals
}

/** A named assembly scene containing multiple positioned objects */
export interface AssemblyScene {
  id: string
  name: string
  objects: SceneObject[]
  createdAt: number
}

export type AssemblyTransformMode = 'select' | 'translate' | 'rotate'

// Selection region preview for visualization
export type SelectionRegionPreview =
  | { type: 'sphere'; center: [number, number, number]; radius: number }
  | { type: 'shell'; center: [number, number, number]; innerRadius: number; outerRadius: number }
  | { type: 'cylinder'; center: [number, number, number]; radius: number; height: number; axis: 'x' | 'y' | 'z' }
  | { type: 'box'; center: [number, number, number]; size: [number, number, number] }

// Placement workflow for adding new objects
export type PlacementStep = 'idle' | 'position-xy' | 'position-z' | 'confirm'

export interface PlacementState {
  step: PlacementStep
  blockId: string | null
  position: [number, number, number]
  rotation: [number, number, number]  // Euler angles for preview rotation
  useOrthographic: boolean  // Toggle orthographic camera during placement
  minDistance: number  // Minimum distance to nearest existing atom in Angstroms (-1 if no objects)
}

// CrystalStore intersects the slice interfaces declared in ./slices/*.ts for use
// by StateCreator and UI callers.
//
// To add a slice: export its interface from ./slices, add it to this intersection,
// then spread its implementation in crystalStore.ts.
import type { AssemblySlice } from './slices/assembly-slice'
import type { AtomAttributesSlice } from './slices/atom-attributes-slice'
import type { PorositySlice } from './slices/porosity-slice'
import type { TrajectoryAuxSlice } from './slices/trajectory-aux-slice'
import type { AtomBondCrudSlice } from './slices/atom-bond-crud-slice'
import type { AtomClipboardSlice } from './slices/atom-clipboard-slice'
import type { BondSlice } from './slices/bond-slice'
import type { BoxSelectionSlice } from './slices/box-selection-slice'
import type { BrillouinZoneSlice } from './slices/brillouin-zone-slice'
import type { CameraFocusSlice } from './slices/camera-focus-slice'
import type { CellManagementSlice } from './slices/cell-management-slice'
import type { ElementFilterSlice } from './slices/element-filter-slice'
import type { HistorySlice } from './slices/history-slice'
import type { LatticeSupercellSlice } from './slices/lattice-supercell-slice'
import type { LoadersSlice } from './slices/loaders-slice'
import type { MeasurementSlice } from './slices/measurement-slice'
import type { ModeSlice } from './slices/mode-slice'
import type { MolecularOrbitalSlice } from './slices/molecular-orbital-slice'
import type { PlaneConstructionSlice } from './slices/plane-construction-slice'
import type { AdsorbateSlice } from './slices/adsorbate-slice'
import type { RdfSlice } from './slices/rdf-slice'
import type { XrdSlice } from './slices/xrd-slice'
import type { EdiffSlice } from './slices/ediff-slice'
import type { SelectionSlice } from './slices/selection-slice'
import type { SymmetryOverlaySlice } from './slices/symmetry-overlay-slice'
import type { SelectionTransformSlice } from './slices/selection-transform-slice'
import type { StructureProcessingSlice } from './slices/structure-processing-slice'
import type { TrajectorySlice } from './slices/trajectory-slice'
import type { LightingSlice } from './slices/lighting-slice'
import type { ViewSettingsSlice } from './slices/view-settings-slice'
import type { ViewportControlsSlice } from './slices/viewport-controls-slice'
import type { CompactStructureSlice } from './slices/compact-structure-slice'
import type { VisualStyleSlice } from './slices/visual-style-slice'
import type { PathTracingSlice } from './slices/path-tracing-slice'
import type { PresentationTimelineSlice } from './slices/presentation-timeline-slice'
import type { BiomoleculeSlice } from './slices/biomolecule-slice'
import type { CrystalLayersSlice } from './slices/crystal-layers-slice'
import type { StructureGroupsSlice, StructureGroup } from './slices/structure-groups-slice'
import type { MergePlacementSlice } from './slices/merge-placement-slice'

export type { StructureGroup }

export type CrystalStore =
  & AssemblySlice
  & AtomAttributesSlice
  & PorositySlice
  & TrajectoryAuxSlice
  & AtomBondCrudSlice
  & AtomClipboardSlice
  & BondSlice
  & BoxSelectionSlice
  & BrillouinZoneSlice
  & CameraFocusSlice
  & CellManagementSlice
  & ElementFilterSlice
  & HistorySlice
  & LatticeSupercellSlice
  & LoadersSlice
  & MeasurementSlice
  & ModeSlice
  & MolecularOrbitalSlice
  & PlaneConstructionSlice
  & AdsorbateSlice
  & RdfSlice
  & XrdSlice
  & EdiffSlice
  & SelectionSlice
  & SelectionTransformSlice
  & SymmetryOverlaySlice
  & StructureProcessingSlice
  & TrajectorySlice
  & LightingSlice
  & ViewSettingsSlice
  & ViewportControlsSlice
  & CompactStructureSlice
  & VisualStyleSlice
  & PathTracingSlice
  & PresentationTimelineSlice
  & BiomoleculeSlice
  & CrystalLayersSlice
  & StructureGroupsSlice
  & MergePlacementSlice
