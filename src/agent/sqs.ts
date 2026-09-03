/**
 * Deterministic, browser-safe SQS search.
 *
 * This engine keeps exact integer compositions and swaps occupations on one or
 * more declared sublattices.  Its objective compares pair distributions over
 * the first geometric neighbor shells with the finite-cell random target. An
 * explicitly bounded triangle/tetrahedron objectives can additionally match
 * triplet and quadruplet distributions. It is intentionally solver-independent;
 * ATAT/icet adapters can implement the same public result contract for larger
 * and systematically converged cluster spaces.
 */

import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  cartesianToFractional,
  compareCanonicalText,
  createDistanceCalculator,
  createFnv1a64Hasher,
  distance,
  fingerprintStructure,
  fractionalToCartesian,
  scaleLattice,
  wrapFractional,
} from './structure-math'
import { validateStructure } from './structure-validation'

export interface SqsSublatticeSpec {
  id?: string
  /** Optional parent-site element selector. */
  siteElements?: string[]
  /** Optional parent-cell atom-ID selector; replicated copies inherit it. */
  siteAtomIds?: string[]
  /** Desired species fractions; values must sum to one. */
  composition: Record<string, number>
}

export interface GenerateSqsOptions {
  structure: ZatomStructure
  sublattices: SqsSublatticeSpec[]
  supercell?: [number, number, number]
  shellCount?: number
  shellToleranceA?: number
  /** Maximum side length for symmetry-canonical triangle clusters; omitted disables triplets. */
  tripletCutoffA?: number
  /** Relative weight of the triplet objective against the pair objective. */
  tripletWeight?: number
  /** Hard cap on enumerated triangle figures. */
  maxTripletFigures?: number
  /** Hard cap on mutable sites when triplets are enabled. */
  maxTripletSearchSites?: number
  /** Maximum pair distance for four-site clusters; omitted disables quadruplets. */
  quadrupletCutoffA?: number
  /** Relative weight of the quadruplet objective against the pair objective. */
  quadrupletWeight?: number
  /** Hard cap on enumerated four-site figures. */
  maxQuadrupletFigures?: number
  /** Hard cap on candidate four-site combinations inspected. */
  maxQuadrupletCandidates?: number
  /** Hard cap on mutable sites when quadruplets are enabled. */
  maxQuadrupletSearchSites?: number
  seed?: number
  /** Number of independently seeded anneals to rank; seed 0 is the requested seed. */
  ensembleSize?: number
  restarts?: number
  stepsPerRestart?: number
  /** Hard cap on proposed/evaluated occupation states across the full ensemble. */
  maxSearchEvaluations?: number
  /** Hard cap on objective figure visits (projected evaluations × pair/triplet/quadruplet figures). */
  maxObjectiveTermEvaluations?: number
  maxOutputAtoms?: number
  maxSearchSites?: number
}

export interface SqsCompositionReport {
  sublattice: string
  siteCount: number
  requestedFractions: Record<string, number>
  actualFractions: Record<string, number>
  counts: Record<string, number>
  maxFractionError: number
}

export interface WarrenCowleyEntry {
  centerElement: string
  neighborElement: string
  probability: number
  randomProbability: number
  alpha: number
}

export interface SqsPairShellReport {
  sublattices: [string, string]
  shell: number
  distanceA: number
  pairCount: number
  targetPairFractions: Record<string, number>
  actualPairFractions: Record<string, number>
  maxAbsPairError: number
  warrenCowley: WarrenCowleyEntry[]
}

export interface SqsTripletClusterReport {
  sublattices: [string, string, string]
  sideLengthsA: [number, number, number]
  tripletCount: number
  targetTripletFractions: Record<string, number>
  actualTripletFractions: Record<string, number>
  maxAbsTripletError: number
}

export interface SqsQuadrupletClusterReport {
  sublattices: [string, string, string, string]
  edgeLengthsA: [number, number, number, number, number, number]
  quadrupletCount: number
  targetQuadrupletFractions: Record<string, number>
  actualQuadrupletFractions: Record<string, number>
  maxAbsQuadrupletError: number
}

export interface SqsQualityReport {
  verdict: 'near-ideal' | 'acceptable' | 'poor' | 'unassessed'
  objective: number
  pairObjective: number | null
  tripletObjective: number | null
  quadrupletObjective: number | null
  maxAbsPairError: number | null
  maxAbsTripletError: number | null
  maxAbsQuadrupletError: number | null
  maxAbsWarrenCowley: number | null
  compositions: SqsCompositionReport[]
  pairShells: SqsPairShellReport[]
  tripletClusters: SqsTripletClusterReport[]
  quadrupletClusters: SqsQuadrupletClusterReport[]
}

export interface SqsSearchReport {
  algorithm: 'zatom-pair-anneal' | 'zatom-pair-triplet-anneal' | 'zatom-pair-quadruplet-anneal' | 'zatom-pair-triplet-quadruplet-anneal'
  seed: number
  selectedSeed: number
  ensembleSize: number
  restarts: number
  stepsPerRestart: number
  evaluations: number
  acceptedMoves: number
  initialObjective: number
  finalObjective: number
  mutableSiteCount: number
  clusterCount: number
  pairClusterCount: number
  tripletClusterCount: number
  quadrupletClusterCount: number
  tripletFigureCount: number
  quadrupletFigureCount: number
  quadrupletCandidateCount: number
  pairFigureCount: number
  projectedEvaluationBudget: number
  projectedObjectiveTermEvaluations: number
  ensemble: SqsEnsembleReport
}

export interface SqsEnsembleCandidateReport {
  rank: number
  seed: number
  occupationFingerprint: string
  verdict: SqsQualityReport['verdict']
  initialObjective: number
  finalObjective: number
  pairObjective: number | null
  tripletObjective: number | null
  quadrupletObjective: number | null
  maxAbsPairError: number | null
  maxAbsTripletError: number | null
  maxAbsQuadrupletError: number | null
  maxAbsWarrenCowley: number | null
  evaluations: number
  acceptedMoves: number
}

export interface SqsEnsembleReport {
  requestedSize: number
  completedSize: number
  selectedSeed: number
  uniqueOccupationCount: number
  bestObjective: number
  medianObjective: number
  worstObjective: number
  objectiveSpread: number
  candidates: SqsEnsembleCandidateReport[]
}

export interface GenerateSqsResult {
  structure: ZatomStructure
  quality: SqsQualityReport
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  search: SqsSearchReport
  inspectionTargets: InspectionTarget[]
}

interface NormalizedSublattice {
  id: string
  siteElements: Set<string>
  siteAtomIds: Set<string>
  composition: Record<string, number>
  species: string[]
  sites: number[]
  counts: Record<string, number>
}

interface PairRecord {
  i: number
  j: number
  distanceA: number
}

interface PairCluster {
  subA: number
  subB: number
  shell: number
  distanceA: number
  edges: Array<[number, number]>
  target: Record<string, number>
  weight: number
}

type Permutation3 = readonly [number, number, number]
type Permutation4 = readonly [number, number, number, number]

interface TripletFigure {
  sites: [number, number, number]
  canonicalOrders: Permutation3[]
}

interface TripletCluster {
  sublattices: [number, number, number]
  sideLengthsA: [number, number, number]
  figures: TripletFigure[]
  target: Record<string, number>
  weight: number
}

interface QuadrupletFigure {
  sites: [number, number, number, number]
  canonicalOrders: Permutation4[]
}

interface QuadrupletCluster {
  sublattices: [number, number, number, number]
  edgeLengthsA: [number, number, number, number, number, number]
  figures: QuadrupletFigure[]
  target: Record<string, number>
  weight: number
}

interface CanonicalTriangle {
  key: string
  sublattices: [number, number, number]
  sideLengthsA: [number, number, number]
  canonicalOrders: Permutation3[]
}

interface CanonicalQuadruplet {
  key: string
  sublattices: [number, number, number, number]
  edgeLengthsA: [number, number, number, number, number, number]
  canonicalOrders: Permutation4[]
}

interface SqsOptimizationRun {
  seed: number
  labels: string[]
  initialObjective: number
  finalObjective: number
  evaluations: number
  acceptedMoves: number
  pairObjective: number | null
  tripletObjective: number | null
  quadrupletObjective: number | null
  quality: SqsQualityReport
  occupationFingerprint: string
}

const TRIANGLE_PERMUTATIONS: readonly Permutation3[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

const QUADRUPLET_PERMUTATIONS: readonly Permutation4[] = (() => {
  const result: Permutation4[] = []
  for (let first = 0; first < 4; first++) for (let second = 0; second < 4; second++) {
    if (second === first) continue
    for (let third = 0; third < 4; third++) {
      if (third === first || third === second) continue
      for (let fourth = 0; fourth < 4; fourth++) {
        if (fourth === first || fourth === second || fourth === third) continue
        result.push([first, second, third, fourth])
      }
    }
  }
  return result
})()

export class SqsInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SqsInputError'
    this.code = code
  }
}

function canonicalElement(value: string): string {
  const text = value.trim()
  return text ? text[0].toUpperCase() + text.slice(1).toLowerCase() : ''
}

function normalizeScaling(value: readonly number[] | undefined): [number, number, number] {
  const scaling = value ?? [1, 1, 1]
  if (scaling.length !== 3 || scaling.some((v) => !Number.isInteger(v) || v < 1 || v > 64)) {
    throw new SqsInputError('invalid_supercell', 'supercell must contain three integers in [1, 64]')
  }
  return [scaling[0], scaling[1], scaling[2]]
}

function allocateCounts(total: number, fractions: Record<string, number>): Record<string, number> {
  const species = Object.keys(fractions).sort()
  const counts: Record<string, number> = {}
  const ranked: Array<{ species: string; remainder: number }> = []
  let used = 0
  for (const symbol of species) {
    const raw = total * fractions[symbol]
    const floor = Math.floor(raw)
    counts[symbol] = floor
    used += floor
    ranked.push({ species: symbol, remainder: raw - floor })
  }
  ranked.sort((a, b) => b.remainder - a.remainder || compareCanonicalText(a.species, b.species))
  for (let i = 0; i < total - used; i++) counts[ranked[i % ranked.length].species] += 1
  return counts
}

