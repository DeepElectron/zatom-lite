import type { StateCreator } from 'zustand'
import type { BioCameraKeyframe } from '../../lib/biomolecule/camera-track'
import { removeBioCameraKeyframe, upsertBioCameraKeyframe } from '../../lib/biomolecule/camera-track'
import {
  evaluatePresentationStyleTrack,
  removePresentationStyleKeyframe,
  upsertPresentationStyleKeyframe,
  type PresentationStyleKeyframe,
  type PresentationStyleSnapshot,
} from '../../lib/biomolecule/presentation-style-track'
import type { CrystalStore } from '../crystal-store-types'

export interface PresentationTimelineSlice {
  presentationFrame: number
  presentationFrames: number
  presentationFps: number
  presentationPlaying: boolean
  presentationLoop: boolean
  presentationIntervalId: ReturnType<typeof setInterval> | null
  cameraKeyframes: BioCameraKeyframe[]
  baseStyleKeyframes: PresentationStyleKeyframe[]
  /** Derived frame style consumed only by viewport rendering; Visual remains the authoring source. */
  presentationStylePreview: PresentationStyleSnapshot | null
  setPresentationFrame: (frame: number) => void
  setPresentationFrames: (frames: number) => void
  setPresentationFps: (fps: number) => void
  setPresentationLoop: (loop: boolean) => void
  playPresentation: () => void
  pausePresentation: () => void
  upsertCameraKeyframe: (keyframe: Omit<BioCameraKeyframe, 'id'>) => void
  removeCameraKeyframe: (frame: number) => void
  /** Replace the full camera track, used to install and restore temporary export turntables. */
  setCameraKeyframes: (keyframes: BioCameraKeyframe[]) => void
  upsertBaseStyleKeyframe: (keyframe: Omit<PresentationStyleKeyframe, 'id'>) => void
  removeBaseStyleKeyframe: (frame: number) => void
  setBaseStyleKeyframes: (keyframes: PresentationStyleKeyframe[]) => void
  /** Clear every semantic layer track; optionally clear global/camera tracks. */
  clearLayerStyleTracks: (scope?: 'layers' | 'all') => void
  recordBaseStyle: () => void
  recordCameraAndBaseStyle: (camera: Pick<BioCameraKeyframe, 'position' | 'target' | 'zoom'>) => void
  resetPresentationTimeline: () => void
}

const clampFrames = (frames: number) => Math.max(2, Math.min(100_000, Math.round(frames)))
const clampFps = (fps: number) => Math.max(1, Math.min(120, Math.round(fps)))

function nextKeyframeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function mapPresentationFrameToTrajectory(
  presentationFrame: number,
  presentationFrames: number,
  trajectoryFrames: number,
): number {
  if (trajectoryFrames <= 1 || presentationFrames <= 1) return 0
  const progress = Math.max(0, Math.min(1, presentationFrame / (presentationFrames - 1)))
  return Math.round(progress * (trajectoryFrames - 1))
}

function snapshotBaseStyle(state: CrystalStore): PresentationStyleSnapshot {
  return {
    renderStyle: state.renderStyle,
    background: state.background,
    outline: state.outline,
    outlineWidth: state.outlineWidth,
    outlineColor: state.outlineColor,
    atomShininess: state.atomShininess,
    bondBicolor: state.bondBicolor,
    bondColor: state.bondColor,
    elementRadiusVariance: state.elementRadiusVariance,
    showCoordinationPolyhedra: state.showCoordinationPolyhedra,
    polyhedraOpacity: state.polyhedraOpacity,
    polyStyle: state.polyStyle,
    polyColorSource: state.polyColorSource,
    polyElementColors: { ...state.polyElementColors },
    polyColor: state.polyColor,
    showPolyEdges: state.showPolyEdges,
    polyEdgeColor: state.polyEdgeColor,
    polyEdgeOpacity: state.polyEdgeOpacity,
    polySpecular: state.polySpecular,
    polyShininess: state.polyShininess,
    polyFresnel: state.polyFresnel,
    cellColor: state.cellColor,
    cellLineWidth: state.cellLineWidth,
    showCellGrid: state.showCellGrid,
    showCrystalAxes: state.showCrystalAxes,
    ambientIntensity: state.ambientIntensity,
    diffuseIntensity: state.diffuseIntensity,
    specularIntensity: state.specularIntensity,
    rimIntensity: state.rimIntensity,
    viewMode: state.viewMode,
    radiusScale: state.radiusScale,
    bondRadius: state.bondRadius,
    atomScale: state.atomScale,
    bondScale: state.bondScale,
    showBonds: state.showBonds,
    showLattice: state.showLattice,
    lightAmbient: state.lightAmbient,
    lightKey: state.lightKey,
    lightFill: state.lightFill,
    lightAzimuth: state.lightAzimuth,
    lightElevation: state.lightElevation,
  }
}

