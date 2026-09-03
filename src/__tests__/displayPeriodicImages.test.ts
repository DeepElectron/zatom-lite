// Bonds connect only atom instances that are actually rendered.
//
// The old endpoint=atom2+latticeOffset*L rule could point at periodic locations with no sphere,
// creating floating spikes and bonds outside the cell while leaving image spheres unbonded.
//
// Atom and bond layers must share one authoritative instance set.

import { describe, expect, it } from 'vitest'
import { autoDetectBonds } from '../lib/crystal/bonds'
import {
  buildBondSegments,
  buildDisplayImageOffsets,
  edgeImageOffsets,
  imageOffsetKey,
  isHomeImage,
} from '../lib/crystal/display-periodic-images'
import { latticeShift } from '../lib/crystal/lattice-math'
import type { Atom, LatticeVectors } from '../lib/crystal/types'

const A = 4.08
const lattice: LatticeVectors = { a: [A, 0, 0], b: [0, A, 0], c: [0, 0, A] }
/** FCC nearest-neighbor distance a/sqrt(2). */
const NEAREST = A / Math.SQRT2
const ALL_PERIODIC = { a: true, b: true, c: true }

// Conventional four-atom FCC Au cell.
const frac: Array<[number, number, number]> = [
  [0, 0, 0],
  [0.5, 0.5, 0],
  [0.5, 0, 0.5],
  [0, 0.5, 0.5],
]
const atoms: Atom[] = frac.map((f, i) => ({
  id: `Au${i}`,
  element: 'Au',
  position: f,
  cartesian: [f[0] * A, f[1] * A, f[2] * A],
}))

const positionOf = (id: string) => atoms.find((a) => a.id === id)?.cartesian
const dist = (p: readonly number[], q: readonly number[]) =>
  Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])

function displayInstances(mask = ALL_PERIODIC) {
  return buildDisplayImageOffsets(
    atoms.map((a) => a.id),
    [edgeImageOffsets(atoms, lattice, mask)],
  )
}

/** All rendered sphere centers; every bond endpoint must match one. */
function drawnSphereCenters(mask = ALL_PERIODIC) {
  const out: [number, number, number][] = []
  for (const [id, offsets] of displayInstances(mask)) {
    const base = positionOf(id)!
    for (const off of offsets) {
      const s = latticeShift(lattice, off[0], off[1], off[2])
      out.push([base[0] + s[0], base[1] + s[1], base[2] + s[2]])
    }
  }
  return out
}

describe('显示实例集合', () => {
  it('镜像球只贴在晶胞表面,不向胞外扩张一圈邻居', () => {
    for (const center of drawnSphereCenters()) {
      for (const v of center) {
        expect(v).toBeGreaterThanOrEqual(-1e-6)
        expect(v).toBeLessThanOrEqual(A + 1e-6)
      }
    }
  })

  it('非周期轴上不生成镜像', () => {
    // A nonperiodic boundary is a real surface and must not gain image atoms.
    for (const [, offsets] of displayInstances({ a: true, b: true, c: false })) {
      for (const off of offsets) expect(off[2]).toBe(0)
    }
  })

  it('超胞下贴边偏移以显示盒为单位 —— ±1 而非 ±n,与键的 latticeOffset 同单位', () => {
    const n = 2
    const box: LatticeVectors = {
      a: [A * n, 0, 0], b: [0, A * n, 0], c: [0, 0, A * n],
    }
    const offsets = edgeImageOffsets(
      [{ id: 'x', cartesian: [0, 0, 0] }],
      box,
      ALL_PERIODIC,
    )
    expect(offsets.get('x')).toContainEqual([1, 1, 1])
  })
})

describe('buildBondSegments', () => {
  const bonds = autoDetectBonds(atoms, lattice, 3.0, {}, false, { periodic: true })

  it('前提:这个体系确实产生跨边界键', () => {
    expect(bonds.filter((b) => b.latticeOffset?.some((v) => v !== 0)).length).toBe(18)
  })

  it('每一段的两端都落在被画出来的球心上 —— 没有伸到周期性之外的悬空尖刺', () => {
    const segments = buildBondSegments({
      bonds, positionOf, lattice, instances: displayInstances(),
    })
    const centers = drawnSphereCenters()
    const onSphere = (p: readonly number[]) => centers.some((c) => dist(c, p) < 1e-6)

    expect(segments.length).toBeGreaterThan(0)
    for (const seg of segments) {
      expect(onSphere(seg.p1)).toBe(true)
      expect(onSphere(seg.p2)).toBe(true)
      // Sphere-center endpoints remain inside the closed cell.
      for (const v of [...seg.p1, ...seg.p2]) {
        expect(v).toBeGreaterThanOrEqual(-1e-6)
        expect(v).toBeLessThanOrEqual(A + 1e-6)
      }
      // Matching preserves the physical nearest-neighbor length rather than spanning the cell.
      expect(dist(seg.p1, seg.p2)).toBeCloseTo(NEAREST, 6)
    }
  })

  it('镜像球也有键 —— 不是只有原胞那一份在连线', () => {
    const segments = buildBondSegments({
      bonds, positionOf, lattice, instances: displayInstances(),
    })
    const mirrorSegments = segments.filter((s) => !isHomeImage(s.image))
    expect(mirrorSegments.length).toBeGreaterThan(0)
    // Segments for distinct images need unique React and instance keys.
    expect(new Set(segments.map((s) => s.key)).size).toBe(segments.length)
    // image identifies the first endpoint's image cell for per-instance decisions.
    for (const s of mirrorSegments) {
      const shift = latticeShift(lattice, s.image[0], s.image[1], s.image[2])
      const base = positionOf(s.bond.atom1Id)!
      expect(dist(s.p1, [base[0] + shift[0], base[1] + shift[1], base[2] + shift[2]])).toBeLessThan(1e-9)
    }
  })

  it('非周期体系原样一段,绝不按 latticeOffset 平移端点', () => {
    // Molecular and biomolecular layers have no periodic display semantics.
    const segments = buildBondSegments({
      bonds, positionOf, lattice, instances: null,
    })
    expect(segments.length).toBe(bonds.length)
    for (const seg of segments) {
      expect(seg.p1).toEqual([...positionOf(seg.bond.atom1Id)!])
      expect(seg.p2).toEqual([...positionOf(seg.bond.atom2Id)!])
      expect(seg.key).toBe(seg.bond.id)
    }
  })

  it('非正交晶格按向量线性组合平移,而不是逐轴加减', () => {
    // Monoclinic and triclinic vectors require linear combinations rather than componentwise shifts.
    const monoclinic: LatticeVectors = { a: [4, 0, 0], b: [1, 5, 0], c: [0, 0, 6] }
    expect(latticeShift(monoclinic, 1, 1, 0)).toEqual([5, 5, 0])
  })

  it('偏移键格式化为稳定 key', () => {
    expect(imageOffsetKey([1, -1, 0])).toBe('1,-1,0')
  })
})
