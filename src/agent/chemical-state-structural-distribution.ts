/** Joint chemical-state identity and conditional fixed-topology structural distributions. */

import type {
  InspectionTarget,
  JsonValue,
  ValidationCheck,
  ZatomStructure,
} from './contracts'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsembleValidation,
  type ZatomChemicalStatePopulationModel,
  type ZatomChemicalStateRecord,
} from './chemical-state-ensemble'
import {
  parseZatomStructureEnsemble,
  type ZatomStructureEnsemble,
  type ZatomStructureEnsembleValidation,
} from './structure-ensemble'
import { boundsOfPositions, canonicalJsonIdentity, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA =
  'zatom.chemical-state-structural-distribution/v1' as const

export interface ZatomChemicalStateStructuralDistributionEntry {
  stateId: string
  structureEnsembleFingerprint: string
  structureEnsemble: ZatomStructureEnsemble
}

export interface ZatomChemicalStateStructuralDistribution {
  schemaVersion: typeof ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA
  chemicalStateEnsembleFingerprint: string
  /** Shared conditions for both state marginals and every state-conditioned structure distribution. */
  conditions: ZatomChemicalStatePopulationModel['conditions']
  /** Stable heavy-atom correspondence required across every chemical identity and conformer. */
  heavyAtomIds: string[]
  stateStructureEnsembles: ZatomChemicalStateStructuralDistributionEntry[]
  acceptance: {
    minimumJointWeightEffectiveMemberCount: number
  }
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

export interface ParseZatomChemicalStateStructuralDistributionOptions {
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  /** Exact structure to which the chemical-state identity artifact is bound before structural sampling. */
  chemicalStateReferenceStructure: ZatomStructure
  /** Exact selected joint-distribution member, which may differ geometrically from the reference. */
  selectedStructure: ZatomStructure
  maxJointMembers?: number
  maxMemberAtoms?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

/** Fingerprint-free source artifacts accepted by the deterministic composition helper. */
export interface ZatomChemicalStateStructuralDistributionComposition {
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  heavyAtomIds: string[]
  stateStructureEnsembles: Array<{
    stateId: string
    structureEnsemble: ZatomStructureEnsemble
  }>
  acceptance: ZatomChemicalStateStructuralDistribution['acceptance']
  provenance: ZatomChemicalStateStructuralDistribution['provenance']
  metadata?: Record<string, JsonValue>
}

export type ComposeZatomChemicalStateStructuralDistributionOptions =
  Omit<ParseZatomChemicalStateStructuralDistributionOptions, 'chemicalStateEnsemble'>

export interface ZatomChemicalStateStructuralJointMember {
  stateId: string
  memberId: string
  stateFraction: number
  conditionalStructureWeight: number
  jointWeight: number
  structureFingerprint: string
  topologyFingerprint: string
}

export interface ZatomChemicalStateStructuralDistributionValidation {
  distribution: ZatomChemicalStateStructuralDistribution
  fingerprint: string
  chemicalStateEnsembleValidation: ZatomChemicalStateEnsembleValidation
  stateStructureEnsembleValidations: Array<{
    stateId: string
    validation: ZatomStructureEnsembleValidation
  }>
  jointMembers: ZatomChemicalStateStructuralJointMember[]
  jointWeightEffectiveMemberCount: number
  identityVariableHeavyAtomIds: string[]
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomChemicalStateStructuralDistributionInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomChemicalStateStructuralDistributionInputError'
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
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function positiveSafeInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution_context',
      `${field} must be a positive safe integer`,
    )
  }
  return result
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 64,
  maximumTextLength = 4096,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'invalid_chemical_state_structural_distribution',
        `${field} must contain finite JSON numbers`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomChemicalStateStructuralDistributionInputError(
    'invalid_chemical_state_structural_distribution',
    `${field} must be JSON-safe`,
  )
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must be an object`,
    )
  }
  return jsonValue(value, field) as Record<string, JsonValue>
}

function parseArtifacts(value: unknown, field: string): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} must contain 1-64 entries`,
    )
  }
  const artifacts = value.map((raw, index) => {
    const itemField = `${field}[${index}]`
    const record = exactObject(raw, itemField, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${itemField}.id`),
      role: text(record.role, `${itemField}.role`, 1024),
      fingerprint: text(record.fingerprint, `${itemField}.fingerprint`, 256),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(artifacts.map((artifact) => artifact.id)).size !== artifacts.length) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} IDs must be unique`,
    )
  }
  return artifacts
}


