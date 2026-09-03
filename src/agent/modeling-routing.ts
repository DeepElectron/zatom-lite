import type { ValidationCheck, ZatomToolManifest } from './contracts'
import { compareCanonicalText, fingerprintCanonicalJson } from './structure-math'

export const ZATOM_AGENT_MODELING_ROUTING_TOOL = 'modeling_route_capabilities' as const
export const ZATOM_AGENT_MODELING_CAPABILITY_ROUTE_SCHEMA = 'zatom.agent-modeling-capability-route/v1' as const
export const ZATOM_AGENT_MODELING_ROUTE_MAX_STAGES = 12
export const ZATOM_AGENT_MODELING_ROUTE_MAX_CANDIDATES = 12
export const ZATOM_AGENT_MODELING_ROUTE_MAX_BYTES = 256 * 1024

export const ZATOM_AGENT_MODELING_PLAN_META_TOOLS = [
  ZATOM_AGENT_MODELING_ROUTING_TOOL,
  'modeling_validate_plan',
] as const

const ROUTING_EXCLUDED_TOOLS = new Set<string>([
  ...ZATOM_AGENT_MODELING_PLAN_META_TOOLS,
  'modeling_list_providers',
  'modeling_run_provider',
])

type StructureEffect = ZatomToolManifest['effects']['structure']
type WorkspaceEffect = ZatomToolManifest['effects']['workspace']
type VisualEffect = ZatomToolManifest['effects']['visual']

export type AgentModelingProviderPolicy = 'built-in-only' | 'allow-provider' | 'require-provider'
export type AgentModelingRouteCoverage = 'covered' | 'provider-query-required' | 'unresolved'

export interface AgentModelingEffectSelector {
  structure: StructureEffect[] | null
  workspace: WorkspaceEffect[] | null
  visual: VisualEffect[] | null
}

export interface AgentModelingRoutingStageRequest {
  id: string
  objective: string
  requiredTags: string[]
  preferredTags: string[]
  excludedTags: string[]
  effects: AgentModelingEffectSelector
  providerPolicy: AgentModelingProviderPolicy
}

export interface AgentModelingRoutingRequest {
  goal: string
  maximumCandidatesPerStage: number
  stages: AgentModelingRoutingStageRequest[]
}

export interface AgentModelingRouteToolSummary {
  name: string
  title: string
  version: string
  description: string
  tags: string[]
  effects: ZatomToolManifest['effects']
}

export interface AgentModelingRouteCandidate {
  tool: string
  matchedPreferredTags: string[]
  missingPreferredTags: string[]
}

export interface AgentModelingRouteProviderQuery {
  tool: 'modeling_list_providers'
  arguments: {
    tags: string[]
    includeSchemas: true
    offset: 0
    limit: 100
  }
}

export interface AgentModelingCapabilityRouteStage {
  id: string
  coverage: AgentModelingRouteCoverage
  unknownBuiltInTags: string[]
  matchedCandidateCount: number
  candidates: AgentModelingRouteCandidate[]
  candidatesTruncated: boolean
  providerDiscovery: 'none' | 'optional' | 'required'
  providerQuery: AgentModelingRouteProviderQuery | null
}

export interface AgentModelingCapabilityRoute {
  schemaVersion: typeof ZATOM_AGENT_MODELING_CAPABILITY_ROUTE_SCHEMA
  fingerprint: string
  registryFingerprint: string
  request: AgentModelingRoutingRequest
  tagCatalog: Array<{ tag: string; toolCount: number }>
  tools: AgentModelingRouteToolSummary[]
  stages: AgentModelingCapabilityRouteStage[]
}

export class AgentModelingRoutingError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AgentModelingRoutingError'
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
  code = 'invalid_agent_modeling_routing_request',
): void {
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).filter((key) => !allowedSet.has(key)).sort()
  if (unsupported.length) {
    throw new AgentModelingRoutingError(
      code,
      `${field} contains unsupported fields: ${unsupported.join(', ')}`,
    )
  }
}

