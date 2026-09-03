import type { BioStructure } from "./types"

export type BioPickLevel = "atom" | "residue" | "molecule"

export type BioPickOperation = "replace" | "add" | "subtract"

export interface BioPickModifiers {
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * Keep pointer, marquee and sequence selection on one modifier contract.
 * Shift wins when both modifiers are held, matching the source picker.
 */
export function bioPickOperationFromModifiers(
  modifiers: BioPickModifiers,
): BioPickOperation {
  if (modifiers.shiftKey) return "add"
  if (modifiers.ctrlKey || modifiers.metaKey) return "subtract"
  return "replace"
}

/** A miss only clears for an unmodified replace gesture. */
export function shouldClearBioSelectionOnMiss(
  modifiers: BioPickModifiers,
): boolean {
  return bioPickOperationFromModifiers(modifiers) === "replace"
}

function quoteSelectionValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function chainClause(chainId: string): string {
  return chainId === "" ? "chain blank" : `chain ${quoteSelectionValue(chainId)}`
}

function insertionCodeClause(insertionCode: string): string {
  return insertionCode === "" ? "icode blank" : `icode ${quoteSelectionValue(insertionCode)}`
}

function compressSequenceNumbers(sequenceNumbers: readonly number[]): string {
  const sorted = [...new Set(sequenceNumbers)].sort((left, right) => left - right)
  const ranges: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index]
    if (current === previous + 1) {
      previous = current
      continue
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`)
    start = current
    previous = current
  }
  return ranges.join("+")
}

export function expandBioPick(
  structure: BioStructure,
  atomIndex: number,
  level: BioPickLevel,
): ReadonlySet<number> {
  const atom = structure.atoms[atomIndex]
  if (!atom) return new Set()
  if (level === "atom") return new Set([atomIndex])
  const residue = structure.residues[atom.residueIndex]
  if (level === "residue") return new Set(residue.atomIndices)
  if (!residue.isStandard) return new Set(residue.atomIndices)
  const chain = structure.chains[residue.chainIndex]
  const output = new Set<number>()
  for (const residueIndex of chain.residueIndices) {
    const chainResidue = structure.residues[residueIndex]
    if (!chainResidue.isStandard) continue
    for (const index of chainResidue.atomIndices) output.add(index)
  }
  return output
}

export function applyBioPickOperation(
  previous: ReadonlySet<number>,
  picked: ReadonlySet<number>,
  operation: BioPickOperation,
): ReadonlySet<number> {
  if (operation === "replace") return new Set(picked)
  const output = new Set(previous)
  for (const atomIndex of picked) {
    if (operation === "add") output.add(atomIndex)
    else output.delete(atomIndex)
  }
  return output
}

/**
 * A biological marquee selects residues, not accidental screen-space atom
 * fragments. The rectangle still decides which atoms were hit; this function
 * raises every hit to its complete residue using stable topology identity.
 */
export function expandBioBoxSelection(
  structure: BioStructure,
  atomIds: readonly string[],
): string[] {
  const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom] as const))
  const residueIndices = new Set<number>()
  for (const atomId of atomIds) {
    const atom = atomById.get(atomId)
    if (atom) residueIndices.add(atom.residueIndex)
  }
  const expanded = new Set<string>()
  for (const residueIndex of residueIndices) {
    for (const atomIndex of structure.residues[residueIndex]?.atomIndices ?? []) {
      const atomId = structure.atoms[atomIndex]?.id
      if (atomId) expanded.add(atomId)
    }
  }
  return structure.atoms.flatMap((atom) => expanded.has(atom.id) ? [atom.id] : [])
}

/**
 * Translate a picked topology set into a strict, stable selection expression.
 * Residue clauses always carry chain, sequence number and insertion code, so
 * blank chains and PDB insertion residues round-trip without ambiguity.
 */
export function bioAtomSetToSelectionExpression(
  structure: BioStructure,
  atomIndices: ReadonlySet<number>,
): string {
  if (atomIndices.size === 0) return "none"
  if (atomIndices.size === structure.atoms.length) return "all"
  const byResidue = new Map<number, number[]>()
  for (const atomIndex of atomIndices) {
    const atom = structure.atoms[atomIndex]
    if (!atom) throw new Error(`Cannot serialize unknown atom index ${atomIndex}`)
    const bucket = byResidue.get(atom.residueIndex)
    if (bucket) bucket.push(atomIndex)
    else byResidue.set(atom.residueIndex, [atomIndex])
  }
  const fullResidues = new Map<string, {
    chainId: string
    insertionCode: string
    sequenceNumbers: number[]
  }>()
  const partialClauses: string[] = []
  for (const [residueIndex, selectedAtoms] of [...byResidue.entries()].sort((a, b) => a[0] - b[0])) {
    const residue = structure.residues[residueIndex]
    const identity = residue.identity
    const identityClause = `(${chainClause(identity.chainId)} and resi ${identity.sequenceNumber} and ${insertionCodeClause(identity.insertionCode)}`
    if (selectedAtoms.length === residue.atomIndices.length) {
      const groupKey = `${identity.chainId}\u0000${identity.insertionCode}`
      const group = fullResidues.get(groupKey)
      if (group) group.sequenceNumbers.push(identity.sequenceNumber)
      else fullResidues.set(groupKey, {
        chainId: identity.chainId,
        insertionCode: identity.insertionCode,
        sequenceNumbers: [identity.sequenceNumber],
      })
      continue
    }
    const serializableByName = selectedAtoms.every((atomIndex) => {
      const name = structure.atoms[atomIndex].name
      return residue.atomIndices.filter((candidate) => structure.atoms[candidate].name === name).length === 1
    })
    if (serializableByName) {
      const names = [...new Set(selectedAtoms.map((atomIndex) => structure.atoms[atomIndex].name))]
      partialClauses.push(`${identityClause} and name ${names.join("+")})`)
    } else {
      partialClauses.push(`index ${selectedAtoms.sort((a, b) => a - b).join("+")}`)
    }
  }
  const fullClauses = [...fullResidues.values()].map((group) => (
    `(${chainClause(group.chainId)} and resi ${compressSequenceNumbers(group.sequenceNumbers)} and ${insertionCodeClause(group.insertionCode)})`
  ))
  return [...fullClauses, ...partialClauses].join(" or ")
}

export function describeBioPick(structure: BioStructure, atomIndices: ReadonlySet<number>): string {
  if (atomIndices.size === 0) return ""
  const residues = new Set<number>()
  const chains = new Set<number>()
  for (const atomIndex of atomIndices) {
    const atom = structure.atoms[atomIndex]
    if (!atom) continue
    residues.add(atom.residueIndex)
    chains.add(structure.residues[atom.residueIndex].chainIndex)
  }
  if (residues.size === 1) {
    const residue = structure.residues[[...residues][0]]
    const identity = residue.identity
    const chain = identity.chainId || "<blank>"
    const insertion = identity.insertionCode
    return `${residue.name} ${identity.sequenceNumber}${insertion} (chain ${chain}) · ${atomIndices.size} atom${atomIndices.size === 1 ? "" : "s"}`
  }
  return `${atomIndices.size} atoms · ${residues.size} residues · ${chains.size} chains`
}
