/** MCP workflow for matched periodic-dislocation defect/reference relaxation evidence. */

import type { ZatomToolDefinition, ZatomStructure } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate } from './candidate-tool'
import {
  buildBalancedPeriodicDislocationReference,
  composeZatomPeriodicDislocationRelaxationEvidence,
  parseZatomPeriodicDislocationRelaxationEvidence,
  type ZatomPeriodicDislocationRelaxationEvidenceValidation,
  ZatomPeriodicDislocationRelaxationEvidenceInputError,
  ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA,
} from './periodic-dislocation-relaxation-evidence'
import {
  fingerprintPeriodicDislocationDipoleEvidence,
  parseZatomPeriodicDislocationDipoleEvidence,
  type ZatomPeriodicDislocationDipoleEvidence,
} from './periodic-dislocation-dipole-evidence'
import {
  fingerprintFixedCellRelaxationEvidence,
  type ZatomFixedCellRelaxationEvidence,
} from './fixed-cell-relaxation-evidence'
import { boundsOfPositions, fingerprintStructure } from './structure-math'
import { parseZatomStructure, validateStructure, ZatomStructureInputError } from './structure-validation'
import { toolError } from './tool-helpers'

const PREPARE_TOOL = 'periodic_dislocation_prepare_relaxation_reference'
const COMPOSE_TOOL = 'periodic_dislocation_compose_relaxation_evidence'
const VALIDATE_TOOL = 'periodic_dislocation_validate_relaxation_evidence'

async function resolveStructure(
  explicit: unknown,
  context: Parameters<ZatomToolDefinition['execute']>[1],
  useActive: boolean,
  field: string,
): Promise<ZatomStructure> {
  if (explicit !== undefined) return parseZatomStructure(explicit)
  const active = useActive ? await context.readStructure?.() ?? null : null
  if (!active) throw new ZatomStructureInputError('no_active_structure', `${field} is required and the active workspace is empty or disabled`)
  return parseZatomStructure(active)
}

function finiteOption(input: Record<string, unknown>, field: string, fallback: number, minimum = 0): number {
  const value = input[field] === undefined ? fallback : Number(input[field])
  if (!Number.isFinite(value) || value < minimum) {
    throw new ZatomPeriodicDislocationRelaxationEvidenceInputError('invalid_periodic_dislocation_relaxation_acceptance', `${field} must be finite and at least ${minimum}`)
  }
  return value
}

function pairedInputSchema(includeEvidence: boolean): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      ...(includeEvidence ? ['evidence'] : []),
      'sourceStructure', 'seedStructure', 'relaxedDefectStructure', 'relaxedReferenceStructure',
      'seedEvidence', 'defectRelaxationEvidence', 'referenceRelaxationEvidence',
    ],
    properties: {
      ...(includeEvidence ? {
        evidence: {
          type: 'object',
          properties: { schemaVersion: { const: ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA } },
        },
      } : {
        maximumFinalForceEvPerA: { type: 'number', minimum: 0, default: 0.05 },
        maximumReferenceRelaxationDisplacementA: { type: 'number', minimum: 0, default: 1 },
        maximumDefectRelaxationDisplacementA: { type: 'number', minimum: 0, default: 5 },
        maximumDifferentialDisplacementA: { type: 'number', minimum: 0, default: 10 },
        minimumPairDistanceA: { type: 'number', minimum: 0, default: 0.35 },
      }),
      sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedDefectStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      relaxedReferenceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
      seedEvidence: { type: 'object' },
      defectRelaxationEvidence: { type: 'object' },
      referenceRelaxationEvidence: { type: 'object' },
      maxMinimumImageCandidateEvaluations: { type: 'integer', minimum: 1, maximum: 1000000000, default: 10000000 },
    },
  }
}

