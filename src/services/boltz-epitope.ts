/**
 * Translate atom selections from the 3D view into Boltz epitope residues.
 *
 * Selecting residues directly is the natural way to identify a target surface. This pure layer maps
 * atom ids to residues grouped by chain without depending on stores or UI.
 *
 * Boltz epitope positions are relative to one target chain. Preserve chain membership so a selection
 * spanning multiple chains cannot silently mix incompatible residue numbers.
 *
 * ## Keep both numbering systems distinct
 *
 * - **Author number** (`auth_seq_id`) appears in literature and the 3D view. It may start anywhere,
 *   contain gaps, and use insertion codes.
 * - **Sequence position** is the 1-based position in a chain's gapless polymer sequence. Boltz accepts
 *   only this coordinate, converted to 0-based by the request builder.
 *
 * Return both: `residues` for display and form filling, and `positions` for requests.
 */

import { buildBioSequenceChains } from '../lib/biomolecule/sequence'
import type { BioStructure } from '../lib/biomolecule/types'

export interface EpitopeSelection {
  /** PDB chain id; an empty string is a valid blank-chain identifier. */
  chainId: string
  /** Sorted unique author residue numbers for display and form filling. */
  residues: number[]
  /** One-based sequence positions aligned with `residues`, used in requests. */
  positions: number[]
}

/**
 * Map residueIndex to one-based chain position.
 *
 * Reuse `buildBioSequenceChains` so sequence, template export, and request construction share one
 * definition of polymer membership and ordering.
 */
function positionIndex(structure: BioStructure): Map<number, number> {
  const index = new Map<number, number>()
  for (const chain of buildBioSequenceChains(structure)) {
    chain.residues.forEach((residue, offset) => {
      index.set(residue.residueIndex, offset + 1)
    })
  }
  return index
}

/**
 * Group residues containing selected atoms by chain.
 *
 * Any selected atom includes its residue because box selection rarely covers every atom exactly.
 */
export function epitopeFromSelection(
  structure: BioStructure,
  selectedAtomIds: ReadonlySet<string>,
): EpitopeSelection[] {
  if (selectedAtomIds.size === 0) return []

  const positions = positionIndex(structure)
  // Bucket by chain and deduplicate author number to sequence position with a Map.
  const byChain = new Map<string, Map<number, number>>()

  for (const atom of structure.atoms) {
    if (!selectedAtomIds.has(atom.id)) continue
    const residue = structure.residues[atom.residueIndex]
    if (residue === undefined) continue
    // Water, ions, and ligands lack polymer positions and cannot form a Boltz epitope.
    const position = positions.get(atom.residueIndex)
    if (position === undefined) continue

    const { chainId, sequenceNumber } = residue.identity
    let bucket = byChain.get(chainId)
    if (bucket === undefined) {
      bucket = new Map<number, number>()
      byChain.set(chainId, bucket)
    }
    bucket.set(sequenceNumber, position)
  }

  return [...byChain.entries()]
    .map(([chainId, bucket]) => {
      const residues = [...bucket.keys()].sort((a, b) => a - b)
      return {
        chainId,
        residues,
        positions: residues.map((residue) => bucket.get(residue) as number),
      }
    })
    .filter((entry) => entry.residues.length > 0)
    // The chain with the most selected residues usually represents the intended surface patch.
    .sort((a, b) => b.residues.length - a.residues.length)
}

/**
 * Return the chain with the most selected epitope residues. Discard other chains because a Boltz
 * request interprets every epitope position relative to one target chain.
 */
export function primaryEpitope(
  structure: BioStructure,
  selectedAtomIds: ReadonlySet<string>,
): EpitopeSelection | null {
  return epitopeFromSelection(structure, selectedAtomIds)[0] ?? null
}

/**
 * Convert author residue numbers to one-based sequence positions.
 *
 * Manual inputs commonly come from literature author numbers such as K417, while requests require
 * positions. Drop unrecognized numbers instead of silently treating them as positions.
 */
export function authorNumbersToPositions(
  structure: BioStructure,
  chainId: string,
  authorNumbers: readonly number[],
): number[] {
  const chain = buildBioSequenceChains(structure).find((entry) => entry.chainId === chainId)
  if (chain === undefined) return []

  const lookup = new Map<number, number>()
  chain.residues.forEach((residue, offset) => {
    // Insertion codes can repeat an author number; keep the first matching residue.
    if (!lookup.has(residue.sequenceNumber)) lookup.set(residue.sequenceNumber, offset + 1)
  })

  const out = new Set<number>()
  for (const number of authorNumbers) {
    const position = lookup.get(number)
    if (position !== undefined) out.add(position)
  }
  return [...out].sort((a, b) => a - b)
}
