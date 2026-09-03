import type { XYZFrame } from '../../crystal/xyz-parser'

export type TrajectoryFormat =
  | 'extxyz'
  | 'vasp_xdatcar'
  | 'lammps_dump'
  | 'pmg_json'
  | 'gaussian'
  | 'ase_traj'
  | 'zatom_agent'
  | 'unknown'

export interface TrajectoryFrameMetadata {
  /** 1-based frame index. */
  frame: number
  /** Step number reported by the source file (may equal frame). */
  step: number
  /** Total potential energy in eV (if reported). */
  energy?: number
  /** Root-mean-square force across all atoms in eV/Å (if forces are reported). */
  rms_force?: number
  /** Maximum atomic force magnitude in eV/Å. */
  max_force?: number
  /** Trace of the stress tensor in kBar (if reported). */
  pressure?: number
  /** Cell volume in Å³ (if a lattice is present). */
  volume?: number
  /** Temperature in K (MD trajectories). */
  temperature?: number
  /** Anything format-specific the parser wants to surface in the UI. */
  extra?: Record<string, number | string>
}

export interface ParsedTrajectory {
  format: TrajectoryFormat
  frames: XYZFrame[]
  metadata: TrajectoryFrameMetadata[]
  /** Filename (without path) the trajectory came from. */
  source?: string
  /** Per-trajectory summary stats — fastest if the parser fills them. */
  stats?: {
    has_energy: boolean
    has_forces: boolean
    has_stress: boolean
    constant_atom_count: boolean
  }
}

export type ParseResult =
  | { success: true; data: ParsedTrajectory }
  | { success: false; error: string }
