/**
 * Light position sharing tool: Convert spherical coordinates (azimuth, elevation) to [x, y, z] of the three.js scene.
 *
 * Defaults match the VESTA visual preset; all materials share the same Y-up convention.
 *
 * Y-up convention:
 * x = r·cos(elev)·cos(azim)
 * y = r·sin(elev)
 * z = r·cos(elev)·sin(azim)
 */

export const DEFAULT_LIGHT_AZIMUTH_DEG = 40
export const DEFAULT_LIGHT_ELEVATION_DEG = 25
export const LIGHT_RADIUS = 15
export const DARK_LIGHTING_DEFAULTS = {
  ambient: 0.6,
  key: 1.0,
  fill: 0.4,
} as const
export const LIGHT_LIGHTING_DEFAULTS = {
  ambient: 0.95,
  key: 1.5,
  fill: 0.6,
} as const

export interface ViewportLighting {
  ambient: number
  key: number
  fill: number
}

export function resolveViewportLighting(
  isDark: boolean,
  ambientOverride: number | null,
  keyOverride: number | null,
  fillOverride: number | null,
): ViewportLighting {
  const defaults = isDark ? DARK_LIGHTING_DEFAULTS : LIGHT_LIGHTING_DEFAULTS
  return {
    ambient: ambientOverride ?? defaults.ambient,
    key: keyOverride ?? defaults.key,
    fill: fillOverride ?? defaults.fill,
  }
}

/**
 * Reduce the VESTA-calibrated three-light rig when studio IBL is active. Without
 * scaling, duplicated energy clips saturated channels and shifts element colors.
 * A smaller key/fill contribution retains directional modeling while IBL owns
 * ambient illumination and highlight roll-off.
 */
export const STUDIO_LIGHT_SCALE = {
  /** IBL owns most ambient energy; retain only a small flat-light contribution. */
  ambient: 0.12,
  key: 0.35,
  fill: 0.28,
} as const

export function scaleLightingForStudio(lighting: ViewportLighting): ViewportLighting {
  return {
    ambient: lighting.ambient * STUDIO_LIGHT_SCALE.ambient,
    key: lighting.key * STUDIO_LIGHT_SCALE.key,
    fill: lighting.fill * STUDIO_LIGHT_SCALE.fill,
  }
}

export function lightDirectionFromAngles(
  azimuthDeg: number | null | undefined,
  elevationDeg: number | null | undefined,
  radius: number = LIGHT_RADIUS,
): [number, number, number] {
  const az = ((azimuthDeg ?? DEFAULT_LIGHT_AZIMUTH_DEG) * Math.PI) / 180
  const el = ((elevationDeg ?? DEFAULT_LIGHT_ELEVATION_DEG) * Math.PI) / 180
  const cosEl = Math.cos(el)
  return [
    radius * cosEl * Math.cos(az),
    radius * Math.sin(el),
    radius * cosEl * Math.sin(az),
  ]
}

/**
 * Fill light is always in the opposite direction of key
 */
export function fillFromKey(key: [number, number, number]): [number, number, number] {
  return [-key[0], -key[1], -key[2]]
}
