import { describe, expect, it } from 'vitest'

import type { ZatomToolDefinition } from '../contracts'
import { BUILTIN_ZATOM_AGENT_TOOLS } from '../tools'

/**
 * Adding a tool module takes three registrations: the `*_ZATOM_AGENT_TOOLS`
 * export in its own file, the spread in tools.ts, and a domain assignment in
 * domains.ts. domains.test.ts guards the third; this file guards the second,
 * which would otherwise fail silently (the module compiles, the tools just
 * never exist at runtime).
 */
describe('zatom agent tool aggregation', () => {
  it('includes every *_ZATOM_AGENT_TOOLS export from every *-tools.ts module', () => {
    const modules = import.meta.glob<Record<string, unknown>>('../*-tools.ts', { eager: true })
    const aggregated = new Set(BUILTIN_ZATOM_AGENT_TOOLS.map((tool) => tool.manifest.name))

    const missing: string[] = []
    for (const [path, exports] of Object.entries(modules)) {
      for (const [exportName, value] of Object.entries(exports)) {
        if (!exportName.endsWith('_ZATOM_AGENT_TOOLS')) continue
        for (const tool of value as readonly ZatomToolDefinition[]) {
          if (!aggregated.has(tool.manifest.name)) {
            missing.push(`${tool.manifest.name} (${exportName} in ${path})`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('has no duplicate tool names across modules', () => {
    const names = BUILTIN_ZATOM_AGENT_TOOLS.map((tool) => tool.manifest.name)
    const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
    expect(duplicates).toEqual([])
  })
})
