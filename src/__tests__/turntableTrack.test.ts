/**
 * Verify that a turntable is represented as a normal camera track.
 *
 * Evaluating planTurntableTrack through evaluateBioCameraTrack must produce a constant-radius,
 * horizontal orbit around the target, proving export uses the shared animation path.
 */
import { describe, expect, it } from 'vitest'
import { evaluateBioCameraTrack } from '../lib/biomolecule/camera-track'
import { planTurntableTrack, resolveFrameCount } from '../lib/video-export/turntable-track'

/** Radius-ten pose looking at the origin from 45 degrees above. */
const POSE = {
  position: [0, 7.0710678, 7.0710678] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
}

describe('planTurntableTrack', () => {
  it('整圈切成每段 ≤90° —— 方位角插值只走短边,大跨度会掉头', () => {
    const planned = planTurntableTrack(POSE, { turns: 1, frames: 120 })!
    // Four segments of at most 90 degrees require five keyframes.
    expect(planned.track).toHaveLength(5)
    expect(planned.track[0].frame).toBe(0)
    // The final keyframe is frames-1 so the last frame completes the turn.
    expect(planned.track.at(-1)!.frame).toBe(119)
  })

  it('求值后是等半径的水平环绕,俯仰保持用户视角', () => {
    const planned = planTurntableTrack(POSE, { turns: 1, frames: 120 })!
    const radiusOf = (p: readonly number[]) => Math.hypot(p[0], p[1], p[2])
    const startRadius = radiusOf(POSE.position)

    const heights: number[] = []
    for (let frame = 0; frame < 120; frame += 10) {
      const pose = evaluateBioCameraTrack(planned.track, frame)!
      // Radius stays constant; Cartesian interpolation would collapse it between keys.
      expect(radiusOf(pose.position)).toBeCloseTo(startRadius, 4)
      // The camera always looks at the target.
      expect(pose.target[0]).toBeCloseTo(0, 6)
      heights.push(pose.position[1])
    }
    // Y-axis orbit preserves height and avoids flipping the structure.
    for (const height of heights) {
      expect(height).toBeCloseTo(POSE.position[1], 4)
    }
  })

  it('走满整圈:中点在起点对面,终点回到起点', () => {
    const planned = planTurntableTrack(POSE, { turns: 1, frames: 121 })!
    const start = evaluateBioCameraTrack(planned.track, 0)!
    const half = evaluateBioCameraTrack(planned.track, 60)!
    const end = evaluateBioCameraTrack(planned.track, 120)!
    expect(half.position[2]).toBeCloseTo(-start.position[2], 3)
    expect(end.position[2]).toBeCloseTo(start.position[2], 3)
  })

  it('turns 为负时反向旋转', () => {
    const forward = planTurntableTrack(POSE, { turns: 1, frames: 120 })!
    const backward = planTurntableTrack(POSE, { turns: -1, frames: 120 })!
    const f = evaluateBioCameraTrack(forward.track, 30)!
    const b = evaluateBioCameraTrack(backward.track, 30)!
    // Opposite directions reach symmetric sides at the same time.
    expect(b.position[0]).toBeCloseTo(-f.position[0], 3)
  })

  it('相机落在 target 上时拒绝出片 —— 没有可绕的半径', () => {
    expect(planTurntableTrack({ position: [1, 1, 1], target: [1, 1, 1] }, { turns: 1, frames: 60 }))
      .toBeNull()
  })

  it('拒绝退化输入:单帧、零圈、非有限值', () => {
    expect(planTurntableTrack(POSE, { turns: 1, frames: 1 })).toBeNull()
    expect(planTurntableTrack(POSE, { turns: 0, frames: 60 })).toBeNull()
    expect(planTurntableTrack(POSE, { turns: Number.NaN, frames: 60 })).toBeNull()
    expect(planTurntableTrack({ position: [0, 0, Number.NaN], target: [0, 0, 0] }, { turns: 1, frames: 60 }))
      .toBeNull()
  })

  it('正交相机的 zoom 透传,透视相机不凭空造出 zoom', () => {
    const withZoom = planTurntableTrack({ ...POSE, zoom: 2.5 }, { turns: 1, frames: 60 })!
    expect(withZoom.track[0].zoom).toBe(2.5)
    const withoutZoom = planTurntableTrack(POSE, { turns: 1, frames: 60 })!
    expect(withoutZoom.track[0].zoom).toBeUndefined()
  })
})

describe('resolveFrameCount', () => {
  it('fps × 秒 精确到帧', () => {
    expect(resolveFrameCount(24, 5)).toBe(120)
    expect(resolveFrameCount(30, 2.5)).toBe(75)
  })

  it('至少两帧,非有限输入归零', () => {
    expect(resolveFrameCount(24, 0)).toBe(2)
    expect(resolveFrameCount(Number.NaN, 5)).toBe(0)
  })
})
