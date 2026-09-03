import type { BioLayerShadingOverride, BioShadingMode, BioStyleKeyframe } from './types'
import type { CrystalLayerStyleKeyframe } from '../crystal/semantic-layers'

export interface BioLayerMaterialPreset {
  id: string
  label: string
  description: string
  shading: Required<BioLayerShadingOverride>
  opacity: number
}

const shading = (
  mode: BioShadingMode,
  ambient: number,
  diffuse: number,
  specular: number,
  shininess: number,
  rim: number,
): Required<BioLayerShadingOverride> => ({ mode, ambient, diffuse, specular, shininess, rim })

/** Per-layer material packs; they never mutate the viewport background or chrome. */
export const BIO_LAYER_MATERIAL_PRESETS: readonly BioLayerMaterialPreset[] = [
  { id: 'vesta-gloss', label: 'VESTA Gloss', description: 'Soft diffuse light with a broad publication-style highlight.', shading: shading('standard', .55, .47, .6, 100, 0), opacity: 1 },
  { id: 'clay', label: 'Matte Clay', description: 'Soft form with no specular highlight.', shading: shading('standard', .62, .4, 0, 30, 0), opacity: 1 },
  { id: 'metal', label: 'Polished Metal', description: 'Low ambient light and a strong broad highlight.', shading: shading('standard', .28, .6, 1, 34, .12), opacity: 1 },
  { id: 'toy', label: 'Vinyl Toy', description: 'Sharp highlight with a soft Fresnel rim.', shading: shading('standard', .45, .55, .9, 90, .45), opacity: 1 },
  { id: 'toon', label: 'Cel Shaded', description: 'Discrete animation-like light bands.', shading: shading('cel', .68, .32, 0, 30, 0), opacity: 1 },
  { id: 'flat-ink', label: 'Flat Ink', description: 'Flat information-graphic colour.', shading: shading('flat', .8, .2, 0, 30, 0), opacity: 1 },
  { id: 'gooch', label: 'Gooch Illustration', description: 'Cool shadows and warm highlights.', shading: shading('gooch', .5, .5, .5, 60, 0), opacity: 1 },
  { id: 'sketch', label: 'Pen Sketch', description: 'Screen-space cross-hatching in shaded regions.', shading: shading('hatch', .6, .4, 0, 30, 0), opacity: 1 },
  { id: 'halftone', label: 'Halftone Print', description: 'Comic-print dot screening.', shading: shading('halftone', .6, .4, 0, 30, 0), opacity: 1 },
  { id: 'ghost', label: 'X-ray Ghost', description: 'Transparent Fresnel silhouette for internal context.', shading: shading('xray', .5, .4, 0, 30, .8), opacity: .45 },
  { id: 'pearl', label: 'Iridescent Pearl', description: 'View-dependent thin-film colour shift.', shading: shading('iridescent', .5, .5, .8, 60, .35), opacity: 1 },
  { id: 'velvet', label: 'Soft Velvet', description: 'Reverse-Fresnel fabric response.', shading: shading('velvet', .45, .5, .2, 20, .6), opacity: 1 },
  { id: 'thermal', label: 'Thermal Camera', description: 'Lighting mapped to a thermal palette.', shading: shading('thermal', .5, .5, 0, 30, .2), opacity: 1 },
  { id: 'matcap', label: 'Studio Matcap', description: 'Sculpting-studio material capture.', shading: shading('matcap', .5, .5, .4, 50, 0), opacity: 1 },
  { id: 'dither', label: '1-bit Dither', description: 'Ordered black-and-white dithering.', shading: shading('dither', .55, .45, 0, 30, 0), opacity: 1 },
  { id: 'pixel', label: '8-bit Pixel', description: 'Quantized retro colour bands.', shading: shading('pixel', .55, .45, 0, 30, 0), opacity: 1 },
  { id: 'riso', label: 'Riso Ink', description: 'Two-ink risograph texture.', shading: shading('riso', .55, .45, 0, 30, 0), opacity: 1 },
]

export interface BioDemoStyleTrack {
  id: string
  label: string
  description: string
  steps: readonly { at: number; presetId: string; easing?: BioStyleKeyframe['easing'] }[]
}

export const BIO_DEMO_STYLE_TRACKS: readonly BioDemoStyleTrack[] = [
  { id: 'reveal-xray', label: 'Solid to X-ray', description: 'Reveal internal structure by fading from solid to transparent.', steps: [{ at: 0, presetId: 'vesta-gloss' }, { at: 1, presetId: 'ghost' }] },
  { id: 'clay-to-pearl', label: 'Clay to Pearl', description: 'Transition from matte clay to iridescent pearl.', steps: [{ at: 0, presetId: 'clay' }, { at: 1, presetId: 'pearl' }] },
  { id: 'photo-to-sketch', label: 'Studio to Sketch', description: 'Move through studio, cel and pen-rendered styles.', steps: [{ at: 0, presetId: 'metal' }, { at: .5, presetId: 'toon' }, { at: 1, presetId: 'sketch' }] },
  { id: 'print-cycle', label: 'Print Process', description: 'Cycle through flat, halftone, Riso and 1-bit print.', steps: [{ at: 0, presetId: 'flat-ink' }, { at: .34, presetId: 'halftone' }, { at: .67, presetId: 'riso' }, { at: 1, presetId: 'dither' }] },
  { id: 'thermal-scan', label: 'Thermal Scan', description: 'Hard-cut to a thermal view and back.', steps: [{ at: 0, presetId: 'vesta-gloss', easing: 'hold' }, { at: .35, presetId: 'thermal', easing: 'hold' }, { at: .75, presetId: 'vesta-gloss', easing: 'hold' }] },
  { id: 'toy-showcase', label: 'Toy Showcase', description: 'Loop between vinyl and velvet responses.', steps: [{ at: 0, presetId: 'toy', easing: 'linear' }, { at: .5, presetId: 'velvet', easing: 'linear' }, { at: 1, presetId: 'toy', easing: 'linear' }] },
]

export function instantiateBioDemoTrack(
  demo: BioDemoStyleTrack,
  totalFrames: number,
  makeId: () => string,
): BioStyleKeyframe[] {
  const lastFrame = Math.max(1, Math.round(totalFrames) - 1)
  return demo.steps.flatMap((step) => {
    const preset = BIO_LAYER_MATERIAL_PRESETS.find((candidate) => candidate.id === step.presetId)
    if (!preset) return []
    return [{
      id: makeId(),
      frame: Math.round(Math.max(0, Math.min(1, step.at)) * lastFrame),
      easing: step.easing ?? 'smooth',
      presetId: step.presetId,
      patch: { shading: { ...preset.shading }, opacity: preset.opacity },
    }]
  })
}

/**
 * The six material narratives are shared by biological and crystal layers,
 * but crystal layers retain their own strict keyframe contract.
 */
export function instantiateCrystalDemoTrack(
  demo: BioDemoStyleTrack,
  totalFrames: number,
  makeId: () => string,
): CrystalLayerStyleKeyframe[] {
  const lastFrame = Math.max(1, Math.round(totalFrames) - 1)
  return demo.steps.flatMap((step) => {
    const preset = BIO_LAYER_MATERIAL_PRESETS.find((candidate) => candidate.id === step.presetId)
    if (!preset) return []
    return [{
      id: makeId(),
      frame: Math.round(Math.max(0, Math.min(1, step.at)) * lastFrame),
      easing: step.easing ?? 'smooth',
      presetId: step.presetId,
      patch: { shading: { ...preset.shading }, opacity: preset.opacity },
    }]
  })
}
