/**
 * ediff-slice —— Kinematic electron-diffraction RADIAL profile state + actions.
 *
 * Mirrors xrd-slice: reads atoms / latticeVectors / periodic from sibling slices
 * and computes a powder-like kinematic radial profile I(|g|) (see
 * lib/analysis/ediff/calc-ediff.ts — uses the X-ray atomic form factor as an
 * electron-diffraction proxy; peak positions exact, intensities a proxy). This is
 * NOT a zone-axis SAED spot pattern — only a radial average, meaningful for
 * periodic structures.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { Atom } from '../../lib/crystal/types'
import type { XrdStructure } from '../../lib/analysis/xrd'
import { computeEdiffRadial, type EdiffPattern } from '../../lib/analysis/ediff/calc-ediff'

const PAIR_COLORS = [
  '#64D2FF',
  '#30D158',
  '#FF9F0A',
  '#BF5AF2',
  '#FF453A',
  '#5E5CE6',
  '#FFD60A',
  '#0A84FF',
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

export interface EdiffEntry {
  id: string
  label: string
  pattern: EdiffPattern
  color: string
  voltageKV: number
}

export interface EdiffSlice {
  ediffEntries: EdiffEntry[]
  ediffStatus: 'idle' | 'computing' | 'error'
  ediffError: string | null
  ediffVoltageKV: number
  ediffGMax: number
  setEdiffVoltage: (kv: number) => void
  setEdiffGMax: (gMax: number) => void
  computeEdiff: () => void
  removeEdiffEntry: (id: string) => void
  clearEdiffEntries: () => void
}

export const createEdiffSlice: StateCreator<CrystalStore, [], [], EdiffSlice> = (set, get) => ({
  ediffEntries: [],
  ediffStatus: 'idle',
  ediffError: null,
  ediffVoltageKV: 200,
  ediffGMax: 12,

  setEdiffVoltage: (kv) => set({ ediffVoltageKV: Math.max(20, Math.min(400, kv)) }),
  setEdiffGMax: (gMax) => set({ ediffGMax: Math.max(2, Math.min(30, gMax)) }),

  computeEdiff: () => {
    const state = get()
    const structure = structureFromStore(state.atoms, state.latticeVectors, state.periodic)
    if (!structure) {
      set({
        ediffStatus: 'error',
        ediffError: state.periodic
          ? 'Need at least one atom in a unit cell'
          : 'Electron diffraction requires a periodic structure (toggle Boundary → Periodic)',
      })
      return
    }
    set({ ediffStatus: 'computing', ediffError: null })
    try {
      const pattern = computeEdiffRadial(structure, {
        gMax: state.ediffGMax,
        voltage_kV: state.ediffVoltageKV,
      })
      const entries = state.ediffEntries
      const entry: EdiffEntry = {
        id: `ediff-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: `${state.ediffVoltageKV} kV · |g|≤${state.ediffGMax} Å⁻¹`,
        pattern,
        color: pickColor(entries.length),
        voltageKV: state.ediffVoltageKV,
      }
      set({ ediffEntries: [...entries, entry], ediffStatus: 'idle', ediffError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Electron diffraction failed'
      set({ ediffStatus: 'error', ediffError: message })
    }
  },

  removeEdiffEntry: (id) => set({ ediffEntries: get().ediffEntries.filter((e) => e.id !== id) }),
  clearEdiffEntries: () => set({ ediffEntries: [], ediffStatus: 'idle', ediffError: null }),
})
