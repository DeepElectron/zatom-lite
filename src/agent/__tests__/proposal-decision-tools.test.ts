import { describe, expect, it, vi } from 'vitest'

import { ZATOM_STRUCTURE_SCHEMA, type ProposalSnapshot, type ZatomProposalSurface, type ZatomStructure } from '../contracts'
import { STRUCTURE_OPERATIONS_ZATOM_AGENT_TOOLS } from '../structure-operation-tools'
import { fingerprintStructure } from '../structure-math'

const tool = (name: string) => {
  const found = STRUCTURE_OPERATIONS_ZATOM_AGENT_TOOLS.find((entry) => entry.manifest.name === name)
  if (!found) throw new Error(`Missing test tool ${name}`)
  return found
}

function proposal(status: ProposalSnapshot['status']): ProposalSnapshot {
  return {
    id: 'proposal-choice',
    intent: 'Place water on bridge site',
    status,
    diff: {
      added: [], removed: [], moved: [],
      addedCount: 3, removedCount: 0, movedCount: 0,
      summary: '+3 atoms', bounds: null,
    },
    viewportId: 'vp-1',
    workspaceRevision: 4,
    baseFingerprint: 'base-fingerprint',
    candidateFingerprint: 'candidate-fingerprint',
    previewRevision: 1,
  }
}

describe('proposal decision tools', () => {
  it('withdraws a just-published ghost when cancellation wins the publication race', async () => {
    const source: ZatomStructure = {
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'c', element: 'C', position: [0, 0, 0] }],
    }
    const sourceFingerprint = fingerprintStructure(source)
    const controller = new AbortController()
    let releasePublication!: () => void
    const publicationGate = new Promise<void>((resolve) => { releasePublication = resolve })
    const withdraw = vi.fn(() => proposal('discarded'))
    const surface: ZatomProposalSurface = {
      propose: async () => {
        await publicationGate
        return {
          ...proposal('pending'),
          baseFingerprint: sourceFingerprint,
          candidateFingerprint: 'published-candidate',
        }
      },
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => proposal('pending'),
      withdraw,
    }
    const running = tool('structure_propose_operations').execute({
      intent: 'Move the carbon atom',
      operations: [{ op: 'translate', selection: { atomIds: ['c'] }, vector: [1, 0, 0] }],
    }, {
      signal: controller.signal,
      readStructure: () => source,
      workspaceIdentity: () => ({
        viewportId: 'vp-1', revision: 4,
        structureFingerprint: sourceFingerprint, trajectoryFingerprint: null,
      }),
      proposal: surface,
    })
    await Promise.resolve()
    controller.abort(new Error('user cancelled proposal creation'))
    releasePublication()

    const result = await running
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('tool_execution_aborted')
    expect(withdraw).toHaveBeenCalledWith('proposal-choice')
  })

  it('waits for a user decision and returns promptly when it changes', async () => {
    let status: ProposalSnapshot['status'] = 'pending'
    const surface: ZatomProposalSurface = {
      propose: () => proposal('pending'),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => proposal(status),
      withdraw: () => proposal('discarded'),
    }
    setTimeout(() => { status = 'applied' }, 30)
    const started = performance.now()
    const result = await tool('structure_proposal_status').execute(
      { proposalId: 'proposal-choice', waitMs: 2_000 },
      { proposal: surface },
    )
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      status: 'applied',
      previewRevision: 1,
      candidateFingerprint: 'candidate-fingerprint',
    })
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('lets cancellation abort a pending wait', async () => {
    const controller = new AbortController()
    const surface: ZatomProposalSurface = {
      propose: () => proposal('pending'),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => proposal('pending'),
      withdraw: () => proposal('discarded'),
    }
    setTimeout(() => controller.abort(), 20)
    const started = performance.now()
    const result = await tool('structure_proposal_status').execute(
      { proposalId: 'proposal-choice', waitMs: 30_000 },
      { proposal: surface, signal: controller.signal },
    )
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('tool_execution_aborted')
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('discards a pending ghost without touching the active structure', async () => {
    let withdrawn = 0
    const surface: ZatomProposalSurface = {
      propose: () => proposal('pending'),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => proposal('pending'),
      withdraw: () => {
        withdrawn += 1
        return proposal('discarded')
      },
    }
    const result = await tool('structure_cancel_proposal').execute(
      { proposalId: 'proposal-choice' },
      { proposal: surface },
    )
    expect(result.ok).toBe(true)
    expect((result.data as { status: string }).status).toBe('discarded')
    expect(result.summary).toMatch(/structure was not changed/i)
    expect(withdrawn).toBe(1)
  })

  it('does not withdraw after cancellation wins the status read race', async () => {
    const controller = new AbortController()
    const withdraw = vi.fn(() => proposal('discarded'))
    const surface: ZatomProposalSurface = {
      propose: () => proposal('pending'),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: async () => {
        controller.abort()
        return proposal('pending')
      },
      withdraw,
    }
    const result = await tool('structure_cancel_proposal').execute(
      { proposalId: 'proposal-choice' },
      { proposal: surface, signal: controller.signal },
    )
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('tool_execution_aborted')
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('is idempotent after discard and refuses to interrupt an atomic commit', async () => {
    let status: ProposalSnapshot['status'] = 'discarded'
    let withdrawn = 0
    const surface: ZatomProposalSurface = {
      propose: () => proposal('pending'),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => proposal(status),
      withdraw: () => {
        withdrawn += 1
        return proposal('discarded')
      },
    }
    const already = await tool('structure_cancel_proposal').execute(
      { proposalId: 'proposal-choice' },
      { proposal: surface },
    )
    expect(already.ok).toBe(true)
    expect(withdrawn).toBe(0)

    status = 'applying'
    const applying = await tool('structure_cancel_proposal').execute(
      { proposalId: 'proposal-choice' },
      { proposal: surface },
    )
    expect(applying.ok).toBe(false)
    expect(applying.error?.code).toBe('proposal_commit_in_progress')
    expect(withdrawn).toBe(0)
  })
})
