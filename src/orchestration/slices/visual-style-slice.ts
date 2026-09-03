import type { StateCreator } from 'zustand'
import {
  DEFAULT_CRYSTAL_VISUAL_SETTINGS,
  STYLE_PRESET_BASE,
  STYLE_PRESETS,
  getDefaultCrystalElementVisual,
  type CrystalVisualSettings,
  type ElementVisualOverride,
  type RenderStyle,
} from '../../lib/render/crystal-visuals'
import type { CrystalStore } from '../crystal-store-types'

export interface VisualStyleSlice extends CrystalVisualSettings {
  renderStyle: RenderStyle
  setRenderStyle: (style: RenderStyle) => void
  setCrystalVisualSettings: (patch: Partial<CrystalVisualSettings>) => void
  applyCrystalStylePreset: (id: string) => boolean
  setElementVisualOverride: (element: string, patch: Partial<ElementVisualOverride>) => void
  clearElementVisualOverrides: () => void
  setPolyhedronElementColor: (element: string, color: string) => void
  clearPolyhedronElementColors: () => void
  resetCrystalVisualSettings: () => void
}

const VIEW_MODE_BY_SOURCE_STYLE = {
  ballstick: 'ball-stick',
  spacefill: 'space-fill',
  stick: 'stick',
  wireframe: 'wireframe',
} as const

