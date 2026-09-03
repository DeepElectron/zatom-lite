import type { WorkspaceCrystalPresentationArtifactV2 } from '../host/ports'
import {
  isCrystalPresentationArtifactV2,
  type CrystalPresentationVisualState,
} from '../lib/crystal/presentation-contract'
import type { CrystalVisualSettings } from '../lib/render/crystal-visuals'
import type { CrystalStore } from './crystal-store-types'

export interface CrystalPresentationStore {
  getState(): CrystalStore
  setState(patch: Partial<CrystalStore>): void
}

export const CRYSTAL_PRESENTATION_ARTIFACT_SCHEMA = 'zatom.crystal-presentation/v2' as const

const CRYSTAL_VISUAL_KEYS = [
  'stylePresetId', 'radiusScale', 'bondRadius', 'background', 'outline', 'outlineWidth', 'outlineColor',
  'sphereDetail', 'vanDerWaalsSpaceFill', 'fusedAtomSurface', 'elementOverrides', 'atomShininess', 'bondBicolor', 'bondColor',
  'polyStyle', 'polyColorSource', 'polyElementColors', 'polyColor', 'showPolyEdges',
  'polyEdgeColor', 'polyEdgeOpacity', 'polySpecular', 'polyShininess', 'polyFresnel',
  'cellColor', 'cellLineWidth', 'showCrystalAxes', 'autoRotate',
  'ambientIntensity', 'diffuseIntensity', 'specularIntensity', 'rimIntensity',
  'volumeField', 'volumeResolution', 'isoLevel', 'isoStyle', 'isoOpacity',
  'isoColorPos', 'isoColorNeg', 'sliceEnabled', 'sliceH', 'sliceK', 'sliceL',
  'sliceOffset', 'sliceColormap', 'sliceStyle', 'sliceContours', 'sliceOpacity',
  'sliceClip', 'sliceIsolate', 'sliceLineColor', 'sliceBgColor',
] as const satisfies readonly (keyof CrystalVisualSettings)[]

export const CRYSTAL_PRESENTATION_PERSISTED_KEYS = [
  'crystalLayers', 'presentationFrame', 'presentationFrames', 'presentationFps',
  'presentationLoop', 'cameraKeyframes', 'baseStyleKeyframes',
  'renderStyle', ...CRYSTAL_VISUAL_KEYS,
  'viewMode', 'atomScale', 'bondScale', 'elementRadiusVariance', 'showBonds', 'showLattice', 'showCellGrid',
  'showAtomLabels', 'atomLabelSize', 'atomLabelColor', 'atomLabelScope', 'atomLabelContent',
  'atomLabelOutline', 'atomLabelPosition', 'atomLabelGap',
  'showCoordinationPolyhedra', 'polyhedraOpacity', 'polyhedraCentralElements',
  'lightAmbient', 'lightKey', 'lightFill', 'lightAzimuth', 'lightElevation',
  'cameraProjection', 'savedCameraState',
  'supercellParams', 'unitCellAtoms', 'supercellMode',
] as const satisfies readonly (keyof CrystalStore)[]

function visualState(state: CrystalStore): CrystalPresentationVisualState {
  const visual = {} as Pick<CrystalVisualSettings, (typeof CRYSTAL_VISUAL_KEYS)[number]>
  for (const key of CRYSTAL_VISUAL_KEYS) {
    ;(visual as Record<string, unknown>)[key] = state[key]
  }
  return {
    ...visual,
    renderStyle: state.renderStyle,
    viewMode: state.viewMode,
    atomScale: state.atomScale,
    bondScale: state.bondScale,
    elementRadiusVariance: state.elementRadiusVariance,
    showBonds: state.showBonds,
    showLattice: state.showLattice,
    showCellGrid: state.showCellGrid,
    showAtomLabels: state.showAtomLabels,
    atomLabelSize: state.atomLabelSize,
    atomLabelColor: state.atomLabelColor,
    atomLabelScope: state.atomLabelScope,
    atomLabelContent: state.atomLabelContent,
    atomLabelOutline: state.atomLabelOutline,
    atomLabelPosition: state.atomLabelPosition,
    atomLabelGap: state.atomLabelGap,
    showCoordinationPolyhedra: state.showCoordinationPolyhedra,
    polyhedraOpacity: state.polyhedraOpacity,
    polyhedraCentralElements: [...state.polyhedraCentralElements].sort(),
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
    lightFill: state.lightFill,
    lightAzimuth: state.lightAzimuth,
    lightElevation: state.lightElevation,
  }
}

