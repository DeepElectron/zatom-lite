/** MCP-facing validation for canonical fixed-topology structural ensembles. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomStructureEnsemble,
  type ZatomStructureEnsembleValidation,
  ZatomStructureEnsembleInputError,
  ZATOM_STRUCTURE_ENSEMBLE_SCHEMA,
} from './structure-ensemble'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const validateStructureEnsembleTool: ZatomToolDefinition<ZatomStructureEnsembleValidation> = {
  manifest: {
    name: 'structure_validate_ensemble',
    title: 'Validate a calibrated fixed-topology structural ensemble',
    version: '1.0.0',
    description: 'Validate and canonicalize a bounded weighted ensemble of finite structures sharing one exact atom/bond/formal-charge/stereochemical topology; bind the selected member to the active structure, independently verify Boltzmann weights when declared, compute rotation/translation-invariant pair-distance spread and atom localization, preserve evidence/applicability, and return a stable replay fingerprint. This contract represents structural alternatives, not chemical-identity alternatives.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ensemble'],
      properties: {
        ensemble: {
          type: 'object',
          description: `Canonical ${ZATOM_STRUCTURE_ENSEMBLE_SCHEMA} artifact from a calibrated structural sampler or model ensemble.`,
          required: [
            'schemaVersion',
            'topologyFingerprint',
            'members',
            'selection',
            'weightModel',
            'acceptance',
            'evidenceSources',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_STRUCTURE_ENSEMBLE_SCHEMA } },
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected ensemble member from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'structure',
      'ensemble',
      'conformer',
      'structural-uncertainty',
      'model-averaging',
      'boltzmann',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomStructureEnsembleValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomStructureEnsembleInputError(
          'structure_ensemble_selected_structure_required',
          'An explicit or active selected structure is required to validate the structure ensemble',
        )
      }
      const result = parseZatomStructureEnsemble(input.ensemble, {
        selectedStructure: parseZatomStructure(rawStructure),
      })
      return {
        ok: true,
        tool: 'structure_validate_ensemble',
        summary: `Validated ${result.ensemble.schemaVersion} ${result.fingerprint} with ${result.ensemble.members.length} weighted member(s); selected ${result.ensemble.selection.selectedMemberId}; expected pair-distance spread ${result.geometryDiagnostics.expectedPairwiseMemberDistanceMatrixRmsdA.toFixed(6)} Å`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomStructureEnsembleInputError || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'structure_validate_ensemble',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'structure_validate_ensemble',
        summary: message,
        error: { code: 'structure_ensemble_validation_failed', message },
      }
    }
  },
}

export const STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validateStructureEnsembleTool,
]
