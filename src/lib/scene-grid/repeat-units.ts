/**
 * Polymer repeat-unit detection.
 *
 * A 400-atom polyethylene chain listed atom by atom is 400 lines that say one
 * thing: "CH2, fifty times, capped with CH3". This finds that description.
 *
 * The whole difficulty is the end groups. A real chain is not periodic over its
 * full length, because the termini differ from the interior — a terminal CH3
 * carries three hydrogens where an interior CH2 carries two. Testing the entire
 * backbone for a period therefore fails on essentially every real polymer, which
 * is why this trims candidate end groups before testing rather than after.
 *
 * Backbone extraction and molecule decomposition are reused from topology.ts;
 * neither is reimplemented here.
 *
 * Scope, stated precisely because the boundary is not obvious:
 *
 * The backbone is the graph diameter path, which is the main chain only while
 * the substituents are short. A long side group makes the diameter detour
 * through it — on a polystyrene chain the diameter runs from a phenyl carbon,
 * along part of the backbone, and out into another phenyl, so the extracted path
 * is mostly side group. Ring backbones have no linear path at all: the diameter
 * of a six-ring spans half of it, leaving the two cut atoms with the other half
 * as an apparent substituent.
 *
 * Both cases fail closed. The window is not periodic, so nothing is reported,
 * which is the outcome that matters: this returns no answer rather than a wrong
 * one. Polymers with small substituents (H, halogen, methyl) are handled;
 * ring-bearing and aromatic-backbone polymers are not, and are declined.
 */

import type { ZatomStructure, ZatomStructureAtom } from '../../agent/contracts'
import {
  type BondGraph,
  buildBondGraph,
  connectedComponents,
  longestPath,
} from './topology'

/**
 * Depth of the pendant-subtree walk used to fingerprint a backbone site.
 *
 * 3 separates the substituents that actually distinguish common polymers (H vs
 * Cl vs CH3 vs phenyl) without walking a long grafted side chain, whose length
 * would then leak into the period and split one repeat unit into several.
 */
const BRANCH_DEPTH = 3

/**
 * Candidate end-group atoms trimmed from each side of the backbone.
 *
 * 3 covers the usual initiator and terminator fragments. Allowing an unbounded
 * trim would let the search discard most of a short chain to manufacture a
 * period, which is how this kind of detector starts reporting polymers that are
 * not there.
 */
const MAX_END_TRIM = 3

/** Below this a "period" is not evidence of anything. */
const MIN_PERIODIC_WINDOW = 4

/** A repeat unit claim needs at least this many copies. */
const MIN_REPEATS = 2

export interface RepeatUnitOptions {
  maxEndTrim?: number
  minRepeats?: number
  /** Cap on atom ids listed per monomer and per end group. */
  maxIdsListed?: number
}

export interface RepeatUnit {
  /** Backbone atoms per repeat. */
  period: number
  /** Whole repeats found. */
  repeats: number
  /** Backbone length actually explained by the repeats. */
  backboneCovered: number
  /** Full backbone length of this component. */
  backboneLength: number
  /**
  * Per-site fingerprints of one repeat, in backbone order. This is the monomer
  * as the detector actually sees it.
  */
  unitSignature: string[]
  /** Atom ids of the first repeat, backbone atoms only. */
  unitAtomIds: string[]
  /** Backbone atom ids trimmed as end groups, leading and trailing. */
  leadingEndGroupIds: string[]
  trailingEndGroupIds: string[]
}

export interface RepeatUnitReport {
  /** Molecules examined, largest first. */
  componentCount: number
  /** Components whose backbone was long enough to test. */
  testedCount: number
  /** One entry per component with a detected repeat unit, largest first. */
  units: RepeatUnit[]
  /** True when connectivity was unavailable, so nothing could be determined. */
  connectivityMissing: boolean
  bondSource: BondGraph['source']
}

const elementOf = (atom: ZatomStructureAtom): string => atom.element.trim().toUpperCase()

/**
 * Heavy-atom backbone: the diameter path with terminal hydrogens removed.
 *
 * The raw graph diameter of an alkane chain runs H-C-...-C-H, because the
 * terminal hydrogens each add an edge. A polymer backbone is a heavy-atom chain,
 * so those ends are not part of it.
 *
 * Trimming only the ends is sufficient rather than a heuristic: a hydrogen has
 * degree 1, and a degree-1 atom cannot be an interior node of a path, since an
 * interior node needs one edge in and one edge out. Any hydrogen on the diameter
 * path is therefore at one of its two ends.
 */
const heavyBackbone = (
  path: readonly number[],
  atoms: readonly ZatomStructureAtom[],
): number[] => {
  let start = 0
  let end = path.length
  while (start < end && elementOf(atoms[path[start]]) === 'H') start++
  while (end > start && elementOf(atoms[path[end - 1]]) === 'H') end--
  return path.slice(start, end)
}



/**
 * Fingerprint the pendant subtree hanging off one backbone atom.
 *
 * The walk never crosses another backbone atom, so a substituent is described
 * only by what is genuinely pendant at this site. Elements are sorted per depth
 * level, which makes the fingerprint independent of atom ordering in the file —
 * two chemically identical sites must produce identical strings or the period
 * search will not see them as equivalent.
 */
