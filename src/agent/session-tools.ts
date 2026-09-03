/**
 * Domain discovery and progressive expansion.
 *
 * `zatom_domains` is the index an agent reads first: a one-line summary per
 * domain costs about a kilobyte, versus ~295 KB for the full tool listing.
 * `zatom_enable_domains` then turns on only what the task needs. The MCP server
 * owns the actual enable/disable of registered tools and injects the callbacks
 * below, so this module stays transport-neutral and testable.
 */

import type {
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolDomainController,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_TOOL_DOMAINS, ZATOM_WORKFLOW, zatomToolDomainNames } from './domains'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, required }
}

export interface ZatomDomainView {
  name: string
  summary: string
  toolCount: number
  enabled: boolean
}

function requireController(context: ZatomToolContext): ZatomToolDomainController {
  const controller = context.domains
  if (!controller) throw new Error('Domain switching is not available on this host')
  return controller
}

function domainViews(context: ZatomToolContext): ZatomDomainView[] {
  const enabled = new Set(requireController(context).enabledDomains())
  return ZATOM_TOOL_DOMAINS.map((domain) => ({
    name: domain.name,
    summary: domain.summary,
    toolCount: domain.tools.length,
    enabled: enabled.has(domain.name),
  }))
}

const domainsManifest: ZatomToolManifest = {
  name: 'zatom_domains',
  title: 'List tool domains',
  version: '1.0.0',
  description: 'CALL THIS FIRST. Returns the human-collaboration workflow (observe → plan → point → propose → verify) and every tool domain with its summary, tool count and enabled state. Only enabled domains appear in the tool list; use zatom_enable_domains for the rest. Safe to call any time.',
  inputSchema: objectSchema({}),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['session', 'domains', 'discovery', 'agent'],
}

const zatomDomainsTool: ZatomToolDefinition<{ workflow: string[]; domains: ZatomDomainView[] }> = {
  manifest: domainsManifest,
  execute: async (_input, context) => {
    try {
      const domains = domainViews(context)
      const enabled = domains.filter((domain) => domain.enabled).map((domain) => domain.name)
      return {
        ok: true,
        tool: domainsManifest.name,
        summary: `${domains.length} domains; enabled: ${enabled.join(', ')}. Read data.workflow before acting.`,
        data: { workflow: [...ZATOM_WORKFLOW], domains },
      }
    } catch (error) {
      return toolError(domainsManifest.name, error)
    }
  },
}

const enableManifest: ZatomToolManifest = {
  name: 'zatom_enable_domains',
  title: 'Enable tool domains',
  version: '1.0.0',
  description: 'Enable one or more tool domains for this session. Newly enabled tools become callable immediately and a tools/list_changed notification is sent. Enabling a domain that is already on is harmless.',
  inputSchema: objectSchema({
    domains: {
      type: 'array',
      minItems: 1,
      items: { enum: zatomToolDomainNames() },
      description: 'Domain names to enable',
    },
  }, ['domains']),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['session', 'domains', 'discovery', 'agent'],
}

const zatomEnableDomainsTool: ZatomToolDefinition<{ domains: ZatomDomainView[]; newlyEnabled: string[] }> = {
  manifest: enableManifest,
  execute: async (input, context) => {
    try {
      const active = requireController(context)
      const requested = (input.domains as unknown[]).map(String)
      const known = new Set(zatomToolDomainNames())
      const unknown = requested.filter((name) => !known.has(name))
      if (unknown.length > 0) {
        throw new Error(`Unknown domains: ${unknown.join(', ')}. Call zatom_domains for the list.`)
      }
      const before = new Set(active.enabledDomains())
      const newlyEnabled = requested.filter((name) => !before.has(name))
      active.enableDomains(requested)
      const domains = domainViews(context)
      const addedTools = ZATOM_TOOL_DOMAINS
        .filter((domain) => newlyEnabled.includes(domain.name))
        .reduce((sum, domain) => sum + domain.tools.length, 0)
      return {
        ok: true,
        tool: enableManifest.name,
        summary: newlyEnabled.length === 0
          ? 'Those domains were already enabled'
          : `Enabled ${newlyEnabled.join(', ')}, adding ${addedTools} tools`,
        data: { domains, newlyEnabled },
      }
    } catch (error) {
      return toolError(enableManifest.name, error)
    }
  },
}

export const SESSION_ZATOM_AGENT_TOOLS: ZatomToolDefinition<unknown>[] = [
  zatomDomainsTool as ZatomToolDefinition<unknown>,
  zatomEnableDomainsTool as ZatomToolDefinition<unknown>,
]
