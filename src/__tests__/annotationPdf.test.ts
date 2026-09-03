import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildAnnotationPdf } from '../lib/figure-export/annotation-pdf'

const PT_PER_MM = 72 / 25.4

const base = {
  viewportWidth: 800,
  viewportHeight: 600,
  widthMm: 183,
  heightMm: 137.25,
}

/**
 * Extract strings drawn by PDF text-showing operators.
 *
 * Raw byte matches may be metadata or comments. Only Tj operands prove text is selectable,
 * searchable, and editable in a PDF reader or Illustrator.
 */
function drawnTexts(bytes: Uint8Array): string[] {
  // Inflate every pdf-lib content stream before inspecting text operators.
  const buf = Buffer.from(bytes)
  let decoded = ''
  let cursor = 0
  for (;;) {
    const start = buf.indexOf('stream', cursor)
    if (start < 0) break
    const end = buf.indexOf('endstream', start)
    if (end < 0) break
    cursor = end + 9
    // Skip the LF or CRLF following `stream`.
    let from = start + 6
    if (buf[from] === 0x0d) from += 1
    if (buf[from] === 0x0a) from += 1
    try {
      decoded += inflateSync(buf.subarray(from, end)).toString('latin1')
    } catch {
      // Ignore non-Flate binary sections unrelated to text operators.
    }
  }
  // pdf-lib encodes standard-font text as hexadecimal WinAnsi bytes.
  return [...decoded.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1], 'hex').toString('latin1'),
  )
}

describe('buildAnnotationPdf', () => {
  it('页面尺寸严格等于图幅物理尺寸(排版时无需缩放)', async () => {
    const bytes = await buildAnnotationPdf({ ...base, annotations: [] })
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPage(0)
    expect(doc.getPageCount()).toBe(1)
    expect(page.getWidth()).toBeCloseTo(183 * PT_PER_MM, 3)
    expect(page.getHeight()).toBeCloseTo(137.25 * PT_PER_MM, 3)
  })

  it('注释写成可搜索的 PDF 文本,而不是描线', async () => {
    const bytes = await buildAnnotationPdf({
      ...base,
      annotations: [
        { kind: 'atom-label', text: 'Si1', x: 400, y: 300 },
        { kind: 'measurement', text: '2.35', x: 200, y: 150 },
      ],
    })
    expect(drawnTexts(bytes)).toEqual(['Si1', '2.35'])
  })

  it('被遮挡的注释不写入(与 SVG 一致,不出现指向看不见原子的标签)', async () => {
    const bytes = await buildAnnotationPdf({
      ...base,
      annotations: [
        { kind: 'atom-label', text: 'Visible', x: 100, y: 100, visible: true },
        { kind: 'atom-label', text: 'Hidden', x: 200, y: 200, visible: false },
      ],
    })
    expect(drawnTexts(bytes)).toEqual(['Visible'])
  })

  it('标尺输出线段与带 Å 单位的文本', async () => {
    const bytes = await buildAnnotationPdf({
      ...base,
      annotations: [],
      scaleBar: { lengthAngstrom: 5, lengthPx: 160 },
    })
    // Angstrom is WinAnsi 0xC5 in Helvetica, not ASCII A.
    expect(drawnTexts(bytes)).toEqual(['5 \u00C5'])
  })

  it('退化晶格向量(两端投影重合)不产生编造方向的箭头', async () => {
    const withArrow = await buildAnnotationPdf({
      ...base,
      annotations: [],
      latticeVectors: [{ label: 'a', originPx: [100, 500], tipPx: [300, 500] }],
    })
    const degenerate = await buildAnnotationPdf({
      ...base,
      annotations: [],
      latticeVectors: [{ label: 'a', originPx: [100, 500], tipPx: [100, 500] }],
    })
    expect(drawnTexts(withArrow)).toEqual(['a'])
    // A degenerate arrow must omit its label because the label has no independent meaning.
    expect(drawnTexts(degenerate)).toEqual([])
  })
})
