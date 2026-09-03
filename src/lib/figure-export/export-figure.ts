/**
 * export-figure — transfer the "physical width + DPI" export request to the real supersampled frame.
 *
 * Boundary of responsibilities: This module only outputs Blobs with the actual size, and does not trigger downloads - downloads are
 * As a side effect of the interface, after separation, it can be covered by a single test, and the interface can also reuse the same result for preview.
 * Plug into a plate compositor or pack multiple images.
 *
 * Resolution source: viewportCaptureRegistry will temporarily increase the pixelRatio of the renderer,
 * Let WebGL actually render more pixels instead of enlarging the old bitmap. So what we get here is true high definition,
 * Not interpolation amplification.
 */

import {
  captureViewport,
  clampViewportCaptureMaxDimension,
  getViewportLogicalSize,
  hasRegisteredViewportCapture,
  VIEWPORT_CAPTURE_MAX_DIMENSION,
} from '../../orchestration/viewportCaptureRegistry'
import { resolveFigurePixels, type FigurePixelPlan } from './figure-size'

export type FigureImageFormat = 'png' | 'jpeg'

export interface FigureExportRequest {
  widthMm: number
  dpi: number
  format: FigureImageFormat
  /**
  * Only valid for PNG; JPEG has no alpha, and the capture layer will fall back to a white background.
  */
  transparent: boolean
  /**
  * Specify the canvas to be exported under multiple viewports (store identity of active viewport).
  */
  registryKey?: unknown
}

export interface FigureExportResult {
  blob: Blob
  /**
  * Conversion plan (requested value).
  */
  plan: FigurePixelPlan
  /**
  * The actual pixel size returned by the capture layer may have a rounding difference of ±1 from the plan.
  */
  widthPx: number
  heightPx: number
  /**
  * The DPI calculated based on the actual width - this should be reported to the user, not the requested value.
  */
  actualDpi: number
  suggestedFileName: string
}

/**
 * The readable reason for the failure of drawing, for direct display on the interface.
 */
export class FigureExportError extends Error {}

/**
 * Only conversion, no rendering. The interface uses it to display previews such as "1051 × 621 px will be exported" in real time.
 * Prevent users from triggering an expensive high-resolution render just to get a quick look at the size.
 */
export function planViewportFigure(
  request: Pick<FigureExportRequest, 'widthMm' | 'dpi'> & { registryKey?: unknown },
): FigurePixelPlan | null {
  const size = getViewportLogicalSize(request.registryKey)
  if (!size) return null
  return resolveFigurePixels({
    widthMm: request.widthMm,
    dpi: request.dpi,
    viewportWidthPx: size.width,
    viewportHeightPx: size.height,
    maxDimensionPx: VIEWPORT_CAPTURE_MAX_DIMENSION,
  })
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new FigureExportError('The renderer returned a malformed image.')
  const base64 = dataUrl.slice(comma + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/**
 * File name timestamp - exporting multiple images in the same session will not overwrite each other. SVG/PDF paths are shared.
 */
export function figureTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

export async function exportViewportFigure(
  request: FigureExportRequest,
): Promise<FigureExportResult> {
  if (request.registryKey != null && !hasRegisteredViewportCapture(request.registryKey)) {
    throw new FigureExportError('The 3D viewport is not ready yet — wait for the structure to render.')
  }
  const plan = planViewportFigure(request)
  if (!plan) {
    throw new FigureExportError('Could not read the viewport size — is a structure open?')
  }

  const capture = await captureViewport(
    {
      maxDim: clampViewportCaptureMaxDimension(plan.longEdgePx),
      format: request.format,
      background: request.format === 'png' && request.transparent ? 'transparent' : '#ffffff',
    },
    request.registryKey,
  )
  if (!capture) {
    throw new FigureExportError('The renderer could not produce a frame. Try again in a moment.')
  }

  const blob = dataUrlToBlob(capture.dataUrl, capture.mimeType)
  const actualDpi = capture.width / (request.widthMm / 25.4)
  return {
    blob,
    plan,
    widthPx: capture.width,
    heightPx: capture.height,
    actualDpi,
    suggestedFileName: `figure-${figureTimestamp()}.${request.format === 'png' ? 'png' : 'jpg'}`,
  }
}
