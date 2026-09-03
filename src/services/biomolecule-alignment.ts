import type { BioStructure } from '../lib/biomolecule/types'
import { superposeBioStructures } from '../lib/biomolecule/superposition'
import { fetchRcsbPdbStructure } from './unified-file-import'

export interface BiomoleculeAlignmentSuccess {
  success: true
  sourceLabel: string
  structure: BioStructure
  pairCount: number
  rmsd: number
  /** Exact PDB residue identity; this is deliberately not sequence alignment. */
  method: 'exact-residue-identity'
}

export interface BiomoleculeAlignmentFailure {
  success: false
  error: string
}

export type BiomoleculeAlignmentResult = BiomoleculeAlignmentSuccess | BiomoleculeAlignmentFailure

/** Download and rigidly superpose a secondary PDB without changing the active document. */
export async function alignRcsbPdbStructure(
  reference: BioStructure,
  pdbId: string,
): Promise<BiomoleculeAlignmentResult> {
  const downloaded = await fetchRcsbPdbStructure(pdbId)
  if (!downloaded.success) return downloaded
  try {
    const alignment = superposeBioStructures(reference, downloaded.structure)
    return {
      success: true,
      sourceLabel: downloaded.fileName,
      structure: alignment.transformedStructure,
      pairCount: alignment.pairCount,
      rmsd: alignment.rmsd,
      method: 'exact-residue-identity',
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Alignment failed.',
    }
  }
}
