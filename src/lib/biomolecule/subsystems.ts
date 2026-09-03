import { BIO_WATER_RESIDUES } from './constants'
import type { BioStructure } from './types'

export interface BioSubsystemAtomSets {
  polymer: ReadonlySet<number>
  water: ReadonlySet<number>
  ligand: ReadonlySet<number>
  ion: ReadonlySet<number>
}

export interface BioBaseChannelAtomSets {
  /** Cartoon and surface always consume polymer topology only. */
  polymer: ReadonlySet<number>
  /** Source stick/space-fill channels include visible water in their atomic pass. */
  atomic: ReadonlySet<number>
}

export function bioBaseChannelAtomSets(
  classified: BioSubsystemAtomSets,
  hideWater: boolean,
): BioBaseChannelAtomSets {
  return {
    polymer: new Set(classified.polymer),
    atomic: bioAtomicBaseAtomIndices(classified, hideWater),
  }
}

/**
 * Canonical built-in subsystem classification. It intentionally matches the
 * selection language: standard residues are polymer, named waters are water,
 * and non-water/non-polymer residues split by one versus multiple atoms.
 */
export function classifyBioSubsystemAtoms(structure: BioStructure): BioSubsystemAtomSets {
  const polymer = new Set<number>()
  const water = new Set<number>()
  const ligand = new Set<number>()
  const ion = new Set<number>()
  for (const residue of structure.residues) {
    const destination = residue.isStandard
      ? polymer
      : BIO_WATER_RESIDUES.has(residue.name.toUpperCase())
        ? water
        : residue.atomIndices.length === 1 ? ion : ligand
    for (const atomIndex of residue.atomIndices) destination.add(atomIndex)
  }
  return { polymer, water, ligand, ion }
}

/** Atomic base owns only polymer and optionally water; built-ins own ligand/ion. */
export function bioAtomicBaseAtomIndices(
  classified: BioSubsystemAtomSets,
  hideWater: boolean,
): ReadonlySet<number> {
  return new Set([
    ...classified.polymer,
    ...(hideWater ? [] : classified.water),
  ])
}

/** Complete polymer residues with any atom within radius Å of a ligand atom. */
export function bioPocketAtomIndices(
  structure: BioStructure,
  ligandAtomIndices: ReadonlySet<number>,
  radius: number,
): ReadonlySet<number> {
  const result = new Set<number>()
  if (ligandAtomIndices.size === 0 || !Number.isFinite(radius) || radius <= 0) return result
  const radiusSquared = radius * radius
  const ligandAtoms = [...ligandAtomIndices].flatMap((index) => {
    const atom = structure.atoms[index]
    return atom ? [atom] : []
  })
  for (const residue of structure.residues) {
    if (!residue.isStandard) continue
    const inside = residue.atomIndices.some((atomIndex) => {
      const atom = structure.atoms[atomIndex]
      return atom && ligandAtoms.some((ligand) => (
        (atom.position[0] - ligand.position[0]) ** 2
        + (atom.position[1] - ligand.position[1]) ** 2
        + (atom.position[2] - ligand.position[2]) ** 2
      ) < radiusSquared)
    })
    if (inside) for (const atomIndex of residue.atomIndices) result.add(atomIndex)
  }
  return result
}

/** Prefer parsed SSBOND provenance; retain the source visualizer's geometry fallback. */
export function bioDisulfideAtomPairs(structure: BioStructure): readonly (readonly [number, number])[] {
  const pairs = structure.bonds.flatMap((bond) => (
    bond.kind === 'disulfide' ? [[bond.atomIndex1, bond.atomIndex2] as const] : []
  ))
  const seen = new Set(pairs.map(([left, right]) => `${Math.min(left, right)}:${Math.max(left, right)}`))

  const sulfurs = structure.residues.flatMap((residue) => (
    residue.name.toUpperCase() !== 'CYS'
      ? []
      : residue.atomIndices.filter((index) => structure.atoms[index]?.name.toUpperCase() === 'SG')
  ))
  for (let left = 0; left < sulfurs.length; left += 1) {
    for (let right = left + 1; right < sulfurs.length; right += 1) {
      const a = structure.atoms[sulfurs[left]]
      const b = structure.atoms[sulfurs[right]]
      const distance = Math.hypot(
        a.position[0] - b.position[0],
        a.position[1] - b.position[1],
        a.position[2] - b.position[2],
      )
      const key = `${Math.min(a.index, b.index)}:${Math.max(a.index, b.index)}`
      if (distance >= 1.5 && distance <= 2.5 && !seen.has(key)) {
        seen.add(key)
        pairs.push([a.index, b.index])
      }
    }
  }
  return pairs
}
