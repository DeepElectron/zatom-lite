/**
 * Gaussian .log / .out parser.
 *
 * Captures every "Standard orientation:" (preferred) or "Input orientation:"
 * block as a trajectory frame; harvests "SCF Done" energies (Hartrees) and
 * imaginary mode counts where available. Forces blocks ("Forces (Hartrees/
 * Bohr)") are detected and turned into RMS / max force metadata.
 *
 * Format reference: Gaussian 16 output (`gauss/source/util/oucal.f`).
 *   Center     Atomic      Atomic             Coordinates (Angstroms)
 *   Number     Number       Type             X           Y           Z
 *   ----------------------------------------------------------------
 *     1          6           0        0.000000    0.000000    0.000000
 */

import type { XYZAtom, XYZFrame } from '../../../crystal/xyz-parser'
import { atomicNumberToSymbol } from '../../../../chemistry/periodic-table'
import type { ParseResult, TrajectoryFrameMetadata } from '../types'

const HARTREE_TO_EV = 27.211386245988

interface RawFrame {
  atoms: Array<{ z: number; x: number; y: number; z_coord: number }>
  energyHa?: number
  forces?: Array<[number, number, number]>
}

function parseFrameBlock(lines: string[], startIndex: number): { atoms: RawFrame['atoms']; nextIndex: number } | null {
  // Find dashes separator (typically 4 lines after the orientation header).
  let cursor = startIndex
  // Skip the orientation header line + 4 header/border lines, looking for the
  // first all-dashes line.
  let dashCount = 0
  while (cursor < lines.length && dashCount < 2) {
    if (/^\s*-{10,}\s*$/.test(lines[cursor])) dashCount++
    cursor++
  }
  if (dashCount < 2) return null

  // Read atom rows until next dashes.
  const atoms: RawFrame['atoms'] = []
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (/^\s*-{10,}\s*$/.test(line)) break
    const parts = line.trim().split(/\s+/).map(Number)
    if (parts.length >= 6 && !parts.some((v, i) => i !== 2 && Number.isNaN(v))) {
      atoms.push({
        z: parts[1],
        x: parts[3],
        y: parts[4],
        z_coord: parts[5],
      })
    }
    cursor++
  }
  if (atoms.length === 0) return null
  return { atoms, nextIndex: cursor }
}

function parseForcesBlock(lines: string[], startIndex: number, expectedCount: number): Array<[number, number, number]> | null {
  // Skip header lines until we find atom rows starting with " <num> <z> ..."
  let cursor = startIndex
  let dashes = 0
  while (cursor < lines.length && dashes < 2) {
    if (/^\s*-{10,}\s*$/.test(lines[cursor])) dashes++
    cursor++
  }
  if (dashes < 2) return null
  const forces: Array<[number, number, number]> = []
  while (cursor < lines.length && forces.length < expectedCount) {
    const line = lines[cursor]
    if (/^\s*-{10,}\s*$/.test(line)) break
    const parts = line.trim().split(/\s+/).map(Number)
    if (parts.length >= 5 && !parts.some(Number.isNaN)) {
      // columns: Center Number, AtomicNumber, Fx, Fy, Fz (Hartrees/Bohr)
      forces.push([parts[2], parts[3], parts[4]])
    }
    cursor++
  }
  return forces.length === expectedCount ? forces : null
}

export function parseGaussianOutput(content: string, filename?: string): ParseResult {
  try {
    const lines = content.split(/\r?\n/)
    const rawFrames: RawFrame[] = []
    let pendingEnergyHa: number | undefined
    let frameForces: Array<[number, number, number]> | undefined

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Capture energy ahead of the next orientation block — Gaussian prints
      // "SCF Done" before the next geometry update during opt steps.
      const scfMatch = line.match(/SCF Done:\s+E\([^)]+\)\s*=\s*([-+]?\d+\.\d+)/)
      if (scfMatch) {
        pendingEnergyHa = parseFloat(scfMatch[1])
        continue
      }
      // Forces block precedes the next orientation for opt steps too.
      if (/Forces \(Hartrees\/Bohr\)/.test(line)) {
        // We don't yet know N; defer parsing by recording the start index and
        // re-parse after we read the next frame's atom count.
        const startIdx = i
        // Look ahead modestly to find the next orientation block.
        for (let j = i + 1; j < Math.min(i + 5000, lines.length); j++) {
          if (/Standard orientation:|Input orientation:/.test(lines[j])) {
            // We'll parse forces here once frame parsed and known count.
            const probe = parseFrameBlock(lines, j)
            if (probe) {
              frameForces = parseForcesBlock(lines, startIdx, probe.atoms.length) ?? undefined
            }
            break
          }
        }
        continue
      }
      if (/Standard orientation:|Input orientation:/.test(line)) {
        const result = parseFrameBlock(lines, i)
        if (!result) continue
        rawFrames.push({
          atoms: result.atoms,
          energyHa: pendingEnergyHa,
          forces: frameForces,
        })
        pendingEnergyHa = undefined
        frameForces = undefined
        i = result.nextIndex - 1
      }
    }

    if (rawFrames.length === 0) {
      return { success: false, error: 'No "Standard orientation" / "Input orientation" blocks found' }
    }

    const frames: XYZFrame[] = []
    const metadata: TrajectoryFrameMetadata[] = []
    let hasEnergy = false
    let hasForces = false

    for (let idx = 0; idx < rawFrames.length; idx++) {
      const rf = rawFrames[idx]
      const atoms: XYZAtom[] = rf.atoms.map((a, i) => ({
        id: `gaussian-${idx}-${i}`,
        element: atomicNumberToSymbol(a.z) ?? `Z${a.z}`,
        position: [0, 0, 0],
        cartesian: [a.x, a.y, a.z_coord],
      }))
      frames.push({
        atoms,
        comment: `Gaussian frame ${idx + 1}${rf.energyHa !== undefined ? ` E=${rf.energyHa.toFixed(6)} Ha` : ''}`,
      })
      const meta: TrajectoryFrameMetadata = { frame: idx + 1, step: idx + 1 }
      if (rf.energyHa !== undefined) {
        meta.energy = rf.energyHa * HARTREE_TO_EV
        hasEnergy = true
      }
      if (rf.forces && rf.forces.length === atoms.length) {
        hasForces = true
        let sum = 0
        let maxF = 0
        for (const f of rf.forces) {
          const f2 = f[0] * f[0] + f[1] * f[1] + f[2] * f[2]
          sum += f2
          const mag = Math.sqrt(f2)
          if (mag > maxF) maxF = mag
        }
        // Convert Hartree/Bohr → eV/Å for consistency with VASP forces.
        const HaBohr_to_eVA = HARTREE_TO_EV / 0.529177210903
        meta.rms_force = Math.sqrt(sum / rf.forces.length) * HaBohr_to_eVA
        meta.max_force = maxF * HaBohr_to_eVA
      }
      metadata.push(meta)
    }

    return {
      success: true,
      data: {
        format: 'gaussian',
        frames,
        metadata,
        source: filename,
        stats: {
          has_energy: hasEnergy,
          has_forces: hasForces,
          has_stress: false,
          constant_atom_count: frames.every((f) => f.atoms.length === frames[0].atoms.length),
        },
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Gaussian parse failed' }
  }
}