function atomScaleForSourceStyle(atomStyle: keyof typeof VIEW_MODE_BY_SOURCE_STYLE, radiusScale: number): number {
  if (atomStyle === 'spacefill') return 0.8
  return 2 * radiusScale
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export const createVisualStyleSlice: StateCreator<CrystalStore, [], [], VisualStyleSlice> = (set, get) => ({
  ...DEFAULT_CRYSTAL_VISUAL_SETTINGS,
  elementOverrides: {},
  renderStyle: 'vesta',

  setRenderStyle: (renderStyle) => set({ renderStyle, stylePresetId: 'custom' }),
  setCrystalVisualSettings: (patch) => {
    const current = get()
    const radiusScale = patch.radiusScale === undefined ? current.radiusScale : Math.max(0.1, Math.min(1.2, finiteOr(patch.radiusScale, current.radiusScale)))
    const bondRadius = patch.bondRadius === undefined ? current.bondRadius : Math.max(0.02, Math.min(0.4, finiteOr(patch.bondRadius, current.bondRadius)))
    set({
      ...patch,
      ...(patch.polyElementColors === undefined ? {} : { polyElementColors: { ...patch.polyElementColors } }),
      stylePresetId: patch.stylePresetId ?? 'custom',
      radiusScale,
      bondRadius,
      ...(patch.radiusScale === undefined || current.bioStructure || current.viewMode === 'stick' ? {} : { atomScale: 2 * radiusScale }),
      ...(patch.bondRadius === undefined || current.bioStructure || current.viewMode === 'stick' ? {} : { bondScale: bondRadius / .08 }),
      outlineWidth: patch.outlineWidth === undefined ? current.outlineWidth : Math.max(0.5, Math.min(5, finiteOr(patch.outlineWidth, current.outlineWidth))),
      sphereDetail: patch.sphereDetail === undefined ? current.sphereDetail : Math.max(8, Math.min(64, Math.round(finiteOr(patch.sphereDetail, current.sphereDetail)))),
      polyEdgeOpacity: patch.polyEdgeOpacity === undefined ? current.polyEdgeOpacity : Math.max(0, Math.min(1, finiteOr(patch.polyEdgeOpacity, current.polyEdgeOpacity))),
      polySpecular: patch.polySpecular === undefined ? current.polySpecular : Math.max(0, Math.min(1, finiteOr(patch.polySpecular, current.polySpecular))),
      polyShininess: patch.polyShininess === undefined ? current.polyShininess : Math.max(1, Math.min(100, finiteOr(patch.polyShininess, current.polyShininess))),
      polyFresnel: patch.polyFresnel === undefined ? current.polyFresnel : Math.max(0, Math.min(1, finiteOr(patch.polyFresnel, current.polyFresnel))),
      volumeResolution: patch.volumeResolution === undefined ? current.volumeResolution : Math.max(24, Math.min(96, Math.round(finiteOr(patch.volumeResolution, current.volumeResolution)))),
      isoLevel: patch.isoLevel === undefined ? current.isoLevel : Math.max(0.02, Math.min(0.98, finiteOr(patch.isoLevel, current.isoLevel))),
      isoOpacity: patch.isoOpacity === undefined ? current.isoOpacity : Math.max(0.05, Math.min(1, finiteOr(patch.isoOpacity, current.isoOpacity))),
      sliceOffset: patch.sliceOffset === undefined ? current.sliceOffset : Math.max(0.02, Math.min(0.98, finiteOr(patch.sliceOffset, current.sliceOffset))),
      sliceOpacity: patch.sliceOpacity === undefined ? current.sliceOpacity : Math.max(0.1, Math.min(1, finiteOr(patch.sliceOpacity, current.sliceOpacity))),
    })
  },

  applyCrystalStylePreset: (id) => {
    const preset = STYLE_PRESETS.find((candidate) => candidate.id === id)
    if (!preset) return false
    const style = { ...STYLE_PRESET_BASE, ...preset.patch, stylePresetId: preset.id }
    set({
      stylePresetId: preset.id,
      radiusScale: style.radiusScale,
      renderStyle: style.shadingMode,
      background: style.background,
      outline: style.outline,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      atomShininess: style.atomShininess,
      bondBicolor: style.bondBicolor,
      bondColor: style.bondColor,
      polyStyle: style.polyStyle,
      polyColorSource: style.polyColorSource,
      polyElementColors: { ...style.polyElementColors },
      polyColor: style.polyColor,
      showPolyEdges: style.showPolyEdges,
      polyEdgeColor: style.polyEdgeColor,
      polyEdgeOpacity: style.polyEdgeOpacity,
      polySpecular: style.polySpecular,
      polyShininess: style.polyShininess,
      polyFresnel: style.polyFresnel,
      cellColor: style.cellColor,
      ambientIntensity: style.ambientIntensity,
      diffuseIntensity: style.diffuseIntensity,
      specularIntensity: style.specularIntensity,
      rimIntensity: style.rimIntensity,
      viewMode: VIEW_MODE_BY_SOURCE_STYLE[style.atomStyle],
      vanDerWaalsSpaceFill: style.vanDerWaalsSpaceFill,
      fusedAtomSurface: style.fusedAtomSurface,
      atomScale: atomScaleForSourceStyle(style.atomStyle, style.radiusScale),
      elementRadiusVariance: 1,
      bondScale: 1.5,
      showBonds: style.showBonds,
      showCoordinationPolyhedra: style.showPolyhedra,
      polyhedraOpacity: style.polyOpacity,
      lightAmbient: style.lightAmbient,
      lightKey: style.lightKey,
      lightFill: style.lightFill,
      lightAmbientOcclusion: style.lightAmbientOcclusion,
      lightAzimuth: style.lightAzimuth,
      lightElevation: style.lightElevation,
    })
    return true
  },

  setElementVisualOverride: (element, patch) => {
    const base = get().elementOverrides[element] ?? {
      ...getDefaultCrystalElementVisual(element),
    }
    const next = {
      color: patch.color ?? base.color,
      radius: Math.max(0.1, Math.min(3, finiteOr(patch.radius ?? base.radius, base.radius))),
    }
    set({ elementOverrides: { ...get().elementOverrides, [element]: next }, stylePresetId: 'custom' })
  },
  clearElementVisualOverrides: () => set({ elementOverrides: {}, stylePresetId: 'custom' }),
  setPolyhedronElementColor: (element, color) => set({
    polyElementColors: { ...get().polyElementColors, [element]: color },
    stylePresetId: 'custom',
  }),
  clearPolyhedronElementColors: () => set({ polyElementColors: {}, stylePresetId: 'custom' }),
  resetCrystalVisualSettings: () => set({
    ...DEFAULT_CRYSTAL_VISUAL_SETTINGS,
    elementOverrides: {},
    polyElementColors: {},
    renderStyle: 'vesta',
    viewMode: 'ball-stick',
    atomScale: 2 * STYLE_PRESET_BASE.radiusScale,
    elementRadiusVariance: 1,
    bondScale: 1.5,
    showBonds: true,
    showCellGrid: false,
    showCoordinationPolyhedra: false,
    polyhedraOpacity: STYLE_PRESET_BASE.polyOpacity,
    lightAmbient: null,
    lightKey: null,
    lightFill: null,
    lightAzimuth: STYLE_PRESET_BASE.lightAzimuth,
    lightElevation: STYLE_PRESET_BASE.lightElevation,
  }),
})
