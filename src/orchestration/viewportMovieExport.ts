/**
 * Renders the presentation timeline to a video file.
 *
 * CameraController already provides the sole time-to-image path by reading
 * presentationFrame and applying camera and style tracks each frame. Export
 * advances that same playhead one frame at a time and captures each result, so
 * encoded frames remain identical to timeline preview frames.
 *
 * Turntable mode uses the same path by installing a temporary planTurntableTrack
 * camera track and restoring the original store state in finally.
 */
import { downloadBlob } from '../lib/molecule/molecule-export'
import type { BioCameraKeyframe } from '../lib/biomolecule/camera-track'
import {
  planTurntableTrack,
  resolveFrameCount,
  type TurntablePose,
} from '../lib/video-export/turntable-track'
import {
  encodeVideo,
  resolveVideoDimensions,
  type VideoContainer,
  type VideoEncodeResult,
  type VideoQuality,
} from '../lib/video-export/encode-video'
import {
  getViewportPose,
  hasRegisteredViewportCapture,
  runViewportFrameSequence,
  type ViewportFrameDrawer,
  type ViewportFrameSequenceOptions,
} from './viewportCaptureRegistry'

/** Movie-related timeline state, snapshotted before recording and restored afterward. */
export interface MovieTimelineSnapshot {
  cameraKeyframes: BioCameraKeyframe[]
  presentationFrames: number
  presentationFrame: number
}

/**
 * Minimal timeline interface required for recording. Keeping orchestration behind
 * this interface allows playhead advancement, capture, and restoration without WebGL.
 */
export interface MovieTimelineController {
  snapshot: () => MovieTimelineSnapshot
  /** Installs a temporary turntable camera track and sets timeline length. */
  applyTrack: (track: BioCameraKeyframe[], frames: number) => void
  setFrame: (frame: number) => void
  pause: () => void
  restore: (snapshot: MovieTimelineSnapshot) => void
}

export type MovieSource =
  /** Camera keyframes already authored on the timeline. */
  | { mode: 'keyframes' }
  /** Orbit track generated from the current camera view. */
  | { mode: 'turntable'; turns: number; durationSeconds: number }

export interface MovieExportRequest {
  registryKey: unknown
  source: MovieSource
  container: VideoContainer
  quality: VideoQuality
  fps: number
  /** Maximum long edge; raises actual session render resolution rather than upscaling. */
  maxDim: number
  /** WebM may contain alpha; MP4 ignores true because it cannot. */
  transparent?: boolean
  onProgress?: (encodedFrames: number, totalFrames: number) => void
  signal?: AbortSignal
}

export interface MovieExportResult {
  fileName: string
  codec: string
  width: number
  height: number
  frameCount: number
  durationSeconds: number
  bytes: number
}

interface MovieExportDependencies {
  isRegistered: (registryKey: unknown) => boolean
  getPose: (registryKey: unknown) => TurntablePose | null
  runFrameSequence: <T>(
    opts: ViewportFrameSequenceOptions,
    run: (drawFrame: ViewportFrameDrawer) => Promise<T>,
    registryKey: unknown,
  ) => Promise<T | null>
  encode: typeof encodeVideo
  download: (fileName: string, blob: Blob) => void
}

const DEFAULT_DEPENDENCIES: MovieExportDependencies = {
  isRegistered: hasRegisteredViewportCapture,
  getPose: (registryKey) => {
    const pose = getViewportPose(registryKey)
    return pose ? { position: pose.position, target: pose.lookAt, zoom: pose.zoom } : null
  },
  runFrameSequence: runViewportFrameSequence,
  encode: encodeVideo,
  download: downloadBlob,
}

/**
 * Selects the recording track and frame count.
 *
 * Keyframe mode preserves the authored timeline length. Turntable mode derives
 * frame count from fps × duration. Both require at least two frames; a single
 * frame belongs in the still-image export path.
 */
export function resolveMoviePlan(
  source: MovieSource,
  fps: number,
  snapshot: MovieTimelineSnapshot,
  pose: TurntablePose | null,
): { track: BioCameraKeyframe[] | null; frames: number } | null {
  if (source.mode === 'keyframes') {
    // Fewer than two keyframes cannot move the camera, so reject a static movie explicitly.
    if (snapshot.cameraKeyframes.length < 2) return null
    return { track: null, frames: snapshot.presentationFrames }
  }
  if (!pose) return null
  const planned = planTurntableTrack(pose, {
    turns: source.turns,
    frames: resolveFrameCount(fps, source.durationSeconds),
  })
  return planned ? { track: planned.track, frames: planned.frames } : null
}

