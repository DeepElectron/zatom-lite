/**
 * Request builders for all seven pipelines.
 *
 * Every output shape has returned HTTP 200 from `/estimate-cost`. Do not rewrite these contracts
 * from documentation alone; several documented forms are not deployed. See boltz-pipelines.ts.
 */

import type { BoltzPipelineId } from './boltz-pipelines'

/** Protein, DNA, RNA, or ligand entity; value semantics depend on type. */
export interface BoltzEntity {
  type: 'protein' | 'dna' | 'rna' | 'ligand_smiles' | 'ligand_ccd'
  value: string
  chain_ids: string[]
}

/**
 * Map chain ids to one-based residue positions in each polymer sequence.
 *
 * Keep two numbering rules distinct to avoid silently targeting the wrong residue:
 *
 * 1. **Position is not author residue number.** `auth_seq_id` may start anywhere, contain gaps, and
 *    use insertion codes. Boltz accepts sequence positions derived through buildBioSequenceChains.
 *
 * 2. **The deployed API is zero-based despite the documentation.** Pocket/contact constraints,
 *    epitopes, and all motif indices are zero-based; motif end_index remains inclusive.
 *
 * Public builders accept human-readable one-based positions and perform wire conversion internally.
 */
export type ResidueSelection = Record<string, number[]>

/** Convert one-based constraint positions to the zero-based wire format. */
function toZeroBased(selection: ResidueSelection): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(selection).map(([chainId, residues]) => [chainId, residues.map((r) => r - 1)]),
  )
}

/**
 * Build a pocket constraint. Top-level `pocket_residues` is unsupported; the service expects a
 * pocket entry in `constraints` with binder_chain_id and zero-based contact_residues.
 */
function pocketConstraint(
  binderChainId: string,
  pocketResidues: ResidueSelection,
  maxDistanceAngstrom: number,
): unknown[] {
  if (Object.keys(pocketResidues).length === 0) return []
  return [{
    type: 'pocket',
    binder_chain_id: binderChainId,
    contact_residues: toZeroBased(pocketResidues),
    max_distance_angstrom: maxDistanceAngstrom,
  }]
}

/** Default pocket contact distance; 6 angstroms is a common binding-pocket threshold. */
export const DEFAULT_POCKET_DISTANCE_ANGSTROM = 6

/**
 * Server limit for prediction samples. Values above 10 are rejected, so the UI must not reuse the
 * design-pipeline limit of 100.
 */
export const MAX_PREDICTION_SAMPLES = 10

export interface PredictionRequest {
  entities: BoltzEntity[]
  /** Ligand or binder chain id when affinity should be calculated. */
  binderChainId?: string
  /** Range 1..10; clamp excess values rather than rejecting the entire request. */
  numSamples?: number
}

export function buildPredictionBody(input: PredictionRequest): unknown {
  return {
    model: 'boltz-2.1',
    input: {
      entities: input.entities,
      // The deployed affinity field is input.binding.binder_chain_id.
      ...(input.binderChainId
        ? { binding: { type: 'ligand_protein_binding', binder_chain_id: input.binderChainId } }
        : {}),
      // The deployed sample field is input.num_samples; clamp to its server limit.
      ...(input.numSamples && input.numSamples > 1
        ? { num_samples: Math.min(input.numSamples, MAX_PREDICTION_SAMPLES) }
        : {}),
    },
  }
}

export interface AdmeRequest {
  /** SMILES strings to evaluate. */
  smiles: string[]
}

export function buildAdmeBody(input: AdmeRequest): unknown {
  // ADME uses model `adme-v1` and input.molecules[].smiles rather than generic input.entities.
  return {
    model: 'adme-v1',
    input: { molecules: input.smiles.map((smiles) => ({ smiles })) },
  }
}

export interface SmallMoleculeDesignRequest {
  targetEntities: BoltzEntity[]
  numMolecules: number
  /** One-based pocket residues; designedChainId identifies the generated ligand chain. */
  pocketResidues?: ResidueSelection
  designedChainId?: string
  pocketDistanceAngstrom?: number
}

