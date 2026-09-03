/**
 * selection-slice -- Atom, edge, face, and bond selection; hover and drag state;
 * selection modes; face-selection method; and context menu.
 *
 * The four selection types share parallel selected*Ids/hovered*Id state alongside
 * draggingAtomId, selectMode, faceSelectMethod, and context-menu state.
 *
 * setSelectMode clears all selections and box-selection state across slices.
 * setFaceSelectMethod clears the current face selection and, when appropriate, atom/edge selections.
 * Every select* action supports multiSelect toggling.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { FaceSelectMethod, SelectMode } from '../../lib/crystal/types'
import type { ActiveFeature } from '../../lib/geometry-snap-pick'
import { atomBelongsToGroup } from './structure-groups-slice'
import { pickRandomSubset } from '../../lib/crystal/random-subset'

function toggleSelection(current: ReadonlySet<string>, id: string, multiSelect: boolean): Set<string> {
  if (!multiSelect) {
    return current.size === 1 && current.has(id) ? new Set() : new Set([id])
  }

  const next = new Set(current)
  if (current.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export interface SelectionSlice {
  selectMode: SelectMode
  faceSelectMethod: FaceSelectMethod
  /** Sticky multi-select: while on, a plain left-click on an atom accumulates
   *  (toggles) the selection instead of replacing it — no Shift needed.
   *  Shift-click alone is not enough for "pick 3 atoms" style workflows on a
   *  trackpad, so the plane builder turns this on for its 3-atom pick step. */
  stickyMultiSelect: boolean
  selectedAtomIds: Set<string>
  selectedEdgeIds: Set<string>
  selectedFaceIds: Set<string>
  selectedBondIds: Set<string>
  hoveredAtomId: string | null
  hoveredEdgeId: string | null
  hoveredFaceId: string | null
  hoveredBondId: string | null
  draggingAtomId: string | null
  /** The atom's rendered world position when dragging starts. An unwrapped display may differ
   *  from stored Cartesian coordinates by a lattice vector; AtomDragHandler anchors its
   *  projection plane here and applies deltas so the atom follows the cursor exactly. */
  draggingAtomAnchor: [number, number, number] | null
  /** Geometric snap feature active during atom drag, used for viewport guides/highlights.
   *  Always null outside a drag; transient like draggingAtomId and never persisted. */
  dragSnapFeature: ActiveFeature | null
  setDragSnapFeature: (feature: ActiveFeature | null) => void
  contextMenuPosition: { x: number; y: number } | null
  contextMenuAtomIds: string[]

  setSelectMode: (mode: SelectMode) => void
  setFaceSelectMethod: (method: FaceSelectMethod) => void
  setStickyMultiSelect: (on: boolean) => void

  /** anchor is the click's **world position**. For a periodic image, selection still targets
   *  the source atom with the shared id, but geometry consumers must use the clicked image's
   *  position. Omit anchor to clear any old anchor for this id. */
  selectAtom: (atomId: string, multiSelect?: boolean, anchor?: [number, number, number]) => void
  deselectAtom: (atomId: string) => void
  /** id -> click world position for periodic-image picks; its lifetime follows the selection. */
  atomPickAnchors: ReadonlyMap<string, [number, number, number]>
  clearSelection: () => void
  selectAtoms: (atomIds: string[]) => void
  /** Narrow the selection to a reproducible random subset for defect modeling.
   *  The caller chooses the mutation: deletion creates vacancies; element replacement creates
   *  substitutions. Incrementing randomSubsetSeed makes repeated actions resample, while
   *  pickRandomSubset guarantees identical results for the same seed and selection. */
  narrowSelectionRandomly: (request: { count?: number; fraction?: number }) => void
  /** Seed used by the last random subselection; stored and incremented under undo/redo. */
  randomSubsetSeed: number
  setHoveredAtom: (atomId: string | null) => void
  setDraggingAtom: (atomId: string | null, anchor?: [number, number, number]) => void

  selectEdge: (edgeId: string, multiSelect?: boolean) => void
  clearEdgeSelection: () => void
  setHoveredEdge: (edgeId: string | null) => void

  selectFace: (faceId: string, multiSelect?: boolean) => void
  clearFaceSelection: () => void
  setHoveredFace: (faceId: string | null) => void

  selectBond: (bondId: string, multiSelect?: boolean) => void
  clearBondSelection: () => void
  setHoveredBond: (bondId: string | null) => void

  showContextMenu: (x: number, y: number, atomIds: string[]) => void
  hideContextMenu: () => void
}

