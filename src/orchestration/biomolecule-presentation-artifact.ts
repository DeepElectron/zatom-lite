import type { WorkspaceBiomoleculePresentationArtifactV2 } from '../host/ports'
import {
  isBiomoleculePresentationArtifactV2,
  type BiomoleculeViewerSettings,
} from '../lib/biomolecule/presentation-contract'
import type { BiomoleculeVisualState } from '../lib/biomolecule/presentation-contract'
import type { CrystalStore } from './crystal-store-types'

export interface BiomoleculePresentationStore {
  getState(): CrystalStore
  setState(patch: Partial<CrystalStore>): void
}

export const BIOMOLECULE_PRESENTATION_ARTIFACT_SCHEMA = 'zatom.biomolecule-presentation/v2' as const

function viewerSettings(state: CrystalStore): BiomoleculeViewerSettings {
  return {
    bioShowCartoon: state.bioShowCartoon,
    bioShowSticks: state.bioShowSticks,
    bioShowSpacefill: state.bioShowSpacefill,
    bioShowSurface: state.bioShowSurface,
    bioColorScheme: state.bioColorScheme,
    bioCartoonModel: state.bioCartoonModel,
    bioCartoonQuality: state.bioCartoonQuality,
    bioCartoonSmooth: state.bioCartoonSmooth,
    bioRibbonWidth: state.bioRibbonWidth,
    bioRibbonThickness: state.bioRibbonThickness,
    bioSurfaceSpacing: state.bioSurfaceSpacing,
    bioSurfaceOpacity: state.bioSurfaceOpacity,
    bioPolymerRepresentation: state.bioPolymerRepresentation,
    bioPolymerColor: state.bioPolymerColor,
    bioPolymerScale: state.bioPolymerScale,
    bioShowLigand: state.bioShowLigand,
    bioLigandRepresentation: state.bioLigandRepresentation,
    bioLigandColor: state.bioLigandColor,
    bioLigandScale: state.bioLigandScale,
    bioShowIons: state.bioShowIons,
    bioIonRepresentation: state.bioIonRepresentation,
    bioIonColor: state.bioIonColor,
    bioIonScale: state.bioIonScale,
    bioShowPocket: state.bioShowPocket,
    bioPocketRadius: state.bioPocketRadius,
    bioPocketRepresentation: state.bioPocketRepresentation,
    bioPocketColor: state.bioPocketColor,
    bioPocketScale: state.bioPocketScale,
    bioHideWater: state.bioHideWater,
    bioShowSSBonds: state.bioShowSSBonds,
    bioShowChainLabels: state.bioShowChainLabels,
    bioShowTerminiLabels: state.bioShowTerminiLabels,
    bioShowLigandLabels: state.bioShowLigandLabels,
    bioResidueLabelInterval: state.bioResidueLabelInterval,
    bioLabelSize: state.bioLabelSize,
    bioLabelColor: state.bioLabelColor,
    bioShowInteractions: state.bioShowInteractions,
    bioInteractionHBond: state.bioInteractionHBond,
    bioInteractionSaltBridge: state.bioInteractionSaltBridge,
    bioInteractionPiStacking: state.bioInteractionPiStacking,
    bioInteractionHydrophobic: state.bioInteractionHydrophobic,
    bioInteractionScope: state.bioInteractionScope,
    bioInteractionLabels: state.bioInteractionLabels,
  } satisfies BiomoleculeViewerSettings
}

function visualState(state: CrystalStore): BiomoleculeVisualState {
  return {
    renderStyle: state.renderStyle,
    background: state.background,
    outline: state.outline,
    outlineWidth: state.outlineWidth,
    outlineColor: state.outlineColor,
    atomShininess: state.atomShininess,
    bondBicolor: state.bondBicolor,
    bondColor: state.bondColor,
    elementRadiusVariance: state.elementRadiusVariance,
    showCoordinationPolyhedra: state.showCoordinationPolyhedra,
    polyhedraOpacity: state.polyhedraOpacity,
    polyStyle: state.polyStyle,
    polyColorSource: state.polyColorSource,
    polyElementColors: { ...state.polyElementColors },
    polyColor: state.polyColor,
    showPolyEdges: state.showPolyEdges,
    polyEdgeColor: state.polyEdgeColor,
    polyEdgeOpacity: state.polyEdgeOpacity,
    polySpecular: state.polySpecular,
    polyShininess: state.polyShininess,
    polyFresnel: state.polyFresnel,
    cellColor: state.cellColor,
    cellLineWidth: state.cellLineWidth,
    showCellGrid: state.showCellGrid,
    showCrystalAxes: state.showCrystalAxes,
    ambientIntensity: state.ambientIntensity,
    diffuseIntensity: state.diffuseIntensity,
    specularIntensity: state.specularIntensity,
    rimIntensity: state.rimIntensity,
    viewMode: state.viewMode,
    radiusScale: state.radiusScale,
    bondRadius: state.bondRadius,
    atomScale: state.atomScale,
    bondScale: state.bondScale,
    showBonds: state.showBonds,
    showLattice: state.showLattice,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
    lightFill: state.lightFill,
    lightAzimuth: state.lightAzimuth,
    lightElevation: state.lightElevation,
    sphereDetail: state.sphereDetail,
    elementOverrides: state.elementOverrides,
    autoRotate: state.autoRotate,
  }
}

