/**
 * Site deviation — classifies atoms in a periodic scene by how far they depart
 * from bulk coordination.
 *
 * A perfect crystal is almost pure redundancy under per-atom description: 256
 * fcc Cu atoms all say "Cu". The information a modeling decision needs lives in
 * the deviations — surface terminations, vacancies, adatoms, adsorbates. So the
 * periodic regime reports the *most notable departure* in each cell rather than
 * repeating the same element symbol.
 *
 * Coordination uses a cutoff per element pair, read off the structure itself:
 * the first gap in the A-B pair-distance distribution (the first minimum of the
 * partial RDF). A fixed 3.2 A is right for Cu and Pt and wrong for almost
 * everything else — bcc Cs has no neighbor inside 5.3 A, rutile O-O sits at
 * 2.5 A — and the failure is silent: every atom gets CN 0, the modal reference
 * becomes 0, and the whole slab reads as "bulk".
 *
 * Pure module: structure in, classification out.
 */

import type { ZatomStructure } from '../../agent/contracts'
import { NeighborGrid } from './neighbor-grid'

/**
 * How an atom departs from bulk coordination. Ordered by how much attention it
 * deserves — see `SITE_RANK`.
 */
export type SiteClass = 'bulk' | 'subsurface' | 'surface' | 'edge' | 'adatom' | 'foreign'

/**
 * Attention rank. A cell reports its highest-ranked occupant, so a single
 * adsorbate is never buried under the bulk atoms stacked behind it.
 */
export const SITE_RANK: Record<SiteClass, number> = {
  bulk: 0,
  subsurface: 1,
  surface: 2,
  edge: 3,
  adatom: 4,
  foreign: 5,
}

/** Single-character marker used in the ASCII grid. */
export const SITE_MARKER: Record<SiteClass, string> = {
  bulk: '#',
  subsurface: ':',
  surface: 'S',
  edge: 'E',
  adatom: 'A',
  foreign: 'X',
}

export interface SiteDeviationOptions {
  /**
  * Fixed coordination cutoff in Angstrom for every element pair. When omitted
  * the cutoff is derived per pair from the structure (recommended).
  */
  cutoff?: number
}

export interface SiteDeviationResult {
  /** atom id -> site class. Empty when `degenerate`. */
  byAtomId: Map<string, SiteClass>
  /** Headline bulk reference: the largest per-element modal coordination. */
  bulkCoordination: number
  /** Modal coordination per majority element; each atom is judged against its own. */
  bulkCoordinationByElement: Record<string, number>
  /** Count per class, for the summary line. */
  counts: Record<SiteClass, number>
  /** Elements present in a minority (<10%), treated as foreign/adsorbate. */
  minorityElements: string[]
  /** Cutoff actually used per element pair, keyed "A-B" with A <= B. */
  pairCutoffs: Record<string, number>
  /** Bonding environment of foreign/adatom sites (capped), nearest neighbour first. */
  environments: SiteEnvironment[]
  /**
  * True when no coordination shell exists (no majority-element pair within
  * `MAX_SHELL_SEARCH_A`). No site classes are assigned in that case; callers
  * must not render a bulk/surface story about a scene that has no bonds.
  */
  degenerate: boolean
  /**
  * True when the frame element has no dominant coordination: its CN is spread
  * over many values and its first shell has no gap. That is a liquid, glass or
  * MD snapshot, and "deviation from bulk" is not a meaningful frame for it. No
  * site classes are assigned; `coordinationStats` carries what can be said.
  */
  disordered: boolean
  /** Per majority element: coordination distribution and first-shell distance. */
  coordinationStats: Record<string, CoordinationStats>
}

export interface CoordinationStats {
  mean: number
  stdDev: number
  /** Share of atoms at the modal coordination. */
  modalShare: number
  /** Median first-neighbour distance (A). */
  firstShellA: number
}

