/**
 * Host binding for `ZatomViewerStyleSurface`: reads and patches the active
 * viewport's presentation through the same store actions the Visual panel
 * calls. Nothing here bypasses a panel path, so an agent-applied style is
 * indistinguishable from a manual one (same `stylePresetId: 'custom'`
 * bookkeeping, same hydrogen keep-list parsing, same surface re-render).
 */

import type { ViewerStylePatch, ViewerStyleSnapshot, ZatomViewerStyleSurface } from './contracts'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import { STYLE_PRESETS } from '../lib/render/crystal-visuals'
import { isSurfaceColormap, SURFACE_COLORMAPS } from '../lib/molecular-orbitals/surface-coloring'

export class ViewerStyleInputError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ViewerStyleInputError'
    this.code = code
  }
}

function readSnapshot(): ViewerStyleSnapshot {
  const state = getActiveViewportStoreApi().getState()
  const mo = state.molecularOrbital
  const hasSurface = mo.sourceType !== null && (mo.cubData !== null || mo.moldenData !== null)
  const stats = mo.colorFieldStats
  return {
    stylePresetId: state.stylePresetId,
    viewMode: state.viewMode,
    cameraProjection: state.cameraProjection,
    hideHydrogens: state.hideHydrogens,
    keptHydrogens: state.keptHydrogens,
    showAtomRings: state.showAtomRings,
    fieldSlice: { ...mo.fieldSlice },
    surface: hasSurface
      ? {
          sourceType: mo.sourceType!,
          sourceName: mo.sourceName,
          visible: mo.visible,
          isoValue: mo.isoValue,
          resolution: mo.resolution,
          opacity: mo.opacity,
          selectedOrbitalIndex: mo.moldenData ? mo.selectedOrbitalIndex : null,
          orbitalCount: mo.moldenData ? mo.moldenData.orbitals.length : null,
          colorField: mo.colorField
            ? {
                sourceName: mo.colorField.sourceName,
                colormap: mo.colorField.colormap,
                range: mo.colorField.range ? { ...mo.colorField.range } : null,
                showExtrema: mo.colorField.showExtrema,
                stats: stats
                  ? {
                      range: { ...stats.range },
                      sampled: { ...stats.sampled },
                      extrema: stats.extrema.map((e) => ({ kind: e.kind, value: e.value, position: [...e.position] as [number, number, number] })),
                    }
                  : null,
              }
            : null,
        }
      : null,
    available: {
      stylePresets: STYLE_PRESETS.map((p) => ({ id: p.id, label: p.label })),
      surfaceColormaps: [...SURFACE_COLORMAPS],
    },
  }
}

