import { describe, expect, it } from 'vitest'

import type { Vec3, ZatomStructure } from '../../../agent/contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../../../agent/contracts'
import {
  buildSceneGrid,
  listSceneGridViews,
  probeSceneCell,
  SceneGridError,
} from '../scene-grid'

const structureOf = (
  atoms: Array<{ id: string; element: string; position: Vec3 }>,
  lattice?: { vectors: [Vec3, Vec3, Vec3] },
): ZatomStructure => ({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms,
  ...(lattice ? { lattice: { vectors: lattice.vectors, periodic: [true, true, true] as [boolean, boolean, boolean] } } : {}),
})

/** Three collinear atoms along z, plus one offset in x to give the grid extent. */
const zLine = structureOf([
  { id: 'a1', element: 'C', position: [0, 0, 0] },
  { id: 'a2', element: 'N', position: [0, 0, 3] },
  { id: 'a3', element: 'O', position: [0, 0, 6] },
  { id: 'a4', element: 'H', position: [6, 0, 3] },
])

describe('buildSceneGrid projection', () => {
  it('stacks collinear atoms into one cell in top view, depth ascending', () => {
    const grid = buildSceneGrid(zLine, { view: 'top', resolution: 8 })
    // a1..a3 share x=0,y=0 so they land in one cell; a4 in another.
    const stacked = grid.cells.find((c) => c.stack.length === 3)
    expect(stacked).toBeDefined()
    // top view looks down (-z): nearest atom has the largest z.
    expect(stacked!.stack.map(([id]) => id)).toEqual(['a3', 'a2', 'a1'])
    const bins = stacked!.stack.map(([, , bin]) => bin)
    expect(bins[0]).toBeLessThanOrEqual(bins[1])
    expect(bins[1]).toBeLessThanOrEqual(bins[2])
    expect(grid.atomsProjected).toBe(4)
  })

  it('spreads the same atoms across cells in front view', () => {
    const grid = buildSceneGrid(zLine, { view: 'front', resolution: 8 })
    // Front view screen = (x, z): the three line atoms separate vertically.
    const cellsWithLine = grid.cells.filter((c) => c.stack.some(([id]) => ['a1', 'a2', 'a3'].includes(id)))
    expect(cellsWithLine.length).toBe(3)
  })

  it('projects a simple-cubic supercell along c into a 2x2 pattern of stacks', () => {
    const a = 3
    const atoms: Array<{ id: string; element: string; position: Vec3 }> = []
    let n = 0
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) {
      atoms.push({ id: `s${n++}`, element: 'Cu', position: [x * a, y * a, z * a] })
    }
    const cubic = structureOf(atoms, { vectors: [[2 * a, 0, 0], [0, 2 * a, 0], [0, 0, 2 * a]] })
    const grid = buildSceneGrid(cubic, { view: 'along_c', resolution: 8, topK: 3 })
    expect(grid.cells.length).toBe(4)
    for (const cell of grid.cells) expect(cell.stack.length).toBe(2)
  })

  it('counts topK truncation and probe returns the full stack', () => {
    const grid = buildSceneGrid(zLine, { view: 'top', resolution: 8, topK: 2 })
    expect(grid.truncatedCells).toBe(1)
    const stackedCell = grid.cells.find((c) => c.stack.length === 2 && c.stack[0][0] === 'a3')!
    const probe = probeSceneCell(zLine, { view: 'top', resolution: 8, topK: 2 }, stackedCell.xy[0], stackedCell.xy[1])
    expect(probe.stack.length).toBe(3)
    expect(probe.stack.map((s) => s.atomId)).toEqual(['a3', 'a2', 'a1'])
  })

  it('filters atoms outside depthRange', () => {
    // top view: depth 0 = highest z (a3), depth 1 = lowest z (a1).
    const grid = buildSceneGrid(zLine, { view: 'top', resolution: 8, depthRange: [0, 0.3] })
    const ids = grid.cells.flatMap((c) => c.stack.map(([id]) => id))
    expect(ids).toContain('a3')
    expect(ids).not.toContain('a1')
  })

  it('reports fractional coordinates in probe when a lattice exists', () => {
    const a = 4
    const withLattice = structureOf(
      [
        { id: 'f1', element: 'Na', position: [0, 0, 0] },
        { id: 'f2', element: 'Cl', position: [2, 2, 2] },
        { id: 'f3', element: 'Na', position: [1, 3, 0] },
      ],
      { vectors: [[a, 0, 0], [0, a, 0], [0, 0, a]] },
    )
    const grid = buildSceneGrid(withLattice, { view: 'top', resolution: 8 })
    const cell = grid.cells.find((c) => c.stack.some(([id]) => id === 'f2'))!
    const probe = probeSceneCell(withLattice, { view: 'top', resolution: 8 }, cell.xy[0], cell.xy[1])
    const f2 = probe.stack.find((s) => s.atomId === 'f2')!
    expect(f2.fractional).not.toBeNull()
    expect(f2.fractional![0]).toBeCloseTo(0.5, 6)
    expect(f2.fractional![1]).toBeCloseTo(0.5, 6)
    expect(f2.fractional![2]).toBeCloseTo(0.5, 6)
  })

  it('matches an equivalent canonical view when given a current pose', () => {
    const canonical = buildSceneGrid(zLine, { view: 'top', resolution: 8 })
    // Looking straight down from above = top view.
    const current = buildSceneGrid(zLine, {
      view: 'current',
      resolution: 8,
      pose: { position: [3, 0, 50], lookAt: [3, 0, 0] },
    })
    const shape = (g: typeof canonical) =>
      g.cells.map((c) => `${c.xy[0]},${c.xy[1]}:${c.stack.map(([id]) => id).join('|')}`).sort()
    expect(shape(current)).toEqual(shape(canonical))
  })

  it('preserves camera roll in the current-view grid', () => {
    const axes = structureOf([
      { id: 'origin', element: 'C', position: [0, 0, 0] },
      { id: 'world-x', element: 'N', position: [4, 0, 0] },
      { id: 'world-y', element: 'O', position: [0, 2, 0] },
    ])
    const grid = buildSceneGrid(axes, {
      view: 'current',
      resolution: 8,
      // Looking down -Z with camera-up rolled onto +X: +X must appear above,
      // while +Y appears to the left. Reconstructing from forward alone loses this.
      pose: { position: [0, 0, 10], lookAt: [0, 0, 0], up: [1, 0, 0] },
    })
    const cellOf = (id: string) => grid.cells.find((cell) => cell.stack.some(([atomId]) => atomId === id))!

    expect(cellOf('world-x').xy[1]).toBeLessThan(cellOf('origin').xy[1])
    expect(cellOf('world-y').xy[0]).toBeLessThan(cellOf('origin').xy[0])
  })

  it('keeps the principal_xy pattern invariant under rigid rotation', () => {
    // A planar L-shaped molecule with distinct principal axes. Coordinates are
    // irregular on purpose: atoms must not sit exactly on cell boundaries,
    // where float jitter from the rotation could legally flip a cell index.
    const base: Vec3[] = [
      [0.1, 0.2, 0],
      [1.73, 0.31, 0],
      [3.14, -0.22, 0],
      [4.63, 0.41, 0],
      [0.27, 1.83, 0],
      [-0.31, 3.21, 0],
    ]
    const mol = structureOf(base.map((p, i) => ({ id: `m${i}`, element: 'C', position: p })))
    // Rotate 40 deg about z then 25 deg about x.
    const cz = Math.cos(0.698)
    const sz = Math.sin(0.698)
    const cx = Math.cos(0.436)
    const sx = Math.sin(0.436)
    const rotated = structureOf(
      base.map((p, i) => {
        const r1: Vec3 = [p[0] * cz - p[1] * sz, p[0] * sz + p[1] * cz, p[2]]
        const r2: Vec3 = [r1[0], r1[1] * cx - r1[2] * sx, r1[1] * sx + r1[2] * cx]
        return { id: `m${i}`, element: 'C', position: r2 }
      }),
    )
    const shape = (s: ZatomStructure) =>
      buildSceneGrid(s, { view: 'principal_xy', resolution: 12 })
        .cells.map((c) => `${c.xy[0]},${c.xy[1]}`)
        .sort()
    expect(shape(rotated)).toEqual(shape(mol))
  })
})

