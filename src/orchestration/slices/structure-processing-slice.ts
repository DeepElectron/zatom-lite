/**
 * structure-processing-slice -- Progress-overlay state for parsing large files and supercells.
 *
 * One state field and three actions:
 *   - begin: enter processing state and show the overlay immediately
 *   - update: update step, progress, and detail without changing active
 *   - end: reset to idle so active=false hides the overlay
 *
 * Used with nextStructureProcessingPaint() from lib/structure-processing/helpers, which
 * forces a browser frame so React batching does not skip intermediate progress.
 */

import type { StateCreator } from 'zustand'
import { idleStructureProcessingState, type StructureProcessingState } from '../../lib/structure-processing/helpers'
import type { CrystalStore } from '../crystal-store-types'

export interface StructureProcessingSlice {
  structureProcessing: StructureProcessingState
  beginStructureProcessing: (title: string, step: string, progress?: number, detail?: string | null) => void
  updateStructureProcessing: (step: string, progress: number, detail?: string | null) => void
  endStructureProcessing: () => void
}

export const createStructureProcessingSlice: StateCreator<CrystalStore, [], [], StructureProcessingSlice> = (set) => ({
  structureProcessing: idleStructureProcessingState,

  beginStructureProcessing: (title, step, progress = 0, detail = null) =>
    set({
      structureProcessing: {
        active: true,
        title,
        step,
        progress,
        detail,
      },
    }),

  updateStructureProcessing: (step, progress, detail = null) =>
    set((state) => ({
      structureProcessing: {
        ...state.structureProcessing,
        active: true,
        step,
        progress,
        detail,
      },
    })),

  endStructureProcessing: () => set({ structureProcessing: idleStructureProcessingState }),
})
