import { describe, expect, it } from 'vitest'

import type { Vec3, ZatomToolContext, ZatomViewerScene } from '../contracts'
import { CAMERA_ZATOM_AGENT_TOOLS } from '../camera-tools'

const viewerObserve = CAMERA_ZATOM_AGENT_TOOLS.find((tool) => tool.manifest.name === 'viewer_observe')!

describe('viewer_observe selection budget', () => {
  it('reports the complete count while bounding returned IDs, details, and nearest neighbours', async () => {
    const atoms = Array.from({ length: 400 }, (_, index) => ({
      id: `atom-${index}`,
      element: index % 2 ? 'H' : 'C',
      position: [index * 0.5, 0, 0] as Vec3,
    }))
    const selectedAtomIds = atoms.slice(0, 100).map((atom) => atom.id)
    const scene: ZatomViewerScene = {
      pose: null,
      viewportSizePx: null,
      selectedAtomIds,
      selectedBondIds: Array.from({ length: 20 }, (_, index) => `bond-${index}`),
      selectedFaceIds: Array.from({ length: 20 }, (_, index) => `face-${index}`),
      selectedEdgeIds: Array.from({ length: 20 }, (_, index) => `edge-${index}`),
      boxSelectionActive: true,
      hoveredAtomId: 'atom-399',
      lastFocus: { atomIds: selectedAtomIds, center: [24.75, 0, 0], at: Date.now() - 50 },
    }
    const result = await viewerObserve.execute(
      { selectionAtomLimit: 7, neighborCount: 3 },
      {
        readStructure: () => ({ schemaVersion: 'zatom.structure/v1', atoms }),
        readViewerScene: () => scene,
      } as ZatomToolContext,
    )

    expect(result.ok).toBe(true)
    const data = result.data as {
      selection: {
        atomCount: number
        atomIds: string[]
        atomIdsTruncated: boolean
        bondCount: number
        bondIds: string[]
        bondIdsTruncated: boolean
        faceCount: number
        faceIds: string[]
        faceIdsTruncated: boolean
        edgeCount: number
        edgeIds: string[]
        edgeIdsTruncated: boolean
        centroid: Vec3 | null
        atoms: Array<{ id: string; neighbors: Array<{ id: string; distanceA: number }> }>
      }
      hovered: { id: string; neighbors: unknown[] }
      lastFocus: { atomCount: number; atomIds: string[]; atomIdsTruncated: boolean }
    }
    expect(data.selection.atomCount).toBe(100)
    expect(data.selection.atomIds).toEqual(selectedAtomIds.slice(0, 7))
    expect(data.selection.atomIdsTruncated).toBe(true)
    expect(data.selection).toMatchObject({
      bondCount: 20, bondIdsTruncated: true,
      faceCount: 20, faceIdsTruncated: true,
      edgeCount: 20, edgeIdsTruncated: true,
    })
    expect(data.selection.bondIds).toHaveLength(7)
    expect(data.selection.faceIds).toHaveLength(7)
    expect(data.selection.edgeIds).toHaveLength(7)
    expect(data.selection.atoms).toHaveLength(7)
    expect(data.selection.atoms.every((atom) => atom.neighbors.length === 3)).toBe(true)
    expect(data.selection.atoms[0].neighbors.map((neighbor) => neighbor.id)).toEqual([
      'atom-1', 'atom-2', 'atom-3',
    ])
    expect(data.selection.centroid?.[0]).toBeCloseTo(24.75)
    expect(data.hovered.neighbors).toHaveLength(3)
    expect(data.lastFocus).toMatchObject({ atomCount: 100, atomIdsTruncated: true })
    expect(data.lastFocus.atomIds).toEqual(selectedAtomIds.slice(0, 7))
  })
})
