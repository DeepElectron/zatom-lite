/** Canonical weighted structural ensembles with periodic-cell uncertainty. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { fingerprintForceFieldTopology } from './force-field-package'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  cartesianToFractional,
  determinant3,
  fingerprintCanonicalJson,
  fractionalToCartesian,
  fingerprintStructure,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'
import type {
  ZatomStructureEnsembleEvidenceSource,
  ZatomStructureEnsembleWeightKind,
} from './structure-ensemble'

export const ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA =
  'zatom.periodic-structure-ensemble/v1' as const

const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083

export interface ZatomPeriodicStructureEnsembleMember {
  id: string
  weight: number
  structureFingerprint: string
  structure: ZatomStructure
  evidenceSourceIds: string[]
  relativePotentialEnergyKcalMol?: number
  relativeFreeEnergyKcalMol?: number
}

export interface ZatomPeriodicStructureEnsemble {
  schemaVersion: typeof ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA
  /** Coordinate/cell-independent ordered atom, optional-bond, charge, and stereo identity. */
  identityFingerprint: string
  /** Every member has these same periodic axes; at least one axis is periodic. */
  periodic: [boolean, boolean, boolean]
  members: ZatomPeriodicStructureEnsembleMember[]
  selection: {
    selectedMemberId: string
    method: 'explicit' | 'maximum-weight'
    rationale: string
  }
  weightModel: {
    kind: ZatomStructureEnsembleWeightKind
    temperatureK?: number
    method: string
    assumptions: string[]
    applicability: {
      assessment: 'in-domain' | 'unknown' | 'out-of-domain'
      domain: string
      reasons: string[]
    }
    scopeWarning: string
  }
  acceptance: {
    minimumWeightEffectiveMemberCount: number
    maximumPeriodicCellConditionNumber: number
    maximumFullCellConditionNumber: number
  }
  evidenceSources: ZatomStructureEnsembleEvidenceSource[]
  provenance: {
    engine: string
    engineVersion: string
    method: string
    artifacts: Array<{ id: string; role: string; fingerprint: string }>
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomPeriodicStructureEnsembleOptions {
  selectedStructure: ZatomStructure
  maxMembers?: number
  maxAtomsPerMember?: number
  maxMemberAtoms?: number
  maxMemberAtomPairs?: number
  maxMinimumImageCandidateEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomPeriodicStructureEnsembleMemberDiagnostic {
  memberId: string
  periodicMeasure: number
  periodicMeasureChangeFraction: number
  periodicPrincipalEngineeringStrains: number[]
  maximumAbsolutePeriodicPrincipalStrain: number
  periodicCellConditionNumber: number
  periodicMetricRmsToSelected: number
  fullCellPrincipalEngineeringStrains: number[]
  maximumAbsoluteFullCellPrincipalStrain: number
  fullCellConditionNumber: number
  fullCellMetricRmsToSelected: number
  fractionalInternalDistanceMatrixRmsToSelectedA: number
}

export interface ZatomPeriodicStructureEnsembleAtomDiagnostic {
  atomId: string
  expectedPairwiseFractionalInternalDistanceProfileRmsA: number
}

export interface ZatomPeriodicStructureEnsembleDiagnostics {
  periodicDimension: 1 | 2 | 3
  periodicMeasureUnit: 'angstrom' | 'angstrom^2' | 'angstrom^3'
  selectedPeriodicMeasure: number
  expectedPairwisePeriodicMetricRms: number
  expectedPairwiseFullCellMetricRms: number
  expectedPairwiseFractionalInternalDistanceMatrixRmsA: number
  maximumAbsolutePeriodicPrincipalStrain: number
  maximumAbsoluteFullCellPrincipalStrain: number
  maximumPeriodicCellConditionNumber: number
  maximumFullCellConditionNumber: number
  maximumFractionalInternalDistanceMatrixRmsToSelectedA: number
  minimumMemberPairDistanceA: number | null
  minimumMemberPair: { memberId: string; atomIds: [string, string] } | null
  memberAtomPairCount: number
  minimumImageCandidateEvaluationCount: number
  memberDiagnostics: ZatomPeriodicStructureEnsembleMemberDiagnostic[]
  atomDiagnostics: ZatomPeriodicStructureEnsembleAtomDiagnostic[]
  periodicGaugeDuplicateGroups: string[][]
}

export interface ZatomPeriodicStructureEnsembleValidation {
  ensemble: ZatomPeriodicStructureEnsemble
  fingerprint: string
  weightEffectiveMemberCount: number
  diagnostics: ZatomPeriodicStructureEnsembleDiagnostics
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomPeriodicStructureEnsembleInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPeriodicStructureEnsembleInputError'
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
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function positiveSafeInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble_context',
      `${field} must be a positive safe integer`,
    )
  }
  return result
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 64,
  maximumTextLength = 4096,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'invalid_periodic_structure_ensemble',
        `${field} must contain finite JSON numbers`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomPeriodicStructureEnsembleInputError(
    'invalid_periodic_structure_ensemble',
    `${field} must be JSON-safe`,
  )
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must be an object`,
    )
  }
  return jsonValue(value, field) as Record<string, JsonValue>
}

function parseArtifacts(value: unknown, field: string): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must contain 1-64 entries`,
    )
  }
  const artifacts = value.map((raw, index) => {
    const itemField = `${field}[${index}]`
    const record = exactObject(raw, itemField, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${itemField}.id`),
      role: text(record.role, `${itemField}.role`, 1024),
      fingerprint: text(record.fingerprint, `${itemField}.fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} IDs must be unique`,
    )
  }
  return artifacts
}


export function fingerprintPeriodicStructureIdentity(structure: ZatomStructure): string {
  return fingerprintCanonicalJson({
    schemaVersion: ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA,
    bondTopology: structure.bonds === undefined ? 'unknown' : 'explicit',
    orderedTopologyFingerprint: fingerprintForceFieldTopology(structure),
  })
}

export function fingerprintPeriodicStructureEnsemble(value: ZatomPeriodicStructureEnsemble): string {
  return fingerprintCanonicalJson(value)
}

function parsePeriodic(value: unknown, field: string): [boolean, boolean, boolean] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'boolean')) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} must contain exactly three booleans`,
    )
  }
  const result: [boolean, boolean, boolean] = [value[0], value[1], value[2]]
  if (!result.some(Boolean)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_lattice_required',
      `${field} must enable at least one periodic axis`,
    )
  }
  return result
}