export const createPresentationTimelineSlice: StateCreator<CrystalStore, [], [], PresentationTimelineSlice> = (set, get) => ({
  presentationFrame: 0,
  presentationFrames: 120,
  presentationFps: 24,
  presentationPlaying: false,
  presentationLoop: true,
  presentationIntervalId: null,
  cameraKeyframes: [],
  baseStyleKeyframes: [],
  presentationStylePreview: null,

  setPresentationFrame: (frame) => {
    if (!Number.isFinite(frame)) return
    const before = get()
    const presentationFrame = Math.max(0, Math.min(before.presentationFrames - 1, Math.round(frame)))
    const evaluatedStyle = evaluatePresentationStyleTrack(before.baseStyleKeyframes, presentationFrame)
    // Keep authoring state immutable while seeking. The viewport hook merges
    // this derived snapshot for rendering, matching the source's sceneSettings
    // path; recording therefore always snapshots the user's Visual settings.
    set({ presentationFrame, presentationStylePreview: evaluatedStyle })

    const state = get()
    if (state.trajectoryTotalFrames > 0) {
      const trajectoryFrame = mapPresentationFrameToTrajectory(
        presentationFrame,
        state.presentationFrames,
        state.trajectoryTotalFrames,
      )
      if (trajectoryFrame !== state.trajectoryCurrentFrame) state.setTrajectoryFrame(trajectoryFrame)
    }
  },
  setPresentationFrames: (frames) => {
    if (!Number.isFinite(frames)) return
    const presentationFrames = clampFrames(frames)
    const presentationFrame = Math.min(get().presentationFrame, presentationFrames - 1)
    set({ presentationFrames })
    get().setPresentationFrame(presentationFrame)
  },
  setPresentationFps: (fps) => {
    if (!Number.isFinite(fps)) return
    const presentationFps = clampFps(fps)
    const wasPlaying = get().presentationPlaying
    if (wasPlaying) get().pausePresentation()
    set({ presentationFps })
    if (wasPlaying) get().playPresentation()
  },
  setPresentationLoop: (presentationLoop) => set({ presentationLoop }),
  playPresentation: () => {
    if (get().presentationPlaying) return
    // The presentation timer is the only owner of the shared playhead. MODEL
    // playback must not leave a second interval advancing the same structure.
    get().pauseTrajectory()
    set({ isAnimatingCamera: false, cameraTarget: null })
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const intervalId = setInterval(() => {
      const state = get()
      const next = state.presentationFrame + 1
      if (next < state.presentationFrames) {
        state.setPresentationFrame(next)
      } else if (state.presentationLoop) {
        state.setPresentationFrame(0)
      } else {
        state.pausePresentation()
      }
    }, reducedMotion ? 1000 : Math.max(8, Math.round(1000 / get().presentationFps)))
    set({ presentationPlaying: true, presentationIntervalId: intervalId })
  },
  pausePresentation: () => {
    const intervalId = get().presentationIntervalId
    if (intervalId) clearInterval(intervalId)
    set({ presentationPlaying: false, presentationIntervalId: null })
  },
  upsertCameraKeyframe: (keyframe) => set({
    cameraKeyframes: upsertBioCameraKeyframe(get().cameraKeyframes, keyframe, () => nextKeyframeId('camera')),
  }),
  removeCameraKeyframe: (frame) => set({ cameraKeyframes: removeBioCameraKeyframe(get().cameraKeyframes, frame) }),
  setCameraKeyframes: (cameraKeyframes) => set({
    // The evaluator requires ascending frame order; preserve the same invariant as upsert.
    cameraKeyframes: [...cameraKeyframes].sort((left, right) => left.frame - right.frame),
  }),
  upsertBaseStyleKeyframe: (keyframe) => {
    set({ baseStyleKeyframes: upsertPresentationStyleKeyframe(get().baseStyleKeyframes, keyframe, () => nextKeyframeId('style')) })
    get().setPresentationFrame(get().presentationFrame)
  },
  removeBaseStyleKeyframe: (frame) => {
    const baseStyleKeyframes = removePresentationStyleKeyframe(get().baseStyleKeyframes, frame)
    set({ baseStyleKeyframes, ...(baseStyleKeyframes.length ? {} : { presentationStylePreview: null }) })
    get().setPresentationFrame(get().presentationFrame)
  },
  setBaseStyleKeyframes: (baseStyleKeyframes) => {
    set({
      baseStyleKeyframes: [...baseStyleKeyframes].sort((a, b) => a.frame - b.frame),
      ...(baseStyleKeyframes.length ? {} : { presentationStylePreview: null }),
    })
    get().setPresentationFrame(get().presentationFrame)
  },
  clearLayerStyleTracks: (scope = 'layers') => {
    const state = get()
    set({
      bioLayers: state.bioLayers.map((layer) => (
        layer.styleTrack?.length ? { ...layer, styleTrack: [] } : layer
      )),
      crystalLayers: state.crystalLayers.map((layer) => (
        layer.styleTrack?.length ? { ...layer, styleTrack: [] } : layer
      )),
      ...(scope === 'all' ? { cameraKeyframes: [], baseStyleKeyframes: [], presentationStylePreview: null } : {}),
    })
  },
  recordBaseStyle: () => {
    const state = get()
    set({
      baseStyleKeyframes: upsertPresentationStyleKeyframe(
        state.baseStyleKeyframes,
        { frame: state.presentationFrame, snapshot: snapshotBaseStyle(state), easing: 'smooth' },
        () => nextKeyframeId('style'),
      ),
    })
    get().setPresentationFrame(get().presentationFrame)
  },
  recordCameraAndBaseStyle: (camera) => {
    const state = get()
    const frame = state.presentationFrame
    set({
      cameraKeyframes: upsertBioCameraKeyframe(
        state.cameraKeyframes,
        {
          frame,
          position: camera.position,
          target: camera.target,
          ...(camera.zoom === undefined ? {} : { zoom: camera.zoom }),
          easing: 'smooth',
        },
        () => nextKeyframeId('camera'),
      ),
      baseStyleKeyframes: upsertPresentationStyleKeyframe(
        state.baseStyleKeyframes,
        { frame, snapshot: snapshotBaseStyle(state), easing: 'smooth' },
        () => nextKeyframeId('style'),
      ),
    })
    get().setPresentationFrame(frame)
  },
  resetPresentationTimeline: () => {
    get().pausePresentation()
    set({ presentationFrame: 0, presentationFrames: 120, presentationFps: 24, presentationLoop: true, cameraKeyframes: [], baseStyleKeyframes: [], presentationStylePreview: null })
  },
})
