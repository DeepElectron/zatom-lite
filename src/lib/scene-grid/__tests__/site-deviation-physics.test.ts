import { describe, expect, it } from 'vitest'
import type { ZatomStructure } from '../../../agent/contracts'
import { NeighborGrid } from '../neighbor-grid'
import { classifySiteDeviation, siteDeviationSummary } from '../site-deviation'

/**
 * Coordination is the invariant every periodic-regime observation rests on.
 * These cells are the textbook cases where the previous implementation went
 * wrong: cells thinner than the cutoff (primitive fcc, 1x1 slabs), lattices
 * whose first shell is far from 3.2 A (Cs), and multi-element first shells
 * (rutile, perovskite, cuprite).
 */

type Row = [string, number, number, number]

const cell = (
  name: string,
  vectors: [number, number, number][],
  rows: Row[],
  periodic: [boolean, boolean, boolean] = [true, true, true],
): ZatomStructure =>
  ({
    id: name,
    name,
    lattice: { vectors, periodic },
    atoms: rows.map(([element, u, v, w], i) => ({
      id: `${element}${i}`,
      element,
      position: [
        u * vectors[0][0] + v * vectors[1][0] + w * vectors[2][0],
        u * vectors[0][1] + v * vectors[1][1] + w * vectors[2][1],
        u * vectors[0][2] + v * vectors[1][2] + w * vectors[2][2],
      ],
    })),
  }) as unknown as ZatomStructure

const cubic = (a: number): [number, number, number][] => [
  [a, 0, 0],
  [0, a, 0],
  [0, 0, a],
]

const cnByElement = (s: ZatomStructure): Record<string, Set<number>> => {
  const r = classifySiteDeviation(s)
  const grid = new NeighborGrid(s, { cutoff: Math.max(...Object.values(r.pairCutoffs)) })
  const key = (a: string, b: string) => (a <= b ? `${a}-${b}` : `${b}-${a}`)
  const cn = grid.coordinationNumbers((a, b) => r.pairCutoffs[key(a, b)] ?? 0)
  const out: Record<string, Set<number>> = {}
  s.atoms.forEach((atom, i) => (out[atom.element] ??= new Set()).add(cn[i]))
  return out
}

describe('coordination in thin cells', () => {
  it('counts all 12 neighbours of a one-atom fcc primitive cell', () => {
    const h = 3.615 / 2
    const prim = cell('Cu-prim', [[0, h, h], [h, 0, h], [h, h, 0]], [['Cu', 0, 0, 0]])
    expect(new NeighborGrid(prim, { cutoff: 3.2 }).coordinationNumbers()).toEqual([12])
    expect(classifySiteDeviation(prim).bulkCoordination).toBe(12)
  })

  it('finds the 8-fold shell of bcc Cs at 5.3 A instead of reporting an empty shell', () => {
    const cs = cell('Cs', cubic(6.14), [['Cs', 0, 0, 0], ['Cs', 0.5, 0.5, 0.5]])
    const r = classifySiteDeviation(cs)
    expect(r.degenerate).toBe(false)
    expect(r.bulkCoordination).toBe(8)
    expect(r.counts.bulk).toBe(2)
  })

  it('gives diamond Si a 4-fold bulk', () => {
    const si = cell('Si', cubic(5.431), [
      ['Si', 0, 0, 0], ['Si', 0.5, 0.5, 0], ['Si', 0.5, 0, 0.5], ['Si', 0, 0.5, 0.5],
      ['Si', 0.25, 0.25, 0.25], ['Si', 0.75, 0.75, 0.25], ['Si', 0.75, 0.25, 0.75], ['Si', 0.25, 0.75, 0.75],
    ])
    expect(classifySiteDeviation(si).bulkCoordination).toBe(4)
  })
})

describe('per-element first shells', () => {
  it('rutile TiO2: Ti is 6-fold, O is 3-fold, O-O is not a contact', () => {
    const a = 4.594, c = 2.959, u = 0.305
    const tio2 = cell('TiO2', [[a, 0, 0], [0, a, 0], [0, 0, c]], [
      ['Ti', 0, 0, 0], ['Ti', 0.5, 0.5, 0.5],
      ['O', u, u, 0], ['O', 1 - u, 1 - u, 0], ['O', 0.5 + u, 0.5 - u, 0.5], ['O', 0.5 - u, 0.5 + u, 0.5],
    ])
    const r = classifySiteDeviation(tio2)
    expect(r.bulkCoordinationByElement).toEqual({ Ti: 6, O: 3 })
    expect(Object.keys(r.pairCutoffs)).toEqual(['O-Ti'])
    expect(r.counts.bulk).toBe(6)
    expect(r.minorityElements).toEqual([])
  })

  it('SrTiO3: Sr 12, Ti 6, O 6, with no element mistaken for an adsorbate', () => {
    const a = 3.905
    const sto = cell('SrTiO3', cubic(a), [
      ['Sr', 0, 0, 0], ['Ti', 0.5, 0.5, 0.5], ['O', 0.5, 0.5, 0], ['O', 0.5, 0, 0.5], ['O', 0, 0.5, 0.5],
    ])
    const r = classifySiteDeviation(sto)
    expect(r.bulkCoordinationByElement).toEqual({ Sr: 12, Ti: 6, O: 6 })
    expect(r.minorityElements).toEqual([])
    expect(cnByElement(sto)).toEqual({ Sr: new Set([12]), Ti: new Set([6]), O: new Set([6]) })
  })

  it('Cu2O keeps 2-fold Cu as a genuine bulk (there is no higher frame)', () => {
    const a = 4.27
    const cu2o = cell('Cu2O', cubic(a), [
      ['O', 0, 0, 0], ['O', 0.5, 0.5, 0.5],
      ['Cu', 0.25, 0.25, 0.25], ['Cu', 0.75, 0.75, 0.25], ['Cu', 0.75, 0.25, 0.75], ['Cu', 0.25, 0.75, 0.75],
    ])
    const r = classifySiteDeviation(cu2o)
    expect(r.bulkCoordinationByElement).toEqual({ O: 4, Cu: 2 })
    expect(r.counts.bulk).toBe(6)
  })
})