/** A frame element whose CN takes this many values at >= 10% share each is disordered. */
const DISORDER_MIN_SPREAD = 4
/** ...or, when its dominant pair has no shell gap, whose modal share is below this. */
const DISORDER_MAX_MODAL_SHARE = 0.6

/** Widest first shell we will look for. Cs-Cs in bcc Cs is 5.3 A. */
export const MAX_SHELL_SEARCH_A = 8.0
/** The first gap wider than this fraction of the shortest A-B distance ends the first shell. */
const SHELL_GAP_FRACTION = 0.1
/** Where to stop looking for that gap, relative to the shortest A-B distance. */
const SHELL_SCAN_FACTOR = 1.75
/** Cutoff when no gap shows up (heavily disordered pair): just past the shortest distance. */
const NO_GAP_FACTOR = 1.2
/** Distance samples per element pair; enough to see a gap, bounded for big scenes. */
const MAX_SAMPLES_PER_PAIR = 4000
/** How much longer than an element's shortest contact a pair may be and still count as bonding. */
const FIRST_CONTACT_TOLERANCE = 0.08
/** Fraction of an element's atoms that must have a partner for that contact to set its bonding scale. */
const TYPICAL_CONTACT_COVERAGE = 0.5
/**
 * Below this many atoms the 10% minority rule is meaningless (one Sr in a
 * five-atom perovskite cell is not an adsorbate), so no element is foreign and
 * an adatom shows up through its coordination deficit instead.
 */
const MIN_ATOMS_FOR_MINORITY = 20
/** Header caps: enough ids to act on, never a dump. */
const MAX_IDS_PER_CLASS = 16
const MAX_ENVIRONMENTS = 8
const MAX_NEIGHBORS_PER_ENVIRONMENT = 4

export interface SiteEnvironment {
  atomId: string
  element: string
  class: SiteClass
  neighbors: { atomId: string; element: string; distance: number }[]
}

const pairKey = (a: string, b: string): string => (a <= b ? `${a}-${b}` : `${b}-${a}`)

/**
 * First-shell cutoff per element pair from the pair-distance distribution.
 *
 * For each pair, sort the sampled distances up to `SHELL_SCAN_FACTOR` x the
 * shortest one and take the midpoint of the first gap wider than
 * `SHELL_GAP_FRACTION` x that shortest distance. fcc: shells at d and 1.41 d,
 * gap found. bcc: d, 1.15 d, 1.63 d — the 15% gap is found first, giving CN 8
 * rather than 14. Rutile: Ti-O 1.95/1.98 then O-O 2.53, gap found, Ti CN 6.
 */
