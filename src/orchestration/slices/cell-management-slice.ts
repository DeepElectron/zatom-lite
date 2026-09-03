/**
 * cell-management-slice — two-level cell unlocking in solid-box rendering, plus supercell mode.
 *
 * Large scenes default to solid-box rendering (one draw call for solid boxes). After
 * the user selects a face, lockSelectedFaceCells upgrades the corresponding cells:
 *   1) First selection: solid-box → fast (instanced rendering)
 *   2) Second selection: fast → detail (full ball-and-stick)
 *   3) Already detailed: keep
 *
 * Face IDs use `face-{ab|bc|ac}-{i}-{j}-{k}`. Based on the face orientation,
 * add the cell keys (`{i}-{j}-{k}`) on both sides, or only one at a boundary.
 *
 * supercellMode: 'normal' adds unit cells while preserving user edits; 'fork'
 * doubles the entire supercell (1→2→4→8) without preserving user edits.
 *
 * Cross-slice: lockSelectedFaceCells reads selectedFaceIds (selection-slice) and
 * supercellParams.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'

export interface CellManagementSlice {
  fastCellIndices: Set<string>
  detailCellIndices: Set<string>
  supercellMode: 'normal' | 'fork'

  setSupercellMode: (mode: 'normal' | 'fork') => void
  addDetailCells: (cellIndices: string[]) => void
  removeDetailCells: (cellIndices: string[]) => void
  clearDetailCells: () => void
  lockSelectedFaceCells: () => void
}

export const createCellManagementSlice: StateCreator<CrystalStore, [], [], CellManagementSlice> = (set, get) => ({
  fastCellIndices: new Set<string>(),
  detailCellIndices: new Set<string>(),
  supercellMode: 'normal',

  setSupercellMode: (mode) => set({ supercellMode: mode }),

  addDetailCells: (cellIndices) => {
    const { detailCellIndices } = get()
    const newSet = new Set(detailCellIndices)
    cellIndices.forEach(idx => newSet.add(idx))
    set({ detailCellIndices: newSet })
  },

  removeDetailCells: (cellIndices) => {
    const { detailCellIndices } = get()
    const newSet = new Set(detailCellIndices)
    cellIndices.forEach(idx => newSet.delete(idx))
    set({ detailCellIndices: newSet })
  },

  clearDetailCells: () => {
    set({ fastCellIndices: new Set<string>(), detailCellIndices: new Set<string>() })
  },

  lockSelectedFaceCells: () => {
    const { selectedFaceIds, fastCellIndices, detailCellIndices, supercellParams } = get()
    const { nx, ny, nz } = supercellParams

    // Collect unique cell indices from selected faces
    const selectedCellKeys = new Set<string>()
    selectedFaceIds.forEach(faceId => {
      const match = faceId.match(/face-(ab|bc|ac)-(\d+)-(\d+)-(\d+)/)
      if (match) {
        const plane = match[1]
        const i = parseInt(match[2])
        const j = parseInt(match[3])
        const k = parseInt(match[4])

        // Add cells adjacent to the face; at an axis boundary, add only one side.
        if (plane === 'ab') {
          // AB face at k, add cell below (k-1) if exists, or at k if k=0
          if (k > 0 && k <= nz) selectedCellKeys.add(`${i}-${j}-${k - 1}`)
          if (k < nz) selectedCellKeys.add(`${i}-${j}-${k}`)
        } else if (plane === 'bc') {
          // BC face at i, add cell to the left (i-1) if exists
          if (i > 0 && i <= nx) selectedCellKeys.add(`${i - 1}-${j}-${k}`)
          if (i < nx) selectedCellKeys.add(`${i}-${j}-${k}`)
        } else if (plane === 'ac') {
          // AC face at j, add cell behind (j-1) if exists
          if (j > 0 && j <= ny) selectedCellKeys.add(`${i}-${j - 1}-${k}`)
          if (j < ny) selectedCellKeys.add(`${i}-${j}-${k}`)
        }
      }
    })

    // Two-level locking system
    const newFastSet = new Set(fastCellIndices)
    const newDetailSet = new Set(detailCellIndices)

    for (const cellKey of selectedCellKeys) {
      if (detailCellIndices.has(cellKey)) {
        continue
      } else if (fastCellIndices.has(cellKey)) {
        // Already fast: upgrade to detail.
        newFastSet.delete(cellKey)
        newDetailSet.add(cellKey)
      } else {
        // Not yet unlocked: add to fast.
        newFastSet.add(cellKey)
      }
    }

    set({ fastCellIndices: newFastSet, detailCellIndices: newDetailSet })
  },
})
