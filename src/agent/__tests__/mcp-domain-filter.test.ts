/**
 * Domain filtering is the mechanism that keeps `tools/list` small enough for a
 * CLI agent to afford, so these tests pin the two properties that make it
 * trustworthy: an unselected domain is genuinely absent from the listing, and
 * enabling one later reveals it without reconnecting.
 */

import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { createZatomMcpServer } from '../mcp-server'
import { ZATOM_TOOL_DOMAINS, zatomToolDomain } from '../domains'

async function connect(domains?: readonly string[], enabledDomains?: Set<string>) {
  const server = createZatomMcpServer({}, {
    ...(domains === undefined ? {} : { domains }),
    ...(enabledDomains ? { enabledDomains } : {}),
  })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'zatom-domain-probe', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client }
}

function domainsOf(names: readonly string[]): Set<string> {
  const seen = new Set<string>()
  for (const name of names) {
    const domain = zatomToolDomain(name)
    if (domain !== undefined) seen.add(domain)
  }
  return seen
}

describe('mcp domain filtering', () => {
  let client: Client

  beforeEach(async () => {
    ;({ client } = await connect(['session', 'viewport']))
    return async () => { await client.close() }
  })

  it('lists only the selected domains', async () => {
    const { tools } = await client.listTools()
    expect(tools.length).toBeGreaterThan(0)
    expect([...domainsOf(tools.map((tool) => tool.name))].sort()).toEqual(['session', 'viewport'])
  })

  it('reveals a domain after enabling it, without reconnecting', async () => {
    const before = await client.listTools()
    expect(domainsOf(before.tools.map((tool) => tool.name)).has('build')).toBe(false)

    const result = await client.callTool({ name: 'zatom_enable_domains', arguments: { domains: ['build'] } })
    expect(result.isError ?? false).toBe(false)

    const after = await client.listTools()
    expect(domainsOf(after.tools.map((tool) => tool.name)).has('build')).toBe(true)
    expect(after.tools.length).toBeGreaterThan(before.tools.length)
  })

  it('rejects an unknown domain name instead of silently ignoring it', async () => {
    const result = await client.callTool({ name: 'zatom_enable_domains', arguments: { domains: ['nope'] } })
    expect(result.isError).toBe(true)
  })

  it('keeps an enabled domain across per-request server instances when the set is shared', async () => {
    // The development bridge builds a new server per
    // request; without a shared set, zatom_enable_domains is undone next call.
    const shared = new Set<string>()
    const first = await connect(['session', 'viewport'], shared)
    await first.client.callTool({ name: 'zatom_enable_domains', arguments: { domains: ['build'] } })
    await first.client.close()

    const second = await connect(['session', 'viewport'], shared)
    const { tools } = await second.client.listTools()
    expect(domainsOf(tools.map((tool) => tool.name)).has('build')).toBe(true)
    await second.client.close()
  })

  it('keeps the discovery index callable while its own domain is the only one enabled', async () => {
    const result = await client.callTool({ name: 'zatom_domains', arguments: {} })
    expect(result.isError ?? false).toBe(false)
    const data = (result.structuredContent as { data?: { domains?: unknown[] } } | undefined)?.data
    expect(data?.domains).toHaveLength(ZATOM_TOOL_DOMAINS.length)
  })

  it('does not hold the workspace queue while a candidate decision status call waits', async () => {
    let enqueued = 0
    const server = createZatomMcpServer({
      guidance: {
        candidateStatus: (candidateSetId: string) => ({
          candidateSetId,
          status: 'pending',
          focusedIndex: null,
          choice: null,
          decidedAt: null,
          timedOut: false,
        }),
      } as never,
    }, {
      domains: ['guide'],
      enqueueWorkspaceCall: async (operation) => {
        enqueued += 1
        return operation()
      },
    })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const directClient = new Client({ name: 'zatom-status-queue-probe', version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), directClient.connect(clientTransport)])
    try {
      const result = await directClient.callTool({
        name: 'guide_candidate_status',
        arguments: { candidateSetId: 'candidate-1', waitMs: 0 },
      })
      expect(result.isError ?? false).toBe(false)
      expect(enqueued).toBe(0)
    } finally {
      await directClient.close()
    }
  })

  it('advertises the same expectedWorkspace requirements enforced by the viewport bridge', async () => {
    const server = createZatomMcpServer({
      access: { host: 'cli-bridge', mode: () => 'read-write' },
    }, { domains: ['guide', 'edit', 'viewport'] })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    const directClient = new Client({ name: 'zatom-schema-probe', version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), directClient.connect(clientTransport)])
    try {
      const { tools } = await directClient.listTools()
      const schema = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema as {
        required?: string[]
        allOf?: unknown[]
      } | undefined
      expect(schema('guide_present_candidates')?.required).toContain('expectedWorkspace')
      expect(JSON.stringify(schema('structure_select_atoms')?.allOf)).toContain('applyToViewportSelection')
      const poseCondition = JSON.stringify(schema('structure_pose_component')?.allOf)
      expect(poseCondition).toContain('applyToWorkspace')
      expect(poseCondition).toContain('proposalId')
      expect(poseCondition).toContain('expectedWorkspace')
    } finally {
      await directClient.close()
    }
  })
})
