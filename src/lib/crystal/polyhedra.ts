/**
 * Coordination polyhedra computation.
 *
 * Detect local coordination regions directly from geometry, then build a
 * drawable polygon/polyhedron whose vertices are the coordinating atoms.
 * Periodic images are included explicitly, so a primitive cell can recover
 * coordination shells that cross one or more cell faces without bond data.
 *
 * For typical coordination environments (4 / 6 / 8 / 12 neighbours), a
 * brute-force incremental 3D hull (O(n²) per polyhedron) is fast enough.
 *
 * Coplanar environments (for example square-planar PdCl₄) are triangulated in
 * their local plane instead of being discarded.
 *
 * Loosely inspired by the lower-hull primitives in
 * `lib/analysis/phase-diagram/ternary.ts`, but generalised to a full 3D hull
 * (upper AND lower faces).
 */

import type { Atom, LatticeVectors } from './types'
import { calculateVolume, fractionalToCartesian } from './lattice'
import { getMaxBondDistance } from './bonds'
import { isCommonDonor, isMetal } from '../analysis/mof'
import { AtomSpatialGrid } from '../render/atom-spatial-grid'

export type CoordinationGeometry =
  | 'trigonal-planar'
  | 'trigonal-pyramidal'
  | 'tetrahedral'
  | 'square-planar'
  | 'trigonal-bipyramidal'
  | 'square-pyramidal'
  | 'octahedral'
  | 'cubic'
  | 'cuboctahedral'
  | 'irregular'

export const COORDINATION_GEOMETRY_LABELS: Record<CoordinationGeometry, string> = {
  'trigonal-planar': 'Trigonal planar',
  'trigonal-pyramidal': 'Trigonal pyramidal',
  tetrahedral: 'Tetrahedral',
  'square-planar': 'Square planar',
  'trigonal-bipyramidal': 'Trigonal bipyramidal',
  'square-pyramidal': 'Square pyramidal',
  octahedral: 'Octahedral',
  cubic: 'Cubic',
  cuboctahedral: 'Cuboctahedral',
  irregular: 'Irregular',
}

export interface CoordinationPolyhedron {
  centralAtomId: string
  centralElement: string
  centralPosition: [number, number, number]
  coordinationNumber: number
  geometry: CoordinationGeometry
  /** RMS difference from the closest ideal inter-ligand angle signature. */
  fitRmsDegrees: number | null
  /** Cartesian positions of detected coordinating neighbours. */
  vertices: [number, number, number][]
  /** Canonical atom ids corresponding to vertices (periodic images may repeat ids). */
  vertexAtomIds: string[]
  /** Convex-hull triangular faces: each face is a 3-tuple of vertex indices into `vertices`. */
  faces: number[][]
}

export interface CoordinationAnalysisOptions {
  /** If omitted, metals are preferred; structures without metals use non-H centres. */
  centralElements?: Set<string>
  /** Visible periodic cell, including supercell scaling. */
  periodicLatticeVectors?: LatticeVectors
  /** Optional ligand-distance overrides, using sorted keys such as `O-Ti`. */
  pairCutoffs?: Readonly<Record<string, number>>
  /** When true, `pairCutoffs` is also an allowlist and unlisted pairs are excluded. */
  restrictToConfiguredPairs?: boolean
}

export interface CoordinationEnvironmentSummary {
  analyzedCenterCount: number
  recognizedRegionCount: number
  drawableRegionCount: number
  centralElements: string[]
  byGeometry: Partial<Record<CoordinationGeometry, number>>
  warnings: string[]
}

export interface CoordinationEnvironmentAnalysis {
  environments: CoordinationPolyhedron[]
  summary: CoordinationEnvironmentSummary
}

const EPS = 1e-9
const DEFAULT_MIN_AREA = 1e-6
const MIN_NEIGHBOURS = 3
const MAX_NEIGHBOURS = 16
const MAX_COORDINATION_DISTANCE = 3.5
const MAX_ANALYSIS_ATOMS = 20_000

function position(atom: Atom, lattice?: LatticeVectors): [number, number, number] {
  if (atom.cartesian) return atom.cartesian
  if (lattice) return fractionalToCartesian(atom.position, lattice)
  return atom.position ?? [0, 0, 0]
}

interface Vec3 { x: number; y: number; z: number }

function v(p: [number, number, number]): Vec3 {
  return { x: p[0], y: p[1], z: p[2] }
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z }
function norm(a: Vec3): number { return Math.sqrt(dot(a, a)) }

function hasNonCoplanarPoints(points: [number, number, number][]): boolean {
  if (points.length < 4) return false
  const origin = v(points[0])
  for (let i = 1; i < points.length - 2; i++) {
    const a = sub(v(points[i]), origin)
    for (let j = i + 1; j < points.length - 1; j++) {
      const normal = cross(a, sub(v(points[j]), origin))
      if (norm(normal) < DEFAULT_MIN_AREA) continue
      for (let k = j + 1; k < points.length; k++) {
        if (Math.abs(dot(normal, sub(v(points[k]), origin))) > DEFAULT_MIN_AREA) return true
      }
    }
  }
  return false
}

