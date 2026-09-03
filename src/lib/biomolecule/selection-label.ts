import { bioResidueKey } from './constants'
import type { BioResidue, BioStructure, BioVector3 } from './types'

export interface BiomoleculeSelectionLabelItem {
  key: string
  text: string
  position: BioVector3
}

/**
 * Residue identity key → user-visible name.
 *
 * The dragged molecule can only have 3 characters in the PDB layer, and the amino acid name cannot be collated, so when the name is collided, it will be reduced to a placeholder.
 * of `LIG`. Copying `LIG` on the viewport is equivalent to giving the user's molecule the wrong label of "unknown ligand" -
 * The real name is in the layer and is passed in by the caller to overlay and display.
 */
export type BiomoleculeResidueDisplayNames = ReadonlyMap<string, string>

function residueDisplayName(residue: BioResidue, displayNames?: BiomoleculeResidueDisplayNames): string {
  return displayNames?.get(bioResidueKey(residue.identity)) ?? residue.name
}

/**
 * Placeholder residue name: the yield result of appendBioHetComponent when the amino acid/nucleotide name is collided.
 */
const BIO_PLACEHOLDER_RESIDUE_NAME = 'LIG'

/**
 * Only add the real name of the layer to which the residue of the placeholder name `LIG` belongs.
 *
 * Deliberately not covering other residue names: ATP, HEM, HOH these are correct chemical identities and are more precise than layer names,
 * Covered is another wrong label. The parameters take the smallest shape to avoid the lib layer's reverse dependence on orchestration.
 */
export function biomoleculePlaceholderDisplayNames(
  structure: BioStructure,
  groups: readonly { name: string, bioResidueKeys?: readonly string[] }[],
): BiomoleculeResidueDisplayNames | undefined {
  const placeholderKeys = new Set(
    structure.residues
      .filter((residue) => residue.name === BIO_PLACEHOLDER_RESIDUE_NAME)
      .map((residue) => bioResidueKey(residue.identity)),
  )
  if (placeholderKeys.size === 0) return undefined
  const displayNames = new Map<string, string>()
  for (const group of groups) {
    const name = group.name.trim()
    if (!name || !group.bioResidueKeys) continue
    for (const key of group.bioResidueKeys) {
      if (placeholderKeys.has(key)) displayNames.set(key, name)
    }
  }
  return displayNames.size > 0 ? displayNames : undefined
}

/** Compact viewport identity for a selected biomolecular atom. */
export function biomoleculeSelectionLabel(
  structure: BioStructure,
  atomIndex: number,
  displayNames?: BiomoleculeResidueDisplayNames,
): string {
  const atom = structure.atoms[atomIndex]
  if (!atom) return ''
  const residue = structure.residues[atom.residueIndex]
  const atomName = atom.name.trim() || atom.element
  if (!residue) return atomName
  const chain = residue.identity.chainId || '∅'
  return `${atomName} · ${residueDisplayName(residue, displayNames)} ${chain}${residue.identity.sequenceNumber}${residue.identity.insertionCode}`
}

function centroid(structure: BioStructure, atomIndices: readonly number[]): BioVector3 {
  const sum = atomIndices.reduce<[number, number, number]>((current, atomIndex) => {
    const position = structure.atoms[atomIndex].position
    current[0] += position[0]
    current[1] += position[1]
    current[2] += position[2]
    return current
  }, [0, 0, 0])
  const count = Math.max(1, atomIndices.length)
  return [sum[0] / count, sum[1] / count + .8, sum[2] / count]
}

/**
 * Biomolecules default to a compact selection summary. Full per-atom labels
 * are opt-in because residue and range selections otherwise obscure the model.
 */
export function biomoleculeSelectionLabels(
  structure: BioStructure,
  selectedAtomIds: ReadonlySet<string>,
  showAtomDetails: boolean,
  displayNames?: BiomoleculeResidueDisplayNames,
): BiomoleculeSelectionLabelItem[] {
  const selected = structure.atoms.filter((atom) => selectedAtomIds.has(atom.id))
  if (selected.length === 0) return []
  if (showAtomDetails || selected.length === 1) {
    return selected.map((atom) => ({
      key: `atom-${atom.id}`,
      text: biomoleculeSelectionLabel(structure, atom.index, displayNames),
      position: [atom.position[0], atom.position[1] + .8, atom.position[2]],
    }))
  }

  const residueIndices = new Set(selected.map((atom) => atom.residueIndex))
  const atomIndices = selected.map((atom) => atom.index)
  if (residueIndices.size === 1) {
    const residue = structure.residues[residueIndices.values().next().value!]
    const chain = residue.identity.chainId || '∅'
    return [{
      key: `residue-${residue.id}`,
      text: `${residueDisplayName(residue, displayNames)} ${chain}${residue.identity.sequenceNumber}${residue.identity.insertionCode} · ${selected.length} atoms`,
      position: centroid(structure, atomIndices),
    }]
  }
  return [{
    key: 'selection-summary',
    text: `${residueIndices.size} residues · ${selected.length} atoms`,
    position: centroid(structure, atomIndices),
  }]
}
