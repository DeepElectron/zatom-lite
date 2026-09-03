/** Canonical, structure-bound evidence for a straight continuum dislocation seed. */

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
  compareCanonicalText,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'

export const ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA =
  'zatom.continuum-dislocation-evidence/v1' as const

export type ZatomCartesianAxis = 'x' | 'y' | 'z'
export type ZatomStraightDislocationCharacter = 'screw' | 'edge' | 'mixed'
export type ZatomDislocationBoundaryMode = 'finite' | 'line-periodic'

export const ZATOM_ATOMSK_STRESS_PROPERTIES = {
  xx: 'zatom.atomsk.sigmaXXGPa',
  yy: 'zatom.atomsk.sigmaYYGPa',
  zz: 'zatom.atomsk.sigmaZZGPa',
  yz: 'zatom.atomsk.sigmaYZGPa',
  xz: 'zatom.atomsk.sigmaXZGPa',
  xy: 'zatom.atomsk.sigmaXYGPa',
} as const

export type ZatomStiffnessMatrixGPa = [
  [number, number, number, number, number, number],
  [number, number, number, number, number, number],
  [number, number, number, number, number, number],
  [number, number, number, number, number, number],
  [number, number, number, number, number, number],
  [number, number, number, number, number, number],
]

export interface ZatomContinuumDislocationEvidence {
  schemaVersion: typeof ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  resultStructureFingerprint: string
  elasticity: {
    model: 'anisotropic-linear-elasticity'
    coordinateFrame: 'source-cartesian'
    voigtOrder: ['xx', 'yy', 'zz', 'yz', 'xz', 'xy']
    stiffnessMatrixGPa: ZatomStiffnessMatrixGPa
  }
  defect: {
    kind: 'straight'
    lineAxis: ZatomCartesianAxis
    glidePlaneNormalAxis: ZatomCartesianAxis
    transverseAxis: ZatomCartesianAxis
    corePositionA: Vec3
    burgersVectorA: Vec3
    burgersMagnitudeA: number
    character: ZatomStraightDislocationCharacter
    characterAngleDeg: number
    glidePlaneResidualA: number
  }
  mapping: {
    mode: 'source-index-auxiliary-readback'
    atomCount: number
    preservesAtomOrderIdsElementsTopologyAndSourceProperties: true
    addedAtomPropertyNames: string[]
  }
  boundary: {
    mode: ZatomDislocationBoundaryMode
    sourcePeriodic: [true, true, true]
    resultPeriodic: [boolean, boolean, boolean]
    latticeVectorsPreserved: true
  }
  acceptance: {
    maximumCellOffAxisA: number
    maximumTensorSymmetryResidualGPa: number
    minimumStiffnessEigenvalueGPa: number
    maximumStiffnessConditionNumber: number
    maximumGlidePlaneResidualA: number
    minimumTransverseExtentPerBurgers: number
    minimumCoreClearanceA: number
    maximumDisplacementA: number
    minimumPairDistanceA: number
    maximumAbsoluteStressGPa: number
  }
  metrics: {
    maximumCellOffAxisA: number
    tensorSymmetryResidualGPa: number
    stiffnessEigenvaluesGPa: number[]
    minimumStiffnessEigenvalueGPa: number
    maximumStiffnessEigenvalueGPa: number
    stiffnessConditionNumber: number
    minimumTransverseExtentPerBurgers: number
    sourceCoreClearanceA: number
    maximumDisplacementA: number
    rmsDisplacementA: number
    minimumPairDistanceA: number
    pairEvaluationCount: number
    maximumAbsoluteStressGPa: number
    maximumVonMisesStressGPa: number
    acceptancePassed: boolean
  }
  diagnostics: {
    nearestCoreAtomIds: string[]
    maximumDisplacementAtomId: string
    maximumVonMisesStressAtomId: string
    closestPairAtomIds: [string, string]
  }
  provenance: {
    engine: string
    engineVersion: string
    method: string
    executable: {
      realPath: string
      sha256: string
    }
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

export interface ComposeZatomContinuumDislocationEvidenceInput {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  elasticity: Pick<ZatomContinuumDislocationEvidence['elasticity'], 'model' | 'coordinateFrame' | 'voigtOrder' | 'stiffnessMatrixGPa'>
  defect: Pick<ZatomContinuumDislocationEvidence['defect'], 'kind' | 'lineAxis' | 'glidePlaneNormalAxis' | 'corePositionA' | 'burgersVectorA'>
  mapping: Pick<ZatomContinuumDislocationEvidence['mapping'], 'mode'>
  boundary: Pick<ZatomContinuumDislocationEvidence['boundary'], 'mode'>
  acceptance: ZatomContinuumDislocationEvidence['acceptance']
  provenance: ZatomContinuumDislocationEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomContinuumDislocationEvidenceOptions {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  maxAtoms?: number
  maxPairEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomContinuumDislocationEvidenceValidation {
  evidence: ZatomContinuumDislocationEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomContinuumDislocationEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomContinuumDislocationEvidenceInputError'
    this.code = code
  }
}

const AXIS_INDEX: Record<ZatomCartesianAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }
const AXES: ZatomCartesianAxis[] = ['x', 'y', 'z']
const VOIGT_ORDER = ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'] as const
const STRESS_PROPERTY_NAMES = Object.values(ZATOM_ATOMSK_STRESS_PROPERTIES).sort()
const STRESS_PROPERTY_NAME_SET = new Set<string>(STRESS_PROPERTY_NAMES)

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
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence_context',
      `${field} must be a positive safe integer`,
    )
  }
  return result
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/\[\], -]+$/.test(result)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      `${field} contains unsupported token characters`,
    )
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
  throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', `${field} must be a JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintContinuumDislocationEvidence(value: ZatomContinuumDislocationEvidence): string {
  return fingerprintCanonicalJson(value)
}

