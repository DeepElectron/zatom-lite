"use client"

import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { deleteIndices, selectedToXYZ, selectionCentroidSpread } from "../../lib/render/compact-selection"
import { materializeNeighborhood } from "../../lib/render/materialize-neighborhood"

const MATERIALIZE_CAP = 50000

/** Contextual actions for a compact (impostor-bulk) selection. Renders nothing
 *  unless a compact structure has a non-empty index selection. */
export function CompactSelectionTools() {
  const compact = useCrystalStore((s) => s.compactStructure)
  const sel = useCrystalStore((s) => s.selectedCompactIndices)
  const setCompactStructure = useCrystalStore((s) => s.setCompactStructure)
  const clearCompactSelection = useCrystalStore((s) => s.clearCompactSelection)
  const setFocusAtoms = useCrystalStore((s) => s.setFocusAtoms)
  const focusOnPoint = useCrystalStore((s) => s.focusOnPoint)

  if (!compact || sel.size === 0) return null

  const onExport = () => {
    const blob = new Blob([selectedToXYZ(compact, sel)], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = `selection-${sel.size}.xyz`; a.click()
    URL.revokeObjectURL(url)
  }
  const onDelete = () => { setCompactStructure(deleteIndices(compact, sel)); clearCompactSelection();  }
  const onFocus = () => { const { center, spread } = selectionCentroidSpread(compact, sel); focusOnPoint(center, spread) }
  const onEdit = () => { if (sel.size <= MATERIALIZE_CAP) setFocusAtoms(materializeNeighborhood(compact, [...sel])) }

  const btn = {
    padding: "4px 8px", borderRadius: 6, fontSize: 11,
    border: "1px solid var(--panel-border)", color: "var(--panel-text)",
    background: "transparent", cursor: "pointer",
  } as const

  return (
    <div className="rounded-lg p-2" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}>
      <span style={{ fontSize: 11, color: "var(--panel-text-secondary)" }}>{sel.size.toLocaleString()} selected</span>
      <button style={btn} onClick={onExport}>Export</button>
      <button style={btn} onClick={onDelete}>Delete</button>
      <button style={btn} onClick={onFocus}>Focus</button>
      <button style={{ ...btn, opacity: sel.size > MATERIALIZE_CAP ? 0.4 : 1 }} disabled={sel.size > MATERIALIZE_CAP}
        onClick={onEdit} title={sel.size > MATERIALIZE_CAP ? "selection too large to edit; export or delete instead" : "materialize for measure/edit"}>
        Edit
      </button>
    </div>
  )
}
