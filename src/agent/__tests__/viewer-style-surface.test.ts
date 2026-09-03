import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useViewportManager } from '../../orchestration/viewportManager'
import { activeViewportStyleSurface } from '../viewer-style-surface'
import { VIEWER_STYLE_ZATOM_AGENT_TOOLS } from '../viewer-style-tools'

const setTool = VIEWER_STYLE_ZATOM_AGENT_TOOLS[1]

function activeStore() {
  const manager = useViewportManager.getState()
  manager.setLayout('1x1')
  manager.setActive('vp-1')
  return manager.getActiveStore()
}

function resetStyleFixture() {
  const state = activeStore().getState()
  state.clearConstructedPlane()
  state.clearMolecularOrbitalData()
  state.setHideHydrogens(false)
  state.setCameraProjection('perspective')
}

describe('active viewport style surface', () => {
  beforeEach(resetStyleFixture)
  afterEach(resetStyleFixture)

  it('fails closed when enabling a field slice without its plane or colour field', async () => {
    const store = activeStore()
    const context = { viewerStyle: activeViewportStyleSurface }

    const noPlane = await setTool.execute({
      hideHydrogens: true,
      fieldSlice: { enabled: true },
    }, context)
    expect(noPlane.ok).toBe(false)
    expect(noPlane.error?.code).toBe('no_constructed_plane')
    expect(store.getState().hideHydrogens).toBe(false)
    expect(store.getState().molecularOrbital.fieldSlice.enabled).toBe(false)

    store.setState({
      constructedPlane: {
        id: 'test-plane',
        points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        normal: [0, 0, 1],
        d: 0,
        center: [0, 0, 0],
        method: 'three-atoms',
        sourceIds: ['a', 'b', 'c'],
      },
    })
    const noField = await setTool.execute({ fieldSlice: { enabled: true } }, context)
    expect(noField.ok).toBe(false)
    expect(noField.error?.code).toBe('no_color_field')
    expect(store.getState().molecularOrbital.fieldSlice.enabled).toBe(false)
  })

  it('reads and applies the complete field-slice presentation once prerequisites exist', async () => {
    const store = activeStore()
    store.setState({
      constructedPlane: {
        id: 'test-plane',
        points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
        normal: [0, 0, 1],
        d: 0,
        center: [0, 0, 0],
        method: 'three-atoms',
        sourceIds: ['a', 'b', 'c'],
      },
    })
    store.getState().loadCubData({ title: 'Electron density', comment: '' }, 'density.cube')
    store.getState().setSurfaceColorField({ title: 'ESP', comment: '' }, 'esp.cube')

    const result = await setTool.execute({
      cameraProjection: 'orthographic',
      fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.7, contours: 6 },
      surface: { resolution: 64 },
    }, { viewerStyle: activeViewportStyleSurface })

    expect(result.ok).toBe(true)
    expect(result.data).toMatchObject({
      cameraProjection: 'orthographic',
      fieldSlice: { enabled: true, mode: 'slice-only', opacity: 0.7, contours: 6 },
      surface: { resolution: 64 },
    })
    expect(result.summary).toContain('field-slice slice-only opacity=0.7 contours=6')
  })
})
