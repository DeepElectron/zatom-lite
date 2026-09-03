/** MCP-facing validation for canonical molecular chemical-state ensembles. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomChemicalStateEnsemble,
  type ZatomChemicalStateEnsembleValidation,
  ZatomChemicalStateEnsembleInputError,
  ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA,
} from './chemical-state-ensemble'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const validateChemicalStateEnsembleTool: ZatomToolDefinition<ZatomChemicalStateEnsembleValidation> = {
  manifest: {
    name: 'chemical_state_validate_ensemble',
    title: 'Validate a canonical molecular chemical-state ensemble',
    version: '1.0.0',
    description: 'Validate and canonicalize a bounded tautomer/protonation/stereoisomer candidate ensemble, bind its selected state to an exact explicit structure, audit completion, invariants, optional normalized pH populations, provenance, and compute a stable replay fingerprint.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ensemble'],
      properties: {
        ensemble: {
          type: 'object',
          description: `Canonical ${ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA} artifact from a trusted state enumerator.`,
          required: [
            'schemaVersion',
            'selectedStructureFingerprint',
            'enumeration',
            'source',
            'normalized',
            'states',
            'selection',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_CHEMICAL_STATE_ENSEMBLE_SCHEMA } },
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the selected explicit structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'tautomer',
      'protonation',
      'microstate',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomChemicalStateEnsembleValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomChemicalStateEnsembleInputError(
          'chemical_state_structure_required',
          'An explicit or active selected structure is required to validate the ensemble',
        )
      }
      const result = parseZatomChemicalStateEnsemble(input.ensemble, {
        structure: parseZatomStructure(rawStructure),
      })
      return {
        ok: true,
        tool: 'chemical_state_validate_ensemble',
        summary: `Validated ${result.ensemble.schemaVersion} ${result.fingerprint} with ${result.ensemble.states.length} state(s); selected ${result.ensemble.selection.selectedStateId}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomChemicalStateEnsembleInputError || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'chemical_state_validate_ensemble',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'chemical_state_validate_ensemble',
        summary: message,
        error: { code: 'chemical_state_ensemble_validation_failed', message },
      }
    }
  },
}

export const CHEMICAL_STATE_ENSEMBLE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validateChemicalStateEnsembleTool,
]
