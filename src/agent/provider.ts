/** Standard contract and registry for specialist atomistic modeling engines. */

import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  ZatomTrajectoryFrame,
  ZatomStructure,
  ZatomTrajectory,
  ZatomToolContext,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import { canonicalJsonIdentity, fingerprintCanonicalJson, fingerprintStructure } from './structure-math'
import {
  compileZatomJsonSchema,
  formatZatomJsonSchemaErrors,
  type ZatomJsonSchemaValidator,
} from './json-schema'
import { parseZatomStructure, validateStructure, ZatomStructureInputError } from './structure-validation'
import type { ZatomStructureEnsemble } from './structure-ensemble'
import {
  parseZatomStructureEnsemble,
  ZatomStructureEnsembleInputError,
} from './structure-ensemble'
import type { ZatomPeriodicStructureEnsemble } from './periodic-structure-ensemble'
import {
  parseZatomPeriodicStructureEnsemble,
  ZatomPeriodicStructureEnsembleInputError,
} from './periodic-structure-ensemble'
import { fingerprintTrajectory, parseZatomTrajectory, ZatomTrajectoryInputError } from './trajectory'
import type { ZatomForceFieldPackage } from './force-field-package'
import {
  parseZatomForceFieldPackage,
  ZatomForceFieldPackageInputError,
} from './force-field-package'
import type { ZatomChemicalStateEnsemble } from './chemical-state-ensemble'
import {
  parseZatomChemicalStateEnsemble,
  ZatomChemicalStateEnsembleInputError,
} from './chemical-state-ensemble'
import type { ZatomChemicalStateStructureCatalog } from './chemical-state-structure-catalog'
import {
  parseZatomChemicalStateStructureCatalog,
  ZatomChemicalStateStructureCatalogInputError,
} from './chemical-state-structure-catalog'
import type { ZatomChemicalStateStructuralDistribution } from './chemical-state-structural-distribution'
import {
  parseZatomChemicalStateStructuralDistribution,
  ZatomChemicalStateStructuralDistributionInputError,
} from './chemical-state-structural-distribution'
import type { ZatomMicroPkaEvidence } from './micro-pka-evidence'
import {
  parseZatomMicroPkaEvidence,
  ZatomMicroPkaEvidenceInputError,
} from './micro-pka-evidence'
import type { ZatomMicrostateTransitionGraph } from './microstate-transition-graph'
import {
  parseZatomMicrostateTransitionGraph,
  ZatomMicrostateTransitionGraphInputError,
} from './microstate-transition-graph'
import type { ZatomMicrostateStateCoverage } from './microstate-state-coverage'
import {
  parseZatomMicrostateStateCoverage,
  ZatomMicrostateStateCoverageInputError,
} from './microstate-state-coverage'
import type { ZatomMicrostateEquilibriumPotentialEnsemble } from './microstate-equilibrium-potential-ensemble'
import {
  parseZatomMicrostateEquilibriumPotentialEnsemble,
  type ZatomMicrostateEquilibriumPotentialEnsembleValidation,
  ZatomMicrostateEquilibriumPotentialEnsembleInputError,
} from './microstate-equilibrium-potential-ensemble'
import type { ZatomMicrostatePotentialSampleDiagnostics } from './microstate-potential-sample-diagnostics'
import {
  parseZatomMicrostatePotentialSampleDiagnostics,
  ZatomMicrostatePotentialSampleDiagnosticsInputError,
} from './microstate-potential-sample-diagnostics'
import type { ZatomSqsQualityEvidence } from './sqs-quality-evidence'
import {
  parseZatomSqsQualityEvidence,
  ZatomSqsQualityEvidenceInputError,
} from './sqs-quality-evidence'
import type { ZatomContinuumDislocationEvidence } from './continuum-dislocation-evidence'
import {
  parseZatomContinuumDislocationEvidence,
  ZatomContinuumDislocationEvidenceInputError,
} from './continuum-dislocation-evidence'
import type { ZatomPeriodicDislocationDipoleEvidence } from './periodic-dislocation-dipole-evidence'
import {
  parseZatomPeriodicDislocationDipoleEvidence,
  ZatomPeriodicDislocationDipoleEvidenceInputError,
} from './periodic-dislocation-dipole-evidence'
import type { ZatomFixedCellRelaxationEvidence } from './fixed-cell-relaxation-evidence'
import {
  parseZatomFixedCellRelaxationEvidence,
  ZatomFixedCellRelaxationEvidenceInputError,
} from './fixed-cell-relaxation-evidence'

export const ZATOM_PROVIDER_SCHEMA = 'zatom.provider/v1' as const
export const ZATOM_PROVIDER_CAPABILITY_IDENTITY_SCHEMA = 'zatom.provider-capability-identity/v1' as const

export type ZatomProviderFidelity =
  | 'geometric'
  | 'statistical'
  | 'continuum'
  | 'empirical'
  | 'force-field'
  | 'electronic-structure'

export type ZatomProviderSourceMode = 'none' | 'optional' | 'required'
export type ZatomProviderInputArtifact = 'force-field-package' | 'chemical-state-ensemble'
export type ZatomProviderOutputArtifact =
  | 'structure-ensemble'
  | 'periodic-structure-ensemble'
  | 'force-field-package'
  | 'chemical-state-ensemble'
  | 'chemical-state-structure-catalog'
  | 'chemical-state-structural-distribution'
  | 'micro-pka-evidence'
  | 'microstate-transition-graph'
  | 'microstate-state-coverage'
  | 'microstate-equilibrium-potential-ensemble'
  | 'microstate-potential-sample-diagnostics'
  | 'sqs-quality-evidence'
  | 'continuum-dislocation-evidence'
  | 'periodic-dislocation-dipole-evidence'
  | 'fixed-cell-relaxation-evidence'

export interface ZatomProviderInputArtifactContract {
  artifact: ZatomProviderInputArtifact
  mode: Exclude<ZatomProviderSourceMode, 'none'>
}

export type ZatomProviderContinuationFrameField = 'velocitiesAperPs' | 'forcesEvPerA' | 'lattice'

export interface ZatomProviderContinuationContract {
  mode: ZatomProviderSourceMode
  /** Continuation currently consumes only the trajectory's validated final frame. */
  frame: 'final'
  requiredFrameFields?: ZatomProviderContinuationFrameField[]
}

/** Compact, fingerprint-bound state extracted from one canonical source trajectory. */
export interface ZatomProviderContinuationState {
  schemaVersion: 'zatom.provider-continuation/v1'
  sourceTrajectoryFingerprint: string
  sourceFrameCount: number
  frameIndex: number
  atomIds: string[]
  coordinateMode: ZatomTrajectory['coordinateMode']
  /** The effective lattice is copied onto the frame even for a fixed-cell source trajectory. */
  frame: ZatomTrajectoryFrame
}

/** Host-declared preflight applicability exposed during provider discovery. */
export interface ZatomProviderCapabilityApplicability {
  model?: { id: string; version: string; description: string }
  supportedElements?: string[]
  scopeWarning?: string
  citations?: string[]
}

export interface ZatomProviderCapability {
  /** Stable semantic identifier, e.g. `defect.dislocation.isotropic`. */
  id: string
  title: string
  description: string
  fidelity: ZatomProviderFidelity
  source: ZatomProviderSourceMode
  /** Omitted means this capability rejects trajectory continuation state. */
  continuation?: ZatomProviderContinuationContract
  deterministic: boolean
  inputSchema: Record<string, unknown>
  /** Domain checks that the adapter must emit for every successful result. */
  requiredCheckIds: string[]
  /** Canonical non-structure artifacts accepted by this capability. */
  inputArtifacts?: ZatomProviderInputArtifactContract[]
  /** Canonical non-structure artifacts that a successful execution must return. */
  outputArtifacts?: ZatomProviderOutputArtifact[]
  /** Structured model/element/scope metadata available before execution. */
  applicability?: ZatomProviderCapabilityApplicability
  tags: string[]
}

export interface ZatomProviderManifest {
  schemaVersion: typeof ZATOM_PROVIDER_SCHEMA
  id: string
  title: string
  description: string
  adapterVersion: string
  engine: { name: string; version: string }
  execution: 'browser' | 'remote'
  capabilities: ZatomProviderCapability[]
}

export interface ZatomDiscoveredProviderCapability extends ZatomProviderCapability {
  fingerprint: string
}

export interface ZatomDiscoveredProviderManifest extends Omit<ZatomProviderManifest, 'capabilities'> {
  capabilities: ZatomDiscoveredProviderCapability[]
}

export function fingerprintZatomProviderCapability(
  provider: ZatomProviderManifest,
  capability: ZatomProviderCapability,
): string {
  return fingerprintCanonicalJson({
    schemaVersion: ZATOM_PROVIDER_CAPABILITY_IDENTITY_SCHEMA,
    provider: {
      schemaVersion: provider.schemaVersion,
      id: provider.id,
      title: provider.title,
      description: provider.description,
      adapterVersion: provider.adapterVersion,
      engine: provider.engine,
      execution: provider.execution,
    },
    capability,
  })
}

export interface ZatomProviderExecutionRequest {
  capability: string
  source: ZatomStructure | null
  continuation: ZatomProviderContinuationState | null
  forceFieldPackage?: {
    schemaVersion: 'zatom.provider-force-field-package/v1'
    fingerprint: string
    package: ZatomForceFieldPackage
  } | null
  chemicalStateEnsemble?: {
    schemaVersion: 'zatom.provider-chemical-state-ensemble/v1'
    fingerprint: string
    ensemble: ZatomChemicalStateEnsemble
  } | null
  parameters: Record<string, unknown>
  seed: number
}