/** Snapshot ordinary-crystal presentation without biomolecular topology or transient UI state. */
export function createCrystalPresentationArtifact(
  state: CrystalStore,
): WorkspaceCrystalPresentationArtifactV2 | undefined {
  if (state.bioStructure || state.atoms.length === 0) return undefined
  const artifact = structuredClone({
    schema: CRYSTAL_PRESENTATION_ARTIFACT_SCHEMA,
    layers: state.crystalLayers,
    visual: visualState(state),
    camera: {
      projection: state.cameraProjection,
      pose: state.savedCameraState,
    },
    presentation: {
      frame: state.presentationFrame,
      frames: state.presentationFrames,
      fps: state.presentationFps,
      loop: state.presentationLoop,
      cameraKeyframes: state.cameraKeyframes,
      baseStyleKeyframes: state.baseStyleKeyframes,
    },
    supercell: {
      params: state.supercellParams,
      unitCellAtoms: state.unitCellAtoms,
      mode: state.supercellMode,
    },
  })
  if (!isCrystalPresentationArtifactV2(artifact)) {
    throw new Error('Cannot create an invalid zatom.crystal-presentation/v2 artifact')
  }
  return artifact
}

/**
 * Restore paused. Track evaluation runs first; the captured live visual and
 * concrete camera pose are applied last so unrecorded edits remain authoritative.
 */
export function restoreCrystalPresentationArtifact(
  store: CrystalPresentationStore,
  artifact: WorkspaceCrystalPresentationArtifactV2,
): void {
  if (!isCrystalPresentationArtifactV2(artifact)) {
    throw new Error('Invalid zatom.crystal-presentation/v2 artifact')
  }
  store.getState().pausePresentation()
  const unitCellAtoms = structuredClone(artifact.supercell.unitCellAtoms)
  store.setState(structuredClone({
    crystalLayers: artifact.layers,
    presentationFrames: artifact.presentation.frames,
    presentationFps: artifact.presentation.fps,
    presentationPlaying: false,
    presentationIntervalId: null,
    presentationLoop: artifact.presentation.loop,
    cameraKeyframes: artifact.presentation.cameraKeyframes,
    baseStyleKeyframes: artifact.presentation.baseStyleKeyframes,
    supercellParams: artifact.supercell.params,
    unitCellAtoms,
    supercellMode: artifact.supercell.mode,
  }))
  store.getState().setPresentationFrame(artifact.presentation.frame)

  const {
    polyhedraCentralElements,
    showAtomLabels = true,
    atomLabelSize = .8,
    // Older artifacts omit this field; null follows the background instead of forcing near-black.
    atomLabelColor = null,
    atomLabelScope = 'selected',
    atomLabelContent = 'element-number',
    atomLabelOutline = true,
    atomLabelPosition = 'center',
    atomLabelGap = 0,
    ...visual
  } = structuredClone(artifact.visual)
  store.setState({
    ...visual,
    showAtomLabels,
    atomLabelSize,
    atomLabelColor,
    atomLabelScope,
    atomLabelContent,
    atomLabelOutline,
    atomLabelPosition,
    atomLabelGap,
    polyhedraCentralElements: new Set(polyhedraCentralElements),
    cameraProjection: artifact.camera.projection,
    savedCameraState: structuredClone(artifact.camera.pose),
    cameraTarget: null,
    isAnimatingCamera: false,
  })
  // Re-derive the frame preview after installing the canonical authoring
  // visual. Playback stays on the saved frame without mutating that visual.
  store.getState().setPresentationFrame(artifact.presentation.frame)
}

export function crystalPresentationChanged(current: CrystalStore, previous: CrystalStore): boolean {
  return CRYSTAL_PRESENTATION_PERSISTED_KEYS.some((key) => current[key] !== previous[key])
}
