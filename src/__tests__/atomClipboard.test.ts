import { describe, it, expect, beforeEach } from 'vitest'
import {
  formatFragmentAsXyz,
  getClipboardFragment,
  hasClipboardFragment,
  isSelfWrittenText,
  markSelfWrittenText,
  nextPasteOffset,
  parseXyzFragment,
  setClipboardFragment,
  PASTE_OFFSET_STEP,
} from '../lib/atom-clipboard'

describe('atom-clipboard', () => {
  beforeEach(() => {
    setClipboardFragment(null)
    markSelfWrittenText(null)
  })

  it('空片段不算有内容', () => {
    expect(hasClipboardFragment()).toBe(false)
    setClipboardFragment({ atoms: [] })
    expect(hasClipboardFragment()).toBe(false)
  })

  it('XYZ 往返：格式化后再解析得到同样的元素与坐标', () => {
    const frag = {
      atoms: [
        { element: 'Cu', cartesian: [0, 1.8075, 1.8075] as [number, number, number] },
        { element: 'O', cartesian: [-1.5, 0.25, 3] as [number, number, number] },
      ],
    }
    const xyz = formatFragmentAsXyz(frag)
    // Standard XYZ begins with atom count.
    expect(xyz.split('\n')[0]).toBe('2')

    const back = parseXyzFragment(xyz)
    expect(back).not.toBeNull()
    expect(back!.atoms).toHaveLength(2)
    expect(back!.atoms[0].element).toBe('Cu')
    expect(back!.atoms[1].element).toBe('O')
    for (let i = 0; i < 3; i++) {
      expect(back!.atoms[0].cartesian[i]).toBeCloseTo(frag.atoms[0].cartesian[i], 5)
      expect(back!.atoms[1].cartesian[i]).toBeCloseTo(frag.atoms[1].cartesian[i], 5)
    }
  })

  it('解析容忍无计数行、大小写异常、带序号的元素符号', () => {
    // Normalize CU, cu, and Fe1 even without count and comment lines.
    const frag = parseXyzFragment('CU 0 0 0\ncu 1 1 1\nFe1 2 2 2')
    expect(frag).not.toBeNull()
    expect(frag!.atoms.map((a) => a.element)).toEqual(['Cu', 'Cu', 'Fe'])
  })

  it('解析按计数行截断，不会把多余尾巴当原子', () => {
    const frag = parseXyzFragment('1\ncomment\nCu 0 0 0\nO 1 1 1')
    expect(frag!.atoms).toHaveLength(1)
    expect(frag!.atoms[0].element).toBe('Cu')
  })

  it('非法输入返回 null', () => {
    expect(parseXyzFragment('')).toBeNull()
    expect(parseXyzFragment('hello world')).toBeNull()
    // Valid element with missing coordinates.
    expect(parseXyzFragment('Cu 0 0')).toBeNull()
    // Symbol absent from the periodic table.
    expect(parseXyzFragment('Xx 0 0 0')).toBeNull()
  })

  it('连续粘贴偏移递增，副本不会互相重叠', () => {
    const o1 = nextPasteOffset()
    const o2 = nextPasteOffset()
    expect(o1[0]).toBeCloseTo(PASTE_OFFSET_STEP[0], 10)
    expect(o2[0]).toBeCloseTo(PASTE_OFFSET_STEP[0] * 2, 10)
    expect(o2).not.toEqual(o1)
  })

  it('重新复制会重置偏移计数', () => {
    nextPasteOffset()
    nextPasteOffset()
    setClipboardFragment({ atoms: [{ element: 'Cu', cartesian: [0, 0, 0] }] })
    const o = nextPasteOffset()
    expect(o[0]).toBeCloseTo(PASTE_OFFSET_STEP[0], 10)
    expect(getClipboardFragment()!.atoms).toHaveLength(1)
  })

  it('回归：识别自己写出的剪贴板文本，避免零偏移重叠粘贴', () => {
    const frag = { atoms: [{ element: 'Cu', cartesian: [1, 2, 3] as [number, number, number] }] }
    const xyz = formatFragmentAsXyz(frag)
    markSelfWrittenText(xyz)

    // Recognize self-written clipboard text even with trailing whitespace.
    expect(isSelfWrittenText(xyz)).toBe(true)
    expect(isSelfWrittenText(`${xyz}\n`)).toBe(true)
    // Do not misclassify external clipboard text.
    expect(isSelfWrittenText('1\nother\nO 9 9 9')).toBe(false)
  })
})
