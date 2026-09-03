/**
 * Dislocations, checked against the definition rather than against a snapshot.
 *
 * The decisive test is the Burgers circuit. A dislocation *is* a line whose
 * enclosing circuit fails to close by a lattice translation **b**; a
 * displacement field that does not produce that closure failure is not a
 * dislocation, however plausible it looks when rendered. So the field is walked
 * around a loop and the closure defect is compared to **b** — for screw, edge
 * and mixed, at several radii, in both signs.
 *
 * Reference values are crystallography, not fitted numbers:
 *   Cu (FCC, a = 3.615 Å)   b = a/2⟨110⟩ = a/√2 = 2.5561910 Å
 *   Fe (BCC, a = 2.866 Å)   b = a/2⟨111⟩ = a√3/2 = 2.48203… Å
 *   Al Shockley partial     b = a/6⟨112⟩ = a√6/6, i.e. 1/3 of a/2⟨112⟩
 */
import { describe, expect, it } from 'vitest'

import {
  buildDislocation,
  burgersCircuitClosure,
  burgersMagnitude,
  characterOf,
  dislocationFrame,
  edgeDisplacement,
  screwDisplacement,
  type DislocationAtomInput,
} from '../dislocation'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const A_CU = 3.615
const B_CU = A_CU / Math.SQRT2          // 2.5561910…
const A_FE = 2.866

/** A cubic block of FCC sites, big enough to enclose a Burgers circuit. */
function fccBlock(a: number, n: number): { lattice: Mat3; atoms: DislocationAtomInput[] } {
  const basis: Vec3[] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]]
  const atoms: DislocationAtomInput[] = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < n; k++)
        for (const b of basis)
          atoms.push({
            element: 'Cu',
            cartesian: [(i + b[0]) * a, (j + b[1]) * a, (k + b[2]) * a],
          })
  const lattice: Mat3 = [[n * a, 0, 0], [0, n * a, 0], [0, 0, n * a]]
  return { lattice, atoms }
}

describe('burgersMagnitude — |b| is a lattice translation', () => {
  it('FCC a/2<110> for copper', () => {
    expect(burgersMagnitude([1, 1, 0], A_CU, 'fcc')).toBeCloseTo(B_CU, 12)
    expect(burgersMagnitude([1, 1, 0], A_CU, 'fcc')).toBeCloseTo(2.5561910, 6)
  })

  it('BCC a/2<111> for iron', () => {
    expect(burgersMagnitude([1, 1, 1], A_FE, 'bcc')).toBeCloseTo((A_FE * Math.sqrt(3)) / 2, 12)
    expect(burgersMagnitude([1, 1, 1], A_FE, 'bcc')).toBeCloseTo(2.4820, 4)
  })

  it('is direction-independent within a family', () => {
    for (const d of [[1, 1, 0], [0, 1, 1], [1, 0, 1], [-1, 1, 0]] as Vec3[]) {
      expect(burgersMagnitude(d, A_CU, 'fcc')).toBeCloseTo(B_CU, 12)
    }
  })
})

describe('characterOf — derived, not declared', () => {
  it('b parallel to the line is screw', () => {
    expect(characterOf([1, 1, 0], [1, 1, 0]).character).toBe('screw')
    expect(characterOf([1, 1, 0], [-1, -1, 0]).character).toBe('screw')  // antiparallel too
  })

  it('b perpendicular to the line is edge', () => {
    const r = characterOf([1, 1, 0], [1, -1, 0])
    expect(r.character).toBe('edge')
    expect(r.angleDeg).toBeCloseTo(90, 9)
  })

  it('the 60-degree dislocation of FCC glide is mixed', () => {
    // b = a/2[1-10], ξ = a/2[01-1] — the commonest dislocation in an FCC metal.
    const r = characterOf([1, -1, 0], [0, 1, -1])
    expect(r.character).toBe('mixed')
    expect(r.angleDeg).toBeCloseTo(60, 6)
  })
})

