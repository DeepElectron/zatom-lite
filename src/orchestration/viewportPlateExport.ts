/**
 * Composes the current grid's 3D viewports into an a/b/c/d figure plate.
 *
 * This orchestration layer alone combines viewport membership, each viewport's
 * registered canvas and camera, and pure plate geometry. plate-layout and
 * shared-scale therefore remain independent pure modules.
 *
 * The tool never changes viewport cameras; users arrange each view themselves.
 * It instead enforces a shared scale by measuring each panel's px/Å and using
 * the minimum, so 1 Å has equal length in every panel.
 */

import {
  captureViewport,
  clampViewportCaptureMaxDimension,
  getViewportLogicalSize,
  hasRegisteredViewportCapture,
  measureViewportTarget,
} from './viewportCaptureRegistry'
import {
  plateCellPixelSize,
  resolvePlateLayout,
  type PlateCellCount,
  type PlateLayout,
} from '../lib/plate-export/plate-layout'
import { resolveSharedScale, type PlateCellScale } from '../lib/plate-export/shared-scale'
import {
  buildPlateSvg,
  type PlateCellContent,
  type PlateSharedScaleBar,
} from '../lib/plate-export/plate-svg'
import { chooseScaleBarLength } from '../lib/figure-export/annotation-model'
import { figureTimestamp } from '../lib/figure-export/export-figure'

export class PlateExportError extends Error {}

/**
 * Maximum plate height in mm = 297 mm A4 height minus 10 mm top and bottom margins.
 *
 * Narrow, tall split-screen viewports can otherwise imply a plate over 800 mm high.
 * When capped, plate-layout derives panel width from height and centers panels
 * with whitespace without distorting their contents.
 */
const PLATE_MAX_HEIGHT_MM = 277

/** Panel input: label, capture key, and structure centroid for measuring px/Å. */
export interface PlateSourceCell {
  label: string
  registryKey: unknown
  /** Cartesian structure centroid in Å, used to measure px/Å like a single-image scale bar. */
  centroid: [number, number, number]
}

export interface PlateExportRequest {
  cells: PlateSourceCell[]
  widthMm: number
  dpi: number
  columns: 1 | 2
  gutterMm: number
  marginMm: number
  labelFontSizePt: number
  transparent: boolean
  /** Whether to draw one shared scale bar across the full plate. */
  includeSharedScaleBar: boolean
}

export interface PlateExportResult {
  blob: Blob
  suggestedFileName: string
  layout: PlateLayout
  /** Shared px/Å scale reported to the UI to indicate normalization. */
  sharedPxPerAngstrom: number
  /** Number of scaled panels; zero means all panels already shared the same scale. */
  rescaledCells: number
}

export async function exportViewportPlate(
  request: PlateExportRequest,
): Promise<PlateExportResult> {
  const { cells } = request
  if (cells.length < 2 || cells.length > 4) {
    throw new PlateExportError('A plate needs 2 to 4 panels.')
  }
  for (const cell of cells) {
    if (!hasRegisteredViewportCapture(cell.registryKey)) {
      throw new PlateExportError(
        `Panel ${cell.label} is not rendering yet — wait for all viewports to load.`,
      )
    }
  }

  // Use the first viewport's aspect ratio for every equal-sized panel. Grid
  // rounding can differ by a few DOM pixels; one canonical shape avoids a plate
  // with three 400×300 panels and one 401×300 panel.
  const firstSize = getViewportLogicalSize(cells[0].registryKey)
  if (!firstSize || !(firstSize.width > 0) || !(firstSize.height > 0)) {
    throw new PlateExportError('Could not read the viewport size — is a structure open?')
  }

  const layout = resolvePlateLayout({
    widthMm: request.widthMm,
    cellCount: cells.length as PlateCellCount,
    cellAspect: firstSize.width / firstSize.height,
    gutterMm: request.gutterMm,
    marginMm: request.marginMm,
    columns: request.columns,
    maxHeightMm: PLATE_MAX_HEIGHT_MM,
  })
  if (!layout) {
    throw new PlateExportError('Those plate dimensions do not leave room for the panels.')
  }

  // ---- Measure each panel scale ----
  const measured: PlateCellScale[] = []
  for (const cell of cells) {
    const probe = await measureViewportTarget(
      { center: cell.centroid, radius: 1 },
      cell.registryKey,
    )
    if (!probe || !(probe.projectedRadiusPx > 0)) {
      throw new PlateExportError(
        `Could not measure the scale of panel ${cell.label}. Make sure it has a structure.`,
      )
    }
    measured.push({ label: cell.label, pxPerAngstrom: probe.projectedRadiusPx })
  }

  const shared = resolveSharedScale(measured)
  if (!shared) {
    throw new PlateExportError('Could not resolve a shared scale across the panels.')
  }
  const scaleByLabel = new Map(shared.cells.map((cell) => [cell.label, cell.contentScale]))

  // ---- Capture each panel ----
  const cellPixels = plateCellPixelSize(layout.cells[0], request.dpi)
  if (!cellPixels) {
    throw new PlateExportError('That DPI is not usable for this plate size.')
  }
  const contents: PlateCellContent[] = []
  for (const cell of cells) {
    const capture = await captureViewport(
      {
        maxDim: clampViewportCaptureMaxDimension(
          Math.max(cellPixels.width, cellPixels.height),
        ),
        format: 'png',
        background: request.transparent ? 'transparent' : '#ffffff',
      },
      cell.registryKey,
    )
    if (!capture) {
      throw new PlateExportError(
        `The renderer could not produce a frame for panel ${cell.label}.`,
      )
    }
    contents.push({
      label: cell.label,
      rasterDataUrl: capture.dataUrl,
      contentScale: scaleByLabel.get(cell.label) ?? 1,
    })
  }

  // ---- Shared scale bar ----
  let sharedScaleBar: PlateSharedScaleBar | null = null
  if (request.includeSharedScaleBar) {
    // Target 25% of one panel width, then snap to a 1/2/5×10ⁿ angstrom value.
    const cellWidthPx = cellPixels.width
    const bar = chooseScaleBarLength(shared.sharedPxPerAngstrom, cellWidthPx * 0.25)
    if (bar) {
      sharedScaleBar = {
        lengthAngstrom: bar.lengthAngstrom,
        // Convert px to mm using the first panel's pixel and physical widths.
        lengthMm: (bar.lengthPx / cellWidthPx) * layout.cells[0].widthMm,
      }
    }
  }

  const svg = buildPlateSvg({
    layout,
    cells: contents,
    labelFontSizePt: request.labelFontSizePt,
    backgroundColor: request.transparent ? null : '#ffffff',
    sharedScaleBar,
  })

  return {
    blob: new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
    suggestedFileName: `plate-${figureTimestamp()}.svg`,
    layout,
    sharedPxPerAngstrom: shared.sharedPxPerAngstrom,
    rescaledCells: shared.cells.filter((cell) => cell.contentScale < 0.999).length,
  }
}
