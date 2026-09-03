/** Canonical same-model adhesion arithmetic over one interface and its matched isolated references. */

import type { InspectionTarget, JsonValue, ValidationCheck, Vec3, ZatomStructure } from './contracts'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

export const ZATOM_INTERFACE_ADHESION_EVIDENCE_SCHEMA = 'zatom.interface-adhesion-evidence/v2' as const

const EV_PER_A2_TO_J_PER_M2 = 16.02176634
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024

export type InterfaceAdhesionEnergyKind = 'potential-energy' | 'electronic-total-energy'
export type InterfaceAdhesionGeometryProtocol = 'unrelaxed-single-point' | 'independently-relaxed-fixed-cell'

export interface InterfaceAdhesionEnergyObservation {
  id: string
  structureFingerprint: string
  energyEv: number
  artifactFingerprint: string
}

export interface InterfaceAdhesionModelDeclaration {
  identityFingerprint: string
  engine: string
  engineVersion: string
  method: string
  energyKind: InterfaceAdhesionEnergyKind
  geometryProtocol: InterfaceAdhesionGeometryProtocol
  applicability: {
    assessment: 'in-domain' | 'unknown' | 'out-of-domain'
    domain: string
    reasons: string[]
  }
  consistencyStatement: string
  citations: string[]
}

export interface ComposeInterfaceAdhesionEvidenceOptions {
  interfaceStructure: ZatomStructure
  bottomReferenceStructure: ZatomStructure
  topReferenceStructure: ZatomStructure
  observations: {
    interface: InterfaceAdhesionEnergyObservation
    bottomReference: InterfaceAdhesionEnergyObservation
    topReference: InterfaceAdhesionEnergyObservation
  }
  model: InterfaceAdhesionModelDeclaration
}

export interface InterfaceAdhesionEvidence {
  schemaVersion: typeof ZATOM_INTERFACE_ADHESION_EVIDENCE_SCHEMA
  constructionFingerprint: string
  referenceSetFingerprint: string
  structures: {
    interfaceFingerprint: string
    bottomReferenceFingerprint: string
    topReferenceFingerprint: string
    interfaceAtomCount: number
    bottomReferenceAtomCount: number
    topReferenceAtomCount: number
  }
  observations: ComposeInterfaceAdhesionEvidenceOptions['observations']
  model: InterfaceAdhesionModelDeclaration
  interfaceAreaA2: number
  interfaceCount: 1
  result: {
    interactionEnergyEv: number
    interactionEnergyEvPerA2: number
    workOfAdhesionEvPerA2: number
    workOfAdhesionJPerM2: number
    signConvention: 'interaction=E_interface-E_bottom-E_top; workOfAdhesion=-interaction/area'
  }
  provenance: {
    engine: 'zatom-interface-adhesion-composer'
    engineVersion: '1.0.0'
    parameters: Record<string, JsonValue>
    sourceArtifactFingerprints: string[]
  }
  scopeWarning: string
}

export interface ComposeInterfaceAdhesionEvidenceResult {
  evidence: InterfaceAdhesionEvidence
  evidenceFingerprint: string
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class InterfaceAdhesionEvidenceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'InterfaceAdhesionEvidenceInputError'
    this.code = code
  }
}

function record(value: unknown, field: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', `${field} must be an object`)
  }
  return value as Record<string, JsonValue>
}

function text(value: unknown, field: string, maximum = 4096): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.length > maximum) {
    throw new InterfaceAdhesionEvidenceInputError(
      'invalid_interface_adhesion_evidence',
      `${field} must be non-empty text of at most ${maximum} characters without NUL bytes`,
    )
  }
  return value.trim()
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', `${field} must be finite`)
  }
  return Object.is(value, -0) ? 0 : value
}

function stringList(value: unknown, field: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new InterfaceAdhesionEvidenceInputError(
      'invalid_interface_adhesion_evidence',
      `${field} must contain ${minimum}-${maximum} entries`,
    )
  }
  const result = value.map((item, index) => text(item, `${field}[${index}]`))
  if (new Set(result).size !== result.length) {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', `${field} must not repeat values`)
  }
  return result.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

