import type { StateCreator } from 'zustand'
import type { AuxValue, XYZFrame } from '../../lib/crystal/xyz-parser'
import { defaultMolecularOrbitalState } from '../../lib/molecular-orbitals/state'
import type { LadderLevel } from '../../lib/biomolecule/structure-ladder'
import { adaptiveBioPresentation } from '../../lib/biomolecule/default-presentation'
import { bioResidueKey, isStandardBioResidue } from '../../lib/biomolecule/constants'
import type { StructureGroup } from './structure-groups-slice'
import type {
  BioBond,
  BioColorScheme,
  BioLayer,
  BioLayerColor,
  BioStructure,
} from '../../lib/biomolecule/types'
import {
  evaluateBioStyleTrack,
  materializeBioLayerStyleEdit,
  snapshotBioLayerStyle,
  type BioLayerStyleSnapshotContext,
} from '../../lib/biomolecule/style-track'
import {
  autoKeyLayerStyle,
  hasLayerStyleKeys,
  recordLayerStyle,
} from '../../lib/presentation/layer-track-authoring'
import type {
  BioAlignmentGhost,
  BiomoleculeViewerSettings,
} from '../../lib/biomolecule/presentation-contract'
import { BIO_CARTOON_LIMITS } from '../../lib/biomolecule/cartoon-geometry'
import { exportLegacyPdb } from '../../lib/biomolecule/pdb-export'
import { parseLegacyPdb } from '../../lib/biomolecule/pdb'
import type { Atom, Bond, CrystalStore } from '../crystal-store-types'

export type BioLayerStyleEdit = Partial<Pick<
  BioLayer,
  'representation' | 'color' | 'shading' | 'opacity' | 'scale' | 'bondScale' | 'materialPresetId'
>>

export interface BiomoleculeDetailSettings {
  /** Opt-in per-atom labels for multi-atom biomolecular selections. */
  bioShowSelectedAtomDetails: boolean
}

type BiomoleculeSettings = BiomoleculeViewerSettings & BiomoleculeDetailSettings

export interface BiomoleculeSlice extends BiomoleculeSettings {
  /** Immutable topology/annotation source for the active biomolecular document. */
  bioStructure: BioStructure | null
  /** User-authored semantic layers; geometry is derived from bioStructure + current store atoms. */
  bioLayers: BioLayer[]
  /** User-deleted ligand covalent bonds, keyed by chemical identity across PDB reparsing. */
  bioSuppressedBondKeys: ReadonlySet<string>
  bioAlignmentGhost: BioAlignmentGhost | null
  /**
   * Parent outline at the current drill-down position, used as a spatial anchor.
   * Store only center/radius because this noninteractive hint derives its geometry
   * from bioStructure and must not become a second source of truth. null hides it.
   */
  bioDrillGhost: { center: [number, number, number]; radius: number } | null
  /**
   * Current drill-down ladder level, which selects the visual emphasis treatment.
   *
   * This must be separate because LadderViewport keeps currentId locally and the
   * renderer cannot access it, while focusedAtomIds identifies atoms but not scale.
   * Chain and residue focus can contain the same atoms yet require different emphasis.
   * null means no drill-down and skips emphasis rendering.
   */
  bioDrillLevel: LadderLevel | null
  /** Replace the active document with a parsed biomolecule and install its render mirrors. */
  loadBiomolecule: (structure: BioStructure) => void
  /** Drop structure-specific biomolecular state while retaining viewport display preferences. */
  clearBiomolecule: () => void
  updateBioSettings: (patch: Partial<BiomoleculeSettings>) => void
  addBioLayer: (patch?: Partial<Omit<BioLayer, 'id'>>) => string
  updateBioLayer: (id: string, patch: Partial<Omit<BioLayer, 'id'>>) => void
  /** Edit static style until a style key exists, then atomically auto-key at the playhead. */
  editBioLayerStyle: (id: string, patch: BioLayerStyleEdit) => void
  /** Record the complete effective style at the current playhead. */
  recordBioLayerStyle: (id: string) => void
  removeBioLayer: (id: string) => void
  duplicateBioLayer: (id: string) => string | null
  moveBioLayer: (fromIndex: number, toIndex: number) => void
  setBioAlignmentGhost: (ghost: BioAlignmentGhost | null) => void
  setBioDrillGhost: (ghost: { center: [number, number, number]; radius: number } | null) => void
  setBioDrillLevel: (level: LadderLevel | null) => void
  /** Commit an explicit same-document Cartesian edit into the active MODEL frame. */
  syncBiomoleculeCoordinates: (atoms: readonly Atom[]) => void
  /**
   * Append world-space atoms to the active biomolecular document as a HETATM ligand.
   * Export, insert HETATM records, and reparse so distance inference rebuilds ligand
   * bonds. On success, select the new residue for immediate gizmo use. Returns success.
   */
  appendBioHetComponent: (name: string, atoms: readonly { element: string; position: [number, number, number] }[]) => boolean
  /**
   * Recompute atom-mirror groupIds from structureGroups.bioResidueKeys. Call after
   * changing biological layer membership, which is derived rather than stored as IDs.
   */
  refreshBioLayerMembership: () => void
  /**
   * Delete biomolecular atoms by exporting without them and reparsing, preserving
   * residue semantics, cartoons, and secondary structure. The crystal deletion path
   * would reduce the protein to raw atoms, so biological deletion must use this path.
   */
  deleteBioAtoms: (atomIds: ReadonlySet<string>) => boolean
  /**
   * Delete covalent bonds within HETATM ligands. Because PDB reparsing would infer them
   * again, store chemical-identity keys in bioSuppressedBondKeys and omit them from
   * derived view bonds. Reject polymer bonds; mixed selections delete only ligand bonds.
   */
  deleteBioBonds: (bondIds: Iterable<string>) => 'deleted' | 'partial' | 'polymer-forbidden' | 'none'
}