export function fingerprintChemicalStateStructuralDistribution(
  value: ZatomChemicalStateStructuralDistribution,
): string {
  return fingerprintCanonicalJson(value)
}

function hillFormula(structure: ZatomStructure, formalCharge: number): string {
  const counts = new Map<string, number>()
  for (const atom of structure.atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1)
  const hasCarbon = counts.has('C')
  const elements = [...counts.keys()].sort((left, right) => {
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
  const magnitude = Math.abs(formalCharge)
  return `${base}${formalCharge > 0 ? '+' : '-'}${magnitude === 1 ? '' : magnitude}`
}

function requireStructureMatchesState(
  structure: ZatomStructure,
  state: ZatomChemicalStateRecord,
  enumerationKind: ZatomChemicalStateEnsemble['enumeration']['kind'],
  field: string,
): void {
  const charges = structure.atoms.map((atom) => atom.properties?.formalCharge)
  if (!charges.every((charge) => typeof charge === 'number' && Number.isSafeInteger(charge))) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_member_identity_mismatch',
      `${field} must carry a complete integer formalCharge on every atom`,
    )
  }
  const formalCharge = charges.reduce<number>((sum, charge) => sum + Number(charge), 0)
  const explicitHydrogenCount = structure.atoms.filter((atom) => atom.element === 'H').length
  const heavyAtomCount = structure.atoms.length - explicitHydrogenCount
  const observedFormula = hillFormula(structure, formalCharge)
  const metadata: Array<[string, unknown]> = [
    ['zatom.chemical.stateId', state.id],
    ['zatom.chemical.canonicalIsomericSmiles', state.canonicalIsomericSmiles],
    ['zatom.chemical.formula', state.formula],
    ['zatom.chemical.formalCharge', state.formalCharge],
    ['zatom.chemical.enumerationKind', enumerationKind],
  ]
  if (structure.atoms.length !== state.atomCount
    || structure.bonds?.length !== state.bondCount
    || explicitHydrogenCount !== state.explicitHydrogenCount
    || heavyAtomCount !== state.heavyAtomCount
    || formalCharge !== state.formalCharge
    || observedFormula !== state.formula
    || metadata.some(([key, expected]) => structure.metadata?.[key] !== expected)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_member_identity_mismatch',
      `${field} formula/charge/counts/metadata do not match chemical state ${state.id}`,
    )
  }
}

