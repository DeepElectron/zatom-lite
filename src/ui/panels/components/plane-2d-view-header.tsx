/** Header controls and molecule-editor toggle for the 2D plane view. */

import { Atom, Eye, EyeOff, Grid3X3, Lock, Maximize2, Minimize2, Undo2, Unlock, X } from "lucide-react"
import type { Molecule2D } from "../../../lib/molecule/smiles-parser"

interface Plane2DViewHeaderProps {
  isLocked: boolean
  setIsLocked: (v: boolean) => void
  showOffPlaneAtoms: boolean
  setShowOffPlaneAtoms: (v: boolean) => void
  windowSize: { width: number; height: number }
  setWindowSize: (s: { width: number; height: number }) => void
  canUndo: () => boolean
  onUndo: () => void
  onClose: () => void
}

export function Plane2DViewHeader({
  isLocked,
  setIsLocked,
  showOffPlaneAtoms,
  setShowOffPlaneAtoms,
  windowSize,
  setWindowSize,
  canUndo,
  onUndo,
  onClose,
}: Plane2DViewHeaderProps) {
  const undoEnabled = canUndo()
  return (
    <div
      className="flex items-center justify-between px-4 py-2"
      style={{
        background: "var(--panel-elevated)",
        borderBottom: "1px solid var(--panel-border)",
        cursor: isLocked ? "default" : "move",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--panel-text)" }}>2D View</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (undoEnabled) {
              onUndo()
            }
          }}
          className="zatom-choice zatom-pressable rounded-lg p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
          title="Undo (Ctrl+Z)"
          disabled={!undoEnabled}
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            setIsLocked(!isLocked)
          }}
          className="zatom-choice zatom-pressable rounded-lg p-1.5"
          data-selected={isLocked}
          title={isLocked ? "Unlock window" : "Lock window (enable canvas pan/create)"}
        >
          {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            setShowOffPlaneAtoms(!showOffPlaneAtoms)
          }}
          className="zatom-choice zatom-pressable rounded-lg p-1.5"
          data-selected={showOffPlaneAtoms}
          title={showOffPlaneAtoms ? "Hide off-plane atoms" : "Show off-plane atoms"}
        >
          {showOffPlaneAtoms ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            if (windowSize.width > 400) {
              setWindowSize({ width: 280, height: 320 })
            } else {
              setWindowSize({ width: 500, height: 550 })
            }
          }}
          className="zatom-choice zatom-pressable rounded-lg p-1.5"
          title="Toggle window size"
        >
          {windowSize.width > 400 ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        <button
          onClick={() => {
            onClose()
          }}
          className="zatom-choice zatom-pressable rounded-lg p-1.5"
          aria-label="Close 2D View"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

interface MoleculeEditorToggleProps {
  canShowPlane: boolean
  onPlaneCount: number
  showMoleculeEditor: boolean
  setShowMoleculeEditor: (v: boolean) => void
  molecule2D: Molecule2D | null
}

export function MoleculeEditorToggle({
  canShowPlane,
  onPlaneCount,
  showMoleculeEditor,
  setShowMoleculeEditor,
  molecule2D,
}: MoleculeEditorToggleProps) {
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5"
      style={{
        background: "var(--panel-bg)",
        borderBottom: "1px solid var(--panel-border)",
      }}
    >
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--panel-text-secondary)" }}>
        {canShowPlane && (
          <span className="flex items-center gap-1">
            <Grid3X3 className="w-3 h-3" />
            Plane: {onPlaneCount} atoms
          </span>
        )}
        {!canShowPlane && (
          <span style={{ color: "var(--panel-text-tertiary)" }}>No plane constructed</span>
        )}
      </div>
      <button
        onClick={() => {
          setShowMoleculeEditor(!showMoleculeEditor)
        }}
        aria-pressed={showMoleculeEditor}
        data-selected={showMoleculeEditor}
        className="zatom-choice zatom-pressable flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium"
      >
        <Atom className="w-3.5 h-3.5" />
        Molecule
        {molecule2D && <span className="opacity-60">({molecule2D.atoms.length})</span>}
      </button>
    </div>
  )
}
