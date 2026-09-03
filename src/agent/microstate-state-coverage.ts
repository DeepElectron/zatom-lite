/** Canonical evidence for how a returned microstate set covers the modeled state universe. */

import type { JsonValue, ValidationCheck } from './contracts'
import { fingerprintCanonicalJson } from './structure-math'

export const ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA = 'zatom.microstate-state-coverage/v1' as const

export type ZatomMicrostateStateCoverageKind =
  | 'complete-state-universe'
  | 'bounded-total-omitted-fraction'
  | 'unknown-total-omitted-fraction'

export interface ZatomMicrostateStateCoverage {
  schemaVersion: typeof ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA
  chemicalStateEnsembleFingerprint: string
  microstateTransitionGraphFingerprint: string
  returnedStateCount: number
  pHDomain: {
    minimum: number
    maximum: number
  }
  assessment: {
    kind: ZatomMicrostateStateCoverageKind
    /** Pointwise upper bound over the complete state universe, not a per-state display threshold. */
    totalOmittedFractionUpperBound?: number
    method: string
    assumptions: string[]
    applicability: {
      assessment: 'in-domain' | 'out-of-domain' | 'unknown'
      domain: string
      reasons: string[]
    }
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

export interface ParseZatomMicrostateStateCoverageOptions {
  chemicalStateEnsembleFingerprint: string
  microstateTransitionGraphFingerprint: string
  stateEnumerationComplete: boolean
  returnedStateCount: number
  maxMetadataBytes?: number
}

export interface ZatomMicrostateStateCoverageValidation {
  coverage: ZatomMicrostateStateCoverage
  fingerprint: string
  checks: ValidationCheck[]
}

export class ZatomMicrostateStateCoverageInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomMicrostateStateCoverageInputError'
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
    throw new ZatomMicrostateStateCoverageInputError('invalid_microstate_state_coverage', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 64,
  maximumTextLength = 4096,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomMicrostateStateCoverageInputError('invalid_microstate_state_coverage', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomMicrostateStateCoverageInputError('invalid_microstate_state_coverage', `${field} is not JSON-safe`)
}


export function fingerprintMicrostateStateCoverage(value: ZatomMicrostateStateCoverage): string {
  return fingerprintCanonicalJson(value)
}

export function parseZatomMicrostateStateCoverage(
  value: unknown,
  options: ParseZatomMicrostateStateCoverageOptions,
): ZatomMicrostateStateCoverageValidation {
  if (typeof options.stateEnumerationComplete !== 'boolean'
    || !Number.isSafeInteger(options.returnedStateCount)
    || options.returnedStateCount < 1) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage_context',
      'Coverage parsing requires an explicit enumeration-complete boolean and positive returned-state count',
    )
  }
  const maxMetadataBytes = options.maxMetadataBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage_context',
      'maxMetadataBytes must be a positive safe integer',
    )
  }
  const root = exactObject(value, 'stateCoverage', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'microstateTransitionGraphFingerprint',
    'returnedStateCount',
    'pHDomain',
    'assessment',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      `stateCoverage.schemaVersion must be ${ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA}`,
    )
  }
  const chemicalStateEnsembleFingerprint = text(
    root.chemicalStateEnsembleFingerprint,
    'stateCoverage.chemicalStateEnsembleFingerprint',
    128,
  )
  const microstateTransitionGraphFingerprint = text(
    root.microstateTransitionGraphFingerprint,
    'stateCoverage.microstateTransitionGraphFingerprint',
    128,
  )
  if (chemicalStateEnsembleFingerprint !== options.chemicalStateEnsembleFingerprint
    || microstateTransitionGraphFingerprint !== options.microstateTransitionGraphFingerprint) {
    throw new ZatomMicrostateStateCoverageInputError(
      'microstate_state_coverage_fingerprint_mismatch',
      'Coverage fingerprints do not match the exact canonical ensemble and transition graph',
    )
  }
  const returnedStateCount = integer(root.returnedStateCount, 'stateCoverage.returnedStateCount', 1, 1_000_000)
  if (returnedStateCount !== options.returnedStateCount) {
    throw new ZatomMicrostateStateCoverageInputError(
      'microstate_state_coverage_count_mismatch',
      `Coverage returnedStateCount ${returnedStateCount} differs from graph state count ${options.returnedStateCount}`,
    )
  }
  const rawPHDomain = exactObject(root.pHDomain, 'stateCoverage.pHDomain', ['minimum', 'maximum'])
  const pHDomain = {
    minimum: numberIn(rawPHDomain.minimum, 'stateCoverage.pHDomain.minimum', 0, 14),
    maximum: numberIn(rawPHDomain.maximum, 'stateCoverage.pHDomain.maximum', 0, 14),
  }
  if (pHDomain.maximum < pHDomain.minimum) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.pHDomain.maximum must be greater than or equal to minimum',
    )
  }

  const rawAssessment = exactObject(root.assessment, 'stateCoverage.assessment', [
    'kind', 'method', 'assumptions', 'applicability', 'scopeWarning',
  ], ['totalOmittedFractionUpperBound'])
  const kinds = new Set<ZatomMicrostateStateCoverageKind>([
    'complete-state-universe',
    'bounded-total-omitted-fraction',
    'unknown-total-omitted-fraction',
  ])
  if (!kinds.has(rawAssessment.kind as ZatomMicrostateStateCoverageKind)) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.assessment.kind is unsupported',
    )
  }
  const kind = rawAssessment.kind as ZatomMicrostateStateCoverageKind
  const bound = rawAssessment.totalOmittedFractionUpperBound === undefined
    ? undefined
    : numberIn(
        rawAssessment.totalOmittedFractionUpperBound,
        'stateCoverage.assessment.totalOmittedFractionUpperBound',
        0,
        1,
      )
  if (kind === 'complete-state-universe') {
    if (!options.stateEnumerationComplete || bound !== undefined) {
      throw new ZatomMicrostateStateCoverageInputError(
        'microstate_state_coverage_completeness_mismatch',
        'complete-state-universe requires complete ensemble enumeration and must not declare an omitted-fraction bound',
      )
    }
  } else {
    if (options.stateEnumerationComplete) {
      throw new ZatomMicrostateStateCoverageInputError(
        'microstate_state_coverage_completeness_mismatch',
        `${kind} conflicts with complete ensemble enumeration`,
      )
    }
    if (kind === 'bounded-total-omitted-fraction') {
      if (bound === undefined || bound >= 1) {
        throw new ZatomMicrostateStateCoverageInputError(
          'microstate_state_coverage_bound_invalid',
          'bounded-total-omitted-fraction requires a useful total bound from 0 inclusive to 1 exclusive',
        )
      }
    } else if (bound !== undefined) {
      throw new ZatomMicrostateStateCoverageInputError(
        'microstate_state_coverage_bound_invalid',
        'unknown-total-omitted-fraction must not declare a numeric total bound',
      )
    }
  }
  const rawApplicability = exactObject(
    rawAssessment.applicability,
    'stateCoverage.assessment.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  const applicabilityAssessments = new Set(['in-domain', 'out-of-domain', 'unknown'])
  if (!applicabilityAssessments.has(String(rawApplicability.assessment))) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.assessment.applicability.assessment is unsupported',
    )
  }
  const assessment: ZatomMicrostateStateCoverage['assessment'] = {
    kind,
    ...(bound === undefined ? {} : { totalOmittedFractionUpperBound: bound }),
    method: text(rawAssessment.method, 'stateCoverage.assessment.method', 4096),
    assumptions: uniqueTextList(rawAssessment.assumptions, 'stateCoverage.assessment.assumptions'),
    applicability: {
      assessment: rawApplicability.assessment as ZatomMicrostateStateCoverage['assessment']['applicability']['assessment'],
      domain: text(rawApplicability.domain, 'stateCoverage.assessment.applicability.domain', 4096),
      reasons: uniqueTextList(rawApplicability.reasons, 'stateCoverage.assessment.applicability.reasons'),
    },
    scopeWarning: text(rawAssessment.scopeWarning, 'stateCoverage.assessment.scopeWarning', 8192),
  }

  const rawProvenance = exactObject(root.provenance, 'stateCoverage.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.artifacts) || rawProvenance.artifacts.length > 64) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.provenance.artifacts must contain 0-64 entries',
    )
  }
  const artifacts = rawProvenance.artifacts.map((raw, index) => {
    const field = `stateCoverage.provenance.artifacts[${index}]`
    const record = exactObject(raw, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`, 1024),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.provenance.artifacts IDs must be unique',
    )
  }
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicrostateStateCoverageInputError(
      'invalid_microstate_state_coverage',
      'stateCoverage.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomMicrostateStateCoverage['provenance'] = {
    engine: text(rawProvenance.engine, 'stateCoverage.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'stateCoverage.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'stateCoverage.provenance.method', 4096),
    artifacts,
    parameters: jsonValue(rawProvenance.parameters, 'stateCoverage.provenance.parameters') as Record<string, JsonValue>,
    citations: uniqueTextList(rawProvenance.citations, 'stateCoverage.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'stateCoverage.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomMicrostateStateCoverageInputError(
        'invalid_microstate_state_coverage',
        'stateCoverage.metadata must be an object',
      )
    }
    metadata = jsonValue(root.metadata, 'stateCoverage.metadata') as Record<string, JsonValue>
  }
  if (new TextEncoder().encode(JSON.stringify({ assessment, provenance, metadata })).length > maxMetadataBytes) {
    throw new ZatomMicrostateStateCoverageInputError(
      'microstate_state_coverage_budget_exceeded',
      `Coverage assessment/provenance/metadata exceeds ${maxMetadataBytes} bytes`,
    )
  }

  const coverage: ZatomMicrostateStateCoverage = {
    schemaVersion: ZATOM_MICROSTATE_STATE_COVERAGE_SCHEMA,
    chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint,
    returnedStateCount,
    pHDomain,
    assessment,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintMicrostateStateCoverage(coverage)
  const applicability = assessment.applicability.assessment
  const checks: ValidationCheck[] = [
    {
      id: 'microstate_state_coverage.identity',
      status: 'pass',
      message: `Coverage artifact ${fingerprint} binds exact ensemble ${chemicalStateEnsembleFingerprint} and graph ${microstateTransitionGraphFingerprint}`,
      metrics: { fingerprint, returnedStateCount },
    },
    {
      id: 'microstate_state_coverage.assessment',
      status: kind === 'unknown-total-omitted-fraction' ? 'warn' : 'pass',
      message: kind === 'complete-state-universe'
        ? `All ${returnedStateCount} states belong to a producer-declared complete state universe`
        : kind === 'bounded-total-omitted-fraction'
          ? `Total omitted population is bounded by ${bound} at every pH from ${pHDomain.minimum} through ${pHDomain.maximum}`
          : `The returned ${returnedStateCount}-state universe is censored and its total omitted population is unknown`,
      metrics: {
        kind,
        pHMinimum: pHDomain.minimum,
        pHMaximum: pHDomain.maximum,
        ...(bound === undefined ? {} : { totalOmittedFractionUpperBound: bound }),
      },
    },
    {
      id: 'microstate_state_coverage.applicability',
      status: applicability === 'in-domain' ? 'pass' : applicability === 'out-of-domain' ? 'fail' : 'warn',
      message: `Coverage evidence applicability is ${applicability}: ${assessment.applicability.reasons.join('; ')}`,
      metrics: { assessment: applicability },
    },
    {
      id: 'microstate_state_coverage.provenance',
      status: 'pass',
      message: `Coverage records ${provenance.engine} ${provenance.engineVersion}, method, artifacts, parameters, citations, and scope`,
      metrics: { artifactCount: provenance.artifacts.length, citationCount: provenance.citations.length },
    },
  ]
  return { coverage, fingerprint, checks }
}
