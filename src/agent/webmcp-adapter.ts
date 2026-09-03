/**
 * WebMCP (`document.modelContext`) adapter for the browser build.
 *
 * The browser build's primary agent surface is WebMCP: an in-page agent calls
 * `document.modelContext.getTools()` and reaches zatom with no server, port, or
 * transport.
 *
 * The page exposes a stable, curated core directly and keeps the full registry
 * behind a three-tool facade. Browsers cap the total size of a page's tool
 * descriptors (Chromium: 64 KiB) and exceed it by refusing the whole set, not
 * by trimming. The registry is several times that size, so registering every
 * tool remains impossible; registering only a compact collaboration path lets
 * an agent start useful work without a discovery round trip:
 *
 * - `zatom_domains`        the collaboration workflow and the tool index
 * - `zatom_describe_tools` full description + input schema for named tools
 * - `zatom_call_tool`      run a registry tool with its input
 *
 * Calls go through `callZatomMcpTool`, so in-page WebMCP and the development CLI
 * bridge observe identical content blocks and `structuredContent`, and the host
 * write-mode policy is applied per call by the canonical registry.
 *
 * Domain gating survives as the user's control over the callable surface. Core
 * descriptors stay registered so the agent can see what Zatom can do, while a
 * call in a disabled domain still fails closed. Domain changes therefore never
 * churn the browser's tool snapshot.
 */

import type { JsonValue, ZatomToolContext, ZatomToolManifest, ZatomToolResult } from './contracts'
import { ZATOM_TOOL_DOMAINS, ZATOM_WORKFLOW, resolveZatomToolDomains, zatomToolDomain, zatomToolTier } from './domains'
import { callZatomMcpTool, listZatomMcpTools, type McpToolCallResult, type McpToolDefinition } from './mcp-adapter'
import { activeViewportToolContext } from './viewer-context'

export interface ZatomWebMcpRegistrationOptions {
  /**
   * Domains whose tools may be called. Defaults to the registry's default
   * domains, matching what a fresh MCP connection sees. Unknown names are
   * reported on the handle rather than ignored, so a typo surfaces instead of
   * silently narrowing the surface.
   */
  domains?: readonly string[]
  /** Tool context. Defaults to the active browser viewport. */
  context?: ZatomToolContext
  /**
   * Origins allowed to call these tools, passed through to WebMCP's
   * `exposedTo`. Omitted means same-origin only, per spec default.
   */
  exposedTo?: readonly string[]
  /** Aborting this unregisters the facade. */
  signal?: AbortSignal
  /**
   * Called after every registry tool call made through `zatom_call_tool`.
   * WebMCP has no server process the page could observe, so this is the only
   * place a call becomes visible to the user; the app records it in the Agent
   * Access panel.
   */
  onToolCall?: (call: ZatomWebMcpToolCall) => void
  /** Fired before execution so the UI can show live work rather than only a completed log. */
  onToolCallStart?: (call: ZatomWebMcpToolCallStart) => void
}

export interface ZatomWebMcpToolCallStart {
  id: string
  tool: string
  title: string
  tier: 'read' | 'compute' | 'mutate'
  input: Record<string, unknown>
  workspace: Awaited<ReturnType<NonNullable<ZatomToolContext['workspaceIdentity']>>> | null
  startedAt: number
}

export interface ZatomWebMcpToolCall {
  id: string
  tool: string
  input: Record<string, unknown>
  result: ZatomToolResult
  durationMs: number
}

export interface ZatomWebMcpRegistration {
  /** Core and facade tool names actually registered on the page. */
  readonly registered: readonly string[]
  /** Registry tools callable through `zatom_call_tool`, in registry order. */
  readonly callable: readonly string[]
  /** Domains that were requested but do not exist. */
  readonly unknownDomains: readonly string[]
  /** Domains whose tools are callable. */
  readonly domains: readonly string[]
  /** Updates callable domains without changing the registered descriptors. */
  setDomains(domains?: readonly string[]): void
  /** Unregisters the facade. Idempotent. */
  unregister(): void
}

