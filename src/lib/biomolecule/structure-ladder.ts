import { BIO_WATER_RESIDUES } from "./constants"
import type { BioStructure, BioSecondaryStructure, BioVector3 } from "./types"

/**
 * Pure drill-down hierarchy for a biomolecule:
 * assembly → chain → secondary-structure element → residue → atom.
 *
 * Secondary structure is assigned during parsing; this module only groups
 * consecutive assignments. Every node carries bounds and atom indices for
 * camera framing and 3D selection.
 */

export type LadderLevel = "assembly" | "chain" | "element" | "residue" | "atom"

export interface LadderNode {
  /** Path-based stable id, such as `chain:A/element:helix:3/residue:1756`. */
  id: string
  level: LadderLevel
  /** Short label for breadcrumbs and the hierarchy tree. */
  label: string
  /** Optional supplementary description. */
  detail: string | null
  center: BioVector3
  /** Bounding radius in Å, with a nonzero floor for camera framing. */
  radius: number
  parentId: string | null
  childIds: readonly string[]
  /** Atomic topology indices covered by this node. */
  atomIndices: readonly number[]
  /** Secondary-structure kind, populated only for element nodes. */
  secondaryStructure: BioSecondaryStructure | null
  /**
  * Assignment provenance for element nodes. Geometry estimates must remain
  * distinguishable from file records in the UI.
  */
  secondaryStructureSource: string | null
}

export interface StructureLadder {
  rootId: string
  nodes: ReadonlyMap<string, LadderNode>
}

/** Minimum bounding radius for single or coincident atoms, preventing a zero camera spread. */
const MIN_RADIUS_ANGSTROM = 1.4

function centroidAndRadius(
  positions: readonly BioVector3[],
): { center: BioVector3; radius: number } {
  if (positions.length === 0) return { center: [0, 0, 0], radius: MIN_RADIUS_ANGSTROM }
  let sx = 0
  let sy = 0
  let sz = 0
  for (const p of positions) {
    sx += p[0]
    sy += p[1]
    sz += p[2]
  }
  const n = positions.length
  const center: BioVector3 = [sx / n, sy / n, sz / n]

  let maxSq = 0
  for (const p of positions) {
    const dx = p[0] - center[0]
    const dy = p[1] - center[1]
    const dz = p[2] - center[2]
    const sq = dx * dx + dy * dy + dz * dz
    if (sq > maxSq) maxSq = sq
  }
  return { center, radius: Math.max(Math.sqrt(maxSq), MIN_RADIUS_ANGSTROM) }
}

function residueLabel(structure: BioStructure, residueIndex: number): string {
  const residue = structure.residues[residueIndex]
  const { sequenceNumber, insertionCode } = residue.identity
  // The insertion code is part of the PDB residue identifier (for example, 52A).
  return `${residue.name}${sequenceNumber}${insertionCode}`
}

const ELEMENT_LABEL: Record<BioSecondaryStructure, string> = {
  helix: "Helix",
  sheet: "Sheet",
  coil: "Coil",
}

/** Group consecutive residues with the same secondary-structure assignment. */
function segmentBySecondaryStructure(
  structure: BioStructure,
  residueIndices: readonly number[],
): { kind: BioSecondaryStructure; source: string; residueIndices: number[] }[] {
  const segments: { kind: BioSecondaryStructure; source: string; residueIndices: number[] }[] = []
  for (const residueIndex of residueIndices) {
    const residue = structure.residues[residueIndex]
    if (!residue) continue
    const last = segments[segments.length - 1]
    if (last && last.kind === residue.secondaryStructure) {
      last.residueIndices.push(residueIndex)
      // Mixed provenance must not be presented as an authoritative file record.
      if (last.source !== residue.secondaryStructureSource) last.source = "mixed"
    } else {
      segments.push({
        kind: residue.secondaryStructure,
        source: residue.secondaryStructureSource,
        residueIndices: [residueIndex],
      })
    }
  }
  return segments
}

/**
 * Build the hierarchy through residue level. Atom ids are listed as children,
 * but atom nodes are materialized on demand to keep large structures compact.
 */
