/**
 * Contract tests for figure-export orchestration.
 *
 * Ensure transparent-background requests reach capture options. Browser tests verify actual pixel
 * alpha, while this suite prevents orchestration from silently falling back to white.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { registerViewportCapture } from '../orchestration/viewportCaptureRegistry'
import { exportViewportFigure, planViewportFigure } from '../lib/figure-export/export-figure'

type CaptureOpts = { maxDim?: number; format?: 'jpeg' | 'png'; background?: string }

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** Register a fake viewport and record capture options. */
function stubViewport(key: object, viewport = { width: 800, height: 600 }) {
  const seen: CaptureOpts[] = []
  cleanups.push(registerViewportCapture(key, {
    capture: async (opts) => {
      seen.push(opts ?? {})
      const longEdge = Math.min(opts?.maxDim ?? 768, 8192)
      const width = longEdge
      const height = Math.round(longEdge * (viewport.height / viewport.width))
      return {
        // Valid base64 for a transparent 1x1 PNG so dataUrlToBlob receives real bytes.
        dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQL9M4EAAAAASUVORK5CYII=',
        mimeType: opts?.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        width,
        height,
      }
    },
    getViewportSize: () => viewport,
  }))
  return seen
}

describe('planViewportFigure', () => {
  it('183 mm @ 300 DPI 得到 2161 px(真机实测一致)', () => {
    const key = {}
    stubViewport(key)
    const plan = planViewportFigure({ widthMm: 183, dpi: 300, registryKey: key })
    expect(plan?.widthPx).toBe(2161)
  })

  it('未注册视口时返回 null,而不是编造一个尺寸', () => {
    expect(planViewportFigure({ widthMm: 89, dpi: 300, registryKey: {} })).toBeNull()
  })
})

describe('exportViewportFigure', () => {
  it('transparent + png 时向捕获层请求透明底', async () => {
    const key = {}
    const seen = stubViewport(key)
    await exportViewportFigure({ widthMm: 89, dpi: 300, format: 'png', transparent: true, registryKey: key })
    expect(seen[0].background).toBe('transparent')
    expect(seen[0].format).toBe('png')
  })

  it('不勾透明时请求白底(多数期刊要求实底)', async () => {
    const key = {}
    const seen = stubViewport(key)
    await exportViewportFigure({ widthMm: 89, dpi: 300, format: 'png', transparent: false, registryKey: key })
    expect(seen[0].background).toBe('#ffffff')
  })

  it('JPEG 即使勾了透明也请求白底 —— JPEG 无 alpha,透明会变黑底', async () => {
    const key = {}
    const seen = stubViewport(key)
    await exportViewportFigure({ widthMm: 89, dpi: 300, format: 'jpeg', transparent: true, registryKey: key })
    expect(seen[0].background).toBe('#ffffff')
  })

  it('回报的 DPI 按实际像素回算,不照抄请求值', async () => {
    const key = {}
    stubViewport(key)
    // The 8192 long-edge cap makes effective DPI lower than the requested 1200.
    const result = await exportViewportFigure({
      widthMm: 183, dpi: 1200, format: 'png', transparent: false, registryKey: key,
    })
    expect(result.actualDpi).toBeLessThan(1200)
    expect(result.widthPx).toBeLessThanOrEqual(8192)
  })

  it('视口未就绪时报出可读原因,而不是抛裸错误', async () => {
    await expect(
      exportViewportFigure({ widthMm: 89, dpi: 300, format: 'png', transparent: false, registryKey: {} }),
    ).rejects.toThrow(/viewport is not ready/i)
  })
})
