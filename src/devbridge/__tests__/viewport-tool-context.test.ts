import { expect, it } from 'vitest'

import {
  ZATOM_STRUCTURE_SCHEMA,
  ZATOM_TRAJECTORY_SCHEMA,
  type CameraFlightResult,
  type GuidanceSnapshot,
  type ProposalSnapshot,
  type ViewerStylePatch,
  type ViewerStyleSnapshot,
  type ZatomStructure,
  type ZatomTrajectory,
  type ZatomViewerScene,
  type ZatomWorkspaceIdentity,
} from '../../agent/contracts'
import { executeZatomAgentTool } from '../../agent/tools'
import { fingerprintStructure } from '../../agent/structure-math'
import { fingerprintTrajectory } from '../../agent/trajectory'
import {
  createViewportBridgeToolContext,
  type ZatomViewportBridgeInvoker,
} from '../viewport-tool-context'

const initial: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'active pair',
  atoms: [
    { id: 'a', element: 'C', position: [0, 0, 0] },
    { id: 'b', element: 'C', position: [1.4, 0, 0] },
  ],
}

function fixtureViewport(writeMode: 'read-only' | 'propose-only' | 'read-write' = 'read-write') {
  let structure = structuredClone(initial)
  let trajectory: ZatomTrajectory | null = null
  let commitCount = 0
  let staleOnCommit = false
  let revision = 0
  const identity = (): ZatomWorkspaceIdentity => ({
    viewportId: 'vp-1',
    revision,
    structureFingerprint: fingerprintStructure(structure),
    trajectoryFingerprint: trajectory ? fingerprintTrajectory(trajectory) : null,
  })
  const invocationTimeouts: Array<{
    operation: string
    timeoutMs: number | null | undefined
    signal?: AbortSignal
    payload?: unknown
  }> = []
  const scene: ZatomViewerScene = {
    pose: { position: [0, 0, 10], lookAt: [0, 0, 0], up: [0, 1, 0] },
    viewportSizePx: [800, 600],
    selectedAtomIds: ['a'],
    selectedBondIds: [],
    selectedFaceIds: [],
    selectedEdgeIds: [],
    boxSelectionActive: false,
    hoveredAtomId: 'b',
    lastFocus: null,
  }
  let guidance: GuidanceSnapshot = { plan: null, annotations: [], candidates: null }
  let style: ViewerStyleSnapshot = {
    stylePresetId: 'qc-soft',
    viewMode: 'ball-stick',
    cameraProjection: 'perspective',
    hideHydrogens: false,
    keptHydrogens: '',
    showAtomRings: false,
    fieldSlice: { enabled: false, mode: 'overlay', opacity: 0.86, contours: 8 },
    surface: null,
    available: { stylePresets: [{ id: 'qc-soft', label: 'QC Soft' }], surfaceColormaps: ['rwb'] },
  }
  const cameraFlight: CameraFlightResult = {
    center: [0.7, 0, 0],
    distance: 8,
    direction: [0, 0, 1],
    atomIds: ['a', 'b'],
    interrupted: false,
  }
  let proposal: ProposalSnapshot | null = null
  let proposalCandidate: ZatomStructure | null = null
  const invoke: ZatomViewportBridgeInvoker = async (operation, payload, timeoutMs, signal) => {
    invocationTimeouts.push({ operation, timeoutMs, signal, payload })
    if (operation === 'read-host-write-mode') {
      expect((payload as { host: string }).host).toBe('cli-bridge')
      return { mode: writeMode }
    }
    if (operation === 'read-structure') return { viewportId: 'vp-1', structure: structuredClone(structure), identity: identity() }
    if (operation === 'read-trajectory') return { viewportId: 'vp-1', trajectory: structuredClone(trajectory), identity: identity() }
    if (operation === 'read-workspace-identity') return { viewportId: 'vp-1', identity: identity() }
    if (operation === 'commit-structure') {
      const input = payload as {
        structure: ZatomStructure
        expectedViewportId?: string
        expectedStructureFingerprint?: string | null
        expectedRevision?: number
      }
      if (staleOnCommit) {
        structure = {
          ...structure,
          label: 'external edit',
          atoms: structure.atoms.map((atom, index) => index === 0
            ? { ...atom, position: [0.25, 0, 0] }
            : atom),
        }
        revision++
        staleOnCommit = false
      }
      expect(input.expectedViewportId).toBe('vp-1')
      if (input.expectedStructureFingerprint !== fingerprintStructure(structure)) {
        throw new Error('stale source fingerprint')
      }
      if (input.expectedRevision !== revision) throw new Error('stale source revision')
      structure = structuredClone(input.structure)
      trajectory = null
      revision++
      commitCount++
      return { viewportId: 'vp-1', structureFingerprint: fingerprintStructure(structure), identity: identity() }
    }
    if (operation === 'commit-workspace') {
      const input = payload as {
        structure: ZatomStructure
        trajectory: ZatomTrajectory
        expectedViewportId?: string
        expectedStructureFingerprint?: string | null
        expectedRevision?: number
      }
      expect(input.expectedViewportId).toBe('vp-1')
      if (input.expectedStructureFingerprint !== fingerprintStructure(structure)) {
        throw new Error('stale workspace source fingerprint')
      }
      if (input.expectedRevision !== revision) throw new Error('stale workspace source revision')
      structure = structuredClone(input.structure)
      trajectory = structuredClone(input.trajectory)
      revision++
      commitCount++
      return { viewportId: 'vp-1', structureFingerprint: fingerprintStructure(structure), identity: identity() }
    }
    if (operation === 'capture-viewport') return null
    if (operation === 'focus-target') return null
    if (operation === 'read-viewer-scene') return { viewportId: 'vp-1', scene: structuredClone(scene) }
    if (operation === 'camera-look-at' || operation === 'camera-set-view') {
      return { viewportId: 'vp-1', result: structuredClone(cameraFlight) }
    }
    if (operation === 'guidance-read') return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    if (operation === 'guidance-set-plan') {
      const input = payload as { steps: string[]; activeIndex: number; caption: string | null }
      guidance = {
        ...guidance,
        plan: {
          steps: input.steps.map((label, index) => ({
            label,
            status: index < input.activeIndex ? 'done' : index === input.activeIndex ? 'active' : 'pending',
          })),
          caption: input.caption,
        },
      }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-advance') {
      const input = payload as { activeIndex: number; caption?: string | null }
      if (guidance.plan) {
        guidance = {
          ...guidance,
          plan: {
            steps: guidance.plan.steps.map((step, index) => ({
              label: step.label,
              status: index < input.activeIndex ? 'done' : index === input.activeIndex ? 'active' : 'pending',
            })),
            caption: input.caption === undefined ? guidance.plan.caption : input.caption,
          },
        }
      }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-set-caption') {
      const input = payload as { caption: string | null }
      if (guidance.plan) guidance = { ...guidance, plan: { ...guidance.plan, caption: input.caption } }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-annotate') {
      const input = payload as {
        annotations: Array<{ id?: string; position?: [number, number, number]; label: string; kind?: 'info' | 'target' | 'warn' }>
        replace: boolean
      }
      const annotations = input.annotations.map((annotation, index) => ({
        id: annotation.id ?? `annotation-${index + 1}`,
        position: annotation.position ?? [0, 0, 0] as [number, number, number],
        label: annotation.label,
        kind: annotation.kind ?? 'info' as const,
      }))
      guidance = { ...guidance, annotations: input.replace ? annotations : [...guidance.annotations, ...annotations] }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-present-candidates') {
      const input = payload as { label: string; items: Array<{ atomIds: string[]; label: string; detail?: string }> }
      guidance = {
        ...guidance,
        candidates: {
          id: 'candidates-1',
          label: input.label,
          focusedIndex: null,
          decision: { status: 'pending', index: null, at: null },
          items: input.items.map((item, index) => ({
            index: index + 1,
            atomIds: item.atomIds,
            position: [index, 0, 0],
            label: item.label,
            detail: item.detail ?? null,
          })),
        },
      }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-focus-candidate') {
      const input = payload as { index: number | null }
      if (guidance.candidates) guidance = { ...guidance, candidates: { ...guidance.candidates, focusedIndex: input.index } }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'guidance-candidate-status') {
      const input = payload as { candidateSetId: string }
      const current = guidance.candidates
      if (!current || current.id !== input.candidateSetId) throw new Error('unknown candidate set')
      const choice = current.decision.status === 'confirmed'
        ? current.items.find((item) => item.index === current.decision.index) ?? null
        : null
      return {
        viewportId: 'vp-1',
        status: {
          candidateSetId: current.id,
          status: current.decision.status,
          focusedIndex: current.focusedIndex,
          choice,
          decidedAt: current.decision.at,
          timedOut: current.decision.status === 'pending',
        },
      }
    }
    if (operation === 'guidance-clear') {
      const input = payload as { scope?: string }
      const scope = input.scope ?? 'all'
      guidance = {
        plan: scope === 'all' || scope === 'plan' ? null : guidance.plan,
        annotations: scope === 'all' || scope === 'annotations' ? [] : guidance.annotations,
        candidates: scope === 'all' || scope === 'candidates' ? null : guidance.candidates,
      }
      return { viewportId: 'vp-1', snapshot: structuredClone(guidance) }
    }
    if (operation === 'viewer-style-read') return { viewportId: 'vp-1', snapshot: structuredClone(style) }
    if (operation === 'viewer-style-apply') {
      const patch = (payload as { patch: ViewerStylePatch }).patch
      style = {
        ...style,
        ...patch,
        fieldSlice: patch.fieldSlice ? { ...style.fieldSlice, ...patch.fieldSlice } : style.fieldSlice,
        surface: style.surface && patch.surface ? { ...style.surface, ...patch.surface } : style.surface,
      }
      return { viewportId: 'vp-1', snapshot: structuredClone(style) }
    }
    if (operation === 'proposal-propose') {
      const input = payload as {
        intent: string
        baseFingerprint: string
        workspaceRevision: number
        expectedViewportId: string
        candidate: ZatomStructure
      }
      proposalCandidate = structuredClone(input.candidate)
      proposal = {
        id: 'proposal-1',
        intent: input.intent,
        status: 'pending',
        viewportId: input.expectedViewportId,
        workspaceRevision: input.workspaceRevision,
        baseFingerprint: input.baseFingerprint,
        candidateFingerprint: fingerprintStructure(input.candidate),
        previewRevision: 1,
        diff: {
          added: [], removed: [], moved: [], addedCount: 0, removedCount: 0, movedCount: 0,
          summary: '1 moved', bounds: { center: [0, 0, 0], radius: 2 },
        },
      }
      return { viewportId: 'vp-1', proposal: structuredClone(proposal) }
    }
    if (operation === 'proposal-read-candidate') {
      if (!proposal || !proposalCandidate) throw new Error('no pending proposal')
      return {
        viewportId: 'vp-1',
        candidate: { proposal: structuredClone(proposal), candidate: structuredClone(proposalCandidate) },
      }
    }
    if (operation === 'proposal-revise') {
      if (!proposal) throw new Error('no pending proposal')
      const input = payload as { intent: string; candidate: ZatomStructure }
      proposalCandidate = structuredClone(input.candidate)
      proposal = {
        ...proposal,
        intent: input.intent,
        candidateFingerprint: fingerprintStructure(input.candidate),
        previewRevision: proposal.previewRevision + 1,
      }
      return { viewportId: 'vp-1', proposal: structuredClone(proposal) }
    }
    if (operation === 'proposal-status') return { viewportId: 'vp-1', proposal: structuredClone(proposal) }
    if (operation === 'proposal-withdraw') {
      if (proposal) proposal = { ...proposal, status: 'discarded' }
      return { viewportId: 'vp-1', proposal: structuredClone(proposal) }
    }
    if (operation === 'write-trajectory') {
      trajectory = structuredClone((payload as { trajectory: ZatomTrajectory }).trajectory)
      revision++
      return { viewportId: 'vp-1', identity: identity() }
    }
    throw new Error(`Unexpected operation ${operation}`)
  }
  return {
    invoke,
    structure: () => structure,
    trajectory: () => trajectory,
    commitCount: () => commitCount,
    invocationTimeouts: () => invocationTimeouts,
    makeNextCommitStale: () => { staleOnCommit = true },
  }
}

