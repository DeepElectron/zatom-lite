/**
 * WebMCP (`document.modelContext`) adapter for the browser build.
 *
 * The browser build's primary agent surface is WebMCP: an in-page agent calls
 * `document.modelContext.getTools()` and reaches zatom with no server, port, or
 * transport.
 *
 * The page exposes a curated collaboration core directly and keeps the full
 * registry behind a three-tool facade. Browsers cap the total size of a page's tool
 * descriptors (Chromium: 64 KiB) and exceed it by refusing the whole set, not
 * by trimming. The registry is several times that size, so registering every
 * tool remains impossible; registering only a compact collaboration path lets
 * an agent start useful work without a discovery round trip:
 *
 * - `zatom_domains`        the collaboration workflow and the tool index
 * - `zatom_describe_tools` full description + input schema for named tools
 * - `zatom_call_tool`      run a registry tool with its input
 * - `zatom_request_access` ask the human to expose a disabled domain
 *
 * Calls go through `callZatomMcpTool`, so in-page WebMCP and the development CLI
 * bridge observe identical content blocks and `structuredContent`, and the host
 * write-mode policy is applied per call by the canonical registry.
 *
 * Domain gating controls both discovery and execution. Direct descriptors are
 * attached only while their domain is exposed, and every call still checks the
 * live gate so a stale Agent snapshot fails closed. Stable system tools let the
 * Agent discover the larger surface and request access without a page reload.
 */

import type { JsonValue, ZatomToolContext, ZatomToolManifest, ZatomToolResult } from './contracts'
import { ZATOM_TOOL_DOMAINS, ZATOM_WORKFLOW, resolveZatomToolDomains, zatomToolDomain, zatomToolMutatesWorkspace, zatomToolTier } from './domains'
import { callZatomMcpTool, listZatomMcpTools, type McpToolCallResult, type McpToolDefinition } from './mcp-adapter'
import { canonicalJsonIdentity } from './structure-math'
import { activeViewportToolContext } from './viewer-context'

export interface ZatomWebMcpRegistrationOptions {
  /**
   * Domains whose tools may be called. Defaults to the registry's default
   * domains, matching what a fresh MCP connection sees. An access broker, when
   * supplied, is authoritative instead. Unknown names are
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
  /** Aborting this unregisters the complete page surface. */
  signal?: AbortSignal
  /**
   * Called after every direct or facade-routed registry call, including an
   * early refusal that never reaches the registry.
   * WebMCP has no server process the page could observe, so this is the only
   * place a call becomes visible to the user; the app records it in the Agent
   * Access panel.
   */
  onToolCall?: (call: ZatomWebMcpToolCall) => void
  /** Fired before execution so the UI can show live work rather than only a completed log. */
  onToolCallStart?: (call: ZatomWebMcpToolCallStart) => void
  /** Optional human access broker. When present, it is the authority for exposed domains and call leases. */
  accessBroker?: ZatomWebMcpAccessBroker
  /** Reports the live descriptor surface after initial registration and each completed hot-plug update. */
  onExposureChange?: (registered: readonly string[], domains: readonly string[]) => void
}

export type ZatomWebMcpAccessDecision = 'once' | 'session' | 'always' | 'deny' | 'timeout' | 'cancelled'

export interface ZatomWebMcpAccessLease {
  /** Release the grant after this exact call settles. Idempotence is owned by the broker. */
  release(): void
}

export interface ZatomWebMcpAccessBroker {
  /** Domains currently visible to the Agent. `session` is added defensively by the adapter. */
  getExposedDomains(): readonly string[]
  /** Notify the adapter after exposure changes. */
  subscribe(listener: () => void): () => void
  /** Whether the next one-call lease for this tool is bound to an exact input digest. */
  requiresInputDigest(request: { domain: string; tool: string }): boolean
  /** Acquire access for one real tool call. A null lease denies the call. */
  acquire(request: { domain: string; tool: string; inputDigest?: string; requireOnce?: boolean }): ZatomWebMcpAccessLease | null
  /** Ask the human for access. The broker owns prompting, expiry, and persistence. */
  request(request: {
    domain: string
    tool: string
    reason: string
    inputDigest?: string
    details?: readonly string[]
  }, options?: {
    signal?: AbortSignal
    timeoutMs?: number
    forcePrompt?: boolean
  }): Promise<{ decision: ZatomWebMcpAccessDecision; domain: string }>
}

export interface ZatomWebMcpToolCallStart {
  id: string
  tool: string
  title: string
  tier: 'read' | 'compute' | 'mutate'
  input: Record<string, unknown>
  workspace: Awaited<ReturnType<NonNullable<ZatomToolContext['workspaceIdentity']>>> | null
  startedAt: number
  /** Cancel this exact invocation without revoking the capability. */
  cancel?: () => void
}

export interface ZatomWebMcpToolCall {
  id: string
  tool: string
  input: Record<string, unknown>
  result: ZatomToolResult
  durationMs: number
}

/**
 * WebMCP hosts may omit execute options or supply a signal from another realm.
 * `AbortSignal.any()` rejects either shape, so bridge the minimal EventTarget
 * contract into a local signal and detach listeners when the call settles.
 */