function rawSelectedMemberStructure(value: unknown, field: string): unknown {
  if (!isRecord(value) || !Array.isArray(value.members) || !isRecord(value.selection)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} is not a recognizable structure ensemble`,
    )
  }
  const selectedMemberId = value.selection.selectedMemberId
  const selected = value.members.find((member) => isRecord(member) && member.id === selectedMemberId)
  if (!isRecord(selected) || selected.structure === undefined) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `${field} selected member does not resolve`,
    )
  }
  return selected.structure
}

function atomIdentitySignature(structure: ZatomStructure, atomId: string): string {
  const atom = structure.atoms.find((candidate) => candidate.id === atomId)!
  const atomById = new Map(structure.atoms.map((candidate) => [candidate.id, candidate]))
  const neighbors = (structure.bonds ?? []).flatMap((bond) => {
    if (bond.atomIds[0] !== atomId && bond.atomIds[1] !== atomId) return []
    const neighborId = bond.atomIds[0] === atomId ? bond.atomIds[1] : bond.atomIds[0]
    const neighbor = atomById.get(neighborId)!
    const bondIdentityProperties = Object.fromEntries([
      'zatom.chemical.aromatic',
      'zatom.chemical.stereochemistry',
    ].flatMap((key) => bond.properties?.[key] === undefined ? [] : [[key, bond.properties[key]]]))
    return [{
      neighbor: neighbor.element === 'H' ? 'H' : `${neighbor.element}:${neighbor.id}`,
      order: bond.order,
      bondIdentityProperties,
    }]
  }).sort((left, right) => (
    compareText(left.neighbor, right.neighbor) || left.order - right.order
  ))
  const identityProperties = Object.fromEntries([
    'zatom.chemical.isotope',
    'zatom.chemical.aromatic',
    'zatom.chemical.chiralTag',
    'zatom.chemical.stereochemistry',
  ].flatMap((key) => atom.properties?.[key] === undefined ? [] : [[key, atom.properties[key]]]))
  return canonicalJsonIdentity({
    element: atom.element,
    formalCharge: atom.properties?.formalCharge,
    identityProperties,
    neighbors,
  })
}

/**
 * Compose already-calibrated state marginals and conditional structural distributions.
 * This helper derives every binding fingerprint and the shared condition record; it does
 * not generate states, conformers, probabilities, or completeness evidence.
 */
export function composeZatomChemicalStateStructuralDistribution(
  value: unknown,
  options: ComposeZatomChemicalStateStructuralDistributionOptions,
): ZatomChemicalStateStructuralDistributionValidation {
  const referenceStructure = parseZatomStructure(options.chemicalStateReferenceStructure)
  const canonicalSelectedStructure = parseZatomStructure(options.selectedStructure)
  const root = exactObject(value, 'chemicalStateStructuralDistributionComposition', [
    'chemicalStateEnsemble',
    'heavyAtomIds',
    'stateStructureEnsembles',
    'acceptance',
    'provenance',
  ], ['metadata'])
  const chemicalStateEnsembleValidation = parseZatomChemicalStateEnsemble(
    root.chemicalStateEnsemble,
    { structure: referenceStructure },
  )
  const chemicalStateEnsemble = chemicalStateEnsembleValidation.ensemble
  if (!chemicalStateEnsemble.populationModel) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_population_required',
      'Composition requires a validated chemical-state population model',
    )
  }
  if (!Array.isArray(root.stateStructureEnsembles)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      'chemicalStateStructuralDistributionComposition.stateStructureEnsembles must be an array',
    )
  }
  const stateStructureEnsembles = root.stateStructureEnsembles.map((raw, index) => {
    const field = `chemicalStateStructuralDistributionComposition.stateStructureEnsembles[${index}]`
    const record = exactObject(raw, field, ['stateId', 'structureEnsemble'])
    const stateId = token(record.stateId, `${field}.stateId`)
    const selectedStructure = stateId === chemicalStateEnsemble.selection.selectedStateId
      ? canonicalSelectedStructure
      : parseZatomStructure(rawSelectedMemberStructure(record.structureEnsemble, `${field}.structureEnsemble`))
    const validation = parseZatomStructureEnsemble(record.structureEnsemble, { selectedStructure })
    return {
      stateId,
      structureEnsembleFingerprint: validation.fingerprint,
      structureEnsemble: validation.ensemble,
    }
  })
  return parseZatomChemicalStateStructuralDistribution({
    schemaVersion: ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA,
    chemicalStateEnsembleFingerprint: chemicalStateEnsembleValidation.fingerprint,
    conditions: chemicalStateEnsemble.populationModel.conditions,
    heavyAtomIds: root.heavyAtomIds,
    stateStructureEnsembles,
    acceptance: root.acceptance,
    provenance: root.provenance,
    ...(root.metadata === undefined ? {} : { metadata: root.metadata }),
  }, {
    ...options,
    chemicalStateEnsemble,
    chemicalStateReferenceStructure: referenceStructure,
    selectedStructure: canonicalSelectedStructure,
  })
}

export function parseZatomChemicalStateStructuralDistribution(
  value: unknown,
  options: ParseZatomChemicalStateStructuralDistributionOptions,
): ZatomChemicalStateStructuralDistributionValidation {
  const referenceStructure = parseZatomStructure(options.chemicalStateReferenceStructure)
  const canonicalSelectedStructure = parseZatomStructure(options.selectedStructure)
  const maxJointMembers = positiveSafeInteger(options.maxJointMembers, 4096, 'maxJointMembers')
  const maxMemberAtoms = positiveSafeInteger(options.maxMemberAtoms, 2_000_000, 'maxMemberAtoms')
  const maxMetadataBytes = positiveSafeInteger(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const maxArtifactBytes = positiveSafeInteger(options.maxArtifactBytes, 64 * 1024 * 1024, 'maxArtifactBytes')
  const chemicalStateEnsembleValidation = parseZatomChemicalStateEnsemble(
    options.chemicalStateEnsemble,
    { structure: referenceStructure },
  )
  const chemicalStateEnsemble = chemicalStateEnsembleValidation.ensemble
  if (!chemicalStateEnsemble.populationModel) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_population_required',
      'A joint chemical-state/structure distribution requires a validated chemical-state population model',
    )
  }
  const root = exactObject(value, 'chemicalStateStructuralDistribution', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'conditions',
    'heavyAtomIds',
    'stateStructureEnsembles',
    'acceptance',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      `schemaVersion must be ${ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA}`,
    )
  }
  const chemicalStateEnsembleFingerprint = text(
    root.chemicalStateEnsembleFingerprint,
    'chemicalStateStructuralDistribution.chemicalStateEnsembleFingerprint',
    128,
  )
  if (chemicalStateEnsembleFingerprint !== chemicalStateEnsembleValidation.fingerprint) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_fingerprint_mismatch',
      'Structural distribution does not bind the exact populated chemical-state ensemble',
    )
  }
  const rawConditions = exactObject(
    root.conditions,
    'chemicalStateStructuralDistribution.conditions',
    ['pH'],
    ['temperatureK', 'solvent', 'ionicStrengthMolar'],
  )
  const conditions: ZatomChemicalStatePopulationModel['conditions'] = {
    pH: numberIn(rawConditions.pH, 'chemicalStateStructuralDistribution.conditions.pH', 0, 14),
    ...(rawConditions.temperatureK === undefined ? {} : {
      temperatureK: numberIn(
        rawConditions.temperatureK,
        'chemicalStateStructuralDistribution.conditions.temperatureK',
        0.01,
        1_000_000,
      ),
    }),
    ...(rawConditions.solvent === undefined ? {} : {
      solvent: text(rawConditions.solvent, 'chemicalStateStructuralDistribution.conditions.solvent', 256),
    }),
    ...(rawConditions.ionicStrengthMolar === undefined ? {} : {
      ionicStrengthMolar: numberIn(
        rawConditions.ionicStrengthMolar,
        'chemicalStateStructuralDistribution.conditions.ionicStrengthMolar',
        0,
        100,
      ),
    }),
  }
  if (canonicalJsonIdentity(conditions)
    !== canonicalJsonIdentity(chemicalStateEnsemble.populationModel.conditions)) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_condition_mismatch',
      'Joint distribution conditions must exactly equal the bound chemical-state population conditions',
    )
  }
  if (!Array.isArray(root.heavyAtomIds) || root.heavyAtomIds.length < 1) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      'heavyAtomIds must be a nonempty ordered array',
    )
  }
  const heavyAtomIds = root.heavyAtomIds.map((atomId, index) => token(
    atomId,
    `chemicalStateStructuralDistribution.heavyAtomIds[${index}]`,
  ))
  if (new Set(heavyAtomIds).size !== heavyAtomIds.length) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'invalid_chemical_state_structural_distribution',
      'heavyAtomIds must be unique',
    )
  }
  if (!Array.isArray(root.stateStructureEnsembles)
    || root.stateStructureEnsembles.length !== chemicalStateEnsemble.states.length) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_state_coverage_mismatch',
      'stateStructureEnsembles must cover every canonical chemical state exactly once',
    )
  }
  const rawEntryByState = new Map<string, Record<string, unknown>>()
  root.stateStructureEnsembles.forEach((raw, index) => {
    const field = `chemicalStateStructuralDistribution.stateStructureEnsembles[${index}]`
    const record = exactObject(raw, field, [
      'stateId', 'structureEnsembleFingerprint', 'structureEnsemble',
    ])
    const stateId = token(record.stateId, `${field}.stateId`)
    if (rawEntryByState.has(stateId)) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'chemical_state_structural_distribution_state_coverage_mismatch',
        `stateStructureEnsembles repeats ${stateId}`,
      )
    }
    rawEntryByState.set(stateId, record)
  })
  const stateIds = new Set(chemicalStateEnsemble.states.map((state) => state.id))
  if ([...rawEntryByState.keys()].some((stateId) => !stateIds.has(stateId))) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_state_coverage_mismatch',
      'stateStructureEnsembles contains a state outside the bound chemical ensemble',
    )
  }

  let heavyElementById: Map<string, string> | undefined
  let jointMemberCount = 0
  let memberAtomCount = 0
  const stateStructureEnsembleValidations: ZatomChemicalStateStructuralDistributionValidation[
    'stateStructureEnsembleValidations'
  ] = []
  const stateStructureEnsembles: ZatomChemicalStateStructuralDistributionEntry[] = []
  for (const state of chemicalStateEnsemble.states) {
    const record = rawEntryByState.get(state.id)
    if (!record) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'chemical_state_structural_distribution_state_coverage_mismatch',
        `stateStructureEnsembles omits ${state.id}`,
      )
    }
    const field = `chemicalStateStructuralDistribution.stateStructureEnsembles.${state.id}`
    const selectedStructure = state.id === chemicalStateEnsemble.selection.selectedStateId
      ? canonicalSelectedStructure
      : parseZatomStructure(rawSelectedMemberStructure(record.structureEnsemble, `${field}.structureEnsemble`))
    const validation = parseZatomStructureEnsemble(record.structureEnsemble, { selectedStructure })
    const reportedFingerprint = text(
      record.structureEnsembleFingerprint,
      `${field}.structureEnsembleFingerprint`,
      128,
    )
    if (reportedFingerprint !== validation.fingerprint) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'chemical_state_structural_distribution_structure_ensemble_fingerprint_mismatch',
        `${field} does not bind its canonical structure ensemble`,
      )
    }
    if ((validation.ensemble.weightModel.kind === 'boltzmann-free-energy'
      || validation.ensemble.weightModel.kind === 'boltzmann-potential-energy')
      && (conditions.temperatureK === undefined
        || validation.ensemble.weightModel.temperatureK !== conditions.temperatureK)) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'chemical_state_structural_distribution_condition_mismatch',
        `${field} Boltzmann temperature must exactly match the shared joint-distribution temperature`,
      )
    }
    for (const member of validation.ensemble.members) {
      requireStructureMatchesState(
        member.structure,
        state,
        chemicalStateEnsemble.enumeration.kind,
        `${field}.member.${member.id}`,
      )
      const memberHeavyAtoms = member.structure.atoms.filter((atom) => atom.element !== 'H')
      const memberHeavyAtomIds = memberHeavyAtoms.map((atom) => atom.id)
      if (memberHeavyAtomIds.length !== heavyAtomIds.length
        || memberHeavyAtomIds.some((atomId, index) => atomId !== heavyAtomIds[index])) {
        throw new ZatomChemicalStateStructuralDistributionInputError(
          'chemical_state_structural_distribution_heavy_atom_mapping_mismatch',
          `${field}.member.${member.id} does not preserve the ordered heavyAtomIds mapping`,
        )
      }
      if (!heavyElementById) {
        heavyElementById = new Map(memberHeavyAtoms.map((atom) => [atom.id, atom.element]))
      } else if (memberHeavyAtoms.some((atom) => heavyElementById!.get(atom.id) !== atom.element)) {
        throw new ZatomChemicalStateStructuralDistributionInputError(
          'chemical_state_structural_distribution_heavy_atom_mapping_mismatch',
          `${field}.member.${member.id} changes a mapped heavy-atom element`,
        )
      }
      memberAtomCount += member.structure.atoms.length
    }
    jointMemberCount += validation.ensemble.members.length
    stateStructureEnsembleValidations.push({ stateId: state.id, validation })
    stateStructureEnsembles.push({
      stateId: state.id,
      structureEnsembleFingerprint: validation.fingerprint,
      structureEnsemble: validation.ensemble,
    })
  }
  if (jointMemberCount > maxJointMembers || memberAtomCount > maxMemberAtoms) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_budget_exceeded',
      `Distribution has ${jointMemberCount} joint members and ${memberAtomCount} member-atoms; limits are ${maxJointMembers} and ${maxMemberAtoms}`,
    )
  }

  const populationByState = new Map(
    chemicalStateEnsemble.populationModel.populations.map((population) => [population.stateId, population.fraction]),
  )
  const jointMembers = stateStructureEnsembleValidations.flatMap(({ stateId, validation }) => {
    const stateFraction = populationByState.get(stateId)!
    return validation.ensemble.members.map((member): ZatomChemicalStateStructuralJointMember => ({
      stateId,
      memberId: member.id,
      stateFraction,
      conditionalStructureWeight: member.weight,
      jointWeight: stateFraction * member.weight,
      structureFingerprint: member.structureFingerprint,
      topologyFingerprint: validation.ensemble.topologyFingerprint,
    }))
  })
  const jointWeightSum = jointMembers.reduce((sum, member) => sum + member.jointWeight, 0)
  if (Math.abs(jointWeightSum - 1) > 1e-8) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_joint_weight_mismatch',
      `Computed joint identity/structure weights sum to ${jointWeightSum}`,
    )
  }
  const jointWeightEffectiveMemberCount = 1 / jointMembers.reduce((sum, member) => (
    sum + member.jointWeight ** 2
  ), 0)
  const rawAcceptance = exactObject(
    root.acceptance,
    'chemicalStateStructuralDistribution.acceptance',
    ['minimumJointWeightEffectiveMemberCount'],
  )
  const acceptance = {
    minimumJointWeightEffectiveMemberCount: numberIn(
      rawAcceptance.minimumJointWeightEffectiveMemberCount,
      'chemicalStateStructuralDistribution.acceptance.minimumJointWeightEffectiveMemberCount',
      1,
      jointMembers.length,
    ),
  }
  if (jointWeightEffectiveMemberCount + 1e-12 < acceptance.minimumJointWeightEffectiveMemberCount) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_weight_effective_size_failed',
      `Joint effective member count ${jointWeightEffectiveMemberCount} is below ${acceptance.minimumJointWeightEffectiveMemberCount}`,
    )
  }

  const selectedStateEnsemble = stateStructureEnsembleValidations.find(({ stateId }) => (
    stateId === chemicalStateEnsemble.selection.selectedStateId
  ))!.validation
  const selectedMember = selectedStateEnsemble.ensemble.members.find((member) => (
    member.id === selectedStateEnsemble.ensemble.selection.selectedMemberId
  ))!
  const selectedStructureFingerprint = fingerprintStructure(canonicalSelectedStructure)
  const chemicalStateReferenceStructureFingerprint = fingerprintStructure(referenceStructure)
  if (selectedMember.structureFingerprint !== selectedStructureFingerprint) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_selected_structure_mismatch',
      'Selected chemical-state structural member does not match the active structure',
    )
  }

  const representativeStructures = stateStructureEnsembleValidations.map(({ stateId, validation }) => ({
    stateId,
    structure: validation.ensemble.members.find((member) => (
      member.id === validation.ensemble.selection.selectedMemberId
    ))!.structure,
  }))
  const identityVariableHeavyAtomIds = heavyAtomIds.filter((atomId) => {
    const signatures = new Set(representativeStructures.map(({ structure }) => (
      atomIdentitySignature(structure, atomId)
    )))
    return signatures.size > 1
  })

  const rawProvenance = exactObject(root.provenance, 'chemicalStateStructuralDistribution.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const provenance: ZatomChemicalStateStructuralDistribution['provenance'] = {
    engine: text(rawProvenance.engine, 'chemicalStateStructuralDistribution.provenance.engine', 256),
    engineVersion: text(
      rawProvenance.engineVersion,
      'chemicalStateStructuralDistribution.provenance.engineVersion',
      256,
    ),
    method: text(rawProvenance.method, 'chemicalStateStructuralDistribution.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts, 'chemicalStateStructuralDistribution.provenance.artifacts'),
    parameters: jsonRecord(rawProvenance.parameters, 'chemicalStateStructuralDistribution.provenance.parameters'),
    citations: uniqueTextList(
      rawProvenance.citations,
      'chemicalStateStructuralDistribution.provenance.citations',
      1,
      32,
    ),
    scopeWarning: text(
      rawProvenance.scopeWarning,
      'chemicalStateStructuralDistribution.provenance.scopeWarning',
      8192,
    ),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    metadata = jsonRecord(root.metadata, 'chemicalStateStructuralDistribution.metadata')
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > maxMetadataBytes) {
      throw new ZatomChemicalStateStructuralDistributionInputError(
        'chemical_state_structural_distribution_budget_exceeded',
        `Distribution metadata exceeds ${maxMetadataBytes} bytes`,
      )
    }
  }
  const distribution: ZatomChemicalStateStructuralDistribution = {
    schemaVersion: ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA,
    chemicalStateEnsembleFingerprint,
    conditions,
    heavyAtomIds,
    stateStructureEnsembles,
    acceptance,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const artifactBytes = new TextEncoder().encode(JSON.stringify(distribution)).length
  if (artifactBytes > maxArtifactBytes) {
    throw new ZatomChemicalStateStructuralDistributionInputError(
      'chemical_state_structural_distribution_budget_exceeded',
      `Canonical distribution is ${artifactBytes} bytes; limit is ${maxArtifactBytes}`,
    )
  }
  const fingerprint = fingerprintChemicalStateStructuralDistribution(distribution)
  const nestedChecks = stateStructureEnsembleValidations.flatMap(({ validation }) => validation.checks)
  const nestedStatus = nestedChecks.some((check) => check.status === 'fail')
    ? 'fail' as const
    : nestedChecks.some((check) => check.status === 'warn') ? 'warn' as const : 'pass' as const
  const normalizationScope = chemicalStateEnsemble.populationModel.normalizationScope?.kind
    ?? (chemicalStateEnsemble.enumeration.complete
      ? 'complete-state-universe' as const
      : 'conditional-on-returned-states' as const)
  const topologyCount = new Set(stateStructureEnsembles.map((entry) => (
    entry.structureEnsemble.topologyFingerprint
  ))).size
  const checks: ValidationCheck[] = [
    {
      id: 'chemical_state_structural_distribution.identity',
      status: 'pass',
      message: `Distribution ${fingerprint} binds populated chemical ensemble ${chemicalStateEnsembleFingerprint} and selected structure ${selectedMember.structureFingerprint}`,
      metrics: { fingerprint, chemicalStateEnsembleFingerprint },
    },
    {
      id: 'chemical_state_structural_distribution.reference_binding',
      status: 'pass',
      message: chemicalStateReferenceStructureFingerprint === selectedStructureFingerprint
        ? `Chemical-state identity and selected structural member share reference fingerprint ${chemicalStateReferenceStructureFingerprint}`
        : `Chemical-state identity remains bound to reference ${chemicalStateReferenceStructureFingerprint} while the selected sampled member is ${selectedStructureFingerprint}`,
      metrics: {
        chemicalStateReferenceStructureFingerprint,
        selectedStructureFingerprint,
        selectedMemberDiffersFromChemicalReference:
          chemicalStateReferenceStructureFingerprint !== selectedStructureFingerprint,
      },
    },
    {
      id: 'chemical_state_structural_distribution.conditions',
      status: 'pass',
      message: 'State marginals and all state-conditioned structure weights are explicitly bound to one shared condition record',
      metrics: {
        pH: conditions.pH,
        temperatureK: conditions.temperatureK ?? null,
        solvent: conditions.solvent ?? null,
        ionicStrengthMolar: conditions.ionicStrengthMolar ?? null,
      },
    },
    {
      id: 'chemical_state_structural_distribution.state_coverage',
      status: 'pass',
      message: `Every ${chemicalStateEnsemble.states.length} chemical state has one canonical conditional structure ensemble`,
      metrics: { stateCount: chemicalStateEnsemble.states.length, jointMemberCount },
    },
    {
      id: 'chemical_state_structural_distribution.heavy_atom_mapping',
      status: 'pass',
      message: `All ${jointMemberCount} members preserve ${heavyAtomIds.length} ordered heavy-atom IDs and elements`,
      metrics: { heavyAtomCount: heavyAtomIds.length, jointMemberCount },
      atomIds: heavyAtomIds.slice(0, 256),
    },
    {
      id: 'chemical_state_structural_distribution.member_contracts',
      status: nestedStatus,
      message: `${stateStructureEnsembleValidations.length} nested fixed-topology ensembles were independently validated; aggregate status is ${nestedStatus}`,
      metrics: {
        nestedPassCount: nestedChecks.filter((check) => check.status === 'pass').length,
        nestedWarnCount: nestedChecks.filter((check) => check.status === 'warn').length,
        nestedFailCount: nestedChecks.filter((check) => check.status === 'fail').length,
      },
    },
    {
      id: 'chemical_state_structural_distribution.joint_weights',
      status: 'pass',
      message: `State marginals times conditional structure weights normalize to one with joint Kish effective member count ${jointWeightEffectiveMemberCount}`,
      metrics: {
        jointWeightSum,
        jointWeightEffectiveMemberCount,
        minimumJointWeightEffectiveMemberCount: acceptance.minimumJointWeightEffectiveMemberCount,
      },
    },
    {
      id: 'chemical_state_structural_distribution.identity_variation',
      status: 'pass',
      message: `${identityVariableHeavyAtomIds.length} mapped heavy atom(s) change charge, stereo identity, or incident bond/H-neighbor signature across representative chemical states`,
      metrics: { identityVariableHeavyAtomCount: identityVariableHeavyAtomIds.length, topologyCount },
      atomIds: identityVariableHeavyAtomIds.slice(0, 256),
    },
    {
      id: 'chemical_state_structural_distribution.normalization_scope',
      status: normalizationScope === 'complete-state-universe' ? 'pass' : 'warn',
      message: normalizationScope === 'complete-state-universe'
        ? 'Joint identity/structure weights cover the producer-declared complete chemical-state universe'
        : 'Joint identity/structure weights are conditional on returned chemical states; omitted identity mass remains separate',
      metrics: { normalizationScope },
    },
    {
      id: 'chemical_state_structural_distribution.provenance',
      status: 'pass',
      message: `Distribution provenance records ${provenance.engine} ${provenance.engineVersion}, immutable artifacts, parameters, citations, and scope`,
      metrics: { artifactCount: provenance.artifacts.length, citationCount: provenance.citations.length },
    },
    {
      id: 'chemical_state_structural_distribution.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} Joint weights use the chemical-state population model as state marginals and each nested structure ensemble as a conditional distribution. Parameter/population uncertainty, omitted chemical states or conformers, cross-state kinetics, and sampling convergence remain separate unless explicitly evidenced.`,
      metrics: { normalizationScope },
    },
  ]

  const inspectionTargets: InspectionTarget[] = selectedStateEnsemble.inspectionTargets.map((target) => ({
    ...target,
    id: `chemical-state-distribution-${target.id}`,
    reason: `Selected chemical state ${chemicalStateEnsemble.selection.selectedStateId}: ${target.reason}`,
  }))
  if (identityVariableHeavyAtomIds.length) {
    const selectedAtomById = new Map(canonicalSelectedStructure.atoms.map((atom) => [atom.id, atom]))
    const visibleVariableIds = identityVariableHeavyAtomIds.filter((atomId) => selectedAtomById.has(atomId))
    const bounds = boundsOfPositions(visibleVariableIds.map((atomId) => selectedAtomById.get(atomId)!.position))!
    inspectionTargets.push({
      id: 'chemical-state-distribution-identity-variable-atoms',
      reason: 'Inspect mapped heavy atoms whose charge, stereochemical identity, bond order, or hydrogen-neighbor signature changes across chemical states',
      center: bounds.center,
      radius: Math.max(1, bounds.radius + 1),
      atomIds: visibleVariableIds.slice(0, 256),
      ...(visibleVariableIds.length > 256 ? { atomIdsTruncated: true } : {}),
    })
  }
  return {
    distribution,
    fingerprint,
    chemicalStateEnsembleValidation,
    stateStructureEnsembleValidations,
    jointMembers,
    jointWeightEffectiveMemberCount,
    identityVariableHeavyAtomIds,
    checks,
    inspectionTargets,
  }
}
