import { describe, expect, it } from 'vitest'

import type { ZatomToolDefinition } from '../contracts'
import { createZatomAgentToolRegistry } from '../tools'

function tool(name: string, summary = name): ZatomToolDefinition {
  return {
    manifest: {
      name,
      title: name,
      version: '1.0.0',
      description: name,
      inputSchema: { type: 'object', additionalProperties: false },
      effects: { structure: 'none', workspace: 'none', visual: 'none' },
      tags: ['test'],
    },
    execute: async () => ({ ok: true, tool: name, summary }),
  }
}

describe('tool registry hot-plug safety', () => {
  it('allows namespaced additions but never hot-replaces a protected built-in', () => {
    const registry = createZatomAgentToolRegistry([tool('viewer_observe')])
    expect(() => registry.register(tool('viewer_observe', 'replacement'), { replace: true }))
      .toThrow(/cannot be replaced at runtime/)

    const unregister = registry.register(tool('plugin_example_observe'))
    expect(registry.list().map((entry) => entry.name)).toContain('plugin_example_observe')
    unregister()
    expect(registry.list().map((entry) => entry.name)).not.toContain('plugin_example_observe')
  })
})
