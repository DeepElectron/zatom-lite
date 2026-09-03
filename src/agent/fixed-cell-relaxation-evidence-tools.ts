/** MCP-facing replay validation for canonical fixed-cell relaxation evidence. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomFixedCellRelaxationEvidence,
  type ZatomFixedCellRelaxationEvidenceValidation,
  ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA,
} from './fixed-cell-relaxation-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const TOOL_NAME = 'relaxation_validate_fixed_cell_evidence'

const validateFixedCellRelaxationEvidenceTool:
ZatomToolDefinition<ZatomFixedCellRelaxationEvidenceValidation> = {
  manifest: {
    name: TOOL_NAME,
    title: 'Validate canonical fixed-cell relaxation evidence',
    version: '1.0.0',
    description: `Validate and canonicalize ${ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA} against exact source/result structures. Recompute stable atom/topology/property mapping, exact fixed-cell identity, source-to-result certified minimum-image displacement, final force norms and restricted-frame fmax, a certified skew-cell closest-pair scan, and positive-compression LAMMPS pressure-tensor trace/volume consistency, plus acceptance gates, executable/model provenance, fingerprints, and visual targets. This audits a 0 K fixed-cell minimization; it does not prove potential accuracy, pressure equilibrium, cell-size convergence, phase stability, kinetics, or electronic-structure consistency.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'sourceStructure'],
      properties: {
        evidence: {
          type: 'object',
          required: [
            'schemaVersion', 'sourceStructureFingerprint', 'resultStructureFingerprint', 'method', 'model',
            'settings', 'observations', 'acceptance', 'mapping', 'boundary', 'metrics', 'diagnostics', 'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_FIXED_CELL_RELAXATION_EVIDENCE_SCHEMA } },
        },
        sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        resultStructure: { ...ZATOM_STRUCTURE_JSON_SCHEMA, description: 'Exact relaxed result; defaults to the active workspace.' },
        useActiveResult: { type: 'boolean', default: true },
        maxPairScanAtoms: { type: 'integer', minimum: 2, maximum: 100000, default: 5000 },
        maxMinimumImageCandidateEvaluations: { type: 'integer', minimum: 1, maximum: 1000000000, default: 50000000 },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['relaxation', 'lammps', 'fixed-cell', 'energy', 'force', 'stress', 'quality-evidence', 'validation'],
  },
  execute: async (input, context) => {
    try {
      const rawResult = input.resultStructure !== undefined
        ? input.resultStructure
        : input.useActiveResult === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawResult) throw new Error('An explicit or active fixed-cell relaxation result is required')
      const validation = parseZatomFixedCellRelaxationEvidence(input.evidence, {
        sourceStructure: parseZatomStructure(input.sourceStructure),
        resultStructure: parseZatomStructure(rawResult),
        ...(input.maxPairScanAtoms === undefined ? {} : { maxPairScanAtoms: Number(input.maxPairScanAtoms) }),
        ...(input.maxMinimumImageCandidateEvaluations === undefined
          ? {}
          : { maxMinimumImageCandidateEvaluations: Number(input.maxMinimumImageCandidateEvaluations) }),
      })
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: `Validated ${validation.evidence.schemaVersion} ${validation.fingerprint}: ΔE=${validation.evidence.metrics.potentialEnergyChangeEv.toExponential(5)} eV, max|F|=${validation.evidence.metrics.maximumForceEvPerA.toExponential(5)} eV/Å, pair=${validation.evidence.metrics.minimumPairDistanceA.toPrecision(6)} Å`,
        data: validation,
        checks: validation.checks,
      }
    } catch (error) {
      return toolError(TOOL_NAME, error)
    }
  },
}

export const FIXED_CELL_RELAXATION_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [validateFixedCellRelaxationEvidenceTool]
