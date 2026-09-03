"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { ELEMENTS, COMMON_ELEMENTS, getElement } from "../../lib/crystal/elements"
import { labelColorOn } from "./components/plane-canvas-theme"

export function ElementSelector() {
  const toolMode = useCrystalStore((s) => s.toolMode)
  const selectedElement = useCrystalStore((s) => s.selectedElement)
  const setSelectedElement = useCrystalStore((s) => s.setSelectedElement)
  const [showFullTable, setShowFullTable] = useState(false)
  
  // Only show when in add-atom mode
  if (toolMode !== 'add-atom') return null
  
  const currentElement = getElement(selectedElement)
  const allElements = Object.values(ELEMENTS).sort((a, b) => a.atomicNumber - b.atomicNumber)
  
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40">
      <div
        className="min-w-[320px] rounded-xl border p-3 backdrop-blur-md"
        style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
      >
        {/* Current selection */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: currentElement.color, color: labelColorOn(currentElement.color) }}
            >
              {currentElement.symbol}
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--panel-text)' }}>{currentElement.name}</div>
              <div className="text-xs" style={{ color: 'var(--panel-text-tertiary)' }}>Click canvas to add</div>
            </div>
          </div>
          <button
            onClick={() => {
              setShowFullTable(!showFullTable)
            }}
            className="zatom-choice zatom-pressable flex items-center gap-1 rounded-md px-2 py-1 text-xs"
          >
            {showFullTable ? "Less" : "More"}
            <ChevronDown className={`w-3 h-3 transition-transform ${showFullTable ? "rotate-180" : ""}`} />
          </button>
        </div>
        
        {/* Common elements */}
        <div className="flex flex-wrap gap-1">
          {COMMON_ELEMENTS.map(symbol => {
            const el = getElement(symbol)
            const isSelected = selectedElement === symbol
            return (
                <button
                  key={symbol}
                  type="button"
                  aria-pressed={isSelected}
                onClick={() => {
                  setSelectedElement(symbol)
                }}
                className="zatom-pressable flex h-9 w-9 items-center justify-center rounded-md text-xs font-bold"
                style={{ 
                  backgroundColor: el.color,
                  color: labelColorOn(el.color),
                  boxShadow: isSelected ? 'inset 0 0 0 2px var(--panel-text)' : 'none',
                }}
                title={el.name}
              >
                {symbol}
              </button>
            )
          })}
        </div>
        
        {/* Full periodic table (condensed) */}
        {showFullTable && (
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="mb-2 text-xs" style={{ color: 'var(--panel-text-tertiary)' }}>All Elements</div>
            <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto">
              {allElements.map(el => {
                const isSelected = selectedElement === el.symbol
                const isCommon = COMMON_ELEMENTS.includes(el.symbol)
                if (isCommon) return null // Skip common ones
                return (
                  <button
                    key={el.symbol}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedElement(el.symbol)
                    }}
                    className="zatom-pressable flex h-7 w-7 items-center justify-center rounded text-[10px] font-bold"
                    style={{ 
                      backgroundColor: el.color,
                      color: labelColorOn(el.color),
                      opacity: isSelected ? 1 : 0.82,
                      boxShadow: isSelected ? 'inset 0 0 0 2px var(--panel-text)' : 'none',
                    }}
                    title={`${el.name} (${el.atomicNumber})`}
                  >
                    {el.symbol}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
