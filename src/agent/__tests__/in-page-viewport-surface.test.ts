import { beforeEach, describe, expect, it } from 'vitest'

import { selectPendingReview, useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import { useViewportManager } from '../../orchestration/viewportManager'
import { useAgentProposalStore } from '../../orchestration/agentProposalStore'
import { executeZatomAgentTool } from '../tools'
import { fingerprintStructure } from '../structure-math'
import {
  activeViewportToolContext,
  clearActiveViewportWorkspace,
  clearViewportWorkspace,
  commitActiveViewportStructure,
  discardPendingProposal,
  readActiveViewportStructure,
  readActiveViewportTrajectory,
  readActiveViewportWorkspaceIdentity,
  writeActiveViewportStructure,
  writeActiveViewportTrajectory,
} from '../viewer-context'
import { fingerprintTrajectory } from '../trajectory'
import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type ZatomStructure,
  type ZatomTrajectory,
} from '../contracts'

const base: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'main surface',
  atoms: [{ id: 'main-pt', element: 'Pt', position: [0, 0, 0] }],
}

describe('native in-page viewport surface', () => {
  beforeEach(async () => {
    useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null })
    useAgentProposalStore.setState({ current: null, history: [] })
    useViewportManager.getState().setLayout('1x1')
    useViewportManager.getState().setActive('vp-1')
    await writeActiveViewportStructure(base)
  })

  it('exposes the current browser instance and reversible free layouts', async () => {
    const instances = await executeZatomAgentTool('app_instances', {}, activeViewportToolContext)
    expect(instances.ok).toBe(true)
    expect(instances.data).toMatchObject({
      instances: [{ instanceId: 'in-page', current: true }],
    })

    const changed = await executeZatomAgentTool('viewport_set_layout', {
      layout: 'free-l-shape',
      instanceId: 'in-page',
    }, activeViewportToolContext)
    expect(changed.ok).toBe(true)
    expect((changed.data as { layout: string }).layout).toMatch(/^free\(l-shape/)
    const review = selectPendingReview(useAgentOperationReview.getState())
    expect(review?.subject.kind).toBe('workspace')
    if (review?.subject.kind !== 'workspace') throw new Error('missing layout review')
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(useViewportManager.getState().freeLayout).toBeNull()
    expect(useViewportManager.getState().layout).toBe('1x1')
  })

  it('activates an explicit visible pane and rejects a stale source pane', async () => {
    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().toggleMaximized('vp-1')

    const activated = await executeZatomAgentTool('viewport_activate', {
      slotId: 'vp-2',
      expectedActiveViewportId: 'vp-1',
      instanceId: 'in-page',
    }, activeViewportToolContext)
    expect(activated.ok).toBe(true)
    expect(useViewportManager.getState().activeViewportId).toBe('vp-2')
    expect(useViewportManager.getState().maximizedViewportId).toBe('vp-2')
    expect((activated.data as { slots: Array<{ slotId: string; active: boolean }> }).slots)
      .toContainEqual(expect.objectContaining({ slotId: 'vp-2', active: true }))
    expect(selectPendingReview(useAgentOperationReview.getState())).toBeNull()

    const stale = await executeZatomAgentTool('viewport_activate', {
      slotId: 'vp-1',
      expectedActiveViewportId: 'vp-1',
    }, activeViewportToolContext)
    expect(stale.ok).toBe(false)
    expect(stale.error?.message).toContain('changed from vp-1 to vp-2')
    expect(useViewportManager.getState().activeViewportId).toBe('vp-2')

    useViewportManager.getState().toggleMaximized('vp-2')
  })

  it('parses the whole mount first, preserves the main pane, and rolls back as one decision', async () => {
    const mainFingerprint = fingerprintStructure(readActiveViewportStructure()!)
    const mounted = await executeZatomAgentTool('viewport_mount_structures', {
      instanceId: 'in-page',
      preserveExisting: true,
      structures: [{
        label: 'water candidate',
        format: 'xyz',
        text: '3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.239 0.9266 0\n',
        atomCount: 3,
      }],
    }, activeViewportToolContext)
    expect(mounted.ok).toBe(true)
    expect(useViewportManager.getState().layout).toBe('1x2')
    useViewportManager.getState().setActive('vp-1')
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(mainFingerprint)
    useViewportManager.getState().setActive('vp-2')
    expect(readActiveViewportStructure()?.atoms).toHaveLength(3)

    const review = selectPendingReview(useAgentOperationReview.getState())
    expect(review?.label).toBe('Mounted viewport candidates')
    if (review?.subject.kind !== 'workspace') throw new Error('missing aggregate mount review')
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(useViewportManager.getState().layout).toBe('1x1')
    expect(useViewportManager.getState().activeViewportId).toBe('vp-1')
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(mainFingerprint)
  })

  it('clears one exact pane, preserves the split and other panes, and restores attached visuals on revert', async () => {
    const mainIdentity = readActiveViewportWorkspaceIdentity()
    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().setActive('vp-2')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'side density',
      atoms: [{ id: 'side-o', element: 'O', position: [1, 0, 0] }],
    })
    const sideStore = useViewportManager.getState().getActiveStore()
    const cube = { values: new Float32Array([0.1, 0.2]), dimensions: [1, 1, 2] }
    sideStore.getState().loadCubData(cube, 'density.cube')
    sideStore.setState({
      constructedPlane: {
        id: 'review-plane',
        points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        normal: [0, 0, 1],
        d: 0,
        center: [0, 0, 0],
        method: 'direct',
        sourceIds: ['side-o'],
      },
    } as never)
    const target = readActiveViewportWorkspaceIdentity()
    useViewportManager.getState().setActive('vp-1')

    const cleared = await executeZatomAgentTool('viewport_clear_pane', {
      slotId: 'vp-2',
      targetStructureFingerprint: target.structureFingerprint,
      targetTrajectoryFingerprint: target.trajectoryFingerprint,
      targetWorkspaceRevision: target.revision,
    }, activeViewportToolContext)

    expect(cleared.ok).toBe(true)
    expect(useViewportManager.getState().layout).toBe('1x2')
    expect(useViewportManager.getState().activeViewportId).toBe('vp-1')
    expect(readActiveViewportWorkspaceIdentity()).toEqual(mainIdentity)
    expect(sideStore.getState().atoms).toHaveLength(0)
    expect(sideStore.getState().molecularOrbital.cubData).toBeNull()
    expect(sideStore.getState().constructedPlane).toBeNull()
    expect((cleared.data as { slots: Array<{ slotId: string; structureLabel: string | null }> }).slots)
      .toContainEqual(expect.objectContaining({ slotId: 'vp-2', structureLabel: null }))

    const review = selectPendingReview(useAgentOperationReview.getState())
    expect(review?.label).toBe('Clear vp-2')
    if (review?.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing clear review')
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(sideStore.getState().atoms).toHaveLength(1)
    expect(sideStore.getState().molecularOrbital.sourceName).toBe('density.cube')
    expect(sideStore.getState().molecularOrbital.cubData).toEqual(cube)
    expect(sideStore.getState().constructedPlane?.id).toBe('review-plane')
    expect(useViewportManager.getState().layout).toBe('1x2')
    expect(readActiveViewportWorkspaceIdentity()).toEqual(mainIdentity)
    clearViewportWorkspace(sideStore, 'vp-2')
    useViewportManager.getState().setLayout('1x1')
  })

  it('rejects a stale clear target without removing its newer structure', async () => {
    const stale = readActiveViewportWorkspaceIdentity()
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      label: 'newer main',
      atoms: [{ id: 'newer-n', element: 'N', position: [2, 0, 0] }],
    })
    const newer = readActiveViewportWorkspaceIdentity()
    const result = await executeZatomAgentTool('viewport_clear_pane', {
      slotId: 'vp-1',
      targetStructureFingerprint: stale.structureFingerprint,
      targetTrajectoryFingerprint: stale.trajectoryFingerprint,
      targetWorkspaceRevision: stale.revision,
    }, activeViewportToolContext)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('changed after it was described')
    expect(readActiveViewportWorkspaceIdentity()).toEqual(newer)
    expect(selectPendingReview(useAgentOperationReview.getState())).toBeNull()
  })

  it('treats newly attached surface data as target revision drift before clear', async () => {
    const stale = readActiveViewportWorkspaceIdentity()
    const store = useViewportManager.getState().getActiveStore()
    store.getState().loadCubData({ values: new Float32Array([0.4]) }, 'new-density.cube')
    const current = readActiveViewportWorkspaceIdentity()
    expect(current.structureFingerprint).toBe(stale.structureFingerprint)
    expect(current.revision).toBeGreaterThan(stale.revision)

    const result = await executeZatomAgentTool('viewport_clear_pane', {
      slotId: 'vp-1',
      targetStructureFingerprint: stale.structureFingerprint,
      targetTrajectoryFingerprint: stale.trajectoryFingerprint,
      targetWorkspaceRevision: stale.revision,
    }, activeViewportToolContext)
    expect(result.ok).toBe(false)
    expect(store.getState().molecularOrbital.sourceName).toBe('new-density.cube')
  })

  it('clears and restores an attached visualization even when the pane has no atoms', async () => {
    await clearActiveViewportWorkspace()
    const store = useViewportManager.getState().getActiveStore()
    store.getState().loadCubData({ values: new Float32Array([0.7]) }, 'surface-only.cube')
    const target = readActiveViewportWorkspaceIdentity()

    const result = await executeZatomAgentTool('viewport_clear_pane', {
      slotId: 'vp-1',
      targetStructureFingerprint: null,
      targetTrajectoryFingerprint: null,
      targetWorkspaceRevision: target.revision,
    }, activeViewportToolContext)
    expect(result.ok).toBe(true)
    expect(store.getState().molecularOrbital.cubData).toBeNull()

    const review = selectPendingReview(useAgentOperationReview.getState())
    if (review?.subject.kind !== 'structure' || !review.subject.revert) throw new Error('missing surface-only clear review')
    expect(review.subject.atomDelta).toBe(0)
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(store.getState().atoms).toHaveLength(0)
    expect(store.getState().molecularOrbital.sourceName).toBe('surface-only.cube')
    clearActiveViewportWorkspace()
  })

  it('never rewrites an untouched main pane when a side mount is reverted', async () => {
    const trajectory: ZatomTrajectory = {
      schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
      atomIds: ['main-pt'],
      coordinateMode: 'cartesian',
      frames: [
        { step: 0, timePs: 0, positions: [[0.1, 0, 0]] },
        { step: 1, timePs: 0.01, positions: [[0, 0, 0]] },
      ],
    }
    await writeActiveViewportTrajectory(trajectory)
    const mainStore = useViewportManager.getState().getActiveStore()
    mainStore.setState({ selectedAtomIds: new Set(['main-pt']) })
    const identityBefore = readActiveViewportWorkspaceIdentity()

    const mounted = await executeZatomAgentTool('viewport_mount_structures', {
      preserveExisting: true,
      structures: [{ label: 'side atom', format: 'xyz', text: '1\nside\nO 0 0 0\n' }],
    }, activeViewportToolContext)
    expect(mounted.ok).toBe(true)
    const review = selectPendingReview(useAgentOperationReview.getState())
    if (review?.subject.kind !== 'workspace') throw new Error('missing mount review')
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()

    expect(readActiveViewportWorkspaceIdentity()).toEqual(identityBefore)
    expect(fingerprintTrajectory(readActiveViewportTrajectory()!)).toBe(fingerprintTrajectory(trajectory))
    expect(mainStore.getState().selectedAtomIds).toEqual(new Set(['main-pt']))
  })

  it('rejects an explicit preserveExisting target that became occupied', async () => {
    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().setActive('vp-2')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'claimed', element: 'N', position: [0, 0, 0] }],
    })
    const occupiedFingerprint = fingerprintStructure(readActiveViewportStructure()!)
    await expect(activeViewportToolContext.viewport!.mount([
      { label: 'stale plan', format: 'xyz', text: '1\nstale\nO 0 0 0\n' },
    ], {
      preserveExisting: true,
      targetSlotIds: ['vp-2'],
    })).rejects.toThrow(/became occupied/)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(occupiedFingerprint)
  })

  it('restores detached panes when a reviewed layout expansion is reverted', async () => {
    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().setActive('vp-2')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'detached-o', element: 'O', position: [0, 0, 0] }],
    })
    const detachedFingerprint = fingerprintStructure(readActiveViewportStructure()!)
    useViewportManager.getState().setActive('vp-1')
    useViewportManager.getState().setLayout('1x1')

    const expanded = await executeZatomAgentTool('viewport_set_layout', { layout: '2x2' }, activeViewportToolContext)
    expect(expanded.ok).toBe(true)
    const review = selectPendingReview(useAgentOperationReview.getState())
    if (review?.subject.kind !== 'workspace') throw new Error('missing layout review')
    await review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(useViewportManager.getState().layout).toBe('1x1')

    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().setActive('vp-2')
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(detachedFingerprint)
  })

  it('keeps a pending ghost as the only decision and blocks every competing workspace mutation', async () => {
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'gate-base', element: 'C', position: [0, 0, 0] }],
    })
    const before = fingerprintStructure(readActiveViewportStructure()!)
    const proposed = await executeZatomAgentTool('structure_build_metal_cluster', {
      geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
    }, {
      ...activeViewportToolContext,
      access: { host: 'webmcp', mode: () => 'propose-only' },
    })
    expect(proposed.ok).toBe(true)
    expect(useAgentProposalStore.getState().current?.status).toBe('pending')

    await expect(commitActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'must-not-land', element: 'N', position: [1, 0, 0] }],
    })).rejects.toThrow(/waiting for the user's Apply or Discard decision/)
    expect((await executeZatomAgentTool('viewport_set_layout', { layout: '1x2' }, activeViewportToolContext)).ok).toBe(false)
    await expect(activeViewportToolContext.history!.undo()).rejects.toThrow(/Apply or Discard/)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(before)
    expect(selectPendingReview(useAgentOperationReview.getState())).toBeNull()
    discardPendingProposal()
  })

  it('does not revive a cancelled mount after the earlier review resolves', async () => {
    useAgentOperationReview.getState().openReview({
      label: 'earlier decision',
      subject: { kind: 'workspace', summary: 'waiting', revert: () => undefined },
    })
    const controller = new AbortController()
    const mount = activeViewportToolContext.viewport!.mount([
      { label: 'cancelled', format: 'xyz', text: '1\ncancelled\nO 0 0 0\n' },
    ], { preserveExisting: true, signal: controller.signal })
    await Promise.resolve()
    controller.abort(new Error('user cancelled mount'))
    await expect(mount).rejects.toThrow(/cancelled mount/)
    useAgentOperationReview.getState().dismissReview()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(useViewportManager.getState().layout).toBe('1x1')
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(fingerprintStructure(base))
    expect(selectPendingReview(useAgentOperationReview.getState())).toBeNull()
  })

  it('rejects a confirmed replacement when its target changes while queued', async () => {
    useViewportManager.getState().setLayout('1x2')
    useViewportManager.getState().setActive('vp-2')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'planned-old', element: 'C', position: [0, 0, 0] }],
    })
    const planned = readActiveViewportWorkspaceIdentity()
    useViewportManager.getState().setActive('vp-1')
    useAgentOperationReview.getState().openReview({
      label: 'hold confirmed mount',
      subject: { kind: 'workspace', summary: 'waiting', revert: () => undefined },
    })
    const mount = activeViewportToolContext.viewport!.mount([
      { label: 'replacement', format: 'xyz', text: '1\nreplacement\nO 0 0 0\n' },
    ], {
      preserveExisting: false,
      targetSlotIds: ['vp-2'],
      expectedTargets: [{
        slotId: 'vp-2',
        structureFingerprint: planned.structureFingerprint,
        trajectoryFingerprint: planned.trajectoryFingerprint,
        workspaceRevision: planned.revision,
      }],
    })
    await Promise.resolve()
    useViewportManager.getState().setActive('vp-2')
    await writeActiveViewportStructure({
      schemaVersion: ZATOM_STRUCTURE_SCHEMA,
      atoms: [{ id: 'user-newer', element: 'N', position: [1, 0, 0] }],
    })
    const newer = fingerprintStructure(readActiveViewportStructure()!)
    useAgentOperationReview.getState().dismissReview()
    await expect(mount).rejects.toThrow(/changed after confirmation/)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(newer)
  })

  it('leaves layout and every pane untouched when any mount input is invalid', async () => {
    const before = fingerprintStructure(readActiveViewportStructure()!)
    const failed = await executeZatomAgentTool('viewport_mount_structures', {
      preserveExisting: true,
      structures: [
        { label: 'valid', format: 'xyz', text: '1\nvalid\nN 0 0 0\n' },
        { label: 'invalid', format: 'not-real', text: 'broken' },
      ],
    }, activeViewportToolContext)
    expect(failed.ok).toBe(false)
    expect(useViewportManager.getState().layout).toBe('1x1')
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(before)
    expect(selectPendingReview(useAgentOperationReview.getState())).toBeNull()
  })

  it('converts a propose-only builder apply into a viewport-bound ghost proposal', async () => {
    const before = fingerprintStructure(readActiveViewportStructure()!)
    const result = await executeZatomAgentTool('structure_build_metal_cluster', {
      geometry: 'icosahedral',
      element: 'Pt',
      shells: 1,
      applyToWorkspace: true,
    }, {
      ...activeViewportToolContext,
      access: { host: 'webmcp', mode: () => 'propose-only' },
    })
    expect(result.ok).toBe(true)
    const envelope = result.data as {
      appliedToWorkspace: boolean
      applicationBlocked: boolean
      proposal: { id: string; viewportId: string; workspaceRevision: number } | null
    }
    expect(envelope.appliedToWorkspace).toBe(false)
    expect(envelope.applicationBlocked).toBe(false)
    expect(envelope.proposal?.viewportId).toBe('vp-1')
    const targetSlot = useViewportManager.getState().viewports['vp-1']
    if (targetSlot.kind !== 'crystal') {
      throw new Error('Expected the primary viewport to remain a crystal viewport')
    }
    expect(useAgentProposalStore.getState().current?.viewportKey).toBe(
      targetSlot.storeInstance as unknown as object,
    )
    expect(useAgentProposalStore.getState().current?.checks?.length).toBeGreaterThan(0)
    expect(useAgentProposalStore.getState().current?.previewComplete).toBe(true)
    expect(fingerprintStructure(readActiveViewportStructure()!)).toBe(before)
  })

  it('can ghost the first structure into an empty propose-only workspace', async () => {
    await clearActiveViewportWorkspace()
    const result = await executeZatomAgentTool('structure_import_text', {
      format: 'xyz',
      text: '1\nfirst candidate\nO 0 0 0\n',
      applyToWorkspace: true,
    }, {
      ...activeViewportToolContext,
      access: { host: 'webmcp', mode: () => 'propose-only' },
    })
    expect(result.ok).toBe(true)
    const proposal = useAgentProposalStore.getState().current
    expect(proposal?.status).toBe('pending')
    expect(proposal?.baseFingerprint).toBeNull()
    expect(proposal?.diff.addedCount).toBe(1)
    expect(readActiveViewportStructure()).toBeNull()
    discardPendingProposal()
  })
})
