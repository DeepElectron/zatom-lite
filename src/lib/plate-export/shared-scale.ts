/**
 * Resolve a common px/Å scale for a scientific plate. Use the smallest input
 * scale so every panel can be reduced to match without cropping its structure.
 */

export interface PlateCellScale {
  /**
  * Panel number, corresponding to the label of plate-layout.
  */
  label: string
  /**
  * How many pixels per angstrom the grid currently occupies.
  */
  pxPerAngstrom: number
}

export interface ResolvedCellScale {
  label: string
  /**
  * Content scaling coefficient, ≤1. 1 means that this grid is the reference grid.
  */
  contentScale: number
}

export interface SharedScaleResult {
  /**
  * px/Å shared by the whole image version.
  */
  sharedPxPerAngstrom: number
  cells: ResolvedCellScale[]
}

/** Return common scale and panel factors, or null if any panel is unmeasurable. */
export function resolveSharedScale(cells: PlateCellScale[]): SharedScaleResult | null {
  if (cells.length === 0) return null
  if (!cells.every((cell) => Number.isFinite(cell.pxPerAngstrom) && cell.pxPerAngstrom > 0)) {
    return null
  }
  const sharedPxPerAngstrom = Math.min(...cells.map((cell) => cell.pxPerAngstrom))
  return {
    sharedPxPerAngstrom,
    cells: cells.map((cell) => ({
      label: cell.label,
      contentScale: sharedPxPerAngstrom / cell.pxPerAngstrom,
    })),
  }
}
