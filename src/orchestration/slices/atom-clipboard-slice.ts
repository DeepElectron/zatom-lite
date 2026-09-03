/**
 * Atom-level copy and paste (Ctrl+C / Ctrl+V).
 *
 * - copySelectedAtoms: selected atoms → module clipboard (persists across structures)
 *   and XYZ text on the system clipboard.
 * - pasteClipboardAtoms: place offset copies in situ and select the new atoms so they
 *   can immediately be positioned with Ctrl+drag.
 *
 * Pasting follows addAtomToSupercell: pushHistory → clearBiomolecule → update
 * atoms → record userAddedAtomIds so supercell recomputation preserves them →
 * autoDetectBonds. Bonds are not copied; autoDetectBonds rebuilds them from geometry,
 * matching the add-atom path and avoiding invalid bond IDs across structures.
 */

import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { Atom } from '../../lib/crystal/types'
import { generateAtomId } from '../../lib/crystal/supercell-utils'
import { latticeParamsFromMatrix } from '../../lib/crystal/lattice'
import { MIN_VACUUM_A } from '../../lib/analysis/builders/adsorbate'
import {
  computeVacuumNeed,
  graftFragment,
  type GraftAtom,
} from '../../lib/molecule/graft-fragment'
import {
  formatFragmentAsXyz,
  getClipboardFragment,
  isSelfWrittenText,
  markSelfWrittenText,
  nextPasteOffset,
  parseXyzFragment,
  setClipboardFragment,
  type ClipboardFragment,
} from '../../lib/atom-clipboard'

/** Placement details returned by pasteAttachedToSelection. */
export interface AttachedPasteResult {
  /** Number of atoms placed. */
  count: number
  /** Final distance between the contacting atom pair (Å). */
  bondLength: number
  /** Extra distance pushed outward to eliminate collisions (Å). */
  pushedOut: number
  /** Vacuum added along the surface normal (Å); 0 means the cell was unchanged. */
  vacuumAddedA: number
}

export interface AtomClipboardSlice {
  /** Copy selected atoms; returns the count copied, or 0 for no selection. */
  copySelectedAtoms: () => number
  /**
   * Paste a clipboard fragment. Optional external XYZ text comes from the system
   * clipboard; otherwise use the internal clipboard. Returns the number pasted, or 0.
   */
  pasteClipboardAtoms: (externalXyz?: string | null) => number
  /**
   * Attach the clipboard fragment to the current selection along an exposed/free-valence
   * direction at the ideal bond length, pushing farther in that direction on collision.
   * For an existing slab with vacuum, extend the vacuum to avoid touching a periodic
   * image. Returns null for no selection or an empty clipboard so callers can paste normally.
   */
  pasteAttachedToSelection: () => AttachedPasteResult | null
}

