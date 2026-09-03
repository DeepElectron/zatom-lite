export type BioVector3 = readonly [number, number, number]

export type BioPolymerType = "protein" | "nucleic" | "other"

export type BioSecondaryStructure = "helix" | "sheet" | "coil"

export type BioSecondaryStructureSource = "pdb-record" | "geometry-estimate" | "none"

export interface BioResidueIdentity {
  /** PDB chain identifier. The empty string is a valid blank-chain identifier. */
  chainId: string
  sequenceNumber: number
  /** PDB insertion code. The empty string means no insertion code. */
  insertionCode: string
}

export interface BioAtom {
  /** Stable within a parsed topology and across every compatible MODEL frame. */
  id: string
  /** Zero-based topology index. */
  index: number
  serial: number
  recordType: "ATOM" | "HETATM"
  name: string
  element: string
  position: BioVector3
  occupancy: number
  bFactor: number
  formalCharge: number | null
  alternateLocation: string
  residueIndex: number
}

export interface BioResidue {
  id: string
  index: number
  name: string
  identity: BioResidueIdentity
  chainIndex: number
  atomStart: number
  atomEnd: number
  atomIndices: readonly number[]
  representativeAtomIndex: number | null
  backboneOxygenIndex: number | null
  isStandard: boolean
  secondaryStructure: BioSecondaryStructure
  secondaryStructureSource: BioSecondaryStructureSource
}

export interface BioChain {
  /** Stable chain object id; distinct from a possibly blank PDB identifier. */
  id: string
  index: number
  /** PDB chain identifier. The empty string denotes a blank chain. */
  identifier: string
  polymerType: BioPolymerType
  residueIndices: readonly number[]
}

export type BioBondSource = "conect" | "ssbond" | "distance-inference"

export interface BioBond {
  id: string
  index: number
  atomIndex1: number
  atomIndex2: number
  atomId1: string
  atomId2: string
  order: number
  kind: "covalent" | "disulfide"
  source: BioBondSource
}

export interface BioFrame {
  /** PDB MODEL number when supplied; otherwise one-based encounter order. */
  modelNumber: number
  /** x/y/z triples in topology atom order. */
  positions: Float32Array
}

export interface BioLigand {
  id: string
  residueIndex: number
  name: string
  atomIndices: readonly number[]
  centroid: BioVector3
}

export interface BioStructure {
  id: string
  title: string
  format: "pdb"
  atoms: BioAtom[]
  residues: BioResidue[]
  chains: BioChain[]
  bonds: BioBond[]
  frames: BioFrame[]
  ligands: BioLigand[]
  center: BioVector3
  radius: number
  /** True only when provenance identifies the B-factor column as AlphaFold pLDDT. */
  bFactorSemantics: "temperature-factor" | "plddt"
  warnings: string[]
}

export type BioRepresentation =
  | "cartoon"
  | "ball-and-stick"
  | "space-filling"
  | "sticks"
  | "lines"
  | "surface"
  | "coordination-polyhedra"

export type BioColorScheme =
  | "chain"
  | "chain-publication"
  | "sequence-spectrum"
  | "viridis"
  | "sequence-sunset"
  | "sequence-ocean"
  | "sequence-muted"
  | "sequence-mono"
  | "secondary-structure"
  | "element"
  | "b-factor"
  | "plddt"
  | "hydrophobicity"
  | "qualitative-residue-charge"
  | "qualitative-coulomb-potential"

export type BioLayerColor =
  | { mode: "inherit" }
  | { mode: "scheme"; scheme: BioColorScheme }
  | { mode: "custom"; value: string }

export type BioShadingMode =
  | "standard"
  | "flat"
  | "cel"
  | "gooch"
  | "hatch"
  | "iridescent"
  | "xray"
  | "halftone"
  | "thermal"
  | "dither"
  | "pixel"
  | "riso"
  | "velvet"
  | "matcap"

export interface BioLayerShadingOverride {
  mode?: BioShadingMode
  ambient?: number
  diffuse?: number
  specular?: number
  shininess?: number
  rim?: number
}

export type BioStyleEasing = "smooth" | "linear" | "hold"

export interface BioStylePatch {
  representation?: BioRepresentation
  color?: BioLayerColor
  visible?: boolean
  opacity?: number
  scale?: number
  bondScale?: number
  shading?: BioLayerShadingOverride | null
}

export interface BioStyleKeyframe {
  id: string
  frame: number
  patch: BioStylePatch
  easing: BioStyleEasing
  /** Optional authoring metadata; rendering uses the concrete patch above. */
  presetId?: string
}

export interface BioLayer {
  id: string
  name: string
  selection: string
  representation: BioRepresentation
  color: BioLayerColor
  visible: boolean
  opacity: number
  scale: number
  bondScale: number
  shading: BioLayerShadingOverride | null
  /** Current authoring identity; the concrete shading/opacity remain render-authoritative. */
  materialPresetId: string | null
  styleTrack?: BioStyleKeyframe[]
}

export interface BioSelectionResult {
  atomIndices: ReadonlySet<number>
  residueIndices: ReadonlySet<number>
  error: string | null
}
