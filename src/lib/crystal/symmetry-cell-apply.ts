/**
 * Write the symmetry cells (primitive / conventional) returned by spglib back into loadable structured text.
 *
 * Background: In the response of `analyzeSymmetry`, `primitiveCell` / `conventionalCell` are both complete
 * `atoms` + `lattice.matrix`, but the UI side always only reads `atomCount` and matrix for display——
 * The detection results are never written back to the structure. This module makes up for that step.
 *
 * Use exxxyz instead of CIF: primitive cell reduction is a structural reconstruction in nature, and it is under builders/
 * slab/cluster/adsorbate are completely similar, they all go the same way "emit extxyz -> loadFromXYZ
 * ({ documentMode: 'edit' })" This reversible reconstruction path. loadFromCIF has no documentMode,
 * Document-level dismantling will be done unconditionally (clearing layers, clearing timeline, resetting camera), which is too expensive for one edit.
 *
 * exxxyz is more direct here: the symmetric response gives Cartesian coordinates + lattice matrix, and does not need to be like CIF
 * That way the fractional coordinates are back calculated.
 */

import { atomicNumberToSymbol } from './elements'
import type { StructureSymmetryCell } from '../../contracts/structures'

export interface SymmetryCellXyzResult {
  ok: true
  xyz: string
  atomCount: number
}

export interface SymmetryCellXyzError {
  ok: false
  error: string
}

/**
 * Symmetry cell -> exxxyz text.
 *
 * The `element` of `StructureSymmetryCell.atoms` is the atomic number (not the symbol), so do it here
 * Translation of primary ordinal -> symbol. `lattice.matrix` is a three-row lattice vector, which is flattened according to a, b, c
 * `Lattice="..."` header - consistent with the line order convention of emitters under builders/.
 */
export function symmetryCellToExtxyz(
  cell: StructureSymmetryCell | undefined | null,
  options: { label?: string } = {},
): SymmetryCellXyzResult | SymmetryCellXyzError {
  if (!cell) return { ok: false, error: 'No cell in symmetry response' }
  if (!Array.isArray(cell.atoms) || cell.atoms.length === 0) {
    return { ok: false, error: 'Symmetry response contains no atoms' }
  }

  const matrix = cell.lattice?.matrix
  if (!Array.isArray(matrix) || matrix.length !== 3) {
    return { ok: false, error: 'Symmetry response has an invalid lattice matrix' }
  }
  const flat: number[] = []
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== 3 || !row.every((v) => Number.isFinite(v))) {
      return { ok: false, error: 'Symmetry response has an invalid lattice matrix' }
    }
    flat.push(...row)
  }

  const rows: string[] = []
  for (const atom of cell.atoms) {
    const symbol = atomicNumberToSymbol(atom.element)
    if (!symbol) {
      return { ok: false, error: `Unknown atomic number ${atom.element} in symmetry response` }
    }
    if (![atom.x, atom.y, atom.z].every((v) => Number.isFinite(v))) {
      return { ok: false, error: 'Symmetry response has non-finite atom coordinates' }
    }
    rows.push(
      `${symbol} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${atom.z.toFixed(6)}`,
    )
  }

  const latStr = flat.map((v) => v.toFixed(6)).join(' ')
  const comment = options.label ? ` ${options.label}` : ''
  const xyz = [
    String(rows.length),
    `Lattice="${latStr}" Properties=species:S:1:pos:R:3${comment}`,
    ...rows,
  ].join('\n')

  return { ok: true, xyz, atomCount: rows.length }
}
