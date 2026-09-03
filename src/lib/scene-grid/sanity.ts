/**
 * Chemical sanity of a structure after an edit, in radius-relative terms.
 *
 * validateStructure catches gross overlaps with absolute thresholds; this
 * layer asks the questions a modeler asks after moving an adsorbate:
 *   - does anything overlap (d < 0.6 × Σ covalent radii)?
 *   - are unbonded atoms too close (d < 0.8 × Σ radii)?
 *   - how far is each adsorbate from the surface it sits on?
 *   - did a molecule end up straddling the vacuum gap (half of it wrapped
 *     to the other face of the slab)?
 * Every finding carries atom ids and an inspection target so the agent can
 * fly the camera to it.
 */

import type { InspectionTarget, ValidationCheck, Vec3, ZatomStructure } from '../../agent/contracts'
import { cartesianToFractional, createDistanceCalculator } from '../../agent/structure-math'
import { getMaxBondDistance } from '../crystal/bonds'
import { detectFragments, detectVacuum, type SystemFragment } from './system-semantics'

export interface SanityOptions {
  /** Atoms to scan against the rest. Defaults to adsorbate fragments, else every atom. */
  focusAtomIds?: string[]
  /** Fraction of Σ covalent radii below which a pair is an overlap. Default 0.6. */
  overlapRatio?: number
  /** Fraction of Σ covalent radii below which an UNBONDED pair is too close. Default 0.8. */
  tooCloseRatio?: number
  /** Cap on focus × other pairs scanned. Default 2,000,000. */
  maxPairs?: number
}

export interface AdsorbateContact {
  fragmentId: string
  formula: string
  atomIds: string[]
  /** Closest adsorbate atom / host atom pair and its distance. */
  nearest: { adsorbateAtomId: string; hostAtomId: string; distanceA: number } | null
}

export interface SanityReport {
  status: 'pass' | 'warn' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  adsorbateContacts: AdsorbateContact[]
  /** True only when every unique focus-to-structure pair was inspected. */
  complete: boolean
  scannedPairs: number
  maxPairs: number
  /** True when at least one eligible pair remained after maxPairs was reached. */
  budgetExhausted: boolean
}

const sumRadii = (a: string, b: string) => getMaxBondDistance(a, b, 0)

const round = (x: number) => Number(x.toFixed(3))

function centroidOf(structure: ZatomStructure, ids: readonly string[]): { center: Vec3; radius: number } {
  const byId = new Map(structure.atoms.map((atom) => [atom.id, atom]))
  const pts = ids.map((id) => byId.get(id)?.position).filter((p): p is Vec3 => !!p)
  if (!pts.length) return { center: [0, 0, 0], radius: 1 }
  const center: Vec3 = [0, 0, 0]
  for (const p of pts) {
    center[0] += p[0] / pts.length
    center[1] += p[1] / pts.length
    center[2] += p[2] / pts.length
  }
  const radius = Math.max(1.5, ...pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])) ) + 2
  return { center, radius }
}

