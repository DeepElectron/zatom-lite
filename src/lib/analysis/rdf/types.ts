import type { LatticeVectors } from '../../crystal/types'

export type Pbc = [boolean, boolean, boolean]

export interface RdfSite {
  element: string
  cartesian: [number, number, number]
}

export interface RdfStructure {
  sites: RdfSite[]
  latticeVectors: LatticeVectors
}

export interface RdfPattern {
  r: number[]
  g_r: number[]
  element_pair?: [string, string]
}

export interface RdfOptions {
  center_species?: string
  neighbor_species?: string
  cutoff?: number
  n_bins?: number
  pbc?: Pbc
  /** Expand the cell so the shortest lattice vector is at least expansion_factor × cutoff. */
  auto_expand?: boolean
  expansion_factor?: number
}

export interface RdfEntry {
  id: string
  label: string
  pattern: RdfPattern
  color: string
}
