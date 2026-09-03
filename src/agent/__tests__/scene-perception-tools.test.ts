/**
 * Tool contracts for scene_burial, scene_interfaces, scene_linkages and
 * scene_repeat_units.
 *
 * The library tests cover the science; these cover the wiring those tests cannot
 * see: registration, read-only declaration, option pass-through, the honest-null
 * paths, and above all the output caps.
 *
 * The cap is the reason this file exists. scene_repeat_units reports one unit per
 * molecule, so output scales with molecule count rather than with anything the
 * atom-count guard checks: 120 short polyethylenes measured 21 KB, and the
 * 250,000-atom channel limit admits roughly 7,800 units. An uncapped tool would
 * flood the very context window the scene-grid package exists to conserve.
 */

import { describe, expect, it } from 'vitest'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure, type ZatomToolContext } from '../contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO } from '../biomolecular-identity'
import { SCENE_GRID_ZATOM_AGENT_TOOLS } from '../scene-grid-tools'
import { listZatomMcpTools } from '../mcp-adapter'

const context = {} as ZatomToolContext

const toolNamed = (name: string) =>
  SCENE_GRID_ZATOM_AGENT_TOOLS.find((t) => t.manifest.name === name)!

const PERCEPTION_TOOLS = [
  'scene_burial',
  'scene_interfaces',
  'scene_linkages',
  'scene_repeat_units',
] as const

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

type Atom = { id: string; element: string; position: [number, number, number] }
type Bond = { id: string; atomIds: [string, string]; order: number }

/** `count` separate capped polyethylene chains, spaced far enough not to touch. */
const manyChains = (count: number, length = 10): ZatomStructure => {
  const atoms: Atom[] = []
  const bonds: Bond[] = []
  let serial = 0
  const push = (element: string, position: [number, number, number]) => {
    const id = `a${serial++}`
    atoms.push({ id, element, position })
    return id
  }
  const bond = (a: string, b: string) =>
    bonds.push({ id: `b${bonds.length}`, atomIds: [a, b], order: 1 })

  for (let m = 0; m < count; m++) {
    const backbone: string[] = []
    for (let i = 0; i < length; i++) {
      const carbon = push('C', [i * 1.5, m * 50, 0])
      backbone.push(carbon)
      if (i > 0) bond(backbone[i - 1], carbon)
      const hydrogens = i === 0 || i === length - 1 ? 3 : 2
      for (let h = 0; h < hydrogens; h++) {
        bond(carbon, push('H', [i * 1.5, m * 50 + 1 + h * 0.1, 0.5]))
      }
    }
  }
  return { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms, bonds } as ZatomStructure
}

/** Two cysteines whose SG atoms sit `gap` apart, plus minimal backbone context. */
const disulfidePair = (gap: number): ZatomStructure => {
  const atoms: Atom[] = []
  let serial = 0
  // Residue identity travels in `properties` under namespaced keys. The wire
  // format allows only id/element/position/properties on an atom, so flat
  // `residueName`/`atomName` fields are rejected before analysis ever runs —
  // which is the whole reason this file tests through the tool boundary.
  const residue = (chainId: string, residueId: string, x: number) => {
    for (const [atomName, dx] of [
      ['CA', -1.5],
      ['CB', -0.8],
      ['SG', 0],
    ] as const) {
      atoms.push({
        id: `a${serial++}`,
        element: atomName === 'SG' ? 'S' : 'C',
        position: [x + dx, 0, 0],
        properties: {
          [BIO.chainId]: chainId,
          [BIO.residueName]: 'CYS',
          [BIO.residueId]: residueId,
          [BIO.atomName]: atomName,
        },
      } as Atom)
    }
  }
  residue('A', '10', 0)
  residue('A', '20', gap)
  return { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms } as ZatomStructure
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

describe('scene perception tool registration', () => {
  it('registers all four tools and exposes them through the MCP adapter', () => {
    const exposed = new Set(listZatomMcpTools().map((t) => t.name))
    for (const name of PERCEPTION_TOOLS) {
      expect(toolNamed(name), name).toBeDefined()
      expect(exposed.has(name), `${name} via MCP`).toBe(true)
    }
  })

  it('declares every one of them read-only', () => {
    // These are perception tools. A write effect here would route them past the
    // review gate that keys off the tier, so this is a safety assertion.
    for (const name of PERCEPTION_TOOLS) {
      expect(toolNamed(name).manifest.effects, name).toEqual({
        structure: 'read',
        workspace: 'read',
        visual: 'none',
      })
    }
  })
})

/* ------------------------------------------------------------------ */
/* Output caps                                                         */
/* ------------------------------------------------------------------ */

describe('scene_repeat_units output cap', () => {
  it('caps the units listed while keeping the count exact', async () => {
    const result = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(120) },
      context,
    )
    expect(result.ok).toBe(true)
    const data = result.data as { units: unknown[]; unitCount: number; truncated: boolean }

    // 120 molecules, each a genuine repeat unit, but only the cap is listed.
    expect(data.unitCount).toBe(120)
    expect(data.units).toHaveLength(30)
    expect(data.truncated).toBe(true)
  })

  it('honours an explicit maxListed and reports truncation honestly', async () => {
    const result = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(12), maxListed: 5 },
      context,
    )
    const data = result.data as { units: unknown[]; unitCount: number; truncated: boolean }
    expect(data.unitCount).toBe(12)
    expect(data.units).toHaveLength(5)
    expect(data.truncated).toBe(true)

    const untruncated = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(4), maxListed: 30 },
      context,
    )
    const clean = untruncated.data as { units: unknown[]; truncated: boolean }
    expect(clean.units).toHaveLength(4)
    expect(clean.truncated).toBe(false)
  })

  it('keeps the serialized payload bounded as molecule count grows', async () => {
    // The property that matters: output must not scale with the scene. Ten times
    // the molecules must not mean ten times the payload.
    const small = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(30) },
      context,
    )
    const large = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(300) },
      context,
    )
    const size = (r: unknown) => JSON.stringify(r).length
    expect(size(large.data)).toBeLessThan(size(small.data) * 1.5)
  })
})

