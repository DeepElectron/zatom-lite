import { describe, expect, it } from 'vitest'

import type { ZatomStructure } from '../../../agent/contracts'
import { buildSceneGrid } from '../scene-grid'

const A = 3.615

const fccCu = (n: number): ZatomStructure => {
  const atoms: ZatomStructure['atoms'] = []
  const basis = [
    [0, 0, 0],
    [0.5, 0.5, 0],
    [0.5, 0, 0.5],
    [0, 0.5, 0.5],
  ]
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        for (const b of basis)
          atoms.push({
            id: `a${atoms.length}`,
            element: 'Cu',
            position: [(i + b[0]) * A, (j + b[1]) * A, (k + b[2]) * A],
          })
  return {
    id: 'cu',
    name: 'Cu',
    atoms,
    lattice: {
      vectors: [
        [n * A, 0, 0],
        [0, n * A, 0],
        [0, 0, n * A],
      ],
      periodic: [true, true, true],
    },
  } as unknown as ZatomStructure
}

const benzene = (): ZatomStructure =>
  ({
    id: 'b',
    name: 'benzene',
    atoms: Array.from({ length: 12 }, (_, i) => {
      const r = i < 6 ? 1.39 : 2.47
      const t = ((i % 6) * Math.PI) / 3
      return {
        id: `${i < 6 ? 'C' : 'H'}${i}`,
        element: i < 6 ? 'C' : 'H',
        position: [r * Math.cos(t), r * Math.sin(t), 0],
      }
    }),
  }) as unknown as ZatomStructure

