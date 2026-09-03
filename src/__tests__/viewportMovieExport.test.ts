/**
 * Movie orchestration contracts beyond mediabunny encoding:
 * 1. Every frame comes from the timeline at that frame.
 * 2. Camera tracks and playhead restore after success, failure, or cancellation.
 * 3. Missing frames fail explicitly rather than producing frozen or incomplete video.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  exportViewportMovie,
  movieTimelineFromStore,
  resolveMoviePlan,
  type MovieExportRequest,
  type MovieTimelineController,
  type MovieTimelineSnapshot,
} from '../orchestration/viewportMovieExport'
import type { BioCameraKeyframe } from '../lib/biomolecule/camera-track'

function keyframe(frame: number): BioCameraKeyframe {
  return { id: `k${frame}`, frame, position: [0, 0, 10], target: [0, 0, 0], easing: 'linear' }
}

/** Fake timeline recording every visited frame. */
function fakeTimeline(initial: MovieTimelineSnapshot) {
  let current = { ...initial }
  const framesSeen: number[] = []
  let paused = false
  const controller: MovieTimelineController = {
    snapshot: () => ({ ...current }),
    applyTrack: (cameraKeyframes, presentationFrames) => {
      current = { ...current, cameraKeyframes, presentationFrames }
    },
    setFrame: (frame) => {
      framesSeen.push(frame)
      current = { ...current, presentationFrame: frame }
    },
    pause: () => { paused = true },
    restore: (snapshot) => { current = { ...snapshot } },
  }
  return {
    controller,
    framesSeen,
    state: () => current,
    wasPaused: () => paused,
  }
}

const TURNTABLE_REQUEST: MovieExportRequest = {
  registryKey: 'vp',
  source: { mode: 'turntable', turns: 1, durationSeconds: 0.25 },
  container: 'webm',
  quality: 'medium',
  fps: 8,
  maxDim: 640,
}

const POSE = { position: [0, 5, 5] as [number, number, number], target: [0, 0, 0] as [number, number, number] }

/** Fake session that runs immediately with an always-successful drawFrame. */
function fakeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    isRegistered: () => true,
    getPose: () => POSE,
    runFrameSequence: async <T,>(
      _opts: unknown,
      run: (drawFrame: () => Promise<CanvasImageSource | null>) => Promise<T>,
    ) => run(async () => ({ width: 320, height: 200 }) as unknown as CanvasImageSource),
    encode: vi.fn(async (req: { frameCount: number; drawFrame: (i: number, c: CanvasRenderingContext2D) => Promise<boolean> }) => {
      const context = { drawImage: () => {} } as unknown as CanvasRenderingContext2D
      for (let index = 0; index < req.frameCount; index += 1) {
        await req.drawFrame(index, context)
      }
      return {
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'video/webm' }),
        suggestedFileName: 'movie-test.webm',
        codec: 'vp9' as const,
        width: 320,
        height: 200,
        frameCount: req.frameCount,
        durationSeconds: req.frameCount / 8,
      }
    }),
    download: vi.fn(),
    ...overrides,
  }
}

describe('resolveMoviePlan', () => {
  const snapshot: MovieTimelineSnapshot = {
    cameraKeyframes: [keyframe(0), keyframe(48)],
    presentationFrames: 49,
    presentationFrame: 12,
  }

  it('关键帧模式沿用时间轴长度,不去猜用户想要多长', () => {
    const plan = resolveMoviePlan({ mode: 'keyframes' }, 24, snapshot, null)
    expect(plan).toEqual({ track: null, frames: 49 })
  })

  it('关键帧不足两个时拒绝 —— 相机不动的"视频"应该走出图', () => {
    expect(resolveMoviePlan({ mode: 'keyframes' }, 24, {
      ...snapshot, cameraKeyframes: [keyframe(0)],
    }, null)).toBeNull()
  })

  it('转台按 fps × 时长定帧数,并自带轨道', () => {
    const plan = resolveMoviePlan({ mode: 'turntable', turns: 1, durationSeconds: 5 }, 24, snapshot, POSE)
    expect(plan?.frames).toBe(120)
    expect(plan?.track?.length).toBeGreaterThan(1)
  })

  it('转台拿不到相机位姿时拒绝', () => {
    expect(resolveMoviePlan({ mode: 'turntable', turns: 1, durationSeconds: 5 }, 24, snapshot, null))
      .toBeNull()
  })
})

