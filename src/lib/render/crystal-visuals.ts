import type { ColormapName } from './crystal-colormaps'
import { getElement } from '../crystal/elements'

export type RenderStyle =
  | 'vesta'
  /**
   * Physically based MeshPhysicalMaterial + IBL + soft shadows. This remains
   * distinct from the analytical, gamma-space VESTA presentation.
   */
  | 'studio'
  | 'flat'
  | 'cel'
  | 'gooch'
  | 'hatch'
  | 'iridescent'
  | 'xray'
  | 'halftone'
  | 'thermal'
  | 'dither'
  | 'pixel8'
  | 'riso'
  | 'velvet'
  | 'matcap'

export type PolyhedronStyle =
  | 'solid-atoms'
  | 'translucent'
  | 'solid'
  | 'glass'
  | 'paper'
  | 'gem'
  | 'hologram'
  | 'neon'
  | 'wireframe'

export type PolyhedronColorSource = 'atom' | 'element' | 'uniform'

export type IsoSurfaceStyle =
  | 'solid'
  | 'translucent'
  | 'glass'
  | 'solidwire'
  | 'wireframe'
  | 'normals'
  | 'points'
  | 'cel'
  | 'gooch'
  | 'hatch'
  | 'halftone'
  | 'xray'
  | 'iridescent'
  | 'velvet'
  | 'matcap'
  | 'gem'
  | 'hologram'
  | 'bands'
  | 'dither'
  | 'pixel8'
  | 'riso'

export type SliceStyle =
  | 'smooth'
  | 'banded'
  | 'lines'
  | 'diverging'
  | 'pixel'
  | 'dots'
  | 'topo'
  | 'relief'
  | 'crosshatch'
  | 'crt'
  | 'blueprint'
  | 'interference'
  | 'marbled'
  | 'stipple'
  | 'neoncontour'
  | 'woodcut'
  | 'negative'
  | 'etching'

export type VolumeFieldType = 'none' | 'density' | 'bonding' | 'elf'
export type SliceClipMode = 'none' | 'front' | 'back'

export interface ElementVisualOverride {
  color: string
  radius: number
}

/** Rendering-only VESTA palette/radii from the supplied visual project. */
export const VESTA_ELEMENT_VISUALS: Readonly<Record<string, ElementVisualOverride>> = {
  H: { color: '#ffcccc', radius: 0.46 },
  C: { color: '#804d29', radius: 0.77 },
  N: { color: '#b0bce6', radius: 0.74 },
  O: { color: '#fe0300', radius: 0.74 },
  Na: { color: '#f9dc3c', radius: 1.02 },
  Al: { color: '#81b2d6', radius: 1.35 },
  Si: { color: '#1b3bfa', radius: 1.18 },
  S: { color: '#fffa00', radius: 1.04 },
  Cl: { color: '#31fc02', radius: 1.32 },
  Ca: { color: '#5b96bf', radius: 1.34 },
  Ti: { color: '#78caff', radius: 1.47 },
  Fe: { color: '#e06633', radius: 1.26 },
  Sr: { color: '#00ff26', radius: 1.44 },
  Sb: { color: '#9e63b5', radius: 1.53 },
  Pb: { color: '#575961', radius: 1.75 },
  I: { color: '#940094', radius: 1.33 },
}

export function getDefaultCrystalElementVisual(element: string): ElementVisualOverride {
  const vesta = VESTA_ELEMENT_VISUALS[element]
  if (vesta) return vesta
  const fallback = getElement(element)
  return {
    color: fallback.atomicNumber === 0 ? '#ff1493' : fallback.color,
    radius: fallback.radius,
  }
}

/**
 * Standard CPK space filling uses van der Waals radii and Jmol/CPK colors.
 * Ball-and-stick retains covalent radii; the larger overlapping vdW spheres
 * represent occupied molecular volume rather than bond connectivity.
 */
export function getCpkElementVisual(element: string): ElementVisualOverride {
  const data = getElement(element)
  return {
    // Unknown elements use the same conspicuous magenta sentinel as VESTA.
    color: data.atomicNumber === 0 ? '#ff1493' : data.color,
    radius: data.radius,
  }
}

export function resolvePolyhedronColor(
  element: string,
  source: PolyhedronColorSource,
  elementOverrides: Readonly<Record<string, ElementVisualOverride>>,
  polyElementColors: Readonly<Record<string, string>>,
  uniformColor: string,
): string {
  if (source === 'uniform') return uniformColor
  if (source === 'element') {
    return polyElementColors[element] ?? getDefaultCrystalElementVisual(element).color
  }
  return elementOverrides[element]?.color ?? getDefaultCrystalElementVisual(element).color
}

