import type { StateCreator } from 'zustand'
import type { LayerShadingSnapshotContext } from '../../lib/biomolecule/shading'
import {
  evaluateCrystalLayerStyle,
  materializeCrystalLayerStyleEdit,
  snapshotCrystalLayerStyle,
  type CrystalLayer,
} from '../../lib/crystal/semantic-layers'
import {
  autoKeyLayerStyle,
  hasLayerStyleKeys,
  recordLayerStyle,
} from '../../lib/presentation/layer-track-authoring'
import type { CrystalStore } from '../crystal-store-types'

export type CrystalLayerStyleEdit = Partial<Pick<
  CrystalLayer,
  'representation' | 'color' | 'shading' | 'opacity' | 'scale' | 'bondScale' | 'materialPresetId'
>>

export interface CrystalLayersSlice {
  crystalLayers: CrystalLayer[]
  clearCrystalLayers: () => void
  addCrystalLayer: (patch?: Partial<Omit<CrystalLayer, 'id'>>) => string
  updateCrystalLayer: (id: string, patch: Partial<Omit<CrystalLayer, 'id'>>) => void
  /** Edit frame zero statically; away from zero, start or extend the style track at the playhead. */
  editCrystalLayerStyle: (id: string, patch: CrystalLayerStyleEdit) => void
  /** Record the complete effective style at the current playhead. */
  recordCrystalLayerStyle: (id: string) => void
  removeCrystalLayer: (id: string) => void
  duplicateCrystalLayer: (id: string) => string | null
  moveCrystalLayer: (fromIndex: number, toIndex: number) => void
}

let fallbackLayerSequence = 0
let fallbackStyleKeySequence = 0

function createLayerId(): string {
  if (globalThis.crypto?.randomUUID) return `crystal-layer-${globalThis.crypto.randomUUID()}`
  fallbackLayerSequence += 1
  return `crystal-layer-${fallbackLayerSequence}`
}

function createStyleKeyId(): string {
  if (globalThis.crypto?.randomUUID) return `crystal-style-${globalThis.crypto.randomUUID()}`
  fallbackStyleKeySequence += 1
  return `crystal-style-${fallbackStyleKeySequence}`
}

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
)

function defaultLayer(id: string, ordinal: number): CrystalLayer {
  return {
    id,
    name: `Layer ${ordinal}`,
    selection: 'all',
    representation: 'ball-stick',
    color: { mode: 'element' },
    materialPresetId: null,
    shading: null,
    visible: true,
    opacity: 1,
    scale: 1,
    bondScale: 1,
    replaceBase: false,
  }
}

function normalizeLayer(layer: CrystalLayer): CrystalLayer {
  return {
    ...layer,
    name: layer.name.trim() || 'Layer',
    selection: layer.selection.trim() || 'all',
    color: layer.color.mode === 'custom'
      ? { mode: 'custom', value: layer.color.value }
      : { mode: 'element' },
    shading: layer.shading ? { ...layer.shading } : null,
    styleTrack: layer.styleTrack?.map((keyframe) => ({
      ...keyframe,
      patch: {
        ...keyframe.patch,
        color: keyframe.patch.color ? { ...keyframe.patch.color } : undefined,
        shading: keyframe.patch.shading ? { ...keyframe.patch.shading } : keyframe.patch.shading,
      },
    })),
    opacity: clamp(Number.isFinite(layer.opacity) ? layer.opacity : 1, 0, 1),
    scale: clamp(Number.isFinite(layer.scale) ? layer.scale : 1, 0.05, 10),
    bondScale: clamp(Number.isFinite(layer.bondScale) ? layer.bondScale : 1, 0.05, 10),
  }
}

