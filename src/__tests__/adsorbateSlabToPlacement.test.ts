import { describe, expect, it } from 'vitest'
import { buildSlabFromMiller } from '../lib/analysis/builders/slab'
import { detectSites, resolveSurfaceFrame } from '../lib/analysis/builders/adsorbate'
import { unwrapSites } from './helpers/unwrapSites'

/**
 * End-to-end slab cut, vacuum addition, site detection, and adsorbate placement.
 *
 * This positive case complements the bulk rejection test: the gate must accept a real slab.
 * Assertions use physical quantities rather than intermediate results from the tested functions.
 *
 * Unlike adsorbateSitePhysical, this checks all 3D periodic images, including those across the
 * vacuum axis, to catch wrapping onto the neighboring slab's underside.
 */

const A0 = 3.615
type V3 = [number, number, number]

const FCC_CU = [
  { element: 'Cu', cartesian: [0, 0, 0] as V3 },
  { element: 'Cu', cartesian: [0, A0 / 2, A0 / 2] as V3 },
  { element: 'Cu', cartesian: [A0 / 2, 0, A0 / 2] as V3 },
  { element: 'Cu', cartesian: [A0 / 2, A0 / 2, 0] as V3 },
]

const dotv = (p: readonly number[], q: readonly number[]) =>
  p[0] * q[0] + p[1] * q[1] + p[2] * q[2]

function parseSlab(xyz: string) {
  const lines = xyz.trim().split('\n')
  const m = /Lattice="([^"]+)"/.exec(lines[1])
  if (!m) throw new Error('no Lattice in extxyz header')
  const n = m[1].trim().split(/\s+/).map(Number)
  return {
    lattice: {
      a: [n[0], n[1], n[2]] as V3,
      b: [n[3], n[4], n[5]] as V3,
      c: [n[6], n[7], n[8]] as V3,
    },
    atoms: lines.slice(2).map((l) => {
      const p = l.trim().split(/\s+/)
      return { element: p[0], cartesian: [+p[1], +p[2], +p[3]] as V3 }
    }),
  }
}

/** Minimum site-to-atom distance across all 27 neighboring periodic images. */
function minDist3D(
  site: V3,
  atoms: { cartesian: V3 }[],
  lattice: { a: V3; b: V3; c: V3 },
) {
  const L = [lattice.a, lattice.b, lattice.c]
  let best = Infinity
  for (const at of atoms) {
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          let d = 0
          for (let t = 0; t < 3; t++) {
            const q = at.cartesian[t] + i * L[0][t] + j * L[1][t] + k * L[2][t]
            d += (site[t] - q) ** 2
          }
          best = Math.min(best, Math.sqrt(d))
        }
  }
  return best
}

describe('slab → vacuum → sites → placement 端到端', () => {
  for (const miller of [[1, 1, 1], [1, 0, 0], [1, 1, 0]] as V3[]) {
    it(`Cu(${miller.join('')}) 切面后位点全部合法`, () => {
      const built = buildSlabFromMiller({
        lattice: [
          [A0, 0, 0],
          [0, A0, 0],
          [0, 0, A0],
        ],
        atoms: FCC_CU,
        h: miller[0],
        k: miller[1],
        l: miller[2],
        layers: 4,
        vacuum: 10,
      })
      const { lattice, atoms } = parseSlab(built.xyz)

      // A real slab must pass the bulk gate.
      const res = detectSites(atoms, { lattice })
      expect(res.ok).toBe(true)
      const sites = unwrapSites(res)
      expect(sites.length).toBeGreaterThan(0)

      const frame = resolveSurfaceFrame(lattice, atoms.map((a) => a.cartesian))
      // vacuumA measures center-to-center circular clearance and is slightly below the requested 10;
      // require it to remain safely above the gate threshold.
      expect(frame.vacuumA).toBeGreaterThan(7)

      const topMost = Math.max(...atoms.map((a) => dotv(a.cartesian, frame.up)))
      for (const s of sites) {
        // 1. Chemically plausible height above the surface.
        const h = dotv(s.position as V3, frame.up) - topMost
        expect(h).toBeGreaterThan(0.3)
        expect(h).toBeLessThan(3.0)
        // 2. No overlap with any 3D image; 1.2 angstroms is below a typical H-Cu bond length.
        expect(minDist3D(s.position as V3, atoms, lattice)).toBeGreaterThan(1.2)
      }
    })
  }

  it('位点在晶胞内（分数坐标 0..1），不会飞到胞外', () => {
    const built = buildSlabFromMiller({
      lattice: [
        [A0, 0, 0],
        [0, A0, 0],
        [0, 0, A0],
      ],
      atoms: FCC_CU,
      h: 1,
      k: 1,
      l: 1,
      layers: 4,
      vacuum: 10,
    })
    const { lattice, atoms } = parseSlab(built.xyz)
    const sites = unwrapSites(detectSites(atoms, { lattice }))

    // Solve p = f0*a + f1*b + f2*c.
    const { a: A, b: B, c: C } = lattice
    const det =
      A[0] * (B[1] * C[2] - B[2] * C[1]) -
      B[0] * (A[1] * C[2] - A[2] * C[1]) +
      C[0] * (A[1] * B[2] - A[2] * B[1])
    for (const s of sites) {
      const p = s.position as V3
      const f0 =
        ((B[1] * C[2] - B[2] * C[1]) * p[0] +
          (C[0] * B[2] - B[0] * C[2]) * p[1] +
          (B[0] * C[1] - C[0] * B[1]) * p[2]) / det
      const f1 =
        ((C[1] * A[2] - A[1] * C[2]) * p[0] +
          (A[0] * C[2] - C[0] * A[2]) * p[1] +
          (C[0] * A[1] - A[0] * C[1]) * p[2]) / det
      const f2 =
        ((A[1] * B[2] - B[1] * A[2]) * p[0] +
          (B[0] * A[2] - A[0] * B[2]) * p[1] +
          (A[0] * B[1] - B[0] * A[1]) * p[2]) / det
      for (const f of [f0, f1, f2]) {
        expect(f).toBeGreaterThanOrEqual(-1e-6)
        expect(f).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })
})
