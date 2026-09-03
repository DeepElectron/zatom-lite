/** MCP-facing replay validation for canonical continuum-dislocation evidence. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomContinuumDislocationEvidence,
  type ZatomContinuumDislocationEvidenceValidation,
  ZatomContinuumDislocationEvidenceInputError,
  ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA,
} from './continuum-dislocation-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const TOOL_NAME = 'continuum_dislocation_validate_evidence'

const validateContinuumDislocationEvidenceTool:
ZatomToolDefinition<ZatomContinuumDislocationEvidenceValidation> = {
  manifest: {
    name: TOOL_NAME,
    title: 'Validate canonical continuum-dislocation evidence',
    version: '1.0.0',
    description: `Validate and canonicalize ${ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA} against exact source/result structures. Recompute Cartesian stiffness-tensor symmetry/eigenvalue/condition gates, glide geometry, source-index atom mapping, boundary truth, core clearance, displacements, exact minimum distance, theoretical stress summaries, fingerprints, and focused visual targets. This audits a continuum seed and its declared producer evidence; it does not independently solve the anisotropic elasticity equations, relax the core, prove stability, or establish simulation-ready transverse boundaries.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence', 'sourceStructure'],
      properties: {
        evidence: {
          type: 'object',
          required: [
            'schemaVersion',
            'sourceStructureFingerprint',
            'resultStructureFingerprint',
            'elasticity',
            'defect',
            'mapping',
            'boundary',
            'acceptance',
            'metrics',
            'diagnostics',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_CONTINUUM_DISLOCATION_EVIDENCE_SCHEMA } },
        },
        sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        resultStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact dislocation result; defaults to the active workspace.',
        },
        useActiveResult: { type: 'boolean', default: true },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'dislocation',
      'anisotropic-elasticity',
      'continuum',
      'quality-evidence',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context) => {
    try {
      const rawResult = input.resultStructure !== undefined
        ? input.resultStructure
        : input.useActiveResult === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawResult) {
        throw new ZatomContinuumDislocationEvidenceInputError(
          'continuum_dislocation_result_required',
          'An explicit or active continuum-dislocation result structure is required',
        )
      }
      const result = parseZatomContinuumDislocationEvidence(input.evidence, {
        sourceStructure: parseZatomStructure(input.sourceStructure),
        resultStructure: parseZatomStructure(rawResult),
      })
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: `Validated ${result.evidence.schemaVersion} ${result.fingerprint}: ${result.evidence.defect.character} |b|=${result.evidence.defect.burgersMagnitudeA.toPrecision(6)} Å, minimum pair ${result.evidence.metrics.minimumPairDistanceA.toPrecision(6)} Å`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(TOOL_NAME, error)
    }
  },
}

export const CONTINUUM_DISLOCATION_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [validateContinuumDislocationEvidenceTool]
