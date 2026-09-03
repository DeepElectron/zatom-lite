import { describe, expect, it } from 'vitest'
import { buildSnapLines, pointsOnLine } from '../lib/geometry-snap'

const atoms = [
  { id: 'left', position: [0, 0, 0] as [number, number, number] },
  { id: 'right', position: [4, 2, 0] as [number, number, number] },
  { id: 'other', position: [9, 9, 9] as [number, number, number] },
]

/** Selecting exactly two atoms produces the single line used for point generation. */
function selectedLinePoints() {
  const lines = buildSnapLines(atoms, [], null, new Set(['left', 'right']))
  expect(lines).toHaveLength(1)
  return pointsOnLine(lines[0])
}

/**
 * Locate snap points by kind and parameter t rather than label.
 *
 * Labels are unused metadata; geometry-snap-pick and snap-feature-overlay consume only kind and
 * position. Testing semantic parameters protects geometry without coupling to copy.
 */
function pointAt(points: ReturnType<typeof pointsOnLine>, kind: string, t: number) {
  const found = points.find((p) => p.kind === kind && Math.abs(p.t - t) < 1e-9)
  expect(found, `未找到 kind=${kind} t=${t} 的吸附点`).toBeDefined()
  return found!
}

function expectPos(pos: readonly number[], expected: readonly number[]) {
  expect(pos).toHaveLength(3)
  for (let i = 0; i < 3; i++) expect(pos[i]).toBeCloseTo(expected[i], 10)
}

describe('几何捕捉：选中线上的吸附点', () => {
  it('中点是精确的笛卡尔中点', () => {
    expectPos(pointAt(selectedLinePoints(), 'midpoint', 0.5).pos, [2, 1, 0])
  })

  it('等分点保持选中线的几何比例', () => {
    const points = selectedLinePoints()
    expectPos(pointAt(points, 'third', 1 / 3).pos, [4 / 3, 2 / 3, 0])
    expectPos(pointAt(points, 'third', 2 / 3).pos, [8 / 3, 4 / 3, 0])
    expectPos(pointAt(points, 'quarter', 0.25).pos, [1, 0.5, 0])
  })

  it('延长点沿选中线延伸到端点之外，两侧都有', () => {
    const points = selectedLinePoints()
    // t=2 extends one segment beyond p2.
    expectPos(pointAt(points, 'extension', 2).pos, [8, 4, 0])
    // t=-1 extends backward beyond p1.
    expectPos(pointAt(points, 'extension', -1).pos, [-4, -2, 0])
  })

  it('线段内点标记 withinSegment，延长点不标记', () => {
    const points = selectedLinePoints()
    for (const p of points) {
      expect(p.withinSegment).toBe(p.t > 0 && p.t < 1)
    }
  })
})