export const DEFAULT_BIOMOLECULE_VIEWER_SETTINGS: Readonly<BiomoleculeSettings> = {
  bioShowCartoon: true,
  bioShowSticks: false,
  bioShowSpacefill: false,
  bioShowSurface: false,
  bioColorScheme: 'viridis',
  bioCartoonModel: 'ribbon',
  bioCartoonQuality: 8,
  bioCartoonSmooth: 1,
  bioRibbonWidth: 1,
  bioRibbonThickness: 1,
  bioSurfaceSpacing: 1,
  bioSurfaceOpacity: 0.85,
  bioPolymerRepresentation: 'sticks',
  bioPolymerColor: { mode: 'inherit' },
  bioPolymerScale: 1.5,
  bioShowLigand: true,
  bioLigandRepresentation: 'ball-and-stick',
  bioLigandColor: { mode: 'scheme', scheme: 'element' },
  bioLigandScale: 2.2,
  bioShowIons: true,
  bioIonRepresentation: 'space-filling',
  bioIonColor: { mode: 'scheme', scheme: 'element' },
  bioIonScale: 0.55,
  bioShowPocket: false,
  bioPocketRadius: 5,
  bioPocketRepresentation: 'sticks',
  bioPocketColor: { mode: 'inherit' },
  bioPocketScale: 1,
  bioHideWater: true,
  bioShowSSBonds: false,
  bioShowChainLabels: false,
  bioShowTerminiLabels: false,
  bioShowLigandLabels: false,
  bioShowSelectedAtomDetails: false,
  bioResidueLabelInterval: 0,
  bioLabelSize: 1,
  bioLabelColor: '#1b1a17',
  bioShowInteractions: false,
  bioInteractionHBond: true,
  bioInteractionSaltBridge: true,
  bioInteractionPiStacking: true,
  bioInteractionHydrophobic: false,
  bioInteractionScope: 'ligand-protein',
  bioInteractionLabels: false,
}

let fallbackLayerSequence = 0
let fallbackStyleKeySequence = 0

function createLayerId(): string {
  if (globalThis.crypto?.randomUUID) return `bio-layer-${globalThis.crypto.randomUUID()}`
  fallbackLayerSequence += 1
  return `bio-layer-${fallbackLayerSequence}`
}

