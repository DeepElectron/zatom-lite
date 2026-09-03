import { BIO_AMINO_ACIDS, BIO_NUCLEOTIDES } from "./constants"
import type { BioStructure } from "./types"

const ONE_LETTER: Readonly<Record<string, string>> = {
  ALA: "A",
  ARG: "R",
  ASN: "N",
  ASP: "D",
  CYS: "C",
  GLN: "Q",
  GLU: "E",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LEU: "L",
  LYS: "K",
  MET: "M",
  PHE: "F",
  PRO: "P",
  SER: "S",
  THR: "T",
  TRP: "W",
  TYR: "Y",
  VAL: "V",
  MSE: "M",
  SEC: "U",
  PYL: "O",
  A: "a",
  C: "c",
  G: "g",
  U: "u",
  T: "t",
  I: "i",
  DA: "a",
  DC: "c",
  DG: "g",
  DT: "t",
  DU: "u",
  DI: "i",
}

export interface BioSequenceResidue {
  residueIndex: number
  chainIndex: number
  chainId: string
  sequenceNumber: number
  insertionCode: string
  residueName: string
  symbol: string
  secondaryStructure: "helix" | "sheet" | "coil"
}

export interface BioSequenceChain {
  chainIndex: number
  chainId: string
  polymerType: "protein" | "nucleic" | "other"
  residues: BioSequenceResidue[]
  sequence: string
}

export function bioResidueOneLetterCode(residueName: string): string {
  return ONE_LETTER[residueName.toUpperCase()] ?? "X"
}

export function buildBioSequenceChains(structure: BioStructure): BioSequenceChain[] {
  return structure.chains
    .map((chain) => {
      const residues = chain.residueIndices
        .map((residueIndex): BioSequenceResidue | null => {
          const residue = structure.residues[residueIndex]
          if (!BIO_AMINO_ACIDS.has(residue.name) && !BIO_NUCLEOTIDES.has(residue.name)) return null
          return {
            residueIndex,
            chainIndex: chain.index,
            chainId: chain.identifier,
            sequenceNumber: residue.identity.sequenceNumber,
            insertionCode: residue.identity.insertionCode,
            residueName: residue.name,
            symbol: bioResidueOneLetterCode(residue.name),
            secondaryStructure: residue.secondaryStructure,
          }
        })
        .filter((value): value is BioSequenceResidue => value !== null)
      return {
        chainIndex: chain.index,
        chainId: chain.identifier,
        polymerType: chain.polymerType,
        residues,
        sequence: residues.map((residue) => residue.symbol).join(""),
      }
    })
    .filter((chain) => chain.residues.length > 0)
}

export function bioResidueIndicesToAtomSet(
  structure: BioStructure,
  residueIndices: Iterable<number>,
): ReadonlySet<number> {
  const result = new Set<number>()
  for (const residueIndex of residueIndices) {
    const residue = structure.residues[residueIndex]
    if (!residue) continue
    for (const atomIndex of residue.atomIndices) result.add(atomIndex)
  }
  return result
}

/**
 * Return a drag range within one sequence row. Residue indices are topology
 * identities, not a license to cross into intervening chains.
 */
export function bioResidueIndicesInChainRange(
  structure: BioStructure,
  chainIndex: number,
  startResidueIndex: number,
  endResidueIndex: number,
): number[] {
  const low = Math.min(startResidueIndex, endResidueIndex)
  const high = Math.max(startResidueIndex, endResidueIndex)
  return structure.residues
    .filter((residue) => (
      residue.chainIndex === chainIndex
      && residue.index >= low
      && residue.index <= high
      && residue.isStandard
    ))
    .map((residue) => residue.index)
}

export function bioAtomSetToResidueIndices(
  structure: BioStructure,
  atomIndices: Iterable<number>,
): ReadonlySet<number> {
  const result = new Set<number>()
  for (const atomIndex of atomIndices) {
    const atom = structure.atoms[atomIndex]
    if (atom) result.add(atom.residueIndex)
  }
  return result
}