const derivePairCutoffs = (
  structure: ZatomStructure,
): { cutoffs: Map<string, number>; searchRadius: number; gapFound: Set<string> } => {
  const atoms = structure.atoms
  const grid = new NeighborGrid(structure, { cutoff: MAX_SHELL_SEARCH_A })
  /** Pairs whose first shell ended in a real gap (a crystal signature). */
  const gapFound = new Set<string>()

  const samples = new Map<string, number[]>()
  for (let i = 0; i < atoms.length; i++) {
    const elementI = atoms[i].element
    grid.forEachNeighborImage(i, (j, distance) => {
      const key = pairKey(elementI, atoms[j].element)
      let list = samples.get(key)
      if (!list) {
        list = []
        samples.set(key, list)
      }
      if (list.length < MAX_SAMPLES_PER_PAIR) list.push(distance)
    })
  }

  const cutoffs = new Map<string, number>()
  for (const [key, list] of samples) {
    list.sort((a, b) => a - b)
    const dMin = list[0]
    const scanEnd = dMin * SHELL_SCAN_FACTOR
    const gap = dMin * SHELL_GAP_FRACTION
    let cutoff = dMin * NO_GAP_FACTOR
    for (let k = 1; k < list.length && list[k] <= scanEnd; k++) {
      if (list[k] - list[k - 1] > gap) {
        cutoff = (list[k] + list[k - 1]) / 2
        gapFound.add(key)
        break
      }
    }
    // A pair sampled once (a lone adatom) has no distribution; the default
    // just past its only distance is the honest answer.
    if (list.length === 1) cutoff = dMin * NO_GAP_FACTOR
    cutoffs.set(key, cutoff)
  }

  // A pair is a coordination contact only if it is (near) the shortest *typical*
  // contact of at least one of its elements. Rutile O-O at 2.5 A is 30% longer
  // than O's Ti-O at 1.95 A: second shell, not a bond. Cu-Cu in an alloy sits
  // within a few percent of Cu-Au and is kept.
  //
  // "Typical" means at least half of the element's atoms have that partner in
  // range. One O adatom on a Cu slab gives Cu a 1.9 A contact, but only one Cu
  // in thirty-six has it, so it must not redefine Cu's bonding scale and
  // disqualify Cu-Cu. In Cu2O every Cu has O, and Cu-Cu is rightly dropped.
  const elementTotals = new Map<string, number>()
  for (const atom of atoms) elementTotals.set(atom.element, (elementTotals.get(atom.element) ?? 0) + 1)
  const withPartner = new Map<string, number>() // `${element}|${pairKey}` -> atoms having it
  const partnersSeen = new Set<string>()
  for (let i = 0; i < atoms.length; i++) {
    const elementI = atoms[i].element
    partnersSeen.clear()
    grid.forEachNeighborImage(i, (j, distance) => {
      const key = pairKey(elementI, atoms[j].element)
      const cutoff = cutoffs.get(key)
      if (cutoff !== undefined && distance <= cutoff) partnersSeen.add(key)
    })
    for (const key of partnersSeen) {
      const k = `${elementI}|${key}`
      withPartner.set(k, (withPartner.get(k) ?? 0) + 1)
    }
  }
  const shortest = new Map<string, number>()
  for (const [key, list] of samples) {
    const [a, b] = key.split('-')
    for (const element of [a, b]) {
      const coverage = (withPartner.get(`${element}|${key}`) ?? 0) / (elementTotals.get(element) ?? 1)
      if (coverage < TYPICAL_CONTACT_COVERAGE) continue
      shortest.set(element, Math.min(shortest.get(element) ?? Infinity, list[0]))
    }
  }
  for (const [key, list] of samples) {
    const [a, b] = key.split('-')
    const dMin = list[0]
    const isBondFor = (element: string): boolean =>
      dMin <= (shortest.get(element) ?? Infinity) * (1 + FIRST_CONTACT_TOLERANCE)
    if (!isBondFor(a) && !isBondFor(b)) cutoffs.delete(key)
  }

  let searchRadius = 0
  for (const cutoff of cutoffs.values()) if (cutoff > searchRadius) searchRadius = cutoff
  return { cutoffs, searchRadius, gapFound }
}

/**
 * Classify every atom by coordination deficit relative to the modal (bulk)
 * coordination number.
 *
 * The modal count is the reference rather than a hardcoded 12 (fcc) because the
 * same routine must serve bcc, hcp, oxides and slabs. Any atom whose element is
 * a small minority of the scene is `foreign` regardless of coordination — that
 * is the adsorbate case, which matters most and is cheapest to detect.
 */
