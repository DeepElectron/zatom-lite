import * as THREE from 'three'
import type { Atom } from './crystal/types'

export type SelectionTransformMode = 'translate' | 'rotate'

export function computeSelectionTransformOrigin(
  atoms: Atom[],
  selectedAtomIds: Set<string>,
): [number, number, number] | null {
  if (selectedAtomIds.size === 0) return null

  let count = 0
  const sum: [number, number, number] = [0, 0, 0]

  for (const atom of atoms) {
    if (!selectedAtomIds.has(atom.id) || !atom.cartesian) continue
    sum[0] += atom.cartesian[0]
    sum[1] += atom.cartesian[1]
    sum[2] += atom.cartesian[2]
    count += 1
  }

  if (count === 0) return null
  return [sum[0] / count, sum[1] / count, sum[2] / count]
}

export function isNonZeroVector(
  value: [number, number, number] | null,
  epsilon = 1e-6,
): value is [number, number, number] {
  return Boolean(
    value &&
      (Math.abs(value[0]) > epsilon ||
        Math.abs(value[1]) > epsilon ||
        Math.abs(value[2]) > epsilon),
  )
}

/**
 * Transform one atom in canonical Cartesian space, then reapply its display-only
 * periodic offset. Rotating the offset position around a canonical pivot would
 * introduce an extra `R(offset)` term and make the preview jump on commit.
 */
export function applySelectionTransformPreviewToPosition(
  position: [number, number, number],
  isSelected: boolean,
  origin: [number, number, number] | null,
  translationPreview: [number, number, number] | null,
  rotationPreview: [number, number, number] | null,
  displayPosition?: [number, number, number] | null,
): [number, number, number] {
  if (!isSelected) {
    return displayPosition ?? position
  }

  const transformed = new THREE.Vector3(position[0], position[1], position[2])

  if (origin && isNonZeroVector(rotationPreview)) {
    const pivot = new THREE.Vector3(origin[0], origin[1], origin[2])
    transformed.sub(pivot)
    transformed.applyEuler(new THREE.Euler(rotationPreview[0], rotationPreview[1], rotationPreview[2], 'XYZ'))
    transformed.add(pivot)
  }

  if (isNonZeroVector(translationPreview)) {
    transformed.x += translationPreview[0]
    transformed.y += translationPreview[1]
    transformed.z += translationPreview[2]
  }

  // Reapply only the display offset after the canonical transform.
  if (displayPosition) {
    transformed.x += displayPosition[0] - position[0]
    transformed.y += displayPosition[1] - position[1]
    transformed.z += displayPosition[2] - position[2]
  }

  return [transformed.x, transformed.y, transformed.z]
}

export function buildSelectionPreviewPositionMap(
  atoms: Atom[],
  selectedAtomIds: Set<string>,
  origin: [number, number, number] | null,
  translationPreview: [number, number, number] | null,
  rotationPreview: [number, number, number] | null,
  /**
  * Optional display position table (cross-boundary mirror of "Show whole molecules").
  */
  displayPositions?: ReadonlyMap<string, [number, number, number]> | null,
): Map<string, [number, number, number]> {
  const map = new Map<string, [number, number, number]>()

  for (const atom of atoms) {
    if (!atom.cartesian) continue
    map.set(
      atom.id,
      applySelectionTransformPreviewToPosition(
        atom.cartesian,
        selectedAtomIds.has(atom.id),
        origin,
        translationPreview,
        rotationPreview,
        displayPositions?.get(atom.id) ?? null,
      ),
    )
  }

  return map
}