const branchFingerprint = (
  atomIndex: number,
  graph: BondGraph,
  atoms: readonly ZatomStructureAtom[],
  backbone: ReadonlySet<number>,
  maxDepth: number,
): string => {
  const visited = new Set<number>([atomIndex])
  let frontier: number[] = []
  for (const neighbor of graph.adjacency[atomIndex]) {
    if (backbone.has(neighbor)) continue
    visited.add(neighbor)
    frontier.push(neighbor)
  }

  const levels: string[] = []
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    levels.push(
      frontier
        .map((index) => elementOf(atoms[index]))
        .sort()
        .join(''),
    )
    const next: number[] = []
    for (const current of frontier) {
      for (const neighbor of graph.adjacency[current]) {
        if (visited.has(neighbor) || backbone.has(neighbor)) continue
        visited.add(neighbor)
        next.push(neighbor)
      }
    }
    frontier = next
  }
  return levels.join('/')
}

/**
 * Smallest p such that the window repeats with period p, or null.
 *
 * Requires the entire window to be consistent, not merely the first two blocks:
 * a sequence that matches for one period and then diverges is not periodic, and
 * accepting it would report a repeat unit for any chain whose first two sites
 * happen to agree.
 */
const smallestPeriod = (signatures: readonly string[], minRepeats: number): number | null => {
  const n = signatures.length
  const maxPeriod = Math.floor(n / minRepeats)
  for (let period = 1; period <= maxPeriod; period++) {
    let consistent = true
    for (let i = 0; i + period < n; i++) {
      if (signatures[i] !== signatures[i + period]) {
        consistent = false
        break
      }
    }
    if (consistent) return period
  }
  return null
}

interface PeriodFit {
  period: number
  lead: number
  tail: number
  repeats: number
  covered: number
}

/**
 * Best period over all small end trims.
 *
 * Ranked by backbone actually explained, then by least trimming. Explaining more
 * of the chain is the point, and the tie-break exists so that a fit which
 * discards atoms is never preferred to an equally good fit that keeps them.
 */
const bestPeriodFit = (
  signatures: readonly string[],
  maxEndTrim: number,
  minRepeats: number,
): PeriodFit | null => {
  let best: PeriodFit | null = null
  const n = signatures.length

  for (let lead = 0; lead <= maxEndTrim; lead++) {
    for (let tail = 0; tail <= maxEndTrim; tail++) {
      const window = signatures.slice(lead, n - tail)
      if (window.length < MIN_PERIODIC_WINDOW) continue
      const period = smallestPeriod(window, minRepeats)
      if (period === null) continue
      const repeats = Math.floor(window.length / period)
      const covered = repeats * period
      const trim = lead + tail
      if (
        !best ||
        covered > best.covered ||
        (covered === best.covered && trim < best.lead + best.tail)
      ) {
        best = { period, lead, tail, repeats, covered }
      }
    }
  }
  return best
}

/**
 * Find repeat units per molecule.
 *
 * Returns an empty unit list rather than a guess when connectivity is
 * unavailable or no component is periodic. A non-polymer must report nothing; a
 * detector that always finds a period is not measuring anything.
 */
export const findRepeatUnits = (
  structure: ZatomStructure,
  options: RepeatUnitOptions = {},
): RepeatUnitReport => {
  const maxEndTrim = options.maxEndTrim ?? MAX_END_TRIM
  const minRepeats = options.minRepeats ?? MIN_REPEATS
  const maxIds = options.maxIdsListed ?? 40

  const graph = buildBondGraph(structure)
  if (graph.skipped || graph.bondCount === 0) {
    return {
      componentCount: 0,
      testedCount: 0,
      units: [],
      connectivityMissing: true,
      bondSource: graph.source,
    }
  }

  const atoms = structure.atoms
  const components = connectedComponents(graph)
  const units: RepeatUnit[] = []
  let testedCount = 0

  for (const component of components) {
    const backbone = heavyBackbone(longestPath(graph, component), atoms)
    if (backbone.length < MIN_PERIODIC_WINDOW) continue
    testedCount++

    const backboneSet = new Set(backbone)
    const signatures = backbone.map(
      (index) =>
        `${elementOf(atoms[index])}[${branchFingerprint(index, graph, atoms, backboneSet, BRANCH_DEPTH)}]`,
    )

    const fit = bestPeriodFit(signatures, maxEndTrim, minRepeats)
    if (!fit) continue

    const unitStart = fit.lead
    const unitIndices = backbone.slice(unitStart, unitStart + fit.period)

    units.push({
      period: fit.period,
      repeats: fit.repeats,
      backboneCovered: fit.covered,
      backboneLength: backbone.length,
      unitSignature: signatures.slice(unitStart, unitStart + fit.period),
      unitAtomIds: unitIndices.slice(0, maxIds).map((index) => atoms[index].id),
      leadingEndGroupIds: backbone.slice(0, fit.lead).map((index) => atoms[index].id),
      trailingEndGroupIds: backbone
        .slice(backbone.length - fit.tail)
        .map((index) => atoms[index].id),
    })
  }

  units.sort((a, b) => b.backboneCovered - a.backboneCovered)

  return {
    componentCount: components.length,
    testedCount,
    units,
    connectivityMissing: false,
    bondSource: graph.source,
  }
}
