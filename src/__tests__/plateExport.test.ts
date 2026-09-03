/**
 * Plate export must preserve coherent layout geometry and equal physical scale across cells.
 */

import { describe, expect, it } from 'vitest'
import {
  plateCellPixelSize,
  resolvePlateLayout,
} from '../lib/plate-export/plate-layout'
import { resolveSharedScale } from '../lib/plate-export/shared-scale'
import { buildPlateSvg } from '../lib/plate-export/plate-svg'

describe('resolvePlateLayout 页高上限', () => {
  // A narrow 2x2 viewport aspect near 0.28 needs a page-height cap.
  const tall = {
    widthMm: 183,
    cellCount: 4 as const,
    cellAspect: 0.28,
    gutterMm: 3,
    marginMm: 0,
    columns: 2 as const,
  }

  it('不设上限时确实会溢出到一页装不下(记录问题本身)', () => {
    const layout = resolvePlateLayout(tall)
    // Assert overflow rather than a specific height that varies with aspect.
    expect(layout!.heightMm).toBeGreaterThan(277 * 2)
  })

  it('设了上限后总高不超限,且格子仍保持原宽高比', () => {
    const layout = resolvePlateLayout({ ...tall, maxHeightMm: 277 })
    expect(layout).not.toBeNull()
    expect(layout!.heightMm).toBeLessThanOrEqual(277 + 1e-9)

    // Fit by shrinking cells without distorting their 0.28 aspect ratio.
    for (const cell of layout!.cells) {
      expect(cell.widthMm / cell.heightMm).toBeCloseTo(0.28, 6)
    }
  })

  it('收窄的格子在列内居中,整版不左偏', () => {
    const layout = resolvePlateLayout({ ...tall, maxHeightMm: 277 })
    const [a, b] = layout!.cells
    const columnWidth = (183 - 3) / 2
    // Equal outer gaps center the row.
    const leftGap = a.xMm
    const rightGap = 183 - (b.xMm + b.widthMm)
    expect(leftGap).toBeCloseTo(rightGap, 6)
    expect(a.widthMm).toBeLessThan(columnWidth)
  })

  it('宽高比接近 1 时上限不该干扰版面', () => {
    const normal = { ...tall, cellAspect: 4 / 3 }
    const capped = resolvePlateLayout({ ...normal, maxHeightMm: 277 })
    const uncapped = resolvePlateLayout(normal)
    expect(capped!.heightMm).toBeCloseTo(uncapped!.heightMm, 6)
    expect(capped!.cells[0].widthMm).toBeCloseTo(uncapped!.cells[0].widthMm, 6)
  })

  it('上限比固定边距还小时返回 null 而不是负高度', () => {
    expect(resolvePlateLayout({ ...tall, marginMm: 20, maxHeightMm: 30 })).toBeNull()
  })
})

describe('resolvePlateLayout', () => {
  it('2×2 版面里四格等大,且格位不重叠', () => {
    const layout = resolvePlateLayout({
      widthMm: 183,
      cellCount: 4,
      cellAspect: 4 / 3,
      gutterMm: 3,
      marginMm: 0,
      columns: 2,
    })
    expect(layout).not.toBeNull()
    expect(layout!.cells).toHaveLength(4)
    expect(layout!.cells.map((c) => c.label)).toEqual(['a', 'b', 'c', 'd'])

    // All four plate cells are equal in size.
    const [first] = layout!.cells
    for (const cell of layout!.cells) {
      expect(cell.widthMm).toBeCloseTo(first.widthMm, 6)
      expect(cell.heightMm).toBeCloseTo(first.heightMm, 6)
    }

    // Two cells plus one gutter equal total width.
    expect(first.widthMm * 2 + 3).toBeCloseTo(183, 6)

    // Cells a and b share a row without overlap.
    expect(layout!.cells[1].yMm).toBeCloseTo(layout!.cells[0].yMm, 6)
    expect(layout!.cells[1].xMm).toBeGreaterThanOrEqual(first.xMm + first.widthMm)

    // Cell c starts the next row below a.
    expect(layout!.cells[2].xMm).toBeCloseTo(first.xMm, 6)
    expect(layout!.cells[2].yMm).toBeGreaterThanOrEqual(first.yMm + first.heightMm)
  })

  it('总高按格宽高比推出,不靠外部传入', () => {
    // A marginless single column of square cells has height width*count plus gutters.
    const layout = resolvePlateLayout({
      widthMm: 80,
      cellCount: 2,
      cellAspect: 1,
      gutterMm: 4,
      marginMm: 0,
      columns: 1,
    })
    expect(layout!.heightMm).toBeCloseTo(80 + 4 + 80, 6)
  })

  it('边距吃光可用宽度时返回 null 而不是负数格宽', () => {
    expect(
      resolvePlateLayout({
        widthMm: 20,
        cellCount: 2,
        cellAspect: 1,
        gutterMm: 0,
        marginMm: 12, // Combined side margins exceed total width.
        columns: 2,
      }),
    ).toBeNull()
  })

  it('拒绝非法比例与尺寸', () => {
    const base = {
      widthMm: 183,
      cellCount: 2,
      cellAspect: 1,
      gutterMm: 2,
      marginMm: 0,
      columns: 2,
    } as const
    expect(resolvePlateLayout({ ...base, cellAspect: 0 })).toBeNull()
    expect(resolvePlateLayout({ ...base, widthMm: Number.NaN })).toBeNull()
    expect(resolvePlateLayout({ ...base, gutterMm: -1 })).toBeNull()
  })
})

