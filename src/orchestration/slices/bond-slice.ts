/**
 * bond-slice — bond auto-detection settings (global default radius and element-pair
 * overrides), plus the pending atom and createBondBetweenAtoms for manual bonding.
 *
 * Each of the three radius setters schedules autoDetectBonds with setTimeout(0) to
 * avoid invoking it synchronously inside a setState callback.
 */

import type { StateCreator } from 'zustand'
import type { Bond } from '../../lib/crystal/types'
import { DEFAULT_BOND_TOLERANCE } from '../../lib/crystal/bonds'
import { recomputeBonds } from '../recompute-bonds'
import type { BondSettings, CrystalStore } from '../crystal-store-types'

export interface BondSlice {
  bondSettings: BondSettings
  pendingBondAtomId: string | null
  setBondDefaultRadius: (radius: number) => void
  setElementPairRadius: (element1: string, element2: string, radius: number) => void
  removeElementPairRadius: (element1: string, element2: string) => void
  setRestrictToConfiguredPairs: (restrict: boolean) => void
  /** Extra tolerance (A) beyond the sum of covalent radii; the criterion's only empirical parameter. */
  setBondTolerance: (tolerance: number) => void
  /** Whether to find bonds across cell boundaries; applies only to periodic systems. */
  setPeriodicBonds: (enabled: boolean) => void
  setPendingBondAtom: (atomId: string | null) => void
  createBondBetweenAtoms: (atom1Id: string, atom2Id: string) => void
  /**
   * Single route for Bond-tool clicks. Dispatches by bondToolSubmode to create a real
   * bond, add a link annotation, or do nothing for display-only contacts. Returns the
   * outcome for UI status. All rendering paths route clicks through this method.
   */
  handleBondToolClick: (atomId: string) => 'pending' | 'cancelled' | 'linked' | 'bonded' | 'noop'
}

export const createBondSlice: StateCreator<CrystalStore, [], [], BondSlice> = (set, get) => ({
  bondSettings: {
    defaultRadius: 3.0,
    elementPairRadii: {},
    restrictToConfiguredPairs: false,
    tolerance: DEFAULT_BOND_TOLERANCE,
    periodicBonds: true,
  },
  pendingBondAtomId: null,

  setBondTolerance: (tolerance) => {
    if (!Number.isFinite(tolerance) || tolerance < 0) return
    const state = get()
    if (state.bondSettings.tolerance === tolerance) return
    if (state.atoms.length > 0) state.pushHistory()
    const bondSettings = { ...state.bondSettings, tolerance }
    set({ bondSettings, bonds: recomputeBonds(state, { bondSettings }) })
  },

  setPeriodicBonds: (enabled) => {
    const state = get()
    if (state.bondSettings.periodicBonds === enabled) return
    if (state.atoms.length > 0) state.pushHistory()
    const bondSettings = { ...state.bondSettings, periodicBonds: enabled }
    set({ bondSettings, bonds: recomputeBonds(state, { bondSettings }) })
  },

  setBondDefaultRadius: (radius) => {
    if (!Number.isFinite(radius) || radius <= 0) return
    const state = get()
    if (state.bondSettings.defaultRadius === radius) return
    if (state.atoms.length > 0) state.pushHistory()
    const bondSettings = { ...state.bondSettings, defaultRadius: radius }
    set({
      bondSettings,
      bonds: recomputeBonds(state, { bondSettings }),
    })
  },

  setElementPairRadius: (element1, element2, radius) => {
    if (!Number.isFinite(radius) || radius <= 0) return
    const key = [element1, element2].sort().join('-')
    const state = get()
    if (state.bondSettings.elementPairRadii[key] === radius) return
    if (state.atoms.length > 0) state.pushHistory()
    const bondSettings = {
      ...state.bondSettings,
      elementPairRadii: { ...state.bondSettings.elementPairRadii, [key]: radius },
    }
    set({
      bondSettings,
      bonds: recomputeBonds(state, { bondSettings }),
    })
  },

  removeElementPairRadius: (element1, element2) => {
    const key = [element1, element2].sort().join('-')
    const state = get()
    if (!(key in state.bondSettings.elementPairRadii)) return
    if (state.atoms.length > 0) state.pushHistory()
    const elementPairRadii = { ...state.bondSettings.elementPairRadii }
    delete elementPairRadii[key]
    const bondSettings = {
      ...state.bondSettings,
      elementPairRadii,
      restrictToConfiguredPairs: Object.keys(elementPairRadii).length > 0
        ? state.bondSettings.restrictToConfiguredPairs
        : false,
    }
    set({
      bondSettings,
      bonds: recomputeBonds(state, { bondSettings }),
    })
  },

  setRestrictToConfiguredPairs: (restrict) => {
    const state = get()
    if (state.bondSettings.restrictToConfiguredPairs === restrict) return
    if (state.atoms.length > 0) state.pushHistory()
    const bondSettings = { ...state.bondSettings, restrictToConfiguredPairs: restrict }
    set({
      bondSettings,
      bonds: recomputeBonds(state, { bondSettings }),
    })
  },

  setPendingBondAtom: (atomId) => {
    set({ pendingBondAtomId: atomId })
  },

  createBondBetweenAtoms: (atom1Id, atom2Id) => {
    const { bonds } = get()
    const exists = bonds.some(b =>
      (b.atom1Id === atom1Id && b.atom2Id === atom2Id) ||
      (b.atom1Id === atom2Id && b.atom2Id === atom1Id)
    )
    if (exists) {
      set({ pendingBondAtomId: null })
      return
    }

    get().pushHistory()
    get().clearBiomolecule()
    const newBond: Bond = {
      id: `bond-${Date.now()}`,
      atom1Id,
      atom2Id,
      type: 'single',
    }
    set({ bonds: [...bonds, newBond], pendingBondAtomId: null })
  },

  handleBondToolClick: (atomId) => {
    const state = get()
    const submode = state.bondToolSubmode
    if (submode === 'contacts') return 'noop'
    if (!state.pendingBondAtomId) {
      set({ pendingBondAtomId: atomId })
      return 'pending'
    }
    if (state.pendingBondAtomId === atomId) {
      set({ pendingBondAtomId: null })
      return 'cancelled'
    }
    if (submode === 'link') {
      state.addBondAnnotation(state.pendingBondAtomId, atomId)
      set({ pendingBondAtomId: null })
      return 'linked'
    }
    state.createBondBetweenAtoms(state.pendingBondAtomId, atomId)
    return 'bonded'
  },
})
