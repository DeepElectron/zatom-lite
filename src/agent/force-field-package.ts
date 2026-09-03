/** Canonical, topology-bound fixed-charge ligand parameter artifact. */

import type { InspectionTarget, JsonValue, ValidationCheck, ZatomStructure } from './contracts'
import {
  boundsOfPositions,
  compareCanonicalText,
  distance,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

export const ZATOM_FORCE_FIELD_PACKAGE_SCHEMA = 'zatom.force-field-package/v1' as const

export interface ZatomForceFieldPackageAtom {
  atomId: string
  element: string
  atomName: string
  atomType: string
  atomClass: string
  massDa: number
  partialChargeE: number
  sigmaNm: number
  epsilonKjMol: number
}

export interface ZatomForceFieldPackageBond {
  bondId: string
  atomIds: [string, string]
  lengthNm: number
  kKjMolNm2: number
}

export interface ZatomForceFieldPackageAngle {
  id: string
  atomIds: [string, string, string]
  angleRad: number
  kKjMolRad2: number
}

export interface ZatomForceFieldPackagePeriodicTerm {
  periodicity: number
  phaseRad: number
  kKjMol: number
}

export interface ZatomForceFieldPackageProperTorsion {
  id: string
  atomIds: [string, string, string, string]
  terms: ZatomForceFieldPackagePeriodicTerm[]
}

export interface ZatomForceFieldPackageImproperTorsion {
  id: string
  /**
   * Central atom first; the remaining IDs are an explicit outer-atom orientation.
   * Multiple orientations may share one central/outer set (for example, a
   * three-term SMIRNOFF trefoil), but each orientation appears at most once.
   */
  atomIds: [string, string, string, string]
  centralAtomId: string
  terms: ZatomForceFieldPackagePeriodicTerm[]
}

export interface ZatomForceFieldPackage {
  schemaVersion: typeof ZATOM_FORCE_FIELD_PACKAGE_SCHEMA
  /** Exact structure from which the parameterization artifact was generated. */
  structureFingerprint: string
  /** Coordinate/ordinary-metadata-independent atom/bond and whitelisted chemical identity. */
  topologyFingerprint: string
  atomIds: string[]
  template: {
    residueName: string
    externalBondAtomIds: string[]
  }
  nonbonded: {
    combiningRule: 'lorentz-berthelot'
    coulomb14Scale: number
    lennardJones14Scale: number
    useDispersionCorrection: boolean
  }
  atoms: ZatomForceFieldPackageAtom[]
  bonds: ZatomForceFieldPackageBond[]
  angles: ZatomForceFieldPackageAngle[]
  properTorsions: ZatomForceFieldPackageProperTorsion[]
  improperTorsions: ZatomForceFieldPackageImproperTorsion[]
  provenance: {
    engine: string
    engineVersion: string
    method: string
    parameterizationFamily: string
    chargeModel: string
    totalCharge: number
    citations: string[]
    scopeWarning: string
    sourceArtifacts: Array<{ label: string; sha256: string }>
  }
  metadata?: Record<string, JsonValue>
}

export interface ZatomForceFieldPackageValidation {
  package: ZatomForceFieldPackage
  fingerprint: string
  bindingMode: 'exact-source' | 'topology-compatible'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export interface ParseZatomForceFieldPackageOptions {
  structure: ZatomStructure
  maxAtoms?: number
  maxBonds?: number
  maxAngles?: number
  maxProperTorsions?: number
  maxImproperTorsions?: number
  maxMetadataBytes?: number
  /** Permit coordinate/metadata drift while requiring exact topology identity. */
  allowCompatibleGeometry?: boolean
}

export class ZatomForceFieldPackageInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomForceFieldPackageInputError'
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
  if (!isRecord(value)) throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `${field} must be an object`)
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must be a non-empty string of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} contains characters outside the portable parameter-token alphabet`,
    )
  }
  return result
}

function numberIn(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  exclusiveMinimum = false,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)
    || (exclusiveMinimum ? value <= minimum : value < minimum) || value > maximum) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must be finite and ${exclusiveMinimum ? 'greater than' : 'at least'} ${minimum}, at most ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function integerIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must be a safe integer from ${minimum} through ${maximum}`,
    )
  }
  return Number(value)
}

function stringArray(value: unknown, field: string, maximumItems: number, itemMaximum = 1024): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must be an array with at most ${maximumItems} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, itemMaximum))
  if (new Set(result).size !== result.length) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `${field} must not repeat values`)
  }
  return result
}

