// Crystal system types and interfaces (extracted from lib/crystal/types.ts)

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

// Alias for backwards compatibility
export type LatticeParams = LatticeParameters

export interface SupercellParams {
  nx: number
  ny: number
  nz: number
}

export interface Atom {
  id: string
  element: string
  position: [number, number, number] // fractional coordinates
  cartesian?: [number, number, number] // cartesian coordinates
  cellIndex?: [number, number, number] // which supercell this atom belongs to
  /** Formal charge in units of e. Undefined means neutral (equivalent to 0). */
  charge?: number
}

export interface Bond {
  id: string
  atom1Id: string
  atom2Id: string
  type: 'single' | 'double' | 'triple' | 'partial' | 'aromatic'
  length?: number
  /**
   * Periodic image offset of atom2 relative to atom1, in integer lattice
   * translations. Undefined or [0,0,0] means both atoms bond inside the same
   * cell. A non-zero offset means the bond crosses a cell boundary: renderers
   * must draw atom2 at `atom2.cartesian + latticeOffset * latticeVectors`,
   * never at its wrapped in-cell position, otherwise the bond shows up as a
   * line cutting straight through the cell interior.
   */
  latticeOffset?: [number, number, number]
}

export type BondType = 'single' | 'double' | 'triple' | 'partial' | 'aromatic'

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

export type ViewMode = 'ball-stick' | 'stick' | 'hyper-stick' | 'space-fill' | 'wireframe'

export type ToolMode = 'select' | 'add-atom' | 'delete' | 'add-bond' | 'drag-atom'

// Selection modes: atom, bond (chemical bonds), face (lattice faces).
// Lattice edges are used only to construct a face through the two-edges method; they do not need a
// standalone selection mode because no operation targets an edge directly.
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