/** Raw adapter output. The broker validates every field before exposing it. */
export interface ZatomProviderOutput {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  structureEnsemble?: ZatomStructureEnsemble
  periodicStructureEnsemble?: ZatomPeriodicStructureEnsemble
  forceFieldPackage?: ZatomForceFieldPackage
  chemicalStateEnsemble?: ZatomChemicalStateEnsemble
  chemicalStateStructureCatalog?: ZatomChemicalStateStructureCatalog
  chemicalStateStructuralDistribution?: ZatomChemicalStateStructuralDistribution
  microPkaEvidence?: ZatomMicroPkaEvidence
  microstateTransitionGraph?: ZatomMicrostateTransitionGraph
  microstateStateCoverage?: ZatomMicrostateStateCoverage
  microstateEquilibriumPotentialEnsemble?: ZatomMicrostateEquilibriumPotentialEnsemble
  microstatePotentialSampleDiagnostics?: ZatomMicrostatePotentialSampleDiagnostics
  sqsQualityEvidence?: ZatomSqsQualityEvidence
  continuumDislocationEvidence?: ZatomContinuumDislocationEvidence
  periodicDislocationDipoleEvidence?: ZatomPeriodicDislocationDipoleEvidence
  fixedCellRelaxationEvidence?: ZatomFixedCellRelaxationEvidence
  checks: ValidationCheck[]
  inspectionTargets?: InspectionTarget[]
  summary?: string
  details?: Record<string, JsonValue>
  /** Concise replay parameters; do not repeat embedded structure payloads. */
  provenanceParameters?: Record<string, JsonValue>
}

export interface ZatomModelingProvider {
  manifest: ZatomProviderManifest
  execute(
    request: ZatomProviderExecutionRequest,
    context: ZatomToolContext,
  ): ZatomProviderOutput | Promise<ZatomProviderOutput>
}

export interface ZatomProviderCandidate {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  structureEnsemble?: ZatomStructureEnsemble
  periodicStructureEnsemble?: ZatomPeriodicStructureEnsemble
  forceFieldPackage?: ZatomForceFieldPackage
  chemicalStateEnsemble?: ZatomChemicalStateEnsemble
  chemicalStateStructureCatalog?: ZatomChemicalStateStructureCatalog
  chemicalStateStructuralDistribution?: ZatomChemicalStateStructuralDistribution
  microPkaEvidence?: ZatomMicroPkaEvidence
  microstateTransitionGraph?: ZatomMicrostateTransitionGraph
  microstateStateCoverage?: ZatomMicrostateStateCoverage
  microstateEquilibriumPotentialEnsemble?: ZatomMicrostateEquilibriumPotentialEnsemble
  microstatePotentialSampleDiagnostics?: ZatomMicrostatePotentialSampleDiagnostics
  sqsQualityEvidence?: ZatomSqsQualityEvidence
  continuumDislocationEvidence?: ZatomContinuumDislocationEvidence
  periodicDislocationDipoleEvidence?: ZatomPeriodicDislocationDipoleEvidence
  fixedCellRelaxationEvidence?: ZatomFixedCellRelaxationEvidence
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  provider: {
    id: string
    title: string
    adapterVersion: string
    engine: { name: string; version: string }
    capability: string
    fidelity: ZatomProviderFidelity
    execution: ZatomProviderManifest['execution']
  }
  details?: Record<string, JsonValue>
}

export class ZatomProviderError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomProviderError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertIdentifier(value: string, field: string): void {
  if (!/^[a-z][a-z0-9.-]{1,95}$/.test(value)) {
    throw new ZatomProviderError('invalid_provider_manifest', `${field} must use 2-96 lowercase letters, digits, dots, or hyphens`)
  }
}

