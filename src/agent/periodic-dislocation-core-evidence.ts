/** Topological core localization and differential-displacement evidence for relaxed periodic screw dipoles. */

import Delaunator from 'delaunator'

import type { InspectionTarget, JsonValue, Mat3, ValidationCheck, Vec3, ZatomStructure } from './contracts'
import {
  canonicalJsonIdentity,
  cartesianToFractional,
  certifiedMinimumImageVector,
  compareCanonicalText,
  fingerprintCanonicalJson,
  fingerprintStructure,
  fractionalToCartesian,
  wrapFractional,
} from './structure-math'
import {
  fingerprintFixedCellRelaxationEvidence,
  type ZatomFixedCellRelaxationEvidence,
} from './fixed-cell-relaxation-evidence'
import {
  fingerprintPeriodicDislocationDipoleEvidence,
  type ZatomPeriodicDislocationDipoleEvidence,
} from './periodic-dislocation-dipole-evidence'
import {
  fingerprintPeriodicDislocationRelaxationEvidence,
  parseZatomPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidence,
} from './periodic-dislocation-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA =
  'zatom.periodic-dislocation-core-evidence/v1' as const

export const ZATOM_PERIODIC_DISLOCATION_CORE_TRIANGULATION_ENGINE = {
  id: 'delaunator',
  version: '5.1.0',
} as const

export type ZatomPeriodicDislocationCoreId = 'positive' | 'negative'

export interface ZatomPeriodicDislocationCoreColumn {
  id: string
  atomIds: string[]
  transverseFractional: [number, number]
  transversePositionA: Vec3
  phaseRad: number
  phaseConcentration: number
}

export interface ZatomPeriodicDislocationCoreTriangle {
  id: string
  vertices: Array<{
    columnId: string
    imageShift: [number, number]
  }>
  centerTransverseFractional: [number, number]
  centerA: Vec3
  areaA2: number
  localizationResolutionA: number
  wrappedEdgePhaseDifferencesRad: [number, number, number]
  minimumBranchMarginRad: number
  windingCharge: number
  windingResidual: number
}

export interface ZatomPeriodicDislocationDifferentialDisplacementBond {
  id: string
  atomIds: [string, string]
  referenceDistanceA: number
  arrowCenterA: Vec3
  differentialDisplacementA: Vec3
  burgersAxisComponentA: number
  wrappedBurgersAxisComponentA: number
  absoluteWrappedBurgersAxisComponentA: number
  assignedCoreId: ZatomPeriodicDislocationCoreId
  distanceToAssignedCoreA: number
}

export interface ZatomPeriodicDislocationLocalizedCore {
  id: ZatomPeriodicDislocationCoreId
  sign: 1 | -1
  expectedWindingCharge: 1 | -1
  observedWindingCharge: number
  seedPositionA: Vec3
  seedTransverseFractional: [number, number]
  chargedTriangleIds: string[]
  topologicalCenterTransverseFractional: [number, number]
  topologicalCenterA: Vec3
  topologicalShiftFromSeedA: number
  localizationResolutionA: number
  signal: {
    bondCount: number
    totalAbsoluteWrappedBurgersAxisSignalA: number
    maximumAbsoluteWrappedBurgersAxisSignalA: number
    centerTransverseFractional: [number, number]
    centerA: Vec3
    centerShiftFromTopologicalA: number
    rmsRadiusA: number
    principalRmsRadiiA: [number, number]
    anisotropyRatio: number
  }
}

export interface ZatomPeriodicDislocationCoreEvidence {
  schemaVersion: typeof ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  seedStructureFingerprint: string
  relaxedDefectStructureFingerprint: string
  relaxedReferenceStructureFingerprint: string
  seedEvidenceFingerprint: string
  defectRelaxationEvidenceFingerprint: string
  referenceRelaxationEvidenceFingerprint: string
  relaxationEvidenceFingerprint: string
  method: {
    kind: 'periodic-column-phase-winding-and-differential-displacement'
    supportedGeometry: 'fully-periodic-straight-screw-dipole'
    phaseField: 'source-anchored-ordered-defect-minus-reference-projected-on-positive-burgers-axis-modulo-b'
    phaseGauge: 'global-translation-invariant-circular-phase'
    triangulation: 'periodic-3x3-delaunay-central-centroid'
    triangulationEngine: typeof ZATOM_PERIODIC_DISLOCATION_CORE_TRIANGULATION_ENGINE
    windingOrientation: 'counterclockwise-about-positive-burgers-axis'
    differentialDisplacement: 'complete-distinct-pair-reference-nearest-image-graph-with-reference-anchored-defect-image'
    lineFractionalSlice: number
  }
  geometry: {
    lineAxisIndex: 0 | 1 | 2
    transverseAxisIndices: [0 | 1 | 2, 0 | 1 | 2]
    lineUnitVector: Vec3
    positiveBurgersUnitVector: Vec3
    burgersMagnitudeA: number
    projectedTransverseCellVectorsA: [Vec3, Vec3]
    transverseBasisUnitVectors: [Vec3, Vec3]
  }
  settings: {
    neighborCutoffA: number
    signalRadiusA: number
    columnToleranceFractional: number
  }
  acceptance: {
    minimumColumnPhaseConcentration: number
    minimumPhaseBranchMarginRad: number
    maximumWindingResidual: number
    maximumCoreShiftA: number
    maximumLocalizationResolutionA: number
    minimumNeighborCount: number
    minimumCoreDifferentialDisplacementSignalA: number
    maximumSignalCenterShiftA: number
    maximumSignalRmsRadiusA: number
  }
  columns: ZatomPeriodicDislocationCoreColumn[]
  triangles: ZatomPeriodicDislocationCoreTriangle[]
  differentialDisplacementBonds: ZatomPeriodicDislocationDifferentialDisplacementBond[]
  cores: [ZatomPeriodicDislocationLocalizedCore, ZatomPeriodicDislocationLocalizedCore]
  metrics: {
    atomCount: number
    columnCount: number
    triangleCount: number
    chargedTriangleCount: number
    positiveWindingCharge: number
    negativeWindingCharge: number
    netWindingCharge: number
    totalAbsoluteWindingCharge: number
    ambiguousCoreAssignmentCount: number
    minimumColumnPhaseConcentration: number
    minimumPhaseBranchMarginRad: number
    maximumWindingResidual: number
    pairCandidateCount: number
    differentialDisplacementBondCount: number
    minimumNeighborCount: number
    maximumNeighborCount: number
    meanNeighborCount: number
    maximumAbsoluteWrappedBurgersAxisDifferentialA: number
    minimumImageCandidateEvaluations: number
    acceptancePassed: boolean
  }
  diagnostics: {
    worstPhaseConcentrationColumnId: string
    worstBranchMarginTriangleId: string
    maximumWindingResidualTriangleId: string
    maximumDifferentialDisplacementBondId: string
  }
  provenance: {
    method: string
    artifacts: Array<{ id: string; role: string; fingerprint: string }>
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ComposeZatomPeriodicDislocationCoreEvidenceInput {
  sourceStructure: ZatomStructure
  seedStructure: ZatomStructure
  relaxedDefectStructure: ZatomStructure
  relaxedReferenceStructure: ZatomStructure
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence
  defectRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  referenceRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  relaxationEvidence: ZatomPeriodicDislocationRelaxationEvidence
  settings: ZatomPeriodicDislocationCoreEvidence['settings']
  acceptance: ZatomPeriodicDislocationCoreEvidence['acceptance']
  provenance: ZatomPeriodicDislocationCoreEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomPeriodicDislocationCoreEvidenceOptions {
  sourceStructure: ZatomStructure
  seedStructure: ZatomStructure
  relaxedDefectStructure: ZatomStructure
  relaxedReferenceStructure: ZatomStructure
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence
  defectRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  referenceRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  relaxationEvidence: ZatomPeriodicDislocationRelaxationEvidence
  maxAtoms?: number
  maxPairCandidates?: number
  maxMinimumImageCandidateEvaluations?: number
  maxColumns?: number
  maxTriangles?: number
  maxBonds?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomPeriodicDislocationCoreEvidenceValidation {
  evidence: ZatomPeriodicDislocationCoreEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomPeriodicDislocationCoreEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPeriodicDislocationCoreEvidenceInputError'
    this.code = code
  }
}

type RecordValue = Record<string, unknown>

interface CandidateBudget {
  count: number
  maximum: number
}

interface AtomPhaseRow {
  index: number
  id: string
  uv: [number, number]
  phaseRad: number
}

interface RawDifferentialBond {
  atomIndices: [number, number]
  atomIds: [string, string]
  referenceDistanceA: number
  arrowCenterA: Vec3
  arrowUv: [number, number]
  differentialDisplacementA: Vec3
  burgersAxisComponentA: number
  wrappedBurgersAxisComponentA: number
  absoluteWrappedBurgersAxisComponentA: number
}

interface ReplicatedColumnPoint {
  x: number
  y: number
  columnIndex: number
  shift: [number, number]
  unwrappedUv: [number, number]
}

function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(value: unknown, field: string, required: readonly string[], optional: readonly string[] = []): RecordValue {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field}.${key} is unsupported`)
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field}.${key} is required`)
    }
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  const result = Number(value)
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'invalid_periodic_dislocation_core_evidence',
      `${field} must be finite in [${minimum}, ${maximum}]`,
    )
  }
  return result
}

function safeInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'invalid_periodic_dislocation_core_evidence',
      `${field} must be an integer in [${minimum}, ${maximum}]`,
    )
  }
  return result
}

function text(value: unknown, field: string, maximumLength = 16_384): string {
  if (typeof value !== 'string' || !value.length || value.length > maximumLength) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} must be non-empty text`)
  }
  return value
}

function token(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]*$/.test(result)) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} contains unsupported characters`)
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} must be a JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function uniqueTexts(value: unknown, field: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} must contain ${minimum}-${maximum} strings`)
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', `${field} must not repeat values`)
  }
  return result
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_context', `${field} must be a positive safe integer`)
  }
  return result
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintPeriodicDislocationCoreEvidence(value: ZatomPeriodicDislocationCoreEvidence): string {
  return fingerprintCanonicalJson(value)
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function scale(value: readonly number[], factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function unit(value: readonly number[], field: string): Vec3 {
  const magnitude = norm(value)
  if (!Number.isFinite(magnitude) || magnitude <= 1e-12) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', `${field} is degenerate`)
  }
  return scale(value, 1 / magnitude)
}

function projectOffLine(value: readonly number[], lineUnit: readonly number[]): Vec3 {
  return subtract(value, scale(lineUnit, dot(value, lineUnit)))
}

function wrap01(value: number): number {
  const wrapped = value - Math.floor(value)
  return wrapped === 1 ? 0 : wrapped
}

function periodicScalarDelta(left: number, right: number): number {
  const raw = right - left
  return raw - Math.round(raw)
}

function wrapAngle(value: number): number {
  let wrapped = value - 2 * Math.PI * Math.floor((value + Math.PI) / (2 * Math.PI))
  if (wrapped <= -Math.PI) wrapped += 2 * Math.PI
  return wrapped
}

function wrapPeriod(value: number, period: number): number {
  let wrapped = value - period * Math.floor((value + 0.5 * period) / period)
  if (wrapped <= -0.5 * period) wrapped += period
  return wrapped
}

function circularMean(values: readonly number[]): { angle: number; concentration: number } {
  const cosine = values.reduce((sum, value) => sum + Math.cos(value), 0)
  const sine = values.reduce((sum, value) => sum + Math.sin(value), 0)
  const angle = Math.atan2(sine, cosine)
  return { angle: Object.is(angle, -0) ? 0 : angle, concentration: Math.hypot(cosine, sine) / values.length }
}

function circularMean01(values: readonly number[]): number {
  const phase = circularMean(values.map((value) => 2 * Math.PI * value)).angle
  return wrap01(phase / (2 * Math.PI))
}

function transversePositionA(uv: readonly number[], vectors: readonly [Vec3, Vec3]): Vec3 {
  return add(scale(vectors[0], uv[0]), scale(vectors[1], uv[1]))
}

function pointInCellAtLineFraction(
  uv: readonly number[],
  lineFraction: number,
  cell: Mat3,
  transverseAxes: readonly [number, number],
  lineAxis: number,
): Vec3 {
  const fractional: Vec3 = [0, 0, 0]
  fractional[transverseAxes[0]] = wrap01(uv[0])
  fractional[transverseAxes[1]] = wrap01(uv[1])
  fractional[lineAxis] = wrap01(lineFraction)
  return fractionalToCartesian(fractional, cell)
}

function projectedMinimumSingularValue(vectors: readonly [Vec3, Vec3]): number {
  const a = dot(vectors[0], vectors[0])
  const b = dot(vectors[0], vectors[1])
  const c = dot(vectors[1], vectors[1])
  const trace = a + c
  const discriminant = Math.sqrt(Math.max(0, (a - c) ** 2 + 4 * b ** 2))
  const minimumEigenvalue = 0.5 * (trace - discriminant)
  if (!Number.isFinite(minimumEigenvalue) || minimumEigenvalue <= 1e-14) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', 'Projected transverse cell is singular')
  }
  return Math.sqrt(minimumEigenvalue)
}

function exactPeriodicTransverseDelta(
  leftUv: readonly number[],
  rightUv: readonly number[],
  vectors: readonly [Vec3, Vec3],
  minimumSingularValue: number,
  budget: CandidateBudget,
): { deltaUv: [number, number]; vectorA: Vec3; distanceA: number } {
  const baseUv: [number, number] = [
    periodicScalarDelta(leftUv[0], rightUv[0]),
    periodicScalarDelta(leftUv[1], rightUv[1]),
  ]
  const baseVector = transversePositionA(baseUv, vectors)
  const baseDistance = norm(baseVector)
  const radius = baseDistance === 0 ? 0 : Math.ceil(2 * baseDistance / minimumSingularValue + 1e-12)
  const candidateCount = (2 * radius + 1) ** 2
  if (!Number.isSafeInteger(candidateCount) || budget.count + candidateCount > budget.maximum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', 'Minimum-image candidate budget exceeded')
  }
  budget.count += candidateCount
  let bestUv = baseUv
  let bestVector = baseVector
  let bestDistance = baseDistance
  for (let first = -radius; first <= radius; first++) for (let second = -radius; second <= radius; second++) {
    const candidateUv: [number, number] = [baseUv[0] + first, baseUv[1] + second]
    const candidateVector = transversePositionA(candidateUv, vectors)
    const candidateDistance = norm(candidateVector)
    if (candidateDistance < bestDistance - 1e-12
      || (Math.abs(candidateDistance - bestDistance) <= 1e-12
        && (candidateUv[0] < bestUv[0] || (candidateUv[0] === bestUv[0] && candidateUv[1] < bestUv[1])))) {
      bestUv = candidateUv
      bestVector = candidateVector
      bestDistance = candidateDistance
    }
  }
  return { deltaUv: bestUv, vectorA: bestVector, distanceA: bestDistance }
}

function parseArtifacts(value: unknown): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 4 || value.length > 64) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', 'provenance.artifacts must contain 4-64 entries')
  }
  const result = value.map((item, index) => {
    const field = `evidence.provenance.artifacts[${index}]`
    const raw = exactObject(item, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(raw.id, `${field}.id`),
      role: text(raw.role, `${field}.role`),
      fingerprint: text(raw.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('invalid_periodic_dislocation_core_evidence', 'provenance artifact IDs must be unique')
  }
  return result
}

function parseSettings(value: unknown): ZatomPeriodicDislocationCoreEvidence['settings'] {
  const raw = exactObject(value, 'evidence.settings', [
    'neighborCutoffA', 'signalRadiusA', 'columnToleranceFractional',
  ])
  return {
    neighborCutoffA: finite(raw.neighborCutoffA, 'evidence.settings.neighborCutoffA', 1e-8, 1e6),
    signalRadiusA: finite(raw.signalRadiusA, 'evidence.settings.signalRadiusA', 1e-8, 1e6),
    columnToleranceFractional: finite(raw.columnToleranceFractional, 'evidence.settings.columnToleranceFractional', 1e-12, 0.1),
  }
}

function parseAcceptance(value: unknown): ZatomPeriodicDislocationCoreEvidence['acceptance'] {
  const raw = exactObject(value, 'evidence.acceptance', [
    'minimumColumnPhaseConcentration', 'minimumPhaseBranchMarginRad', 'maximumWindingResidual',
    'maximumCoreShiftA', 'maximumLocalizationResolutionA', 'minimumNeighborCount',
    'minimumCoreDifferentialDisplacementSignalA', 'maximumSignalCenterShiftA', 'maximumSignalRmsRadiusA',
  ])
  return {
    minimumColumnPhaseConcentration: finite(raw.minimumColumnPhaseConcentration, 'evidence.acceptance.minimumColumnPhaseConcentration', 0, 1),
    minimumPhaseBranchMarginRad: finite(raw.minimumPhaseBranchMarginRad, 'evidence.acceptance.minimumPhaseBranchMarginRad', 0, Math.PI),
    maximumWindingResidual: finite(raw.maximumWindingResidual, 'evidence.acceptance.maximumWindingResidual', 0, 0.5),
    maximumCoreShiftA: finite(raw.maximumCoreShiftA, 'evidence.acceptance.maximumCoreShiftA', 0, 1e6),
    maximumLocalizationResolutionA: finite(raw.maximumLocalizationResolutionA, 'evidence.acceptance.maximumLocalizationResolutionA', 0, 1e6),
    minimumNeighborCount: safeInteger(raw.minimumNeighborCount, 'evidence.acceptance.minimumNeighborCount', 0, 1_000_000),
    minimumCoreDifferentialDisplacementSignalA: finite(raw.minimumCoreDifferentialDisplacementSignalA, 'evidence.acceptance.minimumCoreDifferentialDisplacementSignalA', 0, 1e12),
    maximumSignalCenterShiftA: finite(raw.maximumSignalCenterShiftA, 'evidence.acceptance.maximumSignalCenterShiftA', 0, 1e6),
    maximumSignalRmsRadiusA: finite(raw.maximumSignalRmsRadiusA, 'evidence.acceptance.maximumSignalRmsRadiusA', 0, 1e6),
  }
}

function findRoot(parent: number[], index: number): number {
  let root = index
  while (parent[root] !== root) root = parent[root]
  while (parent[index] !== index) {
    const next = parent[index]
    parent[index] = root
    index = next
  }
  return root
}

function unionRoots(parent: number[], left: number, right: number): void {
  const leftRoot = findRoot(parent, left)
  const rightRoot = findRoot(parent, right)
  if (leftRoot === rightRoot) return
  if (leftRoot < rightRoot) parent[rightRoot] = leftRoot
  else parent[leftRoot] = rightRoot
}

function wrappedCellPosition(position: readonly number[], cell: Mat3): Vec3 {
  const fractional = cartesianToFractional(position, cell)
  if (!fractional) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', 'Cannot invert the common fixed cell')
  }
  return fractionalToCartesian(wrapFractional(fractional, [true, true, true]), cell)
}

function buildPeriodicTriangulation(
  columns: readonly ZatomPeriodicDislocationCoreColumn[],
  projectedVectors: readonly [Vec3, Vec3],
  basis: readonly [Vec3, Vec3],
  cell: Mat3,
  transverseAxes: readonly [number, number],
  lineAxis: number,
  lineFractionalSlice: number,
  maxTriangles: number,
): ZatomPeriodicDislocationCoreTriangle[] {
  if (columns.length < 3) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_triangulation_unresolved',
      'At least three distinct straight-line columns are required for topological localization',
    )
  }
  const points: ReplicatedColumnPoint[] = []
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
    const [u, v] = columns[columnIndex].transverseFractional
    for (let first = -1; first <= 1; first++) for (let second = -1; second <= 1; second++) {
      const unwrappedUv: [number, number] = [u + first, v + second]
      const projected = transversePositionA(unwrappedUv, projectedVectors)
      points.push({
        x: dot(projected, basis[0]),
        y: dot(projected, basis[1]),
        columnIndex,
        shift: [first, second],
        unwrappedUv,
      })
    }
  }
  points.sort((left, right) => (
    left.x - right.x
    || left.y - right.y
    || left.columnIndex - right.columnIndex
    || left.shift[0] - right.shift[0]
    || left.shift[1] - right.shift[1]
  ))
  const delaunay = Delaunator.from(points, (point) => point.x, (point) => point.y)
  const rawTriangles: Array<Omit<ZatomPeriodicDislocationCoreTriangle, 'id'>> = []
  const seen = new Set<string>()
  for (let offset = 0; offset < delaunay.triangles.length; offset += 3) {
    let vertices = [
      points[delaunay.triangles[offset]],
      points[delaunay.triangles[offset + 1]],
      points[delaunay.triangles[offset + 2]],
    ] as [ReplicatedColumnPoint, ReplicatedColumnPoint, ReplicatedColumnPoint]
    if (new Set(vertices.map((vertex) => vertex.columnIndex)).size !== 3) continue
    let signedDoubleArea = (vertices[1].x - vertices[0].x) * (vertices[2].y - vertices[0].y)
      - (vertices[1].y - vertices[0].y) * (vertices[2].x - vertices[0].x)
    if (Math.abs(signedDoubleArea) <= 1e-12) continue
    if (signedDoubleArea < 0) {
      vertices = [vertices[0], vertices[2], vertices[1]]
      signedDoubleArea = -signedDoubleArea
    }
    const unwrappedCenter: [number, number] = [
      vertices.reduce((sum, vertex) => sum + vertex.unwrappedUv[0], 0) / 3,
      vertices.reduce((sum, vertex) => sum + vertex.unwrappedUv[1], 0) / 3,
    ]
    const centralTolerance = 1e-10
    if (unwrappedCenter[0] < -centralTolerance || unwrappedCenter[0] >= 1 - centralTolerance
      || unwrappedCenter[1] < -centralTolerance || unwrappedCenter[1] >= 1 - centralTolerance) continue
    const key = vertices
      .map((vertex) => `${vertex.columnIndex}:${vertex.shift[0]}:${vertex.shift[1]}`)
      .sort()
      .join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const phases = vertices.map((vertex) => columns[vertex.columnIndex].phaseRad)
    const wrappedEdgePhaseDifferencesRad: [number, number, number] = [
      wrapAngle(phases[1] - phases[0]),
      wrapAngle(phases[2] - phases[1]),
      wrapAngle(phases[0] - phases[2]),
    ]
    const winding = wrappedEdgePhaseDifferencesRad.reduce((sum, value) => sum + value, 0) / (2 * Math.PI)
    const windingCharge = Math.round(winding)
    const centerX = vertices.reduce((sum, vertex) => sum + vertex.x, 0) / 3
    const centerY = vertices.reduce((sum, vertex) => sum + vertex.y, 0) / 3
    const centerTransverseFractional: [number, number] = [wrap01(unwrappedCenter[0]), wrap01(unwrappedCenter[1])]
    rawTriangles.push({
      vertices: vertices.map((vertex) => ({
        columnId: columns[vertex.columnIndex].id,
        imageShift: [...vertex.shift] as [number, number],
      })),
      centerTransverseFractional,
      centerA: pointInCellAtLineFraction(centerTransverseFractional, lineFractionalSlice, cell, transverseAxes, lineAxis),
      areaA2: 0.5 * signedDoubleArea,
      localizationResolutionA: Math.max(...vertices.map((vertex) => Math.hypot(vertex.x - centerX, vertex.y - centerY))),
      wrappedEdgePhaseDifferencesRad,
      minimumBranchMarginRad: Math.max(0, Math.min(...wrappedEdgePhaseDifferencesRad.map((value) => Math.PI - Math.abs(value)))),
      windingCharge,
      windingResidual: Math.abs(winding - windingCharge),
    })
    if (rawTriangles.length > maxTriangles) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', `Triangulation exceeds maxTriangles ${maxTriangles}`)
    }
  }
  rawTriangles.sort((left, right) => (
    left.centerTransverseFractional[0] - right.centerTransverseFractional[0]
    || left.centerTransverseFractional[1] - right.centerTransverseFractional[1]
    || compareCanonicalText(
      left.vertices.map((vertex) => `${vertex.columnId}:${vertex.imageShift.join(',')}`).join('|'),
      right.vertices.map((vertex) => `${vertex.columnId}:${vertex.imageShift.join(',')}`).join('|'),
    )
  ))
  if (!rawTriangles.length) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_triangulation_unresolved',
      'Periodic central-cell Delaunay triangulation produced no canonical triangles',
    )
  }
  return rawTriangles.map((triangle, index) => ({
    id: `triangle-${String(index + 1).padStart(6, '0')}`,
    ...triangle,
  }))
}

function covariancePrincipalRadii(xx: number, xy: number, yy: number): [number, number] {
  const trace = xx + yy
  const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2))
  return [
    Math.sqrt(Math.max(0, 0.5 * (trace + discriminant))),
    Math.sqrt(Math.max(0, 0.5 * (trace - discriminant))),
  ]
}

function buildValidation(
  rawValue: unknown,
  options: ParseZatomPeriodicDislocationCoreEvidenceOptions,
): ZatomPeriodicDislocationCoreEvidenceValidation {
  const maxAtoms = positiveBudget(options.maxAtoms, 2_000, 'maxAtoms')
  const maxPairCandidates = positiveBudget(options.maxPairCandidates, 2_000_000, 'maxPairCandidates')
  const maxMinimumImageCandidateEvaluations = positiveBudget(
    options.maxMinimumImageCandidateEvaluations,
    100_000_000,
    'maxMinimumImageCandidateEvaluations',
  )
  const maxColumns = positiveBudget(options.maxColumns, 10_000, 'maxColumns')
  const maxTriangles = positiveBudget(options.maxTriangles, 30_000, 'maxTriangles')
  const maxBonds = positiveBudget(options.maxBonds, 100_000, 'maxBonds')
  const maxMetadataBytes = positiveBudget(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const source = parseZatomStructure(options.sourceStructure)
  const seed = parseZatomStructure(options.seedStructure)
  const relaxedDefect = parseZatomStructure(options.relaxedDefectStructure)
  const relaxedReference = parseZatomStructure(options.relaxedReferenceStructure)
  const relaxationValidation = parseZatomPeriodicDislocationRelaxationEvidence(options.relaxationEvidence, {
    sourceStructure: source,
    seedStructure: seed,
    relaxedDefectStructure: relaxedDefect,
    relaxedReferenceStructure: relaxedReference,
    seedEvidence: options.seedEvidence,
    defectRelaxationEvidence: options.defectRelaxationEvidence,
    referenceRelaxationEvidence: options.referenceRelaxationEvidence,
  })
  const balancedReference = relaxationValidation.balancedReferenceStructure
  if (!seed.lattice || !relaxedDefect.lattice || !relaxedReference.lattice || !balancedReference.lattice) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', 'The complete periodic relaxation chain requires lattices')
  }
  const atomCount = relaxedDefect.atoms.length
  if (atomCount < 3 || atomCount > maxAtoms) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', `atomCount must be 3-${maxAtoms}`)
  }
  const pairCandidateCount = atomCount * (atomCount - 1) / 2
  if (!Number.isSafeInteger(pairCandidateCount) || pairCandidateCount > maxPairCandidates) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_budget_exceeded',
      `Complete pair scan requires ${pairCandidateCount} candidates above maxPairCandidates ${maxPairCandidates}`,
    )
  }

  const raw = exactObject(rawValue, 'evidence', [
    'schemaVersion', 'sourceStructureFingerprint', 'seedStructureFingerprint', 'relaxedDefectStructureFingerprint',
    'relaxedReferenceStructureFingerprint', 'seedEvidenceFingerprint', 'defectRelaxationEvidenceFingerprint',
    'referenceRelaxationEvidenceFingerprint', 'relaxationEvidenceFingerprint', 'method', 'geometry', 'settings',
    'acceptance', 'columns', 'triangles', 'differentialDisplacementBonds', 'cores', 'metrics', 'diagnostics', 'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'invalid_periodic_dislocation_core_evidence',
      `schemaVersion must be ${ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA}`,
    )
  }
  const settings = parseSettings(raw.settings)
  const acceptance = parseAcceptance(raw.acceptance)
  const rawProvenance = exactObject(raw.provenance, 'evidence.provenance', [
    'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const provenance: ZatomPeriodicDislocationCoreEvidence['provenance'] = {
    method: text(rawProvenance.method, 'evidence.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts),
    parameters: jsonRecord(rawProvenance.parameters, 'evidence.provenance.parameters'),
    citations: uniqueTexts(rawProvenance.citations, 'evidence.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'evidence.provenance.scopeWarning'),
  }
  const seedEvidenceFingerprint = fingerprintPeriodicDislocationDipoleEvidence(options.seedEvidence)
  const defectRelaxationEvidenceFingerprint = fingerprintFixedCellRelaxationEvidence(options.defectRelaxationEvidence)
  const referenceRelaxationEvidenceFingerprint = fingerprintFixedCellRelaxationEvidence(options.referenceRelaxationEvidence)
  const relaxationEvidenceFingerprint = fingerprintPeriodicDislocationRelaxationEvidence(relaxationValidation.evidence)
  const requiredArtifacts = new Map([
    ['periodic-dislocation-seed-evidence', seedEvidenceFingerprint],
    ['defect-fixed-cell-relaxation-evidence', defectRelaxationEvidenceFingerprint],
    ['reference-fixed-cell-relaxation-evidence', referenceRelaxationEvidenceFingerprint],
    ['periodic-dislocation-relaxation-evidence', relaxationEvidenceFingerprint],
  ])
  for (const [id, fingerprint] of requiredArtifacts) {
    const artifact = provenance.artifacts.find((item) => item.id === id)
    if (!artifact || artifact.fingerprint !== fingerprint) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError(
        'periodic_dislocation_core_provenance_mismatch',
        `provenance.artifacts must bind ${id} to ${fingerprint}`,
      )
    }
  }
  let metadata: Record<string, JsonValue> | undefined
  if (raw.metadata !== undefined) {
    if (utf8Bytes(raw.metadata) > maxMetadataBytes) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', 'metadata exceeds maxMetadataBytes')
    }
    metadata = jsonRecord(raw.metadata, 'evidence.metadata')
  }

  const seedEvidence = options.seedEvidence
  const lineAxisIndex = seedEvidence.construction.atommanIndices.line
  const transverseAxisIndices = [
    seedEvidence.construction.atommanIndices.motion,
    seedEvidence.construction.atommanIndices.cut,
  ] as [0 | 1 | 2, 0 | 1 | 2]
  const lineUnitVector = unit(seedEvidence.crystallography.rotatedLineUnitVector, 'line unit vector')
  const positiveBurgersUnitVector = unit(seedEvidence.crystallography.rotatedBurgersVectorA, 'positive Burgers vector')
  const burgersMagnitudeA = seedEvidence.crystallography.burgersMagnitudeA
  if (Math.abs(Math.abs(dot(lineUnitVector, positiveBurgersUnitVector)) - 1) > 1e-8) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_geometry_invalid',
      'V1 core localization supports only a straight screw dipole with Burgers vector parallel to the line',
    )
  }
  const cell = relaxedReference.lattice.vectors
  const projectedTransverseCellVectorsA = transverseAxisIndices.map((axis) => (
    projectOffLine(cell[axis], lineUnitVector)
  )) as [Vec3, Vec3]
  const firstBasis = unit(projectedTransverseCellVectorsA[0], 'first projected transverse cell vector')
  let secondBasis = unit(
    subtract(projectedTransverseCellVectorsA[1], scale(firstBasis, dot(projectedTransverseCellVectorsA[1], firstBasis))),
    'second projected transverse basis vector',
  )
  if (dot(cross(firstBasis, secondBasis), positiveBurgersUnitVector) < 0) secondBasis = scale(secondBasis, -1)
  const transverseBasisUnitVectors: [Vec3, Vec3] = [firstBasis, secondBasis]
  const transverseMinimumSingularValue = projectedMinimumSingularValue(projectedTransverseCellVectorsA)
  const candidateBudget: CandidateBudget = { count: 0, maximum: maxMinimumImageCandidateEvaluations }

  const defectNearSource: Vec3[] = []
  const referenceNearSource: Vec3[] = []
  const atomPhaseRows: AtomPhaseRow[] = []
  for (let index = 0; index < atomCount; index++) {
    let defectMotion
    let referenceMotion
    try {
      defectMotion = certifiedMinimumImageVector(
        subtract(relaxedDefect.atoms[index].position, seed.atoms[index].position),
        relaxedDefect.lattice,
        candidateBudget.maximum - candidateBudget.count,
      )
      candidateBudget.count += defectMotion.candidateEvaluations
      referenceMotion = certifiedMinimumImageVector(
        subtract(relaxedReference.atoms[index].position, balancedReference.atoms[index].position),
        relaxedReference.lattice,
        candidateBudget.maximum - candidateBudget.count,
      )
      candidateBudget.count += referenceMotion.candidateEvaluations
    } catch (error) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError(
        'periodic_dislocation_core_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
    const defectPosition = add(seed.atoms[index].position, defectMotion.vector)
    const referencePosition = add(balancedReference.atoms[index].position, referenceMotion.vector)
    defectNearSource.push(defectPosition)
    referenceNearSource.push(referencePosition)
    const fractional = cartesianToFractional(balancedReference.atoms[index].position, balancedReference.lattice.vectors)
    if (!fractional) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', 'Cannot invert balanced reference cell')
    }
    const directOrderedDisplacement = subtract(defectPosition, referencePosition)
    atomPhaseRows.push({
      index,
      id: relaxedDefect.atoms[index].id,
      uv: [wrap01(fractional[transverseAxisIndices[0]]), wrap01(fractional[transverseAxisIndices[1]])],
      phaseRad: wrapAngle(2 * Math.PI * dot(directOrderedDisplacement, positiveBurgersUnitVector) / burgersMagnitudeA),
    })
  }

  const parent = Array.from({ length: atomCount }, (_, index) => index)
  const rawBonds: RawDifferentialBond[] = []
  const neighborCounts = Array.from({ length: atomCount }, () => 0)
  for (let left = 0; left < atomCount; left++) for (let right = left + 1; right < atomCount; right++) {
    const leftUv = atomPhaseRows[left].uv
    const rightUv = atomPhaseRows[right].uv
    if (Math.abs(periodicScalarDelta(leftUv[0], rightUv[0])) <= settings.columnToleranceFractional
      && Math.abs(periodicScalarDelta(leftUv[1], rightUv[1])) <= settings.columnToleranceFractional) {
      unionRoots(parent, left, right)
    }
    let referenceVector
    try {
      referenceVector = certifiedMinimumImageVector(
        subtract(referenceNearSource[right], referenceNearSource[left]),
        relaxedReference.lattice,
        candidateBudget.maximum - candidateBudget.count,
      )
      candidateBudget.count += referenceVector.candidateEvaluations
    } catch (error) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError(
        'periodic_dislocation_core_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (referenceVector.distance > settings.neighborCutoffA + 1e-12) continue
    const defectRawVector = subtract(defectNearSource[right], defectNearSource[left])
    let relativeCorrection
    try {
      relativeCorrection = certifiedMinimumImageVector(
        subtract(defectRawVector, referenceVector.vector),
        relaxedDefect.lattice,
        candidateBudget.maximum - candidateBudget.count,
      )
      candidateBudget.count += relativeCorrection.candidateEvaluations
    } catch (error) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError(
        'periodic_dislocation_core_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
    const defectVector = add(referenceVector.vector, relativeCorrection.vector)
    const rawArrowCenter = add(defectNearSource[left], scale(defectVector, 0.5))
    const arrowCenterA = wrappedCellPosition(rawArrowCenter, cell)
    const arrowFractional = cartesianToFractional(arrowCenterA, cell)!
    const burgersAxisComponentA = dot(relativeCorrection.vector, positiveBurgersUnitVector)
    const wrappedBurgersAxisComponentA = wrapPeriod(burgersAxisComponentA, burgersMagnitudeA)
    rawBonds.push({
      atomIndices: [left, right],
      atomIds: [relaxedDefect.atoms[left].id, relaxedDefect.atoms[right].id],
      referenceDistanceA: referenceVector.distance,
      arrowCenterA,
      arrowUv: [wrap01(arrowFractional[transverseAxisIndices[0]]), wrap01(arrowFractional[transverseAxisIndices[1]])],
      differentialDisplacementA: relativeCorrection.vector,
      burgersAxisComponentA,
      wrappedBurgersAxisComponentA,
      absoluteWrappedBurgersAxisComponentA: Math.abs(wrappedBurgersAxisComponentA),
    })
    neighborCounts[left]++
    neighborCounts[right]++
    if (rawBonds.length > maxBonds) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', `Neighbor graph exceeds maxBonds ${maxBonds}`)
    }
  }

  const membersByRoot = new Map<number, AtomPhaseRow[]>()
  for (const row of atomPhaseRows) {
    const root = findRoot(parent, row.index)
    const members = membersByRoot.get(root) ?? []
    members.push(row)
    membersByRoot.set(root, members)
  }
  const columnDrafts = [...membersByRoot.values()].map((members) => {
    members.sort((left, right) => compareCanonicalText(left.id, right.id))
    const transverseFractional: [number, number] = [
      circularMean01(members.map((member) => member.uv[0])),
      circularMean01(members.map((member) => member.uv[1])),
    ]
    const phase = circularMean(members.map((member) => member.phaseRad))
    return { members, transverseFractional, phase }
  }).sort((left, right) => (
    left.transverseFractional[0] - right.transverseFractional[0]
    || left.transverseFractional[1] - right.transverseFractional[1]
    || compareCanonicalText(left.members[0].id, right.members[0].id)
  ))
  if (columnDrafts.length > maxColumns) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', `Column count exceeds maxColumns ${maxColumns}`)
  }
  const columns: ZatomPeriodicDislocationCoreColumn[] = columnDrafts.map((column, index) => ({
    id: `column-${String(index + 1).padStart(6, '0')}`,
    atomIds: column.members.map((member) => member.id),
    transverseFractional: column.transverseFractional,
    transversePositionA: transversePositionA(column.transverseFractional, projectedTransverseCellVectorsA),
    phaseRad: column.phase.angle,
    phaseConcentration: column.phase.concentration,
  }))
  const lineFractionalSlice = 0.5
  const triangles = buildPeriodicTriangulation(
    columns,
    projectedTransverseCellVectorsA,
    transverseBasisUnitVectors,
    cell,
    transverseAxisIndices,
    lineAxisIndex,
    lineFractionalSlice,
    maxTriangles,
  )

  const seedCoreRows = seedEvidence.construction.cores.map((core) => {
    const fractional = cartesianToFractional(core.positionA, seed.lattice!.vectors)
    if (!fractional) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_geometry_invalid', 'Cannot map seed core into the common cell')
    }
    return {
      id: core.id,
      sign: core.sign,
      positionA: [...core.positionA] as Vec3,
      uv: [wrap01(fractional[transverseAxisIndices[0]]), wrap01(fractional[transverseAxisIndices[1]])] as [number, number],
      lineFraction: wrap01(fractional[lineAxisIndex]),
    }
  }) as [
    { id: 'positive'; sign: 1; positionA: Vec3; uv: [number, number]; lineFraction: number },
    { id: 'negative'; sign: -1; positionA: Vec3; uv: [number, number]; lineFraction: number },
  ]
  const chargedTriangles = triangles.filter((triangle) => triangle.windingCharge !== 0)
  if (!chargedTriangles.length) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_topology_unresolved',
      'No non-zero phase-winding triangle was found; the supplied branch/cell cannot localize the screw dipole',
    )
  }
  const assignments = new Map<ZatomPeriodicDislocationCoreId, Array<{
    triangle: ZatomPeriodicDislocationCoreTriangle
    delta: ReturnType<typeof exactPeriodicTransverseDelta>
  }>>([
    ['positive', []],
    ['negative', []],
  ])
  let ambiguousCoreAssignmentCount = 0
  for (const triangle of chargedTriangles) {
    const distances = seedCoreRows.map((core) => ({
      core,
      delta: exactPeriodicTransverseDelta(
        core.uv,
        triangle.centerTransverseFractional,
        projectedTransverseCellVectorsA,
        transverseMinimumSingularValue,
        candidateBudget,
      ),
    }))
    distances.sort((left, right) => (
      left.delta.distanceA - right.delta.distanceA || compareCanonicalText(left.core.id, right.core.id)
    ))
    if (Math.abs(distances[0].delta.distanceA - distances[1].delta.distanceA)
      <= 1e-10 * Math.max(1, distances[0].delta.distanceA, distances[1].delta.distanceA)) {
      ambiguousCoreAssignmentCount++
    }
    assignments.get(distances[0].core.id)!.push({ triangle, delta: distances[0].delta })
  }
  for (const core of seedCoreRows) {
    if (!assignments.get(core.id)!.length) {
      throw new ZatomPeriodicDislocationCoreEvidenceInputError(
        'periodic_dislocation_core_topology_unresolved',
        `No charged triangle could be associated with the ${core.id} seed core`,
      )
    }
  }

  const coreDrafts = seedCoreRows.map((seedCore) => {
    const assigned = assignments.get(seedCore.id)!
    const totalWeight = assigned.reduce((sum, row) => sum + Math.abs(row.triangle.windingCharge), 0)
    const meanDeltaUv: [number, number] = [
      assigned.reduce((sum, row) => sum + Math.abs(row.triangle.windingCharge) * row.delta.deltaUv[0], 0) / totalWeight,
      assigned.reduce((sum, row) => sum + Math.abs(row.triangle.windingCharge) * row.delta.deltaUv[1], 0) / totalWeight,
    ]
    const topologicalCenterTransverseFractional: [number, number] = [
      wrap01(seedCore.uv[0] + meanDeltaUv[0]),
      wrap01(seedCore.uv[1] + meanDeltaUv[1]),
    ]
    return {
      seedCore,
      id: seedCore.id,
      sign: seedCore.sign,
      expectedWindingCharge: seedCore.sign,
      observedWindingCharge: assigned.reduce((sum, row) => sum + row.triangle.windingCharge, 0),
      seedPositionA: seedCore.positionA,
      seedTransverseFractional: seedCore.uv,
      chargedTriangleIds: assigned.map((row) => row.triangle.id).sort(),
      topologicalCenterTransverseFractional,
      topologicalCenterA: pointInCellAtLineFraction(
        topologicalCenterTransverseFractional,
        seedCore.lineFraction,
        cell,
        transverseAxisIndices,
        lineAxisIndex,
      ),
      topologicalShiftFromSeedA: norm(transversePositionA(meanDeltaUv, projectedTransverseCellVectorsA)),
      localizationResolutionA: Math.max(...assigned.map((row) => row.triangle.localizationResolutionA)),
    }
  })

  if (!rawBonds.length) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_neighbor_graph_unresolved',
      `neighborCutoffA ${settings.neighborCutoffA} produced no distinct-atom relaxed-reference nearest-image bonds`,
    )
  }
  const bondSignalRows: Array<{
    coreId: ZatomPeriodicDislocationCoreId
    delta: ReturnType<typeof exactPeriodicTransverseDelta>
    raw: RawDifferentialBond
  }> = []
  const differentialDisplacementBonds: ZatomPeriodicDislocationDifferentialDisplacementBond[] = rawBonds.map((bond, index) => {
    const distances = coreDrafts.map((core) => ({
      core,
      delta: exactPeriodicTransverseDelta(
        core.topologicalCenterTransverseFractional,
        bond.arrowUv,
        projectedTransverseCellVectorsA,
        transverseMinimumSingularValue,
        candidateBudget,
      ),
    })).sort((left, right) => (
      left.delta.distanceA - right.delta.distanceA || compareCanonicalText(left.core.id, right.core.id)
    ))
    bondSignalRows.push({ coreId: distances[0].core.id, delta: distances[0].delta, raw: bond })
    return {
      id: `dd-bond-${String(index + 1).padStart(7, '0')}`,
      atomIds: bond.atomIds,
      referenceDistanceA: bond.referenceDistanceA,
      arrowCenterA: bond.arrowCenterA,
      differentialDisplacementA: bond.differentialDisplacementA,
      burgersAxisComponentA: bond.burgersAxisComponentA,
      wrappedBurgersAxisComponentA: bond.wrappedBurgersAxisComponentA,
      absoluteWrappedBurgersAxisComponentA: bond.absoluteWrappedBurgersAxisComponentA,
      assignedCoreId: distances[0].core.id,
      distanceToAssignedCoreA: distances[0].delta.distanceA,
    }
  })

  const cores = coreDrafts.map((core) => {
    const selected = bondSignalRows.filter((row) => (
      row.coreId === core.id && row.delta.distanceA <= settings.signalRadiusA + 1e-12
    ))
    const totalWeight = selected.reduce((sum, row) => sum + row.raw.absoluteWrappedBurgersAxisComponentA, 0)
    const maximumSignal = selected.reduce((maximum, row) => Math.max(maximum, row.raw.absoluteWrappedBurgersAxisComponentA), 0)
    let meanDeltaUv: [number, number] = [0, 0]
    let meanX = 0
    let meanY = 0
    if (totalWeight > 0) {
      meanDeltaUv = [
        selected.reduce((sum, row) => sum + row.raw.absoluteWrappedBurgersAxisComponentA * row.delta.deltaUv[0], 0) / totalWeight,
        selected.reduce((sum, row) => sum + row.raw.absoluteWrappedBurgersAxisComponentA * row.delta.deltaUv[1], 0) / totalWeight,
      ]
      const meanVector = transversePositionA(meanDeltaUv, projectedTransverseCellVectorsA)
      meanX = dot(meanVector, transverseBasisUnitVectors[0])
      meanY = dot(meanVector, transverseBasisUnitVectors[1])
    }
    let covarianceXx = 0
    let covarianceXy = 0
    let covarianceYy = 0
    if (totalWeight > 0) {
      for (const row of selected) {
        const x = dot(row.delta.vectorA, transverseBasisUnitVectors[0]) - meanX
        const y = dot(row.delta.vectorA, transverseBasisUnitVectors[1]) - meanY
        const weight = row.raw.absoluteWrappedBurgersAxisComponentA
        covarianceXx += weight * x * x / totalWeight
        covarianceXy += weight * x * y / totalWeight
        covarianceYy += weight * y * y / totalWeight
      }
    }
    const principalRmsRadiiA = covariancePrincipalRadii(covarianceXx, covarianceXy, covarianceYy)
    const centerTransverseFractional: [number, number] = [
      wrap01(core.topologicalCenterTransverseFractional[0] + meanDeltaUv[0]),
      wrap01(core.topologicalCenterTransverseFractional[1] + meanDeltaUv[1]),
    ]
    const centerShiftFromTopologicalA = Math.hypot(meanX, meanY)
    const rmsRadiusA = Math.sqrt(Math.max(0, covarianceXx + covarianceYy))
    const anisotropyRatio = principalRmsRadiiA[1] > 1e-15
      ? principalRmsRadiiA[0] / principalRmsRadiiA[1]
      : principalRmsRadiiA[0] > 1e-15 ? 1e12 : 1
    return {
      id: core.id,
      sign: core.sign,
      expectedWindingCharge: core.expectedWindingCharge,
      observedWindingCharge: core.observedWindingCharge,
      seedPositionA: core.seedPositionA,
      seedTransverseFractional: core.seedTransverseFractional,
      chargedTriangleIds: core.chargedTriangleIds,
      topologicalCenterTransverseFractional: core.topologicalCenterTransverseFractional,
      topologicalCenterA: core.topologicalCenterA,
      topologicalShiftFromSeedA: core.topologicalShiftFromSeedA,
      localizationResolutionA: core.localizationResolutionA,
      signal: {
        bondCount: selected.length,
        totalAbsoluteWrappedBurgersAxisSignalA: totalWeight,
        maximumAbsoluteWrappedBurgersAxisSignalA: maximumSignal,
        centerTransverseFractional,
        centerA: pointInCellAtLineFraction(
          centerTransverseFractional,
          core.seedCore.lineFraction,
          cell,
          transverseAxisIndices,
          lineAxisIndex,
        ),
        centerShiftFromTopologicalA,
        rmsRadiusA,
        principalRmsRadiiA,
        anisotropyRatio,
      },
    }
  }) as [ZatomPeriodicDislocationLocalizedCore, ZatomPeriodicDislocationLocalizedCore]

  const minimumColumnPhaseConcentration = Math.min(...columns.map((column) => column.phaseConcentration))
  const minimumPhaseBranchMarginRad = Math.min(...triangles.map((triangle) => triangle.minimumBranchMarginRad))
  const maximumWindingResidual = Math.max(...triangles.map((triangle) => triangle.windingResidual))
  const positiveWindingCharge = triangles.reduce((sum, triangle) => sum + Math.max(0, triangle.windingCharge), 0)
  const negativeWindingCharge = triangles.reduce((sum, triangle) => sum + Math.min(0, triangle.windingCharge), 0)
  const netWindingCharge = positiveWindingCharge + negativeWindingCharge
  const totalAbsoluteWindingCharge = triangles.reduce((sum, triangle) => sum + Math.abs(triangle.windingCharge), 0)
  const minimumNeighborCount = Math.min(...neighborCounts)
  const maximumNeighborCount = Math.max(...neighborCounts)
  const meanNeighborCount = neighborCounts.reduce((sum, value) => sum + value, 0) / atomCount
  const maximumAbsoluteWrappedBurgersAxisDifferentialA = Math.max(
    ...differentialDisplacementBonds.map((bond) => bond.absoluteWrappedBurgersAxisComponentA),
  )
  const worstPhaseConcentrationColumn = columns.reduce((worst, column) => (
    column.phaseConcentration < worst.phaseConcentration ? column : worst
  ))
  const worstBranchMarginTriangle = triangles.reduce((worst, triangle) => (
    triangle.minimumBranchMarginRad < worst.minimumBranchMarginRad ? triangle : worst
  ))
  const maximumWindingResidualTriangle = triangles.reduce((worst, triangle) => (
    triangle.windingResidual > worst.windingResidual ? triangle : worst
  ))
  const maximumDifferentialDisplacementBond = differentialDisplacementBonds.reduce((worst, bond) => (
    bond.absoluteWrappedBurgersAxisComponentA > worst.absoluteWrappedBurgersAxisComponentA ? bond : worst
  ))
  const upstreamGate = relaxationValidation.evidence.metrics.acceptancePassed
  const columnGate = minimumColumnPhaseConcentration + 1e-12 >= acceptance.minimumColumnPhaseConcentration
  const branchGate = minimumPhaseBranchMarginRad + 1e-12 >= acceptance.minimumPhaseBranchMarginRad
  const windingResidualGate = maximumWindingResidual <= acceptance.maximumWindingResidual + 1e-12
  const chargeGate = netWindingCharge === 0
    && totalAbsoluteWindingCharge === 2
    && cores.every((core) => core.observedWindingCharge === core.expectedWindingCharge)
    && ambiguousCoreAssignmentCount === 0
  const coreShiftGate = cores.every((core) => core.topologicalShiftFromSeedA <= acceptance.maximumCoreShiftA + 1e-12)
  const resolutionGate = cores.every((core) => core.localizationResolutionA <= acceptance.maximumLocalizationResolutionA + 1e-12)
  const neighborGate = minimumNeighborCount >= acceptance.minimumNeighborCount
  const signalGate = cores.every((core) => (
    core.signal.totalAbsoluteWrappedBurgersAxisSignalA + 1e-12 >= acceptance.minimumCoreDifferentialDisplacementSignalA
  ))
  const signalCenterGate = cores.every((core) => core.signal.centerShiftFromTopologicalA <= acceptance.maximumSignalCenterShiftA + 1e-12)
  const signalSpreadGate = cores.every((core) => core.signal.rmsRadiusA <= acceptance.maximumSignalRmsRadiusA + 1e-12)
  const acceptancePassed = upstreamGate && columnGate && branchGate && windingResidualGate && chargeGate
    && coreShiftGate && resolutionGate && neighborGate && signalGate && signalCenterGate && signalSpreadGate

  const evidence: ZatomPeriodicDislocationCoreEvidence = {
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: fingerprintStructure(source),
    seedStructureFingerprint: fingerprintStructure(seed),
    relaxedDefectStructureFingerprint: fingerprintStructure(relaxedDefect),
    relaxedReferenceStructureFingerprint: fingerprintStructure(relaxedReference),
    seedEvidenceFingerprint,
    defectRelaxationEvidenceFingerprint,
    referenceRelaxationEvidenceFingerprint,
    relaxationEvidenceFingerprint,
    method: {
      kind: 'periodic-column-phase-winding-and-differential-displacement',
      supportedGeometry: 'fully-periodic-straight-screw-dipole',
      phaseField: 'source-anchored-ordered-defect-minus-reference-projected-on-positive-burgers-axis-modulo-b',
      phaseGauge: 'global-translation-invariant-circular-phase',
      triangulation: 'periodic-3x3-delaunay-central-centroid',
      triangulationEngine: ZATOM_PERIODIC_DISLOCATION_CORE_TRIANGULATION_ENGINE,
      windingOrientation: 'counterclockwise-about-positive-burgers-axis',
      differentialDisplacement: 'complete-distinct-pair-reference-nearest-image-graph-with-reference-anchored-defect-image',
      lineFractionalSlice,
    },
    geometry: {
      lineAxisIndex,
      transverseAxisIndices,
      lineUnitVector,
      positiveBurgersUnitVector,
      burgersMagnitudeA,
      projectedTransverseCellVectorsA,
      transverseBasisUnitVectors,
    },
    settings,
    acceptance,
    columns,
    triangles,
    differentialDisplacementBonds,
    cores,
    metrics: {
      atomCount,
      columnCount: columns.length,
      triangleCount: triangles.length,
      chargedTriangleCount: chargedTriangles.length,
      positiveWindingCharge,
      negativeWindingCharge,
      netWindingCharge,
      totalAbsoluteWindingCharge,
      ambiguousCoreAssignmentCount,
      minimumColumnPhaseConcentration,
      minimumPhaseBranchMarginRad,
      maximumWindingResidual,
      pairCandidateCount,
      differentialDisplacementBondCount: differentialDisplacementBonds.length,
      minimumNeighborCount,
      maximumNeighborCount,
      meanNeighborCount,
      maximumAbsoluteWrappedBurgersAxisDifferentialA,
      minimumImageCandidateEvaluations: candidateBudget.count,
      acceptancePassed,
    },
    diagnostics: {
      worstPhaseConcentrationColumnId: worstPhaseConcentrationColumn.id,
      worstBranchMarginTriangleId: worstBranchMarginTriangle.id,
      maximumWindingResidualTriangleId: maximumWindingResidualTriangle.id,
      maximumDifferentialDisplacementBondId: maximumDifferentialDisplacementBond.id,
    },
    provenance,
    ...(metadata ? { metadata } : {}),
  }

  const checks: ValidationCheck[] = [
    {
      id: 'periodic_dislocation_core.upstream_chain',
      status: upstreamGate ? 'pass' : 'fail',
      message: upstreamGate
        ? 'The exact accepted seed, defect/reference fixed-cell relaxations, and matched relaxation evidence were replayed'
        : 'The upstream matched periodic-dislocation relaxation chain does not pass all declared gates',
      metrics: { relaxationEvidenceFingerprint },
    },
    {
      id: 'periodic_dislocation_core.mapping_branch',
      status: 'pass',
      message: 'Ordered relaxed positions were independently rebound to the nearest periodic image of their exact defect/reference sources before phase construction',
      metrics: { atomCount, minimumImageCandidateEvaluations: candidateBudget.count },
    },
    {
      id: 'periodic_dislocation_core.straight_line_collapse',
      status: columnGate ? 'pass' : 'fail',
      message: `Collapsed ${atomCount} atoms into ${columns.length} periodic line columns; minimum circular phase concentration is ${minimumColumnPhaseConcentration.toPrecision(7)}`,
      metrics: { minimumColumnPhaseConcentration, requiredMinimum: acceptance.minimumColumnPhaseConcentration },
      atomIds: worstPhaseConcentrationColumn.atomIds.slice(0, 80),
    },
    {
      id: 'periodic_dislocation_core.phase_branch',
      status: branchGate ? 'pass' : 'fail',
      message: `Minimum wrapped-edge distance from the ±π phase branch is ${minimumPhaseBranchMarginRad.toExponential(5)} rad`,
      metrics: { minimumPhaseBranchMarginRad, requiredMinimum: acceptance.minimumPhaseBranchMarginRad },
    },
    {
      id: 'periodic_dislocation_core.winding_residual',
      status: windingResidualGate ? 'pass' : 'fail',
      message: `Maximum integer winding residual across ${triangles.length} periodic Delaunay triangles is ${maximumWindingResidual.toExponential(5)}`,
      metrics: { maximumWindingResidual, allowedMaximum: acceptance.maximumWindingResidual },
    },
    {
      id: 'periodic_dislocation_core.topological_charge',
      status: chargeGate ? 'pass' : 'fail',
      message: `Observed positive/negative winding charges ${positiveWindingCharge}/${negativeWindingCharge}, net ${netWindingCharge}, absolute ${totalAbsoluteWindingCharge}`,
      metrics: { positiveWindingCharge, negativeWindingCharge, netWindingCharge, totalAbsoluteWindingCharge, ambiguousCoreAssignmentCount },
    },
    {
      id: 'periodic_dislocation_core.localization',
      status: coreShiftGate && resolutionGate ? 'pass' : 'fail',
      message: `Topological centers shift ${cores[0].topologicalShiftFromSeedA.toPrecision(6)}/${cores[1].topologicalShiftFromSeedA.toPrecision(6)} Å with triangle resolution ${cores[0].localizationResolutionA.toPrecision(6)}/${cores[1].localizationResolutionA.toPrecision(6)} Å`,
      metrics: {
        positiveCoreShiftA: cores[0].topologicalShiftFromSeedA,
        negativeCoreShiftA: cores[1].topologicalShiftFromSeedA,
        positiveResolutionA: cores[0].localizationResolutionA,
        negativeResolutionA: cores[1].localizationResolutionA,
      },
    },
    {
      id: 'periodic_dislocation_core.neighbor_graph',
      status: neighborGate ? 'pass' : 'fail',
      message: `Complete distinct-atom pair scan yields ${differentialDisplacementBonds.length} nearest-image reference bonds with ${minimumNeighborCount}-${maximumNeighborCount} graph neighbors/atom`,
      metrics: { neighborCutoffA: settings.neighborCutoffA, minimumNeighborCount, maximumNeighborCount, meanNeighborCount, pairCandidateCount },
    },
    {
      id: 'periodic_dislocation_core.differential_displacement_signal',
      status: signalGate && signalCenterGate && signalSpreadGate ? 'pass' : 'fail',
      message: `Core DD signals total ${cores[0].signal.totalAbsoluteWrappedBurgersAxisSignalA.toPrecision(6)}/${cores[1].signal.totalAbsoluteWrappedBurgersAxisSignalA.toPrecision(6)} Å with RMS radii ${cores[0].signal.rmsRadiusA.toPrecision(6)}/${cores[1].signal.rmsRadiusA.toPrecision(6)} Å`,
      metrics: {
        positiveSignalA: cores[0].signal.totalAbsoluteWrappedBurgersAxisSignalA,
        negativeSignalA: cores[1].signal.totalAbsoluteWrappedBurgersAxisSignalA,
        positiveSignalCenterShiftA: cores[0].signal.centerShiftFromTopologicalA,
        negativeSignalCenterShiftA: cores[1].signal.centerShiftFromTopologicalA,
        positiveSignalRmsRadiusA: cores[0].signal.rmsRadiusA,
        negativeSignalRmsRadiusA: cores[1].signal.rmsRadiusA,
      },
      atomIds: maximumDifferentialDisplacementBond.atomIds,
    },
    {
      id: 'periodic_dislocation_core.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} The winding center is resolved only to the chosen discrete column triangulation; DD center/spread depend on neighbor cutoff and signal radius. The DD graph keeps one certified nearest image for each distinct atom pair and excludes self-image/multiple-image bonds. This is not a Nye-tensor field, partial-dislocation decomposition, Peierls barrier/stress, mobility, isolated core energy, or infinite-size proof.`,
    },
  ]

  const atomIdsForCore = (core: ZatomPeriodicDislocationLocalizedCore): string[] => {
    const ids = new Set<string>()
    for (const bond of differentialDisplacementBonds) {
      if (bond.assignedCoreId !== core.id || bond.distanceToAssignedCoreA > settings.signalRadiusA + 1e-12) continue
      for (const id of bond.atomIds) ids.add(id)
      if (ids.size >= 80) break
    }
    if (!ids.size) {
      for (const id of relaxationValidation.evidence.construction.coreAnchorAtomIds) {
        ids.add(id)
        if (ids.size >= 80) break
      }
    }
    return [...ids]
  }
  const positiveAtomIds = atomIdsForCore(cores[0])
  const negativeAtomIds = atomIdsForCore(cores[1])
  const overviewDelta = exactPeriodicTransverseDelta(
    cores[0].topologicalCenterTransverseFractional,
    cores[1].topologicalCenterTransverseFractional,
    projectedTransverseCellVectorsA,
    transverseMinimumSingularValue,
    candidateBudget,
  )
  const overviewCenter = wrappedCellPosition(add(cores[0].topologicalCenterA, scale(overviewDelta.vectorA, 0.5)), cell)
  const worstColumnAtom = relaxedDefect.atoms.find((atom) => atom.id === worstPhaseConcentrationColumn.atomIds[0])!
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'periodic-dislocation-core-overview',
      reason: `Inspect the localized +1/-1 screw cores and their ${overviewDelta.distanceA.toPrecision(6)} Å periodic transverse separation`,
      center: overviewCenter,
      radius: Math.max(2 * burgersMagnitudeA, 0.6 * overviewDelta.distanceA),
      atomIds: [...new Set([...positiveAtomIds.slice(0, 40), ...negativeAtomIds.slice(0, 40)])],
    },
    {
      id: 'periodic-dislocation-core-positive',
      reason: `Inspect +1 winding core; ${cores[0].topologicalShiftFromSeedA.toPrecision(6)} Å from seed with ${cores[0].localizationResolutionA.toPrecision(6)} Å triangulation resolution`,
      center: cores[0].topologicalCenterA,
      radius: Math.max(2.5, settings.signalRadiusA),
      atomIds: positiveAtomIds,
    },
    {
      id: 'periodic-dislocation-core-negative',
      reason: `Inspect -1 winding core; ${cores[1].topologicalShiftFromSeedA.toPrecision(6)} Å from seed with ${cores[1].localizationResolutionA.toPrecision(6)} Å triangulation resolution`,
      center: cores[1].topologicalCenterA,
      radius: Math.max(2.5, settings.signalRadiusA),
      atomIds: negativeAtomIds,
    },
    {
      id: 'periodic-dislocation-core-maximum-dd-bond',
      reason: `Inspect maximum wrapped Burgers-axis differential displacement ${maximumDifferentialDisplacementBond.absoluteWrappedBurgersAxisComponentA.toPrecision(6)} Å`,
      center: maximumDifferentialDisplacementBond.arrowCenterA,
      radius: Math.max(2.5, settings.neighborCutoffA),
      atomIds: maximumDifferentialDisplacementBond.atomIds,
    },
    {
      id: 'periodic-dislocation-core-worst-phase-column',
      reason: `Inspect least coherent straight-line column with circular concentration ${worstPhaseConcentrationColumn.phaseConcentration.toPrecision(7)}`,
      center: [...worstColumnAtom.position],
      radius: Math.max(2.5, burgersMagnitudeA),
      atomIds: worstPhaseConcentrationColumn.atomIds.slice(0, 80),
      ...(worstPhaseConcentrationColumn.atomIds.length > 80 ? { atomIdsTruncated: true as const } : {}),
    },
  ]

  evidence.metrics.minimumImageCandidateEvaluations = candidateBudget.count
  checks[1].metrics = { atomCount, minimumImageCandidateEvaluations: candidateBudget.count }
  return {
    evidence,
    fingerprint: fingerprintPeriodicDislocationCoreEvidence(evidence),
    checks,
    inspectionTargets,
  }
}