export function buildSmallMoleculeDesignBody(input: SmallMoleculeDesignRequest): unknown {
  const constraints = input.pocketResidues
    ? pocketConstraint(
      input.designedChainId ?? 'L',
      input.pocketResidues,
      input.pocketDistanceAngstrom ?? DEFAULT_POCKET_DISTANCE_ANGSTROM,
    )
    : []
  return {
    num_molecules: input.numMolecules,
    // Constraints belong inside target beside entities; the top level is rejected.
    target: {
      entities: input.targetEntities,
      ...(constraints.length > 0 ? { constraints } : {}),
    },
  }
}

export interface SmallMoleculeScreenRequest {
  targetEntities: BoltzEntity[]
  /** SMILES library to screen. */
  smiles: string[]
  /** One-based pocket residues. */
  pocketResidues?: ResidueSelection
  ligandChainId?: string
  pocketDistanceAngstrom?: number
}

export function buildSmallMoleculeScreenBody(input: SmallMoleculeScreenRequest): unknown {
  const constraints = input.pocketResidues
    ? pocketConstraint(
      input.ligandChainId ?? 'L',
      input.pocketResidues,
      input.pocketDistanceAngstrom ?? DEFAULT_POCKET_DISTANCE_ANGSTROM,
    )
    : []
  return {
    // As with design requests, constraints belong inside target.
    target: {
      entities: input.targetEntities,
      ...(constraints.length > 0 ? { constraints } : {}),
    },
    molecules: input.smiles.map((value) => ({ smiles: value })),
  }
}

/**
 * Binder modalities accepted by the deployed service.
 *
 * Modality selects the backbone prior; nanobody and antibody modes use immunoglobulin frameworks
 * instead of free backbones.
 */
export const BINDER_MODALITIES = ['custom_protein', 'peptide', 'nanobody', 'antibody'] as const
export type BinderModality = (typeof BINDER_MODALITIES)[number]

export interface ProteinDesignRequest {
  targetEntities: BoltzEntity[]
  numProteins: number
  /** Epitope residues; omission lets the model choose the binding surface. */
  epitopeResidues?: ResidueSelection
  /**
   * One-based residues that should not be bound, used to avoid functional or glycosylation sites.
   */
  nonBindingResidues?: ResidueSelection
  /** Binder length range such as "12..16". */
  binderLengthRange: string
  binderChainId: string
  /** Defaults to the free-backbone custom_protein modality. */
  modality?: BinderModality
}

export function buildProteinDesignBody(input: ProteinDesignRequest): unknown {
  // De novo design uses target + binder_specification with type `no_template` on both.
  return {
    num_proteins: input.numProteins,
    target: {
      type: 'no_template',
      entities: input.targetEntities,
      // Epitope and non-binding residues use zero-based sequence positions on the wire.
      ...(input.epitopeResidues && Object.keys(input.epitopeResidues).length > 0
        ? { epitope_residues: toZeroBased(input.epitopeResidues) }
        : {}),
      ...(input.nonBindingResidues && Object.keys(input.nonBindingResidues).length > 0
        ? { non_binding_residues: toZeroBased(input.nonBindingResidues) }
        : {}),
    },
    binder_specification: {
      type: 'no_template',
      modality: input.modality ?? 'custom_protein',
      entities: [{
        type: 'designed_protein',
        chain_ids: [input.binderChainId],
        value: input.binderLengthRange,
      }],
    },
  }
}

/**
 * Redesign segments use one-based inclusive sequence positions.
 *
 * - `replacement` replaces start..end with a variable-length sequence, suitable for CDR grafting.
 * - `insertion` inserts a new sequence after an anchor while retaining existing residues.
 */
export type DesignMotif =
  | { type: 'replacement'; start: number; end: number; minLength: number; maxLength: number }
  | { type: 'insertion'; after: number; minLength: number; maxLength: number }

/** Fixed reference id for the single-template request shape. */
const TEMPLATE_ID = 'template'

