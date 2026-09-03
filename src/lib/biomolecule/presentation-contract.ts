import type { BioCameraKeyframe, BioCameraPose } from './camera-track'
import { BIO_CARTOON_LIMITS, type BioCartoonModel } from './cartoon-geometry'
import type { PresentationStyleKeyframe, PresentationStyleSnapshot } from './presentation-style-track'
import type { ElementVisualOverride } from '../render/crystal-visuals'
import type {
  BioColorScheme,
  BioLayer,
  BioLayerColor,
  BioLayerShadingOverride,
  BioRepresentation,
  BioStylePatch,
  BioStructure,
} from './types'

export type BioInteractionScope = 'ligand-protein' | 'interchain' | 'both'
export type BioBuiltinAtomicRepresentation = Extract<
  BioRepresentation,
  'ball-and-stick' | 'space-filling' | 'sticks' | 'lines'
>
export type BioBuiltinAtomicRepresentationOrInherit = BioBuiltinAtomicRepresentation | 'inherit'

export interface BiomoleculeViewerSettings {
  /** The four source base representations are independent overlay channels. */
  bioShowCartoon: boolean
  bioShowSticks: boolean
  bioShowSpacefill: boolean
  bioShowSurface: boolean
  bioColorScheme: BioColorScheme
  bioCartoonModel: BioCartoonModel
  bioCartoonQuality: number
  bioCartoonSmooth: number
  bioRibbonWidth: number
  bioRibbonThickness: number
  bioSurfaceSpacing: number
  bioSurfaceOpacity: number
  bioPolymerRepresentation: BioBuiltinAtomicRepresentationOrInherit
  bioPolymerColor: BioLayerColor
  bioPolymerScale: number
  bioShowLigand: boolean
  bioLigandRepresentation: BioBuiltinAtomicRepresentation
  bioLigandColor: BioLayerColor
  bioLigandScale: number
  bioShowIons: boolean
  bioIonRepresentation: BioBuiltinAtomicRepresentation
  bioIonColor: BioLayerColor
  bioIonScale: number
  bioShowPocket: boolean
  bioPocketRadius: number
  bioPocketRepresentation: BioBuiltinAtomicRepresentation
  bioPocketColor: BioLayerColor
  bioPocketScale: number
  bioHideWater: boolean
  bioShowSSBonds: boolean
  bioShowChainLabels: boolean
  bioShowTerminiLabels: boolean
  bioShowLigandLabels: boolean
  bioResidueLabelInterval: number
  bioLabelSize: number
  bioLabelColor: string
  bioShowInteractions: boolean
  bioInteractionHBond: boolean
  bioInteractionSaltBridge: boolean
  bioInteractionPiStacking: boolean
  bioInteractionHydrophobic: boolean
  bioInteractionScope: BioInteractionScope
  bioInteractionLabels: boolean
}

export interface BioAlignmentGhost {
  structure: BioStructure
  pairCount: number
  rmsd: number
  /** Exact residue-identity pairing; no sequence alignment or chain remapping. */
  method: 'exact-residue-identity'
  sourceLabel: string
  opacity: number
  color: string
}

export type BioCameraProjection = 'perspective' | 'orthographic'

export interface BiomoleculeVisualState extends PresentationStyleSnapshot {
  sphereDetail: number
  elementOverrides: Record<string, ElementVisualOverride>
  autoRotate: boolean
}

/** Versioned, complete stable presentation state stored with one biomolecular Asset. */
export interface BiomoleculePresentationArtifactV2 {
  schema: 'zatom.biomolecule-presentation/v2'
  structure: BioStructure
  layers: BioLayer[]
  viewer: BiomoleculeViewerSettings
  alignmentGhost: BioAlignmentGhost | null
  /** Current live visual state, including edits that have not been recorded as keyframes. */
  visual: BiomoleculeVisualState
  camera: {
    projection: BioCameraProjection
    /** Last concrete manual/evaluated pose. Null means auto-fit this document. */
    pose: BioCameraPose | null
  }
  presentation: {
    frame: number
    /** Active PDB MODEL render frame, even when explicitly decoupled from the playhead. */
    activeModel: number
    frames: number
    fps: number
    loop: boolean
    cameraKeyframes: BioCameraKeyframe[]
    baseStyleKeyframes: PresentationStyleKeyframe[]
  }
}

