/**
 * Supercell generation utilities
 * Handles expansion of unit cells into larger supercell structures
 * @module supercell
 * @version 2.0.0 - Uses crypto.randomUUID for atom IDs
 */
import type { Atom, SupercellParams, LatticeVectors, LatticeParameters } from './types'
import { fractionalToCartesian } from './lattice'

/**
 * Generate a unique atom ID using crypto.randomUUID
 * This guarantees uniqueness without any counter management
 * @returns A unique string ID in format "atom-xxxxxxxx"
 */
export function generateAtomId(): string {
  // Use crypto.randomUUID for guaranteed unique IDs (available in all modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `atom-${crypto.randomUUID().substring(0, 8)}`
  }
  // Fallback: combine timestamp + random for uniqueness
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `atom-${ts}${rand}`
}

/**
 * Reset atom ID counter - no-op since we use crypto.randomUUID
 * Kept for backwards compatibility with existing code
 */
export function resetAtomIdCounter(): void {
  // No-op: crypto.randomUUID doesn't need counter management
}

// Generate supercell from unit cell atoms
export function generateSupercell(
  unitCellAtoms: Atom[],
  supercellParams: SupercellParams,
  latticeVectors: LatticeVectors
): Atom[] {
  const { nx, ny, nz } = supercellParams
  const supercellAtoms: Atom[] = []
  const preservesUnitCellIdentity = nx === 1 && ny === 1 && nz === 1

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        for (let siteIndex = 0; siteIndex < unitCellAtoms.length; siteIndex += 1) {
          const atom = unitCellAtoms[siteIndex]
          // Calculate new fractional position within supercell
          const newFractional: [number, number, number] = [
            (atom.position[0] + i) / nx,
            (atom.position[1] + j) / ny,
            (atom.position[2] + k) / nz,
          ]

          // Calculate actual position for supercell
          const actualFractional: [number, number, number] = [
            atom.position[0] + i,
            atom.position[1] + j,
            atom.position[2] + k,
          ]

          const cartesian = fractionalToCartesian(actualFractional, latticeVectors)

          supercellAtoms.push({
            ...atom,
            // A 1x1x1 rebuild is a coordinate/cell edit, not atom replacement.
            // Preserve canonical Agent IDs so structure-bound sidecars can
            // invalidate derived evidence without discarding unrelated data.
            id: preservesUnitCellIdentity ? atom.id : generateAtomId(),
            position: newFractional,
            cartesian,
            cellIndex: [i, j, k],
            siteIndex: atom.siteIndex ?? siteIndex,
          })
        }
      }
    }
  }

  return supercellAtoms
}

/** Return the complete cell spanned by a materialized supercell. */
export function scaleLatticeVectorsForSupercell(
  latticeVectors: LatticeVectors,
  supercellParams: SupercellParams,
): LatticeVectors {
  return {
    a: latticeVectors.a.map((value) => value * supercellParams.nx) as [number, number, number],
    b: latticeVectors.b.map((value) => value * supercellParams.ny) as [number, number, number],
    c: latticeVectors.c.map((value) => value * supercellParams.nz) as [number, number, number],
  }
}

// Scale lattice parameters for supercell
export function scaleLaticeForSupercell(
  params: LatticeParameters,
  supercell: SupercellParams
): LatticeParameters {
  return {
    a: params.a * supercell.nx,
    b: params.b * supercell.ny,
    c: params.c * supercell.nz,
    alpha: params.alpha,
    beta: params.beta,
    gamma: params.gamma,
  }
}

// old hand-coded `STRUCTURE_TEMPLATES` dictionary + getTemplateNames /
// getTemplateDefinition / createAtomsFromTemplate has been moved to ./crystal-template-cifs.ts,
// Change to publication-level CIF text, which is expanded by parseCIF in the loadFromCIF process. Code removal avoids double maintenance.
