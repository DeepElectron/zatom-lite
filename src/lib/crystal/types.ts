// Internal crystal types. Public Bond contracts are re-exported; Atom also
// carries optional scalar coordinates used by import, export, and assembly paths.

import type { AuxValue } from './xyz-parser'

// Bond is canonical in the public crystal contracts.
import type { Bond, BondType } from '../../contracts/crystal'
export type { Bond, BondType }

export type CrystalSystem = 
  | 'cubic'
  | 'tetragonal'
  | 'orthorhombic'
  | 'hexagonal'
  | 'trigonal'
  | 'monoclinic'
  | 'triclinic'
  | 'custom'

export type CenteringType = 'P' | 'F' | 'I' | 'C' | 'A' | 'R'

export interface LatticeParameters {
  a: number
  b: number
  c: number
  alpha: number // degrees
  beta: number  // degrees
  gamma: number // degrees
  centeringType?: CenteringType // Lattice centering (P=primitive, F=face, I=body, R=rhombohedral)
  spaceGroupNumber?: number
}

// Internal alias used throughout crystal code.
export type LatticeParams = LatticeParameters

export interface SupercellParams {
  nx: number
  ny: number
  nz: number
}

// Internal Atom includes scalar coordinate conveniences used by parser/UI paths.
export interface Atom {
  id: string
  element: string
  position: [number, number, number] // fractional coordinates
  cartesian?: [number, number, number] // cartesian coordinates
  cellIndex?: [number, number, number] // which supercell this atom belongs to
  /**
  * Integer image offset used only by `tile-images` rendering and interaction.
  * Stored coordinates remain canonical; undefined means the origin image.
  */
  displayImage?: [number, number, number]
  /** Stable asymmetric/unit-cell site index used by the crystal-layer DSL. */
  siteIndex?: number
  /** Composite-structure group ownership; undefined means ungrouped. */
  groupId?: string
  /**
  * Integer formal charge in units of e; undefined is neutral. This is distinct
  * from calculated population charges in `props` and persists across frames.
  */
  charge?: number
  x?: number
  y?: number
  z?: number
  // Per-atom extended-XYZ auxiliary properties (forces, charge, …) for the
  // ACTIVE trajectory frame. setTrajectoryFrame copies XYZFrame.atoms[i].props
  // here so it travels with the atom object (works through element-split
  // instanced rendering, sidestepping the parser-id vs store-id mismatch).
  props?: Record<string, AuxValue>
  /**
  * Frozen degrees of freedom along direct lattice axes, matching VASP selective
  * dynamics. True is fixed, false movable, and undefined means fully movable.
  * This persistent modeling intent is separate from frame-local `props`.
  */
  fixed?: [boolean, boolean, boolean]
}

export interface ElementData {
  symbol: string
  name: string
  atomicNumber: number
  color: string
  radius: number // covalent radius in Angstrom
  mass: number
}

export interface CrystalStructure {
  name: string
  latticeParams: LatticeParameters
  crystalSystem: CrystalSystem
  atoms: Atom[]
  bonds: Bond[]
}

export interface SelectionState {
  selectedAtomIds: Set<string>
  hoveredAtomId: string | null
  isBoxSelecting: boolean
  boxStart: { x: number; y: number } | null
  boxEnd: { x: number; y: number } | null
}

export interface CameraState {
  targetPosition: [number, number, number]
  isAnimating: boolean
  animationProgress: number
}

/**
 * `stick` is the source visualizer's licorice geometry: atoms and bonds share
 * the absolute global bond radius. `hyper-stick` remains zatom's SDF-enhanced
 * presentation and is deliberately a distinct mode.
 */
export type ViewMode = 'ball-stick' | 'stick' | 'hyper-stick' | 'space-fill' | 'wireframe'
export type AtomLabelScope = 'all' | 'selected'
export type AtomLabelContent = 'element' | 'number' | 'element-number'
export type AtomLabelPosition = 'above' | 'center' | 'below'

export type ToolMode = 'select' | 'add-atom' | 'delete' | 'add-bond' | 'drag-atom'

// Selection modes: atom, bond (chemical bonds), face (lattice faces).
// There is no independent lattice-edge mode: lattice edge selection is only used as a facet method in face + two-edges
// appears, it does not receive any operations, and is not worth occupying a top-level mode.
export type SelectMode = 'atom' | 'bond' | 'face'

// Face selection method: direct face click, 3 atoms, or 2 edges
export type FaceSelectMethod = 'direct' | 'three-atoms' | 'two-edges'

export type PlaneConstructionMethod = FaceSelectMethod | 'miller'

// Constructed plane from atoms, edges, faces, or Miller indices
export interface ConstructedPlane {
  id: string
  // Points that define the plane (3 atoms or 4 points from 2 edges)
  points: [number, number, number][]
  // Plane equation: ax + by + cz + d = 0
  normal: [number, number, number]
  d: number
  // Center point for display
  center: [number, number, number]
  // Method used to construct
  method: PlaneConstructionMethod
  // Source IDs (atom IDs or edge IDs)
  sourceIds: string[]
  /** For large-scene plane builder: only show atoms within this radius of center */
  localRadius?: number
}

// Lattice edge representation
export interface LatticeEdge {
  id: string
  start: [number, number, number]
  end: [number, number, number]
  // Which cell and direction
  cellIndex: [number, number, number]
  direction: 'a' | 'b' | 'c'
}

// Lattice face representation  
export interface LatticeFace {
  id: string
  vertices: [number, number, number][]
  // Which cell and which face
  cellIndex: [number, number, number]
  normal: [number, number, number]
  plane: 'ab' | 'bc' | 'ac' // which plane
}

// Lattice vector type
export type LatticeVectors = {
  a: [number, number, number]
  b: [number, number, number]
  c: [number, number, number]
}