/** Snapshot the stable presentation state owned by the active biomolecular Asset. */
export function createBiomoleculePresentationArtifact(
  state: CrystalStore,
): WorkspaceBiomoleculePresentationArtifactV2 | undefined {
  if (!state.bioStructure) return undefined
  const artifact = structuredClone({
    schema: BIOMOLECULE_PRESENTATION_ARTIFACT_SCHEMA,
    structure: state.bioStructure,
    layers: state.bioLayers,
    viewer: viewerSettings(state),
    alignmentGhost: state.bioAlignmentGhost,
    visual: visualState(state),
    camera: {
      projection: state.cameraProjection,
      pose: state.savedCameraState,
    },
    presentation: {
      frame: state.presentationFrame,
      activeModel: state.trajectoryCurrentFrame,
      frames: state.presentationFrames,
      fps: state.presentationFps,
      loop: state.presentationLoop,
      cameraKeyframes: state.cameraKeyframes,
      baseStyleKeyframes: state.baseStyleKeyframes,
    },
  })
  if (!isBiomoleculePresentationArtifactV2(artifact)) {
    throw new Error('Cannot create an invalid zatom.biomolecule-presentation/v2 artifact')
  }
  return artifact
}

/**
 * Restore a document paused. Timeline evaluation installs the saved MODEL
 * frame first; the captured live style and concrete camera pose are applied
 * last because they may contain unrecorded edits at that playhead position.
 */
export function restoreBiomoleculePresentationArtifact(
  store: BiomoleculePresentationStore,
  artifact: WorkspaceBiomoleculePresentationArtifactV2,
): void {
  if (!isBiomoleculePresentationArtifactV2(artifact)) {
    throw new Error('Invalid zatom.biomolecule-presentation/v2 artifact')
  }
  const state = store.getState()
  state.pausePresentation()
  state.loadBiomolecule(structuredClone(artifact.structure))
  store.getState().updateBioSettings(structuredClone(artifact.viewer))
  store.setState(structuredClone({
    bioLayers: artifact.layers,
    bioAlignmentGhost: artifact.alignmentGhost,
    presentationFrames: artifact.presentation.frames,
    presentationFps: artifact.presentation.fps,
    presentationPlaying: false,
    presentationIntervalId: null,
    presentationLoop: artifact.presentation.loop,
    cameraKeyframes: artifact.presentation.cameraKeyframes,
    baseStyleKeyframes: artifact.presentation.baseStyleKeyframes,
  }))
  store.getState().setPresentationFrame(artifact.presentation.frame)
  store.setState(structuredClone({
    ...artifact.visual,
    stylePresetId: 'custom',
    cameraProjection: artifact.camera.projection,
    savedCameraState: artifact.camera.pose,
    cameraTarget: null,
    isAnimatingCamera: false,
  }))
  // Re-derive the frame preview after installing the canonical authoring
  // visual. Playback stays on the saved frame without mutating that visual.
  store.getState().setPresentationFrame(artifact.presentation.frame)
  // Keep this after the final setPresentationFrame: that call derives the trajectory
  // frame from the playhead (see presentation-timeline-slice), so the later write wins.
  // The user's explicit MODEL selection is authoritative and must not be overwritten
  // by the playhead-derived model during restoration.
  if (store.getState().trajectoryCurrentFrame !== artifact.presentation.activeModel) {
    store.getState().setTrajectoryFrame(artifact.presentation.activeModel)
  }
}
