/**
 * Bond graph — the connectivity channel.
 *
 * Every non-biomolecular hierarchy in this package is derived from connectivity
 * rather than from residue records: a polyethylene chain, a PEG linker or a
 * dendrimer carries no `zatom.bio.*` identity, so "which atoms form one
 * molecule", "where does the backbone run" and "which ring is this" can only
 * come from bonds.
 *
 * Declared bonds are used when the structure carries them, because a reader that
 * parsed CONECT/mmCIF connectivity knows more than any distance rule. Otherwise
 * bonds are inferred from covalent radii, reusing `chemistry/elements` radii and
 * the same tolerance convention as `crystal/bonds` so a bond means the same
 * thing here as it does in the renderer.
 *
 * Pure module: structure in, graph out.
 */

import type { ZatomStructure } from '../../agent/contracts'
import { getElement } from '../chemistry/elements'
import { NeighborGrid } from './neighbor-grid'

/** Extra slack over the covalent-radius sum, in Angstrom (same as crystal/bonds). */
export const BOND_TOLERANCE_A = 0.4

/** Hard ceiling for the inference search radius, in Angstrom. */
const MAX_BOND_SEARCH_A = 3.2

export interface BondGraph {
  /** atom index -> bonded atom indices, ascending. */
  adjacency: number[][]
  bondCount: number
  /** Whether connectivity came from the file or from covalent radii. */
  source: 'declared' | 'inferred'
  /** True when inference was skipped because the scene is too large. */
  skipped: boolean
}

export interface BondGraphOptions {
  /**
  * Atom ceiling for *inference*. Declared bonds are always used, at any size,
  * because they cost one pass. Inference is O(N) with a large constant, so a
  * million-atom slab opts out rather than blocking the render.
  */
  maxInferredAtoms?: number
}

export const DEFAULT_MAX_INFERRED_ATOMS = 200_000

const covalentRadius = (element: string): number => {
  const data = getElement(element)
  return data.covalentRadius > 0 ? data.covalentRadius : 0.77
}

/**
 * Build the bond graph.
 *
 * Inference uses one neighbor grid at the largest plausible bond length for the
 * elements actually present, then rejects each pair against its own radius sum.
 * A single shared cutoff keeps this one O(N) pass instead of one pass per pair.
 */
export const buildBondGraph = (
  structure: ZatomStructure,
  options: BondGraphOptions = {},
): BondGraph => {
  const atoms = structure.atoms
  const adjacency: number[][] = atoms.map(() => [])

  const declared = structure.bonds
  if (declared && declared.length > 0) {
    const indexById = new Map<string, number>()
    for (let i = 0; i < atoms.length; i++) indexById.set(atoms[i].id, i)
    let bondCount = 0
    for (const bond of declared) {
      const a = indexById.get(bond.atomIds[0])
      const b = indexById.get(bond.atomIds[1])
      if (a === undefined || b === undefined || a === b) continue
      adjacency[a].push(b)
      adjacency[b].push(a)
      bondCount++
    }
    for (const list of adjacency) list.sort((x, y) => x - y)
    return { adjacency, bondCount, source: 'declared', skipped: false }
  }

  const limit = options.maxInferredAtoms ?? DEFAULT_MAX_INFERRED_ATOMS
  if (atoms.length === 0 || atoms.length > limit) {
    return { adjacency, bondCount: 0, source: 'inferred', skipped: atoms.length > limit }
  }

  const radii = atoms.map((atom) => covalentRadius(atom.element))
  let maxRadius = 0
  for (const r of radii) if (r > maxRadius) maxRadius = r
  const cutoff = Math.min(2 * maxRadius + BOND_TOLERANCE_A, MAX_BOND_SEARCH_A)

  const grid = new NeighborGrid(structure, { cutoff })
  let bondCount = 0
  for (let i = 0; i < atoms.length; i++) {
    for (const hit of grid.neighborsOf(atoms[i].position, undefined, i)) {
      // Each pair is emitted once, from the lower index.
      if (hit.atomIndex <= i) continue
      if (hit.distance > radii[i] + radii[hit.atomIndex] + BOND_TOLERANCE_A) continue
      adjacency[i].push(hit.atomIndex)
      adjacency[hit.atomIndex].push(i)
      bondCount++
    }
  }
  for (const list of adjacency) list.sort((x, y) => x - y)
  return { adjacency, bondCount, source: 'inferred', skipped: false }
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/** Connected atom indices, largest component first. */
export const connectedComponents = (graph: BondGraph): number[][] => {
  const seen = new Uint8Array(graph.adjacency.length)
  const components: number[][] = []
  const stack: number[] = []

  for (let start = 0; start < graph.adjacency.length; start++) {
    if (seen[start]) continue
    const component: number[] = []
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length > 0) {
      const current = stack.pop()!
      component.push(current)
      for (const next of graph.adjacency[current]) {
        if (seen[next]) continue
        seen[next] = 1
        stack.push(next)
      }
    }
    component.sort((a, b) => a - b)
    components.push(component)
  }
  components.sort((a, b) => b.length - a.length)
  return components
}