function normalizeSublattices(specs: SqsSublatticeSpec[]): NormalizedSublattice[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new SqsInputError('missing_sublattices', 'At least one SQS sublattice is required')
  }
  const ids = new Set<string>()
  return specs.map((spec, index) => {
    const id = (spec.id?.trim() || `sublattice-${index + 1}`)
    if (ids.has(id)) throw new SqsInputError('duplicate_sublattice_id', `Duplicate sublattice id "${id}"`)
    ids.add(id)
    const siteElements = new Set((spec.siteElements ?? []).map(canonicalElement).filter(Boolean))
    const siteAtomIds = new Set((spec.siteAtomIds ?? []).map((value) => value.trim()).filter(Boolean))
    if (!siteElements.size && !siteAtomIds.size) {
      throw new SqsInputError('empty_site_selector', `${id} requires siteElements, siteAtomIds, or both`)
    }
    for (const symbol of siteElements) {
      if (symbolToAtomicNumber(symbol) <= 0) throw new SqsInputError('unknown_element', `${id} selects unknown element "${symbol}"`)
    }
    const composition: Record<string, number> = {}
    let sum = 0
    for (const [rawSymbol, rawFraction] of Object.entries(spec.composition ?? {})) {
      const symbol = canonicalElement(rawSymbol)
      const fraction = Number(rawFraction)
      if (symbolToAtomicNumber(symbol) <= 0) throw new SqsInputError('unknown_element', `${id} composition uses unknown element "${rawSymbol}"`)
      if (!Number.isFinite(fraction) || fraction < 0) throw new SqsInputError('invalid_fraction', `${id}.${symbol} fraction must be finite and non-negative`)
      if (fraction > 0) composition[symbol] = (composition[symbol] ?? 0) + fraction
      sum += fraction
    }
    if (Object.keys(composition).length < 2) {
      throw new SqsInputError('not_disordered', `${id} needs at least two species with non-zero fractions`)
    }
    if (Math.abs(sum - 1) > 1e-6) throw new SqsInputError('fraction_sum', `${id} composition fractions must sum to one (got ${sum})`)
    return {
      id,
      siteElements,
      siteAtomIds,
      composition,
      species: Object.keys(composition).sort(),
      sites: [],
      counts: {},
    }
  })
}

function replicateStructure(
  source: ZatomStructure,
  scaling: [number, number, number],
): { structure: ZatomStructure; sourceElements: string[]; sourceAtomIds: string[] } {
  if (!source.lattice || !source.lattice.periodic.some(Boolean)) {
    throw new SqsInputError('periodic_lattice_required', 'SQS generation requires a periodic lattice')
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!source.lattice.periodic[axis] && scaling[axis] !== 1) {
      throw new SqsInputError('invalid_nonperiodic_scaling', `supercell axis ${axis} is non-periodic and must remain 1`)
    }
  }
  const product = scaling[0] * scaling[1] * scaling[2]
  const atoms = [] as ZatomStructure['atoms']
  const sourceElements: string[] = []
  const sourceAtomIds: string[] = []
  for (let ia = 0; ia < scaling[0]; ia++) {
    for (let ib = 0; ib < scaling[1]; ib++) {
      for (let ic = 0; ic < scaling[2]; ic++) {
        const shift = fractionalToCartesian([ia, ib, ic], source.lattice.vectors)
        for (const atom of source.atoms) {
          const frac = cartesianToFractional(atom.position, source.lattice.vectors)
          if (!frac) throw new SqsInputError('singular_lattice', 'Cannot invert the source lattice')
          const wrapped = wrapFractional(frac, source.lattice.periodic)
          const base = fractionalToCartesian(wrapped, source.lattice.vectors)
          const id = product === 1 ? atom.id : `${atom.id}@${ia},${ib},${ic}`
          atoms.push({
            ...atom,
            id,
            position: [base[0] + shift[0], base[1] + shift[1], base[2] + shift[2]],
          })
          sourceElements.push(canonicalElement(atom.element))
          sourceAtomIds.push(atom.id)
        }
      }
    }
  }
  const bonds = source.bonds?.flatMap((bond) => {
    const copies = [] as NonNullable<ZatomStructure['bonds']>
    for (let ia = 0; ia < scaling[0]; ia++) for (let ib = 0; ib < scaling[1]; ib++) for (let ic = 0; ic < scaling[2]; ic++) {
      const suffix = product === 1 ? '' : `@${ia},${ib},${ic}`
      copies.push({
        ...bond,
        id: `${bond.id}${suffix}`,
        atomIds: [`${bond.atomIds[0]}${suffix}`, `${bond.atomIds[1]}${suffix}`],
        ...(bond.properties ? { properties: { ...bond.properties } } : {}),
      })
    }
    return copies
  })
  return {
    structure: {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms,
      ...(bonds ? { bonds } : {}),
      lattice: scaleLattice(source.lattice, scaling),
      label: `${source.label ?? 'structure'} SQS ${scaling.join('×')}`,
      metadata: { ...(source.metadata ?? {}), sqsSupercell: scaling as unknown as JsonValue },
    },
    sourceElements,
    sourceAtomIds,
  }
}

function pairKey(a: string, b: string, oriented: boolean): string {
  if (oriented) return `${a}>${b}`
  return a <= b ? `${a}|${b}` : `${b}|${a}`
}

function targetPairFractions(a: NormalizedSublattice, b: NormalizedSublattice): Record<string, number> {
  const out: Record<string, number> = {}
  if (a === b) {
    const n = a.sites.length
    const denom = n * Math.max(1, n - 1)
    for (let i = 0; i < a.species.length; i++) {
      for (let j = i; j < a.species.length; j++) {
        const si = a.species[i], sj = a.species[j]
        out[pairKey(si, sj, false)] = si === sj
          ? (a.counts[si] * Math.max(0, a.counts[si] - 1)) / denom
          : (2 * a.counts[si] * a.counts[sj]) / denom
      }
    }
    return out
  }
  for (const sa of a.species) for (const sb of b.species) {
    out[pairKey(sa, sb, true)] = (a.counts[sa] / a.sites.length) * (b.counts[sb] / b.sites.length)
  }
  return out
}

function buildPairClusters(
  structure: ZatomStructure,
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
  shellCount: number,
  toleranceA: number,
): PairCluster[] {
  const mutable = sublattices.flatMap((sub) => sub.sites)
  const distanceBetween = createDistanceCalculator(structure.lattice)
  const grouped = new Map<string, { subA: number; subB: number; pairs: PairRecord[] }>()
  for (let ii = 0; ii < mutable.length; ii++) {
    const atomI = mutable[ii]
    for (let jj = ii + 1; jj < mutable.length; jj++) {
      const atomJ = mutable[jj]
      let subA = sublatticeOf[atomI]
      let subB = sublatticeOf[atomJ]
      let i = atomI, j = atomJ
      if (subA > subB) {
        ;[subA, subB] = [subB, subA]
        ;[i, j] = [j, i]
      }
      const key = `${subA}|${subB}`
      let bucket = grouped.get(key)
      if (!bucket) {
        bucket = { subA, subB, pairs: [] }
        grouped.set(key, bucket)
      }
      const distanceA = distanceBetween(structure.atoms[i].position, structure.atoms[j].position)
      if (Number.isFinite(distanceA) && distanceA > 1e-8) bucket.pairs.push({ i, j, distanceA })
    }
  }

  const clusters: PairCluster[] = []
  for (const bucket of grouped.values()) {
    bucket.pairs.sort((a, b) => a.distanceA - b.distanceA)
    const shells: Array<{ first: number; sum: number; pairs: PairRecord[] }> = []
    for (const pair of bucket.pairs) {
      const current = shells[shells.length - 1]
      if (!current || pair.distanceA - current.first > toleranceA) {
        shells.push({ first: pair.distanceA, sum: pair.distanceA, pairs: [pair] })
      } else {
        current.pairs.push(pair)
        current.sum += pair.distanceA
      }
    }
    const target = targetPairFractions(sublattices[bucket.subA], sublattices[bucket.subB])
    shells.slice(0, shellCount).forEach((shell, index) => {
      clusters.push({
        subA: bucket.subA,
        subB: bucket.subB,
        shell: index + 1,
        distanceA: shell.sum / shell.pairs.length,
        edges: shell.pairs.map((pair) => [pair.i, pair.j]),
        target,
        weight: 1 / (index + 1),
      })
    })
  }
  return clusters
}

function compareNumberArrays(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index]
  }
  return a.length - b.length
}

function canonicalizeTriangle(
  sites: [number, number, number],
  pairDistances: readonly [number, number, number],
  sublatticeOf: Int16Array,
  toleranceA: number,
): CanonicalTriangle {
  const distanceMatrix = [
    [0, pairDistances[0], pairDistances[1]],
    [pairDistances[0], 0, pairDistances[2]],
    [pairDistances[1], pairDistances[2], 0],
  ]
  const variants = TRIANGLE_PERMUTATIONS.map((order) => {
    const sublattices = order.map((index) => sublatticeOf[sites[index]]) as [number, number, number]
    const sideLengthsA: [number, number, number] = [
      distanceMatrix[order[0]][order[1]],
      distanceMatrix[order[0]][order[2]],
      distanceMatrix[order[1]][order[2]],
    ]
    const signature = [
      ...sublattices,
      ...sideLengthsA.map((value) => Math.round(value / toleranceA)),
    ]
    return { order, sublattices, sideLengthsA, signature }
  })
  variants.sort((a, b) => compareNumberArrays(a.signature, b.signature) || compareNumberArrays(a.order, b.order))
  const first = variants[0]
  const canonicalOrders = variants
    .filter((variant) => compareNumberArrays(variant.signature, first.signature) === 0)
    .map((variant) => variant.order)
  return {
    key: first.signature.join('|'),
    sublattices: first.sublattices,
    sideLengthsA: first.sideLengthsA,
    canonicalOrders,
  }
}

