/** MCP-facing validation for joint chemical-identity and conditional-structure distributions. */

import type { ZatomToolDefinition, ZatomToolResult } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  type ZatomChemicalStateEnsemble,
  ZatomChemicalStateEnsembleInputError,
} from './chemical-state-ensemble'
import {
  composeZatomChemicalStateStructuralDistribution,
  parseZatomChemicalStateStructuralDistribution,
  type ZatomChemicalStateStructuralDistributionValidation,
  ZatomChemicalStateStructuralDistributionInputError,
  ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA,
} from './chemical-state-structural-distribution'
import { ZatomStructureEnsembleInputError } from './structure-ensemble'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'

const composeChemicalStateStructuralDistributionTool:
ZatomToolDefinition<ZatomChemicalStateStructuralDistributionValidation> = {
  manifest: {
    name: 'chemical_state_compose_structural_distribution',
    title: 'Compose a joint chemical-state and structural distribution',
    version: '2.0.0',
    description: 'Compose one validated populated chemical-state ensemble with exactly one already-calibrated fixed-topology structure ensemble per state. Derive all source fingerprints and shared conditions, then independently validate joint weights, selected-structure binding, state coverage, and heavy-atom correspondence. This tool does not generate states, conformers, probabilities, or completeness evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'chemicalStateEnsemble',
        'chemicalStateReferenceStructure',
        'heavyAtomIds',
        'stateStructureEnsembles',
        'acceptance',
        'provenance',
      ],
      properties: {
        chemicalStateEnsemble: {
          type: 'object',
          description: 'A canonical populated zatom.chemical-state-ensemble/v1 artifact; its normalization scope is preserved.',
        },
        heavyAtomIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1, maxLength: 128 },
          description: 'Ordered stable heavy-atom IDs shared by every state and conditional member.',
        },
        stateStructureEnsembles: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['stateId', 'structureEnsemble'],
            properties: {
              stateId: { type: 'string', minLength: 1, maxLength: 128 },
              structureEnsemble: {
                type: 'object',
                description: 'A calibrated zatom.structure-ensemble/v1 conditional on this exact chemical state.',
              },
            },
          },
        },
        acceptance: {
          type: 'object',
          additionalProperties: false,
          required: ['minimumJointWeightEffectiveMemberCount'],
          properties: {
            minimumJointWeightEffectiveMemberCount: { type: 'number', minimum: 1 },
          },
        },
        provenance: {
          type: 'object',
          additionalProperties: false,
          required: [
            'engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning',
          ],
          properties: {
            engine: { type: 'string', minLength: 1 },
            engineVersion: { type: 'string', minLength: 1 },
            method: { type: 'string', minLength: 1 },
            artifacts: { type: 'array', minItems: 1 },
            parameters: { type: 'object' },
            citations: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
            scopeWarning: { type: 'string', minLength: 1 },
          },
        },
        metadata: { type: 'object' },
        chemicalStateReferenceStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact pre-sampling structure bound by chemicalStateEnsemble, required independently of the selected joint member.',
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected chemical-state/structure member from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-ensemble',
      'joint-distribution',
      'composition',
      'structural-uncertainty',
      'heavy-atom-mapping',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomChemicalStateStructuralDistributionValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomChemicalStateStructuralDistributionInputError(
          'chemical_state_structural_distribution_selected_structure_required',
          'An explicit or active selected structure is required to compose the joint distribution',
        )
      }
      const result = composeZatomChemicalStateStructuralDistribution({
        chemicalStateEnsemble: input.chemicalStateEnsemble,
        heavyAtomIds: input.heavyAtomIds,
        stateStructureEnsembles: input.stateStructureEnsembles,
        acceptance: input.acceptance,
        provenance: input.provenance,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      }, {
        selectedStructure: parseZatomStructure(rawStructure),
        chemicalStateReferenceStructure: parseZatomStructure(input.chemicalStateReferenceStructure),
      })
      return {
        ok: true,
        tool: 'chemical_state_compose_structural_distribution',
        summary: `Composed ${result.distribution.schemaVersion} ${result.fingerprint} from ${result.distribution.stateStructureEnsembles.length} state-conditioned ensemble(s) and ${result.jointMembers.length} joint member(s); all source fingerprints and shared conditions were derived and revalidated`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomChemicalStateStructuralDistributionInputError
        || error instanceof ZatomChemicalStateEnsembleInputError
        || error instanceof ZatomStructureEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'chemical_state_compose_structural_distribution',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'chemical_state_compose_structural_distribution',
        summary: message,
        error: { code: 'chemical_state_structural_distribution_composition_failed', message },
      }
    }
  },
}

