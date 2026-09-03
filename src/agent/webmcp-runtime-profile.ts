/** Facts about the in-page WebMCP host bound to the live Zatom Lite viewport. */

import { listZatomMcpTools, type McpToolDefinition } from './mcp-adapter'
import { ZATOM_MCP_RUNTIME_PROFILE_SCHEMA, ZATOM_MCP_SERVER_IDENTITY } from './mcp-identity'
import { resolveZatomToolDomains, ZATOM_TOOL_DOMAINS } from './domains'
import {
  ZATOM_WEBMCP_CORE_TOOLS,
  ZATOM_WEBMCP_FACADE_TOOLS,
  ZATOM_WEBMCP_REGISTERED_TOOLS,
  isReadOnlyTool,
  isZatomWebMcpCallableTool,
} from './webmcp-adapter'

export interface ZatomWebMcpRuntimeProfile {
  schemaVersion: typeof ZATOM_MCP_RUNTIME_PROFILE_SCHEMA
  server: typeof ZATOM_MCP_SERVER_IDENTITY
  transport: {
    kind: 'webmcp-in-page'
    endpoint: 'document.modelContext'
    port: null
    /** The page owns registration; there is no external process to attach to. */
    lifecycleOwner: 'page'
    /** Exposure ends when the document goes away, not on transport close. */
    revokedBy: 'document-navigation-or-abort'
    liveConnectionObservableByPage: true
  }
  tools: {
    /** Total tools in the registry, enabled or not. */
    available: number
    /** Core direct tools plus the three long-tail facade tools. */
    registered: number
    facade: readonly string[]
    core: readonly string[]
    /** Registry tools callable through `zatom_call_tool` for the resolved domains. */
    callable: number
    readOnly: number
    workspaceWrite: number
    visualWrite: number
    /** Nothing is blocked in-page: the live viewport backs the visual tools. */
    blockedWithoutVisualHost: string[]
  }
  domains: {
    /** Domains whose tools are callable. */
    enabled: readonly string[]
    /** Domains that exist but are not callable on this page. */
    disabled: readonly string[]
    /**
     * Core and facade descriptors are stable; a disabled domain's calls are
     * refused with `domain_disabled` without re-registering the page surface.
     */
    gating: 'call-time'
  }
  workspace: {
    /** One workspace per document, shared with the human at the keyboard. */
    scope: 'shared-active-app'
    persistence: 'browser-local'
    structure: 'read-write-validated'
    trajectory: 'read-write-validated'
    sharesActiveAppWorkspace: true
  }
  visual: {
    focus: boolean
    capture: boolean
  }
}

/**
 * Describe the host that `registerZatomWebMcpTools` creates for a given domain
 * selection. This is configuration, not a liveness probe: it reports what the
 * page exposes, not whether an agent is attached.
 */
export function createZatomWebMcpRuntimeProfile(
  options: { domains?: readonly string[]; tools?: readonly McpToolDefinition[] } = {},
): ZatomWebMcpRuntimeProfile {
  const all = options.tools ?? listZatomMcpTools()
  const { domains } = resolveZatomToolDomains(options.domains)
  const enabled = new Set(domains)
  const callable = all.filter((tool) => isZatomWebMcpCallableTool(tool.name, enabled))
  const names = new Set(callable.map((tool) => tool.name))
  return {
    schemaVersion: ZATOM_MCP_RUNTIME_PROFILE_SCHEMA,
    server: ZATOM_MCP_SERVER_IDENTITY,
    transport: {
      kind: 'webmcp-in-page',
      endpoint: 'document.modelContext',
      port: null,
      lifecycleOwner: 'page',
      revokedBy: 'document-navigation-or-abort',
      liveConnectionObservableByPage: true,
    },
    tools: {
      available: all.length,
      registered: ZATOM_WEBMCP_REGISTERED_TOOLS.length,
      facade: ZATOM_WEBMCP_FACADE_TOOLS,
      core: ZATOM_WEBMCP_CORE_TOOLS,
      callable: callable.length,
      readOnly: callable.filter(isReadOnlyTool).length,
      workspaceWrite: callable.filter((tool) => tool.effects.workspace === 'write').length,
      visualWrite: callable.filter((tool) => tool.effects.visual === 'write').length,
      blockedWithoutVisualHost: [],
    },
    domains: {
      enabled: domains,
      disabled: ZATOM_TOOL_DOMAINS.map((domain) => domain.name).filter((name) => !enabled.has(name)),
      gating: 'call-time',
    },
    workspace: {
      scope: 'shared-active-app',
      persistence: 'browser-local',
      structure: 'read-write-validated',
      trajectory: 'read-write-validated',
      sharesActiveAppWorkspace: true,
    },
    visual: {
      focus: names.has('viewer_focus_target'),
      capture: names.has('viewer_capture'),
    },
  }
}
