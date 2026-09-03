/** Tool, element, and bond-order controls for the SMILES editor. */

import { Atom, Link2, MousePointer, Move, RotateCcw, Trash2 } from "lucide-react"
import { ElementChoice } from "./element-choice"

type MoleculeToolMode = "select" | "add-atom" | "add-bond" | "delete" | "move-molecule"
type BondType = "single" | "double" | "triple"

interface MoleculeToolBarProps {
  mol2DToolMode: MoleculeToolMode
  setMol2DToolMode: (m: MoleculeToolMode) => void
  mol2DSelectedElement: string
  setMol2DSelectedElement: (el: string) => void
  mol2DSelectedBondType: BondType
  setMol2DSelectedBondType: (t: BondType) => void
  onClear: () => void
}

export function MoleculeToolBar({
  mol2DToolMode,
  setMol2DToolMode,
  mol2DSelectedElement,
  setMol2DSelectedElement,
  mol2DSelectedBondType,
  setMol2DSelectedBondType,
  onClear,
}: MoleculeToolBarProps) {
  return (
    <div
      className="flex items-center gap-1 px-4 py-2"
      style={{
        background: "var(--panel-elevated)",
        borderBottom: "1px solid var(--panel-border)",
      }}
    >
      {/* Tool buttons */}
      <button
        onClick={() => { setMol2DToolMode("select");  }}
        aria-pressed={mol2DToolMode === "select"}
        data-selected={mol2DToolMode === "select"}
        className="zatom-choice zatom-pressable rounded p-1.5"
        title="Select"
      >
        <MousePointer className="w-4 h-4" />
      </button>
      <button
        onClick={() => { setMol2DToolMode("add-atom");  }}
        aria-pressed={mol2DToolMode === "add-atom"}
        data-selected={mol2DToolMode === "add-atom"}
        className="zatom-choice zatom-pressable rounded p-1.5"
        title="Add Atom"
      >
        <Atom className="w-4 h-4" />
      </button>
      <button
        onClick={() => { setMol2DToolMode("add-bond");  }}
        aria-pressed={mol2DToolMode === "add-bond"}
        data-selected={mol2DToolMode === "add-bond"}
        className="zatom-choice zatom-pressable rounded p-1.5"
        title="Add Bond"
      >
        <Link2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => { setMol2DToolMode("delete");  }}
        aria-pressed={mol2DToolMode === "delete"}
        data-selected={mol2DToolMode === "delete"}
        className="zatom-choice zatom-pressable rounded p-1.5"
        title="Delete"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="mx-1 h-4 w-px bg-[var(--panel-border)]" />

      {/* Move molecule tool */}
      <button
        onClick={() => { setMol2DToolMode("move-molecule");  }}
        aria-pressed={mol2DToolMode === "move-molecule"}
        data-selected={mol2DToolMode === "move-molecule"}
        className="zatom-choice zatom-pressable flex items-center gap-1 rounded p-1.5"
        title="Move Molecule (drag to reposition)"
      >
        <Move className="w-4 h-4" />
        <span className="text-[10px]">Move</span>
      </button>

      <div className="mx-1 h-4 w-px bg-[var(--panel-border)]" />

      {/* Move molecule mode indicator */}
      {mol2DToolMode === "move-molecule" && (
        <div className="flex items-center gap-1 text-[10px] text-[var(--control-selected-text)]">
          <span>Drag to move molecule</span>
        </div>
      )}

      {/* Element selector (when add-atom) */}
      {mol2DToolMode === "add-atom" && (
        <div className="flex gap-1" role="group" aria-label="Molecule element">
          {["C", "N", "O", "H", "S", "P"].map(el => (
            <ElementChoice
              key={el}
              symbol={el}
              selected={mol2DSelectedElement === el}
              onSelect={() => {
                setMol2DSelectedElement(el)
              }}
            />
          ))}
        </div>
      )}

      {/* Bond type selector (when add-bond) */}
      {mol2DToolMode === "add-bond" && (
        <div className="flex gap-1" role="radiogroup" aria-label="Bond order">
          {(["single", "double", "triple"] as const).map(type => (
            <button
              key={type}
              onClick={() => {
                setMol2DSelectedBondType(type)
              }}
              role="radio"
              aria-checked={mol2DSelectedBondType === type}
              data-selected={mol2DSelectedBondType === type}
              className="zatom-choice zatom-pressable rounded px-2 py-1 text-[10px]"
            >
              {type === "single" ? "—" : type === "double" ? "=" : "≡"}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={() => { onClear();  }}
        className="zatom-pressable rounded p-1.5 text-[var(--panel-text-tertiary)] hover:text-[var(--panel-text)]"
        title="Clear"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
    </div>
  )
}