describe('plateCellPixelSize', () => {
  it('按 dpi 把 mm 换成像素', () => {
    // 25.4mm @ 600dpi = 600px
    const size = plateCellPixelSize(
      { label: 'a', xMm: 0, yMm: 0, widthMm: 25.4, heightMm: 12.7 },
      600,
    )
    expect(size).toEqual({ width: 600, height: 300 })
  })

  it('dpi 非法时返回 null', () => {
    const cell = { label: 'a', xMm: 0, yMm: 0, widthMm: 10, heightMm: 10 }
    expect(plateCellPixelSize(cell, 0)).toBeNull()
    expect(plateCellPixelSize(cell, Number.NaN)).toBeNull()
  })
})

describe('resolveSharedScale', () => {
  it('取最小 px/Å 作基准,各格只缩不放', () => {
    const result = resolveSharedScale([
      { label: 'a', pxPerAngstrom: 40 },
      { label: 'b', pxPerAngstrom: 20 },
      { label: 'c', pxPerAngstrom: 80 },
    ])
    expect(result!.sharedPxPerAngstrom).toBe(20)
    // Scale factors stay at or below one so content is never enlarged beyond its frame.
    for (const cell of result!.cells) {
      expect(cell.contentScale).toBeLessThanOrEqual(1)
      expect(cell.contentScale).toBeGreaterThan(0)
    }
    expect(result!.cells.find((c) => c.label === 'b')!.contentScale).toBeCloseTo(1, 6)
    expect(result!.cells.find((c) => c.label === 'a')!.contentScale).toBeCloseTo(0.5, 6)
    expect(result!.cells.find((c) => c.label === 'c')!.contentScale).toBeCloseTo(0.25, 6)
  })

  it('归一化后 1 Å 在每一格里等长 —— 这就是共用比例的定义', () => {
    const measured = [
      { label: 'a', pxPerAngstrom: 33 },
      { label: 'b', pxPerAngstrom: 17.5 },
      { label: 'c', pxPerAngstrom: 91.25 },
      { label: 'd', pxPerAngstrom: 17.5 },
    ]
    const result = resolveSharedScale(measured)!
    for (const cell of result.cells) {
      const own = measured.find((m) => m.label === cell.label)!.pxPerAngstrom
      // Native pixels per angstrom times cell scale equals the shared plate scale.
      expect(own * cell.contentScale).toBeCloseTo(result.sharedPxPerAngstrom, 6)
    }
  })

  it('任一格量不出比例就整体失败,不出半归一化的图版', () => {
    expect(
      resolveSharedScale([
        { label: 'a', pxPerAngstrom: 40 },
        { label: 'b', pxPerAngstrom: 0 },
      ]),
    ).toBeNull()
    expect(
      resolveSharedScale([
        { label: 'a', pxPerAngstrom: 40 },
        { label: 'b', pxPerAngstrom: Number.NaN },
      ]),
    ).toBeNull()
    expect(resolveSharedScale([])).toBeNull()
  })
})

describe('buildPlateSvg', () => {
  const layout = resolvePlateLayout({
    widthMm: 183,
    cellCount: 2,
    cellAspect: 1,
    gutterMm: 3,
    marginMm: 0,
    columns: 2,
  })!

  it('输出 mm 尺寸、面板号,并为每格加裁剪', () => {
    const svg = buildPlateSvg({
      layout,
      cells: [
        { label: 'a', rasterDataUrl: 'data:image/png;base64,AAA', contentScale: 1 },
        { label: 'b', rasterDataUrl: 'data:image/png;base64,BBB', contentScale: 0.5 },
      ],
      labelFontSizePt: 9,
      backgroundColor: '#ffffff',
    })
    expect(svg).toContain('width="183mm"')
    expect(svg).toContain('viewBox="0 0 183')
    // Panel labels.
    expect(svg).toContain('>a</text>')
    expect(svg).toContain('>b</text>')
    // Each cell needs a clipPath so scaled images cannot cover neighbors.
    expect(svg).toContain('id="plate-clip-a"')
    expect(svg).toContain('id="plate-clip-b"')
    expect(svg).toContain('clip-path="url(#plate-clip-b)"')
  })

  it('contentScale<1 的格把位图放大并居中,以压低其 px/Å', () => {
    const svg = buildPlateSvg({
      layout,
      cells: [
        { label: 'a', rasterDataUrl: 'data:image/png;base64,AAA', contentScale: 1 },
        { label: 'b', rasterDataUrl: 'data:image/png;base64,BBB', contentScale: 0.5 },
      ],
      labelFontSizePt: 9,
      backgroundColor: null,
    })
    const cellW = layout.cells[0].widthMm
    // Cell b at scale 0.5 is drawn at twice the width.
    expect(svg).toContain(`width="${Math.round(cellW * 2 * 1000) / 1000}"`)
    // Transparent plates omit the background rectangle.
    expect(svg).not.toContain('fill="#ffffff"')
  })

  it('共用标尺只画一次并标注埃数', () => {
    const svg = buildPlateSvg({
      layout,
      cells: [
        { label: 'a', rasterDataUrl: 'data:image/png;base64,AAA', contentScale: 1 },
        { label: 'b', rasterDataUrl: 'data:image/png;base64,BBB', contentScale: 1 },
      ],
      labelFontSizePt: 9,
      backgroundColor: '#ffffff',
      sharedScaleBar: { lengthAngstrom: 5, lengthMm: 20 },
    })
    const occurrences = svg.match(/5 \u00C5/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('缺内容的格被跳过而不是画成空白框', () => {
    const svg = buildPlateSvg({
      layout,
      cells: [{ label: 'a', rasterDataUrl: 'data:image/png;base64,AAA', contentScale: 1 }],
      labelFontSizePt: 9,
      backgroundColor: '#ffffff',
    })
    expect(svg).toContain('>a</text>')
    expect(svg).not.toContain('>b</text>')
  })
})
