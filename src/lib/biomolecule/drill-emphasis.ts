/** Pure, scale-aware visual emphasis decisions for hierarchy drill-down. */

import * as THREE from 'three'
import type { LadderLevel } from './structure-ladder'
import type { BioRepresentation } from './types'

export interface DrillEmphasis {
  /** Fade nonfocused colors while leaving focused geometry untouched. */
  fadeOthers: boolean
  /** Optional atom-level overlay for the focused region. */
  overlay: Exclude<BioRepresentation, 'cartoon' | 'surface' | 'coordination-polyhedra'> | null
  /** Show a parent-space anchor only at residue and atom scale. */
  spatialAnchor: boolean
}

/** Preserve the normal presentation. */
const NONE: DrillEmphasis = { fadeOthers: false, overlay: null, spatialAnchor: false }

/** Fade nonfocused structure without adding expensive atom geometry. */
const FADE_ONLY: DrillEmphasis = { fadeOthers: true, overlay: null, spatialAnchor: false }

/** At residue/atom scale, add CPK ball-and-stick to expose atomic identity. */
const BALL_AND_STICK: DrillEmphasis = { fadeOthers: true, overlay: 'ball-and-stick', spatialAnchor: true }

export function drillEmphasisForLevel(level: LadderLevel | null): DrillEmphasis {
  switch (level) {
    // No active drill-down.
    case null:
      return NONE
    // Assembly focus already includes the whole structure.
    case 'assembly':
      return NONE
    case 'chain':
    case 'element':
      return FADE_ONLY
    case 'residue':
    case 'atom':
      return BALL_AND_STICK
  }
}

/**
 * Blend nonfocused colors toward the actual viewport background. This remains
 * recessive in both light and dark themes, unlike a fixed gray.
 * @param keep Fraction of original color retained by nonfocused items.
 */
export function fadeUnfocusedColors(
  colors: readonly string[],
  background: string,
  keep: number,
  isFocused: (index: number) => boolean,
): string[] {
  const target = new THREE.Color(background)
  const scratch = new THREE.Color()
  return colors.map((color, index) => (
    isFocused(index) ? color : scratch.set(color).lerp(target, 1 - keep).getStyle()
  ))
}
