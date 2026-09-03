/** Canonical, structure-bound molecular chemical-state candidate ensemble. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import { boundsOfPositions, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA = 'zatom.chemical-state-ensemble/v1' as const

export type ZatomChemicalStateEnumerationKind =
  | 'tautomer'
  | 'protonation'
  | 'tautomer-protonation'
  | 'stereoisomer'
  | 'custom'

export interface ZatomChemicalStateRecord {
  id: string
  canonicalIsomericSmiles: string
  formula: string
  formalCharge: number
  atomCount: number
  bondCount: number
  heavyAtomCount: number
  explicitHydrogenCount: number
  assignedStereocenterCount: number
  unassignedStereocenterCount: number
  annotations?: Record<string, JsonValue>
}

export interface ZatomChemicalStatePopulationModel {
  method: string
  conditions: {
    pH: number
    temperatureK?: number
    solvent?: string
    ionicStrengthMolar?: number
  }
  populations: Array<{ stateId: string; fraction: number }>
  normalizationScope?: {
    kind: 'complete-state-universe' | 'conditional-on-returned-states'
    stateCoverageFingerprint?: string
    totalOmittedFractionUpperBound?: number
  }
  citations: string[]
  scopeWarning: string
}

export interface ZatomChemicalStateEnsemble {
  schemaVersion: typeof ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA
  selectedStructureFingerprint: string
  enumeration: {
    kind: ZatomChemicalStateEnumerationKind
    complete: boolean
    status: string
  }
  source: {
    canonicalIsomericSmiles: string
    formula: string
    formalCharge: number
  }
  normalized: {
    canonicalIsomericSmiles: string
    formula: string
    formalCharge: number
    method: string
  }
  states: ZatomChemicalStateRecord[]
  selection: {
    selectedStateId: string
    selectedStateIndex: number
    canonicalStateId?: string
    canonicalStateIndex?: number
    method: 'canonical-rule' | 'stable-index' | 'maximum-population' | 'explicit'
    rationale: string
  }
  populationModel?: ZatomChemicalStatePopulationModel
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

export interface ZatomChemicalStateEnsembleValidation {
  ensemble: ZatomChemicalStateEnsemble
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export interface ParseZatomChemicalStateEnsembleOptions {
  structure: ZatomStructure
  maxStates?: number
  maxMetadataBytes?: number
  maxTotalSmilesBytes?: number
}

export class ZatomChemicalStateEnsembleInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomChemicalStateEnsembleInputError'
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
    throw new ZatomChemicalStateEnsembleInputError('invalid_chemical_state_ensemble', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomChemicalStateEnsembleInputError('invalid_chemical_state_ensemble', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomChemicalStateEnsembleInputError('invalid_chemical_state_ensemble', `${field} is not JSON-safe`)
}

function citations(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `${field} must contain 1-32 references`,
    )
  }
  const parsed = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(parsed).size !== parsed.length) {
    throw new ZatomChemicalStateEnsembleInputError('invalid_chemical_state_ensemble', `${field} must not repeat references`)
  }
  return parsed.sort(compareText)
}


export function fingerprintChemicalStateEnsemble(value: ZatomChemicalStateEnsemble): string {
  return fingerprintCanonicalJson(value)
}

function parseStateSummary(value: unknown, field: string, optional: readonly string[] = []): Pick<
  ZatomChemicalStateEnsemble['source'],
  'canonicalIsomericSmiles' | 'formula' | 'formalCharge'
> {
  const record = exactObject(value, field, ['canonicalIsomericSmiles', 'formula', 'formalCharge'], optional)
  return {
    canonicalIsomericSmiles: text(record.canonicalIsomericSmiles, `${field}.canonicalIsomericSmiles`, 10_000),
    formula: text(record.formula, `${field}.formula`, 256),
    formalCharge: integer(record.formalCharge, `${field}.formalCharge`, -10_000, 10_000),
  }
}

function hillFormula(structure: ZatomStructure, formalCharge: number): string {
  const counts = new Map<string, number>()
  for (const atom of structure.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
  const elements = [...counts.keys()].sort((left, right) => {
    const hasCarbon = counts.has('C')
    if (hasCarbon) {
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
  const sign = formalCharge > 0 ? '+' : '-'
  const magnitude = Math.abs(formalCharge)
  return `${base}${sign}${magnitude === 1 ? '' : magnitude}`
}

export function parseZatomChemicalStateEnsemble(
  value: unknown,
  options: ParseZatomChemicalStateEnsembleOptions,
): ZatomChemicalStateEnsembleValidation {
  const structure = parseZatomStructure(options.structure)
  if (structure.lattice) {
    throw new ZatomChemicalStateEnsembleInputError(
      'unsupported_chemical_state_structure',
      'Chemical-state ensemble v1 binds one finite molecular structure without a lattice',
    )
  }
  if (structure.bonds === undefined) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_topology_required',
      'Chemical-state ensemble validation requires an explicit bonds array',
    )
  }
  const maxStates = options.maxStates ?? 512
  const maxMetadataBytes = options.maxMetadataBytes ?? 1024 * 1024
  const maxTotalSmilesBytes = options.maxTotalSmilesBytes ?? 5 * 1024 * 1024
  if (![maxStates, maxMetadataBytes, maxTotalSmilesBytes].every((item) => Number.isSafeInteger(item) && item > 0)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble_budget',
      'Chemical-state parser budgets must be positive safe integers',
    )
  }

  const root = exactObject(value, 'ensemble', [
    'schemaVersion',
    'selectedStructureFingerprint',
    'enumeration',
    'source',
    'normalized',
    'states',
    'selection',
    'provenance',
  ], ['populationModel', 'metadata'])
  if (root.schemaVersion !== ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      `ensemble.schemaVersion must be ${ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA}`,
    )
  }
  const selectedStructureFingerprint = text(
    root.selectedStructureFingerprint,
    'ensemble.selectedStructureFingerprint',
    128,
  )
  const observedStructureFingerprint = fingerprintStructure(structure)
  if (selectedStructureFingerprint !== observedStructureFingerprint) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_ensemble_structure_mismatch',
      'ensemble.selectedStructureFingerprint does not match the exact selected structure',
    )
  }

  const rawEnumeration = exactObject(root.enumeration, 'ensemble.enumeration', ['kind', 'complete', 'status'])
  const kinds = new Set<ZatomChemicalStateEnumerationKind>([
    'tautomer',
    'protonation',
    'tautomer-protonation',
    'stereoisomer',
    'custom',
  ])
  if (!kinds.has(rawEnumeration.kind as ZatomChemicalStateEnumerationKind) || typeof rawEnumeration.complete !== 'boolean') {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      'ensemble.enumeration requires a supported kind and explicit complete boolean',
    )
  }
  const enumeration: ZatomChemicalStateEnsemble['enumeration'] = {
    kind: rawEnumeration.kind as ZatomChemicalStateEnumerationKind,
    complete: rawEnumeration.complete,
    status: text(rawEnumeration.status, 'ensemble.enumeration.status', 256),
  }
  const source = parseStateSummary(root.source, 'ensemble.source')
  const rawNormalized = exactObject(
    root.normalized,
    'ensemble.normalized',
    ['canonicalIsomericSmiles', 'formula', 'formalCharge', 'method'],
  )
  const normalized = {
    ...parseStateSummary(rawNormalized, 'ensemble.normalized', ['method']),
    method: text(rawNormalized.method, 'ensemble.normalized.method', 512),
  }

  if (!Array.isArray(root.states) || !root.states.length || root.states.length > maxStates) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_ensemble_budget_exceeded',
      `ensemble.states must contain 1-${maxStates} candidates`,
    )
  }
  const states = root.states.map((raw, index): ZatomChemicalStateRecord => {
    const field = `ensemble.states[${index}]`
    const record = exactObject(raw, field, [
      'id',
      'canonicalIsomericSmiles',
      'formula',
      'formalCharge',
      'atomCount',
      'bondCount',
      'heavyAtomCount',
      'explicitHydrogenCount',
      'assignedStereocenterCount',
      'unassignedStereocenterCount',
    ], ['annotations'])
    const atomCount = integer(record.atomCount, `${field}.atomCount`, 1, 1_000_000)
    const heavyAtomCount = integer(record.heavyAtomCount, `${field}.heavyAtomCount`, 0, atomCount)
    const explicitHydrogenCount = integer(
      record.explicitHydrogenCount,
      `${field}.explicitHydrogenCount`,
      0,
      atomCount,
    )
    if (heavyAtomCount + explicitHydrogenCount !== atomCount) {
      throw new ZatomChemicalStateEnsembleInputError(
        'invalid_chemical_state_ensemble',
        `${field} heavyAtomCount + explicitHydrogenCount must equal atomCount`,
      )
    }
    let annotations: Record<string, JsonValue> | undefined
    if (record.annotations !== undefined) {
      if (!isRecord(record.annotations)) {
        throw new ZatomChemicalStateEnsembleInputError(
          'invalid_chemical_state_ensemble',
          `${field}.annotations must be an object`,
        )
      }
      annotations = jsonValue(record.annotations, `${field}.annotations`) as Record<string, JsonValue>
    }
    const assignedStereocenterCount = integer(
      record.assignedStereocenterCount,
      `${field}.assignedStereocenterCount`,
      0,
      atomCount,
    )
    const unassignedStereocenterCount = integer(
      record.unassignedStereocenterCount,
      `${field}.unassignedStereocenterCount`,
      0,
      atomCount,
    )
    if (assignedStereocenterCount + unassignedStereocenterCount > atomCount) {
      throw new ZatomChemicalStateEnsembleInputError(
        'invalid_chemical_state_ensemble',
        `${field} assigned plus unassigned stereocenters cannot exceed atomCount`,
      )
    }
    return {
      id: token(record.id, `${field}.id`),
      canonicalIsomericSmiles: text(record.canonicalIsomericSmiles, `${field}.canonicalIsomericSmiles`, 10_000),
      formula: text(record.formula, `${field}.formula`, 256),
      formalCharge: integer(record.formalCharge, `${field}.formalCharge`, -10_000, 10_000),
      atomCount,
      bondCount: integer(record.bondCount, `${field}.bondCount`, 0, 5_000_000),
      heavyAtomCount,
      explicitHydrogenCount,
      assignedStereocenterCount,
      unassignedStereocenterCount,
      ...(annotations ? { annotations } : {}),
    }
  }).sort((left, right) => (
    compareText(left.canonicalIsomericSmiles, right.canonicalIsomericSmiles)
    || compareText(left.id, right.id)
  ))
  if (new Set(states.map((state) => state.id)).size !== states.length) {
    throw new ZatomChemicalStateEnsembleInputError('invalid_chemical_state_ensemble', 'State IDs must be unique')
  }
  if (new Set(states.map((state) => state.canonicalIsomericSmiles)).size !== states.length) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      'canonicalIsomericSmiles must deduplicate the state ensemble',
    )
  }
  const totalSmilesBytes = new TextEncoder().encode(states.map((state) => state.canonicalIsomericSmiles).join('\0')).length
  if (totalSmilesBytes > maxTotalSmilesBytes) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_ensemble_budget_exceeded',
      `Canonical state SMILES exceed ${maxTotalSmilesBytes} bytes`,
    )
  }
  const stateById = new Map(states.map((state) => [state.id, state]))
  if (new Set(states.map((state) => state.heavyAtomCount)).size !== 1) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_heavy_atom_mismatch',
      'Every chemical-state candidate must preserve the heavy-atom count',
    )
  }

  const rawSelection = exactObject(
    root.selection,
    'ensemble.selection',
    ['selectedStateId', 'selectedStateIndex', 'method', 'rationale'],
    ['canonicalStateId', 'canonicalStateIndex'],
  )
  const selectionMethods = new Set(['canonical-rule', 'stable-index', 'maximum-population', 'explicit'])
  if (!selectionMethods.has(String(rawSelection.method))) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      'ensemble.selection.method is unsupported',
    )
  }
  const selectedStateId = token(rawSelection.selectedStateId, 'ensemble.selection.selectedStateId')
  const selectedStateIndex = integer(
    rawSelection.selectedStateIndex,
    'ensemble.selection.selectedStateIndex',
    0,
    states.length - 1,
  )
  if (!stateById.has(selectedStateId)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'ensemble.selection.selectedStateId is absent from states',
    )
  }
  if (states[selectedStateIndex].id !== selectedStateId) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'ensemble.selection.selectedStateIndex does not point to selectedStateId in canonical state order',
    )
  }
  const canonicalStateId = rawSelection.canonicalStateId === undefined
    ? undefined
    : token(rawSelection.canonicalStateId, 'ensemble.selection.canonicalStateId')
  if (canonicalStateId !== undefined && !stateById.has(canonicalStateId)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'ensemble.selection.canonicalStateId is absent from states',
    )
  }
  const canonicalStateIndex = rawSelection.canonicalStateIndex === undefined
    ? undefined
    : integer(
        rawSelection.canonicalStateIndex,
        'ensemble.selection.canonicalStateIndex',
        0,
        states.length - 1,
      )
  if ((canonicalStateId === undefined) !== (canonicalStateIndex === undefined)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'canonicalStateId and canonicalStateIndex must either both be supplied or both be omitted',
    )
  }
  if (canonicalStateIndex !== undefined && states[canonicalStateIndex].id !== canonicalStateId) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'ensemble.selection.canonicalStateIndex does not point to canonicalStateId in canonical state order',
    )
  }
  if (rawSelection.method === 'canonical-rule' && (
    canonicalStateId === undefined || canonicalStateId !== selectedStateId
  )) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selection_mismatch',
      'canonical-rule selection must select the declared canonicalStateId',
    )
  }
  const selection: ZatomChemicalStateEnsemble['selection'] = {
    selectedStateId,
    selectedStateIndex,
    ...(canonicalStateId ? { canonicalStateId } : {}),
    ...(canonicalStateIndex !== undefined ? { canonicalStateIndex } : {}),
    method: rawSelection.method as ZatomChemicalStateEnsemble['selection']['method'],
    rationale: text(rawSelection.rationale, 'ensemble.selection.rationale', 2048),
  }

  let populationModel: ZatomChemicalStatePopulationModel | undefined
  if (root.populationModel !== undefined) {
    const rawPopulation = exactObject(root.populationModel, 'ensemble.populationModel', [
      'method', 'conditions', 'populations', 'citations', 'scopeWarning',
    ], ['normalizationScope'])
    const rawConditions = exactObject(
      rawPopulation.conditions,
      'ensemble.populationModel.conditions',
      ['pH'],
      ['temperatureK', 'solvent', 'ionicStrengthMolar'],
    )
    if (!Array.isArray(rawPopulation.populations) || rawPopulation.populations.length !== states.length) {
      throw new ZatomChemicalStateEnsembleInputError(
        'chemical_state_population_mismatch',
        'populationModel.populations must cover every state exactly once',
      )
    }
    const populations = rawPopulation.populations.map((raw, index) => {
      const record = exactObject(raw, `ensemble.populationModel.populations[${index}]`, ['stateId', 'fraction'])
      return {
        stateId: token(record.stateId, `ensemble.populationModel.populations[${index}].stateId`),
        fraction: numberIn(record.fraction, `ensemble.populationModel.populations[${index}].fraction`, 0, 1),
      }
    }).sort((left, right) => (
      states.findIndex((state) => state.id === left.stateId)
      - states.findIndex((state) => state.id === right.stateId)
    ))
    if (new Set(populations.map((entry) => entry.stateId)).size !== populations.length
      || populations.some((entry) => !stateById.has(entry.stateId))) {
      throw new ZatomChemicalStateEnsembleInputError(
        'chemical_state_population_mismatch',
        'populationModel must reference each ensemble state exactly once',
      )
    }
    const populationSum = populations.reduce((sum, entry) => sum + entry.fraction, 0)
    if (Math.abs(populationSum - 1) > 1e-8) {
      throw new ZatomChemicalStateEnsembleInputError(
        'chemical_state_population_mismatch',
        `populationModel fractions sum to ${populationSum}, not 1`,
      )
    }
    const conditions: ZatomChemicalStatePopulationModel['conditions'] = {
      pH: numberIn(rawConditions.pH, 'ensemble.populationModel.conditions.pH', 0, 14),
      ...(rawConditions.temperatureK === undefined ? {} : {
        temperatureK: numberIn(
          rawConditions.temperatureK,
          'ensemble.populationModel.conditions.temperatureK',
          0.01,
          1_000_000,
        ),
      }),
      ...(rawConditions.solvent === undefined ? {} : {
        solvent: text(rawConditions.solvent, 'ensemble.populationModel.conditions.solvent', 256),
      }),
      ...(rawConditions.ionicStrengthMolar === undefined ? {} : {
        ionicStrengthMolar: numberIn(
          rawConditions.ionicStrengthMolar,
          'ensemble.populationModel.conditions.ionicStrengthMolar',
          0,
          100,
        ),
      }),
    }
    let normalizationScope: ZatomChemicalStatePopulationModel['normalizationScope']
    if (rawPopulation.normalizationScope !== undefined) {
      const rawScope = exactObject(
        rawPopulation.normalizationScope,
        'ensemble.populationModel.normalizationScope',
        ['kind'],
        ['stateCoverageFingerprint', 'totalOmittedFractionUpperBound'],
      )
      if (rawScope.kind !== 'complete-state-universe' && rawScope.kind !== 'conditional-on-returned-states') {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_population_mismatch',
          'populationModel.normalizationScope.kind is unsupported',
        )
      }
      const totalOmittedFractionUpperBound = rawScope.totalOmittedFractionUpperBound === undefined
        ? undefined
        : numberIn(
            rawScope.totalOmittedFractionUpperBound,
            'ensemble.populationModel.normalizationScope.totalOmittedFractionUpperBound',
            0,
            1,
          )
      if (rawScope.kind === 'complete-state-universe' && totalOmittedFractionUpperBound !== undefined) {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_population_mismatch',
          'complete-state-universe normalization must not declare an omitted-fraction bound',
        )
      }
      if (totalOmittedFractionUpperBound === 1) {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_population_mismatch',
          'A total omitted-fraction upper bound of one is non-informative and must be represented as unknown',
        )
      }
      normalizationScope = {
        kind: rawScope.kind,
        ...(rawScope.stateCoverageFingerprint === undefined ? {} : {
          stateCoverageFingerprint: text(
            rawScope.stateCoverageFingerprint,
            'ensemble.populationModel.normalizationScope.stateCoverageFingerprint',
            128,
          ),
        }),
        ...(totalOmittedFractionUpperBound === undefined ? {} : { totalOmittedFractionUpperBound }),
      }
      if (normalizationScope.kind === 'complete-state-universe' && !enumeration.complete) {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_population_scope_mismatch',
          'An incomplete chemical-state enumeration cannot claim complete-state-universe population normalization',
        )
      }
    }
    populationModel = {
      method: text(rawPopulation.method, 'ensemble.populationModel.method', 512),
      conditions,
      populations,
      ...(normalizationScope ? { normalizationScope } : {}),
      citations: citations(rawPopulation.citations, 'ensemble.populationModel.citations'),
      scopeWarning: text(rawPopulation.scopeWarning, 'ensemble.populationModel.scopeWarning', 4096),
    }
    if (selection.method === 'maximum-population') {
      const selectedFraction = populations.find((entry) => entry.stateId === selectedStateId)!.fraction
      const maximumFraction = Math.max(...populations.map((entry) => entry.fraction))
      if (selectedFraction + 1e-12 < maximumFraction) {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_selection_mismatch',
          'maximum-population selection did not select a maximum-population state',
        )
      }
    }
  } else if (selection.method === 'maximum-population') {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_population_required',
      'maximum-population selection requires populationModel evidence',
    )
  }

  const rawProvenance = exactObject(root.provenance, 'ensemble.provenance', [
    'engine', 'engineVersion', 'method', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!isRecord(rawProvenance.parameters)) {
    throw new ZatomChemicalStateEnsembleInputError(
      'invalid_chemical_state_ensemble',
      'ensemble.provenance.parameters must be an object',
    )
  }
  const provenance: ZatomChemicalStateEnsemble['provenance'] = {
    engine: text(rawProvenance.engine, 'ensemble.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'ensemble.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'ensemble.provenance.method', 1024),
    parameters: jsonValue(rawProvenance.parameters, 'ensemble.provenance.parameters') as Record<string, JsonValue>,
    citations: citations(rawProvenance.citations, 'ensemble.provenance.citations'),
    scopeWarning: text(rawProvenance.scopeWarning, 'ensemble.provenance.scopeWarning', 4096),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomChemicalStateEnsembleInputError(
        'invalid_chemical_state_ensemble',
        'ensemble.metadata must be an object',
      )
    }
    metadata = jsonValue(root.metadata, 'ensemble.metadata') as Record<string, JsonValue>
  }
  const boundedJson = { provenanceParameters: provenance.parameters, metadata, states: states.map((state) => state.annotations) }
  if (new TextEncoder().encode(JSON.stringify(boundedJson)).length > maxMetadataBytes) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_ensemble_budget_exceeded',
      `Ensemble metadata and annotations exceed ${maxMetadataBytes} bytes`,
    )
  }

  const selectedState = stateById.get(selectedStateId)!
  const atomCount = structure.atoms.length
  const bondCount = structure.bonds.length
  const explicitHydrogenCount = structure.atoms.filter((atom) => atom.element === 'H').length
  const heavyAtomCount = atomCount - explicitHydrogenCount
  const formalCharges = structure.atoms.map((atom) => atom.properties?.formalCharge)
  if (!formalCharges.every((charge) => typeof charge === 'number' && Number.isSafeInteger(charge))) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_structure_charge_incomplete',
      'Selected structure must carry a complete integer formalCharge on every atom',
    )
  }
  const formalCharge = formalCharges.reduce<number>((sum, charge) => sum + Number(charge), 0)
  const observedFormula = hillFormula(structure, formalCharge)
  if (
    selectedState.atomCount !== atomCount
    || selectedState.bondCount !== bondCount
    || selectedState.explicitHydrogenCount !== explicitHydrogenCount
    || selectedState.heavyAtomCount !== heavyAtomCount
    || selectedState.formalCharge !== formalCharge
    || selectedState.formula !== observedFormula
  ) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selected_structure_mismatch',
      'Selected state formula, atom/bond/hydrogen/heavy-atom counts, or formal charge differ from the bound structure',
    )
  }
  const expectedMetadata: Array<[string, unknown]> = [
    ['zatom.chemical.stateId', selectedState.id],
    ['zatom.chemical.canonicalIsomericSmiles', selectedState.canonicalIsomericSmiles],
    ['zatom.chemical.formula', selectedState.formula],
    ['zatom.chemical.formalCharge', selectedState.formalCharge],
    ['zatom.chemical.enumerationKind', enumeration.kind],
  ]
  const metadataMismatches = expectedMetadata.filter(([key, expected]) => structure.metadata?.[key] !== expected)
  if (metadataMismatches.length) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_selected_structure_mismatch',
      `Selected structure metadata differs for ${metadataMismatches.map(([key]) => key).join(', ')}`,
    )
  }

  const invariantKinds = new Set<ZatomChemicalStateEnumerationKind>(['tautomer', 'stereoisomer'])
  const invariantsPreserved = states.every((state) => (
    state.formula === normalized.formula && state.formalCharge === normalized.formalCharge
  ))
  if (invariantKinds.has(enumeration.kind) && !invariantsPreserved) {
    throw new ZatomChemicalStateEnsembleInputError(
      'chemical_state_invariant_mismatch',
      `${enumeration.kind} enumeration must preserve normalized formula and formal charge`,
    )
  }

  const ensemble: ZatomChemicalStateEnsemble = {
    schemaVersion: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
    selectedStructureFingerprint,
    enumeration,
    source,
    normalized,
    states,
    selection,
    ...(populationModel ? { populationModel } : {}),
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintChemicalStateEnsemble(ensemble)
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const effectivePopulationNormalizationScope = populationModel
    ? populationModel.normalizationScope?.kind
      ?? (enumeration.complete ? 'complete-state-universe' : 'conditional-on-returned-states')
    : undefined
  const checks: ValidationCheck[] = [
    {
      id: 'chemical_state_ensemble.identity',
      status: 'pass',
      message: `Ensemble ${fingerprint} is bound to the exact selected structure and state ${selectedStateId}`,
      metrics: { fingerprint, selectedStateId, selectedStateIndex, stateCount: states.length },
    },
    {
      id: 'chemical_state_ensemble.enumeration',
      status: enumeration.complete ? 'pass' : 'warn',
      message: enumeration.complete
        ? `${enumeration.kind} enumeration reports completion with ${states.length} unique state(s)`
        : `${enumeration.kind} enumeration stopped with status ${enumeration.status}; omitted states may exist`,
      metrics: { kind: enumeration.kind, complete: enumeration.complete, status: enumeration.status },
    },
    {
      id: 'chemical_state_ensemble.deduplication',
      status: 'pass',
      message: 'State IDs and canonical isomeric SMILES are unique under the declared enumeration',
      metrics: { stateCount: states.length },
    },
    {
      id: 'chemical_state_ensemble.selected_structure',
      status: 'pass',
      message: 'Selected structure fingerprint, standardized chemical metadata, topology counts, and formal charge match the selected state',
      metrics: { atomCount, bondCount, heavyAtomCount, explicitHydrogenCount, formalCharge, formula: observedFormula },
    },
    {
      id: 'chemical_state_ensemble.invariants',
      status: invariantKinds.has(enumeration.kind) ? 'pass' : 'skipped',
      message: invariantKinds.has(enumeration.kind)
        ? 'Every state preserves the normalized formula and formal charge required by this enumeration kind'
        : 'Formula/charge invariance is not imposed on protonation-capable enumeration kinds',
    },
    {
      id: 'chemical_state_ensemble.population',
      status: populationModel ? 'pass' : 'skipped',
      message: populationModel
        ? `Population fractions cover every returned state and sum to one at pH ${populationModel.conditions.pH}; normalization scope is ${populationModel.normalizationScope?.kind ?? 'unspecified'}`
        : 'No pH/population model was claimed by this ensemble',
      ...(populationModel ? {
        metrics: {
          pH: populationModel.conditions.pH,
          stateCount: populationModel.populations.length,
          normalizationScope: populationModel.normalizationScope?.kind ?? 'unspecified',
        },
      } : {}),
    },
    {
      id: 'chemical_state_ensemble.population_scope',
      status: populationModel === undefined
        ? 'skipped'
        : effectivePopulationNormalizationScope === 'complete-state-universe' ? 'pass' : 'warn',
      message: populationModel === undefined
        ? 'No chemical-state population normalization scope is needed without a population model'
        : effectivePopulationNormalizationScope === 'complete-state-universe'
          ? `Population normalization covers the producer-declared complete enumerated state universe${populationModel.normalizationScope ? '' : ' (inferred from completed enumeration)'}`
          : `Population normalization is conditional on returned states${populationModel.normalizationScope ? '' : ' (inferred from incomplete enumeration)'}; omitted-state mass is not represented by these fractions`,
      ...(effectivePopulationNormalizationScope ? {
        metrics: {
          normalizationScope: effectivePopulationNormalizationScope,
          enumerationComplete: enumeration.complete,
          scopeExplicit: populationModel?.normalizationScope !== undefined,
        },
      } : {}),
    },
    {
      id: 'chemical_state_ensemble.provenance',
      status: 'pass',
      message: `Enumeration records ${provenance.engine} ${provenance.engineVersion}, method, parameters, citations, and scope`,
      metrics: { citationCount: provenance.citations.length },
    },
    {
      id: 'chemical_state_ensemble.model_scope',
      status: 'warn',
      message: provenance.scopeWarning,
      metrics: { hasPopulationModel: populationModel !== undefined },
    },
  ]
  const atomIds = structure.atoms.map((atom) => atom.id)
  const inspectionTargets: InspectionTarget[] = bounds ? [{
    id: 'chemical-state-selected-structure',
    reason: `Inspect the explicit structure selected as ${selectedStateId} from ${states.length} chemical-state candidate(s)`,
    center: bounds.center,
    radius: Math.max(1.5, bounds.radius + 0.5),
    atomIds: atomIds.slice(0, 80),
    ...(atomIds.length > 80 ? { atomIdsTruncated: true } : {}),
  }] : []
  return { ensemble, fingerprint, checks, inspectionTargets }
}
