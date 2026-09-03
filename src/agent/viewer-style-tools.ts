/**
 * Presentation tools: read and patch how the active viewport draws the
 * structure — style preset, hydrogen visibility, isosurface appearance and
 * decorations. These never touch the structure, so they sit below the
 * mutate tier; they exist so an agent making a figure can set the look and
 * then `viewer_capture` it without a human clicking through the panel.
 */

import type { ViewerStylePatch, ViewerStyleSnapshot, ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { objectSchema, toolError } from './tool-helpers'

const rangeSchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: { min: { type: 'number' }, max: { type: 'number' } },
  required: ['min', 'max'],
  description: 'Colour range for the surface colour field. null = symmetric auto range about zero.',
}

const getManifest: ZatomToolManifest = {
  name: 'viewer_get_style',
  title: 'Read viewport presentation',
  version: '1.1.0',
  description: 'Read the active viewport presentation: style preset, camera projection, hydrogen visibility and keep-list, atom-ring decoration, constructed-plane field-slice state, and isosurface settings (iso value, resolution, orbital, colour field colormap/range/extrema) together with the catalogue of available presets and colormaps.',
  inputSchema: objectSchema({}),
  effects: { structure: 'none', workspace: 'none', visual: 'read' },
  tags: ['viewer', 'style', 'presentation', 'agent'],
}

const setManifest: ZatomToolManifest = {
  name: 'viewer_set_style',
  title: 'Patch viewport presentation',
  version: '1.1.0',
  description: 'Patch the active viewport presentation through the same actions the Visual panel uses. Omitted fields are untouched. Use viewer_get_style first for the available stylePresetId and colormap names. Enabling fieldSlice requires both an active constructed plane and an attached colour field. Surface fields require cube/Molden data to be loaded, and colormap/range/showExtrema require a colour field to be attached.',
  inputSchema: objectSchema({
    stylePresetId: { type: 'string', minLength: 1, description: 'One of available.stylePresets[].id, e.g. "qc-soft", "qc-vivid", "qc-fourlight", "vesta".' },
    cameraProjection: { type: 'string', enum: ['perspective', 'orthographic'], description: 'Camera projection used by the live viewport.' },
    hideHydrogens: { type: 'boolean' },
    keptHydrogens: { type: 'string', description: 'Ordinal keep-list while hideHydrogens is on, e.g. "1-3, 7". Empty string keeps none.' },
    showAtomRings: { type: 'boolean', description: 'Three orthogonal rings around every atom sphere (mechanism-figure decoration).' },
    fieldSlice: objectSchema({
      enabled: { type: 'boolean', description: 'Sample the attached colour field on the active constructed reference plane.' },
      mode: { type: 'string', enum: ['overlay', 'slice-only'], description: 'Overlay the slice with the surface or show only the field slice.' },
      opacity: { type: 'number', minimum: 0.1, maximum: 1 },
      contours: { type: 'integer', minimum: 0, maximum: 20 },
    }),
    surface: objectSchema({
      visible: { type: 'boolean' },
      isoValue: { type: 'number', exclusiveMinimum: 0 },
      resolution: { type: 'integer', minimum: 12, maximum: 80, description: 'Marching-cubes sampling resolution.' },
      opacity: { type: 'number', minimum: 0, maximum: 1 },
      selectedOrbitalIndex: { type: 'integer', minimum: 0, description: 'Molden only; zero-based orbital index.' },
      colormap: { type: 'string', description: 'One of available.surfaceColormaps, e.g. "bgr" (IGMH), "rwb" (ESP), "viridis".' },
      range: rangeSchema,
      showExtrema: { type: 'boolean' },
    }),
  }),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['viewer', 'style', 'presentation', 'agent'],
}

function requireStyle(context: {
  viewerStyle?: {
    read: () => ViewerStyleSnapshot | Promise<ViewerStyleSnapshot>
    apply: (p: ViewerStylePatch) => ViewerStyleSnapshot | Promise<ViewerStyleSnapshot>
  }
}) {
  if (!context.viewerStyle) {
    const error = new Error('This host did not provide viewport presentation access') as Error & { code: string }
    error.code = 'style_unavailable'
    throw error
  }
  return context.viewerStyle
}

function describe(snapshot: ViewerStyleSnapshot): string {
  const parts = [`preset=${snapshot.stylePresetId}`, `view=${snapshot.viewMode}`, `projection=${snapshot.cameraProjection}`]
  if (snapshot.hideHydrogens) parts.push(`hydrogens hidden${snapshot.keptHydrogens ? ` (kept ${snapshot.keptHydrogens})` : ''}`)
  if (snapshot.showAtomRings) parts.push('rings on')
  parts.push(snapshot.fieldSlice.enabled
    ? `field-slice ${snapshot.fieldSlice.mode} opacity=${snapshot.fieldSlice.opacity} contours=${snapshot.fieldSlice.contours}`
    : 'field-slice off')
  if (snapshot.surface) {
    const s = snapshot.surface
    parts.push(`surface ${s.sourceType} iso=${s.isoValue} resolution=${s.resolution}${s.visible ? '' : ' hidden'}`)
    if (s.colorField) parts.push(`coloured by ${s.colorField.sourceName ?? 'cube'} via ${s.colorField.colormap}`)
  }
  return parts.join(', ')
}

const viewerGetStyleTool: ZatomToolDefinition<ViewerStyleSnapshot> = {
  manifest: getManifest,
  execute: async (_input, context) => {
    try {
      const snapshot = await requireStyle(context).read()
      return { ok: true, tool: getManifest.name, summary: describe(snapshot), data: snapshot }
    } catch (error) {
      return toolError(getManifest.name, error)
    }
  },
}

const viewerSetStyleTool: ZatomToolDefinition<ViewerStyleSnapshot> = {
  manifest: setManifest,
  execute: async (input, context) => {
    try {
      const snapshot = await requireStyle(context).apply(input as ViewerStylePatch)
      return { ok: true, tool: setManifest.name, summary: describe(snapshot), data: snapshot }
    } catch (error) {
      return toolError(setManifest.name, error)
    }
  },
}

export const VIEWER_STYLE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  viewerGetStyleTool,
  viewerSetStyleTool,
]
