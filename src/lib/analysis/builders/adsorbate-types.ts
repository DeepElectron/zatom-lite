/**
 * Shared types for the Adsorbate inspector tool.
 *
 * These describe candidate adsorption sites on a surface and the placement
 * input format passed between the algorithm layer (lib/analysis/builders/
 * adsorbate.ts) and the UI / Zustand slice.
 */

export type Vec3 = [number, number, number]

export type SiteKind = 'top' | 'bridge' | 'hollow'

export interface AdsorbateAtomInput {
  element: string
  cartesian: Vec3
}

export type SiteAccessibility = 'exposed' | 'blocked'

export interface DetectedSite {
  id: string
  kind: SiteKind
  /** Cartesian position of the binding site itself (just above the surface). */
  position: Vec3
  /** Exact on-surface anchor center before the display/placement offset. */
  bindingPosition?: Vec3
  /** Outward surface normal (unit vector, points away from the slab). */
  normal: Vec3
  /** Indices into the atoms array that define this site (1 / 2 / 3 depending on kind). */
  atomIndices: number[]
  /** Periodic image of each defining atom relative to its canonical structure ID. */
  atomImages?: Array<[number, number, number]>
  /** Exposure classification by the backend site-detection endpoint.
  * Only populated when the scene has organic atoms above the metal layer
  * (i.e. an adlayer is present). Without it the site is implicitly 'exposed'
  * — bare-surface case. PRD §4 FR1 D5 / §5.2. */
  accessibility?: SiteAccessibility
  /** Indices of organic atoms that block this site (only when blocked). */
  blockedBy?: number[]
  /** 3D distance (Å) to the nearest organic atom (for hover tooltip / filter). */
  nearestOrganicDistance?: number
}
