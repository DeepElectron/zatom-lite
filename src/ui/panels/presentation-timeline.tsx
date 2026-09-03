import { useMemo } from 'react'
import { Camera, Clapperboard, Palette, Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import { evaluateBioCameraTrack } from '../../lib/biomolecule/camera-track'
import { aggregateLayerStyleTrackMarks } from '../../lib/presentation/layer-track-marks'
import { getActiveViewportStoreApi, useActiveCrystalStore as useCrystalStore } from '../../orchestration/ViewportContext'
import { getViewportPose } from '../../orchestration/viewportCaptureRegistry'
import { Toggle } from './panel-ui'

export function PresentationTimeline() {
  const frame = useCrystalStore((state) => state.presentationFrame)
  const frames = useCrystalStore((state) => state.presentationFrames)
  const fps = useCrystalStore((state) => state.presentationFps)
  const playing = useCrystalStore((state) => state.presentationPlaying)
  const loop = useCrystalStore((state) => state.presentationLoop)
  const cameraKeyframes = useCrystalStore((state) => state.cameraKeyframes)
  const styleKeyframes = useCrystalStore((state) => state.baseStyleKeyframes)
  const bioStructure = useCrystalStore((state) => state.bioStructure)
  const bioLayers = useCrystalStore((state) => state.bioLayers)
  const crystalLayers = useCrystalStore((state) => state.crystalLayers)
  const savedCameraState = useCrystalStore((state) => state.savedCameraState)
  const initialCameraPosition = useCrystalStore((state) => state.initialCameraPosition)
  const initialCameraLookAt = useCrystalStore((state) => state.initialCameraLookAt)
  const trajectoryFrame = useCrystalStore((state) => state.trajectoryCurrentFrame)
  const trajectoryFrames = useCrystalStore((state) => state.trajectoryTotalFrames)
  const setFrame = useCrystalStore((state) => state.setPresentationFrame)
  const setFrames = useCrystalStore((state) => state.setPresentationFrames)
  const setFps = useCrystalStore((state) => state.setPresentationFps)
  const setLoop = useCrystalStore((state) => state.setPresentationLoop)
  const play = useCrystalStore((state) => state.playPresentation)
  const pause = useCrystalStore((state) => state.pausePresentation)
  const addCameraKeyframe = useCrystalStore((state) => state.upsertCameraKeyframe)
  const setSavedCameraState = useCrystalStore((state) => state.setSavedCameraState)
  const removeCameraKeyframe = useCrystalStore((state) => state.removeCameraKeyframe)
  const recordCameraAndStyle = useCrystalStore((state) => state.recordCameraAndBaseStyle)
  const recordStyle = useCrystalStore((state) => state.recordBaseStyle)
  const setStyleKeyframes = useCrystalStore((state) => state.setBaseStyleKeyframes)
  const removeStyleKeyframe = useCrystalStore((state) => state.removeBaseStyleKeyframe)
  const clearLayerStyleTracks = useCrystalStore((state) => state.clearLayerStyleTracks)
  const keyAtFrame = cameraKeyframes.some((keyframe) => keyframe.frame === frame)
  const styleKeyAtFrame = styleKeyframes.some((keyframe) => keyframe.frame === frame)
  const recordableCamera = savedCameraState ?? evaluateBioCameraTrack(cameraKeyframes, frame) ?? (
    initialCameraPosition && initialCameraLookAt
      ? { position: initialCameraPosition, target: initialCameraLookAt }
      : null
  )
  const readLiveCamera = () => {
    const live = getViewportPose(getActiveViewportStoreApi())
    if (!live) return recordableCamera
    const pose = {
      position: live.position,
      target: live.lookAt,
      ...(live.zoom === undefined ? {} : { zoom: live.zoom }),
    }
    // Persistence and the camera key share the exact same click-time pose. This
    // also captures auto-rotate/damping that has not emitted OrbitControls end.
    setSavedCameraState(pose)
    return pose
  }
  const activeLayers = bioStructure ? bioLayers : crystalLayers
  const layerMarks = aggregateLayerStyleTrackMarks(activeLayers)
  const layerKeyCount = activeLayers.reduce((count, layer) => (
    count + (layer.styleTrack?.length ?? 0)
  ), 0)
  const styleLaneMarks = useMemo(() => {
    const byFrame = new Map<number, {
      frame: number
      global: number
      style: number
      show: number
      hide: number
      layerNames: string[]
    }>()
    for (const keyframe of styleKeyframes) {
      byFrame.set(keyframe.frame, {
        frame: keyframe.frame,
        global: 1,
        style: 0,
        show: 0,
        hide: 0,
        layerNames: [],
      })
    }
    for (const mark of layerMarks) {
      const current = byFrame.get(mark.frame) ?? {
        frame: mark.frame,
        global: 0,
        style: 0,
        show: 0,
        hide: 0,
        layerNames: [],
      }
      current.style += mark.style
      current.show += mark.show
      current.hide += mark.hide
      for (const name of mark.layerNames) {
        if (!current.layerNames.includes(name)) current.layerNames.push(name)
      }
      byFrame.set(mark.frame, current)
    }
    return [...byFrame.values()].sort((left, right) => left.frame - right.frame)
  }, [layerMarks, styleKeyframes])
  const globalStyleTrackIsConstant = useMemo(() => {
    if (styleKeyframes.length === 0) return false
    const visualSnapshots = styleKeyframes.map((keyframe) => JSON.stringify(keyframe.snapshot))
    return new Set(visualSnapshots).size < 2
  }, [styleKeyframes])
  const markerPosition = (keyframeFrame: number) => (
    Math.max(0, Math.min(keyframeFrame, frames - 1)) / Math.max(1, frames - 1)
  )
  const markerLeft = (keyframeFrame: number) => {
    const ratio = markerPosition(keyframeFrame)
    return `calc(${ratio * 100}% + ${8 - ratio * 16}px)`
  }
  const seekToKeyframe = (targetFrame: number) => {
    if (targetFrame < 0 || targetFrame >= frames) return
    pause()
    setFrame(targetFrame)
  }

  return (
    <section className="space-y-3" aria-labelledby="presentation-timeline-heading">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div id="presentation-timeline-heading" className="text-[13px]" style={{ color: 'var(--panel-text)' }}>Presentation timeline</div>
          <p className="mt-0.5 text-[10px] leading-4" style={{ color: 'var(--panel-text-secondary)' }}>
            One playhead drives camera, global style and molecular frames.
          </p>
        </div>
        <button
          type="button"
          className="zatom-choice zatom-pressable flex h-8 w-8 items-center justify-center rounded-lg"
          onClick={() => { playing ? pause() : play();  }}
          aria-label={playing ? 'Pause presentation' : 'Play presentation'}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>

      <div className="space-y-1.5" role="group" aria-label="Presentation tracks">
        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[9px] font-medium uppercase tracking-[.06em]" style={{ color: 'var(--panel-text-tertiary)' }}>View</span>
          <div className="relative h-5" role="group" aria-label="Camera keyframes">
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: 'var(--panel-border)' }} />
            <span className="pointer-events-none absolute top-0 h-5 w-px" style={{ left: markerLeft(frame), background: 'var(--panel-accent)' }} />
            {cameraKeyframes.map((keyframe) => {
              const outside = keyframe.frame < 0 || keyframe.frame >= frames
              return (
                <button
                  type="button"
                  key={keyframe.id}
                  className="zatom-pressable absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center disabled:cursor-not-allowed"
                  style={{ left: markerLeft(keyframe.frame) }}
                  onClick={() => seekToKeyframe(keyframe.frame)}
                  disabled={outside}
                  title={outside ? `Camera key #${keyframe.frame} is outside the timeline` : `Go to camera key #${keyframe.frame}`}
                  aria-label={`Go to camera keyframe ${keyframe.frame}`}
                >
                  <span
                    className={`h-2 w-2 rotate-45 rounded-[1px] ${keyframe.frame === frame ? 'ring-2 ring-[var(--panel-text)]' : ''}`}
                    style={{ background: outside ? 'var(--status-red)' : 'var(--panel-accent)' }}
                  />
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
          <span className="text-[9px] font-medium uppercase tracking-[.06em]" style={{ color: 'var(--panel-text-tertiary)' }}>Style</span>
          <div className="relative h-5" role="group" aria-label="Global and layer style keyframes">
            <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2" style={{ background: 'var(--panel-border)' }} />
            <span className="pointer-events-none absolute top-0 h-5 w-px" style={{ left: markerLeft(frame), background: 'var(--panel-accent)' }} />
            {styleLaneMarks.map((mark) => {
              const outside = mark.frame < 0 || mark.frame >= frames
              const hasStyle = mark.global + mark.style > 0
              const hasVisibility = mark.show + mark.hide > 0
              const mixed = (hasStyle && hasVisibility) || (mark.show > 0 && mark.hide > 0)
              const background = outside
                ? 'var(--status-red)'
                : mixed
                  ? '#e879f9'
                  : mark.hide > 0
                    ? '#fb7185'
                    : mark.show > 0
                      ? '#34d399'
                      : 'var(--status-amber)'
              const description = [
                mark.global > 0 ? 'global style' : null,
                mark.style > 0 ? `layer style ×${mark.style}` : null,
                mark.show > 0 ? `show ×${mark.show}` : null,
                mark.hide > 0 ? `hide ×${mark.hide}` : null,
              ].filter(Boolean).join(' · ')
              return (
                <button
                  type="button"
                  key={`style-mark-${mark.frame}`}
                  className="zatom-pressable absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center disabled:cursor-not-allowed"
                  style={{ left: markerLeft(mark.frame) }}
                  onClick={() => seekToKeyframe(mark.frame)}
                  disabled={outside}
                  title={`Frame ${mark.frame}: ${description}${mark.layerNames.length ? ` — ${mark.layerNames.join(', ')}` : ''}${outside ? ' (outside timeline)' : ''}`}
                  aria-label={`Go to style keyframe ${mark.frame}: ${description}`}
                >
                  <span
                    className={`h-2 w-2 rotate-45 rounded-[1px] ${mark.frame === frame ? 'ring-2 ring-[var(--panel-text)]' : 'ring-1 ring-black/30'}`}
                    style={{ background }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
        <span className="text-[9px] font-medium uppercase tracking-[.06em]" style={{ color: 'var(--panel-text-tertiary)' }}>Time</span>
        <input
          type="range"
          min={0}
          max={frames - 1}
          value={frame}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            pause()
            setFrame(next)
          }}
          className="w-full"
          style={{ accentColor: 'var(--panel-accent)' }}
          aria-label="Presentation frame"
        />
      </div>

      {layerKeyCount > 0 && (
        <p className="text-[10px]" style={{ color: 'var(--panel-text-secondary)' }}>
          Click a marker to seek · amber style · green show · rose hide · violet mixed
        </p>
      )}

      {globalStyleTrackIsConstant && (
        <p className="rounded-lg px-2.5 py-2 text-[10px] leading-4" style={{ color: 'var(--status-amber)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.24)' }}>
          The global style track is constant. Choose another frame, change the look in Visual, then record Style again to create a visible transition.
        </p>
      )}

      {trajectoryFrames > 1 && (
        <p className="text-[10px] tabular-nums" style={{ color: 'var(--panel-text-secondary)' }}>
          Molecular frame {trajectoryFrame + 1} / {trajectoryFrames}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <label className="text-[9px] uppercase tracking-[.04em]" style={{ color: 'var(--panel-text-tertiary)' }}>
          Frame
          <input className="zatom-field mt-1 w-full rounded-lg px-2 py-1.5 text-[11px]" type="number" min={0} max={frames - 1} value={frame} onChange={(event) => { pause(); setFrame(Number(event.currentTarget.value)) }} />
        </label>
        <label className="text-[9px] uppercase tracking-[.04em]" style={{ color: 'var(--panel-text-tertiary)' }}>
          Length
          <input className="zatom-field mt-1 w-full rounded-lg px-2 py-1.5 text-[11px]" type="number" min={2} max={100000} value={frames} onChange={(event) => { pause(); setFrames(Number(event.currentTarget.value)) }} />
        </label>
        <label className="text-[9px] uppercase tracking-[.04em]" style={{ color: 'var(--panel-text-tertiary)' }}>
          FPS
          <input className="zatom-field mt-1 w-full rounded-lg px-2 py-1.5 text-[11px]" type="number" min={1} max={120} value={fps} onChange={(event) => setFps(Number(event.currentTarget.value))} />
        </label>
      </div>

      <label className="flex cursor-pointer items-center justify-between">
        <span className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--panel-text)' }}><Repeat className="h-3.5 w-3.5" /> Loop</span>
        <Toggle checked={loop} onChange={setLoop} />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!recordableCamera}
          className="zatom-choice zatom-pressable flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-medium disabled:opacity-40"
          onClick={() => {
            pause()
            const camera = readLiveCamera()
            if (!camera) return
            addCameraKeyframe({
              frame,
              position: camera.position,
              target: camera.target,
              ...(camera.zoom === undefined ? {} : { zoom: camera.zoom }),
              easing: 'smooth',
            })
          }}
        >
          {keyAtFrame ? <Camera className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{keyAtFrame ? `Replace View @ ${frame}` : `Record View @ ${frame}`}</span>
        </button>
        <button
          type="button"
          className="zatom-choice zatom-pressable flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-medium"
          onClick={() => {
            pause()
            recordStyle()
          }}
        >
          <Palette className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{styleKeyAtFrame ? `Replace Global @ ${frame}` : `Record Global @ ${frame}`}</span>
        </button>
      </div>
      <button
        type="button"
        disabled={!recordableCamera}
        className="zatom-choice zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-2 text-[11px] font-medium disabled:opacity-40"
        onClick={() => {
          pause()
          const camera = readLiveCamera()
          if (!camera) return
          recordCameraAndStyle({
            position: camera.position,
            target: camera.target,
            ...(camera.zoom === undefined ? {} : { zoom: camera.zoom }),
          })
        }}
      >
        <Clapperboard className="h-3.5 w-3.5" />
        {keyAtFrame && styleKeyAtFrame ? `Replace view + global @ ${frame}` : `Record view + global @ ${frame}`}
      </button>
      <p className="text-[9px] leading-4" style={{ color: 'var(--panel-text-tertiary)' }}>
        Global keys drive the base and inheriting layers. Record an independently styled layer in its card below.
      </p>
      {keyAtFrame && (
        <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 py-1 text-[10px]" style={{ color: 'var(--status-red)' }} onClick={() => { pause(); removeCameraKeyframe(frame) }}>
          <Trash2 className="h-3 w-3" /> Remove camera keyframe
        </button>
      )}
      {styleKeyAtFrame && (
        <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 py-1 text-[10px]" style={{ color: 'var(--status-red)' }} onClick={() => { pause(); removeStyleKeyframe(frame) }}>
          <Trash2 className="h-3 w-3" /> Remove style keyframe
        </button>
      )}
      {styleKeyframes.length > 0 && (
        <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 py-1 text-[10px]" style={{ color: 'var(--status-red)' }} onClick={() => { pause(); setStyleKeyframes([]) }}>
          <Trash2 className="h-3 w-3" /> Clear global style track
        </button>
      )}
      {layerKeyCount > 0 && (
        <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 py-1 text-[10px]" style={{ color: 'var(--status-red)' }} onClick={() => { pause(); clearLayerStyleTracks() }}>
          <Trash2 className="h-3 w-3" /> Clear all layer tracks · {layerKeyCount} keys
        </button>
      )}
      {(layerKeyCount > 0 || styleKeyframes.length > 0 || cameraKeyframes.length > 0) && (
        <button type="button" className="zatom-pressable flex w-full items-center justify-center gap-2 py-1 text-[10px]" style={{ color: 'var(--status-red)' }} onClick={() => { pause(); clearLayerStyleTracks('all') }}>
          <Trash2 className="h-3 w-3" /> Clear every keyframe
        </button>
      )}
    </section>
  )
}
