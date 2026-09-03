import { describe, expect, it } from 'vitest'
import { invert3x3, isValidLattice, latticeShift, toFractional } from '../lattice-math'
import type { LatticeLike, Vec3 } from '../lattice-math'

function fracOf(lattice: LatticeLike, cart: Vec3): Vec3 {
  const inv = invert3x3(lattice)!
  return toFractional(inv, cart[0], cart[1], cart[2])
}

describe('invert3x3 / toFractional', () => {
  // Lattice vectors are matrix columns. Treating a/b/c as rows can pass for an
  // orthogonal cell while producing cross-axis errors for skewed cells.
  it('晶格矢量本身的分数坐标是单位基（非正交晶格下也成立）', () => {
    const monoclinic: LatticeLike = { a: [10, 0, 0], b: [3, 8, 0], c: [1, 2, 12] }
    const fa = fracOf(monoclinic, monoclinic.a)
    const fb = fracOf(monoclinic, monoclinic.b)
    const fc = fracOf(monoclinic, monoclinic.c)
    for (const [got, want] of [
      [fa, [1, 0, 0]],
      [fb, [0, 1, 0]],
      [fc, [0, 0, 1]],
    ] as const) {
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 10))
    }
  })

  it('三斜晶格：fractional 与 latticeShift 互为逆运算', () => {
    const triclinic: LatticeLike = { a: [9, 1, 0.5], b: [2, 7, 1], c: [0.5, 1.5, 11] }
    const frac: Vec3 = [0.3, 1.7, -0.4]
    const cart = latticeShift(triclinic, frac[0], frac[1], frac[2])
    const back = fracOf(triclinic, cart)
    back.forEach((v, i) => expect(v).toBeCloseTo(frac[i], 10))
  })

  it('奇异晶格（共面矢量）返回 null 而非 NaN 矩阵', () => {
    // c = a + b → The three vectors are coplanar and the determinant is 0.
    expect(invert3x3({ a: [1, 0, 0], b: [0, 1, 0], c: [1, 1, 0] })).toBeNull()
  })
})

describe('isValidLattice', () => {
  it('拒绝空值、非有限分量与退化（近零）矢量', () => {
    expect(isValidLattice(null)).toBe(false)
    expect(isValidLattice({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, Number.NaN] })).toBe(false)
    expect(isValidLattice({ a: [0, 0, 0], b: [0, 1, 0], c: [0, 0, 1] })).toBe(false)
    expect(isValidLattice({ a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] })).toBe(true)
  })
})
