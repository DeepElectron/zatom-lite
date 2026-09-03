import { describe, it, expect } from 'vitest'
import { selectionNeighborShells, type RdfStructure } from '../lib/analysis/rdf'

/**
 * Single-atom simple-cubic cell. Every neighbour of the atom is one of its own
 * periodic replicas, so this also pins down the decision to skip only the home
 * image rather than the whole site.
 */
function simpleCubic(a = 3.5): RdfStructure {
  return {
    sites: [{ element: 'Po', cartesian: [0, 0, 0] }],
    latticeVectors: { a: [a, 0, 0], b: [0, a, 0], c: [0, 0, a] },
  }
}

describe('selectionNeighborShells', () => {
  it('reproduces the simple-cubic coordination shells: 6 at a, 12 at a*sqrt(2)', () => {
    const a = 3.5
    const shells = selectionNeighborShells(simpleCubic(a), [0], {
      cutoff: a * Math.SQRT2 + 0.1,
      pbc: true,
      tolerance: 0.01,
    })

    expect(shells.length).toBeGreaterThanOrEqual(2)
    expect(shells[0].count).toBe(6)
    expect(shells[0].distance).toBeCloseTo(a, 2)
    expect(shells[1].count).toBe(12)
    expect(shells[1].distance).toBeCloseTo(a * Math.SQRT2, 2)
  })

  it('finds shells beyond half the lattice vector', () => {
    // g(r) defaults to a 10 A cutoff, far past a/2 = 1.75 A. A single
    // minimum-image step would cap the search there and silently drop every
    // shell past it, so this guards the replica search.
    const a = 3.5
    const shells = selectionNeighborShells(simpleCubic(a), [0], {
      cutoff: a * Math.SQRT2 + 0.1,
      pbc: true,
      tolerance: 0.01,
    })
    const farthest = shells[shells.length - 1].distance
    expect(farthest).toBeGreaterThan(a)
  })

  it('treats a degenerate cell as a molecule: plain distances, no replicas', () => {
    const dimer: RdfStructure = {
      sites: [
        { element: 'H', cartesian: [0, 0, 0] },
        { element: 'H', cartesian: [0.74, 0, 0] },
      ],
      latticeVectors: { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] },
    }
    const shells = selectionNeighborShells(dimer, [0], { cutoff: 5, pbc: false, tolerance: 0.01 })
    expect(shells).toHaveLength(1)
    expect(shells[0].count).toBe(1)
    expect(shells[0].distance).toBeCloseTo(0.74, 2)
  })

  it('returns nothing for an empty selection so the chart stays clean', () => {
    expect(selectionNeighborShells(simpleCubic(), [], { cutoff: 6 })).toHaveLength(0)
  })

  it('respects maxShells so a wide cutoff cannot flood the chart', () => {
    const shells = selectionNeighborShells(simpleCubic(3.5), [0], {
      cutoff: 12,
      pbc: true,
      tolerance: 0.01,
      maxShells: 3,
    })
    expect(shells).toHaveLength(3)
  })
})
