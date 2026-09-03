import { strict as assert } from 'node:assert'
import { describe, it } from 'vitest'
import { evaluateBioCameraTrack } from '../lib/biomolecule/camera-track'
import { evaluatePresentationStyleTrack, type PresentationStyleKeyframe, type PresentationStyleSnapshot } from '../lib/biomolecule/presentation-style-track'
import {
  evaluateBioStyleTrack,
  evaluateBioVisibility,
  snapshotBioLayerStyle,
  type BioLayerStyleSnapshotContext,
} from '../lib/biomolecule/style-track'
import type { BioLayer, BioStyleKeyframe } from '../lib/biomolecule/types'
import { createCrystalStore } from '../orchestration/crystalStore'
import { mapPresentationFrameToTrajectory } from '../orchestration/slices/presentation-timeline-slice'
import { aggregateLayerStyleTrackMarks } from '../lib/presentation/layer-track-marks'
import {
  autoKeyLayerStyle,
  recordLayerStyle,
  recordLayerVisibility,
} from '../lib/presentation/layer-track-authoring'

function globalStyle(overrides: Partial<PresentationStyleSnapshot> = {}): PresentationStyleSnapshot {
  return {
    renderStyle: 'vesta', background: '#000000', outline: false, outlineWidth: 1,
    outlineColor: '#000000', atomShininess: 20, bondBicolor: true, bondColor: '#000000',
    elementRadiusVariance: 1, showCoordinationPolyhedra: false, polyhedraOpacity: .7,
    polyStyle: 'translucent', polyColorSource: 'atom', polyElementColors: {},
    polyColor: '#5588cc', showPolyEdges: true, polyEdgeColor: '#666666',
    polyEdgeOpacity: 1, polySpecular: .15, polyShininess: 12, polyFresnel: 0,
    cellColor: '#000000', cellLineWidth: 1.2, showCellGrid: false, showCrystalAxes: true,
    ambientIntensity: .2, diffuseIntensity: .4, specularIntensity: .6,
    rimIntensity: 0, viewMode: 'ball-stick', radiusScale: .45, bondRadius: .12,
    atomScale: 1, bondScale: 1, showBonds: true,
    showLattice: true, lightAmbient: null, lightKey: 1, lightFill: null, lightAzimuth: 10,
    lightElevation: 20, ...overrides,
  }
}