it('strictly validates projection, surface resolution, and field-slice snapshots from the renderer', async () => {
  const valid: ViewerStyleSnapshot = {
    stylePresetId: 'qc-soft',
    viewMode: 'ball-stick',
    cameraProjection: 'orthographic',
    hideHydrogens: false,
    keptHydrogens: '',
    showAtomRings: false,
    fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.72, contours: 5 },
    surface: {
      sourceType: 'cub',
      sourceName: 'density.cube',
      visible: true,
      isoValue: 0.002,
      resolution: 64,
      opacity: 0.86,
      selectedOrbitalIndex: null,
      orbitalCount: null,
      colorField: {
        sourceName: 'esp.cube',
        colormap: 'rwb',
        range: null,
        showExtrema: false,
        stats: null,
      },
    },
    available: {
      stylePresets: [{ id: 'qc-soft', label: 'QC Soft' }],
      surfaceColormaps: ['rwb'],
    },
  }
  const read = (snapshot: unknown) => createViewportBridgeToolContext(async (operation) => {
    if (operation !== 'viewer-style-read') throw new Error(`Unexpected operation ${operation}`)
    return { viewportId: 'vp-1', snapshot: structuredClone(snapshot) }
  }).viewerStyle!.read()

  await expect(read(valid)).resolves.toMatchObject({
    cameraProjection: 'orthographic',
    fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.72, contours: 5 },
    surface: { resolution: 64 },
  })
  await expect(read({ ...valid, cameraProjection: 'fisheye' })).rejects.toThrow(/snapshot is malformed/)
  await expect(read({
    ...valid,
    surface: { ...valid.surface!, resolution: 12.5 },
  })).rejects.toThrow(/surface style is malformed/)
  await expect(read({
    ...valid,
    fieldSlice: { ...valid.fieldSlice, contours: 2.5 },
  })).rejects.toThrow(/field-slice style is malformed/)
})

