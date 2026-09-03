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
    const r = analyzeMergeBoundary([[12, 5, 5]], box, cell, allPeriodic, true, [], 'wrap')
    expect(r.finalPositions[0][0]).toBeCloseTo(2, 9)
    expect(r.atomStatus[0]).toBe('wrap')
    expect(r.extendAxes).toHaveLength(0)
  })

  it('非周期轴正向超界 → 拉伸该轴，原子不动：z=13', () => {
    const r = analyzeMergeBoundary([[5, 5, 13]], box, cell, cOpen, true, [], 'wrap')
    expect(r.finalPositions[0][2]).toBeCloseTo(13, 9)
    expect(r.extendAxes).toHaveLength(1)
    expect(r.extendAxes[0].axis).toBe('c')
    expect(r.extendAxes[0].newUnitLength).toBeCloseTo(13, 9)
    expect(r.atomStatus[0]).toBe('extend')
  })

  it('非周期轴负向超界 → 整组平移回 frac≥0：z=-2', () => {
    const r = analyzeMergeBoundary([[5, 5, -2]], box, cell, cOpen, true, [], 'wrap')
    expect(r.finalPositions[0][2]).toBeCloseTo(0, 9)
    expect(r.shift[2]).toBeCloseTo(2, 9)
  })

  it('距既有原子过近会被标记', () => {
    const r = analyzeMergeBoundary([[5, 5, 5]], box, cell, allPeriodic, true, [[5, 5, 5.3]], 'wrap')
    expect(r.tooClose[0]).toBe(true)
    expect(r.tooCloseCount).toBe(1)
  })

  it('分子体系（无盒）原样返回', () => {
    const r = analyzeMergeBoundary([[100, 0, 0]], box, cell, allPeriodic, false, [], 'wrap')
    expect(r.atomStatus[0]).toBe('ok')
    expect(r.finalPositions[0]).toEqual([100, 0, 0])
  })
})

describe("merge-boundary · 'extend' 策略（建模默认）", () => {
  it('周期轴超界不再折回，改为放大晶胞：x=12 原子留在 x=12', () => {
    // Unlike wrap, extend keeps x=12 fixed and grows a to contain it.
    const r = analyzeMergeBoundary([[12, 5, 5]], box, cell, allPeriodic, true, [], 'extend')
    expect(r.finalPositions[0][0]).toBeCloseTo(12, 9)
    expect(r.atomStatus[0]).toBe('extend')
    expect(r.extendAxes.map((e) => e.axis)).toContain('a')
    expect(r.extendAxes.find((e) => e.axis === 'a')!.newUnitLength).toBeCloseTo(12, 9)
  })

  it('负向越界：坐标原样保留，绝不平移', () => {
    // A former positive shift moved only dragged atoms, tearing relative geometry and moving them
    // away from the release point. Extend must preserve negative Cartesian coordinates as well.
    const r = analyzeMergeBoundary([[-2, 5, 5], [-1, 5, 5]], box, cell, allPeriodic, true, [], 'extend')
    expect(r.shift).toEqual([0, 0, 0])
    expect(r.finalPositions[0]).toEqual([-2, 5, 5])
    expect(r.finalPositions[1]).toEqual([-1, 5, 5])
    expect(r.atomStatus.some((s) => s === 'wrap')).toBe(false)
    // Keep the extend status so the UI can indicate that the atom lies outside.
    expect(r.atomStatus[0]).toBe('extend')
  })

  it('负向越界不牵动未被操作的原子', () => {
    // Extending one negative atom must not produce a global shift that would desynchronize other atoms.
    const r = analyzeMergeBoundary([[-3, 5, 5]], box, cell, allPeriodic, true, [[5, 5, 5]], 'extend')
    expect(r.shift).toEqual([0, 0, 0])
    expect(r.finalPositions[0]).toEqual([-3, 5, 5])
  })

  it('盒内原子两种策略下都不动', () => {
    for (const mode of ['wrap', 'extend'] as const) {
      const r = analyzeMergeBoundary([[5, 5, 5]], box, cell, allPeriodic, true, [], mode)
      expect(r.finalPositions[0]).toEqual([5, 5, 5])
      expect(r.atomStatus[0]).toBe('ok')
      expect(r.extendAxes).toHaveLength(0)
    }
  })
})
