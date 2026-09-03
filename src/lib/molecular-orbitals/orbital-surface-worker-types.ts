import type { CubData } from './CubParser'
import type { OrbitalCoefficient } from './MoldenParser'
import type { MarchingCubesResult } from './OptimizedMarchingCubes'

export interface SerializedGaussianBasisFunction {
  center: [number, number, number]
  exponents: number[]
  coefficients: number[]
  l: number
  m: number
  n: number
}

export type OrbitalSurfaceJob =
  | {
      sourceType: 'cub'
      cubData: CubData
      resolution: number
      isoValue: number
    }
  | {
      sourceType: 'molden'
      atomPositions: Array<[number, number, number]>
      fallbackPositions: Array<[number, number, number]>
      orbitalCoefficients: OrbitalCoefficient[]
      gtos: SerializedGaussianBasisFunction[]
      resolution: number
      isoValue: number
    }

export interface OrbitalSurfaceResult {
  positive: MarchingCubesResult | null
  negative: MarchingCubesResult | null
}

export interface OrbitalSurfaceWorkerRequest {
  requestId: string
  job: OrbitalSurfaceJob
}

export interface OrbitalSurfaceWorkerResponse {
  requestId: string
  result: OrbitalSurfaceResult | null
  error?: string
}