const prepareReferenceTool: ZatomToolDefinition = {
  manifest: {
    name: PREPARE_TOOL,
    title: 'Prepare a matched perfect reference for periodic-dislocation relaxation',
    version: '1.0.0',
    description: 'Validate an exact atomman periodic screw-dipole seed artifact, then affinely map its embedded perfect oriented reference into the seed balancing-shear cell. Preserve ordered atom IDs/elements and full PBC so the reference and defect can undergo identical unconstrained fixed-cell relaxation. Return a candidate that may be applied and captured; do not relax or compare energies in this step.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceStructure', 'seedEvidence'],
      properties: {
        sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        seedStructure: { ...ZATOM_STRUCTURE_JSON_SCHEMA, description: 'Exact atomman seed; defaults to active workspace.' },
        useActiveSeed: { type: 'boolean', default: true },
        seedEvidence: { type: 'object' },
        applyToWorkspace: { type: 'boolean', default: false },
        captureAfter: { type: 'boolean', default: false },
      },
    },
    effects: { structure: 'create', workspace: 'write', visual: 'read' },
    tags: ['dislocation', 'periodic-dipole', 'reference', 'relaxation', 'lammps-handoff', 'visual-validation'],
  },
  execute: async (input, context) => {
    try {
      const source = parseZatomStructure(input.sourceStructure)
      const seed = await resolveStructure(input.seedStructure, context, input.useActiveSeed !== false, 'seedStructure')
      const validation = parseZatomPeriodicDislocationDipoleEvidence(input.seedEvidence, {
        sourceStructure: source,
        resultStructure: seed,
      })
      const structure = buildBalancedPeriodicDislocationReference(validation.evidence, seed)
      const structureValidation = validateStructure(structure, { requirePeriodic: true })
      const overview = boundsOfPositions(structure.atoms.map((atom) => atom.position))
      const checks = [
        ...validation.checks,
        {
          id: 'periodic_dislocation_reference.seed_binding',
          status: validation.evidence.metrics.acceptancePassed ? 'pass' as const : 'fail' as const,
          message: `Reference is derived from exact seed evidence ${validation.fingerprint}`,
          metrics: { seedEvidenceFingerprint: validation.fingerprint, seedStructureFingerprint: fingerprintStructure(seed) },
        },
        {
          id: 'periodic_dislocation_reference.affine_mapping',
          status: 'pass' as const,
          message: 'Every perfect-reference fractional coordinate was mapped into the exact seed balancing-shear cell with stable atom IDs/elements/order',
          metrics: { atomCount: structure.atoms.length, balancedReferenceStructureFingerprint: fingerprintStructure(structure) },
        },
        ...structureValidation.checks,
      ]
      return await finalizeStructureCandidate({
        tool: PREPARE_TOOL,
        result: {
          structure,
          checks,
          seedEvidenceFingerprint: validation.fingerprint,
          balancedReferenceStructureFingerprint: fingerprintStructure(structure),
          inspectionTargets: overview ? [{
            id: 'periodic-dislocation-balanced-reference-overview',
            reason: 'Inspect the perfect oriented comparator in the exact balancing-shear cell before relaxation',
            center: overview.center,
            radius: Math.max(2.5, overview.radius + 0.5),
            atomIds: structure.atoms.slice(0, 80).map((atom) => atom.id),
            ...(structure.atoms.length > 80 ? { atomIdsTruncated: true as const } : {}),
          }] : [],
        },
        requestedApply: input.applyToWorkspace === true,
        captureAfter: input.captureAfter === true,
        context,
        summary: (applied, blocked, verified) => `Prepared exact balanced perfect reference ${fingerprintStructure(structure)}${applied ? verified ? '; applied and verified' : '; applied' : blocked ? '; application blocked' : '; candidate only'}`,
      })
    } catch (error) {
      return toolError(PREPARE_TOOL, error)
    }
  },
}

function parsePairInputs(input: Record<string, unknown>) {
  return {
    sourceStructure: parseZatomStructure(input.sourceStructure),
    seedStructure: parseZatomStructure(input.seedStructure),
    relaxedDefectStructure: parseZatomStructure(input.relaxedDefectStructure),
    relaxedReferenceStructure: parseZatomStructure(input.relaxedReferenceStructure),
    seedEvidence: input.seedEvidence as ZatomPeriodicDislocationDipoleEvidence,
    defectRelaxationEvidence: input.defectRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
    referenceRelaxationEvidence: input.referenceRelaxationEvidence as ZatomFixedCellRelaxationEvidence,
    ...(input.maxMinimumImageCandidateEvaluations === undefined
      ? {}
      : { maxMinimumImageCandidateEvaluations: Number(input.maxMinimumImageCandidateEvaluations) }),
  }
}