const REPRESENTATIONS = new Set<BioRepresentation>([
  'cartoon', 'ball-and-stick', 'space-filling', 'sticks', 'lines', 'surface', 'coordination-polyhedra',
])
const BUILTIN_ATOMIC_REPRESENTATIONS = new Set<BioBuiltinAtomicRepresentation>([
  'ball-and-stick', 'space-filling', 'sticks', 'lines',
])
const BUILTIN_ATOMIC_REPRESENTATIONS_OR_INHERIT = new Set<BioBuiltinAtomicRepresentationOrInherit>([
  ...BUILTIN_ATOMIC_REPRESENTATIONS,
  'inherit',
])
const COLOR_SCHEMES = new Set<BioColorScheme>([
  'chain', 'chain-publication', 'sequence-spectrum', 'viridis', 'sequence-sunset', 'sequence-ocean', 'sequence-muted',
  'sequence-mono', 'secondary-structure', 'element', 'b-factor', 'plddt',
  'hydrophobicity', 'qualitative-residue-charge', 'qualitative-coulomb-potential',
])
const CARTOON_MODELS = new Set<BioCartoonModel>(['ribbon', 'oval', 'rectangle', 'tube', 'rocket', 'putty', 'trace'])
const INTERACTION_SCOPES = new Set<BioInteractionScope>(['ligand-protein', 'interchain', 'both'])
const SHADING_MODES = new Set([
  'standard', 'flat', 'cel', 'gooch', 'hatch', 'iridescent', 'xray', 'halftone',
  'thermal', 'dither', 'pixel', 'riso', 'velvet', 'matcap',
])
const RENDER_STYLES = new Set([
  'vesta', 'flat', 'cel', 'gooch', 'hatch', 'iridescent', 'xray', 'halftone',
  'thermal', 'dither', 'pixel8', 'riso', 'velvet', 'matcap',
])
const VIEW_MODES = new Set(['ball-stick', 'stick', 'hyper-stick', 'space-fill', 'wireframe'])
const POLY_STYLES = new Set([
  'solid-atoms', 'translucent', 'solid', 'glass', 'paper', 'gem', 'hologram', 'neon', 'wireframe',
])
const POLY_COLOR_SOURCES = new Set(['atom', 'element', 'uniform'])
const EASINGS = new Set(['smooth', 'linear', 'hold'])
const POLYMER_TYPES = new Set(['protein', 'nucleic', 'other'])
const SECONDARY_STRUCTURES = new Set(['helix', 'sheet', 'coil'])
const SECONDARY_SOURCES = new Set(['pdb-record', 'geometry-estimate', 'none'])
const BOND_SOURCES = new Set(['conect', 'ssbond', 'distance-inference'])
const HEX = /^#[0-9a-f]{6}$/i
const finite = (value: unknown, minimum = -Infinity, maximum = Infinity): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
)
const integer = (value: unknown, minimum = -Infinity, maximum = Infinity): value is number => (
  finite(value, minimum, maximum) && Number.isInteger(value)
)
const object = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)
const vector3 = (value: unknown): value is [number, number, number] => (
  Array.isArray(value) && value.length === 3 && value.every((entry) => finite(entry))
)
const uniqueStrings = (values: readonly string[]): boolean => new Set(values).size === values.length
const uniqueIntegers = (values: readonly number[]): boolean => new Set(values).size === values.length
const nullableFinite = (value: unknown, minimum = -Infinity, maximum = Infinity): boolean => (
  value === null || finite(value, minimum, maximum)
)

