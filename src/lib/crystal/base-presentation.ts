import { applyRadiusVariance } from './elements'
import type { Atom, ViewMode } from './types'
import { getCpkElementVisual, getDefaultCrystalElementVisual } from '../render/crystal-visuals'

export interface CrystalBaseGeometrySettings {
  radiusScale: number
  bondRadius: number
  elementRadiusVariance: number
  elementOverrides: Readonly<Record<string, { color: string; radius: number }>>
  /** Use van der Waals radii for standard CPK space-fill geometry. */
  vanDerWaalsSpaceFill?: boolean
}

/** Exact source-compatible world-space geometry for ordinary crystal passes. */
export function crystalBaseAtomRadii(
  atoms: readonly Atom[],
  viewMode: ViewMode,
  settings: CrystalBaseGeometrySettings,
): ReadonlyMap<string, number> {
  const radii = new Map<string, number>()
  // Ball-and-stick keeps covalent radii so spheres do not engulf bonds.
  const useVdw = settings.vanDerWaalsSpaceFill === true && viewMode === 'space-fill'
  for (const atom of atoms) {
    const baseVisual = useVdw
      ? getCpkElementVisual(atom.element)
      : getDefaultCrystalElementVisual(atom.element)
    const elementRadius = applyRadiusVariance(
      // Radius explicitly overridden by the user takes precedence over the two default tables, keeping manual adjustments always in effect.
      settings.elementOverrides[atom.element]?.radius ?? baseVisual.radius,
      settings.elementRadiusVariance,
    )
    if (viewMode === 'stick') radii.set(atom.id, crystalBaseBondRadius(settings))
    else if (viewMode === 'space-fill') radii.set(atom.id, elementRadius)
    else if (viewMode === 'ball-stick') radii.set(atom.id, elementRadius * settings.radiusScale)
  }
  return radii
}

export function crystalBaseBondRadius(settings: Pick<CrystalBaseGeometrySettings, 'bondRadius'>): number {
  return Number.isFinite(settings.bondRadius) ? Math.max(.001, settings.bondRadius) : .12
}
