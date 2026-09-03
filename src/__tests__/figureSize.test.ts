import { describe, expect, it } from 'vitest'
import {
  JOURNAL_PRESETS,
  describeHeightOverflow,
  resolveFigurePixels,
} from '../lib/figure-export/figure-size'

const LANDSCAPE = { viewportWidthPx: 1537, viewportHeightPx: 908 }

describe('resolveFigurePixels', () => {
  it('converts a physical width at a target DPI into pixels', () => {
    const plan = resolveFigurePixels({
      widthMm: 89,
      dpi: 300,
      ...LANDSCAPE,
      maxDimensionPx: 8192,
    })
    // 89 mm = 3.5039 in; × 300 DPI = 1051 px
    expect(plan.widthPx).toBe(1051)
    expect(plan.limitedByMaxDimension).toBe(false)
    expect(plan.effectiveDpi).toBeCloseTo(300, 0)
  })

  it('keeps the viewport aspect ratio so framing is never silently altered', () => {
    const plan = resolveFigurePixels({
      widthMm: 183,
      dpi: 300,
      ...LANDSCAPE,
      maxDimensionPx: 8192,
    })
    expect(plan.widthPx / plan.heightPx).toBeCloseTo(1537 / 908, 2)
  })

  it('reports the long edge as height for a portrait viewport', () => {
    // maxDim means long edge; using portrait width would undershoot requested DPI.
    const plan = resolveFigurePixels({
      widthMm: 89,
      dpi: 300,
      viewportWidthPx: 908,
      viewportHeightPx: 1537,
      maxDimensionPx: 8192,
    })
    expect(plan.longEdgePx).toBe(plan.heightPx)
    expect(plan.heightPx).toBeGreaterThan(plan.widthPx)
  })

  it('degrades DPI honestly when the hardware long-edge limit is hit', () => {
    // 183 mm at 600 DPI is 4323 pixels, above the former 4096 limit.
    const plan = resolveFigurePixels({
      widthMm: 183,
      dpi: 600,
      ...LANDSCAPE,
      maxDimensionPx: 4096,
    })
    expect(plan.limitedByMaxDimension).toBe(true)
    expect(plan.longEdgePx).toBe(4096)
    expect(plan.effectiveDpi).toBeLessThan(600)
    expect(plan.effectiveDpi).toBeGreaterThan(500)
  })

  it('reaches a full 600 DPI double-column figure under the raised limit', () => {
    const plan = resolveFigurePixels({
      widthMm: 183,
      dpi: 600,
      ...LANDSCAPE,
      maxDimensionPx: 8192,
    })
    expect(plan.limitedByMaxDimension).toBe(false)
    expect(plan.widthPx).toBe(4323)
    expect(plan.effectiveDpi).toBeCloseTo(600, 0)
  })
})

describe('describeHeightOverflow', () => {
  it('flags a figure taller than the journal limit', () => {
    const nature = JOURNAL_PRESETS.find((p) => p.id === 'nature-double')
    const plan = resolveFigurePixels({
      widthMm: 183,
      dpi: 300,
      viewportWidthPx: 400,
      viewportHeightPx: 1200,
      maxDimensionPx: 8192,
    })
    expect(plan.heightMm).toBeGreaterThan(247)
    expect(describeHeightOverflow(plan, nature)).toContain('exceeds')
  })

  it('stays silent for a figure within the limit', () => {
    const nature = JOURNAL_PRESETS.find((p) => p.id === 'nature-double')
    const plan = resolveFigurePixels({
      widthMm: 183,
      dpi: 300,
      ...LANDSCAPE,
      maxDimensionPx: 8192,
    })
    expect(describeHeightOverflow(plan, nature)).toBeNull()
  })
})
