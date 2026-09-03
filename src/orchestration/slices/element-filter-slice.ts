/**
 * element-filter-slice — element filtering, text search, and selecting all matches.
 *
 * Extracted from crystalStore.ts. Two state fields and five actions, with no
 * cross-slice writes except selectFilteredAtoms updating selectedAtomIds.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore, ElementFilter } from '../crystal-store-types'

export interface ElementFilterSlice {
  elementFilter: ElementFilter
  searchQuery: string
  setElementFilter: (elements: string[]) => void
  toggleElementFilter: (element: string) => void
  clearElementFilter: () => void
  setSearchQuery: (query: string) => void
  selectFilteredAtoms: () => void
}

export const createElementFilterSlice: StateCreator<CrystalStore, [], [], ElementFilterSlice> = (set, get) => ({
  elementFilter: {
    elements: new Set<string>(),
    showFiltered: true,  // Dim filtered atoms by default
  },
  searchQuery: '',

  setElementFilter: (elements) => {
    set({ elementFilter: { elements: new Set(elements), showFiltered: true } })
  },

  toggleElementFilter: (element) => {
    const { elementFilter } = get()
    const newElements = new Set(elementFilter.elements)
    if (newElements.has(element)) {
      newElements.delete(element)
    } else {
      newElements.add(element)
    }
    set({ elementFilter: { ...elementFilter, elements: newElements } })
  },

  clearElementFilter: () => {
    set({ elementFilter: { elements: new Set(), showFiltered: true }, searchQuery: '' })
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },

  selectFilteredAtoms: () => {
    const { atoms, elementFilter, searchQuery } = get()
    const filteredAtomIds = atoms
      .filter(atom => {
        if (elementFilter.elements.size > 0 && !elementFilter.elements.has(atom.element)) {
          return false
        }
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          return atom.element.toLowerCase().includes(query) ||
                 atom.id.toLowerCase().includes(query)
        }
        return true
      })
      .map(a => a.id)
    set({ selectedAtomIds: new Set(filteredAtomIds) })
  },
})
