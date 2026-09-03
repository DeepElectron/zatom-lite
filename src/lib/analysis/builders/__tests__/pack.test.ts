/**
 * Packing, checked by re-measuring the result rather than trusting the packer.
 *
 * Every assertion about a distance here recomputes it from the emitted XYZ with
 * an independent brute-force minimum-image loop. That is deliberate: the bug
 * this module was written to fix — `water-layer.ts` accepting an 0.87 Å H–H
 * contact while reporting success — is precisely a packer believing its own
 * acceptance test. A test that asked the packer what its minimum separation was
 * would have passed on the broken version too.
 *
 * Reference values are physical constants, not fitted numbers:
 *   water at 300 K   ρ ≈ 0.997 g/cm³, 18.015 g/mol → 33.4 molecules/nm³
 *   H₂ bond length   0.74 Å — any contact below this is not a structure
 */
import { describe, expect, it } from 'vitest'

import { packMolecules, randomRotation, type PackSpecies } from '../pack'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

const WATER: PackSpecies = {
  name: 'water',
  atoms: [
    { element: 'O', position: [0, 0, 0] },
    { element: 'H', position: [0.9572, 0, 0] },
    { element: 'H', position: [-0.2399872, 0.9266272, 0] },   // 104.52°
  ],
}

const LITHIUM: PackSpecies = { name: 'Li', atoms: [{ element: 'Li', position: [0, 0, 0] }] }

function cube(L: number): Mat3 {
  return [[L, 0, 0], [0, L, 0], [0, 0, L]]
}

/**
 * Independent re-measurement: parse the XYZ and brute-force every pair under
 * the minimum-image convention. No shared code with the packer's own loop.
 *
 * `groups` excludes intramolecular pairs. Without it this measures r(O–H) =
 * 0.96 Å for every water box and tells you nothing — which is the mistake the
 * first version of both this function and the packer's own `minSeparation`
 * made. The grouping is bookkeeping, not the quantity under test; the distances
 * are still recomputed here from scratch.
 */
function measureMinSeparation(xyz: string, groups?: number[]): { d: number; pair: string } {
  const lines = xyz.split('\n')
  const n = Number(lines[0])
  const lat = /Lattice="([^"]+)"/.exec(lines[1])![1].split(/\s+/).map(Number)
  const box: Vec3 = [lat[0], lat[4], lat[8]]     // orthorhombic cells only
  const P: { e: string; p: Vec3 }[] = []
  for (let i = 0; i < n; i++) {
    const t = lines[2 + i].trim().split(/\s+/)
    P.push({ e: t[0], p: [Number(t[1]), Number(t[2]), Number(t[3])] })
  }
  let best = Infinity
  let pair = ''
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) {
        let d = P[i].p[k] - P[j].p[k]
        d -= box[k] * Math.round(d / box[k])
        s += d * d
      }
      const d = Math.sqrt(s)
      if (groups && groups[i] === groups[j]) continue
      if (d < best) { best = d; pair = `${P[i].e}-${P[j].e}` }
    }
  }
  return { d: best, pair }
}

function countElements(xyz: string): Record<string, number> {
  const lines = xyz.split('\n')
  const n = Number(lines[0])
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) {
    const el = lines[2 + i].trim().split(/\s+/)[0]
    out[el] = (out[el] ?? 0) + 1
  }
  return out
}

function measureTriclinicMinimum(xyz: string, lattice: Mat3, groups: number[]): number {
  const lines = xyz.split('\n')
  const n = Number(lines[0])
  const positions = Array.from({ length: n }, (_, index) => {
    const fields = lines[index + 2].trim().split(/\s+/)
    return [Number(fields[1]), Number(fields[2]), Number(fields[3])] as Vec3
  })
  let best = Infinity
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (groups[i] === groups[j]) continue
      for (let ia = -1; ia <= 1; ia++) for (let ib = -1; ib <= 1; ib++) for (let ic = -1; ic <= 1; ic++) {
        const dx = positions[j][0] - positions[i][0] + ia * lattice[0][0] + ib * lattice[1][0] + ic * lattice[2][0]
        const dy = positions[j][1] - positions[i][1] + ia * lattice[0][1] + ib * lattice[1][1] + ic * lattice[2][1]
        const dz = positions[j][2] - positions[i][2] + ia * lattice[0][2] + ib * lattice[1][2] + ic * lattice[2][2]
        best = Math.min(best, Math.hypot(dx, dy, dz))
      }
    }
  }
  return best
}

