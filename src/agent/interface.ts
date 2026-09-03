/** Diagonal in-plane supercell matching and candidate-first interface stacking. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomStructureAtom,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { applyStructureOperations, buildStructureChangeSet } from './operations'
import { partitionInterfaceReferenceSet } from './interface-reference-set'
import {
  boundsOfPositions,
  cartesianToFractional,
  createDistanceCalculator,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { validateStructure } from './structure-validation'

export type InPlaneRepeat = [number, number]

export interface InterfaceMatchMetrics {
  bottomRepeat: InPlaneRepeat
  topRepeat: InPlaneRepeat
  bottomLengthsA: [number, number]
  topLengthsA: [number, number]
  strainTopA: number
  strainTopB: number
  areaStrainTop: number
  bottomAngleDeg: number
  topAngleDeg: number
  angleMismatchDeg: number
  maxAbsLinearStrain: number
  bottomAtomCount: number
  topAtomCount: number
  totalAtomCount: number
  withinTolerance: boolean
  geometricScore: number
}

export interface InterfaceMatchCandidate extends InterfaceMatchMetrics {
  id: string
  rankScore: number
}

export interface FindInterfaceMatchesOptions {
  bottom: ZatomStructure
  top: ZatomStructure
  maxRepeat?: number
  maxOutputAtoms?: number
  maxStrain?: number
  maxAngleMismatchDeg?: number
  limit?: number
}

export interface FindInterfaceMatchesResult {
  candidates: InterfaceMatchCandidate[]
  recommended: InterfaceMatchCandidate
  totalCandidateCount: number
  paretoCandidateCount: number
  truncated: boolean
  checks: ValidationCheck[]
}

export interface BuildInterfaceOptions {
  bottom: ZatomStructure
  top: ZatomStructure
  bottomRepeat?: InPlaneRepeat
  topRepeat?: InPlaneRepeat
  maxRepeat?: number
  maxOutputAtoms?: number
  maxStrain?: number
  maxAngleMismatchDeg?: number
  gapA?: number
  vacuumA?: number
  registryOffsetFractional?: [number, number]
  collisionDistanceA?: number
  maxCrossPairs?: number
}

export interface BuildInterfaceResult {
  structure: ZatomStructure
  referenceStructures: { bottom: ZatomStructure; top: ZatomStructure }
  referenceFingerprints: { bottom: string; top: string }
  referenceSetFingerprint: string
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  match: InterfaceMatchMetrics
  metrics: {
    requestedGapA: number
    measuredGapA: number
    requestedVacuumA: number
    measuredVacuumA: number
    bottomThicknessA: number
    topThicknessA: number
    minimumCrossInterfaceDistanceA: number | null
    crossPairScanSkipped: boolean
  }
}

export class InterfaceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InterfaceInputError'
    this.code = code
  }
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function scale(value: readonly number[], factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function combine(a: readonly number[], aScale: number, b: readonly number[], bScale: number, n: readonly number[], nScale: number): Vec3 {
  return [
    a[0] * aScale + b[0] * bScale + n[0] * nScale,
    a[1] * aScale + b[1] * bScale + n[1] * nScale,
    a[2] * aScale + b[2] * bScale + n[2] * nScale,
  ]
}

function unit(value: readonly number[], field: string): Vec3 {
  const length = norm(value)
  if (!Number.isFinite(length) || length < 1e-10) throw new InterfaceInputError('degenerate_inplane_cell', `${field} is degenerate`)
  return scale(value, 1 / length)
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const denominator = norm(a) * norm(b)
  if (!Number.isFinite(denominator) || denominator < 1e-12) throw new InterfaceInputError('degenerate_inplane_cell', 'In-plane lattice vectors must be non-zero')
  const cosine = Math.max(-1, Math.min(1, dot(a, b) / denominator))
  return Math.acos(cosine) * 180 / Math.PI
}

function wrap01(value: number): number {
  return value - Math.floor(value)
}

function positiveFinite(value: number, field: string, allowZero = false): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new InterfaceInputError('invalid_parameter', `${field} must be finite and ${allowZero ? 'non-negative' : 'greater than zero'}`)
  }
  return value
}

function integerInRange(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new InterfaceInputError('invalid_parameter', `${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function validateRepeat(value: InPlaneRepeat, field: string): InPlaneRepeat {
  if (!Array.isArray(value) || value.length !== 2) throw new InterfaceInputError('invalid_repeat', `${field} must contain two positive integers`)
  return [
    integerInRange(value[0], `${field}[0]`, 1, 64),
    integerInRange(value[1], `${field}[1]`, 1, 64),
  ]
}

function requireSlab(structure: ZatomStructure, field: string): NonNullable<ZatomStructure['lattice']> {
  const validation = validateStructure(structure, { requirePeriodic: true })
  if (validation.verdict === 'fail' || !structure.lattice) {
    throw new InterfaceInputError('invalid_source_structure', `${field} must be a numerically valid periodic structure`)
  }
  if (!structure.lattice.periodic[0] || !structure.lattice.periodic[1]) {
    throw new InterfaceInputError('inplane_periodicity_required', `${field} must be periodic along lattice axes a and b`)
  }
  unit(cross(structure.lattice.vectors[0], structure.lattice.vectors[1]), `${field} a×b`)
  return structure.lattice
}

function matchMetrics(
  bottom: ZatomStructure,
  top: ZatomStructure,
  bottomRepeat: InPlaneRepeat,
  topRepeat: InPlaneRepeat,
  maxStrain: number,
  maxAngleMismatchDeg: number,
): InterfaceMatchMetrics {
  // Public callers validate both structures once before entering a potentially
  // large repeat search; avoid repeating O(N²) distance validation per tuple.
  const bottomLattice = bottom.lattice!
  const topLattice = top.lattice!
  const bottomA = scale(bottomLattice.vectors[0], bottomRepeat[0])
  const bottomB = scale(bottomLattice.vectors[1], bottomRepeat[1])
  const topA = scale(topLattice.vectors[0], topRepeat[0])
  const topB = scale(topLattice.vectors[1], topRepeat[1])
  const bottomLengthsA: [number, number] = [norm(bottomA), norm(bottomB)]
  const topLengthsA: [number, number] = [norm(topA), norm(topB)]
  const strainTopA = bottomLengthsA[0] / topLengthsA[0] - 1
  const strainTopB = bottomLengthsA[1] / topLengthsA[1] - 1
  const bottomArea = norm(cross(bottomA, bottomB))
  const topArea = norm(cross(topA, topB))
  const areaStrainTop = bottomArea / topArea - 1
  const bottomAngleDeg = angleDeg(bottomA, bottomB)
  const topAngleDeg = angleDeg(topA, topB)
  const angleMismatchDeg = bottomAngleDeg - topAngleDeg
  const maxAbsLinearStrain = Math.max(Math.abs(strainTopA), Math.abs(strainTopB))
  const withinTolerance = maxAbsLinearStrain <= maxStrain + 1e-12
    && Math.abs(angleMismatchDeg) <= maxAngleMismatchDeg + 1e-12
  const bottomAtomCount = bottom.atoms.length * bottomRepeat[0] * bottomRepeat[1]
  const topAtomCount = top.atoms.length * topRepeat[0] * topRepeat[1]
  return {
    bottomRepeat,
    topRepeat,
    bottomLengthsA,
    topLengthsA,
    strainTopA,
    strainTopB,
    areaStrainTop,
    bottomAngleDeg,
    topAngleDeg,
    angleMismatchDeg,
    maxAbsLinearStrain,
    bottomAtomCount,
    topAtomCount,
    totalAtomCount: bottomAtomCount + topAtomCount,
    withinTolerance,
    geometricScore: maxAbsLinearStrain + Math.abs(angleMismatchDeg) * Math.PI / 180,
  }
}

export function findDiagonalInterfaceMatches(options: FindInterfaceMatchesOptions): FindInterfaceMatchesResult {
  requireSlab(options.bottom, 'bottom')
  requireSlab(options.top, 'top')
  const maxRepeat = integerInRange(options.maxRepeat ?? 8, 'maxRepeat', 1, 16)
  const maxOutputAtoms = integerInRange(options.maxOutputAtoms ?? 20_000, 'maxOutputAtoms', 2, 100_000)
  const maxStrain = positiveFinite(options.maxStrain ?? 0.05, 'maxStrain', true)
  const maxAngleMismatchDeg = positiveFinite(options.maxAngleMismatchDeg ?? 1, 'maxAngleMismatchDeg', true)
  const limit = integerInRange(options.limit ?? 20, 'limit', 1, 100)
  const all: InterfaceMatchCandidate[] = []

  for (let bottomA = 1; bottomA <= maxRepeat; bottomA++) {
    for (let bottomB = 1; bottomB <= maxRepeat; bottomB++) {
      for (let topA = 1; topA <= maxRepeat; topA++) {
        for (let topB = 1; topB <= maxRepeat; topB++) {
          const metrics = matchMetrics(
            options.bottom,
            options.top,
            [bottomA, bottomB],
            [topA, topB],
            maxStrain,
            maxAngleMismatchDeg,
          )
          if (metrics.totalAtomCount > maxOutputAtoms) continue
          all.push({
            ...metrics,
            id: `b${bottomA}x${bottomB}-t${topA}x${topB}`,
            rankScore: metrics.geometricScore + 0.002 * metrics.totalAtomCount / maxOutputAtoms,
          })
        }
      }
    }
  }
  if (!all.length) throw new InterfaceInputError('no_match_candidates', 'No diagonal supercell candidate fits maxRepeat and maxOutputAtoms')

  const bySize = [...all].sort((a, b) => a.totalAtomCount - b.totalAtomCount || a.geometricScore - b.geometricScore)
  const pareto: InterfaceMatchCandidate[] = []
  let bestGeometry = Infinity
  for (const candidate of bySize) {
    if (candidate.geometricScore < bestGeometry - 1e-12) {
      pareto.push(candidate)
      bestGeometry = candidate.geometricScore
    }
  }
  pareto.sort((a, b) => {
    if (a.withinTolerance !== b.withinTolerance) return a.withinTolerance ? -1 : 1
    return a.rankScore - b.rankScore || a.totalAtomCount - b.totalAtomCount
  })
  const candidates = pareto.slice(0, limit)
  const recommended = candidates[0]
  const acceptedCount = all.filter((candidate) => candidate.withinTolerance).length
  const checks: ValidationCheck[] = [
    {
      id: 'interface.match_found',
      status: acceptedCount ? 'pass' : 'fail',
      message: acceptedCount
        ? `Found ${acceptedCount.toLocaleString()} diagonal matches within strain/angle tolerances`
        : `No diagonal match satisfies maxStrain=${maxStrain} and maxAngleMismatchDeg=${maxAngleMismatchDeg}`,
      metrics: { acceptedCount, totalCandidateCount: all.length, maxStrain, maxAngleMismatchDeg },
    },
    {
      id: 'interface.match_recommendation',
      status: recommended.withinTolerance ? 'pass' : 'warn',
      message: `Recommended ${recommended.id}: max |linear strain| ${(100 * recommended.maxAbsLinearStrain).toFixed(3)}%, angle mismatch ${recommended.angleMismatchDeg.toFixed(3)}°, ${recommended.totalAtomCount} atoms`,
      metrics: {
        maxAbsLinearStrain: recommended.maxAbsLinearStrain,
        angleMismatchDeg: recommended.angleMismatchDeg,
        totalAtomCount: recommended.totalAtomCount,
      },
    },
    {
      id: 'interface.diagonal_search_scope',
      status: 'warn',
      message: 'Built-in matching searches diagonal a/b repeats only; rotated or off-diagonal coincidence lattices require a general 2D lattice-matching provider',
    },
  ]
  return {
    candidates,
    recommended,
    totalCandidateCount: all.length,
    paretoCandidateCount: pareto.length,
    truncated: candidates.length < pareto.length,
    checks,
  }
}

function replicated(structure: ZatomStructure, repeat: InPlaneRepeat, maxOutputAtoms: number): ZatomStructure {
  return applyStructureOperations({
    structure,
    operations: [{ op: 'supercell', scaling: [repeat[0], repeat[1], 1] }],
    maxOutputAtoms,
  }).structure
}

function projectionRange(structure: ZatomStructure, normal: Vec3): { min: number; max: number; thickness: number } {
  const projections = structure.atoms.map((atom) => dot(atom.position, normal))
  const min = Math.min(...projections)
  const max = Math.max(...projections)
  return { min, max, thickness: max - min }
}

function mapLayer(options: {
  structure: ZatomStructure
  sourceA: Vec3
  sourceB: Vec3
  sourceNormal: Vec3
  targetA: Vec3
  targetB: Vec3
  targetNormal: Vec3
  startHeightA: number
  offset: [number, number]
  prefix: 'bottom' | 'top'
}): ZatomStructureAtom[] {
  const sourceBasis: Mat3 = [options.sourceA, options.sourceB, options.sourceNormal]
  const range = projectionRange(options.structure, options.sourceNormal)
  return options.structure.atoms.map((atom) => {
    const coefficients = cartesianToFractional(atom.position, sourceBasis)
    if (!coefficients) throw new InterfaceInputError('degenerate_inplane_cell', `Could not invert ${options.prefix} in-plane basis`)
    const fa = wrap01(coefficients[0] + options.offset[0])
    const fb = wrap01(coefficients[1] + options.offset[1])
    const localHeight = dot(atom.position, options.sourceNormal) - range.min
    return {
      ...atom,
      id: `${options.prefix}:${atom.id}`,
      position: combine(options.targetA, fa, options.targetB, fb, options.targetNormal, options.startHeightA + localHeight),
      properties: {
        ...(atom.properties ?? {}),
        'zatom.interfaceLayer': options.prefix,
        'zatom.sourceAtomId': atom.id,
      },
    }
  })
}

function prefixedSource(bottom: ZatomStructure, top: ZatomStructure): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${bottom.label ?? 'bottom'} | ${top.label ?? 'top'} sources`,
    atoms: [
      ...bottom.atoms.map((atom) => ({ ...atom, id: `bottom:${atom.id}`, position: [...atom.position] as Vec3 })),
      ...top.atoms.map((atom) => ({ ...atom, id: `top:${atom.id}`, position: [...atom.position] as Vec3 })),
    ],
    ...((bottom.bonds || top.bonds) ? {
      bonds: [
        ...(bottom.bonds ?? []).map((bond) => ({
          ...bond,
          id: `bottom:${bond.id}`,
          atomIds: [`bottom:${bond.atomIds[0]}`, `bottom:${bond.atomIds[1]}`] as [string, string],
        })),
        ...(top.bonds ?? []).map((bond) => ({
          ...bond,
          id: `top:${bond.id}`,
          atomIds: [`top:${bond.atomIds[0]}`, `top:${bond.atomIds[1]}`] as [string, string],
        })),
      ],
    } : {}),
  }
}

function minimumCrossDistance(
  bottomAtoms: readonly ZatomStructureAtom[],
  topAtoms: readonly ZatomStructureAtom[],
  lattice: NonNullable<ZatomStructure['lattice']>,
  maxPairs: number,
): { distanceA: number | null; skipped: boolean } {
  if (bottomAtoms.length * topAtoms.length > maxPairs) return { distanceA: null, skipped: true }
  const distanceBetween = createDistanceCalculator({ ...lattice, periodic: [true, true, false] })
  let best = Infinity
  for (const bottom of bottomAtoms) for (const top of topAtoms) {
    best = Math.min(best, distanceBetween(bottom.position, top.position))
  }
  return { distanceA: Number.isFinite(best) ? best : null, skipped: false }
}

export function buildMatchedInterface(options: BuildInterfaceOptions): BuildInterfaceResult {
  const bottomLattice = requireSlab(options.bottom, 'bottom')
  const topLattice = requireSlab(options.top, 'top')
  const maxOutputAtoms = integerInRange(options.maxOutputAtoms ?? 20_000, 'maxOutputAtoms', 2, 100_000)
  const maxStrain = positiveFinite(options.maxStrain ?? 0.05, 'maxStrain', true)
  const maxAngleMismatchDeg = positiveFinite(options.maxAngleMismatchDeg ?? 1, 'maxAngleMismatchDeg', true)
  if (!!options.bottomRepeat !== !!options.topRepeat) {
    throw new InterfaceInputError('ambiguous_match', 'Provide both bottomRepeat and topRepeat, or neither for automatic matching')
  }
  let bottomRepeat: InPlaneRepeat
  let topRepeat: InPlaneRepeat
  if (options.bottomRepeat && options.topRepeat) {
    bottomRepeat = validateRepeat(options.bottomRepeat, 'bottomRepeat')
    topRepeat = validateRepeat(options.topRepeat, 'topRepeat')
  } else {
    const match = findDiagonalInterfaceMatches({
      bottom: options.bottom,
      top: options.top,
      maxRepeat: options.maxRepeat,
      maxOutputAtoms,
      maxStrain,
      maxAngleMismatchDeg,
      limit: 1,
    })
    bottomRepeat = match.recommended.bottomRepeat
    topRepeat = match.recommended.topRepeat
  }
  const match = matchMetrics(options.bottom, options.top, bottomRepeat, topRepeat, maxStrain, maxAngleMismatchDeg)
  if (match.totalAtomCount > maxOutputAtoms) {
    throw new InterfaceInputError('output_too_large', `Interface would contain ${match.totalAtomCount.toLocaleString()} atoms (limit ${maxOutputAtoms.toLocaleString()})`)
  }
  const gapA = positiveFinite(options.gapA ?? 3, 'gapA')
  const vacuumA = positiveFinite(options.vacuumA ?? 12, 'vacuumA', true)
  const collisionDistanceA = positiveFinite(options.collisionDistanceA ?? 0.6, 'collisionDistanceA')
  const maxCrossPairs = integerInRange(options.maxCrossPairs ?? 2_000_000, 'maxCrossPairs', 1, 100_000_000)
  const requestedOffset = options.registryOffsetFractional ?? [0, 0]
  if (!Array.isArray(requestedOffset) || requestedOffset.length !== 2 || requestedOffset.some((value) => !Number.isFinite(value))) {
    throw new InterfaceInputError('invalid_registry_offset', 'registryOffsetFractional must contain two finite numbers')
  }
  const offset: [number, number] = [wrap01(requestedOffset[0]), wrap01(requestedOffset[1])]

  const bottomSupercell = replicated(options.bottom, bottomRepeat, maxOutputAtoms)
  const topSupercell = replicated(options.top, topRepeat, maxOutputAtoms)
  const bottomA = scale(bottomLattice.vectors[0], bottomRepeat[0])
  const bottomB = scale(bottomLattice.vectors[1], bottomRepeat[1])
  const topA = scale(topLattice.vectors[0], topRepeat[0])
  const topB = scale(topLattice.vectors[1], topRepeat[1])
  const bottomNormal = unit(cross(bottomA, bottomB), 'bottom a×b')
  const topNormal = unit(cross(topA, topB), 'top a×b')
  const bottomRange = projectionRange(bottomSupercell, bottomNormal)
  const topRange = projectionRange(topSupercell, topNormal)
  const bottomStartA = vacuumA / 2
  const topStartA = bottomStartA + bottomRange.thickness + gapA
  const bottomAtoms = mapLayer({
    structure: bottomSupercell,
    sourceA: bottomA,
    sourceB: bottomB,
    sourceNormal: bottomNormal,
    targetA: bottomA,
    targetB: bottomB,
    targetNormal: bottomNormal,
    startHeightA: bottomStartA,
    offset: [0, 0],
    prefix: 'bottom',
  })
  const topAtoms = mapLayer({
    structure: topSupercell,
    sourceA: topA,
    sourceB: topB,
    sourceNormal: topNormal,
    targetA: bottomA,
    targetB: bottomB,
    targetNormal: bottomNormal,
    startHeightA: topStartA,
    offset,
    prefix: 'top',
  })
  const bottomBonds = (bottomSupercell.bonds ?? []).map((bond) => ({
      ...bond,
      id: `bottom:${bond.id}`,
      atomIds: [`bottom:${bond.atomIds[0]}`, `bottom:${bond.atomIds[1]}`] as [string, string],
    }))
  const topBonds = (topSupercell.bonds ?? []).map((bond) => ({
      ...bond,
      id: `top:${bond.id}`,
      atomIds: [`top:${bond.atomIds[0]}`, `top:${bond.atomIds[1]}`] as [string, string],
    }))
  const bonds = (bottomSupercell.bonds || topSupercell.bonds) ? [...bottomBonds, ...topBonds] : undefined
  const cellHeightA = bottomRange.thickness + gapA + topRange.thickness + vacuumA
  const lattice = {
    vectors: [bottomA, bottomB, scale(bottomNormal, cellHeightA)] as Mat3,
    periodic: [true, true, true] as [boolean, boolean, boolean],
  }
  const construction = {
    method: 'diagonal-inplane-match-stacked-interface',
    bottomSourceFingerprint: fingerprintStructure(options.bottom),
    topSourceFingerprint: fingerprintStructure(options.top),
    bottomRepeat: [...bottomRepeat],
    topRepeat: [...topRepeat],
    gapA,
    vacuumA,
    registryOffsetFractional: [...offset],
    maxStrain,
    maxAngleMismatchDeg,
  }
  const constructionFingerprint = fingerprintCanonicalJson(construction)
  const unboundStructure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${options.bottom.label ?? 'bottom'} | ${options.top.label ?? 'top'} interface`,
    lattice,
    atoms: [...bottomAtoms, ...topAtoms],
    ...(bonds ? { bonds } : {}),
    metadata: {
      'zatom.interface': {
        schemaVersion: 'zatom.interface/v1',
        constructionFingerprint,
        ...construction,
        bottomLabel: options.bottom.label ?? 'bottom',
        topLabel: options.top.label ?? 'top',
      },
    },
  }
  const referenceSet = partitionInterfaceReferenceSet({ interfaceStructure: unboundStructure })
  const structure = referenceSet.structure
  const referenceStructures = referenceSet.referenceStructures
  const referenceFingerprints = referenceSet.referenceFingerprints
  const bottomProjection = projectionRange({ ...structure, atoms: bottomAtoms }, bottomNormal)
  const topProjection = projectionRange({ ...structure, atoms: topAtoms }, bottomNormal)
  const measuredGapA = topProjection.min - bottomProjection.max
  const measuredVacuumA = cellHeightA - (topProjection.max - bottomProjection.min)
  const crossDistance = minimumCrossDistance(bottomAtoms, topAtoms, lattice, maxCrossPairs)
  const validation = referenceSet.validation
  const referenceValidationFailed = referenceSet.checks.some((check) => (
    check.id === 'interface_reference.reference_validation' && check.status === 'fail'
  ))
  const checks: ValidationCheck[] = [
    {
      id: 'interface.inplane_match',
      status: match.withinTolerance ? 'pass' : 'fail',
      message: match.withinTolerance
        ? `Top layer maps to the bottom cell with max |linear strain| ${(100 * match.maxAbsLinearStrain).toFixed(3)}% and angle mismatch ${match.angleMismatchDeg.toFixed(3)}°`
        : `Required top deformation exceeds maxStrain/maxAngleMismatchDeg (${(100 * match.maxAbsLinearStrain).toFixed(3)}%, ${match.angleMismatchDeg.toFixed(3)}°)`,
      metrics: {
        strainTopA: match.strainTopA,
        strainTopB: match.strainTopB,
        areaStrainTop: match.areaStrainTop,
        angleMismatchDeg: match.angleMismatchDeg,
        maxStrain,
        maxAngleMismatchDeg,
      },
    },
    {
      id: 'interface.gap',
      status: Math.abs(measuredGapA - gapA) <= 1e-6 ? 'pass' : 'fail',
      message: `Measured outer-plane gap is ${measuredGapA.toFixed(4)} Å (requested ${gapA.toFixed(4)} Å)`,
      metrics: { requestedGapA: gapA, measuredGapA },
    },
    {
      id: 'interface.cross_distance',
      status: crossDistance.skipped
        ? 'skipped'
        : crossDistance.distanceA !== null && crossDistance.distanceA >= collisionDistanceA
          ? 'pass'
          : 'fail',
      message: crossDistance.skipped
        ? `Cross-interface pair scan skipped above ${maxCrossPairs.toLocaleString()} pairs`
        : `Closest cross-interface pair is ${crossDistance.distanceA?.toFixed(4) ?? 'unavailable'} Å (minimum ${collisionDistanceA.toFixed(4)} Å)`,
      metrics: { minimumCrossInterfaceDistanceA: crossDistance.distanceA, collisionDistanceA, maxCrossPairs },
    },
    {
      id: 'interface.vacuum',
      status: measuredVacuumA + 1e-6 >= vacuumA ? 'pass' : 'fail',
      message: `Measured total outer vacuum is ${measuredVacuumA.toFixed(4)} Å (requested ${vacuumA.toFixed(4)} Å)`,
      metrics: { requestedVacuumA: vacuumA, measuredVacuumA },
    },
    {
      id: 'interface.reference_structures',
      status: referenceValidationFailed ? 'fail' : 'pass',
      message: referenceValidationFailed
        ? 'At least one same-cell isolated reference fails canonical structure validation'
        : `Emitted reference-set-bound same-cell bottom/top references with ${bottomAtoms.length}+${topAtoms.length} atoms for matched-model interface comparisons`,
      metrics: {
        bottomReferenceAtomCount: bottomAtoms.length,
        topReferenceAtomCount: topAtoms.length,
        interfaceAtomCount: structure.atoms.length,
        bottomReferenceFingerprint: referenceFingerprints.bottom,
        topReferenceFingerprint: referenceFingerprints.top,
        constructionFingerprint,
        referenceSetFingerprint: referenceSet.referenceSetFingerprint,
      },
    },
    {
      id: 'interface.match_scope',
      status: 'warn',
      message: 'The built-in engine applies a diagonal a/b supercell match and homogeneous top-layer in-plane deformation; it does not search rotated/off-diagonal coincidence lattices or relax the interface',
    },
    ...validation.checks,
  ]
  const source = prefixedSource(options.bottom, options.top)
  const changeSet = buildStructureChangeSet(source, structure)
  const interfaceBandAtoms = [
    ...bottomAtoms.filter((atom) => dot(atom.position, bottomNormal) >= bottomProjection.max - 0.75),
    ...topAtoms.filter((atom) => dot(atom.position, bottomNormal) <= topProjection.min + 0.75),
  ]
  const interfaceBounds = boundsOfPositions(interfaceBandAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = interfaceBounds ? [{
    id: 'stacked-interface',
    reason: 'Inspect registry, separation, and close pairs at the stacked interface',
    center: interfaceBounds.center,
    radius: Math.max(2, interfaceBounds.radius),
    atomIds: interfaceBandAtoms.slice(0, 80).map((atom) => atom.id),
    atomIdsTruncated: interfaceBandAtoms.length > 80,
  }] : []
  inspectionTargets.push(...validation.inspectionTargets)
  const provenance: StructureProvenance = {
    engine: 'zatom-diagonal-interface',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      bottomFingerprint: fingerprintStructure(options.bottom),
      topFingerprint: fingerprintStructure(options.top),
      bottomRepeat,
      topRepeat,
      gapA,
      vacuumA,
      registryOffsetFractional: offset,
      maxStrain,
      maxAngleMismatchDeg,
      collisionDistanceA,
      constructionFingerprint,
      referenceSetFingerprint: referenceSet.referenceSetFingerprint,
      bottomReferenceFingerprint: referenceFingerprints.bottom,
      topReferenceFingerprint: referenceFingerprints.top,
    } as Record<string, JsonValue>,
  }
  return {
    structure,
    referenceStructures,
    referenceFingerprints,
    referenceSetFingerprint: referenceSet.referenceSetFingerprint,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    match,
    metrics: {
      requestedGapA: gapA,
      measuredGapA,
      requestedVacuumA: vacuumA,
      measuredVacuumA,
      bottomThicknessA: bottomRange.thickness,
      topThicknessA: topRange.thickness,
      minimumCrossInterfaceDistanceA: crossDistance.distanceA,
      crossPairScanSkipped: crossDistance.skipped,
    },
  }
}