function validHexMap(value: unknown, maximumEntries = 256): value is Record<string, string> {
  return object(value)
    && Object.keys(value).length <= maximumEntries
    && Object.entries(value).every(([key, color]) => (
      key.length > 0 && typeof color === 'string' && HEX.test(color)
    ))
}

function validIndexList(value: unknown, upperBound: number): value is number[] {
  return Array.isArray(value)
    && value.every((entry) => integer(entry, 0, upperBound - 1))
    && uniqueIntegers(value)
}

function validStructure(value: unknown): value is BioStructure {
  if (!object(value)
    || value.format !== 'pdb'
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || !Array.isArray(value.atoms)
    || value.atoms.length === 0
    || value.atoms.length > 5_000_000
    || !Array.isArray(value.residues)
    || value.residues.length === 0
    || value.residues.length > value.atoms.length
    || !Array.isArray(value.chains)
    || value.chains.length === 0
    || value.chains.length > value.residues.length
    || !Array.isArray(value.bonds)
    || value.bonds.length > 15_000_000
    || !Array.isArray(value.frames)
    || value.frames.length === 0
    || value.frames.length > 100_000
    || !Array.isArray(value.ligands)
    || value.ligands.length > value.residues.length
    || !vector3(value.center)
    || !finite(value.radius, 0)
    || (value.bFactorSemantics !== 'temperature-factor' && value.bFactorSemantics !== 'plddt')
    || !Array.isArray(value.warnings)
    || !value.warnings.every((warning) => typeof warning === 'string')) return false

  const atomCount = value.atoms.length
  const residueCount = value.residues.length
  const chainCount = value.chains.length
  const atoms = value.atoms
  const residues = value.residues
  if (!atoms.every((atom, index) => object(atom)
    && atom.index === index
    && typeof atom.id === 'string'
    && integer(atom.serial)
    && (atom.recordType === 'ATOM' || atom.recordType === 'HETATM')
    && typeof atom.name === 'string'
    && typeof atom.element === 'string'
    && vector3(atom.position)
    && finite(atom.occupancy, 0)
    && finite(atom.bFactor)
    && (atom.formalCharge === null || integer(atom.formalCharge))
    && typeof atom.alternateLocation === 'string'
    && integer(atom.residueIndex, 0, residueCount - 1))) return false
  if (!uniqueStrings(atoms.map((atom) => atom.id))) return false

  if (!residues.every((residue, index) => object(residue)
    && residue.index === index
    && typeof residue.id === 'string'
    && typeof residue.name === 'string'
    && object(residue.identity)
    && typeof residue.identity.chainId === 'string'
    && integer(residue.identity.sequenceNumber)
    && typeof residue.identity.insertionCode === 'string'
    && integer(residue.chainIndex, 0, chainCount - 1)
    && integer(residue.atomStart, 0, atomCount)
    && integer(residue.atomEnd, residue.atomStart as number, atomCount)
    && validIndexList(residue.atomIndices, atomCount)
    && residue.atomIndices.length > 0
    && residue.atomIndices.every((atomIndex) => atoms[atomIndex].residueIndex === index)
    && residue.atomStart === Math.min(...residue.atomIndices)
    && residue.atomEnd === Math.max(...residue.atomIndices) + 1
    && (residue.representativeAtomIndex === null
      || (integer(residue.representativeAtomIndex, 0, atomCount - 1) && residue.atomIndices.includes(residue.representativeAtomIndex)))
    && (residue.backboneOxygenIndex === null
      || (integer(residue.backboneOxygenIndex, 0, atomCount - 1) && residue.atomIndices.includes(residue.backboneOxygenIndex)))
    && typeof residue.isStandard === 'boolean'
    && SECONDARY_STRUCTURES.has(residue.secondaryStructure as string)
    && SECONDARY_SOURCES.has(residue.secondaryStructureSource as string))) return false
  if (!uniqueStrings(residues.map((residue) => residue.id))) return false
  if (residues.reduce((count, residue) => count + residue.atomIndices.length, 0) !== atomCount) return false

  if (!value.chains.every((chain, index) => object(chain)
    && chain.index === index
    && typeof chain.id === 'string'
    && typeof chain.identifier === 'string'
    && POLYMER_TYPES.has(chain.polymerType as string)
    && validIndexList(chain.residueIndices, residueCount)
    && chain.residueIndices.length > 0
    && chain.residueIndices.every((residueIndex) => residues[residueIndex].chainIndex === index))) return false
  if (!uniqueStrings(value.chains.map((chain) => chain.id))) return false
  if (value.chains.reduce((count, chain) => count + chain.residueIndices.length, 0) !== residueCount) return false

  if (!value.bonds.every((bond, index) => object(bond)
    && bond.index === index
    && typeof bond.id === 'string'
    && integer(bond.atomIndex1, 0, atomCount - 1)
    && integer(bond.atomIndex2, 0, atomCount - 1)
    && bond.atomIndex1 !== bond.atomIndex2
    && typeof bond.atomId1 === 'string'
    && typeof bond.atomId2 === 'string'
    && bond.atomId1 === atoms[bond.atomIndex1].id
    && bond.atomId2 === atoms[bond.atomIndex2].id
    && integer(bond.order, 1, 3)
    && (bond.kind === 'covalent' || bond.kind === 'disulfide')
    && BOND_SOURCES.has(bond.source as string))) return false
  if (!uniqueStrings(value.bonds.map((bond) => bond.id))) return false
  const bondPairs = value.bonds.map((bond) => `${Math.min(bond.atomIndex1, bond.atomIndex2)}:${Math.max(bond.atomIndex1, bond.atomIndex2)}`)
  if (!uniqueStrings(bondPairs)) return false

  if (!value.frames.every((frame) => object(frame)
    && integer(frame.modelNumber)
    && frame.positions instanceof Float32Array
    && frame.positions.length === atomCount * 3
    && frame.positions.every(Number.isFinite))) return false

  if (!value.ligands.every((ligand) => object(ligand)
    && typeof ligand.id === 'string'
    && integer(ligand.residueIndex, 0, residueCount - 1)
    && typeof ligand.name === 'string'
    && validIndexList(ligand.atomIndices, atomCount)
    && ligand.atomIndices.length > 0
    && ligand.atomIndices.every((atomIndex) => atoms[atomIndex].residueIndex === ligand.residueIndex)
    && vector3(ligand.centroid))) return false
  return uniqueStrings(value.ligands.map((ligand) => ligand.id))
}

