import { describe, expect, it } from 'vitest'

import { CUB_MAX_VOXELS, CubParser } from '../CubParser'

function cube(dimensions = [2, 2, 2], values = '0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8'): string {
  return [
    'CUBE fixture',
    'parser limits',
    '1 0 0 0',
    `${dimensions[0]} 1 0 0`,
    `${dimensions[1]} 0 1 0`,
    `${dimensions[2]} 0 0 1`,
    '1 0 0 0 0',
    values,
  ].join('\n')
}

describe('CubParser allocation and completeness gates', () => {
  it('parses an exact finite grid', () => {
    const parsed = new CubParser().parse(cube())
    expect(parsed.volumeData).toHaveLength(8)
    expect(parsed.volumeData[0]).toBeCloseTo(0.1)
    expect(parsed.volumeData[7]).toBeCloseTo(0.8)
  })

  it('rejects a truncated grid instead of silently zero-filling it', () => {
    expect(() => new CubParser().parse(cube([2, 2, 2], '0.1 0.2 0.3'))).toThrow(/truncated.*expected 8.*read 3/i)
  })

  it('rejects an oversized declared grid before allocating it', () => {
    const side = Math.ceil(Math.cbrt(CUB_MAX_VOXELS + 1))
    expect(() => new CubParser().parse(cube([side, side, side], ''))).toThrow(/supported limit/i)
  })

  it('uses grid-axis signs for units instead of overloading the atom-count sign', () => {
    const angstrom = cube().replace('1 0 0 0\n2 1 0 0\n2 0 1 0\n2 0 0 1', '1 1 0 0\n-2 1 0 0\n-2 0 1 0\n-2 0 0 1')
    const parsed = new CubParser().parse(angstrom)
    expect(parsed.origin.x).toBe(1)
    expect(parsed.vectors.x.x).toBe(1)

    const bohr = new CubParser().parse(cube())
    expect(bohr.vectors.x.x).toBeCloseTo(0.529177210903)
  })

  it('requires and consumes the dataset-ID record signaled by negative NATOMS', () => {
    const withDataset = cube().replace('1 0 0 0', '-1 0 0 0').replace(
      '1 0 0 0 0\n0.1',
      '1 0 0 0 0\n1 7\n0.1',
    )
    expect(new CubParser().parse(withDataset).volumeData).toHaveLength(8)
    expect(() => new CubParser().parse(cube().replace('1 0 0 0', '-1 0 0 0'))).toThrow(/dataset-ID/i)
  })
})
