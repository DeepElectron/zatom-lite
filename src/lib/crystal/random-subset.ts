/**
 * Reproducible random subsets for vacancy and substitution workflows. Selection
 * depends only on the id set and seed, not store order; callers own the eventual
 * delete or replace operation.
 */

import { makeRng } from '../polycrystal/rng'

export interface RandomSubsetRequest {
  /** Exact selection count; mutually exclusive with `fraction`. */
  count?: number
  /** Fraction in (0,1], rounded to at least one item for a nonempty pool. */
  fraction?: number
  seed: number
}

/** Select deterministically while returning ids in their original input order. */
export function pickRandomSubset(ids: readonly string[], request: RandomSubsetRequest): string[] {
  const pool = [...ids]
  if (pool.length === 0) return []

  const target = resolveTargetCount(pool.length, request)
  if (target <= 0) return []
  if (target >= pool.length) return [...ids]

  // Sort first: let the result be determined only by (id set, seed) and not affected by the order of atoms array in the store.
  const sorted = [...pool].sort()
  const rng = makeRng(request.seed)

  // Partial Fisher-Yates shuffles only the selected prefix.
  for (let i = 0; i < target; i += 1) {
    const j = i + Math.floor(rng() * (sorted.length - i))
    const tmp = sorted[i]
    sorted[i] = sorted[j]
    sorted[j] = tmp
  }

  const chosen = new Set(sorted.slice(0, target))
  return ids.filter((id) => chosen.has(id))
}

function resolveTargetCount(poolSize: number, request: RandomSubsetRequest): number {
  if (request.count !== undefined) {
    if (!Number.isFinite(request.count)) return 0
    return Math.max(0, Math.min(poolSize, Math.floor(request.count)))
  }

  if (request.fraction !== undefined) {
    if (!Number.isFinite(request.fraction) || request.fraction <= 0) return 0
    if (request.fraction >= 1) return poolSize
    // At least 1: when the user clicks "5%" and the structure only has 4 atoms, it makes no sense to return the empty set,
    // It will only make people think that the function is broken.
    return Math.max(1, Math.min(poolSize, Math.round(poolSize * request.fraction)))
  }

  return 0
}