function validLayerColor(value: unknown): value is BioLayerColor {
  if (!object(value)) return false
  if (value.mode === 'inherit') return true
  if (value.mode === 'scheme') return COLOR_SCHEMES.has(value.scheme as BioColorScheme)
  return value.mode === 'custom' && typeof value.value === 'string' && HEX.test(value.value)
}

function usesPlddtColor(value: BioLayerColor | undefined): boolean {
  return value?.mode === 'scheme' && value.scheme === 'plddt'
}

function usesPlddtViewerColor(value: BiomoleculeViewerSettings): boolean {
  return value.bioColorScheme === 'plddt'
    || usesPlddtColor(value.bioPolymerColor)
    || usesPlddtColor(value.bioLigandColor)
    || usesPlddtColor(value.bioIonColor)
    || usesPlddtColor(value.bioPocketColor)
}

function usesPlddtLayerColor(value: BioLayer): boolean {
  return usesPlddtColor(value.color)
    || value.styleTrack?.some((key) => usesPlddtColor(key.patch.color)) === true
}

function validShading(value: unknown): value is BioLayerShadingOverride {
  if (!object(value)) return false
  if (value.mode !== undefined && !SHADING_MODES.has(value.mode as string)) return false
  return (value.ambient === undefined || finite(value.ambient, 0, 1.5))
    && (value.diffuse === undefined || finite(value.diffuse, 0, 1.5))
    && (value.specular === undefined || finite(value.specular, 0, 1.5))
    && (value.shininess === undefined || finite(value.shininess, 1, 220))
    && (value.rim === undefined || finite(value.rim, 0, 1.5))
}