/** Long-tail discovery and invocation remain available through these three tools. */
export const ZATOM_WEBMCP_FACADE_TOOLS = ['zatom_domains', 'zatom_describe_tools', 'zatom_call_tool'] as const

/**
 * The normal human-collaboration path, visible immediately when an agent joins.
 *
 * Keep this list task-level and stable. It intentionally includes the local
 * asset handoff, spatial observation/pointing, safe proposal flow, surface
 * workflow, verification and recovery. Specialist builders and evidence tools
 * stay behind the facade so this list plus its schemas remains below Chromium's
 * 64 KiB per-document descriptor cap.
 */
export const ZATOM_WEBMCP_CORE_TOOLS = [
  'viewer_observe',
  'scene_observe',
  'scene_resolve_reference',
  'viewport_describe',
  'viewport_activate',
  'viewport_set_layout',
  'viewport_clear_pane',
  'viewer_look_at',
  'viewer_focus_target',
  'guide_set_plan',
  'guide_annotate',
  'guide_present_candidates',
  'guide_focus_candidate',
  'guide_candidate_status',
  'guide_clear',
  'structure_select_atoms',
  'structure_measure_geometry',
  'structure_analyze_local_environment',
  'structure_import_text',
  'assets_list_local_directory',
  'assets_mount_visualization_bundle',
  'structure_propose_operations',
  'structure_proposal_status',
  'structure_cancel_proposal',
  'workspace_undo',
  'structure_check_sanity',
  'surface_prepare_adsorption',
  'structure_place_adsorbate',
  'structure_pose_component',
  'structure_ensure_slab_vacuum',
] as const

/** Stable browser descriptor surface: useful immediately, extensible on demand. */
export const ZATOM_WEBMCP_REGISTERED_TOOLS = [
  ...ZATOM_WEBMCP_CORE_TOOLS,
  ...ZATOM_WEBMCP_FACADE_TOOLS,
] as const

/** Most tools one `zatom_describe_tools` call returns; keeps a single result well under any reader's budget. */
const MAX_DESCRIBE = 12

/**
 * Registry tools that exist for hosts with per-tool registration and mean
 * nothing behind the facade: the facade has its own `zatom_domains`, and the
 * agent cannot enable domains on this host.
 */
const HIDDEN_FROM_FACADE = new Set(['zatom_domains', 'zatom_enable_domains'])
const UNTRUSTED_DIRECT_TOOLS = new Set([
  'assets_list_local_directory',
  'assets_mount_visualization_bundle',
])

/** Single source of truth for the registry tools reachable through the facade. */
export function isZatomWebMcpCallableTool(toolName: string, enabledDomains: ReadonlySet<string>): boolean {
  if (HIDDEN_FROM_FACADE.has(toolName)) return false
  const domain = zatomToolDomain(toolName)
  return domain !== undefined && enabledDomains.has(domain)
}

export function isWebMcpAvailable(doc: Document | undefined = globalThis.document): boolean {
  return typeof doc?.modelContext?.registerTool === 'function'
}

/**
 * Every write axis must be checked. `structure` is easy to miss because its
 * write values are `create`/`replace` rather than `write`, so a `!== 'write'`
 * test silently passes for a tool that rewrites the structure. Mislabelling a
 * writer as read-only is the dangerous direction: the agent takes the hint as
 * licence to retry or speculatively call, turning one edit into several.
 */
export function isReadOnlyTool(tool: { effects: ZatomToolManifest['effects'] }): boolean {
  const { structure, workspace, visual } = tool.effects
  return (
    (structure === 'none' || structure === 'read') && workspace !== 'write' && visual !== 'write'
  )
}

