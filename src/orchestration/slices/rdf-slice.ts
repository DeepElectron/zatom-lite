/**
 * rdf-slice -- State and actions for radial-distribution-function analysis.
 *
 * Derives an RdfStructure from the current atoms and latticeVectors, then calls
 * `lib/analysis/rdf/calc-rdf` to compute g(r) for selected element pairs or all pairs.
 * Results are stored in entries and plotted by the UI with recharts.
 *
 * Like trajectory-slice, it reads atoms, latticeVectors, and periodic across slices.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { Atom } from '../../lib/crystal/types'
import {
  calculateAllPairRdfs,
  calculateRdf,
  type RdfEntry,
  type RdfPattern,
  type RdfStructure,
} from '../../lib/analysis/rdf'

const PAIR_COLORS = [
  '#0A84FF',
  '#FF9F0A',
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

function entryLabel(pattern: RdfPattern, fallback: string): string {
  if (!pattern.element_pair) return fallback
  const [a, b] = pattern.element_pair
  return a === b ? `${a}–${a}` : `${a}–${b}`
}

function uniqueElements(atoms: Atom[]): string[] {
  return [...new Set(atoms.map((atom) => atom.element))].sort()
}

function structureFromStore(atoms: Atom[], latticeVectors: CrystalStore['latticeVectors']): RdfStructure | null {
  if (atoms.length < 2) return null
  const sites = atoms
    .map((atom) => {
      const xyz = atom.cartesian ?? atom.position
      return xyz ? { element: atom.element, cartesian: xyz as [number, number, number] } : null
    })
    .filter((s): s is { element: string; cartesian: [number, number, number] } => s !== null)
  if (sites.length < 2) return null
  return { sites, latticeVectors }
}

export interface RdfSlice {
  rdfEntries: RdfEntry[]
  rdfStatus: 'idle' | 'computing' | 'error'
  rdfError: string | null
  rdfCutoff: number
  rdfNBins: number
  /** When false, fall back to box (non-periodic) distances even if the cell is periodic. */
  rdfUsePbc: boolean
  rdfCenterSpecies: string | 'all'
  rdfNeighborSpecies: string | 'all'
  setRdfCutoff: (cutoff: number) => void
  setRdfNBins: (n: number) => void
  setRdfUsePbc: (use: boolean) => void
  setRdfCenterSpecies: (el: string | 'all') => void
  setRdfNeighborSpecies: (el: string | 'all') => void
  /** Compute a single g(r) for the current center/neighbor species selection and append it. */
  computeRdf: () => void
  /** Compute g(r) for every element pair and replace `rdfEntries`. */
  computeAllPairs: () => void
  removeRdfEntry: (id: string) => void
  clearRdfEntries: () => void
}

export const createRdfSlice: StateCreator<CrystalStore, [], [], RdfSlice> = (set, get) => ({
  rdfEntries: [],
  rdfStatus: 'idle',
  rdfError: null,
  rdfCutoff: 10,
  rdfNBins: 100,
  rdfUsePbc: true,
  rdfCenterSpecies: 'all',
  rdfNeighborSpecies: 'all',

  setRdfCutoff: (cutoff) => set({ rdfCutoff: Math.max(0.1, cutoff) }),
  setRdfNBins: (n) => set({ rdfNBins: Math.max(2, Math.floor(n)) }),
  setRdfUsePbc: (use) => set({ rdfUsePbc: use }),
  setRdfCenterSpecies: (el) => set({ rdfCenterSpecies: el }),
  setRdfNeighborSpecies: (el) => set({ rdfNeighborSpecies: el }),

  computeRdf: () => {
    const state = get()
    const structure = structureFromStore(state.atoms, state.latticeVectors)
    if (!structure) {
      set({ rdfStatus: 'error', rdfError: 'Need at least two atoms with coordinates' })
      return
    }
    set({ rdfStatus: 'computing', rdfError: null })
    try {
      const elements = uniqueElements(state.atoms)
      const center = state.rdfCenterSpecies !== 'all' && elements.includes(state.rdfCenterSpecies)
        ? state.rdfCenterSpecies
        : undefined
      const neighbor = state.rdfNeighborSpecies !== 'all' && elements.includes(state.rdfNeighborSpecies)
        ? state.rdfNeighborSpecies
        : undefined
      const usePbc = state.rdfUsePbc && state.periodic
      const pattern = calculateRdf(structure, {
        cutoff: state.rdfCutoff,
        n_bins: state.rdfNBins,
        center_species: center,
        neighbor_species: neighbor,
        pbc: usePbc ? [true, true, true] : [false, false, false],
        auto_expand: usePbc,
      })
      const fallback = center && neighbor ? `${center}–${neighbor}` : 'all'
      const id = `rdf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const entries = state.rdfEntries
      const entry: RdfEntry = {
        id,
        label: entryLabel(pattern, fallback),
        pattern,
        color: pickColor(entries.length),
      }
      set({ rdfEntries: [...entries, entry], rdfStatus: 'idle', rdfError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'RDF calculation failed'
      set({ rdfStatus: 'error', rdfError: message })
    }
  },

  computeAllPairs: () => {
    const state = get()
    const structure = structureFromStore(state.atoms, state.latticeVectors)
    if (!structure) {
      set({ rdfStatus: 'error', rdfError: 'Need at least two atoms with coordinates' })
      return
    }
    set({ rdfStatus: 'computing', rdfError: null })
    try {
      const usePbc = state.rdfUsePbc && state.periodic
      const patterns = calculateAllPairRdfs(structure, {
        cutoff: state.rdfCutoff,
        n_bins: state.rdfNBins,
        pbc: usePbc ? [true, true, true] : [false, false, false],
        auto_expand: usePbc,
      })
      const entries: RdfEntry[] = patterns.map((pattern, idx) => ({
        id: `rdf-pair-${Date.now()}-${idx}`,
        label: entryLabel(pattern, `pair-${idx}`),
        pattern,
        color: pickColor(idx),
      }))
      set({ rdfEntries: entries, rdfStatus: 'idle', rdfError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'RDF calculation failed'
      set({ rdfStatus: 'error', rdfError: message })
    }
  },

  removeRdfEntry: (id) => set({ rdfEntries: get().rdfEntries.filter((e) => e.id !== id) }),
  clearRdfEntries: () => set({ rdfEntries: [], rdfStatus: 'idle', rdfError: null }),
})
