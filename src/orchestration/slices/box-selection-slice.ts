/**
 * box-selection-slice — state machine for dragging an atom selection box in the viewport.
 *
 * Four state fields and four actions: enter box-select mode while clearing other
 * selection state, record start/end while dragging, and exit on release.
 *
 * ui/components/crystal-viewer/selection-box.tsx determines which atoms are inside;
 * this slice owns only the rectangle's geometric state.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'

export function applyBoxSelectionOperation(
  base: ReadonlySet<string>,
  hits: readonly string[],
  operation: 'replace' | 'add' | 'subtract',
): string[] {
  const result = new Set(operation === 'replace' ? [] : base)
  for (const atomId of hits) {
    if (operation === 'subtract') result.delete(atomId)
    else result.add(atomId)
  }
  return [...result]
}

export interface BoxSelectionSlice {
  boxSelectionOperation: 'replace' | 'add' | 'subtract'
  boxSelectionBaseAtomIds: Set<string>
  boxSelectModeEnabled: boolean
  isBoxSelecting: boolean
  boxStart: { x: number; y: number } | null
  boxEnd: { x: number; y: number } | null
  setBoxSelectModeEnabled: (enabled: boolean) => void
  startBoxSelection: (x: number, y: number, operation?: 'replace' | 'add' | 'subtract') => void
  updateBoxSelection: (x: number, y: number) => void
  endBoxSelection: () => void
}

export const createBoxSelectionSlice: StateCreator<CrystalStore, [], [], BoxSelectionSlice> = (set, get) => ({
  boxSelectionOperation: 'replace',
  boxSelectionBaseAtomIds: new Set<string>(),
  boxSelectModeEnabled: false,
  isBoxSelecting: false,
  boxStart: null,
  boxEnd: null,

  setBoxSelectModeEnabled: (enabled) => {
    if (enabled) {
      // Clear other selection state so edge/face/bond selection cannot conflict with box selection.
      set({
        boxSelectModeEnabled: true,
        selectMode: 'atom',
        selectedEdgeIds: new Set(),
        selectedFaceIds: new Set(),
        selectedBondIds: new Set(),
        hoveredEdgeId: null,
        hoveredFaceId: null,
        hoveredBondId: null,
        isBoxSelecting: false,
        boxStart: null,
        boxEnd: null,
        boxSelectionOperation: 'replace',
        boxSelectionBaseAtomIds: new Set<string>(),
      })
      return
    }
    set({
      boxSelectModeEnabled: false,
      isBoxSelecting: false,
      boxStart: null,
      boxEnd: null,
      boxSelectionOperation: 'replace',
      boxSelectionBaseAtomIds: new Set<string>(),
    })
  },

  startBoxSelection: (x, y, operation = 'replace') => {
    set({
      isBoxSelecting: true,
      boxStart: { x, y },
      boxEnd: { x, y },
      boxSelectionOperation: operation,
      boxSelectionBaseAtomIds: new Set(get().selectedAtomIds),
    })
  },

  updateBoxSelection: (x, y) => {
    if (get().isBoxSelecting) {
      set({ boxEnd: { x, y } })
    }
  },

  endBoxSelection: () => {
    // Keep the completed rectangle until the render-side selector has consumed it.
    // Clearing it in the same update as `isBoxSelecting` made quick drags race the
    // final render frame: the rectangle disappeared before its atom hits could be
    // committed. The next drag or leaving box-select mode clears/replaces it.
    set({ isBoxSelecting: false })
  },
})