export const createAtomClipboardSlice: StateCreator<CrystalStore, [], [], AtomClipboardSlice> = (
  set,
  get,
) => ({
  copySelectedAtoms: () => {
    const { atoms, selectedAtomIds } = get()
    if (selectedAtomIds.size === 0) return 0

    const picked = atoms.filter((a) => selectedAtomIds.has(a.id) && a.cartesian)
    if (picked.length === 0) return 0

    const fragment: ClipboardFragment = {
      atoms: picked.map((a) => ({
        element: a.element,
        cartesian: [a.cartesian![0], a.cartesian![1], a.cartesian![2]] as [number, number, number],
      })),
    }
    setClipboardFragment(fragment)

    // Write XYZ to the system clipboard for external editors. Failure does not affect
    // the internal clipboard; navigator.clipboard rejects without a secure context or permission.
    const xyz = formatFragmentAsXyz(fragment)
    // Mark self-written text so reading it through Ctrl+V uses the internal fragment
    // and increasing offset instead of overlapping the source at zero offset.
    markSelfWrittenText(xyz)
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(xyz).catch(() => undefined)
    }

    return fragment.atoms.length
  },

  pasteClipboardAtoms: (externalXyz) => {
    // Prefer external XYZ because the user may have copied coordinates elsewhere; fall
    // back internally on parse failure. Treat self-written text as an internal paste so
    // increasing offsets prevent the copy from overlapping the source.
    const treatAsExternal = !!externalXyz && !isSelfWrittenText(externalXyz)
    const external = treatAsExternal ? parseXyzFragment(externalXyz!) : null
    const fragment = external ?? getClipboardFragment()
    if (!fragment || fragment.atoms.length === 0) return 0

    get().pushHistory()
    get().clearBiomolecule()

    // External text uses its target coordinates unchanged. Internal fragments receive
    // increasing offsets so repeated Ctrl+V operations do not overlap.
    const offset = external ? ([0, 0, 0] as [number, number, number]) : nextPasteOffset()
    const activeGroupId = get().activeGroupId

    const newAtoms: Atom[] = fragment.atoms.map((a) => {
      const cartesian: [number, number, number] = [
        a.cartesian[0] + offset[0],
        a.cartesian[1] + offset[1],
        a.cartesian[2] + offset[2],
      ]
      return {
        id: generateAtomId(),
        element: a.element,
        // Match addAtomToSupercell: the supercell path stores Cartesian coordinates in position.
        position: cartesian,
        cartesian,
        ...(activeGroupId !== null ? { groupId: activeGroupId } : {}),
      }
    })

    const wasEmpty = get().atoms.length === 0
    const userAddedAtomIds = new Set(get().userAddedAtomIds)
    for (const a of newAtoms) userAddedAtomIds.add(a.id)

    set({ atoms: [...get().atoms, ...newAtoms], userAddedAtomIds })

    // Select newly pasted atoms so they can be positioned immediately.
    get().selectAtoms(newAtoms.map((a) => a.id))

    if (wasEmpty) get().triggerCameraAutoReset()
    setTimeout(() => {
      get().autoDetectBonds()
    }, 0)

    return newAtoms.length
  },

  pasteAttachedToSelection: () => {
    const fragment = getClipboardFragment()
    if (!fragment || fragment.atoms.length === 0) return null

    const { atoms, selectedAtomIds, latticeVectors, supercellParams } = get()
    if (selectedAtomIds.size === 0) return null

    const toGraftAtom = (a: { element: string; cartesian?: number[] | null }): GraftAtom => ({
      element: a.element,
      cartesian: [a.cartesian![0], a.cartesian![1], a.cartesian![2]],
    })

    const hostAtoms = atoms.filter((a) => a.cartesian).map(toGraftAtom)
    const anchorAtoms = atoms
      .filter((a) => selectedAtomIds.has(a.id) && a.cartesian)
      .map(toGraftAtom)
    if (anchorAtoms.length === 0) return null

    // Fall back to the a×b surface normal, which points outward for a slab and respects
    // its orientation better than +z when geometry cannot determine a direction.
    let fallbackDirection: [number, number, number] | undefined
    if (latticeVectors) {
      const [ax, ay, az] = latticeVectors.a
      const [bx, by, bz] = latticeVectors.b
      fallbackDirection = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
    }

    const graft = graftFragment({
      fragment: fragment.atoms.map((a) => ({ element: a.element, cartesian: a.cartesian })),
      hostAtoms,
      anchorAtoms,
      fallbackDirection,
    })
    if (!graft) return null

    get().pushHistory()
    get().clearBiomolecule()

    const activeGroupId = get().activeGroupId
    const newAtoms: Atom[] = graft.cartesians.map((cartesian, i) => ({
      id: generateAtomId(),
      element: fragment.atoms[i].element,
      // Match addAtomToSupercell and pasteClipboardAtoms: the supercell path stores
      // Cartesian coordinates in position.
      position: cartesian,
      cartesian,
      ...(activeGroupId !== null ? { groupId: activeGroupId } : {}),
    }))

    // Add vacuum only to structures that already have it. Never alter a 3D-periodic
    // bulk cell: grafting there may intentionally create an interstitial or substitution,
    // while adding vacuum would unexpectedly turn the bulk structure into a slab.
    let vacuumAddedA = 0
    let latticePatch: { latticeVectors: typeof latticeVectors; latticeParams: unknown } | null = null
    if (latticeVectors) {
      const nx = Math.max(1, supercellParams?.nx ?? 1)
      const ny = Math.max(1, supercellParams?.ny ?? 1)
      const nz = Math.max(1, supercellParams?.nz ?? 1)
      const cellRows: [[number, number, number], [number, number, number], [number, number, number]] = [
        [latticeVectors.a[0] * nx, latticeVectors.a[1] * nx, latticeVectors.a[2] * nx],
        [latticeVectors.b[0] * ny, latticeVectors.b[1] * ny, latticeVectors.b[2] * ny],
        [latticeVectors.c[0] * nz, latticeVectors.c[1] * nz, latticeVectors.c[2] * nz],
      ]

      const hostNeed = computeVacuumNeed({
        atomCartesians: hostAtoms.map((h) => h.cartesian),
        cellRows,
        vacuumA: MIN_VACUUM_A,
      })

      if (hostNeed && hostNeed.currentVacuumA >= MIN_VACUUM_A) {
        // Preserve the host's existing vacuum instead of imposing a fixed 10 Å target;
        // grafting should neither reduce configured vacuum nor enlarge the cell needlessly.
        const target = hostNeed.currentVacuumA
        const need = computeVacuumNeed({
          atomCartesians: [...hostAtoms.map((h) => h.cartesian), ...graft.cartesians],
          cellRows,
          vacuumA: target,
        })
        if (need && need.scaleC > 1) {
          const nextC: [number, number, number] = [
            latticeVectors.c[0] * need.scaleC,
            latticeVectors.c[1] * need.scaleC,
            latticeVectors.c[2] * need.scaleC,
          ]
          const params = latticeParamsFromMatrix([latticeVectors.a, latticeVectors.b, nextC])
          if (params) {
            vacuumAddedA = target - need.currentVacuumA
            latticePatch = { latticeVectors: { ...latticeVectors, c: nextC }, latticeParams: params }
          }
        }
      }
    }

    const userAddedAtomIds = new Set(get().userAddedAtomIds)
    for (const a of newAtoms) userAddedAtomIds.add(a.id)

    // Adding vacuum enlarges only the box and does not scale atom coordinates. Unlike
    // setLatticeParam's scaleContents path, these atoms must remain fixed in Cartesian space.
    set({
      atoms: [...get().atoms, ...newAtoms],
      userAddedAtomIds,
      ...(latticePatch ?? {}),
    } as Parameters<typeof set>[0])

    get().selectAtoms(newAtoms.map((a) => a.id))
    setTimeout(() => {
      get().autoDetectBonds()
    }, 0)

    return {
      count: newAtoms.length,
      bondLength: graft.bondLength,
      pushedOut: graft.pushedOut,
      vacuumAddedA,
    }
  },
})
