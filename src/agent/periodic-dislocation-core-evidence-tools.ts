/** MCP compose/replay tools for periodic screw-dipole core localization evidence. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  composeZatomPeriodicDislocationCoreEvidence,
  parseZatomPeriodicDislocationCoreEvidence,
  type ParseZatomPeriodicDislocationCoreEvidenceOptions,
  type ZatomPeriodicDislocationCoreEvidenceValidation,
  ZatomPeriodicDislocationCoreEvidenceInputError,
  ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA,
} from './periodic-dislocation-core-evidence'
import {
  fingerprintPeriodicDislocationDipoleEvidence,
  type ZatomPeriodicDislocationDipoleEvidence,
} from './periodic-dislocation-dipole-evidence'
import {
  fingerprintFixedCellRelaxationEvidence,
  type ZatomFixedCellRelaxationEvidence,
} from './fixed-cell-relaxation-evidence'
import {
  fingerprintPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidence,
} from './periodic-dislocation-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const COMPOSE_TOOL = 'periodic_dislocation_compose_core_evidence'
const VALIDATE_TOOL = 'periodic_dislocation_validate_core_evidence'

function finiteOption(input: Record<string, unknown>, field: string, fallback: number, minimum = 0, maximum = 1e12): number {
  const value = input[field] === undefined ? fallback : Number(input[field])
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'invalid_periodic_dislocation_core_acceptance',
      `${field} must be finite in [${minimum}, ${maximum}]`,
    )
  }
  return value
}

function integerOption(input: Record<string, unknown>, field: string, fallback: number, minimum = 0): number {
  const value = input[field] === undefined ? fallback : Number(input[field])
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new ZatomPeriodicDislocationCoreEvidenceInputError(
      'invalid_periodic_dislocation_core_acceptance',
      `${field} must be a safe integer of at least ${minimum}`,
    )
  }
  return value
}

function inputSchema(includeEvidence: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      ...(includeEvidence ? ['evidence'] : []),
      'sourceStructure', 'seedStructure', 'relaxedDefectStructure', 'relaxedReferenceStructure',
      'seedEvidence', 'defectRelaxationEvidence', 'referenceRelaxationEvidence', 'relaxationEvidence',
    ],
    properties: {
      ...(includeEvidence ? {
        evidence: {
          type: 'object',
          properties: { schemaVersion: { const: ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA } },
        },
      } : {
        neighborCutoffA: { type: 'number', exclusiveMinimum: 0, description: 'Complete relaxed-reference neighbor cutoff in Å; defaults to 1.25|b|.' },
        signalRadiusA: { type: 'number', exclusiveMinimum: 0, description: 'Radius around each topological center used only for descriptive DD signal moments; defaults to 2|b|.' },
        columnToleranceFractional: { type: 'number', minimum: 1e-12, maximum: 0.1, default: 1e-7 },
        minimumColumnPhaseConcentration: { type: 'number', minimum: 0, maximum: 1, default: 0.95 },
        minimumPhaseBranchMarginRad: { type: 'number', minimum: 0, maximum: Math.PI, default: 1e-8 },
        maximumWindingResidual: { type: 'number', minimum: 0, maximum: 0.5, default: 1e-8 },
        maximumCoreShiftA: { type: 'number', minimum: 0, description: 'Maximum topological-center shift from the corresponding Atomman seed core; defaults to 2|b|.' },
        maximumLocalizationResolutionA: { type: 'number', minimum: 0, description: 'Maximum charged-triangle vertex radius; defaults to 2|b|.' },
        minimumNeighborCount: { type: 'integer', minimum: 0, default: 1 },
        minimumCoreDifferentialDisplacementSignalA: { type: 'number', minimum: 0, description: 'Minimum sum of absolute wrapped Burgers-axis DD signal per core; defaults to 0.01|b|.' },
        maximumSignalCenterShiftA: { type: 'number', minimum: 0, description: 'Maximum descriptive DD-signal center shift from the topological center; defaults to 2|b|.' },
        maximumSignalRmsRadiusA: { type: 'number', minimum: 0, description: 'Maximum descriptive DD-signal RMS radius; defaults to 3|b|.' },
      }),
      sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedDefectStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedReferenceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedEvidence: { type: 'object' },
      defectRelaxationEvidence: { type: 'object' },
      referenceRelaxationEvidence: { type: 'object' },
      relaxationEvidence: { type: 'object' },
      maxAtoms: { type: 'integer', minimum: 3, maximum: 100000, default: 2000 },
      maxPairCandidates: { type: 'integer', minimum: 3, maximum: 1000000000, default: 2000000 },
      maxMinimumImageCandidateEvaluations: { type: 'integer', minimum: 1, maximum: 1000000000, default: 100000000 },
      maxColumns: { type: 'integer', minimum: 3, maximum: 1000000, default: 10000 },
      maxTriangles: { type: 'integer', minimum: 1, maximum: 3000000, default: 30000 },
      maxBonds: { type: 'integer', minimum: 1, maximum: 10000000, default: 100000 },
      maxMetadataBytes: { type: 'integer', minimum: 1, maximum: 67108864, default: 2097152 },
      maxArtifactBytes: { type: 'integer', minimum: 1, maximum: 1073741824, default: 67108864 },
    },
  }
}

function parseInputs(input: Record<string, unknown>): ParseZatomPeriodicDislocationCoreEvidenceOptions {
  return {
    sourceStructure: parseZatomStructure(input.sourceStructure),
    seedStructure: parseZatomStructure(input.seedStructure),
    relaxedDefectStructure: parseZatomStructure(input.relaxedDefectStructure),
    relaxedReferenceStructure: parseZatomStructure(input.relaxedReferenceStructure),
    seedEvidence: input.seedEvidence as ZatomPeriodicDislocationDipoleEvidence,
    defectRelaxationEvidence: input.defectRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
    referenceRelaxationEvidence: input.referenceRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
    relaxationEvidence: input.relaxationEvidence as ZatomPeriodicDislocationRelaxationEvidence,
    ...(input.maxAtoms === undefined ? {} : { maxAtoms: integerOption(input, 'maxAtoms', 2000, 3) }),
    ...(input.maxPairCandidates === undefined ? {} : { maxPairCandidates: integerOption(input, 'maxPairCandidates', 2_000_000, 3) }),
    ...(input.maxMinimumImageCandidateEvaluations === undefined ? {} : {
      maxMinimumImageCandidateEvaluations: integerOption(input, 'maxMinimumImageCandidateEvaluations', 100_000_000, 1),
    }),
    ...(input.maxColumns === undefined ? {} : { maxColumns: integerOption(input, 'maxColumns', 10_000, 3) }),
    ...(input.maxTriangles === undefined ? {} : { maxTriangles: integerOption(input, 'maxTriangles', 30_000, 1) }),
    ...(input.maxBonds === undefined ? {} : { maxBonds: integerOption(input, 'maxBonds', 100_000, 1) }),
    ...(input.maxMetadataBytes === undefined ? {} : { maxMetadataBytes: integerOption(input, 'maxMetadataBytes', 2 * 1024 * 1024, 1) }),
    ...(input.maxArtifactBytes === undefined ? {} : { maxArtifactBytes: integerOption(input, 'maxArtifactBytes', 64 * 1024 * 1024, 1) }),
  }
}

function composeParameters(input: Record<string, unknown>, context: ParseZatomPeriodicDislocationCoreEvidenceOptions) {
  const burgersMagnitudeA = context.seedEvidence.crystallography.burgersMagnitudeA
  const settings = {
    neighborCutoffA: finiteOption(input, 'neighborCutoffA', 1.25 * burgersMagnitudeA, 1e-8),
    signalRadiusA: finiteOption(input, 'signalRadiusA', 2 * burgersMagnitudeA, 1e-8),
    columnToleranceFractional: finiteOption(input, 'columnToleranceFractional', 1e-7, 1e-12, 0.1),
  }
  const acceptance = {
    minimumColumnPhaseConcentration: finiteOption(input, 'minimumColumnPhaseConcentration', 0.95, 0, 1),
    minimumPhaseBranchMarginRad: finiteOption(input, 'minimumPhaseBranchMarginRad', 1e-8, 0, Math.PI),
    maximumWindingResidual: finiteOption(input, 'maximumWindingResidual', 1e-8, 0, 0.5),
    maximumCoreShiftA: finiteOption(input, 'maximumCoreShiftA', 2 * burgersMagnitudeA),
    maximumLocalizationResolutionA: finiteOption(input, 'maximumLocalizationResolutionA', 2 * burgersMagnitudeA),
    minimumNeighborCount: integerOption(input, 'minimumNeighborCount', 1),
    minimumCoreDifferentialDisplacementSignalA: finiteOption(input, 'minimumCoreDifferentialDisplacementSignalA', 0.01 * burgersMagnitudeA),
    maximumSignalCenterShiftA: finiteOption(input, 'maximumSignalCenterShiftA', 2 * burgersMagnitudeA),
    maximumSignalRmsRadiusA: finiteOption(input, 'maximumSignalRmsRadiusA', 3 * burgersMagnitudeA),
  }
  return { settings, acceptance }
}

const composeCoreEvidenceTool: ZatomToolDefinition<ZatomPeriodicDislocationCoreEvidenceValidation> = {
  manifest: {
    name: COMPOSE_TOOL,
    title: 'Compose periodic screw-dipole core evidence',
    version: '1.0.0',
    description: `Compose ${ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA} only after replaying an exact Atomman periodic screw-dipole seed, both canonical fixed-cell relaxations, and their matched relaxation evidence. Rebind relaxed atoms to source-nearest periodic images, collapse straight line columns, compute a periodic Delaunay phase winding about the positive Burgers axis, require localized +1/-1 charge, and scan every distinct atom pair to build a one-nearest-image reference differential-displacement map with explicit cutoff/radius-dependent signal moments and visual targets. V1 excludes self-image/multiple-image bonds and is not an edge/partial/kink/Nye-tensor or Peierls analysis.`,
    inputSchema: inputSchema(false),
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['dislocation', 'periodic-dipole', 'screw-core', 'phase-winding', 'differential-displacement', 'localization', 'visual-validation'],
  },
  execute: async (input) => {
    try {
      const context = parseInputs(input)
      const { settings, acceptance } = composeParameters(input, context)
      const artifacts = [
        {
          id: 'periodic-dislocation-seed-evidence',
          role: 'accepted Atomman periodic screw-dipole seed evidence',
          fingerprint: fingerprintPeriodicDislocationDipoleEvidence(context.seedEvidence),
        },
        {
          id: 'defect-fixed-cell-relaxation-evidence',
          role: 'canonical relaxed-defect evidence',
          fingerprint: fingerprintFixedCellRelaxationEvidence(context.defectRelaxationEvidence),
        },
        {
          id: 'reference-fixed-cell-relaxation-evidence',
          role: 'canonical relaxed-reference evidence',
          fingerprint: fingerprintFixedCellRelaxationEvidence(context.referenceRelaxationEvidence),
        },
        {
          id: 'periodic-dislocation-relaxation-evidence',
          role: 'matched finite-cell defect/reference relaxation evidence',
          fingerprint: fingerprintPeriodicDislocationRelaxationEvidence(context.relaxationEvidence),
        },
      ]
      const validation = composeZatomPeriodicDislocationCoreEvidence({
        ...context,
        settings,
        acceptance,
        provenance: {
          method: 'Source-anchored ordered screw phase, periodic 3x3 Delaunay winding, and reference-neighbor differential-displacement localization',
          artifacts,
          parameters: { ...settings, ...acceptance },
          citations: [
            'https://www.ctcms.nist.gov/potentials/atomman/atomman.defect.DifferentialDisplacement.html',
            'https://www.ctcms.nist.gov/potentials/atomman/tutorial/4.10_Differential_Displacement_Maps.html',
            'https://www.ctcms.nist.gov/potentials/atomman/tutorial/4.6._Dislocation_analysis_tools.html',
          ],
          scopeWarning: 'Discrete topological and differential-displacement evidence for one relaxed, fully periodic, straight screw-dipole pair with exact ordered atom mapping.',
        },
      }, context).evidence
      const replay = parseZatomPeriodicDislocationCoreEvidence(validation, context)
      return {
        ok: true,
        tool: COMPOSE_TOOL,
        summary: `Composed ${replay.fingerprint}: winding ${replay.evidence.cores[0].observedWindingCharge}/${replay.evidence.cores[1].observedWindingCharge}, core shifts ${replay.evidence.cores[0].topologicalShiftFromSeedA.toPrecision(6)}/${replay.evidence.cores[1].topologicalShiftFromSeedA.toPrecision(6)} Å`,
        data: replay,
        checks: replay.checks,
      }
    } catch (error) {
      return toolError(COMPOSE_TOOL, error)
    }
  },
}

const validateCoreEvidenceTool: ZatomToolDefinition<ZatomPeriodicDislocationCoreEvidenceValidation> = {
  manifest: {
    name: VALIDATE_TOOL,
    title: 'Validate periodic screw-dipole core evidence',
    version: '1.0.0',
    description: `Replay ${ZATOM_PERIODIC_DISLOCATION_CORE_EVIDENCE_SCHEMA} against the exact source, seed, relaxed defect/reference structures and all four upstream artifacts. Recompute source-image binding, line columns, periodic Delaunay winding, core assignment, the complete distinct-pair nearest-image DD scan, signal moments, gates, fingerprints, and visual targets.`,
    inputSchema: inputSchema(true),
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['dislocation', 'periodic-dipole', 'screw-core', 'quality-evidence', 'validation', 'visual-validation'],
  },
  execute: async (input) => {
    try {
      const validation = parseZatomPeriodicDislocationCoreEvidence(input.evidence, parseInputs(input))
      return {
        ok: true,
        tool: VALIDATE_TOOL,
        summary: `Validated ${validation.fingerprint}: winding ${validation.evidence.cores[0].observedWindingCharge}/${validation.evidence.cores[1].observedWindingCharge}, max wrapped DD ${validation.evidence.metrics.maximumAbsoluteWrappedBurgersAxisDifferentialA.toPrecision(6)} Å`,
        data: validation,
        checks: validation.checks,
      }
    } catch (error) {
      return toolError(VALIDATE_TOOL, error)
    }
  },
}

export const PERIODIC_DISLOCATION_CORE_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [composeCoreEvidenceTool, validateCoreEvidenceTool]
