/** Matched defect/perfect-reference relaxation evidence for periodic screw dipoles. */

import type { InspectionTarget, JsonValue, ValidationCheck, Vec3, ZatomStructure } from './contracts'
import {
  canonicalJsonIdentity,
  cartesianToFractional,
  certifiedMinimumImageVector,
  compareCanonicalText,
  fingerprintCanonicalJson,
  fingerprintStructure,
  fractionalToCartesian,
} from './structure-math'
import {
  fingerprintPeriodicDislocationDipoleEvidence,
  parseZatomPeriodicDislocationDipoleEvidence,
  type ZatomPeriodicDislocationDipoleEvidence,
} from './periodic-dislocation-dipole-evidence'
import {
  parseZatomFixedCellRelaxationEvidence,
  type ZatomFixedCellRelaxationEvidence,
} from './fixed-cell-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'

export const ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA =
  'zatom.periodic-dislocation-relaxation-evidence/v1' as const

export interface ZatomPeriodicDislocationRelaxationEvidence {
  schemaVersion: typeof ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA
  sourceStructureFingerprint: string
  seedStructureFingerprint: string
  seedEvidenceFingerprint: string
  balancedReferenceStructureFingerprint: string
  relaxedDefectStructureFingerprint: string
  relaxedReferenceStructureFingerprint: string
  defectRelaxationEvidenceFingerprint: string
  referenceRelaxationEvidenceFingerprint: string
  construction: {
    kind: 'matched-fixed-cell-periodic-screw-dipole-relaxation'
    referenceMethod: 'affine-perfect-reference-in-balanced-dipole-cell'
    sizeMultipliers: [number, number, number]
    shiftIndex: number
    imageReplicaCount: number
    lineAxis: 'x' | 'y' | 'z'
    burgersMagnitudeA: number
    dislocationLineCount: 2
    lineLengthA: number
    totalDislocationLineLengthA: number
    coreAnchorAtomIds: string[]
  }
  model: {
    engineVersion: string
    providerId: string
    adapterVersion: string
    executableSha256: string
    potentialId: string
    potentialVersion: string
    potentialCommandsFingerprint: string
    potentialArtifactFingerprints: string[]
  }
  acceptance: {
    maximumFinalForceEvPerA: number
    maximumReferenceRelaxationDisplacementA: number
    maximumDefectRelaxationDisplacementA: number
    maximumDifferentialDisplacementA: number
    minimumPairDistanceA: number
  }
  metrics: {
    relaxedDefectPotentialEnergyEv: number
    relaxedReferencePotentialEnergyEv: number
    cellExcessPotentialEnergyEv: number
    excessPotentialEnergyPerTotalLineLengthEvPerA: number
    defectRelaxationEnergyChangeEv: number
    referenceRelaxationEnergyChangeEv: number
    maximumDefectForceEvPerA: number
    maximumReferenceForceEvPerA: number
    maximumDefectRelaxationDisplacementA: number
    maximumReferenceRelaxationDisplacementA: number
    differentialRigidGaugeA: Vec3
    maximumDifferentialDisplacementA: number
    rmsDifferentialDisplacementA: number
    maximumAbsoluteLineProjectedDifferentialDisplacementA: number
    rmsLineProjectedDifferentialDisplacementA: number
    coreAnchorRmsDifferentialDisplacementA: number
    minimumRelaxedPairDistanceA: number
    finalStressDifferenceBar: { xx: number; yy: number; zz: number; xy: number; xz: number; yz: number }
    maximumAbsoluteFinalStressDifferenceBar: number
    minimumImageCandidateEvaluations: number
    acceptancePassed: boolean
  }
  diagnostics: {
    maximumDifferentialDisplacementAtomId: string
    maximumLineProjectedDifferentialDisplacementAtomId: string
    maximumDefectForceAtomId: string
    maximumReferenceForceAtomId: string
    closestDefectPairAtomIds: [string, string]
    closestReferencePairAtomIds: [string, string]
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

export interface ComposeZatomPeriodicDislocationRelaxationEvidenceInput {
  sourceStructure: ZatomStructure
  seedStructure: ZatomStructure
  relaxedDefectStructure: ZatomStructure
  relaxedReferenceStructure: ZatomStructure
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence
  defectRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  referenceRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  acceptance: ZatomPeriodicDislocationRelaxationEvidence['acceptance']
  provenance: ZatomPeriodicDislocationRelaxationEvidence['provenance']
  metadata?: Record<string, JsonValue>
}

export interface ParseZatomPeriodicDislocationRelaxationEvidenceOptions {
  sourceStructure: ZatomStructure
  seedStructure: ZatomStructure
  relaxedDefectStructure: ZatomStructure
  relaxedReferenceStructure: ZatomStructure
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence
  defectRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  referenceRelaxationEvidence: ZatomFixedCellRelaxationEvidence
  maxMinimumImageCandidateEvaluations?: number
  maxMetadataBytes?: number
  maxArtifactBytes?: number
}

export interface ZatomPeriodicDislocationRelaxationEvidenceValidation {
  evidence: ZatomPeriodicDislocationRelaxationEvidence
  balancedReferenceStructure: ZatomStructure
  fingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class ZatomPeriodicDislocationRelaxationEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPeriodicDislocationRelaxationEvidenceInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactObject(value: unknown, field: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `${field} must be an object`)
  }
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !(key in value))
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key))
  if (missing.length || unexpected.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'invalid_periodic_dislocation_relaxation_evidence',
      `${field} fields differ (missing=${missing.join(',') || 'none'}, unexpected=${unexpected.join(',') || 'none'})`,
    )
  }
  return value
}

