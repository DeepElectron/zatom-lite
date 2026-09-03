/** Select a minimal content-aware initial presentation without mutating state. */

import { WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD } from '../performance/adaptive-performance'
import type { BioColorScheme, BioStructure } from './types'

export interface AdaptiveBioPresentation {
  bioColorScheme: BioColorScheme
  bioShowSticks: boolean
}

export function adaptiveBioPresentation(structure: BioStructure): AdaptiveBioPresentation {
  // Ligand, ion, and water containers do not participate in cartoon coloring.
  const polymerChains = structure.chains.filter((chain) => chain.polymerType !== 'other')
  const nucleicChains = polymerChains.filter((chain) => chain.polymerType === 'nucleic')

  return {
    /**
    * Confidence coloring takes precedence for predicted structures. Otherwise,
    * multichain structures use distinct chain colors; a per-chain sequence
    * gradient would assign nearly identical colors to every subunit.
    */
    bioColorScheme: structure.bFactorSemantics === 'plddt'
      ? 'plddt'
      : polymerChains.length > 1 ? 'chain-publication' : 'viridis',

    /**
    * Add sticks for reasonably sized, nucleic-acid-only structures so bases and
    * pairing remain visible. Mixed protein complexes and very large RNA systems
    * retain the cheaper cartoon default.
    */
    bioShowSticks: nucleicChains.length > 0
      && nucleicChains.length === polymerChains.length
      && structure.atoms.length <= WIDE_VIEWPORT_MASSIVE_SCENE_ATOM_THRESHOLD,
  }
}
