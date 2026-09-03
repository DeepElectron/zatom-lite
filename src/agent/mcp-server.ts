/** Development-bridge MCP server over the canonical Zatom tool registry. */

import { fromJsonSchema, McpServer, ResourceTemplate, type CallToolResult } from '@modelcontextprotocol/server'

import type { ZatomToolContext, ZatomWorkspaceIdentity } from './contracts'
import { materializeLargeMcpResult, ZatomMcpArtifactStore } from './mcp-artifact-store'
import { callZatomMcpTool, listZatomMcpTools } from './mcp-adapter'
import { ZATOM_MCP_SERVER_IDENTITY } from './mcp-identity'
import { resolveZatomToolDomains, zatomToolDomain } from './domains'
import type { ZatomToolDomainController } from './contracts'

/** Long-poll observers must not hold the workspace mutation queue while waiting on the user. */
const NON_BLOCKING_STATUS_TOOLS = new Set([
  'guide_candidate_status',
  'structure_proposal_status',
])

export interface ZatomMcpServerOptions {
  /** The development bridge creates a fresh protocol instance per request but keeps content-addressed resources readable. */
  artifacts?: ZatomMcpArtifactStore
  /** Optional host-wide scheduler for workspace/visual effects across protocol instances. */
  enqueueWorkspaceCall?: <T>(operation: () => Promise<T>) => Promise<T>
  /**
   * Tool domains to expose initially. Omit for the default set. Every tool is
   * registered either way; unselected domains start disabled and can be turned
   * on with `zatom_enable_domains` without reconnecting.
   */
  domains?: readonly string[]
  /**
   * Shared enabled-domain set for hosts that build a fresh protocol instance per
   * HTTP request (the streamable-HTTP handler does). Without it every request
   * starts from `domains` again and `zatom_enable_domains` is forgotten by the
   * next call. When supplied it is the source of truth and `domains` only seeds
   * it on first use.
   */
  enabledDomains?: Set<string>
}

function serverInstructions(context: ZatomToolContext): string {
  const hasWorkspace = !!(context.readStructure && context.writeStructure)
  const hasTrajectoryWorkspace = !!(context.readTrajectory && context.writeTrajectory)
  const hasVisualHost = !!(context.focusInspectionTarget && context.captureViewport)
  return [
    'Build candidate artifacts first, inspect every numeric check, and treat ok=true as tool execution success rather than scientific acceptance.',
    'For a complex goal, express ordered capability stages and call modeling_route_capabilities once; execute every returned required modeling_list_providers query, follow nextOffset until discovery is complete, and only then choose tools. Then call modeling_validate_plan once and transfer its returned fingerprinted plan. Never place either planning meta-tool inside the plan itself.',
    'Use inspectionTargets from successful results for spatial verification.',
    'Results above 4 MiB are returned as a compact zatom.mcp-materialized-result/v2 plus a resource link; its inspectionTargetIndex keeps each standard target separate from its exact structure/trajectory binding. Read the manifest and every ordered chunk, then verify byte count and SHA-256 before parsing the complete canonical result.',
    hasWorkspace
      ? `This connection provides an active ${hasTrajectoryWorkspace ? 'structure/trajectory' : 'structure-only'} workspace: import or create a structure, apply only validated candidates, and require fingerprint readback after every write.`
      : 'This host has no active workspace: pass structures explicitly, keep candidates artifact-only, and expect workspace reads/writes to fail closed.',
    hasVisualHost
      ? 'This host also provides visual verification: call viewer_observe first, then pass its data.workspace as expectedWorkspace on every visual or writable tool so pane switches and revision drift fail closed. Focus and capture relevant inspection targets after numeric acceptance.'
      : 'This host has no camera or Canvas: set captureAfter=false, preserve inspection targets, and expect explicit focus/capture to fail closed instead of fabricating image evidence.',
  ].join(' ')
}

const EXPECTED_WORKSPACE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  description: 'Exact data.workspace returned by viewer_observe. Required when this call changes the view or workspace.',
  properties: {
    viewportId: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 0 },
    structureFingerprint: { type: ['string', 'null'] },
    trajectoryFingerprint: { type: ['string', 'null'] },
  },
  required: ['viewportId', 'revision', 'structureFingerprint', 'trajectoryFingerprint'],
} as const

