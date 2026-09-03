/**
 * Regression tests for wrapping merge-placement anchors.
 *
 * Anchors and atoms must share one coordinate frame. If atoms wrap into the cell, the anchor must
 * wrap too; otherwise the cursor remains outside while the molecule appears inside.
 */

import { describe, it, expect } from 'vitest'
import { wrapAnchorIntoBox, analyzeMergeBoundary } from '../lib/crystal/merge-boundary'
import { cartesianToFractional } from '../lib/crystal/lattice'
import type { LatticeVectors } from '../lib/crystal/types'

/** Ten-angstrom cubic cell. */
const CUBIC: LatticeVectors = { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
const CELL1 = { nx: 1, ny: 1, nz: 1 }
const ALL_PERIODIC = { a: true, b: true, c: true }

describe('wrapAnchorIntoBox', () => {
  it('盒外锚点折回盒内，且与原子 wrap 落在同一象限', () => {
    // Anchor lies below x=0 and beyond the y boundary.
    const raw: [number, number, number] = [-3, 13, 5]
    const anchor = wrapAnchorIntoBox(raw, CUBIC, CELL1, ALL_PERIODIC, true, 'wrap')
    expect(anchor[0]).toBeCloseTo(7, 6) // -3 → 7
    expect(anchor[1]).toBeCloseTo(3, 6) // 13 → 3
    expect(anchor[2]).toBeCloseTo(5, 6) // An in-bounds coordinate remains unchanged.

    // An atom placed at the wrapped anchor requires no further wrap, proving frame agreement.
    const report = analyzeMergeBoundary([anchor], CUBIC, CELL1, ALL_PERIODIC, true, [], 'wrap')
    expect(report.atomStatus[0]).toBe('ok')
    expect(report.finalPositions[0][0]).toBeCloseTo(anchor[0], 6)
    expect(report.finalPositions[0][1]).toBeCloseTo(anchor[1], 6)
  })

  it('折回结果的分数坐标恒在 [0,1)', () => {
    for (const raw of [
      [-100, 250, -0.001],
      [10, 10, 10],
      [0, 0, 0],
      [-1e-9, 9.9999, 5],
    ] as [number, number, number][]) {
      const f = cartesianToFractional(
        wrapAnchorIntoBox(raw, CUBIC, CELL1, ALL_PERIODIC, true, 'wrap'),
        CUBIC,
      )
      for (const v of f) {
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThan(1 + 1e-9)
      }
    }
  })

  it('非周期轴不折（真空方向由拉伸/平移处理，折它会挪出真空区）', () => {
    const raw: [number, number, number] = [-3, 5, 25]
    // Nonperiodic c preserves z=25 outside the cell.
    const anchor = wrapAnchorIntoBox(raw, CUBIC, CELL1, { a: true, b: true, c: false }, true, 'wrap')
    expect(anchor[0]).toBeCloseTo(7, 6)
    expect(anchor[2]).toBeCloseTo(25, 6)
  })

  it('非周期体系与退化晶格原样返回（分子场景无盒可折）', () => {
    const raw: [number, number, number] = [-3, 13, 5]
    expect(wrapAnchorIntoBox(raw, CUBIC, CELL1, ALL_PERIODIC, false, 'wrap')).toEqual(raw)
    const flat: LatticeVectors = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0] }
    expect(wrapAnchorIntoBox(raw, flat, CELL1, ALL_PERIODIC, true, 'wrap')).toEqual(raw)
    // No axis wraps when all are nonperiodic.
    expect(
      wrapAnchorIntoBox(raw, CUBIC, CELL1, { a: false, b: false, c: false }, true, 'wrap'),
    ).toEqual(raw)
  })

  it('超胞按可见盒折（盒长 = n × 晶格常数）', () => {
    // A 2x1x1 supercell has visible a length 20, so x=15 remains inside.
    const anchor = wrapAnchorIntoBox([15, 3, 3], CUBIC, { nx: 2, ny: 1, nz: 1 }, ALL_PERIODIC, true, 'wrap')
    expect(anchor[0]).toBeCloseTo(15, 6)
    // x=25 exceeds 20 and wraps to 5.
    const wrapped = wrapAnchorIntoBox([25, 3, 3], CUBIC, { nx: 2, ny: 1, nz: 1 }, ALL_PERIODIC, true, 'wrap')
    expect(wrapped[0]).toBeCloseTo(5, 6)
  })

  it('幂等：已在盒内的锚点再折不变', () => {
    const once = wrapAnchorIntoBox([-3, 13, 5], CUBIC, CELL1, ALL_PERIODIC, true, 'wrap')
    const twice = wrapAnchorIntoBox(once, CUBIC, CELL1, ALL_PERIODIC, true, 'wrap')
    expect(twice[0]).toBeCloseTo(once[0], 6)
    expect(twice[1]).toBeCloseTo(once[1], 6)
    expect(twice[2]).toBeCloseTo(once[2], 6)
  })
})
