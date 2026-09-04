/**
 * The in-page agent's full path, end to end through the real WebMCP adapter:
 * discover the surface, read, propose under the default propose-only mode,
 * be denied on a direct write, have the user raise the host to read-write in
 * the Agent Access store, then apply. This is the chain a browser-hosted LLM
 * actually walks; a fake `document.modelContext` stands in for the browser.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ZatomStructure, ZatomToolContext, ZatomToolResult } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { fingerprintStructure } from '../structure-math'
import {
  registerZatomWebMcpTools,
  ZATOM_WEBMCP_REGISTERED_TOOLS,
  type ZatomWebMcpRegistration,
  type ZatomWebMcpToolCall,
} from '../webmcp-adapter'
import { readHostWriteMode, useHostAccess } from '../../orchestration/hostAccessStore'

type RegisteredTool = {
  name: string
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>
}

const water: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'water',
  atoms: [
    { id: 'o', element: 'O', position: [0, 0, 0] },
    { id: 'h1', element: 'H', position: [0.96, 0, 0] },
    { id: 'h2', element: 'H', position: [-0.24, 0.93, 0] },
  ],
}

function fakeModelContext() {
  const tools = new Map<string, RegisteredTool>()
  const modelContext = {
    registerTool: async (tool: RegisteredTool, options?: { signal?: AbortSignal }) => {
      tools.set(tool.name, tool)
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true })
    },
  }
  return { modelContext, tools }
}

/** What a browser-hosted agent does: every registry call goes through `zatom_call_tool`. */
async function call(
  tools: Map<string, RegisteredTool>,
  name: string,
  input: Record<string, unknown> = {},
  expectedWorkspace?: { viewportId: string; revision: number; structureFingerprint: string | null; trajectoryFingerprint: string | null },
) {
  const facade = tools.get('zatom_call_tool')
  if (!facade) throw new Error('facade not registered on the page')
  const raw = (await facade.execute(
    { name, input, ...(expectedWorkspace ? { expectedWorkspace } : {}) },
    { signal: new AbortController().signal },
  )) as { isError?: boolean; structuredContent: ZatomToolResult }
  return raw.structuredContent
}

/** Core tools use their native name/schema and do not need the facade envelope. */
async function callDirect(
  tools: Map<string, RegisteredTool>,
  name: string,
  input: Record<string, unknown> = {},
) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`direct core tool not registered on the page: ${name}`)
  const raw = (await tool.execute(
    input,
    { signal: new AbortController().signal },
  )) as { isError?: boolean; structuredContent: ZatomToolResult }
  return raw.structuredContent
}

