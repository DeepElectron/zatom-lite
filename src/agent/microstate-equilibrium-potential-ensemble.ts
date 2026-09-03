/** Canonical joint samples of gauge-fixed microstate equilibrium potentials. */

import type { JsonValue, ValidationCheck } from './contracts'
import { canonicalJsonIdentity, fingerprintCanonicalJson } from './structure-math'

export const ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA =
  'zatom.microstate-equilibrium-potential-ensemble/v1' as const

export type ZatomMicrostatePotentialEnsembleKind =
  | 'posterior-samples'
  | 'bootstrap-replicates'
  | 'model-ensemble'
  | 'other'

export interface ZatomMicrostateEquilibriumPotentialSample {
  id: string
  weight: number
  /** Gauge-fixed intrinsic state log10 weights at pH 0 in canonical graph-state order. */
  log10WeightsRelativeToReference: number[]
}

export interface ZatomMicrostateEquilibriumPotentialEnsemble {
  schemaVersion: typeof ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA
  chemicalStateEnsembleFingerprint: string
  microstateTransitionGraphFingerprint: string
  referenceStateId: string
  stateIds: string[]
  pHDomain: {
    minimum: number
    maximum: number
  }
  samples: ZatomMicrostateEquilibriumPotentialSample[]
  acceptance: {
    /** Kish weight ESS gate only; this does not diagnose serial sample dependence. */
    minimumWeightEffectiveSampleSize: number
  }
  uncertaintyModel: {
    kind: ZatomMicrostatePotentialEnsembleKind
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

export interface ParseZatomMicrostateEquilibriumPotentialEnsembleOptions {
  chemicalStateEnsembleFingerprint: string
  microstateTransitionGraphFingerprint: string
  canonicalStateIds: string[]
  referenceStateId: string
  maxSamples?: number
  maxStateSamples?: number
  maxMetadataBytes?: number
}

export interface ZatomMicrostateEquilibriumPotentialEnsembleValidation {
  ensemble: ZatomMicrostateEquilibriumPotentialEnsemble
  fingerprint: string
  /** Kish weight ESS, 1/sum(w²); not an autocorrelation-adjusted statistical ESS. */
  weightEffectiveSampleSize: number
  checks: ValidationCheck[]
}

export interface ZatomMicrostatePotentialMixtureComposition {
  components: Array<{
    id: string
    weight: number
    potentialEnsemble: ZatomMicrostateEquilibriumPotentialEnsemble
  }>
  acceptance: {
    minimumComponentWeightEffectiveCount: number
    minimumWeightEffectiveSampleSize: number
  }
  uncertaintyModel: Omit<ZatomMicrostateEquilibriumPotentialEnsemble['uncertaintyModel'], 'kind'>
  provenance: Omit<ZatomMicrostateEquilibriumPotentialEnsemble['provenance'], 'artifacts'> & {
    calibrationArtifacts: ZatomMicrostateEquilibriumPotentialEnsemble['provenance']['artifacts']
  }
  metadata?: Record<string, JsonValue>
}

export interface ComposeZatomMicrostatePotentialMixtureOptions
  extends ParseZatomMicrostateEquilibriumPotentialEnsembleOptions {
  maxComponents?: number
}

export interface ZatomMicrostatePotentialMixtureValidation {
  potentialEnsembleValidation: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  componentValidations: Array<{
    id: string
    validation: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  }>
  componentWeightEffectiveCount: number
  components: Array<{
    id: string
    weight: number
    fingerprint: string
    kind: ZatomMicrostatePotentialEnsembleKind
    sampleCount: number
    weightEffectiveSampleSize: number
  }>
  stateVarianceDecomposition: Array<{
    stateId: string
    meanLog10WeightRelativeToReference: number
    withinComponentVariance: number
    betweenComponentVariance: number
    totalVariance: number
    betweenComponentVarianceFraction: number
  }>
  checks: ValidationCheck[]
}

export class ZatomMicrostateEquilibriumPotentialEnsembleInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomMicrostateEquilibriumPotentialEnsembleInputError'
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
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
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
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
        'invalid_microstate_equilibrium_potential_ensemble',
        `${field} must be finite`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
    'invalid_microstate_equilibrium_potential_ensemble',
    `${field} is not JSON-safe`,
  )
}


