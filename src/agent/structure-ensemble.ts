/** Canonical fixed-topology structural-hypothesis ensembles with calibrated weights. */

import type {
  InspectionTarget,
  JsonValue,
  ValidationCheck,
  ZatomStructure,
} from './contracts'
import { fingerprintForceFieldTopology } from './force-field-package'
import {
  boundsOfPositions,
  createFnv1a64Hasher,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import {
  parseZatomStructure,
  validateStructure,
  ZatomStructureInputError,
} from './structure-validation'

export const ZATOM_STRUCTURE_ENSEMBLE_SCHEMA = 'zatom.structure-ensemble/v1' as const

const GAS_CONSTANT_KCAL_PER_MOL_K = 0.00198720425864083

export type ZatomStructureEnsembleWeightKind =
  | 'posterior-probability'
  | 'bootstrap-frequency'
  | 'model-averaging-weight'
  | 'boltzmann-potential-energy'
  | 'boltzmann-free-energy'
  | 'other-calibrated-probability'

export interface ZatomStructureEnsembleMember {
  id: string
  weight: number
  structureFingerprint: string
  structure: ZatomStructure
  evidenceSourceIds: string[]
  /** Required and zero-referenced only for `boltzmann-potential-energy`. */
  relativePotentialEnergyKcalMol?: number
  /** Required and zero-referenced only for `boltzmann-free-energy`. */
  relativeFreeEnergyKcalMol?: number
}

export interface ZatomStructureEnsembleEvidenceSource {
  id: string
  engine: string
  engineVersion: string
  method: string
  artifacts: Array<{ id: string; role: string; fingerprint: string }>
  citations: string[]
  scopeWarning: string
}

export interface ZatomStructureEnsemble {
  schemaVersion: typeof ZATOM_STRUCTURE_ENSEMBLE_SCHEMA
  /** Coordinate-independent ordered atom/bond/formal-charge/stereochemical identity. */
  topologyFingerprint: string
  members: ZatomStructureEnsembleMember[]
  selection: {
    selectedMemberId: string
    method: 'explicit' | 'maximum-weight'
    rationale: string
  }
  weightModel: {
    kind: ZatomStructureEnsembleWeightKind
    /** Required only for either Boltzmann energy kind. */
    temperatureK?: number
    method: string
    assumptions: string[]
    applicability: {
      assessment: 'in-domain' | 'unknown' | 'out-of-domain'
      domain: string
      reasons: string[]
    }
    scopeWarning: string
  }
  acceptance: {
    minimumWeightEffectiveMemberCount: number
  }
  evidenceSources: ZatomStructureEnsembleEvidenceSource[]
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

export interface ParseZatomStructureEnsembleOptions {
  /** Exact structure currently selected for visualization and downstream handoff. */
  selectedStructure: ZatomStructure
  maxMembers?: number
  maxAtomsPerMember?: number
  maxMemberAtoms?: number
  maxPairDistanceEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomStructureEnsembleMemberGeometryDiagnostic {
  memberId: string
  internalDistanceRmsdToSelectedA: number
}

export interface ZatomStructureEnsembleAtomGeometryDiagnostic {
  atomId: string
  /** RMS pair-distance-profile difference between two independent weighted member draws. */
  expectedPairwiseMemberDistanceProfileRmsdA: number
}

export interface ZatomStructureEnsembleGeometryDiagnostics {
  metric: 'pair-distance-matrix-rmsd'
  atomCount: number
  atomPairCount: number
  pairDistanceEvaluationCount: number
  /** Square root of the expected weighted squared RMS difference between two member distance matrices. */
  expectedPairwiseMemberDistanceMatrixRmsdA: number
  maximumInternalDistanceRmsdToSelectedA: number
  maximumInternalDistanceRmsdMemberIds: string[]
  minimumMemberPairDistanceA: number
  minimumMemberPair: { memberId: string; atomIds: [string, string] }
  memberDiagnostics: ZatomStructureEnsembleMemberGeometryDiagnostic[]
  atomDiagnostics: ZatomStructureEnsembleAtomGeometryDiagnostic[]
  rigidTransformDuplicateGroups: string[][]
}

export interface ZatomStructureEnsembleValidation {
  ensemble: ZatomStructureEnsemble
  fingerprint: string
  weightEffectiveMemberCount: number
  geometryDiagnostics: ZatomStructureEnsembleGeometryDiagnostics
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomStructureEnsembleInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomStructureEnsembleInputError'
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
    throw new ZatomStructureEnsembleInputError('invalid_structure_ensemble', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string, maximum = 128): string {
  const result = text(value, field, maximum)
  if (!/^[A-Za-z0-9_.:+@/-]+$/.test(result)) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} contains unsupported token characters`,
    )
  }
  return result
}

function numberIn(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function positiveSafeInteger(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble_context',
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
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`, maximumTextLength))
  if (new Set(result).size !== result.length) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} must not repeat entries`,
    )
  }
  return result.sort(compareText)
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        `${field} must contain only finite JSON numbers`,
      )
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  }
  throw new ZatomStructureEnsembleInputError(
    'invalid_structure_ensemble',
    `${field} must be JSON-safe`,
  )
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomStructureEnsembleInputError('invalid_structure_ensemble', `${field} must be an object`)
  }
  return jsonValue(value, field) as Record<string, JsonValue>
}

function normalizeStructure(value: unknown, field: string): ZatomStructure {
  let parsed: ZatomStructure
  try {
    parsed = parseZatomStructure(value)
  } catch (error) {
    if (error instanceof ZatomStructureInputError) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_member_invalid',
        `${field} is invalid: ${error.message}`,
      )
    }
    throw error
  }
  const structure: ZatomStructure = {
    schemaVersion: parsed.schemaVersion,
    atoms: parsed.atoms.map((atom, index) => ({
      id: atom.id,
      element: atom.element,
      position: atom.position.map((item) => Object.is(item, -0) ? 0 : item) as [number, number, number],
      ...(atom.properties ? { properties: jsonRecord(atom.properties, `${field}.atoms[${index}].properties`) } : {}),
    })),
    ...(parsed.bonds ? {
      bonds: parsed.bonds.map((bond, index) => ({
        id: bond.id,
        atomIds: [...bond.atomIds],
        order: bond.order,
        ...(bond.properties ? { properties: jsonRecord(bond.properties, `${field}.bonds[${index}].properties`) } : {}),
      })),
    } : {}),
    ...(parsed.label === undefined ? {} : { label: parsed.label }),
    ...(parsed.metadata ? { metadata: jsonRecord(parsed.metadata, `${field}.metadata`) } : {}),
  }
  if (parsed.lattice) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_member_invalid',
      `${field} must be finite and nonperiodic; periodic/cell uncertainty requires a separate contract`,
    )
  }
  if (structure.atoms.length < 2 || structure.bonds === undefined) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_member_invalid',
      `${field} must contain at least two atoms and explicit bonds`,
    )
  }
  const validation = validateStructure(structure, { maxPairScanAtoms: 2 })
  // Pair separation is an ensemble acceptance result below, where the worst
  // member and its inspection target are reported. Keep parsing that member so
  // callers receive the scientific failure as structured evidence; all other
  // canonical failures still make the contract itself invalid.
  const failures = validation.checks.filter((check) => (
    check.status === 'fail' && check.id !== 'structure.minimum_distance'
  ))
  if (failures.length) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_member_invalid',
      `${field} fails canonical structure checks: ${failures.map((check) => check.id).join(', ')}`,
    )
  }
  return structure
}

function parseArtifacts(value: unknown, field: string): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} must contain 1-64 immutable artifacts`,
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
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `${field} artifact IDs must be unique`,
    )
  }
  return artifacts
}


