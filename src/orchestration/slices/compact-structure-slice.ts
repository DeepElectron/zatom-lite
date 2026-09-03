import type { StateCreator } from 'zustand'
import type { CrystalStore } from '../crystal-store-types'
import type { CompactStructure } from '../../lib/render/compact-structure'
import type { AsyncFrameSource, AsyncSpeciesSource } from '../../lib/render/frame-source'
import { createWorkerExtxyzFileSource } from '../../lib/render/extxyz-worker-source'
import { createSpectrajSource } from '../../lib/render/spectraj'
import { defaultMolecularOrbitalState } from '../../lib/molecular-orbitals/state'
import type { Atom } from '../../lib/crystal/types'
import { analysisOverlayResetPatch } from './atom-attributes-slice'

export interface CompactTrajectoryConfig {
  /** Total frames — frames are produced on demand (zero storage), so this can be huge. */
  frameCount: number
  /** Trajectory playback speed in frames per second. */
  trajFps: number
  /** Synthetic vibration amplitude (Å). */
  amplitude: number
}

export interface CompactStructureSlice {
  /** When non-null, the viewer renders this typed-array bulk via impostors and
   *  skips the per-atom Atom[] pipeline. */
  compactStructure: CompactStructure | null
  /** Small materialized neighborhood rendered via the detail path for interaction. */
  focusAtoms: Atom[]
  /** Selected atom indices over the compact bulk (B3 GPU picking). */
  selectedCompactIndices: Set<number>
  /** Active trajectory config (B2). Trajectory mode is view-only: picking disabled. */
  compactTrajectory: CompactTrajectoryConfig | null
  /** Externally-provided frame source (B2 v2: streaming file/artifact trajectories).
   *  When null, CompactAtoms synthesizes a procedural source from the config. */
  compactTrajectorySource: AsyncFrameSource | null
  /** Streaming per-frame species window source (positions static, appearance animates).
   *  Set for .spectraj trajectories; null for position trajectories. */
  compactSpeciesSource: AsyncSpeciesSource | null
  compactTrajectoryPlaying: boolean
  /** Loop playback. Default off → stop on the last frame; play again restarts. */
  compactTrajectoryLoop: boolean
  /** One-shot seek request (frame index) consumed by the playback loop. */
  compactTrajectorySeek: number | null
  /** Throttled (~4Hz) playhead frame for UI display — NOT per-frame reactive. */
  compactTrajectoryDisplayFrame: number
  /** Same-document compact edit (for example deleting selected atoms). */
  setCompactStructure: (compact: CompactStructure | null) => void
  /** Replace the active document with a raw compact structure and frame it afresh. */
  replaceCompactStructure: (compact: CompactStructure) => void
  clearCompactStructure: () => void
  setFocusAtoms: (atoms: Atom[]) => void
  clearFocusAtoms: () => void
  setCompactSelection: (indices: number[]) => void
  /** Toggle-add the given indices (Shift behaviour). */
  addCompactSelection: (indices: number[]) => void
  clearCompactSelection: () => void
  setCompactTrajectory: (cfg: CompactTrajectoryConfig | null) => void
  setCompactTrajectorySource: (source: AsyncFrameSource | null) => void
  /** One-stop streaming trajectory load (worker-indexed + worker-decoded extXYZ):
   *  installs frame 0 as the compact structure and starts playback. */
  loadCompactTrajectoryFile: (file: File, opts?: { trajFps?: number; onProgress?: (fraction: number) => void }) => Promise<{ frameCount: number; atomCount: number }>
  setCompactSpeciesSource: (src: AsyncSpeciesSource | null) => void
  /** Stream a .spectraj Blob: install the static structure + species window source + play. */
  loadCompactSpeciesFile: (file: Blob, opts?: { trajFps?: number; onProgress?: (fraction: number) => void }) => Promise<{ frameCount: number; atomCount: number }>
  setCompactTrajectoryPlaying: (playing: boolean) => void
  setCompactTrajectoryLoop: (loop: boolean) => void
  setCompactTrajectoryFps: (fps: number) => void
  requestCompactTrajectorySeek: (frame: number) => void
  clearCompactTrajectorySeek: () => void
  setCompactTrajectoryDisplayFrame: (frame: number) => void
  /** Voronoi seed xyz per grain (from the polycrystal generator) — when present,
   *  region hulls snap exactly onto the cell boundary planes (gap-free tiling). */
  regionSeeds: Float32Array | null
  setRegionSeeds: (seeds: Float32Array | null) => void
  /** Phase C: region solids (per-grain/layer convex hulls) view flags. */
  showRegionSolids: boolean
  hideAtomsInRegionView: boolean
  regionOpacity: number
  /** Region geometry: 'hull' (convex), 'voxel' (concave-friendly surface), 'auto'
   *  (dynamic species regions → voxel; static grains/layers → hull). */
  regionGeometryMode: 'auto' | 'hull' | 'voxel'
  /** Dynamic (per-frame) regions: hide the majority label's regions (e.g. the
   *  background phase) so the minority phase plays as solid blocks. */
  regionHideMajority: boolean
  setShowRegionSolids: (show: boolean) => void
  setHideAtomsInRegionView: (hide: boolean) => void
  setRegionOpacity: (opacity: number) => void
  setRegionGeometryMode: (mode: 'auto' | 'hull' | 'voxel') => void
  setRegionHideMajority: (hide: boolean) => void
}