describe('biomolecule presentation tracks', () => {
  it('records inherited layer color and complete effective shading as an immutable snapshot', () => {
    const layer: BioLayer = {
      id: 'layer', name: 'Inherited', selection: 'protein', representation: 'cartoon',
      color: { mode: 'inherit' }, visible: true, opacity: .75, scale: 1.2,
      bondScale: .8, shading: { ambient: .9 }, materialPresetId: null,
    }
    const globals: BioLayerStyleSnapshotContext = {
      bioColorScheme: 'viridis',
      renderStyle: 'pixel8',
      ambient: .2, diffuse: .4, specular: .6, shininess: 70, rim: .3,
      lightAmbient: null, lightKey: null,
    }
    const patch = snapshotBioLayerStyle(layer, globals)

    assert.deepEqual(patch, {
      representation: 'cartoon',
      color: { mode: 'scheme', scheme: 'viridis' },
      opacity: .75,
      scale: 1.2,
      bondScale: .8,
      shading: {
        mode: 'pixel', ambient: .9, diffuse: .4, specular: .6,
        shininess: 70, rim: .3,
      },
    })

    // A recorded key owns every inherited field. Later edits to both the
    // global style and the layer's live inherit state cannot alter history.
    globals.bioColorScheme = 'chain'
    globals.renderStyle = 'cel'
    globals.ambient = 1.1
    globals.diffuse = 1.2
    globals.specular = 1.3
    globals.shininess = 150
    globals.rim = 1.4
    const evaluated = evaluateBioStyleTrack(
      [{ id: 'recorded', frame: 4, easing: 'smooth', patch }],
      4,
      { ...layer, color: { mode: 'inherit' }, shading: null },
      globals,
    )
    assert.deepEqual(evaluated?.color, { mode: 'scheme', scheme: 'viridis' })
    assert.deepEqual({
      mode: evaluated?.mode,
      ambient: evaluated?.ambient,
      diffuse: evaluated?.diffuse,
      specular: evaluated?.specular,
      shininess: evaluated?.shininess,
      rim: evaluated?.rim,
    }, {
      mode: 'pixel', ambient: .9, diffuse: .4, specular: .6, shininess: 70, rim: .3,
    })
  })

  it('auto-keys live edits and keeps style recording independent from visibility', () => {
    const initial: BioStyleKeyframe[] = [
      { id: 'style-0', frame: 0, easing: 'smooth', patch: { opacity: .3 } },
      { id: 'hide-5', frame: 5, easing: 'hold', patch: { visible: false } },
    ]
    const keyed = autoKeyLayerStyle(initial, 5, { scale: 2 }, () => 'unused')!
    assert.deepEqual(keyed[1].patch, { visible: false, scale: 2 })
    const recorded = recordLayerStyle(keyed, 5, {
      representation: 'cartoon', opacity: .6, visible: true,
    }, () => 'style-5')
    assert.deepEqual(recorded.find((key) => key.frame === 5)?.patch, {
      representation: 'cartoon', opacity: .6, visible: false,
    })
    const shown = recordLayerVisibility(recorded, 8, true, () => 'show-8')
    assert.deepEqual(shown.find((key) => key.frame === 8), {
      id: 'show-8', frame: 8, easing: 'hold', patch: { visible: true },
    })
  })

  it('sets and clears preset authoring metadata without disturbing same-frame visibility', () => {
    const initial: BioStyleKeyframe[] = [
      { id: 'style-0', frame: 0, easing: 'smooth', patch: { opacity: .3 }, presetId: 'clay' },
      { id: 'hide-5', frame: 5, easing: 'hold', patch: { visible: false } },
    ]
    const applied = autoKeyLayerStyle(
      initial,
      5,
      { opacity: .7 },
      () => 'unused',
      { presetId: 'pearl' },
    )!
    assert.equal(applied[1].presetId, 'pearl')
    assert.deepEqual(applied[1].patch, { visible: false, opacity: .7 })

    const manuallyEdited = autoKeyLayerStyle(
      applied,
      5,
      { opacity: .6 },
      () => 'unused',
      { presetId: null },
    )!
    assert.equal(manuallyEdited[1].presetId, undefined)
    assert.deepEqual(manuallyEdited[1].patch, { visible: false, opacity: .6 })

    const recorded = recordLayerStyle(
      manuallyEdited,
      5,
      { representation: 'surface', opacity: .8 },
      () => 'recorded-5',
      { presetId: 'xray' },
    )
    assert.equal(recorded[1].presetId, 'xray')
    assert.deepEqual(recorded[1].patch, {
      representation: 'surface', opacity: .8, visible: false,
    })
    const cleared = recordLayerStyle(
      recorded,
      5,
      { representation: 'cartoon', opacity: .5 },
      () => 'recorded-again-5',
      { presetId: null },
    )
    assert.equal(cleared[1].presetId, undefined)
  })

  it('writes bio layer style keys atomically and keeps playback independent from the static baseline', () => {
    const store = createCrystalStore()
    const id = store.getState().addBioLayer({
      representation: 'cartoon',
      color: { mode: 'inherit' },
      opacity: .8,
      scale: 1.2,
      bondScale: .9,
    })

    store.getState().setPresentationFrame(0)
    store.getState().recordBioLayerStyle(id)
    store.getState().setPresentationFrame(10)
    store.getState().editBioLayerStyle(id, { opacity: .4 })
    store.getState().editBioLayerStyle(id, { scale: 2 })
    store.getState().setPresentationFrame(20)
    store.getState().editBioLayerStyle(id, { bondScale: 1.5 })

    const authored = store.getState().bioLayers.find((candidate) => candidate.id === id)!
    assert.equal(authored.opacity, .8)
    assert.equal(authored.scale, 1.2)
    assert.equal(authored.bondScale, .9)
    assert.equal(authored.styleTrack?.length, 3)
    const frameTenPatch = authored.styleTrack?.find((keyframe) => keyframe.frame === 10)?.patch
    assert.equal(frameTenPatch?.opacity, .4)
    assert.equal(frameTenPatch?.scale, 2)
    assert.equal(frameTenPatch?.bondScale, .9)
    const defaults = store.getState()
    const evaluate = (frame: number) => evaluateBioStyleTrack(authored.styleTrack, frame, authored, {
      ambient: defaults.lightAmbient ?? defaults.ambientIntensity,
      diffuse: defaults.lightKey ?? defaults.diffuseIntensity,
      specular: defaults.specularIntensity,
      shininess: defaults.atomShininess,
      rim: defaults.rimIntensity,
    })
    assert.deepEqual(
      { opacity: evaluate(10)?.opacity, scale: evaluate(10)?.scale, bondScale: evaluate(10)?.bondScale },
      { opacity: .4, scale: 2, bondScale: .9 },
    )
    assert.deepEqual(
      { opacity: evaluate(15)?.opacity, scale: evaluate(15)?.scale, bondScale: evaluate(15)?.bondScale },
      { opacity: .4, scale: 2, bondScale: 1.2 },
    )
    assert.deepEqual(
      { opacity: evaluate(20)?.opacity, scale: evaluate(20)?.scale, bondScale: evaluate(20)?.bondScale },
      { opacity: .4, scale: 2, bondScale: 1.5 },
    )
  })

  it('auto-starts a bio layer track when its first style edit happens after frame zero', () => {
    const store = createCrystalStore()
    const id = store.getState().addBioLayer({
      representation: 'cartoon',
      color: { mode: 'inherit' },
      opacity: .8,
      scale: 1.2,
      bondScale: .9,
      materialPresetId: 'clay',
    })

    store.getState().setPresentationFrame(61)
    store.getState().editBioLayerStyle(id, {
      representation: 'surface',
      opacity: .45,
      materialPresetId: 'xray',
    })

    const authored = store.getState().bioLayers.find((candidate) => candidate.id === id)!
    assert.equal(authored.representation, 'cartoon')
    assert.equal(authored.opacity, .8)
    assert.equal(authored.materialPresetId, 'clay')
    assert.deepEqual(authored.styleTrack?.map((keyframe) => keyframe.frame), [0, 61])
    assert.equal(authored.styleTrack?.[0].presetId, 'clay')
    assert.equal(authored.styleTrack?.[1].presetId, 'xray')

    const defaults = store.getState()
    const evaluate = (frame: number) => evaluateBioStyleTrack(authored.styleTrack, frame, authored, {
      ambient: defaults.lightAmbient ?? defaults.ambientIntensity,
      diffuse: defaults.lightKey ?? defaults.diffuseIntensity,
      specular: defaults.specularIntensity,
      shininess: defaults.atomShininess,
      rim: defaults.rimIntensity,
    })
    assert.equal(evaluate(0)?.representation, 'cartoon')
    assert.equal(evaluate(0)?.opacity, .8)
    assert.equal(evaluate(61)?.representation, 'surface')
    assert.equal(evaluate(61)?.opacity, .45)
  })

  it('interpolates numeric style fields while holding discrete styles until the destination key', () => {
    const track: BioStyleKeyframe[] = [
      { id: 'a', frame: 0, easing: 'linear', patch: {
        representation: 'cartoon', color: { mode: 'custom', value: '#000000' },
        shading: { mode: 'flat' }, opacity: .2, scale: 1,
      } },
      { id: 'b', frame: 10, easing: 'linear', patch: {
        representation: 'surface', color: { mode: 'custom', value: '#ffffff' },
        shading: { mode: 'cel' }, opacity: .8, scale: 3,
      } },
    ]
    const defaults = { ambient: .5, diffuse: .5, specular: .5, shininess: 30, rim: 0 }
    const before = evaluateBioStyleTrack(track, 4, {}, defaults)
    const after = evaluateBioStyleTrack(track, 6, {}, defaults)
    assert.equal(before?.representation, 'cartoon')
    assert.equal(after?.representation, 'cartoon')
    assert.deepEqual(after?.color, { mode: 'custom', value: '#000000' })
    assert.equal(after?.mode, 'flat')
    assert.equal(evaluateBioStyleTrack(track, 10, {}, defaults)?.representation, 'surface')
    assert.deepEqual(evaluateBioStyleTrack(track, 10, {}, defaults)?.color, { mode: 'custom', value: '#ffffff' })
    assert.equal(evaluateBioStyleTrack(track, 10, {}, defaults)?.mode, 'cel')
    assert.ok(Math.abs((before?.opacity ?? 0) - .44) < 1e-8)
    assert.ok(Math.abs((after?.scale ?? 0) - 2.2) < 1e-8)
  })

  it('keeps visibility as an independent step channel', () => {
    const track: BioStyleKeyframe[] = [
      { id: 'material', frame: 2, easing: 'smooth', patch: { opacity: .5 } },
      { id: 'hide', frame: 5, easing: 'hold', patch: { visible: false } },
      { id: 'show', frame: 9, easing: 'hold', patch: { visible: true } },
    ]
    assert.equal(evaluateBioVisibility(track, 4, true), true)
    assert.equal(evaluateBioVisibility(track, 5, true), false)
    assert.equal(evaluateBioVisibility(track, 10, false), true)
  })

  it('uses source-key easing and takes the shortest azimuth path', () => {
    const epsilon = .05
    const radius = 10
    const pose = evaluateBioCameraTrack([
      {
        id: 'source', frame: 0, easing: 'linear', target: [0, 0, 0],
        position: [Math.sin(Math.PI - epsilon) * radius, 0, Math.cos(Math.PI - epsilon) * radius],
      },
      {
        id: 'destination', frame: 10, easing: 'hold', target: [0, 0, 0],
        position: [Math.sin(-Math.PI + epsilon) * radius, 0, Math.cos(-Math.PI + epsilon) * radius],
      },
    ], 5)
    assert.ok(pose)
    assert.ok(Math.abs(Math.hypot(...pose.position) - radius) < 1e-6)
    assert.ok(pose.position[2] < -9.9, 'the camera should orbit across ±π, not through the front')
  })

  it('records orthographic magnification as a continuous camera channel', () => {
    const pose = evaluateBioCameraTrack([
      { id: 'near', frame: 0, easing: 'linear', target: [0, 0, 0], position: [0, 0, 10], zoom: 20 },
      { id: 'far', frame: 10, easing: 'smooth', target: [0, 0, 0], position: [0, 0, 20], zoom: 80 },
    ], 5)
    assert.ok(pose)
    assert.ok(Math.abs((pose.zoom ?? 0) - 40) < 1e-8, 'zoom should interpolate geometrically like orthographic focus animations')
    assert.equal(evaluateBioCameraTrack([
      { id: 'perspective', frame: 0, easing: 'linear', target: [0, 0, 0], position: [0, 0, 10] },
    ], 0)?.zoom, undefined)
  })

  it('interpolates numeric global channels while holding discrete styles until the destination key', () => {
    const track: PresentationStyleKeyframe[] = [
      { id: 'a', frame: 0, easing: 'linear', snapshot: globalStyle() },
      { id: 'b', frame: 10, easing: 'hold', snapshot: globalStyle({
        renderStyle: 'cel', background: '#ffffff', outline: true, atomScale: 3, lightKey: 2,
      }) },
    ]
    const before = evaluatePresentationStyleTrack(track, 4)
    const after = evaluatePresentationStyleTrack(track, 6)
    const destination = evaluatePresentationStyleTrack(track, 10)
    assert.equal(before?.renderStyle, 'vesta')
    assert.equal(after?.renderStyle, 'vesta')
    assert.equal(before?.background, '#000000')
    assert.equal(after?.background, '#000000')
    assert.equal(after?.outline, false)
    assert.equal(destination?.renderStyle, 'cel')
    assert.equal(destination?.background, '#ffffff')
    assert.equal(destination?.outline, true)
    assert.ok(Math.abs((before?.atomScale ?? 0) - 1.8) < 1e-8)
    assert.ok(Math.abs((after?.lightKey ?? 0) - 1.6) < 1e-8)
  })

  it('maps one presentation playhead across all MODEL trajectory frames', () => {
    assert.equal(mapPresentationFrameToTrajectory(0, 11, 3), 0)
    assert.equal(mapPresentationFrameToTrajectory(5, 11, 3), 1)
    assert.equal(mapPresentationFrameToTrajectory(10, 11, 3), 2)
  })

  it('aggregates bio and crystal layer channels and clears only layer tracks', () => {
    const marks = aggregateLayerStyleTrackMarks([
      { name: 'Bio', styleTrack: [
        { id: 'style', frame: 2, easing: 'smooth', patch: { opacity: .5 } },
        { id: 'hide', frame: 5, easing: 'hold', patch: { visible: false } },
      ] },
      { name: 'Crystal', styleTrack: [
        { id: 'show-style', frame: 5, easing: 'smooth', patch: { visible: true, scale: 2 } },
      ] },
    ])
    assert.deepEqual(marks, [
      { frame: 2, style: 1, show: 0, hide: 0, layerNames: ['Bio'] },
      { frame: 5, style: 1, show: 1, hide: 1, layerNames: ['Bio', 'Crystal'] },
    ])

    const store = createCrystalStore()
    const bioId = store.getState().addBioLayer({ styleTrack: [{
      id: 'bio-key', frame: 2, easing: 'smooth', patch: { opacity: .5 },
    }] })
    const crystalId = store.getState().addCrystalLayer({ styleTrack: [{
      id: 'crystal-key', frame: 3, easing: 'hold', patch: { visible: false },
    }] })
    store.setState({
      cameraKeyframes: [{ id: 'camera', frame: 1, easing: 'smooth', position: [1, 2, 3], target: [0, 0, 0] }],
      baseStyleKeyframes: [{ id: 'base', frame: 1, easing: 'smooth', snapshot: globalStyle() }],
    })
    store.getState().clearLayerStyleTracks()
    assert.equal(store.getState().bioLayers.find((layer) => layer.id === bioId)?.styleTrack?.length, 0)
    assert.equal(store.getState().crystalLayers.find((layer) => layer.id === crystalId)?.styleTrack?.length, 0)
    assert.equal(store.getState().cameraKeyframes.length, 1)
    assert.equal(store.getState().baseStyleKeyframes.length, 1)
    store.getState().clearLayerStyleTracks('all')
    assert.equal(store.getState().cameraKeyframes.length, 0)
    assert.equal(store.getState().baseStyleKeyframes.length, 0)
  })

  it('records global style independently at the source-compatible 24 fps default', () => {
    const store = createCrystalStore()
    assert.equal(store.getState().presentationFps, 24)
    store.setState({ presentationFrame: 7, renderStyle: 'cel', background: '#123456' })
    store.getState().recordBaseStyle()
    assert.equal(store.getState().cameraKeyframes.length, 0)
    assert.equal(store.getState().baseStyleKeyframes.length, 1)
    assert.equal(store.getState().baseStyleKeyframes[0].frame, 7)
    assert.equal(store.getState().baseStyleKeyframes[0].snapshot.renderStyle, 'cel')
    assert.equal(store.getState().baseStyleKeyframes[0].snapshot.background, '#123456')
    store.getState().setPresentationFps(60)
    store.getState().resetPresentationTimeline()
    assert.equal(store.getState().presentationFps, 24)
  })

  it('keeps saved camera pose as persistence state while the guarded renderer evaluates the camera track', () => {
    const store = createCrystalStore()
    store.setState({
      presentationFrames: 11,
      savedCameraState: { position: [9, 9, 9], target: [0, 0, 0], zoom: 37 },
      cameraKeyframes: [
        { id: 'a', frame: 0, easing: 'linear', position: [10, 0, 0], target: [0, 0, 0] },
        { id: 'b', frame: 10, easing: 'linear', position: [0, 10, 0], target: [0, 0, 0] },
      ],
    })

    store.getState().setPresentationFrame(5)

    assert.equal(store.getState().savedCameraState?.zoom, 37)
    assert.deepEqual(store.getState().savedCameraState?.position, [9, 9, 9])
  })
})
