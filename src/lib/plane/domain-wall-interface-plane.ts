import type { ConstructedPlane } from '../crystal/types'

type Vec3 = [number, number, number]

interface LatticeVectorsLike {
  a: Vec3
  b: Vec3
  c: Vec3
}

interface DomainWallMetadataLike {
  wallType?: unknown
  domainSelectionAxis?: unknown
  boundaryFrac?: unknown
  [key: string]: unknown
}

interface BuildDomainWallInterfacePlaneArgs {
  latticeVectors: LatticeVectorsLike
  domainWall: DomainWallMetadataLike | null | undefined
}

function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
}

function dot(u: Vec3, v: Vec3): number {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
}

function len(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor]
}

function add(u: Vec3, v: Vec3): Vec3 {
  return [u[0] + v[0], u[1] + v[1], u[2] + v[2]]
}

function normalize(v: Vec3): Vec3 | null {
  const n = len(v)
  if (n <= 1e-12) return null
  return [v[0] / n, v[1] / n, v[2] / n]
}

function latticeAxis(lattice: LatticeVectorsLike, axis: number): Vec3 {
  if (axis === 0) return lattice.a
  if (axis === 1) return lattice.b
  return lattice.c
}

function reciprocalNormal(lattice: LatticeVectorsLike, axis: number): Vec3 | null {
  if (axis === 0) return normalize(cross(lattice.b, lattice.c))
  if (axis === 1) return normalize(cross(lattice.c, lattice.a))
  if (axis === 2) return normalize(cross(lattice.a, lattice.b))
  return null
}

export function buildDomainWallInterfacePlane({
  latticeVectors,
  domainWall,
}: BuildDomainWallInterfacePlaneArgs): ConstructedPlane | null {
  if (!domainWall || domainWall.wallType !== 'vdw') return null

  const axis = Number(domainWall.domainSelectionAxis)
  const boundaryFrac = Number(domainWall.boundaryFrac ?? 0.5)
  if (!Number.isInteger(axis) || axis < 0 || axis > 2) return null
  if (!Number.isFinite(boundaryFrac)) return null

  const normal = reciprocalNormal(latticeVectors, axis)
  if (!normal) return null

  const fractions: Vec3 = [0.5, 0.5, 0.5]
  fractions[axis] = boundaryFrac
  const center = add(
    add(scale(latticeVectors.a, fractions[0]), scale(latticeVectors.b, fractions[1])),
    scale(latticeVectors.c, fractions[2]),
  )
  const d = -dot(normal, center)

  const inPlaneAxes = [0, 1, 2].filter((idx) => idx !== axis)
  const localRadius = Math.max(
    len(latticeAxis(latticeVectors, inPlaneAxes[0])),
    len(latticeAxis(latticeVectors, inPlaneAxes[1])),
  ) * 0.55

  return {
    id: `domain-wall-interface-${Date.now()}`,
    points: [center, center, center],
    normal,
    d,
    center,
    method: 'direct',
    sourceIds: [`domain-wall-interface:vdw:axis-${axis}:frac-${boundaryFrac}`],
    localRadius,
  }
}