const composeRelaxationEvidenceTool: ZatomToolDefinition<ZatomPeriodicDislocationRelaxationEvidenceValidation> = {
  manifest: {
    name: COMPOSE_TOOL,
    title: 'Compose matched periodic-dislocation relaxation evidence',
    version: '1.0.0',
    description: `Compose ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA} from one accepted atomman periodic screw-dipole seed, the deterministic balanced perfect reference, and two canonical fixed-cell relaxation artifacts. Require identical LAMMPS executable, potential commands/assets, provider/adapter, settings, cell, composition, atom mapping, and no fixed atoms. Compute matched finite-cell excess energy per total line length, positive-compression LAMMPS pressure-tensor difference, gauge-removed differential displacement, core anchors, force/displacement/contact gates, fingerprints, and visual targets. Do not call the result isolated core energy or infinite-size convergence.`,
    inputSchema: pairedInputSchema(false),
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['dislocation', 'periodic-dipole', 'relaxation', 'matched-reference', 'energy', 'stress', 'visual-validation'],
  },
  execute: async (input) => {
    try {
      const pair = parsePairInputs(input)
      const balancedReference = buildBalancedPeriodicDislocationReference(pair.seedEvidence, pair.seedStructure)
      const seedFingerprint = fingerprintPeriodicDislocationDipoleEvidence(pair.seedEvidence)
      const defectFingerprint = fingerprintFixedCellRelaxationEvidence(pair.defectRelaxationEvidence)
      const referenceFingerprint = fingerprintFixedCellRelaxationEvidence(pair.referenceRelaxationEvidence)
      const validation = composeZatomPeriodicDislocationRelaxationEvidence({
        ...pair,
        acceptance: {
          maximumFinalForceEvPerA: finiteOption(input, 'maximumFinalForceEvPerA', 0.05),
          maximumReferenceRelaxationDisplacementA: finiteOption(input, 'maximumReferenceRelaxationDisplacementA', 1),
          maximumDefectRelaxationDisplacementA: finiteOption(input, 'maximumDefectRelaxationDisplacementA', 5),
          maximumDifferentialDisplacementA: finiteOption(input, 'maximumDifferentialDisplacementA', 10),
          minimumPairDistanceA: finiteOption(input, 'minimumPairDistanceA', 0.35),
        },
        provenance: {
          method: 'Matched 0 K fixed-cell relaxation of an atomman periodic screw-dipole and its affine perfect reference in the identical balancing-shear cell',
          artifacts: [
            { id: 'periodic-dislocation-seed-evidence', role: 'accepted atomman seed evidence', fingerprint: seedFingerprint },
            { id: 'defect-fixed-cell-relaxation-evidence', role: 'relaxed defect evidence', fingerprint: defectFingerprint },
            { id: 'reference-fixed-cell-relaxation-evidence', role: 'relaxed perfect-reference evidence', fingerprint: referenceFingerprint },
            { id: 'balanced-perfect-reference', role: 'exact affine matched reference', fingerprint: fingerprintStructure(balancedReference) },
          ],
          parameters: {
            maximumFinalForceEvPerA: finiteOption(input, 'maximumFinalForceEvPerA', 0.05),
            maximumReferenceRelaxationDisplacementA: finiteOption(input, 'maximumReferenceRelaxationDisplacementA', 1),
            maximumDefectRelaxationDisplacementA: finiteOption(input, 'maximumDefectRelaxationDisplacementA', 5),
            maximumDifferentialDisplacementA: finiteOption(input, 'maximumDifferentialDisplacementA', 10),
            minimumPairDistanceA: finiteOption(input, 'minimumPairDistanceA', 0.35),
          },
          citations: [
            'https://www.ctcms.nist.gov/potentials/atomman/tutorial/4.9._Dislocation_configurations_generator.html',
            'https://docs.lammps.org/minimize.html',
          ],
          scopeWarning: 'Matched potential-energy comparison for one finite periodic quadripole/dipole cell under a host-selected interatomic potential.',
        },
      }, pair).evidence
      const replay = parseZatomPeriodicDislocationRelaxationEvidence(validation, pair)
      return {
        ok: true,
        tool: COMPOSE_TOOL,
        summary: `Composed ${replay.fingerprint}: matched excess ${replay.evidence.metrics.cellExcessPotentialEnergyEv.toPrecision(7)} eV, ${replay.evidence.metrics.excessPotentialEnergyPerTotalLineLengthEvPerA.toPrecision(7)} eV/Å across both lines`,
        data: replay,
        checks: replay.checks,
      }
    } catch (error) {
      return toolError(COMPOSE_TOOL, error)
    }
  },
}

const validateRelaxationEvidenceTool: ZatomToolDefinition<ZatomPeriodicDislocationRelaxationEvidenceValidation> = {
  manifest: {
    name: VALIDATE_TOOL,
    title: 'Validate matched periodic-dislocation relaxation evidence',
    version: '1.0.0',
    description: `Replay and validate ${ZATOM_PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_SCHEMA} against exact source, seed, relaxed defect/reference structures and all three canonical upstream evidence artifacts. Recompute the balanced reference, model/settings equivalence, finite-cell excess energy, positive-compression LAMMPS pressure-tensor difference, differential displacement, gates, fingerprints, and visual targets.`,
    inputSchema: pairedInputSchema(true),
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['dislocation', 'periodic-dipole', 'relaxation', 'matched-reference', 'quality-evidence', 'validation'],
  },
  execute: async (input) => {
    try {
      const validation = parseZatomPeriodicDislocationRelaxationEvidence(input.evidence, parsePairInputs(input))
      return {
        ok: true,
        tool: VALIDATE_TOOL,
        summary: `Validated ${validation.fingerprint}: matched excess ${validation.evidence.metrics.cellExcessPotentialEnergyEv.toPrecision(7)} eV, max differential ${validation.evidence.metrics.maximumDifferentialDisplacementA.toPrecision(6)} Å`,
        data: validation,
        checks: validation.checks,
      }
    } catch (error) {
      return toolError(VALIDATE_TOOL, error)
    }
  },
}

export const PERIODIC_DISLOCATION_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [prepareReferenceTool, composeRelaxationEvidenceTool, validateRelaxationEvidenceTool]
