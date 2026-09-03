import type { CellOverflowMode } from "../../lib/crystal/cell-overflow"

/**
 * Canonical options for atoms moved outside the unit cell. Both settings
 * surfaces share these short labels and detailed trade-off hints.
 */
export const CELL_OVERFLOW_OPTIONS: readonly { mode: CellOverflowMode; label: string; hint: string }[] = [
  {
    mode: 'grow-cell',
    label: 'Grow',
    hint: 'Drag anywhere and the cell grows to reach it: the atom keeps the exact coordinate you dropped it at, and the lattice constants change to contain it.',
  },
  {
    mode: 'tile-images',
    label: 'Images',
    hint: 'The cell itself never changes. Copies of it are tiled outward so the atom stays where you dropped it, and its periodic twin in every copy moves along with it. Stored coordinates stay inside the cell.',
  },
  {
    mode: 'fold-in',
    label: 'Fold in',
    hint: 'The atom is folded to its equivalent position inside the cell, so it jumps to the opposite side. Classic crystallographic behaviour, and the only mode where atoms appear to teleport.',
  },
]
