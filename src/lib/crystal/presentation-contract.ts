import type { BioCameraKeyframe, BioCameraPose } from '../biomolecule/camera-track'
import type { PresentationStyleKeyframe, PresentationStyleSnapshot } from '../biomolecule/presentation-style-track'
import type { BioLayerShadingOverride } from '../biomolecule/types'
import type { CrystalVisualSettings, RenderStyle } from '../render/crystal-visuals'
import type { CrystalLayer, CrystalLayerColor, CrystalLayerStylePatch } from './semantic-layers'
import type {
  Atom,
  AtomLabelContent,
  AtomLabelPosition,
  AtomLabelScope,
  SupercellParams,
  ViewMode,
} from './types'

export interface CrystalPresentationVisualState extends CrystalVisualSettings {
  renderStyle: RenderStyle
  viewMode: ViewMode
  atomScale: number
  bondScale: number
  elementRadiusVariance: number
  showBonds: boolean
  showLattice: boolean
  showCellGrid: boolean
  showAtomLabels?: boolean
  atomLabelSize?: number
  /**
   * Null or omitted selects a label color from the viewport background.
   */
  atomLabelColor?: string | null
  atomLabelScope?: AtomLabelScope
  atomLabelContent?: AtomLabelContent
  atomLabelOutline?: boolean
  atomLabelPosition?: AtomLabelPosition
  atomLabelGap?: number
  showCoordinationPolyhedra: boolean
  polyhedraOpacity: number
  /** Sets are serialized as arrays at the Asset boundary. */
  polyhedraCentralElements: string[]
  lightAmbient: number | null
  lightKey: number | null
  lightFill: number | null
  lightAzimuth: number | null
  lightElevation: number | null
}

/** Complete stable presentation state owned by one ordinary crystal Asset. */
export interface CrystalPresentationArtifactV2 {
  schema: 'zatom.crystal-presentation/v2'
  layers: CrystalLayer[]
  /** Current live state, including edits not recorded as presentation keys. */
  visual: CrystalPresentationVisualState
  camera: {
    projection: 'perspective' | 'orthographic'
    pose: BioCameraPose | null
  }
  presentation: {
    frame: number
    frames: number
    fps: number
    loop: boolean
    cameraKeyframes: BioCameraKeyframe[]
    baseStyleKeyframes: PresentationStyleKeyframe[]
  }
  /** Canonical unit-cell document retained separately from its materialized supercell. */
  supercell: {
    params: SupercellParams
    unitCellAtoms: Atom[]
    mode: 'normal' | 'fork'
  }
}

const RENDER_STYLES = new Set([
  'vesta', 'flat', 'cel', 'gooch', 'hatch', 'iridescent', 'xray', 'halftone',
  'thermal', 'dither', 'pixel8', 'riso', 'velvet', 'matcap',
])
const VIEW_MODES = new Set(['ball-stick', 'stick', 'hyper-stick', 'space-fill', 'wireframe'])
const CRYSTAL_LAYER_REPRESENTATIONS = new Set([...VIEW_MODES, 'polyhedra', 'surface'])
const POLY_STYLES = new Set([
  'solid-atoms', 'translucent', 'solid', 'glass', 'paper', 'gem', 'hologram', 'neon', 'wireframe',
])
const POLY_COLOR_SOURCES = new Set(['atom', 'element', 'uniform'])
const VOLUME_FIELDS = new Set(['none', 'density', 'bonding', 'elf'])
const ISO_STYLES = new Set([
  'solid', 'translucent', 'glass', 'solidwire', 'wireframe', 'normals', 'points', 'cel', 'gooch',
  'hatch', 'halftone', 'xray', 'iridescent', 'velvet', 'matcap', 'gem', 'hologram', 'bands',
  'dither', 'pixel8', 'riso',
])
const SLICE_STYLES = new Set([
  'smooth', 'banded', 'lines', 'diverging', 'pixel', 'dots', 'topo', 'relief', 'crosshatch', 'crt',
  'blueprint', 'interference', 'marbled', 'stipple', 'neoncontour', 'woodcut', 'negative', 'etching',
])
const SLICE_CLIPS = new Set(['none', 'front', 'back'])
const COLORMAPS = new Set([
  'rainbow', 'viridis', 'coolwarm', 'bwr', 'ironbow', 'grayscale', 'turbo', 'magma', 'plasma',
  'inferno', 'cividis', 'spectral', 'piyg', 'terrain',
])
const SHADING_MODES = new Set([
  'standard', 'flat', 'cel', 'gooch', 'hatch', 'iridescent', 'xray', 'halftone',
  'thermal', 'dither', 'pixel', 'riso', 'velvet', 'matcap',
])
const EASINGS = new Set(['smooth', 'linear', 'hold'])
const HEX = /^#[0-9a-f]{6}$/i

