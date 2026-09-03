/**
 * PDF output - one page = one picture, the size is the physical size required for submission.
 *
 * Share captureAnnotationScene with SVG path, so SVG and PDF exported from the same perspective
 * They are the same frame and the same batch of annotation coordinates; the difference is only in the file syntax.
 */

import { buildAnnotationPdf } from './annotation-pdf'
import type { AnnotationStyle } from './annotation-model'
import { captureAnnotationScene, type AnnotationSceneRequest } from './capture-annotation-scene'
import { figureTimestamp } from './export-figure'

export interface PdfFigureExportRequest extends AnnotationSceneRequest {
  style?: Partial<AnnotationStyle>
  title?: string
}

export interface PdfFigureExportResult {
  blob: Blob
  widthMm: number
  heightMm: number
  annotationCount: number
  omittedAtomLabels: number
  suggestedFileName: string
}

export async function exportViewportFigurePdf(
  request: PdfFigureExportRequest,
): Promise<PdfFigureExportResult> {
  const scene = await captureAnnotationScene(request)

  const bytes = await buildAnnotationPdf({
    viewportWidth: scene.viewportWidth,
    viewportHeight: scene.viewportHeight,
    widthMm: scene.widthMm,
    heightMm: scene.heightMm,
    annotations: scene.collected.annotations,
    latticeVectors: scene.collected.latticeVectors,
    scaleBar: scene.collected.scaleBar,
    rasterDataUrl: scene.rasterDataUrl,
    style: request.style,
    title: request.title,
  })

  return {
    // Copy into a separate ArrayBuffer: the view returned by pdf-lib may point to a larger buffer,
    // Stuffing the blob directly will write the extra bytes to the file.
    blob: new Blob([bytes.slice().buffer], { type: 'application/pdf' }),
    widthMm: scene.widthMm,
    heightMm: scene.heightMm,
    annotationCount: scene.collected.annotations.length + scene.collected.latticeVectors.length,
    omittedAtomLabels: scene.collected.omittedAtomLabels,
    suggestedFileName: `figure-${figureTimestamp()}.pdf`,
  }
}
