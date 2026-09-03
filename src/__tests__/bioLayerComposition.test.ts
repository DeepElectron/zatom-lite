import { describe, expect, it } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { resolveBioLayerComposition } from '../lib/biomolecule/layer-composition'
import type { BioLayer } from '../lib/biomolecule/types'

// Two ATOM records and one HETATM water distinguish layer ownership from layer drawing.
const PDB = [
  'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N',
  'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00  0.00           C',
  'ATOM      3  C   ALA A   1       2.009   1.420   0.000  1.00  0.00           C',
  'ATOM      4  N   GLY A   2       3.332   1.548   0.000  1.00  0.00           N',
  'ATOM      5  CA  GLY A   2       3.987   2.845   0.000  1.00  0.00           C',
  'ATOM      6  C   GLY A   2       5.500   2.750   0.000  1.00  0.00           C',
  'HETATM    7  O   HOH B   1      12.000   8.000  10.000  1.00  0.00           O',
  'END',
].join('\n')

function layer(overrides: Partial<BioLayer> & { id: string; selection: string }): BioLayer {
  return {
    name: overrides.id,
    representation: 'ball-and-stick',
    visible: true,
    color: { mode: 'inherit' },
    scale: 1,
    bondScale: 1,
    opacity: 1,
    shading: null,
    materialPresetId: null,
    ...overrides,
  }
}

describe('resolveBioLayerComposition ownership', () => {
  const structure = parseLegacyPdb(PDB)
  const waterIndex = structure.atoms.length - 1

  it('a hidden layer still owns its atoms so builtin channels cannot redraw them', () => {
    // Ownership must not derive from visible draw sets, or hidden atoms return to built-in channels.
    const water = layer({ id: 'water', selection: 'chain B', visible: false })
    const plan = resolveBioLayerComposition(structure, [water], 0)

    expect(plan.layerAtomIndices.get('water')?.size).toBe(0)
    expect(plan.claimedAtomIndices.has(waterIndex)).toBe(true)
  })

  it('a visible layer both draws and owns its atoms', () => {
    const water = layer({ id: 'water', selection: 'chain B' })
    const plan = resolveBioLayerComposition(structure, [water], 0)

    expect(plan.layerAtomIndices.get('water')?.has(waterIndex)).toBe(true)
    expect(plan.claimedAtomIndices.has(waterIndex)).toBe(true)
  })

  it('a hidden cartoon layer keeps residue ownership', () => {
    // Hidden cartoon layers retain residue ownership and remain excluded from built-in cartoons.
    const chain = layer({ id: 'chainA', selection: 'chain A', representation: 'cartoon', visible: false })
    const plan = resolveBioLayerComposition(structure, [chain], 0)

    expect(plan.layerResidueIndices.get('chainA')?.size).toBe(0)
    expect(plan.claimedResidueIndices.size).toBeGreaterThan(0)
  })

  it('upper layers win ownership over lower layers for overlapping selections', () => {
    const top = layer({ id: 'top', selection: 'chain B' })
    const bottom = layer({ id: 'bottom', selection: 'chain B' })
    const plan = resolveBioLayerComposition(structure, [top, bottom], 0)

    expect(plan.layerAtomIndices.get('top')?.has(waterIndex)).toBe(true)
    expect(plan.layerAtomIndices.get('bottom')?.has(waterIndex)).toBe(false)
  })
})
