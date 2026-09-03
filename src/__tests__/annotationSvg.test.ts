import { describe, expect, it } from 'vitest'
import { buildAnnotationSvg } from '../lib/figure-export/annotation-svg'
import {
  chooseScaleBarLength,
  formatScaleBarLabel,
  ptToViewBoxUnits,
} from '../lib/figure-export/annotation-model'

describe('ptToViewBoxUnits', () => {
  it('把 pt 换算成占物理宽度的正确比例', () => {
    // 7 pt is 2.4694 mm, or 13.49 units in a 1000-unit viewBox spanning 183 mm.
    const units = ptToViewBoxUnits(7, 183, 1000)
    expect(units).toBeCloseTo(13.494, 2)

    const fractionOfWidth = units / 1000
    const expectedMm = 7 * (25.4 / 72)
    expect(fractionOfWidth * 183).toBeCloseTo(expectedMm, 4)
  })

  it('viewBox 放大时单位数等比放大,物理尺寸不变', () => {
    const a = ptToViewBoxUnits(7, 183, 1000)
    const b = ptToViewBoxUnits(7, 183, 4000)
    expect(b / a).toBeCloseTo(4, 6)
  })

  it('拒绝非法尺寸时回落原值而不是产生 NaN', () => {
    expect(ptToViewBoxUnits(7, 0, 1000)).toBe(7)
    expect(ptToViewBoxUnits(7, 183, 0)).toBe(7)
  })
})

describe('chooseScaleBarLength', () => {
  it('取 1/2/5×10ⁿ 的整数长度,不产生 3.7 Å 这种数字', () => {
    expect(chooseScaleBarLength(10, 200)?.lengthAngstrom).toBe(20)
    expect(chooseScaleBarLength(50, 200)?.lengthAngstrom).toBe(5)
    expect(chooseScaleBarLength(100, 120)?.lengthAngstrom).toBe(1)
  })

  it('像素长度与所选埃长严格一致', () => {
    const bar = chooseScaleBarLength(37.5, 200)
    expect(bar).not.toBeNull()
    expect(bar!.lengthPx).toBeCloseTo(bar!.lengthAngstrom * 37.5, 6)
  })

  it('极小尺度也给出规整值', () => {
    expect(chooseScaleBarLength(2000, 160)?.lengthAngstrom).toBeCloseTo(0.1, 6)
  })

  it('非法输入返回 null', () => {
    expect(chooseScaleBarLength(0, 200)).toBeNull()
    expect(chooseScaleBarLength(10, 0)).toBeNull()
    expect(chooseScaleBarLength(Number.NaN, 200)).toBeNull()
  })
})

describe('formatScaleBarLabel', () => {
  it('整数不带多余小数', () => {
    expect(formatScaleBarLabel(5)).toBe('5 \u00C5')
    expect(formatScaleBarLabel(2.5)).toBe('2.5 \u00C5')
  })
})

describe('buildAnnotationSvg', () => {
  it('输出物理尺寸 + 逻辑 viewBox,两者解耦', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [],
    })
    expect(svg).toContain('width="183mm"')
    expect(svg).toContain('viewBox="0 0 800 600"')
  })

  it('转义文本,防止元素标签把 SVG 打坏', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [{ kind: 'custom', text: 'A<B&"C"', x: 10, y: 20 }],
    })
    expect(svg).toContain('A&lt;B&amp;&quot;C&quot;')
    expect(svg).not.toContain('A<B&"C"')
  })

  it('跳过被遮挡的注释,不画指向看不见原子的标签', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [
        { kind: 'atom-label', text: 'VISIBLE', x: 10, y: 20, visible: true },
        { kind: 'atom-label', text: 'HIDDEN', x: 30, y: 40, visible: false },
      ],
    })
    expect(svg).toContain('VISIBLE')
    expect(svg).not.toContain('HIDDEN')
  })

  it('注释文字是真矢量 text 而非光栅', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [{ kind: 'measurement', text: '1.54 A', x: 100, y: 200 }],
    })
    expect(svg).toContain('<text')
    expect(svg).toContain('1.54 A')
  })

  it('嵌入底图时产出自包含单文件', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [],
      rasterDataUrl: 'data:image/png;base64,AAAA',
    })
    expect(svg).toContain('<image')
    expect(svg).toContain('data:image/png;base64,AAAA')
  })

  it('无底图时只出注释层,便于叠到已有图上', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [{ kind: 'custom', text: 'X', x: 1, y: 2 }],
    })
    expect(svg).not.toContain('<image')
  })

  it('晶格向量画成箭头 + 斜体标签,退化向量被跳过', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [],
      latticeVectors: [
        { label: 'a', originPx: [100, 500], tipPx: [300, 500] },
        // Coincident endpoints mean the vector faces the camera, so no screen-space arrow is valid.
        { label: 'b', originPx: [100, 500], tipPx: [100, 500] },
      ],
    })
    expect(svg).toContain('<polygon')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('>a<')
    expect(svg).not.toContain('>b<')
  })

  it('标尺同时输出线段与带单位的文字', () => {
    const svg = buildAnnotationSvg({
      viewportWidth: 800,
      viewportHeight: 600,
      widthMm: 183,
      heightMm: 137.25,
      annotations: [],
      scaleBar: { lengthAngstrom: 5, lengthPx: 200 },
    })
    expect(svg).toContain('<line')
    expect(svg).toContain('5 \u00C5')
  })
})
