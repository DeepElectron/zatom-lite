/** Canonical, source/result-bound evidence for deterministic fixed-cell relaxation. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  certifiedMinimumImageVector,
  compareCanonicalText,
  determinant3,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { parseZatomStructure, validateStructure, ZatomStructureInputError } from './structure-validation'

export const ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA =
  'zatom.fixed-cell-relaxation-evidence/v1' as const

export interface ZatomRelaxationStressObservation {
  pressureBar: number
  tensorBar: { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number }
  volumeA3: number
  quantity: 'pressure-tensor'
  signConvention: 'positive-compression'
  coordinateFrame: 'source-cartesian'
}

export interface ZatomFixedCellRelaxationEvidence {
  schemaVersion: typeof ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  resultStructureFingerprint: string
  method: {
    kind: 'position-minimization'
    cellConstraint: 'fixed'
    temperatureK: 0
    engine: 'LAMMPS'
    engineVersion: string
  }
  model: {
    id: string
    version: string
    description: string
    elements: string[]
    commandsFingerprint: string
    artifacts: Array<{ id: string; role: string; fingerprint: string }>
    citations: string[]
    scopeWarning: string
  }
  settings: {
    maxIterations: number
    maxEvaluations: number
    energyTolerance: number
    forceToleranceEvPerA: number
    minStyle: 'cg' | 'fire' | 'hftn' | 'quickmin' | 'sd'
    fixedAtomIds: string[]
  }
  observations: {
    initial: {
      potentialEnergyEv: number
      reportedMaxForceComponentRestrictedEvPerA: number
      step: number
      stress: ZatomRelaxationStressObservation
    }
    final: {
      potentialEnergyEv: number
      reportedMaxForceComponentRestrictedEvPerA: number
      step: number
      stress: ZatomRelaxationStressObservation
    }
  }
  acceptance: {
    maximumEnergyIncreaseEv: number
    maximumForceEvPerA: number
    maximumDisplacementA: number
    maximumFixedAtomDisplacementA: number
    minimumPairDistanceA: number
  }
  mapping: {
    atomCount: number
    elementCounts: Record<string, number>
    stableAtomIdsElementsAndOrder: true
    bondsAndNonForceAtomPropertiesPreserved: true
  }
  boundary: {
    sourcePeriodic: [true, true, true]
    resultPeriodic: [true, true, true]
    exactFixedLattice: true
    sourceCellVolumeA3: number
    resultCellVolumeA3: number
    restrictedAxesInSourceCartesian: Mat3
  }
  metrics: {
    potentialEnergyChangeEv: number
    potentialEnergyChangePerAtomEv: number
    maximumForceEvPerA: number
    rmsForceEvPerA: number
    maximumForceComponentRestrictedEvPerA: number
    maximumDisplacementA: number
    rmsDisplacementA: number
    maximumFixedAtomDisplacementA: number
    minimumPairDistanceA: number
    pairCount: number
    minimumImageCandidateEvaluations: number
    finalMaximumAbsoluteStressBar: number
    finalHydrostaticPressureBar: number
    acceptancePassed: boolean
  }
  diagnostics: {
    maximumForceAtomId: string
    maximumDisplacementAtomId: string
    closestPairAtomIds: [string, string]
  }
  provenance: {
    providerId: string
    adapterVersion: string
    executable: { realPath: string; totalBytes: number; sha256: string }
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ComposeZatomFixedCellRelaxationEvidenceInput {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  method: ZatomFixedCellRelaxationEvidence['method']
  model: ZatomFixedCellRelaxationEvidence['model']
  settings: ZatomFixedCellRelaxationEvidence['settings']
  observations: ZatomFixedCellRelaxationEvidence['observations']
  acceptance: ZatomFixedCellRelaxationEvidence['acceptance']
  provenance: ZatomFixedCellRelaxationEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomFixedCellRelaxationEvidenceOptions {
  sourceStructure: ZatomStructure
  resultStructure: ZatomStructure
  maxAtoms?: number
  maxPairScanAtoms?: number
  maxMinimumImageCandidateEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomFixedCellRelaxationEvidenceValidation {
  evidence: ZatomFixedCellRelaxationEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomFixedCellRelaxationEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomFixedCellRelaxationEvidenceInputError'
    this.code = code
  }
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
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'invalid_fixed_cell_relaxation_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'invalid_fixed_cell_relaxation_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = finite(value, field, minimum, maximum)
  if (!Number.isSafeInteger(result)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} must be an integer`)
  }
  return result
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_context', `${field} must be a positive integer`)
  }
  return result
}

function text(value: unknown, field: string, maximum = 8192): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'invalid_fixed_cell_relaxation_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (!/^[A-Za-z0-9_.:+@/\[\], -]+$/.test(result)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} contains unsupported characters`)
  }
  return result
}

function uniqueTexts(value: unknown, field: string, minimum = 0, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'invalid_fixed_cell_relaxation_evidence',
      `${field} must contain ${minimum}-${maximum} strings`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} must not repeat values`)
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
  throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} must be a JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintFixedCellRelaxationEvidence(value: ZatomFixedCellRelaxationEvidence): string {
  return fingerprintCanonicalJson(value)
}

export function fingerprintLammpsPotentialCommands(lines: readonly string[]): string {
  return fingerprintCanonicalJson(lines.map((line) => line.trim()))
}

function countElements(structure: ZatomStructure): Record<string, number> {
  const result: Record<string, number> = {}
  for (const atom of structure.atoms) result[atom.element] = (result[atom.element] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => compareCanonicalText(left, right)))
}

function sameLattice(left: ZatomStructure, right: ZatomStructure): boolean {
  if (!left.lattice || !right.lattice) return false
  return left.lattice.periodic.every((value, axis) => value === right.lattice!.periodic[axis])
    && left.lattice.vectors.every((row, rowIndex) => row.every((value, axis) => {
      const observed = right.lattice!.vectors[rowIndex][axis]
      return Math.abs(value - observed) <= 1e-10 * Math.max(1, Math.abs(value), Math.abs(observed))
    }))
}

const FORCE_VECTOR_PROPERTY = 'zatom.lammps.forceEvPerA'
const FORCE_MAGNITUDE_PROPERTY = 'zatom.lammps.forceMagnitudeEvPerA'

function nonForceProperties(value: ZatomStructure['atoms'][number]['properties']): Record<string, JsonValue> | undefined {
  if (!value) return undefined
  const entries = Object.entries(value).filter(([key]) => key !== FORCE_VECTOR_PROPERTY && key !== FORCE_MAGNITUDE_PROPERTY)
  return entries.length ? Object.fromEntries(entries) : undefined
}

function vec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field} must contain three numbers`)
  }
  return [finite(value[0], `${field}[0]`), finite(value[1], `${field}[1]`), finite(value[2], `${field}[2]`)]
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function scale(value: readonly number[], factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function restrictedAxes(vectors: Mat3): Mat3 {
  const ex = scale(vectors[0], 1 / norm(vectors[0]))
  const projected = scale(ex, dot(vectors[1], ex))
  const by = subtract(vectors[1], projected)
  const ey = scale(by, 1 / norm(by))
  const ezRaw = cross(ex, ey)
  const ez = scale(ezRaw, 1 / norm(ezRaw))
  if ([...ex, ...ey, ...ez].some((value) => !Number.isFinite(value))) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_context', 'Source lattice cannot define restricted triclinic axes')
  }
  return [ex, ey, ez]
}

function parseStress(value: unknown, field: string, expectedVolumeA3: number): ZatomRelaxationStressObservation {
  const record = exactObject(value, field, [
    'pressureBar', 'tensorBar', 'volumeA3', 'quantity', 'signConvention', 'coordinateFrame',
  ])
  if (record.quantity !== 'pressure-tensor' || record.signConvention !== 'positive-compression') {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'invalid_fixed_cell_relaxation_evidence',
      `${field} must identify the LAMMPS pressure tensor with positive-compression sign convention`,
    )
  }
  if (record.coordinateFrame !== 'source-cartesian') {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `${field}.coordinateFrame must be source-cartesian`)
  }
  const tensor = exactObject(record.tensorBar, `${field}.tensorBar`, ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'])
  const result: ZatomRelaxationStressObservation = {
    pressureBar: finite(record.pressureBar, `${field}.pressureBar`),
    tensorBar: {
      xx: finite(tensor.xx, `${field}.tensorBar.xx`),
      yy: finite(tensor.yy, `${field}.tensorBar.yy`),
      zz: finite(tensor.zz, `${field}.tensorBar.zz`),
      xy: finite(tensor.xy, `${field}.tensorBar.xy`),
      xz: finite(tensor.xz, `${field}.tensorBar.xz`),
      yz: finite(tensor.yz, `${field}.tensorBar.yz`),
    },
    volumeA3: finite(record.volumeA3, `${field}.volumeA3`, 1e-20),
    quantity: 'pressure-tensor',
    signConvention: 'positive-compression',
    coordinateFrame: 'source-cartesian',
  }
  const volumeResidual = Math.abs(result.volumeA3 - expectedVolumeA3) / expectedVolumeA3
  if (volumeResidual > 1e-8) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_stress_volume_mismatch', `${field}.volumeA3 does not match the fixed source cell`)
  }
  const tracePressure = (result.tensorBar.xx + result.tensorBar.yy + result.tensorBar.zz) / 3
  if (Math.abs(tracePressure - result.pressureBar) > 1e-8 * Math.max(1, Math.abs(tracePressure), Math.abs(result.pressureBar))) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_pressure_mismatch', `${field}.pressureBar does not equal the tensor trace divided by three`)
  }
  return result
}

function parseObservation(value: unknown, field: string, expectedVolumeA3: number) {
  const record = exactObject(value, field, [
    'potentialEnergyEv', 'reportedMaxForceComponentRestrictedEvPerA', 'step', 'stress',
  ])
  return {
    potentialEnergyEv: finite(record.potentialEnergyEv, `${field}.potentialEnergyEv`),
    reportedMaxForceComponentRestrictedEvPerA: finite(
      record.reportedMaxForceComponentRestrictedEvPerA,
      `${field}.reportedMaxForceComponentRestrictedEvPerA`,
      0,
    ),
    step: integer(record.step, `${field}.step`, 0, 1_000_000_000),
    stress: parseStress(record.stress, `${field}.stress`, expectedVolumeA3),
  }
}

function parseArtifacts(value: unknown): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length > 64) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'model.artifacts must contain 0-64 entries')
  }
  const result = value.map((item, index) => {
    const field = `evidence.model.artifacts[${index}]`
    const record = exactObject(item, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'model.artifact IDs must be unique')
  }
  return result
}

function buildValidation(
  rawValue: unknown,
  options: ParseZatomFixedCellRelaxationEvidenceOptions,
): ZatomFixedCellRelaxationEvidenceValidation {
  const maxAtoms = positiveBudget(options.maxAtoms, 100_000, 'maxAtoms')
  const maxPairScanAtoms = positiveBudget(options.maxPairScanAtoms, 5000, 'maxPairScanAtoms')
  const maxCandidates = positiveBudget(
    options.maxMinimumImageCandidateEvaluations,
    50_000_000,
    'maxMinimumImageCandidateEvaluations',
  )
  const maxMetadataBytes = positiveBudget(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const source = parseZatomStructure(options.sourceStructure)
  const result = parseZatomStructure(options.resultStructure)
  if (!source.lattice || !result.lattice || !source.lattice.periodic.every(Boolean) || !result.lattice.periodic.every(Boolean)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_full_pbc_required', 'Source and result must both be fully periodic')
  }
  if (source.atoms.length < 2 || source.atoms.length > maxAtoms || result.atoms.length !== source.atoms.length) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_atom_count_mismatch', `Source/result must preserve 2-${maxAtoms} ordered atoms`)
  }
  const sourceValidation = validateStructure(source, { requirePeriodic: true, maxPairScanAtoms: Math.min(source.atoms.length, maxPairScanAtoms) })
  const resultValidation = validateStructure(result, { requirePeriodic: true, maxPairScanAtoms: Math.min(result.atoms.length, maxPairScanAtoms) })
  if ([...sourceValidation.checks, ...resultValidation.checks].some((check) => check.status === 'fail')) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_structure', 'Source or result structure fails canonical numeric validation')
  }
  if (!sameLattice(source, result)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_lattice_changed', 'Fixed-cell relaxation changed a lattice vector or periodic flag')
  }
  const sourceVolumeA3 = determinant3(source.lattice.vectors)
  const resultVolumeA3 = determinant3(result.lattice.vectors)
  if (!Number.isFinite(sourceVolumeA3) || sourceVolumeA3 <= 1e-12 || Math.abs(resultVolumeA3 - sourceVolumeA3) > 1e-10 * sourceVolumeA3) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_lattice_changed', 'Source/result fixed-cell volumes differ')
  }
  for (let index = 0; index < source.atoms.length; index++) {
    const before = source.atoms[index]
    const after = result.atoms[index]
    if (before.id !== after.id || before.element !== after.element) {
      throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_mapping_mismatch', `Atom ${index} changed stable ID or element`)
    }
    if (canonicalJsonIdentity(nonForceProperties(before.properties)) !== canonicalJsonIdentity(nonForceProperties(after.properties))) {
      throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_property_mismatch', `Atom ${before.id} changed a non-force property`)
    }
  }
  if (canonicalJsonIdentity(source.bonds) !== canonicalJsonIdentity(result.bonds)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_topology_mismatch', 'Canonical bonds changed during fixed-cell relaxation')
  }

  const raw = exactObject(rawValue, 'evidence', [
    'schemaVersion', 'sourceStructureFingerprint', 'resultStructureFingerprint', 'method', 'model',
    'settings', 'observations', 'acceptance', 'mapping', 'boundary', 'metrics', 'diagnostics', 'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', `schemaVersion must be ${ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA}`)
  }
  const rawMethod = exactObject(raw.method, 'evidence.method', ['kind', 'cellConstraint', 'temperatureK', 'engine', 'engineVersion'])
  if (rawMethod.kind !== 'position-minimization' || rawMethod.cellConstraint !== 'fixed'
    || rawMethod.temperatureK !== 0 || rawMethod.engine !== 'LAMMPS') {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'method must be 0 K LAMMPS position-minimization with a fixed cell')
  }
  const method: ZatomFixedCellRelaxationEvidence['method'] = {
    kind: 'position-minimization',
    cellConstraint: 'fixed',
    temperatureK: 0,
    engine: 'LAMMPS',
    engineVersion: text(rawMethod.engineVersion, 'evidence.method.engineVersion', 256),
  }
  const rawModel = exactObject(raw.model, 'evidence.model', [
    'id', 'version', 'description', 'elements', 'commandsFingerprint', 'artifacts', 'citations', 'scopeWarning',
  ])
  const elements = uniqueTexts(rawModel.elements, 'evidence.model.elements', 1, 118).sort()
  const sourceElements = Object.keys(countElements(source)).sort()
  if (canonicalJsonIdentity(elements) !== canonicalJsonIdentity(sourceElements)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_model_elements_mismatch', 'Model elements must exactly cover source elements')
  }
  const commandsFingerprint = text(rawModel.commandsFingerprint, 'evidence.model.commandsFingerprint', 128)
  if (!/^fnv1a64:[0-9a-f]{16}$/.test(commandsFingerprint)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'model.commandsFingerprint must be canonical fnv1a64')
  }
  const model: ZatomFixedCellRelaxationEvidence['model'] = {
    id: token(rawModel.id, 'evidence.model.id'),
    version: text(rawModel.version, 'evidence.model.version', 256),
    description: text(rawModel.description, 'evidence.model.description'),
    elements,
    commandsFingerprint,
    artifacts: parseArtifacts(rawModel.artifacts),
    citations: uniqueTexts(rawModel.citations, 'evidence.model.citations', 0, 32),
    scopeWarning: text(rawModel.scopeWarning, 'evidence.model.scopeWarning'),
  }
  const expectedResultMetadata: Record<string, JsonValue> = {
    'zatom.lammps.potential': model.id,
    'zatom.lammps.potentialVersion': model.version,
    'zatom.lammps.engineVersion': method.engineVersion,
    'zatom.lammps.geometricState': 'position-minimized-fixed-cell',
  }
  for (const [key, expected] of Object.entries(expectedResultMetadata)) {
    if (canonicalJsonIdentity(result.metadata?.[key]) !== canonicalJsonIdentity(expected)) {
      throw new ZatomFixedCellRelaxationEvidenceInputError(
        'fixed_cell_relaxation_result_metadata_mismatch',
        `Result metadata ${key} must equal the canonical relaxation model/method identity`,
      )
    }
  }
  const rawSettings = exactObject(raw.settings, 'evidence.settings', [
    'maxIterations', 'maxEvaluations', 'energyTolerance', 'forceToleranceEvPerA', 'minStyle', 'fixedAtomIds',
  ])
  if (!['cg', 'fire', 'hftn', 'quickmin', 'sd'].includes(String(rawSettings.minStyle))) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'settings.minStyle is unsupported')
  }
  const fixedAtomIds = uniqueTexts(rawSettings.fixedAtomIds, 'evidence.settings.fixedAtomIds', 0, 5000).sort()
  const sourceIds = new Set(source.atoms.map((atom) => atom.id))
  if (fixedAtomIds.some((id) => !sourceIds.has(id))) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_fixed_atom_missing', 'settings.fixedAtomIds contains an ID absent from source')
  }
  const settings: ZatomFixedCellRelaxationEvidence['settings'] = {
    maxIterations: integer(rawSettings.maxIterations, 'evidence.settings.maxIterations', 1, 1_000_000),
    maxEvaluations: integer(rawSettings.maxEvaluations, 'evidence.settings.maxEvaluations', 1, 10_000_000),
    energyTolerance: finite(rawSettings.energyTolerance, 'evidence.settings.energyTolerance', 0, 1),
    forceToleranceEvPerA: finite(rawSettings.forceToleranceEvPerA, 'evidence.settings.forceToleranceEvPerA', 0, 1e6),
    minStyle: rawSettings.minStyle as ZatomFixedCellRelaxationEvidence['settings']['minStyle'],
    fixedAtomIds,
  }
  const rawObservations = exactObject(raw.observations, 'evidence.observations', ['initial', 'final'])
  const observations = {
    initial: parseObservation(rawObservations.initial, 'evidence.observations.initial', sourceVolumeA3),
    final: parseObservation(rawObservations.final, 'evidence.observations.final', sourceVolumeA3),
  }
  if (observations.final.step < observations.initial.step) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_step_mismatch', 'Final minimizer step precedes initial step')
  }
  const rawAcceptance = exactObject(raw.acceptance, 'evidence.acceptance', [
    'maximumEnergyIncreaseEv', 'maximumForceEvPerA', 'maximumDisplacementA',
    'maximumFixedAtomDisplacementA', 'minimumPairDistanceA',
  ])
  const acceptance: ZatomFixedCellRelaxationEvidence['acceptance'] = {
    maximumEnergyIncreaseEv: finite(rawAcceptance.maximumEnergyIncreaseEv, 'evidence.acceptance.maximumEnergyIncreaseEv', 0, 1e12),
    maximumForceEvPerA: finite(rawAcceptance.maximumForceEvPerA, 'evidence.acceptance.maximumForceEvPerA', 0, 1e6),
    maximumDisplacementA: finite(rawAcceptance.maximumDisplacementA, 'evidence.acceptance.maximumDisplacementA', 0, 1e6),
    maximumFixedAtomDisplacementA: finite(rawAcceptance.maximumFixedAtomDisplacementA, 'evidence.acceptance.maximumFixedAtomDisplacementA', 0, 1e6),
    minimumPairDistanceA: finite(rawAcceptance.minimumPairDistanceA, 'evidence.acceptance.minimumPairDistanceA', 0, 1e6),
  }
  const rawProvenance = exactObject(raw.provenance, 'evidence.provenance', [
    'providerId', 'adapterVersion', 'executable', 'parameters', 'citations', 'scopeWarning',
  ])
  const rawExecutable = exactObject(rawProvenance.executable, 'evidence.provenance.executable', ['realPath', 'totalBytes', 'sha256'])
  const executableSha256 = text(rawExecutable.sha256, 'evidence.provenance.executable.sha256', 96)
  if (!/^sha256:[0-9a-f]{64}$/.test(executableSha256)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('invalid_fixed_cell_relaxation_evidence', 'Executable fingerprint must be sha256:<64 lowercase hex>')
  }
  const provenance: ZatomFixedCellRelaxationEvidence['provenance'] = {
    providerId: token(rawProvenance.providerId, 'evidence.provenance.providerId'),
    adapterVersion: text(rawProvenance.adapterVersion, 'evidence.provenance.adapterVersion', 256),
    executable: {
      realPath: text(rawExecutable.realPath, 'evidence.provenance.executable.realPath'),
      totalBytes: integer(rawExecutable.totalBytes, 'evidence.provenance.executable.totalBytes', 1, Number.MAX_SAFE_INTEGER),
      sha256: executableSha256,
    },
    parameters: jsonRecord(rawProvenance.parameters, 'evidence.provenance.parameters'),
    citations: uniqueTexts(rawProvenance.citations, 'evidence.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'evidence.provenance.scopeWarning'),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (raw.metadata !== undefined) {
    if (utf8Bytes(raw.metadata) > maxMetadataBytes) {
      throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_budget_exceeded', 'metadata exceeds maxMetadataBytes')
    }
    metadata = jsonRecord(raw.metadata, 'evidence.metadata')
  }

  const axes = restrictedAxes(source.lattice.vectors)
  let candidateEvaluations = 0
  const displacementRows = source.atoms.map((atom, index) => {
    try {
      const row = certifiedMinimumImageVector(
        subtract(result.atoms[index].position, atom.position),
        source.lattice!,
        maxCandidates - candidateEvaluations,
      )
      candidateEvaluations += row.candidateEvaluations
      return row
    } catch (error) {
      throw new ZatomFixedCellRelaxationEvidenceInputError(
        'fixed_cell_relaxation_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
  })
  const forces = result.atoms.map((atom, index) => {
    const force = vec3(atom.properties?.[FORCE_VECTOR_PROPERTY], `result.atoms[${index}].properties.${FORCE_VECTOR_PROPERTY}`)
    const magnitude = norm(force)
    const reportedMagnitude = finite(
      atom.properties?.[FORCE_MAGNITUDE_PROPERTY],
      `result.atoms[${index}].properties.${FORCE_MAGNITUDE_PROPERTY}`,
      0,
    )
    if (Math.abs(magnitude - reportedMagnitude) > 1e-10 * Math.max(1, magnitude, reportedMagnitude)) {
      throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_force_property_mismatch', `Atom ${atom.id} force magnitude property is inconsistent`)
    }
    return { force, magnitude }
  })
  const maximumForceIndex = forces.reduce((best, row, index) => row.magnitude > forces[best].magnitude ? index : best, 0)
  const maximumDisplacementIndex = displacementRows.reduce((best, row, index) => row.distance > displacementRows[best].distance ? index : best, 0)
  const maximumForceEvPerA = forces[maximumForceIndex].magnitude
  const rmsForceEvPerA = Math.sqrt(forces.reduce((sum, row) => sum + row.magnitude ** 2, 0) / forces.length)
  const maximumDisplacementA = displacementRows[maximumDisplacementIndex].distance
  const rmsDisplacementA = Math.sqrt(displacementRows.reduce((sum, row) => sum + row.distance ** 2, 0) / displacementRows.length)
  const maximumForceComponentRestrictedEvPerA = Math.max(...forces.flatMap(({ force }) => axes.map((axis) => Math.abs(dot(force, axis)))))
  if (Math.abs(maximumForceComponentRestrictedEvPerA - observations.final.reportedMaxForceComponentRestrictedEvPerA)
    > 1e-8 * Math.max(1, maximumForceComponentRestrictedEvPerA, observations.final.reportedMaxForceComponentRestrictedEvPerA)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'fixed_cell_relaxation_force_readback_mismatch',
      'Final LAMMPS fmax does not match the recomputed restricted-frame maximum force component',
    )
  }
  const fixedSet = new Set(fixedAtomIds)
  const maximumFixedAtomDisplacementA = displacementRows.reduce((maximum, row, index) => (
    fixedSet.has(source.atoms[index].id) ? Math.max(maximum, row.distance) : maximum
  ), 0)
  if (source.atoms.length > maxPairScanAtoms) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'fixed_cell_relaxation_pair_scan_unresolved',
      `Result has ${source.atoms.length} atoms above maxPairScanAtoms ${maxPairScanAtoms}`,
    )
  }
  let minimumPairDistanceA = Infinity
  let closestPair: [string, string] = [result.atoms[0].id, result.atoms[1].id]
  let pairCount = 0
  for (let first = 0; first < result.atoms.length; first++) {
    for (let second = first + 1; second < result.atoms.length; second++) {
      pairCount += 1
      let row
      try {
        row = certifiedMinimumImageVector(
          subtract(result.atoms[second].position, result.atoms[first].position),
          result.lattice!,
          maxCandidates - candidateEvaluations,
        )
      } catch (error) {
        throw new ZatomFixedCellRelaxationEvidenceInputError(
          'fixed_cell_relaxation_minimum_image_unresolved',
          error instanceof Error ? error.message : String(error),
        )
      }
      candidateEvaluations += row.candidateEvaluations
      if (candidateEvaluations > maxCandidates) {
        throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_budget_exceeded', 'Minimum-image candidate budget exceeded')
      }
      if (row.distance < minimumPairDistanceA) {
        minimumPairDistanceA = row.distance
        closestPair = [result.atoms[first].id, result.atoms[second].id]
      }
    }
  }
  const potentialEnergyChangeEv = observations.final.potentialEnergyEv - observations.initial.potentialEnergyEv
  const finalStressComponents = Object.values(observations.final.stress.tensorBar)
  const finalMaximumAbsoluteStressBar = Math.max(...finalStressComponents.map(Math.abs))
  const energyGate = potentialEnergyChangeEv <= acceptance.maximumEnergyIncreaseEv + 1e-12
  const forceGate = maximumForceEvPerA <= acceptance.maximumForceEvPerA + 1e-12
  const displacementGate = maximumDisplacementA <= acceptance.maximumDisplacementA + 1e-12
  const fixedGate = maximumFixedAtomDisplacementA <= acceptance.maximumFixedAtomDisplacementA + 1e-12
  const pairGate = minimumPairDistanceA + 1e-12 >= acceptance.minimumPairDistanceA
  const acceptancePassed = energyGate && forceGate && displacementGate && fixedGate && pairGate
  const evidence: ZatomFixedCellRelaxationEvidence = {
    schemaVersion: ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: fingerprintStructure(source),
    resultStructureFingerprint: fingerprintStructure(result),
    method,
    model,
    settings,
    observations,
    acceptance,
    mapping: {
      atomCount: source.atoms.length,
      elementCounts: countElements(source),
      stableAtomIdsElementsAndOrder: true,
      bondsAndNonForceAtomPropertiesPreserved: true,
    },
    boundary: {
      sourcePeriodic: [true, true, true],
      resultPeriodic: [true, true, true],
      exactFixedLattice: true,
      sourceCellVolumeA3: sourceVolumeA3,
      resultCellVolumeA3: resultVolumeA3,
      restrictedAxesInSourceCartesian: axes,
    },
    metrics: {
      potentialEnergyChangeEv,
      potentialEnergyChangePerAtomEv: potentialEnergyChangeEv / source.atoms.length,
      maximumForceEvPerA,
      rmsForceEvPerA,
      maximumForceComponentRestrictedEvPerA,
      maximumDisplacementA,
      rmsDisplacementA,
      maximumFixedAtomDisplacementA,
      minimumPairDistanceA,
      pairCount,
      minimumImageCandidateEvaluations: candidateEvaluations,
      finalMaximumAbsoluteStressBar,
      finalHydrostaticPressureBar: observations.final.stress.pressureBar,
      acceptancePassed,
    },
    diagnostics: {
      maximumForceAtomId: result.atoms[maximumForceIndex].id,
      maximumDisplacementAtomId: result.atoms[maximumDisplacementIndex].id,
      closestPairAtomIds: closestPair,
    },
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const checks: ValidationCheck[] = [
    {
      id: 'fixed_cell_relaxation.source_result_binding',
      status: 'pass',
      message: 'Exact source/result fingerprints, stable atom mapping, topology, and non-force properties are bound',
      metrics: { sourceStructureFingerprint: evidence.sourceStructureFingerprint, resultStructureFingerprint: evidence.resultStructureFingerprint },
    },
    {
      id: 'fixed_cell_relaxation.engine_identity',
      status: 'pass',
      message: `LAMMPS ${method.engineVersion} executable bytes and adapter identity are recorded`,
      metrics: { executableSha256: provenance.executable.sha256, providerId: provenance.providerId, adapterVersion: provenance.adapterVersion },
    },
    {
      id: 'fixed_cell_relaxation.model_identity',
      status: 'pass',
      message: `Potential ${model.id} ${model.version}, exact command fingerprint, declared assets, elements, citations, and result metadata are bound`,
      metrics: { commandsFingerprint: model.commandsFingerprint, artifactCount: model.artifacts.length, elementCount: model.elements.length },
    },
    {
      id: 'fixed_cell_relaxation.fixed_cell',
      status: 'pass',
      message: 'All three periodic axes and every source lattice component are preserved exactly within canonical tolerance',
      metrics: { sourceCellVolumeA3: sourceVolumeA3, resultCellVolumeA3: resultVolumeA3 },
    },
    {
      id: 'fixed_cell_relaxation.energy',
      status: energyGate ? 'pass' : 'fail',
      message: `Potential energy changed by ${potentialEnergyChangeEv.toExponential(6)} eV against allowed increase ${acceptance.maximumEnergyIncreaseEv.toExponential(6)} eV`,
      metrics: { initialPotentialEnergyEv: observations.initial.potentialEnergyEv, finalPotentialEnergyEv: observations.final.potentialEnergyEv, potentialEnergyChangeEv },
    },
    {
      id: 'fixed_cell_relaxation.force',
      status: forceGate ? 'pass' : 'fail',
      message: `Maximum final atom-force norm is ${maximumForceEvPerA.toExponential(6)} eV/Å against ${acceptance.maximumForceEvPerA.toExponential(6)} eV/Å`,
      metrics: { maximumForceEvPerA, rmsForceEvPerA, maximumForceComponentRestrictedEvPerA },
      atomIds: [evidence.diagnostics.maximumForceAtomId],
    },
    {
      id: 'fixed_cell_relaxation.displacement',
      status: displacementGate ? 'pass' : 'fail',
      message: `Maximum certified minimum-image relaxation displacement is ${maximumDisplacementA.toExponential(6)} Å against ${acceptance.maximumDisplacementA.toExponential(6)} Å`,
      metrics: { maximumDisplacementA, rmsDisplacementA },
      atomIds: [evidence.diagnostics.maximumDisplacementAtomId],
    },
    {
      id: 'fixed_cell_relaxation.fixed_atoms',
      status: fixedAtomIds.length ? fixedGate ? 'pass' : 'fail' : 'skipped',
      message: fixedAtomIds.length
        ? `${fixedAtomIds.length} fixed atoms moved by at most ${maximumFixedAtomDisplacementA.toExponential(6)} Å`
        : 'No fixed atoms were requested',
      metrics: { fixedAtomCount: fixedAtomIds.length, maximumFixedAtomDisplacementA },
      atomIds: fixedAtomIds.slice(0, 80),
    },
    {
      id: 'fixed_cell_relaxation.minimum_distance',
      status: pairGate ? 'pass' : 'fail',
      message: `Certified closest periodic pair distance is ${minimumPairDistanceA.toPrecision(7)} Å against ${acceptance.minimumPairDistanceA.toPrecision(7)} Å`,
      metrics: { minimumPairDistanceA, pairCount, minimumImageCandidateEvaluations: candidateEvaluations },
      atomIds: closestPair,
    },
    {
      id: 'fixed_cell_relaxation.stress_readback',
      status: 'pass',
      message: 'Initial/final LAMMPS pressure tensors are finite, source-Cartesian, positive-compression, trace-consistent, and bound to the unchanged cell volume',
      metrics: { finalHydrostaticPressureBar: observations.final.stress.pressureBar, finalMaximumAbsoluteStressBar },
    },
    {
      id: 'fixed_cell_relaxation.potential_scope',
      status: 'warn',
      message: model.scopeWarning,
    },
    {
      id: 'fixed_cell_relaxation.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} This 0 K fixed-cell minimization does not establish phase stability, finite-temperature behavior, cell/stress equilibrium, kinetic accessibility, potential accuracy, or electronic-structure consistency.`,
    },
  ]
  const maxForceAtom = result.atoms[maximumForceIndex]
  const maxDisplacementAtom = result.atoms[maximumDisplacementIndex]
  const closestAtom = result.atoms.find((atom) => atom.id === closestPair[0])!
  const overview = boundsOfPositions(result.atoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'fixed-cell-relaxation-maximum-force',
      reason: `Inspect the maximum final atom-force norm ${maximumForceEvPerA.toPrecision(6)} eV/Å`,
      center: [...maxForceAtom.position],
      radius: 2.5,
      atomIds: [maxForceAtom.id],
    },
    {
      id: 'fixed-cell-relaxation-maximum-displacement',
      reason: `Inspect the maximum certified relaxation displacement ${maximumDisplacementA.toPrecision(6)} Å`,
      center: [...maxDisplacementAtom.position],
      radius: Math.max(2.5, maximumDisplacementA + 1),
      atomIds: [maxDisplacementAtom.id],
    },
    {
      id: 'fixed-cell-relaxation-closest-pair',
      reason: `Inspect the certified closest periodic pair at ${minimumPairDistanceA.toPrecision(6)} Å`,
      center: [...closestAtom.position],
      radius: Math.max(2.5, 2 * minimumPairDistanceA),
      atomIds: closestPair,
    },
    ...(overview ? [{
      id: 'fixed-cell-relaxation-overview',
      reason: 'Inspect the complete relaxed fixed-cell structure and periodic lattice',
      center: overview.center,
      radius: Math.max(2.5, overview.radius + 0.5),
      atomIds: result.atoms.slice(0, 80).map((atom) => atom.id),
      ...(result.atoms.length > 80 ? { atomIdsTruncated: true as const } : {}),
    }] : []),
  ]
  return { evidence, fingerprint: fingerprintFixedCellRelaxationEvidence(evidence), checks, inspectionTargets }
}

export function parseZatomFixedCellRelaxationEvidence(
  value: unknown,
  options: ParseZatomFixedCellRelaxationEvidenceOptions,
): ZatomFixedCellRelaxationEvidenceValidation {
  if (utf8Bytes(value) > positiveBudget(options.maxArtifactBytes, 32 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomFixedCellRelaxationEvidenceInputError('fixed_cell_relaxation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const validation = buildValidation(value, options)
  if (canonicalJsonIdentity(value) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomFixedCellRelaxationEvidenceInputError(
      'fixed_cell_relaxation_derived_mismatch',
      'Evidence differs from canonical structure-derived fingerprints, mapping, boundary, metrics, or diagnostics',
    )
  }
  return validation
}

export function composeZatomFixedCellRelaxationEvidence(
  input: ComposeZatomFixedCellRelaxationEvidenceInput,
  budgets: Omit<ParseZatomFixedCellRelaxationEvidenceOptions, 'sourceStructure' | 'resultStructure'> = {},
): ZatomFixedCellRelaxationEvidenceValidation {
  return buildValidation({
    schemaVersion: ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: '',
    resultStructureFingerprint: '',
    method: input.method,
    model: input.model,
    settings: input.settings,
    observations: input.observations,
    acceptance: input.acceptance,
    mapping: {},
    boundary: {},
    metrics: {},
    diagnostics: {},
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    resultStructure: input.resultStructure,
    ...budgets,
  })
}

export function isFixedCellRelaxationEvidenceError(error: unknown): error is ZatomFixedCellRelaxationEvidenceInputError | ZatomStructureInputError {
  return error instanceof ZatomFixedCellRelaxationEvidenceInputError || error instanceof ZatomStructureInputError
}
