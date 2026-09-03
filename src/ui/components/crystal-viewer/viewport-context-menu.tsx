"use client"

/**
 * Right-click menu for the 3D viewport.
 *
 * This closes a dead end: selection-box.tsx already captured `contextmenu` and
 * wrote `contextMenuPosition` / `contextMenuAtomIds` into the store, but nothing
 * ever rendered them — so right-clicking an atom swallowed the browser menu and
 * showed nothing. `replaceSelectedAtoms` (atom-bond-crud-slice) reads
 * `contextMenuAtomIds` and had no entry point at all; the element submenu below
 * is that entry point.
 *
 * The selection verbs (Add Neighbors / Add Fragment / Invert) used to hang off a
 * right-click on the Box Select *button* in the bottom toolbar. They operate on
 * the selected atoms, not on that button, so they live here now — next to the
 * thing they act on, which is the entire point of a context menu.
 *
 * Menu contents are derived from what is actually selected: verbs that need a
 * selection are absent (not greyed) when there is none, so the menu stays short
 * and every visible row is actionable. The LABEL row states the operand, because
 * "Delete" with no stated target is a guess.
 */

import { useCallback, useMemo, useRef } from "react"
import {
  ClipboardPaste,
  Combine,
  Copy,
  Crosshair,
  Dices,
  FileUp,
  FoldVertical,
  Focus,
  Lock,
  MapPin,
  Move3d,
  Network,
  Redo2,
  Replace,
  RotateCcw,
  Scan,
  Trash2,
  Undo2,
  Unlock,
  Users,
  XCircle,
} from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../../orchestration/ViewportContext"
import {
  importUnifiedStructureFile,
  UNIFIED_IMPORT_ACCEPT,
} from "../../../services/unified-file-import"
import { useStructureAssetRecorder } from "../../structure-asset-context"
import { getClipboardFragment } from "../../../lib/atom-clipboard"
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../ui-kit/context-menu"

/**
 * Substitution candidates. Deliberately short: a full periodic table belongs in
 * the Inspector, and a context menu that needs scrolling has stopped being one.
 * These are the elements that actually get swapped during editing.
 */
const REPLACE_ELEMENTS = ["H", "C", "N", "O", "F", "Si", "P", "S", "Cl", "Fe"] as const

/** Defect concentrations that actually get used in practice — dilute limit first.
 *  Anything above 50% is better expressed as "invert, then narrow the rest". */
const RANDOM_SUBSET_FRACTIONS = [
  { label: "1%", fraction: 0.01 },
  { label: "5%", fraction: 0.05 },
  { label: "10%", fraction: 0.1 },
  { label: "25%", fraction: 0.25 },
  { label: "50%", fraction: 0.5 },
] as const

/**
 * Undo / redo.
 *
 * Present because this menu is where destructive edits are issued (Delete,
 * Replace element, Attach): after one of those the next gesture is almost always
 * to take it back, and requiring the user to travel to the top-bar buttons for
 * that breaks the loop the menu just started.
 *
 * A child component for the same reason as ClipboardSection — it must read
 * history depth at open time, not at the parent's last render.
 */
function HistorySection() {
  const undo = useCrystalStore((s) => s.undo)
  const redo = useCrystalStore((s) => s.redo)
  const canUndo = useCrystalStore((s) => s.canUndo())
  const canRedo = useCrystalStore((s) => s.canRedo())

  // Absent, not greyed, when there is no history at all: a menu that opens with
  // two dead rows on a fresh structure reads as broken.
  if (!canUndo && !canRedo) return null

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Undo2 />} shortcut="Ctrl+Z" disabled={!canUndo} onSelect={undo}>
        Undo
      </ContextMenuItem>
      <ContextMenuItem icon={<Redo2 />} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onSelect={redo}>
        Redo
      </ContextMenuItem>
    </>
  )
}

/**
 * Whole-structure placement verbs (wrap / center / align).
 *
 * Kept apart from the view toggles below it: those change how the structure is
 * drawn, these move atoms and push history. Grouping them together would put a
 * destructive verb one row away from a harmless checkbox.
 */