export function checkStructureSanity(structure: ZatomStructure, options: SanityOptions = {}): SanityReport {
  const overlapRatio = options.overlapRatio ?? 0.6
  const tooCloseRatio = options.tooCloseRatio ?? 0.8
  const maxPairs = options.maxPairs ?? 2_000_000
  const distance = createDistanceCalculator(structure.lattice)
  const atoms = structure.atoms
  const indexById = new Map(atoms.map((atom, i) => [atom.id, i]))

  const fragments = detectFragments(structure)
  const adsorbates = fragments.filter((f) => !f.isPeriodicNetwork)
  const hostIds = new Set(fragments.filter((f) => f.isPeriodicNetwork).flatMap((f) => f.atomIds))

  const focusIds = options.focusAtomIds?.length
    ? options.focusAtomIds
    : adsorbates.length && hostIds.size
      ? adsorbates.flatMap((f) => f.atomIds)
      : atoms.map((a) => a.id)
  const focus = focusIds.map((id) => indexById.get(id)).filter((i): i is number => i !== undefined)

  const bonded = new Set<string>()
  for (const bond of structure.bonds ?? []) {
    const [a, b] = bond.atomIds
    bonded.add(a < b ? `${a}|${b}` : `${b}|${a}`)
  }
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

  const checks: ValidationCheck[] = []
  const targets: InspectionTarget[] = []
  const overlaps: Array<{ a: string; b: string; d: number; ratio: number }> = []
  const tooClose: Array<{ a: string; b: string; d: number; ratio: number }> = []
  let scanned = 0
  let budgetExhausted = false
  const seen = new Set<string>()

  outer: for (const i of focus) {
    const ai = atoms[i]
    for (let j = 0; j < atoms.length; j++) {
      if (j === i) continue
      const aj = atoms[j]
      const key = pairKey(ai.id, aj.id)
      if (seen.has(key)) continue
      if (scanned >= maxPairs) {
        budgetExhausted = true
        break outer
      }
      seen.add(key)
      scanned++
      const d = distance(ai.position, aj.position)
      const sum = sumRadii(ai.element, aj.element)
      if (sum <= 0) continue
      const ratio = d / sum
      if (ratio < overlapRatio) overlaps.push({ a: ai.id, b: aj.id, d, ratio })
      else if (ratio < tooCloseRatio && !bonded.has(key)) tooClose.push({ a: ai.id, b: aj.id, d, ratio })
    }
  }

  overlaps.sort((x, y) => x.ratio - y.ratio)
  tooClose.sort((x, y) => x.ratio - y.ratio)
  const complete = !budgetExhausted

  checks.push({
    id: 'sanity.pair_scan_coverage',
    status: complete ? 'pass' : 'warn',
    message: complete
      ? `Pair scan complete: ${scanned} unique pair(s) inspected`
      : `Pair scan budget exhausted after ${scanned} pair(s); overlap and close-contact results are incomplete`,
    metrics: { complete, scannedPairs: scanned, maxPairs, budgetExhausted },
  })

  if (overlaps.length) {
    const worst = overlaps[0]
    const ids = [...new Set(overlaps.flatMap((p) => [p.a, p.b]))]
    checks.push({
      id: 'sanity.overlap',
      status: 'fail',
      message: `${overlaps.length} overlapping pair(s); worst ${worst.a}–${worst.b} at ${round(worst.d)} Å (${round(worst.ratio)} × Σr)`,
      metrics: { pairCount: overlaps.length, worstDistanceA: round(worst.d), worstRatio: round(worst.ratio), threshold: overlapRatio },
      atomIds: ids.slice(0, 50),
    })
    const { center, radius } = centroidOf(structure, [worst.a, worst.b])
    targets.push({ id: 'sanity.overlap', reason: `overlap ${worst.a}–${worst.b}`, center, radius, atomIds: [worst.a, worst.b] })
  } else {
    checks.push({
      id: 'sanity.overlap',
      status: complete ? 'pass' : 'warn',
      message: complete
        ? 'No overlapping atom pairs'
        : `No overlapping pairs found in the ${scanned} scanned pair(s); unscanned pairs remain`,
      metrics: { threshold: overlapRatio, complete },
    })
  }

  if (tooClose.length) {
    const worst = tooClose[0]
    const ids = [...new Set(tooClose.flatMap((p) => [p.a, p.b]))]
    checks.push({
      id: 'sanity.too_close',
      status: 'warn',
      message: `${tooClose.length} unbonded pair(s) closer than ${tooCloseRatio} × Σr; worst ${worst.a}–${worst.b} at ${round(worst.d)} Å`,
      metrics: { pairCount: tooClose.length, worstDistanceA: round(worst.d), worstRatio: round(worst.ratio), threshold: tooCloseRatio },
      atomIds: ids.slice(0, 50),
    })
    const { center, radius } = centroidOf(structure, [worst.a, worst.b])
    targets.push({ id: 'sanity.too_close', reason: `close contact ${worst.a}–${worst.b}`, center, radius, atomIds: [worst.a, worst.b] })
  } else {
    checks.push({
      id: 'sanity.too_close',
      status: complete ? 'pass' : 'warn',
      message: complete
        ? 'No unbonded close contacts'
        : `No unbonded close contacts found in the ${scanned} scanned pair(s); unscanned pairs remain`,
      metrics: { threshold: tooCloseRatio, complete },
    })
  }

  // Adsorbate → host contact distance.
  const adsorbateContacts: AdsorbateContact[] = []
  if (hostIds.size) {
    const hostAtoms = atoms.filter((a) => hostIds.has(a.id))
    for (const frag of adsorbates) {
      let nearest: AdsorbateContact['nearest'] = null
      for (const id of frag.atomIds) {
        const atom = atoms[indexById.get(id)!]
        for (const host of hostAtoms) {
          const d = distance(atom.position, host.position)
          if (!nearest || d < nearest.distanceA) nearest = { adsorbateAtomId: id, hostAtomId: host.id, distanceA: d }
        }
      }
      if (nearest) nearest.distanceA = round(nearest.distanceA)
      adsorbateContacts.push({ fragmentId: frag.id, formula: frag.formula, atomIds: frag.atomIds, nearest })
    }
    const floating = adsorbateContacts.filter((c) => c.nearest && c.nearest.distanceA > 4)
    checks.push({
      id: 'sanity.adsorbate_contact',
      status: floating.length ? 'warn' : 'pass',
      message: adsorbateContacts.length
        ? floating.length
          ? `${floating.length} adsorbate(s) more than 4 Å from the surface: ${floating.map((c) => `${c.formula} (${c.nearest!.distanceA} Å)`).join(', ')}`
          : `${adsorbateContacts.length} adsorbate(s) in contact with the surface: ${adsorbateContacts.map((c) => `${c.formula} ${c.nearest?.distanceA ?? '?'} Å`).join(', ')}`
        : 'No adsorbates',
      metrics: { adsorbateCount: adsorbateContacts.length, floatingCount: floating.length },
      ...(floating.length ? { atomIds: floating.flatMap((c) => c.atomIds).slice(0, 50) } : {}),
    })
  }

  // Vacuum crossing: an adsorbate whose centroid sits inside the vacuum gap
  // has wrapped through the cell and now lives on the wrong face.
  const vacuum = structure.lattice ? detectVacuum(structure) : []
  if (vacuum.length && adsorbates.length) {
    const lattice = structure.lattice!
    const crossing: SystemFragment[] = []
    for (const frag of adsorbates) {
      const frac = cartesianToFractional(frag.centroid, lattice.vectors)
      if (!frac) continue
      for (const axis of vacuum) {
        const v = lattice.vectors[axis.axis]
        const len = Math.hypot(v[0], v[1], v[2])
        let df = ((frac[axis.axis] - axis.gapCenterFrac) % 1 + 1) % 1
        if (df > 0.5) df -= 1
        const distToGapCenterA = Math.abs(df) * len
        // Inside the gap = within half the gap of its centre (minus a margin so
        // a molecule sitting right at the slab face is not flagged).
        if (distToGapCenterA < axis.gapA / 2 - 1.5) {
          crossing.push(frag)
          break
        }
      }
    }
    checks.push({
      id: 'sanity.vacuum_crossing',
      status: crossing.length ? 'fail' : 'pass',
      message: crossing.length
        ? `${crossing.length} adsorbate(s) sit inside the vacuum gap (wrapped through the cell): ${crossing.map((f) => f.formula).join(', ')}`
        : 'No adsorbate inside the vacuum gap',
      metrics: { crossingCount: crossing.length },
      ...(crossing.length ? { atomIds: crossing.flatMap((f) => f.atomIds).slice(0, 50) } : {}),
    })
    for (const frag of crossing) {
      const { center, radius } = centroidOf(structure, frag.atomIds)
      targets.push({ id: `sanity.vacuum_crossing.${frag.id}`, reason: `${frag.formula} in vacuum gap`, center, radius, atomIds: frag.atomIds })
    }
  }

  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass'
  return {
    status,
    checks,
    inspectionTargets: targets,
    adsorbateContacts,
    complete,
    scannedPairs: scanned,
    maxPairs,
    budgetExhausted,
  }
}