function finite(value: unknown, field: string, minimum = -1e300, maximum = 1e300): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'invalid_periodic_dislocation_relaxation_evidence',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(value, -0) ? 0 : value
}

function text(value: unknown, field: string, maximum = 8192): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'invalid_periodic_dislocation_relaxation_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function token(value: unknown, field: string): string {
  const result = text(value, field, 256)
  if (!/^[A-Za-z0-9_.:+@/\[\], -]+$/.test(result)) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `${field} contains unsupported characters`)
  }
  return result
}

function uniqueTexts(value: unknown, field: string, minimum = 0, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'invalid_periodic_dislocation_relaxation_evidence',
      `${field} must contain ${minimum}-${maximum} strings`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `${field} must not repeat values`)
  }
  return result
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return finite(value, field)
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `${field} is not JSON-safe`)
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `${field} must be a JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
}

function positiveBudget(value: number | undefined, fallback: number, field: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_context', `${field} must be a positive safe integer`)
  }
  return result
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(canonicalJsonIdentity(value)).length
}


export function fingerprintPeriodicDislocationRelaxationEvidence(
  value: ZatomPeriodicDislocationRelaxationEvidence,
): string {
  return fingerprintCanonicalJson(value)
}

function subtract(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function persistentMetadata(structure: ZatomStructure): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(structure.metadata ?? {}).filter(([key]) => key !== 'viewer'))
}

/** Construct the exact perfect comparator in the atomman balancing-shear cell. */
export function buildBalancedPeriodicDislocationReference(
  seedEvidence: ZatomPeriodicDislocationDipoleEvidence,
  seedStructure: ZatomStructure,
): ZatomStructure {
  const reference = seedEvidence.referenceStructure
  if (!reference.lattice || !seedStructure.lattice) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_reference_lattice_required', 'Reference and seed require lattices')
  }
  if (reference.atoms.length !== seedStructure.atoms.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_reference_mapping_mismatch', 'Reference and seed atom counts differ')
  }
  const atoms = reference.atoms.map((atom, index) => {
    const seedAtom = seedStructure.atoms[index]
    if (atom.id !== seedAtom.id || atom.element !== seedAtom.element) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_reference_mapping_mismatch', `Reference atom ${index} differs from seed identity`)
    }
    const fractional = cartesianToFractional(atom.position, reference.lattice!.vectors)
    if (!fractional) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_reference_lattice_required', 'Cannot invert embedded perfect-reference lattice')
    }
    return {
      ...atom,
      position: fractionalToCartesian(fractional, seedStructure.lattice!.vectors),
      ...(atom.properties ? { properties: structuredClone(atom.properties) } : {}),
    }
  })
  return {
    schemaVersion: seedStructure.schemaVersion,
    label: `${reference.label ?? 'perfect oriented reference'} | affine balanced dipole cell`,
    atoms,
    ...(reference.bonds ? { bonds: structuredClone(reference.bonds) } : {}),
    lattice: {
      vectors: seedStructure.lattice.vectors.map((row) => [...row] as Vec3) as [Vec3, Vec3, Vec3],
      periodic: [true, true, true],
    },
    metadata: {
      ...persistentMetadata(reference),
      'zatom.periodicDislocation.role': 'balanced-perfect-relaxation-reference',
      'zatom.periodicDislocation.seedEvidenceFingerprint': fingerprintPeriodicDislocationDipoleEvidence(seedEvidence),
    },
  }
}

function parseArtifacts(value: unknown): Array<{ id: string; role: string; fingerprint: string }> {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', 'provenance.artifacts must contain 3-64 entries')
  }
  const result = value.map((item, index) => {
    const field = `evidence.provenance.artifacts[${index}]`
    const record = exactObject(item, field, ['id', 'role', 'fingerprint'])
    return {
      id: token(record.id, `${field}.id`),
      role: text(record.role, `${field}.role`),
      fingerprint: text(record.fingerprint, `${field}.fingerprint`, 256),
    }
  }).sort((left, right) => compareCanonicalText(left.id, right.id))
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', 'provenance artifact IDs must be unique')
  }
  return result
}

function exactRelaxationModelIdentity(evidence: ZatomFixedCellRelaxationEvidence): unknown {
  return {
    method: evidence.method,
    model: evidence.model,
    settings: evidence.settings,
    providerId: evidence.provenance.providerId,
    adapterVersion: evidence.provenance.adapterVersion,
    executable: evidence.provenance.executable,
    parameters: evidence.provenance.parameters,
  }
}

function buildValidation(
  rawValue: unknown,
  options: ParseZatomPeriodicDislocationRelaxationEvidenceOptions,
): ZatomPeriodicDislocationRelaxationEvidenceValidation {
  const maxCandidates = positiveBudget(options.maxMinimumImageCandidateEvaluations, 10_000_000, 'maxMinimumImageCandidateEvaluations')
  const maxMetadataBytes = positiveBudget(options.maxMetadataBytes, 2 * 1024 * 1024, 'maxMetadataBytes')
  const source = parseZatomStructure(options.sourceStructure)
  const seed = parseZatomStructure(options.seedStructure)
  const relaxedDefect = parseZatomStructure(options.relaxedDefectStructure)
  const relaxedReference = parseZatomStructure(options.relaxedReferenceStructure)
  const seedValidation = parseZatomPeriodicDislocationDipoleEvidence(options.seedEvidence, {
    sourceStructure: source,
    resultStructure: seed,
  })
  const balancedReference = buildBalancedPeriodicDislocationReference(seedValidation.evidence, seed)
  const defectValidation = parseZatomFixedCellRelaxationEvidence(options.defectRelaxationEvidence, {
    sourceStructure: seed,
    resultStructure: relaxedDefect,
  })
  const referenceValidation = parseZatomFixedCellRelaxationEvidence(options.referenceRelaxationEvidence, {
    sourceStructure: balancedReference,
    resultStructure: relaxedReference,
  })
  if (canonicalJsonIdentity(exactRelaxationModelIdentity(defectValidation.evidence))
    !== canonicalJsonIdentity(exactRelaxationModelIdentity(referenceValidation.evidence))) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'periodic_dislocation_relaxation_model_mismatch',
      'Defect and perfect reference must use the exact same LAMMPS executable, potential, artifacts, provider, adapter, and host-bound minimization parameters',
    )
  }
  if (defectValidation.evidence.settings.fixedAtomIds.length || referenceValidation.evidence.settings.fixedAtomIds.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'periodic_dislocation_relaxation_fixed_atoms_unsupported',
      'Matched periodic dipole/reference comparison requires unconstrained atom relaxation in both cells',
    )
  }
  if (relaxedDefect.atoms.length !== relaxedReference.atoms.length
    || canonicalJsonIdentity(relaxedDefect.lattice) !== canonicalJsonIdentity(relaxedReference.lattice)) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'periodic_dislocation_relaxation_cell_mismatch',
      'Relaxed defect and reference must preserve one exact common fixed cell and atom count',
    )
  }
  for (let index = 0; index < relaxedDefect.atoms.length; index++) {
    if (relaxedDefect.atoms[index].id !== relaxedReference.atoms[index].id
      || relaxedDefect.atoms[index].element !== relaxedReference.atoms[index].element) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_relaxation_mapping_mismatch', `Relaxed pair atom ${index} differs in ID or element`)
    }
  }

  const raw = exactObject(rawValue, 'evidence', [
    'schemaVersion', 'sourceStructureFingerprint', 'seedStructureFingerprint', 'seedEvidenceFingerprint',
    'balancedReferenceStructureFingerprint', 'relaxedDefectStructureFingerprint', 'relaxedReferenceStructureFingerprint',
    'defectRelaxationEvidenceFingerprint', 'referenceRelaxationEvidenceFingerprint', 'construction', 'model',
    'acceptance', 'metrics', 'diagnostics', 'provenance',
  ], ['metadata'])
  if (raw.schemaVersion !== ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_evidence', `schemaVersion must be ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA}`)
  }
  const rawAcceptance = exactObject(raw.acceptance, 'evidence.acceptance', [
    'maximumFinalForceEvPerA', 'maximumReferenceRelaxationDisplacementA', 'maximumDefectRelaxationDisplacementA',
    'maximumDifferentialDisplacementA', 'minimumPairDistanceA',
  ])
  const acceptance: ZatomPeriodicDislocationRelaxationEvidence['acceptance'] = {
    maximumFinalForceEvPerA: finite(rawAcceptance.maximumFinalForceEvPerA, 'evidence.acceptance.maximumFinalForceEvPerA', 0, 1e6),
    maximumReferenceRelaxationDisplacementA: finite(rawAcceptance.maximumReferenceRelaxationDisplacementA, 'evidence.acceptance.maximumReferenceRelaxationDisplacementA', 0, 1e6),
    maximumDefectRelaxationDisplacementA: finite(rawAcceptance.maximumDefectRelaxationDisplacementA, 'evidence.acceptance.maximumDefectRelaxationDisplacementA', 0, 1e6),
    maximumDifferentialDisplacementA: finite(rawAcceptance.maximumDifferentialDisplacementA, 'evidence.acceptance.maximumDifferentialDisplacementA', 0, 1e6),
    minimumPairDistanceA: finite(rawAcceptance.minimumPairDistanceA, 'evidence.acceptance.minimumPairDistanceA', 0, 1e6),
  }
  const rawProvenance = exactObject(raw.provenance, 'evidence.provenance', ['method', 'artifacts', 'parameters', 'citations', 'scopeWarning'])
  const provenance: ZatomPeriodicDislocationRelaxationEvidence['provenance'] = {
    method: text(rawProvenance.method, 'evidence.provenance.method'),
    artifacts: parseArtifacts(rawProvenance.artifacts),
    parameters: jsonRecord(rawProvenance.parameters, 'evidence.provenance.parameters'),
    citations: uniqueTexts(rawProvenance.citations, 'evidence.provenance.citations', 1, 32),
    scopeWarning: text(rawProvenance.scopeWarning, 'evidence.provenance.scopeWarning'),
  }
  const requiredArtifacts = new Map([
    ['periodic-dislocation-seed-evidence', seedValidation.fingerprint],
    ['defect-fixed-cell-relaxation-evidence', defectValidation.fingerprint],
    ['reference-fixed-cell-relaxation-evidence', referenceValidation.fingerprint],
    ['balanced-perfect-reference', fingerprintStructure(balancedReference)],
  ])
  for (const [id, fingerprint] of requiredArtifacts) {
    const artifact = provenance.artifacts.find((item) => item.id === id)
    if (!artifact || artifact.fingerprint !== fingerprint) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
        'periodic_dislocation_relaxation_provenance_mismatch',
        `provenance.artifacts must bind ${id} to ${fingerprint}`,
      )
    }
  }
  let metadata: Record<string, JsonValue> | undefined
  if (raw.metadata !== undefined) {
    if (utf8Bytes(raw.metadata) > maxMetadataBytes) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_relaxation_budget_exceeded', 'metadata exceeds maxMetadataBytes')
    }
    metadata = jsonRecord(raw.metadata, 'evidence.metadata')
  }

  const lineIndex = seedValidation.evidence.construction.atommanIndices.line
  const lineLengthA = norm(seed.lattice!.vectors[lineIndex])
  const lineUnit = seedValidation.evidence.crystallography.rotatedLineUnitVector
  if (!Number.isFinite(lineLengthA) || lineLengthA <= 1e-10) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_relaxation_line_invalid', 'Periodic line length is degenerate')
  }
  let candidateEvaluations = 0
  const rawDifferential = relaxedDefect.atoms.map((atom, index) => {
    try {
      const row = certifiedMinimumImageVector(
        subtract(atom.position, relaxedReference.atoms[index].position),
        relaxedDefect.lattice!,
        maxCandidates - candidateEvaluations,
      )
      candidateEvaluations += row.candidateEvaluations
      return row.vector
    } catch (error) {
      throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
        'periodic_dislocation_relaxation_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
  })
  const differentialRigidGaugeA: Vec3 = [0, 1, 2].map((axis) => (
    rawDifferential.reduce((sum, vector) => sum + vector[axis], 0) / rawDifferential.length
  )) as Vec3
  const differential = rawDifferential.map((vector) => subtract(vector, differentialRigidGaugeA))
  const magnitudes = differential.map(norm)
  const lineProjected = differential.map((vector) => dot(vector, lineUnit))
  const maximumDifferentialIndex = magnitudes.reduce((best, value, index) => value > magnitudes[best] ? index : best, 0)
  const maximumLineIndex = lineProjected.reduce((best, value, index) => Math.abs(value) > Math.abs(lineProjected[best]) ? index : best, 0)
  const maximumDifferentialDisplacementA = magnitudes[maximumDifferentialIndex]
  const rmsDifferentialDisplacementA = Math.sqrt(magnitudes.reduce((sum, value) => sum + value ** 2, 0) / magnitudes.length)
  const maximumAbsoluteLineProjectedDifferentialDisplacementA = Math.abs(lineProjected[maximumLineIndex])
  const rmsLineProjectedDifferentialDisplacementA = Math.sqrt(lineProjected.reduce((sum, value) => sum + value ** 2, 0) / lineProjected.length)
  const indexById = new Map(relaxedDefect.atoms.map((atom, index) => [atom.id, index]))
  const coreAnchorAtomIds = seedValidation.evidence.diagnostics.nearestCoreAtomIds.filter((id) => indexById.has(id))
  if (!coreAnchorAtomIds.length) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_relaxation_core_anchors_missing', 'No seed core anchor survives in the relaxed pair')
  }
  const coreAnchorRmsDifferentialDisplacementA = Math.sqrt(coreAnchorAtomIds.reduce((sum, id) => {
    const magnitude = magnitudes[indexById.get(id)!]
    return sum + magnitude ** 2
  }, 0) / coreAnchorAtomIds.length)
  const defectEvidence = defectValidation.evidence
  const referenceEvidence = referenceValidation.evidence
  const cellExcessPotentialEnergyEv = defectEvidence.observations.final.potentialEnergyEv
    - referenceEvidence.observations.final.potentialEnergyEv
  const stressKeys = ['xx', 'yy', 'zz', 'xy', 'xz', 'yz'] as const
  const finalStressDifferenceBar = Object.fromEntries(stressKeys.map((key) => [
    key,
    defectEvidence.observations.final.stress.tensorBar[key] - referenceEvidence.observations.final.stress.tensorBar[key],
  ])) as ZatomPeriodicDislocationRelaxationEvidence['metrics']['finalStressDifferenceBar']
  const maximumAbsoluteFinalStressDifferenceBar = Math.max(...Object.values(finalStressDifferenceBar).map(Math.abs))
  const maximumDefectForceEvPerA = defectEvidence.metrics.maximumForceEvPerA
  const maximumReferenceForceEvPerA = referenceEvidence.metrics.maximumForceEvPerA
  const maximumDefectRelaxationDisplacementA = defectEvidence.metrics.maximumDisplacementA
  const maximumReferenceRelaxationDisplacementA = referenceEvidence.metrics.maximumDisplacementA
  const minimumRelaxedPairDistanceA = Math.min(defectEvidence.metrics.minimumPairDistanceA, referenceEvidence.metrics.minimumPairDistanceA)
  const seedGate = seedValidation.evidence.metrics.acceptancePassed
  const relaxationGate = defectEvidence.metrics.acceptancePassed && referenceEvidence.metrics.acceptancePassed
  const forceGate = Math.max(maximumDefectForceEvPerA, maximumReferenceForceEvPerA) <= acceptance.maximumFinalForceEvPerA + 1e-12
  const referenceGate = maximumReferenceRelaxationDisplacementA <= acceptance.maximumReferenceRelaxationDisplacementA + 1e-12
  const defectGate = maximumDefectRelaxationDisplacementA <= acceptance.maximumDefectRelaxationDisplacementA + 1e-12
  const differentialGate = maximumDifferentialDisplacementA <= acceptance.maximumDifferentialDisplacementA + 1e-12
  const pairGate = minimumRelaxedPairDistanceA + 1e-12 >= acceptance.minimumPairDistanceA
  const acceptancePassed = seedGate && relaxationGate && forceGate && referenceGate && defectGate && differentialGate && pairGate
  const evidence: ZatomPeriodicDislocationRelaxationEvidence = {
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: fingerprintStructure(source),
    seedStructureFingerprint: fingerprintStructure(seed),
    seedEvidenceFingerprint: seedValidation.fingerprint,
    balancedReferenceStructureFingerprint: fingerprintStructure(balancedReference),
    relaxedDefectStructureFingerprint: fingerprintStructure(relaxedDefect),
    relaxedReferenceStructureFingerprint: fingerprintStructure(relaxedReference),
    defectRelaxationEvidenceFingerprint: defectValidation.fingerprint,
    referenceRelaxationEvidenceFingerprint: referenceValidation.fingerprint,
    construction: {
      kind: 'matched-fixed-cell-periodic-screw-dipole-relaxation',
      referenceMethod: 'affine-perfect-reference-in-balanced-dipole-cell',
      sizeMultipliers: [...seedValidation.evidence.construction.sizeMultipliers],
      shiftIndex: seedValidation.evidence.construction.shiftIndex,
      imageReplicaCount: seedValidation.evidence.construction.imageReplicaCount,
      lineAxis: seedValidation.evidence.crystallography.lineAxis,
      burgersMagnitudeA: seedValidation.evidence.crystallography.burgersMagnitudeA,
      dislocationLineCount: 2,
      lineLengthA,
      totalDislocationLineLengthA: 2 * lineLengthA,
      coreAnchorAtomIds,
    },
    model: {
      engineVersion: defectEvidence.method.engineVersion,
      providerId: defectEvidence.provenance.providerId,
      adapterVersion: defectEvidence.provenance.adapterVersion,
      executableSha256: defectEvidence.provenance.executable.sha256,
      potentialId: defectEvidence.model.id,
      potentialVersion: defectEvidence.model.version,
      potentialCommandsFingerprint: defectEvidence.model.commandsFingerprint,
      potentialArtifactFingerprints: defectEvidence.model.artifacts.map((artifact) => artifact.fingerprint).sort(),
    },
    acceptance,
    metrics: {
      relaxedDefectPotentialEnergyEv: defectEvidence.observations.final.potentialEnergyEv,
      relaxedReferencePotentialEnergyEv: referenceEvidence.observations.final.potentialEnergyEv,
      cellExcessPotentialEnergyEv,
      excessPotentialEnergyPerTotalLineLengthEvPerA: cellExcessPotentialEnergyEv / (2 * lineLengthA),
      defectRelaxationEnergyChangeEv: defectEvidence.metrics.potentialEnergyChangeEv,
      referenceRelaxationEnergyChangeEv: referenceEvidence.metrics.potentialEnergyChangeEv,
      maximumDefectForceEvPerA,
      maximumReferenceForceEvPerA,
      maximumDefectRelaxationDisplacementA,
      maximumReferenceRelaxationDisplacementA,
      differentialRigidGaugeA,
      maximumDifferentialDisplacementA,
      rmsDifferentialDisplacementA,
      maximumAbsoluteLineProjectedDifferentialDisplacementA,
      rmsLineProjectedDifferentialDisplacementA,
      coreAnchorRmsDifferentialDisplacementA,
      minimumRelaxedPairDistanceA,
      finalStressDifferenceBar,
      maximumAbsoluteFinalStressDifferenceBar,
      minimumImageCandidateEvaluations: candidateEvaluations,
      acceptancePassed,
    },
    diagnostics: {
      maximumDifferentialDisplacementAtomId: relaxedDefect.atoms[maximumDifferentialIndex].id,
      maximumLineProjectedDifferentialDisplacementAtomId: relaxedDefect.atoms[maximumLineIndex].id,
      maximumDefectForceAtomId: defectEvidence.diagnostics.maximumForceAtomId,
      maximumReferenceForceAtomId: referenceEvidence.diagnostics.maximumForceAtomId,
      closestDefectPairAtomIds: [...defectEvidence.diagnostics.closestPairAtomIds],
      closestReferencePairAtomIds: [...referenceEvidence.diagnostics.closestPairAtomIds],
    },
    provenance,
    ...(metadata ? { metadata } : {}),
  }
  const checks: ValidationCheck[] = [
    {
      id: 'periodic_dislocation_relaxation.seed_binding',
      status: seedGate ? 'pass' : 'fail',
      message: seedGate ? 'Exact accepted atomman periodic screw-dipole seed evidence is bound' : 'Seed evidence does not pass its own gates',
      metrics: { seedEvidenceFingerprint: seedValidation.fingerprint, seedStructureFingerprint: evidence.seedStructureFingerprint },
    },
    {
      id: 'periodic_dislocation_relaxation.reference_construction',
      status: 'pass',
      message: 'Perfect oriented reference was affinely mapped into the exact balancing-shear cell with stable atom identity and no defect displacement field',
      metrics: { balancedReferenceStructureFingerprint: evidence.balancedReferenceStructureFingerprint },
    },
    {
      id: 'periodic_dislocation_relaxation.model_equivalence',
      status: 'pass',
      message: 'Defect and reference use identical executable bytes, potential commands/assets, provider/adapter, and host-bound minimization parameters',
      metrics: { executableSha256: evidence.model.executableSha256, potentialCommandsFingerprint: evidence.model.potentialCommandsFingerprint },
    },
    {
      id: 'periodic_dislocation_relaxation.relaxation_acceptance',
      status: relaxationGate && forceGate ? 'pass' : 'fail',
      message: `Matched fixed-cell relaxations report max forces ${maximumDefectForceEvPerA.toExponential(5)} and ${maximumReferenceForceEvPerA.toExponential(5)} eV/Å`,
      metrics: { maximumDefectForceEvPerA, maximumReferenceForceEvPerA, acceptanceMaximumFinalForceEvPerA: acceptance.maximumFinalForceEvPerA },
      atomIds: [evidence.diagnostics.maximumDefectForceAtomId],
    },
    {
      id: 'periodic_dislocation_relaxation.reference_stability',
      status: referenceGate ? 'pass' : 'fail',
      message: `Balanced perfect reference relaxed by at most ${maximumReferenceRelaxationDisplacementA.toPrecision(6)} Å`,
      metrics: { maximumReferenceRelaxationDisplacementA, allowedMaximumA: acceptance.maximumReferenceRelaxationDisplacementA },
    },
    {
      id: 'periodic_dislocation_relaxation.defect_motion',
      status: defectGate ? 'pass' : 'fail',
      message: `Periodic defect seed relaxed by at most ${maximumDefectRelaxationDisplacementA.toPrecision(6)} Å`,
      metrics: { maximumDefectRelaxationDisplacementA, allowedMaximumA: acceptance.maximumDefectRelaxationDisplacementA },
      atomIds: [defectEvidence.diagnostics.maximumDisplacementAtomId],
    },
    {
      id: 'periodic_dislocation_relaxation.differential_displacement',
      status: differentialGate ? 'pass' : 'fail',
      message: `Gauge-removed relaxed defect/reference differential displacement reaches ${maximumDifferentialDisplacementA.toPrecision(6)} Å`,
      metrics: { maximumDifferentialDisplacementA, rmsDifferentialDisplacementA, coreAnchorRmsDifferentialDisplacementA },
      atomIds: [evidence.diagnostics.maximumDifferentialDisplacementAtomId, ...coreAnchorAtomIds.slice(0, 40)],
    },
    {
      id: 'periodic_dislocation_relaxation.minimum_distance',
      status: pairGate ? 'pass' : 'fail',
      message: `Minimum certified periodic pair distance across relaxed defect/reference is ${minimumRelaxedPairDistanceA.toPrecision(6)} Å`,
      metrics: { minimumRelaxedPairDistanceA, minimumImageCandidateEvaluations: candidateEvaluations },
      atomIds: evidence.diagnostics.closestDefectPairAtomIds,
    },
    {
      id: 'periodic_dislocation_relaxation.excess_energy',
      status: cellExcessPotentialEnergyEv >= -1e-8 ? 'pass' : 'warn',
      message: `Matched finite-cell excess potential energy is ${cellExcessPotentialEnergyEv.toPrecision(8)} eV, or ${evidence.metrics.excessPotentialEnergyPerTotalLineLengthEvPerA.toPrecision(8)} eV/Å over both lines`,
      metrics: { cellExcessPotentialEnergyEv, excessPotentialEnergyPerTotalLineLengthEvPerA: evidence.metrics.excessPotentialEnergyPerTotalLineLengthEvPerA },
    },
    {
      id: 'periodic_dislocation_relaxation.stress_difference',
      status: 'warn',
      message: `Final defect-minus-reference LAMMPS pressure-tensor difference reaches ${maximumAbsoluteFinalStressDifferenceBar.toPrecision(6)} bar in the positive-compression convention; fixed-cell minimization does not equilibrate pressure or stress`,
      metrics: { maximumAbsoluteFinalStressDifferenceBar },
    },
    {
      id: 'periodic_dislocation_relaxation.model_scope',
      status: 'warn',
      message: `${provenance.scopeWarning} The matched energy is the excess of this finite periodic dipole array in one fixed balancing-shear cell. It is not an isolated-dislocation core energy, elastic-image correction, infinite-size convergence proof, free energy, barrier, mobility, or DFT validation.`,
    },
  ]
  const maxDifferentialAtom = relaxedDefect.atoms[maximumDifferentialIndex]
  const closestAtom = relaxedDefect.atoms.find((atom) => atom.id === evidence.diagnostics.closestDefectPairAtomIds[0])!
  const coreCenter: Vec3 = [0, 1, 2].map((axis) => (
    seedValidation.evidence.construction.cores.reduce((sum, core) => sum + core.positionA[axis], 0) / 2
  )) as Vec3
  const inspectionTargets: InspectionTarget[] = [
    {
      id: 'periodic-dislocation-relaxation-core-anchors',
      reason: 'Inspect stable atom anchors around both atomman seed cores after matched fixed-cell relaxation',
      center: coreCenter,
      radius: Math.max(2 * evidence.construction.burgersMagnitudeA, seedValidation.evidence.metrics.minimumCoreSeparationA * 0.65),
      atomIds: coreAnchorAtomIds.slice(0, 80),
      ...(coreAnchorAtomIds.length > 80 ? { atomIdsTruncated: true as const } : {}),
    },
    {
      id: 'periodic-dislocation-relaxation-maximum-differential',
      reason: `Inspect maximum gauge-removed defect/reference differential displacement ${maximumDifferentialDisplacementA.toPrecision(6)} Å`,
      center: [...maxDifferentialAtom.position],
      radius: Math.max(2.5, 2 * evidence.construction.burgersMagnitudeA),
      atomIds: [maxDifferentialAtom.id],
    },
    {
      id: 'periodic-dislocation-relaxation-maximum-force',
      reason: `Inspect relaxed defect maximum-force atom ${maximumDefectForceEvPerA.toPrecision(6)} eV/Å`,
      center: [...relaxedDefect.atoms[indexById.get(evidence.diagnostics.maximumDefectForceAtomId)!].position],
      radius: 2.5,
      atomIds: [evidence.diagnostics.maximumDefectForceAtomId],
    },
    {
      id: 'periodic-dislocation-relaxation-closest-pair',
      reason: `Inspect relaxed defect closest certified periodic pair at ${defectEvidence.metrics.minimumPairDistanceA.toPrecision(6)} Å`,
      center: [...closestAtom.position],
      radius: Math.max(2.5, 2 * defectEvidence.metrics.minimumPairDistanceA),
      atomIds: evidence.diagnostics.closestDefectPairAtomIds,
    },
  ]
  return {
    evidence,
    balancedReferenceStructure: balancedReference,
    fingerprint: fingerprintPeriodicDislocationRelaxationEvidence(evidence),
    checks,
    inspectionTargets,
  }
}

export function parseZatomPeriodicDislocationRelaxationEvidence(
  value: unknown,
  options: ParseZatomPeriodicDislocationRelaxationEvidenceOptions,
): ZatomPeriodicDislocationRelaxationEvidenceValidation {
  if (utf8Bytes(value) > positiveBudget(options.maxArtifactBytes, 16 * 1024 * 1024, 'maxArtifactBytes')) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('periodic_dislocation_relaxation_budget_exceeded', 'Evidence exceeds maxArtifactBytes')
  }
  const validation = buildValidation(value, options)
  if (canonicalJsonIdentity(value) !== canonicalJsonIdentity(validation.evidence)) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError(
      'periodic_dislocation_relaxation_derived_mismatch',
      'Evidence differs from canonical structure/evidence-bound fingerprints, construction, model, metrics, or diagnostics',
    )
  }
  return validation
}

export function composeZatomPeriodicDislocationRelaxationEvidence(
  input: ComposeZatomPeriodicDislocationRelaxationEvidenceInput,
  budgets: Pick<ParseZatomPeriodicDislocationRelaxationEvidenceOptions, 'maxMinimumImageCandidateEvaluations' | 'maxMetadataBytes'> = {},
): ZatomPeriodicDislocationRelaxationEvidenceValidation {
  return buildValidation({
    schemaVersion: ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA,
    sourceStructureFingerprint: '',
    seedStructureFingerprint: '',
    seedEvidenceFingerprint: '',
    balancedReferenceStructureFingerprint: '',
    relaxedDefectStructureFingerprint: '',
    relaxedReferenceStructureFingerprint: '',
    defectRelaxationEvidenceFingerprint: '',
    referenceRelaxationEvidenceFingerprint: '',
    construction: {},
    model: {},
    acceptance: input.acceptance,
    metrics: {},
    diagnostics: {},
    provenance: input.provenance,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, {
    sourceStructure: input.sourceStructure,
    seedStructure: input.seedStructure,
    relaxedDefectStructure: input.relaxedDefectStructure,
    relaxedReferenceStructure: input.relaxedReferenceStructure,
    seedEvidence: input.seedEvidence,
    defectRelaxationEvidence: input.defectRelaxationEvidence,
    referenceRelaxationEvidence: input.referenceRelaxationEvidence,
    ...budgets,
  })
}