export interface CrystalVisualSettings {
  stylePresetId: string
  /** Source `radiusScale`: element radius multiplier used by ball-and-stick atoms. */
  radiusScale: number
  /** Source `bondRadius`: absolute world-space cylinder radius in Å. */
  bondRadius: number
  background: string
  outline: boolean
  outlineWidth: number
  outlineColor: string
  sphereDetail: number
  /** Use van der Waals radii and CPK colors for space-fill only. */
  vanDerWaalsSpaceFill: boolean
  /** Render one smooth implicit surface instead of separate atom spheres. */
  fusedAtomSurface: boolean
  elementOverrides: Record<string, ElementVisualOverride>
  atomShininess: number
  bondBicolor: boolean
  bondColor: string
  polyStyle: PolyhedronStyle
  polyColorSource: PolyhedronColorSource
  polyElementColors: Record<string, string>
  polyColor: string
  showPolyEdges: boolean
  polyEdgeColor: string
  polyEdgeOpacity: number
  polySpecular: number
  polyShininess: number
  polyFresnel: number
  cellColor: string
  cellLineWidth: number
  showCrystalAxes: boolean
  autoRotate: boolean
  ambientIntensity: number
  diffuseIntensity: number
  specularIntensity: number
  rimIntensity: number
  volumeField: VolumeFieldType
  volumeResolution: number
  isoLevel: number
  isoStyle: IsoSurfaceStyle
  isoOpacity: number
  isoColorPos: string
  isoColorNeg: string
  sliceEnabled: boolean
  sliceH: number
  sliceK: number
  sliceL: number
  sliceOffset: number
  sliceColormap: ColormapName
  sliceStyle: SliceStyle
  sliceContours: number
  sliceOpacity: number
  sliceClip: SliceClipMode
  sliceIsolate: boolean
  sliceLineColor: string
  sliceBgColor: string
}

export const DEFAULT_CRYSTAL_VISUAL_SETTINGS: CrystalVisualSettings = {
  stylePresetId: 'vesta',
  radiusScale: 0.45,
  bondRadius: 0.12,
  background: '#ffffff',
  outline: false,
  outlineWidth: 2,
  outlineColor: '#000000',
  sphereDetail: 24,
  // Default false: Existing VESTA views maintain covalent radius, unchanged pixel by pixel.
  vanDerWaalsSpaceFill: false,
  fusedAtomSurface: false,
  elementOverrides: {},
  atomShininess: 100,
  bondBicolor: true,
  bondColor: '#7f7f7f',
  polyStyle: 'translucent',
  polyColorSource: 'atom',
  polyElementColors: {},
  polyColor: '#5588cc',
  showPolyEdges: true,
  polyEdgeColor: '#666666',
  polyEdgeOpacity: 1,
  polySpecular: 0.15,
  polyShininess: 12,
  polyFresnel: 0,
  cellColor: '#000000',
  cellLineWidth: 1.2,
  showCrystalAxes: true,
  autoRotate: false,
  ambientIntensity: 0.55,
  diffuseIntensity: 0.47,
  specularIntensity: 0.6,
  rimIntensity: 0,
  volumeField: 'none',
  volumeResolution: 48,
  isoLevel: 0.32,
  isoStyle: 'translucent',
  isoOpacity: 0.72,
  isoColorPos: '#f5e93c',
  isoColorNeg: '#3cd8dc',
  sliceEnabled: false,
  sliceH: 1,
  sliceK: 1,
  sliceL: 0,
  sliceOffset: 0.5,
  sliceColormap: 'rainbow',
  sliceStyle: 'smooth',
  sliceContours: 0,
  sliceOpacity: 1,
  sliceClip: 'none',
  sliceIsolate: false,
  sliceLineColor: '#26221c',
  sliceBgColor: '#f7f4eb',
}

