/**
 * The selection schema is published once under `$defs` and referenced by the
 * operation variants. That deduplication is worth ~22 KB of the tool listing the
 * model has to read, but it is only safe while the reference still validates
 * exactly like the inlined copy did — a `$ref` that silently fails to resolve
 * would accept anything, turning a fail-closed selection DSL into a permissive
 * one. These tests pin both halves: the dedup stays, and validation stays strict.
 */

import { describe, expect, it } from 'vitest'
import { listZatomMcpTools } from '../mcp-adapter'
import { compileZatomJsonSchema } from '../json-schema'

const applySchema = (): Record<string, unknown> => {
  const tool = listZatomMcpTools().find((entry) => entry.name === 'structure_apply_operations')
  if (tool === undefined) throw new Error('structure_apply_operations is not registered')
  return tool.inputSchema as Record<string, unknown>
}

describe('structure_apply_operations selection $defs', () => {
  it('publishes exactly one selection definition instead of inlining it per variant', () => {
    const schema = applySchema()
    const defs = schema.$defs as Record<string, Record<string, unknown>> | undefined
    expect(defs?.selection).toBeDefined()
    // The definition must be the real DSL, not an empty placeholder that would
    // make every selection vacuously valid.
    expect((defs?.selection.properties as Record<string, unknown>).elements).toBeDefined()

    // No operation variant may carry an inlined copy. Counting a distinctive
    // clause across the whole schema is not the right check — the definition
    // legitimately contains it more than once, because `selectionSchema` nests a
    // clause schema inside its `combine` array. What must hold is that the
    // clause appears only under `$defs` and never under `properties`, where the
    // operation variants live, while the variants refer to it many times.
    expect(JSON.stringify(schema.$defs).includes('"axisPoint"')).toBe(true)
    expect(JSON.stringify(schema.properties).includes('"axisPoint"')).toBe(false)
    const refs = JSON.stringify(schema).split('"#/$defs/selection"').length - 1
    expect(refs).toBeGreaterThanOrEqual(7)
  })

  it('still accepts every valid selection form through the reference', () => {
    const validate = compileZatomJsonSchema(applySchema())
    const valid: unknown[] = [
      { operations: [{ op: 'substitute', selection: { elements: ['Cu'] }, element: 'Ni' }] },
      { operations: [{ op: 'vacancy', selection: { sphere: { center: [0, 0, 0], radius: 5 } } }] },
      { operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }] },
      {
        operations: [
          {
            op: 'rotate',
            selection: { cylinder: { axisPoint: [0, 0, 0], axis: [0, 0, 1], radius: 3 } },
            axis: [0, 0, 1],
            angleDeg: 90,
          },
        ],
      },
      {
        operations: [
          {
            op: 'wrap',
            selection: { elements: ['Cu'], combine: [{ operator: 'union', selection: { elements: ['Ni'] } }] },
          },
        ],
      },
    ]
    for (const input of valid) expect(validate(input).valid, JSON.stringify(input)).toBe(true)
  })

  it('still rejects malformed selections rather than resolving to a permissive schema', () => {
    const validate = compileZatomJsonSchema(applySchema())
    const invalid: unknown[] = [
      // A sphere without a radius is the case that proves the nested required
      // list survived the indirection.
      { operations: [{ op: 'vacancy', selection: { sphere: { center: [0, 0, 0] } } }] },
      { operations: [{ op: 'vacancy', selection: { unknownClause: 1 } }] },
      { operations: [{ op: 'vacancy', selection: { elements: 'Cu' } }] },
      { operations: [{ op: 'vacancy', selection: { elements: [] } }] },
      { operations: [{ op: 'wrap', selection: { combine: [{ operator: 'nope', selection: { elements: ['Ni'] } }] } }] },
    ]
    for (const input of invalid) expect(validate(input).valid, JSON.stringify(input)).toBe(false)
  })

  it('validates without resolving $ref at call time (Chromium rejects jsonschema\'s "thismessage::/" base URL)', () => {
    // Reproduced in-page: `new URL('/#/$defs/selection', 'thismessage::/')`
    // throws in Chromium, so every tool with a `$ref` failed in the browser
    // while passing under Node. Make URL behave like Chromium and validate.
    const RealURL = globalThis.URL
    class ChromiumLikeURL extends RealURL {
      constructor(url: string | URL, base?: string | URL) {
        if (typeof base === 'string' && base.startsWith('thismessage:')) throw new TypeError("Failed to construct 'URL': Invalid URL")
        super(url, base)
      }
    }
    globalThis.URL = ChromiumLikeURL as typeof URL
    try {
      const validate = compileZatomJsonSchema(applySchema())
      expect(validate({ operations: [{ op: 'vacancy', selection: { elements: ['Cu'] } }] }).valid).toBe(true)
      const bad = validate({ operations: [{ op: 'vacancy', selection: { sphere: { center: [0, 0, 0] } } }] })
      expect(bad.valid).toBe(false)
      expect(bad.errors.map((error) => error.message).join(' ')).toContain('radius')
    } finally {
      globalThis.URL = RealURL
    }
  })
})
