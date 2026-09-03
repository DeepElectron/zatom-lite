import { describe, expect, it } from 'vitest'
import type { WorkspaceFrame } from '../host/ports'
import { appendLocalWorkspaceFrame, createLocalWorkspaceState, parseLocalWorkspaceState } from '../host/localWorkspace'
import {
  crystalPresentationChanged,
  createCrystalPresentationArtifact,
  restoreCrystalPresentationArtifact,
} from '../orchestration/crystal-presentation-artifact'
import { createCrystalStore } from '../orchestration/crystalStore'
import { crystalAtomsFromWorkspaceFrame } from '../lib/crystal/workspace-frame-structure'
import { evaluateCrystalLayerSelection } from '../lib/crystal/semantic-layers'
import { cartesianToFractional } from '../lib/crystal/lattice'
import type { LatticeVectors } from '../lib/crystal/types'

function frameWithArtifact(
  crystalPresentation: NonNullable<WorkspaceFrame['crystalPresentation']>,
): WorkspaceFrame {
  return {
    id: 'crystal-frame',
    label: 'Crystal presentation',
    createdAt: '2026-08-13T00:00:00.000Z',
    atoms: [{
      element: 8,
      position: [0, 0, 0],
      selected: 0,
      id: 'oxygen',
      fractionalPosition: [0, 0, 0],
      siteIndex: 0,
    }],
    bonds: [],
    periodicity: 'molecular',
    settings: { stiffness: 100, cutoff: 2, forceField: 'none', method: 'steepest_descent' },
    meta: { eventType: 'FUNCTION_SNAPSHOT_MANUAL' },
    crystalPresentation,
  }
}

