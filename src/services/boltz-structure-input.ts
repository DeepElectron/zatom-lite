import { buildBioSequenceChains } from '../lib/biomolecule/sequence'
import type { BioStructure } from '../lib/biomolecule/types'

/**
 * A mounted viewport chain that can be used as Boltz input.
 */
export interface BoltzChainOption {
  chainId: string
  /** Uppercase one-letter sequence for a Boltz protein entity. */
  sequence: string
  length: number
  /**
   * Number of unresolved residues implied by author numbering, commonly disordered loops.
   *
   * Surface this value because the generated sequence silently closes those gaps. Folding it asks
   * how a continuous chain might look, not what was resolved in the crystal.
   *
   * Derive it from numbering span rather than filtered residues, which would also count water and
   * ligands sharing the `isStandard=false` condition.
   */
  gapCount: number
}

/**
 * Convert a mounted structure into chains suitable for the target-sequence field.
 *
 * Reuse `buildBioSequenceChains` so epitope and motif positions share one definition of polymer
 * sequence order. Divergent filtering would silently misalign sequences and selected positions.
 *
 * Return protein chains only. The panel currently submits `type: 'protein'`, and the service also
 * accepts lowercase nucleic-acid letters as protein input, so exposing nucleic-acid chains would
 * silently fold DNA as protein. Nucleic acids require entity types derived from chain type.
 */
export function boltzChainOptions(structure: BioStructure): BoltzChainOption[] {
  return buildBioSequenceChains(structure)
    .filter((chain) => chain.polymerType === 'protein')
    .map((chain) => {
      const sequence = chain.sequence.toUpperCase()
      const numbers = chain.residues.map((residue) => residue.sequenceNumber)
      const span = numbers.length > 0
        ? Math.max(...numbers) - Math.min(...numbers) + 1
        : 0
      return {
        chainId: chain.chainId,
        sequence,
        length: sequence.length,
        // Insertion codes such as antibody 52A/52B can make the span smaller; clamp at zero.
        gapCount: Math.max(0, span - sequence.length),
      }
    })
    .filter((chain) => chain.length > 0)
}
