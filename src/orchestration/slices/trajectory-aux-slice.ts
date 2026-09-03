/**
 * trajectory-aux-slice — display selection for extended-XYZ per-atom auxiliary
 * properties (forces, charge, magmom, …) over a loaded trajectory.
 *
 * Kept separate from trajectory-slice (which owns playback) so playback stays
 * focused. The renderers read the ACTIVE frame's `XYZAtom.props` (indexed by
 * array position, since parser ids ≠ store ids) and use this slice to decide
 * which column becomes per-atom arrows (vectors) vs atom colour (scalars).
 *
 * All overlays default OFF (matches the project convention that every overlay
 * starts disabled, e.g. atom-attributes-slice MOF/OVITO PTM coloring).
 */
import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { ColormapName } from '../../lib/viz/colormap'

export interface TrajectoryAuxSlice {
  /** extended-XYZ vector column drawn as per-atom arrows ('forces' | 'displacement'
   *  | 'magmom' | <custom>); null = no arrows. */
  trajectoryVectorProp: string | null
  /** arrow length scale: Å drawn per unit of the vector value. */
  trajectoryVectorScale: number
  /** extended-XYZ scalar column that colours the atoms ('charge' | 'fmag' |
   *  <custom>); null = default element colour. */
  trajectoryColorProp: string | null
  trajectoryColormap: ColormapName
  /** pinned [min,max] for a colour scale that is stable across frames; null =
   *  auto-range over the active frame. */
  trajectoryColorRange: [number, number] | null

  setTrajectoryVectorProp: (p: string | null) => void
  setTrajectoryVectorScale: (s: number) => void
  setTrajectoryColorProp: (p: string | null) => void
  setTrajectoryColormap: (c: ColormapName) => void
  setTrajectoryColorRange: (r: [number, number] | null) => void
}

export const createTrajectoryAuxSlice: StateCreator<CrystalStore, [], [], TrajectoryAuxSlice> = (set) => ({
  trajectoryVectorProp: null,
  trajectoryVectorScale: 1,
  trajectoryColorProp: null,
  trajectoryColormap: 'coolwarm',
  trajectoryColorRange: null,

  setTrajectoryVectorProp: (p) => set({ trajectoryVectorProp: p }),
  setTrajectoryVectorScale: (s) => set({ trajectoryVectorScale: Math.max(0, s) }),
  setTrajectoryColorProp: (p) => set({ trajectoryColorProp: p }),
  setTrajectoryColormap: (c) => set({ trajectoryColormap: c }),
  setTrajectoryColorRange: (r) => set({ trajectoryColorRange: r }),
})
