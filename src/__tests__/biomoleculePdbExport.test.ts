import { describe, expect, it } from 'vitest'

import { exportLegacyPdb } from '../lib/biomolecule/pdb-export'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import {
  biomoleculeSelectionLabel,
  biomoleculeSelectionLabels,
} from '../lib/biomolecule/selection-label'
import { createCrystalStore } from '../orchestration/crystalStore'
import { createStructureTextExport } from '../services/structure-text-export'

function atomLine(options: {
  record?: 'ATOM' | 'HETATM'
  serial: number
  name: string
  residue: string
  chain: string
  sequence: number
  x: number
  y: number
  z: number
  element: string
  charge?: string
}): string {
  const line = Array<string>(80).fill(' ')
  const put = (start: number, end: number, value: string, left = false) => {
    const text = left ? value.padEnd(end - start) : value.padStart(end - start)
    for (let index = 0; index < end - start; index += 1) line[start + index] = text[index]
  }
  put(0, 6, options.record ?? 'ATOM', true)
  put(6, 11, String(options.serial))
  put(12, 16, options.name.length < 4 && options.element.length === 1 ? ` ${options.name.padEnd(3)}` : options.name, true)
  put(17, 20, options.residue)
  put(21, 22, options.chain, true)
  put(22, 26, String(options.sequence))
  put(30, 38, options.x.toFixed(3))
  put(38, 46, options.y.toFixed(3))
  put(46, 54, options.z.toFixed(3))
  put(54, 60, '1.00')
  put(60, 66, '12.00')
  put(76, 78, options.element)
  put(78, 80, options.charge ?? '')
  return line.join('').trimEnd()
}

const MODEL_1 = [
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'A', sequence: 1, x: 0, y: 0, z: 0, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'A', sequence: 1, x: 1.4, y: 0, z: 0, element: 'C' }),
  atomLine({ record: 'HETATM', serial: 3, name: 'ZN', residue: 'ZN', chain: 'B', sequence: 2, x: 3, y: 0, z: 0, element: 'Zn', charge: '2+' }),
]

const MODEL_2 = [
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'A', sequence: 1, x: 0, y: 2, z: 0, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'A', sequence: 1, x: 1.4, y: 2, z: 0, element: 'C' }),
  atomLine({ record: 'HETATM', serial: 3, name: 'ZN', residue: 'ZN', chain: 'B', sequence: 2, x: 3, y: 2, z: 0, element: 'Zn', charge: '2+' }),
]

const PDB = [
  'TITLE     BIOMOLECULE EXPORT FIXTURE',
  'MODEL        1',
  ...MODEL_1,
  'ENDMDL',
  'MODEL        2',
  ...MODEL_2,
  'ENDMDL',
  'CONECT    1    2    2',
  'END',
].join('\n')

describe('biomolecular PDB export', () => {
  it('round-trips topology, residue identity, models, explicit bond order, and charge', () => {
    const source = parseLegacyPdb(PDB, { inferBonds: false })
    const exported = exportLegacyPdb(source)
    const restored = parseLegacyPdb(exported, { inferBonds: false })

    expect(exported).toContain('MODEL')
    expect(exported).toContain('HETATM')
    expect(restored.title).toBe('BIOMOLECULE EXPORT FIXTURE')
    expect(restored.frames).toHaveLength(2)
    expect(restored.atoms.map((atom) => atom.name)).toEqual(['N', 'CA', 'ZN'])
    expect(restored.atoms[2].formalCharge).toBe(2)
    expect(restored.residues[0].identity).toEqual({ chainId: 'A', sequenceNumber: 1, insertionCode: '' })
    expect(restored.bonds).toHaveLength(1)
    expect(restored.bonds[0].order).toBe(2)
    expect(restored.frames[1].positions[1] - restored.frames[0].positions[1]).toBeCloseTo(2, 3)
  })

  it('uses biomolecular identity labels and routes formats by document semantics', () => {
    const structure = parseLegacyPdb(PDB, { inferBonds: false })
    expect(biomoleculeSelectionLabel(structure, 1)).toBe('CA · ALA A1')
    const residueSelection = new Set(structure.residues[0].atomIndices.map((index) => structure.atoms[index].id))
    expect(biomoleculeSelectionLabels(structure, residueSelection, false).map((label) => label.text))
      .toEqual(['ALA A1 · 2 atoms'])
    expect(biomoleculeSelectionLabels(structure, residueSelection, true).map((label) => label.text))
      .toEqual(['N · ALA A1', 'CA · ALA A1'])
    const multiResidueSelection = new Set([...residueSelection, structure.atoms[2].id])
    expect(biomoleculeSelectionLabels(structure, multiResidueSelection, false)[0].text)
      .toBe('2 residues · 3 atoms')

    const store = createCrystalStore()
    expect(store.getState().bioShowSelectedAtomDetails).toBe(false)
    store.getState().loadBiomolecule(structure)
    store.setState({ periodic: true })
    expect(createStructureTextExport(store.getState(), 'sample').format).toBe('pdb')

    store.getState().clearBiomolecule()
    expect(createStructureTextExport(store.getState(), 'sample').format).toBe('cif')
    store.setState({ periodic: false })
    expect(createStructureTextExport(store.getState(), 'sample').format).toBe('xyz')
  })
})
