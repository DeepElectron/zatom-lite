/**
 * H.264 4:2:0 chroma subsampling requires even dimensions; encoders reject or crop odd sizes.
 * Canvas dimensions commonly become odd after devicePixelRatio scaling, so normalize both axes.
 */
import { describe, expect, it } from 'vitest'
import { resolveVideoDimensions } from '../lib/video-export/encode-video'

describe('resolveVideoDimensions', () => {
  it('奇数尺寸向下取偶 —— 向上会多出一列没有像素来源的边', () => {
    expect(resolveVideoDimensions(1921, 1081)).toEqual({ width: 1920, height: 1080 })
  })

  it('偶数尺寸原样保留', () => {
    expect(resolveVideoDimensions(1280, 720)).toEqual({ width: 1280, height: 720 })
  })

  it('极小尺寸兜到 2 而不是 0 —— 0 宽的轨道无法编码', () => {
    expect(resolveVideoDimensions(1, 1)).toEqual({ width: 2, height: 2 })
  })

  it('拒绝非法尺寸', () => {
    expect(resolveVideoDimensions(0, 100)).toBeNull()
    expect(resolveVideoDimensions(100, -10)).toBeNull()
    expect(resolveVideoDimensions(Number.NaN, 100)).toBeNull()
    expect(resolveVideoDimensions(Number.POSITIVE_INFINITY, 100)).toBeNull()
  })
})