export function fingerprintStructureEnsemble(value: ZatomStructureEnsemble): string {
  return fingerprintCanonicalJson(value)
}

export function structureEnsembleWeightEffectiveMemberCount(
  members: readonly Pick<ZatomStructureEnsembleMember, 'weight'>[],
): number {
  return 1 / members.reduce((sum, member) => sum + member.weight ** 2, 0)
}

function geometrySignature(distances: ArrayLike<number>): string {
  const hasher = createFnv1a64Hasher()
  for (let distanceIndex = 0; distanceIndex < distances.length; distanceIndex++) {
    hasher.feed(`${Math.round(distances[distanceIndex] * 1e8)};`)
  }
  return hasher.digest().slice('fnv1a64:'.length)
}

function computeGeometryDiagnostics(
  members: readonly ZatomStructureEnsembleMember[],
  selectedMemberId: string,
): ZatomStructureEnsembleGeometryDiagnostics {
  const atomCount = members[0].structure.atoms.length
  const atomPairCount = atomCount * (atomCount - 1) / 2
  const weightedSums = new Float64Array(atomPairCount)
  const weightedSquares = new Float64Array(atomPairCount)
  const selectedMember = members.find((member) => member.id === selectedMemberId)!
  const memberOrder = [selectedMember, ...members.filter((member) => member.id !== selectedMemberId)]
  const selectedDistances = new Float64Array(atomPairCount)
  const memberDiagnosticsById = new Map<string, ZatomStructureEnsembleMemberGeometryDiagnostic>()
  const signatureMembers = new Map<string, string[]>()
  let minimumMemberPairDistanceA = Number.POSITIVE_INFINITY
  let minimumMemberPair: { memberId: string; atomIds: [string, string] } | undefined

  memberOrder.forEach((member, memberIndex) => {
    const distances = new Float64Array(atomPairCount)
    let pairIndex = 0
    for (let left = 0; left < atomCount; left++) {
      const leftPosition = member.structure.atoms[left].position
      for (let right = left + 1; right < atomCount; right++) {
        const rightPosition = member.structure.atoms[right].position
        const distance = Math.hypot(
          leftPosition[0] - rightPosition[0],
          leftPosition[1] - rightPosition[1],
          leftPosition[2] - rightPosition[2],
        )
        if (distance < minimumMemberPairDistanceA) {
          minimumMemberPairDistanceA = distance
          minimumMemberPair = {
            memberId: member.id,
            atomIds: [member.structure.atoms[left].id, member.structure.atoms[right].id],
          }
        }
        distances[pairIndex] = distance
        if (memberIndex === 0) selectedDistances[pairIndex] = distance
        weightedSums[pairIndex] += member.weight * distance
        weightedSquares[pairIndex] += member.weight * distance * distance
        pairIndex++
      }
    }
    let selectedDifferenceSum = 0
    for (let index = 0; index < atomPairCount; index++) {
      selectedDifferenceSum += (distances[index] - selectedDistances[index]) ** 2
    }
    memberDiagnosticsById.set(member.id, {
      memberId: member.id,
      internalDistanceRmsdToSelectedA: Math.sqrt(selectedDifferenceSum / atomPairCount),
    })
    const signature = geometrySignature(distances)
    signatureMembers.set(signature, [...(signatureMembers.get(signature) ?? []), member.id].sort(compareText))
  })

  const atomSquaredSpreads = new Float64Array(atomCount)
  let globalSquaredSpread = 0
  let pairIndex = 0
  for (let left = 0; left < atomCount; left++) {
    for (let right = left + 1; right < atomCount; right++) {
      const variance = Math.max(0, weightedSquares[pairIndex] - weightedSums[pairIndex] ** 2)
      const expectedSquaredDifference = 2 * variance
      globalSquaredSpread += expectedSquaredDifference
      atomSquaredSpreads[left] += expectedSquaredDifference
      atomSquaredSpreads[right] += expectedSquaredDifference
      pairIndex++
    }
  }
  const memberDiagnostics = members.map((member) => memberDiagnosticsById.get(member.id)!)
  const maximumInternalDistanceRmsdToSelectedA = Math.max(
    ...memberDiagnostics.map((diagnostic) => diagnostic.internalDistanceRmsdToSelectedA),
  )
  const maximumInternalDistanceRmsdMemberIds = memberDiagnostics
    .filter((diagnostic) => Math.abs(
      diagnostic.internalDistanceRmsdToSelectedA - maximumInternalDistanceRmsdToSelectedA,
    ) <= 1e-12)
    .map((diagnostic) => diagnostic.memberId)
  return {
    metric: 'pair-distance-matrix-rmsd',
    atomCount,
    atomPairCount,
    pairDistanceEvaluationCount: members.length * atomPairCount,
    expectedPairwiseMemberDistanceMatrixRmsdA: Math.sqrt(globalSquaredSpread / atomPairCount),
    maximumInternalDistanceRmsdToSelectedA,
    maximumInternalDistanceRmsdMemberIds,
    minimumMemberPairDistanceA,
    minimumMemberPair: minimumMemberPair!,
    memberDiagnostics,
    atomDiagnostics: members[0].structure.atoms.map((atom, atomIndex) => ({
      atomId: atom.id,
      expectedPairwiseMemberDistanceProfileRmsdA: Math.sqrt(atomSquaredSpreads[atomIndex] / (atomCount - 1)),
    })),
    rigidTransformDuplicateGroups: [...signatureMembers.values()]
      .filter((memberIds) => memberIds.length > 1)
      .sort((left, right) => compareText(left[0], right[0])),
  }
}

