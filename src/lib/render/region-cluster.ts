/**
 * Layer ② of the dynamic region pipeline: group atoms into spatially-connected
 * clusters of equal label (label = species / grain / phase class — layer ① supplies it).
 *
 * Positions are STATIC across a species trajectory, so the neighbor graph is built
 * ONCE (buildNeighborPairs); per frame only the equal-label union-find re-runs
 * (clusterFromPairs) — milliseconds at 150k atoms.
 */

export interface ClusterRegions {
  /** per-atom region id (compacted 0..n-1); -1 = filtered noise (cluster < minSize) */
  regionOf: Int32Array
  /** unique region ids, ascending (0..n-1) */
  regionIds: number[]
  /** regionId → label — color by label so region colors stay stable across frames */
  regionLabel: number[]
}

/** Median nearest-neighbor distance of a sample × factor → connectivity cutoff guess. */
export function estimateNeighborCutoff(positions: Float32Array, count: number, factor = 1.35): number {
  if (count < 2) return factor
  const SAMPLES = Math.min(64, count)
  const stride = Math.max(1, Math.floor(count / SAMPLES))
  const dists: number[] = []
  for (let s = 0; s < count && dists.length < SAMPLES; s += stride) {
    const x = positions[s * 3], y = positions[s * 3 + 1], z = positions[s * 3 + 2]
    let best = Infinity
    // brute-force NN over a capped scan window around s (positions from generators are
    // spatially coherent, so nearby indices ≈ nearby atoms; exact NN is not required —
    // the median over 64 samples is robust to a few overestimates)
    const from = Math.max(0, s - 2048), to = Math.min(count, s + 2048)
    for (let j = from; j < to; j++) {
      if (j === s) continue
      const dx = positions[j * 3] - x, dy = positions[j * 3 + 1] - y, dz = positions[j * 3 + 2] - z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < best) best = d2
    }
    if (Number.isFinite(best)) dists.push(Math.sqrt(best))
  }
  dists.sort((a, b) => a - b)
  return (dists[Math.floor(dists.length / 2)] || 1) * factor
}

/**
 * Undirected neighbor pairs [a0,b0,a1,b1,…] with |pi−pj| ≤ cutoff, via a uniform grid
 * (cell = cutoff). Each pair appears once (a < b by scan order).
 */
export function buildNeighborPairs(positions: Float32Array, count: number, cutoff: number): Uint32Array {
  const cell = cutoff
  const inv = 1 / cell
  const c2 = cutoff * cutoff
  // hash voxel coords → atom list
  const grid = new Map<number, number[]>()
  const key = (ix: number, iy: number, iz: number) => ((ix + 1024) * 4096 + (iy + 1024)) * 4096 + (iz + 1024)
  const ix = new Int32Array(count), iy = new Int32Array(count), iz = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    ix[i] = Math.floor(positions[i * 3] * inv)
    iy[i] = Math.floor(positions[i * 3 + 1] * inv)
    iz[i] = Math.floor(positions[i * 3 + 2] * inv)
    const k = key(ix[i], iy[i], iz[i])
    const list = grid.get(k)
    if (list) list.push(i)
    else grid.set(k, [i])
  }
  const pairs: number[] = []
  for (let i = 0; i < count; i++) {
    const xi = positions[i * 3], yi = positions[i * 3 + 1], zi = positions[i * 3 + 2]
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(key(ix[i] + dx, iy[i] + dy, iz[i] + dz))
      if (!list) continue
      for (const j of list) {
        if (j <= i) continue // each pair once
        const ddx = positions[j * 3] - xi, ddy = positions[j * 3 + 1] - yi, ddz = positions[j * 3 + 2] - zi
        if (ddx * ddx + ddy * ddy + ddz * ddz <= c2) { pairs.push(i, j) }
      }
    }
  }
  return Uint32Array.from(pairs)
}

/** Union-find over equal-label pairs → connected equal-label clusters (+ minSize filter). */
export function clusterFromPairs(
  pairs: Uint32Array,
  labels: ArrayLike<number>,
  count: number,
  minSize: number,
): ClusterRegions {
  const parent = new Int32Array(count)
  for (let i = 0; i < count; i++) parent[i] = i
  const find = (i: number): number => {
    let r = i
    while (parent[r] !== r) r = parent[r]
    while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n }
    return r
  }
  for (let p = 0; p < pairs.length; p += 2) {
    const a = pairs[p], b = pairs[p + 1]
    if (labels[a] !== labels[b]) continue
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  // component sizes
  const size = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const r = find(i)
    size.set(r, (size.get(r) ?? 0) + 1)
  }
  // compact region ids over roots that pass minSize (scan order → deterministic)
  const regionOfRoot = new Map<number, number>()
  const regionLabel: number[] = []
  const regionOf = new Int32Array(count)
  for (let i = 0; i < count; i++) {
    const r = find(i)
    if ((size.get(r) ?? 0) < minSize) { regionOf[i] = -1; continue }
    let id = regionOfRoot.get(r)
    if (id === undefined) {
      id = regionLabel.length
      regionOfRoot.set(r, id)
      regionLabel.push(Number(labels[r]))
    }
    regionOf[i] = id
  }
  const regionIds = regionLabel.map((_, i) => i)
  return { regionOf, regionIds, regionLabel }
}