function observation(
  value: InterfaceAdhesionEnergyObservation,
  field: string,
  expectedStructureFingerprint: string,
): InterfaceAdhesionEnergyObservation {
  if (!value || typeof value !== 'object') {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', `${field} is required`)
  }
  const parsed = {
    id: text(value.id, `${field}.id`, 128),
    structureFingerprint: text(value.structureFingerprint, `${field}.structureFingerprint`, 128),
    energyEv: finite(value.energyEv, `${field}.energyEv`),
    artifactFingerprint: text(value.artifactFingerprint, `${field}.artifactFingerprint`, 256),
  }
  if (parsed.structureFingerprint !== expectedStructureFingerprint) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_observation_binding_mismatch',
      `${field}.structureFingerprint does not match its exact structure`,
    )
  }
  return parsed
}

function model(value: InterfaceAdhesionModelDeclaration): InterfaceAdhesionModelDeclaration {
  if (!value || typeof value !== 'object') {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', 'model is required')
  }
  if (value.energyKind !== 'potential-energy' && value.energyKind !== 'electronic-total-energy') {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', 'model.energyKind is unsupported')
  }
  if (value.geometryProtocol !== 'unrelaxed-single-point'
    && value.geometryProtocol !== 'independently-relaxed-fixed-cell') {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', 'model.geometryProtocol is unsupported')
  }
  const applicability = value.applicability
  if (!applicability || (applicability.assessment !== 'in-domain'
    && applicability.assessment !== 'unknown' && applicability.assessment !== 'out-of-domain')) {
    throw new InterfaceAdhesionEvidenceInputError('invalid_interface_adhesion_evidence', 'model.applicability assessment is invalid')
  }
  return {
    identityFingerprint: text(value.identityFingerprint, 'model.identityFingerprint', 256),
    engine: text(value.engine, 'model.engine', 256),
    engineVersion: text(value.engineVersion, 'model.engineVersion', 256),
    method: text(value.method, 'model.method'),
    energyKind: value.energyKind,
    geometryProtocol: value.geometryProtocol,
    applicability: {
      assessment: applicability.assessment,
      domain: text(applicability.domain, 'model.applicability.domain'),
      reasons: stringList(applicability.reasons, 'model.applicability.reasons', 1, 32),
    },
    consistencyStatement: text(value.consistencyStatement, 'model.consistencyStatement'),
    citations: stringList(value.citations, 'model.citations', 1, 32),
  }
}

function interfaceMetadata(structure: ZatomStructure): Record<string, JsonValue> {
  const metadata = record(structure.metadata?.['zatom.interface'], 'interfaceStructure.metadata.zatom.interface')
  if (metadata.schemaVersion !== 'zatom.interface/v1') {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_construction_mismatch',
      'interfaceStructure must carry zatom.interface/v1 construction metadata',
    )
  }
  return metadata
}

function referenceMetadata(structure: ZatomStructure, role: 'bottom' | 'top'): Record<string, JsonValue> {
  const metadata = record(
    structure.metadata?.['zatom.interfaceReference'],
    `${role}ReferenceStructure.metadata.zatom.interfaceReference`,
  )
  if (metadata.schemaVersion !== 'zatom.interface-reference/v2' || metadata.role !== role) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_construction_mismatch',
      `${role} reference has the wrong construction role/schema`,
    )
  }
  return metadata
}

function referenceSetMetadata(structure: ZatomStructure): Record<string, JsonValue> {
  const metadata = record(
    structure.metadata?.['zatom.interfaceReferenceSet'],
    'interfaceStructure.metadata.zatom.interfaceReferenceSet',
  )
  if (metadata.schemaVersion !== 'zatom.interface-reference-set/v1') {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_reference_set_mismatch',
      'interfaceStructure must carry canonical zatom.interface-reference-set/v1 metadata',
    )
  }
  return metadata
}

