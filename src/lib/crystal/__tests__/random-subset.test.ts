import { describe, expect, it } from 'vitest'
import { pickRandomSubset } from '../random-subset'

const IDS = Array.from({ length: 100 }, (_, i) => `atom-${i}`)

describe('pickRandomSubset', () => {
  it('is reproducible: same seed and same id set give the same subset', () => {
    const a = pickRandomSubset(IDS, { fraction: 0.1, seed: 42 })
    const b = pickRandomSubset(IDS, { fraction: 0.1, seed: 42 })
    expect(a).toEqual(b)
  })

  it('is order-independent: shuffled input gives the same atoms', () => {
    // The whole point of sorting internally. store `atoms` order changes as the
    // user edits, so if the result depended on input order the "same seed ⇒ same
    // atoms" guarantee would silently break between sessions.
    const shuffled = [...IDS].reverse()
    const a = pickRandomSubset(IDS, { fraction: 0.1, seed: 7 })
    const b = pickRandomSubset(shuffled, { fraction: 0.1, seed: 7 })
    expect(new Set(b)).toEqual(new Set(a))
  })

  it('different seeds give different subsets', () => {
    const a = pickRandomSubset(IDS, { fraction: 0.1, seed: 1 })
    const b = pickRandomSubset(IDS, { fraction: 0.1, seed: 2 })
    expect(a).not.toEqual(b)
  })

  it('honours fraction and count sizes', () => {
    expect(pickRandomSubset(IDS, { fraction: 0.25, seed: 3 })).toHaveLength(25)
    expect(pickRandomSubset(IDS, { count: 7, seed: 3 })).toHaveLength(7)
    // count wins when both are given
    expect(pickRandomSubset(IDS, { count: 4, fraction: 0.5, seed: 3 })).toHaveLength(4)
  })

  it('returns a subset of the input, without duplicates', () => {
    const picked = pickRandomSubset(IDS, { fraction: 0.3, seed: 11 })
    expect(new Set(picked).size).toBe(picked.length)
    for (const id of picked) expect(IDS).toContain(id)
  })

  it('preserves input order in the returned subset', () => {
    const picked = pickRandomSubset(IDS, { fraction: 0.2, seed: 5 })
    const byInputOrder = IDS.filter((id) => picked.includes(id))
    expect(picked).toEqual(byInputOrder)
  })

  it('rounds tiny fractions up to one atom instead of returning nothing', () => {
    // 1% of 4 atoms rounds to 0. Returning an empty set would look like a bug.
    expect(pickRandomSubset(['a', 'b', 'c', 'd'], { fraction: 0.01, seed: 1 })).toHaveLength(1)
  })

  it('clamps to the pool and handles degenerate requests', () => {
    expect(pickRandomSubset([], { fraction: 0.5, seed: 1 })).toEqual([])
    expect(pickRandomSubset(IDS, { fraction: 1, seed: 1 })).toEqual(IDS)
    expect(pickRandomSubset(IDS, { count: 500, seed: 1 })).toEqual(IDS)
    expect(pickRandomSubset(IDS, { count: 0, seed: 1 })).toEqual([])
    expect(pickRandomSubset(IDS, { fraction: 0, seed: 1 })).toEqual([])
    expect(pickRandomSubset(IDS, { seed: 1 })).toEqual([])
  })
})