function normalizePeriodicStructure(value: unknown, field: string): ZatomStructure {
  let structure: ZatomStructure
  try {
    structure = parseZatomStructure(value)
  } catch (error) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} is not a canonical structure: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!structure.lattice || !structure.lattice.periodic.some(Boolean)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_lattice_required',
      `${field} requires a lattice with at least one periodic axis`,
    )
  }
  const volume = determinant3(structure.lattice.vectors)
  if (!Number.isFinite(volume) || volume <= 1e-8) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_orientation_mismatch',
      `${field} lattice must be finite, nonsingular, and right-handed`,
    )
  }
  const invalidCheckIds = new Set([
    'structure.non_empty',
    'structure.atom_ids_unique',
    'structure.coordinates_finite',
    'structure.bond_ids_unique',
    'structure.bond_endpoints_present',
    'structure.bond_pairs_valid',
    'structure.bond_orders_supported',
    'structure.lattice_nonsingular',
  ])
  const failed = validateStructure(structure, { maxPairScanAtoms: 1 }).checks.filter((check) => (
    check.status === 'fail' && invalidCheckIds.has(check.id)
  ))
  if (failed.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `${field} fails structural checks: ${failed.map((check) => check.id).join(', ')}`,
    )
  }
  return structure
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

function gram(vectors: readonly Vec3[]): number[][] {
  return vectors.map((left) => vectors.map((right) => dot(left, right)))
}

function transpose(matrix: readonly number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]))
}

function multiply(left: readonly number[][], right: readonly number[][]): number[][] {
  return left.map((row) => right[0].map((_, column) => (
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)
  )))
}

function determinantSmall(matrix: readonly number[][]): number {
  if (matrix.length === 1) return matrix[0][0]
  if (matrix.length === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
  return determinant3(matrix as Mat3)
}

function cholesky(matrix: readonly number[][]): number[][] | null {
  const size = matrix.length
  const lower = Array.from({ length: size }, () => Array(size).fill(0)) as number[][]
  for (let row = 0; row < size; row++) {
    for (let column = 0; column <= row; column++) {
      let value = matrix[row][column]
      for (let index = 0; index < column; index++) value -= lower[row][index] * lower[column][index]
      if (row === column) {
        if (!Number.isFinite(value) || value <= 1e-14) return null
        lower[row][column] = Math.sqrt(value)
      } else {
        lower[row][column] = value / lower[column][column]
      }
    }
  }
  return lower
}

function invertLower(lower: readonly number[][]): number[][] {
  const size = lower.length
  const inverse = Array.from({ length: size }, () => Array(size).fill(0)) as number[][]
  for (let column = 0; column < size; column++) {
    for (let row = 0; row < size; row++) {
      const target = row === column ? 1 : 0
      let value = target
      for (let index = 0; index < row; index++) value -= lower[row][index] * inverse[index][column]
      inverse[row][column] = value / lower[row][row]
    }
  }
  return inverse
}

function symmetricEigenvalues(matrix: readonly number[][]): number[] {
  if (matrix.length === 1) return [matrix[0][0]]
  if (matrix.length === 2) {
    const mean = (matrix[0][0] + matrix[1][1]) / 2
    const radius = Math.sqrt(((matrix[0][0] - matrix[1][1]) / 2) ** 2 + matrix[0][1] ** 2)
    return [mean + radius, mean - radius]
  }
  const value = matrix as Mat3
  const offDiagonalSquare = value[0][1] ** 2 + value[0][2] ** 2 + value[1][2] ** 2
  if (offDiagonalSquare < 1e-30) return [value[0][0], value[1][1], value[2][2]].sort((a, b) => b - a)
  const mean = (value[0][0] + value[1][1] + value[2][2]) / 3
  const spread = Math.sqrt((
    (value[0][0] - mean) ** 2
    + (value[1][1] - mean) ** 2
    + (value[2][2] - mean) ** 2
    + 2 * offDiagonalSquare
  ) / 6)
  if (spread === 0) return [mean, mean, mean]
  const normalized = value.map((row, rowIndex) => row.map((item, columnIndex) => (
    (item - (rowIndex === columnIndex ? mean : 0)) / spread
  )) as Vec3) as Mat3
  const angle = Math.acos(Math.max(-1, Math.min(1, determinant3(normalized) / 2))) / 3
  const largest = mean + 2 * spread * Math.cos(angle)
  const smallest = mean + 2 * spread * Math.cos(angle + 2 * Math.PI / 3)
  return [largest, 3 * mean - largest - smallest, smallest].sort((a, b) => b - a)
}

function periodicCellMetric(
  structure: ZatomStructure,
  axes: readonly number[],
  referenceCholeskyInverse: readonly number[][],
): {
  gram: number[][]
  normalizedMetric: number[][]
  measure: number
  principalEngineeringStrains: number[]
  conditionNumber: number
} {
  const vectors = axes.map((axis) => structure.lattice!.vectors[axis])
  const metric = gram(vectors)
  const eigenvalues = symmetricEigenvalues(metric)
  const minimumEigenvalue = Math.min(...eigenvalues)
  const maximumEigenvalue = Math.max(...eigenvalues)
  if (!Number.isFinite(minimumEigenvalue) || minimumEigenvalue <= 1e-14) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      'Periodic lattice-vector subspace is singular or numerically indefinite',
    )
  }
  const normalizedMetric = multiply(
    multiply(referenceCholeskyInverse, metric),
    transpose(referenceCholeskyInverse),
  )
  const normalizedEigenvalues = symmetricEigenvalues(normalizedMetric)
  return {
    gram: metric,
    normalizedMetric,
    measure: Math.sqrt(Math.max(0, determinantSmall(metric))),
    principalEngineeringStrains: normalizedEigenvalues.map((item) => Math.sqrt(Math.max(0, item)) - 1),
    conditionNumber: Math.sqrt(maximumEigenvalue / minimumEigenvalue),
  }
}

function periodicBasisMinimumSingularValue(structure: ZatomStructure, axes: readonly number[]): number {
  const metric = gram(axes.map((axis) => structure.lattice!.vectors[axis]))
  return Math.sqrt(Math.min(...symmetricEigenvalues(metric)))
}

