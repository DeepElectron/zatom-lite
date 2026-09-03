export interface PruneResult {
  positions: Float32Array
  elementIndex: Uint8Array
  grainId: Uint32Array
  basisIndex: Uint32Array
  count: number
}

/**
 * Remove atoms within `dmin` of an atom from a DIFFERENT grain. The lower-index
 * atom in a clashing pair is the deterministic winner (higher is dropped).
 * Intra-grain neighbours are never removed. dmin<=0 disables. Spatial-hash → ~O(N).
 */
export function pruneOverlaps(
  positions: Float32Array,
  grainId: Uint32Array,
  elementIndex: Uint8Array,
  basisIndex: Uint32Array,
  dmin: number,
): PruneResult {
  const n = grainId.length
  if (positions.length !== n * 3 || elementIndex.length !== n || basisIndex.length !== n) {
    throw new Error('Polycrystal overlap arrays must have identical atom counts')
  }
  if (dmin <= 0 || n === 0) {
    return {
      positions: positions.slice(),
      elementIndex: elementIndex.slice(),
      grainId: grainId.slice(),
      basisIndex: basisIndex.slice(),
      count: n,
    }
  }
  const dminSq = dmin * dmin
  const cell = dmin
  const buckets = new Map<string, number[]>()
  const ci = (x: number) => Math.floor(x / cell)
  const key = (i: number, j: number, k: number) => `${i},${j},${k}`
  for (let i = 0; i < n; i++) {
    const k = key(ci(positions[i * 3]), ci(positions[i * 3 + 1]), ci(positions[i * 3 + 2]))
    const b = buckets.get(k); if (b) b.push(i); else buckets.set(k, [i])
  }
  const removed = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (removed[i]) continue
    const xi = positions[i * 3], yi = positions[i * 3 + 1], zi = positions[i * 3 + 2]
    const bi = ci(xi), bj = ci(yi), bk = ci(zi)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++) {
          const b = buckets.get(key(bi + di, bj + dj, bk + dk))
          if (!b) continue
          for (const jdx of b) {
            if (jdx <= i || removed[jdx]) continue
            if (grainId[jdx] === grainId[i]) continue
            const dx = positions[jdx * 3] - xi, dy = positions[jdx * 3 + 1] - yi, dz = positions[jdx * 3 + 2] - zi
            if (dx * dx + dy * dy + dz * dz < dminSq) removed[jdx] = 1
          }
        }
  }
  let count = 0
  for (let i = 0; i < n; i++) if (!removed[i]) count++
  const op = new Float32Array(count * 3), oe = new Uint8Array(count), og = new Uint32Array(count), ob = new Uint32Array(count)
  let w = 0
  for (let i = 0; i < n; i++) {
    if (removed[i]) continue
    op[w * 3] = positions[i * 3]; op[w * 3 + 1] = positions[i * 3 + 1]; op[w * 3 + 2] = positions[i * 3 + 2]
    oe[w] = elementIndex[i]; og[w] = grainId[i]; ob[w] = basisIndex[i]; w++
  }
  return { positions: op, elementIndex: oe, grainId: og, basisIndex: ob, count }
}