function vec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', `${field} must contain three finite numbers`)
  }
  return [finite(value[0], `${field}[0]`), finite(value[1], `${field}[1]`), finite(value[2], `${field}[2]`)]
}

function stiffnessMatrix(value: unknown): ZatomStiffnessMatrixGPa {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'elasticity.stiffnessMatrixGPa must be a finite 6x6 matrix',
    )
  }
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.length !== 6) {
      throw new ZatomContinuumDislocationEvidenceInputError(
        'invalid_continuum_dislocation_evidence',
        `elasticity.stiffnessMatrixGPa[${i}] must contain six numbers`,
      )
    }
    return row.map((item, j) => finite(item, `elasticity.stiffnessMatrixGPa[${i}][${j}]`, -1e9, 1e9))
  }) as ZatomStiffnessMatrixGPa
}

/** Deterministic Jacobi diagonalization for the symmetric 6x6 stiffness matrix. */
function symmetricEigenvalues(matrix: ZatomStiffnessMatrixGPa): number[] {
  const a = matrix.map((row, i) => row.map((value, j) => (value + matrix[j][i]) / 2))
  for (let iteration = 0; iteration < 256; iteration++) {
    let p = 0
    let q = 1
    let largest = Math.abs(a[p][q])
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        const candidate = Math.abs(a[i][j])
        if (candidate > largest) {
          largest = candidate
          p = i
          q = j
        }
      }
    }
    const scale = Math.max(1, ...a.map((row, i) => Math.abs(row[i])))
    if (largest <= 1e-13 * scale) break
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
    for (let k = 0; k < 6; k++) {
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

function axis(value: unknown, field: string): ZatomCartesianAxis {
  if (value !== 'x' && value !== 'y' && value !== 'z') {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', `${field} must be x, y, or z`)
  }
  return value
}

function boundaryMode(value: unknown): ZatomDislocationBoundaryMode {
  if (value !== 'finite' && value !== 'line-periodic') {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'boundary.mode must be finite or line-periodic',
    )
  }
  return value
}

function scalarProperty(atom: ZatomStructure['atoms'][number], name: string): number {
  const raw = atom.properties?.[name]
  if (!isRecord(raw) || raw.kind !== 'scalar') {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_stress_field_mismatch',
      `Result atom ${atom.id} is missing scalar property ${name}`,
    )
  }
  return finite(raw.value, `result atom ${atom.id} property ${name}`)
}

function withoutStressProperties(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> | undefined {
  if (!value) return undefined
  const entries = Object.entries(value).filter(([key]) => !STRESS_PROPERTY_NAME_SET.has(key))
  return entries.length ? Object.fromEntries(entries) : undefined
}

function maximumCellOffAxis(vectors: Mat3): number {
  let maximum = 0
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      if (row !== column) maximum = Math.max(maximum, Math.abs(vectors[row][column]))
    }
  }
  return maximum
}

function expectedPeriodic(mode: ZatomDislocationBoundaryMode, lineAxis: ZatomCartesianAxis): [boolean, boolean, boolean] {
  if (mode === 'finite') return [false, false, false]
  const result: [boolean, boolean, boolean] = [false, false, false]
  result[AXIS_INDEX[lineAxis]] = true
  return result
}