describe('scene-grid planner', () => {
  it('collapses a uniform-bulk crystal to the floor grid and carries the lattice line', () => {
    const grid = buildSceneGrid(fccCu(3), { view: 'top' })
    expect(grid.resolution).toEqual([8, 8])
    expect(grid.ascii).toContain('# uniform bulk: all 108 atoms at bulk coordination')
    expect(grid.ascii).toMatch(/# lattice: a=10\.845 b=10\.845 c=10\.845 A · alpha=90\.0/)
    // Far below the ~2200 characters the 24x24 rendering used to spend on dots.
    expect(grid.ascii.length).toBeLessThan(1300)
  })

  it('keeps full detail when the caller pins the resolution', () => {
    const grid = buildSceneGrid(fccCu(3), { view: 'top', resolution: 24 })
    expect(grid.resolution).toEqual([24, 24])
    expect(grid.ascii).not.toContain('# uniform bulk')
  })

  it('leads a small molecule with its bond graph and caps cells at atomic scale', () => {
    const grid = buildSceneGrid(benzene(), { view: 'top' })
    expect(grid.ascii).toContain('# topology: C6H6 · 12 bonds (inferred) · fragments=1 · rings=1x6')
    expect(grid.ascii).toContain('#   C0: C1 C5 +1H (ring)')
    // Topology block precedes the grid.
    expect(grid.ascii.indexOf('# topology:')).toBeLessThan(grid.ascii.indexOf('# --- overview'))
    // 4.9 A scene: no cell finer than 0.5 A.
    expect(grid.resolution[0]).toBeLessThanOrEqual(10)
  })

  it('skips the inset when the focus window is not finer than a single grid', () => {
    const cu = fccCu(1)
    const grid = buildSceneGrid(cu, { view: 'top', focusAtomIds: new Set(['a0']) })
    expect(grid.inset).toBeNull()
    expect(grid.ascii).toContain('# inset skipped')
    // The focus itself is still reported.
    expect(grid.focus?.atomCount).toBe(1)
  })

  it('still emits an inset when the focus is a small part of a wide scene', () => {
    // 12 x 12 x 1 cells: 43 A wide, so the padded focus window is a quarter of it.
    const base = fccCu(1)
    const atoms: ZatomStructure['atoms'] = []
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++)
        for (const a of base.atoms)
          atoms.push({ id: `${a.id}_${i}_${j}`, element: a.element, position: [a.position[0] + i * A, a.position[1] + j * A, a.position[2]] })
    const wide = {
      ...base,
      atoms,
      lattice: { vectors: [[12 * A, 0, 0], [0, 12 * A, 0], [0, 0, A]], periodic: [true, true, true] },
    } as unknown as ZatomStructure
    const grid = buildSceneGrid(wide, { view: 'top', focusAtomIds: new Set(['a0_6_6']) })
    expect(grid.inset).not.toBeNull()
    const overviewScale = Number(grid.ascii.match(/scale=([\d.]+)A/)![1])
    expect(grid.inset!.angstromsPerCell).toBeLessThan(overviewScale)
    expect(grid.ascii).not.toContain('# inset skipped')
  })

  it('names the deviating atoms and the adsorbate bonding in the header of a slab', () => {
    // Four (001) layers of fcc Cu, 3x3 in plane, 12 A vacuum along c, one O
    // on top of a surface atom at 1.90 A.
    const base = fccCu(1)
    const atoms: ZatomStructure['atoms'] = []
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 2; k++)
          for (const a of base.atoms)
            atoms.push({
              id: `${a.id}_${i}${j}${k}`,
              element: 'Cu',
              position: [a.position[0] + i * A, a.position[1] + j * A, a.position[2] + k * A],
            })
    const zTop = Math.max(...atoms.map((a) => a.position[2]))
    const anchor = atoms.find((a) => Math.abs(a.position[2] - zTop) < 1e-6)!
    atoms.push({ id: 'O1', element: 'O', position: [anchor.position[0], anchor.position[1], zTop + 1.9] })
    const slab = {
      ...base,
      atoms,
      lattice: { vectors: [[3 * A, 0, 0], [0, 3 * A, 0], [0, 0, 2 * A + 12]], periodic: [true, true, false] },
    } as unknown as ZatomStructure

    const grid = buildSceneGrid(slab, { view: 'top' })
    const header = grid.ascii.split('\n').filter((l) => l.startsWith('#'))
    const slabLine = header.find((l) => l.startsWith('# slab:'))!
    expect(slabLine).toContain('normal=c')
    expect(slabLine).toContain('layers=5')
    // Each (001) plane of a 3x3 conventional-cell slab holds 18 Cu.
    expect(slabLine).toContain('L0=O L1=Cu18 L2=Cu18 L3=Cu18 L4=Cu18')
    expect(header.find((l) => l.startsWith('# foreign ids:'))).toBe('# foreign ids: O1')
    expect(header.some((l) => l.startsWith('# surface ids:'))).toBe(true)
    const env = header.find((l) => l.startsWith('# O:O1'))!
    expect(env).toContain('CN=1')
    expect(env).toContain(`Cu:${anchor.id}@1.90`)
  })

  it('frames a periodic water box as a molecular assembly, not as lattice sites', () => {
    // 27 waters on a 3x3x3 grid (3.3 A apart) in a 10 A box.
    const atoms: ZatomStructure['atoms'] = []
    let n = 0
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++) {
          const o: [number, number, number] = [1 + i * 3.3, 1 + j * 3.3, 1 + k * 3.3]
          atoms.push(
            { id: `O${n}`, element: 'O', position: o },
            { id: `Ha${n}`, element: 'H', position: [o[0] + 0.96, o[1], o[2]] },
            { id: `Hb${n}`, element: 'H', position: [o[0] - 0.24, o[1] + 0.93, o[2]] },
          )
          n++
        }
    const box = {
      id: 'w',
      name: 'water',
      atoms,
      lattice: { vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]], periodic: [true, true, true] },
    } as unknown as ZatomStructure

    const grid = buildSceneGrid(box, { view: 'top' })
    const header = grid.ascii.split('\n').filter((l) => l.startsWith('#'))
    const assembly = header.find((l) => l.startsWith('# molecular assembly:'))!
    expect(assembly).toContain('27 fragments')
    expect(assembly).toContain('H2O x27')
    expect(header.some((l) => l.startsWith('# sites:'))).toBe(false)
    expect(header.some((l) => l.startsWith('# uniform bulk'))).toBe(false)
  })
})
