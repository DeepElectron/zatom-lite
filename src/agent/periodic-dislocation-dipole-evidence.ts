/** Canonical evidence for a fully periodic anisotropic screw-dislocation dipole. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import {
  canonicalJsonIdentity,
  cartesianToFractional,
  compareCanonicalText,
  determinant3,
  fingerprintCanonicalJson,
  fingerprintStructure,
  fractionalToCartesian,
  invert3,
} from './structure-math'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import type { ZatomCartesianAxis, ZatomStiffnessMatrixGPa } from './continuum-dislocation-evidence'
import { symbolToAtomicNumber } from '../chemistry/periodic-table'

export const ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA =
  'zatom.periodic-dislocation-dipole-evidence/v1' as const

export type ZatomConventionalCellSetting = 'p' | 'a' | 'b' | 'c' | 'i' | 'f' | 't1' | 't2'

export const PERIODIC_DISLOCATION_PROBE_FRACTIONS: readonly Vec3[] = [
  [0.113, 0.173, 0.271],
  [0.217, 0.389, 0.443],
  [0.319, 0.617, 0.731],
  [0.421, 0.827, 0.887],
  [0.563, 0.263, 0.659],
  [0.773, 0.541, 0.347],
  [0.887, 0.719, 0.151],
  [0.947, 0.937, 0.521],
] as const

export interface ZatomPeriodicDislocationSeamProbe {
  axis: 0 | 1 | 2
  probeIndex: number
  fractionalPointA: Vec3
  pointA: Vec3
  pointB: Vec3
  displacementA: Vec3
  displacementB: Vec3
  residualVectorA: Vec3
  residualA: number
}

export interface ZatomPeriodicDislocationConvergenceProbe {
  probeIndex: number
  fractionalPointA: Vec3
  pointA: Vec3
  currentDisplacementA: Vec3
  comparisonDisplacementA: Vec3
  gaugeCorrectedDifferenceA: Vec3
  residualA: number
}

export interface ZatomPeriodicDislocationDipoleEvidence {
  schemaVersion: typeof ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  referenceStructureFingerprint: string
  resultStructureFingerprint: string
  referenceStructure: ZatomStructure
  elasticity: {
    model: 'anisotropic-linear-elasticity'
    coordinateFrame: 'source-cell-cartesian'
    voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy']
    stiffnessMatrixGPa: ZatomStiffnessMatrixGPa
  }
  crystallography: {
    conventionalSetting: ZatomConventionalCellSetting
    burgersMiller: Vec3
    lineMiller: Vec3
    slipPlaneMiller: Vec3
    primitiveBurgersCoefficients: Vec3
    inputBurgersCartesianA: Vec3
    inputLineCartesianA: Vec3
    inputSlipPlaneNormalCartesian: Vec3
    rotatedBurgersVectorA: Vec3
    rotatedLineUnitVector: Vec3
    rotatedSlipPlaneNormalUnitVector: Vec3
    mAxis: ZatomCartesianAxis
    nAxis: ZatomCartesianAxis
    lineAxis: ZatomCartesianAxis
    burgersMagnitudeA: number
    character: 'screw'
    characterAngleDeg: number
    slipPlaneResidual: number
  }
  construction: {
    kind: 'periodic-screw-dipole'
    representation: 'tilted-quadripole'
    boxtilt: true
    sizeMultipliers: [number, number, number]
    imageReplicaCount: number
    imageCellCount: number
    comparisonImageReplicaCount: number
    comparisonImageCellCount: number
    shiftIndex: number
    atommanIndices: {
      motion: 0 | 1 | 2
      cut: 0 | 1 | 2
      line: 0 | 1 | 2
    }
    cores: [
      { id: 'positive'; sign: 1; positionA: Vec3 },
      { id: 'negative'; sign: -1; positionA: Vec3 },
    ]
    netBurgersVectorA: Vec3
  }
  mapping: {
    mode: 'atomman-oriented-supercell-order'
    sourceTemplateAtomCount: number
    supercellMultiplicity: number
    atomCount: number
    sourceElementCounts: Record<string, number>
    generatedElementCounts: Record<string, number>
    elementTypeMap: Array<{ element: string; atommanType: number }>
    referenceAndResultPreserveOrderIdsElements: true
    sourceSiteLineage: 'element-class-only'
  }
  boundary: {
    sourcePeriodic: [true, true, true]
    referencePeriodic: [true, true, true]
    resultPeriodic: [true, true, true]
    zeroOriginCanonicalCells: true
    baseAndResultCellsDifferOnlyByBalancingShear: true
  }
  periodicityProbes: {
    field: 'cai-regularized-volterra-displacement-before-balancing-strain'
    rows: ZatomPeriodicDislocationSeamProbe[]
  }
  imageConvergence: {
    comparison: 'current-versus-two-fewer-image-replicas'
    rigidGaugeA: Vec3
    rows: ZatomPeriodicDislocationConvergenceProbe[]
  }
  acceptance: {
    maximumTensorSymmetryResidualGPa: number
    minimumStiffnessEigenvalueGPa: number
    maximumStiffnessConditionNumber: number
    maximumScrewCharacterAngleDeg: number
    maximumSlipPlaneResidual: number
    minimumTransverseCellVectorPerBurgers: number
    minimumCoreSeparationPerBurgers: number
    minimumCoreClearanceA: number
    maximumPeriodicSeamResidualA: number
    maximumImageConvergenceDisplacementA: number
    maximumBalancingPrincipalStrain: number
    maximumVolumeChangeFraction: number
    maximumNonaffineDisplacementA: number
    minimumPairDistanceA: number
  }
  metrics: {
    tensorSymmetryResidualGPa: number
    stiffnessEigenvaluesGPa: number[]
    minimumStiffnessEigenvalueGPa: number
    maximumStiffnessEigenvalueGPa: number
    stiffnessConditionNumber: number
    minimumTransverseCellVectorA: number
    minimumTransverseCellVectorPerBurgers: number
    minimumCoreSeparationA: number
    minimumCoreSeparationPerBurgers: number
    minimumCoreClearanceA: number
    referenceCellVolumeA3: number
    resultCellVolumeA3: number
    volumeChangeFraction: number
    balancingPrincipalEngineeringStrains: number[]
    maximumAbsoluteBalancingPrincipalStrain: number
    quadripoleTiltResidualA: number
    balancingShearResidualA: number
    maximumNonaffineDisplacementA: number
    rmsNonaffineDisplacementA: number
    minimumPairDistanceA: number
    pairCount: number
    minimumImageCandidateEvaluations: number
    maximumPeriodicSeamResidualA: number
    rmsPeriodicSeamResidualA: number
    maximumImageConvergenceDisplacementA: number
    rmsImageConvergenceDisplacementA: number
    netBurgersMagnitudeA: number
    acceptancePassed: boolean
  }
  diagnostics: {
    nearestCoreAtomIds: string[]
    maximumNonaffineDisplacementAtomId: string
    closestPairAtomIds: [string, string]
    worstSeamProbe: { axis: 0 | 1 | 2; probeIndex: number }
    worstConvergenceProbeIndex: number
  }
  provenance: {
    engine: 'atomman'
    engineVersion: string
    dependencies: { numpyVersion: string; scipyVersion: string }
    method: string
    package: {
      realPath: string
      fileCount: number
      totalBytes: number
      sha256: string
    }
    artifacts: Array<{ id: string; role: string; fingerprint: string }>
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ComposeZatomPeriodicDislocationDipoleEvidenceInput {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  referenceStructure: ZatomStructure
  elasticity: Pick<ZatomPeriodicDislocationDipoleEvidence['elasticity'], 'model' | 'coordinateFrame' | 'voigtOrder' | 'stiffnessMatrixGPa'>
  crystallography: Pick<
    ZatomPeriodicDislocationDipoleEvidence['crystallography'],
    | 'conventionalSetting'
    | 'burgersMiller'
    | 'lineMiller'
    | 'slipPlaneMiller'
    | 'primitiveBurgersCoefficients'
    | 'rotatedBurgersVectorA'
    | 'rotatedLineUnitVector'
    | 'rotatedSlipPlaneNormalUnitVector'
    | 'mAxis'
    | 'nAxis'
  >
  construction: Pick<
    ZatomPeriodicDislocationDipoleEvidence['construction'],
    'sizeMultipliers' | 'imageReplicaCount' | 'shiftIndex' | 'atommanIndices' | 'cores'
  >
  mapping: Pick<ZatomPeriodicDislocationDipoleEvidence['mapping'], 'mode'>
  periodicityProbes: Pick<ZatomPeriodicDislocationDipoleEvidence['periodicityProbes'], 'field' | 'rows'>
  imageConvergence: Pick<ZatomPeriodicDislocationDipoleEvidence['imageConvergence'], 'comparison' | 'rigidGaugeA' | 'rows'>
  acceptance: ZatomPeriodicDislocationDipoleEvidence['acceptance']
  provenance: ZatomPeriodicDislocationDipoleEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomPeriodicDislocationDipoleEvidenceOptions {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  maxSourceAtoms?: number
  maxOutputAtoms?: number
  maxMinimumImageCandidateEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomPeriodicDislocationDipoleEvidenceValidation {
  evidence: ZatomPeriodicDislocationDipoleEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomPeriodicDislocationDipoleEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPeriodicDislocationDipoleEvidenceInputError'
    this.code = code
  }
}

const VOIGT_ORDER = ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'] as const
const AXIS_INDEX: Record<ZatomCartesianAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }
const AXES: ZatomCartesianAxis[] = ['x', 'y', 'z']
const SETTINGS: ZatomConventionalCellSetting[] = ['p', 'a', 'b', 'c', 'i', 'f', 't1', 't2']
const FULL_PBC: [true, true, true] = [true, true, true]
const VECTOR_TOLERANCE = 1e-8

const CONVENTIONAL_TO_PRIMITIVE: Record<ZatomConventionalCellSetting, Mat3> = {
  p: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  a: [[1, 0, 0], [0, 1, -1], [0, 1, 1]],
  b: [[1, 0, -1], [0, 1, 0], [1, 0, 1]],
  c: [[1, -1, 0], [1, 1, 0], [0, 0, 1]],
  i: [[0, -1, -1], [1, 1, 0], [1, 0, 1]],
  f: [[1, -1, 1], [1, 1, -1], [-1, 1, 1]],
  t1: [[1, -1, 0], [0, 1, -1], [1, 1, 1]],
  t2: [[-1, 1, 0], [0, -1, 1], [1, 1, 1]],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(
  value: unknown,
  field: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'invalid_periodic_dislocation_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'invalid_periodic_dislocation_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = finite(value, field, minimum, maximum)
  if (!Number.isSafeInteger(result)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} must be an integer`)
  }
  return result
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_context', `${field} must be a positive integer`)
  }
  return result
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'invalid_periodic_dislocation_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 256): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/\[\], -]+$/.test(result)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} contains unsupported characters`)
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return finite(value, field)
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} must be a JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintPeriodicDislocationDipoleEvidence(
  value: ZatomPeriodicDislocationDipoleEvidence,
): string {
  return fingerprintCanonicalJson(value)
}

function vec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} must contain three numbers`)
  }
  return [finite(value[0], `${field}[0]`), finite(value[1], `${field}[1]`), finite(value[2], `${field}[2]`)]
}

function axis(value: unknown, field: string): ZatomCartesianAxis {
  if (value !== 'x' && value !== 'y' && value !== 'z') {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `${field} must be x, y, or z`)
  }
  return value
}

function setting(value: unknown): ZatomConventionalCellSetting {
  if (!SETTINGS.includes(value as ZatomConventionalCellSetting)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'crystallography.conventionalSetting is unsupported')
  }
  return value as ZatomConventionalCellSetting
}

function stiffnessMatrix(value: unknown): ZatomStiffnessMatrixGPa {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'stiffnessMatrixGPa must be 6x6')
  }
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.length !== 6) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `stiffnessMatrixGPa[${i}] must contain six numbers`)
    }
    return row.map((item, j) => finite(item, `stiffnessMatrixGPa[${i}][${j}]`, -1e9, 1e9))
  }) as ZatomStiffnessMatrixGPa
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * right[index], 0)
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function scale(value: readonly number[], factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function norm(value: readonly number[]): number {
  return Math.hypot(...value)
}

function unit(value: readonly number[], field: string): Vec3 {
  const magnitude = norm(value)
  if (!(magnitude > 0)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', `${field} must be non-zero`)
  }
  return scale(value, 1 / magnitude)
}

function maximumVectorResidual(left: readonly number[], right: readonly number[]): number {
  return Math.max(...left.map((value, index) => Math.abs(value - right[index])))
}

function transpose(matrix: readonly number[][]): number[][] {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]))
}

function multiply(left: readonly number[][], right: readonly number[][]): number[][] {
  return left.map((row) => right[0].map((_, column) => (
    row.reduce((sum, value, index) => sum + value * right[index][column], 0)
  )))
}

function gram(vectors: readonly Vec3[]): number[][] {
  return vectors.map((left) => vectors.map((right) => dot(left, right)))
}

/** Deterministic Jacobi diagonalization for finite symmetric matrices. */
function symmetricEigenvalues(matrix: readonly number[][]): number[] {
  const size = matrix.length
  const a = matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2))
  for (let iteration = 0; iteration < 512; iteration++) {
    let p = 0
    let q = Math.min(1, size - 1)
    let largest = 0
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const candidate = Math.abs(a[i][j])
        if (candidate > largest) { largest = candidate; p = i; q = j }
      }
    }
    const diagonalScale = Math.max(1, ...a.map((row, i) => Math.abs(row[i])))
    if (largest <= 1e-13 * diagonalScale || size === 1) break
    const angle = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p])
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const app = a[p][p]
    const aqq = a[q][q]
    const apq = a[p][q]
    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq
    a[p][q] = 0
    a[q][p] = 0
    for (let k = 0; k < size; k++) {
      if (k === p || k === q) continue
      const akp = a[k][p]
      const akq = a[k][q]
      a[k][p] = c * akp - s * akq
      a[p][k] = a[k][p]
      a[k][q] = s * akp + c * akq
      a[q][k] = a[k][q]
    }
  }
  return a.map((row, index) => row[index]).sort((left, right) => left - right)
}

