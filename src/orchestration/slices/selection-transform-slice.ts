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
import { bondsAfterPlacement, hasExplicitTopology } from './lattice-supercell-slice'
import { displayPositionOf } from '../../lib/crystal/cell-overflow'
import { cartesianToFractional } from '../../lib/crystal/lattice'
import { scaleLatticeVectorsForSupercell } from '../../lib/crystal/supercell-utils'
import { recomputeBonds } from '../recompute-bonds'

function transformedBonds(state: CrystalStore, atoms: CrystalStore['atoms']) {
  if (!hasExplicitTopology(state)) return recomputeBonds(state, { atoms })
  const box = scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams)
  const shown = state.atoms.map(atom => state.selectedAtomIds.has(atom.id) && state.cellOverflowMode === 'tile-images'
    ? { ...atom, cartesian: displayPositionOf(atom.cartesian ?? atom.position, atom.displayImage, state.latticeVectors) }
    : atom)
  const bonds = bondsAfterPlacement(state, shown, state.latticeVectors, box)
  return bondsAfterPlacement({ ...state, atoms: shown, bonds }, atoms, state.latticeVectors)
}

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
      const state = get()
      const pos = displayPositionOf(a.cartesian ?? a.position, state.cellOverflowMode === 'tile-images' ? a.displayImage : undefined, state.latticeVectors)
      return {
        ...a,
        cartesian: [pos[0] + dx, pos[1] + dy, pos[2] + dz] as [number, number, number],
        position: state.periodic ? cartesianToFractional([pos[0] + dx, pos[1] + dy, pos[2] + dz], scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams)) : [pos[0] + dx, pos[1] + dy, pos[2] + dz] as [number, number, number],
      }
    })
    const updatedOrigin = selectionTransformOrigin
      ? [
          selectionTransformOrigin[0] + dx,
          selectionTransformOrigin[1] + dy,
          selectionTransformOrigin[2] + dz,
        ] as [number, number, number]
      : selectionTransformOrigin
    set({ atoms: updatedAtoms, bonds: transformedBonds(get(), updatedAtoms), translationPreview: null, rotationPreview: null, selectionTransformOrigin: updatedOrigin })
    get().syncBiomoleculeCoordinates(updatedAtoms)

    get().applyBoundaryToAtoms(selectedAtomIds)

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

      const state = get()
      const shown = displayPositionOf(atom.cartesian, state.cellOverflowMode === 'tile-images' ? atom.displayImage : undefined, state.latticeVectors)
      const transformed = new THREE.Vector3(...shown)
      transformed.sub(pivot)
      transformed.applyEuler(rotation)
      transformed.add(pivot)

      return {
        ...atom,
        cartesian: [transformed.x, transformed.y, transformed.z] as [number, number, number],
        position: state.periodic ? cartesianToFractional([transformed.x, transformed.y, transformed.z], scaleLatticeVectorsForSupercell(state.latticeVectors, state.supercellParams)) : [transformed.x, transformed.y, transformed.z] as [number, number, number],
      }
    })

    set({
      atoms: updatedAtoms,
      bonds: transformedBonds(get(), updatedAtoms),
      rotationPreview: null,
      translationPreview: null,
      selectionTransformOrigin: origin,
    })
    get().syncBiomoleculeCoordinates(updatedAtoms)
    // Like translation, rotation can move atoms outside the cell. Apply boundary handling so
    // tile-images displayImage offsets do not become stale and shift copies outside the tiled region.
    // Keep this in the same history transaction.
    get().applyBoundaryToAtoms(selectedAtomIds)
  },
})
