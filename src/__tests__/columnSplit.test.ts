/**
 * Boundary behavior for column split ratios.
 *
 * Protect clamping and layout reset so dragging cannot erase a column and layout changes cannot
 * retain a skewed grid. Browser tests cover handle gestures.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  useViewportManager,
  clampColumnSplit,
  DEFAULT_COLUMN_SPLIT,
  MIN_COLUMN_SPLIT,
  MAX_COLUMN_SPLIT,
} from '../orchestration/viewportManager'

describe('clampColumnSplit', () => {
  it('保留区间内的比例', () => {
    expect(clampColumnSplit(0.5)).toBe(0.5)
    expect(clampColumnSplit(0.7)).toBe(0.7)
  })

  it('把越界值夹到边界 —— 否则拖过头会让一列宽度归零', () => {
    expect(clampColumnSplit(0)).toBe(MIN_COLUMN_SPLIT)
    expect(clampColumnSplit(-3)).toBe(MIN_COLUMN_SPLIT)
    expect(clampColumnSplit(1)).toBe(MAX_COLUMN_SPLIT)
    expect(clampColumnSplit(42)).toBe(MAX_COLUMN_SPLIT)
  })

  it('NaN 退回等分,不把非法值写进 grid 模板', () => {
    expect(clampColumnSplit(Number.NaN)).toBe(DEFAULT_COLUMN_SPLIT)
    expect(clampColumnSplit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_COLUMN_SPLIT)
  })
})

describe('viewportManager column split', () => {
  beforeEach(() => {
    useViewportManager.getState().setLayout('1x1')
  })

  it('setColumnSplit 经过夹取', () => {
    const { setColumnSplit } = useViewportManager.getState()
    setColumnSplit(0.62)
    expect(useViewportManager.getState().columnSplit).toBeCloseTo(0.62)

    // Dragging fully left still leaves usable width for the 3D viewport.
    setColumnSplit(-1)
    expect(useViewportManager.getState().columnSplit).toBe(MIN_COLUMN_SPLIT)
  })

  it('换布局回到等分 —— 为 1x2 调的比例不该套到别的布局上', () => {
    const { setColumnSplit, setLayout } = useViewportManager.getState()
    setLayout('1x2')
    setColumnSplit(0.8)
    expect(useViewportManager.getState().columnSplit).toBeCloseTo(0.8)

    setLayout('2x2')
    expect(useViewportManager.getState().columnSplit).toBe(DEFAULT_COLUMN_SPLIT)
  })
})
