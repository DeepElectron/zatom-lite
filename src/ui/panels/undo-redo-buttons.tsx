"use client"

import { useState } from "react"
import { Undo2, Redo2, Play, Pause, SkipBack, SkipForward, Settings2, Gauge, Repeat } from "lucide-react"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"

export function UndoRedoButtons() {
  const undo = useCrystalStore((s) => s.undo)
  const redo = useCrystalStore((s) => s.redo)
  const undoAssembly = useCrystalStore((s) => s.undoAssembly)
  const redoAssembly = useCrystalStore((s) => s.redoAssembly)
  const builderMode = useCrystalStore((s) => s.builderMode)
  const lastHistoryDomain = useCrystalStore((s) => s.lastHistoryDomain)
  // Subscribe to the changing indices themselves. Subscribing only to the stable
  // canUndo/canRedo function references left the buttons visually stale after an
  // undo until some unrelated part of the toolbar happened to re-render.
  const historyIndex = useCrystalStore((s) => s.historyIndex)
  const historyLength = useCrystalStore((s) => s.history.length)
  const assemblyHistoryIndex = useCrystalStore((s) => s.assemblyHistoryIndex)
  const assemblyHistoryLength = useCrystalStore((s) => s.assemblyHistory.length)

  const trajectoryTotalFrames = useCrystalStore((s) => s.trajectoryTotalFrames)
  const trajectoryCurrentFrame = useCrystalStore((s) => s.trajectoryCurrentFrame)
  const trajectoryPlaying = useCrystalStore((s) => s.trajectoryPlaying)
  const trajectoryFormatLabel = useCrystalStore((s) => s.trajectoryFormatLabel)
  const trajectoryMetadata = useCrystalStore((s) => s.trajectoryMetadata)
  const bioStructure = useCrystalStore((s) => s.bioStructure)
  const presentationFrame = useCrystalStore((s) => s.presentationFrame)
  const presentationFrames = useCrystalStore((s) => s.presentationFrames)
  const presentationPlaying = useCrystalStore((s) => s.presentationPlaying)
  const presentationLoop = useCrystalStore((s) => s.presentationLoop)
  const presentationFps = useCrystalStore((s) => s.presentationFps)
  const playPresentation = useCrystalStore((s) => s.playPresentation)
  const pausePresentation = useCrystalStore((s) => s.pausePresentation)
  const setPresentationFrame = useCrystalStore((s) => s.setPresentationFrame)
  const setPresentationLoop = useCrystalStore((s) => s.setPresentationLoop)
  const setPresentationFps = useCrystalStore((s) => s.setPresentationFps)
  const playTrajectory = useCrystalStore((s) => s.playTrajectory)
  const pauseTrajectory = useCrystalStore((s) => s.pauseTrajectory)
  const nextFrame = useCrystalStore((s) => s.nextFrame)
  const prevFrame = useCrystalStore((s) => s.prevFrame)
  const setTrajectoryFrame = useCrystalStore((s) => s.setTrajectoryFrame)

  // B2: streaming compact trajectory (large/multi-frame xyz) drives the same bar
  const compactTrajectory = useCrystalStore((s) => s.compactTrajectory)
  const compactPlaying = useCrystalStore((s) => s.compactTrajectoryPlaying)
  const compactFrame = useCrystalStore((s) => s.compactTrajectoryDisplayFrame)
  const compactSource = useCrystalStore((s) => s.compactTrajectorySource)
  const setCompactTrajectoryPlaying = useCrystalStore((s) => s.setCompactTrajectoryPlaying)
  const requestCompactTrajectorySeek = useCrystalStore((s) => s.requestCompactTrajectorySeek)
  const compactLoop = useCrystalStore((s) => s.compactTrajectoryLoop)
  const setCompactTrajectoryLoop = useCrystalStore((s) => s.setCompactTrajectoryLoop)
  const setCompactTrajectoryFps = useCrystalStore((s) => s.setCompactTrajectoryFps)
  const [showTrajSettings, setShowTrajSettings] = useState(false)

  // Assets can mutate Assembly data (for example deleting a Building Block)
  // without taking the structure viewer into Assembly mode. Undo must follow
  // the most recent edit domain in that case, while an open Scene still owns it.
  const assemblyMode = builderMode === 'assembly' || lastHistoryDomain === 'assembly'
  const canUndoNow = assemblyMode ? assemblyHistoryIndex >= 0 : historyIndex >= 0
  const canRedoNow = assemblyMode
    ? assemblyHistoryIndex + 2 < assemblyHistoryLength
    : historyIndex + 2 < historyLength
  const handleUndo = assemblyMode ? undoAssembly : undo
  const handleRedo = assemblyMode ? redoAssembly : redo
  const compactActive = compactTrajectory !== null && compactTrajectory.frameCount > 1

  // Compact streaming takes priority over materialized Atom[] frames.
  const bioPresentationActive = Boolean(bioStructure && trajectoryTotalFrames > 1)
  const totalFrames = compactActive ? compactTrajectory.frameCount : bioPresentationActive ? presentationFrames : trajectoryTotalFrames
  const currentFrame = compactActive ? compactFrame : bioPresentationActive ? presentationFrame : trajectoryCurrentFrame
  const playing = compactActive ? compactPlaying : bioPresentationActive ? presentationPlaying : trajectoryPlaying
  const formatLabel = compactActive ? (compactSource ? 'stream' : 'demo') : trajectoryFormatLabel
  const onPlayPause = () => {
    if (compactActive) setCompactTrajectoryPlaying(!compactPlaying)
    else if (bioPresentationActive) presentationPlaying ? pausePresentation() : playPresentation()
    else if (trajectoryPlaying) pauseTrajectory()
    else playTrajectory()
  }
  const onPrev = () => { if (compactActive) requestCompactTrajectorySeek(Math.max(0, compactFrame - 1)); else if (bioPresentationActive) setPresentationFrame(Math.max(0, presentationFrame - 1)); else prevFrame() }
  const onNext = () => { if (compactActive) requestCompactTrajectorySeek(Math.min(totalFrames - 1, compactFrame + 1)); else if (bioPresentationActive) setPresentationFrame(Math.min(totalFrames - 1, presentationFrame + 1)); else nextFrame() }
  const onSeek = (frame: number) => { if (compactActive) requestCompactTrajectorySeek(frame); else if (bioPresentationActive) setPresentationFrame(frame); else setTrajectoryFrame(frame) }
  const hasTrajectory = totalFrames > 1

  const btnBase = "zatom-pressable flex items-center justify-center w-8 h-8 rounded-lg"

  return (
    <div
      className="modeler-chrome-surface flex items-center gap-1 rounded-xl p-1"
      style={{
        backgroundColor: 'var(--panel-bg)',
        border: '1px solid var(--panel-border)',
      }}
    >
      <button
        onClick={() => { if (canUndoNow) { handleUndo();  } }}
        disabled={!canUndoNow}
        className={btnBase}
        style={{
          backgroundColor: canUndoNow ? 'var(--panel-elevated)' : 'transparent',
          color: canUndoNow ? 'var(--panel-text)' : 'var(--panel-text-tertiary)',
          cursor: canUndoNow ? 'pointer' : 'not-allowed',
        }}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        onClick={() => { if (canRedoNow) { handleRedo();  } }}
        disabled={!canRedoNow}
        className={btnBase}
        style={{
          backgroundColor: canRedoNow ? 'var(--panel-elevated)' : 'transparent',
          color: canRedoNow ? 'var(--panel-text)' : 'var(--panel-text-tertiary)',
          cursor: canRedoNow ? 'pointer' : 'not-allowed',
        }}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 className="w-4 h-4" />
      </button>

      {hasTrajectory && (
        <>
          <div className="w-px h-5 mx-0.5" style={{ backgroundColor: 'var(--panel-border)' }} />

          <button onClick={() => { onPrev();  }}
            className={btnBase} style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--panel-text)' }} title="Previous Frame">
            <SkipBack className="w-4 h-4" />
          </button>

          <button onClick={() => { onPlayPause();  }}
            className={btnBase} style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--panel-text)' }} title={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>

          <button onClick={() => { onNext();  }}
            className={btnBase} style={{ backgroundColor: 'var(--panel-elevated)', color: 'var(--panel-text)' }} title="Next Frame">
            <SkipForward className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 px-2">
            <input
              type="range"
              min={0}
              max={totalFrames - 1}
              value={Math.min(currentFrame, totalFrames - 1)}
              onChange={(e) => {
                const frame = parseInt(e.target.value, 10)
                onSeek(frame)
              }}
              className="w-20 h-1 rounded-lg appearance-none cursor-pointer"
              style={{ accentColor: 'var(--panel-accent)' }}
              title={`Frame ${currentFrame + 1} of ${totalFrames}`}
            />
            <span style={{ fontSize: 12, color: 'var(--panel-text-secondary)', minWidth: '4rem', textAlign: 'center' }}>
              {(currentFrame + 1).toLocaleString()}/{totalFrames.toLocaleString()}
            </span>
          </div>

          {compactActive || bioPresentationActive ? (
            <>
              <button
                onClick={() => setShowTrajSettings((v) => !v)}
                className={`${btnBase} zatom-choice`}
                data-selected={showTrajSettings}
                title="Playback settings (speed · loop)"
              >
                <Settings2 className="w-4 h-4" />
              </button>

              {/* inline expansion — the bar grows to the right, no floating popover */}
              <div
                className="flex items-center overflow-hidden"
                style={{
                  maxWidth: showTrajSettings ? 230 : 0,
                  opacity: showTrajSettings ? 1 : 0,
                  transition: 'max-width 280ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease',
                }}
              >
                <div className="w-px h-5 mx-1 shrink-0" style={{ backgroundColor: 'var(--panel-border)' }} />
                {(compactTrajectory || bioPresentationActive) && (
                  <div className="flex items-center gap-2 px-1 shrink-0">
                    <Gauge className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} />
                    <input
                      type="range" min={1} max={120} step={1}
                      value={bioPresentationActive ? presentationFps : compactTrajectory!.trajFps}
                      onChange={(e) => bioPresentationActive ? setPresentationFps(parseInt(e.target.value, 10)) : setCompactTrajectoryFps(parseInt(e.target.value, 10))}
                      className="w-16 h-1 rounded-lg appearance-none cursor-pointer"
                      style={{ accentColor: 'var(--panel-accent)' }}
                      title="Playback speed (fps)"
                    />
                    <span style={{ fontSize: 11, color: 'var(--panel-text-secondary)', minWidth: '3.2rem' }}>
                      {bioPresentationActive ? presentationFps : compactTrajectory!.trajFps} fps
                    </span>
                    <button
                      onClick={() => { bioPresentationActive ? setPresentationLoop(!presentationLoop) : setCompactTrajectoryLoop(!compactLoop);  }}
                      className={`${btnBase} zatom-choice`}
                      data-selected={bioPresentationActive ? presentationLoop : compactLoop}
                      title={(bioPresentationActive ? presentationLoop : compactLoop) ? 'Loop on' : 'Loop off (stop on last frame)'}
                    >
                      <Repeat className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : formatLabel && (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
              style={{
                backgroundColor: 'var(--control-selected-bg)',
                color: 'var(--control-selected-text)',
                border: '1px solid var(--control-selected-border)',
              }}
              title={`Source format: ${formatLabel}${trajectoryMetadata.length ? ` · ${trajectoryMetadata.length} frames metadata` : ''}`}
            >
              {formatLabel}
            </span>
          )}
        </>
      )}
    </div>
  )
}
