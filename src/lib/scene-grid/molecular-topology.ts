/**
 * Connectivity channel for the molecular regime.
 *
 * A 24x24 grid of a benzene ring asks the model to count a hexagon out of
 * scattered dots at 0.2 A per cell. The graph it is trying to recover is
 * already computed: bonds, rings, fragments. For a small molecule that graph
 * *is* the structure, so it is emitted directly and the grid is left to carry
 * what the graph cannot — where things are relative to the camera.
 *
 * Detail levels follow the outline channel so budget degradation has one
 * vocabulary: `full` lists every atom's bonded partners, `compact` and
 * `minimal` keep the one-line summary, `none` emits nothing.
 */

import type { ZatomStructure } from '../../agent/contracts'
import type { OutlineDetail } from './foveate'
import { analysisBondGraph, analysisComponents } from './scene-analysis'
import { findRings } from './topology'

/** Above this the adjacency list stops being a reading and becomes a dump. */
const MAX_ATOMS_FOR_ADJACENCY = 60

export interface MolecularTopology {
  bondCount: number
  /** Whether bonds came from the file or were inferred from covalent radii. */
  source: 'declared' | 'inferred'
  fragmentCount: number
  /** Ring size -> count, sizes ascending. */
  rings: [number, number][]
  text: string
}

const formula = (structure: ZatomStructure): string => {
  const counts = new Map<string, number>()
  for (const atom of structure.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
  // Hill order: C, then H, then the rest alphabetically.
  const order = (el: string): string => (el === 'C' ? '0' : el === 'H' ? '1' : `2${el}`)
  return [...counts.entries()]
    .sort(([a], [b]) => order(a).localeCompare(order(b)))
    .map(([el, n]) => (n === 1 ? el : `${el}${n}`))
    .join('')
}

/** A periodic cell is a molecular assembly when it holds at least this many fragments... */
const MIN_ASSEMBLY_FRAGMENTS = 4
/** ...each of at least two atoms (single atoms are an ionic or metallic lattice, not molecules)... */
const MIN_FRAGMENT_ATOMS = 2
/** ...and none larger than this (a MOF or polymer is a framework, and the site lens applies). */
const MAX_FRAGMENT_ATOMS = 60
/** Distinct fragment formulas listed before "+n more". */
const MAX_FORMULAS_LISTED = 6

export interface MolecularAssembly {
  fragmentCount: number
  /** Formula -> count, most frequent first. */
  formulas: [string, number][]
  text: string
}

/**
 * Detects a periodic cell whose contents are small bonded fragments — a water
 * box, a molecular crystal, a solvated ion — and names them. Returns null for
 * anything that is a lattice (metals, ionic solids, frameworks) so the site
 * lens can take over.
 */
export const describeMolecularAssembly = (structure: ZatomStructure): MolecularAssembly | null => {
  if (!structure.lattice) return null
  const graph = analysisBondGraph(structure)
  if (graph.skipped) return null
  const components = analysisComponents(structure)
  if (components.length < MIN_ASSEMBLY_FRAGMENTS) return null
  for (const component of components) {
    if (component.length < MIN_FRAGMENT_ATOMS || component.length > MAX_FRAGMENT_ATOMS) return null
  }
  const counts = new Map<string, number>()
  for (const component of components) {
    const key = formula({ atoms: component.map((i) => structure.atoms[i]) } as ZatomStructure)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const formulas = [...counts.entries()].sort((p, q) => q[1] - p[1])
  const listed = formulas.slice(0, MAX_FORMULAS_LISTED).map(([f, n]) => `${f} x${n}`)
  const more = formulas.length - MAX_FORMULAS_LISTED
  return {
    fragmentCount: components.length,
    formulas,
    text:
      `# molecular assembly: ${components.length} fragments in a periodic cell — ` +
      `${listed.join(', ')}${more > 0 ? `, +${more} more kinds` : ''} · ` +
      'units are molecules, not lattice sites (no site classes)',
  }
}

export const buildMolecularTopology = (
  structure: ZatomStructure,
  detail: OutlineDetail,
): MolecularTopology | null => {
  if (detail === 'none') return null
  const graph = analysisBondGraph(structure)
  if (graph.skipped) return null
  const components = analysisComponents(structure)
  const ringReport = findRings(graph)
  const rings = [...ringReport.sizeCounts.entries()].sort(([a], [b]) => a - b)

  const summary =
    `# topology: ${formula(structure)} · ${graph.bondCount} bonds (${graph.source})` +
    ` · fragments=${components.length}` +
    (rings.length ? ` · rings=${rings.map(([size, n]) => `${n}x${size}`).join(' ')}` : ' · acyclic')

  const lines = [summary]
  if (detail === 'full' && structure.atoms.length <= MAX_ATOMS_FOR_ADJACENCY) {
    // Hydrogens are folded onto their heavy atom as a count: "C1: C2 C6 +1H".
    // That halves the list for an organic molecule and matches how a chemist
    // reads a skeleton.
    const atoms = structure.atoms
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].element === 'H') continue
      const partners: string[] = []
      let hydrogens = 0
      for (const j of graph.adjacency[i]) {
        if (atoms[j].element === 'H') hydrogens++
        else partners.push(atoms[j].id)
      }
      const ring = ringReport.ringAtoms.has(i) ? ' (ring)' : ''
      lines.push(
        `#   ${atoms[i].id}: ${partners.join(' ') || '-'}${hydrogens ? ` +${hydrogens}H` : ''}${ring}`,
      )
    }
  }

  return {
    bondCount: graph.bondCount,
    source: graph.source,
    fragmentCount: components.length,
    rings,
    text: lines.join('\n'),
  }
}