function parseExpectedWorkspace(value: unknown): ZatomWorkspaceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expectedWorkspace must be the complete identity returned by viewer_observe')
  }
  const input = value as Record<string, unknown>
  if (typeof input.viewportId !== 'string' || !input.viewportId
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || (input.structureFingerprint !== null && typeof input.structureFingerprint !== 'string')
    || (input.trajectoryFingerprint !== null && typeof input.trajectoryFingerprint !== 'string')) {
    throw new Error('expectedWorkspace must be the complete identity returned by viewer_observe')
  }
  return {
    viewportId: input.viewportId,
    revision: Number(input.revision),
    structureFingerprint: input.structureFingerprint as string | null,
    trajectoryFingerprint: input.trajectoryFingerprint as string | null,
  }
}

/**
 * Create one MCP server instance for the authenticated development bridge,
 * using the structure, trajectory, and visual context of its live browser page.
 */
export function createZatomMcpServer(
  context: ZatomToolContext = {},
  options: ZatomMcpServerOptions = {},
): McpServer {
  const artifacts = options.artifacts ?? new ZatomMcpArtifactStore()
  let workspaceQueue = Promise.resolve()
  const enqueueLocally = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = workspaceQueue.then(operation, operation)
    workspaceQueue = result.then(() => undefined, () => undefined)
    return result
  }
  const enqueueWorkspaceCall = options.enqueueWorkspaceCall ?? enqueueLocally
  const server = new McpServer(
    ZATOM_MCP_SERVER_IDENTITY,
    { instructions: serverInstructions(context) },
  )

  server.registerResource(
    'zatom-artifact-manifest',
    new ResourceTemplate('zatom-artifact://sha256/{digest}/manifest', { list: undefined }),
    {
      title: 'zatom materialized result manifest',
      description: 'Content-addressed manifest for one oversized canonical MCP tool result.',
      mimeType: 'application/json',
    },
    async (uri, variables) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(artifacts.manifest(String(variables.digest))),
      }],
    }),
  )
  server.registerResource(
    'zatom-artifact-chunk',
    new ResourceTemplate('zatom-artifact://sha256/{digest}/chunks/{index}', { list: undefined }),
    {
      title: 'zatom materialized result chunk',
      description: 'One bounded UTF-8 fragment of a content-addressed canonical MCP tool result.',
      mimeType: 'text/plain; charset=utf-8',
    },
    async (uri, variables) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'text/plain; charset=utf-8',
        text: artifacts.chunk(String(variables.digest), Number(variables.index)),
      }],
    }),
  )

  const { domains: selected, unknown: unknownDomains } = resolveZatomToolDomains(options.domains)
  const enabledDomains = options.enabledDomains ?? new Set<string>()
  if (enabledDomains.size === 0) for (const domain of selected) enabledDomains.add(domain)
  const handlesByDomain = new Map<string, { enable: () => void }[]>()

  // Scoped to this server instance and injected per call, so overlapping
  // development bridge connections cannot clobber each other.
  const domainController: ZatomToolDomainController = {
    enabledDomains: () => [...enabledDomains],
    enableDomains: (requested) => {
      for (const domain of requested) {
        if (enabledDomains.has(domain)) continue
        enabledDomains.add(domain)
        // Re-enabling emits notifications/tools/list_changed, so the client
        // refreshes its tool list on its own.
        for (const handle of handlesByDomain.get(domain) ?? []) handle.enable()
      }
    },
  }

  for (const tool of listZatomMcpTools()) {
    const viewportBridged = context.access?.host === 'cli-bridge'
    const mayChangeVisibleState = tool.effects.visual === 'write'
      || tool.effects.workspace === 'write'
      || tool.effects.structure === 'create'
      || tool.effects.structure === 'replace'
    // Batch organization has its own instance targeting and does not alter the
    // viewport document. Structure revision cannot meaningfully CAS a rename.
    const identityIndependentAssetWrite = tool.name === 'assets_create_batch'
      || tool.name === 'assets_rename_batch'
      || tool.name === 'assets_move_frames'
    const requiresExpectedWorkspace = mayChangeVisibleState && !identityIndependentAssetWrite
    const advertisedInputSchema = (() => {
      if (!viewportBridged || !requiresExpectedWorkspace) return tool.inputSchema
      const properties = tool.inputSchema.properties as Record<string, unknown> | undefined
      const withIdentity: Record<string, unknown> = {
        ...tool.inputSchema,
        properties: {
          ...(properties ?? {}),
          expectedWorkspace: EXPECTED_WORKSPACE_SCHEMA,
        },
      }
      const conditionalField = properties?.applyToWorkspace !== undefined
        ? 'applyToWorkspace'
        : tool.name === 'structure_select_atoms' ? 'applyToViewportSelection' : null
      if (conditionalField) {
        const existingAllOf = Array.isArray(tool.inputSchema.allOf) ? tool.inputSchema.allOf : []
        const visibleRequest = tool.name === 'structure_pose_component'
          ? {
              anyOf: [
                {
                  properties: { applyToWorkspace: { const: true } },
                  required: ['applyToWorkspace'],
                },
                { required: ['proposalId'] },
              ],
            }
          : {
              properties: { [conditionalField]: { const: true } },
              required: [conditionalField],
            }
        return {
          ...withIdentity,
          allOf: [
            ...existingAllOf,
            {
              if: visibleRequest,
              then: { required: ['expectedWorkspace'] },
            },
          ],
        }
      }
      return {
        ...withIdentity,
        required: [
          ...(Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required.map(String) : []),
          'expectedWorkspace',
        ],
      }
    })()
    const handle = server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(advertisedInputSchema),
        annotations: {
          readOnlyHint: tool.effects.workspace !== 'write' && tool.effects.visual !== 'write',
          destructiveHint: tool.effects.workspace === 'write',
          openWorldHint: tool.name === 'modeling_run_provider',
        },
        _meta: {
          'tech.zauq.zatom/version': tool.version,
          'tech.zauq.zatom/effects': tool.effects,
          'tech.zauq.zatom/tags': tool.tags,
        },
      },
      async (args, request): Promise<CallToolResult> => {
        const execute = async (): Promise<CallToolResult> => {
          const rawArgs = args as Record<string, unknown>
          const expectedWorkspace = rawArgs.expectedWorkspace === undefined
            ? undefined
            : parseExpectedWorkspace(rawArgs.expectedWorkspace)
          const toolArgs: Record<string, unknown> = expectedWorkspace
            ? Object.fromEntries(Object.entries(rawArgs).filter(([key]) => key !== 'expectedWorkspace'))
            : rawArgs
          const schemaProperties = tool.inputSchema.properties as Record<string, unknown> | undefined
          const proposalRefinement = tool.name === 'structure_pose_component'
            && typeof toolArgs.proposalId === 'string'
          const candidateOnly = schemaProperties?.applyToWorkspace !== undefined
            && toolArgs.applyToWorkspace !== true
            && !proposalRefinement
          const selectionOnly = tool.name === 'structure_select_atoms'
            && toolArgs.applyToViewportSelection !== true
          const changesVisibleState = requiresExpectedWorkspace && !candidateOnly && !selectionOnly
          if (viewportBridged && changesVisibleState && !expectedWorkspace) {
            return {
              content: [{
                type: 'text',
                text: `ERROR ${tool.name}: expectedWorkspace is required. Call viewer_observe and pass data.workspace unchanged.`,
              }],
              isError: true,
              structuredContent: {
                ok: false,
                tool: tool.name,
                summary: 'expectedWorkspace is required for a visual or workspace change',
                error: {
                  code: 'expected_workspace_required',
                  message: 'Call viewer_observe and pass its data.workspace as expectedWorkspace.',
                },
              },
            }
          }
          if (expectedWorkspace) await context.bindExpectedWorkspace?.(expectedWorkspace)
          const signal = context.signal
            ? AbortSignal.any([context.signal, request.mcpReq.signal])
            : request.mcpReq.signal
          const result = await callZatomMcpTool(tool.name, toolArgs, {
            ...context,
            domains: domainController,
            signal,
            ...(expectedWorkspace ? { expectedWorkspace } : {}),
          })
          return materializeLargeMcpResult(result, artifacts) as CallToolResult
        }
        return NON_BLOCKING_STATUS_TOOLS.has(tool.name)
          || (tool.effects.workspace === 'none' && tool.effects.visual === 'none')
          ? execute()
          : enqueueWorkspaceCall(execute)
      },
    )

    // Every tool is registered so a domain can be enabled later without
    // reconnecting; only the selected ones are visible in tools/list.
    const domain = zatomToolDomain(tool.name)
    if (domain === undefined) continue
    const handles = handlesByDomain.get(domain) ?? []
    handles.push(handle)
    handlesByDomain.set(domain, handles)
    if (!enabledDomains.has(domain)) handle.disable()
  }

  if (unknownDomains.length > 0) {
    console.warn(`[zatom] Ignoring unknown tool domains: ${unknownDomains.join(', ')}`)
  }

  return server
}
