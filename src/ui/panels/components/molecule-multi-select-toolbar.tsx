/** Multi-select and zoom controls for the SMILES editor. */

import { Move, MousePointer } from "lucide-react"

interface MoleculeMultiSelectToolbarProps {
  isMultiSelectMode: boolean
  multiSelectedAtomIds: Set<string>
  zoomLevel: number
  onToggleMultiSelect: () => void
  onSelectAll: () => void
  onResetZoom: () => void
}

export function MoleculeMultiSelectToolbar({
  isMultiSelectMode,
  multiSelectedAtomIds,
  zoomLevel,
  onToggleMultiSelect,
  onSelectAll,
  onResetZoom,
}: MoleculeMultiSelectToolbarProps) {
  return (
    <div
      className="flex items-center justify-between border-t border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleMultiSelect}
          aria-pressed={isMultiSelectMode}
          data-selected={isMultiSelectMode}
          className="zatom-choice zatom-pressable flex items-center gap-1 rounded px-2 py-1 text-xs"
        >
          <MousePointer className="w-3 h-3" />
          Multi-Select
        </button>

        {isMultiSelectMode && (
          <>
            <button
              type="button"
              onClick={onSelectAll}
              className="zatom-choice zatom-pressable rounded px-2 py-1 text-xs"
            >
              Select All
            </button>
            {multiSelectedAtomIds.size > 0 && (
              <span className="flex items-center gap-1 text-xs text-[var(--control-selected-text)]">
                <Move className="w-3 h-3" />
                {multiSelectedAtomIds.size} selected - drag to move
              </span>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-[var(--panel-text-tertiary)]">
        <span>Zoom: {Math.round(zoomLevel * 100)}%</span>
        <button
          type="button"
          onClick={onResetZoom}
          className="zatom-choice zatom-pressable rounded px-1.5 py-0.5"
          title="Reset zoom"
        >
          Reset
        </button>
      </div>
    </div>
  )
}