export const classifySiteDeviation = (
  structure: ZatomStructure,
  options: SiteDeviationOptions = {},
): SiteDeviationResult => {
  const atoms = structure.atoms
  const byAtomId = new Map<string, SiteClass>()
  const counts: Record<SiteClass, number> = {
    bulk: 0,
    subsurface: 0,
    surface: 0,
    edge: 0,
    adatom: 0,
    foreign: 0,
  }
  const empty = (): SiteDeviationResult => ({
    byAtomId,
    bulkCoordination: 0,
    bulkCoordinationByElement: {},
    counts,
    minorityElements: [],
    pairCutoffs: {},
    environments: [],
    degenerate: true,
    disordered: false,
    coordinationStats: {},
  })
  if (atoms.length === 0) return empty()

  // Minority elements: the adsorbate signal. Cheap and high-value.
  const elementCounts = new Map<string, number>()
  for (const atom of atoms) {
    elementCounts.set(atom.element, (elementCounts.get(atom.element) ?? 0) + 1)
  }
  const minorityThreshold = Math.floor(atoms.length * 0.1)
  const minorityElements =
    atoms.length < MIN_ATOMS_FOR_MINORITY
      ? []
      : [...elementCounts.entries()]
          .filter(([, n]) => n <= minorityThreshold)
          .map(([el]) => el)
          .sort()
  const minoritySet = new Set(minorityElements)
  // A single-element scene has no minority: every element is the majority.
  const hasMajority = elementCounts.size > minoritySet.size
  const isMinority = (element: string): boolean => hasMajority && minoritySet.has(element)

  let pairCutoff: (a: string, b: string) => number
  let searchRadius: number
  const pairCutoffs: Record<string, number> = {}
  // With a caller-fixed cutoff there is no distribution to judge order from,
  // so every pair is treated as if it had a shell gap.
  let gapFound: Set<string> | null = null
  if (options.cutoff !== undefined) {
    searchRadius = options.cutoff
    pairCutoff = () => options.cutoff as number
    pairCutoffs['*-*'] = options.cutoff
  } else {
    const derived = derivePairCutoffs(structure)
    // No majority-majority pair inside the search window: there is no lattice
    // of bonds to measure deviation from.
    const hasMajorityShell = [...derived.cutoffs.keys()].some((key) => {
      const [a, b] = key.split('-')
      return !isMinority(a) && !isMinority(b)
    })
    if (!hasMajorityShell) return { ...empty(), minorityElements }
    searchRadius = derived.searchRadius
    gapFound = derived.gapFound
    pairCutoff = (a, b) => derived.cutoffs.get(pairKey(a, b)) ?? 0
    for (const [key, value] of derived.cutoffs) pairCutoffs[key] = Math.round(value * 100) / 100
  }

  const grid = new NeighborGrid(structure, { cutoff: searchRadius })
  const coordination = grid.coordinationNumbers(pairCutoff)

  // Bulk reference per majority element: the modal coordination of that
  // element. Rutile Ti (6) and O (3) must each be judged against their own
  // bulk, and a heavy adsorbate layer (minority) never enters the histogram.
  const histograms = new Map<string, Map<number, number>>()
  for (let i = 0; i < atoms.length; i++) {
    const element = atoms[i].element
    if (isMinority(element)) continue
    let histogram = histograms.get(element)
    if (!histogram) {
      histogram = new Map()
      histograms.set(element, histogram)
    }
    histogram.set(coordination[i], (histogram.get(coordination[i]) ?? 0) + 1)
  }
  const bulkCoordinationByElement: Record<string, number> = {}
  for (const [element, histogram] of histograms) {
    let modal = 0
    let modalFrequency = -1
    for (const [cn, freq] of histogram) {
      if (freq > modalFrequency || (freq === modalFrequency && cn > modal)) {
        modalFrequency = freq
        modal = cn
      }
    }
    bulkCoordinationByElement[element] = modal
  }

  // Coordination statistics per majority element, and the order test. A
  // crystal's CN takes a few discrete values (bulk, surface, edge); a liquid's
  // is a broad hump with no shell gap behind it. The frame element decides.
  const coordinationStats: Record<string, CoordinationStats> = {}
  const spreadOf = new Map<string, number>()
  for (const [element, histogram] of histograms) {
    let n = 0
    let sum = 0
    let sumSq = 0
    let spread = 0
    for (const [cn, freq] of histogram) {
      n += freq
      sum += cn * freq
      sumSq += cn * cn * freq
    }
    for (const freq of histogram.values()) if (freq / n >= 0.1) spread++
    spreadOf.set(element, spread)
    const mean = sum / n
    const modalShare = (histogram.get(bulkCoordinationByElement[element]) ?? 0) / n
    // First-shell distance: median nearest-neighbour distance of this element.
    const nearest: number[] = []
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].element !== element) continue
      let best = Infinity
      grid.forEachNeighborImage(i, (j, distance) => {
        if (distance <= pairCutoff(element, atoms[j].element) && distance < best) best = distance
      })
      if (best < Infinity) nearest.push(best)
      if (nearest.length >= MAX_SAMPLES_PER_PAIR) break
    }
    nearest.sort((a, b) => a - b)
    coordinationStats[element] = {
      mean,
      stdDev: Math.sqrt(Math.max(0, sumSq / n - mean * mean)),
      modalShare,
      firstShellA: nearest.length ? nearest[nearest.length >> 1] : 0,
    }
  }
  const frameElement = Object.entries(bulkCoordinationByElement).sort((p, q) => q[1] - p[1])[0]?.[0]
  if (frameElement) {
    const stats = coordinationStats[frameElement]
    const frameGap = gapFound === null || gapFound.has(pairKey(frameElement, frameElement))
    const disordered =
      (spreadOf.get(frameElement) ?? 0) >= DISORDER_MIN_SPREAD ||
      (!frameGap && stats.modalShare < DISORDER_MAX_MODAL_SHARE)
    if (disordered) {
      return {
        ...empty(),
        degenerate: false,
        disordered: true,
        bulkCoordinationByElement,
        minorityElements,
        pairCutoffs,
        coordinationStats,
      }
    }
  }

  // An element whose typical coordination is <= 2 while another element forms a
  // real lattice frame (>= 6) is an overlayer, not a bulk of its own: a full O
  // monolayer is 20% of a slab, so it escapes the minority rule, yet "bulkCN
  // O=1" would be a meaningless reference. Report it as foreign instead.
  const frameCn = Math.max(0, ...Object.values(bulkCoordinationByElement))
  if (frameCn >= 6) {
    for (const [element, cn] of Object.entries(bulkCoordinationByElement)) {
      if (cn <= 2) {
        delete bulkCoordinationByElement[element]
        minorityElements.push(element)
        minoritySet.add(element)
      }
    }
    minorityElements.sort()
  }
  const references = Object.values(bulkCoordinationByElement)
  if (references.every((cn) => cn === 0)) return { ...empty(), minorityElements, pairCutoffs }
  // Headline reference: the highest per-element bulk CN (the cation frame in an
  // oxide, the only value in a metal).
  const bulkCoordination = Math.max(...references)

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i]
    const cn = coordination[i]

    let cls: SiteClass
    if (isMinority(atom.element)) {
      cls = 'foreign'
    } else {
      const reference = bulkCoordinationByElement[atom.element] ?? 0
      const deficit = reference - cn
      if (deficit <= 0) cls = 'bulk'
      else if (deficit <= 1) cls = 'subsurface'
      else if (deficit <= Math.max(2, Math.round(reference * 0.35))) cls = 'surface'
      else if (cn >= 3) cls = 'edge'
      else cls = 'adatom'
    }

    byAtomId.set(atom.id, cls)
    counts[cls]++
  }

  // Bonding environment of every foreign or adatom site: the question the
  // model asks about an adsorbate is "what is it bonded to and how far", and
  // the grid cannot answer it. Neighbours within the pair cutoff, nearest first.
  const environments: SiteEnvironment[] = []
  for (let i = 0; i < atoms.length; i++) {
    const cls = byAtomId.get(atoms[i].id)
    if (cls !== 'foreign' && cls !== 'adatom') continue
    if (environments.length >= MAX_ENVIRONMENTS) break
    const elementI = atoms[i].element
    const neighbors: SiteEnvironment['neighbors'] = []
    grid.forEachNeighborImage(i, (j, distance) => {
      if (distance <= pairCutoff(elementI, atoms[j].element)) {
        neighbors.push({ atomId: atoms[j].id, element: atoms[j].element, distance })
      }
    })
    neighbors.sort((p, q) => p.distance - q.distance)
    environments.push({ atomId: atoms[i].id, element: elementI, class: cls, neighbors })
  }

  return {
    byAtomId,
    bulkCoordination,
    bulkCoordinationByElement,
    counts,
    minorityElements,
    pairCutoffs,
    environments,
    degenerate: false,
    disordered: false,
    coordinationStats,
  }
}

