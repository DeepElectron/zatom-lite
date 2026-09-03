/**
 * Locate the extrema of a scalar field sampled on an isosurface.
 *
 * Used for ESP surface minima/maxima (the classic Multiwfn "surface analysis"
 * markers), and equally for the sign(λ₂)ρ extremes on an IGMH surface.
 *
 * Method: a vertex is an extremum when it holds the strictest value among all
 * surface vertices within `separation` Å of it — a genuine local extremum on
 * the surface, not merely "far from the ones picked so far". Ties are broken by
 * index so a flat patch yields one marker, not a cluster. This needs no mesh
 * adjacency and is stable against the irregular vertex spacing marching cubes
 * produces; on a smooth field it returns the handful of real minima/maxima and
 * never pads the result up to `maxPerKind` with saddle noise.
 *
 * Cost is O(n · k) with k the vertices in each neighbourhood, via a uniform
 * grid of cell size `separation`.
 *
 * Units: vertex positions are in whatever unit the geometry uses (Å in this
 * app); `separation` is in the same unit.
 */

export interface SurfaceExtremum {
  readonly kind: 'min' | 'max'
  readonly value: number
  readonly position: readonly [number, number, number]
}

export interface ExtremaOptions {
  /** Minimum distance between two accepted extrema of the same kind. */
  separation?: number
  /** Cap per kind; the strongest ones win. */
  maxPerKind?: number
}

const DEFAULTS: Required<ExtremaOptions> = { separation: 1.5, maxPerKind: 8 }

export function findSurfaceExtrema(
  vertices: Float32Array,
  values: Float32Array,
  options: ExtremaOptions = {},
): SurfaceExtremum[] {
  const { separation, maxPerKind } = { ...DEFAULTS, ...options }
  const count = Math.min(values.length, Math.floor(vertices.length / 3))
  if (count === 0) return []

  // Uniform grid keyed by cell coordinates; neighbourhood = the 27 cells around.
  const inv = 1 / separation
  const cellOf = (i: number) =>
    `${Math.floor(vertices[i * 3] * inv)},${Math.floor(vertices[i * 3 + 1] * inv)},${Math.floor(vertices[i * 3 + 2] * inv)}`
  const grid = new Map<string, number[]>()
  for (let i = 0; i < count; i++) {
    const key = cellOf(i)
    const bucket = grid.get(key)
    if (bucket) bucket.push(i)
    else grid.set(key, [i])
  }

  const sep2 = separation * separation
  const minima: SurfaceExtremum[] = []
  const maxima: SurfaceExtremum[] = []

  for (let i = 0; i < count; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    const x = vertices[i * 3]
    const y = vertices[i * 3 + 1]
    const z = vertices[i * 3 + 2]
    const cx = Math.floor(x * inv)
    const cy = Math.floor(y * inv)
    const cz = Math.floor(z * inv)
    let isMin = true
    let isMax = true
    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!bucket) continue
          for (const j of bucket) {
            if (j === i) continue
            const ex = vertices[j * 3] - x
            const ey = vertices[j * 3 + 1] - y
            const ez = vertices[j * 3 + 2] - z
            if (ex * ex + ey * ey + ez * ez >= sep2) continue
            const w = values[j]
            // Ties resolved by index so a plateau produces exactly one marker.
            if (w < v || (w === v && j < i)) isMin = false
            if (w > v || (w === v && j < i)) isMax = false
            if (!isMin && !isMax) break outer
          }
        }
      }
    }
    if (isMin) minima.push({ kind: 'min', value: v, position: [x, y, z] })
    if (isMax) maxima.push({ kind: 'max', value: v, position: [x, y, z] })
  }

  minima.sort((a, b) => a.value - b.value)
  maxima.sort((a, b) => b.value - a.value)
  return [...minima.slice(0, maxPerKind), ...maxima.slice(0, maxPerKind)]
}