describe('Burgers circuit — the definition', () => {
  const nu = 0.33

  it('closes short by exactly b for a screw', () => {
    const frame = dislocationFrame([0, 0, 1], [0, 0, 1])
    for (const radius of [5, 20, 100]) {
      const closure = burgersCircuitClosure([0, 0, 0], frame, 0, B_CU, nu, radius)
      expect(closure[2]).toBeCloseTo(B_CU, 6)
      expect(Math.hypot(closure[0], closure[1])).toBeLessThan(1e-6)
    }
  })

  it('closes short by exactly b for an edge', () => {
    const frame = dislocationFrame([1, 0, 0], [0, 0, 1])
    for (const radius of [5, 20, 100]) {
      const closure = burgersCircuitClosure([0, 0, 0], frame, B_CU, 0, nu, radius)
      // b lies along the glide direction x̂ = [1,0,0]
      expect(closure[0]).toBeCloseTo(B_CU, 5)
      expect(Math.abs(closure[1])).toBeLessThan(1e-4)
      expect(Math.abs(closure[2])).toBeLessThan(1e-9)
    }
  })

  it('splits correctly for a mixed dislocation', () => {
    // 60°: |b_screw| = |b|cos60 = |b|/2, |b_edge| = |b|sin60
    const bDir: Vec3 = [1, -1, 0]
    const lDir: Vec3 = [0, 1, -1]
    const frame = dislocationFrame(bDir, lDir)
    const cosang = (bDir[0] * lDir[0] + bDir[1] * lDir[1] + bDir[2] * lDir[2]) /
      (Math.hypot(...bDir) * Math.hypot(...lDir))
    const bScrew = B_CU * cosang
    const bEdge = B_CU * Math.sqrt(1 - cosang * cosang)
    expect(Math.abs(bScrew)).toBeCloseTo(B_CU / 2, 9)
    const closure = burgersCircuitClosure([0, 0, 0], frame, bEdge, bScrew, nu, 30)
    expect(Math.hypot(...closure)).toBeCloseTo(B_CU, 5)
  })

  it('is independent of the number of steps once resolved', () => {
    const frame = dislocationFrame([1, 0, 0], [0, 0, 1])
    const coarse = burgersCircuitClosure([0, 0, 0], frame, B_CU, 0, nu, 20, 512)
    const fine = burgersCircuitClosure([0, 0, 0], frame, B_CU, 0, nu, 20, 8192)
    expect(coarse[0]).toBeCloseTo(fine[0], 4)
  })

  it('reverses sign with b', () => {
    const frame = dislocationFrame([0, 0, 1], [0, 0, 1])
    const plus = burgersCircuitClosure([0, 0, 0], frame, 0, B_CU, nu, 20)
    const minus = burgersCircuitClosure([0, 0, 0], frame, 0, -B_CU, nu, 20)
    expect(plus[2]).toBeCloseTo(-minus[2], 9)
  })
})

describe('the displacement fields themselves', () => {
  it('screw displaces only along the line', () => {
    for (const [x, y] of [[1, 0], [0, 1], [-3, 2], [10, -7]]) {
      const u = screwDisplacement(x, y, B_CU)
      expect(u[0]).toBe(0)
      expect(u[1]).toBe(0)
    }
  })

  it('screw is antisymmetric across the cut, by exactly b', () => {
    // Approaching θ = 0 from above and below differs by one full b.
    const eps = 1e-9
    const above = screwDisplacement(1, eps, B_CU)[2]
    const below = screwDisplacement(1, -eps, B_CU)[2]
    // Continuous at θ = 0: the gap is (b/2π)·2ε, which is 8.14e-10 here — not
    // zero, and asserting zero to 9 places was asserting the wrong thing.
    expect(above - below).toBeCloseTo((B_CU / (2 * Math.PI)) * 2 * eps, 15)
    const justUnder = screwDisplacement(-1, eps, B_CU)[2]
    const justOver = screwDisplacement(-1, -eps, B_CU)[2]
    expect(justUnder - justOver).toBeCloseTo(B_CU, 6)  // the cut at θ = ±π
  })

  it('edge does not displace along the line', () => {
    for (const [x, y] of [[1, 0], [0, 1], [-3, 2]]) {
      expect(edgeDisplacement(x, y, B_CU, 0.33)[2]).toBe(0)
    }
  })

  it('edge u_y does not depend on the length unit', () => {
    // The ln(r²/b²) form makes the argument dimensionless. Scaling both r and b
    // by the same factor must scale u_y by that factor and nothing more — with
    // ln(r²) it would pick up a spurious constant instead.
    const s = 10
    const u1 = edgeDisplacement(3, 4, B_CU, 0.33)
    const u2 = edgeDisplacement(3 * s, 4 * s, B_CU * s, 0.33)
    expect(u2[0]).toBeCloseTo(u1[0] * s, 9)
    expect(u2[1]).toBeCloseTo(u1[1] * s, 9)
  })

  it('is finite everywhere except the line', () => {
    for (const r of [1e-3, 1e-1, 1, 1e3]) {
      const u = edgeDisplacement(r, 0, B_CU, 0.33)
      expect(Number.isFinite(u[0])).toBe(true)
      expect(Number.isFinite(u[1])).toBe(true)
    }
    expect(edgeDisplacement(0, 0, B_CU, 0.33)).toEqual([0, 0, 0])
  })
})

