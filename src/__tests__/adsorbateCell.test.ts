import { describe, it, expect } from 'vitest'
import {
  resolveAdsorbateCell,
  DEFAULT_ADSORBATE_VACUUM_A,
} from '../lib/analysis/builders/adsorbate-cell'

// Orthogonal 3x3x1 slab from a primitive cell with a=b=2 and c=20.
const primitive = {
  a: [2, 0, 0] as [number, number, number],
  b: [0, 2, 0] as [number, number, number],
  c: [0, 0, 20] as [number, number, number],
}

describe('resolveAdsorbateCell', () => {
  it('scales the emitted lattice by the supercell — the regression that shrank the cell to one unit', () => {
    // Store latticeVectors describe the primitive cell while atoms already contain the 3x3 supercell.
    const cell = resolveAdsorbateCell({
      latticeVectors: primitive,
      supercell: { nx: 3, ny: 3, nz: 1 },
      atomCartesians: [[0, 0, 0]],
      vacuumA: 0,
    })

    expect(cell).toBeDefined()
    expect(cell![0]).toEqual([6, 0, 0])
    expect(cell![1]).toEqual([0, 6, 0])
    expect(cell![2]).toEqual([0, 0, 20])
  })

  it('grows c along the surface normal so the adsorbate keeps vacuum from the image above', () => {
    // A 4-angstrom slab in c=20 already exceeds the required 4+10 height.
    const enough = resolveAdsorbateCell({
      latticeVectors: primitive,
      supercell: { nx: 1, ny: 1, nz: 1 },
      atomCartesians: [[0, 0, 0], [0, 0, 4]],
    })
    expect(enough![2]).toEqual([0, 0, 20])

    // A 15-angstrom slab-plus-adsorbate needs c=25, so c=20 must grow.
    const grown = resolveAdsorbateCell({
      latticeVectors: primitive,
      supercell: { nx: 1, ny: 1, nz: 1 },
      atomCartesians: [[0, 0, 0], [0, 0, 15]],
    })
    expect(grown![2][2]).toBeCloseTo(15 + DEFAULT_ADSORBATE_VACUUM_A, 6)
  })

  it('measures vacuum along a×b, not along c, so tilted cells are not over-credited', () => {
    // Tilted c has length 25 but only 20 normal height; vacuum must use the normal projection.
    const tilted = resolveAdsorbateCell({
      latticeVectors: { ...primitive, c: [15, 0, 20] },
      supercell: { nx: 1, ny: 1, nz: 1 },
      atomCartesians: [[0, 0, 0], [0, 0, 12]],
    })
    // Normal height 20 is below 12+10, so scale c by 22/20.
    expect(tilted![2][2]).toBeCloseTo(22, 6)
    expect(tilted![2][0]).toBeCloseTo(16.5, 6)
  })

  it('returns undefined for non-periodic structures so molecules stay cell-free', () => {
    expect(
      resolveAdsorbateCell({
        latticeVectors: null,
        supercell: { nx: 1, ny: 1, nz: 1 },
        atomCartesians: [[0, 0, 0]],
      }),
    ).toBeUndefined()
  })
})