const validateChemicalStateStructuralDistributionTool:
ZatomToolDefinition<ZatomChemicalStateStructuralDistributionValidation> = {
  manifest: {
    name: 'chemical_state_validate_structural_distribution',
    title: 'Validate a joint chemical-state and structural distribution',
    version: '2.0.0',
    description: 'Validate and canonicalize a populated chemical-state ensemble composed with one calibrated fixed-topology structure ensemble per state. Recompute joint state-by-structure weights, enforce exact state coverage and stable heavy-atom correspondence across identities, bind the selected state/member to the active structure, localize identity-variable atoms, and return a stable replay fingerprint.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['distribution', 'chemicalStateEnsemble', 'chemicalStateReferenceStructure'],
      properties: {
        distribution: {
          type: 'object',
          description: `Canonical ${ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA} artifact from a calibrated joint identity/structure producer.`,
          required: [
            'schemaVersion',
            'chemicalStateEnsembleFingerprint',
            'conditions',
            'heavyAtomIds',
            'stateStructureEnsembles',
            'acceptance',
            'provenance',
          ],
          properties: {
            schemaVersion: { const: ZATOM_CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_SCHEMA },
          },
        },
        chemicalStateEnsemble: {
          type: 'object',
          description: 'The exact populated zatom.chemical-state-ensemble/v1 artifact bound by the distribution.',
        },
        chemicalStateReferenceStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact pre-sampling structure bound by chemicalStateEnsemble, required independently of the selected joint member.',
        },
        structure: ZATOM_STRUCTURE_JSON_SCHEMA,
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the exact selected chemical-state/structure member from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-ensemble',
      'joint-distribution',
      'structural-uncertainty',
      'heavy-atom-mapping',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context): Promise<ZatomToolResult<ZatomChemicalStateStructuralDistributionValidation>> => {
    try {
      const rawStructure = input.structure !== undefined
        ? input.structure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawStructure) {
        throw new ZatomChemicalStateStructuralDistributionInputError(
          'chemical_state_structural_distribution_selected_structure_required',
          'An explicit or active selected structure is required to validate the joint distribution',
        )
      }
      const result = parseZatomChemicalStateStructuralDistribution(input.distribution, {
        chemicalStateEnsemble: input.chemicalStateEnsemble as ZatomChemicalStateEnsemble,
        selectedStructure: parseZatomStructure(rawStructure),
        chemicalStateReferenceStructure: parseZatomStructure(input.chemicalStateReferenceStructure),
      })
      return {
        ok: true,
        tool: 'chemical_state_validate_structural_distribution',
        summary: `Validated ${result.distribution.schemaVersion} ${result.fingerprint} with ${result.distribution.stateStructureEnsembles.length} state-conditioned ensemble(s), ${result.jointMembers.length} joint member(s), and Kish effective count ${result.jointWeightEffectiveMemberCount.toFixed(3)}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      if (error instanceof ZatomChemicalStateStructuralDistributionInputError
        || error instanceof ZatomChemicalStateEnsembleInputError
        || error instanceof ZatomStructureEnsembleInputError
        || error instanceof ZatomStructureInputError) {
        return {
          ok: false,
          tool: 'chemical_state_validate_structural_distribution',
          summary: error.message,
          error: { code: error.code, message: error.message },
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: 'chemical_state_validate_structural_distribution',
        summary: message,
        error: { code: 'chemical_state_structural_distribution_validation_failed', message },
      }
    }
  },
}

export const CHEMICAL_STATE_STRUCTURAL_DISTRIBUTION_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [
  composeChemicalStateStructuralDistributionTool,
  validateChemicalStateStructuralDistributionTool,
]
