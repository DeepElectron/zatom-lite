// @vitest-environment happy-dom
//
// The WebMCP adapter locks down six properties of the direct core plus long-tail facade design.
//
// Chromium caps all tool descriptors registered on one page at 64 KiB and rejects the whole set rather
// than truncating it. The page registers a compact collaboration core directly and routes the remaining
// capabilities through three facades. Any core change must remeasure the complete descriptor payload.
//
// Domain gating remains the user's control. Direct tools hot-plug with their domain while stable system
// descriptors let the Agent request access; stale snapshots still fail closed at call time.
//
// AbortSignal is the sole teardown path. A registration must be fully reversible so StrictMode's double
// invocation cannot leave duplicate tools behind.

import { describe, expect, it } from 'vitest'

import type { ZatomStructure } from '../agent/contracts'
import {
  isReadOnlyTool,
  isWebMcpAvailable,
  registerZatomWebMcpTools,
  ZATOM_WEBMCP_CORE_TOOLS,
  ZATOM_WEBMCP_FACADE_TOOLS,
  ZATOM_WEBMCP_REGISTERED_TOOLS,
  ZATOM_WEBMCP_SYSTEM_TOOLS,
  type ZatomWebMcpAccessBroker,
} from '../agent/webmcp-adapter'
import { listZatomMcpTools, type McpToolCallResult, type McpToolDefinition } from '../agent/mcp-adapter'
import { zatomToolDomain, ZATOM_DEFAULT_TOOL_DOMAINS, ZATOM_TOOL_DOMAINS } from '../agent/domains'
import { createZatomWebMcpRuntimeProfile } from '../agent/webmcp-runtime-profile'
import { fingerprintStructure } from '../agent/structure-math'

/** Chromium's per-page cap on the serialized tool descriptors. */
const BROWSER_DESCRIPTOR_CAP_BYTES = 65_536
/** Leave room for browser metadata and small schema growth without a fire drill. */
const MIN_DESCRIPTOR_HEADROOM_BYTES = 4 * 1024
const ENGINEERING_DESCRIPTOR_BUDGET_BYTES = BROWSER_DESCRIPTOR_CAP_BYTES - MIN_DESCRIPTOR_HEADROOM_BYTES

