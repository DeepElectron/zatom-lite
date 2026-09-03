/**
 * Quaternary structure — chain equivalence and chain-chain interfaces.
 *
 * Two facts about a multi-chain scene are invisible to every other channel here:
 *
 *   - Which chains are copies of each other. A 12-chain capsid described chain by
 *     chain costs twelve lines that differ only in a letter; described as
 *     "12 copies of a 153-residue chain" it costs one and says more. The outline
 *     uses this to keep a large assembly inside its budget.
 *   - Where two chains actually touch. `scene_contacts` answers this only from a
 *     focus the caller already chose, and its 60-row cap cannot enumerate an
 *     interface. Yet "which residues form the A/B interface" is the question a
 *     quaternary-structure decision is made of.
 *
 * Interface area is reported as a contact-count proxy rather than a real buried
 * SASA, and labelled as such. A tessellated SASA would need a surface pass this
 * package deliberately does not carry, and the proxy is monotone with area,
 * which is enough to rank interfaces and to tell a crystal contact from a
 * biological one.
 *
 * Pure module: structure + index in, interfaces out.
 */

import type { ZatomStructure } from '../../agent/contracts'
import { residueOneLetterCode } from '../biomolecule/residue-codes'
import { analysisNeighborGrid } from './scene-analysis'
import { type ResidueEntity, type ResidueIndex, residueLabel } from './residue-index'

/**
 * Interface cutoff, in Angstrom. 4.5 A is the standard heavy-atom contact
 * distance for interface residue definitions — wide enough for a salt bridge
 * through one water-sized gap, tight enough to exclude second-shell residues.
 */
export const INTERFACE_CUTOFF_A = 4.5

/**
 * Mean buried area per heavy-atom contact, in A^2. Empirical constant used only
 * to turn the contact count into a familiar unit; the count is the measurement.
 */
const AREA_PER_CONTACT_A2 = 8.5

/** Minimum residue pairs before a chain pair counts as an interface, not noise. */
const MIN_INTERFACE_PAIRS = 3

export interface InterfaceResiduePair {
  aLabel: string
  bLabel: string
  /** Closest heavy-atom approach between the two residues. */
  distance: number
}

export interface ChainInterface {
  chainA: string
  chainB: string
  /** Distinct residues of each chain taking part. */
  residueCountA: number
  residueCountB: number
  /** Heavy-atom contacts across the interface. */
  atomContactCount: number
  /** Contact-count proxy for buried area, in A^2. Not a tessellated SASA. */
  buriedAreaProxyA2: number
  /** Closest pairs first; capped by `maxPairsPerInterface`. */
  pairs: InterfaceResiduePair[]
  /** True when the pair list was capped. */
  truncated: boolean
}

export interface ChainCluster {
  /** Chains with the same polymer sequence. */
  chainIds: string[]
  /** Residue count of the representative chain. */
  residueCount: number
  /** Representative chain id — the first, in sorted order. */
  representative: string
}

export interface InterfaceResult {
  interfaces: ChainInterface[]
  cutoff: number
  /** Chains grouped by identical sequence. */
  clusters: ChainCluster[]
  /** True when more than one chain carries polymer residues. */
  multiChain: boolean
}

export interface InterfaceOptions {
  cutoff?: number
  maxPairsPerInterface?: number
  /** Cap on interfaces reported, ranked by buried-area proxy. */
  maxInterfaces?: number
}

const isHeavy = (element: string): boolean => element !== 'H' && element !== 'D'

/**
 * Group chains by identical polymer sequence.
 *
 * Sequence rather than residue count: two different 153-residue chains are not
 * copies, and reporting them as such would erase a real asymmetry. Ligands and
 * waters are excluded, because a chain's copies rarely bind the same solvent.
 */
export const groupEquivalentChains = (index: ResidueIndex): ChainCluster[] => {
  const sequenceByChain = new Map<string, string>()
  const residueCountByChain = new Map<string, number>()

  for (const chainId of index.chainIds) {
    const keys = index.chainResidueOrder.get(chainId) ?? []
    const letters: string[] = []
    for (const key of keys) {
      const residue = index.residues.get(key)
      if (!residue || residue.entityClass !== 'polymer') continue
      letters.push(residueOneLetterCode(residue.residueName))
    }
    if (letters.length === 0) continue
    sequenceByChain.set(chainId, letters.join(''))
    residueCountByChain.set(chainId, letters.length)
  }

  const bySequence = new Map<string, string[]>()
  for (const [chainId, sequence] of sequenceByChain) {
    const list = bySequence.get(sequence)
    if (list) list.push(chainId)
    else bySequence.set(sequence, [chainId])
  }

  const clusters: ChainCluster[] = []
  for (const chainIds of bySequence.values()) {
    chainIds.sort()
    clusters.push({
      chainIds,
      residueCount: residueCountByChain.get(chainIds[0]) ?? 0,
      representative: chainIds[0],
    })
  }
  // Largest multiplicity first: that is the assembly's dominant repeat.
  clusters.sort(
    (a, b) => b.chainIds.length - a.chainIds.length || b.residueCount - a.residueCount,
  )
  return clusters
}

/**
 * Enumerate chain-chain interfaces.
 *
 * One neighbor-grid pass over heavy atoms, keeping the closest approach per
 * residue pair. Each atom pair is visited once (neighbor index above self), so
 * an interface is not counted twice from opposite sides.
 */
