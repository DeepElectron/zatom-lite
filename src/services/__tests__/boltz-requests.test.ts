/**
 * Contract tests for request-body shapes.
 *
 * Each assertion corresponds to an observed HTTP 400 caused by differences between the deployed
 * API and its documentation. Preserve shapes verified against the service.
 *
 * Use scripts/verify-boltz-contracts.mts for live validation through the free `/estimate-cost`
 * endpoint. This suite remains fully offline.
 */

import { describe, expect, it } from 'vitest'

import {
  buildAdmeBody,
  buildPredictionBody,
  buildProteinDesignBody,
  buildProteinScreenBody,
  buildSequenceRedesignBody,
  buildSmallMoleculeDesignBody,
  buildSmallMoleculeScreenBody,
  buildTemplateBinderDesignBody,
  countRedesignResidues,
  parseSequenceLibrary,
  parseSmilesLibrary,
} from '../boltz-requests'

const target = { type: 'protein' as const, value: 'MKTAYIAKQRQISFVKSHFSRQ', chain_ids: ['A'] }
const ligand = { type: 'ligand_smiles' as const, value: 'CCO', chain_ids: ['B'] }

describe('prediction body', () => {
  it('puts affinity under input.binding.binder_chain_id', () => {
    // The older documented properties.affinity.binder shape is rejected.
    const body = buildPredictionBody({ entities: [target, ligand], binderChainId: 'B' }) as any
    expect(body.input.binding).toEqual({ type: 'ligand_protein_binding', binder_chain_id: 'B' })
    expect(body.input.properties).toBeUndefined()
  })

  it('puts sample count at input.num_samples', () => {
    // model_options.diffusion_samples is rejected.
    const body = buildPredictionBody({ entities: [target], numSamples: 3 }) as any
    expect(body.input.num_samples).toBe(3)
    expect(body.model_options).toBeUndefined()
  })

  it('omits binding when no binder chain is chosen', () => {
    const body = buildPredictionBody({ entities: [target] }) as any
    expect(body.input.binding).toBeUndefined()
  })
})

describe('adme body', () => {
  it('requires model and uses input.molecules', () => {
    const body = buildAdmeBody({ smiles: ['CCO', 'CCN'] }) as any
    expect(body.model).toBe('adme-v1')
    expect(body.input.molecules).toEqual([{ smiles: 'CCO' }, { smiles: 'CCN' }])
    // ADME rejects the entities shape used by other pipelines.
    expect(body.input.entities).toBeUndefined()
  })
})

describe('pocket constraints', () => {
  it('nests constraints inside target and converts residues to 0-based', () => {
    const body = buildSmallMoleculeDesignBody({
      targetEntities: [target],
      numMolecules: 10,
      pocketResidues: { A: [10, 11] },
      designedChainId: 'L',
    }) as any
    // Top-level constraints and pocket_residues are rejected; they belong inside target.
    expect(body.constraints).toBeUndefined()
    expect(body.pocket_residues).toBeUndefined()
    expect(body.target.constraints).toEqual([{
      type: 'pocket',
      binder_chain_id: 'L',
      contact_residues: { A: [9, 10] },
      max_distance_angstrom: 6,
    }])
  })

  it('omits constraints entirely when no pocket is given', () => {
    const body = buildSmallMoleculeDesignBody({ targetEntities: [target], numMolecules: 10 }) as any
    expect(body.target.constraints).toBeUndefined()
  })

  it('applies the same nesting to library screens', () => {
    const body = buildSmallMoleculeScreenBody({
      targetEntities: [target],
      smiles: ['CCO'],
      pocketResidues: { A: [5] },
    }) as any
    expect(body.target.constraints[0].contact_residues).toEqual({ A: [4] })
    expect(body.molecules).toEqual([{ smiles: 'CCO' }])
  })
})

describe('protein design body', () => {
  it('uses target + binder_specification, not the documented union shape', () => {
    const body = buildProteinDesignBody({
      targetEntities: [target],
      numProteins: 10,
      epitopeResidues: { A: [10, 11, 12] },
      binderLengthRange: '12..16',
      binderChainId: 'B',
    }) as any
    // The documented binder union shape is not deployed for de novo requests.
    expect(body.type).toBeUndefined()
    expect(body.binder).toBeUndefined()
    expect(body.target.type).toBe('no_template')
    expect(body.binder_specification.modality).toBe('custom_protein')
    // Convert one-based epitope input to the service's zero-based positions.
    expect(body.target.epitope_residues).toEqual({ A: [9, 10, 11] })
  })

  it('maps position 1 to index 0 so the first residue stays in range', () => {
    // Position 1 is the conversion boundary and must map exactly to index 0.
    const body = buildProteinDesignBody({
      targetEntities: [target],
      numProteins: 10,
      epitopeResidues: { A: [1] },
      binderLengthRange: '12..16',
      binderChainId: 'B',
    }) as any
    expect(body.target.epitope_residues).toEqual({ A: [0] })
  })
})

