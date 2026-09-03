import {
  OptimizedMarchingCubes,
  type Bounds,
  type MarchingCubesResult,
} from '../molecular-orbitals/OptimizedMarchingCubes'
import { getDefaultCrystalElementVisual, type VolumeFieldType } from './crystal-visuals'

export const MAX_PROCEDURAL_VOLUME_ATOMS = 1_500

export interface ProceduralVolumeAtom {
  element: string
  position: [number, number, number]
}

export interface ProceduralVolumeBond {
  a: number
  b: number
}

export interface ProceduralVolumeStructure {
  atoms: ProceduralVolumeAtom[]
  bonds: ProceduralVolumeBond[]
  latticeVectors: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ]
  supercell: [number, number, number]
}

export interface ProceduralVolumeData {
  dims: [number, number, number]
  /** Normalized values. Diverging fields use 0.5 as the zero point. */
  data: Float32Array
  origin: [number, number, number]
  size: [number, number, number]
  diverging: boolean
}

export interface ProceduralVolumeJob {
  structure: ProceduralVolumeStructure
  field: Exclude<VolumeFieldType, 'none'>
  resolution: number
  isoLevel: number
  generateSurface: boolean
}

export interface ProceduralVolumeResult {
  volume: ProceduralVolumeData
  positive: MarchingCubesResult | null
  negative: MarchingCubesResult | null
}

function computeBoundingBox(structure: ProceduralVolumeStructure) {
  const [va, vb, vc] = structure.latticeVectors
  const [na, nb, nc] = structure.supercell
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i <= 1; i++) {
    for (let j = 0; j <= 1; j++) {
      for (let k = 0; k <= 1; k++) {
        for (let d = 0; d < 3; d++) {
          const value = i * na * va[d] + j * nb * vb[d] + k * nc * vc[d]
          min[d] = Math.min(min[d], value)
          max[d] = Math.max(max[d], value)
        }
      }
    }
  }
  return {
    origin: min as [number, number, number],
    size: [
      Math.max(max[0] - min[0], 1e-6),
      Math.max(max[1] - min[1], 1e-6),
      Math.max(max[2] - min[2], 1e-6),
    ] as [number, number, number],
  }
}

