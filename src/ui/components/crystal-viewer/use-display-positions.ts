/**
 * Canonical render-only atom positions. Explicit tile-image shifts are applied
 * before whole-molecule unwrapping; reversing that order would unwrap from the
 * wrong image. A reference-keyed ring cache keeps per-atom and per-bond callers
 * from turning the O(N) traversal into O(N²) work.
 */
import { useMemo } from 'react'
import type { Atom, Bond } from '../../../lib/crystal/types'
import type { LatticeLike, PeriodicMask, Vec3 } from '../../../lib/crystal/lattice-math'
import { isValidLattice, latticeShift } from '../../../lib/crystal/lattice-math'
import { computeUnwrappedDisplayPositions } from '../../../lib/molecule/unwrap-molecules'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'

export function useDisplayPositions(atoms: Atom[], bonds: Bond[]): Map<string, Vec3> | null {
  const cellOverflowMode = useCrystalStore((s) => s.cellOverflowMode)
  const wholeMolecules = useCrystalStore((s) => s.wholeMolecules)
  const periodic = useCrystalStore((s) => s.periodic)
  const latticeVectors = useCrystalStore((s) => s.latticeVectors)
  const periodicDirs = useCrystalStore((s) => s.periodicDirs)
  const draggingAtomId = useCrystalStore((s) => s.draggingAtomId)

  return useMemo(
    () =>
      lookupDisplayPositions({
        atoms,
        bonds,
        cellOverflowMode,
        wholeMolecules,
        periodic,
        latticeVectors,
        periodicDirs,
        draggingAtomId,
      }),
    [
      cellOverflowMode,
      wholeMolecules,
      periodic,
      latticeVectors,
      periodicDirs,
      draggingAtomId,
      atoms,
      bonds,
    ],
  )
}

interface DisplayPositionInputs {
  atoms: Atom[]
  bonds: Bond[]
  cellOverflowMode: string
  wholeMolecules: boolean
  periodic: boolean
  latticeVectors: LatticeLike | null | undefined
  periodicDirs: PeriodicMask
  draggingAtomId: string | null
}

const CACHE_CAPACITY = 4
const cache: Array<{ key: DisplayPositionInputs; result: Map<string, Vec3> | null }> = []

function sameInputs(a: DisplayPositionInputs, b: DisplayPositionInputs): boolean {
  return (
    a.atoms === b.atoms &&
    a.bonds === b.bonds &&
    a.cellOverflowMode === b.cellOverflowMode &&
    a.wholeMolecules === b.wholeMolecules &&
    a.periodic === b.periodic &&
    a.latticeVectors === b.latticeVectors &&
    a.periodicDirs === b.periodicDirs &&
    a.draggingAtomId === b.draggingAtomId
  )
}

function lookupDisplayPositions(key: DisplayPositionInputs): Map<string, Vec3> | null {
  for (let i = 0; i < cache.length; i++) {
    if (!sameInputs(cache[i].key, key)) continue
    if (i > 0) cache.unshift(...cache.splice(i, 1))
    return cache[0].result
  }
  const result = computeDisplayPositions(key)
  cache.unshift({ key, result })
  if (cache.length > CACHE_CAPACITY) cache.length = CACHE_CAPACITY
  return result
}

export function __clearDisplayPositionCache(): void {
  cache.length = 0
}

export const __computeDisplayPositionsForTest = lookupDisplayPositions

function computeDisplayPositions({
  atoms,
  bonds,
  cellOverflowMode,
  wholeMolecules,
  periodic,
  latticeVectors,
  periodicDirs,
  draggingAtomId,
}: DisplayPositionInputs): Map<string, Vec3> | null {
  if (!periodic || !isValidLattice(latticeVectors)) return null

  let imageShifted: Map<string, Vec3> | null = null
  if (cellOverflowMode === 'tile-images') {
    for (const atom of atoms) {
      // Never offset the actively dragged atom away from the pointer.
      const image = atom.displayImage
      if (!image || atom.id === draggingAtomId) continue
      if (image[0] === 0 && image[1] === 0 && image[2] === 0) continue
      const base = atom.cartesian ?? atom.position
      if (!base) continue
      const [sx, sy, sz] = latticeShift(latticeVectors, image[0], image[1], image[2])
      if (!imageShifted) imageShifted = new Map()
      imageShifted.set(atom.id, [base[0] + sx, base[1] + sy, base[2] + sz])
    }
  }

  if (!wholeMolecules) return imageShifted

  const effective = imageShifted
    ? atoms.map((a) => {
        const shifted = imageShifted!.get(a.id)
        return shifted ? { ...a, cartesian: shifted, position: shifted } : a
      })
    : atoms
  const unwrapped = computeUnwrappedDisplayPositions(
    effective,
    bonds,
    latticeVectors,
    periodicDirs,
    draggingAtomId,
  )
  if (!imageShifted) return unwrapped
  const merged = new Map(imageShifted)
  for (const [id, pos] of unwrapped) merged.set(id, pos)
  return merged
}
