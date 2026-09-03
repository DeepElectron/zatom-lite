/**
 * Burial — how enclosed a residue or a bound entity is.
 *
 * "Which residues line the pocket" (contacts) and "is this residue on the
 * surface" are different questions, and the second one is the one that decides
 * whether a mutation is tolerated, whether a site is druggable, or whether a
 * ligand is solvent-exposed. Neither the projection nor a contact list answers
 * it: a contact list says what is nearby, not how much of the surrounding sphere
 * is occupied.
 *
 * This module uses two proxies, both cheap and both stated as proxies:
 *
 *   - Residue burial: heavy-atom count inside a fixed sphere around the residue's
 *     backbone representative. This is the standard neighbour-count proxy for
 *     relative solvent accessibility; it is monotone with SASA and needs no
 *     surface tessellation.
 *   - Entity enclosure: the fraction of ray directions from an entity's centroid
 *     that are blocked by the structure. This is what distinguishes a buried
 *     cavity from a surface groove, which a lining list cannot.
 *
 * Thresholds are scene-relative (terciles of the scene's own distribution) rather
 * than absolute, so the classification stays meaningful for a small domain and a
 * ribosome alike, and the cut values are reported so a reader can recalibrate.
 *
 * Pure module: structure + index in, classification out.
 */

import type { Vec3, ZatomStructure } from '../../agent/contracts'
import { analysisNeighborGrid } from './scene-analysis'
import { type ResidueEntity, type ResidueIndex, residueLabel } from './residue-index'

/** Burial class for a residue, from the neighbour-count proxy. */
export type BurialClass = 'buried' | 'intermediate' | 'exposed'

/** Sphere radius for the neighbour-count proxy, in Angstrom. */
export const BURIAL_PROBE_A = 8

export interface ResidueBurial {
  residueKey: string
  label: string
  /** Heavy atoms from other residues within the probe sphere. */
  neighborCount: number
  burial: BurialClass
}

export interface BurialResult {
  byResidueKey: Map<string, ResidueBurial>
  /** Tercile cuts actually used, so the classes are reproducible. */
  exposedBelow: number
  buriedAbove: number
  /**
  * False when the two tercile cuts collapsed onto one value, meaning the scene
  * had too little spread to separate three classes. The classification is then
  * deliberately uninformative rather than confidently wrong, and a reader should
  * treat 'intermediate' as "not determined" instead of "middling".
  */
  separated: boolean
  counts: Record<BurialClass, number>
  probeRadius: number
}

/** Hydrogens are excluded: they are absent from most crystal structures. */
const isHeavy = (element: string): boolean => element !== 'H' && element !== 'D'

/**
 * Burial for every polymer residue with a backbone representative.
 *
 * Residues without a trace atom are skipped rather than given a centroid-based
 * count, because the two measures are not comparable and mixing them would put
 * some residues on a different scale than the terciles were computed from.
 */
export const computeResidueBurial = (
  structure: ZatomStructure,
  index: ResidueIndex,
  probeRadius = BURIAL_PROBE_A,
): BurialResult => {
  const grid = analysisNeighborGrid(structure, probeRadius)
  const atomIndexById = new Map<string, number>()
  for (let i = 0; i < structure.atoms.length; i++) atomIndexById.set(structure.atoms[i].id, i)

  const raw: { residue: ResidueEntity; count: number }[] = []
  for (const residue of index.residues.values()) {
    if (residue.entityClass !== 'polymer' || residue.tracePosition === null) continue
    const own = new Set<number>()
    for (const atomId of residue.atomIds) {
      const idx = atomIndexById.get(atomId)
      if (idx !== undefined) own.add(idx)
    }
    const position: Vec3 = [
      residue.tracePosition[0],
      residue.tracePosition[1],
      residue.tracePosition[2],
    ]
    let count = 0
    for (const hit of grid.neighborsOf(position, own)) {
      if (isHeavy(hit.element)) count++
    }
    raw.push({ residue, count })
  }

  const counts: Record<BurialClass, number> = { buried: 0, intermediate: 0, exposed: 0 }
  const byResidueKey = new Map<string, ResidueBurial>()
  if (raw.length === 0) {
    return {
      byResidueKey,
      exposedBelow: 0,
      buriedAbove: 0,
      separated: false,
      counts,
      probeRadius,
    }
  }

  const sorted = raw.map((r) => r.count).sort((a, b) => a - b)
  const quantile = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const exposedBelow = quantile(1 / 3)
  const buriedAbove = quantile(2 / 3)

  /**
  * Terciles only separate three classes when the two cuts differ.
  *
  * On a low-diversity distribution they collapse onto the same value, and the
  * classification below then inverts rather than merely blurring: `>=
  * buriedAbove` is evaluated first, so with both cuts at 0 the test `count >= 0`
  * is true for every residue and a scene of fully solvent-exposed residues —
  * zero heavy neighbours within 8 A — reports as 100% buried. That is the
  * opposite of the truth, and it is silent, because a healthy spread like
  * [0,2,5,9,14,30] classifies correctly and hides the edge case.
  *
  * Collapse is realistic, not hypothetical: a short peptide, a scene of isolated
  * ligands, or any uniformly-packed selection produces it.
  */
  const separated = buriedAbove > exposedBelow

  for (const { residue, count } of raw) {
    let burial: BurialClass
    if (separated) {
      burial = count >= buriedAbove ? 'buried' : count <= exposedBelow ? 'exposed' : 'intermediate'
    } else if (count === 0) {
      // No neighbour inside the probe sphere is an absolute statement, not a
      // relative one: nothing is nearby, so 'buried' is physically impossible
      // regardless of what the rest of the scene looks like.
      burial = 'exposed'
    } else {
      // The scene genuinely offers no burial contrast. Saying so is more useful
      // than picking a class the distribution does not support.
      burial = 'intermediate'
    }
    counts[burial]++
    byResidueKey.set(residue.key, {
      residueKey: residue.key,
      label: residueLabel(residue),
      neighborCount: count,
      burial,
    })
  }

  return { byResidueKey, exposedBelow, buriedAbove, separated, counts, probeRadius }
}

