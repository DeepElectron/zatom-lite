/**
 * porosity-slice — void / cavity / specific-surface-area analysis state.
 *
 * Runs the pure-frontend analyzeVoid() over the current structure and holds the
 * result (mesh + stats) for the VoidSurfaceLayer overlay + the Porosity panel.
 * The probe-accessible iso-surface is coloured per-vertex by a colormap.
 */
import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import { analyzeVoid, type VoidAnalysisResult } from '../../lib/analysis/porosity/void-field'
import type { ColormapName } from '../../lib/viz/colormap'

export interface PorositySlice {
  voidResult: VoidAnalysisResult | null
  showVoidSurface: boolean
  probeRadius: number
  voidResolution: number
  voidColormap: ColormapName
  voidSurfaceOpacity: number

  setShowVoidSurface: (b: boolean) => void
  setProbeRadius: (v: number) => void
  setVoidResolution: (v: number) => void
  setVoidColormap: (c: ColormapName) => void
  setVoidSurfaceOpacity: (v: number) => void
  /** Compute void analysis on the current scene. Returns {ok} (synchronous). */
  computeVoidAnalysis: () => { ok: boolean; error?: string }
  clearVoidAnalysis: () => void
}

type Vec3 = [number, number, number]

export const createPorositySlice: StateCreator<CrystalStore, [], [], PorositySlice> = (set, get) => ({
  voidResult: null,
  showVoidSurface: false,
  probeRadius: 1.2,
  voidResolution: 40,
  voidColormap: 'viridis',
  voidSurfaceOpacity: 0.55,

  setShowVoidSurface: (b) => set({ showVoidSurface: b }),
  setProbeRadius: (v) => set({ probeRadius: Math.max(0.3, Math.min(4, v)) }),
  setVoidResolution: (v) => set({ voidResolution: Math.max(16, Math.min(96, Math.round(v))) }),
  setVoidColormap: (c) => set({ voidColormap: c }),
  setVoidSurfaceOpacity: (v) => set({ voidSurfaceOpacity: Math.max(0.1, Math.min(1, v)) }),

  computeVoidAnalysis: () => {
    const { atoms, latticeVectors, periodic, supercellParams, probeRadius, voidResolution } = get()
    if (!atoms || atoms.length === 0) return { ok: false, error: 'No atoms loaded' }

    const inAtoms = atoms.map((a) => ({
      element: a.element,
      cartesian: (a.cartesian ?? a.position) as Vec3,
    }))

    // effective periodic cell = unit-cell vectors scaled by the supercell counts
    // (the displayed atoms span nx·a × ny·b × nz·c), so min-image is correct.
    let lattice = null as { a: Vec3; b: Vec3; c: Vec3 } | null
    if (periodic && latticeVectors) {
      const nx = supercellParams?.nx ?? 1, ny = supercellParams?.ny ?? 1, nz = supercellParams?.nz ?? 1
      lattice = {
        a: latticeVectors.a.map((v) => v * nx) as Vec3,
        b: latticeVectors.b.map((v) => v * ny) as Vec3,
        c: latticeVectors.c.map((v) => v * nz) as Vec3,
      }
    }

    try {
      const result = analyzeVoid({
        atoms: inAtoms,
        latticeVectors: lattice,
        periodic: !!(periodic && lattice),
        probeRadius,
        resolution: voidResolution,
      })
      set({ voidResult: result, showVoidSurface: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  clearVoidAnalysis: () => set({ voidResult: null, showVoidSurface: false }),
})
