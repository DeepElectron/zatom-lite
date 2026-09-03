/**
 * Colour an isosurface by a second scalar field.
 *
 * The surface itself comes from field A (for example IGMH δg or an RDG
 * isosurface). Each vertex is then coloured by sampling field B at that
 * vertex (for example sign(λ₂)ρ, or an electrostatic potential) and mapping
 * the value through a colormap over a fixed range. Points outside the range
 * clamp to the end colours; that is the convention the published figures
 * use, so the bar in the UI matches what is on the surface.
 *
 * Conventions:
 *   - `bgr`: blue → green → red. NCI/IGMH usage: blue is strongly attractive
 *     (negative sign(λ₂)ρ), green is van der Waals (≈0), red is steric
 *     repulsion (positive).
 *   - `rwb`: red → white → blue. ESP usage: red is negative potential
 *     (nucleophilic), blue is positive (electrophilic).
 *
 * Pure functions, no three.js dependency, so the colour math is testable and
 * the same colours can be reproduced in the 2D colour bar.
 */

import { COLORMAP_OPTIONS, colormapJS, type ColormapName } from '../render/crystal-colormaps'

/**
 * `bgr` and `rwb` are the two domain conventions (IGMH/NCI, ESP) and are
 * defined here; every other name is one of the shared crystal colormaps also
 * used by the slice heatmap, so the surface, the slice and the panel preview
 * all draw from the same catalogue.
 */
export type SurfaceColormap = 'bgr' | 'rwb' | ColormapName

export const SURFACE_COLORMAP_OPTIONS: ReadonlyArray<{ value: SurfaceColormap; label: string }> = [
  { value: 'bgr', label: 'BGR (IGMH / NCI)' },
  { value: 'rwb', label: 'RWB (ESP)' },
  ...COLORMAP_OPTIONS,
]

export const SURFACE_COLORMAPS: readonly SurfaceColormap[] = SURFACE_COLORMAP_OPTIONS.map((o) => o.value)

export function isSurfaceColormap(value: unknown): value is SurfaceColormap {
  return typeof value === 'string' && (SURFACE_COLORMAPS as readonly string[]).includes(value)
}

type Rgb = readonly [number, number, number]

const DOMAIN_STOPS: Record<'bgr' | 'rwb', readonly Rgb[]> = {
  bgr: [
    [0.0, 0.0, 1.0],
    [0.0, 1.0, 0.0],
    [1.0, 0.0, 0.0],
  ],
  rwb: [
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 1.0],
    [0.0, 0.0, 1.0],
  ],
}

/** Map t ∈ [0, 1] to an RGB triple in [0, 1]. Values outside clamp. */
export function sampleColormap(colormap: SurfaceColormap, t: number): Rgb {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : Number.isNaN(t) ? 0.5 : t
  if (colormap !== 'bgr' && colormap !== 'rwb') return colormapJS(colormap, clamped)
  const stops = DOMAIN_STOPS[colormap]
  const scaled = clamped * (stops.length - 1)
  const index = Math.min(stops.length - 2, Math.floor(scaled))
  const frac = scaled - index
  const a = stops[index]
  const b = stops[index + 1]
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac, a[2] + (b[2] - a[2]) * frac]
}

export interface ColorRange {
  readonly min: number
  readonly max: number
}

export type FieldSampler = (x: number, y: number, z: number) => number

export interface ColorSurfaceResult {
  /** Interleaved RGB in [0, 1], three floats per vertex. */
  readonly colors: Float32Array
  /** Extremes of the sampled field over the surface, before clamping. */
  readonly sampled: ColorRange
}

export interface SampledField {
  /** One value per vertex. */
  readonly values: Float32Array
  readonly sampled: ColorRange
}

/** Sample `field` at every vertex (interleaved xyz). Cheap to keep; the
 *  expensive part is the trilinear lookup, so callers that need the range
 *  before choosing one sample once and map as many times as they like. */
export function sampleFieldAtVertices(vertices: Float32Array, field: FieldSampler): SampledField {
  const count = Math.floor(vertices.length / 3)
  const values = new Float32Array(count)
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let v = 0; v < count; v++) {
    const value = field(vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2])
    values[v] = value
    if (value < lo) lo = value
    if (value > hi) hi = value
  }
  if (count === 0) {
    lo = 0
    hi = 0
  }
  return { values, sampled: { min: lo, max: hi } }
}

/** Map sampled values through `colormap` over `range` to interleaved RGB. */
export function mapValuesToColors(values: Float32Array, colormap: SurfaceColormap, range: ColorRange): Float32Array {
  const colors = new Float32Array(values.length * 3)
  const span = range.max - range.min
  for (let v = 0; v < values.length; v++) {
    const t = span === 0 ? 0.5 : (values[v] - range.min) / span
    const [r, g, b] = sampleColormap(colormap, t)
    colors[v * 3] = r
    colors[v * 3 + 1] = g
    colors[v * 3 + 2] = b
  }
  return colors
}

/**
 * Produce per-vertex colours for `vertices` (interleaved xyz) by sampling
 * `field` and mapping through `colormap` over `range`.
 */
export function colorSurfaceByField(
  vertices: Float32Array,
  field: FieldSampler,
  colormap: SurfaceColormap,
  range: ColorRange,
): ColorSurfaceResult {
  const { values, sampled } = sampleFieldAtVertices(vertices, field)
  return { colors: mapValuesToColors(values, colormap, range), sampled }
}

/**
 * Default range when the user has not fixed one: symmetric about zero at the
 * larger absolute extreme, so zero always lands on the colormap midpoint
 * (green for bgr, white for rwb). A non-symmetric auto range would shift the
 * "neutral" colour off zero and misrepresent the sign of the field.
 */
export function symmetricRange(sampled: ColorRange): ColorRange {
  const bound = Math.max(Math.abs(sampled.min), Math.abs(sampled.max))
  if (!Number.isFinite(bound) || bound === 0) return { min: -1, max: 1 }
  return { min: -bound, max: bound }
}