describe('template binder body', () => {
  const cif = 'data_template\n_struct_asym.id\nA\n'
  const base = {
    templateCif: cif,
    targetChainId: 'A',
    binderChainId: 'B',
    numProteins: 10,
  }

  it('activates the union shape and keeps both entities from_template', () => {
    const body = buildTemplateBinderDesignBody({
      ...base,
      motifs: [{ type: 'replacement', start: 3, end: 6, minLength: 4, maxLength: 8 }],
    }) as any
    // Top-level templates selects the template union branch.
    expect(body.type).toBe('binder')
    expect(body.templates[0].media_type).toBe('chemical/x-cif')
    expect(atob(body.templates[0].data)).toBe(cif)
    // With templates present, both entities must use from_template.
    expect(body.target.entities[0].type).toBe('from_template')
    expect(body.binder.entities[0].type).toBe('from_template')
  })

  it('converts a replacement segment to 0-based inclusive indices', () => {
    const body = buildTemplateBinderDesignBody({
      ...base,
      motifs: [{ type: 'replacement', start: 3, end: 6, minLength: 4, maxLength: 8 }],
    }) as any
    const motif = body.binder.entities[0].design_motifs[0]
    // end_index is inclusive, so both endpoints subtract one.
    expect(motif.start_index).toBe(2)
    expect(motif.end_index).toBe(5)
    expect(motif.design_length_range).toEqual({ min: 4, max: 8 })
  })

  it('converts an insertion anchor to a 0-based index', () => {
    const body = buildTemplateBinderDesignBody({
      ...base,
      motifs: [{ type: 'insertion', after: 7, minLength: 3, maxLength: 5 }],
    }) as any
    const motif = body.binder.entities[0].design_motifs[0]
    // An insertion uses only after_residue_index and has no start or end.
    expect(motif.after_residue_index).toBe(6)
    expect(motif.start_index).toBeUndefined()
    expect(motif.end_index).toBeUndefined()
  })
})

describe('sequence redesign body', () => {
  const cif = 'data_test\n_atom_site.group_PDB\nATOM\n'

  it('inlines the structure as base64 under structure.data', () => {
    const body = buildSequenceRedesignBody({
      structureCif: cif,
      numProteins: 10,
      mode: 'binder',
      chains: [{ chainId: 'A', role: 'target' }, { chainId: 'B', role: 'binder', residues: [2, 3, 4, 5, 6] }],
    }) as any
    expect(body.structure.type).toBe('base64')
    // The service expects `data` and rejects the documented `base64` key.
    expect(typeof body.structure.data).toBe('string')
    expect(body.structure.base64).toBeUndefined()
    expect(body.structure.media_type).toBe('chemical/x-cif')
    expect(atob(body.structure.data)).toBe(cif)
  })

  it('emits one entity per chain with design_motifs only where residues are chosen', () => {
    const body = buildSequenceRedesignBody({
      structureCif: cif,
      numProteins: 10,
      mode: 'binder',
      chains: [{ chainId: 'A', role: 'target' }, { chainId: 'B', role: 'binder', residues: [2, 3] }],
    }) as any
    expect(body.entities).toHaveLength(2)
    expect(body.entities[0].design_motifs).toBeUndefined()
    // Motif residues use the same one-based to zero-based conversion as epitopes.
    expect(body.entities[1].design_motifs[0].residues).toEqual([1, 2])
  })

  it('counts unique residues across chains for the 5-residue minimum', () => {
    // Binder mode requires at least five unique residues across all chains.
    expect(countRedesignResidues([
      { chainId: 'B', residues: [1, 2, 3] },
      { chainId: 'C', residues: [1, 2] },
    ])).toBe(5)
    // Duplicate positions on one chain count once.
    expect(countRedesignResidues([{ chainId: 'B', residues: [1, 1, 2] }])).toBe(2)
  })
})

describe('protein screen body', () => {
  it('wraps each candidate sequence as its own entity list', () => {
    const body = buildProteinScreenBody({
      targetEntities: [target],
      sequences: ['MKT', 'MAA'],
      candidateChainId: 'B',
    }) as any
    expect(body.proteins).toHaveLength(2)
    expect(body.proteins[0].entities[0]).toEqual({ type: 'protein', value: 'MKT', chain_ids: ['B'] })
  })
})

/**
 * Library parsing protects candidate identity rather than request shape. A malformed parser could
 * still receive HTTP 200 while screening molecules or sequences the user never supplied.
 */
describe('library parsing', () => {
  it('drops FASTA headers instead of laundering them into sequences', () => {
    // Cleaning a FASTA header as sequence would create a plausible but nonexistent candidate.
    expect(parseSequenceLibrary('>sp|P01308|INS\nMKT\n>hdr2\nMAA')).toEqual(['MKT', 'MAA'])
  })

  it('normalises sequence whitespace and case', () => {
    expect(parseSequenceLibrary('mk t\n\n  MAA  ')).toEqual(['MKT', 'MAA'])
  })

  it('preserves SMILES case because it encodes aromaticity', () => {
    // Lowercase c denotes aromatic carbon; uppercasing would change molecular identity.
    expect(parseSmilesLibrary('c1ccccc1\nCC(=O)O')).toEqual(['c1ccccc1', 'CC(=O)O'])
  })

  it('drops FASTA headers from a SMILES library too', () => {
    // Drop obvious FASTA headers even if protein text is pasted into the molecule field.
    expect(parseSmilesLibrary('>sp|P01308|INS\nCCO')).toEqual(['CCO'])
  })

  it('splits on newlines and commas, ignoring blank entries', () => {
    expect(parseSmilesLibrary('CCO, CC\n\n CCC ')).toEqual(['CCO', 'CC', 'CCC'])
    expect(parseSequenceLibrary('')).toEqual([])
  })
})