function assertReferenceTopology(
  interfaceStructure: ZatomStructure,
  referenceStructure: ZatomStructure,
  role: 'bottom' | 'top',
): void {
  const interfaceRoles = new Map(interfaceStructure.atoms.map((atom) => [
    atom.id,
    atom.properties?.['zatom.interfaceLayer'],
  ]))
  const expected = (interfaceStructure.bonds ?? []).filter((bond) => (
    interfaceRoles.get(bond.atomIds[0]) === role && interfaceRoles.get(bond.atomIds[1]) === role
  )).sort((left, right) => left.id.localeCompare(right.id))
  const actual = [...(referenceStructure.bonds ?? [])].sort((left, right) => left.id.localeCompare(right.id))
  if (canonicalJsonIdentity(actual) !== canonicalJsonIdentity(expected)) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_partition_mismatch',
      `${role} reference topology must equal the exact layer-internal interface bond partition`,
    )
  }
}

function interfaceAreaA2(structure: ZatomStructure): number {
  const [first, second] = structure.lattice!.vectors
  const cross: Vec3 = [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ]
  const area = Math.hypot(...cross)
  if (!Number.isFinite(area) || area <= 1e-12) {
    throw new InterfaceAdhesionEvidenceInputError('interface_adhesion_cell_mismatch', 'Interface in-plane area is degenerate')
  }
  return area
}

