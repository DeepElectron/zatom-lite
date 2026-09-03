import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  executeVisualizationBundle,
  inferVisualizationBundleRole,
} from '../local-visualization-bundle-tools'
import type { ZatomToolContext } from '../contracts'
import { setActiveLocalDirectoryBinding } from '../../host/localDirectoryBinding'
import {
  captureViewportManagerTransaction,
  restoreViewportManagerTransaction,
  useViewportManager,
  type ViewportManagerTransactionSnapshot,
} from '../../orchestration/viewportManager'
import { useAgentOperationReview } from '../../orchestration/agentOperationReviewStore'
import { readActiveViewportWorkspaceIdentity } from '../viewer-context'

interface FakeFileEntry {
  kind: 'file'
  name: string
  file: File
}

function cube(name: string, title: string, options: { originX?: number } = {}): FakeFileEntry {
  const originX = options.originX ?? 0
  const text = [
    title,
    'bundle regression fixture',
    `1 ${originX} 0.0 0.0`,
    '2 1.0 0.0 0.0',
    '2 0.0 1.0 0.0',
    '2 0.0 0.0 1.0',
    '6 0.0 0.0 0.0 0.0',
    '0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8',
  ].join('\n')
  return { kind: 'file', name, file: new File([text], name) }
}

function fakeDirectory(name: string, entries: FakeFileEntry[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) {
        yield {
          kind: 'file',
          name: entry.name,
          getFile: async () => entry.file,
        } as FileSystemFileHandle
      }
    },
    async getDirectoryHandle() {
      throw new DOMException('missing directory', 'NotFoundError')
    },
    async getFileHandle(fileName: string) {
      const entry = entries.find((candidate) => candidate.name === fileName)
      if (!entry) throw new DOMException(`missing ${fileName}`, 'NotFoundError')
      return {
        kind: 'file',
        name: entry.name,
        getFile: async () => entry.file,
      } as FileSystemFileHandle
    },
  } as unknown as FileSystemDirectoryHandle
}

function completeFiles(extra: FakeFileEntry[] = []): FakeFileEntry[] {
  return [
    cube('electron-density.cube', 'Electron density in real space'),
    cube('electrostatic-potential.cube', 'Molecular electrostatic potential in real space'),
    cube('orbital-homo.cube', 'Orbital value in real space'),
    cube('orbital-lumo.cube', 'Orbital value in real space'),
    ...extra,
  ]
}

function minimalMolden(): FakeFileEntry {
  const text = `[Molden Format]
[Atoms] (AU)
C 1 6 0.0 0.0 0.0
[GTO]
1 0
s 1 1.00
1.0 1.0

[MO]
Sym= HOMO
Ene= -0.5
Spin= Alpha
Occup= 2.0
1 1.0
Sym= LUMO
Ene= 0.2
Spin= Alpha
Occup= 0.0
1 1.0
`
  return { kind: 'file', name: 'wavefunction.molden', file: new File([text], 'wavefunction.molden') }
}

function bind(entries: FakeFileEntry[]): void {
  setActiveLocalDirectoryBinding({ handle: fakeDirectory('calculation', entries), name: 'calculation' })
}

function applyContext(): ZatomToolContext {
  return { expectedWorkspace: readActiveViewportWorkspaceIdentity() }
}

let originalManager: ViewportManagerTransactionSnapshot

beforeEach(() => {
  originalManager = captureViewportManagerTransaction()
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null, pendingOperations: 0 })
})

afterEach(() => {
  restoreViewportManagerTransaction(originalManager)
  setActiveLocalDirectoryBinding(null)
  useAgentOperationReview.setState({ control: { phase: 'idle' }, takeover: null, pendingOperations: 0 })
})

