/** MCP-facing composition and validation for all-state molecular structure catalogs. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { type ZatomChemicalStateEnsemble } from './chemical-state-ensemble'
import {
  composeZatomChemicalStateStructureCatalog,
  parseZatomChemicalStateStructureCatalog,
  type ZatomChemicalStateStructureCatalogValidation,
  ZatomChemicalStateStructureCatalogInputError,
  ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA,
} from './chemical-state-structure-catalog'
import { parseZatomStructure } from './structure-validation'
import { toolError } from './tool-helpers'

const composeChemicalStateStructureCatalogTool:
ZatomToolDefinition<ZatomChemicalStateStructureCatalogValidation> = {
  manifest: {
    name: 'chemical_state_compose_structure_catalog',
    title: 'Compose an all-state molecular structure catalog',
    version: '1.0.0',
    description: 'Bind one exact finite explicit-bond structure to every canonical chemical state, require complete state coverage and stable ordered heavy-atom correspondence, derive all dependency fingerprints, and return a replayable catalog plus identity-variable visual targets. This composes supplied structures; it does not generate states, coordinates, mappings, probabilities, or stability evidence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['chemicalStateEnsemble', 'heavyAtomIds', 'stateStructures', 'provenance'],
      properties: {
        chemicalStateEnsemble: {
          type: 'object',
          description: 'Canonical zatom.chemical-state-ensemble/v1 identity/population artifact.',
        },
        chemicalStateReferenceStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact selected-state structure bound by chemicalStateEnsemble; defaults to the active workspace.',
        },
        heavyAtomIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1, maxLength: 128 },
          description: 'Ordered stable heavy-atom IDs preserved by every supplied state structure.',
        },
        stateStructures: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['stateId', 'structure'],
            properties: {
              stateId: { type: 'string', minLength: 1, maxLength: 128 },
              structure: ZATOM_STRUCTURE_JSON_SCHEMA,
            },
          },
        },
        provenance: {
          type: 'object',
          additionalProperties: false,
          required: ['engine', 'engineVersion', 'method', 'artifacts', 'parameters', 'citations', 'scopeWarning'],
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
        useActiveStructure: {
          type: 'boolean',
          default: true,
          description: 'Read the chemical-state reference structure from the active workspace when omitted.',
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-catalog',
      'heavy-atom-mapping',
      'composition',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context) => {
    try {
      const rawReference = input.chemicalStateReferenceStructure !== undefined
        ? input.chemicalStateReferenceStructure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawReference) {
        throw new ZatomChemicalStateStructureCatalogInputError(
          'chemical_state_structure_catalog_reference_required',
          'An explicit or active chemical-state reference structure is required',
        )
      }
      const result = composeZatomChemicalStateStructureCatalog({
        chemicalStateEnsemble: input.chemicalStateEnsemble,
        chemicalStateReferenceStructure: parseZatomStructure(rawReference),
        heavyAtomIds: input.heavyAtomIds,
        stateStructures: input.stateStructures,
        provenance: input.provenance,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      })
      return {
        ok: true,
        tool: 'chemical_state_compose_structure_catalog',
        summary: `Composed ${result.catalog.schemaVersion} ${result.fingerprint} with ${result.catalog.entries.length} exact state structure(s) and ${result.catalog.heavyAtomIds.length} mapped heavy atom(s)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError('chemical_state_compose_structure_catalog', error)
    }
  },
}

const validateChemicalStateStructureCatalogTool:
ZatomToolDefinition<ZatomChemicalStateStructureCatalogValidation> = {
  manifest: {
    name: 'chemical_state_validate_structure_catalog',
    title: 'Validate an all-state molecular structure catalog',
    version: '1.0.0',
    description: `Validate and canonicalize ${ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA} against its exact chemical-state ensemble and pre-sampling selected-state reference. Recompute every state/structure fingerprint and identity, enforce complete coverage and stable heavy-atom correspondence, audit provenance, and localize identity-variable atoms.`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['catalog', 'chemicalStateEnsemble'],
      properties: {
        catalog: {
          type: 'object',
          required: [
            'schemaVersion',
            'chemicalStateEnsembleFingerprint',
            'chemicalStateReferenceStructureFingerprint',
            'heavyAtomIds',
            'entries',
            'provenance',
          ],
          properties: { schemaVersion: { const: ZATOM_CHEMICAL_STATE_STRUCTURE_CATALOG_SCHEMA } },
        },
        chemicalStateEnsemble: { type: 'object' },
        chemicalStateReferenceStructure: {
          ...ZATOM_STRUCTURE_JSON_SCHEMA,
          description: 'Exact selected-state reference bound by chemicalStateEnsemble; defaults to the active workspace.',
        },
        useActiveStructure: { type: 'boolean', default: true },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: [
      'molecule',
      'chemical-state',
      'structure-catalog',
      'heavy-atom-mapping',
      'validation',
      'fingerprint',
      'visual-validation',
    ],
  },
  execute: async (input, context) => {
    try {
      const rawReference = input.chemicalStateReferenceStructure !== undefined
        ? input.chemicalStateReferenceStructure
        : input.useActiveStructure === false
          ? null
          : await context.readStructure?.() ?? null
      if (!rawReference) {
        throw new ZatomChemicalStateStructureCatalogInputError(
          'chemical_state_structure_catalog_reference_required',
          'An explicit or active chemical-state reference structure is required',
        )
      }
      const result = parseZatomChemicalStateStructureCatalog(input.catalog, {
        chemicalStateEnsemble: input.chemicalStateEnsemble as ZatomChemicalStateEnsemble,
        chemicalStateReferenceStructure: parseZatomStructure(rawReference),
      })
      return {
        ok: true,
        tool: 'chemical_state_validate_structure_catalog',
        summary: `Validated ${result.catalog.schemaVersion} ${result.fingerprint} with ${result.catalog.entries.length} state structure(s), exact reference binding, and complete ordered heavy-atom correspondence`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError('chemical_state_validate_structure_catalog', error)
    }
  },
}

export const CHEMICAL_STATE_STRUCTURE_CATALOG_ZATOM_AGENT_TOOLS:
readonly ZatomToolDefinition[] = [
  composeChemicalStateStructureCatalogTool,
  validateChemicalStateStructureCatalogTool,
]
