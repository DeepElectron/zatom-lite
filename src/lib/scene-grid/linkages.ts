/**
 * Covalent and coordinative cross-links: disulfides and metal sites.
 *
 * These are the linkages a bond graph does not give you. `topology.ts` answers
 * "what is connected to what", which is enough to split molecules and find
 * rings, but it cannot say *which* connections carry the structural or chemical
 * story. Two questions recur and neither is answerable from adjacency alone:
 *
 * 1. Which cysteines are oxidised into disulfides, and do any of them staple
 *    two different chains together? An inter-chain disulfide is not a detail —
 *    it is why insulin's A and B chains are one molecule and why an antibody
 *    does not fall into four pieces. A chain-level description that misses it
 *    describes a different protein.
 *
 * 2. What is coordinating each metal, and with what geometry? A zinc held by
 *    four protein donors is a catalytic or structural site; the same zinc held
 *    by six waters is a solvated ion that happened to be in the buffer. The
 *    coordination shell is the difference, and coordination number alone does
 *    not settle it.
 *
 * Both passes reuse the memoized residue index and neighbor grid from
 * `scene-analysis`, so adding them to a grid that already ran another channel
 * costs a filter over existing derivations rather than a fresh spatial build.
 * Element predicates come from `analysis/mof/metal-table` — the metal and donor
 * vocabulary already exists there and is already case-insensitive.
 */

import type { ZatomStructure, ZatomStructureAtom } from '../../agent/contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO } from '../../agent/biomolecular-identity'
import {
  isAlkaliOrAlkalineEarth,
  isCommonDonor,
  isMetal,
  normalizeElementSymbol,
} from '../analysis/mof/metal-table'
import { analysisNeighborGrid, analysisResidueIndex } from './scene-analysis'
import { type EntityClass, type ResidueIndex, residueLabel } from './residue-index'

/* ------------------------------------------------------------------ */
/* Disulfides                                                          */
/* ------------------------------------------------------------------ */

/**
 * S-S covalent bond length is 2.03-2.08 A in refined structures. The window is
 * widened to 1.8-2.5 A so a moderately strained or low-resolution model still
 * reports its disulfides, while staying well clear of the 3.5 A+ separation of
 * two merely adjacent reduced cysteines.
 */
export const DISULFIDE_MIN_A = 1.8
export const DISULFIDE_MAX_A = 2.5

/**
 * The cysteine sulfur is named SG. Keying on the atom name rather than on a
 * residue-name whitelist is both narrower and broader in the right directions:
 * it admits modified cysteines (CYX, CSO, and the many refinement-specific
 * spellings) without enumerating them, and it excludes methionine, whose sulfur
 * is SD and never forms a disulfide. Matching on element S alone would pair
 * methionines.
 */
const CYSTEINE_SULFUR_NAME = 'SG'

export interface Disulfide {
  /** Human-readable residue labels, ordered so the pair is stable. */
  residueA: string
  residueB: string
  chainA: string
  chainB: string
  atomIdA: string
  atomIdB: string
  /** S-S distance in Angstrom. */
  distance: number
  /**
  * True when the two cysteines are in different chains, which means this bond
  * makes the two chains one covalent molecule.
  */
  interChain: boolean
}

export interface DisulfideReport {
  bonds: Disulfide[]
  interChainCount: number
  intraChainCount: number
  /** SG atoms found, whether bonded or not. */
  cysteineSulfurCount: number
  /** SG atoms with no partner in range — reduced, free cysteines. */
  freeCysteineCount: number
  /**
  * SG atoms that had a partner in range but lost it to a closer competitor.
  *
  * Non-zero means the geometry is ambiguous: a sulfur cannot form two
  * disulfides, so overlapping candidates indicate unresolved alternate
  * conformations or a refinement problem, and the reported pairing is the
  * closest-first reading of it rather than the only possible one.
  */
  ambiguousCount: number
  /**
  * Sulfur atoms present that are not named SG. Non-zero with a zero
  * `cysteineSulfurCount` means the file carries no atom names, so disulfides
  * are undetectable rather than absent — a distinction worth surfacing.
  */
  unnamedSulfurCount: number
}

const readAtomName = (atom: ZatomStructureAtom): string => {
  const raw = atom.properties?.[BIO.atomName]
  return typeof raw === 'string' ? raw.trim().toUpperCase() : ''
}