describe('slabs and adsorbates', () => {
  const a = 3.615
  // Cu(111) 3x3, 4 layers, built directly in the slab frame.
  const slab = (): ZatomStructure => {
    const d = a / Math.sqrt(2) // in-plane NN
    const dz = a / Math.sqrt(3) // (111) interlayer
    const A: [number, number, number] = [3 * d, 0, 0]
    const B: [number, number, number] = [3 * d / 2, (3 * d * Math.sqrt(3)) / 2, 0]
    const atoms: ZatomStructure['atoms'] = []
    for (let layer = 0; layer < 4; layer++) {
      const shift = layer % 3
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const u = i / 3 + shift / 9, v = j / 3 + shift / 9
        atoms.push({ id: `Cu${atoms.length}`, element: 'Cu', position: [u * A[0] + v * B[0], v * B[1], layer * dz] })
      }
    }
    return { id: 'slab', name: 'Cu(111)', lattice: { vectors: [A, B, [0, 0, 3 * dz + 12]], periodic: [true, true, false] }, atoms } as unknown as ZatomStructure
  }

  it('splits a clean slab into surface and bulk with a 12-fold reference', () => {
    const r = classifySiteDeviation(slab())
    expect(r.bulkCoordination).toBe(12)
    expect(r.counts.bulk).toBe(18)
    expect(r.counts.surface).toBe(18)
  })

  it('reports one O adatom as foreign without disturbing the Cu reference', () => {
    const s = slab()
    const top = s.atoms.reduce((p, q) => (q.position[2] > p.position[2] ? q : p))
    s.atoms.push({ id: 'O1', element: 'O', position: [top.position[0], top.position[1], top.position[2] + 1.9] })
    const r = classifySiteDeviation(s)
    expect(r.minorityElements).toEqual(['O'])
    expect(r.counts.foreign).toBe(1)
    expect(r.bulkCoordinationByElement).toEqual({ Cu: 12 })
    expect(Object.keys(r.pairCutoffs).sort()).toEqual(['Cu-Cu', 'Cu-O'])
  })

  it('treats a full O monolayer (20% of atoms) as an overlayer, not a bulk of CN 1', () => {
    const s = slab()
    const zmax = Math.max(...s.atoms.map((x) => x.position[2]))
    for (const x of s.atoms.filter((x) => Math.abs(x.position[2] - zmax) < 1e-6)) {
      s.atoms.push({ id: `O_${x.id}`, element: 'O', position: [x.position[0], x.position[1], zmax + 1.9] })
    }
    const r = classifySiteDeviation(s)
    expect(r.bulkCoordinationByElement).toEqual({ Cu: 12 })
    expect(r.counts.foreign).toBe(9)
    expect(siteDeviationSummary(r)).toContain('minorityElements=[O]')
  })
})

describe('degenerate scenes', () => {
  it('flags an isolated-atom gas instead of labelling it bulk', () => {
    const gas = cell('Ar', cubic(30), [['Ar', 0, 0, 0], ['Ar', 1 / 3, 0, 0]])
    const r = classifySiteDeviation(gas)
    expect(r.degenerate).toBe(true)
    expect(r.byAtomId.size).toBe(0)
    expect(siteDeviationSummary(r)).toMatch(/not assigned/)
  })
})

/** Deterministic LCG so the "random" liquid is the same on every run. */
const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296

describe('disordered scenes', () => {
  it('reports a liquid as disordered with a CN distribution instead of inventing adatoms', () => {
    const rand = lcg(7)
    const L = 30
    const positions: [number, number, number][] = []
    let guard = 0
    while (positions.length < 400 && guard++ < 200000) {
      const p: [number, number, number] = [rand() * L, rand() * L, rand() * L]
      const ok = positions.every((q) => {
        let d2 = 0
        for (let i = 0; i < 3; i++) {
          let x = p[i] - q[i]
          x -= L * Math.round(x / L)
          d2 += x * x
        }
        return d2 > 3.2 * 3.2
      })
      if (ok) positions.push(p)
    }
    const liquid = {
      id: 'ar',
      name: 'Ar',
      lattice: { vectors: cubic(L), periodic: [true, true, true] },
      atoms: positions.map((position, i) => ({ id: `Ar${i}`, element: 'Ar', position })),
    } as unknown as ZatomStructure

    const r = classifySiteDeviation(liquid)
    expect(r.disordered).toBe(true)
    expect(r.degenerate).toBe(false)
    expect(r.byAtomId.size).toBe(0)
    expect(r.counts.adatom).toBe(0)
    expect(r.coordinationStats.Ar.firstShellA).toBeGreaterThan(3.2)
    expect(siteDeviationSummary(r)).toMatch(/disordered/)
  })

  it('keeps a slab with a real surface ordered (two CN values is structure, not disorder)', () => {
    const a = 3.615
    const rows: Row[] = []
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 2; k++)
          for (const [u, v, w] of [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]])
            rows.push(['Cu', (i + u) / 3, (j + v) / 3, ((k + w) * a) / (2 * a + 12)])
    const slab = cell('slab', [[3 * a, 0, 0], [0, 3 * a, 0], [0, 0, 2 * a + 12]], rows, [true, true, false])
    const r = classifySiteDeviation(slab)
    expect(r.disordered).toBe(false)
    expect(r.counts.surface).toBeGreaterThan(0)
  })
})
