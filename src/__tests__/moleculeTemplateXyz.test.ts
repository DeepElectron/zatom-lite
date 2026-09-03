import { describe, expect, it } from 'vitest'

import { parseXYZ } from '../lib/crystal/xyz-parser'
import {
  MOLECULE_TEMPLATES,
  createAtomsFromMoleculeTemplate,
  createBondsFromMoleculeTemplate,
} from '../lib/molecule/templates'

describe('XYZ-backed molecule templates', () => {
  it('stores every built-in molecule as valid standard XYZ', () => {
    expect(Object.keys(MOLECULE_TEMPLATES).length).toBeGreaterThan(0)

    for (const [key, template] of Object.entries(MOLECULE_TEMPLATES)) {
      expect(template.format, key).toBe('xyz')
      expect(template.xyz.split(/\r?\n/)[1], key).toContain(template.name)

      const parsed = parseXYZ(template.xyz)
      expect(parsed.success, key).toBe(true)
      if (!parsed.success) continue
      expect(parsed.data.isTrajectory, key).toBe(false)
      expect(parsed.data.atoms.length, key).toBeGreaterThan(0)
      expect(parsed.data.atoms.every((atom) => atom.cartesian.every(Number.isFinite)), key).toBe(true)
    }
  })

  it('keeps compatibility atom and explicit bond adapters sourced from XYZ', () => {
    for (const [key, template] of Object.entries(MOLECULE_TEMPLATES)) {
      const atoms = createAtomsFromMoleculeTemplate(key)
      const parsed = parseXYZ(template.xyz)
      expect(parsed.success, key).toBe(true)
      if (!parsed.success) continue
      expect(atoms.map((atom) => atom.element), key)
        .toEqual(parsed.data.atoms.map((atom) => atom.element))
      expect(atoms.map((atom) => atom.cartesian), key)
        .toEqual(parsed.data.atoms.map((atom) => atom.cartesian))

      const bonds = createBondsFromMoleculeTemplate(key, atoms)
      expect(bonds, key).toHaveLength(template.bonds?.length ?? 0)
      expect(bonds.every((bond) => atoms.some((atom) => atom.id === bond.atom1Id)
        && atoms.some((atom) => atom.id === bond.atom2Id)), key).toBe(true)
    }
  })
})
