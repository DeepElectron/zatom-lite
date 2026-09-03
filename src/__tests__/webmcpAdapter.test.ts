// @vitest-environment happy-dom
//
// The WebMCP adapter locks down six properties of the direct core plus long-tail facade design.
//
// Chromium caps all tool descriptors registered on one page at 64 KiB and rejects the whole set rather
// than truncating it. The page registers a compact collaboration core directly and routes the remaining
// capabilities through three facades. Any core change must remeasure the complete descriptor payload.
//
// Domain gating remains the user's control in Agent Access → Tools; the Agent cannot widen it itself.
// zatom_enable_domains is absent here, while disabled tools remain discoverable and fail when invoked.
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
function installFakeModelContext(config: { rejectOn?: string } = {}) {
  const entries = new Map<string, RegisteredEntry>()
  let registrationCount = 0
  const fake = {
    registerTool(
      descriptor: WebMCP.ModelContextTool,
      options?: WebMCP.ModelContextRegisterToolOptions,
    ): Promise<void> {
      registrationCount += 1
      if (descriptor.name === config.rejectOn) return Promise.reject(new Error(`rejected ${descriptor.name}`))
      entries.set(descriptor.name, { descriptor, options })
      options?.signal?.addEventListener('abort', () => entries.delete(descriptor.name), {
        once: true,
      })
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

describe('WebMCP direct core and facade', () => {
  it('缺少 document.modelContext 时报告不可用,并拒绝注册', async () => {
    expect(isWebMcpAvailable()).toBe(false)
    await expect(registerZatomWebMcpTools()).rejects.toThrow(/WebMCP is unavailable/)
  })

  it('页面上一次注册核心工具与三个 facade,总描述符低于浏览器上限', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ZATOM_TOOL_DOMAINS.map((d) => d.name) })
      expect(fake.names().sort()).toEqual([...ZATOM_WEBMCP_REGISTERED_TOOLS].sort())
      expect(fake.names().slice(0, ZATOM_WEBMCP_CORE_TOOLS.length)).toEqual([...ZATOM_WEBMCP_CORE_TOOLS])
      expect(fake.names().slice(-ZATOM_WEBMCP_FACADE_TOOLS.length)).toEqual([...ZATOM_WEBMCP_FACADE_TOOLS])
      expect([...handle.registered].sort()).toEqual([...ZATOM_WEBMCP_REGISTERED_TOOLS].sort())
      expect(ZATOM_WEBMCP_CORE_TOOLS).toEqual(EXPECTED_CORE_TOOLS)
      expect(ZATOM_WEBMCP_FACADE_TOOLS).toHaveLength(3)
      // Enabling every domain makes the full registry callable, while the page carries schemas only for the stable core.
      expect(handle.callable.length).toBeGreaterThan(100)
      expect(fake.descriptorBytes()).toBeLessThanOrEqual(ENGINEERING_DESCRIPTOR_BUDGET_BYTES)
      expect(fake.descriptorBytes()).toBeLessThan(BROWSER_DESCRIPTOR_CAP_BYTES)
      expect(BROWSER_DESCRIPTOR_CAP_BYTES - fake.descriptorBytes()).toBeGreaterThanOrEqual(MIN_DESCRIPTOR_HEADROOM_BYTES)
    } finally {
      fake.restore()
    }
  })

  it('域变化只更新调用门控,不重新注册 facade', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({ domains: ['io'] })
      expect(fake.registrationCount()).toBe(ZATOM_WEBMCP_REGISTERED_TOOLS.length)
      expect(handle.callable).toContain('structure_validate')
      expect(handle.callable).not.toContain('structure_build_metal_cluster')

      handle.setDomains(['build', 'not-a-domain'])
      expect(fake.registrationCount()).toBe(ZATOM_WEBMCP_REGISTERED_TOOLS.length)
      expect(handle.domains).toEqual(['session', 'build'])
      expect(handle.unknownDomains).toEqual(['not-a-domain'])
      expect(handle.callable).toContain('structure_build_metal_cluster')
      expect(handle.callable).not.toContain('structure_validate')
      expect(createZatomWebMcpRuntimeProfile({ domains: handle.domains }).tools.callable).toBe(handle.callable.length)

      const index = await fake.call('zatom_domains')
      const domains = (index.structuredContent.data as { domains: { name: string; enabled: boolean }[] }).domains
      expect(domains.find((domain) => domain.name === 'build')?.enabled).toBe(true)
      expect(domains.find((domain) => domain.name === 'io')?.enabled).toBe(false)
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
        tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[]
        unknown: string[]
        disabled: string[]
      }
      expect(data.tools.map((t) => t.name)).toEqual(['workspace_get_active_structure'])
      expect(data.tools[0]!.description.length).toBeGreaterThan(20)
      expect(data.tools[0]!.inputSchema).toMatchObject({ type: 'object' })
      expect(data.tools[0]!.readOnly).toBe(true)
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
    try {
      await registerZatomWebMcpTools({ domains: ['io'] })
      const disabled = await fake.call('zatom_call_tool', {
        name: 'structure_build_metal_cluster',
        input: { geometry: 'icosahedral', element: 'Pt', shells: 1 },
      })
      expect(disabled.isError).toBe(true)
      expect(disabled.structuredContent.error?.code).toBe('domain_disabled')
      expect(disabled.structuredContent.error?.message).toMatch(/Agent Access/)

      const unknown = await fake.call('zatom_call_tool', { name: 'no_such_tool' })
      expect(unknown.structuredContent.error?.code).toBe('unknown_tool')

      // The Agent cannot widen its enabled domains through the facade.
      const enable = await fake.call('zatom_call_tool', { name: 'zatom_enable_domains', input: { domains: ['build'] } })
      expect(enable.structuredContent.error?.code).toBe('unknown_tool')
    } finally {
      fake.restore()
    }
  })

  it('核心工具可直接调用,禁用域仍在执行时拒绝', async () => {
    const fake = installFakeModelContext()
    try {
      const handle = await registerZatomWebMcpTools({
        domains: ['io'],
        context: { readStructure: () => WATER },
      })
      expect(handle.registered).toContain('scene_observe')

      const disabled = await fake.call('scene_observe')
      expect(disabled.isError).toBe(true)
      expect(disabled.structuredContent.tool).toBe('scene_observe')
      expect(disabled.structuredContent.error?.code).toBe('domain_disabled')

      handle.setDomains(['viewport'])
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
        domains: ['viewport', 'edit', 'io', 'surface'],
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
      expect(fake.names().length).toBe(ZATOM_WEBMCP_REGISTERED_TOOLS.length)
      handle.unregister()
      expect(fake.names()).toEqual([])
      handle.unregister()

      const controller = new AbortController()
      await registerZatomWebMcpTools({ domains: ['io'], signal: controller.signal })
      expect(fake.names().length).toBe(ZATOM_WEBMCP_REGISTERED_TOOLS.length)
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
      expect(fake.get('zatom_call_tool')?.descriptor.annotations?.readOnlyHint ?? false).toBe(false)
      expect(fake.get('zatom_call_tool')?.descriptor.annotations?.untrustedContentHint).toBe(true)
      expect(fake.get('scene_observe')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('guide_candidate_status')?.descriptor.annotations?.readOnlyHint).toBe(true)
      expect(fake.get('structure_propose_operations')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('structure_cancel_proposal')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('workspace_undo')?.descriptor.annotations?.readOnlyHint).toBe(false)
      expect(fake.get('assets_list_local_directory')?.descriptor.annotations?.untrustedContentHint).toBe(true)
      expect(fake.get('assets_mount_visualization_bundle')?.descriptor.annotations?.untrustedContentHint).toBe(true)
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
