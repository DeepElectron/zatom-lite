/**
 * The host write policy is the one runtime boundary between an agent host and
 * the workspace. These tests pin the contract the panel promises: the mode is
 * read per call, read tools never consult it, and a refusal happens before the
 * tool runs — so an agent cannot get halfway through an edit and be stopped.
 */

import { describe, expect, it } from 'vitest'

import type { ZatomHostWriteMode, ZatomStructure, ZatomToolContext } from '../contracts'
import { ZATOM_STRUCTURE_SCHEMA } from '../contracts'
import { ZATOM_DEFAULT_HOST_WRITE_MODE, hostWriteModeAllows } from '../host-access-policy'
import { executeZatomAgentTool } from '../tools'

const water: ZatomStructure = {
  schemaVersion: ZATOM_STRUCTURE_SCHEMA,
  label: 'water',
  atoms: [
    { id: 'o', element: 'O', position: [0, 0, 0] },
    { id: 'h1', element: 'H', position: [0.96, 0, 0] },
    { id: 'h2', element: 'H', position: [-0.24, 0.93, 0] },
  ],
}

function hostContext(mode: () => ZatomHostWriteMode) {
  let current = structuredClone(water)
  let writes = 0
  let modeReads = 0
  const context: ZatomToolContext = {
    access: { host: 'webmcp', mode: () => { modeReads += 1; return mode() } },
    readStructure: () => structuredClone(current),
    writeStructure: (next) => { current = structuredClone(next); writes += 1 },
  }
  return { context, writes: () => writes, modeReads: () => modeReads, structure: () => current }
}