it('commits an operation batch once and rejects a stale batch without partial writes', async () => {
  const viewport = fixtureViewport()
  const request = new AbortController()
  const context = { ...createViewportBridgeToolContext(viewport.invoke), signal: request.signal }
  const committed = await executeZatomAgentTool('structure_apply_operations', {
    operations: [
      { op: 'translate', selection: { atomIds: ['a'] }, vector: [1, 0, 0] },
      { op: 'translate', selection: { atomIds: ['b'] }, vector: [0, 1, 0] },
    ],
    applyToWorkspace: true,
    captureAfter: false,
  }, context)
  expect(committed.ok).toBe(true)
  expect(committed.data).toMatchObject({ appliedToWorkspace: true, applicationVerified: true })
  expect(viewport.commitCount()).toBe(1)
  expect(viewport.invocationTimeouts().find((entry) => entry.operation === 'commit-structure')?.timeoutMs).toBeNull()
  expect(viewport.invocationTimeouts().find((entry) => entry.operation === 'commit-structure')?.signal).toBe(request.signal)
  expect(viewport.structure().atoms.map((atom) => atom.position)).toEqual([[1, 0, 0], [1.4, 1, 0]])

  viewport.makeNextCommitStale()
  const blocked = await executeZatomAgentTool('structure_apply_operations', {
    operations: [{ op: 'translate', selection: { all: true }, vector: [0, 0, 2] }],
    applyToWorkspace: true,
    captureAfter: false,
  }, createViewportBridgeToolContext(viewport.invoke))
  expect(blocked.ok).toBe(true)
  expect(blocked.data).toMatchObject({ appliedToWorkspace: false, applicationBlocked: true })
  expect(viewport.commitCount()).toBe(1)
  expect(viewport.structure().label).toBe('external edit')
  expect(viewport.structure().atoms.some((atom) => atom.position[2] !== 0)).toBe(false)
})

