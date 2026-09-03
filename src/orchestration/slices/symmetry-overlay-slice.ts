/**
 * symmetry-overlay-slice -- Latest backend result shared by the Find, Wyckoff, Primitive,
 * and Show symmetry sections, plus viewport-overlay visibility.
 *
 * Design:
 *   - symmetryAnalysis: all four sections write one result subscribed to by the HUD and 3D overlay
 *   - showSymmetryHUD: enabled after Find Symmetry and user-toggleable
 *   - showPrimitiveCell: enabled after Primitive Cell, adding a cyan viewport wireframe
 *   - showSymmetryElements: enabled after Show Symmetry, drawing Cn, σ, and i
 *   - symmetryElementFilter: null draws all; a Set draws only named types for chip interaction
 *
 * There are no cross-slice writes. setSymmetryAnalysis also resets the filter for every section.
 */

import type { StateCreator } from 'zustand'
import type { StructureSymmetryResponse } from '../../contracts/structures'
import type { CrystalStore } from '../crystal-store-types'

export interface SymmetryOverlaySlice {
  symmetryAnalysis: StructureSymmetryResponse | null
  showSymmetryHUD: boolean
  showPrimitiveCell: boolean
  showSymmetryElements: boolean
  symmetryElementFilter: Set<string> | null

  setSymmetryAnalysis: (r: StructureSymmetryResponse | null) => void
  setShowSymmetryHUD: (v: boolean) => void
  setShowPrimitiveCell: (v: boolean) => void
  setShowSymmetryElements: (v: boolean) => void
  setSymmetryElementFilter: (f: Set<string> | null) => void
}

export const createSymmetryOverlaySlice: StateCreator<CrystalStore, [], [], SymmetryOverlaySlice> = (set) => ({
  symmetryAnalysis: null,
  showSymmetryHUD: false,
  showPrimitiveCell: false,
  showSymmetryElements: false,
  symmetryElementFilter: null,

  setSymmetryAnalysis: (r) => set({ symmetryAnalysis: r, symmetryElementFilter: null }),
  setShowSymmetryHUD: (v) => set({ showSymmetryHUD: v }),
  setShowPrimitiveCell: (v) => set({ showPrimitiveCell: v }),
  setShowSymmetryElements: (v) => set({ showSymmetryElements: v }),
  setSymmetryElementFilter: (f) => set({ symmetryElementFilter: f }),
})
