/**
 * molecular-orbital-slice -- MO data loading (CUB/MOLDEN), rendering parameters
 * (isovalue, resolution, opacity, visibility, and two-lobe colors), and selected orbital index.
 *
 * loadMoldenData selects the HOMO by default and falls back to the first orbital.
 * Switching data sources clears the other format; cubData and moldenData are exclusive.
 *
 * cubData and moldenData remain any because they come from different parsers and are
 * narrowed by their consuming components; a shared type here would be misleading.
 */

import type { StateCreator } from 'zustand'
import {
  ORBITAL_CUB_SURFACE_DEFAULTS,
  cubSurfaceRenderDefaults,
  defaultMolecularOrbitalState,
  getHomoIndex,
  type MolecularOrbitalState,
  type SurfaceColorStats,
} from '../../lib/molecular-orbitals/state'
import {
  EMPTY_CUBE_FIELD_SLICE_SAMPLE,
  normalizeCubeFieldSlice,
  type CubeFieldSliceSampleState,
  type CubeFieldSliceSettings,
} from '../../lib/molecular-orbitals/cube-field-slice'
import type { ColorRange, SurfaceColormap } from '../../lib/molecular-orbitals/surface-coloring'
import type { CrystalStore } from '../crystal-store-types'

export interface MolecularOrbitalSlice {
  molecularOrbital: MolecularOrbitalState
  loadCubData: (data: any, sourceName?: string) => void
  loadMoldenData: (data: any, sourceName?: string) => void
  clearMolecularOrbitalData: () => void
  /** Attach a second cube only to color the isosurface (IGMH sign(λ₂)ρ or ESP), not reshape it. */
  setSurfaceColorField: (data: any, sourceName?: string) => void
  clearSurfaceColorField: () => void
  setSurfaceColormap: (colormap: SurfaceColormap) => void
  /** null selects an automatic symmetric range. */
  setSurfaceColorRange: (range: ColorRange | null) => void
  setSurfaceShowExtrema: (show: boolean) => void
  /** Written by the renderer after sampling; the legend and extrema markers share this range. */
  setSurfaceColorStats: (stats: SurfaceColorStats | null) => void
  setFieldSlice: (patch: Partial<CubeFieldSliceSettings>) => void
  setFieldSliceSample: (sample: CubeFieldSliceSampleState) => void
  setMolecularOrbitalSelectedOrbital: (index: number) => void
  setMolecularOrbitalIsoValue: (value: number) => void
  setMolecularOrbitalResolution: (value: number) => void
  setMolecularOrbitalOpacity: (value: number) => void
  setMolecularOrbitalVisible: (visible: boolean) => void
  setMolecularOrbitalPositiveColor: (color: string) => void
  setMolecularOrbitalNegativeColor: (color: string) => void
}