function assertStructureRelationship(
  source: ZatomStructure,
  result: ZatomStructure,
  resultPeriodic: [boolean, boolean, boolean],
): void {
  if (!source.lattice || source.lattice.periodic.some((value) => !value)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_structure_mismatch',
      'A straight-dislocation source must have an explicit fully periodic lattice',
    )
  }
  if (!result.lattice
    || canonicalJsonIdentity(source.lattice.vectors) !== canonicalJsonIdentity(result.lattice.vectors)
    || canonicalJsonIdentity(result.lattice.periodic) !== canonicalJsonIdentity(resultPeriodic)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_structure_mismatch',
      'Result must preserve exact lattice vectors and use the declared finite or line-periodic boundary truth',
    )
  }
  if (source.atoms.length !== result.atoms.length) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_structure_mismatch',
      'Straight-dislocation result must preserve the exact atom count',
    )
  }
  for (let index = 0; index < source.atoms.length; index++) {
    const before = source.atoms[index]
    const after = result.atoms[index]
    if (before.id !== after.id || before.element !== after.element) {
      throw new ZatomContinuumDislocationEvidenceInputError(
        'continuum_dislocation_mapping_mismatch',
        `Atom ${index} changed ID or element`,
      )
    }
    if (STRESS_PROPERTY_NAMES.some((name) => before.properties?.[name] !== undefined)) {
      throw new ZatomContinuumDislocationEvidenceInputError(
        'continuum_dislocation_reserved_property',
        `Source atom ${before.id} already uses a reserved Atomsk stress property`,
      )
    }
    if (canonicalJsonIdentity(before.properties ?? null)
      !== canonicalJsonIdentity(withoutStressProperties(after.properties) ?? null)) {
      throw new ZatomContinuumDislocationEvidenceInputError(
        'continuum_dislocation_mapping_mismatch',
        `Result atom ${after.id} changed source atom properties`,
      )
    }
    for (const name of STRESS_PROPERTY_NAMES) scalarProperty(after, name)
  }
  if (canonicalJsonIdentity(source.bonds ?? null) !== canonicalJsonIdentity(result.bonds ?? null)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_mapping_mismatch',
      'Result changed explicit bond topology or bond properties',
    )
  }
}

function acceptance(value: unknown): ZatomContinuumDislocationEvidence['acceptance'] {
  const raw = exactObject(value, 'acceptance', [
    'maximumCellOffAxisA',
    'maximumTensorSymmetryResidualGPa',
    'minimumStiffnessEigenvalueGPa',
    'maximumStiffnessConditionNumber',
    'maximumGlidePlaneResidualA',
    'minimumTransverseExtentPerBurgers',
    'minimumCoreClearanceA',
    'maximumDisplacementA',
    'minimumPairDistanceA',
    'maximumAbsoluteStressGPa',
  ])
  return {
    maximumCellOffAxisA: finite(raw.maximumCellOffAxisA, 'acceptance.maximumCellOffAxisA', 0, 1e4),
    maximumTensorSymmetryResidualGPa: finite(raw.maximumTensorSymmetryResidualGPa, 'acceptance.maximumTensorSymmetryResidualGPa', 0, 1e9),
    minimumStiffnessEigenvalueGPa: finite(raw.minimumStiffnessEigenvalueGPa, 'acceptance.minimumStiffnessEigenvalueGPa', 0, 1e9),
    maximumStiffnessConditionNumber: finite(raw.maximumStiffnessConditionNumber, 'acceptance.maximumStiffnessConditionNumber', 1, 1e300),
    maximumGlidePlaneResidualA: finite(raw.maximumGlidePlaneResidualA, 'acceptance.maximumGlidePlaneResidualA', 0, 1e6),
    minimumTransverseExtentPerBurgers: finite(raw.minimumTransverseExtentPerBurgers, 'acceptance.minimumTransverseExtentPerBurgers', 0, 1e6),
    minimumCoreClearanceA: finite(raw.minimumCoreClearanceA, 'acceptance.minimumCoreClearanceA', 0, 1e6),
    maximumDisplacementA: finite(raw.maximumDisplacementA, 'acceptance.maximumDisplacementA', 0, 1e9),
    minimumPairDistanceA: finite(raw.minimumPairDistanceA, 'acceptance.minimumPairDistanceA', 0, 1e6),
    maximumAbsoluteStressGPa: finite(raw.maximumAbsoluteStressGPa, 'acceptance.maximumAbsoluteStressGPa', 0, 1e300),
  }
}

