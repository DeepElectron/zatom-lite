import { beforeEach, describe, expect, it } from 'vitest'

import type { ZatomToolContext, ZatomToolDefinition } from '../contracts'
import { GUIDE_ZATOM_AGENT_TOOLS } from '../guide-tools'
import {
  activeViewportGuidanceSurface,
  cancelGuidanceCandidatesInViewport,
  confirmGuidanceCandidateInViewport,
  focusGuidanceCandidateInViewport,
} from '../guidance-surface'
import { getActiveViewportStoreApi } from '../../orchestration/ViewportContext'
import { useAgentGuidance } from '../../orchestration/agentGuidanceStore'
import { useViewportManager } from '../../orchestration/viewportManager'

const tool = (name: string): ZatomToolDefinition => {
  const found = GUIDE_ZATOM_AGENT_TOOLS.find((candidate) => candidate.manifest.name === name)
  if (!found) throw new Error(`Missing ${name}`)
  return found
}

const api = getActiveViewportStoreApi()
const atoms = [
  { id: 'a', element: 'C', position: [0, 0, 0] as [number, number, number], cartesian: [0, 0, 0] as [number, number, number] },
  { id: 'b', element: 'O', position: [1.2, 0, 0] as [number, number, number], cartesian: [1.2, 0, 0] as [number, number, number] },
  { id: 'c', element: 'H', position: [0, 1, 0] as [number, number, number], cartesian: [0, 1, 0] as [number, number, number] },
]

function candidateId(): string {
  const id = useAgentGuidance.getState().candidates?.id
  if (!id) throw new Error('Expected a candidate set')
  return id
}

beforeEach(() => {
  useAgentGuidance.getState().clear('all')
  api.setState({
    atoms,
    selectedAtomIds: new Set(['a']),
    isAnimatingCamera: false,
  })
})

