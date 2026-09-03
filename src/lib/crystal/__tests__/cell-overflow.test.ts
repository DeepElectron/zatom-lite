import { describe, expect, it } from 'vitest'
import {
  boundaryModeFor,
  computeImageTileRange,
  displayPositionOf,
  isOriginTileRange,
  splitIntoCellImage,
  type ImageIndex,
} from '../cell-overflow'
import type { LatticeVectors } from '../types'

// 10 Å cubic cell for easy readout of fractional coordinates as integers.
const CUBIC: LatticeVectors = { a: [10, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
// Cline cell: Verify that the mirror bit is translated along the **lattice vector** and not the world axis.
const TRICLINIC: LatticeVectors = { a: [10, 0, 0], b: [3, 9, 0], c: [1, 2, 8] }
const ALL_PERIODIC = { a: true, b: true, c: true }

describe('cell-overflow：三模式的落点语义', () => {
  it('grow-cell 不折回坐标，另两个折回', () => {
    // `tile-images` and `fold-in` store the same canonical coordinates; their
    // difference is purely visual. Only `grow-cell` changes the cell.
    expect(boundaryModeFor('grow-cell')).toBe('extend')
    expect(boundaryModeFor('tile-images')).toBe('wrap')
    expect(boundaryModeFor('fold-in')).toBe('wrap')
  })
})

describe('splitIntoCellImage：规范坐标 + 整数镜像位', () => {
  it('胞内原子原样返回，不引入浮点抖动', () => {
    // Atoms already inside the cell must take the identity fast path. A matrix
    // round trip would introduce tiny coordinate drift on every render.
    const pos: [number, number, number] = [3, 4, 5]
    const r = splitIntoCellImage(pos, CUBIC, ALL_PERIODIC)
    expect(r.wrapped).toBe(pos) // The same reference, not an equivalent copy
    expect(r.image).toEqual([0, 0, 0])
  })

  it('正向越界：坐标折回胞内，镜像位记正数', () => {
    const r = splitIntoCellImage([12, 5, 5], CUBIC, ALL_PERIODIC)
    expect(r.wrapped[0]).toBeCloseTo(2, 9)
    expect(r.image).toEqual([1, 0, 0])
  })

  it('负向越界：坐标折回胞内，镜像位记负数', () => {
    // The negative direction was the hardest hit area for previous bugs (the old code used a whole set of translations, affecting unoperated atoms).
    // Floor gives an unambiguous negative image: -2 becomes wrapped 8, image -1.
    const r = splitIntoCellImage([-2, 5, 5], CUBIC, ALL_PERIODIC)
    expect(r.wrapped[0]).toBeCloseTo(8, 9)
    expect(r.image).toEqual([-1, 0, 0])
  })

  it('非周期轴不参与拆分', () => {
    // A slab vacuum axis or molecular padding is a real boundary, not periodic space.
    const r = splitIntoCellImage([12, 5, 25], CUBIC, { a: true, b: true, c: false })
    expect(r.image).toEqual([1, 0, 0]) // The c-axis will not break even if it is far beyond the bounds
    expect(r.wrapped[2]).toBeCloseTo(25, 9)
  })

  it('往返精确可逆：wrapped + 镜像位 === 原位置（含斜胞）', () => {
    // This is the premise for the entire 'tile-images' mode to be established: the position of the drawing on the screen must be exactly equal to the user
    // Integer image indices make reconstruction exact without accumulating drift.
    for (const pos of [[12, 5, 5], [-2, 5, 5], [23, -14, 31], [-0.5, 19.5, -8.25]] as [number, number, number][]) {
      for (const lattice of [CUBIC, TRICLINIC]) {
        const { wrapped, image } = splitIntoCellImage(pos, lattice, ALL_PERIODIC)
        const back = displayPositionOf(wrapped, image, lattice)
        expect(back[0]).toBeCloseTo(pos[0], 9)
        expect(back[1]).toBeCloseTo(pos[1], 9)
        expect(back[2]).toBeCloseTo(pos[2], 9)
      }
    }
  })

  it('折回结果确实落在胞内 [0,1)（斜胞下也成立）', () => {
    // The oblique cell is an error-prone point: translation along the world axis will calculate the wrong image. Here the fractional coordinate interval is tested directly.
    const { wrapped } = splitIntoCellImage([23, -14, 31], TRICLINIC, ALL_PERIODIC)
    // Recover fractional coordinates by back-substitution in this triangular cell.
    const fc = wrapped[2] / 8
    const fb = (wrapped[1] - fc * 2) / 9
    const fa = (wrapped[0] - fb * 3 - fc * 1) / 10
    for (const f of [fa, fb, fc]) {
      expect(f).toBeGreaterThanOrEqual(-1e-9)
      expect(f).toBeLessThan(1 + 1e-9)
    }
  })
})

describe('computeImageTileRange：自动铺砖范围', () => {
  it('没有原子在胞外时退化为只有原胞（零开销）', () => {
    expect(isOriginTileRange(computeImageTileRange([undefined, undefined]))).toBe(true)
    expect(isOriginTileRange(computeImageTileRange([[0, 0, 0]]))).toBe(true)
  })

  it('范围恰好包住用到的镜像位，正负都覆盖', () => {
    const images: (ImageIndex | undefined)[] = [[1, 0, 0], [-2, 0, 0], undefined, [0, 1, -1]]
    expect(computeImageTileRange(images)).toEqual({ a: [-2, 1], b: [0, 1], c: [-1, 0] })
  })

  it('极端拖拽被上限夹住，避免尝试渲染上百层晶胞', () => {
    // A pathological drag to f=500 must not request hundreds of image tiles.
    expect(computeImageTileRange([[500, 0, 0]], 4)).toEqual({ a: [0, 4], b: [0, 0], c: [0, 0] })
  })
})
