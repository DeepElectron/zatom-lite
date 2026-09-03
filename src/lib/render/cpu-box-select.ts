/**
 * CPU box-select for the compact viewer's degraded path (hard bone C, 10 million atoms). Above ~250k atoms
 * the GPU id-picker renders the full mesh offscreen and stalls, so box-select switches to a CPU pass
 * over tile-culled candidates. The exact per-atom test mirrors `ui/.../selection-box.tsx` byte-for-byte
 * (projected center in the screen rect, NDC z in [-1,1], inclusive bounds) so selection stays consistent
 * with the detail path. NOTE: selecting projected CENTRES is not equivalent to the GPU front-most
 * silhouette — it can include occluded centers and miss sphere edges whose center is outside the rect.
 *
 * Pure (no THREE): the caller injects a `project` closure (and owns the scratch Vector3, since
 * THREE's `Vector3.project` mutates its receiver), making this unit-testable in the node harness.
 */

/** A world point projected to CSS-pixel screen coords + its NDC z; null when the projection is non-finite. */
export interface Projected {
  sx: number
  sy: number
  ndcZ: number
}

export type ProjectFn = (x: number, y: number, z: number) => Projected | null

export interface ScreenRect {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface BoxSelectResult {
  /** selected atom indices, in candidate order */
  selected: number[]
  /** true when the exact-match selection was capped at selectedMax (more matches existed) */
  selectedTruncated: boolean
  /** true when testing stopped at candidateMax — UNKNOWN matches past the fence were NOT tested
  *  (distinct from selectedTruncated: this means "selection may be incomplete, narrow the box") */
  candidateTruncated: boolean
}

/** Inclusive screen-rect test, mirroring selection-box.tsx (finite centre, NDC z in [-1,1], inclusive bounds). */
export function isProjectedCenterInRect(p: Projected | null, rect: ScreenRect): boolean {
  if (!p) return false
  if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy) || !Number.isFinite(p.ndcZ)) return false
  if (p.ndcZ < -1 || p.ndcZ > 1) return false
  return p.sx >= rect.minX && p.sx <= rect.maxX && p.sy >= rect.minY && p.sy <= rect.maxY
}

/** Normalize two screen corners (any order) into a min/max rect. */
export function normalizeScreenRect(a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect {
  return {
    minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
  }
}

/**
 * Select candidates whose projected centre falls inside the screen rect, FUSING the exact filter
 * into the (lazy) candidate stream. `candidates` is any iterable — pass `AtomTileGrid.frustumCandidates`
 * directly so culling stays lazy. The exact filter runs per candidate (so early out-of-box candidates
 * never hide later in-box matches — the false-negative a pre-filter candidate cap would cause).
 *
 * Two independent fences, both surfaced:
 *  - `selectedMax`: primary cap on exact MATCHES (selectedTruncated) — "more matches existed".
 *  - `candidateMax`: responsiveness fence on atoms TESTED (candidateTruncated) — "selection may be
 *    incomplete, untested matches past the fence". Keep this high so it rarely trips on a real box.
 */
export function boxSelectByProjection(
  positions: Float32Array,
  candidates: Iterable<number>,
  project: ProjectFn,
  boxStart: { x: number; y: number },
  boxEnd: { x: number; y: number },
  candidateMax: number,
  selectedMax: number,
): BoxSelectResult {
  const rect = normalizeScreenRect(boxStart, boxEnd)
  const selected: number[] = []
  let tested = 0
  for (const idx of candidates) {
    if (tested >= candidateMax) return { selected, selectedTruncated: false, candidateTruncated: true }
    tested++
    const p = project(positions[idx * 3], positions[idx * 3 + 1], positions[idx * 3 + 2])
    if (!isProjectedCenterInRect(p, rect)) continue
    if (selected.length >= selectedMax) return { selected, selectedTruncated: true, candidateTruncated: false }
    selected.push(idx)
  }
  return { selected, selectedTruncated: false, candidateTruncated: false }
}