const distanceBetween = (a: readonly number[], b: readonly number[]): number => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Find disulfide bonds.
 *
 * Pairing is *mutual nearest*, not all-pairs-in-range. All-pairs is the obvious
 * implementation and it is wrong in a way that produces impossible chemistry:
 * three SG atoms mutually within 2.5 A — which unresolved alternate conformers
 * genuinely produce — would be reported as three disulfides, giving every
 * sulfur two bonds. Requiring each partner to be the other's nearest candidate
 * yields at most one bond per sulfur, and the atoms that lost a competition are
 * counted in `ambiguousCount` rather than silently dropped.
 */
export const findDisulfides = (
  structure: ZatomStructure,
  index: ResidueIndex = analysisResidueIndex(structure),
): DisulfideReport => {
  // Restrict to primary conformers so a two-conformer cysteine contributes one
  // sulfur, not two.
  const primary = new Set<string>()
  for (const residue of index.residues.values()) {
    for (const id of residue.primaryAtomIds) primary.add(id)
  }

  interface Candidate {
    atomId: string
    residueKey: string
    label: string
    chainId: string
    position: readonly number[]
  }

  const candidates: Candidate[] = []
  let unnamedSulfurCount = 0

  for (const atom of structure.atoms) {
    if (normalizeElementSymbol(atom.element) !== 'S') continue
    const name = readAtomName(atom)
    if (name !== CYSTEINE_SULFUR_NAME) {
      if (name === '') unnamedSulfurCount++
      continue
    }
    if (!primary.has(atom.id)) continue
    const residueKey = index.residueByAtomId.get(atom.id)
    const residue = residueKey ? index.residues.get(residueKey) : undefined
    candidates.push({
      atomId: atom.id,
      residueKey: residueKey ?? `\0${atom.id}`,
      label: residue ? residueLabel(residue) : atom.id,
      chainId: residue?.chainId ?? '',
      position: atom.position,
    })
  }

  // Nearest admissible partner for each sulfur.
  const nearest = new Map<number, { partner: number; distance: number }>()
  let contestedPartners = 0

  for (let i = 0; i < candidates.length; i++) {
    let best: { partner: number; distance: number } | null = null
    let inRange = 0
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue
      // Two SG in the same residue are conformers of one sulfur, not a bond.
      // `primaryAtomIds` already collapses declared alternates, but it
      // short-circuits when the file carries no altLoc codes at all, so a
      // malformed residue with two unlabelled SG reaches this point.
      if (candidates[i].residueKey === candidates[j].residueKey) continue
      const distance = distanceBetween(candidates[i].position, candidates[j].position)
      if (distance < DISULFIDE_MIN_A || distance > DISULFIDE_MAX_A) continue
      inRange++
      if (!best || distance < best.distance) best = { partner: j, distance }
    }
    if (best) nearest.set(i, best)
    if (inRange > 1) contestedPartners++
  }

  const bonds: Disulfide[] = []
  const paired = new Set<number>()
  for (const [i, best] of nearest) {
    const reverse = nearest.get(best.partner)
    if (!reverse || reverse.partner !== i) continue
    if (i > best.partner) continue
    const a = candidates[i]
    const b = candidates[best.partner]
    paired.add(i)
    paired.add(best.partner)
    bonds.push({
      residueA: a.label,
      residueB: b.label,
      chainA: a.chainId,
      chainB: b.chainId,
      atomIdA: a.atomId,
      atomIdB: b.atomId,
      distance: Number(best.distance.toFixed(2)),
      interChain: a.chainId !== b.chainId,
    })
  }

  bonds.sort((x, y) => x.residueA.localeCompare(y.residueA) || x.distance - y.distance)

  const interChainCount = bonds.filter((bond) => bond.interChain).length

  return {
    bonds,
    interChainCount,
    intraChainCount: bonds.length - interChainCount,
    cysteineSulfurCount: candidates.length,
    freeCysteineCount: candidates.length - paired.size,
    ambiguousCount: contestedPartners,
    unnamedSulfurCount,
  }
}

/* ------------------------------------------------------------------ */
/* Metal coordination shells                                           */
/* ------------------------------------------------------------------ */

