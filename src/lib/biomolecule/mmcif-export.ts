/**
 * Export parsed biomolecular topology as an mmCIF design template.
 *
 * The workspace retains parsed topology rather than source bytes, while the
 * template API accepts mmCIF. The export therefore preserves polymer sequence,
 * chain identity, and atom geometry, but intentionally omits archival cell,
 * symmetry, and connection metadata.
 */

import { BIO_AMINO_ACIDS, BIO_NUCLEOTIDES } from './constants'
import type { BioStructure } from './types'

export interface ExportTemplateMmcifOptions {
  /** Export only these `BioChain.identifier` values; defaults to all polymers. */
  chains?: readonly string[]
}

/** mmCIF unknown-value token; blank loop fields would break column alignment. */
const UNKNOWN = '?'

/** Quote values that are not safe bare mmCIF tokens. */
function cifToken(value: string): string {
  if (value === '') return UNKNOWN
  if (/^[A-Za-z0-9_.+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "\\'")}'`
}

/** Return whether a residue belongs in the polymer sequence. */
function isPolymerResidue(name: string): boolean {
  return BIO_AMINO_ACIDS.has(name) || BIO_NUCLEOTIDES.has(name)
}

/** Export a design-template mmCIF containing polymer chains only. */
export function exportTemplateMmcif(
  structure: BioStructure,
  options: ExportTemplateMmcifOptions = {},
): string {
  const wanted = options.chains === undefined ? null : new Set(options.chains)

  // One entity per chain avoids ambiguity between sequence and chain identity.
  const exported = structure.chains
    .filter((chain) => chain.polymerType === 'protein' || chain.polymerType === 'nucleic')
    .filter((chain) => wanted === null || wanted.has(chain.identifier))
    .map((chain) => {
      const residues = chain.residueIndices
        .map((residueIndex) => structure.residues[residueIndex])
        .filter((residue) => residue !== undefined && isPolymerResidue(residue.name))
      return { chain, residues }
    })
    .filter((entry) => entry.residues.length > 0)

  if (exported.length === 0) {
    throw new Error('No polymer chains to export as a design template')
  }

  const entityIdByChainIndex = new Map<number, number>()
  exported.forEach((entry, position) => entityIdByChainIndex.set(entry.chain.index, position + 1))

  const lines: string[] = ['data_template', '#']

  // Sequence order must exactly match `_atom_site.label_seq_id`.
  lines.push(
    'loop_',
    '_entity_poly_seq.entity_id',
    '_entity_poly_seq.num',
    '_entity_poly_seq.mon_id',
  )
  for (const entry of exported) {
    const entityId = entityIdByChainIndex.get(entry.chain.index)
    entry.residues.forEach((residue, position) => {
      lines.push(`${entityId} ${position + 1} ${cifToken(residue.name)}`)
    })
  }
  lines.push('#')

  // `_struct_asym` maps each chain to its sequence entity.
  lines.push('loop_', '_struct_asym.id', '_struct_asym.entity_id')
  for (const entry of exported) {
    lines.push(`${cifToken(entry.chain.identifier)} ${entityIdByChainIndex.get(entry.chain.index)}`)
  }
  lines.push('#')

  // Atom geometry in conventional PDBx/mmCIF column order.
  lines.push(
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.id',
    '_atom_site.type_symbol',
    '_atom_site.label_atom_id',
    '_atom_site.label_alt_id',
    '_atom_site.label_comp_id',
    '_atom_site.label_asym_id',
    '_atom_site.label_entity_id',
    '_atom_site.label_seq_id',
    '_atom_site.pdbx_PDB_ins_code',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
    '_atom_site.occupancy',
    '_atom_site.B_iso_or_equiv',
    '_atom_site.pdbx_formal_charge',
    '_atom_site.auth_seq_id',
    '_atom_site.auth_comp_id',
    '_atom_site.auth_asym_id',
    '_atom_site.auth_atom_id',
    '_atom_site.pdbx_PDB_model_num',
  )

  let serial = 0
  for (const entry of exported) {
    const entityId = entityIdByChainIndex.get(entry.chain.index)
    // Use the visible chain id for label/auth namespaces so the request and
    // generated template share one chain identifier.
    const labelAsymId = cifToken(entry.chain.identifier)
    entry.residues.forEach((residue, position) => {
      const labelSeqId = position + 1
      const compId = cifToken(residue.name)
      const insertionCode = residue.identity.insertionCode === ''
        ? UNKNOWN
        : cifToken(residue.identity.insertionCode)
      for (const atomIndex of residue.atomIndices) {
        const atom = structure.atoms[atomIndex]
        if (atom === undefined) continue
        serial += 1
        lines.push([
          atom.recordType,
          serial,
          cifToken(atom.element),
          cifToken(atom.name),
          atom.alternateLocation === '' ? UNKNOWN : cifToken(atom.alternateLocation),
          compId,
          labelAsymId,
          entityId,
          labelSeqId,
          insertionCode,
          atom.position[0].toFixed(3),
          atom.position[1].toFixed(3),
          atom.position[2].toFixed(3),
          atom.occupancy.toFixed(2),
          atom.bFactor.toFixed(2),
          atom.formalCharge === null ? UNKNOWN : atom.formalCharge,
          residue.identity.sequenceNumber,
          compId,
          labelAsymId,
          cifToken(atom.name),
          1,
        ].join(' '))
      }
    })
  }
  lines.push('#', '')

  return lines.join('\n')
}

export interface TemplateChainSummary {
  /** Chain id used by the request. */
  chainId: string
  /** Polymer residue count and maximum valid 1-based position. */
  length: number
  polymerType: 'protein' | 'nucleic'
}

/** List template-capable chains and their valid residue-position bounds. */
export function templateChainSummaries(structure: BioStructure): TemplateChainSummary[] {
  return structure.chains
    .filter((chain) => chain.polymerType === 'protein' || chain.polymerType === 'nucleic')
    .map((chain) => ({
      chainId: chain.identifier,
      length: chain.residueIndices
        .map((residueIndex) => structure.residues[residueIndex])
        .filter((residue) => residue !== undefined && isPolymerResidue(residue.name))
        .length,
      polymerType: chain.polymerType as 'protein' | 'nucleic',
    }))
    .filter((summary) => summary.length > 0)
}
