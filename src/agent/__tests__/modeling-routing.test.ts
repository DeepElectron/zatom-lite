import { assertEqual, assertTrue } from '../../testing/assert'
import type { ZatomToolDefinition } from '../contracts'
import {
  AgentModelingRoutingError,
  composeAgentModelingCapabilityRoute,
  parseAgentModelingCapabilityRoute,
} from '../modeling-routing'
import { MODELING_ROUTING_ZATOM_AGENT_TOOLS } from '../modeling-routing-tools'
import { createZatomAgentToolRegistry, listZatomAgentTools } from '../tools'

function expectRouteError(
  value: unknown,
  code: string,
  manifests = listZatomAgentTools(),
): void {
  let received: unknown = null
  try {
    parseAgentModelingCapabilityRoute(value, manifests)
  } catch (error) {
    received = error
  }
  assertTrue(received instanceof AgentModelingRoutingError)
  assertEqual((received as AgentModelingRoutingError).code, code)
}

function testCanonicalCapabilityRoute(): void {
  const request = {
    goal: 'Build and inspect an adsorbate on a periodic slab, then use a specialist relaxation provider.',
    maximumCandidatesPerStage: 6,
    stages: [
      {
        id: 'slab',
        objective: 'Construct a Miller slab candidate.',
        requiredTags: ['surface', 'slab'],
        providerPolicy: 'built-in-only',
      },
      {
        id: 'adsorption',
        objective: 'Enumerate adsorption configurations before selecting one.',
        requiredTags: ['surface', 'adsorption'],
        preferredTags: ['configuration-search'],
        providerPolicy: 'built-in-only',
      },
      {
        id: 'relax',
        objective: 'Discover a specialist relaxation capability.',
        requiredTags: ['relaxation'],
        providerPolicy: 'require-provider',
      },
      {
        id: 'unsupported',
        objective: 'Expose a deliberately unavailable built-in capability.',
        requiredTags: ['quantum-gravity'],
        providerPolicy: 'built-in-only',
      },
    ],
  }
  const manifests = listZatomAgentTools()
  const route = composeAgentModelingCapabilityRoute(request, manifests)
  assertTrue(route.fingerprint.startsWith('fnv1a64:'))
  assertTrue(route.registryFingerprint.startsWith('fnv1a64:'))
  assertEqual(route.stages[0]?.coverage, 'covered')
  assertEqual(route.stages[0]?.candidates[0]?.tool, 'structure_build_miller_slab')
  assertEqual(route.stages[1]?.candidates[0]?.tool, 'surface_enumerate_adsorbate_configurations')
  assertEqual(route.stages[2]?.coverage, 'provider-query-required')
  assertEqual(route.stages[2]?.providerQuery?.tool, 'modeling_list_providers')
  assertEqual(route.stages[2]?.providerQuery?.arguments.tags[0], 'relaxation')
  assertEqual(route.stages[3]?.coverage, 'unresolved')
  assertEqual(route.stages[3]?.unknownBuiltInTags[0], 'quantum-gravity')
  assertEqual(parseAgentModelingCapabilityRoute(route, manifests).fingerprint, route.fingerprint)

  const changedRegistry = manifests.map((manifest, index) => index === 0
    ? { ...manifest, version: `${manifest.version}-changed` }
    : manifest)
  expectRouteError(route, 'agent_modeling_capability_route_mismatch', changedRegistry)

  const tampered = {
    ...route,
    stages: route.stages.map((stage, index) => index === 0
      ? { ...stage, matchedCandidateCount: stage.matchedCandidateCount + 1 }
      : stage),
  }
  expectRouteError(tampered, 'agent_modeling_capability_route_mismatch')

  const cyclic: Record<string, unknown> = { ...route }
  cyclic.route = cyclic
  expectRouteError(cyclic, 'invalid_agent_modeling_capability_route')
}

async function testRoutingToolUsesExactRegistry(): Promise<void> {
  const registry = createZatomAgentToolRegistry(MODELING_ROUTING_ZATOM_AGENT_TOOLS)
  const fixtures: ZatomToolDefinition[] = [
    {
      manifest: {
        name: 'fixture_surface_detect',
        title: 'Detect fixture sites',
        version: '1.0.0',
        description: 'Fixture detector.',
        inputSchema: { type: 'object', additionalProperties: false },
        effects: { structure: 'read', workspace: 'read', visual: 'none' },
        tags: ['surface', 'adsorption', 'sites'],
      },
      execute: async () => ({ ok: true, tool: 'fixture_surface_detect', summary: 'fixture' }),
    },
    {
      manifest: {
        name: 'fixture_surface_enumerate',
        title: 'Enumerate fixture poses',
        version: '2.0.0',
        description: 'Fixture enumerator.',
        inputSchema: { type: 'object', additionalProperties: false },
        effects: { structure: 'read', workspace: 'read', visual: 'none' },
        tags: ['surface', 'adsorption', 'configuration-search'],
      },
      execute: async () => ({ ok: true, tool: 'fixture_surface_enumerate', summary: 'fixture' }),
    },
  ]
  fixtures.forEach((fixture) => registry.register(fixture))
  const result = await registry.execute('modeling_route_capabilities', {
    goal: 'Route one fixture adsorption stage.',
    stages: [{
      id: 'adsorption',
      objective: 'Prefer enumeration.',
      requiredTags: ['surface', 'adsorption'],
      preferredTags: ['configuration-search'],
      providerPolicy: 'built-in-only',
    }],
  }, {
    listTools: () => [],
  })
  assertTrue(result.ok, result.summary)
  const data = result.data as {
    route: {
      tools: Array<{ name: string }>
      stages: Array<{ candidates: Array<{ tool: string }> }>
    }
  }
  assertEqual(data.route.tools.length, 2)
  assertEqual(data.route.stages[0]?.candidates[0]?.tool, 'fixture_surface_enumerate')
  assertEqual(data.route.stages[0]?.candidates[1]?.tool, 'fixture_surface_detect')

  registry.register({
    manifest: {
      name: 'modeling_list_providers',
      title: 'Incomplete fixture provider discovery',
      version: '1.0.0',
      description: 'A discovery fixture without the matching provider execution tool.',
      inputSchema: { type: 'object', additionalProperties: false },
      effects: { structure: 'none', workspace: 'none', visual: 'none' },
      tags: ['provider', 'discovery'],
    },
    execute: async () => ({ ok: true, tool: 'modeling_list_providers', summary: 'fixture' }),
  })
  const unavailableProvider = await registry.execute('modeling_route_capabilities', {
    goal: 'Reject an incomplete provider broker without an execution tool.',
    stages: [{
      id: 'provider',
      objective: 'Require provider discovery.',
      requiredTags: ['relaxation'],
      providerPolicy: 'require-provider',
    }],
  })
  assertEqual((unavailableProvider.data as { unresolvedStageCount: number }).unresolvedStageCount, 1)
}

async function main(): Promise<void> {
  testCanonicalCapabilityRoute()
  await testRoutingToolUsesExactRegistry()
  console.log('agent modeling capability routing tests passed')
}

void main()
