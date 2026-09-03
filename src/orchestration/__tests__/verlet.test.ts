import { describe, it, expect, beforeEach } from 'vitest'
import { stepVerlet, resetPhysicsState } from '../../lib/physics/verlet'
import type { Atom, Bond } from '../../lib/crystal/types'

/**
 * Velocity Verlet starts with zero force, so the **first step only accumulates
 * velocity and produces no displacement**. Displacement begins on the second
 * step. PhysicsStepper calls stepVerlet every frame, so this one-frame warm-up is
 * expected behavior rather than a defect.
 *
 * Displacement assertions therefore run at least two steps. They protect physical
 * properties such as direction, conservation, cutoff, and finiteness rather than
 * exact coordinates, which are brittle under integrator tuning and do not prove correctness.
 */

function makeAtom(id: string, x: number, element = 'Cu'): Atom {
  return {
    id,
    element,
    position: [x, 0, 0] as [number, number, number],
    cartesian: [x, 0, 0] as [number, number, number],
  } as Atom
}

function simulate(atoms: Atom[], bonds: Bond[], steps: number): Atom[] {
  let cur = atoms
  for (let i = 0; i < steps; i++) cur = stepVerlet(cur, bonds, 0.016, 100)
  return cur
}

const px = (a: Atom) => a.cartesian![0]
const separation = (a: Atom[]) => Math.abs(px(a[1]) - px(a[0]))

describe('stepVerlet', () => {
  beforeEach(() => {
    resetPhysicsState()
  })

  it('第一步只积累速度，不产生位移', () => {
    const out = stepVerlet([makeAtom('a', 0), makeAtom('b', 0.5)], [], 0.016, 100)
    expect(out).toHaveLength(2)
    expect(px(out[0])).toBe(0)
    expect(px(out[1])).toBe(0.5)
  })

  it('LJ 排斥：过近的原子被推开，且质心守恒', () => {
    const out = simulate([makeAtom('a', 0), makeAtom('b', 0.5)], [], 5)
    expect(px(out[0])).toBeLessThan(0)
    expect(px(out[1])).toBeGreaterThan(0.5)
    // Equal masses with no external force require symmetric repulsion and a center of mass at 0.25.
    expect((px(out[0]) + px(out[1])) / 2).toBeCloseTo(0.25, 6)
  })

  it('LJ 截断：超出 cutoff 的原子完全不受力', () => {
    const out = simulate([makeAtom('f1', 0), makeAtom('f2', 10)], [], 10)
    expect(px(out[0])).toBe(0)
    expect(px(out[1])).toBe(10)
  })

  it('谐振键：被拉长的键把两原子拉回', () => {
    const bond: Bond = { id: 'b1', atom1Id: 'h1', atom2Id: 'h2', type: 'single' }
    const out = simulate([makeAtom('h1', 0), makeAtom('h2', 3)], [bond], 5)
    expect(px(out[0])).toBeGreaterThan(0)
    expect(px(out[1])).toBeLessThan(3)
    expect(separation(out)).toBeLessThan(3)
  })

  it('质量：同一斥力下轻原子位移远大于重原子', () => {
    const out = simulate([makeAtom('heavy', 0, 'Au'), makeAtom('light', 0.8, 'H')], [], 5)
    const heavyDisp = Math.abs(px(out[0]))
    const lightDisp = Math.abs(px(out[1]) - 0.8)
    expect(lightDisp).toBeGreaterThan(heavyDisp)
  })

  it('数值稳定性：完全重叠的原子不产生 NaN', () => {
    const out = simulate([makeAtom('o1', 0), makeAtom('o2', 0)], [], 3)
    for (const atom of out) {
      for (const v of atom.cartesian!) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('长程积分保持有限，不发散', () => {
    const out = simulate([makeAtom('d1', 0), makeAtom('d2', 1)], [], 60)
    for (const atom of out) expect(Number.isFinite(px(atom))).toBe(true)
  })

  it('空输入不崩溃', () => {
    expect(stepVerlet([], [], 0.016, 100)).toHaveLength(0)
  })

  it('resetPhysicsState 清掉速度，使同一初态可复现', () => {
    const first = simulate([makeAtom('a', 0), makeAtom('b', 0.5)], [], 4)
    resetPhysicsState()
    const second = simulate([makeAtom('a', 0), makeAtom('b', 0.5)], [], 4)
    expect(px(second[0])).toBeCloseTo(px(first[0]), 12)
    expect(px(second[1])).toBeCloseTo(px(first[1]), 12)
  })
})