function linkAbortSignals(
  candidates: readonly (AbortSignal | undefined)[],
  shouldAbort: () => boolean = () => true,
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController()
  const removers: Array<() => void> = []
  const abortFrom = (source: AbortSignal) => {
    if (controller.signal.aborted || !shouldAbort()) return
    try {
      controller.abort(source.reason)
    } catch {
      controller.abort()
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate.addEventListener !== 'function') continue
    if (candidate.aborted) {
      abortFrom(candidate)
      continue
    }
    const onAbort = () => abortFrom(candidate)
    candidate.addEventListener('abort', onAbort, { once: true })
    removers.push(() => candidate.removeEventListener('abort', onAbort))
  }

  let disposed = false
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const remove of removers) remove()
    },
  }
}

async function permissionInputDigest(value: unknown): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('This browser cannot bind sensitive access to a SHA-256 input identity')
  const bytes = new TextEncoder().encode(canonicalJsonIdentity(value))
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes))
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function permissionBoundToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  if (!(ZATOM_WEBMCP_CORE_TOOLS as readonly string[]).includes(toolName)) return input
  const normalized = { ...input }
  // Direct descriptors derive these legacy guards from expectedWorkspace.
  // Bind the canonical user input on both request and execution paths so that
  // this adapter-only normalization cannot invalidate an approved ticket.
  for (const field of DIRECT_FINGERPRINT_FIELDS) delete normalized[field]
  return normalized
}

function permissionRequestDetails(
  toolName: string,
  toolInput: Record<string, unknown>,
  expectedWorkspace: ZatomToolContext['expectedWorkspace'] | null,
  inputDigest: string,
): string[] {
  const canonicalBytes = new TextEncoder().encode(canonicalJsonIdentity(toolInput)).byteLength
  const fields = Object.keys(toolInput).sort()
  const details = [
    `Input: ${canonicalBytes.toLocaleString()} bytes${fields.length ? ` · fields ${fields.join(', ')}` : ' · no fields'}`,
  ]
  if (expectedWorkspace) {
    details.push(
      `Viewport: ${expectedWorkspace.viewportId} · r${expectedWorkspace.revision} · ${expectedWorkspace.structureFingerprint ?? 'empty'}`,
    )
  }
  if (toolName === 'compute_prepare_boltz_job') {
    const pipelineId = typeof toolInput.pipelineId === 'string' ? toolInput.pipelineId : 'unknown'
    const request = toolInput.request && typeof toolInput.request === 'object' && !Array.isArray(toolInput.request)
      ? toolInput.request as Record<string, unknown>
      : {}
    const entities = Array.isArray(request.entities)
      ? request.entities.length
      : Array.isArray(request.targetEntities) ? request.targetEntities.length : 0
    const candidates = Array.isArray(request.smiles)
      ? request.smiles.length
      : Array.isArray(request.sequences) ? request.sequences.length : 0
    details.unshift('Destination: configured Boltz service', `Pipeline: ${pipelineId}`)
    if (entities || candidates) {
      details.push(`Scientific payload: ${entities} entit${entities === 1 ? 'y' : 'ies'}${candidates ? ` · ${candidates} candidate${candidates === 1 ? '' : 's'}` : ''}`)
    }
  } else if (toolName.startsWith('assets_')) {
    const relativePath = ['relativePath', 'path', 'fileName']
      .map((key) => toolInput[key])
      .find((value): value is string => typeof value === 'string' && value.length > 0)
    if (relativePath) details.unshift(`Bound-folder file: ${relativePath.slice(0, 160)}`)
  }
  details.push(`Approval binding: ${inputDigest.slice(0, 23)}…`)
  return details.slice(0, 6)
}

export interface ZatomWebMcpRegistration {
  /** Direct, facade, and system tool names actually registered on the page. */
  readonly registered: readonly string[]
  /** Registry tools callable through `zatom_call_tool`, in registry order. */
  readonly callable: readonly string[]
  /** Domains that were requested but do not exist. */
  readonly unknownDomains: readonly string[]
  /** Domains whose tools are callable. */
  readonly domains: readonly string[]
  /** Atomically updates the call gate, then reconciles direct descriptors. */
  setDomains(domains?: readonly string[]): Promise<void>
  /** Unregisters the complete page surface. Idempotent. */
  unregister(): void
}

/** Long-tail discovery and invocation remain available through these three stable tools. */
export const ZATOM_WEBMCP_FACADE_TOOLS = ['zatom_domains', 'zatom_describe_tools', 'zatom_call_tool'] as const

/** Access negotiation remains present even when every optional domain is hidden. */
export const ZATOM_WEBMCP_SYSTEM_TOOLS = ['zatom_request_access'] as const

/**
 * The normal human-collaboration path, visible immediately when an agent joins.
 *
 * Keep this list task-level and curated. It includes spatial observation,
 * pointing, safe proposal flow, surface work, verification, recovery, and the
 * most common view controls. Local files, external providers, specialist
 * builders, and evidence tools stay behind the permission-aware facade.
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
  'viewer_set_view',
  'viewer_focus_target',
  'viewer_get_style',
  'viewer_set_style',
  'viewer_capture',
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
  'structure_propose_operations',
  'structure_proposal_status',
  'structure_cancel_proposal',
  'workspace_undo',
  'workspace_redo',
  'structure_check_sanity',
  'structure_build_miller_slab',
  'surface_prepare_adsorption',
  'structure_place_adsorbate',
  'structure_pose_component',
  'structure_ensure_slab_vacuum',
] as const

/** Complete curated catalog; `registration.registered` is the live domain-filtered subset. */
export const ZATOM_WEBMCP_REGISTERED_TOOLS = [
  ...ZATOM_WEBMCP_CORE_TOOLS,
  ...ZATOM_WEBMCP_FACADE_TOOLS,
  ...ZATOM_WEBMCP_SYSTEM_TOOLS,
] as const