export const findChainInterfaces = (
  structure: ZatomStructure,
  index: ResidueIndex,
  options: InterfaceOptions = {},
): InterfaceResult => {
  const cutoff = options.cutoff ?? INTERFACE_CUTOFF_A
  const maxPairs = options.maxPairsPerInterface ?? 12
  const maxInterfaces = options.maxInterfaces ?? 8

  const clusters = groupEquivalentChains(index)
  const polymerChains = new Set<string>()
  for (const residue of index.residues.values()) {
    if (residue.entityClass === 'polymer') polymerChains.add(residue.chainId)
  }
  const multiChain = polymerChains.size > 1
  if (!multiChain) {
    return { interfaces: [], cutoff, clusters, multiChain }
  }

  const grid = analysisNeighborGrid(structure, cutoff)
  const atoms = structure.atoms

  /** chainPair -> residuePair -> closest distance. */
  const pairDistance = new Map<string, Map<string, number>>()
  const atomContacts = new Map<string, number>()

  const residueOf = (atomId: string): ResidueEntity | undefined => {
    const key = index.residueByAtomId.get(atomId)
    return key === undefined ? undefined : index.residues.get(key)
  }

  for (let i = 0; i < atoms.length; i++) {
    if (!isHeavy(atoms[i].element)) continue
    const left = residueOf(atoms[i].id)
    if (!left || left.entityClass !== 'polymer') continue

    for (const hit of grid.neighborsOf(atoms[i].position, undefined, i)) {
      if (hit.atomIndex <= i) continue
      if (!isHeavy(hit.element)) continue
      const right = residueOf(hit.atomId)
      if (!right || right.entityClass !== 'polymer') continue
      if (right.chainId === left.chainId) continue

      // Canonical chain order so A/B and B/A are one interface.
      const flip = left.chainId > right.chainId
      const a = flip ? right : left
      const b = flip ? left : right
      const chainKey = `${a.chainId}\u0000${b.chainId}`
      const residueKey = `${a.key}\u0000${b.key}`

      atomContacts.set(chainKey, (atomContacts.get(chainKey) ?? 0) + 1)
      let residuePairs = pairDistance.get(chainKey)
      if (!residuePairs) {
        residuePairs = new Map()
        pairDistance.set(chainKey, residuePairs)
      }
      const prior = residuePairs.get(residueKey)
      if (prior === undefined || hit.distance < prior) residuePairs.set(residueKey, hit.distance)
    }
  }

  const interfaces: ChainInterface[] = []
  for (const [chainKey, residuePairs] of pairDistance) {
    if (residuePairs.size < MIN_INTERFACE_PAIRS) continue
    const [chainA, chainB] = chainKey.split('\u0000')
    const contacts = atomContacts.get(chainKey) ?? 0

    const ranked = [...residuePairs.entries()]
      .map(([residueKey, distance]) => {
        const [aKey, bKey] = residueKey.split('\u0000')
        return { aKey, bKey, distance }
      })
      .sort((x, y) => x.distance - y.distance)

    const residuesA = new Set(ranked.map((p) => p.aKey))
    const residuesB = new Set(ranked.map((p) => p.bKey))

    const pairs: InterfaceResiduePair[] = ranked.slice(0, maxPairs).map((pair) => ({
      aLabel: labelOf(index, pair.aKey),
      bLabel: labelOf(index, pair.bKey),
      distance: pair.distance,
    }))

    interfaces.push({
      chainA,
      chainB,
      residueCountA: residuesA.size,
      residueCountB: residuesB.size,
      atomContactCount: contacts,
      buriedAreaProxyA2: Math.round(contacts * AREA_PER_CONTACT_A2),
      pairs,
      truncated: ranked.length > pairs.length,
    })
  }

  // Largest interface first: in an assembly it is the one holding it together.
  interfaces.sort((a, b) => b.atomContactCount - a.atomContactCount)

  return {
    interfaces: interfaces.slice(0, maxInterfaces),
    cutoff,
    clusters,
    multiChain,
  }
}

const labelOf = (index: ResidueIndex, residueKey: string): string => {
  const residue = index.residues.get(residueKey)
  return residue ? residueLabel(residue) : residueKey
}

/** One-line rendering of the interface channel. */
export const renderInterfaces = (result: InterfaceResult, verbose: boolean): string[] => {
  const lines: string[] = []

  const repeats = result.clusters.filter((cluster) => cluster.chainIds.length > 1)
  if (repeats.length > 0) {
    const parts = repeats.map(
      (cluster) =>
        `${cluster.chainIds.length}x [${cluster.chainIds.join(' ')}] ${cluster.residueCount} res`,
    )
    lines.push(`chain copies: ${parts.join(' | ')} (identical sequence)`)
  }

  for (const iface of result.interfaces) {
    const head =
      `interface ${iface.chainA}/${iface.chainB}: ${iface.residueCountA}+${iface.residueCountB} res, ` +
      `${iface.atomContactCount} atom contacts <=${result.cutoff.toFixed(1)}A, ` +
      `~${iface.buriedAreaProxyA2} A^2 buried (contact-count proxy)`
    lines.push(head)
    if (verbose && iface.pairs.length > 0) {
      const parts = iface.pairs.map((p) => `${p.aLabel}-${p.bLabel} ${p.distance.toFixed(2)}`)
      lines.push(`  ${parts.join('  ')}${iface.truncated ? '  +more' : ''}`)
    }
  }
  return lines
}
