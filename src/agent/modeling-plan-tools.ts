import type {
  ValidationCheck,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomToolResult,
} from './contracts'
import {
  AgentModelingPlanError,
  parseAgentModelingPlan,
  ZATOM_AGENT_MODELING_PLAN_MAX_BYTES,
  ZATOM_AGENT_MODELING_PLAN_MAX_STEPS,
  ZATOM_AGENT_MODELING_PLAN_SCHEMA,
  ZATOM_AGENT_MODELING_PLAN_VALIDATION_TOOL,
  type AgentModelingPlan,
  type AgentModelingPlanRouteSource,
} from './modeling-plan'
import { objectSchema } from './tool-helpers'

const planStepSchema = objectSchema({
  id: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9_-]*$' },
  tool: { type: 'string', minLength: 2, maxLength: 64, pattern: '^[a-z][a-z0-9_]*$' },
  input: { type: 'object' },
}, ['id', 'tool', 'input'])

const planRouteSelectionSchema = objectSchema({
  stageId: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9_-]*$' },
  stepId: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[a-z][a-z0-9_-]*$' },
  source: { enum: ['built-in', 'provider'] },
}, ['stageId', 'stepId', 'source'])

const planRoutingSchema = objectSchema({
  route: { type: 'object' },
  selections: {
    type: 'array',
    minItems: 1,
    maxItems: ZATOM_AGENT_MODELING_PLAN_MAX_STEPS,
    items: planRouteSelectionSchema,
  },
}, ['route', 'selections'])

const planSchema = objectSchema({
  schemaVersion: { const: ZATOM_AGENT_MODELING_PLAN_SCHEMA },
  title: { type: 'string', minLength: 1, maxLength: 120 },
  goal: { type: 'string', minLength: 1, maxLength: 1000 },
  routing: planRoutingSchema,
  steps: {
    type: 'array',
    minItems: 1,
    maxItems: ZATOM_AGENT_MODELING_PLAN_MAX_STEPS,
    items: planStepSchema,
  },
  fingerprint: { type: 'string', minLength: 1, maxLength: 128 },
}, ['schemaVersion', 'title', 'goal', 'routing', 'steps'])

export interface ModelingPlanValidationData {
  plan: AgentModelingPlan
  bytes: number
  availableToolCount: number
  steps: Array<{
    id: string
    tool: string
    title: string
    version: string
    effects: ZatomToolManifest['effects']
    routeStageId: string
    routeSource: AgentModelingPlanRouteSource
  }>
}

export const modelingPlanValidationManifest: ZatomToolManifest = {
  name: ZATOM_AGENT_MODELING_PLAN_VALIDATION_TOOL,
  title: 'Validate an Agent modeling plan',
  version: '2.0.0',
  description: 'Validate a closed bounded route-bound multi-step plan against this connection\'s exact current zatom tool registry, reject candidate-application bypass fields, and return the canonical fingerprinted plan for browser project import. This tool validates but does not execute the plan.',
  inputSchema: objectSchema({ plan: planSchema }, ['plan']),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['modeling', 'plan', 'validation', 'handoff', 'agent'],
}

const modelingPlanValidationTool: ZatomToolDefinition<ModelingPlanValidationData> = {
  manifest: modelingPlanValidationManifest,
  execute: async (input, context): Promise<ZatomToolResult<ModelingPlanValidationData>> => {
    try {
      const manifests = context.listTools?.()
      if (!manifests) {
        return {
          ok: false,
          tool: modelingPlanValidationManifest.name,
          summary: 'The current tool registry is unavailable',
          error: {
            code: 'agent_tool_registry_unavailable',
            message: 'Run modeling plan validation through a zatom tool registry so availability and schemas are exact',
          },
        }
      }
      const plan = parseAgentModelingPlan(input.plan, manifests)
      const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]))
      const steps = plan.steps.map((step, index) => {
        const manifest = byName.get(step.tool)!
        return {
          id: step.id,
          tool: step.tool,
          title: manifest.title,
          version: manifest.version,
          effects: manifest.effects,
          routeStageId: plan.routing.selections[index].stageId,
          routeSource: plan.routing.selections[index].source,
        }
      })
      const bytes = new TextEncoder().encode(JSON.stringify(plan)).byteLength
      const checks: ValidationCheck[] = [
        {
          id: 'modeling_plan.closed_contract',
          status: 'pass',
          message: `Plan satisfies ${ZATOM_AGENT_MODELING_PLAN_SCHEMA} with ${plan.steps.length} ordered step${plan.steps.length === 1 ? '' : 's'}`,
          metrics: { stepCount: plan.steps.length, bytes, maximumBytes: ZATOM_AGENT_MODELING_PLAN_MAX_BYTES },
        },
        {
          id: 'modeling_plan.route_binding',
          status: 'pass',
          message: `Every plan step selects exactly one ordered stage from route ${plan.routing.route.fingerprint}`,
          metrics: {
            routeFingerprint: plan.routing.route.fingerprint,
            registryFingerprint: plan.routing.route.registryFingerprint,
            stageCount: plan.routing.route.stages.length,
          },
        },
        {
          id: 'modeling_plan.registry_binding',
          status: 'pass',
          message: `Every step matches the exact current registry of ${manifests.length} tools`,
          metrics: { availableToolCount: manifests.length },
        },
        {
          id: 'modeling_plan.review_ownership',
          status: 'pass',
          message: 'No step can bypass candidate application or viewport capture review',
        },
      ]
      return {
        ok: true,
        tool: modelingPlanValidationManifest.name,
        summary: `Validated ${plan.steps.length}-step Agent plan ${plan.fingerprint} for browser project handoff`,
        data: { plan, bytes, availableToolCount: manifests.length, steps },
        checks,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        tool: modelingPlanValidationManifest.name,
        summary: message,
        error: {
          code: error instanceof AgentModelingPlanError ? error.code : 'agent_modeling_plan_validation_failed',
          message,
        },
      }
    }
  },
}

export const MODELING_PLAN_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  modelingPlanValidationTool,
]
