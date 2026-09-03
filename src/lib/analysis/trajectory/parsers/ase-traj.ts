/**
 * ASE binary .traj reader — limited scope.
 *
 * ASE's .traj uses the ULM (Universal Linear Memory) format with magic
 * `- of Ulm\0\0\0\n` at byte offset 0. Full ULM support requires parsing
 * pickle-like dict streams, which is too involved for a first cut.
 *
 * For now we detect the magic so the UI can show a clear "convert to extxyz
 * first" hint instead of silently failing. Production support will likely
 * route through a small backend converter (`POST /api/convert-traj`) once
 * the surface stabilises.
 */

import type { ParseResult } from '../types'

const ASE_ULM_MAGIC = new Uint8Array([0x2d, 0x20, 0x6f, 0x66, 0x20, 0x55, 0x6c, 0x6d]) // "- of Ulm"

export function isAseTraj(data: ArrayBuffer): boolean {
  if (data.byteLength < ASE_ULM_MAGIC.length) return false
  const head = new Uint8Array(data, 0, ASE_ULM_MAGIC.length)
  for (let i = 0; i < ASE_ULM_MAGIC.length; i++) {
    if (head[i] !== ASE_ULM_MAGIC[i]) return false
  }
  return true
}

export function parseAseTraj(data: ArrayBuffer, _filename?: string): ParseResult {
  if (!isAseTraj(data)) {
    return { success: false, error: 'Not an ASE .traj file (wrong ULM magic)' }
  }
  return {
    success: false,
    error:
      'ASE .traj is recognised but binary parsing is not yet implemented in-browser. ' +
      'Convert to extxyz with `ase convert traj.traj traj.xyz` and re-load.',
  }
}
