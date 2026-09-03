import { BIO_WATER_RESIDUES } from "./constants"
import type { BioResidue, BioStructure, BioVector3 } from "./types"

export type BioCandidateInteractionType =
  | "hydrogen-bond-candidate"
  | "salt-bridge-candidate"
  | "pi-stacking-candidate"
  | "hydrophobic-contact-candidate"

/**
 * "all" allows same-chain residue pairs (used when filtering selections; still excludes backbone noise from water and adjacent residue pairs).
 */
export type BioCandidateInteractionScope = "ligand-protein" | "interchain" | "both" | "all"

export interface BioCandidateInteractionOptions {
  hydrogenBonds?: boolean
  saltBridges?: boolean
  piStacking?: boolean
  hydrophobicContacts?: boolean
  scope?: BioCandidateInteractionScope
}

export interface BioCandidateInteraction {
  type: BioCandidateInteractionType
  atomIndex1: number
  atomIndex2: number
  residueIndex1: number
  residueIndex2: number
  start: BioVector3
  end: BioVector3
  distance: number
  /** Machine-readable caveat for UI/tooltips and scientific provenance. */
  qualification:
    | "distance-and-atom-type-only"
    | "distance-and-formal-charge-or-atom-type"
    | "centroid-normal-and-offset"
}

const DONORS = new Set([
  "N",
  "NE",
  "NH1",
  "NH2",
  "NZ",
  "ND1",
  "NE2",
  "ND2",
  "NE1",
  "OG",
  "OG1",
  "OH",
  "SG",
])

const ACCEPTORS = new Set([
  "O",
  "OXT",
  "OD1",
  "OD2",
  "OE1",
  "OE2",
  "OG",
  "OG1",
  "OH",
  "ND1",
  "NE2",
  "SD",
])

const ANIONS: Readonly<Record<string, readonly string[]>> = {
  ASP: ["OD1", "OD2"],
  GLU: ["OE1", "OE2"],
}

const CATIONS: Readonly<Record<string, readonly string[]>> = {
  LYS: ["NZ"],
  ARG: ["NH1", "NH2", "NE"],
  HIS: ["ND1", "NE2"],
}

const AROMATIC_RINGS: Readonly<Record<string, readonly string[]>> = {
  PHE: ["CG", "CD1", "CD2", "CE1", "CE2", "CZ"],
  TYR: ["CG", "CD1", "CD2", "CE1", "CE2", "CZ"],
  TRP: ["CD2", "CE2", "CE3", "CZ2", "CZ3", "CH2"],
  HIS: ["CG", "ND1", "CD2", "CE1", "NE2"],
}

const HYDROPHOBIC_RESIDUES = new Set(["ALA", "VAL", "LEU", "ILE", "MET", "PHE", "TRP", "PRO"])

interface RingGeometry {
  residueIndex: number
  representativeAtomIndex: number
  centroid: [number, number, number]
  normal: [number, number, number]
}

interface GridEntry {
  atomIndex: number
  position: BioVector3
}

