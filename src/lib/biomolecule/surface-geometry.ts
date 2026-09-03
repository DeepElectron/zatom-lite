import * as THREE from 'three'
import { OptimizedMarchingCubes } from '../molecular-orbitals/OptimizedMarchingCubes'
import type { BioStructure } from './types'

export interface BioSurfaceMeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  colors: Float32Array
  spacing: number
}

export interface BioSurfaceGridPlan {
  origin: [number, number, number]
  resolution: number
  spacing: number
  voxelCount: number
}

/** Compact, structured-cloneable worker input. Topology and trajectory data stay on the host. */
export interface BioSurfaceWorkerJob {
  positions: Float32Array
  elements: string[]
  colors: string[]
  spacing: number
  center: [number, number, number]
}

/** The marching-cubes implementation consumes a cubic grid. */
export const BIO_SURFACE_VOXEL_BUDGET = 2_000_000

const MIN_GRID_RESOLUTION = 8
const MIN_SPACING = .45
const MAX_REQUESTED_SPACING = 2.5
const SURFACE_PADDING = 3.2
const NEAREST_ATOM_CELL_SIZE = 4

const VDW_RADII: Readonly<Record<string, number>> = {
  H: 1.2, C: 1.7, N: 1.55, O: 1.52, S: 1.8, P: 1.8, Se: 1.9,
  F: 1.47, Cl: 1.75, Br: 1.85, I: 1.98, Fe: 1.8, Zn: 1.39,
  Mg: 1.73, Mn: 1.8, Ca: 2, Na: 2.27, K: 2.75, Cu: 1.4,
}

/** Shared biomolecular vdW radius used by surfaces and explicit space-fill. */
export const bioVdwRadius = (element: string): number => VDW_RADII[element]
  ?? VDW_RADII[element[0]?.toUpperCase() + element.slice(1).toLowerCase()]
  ?? 1.7

function finitePosition(position: ArrayLike<number>): boolean {
  return position.length === 3
    && Number.isFinite(position[0])
    && Number.isFinite(position[1])
    && Number.isFinite(position[2])
}

export function planBioSurfaceGrid(
  minimum: readonly [number, number, number],
  maximum: readonly [number, number, number],
  requestedSpacing: number,
): BioSurfaceGridPlan | null {
  if (!finitePosition(minimum) || !finitePosition(maximum)) return null
  const spans = minimum.map((value, axis) => maximum[axis] - value + SURFACE_PADDING * 2)
  if (spans.some((span) => !Number.isFinite(span) || span <= 0)) return null

  const requested = Number.isFinite(requestedSpacing)
    ? Math.max(MIN_SPACING, Math.min(MAX_REQUESTED_SPACING, requestedSpacing))
    : MIN_SPACING
  const cubicSpan = Math.max(...spans)
  const maximumResolution = Math.max(
    MIN_GRID_RESOLUTION,
    Math.floor(Math.cbrt(BIO_SURFACE_VOXEL_BUDGET)),
  )
  const requestedResolution = Math.max(MIN_GRID_RESOLUTION, Math.ceil(cubicSpan / requested) + 1)
  const resolution = Math.min(requestedResolution, maximumResolution)
  const spacing = requestedResolution > maximumResolution
    ? cubicSpan / (resolution - 1)
    : requested

  return {
    origin: [
      minimum[0] - SURFACE_PADDING,
      minimum[1] - SURFACE_PADDING,
      minimum[2] - SURFACE_PADDING,
    ],
    resolution,
    spacing,
    voxelCount: resolution ** 3,
  }
}

function cellCoordinate(value: number): number {
  return Math.floor(value / NEAREST_ATOM_CELL_SIZE)
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

interface AtomGrid {
  buckets: ReadonlyMap<string, readonly number[]>
  minimumCell: readonly [number, number, number]
  maximumCell: readonly [number, number, number]
}

function buildAtomGrid(positions: Float32Array, atomCount: number): AtomGrid {
  const buckets = new Map<string, number[]>()
  const minimumCell: [number, number, number] = [Infinity, Infinity, Infinity]
  const maximumCell: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let atomIndex = 0; atomIndex < atomCount; atomIndex += 1) {
    const offset = atomIndex * 3
    const x = positions[offset]
    const y = positions[offset + 1]
    const z = positions[offset + 2]
    const cell: [number, number, number] = [cellCoordinate(x), cellCoordinate(y), cellCoordinate(z)]
    for (let axis = 0; axis < 3; axis += 1) {
      minimumCell[axis] = Math.min(minimumCell[axis], cell[axis])
      maximumCell[axis] = Math.max(maximumCell[axis], cell[axis])
    }
    const key = cellKey(...cell)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(atomIndex)
    else buckets.set(key, [atomIndex])
  }
  return { buckets, minimumCell, maximumCell }
}

