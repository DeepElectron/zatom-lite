/**
 * merge-placement-slice -- Interactive placement after dropping an Asset (XY -> Z -> confirm).
 *
 * A dropped structure remains a cursor-following ghost preview instead of becoming a
 * SceneObject. Confirmation merges it directly into the current structure through
 * structure-groups-slice and adds its child layer to the layer tree.
 *
 * Interaction rendered by merge-placement-preview.tsx:
 *   step 'xy': project the cursor onto a horizontal plane (+z normal), update x/y, click for 'z'
 *   step 'z': project onto a camera-facing vertical plane through the placement point,
 *             update only z, then click to confirm
 *   Esc cancels; Enter confirms immediately.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { GroupAtomInput } from './structure-groups-slice'
import { analyzeMergeBoundary, wrapAnchorIntoBox } from '../../lib/crystal/merge-boundary'

export interface MergePlacementState {
  name: string
  /** Atom offsets relative to the placement point (centroid). */
  atomOffsets: { element: string; offset: [number, number, number] }[]
  position: [number, number, number]
  step: 'xy' | 'z'
}

export interface MergePlacementSlice {
  /** null when no merge placement is active. */
  mergePlacement: MergePlacementState | null

  /** Start placement from world-space atoms, converting them to centroid-relative offsets. */
  startMergePlacement: (name: string, atomInputs: GroupAtomInput[], initialPosition: [number, number, number]) => void
  updateMergePlacementPosition: (position: [number, number, number]) => void
  setMergePlacementStep: (step: 'xy' | 'z') => void
  /** Confirm: pushHistory -> ensureBaseGroup -> addGroupWithAtoms -> activate the new child layer. */
  confirmMergePlacement: () => void
  cancelMergePlacement: () => void
}

export const createMergePlacementSlice: StateCreator<CrystalStore, [], [], MergePlacementSlice> = (set, get) => ({
  mergePlacement: null,

  startMergePlacement: (name, atomInputs, initialPosition) => {
    if (atomInputs.length === 0) return
    const centroid: [number, number, number] = [0, 0, 0]
    for (const input of atomInputs) {
      centroid[0] += input.cartesian[0]
      centroid[1] += input.cartesian[1]
      centroid[2] += input.cartesian[2]
    }
    centroid[0] /= atomInputs.length
    centroid[1] /= atomInputs.length
    centroid[2] /= atomInputs.length

    set({
      mergePlacement: {
        name,
        atomOffsets: atomInputs.map((input) => ({
          element: input.element,
          offset: [
            input.cartesian[0] - centroid[0],
            input.cartesian[1] - centroid[1],
            input.cartesian[2] - centroid[2],
          ],
        })),


        position: get().cellOverflowMode === 'tile-images' ? initialPosition : wrapAnchorIntoBox(
          initialPosition,
          get().latticeVectors,
          get().supercellParams,
          get().periodicDirs,
          get().periodic,
        ),
        step: 'xy',
      },
    })
  },

  updateMergePlacementPosition: (position) => {
    const current = get().mergePlacement
    if (!current) return
    // In 'fold-in', wrap the anchor along periodic axes just like individual atoms;
    // otherwise the cursor could remain outside while the molecule appears inside.
    // The wrapped position is the shared source of truth for preview, HUD, and commit.
    // Preserve the dragged image in tile-images mode so an outside ghost does not jump.
    const { latticeVectors, supercellParams, periodicDirs, periodic, cellOverflowMode } = get()


    const anchor = cellOverflowMode === 'tile-images' ? position
      : wrapAnchorIntoBox(position, latticeVectors, supercellParams, periodicDirs, periodic)
    set({ mergePlacement: { ...current, position: anchor } })
  },

  setMergePlacementStep: (step) => {
    const current = get().mergePlacement
    if (!current) return
    set({ mergePlacement: { ...current, step } })
  },

  confirmMergePlacement: () => {
    const current = get().mergePlacement
    if (!current) return

    const { latticeVectors, supercellParams, periodicDirs, periodic, atoms } = get()
    const worldPositions = current.atomOffsets.map(({ offset }) => [
      current.position[0] + offset[0],
      current.position[1] + offset[1],
      current.position[2] + offset[2],
    ] as [number, number, number])

    // In biological scenes, append a HETATM ligand component. Crystal groups have no
    // biological render path and would diverge from bioStructure topology. Biological
    // scenes are non-periodic, so lattice-boundary analysis and cell growth do not apply.
    if (get().bioStructure) {
      const appended = get().appendBioHetComponent(
        current.name,
        current.atomOffsets.map(({ element }, i) => ({ element, position: worldPositions[i] })),
      )
      // Preserve placement after failure (for example, exceeding the atom limit) so Esc can cancel.
      if (appended) set({ mergePlacement: null })
      return
    }

    // Keep every periodic axis fixed; only an open axis can receive vacuum padding.
    const report = analyzeMergeBoundary(
      worldPositions,
      latticeVectors,
      supercellParams,
      periodicDirs,
      periodic,
      atoms.map((a) => (a.cartesian ?? a.position) as [number, number, number]),
      )


    get().pushHistory()
    for (const { axis, newUnitLength } of report.extendAxes) {
      get().resizeLatticeAxis(axis, newUnitLength, false)
    }
    get().ensureBaseGroup('Base')
    const groupId = get().addGroupWithAtoms(
      current.name,
      current.atomOffsets.map(({ element }, i) => ({
        element,
        cartesian: worldPositions[i].map((value, axis) => value + report.shift[axis]) as [number, number, number],
      })),
    )
    // Canonicalize with the same rule as dragging, retaining Images offsets.
    get().applyBoundaryToAtoms(get().atoms.filter(atom => atom.groupId === groupId).map(atom => atom.id))

    set({ mergePlacement: null, activeGroupId: groupId })
  },

  cancelMergePlacement: () => {
    if (!get().mergePlacement) return
    set({ mergePlacement: null })
  },
})
