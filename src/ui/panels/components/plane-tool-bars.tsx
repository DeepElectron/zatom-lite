/** Combined snap, division-step, and add-atom element controls for the plane canvas. */

import { Grid3X3, Magnet } from "lucide-react"
import { COMMON_ELEMENTS } from "../../../lib/crystal/elements"
import { ElementChoice } from "./element-choice"

const SNAP_DIVISIONS = [2, 3, 4, 5, 6]

interface PlaneCanvasToolBarProps {
  snapEnabled: boolean
  setSnapEnabled: (v: boolean) => void
  showSnapPoints: boolean
  setShowSnapPoints: (v: boolean) => void
  snapDivision: number
  setSnapDivision: (n: number) => void
/** Show the element selector only in locked add-atom mode. */
  isAddAtomMode: boolean
  selectedElement: string
  setSelectedElement: (el: string) => void
}

export function PlaneCanvasToolBar({
  snapEnabled,
  setSnapEnabled,
  showSnapPoints,
  setShowSnapPoints,
  snapDivision,
  setSnapDivision,
  isAddAtomMode,
  selectedElement,
  setSelectedElement,
}: PlaneCanvasToolBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--panel-border)] bg-[var(--panel-elevated)] px-3 py-1.5">
      {/* Snap toggle */}
      <button
        onClick={() => {
          setSnapEnabled(!snapEnabled)
        }}
        aria-pressed={snapEnabled}
        data-selected={snapEnabled}
        className="zatom-choice zatom-pressable flex items-center gap-1.5 rounded px-2 py-1 text-xs"
      >
        <Magnet className="w-3 h-3" />
        Snap
      </button>

      {/* Show snap points toggle */}
      <button
        onClick={() => {
          setShowSnapPoints(!showSnapPoints)
        }}
        aria-pressed={showSnapPoints}
        data-selected={showSnapPoints}
        disabled={!snapEnabled}
        className="zatom-choice zatom-pressable flex items-center gap-1.5 rounded px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Grid3X3 className="w-3 h-3" />
        Points
      </button>

      {/* Number of subdivisions per lattice step. */}
      <div className="flex items-center gap-1" role="radiogroup" aria-label="Snap step (fraction of lattice spacing)">
        <span className="ml-1 whitespace-nowrap text-[10px] text-[var(--panel-text-tertiary)]">Step 1/</span>
        {SNAP_DIVISIONS.map(div => (
          <button
            key={div}
            onClick={() => {
              setSnapDivision(div)
            }}
            aria-checked={snapDivision === div}
            role="radio"
            data-selected={snapDivision === div}
            disabled={!snapEnabled}
            className="zatom-choice zatom-pressable h-6 w-6 rounded-md border-transparent text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {div}
          </button>
        ))}
      </div>

      {/* Element selector, shown only in add-atom mode. */}
      {isAddAtomMode && (
        <div className="ml-auto flex items-center gap-1">
          <span className="whitespace-nowrap text-[10px] text-[var(--panel-text-secondary)]">Element</span>
          <div className="flex items-center gap-1" role="group" aria-label="Element">
            {COMMON_ELEMENTS.slice(0, 8).map(el => (
              <ElementChoice
                key={el}
                symbol={el}
                selected={selectedElement === el}
                onSelect={() => {
                  setSelectedElement(el)
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