export function fingerprintMicrostateEquilibriumPotentialEnsemble(
  value: ZatomMicrostateEquilibriumPotentialEnsemble,
): string {
  return fingerprintCanonicalJson(value)
}

export function microstatePotentialEnsembleWeightEffectiveSampleSize(
  samples: readonly ZatomMicrostateEquilibriumPotentialSample[],
): number {
  const sumSquaredWeights = samples.reduce((sum, sample) => sum + sample.weight ** 2, 0)
  return 1 / sumSquaredWeights
}

export function parseZatomMicrostateEquilibriumPotentialEnsemble(
  value: unknown,
  options: ParseZatomMicrostateEquilibriumPotentialEnsembleOptions,
): ZatomMicrostateEquilibriumPotentialEnsembleValidation {
  const maxSamples = options.maxSamples ?? 4_096
  const maxStateSamples = options.maxStateSamples ?? 2_097_152
  const maxMetadataBytes = options.maxMetadataBytes ?? 2 * 1024 * 1024
  if (![maxSamples, maxStateSamples, maxMetadataBytes].every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble_context',
      'Potential-ensemble parser budgets must be positive safe integers',
    )
  }
  if (!Array.isArray(options.canonicalStateIds) || options.canonicalStateIds.length < 2
    || new Set(options.canonicalStateIds).size !== options.canonicalStateIds.length
    || !options.canonicalStateIds.includes(options.referenceStateId)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble_context',
      'Potential-ensemble parsing requires unique canonical state IDs and a present reference state',
    )
  }

  const root = exactObject(value, 'potentialEnsemble', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'microstateTransitionGraphFingerprint',
    'referenceStateId',
    'stateIds',
    'pHDomain',
    'samples',
    'acceptance',
    'uncertaintyModel',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      `potentialEnsemble.schemaVersion must be ${ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA}`,
    )
  }
  const chemicalStateEnsembleFingerprint = text(
    root.chemicalStateEnsembleFingerprint,
    'potentialEnsemble.chemicalStateEnsembleFingerprint',
    128,
  )
  const microstateTransitionGraphFingerprint = text(
    root.microstateTransitionGraphFingerprint,
    'potentialEnsemble.microstateTransitionGraphFingerprint',
    128,
  )
  if (chemicalStateEnsembleFingerprint !== options.chemicalStateEnsembleFingerprint
    || microstateTransitionGraphFingerprint !== options.microstateTransitionGraphFingerprint) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_fingerprint_mismatch',
      'Potential-ensemble fingerprints do not match the exact canonical ensemble and graph',
    )
  }
  const referenceStateId = token(root.referenceStateId, 'potentialEnsemble.referenceStateId')
  if (referenceStateId !== options.referenceStateId) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_reference_mismatch',
      `Potential-ensemble reference ${referenceStateId} differs from graph reference ${options.referenceStateId}`,
    )
  }
  if (!Array.isArray(root.stateIds) || root.stateIds.length !== options.canonicalStateIds.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_state_coverage_mismatch',
      'potentialEnsemble.stateIds must cover every canonical graph state exactly once',
    )
  }
  const inputStateIds = root.stateIds.map((stateId, index) => token(stateId, `potentialEnsemble.stateIds[${index}]`))
  if (new Set(inputStateIds).size !== inputStateIds.length
    || inputStateIds.some((stateId) => !options.canonicalStateIds.includes(stateId))) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_state_coverage_mismatch',
      'potentialEnsemble.stateIds must cover every canonical graph state exactly once',
    )
  }
  const inputStateIndex = new Map(inputStateIds.map((stateId, index) => [stateId, index]))
  const referenceInputIndex = inputStateIndex.get(referenceStateId)!
  const rawPHDomain = exactObject(root.pHDomain, 'potentialEnsemble.pHDomain', ['minimum', 'maximum'])
  const pHDomain = {
    minimum: numberIn(rawPHDomain.minimum, 'potentialEnsemble.pHDomain.minimum', 0, 14),
    maximum: numberIn(rawPHDomain.maximum, 'potentialEnsemble.pHDomain.maximum', 0, 14),
  }
  if (pHDomain.maximum < pHDomain.minimum) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.pHDomain.maximum must be greater than or equal to minimum',
    )
  }

  if (!Array.isArray(root.samples) || root.samples.length < 2 || root.samples.length > maxSamples) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_budget_exceeded',
      `potentialEnsemble.samples must contain 2-${maxSamples} joint samples`,
    )
  }
  if (root.samples.length * options.canonicalStateIds.length > maxStateSamples) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_budget_exceeded',
      `Potential ensemble contains ${root.samples.length * options.canonicalStateIds.length} state-samples; limit is ${maxStateSamples}`,
    )
  }
  const rawSamples = root.samples.map((raw, index) => {
    const field = `potentialEnsemble.samples[${index}]`
    const record = exactObject(raw, field, ['id', 'weight', 'log10WeightsRelativeToReference'])
    if (!Array.isArray(record.log10WeightsRelativeToReference)
      || record.log10WeightsRelativeToReference.length !== inputStateIds.length) {
      throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
        'microstate_potential_ensemble_state_coverage_mismatch',
        `${field}.log10WeightsRelativeToReference must align with every input state ID`,
      )
    }
    const inputPotentials = record.log10WeightsRelativeToReference.map((potential, stateIndex) => numberIn(
      potential,
      `${field}.log10WeightsRelativeToReference[${stateIndex}]`,
      -1_000,
      1_000,
    ))
    if (Math.abs(inputPotentials[referenceInputIndex]) > 1e-12) {
      throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
        'microstate_potential_ensemble_gauge_mismatch',
        `${field} reference-state potential must equal zero within 1e-12`,
      )
    }
    inputPotentials[referenceInputIndex] = 0
    return {
      id: token(record.id, `${field}.id`),
      weight: numberIn(record.weight, `${field}.weight`, Number.MIN_VALUE, 1),
      log10WeightsRelativeToReference: options.canonicalStateIds.map((stateId) => (
        inputPotentials[inputStateIndex.get(stateId)!]
      )),
    }
  })
  if (new Set(rawSamples.map((sample) => sample.id)).size !== rawSamples.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'Potential sample IDs must be unique',
    )
  }
  const rawWeightSum = rawSamples.reduce((sum, sample) => sum + sample.weight, 0)
  if (!Number.isFinite(rawWeightSum) || Math.abs(rawWeightSum - 1) > 1e-8) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_weight_mismatch',
      `Potential sample weights sum to ${rawWeightSum}, not one within 1e-8`,
    )
  }
  const samples = rawSamples.map((sample) => ({ ...sample, weight: sample.weight / rawWeightSum }))
    .sort((left, right) => compareText(left.id, right.id))
  const canonicalWeightSum = samples.reduce((sum, sample) => sum + sample.weight, 0)
  const correctionIndex = samples.reduce((maximumIndex, sample, index) => (
    sample.weight > samples[maximumIndex].weight ? index : maximumIndex
  ), 0)
  samples[correctionIndex].weight += 1 - canonicalWeightSum
  const weightEffectiveSampleSize = microstatePotentialEnsembleWeightEffectiveSampleSize(samples)

  const rawAcceptance = exactObject(
    root.acceptance,
    'potentialEnsemble.acceptance',
    ['minimumWeightEffectiveSampleSize'],
  )
  const acceptance = {
    minimumWeightEffectiveSampleSize: numberIn(
      rawAcceptance.minimumWeightEffectiveSampleSize,
      'potentialEnsemble.acceptance.minimumWeightEffectiveSampleSize',
      1,
      samples.length,
    ),
  }
  if (weightEffectiveSampleSize + 1e-12 < acceptance.minimumWeightEffectiveSampleSize) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_weight_effective_size_failed',
      `Weight effective sample size ${weightEffectiveSampleSize} is below producer threshold ${acceptance.minimumWeightEffectiveSampleSize}`,
    )
  }

  const rawModel = exactObject(root.uncertaintyModel, 'potentialEnsemble.uncertaintyModel', [
    'kind', 'method', 'assumptions', 'applicability', 'scopeWarning',
  ])
  const modelKinds = new Set<ZatomMicrostatePotentialEnsembleKind>([
    'posterior-samples', 'bootstrap-replicates', 'model-ensemble', 'other',
  ])
  if (!modelKinds.has(rawModel.kind as ZatomMicrostatePotentialEnsembleKind)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.uncertaintyModel.kind is unsupported',
    )
  }
  const rawApplicability = exactObject(
    rawModel.applicability,
    'potentialEnsemble.uncertaintyModel.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  const applicabilityKinds = new Set(['in-domain', 'out-of-domain', 'unknown'])
  if (!applicabilityKinds.has(String(rawApplicability.assessment))) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.uncertaintyModel.applicability.assessment is unsupported',
    )
  }
  const uncertaintyModel: ZatomMicrostateEquilibriumPotentialEnsemble['uncertaintyModel'] = {
    kind: rawModel.kind as ZatomMicrostatePotentialEnsembleKind,
    method: text(rawModel.method, 'potentialEnsemble.uncertaintyModel.method', 4096),
    assumptions: uniqueTextList(rawModel.assumptions, 'potentialEnsemble.uncertaintyModel.assumptions'),
    applicability: {
      assessment: rawApplicability.assessment as ZatomMicrostateEquilibriumPotentialEnsemble['uncertaintyModel']['applicability']['assessment'],
      domain: text(rawApplicability.domain, 'potentialEnsemble.uncertaintyModel.applicability.domain', 4096),
      reasons: uniqueTextList(rawApplicability.reasons, 'potentialEnsemble.uncertaintyModel.applicability.reasons'),
    },
    scopeWarning: text(rawModel.scopeWarning, 'potentialEnsemble.uncertaintyModel.scopeWarning', 8192),
  }

  const rawProvenance = exactObject(root.provenance, 'potentialEnsemble.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.artifacts)
    || rawProvenance.artifacts.length < 1
    || rawProvenance.artifacts.length > 64) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.provenance.artifacts must contain 1-64 entries',
    )
  }
  const artifacts = rawProvenance.artifacts.map((raw, index) => {
    const field = `potentialEnsemble.provenance.artifacts[${index}]`
    const record = exactObject(raw, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`, 1024),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.provenance.artifacts IDs must be unique',
    )
  }
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_equilibrium_potential_ensemble',
      'potentialEnsemble.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomMicrostateEquilibriumPotentialEnsemble['provenance'] = {
    engine: text(rawProvenance.engine, 'potentialEnsemble.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'potentialEnsemble.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'potentialEnsemble.provenance.method', 4096),
    artifacts,
    parameters: jsonValue(rawProvenance.parameters, 'potentialEnsemble.provenance.parameters') as Record<string, JsonValue>,
    citations: uniqueTextList(rawProvenance.citations, 'potentialEnsemble.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'potentialEnsemble.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
        'invalid_microstate_equilibrium_potential_ensemble',
        'potentialEnsemble.metadata must be an object',
      )
    }
    metadata = jsonValue(root.metadata, 'potentialEnsemble.metadata') as Record<string, JsonValue>
  }
  if (new TextEncoder().encode(JSON.stringify({ uncertaintyModel, provenance, metadata })).length > maxMetadataBytes) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_ensemble_budget_exceeded',
      `Potential-ensemble model/provenance/metadata exceeds ${maxMetadataBytes} bytes`,
    )
  }

  const ensemble: ZatomMicrostateEquilibriumPotentialEnsemble = {
    schemaVersion: ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
    chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint,
    referenceStateId,
    stateIds: [...options.canonicalStateIds],
    pHDomain,
    samples,
    acceptance,
    uncertaintyModel,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintMicrostateEquilibriumPotentialEnsemble(ensemble)
  const applicability = uncertaintyModel.applicability.assessment
  const minimumPotential = Math.min(...samples.flatMap((sample) => sample.log10WeightsRelativeToReference))
  const maximumPotential = Math.max(...samples.flatMap((sample) => sample.log10WeightsRelativeToReference))
  const checks: ValidationCheck[] = [
    {
      id: 'microstate_potential_ensemble.identity',
      status: 'pass',
      message: `Potential ensemble ${fingerprint} binds exact ensemble ${chemicalStateEnsembleFingerprint} and graph ${microstateTransitionGraphFingerprint}`,
      metrics: { fingerprint, sampleCount: samples.length, stateCount: ensemble.stateIds.length },
    },
    {
      id: 'microstate_potential_ensemble.state_coverage',
      status: 'pass',
      message: `Every joint sample covers all ${ensemble.stateIds.length} canonical graph states in one exact gauge`,
      metrics: { stateCount: ensemble.stateIds.length, referenceStateId },
    },
    {
      id: 'microstate_potential_ensemble.weights',
      status: 'pass',
      message: `Joint sample weights normalize to one with Kish weight effective sample size ${weightEffectiveSampleSize}; this is not an autocorrelation-adjusted statistical ESS`,
      metrics: {
        sampleCount: samples.length,
        weightEffectiveSampleSize,
        minimumWeightEffectiveSampleSize: acceptance.minimumWeightEffectiveSampleSize,
      },
    },
    {
      id: 'microstate_potential_ensemble.range',
      status: 'pass',
      message: `Gauge-fixed intrinsic log10 potentials are finite from ${minimumPotential} through ${maximumPotential}`,
      metrics: { minimumPotential, maximumPotential, pHMinimum: pHDomain.minimum, pHMaximum: pHDomain.maximum },
    },
    {
      id: 'microstate_potential_ensemble.applicability',
      status: applicability === 'in-domain' ? 'pass' : applicability === 'out-of-domain' ? 'fail' : 'warn',
      message: `Potential-ensemble applicability is ${applicability}: ${uncertaintyModel.applicability.reasons.join('; ')}`,
      metrics: { assessment: applicability },
    },
    {
      id: 'microstate_potential_ensemble.model_scope',
      status: 'warn',
      message: uncertaintyModel.scopeWarning,
      metrics: { kind: uncertaintyModel.kind },
    },
    {
      id: 'microstate_potential_ensemble.provenance',
      status: 'pass',
      message: `Potential ensemble records ${provenance.engine} ${provenance.engineVersion}, evidence artifacts, parameters, citations, and scope`,
      metrics: { artifactCount: artifacts.length, citationCount: provenance.citations.length },
    },
    {
      id: 'microstate_potential_ensemble.provenance_scope',
      status: 'warn',
      message: provenance.scopeWarning,
      metrics: { engine: provenance.engine, engineVersion: provenance.engineVersion },
    },
  ]
  return { ensemble, fingerprint, weightEffectiveSampleSize, checks }
}

/**
 * Compose calibrated model/correlation-family potential ensembles into one canonical
 * weighted model mixture. Component and sample weights are multiplied exactly; this
 * helper does not infer or calibrate model-family probabilities.
 */
export function composeZatomMicrostatePotentialMixture(
  value: unknown,
  options: ComposeZatomMicrostatePotentialMixtureOptions,
): ZatomMicrostatePotentialMixtureValidation {
  const maxComponents = options.maxComponents ?? 32
  const maxSamples = options.maxSamples ?? 4_096
  const maxStateSamples = options.maxStateSamples ?? 2_097_152
  if (![maxComponents, maxSamples, maxStateSamples].every((item) => (
    Number.isSafeInteger(item) && item > 0
  ))) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture_context',
      'Potential-mixture budgets must be positive safe integers',
    )
  }
  const root = exactObject(value, 'potentialMixture', [
    'components', 'acceptance', 'uncertaintyModel', 'provenance',
  ], ['metadata'])
  if (!Array.isArray(root.components)
    || root.components.length < 2
    || root.components.length > maxComponents) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_budget_exceeded',
      `potentialMixture.components must contain 2-${maxComponents} model/correlation families`,
    )
  }
  const parsedComponents = root.components.map((raw, index) => {
    const field = `potentialMixture.components[${index}]`
    const record = exactObject(raw, field, ['id', 'weight', 'potentialEnsemble'])
    const validation = parseZatomMicrostateEquilibriumPotentialEnsemble(
      record.potentialEnsemble,
      options,
    )
    return {
      id: token(record.id, `${field}.id`),
      weight: numberIn(record.weight, `${field}.weight`, Number.MIN_VALUE, 1),
      validation,
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(parsedComponents.map((component) => component.id)).size !== parsedComponents.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture',
      'Potential-mixture component IDs must be unique',
    )
  }
  const componentWeightSum = parsedComponents.reduce((sum, component) => sum + component.weight, 0)
  if (!Number.isFinite(componentWeightSum) || Math.abs(componentWeightSum - 1) > 1e-8) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_weight_mismatch',
      `Potential-mixture component weights sum to ${componentWeightSum}, not one within 1e-8`,
    )
  }
  parsedComponents.forEach((component) => { component.weight /= componentWeightSum })
  const canonicalComponentWeightSum = parsedComponents.reduce((sum, component) => sum + component.weight, 0)
  const maximumWeightIndex = parsedComponents.reduce((best, component, index) => (
    component.weight > parsedComponents[best].weight ? index : best
  ), 0)
  parsedComponents[maximumWeightIndex].weight += 1 - canonicalComponentWeightSum
  const componentWeightEffectiveCount = 1 / parsedComponents.reduce((sum, component) => (
    sum + component.weight ** 2
  ), 0)

  const rawAcceptance = exactObject(root.acceptance, 'potentialMixture.acceptance', [
    'minimumComponentWeightEffectiveCount', 'minimumWeightEffectiveSampleSize',
  ])
  const minimumComponentWeightEffectiveCount = numberIn(
    rawAcceptance.minimumComponentWeightEffectiveCount,
    'potentialMixture.acceptance.minimumComponentWeightEffectiveCount',
    1,
    parsedComponents.length,
  )
  if (componentWeightEffectiveCount + 1e-12 < minimumComponentWeightEffectiveCount) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_component_effective_count_failed',
      `Component weight effective count ${componentWeightEffectiveCount} is below ${minimumComponentWeightEffectiveCount}`,
    )
  }
  const sampleCount = parsedComponents.reduce((sum, component) => (
    sum + component.validation.ensemble.samples.length
  ), 0)
  if (sampleCount > maxSamples || sampleCount * options.canonicalStateIds.length > maxStateSamples) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_budget_exceeded',
      `Flattened mixture has ${sampleCount} samples and ${sampleCount * options.canonicalStateIds.length} state-samples; limits are ${maxSamples} and ${maxStateSamples}`,
    )
  }
  const selectedPHDomain = parsedComponents[0].validation.ensemble.pHDomain
  if (parsedComponents.some((component) => (
    canonicalJsonIdentity(component.validation.ensemble.pHDomain)
      !== canonicalJsonIdentity(selectedPHDomain)
  ))) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_ph_domain_mismatch',
      'Every potential-mixture component must declare the same exact pH domain',
    )
  }

  const rawModel = exactObject(root.uncertaintyModel, 'potentialMixture.uncertaintyModel', [
    'method', 'assumptions', 'applicability', 'scopeWarning',
  ])
  const rawApplicability = exactObject(
    rawModel.applicability,
    'potentialMixture.uncertaintyModel.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  const componentApplicabilities = parsedComponents.map((component) => (
    component.validation.ensemble.uncertaintyModel.applicability.assessment
  ))
  if (componentApplicabilities.includes('out-of-domain')) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_applicability_mismatch',
      'An out-of-domain component cannot contribute probability mass to a potential mixture',
    )
  }
  if (componentApplicabilities.includes('unknown') && rawApplicability.assessment === 'in-domain') {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'microstate_potential_mixture_applicability_mismatch',
      'A mixture containing unknown-applicability components cannot claim in-domain applicability',
    )
  }

  const rawProvenance = exactObject(root.provenance, 'potentialMixture.provenance', [
    'engine',
    'engineVersion',
    'method',
    'calibrationArtifacts',
    'parameters',
    'citations',
    'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.calibrationArtifacts)
    || rawProvenance.calibrationArtifacts.length < 1
    || rawProvenance.calibrationArtifacts.length + parsedComponents.length > 64) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture',
      `potentialMixture.provenance.calibrationArtifacts plus ${parsedComponents.length} component bindings must contain 2-64 total entries`,
    )
  }
  const calibrationArtifacts = rawProvenance.calibrationArtifacts.map((raw, index) => {
    const field = `potentialMixture.provenance.calibrationArtifacts[${index}]`
    const record = exactObject(raw, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`, 1024),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  })
  if (new Set(calibrationArtifacts.map((artifact) => artifact.id)).size !== calibrationArtifacts.length) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture',
      'Potential-mixture calibration artifact IDs must be unique',
    )
  }
  const componentArtifacts = parsedComponents.map((component, index) => ({
    id: `mixture-component-${(index + 1).toString().padStart(3, '0')}`,
    role: `Canonical potential-ensemble component ${component.id}`,
    fingerprint: component.validation.fingerprint,
  }))
  if (componentArtifacts.some((artifact) => (
    calibrationArtifacts.some((calibration) => calibration.id === artifact.id)
  ))) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture',
      'Calibration artifact IDs must not use reserved mixture-component-NNN bindings',
    )
  }
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
      'invalid_microstate_potential_mixture',
      'potentialMixture.provenance.parameters must be an object',
    )
  }

  const flattenedSamples = parsedComponents.flatMap((component, componentIndex) => (
    component.validation.ensemble.samples.map((sample, sampleIndex) => {
      const weight = component.weight * sample.weight
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new ZatomMicrostateEquilibriumPotentialEnsembleInputError(
          'microstate_potential_mixture_weight_underflow',
          `Mixture weight underflowed for component ${component.id} sample ${sample.id}`,
        )
      }
      return {
        id: `mixture-c${(componentIndex + 1).toString().padStart(3, '0')}-s${(sampleIndex + 1).toString().padStart(5, '0')}`,
        weight,
        log10WeightsRelativeToReference: [...sample.log10WeightsRelativeToReference],
      }
    })
  ))
  const mixtureDraft = {
    schemaVersion: ZATOM_MICROSTATE_EQUILIBRIUM_POTENTIAL_ENSEMBLE_SCHEMA,
    chemicalStateEnsembleFingerprint: options.chemicalStateEnsembleFingerprint,
    microstateTransitionGraphFingerprint: options.microstateTransitionGraphFingerprint,
    referenceStateId: options.referenceStateId,
    stateIds: [...options.canonicalStateIds],
    pHDomain: { ...selectedPHDomain },
    samples: flattenedSamples,
    acceptance: {
      minimumWeightEffectiveSampleSize: rawAcceptance.minimumWeightEffectiveSampleSize,
    },
    uncertaintyModel: {
      kind: 'model-ensemble',
      method: rawModel.method,
      assumptions: rawModel.assumptions,
      applicability: rawModel.applicability,
      scopeWarning: rawModel.scopeWarning,
    },
    provenance: {
      engine: rawProvenance.engine,
      engineVersion: rawProvenance.engineVersion,
      method: rawProvenance.method,
      artifacts: [...calibrationArtifacts, ...componentArtifacts],
      parameters: {
        ...rawProvenance.parameters,
        zatomPotentialMixture: {
          components: parsedComponents.map((component) => ({
            id: component.id,
            weight: component.weight,
            fingerprint: component.validation.fingerprint,
            kind: component.validation.ensemble.uncertaintyModel.kind,
            sampleCount: component.validation.ensemble.samples.length,
            weightEffectiveSampleSize: component.validation.weightEffectiveSampleSize,
          })),
          minimumComponentWeightEffectiveCount,
        },
      },
      citations: rawProvenance.citations,
      scopeWarning: rawProvenance.scopeWarning,
    },
    ...(root.metadata === undefined ? {} : { metadata: root.metadata }),
  }
  const potentialEnsembleValidation = parseZatomMicrostateEquilibriumPotentialEnsemble(
    mixtureDraft,
    options,
  )

  const stateVarianceDecomposition = options.canonicalStateIds.map((stateId, stateIndex) => {
    const componentMeans = parsedComponents.map((component) => (
      component.validation.ensemble.samples.reduce((sum, sample) => (
        sum + sample.weight * sample.log10WeightsRelativeToReference[stateIndex]
      ), 0)
    ))
    const mean = parsedComponents.reduce((sum, component, componentIndex) => (
      sum + component.weight * componentMeans[componentIndex]
    ), 0)
    const withinComponentVariance = parsedComponents.reduce((outer, component, componentIndex) => (
      outer + component.weight * component.validation.ensemble.samples.reduce((inner, sample) => {
        const difference = sample.log10WeightsRelativeToReference[stateIndex]
          - componentMeans[componentIndex]
        return inner + sample.weight * difference ** 2
      }, 0)
    ), 0)
    const betweenComponentVariance = parsedComponents.reduce((sum, component, componentIndex) => (
      sum + component.weight * (componentMeans[componentIndex] - mean) ** 2
    ), 0)
    const totalVariance = withinComponentVariance + betweenComponentVariance
    return {
      stateId,
      meanLog10WeightRelativeToReference: mean,
      withinComponentVariance,
      betweenComponentVariance,
      totalVariance,
      betweenComponentVarianceFraction: totalVariance > 0 ? betweenComponentVariance / totalVariance : 0,
    }
  })
  const maximumBetweenFraction = Math.max(...stateVarianceDecomposition.map((item) => (
    item.betweenComponentVarianceFraction
  )))
  const maximumBetweenStates = stateVarianceDecomposition.filter((item) => (
    item.betweenComponentVarianceFraction + 1e-12 >= maximumBetweenFraction
  )).map((item) => item.stateId)
  const mixtureApplicability = potentialEnsembleValidation.ensemble.uncertaintyModel.applicability.assessment
  const checks: ValidationCheck[] = [
    {
      id: 'microstate_potential_mixture.components',
      status: 'pass',
      message: `Composed ${parsedComponents.length} exact fingerprint-bound model/correlation-family ensembles over one gauge and pH domain`,
      metrics: { componentCount: parsedComponents.length, sampleCount },
    },
    {
      id: 'microstate_potential_mixture.weights',
      status: 'pass',
      message: `Component weights normalize to one with effective component count ${componentWeightEffectiveCount}; flattened sample Kish ESS is ${potentialEnsembleValidation.weightEffectiveSampleSize}`,
      metrics: {
        componentWeightEffectiveCount,
        minimumComponentWeightEffectiveCount,
        flattenedWeightEffectiveSampleSize: potentialEnsembleValidation.weightEffectiveSampleSize,
      },
    },
    {
      id: 'microstate_potential_mixture.variance_decomposition',
      status: 'pass',
      message: `Applied the law of total variance to every gauge-fixed state; maximum between-component variance fraction is ${maximumBetweenFraction}`,
      metrics: {
        maximumBetweenComponentVarianceFraction: maximumBetweenFraction,
        maximumBetweenComponentStateIds: maximumBetweenStates.join(','),
      },
    },
    {
      id: 'microstate_potential_mixture.applicability',
      status: mixtureApplicability === 'in-domain' ? 'pass' : 'warn',
      message: `Mixture applicability is ${mixtureApplicability}; no component is out of domain and unknown component scope was not upgraded`,
      metrics: { assessment: mixtureApplicability },
    },
    {
      id: 'microstate_potential_mixture.provenance',
      status: 'pass',
      message: `Mixture binds ${parsedComponents.length} component fingerprints and ${calibrationArtifacts.length} model-weight calibration artifact(s)`,
      metrics: {
        componentArtifactCount: componentArtifacts.length,
        calibrationArtifactCount: calibrationArtifacts.length,
      },
    },
    {
      id: 'microstate_potential_mixture.model_scope',
      status: 'warn',
      message: `${String(rawModel.scopeWarning)} Component weights and component distributions are treated as calibrated inputs. Mixture composition does not establish that model families are exhaustive, mutually distinct, independent, well calibrated, or sampled to convergence.`,
    },
  ]
  return {
    potentialEnsembleValidation,
    componentValidations: parsedComponents.map((component) => ({
      id: component.id,
      validation: component.validation,
    })),
    componentWeightEffectiveCount,
    components: parsedComponents.map((component) => ({
      id: component.id,
      weight: component.weight,
      fingerprint: component.validation.fingerprint,
      kind: component.validation.ensemble.uncertaintyModel.kind,
      sampleCount: component.validation.ensemble.samples.length,
      weightEffectiveSampleSize: component.validation.weightEffectiveSampleSize,
    })),
    stateVarianceDecomposition,
    checks,
  }
}
