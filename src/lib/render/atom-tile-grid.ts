type Vec3 = [number, number, number]

/**
 * Coarse, FIXED-edge world-space tile grid over a compact structure — the candidate-culling
 * structure for hard bone C (ten million atoms) box-select (250k–1M, tile-scoped) and >2M tile-focus pick.
 * Unlike the adaptive `AtomSpatialGrid` (~1 atom/cell), tiles are sized by
 * `compact-lod.ts:compactTileEdge` (~64 Å for Si ≈ thousands of atoms/tile), so a frustum/ray cull
 * scans tens of tiles instead of millions of atoms.
 *
 * Only NON-EMPTY tiles are stored, sorted lexicographically by (i,j,k) — a structure with vacuum
 * or a far outlier blows up `nx*ny*nz` but never the stored-tile count, so iteration stays bounded.
 * Tile keys are STRINGS (`i:j:k`): a packed numeric key `(i*ny+j)*nz+k` collapses distinct tiles to
 * one JS number once the product exceeds 2^53, silently mis-bucketing atoms (false-negative culling).
 *
 * `frustumCandidates` is a LAZY generator (no internal cap) so the caller fuses the exact per-atom
 * filter and caps on SELECTED count — capping candidate INDICES before filtering loses matches.
 * Pure (no THREE): callers inject world-space frustum planes / rays so it is unit-testable.
 */

export interface TileAabb {
  min: Vec3
  max: Vec3
}

/** Half-space with inward normal: a point p is inside when nx·px + ny·py + nz·pz + c ≥ 0. */
export interface FrustumPlane {
  nx: number
  ny: number
  nz: number
  c: number
}

export interface TileCandidateResult {
  /** atom indices in lexicographic-tile then ascending-in-tile order */
  indices: number[]
  /** true when collection stopped at maxAtoms (more atoms qualified) — a responsiveness fence, not silent */
  truncated: boolean
}

interface Tile {
  i: number
  j: number
  k: number
  atoms: number[]
}

export class AtomTileGrid {
  readonly edge: number
  private minX: number; private minY: number; private minZ: number
  /** non-empty tiles, sorted lexicographically by (i,j,k) */
  private tiles: Tile[]

  constructor(positions: Float32Array, bbox: { min: Vec3; max: Vec3 }, edge: number) {
    this.edge = Number.isFinite(edge) && edge > 0 ? edge : 1
    // The tile ORIGIN stays at the structural bbox.min; tile indices are NOT clamped to a nominal grid
    // size, so an atom OUTSIDE the bbox (e.g. a displaced trajectory buffer escaping the static
    // compact.bbox) lands in its own negative/over-range tile whose AABB CONTAINS it — never clamped
    // into an edge tile that excludes it (which the frustum/ray cull would then silently drop). In-bbox
    // atoms keep stable structural-bbox tiles regardless of any out-of-bbox outlier (no origin shift).
    this.minX = bbox.min[0]; this.minY = bbox.min[1]; this.minZ = bbox.min[2]
    const n = positions.length / 3
    const byKey = new Map<string, Tile>()
    for (let a = 0; a < n; a++) {
      const i = this.tileIdx(positions[a * 3], this.minX)
      const j = this.tileIdx(positions[a * 3 + 1], this.minY)
      const k = this.tileIdx(positions[a * 3 + 2], this.minZ)
      const key = `${i}:${j}:${k}` // string key avoids packed-numeric collision past 2^53
      let tile = byKey.get(key)
      if (!tile) { tile = { i, j, k, atoms: [] }; byKey.set(key, tile) }
      tile.atoms.push(a) // ascending atom index, since `a` increases
    }
    this.tiles = Array.from(byKey.values()).sort((x, y) => x.i - y.i || x.j - y.j || x.k - y.k)
  }

  /** Tile index along one axis — unclamped, so an out-of-bbox atom gets its own containing tile. */
  private tileIdx(v: number, min: number): number {
    return Math.floor((v - min) / this.edge)
  }

  /** Axis-aligned bounds of tile (i,j,k) in world Å — O(1), deterministic. */
  tileAabb(i: number, j: number, k: number): TileAabb {
    return {
      min: [this.minX + i * this.edge, this.minY + j * this.edge, this.minZ + k * this.edge],
      max: [this.minX + (i + 1) * this.edge, this.minY + (j + 1) * this.edge, this.minZ + (k + 1) * this.edge],
    }
  }

  /**
  * Lazily yield atom indices in every tile NOT fully outside the inward-facing frustum `planes`
  * (positive-vertex AABB test). Conservative superset: never drops a tile with any point inside, so
  * the caller's exact per-atom filter reproduces the true selection. NO internal cap — the caller
  * fuses the exact filter and caps on selected count, so capping candidates here can't lose matches.
  */
  *frustumCandidates(planes: FrustumPlane[]): Generator<number> {
    for (const t of this.tiles) {
      if (this.aabbOutsideFrustum(this.tileAabb(t.i, t.j, t.k), planes)) continue
      for (const a of t.atoms) yield a
    }
  }

  /**
  * Atom indices in every tile the forward ray (origin + t·dir, t≥0) passes within `pickRadius` of.
  * Each tile AABB is inflated by `pickRadius` before the slab test, so an atom whose centre sits just
  * across a tile face the ray centreline never enters is still offered (mirrors AtomSpatialGrid's band).
  * Superset: if an atom in tile B has its closest ray point within r, each coord of that point is within
  * r of the atom, so it lies in B grown by r — the inflated slab cannot miss the tile. Stops at maxAtoms.
  */
  collectRayCandidates(origin: Vec3, dir: Vec3, pickRadius: number, maxAtoms: number): TileCandidateResult {
    const pad = Math.abs(pickRadius)
    const indices: number[] = []
    for (const t of this.tiles) {
      if (!this.rayHitsAabb(origin, dir, this.tileAabb(t.i, t.j, t.k), pad)) continue
      for (const a of t.atoms) {
        if (indices.length >= maxAtoms) return { indices, truncated: true }
        indices.push(a)
      }
    }
    return { indices, truncated: false }
  }

  /** True if the AABB is entirely outside at least one plane (its positive vertex fails that plane). */
  private aabbOutsideFrustum(box: TileAabb, planes: FrustumPlane[]): boolean {
    for (const pl of planes) {
      // positive vertex = the corner maximizing n·p
      const px = pl.nx >= 0 ? box.max[0] : box.min[0]
      const py = pl.ny >= 0 ? box.max[1] : box.min[1]
      const pz = pl.nz >= 0 ? box.max[2] : box.min[2]
      if (pl.nx * px + pl.ny * py + pl.nz * pz + pl.c < 0) return true // whole box on the outside
    }
    return false
  }

  /** Slab test for a forward ray (t≥0) against an AABB inflated by `pad` (the pickRadius band) on each axis. */
  private rayHitsAabb(o: Vec3, dir: Vec3, box: TileAabb, pad: number): boolean {
    let tmin = -Infinity, tmax = Infinity
    for (let ax = 0; ax < 3; ax++) {
      const d = dir[ax], oc = o[ax], lo = box.min[ax] - pad, hi = box.max[ax] + pad
      if (d === 0) { if (oc < lo || oc > hi) return false; continue }
      let t1 = (lo - oc) / d, t2 = (hi - oc) / d
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
      if (t1 > tmin) tmin = t1
      if (t2 < tmax) tmax = t2
    }
    return tmax >= tmin && tmax >= 0 // intersection exists and is not entirely behind the origin
  }
}