function applyPatch(patch: ViewerStylePatch): ViewerStyleSnapshot {
  const state = getActiveViewportStoreApi().getState()

  // Validate the complete patch before the first setter runs. A request such
  // as {hideHydrogens:true, surface:{opacity:2}} must leave *everything*
  // untouched instead of applying the early field and failing halfway down.
  if (patch.stylePresetId !== undefined
    && !STYLE_PRESETS.some((preset) => preset.id === patch.stylePresetId)) {
    throw new ViewerStyleInputError('unknown_style_preset', `Unknown style preset "${patch.stylePresetId}". See available.stylePresets.`)
  }
  if (patch.cameraProjection !== undefined
    && patch.cameraProjection !== 'perspective'
    && patch.cameraProjection !== 'orthographic') {
    throw new ViewerStyleInputError('invalid_camera_projection', 'cameraProjection must be perspective or orthographic')
  }
  if (patch.fieldSlice) {
    const slice = patch.fieldSlice
    if (slice.enabled !== undefined && typeof slice.enabled !== 'boolean') {
      throw new ViewerStyleInputError('invalid_field_slice_enabled', 'fieldSlice.enabled must be boolean')
    }
    if (slice.mode !== undefined && slice.mode !== 'overlay' && slice.mode !== 'slice-only') {
      throw new ViewerStyleInputError('invalid_field_slice_mode', 'fieldSlice.mode must be overlay or slice-only')
    }
    if (slice.opacity !== undefined
      && (!Number.isFinite(slice.opacity) || slice.opacity < 0.1 || slice.opacity > 1)) {
      throw new ViewerStyleInputError('invalid_field_slice_opacity', 'fieldSlice.opacity must be within [0.1, 1]')
    }
    if (slice.contours !== undefined
      && (!Number.isInteger(slice.contours) || slice.contours < 0 || slice.contours > 20)) {
      throw new ViewerStyleInputError('invalid_field_slice_contours', 'fieldSlice.contours must be an integer within [0, 20]')
    }
    if (slice.enabled === true) {
      if (!state.constructedPlane) {
        throw new ViewerStyleInputError(
          'no_constructed_plane',
          'No constructed reference plane is active; create one before enabling the field slice.',
        )
      }
      if (!state.molecularOrbital.colorField) {
        throw new ViewerStyleInputError(
          'no_color_field',
          'No colour field is attached; attach a cube colour field before enabling the field slice.',
        )
      }
    }
  }
  if (patch.surface) {
    const s = patch.surface
    const mo = state.molecularOrbital
    if (mo.sourceType === null) {
      throw new ViewerStyleInputError('no_surface_loaded', 'No cube or Molden data is loaded; load one before patching surface settings.')
    }
    if (s.isoValue !== undefined && (!Number.isFinite(s.isoValue) || s.isoValue <= 0)) {
      throw new ViewerStyleInputError('invalid_iso_value', 'isoValue must be a positive finite number')
    }
    if (s.resolution !== undefined
      && (!Number.isInteger(s.resolution) || s.resolution < 12 || s.resolution > 80)) {
      throw new ViewerStyleInputError('invalid_surface_resolution', 'resolution must be an integer within [12, 80]')
    }
    if (s.opacity !== undefined && (!Number.isFinite(s.opacity) || s.opacity < 0 || s.opacity > 1)) {
      throw new ViewerStyleInputError('invalid_opacity', 'opacity must be within [0, 1]')
    }
    if (s.selectedOrbitalIndex !== undefined) {
      const count = mo.moldenData?.orbitals.length ?? 0
      if (!mo.moldenData) throw new ViewerStyleInputError('no_molden_orbitals', 'selectedOrbitalIndex applies to Molden data only')
      if (!Number.isInteger(s.selectedOrbitalIndex) || s.selectedOrbitalIndex < 0 || s.selectedOrbitalIndex >= count) {
        throw new ViewerStyleInputError('orbital_index_out_of_range', `selectedOrbitalIndex must be an integer in [0, ${count - 1}]`)
      }
    }
    const touchesColorField = s.colormap !== undefined || s.range !== undefined || s.showExtrema !== undefined
    if (touchesColorField && !mo.colorField) {
      throw new ViewerStyleInputError('no_color_field', 'No colour field is attached; colormap/range/showExtrema need a second cube attached in the Surface panel.')
    }
    if (s.colormap !== undefined && !isSurfaceColormap(s.colormap)) {
      throw new ViewerStyleInputError('unknown_colormap', `Unknown colormap "${s.colormap}". See available.surfaceColormaps.`)
    }
    if (s.range !== undefined
      && s.range !== null
      && (!Number.isFinite(s.range.min) || !Number.isFinite(s.range.max) || s.range.min >= s.range.max)) {
      throw new ViewerStyleInputError('invalid_range', 'range.min must be less than range.max and both finite')
    }
  }

  if (patch.stylePresetId !== undefined) {
    state.applyCrystalStylePreset(patch.stylePresetId)
  }
  if (patch.cameraProjection !== undefined) state.setCameraProjection(patch.cameraProjection)
  if (patch.hideHydrogens !== undefined) state.setHideHydrogens(patch.hideHydrogens)
  if (patch.keptHydrogens !== undefined) state.setKeptHydrogens(patch.keptHydrogens)
  if (patch.showAtomRings !== undefined) state.setShowAtomRings(patch.showAtomRings)
  if (patch.fieldSlice !== undefined) state.setFieldSlice(patch.fieldSlice)

  if (patch.surface) {
    const s = patch.surface
    if (s.visible !== undefined) state.setMolecularOrbitalVisible(s.visible)
    if (s.isoValue !== undefined) {
      state.setMolecularOrbitalIsoValue(s.isoValue)
    }
    if (s.resolution !== undefined) {
      state.setMolecularOrbitalResolution(s.resolution)
    }
    if (s.opacity !== undefined) {
      state.setMolecularOrbitalOpacity(s.opacity)
    }
    if (s.selectedOrbitalIndex !== undefined) {
      state.setMolecularOrbitalSelectedOrbital(s.selectedOrbitalIndex)
    }
    if (s.colormap !== undefined && isSurfaceColormap(s.colormap)) {
      state.setSurfaceColormap(s.colormap)
    }
    if (s.range !== undefined) {
      state.setSurfaceColorRange(s.range)
    }
    if (s.showExtrema !== undefined) state.setSurfaceShowExtrema(s.showExtrema)
  }

  return readSnapshot()
}

export const activeViewportStyleSurface: ZatomViewerStyleSurface = {
  read: readSnapshot,
  apply: applyPatch,
}