function nearestAtomIndex(
  positions: Float32Array,
  grid: AtomGrid,
  position: readonly [number, number, number],
): number {
  const center: [number, number, number] = position.map(cellCoordinate) as [number, number, number]
  const maximumShell = Math.max(
    ...center.map((value, axis) => Math.max(
      Math.abs(value - grid.minimumCell[axis]),
      Math.abs(value - grid.maximumCell[axis]),
    )),
  )
  let nearest = -1
  let nearestSquared = Infinity

  for (let shell = 0; shell <= maximumShell; shell += 1) {
    for (let x = center[0] - shell; x <= center[0] + shell; x += 1) {
      for (let y = center[1] - shell; y <= center[1] + shell; y += 1) {
        for (let z = center[2] - shell; z <= center[2] + shell; z += 1) {
          if (shell > 0
            && Math.abs(x - center[0]) < shell
            && Math.abs(y - center[1]) < shell
            && Math.abs(z - center[2]) < shell) continue
          for (const atomIndex of grid.buckets.get(cellKey(x, y, z)) ?? []) {
            const offset = atomIndex * 3
            const dx = positions[offset] - position[0]
            const dy = positions[offset + 1] - position[1]
            const dz = positions[offset + 2] - position[2]
            const distanceSquared = dx * dx + dy * dy + dz * dz
            if (distanceSquared < nearestSquared) {
              nearestSquared = distanceSquared
              nearest = atomIndex
            }
          }
        }
      }
    }

    if (nearest >= 0) {
      const lower = center.map((value) => (value - shell) * NEAREST_ATOM_CELL_SIZE)
      const upper = center.map((value) => (value + shell + 1) * NEAREST_ATOM_CELL_SIZE)
      const distanceToUnsearchedCells = Math.min(
        ...position.map((value, axis) => Math.min(value - lower[axis], upper[axis] - value)),
      )
      if (nearestSquared <= distanceToUnsearchedCells * distanceToUnsearchedCells) return nearest
    }
  }
  return nearest
}

export function createBioSurfaceWorkerJob(
  structure: BioStructure,
  atomIndices: readonly number[],
  atomColors: readonly string[],
  requestedSpacing: number,
): BioSurfaceWorkerJob | null {
  const selected = [...new Set(atomIndices)].filter((index) => {
    const atom = structure.atoms[index]
    return Boolean(atom && finitePosition(atom.position))
  })
  if (!selected.length) return null
  const positions = new Float32Array(selected.length * 3)
  const elements = new Array<string>(selected.length)
  const colors = new Array<string>(selected.length)
  const center: [number, number, number] = [0, 0, 0]
  selected.forEach((atomIndex, selectedIndex) => {
    const atom = structure.atoms[atomIndex]
    const offset = selectedIndex * 3
    positions[offset] = atom.position[0]
    positions[offset + 1] = atom.position[1]
    positions[offset + 2] = atom.position[2]
    elements[selectedIndex] = atom.element
    colors[selectedIndex] = atomColors[atomIndex] ?? '#b8bdc7'
    center[0] += atom.position[0]
    center[1] += atom.position[1]
    center[2] += atom.position[2]
  })
  center[0] /= selected.length
  center[1] /= selected.length
  center[2] /= selected.length
  return { positions, elements, colors, spacing: requestedSpacing, center }
}

/**
 * QuickSurf-like Gaussian density surface. The grid has a hard voxel budget,
 * so large structures reduce resolution instead of blocking the main thread
 * with an unbounded allocation. A worker can call the same pure function later.
 */
