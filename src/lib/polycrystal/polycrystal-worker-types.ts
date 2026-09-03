import type { BaseCell, PolycrystalOptions } from './types'

export interface PolycrystalWorkerRequest {
  requestId: string
  options: PolycrystalOptions
  base: BaseCell
}

export interface PolycrystalWorkerProgress {
  requestId: string
  kind: 'progress'
  fraction: number
}

export interface PolycrystalWorkerResult {
  requestId: string
  kind: 'result'
  positions: Float32Array
  elementIndex: Uint8Array
  grainId: Uint32Array
  basisIndex: Uint32Array
  elements: string[]
  count: number
  bbox: { min: [number, number, number]; max: [number, number, number] }
  seeds: Float32Array
  rotations: Float64Array
}

export interface PolycrystalWorkerError {
  requestId: string
  kind: 'error'
  error: string
}

export type PolycrystalWorkerResponse =
  | PolycrystalWorkerProgress
  | PolycrystalWorkerResult
  | PolycrystalWorkerError
