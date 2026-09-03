import type {
  ProceduralVolumeJob,
  ProceduralVolumeResult,
} from './procedural-volume'

export interface ProceduralVolumeWorkerRequest {
  requestId: string
  job: ProceduralVolumeJob
}

export interface ProceduralVolumeWorkerResponse {
  requestId: string
  result: ProceduralVolumeResult | null
  error?: string
}