describe('the all-atom criterion actually holds', () => {
  it('no contact below the floor — re-measured, including across the boundary', () => {
    const floor = 2.0
    const r = packMolecules({
      lattice: cube(20), species: [{ ...WATER, count: 100 }],
      minDistance: floor, seed: 7,
    })
    const m = measureMinSeparation(r.xyz, r.moleculeIndex)
    expect(m.d).toBeGreaterThanOrEqual(floor - 1e-9)
    // And the packer's own report agrees with the independent measurement.
    expect(r.minSeparation).toBeCloseTo(m.d, 6)
  })

  it('the periodic image is checked, not just the atoms in the box', () => {
    // A packer that skipped the minimum image would happily place molecules
    // against opposite faces; the re-measurement below wraps, so it would catch
    // that as a sub-floor contact.
    const floor = 2.5
    const r = packMolecules({
      lattice: cube(14), species: [{ ...WATER, count: 40 }],
      minDistance: floor, seed: 99,
    })
    expect(measureMinSeparation(r.xyz, r.moleculeIndex).d).toBeGreaterThanOrEqual(floor - 1e-9)
  })

  it('does not reproduce the 0.87 Å H–H the water-only packer allowed', () => {
    // The regression, stated as a number. Anything below the H₂ bond length
    // (0.74 Å) is not a structure at all.
    const r = packMolecules({
      lattice: cube(20), species: [{ ...WATER, molFraction: 1 }],
      targetDensity: 1.0, minDistance: 1.8, seed: 12345,
    })
    const m = measureMinSeparation(r.xyz, r.moleculeIndex)
    expect(m.d).toBeGreaterThan(0.74)
    expect(m.d).toBeGreaterThanOrEqual(1.8 - 1e-9)
  })

  it('honours a per-element floor without letting the loose element decide', () => {
    // H may approach to 1.6, everything else to 2.6. An H–O pair takes the
    // *larger* floor, so it must clear 2.6, not 1.6.
    const r = packMolecules({
      lattice: cube(22), species: [{ ...WATER, count: 30 }],
      minDistance: 2.6, minDistanceByElement: { H: 1.6 }, seed: 3,
    })
    const lines = r.xyz.split('\n')
    const n = Number(lines[0])
    const lat = /Lattice="([^"]+)"/.exec(lines[1])![1].split(/\s+/).map(Number)
    const box: Vec3 = [lat[0], lat[4], lat[8]]
    const P = Array.from({ length: n }, (_, i) => {
      const t = lines[2 + i].trim().split(/\s+/)
      return { e: t[0], p: [Number(t[1]), Number(t[2]), Number(t[3])] as Vec3 }
    })
    let minHH = Infinity
    let minMixed = Infinity
    for (let i = 0; i < P.length; i++) {
      for (let j = i + 1; j < P.length; j++) {
        let s = 0
        for (let k = 0; k < 3; k++) {
          let d = P[i].p[k] - P[j].p[k]
          d -= box[k] * Math.round(d / box[k])
          s += d * d
        }
        const d = Math.sqrt(s)
        // Intramolecular pairs are exempt via the grouping, not via a distance
        // cutoff — a cutoff would also silently exempt a genuine intermolecular
        // overlap, which is the thing being looked for.
        if (r.moleculeIndex[i] === r.moleculeIndex[j]) continue
        if (P[i].e === 'H' && P[j].e === 'H') minHH = Math.min(minHH, d)
        else minMixed = Math.min(minMixed, d)
      }
    }
    if (Number.isFinite(minHH)) expect(minHH).toBeGreaterThanOrEqual(1.6 - 1e-9)
    if (Number.isFinite(minMixed)) expect(minMixed).toBeGreaterThanOrEqual(2.6 - 1e-9)
  })

  it('uses the row-lattice convention and reciprocal-safe buckets for a triclinic cell', () => {
    const lattice: Mat3 = [[15, 0, 0], [5, 14, 0], [2, 3, 13]]
    const floor = 2.5
    const r = packMolecules({
      lattice,
      species: [{ ...LITHIUM, count: 35 }],
      minDistance: floor,
      seed: 2026,
      maxAttemptsPerMolecule: 3000,
    })
    expect(r.incomplete).toBe(false)
    expect(measureTriclinicMinimum(r.xyz, lattice, r.moleculeIndex)).toBeGreaterThanOrEqual(floor - 1e-8)
  })
})

