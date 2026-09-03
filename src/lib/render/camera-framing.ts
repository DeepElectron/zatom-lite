export type CameraFramingVector3 = readonly [number, number, number]

export interface CameraFramingBounds {
  min: CameraFramingVector3
  max: CameraFramingVector3
}

export interface DefaultCameraFramingPose {
  position: [number, number, number]
  target: [number, number, number]
  zoom: number
  framingSpan: number
}

export interface ComparableCameraPose {
  position: CameraFramingVector3
  target: CameraFramingVector3
  zoom?: number
}

const ORTHOGRAPHIC_FRAME_FRACTION = 0.72
const MINIMUM_SCENE_SPAN = 1
const MINIMUM_FOCUS_SPAN = 6
const CAMERA_DISTANCE_MULTIPLIER = 2.5
const CAMERA_CLEARANCE_MARGIN = 1

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number): number {
  return Math.max(0, finite(value))
}

function vectorNear(
  left: CameraFramingVector3,
  right: CameraFramingVector3,
  epsilon: number,
): boolean {
  return Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon
    && Math.abs(left[2] - right[2]) <= epsilon
}

/** True only while the live camera is still on an authored/default pose. */
export function cameraPoseApproximatelyEqual(
  left: ComparableCameraPose,
  right: ComparableCameraPose,
  epsilon = 1e-4,
): boolean {
  if (!vectorNear(left.position, right.position, epsilon)
    || !vectorNear(left.target, right.target, epsilon)) return false
  if (left.zoom === undefined && right.zoom === undefined) return true
  return left.zoom !== undefined
    && right.zoom !== undefined
    && Math.abs(left.zoom - right.zoom) <= epsilon
}

export function orthographicZoomForSpan(
  framingSpan: number,
  width: number,
  height: number,
): number {
  const sceneSpan = Math.max(nonNegative(framingSpan), MINIMUM_SCENE_SPAN)
  const viewportSpan = Math.max(Math.min(nonNegative(width), nonNegative(height)), 1)
  return Math.max(0.2, Math.min(80, (viewportSpan * ORTHOGRAPHIC_FRAME_FRACTION) / sceneSpan))
}

export function cameraBoundsFromPoints(
  points: readonly CameraFramingVector3[],
): CameraFramingBounds | null {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let count = 0
  for (const point of points) {
    const x = point[0], y = point[1], z = point[2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z)
    count += 1
  }
  return count === 0
    ? null
    : { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

export function defaultCameraPoseForBounds(
  bounds: CameraFramingBounds,
  width: number,
  height: number,
  minimumDistance = 8,
): DefaultCameraFramingPose {
  const target: [number, number, number] = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ]
  const framingSpan = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
    MINIMUM_SCENE_SPAN,
  )
  const distance = Math.max(framingSpan * CAMERA_DISTANCE_MULTIPLIER, nonNegative(minimumDistance))
  return {
    position: [target[0] + distance, target[1] + distance * 0.5, target[2] + distance],
    target,
    zoom: orthographicZoomForSpan(framingSpan, width, height),
    framingSpan,
  }
}

export function defaultCameraPoseForPeriodicCell(
  a: CameraFramingVector3,
  b: CameraFramingVector3,
  c: CameraFramingVector3,
  repeats: readonly [number, number, number],
  width: number,
  height: number,
): DefaultCameraFramingPose {
  const nx = Math.max(1, Math.trunc(finite(repeats[0], 1)))
  const ny = Math.max(1, Math.trunc(finite(repeats[1], 1)))
  const nz = Math.max(1, Math.trunc(finite(repeats[2], 1)))
  const target: [number, number, number] = [
    (nx * a[0] + ny * b[0] + nz * c[0]) / 2,
    (nx * a[1] + ny * b[1] + nz * c[1]) / 2,
    (nx * a[2] + ny * b[2] + nz * c[2]) / 2,
  ]
  const length = (vector: CameraFramingVector3) => Math.hypot(vector[0], vector[1], vector[2])
  const framingSpan = Math.max(length(a) * nx, length(b) * ny, length(c) * nz, MINIMUM_SCENE_SPAN)
  const distance = framingSpan * CAMERA_DISTANCE_MULTIPLIER
  return {
    position: [target[0] + distance, target[1] + distance * 0.5, target[2] + distance],
    target,
    zoom: orthographicZoomForSpan(framingSpan, width, height),
    framingSpan,
  }
}

