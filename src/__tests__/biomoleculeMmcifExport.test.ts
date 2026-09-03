import { describe, expect, it } from 'vitest'

import { exportTemplateMmcif, templateChainSummaries } from '../lib/biomolecule/mmcif-export'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'

/**
 * Protect two template-export contracts: all three required loops must exist, and label_asym_id
 * must match BioChain.identifier. A mismatch makes a UI-visible chain name fail remotely as absent.
 * Individual mmCIF columns remain implementation details.
 */

function atomLine(options: {
  record?: 'ATOM' | 'HETATM'
  serial: number
  name: string
  residue: string
  chain: string
  sequence: number
  x: number
  element: string
}): string {
  const line = Array<string>(80).fill(' ')
  const put = (start: number, end: number, value: string, left = false) => {
    const text = left ? value.padEnd(end - start) : value.padStart(end - start)
    for (let index = 0; index < end - start; index += 1) line[start + index] = text[index]
  }
  put(0, 6, options.record ?? 'ATOM', true)
  put(6, 11, String(options.serial))
  put(12, 16, options.name.length < 4 && options.element.length === 1 ? ` ${options.name.padEnd(3)}` : options.name, true)
  put(17, 20, options.residue)
  put(21, 22, options.chain, true)
  put(22, 26, String(options.sequence))
  put(30, 38, options.x.toFixed(3))
  put(38, 46, (0).toFixed(3))
  put(46, 54, (0).toFixed(3))
  put(54, 60, '1.00')
  put(60, 66, '12.00')
  put(76, 78, options.element)
  return line.join('').trimEnd()
}

/**
 * Two polymer chains plus water. Author chain ids intentionally use 2PTC-style E/I so export must
 * carry parsed identifiers into label_asym_id. Water verifies non-polymer exclusion.
 */
const PDB = [
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'E', sequence: 10, x: 0, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'E', sequence: 10, x: 1.4, element: 'C' }),
  atomLine({ serial: 3, name: 'CA', residue: 'GLY', chain: 'E', sequence: 11, x: 2.8, element: 'C' }),
  atomLine({ serial: 4, name: 'CA', residue: 'SER', chain: 'I', sequence: 1, x: 8, element: 'C' }),
  atomLine({ serial: 5, name: 'CA', residue: 'LYS', chain: 'I', sequence: 2, x: 9.4, element: 'C' }),
  atomLine({ record: 'HETATM', serial: 6, name: 'O', residue: 'HOH', chain: 'W', sequence: 1, x: 20, element: 'O' }),
  'END',
].join('\n')

describe('exportTemplateMmcif', () => {
  const structure = parseLegacyPdb(PDB)

  it('emits the three loops the API refuses to work without', () => {
    const cif = exportTemplateMmcif(structure)
    // The service rejects templates missing _entity_poly_seq or _struct_asym.
    expect(cif).toContain('_entity_poly_seq.entity_id')
    expect(cif).toContain('_entity_poly_seq.num')
    expect(cif).toContain('_entity_poly_seq.mon_id')
    expect(cif).toContain('_struct_asym.id')
    expect(cif).toContain('_struct_asym.entity_id')
    expect(cif).toContain('_atom_site.label_asym_id')
  })

  it('writes label_asym_id as the chain identifier the UI shows', () => {
    const cif = exportTemplateMmcif(structure)
    const chainIds = structure.chains
      .filter((chain) => chain.polymerType === 'protein')
      .map((chain) => chain.identifier)
    expect(chainIds).toEqual(['E', 'I'])

    // _struct_asym must use identifiers rather than reassigned A/B names; stop at the loop terminator.
    const body = cif.slice(cif.indexOf('_struct_asym.entity_id')).split('\n').slice(1)
    const declared = body
      .slice(0, body.indexOf('#'))
      .filter((line) => line.trim() !== '')
      .map((line) => line.trim().split(/\s+/)[0])
    expect(declared).toEqual(['E', 'I'])

    // _atom_site must use the same chain identifiers as _struct_asym.
    for (const line of cif.split('\n')) {
      if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue
      expect(chainIds).toContain(line.trim().split(/\s+/)[6])
    }
  })

  it('leaves out water so the chain list matches what the API enumerates', () => {
    const cif = exportTemplateMmcif(structure)
    // Water is absent from the service's chain enumeration and must stay out of template chains.
    expect(cif).not.toContain('HOH')
    expect(templateChainSummaries(structure).map((chain) => chain.chainId)).toEqual(['E', 'I'])
  })

  it('reports chain lengths that bound the 1-based positions the UI accepts', () => {
    // Chain length is the upper bound of one-based position input.
    expect(templateChainSummaries(structure)).toEqual([
      { chainId: 'E', length: 2, polymerType: 'protein' },
      { chainId: 'I', length: 2, polymerType: 'protein' },
    ])
  })

  it('narrows the template to the requested chains', () => {
    const cif = exportTemplateMmcif(structure, { chains: ['I'] })
    expect(cif).toContain('SER')
    // Extra template chains participate in modeling, so requested chain cropping must take effect.
    expect(cif).not.toContain('ALA')
  })

  it('fails loudly when nothing polymeric is left to export', () => {
    // Reject an empty polymer export locally instead of returning an opaque remote error.
    expect(() => exportTemplateMmcif(structure, { chains: ['W'] })).toThrow(/No polymer chains/)
  })
})