function distance(left: BioVector3, right: BioVector3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function isLigand(residue: BioResidue): boolean {
  return !residue.isStandard && !BIO_WATER_RESIDUES.has(residue.name) && residue.atomIndices.length > 1
}

function isHeteroGroup(residue: BioResidue): boolean {
  return !residue.isStandard && !BIO_WATER_RESIDUES.has(residue.name)
}

function isProteinResidue(structure: BioStructure, residue: BioResidue): boolean {
  return residue.isStandard && structure.chains[residue.chainIndex]?.polymerType === "protein"
}

function pairInScope(
  structure: BioStructure,
  leftResidueIndex: number,
  rightResidueIndex: number,
  scope: BioCandidateInteractionScope,
): boolean {
  if (leftResidueIndex === rightResidueIndex) return false
  const left = structure.residues[leftResidueIndex]
  const right = structure.residues[rightResidueIndex]
  if (BIO_WATER_RESIDUES.has(left.name) || BIO_WATER_RESIDUES.has(right.name)) return false
  const ligandProtein =
    (isHeteroGroup(left) && isProteinResidue(structure, right)) ||
    (isHeteroGroup(right) && isProteinResidue(structure, left))
  const interchain = left.isStandard && right.isStandard && left.chainIndex !== right.chainIndex
  if (scope === "ligand-protein") return ligandProtein
  if (scope === "interchain") return interchain
  if (scope === "all") {
    // The same chain is also counted, but adjacent residues in the sequence are excluded - the N/O distance of the main chain i→i+1 is naturally within the hydrogen bond range, and is all noise.
    if (left.chainIndex === right.chainIndex && Math.abs(left.index - right.index) <= 1) return false
    return true
  }
  return ligandProtein || interchain
}

function buildGrid(entries: readonly GridEntry[], cellSize: number): Map<string, GridEntry[]> {
  const grid = new Map<string, GridEntry[]>()
  for (const entry of entries) {
    const key = `${Math.floor(entry.position[0] / cellSize)},${Math.floor(entry.position[1] / cellSize)},${Math.floor(entry.position[2] / cellSize)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(entry)
    else grid.set(key, [entry])
  }
  return grid
}

function neighbors(
  grid: ReadonlyMap<string, readonly GridEntry[]>,
  position: BioVector3,
  cellSize: number,
): GridEntry[] {
  const result: GridEntry[] = []
  const gx = Math.floor(position[0] / cellSize)
  const gy = Math.floor(position[1] / cellSize)
  const gz = Math.floor(position[2] / cellSize)
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        result.push(...(grid.get(`${gx + dx},${gy + dy},${gz + dz}`) ?? []))
      }
    }
  }
  return result
}

function cross(left: BioVector3, right: BioVector3): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(vector: BioVector3): [number, number, number] | null {
  const length = Math.hypot(...vector)
  return length < 1e-8 ? null : [vector[0] / length, vector[1] / length, vector[2] / length]
}

function dot(left: BioVector3, right: BioVector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function ringGeometry(structure: BioStructure, residue: BioResidue): RingGeometry | null {
  const names = AROMATIC_RINGS[residue.name]
  if (!names) return null
  const indices = residue.atomIndices.filter((atomIndex) => names.includes(structure.atoms[atomIndex].name))
  if (indices.length < 5) return null
  const centroid: [number, number, number] = [0, 0, 0]
  for (const atomIndex of indices) {
    const position = structure.atoms[atomIndex].position
    centroid[0] += position[0]
    centroid[1] += position[1]
    centroid[2] += position[2]
  }
  centroid[0] /= indices.length
  centroid[1] /= indices.length
  centroid[2] /= indices.length
  const a = structure.atoms[indices[0]].position
  const b = structure.atoms[indices[1]].position
  const c = structure.atoms[indices[2]].position
  const normal = normalize(
    cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]),
  )
  return normal
    ? { residueIndex: residue.index, representativeAtomIndex: indices[0], centroid, normal }
    : null
}

function canonicalCycle(indices: readonly number[]): string {
  const rotations = (values: readonly number[]) => values.map((_, offset) => (
    [...values.slice(offset), ...values.slice(0, offset)].join(":")
  ))
  return [...rotations(indices), ...rotations([...indices].reverse())].sort()[0]
}

function ligandCycles(structure: BioStructure, residue: BioResidue): number[][] {
  if (!isLigand(residue)) return []
  const allowed = new Set(residue.atomIndices.filter((atomIndex) => (
    ["C", "N", "O", "S"].includes(structure.atoms[atomIndex].element)
  )))
  const adjacency = new Map<number, number[]>()
  for (const atomIndex of allowed) adjacency.set(atomIndex, [])
  for (const bond of structure.bonds) {
    if (!allowed.has(bond.atomIndex1) || !allowed.has(bond.atomIndex2)) continue
    adjacency.get(bond.atomIndex1)!.push(bond.atomIndex2)
    adjacency.get(bond.atomIndex2)!.push(bond.atomIndex1)
  }
  const seen = new Set<string>()
  const cycles: number[][] = []
  for (const start of allowed) {
    const visit = (path: number[]): void => {
      const current = path[path.length - 1]
      for (const next of adjacency.get(current) ?? []) {
        if (next === start && path.length >= 5 && path.length <= 6) {
          const key = canonicalCycle(path)
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push([...path])
          }
          continue
        }
        if (path.length >= 6 || path.includes(next) || next < start) continue
        visit([...path, next])
      }
    }
    visit([start])
  }
  return cycles
}

function geometryFromRingAtoms(
  structure: BioStructure,
  residueIndex: number,
  atomIndices: readonly number[],
): RingGeometry | null {
  if (atomIndices.length < 5) return null
  const centroid: [number, number, number] = [0, 0, 0]
  for (const atomIndex of atomIndices) {
    const position = structure.atoms[atomIndex].position
    centroid[0] += position[0]
    centroid[1] += position[1]
    centroid[2] += position[2]
  }
  centroid[0] /= atomIndices.length
  centroid[1] /= atomIndices.length
  centroid[2] /= atomIndices.length
  // Newell's method is stable for a ring supplied in bond order.
  const accumulated: [number, number, number] = [0, 0, 0]
  for (let index = 0; index < atomIndices.length; index += 1) {
    const current = structure.atoms[atomIndices[index]].position
    const next = structure.atoms[atomIndices[(index + 1) % atomIndices.length]].position
    accumulated[0] += (current[1] - next[1]) * (current[2] + next[2])
    accumulated[1] += (current[2] - next[2]) * (current[0] + next[0])
    accumulated[2] += (current[0] - next[0]) * (current[1] + next[1])
  }
  const normal = normalize(accumulated)
  if (!normal) return null
  const planar = atomIndices.every((atomIndex) => {
    const point = structure.atoms[atomIndex].position
    return Math.abs(dot([
      point[0] - centroid[0],
      point[1] - centroid[1],
      point[2] - centroid[2],
    ], normal)) <= 0.25
  })
  if (!planar) return null
  return { residueIndex, representativeAtomIndex: atomIndices[0], centroid, normal }
}

function aromaticRingGeometries(structure: BioStructure): RingGeometry[] {
  return structure.residues.flatMap((residue) => {
    const standard = ringGeometry(structure, residue)
    if (standard) return [standard]
    return ligandCycles(structure, residue).flatMap((cycle) => {
      const geometry = geometryFromRingAtoms(structure, residue.index, cycle)
      return geometry ? [geometry] : []
    })
  })
}

function heteroChargeRole(
  atom: BioStructure["atoms"][number],
): -1 | 0 | 1 {
  if (atom.formalCharge != null && atom.formalCharge !== 0) return atom.formalCharge > 0 ? 1 : -1
  // Legacy PDB ligand records often omit formal charge. Keep this explicitly
  // qualified as a candidate heuristic: amine-like N is positive-facing;
  // O/S is negative-facing. It is not a protonation-state assignment.
  if (atom.element === "N") return 1
  if (atom.element === "O" || atom.element === "S") return -1
  return 0
}

function candidate(
  structure: BioStructure,
  type: BioCandidateInteractionType,
  leftAtomIndex: number,
  rightAtomIndex: number,
  start: BioVector3,
  end: BioVector3,
  qualification: BioCandidateInteraction["qualification"],
): BioCandidateInteraction {
  return {
    type,
    atomIndex1: leftAtomIndex,
    atomIndex2: rightAtomIndex,
    residueIndex1: structure.atoms[leftAtomIndex].residueIndex,
    residueIndex2: structure.atoms[rightAtomIndex].residueIndex,
    start,
    end,
    distance: distance(start, end),
    qualification,
  }
}

/**
 * Detect visualization candidates, not authoritative biochemical bonds. H-bond
 * candidates intentionally use heavy-atom distance/type only because legacy
 * PDB inputs commonly omit hydrogen coordinates. Consumers must preserve the
 * `candidate` naming and qualification metadata.
 */
export function detectBioCandidateInteractions(
  structure: BioStructure,
  options: BioCandidateInteractionOptions = {},
): BioCandidateInteraction[] {
  const settings = {
    hydrogenBonds: options.hydrogenBonds ?? true,
    saltBridges: options.saltBridges ?? true,
    piStacking: options.piStacking ?? true,
    hydrophobicContacts: options.hydrophobicContacts ?? false,
    scope: options.scope ?? "ligand-protein",
  }
  const result: BioCandidateInteraction[] = []
  const polarAtoms = structure.atoms.filter((atom) => ["N", "O", "S"].includes(atom.element))
  const polarEntries = polarAtoms.map((atom) => ({ atomIndex: atom.index, position: atom.position }))
  const polarGrid = buildGrid(polarEntries, 4)
  const reportedSaltResiduePairs = new Set<string>()

  if (settings.hydrogenBonds || settings.saltBridges) {
    for (const leftEntry of polarEntries) {
      const leftAtom = structure.atoms[leftEntry.atomIndex]
      const leftResidue = structure.residues[leftAtom.residueIndex]
      for (const rightEntry of neighbors(polarGrid, leftEntry.position, 4)) {
        if (rightEntry.atomIndex <= leftEntry.atomIndex) continue
        const rightAtom = structure.atoms[rightEntry.atomIndex]
        const rightResidue = structure.residues[rightAtom.residueIndex]
        if (!pairInScope(structure, leftResidue.index, rightResidue.index, settings.scope)) continue
        const separation = distance(leftAtom.position, rightAtom.position)
        if (separation < 2.2 || separation > 4) continue

        const leftAnion = ANIONS[leftResidue.name]?.includes(leftAtom.name) ?? false
        const rightAnion = ANIONS[rightResidue.name]?.includes(rightAtom.name) ?? false
        const leftCation = CATIONS[leftResidue.name]?.includes(leftAtom.name) ?? false
        const rightCation = CATIONS[rightResidue.name]?.includes(rightAtom.name) ?? false
        const leftHeteroRole = isHeteroGroup(leftResidue) ? heteroChargeRole(leftAtom) : 0
        const rightHeteroRole = isHeteroGroup(rightResidue) ? heteroChargeRole(rightAtom) : 0
        const saltCandidate =
          (leftAnion && (rightCation || rightHeteroRole > 0)) ||
          (rightAnion && (leftCation || leftHeteroRole > 0)) ||
          (leftCation && rightHeteroRole < 0) ||
          (rightCation && leftHeteroRole < 0)
        if (settings.saltBridges && separation <= 4 && saltCandidate) {
          const pairKey = [leftResidue.index, rightResidue.index].sort((a, b) => a - b).join(":")
          if (!reportedSaltResiduePairs.has(pairKey)) {
            reportedSaltResiduePairs.add(pairKey)
            result.push(
              candidate(
                structure,
                "salt-bridge-candidate",
                leftAtom.index,
                rightAtom.index,
                leftAtom.position,
                rightAtom.position,
                leftHeteroRole !== 0 || rightHeteroRole !== 0
                  ? "distance-and-formal-charge-or-atom-type"
                  : "distance-and-atom-type-only",
              ),
            )
          }
          continue
        }

        const leftLigand = isLigand(leftResidue)
        const rightLigand = isLigand(rightResidue)
        const leftDonor = leftLigand ? ["N", "O", "S"].includes(leftAtom.element) : DONORS.has(leftAtom.name)
        const leftAcceptor = leftLigand ? ["N", "O", "S"].includes(leftAtom.element) : ACCEPTORS.has(leftAtom.name)
        const rightDonor = rightLigand ? ["N", "O", "S"].includes(rightAtom.element) : DONORS.has(rightAtom.name)
        const rightAcceptor = rightLigand ? ["N", "O", "S"].includes(rightAtom.element) : ACCEPTORS.has(rightAtom.name)
        if (
          settings.hydrogenBonds &&
          separation <= 3.5 &&
          ((leftDonor && rightAcceptor) || (rightDonor && leftAcceptor))
        ) {
          result.push(
            candidate(
              structure,
              "hydrogen-bond-candidate",
              leftAtom.index,
              rightAtom.index,
              leftAtom.position,
              rightAtom.position,
              "distance-and-atom-type-only",
            ),
          )
        }
      }
    }
  }

  if (settings.piStacking) {
    const rings = aromaticRingGeometries(structure)
    for (let leftIndex = 0; leftIndex < rings.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rings.length; rightIndex += 1) {
        const left = rings[leftIndex]
        const right = rings[rightIndex]
        if (!pairInScope(structure, left.residueIndex, right.residueIndex, settings.scope)) continue
        const separation = distance(left.centroid, right.centroid)
        if (separation < 3 || separation > 5.5) continue
        const alignment = Math.abs(dot(left.normal, right.normal))
        if (alignment < Math.cos((35 * Math.PI) / 180)) continue
        const centerVector: BioVector3 = [
          right.centroid[0] - left.centroid[0],
          right.centroid[1] - left.centroid[1],
          right.centroid[2] - left.centroid[2],
        ]
        const vertical = Math.abs(dot(centerVector, left.normal))
        const lateralOffset = Math.sqrt(Math.max(0, separation ** 2 - vertical ** 2))
        if (lateralOffset > 2.5) continue
        result.push(
          candidate(
            structure,
            "pi-stacking-candidate",
            left.representativeAtomIndex,
            right.representativeAtomIndex,
            left.centroid,
            right.centroid,
            "centroid-normal-and-offset",
          ),
        )
      }
    }
  }

  if (settings.hydrophobicContacts) {
    const carbonEntries = structure.atoms
      .filter((atom) => {
        if (atom.element !== "C") return false
        const residue = structure.residues[atom.residueIndex]
        if (isLigand(residue)) return true
        return HYDROPHOBIC_RESIDUES.has(residue.name) && atom.name !== "CA" && atom.name !== "C"
      })
      .map((atom) => ({ atomIndex: atom.index, position: atom.position }))
    const grid = buildGrid(carbonEntries, 4)
    const best = new Map<string, BioCandidateInteraction>()
    for (const left of carbonEntries) {
      const leftResidue = structure.atoms[left.atomIndex].residueIndex
      for (const right of neighbors(grid, left.position, 4)) {
        if (right.atomIndex <= left.atomIndex) continue
        const rightResidue = structure.atoms[right.atomIndex].residueIndex
        if (!pairInScope(structure, leftResidue, rightResidue, settings.scope)) continue
        const separation = distance(left.position, right.position)
        if (separation < 3 || separation > 4) continue
        const pairKey = [leftResidue, rightResidue].sort((a, b) => a - b).join(":")
        const interaction = candidate(
          structure,
          "hydrophobic-contact-candidate",
          left.atomIndex,
          right.atomIndex,
          left.position,
          right.position,
          "distance-and-atom-type-only",
        )
        if (!best.has(pairKey) || best.get(pairKey)!.distance > interaction.distance) best.set(pairKey, interaction)
      }
    }
    result.push(...best.values())
  }

  return result
}