export function buildBioSurfaceGeometry(
  structure: BioStructure,
  atomIndices: readonly number[],
  atomColors: readonly string[],
  requestedSpacing: number,
): BioSurfaceMeshData | null {
  const job = createBioSurfaceWorkerJob(structure, atomIndices, atomColors, requestedSpacing)
  return job ? buildBioSurfaceGeometryFromJob(job) : null
}

export function buildBioSurfaceGeometryFromJob(job: BioSurfaceWorkerJob): BioSurfaceMeshData | null {
  const atomCount = Math.min(job.elements.length, job.colors.length, Math.floor(job.positions.length / 3))
  if (atomCount === 0) return null
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < atomCount; index += 1) {
    const offset = index * 3
    const position = job.positions.subarray(offset, offset + 3)
    if (!finitePosition(position)) return null
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], position[axis])
      max[axis] = Math.max(max[axis], position[axis])
    }
  }
  const plan = planBioSurfaceGrid(min, max, job.spacing)
  if (!plan) return null
  const { origin, resolution, spacing } = plan
  // OptimizedMarchingCubes currently consumes a cubic grid. Padding the shorter
  // bounds preserves world scale while keeping one canonical MC implementation.
  const bounds = {
    min: origin,
    max: [origin[0] + (resolution - 1) * spacing, origin[1] + (resolution - 1) * spacing, origin[2] + (resolution - 1) * spacing] as [number, number, number],
  }
  const grid = new Float32Array(resolution ** 3)
  const offset = (x: number, y: number, z: number) => x + resolution * (y + resolution * z)

  for (let atomIndex = 0; atomIndex < atomCount; atomIndex += 1) {
    const element = job.elements[atomIndex]
    if (element.toUpperCase() === 'H') continue
    const sigma = .44 * bioVdwRadius(element) + .25
    const cutoff = sigma * 3
    const inverse = 1 / (2 * sigma * sigma)
    const positionOffset = atomIndex * 3
    const ax = job.positions[positionOffset]
    const ay = job.positions[positionOffset + 1]
    const az = job.positions[positionOffset + 2]
    const x0 = Math.max(0, Math.floor((ax - cutoff - origin[0]) / spacing))
    const x1 = Math.min(resolution - 1, Math.ceil((ax + cutoff - origin[0]) / spacing))
    const y0 = Math.max(0, Math.floor((ay - cutoff - origin[1]) / spacing))
    const y1 = Math.min(resolution - 1, Math.ceil((ay + cutoff - origin[1]) / spacing))
    const z0 = Math.max(0, Math.floor((az - cutoff - origin[2]) / spacing))
    const z1 = Math.min(resolution - 1, Math.ceil((az + cutoff - origin[2]) / spacing))
    for (let z = z0; z <= z1; z += 1) {
      const dz = origin[2] + z * spacing - az
      for (let y = y0; y <= y1; y += 1) {
        const dy = origin[1] + y * spacing - ay
        for (let x = x0; x <= x1; x += 1) {
          const dx = origin[0] + x * spacing - ax
          const distanceSquared = dx * dx + dy * dy + dz * dz
          if (distanceSquared <= cutoff * cutoff) grid[offset(x, y, z)] += Math.exp(-distanceSquared * inverse)
        }
      }
    }
  }

  const mesh = new OptimizedMarchingCubes().generateFromGrid(grid, bounds, resolution, .6, {
    smoothIterations: 1,
    smoothFactor: .35,
    sharedVertices: true,
  })
  if (!mesh.vertices.length || !mesh.faces.length) return null

  const colors = new Float32Array(mesh.vertices.length)
  const color = new THREE.Color()
  const atomGrid = buildAtomGrid(job.positions, atomCount)
  for (let vertex = 0; vertex < mesh.vertices.length; vertex += 3) {
    const nearest = nearestAtomIndex(job.positions, atomGrid, [
      mesh.vertices[vertex],
      mesh.vertices[vertex + 1],
      mesh.vertices[vertex + 2],
    ])
    color.setStyle(job.colors[nearest] ?? '#b8bdc7', THREE.NoColorSpace)
    colors[vertex] = color.r
    colors[vertex + 1] = color.g
    colors[vertex + 2] = color.b
  }
  return { positions: mesh.vertices, normals: mesh.normals, indices: mesh.faces, colors, spacing }
}
