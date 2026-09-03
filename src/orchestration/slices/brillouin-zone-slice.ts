/**
 * Brillouin-zone display state shared by the inspector preview and main viewport.
 * Keeping one canonical state prevents controls from appearing to work in only
 * one of the two renderers.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'

export interface BrillouinZoneSlice {
  showBZOverlay: boolean
  bzShowZone: boolean
  bzShowKPath: boolean
  bzShowKPoints: boolean
  bzShowReciprocal: boolean
  bzOpacity: number
  focusedKPoint: string | null
  setShowBZOverlay: (show: boolean) => void
  setBZShowZone: (show: boolean) => void
  setBZShowKPath: (show: boolean) => void
  setBZShowKPoints: (show: boolean) => void
  setBZShowReciprocal: (show: boolean) => void
  setBZOpacity: (opacity: number) => void
  setFocusedKPoint: (kpoint: string | null) => void
}

export const createBrillouinZoneSlice: StateCreator<CrystalStore, [], [], BrillouinZoneSlice> = (set) => ({
  showBZOverlay: false,
  bzShowZone: true,
  bzShowKPath: true,
  bzShowKPoints: true,
  bzShowReciprocal: false,
  bzOpacity: 0.15,
  focusedKPoint: null,

  setShowBZOverlay: (show) => set((state) => ({
    showBZOverlay: show,
    focusedKPoint: show ? state.focusedKPoint : null,
  })),
  setBZShowZone: (show) => set({ bzShowZone: show }),
  setBZShowKPath: (show) => set({ bzShowKPath: show }),
  setBZShowKPoints: (show) => set((state) => ({
    bzShowKPoints: show,
    focusedKPoint: show ? state.focusedKPoint : null,
  })),
  setBZShowReciprocal: (show) => set({ bzShowReciprocal: show }),
  setBZOpacity: (opacity) => set({ bzOpacity: Math.max(0.05, Math.min(0.5, opacity)) }),
  setFocusedKPoint: (kpoint) => set({ focusedKPoint: kpoint }),
})