function validateManifest(manifest: ZatomProviderManifest): void {
  if (manifest.schemaVersion !== ZATOM_PROVIDER_SCHEMA) {
    throw new ZatomProviderError('invalid_provider_manifest', `provider schemaVersion must be ${ZATOM_PROVIDER_SCHEMA}`)
  }
  assertIdentifier(manifest.id, 'provider.id')
  if (!manifest.title.trim() || !manifest.description.trim() || !manifest.adapterVersion.trim()) {
    throw new ZatomProviderError('invalid_provider_manifest', 'provider title, description, and adapterVersion are required')
  }
  if (!manifest.engine.name.trim() || !manifest.engine.version.trim()) {
    throw new ZatomProviderError('invalid_provider_manifest', 'provider engine name and version are required')
  }
  if (!manifest.capabilities.length) {
    throw new ZatomProviderError('invalid_provider_manifest', 'provider must declare at least one capability')
  }
  const capabilityIds = new Set<string>()
  for (const capability of manifest.capabilities) {
    assertIdentifier(capability.id, `provider ${manifest.id} capability.id`)
    if (capabilityIds.has(capability.id)) {
      throw new ZatomProviderError('invalid_provider_manifest', `provider ${manifest.id} repeats capability ${capability.id}`)
    }
    capabilityIds.add(capability.id)
    if (!capability.title.trim() || !capability.description.trim() || !isRecord(capability.inputSchema)) {
      throw new ZatomProviderError('invalid_provider_manifest', `provider ${manifest.id} capability ${capability.id} is incomplete`)
    }
    if (capability.applicability !== undefined) {
      const applicability = capability.applicability as unknown
      if (!isRecord(applicability)
        || Object.keys(applicability).some((key) => !['model', 'supportedElements', 'scopeWarning', 'citations'].includes(key))
        || (applicability.model !== undefined && (
          !isRecord(applicability.model)
          || Object.keys(applicability.model).some((key) => !['id', 'version', 'description'].includes(key))
          || typeof applicability.model.id !== 'string' || !applicability.model.id.trim()
          || typeof applicability.model.version !== 'string' || !applicability.model.version.trim()
          || typeof applicability.model.description !== 'string' || !applicability.model.description.trim()
        ))
        || (applicability.supportedElements !== undefined && (
          !Array.isArray(applicability.supportedElements)
          || applicability.supportedElements.length < 1
          || applicability.supportedElements.some((element) => typeof element !== 'string' || !element.trim())
          || new Set(applicability.supportedElements).size !== applicability.supportedElements.length
        ))
        || (applicability.scopeWarning !== undefined && (
          typeof applicability.scopeWarning !== 'string' || !applicability.scopeWarning.trim()
        ))
        || (applicability.citations !== undefined && (
          !Array.isArray(applicability.citations)
          || applicability.citations.length < 1
          || applicability.citations.some((citation) => typeof citation !== 'string' || !citation.trim())
          || new Set(applicability.citations).size !== applicability.citations.length
        ))) {
        throw new ZatomProviderError(
          'invalid_provider_manifest',
          `provider ${manifest.id} capability ${capability.id} has invalid applicability metadata`,
        )
      }
    }
    if (capability.continuation !== undefined) {
      const contract = capability.continuation as unknown
      if (!isRecord(contract)) {
        throw new ZatomProviderError(
          'invalid_provider_manifest',
          `provider ${manifest.id} capability ${capability.id} has an invalid continuation contract`,
        )
      }
      const fields = contract.requiredFrameFields ?? []
      const allowedFields = new Set<ZatomProviderContinuationFrameField>(['velocitiesAperPs', 'forcesEvPerA', 'lattice'])
      if ((contract.mode !== 'none' && contract.mode !== 'optional' && contract.mode !== 'required')
        || contract.frame !== 'final'
        || !Array.isArray(fields)
        || fields.some((field) => !allowedFields.has(field))
        || new Set(fields).size !== fields.length
        || (contract.mode === 'none' && fields.length > 0)) {
        throw new ZatomProviderError(
          'invalid_provider_manifest',
          `provider ${manifest.id} capability ${capability.id} has an invalid continuation contract`,
        )
      }
    }
    if (new Set(capability.requiredCheckIds).size !== capability.requiredCheckIds.length) {
      throw new ZatomProviderError('invalid_provider_manifest', `provider ${manifest.id} capability ${capability.id} repeats a required check ID`)
    }
    const inputArtifacts = capability.inputArtifacts ?? []
    if (!Array.isArray(inputArtifacts)
      || inputArtifacts.some((contract) => (
        !isRecord(contract)
        || Object.keys(contract).some((key) => key !== 'artifact' && key !== 'mode')
        || Object.keys(contract).length !== 2
        || (contract.artifact !== 'force-field-package'
          && contract.artifact !== 'chemical-state-ensemble')
        || (contract.mode !== 'optional' && contract.mode !== 'required')
      ))
      || new Set(inputArtifacts.map((contract) => contract.artifact)).size !== inputArtifacts.length) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} has invalid inputArtifacts`,
      )
    }
    if (inputArtifacts.length > 0 && capability.source === 'none') {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must accept a source structure to bind canonical input artifacts`,
      )
    }
    const outputArtifacts = capability.outputArtifacts ?? []
    if (!Array.isArray(outputArtifacts)
      || outputArtifacts.some((artifact) => (
        artifact !== 'structure-ensemble'
        && artifact !== 'periodic-structure-ensemble'
        && artifact !== 'force-field-package'
        && artifact !== 'chemical-state-ensemble'
        && artifact !== 'chemical-state-structure-catalog'
        && artifact !== 'chemical-state-structural-distribution'
        && artifact !== 'micro-pka-evidence'
        && artifact !== 'microstate-transition-graph'
        && artifact !== 'microstate-state-coverage'
        && artifact !== 'microstate-equilibrium-potential-ensemble'
        && artifact !== 'microstate-potential-sample-diagnostics'
        && artifact !== 'sqs-quality-evidence'
        && artifact !== 'continuum-dislocation-evidence'
        && artifact !== 'periodic-dislocation-dipole-evidence'
        && artifact !== 'fixed-cell-relaxation-evidence'
      ))
      || new Set(outputArtifacts).size !== outputArtifacts.length) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} has invalid outputArtifacts`,
      )
    }
    if (outputArtifacts.includes('microstate-transition-graph')
      && !outputArtifacts.includes('chemical-state-ensemble')) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble with microstate-transition-graph`,
      )
    }
    if (outputArtifacts.includes('structure-ensemble')
      && outputArtifacts.includes('periodic-structure-ensemble')) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} cannot declare both finite and periodic structure ensembles`,
      )
    }
    if (outputArtifacts.includes('chemical-state-structural-distribution')
      && !outputArtifacts.includes('chemical-state-ensemble')) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble with chemical-state-structural-distribution`,
      )
    }
    if (outputArtifacts.includes('chemical-state-structure-catalog')
      && !outputArtifacts.includes('chemical-state-ensemble')) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble with chemical-state-structure-catalog`,
      )
    }
    if (outputArtifacts.includes('microstate-state-coverage')
      && (!outputArtifacts.includes('chemical-state-ensemble')
        || !outputArtifacts.includes('microstate-transition-graph'))) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble and microstate-transition-graph with microstate-state-coverage`,
      )
    }
    if (outputArtifacts.includes('microstate-equilibrium-potential-ensemble')
      && (!outputArtifacts.includes('chemical-state-ensemble')
        || !outputArtifacts.includes('microstate-transition-graph'))) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble and microstate-transition-graph with microstate-equilibrium-potential-ensemble`,
      )
    }
    if (outputArtifacts.includes('microstate-potential-sample-diagnostics')
      && (!outputArtifacts.includes('chemical-state-ensemble')
        || !outputArtifacts.includes('microstate-transition-graph')
        || !outputArtifacts.includes('microstate-equilibrium-potential-ensemble'))) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must declare chemical-state-ensemble, microstate-transition-graph, and microstate-equilibrium-potential-ensemble with microstate-potential-sample-diagnostics`,
      )
    }
    if (outputArtifacts.includes('sqs-quality-evidence') && capability.source !== 'required') {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must require a source structure with sqs-quality-evidence`,
      )
    }
    if (outputArtifacts.includes('continuum-dislocation-evidence') && capability.source !== 'required') {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must require a source structure with continuum-dislocation-evidence`,
      )
    }
    if (outputArtifacts.includes('periodic-dislocation-dipole-evidence') && capability.source !== 'required') {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must require a source structure with periodic-dislocation-dipole-evidence`,
      )
    }
    if (outputArtifacts.includes('fixed-cell-relaxation-evidence') && capability.source !== 'required') {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `provider ${manifest.id} capability ${capability.id} must require a source structure with fixed-cell-relaxation-evidence`,
      )
    }
  }
}

function normalizeCheck(value: unknown, index: number): ValidationCheck {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.message !== 'string'
    || (value.status !== 'pass' && value.status !== 'warn' && value.status !== 'fail' && value.status !== 'skipped')) {
    throw new ZatomProviderError('invalid_provider_result', `provider checks[${index}] is not a valid ValidationCheck`)
  }
  let metrics: ValidationCheck['metrics']
  if (value.metrics !== undefined) {
    if (!isRecord(value.metrics)) throw new ZatomProviderError('invalid_provider_result', `provider checks[${index}].metrics must be an object`)
    metrics = {}
    for (const [key, metric] of Object.entries(value.metrics)) {
      if (metric !== null && typeof metric !== 'number' && typeof metric !== 'string' && typeof metric !== 'boolean') {
        throw new ZatomProviderError('invalid_provider_result', `provider checks[${index}].metrics.${key} is not scalar`)
      }
      if (typeof metric === 'number' && !Number.isFinite(metric)) {
        throw new ZatomProviderError('invalid_provider_result', `provider checks[${index}].metrics.${key} must be finite`)
      }
      metrics[key] = metric
    }
  }
  let atomIds: string[] | undefined
  if (value.atomIds !== undefined) {
    if (!Array.isArray(value.atomIds) || value.atomIds.some((id) => typeof id !== 'string')) {
      throw new ZatomProviderError('invalid_provider_result', `provider checks[${index}].atomIds must be strings`)
    }
    atomIds = value.atomIds
  }
  return {
    id: value.id,
    status: value.status,
    message: value.message,
    ...(metrics ? { metrics } : {}),
    ...(atomIds ? { atomIds } : {}),
  }
}

function normalizeTarget(
  value: unknown,
  index: number,
  atomIds: Set<string>,
  trajectoryFrameCount: number | null,
): InspectionTarget {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()
    || typeof value.reason !== 'string' || !value.reason.trim()
    || !Array.isArray(value.center) || value.center.length !== 3
    || value.center.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    || typeof value.radius !== 'number' || !Number.isFinite(value.radius) || value.radius <= 0
    || !Array.isArray(value.atomIds) || value.atomIds.some((id) => typeof id !== 'string')) {
    throw new ZatomProviderError('invalid_provider_result', `provider inspectionTargets[${index}] is invalid`)
  }
  const missing = value.atomIds.filter((id) => !atomIds.has(id))
  if (missing.length) {
    throw new ZatomProviderError('invalid_provider_result', `provider inspection target ${value.id} references absent atom IDs: ${missing.slice(0, 5).join(', ')}`)
  }
  let trajectoryFrameIndex: number | undefined
  if (value.trajectoryFrameIndex !== undefined) {
    trajectoryFrameIndex = Number(value.trajectoryFrameIndex)
    if (!Number.isSafeInteger(trajectoryFrameIndex) || trajectoryFrameIndex < 0
      || trajectoryFrameCount === null || trajectoryFrameIndex >= trajectoryFrameCount) {
      throw new ZatomProviderError('invalid_provider_result', `provider inspection target ${value.id} has an invalid trajectoryFrameIndex`)
    }
  }
  return {
    id: value.id,
    reason: value.reason,
    center: [value.center[0], value.center[1], value.center[2]],
    radius: value.radius,
    atomIds: value.atomIds,
    ...(value.atomIdsTruncated === true ? { atomIdsTruncated: true } : {}),
    ...(trajectoryFrameIndex === undefined ? {} : { trajectoryFrameIndex }),
  }
}

function jsonCloneRecord(value: unknown, field: string): Record<string, JsonValue> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ZatomProviderError('invalid_provider_result', `${field} must be an object`)
  const visit = (item: unknown, path: string): JsonValue => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new ZatomProviderError('invalid_provider_result', `${path} must be finite`)
      return item
    }
    if (Array.isArray(item)) return item.map((child, index) => visit(child, `${path}[${index}]`))
    if (isRecord(item)) return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, `${path}.${key}`)]))
    throw new ZatomProviderError('invalid_provider_result', `${path} is not JSON-safe`)
  }
  return visit(value, field) as Record<string, JsonValue>
}

export function normalizeProviderOutput(options: {
  provider: ZatomModelingProvider
  capability: ZatomProviderCapability
  request: ZatomProviderExecutionRequest
  output: unknown
}): ZatomProviderCandidate {
  if (!isRecord(options.output)) throw new ZatomProviderError('invalid_provider_result', 'provider output must be an object')
  const structure = parseZatomStructure(options.output.structure)
  let structureEnsemble: ZatomStructureEnsemble | undefined
  let structureEnsembleFingerprint: string | undefined
  let structureEnsembleChecks: ValidationCheck[] = []
  let structureEnsembleTargets: InspectionTarget[] = []
  const requiresStructureEnsemble = options.capability.outputArtifacts?.includes('structure-ensemble') ?? false
  if (options.output.structureEnsemble !== undefined) {
    if (!requiresStructureEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned a structureEnsemble for a capability that did not declare that output artifact',
      )
    }
    try {
      const parsed = parseZatomStructureEnsemble(options.output.structureEnsemble, {
        selectedStructure: structure,
      })
      structureEnsemble = parsed.ensemble
      structureEnsembleFingerprint = parsed.fingerprint
      structureEnsembleChecks = parsed.checks
      structureEnsembleTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomStructureEnsembleInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresStructureEnsemble) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical structureEnsemble output artifact',
    )
  }
  let periodicStructureEnsemble: ZatomPeriodicStructureEnsemble | undefined
  let periodicStructureEnsembleFingerprint: string | undefined
  let periodicStructureEnsembleChecks: ValidationCheck[] = []
  let periodicStructureEnsembleTargets: InspectionTarget[] = []
  const requiresPeriodicStructureEnsemble = options.capability.outputArtifacts?.includes(
    'periodic-structure-ensemble',
  ) ?? false
  if (options.output.periodicStructureEnsemble !== undefined) {
    if (!requiresPeriodicStructureEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned periodicStructureEnsemble for an undeclared output artifact',
      )
    }
    try {
      const parsed = parseZatomPeriodicStructureEnsemble(options.output.periodicStructureEnsemble, {
        selectedStructure: structure,
      })
      periodicStructureEnsemble = parsed.ensemble
      periodicStructureEnsembleFingerprint = parsed.fingerprint
      periodicStructureEnsembleChecks = parsed.checks
      periodicStructureEnsembleTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomPeriodicStructureEnsembleInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresPeriodicStructureEnsemble) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical periodicStructureEnsemble output artifact',
    )
  }
  let trajectory: ZatomTrajectory | undefined
  if (options.output.trajectory !== undefined) {
    try {
      trajectory = parseZatomTrajectory(options.output.trajectory, { structure })
      if (options.request.continuation) {
        const expectedFingerprint = options.request.continuation.sourceTrajectoryFingerprint
        const existingFingerprint = trajectory.metadata?.['zatom.provider.sourceTrajectoryFingerprint']
        if (existingFingerprint !== undefined && existingFingerprint !== expectedFingerprint) {
          throw new ZatomProviderError(
            'invalid_provider_result',
            'Provider trajectory metadata conflicts with the broker-bound source trajectory fingerprint',
          )
        }
        trajectory = {
          ...trajectory,
          metadata: {
            ...(trajectory.metadata ?? {}),
            'zatom.provider.continuationSchemaVersion': options.request.continuation.schemaVersion,
            'zatom.provider.sourceTrajectoryFingerprint': expectedFingerprint,
            'zatom.provider.sourceTrajectoryFrameIndex': options.request.continuation.frameIndex,
            'zatom.provider.sourceTrajectoryFrameCount': options.request.continuation.sourceFrameCount,
          },
        }
      }
    } catch (error) {
      if (error instanceof ZatomTrajectoryInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  }
  let forceFieldPackage: ZatomForceFieldPackage | undefined
  let forceFieldPackageFingerprint: string | undefined
  let forceFieldPackageChecks: ValidationCheck[] = []
  let forceFieldPackageTargets: InspectionTarget[] = []
  const requiresForceFieldPackage = options.capability.outputArtifacts?.includes('force-field-package') ?? false
  if (options.output.forceFieldPackage !== undefined) {
    if (!requiresForceFieldPackage) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned a forceFieldPackage for a capability that did not declare that output artifact',
      )
    }
    try {
      const parsed = parseZatomForceFieldPackage(options.output.forceFieldPackage, { structure })
      forceFieldPackage = parsed.package
      forceFieldPackageFingerprint = parsed.fingerprint
      forceFieldPackageChecks = parsed.checks
      forceFieldPackageTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomForceFieldPackageInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresForceFieldPackage) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical forceFieldPackage output artifact',
    )
  }
  let chemicalStateEnsemble: ZatomChemicalStateEnsemble | undefined
  let chemicalStateEnsembleFingerprint: string | undefined
  let chemicalStateEnsembleChecks: ValidationCheck[] = []
  let chemicalStateEnsembleTargets: InspectionTarget[] = []
  const requiresChemicalStateEnsemble = options.capability.outputArtifacts?.includes('chemical-state-ensemble') ?? false
  if (options.output.chemicalStateEnsemble !== undefined) {
    if (!requiresChemicalStateEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned a chemicalStateEnsemble for a capability that did not declare that output artifact',
      )
    }
    try {
      const parsed = parseZatomChemicalStateEnsemble(options.output.chemicalStateEnsemble, { structure })
      chemicalStateEnsemble = parsed.ensemble
      chemicalStateEnsembleFingerprint = parsed.fingerprint
      chemicalStateEnsembleChecks = parsed.checks
      chemicalStateEnsembleTargets = parsed.inspectionTargets
      if (options.request.chemicalStateEnsemble
        && chemicalStateEnsembleFingerprint !== options.request.chemicalStateEnsemble.fingerprint) {
        throw new ZatomProviderError(
          'invalid_provider_result',
          'Provider changed the canonical chemical-state-ensemble input instead of returning the exact immutable dependency',
        )
      }
    } catch (error) {
      if (error instanceof ZatomChemicalStateEnsembleInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresChemicalStateEnsemble) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical chemicalStateEnsemble output artifact',
    )
  }
  let chemicalStateStructureCatalog: ZatomChemicalStateStructureCatalog | undefined
  let chemicalStateStructureCatalogFingerprint: string | undefined
  let chemicalStateStructureCatalogChecks: ValidationCheck[] = []
  let chemicalStateStructureCatalogTargets: InspectionTarget[] = []
  const requiresChemicalStateStructureCatalog = options.capability.outputArtifacts?.includes(
    'chemical-state-structure-catalog',
  ) ?? false
  if (options.output.chemicalStateStructureCatalog !== undefined) {
    if (!requiresChemicalStateStructureCatalog) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned chemicalStateStructureCatalog for an undeclared output artifact',
      )
    }
    if (!chemicalStateEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider chemicalStateStructureCatalog requires the same result to include a canonical chemicalStateEnsemble',
      )
    }
    try {
      const parsed = parseZatomChemicalStateStructureCatalog(
        options.output.chemicalStateStructureCatalog,
        {
          chemicalStateEnsemble,
          chemicalStateReferenceStructure: structure,
        },
      )
      chemicalStateStructureCatalog = parsed.catalog
      chemicalStateStructureCatalogFingerprint = parsed.fingerprint
      chemicalStateStructureCatalogChecks = parsed.checks
      chemicalStateStructureCatalogTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomChemicalStateStructureCatalogInputError
        || error instanceof ZatomChemicalStateEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresChemicalStateStructureCatalog) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical chemicalStateStructureCatalog output artifact',
    )
  }
  let chemicalStateStructuralDistribution: ZatomChemicalStateStructuralDistribution | undefined
  let chemicalStateStructuralDistributionFingerprint: string | undefined
  let chemicalStateStructuralDistributionChecks: ValidationCheck[] = []
  let chemicalStateStructuralDistributionTargets: InspectionTarget[] = []
  const requiresChemicalStateStructuralDistribution = options.capability.outputArtifacts?.includes(
    'chemical-state-structural-distribution',
  ) ?? false
  if (options.output.chemicalStateStructuralDistribution !== undefined) {
    if (!requiresChemicalStateStructuralDistribution) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned chemicalStateStructuralDistribution for an undeclared output artifact',
      )
    }
    if (!chemicalStateEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider chemicalStateStructuralDistribution requires the same result to include a canonical chemicalStateEnsemble',
      )
    }
    try {
      const parsed = parseZatomChemicalStateStructuralDistribution(
        options.output.chemicalStateStructuralDistribution,
        {
          chemicalStateEnsemble,
          chemicalStateReferenceStructure: structure,
          selectedStructure: structure,
        },
      )
      chemicalStateStructuralDistribution = parsed.distribution
      chemicalStateStructuralDistributionFingerprint = parsed.fingerprint
      chemicalStateStructuralDistributionChecks = parsed.checks
      chemicalStateStructuralDistributionTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomChemicalStateStructuralDistributionInputError
        || error instanceof ZatomChemicalStateEnsembleInputError
        || error instanceof ZatomStructureEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresChemicalStateStructuralDistribution) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical chemicalStateStructuralDistribution output artifact',
    )
  }
  let microPkaEvidence: ZatomMicroPkaEvidence | undefined
  let microPkaEvidenceFingerprint: string | undefined
  let microPkaEvidenceChecks: ValidationCheck[] = []
  let microPkaEvidenceTargets: InspectionTarget[] = []
  const requiresMicroPkaEvidence = options.capability.outputArtifacts?.includes('micro-pka-evidence') ?? false
  if (options.output.microPkaEvidence !== undefined) {
    if (!requiresMicroPkaEvidence) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned microPkaEvidence for a capability that did not declare that output artifact',
      )
    }
    try {
      const parsed = parseZatomMicroPkaEvidence(options.output.microPkaEvidence, { structure })
      microPkaEvidence = parsed.evidence
      microPkaEvidenceFingerprint = parsed.fingerprint
      microPkaEvidenceChecks = parsed.checks
      microPkaEvidenceTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomMicroPkaEvidenceInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresMicroPkaEvidence) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical microPkaEvidence output artifact',
    )
  }
  let microstateTransitionGraph: ZatomMicrostateTransitionGraph | undefined
  let microstateTransitionGraphFingerprint: string | undefined
  let microstateTransitionGraphChecks: ValidationCheck[] = []
  let microstateTransitionGraphTargets: InspectionTarget[] = []
  const requiresMicrostateTransitionGraph = options.capability.outputArtifacts?.includes(
    'microstate-transition-graph',
  ) ?? false
  if (options.output.microstateTransitionGraph !== undefined) {
    if (!requiresMicrostateTransitionGraph) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned microstateTransitionGraph for a capability that did not declare that output artifact',
      )
    }
    if (!chemicalStateEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider microstateTransitionGraph requires the same result to include a canonical chemicalStateEnsemble',
      )
    }
    try {
      const parsed = parseZatomMicrostateTransitionGraph(options.output.microstateTransitionGraph, {
        structure,
        chemicalStateEnsemble,
      })
      microstateTransitionGraph = parsed.graph
      microstateTransitionGraphFingerprint = parsed.fingerprint
      microstateTransitionGraphChecks = parsed.checks
      microstateTransitionGraphTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomMicrostateTransitionGraphInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresMicrostateTransitionGraph) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical microstateTransitionGraph output artifact',
    )
  }
  let microstateEquilibriumPotentialEnsemble: ZatomMicrostateEquilibriumPotentialEnsemble | undefined
  let microstateEquilibriumPotentialEnsembleValidation:
    ZatomMicrostateEquilibriumPotentialEnsembleValidation | undefined
  let microstateEquilibriumPotentialEnsembleFingerprint: string | undefined
  let microstateEquilibriumPotentialEnsembleChecks: ValidationCheck[] = []
  const requiresMicrostateEquilibriumPotentialEnsemble = options.capability.outputArtifacts?.includes(
    'microstate-equilibrium-potential-ensemble',
  ) ?? false
  if (options.output.microstateEquilibriumPotentialEnsemble !== undefined) {
    if (!requiresMicrostateEquilibriumPotentialEnsemble) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned microstateEquilibriumPotentialEnsemble for an undeclared output artifact',
      )
    }
    if (!chemicalStateEnsemble || !chemicalStateEnsembleFingerprint
      || !microstateTransitionGraph || !microstateTransitionGraphFingerprint) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider microstateEquilibriumPotentialEnsemble requires canonical ensemble and graph artifacts in the same result',
      )
    }
    try {
      const parsed = parseZatomMicrostateEquilibriumPotentialEnsemble(
        options.output.microstateEquilibriumPotentialEnsemble,
        {
          chemicalStateEnsembleFingerprint,
          microstateTransitionGraphFingerprint,
          canonicalStateIds: microstateTransitionGraph.states.map((state) => state.stateId),
          referenceStateId: microstateTransitionGraph.states[0].stateId,
        },
      )
      microstateEquilibriumPotentialEnsembleValidation = parsed
      microstateEquilibriumPotentialEnsemble = parsed.ensemble
      microstateEquilibriumPotentialEnsembleFingerprint = parsed.fingerprint
      microstateEquilibriumPotentialEnsembleChecks = parsed.checks
    } catch (error) {
      if (error instanceof ZatomMicrostateEquilibriumPotentialEnsembleInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresMicrostateEquilibriumPotentialEnsemble) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical microstateEquilibriumPotentialEnsemble output artifact',
    )
  }
  let microstatePotentialSampleDiagnostics: ZatomMicrostatePotentialSampleDiagnostics | undefined
  let microstatePotentialSampleDiagnosticsFingerprint: string | undefined
  let microstatePotentialSampleDiagnosticsChecks: ValidationCheck[] = []
  const requiresMicrostatePotentialSampleDiagnostics = options.capability.outputArtifacts?.includes(
    'microstate-potential-sample-diagnostics',
  ) ?? false
  if (options.output.microstatePotentialSampleDiagnostics !== undefined) {
    if (!requiresMicrostatePotentialSampleDiagnostics) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned microstatePotentialSampleDiagnostics for an undeclared output artifact',
      )
    }
    if (!microstateEquilibriumPotentialEnsembleValidation) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider microstatePotentialSampleDiagnostics requires canonical ensemble, graph, and potential-ensemble artifacts in the same result',
      )
    }
    try {
      const parsed = parseZatomMicrostatePotentialSampleDiagnostics(
        options.output.microstatePotentialSampleDiagnostics,
        { potentialEnsembleValidation: microstateEquilibriumPotentialEnsembleValidation },
      )
      microstatePotentialSampleDiagnostics = parsed.diagnostics
      microstatePotentialSampleDiagnosticsFingerprint = parsed.fingerprint
      microstatePotentialSampleDiagnosticsChecks = parsed.checks
    } catch (error) {
      if (error instanceof ZatomMicrostatePotentialSampleDiagnosticsInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresMicrostatePotentialSampleDiagnostics) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical microstatePotentialSampleDiagnostics output artifact',
    )
  }
  let microstateStateCoverage: ZatomMicrostateStateCoverage | undefined
  let microstateStateCoverageFingerprint: string | undefined
  let microstateStateCoverageChecks: ValidationCheck[] = []
  const requiresMicrostateStateCoverage = options.capability.outputArtifacts?.includes(
    'microstate-state-coverage',
  ) ?? false
  if (options.output.microstateStateCoverage !== undefined) {
    if (!requiresMicrostateStateCoverage) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned microstateStateCoverage for a capability that did not declare that output artifact',
      )
    }
    if (!chemicalStateEnsemble || !chemicalStateEnsembleFingerprint
      || !microstateTransitionGraph || !microstateTransitionGraphFingerprint) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider microstateStateCoverage requires the same result to include canonical ensemble and graph artifacts',
      )
    }
    try {
      const parsed = parseZatomMicrostateStateCoverage(options.output.microstateStateCoverage, {
        chemicalStateEnsembleFingerprint,
        microstateTransitionGraphFingerprint,
        stateEnumerationComplete: chemicalStateEnsemble.enumeration.complete,
        returnedStateCount: microstateTransitionGraph.states.length,
      })
      microstateStateCoverage = parsed.coverage
      microstateStateCoverageFingerprint = parsed.fingerprint
      microstateStateCoverageChecks = parsed.checks
    } catch (error) {
      if (error instanceof ZatomMicrostateStateCoverageInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresMicrostateStateCoverage) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical microstateStateCoverage output artifact',
    )
  }
  let sqsQualityEvidence: ZatomSqsQualityEvidence | undefined
  let sqsQualityEvidenceFingerprint: string | undefined
  let sqsQualityEvidenceChecks: ValidationCheck[] = []
  let sqsQualityEvidenceTargets: InspectionTarget[] = []
  const requiresSqsQualityEvidence = options.capability.outputArtifacts?.includes('sqs-quality-evidence') ?? false
  if (options.output.sqsQualityEvidence !== undefined) {
    if (!requiresSqsQualityEvidence) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned sqsQualityEvidence for an undeclared output artifact',
      )
    }
    if (!options.request.source) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider sqsQualityEvidence requires the exact source structure',
      )
    }
    try {
      const parsed = parseZatomSqsQualityEvidence(options.output.sqsQualityEvidence, {
        sourceStructure: options.request.source,
        resultStructure: structure,
      })
      sqsQualityEvidence = parsed.evidence
      sqsQualityEvidenceFingerprint = parsed.fingerprint
      sqsQualityEvidenceChecks = parsed.checks
      sqsQualityEvidenceTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomSqsQualityEvidenceInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresSqsQualityEvidence) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical sqsQualityEvidence output artifact',
    )
  }
  let continuumDislocationEvidence: ZatomContinuumDislocationEvidence | undefined
  let continuumDislocationEvidenceFingerprint: string | undefined
  let continuumDislocationEvidenceChecks: ValidationCheck[] = []
  let continuumDislocationEvidenceTargets: InspectionTarget[] = []
  const requiresContinuumDislocationEvidence = options.capability.outputArtifacts?.includes(
    'continuum-dislocation-evidence',
  ) ?? false
  if (options.output.continuumDislocationEvidence !== undefined) {
    if (!requiresContinuumDislocationEvidence) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned continuumDislocationEvidence for an undeclared output artifact',
      )
    }
    if (!options.request.source) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider continuumDislocationEvidence requires the exact source structure',
      )
    }
    try {
      const parsed = parseZatomContinuumDislocationEvidence(options.output.continuumDislocationEvidence, {
        sourceStructure: options.request.source,
        resultStructure: structure,
      })
      continuumDislocationEvidence = parsed.evidence
      continuumDislocationEvidenceFingerprint = parsed.fingerprint
      continuumDislocationEvidenceChecks = parsed.checks
      continuumDislocationEvidenceTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomContinuumDislocationEvidenceInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresContinuumDislocationEvidence) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical continuumDislocationEvidence output artifact',
    )
  }
  let periodicDislocationDipoleEvidence: ZatomPeriodicDislocationDipoleEvidence | undefined
  let periodicDislocationDipoleEvidenceFingerprint: string | undefined
  let periodicDislocationDipoleEvidenceChecks: ValidationCheck[] = []
  let periodicDislocationDipoleEvidenceTargets: InspectionTarget[] = []
  const requiresPeriodicDislocationDipoleEvidence = options.capability.outputArtifacts?.includes(
    'periodic-dislocation-dipole-evidence',
  ) ?? false
  if (options.output.periodicDislocationDipoleEvidence !== undefined) {
    if (!requiresPeriodicDislocationDipoleEvidence) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned periodicDislocationDipoleEvidence for an undeclared output artifact',
      )
    }
    if (!options.request.source) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider periodicDislocationDipoleEvidence requires the exact source structure',
      )
    }
    try {
      const parsed = parseZatomPeriodicDislocationDipoleEvidence(
        options.output.periodicDislocationDipoleEvidence,
        { sourceStructure: options.request.source, resultStructure: structure },
      )
      periodicDislocationDipoleEvidence = parsed.evidence
      periodicDislocationDipoleEvidenceFingerprint = parsed.fingerprint
      periodicDislocationDipoleEvidenceChecks = parsed.checks
      periodicDislocationDipoleEvidenceTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomPeriodicDislocationDipoleEvidenceInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresPeriodicDislocationDipoleEvidence) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical periodicDislocationDipoleEvidence output artifact',
    )
  }
  let fixedCellRelaxationEvidence: ZatomFixedCellRelaxationEvidence | undefined
  let fixedCellRelaxationEvidenceFingerprint: string | undefined
  let fixedCellRelaxationEvidenceChecks: ValidationCheck[] = []
  let fixedCellRelaxationEvidenceTargets: InspectionTarget[] = []
  const requiresFixedCellRelaxationEvidence = options.capability.outputArtifacts?.includes(
    'fixed-cell-relaxation-evidence',
  ) ?? false
  if (options.output.fixedCellRelaxationEvidence !== undefined) {
    if (!requiresFixedCellRelaxationEvidence) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider returned fixedCellRelaxationEvidence for an undeclared output artifact',
      )
    }
    if (!options.request.source) {
      throw new ZatomProviderError(
        'invalid_provider_result',
        'Provider fixedCellRelaxationEvidence requires the exact source structure',
      )
    }
    try {
      const parsed = parseZatomFixedCellRelaxationEvidence(options.output.fixedCellRelaxationEvidence, {
        sourceStructure: options.request.source,
        resultStructure: structure,
      })
      fixedCellRelaxationEvidence = parsed.evidence
      fixedCellRelaxationEvidenceFingerprint = parsed.fingerprint
      fixedCellRelaxationEvidenceChecks = parsed.checks
      fixedCellRelaxationEvidenceTargets = parsed.inspectionTargets
    } catch (error) {
      if (error instanceof ZatomFixedCellRelaxationEvidenceInputError) {
        throw new ZatomProviderError('invalid_provider_result', error.message)
      }
      throw error
    }
  } else if (requiresFixedCellRelaxationEvidence) {
    throw new ZatomProviderError(
      'invalid_provider_result',
      'Provider capability requires a canonical fixedCellRelaxationEvidence output artifact',
    )
  }
  if (!Array.isArray(options.output.checks)) {
    throw new ZatomProviderError('invalid_provider_result', 'provider output must include checks[]')
  }
  const providerChecks = options.output.checks.map(normalizeCheck)
  const checkIds = new Set(providerChecks.map((check) => check.id))
  if (checkIds.size !== providerChecks.length) {
    throw new ZatomProviderError('invalid_provider_result', 'provider check IDs must be unique')
  }
  const missingRequired = options.capability.requiredCheckIds.filter((id) => !checkIds.has(id))
  const validation = validateStructure(structure)
  const atomIds = new Set(structure.atoms.map((atom) => atom.id))
  const providerTargets = options.output.inspectionTargets === undefined
    ? []
    : Array.isArray(options.output.inspectionTargets)
      ? options.output.inspectionTargets.map((target, index) => normalizeTarget(target, index, atomIds, trajectory?.frames.length ?? null))
      : (() => { throw new ZatomProviderError('invalid_provider_result', 'provider inspectionTargets must be an array') })()
  const targetById = new Map<string, InspectionTarget>()
  for (const target of [
    ...providerTargets,
    ...structureEnsembleTargets,
    ...periodicStructureEnsembleTargets,
    ...forceFieldPackageTargets,
    ...chemicalStateEnsembleTargets,
    ...chemicalStateStructureCatalogTargets,
    ...chemicalStateStructuralDistributionTargets,
    ...microPkaEvidenceTargets,
    ...microstateTransitionGraphTargets,
    ...sqsQualityEvidenceTargets,
    ...continuumDislocationEvidenceTargets,
    ...periodicDislocationDipoleEvidenceTargets,
    ...fixedCellRelaxationEvidenceTargets,
    ...validation.inspectionTargets,
  ]) {
    if (!targetById.has(target.id)) targetById.set(target.id, target)
  }
  const contractChecks: ValidationCheck[] = [
    {
      id: 'provider.result_contract',
      status: 'pass',
      message: `Provider ${options.provider.manifest.id} returned canonical ${ZATOM_STRUCTURE_SCHEMA} coordinates and structured checks`,
    },
    ...(structureEnsemble && structureEnsembleFingerprint ? [{
      id: 'provider.structure_ensemble_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${structureEnsemble.schemaVersion} artifact ${structureEnsembleFingerprint}`,
      metrics: {
        memberCount: structureEnsemble.members.length,
        selectedMemberId: structureEnsemble.selection.selectedMemberId,
        structureEnsembleFingerprint,
      },
    }] : []),
    ...(periodicStructureEnsemble && periodicStructureEnsembleFingerprint ? [{
      id: 'provider.periodic_structure_ensemble_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${periodicStructureEnsemble.schemaVersion} artifact ${periodicStructureEnsembleFingerprint}`,
      metrics: {
        memberCount: periodicStructureEnsemble.members.length,
        selectedMemberId: periodicStructureEnsemble.selection.selectedMemberId,
        periodicStructureEnsembleFingerprint,
      },
    }] : []),
    ...(trajectory ? [{
      id: 'provider.trajectory_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${trajectory.schemaVersion} evidence with ${trajectory.frames.length} frames and ${trajectory.atomIds.length * trajectory.frames.length} atom-frames`,
      metrics: { frameCount: trajectory.frames.length, atomFrameCount: trajectory.atomIds.length * trajectory.frames.length },
    }] : []),
    ...(forceFieldPackage && forceFieldPackageFingerprint ? [{
      id: 'provider.force_field_package_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${forceFieldPackage.schemaVersion} artifact ${forceFieldPackageFingerprint}`,
      metrics: {
        atomCount: forceFieldPackage.atomIds.length,
        packageFingerprint: forceFieldPackageFingerprint,
      },
    }] : []),
    ...(chemicalStateEnsemble && chemicalStateEnsembleFingerprint ? [{
      id: 'provider.chemical_state_ensemble_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${chemicalStateEnsemble.schemaVersion} artifact ${chemicalStateEnsembleFingerprint}`,
      metrics: {
        stateCount: chemicalStateEnsemble.states.length,
        ensembleFingerprint: chemicalStateEnsembleFingerprint,
        selectedStateId: chemicalStateEnsemble.selection.selectedStateId,
      },
    }] : []),
    ...(chemicalStateStructureCatalog && chemicalStateStructureCatalogFingerprint ? [{
      id: 'provider.chemical_state_structure_catalog_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${chemicalStateStructureCatalog.schemaVersion} artifact ${chemicalStateStructureCatalogFingerprint}`,
      metrics: {
        stateCount: chemicalStateStructureCatalog.entries.length,
        mappedHeavyAtomCount: chemicalStateStructureCatalog.heavyAtomIds.length,
        catalogFingerprint: chemicalStateStructureCatalogFingerprint,
        chemicalStateEnsembleFingerprint: chemicalStateStructureCatalog.chemicalStateEnsembleFingerprint,
      },
    }] : []),
    ...(chemicalStateStructuralDistribution && chemicalStateStructuralDistributionFingerprint ? [{
      id: 'provider.chemical_state_structural_distribution_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${chemicalStateStructuralDistribution.schemaVersion} artifact ${chemicalStateStructuralDistributionFingerprint}`,
      metrics: {
        stateCount: chemicalStateStructuralDistribution.stateStructureEnsembles.length,
        distributionFingerprint: chemicalStateStructuralDistributionFingerprint,
        chemicalStateEnsembleFingerprint: chemicalStateStructuralDistribution.chemicalStateEnsembleFingerprint,
      },
    }] : []),
    ...(microPkaEvidence && microPkaEvidenceFingerprint ? [{
      id: 'provider.micro_pka_evidence_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${microPkaEvidence.schemaVersion} artifact ${microPkaEvidenceFingerprint}`,
      metrics: {
        predictionCount: microPkaEvidence.predictions.length,
        evidenceFingerprint: microPkaEvidenceFingerprint,
      },
    }] : []),
    ...(microstateTransitionGraph && microstateTransitionGraphFingerprint ? [{
      id: 'provider.microstate_transition_graph_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${microstateTransitionGraph.schemaVersion} artifact ${microstateTransitionGraphFingerprint}`,
      metrics: {
        stateCount: microstateTransitionGraph.states.length,
        edgeCount: microstateTransitionGraph.edges.length,
        graphFingerprint: microstateTransitionGraphFingerprint,
      },
    }] : []),
    ...(microstateStateCoverage && microstateStateCoverageFingerprint ? [{
      id: 'provider.microstate_state_coverage_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${microstateStateCoverage.schemaVersion} artifact ${microstateStateCoverageFingerprint}`,
      metrics: {
        returnedStateCount: microstateStateCoverage.returnedStateCount,
        coverageFingerprint: microstateStateCoverageFingerprint,
        assessmentKind: microstateStateCoverage.assessment.kind,
      },
    }] : []),
    ...(microstateEquilibriumPotentialEnsemble && microstateEquilibriumPotentialEnsembleFingerprint ? [{
      id: 'provider.microstate_equilibrium_potential_ensemble_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${microstateEquilibriumPotentialEnsemble.schemaVersion} artifact ${microstateEquilibriumPotentialEnsembleFingerprint}`,
      metrics: {
        sampleCount: microstateEquilibriumPotentialEnsemble.samples.length,
        stateCount: microstateEquilibriumPotentialEnsemble.stateIds.length,
        potentialEnsembleFingerprint: microstateEquilibriumPotentialEnsembleFingerprint,
      },
    }] : []),
    ...(microstatePotentialSampleDiagnostics && microstatePotentialSampleDiagnosticsFingerprint ? [{
      id: 'provider.microstate_potential_sample_diagnostics_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${microstatePotentialSampleDiagnostics.schemaVersion} artifact ${microstatePotentialSampleDiagnosticsFingerprint}`,
      metrics: {
        chainCount: microstatePotentialSampleDiagnostics.design.chains.length,
        sampleCount: microstatePotentialSampleDiagnostics.sampleIds.length,
        overallPassed: microstatePotentialSampleDiagnostics.overallPassed,
        sampleDiagnosticsFingerprint: microstatePotentialSampleDiagnosticsFingerprint,
      },
    }] : []),
    ...(sqsQualityEvidence && sqsQualityEvidenceFingerprint ? [{
      id: 'provider.sqs_quality_evidence_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${sqsQualityEvidence.schemaVersion} artifact ${sqsQualityEvidenceFingerprint}`,
      metrics: {
        sublatticeCount: sqsQualityEvidence.occupation.sublattices.length,
        mutableSiteCount: sqsQualityEvidence.occupation.sublattices.reduce(
          (sum, sublattice) => sum + sublattice.atomIds.length,
          0,
        ),
        clusterVectorComponentCount: sqsQualityEvidence.clusterSpace.componentCount,
        maximumOrder: sqsQualityEvidence.clusterSpace.maximumOrder,
        sqsQualityEvidenceFingerprint,
      },
    }] : []),
    ...(continuumDislocationEvidence && continuumDislocationEvidenceFingerprint ? [{
      id: 'provider.continuum_dislocation_evidence_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${continuumDislocationEvidence.schemaVersion} artifact ${continuumDislocationEvidenceFingerprint}`,
      metrics: {
        atomCount: continuumDislocationEvidence.mapping.atomCount,
        character: continuumDislocationEvidence.defect.character,
        burgersMagnitudeA: continuumDislocationEvidence.defect.burgersMagnitudeA,
        minimumPairDistanceA: continuumDislocationEvidence.metrics.minimumPairDistanceA,
        continuumDislocationEvidenceFingerprint,
      },
    }] : []),
    ...(periodicDislocationDipoleEvidence && periodicDislocationDipoleEvidenceFingerprint ? [{
      id: 'provider.periodic_dislocation_dipole_evidence_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${periodicDislocationDipoleEvidence.schemaVersion} artifact ${periodicDislocationDipoleEvidenceFingerprint}`,
      metrics: {
        atomCount: periodicDislocationDipoleEvidence.mapping.atomCount,
        burgersMagnitudeA: periodicDislocationDipoleEvidence.crystallography.burgersMagnitudeA,
        imageReplicaCount: periodicDislocationDipoleEvidence.construction.imageReplicaCount,
        maximumPeriodicSeamResidualA: periodicDislocationDipoleEvidence.metrics.maximumPeriodicSeamResidualA,
        minimumPairDistanceA: periodicDislocationDipoleEvidence.metrics.minimumPairDistanceA,
        periodicDislocationDipoleEvidenceFingerprint,
      },
    }] : []),
    ...(fixedCellRelaxationEvidence && fixedCellRelaxationEvidenceFingerprint ? [{
      id: 'provider.fixed_cell_relaxation_evidence_contract',
      status: 'pass' as const,
      message: `Provider returned canonical ${fixedCellRelaxationEvidence.schemaVersion} artifact ${fixedCellRelaxationEvidenceFingerprint}`,
      metrics: {
        atomCount: fixedCellRelaxationEvidence.mapping.atomCount,
        potentialEnergyChangeEv: fixedCellRelaxationEvidence.metrics.potentialEnergyChangeEv,
        maximumForceEvPerA: fixedCellRelaxationEvidence.metrics.maximumForceEvPerA,
        minimumPairDistanceA: fixedCellRelaxationEvidence.metrics.minimumPairDistanceA,
        fixedCellRelaxationEvidenceFingerprint,
      },
    }] : []),
    ...(options.request.forceFieldPackage ? [{
      id: 'provider.force_field_package_input_contract',
      status: 'pass' as const,
      message: `Broker supplied validated ${options.request.forceFieldPackage.package.schemaVersion} input ${options.request.forceFieldPackage.fingerprint}`,
      metrics: {
        atomCount: options.request.forceFieldPackage.package.atomIds.length,
        packageFingerprint: options.request.forceFieldPackage.fingerprint,
      },
    }] : []),
    ...(options.request.chemicalStateEnsemble ? [{
      id: 'provider.chemical_state_ensemble_input_contract',
      status: 'pass' as const,
      message: `Broker supplied validated ${options.request.chemicalStateEnsemble.ensemble.schemaVersion} input ${options.request.chemicalStateEnsemble.fingerprint}`,
      metrics: {
        stateCount: options.request.chemicalStateEnsemble.ensemble.states.length,
        selectedStateId: options.request.chemicalStateEnsemble.ensemble.selection.selectedStateId,
        ensembleFingerprint: options.request.chemicalStateEnsemble.fingerprint,
      },
    }] : []),
    ...(options.request.continuation ? [{
      id: 'provider.continuation_contract',
      status: 'pass' as const,
      message: `Broker supplied final frame ${options.request.continuation.frameIndex} as fingerprint-bound canonical continuation state`,
      metrics: {
        sourceTrajectoryFingerprint: options.request.continuation.sourceTrajectoryFingerprint,
        sourceFrameCount: options.request.continuation.sourceFrameCount,
        sourceFrameIndex: options.request.continuation.frameIndex,
        sourceStep: options.request.continuation.frame.step,
        sourceTimePs: options.request.continuation.frame.timePs,
      },
    }] : options.capability.continuation && options.capability.continuation.mode !== 'none' ? [{
      id: 'provider.continuation_contract',
      status: 'skipped' as const,
      message: 'Capability supports continuation, but this execution started from structure coordinates without trajectory state',
    }] : []),
    ...(missingRequired.length ? [{
      id: 'provider.required_domain_checks',
      status: 'fail' as const,
      message: `Provider omitted required domain checks: ${missingRequired.join(', ')}`,
    }] : [{
      id: 'provider.required_domain_checks',
      status: 'pass' as const,
      message: `Provider returned all ${options.capability.requiredCheckIds.length} required domain checks`,
      metrics: { requiredCheckCount: options.capability.requiredCheckIds.length },
    }]),
  ]
  const emptySource: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const source = options.request.source ?? emptySource
  const conciseParameters = jsonCloneRecord(options.output.provenanceParameters, 'provider provenanceParameters') ?? {}
  const details = jsonCloneRecord(options.output.details, 'provider details')
  const provenance: StructureProvenance = {
    engine: options.provider.manifest.engine.name,
    engineVersion: options.provider.manifest.engine.version,
    sourceFingerprint: fingerprintStructure(source),
    ...(options.request.continuation ? {
      sourceTrajectoryFingerprint: options.request.continuation.sourceTrajectoryFingerprint,
      sourceTrajectoryFrameIndex: options.request.continuation.frameIndex,
    } : {}),
    resultFingerprint: fingerprintStructure(structure),
    ...(trajectory ? { trajectoryFingerprint: fingerprintTrajectory(trajectory) } : {}),
    ...(structureEnsembleFingerprint ? { structureEnsembleFingerprint } : {}),
    ...(periodicStructureEnsembleFingerprint ? { periodicStructureEnsembleFingerprint } : {}),
    ...(options.request.forceFieldPackage ? {
      inputForceFieldPackageFingerprint: options.request.forceFieldPackage.fingerprint,
    } : {}),
    ...(options.request.chemicalStateEnsemble ? {
      inputChemicalStateEnsembleFingerprint: options.request.chemicalStateEnsemble.fingerprint,
    } : {}),
    ...(forceFieldPackageFingerprint ? { forceFieldPackageFingerprint } : {}),
    ...(chemicalStateEnsembleFingerprint ? { chemicalStateEnsembleFingerprint } : {}),
    ...(chemicalStateStructureCatalogFingerprint ? {
      chemicalStateStructureCatalogFingerprint,
    } : {}),
    ...(chemicalStateStructuralDistributionFingerprint ? {
      chemicalStateStructuralDistributionFingerprint,
    } : {}),
    ...(microPkaEvidenceFingerprint ? { microPkaEvidenceFingerprint } : {}),
    ...(microstateTransitionGraphFingerprint ? { microstateTransitionGraphFingerprint } : {}),
    ...(microstateStateCoverageFingerprint ? { microstateStateCoverageFingerprint } : {}),
    ...(microstateEquilibriumPotentialEnsembleFingerprint ? {
      microstateEquilibriumPotentialEnsembleFingerprint,
    } : {}),
    ...(microstatePotentialSampleDiagnosticsFingerprint ? {
      microstatePotentialSampleDiagnosticsFingerprint,
    } : {}),
    ...(sqsQualityEvidenceFingerprint ? { sqsQualityEvidenceFingerprint } : {}),
    ...(continuumDislocationEvidenceFingerprint ? { continuumDislocationEvidenceFingerprint } : {}),
    ...(periodicDislocationDipoleEvidenceFingerprint ? { periodicDislocationDipoleEvidenceFingerprint } : {}),
    ...(fixedCellRelaxationEvidenceFingerprint ? { fixedCellRelaxationEvidenceFingerprint } : {}),
    seed: options.request.seed,
    parameters: {
      providerId: options.provider.manifest.id,
      capability: options.capability.id,
      adapterVersion: options.provider.manifest.adapterVersion,
      ...conciseParameters,
    },
  }
  return {
    structure,
    ...(trajectory ? { trajectory } : {}),
    ...(structureEnsemble ? { structureEnsemble } : {}),
    ...(periodicStructureEnsemble ? { periodicStructureEnsemble } : {}),
    ...(forceFieldPackage ? { forceFieldPackage } : {}),
    ...(chemicalStateEnsemble ? { chemicalStateEnsemble } : {}),
    ...(chemicalStateStructureCatalog ? { chemicalStateStructureCatalog } : {}),
    ...(chemicalStateStructuralDistribution ? { chemicalStateStructuralDistribution } : {}),
    ...(microPkaEvidence ? { microPkaEvidence } : {}),
    ...(microstateTransitionGraph ? { microstateTransitionGraph } : {}),
    ...(microstateStateCoverage ? { microstateStateCoverage } : {}),
    ...(microstateEquilibriumPotentialEnsemble ? { microstateEquilibriumPotentialEnsemble } : {}),
    ...(microstatePotentialSampleDiagnostics ? { microstatePotentialSampleDiagnostics } : {}),
    ...(sqsQualityEvidence ? { sqsQualityEvidence } : {}),
    ...(continuumDislocationEvidence ? { continuumDislocationEvidence } : {}),
    ...(periodicDislocationDipoleEvidence ? { periodicDislocationDipoleEvidence } : {}),
    ...(fixedCellRelaxationEvidence ? { fixedCellRelaxationEvidence } : {}),
    checks: [
      ...contractChecks,
      ...providerChecks,
      ...structureEnsembleChecks,
      ...periodicStructureEnsembleChecks,
      ...forceFieldPackageChecks,
      ...chemicalStateEnsembleChecks,
      ...chemicalStateStructureCatalogChecks,
      ...chemicalStateStructuralDistributionChecks,
      ...microPkaEvidenceChecks,
      ...microstateTransitionGraphChecks,
      ...microstateStateCoverageChecks,
      ...microstateEquilibriumPotentialEnsembleChecks,
      ...microstatePotentialSampleDiagnosticsChecks,
      ...sqsQualityEvidenceChecks,
      ...continuumDislocationEvidenceChecks,
      ...periodicDislocationDipoleEvidenceChecks,
      ...fixedCellRelaxationEvidenceChecks,
      ...validation.checks,
    ],
    inspectionTargets: [...targetById.values()],
    changeSet: buildStructureChangeSet(source, structure),
    provenance,
    provider: {
      id: options.provider.manifest.id,
      title: options.provider.manifest.title,
      adapterVersion: options.provider.manifest.adapterVersion,
      engine: { ...options.provider.manifest.engine },
      capability: options.capability.id,
      fidelity: options.capability.fidelity,
      execution: options.provider.manifest.execution,
    },
    ...(details ? { details } : {}),
  }
}

