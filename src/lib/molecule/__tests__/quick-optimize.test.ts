import { describe, it, expect } from 'vitest'
import { quickOptimizeGeometry, type OptAtom, type OptBond } from '../quick-optimize'

function dist(a: [number, number, number], b: [number, number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}
function angleDeg(
  a: [number, number, number],
  c: [number, number, number],
  b: [number, number, number],
) {
  const u = [a[0] - c[0], a[1] - c[1], a[2] - c[2]]
  const v = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const mu = Math.hypot(u[0], u[1], u[2])
  const mv = Math.hypot(v[0], v[1], v[2])
  return (Math.acos(Math.max(-1, Math.min(1, dot / (mu * mv)))) * 180) / Math.PI
}

describe('quickOptimizeGeometry', () => {
  it('does NOT distort an already-ideal water molecule (<5% change)', () => {
    // O at origin, two O-H = 0.96 Å with H-O-H = 104.5°
    const half = (104.5 / 2) * (Math.PI / 180)
    const rOH = 0.96
    const atoms: OptAtom[] = [
      { id: 'O', element: 'O', cartesian: [0, 0, 0] },
      { id: 'H1', element: 'H', cartesian: [rOH * Math.sin(half), rOH * Math.cos(half), 0] },
      { id: 'H2', element: 'H', cartesian: [-rOH * Math.sin(half), rOH * Math.cos(half), 0] },
    ]
    const bonds: OptBond[] = [
      { atom1Id: 'O', atom2Id: 'H1', type: 'single' },
      { atom1Id: 'O', atom2Id: 'H2', type: 'single' },
    ]
    const { positions, stats } = quickOptimizeGeometry(atoms, bonds)

    const d1 = dist(positions.O, positions.H1)
    const d2 = dist(positions.O, positions.H2)
    const ang = angleDeg(positions.H1, positions.O, positions.H2)

    // bond length change < 5%
    expect(Math.abs(d1 - rOH) / rOH).toBeLessThan(0.05)
    expect(Math.abs(d2 - rOH) / rOH).toBeLessThan(0.05)
    // O-H target r0 for O+H covalent = 0.66+0.31 = 0.97 ~ ideal, angle should
    // stay close to the sp3 bent target; change vs 104.5 small.
    expect(Math.abs(ang - 104.5) / 104.5).toBeLessThan(0.10)
    // already-good structure barely moves
    expect(stats.maxMove).toBeLessThan(0.05)
    expect(Number.isFinite(stats.rmsForce)).toBe(true)
  })

  it('does NOT distort an ideal methane (C-H ~1.09, H-C-H ~109.5)', () => {
    const r = 1.09
    const k = r / Math.sqrt(3)
    const atoms: OptAtom[] = [
      { id: 'C', element: 'C', cartesian: [0, 0, 0] },
      { id: 'H1', element: 'H', cartesian: [k, k, k] },
      { id: 'H2', element: 'H', cartesian: [k, -k, -k] },
      { id: 'H3', element: 'H', cartesian: [-k, k, -k] },
      { id: 'H4', element: 'H', cartesian: [-k, -k, k] },
    ]
    const bonds: OptBond[] = [
      { atom1Id: 'C', atom2Id: 'H1', type: 'single' },
      { atom1Id: 'C', atom2Id: 'H2', type: 'single' },
      { atom1Id: 'C', atom2Id: 'H3', type: 'single' },
      { atom1Id: 'C', atom2Id: 'H4', type: 'single' },
    ]
    const { positions } = quickOptimizeGeometry(atoms, bonds)
    for (const h of ['H1', 'H2', 'H3', 'H4']) {
      const d = dist(positions.C, positions[h])
      expect(Math.abs(d - r) / r).toBeLessThan(0.05)
    }
    const ang = angleDeg(positions.H1, positions.C, positions.H2)
    expect(Math.abs(ang - 109.5) / 109.5).toBeLessThan(0.05)
  })

  it('improves a flat, overlapping structure: removes clashes, fixes bonds, develops 3D', () => {
    // Planar formaldehyde-ish skeleton placed badly: all z=0, with an extra
    // far-but-clashing atom pair and stretched bonds.
    // C bonded to O (double), H, H — but coordinates are squished/planar with
    // a non-bonded H..H clash.
    // Two methyl groups whose H atoms (non-bonded across the two carbons)
    // overlap badly in a flat layout; plus a stretched C-C bond.
    const atoms: OptAtom[] = [
      { id: 'C1', element: 'C', cartesian: [0, 0, 0] },
      { id: 'C2', element: 'C', cartesian: [0.6, 0, 0] }, // C-C far too short (clash + bond)
      { id: 'H1', element: 'H', cartesian: [-0.3, 0.5, 0] },
      { id: 'H2', element: 'H', cartesian: [-0.3, -0.5, 0] },
      { id: 'H3', element: 'H', cartesian: [0.9, 0.5, 0] }, // clashes with H1 across carbons
      { id: 'H4', element: 'H', cartesian: [0.9, -0.5, 0] },
    ]
    const bonds: OptBond[] = [
      { atom1Id: 'C1', atom2Id: 'C2', type: 'single' },
      { atom1Id: 'C1', atom2Id: 'H1', type: 'single' },
      { atom1Id: 'C1', atom2Id: 'H2', type: 'single' },
      { atom1Id: 'C2', atom2Id: 'H3', type: 'single' },
      { atom1Id: 'C2', atom2Id: 'H4', type: 'single' },
    ]
    const { positions, stats } = quickOptimizeGeometry(atoms, bonds)

    // 1) clashes resolved (no non-bonded pair below 0.8*vdW sum)
    expect(stats.clashesBefore).toBeGreaterThan(0)
    expect(stats.clashesAfter).toBe(0)

    // 2) bond lengths trend toward physical r0
    const dCC = dist(positions.C1, positions.C2) // C-C target ~ (0.76+0.76) = 1.52
    const dCH1 = dist(positions.C1, positions.H1) // ~ (0.76+0.31) = 1.07
    expect(dCC).toBeGreaterThan(0.6) // expanded from 0.6
    expect(dCC).toBeGreaterThan(1.1)
    expect(dCC).toBeLessThan(2.0)
    expect(dCH1).toBeGreaterThan(0.7)
    expect(dCH1).toBeLessThan(1.5)

    // 3) all finite, no NaN
    for (const id of Object.keys(positions)) {
      const p = positions[id]
      expect(Number.isFinite(p[0])).toBe(true)
      expect(Number.isFinite(p[1])).toBe(true)
      expect(Number.isFinite(p[2])).toBe(true)
    }
  })

  it('breaks planarity for a flat planar fragment (develops non-zero z)', () => {
    // A small all-z=0 chain that wants to pucker; jitter + repulsion should give
    // it measurable out-of-plane character.
    const atoms: OptAtom[] = [
      { id: 'C1', element: 'C', cartesian: [0, 0, 0] },
      { id: 'C2', element: 'C', cartesian: [1.5, 0, 0] },
      { id: 'C3', element: 'C', cartesian: [3.0, 0, 0] },
      { id: 'C4', element: 'C', cartesian: [4.5, 0, 0] },
      { id: 'H1', element: 'H', cartesian: [0.0, 0.9, 0] },
      { id: 'H2', element: 'H', cartesian: [0.0, -0.9, 0] },
    ]
    const bonds: OptBond[] = [
      { atom1Id: 'C1', atom2Id: 'C2', type: 'single' },
      { atom1Id: 'C2', atom2Id: 'C3', type: 'single' },
      { atom1Id: 'C3', atom2Id: 'C4', type: 'single' },
      { atom1Id: 'C1', atom2Id: 'H1', type: 'single' },
      { atom1Id: 'C1', atom2Id: 'H2', type: 'single' },
    ]
    const { positions } = quickOptimizeGeometry(atoms, bonds)
    const maxAbsZ = Math.max(...Object.values(positions).map((p) => Math.abs(p[2])))
    expect(maxAbsZ).toBeGreaterThan(0.01)
  })

  it('respects fixedIds (anchored atoms do not move)', () => {
    const atoms: OptAtom[] = [
      { id: 'A', element: 'C', cartesian: [0, 0, 0] },
      { id: 'B', element: 'C', cartesian: [2.5, 0, 0] }, // stretched bond
    ]
    const bonds: OptBond[] = [{ atom1Id: 'A', atom2Id: 'B', type: 'single' }]
    const { positions } = quickOptimizeGeometry(atoms, bonds, { fixedIds: new Set(['A']) })
    // A stays exactly put
    expect(positions.A[0]).toBe(0)
    expect(positions.A[1]).toBe(0)
    expect(positions.A[2]).toBe(0)
    // B moved toward A (bond shortened)
    expect(dist(positions.A, positions.B)).toBeLessThan(2.5)
  })

  it('handles empty input without NaN', () => {
    const { positions, stats } = quickOptimizeGeometry([], [])
    expect(Object.keys(positions).length).toBe(0)
    expect(stats.iters).toBe(0)
    expect(Number.isFinite(stats.rmsForce)).toBe(true)
  })

  it('is deterministic (same input -> identical output)', () => {
    const atoms: OptAtom[] = [
      { id: 'C', element: 'C', cartesian: [0, 0, 0] },
      { id: 'O', element: 'O', cartesian: [1.8, 0, 0] },
      { id: 'H1', element: 'H', cartesian: [-0.3, 0.3, 0] },
      { id: 'H2', element: 'H', cartesian: [-0.3, -0.3, 0] },
    ]
    const bonds: OptBond[] = [
      { atom1Id: 'C', atom2Id: 'O', type: 'double' },
      { atom1Id: 'C', atom2Id: 'H1', type: 'single' },
      { atom1Id: 'C', atom2Id: 'H2', type: 'single' },
    ]
    const r1 = quickOptimizeGeometry(atoms, bonds)
    const r2 = quickOptimizeGeometry(atoms, bonds)
    expect(r1.positions).toEqual(r2.positions)
  })

  it('PBC: optimizes sanely with a lattice matrix (minimum image)', () => {
    // Two atoms split across a periodic boundary; min image bond is short.
    const atoms: OptAtom[] = [
      { id: 'A', element: 'C', cartesian: [0.2, 0, 0] },
      { id: 'B', element: 'C', cartesian: [9.6, 0, 0] }, // across boundary of a=10
    ]
    const bonds: OptBond[] = [{ atom1Id: 'A', atom2Id: 'B', type: 'single' }]
    const { positions, stats } = quickOptimizeGeometry(atoms, bonds, {
      latticeMatrix: [
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
    })
    expect(Number.isFinite(positions.A[0])).toBe(true)
    expect(Number.isFinite(positions.B[0])).toBe(true)
    expect(stats.rmsForce).toBeLessThan(10) // not diverging
  })

  it('PBC: 不把胞外原子折回单胞,键合分子不被边界撕开', () => {
    const L = 5.0
    const cell: [[number, number, number], [number, number, number], [number, number, number]] =
      [[L, 0, 0], [0, L, 0], [0, 0, L]]
    // B is placed far away from the 5Å unit cell (12/9/-6), and has a chemical bond with A.
    const atoms: OptAtom[] = [
      { id: 'A', element: 'C', cartesian: [1.0, 1.0, 1.0] },
      { id: 'B', element: 'C', cartesian: [12.0, 9.0, -6.0] },
    ]
    const bonds: OptBond[] = [{ atom1Id: 'A', atom2Id: 'B', type: 'single' }]
    const { positions } = quickOptimizeGeometry(atoms, bonds, { latticeMatrix: cell })

    // It used to be asserted here that "all atoms are wrapped back to [0,L)". That action will send bonded atoms across the boundary into the unit cell
    // The coordinate data is rewritten at both ends. The fragments placed outside the cell by the user cannot be returned once optimized. No more folding now.
    //
    // This guarantee is two things:
    // (1) Physically correct - the bond length according to the minimum mirroring amount is still within the bonding range (A and B are bonded through periodic imaging,
    // So it is completely normal to be very far apart under the original cartesian, and cannot be judged by naked distance);
    const [ax, ay, az] = positions.A
    const [bx, by, bz] = positions.B
    const micComp = (d: number) => d - L * Math.round(d / L) // Axis-by-axis minimal mirroring of orthogonal cells
    const micDist = Math.hypot(micComp(bx - ax), micComp(by - ay), micComp(bz - az))
    expect(micDist).toBeGreaterThan(0.5)
    expect(micDist).toBeLessThan(3.0)

    // (2) Not forced to fold - B was originally outside the cell (12,9,-6). After optimization, it should still be near the outside of the cell instead of being folded.
    // mod 1 is transferred into [0,L). This is the modeling experience that this change aims to maintain.
    const bFolded = bx >= -1e-6 && bx < L && by >= -1e-6 && by < L && bz >= -1e-6 && bz < L
    expect(bFolded).toBe(false)
  })
})