export function buildStructureLadder(structure: BioStructure): StructureLadder {
  const nodes = new Map<string, LadderNode>()
  const positionsOf = (atomIndices: readonly number[]): BioVector3[] =>
    atomIndices
      .map((atomIndex) => structure.atoms[atomIndex]?.position)
      .filter((p): p is BioVector3 => p !== undefined)

  const rootId = "assembly"
  const chainIds: string[] = []

  /** Create one canonical residue node under the supplied parent. */
  const putResidueNode = (residueIndex: number, parentNodeId: string, chainLabel: string): {
    nodeId: string
    atomIndices: readonly number[]
  } | null => {
    const residue = structure.residues[residueIndex]
    if (!residue) return null
    const residueNodeId = `${parentNodeId}/residue:${residueIndex}`
    const residueAtoms = residue.atomIndices
    const { center, radius } = centroidAndRadius(positionsOf(residueAtoms))
    nodes.set(residueNodeId, {
      id: residueNodeId,
      level: "residue",
      label: residueLabel(structure, residueIndex),
      detail: `Chain ${chainLabel} · ${residueAtoms.length} atoms`,
      center,
      radius,
      parentId: parentNodeId,
      childIds: residueAtoms.map((atomIndex) => `${residueNodeId}/atom:${atomIndex}`),
      atomIndices: residueAtoms,
      secondaryStructure: null,
      secondaryStructureSource: null,
    })
    return { nodeId: residueNodeId, atomIndices: residueAtoms }
  }

  for (const chain of structure.chains) {
    // Blank chain identifiers are valid PDB data but need a visible UI label.
    const chainKey = chain.identifier === "" ? "_" : chain.identifier
    const chainNodeId = `chain:${chainKey}`
    const chainLabel = chain.identifier || "(blank)"
    const elementIds: string[] = []
    const chainAtomIndices: number[] = []

    /**
    * Remove water before secondary-structure segmentation. Water defaults to
    * coil and would otherwise merge into a terminal coil segment, corrupting
    * its residue span.
    */
    const waterResidueIndices: number[] = []
    const polymerResidueIndices: number[] = []
    for (const residueIndex of chain.residueIndices) {
      const residue = structure.residues[residueIndex]
      if (!residue) continue
      if (BIO_WATER_RESIDUES.has(residue.name.toUpperCase())) waterResidueIndices.push(residueIndex)
      else polymerResidueIndices.push(residueIndex)
    }

    const segments = segmentBySecondaryStructure(structure, polymerResidueIndices)
    segments.forEach((segment, segmentOrdinal) => {
      const elementNodeId = `${chainNodeId}/element:${segment.kind}:${segmentOrdinal}`
      const residueIds: string[] = []
      const elementAtomIndices: number[] = []

      for (const residueIndex of segment.residueIndices) {
        const created = putResidueNode(residueIndex, elementNodeId, chainLabel)
        if (!created) continue
        residueIds.push(created.nodeId)
        elementAtomIndices.push(...created.atomIndices)
      }

      const first = segment.residueIndices[0]
      const last = segment.residueIndices[segment.residueIndices.length - 1]
      const span =
        first === last
          ? residueLabel(structure, first)
          : `${residueLabel(structure, first)}–${residueLabel(structure, last)}`
      const { center, radius } = centroidAndRadius(positionsOf(elementAtomIndices))

      nodes.set(elementNodeId, {
        id: elementNodeId,
        level: "element",
        label: `${ELEMENT_LABEL[segment.kind]} ${segmentOrdinal + 1}`,
        detail: span,
        center,
        radius,
        parentId: chainNodeId,
        childIds: residueIds,
        atomIndices: elementAtomIndices,
        secondaryStructure: segment.kind,
        secondaryStructureSource: segment.source,
      })
      elementIds.push(elementNodeId)
      chainAtomIndices.push(...elementAtomIndices)
    })

    // Group water into one expandable element node. This preserves coordination
    // waters without letting hundreds of HOH residues dominate the hierarchy.
    if (waterResidueIndices.length > 0) {
      const waterNodeId = `${chainNodeId}/element:water:0`
      const waterResidueIds: string[] = []
      const waterAtomIndices: number[] = []
      for (const residueIndex of waterResidueIndices) {
        const created = putResidueNode(residueIndex, waterNodeId, chainLabel)
        if (!created) continue
        waterResidueIds.push(created.nodeId)
        waterAtomIndices.push(...created.atomIndices)
      }
      const { center, radius } = centroidAndRadius(positionsOf(waterAtomIndices))
      nodes.set(waterNodeId, {
        id: waterNodeId,
        level: "element",
        label: `Water · ${waterResidueIndices.length}`,
        detail: `${waterAtomIndices.length} atoms`,
        center,
        radius,
        parentId: chainNodeId,
        childIds: waterResidueIds,
        atomIndices: waterAtomIndices,
        // Water has no secondary structure or assignment provenance.
        secondaryStructure: null,
        secondaryStructureSource: null,
      })
      elementIds.push(waterNodeId)
      chainAtomIndices.push(...waterAtomIndices)
    }

    const { center, radius } = centroidAndRadius(positionsOf(chainAtomIndices))
    nodes.set(chainNodeId, {
      id: chainNodeId,
      level: "chain",
      label: `Chain ${chain.identifier || "(blank)"}`,
      detail: `${chain.residueIndices.length} residues · ${chain.polymerType}`,
      center,
      radius,
      parentId: rootId,
      childIds: elementIds,
      atomIndices: chainAtomIndices,
      secondaryStructure: null,
      secondaryStructureSource: null,
    })
    chainIds.push(chainNodeId)
  }

  // Parsing already computed authoritative whole-structure bounds.
  nodes.set(rootId, {
    id: rootId,
    level: "assembly",
    label: structure.title || "Assembly",
    detail: `${structure.chains.length} chains · ${structure.atoms.length} atoms`,
    center: structure.center,
    radius: Math.max(structure.radius, MIN_RADIUS_ANGSTROM),
    parentId: null,
    childIds: chainIds,
    atomIndices: structure.atoms.map((_, atomIndex) => atomIndex),
    secondaryStructure: null,
    secondaryStructureSource: null,
  })

  return { rootId, nodes }
}

