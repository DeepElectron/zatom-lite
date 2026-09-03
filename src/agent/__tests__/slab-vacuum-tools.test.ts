import { describe, expect, it } from 'vitest'

import type { ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { zatomToolDomain, zatomToolTier } from '../domains'
import { ensureSlabVacuum } from '../slab-vacuum'
import { createCertifiedMinimumImageCalculator, fingerprintStructure } from '../structure-math'
import { executeZatomAgentTool } from '../tools'

const obliqueOpenSlab: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'oblique open slab',
  lattice: {
    vectors: [[4, 0, 0], [0, 4, 0], [1.25, 0.5, 8]],
    periodic: [true, true, false],
  },
  atoms: [
    { id: 'a', element: 'Pt', position: [1, 1, 3] },
    { id: 'b', element: 'Pt', position: [3, 1, 3] },
    { id: 'c', element: 'Pt', position: [1, 3, 5] },
    { id: 'd', element: 'Pt', position: [3, 3, 5] },
  ],
}

const periodicBoundarySlab: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'boundary-straddling periodic slab',
  lattice: {
    vectors: [[4, 0, 0], [0, 4, 0], [1, 0, 8]],
    periodic: [true, true, true],
  },
  atoms: [
    { id: 'lower-a', element: 'Cu', position: [0, 0, 0.5] },
    { id: 'lower-b', element: 'Cu', position: [2, 2, 0.5] },
    { id: 'upper-a', element: 'Cu', position: [0, 2, 7.5] },
    { id: 'upper-b', element: 'Cu', position: [2, 0, 7.5] },
  ],
}

const bulk: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'cubic bulk',
  lattice: { vectors: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], periodic: [true, true, true] },
  atoms: [{ id: 'cu', element: 'Cu', position: [0, 0, 0] }],
}

describe('slab vacuum candidate', () => {
  it('grows perpendicular spacing in an oblique cell while preserving shear, PBC flags, and geometry', () => {
    const result = ensureSlabVacuum({ structure: obliqueOpenSlab, minimumVacuumA: 12 })

    expect(result.changed).toBe(true)
    expect(result.metrics).toMatchObject({
      axis: 'c',
      axisResolution: 'declared-aperiodic',
      periodicAlongAxis: false,
      sourceVacuumA: 6,
      achievedVacuumA: 12,
      addedVacuumA: 6,
      sourceCellSpacingA: 8,
      resultCellSpacingA: 14,
    })
    expect(result.structure.lattice?.vectors[2]).toEqual([1.25, 0.5, 14])
    expect(result.structure.lattice?.periodic).toEqual([true, true, false])
    expect(result.structure.atoms.map((atom) => atom.position)).toEqual([
      [1, 1, 6],
      [3, 1, 6],
      [1, 3, 8],
      [3, 3, 8],
    ])
    expect(result.changeSet.latticeChanged).toBe(true)
    expect(result.checks.find((check) => check.id === 'vacuum.in_plane_geometry')?.status).toBe('pass')
    expect(result.checks.some((check) => check.status === 'fail')).toBe(false)
  })

  it('unwraps a periodic boundary-straddling slab into one body and leaves its MIC geometry unchanged', () => {
    const beforeMic = createCertifiedMinimumImageCalculator(periodicBoundarySlab.lattice!)([0, 2, 7]).distance
    const result = ensureSlabVacuum({ structure: periodicBoundarySlab, minimumVacuumA: 12 })
    const byId = new Map(result.structure.atoms.map((atom) => [atom.id, atom.position]))
    const lower = byId.get('lower-a')!
    const upper = byId.get('upper-a')!
    const directAfter = Math.hypot(
      upper[0] - lower[0],
      upper[1] - lower[1],
      upper[2] - lower[2],
    )

    expect(result.metrics).toMatchObject({
      axis: 'c',
      axisResolution: 'detected-vacuum',
      periodicAlongAxis: true,
      sourceVacuumA: 7,
      achievedVacuumA: 12,
      addedVacuumA: 5,
      resultCellSpacingA: 13,
    })
    expect(result.structure.lattice?.vectors[2]).toEqual([1, 0, 13])
    expect(result.structure.lattice?.periodic).toEqual([true, true, true])
    expect(directAfter).toBeCloseTo(beforeMic, 10)
    expect(result.checks.find((check) => check.id === 'vacuum.atoms_inside_cell')?.status).toBe('pass')
  })

  it('fails closed on bulk auto-detection but permits an explicit, reviewable cleavage axis', () => {
    expect(() => ensureSlabVacuum({ structure: bulk, minimumVacuumA: 12 })).toThrowError(
      expect.objectContaining({ code: 'vacuum_axis_not_found' }),
    )

    const explicit = ensureSlabVacuum({ structure: bulk, minimumVacuumA: 12, axis: 'c' })
    expect(explicit.changed).toBe(true)
    expect(explicit.metrics).toMatchObject({ axis: 'c', axisResolution: 'explicit' })
    expect(explicit.checks.find((check) => check.id === 'vacuum.axis_resolution')?.status).toBe('warn')
    expect(explicit.structure.lattice?.periodic).toEqual([true, true, true])
  })
})

