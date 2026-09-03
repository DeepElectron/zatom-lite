/** MCP-facing same-model interface adhesion evidence composition. */

import type { ZatomToolDefinition } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  composeInterfaceAdhesionEvidence,
  type ComposeInterfaceAdhesionEvidenceResult,
  type InterfaceAdhesionEnergyObservation,
  type InterfaceAdhesionModelDeclaration,
} from './interface-adhesion-evidence'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { toolError } from './tool-helpers'

const TOOL_NAME = 'interface_compose_adhesion_evidence'

const observationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'structureFingerprint', 'energyEv', 'artifactFingerprint'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128 },
    structureFingerprint: { type: 'string', minLength: 1, maxLength: 128 },
    energyEv: { type: 'number' },
    artifactFingerprint: { type: 'string', minLength: 1, maxLength: 256 },
  },
}

const tool: ZatomToolDefinition<ComposeInterfaceAdhesionEvidenceResult> = {
  manifest: {
    name: TOOL_NAME,
    title: 'Compose interface adhesion evidence',
    version: '2.0.0',
    description: 'Bind three explicit same-model energy observations to one zatom.interface/v1 structure and its exact zatom.interface-reference-set/v1 bottom/top fixed-cell partition; verify construction, reference-set, cell, atom-layer, and internal-topology identity; and compute signed interaction energy plus work of adhesion in eV/Å² and J/m². This performs no calculation and does not prove model applicability, relaxation/convergence, reconstruction, fracture, or experimental adhesion.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['bottomReferenceStructure', 'topReferenceStructure', 'observations', 'model'],
      properties: {
        interfaceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        bottomReferenceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        topReferenceStructure: ZATOM_STRUCTURE_JSON_SCHEMA,
        observations: {
          type: 'object',
          additionalProperties: false,
          required: ['interface', 'bottomReference', 'topReference'],
          properties: {
            interface: observationSchema,
            bottomReference: observationSchema,
            topReference: observationSchema,
          },
        },
        model: {
          type: 'object',
          additionalProperties: false,
          required: [
            'identityFingerprint', 'engine', 'engineVersion', 'method', 'energyKind',
            'geometryProtocol', 'applicability', 'consistencyStatement', 'citations',
          ],
          properties: {
            identityFingerprint: { type: 'string', minLength: 1, maxLength: 256 },
            engine: { type: 'string', minLength: 1, maxLength: 256 },
            engineVersion: { type: 'string', minLength: 1, maxLength: 256 },
            method: { type: 'string', minLength: 1, maxLength: 4096 },
            energyKind: { enum: ['potential-energy', 'electronic-total-energy'] },
            geometryProtocol: { enum: ['unrelaxed-single-point', 'independently-relaxed-fixed-cell'] },
            applicability: {
              type: 'object',
              additionalProperties: false,
              required: ['assessment', 'domain', 'reasons'],
              properties: {
                assessment: { enum: ['in-domain', 'unknown', 'out-of-domain'] },
                domain: { type: 'string', minLength: 1, maxLength: 4096 },
                reasons: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 4096 } },
              },
            },
            consistencyStatement: { type: 'string', minLength: 1, maxLength: 4096 },
            citations: { type: 'array', minItems: 1, maxItems: 32, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 4096 } },
          },
        },
      },
    },
    effects: { structure: 'read', workspace: 'read', visual: 'none' },
    tags: ['interface', 'adhesion', 'energy-evidence', 'reference', 'provenance', 'validation', 'agent'],
  },
  execute: async (input, context) => {
    try {
      const rawInterface = input.interfaceStructure ?? await context.readStructure?.()
      if (!rawInterface) {
        throw new ZatomStructureInputError(
          'no_active_structure',
          'No interfaceStructure was supplied and the active workspace is empty',
        )
      }
      const result = composeInterfaceAdhesionEvidence({
        interfaceStructure: parseZatomStructure(rawInterface),
        bottomReferenceStructure: parseZatomStructure(input.bottomReferenceStructure),
        topReferenceStructure: parseZatomStructure(input.topReferenceStructure),
        observations: input.observations as {
          interface: InterfaceAdhesionEnergyObservation
          bottomReference: InterfaceAdhesionEnergyObservation
          topReference: InterfaceAdhesionEnergyObservation
        },
        model: input.model as unknown as InterfaceAdhesionModelDeclaration,
      })
      return {
        ok: true,
        tool: TOOL_NAME,
        summary: `Composed ${result.evidenceFingerprint}: interaction ${result.evidence.result.interactionEnergyEv.toExponential(6)} eV; work of adhesion ${result.evidence.result.workOfAdhesionJPerM2.toExponential(6)} J/m² (${result.evidence.model.applicability.assessment} applicability)`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(TOOL_NAME, error)
    }
  },
}

export const INTERFACE_ADHESION_EVIDENCE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [tool]