function provenance(value: unknown): ZatomContinuumDislocationEvidence['provenance'] {
  const raw = exactObject(value, 'provenance', [
    'engine', 'engineVersion', 'method', 'executable', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const rawExecutable = exactObject(raw.executable, 'provenance.executable', ['realPath', 'sha256'])
  const realPath = text(rawExecutable.realPath, 'provenance.executable.realPath', 8192)
  const sha256 = text(rawExecutable.sha256, 'provenance.executable.sha256', 128).toLowerCase()
  if (!/^sha256:[0-9a-f]{64}$/.test(sha256)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'provenance.executable.sha256 must be a sha256: fingerprint',
    )
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length < 1 || raw.artifacts.length > 32) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'provenance.artifacts must contain 1-32 entries')
  }
  const artifacts = raw.artifacts.map((item, index) => {
    const artifact = exactObject(item, `provenance.artifacts[${index}]`, ['id', 'role', 'fingerprint'])
    return {
      id: token(artifact.id, `provenance.artifacts[${index}].id`),
      role: token(artifact.role, `provenance.artifacts[${index}].role`, 256),
      fingerprint: token(artifact.fingerprint, `provenance.artifacts[${index}].fingerprint`, 256),
    }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'provenance artifact IDs must be unique')
  }
  if (!Array.isArray(raw.citations) || raw.citations.length < 1 || raw.citations.length > 32) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'provenance.citations must contain 1-32 entries')
  }
  const citations = raw.citations.map((item, index) => text(item, `provenance.citations[${index}]`, 4096)).sort()
  if (new Set(citations).size !== citations.length) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'provenance.citations must be unique')
  }
  return {
    engine: token(raw.engine, 'provenance.engine'),
    engineVersion: token(raw.engineVersion, 'provenance.engineVersion'),
    method: text(raw.method, 'provenance.method', 4096),
    executable: { realPath, sha256 },
    artifacts,
    parameters: jsonRecord(raw.parameters, 'provenance.parameters'),
    citations,
    scopeWarning: text(raw.scopeWarning, 'provenance.scopeWarning', 8192),
  }
}

function targetForAtom(
  id: string,
  reason: string,
  atomId: string,
  structure: ZatomStructure,
  radius: number,
): InspectionTarget {
  const atom = structure.atoms.find((candidate) => candidate.id === atomId)!
  return { id, reason, center: [...atom.position], radius, atomIds: [atomId] }
}