const EXPECTED_CORE_TOOLS = [
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

const WATER: ZatomStructure = {
  schemaVersion: 'zatom.structure/v1',
  label: 'water',
  atoms: [
    { id: 'o', element: 'O', position: [0, 0, 0] },
    { id: 'h1', element: 'H', position: [0.96, 0, 0] },
    { id: 'h2', element: 'H', position: [-0.24, 0.93, 0] },
  ],
}

interface RegisteredEntry {
  descriptor: WebMCP.ModelContextTool
  options: WebMCP.ModelContextRegisterToolOptions | undefined
}

/**
 * Minimal modelContext substitute. It implements only registerTool and AbortSignal teardown because those
 * are the adapter's dependencies; browser-provided getTools/executeTool are outside this module's contract.
 */
function installFakeModelContext(config: {
  rejectOn?: string
  reject?: (name: string, occurrence: number) => boolean
  deferFirstOn?: string
} = {}) {
  const entries = new Map<string, RegisteredEntry>()
  const occurrences = new Map<string, number>()
  const deferred = new Map<string, () => void>()
  let registrationCount = 0
  const fake = {
    registerTool(
      descriptor: WebMCP.ModelContextTool,
      options?: WebMCP.ModelContextRegisterToolOptions,
    ): Promise<void> {
      registrationCount += 1
      const occurrence = (occurrences.get(descriptor.name) ?? 0) + 1
      occurrences.set(descriptor.name, occurrence)
      if (descriptor.name === config.rejectOn || config.reject?.(descriptor.name, occurrence)) {
        return Promise.reject(new Error(`rejected ${descriptor.name}`))
      }
      if (entries.has(descriptor.name)) return Promise.reject(new Error(`duplicate ${descriptor.name}`))
      const entry = { descriptor, options }
      entries.set(descriptor.name, entry)
      const remove = () => {
        if (entries.get(descriptor.name) === entry) entries.delete(descriptor.name)
      }
      if (options?.signal?.aborted) remove()
      else options?.signal?.addEventListener('abort', remove, {
        once: true,
      })
      if (descriptor.name === config.deferFirstOn && occurrence === 1) {
        return new Promise<void>((resolve) => deferred.set(descriptor.name, resolve))
      }
      return Promise.resolve()
    },
  }
  Object.defineProperty(document, 'modelContext', {
    value: fake,
    configurable: true,
    writable: true,
  })
  const call = async (
    name: string,
    input: Record<string, unknown> = {},
    signal = new AbortController().signal,
  ): Promise<McpToolCallResult> => {
    const entry = entries.get(name)
    if (!entry) throw new Error(`not registered: ${name}`)
    return (await entry.descriptor.execute(input, { signal })) as McpToolCallResult
  }
  return {
    names: () => [...entries.keys()],
    registrationCount: () => registrationCount,
    registrationCountFor: (name: string) => occurrences.get(name) ?? 0,
    releaseRegistration: (name: string) => {
      const resolve = deferred.get(name)
      deferred.delete(name)
      resolve?.()
    },
    get: (name: string) => entries.get(name),
    call,
    /** Serialized bytes of the name/title/description/inputSchema/annotations descriptors seen by the browser. */
    descriptorBytes: () =>
      [...entries.values()].reduce((sum, { descriptor }) => {
        const { execute: _execute, ...serializable } = descriptor
        return sum + new TextEncoder().encode(JSON.stringify(serializable)).byteLength
      }, 0),
    restore: () => {
      delete (document as { modelContext?: unknown }).modelContext
    },
  }
}

function createAccessBroker(
  initialDomains: readonly string[] = ['session'],
  initialDecision: 'once' | 'session' | 'always' | 'deny' | 'timeout' | 'cancelled' = 'once',
) {
  const exposed = new Set(initialDomains)
  const persistent = new Set(initialDomains)
  const oneCallAvailable = new Set<string>()
  const activeOneCall = new Set<string>()
  const listeners = new Set<() => void>()
  let decision = initialDecision
  let acquireCount = 0
  let requestCount = 0
  let lastRequest: { domain: string; tool: string; details?: readonly string[] } | null = null
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const broker: ZatomWebMcpAccessBroker = {
    getExposedDomains: () => [...exposed],
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    requiresInputDigest: ({ domain, tool }) => (
      [...oneCallAvailable].some((key) => key.startsWith(`${domain}:${tool}:sha256:`))
    ),
    acquire: ({ domain, tool, inputDigest, requireOnce }) => {
      const grantKey = `${domain}:${tool}:${inputDigest ?? ''}`
      if (!exposed.has(domain) || activeOneCall.has(grantKey)) return null
      if (oneCallAvailable.has(grantKey)) {
        acquireCount += 1
        oneCallAvailable.delete(grantKey)
        activeOneCall.add(grantKey)
        let released = false
        return {
          release: () => {
            if (released) return
            released = true
            activeOneCall.delete(grantKey)
            exposed.delete(domain)
            notify()
          },
        }
      }
      if (requireOnce) return null
      if (!persistent.has(domain)) return null
      acquireCount += 1
      return { release: () => undefined }
    },
    request: async ({ domain, tool, inputDigest, details }) => {
      requestCount += 1
      lastRequest = { domain, tool, ...(details ? { details } : {}) }
      if (decision === 'once' || decision === 'session' || decision === 'always') {
        exposed.add(domain)
        if (decision === 'once') oneCallAvailable.add(`${domain}:${tool}:${inputDigest ?? ''}`)
        else persistent.add(domain)
        notify()
      }
      return { decision, domain }
    },
  }
  return {
    broker,
    acquireCount: () => acquireCount,
    requestCount: () => requestCount,
    lastRequest: () => lastRequest,
    setDecision: (next: typeof decision) => { decision = next },
    setExposedDomains: (domains: readonly string[]) => {
      exposed.clear()
      persistent.clear()
      for (const domain of domains) exposed.add(domain)
      for (const domain of domains) persistent.add(domain)
      oneCallAvailable.clear()
      activeOneCall.clear()
      notify()
    },
  }
}

describe('WebMCP direct core and facade', () => {
  it('缺少 document.modelContext 时报告不可用,并拒绝注册', async () => {
    expect(isWebMcpAvailable()).toBe(false)
    await expect(registerZatomWebMcpTools()).rejects.toThrow(/WebMCP is unavailable/)
  })

  it('registers the collaboration core plus stable discovery/access tools under the browser budget', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ZATOM_TOOL_DOMAINS.map((d) => d.name) })
      expect(fake.names().sort()).toEqual([...ZATOM_WEBMCP_REGISTERED_TOOLS].sort())
      expect(fake.names().slice(0, ZATOM_WEBMCP_CORE_TOOLS.length)).toEqual([...ZATOM_WEBMCP_CORE_TOOLS])
      expect(fake.names().slice(
        ZATOM_WEBMCP_CORE_TOOLS.length,
        ZATOM_WEBMCP_CORE_TOOLS.length + ZATOM_WEBMCP_FACADE_TOOLS.length,
      )).toEqual([...ZATOM_WEBMCP_FACADE_TOOLS])
      expect(fake.names().slice(-ZATOM_WEBMCP_SYSTEM_TOOLS.length)).toEqual([...ZATOM_WEBMCP_SYSTEM_TOOLS])
      expect([...handle.registered].sort()).toEqual([...ZATOM_WEBMCP_REGISTERED_TOOLS].sort())
      expect(ZATOM_WEBMCP_CORE_TOOLS).toEqual(EXPECTED_CORE_TOOLS)
      expect(ZATOM_WEBMCP_FACADE_TOOLS).toHaveLength(3)
      expect(ZATOM_WEBMCP_SYSTEM_TOOLS).toEqual(['zatom_request_access'])
      // Enabling every domain makes the full registry callable, while the page carries schemas only for the stable core.
      expect(handle.callable.length).toBeGreaterThan(100)
      expect(fake.descriptorBytes()).toBeLessThanOrEqual(ENGINEERING_DESCRIPTOR_BUDGET_BYTES)
      expect(fake.descriptorBytes()).toBeLessThan(BROWSER_DESCRIPTOR_CAP_BYTES)
      expect(BROWSER_DESCRIPTOR_CAP_BYTES - fake.descriptorBytes()).toBeGreaterThanOrEqual(MIN_DESCRIPTOR_HEADROOM_BYTES)
    } finally {
      fake.restore()
    }
  })

  it('hot-plugs direct descriptors by domain without re-registering stable tools', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['io'] })
      expect(fake.names()).toEqual([
        'structure_import_text',
        'structure_check_sanity',
        ...ZATOM_WEBMCP_FACADE_TOOLS,
        ...ZATOM_WEBMCP_SYSTEM_TOOLS,
      ])
      expect(handle.callable).toContain('structure_validate')
      expect(handle.callable).not.toContain('structure_build_metal_cluster')

      const update = handle.setDomains(['viewport', 'not-a-domain'])
      // Revocation and the call gate are synchronous even though additions use registerTool promises.
      expect(fake.names()).not.toContain('structure_import_text')
      expect(handle.domains).toEqual(['session', 'viewport'])
      expect(handle.unknownDomains).toEqual(['not-a-domain'])
      expect(handle.callable).toContain('scene_observe')
      expect(handle.callable).not.toContain('structure_validate')
      await update
      const expectedDirect = ZATOM_WEBMCP_CORE_TOOLS.filter((name) => zatomToolDomain(name) === 'viewport')
      expect(fake.names()).toEqual([
        ...ZATOM_WEBMCP_FACADE_TOOLS,
        ...ZATOM_WEBMCP_SYSTEM_TOOLS,
        ...expectedDirect,
      ])
      expect(handle.registered).toEqual([
        ...expectedDirect,
        ...ZATOM_WEBMCP_FACADE_TOOLS,
        ...ZATOM_WEBMCP_SYSTEM_TOOLS,
      ])
      for (const name of [...ZATOM_WEBMCP_FACADE_TOOLS, ...ZATOM_WEBMCP_SYSTEM_TOOLS]) {
        expect(fake.registrationCountFor(name)).toBe(1)
      }
      expect(createZatomWebMcpRuntimeProfile({ domains: handle.domains }).tools.callable).toBe(handle.callable.length)

      const index = await fake.call('zatom_domains')
      const domains = (index.structuredContent.data as { domains: { name: string; enabled: boolean }[] }).domains
      expect(domains.find((domain) => domain.name === 'viewport')?.enabled).toBe(true)
      expect(domains.find((domain) => domain.name === 'io')?.enabled).toBe(false)
    } finally {
      fake.restore()
    }
  })

  it('replays access changed while the initial browser registration was pending', async () => {
    const fake = installFakeModelContext({ deferFirstOn: 'scene_observe' })
    const access = createAccessBroker(['session', 'viewport'])
    try {
      const pendingRegistration = registerZatomWebMcpTools({ accessBroker: access.broker })
      await Promise.resolve()
      access.setExposedDomains(['session', 'io'])
      fake.releaseRegistration('scene_observe')
      const handle = await pendingRegistration

      expect(handle.domains).toEqual(['session', 'io'])
      expect(fake.get('scene_observe')).toBeUndefined()
      expect(fake.get('structure_import_text')).toBeDefined()
    } finally {
      fake.restore()
    }
  })

  it('serializes rapid domain toggles without duplicate descriptors', async () => {
    const fake = installFakeModelContext({ deferFirstOn: 'scene_observe' })
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['session'] })
      const first = handle.setDomains(['viewport'])
      await Promise.resolve()
      const second = handle.setDomains(['io'])
      const final = handle.setDomains(['viewport'])
      fake.releaseRegistration('scene_observe')
      await Promise.all([first, second, final])

      expect(handle.domains).toEqual(['session', 'viewport'])
      expect(fake.registrationCountFor('scene_observe')).toBe(2)
      expect(new Set(fake.names()).size).toBe(fake.names().length)
      expect(handle.registered.filter((name) => name === 'scene_observe')).toHaveLength(1)
      expect(fake.get('structure_import_text')).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('rolls back a failed hot-plug update and reports only settled exposure snapshots', async () => {
    const fake = installFakeModelContext({
      reject: (name, occurrence) => name === 'scene_observe' && occurrence === 1,
    })
    const exposure: Array<{ registered: readonly string[]; domains: readonly string[] }> = []
    try {
      const handle = await registerZatomWebMcpTools({
        domains: ['io'],
        onExposureChange: (registered, domains) => exposure.push({ registered: [...registered], domains: [...domains] }),
      })
      await expect(handle.setDomains(['viewport'])).rejects.toThrow(/rejected scene_observe/)

      expect(handle.domains).toEqual(['session', 'io'])
      expect(handle.registered).toContain('structure_import_text')
      expect(handle.registered).not.toContain('scene_observe')
      expect(fake.get('scene_observe')).toBeUndefined()
      expect(new Set(fake.names()).size).toBe(fake.names().length)
      expect(exposure.map((entry) => entry.domains)).toEqual([
        ['session', 'io'],
        ['session', 'io'],
      ])
      expect(exposure.at(-1)?.registered).toEqual(handle.registered)
    } finally {
      fake.restore()
    }
  })

  it('注册中途失败会撤销已经注册的 facade 工具', async () => {
    const fake = installFakeModelContext({ rejectOn: 'zatom_describe_tools' })
    try {
      await expect(registerZatomWebMcpTools()).rejects.toThrow(/rejected zatom_describe_tools/)
      expect(fake.names()).toEqual([])
    } finally {
      fake.restore()
    }
  })

  it('zatom_domains 给出工作流和按域分组的完整索引,含启用状态', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({ domains: ['io'] })
      const result = await fake.call('zatom_domains')
      expect(result.isError).toBeUndefined()
      const data = result.structuredContent.data as {
        workflow: string[]
        domains: { name: string; enabled: boolean; tools: { name: string; title: string; readOnly: boolean }[] }[]
      }
      expect(data.workflow.length).toBeGreaterThan(3)
      const byName = new Map(data.domains.map((d) => [d.name, d]))
      expect(byName.get('session')?.enabled).toBe(true)
      expect(byName.get('io')?.enabled).toBe(true)
      expect(byName.get('build')?.enabled).toBe(false)
      // Disabled-domain tools stay indexed so the Agent can discover them even though it cannot invoke them.
      expect(byName.get('build')?.tools.length).toBeGreaterThan(0)
      // The registry's two per-tool host controls are intentionally absent from the facade index.
      const allListed = data.domains.flatMap((d) => d.tools.map((t) => t.name))
      expect(allListed).not.toContain('zatom_enable_domains')
      expect(allListed).not.toContain('zatom_domains')
    } finally {
      fake.restore()
    }
  })

  it('zatom_describe_tools 返回 description 与 inputSchema,并区分未知/被禁', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({ domains: ['viewport'] })
      const result = await fake.call('zatom_describe_tools', {
        names: ['workspace_get_active_structure', 'structure_build_metal_cluster', 'no_such_tool'],
      })
      const data = result.structuredContent.data as {
        tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; enabled: boolean }[]
        unknown: string[]
        disabled: string[]
      }
      expect(data.tools.map((t) => t.name)).toEqual(['workspace_get_active_structure', 'structure_build_metal_cluster'])
      expect(data.tools[0]!.description.length).toBeGreaterThan(20)
      expect(data.tools[0]!.inputSchema).toMatchObject({ type: 'object' })
      expect(data.tools[0]!.readOnly).toBe(true)
      expect(data.tools[0]!.enabled).toBe(true)
      expect(data.tools[1]!.enabled).toBe(false)
      expect(data.tools[1]!.inputSchema).toMatchObject({ type: 'object' })
      expect(data.disabled).toEqual(['structure_build_metal_cluster'])
      expect(data.unknown).toEqual(['no_such_tool'])

      const tooMany = await fake.call('zatom_describe_tools', {
        names: listZatomMcpTools().slice(0, 40).map((t) => t.name),
      })
      expect(tooMany.isError).toBe(true)
      expect(tooMany.structuredContent.error?.code).toBe('invalid_input')
    } finally {
      fake.restore()
    }
  })

  it('zatom_call_tool 在被禁域上拒绝并说明由用户启用;未知工具指回索引', async () => {
    const fake = installFakeModelContext()
    const audited: Array<{ tool: string; code?: string }> = []
    try {
      await registerZatomWebMcpTools({
        domains: ['io'],
        onToolCall: ({ tool, result }) => audited.push({ tool, code: result.error?.code }),
      })
      const disabled = await fake.call('zatom_call_tool', {
        name: 'structure_build_metal_cluster',
        input: { geometry: 'icosahedral', element: 'Pt', shells: 1 },
      })
      expect(disabled.isError).toBe(true)
      expect(disabled.structuredContent.error?.code).toBe('domain_disabled')
      expect(disabled.structuredContent.error?.message).toMatch(/Agent Access/)
      expect(audited).toContainEqual({ tool: 'structure_build_metal_cluster', code: 'domain_disabled' })

      const unknown = await fake.call('zatom_call_tool', { name: 'no_such_tool' })
      expect(unknown.structuredContent.error?.code).toBe('unknown_tool')

      // The Agent cannot widen its enabled domains through the facade.
      const enable = await fake.call('zatom_call_tool', { name: 'zatom_enable_domains', input: { domains: ['build'] } })
      expect(enable.structuredContent.error?.code).toBe('unknown_tool')
    } finally {
      fake.restore()
    }
  })

  it('keeps access negotiation stable, validates its copy, and audits every outcome', async () => {
    const fake = installFakeModelContext()
    const starts: Array<{ tool: string; cancel: () => void }> = []
    const completions: Array<{ tool: string; code?: string }> = []
    try {
      await registerZatomWebMcpTools({
        domains: ['io'],
        onToolCallStart: ({ tool, cancel }) => starts.push({ tool, cancel: cancel! }),
        onToolCall: ({ tool, result }) => completions.push({ tool, code: result.error?.code }),
      })
      const already = await fake.call('zatom_request_access', {
        domain: 'io',
        tool: 'structure_import_text',
        toolInput: { format: 'xyz', text: '1\nH\nH 0 0 0\n' },
        reason: 'Import the structure selected by the user.',
      })
      expect(already.structuredContent.data).toMatchObject({ decision: 'already_allowed', exposed: true })

      const unavailable = await fake.call('zatom_request_access', {
        domain: 'build',
        tool: 'structure_build_metal_cluster',
        toolInput: { geometry: 'icosahedral', element: 'Pt', shells: 1 },
        reason: 'Build a crystal candidate.',
      })
      expect(unavailable.structuredContent.error?.code).toBe('access_request_unavailable')

      const mismatch = await fake.call('zatom_request_access', {
        domain: 'io',
        tool: 'scene_observe',
        toolInput: {},
        reason: 'Use the named tool.',
      })
      expect(mismatch.structuredContent.error?.code).toBe('tool_domain_mismatch')

      const invalid = await fake.call('zatom_request_access', {
        domain: 'not-a-domain',
        tool: 'scene_observe',
        toolInput: {},
        reason: 'Use an unknown capability.',
      })
      expect(invalid.structuredContent.error?.code).toBe('invalid_domain')
      expect(starts).toHaveLength(4)
      expect(starts.every((entry) => entry.tool === 'zatom_request_access')).toBe(true)
      expect(starts.every((entry) => typeof entry.cancel === 'function')).toBe(true)
      expect(completions.map((entry) => entry.code)).toEqual([
        undefined,
        'access_request_unavailable',
        'tool_domain_mismatch',
        'invalid_domain',
      ])
    } finally {
      fake.restore()
    }
  })

  it('accepts a host that omits the optional execution AbortSignal', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({
        domains: ['viewport'],
        context: { readStructure: () => WATER },
      })
      const executeWithoutOptions = async (name: string, input: Record<string, unknown>) => {
        const execute = fake.get(name)!.descriptor.execute as unknown as (
          input: Record<string, unknown>,
          options?: { signal?: AbortSignal },
        ) => Promise<McpToolCallResult>
        return execute(input)
      }

      const observed = await executeWithoutOptions('scene_observe', {})
      expect(observed.structuredContent.ok).toBe(true)
      const alreadyAllowed = await executeWithoutOptions('zatom_request_access', {
        domain: 'viewport',
        tool: 'scene_observe',
        toolInput: {},
        reason: 'Inspect the shared scene.',
      })
      expect(alreadyAllowed.structuredContent.data).toMatchObject({ decision: 'already_allowed' })
    } finally {
      fake.restore()
    }
  })

  it('hot-plugs an allow-once domain without consuming it until the authorized call finishes', async () => {
    const fake = installFakeModelContext()
    const access = createAccessBroker()
    try {
      const handle = await registerZatomWebMcpTools({
        accessBroker: access.broker,
        context: { readStructure: () => WATER },
      })
      expect(fake.names()).toEqual([
        ...ZATOM_WEBMCP_FACADE_TOOLS,
        ...ZATOM_WEBMCP_SYSTEM_TOOLS,
      ])

      const granted = await fake.call('zatom_request_access', {
        domain: 'viewport',
        tool: 'scene_observe',
        toolInput: {},
        reason: 'Identify the unknown structure in the shared viewport.',
      })
      expect(granted.structuredContent.data).toMatchObject({
        decision: 'once',
        domain: 'viewport',
        exposed: true,
      })
      expect(access.requestCount()).toBe(1)
      expect(access.acquireCount()).toBe(0)
      expect(fake.get('scene_observe')).toBeDefined()

      const wrongTool = await fake.call('viewer_observe')
      expect(wrongTool.structuredContent.error?.code).toBe('domain_disabled')
      expect(access.acquireCount()).toBe(0)
      expect(fake.get('scene_observe')).toBeDefined()

      const observed = await fake.call('scene_observe')
      expect(observed.structuredContent.ok).toBe(true)
      expect(access.acquireCount()).toBe(1)
      expect(handle.domains).toEqual(['session'])
      expect(fake.get('scene_observe')).toBeUndefined()

      access.setDecision('deny')
      const denied = await fake.call('zatom_request_access', {
        domain: 'viewport',
        tool: 'scene_observe',
        toolInput: {},
        reason: 'Inspect the viewport again.',
      })
      expect(denied.structuredContent.data).toMatchObject({ decision: 'deny', exposed: false })
      expect(fake.get('scene_observe')).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('binds a normal one-call grant to the exact intended input', async () => {
    const fake = installFakeModelContext()
    const access = createAccessBroker()
    try {
      await registerZatomWebMcpTools({ accessBroker: access.broker })
      await fake.call('zatom_request_access', {
        domain: 'viewport',
        tool: 'viewer_observe',
        toolInput: { neighborCount: 4 },
        reason: 'Read the selected atom and four neighbours.',
      })

      const switched = await fake.call('viewer_observe', { neighborCount: 5 })
      expect(switched.structuredContent.error?.code).toBe('domain_disabled')
      expect(fake.get('viewer_observe')).toBeDefined()

      const exact = await fake.call('viewer_observe', { neighborCount: 4 })
      expect(exact.structuredContent.error?.code).not.toBe('domain_disabled')
      expect(fake.get('viewer_observe')).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('uses the same permission canonicalization before and after direct fingerprint injection', async () => {
    const fake = installFakeModelContext()
    const access = createAccessBroker()
    const identity = {
      viewportId: 'vp-direct-permission',
      revision: 3,
      structureFingerprint: fingerprintStructure(WATER),
      trajectoryFingerprint: null,
    }
    try {
      await registerZatomWebMcpTools({
        accessBroker: access.broker,
        context: { readStructure: () => WATER, workspaceIdentity: () => identity },
      })
      await fake.call('zatom_request_access', {
        domain: 'surface',
        tool: 'structure_ensure_slab_vacuum',
        toolInput: { minimumVacuumA: 12 },
        expectedWorkspace: identity,
        reason: 'Check whether the current slab needs 12 Å of vacuum.',
      })

      const result = await fake.call('structure_ensure_slab_vacuum', {
        minimumVacuumA: 12,
        expectedWorkspace: identity,
      })
      expect(result.structuredContent.error?.code).not.toBe('domain_disabled')
      expect(fake.get('structure_ensure_slab_vacuum')).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('removes disabled direct tools and rejects a stale Agent snapshot at call time', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({
        domains: ['viewport'],
        context: { readStructure: () => WATER },
      })
      expect(handle.registered).toContain('scene_observe')
      const staleDescriptor = fake.get('scene_observe')!.descriptor

      const revoke = handle.setDomains(['io'])
      expect(fake.get('scene_observe')).toBeUndefined()
      const disabled = await staleDescriptor.execute({}, { signal: new AbortController().signal }) as McpToolCallResult
      expect(disabled.isError).toBe(true)
      expect(disabled.structuredContent.tool).toBe('scene_observe')
      expect(disabled.structuredContent.error?.code).toBe('domain_disabled')
      await revoke

      await handle.setDomains(['viewport'])
      const direct = await fake.call('scene_observe')
      expect(direct.isError).toBeUndefined()
      expect(direct.structuredContent.ok).toBe(true)
    } finally {
      fake.restore()
    }
  })

  it('核心直调与 facade 路由返回等价结果,且活动回调记录真实工具名', async () => {
    const fake = installFakeModelContext()
    const starts: string[] = []
    const completions: string[] = []
    try {
      await registerZatomWebMcpTools({
        domains: ['viewport'],
        context: { readStructure: () => WATER },
        onToolCallStart: (entry) => starts.push(entry.tool),
        onToolCall: (entry) => completions.push(entry.tool),
      })
      const direct = await fake.call('scene_observe')
      const routed = await fake.call('zatom_call_tool', {
        name: 'scene_observe',
        input: { structure: WATER },
      })
      expect(direct.structuredContent).toEqual(routed.structuredContent)
      expect(starts).toEqual(['scene_observe', 'scene_observe'])
      expect(completions).toEqual(['scene_observe', 'scene_observe'])
    } finally {
      fake.restore()
    }
  })

  it('direct schema 只描述当前 viewport,detached structure 仍可通过 facade 使用', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({
        domains: ['viewport', 'guide', 'edit', 'io', 'surface'],
        context: { readStructure: () => WATER },
      })
      const propertiesOf = (name: string): Record<string, unknown> => (
        (fake.get(name)?.descriptor.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}
      )
      const requiredOf = (name: string): string[] => (
        (fake.get(name)?.descriptor.inputSchema as { required?: string[] } | undefined)?.required ?? []
      )
      const liveStructureTools = [
        'scene_observe',
        'scene_resolve_reference',
        'structure_select_atoms',
        'structure_measure_geometry',
        'structure_analyze_local_environment',
        'structure_check_sanity',
        'structure_place_adsorbate',
        'structure_ensure_slab_vacuum',
        'structure_build_miller_slab',
      ]
      for (const name of liveStructureTools) {
        const properties = propertiesOf(name)
        expect(properties.structure, `${name} must not repeat the detached structure schema`).toBeUndefined()
      }
      const focusProperties = propertiesOf('viewer_focus_target')
      expect(focusProperties.expectedStructureFingerprint).toBeUndefined()
      expect(focusProperties.expectedTrajectoryFingerprint).toBeUndefined()
      expect(requiredOf('viewer_focus_target')).toContain('expectedWorkspace')
      expect(requiredOf('guide_present_candidates')).toContain('expectedWorkspace')
      expect(requiredOf('structure_select_atoms')).toContain('expectedWorkspace')
      for (const name of ['structure_propose_operations', 'structure_pose_component', 'structure_ensure_slab_vacuum']) {
        const properties = propertiesOf(name)
        expect(properties.expectedFingerprint, `${name} must use expectedWorkspace instead`).toBeUndefined()
      }
      expect(fake.get('structure_propose_operations')?.descriptor.description).not.toContain('expectedFingerprint')
      // Adsorption-site provenance is not the same thing as active-workspace CAS
      // and must remain explicit so a stale site id cannot be rebound by luck.
      const placementProperties = propertiesOf('structure_place_adsorbate')
      expect(placementProperties.expectedSourceFingerprint).toBeDefined()
      expect(placementProperties.expectedResultFingerprint).toBeDefined()

      const rejected = await fake.call('scene_observe', { structure: WATER })
      expect(rejected.isError).toBe(true)
      expect(rejected.structuredContent.error?.code).toBe('direct_live_viewport_only')
      expect(rejected.structuredContent.error?.message).toMatch(/zatom_call_tool/)

      const detached = await fake.call('zatom_call_tool', {
        name: 'scene_observe',
        input: { structure: WATER },
      })
      expect(detached.structuredContent.ok).toBe(true)
    } finally {
      fake.restore()
    }
  })

  it('direct visual tools derive legacy fingerprints from the one expectedWorkspace identity', async () => {
    const fake = installFakeModelContext()
    const structureFingerprint = fingerprintStructure(WATER)
    const identity = {
      viewportId: 'vp-live',
      revision: 12,
      structureFingerprint,
      trajectoryFingerprint: null,
    }
    const starts: Array<{ tool: string; input: Record<string, unknown> }> = []
    let focused = 0
    try {
      await registerZatomWebMcpTools({
        domains: ['viewport', 'surface'],
        context: {
          readStructure: () => WATER,
          workspaceIdentity: () => identity,
          focusInspectionTarget: () => {
            focused += 1
            return null
          },
        },
        onToolCallStart: ({ tool, input }) => starts.push({ tool, input }),
      })

      const focus = await fake.call('viewer_focus_target', {
        atomIds: ['o'],
        captureAfter: false,
        expectedWorkspace: identity,
      })
      expect(focus.structuredContent.ok).toBe(true)
      expect(focused).toBe(1)
      expect(starts.find((entry) => entry.tool === 'viewer_focus_target')?.input).toMatchObject({
        expectedStructureFingerprint: structureFingerprint,
      })

      // A hidden legacy value supplied by a non-validating host cannot
      // contradict the canonical viewport identity; it is replaced, not used.
      await fake.call('structure_ensure_slab_vacuum', {
        expectedFingerprint: 'fnv1a64:stale',
        expectedWorkspace: identity,
      })
      expect(starts.find((entry) => entry.tool === 'structure_ensure_slab_vacuum')?.input).toMatchObject({
        expectedFingerprint: structureFingerprint,
      })
    } finally {
      fake.restore()
    }
  })

  it('核心直调把 WebMCP 取消信号传给底层工具', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({ domains: ['viewport'], context: { readStructure: () => WATER } })
      const controller = new AbortController()
      controller.abort()
      const result = await fake.call('scene_observe', {}, controller.signal)
      expect(result.isError).toBe(true)
      expect(result.structuredContent.error?.code).toBe('tool_execution_aborted')
    } finally {
      fake.restore()
    }
  })

  it('aborts an in-flight facade call immediately when its domain is revoked', async () => {
    const fake = installFakeModelContext()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    let receivedAbort = false
    try {
      const handle = await registerZatomWebMcpTools({
        domains: ['guide'],
        context: {
          guidance: {
            candidateStatus: (_candidateSetId: string, _waitMs: number, signal?: AbortSignal) => (
              new Promise((_, reject) => {
                markStarted?.()
                const abort = () => {
                  receivedAbort = true
                  reject(new DOMException('Aborted', 'AbortError'))
                }
                if (signal?.aborted) abort()
                else signal?.addEventListener('abort', abort, { once: true })
              })
            ),
          } as never,
        },
      })
      const pending = fake.call('zatom_call_tool', {
        name: 'guide_candidate_status',
        input: { candidateSetId: 'set-1', waitMs: 30_000 },
      })
      await started

      const update = handle.setDomains(['io'])
      const result = await pending
      await update
      expect(receivedAbort).toBe(true)
      expect(result.structuredContent.ok).toBe(false)
    } finally {
      fake.restore()
    }
  })

  it('offers Cancel for safe work but not after a workspace commit can begin', async () => {
    const fake = installFakeModelContext()
    const identity = {
      viewportId: 'vp-cancel-policy',
      revision: 2,
      structureFingerprint: fingerprintStructure(WATER),
      trajectoryFingerprint: null,
    }
    const starts: Array<{ tool: string; cancel?: () => void }> = []
    try {
      await registerZatomWebMcpTools({
        domains: ['viewport'],
        context: {
          readStructure: () => WATER,
          workspaceIdentity: () => identity,
          viewport: {
            describe: () => ({ instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1', '1x2'], slots: [] }),
            setLayout: (layout) => ({ instanceId: 'in-page', layout, availableLayouts: ['1x1', '1x2'], slots: [] }),
            activate: () => ({ instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1'], slots: [] }),
            clear: () => ({ instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1'], slots: [] }),
            mount: () => ({ instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1'], slots: [] }),
          },
        },
        onToolCallStart: ({ tool, cancel }) => starts.push({ tool, ...(cancel ? { cancel } : {}) }),
      })

      await fake.call('scene_observe')
      await fake.call('viewport_set_layout', { layout: '1x2', expectedWorkspace: identity })
      expect(typeof starts.find((entry) => entry.tool === 'scene_observe')?.cancel).toBe('function')
      expect(starts.find((entry) => entry.tool === 'viewport_set_layout')?.cancel).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('cancels a deferred builder before commit but finishes atomically after commit starts', async () => {
    const fake = installFakeModelContext()
    const identity = {
      viewportId: 'vp-atomic-commit',
      revision: 4,
      structureFingerprint: fingerprintStructure(WATER),
      trajectoryFingerprint: null,
    }
    let releaseRead: (() => void) | undefined
    let markReadStarted: (() => void) | undefined
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve })
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve })
    let releaseWrite: (() => void) | undefined
    let markWriteStarted: (() => void) | undefined
    const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve })
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    let writes = 0
    try {
      const handle = await registerZatomWebMcpTools({
        domains: ['surface', 'io'],
        context: {
          workspaceIdentity: () => identity,
          readStructure: async () => {
            markReadStarted?.()
            await readGate
            return WATER
          },
          writeStructure: async (_structure, _expected, _signal, onCommitStart) => {
            onCommitStart?.()
            markWriteStarted?.()
            await writeGate
            writes += 1
          },
        },
      })

      const cancelledBuilder = fake.call('structure_build_miller_slab', {
        miller: [1, 1, 1],
        applyToWorkspace: true,
        expectedWorkspace: identity,
      })
      await readStarted
      const revokeSurface = handle.setDomains(['io'])
      releaseRead?.()
      const cancelledResult = await cancelledBuilder
      await revokeSurface
      expect(cancelledResult.structuredContent.error?.code).toBe('tool_execution_aborted')
      expect(writes).toBe(0)

      const committingImport = fake.call('structure_import_text', {
        format: 'xyz',
        text: '1\natomic commit\nH 0 0 0\n',
        applyToWorkspace: true,
        expectedWorkspace: identity,
      })
      await writeStarted
      const revokeIo = handle.setDomains(['viewport'])
      releaseWrite?.()
      const committedResult = await committingImport
      await revokeIo
      expect(committedResult.structuredContent.error?.code).not.toBe('tool_execution_aborted')
      expect(writes).toBe(1)
    } finally {
      fake.restore()
    }
  })

  it('视觉/工作区操作强制绑定 viewport revision 并拒绝 ABA/stale 调用', async () => {
    const fake = installFakeModelContext()
    try {
      const identity = {
        viewportId: 'vp-guarded',
        revision: 9,
        structureFingerprint: 'fnv1a64:guarded',
        trajectoryFingerprint: null,
      }
      let layoutWrites = 0
      let activations = 0
      let clearTarget: unknown = null
      await registerZatomWebMcpTools({
        domains: ['viewport', 'edit'],
        context: {
          workspaceIdentity: () => identity,
          viewport: {
            describe: () => ({
              instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1', '1x2'], slots: [],
            }),
            activate: (slotId) => {
              activations += 1
              return {
                instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1', '1x2'], slots: [{
                  slotId, slotIndex: 0, kind: 'crystal', label: slotId, structureLabel: null, atomCount: 0, active: true,
                }],
              }
            },
            setLayout: (layout) => {
              layoutWrites += 1
              return { instanceId: 'in-page', layout, availableLayouts: ['1x1', '1x2'], slots: [] }
            },
            clear: (slotId, options) => {
              clearTarget = { slotId, expectedTarget: options.expectedTarget }
              return { instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1'], slots: [] }
            },
            mount: () => ({ instanceId: 'in-page', layout: '1x1', availableLayouts: ['1x1'], slots: [] }),
          },
        },
      })

      const missing = await fake.call('viewport_activate', { slotId: 'vp-2' })
      expect(missing.structuredContent.tool).toBe('viewport_activate')
      expect(missing.structuredContent.error?.code).toBe('expected_workspace_required')

      const missingRefinementIdentity = await fake.call('structure_pose_component', {
        proposalId: 'proposal-1',
        expectedPreviewRevision: 1,
        expectedCandidateFingerprint: 'fnv1a64:candidate',
        componentAtomIds: ['o', 'h1', 'h2'],
        anchorAtomId: 'o',
        directionAtomIds: ['h1'],
        target: { kind: 'vector', vector: [0, 0, 1] },
      })
      expect(missingRefinementIdentity.structuredContent.error?.code).toBe('expected_workspace_required')

      const stale = await fake.call('viewport_activate', {
        slotId: 'vp-2',
        expectedWorkspace: { ...identity, revision: 8 },
      })
      expect(stale.structuredContent.tool).toBe('viewport_activate')
      expect(stale.structuredContent.error?.code).toBe('workspace_conflict')
      expect(activations).toBe(0)

      const current = await fake.call('viewport_activate', { slotId: 'vp-2', expectedWorkspace: identity })
      expect(current.structuredContent.ok).toBe(true)
      expect(current.structuredContent.summary).toContain('vp-2')
      expect(activations).toBe(1)

      const cleared = await fake.call('viewport_clear_pane', {
        slotId: 'vp-side',
        targetStructureFingerprint: 'fnv1a64:side',
        targetTrajectoryFingerprint: null,
        targetWorkspaceRevision: 3,
        expectedWorkspace: identity,
      })
      expect(cleared.structuredContent.ok).toBe(true)
      expect(clearTarget).toEqual({
        slotId: 'vp-side',
        expectedTarget: {
          slotId: 'vp-side',
          structureFingerprint: 'fnv1a64:side',
          trajectoryFingerprint: null,
          workspaceRevision: 3,
        },
      })

      const routed = await fake.call('zatom_call_tool', {
        name: 'viewport_set_layout', input: { layout: '1x2' }, expectedWorkspace: identity,
      })
      expect(routed.structuredContent.ok).toBe(true)
      expect(layoutWrites).toBe(1)
    } finally {
      fake.restore()
    }
  })

  it('未知域名反馈在 handle 上,不被静默忽略;session 永远在', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['io', 'not-a-domain'] })
      expect(handle.unknownDomains).toEqual(['not-a-domain'])
      expect(handle.domains).toEqual(['session', 'io'])
    } finally {
      fake.restore()
    }
  })

  it('默认域与 MCP 新连接一致', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools()
      expect(handle.domains).toEqual([...ZATOM_DEFAULT_TOOL_DOMAINS])
      for (const name of handle.callable) {
        expect(ZATOM_DEFAULT_TOOL_DOMAINS).toContain(zatomToolDomain(name))
      }
    } finally {
      fake.restore()
    }
  })

  it('unregister() 整体撤销,可重复调用;外部 signal abort 等价', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['io'] })
      expect(fake.names()).toEqual(handle.registered)
      handle.unregister()
      expect(fake.names()).toEqual([])
      handle.unregister()

      const controller = new AbortController()
      const signalled = await registerZatomWebMcpTools({ domains: ['io'], signal: controller.signal })
      expect(fake.names()).toEqual(signalled.registered)
      controller.abort()
      expect(fake.names()).toEqual([])

      const aborted = new AbortController()
      aborted.abort()
      const none = await registerZatomWebMcpTools({ domains: ['io'], signal: aborted.signal })
      expect(none.registered).toEqual([])
      expect(fake.names()).toEqual([])
    } finally {
      fake.restore()
    }
  })

  // zatom_call_tool can write and must never carry readOnlyHint. Direct descriptors follow effects
  // conservatively so the Agent cannot mistake a visible operation for a safely retryable read.
  it('facade 与核心工具的 readOnlyHint 与 effects 一致', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools()
      expect(fake.get('zatom_domains')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('zatom_describe_tools')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('zatom_request_access')?.descriptor.annotations?.readOnlyHint ?? false).toBe(false)
      expect(fake.get('zatom_call_tool')?.descriptor.annotations?.readOnlyHint ?? false).toBe(false)
      expect(fake.get('zatom_call_tool')?.descriptor.annotations?.untrustedContentHint).toBe(true)
      expect(fake.get('scene_observe')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('guide_candidate_status')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('structure_propose_operations')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('structure_cancel_proposal')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('workspace_undo')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('assets_list_local_directory')).toBeUndefined()
      expect(fake.get('assets_mount_visualization_bundle')).toBeUndefined()
    } finally {
      fake.restore()
    }
  })

  it('isReadOnlyTool 对 structure 的 create/replace 判为写', () => {
    const withStructure = (
      structure: McpToolDefinition['effects']['structure'],
    ): McpToolDefinition => ({
      name: 'x',
      title: 'x',
      version: '1',
      description: 'x',
      inputSchema: {},
      effects: { structure, workspace: 'none', visual: 'none' },
      tags: [],
    })
    expect(isReadOnlyTool(withStructure('none'))).toBe(true)
    expect(isReadOnlyTool(withStructure('read'))).toBe(true)
    expect(isReadOnlyTool(withStructure('create'))).toBe(false)
    expect(isReadOnlyTool(withStructure('replace'))).toBe(false)
  })

  // src/app/main.tsx registers the session domain before the local workspace is ready, allowing startup
  // probes to distinguish "Zatom is still starting" from "this page has no tools." This requires every
  // session tool to be read-only because workspace ports are not wired during that phase.
  it('session 域整体只读,两阶段注册的启动期暴露才安全', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['session'] })
      expect(handle.domains).toEqual(['session'])
      expect(handle.callable.length).toBeGreaterThan(0)
      const byName = new Map(listZatomMcpTools().map((t) => [t.name, t]))
      for (const name of handle.callable) expect(isReadOnlyTool(byName.get(name)!)).toBe(true)
    } finally {
      fake.restore()
    }
  })

  it('exposedTo 透传给 WebMCP;省略时保持同源默认', async () => {
    const fake = installFakeModelContext()
    try {
      await registerZatomWebMcpTools({ domains: ['io'], exposedTo: ['https://agent.example'] })
      expect(fake.get('zatom_call_tool')?.options?.exposedTo).toEqual(['https://agent.example'])
      fake.restore()
      const again = installFakeModelContext()
      await registerZatomWebMcpTools({ domains: ['io'] })
      expect(again.get('zatom_call_tool')?.options?.exposedTo).toBeUndefined()
    } finally {
      fake.restore()
    }
  })
})
