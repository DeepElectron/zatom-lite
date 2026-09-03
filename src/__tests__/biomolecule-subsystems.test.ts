import { describe, expect, it } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import {
  bioAtomicBaseAtomIndices,
  bioBaseChannelAtomSets,
  bioDisulfideAtomPairs,
  bioPocketAtomIndices,
  classifyBioSubsystemAtoms,
} from '../lib/biomolecule/subsystems'

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
}): string {
  const coordinate = (value: number) => value.toFixed(3).padStart(8)
  return `${(options.record ?? 'ATOM').padEnd(6)}${String(options.serial).padStart(5)} ${options.name.padStart(4)} ${options.residue.padStart(3)} ${options.chain}${String(options.sequence).padStart(4)}    ${coordinate(options.x)}${coordinate(options.y)}${coordinate(options.z)}  1.00 10.00          ${options.element.padStart(2)}`
}

const STRUCTURE = parseLegacyPdb([
  atomLine({ serial: 1, name: 'N', residue: 'ALA', chain: 'A', sequence: 1, x: 0, y: 0, z: 0, element: 'N' }),
  atomLine({ serial: 2, name: 'CA', residue: 'ALA', chain: 'A', sequence: 1, x: 1, y: 0, z: 0, element: 'C' }),
  atomLine({ serial: 3, name: 'N', residue: 'GLY', chain: 'A', sequence: 2, x: 8, y: 0, z: 0, element: 'N' }),
  atomLine({ serial: 4, name: 'CA', residue: 'GLY', chain: 'A', sequence: 2, x: 9, y: 0, z: 0, element: 'C' }),
  atomLine({ record: 'HETATM', serial: 5, name: 'O', residue: 'HOH', chain: 'A', sequence: 3, x: 12, y: 0, z: 0, element: 'O' }),
  atomLine({ record: 'HETATM', serial: 6, name: 'C1', residue: 'LIG', chain: 'A', sequence: 4, x: 2, y: 0, z: 0, element: 'C' }),
  atomLine({ record: 'HETATM', serial: 7, name: 'O1', residue: 'LIG', chain: 'A', sequence: 4, x: 3, y: 0, z: 0, element: 'O' }),
  atomLine({ record: 'HETATM', serial: 8, name: 'ZN', residue: 'ZN', chain: 'A', sequence: 5, x: 15, y: 0, z: 0, element: 'Zn' }),
].join('\n'), { inferBonds: false })

describe('built-in biomolecule subsystems', () => {
  it('classifies polymer, water, multi-atom ligand and single-atom ion without overlap', () => {
    const classified = classifyBioSubsystemAtoms(STRUCTURE)
    expect([...classified.polymer]).toEqual([0, 1, 2, 3])
    expect([...classified.water]).toEqual([4])
    expect([...classified.ligand]).toEqual([5, 6])
    expect([...classified.ion]).toEqual([7])
    const all = [classified.polymer, classified.water, classified.ligand, classified.ion]
    expect(new Set(all.flatMap((set) => [...set])).size).toBe(STRUCTURE.atoms.length)
    expect([...bioAtomicBaseAtomIndices(classified, true)]).toEqual([0, 1, 2, 3])
    expect([...bioAtomicBaseAtomIndices(classified, false)]).toEqual([0, 1, 2, 3, 4])
  })

  it('selects whole polymer residues dynamically within the requested ligand radius', () => {
    const ligand = classifyBioSubsystemAtoms(STRUCTURE).ligand
    expect([...bioPocketAtomIndices(STRUCTURE, ligand, 2.1)]).toEqual([0, 1])
    expect([...bioPocketAtomIndices(STRUCTURE, ligand, 6)]).toEqual([0, 1, 2, 3])
    expect([...bioPocketAtomIndices(STRUCTURE, ligand, 0)]).toEqual([])
  })

  it('keeps stackable cartoon/surface polymer-only while atomic channels share visible water', () => {
    const classified = classifyBioSubsystemAtoms(STRUCTURE)
    const visibleWater = bioBaseChannelAtomSets(classified, false)
    expect([...visibleWater.polymer]).toEqual([0, 1, 2, 3])
    expect([...visibleWater.atomic]).toEqual([0, 1, 2, 3, 4])

    const hiddenWater = bioBaseChannelAtomSets(classified, true)
    expect([...hiddenWater.polymer]).toEqual([0, 1, 2, 3])
    expect([...hiddenWater.atomic]).toEqual([0, 1, 2, 3])
  })

  it('uses explicit disulfide bond provenance before geometry fallback', () => {
    const structure = structuredClone(STRUCTURE)
    structure.bonds.push({
      id: 'ss', index: 0, atomIndex1: 0, atomIndex2: 3,
      atomId1: structure.atoms[0].id, atomId2: structure.atoms[3].id,
      order: 1, kind: 'disulfide', source: 'ssbond',
    })
    expect(bioDisulfideAtomPairs(structure)).toEqual([[0, 3]])
  })
})