export interface ZatomProviderRegistry {
  list(): ZatomProviderManifest[]
  get(id: string): ZatomModelingProvider | undefined
  register(provider: ZatomModelingProvider, options?: { replace?: boolean }): () => void
  execute(
    providerId: string,
    request: ZatomProviderExecutionRequest,
    context?: ZatomToolContext,
  ): Promise<{ provider: ZatomModelingProvider; capability: ZatomProviderCapability; output: ZatomProviderOutput }>
}

interface RegisteredProvider {
  provider: ZatomModelingProvider
  parameterValidators: Map<string, ZatomJsonSchemaValidator>
}

function validateProviderInputArtifacts(
  capability: ZatomProviderCapability,
  request: ZatomProviderExecutionRequest,
): void {
  const contractByArtifact = new Map(
    (capability.inputArtifacts ?? []).map((contract) => [contract.artifact, contract]),
  )
  const supplied = new Map<ZatomProviderInputArtifact, unknown>([
    ['force-field-package', request.forceFieldPackage],
    ['chemical-state-ensemble', request.chemicalStateEnsemble],
  ])
  for (const [artifact, value] of supplied) {
    const contract = contractByArtifact.get(artifact)
    if (value && !contract) {
      throw new ZatomProviderError(
        'provider_input_artifact_not_allowed',
        `Capability ${capability.id} does not accept ${artifact} input`,
      )
    }
    if (!value && contract?.mode === 'required') {
      throw new ZatomProviderError(
        'provider_input_artifact_required',
        `Capability ${capability.id} requires ${artifact} input`,
      )
    }
    if (value && !request.source) {
      throw new ZatomProviderError(
        'provider_input_artifact_source_required',
        `A canonical source structure is required to bind ${artifact} input`,
      )
    }
  }
  if (request.forceFieldPackage) {
    if (request.forceFieldPackage.schemaVersion !== 'zatom.provider-force-field-package/v1') {
      throw new ZatomProviderError(
        'provider_input_artifact_mismatch',
        'force-field-package input wrapper has an unsupported schemaVersion',
      )
    }
    try {
      const parsed = parseZatomForceFieldPackage(request.forceFieldPackage.package, {
        structure: request.source!,
        allowCompatibleGeometry: true,
      })
      if (parsed.fingerprint !== request.forceFieldPackage.fingerprint
        || canonicalJsonIdentity(parsed.package)
          !== canonicalJsonIdentity(request.forceFieldPackage.package)) {
        throw new ZatomProviderError(
          'provider_input_artifact_mismatch',
          'force-field-package input wrapper does not contain its exact canonical fingerprint-bound package',
        )
      }
    } catch (error) {
      if (error instanceof ZatomProviderError) throw error
      if (error instanceof ZatomForceFieldPackageInputError) {
        throw new ZatomProviderError('provider_input_artifact_mismatch', error.message)
      }
      throw error
    }
  }
  if (request.chemicalStateEnsemble) {
    if (request.chemicalStateEnsemble.schemaVersion !== 'zatom.provider-chemical-state-ensemble/v1') {
      throw new ZatomProviderError(
        'provider_input_artifact_mismatch',
        'chemical-state-ensemble input wrapper has an unsupported schemaVersion',
      )
    }
    try {
      const parsed = parseZatomChemicalStateEnsemble(request.chemicalStateEnsemble.ensemble, {
        structure: request.source!,
      })
      if (parsed.fingerprint !== request.chemicalStateEnsemble.fingerprint
        || canonicalJsonIdentity(parsed.ensemble)
          !== canonicalJsonIdentity(request.chemicalStateEnsemble.ensemble)) {
        throw new ZatomProviderError(
          'provider_input_artifact_mismatch',
          'chemical-state-ensemble input wrapper does not contain its exact canonical fingerprint-bound ensemble',
        )
      }
    } catch (error) {
      if (error instanceof ZatomProviderError) throw error
      if (error instanceof ZatomChemicalStateEnsembleInputError) {
        throw new ZatomProviderError('provider_input_artifact_mismatch', error.message)
      }
      throw error
    }
  }
}

