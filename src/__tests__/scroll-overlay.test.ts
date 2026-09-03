import { describe, expect, it } from 'vitest'

import { computeThumbGeometry } from '../ui/scroll-overlay'

/** A 400px viewport, 1200px content area, and 400px track. */
const track = 400
const client = 400
const content = 1200

describe('computeThumbGeometry', () => {
  it('滑块长度按内容比例计算,且滚动过程中保持不变', () => {
    const top = computeThumbGeometry(content, client, 0, track)!
    const end = computeThumbGeometry(content, client, content - client, track)!
    expect(top.size).toBeCloseTo((client / content) * track, 5)
    expect(end.size).toBeCloseTo(top.size, 5)
  })

  it('两端分别贴住轨道首尾,不溢出轨道', () => {
    const top = computeThumbGeometry(content, client, 0, track)!
    const end = computeThumbGeometry(content, client, content - client, track)!
    expect(top.offset).toBe(0)
    expect(end.offset).toBeCloseTo(track - end.size, 5)
  })

  it('不可滚动时返回 null,子像素误差不误判', () => {
    expect(computeThumbGeometry(client, client, 0, track)).toBeNull()
    expect(computeThumbGeometry(client + 0.6, client, 0, track)).toBeNull()
  })

  it('内容极长时滑块仍不小于可见下限', () => {
    expect(computeThumbGeometry(100_000, client, 0, track)!.size).toBe(28)
  })

  it('橡皮筋回弹造成的超范围滚动被夹住', () => {
    const over = computeThumbGeometry(content, client, content, track)!
    expect(over.offset).toBeCloseTo(track - over.size, 5)
  })
})