describe('error handling and availability', () => {
  it('rejects along_* views without a lattice', () => {
    expect(() => buildSceneGrid(zLine, { view: 'along_c' })).toThrow(SceneGridError)
  })

  it('rejects current view without a pose', () => {
    expect(() => buildSceneGrid(zLine, { view: 'current' })).toThrow(/viewer pose/i)
  })

  it('rejects out-of-range probe cells', () => {
    expect(() => probeSceneCell(zLine, { view: 'top', resolution: 8 }, 99, 0)).toThrow(SceneGridError)
  })

  it('lists view availability from structure shape and pose presence', () => {
    const views = listSceneGridViews(zLine, false)
    const byView = new Map(views.map((v) => [v.view, v]))
    expect(byView.get('current')!.available).toBe(false)
    expect(byView.get('along_c')!.available).toBe(false)
    expect(byView.get('top')!.available).toBe(true)
    expect(byView.get('principal_xy')!.available).toBe(true)
  })

  it('renders ascii with header, marker rows and stack hint', () => {
    const grid = buildSceneGrid(zLine, { view: 'top', resolution: 8 })
    expect(grid.ascii).toContain('regime=molecular unit=atom view=top resolution=8x8')
    // Density now rides in the cell code, so a truncated cell can never hide
    // behind a bare '+': the O cell holds 3 atoms and says so.
    expect(grid.ascii).toContain('O3')
    expect(Object.keys(grid.legend).some((k) => k.startsWith('O@'))).toBe(true)
  })
})
