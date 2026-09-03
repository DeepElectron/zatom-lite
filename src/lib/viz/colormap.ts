/**
 * Reusable perceptual colormaps for scalar-field visualisation (iso-surface
 * vertex colours, colorbars, heatmaps). Each maps t ∈ [0,1] → [r,g,b] in 0..1.
 *
 * Anchor-stop colormaps with linear interpolation — compact, no deps. Used by
 * the porosity / void-surface tool and reusable for charge-density fields.
 */

export type ColormapName = "viridis" | "coolwarm" | "turbo" | "magma"

type Stop = [number, [number, number, number]] // t, rgb(0..1)

const VIRIDIS: Stop[] = [
  [0.0, [0.267, 0.005, 0.329]],
  [0.25, [0.231, 0.318, 0.545]],
  [0.5, [0.128, 0.567, 0.551]],
  [0.75, [0.369, 0.789, 0.383]],
  [1.0, [0.993, 0.906, 0.144]],
]

const COOLWARM: Stop[] = [
  [0.0, [0.231, 0.298, 0.753]],
  [0.5, [0.865, 0.865, 0.865]],
  [1.0, [0.706, 0.016, 0.150]],
]

const TURBO: Stop[] = [
  [0.0, [0.190, 0.072, 0.232]],
  [0.25, [0.106, 0.624, 0.890]],
  [0.5, [0.510, 0.992, 0.420]],
  [0.75, [0.969, 0.620, 0.176]],
  [1.0, [0.480, 0.012, 0.012]],
]

const MAGMA: Stop[] = [
  [0.0, [0.001, 0.000, 0.014]],
  [0.25, [0.232, 0.060, 0.438]],
  [0.5, [0.551, 0.161, 0.506]],
  [0.75, [0.888, 0.353, 0.349]],
  [1.0, [0.987, 0.991, 0.749]],
]

const MAPS: Record<ColormapName, Stop[]> = {
  viridis: VIRIDIS,
  coolwarm: COOLWARM,
  turbo: TURBO,
  magma: MAGMA,
}

/** Sample a colormap at t ∈ [0,1] → [r,g,b] in 0..1 (clamped). */
export function sampleColormap(name: ColormapName, t: number): [number, number, number] {
  const stops = MAPS[name] ?? VIRIDIS
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]
      const [t1, c1] = stops[i]
      const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f]
    }
  }
  return stops[stops.length - 1][1]
}

/** CSS `linear-gradient(...)` string for a colorbar swatch (left→right = 0→1). */
export function colormapGradientCss(name: ColormapName, steps = 16): string {
  const parts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [r, g, b] = sampleColormap(name, t)
    parts.push(`rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${Math.round(t * 100)}%`)
  }
  return `linear-gradient(to right, ${parts.join(", ")})`
}

export const COLORMAP_NAMES: ColormapName[] = ["viridis", "coolwarm", "turbo", "magma"]
