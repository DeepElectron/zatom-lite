// Canonical behavior when an atom crosses a cell boundary:
// - `grow-cell` preserves Cartesian coordinates and expands the cell.
// - `tile-images` stores wrapped coordinates but displays the dragged image.
// - `fold-in` stores and displays the wrapped position.
// The latter two represent the same periodic structure; only presentation differs.

import {
  FULLY_PERIODIC,
  invert3x3,
  isFiniteVec3,
  isValidLattice,
  latticeShift,
  toFractional,
  type LatticeLike,
  type PeriodicMask,
  type Vec3,
} from './lattice-math'
import type { BoundaryOverflowMode } from './merge-boundary'

export type CellOverflowMode = 'grow-cell' | 'tile-images' | 'fold-in'

export const CELL_OVERFLOW_MODES: readonly CellOverflowMode[] = ['grow-cell', 'tile-images', 'fold-in']

export function isCellOverflowMode(value: unknown): value is CellOverflowMode {
  return typeof value === 'string' && (CELL_OVERFLOW_MODES as readonly string[]).includes(value)
}

/** Return whether committed coordinates are wrapped into the canonical cell. */
export function boundaryModeFor(mode: CellOverflowMode): BoundaryOverflowMode {
  return mode === 'grow-cell' ? 'extend' : 'wrap'
}

/** Integer cell offset of the displayed periodic image. */
export type ImageIndex = [number, number, number]

export const ORIGIN_IMAGE: ImageIndex = [0, 0, 0]

export function isOriginImage(image: ImageIndex | undefined | null): boolean {
  return !image || (image[0] === 0 && image[1] === 0 && image[2] === 0)
}

/**
 * Split a world position into canonical in-cell coordinates and an integer image
 * offset. Aperiodic axes are never wrapped because their boundaries are physical.
 * Invalid lattices return the original position and the origin image.
 */
export function splitIntoCellImage(
  position: Vec3,
  lattice: LatticeLike | null | undefined,
  periodicMask: PeriodicMask = FULLY_PERIODIC,
): { wrapped: Vec3; image: ImageIndex } {
  if (!isValidLattice(lattice) || !isFiniteVec3(position)) {
    return { wrapped: position, image: [...ORIGIN_IMAGE] as ImageIndex }
  }
  const inv = invert3x3(lattice)
  if (!inv) return { wrapped: position, image: [...ORIGIN_IMAGE] as ImageIndex }

  const [fa, fb, fc] = toFractional(inv, position[0], position[1], position[2])
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fc)) {
    return { wrapped: position, image: [...ORIGIN_IMAGE] as ImageIndex }
  }

  const na = periodicMask.a ? Math.floor(fa) : 0
  const nb = periodicMask.b ? Math.floor(fb) : 0
  const nc = periodicMask.c ? Math.floor(fc) : 0
  if (na === 0 && nb === 0 && nc === 0) {
    // Already in the cell: Return as is to avoid floating-point round-trips introducing 1e-16 level jitter to atoms in the cell.
    return { wrapped: position, image: [...ORIGIN_IMAGE] as ImageIndex }
  }

  const [sx, sy, sz] = latticeShift(lattice, na, nb, nc)
  return {
    wrapped: [position[0] - sx, position[1] - sy, position[2] - sz],
    image: [na, nb, nc],
  }
}

/** Inclusive image-tile ranges; `[0,0]` means the origin cell only. */
export interface TileRange {
  a: [number, number]
  b: [number, number]
  c: [number, number]
}

export const ORIGIN_TILE_RANGE: TileRange = { a: [0, 0], b: [0, 0], c: [0, 0] }

/**
 * Derive the smallest tile range covering occupied images, capped by `maxSpan`
 * to bound rendering cost after pathological drags.
 */
export function computeImageTileRange(
  images: readonly (ImageIndex | undefined)[],
  maxSpan = 8,
): TileRange {
  const lo: [number, number, number] = [0, 0, 0]
  const hi: [number, number, number] = [0, 0, 0]
  for (const image of images) {
    if (!image) continue
    for (let i = 0; i < 3; i++) {
      if (image[i] < lo[i]) lo[i] = image[i]
      if (image[i] > hi[i]) hi[i] = image[i]
    }
  }
  const clamp = (i: number): [number, number] => [
    Math.max(lo[i], -maxSpan),
    Math.min(hi[i], maxSpan),
  ]
  return { a: clamp(0), b: clamp(1), c: clamp(2) }
}

export function isOriginTileRange(range: TileRange): boolean {
  return range.a[0] === 0 && range.a[1] === 0
    && range.b[0] === 0 && range.b[1] === 0
    && range.c[0] === 0 && range.c[1] === 0
}

/**
 * Return dense tiles within the capped range plus every occupied image tile.
 * Clipping may remove empty intermediate cells, but never a cell containing an
 * atom. The origin cell is always included.
 */
export function computeImageTileCells(
  images: readonly (ImageIndex | undefined)[],
  maxSpan = 8,
): ImageIndex[] {
  const range = computeImageTileRange(images, maxSpan)
  const cells = new Map<string, ImageIndex>()
  const add = (a: number, b: number, c: number) => {
    const key = `${a},${b},${c}`
    if (!cells.has(key)) cells.set(key, [a, b, c])
  }
  for (let a = range.a[0]; a <= range.a[1]; a++)
    for (let b = range.b[0]; b <= range.b[1]; b++)
      for (let c = range.c[0]; c <= range.c[1]; c++) add(a, b, c)
  for (const image of images) {
    if (image) add(image[0], image[1], image[2])
  }
  return [...cells.values()]
}

/** Reconstruct the displayed world position from canonical coordinates and image offset. */
export function displayPositionOf(
  wrapped: Vec3,
  image: ImageIndex | undefined | null,
  lattice: LatticeLike | null | undefined,
): Vec3 {
  if (isOriginImage(image) || !isValidLattice(lattice) || !isFiniteVec3(wrapped)) return wrapped
  const [sx, sy, sz] = latticeShift(lattice, image![0], image![1], image![2])
  return [wrapped[0] + sx, wrapped[1] + sy, wrapped[2] + sz]
}