/**
 * Replacing a whole workspace is the write that most needs an observation first: the Agent submits a complete
 * structure and discards what was there. A user edit made after the Agent's last read must not disappear silently.
 *
 * Therefore an unobserved write is rejected instead of binding to an immediate reread, which would compare
 * "current versus current" and always pass. Once observed, the same replacement must succeed normally.
 */
it('refuses an unobserved workspace replacement and accepts it after a read', async () => {
  const viewport = fixtureViewport()
  const replacement: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'replacement',
    atoms: [{ id: 'replacement', element: 'Si', position: [0, 0, 0] }],
  }

  const unobserved = await executeZatomAgentTool('workspace_set_active_structure', {
    structure: replacement,
    captureAfter: false,
  }, createViewportBridgeToolContext(viewport.invoke))
  expect(unobserved.ok).toBe(true)
  expect(unobserved.data).toMatchObject({ appliedToWorkspace: false, applicationBlocked: true })
  expect(viewport.commitCount()).toBe(0)

  const context = createViewportBridgeToolContext(viewport.invoke)
  await context.readStructure!()
  const observed = await executeZatomAgentTool('workspace_set_active_structure', {
    structure: replacement,
    captureAfter: false,
  }, context)
  expect(observed.ok).toBe(true)
  expect(observed.data).toMatchObject({ appliedToWorkspace: true, applicationVerified: true })
  expect(viewport.commitCount()).toBe(1)
  expect(viewport.structure()).toEqual(replacement)
})