describe('structure_ensure_slab_vacuum WebMCP tool', () => {
  it('is a default surface-domain compute tool and makes an already-satisfied request a true no-op', async () => {
    expect(zatomToolDomain('structure_ensure_slab_vacuum')).toBe('surface')
    expect(zatomToolTier('structure_ensure_slab_vacuum')).toBe('compute')

    const sufficient = ensureSlabVacuum({ structure: obliqueOpenSlab, minimumVacuumA: 12 }).structure
    const before = fingerprintStructure(sufficient)
    let writes = 0
    const response = await executeZatomAgentTool('structure_ensure_slab_vacuum', {
      minimumVacuumA: 10,
      applyToWorkspace: true,
    }, {
      readStructure: () => sufficient,
      writeStructure: () => { writes += 1 },
    })
    const data = response.data as {
      appliedToWorkspace: boolean
      proposal: unknown
      result: { changed: boolean; structure: ZatomStructure }
    }

    expect(response.ok).toBe(true)
    expect(data.result.changed).toBe(false)
    expect(data.appliedToWorkspace).toBe(false)
    expect(data.proposal).toBeNull()
    expect(writes).toBe(0)
    expect(fingerprintStructure(data.result.structure)).toBe(before)
    expect(response.summary).toContain('no proposal, write, revision, or review was created')
  })

  it('turns applyToWorkspace into a viewport-bound proposal under Propose only', async () => {
    let writes = 0
    const proposals: Array<Parameters<NonNullable<ZatomToolContext['proposal']>['propose']>[0]> = []
    const sourceFingerprint = fingerprintStructure(obliqueOpenSlab)
    const context: ZatomToolContext = {
      access: { host: 'webmcp', mode: () => 'propose-only' },
      readStructure: () => obliqueOpenSlab,
      writeStructure: () => { writes += 1 },
      workspaceIdentity: () => ({
        viewportId: 'vp-slab',
        revision: 9,
        structureFingerprint: sourceFingerprint,
        trajectoryFingerprint: null,
      }),
      proposal: {
        propose: async (input) => {
          proposals.push(input)
          return {
            id: 'vacuum-proposal',
            intent: input.intent,
            status: 'pending',
            baseFingerprint: input.baseFingerprint,
            viewportId: input.viewportId,
            workspaceRevision: input.workspaceRevision,
            candidateFingerprint: fingerprintStructure(input.candidate),
            previewRevision: 1,
            diff: {
              added: [],
              removed: [],
              moved: input.changeSet.moved ?? [],
              addedCount: 0,
              removedCount: 0,
              movedCount: input.changeSet.movedCount ?? 0,
              summary: 'lattice changed',
              bounds: null,
            },
          }
        },
        readCandidate: () => { throw new Error('not used') },
        revise: () => { throw new Error('not used') },
        status: () => null,
        withdraw: () => null,
      },
    }
    const response = await executeZatomAgentTool('structure_ensure_slab_vacuum', {
      minimumVacuumA: 12,
      applyToWorkspace: true,
    }, context)
    const data = response.data as {
      appliedToWorkspace: boolean
      applicationBlocked: boolean
      proposal: { id: string; viewportId: string; workspaceRevision: number } | null
    }

    expect(response.ok).toBe(true)
    expect(data.appliedToWorkspace).toBe(false)
    expect(data.applicationBlocked).toBe(false)
    expect(data.proposal).toMatchObject({ id: 'vacuum-proposal', viewportId: 'vp-slab', workspaceRevision: 9 })
    expect(proposals[0]).toMatchObject({
      baseFingerprint: sourceFingerprint,
      viewportId: 'vp-slab',
      workspaceRevision: 9,
    })
    expect(proposals[0]?.changeSet.latticeChanged).toBe(true)
    expect(writes).toBe(0)
    expect(response.checks?.find((check) => check.id === 'candidate.application_gate')?.status).toBe('pass')
  })

  it('rejects a stale active-workspace fingerprint before constructing a candidate', async () => {
    const response = await executeZatomAgentTool('structure_ensure_slab_vacuum', {
      minimumVacuumA: 12,
      expectedFingerprint: 'fnv1a64:stale',
    }, { readStructure: () => obliqueOpenSlab })

    expect(response.ok).toBe(false)
    expect(response.error?.code).toBe('stale_fingerprint')
  })
})