export interface TemplateBinderDesignRequest {
  /** Complete mmCIF text from exportTemplateMmcif or an uploaded mmCIF. */
  templateCif: string
  /** Target and binder label_asym_id values present in the template. */
  targetChainId: string
  binderChainId: string
  numProteins: number
  modality?: BinderModality
  /** One-based epitope positions on the target chain. */
  epitopeResidues?: number[]
  /** One or more redesign segments on the binder chain. */
  motifs: DesignMotif[]
}

/** Convert a one-based inclusive motif to the zero-based wire shape. */
function motifToWire(motif: DesignMotif): unknown {
  const design_length_range = { min: motif.minLength, max: motif.maxLength }
  if (motif.type === 'insertion') {
    return { type: 'insertion', after_residue_index: motif.after - 1, design_length_range, filters: [] }
  }
  return {
    type: 'replacement',
    start_index: motif.start - 1,
    // end_index is inclusive, so subtract one just as for start_index.
    end_index: motif.end - 1,
    design_length_range,
    filters: [],
  }
}

/**
 * Template-based binder design for CDR grafting or framework redesign.
 *
 * This shape is mutually exclusive with buildProteinDesignBody. Top-level `templates` selects the
 * service branch and requires a `from_template` binder, so it cannot represent a template target
 * paired with a de novo binder.
 */
export function buildTemplateBinderDesignBody(input: TemplateBinderDesignRequest): unknown {
  const templateSource = {
    id: TEMPLATE_ID,
    type: 'base64',
    data: base64Utf8(input.templateCif),
    // The deployed template endpoint accepts mmCIF only.
    media_type: 'chemical/x-cif',
  }
  return {
    type: 'binder',
    num_proteins: input.numProteins,
    templates: [templateSource],
    target: {
      entities: [{
        type: 'from_template',
        template_id: TEMPLATE_ID,
        chain_id: input.targetChainId,
        crop_residues: 'all',
        ...(input.epitopeResidues && input.epitopeResidues.length > 0
          ? { epitope_residues: input.epitopeResidues.map((residue) => residue - 1) }
          : {}),
      }],
    },
    binder: {
      type: 'single',
      modality: input.modality ?? 'nanobody',
      entities: [{
        type: 'from_template',
        template_id: TEMPLATE_ID,
        chain_id: input.binderChainId,
        crop_residues: 'all',
        design_motifs: input.motifs.map(motifToWire),
      }],
    },
  }
}

/**
 * Validate request contracts before submission and return a user-readable reason or null.
 *
 * Local checks replace opaque zero-based server errors with feedback aligned to UI positions.
 */
export function checkTemplateBinderRequest(input: TemplateBinderDesignRequest): string | null {
  if (input.targetChainId === input.binderChainId) {
    return 'Target and binder must be different chains of the template.'
  }
  if (input.motifs.length === 0) {
    return 'Add at least one redesign segment — a template binder with no motif designs nothing.'
  }
  for (const motif of input.motifs) {
    if (motif.minLength < 1 || motif.maxLength < motif.minLength) {
      return 'Each segment needs a valid length range (min ≥ 1, max ≥ min).'
    }
    if (motif.type === 'replacement' && motif.end < motif.start) {
      return 'Replacement segments need end ≥ start.'
    }
    if (motif.type === 'replacement' && motif.start < 1) {
      return 'Residue positions start at 1.'
    }
    if (motif.type === 'insertion' && motif.after < 1) {
      return 'Residue positions start at 1.'
    }
  }
  return null
}

/**
 * Parse candidate sequence libraries by lines or commas.
 *
 * Drop FASTA headers. Cleaning one as sequence text could turn metadata such as `>sp|P01308|INS`
 * into a plausible but nonexistent amino-acid candidate.
 */
export function parseSequenceLibrary(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('>'))
    .map((line) => line.replace(/\s/g, '').toUpperCase())
    .filter((line) => line.length > 0)
}

/**
 * Parse a SMILES library into entries.
 *
 * Preserve case because lowercase aromatic atoms and uppercase aliphatic atoms are semantically distinct.
 */
export function parseSmilesLibrary(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    // A FASTA header is definitively not SMILES. Stronger character filtering would reject valid molecules.
    .filter((entry) => entry.length > 0 && !entry.startsWith('>'))
}

