import { describe, expect, it } from 'vitest'
import {
  cameraSceneClearanceFromPoints,
  cameraPoseApproximatelyEqual,
  cameraViewClearanceFromPoints,
  defaultCameraPoseForBounds,
  focusFramingSpan,
  orthographicZoomForSpan,
  preservedViewCameraPosition,
  resolvedFocusDistance,
} from '../lib/render/camera-framing'
import { createCrystalStore } from '../orchestration/crystalStore'

describe('camera framing', () => {
  it('distinguishes an untouched default pose from user composition on resize', () => {
    const authored = { position: [10, 5, 10] as const, target: [0, 0, 0] as const, zoom: 24 }
    expect(cameraPoseApproximatelyEqual({
      position: [10 + 1e-6, 5, 10],
      target: [0, 0, 0],
      zoom: 24 + 1e-6,
    }, authored)).toBe(true)
    expect(cameraPoseApproximatelyEqual({
      position: [9, 5, 10],
      target: [0, 0, 0],
      zoom: 24,
    }, authored)).toBe(false)
    expect(cameraPoseApproximatelyEqual({
      position: [10, 5, 10],
      target: [0, 0, 0],
      zoom: 18,
    }, authored)).toBe(false)
  })

  it('keeps the exact default orthographic zoom in the reset target', () => {
    const pose = defaultCameraPoseForBounds({ min: [-10, -5, -2], max: [10, 5, 2] }, 1_000, 800)
    const store = createCrystalStore()
    store.setState({
      periodic: false,
      atoms: [
        { id: 'selected', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
        { id: 'other', element: 'C', position: [10, 0, 0], cartesian: [10, 0, 0] },
      ],
    })
    store.getState().setInitialCameraPosition(pose.position, pose.target, pose.zoom)
    store.getState().focusOnAtoms(['selected'])
    expect(store.getState().cameraTarget).toMatchObject({
      preserveViewDirection: true,
      framingSpan: expect.any(Number),
      sceneClearance: expect.any(Number),
    })

    store.getState().clearFocusedAtoms()

    expect(store.getState().cameraTarget).toEqual({
      position: pose.position,
      lookAt: pose.target,
      zoom: pose.zoom,
      forceOrientation: true,
    })
    expect(store.getState().cameraTarget?.zoom).toBe(orthographicZoomForSpan(20, 1_000, 800))
    expect(store.getState().focusedAtomIds).toEqual(new Set())
    expect(store.getState().massiveSceneVisualFocusAtomIds).toEqual(new Set())
  })

  it('separates selected framing from complete-scene camera clearance', () => {
    const selectedSpan = focusFramingSpan(1.5, 1)
    const target: [number, number, number] = [0, 0, 0]
    const sceneClearance = cameraSceneClearanceFromPoints([
      [-12, 0, 0], [12, 0, 0], [0, 8, 0], [0, 0, 9],
    ], target, 1)
    const requestedDistance = 7.5

    expect(selectedSpan).toBe(6)
    expect(sceneClearance).toBe(14)
    expect(resolvedFocusDistance(requestedDistance, sceneClearance)).toBe(14)
    expect(resolvedFocusDistance(20, sceneClearance)).toBe(20)

    const position = preservedViewCameraPosition([0, 0, 20], [0, 0, 0], target, sceneClearance)
    expect(Math.hypot(position[0], position[1], position[2])).toBeCloseTo(sceneClearance)
    expect(orthographicZoomForSpan(selectedSpan, 1_000, 800)).toBeGreaterThan(
      orthographicZoomForSpan(24, 1_000, 800),
    )
  })

  it('only moves a perspective focus back for geometry between the target and eye', () => {
    const target: [number, number, number] = [0, 0, 0]
    const viewDirection: [number, number, number] = [0, 0, 1]
    const clearance = cameraViewClearanceFromPoints([
      [0, 0, 8],       // toward the camera: must remain in front of the eye
      [100, 0, 0],     // perpendicular extent must not destroy the close-up
      [0, 0, -200],    // geometry behind the target is already safely visible
    ], target, viewDirection, 2)

    expect(clearance).toBe(11)
    expect(resolvedFocusDistance(7.5, clearance)).toBe(11)
    expect(resolvedFocusDistance(14, clearance)).toBe(14)
  })

  it('emits explicit span and clearance for atom focus instead of inferring from coincident points', () => {
    const store = createCrystalStore()
    store.setState({
      periodic: false,
      atoms: [
        { id: 'selected', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
        { id: 'far', element: 'C', position: [25, 0, 0], cartesian: [25, 0, 0] },
      ],
    })

    store.getState().focusOnAtoms(['selected'])
    const target = store.getState().cameraTarget

    expect(target?.position).toEqual(target?.lookAt)
    expect(target?.framingSpan).toBeGreaterThan(0)
    expect(target?.sceneClearance).toBeGreaterThan(25)
  })

  it('focuses a periodic image at its displayed position while retaining canonical identity', () => {
    const store = createCrystalStore()
    store.setState({
      periodic: true,
      atoms: [
        { id: 'canonical', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
      ],
    })

    store.getState().focusOnAtoms(['canonical'], [12, -4, 3])

    expect(store.getState().cameraTarget?.lookAt).toEqual([12, -4, 3])
    expect(store.getState().cameraTarget?.position).toEqual([12, -4, 3])
    expect(store.getState().focusedAtomIds).toEqual(new Set(['canonical']))
    expect(store.getState().massiveSceneVisualFocusCenter).toEqual([12, -4, 3])
  })

  it('frames the complete selected diameter with margin for large selections', () => {
    const store = createCrystalStore()
    store.setState({
      periodic: false,
      atoms: [
        { id: 'left', element: 'C', position: [-20, 0, 0], cartesian: [-20, 0, 0] },
        { id: 'middle', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
        { id: 'right', element: 'C', position: [20, 0, 0], cartesian: [20, 0, 0] },
      ],
    })

    store.getState().focusOnAtoms(['left', 'middle', 'right'])

    const framingSpan = store.getState().cameraTarget?.framingSpan ?? 0
    expect(framingSpan).toBeGreaterThan(40)
    const zoom = orthographicZoomForSpan(framingSpan, 1_000, 800)
    expect((framingSpan * zoom) / 800).toBeCloseTo(.72)
  })

  it('begins a camera document atomically without inherited pose or focus', () => {
    const store = createCrystalStore()
    store.setState({
      initialCameraPosition: [1, 2, 3],
      initialCameraLookAt: [4, 5, 6],
      initialCameraZoom: 7,
      savedCameraState: { position: [8, 9, 10], target: [1, 1, 1], zoom: 11 },
      cameraTarget: { position: [3, 3, 3], lookAt: [2, 2, 2], framingSpan: 6 },
      isAnimatingCamera: true,
      focusedAtomIds: new Set(['old']),
      massiveSceneVisualFocusAtomIds: new Set(['old']),
      massiveSceneVisualFocusCenter: [1, 2, 3],
      massiveSceneVisualFocusDistance: 9,
    })
    const version = store.getState().cameraAutoResetVersion

    store.getState().beginCameraDocument()

    expect(store.getState()).toMatchObject({
      initialCameraPosition: null,
      initialCameraLookAt: null,
      initialCameraZoom: null,
      savedCameraState: null,
      cameraTarget: null,
      isAnimatingCamera: false,
      massiveSceneVisualFocusCenter: null,
      massiveSceneVisualFocusDistance: null,
      cameraAutoResetVersion: version + 1,
    })
    expect(store.getState().focusedAtomIds).toEqual(new Set())
    expect(store.getState().massiveSceneVisualFocusAtomIds).toEqual(new Set())
  })

  it('gives every programmatic camera command ownership over presentation playback', () => {
    const store = createCrystalStore()
    store.setState({
      periodic: false,
      atoms: [{ id: 'selected', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] }],
      initialCameraPosition: [8, 4, 8],
      initialCameraLookAt: [0, 0, 0],
    })

    const runWhilePlaying = (command: () => void) => {
      store.setState({ presentationPlaying: true, presentationIntervalId: null })
      command()
      expect(store.getState().presentationPlaying).toBe(false)
    }
    runWhilePlaying(() => store.getState().focusOnAtoms(['selected']))
    runWhilePlaying(() => store.getState().focusOnPoint([0, 0, 0], 2))
    runWhilePlaying(() => store.getState().clearFocusedAtoms())
    runWhilePlaying(() => store.getState().resetCameraToInitial())
  })
})
