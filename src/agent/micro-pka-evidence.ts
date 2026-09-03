/** Canonical, structure-bound microscopic pKa site evidence. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import { boundsOfPositions, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_MICRO_PKA_EVIDENCE_SCHEMA = 'zatom.micro-pka-evidence/v1' as const

export type ZatomMicroPkaReferenceTransformation = 'deprotonate-reference' | 'protonate-reference'

export interface ZatomMicroPkaPredictionUncertainty {
  kind: 'standard-deviation' | 'standard-error' | 'confidence-interval' | 'prediction-interval' | 'other'
  unit: 'pKa'
  method: string
  value?: number
  lower?: number
  upper?: number
  confidenceLevel?: number
}

export interface ZatomMicroPkaPrediction {
  id: string
  pKa: number
  referenceTransformation: ZatomMicroPkaReferenceTransformation
  reactionAtomId: string
  /** Zero-based index in the exact bound structure; retained to audit engine index mappings. */
  referenceAtomIndex: number
  conjugate: {
    canonicalIsomericSmiles: string
    formula: string
    formalCharge: number
  }
  uncertainty?: ZatomMicroPkaPredictionUncertainty
  annotations?: Record<string, JsonValue>
}

export interface ZatomMicroPkaCalibrationMetric {
  dataset: string
  metric: 'rmse' | 'mae' | 'r2' | 'other'
  value: number
  unit: 'pKa' | 'dimensionless'
  citation: string
}

export interface ZatomMicroPkaEvidence {
  schemaVersion: typeof ZATOM_MICRO_PKA_EVIDENCE_SCHEMA
  structureFingerprint: string
  reference: {
    canonicalIsomericSmiles: string
    formula: string
    formalCharge: number
    atomCount: number
    bondCount: number
    heavyAtomCount: number
    explicitHydrogenCount: number
  }
  siteEnumeration: {
    complete: boolean
    status: string
  }
  predictionContext: {
    medium: string
    temperatureK?: number
    ionicStrengthMolar?: number
    standardState?: string
  }
  predictions: ZatomMicroPkaPrediction[]
  model: {
    name: string
    version: string
    assets: Array<{
      id: string
      role: string
      bytes: number
      sha256: string
    }>
    calibration: {
      metrics: ZatomMicroPkaCalibrationMetric[]
      statement: string
    }
    applicability: {
      assessment: 'in-domain' | 'out-of-domain' | 'unknown'
      domain: string
      reasons: string[]
    }
  }
  provenance: {
    engine: string
    engineVersion: string
    method: string
    parameters: Record<string, JsonValue>
    citations: string[]
    scopeWarning: string
  }
  metadata?: Record<string, JsonValue>
}

export interface ZatomMicroPkaEvidenceValidation {
  evidence: ZatomMicroPkaEvidence
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export interface ParseZatomMicroPkaEvidenceOptions {
  structure: ZatomStructure
  maxPredictions?: number
  maxAssets?: number
  maxMetadataBytes?: number
}

export class ZatomMicroPkaEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomMicroPkaEvidenceInputError'
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
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} is not JSON-safe`)
}

function uniqueTextList(value: unknown, field: string, minimum = 1, maximum = 32): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} must contain ${minimum}-${maximum} text entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, 2048))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} must not repeat entries`)
  }
  return result.sort(compareText)
}