function cholesky3(matrix: readonly number[][]): Mat3 | null {
  const lower: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let row = 0; row < 3; row++) {
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

function invertLower3(lower: Mat3): Mat3 {
  const result: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      let value = row === column ? 1 : 0
      for (let index = 0; index < row; index++) value -= lower[row][index] * result[index][column]
      result[row][column] = value / lower[row][row]
    }
  }
  return result
}

function normalizedCellStrains(reference: Mat3, result: Mat3): number[] {
  const referenceCholesky = cholesky3(gram(reference))
  if (!referenceCholesky) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Reference cell metric is not positive definite')
  }
  const inverse = invertLower3(referenceCholesky)
  const normalized = multiply(multiply(inverse, gram(result)), transpose(inverse))
  return symmetricEigenvalues(normalized).map((value) => Math.sqrt(Math.max(0, value)) - 1).sort((left, right) => left - right)
}

function matrixVector(vector: readonly number[], matrix: Mat3): Vec3 {
  return [
    vector[0] * matrix[0][0] + vector[1] * matrix[1][0] + vector[2] * matrix[2][0],
    vector[0] * matrix[0][1] + vector[1] * matrix[1][1] + vector[2] * matrix[2][1],
    vector[0] * matrix[0][2] + vector[1] * matrix[1][2] + vector[2] * matrix[2][2],
  ]
}

function planeNormal(hkl: Vec3, lattice: Mat3): Vec3 {
  const inverse = invert3(lattice)
  if (!inverse) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Source lattice is singular')
  }
  return [
    inverse[0][0] * hkl[0] + inverse[0][1] * hkl[1] + inverse[0][2] * hkl[2],
    inverse[1][0] * hkl[0] + inverse[1][1] * hkl[1] + inverse[1][2] * hkl[2],
    inverse[2][0] * hkl[0] + inverse[2][1] * hkl[1] + inverse[2][2] * hkl[2],
  ]
}

function elementCounts(structure: ZatomStructure): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const atom of structure.atoms) counts[atom.element] = (counts[atom.element] ?? 0) + 1
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => compareCanonicalText(left, right)))
}

function assertCanonicalPeriodicStructure(
  structure: ZatomStructure,
  field: string,
  maxAtoms: number,
  unitCellTemplate: boolean,
): void {
  const minimumAtoms = unitCellTemplate ? 1 : 2
  if (structure.atoms.length < minimumAtoms || structure.atoms.length > maxAtoms) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', `${field} atom count must be ${minimumAtoms}-${maxAtoms}`)
  }
  if (!structure.lattice || canonicalJsonIdentity(structure.lattice.periodic) !== canonicalJsonIdentity(FULL_PBC)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_structure_mismatch', `${field} must be fully periodic`)
  }
  const volume = determinant3(structure.lattice.vectors)
  if (!Number.isFinite(volume) || volume <= 1e-12) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_structure_mismatch', `${field} must have a right-handed nonsingular cell`)
  }
  if ((structure.bonds?.length ?? 0) !== 0) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `${field} cannot carry explicit bonds in v1`)
  }
  const ids = new Set<string>()
  for (let index = 0; index < structure.atoms.length; index++) {
    const atom = structure.atoms[index]
    if (ids.has(atom.id)) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `${field} repeats atom ID ${atom.id}`)
    }
    ids.add(atom.id)
    if (symbolToAtomicNumber(atom.element) <= 0) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `${field} atom ${atom.id} has an unknown element symbol`)
    }
    if (atom.properties && Object.keys(atom.properties).length) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `${field} cannot carry atom properties in v1`)
    }
    if (!unitCellTemplate && atom.id !== `periodic-dipole-${String(index + 1).padStart(6, '0')}`) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `${field} atom IDs are not the canonical generated sequence`)
    }
    const fractional = cartesianToFractional(atom.position, structure.lattice.vectors)
    if (!fractional || fractional.some((value) => value < -1e-9 || value >= 1 + 1e-9)) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_structure_mismatch', `${field} atom ${atom.id} is outside its zero-origin cell`)
    }
  }
}

