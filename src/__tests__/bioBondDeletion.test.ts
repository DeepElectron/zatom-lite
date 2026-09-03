import { describe, expect, it } from 'vitest'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { createCrystalStore } from '../orchestration/crystalStore'

/**
 * Chain A is the ATOM polymer and chain Z is an imported HETATM ligand. Coordinates use
 * 1.2-1.5-angstrom distances so bond inference is deterministic.
 */
function pdbLine(options: {
  record: 'ATOM  ' | 'HETATM'
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
  return [
    options.record,
    String(options.serial).padStart(5),
    ' ',
    options.name.padStart(4),
    ' ',
    options.residue.padStart(3),
    ' ',
    options.chain,
    String(options.sequence).padStart(4),
    '    ',
    coordinate(options.x),
    coordinate(options.y),
    coordinate(options.z),
    '  1.00',
    '  0.00',
    '          ',
    options.element.padStart(2),
  ].join('')
}

const PDB = [
  // Polymer GLY backbone N-CA-C.
  pdbLine({ record: 'ATOM  ', serial: 1, name: 'N', residue: 'GLY', chain: 'A', sequence: 1, x: 0, y: 0, z: 0, element: 'N' }),
  pdbLine({ record: 'ATOM  ', serial: 2, name: 'CA', residue: 'GLY', chain: 'A', sequence: 1, x: 1.45, y: 0, z: 0, element: 'C' }),
  pdbLine({ record: 'ATOM  ', serial: 3, name: 'C', residue: 'GLY', chain: 'A', sequence: 1, x: 2.9, y: 0, z: 0, element: 'C' }),
  // NH3 ligand with one N and three H atoms.
  pdbLine({ record: 'HETATM', serial: 4, name: 'N1', residue: 'NH3', chain: 'Z', sequence: 1, x: 20, y: 20, z: 20, element: 'N' }),
  pdbLine({ record: 'HETATM', serial: 5, name: 'H1', residue: 'NH3', chain: 'Z', sequence: 1, x: 21.01, y: 20, z: 20, element: 'H' }),
  pdbLine({ record: 'HETATM', serial: 6, name: 'H2', residue: 'NH3', chain: 'Z', sequence: 1, x: 19.5, y: 20.87, z: 20, element: 'H' }),
  'END',
].join('\n')

function loadedStore() {
  const store = createCrystalStore()
  store.getState().loadBiomolecule(parseLegacyPdb(PDB, { inferBonds: true }))
  return store
}

/** Find a bond whose endpoints both belong to one chain. */
function bondInChain(store: ReturnType<typeof loadedStore>, chainId: string): string {
  const structure = store.getState().bioStructure!
  const bond = structure.bonds.find((candidate) => (
    structure.residues[structure.atoms[candidate.atomIndex1].residueIndex].identity.chainId === chainId
    && structure.residues[structure.atoms[candidate.atomIndex2].residueIndex].identity.chainId === chainId
  ))
  if (!bond) throw new Error(`no intra-chain bond found for chain ${chainId}`)
  return bond.id
}

describe('生物场景删除共价键', () => {
  it('删配体键只移除那根键,不核掉生物文档', () => {
    const store = loadedStore()
    const before = store.getState().bonds.length
    const ligandBond = bondInChain(store, 'Z')

    expect(store.getState().deleteBioBonds([ligandBond])).toBe('deleted')

    // Preserve the biomolecular document so cartoon rendering does not degrade into loose atoms.
    expect(store.getState().bioStructure).not.toBeNull()
    expect(store.getState().bonds.length).toBe(before - 1)
    expect(store.getState().bonds.some((bond) => bond.id === ligandBond)).toBe(false)
  })

  it('拒绝删聚合物主体的键', () => {
    const store = loadedStore()
    const before = store.getState().bonds.length

    expect(store.getState().deleteBioBonds([bondInChain(store, 'A')])).toBe('polymer-forbidden')

    expect(store.getState().bioStructure).not.toBeNull()
    expect(store.getState().bonds.length).toBe(before)
  })

  it('混选时删掉配体键并保留主体键', () => {
    const store = loadedStore()
    const before = store.getState().bonds.length

    const result = store.getState().deleteBioBonds([bondInChain(store, 'Z'), bondInChain(store, 'A')])

    expect(result).toBe('partial')
    expect(store.getState().bonds.length).toBe(before - 1)
  })

  it('删掉的配体键在结构重解析后不会被距离推断复原', () => {
    const store = loadedStore()
    const ligandBond = bondInChain(store, 'Z')
    store.getState().deleteBioBonds([ligandBond])
    const afterDelete = store.getState().bonds.length

    // Deleting a polymer atom triggers the full export, reparse, and bond-inference cycle.
    const polymerAtomId = store.getState().bioStructure!.atoms
      .find((atom) => atom.recordType === 'ATOM')!.id
    expect(store.getState().deleteBioAtoms(new Set([polymerAtomId]))).toBe(true)

    // Suppression uses chemical identity so it survives serial-number reassignment.
    const structure = store.getState().bioStructure!
    const revived = structure.bonds.some((bond) => {
      const first = structure.atoms[bond.atomIndex1]
      const second = structure.atoms[bond.atomIndex2]
      return first.recordType === 'HETATM' && second.recordType === 'HETATM'
    })
    const stillDrawn = store.getState().bonds.length
    expect(store.getState().bioSuppressedBondKeys.size).toBe(1)
    // The parser may infer the bond again, but the rendered bond list must exclude it.
    if (revived) expect(stillDrawn).toBeLessThan(structure.bonds.length)
    expect(stillDrawn).toBeLessThanOrEqual(afterDelete)
  })
})