/**
 * Brute-force 3D convex hull: enumerate every ordered triple (i, j, k) of
 * vertices, accept as a face if all other points sit on the same side of the
 * plane (or on the plane within EPS). Suitable for n ≤ 14 (we cap at K=14
 * neighbours upstream).
 *
 * Returns triangular faces with vertex indices into `pts`. Each face is
 * oriented so its outward normal points away from the centroid.
 */
export function convexHull3D(pts: [number, number, number][], minArea = DEFAULT_MIN_AREA): number[][] {
  const n = pts.length
  if (n < 4 || !hasNonCoplanarPoints(pts)) return []

  const vs = pts.map(v)
  // Centroid for outward-normal orientation.
  const cx = vs.reduce((s, p) => s + p.x, 0) / n
  const cy = vs.reduce((s, p) => s + p.y, 0) / n
  const cz = vs.reduce((s, p) => s + p.z, 0) / n
  const centroid: Vec3 = { x: cx, y: cy, z: cz }

  const faces: number[][] = []
  const seen = new Set<string>()

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = vs[i], b = vs[j], c = vs[k]
        const ab = sub(b, a)
        const ac = sub(c, a)
        let normal = cross(ab, ac)
        const nm = norm(normal)
        if (nm < minArea * 2) continue // degenerate triangle (collinear or zero area)
        normal = { x: normal.x / nm, y: normal.y / nm, z: normal.z / nm }
        const dPlane = dot(normal, a)

        // Check all other points lie on the same side of the plane (within EPS).
        let side = 0
        let supportFace = true
        for (let m = 0; m < n; m++) {
          if (m === i || m === j || m === k) continue
          const d = dot(normal, vs[m]) - dPlane
          if (d > EPS) {
            if (side < 0) { supportFace = false; break }
            side = 1
          } else if (d < -EPS) {
            if (side > 0) { supportFace = false; break }
            side = -1
          }
        }
        if (!supportFace) continue

        // Orient outward (centroid should be on the opposite side of the plane).
        const dCentroid = dot(normal, centroid) - dPlane
        let face: [number, number, number]
        if (dCentroid > 0) {
          // Centroid above plane → flip face winding so normal points down (away from centroid).
          face = [i, k, j]
        } else {
          face = [i, j, k]
        }
        // Dedup by sorted-vertex-set key.
        const key = [i, j, k].sort((a, b) => a - b).join('-')
        if (seen.has(key)) continue
        seen.add(key)
        faces.push(face)
      }
    }
  }

  return faces
}

type Point3 = [number, number, number]