function assertReferenceResultMapping(reference: ZatomStructure, result: ZatomStructure): void {
  if (reference.atoms.length !== result.atoms.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', 'Reference/result atom counts differ')
  }
  for (let index = 0; index < reference.atoms.length; index++) {
    if (reference.atoms[index].id !== result.atoms[index].id || reference.atoms[index].element !== result.atoms[index].element) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', `Reference/result atom identity differs at index ${index}`)
    }
  }
}

function periodicBasisMinimumSingularValue(cell: Mat3, axes: readonly number[]): number {
  const eigenvalues = symmetricEigenvalues(gram(axes.map((axisIndex) => cell[axisIndex])))
  const minimum = Math.min(...eigenvalues)
  if (!Number.isFinite(minimum) || minimum <= 1e-14) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Periodic cell basis is singular')
  }
  return Math.sqrt(minimum)
}

interface CandidateBudget { count: number; maximum: number }

function exactMinimumImageVector(
  rawFractionalDelta: Vec3,
  cell: Mat3,
  axes: readonly number[],
  minimumSingularValue: number,
  budget: CandidateBudget,
): { vector: Vec3; distance: number } {
  const delta: Vec3 = [...rawFractionalDelta]
  for (const axisIndex of axes) delta[axisIndex] -= Math.round(delta[axisIndex])
  const base = fractionalToCartesian(delta, cell)
  const baseDistance = norm(base)
  if (baseDistance === 0) {
    budget.count++
    if (budget.count > budget.maximum) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Minimum-image candidate budget exceeded')
    }
    return { vector: [0, 0, 0], distance: 0 }
  }
  const radius = Math.ceil(2 * baseDistance / minimumSingularValue + 1e-12)
  const ranges = ([0, 1, 2] as const).map((axisIndex) => axes.includes(axisIndex)
    ? Array.from({ length: 2 * radius + 1 }, (_, index) => index - radius)
    : [0])
  const candidateCount = ranges[0].length * ranges[1].length * ranges[2].length
  if (!Number.isSafeInteger(candidateCount) || budget.count + candidateCount > budget.maximum) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Minimum-image candidate budget exceeded')
  }
  budget.count += candidateCount
  let best: Vec3 = base
  let bestSquared = dot(base, base)
  for (const first of ranges[0]) for (const second of ranges[1]) for (const third of ranges[2]) {
    const vector = fractionalToCartesian([delta[0] + first, delta[1] + second, delta[2] + third], cell)
    const squared = dot(vector, vector)
    if (squared < bestSquared) { bestSquared = squared; best = vector }
  }
  return { vector: best, distance: Math.sqrt(bestSquared) }
}

function exactDistance(
  left: readonly number[],
  right: readonly number[],
  cell: Mat3,
  minimumSingularValue: number,
  budget: CandidateBudget,
  axes: readonly number[] = [0, 1, 2],
): number {
  const leftFractional = cartesianToFractional(left, cell)
  const rightFractional = cartesianToFractional(right, cell)
  if (!leftFractional || !rightFractional) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Cannot invert periodic cell')
  }
  return exactMinimumImageVector(subtract(rightFractional, leftFractional), cell, axes, minimumSingularValue, budget).distance
}

function projectOffLine(value: readonly number[], lineUnit: readonly number[]): Vec3 {
  return subtract(value, scale(lineUnit, dot(value, lineUnit)))
}

function projectedTransverseMinimumSingularValue(
  cell: Mat3,
  transverseAxes: readonly number[],
  lineUnit: Vec3,
): number {
  const projected = transverseAxes.map((axisIndex) => projectOffLine(cell[axisIndex], lineUnit))
  const minimum = Math.min(...symmetricEigenvalues(gram(projected)))
  if (!Number.isFinite(minimum) || minimum <= 1e-14) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Projected transverse cell is singular')
  }
  return Math.sqrt(minimum)
}

/** Exact periodic distance between two infinite parallel lines, measured transverse to the line. */
function exactTransverseLineDistance(
  left: readonly number[],
  right: readonly number[],
  cell: Mat3,
  transverseAxes: readonly number[],
  lineUnit: Vec3,
  minimumSingularValue: number,
  budget: CandidateBudget,
): number {
  const rawDelta = subtract(right, left)
  const fractional = cartesianToFractional(rawDelta, cell)
  if (!fractional) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Cannot invert periodic cell')
  }
  for (const axisIndex of transverseAxes) fractional[axisIndex] -= Math.round(fractional[axisIndex])
  const base = projectOffLine(fractionalToCartesian(fractional, cell), lineUnit)
  const baseDistance = norm(base)
  const radius = baseDistance === 0 ? 0 : Math.ceil(2 * baseDistance / minimumSingularValue + 1e-12)
  const ranges = ([0, 1, 2] as const).map((axisIndex) => transverseAxes.includes(axisIndex)
    ? Array.from({ length: 2 * radius + 1 }, (_, index) => index - radius)
    : [0])
  const candidateCount = ranges[0].length * ranges[1].length * ranges[2].length
  if (!Number.isSafeInteger(candidateCount) || budget.count + candidateCount > budget.maximum) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Minimum-image candidate budget exceeded')
  }
  budget.count += candidateCount
  let best = baseDistance
  for (const first of ranges[0]) for (const second of ranges[1]) for (const third of ranges[2]) {
    const vector = fractionalToCartesian([
      fractional[0] + first,
      fractional[1] + second,
      fractional[2] + third,
    ], cell)
    best = Math.min(best, norm(projectOffLine(vector, lineUnit)))
  }
  return best
}

function shortestNonzeroTransverseImage(
  cell: Mat3,
  transverseAxes: readonly number[],
  lineUnit: Vec3,
  minimumSingularValue: number,
  budget: CandidateBudget,
): number {
  let best = Math.min(...transverseAxes.map((axisIndex) => norm(projectOffLine(cell[axisIndex], lineUnit))))
  const radius = Math.max(1, Math.ceil(best / minimumSingularValue + 1e-12))
  const ranges = ([0, 1, 2] as const).map((axisIndex) => transverseAxes.includes(axisIndex)
    ? Array.from({ length: 2 * radius + 1 }, (_, index) => index - radius)
    : [0])
  const candidateCount = ranges[0].length * ranges[1].length * ranges[2].length - 1
  if (!Number.isSafeInteger(candidateCount) || budget.count + candidateCount > budget.maximum) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Minimum-image candidate budget exceeded')
  }
  budget.count += candidateCount
  for (const first of ranges[0]) for (const second of ranges[1]) for (const third of ranges[2]) {
    if (first === 0 && second === 0 && third === 0) continue
    const vector = fractionalToCartesian([first, second, third], cell)
    best = Math.min(best, norm(projectOffLine(vector, lineUnit)))
  }
  return best
}

function acceptance(value: unknown): ZatomPeriodicDislocationDipoleEvidence['acceptance'] {
  const raw = exactObject(value, 'acceptance', [
    'maximumTensorSymmetryResidualGPa',
    'minimumStiffnessEigenvalueGPa',
    'maximumStiffnessConditionNumber',
    'maximumScrewCharacterAngleDeg',
    'maximumSlipPlaneResidual',
    'minimumTransverseCellVectorPerBurgers',
    'minimumCoreSeparationPerBurgers',
    'minimumCoreClearanceA',
    'maximumPeriodicSeamResidualA',
    'maximumImageConvergenceDisplacementA',
    'maximumBalancingPrincipalStrain',
    'maximumVolumeChangeFraction',
    'maximumNonaffineDisplacementA',
    'minimumPairDistanceA',
  ])
  return {
    maximumTensorSymmetryResidualGPa: finite(raw.maximumTensorSymmetryResidualGPa, 'acceptance.maximumTensorSymmetryResidualGPa', 0, 1e9),
    minimumStiffnessEigenvalueGPa: finite(raw.minimumStiffnessEigenvalueGPa, 'acceptance.minimumStiffnessEigenvalueGPa', 0, 1e9),
    maximumStiffnessConditionNumber: finite(raw.maximumStiffnessConditionNumber, 'acceptance.maximumStiffnessConditionNumber', 1, 1e300),
    maximumScrewCharacterAngleDeg: finite(raw.maximumScrewCharacterAngleDeg, 'acceptance.maximumScrewCharacterAngleDeg', 0, 90),
    maximumSlipPlaneResidual: finite(raw.maximumSlipPlaneResidual, 'acceptance.maximumSlipPlaneResidual', 0, 1),
    minimumTransverseCellVectorPerBurgers: finite(raw.minimumTransverseCellVectorPerBurgers, 'acceptance.minimumTransverseCellVectorPerBurgers', 0, 1e9),
    minimumCoreSeparationPerBurgers: finite(raw.minimumCoreSeparationPerBurgers, 'acceptance.minimumCoreSeparationPerBurgers', 0, 1e9),
    minimumCoreClearanceA: finite(raw.minimumCoreClearanceA, 'acceptance.minimumCoreClearanceA', 0, 1e9),
    maximumPeriodicSeamResidualA: finite(raw.maximumPeriodicSeamResidualA, 'acceptance.maximumPeriodicSeamResidualA', 0, 1e9),
    maximumImageConvergenceDisplacementA: finite(raw.maximumImageConvergenceDisplacementA, 'acceptance.maximumImageConvergenceDisplacementA', 0, 1e9),
    maximumBalancingPrincipalStrain: finite(raw.maximumBalancingPrincipalStrain, 'acceptance.maximumBalancingPrincipalStrain', 0, 1e6),
    maximumVolumeChangeFraction: finite(raw.maximumVolumeChangeFraction, 'acceptance.maximumVolumeChangeFraction', 0, 1e6),
    maximumNonaffineDisplacementA: finite(raw.maximumNonaffineDisplacementA, 'acceptance.maximumNonaffineDisplacementA', 0, 1e9),
    minimumPairDistanceA: finite(raw.minimumPairDistanceA, 'acceptance.minimumPairDistanceA', 0, 1e9),
  }
}