function styleSnapshotContext(state: CrystalStore): LayerShadingSnapshotContext {
  return {
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

export const createCrystalLayersSlice: StateCreator<CrystalStore, [], [], CrystalLayersSlice> = (set, get) => ({
  crystalLayers: [],
  clearCrystalLayers: () => set({ crystalLayers: [] }),

  addCrystalLayer: (patch = {}) => {
    const id = createLayerId()
    const layer = normalizeLayer({
      ...defaultLayer(id, get().crystalLayers.length + 1),
      ...patch,
      id,
    })
    // The editor is top-to-bottom: a newly authored layer must immediately own
    // its selection instead of being silently occluded by an older exclusive
    // layer above it.
    set({ crystalLayers: [layer, ...get().crystalLayers] })
    return id
  },

  updateCrystalLayer: (id, patch) => set({
    crystalLayers: get().crystalLayers.map((layer) => (
      layer.id === id ? normalizeLayer({ ...layer, ...patch, id }) : layer
    )),
  }),

  editCrystalLayerStyle: (id, patch) => {
    if (Object.keys(patch).length === 0) return
    set((state) => {
      const layer = state.crystalLayers.find((candidate) => candidate.id === id)
      if (!layer) return {}
      const context = styleSnapshotContext(state)
      const frame = state.presentationFrame
      const roundedFrame = Math.round(frame)
      const current = evaluateCrystalLayerStyle(layer, frame, context)
      const { materialPresetId: presetId, ...edit } = patch

      if (!hasLayerStyleKeys(layer.styleTrack)) {
        if (roundedFrame > 0) {
          // The first edit away from frame zero is already an authoring gesture.
          // Preserve the pre-edit appearance at the beginning, then record the
          // edited appearance where the user is looking so no manual priming
          // step can silently turn a keyframed edit into a static layer change.
          const baselineTrack = recordLayerStyle(
            layer.styleTrack,
            0,
            snapshotCrystalLayerStyle(current, context),
            createStyleKeyId,
            { presetId: layer.materialPresetId },
          )
          const styleTrack = recordLayerStyle(
            baselineTrack,
            roundedFrame,
            materializeCrystalLayerStyleEdit(current, edit, context),
            createStyleKeyId,
            { presetId: presetId === undefined ? layer.materialPresetId : presetId },
          )
          return {
            crystalLayers: state.crystalLayers.map((candidate) => candidate.id === id
              ? normalizeLayer({ ...candidate, styleTrack, id })
              : candidate),
          }
        }
        return {
          crystalLayers: state.crystalLayers.map((candidate) => candidate.id === id
            ? normalizeLayer({ ...candidate, ...patch, id })
            : candidate),
        }
      }

      const styleTrack = autoKeyLayerStyle(
        layer.styleTrack,
        frame,
        materializeCrystalLayerStyleEdit(current, edit, context),
        createStyleKeyId,
        { presetId },
      )
      return {
        crystalLayers: state.crystalLayers.map((candidate) => candidate.id === id
          ? normalizeLayer({ ...candidate, styleTrack, id })
          : candidate),
      }
    })
  },

  recordCrystalLayerStyle: (id) => set((state) => {
    const layer = state.crystalLayers.find((candidate) => candidate.id === id)
    if (!layer) return {}
    const frame = state.presentationFrame
    const context = styleSnapshotContext(state)
    const animated = hasLayerStyleKeys(layer.styleTrack)
    const sameFramePreset = layer.styleTrack?.find((keyframe) => keyframe.frame === Math.round(frame))?.presetId
    const styleTrack = recordLayerStyle(
      layer.styleTrack,
      frame,
      snapshotCrystalLayerStyle(evaluateCrystalLayerStyle(layer, frame, context), context),
      createStyleKeyId,
      { presetId: animated ? sameFramePreset ?? null : layer.materialPresetId },
    )
    return {
      crystalLayers: state.crystalLayers.map((candidate) => candidate.id === id
        ? normalizeLayer({ ...candidate, styleTrack, id })
        : candidate),
    }
  }),

  removeCrystalLayer: (id) => set({
    crystalLayers: get().crystalLayers.filter((layer) => layer.id !== id),
  }),

  duplicateCrystalLayer: (id) => {
    const index = get().crystalLayers.findIndex((layer) => layer.id === id)
    if (index < 0) return null
    const source = get().crystalLayers[index]
    const nextId = createLayerId()
    const duplicate = normalizeLayer({
      ...source,
      id: nextId,
      name: `${source.name} copy`,
      color: { ...source.color },
      shading: source.shading ? { ...source.shading } : null,
    })
    const layers = [...get().crystalLayers]
    layers.splice(index, 0, duplicate)
    set({ crystalLayers: layers })
    return nextId
  },

  moveCrystalLayer: (fromIndex, toIndex) => {
    const layers = [...get().crystalLayers]
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= layers.length) return
    const destination = Math.round(clamp(toIndex, 0, layers.length - 1))
    if (destination === fromIndex) return
    const [layer] = layers.splice(fromIndex, 1)
    layers.splice(destination, 0, layer)
    set({ crystalLayers: layers })
  },
})
