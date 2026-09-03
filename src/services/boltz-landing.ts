/**
 * Land Boltz results in the workspace through two existing paths:
 *
 * - A predicted complex becomes a new document via mmCIF-to-PDB and loadBiomolecule, allowing the
 *   existing parser to derive cartoons, residue data, and secondary structure.
 * - Design candidates append to the current target through appendBioHetComponent, whose existing
 *   sublayer semantics already provide one layer per candidate.
 */

import { parseLegacyPdb } from '../lib/biomolecule/pdb'
import { mmcifLigandAtoms, mmcifToPdbText } from '../lib/biomolecule/mmcif'
import { getActiveViewportStoreApi } from '../orchestration/ViewportContext'
import {
  type BoltzArtifact,
  type BoltzCandidate,
} from './boltz-client'
import { fetchBoltzArtifactText } from './boltz-transport'

// Resolve the active viewport store imperatively; a global singleton would target the wrong
// viewport in multi-viewport layouts.
const useCrystalStore = {
  getState: () => getActiveViewportStoreApi().getState(),
}

/** Replace the document with a complex and return counts for status feedback. */
export async function landBoltzComplex(
  structure: BoltzArtifact,
  options: { title: string; signal?: AbortSignal },
): Promise<{ atomCount: number; chainCount: number }> {
  const mmcif = await fetchBoltzArtifactText(structure.url, options.signal)
  const pdbText = mmcifToPdbText(mmcif, { title: options.title })
  // Boltz stores per-atom pLDDT (0-100) in the B-factor column. Declare its semantics explicitly
  // because automatic detection recognizes AlphaFold naming only and would invert confidence colors.
  const bioStructure = parseLegacyPdb(pdbText, { id: options.title, bFactorSemantics: 'plddt' })

  const store = useCrystalStore.getState()
  store.loadBiomolecule(bioStructure)
  // Make the complex the biological document's Base layer; later ligands become sublayers.
  store.resetStructureGroupsToBase()

  return { atomCount: bioStructure.atoms.length, chainCount: bioStructure.chains.length }
}

/**
 * Add candidate ligands over the current target, one layer per candidate.
 *
 * Append serially because appendBioHetComponent exports and reparses the whole document; concurrent
 * calls based on the same snapshot would overwrite one another.
 */
export async function landBoltzDesignCandidates(
  results: readonly BoltzCandidate[],
  options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<{ landed: number; skipped: number }> {
  let landed = 0
  let skipped = 0

  // Sort descending so layer order places the best candidate first.
  const ranked = [...results].sort((a, b) => designScore(b) - designScore(a))

  for (const [index, result] of ranked.entries()) {
    if (options?.signal?.aborted) break
    const artifact = result.artifacts?.ligand_structure ?? result.artifacts?.structure
    if (!artifact) {
      skipped += 1
      continue
    }
    try {
      const mmcif = await fetchBoltzArtifactText(artifact.url, options?.signal)
      const atoms = mmcifLigandAtoms(mmcif)
      if (atoms.length === 0) {
        skipped += 1
        continue
      }
      // Include rank and score in the layer name for direct comparison.
      const score = designScore(result)
      const label = `Cand ${index + 1}${Number.isFinite(score) && score > 0 ? ` · ${score.toFixed(2)}` : ''}`
      const ok = useCrystalStore.getState().appendBioHetComponent(label, atoms)
      if (ok) landed += 1
      else skipped += 1
    } catch {
      // One expired presigned URL must not abort the entire batch.
      skipped += 1
    }
    options?.onProgress?.(index + 1, ranked.length)
  }

  return { landed, skipped }
}

/**
 * Primary ranking score, preferring binding_confidence over optimization_score.
 *
 * These keys are observed design-pipeline outputs. The loose metrics dictionary can contain strings
 * or null, so only numeric values qualify.
 */
export function designScore(result: BoltzCandidate): number {
  const primary = result.metrics?.binding_confidence
  if (typeof primary === 'number') return primary
  const fallback = result.metrics?.optimization_score
  return typeof fallback === 'number' ? fallback : 0
}