/**
 * First-shell cutoffs.
 *
 * Transition-metal donor bonds are 1.9-2.4 A; group 1 and 2 ions sit markedly
 * further out (Na-O ~2.4, K-O ~2.8, Ca-O ~2.4-2.6). One cutoff cannot serve
 * both: 2.6 A truncates a potassium shell to nothing, and 3.2 A pulls a second
 * shell of water into every zinc site. The two classes therefore get separate
 * radii, and the value used is reported per site.
 */
export const COORDINATION_CUTOFF_A = 2.6
export const COORDINATION_CUTOFF_IONIC_A = 3.1

/** Angle tolerance, in degrees, for committing to a geometry name. */
const GEOMETRY_TOLERANCE_DEG = 12

export interface CoordinationDonor {
  atomId: string
  element: string
  /** Metal-donor distance in Angstrom. */
  distance: number
  residueLabel: string | null
  entityClass: EntityClass | null
  /** True when this neighbor is itself a metal — a cluster contact, not a donor. */
  isMetal: boolean
}

export interface MetalSite {
  metalAtomId: string
  element: string
  residueLabel: string | null
  /** Donor count, excluding metal-metal contacts. */
  coordinationNumber: number
  donors: CoordinationDonor[]
  /** Mean donor-metal-donor angle in degrees, or null below two donors. */
  meanAngleDeg: number | null
  /**
  * Geometry name, or 'irregular' when the angles do not support one. Never a
  * guess from coordination number alone: CN 4 is tetrahedral or square planar
  * and only the angles distinguish them.
  */
  geometry: string
  /** Metal neighbors within the cutoff — non-zero means a polynuclear cluster. */
  metalNeighborCount: number
  waterDonorCount: number
  polymerDonorCount: number
  /** Cutoff actually applied to this metal. */
  cutoffUsed: number
}

export interface MetalSiteReport {
  sites: MetalSite[]
  metalCount: number
}

/**
 * Mean of all pairwise donor-metal-donor angles.
 *
 * The mean over *all* pairs is what makes the tetrahedral/square-planar split
 * work without needing to identify axes: an ideal tetrahedron gives 109.5 for
 * every one of its six angles, while an ideal square plane gives four 90s and
 * two 180s, whose mean is 120. The two are 10.5 degrees apart in a single
 * scalar, so no axis assignment or best-fit plane is required.
 */
const meanPairwiseAngle = (
  metal: readonly number[],
  donors: readonly { position: readonly number[] }[],
): number | null => {
  if (donors.length < 2) return null
  const unit = donors.map((donor) => {
    const v = [
      donor.position[0] - metal[0],
      donor.position[1] - metal[1],
      donor.position[2] - metal[2],
    ]
    const length = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / length, v[1] / length, v[2] / length]
  })

  let total = 0
  let pairs = 0
  for (let i = 0; i < unit.length; i++) {
    for (let j = i + 1; j < unit.length; j++) {
      const dot = Math.max(
        -1,
        Math.min(1, unit[i][0] * unit[j][0] + unit[i][1] * unit[j][1] + unit[i][2] * unit[j][2]),
      )
      total += (Math.acos(dot) * 180) / Math.PI
      pairs++
    }
  }
  return pairs > 0 ? total / pairs : null
}

/**
 * Nearest ideal geometry within tolerance, or null.
 *
 * Nearest-match rather than first-match, because the candidate windows overlap:
 * tetrahedral (109.5) and square planar (120) are 10.5 degrees apart, which is
 * less than the tolerance a real distorted site needs. Testing them in sequence
 * makes the answer depend on declaration order, so an ideal square plane at
 * exactly 120 returns "tetrahedral" simply because tetrahedral was checked
 * first. Picking the closest target removes the ordering from the result.
 */
const nearestGeometry = (
  meanAngle: number,
  candidates: readonly { name: string; ideal: number }[],
): string | null => {
  let best: { name: string; error: number } | null = null
  for (const candidate of candidates) {
    const error = Math.abs(meanAngle - candidate.ideal)
    if (!best || error < best.error) best = { name: candidate.name, error }
  }
  if (!best || best.error > GEOMETRY_TOLERANCE_DEG) return null
  return best.name
}

/**
 * Name the coordination geometry, or decline to.
 *
 * Every branch requires the angles to agree with the name. Reporting
 * "octahedral" for any six-coordinate site would be the easy version and would
 * mislabel the distorted sites that are usually the interesting ones.
 */