describe('host write policy', () => {
  it('ranks modes as a ceiling on the tool tier axis', () => {
    expect(hostWriteModeAllows('read-only', 'read')).toBe(true)
    expect(hostWriteModeAllows('read-only', 'compute')).toBe(false)
    expect(hostWriteModeAllows('propose-only', 'compute')).toBe(true)
    expect(hostWriteModeAllows('propose-only', 'mutate')).toBe(false)
    expect(hostWriteModeAllows('read-write', 'mutate')).toBe(true)
  })

  it('trusts hosts the user launched and not the one injected into the page', () => {
    expect(ZATOM_DEFAULT_HOST_WRITE_MODE.webmcp).toBe('propose-only')
    expect(ZATOM_DEFAULT_HOST_WRITE_MODE['cli-bridge']).toBe('read-write')
  })

  it('never consults the mode for read tools', async () => {
    const host = hostContext(() => 'read-only')
    const result = await executeZatomAgentTool('workspace_get_active_structure', {}, host.context)
    expect(result.ok).toBe(true)
    expect(host.modeReads()).toBe(0)
  })

  it('refuses a mutate tool before it runs and names the host and mode', async () => {
    const host = hostContext(() => 'propose-only')
    const result = await executeZatomAgentTool('structure_apply_operations', {
      operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }],
      applyToWorkspace: true,
    }, host.context)
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('host_policy_denied')
    expect(result.summary).toContain('In-page WebMCP')
    expect(result.summary).toContain('Propose only')
    expect(host.writes()).toBe(0)
    expect(host.structure().atoms[0].position).toEqual([0, 0, 0])
  })

  it('lets a compute tool run under propose-only, returns the candidate, and blocks the apply with a reason', async () => {
    const host = hostContext(() => 'propose-only')
    const result = await executeZatomAgentTool('structure_build_metal_cluster', {
      geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
    }, host.context)
    expect(result.ok).toBe(true)
    const data = result.data as { appliedToWorkspace: boolean; applicationBlocked: boolean; result: { structure: { atoms: unknown[] } } }
    expect(data.appliedToWorkspace).toBe(false)
    expect(data.applicationBlocked).toBe(true)
    expect(data.result.structure.atoms.length).toBe(13)
    const gate = result.checks?.find((check) => check.id === 'candidate.application_gate')
    expect(gate?.status).toBe('fail')
    expect(gate?.message).toContain('no safe viewport proposal')
    expect(host.writes()).toBe(0)
    expect(host.modeReads()).toBe(1)
  })

  it('turns a propose-only apply request into a bound ghost proposal when the viewport supports it', async () => {
    const host = hostContext(() => 'propose-only')
    let proposals = 0
    const { fingerprintStructure } = await import('../structure-math')
    const sourceFingerprint = fingerprintStructure(host.structure())
    host.context.workspaceIdentity = () => ({
      viewportId: 'vp-1',
      revision: 7,
      structureFingerprint: sourceFingerprint,
      trajectoryFingerprint: null,
    })
    host.context.proposal = {
      propose: async (input) => {
        proposals += 1
        return {
          id: 'proposal-bound',
          intent: input.intent,
          status: 'pending',
          baseFingerprint: input.baseFingerprint,
          viewportId: input.viewportId,
          workspaceRevision: input.workspaceRevision,
          candidateFingerprint: fingerprintStructure(input.candidate),
          previewRevision: 1,
          diff: {
            added: [], removed: [], moved: [],
            addedCount: input.changeSet.addedCount ?? 0,
            removedCount: input.changeSet.removedCount ?? 0,
            movedCount: input.changeSet.movedCount ?? 0,
            summary: 'candidate preview',
            bounds: null,
          },
        }
      },
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => null,
      withdraw: () => null,
    }

    const result = await executeZatomAgentTool('structure_build_metal_cluster', {
      geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
    }, host.context)
    expect(result.ok).toBe(true)
    const data = result.data as {
      appliedToWorkspace: boolean
      applicationBlocked: boolean
      proposal: { id: string; viewportId: string; workspaceRevision: number } | null
    }
    expect(data.appliedToWorkspace).toBe(false)
    expect(data.applicationBlocked).toBe(false)
    expect(data.proposal).toMatchObject({ id: 'proposal-bound', viewportId: 'vp-1', workspaceRevision: 7 })
    expect(result.checks?.find((check) => check.id === 'candidate.application_gate')?.status).toBe('pass')
    expect(proposals).toBe(1)
    expect(host.writes()).toBe(0)
  })

  it('withdraws a proposal when supplied expectedWorkspace changes during publication', async () => {
    const host = hostContext(() => 'propose-only')
    const { fingerprintStructure } = await import('../structure-math')
    const sourceFingerprint = fingerprintStructure(host.structure())
    const expected = {
      viewportId: 'vp-expected',
      revision: 11,
      structureFingerprint: sourceFingerprint,
      trajectoryFingerprint: null,
    }
    let identityReads = 0
    let withdrawn: string | null = null
    host.context.expectedWorkspace = expected
    host.context.workspaceIdentity = () => {
      identityReads += 1
      return identityReads < 3
        ? expected
        : { ...expected, revision: expected.revision + 1 }
    }
    host.context.proposal = {
      propose: (input) => ({
        id: 'proposal-became-stale',
        intent: input.intent,
        status: 'pending',
        baseFingerprint: input.baseFingerprint,
        viewportId: input.viewportId,
        workspaceRevision: input.workspaceRevision,
        candidateFingerprint: fingerprintStructure(input.candidate),
        previewRevision: 1,
        diff: {
          added: [], removed: [], moved: [],
          addedCount: input.changeSet.addedCount ?? input.changeSet.added?.length ?? 0,
          removedCount: input.changeSet.removedCount ?? input.changeSet.removed?.length ?? 0,
          movedCount: input.changeSet.movedCount ?? input.changeSet.moved?.length ?? 0,
          summary: 'candidate preview',
          bounds: null,
        },
      }),
      readCandidate: () => { throw new Error('not used') },
      revise: () => { throw new Error('not used') },
      status: () => null,
      withdraw: (id) => { withdrawn = id; return null },
    }

    const result = await executeZatomAgentTool('structure_build_metal_cluster', {
      geometry: 'icosahedral', element: 'Pt', shells: 1, applyToWorkspace: true,
    }, host.context)
    expect(result.ok).toBe(true)
    const data = result.data as { proposal: unknown; applicationBlocked: boolean }
    expect(data.proposal).toBeNull()
    expect(data.applicationBlocked).toBe(true)
    expect(withdrawn).toBe('proposal-became-stale')
    expect(result.checks?.find((check) => check.id === 'candidate.application_gate')?.message)
      .toContain('workspace changed')
  })

  it('lets propose-only parse structure text and blocks only workspace application', async () => {
    const host = hostContext(() => 'propose-only')
    const input = {
      format: 'xyz',
      text: '3\nwater\nO 0 0 0\nH 0.9572 0 0\nH -0.239 0.9266 0\n',
    }

    const candidate = await executeZatomAgentTool('structure_import_text', {
      ...input,
      applyToWorkspace: false,
    }, host.context)
    expect(candidate.ok).toBe(true)
    expect((candidate.data as { appliedToWorkspace: boolean; result: { structure: { atoms: unknown[] } } }).appliedToWorkspace).toBe(false)
    expect((candidate.data as { result: { structure: { atoms: unknown[] } } }).result.structure.atoms).toHaveLength(3)
    expect(host.writes()).toBe(0)

    const blockedApply = await executeZatomAgentTool('structure_import_text', {
      ...input,
      applyToWorkspace: true,
      captureAfter: false,
    }, host.context)
    expect(blockedApply.ok).toBe(true)
    expect((blockedApply.data as { appliedToWorkspace: boolean; applicationBlocked: boolean }).appliedToWorkspace).toBe(false)
    expect((blockedApply.data as { applicationBlocked: boolean }).applicationBlocked).toBe(true)
    expect(host.writes()).toBe(0)
  })

  it('reads the mode per call so a panel change applies to the next call', async () => {
    let mode: ZatomHostWriteMode = 'read-only'
    const host = hostContext(() => mode)
    const input = { operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }], applyToWorkspace: true }

    const denied = await executeZatomAgentTool('structure_apply_operations', input, host.context)
    expect(denied.error?.code).toBe('host_policy_denied')

    mode = 'read-write'
    const allowed = await executeZatomAgentTool('structure_apply_operations', input, host.context)
    expect(allowed.ok).toBe(true)
    expect(host.writes()).toBe(1)
    expect(host.structure().atoms[0].position[0]).toBeCloseTo(1)
  })

  it('leaves test contexts without an explicit host policy unrestricted', async () => {
    let writes = 0
    const context: ZatomToolContext = {
      readStructure: () => structuredClone(water),
      writeStructure: () => { writes += 1 },
    }
    const result = await executeZatomAgentTool('structure_apply_operations', {
      operations: [{ op: 'translate', selection: { all: true }, vector: [1, 0, 0] }],
      applyToWorkspace: true,
    }, context)
    expect(result.ok).toBe(true)
    expect(writes).toBe(1)
  })
})
