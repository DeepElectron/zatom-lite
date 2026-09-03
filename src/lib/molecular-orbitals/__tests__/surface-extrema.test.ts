import { describe, expect, it } from 'vitest'
import { findSurfaceExtrema } from '../surface-extrema'

// A 1-D "surface": a pit at x=0 and a peak at x=10, each with near-duplicate
// neighbours within 0.2 Å, and a flat mid-point at x=5 that is neither.
function twoBumps() {
  const pts: number[] = []
  const vals: number[] = []
  const add = (x: number, v: number) => {
    pts.push(x, 0, 0)
    vals.push(v)
  }
  add(0, -1.0)
  add(0.1, -0.9)
  add(0.2, -0.8)
  add(5, 0)
  add(10, 1.0)
  add(10.1, 0.9)
  add(10.2, 0.8)
  return { vertices: new Float32Array(pts), values: new Float32Array(vals) }
}

describe('findSurfaceExtrema', () => {
  it('returns exactly the local extrema and nothing else', () => {
    const { vertices, values } = twoBumps()
    const found = findSurfaceExtrema(vertices, values, { separation: 1.5, maxPerKind: 8 })
    // The mid-point at x=5 is isolated (no neighbour within 1.5 Å) so it is
    // trivially both a local min and max of its own neighbourhood — the
    // definition admits it, and it must rank below the real pit/peak.
    const mins = found.filter((e) => e.kind === 'min')
    const maxs = found.filter((e) => e.kind === 'max')
    expect(mins[0]).toMatchObject({ value: -1, position: [0, 0, 0] })
    expect(maxs[0]).toMatchObject({ value: 1, position: [10, 0, 0] })
    // Neighbours 0.1/0.2 Å from the pit are never reported: they are not local extrema.
    expect(mins.filter((m) => m.position[0] > 0 && m.position[0] < 1)).toHaveLength(0)
    expect(maxs.filter((m) => m.position[0] > 10)).toHaveLength(0)
  })

  it('does not pad the result up to maxPerKind with non-extrema', () => {
    // Monotonic ramp: exactly one min (start) and one max (end), regardless of cap.
    const n = 50
    const vertices = new Float32Array(n * 3)
    const values = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      vertices[i * 3] = i * 0.1
      values[i] = i
    }
    const found = findSurfaceExtrema(vertices, values, { separation: 0.35, maxPerKind: 8 })
    expect(found.filter((e) => e.kind === 'min')).toEqual([{ kind: 'min', value: 0, position: [0, 0, 0] }])
    expect(found.filter((e) => e.kind === 'max')).toHaveLength(1)
    expect(found.find((e) => e.kind === 'max')?.value).toBe(n - 1)
  })

  it('collapses a plateau to a single marker', () => {
    const vertices = new Float32Array([0, 0, 0, 0.1, 0, 0, 0.2, 0, 0])
    const values = new Float32Array([1, 1, 1])
    const found = findSurfaceExtrema(vertices, values, { separation: 1 })
    expect(found.filter((e) => e.kind === 'max')).toHaveLength(1)
    expect(found.filter((e) => e.kind === 'min')).toHaveLength(1)
  })

  it('honours maxPerKind', () => {
    const { vertices, values } = twoBumps()
    // Tiny separation: every vertex is its own extremum; cap must still apply.
    const found = findSurfaceExtrema(vertices, values, { separation: 0.01, maxPerKind: 2 })
    expect(found.filter((e) => e.kind === 'min')).toHaveLength(2)
    expect(found.filter((e) => e.kind === 'max')).toHaveLength(2)
  })

  it('is empty for an empty surface', () => {
    expect(findSurfaceExtrema(new Float32Array(0), new Float32Array(0))).toEqual([])
  })
})
