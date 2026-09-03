/**
 * Site detection must derive the surface normal from the lattice rather than assuming +z.
 *
 * The slab builder may place stacking on any axis. For Cu(100), c=(24.46,0,0) makes the normal
 * +/-x. A hard-coded +z layer cuts through the slab and places sites inside bulk atoms.
 */
import { describe, it, expect } from 'vitest'
import { buildSlabFromMiller } from '../lib/analysis/builders/slab'
import {
  detectSites,
  detectSurfaceLayer,
  resolveSurfaceFrame,
} from '../lib/analysis/builders/adsorbate'
import { unwrapSites } from './helpers/unwrapSites'

const A = 3.615
const CU_FCC = {
  lattice: [
    [A, 0, 0],
    [0, A, 0],
    [0, 0, A],
  ] as [[number, number, number], [number, number, number], [number, number, number]],
  atoms: [
    { element: 'Cu', cartesian: [0, 0, 0] as [number, number, number] },
    { element: 'Cu', cartesian: [0, A / 2, A / 2] as [number, number, number] },
    { element: 'Cu', cartesian: [A / 2, 0, A / 2] as [number, number, number] },
    { element: 'Cu', cartesian: [A / 2, A / 2, 0] as [number, number, number] },
  ],
}

function parseExtxyz(xyz: string) {
  const lines = xyz.split('\n')
  const m = lines[1].match(/Lattice="([^"]+)"/)
  const n0 = m ? m[1].trim().split(/\s+/).map(Number) : []
  const lattice = {
    a: [n0[0], n0[1], n0[2]] as [number, number, number],
    b: [n0[3], n0[4], n0[5]] as [number, number, number],
    c: [n0[6], n0[7], n0[8]] as [number, number, number],
  }
  const n = Number(lines[0].trim())
  const atoms = lines.slice(2, 2 + n).map((l) => {
    const p = l.trim().split(/\s+/)
    return {
      element: p[0],
      cartesian: [Number(p[1]), Number(p[2]), Number(p[3])] as [number, number, number],
    }
  })
  return { lattice, atoms }
}

describe('adsorption sites on a Miller-cut slab', () => {
  for (const [h, k, l] of [[1, 0, 0], [1, 1, 1]] as const) {
    const tag = `${h}${k}${l}`

    it(`Cu(${tag}): 顶层是一个真实原子层，不是贯穿厚度的切面`, () => {
      const built = buildSlabFromMiller({ ...CU_FCC, h, k, l, layers: 4, vacuum: 10 })
      const { lattice, atoms } = parseExtxyz(built.xyz)
      const up = resolveSurfaceFrame(lattice, atoms.map((a) => a.cartesian)).up

      const layer = detectSurfaceLayer(atoms, { lattice })
      const proj = atoms.map((a) => a.cartesian[0] * up[0] + a.cartesian[1] * up[1] + a.cartesian[2] * up[2])
      const maxP = Math.max(...proj)

      // Every top-layer atom lies at the maximum normal projection within layer tolerance.
      for (const idx of layer.atomIndices) {
        expect(maxP - proj[idx]).toBeLessThanOrEqual(0.5 + 1e-9)
      }
      // A multilayer slab's top layer must be a strict subset of all atoms.
      expect(layer.atomIndices.length).toBeGreaterThan(0)
      expect(layer.atomIndices.length).toBeLessThan(atoms.length)
    })

    it(`Cu(${tag}): 位点全部位于表面之上，不埋在体相里`, () => {
      const built = buildSlabFromMiller({ ...CU_FCC, h, k, l, layers: 4, vacuum: 10 })
      const { lattice, atoms } = parseExtxyz(built.xyz)
      const up = resolveSurfaceFrame(lattice, atoms.map((a) => a.cartesian)).up
      const height = (p: readonly number[]) => p[0] * up[0] + p[1] * up[1] + p[2] * up[2]

      const topAtomHeight = Math.max(...atoms.map((a) => height(a.cartesian)))
      const sites = unwrapSites(detectSites(atoms, { lattice }))

      expect(sites.length).toBeGreaterThan(0)
      for (const s of sites) {
        // Sites remain above the highest atom; bridge and hollow centering may lower them slightly.
        expect(height(s.position)).toBeGreaterThan(topAtomHeight - 0.5)
        // Site normals must align with the lattice-derived normal rather than +z.
        expect(Math.abs(s.normal[0] * up[0] + s.normal[1] * up[1] + s.normal[2] * up[2])).toBeCloseTo(1, 6)
      }
    })
  }

  it('每个表面原子都应有 top 位点（周期边界不丢位点）', () => {
    const built = buildSlabFromMiller({ ...CU_FCC, h: 1, k: 0, l: 0, layers: 4, vacuum: 10 })
    const { lattice, atoms } = parseExtxyz(built.xyz)
    const layer = detectSurfaceLayer(atoms, { lattice })
    const sites = unwrapSites(detectSites(atoms, { lattice }))
    const tops = sites.filter((s) => s.kind === 'top')
    expect(tops.length).toBe(layer.atomIndices.length)

    // FCC(100) has four in-plane neighbors per surface atom, yielding about two shared bridge sites per atom.
    const bridges = sites.filter((s) => s.kind === 'bridge')
    expect(bridges.length).toBeGreaterThanOrEqual(layer.atomIndices.length * 2)

    // Sites must span two in-plane dimensions rather than collapse onto one line.
    const dotv = (p: readonly number[], q: readonly number[]) =>
      p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
    const unitv = (v: readonly number[]) => {
      const n = Math.hypot(v[0], v[1], v[2])
      return [v[0] / n, v[1] / n, v[2] / n]
    }
    const alongA = new Set(
      sites.map((s) => Math.round(dotv(s.position, unitv(lattice.a)) * 10) / 10),
    )
    const alongB = new Set(
      sites.map((s) => Math.round(dotv(s.position, unitv(lattice.b)) * 10) / 10),
    )
    expect(alongA.size).toBeGreaterThan(1)
    expect(alongB.size).toBeGreaterThan(1)
  })
})