it('uses one renderer transaction for a structure with trajectory frames', async () => {
  const viewport = fixtureViewport()
  const replacement: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: 'trajectory replacement',
    atoms: [{ id: 'moving-si', element: 'Si', position: [1, 0, 0] }],
  }
  const frames: ZatomTrajectory = {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds: ['moving-si'],
    coordinateMode: 'cartesian',
    frames: [
      { step: 0, timePs: 0, positions: [[0, 0, 0]] },
      { step: 1, timePs: 0.01, positions: [[1, 0, 0]] },
    ],
  }
  const context = createViewportBridgeToolContext(viewport.invoke)
  await context.readStructure!()
  const result = await executeZatomAgentTool('workspace_set_active_structure', {
    structure: replacement,
    trajectory: frames,
    captureAfter: false,
  }, context)
  expect(result.ok).toBe(true)
  expect(result.data).toMatchObject({ appliedToWorkspace: true, applicationVerified: true })
  expect(viewport.invocationTimeouts().filter((entry) => entry.operation === 'commit-workspace')).toHaveLength(1)
  expect(viewport.invocationTimeouts().some((entry) => entry.operation === 'commit-structure')).toBe(false)
  expect(viewport.invocationTimeouts().some((entry) => entry.operation === 'write-trajectory')).toBe(false)
  expect(fingerprintStructure(viewport.structure())).toBe(fingerprintStructure(replacement))
  expect(fingerprintTrajectory(viewport.trajectory()!)).toBe(fingerprintTrajectory(frames))
})

it('gives the CLI bridge the complete live viewport collaboration surface', async () => {
  const viewport = fixtureViewport()
  const base = createViewportBridgeToolContext(viewport.invoke)
  await base.readStructure!()

  const observed = await executeZatomAgentTool('viewer_observe', {}, base)
  expect(observed.ok).toBe(true)
  expect(observed.data).toMatchObject({
    mounted: true,
    selection: { atomIds: ['a'] },
    hovered: { id: 'b' },
  })

  const abort = new AbortController()
  const looked = await executeZatomAgentTool('viewer_look_at', {
    target: { atomIds: ['a', 'b'] },
    view: 'top',
    durationMs: 250,
  }, { ...base, signal: abort.signal })
  expect(looked.ok).toBe(true)
  expect(looked.data).toMatchObject({ center: [0.7, 0, 0], interrupted: false })
  const cameraCall = viewport.invocationTimeouts().find((entry) => entry.operation === 'camera-look-at')
  expect(cameraCall?.timeoutMs).toBeNull()
  expect(cameraCall?.signal).toBe(abort.signal)
  expect(cameraCall?.payload).toMatchObject({ expectedViewportId: 'vp-1', request: { view: 'top' } })
  expect((await base.camera!.setView('iso', 100)).direction).toEqual([0, 0, 1])

  const plan = await executeZatomAgentTool('guide_set_plan', {
    steps: ['Inspect surface', 'Place adsorbate'],
    activeIndex: 1,
    caption: 'Choose a site',
  }, base)
  expect(plan.ok).toBe(true)
  expect(plan.data).toMatchObject({ plan: { caption: 'Choose a site' } })
  const annotated = await base.guidance!.annotate([
    { atomIds: ['a'], label: 'top site', kind: 'target' },
  ], true)
  expect(annotated.annotations).toMatchObject([{ label: 'top site', kind: 'target' }])
  const candidates = await base.guidance!.presentCandidates('Choose a site', [
    { atomIds: ['a'], label: 'top' },
    { atomIds: ['a', 'b'], label: 'bridge', detail: 'between two atoms' },
  ])
  expect(candidates.candidates?.items).toHaveLength(2)
  expect((await base.guidance!.focusCandidate(2)).candidates?.focusedIndex).toBe(2)
  expect(await base.guidance!.candidateStatus('candidates-1')).toMatchObject({
    candidateSetId: 'candidates-1', status: 'pending', focusedIndex: 2,
  })
  expect((await base.guidance!.clear('candidates')).candidates).toBeNull()

  expect((await base.viewerStyle!.read()).stylePresetId).toBe('qc-soft')
  const styled = await executeZatomAgentTool('viewer_set_style', {
    cameraProjection: 'orthographic',
    hideHydrogens: true,
    fieldSlice: { enabled: false, mode: 'slice-only', opacity: 0.72, contours: 5 },
  }, base)
  expect(styled.ok).toBe(true)
  expect(styled.data).toMatchObject({
    cameraProjection: 'orthographic',
    hideHydrogens: true,
    fieldSlice: { enabled: false, mode: 'slice-only', opacity: 0.72, contours: 5 },
  })

  const proposed = await executeZatomAgentTool('structure_propose_operations', {
    intent: 'move atom a',
    expectedFingerprint: fingerprintStructure(initial),
    operations: [{ op: 'translate', selection: { atomIds: ['a'] }, vector: [0, 0, 1] }],
    flyTo: false,
  }, base)
  expect(proposed.ok).toBe(true)
  expect(proposed.data).toMatchObject({
    proposalId: 'proposal-1',
    status: 'pending',
    baseFingerprint: fingerprintStructure(initial),
  })
  expect(viewport.invocationTimeouts().find((entry) => entry.operation === 'proposal-propose')?.payload)
    .toMatchObject({ expectedViewportId: 'vp-1', workspaceRevision: 0 })

  const status = await executeZatomAgentTool('structure_proposal_status', { proposalId: 'proposal-1' }, base)
  expect(status.ok).toBe(true)
  expect(status.data).toMatchObject({ proposalId: 'proposal-1', status: 'pending' })
  expect((await base.proposal!.withdraw('proposal-1'))?.status).toBe('discarded')

  const scopedCalls = viewport.invocationTimeouts().filter((entry) => [
    'read-viewer-scene', 'camera-look-at', 'camera-set-view', 'guidance-read', 'guidance-set-plan',
    'guidance-annotate', 'guidance-present-candidates', 'guidance-focus-candidate', 'guidance-candidate-status', 'guidance-clear',
    'viewer-style-read', 'viewer-style-apply', 'proposal-propose', 'proposal-status', 'proposal-withdraw',
  ].includes(entry.operation))
  expect(scopedCalls.every((entry) => (
    entry.payload as { expectedViewportId?: string } | undefined
  )?.expectedViewportId === 'vp-1')).toBe(true)
})