/** Portable preset schema retained from the source visualizer. */
export interface CrystalStylePresetPatch {
  stylePresetId?: string
  shadingMode?: RenderStyle
  atomStyle?: 'ballstick' | 'spacefill' | 'stick' | 'wireframe'
  /**
  * See CrystalVisualSettings.vanDerWaalsSpaceFill.
  */
  vanDerWaalsSpaceFill?: boolean
  fusedAtomSurface?: boolean
  radiusScale?: number
  outline?: boolean
  outlineWidth?: number
  outlineColor?: string
  background?: string
  cellColor?: string
  showBonds?: boolean
  bondBicolor?: boolean
  bondColor?: string
  showPolyhedra?: boolean
  polyStyle?: PolyhedronStyle
  polyOpacity?: number
  polyColorSource?: PolyhedronColorSource
  polyElementColors?: Record<string, string>
  polyColor?: string
  showPolyEdges?: boolean
  polyEdgeColor?: string
  polyEdgeOpacity?: number
  polySpecular?: number
  polyShininess?: number
  polyFresnel?: number
  ambientIntensity?: number
  diffuseIntensity?: number
  specularIntensity?: number
  atomShininess?: number
  rimIntensity?: number
  lightAzimuth?: number
  lightElevation?: number
  lightAmbient?: number | null
  lightKey?: number | null
  lightFill?: number | null
  lightAmbientOcclusion?: number
}

export interface StylePreset {
  id: string
  label: string
  desc: string
  patch: CrystalStylePresetPatch
}

