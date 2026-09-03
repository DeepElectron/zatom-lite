import { expect, it } from 'vitest'

import {
  ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
  type ZatomViewportBridgeOperation,
} from '../viewport-contracts'
import { handleZatomViewportBridgeRequest } from '../page-viewport-host'
import { useViewportManager } from '../../orchestration/viewportManager'
import { useAgentProposalStore } from '../../orchestration/agentProposalStore'
import { useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import {
  readActiveViewportStructure,
  readActiveViewportWorkspaceIdentity,
  writeActiveViewportStructure,
} from '../../agent/viewer-context'
import {
  ZATOM_STRUCTURE_SCHEMA,
  type ProposalSnapshot,
  type ZatomStructure,
  type ZatomWorkspaceIdentity,
} from '../../agent/contracts'
import { fingerprintStructure } from '../../agent/structure-math'

let requestCounter = 0

async function invoke(operation: ZatomViewportBridgeOperation, payload?: unknown, signal?: AbortSignal) {
  requestCounter += 1
  return handleZatomViewportBridgeRequest({
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
    requestId: `strict-${requestCounter}`,
    operation,
    ...(payload === undefined ? {} : { payload }),
  }, signal)
}

function visualExpectation(identity: ZatomWorkspaceIdentity) {
  return {
    expectedViewportId: identity.viewportId,
    expectedRevision: identity.revision,
    expectedStructureFingerprint: identity.structureFingerprint,
    expectedTrajectoryFingerprint: identity.trajectoryFingerprint,
  }
}

it('rejects malformed live-surface payloads before they reach viewport state', async () => {
  const unknownCameraField = await invoke('camera-look-at', {
    request: { target: 'all', surprise: true },
  })
  expect(unknownCameraField).toMatchObject({ ok: false })
  expect(unknownCameraField.error).toContain('unknown field')

  const ambiguousAnnotation = await invoke('guidance-annotate', {
    annotations: [{ atomIds: ['a'], position: [0, 0, 0], label: 'not one anchor' }],
    replace: true,
  })
  expect(ambiguousAnnotation).toMatchObject({ ok: false })
  expect(ambiguousAnnotation.error).toContain('exactly one')

  const invalidStyle = await invoke('viewer-style-apply', {
    patch: { surface: { opacity: 0.5, internalStoreKey: 'forbidden' } },
  })
  expect(invalidStyle).toMatchObject({ ok: false })
  expect(invalidStyle.error).toContain('unknown field')

  const invalidProjection = await invoke('viewer-style-apply', {
    patch: { cameraProjection: 'fisheye' },
  })
  expect(invalidProjection).toMatchObject({ ok: false })
  expect(invalidProjection.error).toContain('perspective or orthographic')

  const invalidResolution = await invoke('viewer-style-apply', {
    patch: { surface: { resolution: 12.5 } },
  })
  expect(invalidResolution).toMatchObject({ ok: false })
  expect(invalidResolution.error).toContain('non-negative integer')

  const outOfRangeResolution = await invoke('viewer-style-apply', {
    patch: { surface: { resolution: 81 } },
  })
  expect(outOfRangeResolution).toMatchObject({ ok: false })
  expect(outOfRangeResolution.error).toContain('[12, 80]')

  const invalidFieldSlice = await invoke('viewer-style-apply', {
    patch: { fieldSlice: { mode: 'cut-through' } },
  })
  expect(invalidFieldSlice).toMatchObject({ ok: false })
  expect(invalidFieldSlice.error).toContain('overlay or slice-only')

  const invalidSliceOpacity = await invoke('viewer-style-apply', {
    patch: { fieldSlice: { opacity: 0 } },
  })
  expect(invalidSliceOpacity).toMatchObject({ ok: false })
  expect(invalidSliceOpacity.error).toContain('[0.1, 1]')

  const invalidSliceContours = await invoke('viewer-style-apply', {
    patch: { fieldSlice: { contours: 21 } },
  })
  expect(invalidSliceContours).toMatchObject({ ok: false })
  expect(invalidSliceContours.error).toContain('[0, 20]')

  const callerAuthoredProposalDiff = await invoke('proposal-propose', {
    intent: 'preview',
    baseFingerprint: 'fnv1a64:test',
    workspaceRevision: 0,
    candidate: {},
    changeSet: { summary: 'trust me' },
  })
  expect(callerAuthoredProposalDiff).toMatchObject({ ok: false })
  expect(callerAuthoredProposalDiff.error).toContain('changeSet')
})

it('round-trips guarded proposal candidates and revisions through the renderer bridge', async () => {
  useAgentProposalStore.setState({ current: null, history: [] })
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [
      { id: 'a', element: 'C', position: [0, 0, 0] },
      { id: 'b', element: 'C', position: [1.4, 0, 0] },
    ],
  }
  const firstCandidate: ZatomStructure = {
    ...source,
    atoms: source.atoms.map((atom) => ({
      ...atom,
      position: [atom.position[0], atom.position[1], atom.position[2] + 1],
    })),
  }
  await writeActiveViewportStructure(source)
  const identity = readActiveViewportWorkspaceIdentity()
  const proposedResponse = await invoke('proposal-propose', {
    intent: 'Preview lifted pair',
    baseFingerprint: identity.structureFingerprint,
    workspaceRevision: identity.revision,
    candidate: firstCandidate,
    expectedViewportId: identity.viewportId,
  })
  expect(proposedResponse.ok).toBe(true)
  const proposed = (proposedResponse.value as { proposal: ProposalSnapshot }).proposal
  expect(proposed).toMatchObject({ previewRevision: 1, candidateFingerprint: fingerprintStructure(firstCandidate) })

  const readResponse = await invoke('proposal-read-candidate', {
    proposalId: proposed.id,
    expectedPreviewRevision: proposed.previewRevision,
    expectedCandidateFingerprint: proposed.candidateFingerprint,
    ...visualExpectation(identity),
  })
  expect(readResponse.ok).toBe(true)
  expect((readResponse.value as { candidate: { candidate: ZatomStructure } }).candidate.candidate)
    .toEqual(firstCandidate)

  const revisedCandidate: ZatomStructure = {
    ...firstCandidate,
    atoms: firstCandidate.atoms.map((atom) => atom.id === 'b'
      ? { ...atom, position: [0, 1.4, 1] }
      : atom),
  }
  const revisedResponse = await invoke('proposal-revise', {
    proposalId: proposed.id,
    expectedPreviewRevision: proposed.previewRevision,
    expectedCandidateFingerprint: proposed.candidateFingerprint,
    intent: 'Turn the pair upright',
    candidate: revisedCandidate,
    ...visualExpectation(identity),
  })
  expect(revisedResponse.ok).toBe(true)
  const revised = (revisedResponse.value as { proposal: ProposalSnapshot }).proposal
  expect(revised).toMatchObject({ id: proposed.id, status: 'pending', previewRevision: 2 })
  expect(revised.candidateFingerprint).toBe(fingerprintStructure(revisedCandidate))
  expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(fingerprintStructure(source))

  const cancelled = new AbortController()
  cancelled.abort(new Error('cancel before renderer revision'))
  const cancelledRevision = await invoke('proposal-revise', {
    proposalId: revised.id,
    expectedPreviewRevision: revised.previewRevision,
    expectedCandidateFingerprint: revised.candidateFingerprint,
    intent: 'Must never appear',
    candidate: firstCandidate,
    ...visualExpectation(identity),
  }, cancelled.signal)
  expect(cancelledRevision.ok).toBe(false)
  expect(useAgentProposalStore.getState().current).toMatchObject({
    id: revised.id,
    previewRevision: revised.previewRevision,
    candidateFingerprint: revised.candidateFingerprint,
  })

  const stale = await invoke('proposal-revise', {
    proposalId: proposed.id,
    expectedPreviewRevision: proposed.previewRevision,
    expectedCandidateFingerprint: proposed.candidateFingerprint,
    intent: 'Accidentally repeat an old relative edit',
    candidate: firstCandidate,
    ...visualExpectation(identity),
  })
  expect(stale.ok).toBe(false)
  expect(stale.error).toContain('preview changed')
  expect(stale.errorCode).toBe('stale_proposal_preview')

  expect(useAgentProposalStore.getState().claim(revised.id)?.status).toBe('applying')
  const applying = await invoke('proposal-revise', {
    proposalId: revised.id,
    expectedPreviewRevision: revised.previewRevision,
    expectedCandidateFingerprint: revised.candidateFingerprint,
    intent: 'Too late to revise',
    candidate: revisedCandidate,
    ...visualExpectation(identity),
  })
  expect(applying.ok).toBe(false)
  expect(applying.error).toContain('already being applied')
  expect(applying.errorCode).toBe('proposal_not_pending')
  useAgentProposalStore.getState().release(revised.id)
  useAgentProposalStore.getState().resolve(revised.id, 'discarded')
})

