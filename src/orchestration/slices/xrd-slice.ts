/**
 * xrd-slice —— Powder XRD pattern state + actions.
 *
 * Reads atoms / latticeVectors / periodic from sibling slices; XRD is only
 * meaningful for periodic structures since it integrates over reciprocal
 * lattice vectors. Calling computeXrd() on a non-periodic structure surfaces
 * a friendly error rather than computing garbage.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { Atom } from '../../lib/crystal/types'
import {
  AVAILABLE_RADIATION,
  WAVELENGTHS,
  computeXrdPattern,
  type RadiationKey,
  type XrdEntry,
  type XrdStructure,
} from '../../lib/analysis/xrd'

const PAIR_COLORS = [
  '#FF9F0A',
  '#0A84FF',
  '#30D158',
  '#BF5AF2',
  '#FF453A',
  '#5E5CE6',
  '#FFD60A',
  '#64D2FF',
  '#FF375F',
  '#A2845E',
]

function pickColor(index: number): string {
  return PAIR_COLORS[index % PAIR_COLORS.length]
}

function structureFromStore(
  atoms: Atom[],
  latticeVectors: CrystalStore['latticeVectors'],
  periodic: boolean,
): XrdStructure | null {
  if (!periodic) return null
  if (atoms.length === 0) return null
  // For periodic structures `position` already holds fractional coordinates.
  // `cartesian` may also exist; we don't need it for XRD.
  const sites = atoms
    .map((atom) => {
      if (!atom.position) return null
      return {
        element: atom.element,
        frac: atom.position as [number, number, number],
      }
    })
    .filter((s): s is { element: string; frac: [number, number, number] } => s !== null)
  if (sites.length === 0) return null
  return {
    sites,
    lattice: [latticeVectors.a, latticeVectors.b, latticeVectors.c],
  }
}

export interface XrdSlice {
  xrdEntries: XrdEntry[]
  xrdStatus: 'idle' | 'computing' | 'error'
  xrdError: string | null
  xrdRadiation: RadiationKey | 'custom'
  xrdCustomWavelength: number
  xrdTwoThetaMin: number
  xrdTwoThetaMax: number
  setXrdRadiation: (radiation: RadiationKey | 'custom') => void
  setXrdCustomWavelength: (wl: number) => void
  setXrdTwoThetaRange: (min: number, max: number) => void
  computeXrd: () => void
  removeXrdEntry: (id: string) => void
  clearXrdEntries: () => void
}

export const createXrdSlice: StateCreator<CrystalStore, [], [], XrdSlice> = (set, get) => ({
  xrdEntries: [],
  xrdStatus: 'idle',
  xrdError: null,
  xrdRadiation: 'CuKa',
  xrdCustomWavelength: 1.54184,
  xrdTwoThetaMin: 5,
  xrdTwoThetaMax: 90,

  setXrdRadiation: (radiation) => set({ xrdRadiation: radiation }),
  setXrdCustomWavelength: (wl) => set({ xrdCustomWavelength: Math.max(0.05, wl) }),
  setXrdTwoThetaRange: (min, max) => {
    const clampedMin = Math.max(0, Math.min(min, max - 1))
    const clampedMax = Math.min(180, Math.max(max, clampedMin + 1))
    set({ xrdTwoThetaMin: clampedMin, xrdTwoThetaMax: clampedMax })
  },

  computeXrd: () => {
    const state = get()
    const structure = structureFromStore(state.atoms, state.latticeVectors, state.periodic)
    if (!structure) {
      set({
        xrdStatus: 'error',
        xrdError: state.periodic
          ? 'Need at least one atom in a unit cell'
          : 'XRD requires a periodic structure (toggle Boundary → Periodic)',
      })
      return
    }
    set({ xrdStatus: 'computing', xrdError: null })
    try {
      const wavelength = state.xrdRadiation === 'custom'
        ? state.xrdCustomWavelength
        : WAVELENGTHS[state.xrdRadiation]
      const pattern = computeXrdPattern(structure, {
        wavelength,
        two_theta_range: [state.xrdTwoThetaMin, state.xrdTwoThetaMax],
        scaled: true,
      })
      const entries = state.xrdEntries
      const radiationLabel = state.xrdRadiation === 'custom'
        ? `${wavelength.toFixed(3)} Å`
        : state.xrdRadiation
      const entry: XrdEntry = {
        id: `xrd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `${radiationLabel} · ${state.xrdTwoThetaMin}–${state.xrdTwoThetaMax}°`,
        pattern,
        color: pickColor(entries.length),
        wavelength,
        radiation: state.xrdRadiation,
      }
      set({ xrdEntries: [...entries, entry], xrdStatus: 'idle', xrdError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'XRD calculation failed'
      set({ xrdStatus: 'error', xrdError: message })
    }
  },

  removeXrdEntry: (id) => set({ xrdEntries: get().xrdEntries.filter((e) => e.id !== id) }),
  clearXrdEntries: () => set({ xrdEntries: [], xrdStatus: 'idle', xrdError: null }),
})

export { AVAILABLE_RADIATION }
