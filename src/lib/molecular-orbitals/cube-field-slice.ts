import type { CubData, Vector3D } from './CubParser'
import { sampleColormap, type ColorRange, type SurfaceColormap } from './surface-coloring'

export type CubeFieldSliceMode = 'overlay' | 'slice-only'

export interface CubeFieldSliceSettings {
  enabled: boolean
  opacity: number
  contours: number
  mode: CubeFieldSliceMode
}

export const DEFAULT_CUBE_FIELD_SLICE: CubeFieldSliceSettings = {
  enabled: false,
  opacity: 0.86,
  contours: 8,
  mode: 'overlay',
}

export interface CubePlaneFrame {
  center: Vector3D
  normal: Vector3D
  radius: number
}

export interface CubePlaneBasis {
  normal: Vector3D
  u: Vector3D
  v: Vector3D
}

export interface SampledCubePlane {
  values: Float32Array
  valid: Uint8Array<ArrayBuffer>
  width: number
  height: number
  validCount: number
  min: number
  max: number
}

export type CubeFieldSliceSamplePhase = 'inactive' | 'sampling' | 'ready' | 'unavailable'
export type CubeFieldSliceFailureReason = 'no-valid-samples' | 'sampling-failed' | 'render-failed'

/**
 * Runtime evidence for deciding whether "Slice only" may hide the isosurface.
 * The plane and volume identities prevent a successful result from the prior
 * plane/file from blanking the viewport while a replacement is being sampled.
 */
export interface CubeFieldSliceSampleState {
  phase: CubeFieldSliceSamplePhase
  planeId: string | null
  volumeData: Float32Array | null
  validFraction: number
  failureReason: CubeFieldSliceFailureReason | null
}

export const EMPTY_CUBE_FIELD_SLICE_SAMPLE: CubeFieldSliceSampleState = {
  phase: 'inactive',
  planeId: null,
  volumeData: null,
  validFraction: 0,
  failureReason: null,
}

export function isCubeFieldSliceSampleReady(
  sample: CubeFieldSliceSampleState,
  planeId: string | null | undefined,
  data: CubData | null | undefined,
): boolean {
  return sample.phase === 'ready'
    && Boolean(planeId)
    && sample.planeId === planeId
    && sample.volumeData === data?.volumeData
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function add(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function subtract(a: Vector3D, b: Vector3D): Vector3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function scale(vector: Vector3D, amount: number): Vector3D {
  return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount }
}

function dot(a: Vector3D, b: Vector3D) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vector3D, b: Vector3D): Vector3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalize(vector: Vector3D): Vector3D | null {
  const length = Math.sqrt(dot(vector, vector))
  if (!Number.isFinite(length) || length <= 1e-12) return null
  return scale(vector, 1 / length)
}

/** The exact local frame used by both the rounded reference plane and its heatmap. */
export function createCubePlaneBasis(normal: Vector3D): CubePlaneBasis | null {
  const n = normalize(normal)
  if (!n) return null
  const seed = Math.abs(n.x) < 0.9
    ? { x: 0, y: -n.z, z: n.y }
    : { x: n.z, y: 0, z: -n.x }
  const u = normalize(seed)
  if (!u) return null
  const v = normalize(cross(n, u))
  return v ? { normal: n, u, v } : null
}

export function cubeGridToWorld(data: CubData, i: number, j: number, k: number): Vector3D {
  return add(
    add(add(data.origin, scale(data.vectors.x, i)), scale(data.vectors.y, j)),
    scale(data.vectors.z, k),
  )
}

/** Convert world coordinates into fractional indices for an arbitrary cube basis. */
export function cubeWorldToGrid(data: CubData, point: Vector3D): Vector3D | null {
  const a = data.vectors.x
  const b = data.vectors.y
  const c = data.vectors.z
  const determinant = dot(a, cross(b, c))
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= 1e-12) return null
  const delta = subtract(point, data.origin)
  return {
    x: dot(delta, cross(b, c)) / determinant,
    y: dot(delta, cross(c, a)) / determinant,
    z: dot(delta, cross(a, b)) / determinant,
  }
}

function voxelValue(data: CubData, i: number, j: number, k: number) {
  const index = i * data.voxels.y * data.voxels.z + j * data.voxels.z + k
  return data.volumeData[index] ?? 0
}

function interpolationBounds(value: number, count: number): readonly [number, number, number] {
  if (count <= 1) return [0, 0, 0]
  const lower = Math.min(Math.floor(value), count - 2)
  return [lower, lower + 1, value - lower]
}

function lerp(a: number, b: number, amount: number) {
  return a + (b - a) * amount
}

