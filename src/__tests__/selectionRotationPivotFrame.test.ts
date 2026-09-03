/**
 * Pivot-frame invariants for selection rotation.
 *
 * Drag-preview coordinates must equal committed coordinates on release. Preview uses
 * applySelectionTransformPreviewToPosition while commit applies R(p-c)+c. Display-only periodic
 * offsets must be added after rotation rather than rotated around the original centroid.
 */

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  applySelectionTransformPreviewToPosition,
  computeSelectionTransformOrigin,
} from '../lib/selection-transform-preview'
import type { Atom } from '../lib/crystal/types'

const atom = (id: string, c: [number, number, number]): Atom =>
  ({ id, element: 'C', cartesian: c, position: c }) as unknown as Atom

/** Equivalent commit formula used by selection-transform-slice.applyRotationPreview. */
function commitRotation(
  p: [number, number, number],
  origin: [number, number, number],
  euler: [number, number, number],
): [number, number, number] {
  const v = new THREE.Vector3(p[0], p[1], p[2])
  const pivot = new THREE.Vector3(origin[0], origin[1], origin[2])
  v.sub(pivot)
  v.applyEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'XYZ'))
  v.add(pivot)
  return [v.x, v.y, v.z]
}

describe('选区旋转 pivot 坐标系', () => {
  const rot: [number, number, number] = [0.4, -0.7, 0]

  it('单个原子：质心就是它自己，旋转必须原地不动', () => {
    const atoms = [atom('a', [1.23, -4.56, 7.89]), atom('b', [0, 0, 0])]
    const selected = new Set(['a'])
    const origin = computeSelectionTransformOrigin(atoms, selected)!

    const out = applySelectionTransformPreviewToPosition(
      atoms[0].cartesian!, true, origin, null, rot,
    )
    // Rotation around the atom itself is the identity transform.
    for (let i = 0; i < 3; i++) {
      expect(out[i]).toBeCloseTo(atoms[0].cartesian![i], 10)
    }
  })

  it('预览 == 提交（无 unwrap 偏移时）', () => {
    const atoms = [atom('a', [1, 0, 0]), atom('b', [0, 2, 0]), atom('c', [0, 0, 3])]
    const selected = new Set(['a', 'b', 'c'])
    const origin = computeSelectionTransformOrigin(atoms, selected)!

    for (const a of atoms) {
      const preview = applySelectionTransformPreviewToPosition(a.cartesian!, true, origin, null, rot)
      const committed = commitRotation(a.cartesian!, origin, rot)
      for (let i = 0; i < 3; i++) expect(preview[i]).toBeCloseTo(committed[i], 10)
    }
  })

  it('回归：有 unwrap 显示偏移时，预览仍与提交只差那个偏移本身', () => {
    // Whole-molecule display shows b in a +10-angstrom image without changing stored coordinates.
    const atoms = [atom('a', [1, 0, 0]), atom('b', [0, 2, 0])]
    const selected = new Set(['a', 'b'])
    const origin = computeSelectionTransformOrigin(atoms, selected)!
    const offset: [number, number, number] = [10, 0, 0]
    const display: [number, number, number] = [
      atoms[1].cartesian![0] + offset[0],
      atoms[1].cartesian![1] + offset[1],
      atoms[1].cartesian![2] + offset[2],
    ]

    const preview = applySelectionTransformPreviewToPosition(
      atoms[1].cartesian!, true, origin, null, rot, display,
    )
    const committed = commitRotation(atoms[1].cartesian!, origin, rot)

    // Rotate in the source frame, then restore the unrotated display offset.
    for (let i = 0; i < 3; i++) {
      expect(preview[i] - committed[i]).toBeCloseTo(offset[i], 10)
    }

    // Rotating the display position directly would rotate the offset and reproduce the old bug.
    const buggy = commitRotation(display, origin, rot)
    const rotatedOffset = new THREE.Vector3(offset[0], offset[1], offset[2])
      .applyEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'))
    expect(Math.abs(buggy[0] - committed[0] - offset[0])).toBeGreaterThan(0.1)
    expect(rotatedOffset.x).not.toBeCloseTo(offset[0], 3)
  })

  it('未选中的原子：传了显示位置就渲染在显示位置，不受变换影响', () => {
    const raw: [number, number, number] = [1, 2, 3]
    const display: [number, number, number] = [11, 2, 3]
    const out = applySelectionTransformPreviewToPosition(raw, false, [0, 0, 0], [5, 5, 5], rot, display)
    expect(out).toEqual(display)
  })

  it('回归：origin 为 null 时旋转被整段跳过（片段只平移，看起来"没绕质心转"）', () => {
    const p: [number, number, number] = [1, 2, 3]
    // A missing pivot skips the rotation branch entirely.
    const noPivot = applySelectionTransformPreviewToPosition(p, true, null, null, rot)
    expect(noPivot).toEqual(p)

    // Providing a pivot enables rotation.
    const withPivot = applySelectionTransformPreviewToPosition(p, true, [0, 0, 0], null, rot)
    expect(withPivot).not.toEqual(p)
  })

  it('刚体性：旋转保持选区内两点距离', () => {
    const atoms = [atom('a', [1, 0, 0]), atom('b', [0, 2, 0]), atom('c', [-1, 0, 1])]
    const selected = new Set(['a', 'b', 'c'])
    const origin = computeSelectionTransformOrigin(atoms, selected)!
    const moved = atoms.map((a) =>
      applySelectionTransformPreviewToPosition(a.cartesian!, true, origin, null, rot),
    )
    const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    expect(d(moved[0], moved[1])).toBeCloseTo(d(atoms[0].cartesian!, atoms[1].cartesian!), 10)
    expect(d(moved[1], moved[2])).toBeCloseTo(d(atoms[1].cartesian!, atoms[2].cartesian!), 10)
  })
})