/**
 * Adapts a viewport store to MovieTimelineController.
 *
 * Concentrates store coupling here so recording orchestration depends only on
 * the four interface operations and can run without WebGL.
 */
export function movieTimelineFromStore(store: {
  getState: () => {
    cameraKeyframes: BioCameraKeyframe[]
    presentationFrames: number
    presentationFrame: number
    setPresentationFrame: (frame: number) => void
    setPresentationFrames: (frames: number) => void
    setCameraKeyframes: (keyframes: BioCameraKeyframe[]) => void
    pausePresentation: () => void
  }
}): MovieTimelineController {
  return {
    snapshot: () => {
      const state = store.getState()
      return {
        cameraKeyframes: state.cameraKeyframes,
        presentationFrames: state.presentationFrames,
        presentationFrame: state.presentationFrame,
      }
    },
    applyTrack: (track, frames) => {
      const state = store.getState()
      // Set length before the track because setPresentationFrame clamps against presentationFrames.
      state.setPresentationFrames(frames)
      state.setCameraKeyframes(track)
    },
    setFrame: (frame) => store.getState().setPresentationFrame(frame),
    pause: () => store.getState().pausePresentation(),
    restore: (snapshot) => {
      const state = store.getState()
      state.setPresentationFrames(snapshot.presentationFrames)
      state.setCameraKeyframes(snapshot.cameraKeyframes)
      state.setPresentationFrame(snapshot.presentationFrame)
    },
  }
}

export async function exportViewportMovie(
  request: MovieExportRequest,
  timeline: MovieTimelineController,
  dependencyOverrides: Partial<MovieExportDependencies> = {},
): Promise<MovieExportResult> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  if (!dependencies.isRegistered(request.registryKey)) {
    throw new Error('The active viewport is not ready. Wait for it to render and try again.')
  }

  const snapshot = timeline.snapshot()
  const plan = resolveMoviePlan(
    request.source,
    request.fps,
    snapshot,
    request.source.mode === 'turntable' ? dependencies.getPose(request.registryKey) : null,
  )
  if (!plan) {
    throw new Error(
      request.source.mode === 'keyframes'
        ? 'Record at least two camera keyframes on the timeline before exporting a movie.'
        : 'The viewport camera is not ready for a turntable. Orbit the structure and try again.',
    )
  }

  // Stop playback so it cannot race export while both advance the playhead.
  timeline.pause()
  try {
    if (plan.track) timeline.applyTrack(plan.track, plan.frames)
    const encoded = await dependencies.runFrameSequence(
      {
        maxDim: request.maxDim,
        // MP4 AVC/AV1 has no alpha channel; transparency would encode as black.
        transparent: request.container === 'webm' && request.transparent === true,
      },
      async (drawFrame) => {
        // Render once to learn the actual session canvas size after GPU resolution caps.
        const probe = await drawFrame()
        if (!probe) throw new Error('The viewport did not render a frame.')
        const source = probe as HTMLCanvasElement
        const dimensions = resolveVideoDimensions(source.width, source.height)
        if (!dimensions) throw new Error('The viewport has no renderable size.')
        return dependencies.encode({
          container: request.container,
          quality: request.quality,
          width: dimensions.width,
          height: dimensions.height,
          fps: request.fps,
          frameCount: plan.frames,
          onProgress: request.onProgress,
          signal: request.signal,
          drawFrame: async (index, context) => {
            timeline.setFrame(index)
            const frame = await drawFrame()
            if (!frame) return false
            // Scale one- or two-pixel parity differences to fixed even encoder dimensions;
            // many players reject a stream whose frame dimensions change mid-track.
            context.drawImage(frame, 0, 0, dimensions.width, dimensions.height)
            return true
          },
        })
      },
      request.registryKey,
    )
    if (!encoded) {
      throw new Error('The active viewport is not ready. Wait for it to render and try again.')
    }
    return finishMovie(encoded, dependencies.download)
  } finally {
    // Always restore camera tracks and playhead after cancellation, encoding failure,
    // or an unsupported codec.
    timeline.restore(snapshot)
  }
}

function finishMovie(
  encoded: VideoEncodeResult,
  download: (fileName: string, blob: Blob) => void,
): MovieExportResult {
  download(encoded.suggestedFileName, encoded.blob)
  return {
    fileName: encoded.suggestedFileName,
    codec: encoded.codec,
    width: encoded.width,
    height: encoded.height,
    frameCount: encoded.frameCount,
    durationSeconds: encoded.durationSeconds,
    bytes: encoded.blob.size,
  }
}