function assertBoundedRouteJson(value: unknown): void {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: 'route', depth: 0 }]
  const seen = new Set<object>()
  let visited = 0
  while (pending.length) {
    const current = pending.pop()!
    if (++visited > 20_000 || current.depth > 16) {
      throw new AgentModelingRoutingError(
        'agent_modeling_route_too_large',
        'Capability route exceeds the JSON complexity budget',
      )
    }
    if (current.value === null || typeof current.value === 'string' || typeof current.value === 'boolean') continue
    if (typeof current.value === 'number') {
      if (Number.isFinite(current.value)) continue
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_capability_route',
        `${current.path} must be finite`,
      )
    }
    if (!current.value || typeof current.value !== 'object') {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_capability_route',
        `${current.path} is not JSON-safe`,
      )
    }
    if (seen.has(current.value)) {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_capability_route',
        `${current.path} contains a cycle or repeated object reference`,
      )
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
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes > ZATOM_AGENT_MODELING_ROUTE_MAX_BYTES) {
    throw new AgentModelingRoutingError(
      'agent_modeling_route_too_large',
      `Capability route is ${bytes} bytes; the limit is ${ZATOM_AGENT_MODELING_ROUTE_MAX_BYTES}`,
    )
  }
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_routing_request',
      `${field} must contain 1-${maximum} characters`,
    )
  }
  return value.trim()
}

function tags(value: unknown, field: string, minimum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 12) {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_routing_request',
      `${field} must contain ${minimum}-12 tag tokens`,
    )
  }
  const normalized = value.map((item, index) => {
    const tag = boundedText(item, `${field}[${index}]`, 48)
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_routing_request',
        `${field}[${index}] must be a lowercase tag token`,
      )
    }
    return tag
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_routing_request', `${field} contains duplicates`)
  }
  return normalized
}

function effectValues<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length < 1 || value.length > allowed.length
    || value.some((item) => typeof item !== 'string' || !allowed.includes(item as T))) {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_routing_request',
      `${field} must contain unique values from ${allowed.join(', ')}`,
    )
  }
  const result = value as T[]
  if (new Set(result).size !== result.length) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_routing_request', `${field} contains duplicates`)
  }
  return [...result]
}

function parseEffects(value: unknown, field: string): AgentModelingEffectSelector {
  if (value === undefined) return { structure: null, workspace: null, visual: null }
  if (!isRecord(value)) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_routing_request', `${field} must be an object`)
  }
  requireExactKeys(value, ['structure', 'workspace', 'visual'], field)
  return {
    structure: effectValues(value.structure, `${field}.structure`, ['none', 'read', 'create', 'replace']),
    workspace: effectValues(value.workspace, `${field}.workspace`, ['none', 'read', 'write']),
    visual: effectValues(value.visual, `${field}.visual`, ['none', 'read', 'write']),
  }
}

export function parseAgentModelingRoutingRequest(value: unknown): AgentModelingRoutingRequest {
  if (!isRecord(value)) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_routing_request', 'Routing request must be an object')
  }
  requireExactKeys(value, ['goal', 'maximumCandidatesPerStage', 'stages'], 'request')
  const goal = boundedText(value.goal, 'request.goal', 1_000)
  const maximumCandidatesPerStage = value.maximumCandidatesPerStage === undefined
    ? 8
    : Number(value.maximumCandidatesPerStage)
  if (!Number.isInteger(maximumCandidatesPerStage)
    || maximumCandidatesPerStage < 1
    || maximumCandidatesPerStage > ZATOM_AGENT_MODELING_ROUTE_MAX_CANDIDATES) {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_routing_request',
      `request.maximumCandidatesPerStage must be 1-${ZATOM_AGENT_MODELING_ROUTE_MAX_CANDIDATES}`,
    )
  }
  if (!Array.isArray(value.stages) || value.stages.length < 1
    || value.stages.length > ZATOM_AGENT_MODELING_ROUTE_MAX_STAGES) {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_routing_request',
      `request.stages must contain 1-${ZATOM_AGENT_MODELING_ROUTE_MAX_STAGES} stages`,
    )
  }
  const stageIds = new Set<string>()
  const stages = value.stages.map((rawStage, index): AgentModelingRoutingStageRequest => {
    const field = `request.stages[${index}]`
    if (!isRecord(rawStage)) {
      throw new AgentModelingRoutingError('invalid_agent_modeling_routing_request', `${field} must be an object`)
    }
    requireExactKeys(rawStage, [
      'id', 'objective', 'requiredTags', 'preferredTags', 'excludedTags', 'effects', 'providerPolicy',
    ], field)
    const id = boundedText(rawStage.id, `${field}.id`, 48)
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || stageIds.has(id)) {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_routing_request',
        `${field}.id must be a unique lowercase stage token`,
      )
    }
    stageIds.add(id)
    const requiredTags = tags(rawStage.requiredTags, `${field}.requiredTags`, 1)
    const preferredTags = tags(rawStage.preferredTags ?? [], `${field}.preferredTags`, 0)
    const excludedTags = tags(rawStage.excludedTags ?? [], `${field}.excludedTags`, 0)
    const overlap = [...new Set([
      ...requiredTags.filter((tag) => preferredTags.includes(tag) || excludedTags.includes(tag)),
      ...preferredTags.filter((tag) => excludedTags.includes(tag)),
    ])].sort()
    if (overlap.length) {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_routing_request',
        `${field} repeats tags across required, preferred, or excluded sets: ${overlap.join(', ')}`,
      )
    }
    const providerPolicy = rawStage.providerPolicy ?? 'allow-provider'
    if (!['built-in-only', 'allow-provider', 'require-provider'].includes(String(providerPolicy))) {
      throw new AgentModelingRoutingError(
        'invalid_agent_modeling_routing_request',
        `${field}.providerPolicy is invalid`,
      )
    }
    return {
      id,
      objective: boundedText(rawStage.objective, `${field}.objective`, 500),
      requiredTags,
      preferredTags,
      excludedTags,
      effects: parseEffects(rawStage.effects, `${field}.effects`),
      providerPolicy: providerPolicy as AgentModelingProviderPolicy,
    }
  })
  return { goal, maximumCandidatesPerStage, stages }
}