describe('density', () => {
  it('reaches liquid water density in a box that can hold it', () => {
    const L = 25
    const r = packMolecules({
      lattice: cube(L), species: [{ ...WATER, molFraction: 1 }],
      targetDensity: 0.997, minDistance: 1.7, seed: 11, maxAttemptsPerMolecule: 4000,
    })
    // 0.997 g/cm³ of water is 33.4 molecules per nm³.
    const perNm3 = r.placed.water / ((L / 10) ** 3)
    expect(perNm3).toBeGreaterThan(28)
    // The reported density is computed from what was placed, so it must track
    // the count rather than the request.
    // 18.016, not the textbook 18.015: the elements table carries O = 16.00
    // rather than 15.999. A 6e-5 relative difference, irrelevant to a density,
    // but the test has to use the same number the module does or it is testing
    // the table rather than the arithmetic.
    const expected = (r.placed.water * (16.00 + 2 * 1.008) / 6.02214076e23) / (L ** 3 * 1e-24)
    expect(r.density).toBeCloseTo(expected, 6)
  })

  it('reports the density it achieved, not the one it was asked for', () => {
    // A deliberately impossible request: the floor is too large for the count.
    const r = packMolecules({
      lattice: cube(12), species: [{ ...WATER, molFraction: 1 }],
      targetDensity: 3.0, minDistance: 3.0, seed: 5, maxAttemptsPerMolecule: 50,
    })
    expect(r.incomplete).toBe(true)
    expect(r.density).toBeLessThan(3.0)
    expect(r.description).toContain('INCOMPLETE')
  })

  it('uses the mixture mass, not one species mass, for a target density', () => {
    // Half water (18.015) half Li (6.941): mean 12.478. Using water's mass alone
    // would ask for 12.478/18.015 = 69% of the molecules it should.
    const r = packMolecules({
      lattice: cube(30),
      species: [{ ...WATER, molFraction: 0.5 }, { ...LITHIUM, molFraction: 0.5 }],
      targetDensity: 0.5, minDistance: 1.8, seed: 21, maxAttemptsPerMolecule: 2000,
    })
    const total = r.requested.water + r.requested.Li
    const avgMass = 0.5 * (16.00 + 2 * 1.008) + 0.5 * 6.941
    const expectedTotal = Math.round((0.5 * 30 ** 3 * 1e-24 * 6.02214076e23) / avgMass)
    expect(total).toBe(expectedTotal)
    expect(r.requested.water).toBe(r.requested.Li)
  })
})