export const STYLE_PRESET_BASE: Required<CrystalStylePresetPatch> = {
  stylePresetId: 'vesta',
  shadingMode: 'vesta',
  atomStyle: 'ballstick',
  // Baseline off: switching to any non-CPK preset will automatically restore the covalent radius.
  vanDerWaalsSpaceFill: false,
  fusedAtomSurface: false,
  radiusScale: 0.45,
  outline: false,
  outlineWidth: 2,
  outlineColor: '#000000',
  background: '#ffffff',
  cellColor: '#000000',
  showBonds: true,
  bondBicolor: true,
  bondColor: '#7f7f7f',
  showPolyhedra: false,
  polyStyle: 'translucent',
  polyOpacity: 0.84,
  polyColorSource: 'atom',
  polyElementColors: {},
  polyColor: '#5588cc',
  showPolyEdges: true,
  polyEdgeColor: '#666666',
  polyEdgeOpacity: 1,
  polySpecular: 0.15,
  polyShininess: 12,
  polyFresnel: 0,
  ambientIntensity: 0.55,
  diffuseIntensity: 0.47,
  specularIntensity: 0.6,
  atomShininess: 100,
  rimIntensity: 0,
  lightAzimuth: 40,
  lightElevation: 25,
  lightAmbient: null,
  lightKey: null,
  lightFill: null,
  lightAmbientOcclusion: 0.55,
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'vesta',
    label: 'VESTA',
    desc: 'Smooth Lambert shading with broad, soft highlights and no outlines (calibrated via per-pixel sampling).',
    patch: {
      stylePresetId: 'vesta',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      ambientIntensity: 0.55,
      diffuseIntensity: 0.47,
      specularIntensity: 0.6,
      atomShininess: 100,
      lightAzimuth: 40,
      lightElevation: 25,
      bondBicolor: true,
    },
  },
  {
    id: 'studio',
    label: 'Studio (Physical)',
    desc: 'Physically based shading with softbox image lighting, soft contact shadows and ACES tone mapping. Hold still to progressively path-trace true global illumination.',
    patch: {
      stylePresetId: 'studio',
      shadingMode: 'studio',
      atomStyle: 'ballstick',
      outline: false,
      // A neutral-gray backdrop keeps soft contact shadows visible.
      background: '#eceae7',
      cellColor: '#4a4a4a',
      // Retain sensible Blinn-Phong values when switching away from studio.
      specularIntensity: 0.5,
      atomShininess: 100,
      lightAzimuth: 40,
      lightElevation: 30,
      bondBicolor: true,
    },
  },
  {
    id: 'flat',
    label: 'Flat Illustration',
    desc: 'Flat colors with black outlines and bonds (sampled from QuantaBricks).',
    patch: {
      stylePresetId: 'flat',
      shadingMode: 'flat',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 2.4,
      outlineColor: '#000000',
      background: '#ffffff',
      cellColor: '#555555',
      specularIntensity: 0,
      bondBicolor: false,
      bondColor: '#1a1a1a',
    },
  },
  {
    id: 'cel',
    label: 'Cel Shading',
    desc: 'Two-step hard shading with outlines for a cel-animation look.',
    patch: {
      stylePresetId: 'cel',
      shadingMode: 'cel',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 2.0,
      outlineColor: '#000000',
      background: '#ffffff',
      cellColor: '#333333',
      ambientIntensity: 0.68,
      diffuseIntensity: 0.32,
      specularIntensity: 0,
      lightAzimuth: 40,
      lightElevation: 25,
      bondBicolor: true,
    },
  },
  {
    id: 'glossy',
    label: 'Glossy Plastic',
    desc: 'Sharp highlights and deep shadows for a CrystalMaker-style finish.',
    patch: {
      stylePresetId: 'glossy',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      ambientIntensity: 0.36,
      diffuseIntensity: 0.66,
      specularIntensity: 0.95,
      atomShininess: 100,
      lightAzimuth: 35,
      lightElevation: 35,
      bondBicolor: true,
    },
  },
  // Quantum-chemistry figure presets: restrained matte, vivid schematic, and
  // physically lit cover-style presentation.
  {
    id: 'qc-soft',
    label: 'QC Soft (orbital figures)',
    desc: 'Low-contrast matte with a large ambient term so isosurfaces read cleanly over the atoms.',
    patch: {
      stylePresetId: 'qc-soft',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#666666',
      radiusScale: 0.38,
      ambientIntensity: 0.7,
      diffuseIntensity: 0.38,
      specularIntensity: 0.12,
      atomShininess: 24,
      rimIntensity: 0.08,
      lightAzimuth: 45,
      lightElevation: 40,
      lightAmbientOcclusion: 0.3,
      bondBicolor: true,
    },
  },
  {
    id: 'qc-vivid',
    label: 'QC Vivid (mechanism figures)',
    desc: 'White background, saturated colours and a tight specular highlight for crisp reaction-scheme figures.',
    patch: {
      stylePresetId: 'qc-vivid',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      radiusScale: 0.5,
      ambientIntensity: 0.42,
      diffuseIntensity: 0.62,
      specularIntensity: 1.0,
      atomShininess: 140,
      lightAzimuth: 30,
      lightElevation: 45,
      lightAmbientOcclusion: 0.4,
      bondBicolor: true,
    },
  },
  {
    id: 'qc-fourlight',
    label: 'QC Four-Light (cover figures)',
    desc: 'Physically based shading with a four-light rig: ambient, key, fill and full-strength contact shadows.',
    patch: {
      stylePresetId: 'qc-fourlight',
      shadingMode: 'studio',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#4a4a4a',
      radiusScale: 0.45,
      specularIntensity: 0.6,
      atomShininess: 100,
      lightAzimuth: 35,
      lightElevation: 35,
      lightAmbient: 0.7,
      lightKey: 1.3,
      lightFill: 0.9,
      lightAmbientOcclusion: 1.0,
      bondBicolor: true,
    },
  },
  {
    id: 'matte',
    label: 'Matte Clay',
    desc: 'Soft gradients with no specular highlights for a clay-model finish.',
    patch: {
      stylePresetId: 'matte',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#f5f3ee',
      cellColor: '#4a4a4a',
      ambientIntensity: 0.62,
      diffuseIntensity: 0.4,
      specularIntensity: 0,
      lightAzimuth: 40,
      lightElevation: 30,
      bondBicolor: true,
    },
  },
  {
    id: 'metal',
    label: 'Polished Metal',
    desc: 'Low ambient light with strong, broad highlights for a polished-metal finish.',
    patch: {
      stylePresetId: 'metal',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      ambientIntensity: 0.28,
      diffuseIntensity: 0.6,
      specularIntensity: 1.0,
      atomShininess: 34,
      lightAzimuth: 30,
      lightElevation: 30,
      bondBicolor: true,
    },
  },
  {
    id: 'dark',
    label: 'Dark Presentation',
    desc: 'A dark background with VESTA shading, designed for presentation slides.',
    patch: {
      stylePresetId: 'dark',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#101014',
      cellColor: '#d8d8dc',
      ambientIntensity: 0.5,
      diffuseIntensity: 0.56,
      specularIntensity: 0.85,
      atomShininess: 100,
      lightAzimuth: 35,
      lightElevation: 30,
      bondBicolor: true,
    },
  },
  {
    id: 'print',
    label: 'Publication Line Art',
    desc: 'High ambient light, fine outlines, and gray bonds for publication-ready figures.',
    patch: {
      stylePresetId: 'print',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.2,
      outlineColor: '#000000',
      background: '#ffffff',
      cellColor: '#000000',
      ambientIntensity: 0.78,
      diffuseIntensity: 0.22,
      specularIntensity: 0,
      bondBicolor: false,
      bondColor: '#3c3c3c',
    },
  },
  {
    id: 'cpk',
    label: 'CPK Spacefill',
    desc: 'A matte space-filling model based on van der Waals radii.',
    patch: {
      stylePresetId: 'cpk',
      // studio instead of vesta: readability of CPK space-filling comes from volume and contact shading,
      // VESTA's flat fixed pipeline coloring deliberately has no shadows, which will make the interpenetrating spheres become a lump of color.
      shadingMode: 'studio',
      atomStyle: 'spacefill',
      // A CPK space-fill preset must use van der Waals radii rather than the
      // covalent radii inherited by the default VESTA-style presentation.
      vanDerWaalsSpaceFill: true,
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      ambientIntensity: 0.55,
      diffuseIntensity: 0.47,
      specularIntensity: 0.35,
      atomShininess: 60,
      bondBicolor: true,
    },
  },
  {
    id: 'pressed-space-fill',
    label: 'Pressed Space Fill',
    desc: 'Compact CPK spheres with pressure-deformed contact caps and no interpenetration.',
    patch: {
      stylePresetId: 'pressed-space-fill',
      shadingMode: 'studio',
      atomStyle: 'spacefill',
      vanDerWaalsSpaceFill: true,
      fusedAtomSurface: true,
      showBonds: false,
      outline: false,
      background: '#ffffff',
      cellColor: '#3f3f3f',
      ambientIntensity: 0.4,
      diffuseIntensity: 0.68,
      specularIntensity: 0.52,
      atomShininess: 76,
      lightAmbient: 0.8,
      lightKey: 1.04,
      lightFill: 0.66,
      lightAmbientOcclusion: 0.54,
    },
  },
  {
    id: 'textbook',
    label: 'Textbook Polyhedra',
    desc: 'Translucent coordination polyhedra with VESTA shading for classic crystallography figures.',
    patch: {
      stylePresetId: 'textbook',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#ffffff',
      cellColor: '#000000',
      showPolyhedra: true,
      polyStyle: 'translucent',
      polyOpacity: 0.84,
      showPolyEdges: true,
      polyEdgeColor: '#666666',
      ambientIntensity: 0.55,
      diffuseIntensity: 0.47,
      specularIntensity: 0.6,
      atomShininess: 100,
      bondBicolor: true,
    },
  },
  {
    id: 'glasspoly',
    label: 'Glass Lattice',
    desc: 'Transparent polyhedra with Fresnel edge glow for an ice-crystal finish.',
    patch: {
      stylePresetId: 'glasspoly',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      radiusScale: 0.3,
      outline: false,
      background: '#eef3f8',
      cellColor: '#3a4a5a',
      showPolyhedra: true,
      polyStyle: 'glass',
      polyOpacity: 0.38,
      polyFresnel: 0.55,
      showPolyEdges: true,
      polyEdgeColor: '#8aa4bd',
      polySpecular: 0.5,
      ambientIntensity: 0.55,
      diffuseIntensity: 0.42,
      specularIntensity: 0.55,
      bondBicolor: true,
    },
  },
  {
    id: 'paperpoly',
    label: 'Papercraft Facets',
    desc: 'Outlined origami facets with two-step shading for a low-poly paper-art look.',
    patch: {
      stylePresetId: 'paperpoly',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      radiusScale: 0.32,
      outline: true,
      outlineWidth: 1.6,
      outlineColor: '#2b2b2b',
      background: '#faf7f0',
      cellColor: '#6b6156',
      showPolyhedra: true,
      polyStyle: 'paper',
      polyOpacity: 1,
      showPolyEdges: true,
      polyEdgeColor: '#4a443c',
      ambientIntensity: 0.62,
      diffuseIntensity: 0.38,
      specularIntensity: 0,
      bondBicolor: false,
      bondColor: '#4a443c',
    },
  },
  {
    id: 'blueprint',
    label: 'Engineering Blueprint',
    desc: 'A deep-blue background, wireframe structure, and light-blue unit cell for a technical-drawing look.',
    patch: {
      stylePresetId: 'blueprint',
      shadingMode: 'vesta',
      atomStyle: 'wireframe',
      outline: false,
      background: '#10233f',
      cellColor: '#9cc3ee',
      showPolyhedra: true,
      polyStyle: 'wireframe',
      polyEdgeColor: '#7fb2e8',
      showPolyEdges: true,
      bondBicolor: true,
    },
  },
  {
    id: 'neon',
    label: 'Neon Outline',
    desc: 'Flat colors with white outlines on a dark background for a neon-poster look.',
    patch: {
      stylePresetId: 'neon',
      shadingMode: 'flat',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.8,
      outlineColor: '#f2f2f2',
      background: '#0b0b12',
      cellColor: '#e8e8f0',
      specularIntensity: 0,
      bondBicolor: true,
    },
  },
  {
    id: 'chalk',
    label: 'Chalkboard',
    desc: 'Cel shading, white outlines, and white bonds on a deep-green board for a hand-drawn classroom look.',
    patch: {
      stylePresetId: 'chalk',
      shadingMode: 'cel',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.6,
      outlineColor: '#f0ede4',
      background: '#22352c',
      cellColor: '#e5e1d4',
      ambientIntensity: 0.66,
      diffuseIntensity: 0.3,
      specularIntensity: 0,
      bondBicolor: false,
      bondColor: '#e5e1d4',
    },
  },
  // ============ Illustrative and game-inspired styles ============
  {
    id: 'gooch',
    label: 'Gooch Illustration',
    desc: "Cool-to-warm shading with blue shadows and warm highlights, inspired by the SIGGRAPH '98 technique.",
    patch: {
      stylePresetId: 'gooch',
      shadingMode: 'gooch',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.0,
      outlineColor: '#1c2733',
      background: '#f2f0eb',
      cellColor: '#39424e',
      specularIntensity: 0.5,
      bondBicolor: true,
    },
  },
  {
    id: 'hatch',
    label: 'Pen Sketch',
    desc: 'Screen-space cross-hatching with denser strokes in shadow, evoking engraving and pencil sketching.',
    patch: {
      stylePresetId: 'hatch',
      shadingMode: 'hatch',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.4,
      outlineColor: '#221f1c',
      background: '#f7f4ec',
      cellColor: '#3a352e',
      ambientIntensity: 0.35,
      diffuseIntensity: 0.62,
      bondBicolor: false,
      bondColor: '#403a33',
    },
  },
  {
    id: 'manga',
    label: 'Comic Halftone',
    desc: 'A screen-space dot pattern with larger shadow dots, inspired by comic and halftone printing.',
    patch: {
      stylePresetId: 'manga',
      shadingMode: 'halftone',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 2.2,
      outlineColor: '#111111',
      background: '#ffffff',
      cellColor: '#222222',
      ambientIntensity: 0.5,
      diffuseIntensity: 0.5,
      bondBicolor: false,
      bondColor: '#222222',
    },
  },
  {
    id: 'pearl',
    label: 'Iridescent Pearl',
    desc: 'View-dependent hue shifts with Fresnel highlights, inspired by automotive paint and mother-of-pearl.',
    patch: {
      stylePresetId: 'pearl',
      shadingMode: 'iridescent',
      atomStyle: 'ballstick',
      outline: false,
      background: '#16161e',
      cellColor: '#b8b8cc',
      ambientIntensity: 0.42,
      diffuseIntensity: 0.5,
      bondBicolor: true,
    },
  },
  {
    id: 'xray',
    label: 'X-ray Hologram',
    desc: 'Inverse-Fresnel transparency with solid edges and a fading center for holographic and medical-imaging visuals.',
    patch: {
      stylePresetId: 'xray',
      shadingMode: 'xray',
      atomStyle: 'ballstick',
      outline: false,
      background: '#04090f',
      cellColor: '#3e6a8a',
      showBonds: true,
      bondBicolor: true,
      showPolyhedra: false,
    },
  },
  {
    id: 'thermal',
    label: 'Thermal Imaging',
    desc: 'Luminance mapped to an iron-red thermal palette, inspired by infrared imaging.',
    patch: {
      stylePresetId: 'thermal',
      shadingMode: 'thermal',
      atomStyle: 'ballstick',
      outline: false,
      background: '#050208',
      cellColor: '#7a4a9a',
      ambientIntensity: 0.5,
      diffuseIntensity: 0.55,
      bondBicolor: true,
    },
  },
  {
    id: 'toy',
    label: 'Vinyl Toy',
    desc: 'Cel shading, strong Fresnel glow, and a candy-colored background for a collectible-toy look.',
    patch: {
      stylePresetId: 'toy',
      shadingMode: 'cel',
      atomStyle: 'ballstick',
      radiusScale: 0.52,
      outline: true,
      outlineWidth: 1.2,
      outlineColor: '#3d2b3d',
      background: '#ffe9f0',
      cellColor: '#8a6080',
      ambientIntensity: 0.72,
      diffuseIntensity: 0.26,
      specularIntensity: 0,
      rimIntensity: 0.3,
      bondBicolor: true,
    },
  },
  {
    id: 'tron',
    label: 'Deep-Space Rim Light',
    desc: 'Near-black materials with strong edge glow for a sci-fi game-lobby aesthetic.',
    patch: {
      stylePresetId: 'tron',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: false,
      background: '#020208',
      cellColor: '#40e0ff',
      ambientIntensity: 0.12,
      diffuseIntensity: 0.2,
      specularIntensity: 0.45,
      atomShininess: 80,
      rimIntensity: 0.85,
      bondBicolor: true,
    },
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    desc: 'Soft, low-contrast gradients with fine gray-brown outlines on warm paper.',
    patch: {
      stylePresetId: 'watercolor',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 0.9,
      outlineColor: '#8c8478',
      background: '#fbf8f1',
      cellColor: '#9a9184',
      ambientIntensity: 0.8,
      diffuseIntensity: 0.18,
      specularIntensity: 0,
      bondBicolor: true,
    },
  },
  {
    id: 'crt',
    label: 'CRT Terminal',
    desc: 'Phosphor-green wireframes on pure black, inspired by 1980s oscilloscopes and computer terminals.',
    patch: {
      stylePresetId: 'crt',
      shadingMode: 'vesta',
      atomStyle: 'wireframe',
      outline: false,
      background: '#010401',
      cellColor: '#33ff66',
      showPolyhedra: false,
      bondBicolor: false,
      bondColor: '#33ff66',
    },
  },
  {
    id: 'goochpoly',
    label: 'Gooch Polyhedra',
    desc: 'Gooch shading applied to coordination polyhedra for cool-to-warm structural illustrations.',
    patch: {
      stylePresetId: 'goochpoly',
      shadingMode: 'gooch',
      atomStyle: 'ballstick',
      radiusScale: 0.3,
      outline: true,
      outlineWidth: 1.0,
      outlineColor: '#1c2733',
      background: '#f2f0eb',
      cellColor: '#39424e',
      showPolyhedra: true,
      polyStyle: 'translucent',
      polyOpacity: 0.92,
      showPolyEdges: true,
      polyEdgeColor: '#2e3946',
      bondBicolor: true,
    },
  },
  {
    id: 'holopoly',
    label: 'Holographic Polyhedra',
    desc: 'X-ray atoms, scan-lined polyhedra, and cyan edges for a holographic display-table look.',
    patch: {
      stylePresetId: 'holopoly',
      shadingMode: 'xray',
      atomStyle: 'ballstick',
      outline: false,
      background: '#03070d',
      cellColor: '#48c8e8',
      showPolyhedra: true,
      polyStyle: 'hologram',
      polyOpacity: 0.3,
      showPolyEdges: true,
      polyEdgeColor: '#48c8e8',
      bondBicolor: true,
    },
  },
  // ============ Polyhedron exclusive style ============
  {
    id: 'gempoly',
    label: 'Faceted Gem',
    desc: 'Quantized facet normals, starburst highlights, and Fresnel fire for a gemstone-rendering look.',
    patch: {
      stylePresetId: 'gempoly',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      radiusScale: 0.26,
      outline: false,
      background: '#14101c',
      cellColor: '#9c8cc0',
      showPolyhedra: true,
      polyStyle: 'gem',
      polyOpacity: 1,
      showPolyEdges: true,
      polyEdgeColor: '#e8dff5',
      ambientIntensity: 0.4,
      diffuseIntensity: 0.62,
      specularIntensity: 0.7,
      bondBicolor: true,
    },
  },
  {
    id: 'neonpoly',
    label: 'Neon Lattice',
    desc: 'Glowing polyhedron edges on a dark background for a synthwave, cyberpunk grid aesthetic.',
    patch: {
      stylePresetId: 'neonpoly',
      shadingMode: 'flat',
      atomStyle: 'ballstick',
      radiusScale: 0.24,
      outline: true,
      outlineWidth: 1.2,
      outlineColor: '#08060f',
      background: '#0d0918',
      cellColor: '#ff4fd8',
      showPolyhedra: true,
      polyStyle: 'neon',
      polyOpacity: 0.06,
      polyEdgeOpacity: 0.95,
      showPolyEdges: true,
      bondBicolor: true,
    },
  },
  {
    id: 'gempaper',
    label: 'Amber Specimen',
    desc: 'Atoms enclosed by amber glass polyhedra, resembling a cast-resin specimen.',
    patch: {
      stylePresetId: 'gempaper',
      shadingMode: 'vesta',
      atomStyle: 'ballstick',
      radiusScale: 0.34,
      outline: false,
      background: '#f6efe2',
      cellColor: '#7a6242',
      showPolyhedra: true,
      polyStyle: 'glass',
      polyOpacity: 0.5,
      polyColorSource: 'uniform',
      polyColor: '#d89a30',
      polyFresnel: 0.55,
      showPolyEdges: true,
      polyEdgeColor: '#a4762e',
      ambientIntensity: 0.6,
      diffuseIntensity: 0.42,
      specularIntensity: 0.5,
      bondBicolor: true,
    },
  },
  {
    id: 'thermalpoly',
    label: 'Thermal Polyhedra',
    desc: 'Thermal-camera shading applied to polyhedra for energy-density visualization.',
    patch: {
      stylePresetId: 'thermalpoly',
      shadingMode: 'thermal',
      atomStyle: 'ballstick',
      radiusScale: 0.3,
      outline: false,
      background: '#050208',
      cellColor: '#7a4a9a',
      showPolyhedra: true,
      polyStyle: 'translucent',
      polyOpacity: 0.85,
      showPolyEdges: true,
      polyEdgeColor: '#ffb347',
      ambientIntensity: 0.5,
      diffuseIntensity: 0.55,
      bondBicolor: true,
    },
  },
  // ============ Retro Games / Print Media Style ============
  {
    id: 'obradinn',
    label: '1-bit Dither',
    desc: 'Pure black-and-white Bayer dithering, inspired by Return of the Obra Dinn and early Macintosh graphics.',
    patch: {
      stylePresetId: 'obradinn',
      shadingMode: 'dither',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.6,
      outlineColor: '#121217',
      background: '#edeae0',
      cellColor: '#1a1a20',
      ambientIntensity: 0.42,
      diffuseIntensity: 0.62,
      bondBicolor: false,
      bondColor: '#2a2a30',
    },
  },
  {
    id: 'pixel8',
    label: '8-bit Pixel',
    desc: 'Screen-space pixelation with four shading levels and a five-color retro console palette.',
    patch: {
      stylePresetId: 'pixel8',
      shadingMode: 'pixel8',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 2.0,
      outlineColor: '#1c1c2e',
      background: '#c8d8c0',
      cellColor: '#30304a',
      ambientIntensity: 0.5,
      diffuseIntensity: 0.55,
      bondBicolor: true,
    },
  },
  {
    id: 'riso',
    label: 'Risograph Print',
    desc: 'Grainy two-color ink separation on warm paper, inspired by independent Risograph magazines.',
    patch: {
      stylePresetId: 'riso',
      shadingMode: 'riso',
      atomStyle: 'ballstick',
      outline: true,
      outlineWidth: 1.1,
      outlineColor: '#332f28',
      background: '#f4f0e4',
      cellColor: '#4a443a',
      ambientIntensity: 0.45,
      diffuseIntensity: 0.6,
      bondBicolor: false,
      bondColor: '#3f3a32',
    },
  },
  {
    id: 'velvet',
    label: 'Velvet',
    desc: 'An inverse-Fresnel fabric response with a dark center and bright edges, evoking velvet or moss.',
    patch: {
      stylePresetId: 'velvet',
      shadingMode: 'velvet',
      atomStyle: 'ballstick',
      radiusScale: 0.5,
      outline: false,
      background: '#1c1720',
      cellColor: '#8d8395',
      ambientIntensity: 0.55,
      diffuseIntensity: 0.45,
      bondBicolor: true,
    },
  },
  {
    id: 'clay',
    label: 'Studio Clay',
    desc: 'Procedural Matcap lighting with a key light, lower bounce card, and top highlight for a sculpting-studio look.',
    patch: {
      stylePresetId: 'clay',
      shadingMode: 'matcap',
      atomStyle: 'ballstick',
      outline: false,
      background: '#3d3d42',
      cellColor: '#c8c8cc',
      bondBicolor: true,
    },
  },
  {
    id: 'risopoly',
    label: 'Riso Polyhedra',
    desc: 'Grainy ink shading on polyhedra with papercraft atoms for a printed-poster aesthetic.',
    patch: {
      stylePresetId: 'risopoly',
      shadingMode: 'riso',
      atomStyle: 'ballstick',
      radiusScale: 0.3,
      outline: true,
      outlineWidth: 1.1,
      outlineColor: '#332f28',
      background: '#f4f0e4',
      cellColor: '#4a443a',
      showPolyhedra: true,
      polyStyle: 'translucent',
      polyOpacity: 0.95,
      showPolyEdges: true,
      polyEdgeColor: '#3f3a32',
      ambientIntensity: 0.45,
      diffuseIntensity: 0.6,
      bondBicolor: false,
      bondColor: '#3f3a32',
    },
  },
]