export const createMolecularOrbitalSlice: StateCreator<CrystalStore, [], [], MolecularOrbitalSlice> = (set) => ({
  molecularOrbital: defaultMolecularOrbitalState,

  loadCubData: (data, sourceName) => {
    const renderDefaults = cubSurfaceRenderDefaults(data, sourceName)
    set((state) => ({
      molecularOrbital: {
        ...state.molecularOrbital,
        ...renderDefaults,
        sourceType: 'cub',
        sourceName: sourceName ?? null,
        cubData: data,
        moldenData: null,
        selectedOrbitalIndex: -1,
        visible: true,
      },
    }))
  },

  loadMoldenData: (data, sourceName) => {
    const defaultOrbitalIndex = getHomoIndex(data) >= 0 ? getHomoIndex(data) : data.orbitals.length > 0 ? 0 : -1
    set((state) => ({
      molecularOrbital: {
        ...state.molecularOrbital,
        ...ORBITAL_CUB_SURFACE_DEFAULTS,
        sourceType: 'molden',
        sourceName: sourceName ?? null,
        cubData: null,
        moldenData: data,
        selectedOrbitalIndex: defaultOrbitalIndex,
        visible: true,
      },
    }))
  },

  clearMolecularOrbitalData: () => set({ molecularOrbital: defaultMolecularOrbitalState }),

  // Loading surface geometry does not clear its color field, so δg and sign(λ₂)ρ may be loaded in either order.
  // Preserve a manual range when changing colormaps, but reset it when changing color-field data.
  setSurfaceColorField: (data, sourceName) => set((state) => ({
    molecularOrbital: {
      ...state.molecularOrbital,
      colorField: {
        cubData: data,
        sourceName: sourceName ?? null,
        colormap: state.molecularOrbital.colorField?.colormap ?? 'bgr',
        range: null,
        showExtrema: state.molecularOrbital.colorField?.showExtrema ?? false,
      },
      fieldSliceSample: state.molecularOrbital.fieldSlice.enabled
        ? { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE, phase: 'sampling' }
        : { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE },
    },
  })),
  clearSurfaceColorField: () => set((state) => ({
    molecularOrbital: {
      ...state.molecularOrbital,
      colorField: null,
      colorFieldStats: null,
      fieldSlice: { ...state.molecularOrbital.fieldSlice, enabled: false },
      fieldSliceSample: { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE },
    },
  })),
  setSurfaceShowExtrema: (show) => set((state) => {
    const field = state.molecularOrbital.colorField
    if (!field) return {}
    return { molecularOrbital: { ...state.molecularOrbital, colorField: { ...field, showExtrema: show } } }
  }),
  setSurfaceColorStats: (stats) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, colorFieldStats: stats },
  })),
  setFieldSlice: (patch) => set((state) => {
    const fieldSlice = normalizeCubeFieldSlice(state.molecularOrbital.fieldSlice, patch)
    const enabledChanged = fieldSlice.enabled !== state.molecularOrbital.fieldSlice.enabled
    return {
      molecularOrbital: {
        ...state.molecularOrbital,
        fieldSlice,
        fieldSliceSample: enabledChanged
          ? fieldSlice.enabled
            ? { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE, phase: 'sampling' }
            : { ...EMPTY_CUBE_FIELD_SLICE_SAMPLE }
          : state.molecularOrbital.fieldSliceSample,
      },
    }
  }),
  setFieldSliceSample: (sample) => set((state) => {
    const current = state.molecularOrbital.fieldSliceSample
    if (
      current.phase === sample.phase
      && current.planeId === sample.planeId
      && current.volumeData === sample.volumeData
      && current.validFraction === sample.validFraction
      && current.failureReason === sample.failureReason
    ) return {}
    return { molecularOrbital: { ...state.molecularOrbital, fieldSliceSample: sample } }
  }),
  setSurfaceColormap: (colormap) => set((state) => {
    const field = state.molecularOrbital.colorField
    if (!field) return {}
    return { molecularOrbital: { ...state.molecularOrbital, colorField: { ...field, colormap } } }
  }),
  setSurfaceColorRange: (range) => set((state) => {
    const field = state.molecularOrbital.colorField
    if (!field) return {}
    return { molecularOrbital: { ...state.molecularOrbital, colorField: { ...field, range } } }
  }),

  setMolecularOrbitalSelectedOrbital: (index) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, selectedOrbitalIndex: index },
  })),
  setMolecularOrbitalIsoValue: (value) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, isoValue: value },
  })),
  setMolecularOrbitalResolution: (value) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, resolution: value },
  })),
  setMolecularOrbitalOpacity: (value) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, opacity: value },
  })),
  setMolecularOrbitalVisible: (visible) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, visible },
  })),
  setMolecularOrbitalPositiveColor: (color) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, positiveColor: color },
  })),
  setMolecularOrbitalNegativeColor: (color) => set((state) => ({
    molecularOrbital: { ...state.molecularOrbital, negativeColor: color },
  })),
})
