/**
 * selection-transform-slice -- Live-preview and commit workflow for transforming selected atoms.
 *
 * Three preview types:
 *   - translationPreview: [dx, dy, dz] live offset while dragging the gizmo
 *   - rotationPreview: [rx, ry, rz] Euler rotation around selectionTransformOrigin
 *   - selectionRegionPreview: sphere/shell/cylinder/box selection-region visualization
 *
 * On gizmo release, applyTranslationPreview or applyRotationPreview commits to
 * atoms.cartesian and clears preview state. Translation and rotation are mutually exclusive;
 * applying either also clears the other.
 *
 * Cross-slice operations read atoms and selectedAtomIds, call pushHistory, and write atoms
 * plus local preview state.
 */

import * as THREE from 'three'
import type { StateCreator } from 'zustand'
import type { CrystalStore, SelectionRegionPreview } from '../crystal-store-types'
import { computeSelectionTransformOrigin, isNonZeroVector, type SelectionTransformMode } from '../../lib/selection-transform-preview'
import { recomputeBonds } from '../recompute-bonds'

export interface SelectionTransformSlice {
  selectionRegionPreview: SelectionRegionPreview | null
  setSelectionRegionPreview: (preview: SelectionRegionPreview | null) => void

  translationPreview: [number, number, number] | null
  setTranslationPreview: (delta: [number, number, number] | null) => void
  rotationPreview: [number, number, number] | null
  setRotationPreview: (delta: [number, number, number] | null) => void

  translateMode: boolean
  setTranslateMode: (mode: boolean) => void
  selectionTransformMode: SelectionTransformMode
  setSelectionTransformMode: (mode: SelectionTransformMode) => void
  selectionTransformOrigin: [number, number, number] | null
  setSelectionTransformOrigin: (origin: [number, number, number] | null) => void

  applyTranslationPreview: () => void
  applyRotationPreview: () => void

  /** True during Ctrl or Shift+Ctrl selection drags so camera controls lock OrbitControls
   *  and dragging transforms atoms instead of rotating the camera. Set by
   *  SelectionManipulationHandler while the modifier is held. */
  selectionManipActive: boolean
  setSelectionManipActive: (active: boolean) => void
}

export const createSelectionTransformSlice: StateCreator<CrystalStore, [], [], SelectionTransformSlice> = (set, get) => ({
  selectionRegionPreview: null,
  setSelectionRegionPreview: (preview) => set({ selectionRegionPreview: preview }),

  translationPreview: null,
  setTranslationPreview: (delta) => set({ translationPreview: delta }),
  rotationPreview: null,
  setRotationPreview: (delta) => set({ rotationPreview: delta }),

  translateMode: false,
  setTranslateMode: (mode) => set({ translateMode: mode }),
  selectionTransformMode: 'translate',
  setSelectionTransformMode: (mode) => set({ selectionTransformMode: mode }),
  selectionTransformOrigin: null,
  setSelectionTransformOrigin: (origin) => set({ selectionTransformOrigin: origin }),

  selectionManipActive: false,
  setSelectionManipActive: (active) => set({ selectionManipActive: active }),

  applyTranslationPreview: () => {
    const { translationPreview, selectedAtomIds, atoms, selectionTransformOrigin } = get()
    if (!translationPreview || selectedAtomIds.size === 0) return

    get().pushHistory()
    const [dx, dy, dz] = translationPreview
    const updatedAtoms = atoms.map(a => {
      if (!selectedAtomIds.has(a.id)) return a
      const pos = a.cartesian || a.position
      return {
        ...a,
        cartesian: [pos[0] + dx, pos[1] + dy, pos[2] + dz] as [number, number, number],
        position: [a.position[0] + dx, a.position[1] + dy, a.position[2] + dz] as [number, number, number],
      }
    })
    const updatedOrigin = selectionTransformOrigin
      ? [
          selectionTransformOrigin[0] + dx,
          selectionTransformOrigin[1] + dy,
          selectionTransformOrigin[2] + dz,
        ] as [number, number, number]
      : selectionTransformOrigin
    set({ atoms: updatedAtoms, translationPreview: null, rotationPreview: null, selectionTransformOrigin: updatedOrigin })
    get().syncBiomoleculeCoordinates(updatedAtoms)
    // Match merge placement: wrap periodic axes and extend non-periodic axes in one history transaction.
    get().applyBoundaryToAtoms(selectedAtomIds)
    // Refresh distance-based bond topology after geometry changes; otherwise moved selections
    // retain invalid long bonds across the cell. Centralizing this here covers gizmo, Ctrl drag,
    // translation panel, and whole-selection drag. Skip explicit PDB topology.
    if (!get().bioStructure) set({ bonds: recomputeBonds(get()) })
  },

  applyRotationPreview: () => {
    const { rotationPreview, selectedAtomIds, atoms, selectionTransformOrigin } = get()
    if (!isNonZeroVector(rotationPreview) || selectedAtomIds.size === 0) return

    // The pivot must match the preview. If absent, use the current selection centroid; rigid
    // rotation around a centroid preserves it, making this equivalent to the drag-start centroid.
    const origin = selectionTransformOrigin ?? computeSelectionTransformOrigin(atoms, selectedAtomIds)
    if (!origin) return

    get().pushHistory()

    const pivot = new THREE.Vector3(origin[0], origin[1], origin[2])
    const rotation = new THREE.Euler(rotationPreview[0], rotationPreview[1], rotationPreview[2], 'XYZ')

    const updatedAtoms = atoms.map((atom) => {
      if (!selectedAtomIds.has(atom.id) || !atom.cartesian) return atom

      const transformed = new THREE.Vector3(atom.cartesian[0], atom.cartesian[1], atom.cartesian[2])
      transformed.sub(pivot)
      transformed.applyEuler(rotation)
      transformed.add(pivot)

      return {
        ...atom,
        cartesian: [transformed.x, transformed.y, transformed.z] as [number, number, number],
        position: [transformed.x, transformed.y, transformed.z] as [number, number, number],
      }
    })

    set({
      atoms: updatedAtoms,
      rotationPreview: null,
      translationPreview: null,
      selectionTransformOrigin: origin,
    })
    get().syncBiomoleculeCoordinates(updatedAtoms)
    // Like translation, rotation can move atoms outside the cell. Apply boundary handling so
    // tile-images displayImage offsets do not become stale and shift copies outside the tiled region.
    // Keep this in the same history transaction.
    get().applyBoundaryToAtoms(selectedAtomIds)
    // As for translation, recompute distance-based bonds after geometry changes; skip explicit PDB topology.
    if (!get().bioStructure) set({ bonds: recomputeBonds(get()) })
  },
})
