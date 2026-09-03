import type { Atom, Bond, LatticeVectors } from '../crystal/types'
import { autoDetectBonds } from '../crystal/bonds'
import type { CubData } from './CubParser'
import type { MoldenData } from './MoldenParser'

const IDENTITY_LATTICE_VECTORS: LatticeVectors = {
  a: [1, 0, 0],
  b: [0, 1, 0],
  c: [0, 0, 1],
}

function createAtomId(prefix: string, index: number) {
  return `${prefix}-atom-${index + 1}`
}

export function createAtomsFromCubData(data: CubData, idPrefix = `cub-${Date.now()}`): Atom[] {
  return data.atoms.map((atom, index) => ({
    id: createAtomId(idPrefix, index),
    element: atom.symbol,
    position: [atom.x, atom.y, atom.z],
    cartesian: [atom.x, atom.y, atom.z],
  }))
}

export function createAtomsFromMoldenData(data: MoldenData, idPrefix = `molden-${Date.now()}`): Atom[] {
  return data.atoms.map((atom, index) => ({
    id: createAtomId(idPrefix, index),
    element: atom.symbol,
    position: [atom.x, atom.y, atom.z],
    cartesian: [atom.x, atom.y, atom.z],
  }))
}

export function createAutoDetectedMoleculeBonds(atoms: Atom[], maxBondLength = 3.0): Bond[] {
  return autoDetectBonds(atoms, IDENTITY_LATTICE_VECTORS, maxBondLength)
}
