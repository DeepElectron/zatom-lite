import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  analyzeLocalEnvironment,
  LOCAL_ENVIRONMENT_VERSION,
  type LocalEnvironmentResult,
} from './local-environment'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

function optionalNumber(input: Record<string, unknown>, name: string): number | undefined {
  return input[name] === undefined ? undefined : Number(input[name])
}

const localEnvironmentManifest: ZatomToolManifest = {
  name: 'structure_analyze_local_environment',
  title: 'Analyze local atomic environments',
  version: LOCAL_ENVIRONMENT_VERSION,
  description: 'List neighbours within a cutoff and the coordination number for given atom ids, including periodic images when the structure has a lattice. Read-only. Use it to check a site before/after an edit (e.g. is this O still 2-coordinated?).',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    cutoffA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
    periodic: {
      type: 'boolean',
      description: 'Explicitly include every image along the structure lattice axes declared periodic',
    },
    centralAtomIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100000,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
      description: 'Exact centers in requested order; omit to analyze every atom in canonical structure order',
    },
    neighborElements: {
      type: 'array',
      minItems: 1,
      maxItems: 118,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    minimumCoordination: { type: 'integer', minimum: 0, maximum: 1000000 },
    maximumCoordination: { type: 'integer', minimum: 0, maximum: 1000000 },
    maxPairEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 100000000,
      default: 5000000,
      description: 'Hard center-neighbor comparison budget',
    },
    maxPeriodicImageCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000000,
      default: 50000000,
      description: 'Hard aggregate integer-image candidate budget for complete skew-cell enumeration',
    },
  }, ['cutoffA', 'periodic']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['structure', 'analysis', 'neighbors', 'coordination', 'periodic', 'inspection', 'agent'],
}

const localEnvironmentTool: ZatomToolDefinition<LocalEnvironmentResult> = {
  manifest: localEnvironmentManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = analyzeLocalEnvironment({
        structure,
        cutoffA: Number(input.cutoffA),
        periodic: input.periodic === true,
        ...(Array.isArray(input.centralAtomIds) ? { centralAtomIds: input.centralAtomIds.map(String) } : {}),
        ...(Array.isArray(input.neighborElements) ? { neighborElements: input.neighborElements.map(String) } : {}),
        ...(input.minimumCoordination === undefined ? {} : { minimumCoordination: Number(input.minimumCoordination) }),
        ...(input.maximumCoordination === undefined ? {} : { maximumCoordination: Number(input.maximumCoordination) }),
        ...(input.maxPairEvaluations === undefined ? {} : { maxPairEvaluations: optionalNumber(input, 'maxPairEvaluations') }),
        ...(input.maxPeriodicImageCandidates === undefined
          ? {}
          : { maxPeriodicImageCandidates: optionalNumber(input, 'maxPeriodicImageCandidates') }),
      })
      return {
        ok: true,
        tool: localEnvironmentManifest.name,
        summary: `Local-environment analysis ${result.verdict}: ${result.centralAtomCount.toLocaleString()} centers, ${result.totalNeighborImageCount.toLocaleString()} neighbor images, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(localEnvironmentManifest.name, error)
    }
  },
}

export const LOCAL_ENVIRONMENT_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [localEnvironmentTool]