describe('visualization bundle discovery', () => {
  it('recognizes the four canonical files and ignores NTO orbitals', () => {
    expect(inferVisualizationBundleRole('electron-density.cube')).toBe('density')
    expect(inferVisualizationBundleRole('electrostatic-potential.cube')).toBe('esp')
    expect(inferVisualizationBundleRole('orbital-homo.cube')).toBe('homo')
    expect(inferVisualizationBundleRole('orbital-lumo.cube')).toBe('lumo')
    expect(inferVisualizationBundleRole('wavefunction.molden')).toBe('orbitals')
    expect(inferVisualizationBundleRole('density.cube')).toBe('density')
    expect(inferVisualizationBundleRole('rho.cube')).toBe('density')
    expect(inferVisualizationBundleRole('potential.cube')).toBe('esp')
    expect(inferVisualizationBundleRole('mep.cube')).toBe('esp')
    expect(inferVisualizationBundleRole('spin-density.cube')).toBeNull()
    expect(inferVisualizationBundleRole('difference-density.cube')).toBeNull()
    expect(inferVisualizationBundleRole('excited-brightest-nto-hole.cube', 'Orbital value')).toBeNull()
  })

  it('returns a complete no-write plan and does not parse an unused optional Molden file', async () => {
    const unusedMolden = new File(['not a Molden file'], 'wavefunction.molden')
    Object.defineProperty(unusedMolden, 'size', { value: 40 * 1024 * 1024 })
    const malformedMolden: FakeFileEntry = {
      kind: 'file',
      name: 'wavefunction.molden',
      file: unusedMolden,
    }
    bind(completeFiles([
      malformedMolden,
      cube('excited-brightest-nto-hole.cube', 'Orbital value in real space'),
    ]))
    const before = captureViewportManagerTransaction()

    const result = await executeVisualizationBundle({}, {})

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('plan')
    expect(result.data?.plan.ready).toBe(true)
    expect(result.data?.plan.presentation).toBe('bundle')
    expect(result.data?.plan.layout).toBe('2x2')
    expect(result.data?.plan.assignments.map((entry) => entry.label)).toEqual([
      'Density', 'Density + ESP', 'HOMO', 'LUMO',
    ])
    expect(result.data?.plan.ignoredFiles).toContain('excited-brightest-nto-hole.cube')
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'visualization_bundle.orbitals.molden',
      status: 'skipped',
    }))
    const after = captureViewportManagerTransaction()
    expect(after.layout).toBe(before.layout)
    expect(after.viewports).toBe(before.viewports)
  })

  it('plans a standalone Density presentation without implicitly using discovered ESP or orbitals', async () => {
    bind(completeFiles())

    const result = await executeVisualizationBundle({ presentation: 'density' }, {})

    expect(result.ok).toBe(true)
    expect(result.data?.plan).toMatchObject({
      ready: true,
      presentation: 'density',
      layout: '1x1',
      assignments: [{ slotId: 'vp-1', label: 'Density', surfaceSource: 'electron-density.cube' }],
    })
    expect(result.data?.plan.assignments[0]).not.toHaveProperty('colorFieldSource')
    expect(result.data?.plan.roles).toEqual({ density: 'electron-density.cube' })
    expect(result.data?.plan.ignoredFiles).toEqual(expect.arrayContaining([
      'electrostatic-potential.cube',
      'orbital-homo.cube',
      'orbital-lumo.cube',
    ]))
    expect(result.checks).not.toContainEqual(expect.objectContaining({
      id: 'visualization_bundle.required.esp',
      status: 'fail',
    }))
  })

  it('plans Density + ESP alone and still requires an explicit aligned ESP role', async () => {
    bind([
      cube('electron-density.cube', 'Electron density in real space'),
      cube('electrostatic-potential.cube', 'Molecular electrostatic potential in real space'),
    ])

    const ready = await executeVisualizationBundle({ presentation: 'density-esp' }, {})

    expect(ready.ok).toBe(true)
    expect(ready.data?.plan).toMatchObject({
      ready: true,
      presentation: 'density-esp',
      layout: '1x1',
      assignments: [{
        slotId: 'vp-1',
        label: 'Density + ESP',
        surfaceSource: 'electron-density.cube',
        colorFieldSource: 'electrostatic-potential.cube',
      }],
    })

    bind([cube('electron-density.cube', 'Electron density in real space')])
    const missingEsp = await executeVisualizationBundle({ presentation: 'density-esp' }, {})
    expect(missingEsp.ok).toBe(true)
    expect(missingEsp.data?.plan.ready).toBe(false)
    expect(missingEsp.checks).toContainEqual(expect.objectContaining({
      id: 'visualization_bundle.required.esp',
      status: 'fail',
    }))
  })

  it('derives HOMO and LUMO panes from Molden when separate orbital cubes are absent', async () => {
    bind([
      cube('electron-density.cube', 'Electron density in real space'),
      cube('electrostatic-potential.cube', 'Molecular electrostatic potential in real space'),
      minimalMolden(),
    ])

    const result = await executeVisualizationBundle({}, {})

    expect(result.ok).toBe(true)
    expect(result.data?.plan.ready).toBe(true)
    expect(result.data?.plan.assignments.slice(2)).toEqual([
      { slotId: 'vp-3', label: 'HOMO', surfaceSource: 'wavefunction.molden', orbitalIndex: 0 },
      { slotId: 'vp-4', label: 'LUMO', surfaceSource: 'wavefunction.molden', orbitalIndex: 1 },
    ])
  })

  it('turns an expired folder grant into an actionable reconnect error', async () => {
    const denied = {
      kind: 'directory',
      name: 'expired',
      async *values() {
        throw new DOMException('permission expired', 'NotAllowedError')
      },
    } as unknown as FileSystemDirectoryHandle
    setActiveLocalDirectoryBinding({ handle: denied, name: 'expired', persistence: 'persistent' })

    const result = await executeVisualizationBundle({}, {})

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('directory_permission_lost')
    expect(result.summary).toMatch(/reconnect.*Assets > Folder/i)
  })
})

