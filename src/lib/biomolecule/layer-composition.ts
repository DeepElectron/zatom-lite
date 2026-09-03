import { evaluateBioSelection } from './selection'
import { evaluateBioVisibility } from './style-track'
import type { BioLayer, BioStructure } from './types'

export interface BioLayerCompositionPlan {
  /** Atoms each layer actually draws (empty for hidden layers). */
  layerAtomIndices: ReadonlyMap<string, ReadonlySet<number>>
  /** Residues each layer actually draws, for cartoon and residue-derived geometry. */
  layerResidueIndices: ReadonlyMap<string, ReadonlySet<number>>
  /** Atoms owned by layers, including hidden layers, for built-in-pass exclusion. */
  claimedAtomIndices: ReadonlySet<number>
  /** Residues owned by layers for built-in cartoon exclusion. */
  claimedResidueIndices: ReadonlySet<number>
}

/**
 * Biological semantic layers are assignments, not duplicate content passes.
 * The first visible layer in editor order owns every overlapping atom/residue;
 * moving a layer therefore has an immediate, deterministic visual meaning.
 */
export function resolveBioLayerComposition(
  structure: BioStructure,
  layers: readonly BioLayer[],
  frame: number,
): BioLayerCompositionPlan {
  const claimedAtoms = new Set<number>()
  const claimedResidues = new Set<number>()
  const layerAtomIndices = new Map<string, ReadonlySet<number>>()
  const layerResidueIndices = new Map<string, ReadonlySet<number>>()

  for (const layer of layers) {
    const selection = evaluateBioSelection(structure, layer.selection)
    // An unresolved selection claims nothing, leaving the built-in pass intact.
    if (selection.error) {
      layerAtomIndices.set(layer.id, new Set())
      layerResidueIndices.set(layer.id, new Set())
      continue
    }
    // Hidden layers still claim content so built-in channels cannot render it.
    const visible = evaluateBioVisibility(layer.styleTrack, frame, layer.visible)
    const atoms = new Set<number>()
    for (const index of selection.atomIndices) {
      if (visible && !claimedAtoms.has(index)) atoms.add(index)
      claimedAtoms.add(index)
    }
    const residues = new Set<number>()
    for (const index of selection.residueIndices) {
      if (visible && !claimedResidues.has(index)) residues.add(index)
      claimedResidues.add(index)
    }
    layerAtomIndices.set(layer.id, atoms)
    layerResidueIndices.set(layer.id, residues)
  }

  return {
    layerAtomIndices,
    layerResidueIndices,
    claimedAtomIndices: claimedAtoms,
    claimedResidueIndices: claimedResidues,
  }
}
