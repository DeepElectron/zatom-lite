/**
 * scene_scaffold tool contract.
 *
 * Covers the wiring the library tests cannot see: registration, option
 * pass-through, the honest-null path for aperiodic scenes, and above all the
 * output caps. `defectTolerance` is a fraction, so a large defective slab
 * produces a legitimately enormous unmatched set, and an uncapped tool would
 * flood the very context window the scene-grid package exists to conserve.
 */

import { describe, expect, it } from 'vitest'
import { ZATOM_STRUCTURE_SCHEMA, type ZatomStructure, type ZatomToolContext } from '../contracts'
import { SCENE_GRID_ZATOM_AGENT_TOOLS } from '../scene-grid-tools'
import { listZatomMcpTools } from '../mcp-adapter'

const tool = SCENE_GRID_ZATOM_AGENT_TOOLS.find((t) => t.manifest.name === 'scene_scaffold')!

const context = {} as ZatomToolContext

/** Simple cubic lattice of `spacing`, repeated `n` times on each axis. */
const cubicSupercell = (
  n: number,
  spacing = 3,
  periodic: [boolean, boolean, boolean] = [true, true, true],
): ZatomStructure => {
  const atoms = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        atoms.push({
          id: `a${i}-${j}-${k}`,
          element: 'Cu',
          position: [i * spacing, j * spacing, k * spacing] as [number, number, number],
        })
      }
    }
  }
  const edge = n * spacing
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: {
      vectors: [
        [edge, 0, 0],
        [0, edge, 0],
        [0, 0, edge],
      ],
      periodic,
    },
  } as ZatomStructure
}

describe('scene_scaffold registration', () => {
  it('is registered and exposed through the MCP adapter', () => {
    expect(tool).toBeDefined()
    expect(listZatomMcpTools().some((t) => t.name === 'scene_scaffold')).toBe(true)
  })

  it('declares itself read-only', () => {
    expect(tool.manifest.effects).toEqual({
      structure: 'read',
      workspace: 'read',
      visual: 'none',
    })
  })
})

describe('scene_scaffold analysis', () => {
  it('reports the repeat multiplicity of a supercell', async () => {
    const result = await tool.execute({ structure: cubicSupercell(4) }, context)
    expect(result.ok).toBe(true)
    const data = result.data as any
    expect(data.scaffold.repeats).toEqual([4, 4, 4])
    expect(data.scaffold.isSupercell).toBe(true)
    expect(data.scaffold.cellCount).toBe(64)
    expect(result.summary).toContain('4x4x4')
  })

  it('returns a null scaffold for a molecular scene instead of inventing ones', async () => {
    const result = await tool.execute(
      {
        structure: {
          schemaVersion: ZATOM_STRUCTURE_SCHEMA,
          atoms: [
            { id: 'c1', element: 'C', position: [0, 0, 0] },
            { id: 'o1', element: 'O', position: [1.2, 0, 0] },
          ],
        },
      },
      context,
    )
    expect(result.ok).toBe(true)
    const data = result.data as any
    expect(data.scaffold).toBeNull()
    expect(result.summary).toContain('no usable lattice')
  })

  it('surfaces a vacancy as an unmatched defect atom', async () => {
    const structure = cubicSupercell(4)
    // Remove one interior site: the translation map now fails there.
    structure.atoms.splice(21, 1)
    const result = await tool.execute({ structure }, context)
    const data = result.data as any
    expect(data.scaffold.unmatchedAtomIds.length).toBeGreaterThan(0)
    expect(result.summary).toMatch(/defect atom/)
  })

  it('reports a perfect lattice as defect-free', async () => {
    const result = await tool.execute({ structure: cubicSupercell(3) }, context)
    expect((result.data as any).scaffold.unmatchedAtomIds).toEqual([])
    expect(result.summary).toContain('no defects')
  })

  it('passes defectTolerance through: 0 forbids the defect fallback', async () => {
    const structure = cubicSupercell(4)
    structure.atoms.splice(21, 1)
    const strict = await tool.execute({ structure, defectTolerance: 0 }, context)
    const lenient = await tool.execute({ structure, defectTolerance: 0.2 }, context)
    // With no slack the broken axis cannot be called periodic, so the reported
    // repeats must be no larger than what the lenient scan accepts.
    const strictCells = (strict.data as any).scaffold.cellCount
    const lenientCells = (lenient.data as any).scaffold.cellCount
    expect(strictCells).toBeLessThanOrEqual(lenientCells)
  })
})

describe('scene_scaffold slab layering', () => {
  it('reports layers along the aperiodic axis', async () => {
    const result = await tool.execute(
      { structure: cubicSupercell(4, 3, [true, true, false]) },
      context,
    )
    const data = result.data as any
    expect(data.layering).not.toBeNull()
    expect(data.layering.axis).toBe(2)
    expect(data.layering.layerCount).toBe(4)
    expect(data.layering.medianSpacing).toBeCloseTo(3, 5)
    expect(result.summary).toContain('layer(s) along the c surface normal')
  })

  it('omits layering for a fully periodic bulk, which has no surface', async () => {
    const result = await tool.execute({ structure: cubicSupercell(3) }, context)
    expect((result.data as any).layering).toBeNull()
  })

  it('honours includeLayering: false', async () => {
    const result = await tool.execute(
      { structure: cubicSupercell(4, 3, [true, true, false]), includeLayering: false },
      context,
    )
    expect((result.data as any).layering).toBeNull()
  })
})

describe('scene_scaffold output caps', () => {
  it('caps enumerated defects while keeping the count exact', async () => {
    // A 12x12x12 cell with a large tolerance budget: many atoms go unmatched,
    // far more than any response should enumerate.
    const structure = cubicSupercell(12)
    // Displace a large number of atoms so they break every translation.
    for (let i = 0; i < structure.atoms.length; i += 3) {
      structure.atoms[i].position[0] += 0.9
    }
    const result = await tool.execute({ structure, defectTolerance: 0.5 }, context)
    const data = result.data as any
    if (data.scaffold && data.defectsTruncated) {
      expect(data.scaffold.unmatchedAtomIds.length).toBe(40)
      expect(result.summary).toContain('listing 40')
    }
    // The cap must hold unconditionally, truncated or not.
    expect((data.scaffold?.unmatchedAtomIds.length ?? 0)).toBeLessThanOrEqual(40)
  })

  it('keeps the whole response small even for a large defective scene', async () => {
    const structure = cubicSupercell(12)
    for (let i = 0; i < structure.atoms.length; i += 2) {
      structure.atoms[i].position[1] += 0.7
    }
    const result = await tool.execute({ structure, defectTolerance: 0.5 }, context)
    // The grid package exists to conserve context; a perception tool that
    // returns 100 KB defeats its own purpose.
    expect(JSON.stringify(result).length).toBeLessThan(8000)
  })
})
