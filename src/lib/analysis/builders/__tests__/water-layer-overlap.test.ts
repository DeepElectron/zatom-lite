/**
 * The water builder used to emit hard atomic overlaps and report success.
 *
 * Its acceptance test was O-to-O only, and — worse — the molecular orientation
 * was drawn *after* that test ran, so the hydrogens' positions did not exist at
 * the moment anything was checked. With r(O–H) = 1 Å and an O–O floor of 2.5 Å,
 * two hydrogens pointing at each other are 0.5 Å apart and nothing looked.
 *
 * Measured on the builder's own output before the fix, 267 waters in a 20 Å cube
 * at ρ = 1.0, seed 12345: the true minimum was **0.87 Å, H–H**. The bond in H₂
 * is 0.74 Å. Any MD or DFT run started from that box diverges on the first step.
 *
 * These tests re-measure the emitted XYZ rather than asking the builder what it
 * achieved, because the failure was exactly a builder trusting its own test.
 */
import { describe, expect, it } from 'vitest'

import { buildWaterLayer } from '../water-layer'

type Vec3 = [number, number, number]

/** Minimum intermolecular distance, brute force, minimum-image, orthorhombic. */
function minIntermolecular(xyz: string, wrapC = true): { d: number; pair: string } {
  const lines = xyz.split('\n')
  const n = Number(lines[0])
  const lat = /Lattice="([^"]+)"/.exec(lines[1])![1].split(/\s+/).map(Number)
  const box: Vec3 = [lat[0], lat[4], lat[8]]
  const P: { e: string; p: Vec3 }[] = []
  for (let i = 0; i < n; i++) {
    const t = lines[2 + i].trim().split(/\s+/)
    P.push({ e: t[0], p: [Number(t[1]), Number(t[2]), Number(t[3])] })
  }
  // Waters are emitted as consecutive O, H, H triples after any solute atoms.
  // Group by that, so a molecule's own bonds are excluded — they are 1 Å by
  // construction and are not what a packing floor is about.
  const firstO = P.findIndex((a) => a.e === 'O')
  const groupOf = (i: number): number => (i < firstO ? -1 : Math.floor((i - firstO) / 3))
  let best = Infinity
  let pair = ''
  for (let i = 0; i < P.length; i++) {
    for (let j = i + 1; j < P.length; j++) {
      if (groupOf(i) === groupOf(j)) continue
      let s = 0
      for (let k = 0; k < 3; k++) {
        let d = P[i].p[k] - P[j].p[k]
        if (k < 2 || wrapC) d -= box[k] * Math.round(d / box[k])
        s += d * d
      }
      const d = Math.sqrt(s)
      if (d < best) { best = d; pair = `${P[i].e}-${P[j].e}` }
    }
  }
  return { d: best, pair }
}

const CUBE20: [Vec3, Vec3, Vec3] = [[20, 0, 0], [0, 20, 0], [0, 0, 20]]

describe('box mode no longer emits overlaps', () => {
  it('the exact case that measured 0.87 Å now clears the floor', () => {
    const r = buildWaterLayer({ mode: 'box', lattice: CUBE20, density: 1.0, seed: 12345 })
    const m = minIntermolecular(r.xyz)
    expect(m.d).toBeGreaterThan(0.74)              // longer than the H₂ bond
    expect(m.d).toBeGreaterThanOrEqual(1.6 - 1e-9) // and clears the new default
  })

  it('honours an explicit all-atom floor', () => {
    for (const floor of [1.4, 1.8, 2.0]) {
      const r = buildWaterLayer({
        mode: 'box', lattice: CUBE20, density: 1.0, seed: 4, min_atom_atom_distance: floor,
      })
      expect(minIntermolecular(r.xyz).d).toBeGreaterThanOrEqual(floor - 1e-9)
    }
  })

  it('still reaches a useful density at the default floor', () => {
    // The fix is only worth having if the builder can still fill a box. 20³ Å³
    // at ρ = 1.0 wants 267 waters; a floor that made that unreachable would have
    // traded one wrong answer for another.
    const r = buildWaterLayer({ mode: 'box', lattice: CUBE20, density: 1.0, seed: 12345 })
    const waters = r.n_atoms / 3
    expect(waters).toBeGreaterThan(200)
  })

  it('the O-O criterion still holds too — the new test adds, it does not replace', () => {
    const r = buildWaterLayer({
      mode: 'box', lattice: CUBE20, density: 0.8, seed: 77, min_water_water_distance: 2.8,
    })
    const lines = r.xyz.split('\n')
    const n = Number(lines[0])
    const O: Vec3[] = []
    for (let i = 0; i < n; i++) {
      const t = lines[2 + i].trim().split(/\s+/)
      if (t[0] === 'O') O.push([Number(t[1]), Number(t[2]), Number(t[3])])
    }
    let best = Infinity
    for (let i = 0; i < O.length; i++) {
      for (let j = i + 1; j < O.length; j++) {
        let s = 0
        for (let k = 0; k < 3; k++) {
          let d = O[i][k] - O[j][k]
          d -= 20 * Math.round(d / 20)
          s += d * d
        }
        best = Math.min(best, Math.sqrt(s))
      }
    }
    expect(best).toBeGreaterThanOrEqual(2.8 - 1e-9)
  })
})

