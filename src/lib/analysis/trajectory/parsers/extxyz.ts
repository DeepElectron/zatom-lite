/**
 * Extended-XYZ parser that delegates to the existing XYZ parser, then
 * harvests per-frame metadata (energy, forces, temperature, stress) from
 * the comment line of each frame.
 *
 * Conventions recognized:
 *   energy=...    or  E=...         (eV)
 *   free_energy=... or pbe_energy=...
 *   stress="sxx sxy sxz syx syy syz szx szy szz"
 *   step=...      or  i=...
 *   temperature=... or T=...        (K)
 */

import { parseXYZ } from '../../../crystal/xyz-parser'
import type { ParsedTrajectory, ParseResult, TrajectoryFrameMetadata } from '../types'

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/

function extract(text: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const re = new RegExp(`\\b${key}\\s*=\\s*(${NUMBER.source})`, 'i')
    const match = text.match(re)
    if (match) {
      const v = parseFloat(match[1])
      if (!isNaN(v)) return v
    }
  }
  return undefined
}

function extractStressTrace(text: string): number | undefined {
  // stress="..." with 9 numbers
  const m = text.match(/stress\s*=\s*"([^"]+)"/i)
  if (!m) return undefined
  const nums = m[1].trim().split(/\s+/).map(Number)
  if (nums.length < 9 || nums.some(isNaN)) return undefined
  // Pressure (kBar convention) = -tr(σ)/3, but raw trace in eV/Å³ is more useful as a signal.
  return (nums[0] + nums[4] + nums[8]) / 3
}

export function parseExtxyz(content: string, filename?: string): ParseResult {
  const result = parseXYZ(content)
  if (!result.success) return { success: false, error: result.error }

  const frames = result.data.frames
  let hasEnergy = false
  let hasStress = false

  const metadata: TrajectoryFrameMetadata[] = frames.map((frame, idx) => {
    const meta: TrajectoryFrameMetadata = { frame: idx + 1, step: idx + 1 }
    const comment = frame.comment ?? ''
    const energy = extract(comment, ['energy', 'free_energy', 'pbe_energy', 'E'])
    if (energy !== undefined) {
      meta.energy = energy
      hasEnergy = true
    }
    const temperature = extract(comment, ['temperature', 'T'])
    if (temperature !== undefined) meta.temperature = temperature
    const step = extract(comment, ['step', 'i'])
    if (step !== undefined) meta.step = step
    const stressTrace = extractStressTrace(comment)
    if (stressTrace !== undefined) {
      meta.pressure = -stressTrace * 1602.176 // eV/Å³ → kBar (very rough; matches sign convention)
      hasStress = true
    }
    return meta
  })

  const data: ParsedTrajectory = {
    format: 'extxyz',
    frames,
    metadata,
    source: filename,
    stats: {
      has_energy: hasEnergy,
      has_forces: false,
      has_stress: hasStress,
      constant_atom_count: frames.every((f) => f.atoms.length === frames[0].atoms.length),
    },
  }
  return { success: true, data }
}
