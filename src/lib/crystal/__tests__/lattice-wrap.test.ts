import { describe, it, expect } from 'vitest'
import { wrapCartesianIntoCell, clampCartesianToCell } from '../lattice'
import type { LatticeVectors } from '../types'

type Vec3 = [number, number, number]

function closeVec(a: Vec3, b: Vec3) {
  expect(a[0]).toBeCloseTo(b[0], 9)
  expect(a[1]).toBeCloseTo(b[1], 9)
  expect(a[2]).toBeCloseTo(b[2], 9)
}

const cubic10: LatticeVectors = {
  a: [10, 0, 0],
  b: [0, 10, 0],
  c: [0, 0, 10],
}

describe('wrapCartesianIntoCell', () => {
  it('正交胞:胞外原子按分数 mod 1 折回胞内(用户:关闭 show-whole 时不能拖出胞外)', () => {
    // +x goes out of bounds 12 → 2; −x goes out of bounds −3 → 7; inside 5 → unchanged.
    closeVec(wrapCartesianIntoCell([12, 0, 0], cubic10), [2, 0, 0])
    closeVec(wrapCartesianIntoCell([-3, 0, 0], cubic10), [7, 0, 0])
    closeVec(wrapCartesianIntoCell([5, 0, 0], cubic10), [5, 0, 0])
  })

  it('正交胞:三轴同时越界各自折回', () => {
    closeVec(wrapCartesianIntoCell([12, -3, 25], cubic10), [2, 7, 5])
  })

  it('胞内原子保持不变(幂等)', () => {
    const inside: Vec3 = [3.3, 7.1, 0.9]
    closeVec(wrapCartesianIntoCell(inside, cubic10), inside)
    // wrap(wrap(p)) == wrap(p)
    const once = wrapCartesianIntoCell([12, -3, 25], cubic10)
    closeVec(wrapCartesianIntoCell(once, cubic10), once)
  })

  it('斜晶格(剪切胞)沿晶格矢量正确折回,而非沿笛卡尔轴', () => {
    // a=[10,0,0], b=[2,10,0] (cut along x), c=[0,0,10].
    const sheared: LatticeVectors = { a: [10, 0, 0], b: [2, 10, 0], c: [0, 0, 10] }
    // Cartesian [16,5,0] = fractional (1.5,0.5,0); wrapping yields Cartesian [6,5,0].
    closeVec(wrapCartesianIntoCell([16, 5, 0], sheared), [6, 5, 0])
  })

  it('退化晶格(体积≈0)原样返回(不塌到原点)', () => {
    const degenerate: LatticeVectors = { a: [0, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
    closeVec(wrapCartesianIntoCell([12, 3, 4], degenerate), [12, 3, 4])
  })
})

describe('clampCartesianToCell', () => {
  it('正交胞:越界 clamp 到盒壁(用户:拖到边缘就停,而非跳到对面)', () => {
    // Clamp +x 12 to 10, -x -3 to 0, and leave the in-cell coordinate 5 unchanged.
    closeVec(clampCartesianToCell([12, 0, 0], cubic10), [10, 0, 0])
    closeVec(clampCartesianToCell([-3, 0, 0], cubic10), [0, 0, 0])
    closeVec(clampCartesianToCell([5, 0, 0], cubic10), [5, 0, 0])
  })

  it('正交胞:三轴各自 clamp,胞内不变', () => {
    closeVec(clampCartesianToCell([12, -3, 25], cubic10), [10, 0, 10])
    const inside: Vec3 = [3.3, 7.1, 0.9]
    closeVec(clampCartesianToCell(inside, cubic10), inside)
  })

  it('clamp 与 wrap 区别:越界点 clamp 到近壁(10),wrap 折回对面(2)', () => {
    closeVec(clampCartesianToCell([12, 0, 0], cubic10), [10, 0, 0])
    closeVec(wrapCartesianIntoCell([12, 0, 0], cubic10), [2, 0, 0])
  })

  it('约束盒=超胞盒时不把超胞折叠进单胞(关键:用可见盒矢量)', () => {
    // 2×2×2 supercell box (a=[20,..]). Inside the supercell x=15(frac 0.75) → keep; outside the supercell x=25 → clamp 20.
    const superBox: LatticeVectors = { a: [20, 0, 0], b: [0, 20, 0], c: [0, 0, 20] }
    closeVec(clampCartesianToCell([15, 5, 0], superBox), [15, 5, 0])
    closeVec(clampCartesianToCell([25, 5, 0], superBox), [20, 5, 0])
  })

  it('退化盒(体积≈0)原样返回', () => {
    const degenerate: LatticeVectors = { a: [0, 0, 0], b: [0, 10, 0], c: [0, 0, 10] }
    closeVec(clampCartesianToCell([12, 3, 4], degenerate), [12, 3, 4])
  })
})
