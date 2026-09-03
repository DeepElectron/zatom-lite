'use client'

/** Turntable and keyframe movie controls; exportViewportMovie owns orchestration and restoration. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clapperboard, Film, X } from 'lucide-react'
import {
  getActiveViewportStoreApi,
  useActiveCrystalStore as useCrystalStore,
} from '../../orchestration/ViewportContext'
import {
  exportViewportMovie,
  movieTimelineFromStore,
} from '../../orchestration/viewportMovieExport'
import { resolveFrameCount } from '../../lib/video-export/turntable-track'
import type { VideoContainer, VideoQuality } from '../../lib/video-export/encode-video'
import { Notice, SectionLabel, Segmented, ToggleRow } from './panel-ui'

type MovieMode = 'turntable' | 'keyframes'

const CONTAINER_LABELS: Record<VideoContainer, string> = { mp4: 'MP4', webm: 'WebM' }
const QUALITY_LABELS: Record<VideoQuality, string> = {
  low: 'Draft',
  medium: 'Standard',
  high: 'Print',
}
/** Long-edge presets for publication, slides, and 4K presentation. */
const RESOLUTION_CHOICES = [1280, 1920, 3840] as const

export function MovieExportPanel() {
  const [mode, setMode] = useState<MovieMode>('turntable')
  const [container, setContainer] = useState<VideoContainer>('mp4')
  const [quality, setQuality] = useState<VideoQuality>('medium')
  const [maxDim, setMaxDim] = useState<number>(1920)
  const [turns, setTurns] = useState(1)
  const [durationSeconds, setDurationSeconds] = useState(6)
  const [transparent, setTransparent] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fps = useCrystalStore((state) => state.presentationFps)
  const presentationFrames = useCrystalStore((state) => state.presentationFrames)
  const cameraKeyframeCount = useCrystalStore((state) => state.cameraKeyframes.length)
  const atomCount = useCrystalStore((state) => state.atoms.length)

  // Abort on unmount so capture cannot keep advancing a timeline after cleanup disappears.
  useEffect(() => () => abortRef.current?.abort(), [])

  const frameCount = mode === 'turntable'
    ? resolveFrameCount(fps, durationSeconds)
    : presentationFrames
  const seconds = frameCount / Math.max(1, fps)
  const keyframesReady = cameraKeyframeCount >= 2
  const busy = progress !== null

  const blocker = useMemo(() => {
    if (atomCount === 0) return 'Load a structure before exporting a movie.'
    if (mode === 'keyframes' && !keyframesReady) {
      return 'Record at least two camera keyframes on the timeline first — with fewer, the camera never moves.'
    }
    return null
  }, [atomCount, mode, keyframesReady])

  async function runExport() {
    const controller = new AbortController()
    abortRef.current = controller
    setError(null)
    setLastResult(null)
    setProgress({ done: 0, total: frameCount })
    try {
      const storeApi = getActiveViewportStoreApi()
      const result = await exportViewportMovie(
        {
          registryKey: storeApi,
          source: mode === 'turntable'
            ? { mode: 'turntable', turns, durationSeconds }
            : { mode: 'keyframes' },
          container,
          quality,
          fps,
          maxDim,
          transparent,
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        },
        movieTimelineFromStore(storeApi),
      )
      setLastResult(
        `${CONTAINER_LABELS[container]} · ${result.codec.toUpperCase()} · ${result.width}×${result.height} · ${result.durationSeconds.toFixed(1)}s · ${(result.bytes / 1_048_576).toFixed(1)} MB`,
      )
    } catch (caught) {
      // User cancellation is not an error and should not show an alert.
      if (controller.signal.aborted) setLastResult(null)
      else setError(caught instanceof Error ? caught.message : 'Movie export failed.')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Motion</SectionLabel>
        <Segmented
          options={['Turntable', 'Timeline keyframes']}
          value={mode === 'turntable' ? 'Turntable' : 'Timeline keyframes'}
          onChange={(value) => setMode(value === 'Turntable' ? 'turntable' : 'keyframes')}
          ariaLabel="Movie motion source"
        />
        <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
          {mode === 'turntable'
            ? 'Orbits the current view around the vertical axis at a constant rate, keeping your elevation and zoom. Your timeline is left untouched.'
            : `Renders the camera track you authored on the timeline — ${cameraKeyframeCount} keyframe${cameraKeyframeCount === 1 ? '' : 's'} over ${presentationFrames} frames.`}
        </p>
      </div>

      {mode === 'turntable' && (
        <div className="flex flex-col gap-2">
          <SectionLabel>Turntable</SectionLabel>
          <label className="flex items-center gap-2 text-xs text-[var(--panel-text-secondary)]">
            <span className="w-16 shrink-0">Duration</span>
            <input
              type="number"
              min={1}
              max={120}
              step={0.5}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(
                Math.max(1, Math.min(120, Number(event.target.value) || 1)),
              )}
              className="zatom-field w-20 rounded px-2 py-1 font-mono text-xs"
              aria-label="Turntable duration in seconds"
            />
            <span className="shrink-0">s</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--panel-text-secondary)]">
            <span className="w-16 shrink-0">Turns</span>
            <input
              type="number"
              min={-8}
              max={8}
              step={0.25}
              value={turns}
              onChange={(event) => setTurns(Number(event.target.value) || 1)}
              className="zatom-field w-20 rounded px-2 py-1 font-mono text-xs"
              aria-label="Number of full revolutions; negative reverses direction"
            />
            <span className="shrink-0 text-[10px] text-[var(--panel-text-tertiary)]">
              negative reverses
            </span>
          </label>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>Container</SectionLabel>
        <Segmented
          options={Object.values(CONTAINER_LABELS)}
          value={CONTAINER_LABELS[container]}
          onChange={(value) => setContainer(value === 'MP4' ? 'mp4' : 'webm')}
          ariaLabel="Video container"
        />
        {/* H.264 and AV1 MP4 cannot encode alpha, so hide the transparency control. */}
        {container === 'webm' && (
          <ToggleRow
            label="Transparent background"
            description="Keeps the alpha channel so the movie composites over slides. Only WebM carries alpha."
            checked={transparent}
            onChange={setTransparent}
          />
        )}
        <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
          {container === 'mp4'
            ? 'H.264 where the browser supports it — the safest choice for journal submission systems and PowerPoint.'
            : 'VP9 in WebM. Smaller files and optional transparency, but some submission portals reject it.'}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>Quality</SectionLabel>
        <Segmented
          options={Object.values(QUALITY_LABELS)}
          value={QUALITY_LABELS[quality]}
          onChange={(value) => {
            const next = (Object.keys(QUALITY_LABELS) as VideoQuality[]).find(
              (key) => QUALITY_LABELS[key] === value,
            )
            if (next) setQuality(next)
          }}
          ariaLabel="Video quality"
        />
        <Segmented
          options={RESOLUTION_CHOICES.map((value) => `${value}p`)}
          value={`${maxDim}p`}
          onChange={(value) => setMaxDim(Number.parseInt(value, 10))}
          ariaLabel="Long edge resolution in pixels"
        />
      </div>

      <div className="rounded-lg bg-[var(--panel-hover)] px-3 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--panel-text-secondary)]">Output</span>
          <span className="font-mono text-[var(--panel-text)]">
            {frameCount} frames · {seconds.toFixed(1)}s
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--panel-text-tertiary)]">
          {/* Label resolution as approximate because framebuffer caps and even dimensions alter output. */}
          <span>~{maxDim} px long edge</span>
          <span>{fps} fps</span>
        </div>
      </div>

      {blocker && <Notice tone="amber" icon={AlertTriangle}>{blocker}</Notice>}
      {error && <Notice tone="red" icon={AlertTriangle}>{error}</Notice>}
      {lastResult && <Notice tone="green" icon={Film}>{`Exported ${lastResult}`}</Notice>}

      {progress && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--panel-text-tertiary)]">
            <span>Rendering frame {progress.done} of {progress.total}</span>
            <span className="font-mono">
              {Math.round((progress.done / Math.max(1, progress.total)) * 100)}%
            </span>
          </div>
          <div
            className="h-1 overflow-hidden rounded bg-[var(--panel-border)]"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Movie export progress"
          >
            <div
              className="h-full bg-[var(--panel-accent)] transition-[width] duration-150"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {busy ? (
        <button
          type="button"
          onClick={() => abortRef.current?.abort()}
          className="zatom-choice zatom-pressable flex items-center justify-center gap-1.5 rounded px-3 py-2 text-xs font-medium"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={runExport}
          disabled={blocker !== null}
          className="zatom-primary zatom-pressable flex items-center justify-center gap-1.5 rounded px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          <Clapperboard className="h-3.5 w-3.5" />
          Export movie
        </button>
      )}

      <p className="text-[10px] leading-relaxed text-[var(--panel-text-tertiary)]">
        Frames are rendered one at a time through the viewport, so keep this tab in the foreground —
        a backgrounded tab stops issuing animation frames and the export stalls.
      </p>
    </div>
  )
}
