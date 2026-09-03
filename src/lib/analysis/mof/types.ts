/**
 * Shared types for the in-browser MOF (Metal-Organic Framework) analysis
 * module. Algorithms live in:
 *   - `sbu-detect.ts`  — Secondary Building Unit detection
 *   - `topology.ts`    — refinement labels (paddle-wheel, Zn4O, ...)
 *   - `rac.ts`         — Revised Autocorrelation descriptors
 *                        (Janet & Kulik, J. Phys. Chem. A 2017, 121, 8939).
 *
 * Everything here is pure data; no UI, no Zustand. Storage in the
 * atom-attributes slice happens in a follow-up commit.
 */

/** Classification of a Secondary Building Unit. */
export type SBUKind =
  /** Multiple metals bridged via short M-M or M-O-M (catch-all). */
  | 'metal_cluster'
  /** Canonical Cu2 / Zn2 paddle-wheel: 2 metals + 4 carboxylates. */
  | 'metal_paddlewheel'
  /** Zn4O / Cr3O / etc. with a central μ-oxo. */
  | 'metal_oxocluster'
  /** Isolated single-metal centre. */
  | 'metal_monomer'
  /** Organic bridging unit (linker). */
  | 'linker'
  /** Terminal ligand (water, hydroxide, formate cap...). */
  | 'capping'

export interface SBU {
  id: string
  kind: SBUKind
  /** atom ids that belong to this SBU. */
  atom_ids: string[]
  /** element composition summary, e.g. "Cu2O8C24". */
  formula: string
  /**
  * Connecting atoms ("points of extension"): atom ids that bond to an
  * atom belonging to a *different* SBU. Useful for net abstraction.
  */
  points_of_extension: string[]
}

export interface SbuDetectionResult {
  sbus: SBU[]
  /** atom id → sbu id. Atoms not in any SBU are absent. */
  atom_to_sbu: Record<string, string>
  /** Non-fatal warnings (ambiguous bridges, PBC suggestions, ...). */
  warnings: string[]
}

/**
 * One entry of a Revised Autocorrelation (RAC) feature vector.
 *
 * The vector is a flat list of (property, depth, op, scope) tuples each
 * with a numeric value, so that downstream code can pivot the table in
 * any direction (heatmap, ML features, ...).
 */
export interface RacFeature {
  /**
  * Which atomic property is being autocorrelated.
  *
  *   Z     — atomic number
  *   chi   — Pauling electronegativity
  *   T     — graph-degree coordination number (computed from bond list)
  *   I     — identity (1 for every atom)
  *   S     — Mendeleev group number
  *   alpha — atomic dipole polarizability (Å³)
  */
  property: 'Z' | 'chi' | 'T' | 'I' | 'S' | 'alpha'
  /** bond-graph depth (1..3 for the default `computeRac`). */
  depth: number
  /**
  * Operation:
  *   P — product:   Σ_j prop(metal) · prop(j)
  *   D — squared difference: Σ_j (prop(metal) - prop(j))²
  */
  kind: 'P' | 'D'
  /**
  * Scope of the descriptor.
  *   mc — metal-centred (default), correlate from a metal atom outwards
  *   lc — linker-centred, correlate from a linker-coord atom outwards
  */
  scope: 'mc' | 'lc'
  value: number
}

export interface RacVector {
  /** Centring atom this vector was computed around. */
  metal_atom_id: string
  /**
  * Roughly 36-dim (6 props × 3 depths × 2 P/D) when scope='mc' alone.
  * Order matches the iteration order of {properties × depths × kinds}.
  */
  features: RacFeature[]
}
