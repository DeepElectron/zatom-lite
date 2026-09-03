/**
 * Shared atom/bond contact geometry.
 *
 * A cylinder whose centre line stops at the atom radius only touches the
 * sphere at one point. Its rim remains outside the sphere and produces a
 * visible halo, especially when outlines are enabled. The axial inset below
 * accounts for the rendered cylinder envelope so the two surfaces overlap.
 */

export const ATOM_OUTLINE_SCALE_PER_WIDTH = 0.025
export const BOND_OUTLINE_SCALE_PER_WIDTH = 0.15

// Covers the small inward error introduced by low-segment spheres/cylinders.
const JOINT_ENVELOPE_MARGIN = 1.12

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export function outlinedAtomRadius(radius: number, outlineWidth: number): number {
  const safeRadius = finiteNonNegative(radius)
  return safeRadius * (1 + finiteNonNegative(outlineWidth) * ATOM_OUTLINE_SCALE_PER_WIDTH)
}

export function outlinedBondRadius(radius: number, outlineWidth: number): number {
  const safeRadius = finiteNonNegative(radius)
  return safeRadius * (1 + finiteNonNegative(outlineWidth) * BOND_OUTLINE_SCALE_PER_WIDTH)
}

export interface BondEndpointInsetOptions {
  atomRadius: number
  bondRadius: number
  /** Distance between the atom centre line and an offset double/triple-bond cylinder. */
  radialOffset?: number
  outline?: boolean
  outlineWidth?: number
}

/**
 * Distance from the atom centre to the end of a bond cylinder.
 *
 * This is intentionally smaller than the atom radius: the cylinder must enter
 * the sphere far enough for its complete rendered rim to be covered. Returning
 * zero for a cylinder wider than the atom is the safe, finite fallback.
 */
export function calculateBondEndpointInset({
  atomRadius,
  bondRadius,
  radialOffset = 0,
  outline = false,
  outlineWidth = 0,
}: BondEndpointInsetOptions): number {
  const renderedAtomRadius = outline
    ? outlinedAtomRadius(atomRadius, outlineWidth)
    : finiteNonNegative(atomRadius)
  const renderedBondRadius = outline
    ? outlinedBondRadius(bondRadius, outlineWidth)
    : finiteNonNegative(bondRadius)
  const jointEnvelope = (
    finiteNonNegative(Math.abs(radialOffset)) + renderedBondRadius
  ) * JOINT_ENVELOPE_MARGIN

  if (renderedAtomRadius === 0 || jointEnvelope >= renderedAtomRadius) return 0

  return Math.sqrt(
    Math.max(0, renderedAtomRadius * renderedAtomRadius - jointEnvelope * jointEnvelope),
  )
}