/**
 * Facade results take the same MCP shape as registry results so the agent
 * reads one format: a concise text block plus `structuredContent`.
 */
function facadeResult(tool: string, summary: string, data: unknown): McpToolCallResult {
  const structured: ZatomToolResult = { ok: true, tool, summary, data }
  return { content: [{ type: 'text', text: `OK ${tool}: ${summary}` }], structuredContent: structured }
}

function facadeError(tool: string, code: string, message: string, details?: { [key: string]: JsonValue }): McpToolCallResult {
  const structured: ZatomToolResult = {
    ok: false,
    tool,
    summary: message,
    error: { code, message, ...(details ? { details } : {}) },
  }
  return {
    content: [{ type: 'text', text: `ERROR ${tool}: ${message}\nError code: ${code}` }],
    structuredContent: structured,
    isError: true,
  }
}

interface FacadeState {
  enabled: ReadonlySet<string>
  byName: ReadonlyMap<string, McpToolDefinition>
  context: ZatomToolContext
  onToolCall: ZatomWebMcpRegistrationOptions['onToolCall']
  onToolCallStart: ZatomWebMcpRegistrationOptions['onToolCallStart']
}

const isCallable = (state: FacadeState, name: string): boolean => {
  return isZatomWebMcpCallableTool(name, state.enabled)
}

/**
 * The index. Per domain: enabled state and every tool as `name — title`, so
 * the agent can pick tools to describe without a second round trip for names.
 * Descriptions are deliberately absent here; that is what `zatom_describe_tools`
 * is for, and including them would put the whole registry in one result.
 */
function runDomains(state: FacadeState): McpToolCallResult {
  const domains = ZATOM_TOOL_DOMAINS.map((domain) => ({
    name: domain.name,
    summary: domain.summary,
    enabled: state.enabled.has(domain.name),
    tools: domain.tools
      .filter((name) => !HIDDEN_FROM_FACADE.has(name))
      .map((name) => {
        const tool = state.byName.get(name)
        return { name, title: tool?.title ?? name, readOnly: tool ? isReadOnlyTool(tool) : false }
      }),
  }))
  const enabled = domains.filter((domain) => domain.enabled).map((domain) => domain.name)
  return facadeResult(
    'zatom_domains',
    `${domains.length} domains; callable: ${enabled.join(', ')}. Core collaboration tools are already registered; use this index for specialist capabilities.`,
    {
      workflow: [...ZATOM_WORKFLOW],
      howToCall:
        'Core collaboration tools are registered individually and should be called directly. For anything else, zatom_describe_tools(names) returns descriptions/schemas and zatom_call_tool(name,input,expectedWorkspace) runs one. Before anything visual or writable, call viewer_observe and copy data.workspace into expectedWorkspace. Disabled domains are enabled by the user in Agent Access → Tools, not by you.',
      domains,
    },
  )
}

function runDescribe(state: FacadeState, input: Record<string, unknown>): McpToolCallResult {
  const raw = input.names
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((name) => typeof name === 'string')) {
    return facadeError('zatom_describe_tools', 'invalid_input', '`names` must be a non-empty array of tool names.')
  }
  const names = [...new Set(raw as string[])]
  if (names.length > MAX_DESCRIBE) {
    return facadeError(
      'zatom_describe_tools',
      'invalid_input',
      `At most ${MAX_DESCRIBE} tools per call; got ${names.length}. Describe the tools you are about to use, not the whole index.`,
    )
  }
  const tools: Array<Record<string, unknown>> = []
  const unknown: string[] = []
  const disabled: string[] = []
  for (const name of names) {
    const tool = state.byName.get(name)
    if (!tool || HIDDEN_FROM_FACADE.has(name)) {
      unknown.push(name)
      continue
    }
    if (!isCallable(state, name)) {
      disabled.push(name)
      continue
    }
    tools.push({
      name: tool.name,
      title: tool.title,
      domain: zatomToolDomain(name),
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnly: isReadOnlyTool(tool),
      effects: tool.effects,
    })
  }
  const notes: string[] = []
  if (unknown.length) notes.push(`unknown: ${unknown.join(', ')}`)
  if (disabled.length) notes.push(`in a disabled domain: ${disabled.join(', ')}`)
  return facadeResult(
    'zatom_describe_tools',
    `${tools.length} of ${names.length} described${notes.length ? ` (${notes.join('; ')})` : ''}.`,
    { tools, unknown, disabled },
  )
}