export function computeProceduralVolumeField(
  structure: ProceduralVolumeStructure,
  field: Exclude<VolumeFieldType, 'none'>,
  resolution: number,
): ProceduralVolumeData {
  if (structure.atoms.length === 0) throw new Error('A structure is required for an illustrative scalar field.')
  if (structure.atoms.length > MAX_PROCEDURAL_VOLUME_ATOMS) {
    throw new Error(`Illustrative scalar fields are limited to ${MAX_PROCEDURAL_VOLUME_ATOMS.toLocaleString()} atoms.`)
  }

  const n = Math.max(16, Math.min(96, Math.round(Number.isFinite(resolution) ? resolution : 48)))
  const { origin, size } = computeBoundingBox(structure)
  const data = new Float32Array(n * n * n)
  const atoms = structure.atoms.map((atom) => {
    const element = getDefaultCrystalElementVisual(atom.element)
    return {
      position: atom.position,
      effectiveCharge: Math.max(1, element.radius * 8),
      radius: Math.max(element.radius, 0.2),
    }
  })
  const bondMidpoints = structure.bonds
    .filter((bond) => structure.atoms[bond.a] && structure.atoms[bond.b])
    .map((bond) => {
      const a = structure.atoms[bond.a].position
      const b = structure.atoms[bond.b].position
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [number, number, number]
    })

  let min = Infinity
  let max = -Infinity
  let index = 0
  for (let zIndex = 0; zIndex < n; zIndex++) {
    const z = origin[2] + zIndex / (n - 1) * size[2]
    for (let yIndex = 0; yIndex < n; yIndex++) {
      const y = origin[1] + yIndex / (n - 1) * size[1]
      for (let xIndex = 0; xIndex < n; xIndex++, index++) {
        const x = origin[0] + xIndex / (n - 1) * size[0]
        let value = 0

        if (field === 'density') {
          for (const atom of atoms) {
            const dx = x - atom.position[0]
            const dy = y - atom.position[1]
            const dz = z - atom.position[2]
            const distanceSquared = dx * dx + dy * dy + dz * dz
            if (distanceSquared > 25) continue
            value += atom.effectiveCharge * Math.exp(-2.2 * Math.sqrt(distanceSquared) / atom.radius)
          }
        } else if (field === 'bonding') {
          for (const midpoint of bondMidpoints) {
            const dx = x - midpoint[0]
            const dy = y - midpoint[1]
            const dz = z - midpoint[2]
            const distanceSquared = dx * dx + dy * dy + dz * dz
            if (distanceSquared <= 6) value += Math.exp(-distanceSquared / 0.25)
          }
          for (const atom of atoms) {
            const dx = x - atom.position[0]
            const dy = y - atom.position[1]
            const dz = z - atom.position[2]
            const distanceSquared = dx * dx + dy * dy + dz * dz
            if (distanceSquared > 8) continue
            const shell = Math.sqrt(distanceSquared) - atom.radius * 0.75
            value -= 0.62 * Math.exp(-(shell * shell) / (0.32 * 0.32))
          }
        } else {
          let localization = 0
          for (const midpoint of bondMidpoints) {
            const dx = x - midpoint[0]
            const dy = y - midpoint[1]
            const dz = z - midpoint[2]
            const distanceSquared = dx * dx + dy * dy + dz * dz
            if (distanceSquared <= 6) localization = Math.max(localization, 0.92 * Math.exp(-distanceSquared / (0.55 * 0.55)))
          }
          for (const atom of atoms) {
            const dx = x - atom.position[0]
            const dy = y - atom.position[1]
            const dz = z - atom.position[2]
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (distance > 4) continue
            const shell = distance - atom.radius * 0.62
            localization = Math.max(localization, 0.78 * Math.exp(-(shell * shell) / (0.26 * 0.26)))
            if (distance < atom.radius * 0.3) localization = Math.min(localization, 0.05)
          }
          value = localization
        }

        data[index] = value
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
    }
  }

  const diverging = field === 'bonding'
  if (diverging) {
    const maxAbs = Math.max(Math.abs(min), Math.abs(max), 1e-9)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * data[i] / maxAbs))
    }
  } else {
    const range = Math.max(max - min, 1e-9)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.max(0, Math.min(1, (data[i] - min) / range))
    }
  }

  return { dims: [n, n, n], data, origin, size, diverging }
}

function normalizedSurface(result: MarchingCubesResult): MarchingCubesResult | null {
  return result.vertices.length > 0 && result.faces.length > 0 ? result : null
}

export function generateProceduralVolume(job: ProceduralVolumeJob): ProceduralVolumeResult {
  const volume = computeProceduralVolumeField(job.structure, job.field, job.resolution)
  if (!job.generateSurface) return { volume, positive: null, negative: null }

  const bounds: Bounds = {
    min: volume.origin,
    max: [
      volume.origin[0] + volume.size[0],
      volume.origin[1] + volume.size[1],
      volume.origin[2] + volume.size[2],
    ],
  }
  const marchingCubes = new OptimizedMarchingCubes()
  const level = Math.min(0.98, Math.max(0.02, job.isoLevel))
  const positiveLevel = volume.diverging ? 0.5 + level * 0.48 : level
  const positive = normalizedSurface(marchingCubes.generateFromGrid(
    volume.data,
    bounds,
    volume.dims[0],
    positiveLevel,
    { smoothIterations: 0, sharedVertices: true },
  ))

  if (!volume.diverging) return { volume, positive, negative: null }
  const inverted = new Float32Array(volume.data.length)
  for (let i = 0; i < volume.data.length; i++) inverted[i] = 1 - volume.data[i]
  const negative = normalizedSurface(marchingCubes.generateFromGrid(
    inverted,
    bounds,
    volume.dims[0],
    positiveLevel,
    { smoothIterations: 0, sharedVertices: true },
  ))
  return { volume, positive, negative }
}
