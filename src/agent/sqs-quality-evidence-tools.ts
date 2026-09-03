/** MCP-facing validation for canonical SQS quality evidence. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomSqsQualityEvidence,
  type ZatomSqsQualityEvidenceValidation,
  ZatomSqsQualityEvidenceInputError,
  ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA,
} from './sqs-quality-evidence'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const validateSqsQualityEvidenceTool:
ZatomToolDefinition<ZatomSqsQualityEvidenceValidation> = {
  manifest: {
    name: 'sqs_validate_quality_evidence',
    title: 'Validate canonical SQS quality evidence',
    version: '1.0.0',
    description: `Validate and canonicalize ${ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA} against exact periodic source/result structures. Recompute relabel-only identity, sublattice counts/fractions, component errors, objective/summary metrics, cluster-space/provenance fingerprints, acceptance gates, and focused visual targets. The contract audits supplied cluster-vector evidence; it does not independently rerun the producer's symmetry engine or prove search convergence, thermodynamic representativeness, ECI quality, or Monte Carlo convergence.`,
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
            'clusterSpaceFingerprint',
            'occupation',
            'clusterSpace',
            'objective',
            'acceptance',
            'metrics',
            'search',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_SQS_QUALITY_EVIDENCE_SCHEMA } },
        },
        sourceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        resultStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact SQS result; defaults to the active workspace.',
        },
        useActiveResult: { type: 'boolean', default: true },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'sqs',
      'alloy',
      'cluster-vector',
      'symmetry-orbit',
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
        throw new ZatomSqsQualityEvidenceInputError(
          'sqs_quality_result_required',
          'An explicit or active SQS result structure is required',
        )
      }
      const result = parseZatomSqsQualityEvidence(input.evidence, {
        sourceStructure: parseZatomStructure(input.sourceStructure),
        resultStructure: parseZatomStructure(rawResult),
      })
      return {
        ok: true,
        tool: 'sqs_validate_quality_evidence',
        summary: `Validated ${result.evidence.schemaVersion} ${result.fingerprint}: ${result.evidence.clusterSpace.componentCount} cluster-vector component(s) through order ${result.evidence.clusterSpace.maximumOrder}, max error ${result.evidence.metrics.maximumAbsoluteClusterError.toExponential(3)}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError('sqs_validate_quality_evidence', error)
    }
  },
}

export const SQS_QUALITY_EVIDENCE_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [validateSqsQualityEvidenceTool]
