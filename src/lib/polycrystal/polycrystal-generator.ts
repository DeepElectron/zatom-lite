import type { BaseCell, Grain, PolycrystalOptions, PolycrystalResult } from './types'
import { makeRng } from './rng'
import { placeSeeds, SeedGrid } from './seeds'
import { randomRotationMatrix } from './orientation'
import { fillGrains } from './voronoi-fill'
import { pruneOverlaps } from './overlap-prune'

/** Pure compute core — shared by the worker and the panel's main-thread fallback. */
export function generatePolycrystal(
  options: PolycrystalOptions,
  base: BaseCell,
  onProgress?: (fraction: number) => void,
): PolycrystalResult {
  if (!Number.isFinite(options.boxSize) || options.boxSize <= 0
    || !Number.isSafeInteger(options.grainCount) || options.grainCount < 1
    || !Number.isFinite(options.minSeedDistance) || options.minSeedDistance < 0
    || !Number.isFinite(options.overlapDmin) || options.overlapDmin < 0
    || !Number.isSafeInteger(options.maxAtoms) || options.maxAtoms < 1
    || !Number.isSafeInteger(options.seed)) {
    throw new Error('Polycrystal options contain invalid dimensions, counts, distances, budget, or seed')
  }
  if (!base.basis.length) throw new Error('Polycrystal base cell must contain at least one atom site')
  const rng = makeRng(options.seed)
  const seeds = placeSeeds(options.grainCount, options.boxSize, options.minSeedDistance, rng)
  const grains: Grain[] = seeds.map((seed) => ({ seed, rotation: randomRotationMatrix(rng) }))
  const grid = new SeedGrid(seeds, options.boxSize)

  const filled = fillGrains(
    base,
    grains,
    options.boxSize,
    grid,
    options.maxAtoms,
    onProgress ? (f) => onProgress(f * 0.9) : undefined,
  )
  const pruned = pruneOverlaps(
    filled.positions,
    filled.grainId,
    filled.elementIndex,
    filled.basisIndex,
    options.overlapDmin,
  )
  if (onProgress) onProgress(1)

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < pruned.count; i++) {
    const x = pruned.positions[i * 3], y = pruned.positions[i * 3 + 1], z = pruned.positions[i * 3 + 2]
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z
  }
  if (pruned.count === 0) { minX = minY = minZ = 0; maxX = maxY = maxZ = options.boxSize }

  const flatSeeds = new Float32Array(seeds.length * 3)
  for (let i = 0; i < seeds.length; i++) {
    flatSeeds[i * 3] = seeds[i][0]; flatSeeds[i * 3 + 1] = seeds[i][1]; flatSeeds[i * 3 + 2] = seeds[i][2]
  }
  const rotations = new Float64Array(grains.length * 9)
  for (let index = 0; index < grains.length; index++) rotations.set(grains[index].rotation, index * 9)
  return {
    positions: pruned.positions,
    elementIndex: pruned.elementIndex,
    grainId: pruned.grainId,
    basisIndex: pruned.basisIndex,
    elements: filled.elements,
    count: pruned.count,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    seeds: flatSeeds,
    rotations,
  }
}
