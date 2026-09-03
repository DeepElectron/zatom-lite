/** Canonical multi-chain diagnostics for joint microstate equilibrium-potential samples. */

import type { JsonValue, ValidationCheck } from './contracts'
import type {
  ZatomMicrostateEquilibriumPotentialEnsembleValidation,
} from './microstate-equilibrium-potential-ensemble'
import { fingerprintCanonicalJson } from './structure-math'

export const ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA =
  'zatom.microstate-potential-sample-diagnostics/v1' as const

export interface ZatomMicrostatePotentialSampleChain {
  id: string
  /** Ordered draws for this chain; order is identity-bearing and is never sorted. */
  sampleIds: string[]
}

export interface ZatomMicrostatePotentialStateChainDiagnostic {
  stateId: string
  rankNormalizedSplitRhat: number | null
  foldedRankNormalizedSplitRhat: number | null
  maximumSplitRhat: number | null
  perChainInitialPositiveSequenceEffectiveSamples: number[]
  combinedInitialPositiveSequenceEffectiveSamples: number
  gates: {
    splitRhat: boolean
    effectiveSamples: boolean
  }
}

export interface ZatomMicrostatePotentialSampleDiagnostics {
  schemaVersion: typeof ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA
  equilibriumPotentialEnsembleFingerprint: string
  sampleIds: string[]
  design: {
    kind: 'mcmc-chains'
    chains: ZatomMicrostatePotentialSampleChain[]
    method: string
    assumptions: string[]
    scopeWarning: string
  }
  acceptance: {
    maximumSplitRhat: number
    minimumCombinedEffectiveSamples: number
    maximumAutocorrelationLag: number
  }
  stateDiagnostics: ZatomMicrostatePotentialStateChainDiagnostic[]
  overallPassed: boolean
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

export type ZatomMicrostatePotentialSampleDiagnosticsDraft = Omit<
  ZatomMicrostatePotentialSampleDiagnostics,
  'stateDiagnostics' | 'overallPassed'
>

export interface ParseZatomMicrostatePotentialSampleDiagnosticsOptions {
  potentialEnsembleValidation: ZatomMicrostateEquilibriumPotentialEnsembleValidation
  maxChains?: number
  maxChainSamples?: number
  maxMetadataBytes?: number
}

export interface ZatomMicrostatePotentialSampleDiagnosticsValidation {
  diagnostics: ZatomMicrostatePotentialSampleDiagnostics
  fingerprint: string
  checks: ValidationCheck[]
}

export class ZatomMicrostatePotentialSampleDiagnosticsInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomMicrostatePotentialSampleDiagnosticsInputError'
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
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 64,
  maximumTextLength = 4096,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'invalid_microstate_potential_sample_diagnostics',
        `${field} must be finite`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
    'invalid_microstate_potential_sample_diagnostics',
    `${field} is not JSON-safe`,
  )
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleVariance(values: readonly number[], mean = average(values)): number {
  if (values.length < 2) return 0
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function autocorrelation(values: readonly number[], mean: number, variance: number, lag: number): number {
  if (variance <= 0) return 0
  let covariance = 0
  for (let index = 0; index < values.length - lag; index++) {
    covariance += (values[index] - mean) * (values[index + lag] - mean)
  }
  return covariance / ((values.length - lag) * variance)
}

function initialPositiveSequenceEffectiveSamples(values: readonly number[], maximumLag: number): number {
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const scale = Math.max(...values.map(Math.abs), 1)
  if (variance <= (scale * 1e-12) ** 2) return values.length
  let tau = 0.5
  for (let firstLag = 1; firstLag <= maximumLag; firstLag += 2) {
    const first = autocorrelation(values, mean, variance, firstLag)
    const second = firstLag + 1 <= maximumLag
      ? autocorrelation(values, mean, variance, firstLag + 1)
      : 0
    const pairSum = first + second
    if (pairSum <= 0) break
    tau += pairSum
  }
  const finiteTau = Math.max(0.5, Math.min(tau, values.length / 2))
  return Math.max(1, Math.min(values.length, values.length / (2 * finiteTau)))
}

/** Peter J. Acklam's inverse-normal approximation for rank normalization. */
function inverseNormalCdf(probability: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lower = 0.02425
  const upper = 1 - lower
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  const q = probability - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

function rankNormalize(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((left, right) => (
    left.value - right.value || left.index - right.index
  ))
  const ranks = new Array<number>(values.length)
  let start = 0
  while (start < indexed.length) {
    let end = start + 1
    while (end < indexed.length && indexed[end].value === indexed[start].value) end++
    const averageRank = ((start + 1) + end) / 2
    for (let index = start; index < end; index++) ranks[indexed[index].index] = averageRank
    start = end
  }
  return ranks.map((rank) => inverseNormalCdf((rank - 3 / 8) / (values.length + 1 / 4)))
}

function splitChains(chains: readonly number[][]): number[][] {
  const halfLength = Math.floor(chains[0].length / 2)
  return chains.flatMap((chain) => [
    chain.slice(0, halfLength),
    chain.slice(chain.length - halfLength),
  ])
}

function rhat(chains: readonly number[][]): number | null {
  const sampleCount = chains[0].length
  const means = chains.map((chain) => average(chain))
  const withinVariance = average(chains.map((chain, index) => sampleVariance(chain, means[index])))
  const betweenVariance = sampleCount * sampleVariance(means)
  const scale = Math.max(...chains.flat().map(Math.abs), 1)
  const epsilon = (scale * 1e-12) ** 2
  if (withinVariance <= epsilon) return betweenVariance <= epsilon ? 1 : null
  const varianceEstimate = (sampleCount - 1) / sampleCount * withinVariance + betweenVariance / sampleCount
  const estimate = Math.sqrt(Math.max(0, varianceEstimate / withinVariance))
  return Number.isFinite(estimate) ? Math.max(1, estimate) : null
}

function rankNormalizedSplitRhats(chains: readonly number[][]): {
  rankNormalized: number | null
  folded: number | null
  maximum: number | null
} {
  const chainLength = chains[0].length
  const flattened = chains.flat()
  const normalized = rankNormalize(flattened)
  const normalizedChains = chains.map((_, index) => normalized.slice(index * chainLength, (index + 1) * chainLength))
  const center = median(flattened)
  const foldedNormalized = rankNormalize(flattened.map((value) => Math.abs(value - center)))
  const foldedChains = chains.map((_, index) => foldedNormalized.slice(index * chainLength, (index + 1) * chainLength))
  const rankNormalized = rhat(splitChains(normalizedChains))
  const folded = rhat(splitChains(foldedChains))
  return {
    rankNormalized,
    folded,
    maximum: rankNormalized === null || folded === null ? null : Math.max(rankNormalized, folded),
  }
}


export function fingerprintMicrostatePotentialSampleDiagnostics(
  value: ZatomMicrostatePotentialSampleDiagnostics,
): string {
  return fingerprintCanonicalJson(value)
}

function optionalFiniteNumber(value: unknown, field: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `${field} must be finite or null`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function closeNumber(left: number | null, right: number | null, tolerance = 1e-12): boolean {
  if (left === null || right === null) return left === right
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function normalizeDiagnostics(
  value: unknown,
  options: ParseZatomMicrostatePotentialSampleDiagnosticsOptions,
  requireReportedDiagnostics: boolean,
): ZatomMicrostatePotentialSampleDiagnosticsValidation {
  const potentialValidation = options.potentialEnsembleValidation
  const potentialEnsemble = potentialValidation.ensemble
  const maxChains = options.maxChains ?? 16
  const maxChainSamples = options.maxChainSamples ?? 4_096
  const maxMetadataBytes = options.maxMetadataBytes ?? 2 * 1024 * 1024
  if (!Number.isSafeInteger(maxChains) || maxChains < 2
    || !Number.isSafeInteger(maxChainSamples) || maxChainSamples < 8
    || !Number.isSafeInteger(maxMetadataBytes) || maxMetadataBytes < 1) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics_context',
      'Sample-diagnostics parser budgets must be positive safe integers',
    )
  }

  const requiredRootFields = [
    'schemaVersion',
    'equilibriumPotentialEnsembleFingerprint',
    'sampleIds',
    'design',
    'acceptance',
    'provenance',
    ...(requireReportedDiagnostics ? ['stateDiagnostics', 'overallPassed'] : []),
  ]
  const root = exactObject(value, 'sampleDiagnostics', requiredRootFields, ['metadata'])
  if (root.schemaVersion !== ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      `sampleDiagnostics.schemaVersion must be ${ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA}`,
    )
  }
  const equilibriumPotentialEnsembleFingerprint = text(
    root.equilibriumPotentialEnsembleFingerprint,
    'sampleDiagnostics.equilibriumPotentialEnsembleFingerprint',
    128,
  )
  if (equilibriumPotentialEnsembleFingerprint !== potentialValidation.fingerprint) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_fingerprint_mismatch',
      'Sample diagnostics do not bind the exact equilibrium-potential ensemble fingerprint',
    )
  }
  const canonicalSampleIds = potentialEnsemble.samples.map((sample) => sample.id)
  if (!Array.isArray(root.sampleIds) || root.sampleIds.length !== canonicalSampleIds.length) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_sample_coverage_mismatch',
      'sampleDiagnostics.sampleIds must cover every potential sample exactly once',
    )
  }
  const inputSampleIds = root.sampleIds.map((sampleId, index) => token(
    sampleId,
    `sampleDiagnostics.sampleIds[${index}]`,
  ))
  if (new Set(inputSampleIds).size !== inputSampleIds.length
    || inputSampleIds.some((sampleId) => !canonicalSampleIds.includes(sampleId))) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_sample_coverage_mismatch',
      'sampleDiagnostics.sampleIds must cover every potential sample exactly once',
    )
  }

  const rawDesign = exactObject(root.design, 'sampleDiagnostics.design', [
    'kind', 'chains', 'method', 'assumptions', 'scopeWarning',
  ])
  if (rawDesign.kind !== 'mcmc-chains') {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      'sampleDiagnostics.design.kind must be mcmc-chains',
    )
  }
  if (!Array.isArray(rawDesign.chains)
    || rawDesign.chains.length < 2
    || rawDesign.chains.length > maxChains) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_chain_contract_failed',
      `sampleDiagnostics.design.chains must contain 2-${maxChains} chains`,
    )
  }
  const chains = rawDesign.chains.map((raw, chainIndex) => {
    const field = `sampleDiagnostics.design.chains[${chainIndex}]`
    const record = exactObject(raw, field, ['id', 'sampleIds'])
    if (!Array.isArray(record.sampleIds)
      || record.sampleIds.length < 8
      || record.sampleIds.length > maxChainSamples) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'microstate_potential_sample_diagnostics_chain_contract_failed',
        `${field}.sampleIds must contain 8-${maxChainSamples} ordered draws`,
      )
    }
    return {
      id: token(record.id, `${field}.id`),
      sampleIds: record.sampleIds.map((sampleId, sampleIndex) => token(
        sampleId,
        `${field}.sampleIds[${sampleIndex}]`,
      )),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(chains.map((chain) => chain.id)).size !== chains.length) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_chain_contract_failed',
      'MCMC chain IDs must be unique',
    )
  }
  const chainLength = chains[0].sampleIds.length
  if (chains.some((chain) => chain.sampleIds.length !== chainLength)) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_chain_contract_failed',
      'MCMC chains must have equal retained-draw counts',
    )
  }
  const chainedSampleIds = chains.flatMap((chain) => chain.sampleIds)
  if (chainedSampleIds.length !== canonicalSampleIds.length
    || new Set(chainedSampleIds).size !== chainedSampleIds.length
    || chainedSampleIds.some((sampleId) => !canonicalSampleIds.includes(sampleId))) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_sample_coverage_mismatch',
      'Ordered chains must cover every potential sample exactly once without duplication',
    )
  }
  const expectedWeight = 1 / potentialEnsemble.samples.length
  if (potentialEnsemble.samples.some((sample) => Math.abs(sample.weight - expectedWeight) > 1e-12)) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_nonuniform_mcmc_weights',
      'Standard multi-chain diagnostics require equal-weight retained MCMC draws',
    )
  }
  const design: ZatomMicrostatePotentialSampleDiagnostics['design'] = {
    kind: 'mcmc-chains',
    chains,
    method: text(rawDesign.method, 'sampleDiagnostics.design.method', 4096),
    assumptions: uniqueTextList(rawDesign.assumptions, 'sampleDiagnostics.design.assumptions'),
    scopeWarning: text(rawDesign.scopeWarning, 'sampleDiagnostics.design.scopeWarning', 8192),
  }

  const rawAcceptance = exactObject(root.acceptance, 'sampleDiagnostics.acceptance', [
    'maximumSplitRhat',
    'minimumCombinedEffectiveSamples',
    'maximumAutocorrelationLag',
  ])
  const acceptance = {
    maximumSplitRhat: numberIn(
      rawAcceptance.maximumSplitRhat,
      'sampleDiagnostics.acceptance.maximumSplitRhat',
      1,
      10,
    ),
    minimumCombinedEffectiveSamples: numberIn(
      rawAcceptance.minimumCombinedEffectiveSamples,
      'sampleDiagnostics.acceptance.minimumCombinedEffectiveSamples',
      1,
      canonicalSampleIds.length,
    ),
    maximumAutocorrelationLag: integer(
      rawAcceptance.maximumAutocorrelationLag,
      'sampleDiagnostics.acceptance.maximumAutocorrelationLag',
      1,
      Math.min(1_000, chainLength - 1),
    ),
  }

  const sampleById = new Map(potentialEnsemble.samples.map((sample) => [sample.id, sample]))
  const stateDiagnostics = potentialEnsemble.stateIds
    .map((stateId, stateIndex) => ({ stateId, stateIndex }))
    .filter(({ stateId }) => stateId !== potentialEnsemble.referenceStateId)
    .map(({ stateId, stateIndex }): ZatomMicrostatePotentialStateChainDiagnostic => {
      const stateChains = chains.map((chain) => chain.sampleIds.map((sampleId) => (
        sampleById.get(sampleId)!.log10WeightsRelativeToReference[stateIndex]
      )))
      const rhats = rankNormalizedSplitRhats(stateChains)
      const perChainInitialPositiveSequenceEffectiveSamples = stateChains.map((chain) => (
        initialPositiveSequenceEffectiveSamples(chain, acceptance.maximumAutocorrelationLag)
      ))
      const combinedInitialPositiveSequenceEffectiveSamples =
        perChainInitialPositiveSequenceEffectiveSamples.reduce((sum, item) => sum + item, 0)
      return {
        stateId,
        rankNormalizedSplitRhat: rhats.rankNormalized,
        foldedRankNormalizedSplitRhat: rhats.folded,
        maximumSplitRhat: rhats.maximum,
        perChainInitialPositiveSequenceEffectiveSamples,
        combinedInitialPositiveSequenceEffectiveSamples,
        gates: {
          splitRhat: rhats.maximum !== null
            && rhats.maximum <= acceptance.maximumSplitRhat + 1e-12,
          effectiveSamples: combinedInitialPositiveSequenceEffectiveSamples + 1e-12
            >= acceptance.minimumCombinedEffectiveSamples,
        },
      }
    })
  const overallPassed = stateDiagnostics.every((diagnostic) => (
    diagnostic.gates.splitRhat && diagnostic.gates.effectiveSamples
  ))

  if (requireReportedDiagnostics) {
    if (!Array.isArray(root.stateDiagnostics)
      || root.stateDiagnostics.length !== stateDiagnostics.length) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'microstate_potential_sample_diagnostics_result_mismatch',
        'Reported stateDiagnostics do not cover every non-reference state',
      )
    }
    const reportedByState = new Map(root.stateDiagnostics.map((raw, index) => {
      const field = `sampleDiagnostics.stateDiagnostics[${index}]`
      const record = exactObject(raw, field, [
        'stateId',
        'rankNormalizedSplitRhat',
        'foldedRankNormalizedSplitRhat',
        'maximumSplitRhat',
        'perChainInitialPositiveSequenceEffectiveSamples',
        'combinedInitialPositiveSequenceEffectiveSamples',
        'gates',
      ])
      const stateId = token(record.stateId, `${field}.stateId`)
      if (!Array.isArray(record.perChainInitialPositiveSequenceEffectiveSamples)
        || record.perChainInitialPositiveSequenceEffectiveSamples.length !== chains.length) {
        throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
          'microstate_potential_sample_diagnostics_result_mismatch',
          `${field}.perChainInitialPositiveSequenceEffectiveSamples must align with canonical chains`,
        )
      }
      const gates = exactObject(record.gates, `${field}.gates`, ['splitRhat', 'effectiveSamples'])
      if (typeof gates.splitRhat !== 'boolean' || typeof gates.effectiveSamples !== 'boolean') {
        throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
          'microstate_potential_sample_diagnostics_result_mismatch',
          `${field}.gates must contain booleans`,
        )
      }
      return [stateId, {
        stateId,
        rankNormalizedSplitRhat: optionalFiniteNumber(
          record.rankNormalizedSplitRhat,
          `${field}.rankNormalizedSplitRhat`,
        ),
        foldedRankNormalizedSplitRhat: optionalFiniteNumber(
          record.foldedRankNormalizedSplitRhat,
          `${field}.foldedRankNormalizedSplitRhat`,
        ),
        maximumSplitRhat: optionalFiniteNumber(record.maximumSplitRhat, `${field}.maximumSplitRhat`),
        perChainInitialPositiveSequenceEffectiveSamples:
          record.perChainInitialPositiveSequenceEffectiveSamples.map((item, chainIndex) => numberIn(
            item,
            `${field}.perChainInitialPositiveSequenceEffectiveSamples[${chainIndex}]`,
            1,
            chainLength,
          )),
        combinedInitialPositiveSequenceEffectiveSamples: numberIn(
          record.combinedInitialPositiveSequenceEffectiveSamples,
          `${field}.combinedInitialPositiveSequenceEffectiveSamples`,
          1,
          canonicalSampleIds.length,
        ),
        gates: { splitRhat: gates.splitRhat, effectiveSamples: gates.effectiveSamples },
      } as ZatomMicrostatePotentialStateChainDiagnostic] as const
    }))
    if (reportedByState.size !== stateDiagnostics.length) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'microstate_potential_sample_diagnostics_result_mismatch',
        'Reported state diagnostic IDs must be unique',
      )
    }
    for (const expected of stateDiagnostics) {
      const reported = reportedByState.get(expected.stateId)
      if (!reported) {
        throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
          'microstate_potential_sample_diagnostics_result_mismatch',
          `Reported diagnostics omit state ${expected.stateId}`,
        )
      }
      const numericMatch = closeNumber(reported.rankNormalizedSplitRhat, expected.rankNormalizedSplitRhat)
        && closeNumber(reported.foldedRankNormalizedSplitRhat, expected.foldedRankNormalizedSplitRhat)
        && closeNumber(reported.maximumSplitRhat, expected.maximumSplitRhat)
        && closeNumber(
          reported.combinedInitialPositiveSequenceEffectiveSamples,
          expected.combinedInitialPositiveSequenceEffectiveSamples,
        )
        && reported.perChainInitialPositiveSequenceEffectiveSamples.every((item, index) => closeNumber(
          item,
          expected.perChainInitialPositiveSequenceEffectiveSamples[index],
        ))
      if (!numericMatch
        || reported.gates.splitRhat !== expected.gates.splitRhat
        || reported.gates.effectiveSamples !== expected.gates.effectiveSamples) {
        throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
          'microstate_potential_sample_diagnostics_result_mismatch',
          `Reported diagnostics for state ${expected.stateId} differ from independent recomputation`,
        )
      }
    }
    if (typeof root.overallPassed !== 'boolean' || root.overallPassed !== overallPassed) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'microstate_potential_sample_diagnostics_result_mismatch',
        'Reported overallPassed differs from independently recomputed gates',
      )
    }
  }

  const rawProvenance = exactObject(root.provenance, 'sampleDiagnostics.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.artifacts)
    || rawProvenance.artifacts.length < 1
    || rawProvenance.artifacts.length > 64) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      'sampleDiagnostics.provenance.artifacts must contain 1-64 entries',
    )
  }
  const artifacts = rawProvenance.artifacts.map((raw, index) => {
    const field = `sampleDiagnostics.provenance.artifacts[${index}]`
    const record = exactObject(raw, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`, 1024),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      'sampleDiagnostics.provenance artifact IDs must be unique',
    )
  }
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'invalid_microstate_potential_sample_diagnostics',
      'sampleDiagnostics.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomMicrostatePotentialSampleDiagnostics['provenance'] = {
    engine: text(rawProvenance.engine, 'sampleDiagnostics.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'sampleDiagnostics.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'sampleDiagnostics.provenance.method', 4096),
    artifacts,
    parameters: jsonValue(rawProvenance.parameters, 'sampleDiagnostics.provenance.parameters') as Record<string, JsonValue>,
    citations: uniqueTextList(rawProvenance.citations, 'sampleDiagnostics.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'sampleDiagnostics.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
        'invalid_microstate_potential_sample_diagnostics',
        'sampleDiagnostics.metadata must be an object',
      )
    }
    metadata = jsonValue(root.metadata, 'sampleDiagnostics.metadata') as Record<string, JsonValue>
  }
  if (new TextEncoder().encode(JSON.stringify({ design, provenance, metadata })).length > maxMetadataBytes) {
    throw new ZatomMicrostatePotentialSampleDiagnosticsInputError(
      'microstate_potential_sample_diagnostics_budget_exceeded',
      `Sample-diagnostics design/provenance/metadata exceeds ${maxMetadataBytes} bytes`,
    )
  }

  const diagnostics: ZatomMicrostatePotentialSampleDiagnostics = {
    schemaVersion: ZATOM_MICROSTATE_POTENTIAL_SAMPLE_DIAGNOSTICS_SCHEMA,
    equilibriumPotentialEnsembleFingerprint,
    sampleIds: [...canonicalSampleIds],
    design,
    acceptance,
    stateDiagnostics,
    overallPassed,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintMicrostatePotentialSampleDiagnostics(diagnostics)
  const maximumObservedRhat = stateDiagnostics.some((diagnostic) => diagnostic.maximumSplitRhat === null)
    ? null
    : Math.max(...stateDiagnostics.map((diagnostic) => diagnostic.maximumSplitRhat!))
  const minimumObservedEffectiveSamples = Math.min(
    ...stateDiagnostics.map((diagnostic) => diagnostic.combinedInitialPositiveSequenceEffectiveSamples),
  )
  const checks: ValidationCheck[] = [
    {
      id: 'microstate_potential_sample_diagnostics.identity',
      status: 'pass',
      message: `Diagnostics ${fingerprint} bind exact potential ensemble ${potentialValidation.fingerprint}`,
      metrics: { fingerprint, potentialEnsembleFingerprint: potentialValidation.fingerprint },
    },
    {
      id: 'microstate_potential_sample_diagnostics.chain_contract',
      status: 'pass',
      message: `${chains.length} equal-length ordered MCMC chains cover all ${canonicalSampleIds.length} equal-weight draws exactly once`,
      metrics: { chainCount: chains.length, chainLength, sampleCount: canonicalSampleIds.length },
    },
    {
      id: 'microstate_potential_sample_diagnostics.split_rhat',
      status: stateDiagnostics.every((item) => item.gates.splitRhat) ? 'pass' : 'fail',
      message: maximumObservedRhat === null
        ? 'At least one non-reference state has undefined rank-normalized/folded split-R-hat'
        : `Maximum rank-normalized/folded split-R-hat is ${maximumObservedRhat} against ${acceptance.maximumSplitRhat}`,
      metrics: { maximumObservedRhat, maximumAcceptedRhat: acceptance.maximumSplitRhat },
    },
    {
      id: 'microstate_potential_sample_diagnostics.effective_samples',
      status: stateDiagnostics.every((item) => item.gates.effectiveSamples) ? 'pass' : 'fail',
      message: `Minimum combined initial-positive-sequence effective samples is ${minimumObservedEffectiveSamples} against ${acceptance.minimumCombinedEffectiveSamples}`,
      metrics: {
        minimumObservedEffectiveSamples,
        minimumAcceptedEffectiveSamples: acceptance.minimumCombinedEffectiveSamples,
        maximumAutocorrelationLag: acceptance.maximumAutocorrelationLag,
      },
    },
    {
      id: 'microstate_potential_sample_diagnostics.overall',
      status: overallPassed ? 'pass' : 'fail',
      message: overallPassed
        ? 'Every non-reference state passes the declared split-R-hat and autocorrelation-ESS gates'
        : 'At least one non-reference state fails a declared MCMC diagnostic gate',
      metrics: { overallPassed, stateCount: stateDiagnostics.length },
    },
    {
      id: 'microstate_potential_sample_diagnostics.scope',
      status: 'warn',
      message: `${design.scopeWarning} ${provenance.scopeWarning} Passing finite-chain split-R-hat and initial-positive-sequence ESS screens is necessary evidence only; it does not prove stationarity, adequate warmup, tail exploration, absence of divergences, or convergence of unreported quantities.`,
      metrics: { designKind: design.kind },
    },
    {
      id: 'microstate_potential_sample_diagnostics.provenance',
      status: 'pass',
      message: `Diagnostics record ${provenance.engine} ${provenance.engineVersion}, source artifacts, parameters, citations, and scope`,
      metrics: { artifactCount: artifacts.length, citationCount: provenance.citations.length },
    },
  ]
  return { diagnostics, fingerprint, checks }
}

/** Build canonical diagnostics from an ordered-chain design and independently computed metrics. */
export function createZatomMicrostatePotentialSampleDiagnostics(
  draft: ZatomMicrostatePotentialSampleDiagnosticsDraft,
  options: ParseZatomMicrostatePotentialSampleDiagnosticsOptions,
): ZatomMicrostatePotentialSampleDiagnosticsValidation {
  return normalizeDiagnostics(draft, options, false)
}

/** Recompute and validate every reported diagnostic before accepting an artifact. */
export function parseZatomMicrostatePotentialSampleDiagnostics(
  value: unknown,
  options: ParseZatomMicrostatePotentialSampleDiagnosticsOptions,
): ZatomMicrostatePotentialSampleDiagnosticsValidation {
  return normalizeDiagnostics(value, options, true)
}
