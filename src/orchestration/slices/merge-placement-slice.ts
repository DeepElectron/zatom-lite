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
import { boundaryModeFor } from '../../lib/crystal/cell-overflow'

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
        // In 'fold-in' mode, wrap the heuristic initial anchor (for example maxZ + 3)
        // into the cell to avoid entering placement with an out-of-cell anchor.
        // Other modes preserve the anchor for WYSIWYG placement; tile-images wraps on commit.
        position: wrapAnchorIntoBox(
          initialPosition,
          get().latticeVectors,
          get().supercellParams,
          get().periodicDirs,
          get().periodic,
          get().cellOverflowMode === 'fold-in' ? 'wrap' : 'extend',
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
    // Do not wrap in 'grow-cell' or 'tile-images', which would teleport an out-of-cell ghost.
    const { latticeVectors, supercellParams, periodicDirs, periodic, cellOverflowMode } = get()
    // 'tile-images' also keeps the anchor unwrapped during placement. Data wraps on commit
    // through confirmMergePlacement -> analyzeMergeBoundary, so the ghost follows the cursor.
    const anchorMode = cellOverflowMode === 'fold-in' ? 'wrap' : 'extend'
    const anchor = wrapAnchorIntoBox(position, latticeVectors, supercellParams, periodicDirs, periodic, anchorMode)
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

    // Match preview feedback at commit: 'extend' grows the cell around the fragment at its
    // current position, while 'wrap' folds it back along periodic axes.
    const report = analyzeMergeBoundary(
      worldPositions,
      latticeVectors,
      supercellParams,
      periodicDirs,
      periodic,
      atoms.map((a) => (a.cartesian ?? a.position) as [number, number, number]),
      boundaryModeFor(get().cellOverflowMode),
    )

    // One history transaction captures the pre-merge state, including Base creation and cell growth.
    get().pushHistory()
    for (const { axis, newUnitLength } of report.extendAxes) {
      get().resizeLatticeAxis(axis, newUnitLength, false)
    }
    get().ensureBaseGroup('Base')
    const groupId = get().addGroupWithAtoms(
      current.name,
      current.atomOffsets.map(({ element }, i) => ({
        element,
        cartesian: report.finalPositions[i],
      })),
    )
    // Photoshop-style behavior: the new layer becomes active.
    set({ mergePlacement: null, activeGroupId: groupId })
  },

  cancelMergePlacement: () => {
    if (!get().mergePlacement) return
    set({ mergePlacement: null })
  },
})