describe('buildDislocation', () => {
  const { lattice, atoms } = fccBlock(A_CU, 8)

  it('builds a screw cylinder and reports its character', () => {
    const r = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10,
    })
    expect(r.character).toBe('screw')
    expect(r.burgersMagnitude).toBeCloseTo(B_CU, 9)
    // acos near 1 loses precision; 1e-6 degrees is float noise, not a mixed character.
    expect(r.characterAngleDeg).toBeCloseTo(0, 4)
    expect(r.n_atoms).toBeGreaterThan(0)
    expect(r.xyz.split('\n')[0]).toBe(String(r.n_atoms))
  })

  it('builds an edge dislocation', () => {
    const r = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, -1, 0],
      latticeConstant: A_CU, radius: 10,
    })
    expect(r.character).toBe('edge')
    expect(r.characterAngleDeg).toBeCloseTo(90, 6)
  })

  it('conserves atoms inside the cylinder — the field creates the defect, it does not remove matter', () => {
    // The extra half-plane of an edge dislocation comes out of the elastic
    // field, not out of deleting a plane of atoms. So the only atoms lost are
    // the ones outside the cylinder.
    const plain = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10, burgersScale: 1e-12,
    })
    const real = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10,
    })
    expect(real.n_atoms).toBe(plain.n_atoms)
  })

  it('coreRadius removes the atoms the elastic solution cannot describe', () => {
    const withCore = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10, coreRadius: 0,
    })
    const excised = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10, coreRadius: 4,
    })
    expect(excised.n_atoms).toBeLessThan(withCore.n_atoms)
    expect(excised.minSeparation).toBeGreaterThanOrEqual(withCore.minSeparation)
  })

  it('flags a partial as leaving a stacking fault', () => {
    const partial = buildDislocation({
      lattice, atoms, burgers: [1, 1, 2], lineDirection: [1, -1, 0],
      latticeConstant: A_CU, radius: 10, burgersScale: 1 / 3,
    })
    expect(partial.leavesStackingFault).toBe(true)
    expect(partial.description).toContain('stacking fault')
    // a/6<112> = (1/3)·(a/2<112>); a/2<112> has |b| = a√6/2
    expect(partial.burgersMagnitude).toBeCloseTo((A_CU * Math.sqrt(6)) / 6, 9)
  })

  it('a perfect dislocation is not flagged', () => {
    const perfect = buildDislocation({
      lattice, atoms, burgers: [1, 1, 0], lineDirection: [1, 1, 0],
      latticeConstant: A_CU, radius: 10,
    })
    expect(perfect.leavesStackingFault).toBe(false)
    expect(perfect.description).not.toContain('stacking fault')
  })
})

describe('buildDislocation refuses what it cannot mean', () => {
  const { lattice, atoms } = fccBlock(A_CU, 4)
  const base = {
    lattice, atoms, burgers: [1, 1, 0] as Vec3, lineDirection: [1, 1, 0] as Vec3,
    latticeConstant: A_CU,
  }

  it('rejects the incompressible limit', () => {
    // ν = 0.5 divides by zero in every 1/(1−ν) factor of the edge field.
    expect(() => buildDislocation({ ...base, poissonRatio: 0.5 })).toThrow(/Poisson/)
    expect(() => buildDislocation({ ...base, poissonRatio: 0.6 })).toThrow(/Poisson/)
    expect(() => buildDislocation({ ...base, poissonRatio: -1.5 })).toThrow(/Poisson/)
  })

  it('accepts the physical range', () => {
    for (const nu of [0, 0.2, 0.33, 0.49]) {
      expect(() => buildDislocation({ ...base, poissonRatio: nu, radius: 5 })).not.toThrow()
    }
  })

  it('rejects an empty structure rather than emitting an empty cell', () => {
    expect(() => buildDislocation({ ...base, atoms: [] })).toThrow(/no atoms/)
  })

  it('says so when the core excision empties the cell', () => {
    expect(() => buildDislocation({ ...base, coreRadius: 1e4 })).toThrow(/removed every atom/)
  })

  it('says so when the cylinder falls outside the cell', () => {
    expect(() => buildDislocation({ ...base, radius: -1 })).toThrow(/radius must be positive/)
  })

  it('rejects a non-positive Burgers scale', () => {
    expect(() => buildDislocation({ ...base, burgersScale: 0 })).toThrow(/burgersScale/)
  })
})
