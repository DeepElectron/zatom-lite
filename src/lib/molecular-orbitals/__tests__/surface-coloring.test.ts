import { describe, expect, it } from 'vitest'
import { colorSurfaceByField, sampleColormap, symmetricRange } from '../surface-coloring'

describe('sampleColormap', () => {
  it('bgr puts blue, green, red at the ends and midpoint', () => {
    expect(sampleColormap('bgr', 0)).toEqual([0, 0, 1])
    expect(sampleColormap('bgr', 0.5)).toEqual([0, 1, 0])
    expect(sampleColormap('bgr', 1)).toEqual([1, 0, 0])
  })

  it('rwb is white at the midpoint and clamps outside [0, 1]', () => {
    expect(sampleColormap('rwb', 0.5)).toEqual([1, 1, 1])
    expect(sampleColormap('rwb', -3)).toEqual([1, 0, 0])
    expect(sampleColormap('rwb', 7)).toEqual([0, 0, 1])
  })
})

describe('colorSurfaceByField', () => {
  // Field is x itself, so vertex colour is a direct function of position.
  const field = (x: number) => x
  const vertices = new Float32Array([-1, 0, 0, 0, 0, 0, 1, 0, 0])

  it('maps sign to the colormap ends with zero at the midpoint', () => {
    const { colors, sampled } = colorSurfaceByField(vertices, field, 'bgr', { min: -1, max: 1 })
    expect(Array.from(colors.subarray(0, 3))).toEqual([0, 0, 1])
    expect(Array.from(colors.subarray(3, 6))).toEqual([0, 1, 0])
    expect(Array.from(colors.subarray(6, 9))).toEqual([1, 0, 0])
    expect(sampled).toEqual({ min: -1, max: 1 })
  })

  it('reports the true sampled extremes even when the range clamps them', () => {
    const { colors, sampled } = colorSurfaceByField(vertices, field, 'bgr', { min: -0.1, max: 0.1 })
    expect(sampled).toEqual({ min: -1, max: 1 })
    // Clamped, so the ends are still pure blue / red rather than overshooting.
    expect(Array.from(colors.subarray(0, 3))).toEqual([0, 0, 1])
    expect(Array.from(colors.subarray(6, 9))).toEqual([1, 0, 0])
  })

  it('handles an empty surface without NaN', () => {
    const { colors, sampled } = colorSurfaceByField(new Float32Array(0), field, 'bgr', { min: -1, max: 1 })
    expect(colors.length).toBe(0)
    expect(sampled).toEqual({ min: 0, max: 0 })
  })
})

describe('symmetricRange', () => {
  it('centres zero on the larger absolute extreme', () => {
    expect(symmetricRange({ min: -0.02, max: 0.05 })).toEqual({ min: -0.05, max: 0.05 })
    expect(symmetricRange({ min: -0.5, max: 0.1 })).toEqual({ min: -0.5, max: 0.5 })
  })

  it('falls back to a unit range for a flat field', () => {
    expect(symmetricRange({ min: 0, max: 0 })).toEqual({ min: -1, max: 1 })
  })
})
