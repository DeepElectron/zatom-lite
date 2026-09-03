"use client"

import { useState, useEffect } from "react"
import {
  MousePointer2,
  MousePointerSquareDashed,
  Plus,
  Trash2,
  Link,
  Eye,
  EyeOff,
  Grid3X3,
  Focus,
  Square,
  Home,
  Lock,
  Unlock,
  Move,
  Mouse,
} from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import { useIsMobile } from "../../ui-kit/use-mobile"
import { shouldDisableGeometrySelection } from "../../lib/performance/adaptive-performance"
import { HoverHint } from "./hover-hint"

interface ToolButtonProps {
  active?: boolean
  title: string
  icon: React.ReactNode
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  disabled?: boolean
}

/** Cycles default → maestro → gaussian; the tooltip names the current and next preset. */
function CameraPresetCycleButton() {
  const preset = useCrystalStore((s: any) => s.cameraControlPreset) as 'default' | 'maestro' | 'gaussian'
  const setPreset = useCrystalStore((s: any) => s.setCameraControlPreset) as (p: 'default' | 'maestro' | 'gaussian') => void
  const labels: Record<typeof preset, string> = {
    default: 'Default',
    maestro: 'Maestro',
    gaussian: 'Gaussian',
  }
  const next: Record<typeof preset, typeof preset> = {
    default: 'maestro',
    maestro: 'gaussian',
    gaussian: 'default',
  }
  const title = `Mouse Preset: ${labels[preset]} (click → ${labels[next[preset]]})`
  return (
    <ToolButton
      title={title}
      icon={
        <span className="flex items-center gap-0.5">
          <Mouse className="w-5 h-5" />
          <span className="text-[8px] font-mono uppercase tracking-tight">
            {preset === 'default' ? 'D' : preset === 'maestro' ? 'M' : 'G'}
          </span>
        </span>
      }
      onClick={() => setPreset(next[preset])}
    />
  )
}

/** Cycle Boundary → Unit cells → Off using the existing lattice and grid flags. */
function CellDisplayCycleButton({ disabled }: { disabled?: boolean }) {
  const showLattice = useCrystalStore((s) => s.showLattice)
  const showCellGrid = useCrystalStore((s) => s.showCellGrid)
  const setShowLattice = useCrystalStore((s) => s.setShowLattice)
  const setShowCellGrid = useCrystalStore((s) => s.setShowCellGrid)

  const state: 'boundary' | 'cells' | 'off' = !showLattice
    ? 'off'
    : showCellGrid ? 'cells' : 'boundary'
  const labels = { boundary: 'Boundary', cells: 'Unit cells', off: 'Off' } as const
  const nextState = { boundary: 'cells', cells: 'off', off: 'boundary' } as const
  const next = nextState[state]

  const apply = (target: 'boundary' | 'cells' | 'off') => {
    if (target === 'off') {
      setShowLattice(false)
      return
    }
    setShowLattice(true)
    setShowCellGrid(target === 'cells')
  }

  return (
    <ToolButton
      active={state !== 'off'}
      title={`Cell: ${labels[state]} (click → ${labels[next]})`}
      icon={
        state === 'cells' ? <Grid3X3 className="w-5 h-5" />
        : state === 'boundary' ? <Square className="w-5 h-5" />
        : <EyeOff className="w-5 h-5" />
      }
      onClick={() => apply(next)}
      disabled={disabled}
    />
  )
}