it('observes and sends the complete workspace identity before an otherwise-unbound visual write', async () => {
  const viewport = fixtureViewport()
  const context = createViewportBridgeToolContext(viewport.invoke)

  await expect(context.viewerStyle!.apply({ hideHydrogens: true })).resolves.toMatchObject({
    hideHydrogens: true,
  })

  const calls = viewport.invocationTimeouts()
  expect(calls.map((entry) => entry.operation)).toEqual([
    'read-workspace-identity',
    'viewer-style-apply',
  ])
  expect(calls[1].payload).toMatchObject({
    expectedViewportId: 'vp-1',
    expectedRevision: 0,
    expectedStructureFingerprint: fingerprintStructure(initial),
    expectedTrajectoryFingerprint: null,
    patch: { hideHydrogens: true },
  })
})

it('reads and atomically revises the same pending ghost through the viewport bridge', async () => {
  const viewport = fixtureViewport('propose-only')
  const controller = new AbortController()
  const context = { ...createViewportBridgeToolContext(viewport.invoke), signal: controller.signal }
  const activeBefore = fingerprintStructure(viewport.structure())

  const proposed = await executeZatomAgentTool('structure_propose_operations', {
    intent: 'Lift the pair for preview',
    operations: [{ op: 'translate', selection: { all: true }, vector: [0, 0, 1] }],
    flyTo: false,
  }, context)
  expect(proposed.ok).toBe(true)
  const first = proposed.data as {
    proposalId: string
    previewRevision: number
    candidateFingerprint: string
  }

  const refined = await executeZatomAgentTool('structure_pose_component', {
    proposalId: first.proposalId,
    expectedPreviewRevision: first.previewRevision,
    expectedCandidateFingerprint: first.candidateFingerprint,
    componentAtomIds: ['a', 'b'],
    anchorAtomId: 'a',
    directionAtomIds: ['b'],
    target: { kind: 'vector', vector: [0, 1, 0] },
    applyToWorkspace: true,
  }, context)
  expect(refined.ok).toBe(true)
  const revised = (refined.data as { proposal: ProposalSnapshot }).proposal
  expect(revised).toMatchObject({
    id: first.proposalId,
    status: 'pending',
    previewRevision: first.previewRevision + 1,
  })
  expect(revised.candidateFingerprint).not.toBe(first.candidateFingerprint)
  expect(fingerprintStructure(viewport.structure())).toBe(activeBefore)

  const calls = viewport.invocationTimeouts().map((entry) => entry.operation)
  expect(calls).toContain('proposal-read-candidate')
  expect(calls).toContain('proposal-revise')
  for (const call of viewport.invocationTimeouts().filter((entry) => (
    entry.operation === 'proposal-read-candidate' || entry.operation === 'proposal-revise'
  ))) {
    expect(call.signal).toBe(controller.signal)
    expect(call.payload).toMatchObject({
      expectedViewportId: 'vp-1',
      expectedRevision: 0,
      expectedStructureFingerprint: activeBefore,
      expectedTrajectoryFingerprint: null,
    })
  }
  const read = await context.proposal!.readCandidate({
    id: revised.id,
    expectedPreviewRevision: revised.previewRevision,
    expectedCandidateFingerprint: revised.candidateFingerprint,
  })
  const anchor = read.candidate.atoms.find((atom) => atom.id === 'a')!
  const direction = read.candidate.atoms.find((atom) => atom.id === 'b')!
  expect(direction.position[1] - anchor.position[1]).toBeCloseTo(1.4, 8)
  expect(direction.position[0] - anchor.position[0]).toBeCloseTo(0, 8)
})