/** Ids per class, capped, for the header: the link from gestalt to action. */
export const siteDeviationLines = (result: SiteDeviationResult): string[] => {
  if (result.degenerate || result.disordered) return []
  const lines: string[] = []
  const idsByClass = new Map<SiteClass, string[]>()
  for (const [id, cls] of result.byAtomId) {
    if (cls === 'bulk') continue
    const list = idsByClass.get(cls) ?? []
    list.push(id)
    idsByClass.set(cls, list)
  }
  for (const cls of ['foreign', 'adatom', 'edge', 'surface', 'subsurface'] as SiteClass[]) {
    const ids = idsByClass.get(cls)
    if (!ids) continue
    const shown = ids.slice(0, MAX_IDS_PER_CLASS)
    const more = ids.length - shown.length
    lines.push(`# ${cls} ids: ${shown.join(' ')}${more > 0 ? ` +${more} more` : ''}`)
  }
  for (const env of result.environments) {
    const bonds = env.neighbors
      .slice(0, MAX_NEIGHBORS_PER_ENVIRONMENT)
      .map((n) => `${n.element}:${n.atomId}@${n.distance.toFixed(2)}`)
      .join(' ')
    const more = env.neighbors.length - MAX_NEIGHBORS_PER_ENVIRONMENT
    lines.push(
      `# ${env.element}:${env.atomId} (${env.class}) CN=${env.neighbors.length}` +
        (bonds ? ` -> ${bonds}${more > 0 ? ` +${more}` : ''} A` : ' -> no neighbours within cutoff'),
    )
  }
  return lines
}

