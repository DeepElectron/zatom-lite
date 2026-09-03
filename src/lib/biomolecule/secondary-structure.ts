import type { BioAtom, BioChain, BioResidue } from "./types"

/** Coarse three-state assignment produced by the C-alpha geometry estimate. */
export type CaTraceAssignment = "helix" | "sheet" | "coil"

/** A single C-alpha position along one chain's backbone trace. */
export type CaTracePoint = readonly [number, number, number]

function traceDistance(a: CaTracePoint, b: CaTracePoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * Model-neutral kernel for the C-alpha geometry estimate.
 *
 * Takes an ordered C-alpha trace for a single chain and returns one assignment
 * per trace position. This is the single implementation of the heuristic; both
 * the `BioAtom` pipeline and the agent-facing `zatom.bio.*` pipeline call it so
 * the two can never drift apart.
 *
 * This is not DSSP: it does not evaluate hydrogen-bond energies and must not be
 * presented as a DSSP assignment.
 */
export function estimateSecondaryStructureFromCaTrace(
  caPositions: readonly CaTracePoint[],
): CaTraceAssignment[] {
  const assignment: CaTraceAssignment[] = new Array(caPositions.length).fill("coil")
  if (caPositions.length < 5) return assignment

  for (let i = 0; i + 4 < caPositions.length; i += 1) {
    const d3 = traceDistance(caPositions[i], caPositions[i + 3])
    const d4 = traceDistance(caPositions[i], caPositions[i + 4])
    if (d3 >= 4.7 && d3 <= 5.8 && d4 >= 5.7 && d4 <= 7.1) {
      for (let k = i; k <= i + 4; k += 1) assignment[k] = "helix"
    }
  }

  for (let i = 2; i + 2 < caPositions.length; i += 1) {
    if (assignment[i] === "helix") continue
    const before = traceDistance(caPositions[i - 2], caPositions[i])
    const after = traceDistance(caPositions[i], caPositions[i + 2])
    if (before >= 6.2 && after >= 6.2) assignment[i] = "sheet"
  }

  for (let start = 0; start < assignment.length; ) {
    const kind = assignment[start]
    let end = start + 1
    while (end < assignment.length && assignment[end] === kind) end += 1
    const minimum = kind === "helix" ? 4 : kind === "sheet" ? 2 : 0
    if (minimum > 0 && end - start < minimum) {
      for (let i = start; i < end; i += 1) assignment[i] = "coil"
    }
    start = end
  }

  return assignment
}

/**
 * A deliberately named, coarse C-alpha geometry estimate for structures that
 * do not carry HELIX/SHEET records. This is not DSSP: it does not evaluate
 * hydrogen-bond energies and must not be presented as a DSSP assignment.
 */
export function estimateSecondaryStructureFromAlphaCarbonGeometry(
  atoms: readonly BioAtom[],
  residues: BioResidue[],
  chains: readonly BioChain[],
): void {
  for (const chain of chains) {
    if (chain.polymerType !== "protein") continue
    const traceResidues = chain.residueIndices.filter((residueIndex) => {
      const residue = residues[residueIndex]
      return residue?.isStandard && residue.representativeAtomIndex !== null
    })
    if (traceResidues.length < 5) continue

    const caPositions: CaTracePoint[] = traceResidues.map((residueIndex) => {
      const atomIndex = residues[residueIndex].representativeAtomIndex
      const position = atoms[atomIndex!].position
      return [position[0], position[1], position[2]] as const
    })
    const assignment = estimateSecondaryStructureFromCaTrace(caPositions)

    traceResidues.forEach((residueIndex, offset) => {
      const residue = residues[residueIndex]
      if (residue.secondaryStructureSource !== "none") return
      residue.secondaryStructure = assignment[offset]
      residue.secondaryStructureSource = "geometry-estimate"
    })
  }
}
