import type { Atom, Bond, BondType } from '../crystal/types'

export interface MolfileAtom {
  element: string
  x: number
  y: number
  z: number
}

export interface MolfileBond {
  from: number
  to: number
  order: number
}

export interface MolfileStructure {
  name: string
  atoms: MolfileAtom[]
  bonds: MolfileBond[]
}

function parseCountsLine(line: string) {
  const atomCount = Number.parseInt(line.slice(0, 3).trim(), 10)
  const bondCount = Number.parseInt(line.slice(3, 6).trim(), 10)

  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) {
    throw new Error("Unsupported MOL/SDF counts line")
  }

  return { atomCount, bondCount }
}

function bondOrderToType(order: number): BondType {
  if (order === 2) return "double"
  if (order === 3) return "triple"
  return "single"
}

export function parseMolfile(content: string): MolfileStructure {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const lines = normalized.split("\n")

  if (lines.length < 4) {
    throw new Error("MOL/SDF file is too short")
  }

  const name = lines[0].trim() || "Untitled Molecule"
  const countsLineIndex = lines.findIndex((line, index) => index >= 3 && /V2000|V3000/.test(line))

  if (countsLineIndex === -1) {
    throw new Error("MOL/SDF counts line not found")
  }

  const countsLine = lines[countsLineIndex]
  if (countsLine.includes("V3000")) {
    throw new Error("V3000 MOL/SDF is not supported yet")
  }

  const { atomCount, bondCount } = parseCountsLine(countsLine)
  const atomStart = countsLineIndex + 1
  const bondStart = atomStart + atomCount
  const atoms: MolfileAtom[] = []
  const bonds: MolfileBond[] = []

  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[atomStart + index]
    if (!line) {
      throw new Error("Unexpected end of atom block")
    }

    const x = Number.parseFloat(line.slice(0, 10).trim())
    const y = Number.parseFloat(line.slice(10, 20).trim())
    const z = Number.parseFloat(line.slice(20, 30).trim())
    const element = line.slice(31, 34).trim()

    if (!element || [x, y, z].some((value) => Number.isNaN(value))) {
      throw new Error("Failed to parse MOL/SDF atom block")
    }

    atoms.push({ element, x, y, z })
  }

  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[bondStart + index]
    if (!line) {
      throw new Error("Unexpected end of bond block")
    }

    const from = Number.parseInt(line.slice(0, 3).trim(), 10)
    const to = Number.parseInt(line.slice(3, 6).trim(), 10)
    const order = Number.parseInt(line.slice(6, 9).trim(), 10)

    if (![from, to, order].every(Number.isFinite)) {
      throw new Error("Failed to parse MOL/SDF bond block")
    }

    bonds.push({ from: from - 1, to: to - 1, order })
  }

  return { name, atoms, bonds }
}

export function molfileToCrystalStructure(structure: MolfileStructure, idPrefix = "mol"): {
  atoms: Atom[]
  bonds: Bond[]
} {
  const uniquePrefix = `${idPrefix}-${Date.now()}`
  const atoms: Atom[] = structure.atoms.map((atom, index) => ({
    id: `${uniquePrefix}-atom-${index + 1}`,
    element: atom.element,
    position: [0, 0, 0],
    cartesian: [atom.x, atom.y, atom.z],
  }))

  const bonds: Bond[] = structure.bonds
    .filter((bond) => atoms[bond.from] && atoms[bond.to])
    .map((bond, index) => ({
      id: `${uniquePrefix}-bond-${index + 1}`,
      atom1Id: atoms[bond.from].id,
      atom2Id: atoms[bond.to].id,
      type: bondOrderToType(bond.order),
    }))

  return { atoms, bonds }
}
