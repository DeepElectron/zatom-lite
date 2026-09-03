import { describe, expect, it } from 'vitest'
import type { ViewerStylePatch, ViewerStyleSnapshot, ZatomToolContext } from '../contracts'
import { VIEWER_STYLE_ZATOM_AGENT_TOOLS } from '../viewer-style-tools'
import { zatomToolDomain, zatomToolTier } from '../domains'

const [getTool, setTool] = VIEWER_STYLE_ZATOM_AGENT_TOOLS

function fakeContext(): { context: ZatomToolContext; patches: ViewerStylePatch[] } {
  const patches: ViewerStylePatch[] = []
  let snapshot: ViewerStyleSnapshot = {
    stylePresetId: 'vesta',
    viewMode: 'ball-stick',
    cameraProjection: 'perspective',
    hideHydrogens: false,
    keptHydrogens: '',
    showAtomRings: false,
    fieldSlice: { enabled: false, mode: 'overlay', opacity: 0.86, contours: 8 },
    surface: null,
    available: { stylePresets: [{ id: 'vesta', label: 'VESTA' }, { id: 'qc-soft', label: 'QC Soft' }], surfaceColormaps: ['bgr', 'rwb'] },
  }
  const context: ZatomToolContext = {
    viewerStyle: {
      read: () => snapshot,
      apply: (patch) => {
        patches.push(patch)
        if (patch.stylePresetId && !snapshot.available.stylePresets.some((p) => p.id === patch.stylePresetId)) {
          const error = new Error('unknown') as Error & { code: string }
          error.code = 'unknown_style_preset'
          throw error
        }
        snapshot = {
          ...snapshot,
          ...patch,
          fieldSlice: patch.fieldSlice
            ? { ...snapshot.fieldSlice, ...patch.fieldSlice }
            : snapshot.fieldSlice,
          surface: snapshot.surface,
        }
        return snapshot
      },
    },
  }
  return { context, patches }
}

describe('viewer style tools', () => {
  it('are exposed in the default viewport domain below the mutate tier', () => {
    for (const name of ['viewer_get_style', 'viewer_set_style']) {
      expect(zatomToolDomain(name)).toBe('viewport')
      expect(zatomToolTier(name)).toBe('read')
    }
  })

  it('reads the snapshot with the available catalogue', async () => {
    const { context } = fakeContext()
    const result = await getTool.execute({}, context)
    expect(result.ok).toBe(true)
    expect((result.data as ViewerStyleSnapshot).available.stylePresets.map((p) => p.id)).toContain('qc-soft')
  })

  it('forwards the patch verbatim and returns the resulting snapshot', async () => {
    const { context, patches } = fakeContext()
    const result = await setTool.execute({
      stylePresetId: 'qc-soft',
      cameraProjection: 'orthographic',
      hideHydrogens: true,
      keptHydrogens: '1-2',
      fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.7, contours: 6 },
      surface: { resolution: 60 },
    }, context)
    expect(result.ok).toBe(true)
    expect(patches).toEqual([{
      stylePresetId: 'qc-soft',
      cameraProjection: 'orthographic',
      hideHydrogens: true,
      keptHydrogens: '1-2',
      fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.7, contours: 6 },
      surface: { resolution: 60 },
    }])
    expect((result.data as ViewerStyleSnapshot).hideHydrogens).toBe(true)
    expect(result.summary).toContain('kept 1-2')
    expect(result.summary).toContain('field-slice slice-only opacity=0.7 contours=6')
  })

  it('surfaces domain error codes and reports a headless host', async () => {
    const { context } = fakeContext()
    const bad = await setTool.execute({ stylePresetId: 'nope' }, context)
    expect(bad.ok).toBe(false)
    expect(bad.error?.code).toBe('unknown_style_preset')
    const headless = await getTool.execute({}, {})
    expect(headless.error?.code).toBe('style_unavailable')
  })
})