function buildValidation(
  raw: Record<string, unknown>,
  options: ParseZatomContinuumDislocationEvidenceOptions,
): ZatomContinuumDislocationEvidenceValidation {
  const source = options.sourceStructure
  const result = options.resultStructure
  const maxAtoms = positiveInteger(options.maxAtoms, 10_000, 'maxAtoms')
  const maxPairEvaluations = positiveInteger(options.maxPairEvaluations, 25_000_000, 'maxPairEvaluations')
  if (source.atoms.length < 2 || source.atoms.length > maxAtoms) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_budget_exceeded',
      `Source atom count must be 2-${maxAtoms}`,
    )
  }
  const pairEvaluationCount = source.atoms.length * (source.atoms.length - 1) / 2
  if (!Number.isSafeInteger(pairEvaluationCount) || pairEvaluationCount > maxPairEvaluations) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_budget_exceeded',
      `Exact pair audit requires ${pairEvaluationCount} evaluations above maxPairEvaluations ${maxPairEvaluations}`,
    )
  }

  const rawElasticity = exactObject(raw.elasticity, 'elasticity', [
    'model', 'coordinateFrame', 'voigtOrder', 'stiffnessMatrixGPa',
  ])
  if (rawElasticity.model !== 'anisotropic-linear-elasticity'
    || rawElasticity.coordinateFrame !== 'source-cartesian'
    || canonicalJsonIdentity(rawElasticity.voigtOrder) !== canonicalJsonIdentity(VOIGT_ORDER)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'elasticity must declare anisotropic linear elasticity in source Cartesian coordinates with Voigt order xx,yy,zz,yz,xz,xy',
    )
  }
  const matrix = stiffnessMatrix(rawElasticity.stiffnessMatrixGPa)
  let tensorSymmetryResidualGPa = 0
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      tensorSymmetryResidualGPa = Math.max(tensorSymmetryResidualGPa, Math.abs(matrix[i][j] - matrix[j][i]))
    }
  }
  const eigenvalues = symmetricEigenvalues(matrix)
  const minimumEigenvalue = eigenvalues[0]
  const maximumEigenvalue = eigenvalues[eigenvalues.length - 1]
  const stiffnessConditionNumber = minimumEigenvalue > 0
    ? maximumEigenvalue / minimumEigenvalue
    : 1e300

  const rawDefect = exactObject(raw.defect, 'defect', [
    'kind', 'lineAxis', 'glidePlaneNormalAxis', 'corePositionA', 'burgersVectorA',
  ], ['transverseAxis', 'burgersMagnitudeA', 'character', 'characterAngleDeg', 'glidePlaneResidualA'])
  if (rawDefect.kind !== 'straight') {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'defect.kind must be straight')
  }
  const lineAxis = axis(rawDefect.lineAxis, 'defect.lineAxis')
  const normalAxis = axis(rawDefect.glidePlaneNormalAxis, 'defect.glidePlaneNormalAxis')
  if (lineAxis === normalAxis) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'defect.lineAxis and defect.glidePlaneNormalAxis must differ',
    )
  }
  const transverseAxis = AXES.find((candidate) => candidate !== lineAxis && candidate !== normalAxis)!
  const corePositionA = vec3(rawDefect.corePositionA, 'defect.corePositionA')
  const burgersVectorA = vec3(rawDefect.burgersVectorA, 'defect.burgersVectorA')
  const burgersMagnitudeA = Math.hypot(...burgersVectorA)
  if (!(burgersMagnitudeA > 0)) {
    throw new ZatomContinuumDislocationEvidenceInputError('invalid_continuum_dislocation_evidence', 'Burgers vector must be non-zero')
  }
  const lineComponent = Math.abs(burgersVectorA[AXIS_INDEX[lineAxis]])
  const transverseComponent = Math.abs(burgersVectorA[AXIS_INDEX[transverseAxis]])
  const glidePlaneResidualA = Math.abs(burgersVectorA[AXIS_INDEX[normalAxis]])
  const characterAngleDeg = Math.acos(Math.min(1, lineComponent / burgersMagnitudeA)) * 180 / Math.PI
  const componentTolerance = 1e-10 * Math.max(1, burgersMagnitudeA)
  const character: ZatomStraightDislocationCharacter = transverseComponent <= componentTolerance
    ? 'screw'
    : lineComponent <= componentTolerance
      ? 'edge'
      : 'mixed'

  const rawBoundary = exactObject(raw.boundary, 'boundary', ['mode'], [
    'sourcePeriodic', 'resultPeriodic', 'latticeVectorsPreserved',
  ])
  const mode = boundaryMode(rawBoundary.mode)
  const resultPeriodic = expectedPeriodic(mode, lineAxis)
  assertStructureRelationship(source, result, resultPeriodic)
  const sourceFingerprint = fingerprintStructure(source)
  const resultFingerprint = fingerprintStructure(result)
  const cell = source.lattice!.vectors
  const cellLengths: Vec3 = [cell[0][0], cell[1][1], cell[2][2]]
  if (cellLengths.some((length) => !(length > 0))) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_structure_mismatch',
      'Source cell must use positive Cartesian-axis diagonal vectors',
    )
  }
  for (const atom of source.atoms) {
    for (let index = 0; index < 3; index++) {
      const tolerance = 1e-8 * Math.max(1, cellLengths[index])
      if (atom.position[index] < -tolerance || atom.position[index] > cellLengths[index] + tolerance) {
        throw new ZatomContinuumDislocationEvidenceInputError(
          'continuum_dislocation_structure_mismatch',
          `Source atom ${atom.id} lies outside the zero-origin Cartesian source cell`,
        )
      }
    }
  }
  for (const candidate of AXES) {
    const index = AXIS_INDEX[candidate]
    if (corePositionA[index] < 0 || corePositionA[index] >= cellLengths[index]) {
      throw new ZatomContinuumDislocationEvidenceInputError(
        'continuum_dislocation_geometry_mismatch',
        `Core position lies outside the source cell along ${candidate}`,
      )
    }
  }

  const rawMapping = exactObject(raw.mapping, 'mapping', ['mode'], [
    'atomCount', 'preservesAtomOrderIdsElementsTopologyAndSourceProperties', 'addedAtomPropertyNames',
  ])
  if (rawMapping.mode !== 'source-index-auxiliary-readback') {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      'mapping.mode must be source-index-auxiliary-readback',
    )
  }
  const accepted = acceptance(raw.acceptance)
  const normalizedProvenance = provenance(raw.provenance)
  const metadata = raw.metadata === undefined ? undefined : jsonRecord(raw.metadata, 'metadata')
  if (metadata && utf8Bytes(metadata) > positiveInteger(options.maxMetadataBytes, 256 * 1024, 'maxMetadataBytes')) {
    throw new ZatomContinuumDislocationEvidenceInputError('continuum_dislocation_budget_exceeded', 'metadata exceeds maxMetadataBytes')
  }

  const maximumCellOffAxisA = maximumCellOffAxis(cell)
  const minimumTransverseExtentPerBurgers = Math.min(
    cellLengths[AXIS_INDEX[transverseAxis]],
    cellLengths[AXIS_INDEX[normalAxis]],
  ) / burgersMagnitudeA
  const sourceCoreDistances = source.atoms.map((atom) => {
    const dx = atom.position[AXIS_INDEX[transverseAxis]] - corePositionA[AXIS_INDEX[transverseAxis]]
    const dy = atom.position[AXIS_INDEX[normalAxis]] - corePositionA[AXIS_INDEX[normalAxis]]
    return { atomId: atom.id, distanceA: Math.hypot(dx, dy) }
  }).sort((left, right) => left.distanceA - right.distanceA || compareCanonicalText(left.atomId, right.atomId))
  const sourceCoreClearanceA = sourceCoreDistances[0].distanceA

  let maximumDisplacementA = -1
  let displacementSquareSum = 0
  let maximumDisplacementAtomId = result.atoms[0].id
  for (let index = 0; index < source.atoms.length; index++) {
    const before = source.atoms[index].position
    const after = result.atoms[index].position
    const displacement = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])
    displacementSquareSum += displacement * displacement
    if (displacement > maximumDisplacementA) {
      maximumDisplacementA = displacement
      maximumDisplacementAtomId = result.atoms[index].id
    }
  }
  const rmsDisplacementA = Math.sqrt(displacementSquareSum / source.atoms.length)

  let minimumPairDistanceA = Infinity
  let closestPairAtomIds: [string, string] = [result.atoms[0].id, result.atoms[1].id]
  const lineIndex = AXIS_INDEX[lineAxis]
  const lineLength = cellLengths[lineIndex]
  for (let left = 0; left < result.atoms.length; left++) {
    for (let right = left + 1; right < result.atoms.length; right++) {
      const delta: Vec3 = [
        result.atoms[right].position[0] - result.atoms[left].position[0],
        result.atoms[right].position[1] - result.atoms[left].position[1],
        result.atoms[right].position[2] - result.atoms[left].position[2],
      ]
      if (mode === 'line-periodic') delta[lineIndex] -= Math.round(delta[lineIndex] / lineLength) * lineLength
      const pairDistance = Math.hypot(...delta)
      if (pairDistance < minimumPairDistanceA) {
        minimumPairDistanceA = pairDistance
        closestPairAtomIds = [result.atoms[left].id, result.atoms[right].id]
      }
    }
  }

  let maximumAbsoluteStressGPa = -1
  let maximumVonMisesStressGPa = -1
  let maximumVonMisesStressAtomId = result.atoms[0].id
  for (const atom of result.atoms) {
    const sxx = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.xx)
    const syy = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.yy)
    const szz = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.zz)
    const syz = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.yz)
    const sxz = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.xz)
    const sxy = scalarProperty(atom, ZATOM_ATOMSK_STRESS_PROPERTIES.xy)
    maximumAbsoluteStressGPa = Math.max(maximumAbsoluteStressGPa, Math.abs(sxx), Math.abs(syy), Math.abs(szz), Math.abs(syz), Math.abs(sxz), Math.abs(sxy))
    const vonMises = Math.sqrt(
      0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2)
      + 3 * (sxy * sxy + syz * syz + sxz * sxz),
    )
    if (vonMises > maximumVonMisesStressGPa) {
      maximumVonMisesStressGPa = vonMises
      maximumVonMisesStressAtomId = atom.id
    }
  }

  const gateResults = {
    cell: maximumCellOffAxisA <= accepted.maximumCellOffAxisA,
    symmetry: tensorSymmetryResidualGPa <= accepted.maximumTensorSymmetryResidualGPa,
    positiveDefinite: minimumEigenvalue >= accepted.minimumStiffnessEigenvalueGPa,
    condition: stiffnessConditionNumber <= accepted.maximumStiffnessConditionNumber,
    glide: glidePlaneResidualA <= accepted.maximumGlidePlaneResidualA,
    extent: minimumTransverseExtentPerBurgers >= accepted.minimumTransverseExtentPerBurgers,
    core: sourceCoreClearanceA >= accepted.minimumCoreClearanceA,
    displacement: maximumDisplacementA <= accepted.maximumDisplacementA,
    pair: minimumPairDistanceA >= accepted.minimumPairDistanceA,
    stress: maximumAbsoluteStressGPa <= accepted.maximumAbsoluteStressGPa,
  }
  const acceptancePassed = Object.values(gateResults).every(Boolean)
  const evidence: ZatomContinuumDislocationEvidence = {
    schemaVersion: ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: sourceFingerprint,
    resultStructureFingerprint: resultFingerprint,
    elasticity: {
      model: 'anisotropic-linear-elasticity',
      coordinateFrame: 'source-cartesian',
      voigtOrder: [...VOIGT_ORDER],
      stiffnessMatrixGPa: matrix,
    },
    defect: {
      kind: 'straight',
      lineAxis,
      glidePlaneNormalAxis: normalAxis,
      transverseAxis,
      corePositionA,
      burgersVectorA,
      burgersMagnitudeA,
      character,
      characterAngleDeg,
      glidePlaneResidualA,
    },
    mapping: {
      mode: 'source-index-auxiliary-readback',
      atomCount: source.atoms.length,
      preservesAtomOrderIdsElementsTopologyAndSourceProperties: true,
      addedAtomPropertyNames: [...STRESS_PROPERTY_NAMES],
    },
    boundary: {
      mode,
      sourcePeriodic: [true, true, true],
      resultPeriodic,
      latticeVectorsPreserved: true,
    },
    acceptance: accepted,
    metrics: {
      maximumCellOffAxisA,
      tensorSymmetryResidualGPa,
      stiffnessEigenvaluesGPa: eigenvalues,
      minimumStiffnessEigenvalueGPa: minimumEigenvalue,
      maximumStiffnessEigenvalueGPa: maximumEigenvalue,
      stiffnessConditionNumber,
      minimumTransverseExtentPerBurgers,
      sourceCoreClearanceA,
      maximumDisplacementA,
      rmsDisplacementA,
      minimumPairDistanceA,
      pairEvaluationCount,
      maximumAbsoluteStressGPa,
      maximumVonMisesStressGPa,
      acceptancePassed,
    },
    diagnostics: {
      nearestCoreAtomIds: sourceCoreDistances.slice(0, 12).map((item) => item.atomId),
      maximumDisplacementAtomId,
      maximumVonMisesStressAtomId,
      closestPairAtomIds,
    },
    provenance: normalizedProvenance,
    ...(metadata ? { metadata } : {}),
  }
  if (utf8Bytes(evidence) > positiveInteger(options.maxArtifactBytes, 8 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomContinuumDislocationEvidenceInputError('continuum_dislocation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }

  const checks: ValidationCheck[] = [
    {
      id: 'continuum_dislocation.structure_binding',
      status: 'pass',
      message: 'Exact source/result fingerprints, atom mapping, topology, lattice vectors, and source properties are bound',
      metrics: { atomCount: source.atoms.length, sourceFingerprint, resultFingerprint },
    },
    {
      id: 'continuum_dislocation.elastic_tensor',
      status: gateResults.cell && gateResults.symmetry && gateResults.positiveDefinite && gateResults.condition ? 'pass' : 'fail',
      message: gateResults.cell && gateResults.symmetry && gateResults.positiveDefinite && gateResults.condition
        ? 'Cartesian cell and anisotropic stiffness tensor satisfy symmetry, positive-definiteness, and conditioning gates'
        : 'Cartesian cell or anisotropic stiffness tensor exceeds an acceptance gate',
      metrics: {
        maximumCellOffAxisA,
        tensorSymmetryResidualGPa,
        minimumStiffnessEigenvalueGPa: minimumEigenvalue,
        stiffnessConditionNumber,
      },
    },
    {
      id: 'continuum_dislocation.glide_geometry',
      status: gateResults.glide && gateResults.extent ? 'pass' : 'fail',
      message: gateResults.glide && gateResults.extent
        ? 'Burgers vector lies in the declared glide plane and the transverse cell extent satisfies its gate'
        : 'Glide-plane residual or transverse cell extent exceeds an acceptance gate',
      metrics: { glidePlaneResidualA, minimumTransverseExtentPerBurgers, burgersMagnitudeA, characterAngleDeg },
    },
    {
      id: 'continuum_dislocation.boundary_truth',
      status: 'pass',
      message: mode === 'finite'
        ? 'Result makes no periodic-boundary claim after inserting one straight dislocation'
        : `Result claims periodicity only along the ${lineAxis.toUpperCase()} dislocation line`,
      metrics: { boundaryMode: mode, periodicX: resultPeriodic[0], periodicY: resultPeriodic[1], periodicZ: resultPeriodic[2] },
    },
    {
      id: 'continuum_dislocation.core_clearance',
      status: gateResults.core ? 'pass' : 'fail',
      message: gateResults.core ? 'No source atom lies inside the declared core-clearance gate' : 'A source atom lies too close to the singular continuum line',
      metrics: { sourceCoreClearanceA, acceptedMinimumCoreClearanceA: accepted.minimumCoreClearanceA },
      atomIds: evidence.diagnostics.nearestCoreAtomIds,
    },
    {
      id: 'continuum_dislocation.displacement',
      status: gateResults.displacement ? 'pass' : 'fail',
      message: gateResults.displacement ? 'All Atomsk displacements satisfy the declared ceiling' : 'At least one Atomsk displacement exceeds the declared ceiling',
      metrics: { maximumDisplacementA, rmsDisplacementA, acceptedMaximumDisplacementA: accepted.maximumDisplacementA },
      atomIds: [maximumDisplacementAtomId],
    },
    {
      id: 'continuum_dislocation.minimum_distance',
      status: gateResults.pair ? 'pass' : 'fail',
      message: gateResults.pair ? 'Exact result pair scan satisfies the minimum-distance gate' : 'The result contains a pair below the minimum-distance gate',
      metrics: { minimumPairDistanceA, acceptedMinimumPairDistanceA: accepted.minimumPairDistanceA, pairEvaluationCount },
      atomIds: closestPairAtomIds,
    },
    {
      id: 'continuum_dislocation.stress_field',
      status: gateResults.stress ? 'pass' : 'fail',
      message: gateResults.stress ? 'All six finite Atomsk theoretical stress components satisfy the declared ceiling' : 'The theoretical stress field exceeds the declared ceiling',
      metrics: { maximumAbsoluteStressGPa, maximumVonMisesStressGPa, acceptedMaximumAbsoluteStressGPa: accepted.maximumAbsoluteStressGPa },
      atomIds: [maximumVonMisesStressAtomId],
    },
    {
      id: 'continuum_dislocation.model_scope',
      status: 'warn',
      message: normalizedProvenance.scopeWarning,
    },
  ]
  const coreRadius = Math.max(2, 2 * burgersMagnitudeA, sourceCoreDistances[Math.min(11, sourceCoreDistances.length - 1)].distanceA)
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'continuum-dislocation-core',
      reason: `Inspect the ${character} dislocation core and its nearest mapped atoms`,
      center: [...corePositionA],
      radius: coreRadius,
      atomIds: [...evidence.diagnostics.nearestCoreAtomIds],
    },
    targetForAtom(
      'continuum-dislocation-maximum-displacement',
      `Inspect maximum displacement ${maximumDisplacementA.toPrecision(6)} Å`,
      maximumDisplacementAtomId,
      result,
      Math.max(2, burgersMagnitudeA),
    ),
    targetForAtom(
      'continuum-dislocation-maximum-stress',
      `Inspect maximum theoretical von Mises stress ${maximumVonMisesStressGPa.toPrecision(6)} GPa`,
      maximumVonMisesStressAtomId,
      result,
      Math.max(2, burgersMagnitudeA),
    ),
    {
      id: 'continuum-dislocation-closest-pair',
      reason: `Inspect exact closest result pair at ${minimumPairDistanceA.toPrecision(6)} Å`,
      center: [...result.atoms.find((atom) => atom.id === closestPairAtomIds[0])!.position],
      radius: Math.max(2, 2 * minimumPairDistanceA),
      atomIds: [...closestPairAtomIds],
    },
  ]
  return { evidence, fingerprint: fingerprintContinuumDislocationEvidence(evidence), checks, inspectionTargets }
}