function ToolButton({ active, title, icon, onClick, onContextMenu, disabled }: ToolButtonProps) {
  const handleClick = () => {
    if (!disabled && onClick) {
      onClick()
    }
  }

  return (
    <HoverHint title={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={active === undefined ? undefined : active}
        className="zatom-pressable h-11 w-11 shrink-0 rounded-full flex items-center justify-center cursor-pointer border-none hover:bg-[var(--glass-bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
        data-selected={active === true}
        style={{
          background: active ? "var(--control-selected-bg)" : undefined,
          color: active ? "var(--control-selected-text)" : "var(--text-secondary)",
        }}
        title={title}
        onClick={handleClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
      >
        {icon}
      </button>
    </HoverHint>
  )
}

function Divider() {
  return (
    <div
      className="h-6 w-px shrink-0 my-auto mx-1"
      style={{ background: "var(--glass-border-subtle)" }}
    />
  )
}

/** Compact segment button shared by submode, annotation, and pick-level controls. */
function SegmentButton({ active, label, title, onClick }: {
  active: boolean
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <HoverHint title={title}>
      <button
        type="button"
        aria-label={title}
        aria-pressed={active}
        className="zatom-pressable shrink-0 rounded-full border-none px-2.5 py-1 text-[11px] font-medium cursor-pointer hover:bg-[var(--glass-bg-hover)]"
        style={{
          background: active ? "var(--control-selected-bg)" : "transparent",
          color: active ? "var(--control-selected-text)" : "var(--text-secondary)",
        }}
        onClick={() => {  onClick() }}
      >
        {label}
      </button>
    </HoverHint>
  )
}

/** Bond submodes distinguish selection, covalent creation, annotations, and detected contacts. */
export function BondSubmodeFlyout() {
  const submode = useCrystalStore((s) => s.bondToolSubmode)
  const setSubmode = useCrystalStore((s) => s.setBondToolSubmode)
  const activateSubmode = useCrystalStore((s) => s.activateBondSubmode)
  const kind = useCrystalStore((s) => s.bondAnnotationKind)
  const setKind = useCrystalStore((s) => s.setBondAnnotationKind)
  const annotationCount = useCrystalStore((s) => s.bondAnnotations.length)
  const clearBondAnnotations = useCrystalStore((s) => s.clearBondAnnotations)
  const selectedBondCount = useCrystalStore((s) => s.selectedBondIds.size)
  const clearBondSelection = useCrystalStore((s) => s.clearBondSelection)
  // Biomolecules cannot edit covalent topology, so default them to Link.
  const isBio = useCrystalStore((s) => !!s.bioStructure)
  // Render only for an active Bond tool in the structure modeler.
  // Select submode uses toolMode=select, so both mode axes identify it.
  // Mount in the bottom stack outside scrolling overflow.
  const visible = useCrystalStore((s) =>
    (s.toolMode === 'add-bond' || (s.toolMode === 'select' && s.selectMode === 'bond'))
    && !s.activeSceneId && s.builderMode !== 'assembly')

  // Correct only the stored preference here, not the active tool mode.
  // Calling activate while Bond is inactive could switch a biomolecule into add-bond mode.
  useEffect(() => {
    if (isBio && submode === 'create') setSubmode('link')
  }, [isBio, submode, setSubmode])

  if (!visible) return null

  return (
    <div
      className="flex items-center gap-1 rounded-full px-2 py-1.5 pointer-events-auto"
      style={{
        background: "var(--glass-bg)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "blur(48px)",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--shadow-float)",
      }}
    >
      <SegmentButton
        active={submode === 'select'}
        label="Select"
        title="Select bonds (2) — click bonds to select; feeds delete and bond order"
        onClick={() => activateSubmode('select')}
      />
      {!isBio && (
        <SegmentButton
          active={submode === 'create'}
          label="Create"
          title="Create bond — two clicks write a covalent bond into the structure"
          onClick={() => activateSubmode('create')}
        />
      )}
      <SegmentButton
        active={submode === 'link'}
        label="Link"
        title="Link annotation — dashed line with distance between any two atoms; does not modify chemistry"
        onClick={() => activateSubmode('link')}
      />
      <SegmentButton
        active={submode === 'contacts'}
        label="Contacts"
        title="Contact analysis — auto-detected hydrogen bonds / salt bridges; selection filters the results"
        onClick={() => activateSubmode('contacts')}
      />
      {submode === 'select' && selectedBondCount > 0 && (
        <>
          <div className="h-4 w-px shrink-0 mx-0.5" style={{ background: "var(--glass-border-subtle)" }} />
          <SegmentButton
            active={false}
            label={`Clear ${selectedBondCount}`}
            title="Clear the bond selection"
            onClick={clearBondSelection}
          />
        </>
      )}
      {submode === 'link' && (
        <>
          <div className="h-4 w-px shrink-0 mx-0.5" style={{ background: "var(--glass-border-subtle)" }} />
          <SegmentButton active={kind === 'custom'} label="Custom" title="Annotation type: custom link" onClick={() => setKind('custom')} />
          <SegmentButton active={kind === 'hydrogen-bond'} label="H-bond" title="Annotation type: hydrogen bond" onClick={() => setKind('hydrogen-bond')} />
          <SegmentButton active={kind === 'salt-bridge'} label="Salt" title="Annotation type: salt bridge" onClick={() => setKind('salt-bridge')} />
          {annotationCount > 0 && (
            <>
              <div className="h-4 w-px shrink-0 mx-0.5" style={{ background: "var(--glass-border-subtle)" }} />
              <SegmentButton
                active={false}
                label={`Clear ${annotationCount}`}
                title="Remove all link annotations"
                onClick={clearBondAnnotations}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The command palette (⌘) and the Call Agent button (✨) are both gone from the
 * toolbar, along with `CommandEntry` / `useStoreCommands` / `CommandInput`.
 *
 * The palette mixed a host-only function catalog with local actions that duplicated
 * this toolbar, and its `Ctrl+K` tooltip promised a shortcut that was never bound.
 * Agent modeling now has one canonical entry in the Inspector, so a second overlay
 * button would be an ambiguous, unconnected path.
 */

export function BottomToolbar() {
  // Prevent hydration mismatch by only rendering after mount
  const [mounted, setMounted] = useState(false)
  const isMobile = useIsMobile()
  
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Selection mode
  const selectMode = useCrystalStore((s) => s.selectMode)
  const setSelectMode = useCrystalStore((s) => s.setSelectMode)

  // The Bond submode determines which bond operation the toolbar activates.
  const bondToolSubmode = useCrystalStore((s) => s.bondToolSubmode)
  const activateBondSubmode = useCrystalStore((s) => s.activateBondSubmode)
  
  // Tool mode
  const toolMode = useCrystalStore((s) => s.toolMode)
  const setToolMode = useCrystalStore((s) => s.setToolMode)
  
  // Visibility toggles
  const showBonds = useCrystalStore((s) => s.showBonds)
  const setShowBonds = useCrystalStore((s) => s.setShowBonds)
  
  // Selection state
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectedFaceIds = useCrystalStore((s) => s.selectedFaceIds)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const resetCameraToInitial = useCrystalStore((s) => s.resetCameraToInitial)
  
  // Box selection mode
  const boxSelectModeEnabled = useCrystalStore((s) => s.boxSelectModeEnabled)
  const setBoxSelectModeEnabled = useCrystalStore((s) => s.setBoxSelectModeEnabled)
  
  // Detail cell locking
  // Derive Lock visibility from stable thresholds rather than transient detail modes.
  // Transient interaction detail changes during camera motion.
  // Using them would make toolbar controls jump horizontally.
  // Atom count, LOD threshold, and manual solid-box mode remain stable.
  const lodThreshold = useCrystalStore((s) => s.lodThreshold)
  const atomsCount = useCrystalStore((s) => s.atoms.length)
  const solidBoxManual = useCrystalStore((s) => s.solidBoxManual)
  const showLockButtons = atomsCount > lodThreshold || solidBoxManual
  // Ultra-low mode changes only the Lock tooltip.
  // It must not affect toolbar width.
  const useUltraLowMode = useCrystalStore((s) => s.useUltraLowMode)
  const fastCellIndices = useCrystalStore((s) => s.fastCellIndices)
  const detailCellIndices = useCrystalStore((s) => s.detailCellIndices)
  const lockSelectedFaceCells = useCrystalStore((s) => s.lockSelectedFaceCells)
  const clearDetailCells = useCrystalStore((s) => s.clearDetailCells)
  
  // Builder mode & placement state
  const builderMode = useCrystalStore((s) => s.builderMode)
  const activeSceneId = useCrystalStore((s) => s.activeSceneId)
  const placementStep = useCrystalStore((s) => s.placementState.step)
  const isAssemblyMode = builderMode === 'assembly'
  // An assembly scene is separate from the structure modeler:
  // atom/bond/lattice editing tools are removed (not greyed) while a scene is open.
  const inScene = !!activeSceneId
  const isPlacing = !!activeSceneId && placementStep !== 'idle'
  
  // Atoms and bonds for selection extension
  const atoms = useCrystalStore((s) => s.atoms)
  const massiveSceneThreshold = useCrystalStore((s) => s.massiveSceneThreshold)
  const veryLargeSceneThreshold = useCrystalStore((s) => s.veryLargeSceneThreshold)
  const geometrySelectionDisabled = shouldDisableGeometrySelection(atoms.length, {
    mobileLike: isMobile,
    customMassiveThreshold: massiveSceneThreshold,
    customVeryLargeThreshold: veryLargeSceneThreshold,
  })

  const hasAtomSelection = selectedAtomIds.size > 0
  const hasFaceSelection = selectedFaceIds.size > 0
  const hasLockedCells = fastCellIndices.size > 0 || detailCellIndices.size > 0
  // Biomolecule atom mirrors can be lazy even when the structure is populated.
  const isBioScene = useCrystalStore((s) => !!s.bioStructure)
  const emptyStructure = !inScene && atoms.length === 0 && !isBioScene

  useEffect(() => {
    if (!geometrySelectionDisabled) return
    if (selectMode !== "bond" && selectMode !== "face") return

    setSelectMode("atom")
  }, [geometrySelectionDisabled, selectMode, setSelectMode])
  
  /**
   * The selection-growth verbs (Add Neighbors / Add Fragment / Invert) used to
   * live in a hand-rolled menu opened by right-clicking the Box Select button.
   * They act on the selected atoms, not on that button, so they now live in the
   * viewport right-click menu (viewport-context-menu.tsx) next to their operand.
   */

  const enableBoxSelection = () => {
    setToolMode("select")
    if (selectMode !== "atom") {
      setSelectMode("atom")
    }
    setBoxSelectModeEnabled(true)
  }

  // Don't render until mounted to prevent hydration mismatch
  if (!mounted) return null

  // Hide the toolbar during placement.
  if (isPlacing) return null

  return (
  <div
  role="toolbar"
  aria-label="3D viewport tools"
  className="modeler-chrome-surface flex w-max shrink-0 gap-1 p-2 rounded-full pointer-events-auto"
  style={{
  background: "var(--glass-bg)",
  backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "blur(48px)",
        border: "1px solid var(--glass-border)",
        boxShadow: "var(--shadow-float)",
      }}
    >
      {/* Selection Mode Tools */}
      <ToolButton
        active={selectMode === "atom" && toolMode === "select" && !boxSelectModeEnabled}
        title={emptyStructure ? "Select Atoms — add an atom first" : "Select Atoms (1)"}
        icon={<MousePointer2 className="w-5 h-5" />}
        onClick={() => {
          setSelectMode("atom")
          setToolMode("select")
          setBoxSelectModeEnabled(false)
        }}
        disabled={emptyStructure}
      />
      {/* Bond selection is the Bond tool Select submode rather than a separate button. */}
      <ToolButton
        active={selectMode === "face" && !boxSelectModeEnabled}
        title={emptyStructure
          ? "Select Faces — add an atom first"
          : geometrySelectionDisabled ? "Face Selection Disabled In Large Scene" : "Select Faces (3)"}
        icon={<Square className="w-5 h-5" />}
        onClick={() => {
          if (geometrySelectionDisabled) {
            setSelectMode("atom")
            setToolMode("select")
            setBoxSelectModeEnabled(false)
            return
          }
          setSelectMode("face")
          setToolMode("select")
          setBoxSelectModeEnabled(false)
        }}
        disabled={emptyStructure || geometrySelectionDisabled}
      />
      {!inScene && (
        <ToolButton
          active={boxSelectModeEnabled && toolMode === "select"}
              title="Box Select Mode (Shift+B)"
              icon={<MousePointerSquareDashed className="w-5 h-5" />}
          onClick={() => {
            if (boxSelectModeEnabled) {
              setBoxSelectModeEnabled(false)
              return
            }

            enableBoxSelection()
          }}
          disabled={isAssemblyMode || emptyStructure}
        />
      )}

      <Divider />

      {/* Editing Tools */}
      <ToolButton
        active={toolMode === "drag-atom"}
        title={emptyStructure ? "Drag Atom — add an atom first" : isAssemblyMode ? "Transform Object (G)" : "Drag Atom (G)"}
        icon={<Move className="w-5 h-5" />}
        onClick={() => setToolMode("drag-atom")}
        disabled={emptyStructure}
      />
      {!inScene && (
        <ToolButton
          active={toolMode === "add-atom"}
          title="Add Atom (A)"
          icon={<Plus className="w-5 h-5" />}
          onClick={() => setToolMode("add-atom")}
          disabled={isAssemblyMode}
        />
      )}
      {!inScene && (
        <ToolButton
          // Select submode is active through toolMode=select.
          active={toolMode === "add-bond" || (toolMode === "select" && selectMode === "bond" && !boxSelectModeEnabled)}
          title="Bond Tool (B) — select bonds, create bonds, link annotations, contact analysis"
          icon={<Link className="w-5 h-5" />}
          // The current submode chooses the bond operation.
          // Fall back to Create when large-scene geometry selection is unavailable.
          onClick={() => activateBondSubmode(
            bondToolSubmode === 'select' && geometrySelectionDisabled ? 'create' : bondToolSubmode,
          )}
          disabled={isAssemblyMode || emptyStructure}
        />
      )}

      <ToolButton
        active={toolMode === "delete"}
        title={emptyStructure ? "Delete — add an atom first" : "Delete (D)"}
        icon={<Trash2 className="w-5 h-5" />}
        onClick={() => setToolMode("delete")}
        disabled={emptyStructure}
      />

      <Divider />

      {/* Cycle the camera mouse preset. */}
      <CameraPresetCycleButton />

      {/* View Toggles — bonds/lattice are structure-modeler concepts, hidden in a scene */}
      {!inScene && (
        <>
          <Divider />
          <ToolButton
            active={showBonds}
            title="Toggle Bonds"
            icon={showBonds ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
            onClick={() => setShowBonds(!showBonds)}
            disabled={emptyStructure}
          />
          <CellDisplayCycleButton disabled={emptyStructure} />
        </>
      )}

      <Divider />

  {/* Selection Actions */}
  <ToolButton
  title="Focus on Selection (F)"
  icon={<Focus className="w-5 h-5" />}
  onClick={() => {
    focusOnAtoms(Array.from(selectedAtomIds))
  }}
  disabled={!hasAtomSelection}
  />
  <ToolButton
  title="Reset View (H)"
  icon={<Home className="w-5 h-5" />}
  onClick={() => {
    resetCameraToInitial()
  }}
  disabled={emptyStructure}
  />
      
      {/* Use stable showLockButtons because transient adaptive levels change during camera animation. */}
      {showLockButtons && (
        <>
          <Divider />
          <ToolButton
            title={useUltraLowMode 
              ? "Unlock Face (1st: Fast, 2nd: Detail)" 
              : "Lock Face to Detail Mode"}
            icon={<Lock className="w-5 h-5" />}
            onClick={lockSelectedFaceCells}
            disabled={!hasFaceSelection}
          />
          <ToolButton
            title="Clear All Locked Cells"
            icon={<Unlock className="w-5 h-5" />}
            onClick={clearDetailCells}
            disabled={!hasLockedCells}
          />
        </>
      )}

    </div>
  )
}