it('routes pane activation through the renderer and rebinds a reused host context', async () => {
  const calls: Array<{ operation: string; payload: unknown }> = []
  const invoke: ZatomViewportBridgeInvoker = async (operation, payload) => {
    calls.push({ operation, payload })
    if (operation === 'viewport-activate') {
      return {
        instanceId: 'window-1',
        layout: '1x2',
        availableLayouts: ['1x1', '1x2'],
        slots: [
          { slotId: 'vp-1', slotIndex: 0, kind: 'crystal', label: 'VP-1', structureLabel: 'A', atomCount: 1, active: false },
          { slotId: 'vp-2', slotIndex: 1, kind: 'crystal', label: 'VP-2', structureLabel: 'B', atomCount: 1, active: true },
        ],
      }
    }
    if (operation === 'read-workspace-identity') {
      return {
        viewportId: 'vp-2',
        identity: {
          viewportId: 'vp-2', revision: 4, structureFingerprint: 'fnv1a64:target', trajectoryFingerprint: null,
        },
      }
    }
    throw new Error(`Unexpected operation ${operation}`)
  }
  const context = createViewportBridgeToolContext(invoke)
  const view = await context.viewport!.activate('vp-2', {
    instanceId: 'window-1',
    expectedActiveViewportId: 'vp-1',
  })
  expect(view.slots.find((slot) => slot.active)?.slotId).toBe('vp-2')
  expect(calls[0]).toEqual({
    operation: 'viewport-activate',
    payload: { slotId: 'vp-2', expectedViewportId: 'vp-1', instanceId: 'window-1' },
  })

  await expect(context.workspaceIdentity!()).resolves.toMatchObject({ viewportId: 'vp-2', revision: 4 })
  expect(calls[1]).toEqual({ operation: 'read-workspace-identity', payload: { expectedViewportId: 'vp-2' } })
})

it('forwards an exact pane-clear target through the renderer bridge', async () => {
  const calls: Array<{ operation: string; payload: unknown }> = []
  const invoke: ZatomViewportBridgeInvoker = async (operation, payload) => {
    calls.push({ operation, payload })
    if (operation !== 'viewport-clear') throw new Error(`Unexpected operation ${operation}`)
    return {
      instanceId: 'window-clear',
      layout: '1x2',
      availableLayouts: ['1x1', '1x2'],
      slots: [
        {
          slotId: 'vp-2', slotIndex: 1, kind: 'crystal', label: 'VP-2',
          structureLabel: null, atomCount: 0, active: false,
          structureFingerprint: null, trajectoryFingerprint: null, workspaceRevision: 8,
        },
      ],
    }
  }
  const context = createViewportBridgeToolContext(invoke)
  const view = await context.viewport!.clear('vp-2', {
    instanceId: 'window-clear',
    expectedTarget: {
      slotId: 'vp-2',
      structureFingerprint: 'fnv1a64:side',
      trajectoryFingerprint: 'fnv1a64:trajectory',
      workspaceRevision: 7,
    },
  })
  expect(view.slots[0]).toMatchObject({ slotId: 'vp-2', atomCount: 0 })
  expect(calls).toEqual([{
    operation: 'viewport-clear',
    payload: {
      slotId: 'vp-2',
      targetStructureFingerprint: 'fnv1a64:side',
      targetTrajectoryFingerprint: 'fnv1a64:trajectory',
      targetWorkspaceRevision: 7,
      instanceId: 'window-clear',
    },
  }])
})