const object = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)
const finite = (value: unknown, minimum = -Infinity, maximum = Infinity): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
)
const integer = (value: unknown, minimum = -Infinity, maximum = Infinity): value is number => (
  finite(value, minimum, maximum) && Number.isInteger(value)
)
const vector3 = (value: unknown): value is [number, number, number] => (
  Array.isArray(value) && value.length === 3 && value.every((entry) => finite(entry))
)
const nullableFinite = (value: unknown, minimum: number, maximum: number): boolean => (
  value === null || finite(value, minimum, maximum)
)
const uniqueStrings = (values: readonly string[]): boolean => new Set(values).size === values.length

function validStoredAtom(value: unknown): value is Atom {
  if (!object(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.element !== 'string'
    || value.element.length === 0
    || !vector3(value.position)
    || (value.cartesian !== undefined && !vector3(value.cartesian))
    || (value.cellIndex !== undefined && (!Array.isArray(value.cellIndex)
      || value.cellIndex.length !== 3
      || !value.cellIndex.every((entry) => integer(entry, 0, 99))))
    || (value.x !== undefined && !finite(value.x))
    || (value.y !== undefined && !finite(value.y))
    || (value.z !== undefined && !finite(value.z))) return false
  if (value.siteIndex !== undefined && !integer(value.siteIndex, 0, 10_000_000)) return false
  return true
}

function validHexMap(value: unknown, maximumEntries = 256): value is Record<string, string> {
  return object(value)
    && Object.keys(value).length <= maximumEntries
    && Object.entries(value).every(([key, color]) => key.length > 0 && typeof color === 'string' && HEX.test(color))
}

function validElementOverrides(value: unknown): boolean {
  return object(value)
    && Object.keys(value).length <= 256
    && Object.entries(value).every(([element, override]) => (
      element.length > 0
      && object(override)
      && typeof override.color === 'string'
      && HEX.test(override.color)
      && finite(override.radius, .1, 3)
    ))
}

function validShading(value: unknown): value is BioLayerShadingOverride {
  if (!object(value)) return false
  const allowed = new Set(['mode', 'ambient', 'diffuse', 'specular', 'shininess', 'rim'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  return (value.mode === undefined || SHADING_MODES.has(value.mode as string))
    && (value.ambient === undefined || finite(value.ambient, 0, 1.5))
    && (value.diffuse === undefined || finite(value.diffuse, 0, 1.5))
    && (value.specular === undefined || finite(value.specular, 0, 1.5))
    && (value.shininess === undefined || finite(value.shininess, 1, 220))
    && (value.rim === undefined || finite(value.rim, 0, 1.5))
}

function validLayerColor(value: unknown): value is CrystalLayerColor {
  return object(value)
    && (value.mode === 'element'
      ? Object.keys(value).length === 1
      : value.mode === 'custom'
        && Object.keys(value).length === 2
        && typeof value.value === 'string'
        && HEX.test(value.value))
}

function validLayerStylePatch(value: unknown): value is CrystalLayerStylePatch {
  if (!object(value)) return false
  const allowed = new Set(['representation', 'color', 'shading', 'visible', 'opacity', 'scale', 'bondScale'])
  if (Object.keys(value).some((key) => !allowed.has(key))) return false
  return (value.representation === undefined || CRYSTAL_LAYER_REPRESENTATIONS.has(value.representation as string))
    && (value.color === undefined || validLayerColor(value.color))
    && (value.shading === undefined || value.shading === null || validShading(value.shading))
    && (value.visible === undefined || typeof value.visible === 'boolean')
    && (value.opacity === undefined || finite(value.opacity, 0, 1))
    && (value.scale === undefined || finite(value.scale, .05, 10))
    && (value.bondScale === undefined || finite(value.bondScale, .05, 10))
}

function validLayer(value: unknown): value is CrystalLayer {
  if (!object(value)
    || typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || typeof value.selection !== 'string'
    || !CRYSTAL_LAYER_REPRESENTATIONS.has(value.representation as string)
    || !validLayerColor(value.color)
    || (value.materialPresetId !== null && typeof value.materialPresetId !== 'string')
    || (value.shading !== null && !validShading(value.shading))
    || typeof value.visible !== 'boolean'
    || !finite(value.opacity, 0, 1)
    || !finite(value.scale, .05, 10)
    || !finite(value.bondScale, .05, 10)
    || typeof value.replaceBase !== 'boolean') return false
  if (value.styleTrack !== undefined && (!Array.isArray(value.styleTrack)
    || value.styleTrack.length > 100_000
    || !value.styleTrack.every((key) => object(key)
      && typeof key.id === 'string'
      && finite(key.frame, 0, 100_000)
      && EASINGS.has(key.easing as string)
      && (key.presetId === undefined || typeof key.presetId === 'string')
      && validLayerStylePatch(key.patch))
    || !uniqueStrings(value.styleTrack.map((key) => key.id)))) return false
  return true
}

function validStyleSnapshot(value: unknown): value is PresentationStyleSnapshot {
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

function validVisual(value: unknown): value is CrystalPresentationVisualState {
  if (!object(value)
    || typeof value.stylePresetId !== 'string'
    || !finite(value.radiusScale, .1, 1.2)
    || !finite(value.bondRadius, .02, .4)
    || !RENDER_STYLES.has(value.renderStyle as string)
    || typeof value.background !== 'string' || !HEX.test(value.background)
    || typeof value.outline !== 'boolean'
    || !finite(value.outlineWidth, .5, 5)
    || typeof value.outlineColor !== 'string' || !HEX.test(value.outlineColor)
    || !integer(value.sphereDetail, 8, 64)
    || !validElementOverrides(value.elementOverrides)
    || !finite(value.atomShininess, 1, 220)
    || typeof value.bondBicolor !== 'boolean'
    || typeof value.bondColor !== 'string' || !HEX.test(value.bondColor)
    || !POLY_STYLES.has(value.polyStyle as string)
    || !POLY_COLOR_SOURCES.has(value.polyColorSource as string)
    || !validHexMap(value.polyElementColors)
    || typeof value.polyColor !== 'string' || !HEX.test(value.polyColor)
    || typeof value.showPolyEdges !== 'boolean'
    || typeof value.polyEdgeColor !== 'string' || !HEX.test(value.polyEdgeColor)
    || !finite(value.polyEdgeOpacity, 0, 1)
    || !finite(value.polySpecular, 0, 1)
    || !finite(value.polyShininess, 1, 100)
    || !finite(value.polyFresnel, 0, 1)
    || typeof value.cellColor !== 'string' || !HEX.test(value.cellColor)
    || !finite(value.cellLineWidth, .5, 4)
    || typeof value.showCrystalAxes !== 'boolean'
    || typeof value.autoRotate !== 'boolean'
    || !finite(value.ambientIntensity, 0, 1.5)
    || !finite(value.diffuseIntensity, 0, 1.5)
    || !finite(value.specularIntensity, 0, 1.5)
    || !finite(value.rimIntensity, 0, 1.5)
    || !VOLUME_FIELDS.has(value.volumeField as string)
    || !integer(value.volumeResolution, 24, 96)
    || !finite(value.isoLevel, .02, .98)
    || !ISO_STYLES.has(value.isoStyle as string)
    || !finite(value.isoOpacity, .05, 1)
    || typeof value.isoColorPos !== 'string' || !HEX.test(value.isoColorPos)
    || typeof value.isoColorNeg !== 'string' || !HEX.test(value.isoColorNeg)
    || typeof value.sliceEnabled !== 'boolean'
    || !integer(value.sliceH, -1000, 1000)
    || !integer(value.sliceK, -1000, 1000)
    || !integer(value.sliceL, -1000, 1000)
    || !finite(value.sliceOffset, .02, .98)
    || !COLORMAPS.has(value.sliceColormap as string)
    || !SLICE_STYLES.has(value.sliceStyle as string)
    || !integer(value.sliceContours, 0, 30)
    || !finite(value.sliceOpacity, .1, 1)
    || !SLICE_CLIPS.has(value.sliceClip as string)
    || typeof value.sliceIsolate !== 'boolean'
    || typeof value.sliceLineColor !== 'string' || !HEX.test(value.sliceLineColor)
    || typeof value.sliceBgColor !== 'string' || !HEX.test(value.sliceBgColor)
    || !VIEW_MODES.has(value.viewMode as string)
    || !finite(value.atomScale, 0, 10)
    || !finite(value.bondScale, 0, 10)
    || !finite(value.elementRadiusVariance, 0, 1)
    || typeof value.showBonds !== 'boolean'
    || typeof value.showLattice !== 'boolean'
    || typeof value.showCellGrid !== 'boolean'
    || (value.showAtomLabels !== undefined && typeof value.showAtomLabels !== 'boolean')
    || (value.atomLabelSize !== undefined && !finite(value.atomLabelSize, .5, 3))
    || (value.atomLabelColor !== undefined && value.atomLabelColor !== null
      && (typeof value.atomLabelColor !== 'string' || !HEX.test(value.atomLabelColor)))
    || (value.atomLabelScope !== undefined && value.atomLabelScope !== 'all' && value.atomLabelScope !== 'selected')
    || (value.atomLabelContent !== undefined && value.atomLabelContent !== 'element' && value.atomLabelContent !== 'number' && value.atomLabelContent !== 'element-number')
    || (value.atomLabelOutline !== undefined && typeof value.atomLabelOutline !== 'boolean')
    || (value.atomLabelPosition !== undefined && value.atomLabelPosition !== 'above' && value.atomLabelPosition !== 'center' && value.atomLabelPosition !== 'below')
    || (value.atomLabelGap !== undefined && !finite(value.atomLabelGap, 0, 2))
    || typeof value.showCoordinationPolyhedra !== 'boolean'
    || !finite(value.polyhedraOpacity, 0, 1)
    || !Array.isArray(value.polyhedraCentralElements)
    || value.polyhedraCentralElements.length > 256
    || !value.polyhedraCentralElements.every((element) => typeof element === 'string' && element.length > 0)
    || !uniqueStrings(value.polyhedraCentralElements)
    || !nullableFinite(value.lightAmbient, 0, 3)
    || !nullableFinite(value.lightKey, 0, 3)
    || !nullableFinite(value.lightFill, 0, 3)
    || !nullableFinite(value.lightAzimuth, 0, 360)
    || !nullableFinite(value.lightElevation, -90, 90)) return false
  return true
}

/** Strict persistence boundary: unsupported schemas and malformed tracks fail closed. */
export function isCrystalPresentationArtifactV2(value: unknown): value is CrystalPresentationArtifactV2 {
  if (!object(value)
    || value.schema !== 'zatom.crystal-presentation/v2'
    || !validVisual(value.visual)
    || !object(value.camera)
    || (value.camera.projection !== 'perspective' && value.camera.projection !== 'orthographic')
    || (value.camera.pose !== null && (!object(value.camera.pose)
      || !vector3(value.camera.pose.position)
      || !vector3(value.camera.pose.target)
      || (value.camera.pose.zoom !== undefined && !finite(value.camera.pose.zoom, .01, 10_000))))
    || !object(value.presentation)
    || !integer(value.presentation.frames, 2, 100_000)
    || !integer(value.presentation.frame, 0, (value.presentation.frames as number) - 1)
    || !integer(value.presentation.fps, 1, 120)
    || typeof value.presentation.loop !== 'boolean'
    || !object(value.supercell)
    || !object(value.supercell.params)
    || !integer(value.supercell.params.nx, 1, 100)
    || !integer(value.supercell.params.ny, 1, 100)
    || !integer(value.supercell.params.nz, 1, 100)
    || !Array.isArray(value.supercell.unitCellAtoms)
    || value.supercell.unitCellAtoms.length > 10_000_000
    || !value.supercell.unitCellAtoms.every(validStoredAtom)
    || !uniqueStrings(value.supercell.unitCellAtoms.map((atom) => atom.id))
    || (value.supercell.mode !== 'normal' && value.supercell.mode !== 'fork')) return false
  if (!Array.isArray(value.layers)
    || value.layers.length > 10_000
    || !value.layers.every((layer) => validLayer(layer))
    || !uniqueStrings(value.layers.map((layer) => layer.id))
    || !Array.isArray(value.presentation.cameraKeyframes)
    || value.presentation.cameraKeyframes.length > 100_000
    || !value.presentation.cameraKeyframes.every((key) => object(key)
      && typeof key.id === 'string'
      && finite(key.frame, 0, 100_000)
      && vector3(key.position)
      && vector3(key.target)
      && (key.zoom === undefined || finite(key.zoom, .01, 10_000))
      && EASINGS.has(key.easing as string))
    || !uniqueStrings(value.presentation.cameraKeyframes.map((key) => key.id))
    || !Array.isArray(value.presentation.baseStyleKeyframes)
    || value.presentation.baseStyleKeyframes.length > 100_000
    || !value.presentation.baseStyleKeyframes.every((key) => object(key)
      && typeof key.id === 'string'
      && finite(key.frame, 0, 100_000)
      && EASINGS.has(key.easing as string)
      && validStyleSnapshot(key.snapshot))
    || !uniqueStrings(value.presentation.baseStyleKeyframes.map((key) => key.id))) return false
  return true
}