function createStyleKeyId(): string {
  if (globalThis.crypto?.randomUUID) return `bio-style-${globalThis.crypto.randomUUID()}`
  fallbackStyleKeySequence += 1
  return `bio-style-${fallbackStyleKeySequence}`
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizedLayer(layer: BioLayer, structure: BioStructure | null): BioLayer {
  const color = colorForStructure(layer.color, structure)
  const styleTrack = layer.styleTrack?.map((key) => ({
    ...key,
    patch: {
      ...key.patch,
      ...(key.patch.color === undefined
        ? {}
        : { color: colorForStructure(key.patch.color, structure) }),
    },
  }))
  return {
    ...layer,
    name: layer.name.trim() || 'Layer',
    selection: layer.selection.trim() || 'all',
    color,
    opacity: clamp(Number.isFinite(layer.opacity) ? layer.opacity : 1, 0, 1),
    scale: clamp(Number.isFinite(layer.scale) ? layer.scale : 1, 0.05, 10),
    bondScale: clamp(Number.isFinite(layer.bondScale) ? layer.bondScale : 1, 0.05, 10),
    materialPresetId: typeof layer.materialPresetId === 'string' ? layer.materialPresetId : null,
    ...(styleTrack === undefined ? {} : { styleTrack }),
  }
}

function styleSnapshotContext(state: CrystalStore): BioLayerStyleSnapshotContext {
  return {
    bioColorScheme: state.bioColorScheme,
    renderStyle: state.renderStyle,
    ambient: state.ambientIntensity,
    diffuse: state.diffuseIntensity,
    specular: state.specularIntensity,
    shininess: state.atomShininess,
    rim: state.rimIntensity,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
  }
}

function effectiveLayerStyle(
  layer: BioLayer,
  frame: number,
  context: BioLayerStyleSnapshotContext,
) {
  const evaluated = evaluateBioStyleTrack(layer.styleTrack, frame, layer, {
    ambient: context.lightAmbient ?? context.ambient,
    diffuse: context.lightKey ?? context.diffuse,
    specular: context.specular,
    shininess: context.shininess,
    rim: context.rim,
  })
  if (!evaluated) return layer
  return {
    representation: evaluated.representation ?? layer.representation,
    color: evaluated.color ?? layer.color,
    opacity: evaluated.opacity,
    scale: evaluated.scale,
    bondScale: evaluated.bondScale,
    shading: {
      mode: evaluated.mode,
      ambient: evaluated.ambient,
      diffuse: evaluated.diffuse,
      specular: evaluated.specular,
      shininess: evaluated.shininess,
      rim: evaluated.rim,
    },
  }
}

function colorForStructure(
  color: BioLayerColor,
  structure: BioStructure | null,
): BioLayerColor {
  if (color.mode === 'scheme'
    && color.scheme === 'plddt'
    && structure?.bFactorSemantics !== 'plddt') {
    throw new Error("pLDDT coloring requires structure.bFactorSemantics === 'plddt'")
  }
  return { ...color }
}

function retainedColorForStructure(
  color: BioLayerColor,
  structure: BioStructure,
): BioLayerColor {
  return color.mode === 'scheme'
    && color.scheme === 'plddt'
    && structure.bFactorSemantics !== 'plddt'
    ? { mode: 'inherit' }
    : { ...color }
}

function schemeForStructure(
  scheme: BioColorScheme,
  structure: BioStructure | null,
): BioColorScheme {
  if (scheme === 'plddt' && structure?.bFactorSemantics !== 'plddt') {
    throw new Error("pLDDT coloring requires structure.bFactorSemantics === 'plddt'")
  }
  return scheme
}

function defaultLayer(id: string, ordinal: number): BioLayer {
  return {
    id,
    name: `Layer ${ordinal}`,
    selection: 'all',
    representation: 'ball-and-stick',
    color: { mode: 'inherit' },
    visible: true,
    opacity: 1,
    scale: 1,
    bondScale: 1,
    shading: null,
    materialPresetId: null,
  }
}

function explicitTopologyProps(atom: BioStructure['atoms'][number]): Record<string, AuxValue> {
  return {
    'zatom.explicitBondTopology': { kind: 'scalar', value: 1 },
    occupancy: { kind: 'scalar', value: atom.occupancy },
    bFactor: { kind: 'scalar', value: atom.bFactor },
    ...(atom.formalCharge === null
      ? {}
      : { formalCharge: { kind: 'scalar' as const, value: atom.formalCharge } }),
  }
}

/**
 * Derive viewer atoms. Groups with bioResidueKeys assign groupId to matching residues,
 * enabling STRUCTURE LAYERS for biomolecules. Imported or extracted fragments form
 * child layers and unmarked atoms remain in Base. Stable residue keys let groupId be
 * recomputed after reparsing without synchronization.
 */
function viewerAtoms(structure: BioStructure, groups: readonly StructureGroup[] = []): Atom[] {
  const groupIdByResidueKey = new Map<string, string>()
  for (const group of groups) {
    for (const key of group.bioResidueKeys ?? []) groupIdByResidueKey.set(key, group.id)
  }

  return structure.atoms.map((atom) => {
    const position = [...atom.position] as [number, number, number]
    const residue = structure.residues[atom.residueIndex]
    const groupId = residue === undefined
      ? undefined
      : groupIdByResidueKey.get(bioResidueKey(residue.identity))
    return {
      id: atom.id,
      element: atom.element,
      position,
      cartesian: [...position],
      props: explicitTopologyProps(atom),
      ...(groupId ? { groupId } : {}),
    }
  })
}

const EMPTY_BOND_SUPPRESSION: ReadonlySet<string> = new Set<string>()

/**
 * Chemical identity key: chain:seq:ins:name:altLoc. atom.id contains the PDB serial,
 * which changes when deletion renumbers atoms, so it cannot persist across reparsing.
 * This residue-relative chemical position still identifies the same atom after export/reparse.
 */
function bioAtomIdentityKey(structure: BioStructure, atomIndex: number): string | null {
  const atom = structure.atoms[atomIndex]
  const residue = atom ? structure.residues[atom.residueIndex] : undefined
  if (!atom || !residue) return null
  const { chainId, sequenceNumber, insertionCode } = residue.identity
  return `${chainId || '_'}:${sequenceNumber}:${insertionCode || '_'}:${atom.name}:${atom.alternateLocation || '_'}`
}

/** Persistent identity for a deleted covalent bond as an unordered atom pair. */
function bioBondSuppressionKey(structure: BioStructure, bond: BioBond): string | null {
  const first = bioAtomIdentityKey(structure, bond.atomIndex1)
  const second = bioAtomIdentityKey(structure, bond.atomIndex2)
  if (!first || !second) return null
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

/** A covalent bond is deletable only when both ends are HETATM ligand atoms. */
function bioBondIsDeletable(structure: BioStructure, bond: BioBond): boolean {
  return structure.atoms[bond.atomIndex1]?.recordType === 'HETATM'
    && structure.atoms[bond.atomIndex2]?.recordType === 'HETATM'
}

/**
 * PDB topology is inferred by distance, so reparsing would restore deleted bonds.
 * bioSuppressedBondKeys is the canonical exclusion applied when deriving viewer bonds.
 */
function viewerBonds(structure: BioStructure, suppressed: ReadonlySet<string>): Bond[] {
  const bonds: Bond[] = []
  for (const bond of structure.bonds) {
    if (suppressed.size > 0) {
      const key = bioBondSuppressionKey(structure, bond)
      if (key && suppressed.has(key)) continue
    }
    bonds.push({
      id: bond.id,
      atom1Id: bond.atomId1,
      atom2Id: bond.atomId2,
      type: bond.order === 2 ? 'double' : bond.order === 3 ? 'triple' : 'single',
    })
  }
  return bonds
}

function viewerFrames(structure: BioStructure): XYZFrame[] | null {
  if (structure.frames.length <= 1) return null
  return structure.frames.map((frame) => ({
    comment: `PDB MODEL ${frame.modelNumber}`,
    frameScalars: { modelNumber: frame.modelNumber },
    atoms: structure.atoms.map((atom, atomIndex) => {
      const offset = atomIndex * 3
      const position: [number, number, number] = [
        frame.positions[offset],
        frame.positions[offset + 1],
        frame.positions[offset + 2],
      ]
      return {
        id: atom.id,
        element: atom.element,
        position: [...position],
        cartesian: position,
      }
    }),
  }))
}

function normalizedSettingsPatch(
  patch: Partial<BiomoleculeSettings>,
  structure: BioStructure | null,
): Partial<BiomoleculeSettings> {
  return {
    ...patch,
    ...(patch.bioColorScheme === undefined
      ? {}
      : { bioColorScheme: schemeForStructure(patch.bioColorScheme, structure) }),
    ...(patch.bioCartoonQuality === undefined
      ? {}
      : { bioCartoonQuality: Math.round(clamp(
          finiteOr(patch.bioCartoonQuality, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioCartoonQuality),
          BIO_CARTOON_LIMITS.quality.min,
          BIO_CARTOON_LIMITS.quality.max,
        )) }),
    ...(patch.bioCartoonSmooth === undefined
      ? {}
      : { bioCartoonSmooth: clamp(finiteOr(patch.bioCartoonSmooth, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioCartoonSmooth), 0, 1) }),
    ...(patch.bioRibbonWidth === undefined
      ? {}
      : { bioRibbonWidth: clamp(
          finiteOr(patch.bioRibbonWidth, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioRibbonWidth),
          BIO_CARTOON_LIMITS.width.min,
          BIO_CARTOON_LIMITS.width.max,
        ) }),
    ...(patch.bioRibbonThickness === undefined
      ? {}
      : { bioRibbonThickness: clamp(
          finiteOr(patch.bioRibbonThickness, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioRibbonThickness),
          BIO_CARTOON_LIMITS.thickness.min,
          BIO_CARTOON_LIMITS.thickness.max,
        ) }),
    ...(patch.bioSurfaceSpacing === undefined
      ? {}
      : { bioSurfaceSpacing: clamp(finiteOr(patch.bioSurfaceSpacing, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioSurfaceSpacing), 0.1, 5) }),
    ...(patch.bioSurfaceOpacity === undefined
      ? {}
      : { bioSurfaceOpacity: clamp(finiteOr(patch.bioSurfaceOpacity, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioSurfaceOpacity), 0, 1) }),
    ...(patch.bioPolymerColor === undefined ? {} : { bioPolymerColor: colorForStructure(patch.bioPolymerColor, structure) }),
    ...(patch.bioPolymerScale === undefined
      ? {}
      : { bioPolymerScale: clamp(finiteOr(patch.bioPolymerScale, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioPolymerScale), 0.05, 10) }),
    ...(patch.bioLigandColor === undefined ? {} : { bioLigandColor: colorForStructure(patch.bioLigandColor, structure) }),
    ...(patch.bioLigandScale === undefined
      ? {}
      : { bioLigandScale: clamp(finiteOr(patch.bioLigandScale, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioLigandScale), 0.05, 10) }),
    ...(patch.bioIonColor === undefined ? {} : { bioIonColor: colorForStructure(patch.bioIonColor, structure) }),
    ...(patch.bioIonScale === undefined
      ? {}
      : { bioIonScale: clamp(finiteOr(patch.bioIonScale, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioIonScale), 0.05, 10) }),
    ...(patch.bioPocketRadius === undefined
      ? {}
      : { bioPocketRadius: clamp(finiteOr(patch.bioPocketRadius, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioPocketRadius), 1, 20) }),
    ...(patch.bioPocketColor === undefined ? {} : { bioPocketColor: colorForStructure(patch.bioPocketColor, structure) }),
    ...(patch.bioPocketScale === undefined
      ? {}
      : { bioPocketScale: clamp(finiteOr(patch.bioPocketScale, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioPocketScale), 0.05, 10) }),
    ...(patch.bioResidueLabelInterval === undefined
      ? {}
      : { bioResidueLabelInterval: Math.round(clamp(finiteOr(patch.bioResidueLabelInterval, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioResidueLabelInterval), 0, 1000)) }),
    ...(patch.bioLabelSize === undefined
      ? {}
      : { bioLabelSize: clamp(finiteOr(patch.bioLabelSize, DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioLabelSize), 0.1, 10) }),
  }
}

export const createBiomoleculeSlice: StateCreator<CrystalStore, [], [], BiomoleculeSlice> = (set, get) => ({
  bioStructure: null,
  bioLayers: [],
  bioSuppressedBondKeys: new Set<string>(),
  bioAlignmentGhost: null,
  bioDrillGhost: null,
  bioDrillLevel: null,
  ...DEFAULT_BIOMOLECULE_VIEWER_SETTINGS,

  loadBiomolecule: (structure) => {
    const current = get()
    if (current.trajectoryIntervalId) clearInterval(current.trajectoryIntervalId)
    current.compactTrajectorySource?.dispose?.()
    current.compactSpeciesSource?.dispose?.()
    // Loading a PDB is document navigation. Undo and presentation keys from a
    // previous document must never point at this new topology/camera scale.
    current.resetStructureHistory()
    current.resetPresentationTimeline()

    // A new document has new topology, so prior layer groups and residue membership do
    // not apply. Create Base immediately to preserve the structure-implies-layer-tree invariant.
    current.resetStructureGroupsToBase()
    const atoms = viewerAtoms(structure)
    // Deleted ligand bonds from the previous structure do not apply to the new one.
    const bonds = viewerBonds(structure, EMPTY_BOND_SUPPRESSION)
    const frames = viewerFrames(structure)
    // Choose an adaptive initial presentation only when the user has not explicitly customized it.
    const adaptive = adaptiveBioPresentation(structure)
    set({
      bioStructure: structure,
      bioColorScheme: current.bioColorScheme === 'plddt' && structure.bFactorSemantics !== 'plddt'
        // A pLDDT color scheme makes a false claim on structures without pLDDT semantics.
        ? adaptive.bioColorScheme
        // A nondefault value is user-selected and retained; otherwise choose adaptively.
        : current.bioColorScheme !== DEFAULT_BIOMOLECULE_VIEWER_SETTINGS.bioColorScheme
          ? current.bioColorScheme
          : adaptive.bioColorScheme,
      // Recompute representation toggles from the structure. Reusing a DNA sticks
      // setting on the next protein would produce clutter and unnecessary work.
      bioShowSticks: adaptive.bioShowSticks,
      bioPolymerColor: retainedColorForStructure(current.bioPolymerColor, structure),
      bioLigandColor: retainedColorForStructure(current.bioLigandColor, structure),
      bioIonColor: retainedColorForStructure(current.bioIonColor, structure),
      bioPocketColor: retainedColorForStructure(current.bioPocketColor, structure),
      bioLayers: [],
      bioSuppressedBondKeys: new Set<string>(),
      bioAlignmentGhost: null,
      // A new document has a new coordinate system; clear the old drill outline so it
      // is not drawn at a meaningless position over the new structure.
      bioDrillGhost: null,
      bioDrillLevel: null,
      // A new document has a new atom-ID space, so old bond annotations are invalid.
      bondAnnotations: [],
      crystalLayers: [],
      builderMode: 'structure',
      periodic: false,
      showLattice: false,
      unitCellAtoms: [],
      atoms,
      bonds,
      supercellParams: { nx: 1, ny: 1, nz: 1 },
      userAddedAtomIds: new Set<string>(),
      userDeletedPositions: new Set<string>(),
      selectedAtomIds: new Set<string>(),
      selectedBondIds: new Set<string>(),
      selectedEdgeIds: new Set<string>(),
      selectedFaceIds: new Set<string>(),
      focusedAtomIds: new Set<string>(),
      hoveredAtomId: null,
      hoveredBondId: null,
      hoveredEdgeId: null,
      hoveredFaceId: null,
      draggingAtomId: null,
      compactStructure: null,
      focusAtoms: [],
      selectedCompactIndices: new Set<number>(),
      compactTrajectory: null,
      compactTrajectorySource: null,
      compactSpeciesSource: null,
      compactTrajectoryPlaying: false,
      compactTrajectorySeek: null,
      compactTrajectoryDisplayFrame: 0,
      trajectoryFrames: frames,
      trajectoryCurrentFrame: 0,
      trajectoryTotalFrames: frames?.length ?? 0,
      trajectoryPlaying: false,
      trajectoryIntervalId: null,
      trajectoryFps: 10,
      trajectoryFormatLabel: frames ? 'PDB MODEL' : null,
      trajectoryFormatKind: null,
      trajectoryCoordinateMode: null,
      trajectoryLatticeMode: null,
      trajectoryMetadata: frames
        ? structure.frames.map((frame, index) => ({
            frame: index + 1,
            step: frame.modelNumber,
            extra: { modelNumber: frame.modelNumber },
          }))
        : [],
      // Source contract: the first load of a MODEL ensemble maps one
      // presentation frame to one conformer at 10 fps. reset above ensures
      // this is document initialization, never an overwrite of later edits.
      presentationFrames: frames?.length ?? 120,
      presentationFps: frames ? 10 : 24,
      bondSettings: {
        ...current.bondSettings,
        elementPairRadii: {},
        restrictToConfiguredPairs: false,
      },
      polyhedraCentralElements: new Set<string>(),
      showCoordinationPolyhedra: false,
      coordinationAnalysisSummary: null,
      atomAttributes: {},
      ptmAnalysis: null,
      mofSbus: [],
      mofRacs: [],
      mofWarnings: [],
      showMofSbuColoring: false,
      showPtmColoring: false,
      selectedSbuId: null,
      molecularOrbital: defaultMolecularOrbitalState,
      measurementMode: 'none',
      measurements: [],
      pendingMeasurementAtoms: [],
      activeMeasurementEdit: null,
      pendingBondAtomId: null,
      boxSelectModeEnabled: false,
      isBoxSelecting: false,
      boxStart: null,
      boxEnd: null,
      selectionRegionPreview: null,
      constructedPlane: null,
      show2DPlaneView: false,
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      translateMode: false,
      translationPreview: null,
      rotationPreview: null,
      selectionTransformMode: 'translate',
      selectionTransformOrigin: null,
    })
    get().beginCameraDocument()
  },

  // Clear only PDB-owned topology/presentation state. The camera/style timeline
  // belongs to the document as a whole and must survive an ordinary atom/bond
  // edit that converts a biomolecule into a modeled structure. True document
  // replacements reset that shared timeline explicitly at their own boundary.
  clearBiomolecule: () => {
    // Biomolecular groups derive membership from residue identity. This is an empty
    // document, not replacement navigation, so clear groups instead of rebuilding Base.
    get().clearStructureGroups()
    set({ bioStructure: null, bioLayers: [], bioSuppressedBondKeys: new Set<string>(), bioAlignmentGhost: null, bioDrillGhost: null, bioDrillLevel: null })
  },
  setBioAlignmentGhost: (bioAlignmentGhost) => set({ bioAlignmentGhost }),
  setBioDrillGhost: (bioDrillGhost) => set({ bioDrillGhost }),
  setBioDrillLevel: (bioDrillLevel) => set({ bioDrillLevel }),
  syncBiomoleculeCoordinates: (atoms) => {
    const current = get()
    const structure = current.bioStructure
    if (!structure) return
    const positions = new Map(atoms.flatMap((atom) => atom.cartesian ? [[atom.id, atom.cartesian] as const] : []))
    let changed = false
    const nextAtoms = structure.atoms.map((atom) => {
      const position = positions.get(atom.id)
      if (!position) return atom
      if (
        atom.position[0] === position[0]
        && atom.position[1] === position[1]
        && atom.position[2] === position[2]
      ) return atom
      changed = true
      return { ...atom, position: [...position] as [number, number, number] }
    })
    if (!changed) return
    const activeFrameIndex = current.trajectoryTotalFrames > 0
      ? current.trajectoryCurrentFrame
      : 0
    const nextFrames = structure.frames.map((frame, frameIndex) => {
      if (frameIndex !== activeFrameIndex) return frame
      const nextPositions = new Float32Array(structure.atoms.length * 3)
      for (const atom of nextAtoms) {
        const offset = atom.index * 3
        nextPositions[offset] = atom.position[0]
        nextPositions[offset + 1] = atom.position[1]
        nextPositions[offset + 2] = atom.position[2]
      }
      return { ...frame, positions: nextPositions }
    })
    const nextTrajectoryFrames = current.trajectoryFrames?.map((frame, frameIndex) => (
      frameIndex === activeFrameIndex
        ? {
            ...frame,
            atoms: frame.atoms.map((frameAtom, atomIndex) => {
              const atom = atoms[atomIndex]
              if (!atom?.cartesian) return frameAtom
              return {
                ...frameAtom,
                position: [...atom.cartesian] as [number, number, number],
                cartesian: [...atom.cartesian] as [number, number, number],
              }
            }),
          }
        : frame
    ))
    set({
      bioStructure: {
        ...structure,
        atoms: nextAtoms,
        frames: nextFrames,
      },
      ...(nextTrajectoryFrames ? { trajectoryFrames: nextTrajectoryFrames } : {}),
    })
  },
  appendBioHetComponent: (name, atomInputs) => {
    const current = get()
    const structure = current.bioStructure
    if (!structure || atomInputs.length === 0) return false
    if (structure.atoms.length + atomInputs.length > 99_999) return false

    // PDB residue names are limited to three characters. Avoid standard-residue
    // names because the parser classifies by name alone: "Methane.xyz" becoming
    // MET would be treated as methionine and sent to cartoon rendering despite
    // having no backbone atoms, making the component invisible.
    //
    // Preserve water names such as HOH/WAT/DOD. They do not trigger polymer
    // cartoon rendering, while renaming them LIG would mislabel water and make
    // subsystem selection and interaction analysis treat it as a ligand.
    // Accept only a standalone 1-3 character component token. Truncating prose
    // creates misleading pseudo-codes ("Cand 1 · 0.87" once became "CAN"). Using
    // the first token also preserves derived names such as "ATP.xyz" and "HOH copy".
    const firstToken = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean)[0] ?? ''
    const derivedName = /^[A-Za-z0-9]{1,3}$/.test(firstToken) ? firstToken.toUpperCase() : ''
    const residueName = !derivedName || isStandardBioResidue(derivedName)
      ? 'LIG'
      : derivedName
    const usedChainIds = new Set(structure.chains.map((chain) => chain.identifier))
    const chainId = 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210'.split('').find((c) => !usedChainIds.has(c))
    if (!chainId) return false

    let pdbText: string
    try {
      // Serialize current viewport coordinates so uncommitted gizmo edits are retained.
      pdbText = exportLegacyPdb(structure, {
        currentAtomPositions: new Map(
          current.atoms.flatMap((atom) => atom.cartesian
            ? [[atom.id, atom.cartesian as [number, number, number]] as const]
            : []),
        ),
        activeFrameIndex: current.trajectoryTotalFrames > 0 ? current.trajectoryCurrentFrame : 0,
      })
    } catch {
      return false
    }

    // Build fixed-column HETATM records with the element right-aligned in columns 13-14.
    const hetLines = atomInputs.map((atom, index) => {
      const serial = structure.atoms.length + index + 1
      const element = atom.element.trim().slice(0, 2)
      const atomName = element.length === 1 ? ` ${element}${index + 1}`.padEnd(4) : `${element}${index + 1}`.padEnd(4)
      const line = Array<string>(80).fill(' ')
      const put = (start: number, end: number, text: string, align: 'left' | 'right') => {
        const width = end - start
        const padded = align === 'left' ? text.padEnd(width) : text.padStart(width)
        for (let i = 0; i < width; i += 1) line[start + i] = padded[i] ?? ' '
      }
      put(0, 6, 'HETATM', 'left')
      put(6, 11, String(serial), 'right')
      put(12, 16, atomName, 'left')
      put(17, 20, residueName, 'right')
      put(21, 22, chainId, 'left')
      put(22, 26, '1', 'right')
      put(30, 38, atom.position[0].toFixed(3), 'right')
      put(38, 46, atom.position[1].toFixed(3), 'right')
      put(46, 54, atom.position[2].toFixed(3), 'right')
      put(54, 60, '1.00', 'right')
      put(60, 66, '0.00', 'right')
      put(76, 78, element, 'right')
      return line.join('').trimEnd()
    }).join('\n')

    // Insert before every ENDMDL for ensembles, or before END for a single model.
    const nextPdb = pdbText.includes('\nENDMDL')
      ? pdbText.replace(/\nENDMDL/g, `\n${hetLines}\nENDMDL`)
      : pdbText.replace(/\nEND\n?$/, `\n${hetLines}\nEND\n`)

    let nextStructure: BioStructure
    try {
      nextStructure = parseLegacyPdb(nextPdb)
    } catch {
      return false
    }

    // New atoms are the parsed new chain; never guess IDs from the previous ID space.
    const newChain = nextStructure.chains.find((chain) => chain.identifier === chainId)
    const newAtomIds = new Set<string>()
    if (newChain) {
      for (const residueIndex of newChain.residueIndices) {
        for (const atomIndex of nextStructure.residues[residueIndex].atomIndices) {
          const id = nextStructure.atoms[atomIndex]?.id
          if (id) newAtomIds.add(id)
        }
      }
    }

    // Reset history because document-level topology changes invalidate old undo snapshots.
    current.resetStructureHistory()
    const frames = viewerFrames(nextStructure)
    set({
      bioStructure: nextStructure,
      // Preserve suppressed ligand bonds by chemical identity; insertion does not rename existing residues.
      bonds: viewerBonds(nextStructure, current.bioSuppressedBondKeys),
      ...(frames ? { trajectoryFrames: frames } : {}),
      // Select the new ligand so its transform gizmo is immediately available.
      selectedAtomIds: newAtomIds,
      selectedBondIds: new Set<string>(),
      focusedAtomIds: new Set<string>(),
      hoveredAtomId: null,
      pendingBondAtomId: null,
      // Old annotations and measurements refer to the pre-parse atom ID space.
      bondAnnotations: [],
      measurements: [],
      pendingMeasurementAtoms: [],
    })

    // Match periodic drag-and-merge layer semantics: the parent is the complex,
    // Base is the original structure, and a new active child is the inserted molecule.
    // Register the residue-key group before deriving groupId values in the atom mirror.
    const newResidueKeys = newChain
      ? newChain.residueIndices.map((i) => bioResidueKey(nextStructure.residues[i].identity))
      : []
    // Treat only a suffix beginning with a letter as an extension. A broad
    // `\.[^.]+$` would strip the score in "Cand 1 · 0.87", corrupting both the
    // panel name and the viewport label source.
    const groupName = name.replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, '').trim()
    const groupId = get().addBioGroup(groupName || residueName, newResidueKeys)
    set({ atoms: viewerAtoms(nextStructure, get().structureGroups), activeGroupId: groupId })
    return true
  },

  refreshBioLayerMembership: () => {
    const { bioStructure, structureGroups } = get()
    if (!bioStructure) return
    // Re-derive atom groupIds after bioResidueKeys change. This is the sole
    // biological membership update path because membership is not a static ID list.
    set({ atoms: viewerAtoms(bioStructure, structureGroups) })
  },

  deleteBioAtoms: (atomIds) => {
    const current = get()
    const structure = current.bioStructure
    if (!structure || atomIds.size === 0) return false

    // Removing the entire document clears the biomolecular scene.
    const remaining = structure.atoms.filter((atom) => !atomIds.has(atom.id)).length
    if (remaining === 0) {
      current.resetStructureHistory()
      current.clearBiomolecule()
      set({
        atoms: [],
        bonds: [],
        selectedAtomIds: new Set<string>(),
        selectedBondIds: new Set<string>(),
        focusedAtomIds: new Set<string>(),
        hoveredAtomId: null,
        bondAnnotations: [],
        measurements: [],
        pendingMeasurementAtoms: [],
      })
      return true
    }

    let pdbText: string
    try {
      // Export current viewport coordinates, retaining gizmo edits while excluding removed atoms.
      pdbText = exportLegacyPdb(structure, {
        currentAtomPositions: new Map(
          current.atoms.flatMap((atom) => atom.cartesian
            ? [[atom.id, atom.cartesian as [number, number, number]] as const]
            : []),
        ),
        activeFrameIndex: current.trajectoryTotalFrames > 0 ? current.trajectoryCurrentFrame : 0,
        excludeAtomIds: atomIds,
      })
    } catch {
      return false
    }

    let nextStructure: BioStructure
    try {
      nextStructure = parseLegacyPdb(pdbText)
    } catch {
      return false
    }

    // Reset history because document topology no longer matches old snapshots.
    // Preserve bioLayers: chain/residue selections are re-evaluated after parsing,
    // and a removed chain naturally resolves to an empty, nonrendering selection.
    current.resetStructureHistory()
    const frames = viewerFrames(nextStructure)
    set({
      bioStructure: nextStructure,
      // Chain-derived group membership follows automatically because chain IDs remain stable.
      atoms: viewerAtoms(nextStructure, current.structureGroups),
      bonds: viewerBonds(nextStructure, current.bioSuppressedBondKeys),
      ...(frames ? { trajectoryFrames: frames } : {}),
      selectedAtomIds: new Set<string>(),
      selectedBondIds: new Set<string>(),
      focusedAtomIds: new Set<string>(),
      hoveredAtomId: null,
      pendingBondAtomId: null,
      // Old annotations and measurements refer to the pre-parse atom ID space.
      bondAnnotations: [],
      measurements: [],
      pendingMeasurementAtoms: [],
    })
    return true
  },

  deleteBioBonds: (bondIds) => {
    const current = get()
    const structure = current.bioStructure
    if (!structure) return 'none'
    const targets = new Set(bondIds)
    if (targets.size === 0) return 'none'

    const suppressed = new Set(current.bioSuppressedBondKeys)
    let removed = 0
    let blocked = 0
    for (const bond of structure.bonds) {
      if (!targets.has(bond.id)) continue
      // Polymer backbone bonds define residue chemistry and therefore cannot be deleted.
      if (!bioBondIsDeletable(structure, bond)) {
        blocked += 1
        continue
      }
      const key = bioBondSuppressionKey(structure, bond)
      if (!key || suppressed.has(key)) continue
      suppressed.add(key)
      removed += 1
    }
    if (removed === 0) return blocked > 0 ? 'polymer-forbidden' : 'none'

    // Reset history because the new suppression set no longer matches old bond snapshots.
    current.resetStructureHistory()
    set({
      bioSuppressedBondKeys: suppressed,
      bonds: viewerBonds(structure, suppressed),
      selectedBondIds: new Set<string>(),
    })
    return blocked > 0 ? 'partial' : 'deleted'
  },

  updateBioSettings: (patch) => set(normalizedSettingsPatch(patch, get().bioStructure)),

  addBioLayer: (patch = {}) => {
    const id = createLayerId()
    const layer = normalizedLayer({
      ...defaultLayer(id, get().bioLayers.length + 1),
      ...patch,
      id,
    }, get().bioStructure)
    set({ bioLayers: [layer, ...get().bioLayers] })
    return id
  },

  updateBioLayer: (id, patch) => set({
    bioLayers: get().bioLayers.map((layer) => (
      layer.id === id ? normalizedLayer({
        ...layer,
        ...patch,
        id,
      }, get().bioStructure) : layer
    )),
  }),

  editBioLayerStyle: (id, patch) => {
    if (Object.keys(patch).length === 0) return
    set((state) => {
      const layer = state.bioLayers.find((candidate) => candidate.id === id)
      if (!layer) return {}
      const context = styleSnapshotContext(state)
      const frame = state.presentationFrame
      const roundedFrame = Math.round(frame)
      const current = effectiveLayerStyle(layer, frame, context)
      const { materialPresetId: presetId, ...edit } = patch

      if (!hasLayerStyleKeys(layer.styleTrack)) {
        if (roundedFrame > 0) {
          const baselineTrack = recordLayerStyle(
            layer.styleTrack,
            0,
            snapshotBioLayerStyle(current, context),
            createStyleKeyId,
            { presetId: layer.materialPresetId },
          )
          const styleTrack = recordLayerStyle(
            baselineTrack,
            roundedFrame,
            materializeBioLayerStyleEdit(current, edit, context),
            createStyleKeyId,
            { presetId: presetId === undefined ? layer.materialPresetId : presetId },
          )
          return {
            bioLayers: state.bioLayers.map((candidate) => candidate.id === id
              ? normalizedLayer({ ...candidate, styleTrack, id }, state.bioStructure)
              : candidate),
          }
        }
        return {
          bioLayers: state.bioLayers.map((candidate) => candidate.id === id
            ? normalizedLayer({ ...candidate, ...patch, id }, state.bioStructure)
            : candidate),
        }
      }

      const styleTrack = autoKeyLayerStyle(
        layer.styleTrack,
        frame,
        materializeBioLayerStyleEdit(current, edit, context),
        createStyleKeyId,
        { presetId },
      )
      return {
        bioLayers: state.bioLayers.map((candidate) => candidate.id === id
          ? normalizedLayer({ ...candidate, styleTrack, id }, state.bioStructure)
          : candidate),
      }
    })
  },

  recordBioLayerStyle: (id) => set((state) => {
    const layer = state.bioLayers.find((candidate) => candidate.id === id)
    if (!layer) return {}
    const frame = state.presentationFrame
    const context = styleSnapshotContext(state)
    const animated = hasLayerStyleKeys(layer.styleTrack)
    const sameFramePreset = layer.styleTrack?.find((keyframe) => keyframe.frame === Math.round(frame))?.presetId
    const styleTrack = recordLayerStyle(
      layer.styleTrack,
      frame,
      snapshotBioLayerStyle(effectiveLayerStyle(layer, frame, context), context),
      createStyleKeyId,
      { presetId: animated ? sameFramePreset ?? null : layer.materialPresetId },
    )
    return {
      bioLayers: state.bioLayers.map((candidate) => candidate.id === id
        ? normalizedLayer({ ...candidate, styleTrack, id }, state.bioStructure)
        : candidate),
    }
  }),

  removeBioLayer: (id) => set({ bioLayers: get().bioLayers.filter((layer) => layer.id !== id) }),

  duplicateBioLayer: (id) => {
    const sourceIndex = get().bioLayers.findIndex((layer) => layer.id === id)
    if (sourceIndex < 0) return null
    const nextId = createLayerId()
    const source = get().bioLayers[sourceIndex]
    const duplicate = normalizedLayer({
      ...source,
      id: nextId,
      name: `${source.name} copy`,
      color: { ...source.color },
      shading: source.shading ? { ...source.shading } : null,
    }, get().bioStructure)
    const layers = [...get().bioLayers]
    // Insert at sourceIndex + 1 so the copy appears below its source, matching the layer UI.
    layers.splice(sourceIndex + 1, 0, duplicate)
    set({ bioLayers: layers })
    return nextId
  },

  moveBioLayer: (fromIndex, toIndex) => {
    const layers = [...get().bioLayers]
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= layers.length) return
    const destination = Math.round(clamp(toIndex, 0, layers.length - 1))
    if (destination === fromIndex) return
    const [layer] = layers.splice(fromIndex, 1)
    layers.splice(destination, 0, layer)
    set({ bioLayers: layers })
  },
})
