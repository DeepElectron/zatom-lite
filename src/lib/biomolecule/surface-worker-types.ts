import type { BioSurfaceMeshData, BioSurfaceWorkerJob } from './surface-geometry'

export interface BioSurfaceWorkerRequest {
  requestId: string
  job: BioSurfaceWorkerJob
}

export interface BioSurfaceWorkerResponse {
  requestId: string
  result: BioSurfaceMeshData | null
  error?: string
}

export function bioSurfaceTransferables(result: BioSurfaceMeshData | null): Transferable[] {
  if (!result) return []
  return [
    result.positions.buffer,
    result.normals.buffer,
    result.indices.buffer,
    result.colors.buffer,
  ] as Transferable[]
}
