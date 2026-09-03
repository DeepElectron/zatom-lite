/**
 * Encode rendered frames with WebCodecs and mux them into MP4 or WebM through
 * mediabunny. Callers own timeline evaluation and provide a frame-draw callback.
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
  type Quality,
  type VideoCodec,
} from 'mediabunny'
import { figureTimestamp } from '../figure-export/export-figure'

export type VideoContainer = 'mp4' | 'webm'
export type VideoQuality = 'low' | 'medium' | 'high'

const QUALITY_LEVELS: Record<VideoQuality, Quality> = {
  low: QUALITY_LOW,
  medium: QUALITY_MEDIUM,
  high: QUALITY_HIGH,
}

/** Codec preference prioritizes broad compatibility before compression efficiency. */
const CODEC_PREFERENCE: Record<VideoContainer, VideoCodec[]> = {
  mp4: ['avc', 'vp9', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
}

/** Round dimensions down to even values required by common 4:2:0 encoders. */
export function resolveVideoDimensions(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (!(width > 0) || !(height > 0)) return null
  const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2)
  return { width: even(width), height: even(height) }
}

export interface VideoEncodeRequest {
  container: VideoContainer
  quality: VideoQuality
  width: number
  height: number
  fps: number
  frameCount: number
  /** Draw one frame; false aborts instead of silently shortening the timeline. */
  drawFrame: (index: number, context: CanvasRenderingContext2D) => Promise<boolean>
  onProgress?: (encodedFrames: number, totalFrames: number) => void
  signal?: AbortSignal
}

export interface VideoEncodeResult {
  blob: Blob
  suggestedFileName: string
  codec: VideoCodec
  width: number
  height: number
  frameCount: number
  durationSeconds: number
}

export class VideoEncodeUnsupportedError extends Error {
  constructor(container: VideoContainer) {
    super(
      `This browser cannot encode any ${container.toUpperCase()} video codec via WebCodecs.`,
    )
    this.name = 'VideoEncodeUnsupportedError'
  }
}

/** Choose the first codec supported by both the container and this browser/config. */
export async function pickVideoCodec(
  container: VideoContainer,
  width: number,
  height: number,
  quality: VideoQuality,
): Promise<VideoCodec | null> {
  const format = container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat()
  const supported = new Set(format.getSupportedVideoCodecs())
  const candidates = CODEC_PREFERENCE[container].filter((codec) => supported.has(codec))
  return getFirstEncodableVideoCodec(candidates, {
    width,
    height,
    quality: QUALITY_LEVELS[quality],
  })
}

export async function encodeVideo(request: VideoEncodeRequest): Promise<VideoEncodeResult> {
  const dimensions = resolveVideoDimensions(request.width, request.height)
  if (!dimensions) throw new Error('Invalid video dimensions.')
  const fps = Math.max(1, Math.round(request.fps))
  const frameCount = Math.max(1, Math.round(request.frameCount))

  const codec = await pickVideoCodec(
    request.container,
    dimensions.width,
    dimensions.height,
    request.quality,
  )
  if (!codec) throw new VideoEncodeUnsupportedError(request.container)

  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create a 2D context for video encoding.')

  const output = new Output({
    format: request.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new CanvasSource(canvas, {
    codec,
    quality: QUALITY_LEVELS[request.quality],
  })
  output.addVideoTrack(source, { frameRate: fps })

  const frameDuration = 1 / fps
  try {
    await output.start()
    for (let index = 0; index < frameCount; index += 1) {
      request.signal?.throwIfAborted()
      // Clear transparent pixels so the previous frame cannot ghost through.
      context.clearRect(0, 0, dimensions.width, dimensions.height)
      const drawn = await request.drawFrame(index, context)
      if (!drawn) throw new Error(`Frame ${index} could not be rendered.`)
      // Await encoder backpressure so long exports cannot grow an unbounded queue.
      await source.add(index * frameDuration, frameDuration)
      request.onProgress?.(index + 1, frameCount)
    }
    await output.finalize()
  } catch (error) {
    // Cancel unfinished output to release its encoder and buffered data.
    if (output.state === 'started' || output.state === 'pending') {
      await output.cancel().catch(() => {})
    }
    throw error
  }

  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new Error('Video encoding produced no data.')
  const mimeType = request.container === 'mp4' ? 'video/mp4' : 'video/webm'
  return {
    blob: new Blob([buffer], { type: mimeType }),
    suggestedFileName: `movie-${figureTimestamp()}.${request.container}`,
    codec,
    width: dimensions.width,
    height: dimensions.height,
    frameCount,
    durationSeconds: frameCount * frameDuration,
  }
}
