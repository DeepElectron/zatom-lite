import { describe, expect, it } from 'vitest'
import {
  bioVdwRadius,
  BIO_SURFACE_VOXEL_BUDGET,
  buildBioSurfaceGeometryFromJob,
  buildBioSurfaceGeometry,
  createBioSurfaceWorkerJob,
  planBioSurfaceGrid,
} from '../lib/biomolecule/surface-geometry'
import { bioSurfaceTransferables } from '../lib/biomolecule/surface-worker-types'
import { parseLegacyPdb } from '../lib/biomolecule/pdb'

function atomLine(serial: number, x: number, y: number, z: number): string {
  return `${'ATOM'.padEnd(6)}${String(serial).padStart(5)} ${'CA'.padStart(4)} ${'ALA'.padStart(3)} A${String(serial).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}${'1.00'.padStart(6)}${'0.00'.padStart(6)}          ${'C'.padStart(2)}`
}

describe('biomolecular surface resource bounds', () => {
  it('uses the source van der Waals radii for space-fill and surface geometry', () => {
    expect(bioVdwRadius('C')).toBe(1.7)
    expect(bioVdwRadius('Cl')).toBe(1.75)
    expect(bioVdwRadius('Zn')).toBe(1.39)
    expect(bioVdwRadius('unknown')).toBe(1.7)
  })

  it('budgets the actual cubic marching-cubes allocation for a long thin structure', () => {
    const plan = planBioSurfaceGrid([0, 0, 0], [20_000, 1, 1], .45)
    expect(plan).not.toBeNull()
    expect(plan!.voxelCount).toBe(plan!.resolution ** 3)
    expect(plan!.voxelCount).toBeLessThanOrEqual(BIO_SURFACE_VOXEL_BUDGET)
    expect(plan!.spacing).toBeGreaterThan(2.5)
  })

  it('produces finite colors and valid mesh indices', () => {
    const structure = parseLegacyPdb([
      atomLine(1, 0, 0, 0),
      atomLine(2, 6, 0, 0),
    ].join('\n'), { inferBonds: false })
    const surface = buildBioSurfaceGeometry(structure, [0, 1], ['#ff0000', '#0000ff'], .8)

    expect(surface).not.toBeNull()
    expect(surface!.positions.length).toBeGreaterThan(0)
    expect(surface!.normals.length).toBe(surface!.positions.length)
    expect(surface!.colors.length).toBe(surface!.positions.length)
    expect([...surface!.positions, ...surface!.normals, ...surface!.colors].every(Number.isFinite)).toBe(true)
    expect([...surface!.colors].every((value) => value >= 0 && value <= 1)).toBe(true)
    const vertexCount = surface!.positions.length / 3
    expect([...surface!.indices].every((index) => Number.isInteger(index) && index < vertexCount)).toBe(true)
  })

  it('uses a compact, content-stable worker contract with transferable mesh output', () => {
    const structure = parseLegacyPdb([
      atomLine(1, 0, 0, 0),
      atomLine(2, 6, 0, 0),
    ].join('\n'), { inferBonds: false })
    const first = createBioSurfaceWorkerJob(structure, [1, 0, 1], ['#ff0000', '#0000ff'], .8)
    const second = createBioSurfaceWorkerJob(structure, [1, 0, 1], ['#ff0000', '#0000ff'], .8)
    expect(first).not.toBeNull()
    expect(second).toEqual(first)
    expect(first!.positions).toHaveLength(6)
    expect(first!.elements).toEqual(['C', 'C'])
    expect(first!.colors).toEqual(['#0000ff', '#ff0000'])
    // PDB import recenters the structure; the selected centroid remains exact.
    expect(first!.center).toEqual([0, 0, 0])

    const result = buildBioSurfaceGeometryFromJob(first!)
    expect(result).not.toBeNull()
    expect(bioSurfaceTransferables(result)).toEqual([
      result!.positions.buffer,
      result!.normals.buffer,
      result!.indices.buffer,
      result!.colors.buffer,
    ])
  })
})
