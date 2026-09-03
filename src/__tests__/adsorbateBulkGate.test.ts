import { describe, expect, it } from 'vitest'
import {
  detectSites,
  assessSurface,
  MIN_VACUUM_A,
  type AdsorbateAtomInput,
} from '../lib/analysis/builders/adsorbate'

const A0 = 3.615
type V3 = [number, number, number]

/** FCC Cu bulk cell: periodic in all directions with no vacuum or surface. */
function bulkCu(nx = 2, ny = 2, nz = 2) {
  const basis: V3[] = [
    [0, 0, 0],
    [0, A0 / 2, A0 / 2],
    [A0 / 2, 0, A0 / 2],
    [A0 / 2, A0 / 2, 0],
  ]
  const atoms: AdsorbateAtomInput[] = []
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        for (const b of basis) {
          atoms.push({
            element: 'Cu',
            cartesian: [b[0] + i * A0, b[1] + j * A0, b[2] + k * A0],
          })
        }
      }
    }
  }
  const lattice = {
    a: [nx * A0, 0, 0] as V3,
    b: [0, ny * A0, 0] as V3,
    c: [0, 0, nz * A0] as V3,
  }
  return { atoms, lattice }
}

describe('块体结构必须被拒绝，而不是硬给错位点', () => {
  it('三向周期的 fcc Cu 块体不产生任何吸附位点', () => {
    const { atoms, lattice } = bulkCu()
    const result = detectSites(atoms, { lattice })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('bulk')
    // Assert action keywords so copy can change while slab-and-vacuum guidance remains mandatory.
    expect(result.message).toMatch(/slab/i)
    expect(result.message).toMatch(/vacuum/i)
    expect(result.message).toMatch(/miller/i)
  })

  it('真空不足（< 阈值）同样被拒绝', () => {
    const { atoms } = bulkCu(1, 1, 2)
    // Three angstroms of c-axis vacuum cannot separate the periodic image above.
    const cLen = 2 * A0 + 3
    const lattice = { a: [A0, 0, 0] as V3, b: [0, A0, 0] as V3, c: [0, 0, cLen] as V3 }
    const assessment = assessSurface(lattice, atoms.map((a) => a.cartesian))
    expect(assessment.ok).toBe(false)
    if (assessment.ok) return
    expect(assessment.vacuumA).toBeLessThan(MIN_VACUUM_A)
  })

  it('真空充足时正常放行', () => {
    const { atoms } = bulkCu(1, 1, 2)
    const cLen = 2 * A0 + 15
    const lattice = { a: [A0, 0, 0] as V3, b: [0, A0, 0] as V3, c: [0, 0, cLen] as V3 }
    const result = detectSites(atoms, { lattice })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sites.length).toBeGreaterThan(0)
    expect(result.vacuumA).toBeGreaterThanOrEqual(MIN_VACUUM_A)
  })

  it('分子（无晶胞）不受真空判定限制', () => {
    const atoms: AdsorbateAtomInput[] = [
      { element: 'Cu', cartesian: [0, 0, 0] },
      { element: 'Cu', cartesian: [2.5, 0, 0] },
      { element: 'Cu', cartesian: [1.25, 2.2, 0] },
    ]
    const result = detectSites(atoms)
    expect(result.ok).toBe(true)
  })
})
