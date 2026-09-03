/** SMILES input, hydrogen options, examples, and custom-library controls. */

import { useState } from "react"
import { ChevronDown, FolderOpen, Save, Trash } from "lucide-react"
import { SMILES_EXAMPLES, type Molecule2D } from "../../../lib/molecule/smiles-parser"
import { getCustomFragments, saveCustomFragment, deleteCustomFragment, type CustomFragment } from "../../../lib/molecule/custom-fragments"
import { liftPlanarSketchTo3D } from "../../../lib/molecule/planar-to-3d"

interface SmilesInputSectionProps {
  smilesInput: string
  setSmilesInput: (s: string) => void
  onParse: () => void
  autoAddHydrogen: boolean
  setAutoAddHydrogen: (v: boolean) => void
  onLoadExample: (smiles: string) => void
  customFragments: CustomFragment[]
  setCustomFragments: (frags: CustomFragment[]) => void
  molecule2D: Molecule2D | null
}

export function SmilesInputSection({
  smilesInput,
  setSmilesInput,
  onParse,
  autoAddHydrogen,
  setAutoAddHydrogen,
  onLoadExample,
  customFragments,
  setCustomFragments,
  molecule2D,
}: SmilesInputSectionProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveFragmentName, setSaveFragmentName] = useState("")
  const [showCustomLibrary, setShowCustomLibrary] = useState(false)
  // Keep examples and auto-H collapsed by default to preserve canvas height.
  const [showOptions, setShowOptions] = useState(false)

  /** Persist real 3D geometry by lifting and relaxing the planar sketch first. */
  const trySave = () => {
    const name = saveFragmentName.trim()
    if (!name) return
    const lifted = liftPlanarSketchTo3D(molecule2D?.atoms ?? [], molecule2D?.bonds ?? [])
    saveCustomFragment({
      name,
      smiles: smilesInput,
      formula: lifted.formula,
      atoms: lifted.atoms,
      bonds: lifted.bonds,
    })
    setCustomFragments(getCustomFragments())
    setShowSaveDialog(false)
    setSaveFragmentName("")
  }

  return (
    <div className="border-b border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2">
      {/* Persistent input row with Parse and advanced-options controls. */}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={smilesInput}
          onChange={(e) => setSmilesInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onParse()}
          placeholder="Enter SMILES (e.g., CCO)"
          className="min-w-0 flex-1 rounded border border-[var(--panel-border)] bg-[var(--panel-elevated)] px-2 py-1.5 text-xs text-[var(--panel-text)] outline-none placeholder:text-[var(--panel-text-tertiary)] focus:border-[#FF9F0A]"
        />
        <button
          onClick={onParse}
          className="zatom-pressable rounded bg-[#FF9F0A] px-3 py-1.5 text-xs font-medium text-black transition-colors hover:bg-[#FFB340]"
        >
          Parse
        </button>
        <button
          onClick={() => setShowOptions(!showOptions)}
          aria-expanded={showOptions}
          data-selected={showOptions}
          className="zatom-choice zatom-pressable rounded px-1.5 py-1.5"
          title={showOptions ? "Hide presets & options" : "Show presets & options"}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${showOptions ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showOptions && (
        <>
          {/* Auto add hydrogen toggle */}
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[10px] text-[var(--panel-text-secondary)]">Auto add hydrogen</span>
            <button
              onClick={() => {
                setAutoAddHydrogen(!autoAddHydrogen)
              }}
              role="switch"
              aria-checked={autoAddHydrogen}
              aria-label="Auto add hydrogen"
              className={`relative h-4 w-8 rounded-full transition-colors ${
                autoAddHydrogen ? "bg-[#30D158]" : "bg-[var(--panel-border)]"
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  autoAddHydrogen ? "translate-x-4" : ""
                }`}
              />
            </button>
          </div>

          {/* Preset examples */}
          <div className="mt-2 flex flex-wrap gap-1">
            {SMILES_EXAMPLES.slice(0, 6).map((example) => (
              <button
                key={example.name}
                onClick={() => onLoadExample(example.smiles)}
                className="zatom-choice zatom-pressable rounded px-2 py-0.5 text-[10px]"
              >
                {example.name}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Custom library section */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => setShowCustomLibrary(!showCustomLibrary)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#AF82FF]/20 text-[#AF82FF] hover:bg-[#AF82FF]/30 transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
          My Library ({customFragments.length})
        </button>
        {molecule2D && molecule2D.atoms.length > 0 && (
          <button
            onClick={() => {
              setSaveFragmentName("")
              setShowSaveDialog(true)
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#30D158]/20 text-[#30D158] hover:bg-[#30D158]/30 transition-colors"
          >
            <Save className="w-3 h-3" />
            Save to Library
          </button>
        )}
      </div>

      {/* Custom library dropdown */}
      {showCustomLibrary && customFragments.length > 0 && (
        <div className="mt-2 max-h-32 overflow-y-auto rounded border border-[#AF82FF]/30 bg-[var(--panel-elevated)] p-2">
          <div className="text-[10px] text-[#AF82FF] mb-1">Custom Fragments:</div>
          <div className="flex flex-wrap gap-1">
            {customFragments.map((frag) => (
              <div key={frag.id} className="flex items-center gap-0.5 group">
                <button
                  onClick={() => {
                    onLoadExample(frag.smiles ?? "")
                    setShowCustomLibrary(false)
                  }}
                  className="px-2 py-0.5 rounded text-[10px] bg-[#AF82FF]/10 text-[#AF82FF] hover:bg-[#AF82FF]/20 transition-colors"
                >
                  {frag.name}
                </button>
                <button
                  onClick={() => {
                    deleteCustomFragment(frag.id)
                    setCustomFragments(getCustomFragments())
                  }}
                  className="zatom-pressable rounded p-0.5 text-[var(--panel-text-tertiary)] opacity-0 status-hover-red group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {showCustomLibrary && customFragments.length === 0 && (
        <div className="mt-2 rounded border border-[#AF82FF]/30 bg-[var(--panel-elevated)] p-2 text-center text-[10px] text-[var(--panel-text-tertiary)]">
          No saved fragments yet. Create a molecule and click "Save to Library".
        </div>
      )}

      {/* Save dialog */}
      {showSaveDialog && (
        <div className="mt-2 p-2 rounded bg-black/60 border border-[#30D158]/30">
          <div className="text-[10px] text-[#30D158] mb-1">Save to Library:</div>
          <div className="flex gap-1">
            <input
              type="text"
              value={saveFragmentName}
              onChange={(e) => setSaveFragmentName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") trySave()
              }}
              placeholder="Fragment name..."
              className="flex-1 px-2 py-1 rounded text-[10px] bg-black/40 border border-white/10 text-white placeholder-white/30 outline-none focus:border-[#30D158]"
              autoFocus
            />
            <button
              onClick={trySave}
              disabled={!saveFragmentName.trim()}
              className="px-2 py-1 rounded text-[10px] bg-[#30D158] text-black hover:bg-[#34D65C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveDialog(false)}
              className="px-2 py-1 rounded text-[10px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