describe('multiple species', () => {
  it('places both and labels them separately', () => {
    const r = packMolecules({
      lattice: cube(24),
      species: [{ ...WATER, count: 40 }, { ...LITHIUM, count: 6 }],
      minDistance: 2.0, seed: 4, maxAttemptsPerMolecule: 2000,
    })
    expect(r.placed.water).toBe(40)
    expect(r.placed.Li).toBe(6)
    const counts = countElements(r.xyz)
    expect(counts.O).toBe(40)
    expect(counts.H).toBe(80)
    expect(counts.Li).toBe(6)
  })

  it('keeps solute atoms and packs around them', () => {
    const solute = [
      { element: 'Pt', cartesian: [10, 10, 10] as Vec3 },
      { element: 'Pt', cartesian: [12.5, 10, 10] as Vec3 },
    ]
    const r = packMolecules({
      lattice: cube(20), species: [{ ...WATER, count: 30 }],
      soluteAtoms: solute, minDistance: 2.4, seed: 8, maxAttemptsPerMolecule: 2000,
    })
    const counts = countElements(r.xyz)
    expect(counts.Pt).toBe(2)                    // kept verbatim
    expect(counts.O).toBe(r.placed.water)
    // The floor applies to the solute too — nothing should have been dropped on
    // top of the platinum.
    expect(measureMinSeparation(r.xyz, r.moleculeIndex).d).toBeGreaterThanOrEqual(2.4 - 1e-9)
  })
})

describe('reproducibility', () => {
  it('the same seed gives the same box, atom for atom', () => {
    const opts = {
      lattice: cube(18), species: [{ ...WATER, count: 25 }],
      minDistance: 2.0, seed: 42,
    }
    expect(packMolecules(opts).xyz).toBe(packMolecules(opts).xyz)
  })

  it('a different seed gives a different box', () => {
    const a = packMolecules({ lattice: cube(18), species: [{ ...WATER, count: 25 }], minDistance: 2.0, seed: 1 })
    const b = packMolecules({ lattice: cube(18), species: [{ ...WATER, count: 25 }], minDistance: 2.0, seed: 2 })
    expect(a.xyz).not.toBe(b.xyz)
  })
})

describe('randomRotation samples SO(3) uniformly', () => {
  it('distributes an axis over the sphere without polar clustering', () => {
    // Sampling the polar angle uniformly instead of its cosine is the classic
    // error: it piles orientations near the poles. Rotate a fixed vector many
    // times and check that its z-component is uniform on [-1, 1], which is what
    // an isotropic direction gives.
    let a = 12345
    const rng = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const bins = new Array(10).fill(0)
    const N = 20000
    for (let i = 0; i < N; i++) {
      const R = randomRotation(rng)
      const z = R[2][2]                        // the rotated ẑ, its z-component
      const idx = Math.min(9, Math.floor(((z + 1) / 2) * 10))
      bins[idx]++
    }
    const expected = N / 10
    for (const count of bins) {
      // ±8% of uniform. A polar-clustered sampler puts 2–3× the expected count
      // in the end bins, far outside this.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.08)
    }
  })
})

describe('refusals', () => {
  const base = { lattice: cube(20), species: [{ ...WATER, count: 10 }], seed: 1 }

  it('rejects an empty species list', () => {
    expect(() => packMolecules({ ...base, species: [] })).toThrow(/no species/)
  })

  it('rejects a species with no atoms', () => {
    expect(() => packMolecules({ ...base, species: [{ name: 'ghost', atoms: [], count: 1 }] }))
      .toThrow(/has no atoms/)
  })

  it('rejects a degenerate cell rather than dividing by its volume', () => {
    expect(() => packMolecules({ ...base, lattice: [[1, 0, 0], [2, 0, 0], [0, 0, 1]] }))
      .toThrow(/singular/)
  })

  it('rejects a non-positive minimum distance', () => {
    expect(() => packMolecules({ ...base, minDistance: 0 })).toThrow(/minDistance/)
  })

  it('says how to specify an amount when none was given', () => {
    expect(() => packMolecules({ lattice: cube(20), species: [WATER], seed: 1 }))
      .toThrow(/count.*totalCount.*targetDensity/)
  })

  it('rejects an unknown element instead of treating it as massless', () => {
    expect(() => packMolecules({
      ...base,
      species: [{ name: 'x', atoms: [{ element: 'Xx', position: [0, 0, 0] }], molFraction: 1 }],
      targetDensity: 1,
    })).toThrow(/unknown element/)
  })
})