/** Most tools one `zatom_describe_tools` call returns; keeps a single result well under any reader's budget. */
const MAX_DESCRIBE = 12

/**
 * Registry tools that exist for hosts with per-tool registration and mean
 * nothing behind the facade: this host has its own discovery and access tools.
 */
const HIDDEN_FROM_FACADE = new Set(['zatom_domains', 'zatom_enable_domains'])

/** Network-estimate calls need fresh exact-tool consent even if their broad domain is enabled. */
const EXPLICIT_CALL_GRANT_TOOLS: ReadonlySet<string> = new Set([
  'compute_prepare_boltz_job',
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
  globalSignal: AbortSignal
  accessBroker?: ZatomWebMcpAccessBroker
  activeCalls: Map<string, Set<AbortController>>
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
        return {
          name,
          title: tool?.title ?? name,
          readOnly: tool ? isReadOnlyTool(tool) : false,
          requiresOneCallApproval: EXPLICIT_CALL_GRANT_TOOLS.has(name),
        }
      }),
  }))
  const enabled = domains.filter((domain) => domain.enabled).map((domain) => domain.name)
  return facadeResult(
    'zatom_domains',
    `${domains.length} domains; callable: ${enabled.join(', ')}. Core collaboration tools are already registered; use this index for specialist capabilities.`,
    {
      workflow: [...ZATOM_WORKFLOW],
      howToCall:
        'Exposed core collaboration tools are registered individually and should be called directly. For anything else, zatom_describe_tools(names) returns descriptions/schemas and zatom_call_tool(name,input,expectedWorkspace) runs one. Before anything visual or writable, call viewer_observe and copy data.workspace into expectedWorkspace. If a required domain is disabled, call zatom_request_access once with the domain, exact next toolInput, expectedWorkspace when applicable, and a short task-specific reason; never loop on denial.',
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
    const enabled = isCallable(state, name)
    if (!enabled) disabled.push(name)
    tools.push({
      name: tool.name,
      title: tool.title,
      domain: zatomToolDomain(name),
      enabled,
      description: tool.description,
      inputSchema: tool.inputSchema,
      readOnly: isReadOnlyTool(tool),
      requiresOneCallApproval: EXPLICIT_CALL_GRANT_TOOLS.has(name),
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
  executionSignal: AbortSignal | undefined,
  errorSurface = 'zatom_call_tool',
  registrationSignal: AbortSignal = state.globalSignal,
): Promise<McpToolCallResult> {
  const startedAt = performance.now()
  const id = `webmcp-call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const name = input.name
  const rawAuditInput = input.input
  const auditInput = rawAuditInput && typeof rawAuditInput === 'object' && !Array.isArray(rawAuditInput)
    ? rawAuditInput as Record<string, unknown>
    : input
  const auditName = typeof name === 'string' && name.length > 0 ? name : errorSurface
  const finish = (result: McpToolCallResult, completedInput: Record<string, unknown> = auditInput) => {
    state.onToolCall?.({
      id,
      tool: auditName,
      input: completedInput,
      result: result.structuredContent,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return result
  }
  if (typeof name !== 'string' || name.length === 0) {
    return finish(facadeError(errorSurface, 'invalid_input', '`name` must be a tool name from zatom_domains.'))
  }
  const args = input.input
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return finish(facadeError(errorSurface, 'invalid_input', '`input` must be an object matching the tool\'s inputSchema.'))
  }
  if (!state.byName.has(name) || HIDDEN_FROM_FACADE.has(name)) {
    return finish(facadeError(errorSurface, 'unknown_tool', `No tool named ${name}. Call zatom_domains for the index.`, { name }))
  }
  const domain = zatomToolDomain(name)
  if (domain === undefined) {
    return finish(facadeError(errorSurface, 'unknown_tool', `No callable tool named ${name}. Call zatom_domains for the index.`, { name }))
  }
  if (!state.enabled.has(domain)) {
    return finish(facadeError(
      errorSurface,
      'domain_disabled',
      `${name} is in the ${domain} domain, which is not exposed on this page. Call zatom_request_access with this domain and a short reason, or ask the user to enable it in Agent Access.`,
      { name, domain, enabledDomains: [...state.enabled] },
    ))
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
  const mayCommitWorkspace = !candidateOnly && !selectionOnly && (
    zatomToolMutatesWorkspace(name)
    || (toolInput.applyToWorkspace === true
      && (tool.effects.workspace === 'write'
        || tool.effects.structure === 'create'
        || tool.effects.structure === 'replace'))
  )
  const rawExpected = input.expectedWorkspace
  let expectedWorkspace: ZatomToolContext['expectedWorkspace']
  if (rawExpected !== undefined) {
    if (!rawExpected || typeof rawExpected !== 'object' || Array.isArray(rawExpected)) {
      return finish(facadeError(errorSurface, 'invalid_input', '`expectedWorkspace` must be the identity returned by viewer_observe or workspace_get_active_structure.'), toolInput)
    }
    const candidate = rawExpected as Record<string, unknown>
    if (typeof candidate.viewportId !== 'string' || !candidate.viewportId
      || !Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0
      || (candidate.structureFingerprint !== null && typeof candidate.structureFingerprint !== 'string')
      || (candidate.trajectoryFingerprint !== null && typeof candidate.trajectoryFingerprint !== 'string')) {
      return finish(facadeError(errorSurface, 'invalid_input', '`expectedWorkspace` is not a complete viewport identity.'), toolInput)
    }
    expectedWorkspace = {
      viewportId: candidate.viewportId,
      revision: Number(candidate.revision),
      structureFingerprint: candidate.structureFingerprint as string | null,
      trajectoryFingerprint: candidate.trajectoryFingerprint as string | null,
    }
  }
  if (changesVisibleState && !expectedWorkspace) {
    return finish(facadeError(
      errorSurface,
      'expected_workspace_required',
      `${name} changes the shared view or workspace. Call viewer_observe, then pass its data.workspace as expectedWorkspace so a pane switch or user edit fails closed.`,
      { name },
    ), toolInput)
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
    return finish(facadeError(
      errorSurface,
      'workspace_conflict',
      `${name} was not run because the active viewport changed after the Agent observed it. Re-observe and retry.`,
      { name, expectedWorkspace: expectedWorkspace as unknown as JsonValue, actualWorkspace: workspace as unknown as JsonValue },
    ), toolInput)
  }
  let boundInputDigest: string | undefined
  const needsInputDigest = EXPLICIT_CALL_GRANT_TOOLS.has(name)
    || state.accessBroker?.requiresInputDigest({ domain, tool: name }) === true
  if (needsInputDigest) {
    try {
      boundInputDigest = await permissionInputDigest({
        toolInput: permissionBoundToolInput(name, toolInput),
        expectedWorkspace: expectedWorkspace ?? null,
      })
    } catch (error) {
      return finish(facadeError(
        errorSurface,
        'access_binding_unavailable',
        error instanceof Error ? error.message : String(error),
        { name, domain },
      ), toolInput)
    }
  }
  if (state.globalSignal.aborted || registrationSignal.aborted || executionSignal?.aborted || state.context.signal?.aborted) {
    return finish(facadeError(name, 'tool_execution_aborted', 'Tool execution was cancelled before it started.'), toolInput)
  }
  let accessLease: ZatomWebMcpAccessLease | null = null
  if (state.accessBroker) {
    try {
      accessLease = state.accessBroker.acquire({
        domain,
        tool: name,
        ...(boundInputDigest ? { inputDigest: boundInputDigest } : {}),
        ...(EXPLICIT_CALL_GRANT_TOOLS.has(name) ? { requireOnce: true } : {}),
      })
    } catch (error) {
      return finish(facadeError(
        errorSurface,
        'access_broker_failed',
        error instanceof Error ? error.message : String(error),
        { name, domain },
      ), toolInput)
    }
    if (!accessLease) {
      const explicitCallGrant = EXPLICIT_CALL_GRANT_TOOLS.has(name)
      return finish(facadeError(
        errorSurface,
        explicitCallGrant ? 'tool_access_required' : 'domain_disabled',
        explicitCallGrant
          ? `${name} requires a fresh one-call approval because it can send model data to an external service. Call zatom_request_access for this exact tool before retrying.`
          : `${name} is no longer authorized in the ${domain} domain. Call zatom_request_access again before retrying.`,
        { name, domain, enabledDomains: [...state.enabled] },
      ), toolInput)
    }
  }
  const callController = new AbortController()
  const domainCalls = state.activeCalls.get(domain) ?? new Set<AbortController>()
  const hasDeferredCommitBoundary = mayCommitWorkspace
    && toolInput.applyToWorkspace === true
    && Boolean(state.context.writeStructure || state.context.writeTrajectory || state.context.writeWorkspace)
  const cancellableBeforeCommit = !mayCommitWorkspace || hasDeferredCommitBoundary
  if (cancellableBeforeCommit) {
    domainCalls.add(callController)
    state.activeCalls.set(domain, domainCalls)
  }
  let commitStarted = mayCommitWorkspace && !hasDeferredCommitBoundary
  const linkedSignals = linkAbortSignals(cancellableBeforeCommit ? [
    state.globalSignal,
    registrationSignal,
    executionSignal,
    callController.signal,
    ...(state.context.signal ? [state.context.signal] : []),
  ] : [], () => !commitStarted)
  const signal = linkedSignals.signal
  const beginCommit = () => {
    if (signal.aborted) throw new DOMException('Tool execution was cancelled before the workspace commit', 'AbortError')
    commitStarted = true
  }
  const executionContext: ZatomToolContext = hasDeferredCommitBoundary
    ? {
        ...state.context,
        ...(state.context.writeStructure ? {
          writeStructure: async (structure, expected) => state.context.writeStructure!(
            structure,
            expected,
            signal,
            beginCommit,
          ),
        } : {}),
        ...(state.context.writeTrajectory ? {
          writeTrajectory: async (trajectory, expected) => state.context.writeTrajectory!(
            trajectory,
            expected,
            signal,
            beginCommit,
          ),
        } : {}),
        ...(state.context.writeWorkspace ? {
          writeWorkspace: async (structure, trajectory, expected) => state.context.writeWorkspace!(
            structure,
            trajectory,
            expected,
            signal,
            beginCommit,
          ),
        } : {}),
      }
    : state.context
  let result: McpToolCallResult
  try {
    state.onToolCallStart?.({
      id,
      tool: name,
      title: tool.title ?? name,
      tier: zatomToolTier(name, toolInput),
      input: toolInput,
      workspace,
      startedAt: Date.now(),
      ...(cancellableBeforeCommit ? { cancel: () => callController.abort() } : {}),
    })
    try {
      result = await callZatomMcpTool(name, toolInput, {
          ...executionContext,
        signal,
        ...(expectedWorkspace ? { expectedWorkspace } : {}),
      })
    } catch (error) {
      result = facadeError(
        name,
        signal.aborted ? 'tool_execution_aborted' : 'tool_execution_failed',
        signal.aborted ? 'Tool execution was cancelled' : (error instanceof Error ? error.message : String(error)),
      )
    }
  } finally {
    if (cancellableBeforeCommit) {
      domainCalls.delete(callController)
      if (domainCalls.size === 0) state.activeCalls.delete(domain)
    }
    accessLease?.release()
    linkedSignals.dispose()
  }
  return finish(result, toolInput)
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
    `Full description, inputSchema, domain, enabled state and read-only flag for up to ${MAX_DESCRIBE} named zatom tools, including tools awaiting permission. Describe the exact next tools before requesting access; the schema is what zatom_call_tool validates against.`,
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

const DESCRIPTOR_REQUEST_ACCESS: Omit<WebMCP.ModelContextTool, 'execute'> = {
  name: 'zatom_request_access',
  title: 'zatom: request capability access',
  description:
    'Ask the human to expose one Zatom capability without reloading the page. Name the exact next tool, pass its intended toolInput, and give a short task-specific reason. One-call decisions are bound to that tool and input; include expectedWorkspace when the next call uses it. Denial and timeout are normal outcomes.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        enum: ZATOM_TOOL_DOMAINS.map((domain) => domain.name),
        description: 'Capability domain from zatom_domains.',
      },
      tool: {
        type: 'string',
        minLength: 1,
        description: 'Exact next tool. It must belong to the requested domain; one-call grants are bound to it.',
      },
      reason: {
        type: 'string',
        minLength: 1,
        maxLength: 240,
        description: 'Short user-facing explanation of what the capability is needed for.',
      },
      toolInput: {
        type: 'object',
        additionalProperties: true,
        description: 'Exact arguments intended for the next call. One-call approval is bound to these values.',
      },
      expectedWorkspace: {
        type: 'object',
        additionalProperties: false,
        description: 'Exact viewer_observe data.workspace intended for the next call. Required for an external request tied to the shared viewport.',
        properties: {
          viewportId: { type: 'string', minLength: 1 },
          revision: { type: 'integer', minimum: 0 },
          structureFingerprint: { type: ['string', 'null'] },
          trajectoryFingerprint: { type: ['string', 'null'] },
        },
        required: ['viewportId', 'revision', 'structureFingerprint', 'trajectoryFingerprint'],
      },
    },
    required: ['domain', 'tool', 'reason', 'toolInput'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
}

const ACCESS_DECISIONS: ReadonlySet<string> = new Set([
  'once',
  'session',
  'always',
  'deny',
  'timeout',
  'cancelled',
])

function accessWorkspaceIdentity(value: unknown): ZatomToolContext['expectedWorkspace'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.viewportId !== 'string' || !candidate.viewportId
    || !Number.isSafeInteger(candidate.revision) || Number(candidate.revision) < 0
    || (candidate.structureFingerprint !== null && typeof candidate.structureFingerprint !== 'string')
    || (candidate.trajectoryFingerprint !== null && typeof candidate.trajectoryFingerprint !== 'string')) return null
  return {
    viewportId: candidate.viewportId,
    revision: Number(candidate.revision),
    structureFingerprint: candidate.structureFingerprint as string | null,
    trajectoryFingerprint: candidate.trajectoryFingerprint as string | null,
  }
}

async function runAccessRequest(
  state: FacadeState,
  input: Record<string, unknown>,
  executionSignal: AbortSignal | undefined,
  refreshDomains: () => Promise<void>,
): Promise<McpToolCallResult> {
  const startedAt = performance.now()
  const id = `webmcp-call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const callController = new AbortController()
  const linkedSignals = linkAbortSignals([
    state.globalSignal,
    executionSignal,
    callController.signal,
    ...(state.context.signal ? [state.context.signal] : []),
  ])
  const signal = linkedSignals.signal
  state.onToolCallStart?.({
    id,
    tool: 'zatom_request_access',
    title: DESCRIPTOR_REQUEST_ACCESS.title ?? 'Request capability access',
    tier: 'read',
    input,
    workspace: null,
    startedAt: Date.now(),
    cancel: () => callController.abort(),
  })

  const finish = (result: McpToolCallResult): McpToolCallResult => {
    linkedSignals.dispose()
    state.onToolCall?.({
      id,
      tool: 'zatom_request_access',
      input,
      result: result.structuredContent,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return result
  }

  const domain = typeof input.domain === 'string' ? input.domain : ''
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  const tool = typeof input.tool === 'string' && input.tool.length > 0 ? input.tool : undefined
  const domainDefinition = ZATOM_TOOL_DOMAINS.find((candidate) => candidate.name === domain)
  if (!domainDefinition) {
    return finish(facadeError(
      'zatom_request_access',
      'invalid_domain',
      '`domain` must name a capability returned by zatom_domains.',
      { domain },
    ))
  }
  if (!reason || reason.length > 240) {
    return finish(facadeError(
      'zatom_request_access',
      'invalid_input',
      '`reason` must be between 1 and 240 characters.',
      { domain },
    ))
  }
  if (!tool) {
    return finish(facadeError(
      'zatom_request_access',
      'invalid_input',
      '`tool` must name the exact next capability call so an Allow once decision cannot be reused for another tool.',
      { domain },
    ))
  }
  if (!state.byName.has(tool) || zatomToolDomain(tool) !== domain) {
    return finish(facadeError(
      'zatom_request_access',
      'tool_domain_mismatch',
      `${tool} does not belong to the ${domain} domain. Read zatom_domains and request the matching domain.`,
      { domain, tool },
    ))
  }
  const requiresFreshCallGrant = EXPLICIT_CALL_GRANT_TOOLS.has(tool)
  const toolInput = input.toolInput
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return finish(facadeError(
      'zatom_request_access',
      'exact_tool_input_required',
      '`toolInput` must contain the exact arguments intended for the approved call.',
      { domain, tool },
    ))
  }
  const expectedWorkspace = input.expectedWorkspace === undefined
    ? null
    : accessWorkspaceIdentity(input.expectedWorkspace)
  if (input.expectedWorkspace !== undefined && !expectedWorkspace) {
    return finish(facadeError(
      'zatom_request_access',
      'invalid_input',
      '`expectedWorkspace` must be the complete identity returned by viewer_observe.',
      { domain, tool },
    ))
  }
  if (requiresFreshCallGrant && !expectedWorkspace) {
    return finish(facadeError(
      'zatom_request_access',
      'exact_tool_input_required',
      `${tool} sends data externally. Pass viewer_observe data.workspace so approval is bound to this model and request.`,
      { domain, tool },
    ))
  }
  let requestedInputDigest: string
  try {
    requestedInputDigest = await permissionInputDigest({
      toolInput: permissionBoundToolInput(tool, toolInput as Record<string, unknown>),
      expectedWorkspace,
    })
  } catch (error) {
    return finish(facadeError(
      'zatom_request_access',
      'access_binding_unavailable',
      error instanceof Error ? error.message : String(error),
      { domain, tool },
    ))
  }
  if (state.enabled.has(domain) && !requiresFreshCallGrant) {
    return finish(facadeResult(
      'zatom_request_access',
      `${domain} access is already exposed. Call${tool ? ` ${tool}` : ' the required tool'} directly.`,
      { decision: 'already_allowed', domain, ...(tool ? { tool } : {}), exposed: true },
    ))
  }
  if (!state.accessBroker) {
    return finish(facadeError(
      'zatom_request_access',
      'access_request_unavailable',
      'This page has no interactive access broker. Ask the user to enable the domain in Agent Access.',
      { domain, ...(tool ? { tool } : {}) },
    ))
  }
  if (signal.aborted) {
    return finish(facadeResult(
      'zatom_request_access',
      `The ${domain} access request was cancelled.`,
      { decision: 'cancelled', domain, ...(tool ? { tool } : {}), exposed: false },
    ))
  }

  let outcome: { decision: ZatomWebMcpAccessDecision; domain: string }
  try {
    outcome = await state.accessBroker.request(
      {
        domain,
        tool,
        reason,
        inputDigest: requestedInputDigest,
        details: permissionRequestDetails(tool, toolInput as Record<string, unknown>, expectedWorkspace, requestedInputDigest),
      },
      { signal, ...(requiresFreshCallGrant ? { forcePrompt: true } : {}) },
    )
  } catch (error) {
    if (signal.aborted) {
      return finish(facadeResult(
        'zatom_request_access',
        `The ${domain} access request was cancelled.`,
        { decision: 'cancelled', domain, ...(tool ? { tool } : {}), exposed: false },
      ))
    }
    return finish(facadeError(
      'zatom_request_access',
      'access_request_failed',
      error instanceof Error ? error.message : String(error),
      { domain, ...(tool ? { tool } : {}) },
    ))
  }
  if (outcome.domain !== domain || !ACCESS_DECISIONS.has(outcome.decision)) {
    return finish(facadeError(
      'zatom_request_access',
      'invalid_access_decision',
      'The access broker returned an invalid decision.',
      { domain },
    ))
  }
  if (outcome.decision === 'once' || outcome.decision === 'session' || outcome.decision === 'always') {
    try {
      await refreshDomains()
    } catch (error) {
      return finish(facadeError(
        'zatom_request_access',
        'access_exposure_failed',
        error instanceof Error ? error.message : String(error),
        { domain, decision: outcome.decision },
      ))
    }
  }
  const exposed = state.enabled.has(domain)
  const summary = outcome.decision === 'deny'
    ? `The user denied ${domain} access.`
    : outcome.decision === 'timeout'
      ? `The ${domain} access request timed out without a decision.`
      : outcome.decision === 'cancelled'
        ? `The ${domain} access request was cancelled.`
        : `${domain} access was granted for ${outcome.decision === 'once' ? 'one tool call' : outcome.decision === 'session' ? 'this page session' : 'future sessions'}.`
  return finish(facadeResult(
    'zatom_request_access',
    summary,
    { decision: outcome.decision, domain, ...(tool ? { tool } : {}), exposed },
  ))
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

/**
 * These large schemas exceed the browser descriptor budget when every nested
 * field repeats prose. Their tool-level descriptions and all validation
 * constraints remain; smaller direct schemas retain their field descriptions.
 */
const COMPACT_DIRECT_SCHEMA_TOOLS: ReadonlySet<string> = new Set([
  'viewer_set_style',
  'structure_propose_operations',
  'viewer_look_at',
  'structure_ensure_slab_vacuum',
  'scene_resolve_reference',
  'structure_analyze_local_environment',
  'structure_place_adsorbate',
  'surface_prepare_adsorption',
  'structure_import_text',
  'structure_select_atoms',
  'viewer_set_view',
  'viewport_activate',
  'structure_pose_component',
  'structure_build_miller_slab',
])

function compactDirectSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactDirectSchema)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'description')
      .map(([key, child]) => [key, compactDirectSchema(child)]),
  )
}

function finalizeDirectSchema(tool: McpToolDefinition, schema: Record<string, unknown>): Record<string, unknown> {
  return COMPACT_DIRECT_SCHEMA_TOOLS.has(tool.name)
    ? compactDirectSchema(schema) as Record<string, unknown>
    : schema
}

/** Add the shared CAS identity without changing the registry tool's own input. */
function directInputSchema(tool: McpToolDefinition): Record<string, unknown> {
  const projected = projectedDirectSchema(tool)
  if (!canChangeVisibleState(tool)) return finalizeDirectSchema(tool, projected)
  const properties = projected.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`zatom: core WebMCP tool ${tool.name} must use an object input schema`)
  }
  return finalizeDirectSchema(tool, {
    ...projected,
    properties: {
      ...(properties as Record<string, unknown>),
      expectedWorkspace: EXPECTED_WORKSPACE_PROPERTY,
    },
    required: [
      ...(Array.isArray(projected.required) ? projected.required.map(String) : []),
      'expectedWorkspace',
    ],
  })
}