export function parseZatomContinuumDislocationEvidence(
  value: unknown,
  options: ParseZatomContinuumDislocationEvidenceOptions,
): ZatomContinuumDislocationEvidenceValidation {
  if (utf8Bytes(value) > positiveInteger(options.maxArtifactBytes, 8 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomContinuumDislocationEvidenceInputError('continuum_dislocation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const raw = exactObject(value, 'evidence', [
    'schemaVersion',
    'sourceStructureFingerprint',
    'resultStructureFingerprint',
    'elasticity',
    'defect',
    'mapping',
    'boundary',
    'acceptance',
    'metrics',
    'diagnostics',
    'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'invalid_continuum_dislocation_evidence',
      `schemaVersion must be ${ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA}`,
    )
  }
  const validation = buildValidation(raw, options)
  if (canonicalJsonIdentity(raw) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomContinuumDislocationEvidenceInputError(
      'continuum_dislocation_derived_mismatch',
      'Evidence differs from canonical structure-derived fingerprints, geometry, mapping, boundary, diagnostics, or metrics',
    )
  }
  return validation
}

export function composeZatomContinuumDislocationEvidence(
  input: ComposeZatomContinuumDislocationEvidenceInput,
  budgets: Omit<ParseZatomContinuumDislocationEvidenceOptions, 'sourceStructure' | 'resultStructure'> = {},
): ZatomContinuumDislocationEvidenceValidation {
  return buildValidation({
    elasticity: input.elasticity,
    defect: input.defect,
    mapping: input.mapping,
    boundary: input.boundary,
    acceptance: input.acceptance,
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    resultStructure: input.resultStructure,
    ...budgets,
  })
}