function exactMinimumImageDistance(
  rawDelta: Vec3,
  structure: ZatomStructure,
  axes: readonly number[],
  minimumSingularValue: number,
  budget: { count: number; maximum: number },
): number {
  const delta: Vec3 = [...rawDelta]
  for (const axis of axes) delta[axis] -= Math.round(delta[axis])
  const base = fractionalToCartesian(delta, structure.lattice!.vectors)
  const baseDistance = Math.hypot(...base)
  if (baseDistance === 0) {
    budget.count += 1
    if (budget.count > budget.maximum) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_budget_exceeded',
        `Minimum-image candidate evaluations exceed ${budget.maximum}`,
      )
    }
    return 0
  }
  const radius = Math.ceil(2 * baseDistance / minimumSingularValue + 1e-12)
  const ranges = ([0, 1, 2] as const).map((axis) => (
    axes.includes(axis)
      ? Array.from({ length: 2 * radius + 1 }, (_, index) => index - radius)
      : [0]
  ))
  const candidates = ranges[0].length * ranges[1].length * ranges[2].length
  if (!Number.isSafeInteger(candidates) || budget.count + candidates > budget.maximum) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_budget_exceeded',
      `Minimum-image candidate evaluations would exceed ${budget.maximum}`,
    )
  }
  budget.count += candidates
  let best2 = Number.POSITIVE_INFINITY
  for (const first of ranges[0]) for (const second of ranges[1]) for (const third of ranges[2]) {
    const cartesian = fractionalToCartesian([
      delta[0] + first,
      delta[1] + second,
      delta[2] + third,
    ], structure.lattice!.vectors)
    const squared = dot(cartesian, cartesian)
    if (squared < best2) best2 = squared
  }
  return Math.sqrt(best2)
}

function rms(values: readonly number[]): number {
  return values.length ? Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length) : 0
}

function rounded(value: number): number {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(10))
}