export const createSelectionSlice: StateCreator<CrystalStore, [], [], SelectionSlice> = (set, get) => ({
  selectMode: 'atom',
  faceSelectMethod: 'direct',
  stickyMultiSelect: false,
  selectedAtomIds: new Set(),
  atomPickAnchors: new Map(),
  selectedEdgeIds: new Set(),
  selectedFaceIds: new Set(),
  selectedBondIds: new Set(),
  hoveredAtomId: null,
  hoveredEdgeId: null,
  hoveredFaceId: null,
  hoveredBondId: null,
  draggingAtomId: null,
  draggingAtomAnchor: null,
  dragSnapFeature: null,
  contextMenuPosition: null,
  contextMenuAtomIds: [],
  randomSubsetSeed: 1,

  setStickyMultiSelect: (on) => set({ stickyMultiSelect: on }),

  setSelectMode: (mode) => {
    // Changing mode clears all selections and box-selection state across slices.
    set({
      selectMode: mode,
      stickyMultiSelect: false,
      boxSelectModeEnabled: false,
      isBoxSelecting: false,
      boxStart: null,
      boxEnd: null,
    })
    set({ selectedAtomIds: new Set() })
    get().clearEdgeSelection()
    get().clearFaceSelection()
    get().clearBondSelection()
  },

  setFaceSelectMethod: (method) => {
    set({ faceSelectMethod: method })
    get().clearFaceSelection()
    // Non-direct methods build faces from atoms/edges; clear stale inputs when switching methods.
    if (method !== 'direct') {
      get().clearSelection()
      get().clearEdgeSelection()
    }
  },

  // —— Atom selection ——
  // With an active child layer, selection is restricted to that structure group.
  selectAtom: (atomId, multiSelect = false, anchor) => {
    const { activeGroupId, atoms, structureGroups, stickyMultiSelect } = get()
    if (activeGroupId !== null) {
      const atom = atoms.find((a) => a.id === atomId)
      if (atom && !atomBelongsToGroup(atom, activeGroupId, structureGroups)) return
    }
    // Sticky mode makes every atom click additive, so the callers (3D pickers)
    // only have to report the Shift modifier — one canonical decision point.
    const accumulate = multiSelect || stickyMultiSelect
    const nextIds = toggleSelection(get().selectedAtomIds, atomId, accumulate)
    // Keep anchors synchronized with selection: record an anchor for a retained image pick;
    // remove it when the id is deselected or the source atom is picked without an anchor.
    const anchors = new Map(get().atomPickAnchors)
    for (const id of anchors.keys()) if (!nextIds.has(id)) anchors.delete(id)
    if (nextIds.has(atomId)) {
      if (anchor) anchors.set(atomId, anchor)
      else anchors.delete(atomId)
    }
    set({ selectedAtomIds: nextIds, atomPickAnchors: anchors })
  },

  deselectAtom: (atomId) => {
    const selectedAtomIds = new Set(get().selectedAtomIds)
    selectedAtomIds.delete(atomId)
    const anchors = new Map(get().atomPickAnchors)
    anchors.delete(atomId)
    set({ selectedAtomIds, atomPickAnchors: anchors })
  },

  clearSelection: () => {
    // Clear selectedAtomIds only, not focusedAtomIds.
    // Only a double-click through clearFocusedAtoms clears focusedAtomIds.
    set({ selectedAtomIds: new Set(), atomPickAnchors: new Map() })
  },

  selectAtoms: (atomIds) => {
    const { activeGroupId, atoms, structureGroups } = get()
    let effectiveIds = atomIds
    if (activeGroupId !== null) {
      const groupAtomIds = new Set(
        atoms.filter((a) => atomBelongsToGroup(a, activeGroupId, structureGroups)).map((a) => a.id),
      )
      effectiveIds = atomIds.filter((id) => groupAtomIds.has(id))
    }
    const current = get().selectedAtomIds
    if (effectiveIds.length === current.size && effectiveIds.every((atomId) => current.has(atomId))) {
      return
    }
    // Bulk selection never originates from image picks; retain only anchors still selected.
    const keep = new Set(effectiveIds)
    const anchors = new Map(get().atomPickAnchors)
    for (const id of anchors.keys()) if (!keep.has(id)) anchors.delete(id)
    set({ selectedAtomIds: new Set(effectiveIds), atomPickAnchors: anchors })
  },

  narrowSelectionRandomly: (request) => {
    const { selectedAtomIds, randomSubsetSeed } = get()
    if (selectedAtomIds.size === 0) return

    const pool = [...selectedAtomIds]
    const subset = pickRandomSubset(pool, { ...request, seed: randomSubsetSeed })
    if (subset.length === 0 || subset.length === pool.length) {
      // If no proper subset can be drawn, preserve both selection and seed so an invisible
      // no-op does not alter the next draw.
      return
    }

    set({
      selectedAtomIds: new Set(subset),
      // Consume this seed so repeating the action draws again.
      randomSubsetSeed: randomSubsetSeed + 1,
    })
  },

  setHoveredAtom: (atomId) => set({ hoveredAtomId: atomId }),
  // Clear the snap preview when dragging ends so guides do not remain in the viewport.
  setDraggingAtom: (atomId, anchor) => set({
    draggingAtomId: atomId,
    draggingAtomAnchor: atomId ? (anchor ?? null) : null,
    ...(atomId ? {} : { dragSnapFeature: null }),
  }),
  setDragSnapFeature: (feature) => set({ dragSnapFeature: feature }),

  // —— Edge selection ——
  selectEdge: (edgeId, multiSelect = false) => {
    set({ selectedEdgeIds: toggleSelection(get().selectedEdgeIds, edgeId, multiSelect) })
  },
  clearEdgeSelection: () => set({ selectedEdgeIds: new Set() }),
  setHoveredEdge: (edgeId) => set({ hoveredEdgeId: edgeId }),

  // —— Face selection ——
  selectFace: (faceId, multiSelect = false) => {
    set({ selectedFaceIds: toggleSelection(get().selectedFaceIds, faceId, multiSelect) })
  },
  clearFaceSelection: () => set({ selectedFaceIds: new Set() }),
  setHoveredFace: (faceId) => set({ hoveredFaceId: faceId }),

  // —— Bond selection ——
  selectBond: (bondId, multiSelect = false) => {
    set({ selectedBondIds: toggleSelection(get().selectedBondIds, bondId, multiSelect) })
  },
  clearBondSelection: () => set({ selectedBondIds: new Set() }),
  setHoveredBond: (bondId) => set({ hoveredBondId: bondId }),

  // —— Context menu ——
  showContextMenu: (x, y, atomIds) => set({ contextMenuPosition: { x, y }, contextMenuAtomIds: atomIds }),
  hideContextMenu: () => set({ contextMenuPosition: null, contextMenuAtomIds: [] }),
})
