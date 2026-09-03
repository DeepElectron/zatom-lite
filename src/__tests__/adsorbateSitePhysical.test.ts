import { describe, expect, it } from 'vitest'
import { buildSlabFromMiller } from '../lib/analysis/builders/slab'
import {
  detectSites,
  detectSurfaceLayer,
  resolveSurfaceFrame,
} from '../lib/analysis/builders/adsorbate'
import { unwrapSites } from './helpers/unwrapSites'

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
const sub = (p: readonly number[], q: readonly number[]): V3 => [
  p[0] - q[0],
  p[1] - q[1],
  p[2] - q[2],
]
const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2])

/** Parse builder extXYZ into lattice and atom coordinates. */
function parseSlab(xyz: string) {
  const lines = xyz.trim().split('\n')
  const m = /Lattice="([^"]+)"/.exec(lines[1])
  if (!m) throw new Error('no Lattice in extxyz header')
  const n = m[1].trim().split(/\s+/).map(Number)
  const lattice = {
    a: [n[0], n[1], n[2]] as V3,
    b: [n[3], n[4], n[5]] as V3,
    c: [n[6], n[7], n[8]] as V3,
  }
  const atoms = lines.slice(2).map((l) => {
    const p = l.trim().split(/\s+/)
    return { element: p[0], cartesian: [+p[1], +p[2], +p[3]] as V3 }
  })
  return { lattice, atoms }
}

function cuSlab([h, k, l]: V3, layers = 4) {
  const res = buildSlabFromMiller({
    lattice: [
      [A0, 0, 0],
      [0, A0, 0],
      [0, 0, A0],
    ],
    atoms: FCC_CU,
    h,
    k,
    l,
    layers,
    vacuum: 12,
  })
  return parseSlab(res.xyz)
}

/** Minimum site-to-atom distance including in-plane periodic images. */
function minDistToAtoms(
  site: V3,
  atoms: { cartesian: V3 }[],
  inPlane: [V3, V3],
) {
  let best = Infinity
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const sh: V3 = [
        inPlane[0][0] * i + inPlane[1][0] * j,
        inPlane[0][1] * i + inPlane[1][1] * j,
        inPlane[0][2] * i + inPlane[1][2] * j,
      ]
      for (const a of atoms) {
        const d = len(sub(site, [a.cartesian[0] + sh[0], a.cartesian[1] + sh[1], a.cartesian[2] + sh[2]]))
        if (d < best) best = d
      }
    }
  }
  return best
}

describe('吸附位点的物理正确性', () => {
  // Cover Miller planes whose builder output places vacuum on different lattice axes.
  for (const miller of [[1, 0, 0], [1, 1, 1], [1, 1, 0]] as V3[]) {
    const tag = `(${miller.join('')})`

    it(`${tag} 位点位于最表层之上、不与原子重叠`, () => {
      const { lattice, atoms } = cuSlab(miller)
      const frame = resolveSurfaceFrame(lattice, atoms.map((a) => a.cartesian))
      const sites = unwrapSites(detectSites(atoms, { lattice }))
      const layer = detectSurfaceLayer(atoms, { lattice })

      expect(sites.length).toBeGreaterThan(0)

      const topMost = Math.max(...atoms.map((a) => dotv(a.cartesian, frame.up)))
      const layerH = Math.max(
        ...layer.atomIndices.map((i) => dotv(atoms[i].cartesian, frame.up)),
      )
      // The selected top layer must actually be the highest layer.
      expect(layerH).toBeCloseTo(topMost, 3)

      for (const s of sites) {
        const h = dotv(s.position, frame.up) - topMost
        // Sites must sit above the surface, not in bulk, at the vacuum ceiling, or below the slab.
        expect(h).toBeGreaterThan(0.3)
        expect(h).toBeLessThan(3.0)
        // Sites must not overlap atoms or their periodic images.
        expect(minDistToAtoms(s.position, atoms, frame.inPlane)).toBeGreaterThan(1.2)
      }
    })
  }
})
