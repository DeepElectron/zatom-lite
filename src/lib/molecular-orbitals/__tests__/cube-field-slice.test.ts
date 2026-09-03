import { describe, expect, it } from 'vitest'
import type { CubData } from '../CubParser'
import {
  cubeFieldRange,
  cubeGridToWorld,
  DEFAULT_CUBE_FIELD_SLICE,
  EMPTY_CUBE_FIELD_SLICE_SAMPLE,
  isCubeFieldSliceSampleReady,
  normalizeCubeFieldSlice,
  rasterizeCubeFieldPlane,
  sampleCubeFieldAtWorld,
  sampleCubeFieldOnPlane,
} from '../cube-field-slice'

function makeCube(): CubData {
  const voxels = { x: 3, y: 3, z: 3 }
  const volumeData = new Float32Array(27)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) volumeData[i * 9 + j * 3 + k] = i + 10 * j + 100 * k
    }
  }
  return {
    title: 'synthetic',
    comment: 'skewed native grid',
    atoms: [],
    origin: { x: 10, y: 20, z: 30 },
    voxels,
    vectors: {
      x: { x: 2, y: 0, z: 0 },
      y: { x: 0.5, y: 1, z: 0 },
      z: { x: 0, y: 0.25, z: 1.5 },
    },
    spacing: { x: 2, y: 1, z: 1.5 },
    volumeData,
    bounds: { min: { x: 10, y: 20, z: 30 }, max: { x: 15, y: 22.5, z: 33 } },
  }
}

describe('sampleCubeFieldAtWorld', () => {
  it('samples the true scalar field through a skewed cube basis', () => {
    const cube = makeCube()
    const world = cubeGridToWorld(cube, 0.5, 1.25, 1.75)
    expect(sampleCubeFieldAtWorld(cube, world)).toBeCloseTo(188, 5)
  })

  it('includes the final voxel and rejects points outside the imported grid', () => {
    const cube = makeCube()
    expect(sampleCubeFieldAtWorld(cube, cubeGridToWorld(cube, 2, 2, 2))).toBe(222)
    expect(sampleCubeFieldAtWorld(cube, cubeGridToWorld(cube, -0.01, 1, 1))).toBeNull()
  })
})

describe('sampleCubeFieldOnPlane', () => {
  it('samples an arbitrary reference plane rather than a procedural hkl field', () => {
    const cube = makeCube()
    const plane = sampleCubeFieldOnPlane(cube, {
      center: cubeGridToWorld(cube, 1, 1, 1),
      normal: { x: 0.3, y: 0.5, z: 0.8 },
      radius: 1,
    }, 24)
    expect(plane).not.toBeNull()
    expect(plane?.width).toBe(24)
    expect(Array.from(plane!.valid).some(Boolean)).toBe(true)
    expect(plane!.validCount).toBeGreaterThan(0)
    expect(plane!.max).toBeGreaterThan(plane!.min)
  })

  it('reports no slice when the plane does not intersect the Cube grid', () => {
    const cube = makeCube()
    expect(sampleCubeFieldOnPlane(cube, {
      center: { x: -100, y: -100, z: -100 },
      normal: { x: 0, y: 0, z: 1 },
      radius: 2,
    }, 24)).toBeNull()
  })
})

describe('slice-only readiness', () => {
  it('accepts only a ready result for the current plane and Cube volume', () => {
    const cube = makeCube()
    const ready = {
      ...EMPTY_CUBE_FIELD_SLICE_SAMPLE,
      phase: 'ready' as const,
      planeId: 'plane-current',
      volumeData: cube.volumeData,
      validFraction: 0.4,
    }
    expect(isCubeFieldSliceSampleReady(ready, 'plane-current', cube)).toBe(true)
    expect(isCubeFieldSliceSampleReady(ready, 'plane-replaced', cube)).toBe(false)
    expect(isCubeFieldSliceSampleReady(ready, 'plane-current', makeCube())).toBe(false)
    expect(isCubeFieldSliceSampleReady({ ...ready, phase: 'unavailable' }, 'plane-current', cube)).toBe(false)
  })
})

describe('cubeFieldRange', () => {
  it('computes the scientific range once and reuses it for the same imported volume', () => {
    const cube = makeCube()
    const first = cubeFieldRange(cube)
    expect(first).toEqual({ min: 0, max: 222 })
    expect(cubeFieldRange(cube)).toBe(first)
  })
})

describe('rasterizeCubeFieldPlane', () => {
  it('maps valid values through the ESP range and keeps out-of-grid pixels transparent', () => {
    const rgba = rasterizeCubeFieldPlane({
      values: new Float32Array([-1, 0, 1, 0]),
      valid: new Uint8Array(new ArrayBuffer(4)).map((_, index) => index < 3 ? 1 : 0),
      width: 4,
      height: 1,
      validCount: 3,
      min: -1,
      max: 1,
    }, 'rwb', { min: -1, max: 1 }, 0)
    expect(Array.from(rgba)).toEqual([
      255, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 255, 255,
      0, 0, 0, 0,
    ])
  })

  it('normalizes only presentation settings', () => {
    expect(normalizeCubeFieldSlice(DEFAULT_CUBE_FIELD_SLICE, {
      opacity: -1,
      contours: 99,
    })).toMatchObject({ opacity: 0.1, contours: 20 })
  })
})
