import type { JsonValue, ZatomToolManifest } from './contracts'
import { compileZatomJsonSchema, formatZatomJsonSchemaErrors } from './json-schema'
import {
  AgentModelingRoutingError,
  parseAgentModelingCapabilityRoute,
  ZATOM_AGENT_MODELING_PLAN_META_TOOLS,
  type AgentModelingCapabilityRoute,
} from './modeling-routing'
import { fingerprintCanonicalJson } from './structure-math'

export const ZATOM_AGENT_MODELING_PLAN_SCHEMA = 'zatom.agent-modeling-plan/v2' as const
export const ZATOM_AGENT_MODELING_PLAN_MAX_STEPS = 12
export const ZATOM_AGENT_MODELING_PLAN_MAX_BYTES = 256 * 1024
export const ZATOM_AGENT_MODELING_PLAN_VALIDATION_TOOL = 'modeling_validate_plan' as const

export interface AgentModelingPlanStep {
  id: string
  tool: string
  input: Record<string, JsonValue>
}

export type AgentModelingPlanRouteSource = 'built-in' | 'provider'

export interface AgentModelingPlanRouteSelection {
  stageId: string
  stepId: string
  source: AgentModelingPlanRouteSource
}

export interface AgentModelingPlanRouting {
  route: AgentModelingCapabilityRoute
  selections: AgentModelingPlanRouteSelection[]
}

export interface AgentModelingPlan {
  schemaVersion: typeof ZATOM_AGENT_MODELING_PLAN_SCHEMA
  title: string
  goal: string
  routing: AgentModelingPlanRouting
  steps: AgentModelingPlanStep[]
  /** Computed when the plan is admitted. If supplied on import, it must match. */
  fingerprint: string
}

export class AgentModelingPlanError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentModelingPlanError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const allowedSet = new Set(allowed)
  const extra = Object.keys(value).find((key) => !allowedSet.has(key))
  if (extra) {
    throw new AgentModelingPlanError(
      'invalid_agent_modeling_plan',
      `${field} contains unsupported property ${extra}`,
    )
  }
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new AgentModelingPlanError(
      'invalid_agent_modeling_plan',
      `${field} must contain 1-${maximum} characters`,
    )
  }
  return value.trim()
}

function assertJsonSafe(value: unknown, field: string): asserts value is JsonValue {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: field, depth: 0 }]
  const seen = new Set<object>()
  let visited = 0
  while (pending.length) {
    const current = pending.pop()!
    if (++visited > 20_000 || current.depth > 16) {
      throw new AgentModelingPlanError('agent_modeling_plan_too_large', `${field} exceeds the JSON complexity budget`)
    }
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (Number.isFinite(current.value)) continue
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `${current.path} must be finite`)
    }
    if (!current.value || typeof current.value !== 'object') {
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `${current.path} is not JSON-safe`)
    }
    if (seen.has(current.value)) {
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `${current.path} contains a cycle or repeated object reference`)
    }
    seen.add(current.value)
    if (Array.isArray(current.value)) {
      current.value.forEach((nested, index) => pending.push({
        value: nested,
        path: `${current.path}[${index}]`,
        depth: current.depth + 1,
      }))
      continue
    }
    for (const [key, nested] of Object.entries(current.value)) {
      pending.push({ value: nested, path: `${current.path}.${key}`, depth: current.depth + 1 })
    }
  }
}

/**
 * Admit one closed, bounded plan against the exact tool manifests available in
 * this host. Candidate application and capture flags are owned by the task
 * runner, so a plan cannot bypass its review gates.
 */