function unit([x, y, z]: Point3): Point3 {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

function angleSignature(directions: Point3[]): number[] {
  const angles: number[] = []
  for (let i = 0; i < directions.length; i++) {
    for (let j = i + 1; j < directions.length; j++) {
      const cosine = Math.max(-1, Math.min(1,
        directions[i][0] * directions[j][0]
        + directions[i][1] * directions[j][1]
        + directions[i][2] * directions[j][2],
      ))
      angles.push(Math.acos(cosine) * 180 / Math.PI)
    }
  }
  return angles.sort((a, b) => a - b)
}

function idealSignature(points: Point3[]): number[] {
  return angleSignature(points.map(unit))
}

function signatureRms(actual: number[], ideal: number[]): number {
  if (actual.length !== ideal.length || actual.length === 0) return Infinity
  let sum = 0
  for (let i = 0; i < actual.length; i++) sum += (actual[i] - ideal[i]) ** 2
  return Math.sqrt(sum / actual.length)
}

const SQRT3 = Math.sqrt(3)
const IDEAL_SIGNATURES: Partial<Record<CoordinationGeometry, number[]>> = {
  'trigonal-planar': idealSignature([[1, 0, 0], [-0.5, SQRT3 / 2, 0], [-0.5, -SQRT3 / 2, 0]]),
  'trigonal-pyramidal': idealSignature([[1, 1, 1], [-1, -1, 1], [-1, 1, -1]]),
  tetrahedral: idealSignature([[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]]),
  'square-planar': idealSignature([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]),
  'trigonal-bipyramidal': idealSignature([
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-0.5, SQRT3 / 2, 0], [-0.5, -SQRT3 / 2, 0],
  ]),
  'square-pyramidal': idealSignature([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1]]),
  octahedral: idealSignature([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]),
  cubic: idealSignature([
    [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
    [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
  ]),
  cuboctahedral: idealSignature([
    [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
    [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
    [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
  ]),
}

function classifyGeometry(center: Point3, vertices: Point3[]): { geometry: CoordinationGeometry; fitRmsDegrees: number | null } {
  const directions = vertices.map((point) => unit([
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  ]))
  const actual = angleSignature(directions)
  const candidates: CoordinationGeometry[] = vertices.length === 3
    ? ['trigonal-planar', 'trigonal-pyramidal']
    : vertices.length === 4
      ? ['tetrahedral', 'square-planar']
      : vertices.length === 5
        ? ['trigonal-bipyramidal', 'square-pyramidal']
        : vertices.length === 6
          ? ['octahedral']
          : vertices.length === 8
            ? ['cubic']
            : vertices.length === 12
              ? ['cuboctahedral']
              : []

  let best: CoordinationGeometry = 'irregular'
  let bestScore = Infinity
  for (const geometry of candidates) {
    const ideal = IDEAL_SIGNATURES[geometry]
    if (!ideal) continue
    const score = signatureRms(actual, ideal)
    if (score < bestScore) {
      best = geometry
      bestScore = score
    }
  }
  return bestScore <= 28
    ? { geometry: best, fitRmsDegrees: bestScore }
    : { geometry: 'irregular', fitRmsDegrees: Number.isFinite(bestScore) ? bestScore : null }
}

function triangulatePlanarPolygon(points: Point3[]): number[][] {
  if (points.length < 3) return []
  const center: Point3 = [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
    points.reduce((sum, point) => sum + point[2], 0) / points.length,
  ]
  let normal: Vec3 | null = null
  for (let i = 1; i < points.length - 1 && !normal; i++) {
    const candidate = cross(sub(v(points[i]), v(points[0])), sub(v(points[i + 1]), v(points[0])))
    if (norm(candidate) > DEFAULT_MIN_AREA) normal = candidate
  }
  if (!normal) return []
  const normalLength = norm(normal)
  normal = { x: normal.x / normalLength, y: normal.y / normalLength, z: normal.z / normalLength }

  const first = points.find((point) => Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2]) > EPS)
  if (!first) return []
  const axisU = unit([first[0] - center[0], first[1] - center[1], first[2] - center[2]])
  const axisV = cross(normal, v(axisU))
  const order = points
    .map((point, index) => {
      const relative: Vec3 = { x: point[0] - center[0], y: point[1] - center[1], z: point[2] - center[2] }
      return { index, angle: Math.atan2(dot(relative, axisV), dot(relative, v(axisU))) }
    })
    .sort((a, b) => a.angle - b.angle)
    .map(({ index }) => index)

  const faces: number[][] = []
  for (let i = 1; i < order.length - 1; i++) faces.push([order[0], order[i], order[i + 1]])
  return faces
}

interface ImageAtom {
  atomIndex: number
  position: Point3
}

function periodicShifts(lattice: LatticeVectors | undefined): Point3[] {
  const shifts: Point3[] = [[0, 0, 0]]
  if (!lattice) return shifts
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (let c = -1; c <= 1; c++) {
        if (a !== 0 || b !== 0 || c !== 0) shifts.push([a, b, c])
      }
    }
  }
  return shifts
}

function translated(point: Point3, shift: Point3, lattice: LatticeVectors | undefined): Point3 {
  if (!lattice) return point
  return [
    point[0] + shift[0] * lattice.a[0] + shift[1] * lattice.b[0] + shift[2] * lattice.c[0],
    point[1] + shift[0] * lattice.a[1] + shift[1] * lattice.b[1] + shift[2] * lattice.c[1],
    point[2] + shift[0] * lattice.a[2] + shift[1] * lattice.b[2] + shift[2] * lattice.c[2],
  ]
}

function buildImageGrid(atoms: Atom[], lattice: LatticeVectors | undefined) {
  const basePositions = atoms.map((atom) => position(atom, lattice))
  const imageAtoms: ImageAtom[] = []
  const flat: number[] = []
  for (const shift of periodicShifts(lattice)) {
    for (let atomIndex = 0; atomIndex < atoms.length; atomIndex++) {
      const imagePosition = translated(basePositions[atomIndex], shift, lattice)
      imageAtoms.push({ atomIndex, position: imagePosition })
      flat.push(...imagePosition)
    }
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const image of imageAtoms) {
    minX = Math.min(minX, image.position[0]); maxX = Math.max(maxX, image.position[0])
    minY = Math.min(minY, image.position[1]); maxY = Math.max(maxY, image.position[1])
    minZ = Math.min(minZ, image.position[2]); maxZ = Math.max(maxZ, image.position[2])
  }
  const boxSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ, MAX_COORDINATION_DISTANCE * 2)
  return {
    basePositions,
    imageAtoms,
    grid: new AtomSpatialGrid(new Float32Array(flat), boxSize),
  }
}