export function composeInterfaceAdhesionEvidence(
  options: ComposeInterfaceAdhesionEvidenceOptions,
): ComposeInterfaceAdhesionEvidenceResult {
  const interfaceStructure = parseZatomStructure(options.interfaceStructure)
  const bottomReference = parseZatomStructure(options.bottomReferenceStructure)
  const topReference = parseZatomStructure(options.topReferenceStructure)
  for (const [field, structure] of [
    ['interfaceStructure', interfaceStructure],
    ['bottomReferenceStructure', bottomReference],
    ['topReferenceStructure', topReference],
  ] as const) {
    if (!structure.lattice || !structure.lattice.periodic.every(Boolean)) {
      throw new InterfaceAdhesionEvidenceInputError(
        'interface_adhesion_cell_mismatch',
        `${field} must have the same fully periodic fixed cell`,
      )
    }
    const validation = validateStructure(structure)
    if (validation.verdict === 'fail') {
      throw new InterfaceAdhesionEvidenceInputError(
        'invalid_interface_adhesion_structure',
        `${field} fails canonical structure validation`,
      )
    }
  }
  if (canonicalJsonIdentity(interfaceStructure.lattice) !== canonicalJsonIdentity(bottomReference.lattice)
    || canonicalJsonIdentity(interfaceStructure.lattice) !== canonicalJsonIdentity(topReference.lattice)) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_cell_mismatch',
      'Interface and both references must use one exact fixed lattice/PBC declaration',
    )
  }
  const interfaceMeta = interfaceMetadata(interfaceStructure)
  const referenceSetMeta = referenceSetMetadata(interfaceStructure)
  const bottomMeta = referenceMetadata(bottomReference, 'bottom')
  const topMeta = referenceMetadata(topReference, 'top')
  const constructionFingerprint = text(interfaceMeta.constructionFingerprint, 'constructionFingerprint', 128)
  if (referenceSetMeta.constructionFingerprint !== constructionFingerprint
    || bottomMeta.constructionFingerprint !== constructionFingerprint
    || topMeta.constructionFingerprint !== constructionFingerprint) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_construction_mismatch',
      'Interface and references do not share one construction fingerprint',
    )
  }
  const referenceSetFingerprint = text(
    referenceSetMeta.referenceSetFingerprint,
    'referenceSetFingerprint',
    128,
  )
  if (bottomMeta.referenceSetFingerprint !== referenceSetFingerprint
    || topMeta.referenceSetFingerprint !== referenceSetFingerprint) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_reference_set_mismatch',
      'Interface and references do not share one reference-set fingerprint',
    )
  }
  const interfaceById = new Map(interfaceStructure.atoms.map((atom) => [atom.id, atom]))
  const referenceAtoms = [...bottomReference.atoms, ...topReference.atoms]
  if (referenceAtoms.length !== interfaceStructure.atoms.length
    || new Set(referenceAtoms.map((atom) => atom.id)).size !== referenceAtoms.length) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_partition_mismatch',
      'Bottom/top references must form one non-overlapping atom-ID partition of the interface',
    )
  }
  for (const [role, structure] of [
    ['bottom', bottomReference],
    ['top', topReference],
  ] as const) {
    for (const atom of structure.atoms) {
      const interfaceAtom = interfaceById.get(atom.id)
      if (!interfaceAtom || interfaceAtom.element !== atom.element
        || interfaceAtom.properties?.['zatom.interfaceLayer'] !== role) {
        throw new InterfaceAdhesionEvidenceInputError(
          'interface_adhesion_partition_mismatch',
          `Reference atom ${atom.id} is absent, changes element, or belongs to the wrong interface layer`,
        )
      }
    }
    assertReferenceTopology(interfaceStructure, structure, role)
  }
  if (referenceSetMeta.bottomAtomCount !== bottomReference.atoms.length
    || referenceSetMeta.topAtomCount !== topReference.atoms.length) {
      throw new InterfaceAdhesionEvidenceInputError(
        'interface_adhesion_partition_mismatch',
        'Reference atom counts do not match the bound reference-set declaration',
      )
  }
  const interfaceFingerprint = fingerprintStructure(interfaceStructure)
  const bottomReferenceFingerprint = fingerprintStructure(bottomReference)
  const topReferenceFingerprint = fingerprintStructure(topReference)
  const observations = {
    interface: observation(options.observations.interface, 'observations.interface', interfaceFingerprint),
    bottomReference: observation(
      options.observations.bottomReference,
      'observations.bottomReference',
      bottomReferenceFingerprint,
    ),
    topReference: observation(options.observations.topReference, 'observations.topReference', topReferenceFingerprint),
  }
  const observationIds = Object.values(observations).map((item) => item.id)
  if (new Set(observationIds).size !== observationIds.length) {
    throw new InterfaceAdhesionEvidenceInputError(
      'invalid_interface_adhesion_evidence',
      'Energy observation IDs must be unique',
    )
  }
  const parsedModel = model(options.model)
  const areaA2 = interfaceAreaA2(interfaceStructure)
  const interactionEnergyEv = observations.interface.energyEv
    - observations.bottomReference.energyEv
    - observations.topReference.energyEv
  const interactionEnergyEvPerA2 = interactionEnergyEv / areaA2
  const workOfAdhesionEvPerA2 = -interactionEnergyEvPerA2
  const workOfAdhesionJPerM2 = workOfAdhesionEvPerA2 * EV_PER_A2_TO_J_PER_M2
  const scopeWarning = 'This artifact proves only same-declaration energy arithmetic for one fixed-cell interface/reference partition. It does not establish model applicability, basis/potential/size/k-point convergence, zero-point or thermal/entropic corrections, solvent/chemical-potential effects, preferred registry, reconstruction, fracture path, or experimental adhesion.'
  const evidence: InterfaceAdhesionEvidence = {
    schemaVersion: ZATOM_INTERFACE_ADHESION_EVIDENCE_SCHEMA,
    constructionFingerprint,
    referenceSetFingerprint,
    structures: {
      interfaceFingerprint,
      bottomReferenceFingerprint,
      topReferenceFingerprint,
      interfaceAtomCount: interfaceStructure.atoms.length,
      bottomReferenceAtomCount: bottomReference.atoms.length,
      topReferenceAtomCount: topReference.atoms.length,
    },
    observations,
    model: parsedModel,
    interfaceAreaA2: areaA2,
    interfaceCount: 1,
    result: {
      interactionEnergyEv,
      interactionEnergyEvPerA2,
      workOfAdhesionEvPerA2,
      workOfAdhesionJPerM2,
      signConvention: 'interaction=E_interface-E_bottom-E_top; workOfAdhesion=-interaction/area',
    },
    provenance: {
      engine: 'zatom-interface-adhesion-composer',
      engineVersion: '1.0.0',
      parameters: {
        energyKind: parsedModel.energyKind,
        geometryProtocol: parsedModel.geometryProtocol,
        interfaceCount: 1,
        referenceSetFingerprint,
        evPerA2ToJPerM2: EV_PER_A2_TO_J_PER_M2,
      },
      sourceArtifactFingerprints: Object.values(observations).map((item) => item.artifactFingerprint).sort(),
    },
    scopeWarning,
  }
  const applicabilityStatus = parsedModel.applicability.assessment === 'in-domain'
    ? 'pass'
    : parsedModel.applicability.assessment === 'unknown' ? 'warn' : 'fail'
  const checks: ValidationCheck[] = [
    {
      id: 'interface_adhesion.structure_binding',
      status: 'pass',
      message: 'Every energy observation is bound to the exact supplied structure fingerprint',
      metrics: { interfaceFingerprint, bottomReferenceFingerprint, topReferenceFingerprint },
    },
    {
      id: 'interface_adhesion.reference_partition',
      status: 'pass',
      message: `Bottom/top references form exact layer/topology partitions bound by ${referenceSetFingerprint} in one fixed cell`,
      metrics: {
        constructionFingerprint,
        referenceSetFingerprint,
        interfaceAtomCount: interfaceStructure.atoms.length,
        bottomReferenceAtomCount: bottomReference.atoms.length,
        topReferenceAtomCount: topReference.atoms.length,
        interfaceAreaA2: areaA2,
      },
    },
    {
      id: 'interface_adhesion.model_identity',
      status: 'pass',
      message: `All three observations share declared model ${parsedModel.identityFingerprint} (${parsedModel.engine} ${parsedModel.engineVersion}; ${parsedModel.energyKind})`,
      metrics: { modelIdentityFingerprint: parsedModel.identityFingerprint },
    },
    {
      id: 'interface_adhesion.energy_arithmetic',
      status: 'pass',
      message: `Interaction ${interactionEnergyEv.toExponential(8)} eV; work of adhesion ${workOfAdhesionEvPerA2.toExponential(8)} eV/Å² = ${workOfAdhesionJPerM2.toExponential(8)} J/m²`,
      metrics: {
        interfaceEnergyEv: observations.interface.energyEv,
        bottomReferenceEnergyEv: observations.bottomReference.energyEv,
        topReferenceEnergyEv: observations.topReference.energyEv,
        interactionEnergyEv,
        workOfAdhesionEvPerA2,
        workOfAdhesionJPerM2,
      },
    },
    {
      id: 'interface_adhesion.applicability',
      status: applicabilityStatus,
      message: `Model applicability is ${parsedModel.applicability.assessment}: ${parsedModel.applicability.reasons.join(' ')}`,
    },
    {
      id: 'interface_adhesion.geometry_protocol',
      status: 'warn',
      message: parsedModel.geometryProtocol === 'unrelaxed-single-point'
        ? 'Energy differences use unrelaxed geometry seeds and do not include structural accommodation'
        : 'Each structure was declared independently relaxed at fixed cell; this does not prove matched convergence or a common basin',
    },
    {
      id: 'interface_adhesion.model_scope',
      status: 'warn',
      message: scopeWarning,
    },
  ]
  const interfaceAtoms = interfaceStructure.atoms.filter((atom) => atom.properties?.['zatom.interfaceLayer'])
  const interfaceBounds = boundsOfPositions(interfaceAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = interfaceBounds ? [{
    id: 'interface-adhesion-geometry',
    reason: 'Inspect the exact interface geometry bound to the adhesion arithmetic',
    center: interfaceBounds.center,
    radius: Math.max(2, interfaceBounds.radius),
    atomIds: interfaceAtoms.slice(0, 256).map((atom) => atom.id),
    ...(interfaceAtoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }] : []
  const evidenceFingerprint = fingerprintCanonicalJson(evidence)
  const artifactBytes = new TextEncoder().encode(JSON.stringify(evidence)).length
  if (artifactBytes > MAX_ARTIFACT_BYTES) {
    throw new InterfaceAdhesionEvidenceInputError(
      'interface_adhesion_artifact_too_large',
      `Evidence occupies ${artifactBytes.toLocaleString()} bytes above the fixed ${MAX_ARTIFACT_BYTES.toLocaleString()}-byte limit`,
    )
  }
  return { evidence, evidenceFingerprint, checks, inspectionTargets }
}