function validStylePatch(value: unknown): value is BioStylePatch {
  if (!object(value)) return false
  const allowedKeys = new Set(['representation', 'color', 'visible', 'opacity', 'scale', 'bondScale', 'shading'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false
  return (value.representation === undefined || REPRESENTATIONS.has(value.representation as BioRepresentation))
    && (value.color === undefined || validLayerColor(value.color))
    && (value.visible === undefined || typeof value.visible === 'boolean')
    && (value.opacity === undefined || finite(value.opacity, 0, 1))
    && (value.scale === undefined || finite(value.scale, .05, 10))
    && (value.bondScale === undefined || finite(value.bondScale, .05, 10))
    && (value.shading === undefined || value.shading === null || validShading(value.shading))
}

function validLayer(value: unknown): value is BioLayer {
  if (!object(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.selection !== 'string'
    || !REPRESENTATIONS.has(value.representation as BioRepresentation)
    || typeof value.visible !== 'boolean'
    || !finite(value.opacity, 0, 1)
    || !finite(value.scale, .05, 10)
    || !finite(value.bondScale, .05, 10)
    || !validLayerColor(value.color)
    || (value.materialPresetId !== null && typeof value.materialPresetId !== 'string')
    || (value.shading !== null && !validShading(value.shading))) return false
  if (value.styleTrack !== undefined && (!Array.isArray(value.styleTrack)
    || value.styleTrack.length > 100_000
    || !value.styleTrack.every((key) => object(key)
      && typeof key.id === 'string'
      && finite(key.frame, 0, 100_000)
      && EASINGS.has(key.easing as string)
      && (key.presetId === undefined || typeof key.presetId === 'string')
      && validStylePatch(key.patch))
    || !uniqueStrings(value.styleTrack.map((key) => key.id)))) return false
  return true
}

function validViewer(value: unknown): value is BiomoleculeViewerSettings {
  if (!object(value)) return false
  return typeof value.bioShowCartoon === 'boolean'
    && typeof value.bioShowSticks === 'boolean'
    && typeof value.bioShowSpacefill === 'boolean'
    && typeof value.bioShowSurface === 'boolean'
    && COLOR_SCHEMES.has(value.bioColorScheme as BioColorScheme)
    && CARTOON_MODELS.has(value.bioCartoonModel as BioCartoonModel)
    && integer(value.bioCartoonQuality, BIO_CARTOON_LIMITS.quality.min, BIO_CARTOON_LIMITS.quality.max)
    && finite(value.bioCartoonSmooth, 0, 1)
    && finite(value.bioRibbonWidth, BIO_CARTOON_LIMITS.width.min, BIO_CARTOON_LIMITS.width.max)
    && finite(value.bioRibbonThickness, BIO_CARTOON_LIMITS.thickness.min, BIO_CARTOON_LIMITS.thickness.max)
    && finite(value.bioSurfaceSpacing, .1, 5)
    && finite(value.bioSurfaceOpacity, 0, 1)
    && BUILTIN_ATOMIC_REPRESENTATIONS_OR_INHERIT.has(value.bioPolymerRepresentation as BioBuiltinAtomicRepresentationOrInherit)
    && validLayerColor(value.bioPolymerColor)
    && finite(value.bioPolymerScale, .05, 10)
    && typeof value.bioShowLigand === 'boolean'
    && BUILTIN_ATOMIC_REPRESENTATIONS.has(value.bioLigandRepresentation as BioBuiltinAtomicRepresentation)
    && validLayerColor(value.bioLigandColor)
    && finite(value.bioLigandScale, .05, 10)
    && typeof value.bioShowIons === 'boolean'
    && BUILTIN_ATOMIC_REPRESENTATIONS.has(value.bioIonRepresentation as BioBuiltinAtomicRepresentation)
    && validLayerColor(value.bioIonColor)
    && finite(value.bioIonScale, .05, 10)
    && typeof value.bioShowPocket === 'boolean'
    && finite(value.bioPocketRadius, 1, 20)
    && BUILTIN_ATOMIC_REPRESENTATIONS.has(value.bioPocketRepresentation as BioBuiltinAtomicRepresentation)
    && validLayerColor(value.bioPocketColor)
    && finite(value.bioPocketScale, .05, 10)
    && typeof value.bioHideWater === 'boolean'
    && typeof value.bioShowSSBonds === 'boolean'
    && typeof value.bioShowChainLabels === 'boolean'
    && typeof value.bioShowTerminiLabels === 'boolean'
    && typeof value.bioShowLigandLabels === 'boolean'
    && integer(value.bioResidueLabelInterval, 0, 1000)
    && finite(value.bioLabelSize, .1, 10)
    && typeof value.bioLabelColor === 'string'
    && HEX.test(value.bioLabelColor)
    && typeof value.bioShowInteractions === 'boolean'
    && typeof value.bioInteractionHBond === 'boolean'
    && typeof value.bioInteractionSaltBridge === 'boolean'
    && typeof value.bioInteractionPiStacking === 'boolean'
    && typeof value.bioInteractionHydrophobic === 'boolean'
    && INTERACTION_SCOPES.has(value.bioInteractionScope as BioInteractionScope)
    && typeof value.bioInteractionLabels === 'boolean'
}

function validStyleSnapshot(value: unknown): boolean {
  if (!object(value)) return false
  return RENDER_STYLES.has(value.renderStyle as string)
    && typeof value.background === 'string' && HEX.test(value.background)
    && typeof value.outline === 'boolean'
    && finite(value.outlineWidth, .5, 5)
    && typeof value.outlineColor === 'string' && HEX.test(value.outlineColor)
    && finite(value.atomShininess, 1, 220)
    && typeof value.bondBicolor === 'boolean'
    && typeof value.bondColor === 'string' && HEX.test(value.bondColor)
    && finite(value.elementRadiusVariance, 0, 1)
    && typeof value.showCoordinationPolyhedra === 'boolean'
    && finite(value.polyhedraOpacity, 0, 1)
    && POLY_STYLES.has(value.polyStyle as string)
    && POLY_COLOR_SOURCES.has(value.polyColorSource as string)
    && validHexMap(value.polyElementColors)
    && typeof value.polyColor === 'string' && HEX.test(value.polyColor)
    && typeof value.showPolyEdges === 'boolean'
    && typeof value.polyEdgeColor === 'string' && HEX.test(value.polyEdgeColor)
    && finite(value.polyEdgeOpacity, 0, 1)
    && finite(value.polySpecular, 0, 1)
    && finite(value.polyShininess, 1, 100)
    && finite(value.polyFresnel, 0, 1)
    && typeof value.cellColor === 'string' && HEX.test(value.cellColor)
    && finite(value.cellLineWidth, .5, 4)
    && typeof value.showCellGrid === 'boolean'
    && typeof value.showCrystalAxes === 'boolean'
    && finite(value.ambientIntensity, 0, 1.5)
    && finite(value.diffuseIntensity, 0, 1.5)
    && finite(value.specularIntensity, 0, 1.5)
    && finite(value.rimIntensity, 0, 1.5)
    && VIEW_MODES.has(value.viewMode as string)
    && finite(value.radiusScale, .1, 1.2)
    && finite(value.bondRadius, .02, .4)
    && finite(value.atomScale, 0, 10)
    && finite(value.bondScale, 0, 10)
    && typeof value.showBonds === 'boolean'
    && typeof value.showLattice === 'boolean'
    && nullableFinite(value.lightAmbient, 0, 3)
    && nullableFinite(value.lightKey, 0, 3)
    && nullableFinite(value.lightFill, 0, 3)
    && nullableFinite(value.lightAzimuth, 0, 360)
    && nullableFinite(value.lightElevation, -90, 90)
}

function validVisualState(value: unknown): value is BiomoleculeVisualState {
  if (!object(value)
    || !validStyleSnapshot(value)
    || !integer(value.sphereDetail, 8, 64)
    || typeof value.autoRotate !== 'boolean'
    || !object(value.elementOverrides)
    || Object.keys(value.elementOverrides).length > 256) return false
  return Object.entries(value.elementOverrides).every(([element, override]) => (
    element.length > 0
    && object(override)
    && typeof override.color === 'string'
    && HEX.test(override.color)
    && finite(override.radius, .1, 3)
  ))
}

/** Strict v2 persistence boundary. Invalid artifacts are rejected, never repaired or downgraded. */
export function isBiomoleculePresentationArtifactV2(value: unknown): value is BiomoleculePresentationArtifactV2 {
  if (!object(value)
    || value.schema !== 'zatom.biomolecule-presentation/v2'
    || !validStructure(value.structure)
    || !validVisualState(value.visual)
    || !object(value.camera)
    || (value.camera.projection !== 'perspective' && value.camera.projection !== 'orthographic')
    || (value.camera.pose !== null && (!object(value.camera.pose)
      || !vector3(value.camera.pose.position)
      || !vector3(value.camera.pose.target)
      || (value.camera.pose.zoom !== undefined && !finite(value.camera.pose.zoom, .01, 10_000))))
    || !object(value.presentation)
    || !finite(value.presentation.frame, 0, 100_000)
    || !integer(value.presentation.activeModel, 0, value.structure.frames.length - 1)
    || !integer(value.presentation.frames, 2, 100_000)
    || !integer(value.presentation.fps, 1, 120)
    || typeof value.presentation.loop !== 'boolean') return false
  const lastFrame = value.presentation.frames - 1
  if (!Array.isArray(value.layers)
    || value.layers.length > 10_000
    || !value.layers.every((layer) => validLayer(layer))
    || !uniqueStrings(value.layers.map((layer) => layer.id))
    || !validViewer(value.viewer)
    || !Array.isArray(value.presentation.cameraKeyframes)
    || !Array.isArray(value.presentation.baseStyleKeyframes)
    || value.presentation.cameraKeyframes.length > 100_000
    || value.presentation.baseStyleKeyframes.length > 100_000) return false
  if (value.structure.bFactorSemantics !== 'plddt'
    && (usesPlddtViewerColor(value.viewer) || value.layers.some(usesPlddtLayerColor))) return false
  if (value.alignmentGhost !== null && (!object(value.alignmentGhost)
    || !validStructure(value.alignmentGhost.structure)
    || !integer(value.alignmentGhost.pairCount, 1)
    || !finite(value.alignmentGhost.rmsd, 0)
    || !finite(value.alignmentGhost.opacity, 0, 1)
    || typeof value.alignmentGhost.color !== 'string'
    || !HEX.test(value.alignmentGhost.color)
    || value.alignmentGhost.method !== 'exact-residue-identity'
    || typeof value.alignmentGhost.sourceLabel !== 'string')) return false
  if (!value.presentation.cameraKeyframes.every((key) => object(key)
    && typeof key.id === 'string'
    && finite(key.frame, 0, 100_000)
    && vector3(key.position)
    && vector3(key.target)
    && (key.zoom === undefined || finite(key.zoom, .01, 10_000))
    && EASINGS.has(key.easing as string))
    || !uniqueStrings(value.presentation.cameraKeyframes.map((key) => key.id))) return false
  if (!value.presentation.baseStyleKeyframes.every((key) => object(key)
    && typeof key.id === 'string'
    && finite(key.frame, 0, 100_000)
    && EASINGS.has(key.easing as string)
    && validStyleSnapshot(key.snapshot))
    || !uniqueStrings(value.presentation.baseStyleKeyframes.map((key) => key.id))) return false
  return value.presentation.frame <= lastFrame
}