function computeDiagnostics(
  members: readonly ZatomPeriodicStructureEnsembleMember[],
  selectedMemberId: string,
  periodic: [boolean, boolean, boolean],
  maximumCellConditionNumber: number,
  maximumFullCellConditionNumber: number,
  maximumCandidateEvaluations: number,
): ZatomPeriodicStructureEnsembleDiagnostics {
  const selected = members.find((member) => member.id === selectedMemberId)!
  const axes = periodic.flatMap((enabled, axis) => enabled ? [axis] : [])
  const periodicDimension = axes.length as 1 | 2 | 3
  const referenceGram = gram(axes.map((axis) => selected.structure.lattice!.vectors[axis]))
  const referenceCholesky = cholesky(referenceGram)
  if (!referenceCholesky) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      'Selected periodic lattice-vector subspace is not positive definite',
    )
  }
  const referenceCholeskyInverse = invertLower(referenceCholesky)
  const metrics = members.map((member) => periodicCellMetric(
    member.structure,
    axes,
    referenceCholeskyInverse,
  ))
  const observedMaximumCellConditionNumber = Math.max(...metrics.map((metric) => metric.conditionNumber))
  if (observedMaximumCellConditionNumber > maximumCellConditionNumber + 1e-12) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      `Maximum periodic cell condition number ${observedMaximumCellConditionNumber} exceeds ${maximumCellConditionNumber}`,
    )
  }
  const fullAxes = [0, 1, 2]
  const referenceFullGram = gram(selected.structure.lattice!.vectors)
  const referenceFullCholesky = cholesky(referenceFullGram)
  if (!referenceFullCholesky) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      'Selected full lattice metric is not positive definite',
    )
  }
  const referenceFullCholeskyInverse = invertLower(referenceFullCholesky)
  const fullMetrics = members.map((member) => periodicCellMetric(
    member.structure,
    fullAxes,
    referenceFullCholeskyInverse,
  ))
  const observedMaximumFullCellConditionNumber = Math.max(...fullMetrics.map((metric) => metric.conditionNumber))
  if (observedMaximumFullCellConditionNumber > maximumFullCellConditionNumber + 1e-12) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      `Maximum full-cell condition number ${observedMaximumFullCellConditionNumber} exceeds ${maximumFullCellConditionNumber}`,
    )
  }
  const selectedMetric = metrics[members.findIndex((member) => member.id === selectedMemberId)]
  const inactiveAxes = periodic.flatMap((enabled, axis) => enabled ? [] : [axis])
  const selectedFullGram = fullMetrics[members.findIndex((member) => member.id === selectedMemberId)].gram
  for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
    const memberFullGram = gram(members[memberIndex].structure.lattice!.vectors)
    for (const row of inactiveAxes) for (const column of inactiveAxes) {
      const scale = Math.max(1, Math.abs(selectedFullGram[row][column]))
      if (Math.abs(memberFullGram[row][column] - selectedFullGram[row][column]) > 1e-10 * scale) {
        throw new ZatomPeriodicStructureEnsembleInputError(
          'periodic_structure_ensemble_nonperiodic_cell_mismatch',
          `Member ${members[memberIndex].id} changes the metric among nonperiodic lattice vectors`,
        )
      }
    }
  }

  const fractionalPositions = members.map((member) => member.structure.atoms.map((atom) => {
    const fractional = cartesianToFractional(atom.position, member.structure.lattice!.vectors)
    if (!fractional) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_cell_condition_failed',
        `Cannot invert member ${member.id} lattice`,
      )
    }
    return fractional
  }))
  const minimumSingularValues = members.map((member) => (
    periodicBasisMinimumSingularValue(member.structure, axes)
  ))
  const selectedMinimumSingularValue = periodicBasisMinimumSingularValue(selected.structure, axes)
  const budget = { count: 0, maximum: maximumCandidateEvaluations }
  const atomCount = selected.structure.atoms.length
  const pairCount = atomCount * (atomCount - 1) / 2
  const internalDistances = members.map(() => [] as number[])
  let minimumMemberPairDistanceA = Number.POSITIVE_INFINITY
  let minimumMemberPair: ZatomPeriodicStructureEnsembleDiagnostics['minimumMemberPair'] = null
  for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
    const member = members[memberIndex]
    for (let first = 0; first < atomCount; first++) {
      for (let second = first + 1; second < atomCount; second++) {
        const rawDelta: Vec3 = [
          fractionalPositions[memberIndex][second][0] - fractionalPositions[memberIndex][first][0],
          fractionalPositions[memberIndex][second][1] - fractionalPositions[memberIndex][first][1],
          fractionalPositions[memberIndex][second][2] - fractionalPositions[memberIndex][first][2],
        ]
        const actual = exactMinimumImageDistance(
          rawDelta,
          member.structure,
          axes,
          minimumSingularValues[memberIndex],
          budget,
        )
        const internal = exactMinimumImageDistance(
          rawDelta,
          selected.structure,
          axes,
          selectedMinimumSingularValue,
          budget,
        )
        internalDistances[memberIndex].push(internal)
        if (actual < minimumMemberPairDistanceA) {
          minimumMemberPairDistanceA = actual
          minimumMemberPair = {
            memberId: member.id,
            atomIds: [member.structure.atoms[first].id, member.structure.atoms[second].id],
          }
        }
      }
    }
  }

  const memberDiagnostics: ZatomPeriodicStructureEnsembleMemberDiagnostic[] = members.map((member, index) => ({
    memberId: member.id,
    periodicMeasure: metrics[index].measure,
    periodicMeasureChangeFraction: metrics[index].measure / selectedMetric.measure - 1,
    periodicPrincipalEngineeringStrains: metrics[index].principalEngineeringStrains,
    maximumAbsolutePeriodicPrincipalStrain: Math.max(...metrics[index].principalEngineeringStrains.map(Math.abs)),
    periodicCellConditionNumber: metrics[index].conditionNumber,
    periodicMetricRmsToSelected: rms(metrics[index].normalizedMetric.flatMap((row, rowIndex) => (
      row.map((value, columnIndex) => value - (rowIndex === columnIndex ? 1 : 0))
    ))),
    fullCellPrincipalEngineeringStrains: fullMetrics[index].principalEngineeringStrains,
    maximumAbsoluteFullCellPrincipalStrain: Math.max(...fullMetrics[index].principalEngineeringStrains.map(Math.abs)),
    fullCellConditionNumber: fullMetrics[index].conditionNumber,
    fullCellMetricRmsToSelected: rms(fullMetrics[index].normalizedMetric.flatMap((row, rowIndex) => (
      row.map((value, columnIndex) => value - (rowIndex === columnIndex ? 1 : 0))
    ))),
    fractionalInternalDistanceMatrixRmsToSelectedA: rms(internalDistances[index].map((distance, pairIndex) => (
      distance - internalDistances[members.findIndex((candidate) => candidate.id === selectedMemberId)][pairIndex]
    ))),
  }))

  let periodicMetricVarianceSum = 0
  for (let row = 0; row < periodicDimension; row++) for (let column = 0; column < periodicDimension; column++) {
    const mean = members.reduce((sum, member, index) => (
      sum + member.weight * metrics[index].normalizedMetric[row][column]
    ), 0)
    periodicMetricVarianceSum += members.reduce((sum, member, index) => (
      sum + member.weight * (metrics[index].normalizedMetric[row][column] - mean) ** 2
    ), 0)
  }
  const expectedPairwisePeriodicMetricRms = Math.sqrt(
    2 * periodicMetricVarianceSum / (periodicDimension * periodicDimension),
  )
  let fullCellMetricVarianceSum = 0
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const mean = members.reduce((sum, member, index) => (
      sum + member.weight * fullMetrics[index].normalizedMetric[row][column]
    ), 0)
    fullCellMetricVarianceSum += members.reduce((sum, member, index) => (
      sum + member.weight * (fullMetrics[index].normalizedMetric[row][column] - mean) ** 2
    ), 0)
  }
  const expectedPairwiseFullCellMetricRms = Math.sqrt(2 * fullCellMetricVarianceSum / 9)
  let internalVarianceSum = 0
  const perAtomVariance = Array(atomCount).fill(0) as number[]
  let pairIndex = 0
  for (let first = 0; first < atomCount; first++) {
    for (let second = first + 1; second < atomCount; second++) {
      const mean = members.reduce((sum, member, memberIndex) => (
        sum + member.weight * internalDistances[memberIndex][pairIndex]
      ), 0)
      const variance = members.reduce((sum, member, memberIndex) => (
        sum + member.weight * (internalDistances[memberIndex][pairIndex] - mean) ** 2
      ), 0)
      internalVarianceSum += variance
      perAtomVariance[first] += variance
      perAtomVariance[second] += variance
      pairIndex += 1
    }
  }
  const expectedPairwiseFractionalInternalDistanceMatrixRmsA = pairCount
    ? Math.sqrt(2 * internalVarianceSum / pairCount)
    : 0
  const atomDiagnostics = selected.structure.atoms.map((atom, atomIndex) => ({
    atomId: atom.id,
    expectedPairwiseFractionalInternalDistanceProfileRmsA: atomCount > 1
      ? Math.sqrt(2 * perAtomVariance[atomIndex] / (atomCount - 1))
      : 0,
  }))

  const signatureGroups = new Map<string, string[]>()
  for (let index = 0; index < members.length; index++) {
    const signature = canonicalJsonIdentity({
      fullCellMetric: fullMetrics[index].normalizedMetric.map((row) => row.map(rounded)),
      fractionalInternalDistances: internalDistances[index].map(rounded),
    })
    const group = signatureGroups.get(signature) ?? []
    group.push(members[index].id)
    signatureGroups.set(signature, group)
  }
  const periodicGaugeDuplicateGroups = [...signatureGroups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort(compareText))
    .sort((left, right) => compareText(left[0], right[0]))
  return {
    periodicDimension,
    periodicMeasureUnit: periodicDimension === 1
      ? 'angstrom'
      : periodicDimension === 2 ? 'angstrom^2' : 'angstrom^3',
    selectedPeriodicMeasure: selectedMetric.measure,
    expectedPairwisePeriodicMetricRms,
    expectedPairwiseFullCellMetricRms,
    expectedPairwiseFractionalInternalDistanceMatrixRmsA,
    maximumAbsolutePeriodicPrincipalStrain: Math.max(...memberDiagnostics.map((item) => (
      item.maximumAbsolutePeriodicPrincipalStrain
    ))),
    maximumAbsoluteFullCellPrincipalStrain: Math.max(...memberDiagnostics.map((item) => (
      item.maximumAbsoluteFullCellPrincipalStrain
    ))),
    maximumPeriodicCellConditionNumber: Math.max(...memberDiagnostics.map((item) => (
      item.periodicCellConditionNumber
    ))),
    maximumFullCellConditionNumber: Math.max(...memberDiagnostics.map((item) => (
      item.fullCellConditionNumber
    ))),
    maximumFractionalInternalDistanceMatrixRmsToSelectedA: Math.max(...memberDiagnostics.map((item) => (
      item.fractionalInternalDistanceMatrixRmsToSelectedA
    ))),
    minimumMemberPairDistanceA: Number.isFinite(minimumMemberPairDistanceA)
      ? minimumMemberPairDistanceA
      : null,
    minimumMemberPair,
    memberAtomPairCount: members.length * pairCount,
    minimumImageCandidateEvaluationCount: budget.count,
    memberDiagnostics,
    atomDiagnostics,
    periodicGaugeDuplicateGroups,
  }
}