function PlacementSection({ selectedCount }: { selectedCount: number }) {
  const atomCount = useCrystalStore((s) => s.atoms.length)
  const periodic = useCrystalStore((s) => s.periodic)
  const periodicDirs = useCrystalStore((s) => s.periodicDirs)
  const wrapAllAtomsIntoCell = useCrystalStore((s) => s.wrapAllAtomsIntoCell)
  const centerStructureInCell = useCrystalStore((s) => s.centerStructureInCell)
  const centerStructureAtOrigin = useCrystalStore((s) => s.centerStructureAtOrigin)
  const alignSelectionToAxis = useCrystalStore((s) => s.alignSelectionToAxis)

  if (atomCount === 0) return null

  // Wrapping only means anything along a periodic axis; with all three off there
  // is no cell to fold back into.
  const anyPeriodicAxis = periodicDirs.a || periodicDirs.b || periodicDirs.c
  // Rotating atoms while the lattice stays put breaks periodicity, so aligning
  // is a molecular-mode verb only.
  const canAlign = !periodic && selectedCount === 2

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuLabel>Placement</ContextMenuLabel>
      <ContextMenuItem
        icon={<FoldVertical />}
        disabled={!anyPeriodicAxis}
        onSelect={() => {
          wrapAllAtomsIntoCell()
        }}
      >
        Wrap into cell
      </ContextMenuItem>
      <ContextMenuItem
        icon={<Crosshair />}
        onSelect={() => {
          if (periodic) centerStructureInCell()
          else centerStructureAtOrigin()
        }}
      >
        {periodic ? "Center in cell" : "Center at origin"}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<Move3d />} disabled={!canAlign}>
          Align selection to axis
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {(["x", "y", "z"] as const).map((axis) => (
            <ContextMenuItem
              key={axis}
              onSelect={() => {
                alignSelectionToAxis(axis)
              }}
            >
              {axis.toUpperCase()} axis
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  )
}

/**
 * Adsorbate fragments offered inline. The same keys the Adsorbate panel uses, so
 * picking one here and then opening the panel shows the same fragment selected —
 * this menu is a shortcut into that tool, not a second, diverging one.
 */
const ADSORBATE_FRAGMENTS = ["H", "O", "OH", "H2O", "CO", "CO2", "NH3", "CH3"] as const

/**
 * Adsorption verbs for the current selection.
 *
 * A 1/2/3-atom selection *is* an adsorption site (top / bridge / hollow) — that
 * is exactly the operand `siteFromManualSelection` takes. Before this, acting on
 * it meant travelling to the Adsorbate panel and re-deriving a site the user had
 * already picked in the viewport, so the verb now sits next to its operand.
 *
 * A child component so it reads placement state at open time; see the note on
 * ClipboardSection.
 */
function AdsorptionSection({ selectedCount }: { selectedCount: number }) {
  const setAdsorbateFragment = useCrystalStore((s) => s.setAdsorbateFragment)
  const placeFragmentAtManualSelection = useCrystalStore((s) => s.placeFragmentAtManualSelection)
  const clickPlace = useCrystalStore((s) => s.adsorbateClickPlace)
  const setClickPlace = useCrystalStore((s) => s.setAdsorbateClickPlace)

  // 4+ atoms has no site interpretation (siteFromManualSelection returns null),
  // so the section is absent rather than offering a verb that cannot fire.
  const siteKind =
    selectedCount === 1 ? "top" : selectedCount === 2 ? "bridge" : selectedCount === 3 ? "hollow" : null
  if (!siteKind) return null

  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuLabel>{`Adsorption \u00B7 ${siteKind} site`}</ContextMenuLabel>
      <ContextMenuSub>
        <ContextMenuSubTrigger icon={<MapPin />}>Adsorb here</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuLabel>{`Placed at the ${siteKind} site`}</ContextMenuLabel>
          {ADSORBATE_FRAGMENTS.map((key) => (
            <ContextMenuItem
              key={key}
              onSelect={() => {
                // Sync the panel's fragment first so the two views never disagree
                // about what was just placed.
                setAdsorbateFragment(key)
                void placeFragmentAtManualSelection()
              }}
            >
              {key}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuCheckboxItem checked={clickPlace} onCheckedChange={setClickPlace}>
        Click to place
      </ContextMenuCheckboxItem>
    </>
  )
}

/**
 * Clipboard verbs.
 *
 * Deliberately a child component rather than inline JSX: ContextMenuContent has
 * no forceMount, so Radix mounts its children only while the menu is open, and
 * this body therefore runs at open time. Reading the module-level clipboard in
 * the parent body instead would latch a stale value — Ctrl+C touches no store
 * selector, so the parent never re-renders between a copy and the next
 * right-click, and "Paste" would stay hidden right after copying.
 */
function ClipboardSection({ hasSelection, inScene }: { hasSelection: boolean; inScene: boolean }) {
  const copySelectedAtoms = useCrystalStore((s) => s.copySelectedAtoms)
  const pasteClipboardAtoms = useCrystalStore((s) => s.pasteClipboardAtoms)
  const pasteAttachedToSelection = useCrystalStore((s) => s.pasteAttachedToSelection)

  const clipboardCount = getClipboardFragment()?.atoms.length ?? 0
  // Pasting is a structure-editing verb; an assembly scene owns its own contents.
  const canPaste = clipboardCount > 0 && !inScene
  if (!hasSelection && !canPaste) return null

  const atomWord = clipboardCount === 1 ? "atom" : "atoms"

  return (
    <>
      {hasSelection ? (
        <ContextMenuItem
          icon={<Copy />}
          shortcut="Ctrl+C"
          onSelect={() => {
            copySelectedAtoms()
          }}
        >
          Copy selection
        </ContextMenuItem>
      ) : null}

      {canPaste && hasSelection ? (
        <ContextMenuItem
          icon={<Combine />}
          shortcut="Ctrl+Shift+V"
          onSelect={() => {
            pasteAttachedToSelection()
          }}
        >
          {`Attach ${clipboardCount} ${atomWord} here`}
        </ContextMenuItem>
      ) : null}

      {canPaste ? (
        <ContextMenuItem
          icon={<ClipboardPaste />}
          shortcut="Ctrl+V"
          onSelect={() => {
            pasteClipboardAtoms()
          }}
        >
          {`Paste ${clipboardCount} ${atomWord}`}
        </ContextMenuItem>
      ) : null}

      <ContextMenuSeparator />
    </>
  )
}

export function ViewportContextMenu({ children }: { children: React.ReactNode }) {
  const atoms = useCrystalStore((s) => s.atoms)
  const bonds = useCrystalStore((s) => s.bonds)
  const selectedAtomIds = useCrystalStore((s) => s.selectedAtomIds)
  const selectAtoms = useCrystalStore((s) => s.selectAtoms)
  const clearSelection = useCrystalStore((s) => s.clearSelection)
  const focusOnAtoms = useCrystalStore((s) => s.focusOnAtoms)
  const resetCameraToInitial = useCrystalStore((s) => s.resetCameraToInitial)
  const deleteSelectedAtoms = useCrystalStore((s) => s.deleteSelectedAtoms)
  const replaceSelectedAtoms = useCrystalStore((s) => s.replaceSelectedAtoms)
  const narrowSelectionRandomly = useCrystalStore((s) => s.narrowSelectionRandomly)
  const toggleSelectedFixed = useCrystalStore((s) => s.toggleSelectedFixed)
  const clearAllFixed = useCrystalStore((s) => s.clearAllFixed)
  const fixedCount = useCrystalStore((s) => s.atoms.reduce((n, a) => n + (a.fixed ? 1 : 0), 0))
  const showBonds = useCrystalStore((s) => s.showBonds)
  const setShowBonds = useCrystalStore((s) => s.setShowBonds)
  const showLattice = useCrystalStore((s) => s.showLattice)
  const setShowLattice = useCrystalStore((s) => s.setShowLattice)
  const isPeriodic = useCrystalStore((s) => !!s.latticeVectors)
  // Structure-editing verbs are meaningless while an assembly scene owns the viewport.
  const inScene = useCrystalStore((s) => !!s.activeSceneId)

  const selectedCount = selectedAtomIds.size
  const hasSelection = selectedCount > 0

  /**
   * On an empty viewport the only verb worth offering is "open a file", but the
   * menu used to show just a disabled Select all. The input lives outside
   * ContextMenuContent because that subtree unmounts as soon as the menu
   * closes, which would drop the picker's change event on the floor.
   */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordStructureAsset = useStructureAssetRecorder()
  const handleImportFile = useCallback(
    async (file: File) => {
      try {
        const result = await importUnifiedStructureFile(file)
        if (result.success) {
          recordStructureAsset(file.name, "import")
        } else {
          console.warn("[file-import]", result.error)
        }
      } catch (error) {
        console.warn("[file-import]", error)
      }
    },
    [recordStructureAsset],
  )

  /**
   * Bonded neighbours one step out. Built per open rather than memoised across
   * renders because `bonds` identity already changes on every structural edit.
   */
  const addNeighbors = () => {
    const next = new Set(selectedAtomIds)
    for (const bond of bonds) {
      if (selectedAtomIds.has(bond.atom1Id)) next.add(bond.atom2Id)
      if (selectedAtomIds.has(bond.atom2Id)) next.add(bond.atom1Id)
    }
    selectAtoms(Array.from(next))
  }

  /** Flood-fill the whole bonded component(s) touching the selection. */
  const addFragment = () => {
    const next = new Set(selectedAtomIds)
    let grew = true
    while (grew) {
      grew = false
      for (const bond of bonds) {
        if (next.has(bond.atom1Id) && !next.has(bond.atom2Id)) {
          next.add(bond.atom2Id)
          grew = true
        }
        if (next.has(bond.atom2Id) && !next.has(bond.atom1Id)) {
          next.add(bond.atom1Id)
          grew = true
        }
      }
    }
    selectAtoms(Array.from(next))
  }

  const invertSelection = () => {
    selectAtoms(atoms.filter((a) => !selectedAtomIds.has(a.id)).map((a) => a.id))
  }

  const selectAll = () => {
    selectAtoms(atoms.map((a) => a.id))
  }

  /** Element symbols present in the selection — used to label the submenu. */
  const selectedElements = useMemo(() => {
    if (!hasSelection) return [] as string[]
    const seen = new Set<string>()
    for (const a of atoms) if (selectedAtomIds.has(a.id)) seen.add(a.element)
    return Array.from(seen)
  }, [atoms, selectedAtomIds, hasSelection])

  const selectionAllFixed = useMemo(() => {
    if (!hasSelection) return false
    for (const a of atoms) {
      if (!selectedAtomIds.has(a.id)) continue
      if (a.fixed?.every(Boolean) !== true) return false
    }
    return true
  }, [atoms, selectedAtomIds, hasSelection])

  const operandLabel = hasSelection
    ? selectedCount === 1
      ? `1 atom${selectedElements[0] ? ` \u00B7 ${selectedElements[0]}` : ""}`
      : `${selectedCount} atoms${selectedElements.length === 1 ? ` \u00B7 ${selectedElements[0]}` : ""}`
    : `${atoms.length} atoms \u00B7 none selected`

  return (
    <ContextMenuRoot>
      <input
        ref={fileInputRef}
        type="file"
        accept={UNIFIED_IMPORT_ACCEPT}
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImportFile(file)
          event.target.value = ""
        }}
      />
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{operandLabel}</ContextMenuLabel>

        {hasSelection ? (
          <>
            <ContextMenuItem icon={<Focus />} shortcut="F" onSelect={() => {
              focusOnAtoms(Array.from(selectedAtomIds))
            }}>
              Focus on selection
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ClipboardSection hasSelection inScene={inScene} />

            <ContextMenuItem icon={<Users />} onSelect={addNeighbors}>
              Grow to neighbors
            </ContextMenuItem>
            <ContextMenuItem icon={<Network />} onSelect={addFragment}>
              Grow to fragment
            </ContextMenuItem>
            <ContextMenuItem icon={<Scan />} onSelect={invertSelection}>
              Invert selection
            </ContextMenuItem>
            <ContextMenuSub>
              {/* Narrowing the selection to a reproducible random subset is the
                  missing half of defect building: the write operations (delete =
                  vacancy, replace element = substitution) already exist right in
                  this menu, but there was no way to say "5% of these, at random,
                  same atoms every time". Disabled below 2 atoms because a single
                  atom has no proper subset. */}
              <ContextMenuSubTrigger icon={<Dices />} disabled={selectedCount < 2}>
                Random subset
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuLabel>Then delete = vacancy, replace = substitution</ContextMenuLabel>
                {RANDOM_SUBSET_FRACTIONS.map(({ label, fraction }) => (
                  <ContextMenuItem
                    key={label}
                    onSelect={() => {
                      narrowSelectionRandomly({ fraction })
                    }}
                  >
                    {label} of selection
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem icon={<XCircle />} shortcut="Esc" onSelect={clearSelection}>
              Clear selection
            </ContextMenuItem>

            {!inScene && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={selectionAllFixed ? <Unlock /> : <Lock />}
                  onSelect={() => {
                    toggleSelectedFixed()
                  }}
                >
                  {selectionAllFixed
                    ? `Unfix ${selectedCount === 1 ? "atom" : `${selectedCount} atoms`}`
                    : `Fix ${selectedCount === 1 ? "atom" : `${selectedCount} atoms`}`}
                </ContextMenuItem>

                <ContextMenuSub>
                  <ContextMenuSubTrigger icon={<Replace />}>Replace element</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {REPLACE_ELEMENTS.map((el) => (
                      <ContextMenuItem
                        key={el}
                        // Replacing an element with itself is a no-op that still
                        // pushes a history entry, so it is disabled.
                        disabled={selectedElements.length === 1 && selectedElements[0] === el}
                        onSelect={() => {
                          replaceSelectedAtoms(el)
                        }}
                      >
                        {el}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>

                <ContextMenuSeparator />
                <ContextMenuItem
                  icon={<Trash2 />}
                  shortcut="Del"
                  destructive
                  onSelect={() => {
                    deleteSelectedAtoms()
                  }}
                >
                  {selectedCount === 1 ? "Delete atom" : `Delete ${selectedCount} atoms`}
                </ContextMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            {atoms.length === 0 && !inScene && (
              <ContextMenuItem
                icon={<FileUp />}
                onSelect={() => fileInputRef.current?.click()}
              >
                Import file…
              </ContextMenuItem>
            )}
            <ContextMenuItem icon={<Scan />} disabled={atoms.length === 0} onSelect={selectAll}>
              Select all
            </ContextMenuItem>
            {/* Constraints can be cleared without first creating a selection. */}
            {!inScene && fixedCount > 0 && (
              <ContextMenuItem
                icon={<Unlock />}
                onSelect={() => {
                  clearAllFixed()
                }}
              >
                {`Unfix all (${fixedCount})`}
              </ContextMenuItem>
            )}
          </>
        )}

        {!hasSelection ? <ClipboardSection hasSelection={false} inScene={inScene} /> : null}

        {hasSelection && !inScene ? <AdsorptionSection selectedCount={selectedCount} /> : null}

        <PlacementSection selectedCount={selectedCount} />

        <HistorySection />

        {/*
          View state is independent of selection, so these stay in both branches.
          They used to render only when nothing was selected, which meant the unit
          cell could not be toggled without first clearing the selection.
        */}
        <ContextMenuSeparator />
        {!inScene && (
          <ContextMenuCheckboxItem checked={showBonds} onCheckedChange={setShowBonds}>
            Bonds
          </ContextMenuCheckboxItem>
        )}
        {!inScene && (
          <ContextMenuCheckboxItem
            checked={showLattice}
            disabled={!isPeriodic}
            onCheckedChange={setShowLattice}
          >
            Unit cell
          </ContextMenuCheckboxItem>
        )}
        <ContextMenuItem icon={<RotateCcw />} shortcut="H" onSelect={() => {
          resetCameraToInitial()
        }}>
          Reset view
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  )
}
