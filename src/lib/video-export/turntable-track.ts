/**
 * Express a turntable as the canonical camera-keyframe track. Quarter-turn
 * segments stay below shortest-angle ambiguity while linear spherical azimuth
 * interpolation produces uniform rotation.
 */
import type { BioCameraKeyframe } from '../biomolecule/camera-track'

export interface TurntablePose {
  position: readonly [number, number, number]
  target: readonly [number, number, number]
  /**
  * The magnification of orthographic cameras; perspective cameras do not have this option.
  */
  zoom?: number
}

export interface TurntableSpec {
  /**
  * Number of laps. Decimal numbers are allowed (0.5 turns = half a round trip); negative numbers indicate reverse rotation.
  */
  turns: number
  /**
  * The total number of frames in the film is determined by fps × duration.
  */
  frames: number
}

/**
 * The maximum azimuth angle covered by each keyframe. See file header: must be strictly less than 180°.
 */
const MAX_SEGMENT_RADIANS = Math.PI / 2

export interface TurntableTrackResult {
  track: BioCameraKeyframe[]
  /**
  * Timeline length, fed to setPresentationFrames.
  */
  frames: number
}

/** Rotate around world Y while preserving target, radius, pitch, and zoom. */
export function planTurntableTrack(
  pose: TurntablePose,
  spec: TurntableSpec,
): TurntableTrackResult | null {
  const frames = Math.round(spec.frames)
  if (!Number.isFinite(frames) || frames < 2) return null
  if (!Number.isFinite(spec.turns) || spec.turns === 0) return null

  const [px, py, pz] = pose.position
  const [tx, ty, tz] = pose.target
  if (![px, py, pz, tx, ty, tz].every(Number.isFinite)) return null

  const dx = px - tx
  const dy = py - ty
  const dz = pz - tz
  const radius = Math.hypot(dx, dy, dz)
  // A camera at its target has no valid orbit radius.
  if (!(radius > 1e-6)) return null

  const startAzimuth = Math.atan2(dx, dz)
  const polar = Math.acos(Math.max(-1, Math.min(1, dy / radius)))
  const sweep = spec.turns * Math.PI * 2
  const segments = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_SEGMENT_RADIANS))

  const track: BioCameraKeyframe[] = []
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments
    const azimuth = startAzimuth + sweep * progress
    // The final key belongs at `frames - 1`, the last legal playhead value.
    const frame = Math.round(progress * (frames - 1))
    track.push({
      id: `turntable-${index}`,
      frame,
      position: [
        tx + radius * Math.sin(polar) * Math.sin(azimuth),
        ty + radius * Math.cos(polar),
        tz + radius * Math.sin(polar) * Math.cos(azimuth),
      ],
      target: [tx, ty, tz],
      ...(pose.zoom !== undefined && Number.isFinite(pose.zoom) && pose.zoom > 0
        ? { zoom: pose.zoom }
        : {}),
      easing: 'linear',
    })
  }
  return { track, frames }
}

/** Convert duration to an integer frame count without floating-point off-by-one. */
export function resolveFrameCount(fps: number, durationSeconds: number): number {
  if (!Number.isFinite(fps) || !Number.isFinite(durationSeconds)) return 0
  return Math.max(2, Math.round(fps * durationSeconds))
}