function canonicalizeQuadruplet(
  sites: [number, number, number, number],
  pairDistances: readonly [number, number, number, number, number, number],
  sublatticeOf: Int16Array,
  toleranceA: number,
): CanonicalQuadruplet {
  const distanceMatrix = [
    [0, pairDistances[0], pairDistances[1], pairDistances[2]],
    [pairDistances[0], 0, pairDistances[3], pairDistances[4]],
    [pairDistances[1], pairDistances[3], 0, pairDistances[5]],
    [pairDistances[2], pairDistances[4], pairDistances[5], 0],
  ]
  const variants = QUADRUPLET_PERMUTATIONS.map((order) => {
    const sublattices = order.map((index) => sublatticeOf[sites[index]]) as [number, number, number, number]
    const edgeLengthsA: [number, number, number, number, number, number] = [
      distanceMatrix[order[0]][order[1]],
      distanceMatrix[order[0]][order[2]],
      distanceMatrix[order[0]][order[3]],
      distanceMatrix[order[1]][order[2]],
      distanceMatrix[order[1]][order[3]],
      distanceMatrix[order[2]][order[3]],
    ]
    const signature = [
      ...sublattices,
      ...edgeLengthsA.map((value) => Math.round(value / toleranceA)),
    ]
    return { order, sublattices, edgeLengthsA, signature }
  })
  variants.sort((left, right) => (
    compareNumberArrays(left.signature, right.signature) || compareNumberArrays(left.order, right.order)
  ))
  const first = variants[0]
  const canonicalOrders = variants
    .filter((variant) => compareNumberArrays(variant.signature, first.signature) === 0)
    .map((variant) => variant.order)
  return {
    key: first.signature.join('|'),
    sublattices: first.sublattices,
    edgeLengthsA: first.edgeLengthsA,
    canonicalOrders,
  }
}

function canonicalTripletKey(values: readonly string[], orders: readonly Permutation3[]): string {
  let best: string | null = null
  for (const order of orders) {
    const key = `${values[order[0]]}>${values[order[1]]}>${values[order[2]]}`
    if (best === null || key < best) best = key
  }
  return best ?? ''
}

function canonicalQuadrupletKey(values: readonly string[], orders: readonly Permutation4[]): string {
  let best: string | null = null
  for (const order of orders) {
    const key = `${values[order[0]]}>${values[order[1]]}>${values[order[2]]}>${values[order[3]]}`
    if (best === null || key < best) best = key
  }
  return best ?? ''
}

function fallingFactorial(value: number, count: number): number {
  let result = 1
  for (let index = 0; index < count; index++) result *= value - index
  return result
}

function assignmentProbability(
  assignment: readonly string[],
  figure: { sites: readonly number[] },
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
): number {
  const occurrences = new Map<number, Record<string, number>>()
  for (let vertex = 0; vertex < assignment.length; vertex++) {
    const subIndex = sublatticeOf[figure.sites[vertex]]
    const counts = occurrences.get(subIndex) ?? {}
    counts[assignment[vertex]] = (counts[assignment[vertex]] ?? 0) + 1
    occurrences.set(subIndex, counts)
  }
  let probability = 1
  for (const [subIndex, counts] of occurrences) {
    const drawCount = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const sub = sublattices[subIndex]
    let numerator = 1
    for (const [species, count] of Object.entries(counts)) {
      numerator *= fallingFactorial(sub.counts[species] ?? 0, count)
    }
    const denominator = fallingFactorial(sub.sites.length, drawCount)
    probability *= denominator > 0 ? numerator / denominator : 0
  }
  return probability
}

function targetTripletFractions(
  figure: TripletFigure,
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
  maxTargetStates: number,
): Record<string, number> {
  const speciesByVertex = figure.sites.map((site) => sublattices[sublatticeOf[site]].species)
  const targetStateCount = speciesByVertex.reduce((product, species) => product * species.length, 1)
  if (targetStateCount > maxTargetStates) {
    throw new SqsInputError(
      'triplet_target_too_large',
      `A triplet cluster requires ${targetStateCount.toLocaleString()} target states, exceeding the local budget ${maxTargetStates.toLocaleString()}; route this cluster space to an icet/ATAT provider`,
    )
  }
  const target: Record<string, number> = {}
  for (const first of speciesByVertex[0]) {
    for (const second of speciesByVertex[1]) {
      for (const third of speciesByVertex[2]) {
        const assignment = [first, second, third]
        const probability = assignmentProbability(assignment, figure, sublattices, sublatticeOf)
        if (probability <= 0) continue
        const key = canonicalTripletKey(assignment, figure.canonicalOrders)
        target[key] = (target[key] ?? 0) + probability
      }
    }
  }
  const sum = Object.values(target).reduce((total, value) => total + value, 0)
  if (sum <= 0) throw new SqsInputError('invalid_triplet_target', 'The finite-cell triplet target has zero probability')
  for (const key of Object.keys(target)) target[key] /= sum
  return target
}

function targetQuadrupletFractions(
  figure: QuadrupletFigure,
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
  maxTargetStates: number,
): Record<string, number> {
  const speciesByVertex = figure.sites.map((site) => sublattices[sublatticeOf[site]].species)
  const targetStateCount = speciesByVertex.reduce((product, species) => product * species.length, 1)
  if (targetStateCount > maxTargetStates) {
    throw new SqsInputError(
      'quadruplet_target_too_large',
      `A quadruplet cluster requires ${targetStateCount.toLocaleString()} target states, exceeding the local budget ${maxTargetStates.toLocaleString()}; route this cluster space to an icet/ATAT provider`,
    )
  }
  const target: Record<string, number> = {}
  const assignment: string[] = []
  const visit = (vertex: number) => {
    if (vertex < speciesByVertex.length) {
      for (const species of speciesByVertex[vertex]) {
        assignment.push(species)
        visit(vertex + 1)
        assignment.pop()
      }
      return
    }
    const probability = assignmentProbability(assignment, figure, sublattices, sublatticeOf)
    if (probability <= 0) return
    const key = canonicalQuadrupletKey(assignment, figure.canonicalOrders)
    target[key] = (target[key] ?? 0) + probability
  }
  visit(0)
  const sum = Object.values(target).reduce((total, value) => total + value, 0)
  if (sum <= 0) throw new SqsInputError('invalid_quadruplet_target', 'The finite-cell quadruplet target has zero probability')
  for (const key of Object.keys(target)) target[key] /= sum
  return target
}

function buildTripletClusters(
  structure: ZatomStructure,
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
  cutoffA: number,
  toleranceA: number,
  maxFigures: number,
): TripletCluster[] {
  const mutable = sublattices.flatMap((sub) => sub.sites).sort((a, b) => a - b)
  const distanceBetween = createDistanceCalculator(structure.lattice)
  const forward = Array.from({ length: mutable.length }, () => new Map<number, number>())
  for (let left = 0; left < mutable.length; left++) {
    for (let right = left + 1; right < mutable.length; right++) {
      const distanceA = distanceBetween(
        structure.atoms[mutable[left]].position,
        structure.atoms[mutable[right]].position,
      )
      if (Number.isFinite(distanceA) && distanceA > 1e-8 && distanceA <= cutoffA + 1e-12) {
        forward[left].set(right, distanceA)
      }
    }
  }

  const grouped = new Map<string, {
    sublattices: [number, number, number]
    sideLengthSums: [number, number, number]
    figures: TripletFigure[]
  }>()
  let figureCount = 0
  for (let first = 0; first < mutable.length; first++) {
    const neighbors = [...forward[first].keys()]
    for (let left = 0; left < neighbors.length; left++) {
      const second = neighbors[left]
      for (let right = left + 1; right < neighbors.length; right++) {
        const third = neighbors[right]
        const secondThird = forward[second].get(third)
        if (secondThird === undefined) continue
        figureCount++
        if (figureCount > maxFigures) {
          throw new SqsInputError(
            'triplet_search_too_large',
            `Triangle enumeration exceeded maxTripletFigures=${maxFigures.toLocaleString()}; reduce tripletCutoffA, enlarge the explicit budget, or route to an icet/ATAT provider`,
          )
        }
        const sites: [number, number, number] = [mutable[first], mutable[second], mutable[third]]
        const canonical = canonicalizeTriangle(
          sites,
          [forward[first].get(second)!, forward[first].get(third)!, secondThird],
          sublatticeOf,
          toleranceA,
        )
        const figure: TripletFigure = { sites, canonicalOrders: canonical.canonicalOrders }
        const bucket = grouped.get(canonical.key)
        if (bucket) {
          bucket.figures.push(figure)
          for (let side = 0; side < 3; side++) bucket.sideLengthSums[side] += canonical.sideLengthsA[side]
        } else {
          if (grouped.size >= 2_000) {
            throw new SqsInputError(
              'triplet_cluster_space_too_large',
              'Triangle enumeration produced more than 2,000 geometry/sublattice clusters; reduce the cutoff or route to an icet/ATAT provider',
            )
          }
          grouped.set(canonical.key, {
            sublattices: canonical.sublattices,
            sideLengthSums: [...canonical.sideLengthsA] as [number, number, number],
            figures: [figure],
          })
        }
      }
    }
  }

  return [...grouped.values()]
    .map((bucket): TripletCluster => {
      const sideLengthsA = bucket.sideLengthSums.map((sum) => sum / bucket.figures.length) as [number, number, number]
      return {
        sublattices: bucket.sublattices,
        sideLengthsA,
        figures: bucket.figures,
        target: targetTripletFractions(bucket.figures[0], sublattices, sublatticeOf, 200_000),
        weight: 1 / Math.max(...sideLengthsA),
      }
    })
    .sort((a, b) => (
      Math.max(...a.sideLengthsA) - Math.max(...b.sideLengthsA)
      || compareNumberArrays(a.sublattices, b.sublattices)
      || compareNumberArrays(a.sideLengthsA, b.sideLengthsA)
    ))
}

