import { describe, expect, it, vi } from 'vitest'

import type { ProposalSnapshot, Vec3, ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { callZatomMcpTool } from '../mcp-adapter'
import {
  poseStructureComponentSemantically,
  SemanticPoseInputError,
} from '../semantic-pose'
import { fingerprintStructure } from '../structure-math'

const dot = (left: Vec3, right: Vec3): number => (
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
)

const delta = (from: Vec3, to: Vec3): Vec3 => [
  to[0] - from[0],
  to[1] - from[1],
  to[2] - from[2],
]

const unit = (vector: Vec3): Vec3 => {
  const length = Math.hypot(...vector)
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

const byId = (structure: ZatomStructure, atomId: string) => (
  structure.atoms.find((atom) => atom.id === atomId)!
)

function waterNearTarget(): ZatomStructure {
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'water near surface oxygen',
    atoms: [
      { id: 'water-O', element: 'O', position: [2, 2, 5] },
      { id: 'water-H1', element: 'H', position: [2.96, 2, 5] },
      { id: 'water-H2', element: 'H', position: [1.76, 2.93, 5] },
      { id: 'surface-O', element: 'O', position: [2, 2, 9] },
      { id: 'surface-Cu', element: 'Cu', position: [5, 5, 0] },
    ],
    bonds: [
      { id: 'water-O-H1', atomIds: ['water-O', 'water-H1'], order: 1 },
      { id: 'water-O-H2', atomIds: ['water-O', 'water-H2'], order: 1 },
    ],
  }
}

describe('semantic component pose', () => {
  it('keeps the anchor fixed while pointing one component atom at an external atom', () => {
    const source = waterNearTarget()
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
      anchorAtomId: 'water-O',
      directionAtomIds: ['water-H1'],
      target: { kind: 'atom', atomId: 'surface-O', relation: 'toward' },
    })

    const originalAnchor = byId(source, 'water-O')
    const resultAnchor = byId(result.structure, 'water-O')
    expect(resultAnchor.position).toEqual(originalAnchor.position)
    const finalOh = unit(delta(resultAnchor.position, byId(result.structure, 'water-H1').position))
    const toTarget = unit(delta(resultAnchor.position, byId(result.structure, 'surface-O').position))
    expect(dot(finalOh, toTarget)).toBeCloseTo(1, 10)
    expect(byId(result.structure, 'surface-O').position).toEqual(byId(source, 'surface-O').position)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'semantic_pose.anchor_motion', status: 'pass' }),
      expect.objectContaining({ id: 'semantic_pose.direction_alignment', status: 'pass' }),
    ]))
  })

  it('rolls around the resolved axis and leaves the anchor fixed', () => {
    const source: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        { id: 'anchor', element: 'O', position: [0, 0, 0] },
        { id: 'axis', element: 'H', position: [0, 0, 1] },
        { id: 'side', element: 'H', position: [1, 0, 1] },
      ],
      bonds: [
        { id: 'a-axis', atomIds: ['anchor', 'axis'], order: 1 },
        { id: 'a-side', atomIds: ['anchor', 'side'], order: 1 },
      ],
    }
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['anchor', 'axis', 'side'],
      anchorAtomId: 'anchor',
      directionAtomIds: ['axis'],
      target: { kind: 'vector', vector: [0, 0, 1] },
      rollDeg: 90,
    })

    expect(byId(result.structure, 'anchor').position).toEqual([0, 0, 0])
    expect(byId(result.structure, 'axis').position[2]).toBeCloseTo(1, 10)
    expect(byId(result.structure, 'side').position[0]).toBeCloseTo(0, 10)
    expect(byId(result.structure, 'side').position[1]).toBeCloseTo(1, 10)
  })

  it('aims the equal-weight angular bisector of several direction atoms', () => {
    const source: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [
        { id: 'anchor', element: 'O', position: [0, 0, 0] },
        { id: 'short', element: 'H', position: [1, 0, 0] },
        { id: 'long', element: 'H', position: [0, 2, 0] },
      ],
    }
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['anchor', 'short', 'long'],
      anchorAtomId: 'anchor',
      directionAtomIds: ['short', 'long'],
      directionMode: 'bisector',
      target: { kind: 'vector', vector: [0, 0, 1] },
    })
    const anchor = byId(result.structure, 'anchor').position
    const short = unit(delta(anchor, byId(result.structure, 'short').position))
    const long = unit(delta(anchor, byId(result.structure, 'long').position))
    const bisector = unit([short[0] + long[0], short[1] + long[1], short[2] + long[2]])
    expect(dot(bisector, [0, 0, 1])).toBeCloseTo(1, 10)
  })

  it('aims toward the nearest periodic image of an external target atom', () => {
    const source: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      lattice: {
        vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
        periodic: [true, true, true],
      },
      atoms: [
        { id: 'anchor', element: 'C', position: [9.6, 5, 5] },
        { id: 'direction', element: 'H', position: [9.6, 6, 5] },
        { id: 'target', element: 'O', position: [0.2, 5, 5] },
      ],
    }
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['anchor', 'direction'],
      anchorAtomId: 'anchor',
      directionAtomIds: ['direction'],
      target: { kind: 'atom', atomId: 'target' },
    })
    const direction = unit(delta(
      byId(result.structure, 'anchor').position,
      byId(result.structure, 'direction').position,
    ))
    expect(direction[0]).toBeGreaterThan(0.999999)
  })

  it('reimages a bonded molecule spanning a periodic edge before rotating it', () => {
    const source: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      lattice: {
        vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 10]],
        periodic: [true, true, true],
      },
      atoms: [
        { id: 'anchor', element: 'C', position: [9.8, 5, 5] },
        { id: 'direction', element: 'O', position: [0.2, 5, 5] },
        { id: 'fixed', element: 'Cu', position: [4, 4, 4] },
      ],
      bonds: [{ id: 'edge-bond', atomIds: ['anchor', 'direction'], order: 1 }],
    }
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['anchor', 'direction'],
      anchorAtomId: 'anchor',
      directionAtomIds: ['direction'],
      target: { kind: 'vector', vector: [0, 1, 0] },
    })
    const anchor = byId(result.structure, 'anchor').position
    const direction = byId(result.structure, 'direction').position
    expect(Math.hypot(...delta(anchor, direction))).toBeCloseTo(0.4, 10)
    expect(unit(delta(anchor, direction))).toEqual(expect.arrayContaining([expect.closeTo(0), expect.closeTo(1), expect.closeTo(0)]))
    expect(byId(result.structure, 'fixed').position).toEqual([4, 4, 4])
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'semantic_pose.periodic_reimaging',
      status: 'pass',
      metrics: { reimagedAtomCount: 1 },
    }))
  })

  it('moves farther from a slab without changing its tilt', () => {
    const source: ZatomStructure = {
      ...waterNearTarget(),
      lattice: {
        vectors: [[10, 0, 0], [0, 10, 0], [0, 0, 20]],
        periodic: [true, true, false],
      },
    }
    const before = byId(source, 'water-O').position
    const beforeOh = delta(before, byId(source, 'water-H1').position)
    const result = poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
      anchorAtomId: 'water-O',
      directionAtomIds: ['water-H1', 'water-H2'],
      target: { kind: 'surface', relation: 'away' },
      alignDirection: false,
      translationA: 0.75,
    })
    const after = byId(result.structure, 'water-O').position
    const afterOh = delta(after, byId(result.structure, 'water-H1').position)
    expect(after).toEqual([before[0], before[1], before[2] + 0.75])
    expect(afterOh).toEqual(beforeOh)
    expect(result.semanticPose.targetDirection).toEqual([0, 0, 1])
  })

  it('publishes a bound ghost proposal instead of writing in propose-only context', async () => {
    const source = waterNearTarget()
    const propose = vi.fn<NonNullable<ZatomToolContext['proposal']>['propose']>(async (input) => ({
      id: 'semantic-proposal',
      intent: input.intent,
      status: 'pending',
      viewportId: input.viewportId,
      workspaceRevision: input.workspaceRevision,
      baseFingerprint: input.baseFingerprint,
      candidateFingerprint: fingerprintStructure(input.candidate),
      previewRevision: 1,
      checks: input.checks,
      inspectionTargets: input.inspectionTargets,
      previewComplete: true,
      diff: {
        added: input.changeSet.added ?? [],
        removed: input.changeSet.removed ?? [],
        moved: input.changeSet.moved ?? [],
        addedCount: input.changeSet.addedCount ?? 0,
        removedCount: input.changeSet.removedCount ?? 0,
        movedCount: input.changeSet.movedCount ?? 0,
        summary: `${input.changeSet.movedCount ?? 0} moved`,
        bounds: input.changeSet.changedBounds ?? null,
      },
    } satisfies ProposalSnapshot))
    const response = await callZatomMcpTool('structure_pose_component', {
      componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
      anchorAtomId: 'water-O',
      directionAtomIds: ['water-H1'],
      target: { kind: 'atom', atomId: 'surface-O' },
      applyToWorkspace: true,
    }, {
      access: { host: 'webmcp', mode: () => 'propose-only' },
      readStructure: () => structuredClone(source),
      workspaceIdentity: () => ({
        viewportId: 'vp-water',
        revision: 4,
        structureFingerprint: fingerprintStructure(source),
        trajectoryFingerprint: null,
      }),
      proposal: {
        propose,
        readCandidate: () => { throw new Error('not used') },
        revise: () => { throw new Error('not used') },
        status: () => null,
        withdraw: () => null,
      },
    })

    expect(response.structuredContent.ok).toBe(true)
    const data = response.structuredContent.data as {
      appliedToWorkspace: boolean
      applicationBlocked: boolean
      proposal: ProposalSnapshot | null
    }
    expect(data.appliedToWorkspace).toBe(false)
    expect(data.applicationBlocked).toBe(false)
    expect(data.proposal).toMatchObject({
      id: 'semantic-proposal',
      intent: 'Pose 3-atom component around water-O: toward atom surface-O',
      viewportId: 'vp-water',
      workspaceRevision: 4,
    })
    expect(propose).toHaveBeenCalledOnce()
  })

  it('does not revise a ghost when the request is cancelled after candidate readback', async () => {
    const source = waterNearTarget()
    const candidateFingerprint = fingerprintStructure(source)
    const snapshot: ProposalSnapshot = {
      id: 'cancelled-refinement',
      intent: 'Pose water',
      status: 'pending',
      viewportId: 'vp-water',
      workspaceRevision: 4,
      baseFingerprint: 'base-fingerprint',
      candidateFingerprint,
      previewRevision: 1,
      diff: {
        added: [], removed: [], moved: [],
        addedCount: 3, removedCount: 0, movedCount: 0,
        summary: '+3 atoms', bounds: null,
      },
    }
    const controller = new AbortController()
    const revise = vi.fn<NonNullable<ZatomToolContext['proposal']>['revise']>()
    const readStructure = vi.fn(() => structuredClone(source))
    const response = await callZatomMcpTool('structure_pose_component', {
      proposalId: snapshot.id,
      expectedPreviewRevision: snapshot.previewRevision,
      expectedCandidateFingerprint: snapshot.candidateFingerprint,
      componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
      anchorAtomId: 'water-O',
      directionAtomIds: ['water-H1'],
      target: { kind: 'atom', atomId: 'surface-O' },
    }, {
      signal: controller.signal,
      readStructure,
      proposal: {
        propose: () => snapshot,
        readCandidate: async () => {
          controller.abort(new Error('user cancelled the pose'))
          return { proposal: snapshot, candidate: structuredClone(source) }
        },
        revise,
        status: () => snapshot,
        withdraw: () => snapshot,
      },
    })

    expect(response.structuredContent.ok).toBe(false)
    expect(response.structuredContent.error?.code).toBe('tool_execution_aborted')
    expect(revise).not.toHaveBeenCalled()
    expect(readStructure).not.toHaveBeenCalled()
  })

  it('fails closed when the target atom is part of the moving component', () => {
    const source = waterNearTarget()
    expect(() => poseStructureComponentSemantically({
      structure: source,
      componentAtomIds: ['water-O', 'water-H1', 'water-H2'],
      anchorAtomId: 'water-O',
      directionAtomIds: ['water-H1'],
      target: { kind: 'atom', atomId: 'water-H2' },
    })).toThrowError(expect.objectContaining<Partial<SemanticPoseInputError>>({
      code: 'target_atom_inside_component',
    }))
  })
})
