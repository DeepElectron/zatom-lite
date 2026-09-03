import type { ZatomToolDefinition, ZatomToolManifest, ZatomToolResult } from './contracts'
import {
  AgentModelingRoutingError,
  agentModelingCapabilityRouteChecks,
  composeAgentModelingCapabilityRoute,
  ZATOM_AGENT_MODELING_ROUTING_TOOL,
  ZATOM_AGENT_MODELING_ROUTE_MAX_CANDIDATES,
  ZATOM_AGENT_MODELING_ROUTE_MAX_STAGES,
  type AgentModelingCapabilityRoute,
} from './modeling-routing'
import { objectSchema } from './tool-helpers'

const tagArraySchema = (minimum = 0): Record<string, unknown> => ({
  type: 'array',
  minItems: minimum,
  maxItems: 12,
  uniqueItems: true,
  items: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9-]*$' },
})

const effectsSchema = objectSchema({
  structure: {
    type: 'array', minItems: 1, maxItems: 4, uniqueItems: true,
    items: { enum: ['none', 'read', 'create', 'replace'] },
  },
  workspace: {
    type: 'array', minItems: 1, maxItems: 3, uniqueItems: true,
    items: { enum: ['none', 'read', 'write'] },
  },
  visual: {
    type: 'array', minItems: 1, maxItems: 3, uniqueItems: true,
    items: { enum: ['none', 'read', 'write'] },
  },
})

const stageSchema = objectSchema({
  id: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9_-]*$' },
  objective: { type: 'string', minLength: 1, maxLength: 500 },
  requiredTags: tagArraySchema(1),
  preferredTags: tagArraySchema(),
  excludedTags: tagArraySchema(),
  effects: effectsSchema,
  providerPolicy: {
    enum: ['built-in-only', 'allow-provider', 'require-provider'],
    default: 'allow-provider',
    description: 'For require-provider, the route emits an exact modeling_list_providers query instead of a built-in candidate.',
  },
}, ['id', 'objective', 'requiredTags'])

export interface ModelingRoutingData {
  route: AgentModelingCapabilityRoute
  coveredStageCount: number
  providerDiscoveryStageCount: number
  unresolvedStageCount: number
}

export const modelingRoutingManifest: ZatomToolManifest = {
  name: ZATOM_AGENT_MODELING_ROUTING_TOOL,
  title: 'Route an Agent modeling goal to capabilities',
  version: '1.0.0',
  description: 'Match explicit ordered modeling stages against this connection\'s exact current tool registry. Returns a fingerprinted capability route, deterministic tag-ranked built-in candidates, exact provider queries, and unresolved coverage without executing tools or guessing physical intent from prose.',
  inputSchema: objectSchema({
    goal: {
      type: 'string',
      minLength: 1,
      maxLength: 1000,
      description: 'Human-readable overall goal for the route artifact. Matching uses the explicit stages below, not this prose.',
    },
    maximumCandidatesPerStage: {
      type: 'integer', minimum: 1, maximum: ZATOM_AGENT_MODELING_ROUTE_MAX_CANDIDATES, default: 8,
    },
    stages: {
      type: 'array',
      minItems: 1,
      maxItems: ZATOM_AGENT_MODELING_ROUTE_MAX_STAGES,
      items: stageSchema,
      description: 'Ordered Agent-decomposed physical stages with exact manifest tags, effects, and provider policy.',
    },
  }, ['goal', 'stages']),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['modeling', 'routing', 'capability', 'planning', 'coverage', 'agent'],
}

const modelingRoutingTool: ZatomToolDefinition<ModelingRoutingData> = {
  manifest: modelingRoutingManifest,
  execute: async (input, context): Promise<ZatomToolResult<ModelingRoutingData>> => {
    try {
      const manifests = context.listTools?.()
      if (!manifests) {
        return {
          ok: false,
          tool: modelingRoutingManifest.name,
          summary: 'The current tool registry is unavailable',
          error: {
            code: 'agent_tool_registry_unavailable',
            message: 'Run capability routing through a zatom tool registry so availability and schemas are exact',
          },
        }
      }
      const route = composeAgentModelingCapabilityRoute(input, manifests)
      const coveredStageCount = route.stages.filter((stage) => stage.coverage === 'covered').length
      const providerDiscoveryStageCount = route.stages
        .filter((stage) => stage.coverage === 'provider-query-required').length
      const unresolvedStageCount = route.stages.filter((stage) => stage.coverage === 'unresolved').length
      return {
        ok: true,
        tool: modelingRoutingManifest.name,
        summary: `Routed ${route.stages.length} stages against registry ${route.registryFingerprint}: ${coveredStageCount} covered, ${providerDiscoveryStageCount} require provider discovery, ${unresolvedStageCount} unresolved`,
        data: { route, coveredStageCount, providerDiscoveryStageCount, unresolvedStageCount },
        checks: agentModelingCapabilityRouteChecks(route),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: modelingRoutingManifest.name,
        summary: message,
        error: {
          code: error instanceof AgentModelingRoutingError ? error.code : 'agent_modeling_routing_failed',
          message,
        },
      }
    }
  },
}

export const MODELING_ROUTING_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  modelingRoutingTool,
]