it('enforces viewport identity on live observation before reading renderer state', async () => {
  const response = await invoke('read-viewer-scene', { expectedViewportId: 'not-the-active-viewport' })
  expect(response).toMatchObject({ ok: false })
  expect(response.error).toContain('Active viewport changed')
})

it('rejects a visual write when the active pane changed after the caller observed identity', async () => {
  const manager = useViewportManager.getState()
  manager.setLayout('1x2')
  manager.setActive('vp-1')
  const source: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'pane-source', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(source)
  const expected = readActiveViewportWorkspaceIdentity()

  manager.setActive('vp-2')
  const target = useViewportManager.getState().getActiveStore()
  target.getState().setHideHydrogens(false)
  try {
    const response = await invoke('viewer-style-apply', {
      patch: { hideHydrogens: true },
      ...visualExpectation(expected),
    })
    expect(response).toMatchObject({ ok: false })
    expect(response.error).toContain('Active viewport changed')
    expect(target.getState().hideHydrogens).toBe(false)
  } finally {
    useViewportManager.getState().setLayout('1x1')
  }
})

it('rejects same-pane ABA revision drift before mutating the live selection', async () => {
  const manager = useViewportManager.getState()
  manager.setLayout('1x1')
  manager.setActive('vp-1')
  const original: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'aba-atom', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(original)
  const expected = readActiveViewportWorkspaceIdentity()
  await writeActiveViewportStructure({
    ...original,
    atoms: [{ ...original.atoms[0], position: [1, 0, 0] }],
  })
  await writeActiveViewportStructure(original)
  const current = readActiveViewportWorkspaceIdentity()
  expect(current.structureFingerprint).toBe(expected.structureFingerprint)
  expect(current.revision).toBeGreaterThan(expected.revision)

  const store = useViewportManager.getState().getActiveStore()
  store.getState().selectAtoms([])
  const response = await invoke('apply-viewer-selection', {
    atomIds: ['aba-atom'],
    ...visualExpectation(expected),
  })
  expect(response).toMatchObject({ ok: false })
  expect(response.error).toContain('Active workspace changed before apply-viewer-selection')
  expect([...store.getState().selectedAtomIds]).toEqual([])
})

