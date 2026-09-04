import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, expect, it } from 'vitest'

import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure } from '../../agent/contracts'
import { fingerprintStructure } from '../../agent/structure-math'
import type { ZatomViewportBridgeRequest } from '../viewport-contracts'
import { ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA } from '../viewport-contracts'
import { createZatomDevMcpBridge, type ZatomDevMcpBridge } from '../dev-mcp-bridge'
import { ZATOM_CLI_BRIDGE_PATHS, type ZatomCliBridgeActivity } from '../contracts'

const initial: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'page viewport',
  atoms: [
    { id: 'a', element: 'C', position: [0, 0, 0] },
    { id: 'b', element: 'C', position: [1.4, 0, 0] },
  ],
}

const teardowns: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const teardown of teardowns.splice(0).reverse()) await teardown()
})

async function startBridge() {
  const bridge: ZatomDevMcpBridge = createZatomDevMcpBridge()
  const server: Server = createServer((request, response) => {
    bridge.middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port
  teardowns.push(async () => {
    await bridge.close()
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
  })
  return { bridge, port, base: `http://127.0.0.1:${port}`, session: bridge.session(port) }
}

/**
 * Stands in for the browser tab: same SSE + POST contract, fixture executor.
 * The Origin is deliberately an external proxy host rather than loopback, which
 * is what a dev server reached through the v0 preview (or a tunnel) really sees.
 * Provenance therefore has to come from `sec-fetch-site`, not the Origin value.
 */
const PROXIED_PAGE_HEADERS = {
  'sec-fetch-site': 'same-origin',
  origin: 'https://preview.example.test',
} as const

async function attachPage(
  base: string,
  structure: { current: ZatomStructure; commits: number },
  /** Names the tab, mirroring the id the real page persists in sessionStorage. */
  instance?: { instanceId: string; label?: string },
) {
  const activities: ZatomCliBridgeActivity[] = []
  const controller = new AbortController()
  const query = instance
    ? `?${new URLSearchParams({
      instanceId: instance.instanceId,
      ...(instance.label ? { label: instance.label } : {}),
    })}`
    : ''
  const response = await fetch(`${base}${ZATOM_CLI_BRIDGE_PATHS.stream}${query}`, {
    headers: PROXIED_PAGE_HEADERS,
    signal: controller.signal,
  })
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()

  /** Per-tab viewport state, so a test can assert which window a call reached. */
  const mounted: string[] = []
  let layout = '1x1'
  /**
   * Per-tab workspace batches. Each bridged window owns its own workspace, so
   * these must stay separate for a test to catch a batch write landing in the
   * wrong tab.
   */
  const batches: string[] = ['Batch 1']
  const batchViews = () => batches.map((name, index) => ({
    id: `batch-${index}`,
    name,
    frameIds: [],
    activeFrameId: null,
    active: index === batches.length - 1,
  }))
  /**
   * Mirrors the real page: it does not know its own bridge id, so the view
   * carries no instanceId and the bridge is responsible for stamping one.
   */
  const describeView = () => {
    const capacity = layout.split('x').reduce((total, part) => total * Number(part), 1)
    return {
      layout,
      availableLayouts: ['1x1', '1x2', '2x2'],
      slots: Array.from({ length: capacity }, (_, index) => ({
        slotId: `vp-${index + 1}`,
        slotIndex: index,
        kind: 'crystal',
        label: `VP-${index + 1}`,
        structureLabel: mounted[index] ?? null,
        atomCount: mounted[index] ? 2 : null,
        active: index === 0,
      })),
    }
  }

  const execute = async (request: ZatomViewportBridgeRequest): Promise<unknown> => {
    const identity = () => ({
      viewportId: 'vp-dev',
      revision: structure.commits,
      structureFingerprint: fingerprintStructure(structure.current),
      trajectoryFingerprint: null,
    })
    // A real page answers this from hostAccessStore; the bridge defaults to read-write.
    if (request.operation === 'read-host-write-mode') return { mode: 'read-write' }
    if (request.operation === 'read-structure') {
      return { viewportId: 'vp-dev', structure: structuredClone(structure.current), identity: identity() }
    }
    if (request.operation === 'read-trajectory') {
      return { viewportId: 'vp-dev', trajectory: null, identity: identity() }
    }
    if (request.operation === 'read-workspace-identity') return { viewportId: 'vp-dev', identity: identity() }
    if (request.operation === 'commit-structure') {
      const payload = request.payload as { structure: ZatomStructure; expectedStructureFingerprint?: string | null }
      const actual = fingerprintStructure(structure.current)
      if (payload.expectedStructureFingerprint !== undefined && payload.expectedStructureFingerprint !== actual) {
        throw new Error('stale source structure')
      }
      structure.current = structuredClone(payload.structure)
      structure.commits++
      return {
        viewportId: 'vp-dev',
        structureFingerprint: fingerprintStructure(structure.current),
        identity: identity(),
      }
    }
    if (request.operation === 'write-trajectory') return { viewportId: 'vp-dev' }
    if (request.operation === 'viewport-describe') return describeView()
    if (request.operation === 'viewport-set-layout') {
      layout = (request.payload as { layout: string }).layout
      return describeView()
    }
    if (request.operation === 'assets-list-batches') return { batches: batchViews() }
    if (request.operation === 'assets-create-batch') {
      const payload = (request.payload ?? {}) as { name?: string }
      batches.push(payload.name ?? `Batch ${batches.length + 1}`)
      return { batches: batchViews() }
    }
    if (request.operation === 'viewport-mount') {
      const payload = request.payload as { structures: { label: string }[]; layout?: string }
      if (payload.layout) layout = payload.layout
      mounted.splice(0, mounted.length, ...payload.structures.map((entry) => entry.label))
      return describeView()
    }
    return null
  }

  const pump = (async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        const event = /^event: (.+)$/m.exec(frame)?.[1]
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        if (!event || !data) continue
        if (event === 'activity') activities.push(JSON.parse(data) as ZatomCliBridgeActivity)
        if (event === 'viewport-request') {
          const request = JSON.parse(data) as ZatomViewportBridgeRequest
          void (async () => {
            let body: Record<string, unknown>
            try {
              body = {
                schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
                requestId: request.requestId,
                ok: true,
                value: await execute(request),
              }
            } catch (error) {
              body = {
                schemaVersion: ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA,
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
            await fetch(`${base}${ZATOM_CLI_BRIDGE_PATHS.result}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', ...PROXIED_PAGE_HEADERS },
              body: JSON.stringify(body),
            })
          })()
        }
      }
    }
  })()

  teardowns.push(async () => {
    controller.abort()
    await pump.catch(() => {})
  })
  return { activities, mounted, batches }
}

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

it('drives the page viewport from an authenticated loopback CLI and reports each call', async () => {
  const { bridge, base, session } = await startBridge()

  // Fail closed on both axes before a page is attached.
  const unauthorized = await fetch(session.endpoint, { method: 'POST' })
  expect(unauthorized.status).toBe(401)
  const hostless = await fetch(session.endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
  })
  expect(hostless.status).toBe(503)
  // The page half never accepts the CLI's token in place of browser provenance.
  expect((await fetch(`${base}${ZATOM_CLI_BRIDGE_PATHS.session}`)).status).toBe(403)

  const structure = { current: structuredClone(initial), commits: 0 }
  const page = await attachPage(base, structure)
  await waitFor(() => (bridge.pageBound() ? true : undefined), 'the page to bind the viewport host slot')
  expect(await (await fetch(`${base}${ZATOM_CLI_BRIDGE_PATHS.health}`)).json()).toMatchObject({ status: 'ready' })

  const client = new Client({ name: 'zatom-cli-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(session.endpoint), {
    authProvider: { token: async () => session.token },
  }))
  try {
    const read = await client.callTool({ name: 'workspace_get_active_structure', arguments: {} })
    expect(read.isError).not.toBe(true)
    expect(read.structuredContent).toMatchObject({ ok: true, data: { atomCount: 2 } })
    const readData = (read.structuredContent as {
      data: {
        viewportId: string
        workspaceRevision: number
        structureFingerprint: string
        trajectory: { fingerprint: string } | null
      }
    }).data
    const expectedWorkspace = {
      viewportId: readData.viewportId,
      revision: readData.workspaceRevision,
      structureFingerprint: readData.structureFingerprint,
      trajectoryFingerprint: readData.trajectory?.fingerprint ?? null,
    }

    await client.callTool({
      name: 'zatom_enable_domains',
      arguments: { domains: ['direct-edit'] },
    })

    const unbound = await client.callTool({
      name: 'structure_apply_operations',
      arguments: {
        operations: [{ op: 'translate', selection: { atomIds: ['a'] }, vector: [1, 0, 0] }],
        applyToWorkspace: true,
        captureAfter: false,
      },
    })
    expect(unbound.isError).toBe(true)
    // expectedWorkspace is now part of the advertised conditional schema, so
    // the MCP SDK rejects this before execution instead of manufacturing a
    // runtime structuredContent error after the avoidable bad call.
    expect(unbound.structuredContent).toBeUndefined()
    expect(JSON.stringify(unbound)).toContain('expectedWorkspace')

    const applied = await client.callTool({
      name: 'structure_apply_operations',
      arguments: {
        operations: [{ op: 'translate', selection: { atomIds: ['a'] }, vector: [1, 0, 0] }],
        applyToWorkspace: true,
        captureAfter: false,
        expectedWorkspace,
      },
    })
    expect(applied.isError).not.toBe(true)
    expect(applied.structuredContent).toMatchObject({ ok: true, data: { appliedToWorkspace: true } })
  } finally {
    await client.close()
  }

  // The CLI edit landed in the page's own structure, not a connection-local copy.
  expect(structure.commits).toBe(1)
  expect(structure.current.atoms.map((atom) => atom.position)).toEqual([[1, 0, 0], [1.4, 0, 0]])

  const commitActivity = await waitFor(
    () => page.activities.find((entry) => entry.tool === 'structure_apply_operations' && entry.ok),
    'the commit activity event',
  )
  expect(commitActivity).toMatchObject({ ok: true, atomCount: 2, viewportId: 'vp-dev' })
  expect(commitActivity.viewportOps).toBeGreaterThan(0)
  expect(page.activities.some((entry) => entry.tool === 'workspace_get_active_structure')).toBe(true)
})

it('refuses an ambiguous write when several app instances share the dev server', async () => {
  const { bridge, base, session } = await startBridge()

  const left = { current: structuredClone(initial), commits: 0 }
  const right = { current: structuredClone(initial), commits: 0 }
  await attachPage(base, left, { instanceId: 'left', label: 'Left window' })
  await attachPage(base, right, { instanceId: 'right', label: 'Right window' })
  await waitFor(() => (bridge.pageBound() ? true : undefined), 'both pages to register')

  const health = await (await fetch(`${base}${ZATOM_CLI_BRIDGE_PATHS.health}`)).json() as {
    instances: { instanceId: string }[]
  }
  await waitFor(() => (health.instances.length === 2 ? true : undefined), 'health to list both instances')
  expect(health.instances.map((entry) => entry.instanceId).sort()).toEqual(['left', 'right'])

  const client = new Client({ name: 'zatom-cli-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(session.endpoint), {
    authProvider: { token: async () => session.token },
  }))
  try {
    // With two tabs open the bridge cannot know which viewport the agent means,
    // so the call fails closed and names the options instead of writing to an
    // arbitrary window.
    const ambiguous = await client.callTool({ name: 'workspace_get_active_structure', arguments: {} })
    expect(ambiguous.isError).toBe(true)
    const message = JSON.stringify(ambiguous.content)
    expect(message).toContain('instanceId')
    expect(message).toContain('left')
    expect(message).toContain('right')

    // Neither page was touched by the refused call.
    expect(left.commits).toBe(0)
    expect(right.commits).toBe(0)
  } finally {
    await client.close()
  }
})

it('routes batch writes to the addressed instance and refuses an ambiguous one', async () => {
  const { bridge, base, session } = await startBridge()

  const left = { current: structuredClone(initial), commits: 0 }
  const right = { current: structuredClone(initial), commits: 0 }
  const leftPage = await attachPage(base, left, { instanceId: 'left', label: 'Left window' })
  const rightPage = await attachPage(base, right, { instanceId: 'right', label: 'Right window' })
  await waitFor(() => (bridge.pageBound() ? true : undefined), 'both pages to register')

  const client = new Client({ name: 'zatom-cli-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(session.endpoint), {
    authProvider: { token: async () => session.token },
  }))
  try {
    await client.callTool({ name: 'zatom_enable_domains', arguments: { domains: ['assets'] } })

    // Every window owns a separate workspace, so an unaddressed batch write has
    // no single correct destination and must fail rather than pick one.
    const ambiguous = await client.callTool({
      name: 'assets_create_batch',
      arguments: { name: 'nowhere' },
    })
    expect(ambiguous.isError).toBe(true)
    expect(JSON.stringify(ambiguous.content)).toContain('instanceId')
    expect(leftPage.batches).toEqual(['Batch 1'])
    expect(rightPage.batches).toEqual(['Batch 1'])

    // Addressed, it lands in exactly one workspace.
    const targeted = await client.callTool({
      name: 'assets_create_batch',
      arguments: { instanceId: 'right', name: 'run-A' },
    })
    expect(targeted.isError).toBeFalsy()
    expect(rightPage.batches).toEqual(['Batch 1', 'run-A'])
    expect(leftPage.batches).toEqual(['Batch 1'])
  } finally {
    await client.close()
  }
})

it('mounts into the addressed instance and reports which window answered', async () => {
  const { bridge, base, session } = await startBridge()

  const left = { current: structuredClone(initial), commits: 0 }
  const right = { current: structuredClone(initial), commits: 0 }
  const leftPage = await attachPage(base, left, { instanceId: 'left', label: 'Left window' })
  const rightPage = await attachPage(base, right, { instanceId: 'right', label: 'Right window' })
  await waitFor(() => (bridge.pageBound() ? true : undefined), 'both pages to register')

  const client = new Client({ name: 'zatom-cli-bridge-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(new URL(session.endpoint), {
    authProvider: { token: async () => session.token },
  }))
  try {
    await client.callTool({ name: 'zatom_enable_domains', arguments: { domains: ['viewport'] } })
    const result = await client.callTool({
      name: 'viewport_mount_structures',
      arguments: {
        instanceId: 'right',
        expectedWorkspace: {
          viewportId: 'vp-dev',
          revision: right.commits,
          structureFingerprint: fingerprintStructure(right.current),
          trajectoryFingerprint: null,
        },
        structures: [{ label: 'NH3', format: 'xyz', text: '2\nnh3\nN 0 0 0\nH 0 0 1.01\n' }],
      },
    })
    expect(result.isError).toBeFalsy()

    // The structure landed only in the addressed window.
    expect(rightPage.mounted).toEqual(['NH3'])
    expect(leftPage.mounted).toEqual([])

    // The page cannot name itself, so the bridge stamps the resolved target.
    // Without this an agent cannot tell which window answered, and feeding the
    // reported id back would fail as unknown.
    const payload = result.structuredContent as { data: { viewport: { instanceId: string } } }
    expect(payload.data.viewport.instanceId).toBe('right')
  } finally {
    await client.close()
  }
})
