/** PBC-aware Delaunay adsorption-site topology over one detected outward surface layer. */

import Delaunator from 'delaunator'
import { detectSurfaceLayer } from '../lib/analysis/builders/adsorbate'
import type { DetectedSite } from '../lib/analysis/builders/adsorbate-types'
import type { Vec3, ZatomStructure } from './contracts'
import { cartesianToFractional, fractionalToCartesian, invert3 } from './structure-math'

export interface PeriodicAdsorptionSite extends DetectedSite {
  bindingPosition: Vec3
  atomImages: Array<[number, number, number]>
}

export interface DetectPeriodicAdsorptionSitesOptions {
  structure: ZatomStructure
  surfaceUp: Vec3
  layerToleranceA: number
  bondCutoffA: number
  triangleCutoffA: number
  /** Reject the detected host layer before allocating periodic images or triangulating it. */
  maxSurfaceAtoms: number
  maxExpandedSurfacePoints: number
  mergeToleranceA?: number
}

export interface DetectPeriodicAdsorptionSitesResult {
  sites: PeriodicAdsorptionSite[]
  surfaceAtomIndices: number[]
  surfaceMeanProjectionA: number
  normal: Vec3
  inPlanePeriodicAxes: number[]
  expandedSurfacePointCount: number
  delaunayTriangleCount: number
  projectionDuplicateCount: number
  /** Explicitly tagged adsorbate atoms excluded before host surface layering. */
  excludedAdsorbateAtomCount: number
}

interface MeshPoint {
  baseAtomIndex: number
  image: [number, number, number]
  position: Vec3
  x: number
  y: number
}