function tupleIds(value: unknown, field: string, count: number, atomIdSet: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.length !== count) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `${field} must contain ${count} atom IDs`)
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length || result.some((id) => !atomIdSet.has(id))) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must reference ${count} distinct structure atom IDs`,
    )
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `${field} must be finite`)
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `${field} is not JSON-safe`)
}

function compareIndexTuples(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

function topologyPaths(
  structure: ZatomStructure,
  budgets: { maxAngles: number; maxProperTorsions: number },
): {
  adjacency: Map<string, Set<string>>
  angles: Array<[string, string, string]>
  propers: Array<[string, string, string, string]>
} {
  const atomIndex = new Map(structure.atoms.map((atom, index) => [atom.id, index]))
  const adjacency = new Map(structure.atoms.map((atom) => [atom.id, new Set<string>()]))
  for (const bond of structure.bonds ?? []) {
    adjacency.get(bond.atomIds[0])!.add(bond.atomIds[1])
    adjacency.get(bond.atomIds[1])!.add(bond.atomIds[0])
  }
  const angles: Array<[string, string, string]> = []
  for (const center of structure.atoms.map((atom) => atom.id)) {
    const neighbors = [...adjacency.get(center)!].sort((left, right) => atomIndex.get(left)! - atomIndex.get(right)!)
    for (let left = 0; left < neighbors.length; left++) {
      for (let right = left + 1; right < neighbors.length; right++) {
        angles.push([neighbors[left], center, neighbors[right]])
        if (angles.length > budgets.maxAngles) {
          throw new ZatomForceFieldPackageInputError(
            'force_field_package_budget_exceeded',
            `Derived angle topology exceeds the ${budgets.maxAngles} term parser budget`,
          )
        }
      }
    }
  }
  angles.sort((left, right) => compareIndexTuples(
    left.map((id) => atomIndex.get(id)!),
    right.map((id) => atomIndex.get(id)!),
  ))

  const properByKey = new Map<string, [string, string, string, string]>()
  for (const bond of structure.bonds ?? []) {
    const [centerA, centerB] = bond.atomIds
    for (const outerA of adjacency.get(centerA)!) {
      if (outerA === centerB) continue
      for (const outerB of adjacency.get(centerB)!) {
        if (outerB === centerA || outerB === outerA) continue
        const forward: [string, string, string, string] = [outerA, centerA, centerB, outerB]
        const reverse: [string, string, string, string] = [outerB, centerB, centerA, outerA]
        const canonical = compareIndexTuples(
          forward.map((id) => atomIndex.get(id)!),
          reverse.map((id) => atomIndex.get(id)!),
        ) <= 0 ? forward : reverse
        properByKey.set(canonical.join('\0'), canonical)
        if (properByKey.size > budgets.maxProperTorsions) {
          throw new ZatomForceFieldPackageInputError(
            'force_field_package_budget_exceeded',
            `Derived proper-torsion topology exceeds the ${budgets.maxProperTorsions} term parser budget`,
          )
        }
      }
    }
  }
  const propers = [...properByKey.values()].sort((left, right) => compareIndexTuples(
    left.map((id) => atomIndex.get(id)!),
    right.map((id) => atomIndex.get(id)!),
  ))
  return { adjacency, angles, propers }
}

function parsePeriodicTerms(value: unknown, field: string): ZatomForceFieldPackagePeriodicTerm[] {
  if (!Array.isArray(value) || !value.length || value.length > 32) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `${field} must contain 1-32 periodic torsion terms`,
    )
  }
  const terms = value.map((raw, index) => {
    const record = exactObject(raw, `${field}[${index}]`, ['periodicity', 'phaseRad', 'kKjMol'])
    return {
      periodicity: integerIn(record.periodicity, `${field}[${index}].periodicity`, 1, 12),
      phaseRad: numberIn(record.phaseRad, `${field}[${index}].phaseRad`, -2 * Math.PI, 2 * Math.PI),
      kKjMol: numberIn(record.kKjMol, `${field}[${index}].kKjMol`, -1e6, 1e6),
    }
  })
  terms.sort((left, right) => (
    left.periodicity - right.periodicity
    || left.phaseRad - right.phaseRad
    || left.kKjMol - right.kKjMol
  ))
  return terms
}


const ATOM_CHEMICAL_IDENTITY_KEYS = [
  'zatom.chemical.isotope',
  'zatom.chemical.aromatic',
  'zatom.chemical.chiralTag',
  'zatom.chemical.stereochemistry',
] as const
const BOND_CHEMICAL_IDENTITY_KEYS = [
  'zatom.chemical.aromatic',
  'zatom.chemical.stereochemistry',
  'zatom.chemical.stereoAtomIds',
] as const

function selectedChemicalIdentity(
  properties: Record<string, JsonValue> | undefined,
  keys: readonly string[],
): Record<string, JsonValue> {
  const selected: Record<string, JsonValue> = {}
  if (!properties) return selected
  for (const key of keys) {
    const value = properties[key]
    if (value !== undefined) selected[key] = value
  }
  return selected
}

export function fingerprintForceFieldPackage(value: ZatomForceFieldPackage): string {
  return fingerprintCanonicalJson(value)
}

export function fingerprintForceFieldTopology(structure: ZatomStructure): string {
  const atomIndex = new Map(structure.atoms.map((atom, index) => [atom.id, index]))
  const bonds = (structure.bonds ?? []).map((bond) => {
    const indices = bond.atomIds.map((atomId) => atomIndex.get(atomId) ?? Number.MAX_SAFE_INTEGER)
    const atomIds: [string, string] = indices[0] <= indices[1]
      ? [bond.atomIds[0], bond.atomIds[1]]
      : [bond.atomIds[1], bond.atomIds[0]]
    return {
      id: bond.id,
      atomIds,
      order: bond.order,
      chemicalIdentity: selectedChemicalIdentity(bond.properties, BOND_CHEMICAL_IDENTITY_KEYS),
    }
  }).sort((left, right) => (
    compareIndexTuples(left.atomIds.map((atomId) => atomIndex.get(atomId) ?? Number.MAX_SAFE_INTEGER), (
      right.atomIds.map((atomId) => atomIndex.get(atomId) ?? Number.MAX_SAFE_INTEGER)
    )) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  ))
  return fingerprintCanonicalJson({
    schemaVersion: structure.schemaVersion,
    atoms: structure.atoms.map((atom) => ({
      id: atom.id,
      element: atom.element,
      formalCharge: atom.properties?.formalCharge ?? null,
      chemicalIdentity: selectedChemicalIdentity(atom.properties, ATOM_CHEMICAL_IDENTITY_KEYS),
    })),
    bonds,
  })
}

export function parseZatomForceFieldPackage(
  value: unknown,
  options: ParseZatomForceFieldPackageOptions,
): ZatomForceFieldPackageValidation {
  const structure = parseZatomStructure(options.structure)
  if (structure.lattice) {
    throw new ZatomForceFieldPackageInputError(
      'unsupported_force_field_package_source',
      'force-field package v1 accepts one finite molecular topology without a lattice',
    )
  }
  if (structure.bonds === undefined) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_topology_required',
      'force-field package validation requires explicit source bonds',
    )
  }
  const invalidSourceCheckIds = new Set([
    'structure.atom_ids_unique',
    'structure.coordinates_finite',
    'structure.elements_known',
    'structure.bond_ids_unique',
    'structure.bond_endpoints_present',
    'structure.bond_pairs_valid',
    'structure.bond_orders_supported',
  ])
  const invalidSourceChecks = validateStructure(structure).checks.filter((check) => (
    check.status === 'fail' && invalidSourceCheckIds.has(check.id)
  ))
  if (invalidSourceChecks.length) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package_source',
      `Force-field package source violates canonical identity/topology requirements: ${invalidSourceChecks.map((check) => check.id).join(', ')}`,
    )
  }
  const maxAtoms = options.maxAtoms ?? 100_000
  const maxBonds = options.maxBonds ?? 500_000
  const maxAngles = options.maxAngles ?? 1_000_000
  const maxProperTorsions = options.maxProperTorsions ?? 2_000_000
  const maxImproperTorsions = options.maxImproperTorsions ?? 500_000
  const maxMetadataBytes = options.maxMetadataBytes ?? 1024 * 1024
  const budgets = [maxAtoms, maxBonds, maxAngles, maxProperTorsions, maxImproperTorsions, maxMetadataBytes]
  if (budgets.some((budget) => !Number.isSafeInteger(budget) || budget < 1)) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package_budget', 'Parser budgets must be positive safe integers')
  }
  if (structure.atoms.length > maxAtoms || structure.bonds.length > maxBonds) {
    throw new ZatomForceFieldPackageInputError('force_field_package_budget_exceeded', 'Source topology exceeds package parser budgets')
  }

  const root = exactObject(value, 'package', [
    'schemaVersion',
    'structureFingerprint',
    'topologyFingerprint',
    'atomIds',
    'template',
    'nonbonded',
    'atoms',
    'bonds',
    'angles',
    'properTorsions',
    'improperTorsions',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_FORCE_FIELD_PACKAGE_SCHEMA) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `package.schemaVersion must be ${ZATOM_FORCE_FIELD_PACKAGE_SCHEMA}`,
    )
  }
  const structureFingerprint = text(root.structureFingerprint, 'package.structureFingerprint', 128)
  const observedStructureFingerprint = fingerprintStructure(structure)
  const exactStructureMatch = structureFingerprint === observedStructureFingerprint
  if (!exactStructureMatch && options.allowCompatibleGeometry !== true) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_structure_mismatch',
      'package.structureFingerprint does not match the exact canonical source structure',
    )
  }
  const topologyFingerprint = text(root.topologyFingerprint, 'package.topologyFingerprint', 128)
  const observedTopologyFingerprint = fingerprintForceFieldTopology(structure)
  if (topologyFingerprint !== observedTopologyFingerprint) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_topology_mismatch',
      'package.topologyFingerprint does not match source atom/element/formal-charge/bond identity',
    )
  }
  if (!Array.isArray(root.atomIds)) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'package.atomIds must be an array')
  }
  const atomIds = root.atomIds.map((id, index) => text(id, `package.atomIds[${index}]`))
  const expectedAtomIds = structure.atoms.map((atom) => atom.id)
  if (atomIds.length !== expectedAtomIds.length || atomIds.some((id, index) => id !== expectedAtomIds[index])) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_atom_mapping_mismatch',
      'package.atomIds must exactly match source structure atom order',
    )
  }
  const atomIdSet = new Set(atomIds)
  const atomIndex = new Map(atomIds.map((id, index) => [id, index]))

  const rawTemplate = exactObject(root.template, 'package.template', ['residueName', 'externalBondAtomIds'])
  const residueName = token(rawTemplate.residueName, 'package.template.residueName', 32)
  const externalBondAtomIds = stringArray(
    rawTemplate.externalBondAtomIds,
    'package.template.externalBondAtomIds',
    atomIds.length,
    256,
  )
  if (externalBondAtomIds.some((id) => !atomIdSet.has(id))) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package.template.externalBondAtomIds references an absent atom',
    )
  }
  externalBondAtomIds.sort((left, right) => atomIndex.get(left)! - atomIndex.get(right)!)

  const rawNonbonded = exactObject(root.nonbonded, 'package.nonbonded', [
    'combiningRule', 'coulomb14Scale', 'lennardJones14Scale', 'useDispersionCorrection',
  ])
  if (rawNonbonded.combiningRule !== 'lorentz-berthelot' || typeof rawNonbonded.useDispersionCorrection !== 'boolean') {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package.nonbonded requires Lorentz-Berthelot and an explicit dispersion-correction boolean',
    )
  }
  const nonbonded: ZatomForceFieldPackage['nonbonded'] = {
    combiningRule: 'lorentz-berthelot',
    coulomb14Scale: numberIn(rawNonbonded.coulomb14Scale, 'package.nonbonded.coulomb14Scale', 0, 1),
    lennardJones14Scale: numberIn(rawNonbonded.lennardJones14Scale, 'package.nonbonded.lennardJones14Scale', 0, 1),
    useDispersionCorrection: rawNonbonded.useDispersionCorrection,
  }

  if (!Array.isArray(root.atoms) || root.atoms.length !== atomIds.length) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `package.atoms must align to all ${atomIds.length} source atoms`,
    )
  }
  const atoms = root.atoms.map((raw, index): ZatomForceFieldPackageAtom => {
    const record = exactObject(raw, `package.atoms[${index}]`, [
      'atomId', 'element', 'atomName', 'atomType', 'atomClass', 'massDa', 'partialChargeE', 'sigmaNm', 'epsilonKjMol',
    ])
    const atomId = text(record.atomId, `package.atoms[${index}].atomId`)
    const element = token(record.element, `package.atoms[${index}].element`, 3)
    if (atomId !== atomIds[index] || element !== structure.atoms[index].element) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_atom_mapping_mismatch',
        `package.atoms[${index}] does not match source atom ID/element`,
      )
    }
    return {
      atomId,
      element,
      atomName: token(record.atomName, `package.atoms[${index}].atomName`, 32),
      atomType: token(record.atomType, `package.atoms[${index}].atomType`),
      atomClass: token(record.atomClass, `package.atoms[${index}].atomClass`),
      massDa: numberIn(record.massDa, `package.atoms[${index}].massDa`, 0, 1000, true),
      partialChargeE: numberIn(record.partialChargeE, `package.atoms[${index}].partialChargeE`, -20, 20),
      sigmaNm: numberIn(record.sigmaNm, `package.atoms[${index}].sigmaNm`, 0, 10),
      epsilonKjMol: numberIn(record.epsilonKjMol, `package.atoms[${index}].epsilonKjMol`, 0, 1e6),
    }
  })
  if (new Set(atoms.map((atom) => atom.atomName)).size !== atoms.length) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package atomName values must be unique inside the residue template',
    )
  }

  if (!Array.isArray(root.bonds) || root.bonds.length !== structure.bonds.length || root.bonds.length > maxBonds) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_bond_coverage_mismatch',
      'package.bonds must contain exactly one term for every source bond',
    )
  }
  const rawBondById = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < root.bonds.length; index++) {
    const record = exactObject(root.bonds[index], `package.bonds[${index}]`, ['bondId', 'atomIds', 'lengthNm', 'kKjMolNm2'])
    const bondId = text(record.bondId, `package.bonds[${index}].bondId`)
    if (rawBondById.has(bondId)) {
      throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `package.bonds repeats ${bondId}`)
    }
    rawBondById.set(bondId, record)
  }
  const orderedSourceBonds = [...structure.bonds].sort((left, right) => {
    const leftIndices = left.atomIds.map((id) => atomIndex.get(id)!)
    const rightIndices = right.atomIds.map((id) => atomIndex.get(id)!)
    const tupleOrder = compareIndexTuples(
      [Math.min(...leftIndices), Math.max(...leftIndices)],
      [Math.min(...rightIndices), Math.max(...rightIndices)],
    )
    return tupleOrder || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  })
  const bonds = orderedSourceBonds.map((sourceBond, index): ZatomForceFieldPackageBond => {
    const record = rawBondById.get(sourceBond.id)
    if (!record) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_bond_coverage_mismatch',
        `package.bonds is missing source bond ${sourceBond.id}`,
      )
    }
    const ids = tupleIds(record.atomIds, `package bond ${sourceBond.id}.atomIds`, 2, atomIdSet)
    if (new Set(ids).size !== 2 || !sourceBond.atomIds.every((id) => ids.includes(id))) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_bond_coverage_mismatch',
        `package bond ${sourceBond.id} endpoints differ from source topology`,
      )
    }
    const canonicalAtomIds: [string, string] = atomIndex.get(sourceBond.atomIds[0])! <= atomIndex.get(sourceBond.atomIds[1])!
      ? [sourceBond.atomIds[0], sourceBond.atomIds[1]]
      : [sourceBond.atomIds[1], sourceBond.atomIds[0]]
    return {
      bondId: sourceBond.id,
      atomIds: canonicalAtomIds,
      lengthNm: numberIn(record.lengthNm, `package.bonds[${index}].lengthNm`, 0, 10, true),
      kKjMolNm2: numberIn(record.kKjMolNm2, `package.bonds[${index}].kKjMolNm2`, 0, 1e9),
    }
  })

  const paths = topologyPaths(structure, { maxAngles, maxProperTorsions })
  if (!Array.isArray(root.angles) || root.angles.length !== paths.angles.length) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_angle_coverage_mismatch',
      `package.angles must cover exactly ${paths.angles.length} topological angles`,
    )
  }
  const rawAngles = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < root.angles.length; index++) {
    const record = exactObject(root.angles[index], `package.angles[${index}]`, ['id', 'atomIds', 'angleRad', 'kKjMolRad2'])
    const ids = tupleIds(record.atomIds, `package.angles[${index}].atomIds`, 3, atomIdSet)
    const forward = ids as [string, string, string]
    const reverse: [string, string, string] = [ids[2], ids[1], ids[0]]
    const canonical = compareIndexTuples(
      forward.map((id) => atomIndex.get(id)!),
      reverse.map((id) => atomIndex.get(id)!),
    ) <= 0 ? forward : reverse
    const key = canonical.join('\0')
    if (rawAngles.has(key)) {
      throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `package.angles repeats ${canonical.join('-')}`)
    }
    rawAngles.set(key, record)
  }
  const angles = paths.angles.map((ids, index): ZatomForceFieldPackageAngle => {
    const record = rawAngles.get(ids.join('\0'))
    if (!record) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_angle_coverage_mismatch',
        `package.angles is missing ${ids.join('-')}`,
      )
    }
    return {
      id: text(record.id, `package angle ${ids.join('-')}.id`),
      atomIds: ids,
      angleRad: numberIn(record.angleRad, `package.angles[${index}].angleRad`, 0, Math.PI, true),
      kKjMolRad2: numberIn(record.kKjMolRad2, `package.angles[${index}].kKjMolRad2`, 0, 1e9),
    }
  })
  if (new Set(angles.map((angle) => angle.id)).size !== angles.length) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'package angle IDs must be unique')
  }

  if (!Array.isArray(root.properTorsions) || root.properTorsions.length !== paths.propers.length) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_proper_coverage_mismatch',
      `package.properTorsions must cover exactly ${paths.propers.length} topological proper torsions`,
    )
  }
  const rawPropers = new Map<string, Record<string, unknown>>()
  for (let index = 0; index < root.properTorsions.length; index++) {
    const record = exactObject(root.properTorsions[index], `package.properTorsions[${index}]`, ['id', 'atomIds', 'terms'])
    const ids = tupleIds(record.atomIds, `package.properTorsions[${index}].atomIds`, 4, atomIdSet)
    const forward = ids as [string, string, string, string]
    const reverse: [string, string, string, string] = [ids[3], ids[2], ids[1], ids[0]]
    const canonical = compareIndexTuples(
      forward.map((id) => atomIndex.get(id)!),
      reverse.map((id) => atomIndex.get(id)!),
    ) <= 0 ? forward : reverse
    const key = canonical.join('\0')
    if (rawPropers.has(key)) {
      throw new ZatomForceFieldPackageInputError('invalid_force_field_package', `package.properTorsions repeats ${canonical.join('-')}`)
    }
    rawPropers.set(key, record)
  }
  const properTorsions = paths.propers.map((ids, index): ZatomForceFieldPackageProperTorsion => {
    const record = rawPropers.get(ids.join('\0'))
    if (!record) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_proper_coverage_mismatch',
        `package.properTorsions is missing ${ids.join('-')}`,
      )
    }
    return {
      id: text(record.id, `package proper ${ids.join('-')}.id`),
      atomIds: ids,
      terms: parsePeriodicTerms(record.terms, `package.properTorsions[${index}].terms`),
    }
  })
  if (new Set(properTorsions.map((torsion) => torsion.id)).size !== properTorsions.length) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'package proper torsion IDs must be unique')
  }

  if (!Array.isArray(root.improperTorsions) || root.improperTorsions.length > maxImproperTorsions) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      `package.improperTorsions must contain at most ${maxImproperTorsions} entries`,
    )
  }
  const improperTorsions = root.improperTorsions.map((raw, index): ZatomForceFieldPackageImproperTorsion => {
    const record = exactObject(raw, `package.improperTorsions[${index}]`, ['id', 'atomIds', 'centralAtomId', 'terms'])
    const ids = tupleIds(record.atomIds, `package.improperTorsions[${index}].atomIds`, 4, atomIdSet) as [string, string, string, string]
    const centralAtomId = text(record.centralAtomId, `package.improperTorsions[${index}].centralAtomId`)
    if (ids[0] !== centralAtomId || ids.some((id) => id !== centralAtomId && !paths.adjacency.get(centralAtomId)?.has(id))) {
      throw new ZatomForceFieldPackageInputError(
        'invalid_force_field_package',
        `package.improperTorsions[${index}] must place its central atom first and bond it to the other three atoms`,
      )
    }
    return {
      id: text(record.id, `package.improperTorsions[${index}].id`),
      atomIds: ids,
      centralAtomId,
      terms: parsePeriodicTerms(record.terms, `package.improperTorsions[${index}].terms`),
    }
  }).sort((left, right) => (
    compareIndexTuples(
      left.atomIds.map((atomId) => atomIndex.get(atomId)!),
      right.atomIds.map((atomId) => atomIndex.get(atomId)!),
    ) || compareCanonicalText(left.id, right.id)
  ))
  if (new Set(improperTorsions.map((torsion) => torsion.id)).size !== improperTorsions.length) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'package improper torsion IDs must be unique')
  }
  const improperOrientationKeys = improperTorsions.map((torsion) => torsion.atomIds.join('\0'))
  if (new Set(improperOrientationKeys).size !== improperOrientationKeys.length) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package.improperTorsions must combine all periodic terms for one ordered central-first orientation into one entry',
    )
  }

  const rawProvenance = exactObject(root.provenance, 'package.provenance', [
    'engine',
    'engineVersion',
    'method',
    'parameterizationFamily',
    'chargeModel',
    'totalCharge',
    'citations',
    'scopeWarning',
    'sourceArtifacts',
  ])
  const totalCharge = integerIn(rawProvenance.totalCharge, 'package.provenance.totalCharge', -10_000, 10_000)
  const chargeSum = atoms.reduce((sum, atom) => sum + atom.partialChargeE, 0)
  if (Math.abs(chargeSum - totalCharge) > 1e-6) {
    throw new ZatomForceFieldPackageInputError(
      'force_field_package_charge_mismatch',
      `Package partial charges sum to ${chargeSum}, not declared integer total ${totalCharge}`,
    )
  }
  const sourceFormalCharges = structure.atoms.map((atom) => atom.properties?.formalCharge)
  if (sourceFormalCharges.some((charge) => charge !== undefined)) {
    const completeFormalCharges = sourceFormalCharges.every((charge): charge is number => (
      typeof charge === 'number' && Number.isInteger(charge)
    ))
    if (!completeFormalCharges
      || sourceFormalCharges.reduce<number>((sum, charge) => sum + Number(charge), 0) !== totalCharge) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_charge_mismatch',
        'Source formal-charge annotations are partial, non-integer, or differ from package total charge',
      )
    }
  }
  if (!Array.isArray(rawProvenance.citations) || rawProvenance.citations.length < 1) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package.provenance.citations must contain at least one reference',
    )
  }
  const citations = stringArray(rawProvenance.citations, 'package.provenance.citations', 32)
    .sort(compareCanonicalText)
  if (!Array.isArray(rawProvenance.sourceArtifacts) || rawProvenance.sourceArtifacts.length > 32) {
    throw new ZatomForceFieldPackageInputError(
      'invalid_force_field_package',
      'package.provenance.sourceArtifacts must contain at most 32 entries',
    )
  }
  const sourceArtifacts = rawProvenance.sourceArtifacts.map((raw, index) => {
    const record = exactObject(raw, `package.provenance.sourceArtifacts[${index}]`, ['label', 'sha256'])
    const label = token(record.label, `package.provenance.sourceArtifacts[${index}].label`, 128)
    const sha256 = text(record.sha256, `package.provenance.sourceArtifacts[${index}].sha256`, 64).toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new ZatomForceFieldPackageInputError(
        'invalid_force_field_package',
        `package.provenance.sourceArtifacts[${index}].sha256 must be 64 lowercase hexadecimal characters`,
      )
    }
    return { label, sha256 }
  }).sort((left, right) => compareCanonicalText(left.label, right.label))
  if (new Set(sourceArtifacts.map((artifact) => artifact.label)).size !== sourceArtifacts.length) {
    throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'Source artifact labels must be unique')
  }
  const provenance: ZatomForceFieldPackage['provenance'] = {
    engine: text(rawProvenance.engine, 'package.provenance.engine'),
    engineVersion: text(rawProvenance.engineVersion, 'package.provenance.engineVersion'),
    method: text(rawProvenance.method, 'package.provenance.method'),
    parameterizationFamily: text(rawProvenance.parameterizationFamily, 'package.provenance.parameterizationFamily'),
    chargeModel: text(rawProvenance.chargeModel, 'package.provenance.chargeModel'),
    totalCharge,
    citations,
    scopeWarning: text(rawProvenance.scopeWarning, 'package.provenance.scopeWarning', 4096),
    sourceArtifacts,
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    if (!isRecord(root.metadata)) {
      throw new ZatomForceFieldPackageInputError('invalid_force_field_package', 'package.metadata must be an object')
    }
    metadata = jsonValue(root.metadata, 'package.metadata') as Record<string, JsonValue>
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > maxMetadataBytes) {
      throw new ZatomForceFieldPackageInputError(
        'force_field_package_budget_exceeded',
        `package.metadata exceeds ${maxMetadataBytes} bytes`,
      )
    }
  }

  const parsedPackage: ZatomForceFieldPackage = {
    schemaVersion: ZATOM_FORCE_FIELD_PACKAGE_SCHEMA,
    structureFingerprint,
    topologyFingerprint,
    atomIds,
    template: { residueName, externalBondAtomIds },
    nonbonded,
    atoms,
    bonds,
    angles,
    properTorsions,
    improperTorsions,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const fingerprint = fingerprintForceFieldPackage(parsedPackage)
  const maximumChargeAtomIndex = atoms.reduce((best, atom, index) => (
    Math.abs(atom.partialChargeE) > Math.abs(atoms[best].partialChargeE) ? index : best
  ), 0)
  const maximumEpsilonAtomIndex = atoms.reduce((best, atom, index) => (
    atom.epsilonKjMol > atoms[best].epsilonKjMol ? index : best
  ), 0)
  let largestBondDeviation: { index: number; deviationA: number; currentA: number } | null = null
  for (let index = 0; index < bonds.length; index++) {
    const bond = bonds[index]
    const currentA = distance(
      structure.atoms[atomIndex.get(bond.atomIds[0])!].position,
      structure.atoms[atomIndex.get(bond.atomIds[1])!].position,
    )
    const deviationA = Math.abs(currentA - bond.lengthNm * 10)
    if (!largestBondDeviation || deviationA > largestBondDeviation.deviationA) {
      largestBondDeviation = { index, deviationA, currentA }
    }
  }
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const checks: ValidationCheck[] = [
    {
      id: 'force_field_package.identity',
      status: 'pass',
      message: exactStructureMatch
        ? `Package ${fingerprint} matches its exact parameterization source and topology for ${atomIds.length} ordered atoms`
        : `Package ${fingerprint} is reused on topology-identical geometry; original structure ${structureFingerprint}, current ${observedStructureFingerprint}`,
      metrics: {
        atomCount: atomIds.length,
        packageFingerprint: fingerprint,
        topologyFingerprint,
        exactStructureMatch,
        bindingMode: exactStructureMatch ? 'exact-source' : 'topology-compatible',
      },
    },
    {
      id: 'force_field_package.atom_parameters',
      status: 'pass',
      message: 'Every source atom has one bounded mass, fixed charge, Lennard-Jones parameter, atom name/type/class, and matching element',
      metrics: {
        atomCount: atoms.length,
        maximumAbsolutePartialChargeE: Math.abs(atoms[maximumChargeAtomIndex].partialChargeE),
        maximumEpsilonKjMol: atoms[maximumEpsilonAtomIndex].epsilonKjMol,
      },
      atomIds: [atoms[maximumChargeAtomIndex].atomId],
    },
    {
      id: 'force_field_package.fixed_charge',
      status: 'pass',
      message: `Partial charges sum to declared integer total ${totalCharge} e within 1e-6 e`,
      metrics: { declaredTotalChargeE: totalCharge, partialChargeSumE: chargeSum, toleranceE: 1e-6 },
    },
    {
      id: 'force_field_package.bonded_coverage',
      status: 'pass',
      message: `Package covers ${bonds.length} bonds, ${angles.length} graph angles, ${properTorsions.length} graph proper torsions, and ${improperTorsions.length} validated impropers`,
      metrics: {
        bondCount: bonds.length,
        angleCount: angles.length,
        properTorsionCount: properTorsions.length,
        improperTorsionCount: improperTorsions.length,
      },
    },
    {
      id: 'force_field_package.nonbonded_contract',
      status: 'pass',
      message: 'Package explicitly declares standard Lorentz-Berthelot mixing, Coulomb/LJ 1-4 scales, and dispersion policy',
      metrics: {
        combiningRule: nonbonded.combiningRule,
        coulomb14Scale: nonbonded.coulomb14Scale,
        lennardJones14Scale: nonbonded.lennardJones14Scale,
        useDispersionCorrection: nonbonded.useDispersionCorrection,
      },
    },
    {
      id: 'force_field_package.provenance',
      status: 'pass',
      message: `Parameterization provenance names ${provenance.engine} ${provenance.engineVersion}, method, family, charge model, scope, references, and ${sourceArtifacts.length} hashed source artifact(s)`,
      metrics: {
        engine: provenance.engine,
        engineVersion: provenance.engineVersion,
        method: provenance.method,
        parameterizationFamily: provenance.parameterizationFamily,
        chargeModel: provenance.chargeModel,
        citationCount: citations.length,
        sourceArtifactCount: sourceArtifacts.length,
      },
    },
    {
      id: 'force_field_package.geometry_reference',
      status: 'warn',
      message: largestBondDeviation
        ? `Largest current-versus-equilibrium bond-length difference is ${largestBondDeviation.deviationA.toFixed(6)} Å; the input geometry need not be at the force-field minimum`
        : 'The monatomic package has no bond equilibrium geometry to compare',
      metrics: largestBondDeviation ? {
        maximumBondEquilibriumDeviationA: largestBondDeviation.deviationA,
        currentBondLengthA: largestBondDeviation.currentA,
        equilibriumBondLengthA: bonds[largestBondDeviation.index].lengthNm * 10,
      } : { bondCount: 0 },
      ...(largestBondDeviation ? { atomIds: [...bonds[largestBondDeviation.index].atomIds] } : {}),
    },
    {
      id: 'force_field_package.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} Contract validity and topology coverage do not establish parameter accuracy, transferability, protonation-state correctness, conformational sampling, or compatibility with another force field.`,
    },
  ]
  const inspectionTargets: InspectionTarget[] = [
    ...(bounds ? [{
      id: 'force-field-package-overview',
      reason: 'Inspect the complete topology bound to the force-field parameter package',
      center: bounds.center,
      radius: Math.max(1.5, bounds.radius + 0.5),
      atomIds: atomIds.slice(0, 80),
      ...(atomIds.length > 80 ? { atomIdsTruncated: true } : {}),
    }] : []),
    {
      id: 'force-field-package-largest-charge',
      reason: `Inspect the atom with largest absolute fixed charge (${atoms[maximumChargeAtomIndex].partialChargeE.toFixed(6)} e)`,
      center: [...structure.atoms[maximumChargeAtomIndex].position],
      radius: 2,
      atomIds: [atoms[maximumChargeAtomIndex].atomId],
    },
    {
      id: 'force-field-package-largest-epsilon',
      reason: `Inspect the atom with largest Lennard-Jones epsilon (${atoms[maximumEpsilonAtomIndex].epsilonKjMol.toFixed(6)} kJ/mol)`,
      center: [...structure.atoms[maximumEpsilonAtomIndex].position],
      radius: 2,
      atomIds: [atoms[maximumEpsilonAtomIndex].atomId],
    },
  ]
  if (largestBondDeviation) {
    const bond = bonds[largestBondDeviation.index]
    const left = structure.atoms[atomIndex.get(bond.atomIds[0])!].position
    const right = structure.atoms[atomIndex.get(bond.atomIds[1])!].position
    inspectionTargets.push({
      id: 'force-field-package-largest-bond-deviation',
      reason: `Inspect the bond with largest current-versus-equilibrium length difference (${largestBondDeviation.deviationA.toFixed(6)} Å)`,
      center: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2],
      radius: Math.max(1.5, largestBondDeviation.currentA + 0.5),
      atomIds: [...bond.atomIds],
    })
  }
  return {
    package: parsedPackage,
    fingerprint,
    bindingMode: exactStructureMatch ? 'exact-source' : 'topology-compatible',
    checks,
    inspectionTargets,
  }
}
