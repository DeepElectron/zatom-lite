import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { PathTracingBlocker } from '../../lib/render/path-tracing'

/**
 * Path-tracing preference and runtime state.
 *
 * This remains separate from visual-style-slice: visual styles are preset-controlled
 * appearance settings in undo history, while this is renderer runtime state such as sample
 * count and scene support. Keeping them separate prevents preset/reset writes from
 * overwriting renderer state.
 */
export interface PathTracingSlice {
  /** User preference; active tracing also requires studio style and scene support. */
  pathTracing: boolean
  setPathTracing: (enabled: boolean) => void
  /** Renderer-reported reason this scene cannot be traced; null means supported. UI read-only. */
  pathTracingBlocker: PathTracingBlocker | null
  /**
   * Renderer-reported count of **completed** full-screen samples, as an integer. UI read-only.
   *
   * The library's `tracer.samples` is fractional because each frame is split into tiles
   * (3x3 by default) and increments by 1/9 per tile. Rounding before storage reports the
   * current full-screen pass and reduces subscriber renders from once per tile to once per pass.
   */
  pathTracingSamples: number
  reportPathTracingStatus: (status: { blocker?: PathTracingBlocker | null; samples?: number }) => void
}

export const createPathTracingSlice: StateCreator<CrystalStore, [], [], PathTracingSlice> = (set, get) => ({
  pathTracing: false,
  // Clear runtime state when disabled so stale sample counts do not flash on the next enable.
  setPathTracing: (pathTracing) =>
    set(pathTracing ? { pathTracing } : { pathTracing, pathTracingSamples: 0, pathTracingBlocker: null }),

  pathTracingBlocker: null,
  pathTracingSamples: 0,
  reportPathTracingStatus: ({ blocker, samples }) => {
    const current = get()
    const nextBlocker = blocker === undefined ? current.pathTracingBlocker : blocker
    // The library increments fractional samples per tile; see pathTracingSamples above.
    // Use ceil so a slow first pass immediately reports progress instead of appearing stuck at 0,
    // while retaining integer values and at most one store write per pass.
    const nextSamples = samples === undefined ? current.pathTracingSamples : Math.ceil(samples)
    // Skip unchanged values because the render loop calls this every frame; unconditional writes
    // would needlessly rerender subscribers at frame rate.
    if (nextBlocker === current.pathTracingBlocker && nextSamples === current.pathTracingSamples) return
    set({ pathTracingBlocker: nextBlocker, pathTracingSamples: nextSamples })
  },
})
