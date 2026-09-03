/** MCP-facing validation for canonical, structure-bound microscopic pKa evidence. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomMicroPkaEvidence,
  type ZatomMicroPkaEvidenceValidation,
  ZatomMicroPkaEvidenceInputError,
  ZATOM_MICRO_PKA_EVIDENCE_SCHEMA,
} from './micro-pka-evidence'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const validateMicroPkaEvidenceTool: ZatomToolDefinition<ZatomMicroPkaEvidenceValidation> = {
  manifest: {
    name: 'micro_pka_validate_evidence',
    title: 'Validate canonical microscopic pKa site evidence',
    version: '1.0.0',
    description: 'Validate and canonicalize site-labelled microscopic pKa predictions against an exact explicit molecular structure; audit stable atom/index mappings, one-proton conjugate stoichiometry, hashed model assets, external calibration evidence, per-prediction uncertainty disclosure, applicability, scope, and visual targets without inferring populations.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['evidence'],
      properties: {
        evidence: {
          type: 'object',
          description: `Canonical ${ZATOM_MICRO_PKA_EVIDENCE_SCHEMA} artifact from a trusted quantitative predictor.`,
          required: [
            'schemaVersion',
            'structureFingerprint',
            'reference',
            'siteEnumeration',
            'predictionContext',
            'predictions',
            'model',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_MICRO_PKA_EVIDENCE_SCHEMA } },
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact molecular reference from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'protonation',
      'microstate',
      'pka',
      'calibration',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomMicroPkaEvidenceValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomMicroPkaEvidenceInputError(
          'micro_pka_structure_required',
          'An explicit or active molecular reference structure is required to validate microscopic pKa evidence',
        )
      }
      const result = parseZatomMicroPkaEvidence(input.evidence, {
        structure: parseZatomStructure(rawStructure),
      })
      return {
        ok: true,
        tool: 'micro_pka_validate_evidence',
        summary: `Validated ${result.evidence.schemaVersion} ${result.fingerprint} with ${result.evidence.predictions.length} site prediction(s)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomMicroPkaEvidenceInputError || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'micro_pka_validate_evidence',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'micro_pka_validate_evidence',
        summary: message,
        error: { code: 'micro_pka_evidence_validation_failed', message },
      }
    }
  },
}

export const MICRO_PKA_EVIDENCE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validateMicroPkaEvidenceTool,
]