export function parseZatomPeriodicStructureEnsemble(
  value: unknown,
  options: ParseZatomPeriodicStructureEnsembleOptions,
): ZatomPeriodicStructureEnsembleValidation {
  const maxMembers = positiveSafeInteger(options.maxMembers, 128, 'maxMembers')
  const maxAtomsPerMember = positiveSafeInteger(options.maxAtomsPerMember, 100_000, 'maxAtomsPerMember')
  const maxMemberAtoms = positiveSafeInteger(options.maxMemberAtoms, 2_000_000, 'maxMemberAtoms')
  const maxMemberAtomPairs = positiveSafeInteger(options.maxMemberAtomPairs, 2_000_000, 'maxMemberAtomPairs')
  const maxMinimumImageCandidateEvaluations = positiveSafeInteger(
    options.maxMinimumImageCandidateEvaluations,
    50_000_000,
    'maxMinimumImageCandidateEvaluations',
  )
  const maxMetadataBytes = positiveSafeInteger(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const maxArtifactBytes = positiveSafeInteger(options.maxArtifactBytes, 64 * 1024 * 1024, 'maxArtifactBytes')
  const root = exactObject(value, 'periodicStructureEnsemble', [
    'schemaVersion',
    'identityFingerprint',
    'periodic',
    'members',
    'selection',
    'weightModel',
    'acceptance',
    'evidenceSources',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      `schemaVersion must be ${ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA}`,
    )
  }
  const identityFingerprint = text(root.identityFingerprint, 'periodicStructureEnsemble.identityFingerprint', 128)
  const periodic = parsePeriodic(root.periodic, 'periodicStructureEnsemble.periodic')

  if (!Array.isArray(root.evidenceSources) || root.evidenceSources.length < 1 || root.evidenceSources.length > 64) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'periodicStructureEnsemble.evidenceSources must contain 1-64 entries',
    )
  }
  const evidenceSources: ZatomStructureEnsembleEvidenceSource[] = root.evidenceSources.map((raw, index) => {
    const field = `periodicStructureEnsemble.evidenceSources[${index}]`
    const record = exactObject(raw, field, [
      'id', 'engine', 'engineVersion', 'method', 'artifacts', 'citations', 'scopeWarning',
    ])
    return {
      id: token(record.id, `${field}.id`),
      engine: text(record.engine, `${field}.engine`, 256),
      engineVersion: text(record.engineVersion, `${field}.engineVersion`, 256),
      method: text(record.method, `${field}.method`),
      artifacts: parseArtifacts(record.artifacts, `${field}.artifacts`),
      citations: uniqueTextList(record.citations, `${field}.citations`, 1, 32),
      scopeWarning: text(record.scopeWarning, `${field}.scopeWarning`, 8192),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(evidenceSources.map((source) => source.id)).size !== evidenceSources.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'Evidence source IDs must be unique',
    )
  }
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id))

  const rawWeightModel = exactObject(root.weightModel, 'periodicStructureEnsemble.weightModel', [
    'kind', 'method', 'assumptions', 'applicability', 'scopeWarning',
  ], ['temperatureK'])
  const weightKinds = new Set<ZatomStructureEnsembleWeightKind>([
    'posterior-probability',
    'bootstrap-frequency',
    'model-averaging-weight',
    'boltzmann-potential-energy',
    'boltzmann-free-energy',
    'other-calibrated-probability',
  ])
  if (!weightKinds.has(rawWeightModel.kind as ZatomStructureEnsembleWeightKind)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'periodicStructureEnsemble.weightModel.kind is unsupported',
    )
  }
  const weightKind = rawWeightModel.kind as ZatomStructureEnsembleWeightKind
  const isBoltzmann = weightKind === 'boltzmann-potential-energy'
    || weightKind === 'boltzmann-free-energy'
  const rawApplicability = exactObject(
    rawWeightModel.applicability,
    'periodicStructureEnsemble.weightModel.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  if (rawApplicability.assessment !== 'in-domain'
    && rawApplicability.assessment !== 'unknown'
    && rawApplicability.assessment !== 'out-of-domain') {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'periodicStructureEnsemble.weightModel.applicability assessment is unsupported',
    )
  }
  if (isBoltzmann !== (rawWeightModel.temperatureK !== undefined)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'weightModel.temperatureK is required only for Boltzmann energy weighting',
    )
  }
  const weightModel: ZatomPeriodicStructureEnsemble['weightModel'] = {
    kind: weightKind,
    ...(isBoltzmann ? {
      temperatureK: numberIn(
        rawWeightModel.temperatureK,
        'periodicStructureEnsemble.weightModel.temperatureK',
        1,
        100_000,
      ),
    } : {}),
    method: text(rawWeightModel.method, 'periodicStructureEnsemble.weightModel.method'),
    assumptions: uniqueTextList(rawWeightModel.assumptions, 'periodicStructureEnsemble.weightModel.assumptions'),
    applicability: {
      assessment: rawApplicability.assessment,
      domain: text(rawApplicability.domain, 'periodicStructureEnsemble.weightModel.applicability.domain', 8192),
      reasons: uniqueTextList(
        rawApplicability.reasons,
        'periodicStructureEnsemble.weightModel.applicability.reasons',
      ),
    },
    scopeWarning: text(rawWeightModel.scopeWarning, 'periodicStructureEnsemble.weightModel.scopeWarning', 8192),
  }

  if (!Array.isArray(root.members) || root.members.length < 2 || root.members.length > maxMembers) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_budget_exceeded',
      `periodicStructureEnsemble.members must contain 2-${maxMembers} entries`,
    )
  }
  const rawMembers = root.members.map((raw, index) => {
    const field = `periodicStructureEnsemble.members[${index}]`
    const record = exactObject(raw, field, [
      'id', 'weight', 'structureFingerprint', 'structure', 'evidenceSourceIds',
    ], ['relativePotentialEnergyKcalMol', 'relativeFreeEnergyKcalMol'])
    const structure = normalizePeriodicStructure(record.structure, `${field}.structure`)
    if (structure.atoms.length > maxAtomsPerMember) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_budget_exceeded',
        `${field}.structure has ${structure.atoms.length} atoms; limit is ${maxAtomsPerMember}`,
      )
    }
    if (canonicalJsonIdentity(structure.lattice!.periodic) !== canonicalJsonIdentity(periodic)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_periodicity_mismatch',
        `${field}.structure periodic axes do not match the artifact`,
      )
    }
    const observedStructureFingerprint = fingerprintStructure(structure)
    const structureFingerprint = text(record.structureFingerprint, `${field}.structureFingerprint`, 128)
    if (structureFingerprint !== observedStructureFingerprint) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_structure_fingerprint_mismatch',
        `${field}.structureFingerprint does not match its exact structure`,
      )
    }
    if (fingerprintPeriodicStructureIdentity(structure) !== identityFingerprint) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_identity_mismatch',
        `${field}.structure does not share ordered identity ${identityFingerprint}`,
      )
    }
    const referencedSourceIds = uniqueTextList(
      record.evidenceSourceIds,
      `${field}.evidenceSourceIds`,
      1,
      64,
      128,
    ).map((sourceId) => token(sourceId, `${field}.evidenceSourceIds`))
    if (referencedSourceIds.some((sourceId) => !evidenceSourceIds.has(sourceId))) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_evidence_mismatch',
        `${field} references an unknown evidence source`,
      )
    }
    if ((weightKind === 'boltzmann-potential-energy')
      !== (record.relativePotentialEnergyKcalMol !== undefined)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'invalid_periodic_structure_ensemble',
        `${field}.relativePotentialEnergyKcalMol is required only for potential-energy Boltzmann weighting`,
      )
    }
    if ((weightKind === 'boltzmann-free-energy') !== (record.relativeFreeEnergyKcalMol !== undefined)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'invalid_periodic_structure_ensemble',
        `${field}.relativeFreeEnergyKcalMol is required only for free-energy Boltzmann weighting`,
      )
    }
    return {
      id: token(record.id, `${field}.id`),
      weight: numberIn(record.weight, `${field}.weight`, Number.MIN_VALUE, 1),
      structureFingerprint,
      structure,
      evidenceSourceIds: referencedSourceIds,
      ...(weightKind === 'boltzmann-potential-energy' ? {
        relativePotentialEnergyKcalMol: numberIn(
          record.relativePotentialEnergyKcalMol,
          `${field}.relativePotentialEnergyKcalMol`,
          -1_000_000,
          1_000_000,
        ),
      } : {}),
      ...(weightKind === 'boltzmann-free-energy' ? {
        relativeFreeEnergyKcalMol: numberIn(
          record.relativeFreeEnergyKcalMol,
          `${field}.relativeFreeEnergyKcalMol`,
          -1_000_000,
          1_000_000,
        ),
      } : {}),
    }
  })
  if (new Set(rawMembers.map((member) => member.id)).size !== rawMembers.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'Periodic structure member IDs must be unique',
    )
  }
  if (new Set(rawMembers.map((member) => member.structureFingerprint)).size !== rawMembers.length) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'Exact duplicate member structures must be aggregated into one weighted member',
    )
  }
  const atomCount = rawMembers[0].structure.atoms.length
  if (rawMembers.some((member) => member.structure.atoms.length !== atomCount)) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_identity_mismatch',
      'Every member must preserve the ordered atom count',
    )
  }
  const memberAtomCount = rawMembers.length * atomCount
  const memberAtomPairCount = rawMembers.length * atomCount * (atomCount - 1) / 2
  if (memberAtomCount > maxMemberAtoms || memberAtomPairCount > maxMemberAtomPairs) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_budget_exceeded',
      `Ensemble has ${memberAtomCount} member-atoms and ${memberAtomPairCount} member atom-pairs; limits are ${maxMemberAtoms} and ${maxMemberAtomPairs}`,
    )
  }
  const usedEvidenceIds = new Set(rawMembers.flatMap((member) => member.evidenceSourceIds))
  if (evidenceSources.some((source) => !usedEvidenceIds.has(source.id))) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_evidence_mismatch',
      'Every evidence source must be referenced by at least one member',
    )
  }

  const inputWeightSum = rawMembers.reduce((sum, member) => sum + member.weight, 0)
  if (!Number.isFinite(inputWeightSum) || Math.abs(inputWeightSum - 1) > 1e-8) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_weight_mismatch',
      `Periodic structure member weights sum to ${inputWeightSum}, not one within 1e-8`,
    )
  }
  const inputWeights = rawMembers.map((member) => member.weight / inputWeightSum)
  let canonicalWeights = inputWeights
  let canonicalEnergies: number[] | undefined
  if (isBoltzmann) {
    const energies = rawMembers.map((member) => weightKind === 'boltzmann-potential-energy'
      ? member.relativePotentialEnergyKcalMol!
      : member.relativeFreeEnergyKcalMol!)
    const minimumEnergy = Math.min(...energies)
    canonicalEnergies = energies.map((energy) => energy - minimumEnergy)
    const inverseRT = 1 / (GAS_CONSTANT_KCAL_PER_MOL_K * weightModel.temperatureK!)
    const unnormalized = canonicalEnergies.map((energy) => Math.exp(-energy * inverseRT))
    if (unnormalized.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_boltzmann_weight_underflow',
        'Relative energy range underflows positive Boltzmann weights',
      )
    }
    const sum = unnormalized.reduce((total, weight) => total + weight, 0)
    canonicalWeights = unnormalized.map((weight) => weight / sum)
    if (canonicalWeights.some((weight, index) => Math.abs(weight - inputWeights[index]) > 1e-8)) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_boltzmann_weight_mismatch',
        'Member weights do not match independently recomputed Boltzmann probabilities within 1e-8',
      )
    }
  }
  const members = rawMembers.map((member, index): ZatomPeriodicStructureEnsembleMember => ({
    ...member,
    weight: canonicalWeights[index],
    ...(canonicalEnergies && weightKind === 'boltzmann-potential-energy'
      ? { relativePotentialEnergyKcalMol: canonicalEnergies[index] }
      : {}),
    ...(canonicalEnergies && weightKind === 'boltzmann-free-energy'
      ? { relativeFreeEnergyKcalMol: canonicalEnergies[index] }
      : {}),
  })).sort((left, right) => compareText(left.id, right.id))
  const correctedWeightSum = members.reduce((sum, member) => sum + member.weight, 0)
  const correctionIndex = members.reduce((maximumIndex, member, index) => (
    member.weight > members[maximumIndex].weight ? index : maximumIndex
  ), 0)
  members[correctionIndex].weight += 1 - correctedWeightSum

  const rawAcceptance = exactObject(root.acceptance, 'periodicStructureEnsemble.acceptance', [
    'minimumWeightEffectiveMemberCount',
    'maximumPeriodicCellConditionNumber',
    'maximumFullCellConditionNumber',
  ])
  const acceptance = {
    minimumWeightEffectiveMemberCount: numberIn(
      rawAcceptance.minimumWeightEffectiveMemberCount,
      'periodicStructureEnsemble.acceptance.minimumWeightEffectiveMemberCount',
      1,
      members.length,
    ),
    maximumPeriodicCellConditionNumber: numberIn(
      rawAcceptance.maximumPeriodicCellConditionNumber,
      'periodicStructureEnsemble.acceptance.maximumPeriodicCellConditionNumber',
      1,
      1_000_000_000,
    ),
    maximumFullCellConditionNumber: numberIn(
      rawAcceptance.maximumFullCellConditionNumber,
      'periodicStructureEnsemble.acceptance.maximumFullCellConditionNumber',
      1,
      1_000_000_000,
    ),
  }
  const weightEffectiveMemberCount = 1 / members.reduce((sum, member) => sum + member.weight ** 2, 0)
  if (weightEffectiveMemberCount + 1e-12 < acceptance.minimumWeightEffectiveMemberCount) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_weight_effective_size_failed',
      `Weight effective member count ${weightEffectiveMemberCount} is below ${acceptance.minimumWeightEffectiveMemberCount}`,
    )
  }

  const rawSelection = exactObject(root.selection, 'periodicStructureEnsemble.selection', [
    'selectedMemberId', 'method', 'rationale',
  ])
  const selectedMemberId = token(rawSelection.selectedMemberId, 'periodicStructureEnsemble.selection.selectedMemberId')
  if (rawSelection.method !== 'explicit' && rawSelection.method !== 'maximum-weight') {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'selection.method must be explicit or maximum-weight',
    )
  }
  const selectedMember = members.find((member) => member.id === selectedMemberId)
  if (!selectedMember) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'invalid_periodic_structure_ensemble',
      'selection.selectedMemberId does not resolve',
    )
  }
  if (rawSelection.method === 'maximum-weight') {
    const maximumWeight = Math.max(...members.map((member) => member.weight))
    if (selectedMember.weight < maximumWeight - 1e-12) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'invalid_periodic_structure_ensemble',
        'maximum-weight selection must choose a maximum-weight member',
      )
    }
  }
  const selectedStructure = normalizePeriodicStructure(options.selectedStructure, 'selectedStructure')
  if (fingerprintStructure(selectedStructure) !== selectedMember.structureFingerprint) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_selected_structure_mismatch',
      `Selected structure does not match member ${selectedMemberId}`,
    )
  }
  const selection: ZatomPeriodicStructureEnsemble['selection'] = {
    selectedMemberId,
    method: rawSelection.method,
    rationale: text(rawSelection.rationale, 'periodicStructureEnsemble.selection.rationale', 8192),
  }

  const rawProvenance = exactObject(root.provenance, 'periodicStructureEnsemble.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const provenance: ZatomPeriodicStructureEnsemble['provenance'] = {
    engine: text(rawProvenance.engine, 'periodicStructureEnsemble.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'periodicStructureEnsemble.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'periodicStructureEnsemble.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts, 'periodicStructureEnsemble.provenance.artifacts'),
    parameters: jsonRecord(rawProvenance.parameters, 'periodicStructureEnsemble.provenance.parameters'),
    citations: uniqueTextList(rawProvenance.citations, 'periodicStructureEnsemble.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'periodicStructureEnsemble.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    metadata = jsonRecord(root.metadata, 'periodicStructureEnsemble.metadata')
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > maxMetadataBytes) {
      throw new ZatomPeriodicStructureEnsembleInputError(
        'periodic_structure_ensemble_budget_exceeded',
        `Periodic-ensemble metadata exceeds ${maxMetadataBytes} bytes`,
      )
    }
  }
  const ensemble: ZatomPeriodicStructureEnsemble = {
    schemaVersion: ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA,
    identityFingerprint,
    periodic,
    members,
    selection,
    weightModel,
    acceptance,
    evidenceSources,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const artifactBytes = new TextEncoder().encode(JSON.stringify(ensemble)).length
  if (artifactBytes > maxArtifactBytes) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_budget_exceeded',
      `Canonical periodic structure ensemble is ${artifactBytes} bytes; limit is ${maxArtifactBytes}`,
    )
  }
  const diagnostics = computeDiagnostics(
    members,
    selectedMemberId,
    periodic,
    acceptance.maximumPeriodicCellConditionNumber,
    acceptance.maximumFullCellConditionNumber,
    maxMinimumImageCandidateEvaluations,
  )
  if (diagnostics.maximumPeriodicCellConditionNumber
    > acceptance.maximumPeriodicCellConditionNumber + 1e-12) {
    throw new ZatomPeriodicStructureEnsembleInputError(
      'periodic_structure_ensemble_cell_condition_failed',
      `Maximum periodic cell condition number ${diagnostics.maximumPeriodicCellConditionNumber} exceeds ${acceptance.maximumPeriodicCellConditionNumber}`,
    )
  }

  const fingerprint = fingerprintPeriodicStructureEnsemble(ensemble)
  const applicability = weightModel.applicability.assessment
  const checks: ValidationCheck[] = [
    {
      id: 'periodic_structure_ensemble.identity',
      status: 'pass',
      message: `Periodic structure ensemble ${fingerprint} binds exact selected member ${selectedMemberId}`,
      metrics: { fingerprint, selectedMemberId, selectedStructureFingerprint: selectedMember.structureFingerprint },
    },
    {
      id: 'periodic_structure_ensemble.periodicity_and_topology',
      status: 'pass',
      message: `All ${members.length} members preserve ${atomCount} ordered atoms, ${selectedMember.structure.bonds === undefined ? 'unknown' : 'explicit fixed'} bonds, and periodic axes ${periodic.join(',')}`,
      metrics: {
        identityFingerprint,
        memberCount: members.length,
        atomCount,
        periodicDimension: diagnostics.periodicDimension,
      },
    },
    {
      id: 'periodic_structure_ensemble.weights',
      status: 'pass',
      message: `${weightKind} weights normalize to one with Kish effective member count ${weightEffectiveMemberCount}`,
      metrics: {
        weightKind,
        weightEffectiveMemberCount,
        minimumWeightEffectiveMemberCount: acceptance.minimumWeightEffectiveMemberCount,
      },
    },
    {
      id: 'periodic_structure_ensemble.cell_metric',
      status: 'pass',
      message: `Rotation-invariant periodic/full-cell metric spreads are ${diagnostics.expectedPairwisePeriodicMetricRms}/${diagnostics.expectedPairwiseFullCellMetricRms}; maximum periodic/full-cell principal strains are ${diagnostics.maximumAbsolutePeriodicPrincipalStrain}/${diagnostics.maximumAbsoluteFullCellPrincipalStrain}`,
      metrics: {
        expectedPairwisePeriodicMetricRms: diagnostics.expectedPairwisePeriodicMetricRms,
        expectedPairwiseFullCellMetricRms: diagnostics.expectedPairwiseFullCellMetricRms,
        maximumAbsolutePeriodicPrincipalStrain: diagnostics.maximumAbsolutePeriodicPrincipalStrain,
        maximumAbsoluteFullCellPrincipalStrain: diagnostics.maximumAbsoluteFullCellPrincipalStrain,
        selectedPeriodicMeasure: diagnostics.selectedPeriodicMeasure,
        periodicMeasureUnit: diagnostics.periodicMeasureUnit,
      },
    },
    {
      id: 'periodic_structure_ensemble.cell_condition',
      status: 'pass',
      message: `Maximum periodic/full-cell condition numbers are ${diagnostics.maximumPeriodicCellConditionNumber}/${diagnostics.maximumFullCellConditionNumber} against ${acceptance.maximumPeriodicCellConditionNumber}/${acceptance.maximumFullCellConditionNumber}`,
      metrics: {
        maximumPeriodicCellConditionNumber: diagnostics.maximumPeriodicCellConditionNumber,
        allowedMaximumPeriodicCellConditionNumber: acceptance.maximumPeriodicCellConditionNumber,
        maximumFullCellConditionNumber: diagnostics.maximumFullCellConditionNumber,
        allowedMaximumFullCellConditionNumber: acceptance.maximumFullCellConditionNumber,
      },
    },
    {
      id: 'periodic_structure_ensemble.fractional_internal_geometry',
      status: 'pass',
      message: `Cell-decoupled expected pairwise fractional internal distance-matrix RMSD is ${diagnostics.expectedPairwiseFractionalInternalDistanceMatrixRmsA} Å`,
      metrics: {
        expectedPairwiseFractionalInternalDistanceMatrixRmsA:
          diagnostics.expectedPairwiseFractionalInternalDistanceMatrixRmsA,
        maximumFractionalInternalDistanceMatrixRmsToSelectedA:
          diagnostics.maximumFractionalInternalDistanceMatrixRmsToSelectedA,
      },
    },
    {
      id: 'periodic_structure_ensemble.minimum_image_distance',
      status: diagnostics.minimumMemberPairDistanceA === null
        ? 'skipped'
        : diagnostics.minimumMemberPairDistanceA < 0.35
          ? 'fail'
          : diagnostics.minimumMemberPairDistanceA < 0.6 ? 'warn' : 'pass',
      message: diagnostics.minimumMemberPairDistanceA === null
        ? 'No atom pair exists for a minimum-image distance check'
        : `Certified closest periodic pair across all members is ${diagnostics.minimumMemberPairDistanceA} Å in ${diagnostics.minimumMemberPair!.memberId}`,
      metrics: {
        minimumMemberPairDistanceA: diagnostics.minimumMemberPairDistanceA,
        minimumImageCandidateEvaluationCount: diagnostics.minimumImageCandidateEvaluationCount,
      },
      atomIds: diagnostics.minimumMemberPair?.atomIds,
    },
    {
      id: 'periodic_structure_ensemble.nonperiodic_cell_scope',
      status: periodic.every(Boolean) ? 'skipped' : 'pass',
      message: periodic.every(Boolean)
        ? 'All lattice axes are periodic'
        : 'The metric among nonperiodic lattice vectors is fixed across members; only the periodic subspace carries cell uncertainty',
    },
    {
      id: 'periodic_structure_ensemble.periodic_gauge_duplicates',
      status: diagnostics.periodicGaugeDuplicateGroups.length ? 'warn' : 'pass',
      message: diagnostics.periodicGaugeDuplicateGroups.length
        ? `${diagnostics.periodicGaugeDuplicateGroups.length} group(s) are indistinguishable after global full-cell rotation/translation gauge removal at 1e-10 rounding and may duplicate probability mass`
        : 'No members duplicate the same full-cell metric and fractional internal pair geometry',
      metrics: { duplicateGroupCount: diagnostics.periodicGaugeDuplicateGroups.length },
    },
    {
      id: 'periodic_structure_ensemble.applicability',
      status: applicability === 'in-domain' ? 'pass' : applicability === 'out-of-domain' ? 'fail' : 'warn',
      message: `Periodic structural-weight applicability is ${applicability}: ${weightModel.applicability.reasons.join('; ')}`,
      metrics: { assessment: applicability },
    },
    {
      id: 'periodic_structure_ensemble.provenance',
      status: 'pass',
      message: `Every member cites evidence; provenance records ${provenance.engine} ${provenance.engineVersion}, immutable artifacts, parameters, and citations`,
      metrics: { evidenceSourceCount: evidenceSources.length, citationCount: provenance.citations.length },
    },
    {
      id: 'periodic_structure_ensemble.model_scope',
      status: 'warn',
      message: `${weightModel.scopeWarning} ${provenance.scopeWarning} This artifact assumes one ordered lattice-vector basis and atom correspondence; it does not prove crystallographic basis equivalence, phase completeness, cell-size convergence, stress equilibrium, parameter uncertainty, kinetics, or sampler convergence.`,
    },
  ]
  const inspectionTargets: InspectionTarget[] = []
  const selectedBounds = boundsOfPositions(selectedMember.structure.atoms.map((atom) => atom.position))
  if (selectedBounds) {
    inspectionTargets.push({
      id: 'periodic-structure-ensemble-selected-cell',
      reason: `Inspect selected periodic member ${selectedMemberId} and its lattice/cell contents`,
      center: selectedBounds.center,
      radius: Math.max(1, selectedBounds.radius + 1),
      atomIds: selectedMember.structure.atoms.slice(0, 256).map((atom) => atom.id),
      ...(selectedMember.structure.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
    })
  }
  const largestAtomSpread = [...diagnostics.atomDiagnostics].sort((left, right) => (
    right.expectedPairwiseFractionalInternalDistanceProfileRmsA
      - left.expectedPairwiseFractionalInternalDistanceProfileRmsA
    || compareText(left.atomId, right.atomId)
  ))[0]
  if (largestAtomSpread && largestAtomSpread.expectedPairwiseFractionalInternalDistanceProfileRmsA > 0) {
    const atom = selectedMember.structure.atoms.find((candidate) => candidate.id === largestAtomSpread.atomId)!
    inspectionTargets.push({
      id: 'periodic-structure-ensemble-largest-internal-spread',
      reason: `Inspect the atom with the largest cell-decoupled fractional internal distance-profile spread (${largestAtomSpread.expectedPairwiseFractionalInternalDistanceProfileRmsA} Å)`,
      center: atom.position,
      radius: 2,
      atomIds: [atom.id],
    })
  }
  if (diagnostics.minimumMemberPair) {
    const selectedAtomById = new Map(selectedMember.structure.atoms.map((atom) => [atom.id, atom]))
    const visibleIds = diagnostics.minimumMemberPair.atomIds.filter((atomId) => selectedAtomById.has(atomId))
    if (visibleIds.length === 2) {
      const bounds = boundsOfPositions(visibleIds.map((atomId) => selectedAtomById.get(atomId)!.position))!
      inspectionTargets.push({
        id: 'periodic-structure-ensemble-closest-member-pair',
        reason: `Inspect stable atom IDs forming the closest certified minimum-image pair in member ${diagnostics.minimumMemberPair.memberId}`,
        center: bounds.center,
        radius: Math.max(1, bounds.radius + 1),
        atomIds: visibleIds,
      })
    }
  }
  return {
    ensemble,
    fingerprint,
    weightEffectiveMemberCount,
    diagnostics,
    checks,
    inspectionTargets,
  }
}
