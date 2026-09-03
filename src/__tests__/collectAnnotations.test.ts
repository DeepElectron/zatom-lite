import { describe, expect, it } from 'vitest'
import {
  collectProjectedAnnotations,
  type AnnotationAtom,
  type AnnotationProjector,
} from '../lib/figure-export/collect-annotations'

/** Test projector that maps world x/y directly to pixels. */
function makeProjector(opts: { visible?: boolean; radiusPx?: number } = {}): {
  projector: AnnotationProjector
  calls: [number, number, number][]
} {
  const calls: [number, number, number][] = []
  const projector: AnnotationProjector = async (target) => {
    calls.push(target.center)
    return {
      centerNdc: [0, 0, 0],
      centerPx: [target.center[0], target.center[1]],
      viewportSizePx: [1000, 800],
      projectedRadiusPx: opts.radiusPx ?? target.radius * 40,
      centerVisible: opts.visible ?? true,
      regionVisible: true,
    }
  }
  return { projector, calls }
}

const atoms: AnnotationAtom[] = [
  { id: 'a1', element: 'C', position: [0, 0, 0] },
  { id: 'a2', element: 'H', position: [10, 20, 0] },
  { id: 'a3', element: 'O', position: [40, 60, 0] },
]

const base = {
  atoms,
  measurements: [],
  selectedAtomIds: new Set<string>(),
  atomLabelScope: 'none' as const,
  includeMeasurements: false,
  includeScaleBar: false,
}

describe('collectProjectedAnnotations - 原子标签', () => {
  it("scope='selected' 只标选中的原子", async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      atomLabelScope: 'selected',
      selectedAtomIds: new Set(['a2']),
      projector,
    })
    expect(out.annotations).toHaveLength(1)
    expect(out.annotations[0].text).toBe('H')
    expect(out.annotations[0].x).toBe(10)
    expect(out.annotations[0].y).toBe(20)
  })

  it("scope='none' 不产生任何标签", async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({ ...base, projector })
    expect(out.annotations).toHaveLength(0)
  })

  it('遮挡的原子标签被标记为不可见', async () => {
    const { projector } = makeProjector({ visible: false })
    const out = await collectProjectedAnnotations({
      ...base,
      atomLabelScope: 'all',
      projector,
    })
    expect(out.annotations.every((a) => a.visible === false)).toBe(true)
  })

  it('超过上限时截断并如实报告省略数量', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      atomLabelScope: 'all',
      maxAtomLabels: 2,
      projector,
    })
    expect(out.annotations).toHaveLength(2)
    expect(out.omittedAtomLabels).toBe(1)
  })

  it('自定义 label 优先于元素符号', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      atoms: [{ id: 'x', element: 'C', position: [1, 2, 0], label: 'C1' }],
      atomLabelScope: 'all',
      projector,
    })
    expect(out.annotations[0].text).toBe('C1')
  })
})

describe('collectProjectedAnnotations - 测量值', () => {
  it('距离锚在两端点中点', async () => {
    const { projector, calls } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      measurements: [{ id: 'm1', type: 'distance', atomIds: ['a1', 'a2'], value: 1.537 }],
      includeMeasurements: true,
      projector,
    })
    expect(calls[0]).toEqual([5, 10, 0])
    expect(out.annotations[0].text).toBe('1.54 \u00C5')
  })

  it('角度锚在顶点原子而非几何中心', async () => {
    const { projector, calls } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      measurements: [{ id: 'm2', type: 'angle', atomIds: ['a1', 'a2', 'a3'], value: 109.47 }],
      includeMeasurements: true,
      projector,
    })
    expect(calls[0]).toEqual([10, 20, 0])
    expect(out.annotations[0].text).toBe('109.5\u00B0')
  })

  it('测量值即使被遮挡也保持可见 —— 它是结论不是位置指示', async () => {
    const { projector } = makeProjector({ visible: false })
    const out = await collectProjectedAnnotations({
      ...base,
      measurements: [{ id: 'm1', type: 'distance', atomIds: ['a1', 'a2'], value: 1.5 }],
      includeMeasurements: true,
      projector,
    })
    expect(out.annotations[0].visible).toBe(true)
  })

  it('引用不存在的原子时跳过而不抛错', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      measurements: [{ id: 'm1', type: 'distance', atomIds: ['ghost', 'a2'], value: 1.5 }],
      includeMeasurements: true,
      projector,
    })
    expect(out.annotations).toHaveLength(0)
  })
})

describe('collectProjectedAnnotations - 标尺', () => {
  it('由 1 Å 探针的像素半径反推每埃像素数', async () => {
    // radiusPx=radius*40 gives 40 px/angstrom, so 5 angstroms occupies the 200-pixel target.
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      includeScaleBar: true,
      projector,
    })
    expect(out.scaleBar).not.toBeNull()
    expect(out.scaleBar!.lengthAngstrom).toBe(5)
    expect(out.scaleBar!.lengthPx).toBeCloseTo(200, 6)
  })

  it('投影失败时不产出标尺,而不是给个错比例', async () => {
    const { projector } = makeProjector({ radiusPx: 0 })
    const out = await collectProjectedAnnotations({
      ...base,
      includeScaleBar: true,
      projector,
    })
    expect(out.scaleBar).toBeNull()
  })

  it('空结构不产出标尺', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      atoms: [],
      includeScaleBar: true,
      projector,
    })
    expect(out.scaleBar).toBeNull()
  })
})

describe('collectProjectedAnnotations - 晶格向量', () => {
  it('从世界原点分别投影 a/b/c 两端,而不是假设等长', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      latticeVectors: { a: [5, 0, 0], b: [0, 7, 0], c: [0, 0, 9] },
      projector,
    })
    expect(out.latticeVectors.map((v) => v.label)).toEqual(['a', 'b', 'c'])
    const a = out.latticeVectors[0]
    expect(a.originPx).toEqual([0, 0])
    expect(a.tipPx).toEqual([5, 0])
    // c projects to coincident x/y points; collection preserves it for render-time degeneracy handling.
    expect(out.latticeVectors[2].tipPx).toEqual([0, 0])
  })

  it('零向量(晶胞数据不完整)不产出箭头', async () => {
    const { projector } = makeProjector()
    const out = await collectProjectedAnnotations({
      ...base,
      latticeVectors: { a: [5, 0, 0], b: [0, 0, 0], c: [0, 0, 9] },
      projector,
    })
    expect(out.latticeVectors.map((v) => v.label)).toEqual(['a', 'c'])
  })

  it('未开启时不投影,也不产生额外的投影调用', async () => {
    const { projector, calls } = makeProjector()
    const out = await collectProjectedAnnotations({ ...base, projector })
    expect(out.latticeVectors).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})