/* ------------------------------------------------------------------ */
/* Option pass-through and honest nulls                                */
/* ------------------------------------------------------------------ */

describe('scene_repeat_units contract', () => {
  it('passes minRepeats through to the analysis', async () => {
    // A 10-carbon chain trimmed to 8 interior sites supports period 1 x8, but
    // not 9 copies, so raising minRepeats past the evidence must yield nothing.
    const permissive = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(1), minRepeats: 2 },
      context,
    )
    expect((permissive.data as { units: unknown[] }).units).toHaveLength(1)

    const strict = await toolNamed('scene_repeat_units').execute(
      { structure: manyChains(1), minRepeats: 9 },
      context,
    )
    expect((strict.data as { units: unknown[] }).units).toHaveLength(0)
  })

  it('still analyses a bondless scene by inferring connectivity', async () => {
    // Worth pinning down because it is counter-intuitive: a file with no bond
    // records is not a dead end. The bond graph infers bonds from covalent
    // radii, so the same chain is analysed and the source is reported as
    // inferred rather than declared.
    const bondless = manyChains(1)
    const result = await toolNamed('scene_repeat_units').execute(
      { structure: { ...bondless, bonds: [] } as ZatomStructure },
      context,
    )
    expect(result.ok).toBe(true)
    const data = result.data as {
      units: unknown[]
      connectivityMissing: boolean
      bondSource: string
    }
    expect(data.connectivityMissing).toBe(false)
    expect(data.bondSource).toBe('inferred')
    expect(data.units).toHaveLength(1)
  })

  it('declines honestly when nothing in the scene is bonded at all', async () => {
    // Atoms far enough apart that inference finds no bond. This is the real
    // trigger for the connectivity message, so the summary must not claim the
    // file merely lacked bond records.
    const scattered: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: Array.from({ length: 6 }, (_, i) => ({
        id: `a${i}`,
        element: 'C',
        position: [i * 40, 0, 0] as [number, number, number],
      })),
    } as ZatomStructure

    const result = await toolNamed('scene_repeat_units').execute(
      { structure: scattered },
      context,
    )
    expect(result.ok).toBe(true)
    expect(result.summary).toMatch(/connectivity/i)
    const data = result.data as { units: unknown[]; connectivityMissing: boolean }
    expect(data.connectivityMissing).toBe(true)
    expect(data.units).toHaveLength(0)
  })
})

describe('scene_linkages contract', () => {
  it('finds a disulfide end to end and summarises it', async () => {
    const result = await toolNamed('scene_linkages').execute(
      { structure: disulfidePair(2.05) },
      context,
    )
    expect(result.ok).toBe(true)
    const data = result.data as { disulfides: { bondCount: number } | null }
    expect(data.disulfides?.bondCount).toBe(1)
    expect(result.summary).toMatch(/disulfide/i)
  })

  it('reports no disulfide for sulfurs too far apart', async () => {
    const result = await toolNamed('scene_linkages').execute(
      { structure: disulfidePair(4.5) },
      context,
    )
    const data = result.data as { disulfides: { bondCount: number } | null }
    expect(data.disulfides?.bondCount).toBe(0)
  })

  it('honours the include filter in both directions', async () => {
    const onlyMetals = await toolNamed('scene_linkages').execute(
      { structure: disulfidePair(2.05), include: 'metals' },
      context,
    )
    const metalsData = onlyMetals.data as { disulfides: unknown; metals: unknown }
    expect(metalsData.disulfides).toBeNull()
    expect(metalsData.metals).not.toBeNull()

    const onlyDisulfides = await toolNamed('scene_linkages').execute(
      { structure: disulfidePair(2.05), include: 'disulfides' },
      context,
    )
    const disulfideData = onlyDisulfides.data as { disulfides: unknown; metals: unknown }
    expect(disulfideData.metals).toBeNull()
    expect(disulfideData.disulfides).not.toBeNull()
  })
})

describe('scene_burial and scene_interfaces contracts', () => {
  it('both execute and return a summary on a plain scene', async () => {
    for (const name of ['scene_burial', 'scene_interfaces'] as const) {
      const result = await toolNamed(name).execute({ structure: manyChains(3) }, context)
      expect(result.ok, name).toBe(true)
      expect(typeof result.summary, name).toBe('string')
      expect(result.summary.length, name).toBeGreaterThan(0)
    }
  })
})