function buildQuadrupletClusters(
  structure: ZatomStructure,
  sublattices: NormalizedSublattice[],
  sublatticeOf: Int16Array,
  cutoffA: number,
  toleranceA: number,
  maxFigures: number,
  maxCandidates: number,
): { clusters: QuadrupletCluster[]; candidateCount: number } {
  const mutable = sublattices.flatMap((sub) => sub.sites).sort((left, right) => left - right)
  const distanceBetween = createDistanceCalculator(structure.lattice)
  const forward = Array.from({ length: mutable.length }, () => new Map<number, number>())
  for (let left = 0; left < mutable.length; left++) {
    for (let right = left + 1; right < mutable.length; right++) {
      const distanceA = distanceBetween(
        structure.atoms[mutable[left]].position,
        structure.atoms[mutable[right]].position,
      )
      if (Number.isFinite(distanceA) && distanceA > 1e-8 && distanceA <= cutoffA + 1e-12) {
        forward[left].set(right, distanceA)
      }
    }
  }

  const grouped = new Map<string, {
    sublattices: [number, number, number, number]
    edgeLengthSums: [number, number, number, number, number, number]
    figures: QuadrupletFigure[]
  }>()
  let figureCount = 0
  let candidateCount = 0
  for (let first = 0; first < mutable.length; first++) {
    const neighbors = [...forward[first].keys()]
    for (let secondOffset = 0; secondOffset < neighbors.length; secondOffset++) {
      const second = neighbors[secondOffset]
      for (let thirdOffset = secondOffset + 1; thirdOffset < neighbors.length; thirdOffset++) {
        const third = neighbors[thirdOffset]
        candidateCount++
        if (candidateCount > maxCandidates) {
          throw new SqsInputError(
            'quadruplet_candidate_budget_exceeded',
            `Four-site candidate enumeration exceeded maxQuadrupletCandidates=${maxCandidates.toLocaleString()}; reduce quadrupletCutoffA, enlarge the explicit budget, or route to an icet/ATAT provider`,
          )
        }
        const secondThird = forward[second].get(third)
        if (secondThird === undefined) continue
        for (let fourthOffset = thirdOffset + 1; fourthOffset < neighbors.length; fourthOffset++) {
          candidateCount++
          if (candidateCount > maxCandidates) {
            throw new SqsInputError(
              'quadruplet_candidate_budget_exceeded',
              `Four-site candidate enumeration exceeded maxQuadrupletCandidates=${maxCandidates.toLocaleString()}; reduce quadrupletCutoffA, enlarge the explicit budget, or route to an icet/ATAT provider`,
            )
          }
          const fourth = neighbors[fourthOffset]
          const secondFourth = forward[second].get(fourth)
          const thirdFourth = forward[third].get(fourth)
          if (secondFourth === undefined || thirdFourth === undefined) continue
          figureCount++
          if (figureCount > maxFigures) {
            throw new SqsInputError(
              'quadruplet_search_too_large',
              `Four-site figure enumeration exceeded maxQuadrupletFigures=${maxFigures.toLocaleString()}; reduce quadrupletCutoffA, enlarge the explicit budget, or route to an icet/ATAT provider`,
            )
          }
          const sites: [number, number, number, number] = [
            mutable[first], mutable[second], mutable[third], mutable[fourth],
          ]
          const canonical = canonicalizeQuadruplet(sites, [
            forward[first].get(second)!,
            forward[first].get(third)!,
            forward[first].get(fourth)!,
            secondThird,
            secondFourth,
            thirdFourth,
          ], sublatticeOf, toleranceA)
          const figure: QuadrupletFigure = { sites, canonicalOrders: canonical.canonicalOrders }
          const bucket = grouped.get(canonical.key)
          if (bucket) {
            bucket.figures.push(figure)
            for (let edge = 0; edge < 6; edge++) bucket.edgeLengthSums[edge] += canonical.edgeLengthsA[edge]
          } else {
            if (grouped.size >= 2_000) {
              throw new SqsInputError(
                'quadruplet_cluster_space_too_large',
                'Four-site enumeration produced more than 2,000 geometry/sublattice clusters; reduce the cutoff or route to an icet/ATAT provider',
              )
            }
            grouped.set(canonical.key, {
              sublattices: canonical.sublattices,
              edgeLengthSums: [...canonical.edgeLengthsA],
              figures: [figure],
            })
          }
        }
      }
    }
  }

  const clusters = [...grouped.values()]
    .map((bucket): QuadrupletCluster => {
      const edgeLengthsA = bucket.edgeLengthSums.map((sum) => sum / bucket.figures.length) as QuadrupletCluster['edgeLengthsA']
      return {
        sublattices: bucket.sublattices,
        edgeLengthsA,
        figures: bucket.figures,
        target: targetQuadrupletFractions(bucket.figures[0], sublattices, sublatticeOf, 500_000),
        weight: 1 / Math.max(...edgeLengthsA),
      }
    })
    .sort((left, right) => (
      Math.max(...left.edgeLengthsA) - Math.max(...right.edgeLengthsA)
      || compareNumberArrays(left.sublattices, right.sublattices)
      || compareNumberArrays(left.edgeLengthsA, right.edgeLengthsA)
    ))
  return { clusters, candidateCount }
}

function observedPairFractions(cluster: PairCluster, labels: readonly string[]): Record<string, number> {
  const oriented = cluster.subA !== cluster.subB
  const counts: Record<string, number> = {}
  for (const [i, j] of cluster.edges) {
    const key = pairKey(labels[i], labels[j], oriented)
    counts[key] = (counts[key] ?? 0) + 1
  }
  const denom = Math.max(1, cluster.edges.length)
  for (const key of Object.keys(cluster.target)) counts[key] = (counts[key] ?? 0) / denom
  return counts
}

function pairObjectiveValue(clusters: PairCluster[], labels: readonly string[]): number {
  if (!clusters.length) return 0
  let total = 0
  let weights = 0
  for (const cluster of clusters) {
    const observed = observedPairFractions(cluster, labels)
    const keys = Object.keys(cluster.target)
    let local = 0
    for (const key of keys) {
      const d = (observed[key] ?? 0) - cluster.target[key]
      local += d * d
    }
    local /= Math.max(1, keys.length)
    total += cluster.weight * local
    weights += cluster.weight
  }
  return total / Math.max(1e-12, weights)
}

function observedTripletFractions(cluster: TripletCluster, labels: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const figure of cluster.figures) {
    const values = figure.sites.map((site) => labels[site])
    const key = canonicalTripletKey(values, figure.canonicalOrders)
    counts[key] = (counts[key] ?? 0) + 1
  }
  const denominator = Math.max(1, cluster.figures.length)
  for (const key of Object.keys(cluster.target)) counts[key] = (counts[key] ?? 0) / denominator
  return counts
}

function tripletObjectiveValue(clusters: TripletCluster[], labels: readonly string[]): number {
  if (!clusters.length) return 0
  let total = 0
  let weights = 0
  for (const cluster of clusters) {
    const observed = observedTripletFractions(cluster, labels)
    const keys = Object.keys(cluster.target)
    let local = 0
    for (const key of keys) {
      const delta = (observed[key] ?? 0) - cluster.target[key]
      local += delta * delta
    }
    local /= Math.max(1, keys.length)
    total += cluster.weight * local
    weights += cluster.weight
  }
  return total / Math.max(1e-12, weights)
}

function observedQuadrupletFractions(cluster: QuadrupletCluster, labels: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const figure of cluster.figures) {
    const values = figure.sites.map((site) => labels[site])
    const key = canonicalQuadrupletKey(values, figure.canonicalOrders)
    counts[key] = (counts[key] ?? 0) + 1
  }
  const denominator = Math.max(1, cluster.figures.length)
  for (const key of Object.keys(cluster.target)) counts[key] = (counts[key] ?? 0) / denominator
  return counts
}

function quadrupletObjectiveValue(clusters: QuadrupletCluster[], labels: readonly string[]): number {
  if (!clusters.length) return 0
  let total = 0
  let weights = 0
  for (const cluster of clusters) {
    const observed = observedQuadrupletFractions(cluster, labels)
    const keys = Object.keys(cluster.target)
    let local = 0
    for (const key of keys) {
      const delta = (observed[key] ?? 0) - cluster.target[key]
      local += delta * delta
    }
    local /= Math.max(1, keys.length)
    total += cluster.weight * local
    weights += cluster.weight
  }
  return total / Math.max(1e-12, weights)
}

function combinedObjective(
  pairClusters: PairCluster[],
  tripletClusters: TripletCluster[],
  quadrupletClusters: QuadrupletCluster[],
  labels: readonly string[],
  tripletWeight: number,
  quadrupletWeight: number,
): number {
  let total = 0
  let weights = 0
  if (pairClusters.length) {
    total += pairObjectiveValue(pairClusters, labels)
    weights += 1
  }
  if (tripletClusters.length) {
    total += tripletWeight * tripletObjectiveValue(tripletClusters, labels)
    weights += tripletWeight
  }
  if (quadrupletClusters.length) {
    total += quadrupletWeight * quadrupletObjectiveValue(quadrupletClusters, labels)
    weights += quadrupletWeight
  }
  return weights > 0 ? total / weights : 0
}