function validSha256(value: unknown, field: string): string {
  const result = text(value, field, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} must be a lowercase SHA-256 digest`)
  }
  return result
}


export function fingerprintMicroPkaEvidence(value: ZatomMicroPkaEvidence): string {
  return fingerprintCanonicalJson(value)
}

function elementCounts(structure: ZatomStructure): Map<string, number> {
  const result = new Map<string, number>()
  for (const atom of structure.atoms) result.set(atom.element, (result.get(atom.element) ?? 0) + 1)
  return result
}

function hillFormula(counts: ReadonlyMap<string, number>, formalCharge: number): string {
  const elements = [...counts.keys()].filter((element) => (counts.get(element) ?? 0) > 0).sort((left, right) => {
    if (counts.has('C')) {
      if (left === 'C') return -1
      if (right === 'C') return 1
      if (left === 'H') return -1
      if (right === 'H') return 1
    }
    return compareText(left, right)
  })
  const base = elements.map((element) => {
    const count = counts.get(element)!
    return `${element}${count === 1 ? '' : count}`
  }).join('')
  if (formalCharge === 0) return base
  const magnitude = Math.abs(formalCharge)
  return `${base}${formalCharge > 0 ? '+' : '-'}${magnitude === 1 ? '' : magnitude}`
}

function conjugateFormula(
  counts: ReadonlyMap<string, number>,
  formalCharge: number,
  transformation: ZatomMicroPkaReferenceTransformation,
): string {
  const changed = new Map(counts)
  const delta = transformation === 'deprotonate-reference' ? -1 : 1
  const hydrogenCount = (changed.get('H') ?? 0) + delta
  if (hydrogenCount < 0) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_conjugate_mismatch',
      'Cannot deprotonate a reference structure with no hydrogen atoms',
    )
  }
  if (hydrogenCount === 0) changed.delete('H')
  else changed.set('H', hydrogenCount)
  return hillFormula(changed, formalCharge + delta)
}

function parseUncertainty(value: unknown, field: string): ZatomMicroPkaPredictionUncertainty {
  const record = exactObject(
    value,
    field,
    ['kind', 'unit', 'method'],
    ['value', 'lower', 'upper', 'confidenceLevel'],
  )
  const kinds = new Set<ZatomMicroPkaPredictionUncertainty['kind']>([
    'standard-deviation',
    'standard-error',
    'confidence-interval',
    'prediction-interval',
    'other',
  ])
  if (!kinds.has(record.kind as ZatomMicroPkaPredictionUncertainty['kind']) || record.unit !== 'pKa') {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} requires a supported kind and unit pKa`,
    )
  }
  const hasValue = record.value !== undefined
  const hasLower = record.lower !== undefined
  const hasUpper = record.upper !== undefined
  if ((!hasValue && !(hasLower && hasUpper)) || hasLower !== hasUpper) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `${field} requires value and/or a complete lower/upper interval`,
    )
  }
  const parsed: ZatomMicroPkaPredictionUncertainty = {
    kind: record.kind as ZatomMicroPkaPredictionUncertainty['kind'],
    unit: 'pKa',
    method: text(record.method, `${field}.method`, 1024),
    ...(hasValue ? { value: numberIn(record.value, `${field}.value`, 0, 100) } : {}),
    ...(hasLower ? { lower: numberIn(record.lower, `${field}.lower`, -100, 100) } : {}),
    ...(hasUpper ? { upper: numberIn(record.upper, `${field}.upper`, -100, 100) } : {}),
    ...(record.confidenceLevel === undefined ? {} : {
      confidenceLevel: numberIn(record.confidenceLevel, `${field}.confidenceLevel`, 0, 1),
    }),
  }
  if (parsed.lower !== undefined && parsed.upper !== undefined && parsed.lower > parsed.upper) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field}.lower must not exceed upper`)
  }
  return parsed
}

export function parseZatomMicroPkaEvidence(
  value: unknown,
  options: ParseZatomMicroPkaEvidenceOptions,
): ZatomMicroPkaEvidenceValidation {
  const structure = parseZatomStructure(options.structure)
  if (structure.lattice) {
    throw new ZatomMicroPkaEvidenceInputError(
      'unsupported_micro_pka_structure',
      'Micro-pKa evidence v1 binds one finite molecular structure without a lattice',
    )
  }
  if (structure.bonds === undefined) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_topology_required',
      'Micro-pKa evidence validation requires an explicit bonds array',
    )
  }
  const maxPredictions = options.maxPredictions ?? 512
  const maxAssets = options.maxAssets ?? 64
  const maxMetadataBytes = options.maxMetadataBytes ?? 1024 * 1024
  if (![maxPredictions, maxAssets, maxMetadataBytes].every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence_budget',
      'Micro-pKa parser budgets must be positive safe integers',
    )
  }

  const root = exactObject(value, 'evidence', [
    'schemaVersion',
    'structureFingerprint',
    'reference',
    'siteEnumeration',
    'predictionContext',
    'predictions',
    'model',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_MICRO_PKA_EVIDENCE_SCHEMA) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      `evidence.schemaVersion must be ${ZATOM_MICRO_PKA_EVIDENCE_SCHEMA}`,
    )
  }
  const structureFingerprint = text(root.structureFingerprint, 'evidence.structureFingerprint', 128)
  if (structureFingerprint !== fingerprintStructure(structure)) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_structure_mismatch',
      'evidence.structureFingerprint does not match the exact bound structure',
    )
  }

  const rawReference = exactObject(root.reference, 'evidence.reference', [
    'canonicalIsomericSmiles',
    'formula',
    'formalCharge',
    'atomCount',
    'bondCount',
    'heavyAtomCount',
    'explicitHydrogenCount',
  ])
  const atomCount = integer(rawReference.atomCount, 'evidence.reference.atomCount', 1, 1_000_000)
  const heavyAtomCount = integer(rawReference.heavyAtomCount, 'evidence.reference.heavyAtomCount', 1, atomCount)
  const explicitHydrogenCount = integer(
    rawReference.explicitHydrogenCount,
    'evidence.reference.explicitHydrogenCount',
    0,
    atomCount,
  )
  if (heavyAtomCount + explicitHydrogenCount !== atomCount) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'evidence.reference heavyAtomCount + explicitHydrogenCount must equal atomCount',
    )
  }
  const reference: ZatomMicroPkaEvidence['reference'] = {
    canonicalIsomericSmiles: text(
      rawReference.canonicalIsomericSmiles,
      'evidence.reference.canonicalIsomericSmiles',
      10_000,
    ),
    formula: text(rawReference.formula, 'evidence.reference.formula', 256),
    formalCharge: integer(rawReference.formalCharge, 'evidence.reference.formalCharge', -10_000, 10_000),
    atomCount,
    bondCount: integer(rawReference.bondCount, 'evidence.reference.bondCount', 0, 5_000_000),
    heavyAtomCount,
    explicitHydrogenCount,
  }

  const rawEnumeration = exactObject(root.siteEnumeration, 'evidence.siteEnumeration', ['complete', 'status'])
  if (typeof rawEnumeration.complete !== 'boolean') {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'evidence.siteEnumeration.complete must be boolean',
    )
  }
  const siteEnumeration: ZatomMicroPkaEvidence['siteEnumeration'] = {
    complete: rawEnumeration.complete,
    status: text(rawEnumeration.status, 'evidence.siteEnumeration.status', 512),
  }

  const rawContext = exactObject(
    root.predictionContext,
    'evidence.predictionContext',
    ['medium'],
    ['temperatureK', 'ionicStrengthMolar', 'standardState'],
  )
  const predictionContext: ZatomMicroPkaEvidence['predictionContext'] = {
    medium: text(rawContext.medium, 'evidence.predictionContext.medium', 512),
    ...(rawContext.temperatureK === undefined ? {} : {
      temperatureK: numberIn(rawContext.temperatureK, 'evidence.predictionContext.temperatureK', 0.01, 1_000_000),
    }),
    ...(rawContext.ionicStrengthMolar === undefined ? {} : {
      ionicStrengthMolar: numberIn(
        rawContext.ionicStrengthMolar,
        'evidence.predictionContext.ionicStrengthMolar',
        0,
        100,
      ),
    }),
    ...(rawContext.standardState === undefined ? {} : {
      standardState: text(rawContext.standardState, 'evidence.predictionContext.standardState', 512),
    }),
  }

  if (!Array.isArray(root.predictions) || root.predictions.length > maxPredictions) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_evidence_budget_exceeded',
      `evidence.predictions must contain 0-${maxPredictions} entries`,
    )
  }
  const atomIdSet = new Set(structure.atoms.map((atom) => atom.id))
  const counts = elementCounts(structure)
  const predictions = root.predictions.map((raw, index): ZatomMicroPkaPrediction => {
    const field = `evidence.predictions[${index}]`
    const record = exactObject(raw, field, [
      'id',
      'pKa',
      'referenceTransformation',
      'reactionAtomId',
      'referenceAtomIndex',
      'conjugate',
    ], ['uncertainty', 'annotations'])
    const transformations = new Set<ZatomMicroPkaReferenceTransformation>([
      'deprotonate-reference',
      'protonate-reference',
    ])
    if (!transformations.has(record.referenceTransformation as ZatomMicroPkaReferenceTransformation)) {
      throw new ZatomMicroPkaEvidenceInputError(
        'invalid_micro_pka_evidence',
        `${field}.referenceTransformation is unsupported`,
      )
    }
    const referenceTransformation = record.referenceTransformation as ZatomMicroPkaReferenceTransformation
    const reactionAtomId = token(record.reactionAtomId, `${field}.reactionAtomId`)
    const referenceAtomIndex = integer(record.referenceAtomIndex, `${field}.referenceAtomIndex`, 0, atomCount - 1)
    if (!atomIdSet.has(reactionAtomId) || structure.atoms[referenceAtomIndex]?.id !== reactionAtomId) {
      throw new ZatomMicroPkaEvidenceInputError(
        'micro_pka_site_mapping_mismatch',
        `${field} reaction atom ID/index do not identify the same bound-structure atom`,
      )
    }
    if (structure.atoms[referenceAtomIndex].element === 'H') {
      throw new ZatomMicroPkaEvidenceInputError(
        'micro_pka_site_mapping_mismatch',
        `${field} reaction site must identify a heavy atom`,
      )
    }
    if (referenceTransformation === 'deprotonate-reference') {
      const hasHydrogenNeighbor = structure.bonds!.some((bond) => (
        bond.atomIds.includes(reactionAtomId)
        && bond.atomIds.some((atomId) => atomId !== reactionAtomId && structure.atoms.find((atom) => atom.id === atomId)?.element === 'H')
      ))
      if (!hasHydrogenNeighbor) {
        throw new ZatomMicroPkaEvidenceInputError(
          'micro_pka_site_mapping_mismatch',
          `${field} deprotonation site has no explicit hydrogen neighbor`,
        )
      }
    }
    const rawConjugate = exactObject(
      record.conjugate,
      `${field}.conjugate`,
      ['canonicalIsomericSmiles', 'formula', 'formalCharge'],
    )
    const expectedCharge = reference.formalCharge + (referenceTransformation === 'deprotonate-reference' ? -1 : 1)
    const expectedFormula = conjugateFormula(counts, reference.formalCharge, referenceTransformation)
    const conjugate = {
      canonicalIsomericSmiles: text(
        rawConjugate.canonicalIsomericSmiles,
        `${field}.conjugate.canonicalIsomericSmiles`,
        10_000,
      ),
      formula: text(rawConjugate.formula, `${field}.conjugate.formula`, 256),
      formalCharge: integer(rawConjugate.formalCharge, `${field}.conjugate.formalCharge`, -10_000, 10_000),
    }
    if (conjugate.formalCharge !== expectedCharge || conjugate.formula !== expectedFormula) {
      throw new ZatomMicroPkaEvidenceInputError(
        'micro_pka_conjugate_mismatch',
        `${field} conjugate must have exactly ${referenceTransformation === 'deprotonate-reference'
          ? 'one fewer H and a formal charge lower by one'
          : 'one more H and a formal charge higher by one'} than the reference`,
      )
    }
    let annotations: Record<string, JsonValue> | undefined
    if (record.annotations !== undefined) {
      if (!isRecord(record.annotations)) {
        throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field}.annotations must be an object`)
      }
      annotations = jsonValue(record.annotations, `${field}.annotations`) as Record<string, JsonValue>
    }
    return {
      id: token(record.id, `${field}.id`),
      pKa: numberIn(record.pKa, `${field}.pKa`, -100, 100),
      referenceTransformation,
      reactionAtomId,
      referenceAtomIndex,
      conjugate,
      ...(record.uncertainty === undefined ? {} : { uncertainty: parseUncertainty(record.uncertainty, `${field}.uncertainty`) }),
      ...(annotations ? { annotations } : {}),
    }
  }).sort((left, right) => (
    compareText(left.referenceTransformation, right.referenceTransformation)
    || compareText(left.reactionAtomId, right.reactionAtomId)
    || left.pKa - right.pKa
    || compareText(left.id, right.id)
  ))
  if (new Set(predictions.map((prediction) => prediction.id)).size !== predictions.length) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', 'Prediction IDs must be unique')
  }
  const siteKeys = predictions.map((prediction) => `${prediction.referenceTransformation}\0${prediction.reactionAtomId}`)
  if (new Set(siteKeys).size !== siteKeys.length) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'Each reference transformation/reaction atom pair may appear at most once',
    )
  }

  const rawModel = exactObject(root.model, 'evidence.model', [
    'name', 'version', 'assets', 'calibration', 'applicability',
  ])
  if (!Array.isArray(rawModel.assets) || !rawModel.assets.length || rawModel.assets.length > maxAssets) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_evidence_budget_exceeded',
      `evidence.model.assets must contain 1-${maxAssets} entries`,
    )
  }
  const assets = rawModel.assets.map((raw, index) => {
    const field = `evidence.model.assets[${index}]`
    const record = exactObject(raw, field, ['id', 'role', 'bytes', 'sha256'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`, 256),
      bytes: integer(record.bytes, `${field}.bytes`, 1, 2_147_483_647),
      sha256: validSha256(record.sha256, `${field}.sha256`),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', 'Model asset IDs must be unique')
  }

  const rawCalibration = exactObject(rawModel.calibration, 'evidence.model.calibration', ['metrics', 'statement'])
  if (!Array.isArray(rawCalibration.metrics) || !rawCalibration.metrics.length || rawCalibration.metrics.length > 64) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'evidence.model.calibration.metrics must contain 1-64 benchmark metrics',
    )
  }
  const metrics = rawCalibration.metrics.map((raw, index): ZatomMicroPkaCalibrationMetric => {
    const field = `evidence.model.calibration.metrics[${index}]`
    const record = exactObject(raw, field, ['dataset', 'metric', 'value', 'unit', 'citation'])
    const metricKinds = new Set<ZatomMicroPkaCalibrationMetric['metric']>(['rmse', 'mae', 'r2', 'other'])
    if (!metricKinds.has(record.metric as ZatomMicroPkaCalibrationMetric['metric'])) {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field}.metric is unsupported`)
    }
    if (record.unit !== 'pKa' && record.unit !== 'dimensionless') {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field}.unit is unsupported`)
    }
    if (record.metric === 'r2' && record.unit !== 'dimensionless') {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} r2 must be dimensionless`)
    }
    if ((record.metric === 'rmse' || record.metric === 'mae') && record.unit !== 'pKa') {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', `${field} error metric must use pKa units`)
    }
    const metricValue = numberIn(
      record.value,
      `${field}.value`,
      record.metric === 'rmse' || record.metric === 'mae' ? 0 : -1_000_000,
      record.metric === 'r2' ? 1 : 1_000_000,
    )
    return {
      dataset: text(record.dataset, `${field}.dataset`, 512),
      metric: record.metric as ZatomMicroPkaCalibrationMetric['metric'],
      value: metricValue,
      unit: record.unit as ZatomMicroPkaCalibrationMetric['unit'],
      citation: text(record.citation, `${field}.citation`, 2048),
    }
  }).sort((left, right) => (
    compareText(left.dataset, right.dataset)
    || compareText(left.metric, right.metric)
    || left.value - right.value
    || compareText(left.citation, right.citation)
  ))
  const metricKeys = metrics.map((metric) => `${metric.dataset}\0${metric.metric}\0${metric.citation}`)
  if (new Set(metricKeys).size !== metricKeys.length) {
    throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', 'Calibration metrics must not repeat')
  }

  const rawApplicability = exactObject(
    rawModel.applicability,
    'evidence.model.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  const assessments = new Set(['in-domain', 'out-of-domain', 'unknown'])
  if (!assessments.has(String(rawApplicability.assessment))) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'evidence.model.applicability.assessment is unsupported',
    )
  }
  const model: ZatomMicroPkaEvidence['model'] = {
    name: text(rawModel.name, 'evidence.model.name', 256),
    version: text(rawModel.version, 'evidence.model.version', 256),
    assets,
    calibration: {
      metrics,
      statement: text(rawCalibration.statement, 'evidence.model.calibration.statement', 4096),
    },
    applicability: {
      assessment: rawApplicability.assessment as ZatomMicroPkaEvidence['model']['applicability']['assessment'],
      domain: text(rawApplicability.domain, 'evidence.model.applicability.domain', 4096),
      reasons: uniqueTextList(rawApplicability.reasons, 'evidence.model.applicability.reasons'),
    },
  }

  const rawProvenance = exactObject(root.provenance, 'evidence.provenance', [
    'engine', 'engineVersion', 'method', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicroPkaEvidenceInputError(
      'invalid_micro_pka_evidence',
      'evidence.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomMicroPkaEvidence['provenance'] = {
    engine: text(rawProvenance.engine, 'evidence.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'evidence.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'evidence.provenance.method', 2048),
    parameters: jsonValue(rawProvenance.parameters, 'evidence.provenance.parameters') as Record<string, JsonValue>,
    citations: uniqueTextList(rawProvenance.citations, 'evidence.provenance.citations'),
    scopeWarning: text(rawProvenance.scopeWarning, 'evidence.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomMicroPkaEvidenceInputError('invalid_micro_pka_evidence', 'evidence.metadata must be an object')
    }
    metadata = jsonValue(root.metadata, 'evidence.metadata') as Record<string, JsonValue>
  }
  const boundedJson = {
    predictionAnnotations: predictions.map((prediction) => prediction.annotations),
    provenanceParameters: provenance.parameters,
    metadata,
  }
  if (new TextEncoder().encode(JSON.stringify(boundedJson)).length > maxMetadataBytes) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_evidence_budget_exceeded',
      `Micro-pKa metadata and annotations exceed ${maxMetadataBytes} bytes`,
    )
  }

  const formalCharges = structure.atoms.map((atom) => atom.properties?.formalCharge)
  if (!formalCharges.every((charge) => typeof charge === 'number' && Number.isSafeInteger(charge))) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_structure_charge_incomplete',
      'Bound structure must carry a complete integer formalCharge on every atom',
    )
  }
  const observedCharge = formalCharges.reduce<number>((sum, charge) => sum + Number(charge), 0)
  const observedHydrogenCount = structure.atoms.filter((atom) => atom.element === 'H').length
  const observedHeavyAtomCount = structure.atoms.length - observedHydrogenCount
  const observedFormula = hillFormula(counts, observedCharge)
  if (
    reference.atomCount !== structure.atoms.length
    || reference.bondCount !== structure.bonds.length
    || reference.heavyAtomCount !== observedHeavyAtomCount
    || reference.explicitHydrogenCount !== observedHydrogenCount
    || reference.formalCharge !== observedCharge
    || reference.formula !== observedFormula
  ) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_reference_structure_mismatch',
      'Reference formula, charge, or atom/bond/heavy/hydrogen counts differ from the bound structure',
    )
  }
  const expectedMetadata: Array<[string, unknown]> = [
    ['zatom.microPka.referenceCanonicalIsomericSmiles', reference.canonicalIsomericSmiles],
    ['zatom.microPka.referenceFormula', reference.formula],
    ['zatom.microPka.referenceFormalCharge', reference.formalCharge],
  ]
  const metadataMismatches = expectedMetadata.filter(([key, expected]) => structure.metadata?.[key] !== expected)
  if (metadataMismatches.length) {
    throw new ZatomMicroPkaEvidenceInputError(
      'micro_pka_reference_structure_mismatch',
      `Bound structure metadata differs for ${metadataMismatches.map(([key]) => key).join(', ')}`,
    )
  }

  const evidence: ZatomMicroPkaEvidence = {
    schemaVersion: ZATOM_MICRO_PKA_EVIDENCE_SCHEMA,
    structureFingerprint,
    reference,
    siteEnumeration,
    predictionContext,
    predictions,
    model,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintMicroPkaEvidence(evidence)
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const reactionAtoms = predictions.map((prediction) => structure.atoms[prediction.referenceAtomIndex])
  const reactionBounds = boundsOfPositions(reactionAtoms.map((atom) => atom.position))
  const uncertaintyCount = predictions.filter((prediction) => prediction.uncertainty !== undefined).length
  const checks: ValidationCheck[] = [
    {
      id: 'micro_pka_evidence.identity',
      status: 'pass',
      message: `Evidence ${fingerprint} is bound to the exact reference structure`,
      metrics: { fingerprint, predictionCount: predictions.length },
    },
    {
      id: 'micro_pka_evidence.reference_structure',
      status: 'pass',
      message: 'Reference fingerprint, chemical metadata, explicit topology counts, formula, and formal charge match',
      metrics: {
        atomCount: reference.atomCount,
        bondCount: reference.bondCount,
        heavyAtomCount: reference.heavyAtomCount,
        explicitHydrogenCount: reference.explicitHydrogenCount,
        formalCharge: reference.formalCharge,
        formula: reference.formula,
      },
    },
    {
      id: 'micro_pka_evidence.site_mapping',
      status: 'pass',
      message: 'Every prediction maps one unique transformation/heavy-atom pair by matching stable atom ID and exact structure index',
      metrics: { predictionCount: predictions.length, uniqueReactionAtomCount: new Set(predictions.map((item) => item.reactionAtomId)).size },
      atomIds: [...new Set(predictions.map((prediction) => prediction.reactionAtomId))],
    },
    {
      id: 'micro_pka_evidence.conjugate_stoichiometry',
      status: 'pass',
      message: 'Every declared conjugate differs from the reference by exactly one proton and one unit of formal charge in the declared direction',
      metrics: { predictionCount: predictions.length },
    },
    {
      id: 'micro_pka_evidence.site_enumeration',
      status: siteEnumeration.complete ? 'pass' : 'warn',
      message: siteEnumeration.complete
        ? `The producer completed its bounded site-prediction procedure with ${predictions.length} result(s)`
        : `The producer stopped with status ${siteEnumeration.status}; additional model-predicted sites may be absent`,
      metrics: { complete: siteEnumeration.complete, status: siteEnumeration.status, predictionCount: predictions.length },
    },
    {
      id: 'micro_pka_evidence.calibration',
      status: 'pass',
      message: `Model identity includes ${assets.length} hashed asset(s) and ${metrics.length} explicitly scoped benchmark metric(s)`,
      metrics: { assetCount: assets.length, calibrationMetricCount: metrics.length },
    },
    {
      id: 'micro_pka_evidence.prediction_uncertainty',
      status: predictions.length === 0 || uncertaintyCount === predictions.length ? 'pass' : 'warn',
      message: predictions.length === 0
        ? 'No site predictions were returned, so no per-prediction uncertainty is applicable'
        : uncertaintyCount === predictions.length
          ? 'Every site prediction carries an explicit per-prediction uncertainty model'
          : `${uncertaintyCount}/${predictions.length} site predictions carry per-prediction uncertainty; benchmark error is not substituted for missing uncertainty`,
      metrics: { predictionCount: predictions.length, predictionUncertaintyCount: uncertaintyCount },
    },
    {
      id: 'micro_pka_evidence.applicability',
      status: model.applicability.assessment === 'in-domain' ? 'pass' : 'warn',
      message: `Producer applicability assessment is ${model.applicability.assessment}: ${model.applicability.reasons.join('; ')}`,
      metrics: { assessment: model.applicability.assessment },
    },
    {
      id: 'micro_pka_evidence.population_scope',
      status: 'skipped',
      message: 'Site-labelled microscopic pKa predictions do not by themselves define a complete microstate transition graph, macroscopic pKa values, or normalized pH populations',
    },
    {
      id: 'micro_pka_evidence.provenance',
      status: 'pass',
      message: `Evidence records ${provenance.engine} ${provenance.engineVersion}, method, parameters, citations, and scope warning`,
      metrics: { citationCount: provenance.citations.length },
    },
  ]
  const inspectionTargets: InspectionTarget[] = [
    ...(bounds ? [{
      id: 'micro-pka-reference-structure',
      reason: 'Inspect the exact molecular reference to which all microscopic pKa site evidence is bound',
      center: bounds.center,
      radius: Math.max(1, bounds.radius),
      atomIds: structure.atoms.slice(0, 512).map((atom) => atom.id),
      ...(structure.atoms.length > 512 ? { atomIdsTruncated: true as const } : {}),
    }] : []),
    ...(reactionBounds ? [{
      id: 'micro-pka-reaction-sites',
      reason: 'Inspect all heavy atoms carrying site-labelled microscopic pKa predictions',
      center: reactionBounds.center,
      radius: Math.max(1, reactionBounds.radius + 1),
      atomIds: [...new Set(predictions.map((prediction) => prediction.reactionAtomId))].slice(0, 512),
      ...(new Set(predictions.map((prediction) => prediction.reactionAtomId)).size > 512
        ? { atomIdsTruncated: true as const }
        : {}),
    }] : []),
  ]
  return { evidence, fingerprint, checks, inspectionTargets }
}
