import type { BioStyleEasing } from './types'

export type CameraVector3 = readonly [number, number, number]

export interface BioCameraKeyframe {
  id: string
  frame: number
  position: CameraVector3
  target: CameraVector3
  /** Orthographic magnification. Omitted for perspective camera keys. */
  zoom?: number
  /** Easing used while leaving this keyframe. */
  easing: BioStyleEasing
}

export interface BioCameraPose {
  position: [number, number, number]
  target: [number, number, number]
  /** Orthographic magnification. Absent for perspective poses. */
  zoom?: number
}

const lerp = (left: number, right: number, amount: number) => left + (right - left) * amount

function eased(amount: number, easing: BioStyleEasing): number {
  if (easing === 'hold') return 0
  if (easing === 'smooth') return amount * amount * (3 - 2 * amount)
  return amount
}

function spherical(position: CameraVector3, target: CameraVector3) {
  const x = position[0] - target[0]
  const y = position[1] - target[1]
  const z = position[2] - target[2]
  const radius = Math.max(Math.hypot(x, y, z), 1e-6)
  return {
    radius,
    azimuth: Math.atan2(x, z),
    polar: Math.acos(Math.max(-1, Math.min(1, y / radius))),
  }
}

function shortestAngle(left: number, right: number, amount: number): number {
  let delta = right - left
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return left + delta * amount
}

export function evaluateBioCameraTrack(
  track: readonly BioCameraKeyframe[] | undefined,
  frame: number,
): BioCameraPose | null {
  if (!track?.length || !Number.isFinite(frame)) return null
  const keys = [...track].sort((left, right) => left.frame - right.frame)
  const pose = (keyframe: BioCameraKeyframe): BioCameraPose => ({
    position: [...keyframe.position],
    target: [...keyframe.target],
    ...(keyframe.zoom === undefined ? {} : { zoom: keyframe.zoom }),
  })
  if (frame <= keys[0].frame) return pose(keys[0])
  const last = keys[keys.length - 1]
  if (frame >= last.frame) return pose(last)

  let source = keys[0]
  let destination = keys[1]
  for (let index = 0; index < keys.length - 1; index += 1) {
    if (frame >= keys[index].frame && frame < keys[index + 1].frame) {
      source = keys[index]
      destination = keys[index + 1]
      break
    }
  }
  const span = Math.max(destination.frame - source.frame, 1e-6)
  const amount = eased((frame - source.frame) / span, source.easing)
  const target: [number, number, number] = [
    lerp(source.target[0], destination.target[0], amount),
    lerp(source.target[1], destination.target[1], amount),
    lerp(source.target[2], destination.target[2], amount),
  ]
  const left = spherical(source.position, source.target)
  const right = spherical(destination.position, destination.target)
  const radius = lerp(left.radius, right.radius, amount)
  const azimuth = shortestAngle(left.azimuth, right.azimuth, amount)
  const polar = lerp(left.polar, right.polar, amount)
  const zoom = source.zoom !== undefined && destination.zoom !== undefined
    && Number.isFinite(source.zoom) && source.zoom > 0
    && Number.isFinite(destination.zoom) && destination.zoom > 0
    ? source.zoom * Math.pow(destination.zoom / source.zoom, amount)
    : undefined
  return {
    target,
    position: [
      target[0] + radius * Math.sin(polar) * Math.sin(azimuth),
      target[1] + radius * Math.cos(polar),
      target[2] + radius * Math.sin(polar) * Math.cos(azimuth),
    ],
    ...(zoom === undefined ? {} : { zoom }),
  }
}

export function upsertBioCameraKeyframe(
  track: readonly BioCameraKeyframe[] | undefined,
  keyframe: Omit<BioCameraKeyframe, 'id'>,
  makeId: () => string,
): BioCameraKeyframe[] {
  return [
    ...(track ?? []).filter((candidate) => candidate.frame !== keyframe.frame),
    { ...keyframe, id: makeId() },
  ].sort((left, right) => left.frame - right.frame)
}

export function removeBioCameraKeyframe(
  track: readonly BioCameraKeyframe[] | undefined,
  frame: number,
): BioCameraKeyframe[] {
  return (track ?? []).filter((keyframe) => keyframe.frame !== frame)
}
