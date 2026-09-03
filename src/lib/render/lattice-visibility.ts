import type { SupercellParams } from '../crystal/types'

export function resolveLatticeGridVisibility(showLattice: boolean, showCrystalAxes: boolean) {
  return {
    lattice: showLattice,
    axes: showCrystalAxes,
    any: showLattice || showCrystalAxes,
  }
}

export interface LatticeEdgeDescriptor {
  cellIndex: [number, number, number]
  direction: 'a' | 'b' | 'c'
}

/**
 * A supercell boundary is the twelve outer frame lines of the complete
 * nx x ny x nz domain. The generator represents a long frame line as one
 * segment per unit cell, so every segment along those twelve lines belongs to
 * the boundary; all remaining segments form the optional unit-cell grid.
 */
export function isSupercellBoundaryEdge(
  edge: LatticeEdgeDescriptor,
  supercell: SupercellParams,
): boolean {
  const [i, j, k] = edge.cellIndex
  const { nx, ny, nz } = supercell
  if (edge.direction === 'a') return (j === 0 || j === ny) && (k === 0 || k === nz)
  if (edge.direction === 'b') return (i === 0 || i === nx) && (k === 0 || k === nz)
  return (i === 0 || i === nx) && (j === 0 || j === ny)
}

export function resolveLatticeEdges<T extends LatticeEdgeDescriptor>(
  edges: readonly T[],
  supercell: SupercellParams,
  showCellGrid: boolean,
): { boundary: T[]; cellGrid: T[] } {
  const boundary: T[] = []
  const cellGrid: T[] = []
  for (const edge of edges) {
    if (isSupercellBoundaryEdge(edge, supercell)) boundary.push(edge)
    else if (showCellGrid) cellGrid.push(edge)
  }
  return { boundary, cellGrid }
}
