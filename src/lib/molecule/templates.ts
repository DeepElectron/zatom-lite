/**
 * Molecular structure templates
 * Contains common molecules with pre-defined 3D coordinates (in Angstroms)
 * Reference: GaussianView molecule library
 */

import type { Atom } from '../crystal/types'
import { generateAtomId } from '../crystal/supercell-utils'

export { MOLECULE_TEMPLATES } from './molecule-template-xyz'
export type { MoleculeTemplate } from './molecule-template-xyz'
import { MOLECULE_TEMPLATES } from './molecule-template-xyz'
import { parseXYZ } from '../crystal/xyz-parser'

export interface FragmentTemplate {
  name: string
  formula: string
  atoms: Array<{ element: string; position: [number, number, number] }>
  bonds?: Array<{ from: number; to: number; type: 'single' | 'double' | 'triple' }>
}

// Fragment templates for building molecules
// First atom (index 0) is always the attachment point
export const FRAGMENT_TEMPLATES: Record<string, FragmentTemplate> = {
  methyl: {
    name: 'Methyl',
    formula: '-CH₃',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'H', position: [0.629, 0.629, 0.629] },
      { element: 'H', position: [-0.629, -0.629, 0.629] },
      { element: 'H', position: [-0.629, 0.629, -0.629] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'single' },
      { from: 0, to: 2, type: 'single' },
      { from: 0, to: 3, type: 'single' },
    ],
  },
  hydroxyl: {
    name: 'Hydroxyl',
    formula: '-OH',
    atoms: [
      { element: 'O', position: [0, 0, 0] },
      { element: 'H', position: [0.96, 0, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'single' },
    ],
  },
  amino: {
    name: 'Amino',
    formula: '-NH₂',
    atoms: [
      { element: 'N', position: [0, 0, 0] },
      { element: 'H', position: [0.47, 0.813, 0.33] },
      { element: 'H', position: [0.47, -0.813, 0.33] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'single' },
      { from: 0, to: 2, type: 'single' },
    ],
  },
  carboxyl: {
    name: 'Carboxyl',
    formula: '-COOH',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'O', position: [1.21, 0, 0] },
      { element: 'O', position: [-0.71, 1.01, 0] },
      { element: 'H', position: [-0.15, 1.80, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'double' },
      { from: 0, to: 2, type: 'single' },
      { from: 2, to: 3, type: 'single' },
    ],
  },
  phenyl: {
    name: 'Phenyl',
    formula: '-C₆H₅',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'C', position: [1.21, 0.70, 0] },
      { element: 'C', position: [1.21, 2.10, 0] },
      { element: 'C', position: [0, 2.80, 0] },
      { element: 'C', position: [-1.21, 2.10, 0] },
      { element: 'C', position: [-1.21, 0.70, 0] },
      { element: 'H', position: [2.15, 0.16, 0] },
      { element: 'H', position: [2.15, 2.64, 0] },
      { element: 'H', position: [0, 3.88, 0] },
      { element: 'H', position: [-2.15, 2.64, 0] },
      { element: 'H', position: [-2.15, 0.16, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'double' },
      { from: 1, to: 2, type: 'single' },
      { from: 2, to: 3, type: 'double' },
      { from: 3, to: 4, type: 'single' },
      { from: 4, to: 5, type: 'double' },
      { from: 5, to: 0, type: 'single' },
      { from: 1, to: 6, type: 'single' },
      { from: 2, to: 7, type: 'single' },
      { from: 3, to: 8, type: 'single' },
      { from: 4, to: 9, type: 'single' },
      { from: 5, to: 10, type: 'single' },
    ],
  },
  aldehyde: {
    name: 'Aldehyde',
    formula: '-CHO',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'O', position: [1.21, 0, 0] },
      { element: 'H', position: [-0.5, 0.87, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'double' },
      { from: 0, to: 2, type: 'single' },
    ],
  },
  nitro: {
    name: 'Nitro',
    formula: '-NO₂',
    atoms: [
      { element: 'N', position: [0, 0, 0] },
      { element: 'O', position: [1.10, 0.64, 0] },
      { element: 'O', position: [-1.10, 0.64, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'double' },
      { from: 0, to: 2, type: 'single' },
    ],
  },
  cyano: {
    name: 'Cyano',
    formula: '-CN',
    atoms: [
      { element: 'C', position: [0, 0, 0] },
      { element: 'N', position: [1.16, 0, 0] },
    ],
    bonds: [
      { from: 0, to: 1, type: 'triple' },
    ],
  },
}

/**
 * Create atoms from a molecule template
 * Returns atoms with Cartesian coordinates directly
 */
export function createAtomsFromMoleculeTemplate(templateKey: string): Atom[] {
  const moleculeTemplate = MOLECULE_TEMPLATES[templateKey]
  if (moleculeTemplate) {
    const parsed = parseXYZ(moleculeTemplate.xyz)
    if (!parsed.success) return []
    return parsed.data.atoms.map((atom) => ({
      id: generateAtomId(),
      element: atom.element,
      position: [0, 0, 0] as [number, number, number],
      cartesian: [...atom.cartesian] as [number, number, number],
    }))
  }

  const fragmentTemplate = FRAGMENT_TEMPLATES[templateKey]
  if (!fragmentTemplate) return []
  return fragmentTemplate.atoms.map((atom) => ({
    id: generateAtomId(),
    element: atom.element,
    position: [0, 0, 0] as [number, number, number],
    cartesian: [...atom.position] as [number, number, number],
  }))
}

/**
 * Create bonds from a molecule template
 */
export function createBondsFromMoleculeTemplate(templateKey: string, atoms: Atom[]): Array<{
  atom1Id: string
  atom2Id: string
  type: 'single' | 'double' | 'triple'
}> {
  const template = MOLECULE_TEMPLATES[templateKey] || FRAGMENT_TEMPLATES[templateKey]
  if (!template || !template.bonds) return []

  return template.bonds.map((bond) => ({
    atom1Id: atoms[bond.from].id,
    atom2Id: atoms[bond.to].id,
    type: bond.type,
  }))
}

/**
 * Get all molecule template keys
 */
export function getMoleculeTemplateKeys(): string[] {
  return Object.keys(MOLECULE_TEMPLATES)
}

/**
 * Get all fragment template keys
 */
export function getFragmentTemplateKeys(): string[] {
  return Object.keys(FRAGMENT_TEMPLATES)
}