export const createCompactStructureSlice: StateCreator<CrystalStore, [], [], CompactStructureSlice> = (set, get) => ({
  compactStructure: null,
  focusAtoms: [],
  selectedCompactIndices: new Set<number>(),
  compactTrajectory: null,
  compactTrajectorySource: null,
  compactSpeciesSource: null,
  compactTrajectoryPlaying: false,
  compactTrajectoryLoop: false,
  compactTrajectorySeek: null,
  compactTrajectoryDisplayFrame: 0,
  setCompactStructure: (compact) => set((s) => {
    s.compactTrajectorySource?.dispose?.()
    s.compactSpeciesSource?.dispose?.()
    return {
      compactStructure: compact, focusAtoms: [], selectedCompactIndices: new Set<number>(),
      ...(compact && s.viewMode === 'stick' ? { viewMode: 'ball-stick' as const, stylePresetId: 'custom' } : {}),
      compactTrajectory: null, compactTrajectorySource: null, compactSpeciesSource: null, compactTrajectoryPlaying: false,
      compactTrajectorySeek: null, compactTrajectoryDisplayFrame: 0,
    }
  }),
  replaceCompactStructure: (compact) => {
    get().clearBiomolecule()
    get().clearCrystalLayers()
    get().clearTrajectory()
    get().resetPresentationTimeline()
    get().setCompactStructure(compact)
    set({
      periodic: false,
      atoms: [],
      unitCellAtoms: [],
      bonds: [],
      selectedAtomIds: new Set<string>(),
      selectedBondIds: new Set<string>(),
      regionSeeds: null,
      showRegionSolids: false,
      hideAtomsInRegionView: false,
      showGrainColoring: false,
      molecularOrbital: defaultMolecularOrbitalState,
      domainWallReview: null,
      constructedPlane: null,
      show2DPlaneView: false,
      clippingEnabled: false,
      clippingAxis: 'z',
      clippingOffset: 0,
      clippingNormal: null,
      volumeField: 'none',
      sliceEnabled: false,
      sliceClip: 'none',
      sliceIsolate: false,
      ...analysisOverlayResetPatch(),
    })
    get().beginCameraDocument()
  },
  clearCompactStructure: () => set((s) => {
    s.compactTrajectorySource?.dispose?.()
    s.compactSpeciesSource?.dispose?.()
    return {
      compactStructure: null, focusAtoms: [], selectedCompactIndices: new Set<number>(),
      compactTrajectory: null, compactTrajectorySource: null, compactSpeciesSource: null, compactTrajectoryPlaying: false,
      compactTrajectorySeek: null, compactTrajectoryDisplayFrame: 0,
    }
  }),
  setFocusAtoms: (atoms) => set({ focusAtoms: atoms }),
  clearFocusAtoms: () => set({ focusAtoms: [] }),
  setCompactSelection: (indices) => set({ selectedCompactIndices: new Set(indices) }),
  addCompactSelection: (indices) => set((s) => {
    const next = new Set(s.selectedCompactIndices)
    for (const i of indices) { if (next.has(i)) next.delete(i); else next.add(i) }
    return { selectedCompactIndices: next }
  }),
  clearCompactSelection: () => set({ selectedCompactIndices: new Set<number>() }),
  setCompactTrajectory: (cfg) => set((s) => {
    if (!cfg) { s.compactTrajectorySource?.dispose?.(); s.compactSpeciesSource?.dispose?.() }
    return {
      compactTrajectory: cfg,
      // Stop also drops any external (file/artifact) source
      ...(cfg ? {} : { compactTrajectorySource: null, compactSpeciesSource: null }),
      compactTrajectoryPlaying: !!cfg,
      compactTrajectorySeek: null,
      compactTrajectoryDisplayFrame: 0,
      // trajectory mode is view-only: drop selection/focus
      selectedCompactIndices: new Set<number>(),
      focusAtoms: [],
    }
  }),
  setCompactTrajectorySource: (source) => set({ compactTrajectorySource: source }),
  loadCompactTrajectoryFile: async (file, opts) => {
    const { source, structure, frameCount } = await createWorkerExtxyzFileSource(file, opts?.onProgress)
    const s = get()
    s.replaceCompactStructure(structure) // clears prior document/trajectory state + disposes the old source
    s.setRegionSeeds(null)
    s.setShowGrainColoring(false)
    s.setCompactTrajectorySource(source)
    s.setCompactTrajectory({ frameCount, trajFps: Math.max(1, opts?.trajFps ?? 30), amplitude: 0 })
    s.setCompactTrajectoryPlaying(false) // import loads paused — user presses play to start
    return { frameCount, atomCount: structure.count }
  },
  setCompactSpeciesSource: (source) => set({ compactSpeciesSource: source }),
  loadCompactSpeciesFile: async (file, opts) => {
    const { structure, source, frameCount, trajFps, amplitude } = await createSpectrajSource(file)
    const s = get()
    s.replaceCompactStructure(structure) // clears prior document/trajectory state + disposes the old sources
    s.setRegionSeeds(null)
    s.setShowGrainColoring(false)
    s.setCompactSpeciesSource(source)
    // amplitude>0 ⇒ the renderer adds procedural per-atom thermal jitter (MD wobble).
    s.setCompactTrajectory({ frameCount, trajFps: Math.max(1, opts?.trajFps ?? trajFps), amplitude })
    s.setCompactTrajectoryPlaying(false) // import loads paused — user presses play to start
    return { frameCount, atomCount: structure.count }
  },
  setCompactTrajectoryPlaying: (playing) => set(playing
    // resuming playback must drop the materialized focus patch — it is a frozen
    // snapshot and would interpenetrate the vibrating impostors
    ? { compactTrajectoryPlaying: true, focusAtoms: [] }
    : { compactTrajectoryPlaying: false }),
  setCompactTrajectoryLoop: (loop) => set({ compactTrajectoryLoop: loop }),
  setCompactTrajectoryFps: (fps) => set((s) => s.compactTrajectory
    ? { compactTrajectory: { ...s.compactTrajectory, trajFps: Math.max(1, Math.min(120, fps)) } }
    : {}),
  // Set the display frame optimistically so the (controlled) trajectory-bar slider
  // follows the drag immediately instead of snapping back while the seek is applied.
  requestCompactTrajectorySeek: (frame) => set({ compactTrajectorySeek: frame, compactTrajectoryDisplayFrame: frame, focusAtoms: [] }),
  clearCompactTrajectorySeek: () => set({ compactTrajectorySeek: null }),
  setCompactTrajectoryDisplayFrame: (frame) => set({ compactTrajectoryDisplayFrame: frame }),
  regionSeeds: null,
  setRegionSeeds: (seeds) => set({ regionSeeds: seeds }),
  showRegionSolids: false,
  hideAtomsInRegionView: false,
  regionOpacity: 0.35,
  regionGeometryMode: 'auto' as const,
  regionHideMajority: true,
  setShowRegionSolids: (show) => set({ showRegionSolids: show }),
  setHideAtomsInRegionView: (hide) => set({ hideAtomsInRegionView: hide }),
  setRegionOpacity: (opacity) => set({ regionOpacity: opacity }),
  setRegionGeometryMode: (mode) => set({ regionGeometryMode: mode }),
  setRegionHideMajority: (hide) => set({ regionHideMajority: hide }),
})