/** Detect and classify drawable local coordination regions without requiring bonds. */
export function analyzeCoordinationEnvironments(
  atoms: Atom[],
  options: CoordinationAnalysisOptions = {},
): CoordinationEnvironmentAnalysis {
  const warnings: string[] = []
  const empty = (analyzedCenterCount = 0): CoordinationEnvironmentAnalysis => ({
    environments: [],
    summary: {
      analyzedCenterCount,
      recognizedRegionCount: 0,
      drawableRegionCount: 0,
      centralElements: [],
      byGeometry: {},
      warnings,
    },
  })
  if (atoms.length === 0) return empty()
  if (atoms.length > MAX_ANALYSIS_ATOMS) {
    warnings.push(`Coordination-region detection is limited to ${MAX_ANALYSIS_ATOMS.toLocaleString()} materialized atoms.`)
    return empty()
  }

  const lattice = options.periodicLatticeVectors && calculateVolume(options.periodicLatticeVectors) > EPS
    ? options.periodicLatticeVectors
    : undefined
  const requestedElements = options.centralElements && options.centralElements.size > 0
    ? options.centralElements
    : null
  const metalCenters = atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => isMetal(atom.element))
  const centers = requestedElements
    ? atoms.map((atom, index) => ({ atom, index })).filter(({ atom }) => requestedElements.has(atom.element))
    : metalCenters.length > 0
      ? metalCenters
      : atoms.map((atom, index) => ({ atom, index })).filter(({ atom }) => atom.element !== 'H')

  const { basePositions, imageAtoms, grid } = buildImageGrid(atoms, lattice)
  const restrictToPairRules = options.restrictToConfiguredPairs === true
  const environments: CoordinationPolyhedron[] = []
  for (const { atom: centerAtom, index: centerIndex } of centers) {
    const center = basePositions[centerIndex]
    const candidateByPosition = new Map<string, { atomId: string; position: Point3; distance: number; donor: boolean }>()
    for (const imageIndex of grid.neighborhood(centerIndex, MAX_COORDINATION_DISTANCE)) {
      const image = imageAtoms[imageIndex]
      const targetAtom = atoms[image.atomIndex]
      const distance = Math.hypot(
        image.position[0] - center[0],
        image.position[1] - center[1],
        image.position[2] - center[2],
      )
      if (distance < 0.5) continue
      const pairKey = [centerAtom.element, targetAtom.element].sort().join('-')
      const explicitCutoff = options.pairCutoffs?.[pairKey]
      if (restrictToPairRules && explicitCutoff === undefined) continue
      const cutoff = Math.min(
        MAX_COORDINATION_DISTANCE,
        explicitCutoff ?? getMaxBondDistance(centerAtom.element, targetAtom.element) + 0.25,
      )
      if (distance > cutoff) continue
      const key = image.position.map((value) => Math.round(value * 100_000)).join(':')
      const previous = candidateByPosition.get(key)
      if (!previous || distance < previous.distance) {
        candidateByPosition.set(key, {
          atomId: targetAtom.id,
          position: image.position,
          distance,
          donor: isCommonDonor(targetAtom.element),
        })
      }
    }

    const allCandidates = Array.from(candidateByPosition.values()).sort((a, b) => a.distance - b.distance)
    const donorCandidates = allCandidates.filter((candidate) => candidate.donor)
    const selected = (isMetal(centerAtom.element) && donorCandidates.length >= MIN_NEIGHBOURS
      ? donorCandidates
      : allCandidates).slice(0, MAX_NEIGHBOURS)
    if (selected.length < MIN_NEIGHBOURS) continue

    const vertices = selected.map(({ position: vertex }) => vertex)
    const classification = classifyGeometry(center, vertices)
    const hullFaces = convexHull3D(vertices)
    const faces = hullFaces.length > 0 ? hullFaces : triangulatePlanarPolygon(vertices)
    environments.push({
      centralAtomId: centerAtom.id,
      centralElement: centerAtom.element,
      centralPosition: center,
      coordinationNumber: vertices.length,
      geometry: classification.geometry,
      fitRmsDegrees: classification.fitRmsDegrees,
      vertices,
      vertexAtomIds: selected.map(({ atomId }) => atomId),
      faces,
    })
  }

  const byGeometry: Partial<Record<CoordinationGeometry, number>> = {}
  const centralElements = new Set<string>()
  for (const environment of environments) {
    centralElements.add(environment.centralElement)
    byGeometry[environment.geometry] = (byGeometry[environment.geometry] ?? 0) + 1
  }
  return {
    environments,
    summary: {
      analyzedCenterCount: centers.length,
      recognizedRegionCount: environments.filter((environment) => environment.geometry !== 'irregular').length,
      drawableRegionCount: environments.filter((environment) => environment.faces.length > 0).length,
      centralElements: Array.from(centralElements).sort(),
      byGeometry,
      warnings,
    },
  }
}
