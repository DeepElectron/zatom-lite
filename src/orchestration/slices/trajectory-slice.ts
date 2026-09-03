/**
 * trajectory-slice -- State and actions for multi-frame XYZ trajectory playback.
 *
 * Actions read atoms, latticeVectors, bondSettings, and other state across slices. They write
 * trajectory fields plus atoms and bonds, which are recomputed on each frame change.
 */

import type { StateCreator } from 'zustand'
import { recomputeBonds } from '../recompute-bonds'
import { cartesianToFractional } from '../../lib/crystal/lattice'
import type { XYZFrame } from '../../lib/crystal/xyz-parser'
import type {
  TrajectoryFormat,
  TrajectoryFrameMetadata,
} from '../../lib/analysis/trajectory'
import type { CrystalStore } from '../crystal-store-types'

function latticeParameters(vectors: NonNullable<XYZFrame['latticeVectors']>) {
  const length = (vector: [number, number, number]) => Math.hypot(...vector)
  const dot = (left: [number, number, number], right: [number, number, number]) => (
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  )
  const angle = (left: [number, number, number], right: [number, number, number]) => {
    const cosine = Math.max(-1, Math.min(1, dot(left, right) / (length(left) * length(right))))
    return Math.acos(cosine) * 180 / Math.PI
  }
  return {
    a: length(vectors.a),
    b: length(vectors.b),
    c: length(vectors.c),
    alpha: angle(vectors.b, vectors.c),
    beta: angle(vectors.a, vectors.c),
    gamma: angle(vectors.a, vectors.b),
  }
}

export interface TrajectorySlice {
  trajectoryFrames: XYZFrame[] | null
  trajectoryCurrentFrame: number
  trajectoryTotalFrames: number
  trajectoryPlaying: boolean
  trajectoryIntervalId: ReturnType<typeof setInterval> | null
  /** Playback speed in frames per second; 10 fps advances every 100 ms. */
  trajectoryFps: number
  /** Source format ("VASP XDATCAR" / "LAMMPS dump" / …) populated by unified-file-import. */
  trajectoryFormatLabel: string | null
  /** Machine-readable format key for the badge color / icon (same source). */
  trajectoryFormatKind: TrajectoryFormat | null
  /** Canonical coordinate convention for zatom Agent trajectory handoff. */
  trajectoryCoordinateMode: 'cartesian' | 'unwrapped-cartesian' | null
  /** Whether zatom Agent trajectory lattice evidence is absent, fixed, or frame-varying. */
  trajectoryLatticeMode: 'none' | 'fixed' | 'per-frame' | null
  /** Per-frame energy / forces / pressure / T if the parser harvested them. */
  trajectoryMetadata: TrajectoryFrameMetadata[]
  /** Install a frame into the render mirrors without editing the source trajectory/document. */
  setTrajectoryFrame: (frame: number) => void
  playTrajectory: () => void
  pauseTrajectory: () => void
  nextFrame: () => void
  prevFrame: () => void
  clearTrajectory: () => void
  setTrajectoryFps: (fps: number) => void
}

