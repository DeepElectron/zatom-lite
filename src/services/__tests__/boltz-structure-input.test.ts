import { describe, expect, it } from 'vitest'

import { parseLegacyPdb } from '../../lib/biomolecule/pdb'
import { epitopeFromSelection } from '../boltz-epitope'
import { boltzChainOptions } from '../boltz-structure-input'

/**
 * Build fixtures from real PDB text so tests cover parser-derived chain and residue membership
 * instead of bypassing the most error-prone path with hand-built topology.
 */
function pdb(lines: string[]): string {
  return `${lines.join('\n')}\nEND\n`
}

const atom = (
  serial: number,
  residue: string,
  chain: string,
  sequenceNumber: number,
): string =>
  `ATOM  ${String(serial).padStart(5)}  CA  ${residue.padEnd(3)} ${chain}${String(sequenceNumber).padStart(4)}`
  + `    ${(1 + serial).toFixed(3).padStart(8)}${(2).toFixed(3).padStart(8)}${(3).toFixed(3).padStart(8)}`
  + `  1.00  0.00           C`

describe('boltz chain options', () => {
  it('reads a one-letter sequence per protein chain', () => {
    const structure = parseLegacyPdb(pdb([
      atom(1, 'MET', 'E', 1),
      atom(2, 'LYS', 'E', 2),
      atom(3, 'THR', 'E', 3),
    ]))
    expect(boltzChainOptions(structure)).toEqual([
      { chainId: 'E', sequence: 'MKT', length: 3, gapCount: 0 },
    ])
  })

  it('reports unresolved residues implied by author numbering', () => {
    // Author numbers 1, 2, and 10 imply seven unresolved residues that sequence filling closes silently.
    const structure = parseLegacyPdb(pdb([
      atom(1, 'MET', 'A', 1),
      atom(2, 'LYS', 'A', 2),
      atom(3, 'THR', 'A', 10),
    ]))
    const [chain] = boltzChainOptions(structure)
    expect(chain.sequence).toBe('MKT')
    expect(chain.gapCount).toBe(7)
  })

  it('does not report gaps for a structure that only has crystal water', () => {
    // Counting filtered residues would mistake crystal water for unresolved polymer gaps.
    const structure = parseLegacyPdb(pdb([
      atom(1, 'MET', 'A', 1),
      atom(2, 'LYS', 'A', 2),
      'HETATM    3  O   HOH W   1       1.000   2.000   3.000  1.00  0.00           O',
    ]))
    expect(boltzChainOptions(structure)).toEqual([
      { chainId: 'A', sequence: 'MK', length: 2, gapCount: 0 },
    ])
  })

  it('omits nucleic chains because the panel submits protein entities', () => {
    // The service accepts lowercase nucleic-acid letters as protein, so do not expose DNA chains here.
    const structure = parseLegacyPdb(pdb([
      atom(1, 'MET', 'P', 1),
      atom(2, 'LYS', 'P', 2),
      atom(3, ' DA', 'N', 1),
      atom(4, ' DT', 'N', 2),
    ]))
    expect(boltzChainOptions(structure).map((chain) => chain.chainId)).toEqual(['P'])
  })

  /**
   * Filled sequences and selected epitope positions must share one polymer-membership definition.
   */
  it('keeps filled sequence and epitope positions on the same index basis', () => {
    const structure = parseLegacyPdb(pdb([
      atom(1, 'MET', 'A', 5),
      atom(2, 'UNK', 'A', 6),
      atom(3, 'LYS', 'A', 7),
      atom(4, 'THR', 'A', 8),
    ]))
    const [chain] = boltzChainOptions(structure)
    // Both sequence and position indexing skip the nonstandard UNK residue.
    expect(chain.sequence).toBe('MKT')

    // THR author number 8 is position 3 in the filtered sequence.
    const thr = structure.residues.find((residue) => residue.identity.sequenceNumber === 8)!
    const atomIds = new Set(thr.atomIndices.map((index) => structure.atoms[index].id))
    const [group] = epitopeFromSelection(structure, atomIds)
    expect(group.positions).toEqual([3])
    expect(chain.sequence[group.positions[0] - 1]).toBe('T')
  })
})