describe('candidate decision loop', () => {
  it('focuses, confirms, wakes a waiter immediately, and stays readable until clear', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
      { atomIds: ['c'], label: 'hydrogen' },
    ])
    const id = candidateId()
    const waiting = tool('guide_candidate_status').execute(
      { candidateSetId: id, waitMs: 2_000 },
      { guidance: activeViewportGuidanceSurface } as ZatomToolContext,
    )

    focusGuidanceCandidateInViewport(2, api)
    expect([...api.getState().selectedAtomIds]).toEqual(['c'])
    confirmGuidanceCandidateInViewport(api)

    const result = await waiting
    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      candidateSetId: id,
      status: 'confirmed',
      focusedIndex: 2,
      timedOut: false,
      choice: { index: 2, atomIds: ['c'], label: 'hydrogen' },
    })
    expect(useAgentGuidance.getState().candidates?.decision.status).toBe('confirmed')

    expect(() => activeViewportGuidanceSurface.presentCandidates('Replacement?', [
      { atomIds: ['a'], label: 'carbon' },
    ])).toThrow(/clear it/i)
    activeViewportGuidanceSurface.clear('candidates')
    expect(() => activeViewportGuidanceSurface.presentCandidates('Replacement?', [
      { atomIds: ['a'], label: 'carbon' },
    ])).not.toThrow()
  })

  it('cancels promptly and restores only the selection owned by candidate focus', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    const id = candidateId()
    focusGuidanceCandidateInViewport(1, api)
    const waiting = activeViewportGuidanceSurface.candidateStatus(id, 2_000)
    cancelGuidanceCandidatesInViewport(api)

    await expect(waiting).resolves.toMatchObject({ status: 'cancelled', timedOut: false })
    expect([...api.getState().selectedAtomIds]).toEqual(['a'])
    expect(useAgentGuidance.getState().candidates?.decision.status).toBe('cancelled')

    activeViewportGuidanceSurface.clear('candidates')
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    focusGuidanceCandidateInViewport(1, api)
    api.getState().selectAtoms(['c'])
    cancelGuidanceCandidatesInViewport(api)
    expect([...api.getState().selectedAtomIds]).toEqual(['c'])
  })

  it('restores an abandoned preview on clear but preserves a confirmed selection', () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    focusGuidanceCandidateInViewport(1, api)
    expect([...api.getState().selectedAtomIds]).toEqual(['b'])
    activeViewportGuidanceSurface.clear('candidates')
    expect([...api.getState().selectedAtomIds]).toEqual(['a'])

    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    focusGuidanceCandidateInViewport(1, api)
    confirmGuidanceCandidateInViewport(api)
    activeViewportGuidanceSurface.clear('candidates')
    expect([...api.getState().selectedAtomIds]).toEqual(['b'])
  })

  it('does not restore an obsolete pre-focus selection after the structure revision changes', () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    focusGuidanceCandidateInViewport(1, api)
    expect([...api.getState().selectedAtomIds]).toEqual(['b'])
    api.setState({ atoms: atoms.map((atom, index) => index === 0
      ? { ...atom, cartesian: [0.3, 0, 0] as [number, number, number] }
      : atom) })

    activeViewportGuidanceSurface.clear('candidates')
    expect([...api.getState().selectedAtomIds]).toEqual(['b'])
  })

  it('focuses a position-only target without changing atom selection', () => {
    const shown = tool('guide_present_candidates').execute(
      { label: 'Which vacancy?', items: [{ position: [4, 5, 6], label: 'vacancy' }] },
      { guidance: activeViewportGuidanceSurface } as ZatomToolContext,
    )
    return shown.then((result) => {
      expect(result.ok).toBe(true)
      focusGuidanceCandidateInViewport(1, api)
      expect([...api.getState().selectedAtomIds]).toEqual(['a'])
      expect(useAgentGuidance.getState().candidates?.items[0]).toMatchObject({
        atomIds: [], position: [4, 5, 6], label: 'vacancy',
      })
    })
  })

  it('releases an atom preview before moving to a point-only candidate', () => {
    activeViewportGuidanceSurface.presentCandidates('Which target?', [
      { atomIds: ['b'], label: 'oxygen' },
      { position: [4, 5, 6], label: 'vacancy' },
    ])
    focusGuidanceCandidateInViewport(1, api)
    expect([...api.getState().selectedAtomIds]).toEqual(['b'])

    focusGuidanceCandidateInViewport(2, api)
    expect([...api.getState().selectedAtomIds]).toEqual(['a'])
    cancelGuidanceCandidatesInViewport(api)
    expect([...api.getState().selectedAtomIds]).toEqual(['a'])
  })

  it('never returns a candidate decision through a different active viewport', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    const id = candidateId()
    const manager = useViewportManager.getState()
    const originalViewportId = manager.activeViewportId
    manager.setLayout('1x2')
    const otherViewportId = Object.keys(useViewportManager.getState().viewports)
      .find((viewportId) => viewportId !== originalViewportId)
    if (!otherViewportId) throw new Error('Expected a second viewport')
    useViewportManager.getState().setActive(otherViewportId)
    try {
      const result = await tool('guide_candidate_status').execute(
        { candidateSetId: id },
        { guidance: activeViewportGuidanceSurface } as ZatomToolContext,
      )
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('candidate_viewport_mismatch')
      expect(() => activeViewportGuidanceSurface.clear('candidates')).toThrow(/active viewport/i)
      expect(useAgentGuidance.getState().candidates?.id).toBe(id)
    } finally {
      useViewportManager.getState().setActive(originalViewportId)
      activeViewportGuidanceSurface.clear('candidates')
      useViewportManager.getState().setLayout('1x1')
    }
  })

  it('marks a pending set stale when its workspace revision changes', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    const id = candidateId()
    const waiting = activeViewportGuidanceSurface.candidateStatus(id, 2_000)
    api.setState({ atoms: atoms.map((atom, index) => index === 0
      ? { ...atom, cartesian: [0.2, 0, 0] as [number, number, number] }
      : atom) })
    await expect(waiting).resolves.toMatchObject({ status: 'stale', timedOut: false })
  })

  it('invalidates a confirmed choice if the structure changes before the Agent reads it', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    const id = candidateId()
    focusGuidanceCandidateInViewport(1, api)
    confirmGuidanceCandidateInViewport(api)
    expect(useAgentGuidance.getState().candidates?.decision.status).toBe('confirmed')

    api.setState({ atoms: atoms.map((atom, index) => index === 1
      ? { ...atom, cartesian: [1.4, 0, 0] as [number, number, number] }
      : atom) })
    await expect(activeViewportGuidanceSurface.candidateStatus(id)).resolves.toMatchObject({
      status: 'stale', choice: null, focusedIndex: null,
    })
    expect(useAgentGuidance.getState().candidates?.decision.status).toBe('stale')
  })

  it('returns pending on timeout and aborts a wait without leaking it', async () => {
    activeViewportGuidanceSurface.presentCandidates('Which atom?', [
      { atomIds: ['b'], label: 'oxygen' },
    ])
    const id = candidateId()
    await expect(activeViewportGuidanceSurface.candidateStatus(id, 5)).resolves.toMatchObject({
      status: 'pending', timedOut: true,
    })

    const controller = new AbortController()
    const waiting = tool('guide_candidate_status').execute(
      { candidateSetId: id, waitMs: 2_000 },
      { guidance: activeViewportGuidanceSurface, signal: controller.signal } as ZatomToolContext,
    )
    controller.abort(new Error('user cancelled wait'))
    await expect(waiting).resolves.toMatchObject({
      ok: false,
      error: { code: 'tool_execution_aborted', message: 'user cancelled wait' },
    })
  })
})
