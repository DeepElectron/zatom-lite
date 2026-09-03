/**
 * Analysis cache — one shared, lazily-built derivation set per structure.
 *
 * Every channel in this package needs the same few derived objects: a residue
 * index, a bond graph, a neighbor grid at some cutoff. Before this module each
 * caller built its own — `findContacts` re-indexed residues on every call, the
 * pocket pass re-indexed once per ligand, and the periodic regime re-ran the
 * coordination scan for every channel that needed it. On a 4779-atom protein
 * with 12 ligands that was thirteen residue indices per grid; on a 10^5-atom
 * slab the coordination scan alone was seconds.
 *
 * The cache is keyed on structure identity in a `WeakMap`, so it costs nothing
 * when a caller passes a fresh structure (the normal agent path: parse, use,
 * discard) and collapses the repeated work when one structure drives several
 * channels (the normal render path).
 *
 * Purity is preserved: entries are derivations of the structure, never mutated
 * state, so a cache hit and a cold build are indistinguishable to the caller.
 */

import type { ZatomStructure, ZatomTrajectory } from '../../agent/contracts'
import { NeighborGrid } from './neighbor-grid'
import { type BondGraph, buildBondGraph, connectedComponents } from './topology'
import { type ResidueIndex, buildResidueIndex } from './residue-index'

/**
 * Atom ceiling above which optional channels report "skipped" instead of
 * running. A grid must stay responsive on a million-atom slab, and a channel
 * that never returns is worse than a channel that says it declined.
 */
export const CHANNEL_ATOM_LIMIT = 250_000

interface StructureAnalysis {
  residueIndex?: ResidueIndex
  bondGraph?: BondGraph
  components?: number[][]
  neighborGrids: Map<string, NeighborGrid>
  coordination: Map<string, number[]>
}

const cache = new WeakMap<ZatomStructure, StructureAnalysis>()

const entryFor = (structure: ZatomStructure): StructureAnalysis => {
  const existing = cache.get(structure)
  if (existing) return existing
  const created: StructureAnalysis = { neighborGrids: new Map(), coordination: new Map() }
  cache.set(structure, created)
  return created
}

/** Residue index for this structure, built at most once. */
export const analysisResidueIndex = (structure: ZatomStructure): ResidueIndex => {
  const entry = entryFor(structure)
  entry.residueIndex ??= buildResidueIndex(structure)
  return entry.residueIndex
}

/** Bond graph for this structure, built at most once. */
export const analysisBondGraph = (structure: ZatomStructure): BondGraph => {
  const entry = entryFor(structure)
  entry.bondGraph ??= buildBondGraph(structure)
  return entry.bondGraph
}

/** Connected components over the bond graph, largest first. */
export const analysisComponents = (structure: ZatomStructure): number[][] => {
  const entry = entryFor(structure)
  entry.components ??= connectedComponents(analysisBondGraph(structure))
  return entry.components
}

/**
 * Neighbor grid at a given cutoff, built at most once per (structure, cutoff,
 * periodicity). The cutoff is rounded into the key so callers that pass
 * 4.0 and 4.0000001 share one grid instead of building two.
 */
export const analysisNeighborGrid = (
  structure: ZatomStructure,
  cutoff: number,
  periodic = true,
): NeighborGrid => {
  const entry = entryFor(structure)
  const key = `${cutoff.toFixed(3)}:${periodic ? 'p' : 'f'}`
  let grid = entry.neighborGrids.get(key)
  if (!grid) {
    grid = new NeighborGrid(structure, { cutoff, periodic })
    entry.neighborGrids.set(key, grid)
  }
  return grid
}

/** Coordination numbers at a given cutoff, computed at most once. */
export const analysisCoordination = (
  structure: ZatomStructure,
  cutoff: number,
  periodic = true,
): number[] => {
  const entry = entryFor(structure)
  const key = `${cutoff.toFixed(3)}:${periodic ? 'p' : 'f'}`
  let counts = entry.coordination.get(key)
  if (!counts) {
    counts = analysisNeighborGrid(structure, cutoff, periodic).coordinationNumbers()
    entry.coordination.set(key, counts)
  }
  return counts
}

/** True when the scene is small enough for the optional channels to run. */
export const withinChannelLimit = (structure: ZatomStructure): boolean =>
  structure.atoms.length <= CHANNEL_ATOM_LIMIT

/* ------------------------------------------------------------------ */
/* Trajectory frames                                                   */
/* ------------------------------------------------------------------ */

export class SceneFrameError extends Error {}

/**
 * A structure whose positions come from one trajectory frame.
 *
 * Every channel here takes a `ZatomStructure`, so the cheapest way to make the
 * whole package work on a trajectory is to project a frame into that same shape
 * rather than to thread a frame index through every function. Identity, bonds
 * and labels are carried over from the topology structure, which is exactly the
 * contract a trajectory already guarantees: one atom ordering for all frames.
 *
 * The returned object is a fresh structure, so it gets its own cache entry and
 * frame-to-frame comparisons never read each other's derivations.
 */
export const frameStructure = (
  structure: ZatomStructure,
  trajectory: ZatomTrajectory,
  frameIndex: number,
): ZatomStructure => {
  const frame = trajectory.frames[frameIndex]
  if (!frame) {
    throw new SceneFrameError(
      `Frame ${frameIndex} is outside the trajectory (${trajectory.frames.length} frames).`,
    )
  }
  if (trajectory.atomIds.length !== structure.atoms.length) {
    throw new SceneFrameError(
      `Trajectory covers ${trajectory.atomIds.length} atoms but the structure has ${structure.atoms.length}.`,
    )
  }

  const positionByAtomId = new Map<string, (typeof frame.positions)[number]>()
  for (let i = 0; i < trajectory.atomIds.length; i++) {
    positionByAtomId.set(trajectory.atomIds[i], frame.positions[i])
  }

  const atoms = structure.atoms.map((atom) => {
    const position = positionByAtomId.get(atom.id)
    if (!position) {
      throw new SceneFrameError(`Trajectory has no position for atom "${atom.id}".`)
    }
    return { ...atom, position }
  })

  return {
    ...structure,
    atoms,
    // A variable-cell run carries a per-frame lattice; a fixed-cell run does not,
    // and then the topology lattice is still the right one.
    ...(frame.lattice ? { lattice: frame.lattice } : {}),
    label: `${structure.label ?? 'structure'} @ frame ${frameIndex} (${frame.timePs} ps)`,
  }
}
