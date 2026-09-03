import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomToolDefinition, ZatomToolManifest } from '../contracts'
import {
  AgentModelingPlanError,
  parseAgentModelingPlan,
  ZATOM_AGENT_MODELING_PLAN_SCHEMA,
} from '../modeling-plan'
import { MODELING_PLAN_ZATOM_AGENT_TOOLS } from '../modeling-plan-tools'
import { composeAgentModelingCapabilityRoute } from '../modeling-routing'
import { createZatomAgentToolRegistry, listZatomAgentTools } from '../tools'

function expectPlanError(value: unknown, code: string, manifests = listZatomAgentTools()): void {
  let received: unknown = null
  try {
    parseAgentModelingPlan(value, manifests)
  } catch (error) {
    received = error
  }
  assertTrue(received instanceof AgentModelingPlanError)
  assertEqual((received as AgentModelingPlanError).code, code)
}

function builtInDraft(manifests = listZatomAgentTools()) {
  const goal = 'Validate the active structure, then measure one exact bond.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [
      {
        id: 'validate',
        objective: 'Validate the active atomic positions.',
        requiredTags: ['validation', 'position'],
        providerPolicy: 'built-in-only',
      },
      {
        id: 'measure',
        objective: 'Measure one exact interatomic distance.',
        requiredTags: ['measurement', 'distance'],
        providerPolicy: 'built-in-only',
      },
    ],
  }, manifests)
  return {
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Validate and measure',
    goal,
    routing: {
      route,
      selections: [
        { stageId: 'validate', stepId: 'validate', source: 'built-in' },
        { stageId: 'measure', stepId: 'measure', source: 'built-in' },
      ],
    },
    steps: [
      { id: 'validate', tool: 'structure_validate', input: {} },
      {
        id: 'measure',
        tool: 'structure_measure_geometry',
        input: { measurements: [{ id: 'bond', kind: 'distance', atomIds: ['a', 'b'], periodic: false }] },
      },
    ],
  }
}

function testClosedRouteBoundPlanAdmission(): void {
  const draft = builtInDraft()
  const plan = parseAgentModelingPlan(draft, listZatomAgentTools())
  assertEqual(plan.steps.length, 2)
  assertEqual(plan.routing.route.stages.length, 2)
  assertEqual(plan.routing.selections[1].stepId, 'measure')
  assertTrue(plan.fingerprint.startsWith('fnv1a64:'))
  assertEqual(
    parseAgentModelingPlan({ ...draft, fingerprint: plan.fingerprint }, listZatomAgentTools()).fingerprint,
    plan.fingerprint,
  )
  expectPlanError({ ...draft, fingerprint: 'fnv1a64:changed' }, 'agent_modeling_plan_fingerprint_mismatch')
  expectPlanError({ ...draft, steps: [{ id: 'missing', tool: 'not_a_zatom_tool', input: {} }] }, 'agent_modeling_plan_tool_unavailable')
  expectPlanError({ ...draft, steps: [{ id: 'invalid', tool: 'structure_validate', input: { overlapDistanceA: -1 } }] }, 'invalid_agent_modeling_plan_tool_input')
  expectPlanError({ ...draft, steps: [{ id: 'bypass', tool: 'molecule_create_from_template', input: { template: 'water', applyToWorkspace: true } }] }, 'agent_modeling_plan_review_bypass')
  expectPlanError({ ...draft, steps: [{ id: 'nested', tool: 'modeling_validate_plan', input: { plan: draft } }] }, 'agent_modeling_plan_meta_tool')
  expectPlanError({ ...draft, steps: [{ id: 'route', tool: 'modeling_route_capabilities', input: { goal: draft.goal, stages: [] } }] }, 'agent_modeling_plan_meta_tool')

  expectPlanError({ ...draft, goal: 'A different goal' }, 'agent_modeling_plan_route_goal_mismatch')
  expectPlanError({
    ...draft,
    routing: {
      ...draft.routing,
      selections: [
        { ...draft.routing.selections[0], stageId: 'measure' },
        draft.routing.selections[1],
      ],
    },
  }, 'agent_modeling_plan_route_selection_mismatch')
  expectPlanError({
    ...draft,
    steps: [
      { id: 'validate', tool: 'workspace_get_active_structure', input: {} },
      draft.steps[1],
    ],
  }, 'agent_modeling_plan_route_selection_mismatch')
  expectPlanError({
    ...draft,
    routing: {
      ...draft.routing,
      route: { ...draft.routing.route, registryFingerprint: 'fnv1a64:0000000000000000' },
    },
  }, 'invalid_agent_modeling_plan_route')
}