describe('visualization bundle transaction', () => {
  it('atomically mounts four panes, attaches ESP to Density, and has one exact rollback', async () => {
    bind(completeFiles())

    const result = await executeVisualizationBundle({ applyToWorkspace: true }, applyContext())

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('mounted')
    const manager = useViewportManager.getState()
    expect(manager.layout).toBe('2x2')
    expect(Object.values(manager.viewports).map((slot) => slot.label)).toEqual([
      'Density', 'Density + ESP', 'HOMO', 'LUMO',
    ])
    const density = manager.getViewportStore('vp-1')!.getState().molecularOrbital
    const esp = manager.getViewportStore('vp-2')!.getState().molecularOrbital
    const homo = manager.getViewportStore('vp-3')!.getState().molecularOrbital
    const lumo = manager.getViewportStore('vp-4')!.getState().molecularOrbital
    expect(density.sourceName).toBe('electron-density.cube')
    expect(density.colorField).toBeNull()
    expect(esp.sourceName).toBe('electron-density.cube')
    expect(esp.colorField?.sourceName).toBe('electrostatic-potential.cube')
    expect(esp.colorField?.colormap).toBe('rwb')
    expect(homo.sourceName).toBe('orbital-homo.cube')
    expect(lumo.sourceName).toBe('orbital-lumo.cube')

    const control = useAgentOperationReview.getState().control
    expect(control.phase).toBe('awaiting_review')
    if (control.phase !== 'awaiting_review' || control.review.subject.kind !== 'workspace') return
    await control.review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(useViewportManager.getState().viewports).toBe(originalManager.viewports)
    expect(useViewportManager.getState().layout).toBe(originalManager.layout)
  })

  it('atomically mounts standalone Density in 1x1 without attaching a discovered ESP file', async () => {
    bind(completeFiles())

    const result = await executeVisualizationBundle(
      { presentation: 'density', applyToWorkspace: true },
      applyContext(),
    )

    expect(result.ok).toBe(true)
    expect(result.data?.status).toBe('mounted')
    const manager = useViewportManager.getState()
    expect(manager.layout).toBe('1x1')
    expect(Object.keys(manager.viewports)).toEqual(['vp-1'])
    expect(manager.viewports['vp-1']?.label).toBe('Density')
    const surface = manager.getViewportStore('vp-1')!.getState().molecularOrbital
    expect(surface.sourceName).toBe('electron-density.cube')
    expect(surface.colorField).toBeNull()

    const control = useAgentOperationReview.getState().control
    expect(control.phase).toBe('awaiting_review')
    if (control.phase !== 'awaiting_review' || control.review.subject.kind !== 'workspace') return
    await control.review.subject.revert()
    useAgentOperationReview.getState().dismissReview()
    expect(useViewportManager.getState().viewports).toBe(originalManager.viewports)
    expect(useViewportManager.getState().layout).toBe(originalManager.layout)
  })

  it('atomically mounts standalone Density + ESP and treats a later field-slice edit as newer work', async () => {
    bind([
      cube('electron-density.cube', 'Electron density in real space'),
      cube('electrostatic-potential.cube', 'Molecular electrostatic potential in real space'),
    ])

    const result = await executeVisualizationBundle(
      { presentation: 'density-esp', applyToWorkspace: true },
      applyContext(),
    )

    expect(result.ok).toBe(true)
    const manager = useViewportManager.getState()
    expect(manager.layout).toBe('1x1')
    const store = manager.getViewportStore('vp-1')!
    expect(store.getState().molecularOrbital.colorField?.sourceName).toBe('electrostatic-potential.cube')
    expect(store.getState().molecularOrbital.colorField?.colormap).toBe('rwb')

    store.getState().setFieldSlice({ enabled: true, mode: 'slice-only' })
    const control = useAgentOperationReview.getState().control
    expect(control.phase).toBe('awaiting_review')
    if (control.phase !== 'awaiting_review' || control.review.subject.kind !== 'workspace') return
    await expect(Promise.resolve().then(() => control.review.subject.kind === 'workspace'
      ? control.review.subject.revert()
      : undefined)).rejects.toThrow(/newer user changes were kept/)
    expect(useViewportManager.getState().layout).toBe('1x1')
    expect(store.getState().molecularOrbital.fieldSlice).toMatchObject({ enabled: true, mode: 'slice-only' })
  })

  it('fails before any visible write when Density and ESP grids do not align', async () => {
    bind([
      cube('electron-density.cube', 'Electron density in real space'),
      cube('electrostatic-potential.cube', 'Molecular electrostatic potential in real space', { originX: 0.25 }),
      cube('orbital-homo.cube', 'Orbital value in real space'),
      cube('orbital-lumo.cube', 'Orbital value in real space'),
    ])
    const before = captureViewportManagerTransaction()

    const result = await executeVisualizationBundle({ applyToWorkspace: true }, applyContext())

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('bundle_not_ready')
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'visualization_bundle.esp.grid_alignment',
      status: 'fail',
    }))
    expect(useViewportManager.getState().layout).toBe(before.layout)
    expect(useViewportManager.getState().viewports).toBe(before.viewports)
    expect(useAgentOperationReview.getState().control.phase).toBe('idle')
  })

  it('keeps newer user surface changes instead of reverting over them', async () => {
    bind(completeFiles())
    const result = await executeVisualizationBundle({ applyToWorkspace: true }, applyContext())
    expect(result.ok).toBe(true)
    const store = useViewportManager.getState().getViewportStore('vp-2')!
    store.getState().setMolecularOrbitalOpacity(0.2)

    const control = useAgentOperationReview.getState().control
    expect(control.phase).toBe('awaiting_review')
    if (control.phase !== 'awaiting_review' || control.review.subject.kind !== 'workspace') return
    await expect(Promise.resolve().then(() => control.review.subject.kind === 'workspace'
      ? control.review.subject.revert()
      : undefined)).rejects.toThrow(/newer user changes were kept/)
    expect(useViewportManager.getState().layout).toBe('2x2')
    expect(store.getState().molecularOrbital.opacity).toBe(0.2)
  })

  it('allows pane and split inspection before reverting the whole bundle', async () => {
    bind(completeFiles())
    const result = await executeVisualizationBundle({ applyToWorkspace: true }, applyContext())
    expect(result.ok).toBe(true)
    useViewportManager.getState().setActive('vp-2')
    useViewportManager.getState().setColumnSplit(0.61)

    const control = useAgentOperationReview.getState().control
    expect(control.phase).toBe('awaiting_review')
    if (control.phase !== 'awaiting_review' || control.review.subject.kind !== 'workspace') return
    await control.review.subject.revert()
    expect(useViewportManager.getState().viewports).toBe(originalManager.viewports)
    expect(useViewportManager.getState().activeViewportId).toBe(originalManager.activeViewportId)
    expect(useViewportManager.getState().columnSplit).toBe(originalManager.columnSplit)
  })

  it('detects a non-active target edit during parsing and preserves it', async () => {
    useViewportManager.getState().setLayout('2x2')
    const beforeCall = captureViewportManagerTransaction()
    const target = useViewportManager.getState().getViewportStore('vp-2')!
    const originalText = completeFiles()[0]!.file
    class EditingFile extends File {
      private edited = false
      override async text(): Promise<string> {
        if (!this.edited) {
          this.edited = true
          target.getState().replaceAtomsDirectly([{
            id: 'user-atom',
            element: 'He',
            position: [4, 5, 6],
            cartesian: [4, 5, 6],
          }])
        }
        return originalText.text()
      }
    }
    const entries = completeFiles()
    entries[0] = {
      kind: 'file',
      name: 'electron-density.cube',
      file: new EditingFile([await originalText.text()], 'electron-density.cube'),
    }
    bind(entries)

    const result = await executeVisualizationBundle({ applyToWorkspace: true }, applyContext())

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('workspace_conflict')
    expect(useViewportManager.getState().viewports).toBe(beforeCall.viewports)
    expect(target.getState().atoms.map((atom) => atom.id)).toEqual(['user-atom'])
  })
})