export interface ProteinScreenRequest {
  targetEntities: BoltzEntity[]
  /** Candidate protein sequences. */
  sequences: string[]
  candidateChainId: string
}

export function buildProteinScreenBody(input: ProteinScreenRequest): unknown {
  return {
    target: { type: 'no_template', entities: input.targetEntities },
    proteins: input.sequences.map((value) => ({
      entities: [{ type: 'protein', value, chain_ids: [input.candidateChainId] }],
    })),
  }
}

export interface SequenceRedesignRequest {
  /** Complete mmCIF text submitted inline as base64. */
  structureCif: string
  numProteins: number
  /** Every structure chain must appear once. */
  chains: {
    chainId: string
    /** Role required in binder mode and omitted in generic mode. */
    role?: 'target' | 'binder'
    /** One-based residues to redesign; binder mode requires at least five in total. */
    residues?: number[]
  }[]
  mode: 'binder' | 'generic'
}

/** Encode UTF-8 as base64; TextEncoder bridges btoa's Latin-1 input. */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  // Chunk large structures to stay below String.fromCharCode argument limits.
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

export function buildSequenceRedesignBody(input: SequenceRedesignRequest): unknown {
  return {
    type: input.mode,
    num_proteins: input.numProteins,
    // Inline structures use `{type:'base64', data, media_type}`; the service rejects a `base64` key.
    structure: {
      type: 'base64',
      data: base64Utf8(input.structureCif),
      media_type: 'chemical/x-cif',
    },
    entities: input.chains.map((chain) => ({
      type: 'from_template',
      chain_id: chain.chainId,
      ...(chain.role ? { role: chain.role } : {}),
      // Motif residues use zero-based positions on the wire, like epitopes.
      ...(chain.residues && chain.residues.length > 0
        ? {
          design_motifs: [{
            type: 'residues',
            residues: chain.residues.map((residue) => residue - 1),
            filters: [],
          }],
        }
        : {}),
    })),
  }
}

/** Server minimum for binder mode, also used by UI preflight validation. */
export const MIN_REDESIGN_RESIDUES = 5

export function countRedesignResidues(chains: SequenceRedesignRequest['chains']): number {
  const unique = new Set<string>()
  for (const chain of chains) {
    for (const residue of chain.residues ?? []) unique.add(`${chain.chainId}:${residue}`)
  }
  return unique.size
}

/**
 * Pre-submission contract check for sequence redesign.
 *
 * Binder mode requires at least five unique redesign residues and entities covering every polymer
 * chain recognized by the service; water and ion chains are excluded.
 */
export function checkSequenceRedesignRequest(input: SequenceRedesignRequest): string | null {
  const total = countRedesignResidues(input.chains)
  if (total === 0) return 'Select at least one residue to redesign.'
  if (input.mode === 'binder' && total < MIN_REDESIGN_RESIDUES) {
    return `Binder mode needs at least ${MIN_REDESIGN_RESIDUES} redesign residues (currently ${total}).`
  }
  if (input.mode === 'binder') {
    const hasBinder = input.chains.some((chain) => chain.role === 'binder')
    const hasTarget = input.chains.some((chain) => chain.role === 'target')
    if (!hasBinder || !hasTarget) return 'Binder mode needs one binder chain and at least one target chain.'
  }
  return null
}

/** Pipeline id to request builder for the generic submission flow. */
export const REQUEST_BUILDERS: Record<BoltzPipelineId, (input: never) => unknown> = {
  'structure-and-binding': buildPredictionBody as (input: never) => unknown,
  adme: buildAdmeBody as (input: never) => unknown,
  'small-molecule-design': buildSmallMoleculeDesignBody as (input: never) => unknown,
  'small-molecule-library-screen': buildSmallMoleculeScreenBody as (input: never) => unknown,
  'protein-design': buildProteinDesignBody as (input: never) => unknown,
  'protein-library-screen': buildProteinScreenBody as (input: never) => unknown,
  'protein-sequence-redesign': buildSequenceRedesignBody as (input: never) => unknown,
}
