import { describe, expect, it } from 'vitest'
import { generateLatticeEdges } from '../lib/crystal/lattice'
import type { LatticeVectors } from '../lib/crystal/types'
import { resolveLatticeEdges, resolveLatticeGridVisibility } from '../lib/render/lattice-visibility'
import { resolveStylizedLightIntensities } from '../lib/render/stylized-lighting'

describe('crystal render semantics', () => {
  it('keeps crystal axes independent from lattice visibility', () => {
    expect(resolveLatticeGridVisibility(false, true)).toEqual({ lattice: false, axes: true, any: true })
    expect(resolveLatticeGridVisibility(true, false)).toEqual({ lattice: true, axes: false, any: true })
    expect(resolveLatticeGridVisibility(false, false).any).toBe(false)
  })

  it('shows only the supercell boundary until the unit-cell grid is explicitly enabled', () => {
    const lattice: LatticeVectors = { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }

    const unitCell = { nx: 1, ny: 1, nz: 1 }
    const unitEdges = generateLatticeEdges(lattice, unitCell)
    const unitBoundary = resolveLatticeEdges(unitEdges, unitCell, false)
    expect(unitBoundary.boundary).toHaveLength(12)
    expect(unitBoundary.cellGrid).toHaveLength(0)

    const supercell = { nx: 2, ny: 2, nz: 2 }
    const supercellEdges = generateLatticeEdges(lattice, supercell)
    const boundaryOnly = resolveLatticeEdges(supercellEdges, supercell, false)
    const withCellGrid = resolveLatticeEdges(supercellEdges, supercell, true)
    expect(boundaryOnly.boundary).toHaveLength(24)
    expect(boundaryOnly.cellGrid).toHaveLength(0)
    expect(withCellGrid.boundary).toHaveLength(24)
    expect(withCellGrid.cellGrid).toHaveLength(30)
    expect(new Set([...withCellGrid.boundary, ...withCellGrid.cellGrid].map((edge) => edge.id)).size).toBe(supercellEdges.length)
  })

  it('uses effective top-level light overrides for stylized isosurfaces', () => {
    expect(resolveStylizedLightIntensities({
      ambientIntensity: .4,
      diffuseIntensity: .7,
      lightAmbient: .8,
      lightKey: 1.2,
      lightFill: .5,
    })).toEqual({ ambient: .89, diffuse: 1.2 })
    expect(resolveStylizedLightIntensities({
      ambientIntensity: .4,
      diffuseIntensity: .7,
      lightAmbient: null,
      lightKey: null,
      lightFill: null,
    })).toEqual({ ambient: .4, diffuse: .7 })
  })
})