/**
 * Longest shortest-path (graph diameter path) inside one component — the
 * backbone of a chain molecule.
 *
 * Double BFS: the farthest atom from any start is an endpoint of a diameter
 * path in a tree, and a chain with a few rings is close enough to a tree that
 * the result is still the chemically meaningful main chain.
 */
export const longestPath = (graph: BondGraph, component: readonly number[]): number[] => {
  if (component.length === 0) return []
  if (component.length === 1) return [component[0]]

  const bfs = (source: number): { far: number; parent: Map<number, number> } => {
    const parent = new Map<number, number>()
    const distance = new Map<number, number>()
    const queue: number[] = [source]
    distance.set(source, 0)
    let far = source
    let farDistance = 0
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      const d = distance.get(current)!
      if (d > farDistance) {
        farDistance = d
        far = current
      }
      for (const next of graph.adjacency[current]) {
        if (distance.has(next)) continue
        distance.set(next, d + 1)
        parent.set(next, current)
        queue.push(next)
      }
    }
    return { far, parent }
  }

  const first = bfs(component[0])
  const second = bfs(first.far)
  const path: number[] = []
  let cursor: number | undefined = second.far
  while (cursor !== undefined) {
    path.push(cursor)
    cursor = second.parent.get(cursor)
  }
  return path.reverse()
}

/* ------------------------------------------------------------------ */
/* Rings                                                              */
/* ------------------------------------------------------------------ */

export interface RingReport {
  /** Ring size -> how many rings of that size were found. */
  sizeCounts: Map<number, number>
  /** Atom indices that belong to at least one ring. */
  ringAtoms: Set<number>
  ringCount: number
}

/** Rings larger than this are macrocycles and not reported individually. */
const MAX_RING_SIZE = 8

/**
 * Smallest ring through each bond, deduplicated by atom set.
 *
 * This is the standard "smallest set of smallest rings" approximation: for every
 * bond, remove it and find the shortest remaining path between its endpoints.
 * Exact SSSR is not needed here — the outline reports ring sizes, and a fused
 * bicyclic reported as two rings is the chemically expected reading.
 */
export const findRings = (graph: BondGraph): RingReport => {
  const sizeCounts = new Map<number, number>()
  const ringAtoms = new Set<number>()
  const seenRings = new Set<string>()

  for (let a = 0; a < graph.adjacency.length; a++) {
    for (const b of graph.adjacency[a]) {
      if (b <= a) continue
      // Shortest path from a to b without using the a-b bond.
      const parent = new Map<number, number>()
      const queue: number[] = [a]
      parent.set(a, -1)
      let found = false
      for (let head = 0; head < queue.length && !found; head++) {
        const current = queue[head]
        for (const next of graph.adjacency[current]) {
          if (current === a && next === b) continue
          if (next === b && current === a) continue
          if (parent.has(next)) continue
          parent.set(next, current)
          if (next === b) {
            found = true
            break
          }
          queue.push(next)
        }
      }
      if (!found) continue

      const cycle: number[] = []
      let cursor = b
      while (cursor !== -1 && cursor !== undefined) {
        cycle.push(cursor)
        const up = parent.get(cursor)
        if (up === undefined || up === -1) break
        cursor = up
      }
      cycle.push(a)
      const size = new Set(cycle).size
      if (size < 3 || size > MAX_RING_SIZE) continue
      const signature = [...new Set(cycle)].sort((x, y) => x - y).join(',')
      if (seenRings.has(signature)) continue
      seenRings.add(signature)
      sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1)
      for (const atom of cycle) ringAtoms.add(atom)
    }
  }

  return { sizeCounts, ringAtoms, ringCount: seenRings.size }
}
