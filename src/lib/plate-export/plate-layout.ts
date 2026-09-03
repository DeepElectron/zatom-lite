/** Pure physical layout for journal panels that share one Å-to-mm scale. */

/**
 * Number of grids on the board. Journal plates rarely exceed 4 panels (a/b/c/d).
 */
export type PlateCellCount = 2 | 3 | 4

export interface PlateLayoutRequest {
  /**
  * Total width of the plate (mm). Journals usually have 183 double columns and 89 single columns.
  */
  widthMm: number
  cellCount: PlateCellCount
  /**
  * The aspect ratio (w/h) of each frame is determined by the actual pixel size of the viewport, ensuring no stretching and deformation.
  */
  cellAspect: number
  /**
  * Grid spacing (mm).
  */
  gutterMm: number
  /**
  * Plate margin (mm).
  */
  marginMm: number
  /**
  * Number of cells per column. 2 means 2×2 / 2×1; 1 means vertical arrangement.
  */
  columns: 1 | 2
  /**
  * Maximum plate height in mm. Tall source views shrink and letterbox rather
  * than stretching or creating an impractically long plate.
  */
  maxHeightMm?: number
}

export interface PlateCellBox {
  /**
  * Panel number, starting from 'a'.
  */
  label: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

export interface PlateLayout {
  widthMm: number
  heightMm: number
  cells: PlateCellBox[]
}

const PANEL_LABELS = ['a', 'b', 'c', 'd'] as const

/** Return panel positions and plate height, or null for transient invalid dimensions. */
export function resolvePlateLayout(request: PlateLayoutRequest): PlateLayout | null {
  const { widthMm, cellCount, cellAspect, gutterMm, marginMm, columns, maxHeightMm } = request
  if (![widthMm, cellAspect, gutterMm, marginMm].every(Number.isFinite)) return null
  if (!(widthMm > 0) || !(cellAspect > 0)) return null
  if (gutterMm < 0 || marginMm < 0) return null

  const rows = Math.ceil(cellCount / columns)
  const contentWidth = widthMm - marginMm * 2 - gutterMm * (columns - 1)
  if (!(contentWidth > 0)) return null

  const columnWidth = contentWidth / columns
  const fixedHeight = marginMm * 2 + gutterMm * (rows - 1)

  // Fill column width first, then shrink by available height when necessary.
  let cellWidth = columnWidth
  let cellHeight = columnWidth / cellAspect
  if (maxHeightMm !== undefined) {
    if (!Number.isFinite(maxHeightMm) || !(maxHeightMm > fixedHeight)) return null
    const maxCellHeight = (maxHeightMm - fixedHeight) / rows
    if (cellHeight > maxCellHeight) {
      cellHeight = maxCellHeight
      cellWidth = maxCellHeight * cellAspect
    }
  }

  const heightMm = fixedHeight + cellHeight * rows

  const cells: PlateCellBox[] = []
  for (let index = 0; index < cellCount; index += 1) {
    const row = Math.floor(index / columns)
    const column = index % columns
    cells.push({
      label: PANEL_LABELS[index],
      // Center a height-constrained cell within its column.
      xMm: marginMm + column * (columnWidth + gutterMm) + (columnWidth - cellWidth) / 2,
      yMm: marginMm + row * (cellHeight + gutterMm),
      widthMm: cellWidth,
      heightMm: cellHeight,
    })
  }

  return { widthMm, heightMm, cells }
}

/** Pixel size for a shared-width panel at the requested DPI. */
export function plateCellPixelSize(
  cell: PlateCellBox,
  dpi: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(dpi) || !(dpi > 0)) return null
  const mmToPx = dpi / 25.4
  const width = Math.round(cell.widthMm * mmToPx)
  const height = Math.round(cell.heightMm * mmToPx)
  if (!(width > 0) || !(height > 0)) return null
  return { width, height }
}
