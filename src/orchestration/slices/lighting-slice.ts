/**
 * lighting-slice -- 3D viewport lighting controls (ambient + key + fill).
 *
 * The Light panel in InspectorPanel adjusts these values; crystal-viewer and
 * assembly-scene use them as three.js light intensities. null uses the theme
 * default, including dark/light contrast compensation.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'

/**
 * Default ambient-occlusion intensity.
 *
 * Both initial state and resetLighting use this value to keep one source of truth.
 */
export const DEFAULT_AMBIENT_OCCLUSION = 0.8

export interface LightingSlice {
  /** Global ambient-light intensity. null uses the theme default. */
  lightAmbient: number | null
  /** Main directional-light (front key-light) intensity. null uses the theme default. */
  lightKey: number | null
  /** Back directional-light (rear fill-light) intensity. null uses the theme default. */
  lightFill: number | null
  /** Key-light azimuth around the Y axis, in degrees. null uses the 40° default.
   *  This strongly affects ball-and-stick/hyperstick models by moving specular highlights. */
  lightAzimuth: number | null
  /** Key-light elevation above the horizontal, in degrees (-90..90). null uses 25°. */
  lightElevation: number | null
  /**
   * Ambient-occlusion intensity (0 = off, 1 = standard publication strength, max 2).
   *
   * Three-point lighting cannot create contact shadows inside molecular crevices.
   * AO darkens geometrically occluded regions, preserving readable depth especially
   * for space-filling and surface representations.
   *
   * DEFAULT_AMBIENT_OCCLUSION enables AO at low strength so newly loaded structures
   * retain depth without crushing recesses to black or imposing excessive post-processing cost.
   */
  lightAmbientOcclusion: number
  /**
   * Camera-following key light (headlight): illumination always comes from the viewer.
   *
   * A fixed-angle light inevitably leaves some orientations in shadow as the model rotates.
   * Headlight mode keeps camera-facing surfaces lit at every angle, which is useful for
   * inspecting structural detail without repeatedly adjusting azimuth and elevation.
   *
   * In view space the direction is constant, so the shader uses L = V without per-frame
   * uniform updates; the three.js light follows the camera transform.
   */
  lightFollowsCamera: boolean
  setLightFollowsCamera: (value: boolean) => void
  setLightAmbient: (value: number | null) => void
  setLightKey: (value: number | null) => void
  setLightFill: (value: number | null) => void
  setLightAzimuth: (value: number | null) => void
  setLightElevation: (value: number | null) => void
  setLightAmbientOcclusion: (value: number) => void
  /** Reset intensity, angles, and AO to theme defaults. */
  resetLighting: () => void
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const wrap360 = (v: number) => ((v % 360) + 360) % 360

export const createLightingSlice: StateCreator<CrystalStore, [], [], LightingSlice> = (set) => ({
  lightAmbient: null,
  lightKey: null,
  lightFill: null,
  lightAzimuth: null,
  lightElevation: null,
  lightAmbientOcclusion: DEFAULT_AMBIENT_OCCLUSION,
  lightFollowsCamera: false,
  setLightFollowsCamera: (value) => set({ lightFollowsCamera: value, stylePresetId: 'custom' }),
  setLightAmbient: (value) => set({ lightAmbient: value === null ? null : clamp(value, 0, 3), stylePresetId: 'custom' }),
  setLightKey: (value) => set({ lightKey: value === null ? null : clamp(value, 0, 3), stylePresetId: 'custom' }),
  setLightFill: (value) => set({ lightFill: value === null ? null : clamp(value, 0, 3), stylePresetId: 'custom' }),
  setLightAzimuth: (value) => set({ lightAzimuth: value === null ? null : wrap360(value), stylePresetId: 'custom' }),
  setLightElevation: (value) => set({ lightElevation: value === null ? null : clamp(value, -90, 90), stylePresetId: 'custom' }),
  setLightAmbientOcclusion: (value) => set({
    lightAmbientOcclusion: Number.isFinite(value) ? clamp(value, 0, 2) : 0,
    stylePresetId: 'custom',
  }),
  resetLighting: () => set({
    lightAmbient: null,
    lightKey: null,
    lightFill: null,
    lightAzimuth: null,
    lightElevation: null,
    lightAmbientOcclusion: DEFAULT_AMBIENT_OCCLUSION,
    lightFollowsCamera: false,
    stylePresetId: 'custom',
  }),
})