describe('WebMCP host chain', () => {
  let current: ZatomStructure
  let writes: number
  let registration: ZatomWebMcpRegistration | undefined
  let calls: ZatomWebMcpToolCall[]
  const previousDocument = globalThis.document

  beforeEach(() => {
    current = structuredClone(water)
    writes = 0
    calls = []
    useHostAccess.setState({ modes: { ...useHostAccess.getState().modes, webmcp: 'propose-only' }, activities: [] })
  })

  afterEach(() => {
    registration?.unregister()
    registration = undefined
    ;(globalThis as { document?: unknown }).document = previousDocument
  })

  it('read → propose (blocked) → direct write denied → user raises mode → apply lands', async () => {
    const { modelContext, tools } = fakeModelContext()
    ;(globalThis as { document?: unknown }).document = { modelContext }

    const context: ZatomToolContext = {
      access: { host: 'webmcp', mode: () => readHostWriteMode('webmcp') },
      readStructure: () => structuredClone(current),
      writeStructure: (next) => { current = structuredClone(next); writes += 1 },
      workspaceIdentity: () => ({
        viewportId: 'vp-test',
        revision: 0,
        structureFingerprint: fingerprintStructure(current),
        trajectoryFingerprint: null,
      }),
    }
    registration = await registerZatomWebMcpTools({ context, onToolCall: (entry) => calls.push(entry) })

    // 1. Discovery: the page exposes the normal collaboration path directly
    //    and retains the facade for the rest of the registry. The index lists
    //    build tools but marks their domain disabled.
    expect([...tools.keys()].sort()).toEqual([...ZATOM_WEBMCP_REGISTERED_TOOLS].sort())
    const index = (await tools.get('zatom_domains')!.execute(
      {},
      { signal: new AbortController().signal },
    )) as { structuredContent: ZatomToolResult }
    const domains = (index.structuredContent.data as { domains: { name: string; enabled: boolean }[] }).domains
    expect(domains.find((d) => d.name === 'build')?.enabled).toBe(false)

    // 2. A directly registered core read works without describe/call routing
    //    and never consults write policy.
    const read = await callDirect(tools, 'scene_observe')
    expect(read.ok).toBe(true)
    const expectedWorkspace = {
      viewportId: 'vp-test',
      revision: 0,
      structureFingerprint: fingerprintStructure(current),
      trajectoryFingerprint: null,
    }

    // 3. A disabled domain is refused at call time with the way out named and
    //    the denial is recorded so the user can understand the interruption.
    const gated = await call(tools, 'structure_build_metal_cluster', { geometry: 'icosahedral', element: 'Pt', shells: 1 })
    expect(gated.ok).toBe(false)
    expect(gated.error?.code).toBe('domain_disabled')
    expect(gated.error?.message).toMatch(/Agent Access/)
    expect(calls.find((entry) => entry.tool === 'structure_build_metal_cluster')?.result.error?.code)
      .toBe('domain_disabled')

    // The user enables build + edit: the page re-registers with the new selection.
    registration.unregister()
    registration = await registerZatomWebMcpTools({
      context,
      domains: ['build', 'edit', 'direct-edit', 'viewport'],
      onToolCall: (entry) => calls.push(entry),
    })

    // 4. Compute under propose-only: the candidate comes back, the apply is
    //    gated with a reason, and nothing is written.
    const proposed = await call(tools, 'structure_build_metal_cluster', {
      geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
    }, expectedWorkspace)
    expect(proposed.ok).toBe(true)
    const envelope = proposed.data as { appliedToWorkspace: boolean; applicationBlocked: boolean; result: { structure: ZatomStructure } }
    expect(envelope.appliedToWorkspace).toBe(false)
    expect(envelope.applicationBlocked).toBe(true)
    expect(envelope.result.structure.atoms).toHaveLength(13)
    expect(proposed.checks?.find((check) => check.id === 'candidate.application_gate')?.status).toBe('fail')
    expect(writes).toBe(0)

    // 5. A direct mutate is refused before it runs, and the refusal is
    //    recorded so the Agent Access panel can show it beside the mode.
    const denied = await call(tools, 'structure_apply_operations', {
      operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }],
      applyToWorkspace: true,
    }, expectedWorkspace)
    expect(denied.ok).toBe(false)
    expect(denied.error?.code).toBe('host_policy_denied')
    expect(denied.error?.details).toMatchObject({ host: 'webmcp', mode: 'propose-only', tier: 'mutate' })
    expect(denied.error?.message).toMatch(/Propose only/)
    expect(writes).toBe(0)
    const deniedCall = calls.find((entry) => entry.tool === 'structure_apply_operations')
    expect(deniedCall?.result.error?.code).toBe('host_policy_denied')

    // The same host policy also protects a mutating core tool reached through
    // its direct descriptor; native exposure is not a second execution path.
    const directDenied = await callDirect(tools, 'workspace_undo', { expectedWorkspace })
    expect(directDenied.ok).toBe(false)
    expect(directDenied.error?.code).toBe('host_policy_denied')
    expect(writes).toBe(0)
    const directDeniedCall = calls.find((entry) => entry.tool === 'workspace_undo')
    expect(directDeniedCall?.result.error?.code).toBe('host_policy_denied')
    expect(directDeniedCall?.input).toEqual({})

    // 6. The user raises the host in the Agent Access store; the registry
    //    reads the mode per call, so the same tool now applies.
    useHostAccess.getState().setMode('webmcp', 'read-write')
    const applied = await call(tools, 'structure_apply_operations', {
      operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }],
      applyToWorkspace: true,
    }, expectedWorkspace)
    expect(applied.ok).toBe(true)
    expect(writes).toBe(1)
    expect(current.atoms[0].position[0]).toBeCloseTo(1, 6)
    expect(current.atoms[1].position[0]).toBeCloseTo(1.96, 6)

    // 7. Cleanup unregisters everything from the page.
    registration.unregister()
    expect(tools.size).toBe(0)
  })
})
