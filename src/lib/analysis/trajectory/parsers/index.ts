import type { ParseResult, TrajectoryFormat } from '../types'
import { isAseTraj, parseAseTraj } from './ase-traj'
import { parseExtxyz } from './extxyz'
import { parseGaussianOutput } from './gaussian'
import { parseLammpsDump } from './lammps-dump'
import { parsePmgJson } from './pmg-json'
import { parseXdatcar } from './xdatcar'

export { isAseTraj, parseAseTraj, parseExtxyz, parseGaussianOutput, parseLammpsDump, parsePmgJson, parseXdatcar }

export function detectFormat(content: string, filename?: string): TrajectoryFormat {
  const name = (filename ?? '').toLowerCase()
  const head = content.slice(0, 4000)

  if (name.endsWith('.json') || /^\s*[{[]/.test(head)) return 'pmg_json'
  if (name.includes('xdatcar') || /Direct\s+configuration/i.test(head)) return 'vasp_xdatcar'
  if (/^ITEM:\s+TIMESTEP/m.test(head) || name.endsWith('.dump') || name.endsWith('.lammpstrj')) {
    return 'lammps_dump'
  }
  if (/Gaussian, Inc\.|Entering Link 1 =/.test(head) || /Standard orientation:|Input orientation:/.test(head)) {
    return 'gaussian'
  }
  if (name.endsWith('.log') || name.endsWith('.out')) {
    // Gaussian outputs often live under .log/.out — only claim them if the
    // content has Gaussian markers (handled above); otherwise leave unknown.
    return 'unknown'
  }
  if (name.endsWith('.xyz') || name.endsWith('.extxyz') || name.endsWith('.exyz')) return 'extxyz'
  // Heuristic for extended XYZ: first line is an integer (atom count).
  const firstLine = head.split(/\r?\n/, 1)[0]?.trim()
  if (firstLine && /^\d+$/.test(firstLine)) return 'extxyz'
  return 'unknown'
}

/** Detect binary formats from an ArrayBuffer prefix. */
export function detectBinaryFormat(buffer: ArrayBuffer, filename?: string): TrajectoryFormat {
  if (isAseTraj(buffer)) return 'ase_traj'
  const name = (filename ?? '').toLowerCase()
  if (name.endsWith('.traj')) return 'ase_traj'
  return 'unknown'
}

export function parseTrajectory(content: string, filename?: string, hint?: TrajectoryFormat): ParseResult {
  const format = hint && hint !== 'unknown' ? hint : detectFormat(content, filename)
  switch (format) {
    case 'extxyz':
      return parseExtxyz(content, filename)
    case 'vasp_xdatcar':
      return parseXdatcar(content, filename)
    case 'lammps_dump':
      return parseLammpsDump(content, filename)
    case 'pmg_json':
      return parsePmgJson(content, filename)
    case 'gaussian':
      return parseGaussianOutput(content, filename)
    case 'ase_traj':
      return { success: false, error: 'ASE .traj is binary; pass the ArrayBuffer to parseAseTraj instead' }
    default:
      return { success: false, error: `Unrecognized trajectory format for "${filename ?? 'input'}"` }
  }
}
