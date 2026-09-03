type Vec3 = [number, number, number]

/**
 * Place `count` seed points uniformly in [0,boxSize]^3. If `minDist`>0, reject
 * candidates closer than minDist to an accepted seed. A request that cannot be
 * satisfied within the deterministic search budget fails instead of silently
 * accepting a constraint violation.
 */
export function placeSeeds(count: number, boxSize: number, minDist: number, rng: () => number): Vec3[] {
  const seeds: Vec3[] = []
  const minSq = minDist * minDist
  const maxTriesPerSeed = 4096
  for (let i = 0; i < count; i++) {
    let placed: Vec3 | null = null
    for (let t = 0; t < (minDist > 0 ? maxTriesPerSeed : 1); t++) {
      const cand: Vec3 = [rng() * boxSize, rng() * boxSize, rng() * boxSize]
      if (minDist <= 0) { placed = cand; break }
      let ok = true
      for (const s of seeds) {
        const dx = s[0] - cand[0], dy = s[1] - cand[1], dz = s[2] - cand[2]
        if (dx * dx + dy * dy + dz * dz < minSq) { ok = false; break }
      }
      if (ok) { placed = cand; break }
    }
    if (!placed) {
      throw new Error(
        `Could not place seed ${i + 1}/${count} at minimum separation ${minDist} Å inside a ${boxSize} Å box`,
      )
    }
    seeds.push(placed)
  }
  return seeds
}

/** Brute-force nearest-seed index — reference for tests and small N. */
export function nearestSeedBruteForce(p: Vec3, seeds: Vec3[]): number {
  let best = -1, bestSq = Infinity
  for (let i = 0; i < seeds.length; i++) {
    const dx = seeds[i][0] - p[0], dy = seeds[i][1] - p[1], dz = seeds[i][2] - p[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < bestSq) { bestSq = d; best = i }
  }
  return best
}

/**
 * Uniform spatial grid over seeds for O(1)-avg nearest-seed queries. Searches an
 * expanding Chebyshev ring of cells until the nearest candidate cannot be beaten
 * by any unsearched ring.
 */
export class SeedGrid {
  private seeds: Vec3[]
  private cell: number
  private nx: number
  private buckets: Map<number, number[]> = new Map()
  constructor(seeds: Vec3[], boxSize: number) {
    this.seeds = seeds
    // ~1 seed per cell on average
    const n = Math.max(1, Math.cbrt(seeds.length))
    this.cell = Math.max(1e-6, boxSize / n)
    this.nx = Math.max(1, Math.ceil(boxSize / this.cell) + 1)
    seeds.forEach((s, i) => {
      const key = this.key(this.ci(s[0]), this.ci(s[1]), this.ci(s[2]))
      const b = this.buckets.get(key)
      if (b) b.push(i); else this.buckets.set(key, [i])
    })
  }
  private ci(x: number) { return Math.floor(x / this.cell) }
  private key(i: number, j: number, k: number) { return (i * this.nx + j) * this.nx + k }
  nearest(p: Vec3): number {
    const ci = this.ci(p[0]), cj = this.ci(p[1]), ck = this.ci(p[2])
    let best = -1, bestSq = Infinity
    for (let r = 0; r < this.nx; r++) {
      // scan the shell at Chebyshev radius r
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++)
          for (let dk = -r; dk <= r; dk++) {
            if (Math.max(Math.abs(di), Math.abs(dj), Math.abs(dk)) !== r) continue
            const b = this.buckets.get(this.key(ci + di, cj + dj, ck + dk))
            if (!b) continue
            for (const idx of b) {
              const s = this.seeds[idx]
              const dx = s[0] - p[0], dy = s[1] - p[1], dz = s[2] - p[2]
              const d = dx * dx + dy * dy + dz * dz
              if (d < bestSq) { bestSq = d; best = idx }
            }
          }
      // once we have a candidate, stop when the closest possible seed in the
      // next ring (≥ r*cell away) cannot beat the current best.
      if (best >= 0 && (r * this.cell) * (r * this.cell) > bestSq) break
    }
    return best
  }
}