function registryFingerprint(manifests: readonly ZatomToolManifest[]): string {
  const canonical = [...manifests]
    .sort((left, right) => compareCanonicalText(left.name, right.name))
    .map((manifest) => ({
      name: manifest.name,
      title: manifest.title,
      version: manifest.version,
      description: manifest.description,
      inputSchema: manifest.inputSchema,
      outputSchema: manifest.outputSchema ?? null,
      effects: manifest.effects,
      tags: [...manifest.tags],
    }))
  return fingerprintCanonicalJson(canonical)
}

function matchesEffects(manifest: ZatomToolManifest, selector: AgentModelingEffectSelector): boolean {
  return (!selector.structure || selector.structure.includes(manifest.effects.structure))
    && (!selector.workspace || selector.workspace.includes(manifest.effects.workspace))
    && (!selector.visual || selector.visual.includes(manifest.effects.visual))
}

function toolSummary(manifest: ZatomToolManifest): AgentModelingRouteToolSummary {
  return {
    name: manifest.name,
    title: manifest.title,
    version: manifest.version,
    description: manifest.description,
    tags: [...manifest.tags],
    effects: { ...manifest.effects },
  }
}

export function composeAgentModelingCapabilityRoute(
  requestValue: unknown,
  manifests: readonly ZatomToolManifest[],
): AgentModelingCapabilityRoute {
  const request = parseAgentModelingRoutingRequest(requestValue)
  const names = manifests.map((manifest) => manifest.name)
  if (new Set(names).size !== names.length) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_route_registry', 'Tool registry contains duplicate names')
  }
  const eligible = manifests.filter((manifest) => !ROUTING_EXCLUDED_TOOLS.has(manifest.name))
  const tagCounts = new Map<string, number>()
  for (const manifest of eligible) {
    for (const tag of new Set(manifest.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const catalogByName = new Map(eligible.map((manifest) => [manifest.name, manifest]))
  const providerBrokerAvailable = ['modeling_list_providers', 'modeling_run_provider']
    .every((name) => manifests.some((manifest) => manifest.name === name))
  const returnedToolNames = new Set<string>()
  const stages = request.stages.map((stage): AgentModelingCapabilityRouteStage => {
    const providerRequired = stage.providerPolicy === 'require-provider'
    const matches = providerRequired ? [] : eligible
      .filter((manifest) => (
        stage.requiredTags.every((tag) => manifest.tags.includes(tag))
        && stage.excludedTags.every((tag) => !manifest.tags.includes(tag))
        && matchesEffects(manifest, stage.effects)
      ))
      .map((manifest) => ({
        manifest,
        matchedPreferredTags: stage.preferredTags.filter((tag) => manifest.tags.includes(tag)),
        missingPreferredTags: stage.preferredTags.filter((tag) => !manifest.tags.includes(tag)),
      }))
      .sort((left, right) => (
        right.matchedPreferredTags.length - left.matchedPreferredTags.length
        || left.missingPreferredTags.length - right.missingPreferredTags.length
        || compareCanonicalText(left.manifest.name, right.manifest.name)
      ))
    const candidates = matches.slice(0, request.maximumCandidatesPerStage).map((match) => {
      returnedToolNames.add(match.manifest.name)
      return {
        tool: match.manifest.name,
        matchedPreferredTags: match.matchedPreferredTags,
        missingPreferredTags: match.missingPreferredTags,
      }
    })
    const providerDiscovery = stage.providerPolicy === 'built-in-only' || !providerBrokerAvailable
      ? 'none' as const
      : stage.providerPolicy === 'require-provider' || !matches.length ? 'required' as const : 'optional' as const
    const coverage: AgentModelingRouteCoverage = matches.length
      ? 'covered'
      : providerDiscovery === 'required' ? 'provider-query-required' : 'unresolved'
    return {
      id: stage.id,
      coverage,
      unknownBuiltInTags: stage.requiredTags.filter((tag) => !tagCounts.has(tag)),
      matchedCandidateCount: matches.length,
      candidates,
      candidatesTruncated: matches.length > candidates.length,
      providerDiscovery,
      providerQuery: providerDiscovery === 'none' ? null : {
        tool: 'modeling_list_providers',
        arguments: {
          tags: [...stage.requiredTags],
          includeSchemas: true,
          offset: 0,
          limit: 100,
        },
      },
    }
  })
  const payload = {
    schemaVersion: ZATOM_AGENT_MODELING_CAPABILITY_ROUTE_SCHEMA,
    registryFingerprint: registryFingerprint(manifests),
    request,
    tagCatalog: [...tagCounts.entries()]
      .sort(([left], [right]) => compareCanonicalText(left, right))
      .map(([tag, toolCount]) => ({ tag, toolCount })),
    tools: [...returnedToolNames]
      .sort(compareCanonicalText)
      .map((name) => toolSummary(catalogByName.get(name)!)),
    stages,
  }
  const route = { ...payload, fingerprint: fingerprintCanonicalJson(payload) }
  const bytes = new TextEncoder().encode(JSON.stringify(route)).byteLength
  if (bytes > ZATOM_AGENT_MODELING_ROUTE_MAX_BYTES) {
    throw new AgentModelingRoutingError(
      'agent_modeling_route_too_large',
      `Capability route is ${bytes} bytes; the limit is ${ZATOM_AGENT_MODELING_ROUTE_MAX_BYTES}`,
    )
  }
  return route
}

export function parseAgentModelingCapabilityRoute(
  value: unknown,
  manifests: readonly ZatomToolManifest[],
): AgentModelingCapabilityRoute {
  if (!isRecord(value)) {
    throw new AgentModelingRoutingError('invalid_agent_modeling_capability_route', 'Capability route must be an object')
  }
  assertBoundedRouteJson(value)
  requireExactKeys(value, [
    'schemaVersion', 'fingerprint', 'registryFingerprint', 'request', 'tagCatalog', 'tools', 'stages',
  ], 'route', 'invalid_agent_modeling_capability_route')
  if (value.schemaVersion !== ZATOM_AGENT_MODELING_CAPABILITY_ROUTE_SCHEMA
    || typeof value.fingerprint !== 'string') {
    throw new AgentModelingRoutingError(
      'invalid_agent_modeling_capability_route',
      `Capability route must use ${ZATOM_AGENT_MODELING_CAPABILITY_ROUTE_SCHEMA}`,
    )
  }
  const expected = composeAgentModelingCapabilityRoute(value.request, manifests)
  if (fingerprintCanonicalJson(value) !== fingerprintCanonicalJson(expected)) {
    throw new AgentModelingRoutingError(
      'agent_modeling_capability_route_mismatch',
      'Capability route does not replay from its embedded request and exact current registry',
    )
  }
  return expected
}

export function agentModelingCapabilityRouteChecks(
  route: AgentModelingCapabilityRoute,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [{
    id: 'modeling_route.registry_binding',
    status: 'pass',
    message: `Route is bound to exact registry ${route.registryFingerprint}`,
    metrics: {
      registryFingerprint: route.registryFingerprint,
      availableTagCount: route.tagCatalog.length,
      returnedToolCount: route.tools.length,
    },
  }]
  for (const stage of route.stages) {
    checks.push({
      id: `modeling_route.stage.${stage.id}`,
      status: stage.coverage === 'covered' ? 'pass'
        : stage.coverage === 'provider-query-required' ? 'warn' : 'fail',
      message: stage.coverage === 'covered'
        ? `Stage ${stage.id} has ${stage.matchedCandidateCount} matching built-in tool${stage.matchedCandidateCount === 1 ? '' : 's'}`
        : stage.coverage === 'provider-query-required'
          ? `Stage ${stage.id} requires exact provider discovery before tool selection`
          : `Stage ${stage.id} has no matching built-in tool or complete provider broker path`,
      metrics: {
        matchedCandidateCount: stage.matchedCandidateCount,
        returnedCandidateCount: stage.candidates.length,
        candidatesTruncated: stage.candidatesTruncated,
        unknownBuiltInTagCount: stage.unknownBuiltInTags.length,
      },
    })
  }
  return checks
}
