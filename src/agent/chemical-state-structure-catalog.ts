/** Canonical all-state source structures for state-conditioned structural sampling. */

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
  type ZatomChemicalStateRecord,
} from './chemical-state-ensemble'
import { boundsOfPositions, canonicalJsonIdentity, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA =
  'zatom.chemical-state-structure-catalog/v1' as const

const RESERVED_ARTIFACT_IDS = new Set([
  'chemical-state-ensemble',
  'chemical-state-reference-structure',
  'state-structures',
])

export interface ZatomChemicalStateStructureCatalogEntry {
  stateId: string
  structureFingerprint: string
  structure: ZatomStructure
}

export interface ZatomChemicalStateStructureCatalog {
  schemaVersion: typeof ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA
  chemicalStateEnsembleFingerprint: string
  chemicalStateReferenceStructureFingerprint: string
  /** Stable ordered heavy-atom correspondence shared by every state structure. */
  heavyAtomIds: string[]
  entries: ZatomChemicalStateStructureCatalogEntry[]
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

export interface ZatomChemicalStateStructureCatalogComposition {
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  chemicalStateReferenceStructure: ZatomStructure
  heavyAtomIds: string[]
  stateStructures: Array<{ stateId: string; structure: ZatomStructure }>
  provenance: ZatomChemicalStateStructureCatalog['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomChemicalStateStructureCatalogOptions {
  chemicalStateEnsemble: ZatomChemicalStateEnsemble
  chemicalStateReferenceStructure: ZatomStructure
  maxStates?: number
  maxTotalAtoms?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomChemicalStateStructureCatalogValidation {
  catalog: ZatomChemicalStateStructureCatalog
  fingerprint: string
  chemicalStateEnsembleValidation: ZatomChemicalStateEnsembleValidation
  identityVariableHeavyAtomIds: string[]
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomChemicalStateStructureCatalogInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomChemicalStateStructureCatalogInputError'
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
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must be an object`,
    )
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function positiveSafeInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog_context',
      `${field} must be a positive safe integer`,
    )
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'invalid_chemical_state_structure_catalog',
        `${field} must contain finite numbers`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      jsonValue(item, `${field}.${key}`),
    ]))
  }
  throw new ZatomChemicalStateStructureCatalogInputError(
    'invalid_chemical_state_structure_catalog',
    `${field} must be JSON-safe`,
  )
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must be an object`,
    )
  }
  return jsonValue(value, field) as Record<string, JsonValue>
}

function uniqueTextList(
  value: unknown,
  field: string,
  minimum = 1,
  maximum = 32,
  maximumLength = 4096,
): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function parseArtifacts(
  value: unknown,
  field: string,
): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} must contain 3-64 entries`,
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
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `${field} IDs must be unique`,
    )
  }
  return artifacts
}


export function fingerprintChemicalStateStructureCatalog(
  catalog: ZatomChemicalStateStructureCatalog,
): string {
  return fingerprintCanonicalJson(catalog)
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
  if (structure.lattice) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_member_identity_mismatch',
      `${field} must be finite and nonperiodic`,
    )
  }
  if (!Array.isArray(structure.bonds)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_member_identity_mismatch',
      `${field} must carry explicit bonds`,
    )
  }
  const charges = structure.atoms.map((atom) => atom.properties?.formalCharge)
  if (!charges.every((charge) => typeof charge === 'number' && Number.isSafeInteger(charge))) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_member_identity_mismatch',
      `${field} must carry a complete integer formalCharge on every atom`,
    )
  }
  const formalCharge = charges.reduce<number>((sum, charge) => sum + Number(charge), 0)
  const explicitHydrogenCount = structure.atoms.filter((atom) => atom.element === 'H').length
  const heavyAtomCount = structure.atoms.length - explicitHydrogenCount
  const metadata: Array<[string, unknown]> = [
    ['zatom.chemical.stateId', state.id],
    ['zatom.chemical.canonicalIsomericSmiles', state.canonicalIsomericSmiles],
    ['zatom.chemical.formula', state.formula],
    ['zatom.chemical.formalCharge', state.formalCharge],
    ['zatom.chemical.enumerationKind', enumerationKind],
  ]
  if (structure.atoms.length !== state.atomCount
    || structure.bonds.length !== state.bondCount
    || explicitHydrogenCount !== state.explicitHydrogenCount
    || heavyAtomCount !== state.heavyAtomCount
    || formalCharge !== state.formalCharge
    || hillFormula(structure, formalCharge) !== state.formula
    || metadata.some(([key, expected]) => structure.metadata?.[key] !== expected)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_member_identity_mismatch',
      `${field} formula/charge/counts/metadata do not match chemical state ${state.id}`,
    )
  }
}

function atomIdentitySignature(structure: ZatomStructure, atomId: string): string {
  const atom = structure.atoms.find((candidate) => candidate.id === atomId)!
  const atomById = new Map(structure.atoms.map((candidate) => [candidate.id, candidate]))
  const neighbors = (structure.bonds ?? []).flatMap((bond) => {
    if (!bond.atomIds.includes(atomId)) return []
    const neighborId = bond.atomIds[0] === atomId ? bond.atomIds[1] : bond.atomIds[0]
    const neighbor = atomById.get(neighborId)!
    return [{
      neighbor: neighbor.element === 'H' ? 'H' : `${neighbor.element}:${neighbor.id}`,
      order: bond.order,
      aromatic: bond.properties?.['zatom.chemical.aromatic'] ?? null,
      stereo: bond.properties?.['zatom.chemical.stereochemistry'] ?? null,
    }]
  }).sort((left, right) => compareText(left.neighbor, right.neighbor) || left.order - right.order)
  return canonicalJsonIdentity({
    element: atom.element,
    formalCharge: atom.properties?.formalCharge,
    isotope: atom.properties?.['zatom.chemical.isotope'] ?? null,
    aromatic: atom.properties?.['zatom.chemical.aromatic'] ?? null,
    chiralTag: atom.properties?.['zatom.chemical.chiralTag'] ?? null,
    stereochemistry: atom.properties?.['zatom.chemical.stereochemistry'] ?? null,
    neighbors,
  })
}

function requireArtifact(
  artifacts: ZatomChemicalStateStructureCatalog['provenance']['artifacts'],
  id: string,
  fingerprint: string,
): void {
  const artifact = artifacts.find((candidate) => candidate.id === id)
  if (!artifact || artifact.fingerprint !== fingerprint) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_provenance_mismatch',
      `provenance artifact ${id} must bind ${fingerprint}`,
    )
  }
}

export function composeZatomChemicalStateStructureCatalog(
  value: unknown,
  options: Omit<ParseZatomChemicalStateStructureCatalogOptions,
  'chemicalStateEnsemble' | 'chemicalStateReferenceStructure'> = {},
): ZatomChemicalStateStructureCatalogValidation {
  const root = exactObject(value, 'chemicalStateStructureCatalogComposition', [
    'chemicalStateEnsemble',
    'chemicalStateReferenceStructure',
    'heavyAtomIds',
    'stateStructures',
    'provenance',
  ], ['metadata'])
  const reference = parseZatomStructure(root.chemicalStateReferenceStructure)
  const ensembleValidation = parseZatomChemicalStateEnsemble(root.chemicalStateEnsemble, {
    structure: reference,
  })
  if (!Array.isArray(root.stateStructures)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      'chemicalStateStructureCatalogComposition.stateStructures must be an array',
    )
  }
  const rawEntries = root.stateStructures.map((raw, index) => {
    const field = `chemicalStateStructureCatalogComposition.stateStructures[${index}]`
    const record = exactObject(raw, field, ['stateId', 'structure'])
    const structure = parseZatomStructure(record.structure)
    return {
      stateId: token(record.stateId, `${field}.stateId`),
      structureFingerprint: fingerprintStructure(structure),
      structure,
    }
  })
  const stateIndex = new Map(ensembleValidation.ensemble.states.map((state, index) => [state.id, index]))
  const entries = [...rawEntries].sort((left, right) => (
    (stateIndex.get(left.stateId) ?? Number.MAX_SAFE_INTEGER)
    - (stateIndex.get(right.stateId) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left.stateId, right.stateId)
  ))
  const stateStructuresFingerprint = fingerprintCanonicalJson(entries.map((entry) => ({
    stateId: entry.stateId,
    structureFingerprint: entry.structureFingerprint,
  })))
  const rawProvenance = exactObject(root.provenance, 'chemicalStateStructureCatalogComposition.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  if (!Array.isArray(rawProvenance.artifacts)) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      'chemicalStateStructureCatalogComposition.provenance.artifacts must be an array',
    )
  }
  const suppliedArtifacts = rawProvenance.artifacts.map((artifact, index) => {
    const field = `chemicalStateStructureCatalogComposition.provenance.artifacts[${index}]`
    const record = exactObject(artifact, field, ['id', 'role', 'fingerprint'])
    const id = token(record.id, `${field}.id`)
    if (RESERVED_ARTIFACT_IDS.has(id)) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_provenance_mismatch',
        `${field}.id ${id} is reserved for composition-derived dependencies`,
      )
    }
    return {
      id,
      role: text(record.role, `${field}.role`, 1024),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  })
  return parseZatomChemicalStateStructureCatalog({
    schemaVersion: ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA,
    chemicalStateEnsembleFingerprint: ensembleValidation.fingerprint,
    chemicalStateReferenceStructureFingerprint: fingerprintStructure(reference),
    heavyAtomIds: root.heavyAtomIds,
    entries,
    provenance: {
      engine: rawProvenance.engine,
      engineVersion: rawProvenance.engineVersion,
      method: rawProvenance.method,
      artifacts: [
        ...suppliedArtifacts,
        {
          id: 'chemical-state-ensemble',
          role: 'Exact canonical chemical-state identity and population dependency',
          fingerprint: ensembleValidation.fingerprint,
        },
        {
          id: 'chemical-state-reference-structure',
          role: 'Exact pre-sampling selected-state reference structure',
          fingerprint: fingerprintStructure(reference),
        },
        {
          id: 'state-structures',
          role: 'Canonical state-ID to exact source-structure fingerprint mapping',
          fingerprint: stateStructuresFingerprint,
        },
      ],
      parameters: rawProvenance.parameters,
      citations: rawProvenance.citations,
      scopeWarning: rawProvenance.scopeWarning,
    },
    ...(root.metadata === undefined ? {} : { metadata: root.metadata }),
  }, {
    ...options,
    chemicalStateEnsemble: ensembleValidation.ensemble,
    chemicalStateReferenceStructure: reference,
  })
}

export function parseZatomChemicalStateStructureCatalog(
  value: unknown,
  options: ParseZatomChemicalStateStructureCatalogOptions,
): ZatomChemicalStateStructureCatalogValidation {
  const maxStates = positiveSafeInteger(options.maxStates, 512, 'maxStates')
  const maxTotalAtoms = positiveSafeInteger(options.maxTotalAtoms, 2_000_000, 'maxTotalAtoms')
  const maxMetadataBytes = positiveSafeInteger(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const maxArtifactBytes = positiveSafeInteger(options.maxArtifactBytes, 64 * 1024 * 1024, 'maxArtifactBytes')
  const reference = parseZatomStructure(options.chemicalStateReferenceStructure)
  const ensembleValidation = parseZatomChemicalStateEnsemble(options.chemicalStateEnsemble, {
    structure: reference,
    maxStates,
  })
  const ensemble = ensembleValidation.ensemble
  const root = exactObject(value, 'chemicalStateStructureCatalog', [
    'schemaVersion',
    'chemicalStateEnsembleFingerprint',
    'chemicalStateReferenceStructureFingerprint',
    'heavyAtomIds',
    'entries',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      `schemaVersion must be ${ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA}`,
    )
  }
  const chemicalStateEnsembleFingerprint = text(
    root.chemicalStateEnsembleFingerprint,
    'chemicalStateStructureCatalog.chemicalStateEnsembleFingerprint',
    128,
  )
  const chemicalStateReferenceStructureFingerprint = text(
    root.chemicalStateReferenceStructureFingerprint,
    'chemicalStateStructureCatalog.chemicalStateReferenceStructureFingerprint',
    128,
  )
  const referenceFingerprint = fingerprintStructure(reference)
  if (chemicalStateEnsembleFingerprint !== ensembleValidation.fingerprint
    || chemicalStateReferenceStructureFingerprint !== referenceFingerprint) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_fingerprint_mismatch',
      'Catalog does not bind the exact chemical-state ensemble and reference structure',
    )
  }
  if (!Array.isArray(root.heavyAtomIds) || root.heavyAtomIds.length < 1) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      'heavyAtomIds must be a nonempty ordered array',
    )
  }
  const heavyAtomIds = root.heavyAtomIds.map((atomId, index) => token(
    atomId,
    `chemicalStateStructureCatalog.heavyAtomIds[${index}]`,
  ))
  if (new Set(heavyAtomIds).size !== heavyAtomIds.length) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'invalid_chemical_state_structure_catalog',
      'heavyAtomIds must be unique',
    )
  }
  if (!Array.isArray(root.entries) || root.entries.length !== ensemble.states.length) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_state_coverage_mismatch',
      'Catalog entries must cover every canonical chemical state exactly once',
    )
  }
  const rawByState = new Map<string, Record<string, unknown>>()
  root.entries.forEach((raw, index) => {
    const field = `chemicalStateStructureCatalog.entries[${index}]`
    const record = exactObject(raw, field, ['stateId', 'structureFingerprint', 'structure'])
    const stateId = token(record.stateId, `${field}.stateId`)
    if (rawByState.has(stateId)) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_state_coverage_mismatch',
        `Catalog repeats state ${stateId}`,
      )
    }
    rawByState.set(stateId, record)
  })
  if ([...rawByState.keys()].some((stateId) => !ensemble.states.some((state) => state.id === stateId))) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_state_coverage_mismatch',
      'Catalog contains a state outside the bound chemical ensemble',
    )
  }

  let totalAtoms = 0
  let heavyElementById: Map<string, string> | undefined
  const entries: ZatomChemicalStateStructureCatalogEntry[] = []
  for (const state of ensemble.states) {
    const record = rawByState.get(state.id)
    if (!record) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_state_coverage_mismatch',
        `Catalog omits state ${state.id}`,
      )
    }
    const field = `chemicalStateStructureCatalog.entries.${state.id}`
    const structure = parseZatomStructure(record.structure)
    const structureFingerprint = text(record.structureFingerprint, `${field}.structureFingerprint`, 128)
    if (structureFingerprint !== fingerprintStructure(structure)) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_fingerprint_mismatch',
        `${field} does not bind its exact structure`,
      )
    }
    requireStructureMatchesState(structure, state, ensemble.enumeration.kind, `${field}.structure`)
    const heavyAtoms = structure.atoms.filter((atom) => atom.element !== 'H')
    if (heavyAtoms.length !== heavyAtomIds.length
      || heavyAtoms.some((atom, index) => atom.id !== heavyAtomIds[index])) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_heavy_atom_mapping_mismatch',
        `${field} does not preserve the ordered heavyAtomIds mapping`,
      )
    }
    if (!heavyElementById) {
      heavyElementById = new Map(heavyAtoms.map((atom) => [atom.id, atom.element]))
    } else if (heavyAtoms.some((atom) => heavyElementById!.get(atom.id) !== atom.element)) {
      throw new ZatomChemicalStateStructureCatalogInputError(
        'chemical_state_structure_catalog_heavy_atom_mapping_mismatch',
        `${field} changes a mapped heavy-atom element`,
      )
    }
    totalAtoms += structure.atoms.length
    entries.push({ stateId: state.id, structureFingerprint, structure })
  }
  if (totalAtoms > maxTotalAtoms) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_budget_exceeded',
      `Catalog contains ${totalAtoms} atoms across states; limit is ${maxTotalAtoms}`,
    )
  }
  const selectedEntry = entries.find((entry) => entry.stateId === ensemble.selection.selectedStateId)!
  if (selectedEntry.structureFingerprint !== referenceFingerprint) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_selected_reference_mismatch',
      'The selected chemical-state catalog entry must exactly equal the chemical-state reference structure',
    )
  }

  const rawProvenance = exactObject(root.provenance, 'chemicalStateStructureCatalog.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const provenance: ZatomChemicalStateStructureCatalog['provenance'] = {
    engine: text(rawProvenance.engine, 'chemicalStateStructureCatalog.provenance.engine', 256),
    engineVersion: text(
      rawProvenance.engineVersion,
      'chemicalStateStructureCatalog.provenance.engineVersion',
      256,
    ),
    method: text(rawProvenance.method, 'chemicalStateStructureCatalog.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts, 'chemicalStateStructureCatalog.provenance.artifacts'),
    parameters: jsonRecord(rawProvenance.parameters, 'chemicalStateStructureCatalog.provenance.parameters'),
    citations: uniqueTextList(rawProvenance.citations, 'chemicalStateStructureCatalog.provenance.citations'),
    scopeWarning: text(rawProvenance.scopeWarning, 'chemicalStateStructureCatalog.provenance.scopeWarning', 8192),
  }
  const stateStructuresFingerprint = fingerprintCanonicalJson(entries.map((entry) => ({
    stateId: entry.stateId,
    structureFingerprint: entry.structureFingerprint,
  })))
  requireArtifact(provenance.artifacts, 'chemical-state-ensemble', ensembleValidation.fingerprint)
  requireArtifact(provenance.artifacts, 'chemical-state-reference-structure', referenceFingerprint)
  requireArtifact(provenance.artifacts, 'state-structures', stateStructuresFingerprint)

  const metadata = root.metadata === undefined
    ? undefined
    : jsonRecord(root.metadata, 'chemicalStateStructureCatalog.metadata')
  const boundedMetadata = { parameters: provenance.parameters, metadata }
  if (new TextEncoder().encode(JSON.stringify(boundedMetadata)).length > maxMetadataBytes) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_budget_exceeded',
      `Catalog metadata exceeds ${maxMetadataBytes} bytes`,
    )
  }
  const catalog: ZatomChemicalStateStructureCatalog = {
    schemaVersion: ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA,
    chemicalStateEnsembleFingerprint,
    chemicalStateReferenceStructureFingerprint,
    heavyAtomIds,
    entries,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const artifactBytes = new TextEncoder().encode(JSON.stringify(catalog)).length
  if (artifactBytes > maxArtifactBytes) {
    throw new ZatomChemicalStateStructureCatalogInputError(
      'chemical_state_structure_catalog_budget_exceeded',
      `Catalog artifact uses ${artifactBytes} bytes; limit is ${maxArtifactBytes}`,
    )
  }
  const fingerprint = fingerprintChemicalStateStructureCatalog(catalog)
  const identityVariableHeavyAtomIds = heavyAtomIds.filter((atomId) => (
    new Set(entries.map((entry) => atomIdentitySignature(entry.structure, atomId))).size > 1
  ))
  const referenceBounds = boundsOfPositions(reference.atoms.map((atom) => atom.position))!
  const referenceAtomById = new Map(reference.atoms.map((atom) => [atom.id, atom]))
  const inspectionTargets: InspectionTarget[] = [{
    id: 'chemical-state-catalog-reference-structure',
    reason: `Inspect catalog reference for selected state ${ensemble.selection.selectedStateId}`,
    center: referenceBounds.center,
    radius: Math.max(1, referenceBounds.radius * 1.25),
    atomIds: reference.atoms.slice(0, 256).map((atom) => atom.id),
    ...(reference.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }]
  if (identityVariableHeavyAtomIds.length) {
    const positions = identityVariableHeavyAtomIds.map((atomId) => referenceAtomById.get(atomId)!.position)
    const bounds = boundsOfPositions(positions)!
    inspectionTargets.push({
      id: 'chemical-state-catalog-identity-variable-atoms',
      reason: `${identityVariableHeavyAtomIds.length} mapped heavy atom(s) change formal charge, stereo, bond order, or hydrogen neighborhood across catalog states`,
      center: bounds.center,
      radius: Math.max(1, bounds.radius * 2),
      atomIds: identityVariableHeavyAtomIds.slice(0, 256),
      ...(identityVariableHeavyAtomIds.length > 256 ? { atomIdsTruncated: true } : {}),
    })
  }
  const checks: ValidationCheck[] = [
    {
      id: 'chemical_state_structure_catalog.identity',
      status: 'pass',
      message: `Catalog ${fingerprint} binds chemical ensemble ${ensembleValidation.fingerprint} and reference ${referenceFingerprint}`,
      metrics: { fingerprint, chemicalStateEnsembleFingerprint, referenceFingerprint },
    },
    {
      id: 'chemical_state_structure_catalog.state_coverage',
      status: 'pass',
      message: `Catalog covers all ${entries.length} canonical chemical states exactly once`,
      metrics: { stateCount: entries.length, enumerationComplete: ensemble.enumeration.complete },
    },
    {
      id: 'chemical_state_structure_catalog.structure_identity',
      status: 'pass',
      message: `Every state structure matches its canonical formula, charge, topology counts, and chemical metadata across ${totalAtoms} total atoms`,
      metrics: { totalAtoms },
    },
    {
      id: 'chemical_state_structure_catalog.heavy_atom_mapping',
      status: 'pass',
      message: `All state structures preserve ${heavyAtomIds.length} ordered heavy-atom IDs and elements`,
      metrics: { heavyAtomCount: heavyAtomIds.length, identityVariableHeavyAtomCount: identityVariableHeavyAtomIds.length },
      atomIds: identityVariableHeavyAtomIds.slice(0, 256),
    },
    {
      id: 'chemical_state_structure_catalog.selected_reference',
      status: 'pass',
      message: `Selected state ${ensemble.selection.selectedStateId} exactly matches the chemical-state reference structure`,
      metrics: { selectedStateId: ensemble.selection.selectedStateId, referenceFingerprint },
    },
    {
      id: 'chemical_state_structure_catalog.provenance',
      status: 'pass',
      message: `Catalog provenance binds the ensemble, reference, and aggregate state-structure mapping with ${provenance.artifacts.length} immutable artifact(s)`,
      metrics: { artifactCount: provenance.artifacts.length },
    },
    {
      id: 'chemical_state_structure_catalog.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} The catalog validates supplied state identities, structures, and correspondence; it does not generate states, prove enumeration completeness, calibrate populations, find the chemically correct atom mapping, relax structures, or establish stability.`,
      metrics: { enumerationComplete: ensemble.enumeration.complete },
    },
  ]
  return {
    catalog,
    fingerprint,
    chemicalStateEnsembleValidation: ensembleValidation,
    identityVariableHeavyAtomIds,
    checks,
    inspectionTargets,
  }
}
