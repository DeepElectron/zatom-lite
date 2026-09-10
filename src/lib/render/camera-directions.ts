import type { Vec3 } from '../crystal/lattice-math'

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso' | 'a' | 'b' | 'c'
export type CameraViewSpec = StandardView | { direction: Vec3 } | { hkl: [number, number, number] }

export class CameraInputError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CameraInputError'
    this.code = code
  }
}

const STANDARD_DIRECTIONS: Record<string, Vec3> = {
  // Keep these conventions identical to scene-grid: Z is up, front looks
  // toward +Y, and the vector here points from the target to the camera eye.
  front: [0, -1, 0],
  back: [0, 1, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
  iso: [1, 1, 1],
}

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2])
  if (!Number.isFinite(n) || n < 1e-9) throw new CameraInputError('zero_direction', 'View direction must be non-zero.')
  return [v[0] / n, v[1] / n, v[2] / n]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** Camera-side direction (from target towards the eye) for a view spec. */
export function resolveViewDirection(view: CameraViewSpec, vectors?: readonly Vec3[]): Vec3 {
  if (typeof view === 'string') {
    const std = STANDARD_DIRECTIONS[view]
    if (std) return normalize(std)
    if (!vectors) throw new CameraInputError('no_lattice', `View "${view}" needs a periodic structure with a lattice.`)
    const idx = view === 'a' ? 0 : view === 'b' ? 1 : 2
    // Looking *down* the axis = camera sits on the +axis side.
    return normalize(vectors[idx] as Vec3)
  }
  if ('direction' in view) return normalize(view.direction)
  if (!vectors) throw new CameraInputError('no_lattice', 'hkl views need a periodic structure with a lattice.')
  const [a, b, c] = vectors as [Vec3, Vec3, Vec3]
  const [h, k, l] = view.hkl
  if (h === 0 && k === 0 && l === 0) throw new CameraInputError('zero_hkl', 'hkl must not be (0,0,0).')
  // Plane normal = h·a* + k·b* + l·c* ; reciprocal vectors up to the shared 2π/V factor.
  const aStar = cross(b, c)
  const bStar = cross(c, a)
  const cStar = cross(a, b)
  return normalize([
    h * aStar[0] + k * bStar[0] + l * cStar[0],
    h * aStar[1] + k * bStar[1] + l * cStar[1],
    h * aStar[2] + k * bStar[2] + l * cStar[2],
  ])
}

