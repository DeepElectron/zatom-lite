/**
 * SceneGrid regime detection — chooses the *semantic unit* for a scene.
 *
 * The grid resolution is fixed (24x24 by default), so the only way to keep the
 * encoding informative across four orders of magnitude in atom count is to
 * change what a cell *means*:
 *
 *   molecular    -> unit = atom     (element symbol is the right variable)
 *   biomolecular -> unit = residue  (4779 atoms is ~600 residues: 1/cell)
 *   periodic     -> unit = site     (a perfect crystal is redundant per-atom;
 *                                    the information lives in deviations)
 *
 * Pure module: structure in, classification out. No store, no three.js.
 */

import type { ZatomStructure } from '../../agent/contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES } from '../../agent/biomolecular-identity'

export type SceneRegime = 'molecular' | 'biomolecular' | 'periodic'

/** Enumerable form for tool JSON schemas; kept in sync with SceneRegime by the type below. */
export const SCENE_REGIMES: SceneRegime[] = ['molecular', 'biomolecular', 'periodic']

export type SceneUnit = 'atom' | 'residue' | 'site'

export interface SceneRegimeInfo {
  regime: SceneRegime
  unit: SceneUnit
  /** Why this regime was chosen — echoed to the LLM so the lens is never implicit. */
  reason: string
  /** True when the caller forced the regime rather than it being detected. */
  overridden: boolean
}

/** Atom count above which per-atom element symbols stop carrying structure. */
export const MOLECULAR_ATOM_LIMIT = 200

const REGIME_UNIT: Record<SceneRegime, SceneUnit> = {
  molecular: 'atom',
  biomolecular: 'residue',
  periodic: 'site',
}

/**
 * True when atoms carry residue identity (`zatom.bio.*`), which the PDB/mmCIF
 * readers attach. Sampled rather than scanned in full: readers assign identity
 * uniformly, so a prefix sample is decisive and keeps this O(1) on huge scenes.
 */
export const hasResidueIdentity = (structure: ZatomStructure): boolean => {
  const atoms = structure.atoms
  const sample = Math.min(atoms.length, 64)
  for (let i = 0; i < sample; i++) {
    const props = atoms[i].properties
    if (!props) continue
    if (props[ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES.residueName] !== undefined) return true
  }
  return false
}

/**
 * Classify a scene. `override` short-circuits detection but still reports the
 * unit, so a caller that forces `molecular` on a protein knows what it asked
 * for.
 */
export const detectSceneRegime = (
  structure: ZatomStructure,
  override?: SceneRegime | null,
): SceneRegimeInfo => {
  if (override) {
    return {
      regime: override,
      unit: REGIME_UNIT[override],
      reason: `forced by caller (regime=${override})`,
      overridden: true,
    }
  }

  const atomCount = structure.atoms.length
  const periodic = Boolean(structure.lattice)

  // Residue identity first, *even when a lattice is present*. Nearly every PDB
  // entry carries a CRYST1 cell, so testing the lattice first would classify
  // essentially all crystallographic proteins as `periodic` and encode cells as
  // lattice deviations — destroying the residue identity that is the whole
  // reason to look at a protein. A protein in a crystal is still read as a
  // protein; the unit cell describes its packing, not its fold.
  if (hasResidueIdentity(structure)) {
    return {
      regime: 'biomolecular',
      unit: 'residue',
      reason: periodic
        ? `atoms carry residue identity (${atomCount} atoms); lattice present but describes packing, not fold`
        : `atoms carry residue identity (${atomCount} atoms)`,
      overridden: false,
    }
  }

  // No residue identity: periodicity now dominates, and deviations are the
  // informative channel for a genuine crystal.
  if (periodic) {
    return {
      regime: 'periodic',
      unit: 'site',
      reason: `structure has a lattice, no residue identity (${atomCount} atoms)`,
      overridden: false,
    }
  }

  if (atomCount > MOLECULAR_ATOM_LIMIT) {
    // Large, non-periodic, no residue identity: a nanoparticle or cluster.
    // Sites (deviation-oriented) beat per-atom symbols at this size.
    return {
      regime: 'periodic',
      unit: 'site',
      reason: `${atomCount} atoms exceeds the ${MOLECULAR_ATOM_LIMIT}-atom per-atom limit, no residue identity`,
      overridden: false,
    }
  }

  return {
    regime: 'molecular',
    unit: 'atom',
    reason: `${atomCount} atoms, no lattice, no residue identity`,
    overridden: false,
  }
}
