import { describe, it, expect } from 'vitest'
import { computeUnwrappedDisplayPositions } from '../unwrap-molecules'
import type { Atom, Bond } from '../../crystal/types'

type Vec3 = [number, number, number]

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// Orthorhombic cubic cell, a = 10 along x.
const cubic10 = {
  a: [10, 0, 0] as Vec3,
  b: [0, 10, 0] as Vec3,
  c: [0, 0, 10] as Vec3,
}

describe('computeUnwrappedDisplayPositions', () => {
  it('补全跨周期边界的双原子分子(切开→整体, 距离≈真实键长)', () => {
    // A is at x=0.2, B canonical is at x=9.6 (intracellular, after wrap). The two are truly bonded, and the bond length is ~0.6
    // (B's true position should be the mirror image of x=-0.4). canonically |A−B| = 9.4 (cut by the boundary).
    const atoms: Atom[] = [
      { id: 'A', element: 'C', position: [0.02, 0, 0], cartesian: [0.2, 0, 0] },
      { id: 'B', element: 'C', position: [0.96, 0, 0], cartesian: [9.6, 0, 0] },
    ]
    const bonds: Bond[] = [{ id: 'b1', atom1Id: 'A', atom2Id: 'B', type: 'single' }]

    const map = computeUnwrappedDisplayPositions(atoms, bonds, cubic10)

    const aDisp = map.get('A')!
    const bDisp = map.get('B')!
    expect(aDisp).toBeDefined()
    expect(bDisp).toBeDefined()

    const d = dist(aDisp, bDisp)
    // Complete to whole: ~0.6 (real bond length), not ~9.4 (cut).
    expect(d).toBeCloseTo(0.6, 5)
    expect(d).toBeLessThan(1)
    // Seed A remains in canonical position.
    expect(aDisp).toEqual([0.2, 0, 0])
    // B is placed in the mirror image of x=-0.4 (canonical 9.6 − 10).
    expect(bDisp[0]).toBeCloseTo(-0.4, 5)
  })

  it('非周期(无 lattice) → 返回空 map', () => {
    const atoms: Atom[] = [
      { id: 'A', element: 'C', position: [0, 0, 0], cartesian: [0.2, 0, 0] },
      { id: 'B', element: 'C', position: [0, 0, 0], cartesian: [9.6, 0, 0] },
    ]
    const bonds: Bond[] = [{ id: 'b1', atom1Id: 'A', atom2Id: 'B', type: 'single' }]

    expect(computeUnwrappedDisplayPositions(atoms, bonds, null).size).toBe(0)
    expect(computeUnwrappedDisplayPositions(atoms, bonds, undefined).size).toBe(0)
  })

  it('周期网络(金刚石/链环类)不补全 → 整分量回退 canonical(原子留在胞内)', () => {
    // A bonding chain that spans the whole cell along
    // Topology of extended covalent frameworks such as diamond/silicon: connected components span the entire crystal, closed by periodic bonds.
    // "show whole molecules" has no definition for infinite crystals. Completion will expand the atoms out of the cell along the spanning tree.
    // Infinity ("all atoms have gone outside" reported by users). After the repair, this type of component is not completed as a whole.
    const n = 8
    const atoms: Atom[] = []
    const bonds: Bond[] = []
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 10 // 0, 1.25, ... 8.75 (intracellular)
      atoms.push({ id: `a${i}`, element: 'C', position: [x / 10, 0, 0], cartesian: [x, 0, 0] })
      bonds.push({ id: `b${i}`, atom1Id: `a${i}`, atom2Id: `a${(i + 1) % n}`, type: 'single' })
    }

    const map = computeUnwrappedDisplayPositions(atoms, bonds, cubic10)

    // Expand network → do not write to map (rendering falls back to canonical, atoms maintain intracellular [0,10) coordinates).
    expect(map.size).toBe(0)
  })

  it('有限分子内的闭环(苯环类, 非周期环) 仍整体补全', () => {
    // There is a 4-membered square ring (4,4)-(6,4)-(6,6)-(4,6) in the center of the cell, all bonds are inside the cell (min-image offset 0).
    // This is a topologically closed loop but a **non-periodic loop** → should be recognized as a finite molecule and complete normally (not misinterpreted as an extended network).
    const atoms: Atom[] = [
      { id: 'p0', element: 'C', position: [0.4, 0.4, 0], cartesian: [4, 4, 0] },
      { id: 'p1', element: 'C', position: [0.6, 0.4, 0], cartesian: [6, 4, 0] },
      { id: 'p2', element: 'C', position: [0.6, 0.6, 0], cartesian: [6, 6, 0] },
      { id: 'p3', element: 'C', position: [0.4, 0.6, 0], cartesian: [4, 6, 0] },
    ]
    const bonds: Bond[] = [
      { id: 'e0', atom1Id: 'p0', atom2Id: 'p1', type: 'single' },
      { id: 'e1', atom1Id: 'p1', atom2Id: 'p2', type: 'single' },
      { id: 'e2', atom1Id: 'p2', atom2Id: 'p3', type: 'single' },
      { id: 'e3', atom1Id: 'p3', atom2Id: 'p0', type: 'single' }, // Finite ring closure with zero image offset.
    ]

    const map = computeUnwrappedDisplayPositions(atoms, bonds, cubic10)

    // Finite molecule → All 4 atoms are complete; since they are in the same group in the cell, the position ≈ canonical.
    expect(map.size).toBe(4)
    expect(map.get('p0')!).toEqual([4, 4, 0])
    expect(map.get('p2')!).toEqual([6, 6, 0])
  })

  it('跨边界分子环(部分原子在胞外镜像) 仍整体补全(非周期环)', () => {
    // Same 4-element square ring, but overall translated to cross the x=0 boundary: canonical x ∈ {0.5, 9.0, 9.0, 0.5}
    // (Two of the atoms are wrapped to x≈9). Really a complete square ring, only cut by the boundary - the closed edge offset
    // Still 0 (self-consistent after completion) → not a periodic ring → should be completed as a complete square ring.
    const atoms: Atom[] = [
      { id: 'q0', element: 'C', position: [0.05, 0.4, 0], cartesian: [0.5, 4, 0] },
      { id: 'q1', element: 'C', position: [0.9, 0.4, 0], cartesian: [9.0, 4, 0] }, // Unwrapped x = -1.
      { id: 'q2', element: 'C', position: [0.9, 0.6, 0], cartesian: [9.0, 6, 0] }, // Unwrapped x = -1.
      { id: 'q3', element: 'C', position: [0.05, 0.6, 0], cartesian: [0.5, 6, 0] },
    ]
    const bonds: Bond[] = [
      { id: 'f0', atom1Id: 'q0', atom2Id: 'q1', type: 'single' },
      { id: 'f1', atom1Id: 'q1', atom2Id: 'q2', type: 'single' },
      { id: 'f2', atom1Id: 'q2', atom2Id: 'q3', type: 'single' },
      { id: 'f3', atom1Id: 'q3', atom2Id: 'q0', type: 'single' },
    ]

    const map = computeUnwrappedDisplayPositions(atoms, bonds, cubic10)

    // Overall completion: All 4 atoms are in map, and completed into a complete square ring with side length ~1.5 (without a cutting span of ~8.5).
    expect(map.size).toBe(4)
    const q0 = map.get('q0')!
    const q1 = map.get('q1')!
    // q1 is placed in the mirror image of x≈-1 (adjacent to q0), not canonical 9.0.
    expect(q1[0]).toBeCloseTo(-1, 5)
    expect(dist(q0, q1)).toBeCloseTo(1.5, 5)
  })
})
