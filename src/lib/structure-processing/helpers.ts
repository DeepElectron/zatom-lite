/**
 * Lightweight assistance related to Structure-processing progress bar.
 *
 * Extracted from the top 4 helpers + 3 constants + 1 idle state of crystalStore.ts. 36 places in store
 * reference, external 0 reference. Moving it out is mainly to reduce the surface area of ​​the main store file.
 *
 * Threshold purpose (structureProcessing overlay trigger condition):
 * - Text bytes exceeded LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD: show progress during parsing
 * - atom count exceeds LARGE_STRUCTURE_ATOM_PROGRESS_THRESHOLD: during supercell expansion
 * Show progress
 */

import type { Atom, SupercellParams } from '../crystal/types'

export interface StructureProcessingState {
  active: boolean
  title: string
  step: string
  progress: number
  detail: string | null
}

export const LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD = 120_000
export const LARGE_STRUCTURE_ATOM_PROGRESS_THRESHOLD = 4_000

export const idleStructureProcessingState: StructureProcessingState = {
  active: false,
  title: '',
  step: '',
  progress: 0,
  detail: null,
}

export function shouldShowStructureProcessingForText(content: string): boolean {
  return content.length >= LARGE_STRUCTURE_TEXT_PROGRESS_THRESHOLD
}

export function shouldShowStructureProcessingForAtomCount(atomCount: number): boolean {
  return atomCount >= LARGE_STRUCTURE_ATOM_PROGRESS_THRESHOLD
}

export function estimateSupercellAtomCount(unitCellAtoms: Atom[], params: SupercellParams): number {
  return unitCellAtoms.length * params.nx * params.ny * params.nz
}

/**
 * Let the browser insert paint between two store writes. With structureProcessing overlay
 * Use: setStructureProcessing(...) first to push the progress up, await this, and then start again.
 * Users can actually see progress changes (otherwise the synchronization task will cause React batch to skip intermediate frames).
 */
export function nextStructureProcessingPaint(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}
