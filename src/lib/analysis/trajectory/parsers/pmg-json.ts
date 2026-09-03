/**
 * pymatgen `Trajectory` JSON parser.
 *
 * Two flavors are common in the wild:
 *   1. ASE-style: { species: [...], positions: [[...]], lattice?: [[...]],
 *      energies?: [...], forces?: [[...]] }
 *   2. pymatgen Trajectory: { @class: "Trajectory", species_list, frame_properties,
 *      coords (or coords_list), lattice }
 *
 * We detect by inspecting keys; if neither matches, error out.
 */

import type { XYZAtom, XYZFrame } from '../../../crystal/xyz-parser'
import type { ParseResult, TrajectoryFrameMetadata } from '../types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

interface AseLikeJson {
  species: string[]
  positions: number[][][] | number[][]
  lattice?: number[][] | number[][][]
  energies?: number[]
  forces?: number[][][]
}

interface PmgTrajectoryJson {
  '@class'?: string
  species?: string[] | Array<{ element: string }>
  species_list?: string[]
  coords?: number[][][]
  coords_list?: number[][][]
  lattice?: number[][][] | number[][]
  frame_properties?: Array<Record<string, number>>
}

function rmsForce(forces: number[][]): { rms: number; max: number } {
  let sum = 0
  let max = 0
  for (const f of forces) {
    const f2 = f[0] * f[0] + f[1] * f[1] + f[2] * f[2]
    sum += f2
    const mag = Math.sqrt(f2)
    if (mag > max) max = mag
  }
  return { rms: Math.sqrt(sum / Math.max(1, forces.length)), max }
}

function buildFrame(
  species: string[],
  positions: number[][],
  lattice: Mat3 | null,
  frameIdx: number,
): XYZFrame {
  const atoms: XYZAtom[] = species.map((element, i) => ({
    id: `pmg-${frameIdx}-${i}`,
    element,
    position: lattice ? (positions[i] as Vec3) : [0, 0, 0],
    cartesian: positions[i] as Vec3,
  }))
  const frame: XYZFrame = {
    atoms,
    comment: `pymatgen frame ${frameIdx + 1}`,
  }
  if (lattice) {
    frame.latticeVectors = { a: lattice[0], b: lattice[1], c: lattice[2] }
  }
  return frame
}

function as3x3(matrix: number[][]): Mat3 {
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ]
}

export function parsePmgJson(content: string, filename?: string): ParseResult {
  let payload: unknown
  try {
    payload = JSON.parse(content)
  } catch (err) {
    return { success: false, error: `JSON parse: ${err instanceof Error ? err.message : 'invalid JSON'}` }
  }
  if (!payload || typeof payload !== 'object') {
    return { success: false, error: 'JSON root is not an object' }
  }

  const obj = payload as Record<string, unknown>

  // Try ASE-like
  if (Array.isArray(obj.species) && Array.isArray(obj.positions)) {
    const ase = payload as unknown as AseLikeJson
    const species = ase.species
    // positions can be number[frames][atoms][3] or number[atoms][3] for single frame
    const isMulti = Array.isArray((ase.positions as unknown[])[0]) && Array.isArray((ase.positions as number[][])[0]?.[0])
    const positionsList = isMulti
      ? (ase.positions as number[][][])
      : [ase.positions as number[][]]

    const lattices = (() => {
      if (!ase.lattice) return null
      const isMultiLat = Array.isArray((ase.lattice as unknown[])[0]) && Array.isArray((ase.lattice as number[][])[0]?.[0])
      if (isMultiLat) return ase.lattice as number[][][]
      return Array(positionsList.length).fill(ase.lattice as number[][])
    })()

    const frames: XYZFrame[] = []
    const metadata: TrajectoryFrameMetadata[] = []
    for (let i = 0; i < positionsList.length; i++) {
      const lat = lattices ? as3x3(lattices[i]) : null
      frames.push(buildFrame(species, positionsList[i], lat, i))
      const meta: TrajectoryFrameMetadata = { frame: i + 1, step: i + 1 }
      if (ase.energies?.[i] !== undefined) meta.energy = ase.energies[i]
      if (ase.forces?.[i]) {
        const { rms, max } = rmsForce(ase.forces[i])
        meta.rms_force = rms
        meta.max_force = max
      }
      metadata.push(meta)
    }
    return {
      success: true,
      data: {
        format: 'pmg_json',
        frames,
        metadata,
        source: filename,
        stats: {
          has_energy: !!ase.energies?.length,
          has_forces: !!ase.forces?.length,
          has_stress: false,
          constant_atom_count: true,
        },
      },
    }
  }

  // Try pymatgen Trajectory
  const pmg = obj as PmgTrajectoryJson
  const speciesArr = pmg.species_list ?? pmg.species
  const coords = pmg.coords ?? pmg.coords_list
  if (speciesArr && Array.isArray(coords)) {
    const species = (speciesArr as Array<string | { element: string }>).map((s) =>
      typeof s === 'string' ? s : s.element,
    )
    const lattices = pmg.lattice ? (() => {
      const isMultiLat = Array.isArray((pmg.lattice as unknown[])[0]) && Array.isArray((pmg.lattice as number[][])[0]?.[0])
      if (isMultiLat) return pmg.lattice as number[][][]
      return Array(coords.length).fill(pmg.lattice as number[][])
    })() : null
    const frames: XYZFrame[] = []
    const metadata: TrajectoryFrameMetadata[] = []
    for (let i = 0; i < coords.length; i++) {
      const lat = lattices ? as3x3(lattices[i]) : null
      frames.push(buildFrame(species, coords[i], lat, i))
      const meta: TrajectoryFrameMetadata = { frame: i + 1, step: i + 1 }
      const fp = pmg.frame_properties?.[i]
      if (fp) {
        if (typeof fp.energy === 'number') meta.energy = fp.energy
        if (typeof fp.temperature === 'number') meta.temperature = fp.temperature
        if (typeof fp.pressure === 'number') meta.pressure = fp.pressure
      }
      metadata.push(meta)
    }
    return {
      success: true,
      data: {
        format: 'pmg_json',
        frames,
        metadata,
        source: filename,
        stats: {
          has_energy: pmg.frame_properties?.some((p) => typeof p.energy === 'number') ?? false,
          has_forces: false,
          has_stress: false,
          constant_atom_count: true,
        },
      },
    }
  }

  return { success: false, error: 'Unrecognised JSON trajectory schema (need species + positions or @class:Trajectory)' }
}