/** Full projected span used to frame a spherical selection from any view direction. */
export function focusFramingSpan(selectionRadius: number, visualRadius: number): number {
  return Math.max(
    (nonNegative(selectionRadius) + nonNegative(visualRadius)) * 2,
    MINIMUM_FOCUS_SPAN,
  )
}

/**
 * Conservative camera distance from `target`: every supplied point lies inside
 * this target-centred sphere, with room for the largest rendered atom/ribbon.
 */
export function cameraSceneClearanceFromPoints(
  points: readonly CameraFramingVector3[],
  target: CameraFramingVector3,
  visualPadding = 0,
): number {
  let radius = 0
  for (const point of points) {
    const dx = point[0] - target[0]
    const dy = point[1] - target[1]
    const dz = point[2] - target[2]
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) continue
    radius = Math.max(radius, Math.hypot(dx, dy, dz))
  }
  return radius + nonNegative(visualPadding) + CAMERA_CLEARANCE_MARGIN
}

export function cameraSceneClearanceFromBounds(
  bounds: CameraFramingBounds,
  target: CameraFramingVector3,
  visualPadding = 0,
): number {
  const points: CameraFramingVector3[] = []
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) points.push([x, y, z])
    }
  }
  return cameraSceneClearanceFromPoints(points, target, visualPadding)
}

/**
 * Minimum target-to-camera distance along one view direction. Geometry beside
 * or behind the focus target does not reduce the perspective close-up; only
 * geometry between the target and the eye can force the camera back.
 */
export function cameraViewClearanceFromPoints(
  points: readonly CameraFramingVector3[],
  target: CameraFramingVector3,
  viewDirection: CameraFramingVector3,
  visualPadding = 0,
): number {
  let dx = finite(viewDirection[0])
  let dy = finite(viewDirection[1])
  let dz = finite(viewDirection[2])
  const directionLength = Math.hypot(dx, dy, dz)
  if (directionLength < 1e-6) {
    dx = 0; dy = 0; dz = 1
  } else {
    dx /= directionLength; dy /= directionLength; dz /= directionLength
  }
  let frontDepth = 0
  for (const point of points) {
    const px = point[0] - target[0]
    const py = point[1] - target[1]
    const pz = point[2] - target[2]
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue
    frontDepth = Math.max(frontDepth, px * dx + py * dy + pz * dz)
  }
  return frontDepth + nonNegative(visualPadding) + CAMERA_CLEARANCE_MARGIN
}

export function cameraViewClearanceFromBounds(
  bounds: CameraFramingBounds,
  target: CameraFramingVector3,
  viewDirection: CameraFramingVector3,
  visualPadding = 0,
): number {
  const points: CameraFramingVector3[] = []
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) points.push([x, y, z])
    }
  }
  return cameraViewClearanceFromPoints(points, target, viewDirection, visualPadding)
}

/** Keep a focus camera outside the supplied clearance without changing its authored distance otherwise. */
export function resolvedFocusDistance(
  requestedDistance: number,
  sceneClearance: number | undefined,
): number {
  const requested = Math.max(nonNegative(requestedDistance), 1e-3)
  return Math.max(requested, nonNegative(sceneClearance ?? 0))
}

export function preservedViewCameraPosition(
  startPosition: CameraFramingVector3,
  startTarget: CameraFramingVector3,
  endTarget: CameraFramingVector3,
  distance: number,
): [number, number, number] {
  let dx = startPosition[0] - startTarget[0]
  let dy = startPosition[1] - startTarget[1]
  let dz = startPosition[2] - startTarget[2]
  let length = Math.hypot(dx, dy, dz)
  if (length < 1e-4) {
    dx = 1; dy = 0.5; dz = 1
    length = 1.5
  }
  const scale = Math.max(distance, 1e-3) / length
  return [
    endTarget[0] + dx * scale,
    endTarget[1] + dy * scale,
    endTarget[2] + dz * scale,
  ]
}