function provenance(value: unknown): ZatomPeriodicDislocationDipoleEvidence['provenance'] {
  const raw = exactObject(value, 'provenance', [
    'engine', 'engineVersion', 'dependencies', 'method', 'package', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (raw.engine !== 'atomman') {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance.engine must be atomman')
  }
  const dependencies = exactObject(raw.dependencies, 'provenance.dependencies', ['numpyVersion', 'scipyVersion'])
  const packageValue = exactObject(raw.package, 'provenance.package', ['realPath', 'fileCount', 'totalBytes', 'sha256'])
  const packageSha = text(packageValue.sha256, 'provenance.package.sha256', 128).toLowerCase()
  if (!/^sha256:[0-9a-f]{64}$/.test(packageSha)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance.package.sha256 must be sha256:<64 hex>')
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length < 1 || raw.artifacts.length > 32) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance.artifacts must contain 1-32 entries')
  }
  const artifacts = raw.artifacts.map((value, index) => {
    const artifact = exactObject(value, `provenance.artifacts[${index}]`, ['id', 'role', 'fingerprint'])
    return {
      id: token(artifact.id, `provenance.artifacts[${index}].id`),
      role: text(artifact.role, `provenance.artifacts[${index}].role`, 512),
      fingerprint: token(artifact.fingerprint, `provenance.artifacts[${index}].fingerprint`, 256),
    }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance artifact IDs must be unique')
  }
  if (!Array.isArray(raw.citations) || raw.citations.length < 1 || raw.citations.length > 32) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance.citations must contain 1-32 entries')
  }
  const citations = raw.citations.map((item, index) => text(item, `provenance.citations[${index}]`, 4096)).sort()
  if (new Set(citations).size !== citations.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'provenance citations must be unique')
  }
  return {
    engine: 'atomman',
    engineVersion: token(raw.engineVersion, 'provenance.engineVersion'),
    dependencies: {
      numpyVersion: token(dependencies.numpyVersion, 'provenance.dependencies.numpyVersion'),
      scipyVersion: token(dependencies.scipyVersion, 'provenance.dependencies.scipyVersion'),
    },
    method: text(raw.method, 'provenance.method', 4096),
    package: {
      realPath: text(packageValue.realPath, 'provenance.package.realPath', 8192),
      fileCount: integer(packageValue.fileCount, 'provenance.package.fileCount', 1, 100_000),
      totalBytes: integer(packageValue.totalBytes, 'provenance.package.totalBytes', 1, 2 ** 31 - 1),
      sha256: packageSha,
    },
    artifacts,
    parameters: jsonRecord(raw.parameters, 'provenance.parameters'),
    citations,
    scopeWarning: text(raw.scopeWarning, 'provenance.scopeWarning', 8192),
  }
}

function parseSeamRows(value: unknown, referenceCell: Mat3): ZatomPeriodicDislocationSeamProbe[] {
  if (!Array.isArray(value) || value.length !== 3 * PERIODIC_DISLOCATION_PROBE_FRACTIONS.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `periodicityProbes.rows must contain ${3 * PERIODIC_DISLOCATION_PROBE_FRACTIONS.length} rows`)
  }
  return value.map((item, index) => {
    const raw = exactObject(item, `periodicityProbes.rows[${index}]`, [
      'axis', 'probeIndex', 'fractionalPointA', 'pointA', 'pointB', 'displacementA', 'displacementB',
    ], ['residualVectorA', 'residualA'])
    const axisIndex = integer(raw.axis, `periodicityProbes.rows[${index}].axis`, 0, 2) as 0 | 1 | 2
    const probeIndex = integer(raw.probeIndex, `periodicityProbes.rows[${index}].probeIndex`, 0, PERIODIC_DISLOCATION_PROBE_FRACTIONS.length - 1)
    const expectedAxis = Math.floor(index / PERIODIC_DISLOCATION_PROBE_FRACTIONS.length) as 0 | 1 | 2
    const expectedProbe = index % PERIODIC_DISLOCATION_PROBE_FRACTIONS.length
    if (axisIndex !== expectedAxis || probeIndex !== expectedProbe) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Seam probes must use canonical axis-major order')
    }
    const fractionalPointA = vec3(raw.fractionalPointA, `periodicityProbes.rows[${index}].fractionalPointA`)
    if (maximumVectorResidual(fractionalPointA, PERIODIC_DISLOCATION_PROBE_FRACTIONS[probeIndex]) > 1e-12) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Seam probe fractional point differs from the canonical grid')
    }
    const expectedPointA = fractionalToCartesian(fractionalPointA, referenceCell)
    const pointA = vec3(raw.pointA, `periodicityProbes.rows[${index}].pointA`)
    const pointB = vec3(raw.pointB, `periodicityProbes.rows[${index}].pointB`)
    if (maximumVectorResidual(pointA, expectedPointA) > VECTOR_TOLERANCE
      || maximumVectorResidual(pointB, add(expectedPointA, referenceCell[axisIndex])) > VECTOR_TOLERANCE) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Seam probe points do not bind the reference cell')
    }
    const displacementA = vec3(raw.displacementA, `periodicityProbes.rows[${index}].displacementA`)
    const displacementB = vec3(raw.displacementB, `periodicityProbes.rows[${index}].displacementB`)
    const residualVectorA = subtract(displacementB, displacementA)
    return {
      axis: axisIndex,
      probeIndex,
      fractionalPointA,
      pointA,
      pointB,
      displacementA,
      displacementB,
      residualVectorA,
      residualA: norm(residualVectorA),
    }
  })
}

function parseConvergence(
  rawGauge: unknown,
  value: unknown,
  referenceCell: Mat3,
): { rigidGaugeA: Vec3; rows: ZatomPeriodicDislocationConvergenceProbe[] } {
  if (!Array.isArray(value) || value.length !== PERIODIC_DISLOCATION_PROBE_FRACTIONS.length) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `imageConvergence.rows must contain ${PERIODIC_DISLOCATION_PROBE_FRACTIONS.length} rows`)
  }
  const parsed = value.map((item, index) => {
    const raw = exactObject(item, `imageConvergence.rows[${index}]`, [
      'probeIndex', 'fractionalPointA', 'pointA', 'currentDisplacementA', 'comparisonDisplacementA',
    ], ['gaugeCorrectedDifferenceA', 'residualA'])
    const probeIndex = integer(raw.probeIndex, `imageConvergence.rows[${index}].probeIndex`, 0, PERIODIC_DISLOCATION_PROBE_FRACTIONS.length - 1)
    if (probeIndex !== index) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Convergence probes must use canonical order')
    }
    const fractionalPointA = vec3(raw.fractionalPointA, `imageConvergence.rows[${index}].fractionalPointA`)
    if (maximumVectorResidual(fractionalPointA, PERIODIC_DISLOCATION_PROBE_FRACTIONS[index]) > 1e-12) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Convergence probe differs from canonical grid')
    }
    const pointA = vec3(raw.pointA, `imageConvergence.rows[${index}].pointA`)
    if (maximumVectorResidual(pointA, fractionalToCartesian(fractionalPointA, referenceCell)) > VECTOR_TOLERANCE) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Convergence point does not bind the reference cell')
    }
    return {
      probeIndex,
      fractionalPointA,
      pointA,
      currentDisplacementA: vec3(raw.currentDisplacementA, `imageConvergence.rows[${index}].currentDisplacementA`),
      comparisonDisplacementA: vec3(raw.comparisonDisplacementA, `imageConvergence.rows[${index}].comparisonDisplacementA`),
    }
  })
  const differences = parsed.map((row) => subtract(row.currentDisplacementA, row.comparisonDisplacementA))
  const rigidGaugeA: Vec3 = [0, 1, 2].map((component) => (
    differences.reduce((sum, difference) => sum + difference[component], 0) / differences.length
  )) as Vec3
  const declaredGauge = vec3(rawGauge, 'imageConvergence.rigidGaugeA')
  if (maximumVectorResidual(declaredGauge, rigidGaugeA) > 1e-10) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_probe_mismatch', 'Declared convergence rigid gauge differs from the recomputed mean')
  }
  return {
    rigidGaugeA,
    rows: parsed.map((row, index) => {
      const gaugeCorrectedDifferenceA = subtract(differences[index], rigidGaugeA)
      return { ...row, gaugeCorrectedDifferenceA, residualA: norm(gaugeCorrectedDifferenceA) }
    }),
  }
}

