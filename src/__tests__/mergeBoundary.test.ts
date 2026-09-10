/**
 * Numerical merge-boundary invariants.
 *
 * Boundary strategies:
 * - `wrap` folds periodic coordinates into the cell.
 * - `extend` grows the cell while preserving Cartesian positions.
 *
 * These cases use it() so Vitest executes them rather than treating top-level assertions as an
 * empty suite.
 */
import { describe, it, expect } from 'vitest'
import { analyzeMergeBoundary } from '../lib/crystal/merge-boundary'
import type { LatticeVectors } from '../lib/crystal/types'

// Ten-angstrom cubic 1x1x1 cell.
const box: LatticeVectors = { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
const cell = { nx: 1, ny: 1, nz: 1 }
const allPeriodic = { a: true, b: true, c: true }
const cOpen = { a: true, b: true, c: false }

describe("merge-boundary · 'wrap' 策略", () => {
  it('周期轴超界原子折回盒内：x=12 → x=2', () => {
    const r = analyzeMergeBoundary([[12, 5, 5]], box, cell, allPeriodic, true, [])
    expect(r.finalPositions[0][0]).toBeCloseTo(2, 9)
    expect(r.atomStatus[0]).toBe('wrap')
    expect(r.extendAxes).toHaveLength(0)
  })

  it('非周期轴正向超界 → 拉伸该轴，原子不动：z=13', () => {
    const r = analyzeMergeBoundary([[5, 5, 13]], box, cell, cOpen, true, [])
    expect(r.finalPositions[0][2]).toBeCloseTo(13, 9)
    expect(r.extendAxes).toHaveLength(1)
    expect(r.extendAxes[0].axis).toBe('c')
    expect(r.extendAxes[0].newUnitLength).toBeCloseTo(13, 9)
    expect(r.atomStatus[0]).toBe('extend')
  })

  it('非周期轴负向超界 → 整组平移回 frac≥0：z=-2', () => {
    const r = analyzeMergeBoundary([[5, 5, -2]], box, cell, cOpen, true, [])
    expect(r.finalPositions[0][2]).toBeCloseTo(0, 9)
    expect(r.shift[2]).toBeCloseTo(2, 9)
  })

  it('距既有原子过近会被标记', () => {
    const r = analyzeMergeBoundary([[5, 5, 5]], box, cell, allPeriodic, true, [[5, 5, 5.3]])
    expect(r.tooClose[0]).toBe(true)
    expect(r.tooCloseCount).toBe(1)
  })

  it('分子体系（无盒）原样返回', () => {
    const r = analyzeMergeBoundary([[100, 0, 0]], box, cell, allPeriodic, false, [])
    expect(r.atomStatus[0]).toBe('ok')
    expect(r.finalPositions[0]).toEqual([100, 0, 0])
  })
})
