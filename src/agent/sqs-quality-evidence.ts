/** Canonical, structure-bound evidence for special-quasirandom-structure quality. */

import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  InspectionTarget,
  JsonValue,
  ValidationCheck,
  ZatomStructure,
} from './contracts'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  distance,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'

export const ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA = 'zatom.sqs-quality-evidence/v1' as const

export type ZatomSqsClusterVectorBasis =
  | 'finite-cell-occupation-distributions'
  | 'icet-orthogonal-cluster-vector'

export interface ZatomSqsQualitySublattice {
  id: string
  atomIds: string[]
  allowedSpecies: string[]
  requestedFractions: Record<string, number>
  realizedCounts: Record<string, number>
  realizedFractions: Record<string, number>
  maximumFractionError: number
}

export interface ZatomSqsClusterVectorComponent {
  index: number
  orbitIndex: number
  order: number
  radiusA: number
  multiplicity: number
  multicomponentVector: string
  sublattices: string[]
  target: number
  actual: number
  absoluteError: number
  representativeAtomIds?: string[]
}

export interface ZatomSqsQualityEvidence {
  schemaVersion: typeof ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  resultStructureFingerprint: string
  clusterSpaceFingerprint: string
  occupation: {
    mode: 'relabel-only'
    sublattices: ZatomSqsQualitySublattice[]
  }
  clusterSpace: {
    basis: ZatomSqsClusterVectorBasis
    symmetry: {
      kind: 'local-geometric-canonicalization' | 'space-group-orbits'
      spaceGroup?: string
      symprecA?: number
      positionToleranceA?: number
    }
    cutoffsA: number[]
    maximumOrder: number
    completeThroughDeclaredCutoffs: boolean
    componentCount: number
    componentCountByOrder: Record<string, number>
    orbitCountByOrder: Record<string, number>
    components: ZatomSqsClusterVectorComponent[]
  }
  objective: {
    kind: 'mean-square-cluster-vector' | 'walle-2013-cluster-vector'
    value: number
    tolerance: number
    optimalityWeight?: number
  }
  acceptance: {
    maximumCompositionFractionError: number
    maximumAbsoluteClusterError: number
    maximumRmsClusterError: number
    requireCompleteThroughDeclaredCutoffs: boolean
  }
  metrics: {
    maximumCompositionFractionError: number
    maximumAbsoluteClusterError: number
    meanAbsoluteClusterError: number
    rmsClusterError: number
    perfectComponentCount: number
    longestPerfectPairRadiusA: number
  }
  search: {
    algorithm: string
    seed: number
    deterministic: boolean
    exhaustive: boolean
    steps: number
    candidateCount: number
    selectedCandidateIndex: number
    scopeWarning: string
  }
  provenance: {
    engine: string
    engineVersion: string
    method: string
    artifacts: Array<{
      id: string
      role: string
      fingerprint: string
    }>
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ComposeZatomSqsQualityEvidenceInput {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  occupation: ZatomSqsQualityEvidence['occupation']
  clusterSpace: Omit<ZatomSqsQualityEvidence['clusterSpace'], 'componentCount' | 'componentCountByOrder' | 'orbitCountByOrder'>
  objective: ZatomSqsQualityEvidence['objective']
  acceptance: ZatomSqsQualityEvidence['acceptance']
  search: ZatomSqsQualityEvidence['search']
  provenance: ZatomSqsQualityEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomSqsQualityEvidenceOptions {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  maxSublattices?: number
  maxMutableSites?: number
  maxComponents?: number
  maxRepresentativeAtomReferences?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomSqsQualityEvidenceValidation {
  evidence: ZatomSqsQualityEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomSqsQualityEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomSqsQualityEvidenceInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactObject(
  value: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/\[\], -]+$/.test(result)) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function finiteNumber(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function safeInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence_context',
      `${field} must be a positive safe integer`,
    )
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]),
    )
  }
  throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `${field} is not JSON-safe`)
}


function utf8ByteLength(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}

export function fingerprintSqsQualityEvidence(value: ZatomSqsQualityEvidence): string {
  return fingerprintCanonicalJson(value)
}

function canonicalElement(value: unknown, field: string): string {
  const raw = token(value, field, 8)
  const result = raw[0].toUpperCase() + raw.slice(1).toLowerCase()
  if (symbolToAtomicNumber(result) <= 0) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `${field} uses unknown element ${JSON.stringify(value)}`,
    )
  }
  return result
}

function exactNumericRecord(
  value: unknown,
  field: string,
  keys: readonly string[],
  options: { integer?: boolean; minimum?: number; maximum?: number } = {},
): Record<string, number> {
  const record = exactObject(value, field, keys)
  const result: Record<string, number> = {}
  for (const key of keys) {
    result[key] = options.integer
      ? safeInteger(record[key], `${field}.${key}`, options.minimum ?? 0, options.maximum ?? 1_000_000_000)
      : finiteNumber(record[key], `${field}.${key}`, options.minimum ?? 0, options.maximum ?? 1)
  }
  return result
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJsonIdentity(left) === canonicalJsonIdentity(right)
}

