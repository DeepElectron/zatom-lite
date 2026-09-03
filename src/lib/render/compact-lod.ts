/**
 * Level-of-detail policy for the compact atom viewer. A single InstancedMesh of sphere impostors with
 * `frustumCulled={false}`, a GPU id-picker that builds full per-atom buffers, and
 * `AtomSpatialGrid.raycastNearest` (brute over all atoms) all fail at scale through the
 * SELECTION/PICKING path before raw drawing fails. So past a threshold the renderer must
 * deliberately degrade: GL points instead of sphere impostors, CPU tile picking instead of
 * the full-atom GPU picker, and tile-scoped (then disabled) box-select.
 *
 * 250k is a conservative starting point that stays close to the preview cap and within a typical
 * browser-tab memory budget; the true crossover can be adjusted after in-browser measurement.
 *
 * This module is intentionally pure (no THREE/React), leaving the renderer wiring as thin glue.
 */

/** ≤ this atom count renders sphere impostors; above it switches to GL points. */
export const COMPACT_SPHERE_MAX_ATOMS = 250_000
/** > this atom count uses the THREE.Points path (drops per-atom radius/color buffers). */
export const COMPACT_POINTS_MIN_ATOMS = COMPACT_SPHERE_MAX_ATOMS + 1
/** ≤ this uses the GPU id-picker; above it the picker is REPLACED by CPU tile picking. */
export const COMPACT_GPU_PICK_MAX_ATOMS = 250_000
/** ≤ this CPU ray-vs-tile picking applies; above it only tile-traversal click-to-focus. */
export const COMPACT_CPU_TILE_PICK_MAX_ATOMS = 2_000_000
/** ≤ this box-select runs over every atom. */
export const COMPACT_BOX_FULL_MAX_ATOMS = 250_000
/** ≤ this box-select is tile-scoped; above it box-select is disabled. */
export const COMPACT_BOX_TILE_MAX_ATOMS = 1_000_000
/** > this hover is disabled (single-click tile focus only). */
export const COMPACT_HOVER_MAX_ATOMS = 2_000_000
/** Target atoms per world-space tile — sizes the CPU culling/pick grid. */
export const COMPACT_TILE_TARGET_ATOMS = 16_384
/** Tile edge clamp (Å): floor avoids millions of tiny tiles, ceiling bounds candidate counts. */
export const COMPACT_TILE_EDGE_MIN_A = 32
export const COMPACT_TILE_EDGE_MAX_A = 128
/** Box-select stops collecting once candidate atoms exceed this (responsiveness guard). */
export const COMPACT_TILE_PICK_CANDIDATE_MAX = 100_000
/** Hard cap on atoms a single box-select may select. */
export const COMPACT_BOX_SELECTED_MAX = 50_000

export type CompactRenderMode = 'sphere' | 'points'
export type CompactPickMode = 'gpu' | 'cpu-tile' | 'tile-focus'
export type CompactBoxSelectMode = 'full' | 'tile' | 'disabled'

/** Sphere impostors at/below the cap, GL points above it. */
export function compactRenderMode(count: number): CompactRenderMode {
  return count <= COMPACT_SPHERE_MAX_ATOMS ? 'sphere' : 'points'
}

/** GPU id-picker ≤250k, CPU ray-vs-tile up to 2M, tile-traversal focus-only beyond. */
export function compactPickMode(count: number): CompactPickMode {
  if (count <= COMPACT_GPU_PICK_MAX_ATOMS) return 'gpu'
  if (count <= COMPACT_CPU_TILE_PICK_MAX_ATOMS) return 'cpu-tile'
  return 'tile-focus'
}

/** Full box-select ≤250k, tile-scoped up to 1M, disabled beyond. */
export function compactBoxSelectMode(count: number): CompactBoxSelectMode {
  if (count <= COMPACT_BOX_FULL_MAX_ATOMS) return 'full'
  if (count <= COMPACT_BOX_TILE_MAX_ATOMS) return 'tile'
  return 'disabled'
}

/** Hover/pre-highlight is off past 2M (per-frame full-atom hit-test is too costly). */
export function compactHoverEnabled(count: number): boolean {
  return count <= COMPACT_HOVER_MAX_ATOMS
}

/**
 * World-space tile edge (Å) for the CPU culling/pick grid:
 *   edge = clamp(cuberoot(targetAtomsPerTile / density), MIN, MAX), density = count / bboxVolume.
 * Degenerate inputs (no atoms, zero/negative volume) fall back to the max edge — never NaN/0.
 */
export function compactTileEdge(count: number, bboxVolumeA3: number): number {
  if (!(count > 0) || !(bboxVolumeA3 > 0)) return COMPACT_TILE_EDGE_MAX_A
  const density = count / bboxVolumeA3
  const edge = Math.cbrt(COMPACT_TILE_TARGET_ATOMS / density)
  return Math.min(COMPACT_TILE_EDGE_MAX_A, Math.max(COMPACT_TILE_EDGE_MIN_A, edge))
}