function rngForSeed(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(values: T[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
}

function randomLabels(
  sourceElements: readonly string[],
  sublattices: NormalizedSublattice[],
  random: () => number,
): string[] {
  const labels = [...sourceElements]
  for (const sub of sublattices) {
    const bag: string[] = []
    for (const species of sub.species) for (let i = 0; i < sub.counts[species]; i++) bag.push(species)
    shuffle(bag, random)
    sub.sites.forEach((site, index) => { labels[site] = bag[index] })
  }
  return labels
}

function differentLabelPair(sub: NormalizedSublattice, labels: readonly string[], random: () => number): [number, number] | null {
  for (let attempt = 0; attempt < 20; attempt++) {
    const i = sub.sites[Math.floor(random() * sub.sites.length)]
    const j = sub.sites[Math.floor(random() * sub.sites.length)]
    if (i !== j && labels[i] !== labels[j]) return [i, j]
  }
  for (let a = 0; a < sub.sites.length; a++) for (let b = a + 1; b < sub.sites.length; b++) {
    if (labels[sub.sites[a]] !== labels[sub.sites[b]]) return [sub.sites[a], sub.sites[b]]
  }
  return null
}

function warrenCowley(cluster: PairCluster, labels: readonly string[], sub: NormalizedSublattice): WarrenCowleyEntry[] {
  if (cluster.subA !== cluster.subB) return []
  const outgoing: Record<string, number> = {}
  const directed: Record<string, number> = {}
  for (const [i, j] of cluster.edges) {
    const a = labels[i], b = labels[j]
    outgoing[a] = (outgoing[a] ?? 0) + 1
    outgoing[b] = (outgoing[b] ?? 0) + 1
    directed[`${a}>${b}`] = (directed[`${a}>${b}`] ?? 0) + 1
    directed[`${b}>${a}`] = (directed[`${b}>${a}`] ?? 0) + 1
  }
  const out: WarrenCowleyEntry[] = []
  for (const center of sub.species) {
    if ((sub.counts[center] ?? 0) === 0) continue
    for (const neighbor of sub.species) {
      const randomProbability = sub.sites.length > 1
        ? (sub.counts[neighbor] - (center === neighbor ? 1 : 0)) / (sub.sites.length - 1)
        : 0
      const probability = outgoing[center] ? (directed[`${center}>${neighbor}`] ?? 0) / outgoing[center] : 0
      out.push({
        centerElement: center,
        neighborElement: neighbor,
        probability,
        randomProbability,
        alpha: randomProbability > 0 ? 1 - probability / randomProbability : 0,
      })
    }
  }
  return out
}

function shortestPeriodicTranslation(structure: ZatomStructure): number | null {
  const lattice = structure.lattice
  if (!lattice) return null
  let shortest = Infinity
  const xs = lattice.periodic[0] ? [-2, -1, 0, 1, 2] : [0]
  const ys = lattice.periodic[1] ? [-2, -1, 0, 1, 2] : [0]
  const zs = lattice.periodic[2] ? [-2, -1, 0, 1, 2] : [0]
  for (const ia of xs) for (const ib of ys) for (const ic of zs) {
    if (ia === 0 && ib === 0 && ic === 0) continue
    const translation = fractionalToCartesian([ia, ib, ic], lattice.vectors)
    shortest = Math.min(shortest, distance(translation, [0, 0, 0]))
  }
  return Number.isFinite(shortest) ? shortest : null
}

function qualityReport(
  sublattices: NormalizedSublattice[],
  pairClusters: PairCluster[],
  tripletClusters: TripletCluster[],
  quadrupletClusters: QuadrupletCluster[],
  labels: readonly string[],
  finalObjective: number,
  pairObjective: number | null,
  tripletObjective: number | null,
  quadrupletObjective: number | null,
): SqsQualityReport {
  const compositions = sublattices.map((sub): SqsCompositionReport => {
    const counts: Record<string, number> = {}
    for (const site of sub.sites) counts[labels[site]] = (counts[labels[site]] ?? 0) + 1
    const actualFractions: Record<string, number> = {}
    let maxFractionError = 0
    for (const species of sub.species) {
      actualFractions[species] = (counts[species] ?? 0) / sub.sites.length
      maxFractionError = Math.max(maxFractionError, Math.abs(actualFractions[species] - sub.composition[species]))
    }
    return {
      sublattice: sub.id,
      siteCount: sub.sites.length,
      requestedFractions: { ...sub.composition },
      actualFractions,
      counts,
      maxFractionError,
    }
  })

  let maxAbsPairError = 0
  let maxAbsWarrenCowley = 0
  const pairShells = pairClusters.map((cluster): SqsPairShellReport => {
    const actual = observedPairFractions(cluster, labels)
    let shellError = 0
    for (const key of Object.keys(cluster.target)) shellError = Math.max(shellError, Math.abs((actual[key] ?? 0) - cluster.target[key]))
    maxAbsPairError = Math.max(maxAbsPairError, shellError)
    const wc = warrenCowley(cluster, labels, sublattices[cluster.subA])
    for (const entry of wc) maxAbsWarrenCowley = Math.max(maxAbsWarrenCowley, Math.abs(entry.alpha))
    return {
      sublattices: [sublattices[cluster.subA].id, sublattices[cluster.subB].id],
      shell: cluster.shell,
      distanceA: cluster.distanceA,
      pairCount: cluster.edges.length,
      targetPairFractions: { ...cluster.target },
      actualPairFractions: actual,
      maxAbsPairError: shellError,
      warrenCowley: wc,
    }
  })

  let maxAbsTripletError = 0
  const tripletClusterReports = tripletClusters.map((cluster): SqsTripletClusterReport => {
    const actual = observedTripletFractions(cluster, labels)
    let clusterError = 0
    for (const key of Object.keys(cluster.target)) {
      clusterError = Math.max(clusterError, Math.abs((actual[key] ?? 0) - cluster.target[key]))
    }
    maxAbsTripletError = Math.max(maxAbsTripletError, clusterError)
    return {
      sublattices: cluster.sublattices.map((index) => sublattices[index].id) as [string, string, string],
      sideLengthsA: [...cluster.sideLengthsA],
      tripletCount: cluster.figures.length,
      targetTripletFractions: { ...cluster.target },
      actualTripletFractions: actual,
      maxAbsTripletError: clusterError,
    }
  })

  let maxAbsQuadrupletError = 0
  const quadrupletClusterReports = quadrupletClusters.map((cluster): SqsQuadrupletClusterReport => {
    const actual = observedQuadrupletFractions(cluster, labels)
    let clusterError = 0
    for (const key of Object.keys(cluster.target)) {
      clusterError = Math.max(clusterError, Math.abs((actual[key] ?? 0) - cluster.target[key]))
    }
    maxAbsQuadrupletError = Math.max(maxAbsQuadrupletError, clusterError)
    return {
      sublattices: cluster.sublattices.map((index) => sublattices[index].id) as [string, string, string, string],
      edgeLengthsA: [...cluster.edgeLengthsA],
      quadrupletCount: cluster.figures.length,
      targetQuadrupletFractions: { ...cluster.target },
      actualQuadrupletFractions: actual,
      maxAbsQuadrupletError: clusterError,
    }
  })

  const hasPairs = pairClusters.length > 0
  const hasTriplets = tripletClusters.length > 0
  const hasQuadruplets = quadrupletClusters.length > 0
  const hasAssessment = hasPairs || hasTriplets || hasQuadruplets
  const pairsNearIdeal = !hasPairs || (maxAbsPairError <= 0.025 && maxAbsWarrenCowley <= 0.10)
  const pairsAcceptable = !hasPairs || (maxAbsPairError <= 0.06 && maxAbsWarrenCowley <= 0.25)
  const tripletsNearIdeal = !hasTriplets || maxAbsTripletError <= 0.04
  const tripletsAcceptable = !hasTriplets || maxAbsTripletError <= 0.10
  const quadrupletsNearIdeal = !hasQuadruplets || maxAbsQuadrupletError <= 0.06
  const quadrupletsAcceptable = !hasQuadruplets || maxAbsQuadrupletError <= 0.15
  const verdict = !hasAssessment
    ? 'unassessed'
    : pairsNearIdeal && tripletsNearIdeal && quadrupletsNearIdeal
      ? 'near-ideal'
      : pairsAcceptable && tripletsAcceptable && quadrupletsAcceptable
        ? 'acceptable'
        : 'poor'
  return {
    verdict,
    objective: finalObjective,
    pairObjective,
    tripletObjective,
    quadrupletObjective,
    maxAbsPairError: hasPairs ? maxAbsPairError : null,
    maxAbsTripletError: hasTriplets ? maxAbsTripletError : null,
    maxAbsQuadrupletError: hasQuadruplets ? maxAbsQuadrupletError : null,
    maxAbsWarrenCowley: hasPairs ? maxAbsWarrenCowley : null,
    compositions,
    pairShells,
    tripletClusters: tripletClusterReports,
    quadrupletClusters: quadrupletClusterReports,
  }
}

function occupationFingerprint(labels: readonly string[], sublattices: readonly NormalizedSublattice[]): string {
  const hasher = createFnv1a64Hasher()
  const feed = hasher.feed
  feed(`sublattices:${sublattices.length}|`)
  for (const sub of sublattices) {
    feed(canonicalJsonIdentity(sub.id))
    feed(`sites:${sub.sites.length}|`)
    for (const site of sub.sites) {
      feed(`${site}:`)
      feed(canonicalJsonIdentity(labels[site]))
    }
  }
  return hasher.digest()
}

function derivedEnsembleSeed(baseSeed: number, index: number): number {
  if (index === 0) return baseSeed
  return (baseSeed + Math.imul(index, 0x9e3779b9)) >>> 0
}

function compareOptimizationRuns(left: SqsOptimizationRun, right: SqsOptimizationRun): number {
  const nullable = (value: number | null) => value ?? Number.POSITIVE_INFINITY
  return left.finalObjective - right.finalObjective
    || nullable(left.quality.maxAbsPairError) - nullable(right.quality.maxAbsPairError)
    || nullable(left.quality.maxAbsTripletError) - nullable(right.quality.maxAbsTripletError)
    || nullable(left.quality.maxAbsQuadrupletError) - nullable(right.quality.maxAbsQuadrupletError)
    || nullable(left.quality.maxAbsWarrenCowley) - nullable(right.quality.maxAbsWarrenCowley)
    || compareCanonicalText(left.occupationFingerprint, right.occupationFingerprint)
    || left.seed - right.seed
}

function optimizeOccupations(options: {
  seed: number
  sourceElements: readonly string[]
  sublattices: NormalizedSublattice[]
  swappable: NormalizedSublattice[]
  pairClusters: PairCluster[]
  tripletClusters: TripletCluster[]
  quadrupletClusters: QuadrupletCluster[]
  tripletWeight: number
  quadrupletWeight: number
  restarts: number
  stepsPerRestart: number
}): SqsOptimizationRun {
  const random = rngForSeed(options.seed)
  let bestLabels = randomLabels(options.sourceElements, options.sublattices, random)
  let bestObjective = combinedObjective(
    options.pairClusters,
    options.tripletClusters,
    options.quadrupletClusters,
    bestLabels,
    options.tripletWeight,
    options.quadrupletWeight,
  )
  const initialObjective = bestObjective
  let evaluations = 1
  let acceptedMoves = 0
  for (let restart = 0; restart < options.restarts; restart++) {
    const labels = restart === 0
      ? [...bestLabels]
      : randomLabels(options.sourceElements, options.sublattices, random)
    let currentObjective = combinedObjective(
      options.pairClusters,
      options.tripletClusters,
      options.quadrupletClusters,
      labels,
      options.tripletWeight,
      options.quadrupletWeight,
    )
    evaluations++
    for (let step = 0; step < options.stepsPerRestart; step++) {
      const sub = options.swappable[Math.floor(random() * options.swappable.length)]
      const pair = differentLabelPair(sub, labels, random)
      if (!pair) break
      const [i, j] = pair
      ;[labels[i], labels[j]] = [labels[j], labels[i]]
      const proposal = combinedObjective(
        options.pairClusters,
        options.tripletClusters,
        options.quadrupletClusters,
        labels,
        options.tripletWeight,
        options.quadrupletWeight,
      )
      evaluations++
      const progress = step / Math.max(1, options.stepsPerRestart - 1)
      const temperature = Math.max(1e-5, 0.02 * (1 - progress) ** 2)
      const accept = proposal <= currentObjective || random() < Math.exp((currentObjective - proposal) / temperature)
      if (accept) {
        currentObjective = proposal
        acceptedMoves++
        if (proposal < bestObjective) {
          bestObjective = proposal
          bestLabels = [...labels]
        }
      } else {
        ;[labels[i], labels[j]] = [labels[j], labels[i]]
      }
    }
    if (bestObjective < 1e-12) break
  }
  const pairObjective = options.pairClusters.length
    ? pairObjectiveValue(options.pairClusters, bestLabels)
    : null
  const tripletObjective = options.tripletClusters.length
    ? tripletObjectiveValue(options.tripletClusters, bestLabels)
    : null
  const quadrupletObjective = options.quadrupletClusters.length
    ? quadrupletObjectiveValue(options.quadrupletClusters, bestLabels)
    : null
  return {
    seed: options.seed,
    labels: bestLabels,
    initialObjective,
    finalObjective: bestObjective,
    evaluations,
    acceptedMoves,
    pairObjective,
    tripletObjective,
    quadrupletObjective,
    quality: qualityReport(
      options.sublattices,
      options.pairClusters,
      options.tripletClusters,
      options.quadrupletClusters,
      bestLabels,
      bestObjective,
      pairObjective,
      tripletObjective,
      quadrupletObjective,
    ),
    occupationFingerprint: occupationFingerprint(bestLabels, options.sublattices),
  }
}

export function generateSqs(options: GenerateSqsOptions): GenerateSqsResult {
  const sourceValidation = validateStructure(options.structure, { requirePeriodic: true })
  if (sourceValidation.verdict === 'fail') {
    throw new SqsInputError('invalid_source_structure', 'Source structure failed numeric validation')
  }
  const scaling = normalizeScaling(options.supercell)
  const maxOutputAtoms = Math.max(1, Math.trunc(options.maxOutputAtoms ?? 20_000))
  const outputAtomCount = options.structure.atoms.length * scaling[0] * scaling[1] * scaling[2]
  if (outputAtomCount > maxOutputAtoms) {
    throw new SqsInputError('output_too_large', `Requested ${outputAtomCount.toLocaleString()} atoms exceeds maxOutputAtoms=${maxOutputAtoms.toLocaleString()}`)
  }
  const sublattices = normalizeSublattices(options.sublattices)
  const { structure, sourceElements, sourceAtomIds } = replicateStructure(options.structure, scaling)
  const sublatticeOf = new Int16Array(structure.atoms.length)
  sublatticeOf.fill(-1)
  for (let atomIndex = 0; atomIndex < sourceElements.length; atomIndex++) {
    const element = sourceElements[atomIndex]
    const sourceAtomId = sourceAtomIds[atomIndex]
    let matched = -1
    for (let subIndex = 0; subIndex < sublattices.length; subIndex++) {
      const sub = sublattices[subIndex]
      const elementMatches = !sub.siteElements.size || sub.siteElements.has(element)
      const idMatches = !sub.siteAtomIds.size || sub.siteAtomIds.has(sourceAtomId)
      if (!elementMatches || !idMatches) continue
      if (matched >= 0) throw new SqsInputError('overlapping_sublattices', `Atom ${structure.atoms[atomIndex].id} matches more than one sublattice`)
      matched = subIndex
    }
    if (matched >= 0) {
      sublattices[matched].sites.push(atomIndex)
      sublatticeOf[atomIndex] = matched
    }
  }
  for (const sub of sublattices) {
    if (!sub.sites.length) throw new SqsInputError('empty_sublattice', `${sub.id} selected no parent sites`)
    sub.counts = allocateCounts(sub.sites.length, sub.composition)
    if (Object.values(sub.counts).filter((count) => count > 0).length < 2) {
      throw new SqsInputError(
        'incommensurate_composition',
        `${sub.id} has too few sites (${sub.sites.length}) to realize at least two requested species; enlarge the supercell`,
      )
    }
  }
  const mutableSiteCount = sublattices.reduce((sum, sub) => sum + sub.sites.length, 0)
  const maxSearchSites = Math.max(2, Math.trunc(options.maxSearchSites ?? 2_000))
  if (mutableSiteCount > maxSearchSites) {
    throw new SqsInputError(
      'search_too_large',
      `${mutableSiteCount.toLocaleString()} mutable sites exceeds the local pair-search budget ${maxSearchSites.toLocaleString()}; route this request to an ATAT/icet MCP backend`,
    )
  }

  const shellCount = Math.max(1, Math.min(12, Math.trunc(options.shellCount ?? 4)))
  const shellToleranceA = Math.max(1e-4, Math.min(0.5, options.shellToleranceA ?? 0.05))
  const rawTripletCutoffA = options.tripletCutoffA ?? 0
  if (!Number.isFinite(rawTripletCutoffA) || rawTripletCutoffA < 0 || rawTripletCutoffA > 100) {
    throw new SqsInputError('invalid_triplet_cutoff', 'tripletCutoffA must be finite and in [0, 100]; zero disables triplet clusters')
  }
  const tripletCutoffA = rawTripletCutoffA
  const tripletsEnabled = tripletCutoffA > 0
  const rawTripletWeight = options.tripletWeight ?? 1
  if (!Number.isFinite(rawTripletWeight) || rawTripletWeight <= 0 || rawTripletWeight > 10) {
    throw new SqsInputError('invalid_triplet_weight', 'tripletWeight must be finite and in (0, 10]')
  }
  const tripletWeight = rawTripletWeight
  const rawMaxTripletFigures = options.maxTripletFigures ?? 20_000
  if (!Number.isInteger(rawMaxTripletFigures) || rawMaxTripletFigures < 1 || rawMaxTripletFigures > 200_000) {
    throw new SqsInputError('invalid_triplet_figure_budget', 'maxTripletFigures must be an integer in [1, 200000]')
  }
  const maxTripletFigures = rawMaxTripletFigures
  const rawMaxTripletSearchSites = options.maxTripletSearchSites ?? 512
  if (!Number.isInteger(rawMaxTripletSearchSites) || rawMaxTripletSearchSites < 3 || rawMaxTripletSearchSites > 1_000) {
    throw new SqsInputError('invalid_triplet_site_budget', 'maxTripletSearchSites must be an integer in [3, 1000]')
  }
  const maxTripletSearchSites = rawMaxTripletSearchSites
  if (tripletsEnabled && mutableSiteCount > maxTripletSearchSites) {
    throw new SqsInputError(
      'triplet_search_too_large',
      `${mutableSiteCount.toLocaleString()} mutable sites exceeds maxTripletSearchSites=${maxTripletSearchSites.toLocaleString()}; disable triplets or route this cluster space to an icet/ATAT provider`,
    )
  }
  const rawQuadrupletCutoffA = options.quadrupletCutoffA ?? 0
  if (!Number.isFinite(rawQuadrupletCutoffA) || rawQuadrupletCutoffA < 0 || rawQuadrupletCutoffA > 100) {
    throw new SqsInputError('invalid_quadruplet_cutoff', 'quadrupletCutoffA must be finite and in [0, 100]; zero disables quadruplet clusters')
  }
  const quadrupletCutoffA = rawQuadrupletCutoffA
  const quadrupletsEnabled = quadrupletCutoffA > 0
  const rawQuadrupletWeight = options.quadrupletWeight ?? 1
  if (!Number.isFinite(rawQuadrupletWeight) || rawQuadrupletWeight <= 0 || rawQuadrupletWeight > 10) {
    throw new SqsInputError('invalid_quadruplet_weight', 'quadrupletWeight must be finite and in (0, 10]')
  }
  const quadrupletWeight = rawQuadrupletWeight
  const rawMaxQuadrupletFigures = options.maxQuadrupletFigures ?? 10_000
  if (!Number.isSafeInteger(rawMaxQuadrupletFigures) || rawMaxQuadrupletFigures < 1 || rawMaxQuadrupletFigures > 100_000) {
    throw new SqsInputError('invalid_quadruplet_figure_budget', 'maxQuadrupletFigures must be an integer in [1, 100000]')
  }
  const maxQuadrupletFigures = rawMaxQuadrupletFigures
  const rawMaxQuadrupletCandidates = options.maxQuadrupletCandidates ?? 2_000_000
  if (!Number.isSafeInteger(rawMaxQuadrupletCandidates) || rawMaxQuadrupletCandidates < 1 || rawMaxQuadrupletCandidates > 20_000_000) {
    throw new SqsInputError('invalid_quadruplet_candidate_budget', 'maxQuadrupletCandidates must be an integer in [1, 20000000]')
  }
  const maxQuadrupletCandidates = rawMaxQuadrupletCandidates
  const rawMaxQuadrupletSearchSites = options.maxQuadrupletSearchSites ?? 256
  if (!Number.isSafeInteger(rawMaxQuadrupletSearchSites) || rawMaxQuadrupletSearchSites < 4 || rawMaxQuadrupletSearchSites > 512) {
    throw new SqsInputError('invalid_quadruplet_site_budget', 'maxQuadrupletSearchSites must be an integer in [4, 512]')
  }
  const maxQuadrupletSearchSites = rawMaxQuadrupletSearchSites
  if (quadrupletsEnabled && mutableSiteCount > maxQuadrupletSearchSites) {
    throw new SqsInputError(
      'quadruplet_search_too_large',
      `${mutableSiteCount.toLocaleString()} mutable sites exceeds maxQuadrupletSearchSites=${maxQuadrupletSearchSites.toLocaleString()}; disable quadruplets or route this cluster space to an icet/ATAT provider`,
    )
  }

  const pairClusters = buildPairClusters(structure, sublattices, sublatticeOf, shellCount, shellToleranceA)
  const tripletClusters = tripletsEnabled
    ? buildTripletClusters(
        structure,
        sublattices,
        sublatticeOf,
        tripletCutoffA,
        shellToleranceA,
        maxTripletFigures,
      )
    : []
  const quadrupletBuild = quadrupletsEnabled
    ? buildQuadrupletClusters(
        structure,
        sublattices,
        sublatticeOf,
        quadrupletCutoffA,
        shellToleranceA,
        maxQuadrupletFigures,
        maxQuadrupletCandidates,
      )
    : { clusters: [] as QuadrupletCluster[], candidateCount: 0 }
  const quadrupletClusters = quadrupletBuild.clusters
  const rawSeed = options.seed ?? 42
  if (!Number.isSafeInteger(rawSeed) || rawSeed < 0 || rawSeed > 0xffff_ffff) {
    throw new SqsInputError('invalid_seed', 'seed must be an integer in [0, 4294967295]')
  }
  const seed = rawSeed >>> 0
  const rawEnsembleSize = options.ensembleSize ?? 1
  if (!Number.isSafeInteger(rawEnsembleSize) || rawEnsembleSize < 1 || rawEnsembleSize > 32) {
    throw new SqsInputError('invalid_ensemble_size', 'ensembleSize must be an integer in [1, 32]')
  }
  const ensembleSize = rawEnsembleSize
  const highOrderEnabled = tripletsEnabled || quadrupletsEnabled
  const defaultRestarts = highOrderEnabled
    ? Math.max(4, Math.min(16, Math.ceil(mutableSiteCount / 12)))
    : Math.max(8, Math.min(48, Math.ceil(mutableSiteCount / 6)))
  const defaultStepsPerRestart = highOrderEnabled
    ? Math.max(64, Math.min(384, mutableSiteCount * 4))
    : Math.max(96, Math.min(768, mutableSiteCount * 8))
  const restarts = Math.max(1, Math.min(128, Math.trunc(options.restarts ?? defaultRestarts)))
  const stepsPerRestart = Math.max(1, Math.min(10_000, Math.trunc(options.stepsPerRestart ?? defaultStepsPerRestart)))
  const swappable = sublattices.filter((sub) => Object.values(sub.counts).filter((count) => count > 0).length > 1)
  const pairFigureCount = pairClusters.reduce((sum, cluster) => sum + cluster.edges.length, 0)
  const tripletFigureCount = tripletClusters.reduce((sum, cluster) => sum + cluster.figures.length, 0)
  const quadrupletFigureCount = quadrupletClusters.reduce((sum, cluster) => sum + cluster.figures.length, 0)
  const projectedEvaluationBudget = ensembleSize * (1 + restarts * (stepsPerRestart + 1))
  const rawMaxSearchEvaluations = options.maxSearchEvaluations ?? 5_000_000
  if (!Number.isSafeInteger(rawMaxSearchEvaluations) || rawMaxSearchEvaluations < 1 || rawMaxSearchEvaluations > 50_000_000) {
    throw new SqsInputError('invalid_search_evaluation_budget', 'maxSearchEvaluations must be an integer in [1, 50000000]')
  }
  if (projectedEvaluationBudget > rawMaxSearchEvaluations) {
    throw new SqsInputError(
      'search_evaluation_budget_exceeded',
      `The SQS ensemble can evaluate up to ${projectedEvaluationBudget.toLocaleString()} occupation states above maxSearchEvaluations=${rawMaxSearchEvaluations.toLocaleString()}`,
    )
  }
  const projectedObjectiveTermEvaluations = projectedEvaluationBudget * (
    pairFigureCount + tripletFigureCount + quadrupletFigureCount
  )
  const rawMaxObjectiveTermEvaluations = options.maxObjectiveTermEvaluations ?? 500_000_000
  if (!Number.isSafeInteger(rawMaxObjectiveTermEvaluations)
    || rawMaxObjectiveTermEvaluations < 1 || rawMaxObjectiveTermEvaluations > 10_000_000_000) {
    throw new SqsInputError('invalid_objective_term_budget', 'maxObjectiveTermEvaluations must be an integer in [1, 10000000000]')
  }
  if (!Number.isSafeInteger(projectedObjectiveTermEvaluations)
    || projectedObjectiveTermEvaluations > rawMaxObjectiveTermEvaluations) {
    throw new SqsInputError(
      'objective_term_budget_exceeded',
      `The SQS ensemble projects ${projectedObjectiveTermEvaluations.toLocaleString()} pair/triplet figure visits above maxObjectiveTermEvaluations=${rawMaxObjectiveTermEvaluations.toLocaleString()}`,
    )
  }

  const ensembleSeeds = Array.from({ length: ensembleSize }, (_, index) => derivedEnsembleSeed(seed, index))
  const runs = ensembleSeeds.map((ensembleSeed) => optimizeOccupations({
    seed: ensembleSeed,
    sourceElements,
    sublattices,
    swappable,
    pairClusters,
    tripletClusters,
    quadrupletClusters,
    tripletWeight,
    quadrupletWeight,
    restarts,
    stepsPerRestart,
  })).sort(compareOptimizationRuns)
  const selectedRun = runs[0]
  const bestLabels = selectedRun.labels
  const bestObjective = selectedRun.finalObjective
  const initialObjective = selectedRun.initialObjective
  const evaluations = runs.reduce((sum, run) => sum + run.evaluations, 0)
  const acceptedMoves = runs.reduce((sum, run) => sum + run.acceptedMoves, 0)
  const sortedObjectives = runs.map((run) => run.finalObjective).sort((left, right) => left - right)
  const medianObjective = sortedObjectives.length % 2 === 1
    ? sortedObjectives[(sortedObjectives.length - 1) / 2]
    : (sortedObjectives[sortedObjectives.length / 2 - 1] + sortedObjectives[sortedObjectives.length / 2]) / 2
  const ensembleCandidates: SqsEnsembleCandidateReport[] = runs.map((run, index) => ({
    rank: index + 1,
    seed: run.seed,
    occupationFingerprint: run.occupationFingerprint,
    verdict: run.quality.verdict,
    initialObjective: run.initialObjective,
    finalObjective: run.finalObjective,
    pairObjective: run.pairObjective,
    tripletObjective: run.tripletObjective,
    quadrupletObjective: run.quadrupletObjective,
    maxAbsPairError: run.quality.maxAbsPairError,
    maxAbsTripletError: run.quality.maxAbsTripletError,
    maxAbsQuadrupletError: run.quality.maxAbsQuadrupletError,
    maxAbsWarrenCowley: run.quality.maxAbsWarrenCowley,
    evaluations: run.evaluations,
    acceptedMoves: run.acceptedMoves,
  }))
  const ensemble: SqsEnsembleReport = {
    requestedSize: ensembleSize,
    completedSize: runs.length,
    selectedSeed: selectedRun.seed,
    uniqueOccupationCount: new Set(runs.map((run) => run.occupationFingerprint)).size,
    bestObjective: sortedObjectives[0],
    medianObjective,
    worstObjective: sortedObjectives[sortedObjectives.length - 1],
    objectiveSpread: sortedObjectives[sortedObjectives.length - 1] - sortedObjectives[0],
    candidates: ensembleCandidates,
  }

  const relabeled = [] as StructureChangeSet['relabeled']
  const relabeledPositions: Vec3[] = []
  let relabeledCount = 0
  structure.atoms = structure.atoms.map((atom, index) => {
    const nextElement = bestLabels[index]
    if (nextElement !== sourceElements[index]) {
      relabeledCount++
      relabeledPositions.push([...atom.position] as Vec3)
      if (relabeled.length < 500) {
        relabeled.push({ atomId: atom.id, fromElement: sourceElements[index], toElement: nextElement, position: [...atom.position] as Vec3 })
      }
    }
    return { ...atom, element: nextElement }
  })

  const quality = selectedRun.quality
  const validation = validateStructure(structure)
  const maxCompositionError = Math.max(...quality.compositions.map((item) => item.maxFractionError))
  const furthestAssessedShellA = Math.max(
    pairClusters.reduce((max, cluster) => Math.max(max, cluster.distanceA), 0),
    tripletClusters.reduce((max, cluster) => Math.max(max, ...cluster.sideLengthsA), 0),
    quadrupletClusters.reduce((max, cluster) => Math.max(max, ...cluster.edgeLengthsA), 0),
  )
  const shortestTranslationA = shortestPeriodicTranslation(structure)
  const shellsInsideHalfCell = shortestTranslationA === null || furthestAssessedShellA < shortestTranslationA / 2 - shellToleranceA
  const pairsNearIdeal = quality.maxAbsPairError !== null
    && quality.maxAbsPairError <= 0.025
    && (quality.maxAbsWarrenCowley ?? 0) <= 0.10
  const tripletsNearIdeal = quality.maxAbsTripletError !== null && quality.maxAbsTripletError <= 0.04
  const quadrupletsNearIdeal = quality.maxAbsQuadrupletError !== null && quality.maxAbsQuadrupletError <= 0.06
  const maximumAssessedClusterOrder = quadrupletClusters.length
    ? 4
    : tripletClusters.length ? 3 : pairClusters.length ? 2 : 0
  const checks: ValidationCheck[] = [
    ...validation.checks,
    {
      id: 'sqs.composition_realized',
      status: maxCompositionError <= 1e-10 ? 'pass' : 'warn',
      message: maxCompositionError <= 1e-10
        ? 'Every requested sublattice fraction is realized exactly as an integer count'
        : 'The finite supercell requires nearest-integer composition rounding; inspect requested and actual fractions',
      metrics: { maxFractionError: maxCompositionError },
    },
    {
      id: 'sqs.positions_preserved',
      status: 'pass',
      message: 'SQS search changed occupations only; Cartesian site displacement is exactly zero',
      metrics: { maxPositionDisplacementA: 0 },
    },
    {
      id: 'sqs.seed_ensemble',
      status: ensembleSize > 1 ? 'pass' : 'warn',
      message: ensembleSize > 1
        ? `Ranked ${ensembleSize} independently seeded anneals and selected seed ${selectedRun.seed}`
        : 'Only one independent seed was searched; use ensembleSize > 1 to measure seed sensitivity and retain an auditable ranking',
      metrics: {
        ensembleSize,
        selectedSeed: selectedRun.seed,
        uniqueOccupationCount: ensemble.uniqueOccupationCount,
        bestObjective: ensemble.bestObjective,
        medianObjective: ensemble.medianObjective,
        worstObjective: ensemble.worstObjective,
        objectiveSpread: ensemble.objectiveSpread,
      },
    },
    {
      id: 'sqs.search_budget',
      status: 'pass',
      message: `Completed ${evaluations.toLocaleString()} objective evaluations inside explicit state/figure-visit budgets`,
      metrics: {
        evaluations,
        projectedEvaluationBudget,
        maxSearchEvaluations: rawMaxSearchEvaluations,
        pairFigureCount,
        tripletFigureCount,
        quadrupletFigureCount,
        projectedObjectiveTermEvaluations,
        maxObjectiveTermEvaluations: rawMaxObjectiveTermEvaluations,
      },
    },
    {
      id: 'sqs.pair_correlations',
      status: pairClusters.length === 0 ? 'skipped' : pairsNearIdeal ? 'pass' : 'warn',
      message: pairsNearIdeal
        ? 'Pair correlations are near the finite-cell random target'
        : pairClusters.length === 0
          ? 'No pair shells were available for an SQS assessment'
          : 'Pair correlations exceed the near-ideal threshold; inspect metrics or enlarge/search longer',
      metrics: {
        objective: quality.pairObjective,
        maxAbsPairError: quality.maxAbsPairError,
        maxAbsWarrenCowley: quality.maxAbsWarrenCowley,
      },
    },
    {
      id: 'sqs.triplet_correlations',
      status: !tripletsEnabled || tripletClusters.length === 0 ? 'skipped' : tripletsNearIdeal ? 'pass' : 'warn',
      message: !tripletsEnabled
        ? 'Triplet clusters were not requested; set tripletCutoffA to enable the bounded local triangle objective'
        : tripletClusters.length === 0
          ? 'No closed triangle figures exist inside tripletCutoffA'
          : tripletsNearIdeal
            ? 'Triplet correlations are near the finite-cell random target'
            : 'Triplet correlations exceed the near-ideal threshold; inspect metrics or enlarge/search longer',
      metrics: {
        objective: quality.tripletObjective,
        maxAbsTripletError: quality.maxAbsTripletError,
        tripletClusterCount: tripletClusters.length,
        tripletFigureCount: tripletClusters.reduce((sum, cluster) => sum + cluster.figures.length, 0),
      },
    },
    {
      id: 'sqs.quadruplet_correlations',
      status: !quadrupletsEnabled || quadrupletClusters.length === 0 ? 'skipped' : quadrupletsNearIdeal ? 'pass' : 'warn',
      message: !quadrupletsEnabled
        ? 'Quadruplet clusters were not requested; set quadrupletCutoffA to enable the bounded local four-site objective'
        : quadrupletClusters.length === 0
          ? 'No complete four-site figures exist inside quadrupletCutoffA'
          : quadrupletsNearIdeal
            ? 'Quadruplet correlations are near the finite-cell random target'
            : 'Quadruplet correlations exceed the near-ideal threshold; inspect metrics or enlarge/search longer',
      metrics: {
        objective: quality.quadrupletObjective,
        maxAbsQuadrupletError: quality.maxAbsQuadrupletError,
        quadrupletClusterCount: quadrupletClusters.length,
        quadrupletFigureCount,
        quadrupletCandidateCount: quadrupletBuild.candidateCount,
      },
    },
    {
      id: 'sqs.cluster_space_scope',
      status: 'warn',
      message: quadrupletsEnabled
        ? 'The built-in cluster space stops at bounded complete four-site figures; it does not establish complete cluster-space or cluster-expansion convergence'
        : tripletsEnabled
          ? 'The built-in cluster space stops at bounded pair and triangle figures; enable bounded quadruplets or use an icet/ATAT provider for systematic convergence'
          : 'The built-in fast path assesses pair shells only; enable bounded triplets/quadruplets or use an icet/ATAT provider for a converged higher-order cluster space',
      metrics: {
        maximumClusterOrder: maximumAssessedClusterOrder,
        pairClusterCount: pairClusters.length,
        tripletClusterCount: tripletClusters.length,
        quadrupletClusterCount: quadrupletClusters.length,
      },
    },
    {
      id: 'sqs.shells_inside_half_cell',
      status: pairClusters.length + tripletClusters.length + quadrupletClusters.length === 0 ? 'skipped' : shellsInsideHalfCell ? 'pass' : 'warn',
      message: pairClusters.length + tripletClusters.length + quadrupletClusters.length === 0
        ? 'No pair shells, triangle sides, or quadruplet edges were available for a finite-cell independence check'
        : shellsInsideHalfCell
          ? 'Every assessed pair shell, triangle side, and quadruplet edge lies inside half the shortest sampled periodic translation'
          : 'At least one assessed pair shell, triangle side, or quadruplet edge touches the finite-cell image boundary; enlarge the supercell for an independent-cluster assessment',
      metrics: { furthestAssessedShellA, shortestPeriodicTranslationA: shortestTranslationA },
    },
  ]

  const changedBounds = boundsOfPositions(relabeledPositions)
  const inspectionTargets: InspectionTarget[] = changedBounds
    ? [{
        id: 'sqs-relabeled-sites',
        reason: `Inspect ${relabeledCount.toLocaleString()} sites whose species changed`,
        center: changedBounds.center,
        radius: Math.max(1, changedBounds.radius),
        atomIds: relabeled.slice(0, 80).map((entry) => entry.atomId),
        atomIdsTruncated: relabeledCount > 80,
      }]
    : []
  inspectionTargets.push(...validation.inspectionTargets)

  const changeSet: StructureChangeSet = {
    kind: scaling[0] * scaling[1] * scaling[2] > 1 ? 'create' : 'relabel',
    sourceAtomCount: options.structure.atoms.length,
    resultAtomCount: structure.atoms.length,
    relabeledCount,
    relabeled,
    relabeledTruncated: relabeledCount > relabeled.length,
    maxPositionDisplacementA: 0,
    changedBounds,
  }
  const searchAlgorithm = quadrupletsEnabled && tripletsEnabled
    ? 'zatom-pair-triplet-quadruplet-anneal'
    : quadrupletsEnabled
      ? 'zatom-pair-quadruplet-anneal'
    : tripletsEnabled ? 'zatom-pair-triplet-anneal' : 'zatom-pair-anneal'
  const provenance: StructureProvenance = {
    engine: searchAlgorithm,
    engineVersion: '3.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    seed,
    parameters: {
      supercell: scaling as unknown as JsonValue,
      shellCount,
      shellToleranceA,
      clusterSpace: quadrupletsEnabled && tripletsEnabled
        ? 'pairs-triangles-and-bounded-complete-quadruplets'
        : quadrupletsEnabled
          ? 'pairs-and-bounded-complete-quadruplets'
        : tripletsEnabled ? 'pairs-and-bounded-triangles' : 'pairs-only',
      tripletCutoffA,
      tripletWeight: tripletsEnabled ? tripletWeight : null,
      maxTripletFigures: tripletsEnabled ? maxTripletFigures : null,
      maxTripletSearchSites: tripletsEnabled ? maxTripletSearchSites : null,
      quadrupletCutoffA,
      quadrupletWeight: quadrupletsEnabled ? quadrupletWeight : null,
      maxQuadrupletFigures: quadrupletsEnabled ? maxQuadrupletFigures : null,
      maxQuadrupletCandidates: quadrupletsEnabled ? maxQuadrupletCandidates : null,
      maxQuadrupletSearchSites: quadrupletsEnabled ? maxQuadrupletSearchSites : null,
      ensembleSize,
      ensembleSeeds: ensembleSeeds as unknown as JsonValue,
      selectedSeed: selectedRun.seed,
      restarts,
      stepsPerRestart,
      maxSearchEvaluations: rawMaxSearchEvaluations,
      maxObjectiveTermEvaluations: rawMaxObjectiveTermEvaluations,
      sublattices: sublattices.map((sub) => ({
        id: sub.id,
        siteElements: [...sub.siteElements],
        siteAtomIds: [...sub.siteAtomIds],
        composition: sub.composition,
      })) as unknown as JsonValue,
    },
  }

  return {
    structure,
    quality,
    validation,
    checks,
    changeSet,
    provenance,
    search: {
      algorithm: searchAlgorithm,
      seed,
      selectedSeed: selectedRun.seed,
      ensembleSize,
      restarts,
      stepsPerRestart,
      evaluations,
      acceptedMoves,
      initialObjective,
      finalObjective: bestObjective,
      mutableSiteCount,
      clusterCount: pairClusters.length + tripletClusters.length + quadrupletClusters.length,
      pairClusterCount: pairClusters.length,
      tripletClusterCount: tripletClusters.length,
      quadrupletClusterCount: quadrupletClusters.length,
      tripletFigureCount,
      quadrupletFigureCount,
      quadrupletCandidateCount: quadrupletBuild.candidateCount,
      pairFigureCount,
      projectedEvaluationBudget,
      projectedObjectiveTermEvaluations,
      ensemble,
    },
    inspectionTargets,
  }
}