function validateRelabelOnly(source: ZatomStructure, result: ZatomStructure): number {
  if (source.atoms.length !== result.atoms.length) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_structure_mismatch',
      'SQS relabel-only evidence requires identical source/result atom counts',
    )
  }
  if (!source.lattice || !result.lattice || !source.lattice.periodic.some(Boolean)) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_periodic_structure_required',
      'SQS quality evidence requires periodic source and result lattices',
    )
  }
  if (!sameJson(source.lattice, result.lattice) || !sameJson(source.bonds ?? [], result.bonds ?? [])) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_structure_mismatch',
      'SQS relabel-only evidence requires exact lattice, periodicity, and bond preservation',
    )
  }
  let maximumDisplacementA = 0
  for (let index = 0; index < source.atoms.length; index++) {
    const before = source.atoms[index]
    const after = result.atoms[index]
    if (before.id !== after.id || !sameJson(before.properties ?? {}, after.properties ?? {})) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_structure_mismatch',
        `SQS relabel-only evidence changed atom order, ID, or properties at index ${index}`,
      )
    }
    const displacementA = distance(before.position, after.position)
    maximumDisplacementA = Math.max(maximumDisplacementA, displacementA)
    if (displacementA > 1e-10) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_structure_mismatch',
        `SQS relabel-only evidence moved atom ${before.id} by ${displacementA} A`,
      )
    }
  }
  return maximumDisplacementA
}

function orderCount(components: readonly ZatomSqsClusterVectorComponent[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const component of components) {
    const key = String(component.order)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => Number(left) - Number(right)))
}

function orbitOrderCount(components: readonly ZatomSqsClusterVectorComponent[]): Record<string, number> {
  const byOrder = new Map<number, Set<number>>()
  for (const component of components) {
    const set = byOrder.get(component.order) ?? new Set<number>()
    set.add(component.orbitIndex)
    byOrder.set(component.order, set)
  }
  return Object.fromEntries([...byOrder.entries()].sort(([left], [right]) => left - right).map(
    ([order, orbits]) => [String(order), orbits.size],
  ))
}

function computeMetrics(
  sublattices: readonly ZatomSqsQualitySublattice[],
  components: readonly ZatomSqsClusterVectorComponent[],
  tolerance: number,
): ZatomSqsQualityEvidence['metrics'] {
  const errors = components.map((component) => component.absoluteError)
  let longestPerfectPairRadiusA = 0
  for (const component of components) {
    if (component.order !== 2) continue
    if (component.absoluteError < tolerance) longestPerfectPairRadiusA = component.radiusA
    else break
  }
  return {
    maximumCompositionFractionError: sublattices.reduce(
      (maximum, item) => Math.max(maximum, item.maximumFractionError),
      0,
    ),
    maximumAbsoluteClusterError: errors.reduce((maximum, error) => Math.max(maximum, error), 0),
    meanAbsoluteClusterError: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    rmsClusterError: Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length),
    perfectComponentCount: errors.filter((value) => value < tolerance).length,
    longestPerfectPairRadiusA,
  }
}

function expectedObjective(
  objective: ZatomSqsQualityEvidence['objective'],
  components: readonly ZatomSqsClusterVectorComponent[],
  metrics: ZatomSqsQualityEvidence['metrics'],
): number {
  if (objective.kind === 'mean-square-cluster-vector') {
    return components.reduce((sum, component) => sum + component.absoluteError ** 2, 0) / components.length
  }
  return components.reduce((sum, component) => sum + component.absoluteError, 0)
    - (objective.optimalityWeight ?? 0) * metrics.longestPerfectPairRadiusA
}

function close(left: number, right: number, tolerance = 1e-10): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

