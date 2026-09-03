import { describe, expect, it } from 'vitest'

import { buildMoire } from '../moire'

describe('commensurate Moiré construction', () => {
  it('fills both layers completely for a small-angle large cell', () => {
    // Regression: the old symmetric integer search range emitted 4553 atoms;
    // fixing only that range but not the rotation sign emitted 5549.
    const result = buildMoire({ twist_angle_deg: 1.05, maxAtoms: 6000 })
    expect([result.m, result.n]).toEqual([22, 21])
    expect(result.expectedAtomCount).toBe(5548)
    expect(result.n_atoms).toBe(5548)
    expect(result.layerAtomCounts).toEqual([2774, 2774])
    expect(result.periodicSeamResidualA).toBeLessThan(1e-10)
  })

  it('keeps binary-honeycomb orientation in the full 0–60 degree window', () => {
    const zero = buildMoire({ twist_angle_deg: 0, elements: ['B', 'N'], maxAtoms: 20 })
    const sixty = buildMoire({ twist_angle_deg: 60, elements: ['B', 'N'], maxAtoms: 20 })
    expect(zero.realizedTwistDeg).toBe(0)
    expect([zero.m, zero.n]).toEqual([1, 1])
    expect(zero.n_atoms).toBe(12)
    expect(sixty.realizedTwistDeg).toBeCloseTo(60, 12)
    expect([sixty.m, sixty.n]).toEqual([1, 0])
    expect(sixty.n_atoms).toBe(4)
  })

  it('honours an exact reduced pair and exposes its snap error', () => {
    const result = buildMoire({
      twist_angle_deg: 20,
      commensurate: { m: 2, n: 1 },
      maxAtoms: 28,
    })
    expect(result.realizedTwistDeg).toBeCloseTo(21.7867892983, 9)
    expect(result.twistErrorDeg).toBeCloseTo(1.7867892983, 9)
    expect(result.cellAngleDeg).toBeCloseTo(60, 12)
    expect(result.layerIndices.filter((layer) => layer === 0)).toHaveLength(14)
    expect(result.layerIndices.filter((layer) => layer === 1)).toHaveLength(14)
  })

  it('rejects non-reduced or over-budget exact pairs', () => {
    expect(() => buildMoire({
      twist_angle_deg: 10,
      commensurate: { m: 4, n: 2 },
      maxAtoms: 100,
    })).toThrow(/reduced integer pair/)
    expect(() => buildMoire({
      twist_angle_deg: 10,
      commensurate: { m: 3, n: 2 },
      maxAtoms: 20,
    })).toThrow(/above maxAtoms/)
  })
})