/** Trilinear sampling of the real imported cube, including its upper grid boundary. */
export function sampleCubeFieldAtWorld(data: CubData, point: Vector3D): number | null {
  const grid = cubeWorldToGrid(data, point)
  if (!grid) return null
  const nx = Math.trunc(data.voxels.x)
  const ny = Math.trunc(data.voxels.y)
  const nz = Math.trunc(data.voxels.z)
  if (nx < 1 || ny < 1 || nz < 1) return null

  const epsilon = 1e-6
  if (
    grid.x < -epsilon || grid.x > nx - 1 + epsilon
    || grid.y < -epsilon || grid.y > ny - 1 + epsilon
    || grid.z < -epsilon || grid.z > nz - 1 + epsilon
  ) return null

  const gx = clamp(grid.x, 0, nx - 1)
  const gy = clamp(grid.y, 0, ny - 1)
  const gz = clamp(grid.z, 0, nz - 1)
  const [i0, i1, tx] = interpolationBounds(gx, nx)
  const [j0, j1, ty] = interpolationBounds(gy, ny)
  const [k0, k1, tz] = interpolationBounds(gz, nz)

  const c00 = lerp(voxelValue(data, i0, j0, k0), voxelValue(data, i1, j0, k0), tx)
  const c01 = lerp(voxelValue(data, i0, j0, k1), voxelValue(data, i1, j0, k1), tx)
  const c10 = lerp(voxelValue(data, i0, j1, k0), voxelValue(data, i1, j1, k0), tx)
  const c11 = lerp(voxelValue(data, i0, j1, k1), voxelValue(data, i1, j1, k1), tx)
  return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz)
}

/** Sample the attached scalar cube on the exact arbitrary reference plane. */
export function sampleCubeFieldOnPlane(
  data: CubData,
  frame: CubePlaneFrame,
  requestedResolution = 128,
): SampledCubePlane | null {
  const basis = createCubePlaneBasis(frame.normal)
  if (!basis || !Number.isFinite(frame.radius) || frame.radius <= 0) return null
  const resolution = Math.round(clamp(requestedResolution, 16, 256))
  const values = new Float32Array(resolution * resolution)
  const valid = new Uint8Array(new ArrayBuffer(resolution * resolution))
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let validCount = 0

  for (let y = 0; y < resolution; y++) {
    const localV = ((y + 0.5) / resolution * 2 - 1) * frame.radius
    for (let x = 0; x < resolution; x++) {
      const localU = ((x + 0.5) / resolution * 2 - 1) * frame.radius
      const point = add(add(frame.center, scale(basis.u, localU)), scale(basis.v, localV))
      const value = sampleCubeFieldAtWorld(data, point)
      const index = x + y * resolution
      if (value === null) continue
      values[index] = value
      valid[index] = 1
      min = Math.min(min, value)
      max = Math.max(max, value)
      validCount++
    }
  }

  return validCount > 0
    ? { values, valid, width: resolution, height: resolution, validCount, min, max }
    : null
}

// CubData produced by CubParser is immutable after import. Keying by the
// volume buffer makes the O(voxel-count) range pass happen once per imported
// field rather than again for every presentation-only slider update.
const cubeFieldRangeCache = new WeakMap<Float32Array, ColorRange>()

export function cubeFieldRange(data: CubData): ColorRange {
  const cached = cubeFieldRangeCache.get(data.volumeData)
  if (cached) return cached
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of data.volumeData) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const range = Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: -1, max: 1 }
  cubeFieldRangeCache.set(data.volumeData, range)
  return range
}

function channel(value: number) {
  return Math.round(clamp(value, 0, 1) * 255)
}

/** Heatmap and contours both encode the same sampled scalar values. */
export function rasterizeCubeFieldPlane(
  plane: SampledCubePlane,
  colormap: SurfaceColormap,
  range: ColorRange,
  contours: number,
): Uint8Array<ArrayBuffer> {
  const rgba = new Uint8Array(new ArrayBuffer(plane.values.length * 4))
  const span = range.max - range.min
  const contourCount = Math.max(0, Math.round(contours))

  for (let index = 0; index < plane.values.length; index++) {
    if (plane.valid[index] === 0) continue
    const normalized = span === 0 ? 0.5 : (plane.values[index] - range.min) / span
    const [baseR, baseG, baseB] = sampleColormap(colormap, normalized)
    let r = baseR
    let g = baseG
    let b = baseB

    if (contourCount > 0 && normalized >= 0 && normalized <= 1) {
      const phase = normalized * contourCount
      const distance = Math.abs(phase - Math.round(phase))
      if (distance < 0.032) {
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        const line = luminance > 0.57 ? 0.12 : 0.96
        const mix = 1 - distance / 0.032
        r = r * (1 - mix * 0.52) + line * mix * 0.52
        g = g * (1 - mix * 0.52) + line * mix * 0.52
        b = b * (1 - mix * 0.52) + line * mix * 0.52
      }
    }

    const offset = index * 4
    rgba[offset] = channel(r)
    rgba[offset + 1] = channel(g)
    rgba[offset + 2] = channel(b)
    rgba[offset + 3] = 255
  }

  return rgba
}

export function normalizeCubeFieldSlice(
  current: CubeFieldSliceSettings,
  patch: Partial<CubeFieldSliceSettings>,
): CubeFieldSliceSettings {
  return {
    enabled: patch.enabled ?? current.enabled,
    opacity: clamp(patch.opacity ?? current.opacity, 0.1, 1),
    contours: Math.round(clamp(patch.contours ?? current.contours, 0, 20)),
    mode: patch.mode === 'overlay' || patch.mode === 'slice-only' ? patch.mode : current.mode,
  }
}