/** One-line summary for the grid header. */
export const siteDeviationSummary = (result: SiteDeviationResult): string => {
  if (result.degenerate) {
    return `no coordination shell within ${MAX_SHELL_SEARCH_A} A; site classes not assigned (isolated atoms or gas)`
  }
  if (result.disordered) {
    // No lattice to deviate from: report the distribution the model can reason
    // with (a liquid/glass/MD snapshot) instead of a bulk/surface story.
    const stats = Object.entries(result.coordinationStats)
      .map(
        ([el, s]) =>
          `${el}: CN=${s.mean.toFixed(1)}±${s.stdDev.toFixed(1)} (modal ${Math.round(s.modalShare * 100)}%) firstShell=${s.firstShellA.toFixed(2)}A`,
      )
      .join(' · ')
    return `disordered — no dominant coordination, site classes not assigned (liquid/amorphous/MD snapshot) · ${stats}`
  }
  const byElement = Object.entries(result.bulkCoordinationByElement)
  const parts: string[] = [
    byElement.length > 1
      ? `bulkCN{${byElement.map(([el, cn]) => `${el}=${cn}`).join(' ')}}`
      : `bulkCN=${result.bulkCoordination}`,
  ]
  for (const cls of ['foreign', 'adatom', 'edge', 'surface', 'subsurface', 'bulk'] as SiteClass[]) {
    if (result.counts[cls] > 0) parts.push(`${cls}=${result.counts[cls]}`)
  }
  if (result.minorityElements.length > 0) {
    parts.push(`minorityElements=[${result.minorityElements.join(' ')}]`)
  }
  const cutoffs = Object.entries(result.pairCutoffs)
    .map(([pair, value]) => `${pair}<=${value.toFixed(2)}`)
    .join(' ')
  if (cutoffs) parts.push(`cutoffA{${cutoffs}}`)
  return parts.join(' ')
}
