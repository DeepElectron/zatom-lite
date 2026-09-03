/** Engine-neutral atom properties used to preserve biomolecular naming and residue identity. */

export const ZATOM_BIOMOLECULAR_IDENTITY_SCHEMA = 'zatom.biomolecular-identity/v1' as const
export const ZATOM_BIOMOLECULAR_IDENTITY_METADATA_KEY = 'zatom.bio.identityAssignment' as const

export const ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES = {
  chainId: 'zatom.bio.chainId',
  residueName: 'zatom.bio.residueName',
  residueId: 'zatom.bio.residueId',
  insertionCode: 'zatom.bio.insertionCode',
  atomName: 'zatom.bio.atomName',
} as const

export const ZATOM_BIOMOLECULAR_IDENTITY_PREFIX = 'zatom.bio.' as const

/**
 * Experimental annotation carried alongside identity, all optional.
 *
 * Kept separate from the identity properties because the two answer different
 * questions and have different guarantees. Identity *names* an atom and a reader
 * that emits any of it emits all of it; annotation *describes* the experiment
 * behind that atom — an authoritative HELIX/SHEET assignment, an alternate
 * conformation, occupancy, a B-factor — and any one of these may be absent even
 * when identity is complete (a computed model has residues but no B-factors).
 *
 * Consumers must therefore treat every key here as missing-by-default and say so
 * in their output: reporting a geometric secondary-structure estimate as if it
 * came from the file would be a quiet lie, which is exactly what
 * `secondaryStructure` exists to prevent.
 */
export const ZATOM_BIOMOLECULAR_ANNOTATION_PROPERTIES = {
  /** Authoritative assignment from the file: "helix" | "sheet" | "coil". */
  secondaryStructure: 'zatom.bio.secondaryStructure',
  /** PDB altLoc character; empty or absent means the single/primary conformer. */
  alternateLocation: 'zatom.bio.alternateLocation',
  /** Crystallographic occupancy in 0..1. */
  occupancy: 'zatom.bio.occupancy',
  /** Temperature factor in A^2. */
  bFactor: 'zatom.bio.bFactor',
  /** MODEL number for multi-model files (NMR ensembles). */
  modelNumber: 'zatom.bio.modelNumber',
  /** mmCIF entity id, which groups identical chains of an assembly. */
  entityId: 'zatom.bio.entityId',
} as const
