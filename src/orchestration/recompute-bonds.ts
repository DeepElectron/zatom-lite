/**
 * Single entry point for recomputing all bonds from store state.
 *
 * Centralizing the complete autoDetectBonds argument set keeps CIF loading,
 * supercell rebuilds, trajectory frames, and settings changes from producing
 * different topology for the same structure and settings.
 */

import type { Atom, Bond, LatticeVectors } from '../lib/crystal/types'
import { autoDetectBonds } from '../lib/crystal/bonds'
import type { BondSettings, CrystalStore } from './crystal-store-types'

interface RecomputeOverrides {
  /** Atoms not yet written to the store, such as during supercell rebuilds or frame changes. */
  atoms?: Atom[]
  /** Lattice not yet written to the store, including per-frame trajectory lattices. */
  latticeVectors?: LatticeVectors
  /** Settings not yet written to the store when called before set() in a setter. */
  bondSettings?: BondSettings
  /** Supercell repeats not yet written to the store when called before set(). */
  supercellParams?: { nx: number; ny: number; nz: number }
}

/**
 * Display box = unit cell × supercell repeats.
 *
 * Must exactly match displayBox in use-display-image-offsets. That code adds
 * boundary image atoms at ±1 display boxes; using the same box for cross-boundary
 * bonds keeps both latticeOffset values on the same rendered instances.
 */
function displayBoxOf(
  lattice: LatticeVectors,
  cells: { nx: number; ny: number; nz: number } | null | undefined,
): LatticeVectors {
  const nx = Math.max(1, cells?.nx ?? 1)
  const ny = Math.max(1, cells?.ny ?? 1)
  const nz = Math.max(1, cells?.nz ?? 1)
  if (nx === 1 && ny === 1 && nz === 1) return lattice
  return {
    a: [lattice.a[0] * nx, lattice.a[1] * nx, lattice.a[2] * nx],
    b: [lattice.b[0] * ny, lattice.b[1] * ny, lattice.b[2] * ny],
    c: [lattice.c[0] * nz, lattice.c[1] * nz, lattice.c[2] * nz],
  }
}

export function recomputeBonds(state: CrystalStore, overrides: RecomputeOverrides = {}): Bond[] {
  const settings = overrides.bondSettings ?? state.bondSettings
  const lattice = overrides.latticeVectors ?? state.latticeVectors
  const cells = overrides.supercellParams ?? state.supercellParams
  return autoDetectBonds(
    overrides.atoms ?? state.atoms,
    lattice,
    settings.defaultRadius,
    settings.elementPairRadii,
    settings.restrictToConfiguredPairs,
    {
      // Search images only for periodic systems. Molecular and biomolecular lattices
      // are often placeholders; minimum-image search on a 1 Å dummy cell links the system together.
      periodic: state.periodic && settings.periodicBonds,
      tolerance: settings.tolerance,
      periodicLattice: displayBoxOf(lattice, cells),
    },
  )
}