describe('ordinary crystal presentation Asset artifact', () => {
  it('roundtrips the global source stick mode through live state and timeline snapshots', () => {
    const source = createCrystalStore()
    source.setState({
      atoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0] }],
      unitCellAtoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0] }],
      viewMode: 'stick', bondRadius: .21,
    })
    source.getState().recordBaseStyle()
    const artifact = createCrystalPresentationArtifact(source.getState())!
    expect(artifact.visual.viewMode).toBe('stick')
    expect(artifact.presentation.baseStyleKeyframes[0].snapshot.viewMode).toBe('stick')
    const destination = createCrystalStore()
    expect(() => restoreCrystalPresentationArtifact(destination, artifact)).not.toThrow()
    expect(destination.getState().viewMode).toBe('stick')
    expect(destination.getState().bondRadius).toBeCloseTo(.21)
  })

  it('roundtrips the independent crystal Licorice representation through the strict schema', () => {
    const source = createCrystalStore()
    source.setState({
      atoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    })
    source.getState().addCrystalLayer({ representation: 'stick' })
    const artifact = createCrystalPresentationArtifact(source.getState())!
    const destination = createCrystalStore()

    expect(() => restoreCrystalPresentationArtifact(destination, artifact)).not.toThrow()
    expect(destination.getState().crystalLayers[0].representation).toBe('stick')
  })

  it('roundtrips layer tracks, global tracks, unrecorded live style, volume controls and camera state', () => {
    const source = createCrystalStore()
    source.setState({
      atoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0], siteIndex: 4 }],
      unitCellAtoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0], siteIndex: 4 }],
      periodic: true,
      supercellParams: { nx: 2, ny: 3, nz: 1 },
      supercellMode: 'normal',
      presentationFrames: 12,
      presentationFps: 24,
      presentationLoop: false,
      background: '#000000',
    })
    source.getState().recordCameraAndBaseStyle({ position: [4, 5, 6], target: [0, 0, 0], zoom: 23 })
    source.getState().addCrystalLayer({
      name: 'Animated oxygen',
      selection: 'elem O',
      representation: 'space-fill',
      color: { mode: 'custom', value: '#ff0000' },
      materialPresetId: 'paper',
      replaceBase: true,
      styleTrack: [{
        id: 'layer-key',
        frame: 7,
        easing: 'smooth',
        patch: {
          representation: 'hyper-stick',
          opacity: .35,
          scale: 1.7,
          shading: { mode: 'hatch', ambient: .4 },
        },
      }],
    })
    source.getState().setPresentationFrame(7)
    source.setState({
      // These are deliberately not recorded into the base track.
      renderStyle: 'pixel8',
      stylePresetId: 'custom',
      radiusScale: .73,
      bondRadius: .19,
      background: '#123456',
      outline: true,
      outlineWidth: 3.4,
      outlineColor: '#fedcba',
      sphereDetail: 40,
      elementOverrides: { O: { color: '#224466', radius: 1.11 } },
      atomShininess: 77,
      bondBicolor: false,
      bondColor: '#abcdef',
      polyStyle: 'gem',
      polyColorSource: 'element',
      polyElementColors: { O: '#112233' },
      polyColor: '#334455',
      showPolyEdges: false,
      polyEdgeColor: '#445566',
      polyEdgeOpacity: .4,
      polySpecular: .6,
      polyShininess: 31,
      polyFresnel: .25,
      cellColor: '#556677',
      cellLineWidth: 2.1,
      showCrystalAxes: false,
      autoRotate: true,
      ambientIntensity: .31,
      diffuseIntensity: .72,
      specularIntensity: .44,
      rimIntensity: .28,
      volumeField: 'bonding',
      volumeResolution: 64,
      isoLevel: .43,
      isoStyle: 'hologram',
      isoOpacity: .66,
      isoColorPos: '#667788',
      isoColorNeg: '#778899',
      sliceEnabled: true,
      sliceH: 1,
      sliceK: 1,
      sliceL: 1,
      sliceOffset: .63,
      sliceColormap: 'cividis',
      sliceStyle: 'blueprint',
      sliceContours: 9,
      sliceOpacity: .71,
      sliceClip: 'back',
      sliceIsolate: true,
      sliceLineColor: '#8899aa',
      sliceBgColor: '#99aabb',
      viewMode: 'hyper-stick',
      atomScale: 1.8,
      bondScale: 1.1,
      elementRadiusVariance: .35,
      showBonds: false,
      showLattice: true,
      showAtomLabels: true,
      atomLabelSize: 1.4,
      atomLabelColor: '#aabbcc',
      atomLabelScope: 'selected',
      atomLabelContent: 'element-number',
      atomLabelOutline: false,
      atomLabelPosition: 'below',
      atomLabelGap: .35,
      showCoordinationPolyhedra: true,
      polyhedraOpacity: .52,
      polyhedraCentralElements: new Set(['O']),
      lightAmbient: .8,
      lightKey: 1.6,
      lightFill: .3,
      lightAzimuth: 123,
      lightElevation: -12,
      cameraProjection: 'orthographic',
      savedCameraState: { position: [11, 12, 13], target: [1, 2, 3], zoom: 37 },
      selectedAtomIds: new Set(['oxygen']),
      presentationPlaying: true,
    })

    const initialArtifact = createCrystalPresentationArtifact(source.getState())!
    expect(initialArtifact.schema).toBe('zatom.crystal-presentation/v2')
    expect(initialArtifact.layers[0].styleTrack?.[0].id).toBe('layer-key')
    expect(initialArtifact.presentation.baseStyleKeyframes).toHaveLength(1)
    expect(initialArtifact.visual.background).toBe('#123456')
    expect(initialArtifact.visual).toMatchObject({
      showAtomLabels: true,
      atomLabelSize: 1.4,
      atomLabelColor: '#aabbcc',
      atomLabelScope: 'selected',
      atomLabelContent: 'element-number',
      atomLabelOutline: false,
      atomLabelPosition: 'below',
      atomLabelGap: .35,
    })
    expect(initialArtifact).not.toHaveProperty('selectedAtomIds')
    expect(initialArtifact.presentation).not.toHaveProperty('playing')
    expect(initialArtifact.supercell.params).toEqual({ nx: 2, ny: 3, nz: 1 })
    expect(initialArtifact.supercell.unitCellAtoms).toHaveLength(1)

    source.getState().updateCrystalLayer(source.getState().crystalLayers[0].id, {
      representation: 'surface',
      styleTrack: [{
        id: 'geometric-layer-key',
        frame: 7,
        easing: 'smooth',
        patch: { representation: 'polyhedra', color: { mode: 'custom', value: '#abcdef' } },
      }],
    })
    const artifact = createCrystalPresentationArtifact(source.getState())!
    expect(artifact.layers[0].representation).toBe('surface')
    expect(artifact.layers[0].styleTrack?.[0].patch.representation).toBe('polyhedra')

    const initial = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = initial.workspaces[0]
    const batch = workspace.batches[0]
    const persisted = appendLocalWorkspaceFrame(
      initial,
      workspace.id,
      batch.id,
      frameWithArtifact(artifact),
      true,
    )
    const reloaded = parseLocalWorkspaceState(structuredClone(persisted))
    const reloadedArtifact = reloaded?.workspaces[0].assets['crystal-frame'].crystalPresentation
    expect(reloadedArtifact?.camera.pose?.zoom).toBe(37)

    const destination = createCrystalStore()
    destination.setState({
      atoms: source.getState().atoms,
      selectedAtomIds: new Set(['transient']),
      presentationPlaying: true,
    })
    restoreCrystalPresentationArtifact(destination, reloadedArtifact!)
    const restored = destination.getState()

    expect(restored.crystalLayers[0].representation).toBe('surface')
    expect(restored.crystalLayers[0].styleTrack?.[0]).toMatchObject({
      id: 'geometric-layer-key',
      patch: { representation: 'polyhedra', color: { mode: 'custom', value: '#abcdef' } },
    })
    expect(restored.presentationFrame).toBe(7)
    expect(restored.presentationFrames).toBe(12)
    expect(restored.presentationFps).toBe(24)
    expect(restored.presentationLoop).toBe(false)
    expect(restored.supercellParams).toEqual({ nx: 2, ny: 3, nz: 1 })
    expect(restored.unitCellAtoms).toEqual(source.getState().unitCellAtoms)
    expect(restored.supercellMode).toBe('normal')
    expect(restored.cameraKeyframes).toHaveLength(1)
    expect(restored.cameraKeyframes[0].zoom).toBe(23)
    expect(restored.baseStyleKeyframes).toHaveLength(1)
    // Restore evaluates the track, then reapplies the captured unrecorded live style.
    expect(restored.background).toBe('#123456')
    expect(restored.renderStyle).toBe('pixel8')
    expect(restored.radiusScale).toBe(.73)
    expect(restored.bondRadius).toBe(.19)
    expect(restored.volumeField).toBe('bonding')
    expect(restored.isoStyle).toBe('hologram')
    expect(restored.sliceColormap).toBe('cividis')
    expect(restored.showCoordinationPolyhedra).toBe(true)
    expect(restored.showAtomLabels).toBe(true)
    expect(restored.atomLabelSize).toBe(1.4)
    expect(restored.atomLabelColor).toBe('#aabbcc')
    expect(restored.atomLabelScope).toBe('selected')
    expect(restored.atomLabelContent).toBe('element-number')
    expect(restored.atomLabelOutline).toBe(false)
    expect(restored.atomLabelPosition).toBe('below')
    expect(restored.atomLabelGap).toBe(.35)
    expect([...restored.polyhedraCentralElements]).toEqual(['O'])
    expect(restored.elementOverrides).toEqual({ O: { color: '#224466', radius: 1.11 } })
    expect(restored.cameraProjection).toBe('orthographic')
    expect(restored.savedCameraState).toEqual({ position: [11, 12, 13], target: [1, 2, 3], zoom: 37 })
    expect(restored.presentationPlaying).toBe(false)
    // Selection is transient and remains outside the presentation artifact.
    expect([...restored.selectedAtomIds]).toEqual(['transient'])
  })

  it('uses current atom-label defaults when restoring an older v2 artifact', () => {
    const source = createCrystalStore()
    source.setState({
      atoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    })
    const artifact = createCrystalPresentationArtifact(source.getState())!
    delete artifact.visual.showAtomLabels
    delete artifact.visual.atomLabelSize
    delete artifact.visual.atomLabelColor
    delete artifact.visual.atomLabelScope
    delete artifact.visual.atomLabelContent
    delete artifact.visual.atomLabelOutline
    delete artifact.visual.atomLabelPosition
    delete artifact.visual.atomLabelGap

    const destination = createCrystalStore()
    destination.setState({
      showAtomLabels: true,
      atomLabelSize: 2,
      atomLabelColor: '#ffffff',
      atomLabelScope: 'selected',
      atomLabelContent: 'number',
      atomLabelOutline: false,
      atomLabelPosition: 'below',
      atomLabelGap: 1,
    })
    expect(() => restoreCrystalPresentationArtifact(destination, artifact)).not.toThrow()
    expect(destination.getState()).toMatchObject({
      showAtomLabels: true,
      atomLabelSize: .8,
      // An older artifact without color restores automatic null and clears stale target color.
      atomLabelColor: null,
      atomLabelScope: 'selected',
      atomLabelContent: 'element-number',
      atomLabelOutline: true,
      atomLabelPosition: 'center',
      atomLabelGap: 0,
    })
  })

  it('rejects unsupported schemas, malformed label options, malformed layer tracks and dual presentation artifacts', () => {
    const source = createCrystalStore()
    source.setState({
      atoms: [{ id: 'oxygen', element: 'O', position: [0, 0, 0], cartesian: [0, 0, 0] }],
    })
    const artifact = createCrystalPresentationArtifact(source.getState())!

    for (const [field, value] of [
      ['atomLabelScope', 'nearby'],
      ['atomLabelContent', 'serial'],
      ['atomLabelPosition', 'left'],
      ['atomLabelGap', 2.01],
      ['atomLabelGap', -0.01],
    ] as const) {
      const malformedLabelOption = structuredClone(artifact)
      Object.assign(malformedLabelOption.visual, { [field]: value })
      expect(() => restoreCrystalPresentationArtifact(
        createCrystalStore(),
        malformedLabelOption,
      )).toThrow(/Invalid/)
    }

    const unsupported = structuredClone(artifact) as unknown as { schema: string }
    unsupported.schema = 'zatom.crystal-presentation/v1'
    expect(() => restoreCrystalPresentationArtifact(createCrystalStore(), unsupported as never)).toThrow(/Invalid/)

    const unsupportedRepresentation = structuredClone(artifact)
    unsupportedRepresentation.layers[0] = {
      ...unsupportedRepresentation.layers[0],
      representation: 'cartoon' as never,
    }
    expect(() => restoreCrystalPresentationArtifact(createCrystalStore(), unsupportedRepresentation)).toThrow(/Invalid/)

    const outsideTimeline = structuredClone(artifact)
    outsideTimeline.layers = [{
      id: 'bad',
      name: 'Bad',
      selection: 'all',
      representation: 'ball-stick',
      color: { mode: 'element' },
      materialPresetId: null,
      shading: null,
      visible: true,
      opacity: 1,
      scale: 1,
      bondScale: 1,
      replaceBase: false,
      styleTrack: [{ id: 'outside-timeline', frame: 120, easing: 'smooth', patch: { opacity: .5 } }],
    }]
    const initial = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = initial.workspaces[0]
    const batch = workspace.batches[0]
    const invalidWorkspace = appendLocalWorkspaceFrame(
      initial,
      workspace.id,
      batch.id,
      frameWithArtifact(outsideTimeline),
    )
    expect(parseLocalWorkspaceState(invalidWorkspace)).not.toBeNull()

    const malformed = structuredClone(outsideTimeline)
    malformed.layers[0].styleTrack![0].frame = 100_001
    expect(() => appendLocalWorkspaceFrame(
      initial, workspace.id, batch.id, frameWithArtifact(malformed),
    )).toThrow(/Invalid workspace frame/)

    const dual: WorkspaceFrame = {
      ...frameWithArtifact(artifact),
      biomoleculePresentation: {} as never,
    }
    expect(() => appendLocalWorkspaceFrame(initial, workspace.id, batch.id, dual, false)).toThrow(/Invalid workspace frame/)

    const lossyCrystalFrame = frameWithArtifact(artifact)
    lossyCrystalFrame.atoms = [{ element: 8, position: [0, 0, 0], selected: 0 }]
    expect(() => appendLocalWorkspaceFrame(
      initial, workspace.id, batch.id, lossyCrystalFrame, false,
    )).toThrow(/Invalid workspace frame/)
  })

  it('marks every Asset-owned crystal presentation channel dirty, including manual camera poses', () => {
    const store = createCrystalStore()
    const before = store.getState()
    store.setState({ savedCameraState: { position: [4, 5, 6], target: [1, 2, 3] } })
    expect(crystalPresentationChanged(store.getState(), before)).toBe(true)

    const beforeLayer = store.getState()
    store.getState().addCrystalLayer({
      styleTrack: [{ id: 'key', frame: 4, easing: 'smooth', patch: { opacity: .4 } }],
    })
    expect(crystalPresentationChanged(store.getState(), beforeLayer)).toBe(true)

    const beforeTransient = store.getState()
    store.setState({ selectedAtomIds: new Set(['transient']) })
    expect(crystalPresentationChanged(store.getState(), beforeTransient)).toBe(false)

  })

  it('reloads materialized supercell identities and fractional DSL coordinates losslessly', () => {
    const source = createCrystalStore()
    const unit = { id: 'unit-fe', element: 'Fe', position: [.2, .1, .3] as [number, number, number], cartesian: [.8, .4, 1.2] as [number, number, number], siteIndex: 7 }
    source.setState({
      atoms: [
        { ...unit, id: 'fe-cell-0', position: [.1, .1, .3], cellIndex: [0, 0, 0] },
        { ...unit, id: 'fe-cell-1', position: [.6, .1, .3], cartesian: [4.8, .4, 1.2], cellIndex: [1, 0, 0] },
      ],
      unitCellAtoms: [unit],
      supercellParams: { nx: 2, ny: 1, nz: 1 },
    })
    const artifact = createCrystalPresentationArtifact(source.getState())!
    const frame: WorkspaceFrame = {
      ...frameWithArtifact(artifact),
      periodicity: 'periodic',
      latticeMatrix: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      atoms: source.getState().atoms.map((atom) => ({
        element: 26,
        position: atom.cartesian!,
        selected: 0,
        id: atom.id,
        fractionalPosition: atom.position,
        cellIndex: atom.cellIndex,
        siteIndex: atom.siteIndex,
      })),
    }
    const restored = crystalAtomsFromWorkspaceFrame(frame, { a: [4, 0, 0], b: [0, 4, 0], c: [0, 0, 4] })
    expect(restored.map((atom) => atom.id)).toEqual(['fe-cell-0', 'fe-cell-1'])
    expect(restored.map((atom) => atom.position[0])).toEqual([.1, .6])
    expect(restored.map((atom) => atom.siteIndex)).toEqual([7, 7])
    expect(restored.map((atom) => atom.cellIndex)).toEqual([[0, 0, 0], [1, 0, 0]])
  })

  it('preserves site and fractional DSL semantics through a combined fork and workspace reload', async () => {
    const source = createCrystalStore()
    const latticeVectors: LatticeVectors = { a: [4, 0, 0], b: [0, 5, 0], c: [0, 0, 6] }
    const oldParams = { nx: 1, ny: 1, nz: 1 }
    const newParams = { nx: 2, ny: 2, nz: 2 }
    source.setState({
      latticeVectors,
      atoms: [
        { id: 'fe-site', element: 'Fe', position: [.2, .3, .4], cartesian: [.8, 1.5, 2.4] },
        { id: 'o-site', element: 'O', position: [.6, .1, .25], cartesian: [2.4, .5, 1.5] },
      ],
      unitCellAtoms: [
        { id: 'fe-site', element: 'Fe', position: [.2, .3, .4], cartesian: [.8, 1.5, 2.4], siteIndex: 0 },
        { id: 'o-site', element: 'O', position: [.6, .1, .25], cartesian: [2.4, .5, 1.5], siteIndex: 1 },
      ],
      supercellMode: 'fork',
      supercellParams: newParams,
    })

    await source.getState().expandSupercellFork(oldParams, newParams)
    const forked = source.getState().atoms
    expect(forked).toHaveLength(16)
    expect(evaluateCrystalLayerSelection(forked, 'site 0', newParams).atomIds.size).toBe(8)
    expect(evaluateCrystalLayerSelection(forked, 'site 0 and fx > 1', newParams).atomIds.size).toBe(4)
    expect(evaluateCrystalLayerSelection(forked, 'site 0 and fy > 1', newParams).atomIds.size).toBe(4)
    expect(evaluateCrystalLayerSelection(forked, 'site 0 and fz > 1', newParams).atomIds.size).toBe(4)
    expect(evaluateCrystalLayerSelection(
      forked,
      'site 0 and fx > 1 and fy > 1 and fz > 1',
      newParams,
    ).atomIds.size).toBe(1)
    for (const atom of forked) {
      const actual = cartesianToFractional(atom.cartesian!, latticeVectors)
      expect(atom.position[0] * newParams.nx).toBeCloseTo(actual[0], 10)
      expect(atom.position[1] * newParams.ny).toBeCloseTo(actual[1], 10)
      expect(atom.position[2] * newParams.nz).toBeCloseTo(actual[2], 10)
    }
    expect(new Set(forked.map((atom) => atom.cellIndex?.join(','))).size).toBe(8)

    const artifact = createCrystalPresentationArtifact(source.getState())!
    const frame: WorkspaceFrame = {
      ...frameWithArtifact(artifact),
      periodicity: 'periodic',
      latticeMatrix: [latticeVectors.a, latticeVectors.b, latticeVectors.c],
      atoms: forked.map((atom) => ({
        element: atom.element === 'Fe' ? 26 : 8,
        position: atom.cartesian!,
        selected: 0,
        id: atom.id,
        fractionalPosition: atom.position,
        cellIndex: atom.cellIndex,
        siteIndex: atom.siteIndex,
      })),
    }
    const initial = createLocalWorkspaceState('2026-08-13T00:00:00.000Z')
    const workspace = initial.workspaces[0]
    const batch = workspace.batches[0]
    const persisted = appendLocalWorkspaceFrame(initial, workspace.id, batch.id, frame, true)
    const reloadedFrame = parseLocalWorkspaceState(structuredClone(persisted))
      ?.workspaces[0].assets[frame.id]
    expect(reloadedFrame).toBeDefined()
    const restored = crystalAtomsFromWorkspaceFrame(reloadedFrame!, latticeVectors)
    expect(restored.map((atom) => atom.id)).toEqual(forked.map((atom) => atom.id))
    expect(evaluateCrystalLayerSelection(restored, 'site 0', newParams).atomIds.size).toBe(8)
    expect(evaluateCrystalLayerSelection(
      restored,
      'site 0 and fx > 1 and fy > 1 and fz > 1',
      newParams,
    ).atomIds.size).toBe(1)
  })
})
