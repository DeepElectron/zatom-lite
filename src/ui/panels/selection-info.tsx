import { Focus, Link, Trash2, Unlink } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { getElement } from "../../lib/crystal/elements"
import { AtomPositionEditor } from "./atom-position-editor"
import { FaceSelectionInfo } from "./face-selection-info"
import { ReplaceElementPanel } from "./replace-element-panel"
import { TranslateSelectedAtoms } from "./translate-selected-atoms"
import { PanelSection } from "./components/panel-section"
import {
  PTM_ORDERING_LABELS,
  PTM_STRUCTURE_COLORS,
  PTM_STRUCTURE_LABELS,
} from "../../orchestration/slices/atom-attributes-slice"

export function SelectionInfo() {
  const selectMode = useCrystalStore((s) => s.selectMode)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectedEdgeIds = useCrystalStore((s) => s.selectedEdgeIds)
  const selectedFaceIds = useCrystalStore((s) => s.selectedFaceIds)
  const selectedBondIds = useCrystalStore((s) => s.selectedBondIds)
  const atoms = useCrystalStore((s) => s.atoms)
  const atomAttributes = useCrystalStore((s) => s.atomAttributes)
  const bonds = useCrystalStore((s) => s.bonds)
  const updateSelectedAtomsElement = useCrystalStore((s) => s.updateSelectedAtomsElement)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const deleteSelectedAtoms = useCrystalStore((s) => s.deleteSelectedAtoms)
  const clearBondSelection = useCrystalStore((s) => s.clearBondSelection)
  const addBond = useCrystalStore((s) => s.addBond)
  const removeBond = useCrystalStore((s) => s.removeBond)
  const updateBondType = useCrystalStore((s) => s.updateBondType)
  const updateSelectedBondsType = useCrystalStore((s) => s.updateSelectedBondsType)

  const selectedAtoms = atoms.filter((a) => selectedAtomIds.has(a.id))
  const atomCount = selectedAtoms.length
  const selectedPtm = atomCount === 1 ? atomAttributes[selectedAtoms[0].id] : undefined
  const edgeCount = selectedEdgeIds.size
  const faceCount = selectedFaceIds.size
  const bondCount = selectedBondIds.size

  // Keep the empty state subordinate to the selection tools above it.
  if (atomCount === 0 && edgeCount === 0 && faceCount === 0 && bondCount === 0) {
    return (
      <p className="px-1 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
        {selectMode === 'atom' && "Click atoms in the viewport to select · Shift+Click to add"}
        {selectMode === 'bond' && "Click bonds in the viewport to select · Shift+Click to add"}
        {selectMode === 'face' && "Click lattice faces in the viewport to select"}
      </p>
    )
  }

  // Bond selection info
  if (selectMode === 'bond' && bondCount > 0) {
  // Highlight a bond type only when every selected bond shares it.
    const selectedBonds = bonds.filter((b) => selectedBondIds.has(b.id))
    const firstType = selectedBonds[0]?.type
    const commonBondType =
      selectedBonds.length > 0 && selectedBonds.every((b) => b.type === firstType) ? firstType : undefined

    return (
      <div className="flex flex-col gap-3">
        <PanelSection label="Selected">
          <div className="flex items-baseline gap-1.5 text-xs">
            <span className="text-sm font-medium tabular-nums">{bondCount}</span>
            <span className="text-[var(--text-secondary)]">{bondCount === 1 ? 'bond' : 'bonds'}</span>
          </div>
        </PanelSection>

        <PanelSection
          label="Bond type"
          trailing={
            commonBondType === undefined ? (
              <span className="text-[11px] text-[var(--text-tertiary)]">Mixed</span>
            ) : undefined
          }
        >
          <div className="grid grid-cols-4 gap-1">
            {(['single', 'double', 'triple', 'aromatic'] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={commonBondType === type}
                data-selected={commonBondType === type}
                className="zatom-choice zatom-pressable rounded-lg py-1.5 text-[11px] font-medium capitalize"
                onClick={() => updateSelectedBondsType(type)}
              >
                {type}
              </button>
            ))}
          </div>
        </PanelSection>

        <button
          onClick={clearBondSelection}
          className="zatom-choice zatom-pressable flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear selection
        </button>
      </div>
    )
  }

  // Face selection info
  if (selectMode === 'face') {
    return <FaceSelectionInfo faceCount={faceCount} edgeCount={edgeCount} atomCount={atomCount} />
  }

  // Atom selection mode (original logic)
  const count = atomCount
  if (count === 0) {
    return (
      <div className="p-6 text-center text-[var(--text-secondary)]">
        <div className="text-sm mb-2">No atoms selected</div>
        <div className="text-xs opacity-70">
          Click atoms to select, Shift+Click for multi-select
        </div>
      </div>
    )
  }

  // Get element distribution
  const elementCounts = selectedAtoms.reduce(
    (acc, atom) => {
      acc[atom.element] = (acc[atom.element] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  // Find bonds between selected atoms
  const selectedBonds = bonds.filter(
    (b) => selectedAtomIds.has(b.atom1Id) && selectedAtomIds.has(b.atom2Id)
  )

  // Check if exactly 2 atoms are selected (for bonding operations)
  const canBond = count === 2
  const existingBond = canBond
    ? bonds.find(
        (b) =>
          (b.atom1Id === selectedAtoms[0].id && b.atom2Id === selectedAtoms[1].id) ||
          (b.atom1Id === selectedAtoms[1].id && b.atom2Id === selectedAtoms[0].id)
      )
    : null

  const handleReplaceElement = (newElement: string) => {
    updateSelectedAtomsElement(newElement)
  }

  return (
    <div className="space-y-4">
        {/* Compact summary of selected atoms, bonds, and elements. */}
      <PanelSection label="Selected">
        <div className="flex items-baseline gap-4 text-xs">
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium tabular-nums">{count}</span>
            <span className="text-[var(--text-secondary)]">atoms</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium tabular-nums">{selectedBonds.length}</span>
            <span className="text-[var(--text-secondary)]">bonds</span>
          </span>
        </div>

        {Object.keys(elementCounts).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(elementCounts).map(([symbol, elemCount]) => {
              const elem = getElement(symbol)
              return (
                <span
                  key={symbol}
                  className="flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px]"
                  style={{ background: "var(--glass-bg-active)" }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: elem.color }} />
                  <span className="font-medium">{symbol}</span>
                  <span className="tabular-nums text-[var(--text-tertiary)]">{elemCount}</span>
                </span>
              )
            })}
          </div>
        )}
      </PanelSection>

      {/* Single atom position editor */}
      {count === 1 && selectedAtoms[0] && selectedAtoms[0].cartesian && (
        <AtomPositionEditor atom={selectedAtoms[0] as { id: string; element: string; cartesian: [number, number, number] }} />
      )}

      {selectedPtm?.ptmAnalyzed && selectedPtm.ptmStructureType && (
        <PanelSection
          label="OVITO PTM"
          trailing={
            <span className="flex items-center gap-1.5 text-[11px] font-medium">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  backgroundColor: PTM_STRUCTURE_COLORS[selectedPtm.ptmStructureType],
                  border: selectedPtm.ptmStructureType === 'other' ? '1px solid rgba(128,128,128,0.45)' : 'none',
                }}
              />
              {PTM_STRUCTURE_LABELS[selectedPtm.ptmStructureType]}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 text-[11px] tabular-nums">
            <div>
              <div className="text-[var(--text-tertiary)]">RMSD</div>
              <div>{selectedPtm.ptmRmsd?.toFixed(6) ?? '—'}</div>
            </div>
            <div>
              <div className="text-[var(--text-tertiary)]">Local distance</div>
              <div>{selectedPtm.ptmInteratomicDistanceA === undefined ? '—' : `${selectedPtm.ptmInteratomicDistanceA.toFixed(5)} Å`}</div>
            </div>
            {selectedPtm.ptmOrderingType && (
              <div>
                <div className="text-[var(--text-tertiary)]">Chemical ordering</div>
                <div>{PTM_ORDERING_LABELS[selectedPtm.ptmOrderingType]}</div>
              </div>
            )}
            {selectedPtm.ptmElasticStrainMagnitude !== undefined && (
              <div>
                <div className="text-[var(--text-tertiary)]">Strain ‖E‖F</div>
                <div>{selectedPtm.ptmElasticStrainMagnitude.toPrecision(5)}</div>
              </div>
            )}
            {selectedPtm.ptmElasticVolumeRatio !== undefined && (
              <div>
                <div className="text-[var(--text-tertiary)]">Volume det F</div>
                <div>{selectedPtm.ptmElasticVolumeRatio.toPrecision(5)}</div>
              </div>
            )}
          </div>
        </PanelSection>
      )}

      <ReplaceElementPanel onReplace={handleReplaceElement} currentElements={Object.keys(elementCounts)} />

      {count > 1 && <TranslateSelectedAtoms />}

      {/* Bond creation is available only for exactly two selected atoms. */}
      {canBond && (
        <PanelSection label="Bond">
          {existingBond ? (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-3 gap-1">
                {(['single', 'double', 'triple'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={existingBond.type === type}
                    data-selected={existingBond.type === type}
                    className="zatom-choice zatom-pressable rounded-lg py-1.5 text-[11px] font-medium capitalize"
                    onClick={() => updateBondType(existingBond.id, type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
              {/* Dangerous actions use the shared status-red tokens. */}
              <button
                className="zatom-pressable status-red status-hover-red flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
                onClick={() => removeBond(existingBond.id)}
              >
                <Unlink className="h-3.5 w-3.5" />
                Remove bond
              </button>
            </div>
          ) : (
            <button
              className="zatom-primary zatom-pressable flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
              onClick={() => addBond(selectedAtoms[0].id, selectedAtoms[1].id, 'single')}
            >
              <Link className="h-3.5 w-3.5" />
              Create bond
            </button>
          )}
        </PanelSection>
      )}

      {/* Group view and destructive actions here; the duplicate Clear action lives in SelectionTools. */}
      <div className="flex gap-1.5">
        <button
          className="zatom-choice zatom-pressable flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
          onClick={() => focusOnAtoms(Array.from(selectedAtomIds))}
        >
          <Focus className="h-3.5 w-3.5" />
          Focus
        </button>
        <button
          className="zatom-pressable status-red status-hover-red flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium"
          onClick={deleteSelectedAtoms}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  )
}
