import { CubParser } from './CubParser'
import { GaussianBasisFunction } from './GaussianBasisFunction'
import type { Bounds, MarchingCubesResult } from './OptimizedMarchingCubes'
import { OptimizedMarchingCubes } from './OptimizedMarchingCubes'
import type {
  OrbitalSurfaceJob,
  OrbitalSurfaceResult,
  SerializedGaussianBasisFunction,
} from './orbital-surface-worker-types'

const BOHR_TO_ANGSTROM = 0.529177210903

function normalizeResult(result: MarchingCubesResult): MarchingCubesResult | null {
  if (result.vertices.length === 0 || result.faces.length === 0) {
    return null
  }

  return result
}

function getPaddedBounds(points: Array<[number, number, number]>): Bounds | null {
  if (points.length === 0) {
    return null
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, y, z] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  const maxSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1)
  const padding = Math.max(maxSize * 0.8, 5)

  return {
    min: [minX - padding, minY - padding, minZ - padding],
    max: [maxX + padding, maxY + padding, maxZ + padding],
  }
}

function deserializeGtos(gtos: SerializedGaussianBasisFunction[]) {
  return gtos.map(
    (gto) =>
      new GaussianBasisFunction(
        gto.center,
        gto.exponents,
        gto.coefficients,
        { l: gto.l, m: gto.m, n: gto.n },
      ),
  )
}

export function generateOrbitalSurface(job: OrbitalSurfaceJob): OrbitalSurfaceResult {
  const marchingCubes = new OptimizedMarchingCubes()

  if (job.sourceType === 'cub') {
    const parser = new CubParser()
    const bounds: Bounds = {
      min: [
        job.cubData.bounds.min.x,
        job.cubData.bounds.min.y,
        job.cubData.bounds.min.z,
      ],
      max: [
        job.cubData.bounds.max.x,
        job.cubData.bounds.max.y,
        job.cubData.bounds.max.z,
      ],
    }
    const volumeFunction = parser.createVolumeFunction(job.cubData)

    return {
      positive: normalizeResult(
        marchingCubes.generateFromGrid(volumeFunction, bounds, job.resolution, job.isoValue),
      ),
      negative: normalizeResult(
        marchingCubes.generateFromGrid(volumeFunction, bounds, job.resolution, -job.isoValue),
      ),
    }
  }

  const reconstructedGtos = deserializeGtos(job.gtos)
  const activeBasisTerms = job.orbitalCoefficients
    .filter((term) => Math.abs(term.value) > 1e-8 && reconstructedGtos[term.index])
    .map((term) => ({
      coefficient: term.value,
      gto: reconstructedGtos[term.index],
    }))

  if (activeBasisTerms.length === 0) {
    return { positive: null, negative: null }
  }

  const bounds = getPaddedBounds(
    job.atomPositions.length > 0 ? job.atomPositions : job.fallbackPositions,
  )
  if (!bounds) {
    return { positive: null, negative: null }
  }

  const waveFunction = (x: number, y: number, z: number) => {
    const xAU = x / BOHR_TO_ANGSTROM
    const yAU = y / BOHR_TO_ANGSTROM
    const zAU = z / BOHR_TO_ANGSTROM
    let value = 0

    for (const term of activeBasisTerms) {
      const contribution = term.coefficient * term.gto.evaluate(xAU, yAU, zAU)
      if (Number.isFinite(contribution)) {
        value += contribution
      }
    }

    return value
  }

  return {
    positive: normalizeResult(
      marchingCubes.generateFromGrid(waveFunction, bounds, job.resolution, job.isoValue),
    ),
    negative: normalizeResult(
      marchingCubes.generateFromGrid(waveFunction, bounds, job.resolution, -job.isoValue),
    ),
  }
}
