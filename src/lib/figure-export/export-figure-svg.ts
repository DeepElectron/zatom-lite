/**
 * SVG rendering - a self-contained single file of bitmap structure + vector annotation.
 *
 * Why is this combination: 3D shading (lighting, transparency, volume rendering) cannot be truly vectorized, and hard transfer will result
 * Hundreds of thousands of color block paths, the file is huge and inconsistent with the screen. The annotation text must be editable -
 * The most common review comments are "enlargement marks". Therefore, the structure is raster embedded, and the annotation is real SVG text.
 * Open it in Illustrator and you can change the font size and move the labels without having to go back to the software and redraw the image.
 *
 * This module only does arrangement: the framing is left to captureAnnotationScene, and the writing of file syntax is left to
 * buildAnnotationSvg. The PDF path shares the former, so the two formats are always the same frame.
 */

import { buildAnnotationSvg } from './annotation-svg'
import type { AnnotationStyle } from './annotation-model'
import { captureAnnotationScene, type AnnotationSceneRequest } from './capture-annotation-scene'
import { figureTimestamp } from './export-figure'

export interface SvgFigureExportRequest extends AnnotationSceneRequest {
  style?: Partial<AnnotationStyle>
}

export interface SvgFigureExportResult {
  blob: Blob
  svg: string
  widthPx: number
  heightPx: number
  annotationCount: number
  omittedAtomLabels: number
  suggestedFileName: string
}

export async function exportViewportFigureSvg(
  request: SvgFigureExportRequest,
): Promise<SvgFigureExportResult> {
  const scene = await captureAnnotationScene(request)

  const svg = buildAnnotationSvg({
    viewportWidth: scene.viewportWidth,
    viewportHeight: scene.viewportHeight,
    widthMm: scene.widthMm,
    heightMm: scene.heightMm,
    annotations: scene.collected.annotations,
    latticeVectors: scene.collected.latticeVectors,
    scaleBar: scene.collected.scaleBar,
    rasterDataUrl: scene.rasterDataUrl,
    style: request.style,
  })

  return {
    blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    svg,
    widthPx: scene.plan.widthPx,
    heightPx: scene.plan.heightPx,
    annotationCount: scene.collected.annotations.length + scene.collected.latticeVectors.length,
    omittedAtomLabels: scene.collected.omittedAtomLabels,
    suggestedFileName: `figure-${figureTimestamp()}.svg`,
  }
}
