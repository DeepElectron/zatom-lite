import { exportLegacyPdb } from '../lib/biomolecule/pdb-export'
import type { BioVector3 } from '../lib/biomolecule/types'
import { exportToCIF } from '../lib/crystal/cif-parser'
import { exportAtomsToXYZ } from '../lib/crystal/xyz-export'
import type { CrystalStore } from '../orchestration/crystal-store-types'

export type StructureTextFormat = 'pdb' | 'cif' | 'xyz'

export interface StructureTextExport {
  content: string
  extension: `.${StructureTextFormat}`
  format: StructureTextFormat
  suggestedName: string
}

export function structureExportStem(value: string | null | undefined): string {
  const normalized = (value ?? 'structure')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'structure'
}

/**
 * One canonical format decision for every export surface:
 * biomolecule -> PDB, periodic structure -> CIF, otherwise -> XYZ.
 */
export function createStructureTextExport(
  state: CrystalStore,
  requestedStem?: string | null,
): StructureTextExport {
  const stem = structureExportStem(requestedStem ?? state.bioStructure?.title ?? state.bioStructure?.id)
  if (state.bioStructure) {
    const currentAtomPositions = new Map<string, BioVector3>()
    for (const atom of state.atoms) {
      const position = atom.cartesian ?? atom.position
      currentAtomPositions.set(atom.id, position)
    }
    return {
      content: exportLegacyPdb(state.bioStructure, {
        currentAtomPositions,
        activeFrameIndex: state.trajectoryCurrentFrame,
      }),
      extension: '.pdb',
      format: 'pdb',
      suggestedName: `${stem}.pdb`,
    }
  }
  if (state.atoms.length === 0) throw new Error('Load or build a structure before exporting it')
  if (state.periodic) {
    const { nx, ny, nz } = state.supercellParams
    const latticeParams = {
      ...state.latticeParams,
      a: state.latticeParams.a * nx,
      b: state.latticeParams.b * ny,
      c: state.latticeParams.c * nz,
    }
    return {
      content: exportToCIF({
        name: stem,
        latticeParams,
        crystalSystem: state.crystalSystem,
        // Pass cartesian coordinates only. exportToCIF interprets `position` as fractional, while
        // store atom positions are Cartesian angstroms; mixing them would shift atoms by several cells.
        atoms: state.atoms.map((atom) => ({
          element: atom.element,
          cartesian: atom.cartesian ?? atom.position,
        })),
      }),
      extension: '.cif',
      format: 'cif',
      suggestedName: `${stem}.cif`,
    }
  }
  return {
    content: exportAtomsToXYZ(state.atoms),
    extension: '.xyz',
    format: 'xyz',
    suggestedName: `${stem}.xyz`,
  }
}