export const createTrajectorySlice: StateCreator<CrystalStore, [], [], TrajectorySlice> = (set, get) => ({
  trajectoryFrames: null,
  trajectoryCurrentFrame: 0,
  trajectoryTotalFrames: 0,
  trajectoryPlaying: false,
  trajectoryIntervalId: null,
  trajectoryFps: 10,
  trajectoryFormatLabel: null,
  trajectoryFormatKind: null,
  trajectoryCoordinateMode: null,
  trajectoryLatticeMode: null,
  trajectoryMetadata: [],

  setTrajectoryFrame: (frame) => {
    const { trajectoryFrames, atoms, latticeVectors, bondSettings } = get()
    if (!trajectoryFrames || frame < 0 || frame >= trajectoryFrames.length) return

    const frameData = trajectoryFrames[frame]
    const activeLatticeVectors = frameData.latticeVectors ?? latticeVectors

    // Update atom positions from frame data
    const updatedAtoms = atoms.map((atom, index) => {
      if (index < frameData.atoms.length) {
        const frameAtom = frameData.atoms[index]
        const stableProps = Object.fromEntries(Object.entries(atom.props ?? {}).filter(([key]) => (
          key !== 'velocityAperPs' && key !== 'forceEvPerA'
        )))
        return {
          ...atom,
          cartesian: frameAtom.cartesian,
          ...(frameData.latticeVectors ? {
            position: cartesianToFractional(frameAtom.cartesian, activeLatticeVectors),
          } : {}),
          // Keep stable structure metadata/topology markers while replacing
          // frame-varying auxiliary values such as velocity and force.
          props: { ...stableProps, ...(frameAtom.props ?? {}) },
        }
      }
      return atom
    })

    // Recalculate bonds based on new atomic positions for this frame
    const explicitTopology = atoms.some((atom) => {
      const marker = atom.props?.['zatom.explicitBondTopology']
      return marker?.kind === 'scalar' && marker.value === 1
    })
    const newBonds = explicitTopology
      ? get().bonds
      : recomputeBonds(get(), {
        atoms: updatedAtoms,
        latticeVectors: activeLatticeVectors,
        bondSettings,
      })

    set({
      atoms: updatedAtoms,
      bonds: newBonds,
      trajectoryCurrentFrame: frame,
      ...(frameData.latticeVectors ? {
        periodic: true,
        latticeVectors: frameData.latticeVectors,
        latticeParams: latticeParameters(frameData.latticeVectors),
        ...(get().unitCellAtoms.length === updatedAtoms.length ? { unitCellAtoms: updatedAtoms } : {}),
      } : {}),
    })
    // This action only changes render mirrors. In particular, do not call
    // syncBiomoleculeCoordinates here: that action commits an explicit edit to
    // the canonical BioStructure and its active MODEL frame.
  },

  playTrajectory: () => {
    // PDB MODEL ensembles share the presentation playhead with camera/style.
    // Keep this guard at the state boundary so no caller can create a
    // second interval behind the canonical presentation timer.
    if (get().bioStructure) {
      get().playPresentation()
      return
    }
    const { trajectoryFrames, trajectoryPlaying, trajectoryIntervalId } = get()
    if (!trajectoryFrames || trajectoryPlaying) return

    if (trajectoryIntervalId) {
      clearInterval(trajectoryIntervalId)
    }

    const { trajectoryFps } = get()
    const period = Math.max(16, Math.round(1000 / Math.max(1, trajectoryFps)))
    const intervalId = setInterval(() => {
      const { trajectoryCurrentFrame, trajectoryTotalFrames } = get()
      const nextFrame = (trajectoryCurrentFrame + 1) % trajectoryTotalFrames
      get().setTrajectoryFrame(nextFrame)
    }, period)

    set({
      trajectoryPlaying: true,
      trajectoryIntervalId: intervalId,
    })
  },

  pauseTrajectory: () => {
    const { trajectoryIntervalId } = get()
    if (trajectoryIntervalId) {
      clearInterval(trajectoryIntervalId)
    }
    set({
      trajectoryPlaying: false,
      trajectoryIntervalId: null,
    })
  },

  nextFrame: () => {
    const { trajectoryCurrentFrame, trajectoryTotalFrames } = get()
    if (trajectoryTotalFrames === 0) return
    const nextFrame = (trajectoryCurrentFrame + 1) % trajectoryTotalFrames
    get().setTrajectoryFrame(nextFrame)
  },

  prevFrame: () => {
    const { trajectoryCurrentFrame, trajectoryTotalFrames } = get()
    if (trajectoryTotalFrames === 0) return
    const prevFrame = (trajectoryCurrentFrame - 1 + trajectoryTotalFrames) % trajectoryTotalFrames
    get().setTrajectoryFrame(prevFrame)
  },

  clearTrajectory: () => {
    const { trajectoryIntervalId } = get()
    if (trajectoryIntervalId) {
      clearInterval(trajectoryIntervalId)
    }
    set({
      trajectoryFrames: null,
      trajectoryCurrentFrame: 0,
      trajectoryTotalFrames: 0,
      trajectoryPlaying: false,
      trajectoryIntervalId: null,
      trajectoryFormatLabel: null,
      trajectoryFormatKind: null,
      trajectoryCoordinateMode: null,
      trajectoryLatticeMode: null,
      trajectoryMetadata: [],
    })
  },

  setTrajectoryFps: (fps) => {
    if (!Number.isFinite(fps)) return
    const clamped = Math.max(1, Math.min(120, Math.round(fps)))
    const { trajectoryIntervalId, trajectoryPlaying } = get()
    if (trajectoryPlaying && trajectoryIntervalId) {
      clearInterval(trajectoryIntervalId)
      const period = Math.max(16, Math.round(1000 / clamped))
      const newId = setInterval(() => {
        const { trajectoryCurrentFrame, trajectoryTotalFrames } = get()
        const nextFrame = (trajectoryCurrentFrame + 1) % trajectoryTotalFrames
        get().setTrajectoryFrame(nextFrame)
      }, period)
      set({ trajectoryFps: clamped, trajectoryIntervalId: newId })
    } else {
      set({ trajectoryFps: clamped })
    }
  },
})