export function parseZatomStructureEnsemble(
  value: unknown,
  options: ParseZatomStructureEnsembleOptions,
): ZatomStructureEnsembleValidation {
  const maxMembers = positiveSafeInteger(options.maxMembers, 256, 'maxMembers')
  const maxAtomsPerMember = positiveSafeInteger(options.maxAtomsPerMember, 10_000, 'maxAtomsPerMember')
  const maxMemberAtoms = positiveSafeInteger(options.maxMemberAtoms, 1_000_000, 'maxMemberAtoms')
  const maxPairDistanceEvaluations = positiveSafeInteger(
    options.maxPairDistanceEvaluations,
    10_000_000,
    'maxPairDistanceEvaluations',
  )
  const maxMetadataBytes = positiveSafeInteger(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const maxArtifactBytes = positiveSafeInteger(options.maxArtifactBytes, 32 * 1024 * 1024, 'maxArtifactBytes')
  const root = exactObject(value, 'structureEnsemble', [
    'schemaVersion',
    'topologyFingerprint',
    'members',
    'selection',
    'weightModel',
    'acceptance',
    'evidenceSources',
    'provenance',
  ], ['metadata'])
  if (root.schemaVersion !== ZATOM_STRUCTURE_ENSEMBLE_SCHEMA) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      `structureEnsemble.schemaVersion must be ${ZATOM_STRUCTURE_ENSEMBLE_SCHEMA}`,
    )
  }
  const topologyFingerprint = text(root.topologyFingerprint, 'structureEnsemble.topologyFingerprint', 128)
  if (!Array.isArray(root.evidenceSources)
    || root.evidenceSources.length < 1
    || root.evidenceSources.length > 64) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.evidenceSources must contain 1-64 entries',
    )
  }
  const evidenceSources = root.evidenceSources.map((raw, index): ZatomStructureEnsembleEvidenceSource => {
    const field = `structureEnsemble.evidenceSources[${index}]`
    const record = exactObject(raw, field, [
      'id', 'engine', 'engineVersion', 'method', 'artifacts', 'citations', 'scopeWarning',
    ])
    return {
      id: token(record.id, `${field}.id`),
      engine: text(record.engine, `${field}.engine`, 256),
      engineVersion: text(record.engineVersion, `${field}.engineVersion`, 256),
      method: text(record.method, `${field}.method`),
      artifacts: parseArtifacts(record.artifacts, `${field}.artifacts`),
      citations: uniqueTextList(record.citations, `${field}.citations`, 1, 32),
      scopeWarning: text(record.scopeWarning, `${field}.scopeWarning`, 8192),
    }
  }).sort((left, right) => compareText(left.id, right.id))
  if (new Set(evidenceSources.map((source) => source.id)).size !== evidenceSources.length) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.evidenceSources IDs must be unique',
    )
  }
  const evidenceSourceIds = new Set(evidenceSources.map((source) => source.id))

  const rawWeightModel = exactObject(root.weightModel, 'structureEnsemble.weightModel', [
    'kind', 'method', 'assumptions', 'applicability', 'scopeWarning',
  ], ['temperatureK'])
  const weightKinds = new Set<ZatomStructureEnsembleWeightKind>([
    'posterior-probability',
    'bootstrap-frequency',
    'model-averaging-weight',
    'boltzmann-potential-energy',
    'boltzmann-free-energy',
    'other-calibrated-probability',
  ])
  if (!weightKinds.has(rawWeightModel.kind as ZatomStructureEnsembleWeightKind)) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.weightModel.kind is unsupported',
    )
  }
  const weightKind = rawWeightModel.kind as ZatomStructureEnsembleWeightKind
  const isBoltzmann = weightKind === 'boltzmann-potential-energy'
    || weightKind === 'boltzmann-free-energy'
  const rawApplicability = exactObject(
    rawWeightModel.applicability,
    'structureEnsemble.weightModel.applicability',
    ['assessment', 'domain', 'reasons'],
  )
  if (rawApplicability.assessment !== 'in-domain'
    && rawApplicability.assessment !== 'unknown'
    && rawApplicability.assessment !== 'out-of-domain') {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.weightModel.applicability.assessment is unsupported',
    )
  }
  if (isBoltzmann && rawWeightModel.temperatureK === undefined) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'Boltzmann structure ensembles require weightModel.temperatureK',
    )
  }
  if (!isBoltzmann && rawWeightModel.temperatureK !== undefined) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'weightModel.temperatureK is reserved for Boltzmann energy ensembles',
    )
  }
  const weightModel: ZatomStructureEnsemble['weightModel'] = {
    kind: weightKind,
    ...(isBoltzmann ? {
      temperatureK: numberIn(
        rawWeightModel.temperatureK,
        'structureEnsemble.weightModel.temperatureK',
        1,
        100_000,
      ),
    } : {}),
    method: text(rawWeightModel.method, 'structureEnsemble.weightModel.method'),
    assumptions: uniqueTextList(rawWeightModel.assumptions, 'structureEnsemble.weightModel.assumptions'),
    applicability: {
      assessment: rawApplicability.assessment,
      domain: text(rawApplicability.domain, 'structureEnsemble.weightModel.applicability.domain', 8192),
      reasons: uniqueTextList(
        rawApplicability.reasons,
        'structureEnsemble.weightModel.applicability.reasons',
      ),
    },
    scopeWarning: text(rawWeightModel.scopeWarning, 'structureEnsemble.weightModel.scopeWarning', 8192),
  }

  if (!Array.isArray(root.members) || root.members.length < 2 || root.members.length > maxMembers) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_budget_exceeded',
      `structureEnsemble.members must contain 2-${maxMembers} entries`,
    )
  }
  const rawMembers = root.members.map((raw, index) => {
    const field = `structureEnsemble.members[${index}]`
    const record = exactObject(raw, field, [
      'id', 'weight', 'structureFingerprint', 'structure', 'evidenceSourceIds',
    ], ['relativePotentialEnergyKcalMol', 'relativeFreeEnergyKcalMol'])
    const structure = normalizeStructure(record.structure, `${field}.structure`)
    if (structure.atoms.length > maxAtomsPerMember) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_budget_exceeded',
        `${field}.structure has ${structure.atoms.length} atoms; limit is ${maxAtomsPerMember}`,
      )
    }
    const observedFingerprint = fingerprintStructure(structure)
    const structureFingerprint = text(record.structureFingerprint, `${field}.structureFingerprint`, 128)
    if (structureFingerprint !== observedFingerprint) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_structure_fingerprint_mismatch',
        `${field}.structureFingerprint does not match its exact structure`,
      )
    }
    const observedTopologyFingerprint = fingerprintForceFieldTopology(structure)
    if (observedTopologyFingerprint !== topologyFingerprint) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_topology_mismatch',
        `${field}.structure does not share topology ${topologyFingerprint}`,
      )
    }
    const referencedSourceIds = uniqueTextList(
      record.evidenceSourceIds,
      `${field}.evidenceSourceIds`,
      1,
      64,
      128,
    ).map((sourceId) => token(sourceId, `${field}.evidenceSourceIds`))
    const missingSources = referencedSourceIds.filter((sourceId) => !evidenceSourceIds.has(sourceId))
    if (missingSources.length) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_evidence_mismatch',
        `${field} references unknown evidence sources: ${missingSources.join(', ')}`,
      )
    }
    if (weightKind === 'boltzmann-potential-energy'
      && record.relativePotentialEnergyKcalMol === undefined) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        `${field}.relativePotentialEnergyKcalMol is required for potential-energy Boltzmann weighting`,
      )
    }
    if (weightKind !== 'boltzmann-potential-energy'
      && record.relativePotentialEnergyKcalMol !== undefined) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        `${field}.relativePotentialEnergyKcalMol is allowed only for potential-energy Boltzmann weighting`,
      )
    }
    if (weightKind === 'boltzmann-free-energy' && record.relativeFreeEnergyKcalMol === undefined) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        `${field}.relativeFreeEnergyKcalMol is required for free-energy Boltzmann weighting`,
      )
    }
    if (weightKind !== 'boltzmann-free-energy' && record.relativeFreeEnergyKcalMol !== undefined) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        `${field}.relativeFreeEnergyKcalMol is allowed only for free-energy Boltzmann weighting`,
      )
    }
    return {
      id: token(record.id, `${field}.id`),
      weight: numberIn(record.weight, `${field}.weight`, Number.MIN_VALUE, 1),
      structureFingerprint,
      structure,
      evidenceSourceIds: referencedSourceIds,
      ...(weightKind === 'boltzmann-potential-energy' ? {
        relativePotentialEnergyKcalMol: numberIn(
          record.relativePotentialEnergyKcalMol,
          `${field}.relativePotentialEnergyKcalMol`,
          -1_000_000,
          1_000_000,
        ),
      } : {}),
      ...(weightKind === 'boltzmann-free-energy' ? {
        relativeFreeEnergyKcalMol: numberIn(
          record.relativeFreeEnergyKcalMol,
          `${field}.relativeFreeEnergyKcalMol`,
          -1_000_000,
          1_000_000,
        ),
      } : {}),
    }
  })
  const memberAtomCount = rawMembers.reduce((sum, member) => sum + member.structure.atoms.length, 0)
  if (memberAtomCount > maxMemberAtoms) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_budget_exceeded',
      `Structure ensemble contains ${memberAtomCount} member-atoms; limit is ${maxMemberAtoms}`,
    )
  }
  if (new Set(rawMembers.map((member) => member.id)).size !== rawMembers.length) {
    throw new ZatomStructureEnsembleInputError('invalid_structure_ensemble', 'Structure member IDs must be unique')
  }
  if (new Set(rawMembers.map((member) => member.structureFingerprint)).size !== rawMembers.length) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'Exact duplicate member structures must be aggregated into one weighted member',
    )
  }
  const referencedEvidenceSourceIds = new Set(rawMembers.flatMap((member) => member.evidenceSourceIds))
  const unusedEvidenceSourceIds = evidenceSources
    .map((source) => source.id)
    .filter((sourceId) => !referencedEvidenceSourceIds.has(sourceId))
  if (unusedEvidenceSourceIds.length) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_evidence_mismatch',
      `Evidence sources are not referenced by any member: ${unusedEvidenceSourceIds.join(', ')}`,
    )
  }
  const atomCount = rawMembers[0].structure.atoms.length
  if (rawMembers.some((member) => member.structure.atoms.length !== atomCount)) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_topology_mismatch',
      'Every structure member must preserve the same ordered atom count',
    )
  }
  const pairDistanceEvaluationCount = rawMembers.length * atomCount * (atomCount - 1) / 2
  if (pairDistanceEvaluationCount > maxPairDistanceEvaluations) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_budget_exceeded',
      `Structure ensemble requires ${pairDistanceEvaluationCount} pair-distance evaluations; limit is ${maxPairDistanceEvaluations}`,
    )
  }

  const rawWeightSum = rawMembers.reduce((sum, member) => sum + member.weight, 0)
  if (!Number.isFinite(rawWeightSum) || Math.abs(rawWeightSum - 1) > 1e-8) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_weight_mismatch',
      `Structure member weights sum to ${rawWeightSum}, not one within 1e-8`,
    )
  }
  const normalizedInputWeights = rawMembers.map((member) => member.weight / rawWeightSum)
  let canonicalWeights = normalizedInputWeights
  let canonicalEnergies: number[] | undefined
  if (isBoltzmann) {
    const rawEnergies = rawMembers.map((member) => weightKind === 'boltzmann-potential-energy'
      ? member.relativePotentialEnergyKcalMol!
      : member.relativeFreeEnergyKcalMol!)
    const minimumEnergy = Math.min(...rawEnergies)
    canonicalEnergies = rawEnergies.map((energy) => energy - minimumEnergy)
    const inverseRT = 1 / (GAS_CONSTANT_KCAL_PER_MOL_K * weightModel.temperatureK!)
    const unnormalized = canonicalEnergies.map((energy) => Math.exp(-energy * inverseRT))
    if (unnormalized.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_boltzmann_weight_underflow',
        'Relative energy range underflows finite positive Boltzmann weights at the declared temperature',
      )
    }
    const sum = unnormalized.reduce((total, weight) => total + weight, 0)
    canonicalWeights = unnormalized.map((weight) => weight / sum)
    if (canonicalWeights.some((weight, index) => (
      Math.abs(weight - normalizedInputWeights[index]) > 1e-8
    ))) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_boltzmann_weight_mismatch',
        'Member weights do not match independently recomputed Boltzmann probabilities within 1e-8',
      )
    }
  }
  const weightedMembers = rawMembers.map((member, index): ZatomStructureEnsembleMember => ({
    ...member,
    weight: canonicalWeights[index],
    ...(canonicalEnergies && weightKind === 'boltzmann-potential-energy'
      ? { relativePotentialEnergyKcalMol: canonicalEnergies[index] }
      : {}),
    ...(canonicalEnergies && weightKind === 'boltzmann-free-energy'
      ? { relativeFreeEnergyKcalMol: canonicalEnergies[index] }
      : {}),
  })).sort((left, right) => compareText(left.id, right.id))
  const canonicalWeightSum = weightedMembers.reduce((sum, member) => sum + member.weight, 0)
  const correctionIndex = weightedMembers.reduce((maximumIndex, member, index) => (
    member.weight > weightedMembers[maximumIndex].weight ? index : maximumIndex
  ), 0)
  weightedMembers[correctionIndex].weight += 1 - canonicalWeightSum

  const rawAcceptance = exactObject(
    root.acceptance,
    'structureEnsemble.acceptance',
    ['minimumWeightEffectiveMemberCount'],
  )
  const acceptance = {
    minimumWeightEffectiveMemberCount: numberIn(
      rawAcceptance.minimumWeightEffectiveMemberCount,
      'structureEnsemble.acceptance.minimumWeightEffectiveMemberCount',
      1,
      weightedMembers.length,
    ),
  }
  const weightEffectiveMemberCount = structureEnsembleWeightEffectiveMemberCount(weightedMembers)
  if (weightEffectiveMemberCount + 1e-12 < acceptance.minimumWeightEffectiveMemberCount) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_weight_effective_size_failed',
      `Weight effective member count ${weightEffectiveMemberCount} is below ${acceptance.minimumWeightEffectiveMemberCount}`,
    )
  }

  const rawSelection = exactObject(
    root.selection,
    'structureEnsemble.selection',
    ['selectedMemberId', 'method', 'rationale'],
  )
  const selectedMemberId = token(rawSelection.selectedMemberId, 'structureEnsemble.selection.selectedMemberId')
  if (rawSelection.method !== 'explicit' && rawSelection.method !== 'maximum-weight') {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.selection.method must be explicit or maximum-weight',
    )
  }
  const selectedMember = weightedMembers.find((member) => member.id === selectedMemberId)
  if (!selectedMember) {
    throw new ZatomStructureEnsembleInputError(
      'invalid_structure_ensemble',
      'structureEnsemble.selection.selectedMemberId does not resolve to a member',
    )
  }
  if (rawSelection.method === 'maximum-weight') {
    const maximumWeight = Math.max(...weightedMembers.map((member) => member.weight))
    if (selectedMember.weight < maximumWeight - 1e-12) {
      throw new ZatomStructureEnsembleInputError(
        'invalid_structure_ensemble',
        'maximum-weight selection must choose a maximum-weight member',
      )
    }
  }
  const selectedStructure = normalizeStructure(options.selectedStructure, 'selectedStructure')
  if (fingerprintStructure(selectedStructure) !== selectedMember.structureFingerprint) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_selected_structure_mismatch',
      `Selected structure does not match member ${selectedMemberId}`,
    )
  }
  const selection: ZatomStructureEnsemble['selection'] = {
    selectedMemberId,
    method: rawSelection.method,
    rationale: text(rawSelection.rationale, 'structureEnsemble.selection.rationale', 8192),
  }

  const rawProvenance = exactObject(root.provenance, 'structureEnsemble.provenance', [
    'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
  ])
  const provenance: ZatomStructureEnsemble['provenance'] = {
    engine: text(rawProvenance.engine, 'structureEnsemble.provenance.engine', 256),
    engineVersion: text(rawProvenance.engineVersion, 'structureEnsemble.provenance.engineVersion', 256),
    method: text(rawProvenance.method, 'structureEnsemble.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts, 'structureEnsemble.provenance.artifacts'),
    parameters: jsonRecord(rawProvenance.parameters, 'structureEnsemble.provenance.parameters'),
    citations: uniqueTextList(rawProvenance.citations, 'structureEnsemble.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'structureEnsemble.provenance.scopeWarning', 8192),
  }
  let metadata: Record<string, JsonValue> | undefined
  if (root.metadata !== undefined) {
    metadata = jsonRecord(root.metadata, 'structureEnsemble.metadata')
    if (new TextEncoder().encode(JSON.stringify(metadata)).length > maxMetadataBytes) {
      throw new ZatomStructureEnsembleInputError(
        'structure_ensemble_budget_exceeded',
        `Structure-ensemble metadata exceeds ${maxMetadataBytes} bytes`,
      )
    }
  }
  const ensemble: ZatomStructureEnsemble = {
    schemaVersion: ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
    topologyFingerprint,
    members: weightedMembers,
    selection,
    weightModel,
    acceptance,
    evidenceSources,
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const artifactBytes = new TextEncoder().encode(JSON.stringify(ensemble)).length
  if (artifactBytes > maxArtifactBytes) {
    throw new ZatomStructureEnsembleInputError(
      'structure_ensemble_budget_exceeded',
      `Canonical structure ensemble is ${artifactBytes} bytes; limit is ${maxArtifactBytes}`,
    )
  }
  const geometryDiagnostics = computeGeometryDiagnostics(weightedMembers, selectedMemberId)
  const fingerprint = fingerprintStructureEnsemble(ensemble)
  const applicability = weightModel.applicability.assessment
  const checks: ValidationCheck[] = [
    {
      id: 'structure_ensemble.identity',
      status: 'pass',
      message: `Structure ensemble ${fingerprint} binds exact selected member ${selectedMemberId}`,
      metrics: { fingerprint, selectedMemberId, selectedStructureFingerprint: selectedMember.structureFingerprint },
    },
    {
      id: 'structure_ensemble.topology',
      status: 'pass',
      message: `All ${weightedMembers.length} members preserve ordered ${atomCount}-atom topology ${topologyFingerprint}`,
      metrics: { topologyFingerprint, memberCount: weightedMembers.length, atomCount },
    },
    {
      id: 'structure_ensemble.weights',
      status: 'pass',
      message: `${weightKind} weights normalize to one with Kish effective member count ${weightEffectiveMemberCount}`,
      metrics: {
        weightKind,
        weightEffectiveMemberCount,
        minimumWeightEffectiveMemberCount: acceptance.minimumWeightEffectiveMemberCount,
      },
    },
    {
      id: 'structure_ensemble.internal_geometry',
      status: 'pass',
      message: `Rotation/translation-invariant expected pairwise member distance-matrix RMSD is ${geometryDiagnostics.expectedPairwiseMemberDistanceMatrixRmsdA} Å`,
      metrics: {
        expectedPairwiseMemberDistanceMatrixRmsdA:
          geometryDiagnostics.expectedPairwiseMemberDistanceMatrixRmsdA,
        maximumInternalDistanceRmsdToSelectedA:
          geometryDiagnostics.maximumInternalDistanceRmsdToSelectedA,
        pairDistanceEvaluationCount: geometryDiagnostics.pairDistanceEvaluationCount,
      },
    },
    {
      id: 'structure_ensemble.minimum_distance',
      status: geometryDiagnostics.minimumMemberPairDistanceA < 0.35
        ? 'fail'
        : geometryDiagnostics.minimumMemberPairDistanceA < 0.6 ? 'warn' : 'pass',
      message: `Closest pair across all members is ${geometryDiagnostics.minimumMemberPairDistanceA} Å in ${geometryDiagnostics.minimumMemberPair.memberId}`,
      metrics: {
        minimumMemberPairDistanceA: geometryDiagnostics.minimumMemberPairDistanceA,
        minimumPairMemberId: geometryDiagnostics.minimumMemberPair.memberId,
      },
      atomIds: geometryDiagnostics.minimumMemberPair.atomIds,
    },
    {
      id: 'structure_ensemble.rigid_transform_duplicates',
      status: geometryDiagnostics.rigidTransformDuplicateGroups.length ? 'warn' : 'pass',
      message: geometryDiagnostics.rigidTransformDuplicateGroups.length
        ? `${geometryDiagnostics.rigidTransformDuplicateGroups.length} member group(s) have indistinguishable pair-distance geometry at 1e-8 Å and may duplicate probability mass`
        : 'No two members have the same rounded pair-distance geometry',
      metrics: { duplicateGroupCount: geometryDiagnostics.rigidTransformDuplicateGroups.length },
    },
    {
      id: 'structure_ensemble.applicability',
      status: applicability === 'in-domain' ? 'pass' : applicability === 'out-of-domain' ? 'fail' : 'warn',
      message: `Structural-weight applicability is ${applicability}: ${weightModel.applicability.reasons.join('; ')}`,
      metrics: { assessment: applicability },
    },
    {
      id: 'structure_ensemble.provenance',
      status: 'pass',
      message: `Every member cites evidence; ensemble provenance records ${provenance.engine} ${provenance.engineVersion}, immutable artifacts, parameters, and citations`,
      metrics: {
        evidenceSourceCount: evidenceSources.length,
        artifactCount: provenance.artifacts.length,
        citationCount: provenance.citations.length,
      },
    },
    {
      id: 'structure_ensemble.model_scope',
      status: 'warn',
      message: `${weightModel.scopeWarning} ${provenance.scopeWarning} A fixed-topology structural ensemble does not cover omitted conformers, alternate protonation/tautomer/stereo/topology identities, parameter uncertainty, kinetics, or convergence unless separately evidenced.`,
      metrics: { weightKind },
    },
  ]

  const selectedBounds = boundsOfPositions(selectedMember.structure.atoms.map((atom) => atom.position))!
  const atomSpreadRanking = [...geometryDiagnostics.atomDiagnostics].sort((left, right) => (
    right.expectedPairwiseMemberDistanceProfileRmsdA
      - left.expectedPairwiseMemberDistanceProfileRmsdA
      || compareText(left.atomId, right.atomId)
  ))
  const highSpreadAtomIds = atomSpreadRanking.slice(0, Math.min(16, atomSpreadRanking.length))
    .map((diagnostic) => diagnostic.atomId)
  const selectedAtomById = new Map(selectedMember.structure.atoms.map((atom) => [atom.id, atom]))
  const highSpreadBounds = boundsOfPositions(highSpreadAtomIds.map((atomId) => selectedAtomById.get(atomId)!.position))!
  const overviewAtomIds = selectedMember.structure.atoms.slice(0, 256).map((atom) => atom.id)
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'structure-ensemble-selected-member',
      reason: `Inspect selected structural hypothesis ${selectedMemberId} and its fixed topology`,
      center: selectedBounds.center,
      radius: Math.max(1, selectedBounds.radius),
      atomIds: overviewAtomIds,
      ...(overviewAtomIds.length < selectedMember.structure.atoms.length ? { atomIdsTruncated: true } : {}),
    },
    {
      id: 'structure-ensemble-largest-internal-spread',
      reason: `Inspect atoms with the largest ensemble pair-distance-profile spread; maximum ${atomSpreadRanking[0].expectedPairwiseMemberDistanceProfileRmsdA.toFixed(4)} Å`,
      center: highSpreadBounds.center,
      radius: Math.max(1, highSpreadBounds.radius + atomSpreadRanking[0].expectedPairwiseMemberDistanceProfileRmsdA),
      atomIds: highSpreadAtomIds,
    },
  ]
  if (geometryDiagnostics.minimumMemberPairDistanceA < 0.6) {
    const pairPositions = geometryDiagnostics.minimumMemberPair.atomIds.map((atomId) => (
      selectedAtomById.get(atomId)!.position
    ))
    const pairBounds = boundsOfPositions(pairPositions)!
    inspectionTargets.push({
      id: 'structure-ensemble-closest-member-pair',
      reason: `Inspect atom IDs forming the closest pair in member ${geometryDiagnostics.minimumMemberPair.memberId} (${geometryDiagnostics.minimumMemberPairDistanceA.toFixed(4)} Å)`,
      center: pairBounds.center,
      radius: Math.max(1, pairBounds.radius * 2),
      atomIds: geometryDiagnostics.minimumMemberPair.atomIds,
    })
  }
  return {
    ensemble,
    fingerprint,
    weightEffectiveMemberCount,
    geometryDiagnostics,
    checks,
    inspectionTargets,
  }
}