function parseCores(value: unknown): ZatomPeriodicDislocationDipoleEvidence['construction']['cores'] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'construction.cores must contain positive and negative cores')
  }
  return value.map((item, index) => {
    const raw = exactObject(item, `construction.cores[${index}]`, ['id', 'sign', 'positionA'])
    const expectedId = index === 0 ? 'positive' : 'negative'
    const expectedSign = index === 0 ? 1 : -1
    if (raw.id !== expectedId || raw.sign !== expectedSign) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_geometry_mismatch', 'Cores must be ordered positive then negative with opposite unit signs')
    }
    return { id: expectedId, sign: expectedSign, positionA: vec3(raw.positionA, `construction.cores[${index}].positionA`) }
  }) as ZatomPeriodicDislocationDipoleEvidence['construction']['cores']
}

function buildValidation(
  raw: Record<string, unknown>,
  options: ParseZatomPeriodicDislocationDipoleEvidenceOptions,
): ZatomPeriodicDislocationDipoleEvidenceValidation {
  const source = options.sourceStructure
  const result = options.resultStructure
  const maxSourceAtoms = positiveBudget(options.maxSourceAtoms, 256, 'maxSourceAtoms')
  const maxOutputAtoms = positiveBudget(options.maxOutputAtoms, 20_000, 'maxOutputAtoms')
  assertCanonicalPeriodicStructure(source, 'sourceStructure', maxSourceAtoms, true)
  assertCanonicalPeriodicStructure(result, 'resultStructure', maxOutputAtoms, false)
  let reference: ZatomStructure
  try {
    reference = parseZatomStructure(raw.referenceStructure)
  } catch (error) {
    if (error instanceof ZatomStructureInputError) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_reference_invalid', error.message)
    }
    throw error
  }
  assertCanonicalPeriodicStructure(reference, 'referenceStructure', maxOutputAtoms, false)
  assertReferenceResultMapping(reference, result)

  const sourceFingerprint = fingerprintStructure(source)
  const referenceFingerprint = fingerprintStructure(reference)
  const resultFingerprint = fingerprintStructure(result)
  const sourceCounts = elementCounts(source)
  const generatedCounts = elementCounts(reference)
  if (canonicalJsonIdentity(generatedCounts) !== canonicalJsonIdentity(elementCounts(result))) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', 'Reference/result element counts differ')
  }
  const multipliers = Object.keys(sourceCounts).map((element) => generatedCounts[element] / sourceCounts[element])
  if (Object.keys(generatedCounts).some((element) => !(element in sourceCounts))
    || multipliers.some((value) => !Number.isSafeInteger(value) || value < 1)
    || new Set(multipliers).size !== 1) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_mapping_mismatch', 'Generated composition is not an integer replication of source element classes')
  }
  const supercellMultiplicity = multipliers[0]

  const rawElasticity = exactObject(raw.elasticity, 'elasticity', ['model', 'coordinateFrame', 'voigtOrder', 'stiffnessMatrixGPa'])
  if (rawElasticity.model !== 'anisotropic-linear-elasticity'
    || rawElasticity.coordinateFrame !== 'source-cell-cartesian'
    || canonicalJsonIdentity(rawElasticity.voigtOrder) !== canonicalJsonIdentity(VOIGT_ORDER)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'Elasticity frame/order declaration is invalid')
  }
  const matrix = stiffnessMatrix(rawElasticity.stiffnessMatrixGPa)
  let tensorSymmetryResidualGPa = 0
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    tensorSymmetryResidualGPa = Math.max(tensorSymmetryResidualGPa, Math.abs(matrix[i][j] - matrix[j][i]))
  }
  const stiffnessEigenvaluesGPa = symmetricEigenvalues(matrix)
  const minimumStiffnessEigenvalueGPa = stiffnessEigenvaluesGPa[0]
  const maximumStiffnessEigenvalueGPa = stiffnessEigenvaluesGPa.at(-1)!
  const stiffnessConditionNumber = minimumStiffnessEigenvalueGPa > 0
    ? maximumStiffnessEigenvalueGPa / minimumStiffnessEigenvalueGPa
    : 1e300

  const rawCrystallography = exactObject(raw.crystallography, 'crystallography', [
    'conventionalSetting', 'burgersMiller', 'lineMiller', 'slipPlaneMiller', 'primitiveBurgersCoefficients',
    'rotatedBurgersVectorA', 'rotatedLineUnitVector', 'rotatedSlipPlaneNormalUnitVector', 'mAxis', 'nAxis',
  ], [
    'inputBurgersCartesianA', 'inputLineCartesianA', 'inputSlipPlaneNormalCartesian', 'lineAxis',
    'burgersMagnitudeA', 'character', 'characterAngleDeg', 'slipPlaneResidual',
  ])
  const conventionalSetting = setting(rawCrystallography.conventionalSetting)
  const burgersMiller = vec3(rawCrystallography.burgersMiller, 'crystallography.burgersMiller')
  const lineMiller = vec3(rawCrystallography.lineMiller, 'crystallography.lineMiller')
  const slipPlaneMiller = vec3(rawCrystallography.slipPlaneMiller, 'crystallography.slipPlaneMiller')
  const primitiveBurgersCoefficients = vec3(rawCrystallography.primitiveBurgersCoefficients, 'crystallography.primitiveBurgersCoefficients')
  const expectedPrimitive = matrixVector(burgersMiller, CONVENTIONAL_TO_PRIMITIVE[conventionalSetting])
  if (maximumVectorResidual(primitiveBurgersCoefficients, expectedPrimitive) > 1e-8
    || primitiveBurgersCoefficients.some((value) => Math.abs(value - Math.round(value)) > 1e-8)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', 'Burgers vector is not a full primitive-lattice translation')
  }
  if (burgersMiller.every((value) => value === 0)
    || lineMiller.every((value) => value === 0)
    || slipPlaneMiller.every((value) => value === 0)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', 'Burgers, line, and plane Miller indices must be non-zero')
  }
  if (lineMiller.some((value) => Math.abs(value - Math.round(value)) > 1e-8)
    || slipPlaneMiller.some((value) => Math.abs(value - Math.round(value)) > 1e-8)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'periodic_dislocation_crystallography_mismatch',
      'V1 line and slip-plane Miller indices must be integers',
    )
  }
  const inputBurgersCartesianA = matrixVector(burgersMiller, source.lattice!.vectors)
  const inputLineCartesianA = matrixVector(lineMiller, source.lattice!.vectors)
  const inputSlipPlaneNormalCartesian = planeNormal(slipPlaneMiller, source.lattice!.vectors)
  const burgersMagnitudeA = norm(inputBurgersCartesianA)
  const characterAngleDeg = Math.acos(Math.min(1, Math.abs(dot(unit(inputBurgersCartesianA, 'burgers'), unit(inputLineCartesianA, 'line'))))) * 180 / Math.PI
  const slipPlaneResidual = Math.abs(dot(unit(inputBurgersCartesianA, 'burgers'), unit(inputSlipPlaneNormalCartesian, 'slip plane normal')))
  const rotatedBurgersVectorA = vec3(rawCrystallography.rotatedBurgersVectorA, 'crystallography.rotatedBurgersVectorA')
  const rotatedLineUnitVector = unit(vec3(rawCrystallography.rotatedLineUnitVector, 'crystallography.rotatedLineUnitVector'), 'rotated line')
  const rotatedSlipPlaneNormalUnitVector = unit(vec3(rawCrystallography.rotatedSlipPlaneNormalUnitVector, 'crystallography.rotatedSlipPlaneNormalUnitVector'), 'rotated slip-plane normal')
  const mAxis = axis(rawCrystallography.mAxis, 'crystallography.mAxis')
  const nAxis = axis(rawCrystallography.nAxis, 'crystallography.nAxis')
  if (mAxis === nAxis) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', 'mAxis and nAxis must differ')
  }
  const lineAxis = AXES.find((candidate) => candidate !== mAxis && candidate !== nAxis)!
  const lineAxisIndex = AXIS_INDEX[lineAxis]
  const nAxisIndex = AXIS_INDEX[nAxis]
  const expectedLineUnit: Vec3 = [0, 0, 0]
  expectedLineUnit[lineAxisIndex] = Math.sign(rotatedLineUnitVector[lineAxisIndex]) || 1
  const expectedNormalUnit: Vec3 = [0, 0, 0]
  expectedNormalUnit[nAxisIndex] = Math.sign(rotatedSlipPlaneNormalUnitVector[nAxisIndex]) || 1
  const rotatedBurgersUnit = unit(rotatedBurgersVectorA, 'rotated burgers')
  if (Math.abs(norm(rotatedBurgersVectorA) - burgersMagnitudeA) > 1e-7 * Math.max(1, burgersMagnitudeA)
    || maximumVectorResidual(rotatedLineUnitVector, expectedLineUnit) > 1e-8
    || maximumVectorResidual(rotatedSlipPlaneNormalUnitVector, expectedNormalUnit) > 1e-8
    || Math.abs(Math.abs(dot(rotatedBurgersUnit, expectedLineUnit)) - 1) > 1e-8) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', 'Atomman rotated axes/Burgers vector are inconsistent with the requested screw orientation')
  }

  const rawConstruction = exactObject(raw.construction, 'construction', [
    'sizeMultipliers', 'imageReplicaCount', 'shiftIndex', 'atommanIndices', 'cores',
  ], [
    'kind', 'representation', 'boxtilt', 'imageCellCount', 'comparisonImageReplicaCount',
    'comparisonImageCellCount', 'netBurgersVectorA',
  ])
  if (!Array.isArray(rawConstruction.sizeMultipliers) || rawConstruction.sizeMultipliers.length !== 3) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'construction.sizeMultipliers must contain three integers')
  }
  const sizeMultipliers = rawConstruction.sizeMultipliers.map((value, index) => integer(value, `construction.sizeMultipliers[${index}]`, 1, 1_000)) as [number, number, number]
  const imageReplicaCount = integer(rawConstruction.imageReplicaCount, 'construction.imageReplicaCount', 5, 25)
  const comparisonImageReplicaCount = imageReplicaCount - 2
  const shiftIndex = integer(rawConstruction.shiftIndex, 'construction.shiftIndex', 0, 1_000_000)
  const rawIndices = exactObject(rawConstruction.atommanIndices, 'construction.atommanIndices', ['motion', 'cut', 'line'])
  const atommanIndices = {
    motion: integer(rawIndices.motion, 'construction.atommanIndices.motion', 0, 2) as 0 | 1 | 2,
    cut: integer(rawIndices.cut, 'construction.atommanIndices.cut', 0, 2) as 0 | 1 | 2,
    line: integer(rawIndices.line, 'construction.atommanIndices.line', 0, 2) as 0 | 1 | 2,
  }
  if (new Set(Object.values(atommanIndices)).size !== 3
    || atommanIndices.motion !== AXIS_INDEX[mAxis]
    || atommanIndices.cut !== AXIS_INDEX[nAxis]
    || atommanIndices.line !== lineAxisIndex) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_crystallography_mismatch', 'Atomman motion/cut/line indices differ from requested axes')
  }
  const cores = parseCores(rawConstruction.cores)
  for (const core of cores) {
    const fractional = cartesianToFractional(core.positionA, result.lattice!.vectors)
    if (!fractional || fractional.some((value) => value < -1e-9 || value >= 1 + 1e-9)) {
      throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_geometry_mismatch', `Core ${core.id} lies outside the result cell`)
    }
  }
  const netBurgersVectorA = add(rotatedBurgersVectorA, scale(rotatedBurgersVectorA, -1))

  const referenceCell = reference.lattice!.vectors
  const resultCell = result.lattice!.vectors
  const motionIndex = atommanIndices.motion
  const cutIndex = atommanIndices.cut
  const lineIndex = atommanIndices.line
  const quadripoleResidualTerms = [
    ...([0, 1, 2] as const).filter((index) => index !== motionIndex).map((index) => Math.abs(referenceCell[motionIndex][index])),
    ...([0, 1, 2] as const).filter((index) => index !== lineIndex).map((index) => Math.abs(referenceCell[lineIndex][index])),
    Math.abs(referenceCell[cutIndex][lineIndex]),
    Math.abs(referenceCell[cutIndex][motionIndex] - 0.5 * referenceCell[motionIndex][motionIndex]),
  ]
  const quadripoleTiltResidualA = Math.max(...quadripoleResidualTerms)
  if (quadripoleTiltResidualA > 1e-7 * Math.max(1, ...referenceCell.map(norm))) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'periodic_dislocation_cell_mismatch',
      'Reference cell does not have atomman boxtilt=true motion/cut/line quadripole geometry',
    )
  }
  let balancingShearResidualA = 0
  for (let row = 0; row < 3; row++) {
    const expected = row === atommanIndices.cut
      ? add(referenceCell[row], scale(rotatedBurgersVectorA, -0.5))
      : referenceCell[row]
    balancingShearResidualA = Math.max(balancingShearResidualA, maximumVectorResidual(resultCell[row], expected))
  }
  if (balancingShearResidualA > 1e-7 * Math.max(1, burgersMagnitudeA)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_cell_mismatch', 'Result cell is not the exact Atomman screw balancing shear of the reference cell')
  }

  const rawPeriodicity = exactObject(raw.periodicityProbes, 'periodicityProbes', ['field', 'rows'])
  if (rawPeriodicity.field !== 'cai-regularized-volterra-displacement-before-balancing-strain') {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'periodicityProbes.field is unsupported')
  }
  const seamRows = parseSeamRows(rawPeriodicity.rows, referenceCell)
  const rawConvergence = exactObject(raw.imageConvergence, 'imageConvergence', ['comparison', 'rigidGaugeA', 'rows'])
  if (rawConvergence.comparison !== 'current-versus-two-fewer-image-replicas') {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', 'imageConvergence.comparison is unsupported')
  }
  const convergence = parseConvergence(rawConvergence.rigidGaugeA, rawConvergence.rows, referenceCell)
  const accepted = acceptance(raw.acceptance)
  const normalizedProvenance = provenance(raw.provenance)
  const metadata = raw.metadata === undefined ? undefined : jsonRecord(raw.metadata, 'metadata')
  if (metadata && utf8Bytes(metadata) > positiveBudget(options.maxMetadataBytes, 256 * 1024, 'maxMetadataBytes')) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'metadata exceeds maxMetadataBytes')
  }

  const referenceCellVolumeA3 = determinant3(referenceCell)
  const resultCellVolumeA3 = determinant3(resultCell)
  const volumeChangeFraction = Math.abs(resultCellVolumeA3 / referenceCellVolumeA3 - 1)
  const balancingPrincipalEngineeringStrains = normalizedCellStrains(referenceCell, resultCell)
  const maximumAbsoluteBalancingPrincipalStrain = Math.max(...balancingPrincipalEngineeringStrains.map(Math.abs))

  const candidateBudget: CandidateBudget = {
    count: 0,
    maximum: positiveBudget(options.maxMinimumImageCandidateEvaluations, 50_000_000, 'maxMinimumImageCandidateEvaluations'),
  }
  const fullSigma = periodicBasisMinimumSingularValue(resultCell, [0, 1, 2])
  const transverseAxes = [atommanIndices.motion, atommanIndices.cut]
  const transverseSigma = projectedTransverseMinimumSingularValue(referenceCell, transverseAxes, rotatedLineUnitVector)
  const minimumTransverseCellVectorA = shortestNonzeroTransverseImage(
    referenceCell,
    transverseAxes,
    rotatedLineUnitVector,
    transverseSigma,
    candidateBudget,
  )
  const minimumTransverseCellVectorPerBurgers = minimumTransverseCellVectorA / burgersMagnitudeA
  const resultTransverseSigma = projectedTransverseMinimumSingularValue(resultCell, transverseAxes, rotatedLineUnitVector)
  const corePairDistance = exactTransverseLineDistance(
    cores[0].positionA,
    cores[1].positionA,
    resultCell,
    transverseAxes,
    rotatedLineUnitVector,
    resultTransverseSigma,
    candidateBudget,
  )
  const coreImageDistance = shortestNonzeroTransverseImage(
    resultCell,
    transverseAxes,
    rotatedLineUnitVector,
    resultTransverseSigma,
    candidateBudget,
  )
  const minimumCoreSeparationA = Math.min(corePairDistance, coreImageDistance)
  const minimumCoreSeparationPerBurgers = minimumCoreSeparationA / burgersMagnitudeA

  const coreDistances: Array<{ atomId: string; distanceA: number }> = []
  for (const atom of result.atoms) for (const core of cores) {
    coreDistances.push({
      atomId: atom.id,
      distanceA: exactTransverseLineDistance(
        atom.position,
        core.positionA,
        resultCell,
        transverseAxes,
        rotatedLineUnitVector,
        resultTransverseSigma,
        candidateBudget,
      ),
    })
  }
  coreDistances.sort((left, right) => (
    left.distanceA - right.distanceA || compareCanonicalText(left.atomId, right.atomId)
  ))
  const minimumCoreClearanceA = coreDistances[0].distanceA
  const nearestCoreAtomIds = [...new Set(coreDistances.slice(0, 24).map((entry) => entry.atomId))].slice(0, 24)

  let maximumNonaffineDisplacementA = -1
  let nonaffineSquareSum = 0
  let maximumNonaffineDisplacementAtomId = result.atoms[0].id
  for (let index = 0; index < result.atoms.length; index++) {
    const fractional = cartesianToFractional(reference.atoms[index].position, referenceCell)!
    const affine = fractionalToCartesian(fractional, resultCell)
    const displacement = exactDistance(affine, result.atoms[index].position, resultCell, fullSigma, candidateBudget)
    nonaffineSquareSum += displacement ** 2
    if (displacement > maximumNonaffineDisplacementA) {
      maximumNonaffineDisplacementA = displacement
      maximumNonaffineDisplacementAtomId = result.atoms[index].id
    }
  }
  const rmsNonaffineDisplacementA = Math.sqrt(nonaffineSquareSum / result.atoms.length)

  let minimumPairDistanceA = Infinity
  let closestPairAtomIds: [string, string] = [result.atoms[0].id, result.atoms[1].id]
  const pairCount = result.atoms.length * (result.atoms.length - 1) / 2
  for (let left = 0; left < result.atoms.length; left++) for (let right = left + 1; right < result.atoms.length; right++) {
    const distance = exactDistance(result.atoms[left].position, result.atoms[right].position, resultCell, fullSigma, candidateBudget)
    if (distance < minimumPairDistanceA) {
      minimumPairDistanceA = distance
      closestPairAtomIds = [result.atoms[left].id, result.atoms[right].id]
    }
  }

  const seamResiduals = seamRows.map((row) => row.residualA)
  const maximumPeriodicSeamResidualA = Math.max(...seamResiduals)
  const rmsPeriodicSeamResidualA = Math.sqrt(seamResiduals.reduce((sum, value) => sum + value ** 2, 0) / seamResiduals.length)
  const convergenceResiduals = convergence.rows.map((row) => row.residualA)
  const maximumImageConvergenceDisplacementA = Math.max(...convergenceResiduals)
  const rmsImageConvergenceDisplacementA = Math.sqrt(convergenceResiduals.reduce((sum, value) => sum + value ** 2, 0) / convergenceResiduals.length)
  const worstSeam = seamRows.reduce((worst, row) => row.residualA > worst.residualA ? row : worst)
  const worstConvergence = convergence.rows.reduce((worst, row) => row.residualA > worst.residualA ? row : worst)

  const gates = {
    tensor: tensorSymmetryResidualGPa <= accepted.maximumTensorSymmetryResidualGPa
      && minimumStiffnessEigenvalueGPa >= accepted.minimumStiffnessEigenvalueGPa
      && stiffnessConditionNumber <= accepted.maximumStiffnessConditionNumber,
    crystallography: characterAngleDeg <= accepted.maximumScrewCharacterAngleDeg
      && slipPlaneResidual <= accepted.maximumSlipPlaneResidual,
    transverse: minimumTransverseCellVectorPerBurgers >= accepted.minimumTransverseCellVectorPerBurgers,
    core: minimumCoreSeparationPerBurgers >= accepted.minimumCoreSeparationPerBurgers
      && minimumCoreClearanceA >= accepted.minimumCoreClearanceA,
    periodicity: maximumPeriodicSeamResidualA <= accepted.maximumPeriodicSeamResidualA,
    convergence: maximumImageConvergenceDisplacementA <= accepted.maximumImageConvergenceDisplacementA,
    strain: maximumAbsoluteBalancingPrincipalStrain <= accepted.maximumBalancingPrincipalStrain
      && volumeChangeFraction <= accepted.maximumVolumeChangeFraction,
    displacement: maximumNonaffineDisplacementA <= accepted.maximumNonaffineDisplacementA,
    pair: minimumPairDistanceA >= accepted.minimumPairDistanceA,
  }
  const acceptancePassed = Object.values(gates).every(Boolean)
  const elementTypeMap = Object.keys(sourceCounts).sort().map((element, index) => ({ element, atommanType: index + 1 }))
  const evidence: ZatomPeriodicDislocationDipoleEvidence = {
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: sourceFingerprint,
    referenceStructureFingerprint: referenceFingerprint,
    resultStructureFingerprint: resultFingerprint,
    referenceStructure: reference,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cell-cartesian',
      voigtOrder: [...VOIGT_ORDER],
      stiffnessMatrixGPa: matrix,
    },
    crystallography: {
      conventionalSetting,
      burgersMiller,
      lineMiller,
      slipPlaneMiller,
      primitiveBurgersCoefficients,
      inputBurgersCartesianA,
      inputLineCartesianA,
      inputSlipPlaneNormalCartesian,
      rotatedBurgersVectorA,
      rotatedLineUnitVector,
      rotatedSlipPlaneNormalUnitVector,
      mAxis,
      nAxis,
      lineAxis,
      burgersMagnitudeA,
      character: 'screw',
      characterAngleDeg,
      slipPlaneResidual,
    },
    construction: {
      kind: 'periodic-screw-dipole',
      representation: 'tilted-quadripole',
      boxtilt: true,
      sizeMultipliers,
      imageReplicaCount,
      imageCellCount: (2 * imageReplicaCount + 1) ** 2,
      comparisonImageReplicaCount,
      comparisonImageCellCount: (2 * comparisonImageReplicaCount + 1) ** 2,
      shiftIndex,
      atommanIndices,
      cores,
      netBurgersVectorA,
    },
    mapping: {
      mode: 'atomman-oriented-supercell-order',
      sourceTemplateAtomCount: source.atoms.length,
      supercellMultiplicity,
      atomCount: result.atoms.length,
      sourceElementCounts: sourceCounts,
      generatedElementCounts: generatedCounts,
      elementTypeMap,
      referenceAndResultPreserveOrderIdsElements: true,
      sourceSiteLineage: 'element-class-only',
    },
    boundary: {
      sourcePeriodic: [...FULL_PBC],
      referencePeriodic: [...FULL_PBC],
      resultPeriodic: [...FULL_PBC],
      zeroOriginCanonicalCells: true,
      baseAndResultCellsDifferOnlyByBalancingShear: true,
    },
    periodicityProbes: {
      field: 'cai-regularized-volterra-displacement-before-balancing-strain',
      rows: seamRows,
    },
    imageConvergence: {
      comparison: 'current-versus-two-fewer-image-replicas',
      rigidGaugeA: convergence.rigidGaugeA,
      rows: convergence.rows,
    },
    acceptance: accepted,
    metrics: {
      tensorSymmetryResidualGPa,
      stiffnessEigenvaluesGPa,
      minimumStiffnessEigenvalueGPa,
      maximumStiffnessEigenvalueGPa,
      stiffnessConditionNumber,
      minimumTransverseCellVectorA,
      minimumTransverseCellVectorPerBurgers,
      minimumCoreSeparationA,
      minimumCoreSeparationPerBurgers,
      minimumCoreClearanceA,
      referenceCellVolumeA3,
      resultCellVolumeA3,
      volumeChangeFraction,
      balancingPrincipalEngineeringStrains,
      maximumAbsoluteBalancingPrincipalStrain,
      quadripoleTiltResidualA,
      balancingShearResidualA,
      maximumNonaffineDisplacementA,
      rmsNonaffineDisplacementA,
      minimumPairDistanceA,
      pairCount,
      minimumImageCandidateEvaluations: candidateBudget.count,
      maximumPeriodicSeamResidualA,
      rmsPeriodicSeamResidualA,
      maximumImageConvergenceDisplacementA,
      rmsImageConvergenceDisplacementA,
      netBurgersMagnitudeA: norm(netBurgersVectorA),
      acceptancePassed,
    },
    diagnostics: {
      nearestCoreAtomIds,
      maximumNonaffineDisplacementAtomId,
      closestPairAtomIds,
      worstSeamProbe: { axis: worstSeam.axis, probeIndex: worstSeam.probeIndex },
      worstConvergenceProbeIndex: worstConvergence.probeIndex,
    },
    provenance: normalizedProvenance,
    ...(metadata ? { metadata } : {}),
  }
  if (utf8Bytes(evidence) > positiveBudget(options.maxArtifactBytes, 32 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }

  const checks: ValidationCheck[] = [
    {
      id: 'periodic_dislocation.source_binding',
      status: 'pass',
      message: 'Exact source unit-cell fingerprint and generated element-class replication are bound',
      metrics: { sourceFingerprint, sourceAtomCount: source.atoms.length, supercellMultiplicity },
    },
    {
      id: 'periodic_dislocation.reference_binding',
      status: 'pass',
      message: 'Embedded perfect reference and result preserve generated atom count, order, IDs, and elements',
      metrics: { referenceFingerprint, resultFingerprint, atomCount: result.atoms.length },
    },
    {
      id: 'periodic_dislocation.elastic_tensor',
      status: gates.tensor ? 'pass' : 'fail',
      message: gates.tensor ? 'Stiffness tensor satisfies symmetry, positive-definiteness, and condition gates' : 'Stiffness tensor fails a gate',
      metrics: { tensorSymmetryResidualGPa, minimumStiffnessEigenvalueGPa, stiffnessConditionNumber },
    },
    {
      id: 'periodic_dislocation.crystallography',
      status: gates.crystallography ? 'pass' : 'fail',
      message: gates.crystallography ? 'Burgers vector is a full primitive translation, screw-parallel to the line, and lies in the slip plane' : 'Screw character or slip-plane geometry fails a gate',
      metrics: { burgersMagnitudeA, characterAngleDeg, slipPlaneResidual },
    },
    {
      id: 'periodic_dislocation.atom_mapping',
      status: 'pass',
      message: 'Atomman-generated reference/result identity is exact; source-template lineage is intentionally limited to element classes',
      metrics: { sourceTemplateAtomCount: source.atoms.length, atomCount: result.atoms.length },
    },
    {
      id: 'periodic_dislocation.net_burgers',
      status: norm(netBurgersVectorA) <= 1e-12 ? 'pass' : 'fail',
      message: 'The two parallel cores carry exactly opposite Burgers vectors',
      metrics: { netBurgersMagnitudeA: norm(netBurgersVectorA) },
    },
    {
      id: 'periodic_dislocation.periodicity',
      status: gates.periodicity ? 'pass' : 'fail',
      message: gates.periodicity ? 'Canonical three-axis seam probes satisfy the periodic displacement residual gate' : 'At least one canonical seam probe exceeds the periodic residual gate',
      metrics: { maximumPeriodicSeamResidualA, rmsPeriodicSeamResidualA, probeCount: seamRows.length },
    },
    {
      id: 'periodic_dislocation.image_convergence',
      status: gates.convergence ? 'pass' : 'fail',
      message: gates.convergence ? `Gauge-removed displacement change from N=${comparisonImageReplicaCount} to N=${imageReplicaCount} satisfies its gate` : 'Image-replica convergence gate failed',
      metrics: { maximumImageConvergenceDisplacementA, rmsImageConvergenceDisplacementA, imageReplicaCount, comparisonImageReplicaCount },
    },
    {
      id: 'periodic_dislocation.core_geometry',
      status: gates.transverse && gates.core ? 'pass' : 'fail',
      message: gates.transverse && gates.core ? 'Periodic core separation, atom clearance, and transverse cell extent satisfy their gates' : 'Core or transverse-size geometry fails a gate',
      metrics: { minimumTransverseCellVectorPerBurgers, minimumCoreSeparationPerBurgers, minimumCoreClearanceA },
      atomIds: nearestCoreAtomIds,
    },
    {
      id: 'periodic_dislocation.balancing_strain',
      status: gates.strain ? 'pass' : 'fail',
      message: gates.strain ? 'Result cell carries only the verified half-Burgers balancing shear within strain/volume gates' : 'Balancing cell deformation fails a gate',
      metrics: { maximumAbsoluteBalancingPrincipalStrain, volumeChangeFraction, quadripoleTiltResidualA, balancingShearResidualA },
    },
    {
      id: 'periodic_dislocation.displacement',
      status: gates.displacement ? 'pass' : 'fail',
      message: gates.displacement ? 'Nonaffine Volterra displacement relative to the affinely sheared perfect reference satisfies its gate' : 'Nonaffine displacement exceeds its gate',
      metrics: { maximumNonaffineDisplacementA, rmsNonaffineDisplacementA },
      atomIds: [maximumNonaffineDisplacementAtomId],
    },
    {
      id: 'periodic_dislocation.minimum_distance',
      status: gates.pair ? 'pass' : 'fail',
      message: gates.pair ? 'Certified full-periodic minimum-image pair scan satisfies its contact gate' : 'A periodic atom pair is below its contact gate',
      metrics: { minimumPairDistanceA, pairCount, minimumImageCandidateEvaluations: candidateBudget.count },
      atomIds: closestPairAtomIds,
    },
    {
      id: 'periodic_dislocation.lammps_handoff',
      status: acceptancePassed ? 'pass' : 'fail',
      message: acceptancePassed
        ? 'The structure is a fully periodic, geometrically gated seed eligible for a separately configured LAMMPS potential/relaxation'
        : 'LAMMPS handoff is blocked until every periodic-dislocation acceptance gate passes',
    },
    {
      id: 'periodic_dislocation.model_scope',
      status: 'warn',
      message: normalizedProvenance.scopeWarning,
    },
  ]

  const coreCenter = scale(add(cores[0].positionA, cores[1].positionA), 0.5)
  const maxAtom = result.atoms.find((atom) => atom.id === maximumNonaffineDisplacementAtomId)!
  const closestAtom = result.atoms.find((atom) => atom.id === closestPairAtomIds[0])!
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'periodic-dislocation-dipole-cores',
      reason: 'Inspect both opposite-sign screw cores in the tilted quadripole cell',
      center: coreCenter,
      radius: Math.max(2 * burgersMagnitudeA, minimumCoreSeparationA * 0.65),
      atomIds: nearestCoreAtomIds,
    },
    {
      id: 'periodic-dislocation-maximum-displacement',
      reason: `Inspect maximum nonaffine displacement ${maximumNonaffineDisplacementA.toPrecision(6)} Å`,
      center: [...maxAtom.position],
      radius: Math.max(2, 2 * burgersMagnitudeA),
      atomIds: [maximumNonaffineDisplacementAtomId],
    },
    {
      id: 'periodic-dislocation-closest-pair',
      reason: `Inspect certified closest periodic pair at ${minimumPairDistanceA.toPrecision(6)} Å`,
      center: [...closestAtom.position],
      radius: Math.max(2, 2 * minimumPairDistanceA),
      atomIds: [...closestPairAtomIds],
    },
    {
      id: 'periodic-dislocation-worst-seam-probe',
      reason: `Inspect the neighborhood of the worst canonical seam probe (${maximumPeriodicSeamResidualA.toPrecision(6)} Å)`,
      center: [...worstSeam.pointA],
      radius: Math.max(2, 2 * burgersMagnitudeA),
      atomIds: [],
    },
  ]
  return { evidence, fingerprint: fingerprintPeriodicDislocationDipoleEvidence(evidence), checks, inspectionTargets }
}