export function parseZatomSqsQualityEvidence(
  value: unknown,
  options: ParseZatomSqsQualityEvidenceOptions,
): ZatomSqsQualityEvidenceValidation {
  const maxSublattices = positiveBudget(options.maxSublattices, 128, 'maxSublattices')
  const maxMutableSites = positiveBudget(options.maxMutableSites, 100_000, 'maxMutableSites')
  const maxComponents = positiveBudget(options.maxComponents, 100_000, 'maxComponents')
  const maxRepresentativeAtomReferences = positiveBudget(
    options.maxRepresentativeAtomReferences,
    1_000_000,
    'maxRepresentativeAtomReferences',
  )
  const maxMetadataBytes = positiveBudget(options.maxMetadataBytes, 4 * 1024 * 1024, 'maxMetadataBytes')
  const maxArtifactBytes = positiveBudget(options.maxArtifactBytes, 128 * 1024 * 1024, 'maxArtifactBytes')
  const maximumDisplacementA = validateRelabelOnly(options.sourceStructure, options.resultStructure)
  const sourceStructureFingerprint = fingerprintStructure(options.sourceStructure)
  const resultStructureFingerprint = fingerprintStructure(options.resultStructure)

  const root = exactObject(value, 'sqsQualityEvidence', [
    'schemaVersion',
    'sourceStructureFingerprint',
    'resultStructureFingerprint',
    'clusterSpaceFingerprint',
    'occupation',
    'clusterSpace',
    'objective',
    'acceptance',
    'metrics',
    'search',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      `schemaVersion must be ${ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA}`,
    )
  }
  if (root.sourceStructureFingerprint !== sourceStructureFingerprint
    || root.resultStructureFingerprint !== resultStructureFingerprint) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_fingerprint_mismatch',
      'SQS evidence source/result fingerprints do not match the exact supplied structures',
    )
  }

  const resultAtomOrder = new Map(options.resultStructure.atoms.map((atom, index) => [atom.id, index]))
  const sourceAtomById = new Map(options.sourceStructure.atoms.map((atom) => [atom.id, atom]))
  const resultAtomById = new Map(options.resultStructure.atoms.map((atom) => [atom.id, atom]))
  const rawOccupation = exactObject(root.occupation, 'sqsQualityEvidence.occupation', ['mode', 'sublattices'])
  if (rawOccupation.mode !== 'relabel-only') {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'sqsQualityEvidence.occupation.mode must be relabel-only',
    )
  }
  if (!Array.isArray(rawOccupation.sublattices)
    || rawOccupation.sublattices.length < 1
    || rawOccupation.sublattices.length > maxSublattices) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_budget_exceeded',
      `occupation.sublattices must contain 1-${maxSublattices} entries`,
    )
  }
  const occupiedAtomIds = new Set<string>()
  const sublatticeIds = new Set<string>()
  let mutableSiteCount = 0
  const sublattices: ZatomSqsQualitySublattice[] = rawOccupation.sublattices.map((raw, index) => {
    const item = exactObject(raw, `occupation.sublattices[${index}]`, [
      'id',
      'atomIds',
      'allowedSpecies',
      'requestedFractions',
      'realizedCounts',
      'realizedFractions',
      'maximumFractionError',
    ])
    const id = token(item.id, `occupation.sublattices[${index}].id`)
    if (sublatticeIds.has(id)) {
      throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `Duplicate sublattice ID ${id}`)
    }
    sublatticeIds.add(id)
    if (!Array.isArray(item.atomIds) || item.atomIds.length < 1) {
      throw new ZatomSqsQualityEvidenceInputError(
        'invalid_sqs_quality_evidence',
        `occupation.sublattices[${index}].atomIds must be non-empty`,
      )
    }
    const atomIds = item.atomIds.map((atomId, atomIndex) => token(
      atomId,
      `occupation.sublattices[${index}].atomIds[${atomIndex}]`,
    ))
    if (new Set(atomIds).size !== atomIds.length) {
      throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `${id}.atomIds must be unique`)
    }
    for (const atomId of atomIds) {
      if (!resultAtomById.has(atomId)) {
        throw new ZatomSqsQualityEvidenceInputError('sqs_quality_atom_mapping_mismatch', `${id} references unknown atom ${atomId}`)
      }
      if (occupiedAtomIds.has(atomId)) {
        throw new ZatomSqsQualityEvidenceInputError('sqs_quality_atom_mapping_mismatch', `Atom ${atomId} appears in multiple sublattices`)
      }
      occupiedAtomIds.add(atomId)
    }
    mutableSiteCount += atomIds.length
    if (mutableSiteCount > maxMutableSites) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_budget_exceeded',
        `SQS evidence contains more than ${maxMutableSites} mutable sites`,
      )
    }
    if (!Array.isArray(item.allowedSpecies) || item.allowedSpecies.length < 2 || item.allowedSpecies.length > 64) {
      throw new ZatomSqsQualityEvidenceInputError(
        'invalid_sqs_quality_evidence',
        `${id}.allowedSpecies must contain 2-64 elements`,
      )
    }
    const allowedSpecies = item.allowedSpecies.map((species, speciesIndex) => canonicalElement(
      species,
      `${id}.allowedSpecies[${speciesIndex}]`,
    )).sort(compareText)
    if (new Set(allowedSpecies).size !== allowedSpecies.length) {
      throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', `${id}.allowedSpecies must be unique`)
    }
    const requestedFractions = exactNumericRecord(item.requestedFractions, `${id}.requestedFractions`, allowedSpecies)
    const fractionSum = Object.values(requestedFractions).reduce((sum, fraction) => sum + fraction, 0)
    if (!close(fractionSum, 1, 1e-12) || Object.values(requestedFractions).some((fraction) => fraction <= 0)) {
      throw new ZatomSqsQualityEvidenceInputError(
        'invalid_sqs_quality_evidence',
        `${id}.requestedFractions must be positive and sum to one`,
      )
    }
    const realizedCounts = exactNumericRecord(
      item.realizedCounts,
      `${id}.realizedCounts`,
      allowedSpecies,
      { integer: true, minimum: 0, maximum: atomIds.length },
    )
    if (Object.values(realizedCounts).reduce((sum, count) => sum + count, 0) !== atomIds.length) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_composition_mismatch',
        `${id}.realizedCounts do not sum to the sublattice site count`,
      )
    }
    const realizedFractions = exactNumericRecord(item.realizedFractions, `${id}.realizedFractions`, allowedSpecies)
    let maximumFractionError = 0
    const observedCounts: Record<string, number> = Object.fromEntries(allowedSpecies.map((species) => [species, 0]))
    for (const atomId of atomIds) {
      const sourceAtom = sourceAtomById.get(atomId)!
      const resultAtom = resultAtomById.get(atomId)!
      if (!allowedSpecies.includes(sourceAtom.element) || !allowedSpecies.includes(resultAtom.element)) {
        throw new ZatomSqsQualityEvidenceInputError(
          'sqs_quality_composition_mismatch',
          `${id} atom ${atomId} uses an element outside allowedSpecies`,
        )
      }
      observedCounts[resultAtom.element] += 1
    }
    for (const species of allowedSpecies) {
      const expectedFraction = realizedCounts[species] / atomIds.length
      if (observedCounts[species] !== realizedCounts[species] || !close(realizedFractions[species], expectedFraction, 1e-12)) {
        throw new ZatomSqsQualityEvidenceInputError(
          'sqs_quality_composition_mismatch',
          `${id}.${species} realized count/fraction does not match the exact result occupations`,
        )
      }
      maximumFractionError = Math.max(maximumFractionError, Math.abs(expectedFraction - requestedFractions[species]))
    }
    const reportedMaximumFractionError = finiteNumber(item.maximumFractionError, `${id}.maximumFractionError`, 0, 1)
    if (!close(reportedMaximumFractionError, maximumFractionError, 1e-12)) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_composition_mismatch',
        `${id}.maximumFractionError was not recomputed from requested and realized composition`,
      )
    }
    return {
      id,
      atomIds: atomIds.sort((left, right) => resultAtomOrder.get(left)! - resultAtomOrder.get(right)!),
      allowedSpecies,
      requestedFractions,
      realizedCounts,
      realizedFractions,
      maximumFractionError,
    }
  }).sort((left, right) => compareText(left.id, right.id))

  for (let index = 0; index < options.sourceStructure.atoms.length; index++) {
    const sourceAtom = options.sourceStructure.atoms[index]
    const resultAtom = options.resultStructure.atoms[index]
    if (sourceAtom.element !== resultAtom.element && !occupiedAtomIds.has(sourceAtom.id)) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_atom_mapping_mismatch',
        `Fixed atom ${sourceAtom.id} changed element outside every declared sublattice`,
      )
    }
  }

  const rawClusterSpace = exactObject(root.clusterSpace, 'sqsQualityEvidence.clusterSpace', [
    'basis',
    'symmetry',
    'cutoffsA',
    'maximumOrder',
    'completeThroughDeclaredCutoffs',
    'componentCount',
    'componentCountByOrder',
    'orbitCountByOrder',
    'components',
  ])
  if (rawClusterSpace.basis !== 'finite-cell-occupation-distributions'
    && rawClusterSpace.basis !== 'icet-orthogonal-cluster-vector') {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'Unsupported cluster-vector basis')
  }
  const rawSymmetry = exactObject(
    rawClusterSpace.symmetry,
    'clusterSpace.symmetry',
    ['kind'],
    ['spaceGroup', 'symprecA', 'positionToleranceA'],
  )
  if (rawSymmetry.kind !== 'local-geometric-canonicalization' && rawSymmetry.kind !== 'space-group-orbits') {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'Unsupported cluster-space symmetry kind')
  }
  const symmetry = {
    kind: rawSymmetry.kind,
    ...(rawSymmetry.spaceGroup === undefined ? {} : { spaceGroup: text(rawSymmetry.spaceGroup, 'clusterSpace.symmetry.spaceGroup', 256) }),
    ...(rawSymmetry.symprecA === undefined ? {} : { symprecA: finiteNumber(rawSymmetry.symprecA, 'clusterSpace.symmetry.symprecA', 1e-12, 1) }),
    ...(rawSymmetry.positionToleranceA === undefined ? {} : {
      positionToleranceA: finiteNumber(rawSymmetry.positionToleranceA, 'clusterSpace.symmetry.positionToleranceA', 1e-12, 1),
    }),
  } as ZatomSqsQualityEvidence['clusterSpace']['symmetry']
  if (symmetry.kind === 'space-group-orbits'
    && (!symmetry.spaceGroup || symmetry.symprecA === undefined || symmetry.positionToleranceA === undefined)) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'space-group-orbits requires spaceGroup, symprecA, and positionToleranceA',
    )
  }
  if (!Array.isArray(rawClusterSpace.cutoffsA)
    || rawClusterSpace.cutoffsA.length < 1
    || rawClusterSpace.cutoffsA.length > 7) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'clusterSpace.cutoffsA must contain 1-7 positive cutoffs for pair order and above',
    )
  }
  const cutoffsA = rawClusterSpace.cutoffsA.map((cutoff, index) => finiteNumber(
    cutoff,
    `clusterSpace.cutoffsA[${index}]`,
    1e-8,
    1e6,
  ))
  const maximumOrder = safeInteger(rawClusterSpace.maximumOrder, 'clusterSpace.maximumOrder', 2, 8)
  if (maximumOrder !== cutoffsA.length + 1) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'clusterSpace.maximumOrder must equal cutoffsA.length + 1',
    )
  }
  if (typeof rawClusterSpace.completeThroughDeclaredCutoffs !== 'boolean') {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'clusterSpace.completeThroughDeclaredCutoffs must be boolean',
    )
  }
  if (!Array.isArray(rawClusterSpace.components)
    || rawClusterSpace.components.length < 1
    || rawClusterSpace.components.length > maxComponents) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_budget_exceeded',
      `clusterSpace.components must contain 1-${maxComponents} entries`,
    )
  }
  let representativeAtomReferenceCount = 0
  const components: ZatomSqsClusterVectorComponent[] = rawClusterSpace.components.map((raw, index) => {
    const component = exactObject(raw, `clusterSpace.components[${index}]`, [
      'index',
      'orbitIndex',
      'order',
      'radiusA',
      'multiplicity',
      'multicomponentVector',
      'sublattices',
      'target',
      'actual',
      'absoluteError',
    ], ['representativeAtomIds'])
    const componentIndex = safeInteger(component.index, `components[${index}].index`, 0, maxComponents - 1)
    if (componentIndex !== index) {
      throw new ZatomSqsQualityEvidenceInputError(
        'invalid_sqs_quality_evidence',
        'Cluster-vector component indices must be contiguous and canonical',
      )
    }
    const order = safeInteger(component.order, `components[${index}].order`, 0, maximumOrder)
    const target = finiteNumber(component.target, `components[${index}].target`)
    const actual = finiteNumber(component.actual, `components[${index}].actual`)
    const absoluteError = finiteNumber(component.absoluteError, `components[${index}].absoluteError`, 0)
    if (!close(absoluteError, Math.abs(actual - target), 1e-12)) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_component_mismatch',
        `components[${index}].absoluteError does not equal abs(actual-target)`,
      )
    }
    if (!Array.isArray(component.sublattices) || component.sublattices.length < 1 || component.sublattices.length > 8) {
      throw new ZatomSqsQualityEvidenceInputError(
        'invalid_sqs_quality_evidence',
        `components[${index}].sublattices must contain 1-8 labels`,
      )
    }
    const componentSublattices = component.sublattices.map((item, itemIndex) => token(
      item,
      `components[${index}].sublattices[${itemIndex}]`,
    ))
    let representativeAtomIds: string[] | undefined
    if (component.representativeAtomIds !== undefined) {
      if (!Array.isArray(component.representativeAtomIds)
        || component.representativeAtomIds.length < 1
        || component.representativeAtomIds.length > 64) {
        throw new ZatomSqsQualityEvidenceInputError(
          'invalid_sqs_quality_evidence',
          `components[${index}].representativeAtomIds must contain 1-64 atom IDs`,
        )
      }
      representativeAtomIds = component.representativeAtomIds.map((atomId, atomIndex) => token(
        atomId,
        `components[${index}].representativeAtomIds[${atomIndex}]`,
      ))
      if (new Set(representativeAtomIds).size !== representativeAtomIds.length
        || representativeAtomIds.some((atomId) => !resultAtomById.has(atomId))) {
        throw new ZatomSqsQualityEvidenceInputError(
          'sqs_quality_atom_mapping_mismatch',
          `components[${index}].representativeAtomIds must be unique result atom IDs`,
        )
      }
      representativeAtomReferenceCount += representativeAtomIds.length
      if (representativeAtomReferenceCount > maxRepresentativeAtomReferences) {
        throw new ZatomSqsQualityEvidenceInputError(
          'sqs_quality_budget_exceeded',
          `Representative atom references exceed ${maxRepresentativeAtomReferences}`,
        )
      }
      representativeAtomIds.sort((left, right) => resultAtomOrder.get(left)! - resultAtomOrder.get(right)!)
    }
    return {
      index: componentIndex,
      orbitIndex: safeInteger(component.orbitIndex, `components[${index}].orbitIndex`, -1, maxComponents),
      order,
      radiusA: finiteNumber(component.radiusA, `components[${index}].radiusA`, 0, 1e6),
      multiplicity: finiteNumber(component.multiplicity, `components[${index}].multiplicity`, 0, 1e12),
      multicomponentVector: token(component.multicomponentVector, `components[${index}].multicomponentVector`, 1024),
      sublattices: componentSublattices,
      target,
      actual,
      absoluteError,
      ...(representativeAtomIds ? { representativeAtomIds } : {}),
    }
  })
  const componentCount = safeInteger(rawClusterSpace.componentCount, 'clusterSpace.componentCount', 1, maxComponents)
  if (componentCount !== components.length) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_component_mismatch',
      'clusterSpace.componentCount does not equal components.length',
    )
  }
  const componentCountByOrder = orderCount(components)
  const orbitCountByOrder = orbitOrderCount(components)
  if (!sameJson(rawClusterSpace.componentCountByOrder, componentCountByOrder)
    || !sameJson(rawClusterSpace.orbitCountByOrder, orbitCountByOrder)) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_component_mismatch',
      'clusterSpace order counts were not recomputed from the canonical components',
    )
  }
  const clusterSpace: ZatomSqsQualityEvidence['clusterSpace'] = {
    basis: rawClusterSpace.basis,
    symmetry,
    cutoffsA,
    maximumOrder,
    completeThroughDeclaredCutoffs: rawClusterSpace.completeThroughDeclaredCutoffs,
    componentCount,
    componentCountByOrder,
    orbitCountByOrder,
    components,
  }
  const clusterSpaceFingerprint = fingerprintCanonicalJson(clusterSpace)
  if (root.clusterSpaceFingerprint !== clusterSpaceFingerprint) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_cluster_space_fingerprint_mismatch',
      'clusterSpaceFingerprint does not match the canonical cluster-space payload',
    )
  }

  const rawObjective = exactObject(root.objective, 'sqsQualityEvidence.objective', [
    'kind', 'value', 'tolerance',
  ], ['optimalityWeight'])
  if (rawObjective.kind !== 'mean-square-cluster-vector' && rawObjective.kind !== 'walle-2013-cluster-vector') {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'Unsupported SQS objective kind')
  }
  const objective: ZatomSqsQualityEvidence['objective'] = {
    kind: rawObjective.kind,
    value: finiteNumber(rawObjective.value, 'objective.value'),
    tolerance: finiteNumber(rawObjective.tolerance, 'objective.tolerance', 0, 1),
    ...(rawObjective.optimalityWeight === undefined ? {} : {
      optimalityWeight: finiteNumber(rawObjective.optimalityWeight, 'objective.optimalityWeight', 0, 1e6),
    }),
  }
  if (objective.kind === 'walle-2013-cluster-vector' && objective.optimalityWeight === undefined) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'walle-2013-cluster-vector requires optimalityWeight',
    )
  }

  const rawAcceptance = exactObject(root.acceptance, 'sqsQualityEvidence.acceptance', [
    'maximumCompositionFractionError',
    'maximumAbsoluteClusterError',
    'maximumRmsClusterError',
    'requireCompleteThroughDeclaredCutoffs',
  ])
  if (typeof rawAcceptance.requireCompleteThroughDeclaredCutoffs !== 'boolean') {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'acceptance.requireCompleteThroughDeclaredCutoffs must be boolean',
    )
  }
  const acceptance: ZatomSqsQualityEvidence['acceptance'] = {
    maximumCompositionFractionError: finiteNumber(
      rawAcceptance.maximumCompositionFractionError,
      'acceptance.maximumCompositionFractionError',
      0,
      1,
    ),
    maximumAbsoluteClusterError: finiteNumber(
      rawAcceptance.maximumAbsoluteClusterError,
      'acceptance.maximumAbsoluteClusterError',
      0,
      1e6,
    ),
    maximumRmsClusterError: finiteNumber(
      rawAcceptance.maximumRmsClusterError,
      'acceptance.maximumRmsClusterError',
      0,
      1e6,
    ),
    requireCompleteThroughDeclaredCutoffs: rawAcceptance.requireCompleteThroughDeclaredCutoffs,
  }
  const metrics = computeMetrics(sublattices, components, objective.tolerance)
  const reportedMetrics = exactObject(root.metrics, 'sqsQualityEvidence.metrics', [
    'maximumCompositionFractionError',
    'maximumAbsoluteClusterError',
    'meanAbsoluteClusterError',
    'rmsClusterError',
    'perfectComponentCount',
    'longestPerfectPairRadiusA',
  ])
  const canonicalReportedMetrics = {
    maximumCompositionFractionError: finiteNumber(reportedMetrics.maximumCompositionFractionError, 'metrics.maximumCompositionFractionError', 0, 1),
    maximumAbsoluteClusterError: finiteNumber(reportedMetrics.maximumAbsoluteClusterError, 'metrics.maximumAbsoluteClusterError', 0),
    meanAbsoluteClusterError: finiteNumber(reportedMetrics.meanAbsoluteClusterError, 'metrics.meanAbsoluteClusterError', 0),
    rmsClusterError: finiteNumber(reportedMetrics.rmsClusterError, 'metrics.rmsClusterError', 0),
    perfectComponentCount: safeInteger(reportedMetrics.perfectComponentCount, 'metrics.perfectComponentCount', 0, components.length),
    longestPerfectPairRadiusA: finiteNumber(reportedMetrics.longestPerfectPairRadiusA, 'metrics.longestPerfectPairRadiusA', 0, 1e6),
  }
  for (const key of Object.keys(metrics) as Array<keyof typeof metrics>) {
    if (!close(Number(canonicalReportedMetrics[key]), Number(metrics[key]), 1e-10)) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_metrics_mismatch',
        `metrics.${key} was not recomputed from the canonical evidence`,
      )
    }
  }
  if (!close(objective.value, expectedObjective(objective, components, metrics), 1e-10)) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_objective_mismatch',
      'objective.value was not recomputed from component errors and objective policy',
    )
  }

  const rawSearch = exactObject(root.search, 'sqsQualityEvidence.search', [
    'algorithm',
    'seed',
    'deterministic',
    'exhaustive',
    'steps',
    'candidateCount',
    'selectedCandidateIndex',
    'scopeWarning',
  ])
  if (typeof rawSearch.deterministic !== 'boolean' || typeof rawSearch.exhaustive !== 'boolean') {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'search deterministic/exhaustive fields must be boolean',
    )
  }
  const candidateCount = safeInteger(rawSearch.candidateCount, 'search.candidateCount', 1, 1_000_000_000)
  const search: ZatomSqsQualityEvidence['search'] = {
    algorithm: text(rawSearch.algorithm, 'search.algorithm', 256),
    seed: safeInteger(rawSearch.seed, 'search.seed', 0, 0xffffffff),
    deterministic: rawSearch.deterministic,
    exhaustive: rawSearch.exhaustive,
    steps: safeInteger(rawSearch.steps, 'search.steps', 0, 1_000_000_000),
    candidateCount,
    selectedCandidateIndex: safeInteger(rawSearch.selectedCandidateIndex, 'search.selectedCandidateIndex', 0, candidateCount - 1),
    scopeWarning: text(rawSearch.scopeWarning, 'search.scopeWarning', 8192),
  }

  const rawProvenance = exactObject(root.provenance, 'sqsQualityEvidence.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.artifacts) || rawProvenance.artifacts.length < 3 || rawProvenance.artifacts.length > 128) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'provenance.artifacts must contain 3-128 entries',
    )
  }
  const artifacts = rawProvenance.artifacts.map((raw, index) => {
    const artifact = exactObject(raw, `provenance.artifacts[${index}]`, ['id', 'role', 'fingerprint'])
    return {
      id: token(artifact.id, `provenance.artifacts[${index}].id`),
      role: text(artifact.role, `provenance.artifacts[${index}].role`, 256),
      fingerprint: token(artifact.fingerprint, `provenance.artifacts[${index}].fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'provenance artifact IDs must be unique')
  }
  const requiredArtifacts = new Map<string, { fingerprint: string; role: string }>([
    ['zatom.sqs.cluster-space', { fingerprint: clusterSpaceFingerprint, role: 'canonical-cluster-space' }],
    ['zatom.sqs.result-structure', { fingerprint: resultStructureFingerprint, role: 'exact-result-structure' }],
    ['zatom.sqs.source-structure', { fingerprint: sourceStructureFingerprint, role: 'exact-source-structure' }],
  ])
  for (const [id, expected] of requiredArtifacts) {
    const artifact = artifacts.find((candidate) => candidate.id === id)
    if (artifact?.fingerprint !== expected.fingerprint || artifact.role !== expected.role) {
      throw new ZatomSqsQualityEvidenceInputError(
        'sqs_quality_provenance_mismatch',
        `provenance artifact ${id} does not bind the canonical dependency fingerprint and role`,
      )
    }
  }
  if (!Array.isArray(rawProvenance.citations)
    || rawProvenance.citations.length < 1
    || rawProvenance.citations.length > 64) {
    throw new ZatomSqsQualityEvidenceInputError(
      'invalid_sqs_quality_evidence',
      'provenance.citations must contain 1-64 entries',
    )
  }
  const citations = rawProvenance.citations.map((citation, index) => text(
    citation,
    `provenance.citations[${index}]`,
    4096,
  )).sort(compareText)
  if (new Set(citations).size !== citations.length) {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'provenance.citations must be unique')
  }
  const parameters = jsonValue(rawProvenance.parameters, 'provenance.parameters')
  if (!isRecord(parameters)) {
    throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'provenance.parameters must be an object')
  }
  const provenance: ZatomSqsQualityEvidence['provenance'] = {
    engine: text(rawProvenance.engine, 'provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'provenance.method', 1024),
    artifacts,
    parameters: parameters as Record<string, JsonValue>,
    citations,
    scopeWarning: text(rawProvenance.scopeWarning, 'provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    const parsed = jsonValue(root.metadata, 'metadata')
    if (!isRecord(parsed)) {
      throw new ZatomSqsQualityEvidenceInputError('invalid_sqs_quality_evidence', 'metadata must be an object')
    }
    metadata = parsed as Record<string, JsonValue>
  }
  const metadataBytes = utf8ByteLength({ metadata, parameters })
  if (metadataBytes > maxMetadataBytes) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_budget_exceeded',
      `SQS metadata/provenance parameters use ${metadataBytes} bytes above maxMetadataBytes ${maxMetadataBytes}`,
    )
  }

  const evidence: ZatomSqsQualityEvidence = {
    schemaVersion: ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA,
    sourceStructureFingerprint,
    resultStructureFingerprint,
    clusterSpaceFingerprint,
    occupation: { mode: 'relabel-only', sublattices },
    clusterSpace,
    objective,
    acceptance,
    metrics,
    search,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const artifactBytes = utf8ByteLength(evidence)
  if (artifactBytes > maxArtifactBytes) {
    throw new ZatomSqsQualityEvidenceInputError(
      'sqs_quality_budget_exceeded',
      `SQS evidence uses ${artifactBytes} bytes above maxArtifactBytes ${maxArtifactBytes}`,
    )
  }
  const compositionPassed = metrics.maximumCompositionFractionError <= acceptance.maximumCompositionFractionError
  const correlationPassed = metrics.maximumAbsoluteClusterError <= acceptance.maximumAbsoluteClusterError
    && metrics.rmsClusterError <= acceptance.maximumRmsClusterError
  const completenessPassed = clusterSpace.completeThroughDeclaredCutoffs
    || !acceptance.requireCompleteThroughDeclaredCutoffs
  const checks: ValidationCheck[] = [
    {
      id: 'sqs_quality_evidence.structure_binding',
      status: 'pass',
      message: 'SQS evidence is fingerprint-bound to exact relabel-only periodic source/result structures',
      metrics: {
        atomCount: options.resultStructure.atoms.length,
        mutableSiteCount,
        maximumPositionDisplacementA: maximumDisplacementA,
      },
    },
    {
      id: 'sqs_quality_evidence.composition',
      status: compositionPassed ? 'pass' : 'fail',
      message: compositionPassed
        ? 'Every sublattice count/fraction matches the exact result occupations and acceptance gate'
        : 'At least one realized sublattice fraction exceeds the declared composition-error gate',
      metrics: {
        sublatticeCount: sublattices.length,
        maximumCompositionFractionError: metrics.maximumCompositionFractionError,
        acceptedMaximumCompositionFractionError: acceptance.maximumCompositionFractionError,
      },
      atomIds: sublattices.flatMap((item) => item.atomIds).slice(0, 256),
    },
    {
      id: 'sqs_quality_evidence.cluster_space',
      status: completenessPassed ? (clusterSpace.completeThroughDeclaredCutoffs ? 'pass' : 'warn') : 'fail',
      message: clusterSpace.completeThroughDeclaredCutoffs
        ? 'Producer declares complete symmetry/geometry components through every explicit cutoff'
        : acceptance.requireCompleteThroughDeclaredCutoffs
          ? 'Producer cluster-space enumeration is incomplete despite a strict completeness requirement'
          : 'Producer cluster-space enumeration is explicitly incomplete through the declared cutoffs',
      metrics: {
        maximumOrder,
        componentCount,
        completeThroughDeclaredCutoffs: clusterSpace.completeThroughDeclaredCutoffs,
        clusterSpaceFingerprint,
      },
    },
    {
      id: 'sqs_quality_evidence.correlation_error',
      status: correlationPassed ? 'pass' : 'fail',
      message: correlationPassed
        ? 'Canonical cluster-vector error metrics satisfy both absolute and RMS acceptance gates'
        : 'Canonical cluster-vector error exceeds an absolute or RMS acceptance gate',
      metrics: {
        maximumAbsoluteClusterError: metrics.maximumAbsoluteClusterError,
        acceptedMaximumAbsoluteClusterError: acceptance.maximumAbsoluteClusterError,
        rmsClusterError: metrics.rmsClusterError,
        acceptedMaximumRmsClusterError: acceptance.maximumRmsClusterError,
        meanAbsoluteClusterError: metrics.meanAbsoluteClusterError,
        longestPerfectPairRadiusA: metrics.longestPerfectPairRadiusA,
        objective: objective.value,
      },
    },
    {
      id: 'sqs_quality_evidence.search_scope',
      status: search.exhaustive ? 'pass' : 'warn',
      message: search.exhaustive
        ? 'Search declares exhaustive coverage of its bounded candidate space'
        : 'Search is seeded and replayable but not exhaustive; another seed or longer search may improve the SQS',
      metrics: {
        seed: search.seed,
        deterministic: search.deterministic,
        exhaustive: search.exhaustive,
        steps: search.steps,
        candidateCount: search.candidateCount,
      },
    },
    {
      id: 'sqs_quality_evidence.scope',
      status: 'warn',
      message: provenance.scopeWarning,
      metrics: {
        basis: clusterSpace.basis,
        symmetry: clusterSpace.symmetry.kind,
      },
    },
  ]
  const mutableAtomIds = sublattices.flatMap((item) => item.atomIds)
  const mutableBounds = boundsOfPositions(mutableAtomIds.map((atomId) => resultAtomById.get(atomId)!.position))
  const inspectionTargets: InspectionTarget[] = mutableBounds ? [{
    id: 'sqs-quality-relabelled-sites',
    reason: 'Review the complete set of sites whose occupations define the SQS',
    center: mutableBounds.center,
    radius: Math.max(1, mutableBounds.radius * 1.15),
    atomIds: mutableAtomIds.slice(0, 512),
    ...(mutableAtomIds.length > 512 ? { atomIdsTruncated: true } : {}),
  }] : []
  const reviewableComponents = components.filter((component) => component.representativeAtomIds?.length)
  const worstComponent = (reviewableComponents.length ? reviewableComponents : components).reduce(
    (worst, component) => (
      component.absoluteError > worst.absoluteError
        || (component.absoluteError === worst.absoluteError && component.order > worst.order)
        || (component.absoluteError === worst.absoluteError
          && component.order === worst.order
          && component.radiusA > worst.radiusA)
        ? component
        : worst
    ),
  )
  if (worstComponent.representativeAtomIds?.length) {
    const representativeBounds = boundsOfPositions(
      worstComponent.representativeAtomIds.map((atomId) => resultAtomById.get(atomId)!.position),
    )
    if (representativeBounds) inspectionTargets.push({
      id: 'sqs-quality-worst-component',
      reason: `Review a representative order-${worstComponent.order} orbit for the largest cluster-vector error ${worstComponent.absoluteError}`,
      center: representativeBounds.center,
      radius: Math.max(1, representativeBounds.radius * 1.5),
      atomIds: worstComponent.representativeAtomIds,
    })
  }
  return {
    evidence,
    fingerprint: fingerprintSqsQualityEvidence(evidence),
    checks,
    inspectionTargets,
  }
}

export function composeZatomSqsQualityEvidence(
  input: ComposeZatomSqsQualityEvidenceInput,
  budgets: Omit<ParseZatomSqsQualityEvidenceOptions, 'sourceStructure' | 'resultStructure'> = {},
): ZatomSqsQualityEvidenceValidation {
  const resultAtomOrder = new Map(input.resultStructure.atoms.map((atom, index) => [atom.id, index]))
  const components = [...input.clusterSpace.components]
    .sort((left, right) => left.index - right.index)
    .map((component) => ({
      ...component,
      ...(component.representativeAtomIds ? {
        representativeAtomIds: [...component.representativeAtomIds].sort(
          (left, right) => (resultAtomOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
            - (resultAtomOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
        ),
      } : {}),
    }))
  const clusterSpace: ZatomSqsQualityEvidence['clusterSpace'] = {
    ...input.clusterSpace,
    components,
    componentCount: components.length,
    componentCountByOrder: orderCount(components),
    orbitCountByOrder: orbitOrderCount(components),
  }
  const clusterSpaceFingerprint = fingerprintCanonicalJson(clusterSpace)
  const sourceStructureFingerprint = fingerprintStructure(input.sourceStructure)
  const resultStructureFingerprint = fingerprintStructure(input.resultStructure)
  const sublattices = [...input.occupation.sublattices]
  const metrics = computeMetrics(sublattices, components, input.objective.tolerance)
  const objective = {
    ...input.objective,
    value: expectedObjective(input.objective, components, metrics),
  }
  const reservedIds = new Set([
    'zatom.sqs.cluster-space',
    'zatom.sqs.result-structure',
    'zatom.sqs.source-structure',
  ])
  const artifacts = input.provenance.artifacts.filter((artifact) => !reservedIds.has(artifact.id))
  artifacts.push(
    { id: 'zatom.sqs.cluster-space', role: 'canonical-cluster-space', fingerprint: clusterSpaceFingerprint },
    { id: 'zatom.sqs.result-structure', role: 'exact-result-structure', fingerprint: resultStructureFingerprint },
    { id: 'zatom.sqs.source-structure', role: 'exact-source-structure', fingerprint: sourceStructureFingerprint },
  )
  return parseZatomSqsQualityEvidence({
    schemaVersion: ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA,
    sourceStructureFingerprint,
    resultStructureFingerprint,
    clusterSpaceFingerprint,
    occupation: { mode: 'relabel-only', sublattices },
    clusterSpace,
    objective,
    acceptance: input.acceptance,
    metrics,
    search: input.search,
    provenance: { ...input.provenance, artifacts },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    resultStructure: input.resultStructure,
    ...budgets,
  })
}