export function createZatomProviderRegistry(initial: readonly ZatomModelingProvider[] = []): ZatomProviderRegistry {
  const providers = new Map<string, RegisteredProvider>()
  const register = (provider: ZatomModelingProvider, options: { replace?: boolean } = {}): (() => void) => {
    validateManifest(provider.manifest)
    const id = provider.manifest.id
    if (providers.has(id) && !options.replace) throw new ZatomProviderError('provider_collision', `Provider ${id} is already registered`)
    const parameterValidators = new Map<string, ZatomJsonSchemaValidator>()
    try {
      for (const capability of provider.manifest.capabilities) {
        parameterValidators.set(capability.id, compileZatomJsonSchema(capability.inputSchema))
      }
    } catch (error) {
      throw new ZatomProviderError(
        'invalid_provider_manifest',
        `Provider ${id} contains an invalid capability inputSchema: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const previous = providers.get(id)
    const registration = { provider, parameterValidators }
    providers.set(id, registration)
    return () => {
      if (providers.get(id) !== registration) return
      if (previous) providers.set(id, previous)
      else providers.delete(id)
    }
  }
  for (const provider of initial) register(provider)
  return {
    list: () => [...providers.values()].map(({ provider }) => provider.manifest),
    get: (id) => providers.get(id)?.provider,
    register,
    execute: async (providerId, request, context = {}) => {
      const registration = providers.get(providerId)
      if (!registration) throw new ZatomProviderError('unknown_provider', `Unknown modeling provider ${providerId}`)
      const { provider } = registration
      const capability = provider.manifest.capabilities.find((item) => item.id === request.capability)
      if (!capability) throw new ZatomProviderError('unsupported_capability', `Provider ${providerId} does not implement ${request.capability}`)
      const validateParameters = registration.parameterValidators.get(capability.id)!
      const parameterValidation = validateParameters(request.parameters)
      if (!parameterValidation.valid) {
        throw new ZatomProviderError(
          'invalid_provider_parameters',
          `Parameters for ${providerId}/${capability.id} do not match its inputSchema: ${formatZatomJsonSchemaErrors(parameterValidation.errors)}`,
        )
      }
      if (capability.source === 'required' && !request.source) {
        throw new ZatomProviderError('source_required', `Capability ${capability.id} requires a source structure`)
      }
      if (capability.source === 'none' && request.source) {
        throw new ZatomProviderError('source_not_allowed', `Capability ${capability.id} creates from parameters and does not accept a source structure`)
      }
      const continuationMode = capability.continuation?.mode ?? 'none'
      if (continuationMode === 'required' && !request.continuation) {
        throw new ZatomProviderError('continuation_required', `Capability ${capability.id} requires canonical trajectory continuation state`)
      }
      if (continuationMode === 'none' && request.continuation) {
        throw new ZatomProviderError('continuation_not_allowed', `Capability ${capability.id} does not accept trajectory continuation state`)
      }
      if (request.continuation && !request.source) {
        throw new ZatomProviderError('continuation_source_required', 'Trajectory continuation state must be bound to a source structure')
      }
      validateProviderInputArtifacts(capability, request)
      const output = await provider.execute(request, context)
      return { provider, capability, output }
    },
  }
}