/* ------------------------------------------------------------------ */
/* Entity enclosure                                                    */
/* ------------------------------------------------------------------ */

export interface EnclosureReport {
  /** Fraction of probe directions blocked by the structure, 0..1. */
  enclosure: number
  /** 'buried cavity' | 'groove' | 'surface' reading of that fraction. */
  site: 'buried' | 'groove' | 'surface'
  /**
  * Unit direction with the clearest escape route — the pocket mouth. Null when
  * the entity is fully enclosed and no direction escapes.
  */
  openingDirection: Vec3 | null
  /**
  * Distance from the centroid to the first unobstructed point along the opening
  * direction, in Angstrom. This is the depth of the site below the surface.
  */
  depthA: number | null
}

/** Ray length, in Angstrom. Beyond this a direction counts as open. */
const RAY_LENGTH_A = 12

/** Step along a ray, in Angstrom. */
const RAY_STEP_A = 1.5

/** Clearance radius that counts as unobstructed, in Angstrom (~a water probe). */
const RAY_CLEARANCE_A = 2.6

/**
 * Fibonacci-sphere directions — an even, deterministic, rotation-agnostic sample.
 * 42 directions resolve a pocket mouth to about 25 degrees, which is finer than
 * the distinction being made ("does it open, and roughly where").
 */
const probeDirections = (count = 42): Vec3[] => {
  const directions: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * i) / (count - 1)
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    directions.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius])
  }
  return directions
}

const DIRECTIONS = probeDirections()

/**
 * Enclosure of one entity (ligand, metal, cavity centre).
 *
 * A ray is "blocked" when some step along it comes within the clearance radius
 * of a non-entity atom. Rays are cast from the entity centroid, which is the
 * right origin for a compact ligand and the reason this is reported for entities
 * rather than for arbitrary atoms.
 */
export const computeEnclosure = (
  structure: ZatomStructure,
  entityAtomIds: ReadonlySet<string>,
): EnclosureReport => {
  const centroid: Vec3 = [0, 0, 0]
  let n = 0
  for (const atom of structure.atoms) {
    if (!entityAtomIds.has(atom.id)) continue
    centroid[0] += atom.position[0]
    centroid[1] += atom.position[1]
    centroid[2] += atom.position[2]
    n++
  }
  if (n === 0) {
    return { enclosure: 0, site: 'surface', openingDirection: null, depthA: null }
  }
  centroid[0] /= n
  centroid[1] /= n
  centroid[2] /= n

  const grid = analysisNeighborGrid(structure, RAY_CLEARANCE_A)
  const blockedByEntity = new Set<number>()
  for (let i = 0; i < structure.atoms.length; i++) {
    if (entityAtomIds.has(structure.atoms[i].id)) blockedByEntity.add(i)
  }

  let blocked = 0
  let bestDirection: Vec3 | null = null
  let bestFreeDistance = -1

  for (const direction of DIRECTIONS) {
    let firstObstruction = Infinity
    for (let t = RAY_CLEARANCE_A; t <= RAY_LENGTH_A; t += RAY_STEP_A) {
      const point: Vec3 = [
        centroid[0] + direction[0] * t,
        centroid[1] + direction[1] * t,
        centroid[2] + direction[2] * t,
      ]
      if (grid.neighborsOf(point, blockedByEntity).length > 0) {
        firstObstruction = t
        break
      }
    }
    if (firstObstruction <= RAY_LENGTH_A) {
      blocked++
      continue
    }
    // Open direction: prefer the one that clears earliest, i.e. the shallowest
    // escape, because that is the mouth a solvent molecule would use.
    let clearance = RAY_CLEARANCE_A
    for (let t = RAY_CLEARANCE_A; t <= RAY_LENGTH_A; t += RAY_STEP_A) {
      const point: Vec3 = [
        centroid[0] + direction[0] * t,
        centroid[1] + direction[1] * t,
        centroid[2] + direction[2] * t,
      ]
      if (grid.neighborsOf(point, blockedByEntity).length === 0) {
        clearance = t
        break
      }
    }
    if (bestFreeDistance < 0 || clearance < bestFreeDistance) {
      bestFreeDistance = clearance
      bestDirection = direction
    }
  }

  const enclosure = blocked / DIRECTIONS.length
  const site: EnclosureReport['site'] =
    enclosure >= 0.9 ? 'buried' : enclosure >= 0.65 ? 'groove' : 'surface'

  return {
    enclosure,
    site,
    openingDirection: bestDirection,
    depthA: bestDirection ? Number(bestFreeDistance.toFixed(1)) : null,
  }
}
