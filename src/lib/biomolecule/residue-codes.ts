/**
 * Residue name to one-letter code.
 *
 * Sequence is the densest structural channel that exists for a protein: twenty
 * distinct symbols over a chain, against the ~3 effective symbols of per-atom
 * element composition. Without it a chain can only be described by its shape;
 * with it, motifs, active sites, and chemistry become nameable.
 *
 * Pure module: plain data in, plain data out.
 */

/** Standard amino acids. */
const AMINO_ACIDS: Record<string, string> = {
  ALA: 'A',
  ARG: 'R',
  ASN: 'N',
  ASP: 'D',
  CYS: 'C',
  GLN: 'Q',
  GLU: 'E',
  GLY: 'G',
  HIS: 'H',
  ILE: 'I',
  LEU: 'L',
  LYS: 'K',
  MET: 'M',
  PHE: 'F',
  PRO: 'P',
  SER: 'S',
  THR: 'T',
  TRP: 'W',
  TYR: 'Y',
  VAL: 'V',
}

/**
 * Common modified and alternate-protonation residues, mapped to their parent.
 *
 * These appear routinely in deposited structures. Rendering them as `X` would
 * punch holes in the sequence at exactly the positions that tend to matter —
 * catalytic histidines and disulfide cysteines are the usual carriers.
 */
const MODIFIED_AMINO_ACIDS: Record<string, string> = {
  // Histidine protonation states, as written by common preparation tools.
  HID: 'H',
  HIE: 'H',
  HIP: 'H',
  HSD: 'H',
  HSE: 'H',
  HSP: 'H',
  // Cysteine variants: disulfide-bonded, deprotonated, metal-coordinating.
  CYX: 'C',
  CYM: 'C',
  CSO: 'C',
  // Selenomethionine, ubiquitous in crystallography for phasing.
  MSE: 'M',
  // Protonated / neutral acid forms.
  ASH: 'D',
  GLH: 'E',
  // Neutral / protonated lysine.
  LYN: 'K',
  // Phosphorylated residues keep their parent identity.
  SEP: 'S',
  TPO: 'T',
  PTR: 'Y',
  // Pyroglutamate and hydroxyproline.
  PCA: 'E',
  HYP: 'P',
}

/** Nucleic acid residues, in the several spellings deposited files use. */
const NUCLEOTIDES: Record<string, string> = {
  DA: 'a',
  DC: 'c',
  DG: 'g',
  DT: 't',
  DU: 'u',
  A: 'a',
  C: 'c',
  G: 'g',
  T: 't',
  U: 'u',
  ADE: 'a',
  CYT: 'c',
  GUA: 'g',
  THY: 't',
  URA: 'u',
}

/**
 * Placeholder for a polymer residue whose name is not recognised.
 *
 * Deliberately distinct from any real code so a sequence never silently claims
 * an identity it does not have.
 */
export const UNKNOWN_RESIDUE_CODE = 'X'

/**
 * One-letter code for a residue name, or `X` when unrecognised.
 *
 * Nucleotides return lowercase so a nucleic chain is distinguishable from a
 * peptide at a glance without a separate type field.
 */
export const residueOneLetterCode = (residueName: string): string => {
  const name = residueName.trim().toUpperCase()
  return (
    AMINO_ACIDS[name] ??
    MODIFIED_AMINO_ACIDS[name] ??
    NUCLEOTIDES[name] ??
    UNKNOWN_RESIDUE_CODE
  )
}

/** True when the name is a recognised polymer residue rather than a ligand. */
export const isKnownPolymerResidue = (residueName: string): boolean => {
  const name = residueName.trim().toUpperCase()
  return (
    name in AMINO_ACIDS || name in MODIFIED_AMINO_ACIDS || name in NUCLEOTIDES
  )
}