export function parseAgentModelingPlan(
  value: unknown,
  manifests: readonly ZatomToolManifest[],
): AgentModelingPlan {
  if (!isRecord(value)) {
    throw new AgentModelingPlanError('invalid_agent_modeling_plan', 'Modeling plan must be an object')
  }
  requireExactKeys(value, ['schemaVersion', 'title', 'goal', 'routing', 'steps', 'fingerprint'], 'plan')
  if (value.schemaVersion !== ZATOM_AGENT_MODELING_PLAN_SCHEMA) {
    throw new AgentModelingPlanError(
      'unsupported_agent_modeling_plan_schema',
      `Expected ${ZATOM_AGENT_MODELING_PLAN_SCHEMA}`,
    )
  }
  const title = boundedText(value.title, 'plan.title', 120)
  const goal = boundedText(value.goal, 'plan.goal', 1_000)
  if (!Array.isArray(value.steps)
    || value.steps.length < 1
    || value.steps.length > ZATOM_AGENT_MODELING_PLAN_MAX_STEPS) {
    throw new AgentModelingPlanError(
      'invalid_agent_modeling_plan',
      `plan.steps must contain 1-${ZATOM_AGENT_MODELING_PLAN_MAX_STEPS} steps`,
    )
  }
  const manifestByName = new Map(manifests.map((manifest) => [manifest.name, manifest]))
  if (manifestByName.size !== manifests.length) {
    throw new AgentModelingPlanError('invalid_agent_modeling_plan_registry', 'Tool registry contains duplicate names')
  }
  const ids = new Set<string>()
  const steps = value.steps.map((rawStep, index): AgentModelingPlanStep => {
    const field = `plan.steps[${index}]`
    if (!isRecord(rawStep)) {
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `${field} must be an object`)
    }
    requireExactKeys(rawStep, ['id', 'tool', 'input'], field)
    const id = boundedText(rawStep.id, `${field}.id`, 48)
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) {
      throw new AgentModelingPlanError(
        'invalid_agent_modeling_plan',
        `${field}.id must start with a lowercase letter and contain only lowercase letters, digits, _ or -`,
      )
    }
    if (ids.has(id)) {
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `Duplicate plan step id ${id}`)
    }
    ids.add(id)
    const tool = boundedText(rawStep.tool, `${field}.tool`, 64)
    const manifest = manifestByName.get(tool)
    if (!manifest) {
      throw new AgentModelingPlanError('agent_modeling_plan_tool_unavailable', `${field} references unavailable tool ${tool}`)
    }
    if (ZATOM_AGENT_MODELING_PLAN_META_TOOLS.some((metaTool) => metaTool === tool)) {
      throw new AgentModelingPlanError(
        'agent_modeling_plan_meta_tool',
        `${field} cannot invoke planning meta-tool ${tool}; route and validate the outer plan instead of nesting planning inside execution`,
      )
    }
    if (!isRecord(rawStep.input)) {
      throw new AgentModelingPlanError('invalid_agent_modeling_plan', `${field}.input must be an object`)
    }
    if (Object.prototype.hasOwnProperty.call(rawStep.input, 'applyToWorkspace')
      || Object.prototype.hasOwnProperty.call(rawStep.input, 'captureAfter')) {
      throw new AgentModelingPlanError(
        'agent_modeling_plan_review_bypass',
        `${field}.input cannot set applyToWorkspace or captureAfter; the task runner owns both review gates`,
      )
    }
    assertJsonSafe(rawStep.input, `${field}.input`)
    const validation = compileZatomJsonSchema(manifest.inputSchema)(rawStep.input)
    if (!validation.valid) {
      throw new AgentModelingPlanError(
        'invalid_agent_modeling_plan_tool_input',
        `${field}.input does not match ${tool}: ${formatZatomJsonSchemaErrors(validation.errors)}`,
      )
    }
    return {
      id,
      tool,
      input: JSON.parse(JSON.stringify(rawStep.input)) as Record<string, JsonValue>,
    }
  })
  if (!isRecord(value.routing)) {
    throw new AgentModelingPlanError(
      'invalid_agent_modeling_plan_route',
      'plan.routing must contain the exact capability route and ordered selections',
    )
  }
  requireExactKeys(value.routing, ['route', 'selections'], 'plan.routing')
  let route: AgentModelingCapabilityRoute
  try {
    route = parseAgentModelingCapabilityRoute(value.routing.route, manifests)
  } catch (error) {
    if (error instanceof AgentModelingRoutingError) {
      throw new AgentModelingPlanError(
        'invalid_agent_modeling_plan_route',
        `plan.routing.route is invalid: ${error.message}`,
      )
    }
    throw error
  }
  if (route.request.goal !== goal) {
    throw new AgentModelingPlanError(
      'agent_modeling_plan_route_goal_mismatch',
      'plan.goal must exactly match the embedded route goal',
    )
  }
  if (!Array.isArray(value.routing.selections)
    || value.routing.selections.length !== route.stages.length
    || value.routing.selections.length !== steps.length) {
    throw new AgentModelingPlanError(
      'agent_modeling_plan_route_selection_mismatch',
      'The route, selections, and plan steps must have the same non-zero length',
    )
  }
  const selections = value.routing.selections.map((rawSelection, index): AgentModelingPlanRouteSelection => {
    const field = `plan.routing.selections[${index}]`
    if (!isRecord(rawSelection)) {
      throw new AgentModelingPlanError('agent_modeling_plan_route_selection_mismatch', `${field} must be an object`)
    }
    requireExactKeys(rawSelection, ['stageId', 'stepId', 'source'], field)
    const stageId = boundedText(rawSelection.stageId, `${field}.stageId`, 48)
    const stepId = boundedText(rawSelection.stepId, `${field}.stepId`, 48)
    if (rawSelection.source !== 'built-in' && rawSelection.source !== 'provider') {
      throw new AgentModelingPlanError(
        'agent_modeling_plan_route_selection_mismatch',
        `${field}.source must be built-in or provider`,
      )
    }
    const stage = route.stages[index]
    const step = steps[index]
    if (stageId !== stage.id || stepId !== step.id) {
      throw new AgentModelingPlanError(
        'agent_modeling_plan_route_selection_mismatch',
        `${field} must bind route stage ${stage.id} to plan step ${step.id} in the same order`,
      )
    }
    if (rawSelection.source === 'built-in') {
      if (!stage.candidates.some((candidate) => candidate.tool === step.tool)) {
        throw new AgentModelingPlanError(
          'agent_modeling_plan_route_selection_mismatch',
          `${field} selects ${step.tool}, which is not a returned built-in candidate for stage ${stage.id}`,
        )
      }
    } else {
      const providerId = step.input.providerId
      const capability = step.input.capability
      const expectedFingerprint = step.input.expectedProviderCapabilityFingerprint
      const requiredTags = step.input.requiredProviderCapabilityTags
      const routeTags = stage.providerQuery?.arguments.tags
      if (!stage.providerQuery || step.tool !== 'modeling_run_provider'
        || typeof providerId !== 'string' || !providerId.trim()
        || typeof capability !== 'string' || !capability.trim()
        || typeof expectedFingerprint !== 'string' || !/^fnv1a64:[0-9a-f]{16}$/.test(expectedFingerprint)
        || !Array.isArray(requiredTags)
        || requiredTags.length !== routeTags?.length
        || requiredTags.some((tag, tagIndex) => tag !== routeTags[tagIndex])) {
        throw new AgentModelingPlanError(
          'agent_modeling_plan_route_selection_mismatch',
          `${field} must select modeling_run_provider with one exact discovered capability fingerprint and the route stage's required tags`,
        )
      }
    }
    return { stageId, stepId, source: rawSelection.source }
  })
  const routing: AgentModelingPlanRouting = { route, selections }
  const payload = {
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title,
    goal,
    routing,
    steps,
  }
  const fingerprint = fingerprintCanonicalJson(payload)
  if (value.fingerprint !== undefined && value.fingerprint !== fingerprint) {
    throw new AgentModelingPlanError(
      'agent_modeling_plan_fingerprint_mismatch',
      `Modeling plan fingerprint ${String(value.fingerprint)} does not match ${fingerprint}`,
    )
  }
  const plan = { ...payload, fingerprint }
  const byteLength = new TextEncoder().encode(JSON.stringify(plan)).byteLength
  if (byteLength > ZATOM_AGENT_MODELING_PLAN_MAX_BYTES) {
    throw new AgentModelingPlanError(
      'agent_modeling_plan_too_large',
      `Canonical modeling plan is ${byteLength} bytes; the limit is ${ZATOM_AGENT_MODELING_PLAN_MAX_BYTES}`,
    )
  }
  return plan
}