export function parseZatomPeriodicDislocationCoreEvidence(
  value: unknown,
  options: ParseZatomPeriodicDislocationCoreEvidenceOptions,
): ZatomPeriodicDislocationCoreEvidenceValidation {
  if (utf8Bytes(value) > positiveBudget(options.maxArtifactBytes, 64 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError('periodic_dislocation_core_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const validation = buildValidation(value, options)
  if (canonicalJsonIdentity(value) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'periodic_dislocation_core_derived_mismatch',
      'Evidence differs from the canonical upstream-bound phase, triangulation, DD graph, core metrics, diagnostics, or fingerprints',
    )
  }
  return validation
}

export function composeZatomPeriodicDislocationCoreEvidence(
  input: ComposeZatomPeriodicDislocationCoreEvidenceInput,
  budgets: Pick<
    ParseZatomPeriodicDislocationCoreEvidenceOptions,
    | 'maxAtoms'
    | 'maxPairCandidates'
    | 'maxMinimumImageCandidateEvaluations'
    | 'maxColumns'
    | 'maxTriangles'
    | 'maxBonds'
    | 'maxMetadataBytes'
  > = {},
): ZatomPeriodicDislocationCoreEvidenceValidation {
  return buildValidation({
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: '',
    seedStructureFingerprint: '',
    relaxedDefectStructureFingerprint: '',
    relaxedReferenceStructureFingerprint: '',
    seedEvidenceFingerprint: '',
    defectRelaxationEvidenceFingerprint: '',
    referenceRelaxationEvidenceFingerprint: '',
    relaxationEvidenceFingerprint: '',
    method: {},
    geometry: {},
    settings: input.settings,
    acceptance: input.acceptance,
    columns: [],
    triangles: [],
    differentialDisplacementBonds: [],
    cores: [],
    metrics: {},
    diagnostics: {},
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    seedStructure: input.seedStructure,
    relaxedDefectStructure: input.relaxedDefectStructure,
    relaxedReferenceStructure: input.relaxedReferenceStructure,
    seedEvidence: input.seedEvidence,
    defectRelaxationEvidence: input.defectRelaxationEvidence,
    referenceRelaxationEvidence: input.referenceRelaxationEvidence,
    relaxationEvidence: input.relaxationEvidence,
    ...budgets,
  })
}
