import type { Atom, LatticeVectors } from '../crystal/types'

export interface PolycrystalOptions {
  /** key into STRUCTURE_TEMPLATE_CIFS, e.g. 'fcc' */
  baseTemplateKey: string
  /** cubic box edge length in Angstrom */
  boxSize: number
  /** number of grains (seeds) */
  grainCount: number
  /** minimum seed separation in Angstrom; 0 disables rejection */
  minSeedDistance: number
  /** cross-grain overlap removal distance in Angstrom; 0 disables */
  overlapDmin: number
  /** hard generated-atom budget; generation fails before exceeding it */
  maxAtoms: number
  /** RNG seed for reproducibility */
  seed: number
}

export interface BaseCell {
  latticeVectors: LatticeVectors
  basis: { element: string; frac: [number, number, number] }[]
}

export interface Grain {
  seed: [number, number, number]
  /** row-major 3x3 rotation, length 9 */
  rotation: number[]
}

export interface PolycrystalResult {
  /** cartesian xyz, length 3*count */
  positions: Float32Array
  /** index into `elements`, length count */
  elementIndex: Uint8Array
  /** grain id per atom, length count */
  grainId: Uint32Array
  /** source base-cell basis index per atom, length count */
  basisIndex: Uint32Array
  /** elementIndex → element symbol */
  elements: string[]
  count: number
  bbox: { min: [number, number, number]; max: [number, number, number] }
  /** Voronoi seed xyz per grain (index = grainId) — lets region solids snap hull
  *  vertices exactly onto the cell boundary planes (gap-free tiling). */
  seeds: Float32Array
  /** row-major 3x3 rotation per grain, length = 9 * grain count */
  rotations: Float64Array
}

/** Re-exported for consumers building the displayed Atom[]. */
export type { Atom }
