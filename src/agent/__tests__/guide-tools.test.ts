import { describe, expect, it } from 'vitest'
import { GUIDE_ZATOM_AGENT_TOOLS } from '../guide-tools'
import { SESSION_ZATOM_AGENT_TOOLS } from '../session-tools'
import { ZATOM_WORKFLOW } from '../domains'
import { activeViewportGuidanceSurface } from '../guidance-surface'
import { useAgentGuidance } from '../../orchestration/agentGuidanceStore'
import type { ZatomToolContext, ZatomToolDefinition } from '../contracts'

const tool = (tools: readonly ZatomToolDefinition[], name: string) => {
  const found = tools.find((t) => t.manifest.name === name)
  if (!found) throw new Error(`missing ${name}`)
  return found
}

const headless = {} as ZatomToolContext
const withDomains = {
  domains: { enabledDomains: () => ['session', 'guide'], enableDomains: () => undefined },
} as unknown as ZatomToolContext
const inPage = { guidance: activeViewportGuidanceSurface } as ZatomToolContext

describe('collaboration workflow', () => {
  it('zatom_domains returns the workflow so the first call teaches the loop', async () => {
    const result = await tool(SESSION_ZATOM_AGENT_TOOLS, 'zatom_domains').execute({}, withDomains)
    expect(result.ok).toBe(true)
    const data = (result as { data: { workflow: string[] } }).data
    expect(data.workflow).toEqual([...ZATOM_WORKFLOW])
    expect(data.workflow.join(' ')).toMatch(/structure_propose_operations/)
    expect(data.workflow.join(' ')).toMatch(/guide_set_plan/)
  })
})

describe('guide tools', () => {
  it('fail closed on a headless host instead of silently succeeding', async () => {
    const result = await tool(GUIDE_ZATOM_AGENT_TOOLS, 'guide_set_plan').execute({ steps: ['a', 'b'] }, headless)
    expect(result.ok).toBe(false)
  })

  it('publishes a plan the user-facing store renders, then clears it', async () => {
    useAgentGuidance.getState().clear()
    const set = await tool(GUIDE_ZATOM_AGENT_TOOLS, 'guide_set_plan').execute(
      { steps: ['Inspect', 'Replace O with S', 'Verify'], activeIndex: 1, caption: 'Swapping the top-layer oxygen' },
      inPage,
    )
    expect(set.ok).toBe(true)
    const plan = useAgentGuidance.getState().plan
    expect(plan?.steps.map((s) => s.status)).toEqual(['done', 'active', 'pending'])
    expect(plan?.caption).toBe('Swapping the top-layer oxygen')

    const annotate = await tool(GUIDE_ZATOM_AGENT_TOOLS, 'guide_annotate').execute(
      { annotations: [{ position: [0, 0, 1], label: 'target O', kind: 'target' }] },
      inPage,
    )
    expect(annotate.ok).toBe(true)
    expect(useAgentGuidance.getState().annotations).toHaveLength(1)

    const clear = await tool(GUIDE_ZATOM_AGENT_TOOLS, 'guide_clear').execute({}, inPage)
    expect(clear.ok).toBe(true)
    expect(useAgentGuidance.getState().plan).toBeNull()
    expect(useAgentGuidance.getState().annotations).toHaveLength(0)
  })
})