describe('exportViewportMovie', () => {
  it('逐帧推播放头:第 i 帧的画面来自被设到第 i 帧的时间轴', async () => {
    const timeline = fakeTimeline({ cameraKeyframes: [], presentationFrames: 10, presentationFrame: 3 })
    const dependencies = fakeDependencies()
    const result = await exportViewportMovie(TURNTABLE_REQUEST, timeline.controller, dependencies)

    // 8 fps times 0.25 seconds yields two frames.
    expect(result.frameCount).toBe(2)
    expect(timeline.framesSeen).toEqual([0, 1])
    expect(timeline.wasPaused()).toBe(true)
    expect(dependencies.download).toHaveBeenCalledOnce()
  })

  it('录完把相机轨道与播放头原样还原', async () => {
    const original: MovieTimelineSnapshot = {
      cameraKeyframes: [keyframe(0), keyframe(30)],
      presentationFrames: 31,
      presentationFrame: 7,
    }
    const timeline = fakeTimeline(original)
    await exportViewportMovie(TURNTABLE_REQUEST, timeline.controller, fakeDependencies())
    // Restore the user's track after the temporary turntable track completes.
    expect(timeline.state()).toEqual(original)
  })

  it('编码失败也还原 —— 不把用户留在导出时的临时状态', async () => {
    const original: MovieTimelineSnapshot = {
      cameraKeyframes: [keyframe(0), keyframe(30)],
      presentationFrames: 31,
      presentationFrame: 7,
    }
    const timeline = fakeTimeline(original)
    const dependencies = fakeDependencies({
      encode: async () => { throw new Error('codec exploded') },
    })
    await expect(
      exportViewportMovie(TURNTABLE_REQUEST, timeline.controller, dependencies),
    ).rejects.toThrow('codec exploded')
    expect(timeline.state()).toEqual(original)
  })

  it('画布抓不到帧时明确失败,而不是产出缺帧的片子', async () => {
    const timeline = fakeTimeline({ cameraKeyframes: [], presentationFrames: 10, presentationFrame: 0 })
    const dependencies = fakeDependencies({
      runFrameSequence: async <T,>(
        _opts: unknown,
        run: (drawFrame: () => Promise<CanvasImageSource | null>) => Promise<T>,
      ) => run(async () => null),
    })
    await expect(
      exportViewportMovie(TURNTABLE_REQUEST, timeline.controller, dependencies),
    ).rejects.toThrow(/did not render a frame/)
  })

  it('视口没注册时不开始录制', async () => {
    const timeline = fakeTimeline({ cameraKeyframes: [], presentationFrames: 10, presentationFrame: 0 })
    const dependencies = fakeDependencies({ isRegistered: () => false })
    await expect(
      exportViewportMovie(TURNTABLE_REQUEST, timeline.controller, dependencies),
    ).rejects.toThrow(/not ready/)
    expect(dependencies.download).not.toHaveBeenCalled()
  })

  it('mp4 不请求透明底 —— avc 没有 alpha 通道,透明会被编成黑底', async () => {
    const timeline = fakeTimeline({ cameraKeyframes: [], presentationFrames: 10, presentationFrame: 0 })
    const seen: Array<{ transparent?: boolean }> = []
    const base = fakeDependencies()
    const dependencies = {
      ...base,
      runFrameSequence: async <T,>(
        opts: { transparent?: boolean },
        run: (drawFrame: () => Promise<CanvasImageSource | null>) => Promise<T>,
      ) => {
        seen.push(opts)
        return run(async () => ({ width: 320, height: 200 }) as unknown as CanvasImageSource)
      },
    }
    await exportViewportMovie(
      { ...TURNTABLE_REQUEST, container: 'mp4', transparent: true },
      timeline.controller,
      dependencies,
    )
    expect(seen[0].transparent).toBe(false)

    await exportViewportMovie(
      { ...TURNTABLE_REQUEST, container: 'webm', transparent: true },
      timeline.controller,
      dependencies,
    )
    expect(seen[1].transparent).toBe(true)
  })
})

describe('movieTimelineFromStore', () => {
  it('先设长度再装轨道 —— 顺序颠倒会让首帧被夹到旧长度里', () => {
    const calls: string[] = []
    const state = {
      cameraKeyframes: [keyframe(0)],
      presentationFrames: 10,
      presentationFrame: 2,
      setPresentationFrame: () => calls.push('frame'),
      setPresentationFrames: () => calls.push('frames'),
      setCameraKeyframes: () => calls.push('track'),
      pausePresentation: () => calls.push('pause'),
    }
    const timeline = movieTimelineFromStore({ getState: () => state })
    timeline.applyTrack([keyframe(0), keyframe(120)], 121)
    expect(calls).toEqual(['frames', 'track'])
  })

  it('快照读的是 store 当前值', () => {
    const state = {
      cameraKeyframes: [keyframe(5)],
      presentationFrames: 42,
      presentationFrame: 9,
      setPresentationFrame: () => {},
      setPresentationFrames: () => {},
      setCameraKeyframes: () => {},
      pausePresentation: () => {},
    }
    const timeline = movieTimelineFromStore({ getState: () => state })
    expect(timeline.snapshot()).toEqual({
      cameraKeyframes: [keyframe(5)],
      presentationFrames: 42,
      presentationFrame: 9,
    })
  })
})