/** Materialize an atom node on demand for camera and breadcrumb consumers. */
export function ladderAtomNode(
  structure: BioStructure,
  ladder: StructureLadder,
  atomNodeId: string,
): LadderNode | null {
  const match = /\/atom:(\d+)$/.exec(atomNodeId)
  if (!match) return null
  const atomIndex = Number(match[1])
  const atom = structure.atoms[atomIndex]
  if (!atom) return null
  const parentId = atomNodeId.slice(0, atomNodeId.lastIndexOf("/atom:"))
  if (!ladder.nodes.has(parentId)) return null

  return {
    id: atomNodeId,
    level: "atom",
    // PDB atom names distinguish residue-local identity; serial is bookkeeping.
    label: atom.name || `${atom.element}${atom.serial}`,
    detail: `${atom.element} · #${atom.serial}`,
    center: atom.position,
    radius: MIN_RADIUS_ANGSTROM,
    parentId,
    childIds: [],
    atomIndices: [atomIndex],
    secondaryStructure: null,
    secondaryStructureSource: null,
  }
}

/** Resolve a stored node or materialize an atom node on demand. */
export function ladderNode(
  structure: BioStructure,
  ladder: StructureLadder,
  nodeId: string,
): LadderNode | null {
  return ladder.nodes.get(nodeId) ?? ladderAtomNode(structure, ladder, nodeId)
}

/** Return the complete root-to-node breadcrumb path, or empty on a broken chain. */
export function ladderPath(
  structure: BioStructure,
  ladder: StructureLadder,
  nodeId: string,
): LadderNode[] {
  const path: LadderNode[] = []
  let cursor = ladderNode(structure, ladder, nodeId)
  const guard = new Set<string>()
  while (cursor) {
    if (guard.has(cursor.id)) return []
    guard.add(cursor.id)
    path.unshift(cursor)
    if (cursor.parentId === null) return path
    cursor = ladderNode(structure, ladder, cursor.parentId)
  }
  return []
}

/**
 * Bound multiple nodes by the sphere circumscribing the union of their bounding
 * boxes. Averaging centers can under-frame selections at opposite extremes.
 */
export function ladderNodesBounds(
  nodes: readonly LadderNode[],
): { center: BioVector3; radius: number } | null {
  if (nodes.length === 0) return null

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const node of nodes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], node.center[axis] - node.radius)
      max[axis] = Math.max(max[axis], node.center[axis] + node.radius)
    }
  }

  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    // Half the union-box diagonal, with a floor for coincident selections.
    radius: Math.max(
      MIN_RADIUS_ANGSTROM,
      0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
    ),
  }
}

/** Convert a node's topology indices to atom ids for 3D selection. */
export function ladderNodeAtomIds(
  structure: BioStructure,
  node: LadderNode,
): string[] {
  const ids: string[] = []
  for (const atomIndex of node.atomIndices) {
    const atom = structure.atoms[atomIndex]
    if (atom) ids.push(atom.id)
  }
  return ids
}
