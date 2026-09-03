/**
 * Numerical invariants for periodic bonding.
 *
 * Coordination and bond lengths are fixed by the crystal. BCC must not become seven-coordinate,
 * and the first shell must not gain a second bond length.
 *
 * Numerical tests are required because excess object-spread properties can evade TypeScript while
 * silently breaking lattice offsets; coordination exposes that failure.
 */

import { describe, expect, it } from 'vitest'
import { autoDetectBonds } from '../lib/crystal/bonds'
import type { Atom, LatticeVectors } from '../lib/crystal/types'

type V3 = [number, number, number]

function cubic(a: number): LatticeVectors {
  return { a: [a, 0, 0], b: [0, a, 0], c: [0, 0, a] }
}

function atom(id: string, element: string, cartesian: V3): Atom {
  return { id, element, position: cartesian, cartesian } as Atom
}

function coordinationOf(bonds: { atom1Id: string; atom2Id: string }[], id: string): number {
  return bonds.filter((b) => b.atom1Id === id || b.atom2Id === id).length
}

function uniqueLengths(bonds: { length?: number }[]): string[] {
  return [...new Set(bonds.map((b) => (b.length ?? Number.NaN).toFixed(3)))]
}

function crossingBonds(bonds: { latticeOffset?: V3 }[]) {
  return bonds.filter((b) => b.latticeOffset?.some((v) => v !== 0))
}

/** BCC Fe has coordination eight, with seven neighbors in periodic images. */
function bccFe() {
  const a = 2.87
  return {
    a,
    lattice: cubic(a),
    atoms: [atom('corner', 'Fe', [0, 0, 0]), atom('body', 'Fe', [a / 2, a / 2, a / 2])],
  }
}

describe('周期成键 —— BCC Fe', () => {
  // A 2.6-angstrom cutoff isolates the 2.485 first shell from the 2.87 second shell.
  const { lattice, atoms } = bccFe()
  const periodic = autoDetectBonds(atoms, lattice, 2.6, {}, false, { periodic: true })

  it('第一壳层给出 8 根键,两个位点都是 8 配位', () => {
    expect(periodic).toHaveLength(8)
    expect(coordinationOf(periodic, 'body')).toBe(8)
    expect(coordinationOf(periodic, 'corner')).toBe(8)
  })

  it('第一壳层键长唯一等于 2.485 A', () => {
    expect(uniqueLengths(periodic)).toEqual(['2.485'])
  })

  it('8 根键中 7 根带非零 latticeOffset', () => {
    // Only one bond lies in the home cell; latticeOffset places the other endpoints in images.
    expect(crossingBonds(periodic)).toHaveLength(7)
  })

  it('关掉周期只找到胞内那 1 根 —— 即修复前的行为', () => {
    const intraCell = autoDetectBonds(atoms, lattice, 2.6, {}, false)
    expect(intraCell).toHaveLength(1)
    expect(intraCell.every((b) => !b.latticeOffset)).toBe(true)
  })
})

describe('周期成键 —— NaCl 岩盐 8 原子胞', () => {
  const a = 5.64
  const lattice = cubic(a)
  const scale = (f: V3): V3 => [f[0] * a, f[1] * a, f[2] * a]
  const naFrac: V3[] = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]]
  const clFrac: V3[] = [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0.5, 0.5]]
  const atoms = [
    ...naFrac.map((f, i) => atom(`na${i}`, 'Na', scale(f))),
    ...clFrac.map((f, i) => atom(`cl${i}`, 'Cl', scale(f))),
  ]
  const periodic = autoDetectBonds(atoms, lattice, 3.0, {}, false, { periodic: true })

  it('每个离子 6 配位,共 24 根键', () => {
    // Eight atoms times coordination six divided by two gives 24 bonds.
    expect(periodic).toHaveLength(24)
    for (let i = 0; i < 4; i++) {
      expect(coordinationOf(periodic, `na${i}`)).toBe(6)
      expect(coordinationOf(periodic, `cl${i}`)).toBe(6)
    }
  })

  it('键长唯一等于 2.820 A', () => {
    expect(uniqueLengths(periodic)).toEqual(['2.820'])
  })

  it('恰好一半配位跨越边界,胞内检测会丢掉这一半', () => {
    expect(crossingBonds(periodic)).toHaveLength(12)
    expect(autoDetectBonds(atoms, lattice, 3.0, {}, false)).toHaveLength(12)
  })
})

describe('非周期体系不受影响', () => {
  const atoms = [atom('c', 'C', [0, 0, 0]), atom('o', 'O', [1.2, 0, 0])]

  it('1 A 占位假胞下默认只有 1 根键', () => {
    // Molecular orbitals use a one-angstrom placeholder cell that must not trigger image search.
    const bonds = autoDetectBonds(atoms, cubic(1), 3.0, {}, false)
    expect(bonds).toHaveLength(1)
    expect(bonds.every((b) => !b.latticeOffset)).toBe(true)
  })

  it('退化晶格即使显式请求周期也退回胞内检测', () => {
    const degenerate: LatticeVectors = { a: [0, 0, 0], b: [0, 1, 0], c: [0, 0, 1] }
    expect(autoDetectBonds(atoms, degenerate, 3.0, {}, false, { periodic: true })).toHaveLength(1)
  })
})

describe('判据旋钮在周期模式下生效', () => {
  const { lattice, atoms } = bccFe()

  it('容差改变命中的壳层数', () => {
    // Fe covalent-radius sum is 2.64; tolerance 0 excludes the 2.87 shell and 0.4 includes it.
    const tight = autoDetectBonds(atoms, lattice, 3.0, {}, false, { periodic: true, tolerance: 0 })
    const loose = autoDetectBonds(atoms, lattice, 3.0, {}, false, { periodic: true, tolerance: 0.4 })
    expect(tight.length).toBeLessThan(loose.length)
    expect(uniqueLengths(tight)).toHaveLength(1)
  })

  it('元素对覆盖值优先于自动判据', () => {
    // Override 2.0 lies below the 2.485 first shell and excludes all bonds.
    expect(autoDetectBonds(atoms, lattice, 3.0, { 'Fe-Fe': 2.0 }, false, { periodic: true })).toHaveLength(0)
    // Override 2.6 retains only the eight first-shell bonds.
    expect(autoDetectBonds(atoms, lattice, 3.0, { 'Fe-Fe': 2.6 }, false, { periodic: true })).toHaveLength(8)
  })
})