describe('solute exclusion covers hydrogens too', () => {
  it('no water atom sits inside the solute', () => {
    const solute = [
      { element: 'Pt', cartesian: [10, 10, 10] as Vec3 },
      { element: 'Pt', cartesian: [12.77, 10, 10] as Vec3 },
    ]
    const r = buildWaterLayer({
      mode: 'box', lattice: CUBE20, density: 0.9, seed: 31,
      solute_atoms: solute, min_atom_atom_distance: 1.8,
    })
    const lines = r.xyz.split('\n')
    const n = Number(lines[0])
    let worst = Infinity
    for (let i = 0; i < n; i++) {
      const t = lines[2 + i].trim().split(/\s+/)
      if (t[0] === 'Pt') continue
      const p: Vec3 = [Number(t[1]), Number(t[2]), Number(t[3])]
      for (const s of solute) {
        let acc = 0
        for (let k = 0; k < 3; k++) {
          let d = p[k] - s.cartesian[k]
          d -= 20 * Math.round(d / 20)
          acc += d * d
        }
        worst = Math.min(worst, Math.sqrt(acc))
      }
    }
    // The old code checked only the oxygen against the solute, so a hydrogen
    // could be a bond length closer than the stated floor.
    expect(worst).toBeGreaterThanOrEqual(1.8 - 1e-9)
  })
})

describe('surface mode gets the same check', () => {
  const slab = Array.from({ length: 16 }, (_, n) => ({
    element: 'Pt',
    cartesian: [Math.floor(n / 4) * 2.8, (n % 4) * 2.8, 0] as Vec3,
  }))
  const build = () => buildWaterLayer({
    mode: 'surface',
    lattice: [[11.2, 0, 0], [0, 11.2, 0], [0, 0, 30]],
    solute_atoms: slab,
    layer_thickness: 12,
    seed: 19,
    min_atom_atom_distance: 1.7,
  })

  it('a water layer above a slab has no internal overlaps', () => {
    // `wrapC: false`. Surface mode is a slab with vacuum, not a 3D-periodic
    // cell, and the builder's own acceptance test skips wrapping along the open
    // axis for that reason. Wrapping it here would compare a water at the top of
    // the layer against the slab at the bottom, which are not neighbours — the
    // first version of this test did, measured 1.49 Å, and blamed the builder.
    expect(minIntermolecular(build().xyz, false).d).toBeGreaterThanOrEqual(1.7 - 1e-9)
  })

  it('but the emitted cell is too tight to treat as 3D-periodic', () => {
    // Worth pinning, because the output is an extended-XYZ with a Lattice="..."
    // header and that normally means fully periodic. The builder sizes c to
    // *enclose* the water layer, not to decouple the images: a 12 Å layer on
    // this slab yields c = 16.5 Å, leaving 4.5 Å of headroom. A consumer that
    // wraps all three axes therefore sees a 1.49 Å Pt–H contact across the
    // boundary — a real overlap, arising from the cell rather than the packing.
    //
    // A slab calculation normally wants 10–15 Å of vacuum. This test does not
    // assert what the number should be; it records what it is, so that adding
    // vacuum padding later shows up here as a deliberate change.
    const r = build()
    const c = Number(/Lattice="([^"]+)"/.exec(r.xyz.split('\n')[1])![1].split(/\s+/)[8])
    expect(c).toBeCloseTo(16.5, 6)
    const wrapped = minIntermolecular(r.xyz, true)
    expect(wrapped.d).toBeLessThan(1.7)
    expect(wrapped.pair).toMatch(/Pt|H/)
  })
})
