import { describe, expect, it } from 'vitest'

import type { Vec3, ZatomStructure } from '../../../agent/contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../../../agent/contracts'
import { screenFrame, summarizeVisibleAtoms } from '../viewer-frame'

const structureOf = (
  atoms: Array<{ id: string; element: string; position: Vec3 }>,
): ZatomStructure => ({
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  atoms,
})

const frame = screenFrame({
  position: [0, 0, 10],
  lookAt: [0, 0, 0],
  up: [0, 1, 0],
})

describe('summarizeVisibleAtoms', () => {
  it('uses each atom eye depth for a perspective frustum and excludes atoms behind the camera', () => {
    const structure = structureOf([
      { id: 'target', element: 'C', position: [0, 0, 0] },
      // At 100 Å eye depth, x=40 Å is visible through a 50° square viewport.
      // A frustum evaluated only at lookAt depth (10 Å) incorrectly clips it.
      { id: 'far-visible', element: 'N', position: [40, 0, -90] },
      // At 1 Å eye depth, x=1 Å lies outside the same perspective frustum.
      { id: 'near-clipped', element: 'O', position: [1, 0, 9] },
      { id: 'far-clipped', element: 'F', position: [60, 0, -90] },
      // This projects to the exact screen centre, but is behind the eye.
      { id: 'behind-eye', element: 'He', position: [0, 0, 20] },
    ])

    const visible = summarizeVisibleAtoms(frame, structure, {
      viewportSizePx: [1000, 1000],
      nearCenterLimit: 10,
    })

    expect(visible.inFrameCount).toBe(2)
    expect(visible.elementCounts).toEqual({ C: 1, N: 1 })
    expect(visible.nearCenter.map((atom) => atom.id)).toEqual(['target', 'far-visible'])
  })

  it('keeps orthographic bounds depth-independent while still clipping the rear half-space', () => {
    const structure = structureOf([
      { id: 'near-visible', element: 'C', position: [4, 0, 9] },
      { id: 'far-visible', element: 'N', position: [4, 0, -90] },
      { id: 'far-clipped', element: 'O', position: [6, 0, -90] },
      { id: 'behind-eye', element: 'He', position: [0, 0, 20] },
    ])

    const visible = summarizeVisibleAtoms(frame, structure, {
      zoom: 100,
      viewportSizePx: [1000, 1000],
      nearCenterLimit: 10,
    })

    expect(visible.halfExtentA).toBe(5)
    expect(visible.inFrameCount).toBe(2)
    expect(visible.elementCounts).toEqual({ C: 1, N: 1 })
    expect(visible.nearCenter.map((atom) => atom.id)).toEqual(['near-visible', 'far-visible'])
  })
})
