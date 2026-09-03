type Vec3 = [number, number, number]

/**
 * Uniform spatial hash grid over a flat xyz Float32Array. Supports
 * neighborhood(centerIndex, radius) and a coarse raycastNearest(origin, dir).
 * Foundation for hybrid focus (B1) and bulk picking (B3).
 */
export class AtomSpatialGrid {
  private positions: Float32Array
  private cell: number
  private minX = Infinity; private minY = Infinity; private minZ = Infinity
  private nx = 1; private ny = 1; private nz = 1
  private buckets: Map<number, number[]> = new Map()
  constructor(positions: Float32Array, boxSize: number) {
    this.positions = positions
    const n = positions.length / 3
    // ~1 atom per cell on average, clamped to a sane minimum
    this.cell = Math.max(boxSize / Math.max(1, Math.cbrt(n)), 1e-3)
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2]
      if (x < this.minX) this.minX = x; if (y < this.minY) this.minY = y; if (z < this.minZ) this.minZ = z
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
    }
    if (n === 0) { this.minX = this.minY = this.minZ = 0; maxX = maxY = maxZ = 0 }
    this.nx = Math.max(1, Math.floor((maxX - this.minX) / this.cell) + 1)
    this.ny = Math.max(1, Math.floor((maxY - this.minY) / this.cell) + 1)
    this.nz = Math.max(1, Math.floor((maxZ - this.minZ) / this.cell) + 1)
    for (let i = 0; i < n; i++) {
      const key = this.cellKey(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      const b = this.buckets.get(key); if (b) b.push(i); else this.buckets.set(key, [i])
    }
  }
  private ci(v: number, min: number) { return Math.floor((v - min) / this.cell) }
  private key(i: number, j: number, k: number) { return (i * this.ny + j) * this.nz + k }
  private cellKey(x: number, y: number, z: number) {
    return this.key(this.ci(x, this.minX), this.ci(y, this.minY), this.ci(z, this.minZ))
  }
  /** Indices within `radius` (Å) of atom `centerIndex`. */
  neighborhood(centerIndex: number, radius: number): number[] {
    const p = this.positions
    const cx = p[centerIndex * 3], cy = p[centerIndex * 3 + 1], cz = p[centerIndex * 3 + 2]
    const r2 = radius * radius
    const span = Math.ceil(radius / this.cell)
    const bi = this.ci(cx, this.minX), bj = this.ci(cy, this.minY), bk = this.ci(cz, this.minZ)
    const out: number[] = []
    for (let di = -span; di <= span; di++)
      for (let dj = -span; dj <= span; dj++)
        for (let dk = -span; dk <= span; dk++) {
          const b = this.buckets.get(this.key(bi + di, bj + dj, bk + dk))
          if (!b) continue
          for (const idx of b) {
            const dx = p[idx * 3] - cx, dy = p[idx * 3 + 1] - cy, dz = p[idx * 3 + 2] - cz
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(idx)
          }
        }
    return out
  }
  /**
  * Nearest atom whose center is within `pickRadius` of the ray, taking the one
  * with the smallest positive t (closest along the ray). Brute over all atoms —
  * fine for a single click; B3 replaces with grid traversal / GPU id.
  */
  raycastNearest(origin: Vec3, dir: Vec3, pickRadius: number): number {
    const p = this.positions
    const n = p.length / 3
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl
    const pr2 = pickRadius * pickRadius
    let best = -1, bestT = Infinity
    for (let i = 0; i < n; i++) {
      const ox = p[i * 3] - origin[0], oy = p[i * 3 + 1] - origin[1], oz = p[i * 3 + 2] - origin[2]
      const t = ox * dx + oy * dy + oz * dz            // projection onto ray
      if (t < 0) continue
      const px = ox - t * dx, py = oy - t * dy, pz = oz - t * dz   // perpendicular offset
      if (px * px + py * py + pz * pz <= pr2 && t < bestT) { bestT = t; best = i }
    }
    return best
  }

  /**
  * Grid-accelerated twin of `raycastNearest`: returns the SAME atom index but visits only the
  * fine cells the ray passes through (Amanatides–Woo DDA) widened by a pickRadius band, instead
  * of scanning every atom. Candidates are gathered, then run through the identical scalar test
  * in ascending index order, so the result is byte-identical to the brute oracle (same tie-break:
  * lowest index on equal t). Suited to ≤~2M atoms — beyond that the per-cell `Map<number,number[]>`
  * dominates and a packed (sorted-key + offset) grid is the next step.
  */
  raycastNearestGridded(origin: Vec3, dir: Vec3, pickRadius: number): number {
    const p = this.positions
    const n = p.length / 3
    if (n === 0) return -1
    const dl = Math.hypot(dir[0], dir[1], dir[2])
    // Non-finite / zero inputs make span, maxSteps and the box interval Infinity/NaN so the DDA
    // can't bound itself (it would never reach tEnd); the brute oracle is well-defined for them,
    // so delegate — this also keeps exact equivalence for ±Infinity/NaN pickRadius and zero dir.
    if (!Number.isFinite(pickRadius) || !Number.isFinite(dl) || dl === 0) return this.raycastNearest(origin, dir, pickRadius)
    const r = Math.abs(pickRadius)
    const span = Math.max(1, Math.ceil(r / this.cell))
    // Gridding is a net loss once the walk would probe as many cells as a linear scan visits atoms
    // — a large band engulfing the grid, or a tiny grid — so fall back to brute there (also bounds work).
    const bandCells = Math.min(2 * span + 1, this.nx) * Math.min(2 * span + 1, this.ny) * Math.min(2 * span + 1, this.nz)
    if ((this.nx + this.ny + this.nz + 6 * span + 6) * bandCells >= n) return this.raycastNearest(origin, dir, pickRadius)
    const dx = dir[0] / dl, dy = dir[1] / dl, dz = dir[2] / dl       // identical normalization to brute
    const candidates = this.collectRayCandidates(origin, dx, dy, dz, r)
    if (candidates.size === 0) return -1
    const sorted = Array.from(candidates).sort((a, b) => a - b)      // ascending index → lowest wins ties
    const pr2 = pickRadius * pickRadius
    let best = -1, bestT = Infinity
    for (const i of sorted) {
      const ox = p[i * 3] - origin[0], oy = p[i * 3 + 1] - origin[1], oz = p[i * 3 + 2] - origin[2]
      const t = ox * dx + oy * dy + oz * dz
      if (t < 0) continue
      const px = ox - t * dx, py = oy - t * dy, pz = oz - t * dz
      if (px * px + py * py + pz * pz <= pr2 && t < bestT) { bestT = t; best = i }
    }
    return best
  }

  /**
  * Atoms in every fine cell within `span` of a cell the forward ray (unit dir) passes through,
  * span = max(1, ceil(pickRadius/cell)). The foot of any atom within `pickRadius` of the ray lies
  * in a cell the ray crosses, so that atom is within `span` of a visited cell → this is a SUPERSET
  * of all qualifying atoms and the caller's exact scalar test reproduces the brute result.
  */
  private collectRayCandidates(origin: Vec3, dx: number, dy: number, dz: number, pickRadius: number): Set<number> {
    const out = new Set<number>()
    const processed = new Set<number>() // cell keys already scanned, so overlapping bands don't rescan
    const cell = this.cell
    const span = Math.max(1, Math.ceil(pickRadius / cell))
    // Grid AABB expanded by pickRadius — a ray grazing just outside the grid still has qualifying atoms.
    const loX = this.minX - pickRadius, loY = this.minY - pickRadius, loZ = this.minZ - pickRadius
    const hiX = this.minX + this.nx * cell + pickRadius
    const hiY = this.minY + this.ny * cell + pickRadius
    const hiZ = this.minZ + this.nz * cell + pickRadius
    const interval = this.rayBoxInterval(origin, dx, dy, dz, loX, loY, loZ, hiX, hiY, hiZ)
    if (!interval) return out
    const tStart = Math.max(0, interval[0])
    const tEnd = interval[1]
    if (tEnd < tStart) return out

    // Amanatides–Woo over VIRTUAL cell indices (may fall outside [0,n)); only `addBand` fetches
    // in-bounds buckets, because `key(i,j,k)` is unique only for in-range indices.
    const sx = origin[0] + tStart * dx, sy = origin[1] + tStart * dy, sz = origin[2] + tStart * dz
    let vi = Math.floor((sx - this.minX) / cell)
    let vj = Math.floor((sy - this.minY) / cell)
    let vk = Math.floor((sz - this.minZ) / cell)
    const stepI = dx > 0 ? 1 : -1, stepJ = dy > 0 ? 1 : -1, stepK = dz > 0 ? 1 : -1
    const tDeltaX = dx !== 0 ? Math.abs(cell / dx) : Infinity
    const tDeltaY = dy !== 0 ? Math.abs(cell / dy) : Infinity
    const tDeltaZ = dz !== 0 ? Math.abs(cell / dz) : Infinity
    const boundary = (v: number, step: number, min: number) => min + (step > 0 ? v + 1 : v) * cell
    let tMaxX = dx !== 0 ? (boundary(vi, stepI, this.minX) - origin[0]) / dx : Infinity
    let tMaxY = dy !== 0 ? (boundary(vj, stepJ, this.minY) - origin[1]) / dy : Infinity
    let tMaxZ = dz !== 0 ? (boundary(vk, stepK, this.minZ) - origin[2]) / dz : Infinity

    // Steps to cross the expanded box: ≤ cells spanned per axis (grid + 2·span margin each) + slack.
    const maxSteps = this.nx + this.ny + this.nz + 6 * span + 6
    this.addBand(out, processed, vi, vj, vk, span)
    for (let s = 0; s < maxSteps; s++) {
      let tNext: number
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { tNext = tMaxX; vi += stepI; tMaxX += tDeltaX }
      else if (tMaxY <= tMaxZ) { tNext = tMaxY; vj += stepJ; tMaxY += tDeltaY }
      else { tNext = tMaxZ; vk += stepK; tMaxZ += tDeltaZ }
      if (tNext > tEnd) break
      this.addBand(out, processed, vi, vj, vk, span)
    }
    return out
  }

  /** Add every atom in the in-bounds fine cells within `span` (Chebyshev) of virtual cell (vi,vj,vk),
  *  skipping cells already scanned by an earlier (overlapping) band. */
  private addBand(out: Set<number>, processed: Set<number>, vi: number, vj: number, vk: number, span: number) {
    const i0 = Math.max(0, vi - span), i1 = Math.min(this.nx - 1, vi + span)
    const j0 = Math.max(0, vj - span), j1 = Math.min(this.ny - 1, vj + span)
    const k0 = Math.max(0, vk - span), k1 = Math.min(this.nz - 1, vk + span)
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++)
        for (let k = k0; k <= k1; k++) {
          const ck = this.key(i, j, k)
          if (processed.has(ck)) continue
          processed.add(ck)
          const b = this.buckets.get(ck)
          if (b) for (const idx of b) out.add(idx)
        }
  }

  /** Ray ∩ AABB as a [tEnter, tExit] interval (slab method), or null if the ray misses the box. */
  private rayBoxInterval(o: Vec3, dx: number, dy: number, dz: number, loX: number, loY: number, loZ: number, hiX: number, hiY: number, hiZ: number): [number, number] | null {
    let tmin = -Infinity, tmax = Infinity
    const slab = (oc: number, d: number, lo: number, hi: number): boolean => {
      if (d === 0) return oc >= lo && oc <= hi // parallel to this slab: only hits if already inside it
      let t1 = (lo - oc) / d, t2 = (hi - oc) / d
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tmin) tmin = t1
      if (t2 < tmax) tmax = t2
      return true
    }
    if (!slab(o[0], dx, loX, hiX)) return null
    if (!slab(o[1], dy, loY, hiY)) return null
    if (!slab(o[2], dz, loZ, hiZ)) return null
    if (tmax < tmin) return null
    return [tmin, tmax]
  }
}