function testProviderRouteSelectionContract(): void {
  const manifests = listZatomAgentTools()
  const goal = 'Relax the active structure with one discovered local engine.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'relax',
      objective: 'Run a lightweight structural relaxation.',
      requiredTags: ['relaxation'],
      providerPolicy: 'require-provider',
    }],
  }, manifests)
  const draft = {
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Provider relaxation',
    goal,
    routing: {
      route,
      selections: [{ stageId: 'relax', stepId: 'relax', source: 'provider' }],
    },
    steps: [{
      id: 'relax',
      tool: 'modeling_run_provider',
      input: {
        providerId: 'local.example',
        capability: 'structure.relax',
        expectedProviderCapabilityFingerprint: 'fnv1a64:0000000000000000',
        requiredProviderCapabilityTags: ['relaxation'],
        parameters: {},
      },
    }],
  }
  const plan = parseAgentModelingPlan(draft, manifests)
  assertEqual(plan.routing.selections[0].source, 'provider')

  const {
    expectedProviderCapabilityFingerprint: _expectedProviderCapabilityFingerprint,
    ...inputWithoutCapabilityFingerprint
  } = draft.steps[0].input
  expectPlanError({
    ...draft,
    steps: [{ ...draft.steps[0], input: inputWithoutCapabilityFingerprint }],
  }, 'agent_modeling_plan_route_selection_mismatch')
  expectPlanError({
    ...draft,
    steps: [{ ...draft.steps[0], input: { ...draft.steps[0].input, requiredProviderCapabilityTags: ['sqs'] } }],
  }, 'agent_modeling_plan_route_selection_mismatch')
  expectPlanError({
    ...draft,
    routing: { ...draft.routing, selections: [{ ...draft.routing.selections[0], source: 'built-in' }] },
  }, 'agent_modeling_plan_route_selection_mismatch')
}

async function testValidationToolUsesItsExactRegistry(): Promise<void> {
  const registry = createZatomAgentToolRegistry(MODELING_PLAN_ZATOM_AGENT_TOOLS)
  const fixture: ZatomToolDefinition = {
    manifest: {
      name: 'structure_fixture_operation',
      title: 'Fixture structure operation',
      version: '7.0.0',
      description: 'Registry-scoped fixture for Agent plan admission.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['value'],
        properties: { value: { type: 'integer', minimum: 1 } },
      },
      effects: { structure: 'read', workspace: 'read', visual: 'none' },
      tags: ['fixture'],
    },
    execute: async () => ({ ok: true, tool: 'structure_fixture_operation', summary: 'fixture complete' }),
  }
  registry.register(fixture)
  const manifests: ZatomToolManifest[] = registry.list()
  const goal = 'Prove that plan admission uses this isolated registry.'
  const route = composeAgentModelingCapabilityRoute({
    goal,
    stages: [{
      id: 'fixture',
      objective: 'Run the registry-scoped fixture.',
      requiredTags: ['fixture'],
      providerPolicy: 'built-in-only',
    }],
  }, manifests)
  const draft = {
    schemaVersion: ZATOM_AGENT_MODELING_PLAN_SCHEMA,
    title: 'Registry-bound fixture plan',
    goal,
    routing: {
      route,
      selections: [{ stageId: 'fixture', stepId: 'fixture', source: 'built-in' }],
    },
    steps: [{ id: 'fixture', tool: 'structure_fixture_operation', input: { value: 2 } }],
  }
  const result = await registry.execute('modeling_validate_plan', { plan: draft })
  assertTrue(result.ok, result.summary)
  const data = result.data as {
    plan: { fingerprint: string; routing: { route: { fingerprint: string } } }
    availableToolCount: number
    steps: Array<{ tool: string; version: string; routeStageId: string; routeSource: string }>
  }
  assertEqual(data.availableToolCount, 2)
  assertEqual(data.steps[0].tool, fixture.manifest.name)
  assertEqual(data.steps[0].version, fixture.manifest.version)
  assertEqual(data.steps[0].routeStageId, 'fixture')
  assertEqual(data.steps[0].routeSource, 'built-in')
  assertTrue(data.plan.routing.route.fingerprint.startsWith('fnv1a64:'))
  assertTrue(data.plan.fingerprint.startsWith('fnv1a64:'))
  const invalid = await registry.execute('modeling_validate_plan', {
    plan: { ...draft, steps: [{ id: 'fixture', tool: 'structure_fixture_operation', input: { value: 0 } }] },
  })
  assertEqual(invalid.error?.code, 'invalid_agent_modeling_plan_tool_input')
}

async function main(): Promise<void> {
  testClosedRouteBoundPlanAdmission()
  testProviderRouteSelectionContract()
  await testValidationToolUsesItsExactRegistry()
  console.log('agent modeling plan tests passed')
}

void main()
