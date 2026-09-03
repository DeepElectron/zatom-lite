/** Canonical sampled-shift and fixed-shift cell-size series for relaxed periodic screw dipoles. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import {
  canonicalJsonIdentity,
  compareCanonicalText,
  determinant3,
  fingerprintCanonicalJson,
} from './structure-math'
import {
  parseZatomPeriodicDislocationRelaxationEvidence,
  type ParseZatomPeriodicDislocationRelaxationEvidenceOptions,
  type ZatomPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidenceValidation,
} from './periodic-dislocation-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA =
  'zatom.periodic-dislocation-relaxation-series/v1' as const

export type ZatomPeriodicDislocationRelaxationSeriesKind =
  | 'shift-scan-at-fixed-cell'
  | 'cell-size-at-fixed-shift'

export interface ZatomPeriodicDislocationRelaxationSeriesCaseContext
extends ParseZatomPeriodicDislocationRelaxationEvidenceOptions {
  id: string
  pairEvidence: ZatomPeriodicDislocationRelaxationEvidence
}

export interface ZatomPeriodicDislocationRelaxationSeriesEvidence {
  schemaVersion: typeof ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA
  kind: ZatomPeriodicDislocationRelaxationSeriesKind
  commonFingerprint: string
  cases: Array<{
    id: string
    pairEvidenceFingerprint: string
    seedEvidenceFingerprint: string
    seedStructureFingerprint: string
    fixedCellFingerprint: string
    relaxedDefectStructureFingerprint: string
    sizeMultipliers: [number, number, number]
    shiftIndex: number
    transverseAreaA2: number
    transverseAreaPerBurgersSquared: number
    minimumTransverseCellVectorPerBurgers: number
    lineLengthA: number
    excessPotentialEnergyPerTotalLineLengthEvPerA: number
    maximumFinalForceEvPerA: number
    coreAnchorRmsDifferentialDisplacementA: number
    finalStressDifferenceBar: { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number }
    maximumAbsoluteFinalStressDifferenceBar: number
    acceptancePassed: boolean
  }>
  selection: {
    selectedCaseId: string
    method: 'explicit' | 'minimum-excess-energy' | 'largest-transverse-cell'
    rationale: string
  }
  acceptance: {
    minimumCaseCount: number
    requireAllCasesAccepted: true
    minimumLargestTransverseCellVectorPerBurgers: number | null
    maximumLargestPairExcessEnergyDriftEvPerA: number | null
    maximumLargestPairCoreAnchorRmsDriftA: number | null
    maximumLargestPairStressDifferenceDriftBar: number | null
  }
  metrics: {
    caseCount: number
    allCasesAccepted: boolean
    minimumSampledExcessEnergyEvPerA: number
    maximumSampledExcessEnergyEvPerA: number
    sampledExcessEnergySpreadEvPerA: number
    selectedExcessEnergyEvPerA: number
    selectedGapToNextBestEvPerA: number | null
    largestPairCaseIds: [string, string] | null
    largestPairExcessEnergyDriftEvPerA: number | null
    largestPairCoreAnchorRmsDriftA: number | null
    largestPairStressDifferenceDriftBar: number | null
    acceptancePassed: boolean
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

export interface ComposeZatomPeriodicDislocationRelaxationSeriesInput {
  kind: ZatomPeriodicDislocationRelaxationSeriesKind
  cases: ZatomPeriodicDislocationRelaxationSeriesCaseContext[]
  selection: ZatomPeriodicDislocationRelaxationSeriesEvidence['selection']
  acceptance: ZatomPeriodicDislocationRelaxationSeriesEvidence['acceptance']
  provenance: ZatomPeriodicDislocationRelaxationSeriesEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomPeriodicDislocationRelaxationSeriesOptions {
  cases: ZatomPeriodicDislocationRelaxationSeriesCaseContext[]
  maxCases?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomPeriodicDislocationRelaxationSeriesValidation {
  evidence: ZatomPeriodicDislocationRelaxationSeriesEvidence
  selectedStructure: ZatomStructure
  selectedPairValidation: ZatomPeriodicDislocationRelaxationEvidenceValidation
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomPeriodicDislocationRelaxationSeriesInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPeriodicDislocationRelaxationSeriesInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(value: unknown, field: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must be an object`)
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError(
      'invalid_periodic_dislocation_relaxation_series',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must be finite from ${minimum} through ${maximum}`)
  }
  return Object.is(value, -0) ? 0 : value
}

function nullableNonnegative(value: unknown, field: string): number | null {
  return value === null ? null : finite(value, field, 0)
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const result = finite(value, field, minimum, maximum)
  if (!Number.isSafeInteger(result)) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must be an integer`)
  return result
}

function text(value: unknown, field: string, maximum = 8192): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`)
  }
  return value.trim()
}

function token(value: unknown, field: string): string {
  const result = text(value, field, 128)
  if (!/^[A-Za-z0-9_.:+-]+$/.test(result)) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} contains unsupported characters`)
  }
  return result
}

function uniqueTexts(value: unknown, field: string, minimum = 0, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must contain ${minimum}-${maximum} strings`)
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must not repeat values`)
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return finite(value, field)
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `${field} must be a JSON object`)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', `${field} must be a positive safe integer`)
  return result
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintPeriodicDislocationRelaxationSeries(
  value: ZatomPeriodicDislocationRelaxationSeriesEvidence,
): string {
  return fingerprintCanonicalJson(value)
}

function commonIdentity(validation: ZatomPeriodicDislocationRelaxationEvidenceValidation, context: ZatomPeriodicDislocationRelaxationSeriesCaseContext): unknown {
  const seed = context.seedEvidence
  const seedParameters = { ...seed.provenance.parameters }
  delete seedParameters.sizeMultipliers
  delete seedParameters.shiftIndex
  const varyingSeedArtifactIds = new Set(['source-unit-cell', 'perfect-reference', 'periodic-dipole-result'])
  const relaxation = context.defectRelaxationEvidence
  return {
    sourceStructureFingerprint: validation.evidence.sourceStructureFingerprint,
    elasticity: seed.elasticity,
    crystallography: seed.crystallography,
    seedConstruction: {
      kind: seed.construction.kind,
      representation: seed.construction.representation,
      boxtilt: seed.construction.boxtilt,
      imageReplicaCount: seed.construction.imageReplicaCount,
      comparisonImageReplicaCount: seed.construction.comparisonImageReplicaCount,
      atommanIndices: seed.construction.atommanIndices,
    },
    seedAcceptance: seed.acceptance,
    seedRuntime: {
      engine: seed.provenance.engine,
      engineVersion: seed.provenance.engineVersion,
      dependencies: seed.provenance.dependencies,
      method: seed.provenance.method,
      package: seed.provenance.package,
      artifacts: seed.provenance.artifacts.filter((artifact) => !varyingSeedArtifactIds.has(artifact.id)),
      parameters: seedParameters,
      citations: seed.provenance.citations,
      scopeWarning: seed.provenance.scopeWarning,
    },
    relaxation: {
      method: relaxation.method,
      model: relaxation.model,
      settings: relaxation.settings,
      providerId: relaxation.provenance.providerId,
      adapterVersion: relaxation.provenance.adapterVersion,
      executable: relaxation.provenance.executable,
      parameters: relaxation.provenance.parameters,
      citations: relaxation.provenance.citations,
      scopeWarning: relaxation.provenance.scopeWarning,
    },
    pairAcceptance: validation.evidence.acceptance,
    lineLengthA: validation.evidence.construction.lineLengthA,
  }
}

function parseArtifacts(value: unknown, expected: Map<string, string>): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length !== expected.size) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `provenance.artifacts must contain exactly ${expected.size} case artifacts`)
  }
  const result = value.map((item, index) => {
    const field = `evidence.provenance.artifacts[${index}]`
    const record = exactObject(item, field, ['id', 'role', 'fingerprint'])
    return { id: token(record.id, `${field}.id`), role: text(record.role, `${field}.role`), fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256) }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(result.map((item) => item.id)).size !== result.length) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'provenance artifact IDs must be unique')
  for (const [id, fingerprint] of expected) {
    const artifact = result.find((item) => item.id === id)
    if (!artifact || artifact.fingerprint !== fingerprint) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_provenance_mismatch', `provenance must bind ${id} to ${fingerprint}`)
    }
  }
  return result
}

function buildValidation(
  rawValue: unknown,
  options: ParseZatomPeriodicDislocationRelaxationSeriesOptions,
): ZatomPeriodicDislocationRelaxationSeriesValidation {
  const maxCases = positiveBudget(options.maxCases, 32, 'maxCases')
  const maxMetadataBytes = positiveBudget(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  if (!Array.isArray(options.cases) || options.cases.length < 2 || options.cases.length > maxCases) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', `cases must contain 2-${maxCases} entries`)
  }
  const contextIds = options.cases.map((item, index) => token(item.id, `cases[${index}].id`))
  if (new Set(contextIds).size !== contextIds.length) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series_context', 'Case IDs must be unique')
  const parsedCases = options.cases.map((context, index) => ({
    id: contextIds[index],
    context,
    validation: parseZatomPeriodicDislocationRelaxationEvidence(context.pairEvidence, context),
  }))
  const common = commonIdentity(parsedCases[0].validation, parsedCases[0].context)
  for (const item of parsedCases.slice(1)) {
    if (canonicalJsonIdentity(commonIdentity(item.validation, item.context)) !== canonicalJsonIdentity(common)) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError(
        'periodic_dislocation_relaxation_series_common_mismatch',
        'Every case must share exact source, elasticity, crystallography, potential/executable/provider identity, and periodic line length',
      )
    }
  }

  const raw = exactObject(rawValue, 'evidence', [
    'schemaVersion', 'kind', 'commonFingerprint', 'cases', 'selection', 'acceptance', 'metrics', 'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', `schemaVersion must be ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA}`)
  }
  if (raw.kind !== 'shift-scan-at-fixed-cell' && raw.kind !== 'cell-size-at-fixed-shift') {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'kind is unsupported')
  }
  const kind = raw.kind
  const rawSelection = exactObject(raw.selection, 'evidence.selection', ['selectedCaseId', 'method', 'rationale'])
  if (rawSelection.method !== 'explicit' && rawSelection.method !== 'minimum-excess-energy' && rawSelection.method !== 'largest-transverse-cell') {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'selection.method is unsupported')
  }
  const selection: ZatomPeriodicDislocationRelaxationSeriesEvidence['selection'] = {
    selectedCaseId: token(rawSelection.selectedCaseId, 'evidence.selection.selectedCaseId'),
    method: rawSelection.method,
    rationale: text(rawSelection.rationale, 'evidence.selection.rationale'),
  }
  if (!contextIds.includes(selection.selectedCaseId)) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_selection_missing', 'Selected case ID is absent')
  if (kind === 'shift-scan-at-fixed-cell' && selection.method === 'largest-transverse-cell'
    || kind === 'cell-size-at-fixed-shift' && selection.method === 'minimum-excess-energy') {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'Selection method is incompatible with series kind')
  }
  const rawAcceptance = exactObject(raw.acceptance, 'evidence.acceptance', [
    'minimumCaseCount', 'requireAllCasesAccepted', 'minimumLargestTransverseCellVectorPerBurgers',
    'maximumLargestPairExcessEnergyDriftEvPerA', 'maximumLargestPairCoreAnchorRmsDriftA',
    'maximumLargestPairStressDifferenceDriftBar',
  ])
  if (rawAcceptance.requireAllCasesAccepted !== true) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('invalid_periodic_dislocation_relaxation_series', 'acceptance.requireAllCasesAccepted must be true')
  const acceptance: ZatomPeriodicDislocationRelaxationSeriesEvidence['acceptance'] = {
    minimumCaseCount: integer(rawAcceptance.minimumCaseCount, 'evidence.acceptance.minimumCaseCount', 2, maxCases),
    requireAllCasesAccepted: true,
    minimumLargestTransverseCellVectorPerBurgers: nullableNonnegative(rawAcceptance.minimumLargestTransverseCellVectorPerBurgers, 'evidence.acceptance.minimumLargestTransverseCellVectorPerBurgers'),
    maximumLargestPairExcessEnergyDriftEvPerA: nullableNonnegative(rawAcceptance.maximumLargestPairExcessEnergyDriftEvPerA, 'evidence.acceptance.maximumLargestPairExcessEnergyDriftEvPerA'),
    maximumLargestPairCoreAnchorRmsDriftA: nullableNonnegative(rawAcceptance.maximumLargestPairCoreAnchorRmsDriftA, 'evidence.acceptance.maximumLargestPairCoreAnchorRmsDriftA'),
    maximumLargestPairStressDifferenceDriftBar: nullableNonnegative(rawAcceptance.maximumLargestPairStressDifferenceDriftBar, 'evidence.acceptance.maximumLargestPairStressDifferenceDriftBar'),
  }
  const sizeGateFields = [
    acceptance.minimumLargestTransverseCellVectorPerBurgers,
    acceptance.maximumLargestPairExcessEnergyDriftEvPerA,
    acceptance.maximumLargestPairCoreAnchorRmsDriftA,
    acceptance.maximumLargestPairStressDifferenceDriftBar,
  ]
  if (kind === 'cell-size-at-fixed-shift' ? sizeGateFields.some((value) => value === null) : sizeGateFields.some((value) => value !== null)) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError(
      'invalid_periodic_dislocation_relaxation_series',
      kind === 'cell-size-at-fixed-shift' ? 'Cell-size series requires every largest-pair gate' : 'Shift scan must set all cell-size-only gates to null',
    )
  }

  const summaries = parsedCases.map(({ id, context, validation }) => {
    const pair = validation.evidence
    const seed = parseZatomStructure(context.seedStructure)
    const transverseAreaA2 = Math.abs(determinant3(seed.lattice!.vectors)) / pair.construction.lineLengthA
    return {
      id,
      pairEvidenceFingerprint: validation.fingerprint,
      seedEvidenceFingerprint: pair.seedEvidenceFingerprint,
      seedStructureFingerprint: pair.seedStructureFingerprint,
      fixedCellFingerprint: fingerprintCanonicalJson(seed.lattice),
      relaxedDefectStructureFingerprint: pair.relaxedDefectStructureFingerprint,
      sizeMultipliers: [...pair.construction.sizeMultipliers] as [number, number, number],
      shiftIndex: pair.construction.shiftIndex,
      transverseAreaA2,
      transverseAreaPerBurgersSquared: transverseAreaA2 / pair.construction.burgersMagnitudeA ** 2,
      minimumTransverseCellVectorPerBurgers: context.seedEvidence.metrics.minimumTransverseCellVectorPerBurgers,
      lineLengthA: pair.construction.lineLengthA,
      excessPotentialEnergyPerTotalLineLengthEvPerA: pair.metrics.excessPotentialEnergyPerTotalLineLengthEvPerA,
      maximumFinalForceEvPerA: Math.max(pair.metrics.maximumDefectForceEvPerA, pair.metrics.maximumReferenceForceEvPerA),
      coreAnchorRmsDifferentialDisplacementA: pair.metrics.coreAnchorRmsDifferentialDisplacementA,
      finalStressDifferenceBar: { ...pair.metrics.finalStressDifferenceBar },
      maximumAbsoluteFinalStressDifferenceBar: pair.metrics.maximumAbsoluteFinalStressDifferenceBar,
      acceptancePassed: pair.metrics.acceptancePassed,
    }
  })
  if (kind === 'shift-scan-at-fixed-cell') {
    const firstSize = canonicalJsonIdentity(summaries[0].sizeMultipliers)
    const firstArea = summaries[0].transverseAreaA2
    const firstCellFingerprint = summaries[0].fixedCellFingerprint
    if (summaries.some((item) => item.fixedCellFingerprint !== firstCellFingerprint
      || canonicalJsonIdentity(item.sizeMultipliers) !== firstSize
      || Math.abs(item.transverseAreaA2 - firstArea) > 1e-10 * Math.max(1, firstArea))) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_cell_mismatch', 'Shift scan requires one exact fixed lattice and cell size')
    }
    if (new Set(summaries.map((item) => item.shiftIndex)).size !== summaries.length) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_duplicate_shift', 'Shift scan requires unique sampled shift indices')
    }
    summaries.sort((left, right) => left.shiftIndex - right.shiftIndex || compareCanonicalText(left.id, right.id))
  } else {
    const shift = summaries[0].shiftIndex
    if (summaries.some((item) => item.shiftIndex !== shift)) {
      throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_shift_mismatch', 'Cell-size series requires one fixed shift index')
    }
    summaries.sort((left, right) => (
      left.transverseAreaA2 - right.transverseAreaA2 || compareCanonicalText(left.id, right.id)
    ))
    for (let index = 1; index < summaries.length; index++) {
      if (summaries[index].transverseAreaA2 <= summaries[index - 1].transverseAreaA2 * (1 + 1e-10)) {
        throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_size_not_increasing', 'Cell-size cases require unique strictly increasing transverse area')
      }
    }
  }
  const energies = summaries.map((item) => item.excessPotentialEnergyPerTotalLineLengthEvPerA)
  const minimumEnergy = Math.min(...energies)
  const maximumEnergy = Math.max(...energies)
  const selectedIndex = summaries.findIndex((item) => item.id === selection.selectedCaseId)
  if (selection.method === 'minimum-excess-energy'
    && summaries[selectedIndex].excessPotentialEnergyPerTotalLineLengthEvPerA > minimumEnergy + 1e-12) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_selection_mismatch', 'minimum-excess-energy must select a sampled minimum')
  }
  if (selection.method === 'largest-transverse-cell' && selectedIndex !== summaries.length - 1) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_selection_mismatch', 'largest-transverse-cell must select the final sorted cell')
  }
  const sortedEnergies = [...energies].sort((left, right) => left - right)
  const selectedGapToNextBestEvPerA = kind === 'shift-scan-at-fixed-cell' && sortedEnergies.length > 1
    ? summaries[selectedIndex].excessPotentialEnergyPerTotalLineLengthEvPerA === sortedEnergies[0]
      ? sortedEnergies[1] - sortedEnergies[0]
      : summaries[selectedIndex].excessPotentialEnergyPerTotalLineLengthEvPerA - sortedEnergies[0]
    : null
  let largestPairCaseIds: [string, string] | null = null
  let largestPairExcessEnergyDriftEvPerA: number | null = null
  let largestPairCoreAnchorRmsDriftA: number | null = null
  let largestPairStressDifferenceDriftBar: number | null = null
  if (kind === 'cell-size-at-fixed-shift') {
    const previous = summaries[summaries.length - 2]
    const largest = summaries[summaries.length - 1]
    largestPairCaseIds = [previous.id, largest.id]
    largestPairExcessEnergyDriftEvPerA = Math.abs(largest.excessPotentialEnergyPerTotalLineLengthEvPerA - previous.excessPotentialEnergyPerTotalLineLengthEvPerA)
    largestPairCoreAnchorRmsDriftA = Math.abs(largest.coreAnchorRmsDifferentialDisplacementA - previous.coreAnchorRmsDifferentialDisplacementA)
    const stressComponents = ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'] as const
    largestPairStressDifferenceDriftBar = Math.max(...stressComponents.map((component) => Math.abs(
      largest.finalStressDifferenceBar[component] - previous.finalStressDifferenceBar[component],
    )))
  }
  const allCasesAccepted = summaries.every((item) => item.acceptancePassed)
  const countGate = summaries.length >= acceptance.minimumCaseCount
  const sizeGatesPassed = kind === 'shift-scan-at-fixed-cell' || (
    summaries[summaries.length - 1].minimumTransverseCellVectorPerBurgers + 1e-12 >= acceptance.minimumLargestTransverseCellVectorPerBurgers!
    && largestPairExcessEnergyDriftEvPerA! <= acceptance.maximumLargestPairExcessEnergyDriftEvPerA! + 1e-12
    && largestPairCoreAnchorRmsDriftA! <= acceptance.maximumLargestPairCoreAnchorRmsDriftA! + 1e-12
    && largestPairStressDifferenceDriftBar! <= acceptance.maximumLargestPairStressDifferenceDriftBar! + 1e-12
  )
  const acceptancePassed = allCasesAccepted && countGate && sizeGatesPassed
  const expectedArtifacts = new Map(summaries.map((item) => [`pair:${item.id}`, item.pairEvidenceFingerprint]))
  const rawProvenance = exactObject(raw.provenance, 'evidence.provenance', ['method', 'artifacts', 'parameters', 'citations', 'scopeWarning'])
  const provenance: ZatomPeriodicDislocationRelaxationSeriesEvidence['provenance'] = {
    method: text(rawProvenance.method, 'evidence.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts, expectedArtifacts),
    parameters: jsonRecord(rawProvenance.parameters, 'evidence.provenance.parameters'),
    citations: uniqueTexts(rawProvenance.citations, 'evidence.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'evidence.provenance.scopeWarning'),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (raw.metadata !== undefined) {
    if (utf8Bytes(raw.metadata) > maxMetadataBytes) throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_budget_exceeded', 'metadata exceeds maxMetadataBytes')
    metadata = jsonRecord(raw.metadata, 'evidence.metadata')
  }
  const evidence: ZatomPeriodicDislocationRelaxationSeriesEvidence = {
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA,
    kind,
    commonFingerprint: fingerprintCanonicalJson(common),
    cases: summaries,
    selection,
    acceptance,
    metrics: {
      caseCount: summaries.length,
      allCasesAccepted,
      minimumSampledExcessEnergyEvPerA: minimumEnergy,
      maximumSampledExcessEnergyEvPerA: maximumEnergy,
      sampledExcessEnergySpreadEvPerA: maximumEnergy - minimumEnergy,
      selectedExcessEnergyEvPerA: summaries[selectedIndex].excessPotentialEnergyPerTotalLineLengthEvPerA,
      selectedGapToNextBestEvPerA,
      largestPairCaseIds,
      largestPairExcessEnergyDriftEvPerA,
      largestPairCoreAnchorRmsDriftA,
      largestPairStressDifferenceDriftBar,
      acceptancePassed,
    },
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const checks: ValidationCheck[] = [
    {
      id: 'periodic_dislocation_relaxation_series.common_identity',
      status: 'pass',
      message: `All ${summaries.length} cases share exact source, elasticity, crystallography, Atomman runtime/image protocol/gates, line repeat, and LAMMPS executable/potential/provider/parameter identity`,
      metrics: { commonFingerprint: evidence.commonFingerprint, caseCount: summaries.length },
    },
    {
      id: 'periodic_dislocation_relaxation_series.case_acceptance',
      status: allCasesAccepted ? 'pass' : 'fail',
      message: allCasesAccepted ? 'Every matched relaxation-pair artifact passes its own gates' : 'At least one matched relaxation-pair artifact fails its own gates',
      metrics: { acceptedCaseCount: summaries.filter((item) => item.acceptancePassed).length, caseCount: summaries.length },
    },
    {
      id: 'periodic_dislocation_relaxation_series.design',
      status: countGate ? 'pass' : 'fail',
      message: kind === 'shift-scan-at-fixed-cell'
        ? `Compared ${summaries.length} unique sampled shift indices in one exact fixed cell; this does not claim complete shift enumeration`
        : `Compared ${summaries.length} strictly increasing transverse cell areas at fixed shift index ${summaries[0].shiftIndex}`,
      metrics: { kind, caseCount: summaries.length, minimumCaseCount: acceptance.minimumCaseCount },
    },
    {
      id: 'periodic_dislocation_relaxation_series.selection',
      status: 'pass',
      message: `Selected ${selection.selectedCaseId} by ${selection.method}: ${selection.rationale}`,
      metrics: { selectedCaseId: selection.selectedCaseId, selectedExcessEnergyEvPerA: evidence.metrics.selectedExcessEnergyEvPerA },
    },
    {
      id: 'periodic_dislocation_relaxation_series.sampled_shift_ranking',
      status: kind === 'shift-scan-at-fixed-cell' ? 'pass' : 'skipped',
      message: kind === 'shift-scan-at-fixed-cell'
        ? `Sampled shift energy spread is ${evidence.metrics.sampledExcessEnergySpreadEvPerA.toPrecision(7)} eV/Å; unsampled shifts may still be lower`
        : 'This is a fixed-shift cell-size series, not a shift scan',
      metrics: { sampledExcessEnergySpreadEvPerA: evidence.metrics.sampledExcessEnergySpreadEvPerA },
    },
    {
      id: 'periodic_dislocation_relaxation_series.finite_cell_observable_stability',
      status: kind === 'cell-size-at-fixed-shift' ? sizeGatesPassed ? 'pass' : 'fail' : 'skipped',
      message: kind === 'cell-size-at-fixed-shift'
        ? `Largest-two sampled cells drift by ${largestPairExcessEnergyDriftEvPerA!.toPrecision(7)} eV/Å in matched excess, ${largestPairCoreAnchorRmsDriftA!.toPrecision(7)} Å in core-anchor RMS, and ${largestPairStressDifferenceDriftBar!.toPrecision(7)} bar as the maximum componentwise change across all six positive-compression pressure-tensor differences`
        : 'Finite-cell stability requires a separate fixed-shift, increasing-cell series',
      metrics: {
        largestPairExcessEnergyDriftEvPerA: largestPairExcessEnergyDriftEvPerA ?? 'not-applicable',
        largestPairCoreAnchorRmsDriftA: largestPairCoreAnchorRmsDriftA ?? 'not-applicable',
        largestPairStressDifferenceDriftBar: largestPairStressDifferenceDriftBar ?? 'not-applicable',
      },
    },
    {
      id: 'periodic_dislocation_relaxation_series.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} A sampled shift ranking is not complete shift enumeration. Stability of the largest two sampled finite cells is not an isolated-core energy, continuum elastic-image correction, mathematical infinite-size limit, phase/free-energy result, barrier, mobility, or independent validation of the potential.`,
    },
  ]
  const selectedParsed = parsedCases.find((item) => item.id === selection.selectedCaseId)!
  const selectedStructure = parseZatomStructure(selectedParsed.context.relaxedDefectStructure)
  const inspectionTargets: InspectionTarget[] = [
    ...selectedParsed.validation.inspectionTargets.map((target) => ({
      ...target,
      id: `series-selected-${target.id}`,
      reason: `Selected case ${selection.selectedCaseId}: ${target.reason}`,
    })),
  ]
  return {
    evidence,
    selectedStructure,
    selectedPairValidation: selectedParsed.validation,
    fingerprint: fingerprintPeriodicDislocationRelaxationSeries(evidence),
    checks,
    inspectionTargets,
  }
}

export function parseZatomPeriodicDislocationRelaxationSeries(
  value: unknown,
  options: ParseZatomPeriodicDislocationRelaxationSeriesOptions,
): ZatomPeriodicDislocationRelaxationSeriesValidation {
  if (utf8Bytes(value) > positiveBudget(options.maxArtifactBytes, 8 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError('periodic_dislocation_relaxation_series_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const validation = buildValidation(value, options)
  if (canonicalJsonIdentity(value) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomPeriodicDislocationRelaxationSeriesInputError(
      'periodic_dislocation_relaxation_series_derived_mismatch',
      'Series differs from canonical case-bound common identity, ordering, selection, metrics, or provenance',
    )
  }
  return validation
}

export function composeZatomPeriodicDislocationRelaxationSeries(
  input: ComposeZatomPeriodicDislocationRelaxationSeriesInput,
): ZatomPeriodicDislocationRelaxationSeriesValidation {
  return buildValidation({
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_RELAXATION_SERIES_SCHEMA,
    kind: input.kind,
    commonFingerprint: '',
    cases: [],
    selection: input.selection,
    acceptance: input.acceptance,
    metrics: {},
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, { cases: input.cases })
}
