/**
 * viewport-controls-slice -- Four compact groups of viewport and physics controls that share
 * a global-toggle-plus-numeric-parameter pattern:
 *
 *   1) clipping plane: enabled / axis / offset
 *   2) bond physics: bondCutoff / bondStiffness
 *   3) simulation: isSimulationRunning / simulationSpeed
 *   4) live Batch-frame binding: ref / dirty plus bind/unbind/markDirty
 *
 * None accesses another slice. markBoundFrameDirty alone reads its own ref through get() so
 * an unbound state cannot become dirty.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'

export interface ViewportControlsSlice {
  clippingEnabled: boolean
  clippingAxis: 'x' | 'y' | 'z'
  clippingOffset: number
  // Arbitrary clip-plane normal (e.g. the constructed (hkl)/3-atom plane). When
  // null the axis-aligned clippingAxis is used; when set it overrides the axis.
  clippingNormal: [number, number, number] | null
  setClippingEnabled: (enabled: boolean) => void
  setClippingAxis: (axis: 'x' | 'y' | 'z') => void
  setClippingOffset: (offset: number) => void
  setClippingNormal: (normal: [number, number, number] | null) => void

  bondCutoff: number
  bondStiffness: number
  setBondCutoff: (cutoff: number) => void
  setBondStiffness: (stiffness: number) => void

  isSimulationRunning: boolean
  simulationSpeed: number
  toggleSimulation: () => void
  setSimulationSpeed: (speed: number) => void

  boundFrameRef: { workspaceId: string; batchId: string; frameId: string } | null
  boundFrameDirty: boolean
  bindToFrame: (workspaceId: string, batchId: string, frameId: string) => void
  unbindFrame: () => void
  markBoundFrameDirty: () => void
}

export const createViewportControlsSlice: StateCreator<CrystalStore, [], [], ViewportControlsSlice> = (set, get) => ({
  // Clipping plane
  clippingEnabled: false,
  clippingAxis: 'z',
  clippingOffset: 0,
  clippingNormal: null,
  setClippingEnabled: (enabled) => set({ clippingEnabled: enabled }),
  setClippingAxis: (axis) => set({ clippingAxis: axis, clippingNormal: null }),
  setClippingOffset: (offset) => set({ clippingOffset: offset }),
  setClippingNormal: (clippingNormal) => set({ clippingNormal }),

  // Bond parameters: detection cutoff and simulation spring stiffness
  bondCutoff: 2.0,
  bondStiffness: 100,
  setBondCutoff: (cutoff) => set({ bondCutoff: cutoff }),
  setBondStiffness: (stiffness) => set({ bondStiffness: stiffness }),

  // Physics simulation
  isSimulationRunning: false,
  simulationSpeed: 1.0,
  toggleSimulation: () => set((s) => ({ isSimulationRunning: !s.isSimulationRunning })),
  setSimulationSpeed: (speed) => set({ simulationSpeed: speed }),

  // Live Batch-frame binding
  boundFrameRef: null,
  boundFrameDirty: false,
  bindToFrame: (workspaceId, batchId, frameId) => set({ boundFrameRef: { workspaceId, batchId, frameId }, boundFrameDirty: false }),
  unbindFrame: () => set({ boundFrameRef: null, boundFrameDirty: false }),
  markBoundFrameDirty: () => { if (get().boundFrameRef) set({ boundFrameDirty: true }) },
})
