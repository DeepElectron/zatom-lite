import type { CellOverflowMode } from "../../lib/crystal/cell-overflow"

// Shared by the Structure sidebar and Interaction settings.
export const CELL_OVERFLOW_OPTIONS: readonly { mode: CellOverflowMode; label: string; hint: string }[] = [
  {
    mode: 'tile-images',
    label: 'Images',
    hint: 'Keep the cell fixed. Outside atoms stay visible in their image cells; stored coordinates fold inside. Atoms already inside need no extra image cells.',
  },
  {
    mode: 'fold-in',
    label: 'Fold in',
    hint: 'Keep the cell fixed and move outside atoms to the equivalent position on the opposite side. Atoms already inside stay put.',
  },
]