it('rejects a candidate decision returned for a different candidate set', async () => {
  const context = createViewportBridgeToolContext(async (operation) => {
    if (operation !== 'guidance-candidate-status') throw new Error(`Unexpected operation ${operation}`)
    return {
      viewportId: 'vp-1',
      status: {
        candidateSetId: 'wrong-candidate-set',
        status: 'pending',
        focusedIndex: null,
        choice: null,
        decidedAt: null,
        timedOut: false,
      },
    }
  })
  await expect(context.guidance!.candidateStatus('expected-candidate-set')).rejects.toThrow(
    /wrong-candidate-set.*expected-candidate-set/,
  )
})

it('rejects proposal status returned for a different proposal id in the same viewport', async () => {
  const context = createViewportBridgeToolContext(async (operation) => {
    if (operation !== 'proposal-status') throw new Error(`Unexpected operation ${operation}`)
    return {
      viewportId: 'vp-1',
      proposal: {
        id: 'wrong-proposal',
        intent: 'Wrong preview',
        status: 'pending',
        viewportId: 'vp-1',
        workspaceRevision: 1,
        baseFingerprint: 'base',
        candidateFingerprint: 'candidate',
        previewRevision: 1,
        diff: {
          added: [], removed: [], moved: [],
          addedCount: 0, removedCount: 0, movedCount: 0,
          summary: 'no atom changes', bounds: null,
        },
      },
    }
  })
  await expect(context.proposal!.status('expected-proposal')).rejects.toThrow(
    /wrong-proposal.*expected-proposal/,
  )
})

it('asks the page for the host write mode and refuses writes it does not allow', async () => {
  const proposeOnly = fixtureViewport('propose-only')
  const context = createViewportBridgeToolContext(proposeOnly.invoke)

  // Reads never consult the policy: no round trip on observations.
  const active = await executeZatomAgentTool('workspace_get_active_structure', {}, context)
  expect(active.ok).toBe(true)
  expect(proposeOnly.invocationTimeouts().some((e) => e.operation === 'read-host-write-mode')).toBe(false)

  // Compute-tier builders run, but the write surface is gone: the candidate
  // is ghosted for explicit user approval instead of landing the edit.
  const built = await executeZatomAgentTool('structure_build_metal_cluster', {
    geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
  }, context)
  expect(proposeOnly.invocationTimeouts().some((e) => e.operation === 'read-host-write-mode')).toBe(true)
  expect(built.ok).toBe(true)
  expect((built.data as { appliedToWorkspace: boolean; applicationBlocked: boolean }).appliedToWorkspace).toBe(false)
  expect((built.data as { appliedToWorkspace: boolean; applicationBlocked: boolean }).applicationBlocked).toBe(false)
  expect((built.data as { proposal: ProposalSnapshot | null }).proposal).toMatchObject({
    id: 'proposal-1', status: 'pending', viewportId: 'vp-1', workspaceRevision: 0,
  })
  expect(proposeOnly.commitCount()).toBe(0)

  // Applying is mutate-tier: refused by the registry before the tool runs.
  const denied = await executeZatomAgentTool('structure_apply_operations', {
    operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }],
    applyToWorkspace: true,
  }, context)
  expect(denied.ok).toBe(false)
  expect(denied.error?.code).toBe('host_policy_denied')
  expect(proposeOnly.commitCount()).toBe(0)

  // A viewport that cannot answer the probe fails closed, and says why.
  const mute = createViewportBridgeToolContext(async (operation) => {
    if (operation === 'read-structure') return { viewportId: 'vp-1', structure: structuredClone(initial) }
    throw new Error('no window bound')
  })
  const closed = await executeZatomAgentTool('structure_build_metal_cluster', {
    geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: false,
  }, mute)
  expect(closed.ok).toBe(false)
  expect(closed.error?.code).toBe('host_policy_unavailable')
  expect(closed.error?.message).toContain('no window bound')
})
