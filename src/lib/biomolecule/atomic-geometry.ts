import type { ViewMode } from '../crystal/types'
import type { ElementVisualOverride } from '../render/crystal-visuals'
import type { BioBuiltinAtomicRepresentation } from './presentation-contract'

export interface BioAtomicGeometryGlobals {
  viewMode: ViewMode
  radiusScale: number
  bondRadius: number
  elementOverrides: Readonly<Record<string, ElementVisualOverride>>
}

export interface BioAtomicGeometryRequest {
  representation: BioBuiltinAtomicRepresentation | 'inherit'
  scale: number
  /** Defaults to `scale`, matching source layer/group semantics. */
  bondScale?: number
  globals: BioAtomicGeometryGlobals
}

export interface ResolvedBioAtomicGeometry {
  representation: BioBuiltinAtomicRepresentation
  radiusScale: number
  atomRadiusScale: number
  bondRadius: number
  /** Explicit source-compatible element radii before the group size multiplier. */
  atomRadiusByElement: ReadonlyMap<string, number>
  drawAtoms: boolean
  drawBonds: boolean
  /** Target-only enhanced presentation; source `sticks` use ordinary cylinders. */
  hyperStick: boolean
}

export const SOURCE_BIO_ATOMIC_REPRESENTATION_BY_VIEW_MODE: Readonly<Record<ViewMode, BioBuiltinAtomicRepresentation>> = {
  'ball-stick': 'ball-and-stick',
  stick: 'sticks',
  'space-fill': 'space-filling',
  'hyper-stick': 'sticks',
  wireframe: 'lines',
}

export function resolveBioAtomicGeometry({
  representation,
  scale,
  bondScale = scale,
  globals,
}: BioAtomicGeometryRequest): ResolvedBioAtomicGeometry {
  const effectiveRepresentation = representation === 'inherit'
    ? SOURCE_BIO_ATOMIC_REPRESENTATION_BY_VIEW_MODE[globals.viewMode]
    : representation
  const safeScale = Number.isFinite(scale) ? Math.max(0.05, scale) : 1
  const safeBondScale = Number.isFinite(bondScale) ? Math.max(0.05, bondScale) : safeScale
  const baseBondRadius = Number.isFinite(globals.bondRadius) ? Math.max(0.001, globals.bondRadius) : .12
  const radiusScale = Number.isFinite(globals.radiusScale) ? Math.max(0.001, globals.radiusScale) : .45

  return {
    representation: effectiveRepresentation,
    radiusScale,
    atomRadiusScale: safeScale,
    bondRadius: baseBondRadius * safeBondScale,
    atomRadiusByElement: new Map(Object.entries(globals.elementOverrides).map(([element, visual]) => (
      [element, visual.radius] as const
    ))),
    drawAtoms: effectiveRepresentation !== 'lines',
    drawBonds: effectiveRepresentation === 'ball-and-stick'
      || effectiveRepresentation === 'sticks'
      || effectiveRepresentation === 'lines',
    hyperStick: representation === 'inherit' && globals.viewMode === 'hyper-stick',
  }
}

export function resolveBioAtomicElementRadius(
  geometry: ResolvedBioAtomicGeometry,
  element: string,
  defaultElementRadius: number,
): number {
  const overridden = geometry.atomRadiusByElement.get(element)
  const elementRadius = overridden ?? defaultElementRadius
  const base = geometry.representation === 'sticks'
    ? geometry.bondRadius / Math.max(geometry.atomRadiusScale, 0.05)
    : geometry.representation === 'space-filling'
      ? elementRadius
      : elementRadius * geometry.radiusScale
  return base * geometry.atomRadiusScale
}

export function bioFocusOpacity(
  layerOpacity: number,
  hasSelection: boolean,
  unfocusedOpacity = 0.16,
): number {
  const opacity = Number.isFinite(layerOpacity) ? Math.max(0, Math.min(1, layerOpacity)) : 1
  return hasSelection ? Math.min(opacity, unfocusedOpacity) : opacity
}

/**
 * The number of screen pixels corresponding to each level of stroke width, calibrated according to the perception of 0.045 world units under normal viewing distance.
 */
export const BIO_OUTLINE_PIXELS_PER_STEP = 1.5

/**
 * Stroke width converted to NDC-Y units (cropping space vertical [-1,1]).
 *
 * The stroke must be constant according to the **screen**, not the world. When the world's constant external expansion is enlarged to the residue scale,
 * The external expansion case will be large enough to include the camera, and its back side will fill the field of view - appearing as a whole dark sloping plate without gradient.
 * After switching to NDC offset, the nearby expansion will automatically become smaller on the world scale, and the shell will always stick to the ribbon.
 *
 * Use NDC-Y instead of pixels to express directly because the offset in the shader is the clipping coordinate; the vertical direction is [-1,1], a total of 2 units,
 * So 1 pixel = 2/viewport height. The horizontal direction is converted by the shader according to the aspect ratio to ensure that the pixel width is consistent in all directions.
 */
export function bioCartoonOutlineNdcWidth(
  outlineWidth: number,
  viewportHeight: number,
): number {
  const safeWidth = Number.isFinite(outlineWidth) ? Math.max(0, outlineWidth) : 0
  const safeHeight = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 1
  return safeWidth * BIO_OUTLINE_PIXELS_PER_STEP * 2 / safeHeight
}
