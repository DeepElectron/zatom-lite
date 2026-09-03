/** MCP-facing validation for calibrated periodic-cell structural ensembles. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  parseZatomPeriodicStructureEnsemble,
  type ZatomPeriodicStructureEnsembleValidation,
  ZatomPeriodicStructureEnsembleInputError,
  ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA,
} from './periodic-structure-ensemble'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const validatePeriodicStructureEnsembleTool:
ZatomToolDefinition<ZatomPeriodicStructureEnsembleValidation> = {
  manifest: {
    name: 'structure_validate_periodic_ensemble',
    title: 'Validate a calibrated periodic-cell structural ensemble',
    version: '1.0.0',
    description: 'Validate and canonicalize a bounded weighted ensemble with one ordered atom/optional-bond identity and common periodic axes while lattice metrics and fractional internal geometry vary. Bind the selected member to the active structure, recompute Boltzmann weights, measure rotation-invariant periodic strain/cell spread and cell-decoupled fractional internal spread, certify minimum-image contacts under a hard image budget, localize suspicious atoms, and return a stable replay fingerprint.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ensemble'],
      properties: {
        ensemble: {
          type: 'object',
          description: `Canonical ${ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA} artifact from a calibrated periodic sampler or model ensemble.`,
          required: [
            'schemaVersion',
            'identityFingerprint',
            'periodic',
            'members',
            'selection',
            'weightModel',
            'acceptance',
            'evidenceSources',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_PERIODIC_STRUCTURE_ENSEMBLE_SCHEMA } },
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected periodic member from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'structure',
      'periodic',
      'lattice',
      'cell-uncertainty',
      'strain',
      'ensemble',
      'minimum-image',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomPeriodicStructureEnsembleValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomPeriodicStructureEnsembleInputError(
          'periodic_structure_ensemble_selected_structure_required',
          'An explicit or active selected periodic structure is required',
        )
      }
      const result = parseZatomPeriodicStructureEnsemble(input.ensemble, {
        selectedStructure: parseZatomStructure(rawStructure),
      })
      return {
        ok: true,
        tool: 'structure_validate_periodic_ensemble',
        summary: `Validated ${result.ensemble.schemaVersion} ${result.fingerprint} with ${result.ensemble.members.length} member(s), ${result.diagnostics.periodicDimension}D periodic cell-metric spread ${result.diagnostics.expectedPairwisePeriodicMetricRms.toFixed(6)}, and cell-decoupled internal spread ${result.diagnostics.expectedPairwiseFractionalInternalDistanceMatrixRmsA.toFixed(6)} Å`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomPeriodicStructureEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'structure_validate_periodic_ensemble',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'structure_validate_periodic_ensemble',
        summary: message,
        error: { code: 'periodic_structure_ensemble_validation_failed', message },
      }
    }
  },
}

export const PERIODIC_STRUCTURE_ENSEMBLE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  validatePeriodicStructureEnsembleTool,
]