async function runCall(
  state: FacadeState,
  input: Record<string, unknown>,
  executionSignal: AbortSignal,
  errorSurface = 'zatom_call_tool',
): Promise<McpToolCallResult> {
  const name = input.name
  if (typeof name !== 'string' || name.length === 0) {
    return facadeError(errorSurface, 'invalid_input', '`name` must be a tool name from zatom_domains.')
  }
  const args = input.input
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return facadeError(errorSurface, 'invalid_input', '`input` must be an object matching the tool\'s inputSchema.')
  }
  if (!state.byName.has(name) || HIDDEN_FROM_FACADE.has(name)) {
    return facadeError(errorSurface, 'unknown_tool', `No tool named ${name}. Call zatom_domains for the index.`, { name })
  }
  const domain = zatomToolDomain(name)
  if (domain === undefined) {
    return facadeError(errorSurface, 'unknown_tool', `No callable tool named ${name}. Call zatom_domains for the index.`, { name })
  }
  if (!state.enabled.has(domain)) {
    return facadeError(
      errorSurface,
      'domain_disabled',
      `${name} is in the ${domain} domain, which is not enabled on this page. The user enables domains in Agent Access → Tools.`,
      { name, domain, enabledDomains: [...state.enabled] },
    )
  }
  const toolInput = (args ?? {}) as Record<string, unknown>
  const tool = state.byName.get(name)!
  const schemaProperties = tool.inputSchema.properties as Record<string, unknown> | undefined
  const proposalRefinement = name === 'structure_pose_component' && typeof toolInput.proposalId === 'string'
  const candidateOnly = schemaProperties?.applyToWorkspace !== undefined
    && toolInput.applyToWorkspace !== true
    && !proposalRefinement
  const selectionOnly = name === 'structure_select_atoms' && toolInput.applyToViewportSelection !== true
  const changesVisibleState = !candidateOnly && !selectionOnly && (
    tool.effects.visual === 'write'
    || tool.effects.workspace === 'write'
    || tool.effects.structure === 'create'
    || tool.effects.structure === 'replace'
  )
  const rawExpected = input.expectedWorkspace
  let expectedWorkspace: ZatomToolContext['expectedWorkspace']
  if (rawExpected !== undefined) {
    if (!rawExpected || typeof rawExpected !== 'object' || Array.isArray(rawExpected)) {
      return facadeError(errorSurface, 'invalid_input', '`expectedWorkspace` must be the identity returned by viewer_observe or workspace_get_active_structure.')
    }
    const candidate = rawExpected as Record<string, unknown>
    if (typeof candidate.viewportId !== 'string' || !candidate.viewportId
      || !Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0
      || (candidate.structureFingerprint !== null && typeof candidate.structureFingerprint !== 'string')
      || (candidate.trajectoryFingerprint !== null && typeof candidate.trajectoryFingerprint !== 'string')) {
      return facadeError(errorSurface, 'invalid_input', '`expectedWorkspace` is not a complete viewport identity.')
    }
    expectedWorkspace = {
      viewportId: candidate.viewportId,
      revision: Number(candidate.revision),
      structureFingerprint: candidate.structureFingerprint as string | null,
      trajectoryFingerprint: candidate.trajectoryFingerprint as string | null,
    }
  }
  if (changesVisibleState && !expectedWorkspace) {
    return facadeError(
      errorSurface,
      'expected_workspace_required',
      `${name} changes the shared view or workspace. Call viewer_observe, then pass its data.workspace as expectedWorkspace so a pane switch or user edit fails closed.`,
      { name },
    )
  }
  let workspace: Awaited<ReturnType<NonNullable<ZatomToolContext['workspaceIdentity']>>> | null = null
  if (state.context.workspaceIdentity) {
    try {
      workspace = await state.context.workspaceIdentity()
    } catch {
      workspace = null
    }
  }
  if (expectedWorkspace && (!workspace
    || workspace.viewportId !== expectedWorkspace.viewportId
    || workspace.revision !== expectedWorkspace.revision
    || workspace.structureFingerprint !== expectedWorkspace.structureFingerprint
    || workspace.trajectoryFingerprint !== expectedWorkspace.trajectoryFingerprint)) {
    return facadeError(
      errorSurface,
      'workspace_conflict',
      `${name} was not run because the active viewport changed after the Agent observed it. Re-observe and retry.`,
      { name, expectedWorkspace: expectedWorkspace as unknown as JsonValue, actualWorkspace: workspace as unknown as JsonValue },
    )
  }
  const startedAt = performance.now()
  const id = `webmcp-call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  state.onToolCallStart?.({
    id,
    tool: name,
    title: tool.title ?? name,
    tier: zatomToolTier(name, toolInput),
    input: toolInput,
    workspace,
    startedAt: Date.now(),
  })
  const signal = state.context.signal
    ? AbortSignal.any([state.context.signal, executionSignal])
    : executionSignal
  let result: McpToolCallResult
  try {
    result = await callZatomMcpTool(name, toolInput, {
      ...state.context,
      signal,
      ...(expectedWorkspace ? { expectedWorkspace } : {}),
    })
  } catch (error) {
    result = facadeError(
      name,
      executionSignal.aborted ? 'tool_execution_aborted' : 'tool_execution_failed',
      executionSignal.aborted ? 'Tool execution was cancelled' : (error instanceof Error ? error.message : String(error)),
    )
  }
  state.onToolCall?.({
    id,
    tool: name,
    input: toolInput,
    result: result.structuredContent,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return result
}

const DESCRIPTOR_DOMAINS: Omit<WebMCP.ModelContextTool, 'execute'> = {
  name: 'zatom_domains',
  title: 'zatom: workflow and tool index',
  description:
    'Discover specialist Zatom capabilities beyond the directly registered core tools. Returns the human-collaboration workflow (observe → plan → point → propose → verify) and every registry tool grouped by domain with its enabled state. Safe to call any time.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
}

const DESCRIPTOR_DESCRIBE: Omit<WebMCP.ModelContextTool, 'execute'> = {
  name: 'zatom_describe_tools',
  title: 'zatom: describe tools',
  description:
    `Full description, inputSchema, domain and read-only flag for up to ${MAX_DESCRIBE} named zatom tools. Describe the tools you are about to call; the schema is what zatom_call_tool validates against.`,
  inputSchema: {
    type: 'object',
    properties: {
      names: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_DESCRIBE,
        items: { type: 'string' },
        description: 'Tool names from zatom_domains',
      },
    },
    required: ['names'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
}

const DESCRIPTOR_CALL: Omit<WebMCP.ModelContextTool, 'execute'> = {
  name: 'zatom_call_tool',
  title: 'zatom: call a tool',
  description:
    'Run one zatom tool by name with its input, and return exactly what that tool returns (structuredContent.ok, summary, data, checks, error). Before camera, selection, guidance, layout, proposal or workspace changes, call viewer_observe and pass data.workspace as expectedWorkspace; stale pane/revision calls fail closed. Under propose-only, validated apply requests become ghost proposals for the user and direct mutations are refused. Not read-only in general; check readOnly from zatom_describe_tools before retrying.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Tool name from zatom_domains' },
      input: { type: 'object', description: 'Arguments matching the tool\'s inputSchema', additionalProperties: true },
      expectedWorkspace: {
        type: 'object',
        description: 'Required for anything that changes the view/workspace. Pass data.workspace from viewer_observe.',
        additionalProperties: false,
        properties: {
          viewportId: { type: 'string', minLength: 1 },
          revision: { type: 'integer', minimum: 0 },
          structureFingerprint: { type: ['string', 'null'] },
          trajectoryFingerprint: { type: ['string', 'null'] },
        },
        required: ['viewportId', 'revision', 'structureFingerprint', 'trajectoryFingerprint'],
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { untrustedContentHint: true },
}

const EXPECTED_WORKSPACE_PROPERTY = {
  type: 'object',
  description: 'Required: exact viewer_observe data.workspace.',
  additionalProperties: false,
  properties: {
    viewportId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 0 },
    structureFingerprint: { type: ['string', 'null'] },
    trajectoryFingerprint: { type: ['string', 'null'] },
  },
  required: ['viewportId', 'revision', 'structureFingerprint', 'trajectoryFingerprint'],
} as const

/**
 * Native WebMCP tools collaborate with the human in the currently active
 * viewport. Passing a detached structure through a direct descriptor is both
 * surprising (nothing on screen necessarily matches it) and expensive: the
 * complete structure schema costs ~1.2 KiB every time it is repeated. The
 * registry/facade path remains the explicit detached-data API.
 *
 * Several live tools also predate the viewport CAS identity and carry their
 * own copy of the same fingerprint. Hide those duplicate fields from WebMCP
 * and derive them from expectedWorkspace at execution time so the Agent has
 * one identity contract and cannot accidentally provide contradictory guards.
 */
const DIRECT_STRUCTURE_FIELD = 'structure'
const DIRECT_FINGERPRINT_FIELDS = new Set([
  'expectedFingerprint',
  'expectedStructureFingerprint',
  'expectedTrajectoryFingerprint',
])

function projectedDirectSchema(tool: McpToolDefinition): Record<string, unknown> {
  const rawProperties = tool.inputSchema.properties
  if (!rawProperties || typeof rawProperties !== 'object' || Array.isArray(rawProperties)) {
    return tool.inputSchema
  }
  const properties = Object.fromEntries(
    Object.entries(rawProperties as Record<string, unknown>).filter(([name]) => (
      name !== DIRECT_STRUCTURE_FIELD && !DIRECT_FINGERPRINT_FIELDS.has(name)
    )),
  )
  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((name) => (
      name !== DIRECT_STRUCTURE_FIELD && !DIRECT_FINGERPRINT_FIELDS.has(String(name))
    ))
    : undefined
  const projected: Record<string, unknown> = { ...tool.inputSchema, properties }
  if (required?.length) projected.required = required
  else if (required) delete projected.required
  return projected
}

function canChangeVisibleState(tool: McpToolDefinition): boolean {
  return tool.effects.visual === 'write'
    || tool.effects.workspace === 'write'
    || tool.effects.structure === 'create'
    || tool.effects.structure === 'replace'
}

/** Add the shared CAS identity without changing the registry tool's own input. */
function directInputSchema(tool: McpToolDefinition): Record<string, unknown> {
  const projected = projectedDirectSchema(tool)
  if (!canChangeVisibleState(tool)) return projected
  const properties = projected.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`zatom: core WebMCP tool ${tool.name} must use an object input schema`)
  }
  return {
    ...projected,
    properties: {
      ...(properties as Record<string, unknown>),
      expectedWorkspace: EXPECTED_WORKSPACE_PROPERTY,
    },
    required: [
      ...(Array.isArray(projected.required) ? projected.required.map(String) : []),
      'expectedWorkspace',
    ],
  }
}

const COMPACT_DIRECT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  viewport_clear_pane: 'Clear one exact visible pane while preserving its slot and layout; the user can restore it from the review card.',
  guide_set_plan: 'Show a 1–8 step viewport plan and caption. Re-call with a later activeIndex as work advances; an index past the end marks it done.',
  guide_annotate: 'Label atom IDs or exact 3D points in the active viewport. Use info, target, or warn; IDs update labels in place and replace clears older labels.',
  guide_present_candidates: 'Show numbered atom/point options. A badge click only focuses; the user explicitly Confirms or Cancels. Wait with guide_candidate_status, then guide_clear before a new set.',
  guide_focus_candidate: 'Focus one numbered candidate from the current set, or pass null to release its temporary focus. This previews; it does not confirm.',
  guide_candidate_status: 'Read or wait up to 30 seconds for one exact candidate set to be confirmed, cancelled, or stale. AbortSignal cancels the wait immediately.',
  guide_clear: 'Clear the plan, caption, annotations, candidates, or all guidance. Clearing candidates ends an abandoned choice without changing the structure.',
  structure_pose_component: 'Pose a component around an anchor toward an atom, point, vector, or surface; optionally roll or translate it. With proposalId and the latest preview guards, update that same ghost without changing the active structure, so the user still applies once.',
}

function directDescription(tool: McpToolDefinition): string {
  const compact = COMPACT_DIRECT_DESCRIPTIONS[tool.name]
  if (compact) return compact
  return tool.description.replace(
    ' Pass expectedFingerprint (from workspace_get_active_structure) so a stale view fails instead of proposing against the wrong structure.',
    '',
  )
}

function registryInputProperties(tool: McpToolDefinition): Readonly<Record<string, unknown>> {
  const properties = tool.inputSchema.properties
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {}
}

function expectedWorkspaceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function prepareDirectInput(
  tool: McpToolDefinition,
  raw: Record<string, unknown>,
  expectedWorkspace: unknown,
): { input: Record<string, unknown> } | { error: McpToolCallResult } {
  const registryProperties = registryInputProperties(tool)
  if (DIRECT_STRUCTURE_FIELD in registryProperties && DIRECT_STRUCTURE_FIELD in raw) {
    return {
      error: facadeError(
        tool.name,
        'direct_live_viewport_only',
        `${tool.name} is a live-viewport WebMCP tool. Omit structure to use the active viewport, or use zatom_call_tool for an explicit detached structure.`,
        { name: tool.name },
      ),
    }
  }

  const input = { ...raw }
  for (const field of DIRECT_FINGERPRINT_FIELDS) delete input[field]
  const workspace = expectedWorkspaceRecord(expectedWorkspace)
  const structureFingerprint = workspace?.structureFingerprint
  const trajectoryFingerprint = workspace?.trajectoryFingerprint
  if ('expectedFingerprint' in registryProperties && typeof structureFingerprint === 'string') {
    input.expectedFingerprint = structureFingerprint
  }
  if ('expectedStructureFingerprint' in registryProperties && typeof structureFingerprint === 'string') {
    input.expectedStructureFingerprint = structureFingerprint
  }
  if ('expectedTrajectoryFingerprint' in registryProperties && typeof trajectoryFingerprint === 'string') {
    input.expectedTrajectoryFingerprint = trajectoryFingerprint
  }
  return { input }
}

function directDescriptor(
  state: FacadeState,
  tool: McpToolDefinition,
): Omit<WebMCP.ModelContextTool, 'execute'> & { execute: WebMCP.ModelContextTool['execute'] } {
  return {
    name: tool.name,
    title: tool.title,
    description: directDescription(tool),
    inputSchema: directInputSchema(tool),
    annotations: {
      readOnlyHint: isReadOnlyTool(tool),
      ...(UNTRUSTED_DIRECT_TOOLS.has(tool.name) ? { untrustedContentHint: true } : {}),
    },
    execute: (input, options) => {
      const { expectedWorkspace, ...rawToolInput } = input
      const prepared = prepareDirectInput(tool, rawToolInput, expectedWorkspace)
      if ('error' in prepared) return Promise.resolve(prepared.error)
      return runCall(state, {
        name: tool.name,
        input: prepared.input,
        ...(expectedWorkspace === undefined ? {} : { expectedWorkspace }),
      }, options.signal, tool.name)
    },
  }
}

export async function registerZatomWebMcpTools(
  options: ZatomWebMcpRegistrationOptions = {},
): Promise<ZatomWebMcpRegistration> {
  const doc = globalThis.document
  const candidate = doc?.modelContext
  if (!candidate || typeof candidate.registerTool !== 'function') {
    throw new Error('zatom: WebMCP is unavailable (document.modelContext is missing)')
  }
  const modelContext: WebMCP.ModelContext = candidate

  const { domains, unknown } = resolveZatomToolDomains(options.domains)
  let unknownDomains = unknown
  const all = listZatomMcpTools()
  const state: FacadeState = {
    enabled: new Set(domains),
    byName: new Map(all.map((tool) => [tool.name, tool])),
    context: options.context ?? activeViewportToolContext,
    onToolCall: options.onToolCall,
    onToolCallStart: options.onToolCallStart,
  }

  // One controller per registration: WebMCP unregisters only via AbortSignal.
  // Linking the caller's signal keeps a React effect cleanup or a domain change
  // as a single abort.
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal) {
    if (options.signal.aborted) controller.abort()
    else options.signal.addEventListener('abort', abort, { once: true })
  }

  const registerOptions: WebMCP.ModelContextRegisterToolOptions = {
    signal: controller.signal,
    ...(options.exposedTo ? { exposedTo: [...options.exposedTo] } : {}),
  }
  const registered: string[] = []
  const core = ZATOM_WEBMCP_CORE_TOOLS.map((name) => {
    const tool = state.byName.get(name)
    if (!tool) throw new Error(`zatom: core WebMCP tool ${name} is missing from the registry`)
    return directDescriptor(state, tool)
  })
  const facade: Array<[Omit<WebMCP.ModelContextTool, 'execute'>, WebMCP.ModelContextTool['execute']]> = [
    [DESCRIPTOR_DOMAINS, () => Promise.resolve(runDomains(state))],
    [DESCRIPTOR_DESCRIBE, (input) => Promise.resolve(runDescribe(state, input))],
    [DESCRIPTOR_CALL, (input, options) => runCall(state, input, options.signal)],
  ]
  const registrations: WebMCP.ModelContextTool[] = [
    ...core,
    ...facade.map(([descriptor, execute]) => ({ ...descriptor, execute })),
  ]
  try {
    if (!controller.signal.aborted) {
      // Register in one turn so observers receive one useful snapshot instead
      // of racing sequential await boundaries. Put the direct collaboration
      // path first so a newly attached Agent sees observe/point/confirm before
      // the long-tail facade; a shared abort still rolls back every descriptor
      // if any registration fails.
      await Promise.all(registrations.map((descriptor) => modelContext.registerTool(descriptor, registerOptions)))
      if (!controller.signal.aborted) registered.push(...registrations.map((descriptor) => descriptor.name))
    }
  } catch (cause) {
    options.signal?.removeEventListener('abort', abort)
    controller.abort()
    throw cause
  }

  return {
    registered,
    get callable() {
      return all.filter((tool) => isCallable(state, tool.name)).map((tool) => tool.name)
    },
    get unknownDomains() {
      return unknownDomains
    },
    get domains() {
      return [...state.enabled]
    },
    setDomains: (requested) => {
      const resolved = resolveZatomToolDomains(requested)
      state.enabled = new Set(resolved.domains)
      unknownDomains = resolved.unknown
    },
    unregister: () => {
      options.signal?.removeEventListener('abort', abort)
      controller.abort()
    },
  }
}