export function parseZatomPeriodicDislocationDipoleEvidence(
  value: unknown,
  options: ParseZatomPeriodicDislocationDipoleEvidenceOptions,
): ZatomPeriodicDislocationDipoleEvidenceValidation {
  if (utf8Bytes(value) > positiveBudget(options.maxArtifactBytes, 32 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('periodic_dislocation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const raw = exactObject(value, 'evidence', [
    'schemaVersion',
    'sourceStructureFingerprint',
    'referenceStructureFingerprint',
    'resultStructureFingerprint',
    'referenceStructure',
    'elasticity',
    'crystallography',
    'construction',
    'mapping',
    'boundary',
    'periodicityProbes',
    'imageConvergence',
    'acceptance',
    'metrics',
    'diagnostics',
    'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError('invalid_periodic_dislocation_evidence', `schemaVersion must be ${ZATOM_PERIODIC_DISLOCATION_DIPOLE_EVIDENCE_SCHEMA}`)
  }
  const validation = buildValidation(raw, options)
  if (canonicalJsonIdentity(raw) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomPeriodicDislocationDipoleEvidenceInputError(
      'periodic_dislocation_derived_mismatch',
      'Evidence differs from canonical structure-derived fingerprints, geometry, probes, mapping, diagnostics, or metrics',
    )
  }
  return validation
}

export function composeZatomPeriodicDislocationDipoleEvidence(
  input: ComposeZatomPeriodicDislocationDipoleEvidenceInput,
  budgets: Omit<ParseZatomPeriodicDislocationDipoleEvidenceOptions, 'sourceStructure' | 'resultStructure'> = {},
): ZatomPeriodicDislocationDipoleEvidenceValidation {
  return buildValidation({
    referenceStructure: input.referenceStructure,
    elasticity: input.elasticity,
    crystallography: input.crystallography,
    construction: input.construction,
    mapping: input.mapping,
    periodicityProbes: input.periodicityProbes,
    imageConvergence: input.imageConvergence,
    acceptance: input.acceptance,
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    resultStructure: input.resultStructure,
    ...budgets,
  })
}