const COMPACT_DIRECT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  assets_mount_visualization_bundle: 'Validate or mount a bound-folder CUBE/Molden bundle as Density, Density+ESP, or four-pane Density/ESP/HOMO/LUMO. Optional periodic marks CUBE-grid boundary axes; mounts use Keep/Revert review.',
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
  registrationSignal: AbortSignal,
): Omit<WebMCP.ModelContextTool, 'execute'> & { execute: WebMCP.ModelContextTool['execute'] } {
  return {
    name: tool.name,
    title: tool.title,
    description: directDescription(tool),
    inputSchema: directInputSchema(tool),
    annotations: {
      readOnlyHint: isReadOnlyTool(tool),
    },
    execute: (input, options) => {
      const { expectedWorkspace, ...rawToolInput } = input
      const prepared = prepareDirectInput(tool, rawToolInput, expectedWorkspace)
      if ('error' in prepared) return Promise.resolve(prepared.error)
      return runCall(state, {
        name: tool.name,
        input: prepared.input,
        ...(expectedWorkspace === undefined ? {} : { expectedWorkspace }),
      }, options?.signal, tool.name, registrationSignal)
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

  const lifecycleController = new AbortController()
  const initialRequestedDomains = options.accessBroker
    ? options.accessBroker.getExposedDomains()
    : options.domains
  const initialDomains = resolveZatomToolDomains(initialRequestedDomains)
  let unknownDomains = initialDomains.unknown
  const all = listZatomMcpTools()
  const state: FacadeState = {
    enabled: new Set(initialDomains.domains),
    byName: new Map(all.map((tool) => [tool.name, tool])),
    context: options.context ?? activeViewportToolContext,
    globalSignal: lifecycleController.signal,
    accessBroker: options.accessBroker,
    activeCalls: new Map(),
    onToolCall: options.onToolCall,
    onToolCallStart: options.onToolCallStart,
  }

  interface DirectRegistration {
    controller: AbortController
    signal: AbortSignal
    domain: string
    active: boolean
  }
  const directRegistrations = new Map<string, DirectRegistration>()
  const stableRegistered = new Set<string>()
  let accessUnsubscribe: (() => void) | undefined
  let unregistered = false
  let domainRevision = 0
  let reconcileTail: Promise<void> = Promise.resolve()

  const registerOptions = (signal: AbortSignal): WebMCP.ModelContextRegisterToolOptions => ({
    signal,
    ...(options.exposedTo ? { exposedTo: [...options.exposedTo] } : {}),
  })

  const registeredNames = (): readonly string[] => {
    if (unregistered || lifecycleController.signal.aborted) return []
    const direct = ZATOM_WEBMCP_CORE_TOOLS.filter((name) => {
      const registration = directRegistrations.get(name)
      return registration?.active === true && !registration.signal.aborted
    })
    const stable = [
      ...ZATOM_WEBMCP_FACADE_TOOLS,
      ...ZATOM_WEBMCP_SYSTEM_TOOLS,
    ].filter((name) => stableRegistered.has(name))
    return [...direct, ...stable]
  }

  const notifyExposureChange = () => {
    try {
      options.onExposureChange?.(registeredNames(), [...state.enabled])
    } catch {
      // A status observer must never roll back an otherwise valid capability update.
    }
  }

  const abortRevokedDomains = () => {
    for (const [domain, controllers] of state.activeCalls) {
      if (state.enabled.has(domain)) continue
      for (const controller of controllers) controller.abort()
    }
    for (const [name, registration] of directRegistrations) {
      if (state.enabled.has(registration.domain)) continue
      registration.active = false
      registration.controller.abort()
      if (directRegistrations.get(name) === registration) directRegistrations.delete(name)
    }
  }

  const registerDirect = async (name: typeof ZATOM_WEBMCP_CORE_TOOLS[number]): Promise<void> => {
    if (unregistered || lifecycleController.signal.aborted) return
    const tool = state.byName.get(name)
    if (!tool) throw new Error(`zatom: core WebMCP tool ${name} is missing from the registry`)
    const domain = zatomToolDomain(name)
    if (!domain) throw new Error(`zatom: core WebMCP tool ${name} has no domain`)
    if (!state.enabled.has(domain)) return
    const existing = directRegistrations.get(name)
    if (existing && !existing.signal.aborted) return

    const controller = new AbortController()
    const signal = AbortSignal.any([lifecycleController.signal, controller.signal])
    const registration: DirectRegistration = { controller, signal, domain, active: false }
    directRegistrations.set(name, registration)
    try {
      await modelContext.registerTool(directDescriptor(state, tool, signal), registerOptions(signal))
      if (unregistered || signal.aborted || !state.enabled.has(domain)) {
        controller.abort()
        if (directRegistrations.get(name) === registration) directRegistrations.delete(name)
        return
      }
      registration.active = true
    } catch (cause) {
      const registrationWasAborted = signal.aborted
      controller.abort()
      if (directRegistrations.get(name) === registration) directRegistrations.delete(name)
      if (registrationWasAborted) return
      throw cause
    }
  }

  const reconcileDirectSurface = async (): Promise<void> => {
    if (unregistered || lifecycleController.signal.aborted) return
    abortRevokedDomains()
    const registrations: Promise<void>[] = []
    for (const name of ZATOM_WEBMCP_CORE_TOOLS) {
      const domain = zatomToolDomain(name)
      const existing = directRegistrations.get(name)
      if (domain && state.enabled.has(domain) && (!existing || existing.signal.aborted)) {
        registrations.push(registerDirect(name))
      }
    }
    await Promise.all(registrations)
  }

  const applyResolvedDomains = (
    resolved: ReturnType<typeof resolveZatomToolDomains>,
  ): Promise<void> => {
    if (unregistered) return Promise.resolve()
    const previousEnabled = state.enabled
    const previousUnknown = unknownDomains
    state.enabled = new Set(resolved.domains)
    unknownDomains = resolved.unknown
    const revision = ++domainRevision
    abortRevokedDomains()

    const operation = reconcileTail.then(async () => {
      if (unregistered || revision !== domainRevision) return
      try {
        await reconcileDirectSurface()
        if (unregistered || revision !== domainRevision) return
        notifyExposureChange()
      } catch (cause) {
        if (unregistered || revision !== domainRevision) throw cause
        state.enabled = previousEnabled
        unknownDomains = previousUnknown
        domainRevision += 1
        abortRevokedDomains()
        try {
          await reconcileDirectSurface()
          notifyExposureChange()
        } catch (rollbackCause) {
          throw new AggregateError([cause, rollbackCause], 'zatom: WebMCP domain update and rollback both failed')
        }
        throw cause
      }
    })
    reconcileTail = operation.catch(() => undefined)
    return operation
  }

  const refreshDomainsFromBroker = (): Promise<void> => {
    if (!options.accessBroker) return Promise.resolve()
    return applyResolvedDomains(resolveZatomToolDomains(options.accessBroker.getExposedDomains()))
  }

  const stableDescriptors: WebMCP.ModelContextTool[] = [
    { ...DESCRIPTOR_DOMAINS, execute: () => Promise.resolve(runDomains(state)) },
    { ...DESCRIPTOR_DESCRIBE, execute: (input) => Promise.resolve(runDescribe(state, input)) },
    {
      ...DESCRIPTOR_CALL,
      execute: (input, executeOptions) => runCall(
        state,
        input,
        executeOptions?.signal,
        'zatom_call_tool',
        lifecycleController.signal,
      ),
    },
    {
      ...DESCRIPTOR_REQUEST_ACCESS,
      execute: (input, executeOptions) => runAccessRequest(
        state,
        input,
        executeOptions?.signal,
        refreshDomainsFromBroker,
      ),
    },
  ]

  const registerStable = async (descriptor: WebMCP.ModelContextTool): Promise<void> => {
    await modelContext.registerTool(descriptor, registerOptions(lifecycleController.signal))
    if (!unregistered && !lifecycleController.signal.aborted) stableRegistered.add(descriptor.name)
  }

  const unregisterInternal = () => {
    if (unregistered) return
    unregistered = true
    accessUnsubscribe?.()
    accessUnsubscribe = undefined
    if (options.signal) options.signal.removeEventListener('abort', unregisterInternal)
    for (const registration of directRegistrations.values()) {
      registration.active = false
      registration.controller.abort()
    }
    for (const controllers of state.activeCalls.values()) {
      for (const controller of controllers) controller.abort()
    }
    state.activeCalls.clear()
    directRegistrations.clear()
    lifecycleController.abort()
    stableRegistered.clear()
  }

  if (options.signal?.aborted) {
    unregisterInternal()
  } else {
    options.signal?.addEventListener('abort', unregisterInternal, { once: true })
    try {
      const initialDirect = ZATOM_WEBMCP_CORE_TOOLS.filter((name) => {
        const domain = zatomToolDomain(name)
        return domain !== undefined && state.enabled.has(domain)
      })
      await Promise.all([
        ...initialDirect.map((name) => registerDirect(name)),
        ...stableDescriptors.map((descriptor) => registerStable(descriptor)),
      ])
      if (options.accessBroker && !unregistered) {
        accessUnsubscribe = options.accessBroker.subscribe(() => {
          void refreshDomainsFromBroker().catch(() => undefined)
        })
        // Re-read after subscribing. A base-domain update may have happened
        // while the initial registerTool batch was awaiting the browser.
        await refreshDomainsFromBroker()
      } else {
        notifyExposureChange()
      }
    } catch (cause) {
      unregisterInternal()
      throw cause
    }
  }

  return {
    get registered() {
      return registeredNames()
    },
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
      return applyResolvedDomains(resolveZatomToolDomains(requested))
    },
    unregister: unregisterInternal,
  }
}
