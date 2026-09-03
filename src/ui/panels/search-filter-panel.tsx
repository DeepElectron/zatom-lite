"use client"

import { useState, useMemo } from "react"
import { Search, X, Filter, Check } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getElement } from "../../lib/crystal/elements"

export function SearchFilterPanel() {
  const atoms = useCrystalStore((s) => s.atoms)
  const elementFilter = useCrystalStore((s) => s.elementFilter)
  const searchQuery = useCrystalStore((s) => s.searchQuery)
  const toggleElementFilter = useCrystalStore((s) => s.toggleElementFilter)
  const clearElementFilter = useCrystalStore((s) => s.clearElementFilter)
  const setSearchQuery = useCrystalStore((s) => s.setSearchQuery)
  const selectFilteredAtoms = useCrystalStore((s) => s.selectFilteredAtoms)
  
  const [showFilters, setShowFilters] = useState(false)
  
  // Get unique elements in the structure with counts
  const elementStats = useMemo(() => {
    const stats: Record<string, number> = {}
    atoms.forEach(atom => {
      stats[atom.element] = (stats[atom.element] || 0) + 1
    })
    return Object.entries(stats).sort((a, b) => b[1] - a[1])
  }, [atoms])
  
  // Count filtered atoms
  const filteredCount = useMemo(() => {
    return atoms.filter(atom => {
      if (elementFilter.elements.size > 0 && !elementFilter.elements.has(atom.element)) {
        return false
      }
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return atom.element.toLowerCase().includes(query) || 
               atom.id.toLowerCase().includes(query)
      }
      return true
    }).length
  }, [atoms, elementFilter, searchQuery])
  
  const hasActiveFilter = elementFilter.elements.size > 0 || searchQuery.length > 0

  return (
    <div className="space-y-3">
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search atoms..."
          className="zatom-field w-full rounded-xl py-2.5 pl-9 pr-9 text-sm placeholder:text-[var(--panel-text-tertiary)]"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          </button>
        )}
      </div>
      
      {/* Filter toggle */}
      <button
        onClick={() => {
          setShowFilters(!showFilters)
        }}
        data-selected={showFilters || hasActiveFilter}
        className="zatom-choice zatom-pressable flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>Filter by Element</span>
        {elementFilter.elements.size > 0 && (
          <span className="ml-auto rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--control-primary-bg)', color: 'var(--control-primary-text)' }}>
            {elementFilter.elements.size}
          </span>
        )}
      </button>
      
      {/* Element filter grid */}
      {showFilters && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">
              {elementStats.length} element{elementStats.length !== 1 ? 's' : ''} in structure
            </span>
            {elementFilter.elements.size > 0 && (
              <button
                onClick={() => {
                  clearElementFilter()
                }}
                className="status-red text-xs hover:opacity-80"
              >
                Clear all
              </button>
            )}
          </div>
          
          <div className="grid grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
            {elementStats.map(([element, count]) => {
              const isSelected = elementFilter.elements.has(element)
              const elementData = getElement(element)
              const color = elementData?.color || '#888888'
              
              return (
                <button
                  key={element}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    toggleElementFilter(element)
                  }}
                  data-selected={isSelected}
                  className="zatom-choice zatom-pressable flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: color }}
                  />
                  <span className="font-medium">
                    {element}
                  </span>
                  <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
                    {count}
                  </span>
                  {isSelected && (
                    <Check className="w-3 h-3" style={{ color: 'var(--control-selected-text)' }} />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
      
      {/* Results and actions */}
      {hasActiveFilter && (
        <div
          className="p-3 rounded-lg"
          style={{ background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--control-selected-text)]">
              {filteredCount} atom{filteredCount !== 1 ? 's' : ''} match
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">
              of {atoms.length} total
            </span>
          </div>
          
          <button
            onClick={() => {
              selectFilteredAtoms()
            }}
            className="zatom-primary zatom-pressable w-full rounded-lg py-2 text-xs font-medium"
          >
            Select All Matching Atoms
          </button>
        </div>
      )}
    </div>
  )
}