const classifyGeometry = (coordinationNumber: number, meanAngle: number | null): string => {
  if (coordinationNumber === 0) return 'none'
  if (coordinationNumber === 1) return 'monodentate'
  if (meanAngle === null) return 'irregular'
  switch (coordinationNumber) {
    case 2:
      return (
        nearestGeometry(meanAngle, [
          { name: 'linear', ideal: 180 },
          { name: 'bent', ideal: 104 },
        ]) ?? 'bent'
      )
    case 3:
      return (
        nearestGeometry(meanAngle, [
          { name: 'trigonal planar', ideal: 120 },
          { name: 'trigonal pyramidal', ideal: 100 },
        ]) ?? 'irregular'
      )
    case 4:
      return (
        nearestGeometry(meanAngle, [
          { name: 'tetrahedral', ideal: 109.5 },
          { name: 'square planar', ideal: 120 },
        ]) ?? 'irregular'
      )
    case 5:
      // Trigonal bipyramidal and square pyramidal both average near 107, so the
      // mean cannot separate them and the honest answer names neither.
      return nearestGeometry(meanAngle, [{ name: 'five-coordinate', ideal: 107 }]) ?? 'irregular'
    case 6:
      // 12 cis angles at 90 plus 3 trans at 180 average to 108.
      return nearestGeometry(meanAngle, [{ name: 'octahedral', ideal: 108 }]) ?? 'irregular'
    default:
      return `${coordinationNumber}-coordinate`
  }
}

/**
 * Coordination shell of every metal in the scene.
 *
 * One neighbor grid is built at the larger of the two cutoffs and each metal
 * filters it to its own radius, so the ionic and transition cases share a
 * single spatial build instead of forcing two.
 */
export const findMetalSites = (
  structure: ZatomStructure,
  index: ResidueIndex = analysisResidueIndex(structure),
  options: { periodic?: boolean } = {},
): MetalSiteReport => {
  const periodic = options.periodic ?? true
  const grid = analysisNeighborGrid(structure, COORDINATION_CUTOFF_IONIC_A, periodic)

  const labelFor = (atomId: string): { label: string | null; entityClass: EntityClass | null } => {
    const key = index.residueByAtomId.get(atomId)
    const residue = key ? index.residues.get(key) : undefined
    return {
      label: residue ? residueLabel(residue) : null,
      entityClass: residue?.entityClass ?? null,
    }
  }

  const sites: MetalSite[] = []

  for (let i = 0; i < structure.atoms.length; i++) {
    const atom = structure.atoms[i]
    if (!isMetal(atom.element)) continue

    const cutoffUsed = isAlkaliOrAlkalineEarth(atom.element)
      ? COORDINATION_CUTOFF_IONIC_A
      : COORDINATION_CUTOFF_A

    const hits = grid.neighborsOf(atom.position as [number, number, number], undefined, i)

    const donors: CoordinationDonor[] = []
    const donorPositions: { position: readonly number[] }[] = []
    let metalNeighborCount = 0

    for (const hit of hits) {
      if (hit.distance > cutoffUsed) continue
      const neighborIsMetal = isMetal(hit.element)
      if (neighborIsMetal) {
        // A metal-metal contact is a cluster edge, not a donor. Counting it as
        // coordination would inflate CN and corrupt the geometry classification.
        metalNeighborCount++
        continue
      }
      if (!isCommonDonor(hit.element)) continue
      const { label, entityClass } = labelFor(hit.atomId)
      donors.push({
        atomId: hit.atomId,
        element: hit.element,
        distance: Number(hit.distance.toFixed(2)),
        residueLabel: label,
        entityClass,
        isMetal: false,
      })
      donorPositions.push({ position: structure.atoms[hit.atomIndex].position })
    }

    const meanAngle = meanPairwiseAngle(atom.position, donorPositions)
    const { label } = labelFor(atom.id)

    sites.push({
      metalAtomId: atom.id,
      element: normalizeElementSymbol(atom.element),
      residueLabel: label,
      coordinationNumber: donors.length,
      donors,
      meanAngleDeg: meanAngle === null ? null : Number(meanAngle.toFixed(1)),
      geometry: classifyGeometry(donors.length, meanAngle),
      metalNeighborCount,
      waterDonorCount: donors.filter((donor) => donor.entityClass === 'water').length,
      polymerDonorCount: donors.filter((donor) => donor.entityClass === 'polymer').length,
      cutoffUsed,
    })
  }

  return { sites, metalCount: sites.length }
}
