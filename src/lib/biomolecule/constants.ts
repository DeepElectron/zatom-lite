export const BIO_AMINO_ACIDS = new Set([
  "ALA",
  "ARG",
  "ASN",
  "ASP",
  "CYS",
  "GLN",
  "GLU",
  "GLY",
  "HIS",
  "ILE",
  "LEU",
  "LYS",
  "MET",
  "PHE",
  "PRO",
  "SER",
  "THR",
  "TRP",
  "TYR",
  "VAL",
  "MSE",
  "SEC",
  "PYL",
])

export const BIO_NUCLEOTIDES = new Set([
  "A",
  "C",
  "G",
  "U",
  "T",
  "I",
  "DA",
  "DC",
  "DG",
  "DT",
  "DU",
  "DI",
])

export const BIO_WATER_RESIDUES = new Set(["HOH", "WAT", "DOD"])

export const BIO_HYDROPHOBICITY: Readonly<Record<string, number>> = {
  ILE: 4.5,
  VAL: 4.2,
  LEU: 3.8,
  PHE: 2.8,
  CYS: 2.5,
  MET: 1.9,
  ALA: 1.8,
  GLY: -0.4,
  THR: -0.7,
  SER: -0.8,
  TRP: -0.9,
  TYR: -1.3,
  PRO: -1.6,
  HIS: -3.2,
  GLU: -3.5,
  GLN: -3.5,
  ASP: -3.5,
  ASN: -3.5,
  LYS: -3.9,
  ARG: -4.5,
}

export const BIO_PROTEIN_BACKBONE_ATOMS = new Set(["N", "CA", "C", "O", "OXT"])

export const BIO_NUCLEIC_BACKBONE_ATOMS = new Set([
  "P",
  "OP1",
  "OP2",
  "O5'",
  "C5'",
  "C4'",
  "C3'",
  "O3'",
  "O4'",
  "C2'",
  "C1'",
  "O2'",
])

export function isStandardBioResidue(name: string): boolean {
  const normalized = name.toUpperCase()
  return BIO_AMINO_ACIDS.has(normalized) || BIO_NUCLEOTIDES.has(normalized)
}

/**
 * Stable residue identity across export and reparse. Atom serials and topology
 * indices may change, while chain, sequence number, and insertion code remain
 * stable. NUL separators prevent concatenation collisions.
 */
export function bioResidueKey(identity: {
  chainId: string
  sequenceNumber: number
  insertionCode: string
}): string {
  return `${identity.chainId}\u0000${identity.sequenceNumber}\u0000${identity.insertionCode}`
}