interface UnnumberedSite {
  kind: PeriodicAdsorptionSite['kind']
  bindingPosition: Vec3
  anchors: Array<{ atomIndex: number; image: [number, number, number] }>
  signature: string
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(value: readonly number[]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (!Number.isFinite(length) || length <= 1e-12) throw new Error('surfaceUp must have non-zero finite length')
  return [value[0] / length, value[1] / length, value[2] / length]
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function scale(value: readonly number[], factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function distance(left: readonly number[], right: readonly number[]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
}

function tangentBasis(normal: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(normal[0]) <= Math.abs(normal[1]) && Math.abs(normal[0]) <= Math.abs(normal[2])
    ? [1, 0, 0]
    : Math.abs(normal[1]) <= Math.abs(normal[2]) ? [0, 1, 0] : [0, 0, 1]
  const first = normalize(cross(normal, helper))
  return [first, normalize(cross(normal, first))]
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function anchorSignature(
  structure: ZatomStructure,
  anchors: Array<{ atomIndex: number; image: [number, number, number] }>,
): string {
  return anchors
    .map((anchor) => `${structure.atoms[anchor.atomIndex].id}@${anchor.image.join(',')}`)
    .sort(compareText)
    .join('|')
}

function centralAlongAxes(position: Vec3, structure: ZatomStructure, axes: readonly number[]): boolean {
  if (!structure.lattice || !axes.length) return true
  const fractional = cartesianToFractional(position, structure.lattice.vectors)!
  const tolerance = 1e-9
  return axes.every((axis) => fractional[axis] >= -tolerance && fractional[axis] < 1 - tolerance)
}

function canonicalSurfacePosition(
  position: Vec3,
  structure: ZatomStructure,
  axes: readonly number[],
): Vec3 {
  if (!structure.lattice || !axes.length) return [...position]
  const fractional = cartesianToFractional(position, structure.lattice.vectors)!
  for (const axis of axes) fractional[axis] -= Math.floor(fractional[axis])
  return fractionalToCartesian(fractional, structure.lattice.vectors)
}

function siteKey(position: Vec3, first: Vec3, second: Vec3, kind: string, toleranceA: number): string {
  return `${kind}:${Math.round(dot(position, first) / toleranceA)}:${Math.round(dot(position, second) / toleranceA)}`
}

function sortedAnchors(
  structure: ZatomStructure,
  anchors: Array<{ atomIndex: number; image: [number, number, number] }>,
): Array<{ atomIndex: number; image: [number, number, number] }> {
  return [...anchors].sort((left, right) => compareText(
    `${structure.atoms[left.atomIndex].id}@${left.image.join(',')}`,
    `${structure.atoms[right.atomIndex].id}@${right.image.join(',')}`,
  ))
}

export function detectPeriodicAdsorptionSites(
  options: DetectPeriodicAdsorptionSitesOptions,
): DetectPeriodicAdsorptionSitesResult {
  const normal = normalize(options.surfaceUp)
  const [firstTangent, secondTangent] = tangentBasis(normal)
  const hostAtomIndices = options.structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => atom.properties?.['zatom.role'] !== 'adsorbate')
    .map(({ index }) => index)
  const atoms = hostAtomIndices.map((index) => {
    const atom = options.structure.atoms[index]
    return { element: atom.element, cartesian: atom.position }
  })
  const excludedAdsorbateAtomCount = options.structure.atoms.length - hostAtomIndices.length
  const surfaceLattice = options.structure.lattice ? {
    a: options.structure.lattice.vectors[0],
    b: options.structure.lattice.vectors[1],
    c: options.structure.lattice.vectors[2],
  } : undefined
  const layer = detectSurfaceLayer(atoms, {
    layer_tolerance: options.layerToleranceA,
    surface_up: normal,
    lattice: surfaceLattice,
  })
  if (!layer.atomIndices.length) {
    return {
      sites: [],
      surfaceAtomIndices: [],
      surfaceMeanProjectionA: 0,
      normal,
      inPlanePeriodicAxes: [],
      expandedSurfacePointCount: 0,
      delaunayTriangleCount: 0,
      projectionDuplicateCount: 0,
      excludedAdsorbateAtomCount,
    }
  }
  const surfaceAtomIndices = layer.atomIndices.map((index) => hostAtomIndices[index])
  // This limit is intentionally enforced immediately after the cheap layer
  // classification.  Checking it after periodic image expansion/Delaunay
  // defeats the safety budget: an oversized surface has already paid the
  // allocation and triangulation cost by the time it is rejected.
  if (surfaceAtomIndices.length > options.maxSurfaceAtoms) {
    const error = new Error(
      `Detected ${surfaceAtomIndices.length} surface atoms above maxSurfaceAtoms=${options.maxSurfaceAtoms}`,
    ) as Error & { code: string }
    error.code = 'surface_too_large'
    throw error
  }
  const lattice = options.structure.lattice
  const inverse = lattice ? invert3(lattice.vectors) : null
  if (lattice && !inverse) throw new Error('Adsorption-site topology cannot invert the lattice')
  const inPlanePeriodicAxes = lattice ? [0, 1, 2].filter((axis) => {
    if (!lattice.periodic[axis]) return false
    const vector = lattice.vectors[axis]
    return Math.abs(dot(vector, normal)) <= Math.max(1e-8, Math.hypot(...vector) * 1e-7)
  }) : []
  if (inPlanePeriodicAxes.length > 2) throw new Error('A nonsingular cell cannot have three independent vectors in one surface plane')
  const maximumCutoffA = Math.max(options.bondCutoffA, options.triangleCutoffA)
  const repeatByAxis: [number, number, number] = [0, 0, 0]
  for (const axis of inPlanePeriodicAxes) {
    const reciprocalNorm = Math.hypot(inverse![0][axis], inverse![1][axis], inverse![2][axis])
    repeatByAxis[axis] = Math.max(1, Math.ceil(maximumCutoffA * reciprocalNorm) + 1)
  }
  const imageCount = repeatByAxis.reduce((product, repeat) => product * (2 * repeat + 1), 1)
  const expandedSurfacePointCount = surfaceAtomIndices.length * imageCount
  if (!Number.isSafeInteger(expandedSurfacePointCount)
    || expandedSurfacePointCount > options.maxExpandedSurfacePoints) {
    throw new Error(
      `Periodic surface mesh needs ${expandedSurfacePointCount.toLocaleString()} points above the ${options.maxExpandedSurfacePoints.toLocaleString()}-point budget`,
    )
  }
  const canonicalBasePositions = new Map<number, Vec3>()
  for (const atomIndex of surfaceAtomIndices) {
    canonicalBasePositions.set(
      atomIndex,
      canonicalSurfacePosition(options.structure.atoms[atomIndex].position, options.structure, inPlanePeriodicAxes),
    )
  }
  const points: MeshPoint[] = []
  for (let firstImage = -repeatByAxis[0]; firstImage <= repeatByAxis[0]; firstImage++) {
    for (let secondImage = -repeatByAxis[1]; secondImage <= repeatByAxis[1]; secondImage++) {
      for (let thirdImage = -repeatByAxis[2]; thirdImage <= repeatByAxis[2]; thirdImage++) {
        const image: [number, number, number] = [firstImage, secondImage, thirdImage]
        const translation = lattice
          ? fractionalToCartesian(image, lattice.vectors)
          : [0, 0, 0] as Vec3
        for (const atomIndex of surfaceAtomIndices) {
          const position = add(canonicalBasePositions.get(atomIndex)!, translation)
          points.push({
            baseAtomIndex: atomIndex,
            image,
            position,
            x: dot(position, firstTangent),
            y: dot(position, secondTangent),
          })
        }
      }
    }
  }
  const mergeToleranceA = options.mergeToleranceA ?? 1e-5
  const projectionCounts = new Map<string, number>()
  for (const point of points) {
    const projectionKey = `${Math.round(point.x / mergeToleranceA)},${Math.round(point.y / mergeToleranceA)}`
    projectionCounts.set(projectionKey, (projectionCounts.get(projectionKey) ?? 0) + 1)
  }
  const projectionDuplicateCount = [...projectionCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  const delaunay = points.length >= 3
    ? Delaunator.from(points, (point) => point.x, (point) => point.y)
    : null
  const triangleCount = delaunay ? delaunay.triangles.length / 3 : 0
  const edges = new Set<string>()
  const triangles: Array<[number, number, number]> = []
  if (delaunay) for (let offset = 0; offset < delaunay.triangles.length; offset += 3) {
    const triangle: [number, number, number] = [
      delaunay.triangles[offset],
      delaunay.triangles[offset + 1],
      delaunay.triangles[offset + 2],
    ]
    triangles.push(triangle)
    for (const [left, right] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      edges.add(left < right ? `${left},${right}` : `${right},${left}`)
    }
  }
  if (delaunay && delaunay.hull.length > 1) for (let index = 0; index < delaunay.hull.length; index++) {
    const left = delaunay.hull[index]
    const right = delaunay.hull[(index + 1) % delaunay.hull.length]
    edges.add(left < right ? `${left},${right}` : `${right},${left}`)
  }
  if (points.length === 2) edges.add('0,1')
  const candidates = new Map<string, UnnumberedSite>()
  const retain = (candidate: Omit<UnnumberedSite, 'signature'>): void => {
    const bindingPosition = canonicalSurfacePosition(candidate.bindingPosition, options.structure, inPlanePeriodicAxes)
    const anchors = sortedAnchors(options.structure, candidate.anchors)
    const signature = anchorSignature(options.structure, anchors)
    const key = siteKey(bindingPosition, firstTangent, secondTangent, candidate.kind, mergeToleranceA)
    const prior = candidates.get(key)
    if (!prior || compareText(signature, prior.signature) < 0) {
      candidates.set(key, { ...candidate, bindingPosition, anchors, signature })
    }
  }
  for (const atomIndex of surfaceAtomIndices) {
    retain({
      kind: 'top',
      bindingPosition: canonicalBasePositions.get(atomIndex)!,
      anchors: [{ atomIndex, image: [0, 0, 0] }],
    })
  }
  for (const edge of edges) {
    const [leftIndex, rightIndex] = edge.split(',').map(Number)
    const left = points[leftIndex]
    const right = points[rightIndex]
    if (distance(left.position, right.position) > options.bondCutoffA) continue
    const bindingPosition = scale(add(left.position, right.position), 0.5)
    if (!centralAlongAxes(bindingPosition, options.structure, inPlanePeriodicAxes)) continue
    retain({
      kind: 'bridge',
      bindingPosition,
      anchors: [
        { atomIndex: left.baseAtomIndex, image: [...left.image] },
        { atomIndex: right.baseAtomIndex, image: [...right.image] },
      ],
    })
  }
  for (const [firstIndex, secondIndex, thirdIndex] of triangles) {
    const first = points[firstIndex]
    const second = points[secondIndex]
    const third = points[thirdIndex]
    if (distance(first.position, second.position) > options.triangleCutoffA
      || distance(first.position, third.position) > options.triangleCutoffA
      || distance(second.position, third.position) > options.triangleCutoffA) continue
    const area2 = Math.abs(
      (second.x - first.x) * (third.y - first.y)
      - (second.y - first.y) * (third.x - first.x)
    )
    if (area2 <= mergeToleranceA ** 2) continue
    const bindingPosition: Vec3 = [
      (first.position[0] + second.position[0] + third.position[0]) / 3,
      (first.position[1] + second.position[1] + third.position[1]) / 3,
      (first.position[2] + second.position[2] + third.position[2]) / 3,
    ]
    if (!centralAlongAxes(bindingPosition, options.structure, inPlanePeriodicAxes)) continue
    retain({
      kind: 'hollow',
      bindingPosition,
      anchors: [
        { atomIndex: first.baseAtomIndex, image: [...first.image] },
        { atomIndex: second.baseAtomIndex, image: [...second.image] },
        { atomIndex: third.baseAtomIndex, image: [...third.image] },
      ],
    })
  }
  const kindOrder = { top: 0, bridge: 1, hollow: 2 }
  const ordered = [...candidates.values()].sort((left, right) => (
    kindOrder[left.kind] - kindOrder[right.kind]
    || dot(left.bindingPosition, firstTangent) - dot(right.bindingPosition, firstTangent)
    || dot(left.bindingPosition, secondTangent) - dot(right.bindingPosition, secondTangent)
    || compareText(left.signature, right.signature)
  ))
  const counts = { top: 0, bridge: 0, hollow: 0 }
  const sites = ordered.map((site): PeriodicAdsorptionSite => {
    counts[site.kind] += 1
    return {
      id: `${site.kind}-${String(counts[site.kind]).padStart(4, '0')}`,
      kind: site.kind,
      bindingPosition: site.bindingPosition,
      position: add(site.bindingPosition, scale(normal, 1.5)),
      normal: [...normal],
      atomIndices: site.anchors.map((anchor) => anchor.atomIndex),
      atomImages: site.anchors.map((anchor) => [...anchor.image]),
    }
  })
  return {
    sites,
    surfaceAtomIndices,
    surfaceMeanProjectionA: layer.meanZ,
    normal,
    inPlanePeriodicAxes,
    expandedSurfacePointCount,
    delaunayTriangleCount: triangleCount,
    projectionDuplicateCount,
    excludedAdsorbateAtomCount,
  }
}