it('rejects an already-cancelled renderer commit before its compare-and-set boundary', async () => {
  useViewportManager.getState().setLayout('1x1')
  useViewportManager.getState().setActive('vp-1')
  const before: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: [{ id: 'renderer-cancel', element: 'C', position: [0, 0, 0] }],
  }
  await writeActiveViewportStructure(before)
  const identity = readActiveViewportWorkspaceIdentity()
  const controller = new AbortController()
  controller.abort(new Error('bridge caller cancelled'))
  const response = await invoke('commit-structure', {
    structure: {
      ...before,
      atoms: [{ id: 'renderer-cancel', element: 'N', position: [1, 0, 0] }],
    },
    expectedViewportId: identity.viewportId,
    expectedStructureFingerprint: identity.structureFingerprint,
    expectedRevision: identity.revision,
  }, controller.signal)
  expect(response).toMatchObject({ ok: false, error: 'bridge caller cancelled' })
  expect(readActiveViewportStructure()?.atoms[0]).toMatchObject({ element: 'C', position: [0, 0, 0] })
})

it('activates only the requested visible crystal pane from the expected source', async () => {
  const manager = useViewportManager.getState()
  manager.setLayout('1x2')
  manager.setActive('vp-1')
  manager.toggleMaximized('vp-1')
  try {
    const activated = await invoke('viewport-activate', {
      slotId: 'vp-2',
      expectedViewportId: 'vp-1',
    })
    expect(activated).toMatchObject({ ok: true })
    expect(useViewportManager.getState().activeViewportId).toBe('vp-2')
    expect(useViewportManager.getState().maximizedViewportId).toBe('vp-2')

    const stale = await invoke('viewport-activate', {
      slotId: 'vp-1',
      expectedViewportId: 'vp-1',
    })
    expect(stale).toMatchObject({ ok: false })
    expect(stale.error).toContain('changed from vp-1 to vp-2')
    expect(useViewportManager.getState().activeViewportId).toBe('vp-2')
  } finally {
    const current = useViewportManager.getState()
    if (current.maximizedViewportId) current.toggleMaximized(current.maximizedViewportId)
    useViewportManager.getState().setLayout('1x1')
  }
})

it('clears an exact non-active pane through the renderer without changing the split', async () => {
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
  const manager = useViewportManager.getState()
  manager.setLayout('1x2')
  manager.setActive('vp-2')
  await writeActiveViewportStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'renderer side pane',
    atoms: [{ id: 'side-cl', element: 'Cl', position: [1, 0, 0] }],
  })
  const expected = readActiveViewportWorkspaceIdentity()
  const sideStore = useViewportManager.getState().getActiveStore()
  manager.setActive('vp-1')
  try {
    const response = await invoke('viewport-clear', {
      slotId: 'vp-2',
      targetStructureFingerprint: expected.structureFingerprint,
      targetTrajectoryFingerprint: expected.trajectoryFingerprint,
      targetWorkspaceRevision: expected.revision,
    })
    expect(response).toMatchObject({ ok: true })
    expect(useViewportManager.getState().layout).toBe('1x2')
    expect(useViewportManager.getState().activeViewportId).toBe('vp-1')
    expect(sideStore.getState().atoms).toHaveLength(0)
    const review = useAgentOperationReview.getState().control
    expect(review.phase).toBe('awaiting_review')
    if (review.phase !== 'awaiting_review' || review.review.subject.kind !== 'structure'
      || !review.review.subject.revert) throw new Error('missing renderer clear review')
    expect(review.review.subject.viewportId).toBe('vp-2')
    await review.review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(sideStore.getState().atoms).toHaveLength(1)
  } finally {
    if (useAgentOperationReview.getState().control.phase === 'awaiting_review') {
      useAgentOperationReview.getState().dismissReview()
    }
    manager.setLayout('1x1')
  }
})
