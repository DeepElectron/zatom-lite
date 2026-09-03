/**
 * capture-annotation-scene — Snapshot of the "basemap + projection annotation" required to produce a map.
 *
 * Why are independent: The two export paths of SVG and PDF require **exactly the same frame** - the same camera,
 * The same supersampling screenshot and the same batch of annotation coordinates. If each screenshot is taken once, the user will
 * If the viewing angle is changed a little, the two formats of the same image will not match up, and this misalignment is extremely difficult to detect.
 *
 * Timing: screenshot first and then project. In the screenshot, only the pixelRatio of the renderer is changed, and the camera is not moved.
 * Immediately after projection, the camera drift window between annotation and basemap is minimized.
 */

import {
  captureViewport,
  clampViewportCaptureMaxDimension,
  getViewportLogicalSize,
  hasRegisteredViewportCapture,
  measureViewportTarget,
} from '../../orchestration/viewportCaptureRegistry'
import {
  collectProjectedAnnotations,
  type AnnotationAtom,
  type AnnotationLatticeVectors,
  type AnnotationMeasurement,
  type AtomLabelScope,
  type CollectedAnnotations,
} from './collect-annotations'
import { FigureExportError, planViewportFigure } from './export-figure'
import type { FigurePixelPlan } from './figure-size'

export interface AnnotationSceneRequest {
  widthMm: number
  dpi: number
  /**
  * Whether the embedded base image is transparent.
  */
  transparent: boolean
  atoms: AnnotationAtom[]
  measurements: AnnotationMeasurement[]
  selectedAtomIds: ReadonlySet<string>
  atomLabelScope: AtomLabelScope
  includeMeasurements: boolean
  includeScaleBar: boolean
  /**
  * If omitted, the lattice vector will not be drawn.
  */
  latticeVectors?: AnnotationLatticeVectors | null
  /**
  * When false, only the annotation layer is displayed and the structure base map is not embedded.
  */
  embedRaster: boolean
  registryKey?: unknown
}

export interface AnnotationScene {
  /**
  * Viewport logical size - the space where the annotation coordinates are located.
  */
  viewportWidth: number
  viewportHeight: number
  widthMm: number
  /**
  * The physical height is pushed according to the aspect ratio of the viewport to ensure that the image is not deformed.
  */
  heightMm: number
  plan: FigurePixelPlan
  rasterDataUrl: string | null
  collected: CollectedAnnotations
}

export async function captureAnnotationScene(
  request: AnnotationSceneRequest,
): Promise<AnnotationScene> {
  if (request.registryKey != null && !hasRegisteredViewportCapture(request.registryKey)) {
    throw new FigureExportError('The 3D viewport is not ready yet — wait for the structure to render.')
  }
  const size = getViewportLogicalSize(request.registryKey)
  const plan = planViewportFigure(request)
  if (!size || !plan) {
    throw new FigureExportError('Could not read the viewport size — is a structure open?')
  }

  let rasterDataUrl: string | null = null
  if (request.embedRaster) {
    const capture = await captureViewport(
      {
        maxDim: clampViewportCaptureMaxDimension(plan.longEdgePx),
        format: 'png',
        background: request.transparent ? 'transparent' : '#ffffff',
      },
      request.registryKey,
    )
    if (!capture) {
      throw new FigureExportError('The renderer could not produce a frame. Try again in a moment.')
    }
    rasterDataUrl = capture.dataUrl
  }

  const collected = await collectProjectedAnnotations({
    atoms: request.atoms,
    measurements: request.measurements,
    selectedAtomIds: request.selectedAtomIds,
    atomLabelScope: request.atomLabelScope,
    includeMeasurements: request.includeMeasurements,
    includeScaleBar: request.includeScaleBar,
    latticeVectors: request.latticeVectors ?? null,
    projector: (target) => measureViewportTarget(target, request.registryKey),
  })

  return {
    viewportWidth: size.width,
    viewportHeight: size.height,
    widthMm: request.widthMm,
    heightMm: (request.widthMm * size.height) / size.width,
    plan,
    rasterDataUrl,
    collected,
  }
}
