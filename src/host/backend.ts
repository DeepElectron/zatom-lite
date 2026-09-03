/**
 * Backend contract used by the standalone Zatom application.
 *
 * Consumer-driven: every member here exists because some module under src/ calls
 * it. A runtime integration can inject a structurally compatible client through
 * `setModelerBackendClient` during startup.
 *
 * Call sites narrow further with `Pick<BackendService, 'fetchStructure'>`, so a
 * module only ever sees the methods it actually uses.
 */

// ─── Structure search / fetch ────────────────────────────────────────────────

import type {
  StructureAtom,
  StructureFetchResponse,
  StructureSearchSource,
  StructureSearchItem,
  StructureSymmetryResponse,
} from '../contracts/structures'
export type { StructureSearchSource } from '../contracts/structures'

// ─── Exposed-site classification (adsorbate placement) ───────────────────────

export interface ExposedSiteAtomPayload {
  element: number
  x: number
  y: number
  z: number
}

export interface ExposedSiteCandidatePayload {
  site_id: string
  /** Site kind as detected client-side ('top' / 'bridge' / 'hollow' …). */
  site_type: string
  position: [number, number, number]
  atomIndices: number[]
}

export interface ExposedSiteClassification {
  site_id: string
  status?: string
  /** Indices of the organic atoms blocking this site — empty/absent when exposed. */
  blocked_by?: number[] | null
  nearest_organic_distance_A?: number | null
}

export interface ExposedSitesRequest {
  atoms: ExposedSiteAtomPayload[]
  candidate_sites: ExposedSiteCandidatePayload[]
  metal_element?: string
  probe_radius_A?: number
  blocking_buffer_A?: number
  z_tolerance_A?: number
}

export interface ExposedSitesResponse {
  sites: ExposedSiteClassification[]
  summary?: Record<string, number>
}

export interface ComputeBuilderInvokePayload {
  params?: Record<string, unknown>
  seeds?: Record<string, unknown>
}

export interface MoleculeFromSmilesRequest {
  smiles: string
  seed?: number | null
}

export interface MoleculeFromSmilesAtom {
  element: number
  x: number
  y: number
  z: number
}

export interface MoleculeFromSmilesResponse {
  atoms: MoleculeFromSmilesAtom[]
  formula: string
  canonical_smiles: string
  label: string
}

export interface StructureOptimizeAtomPayload {
  element: number
  x: number
  y: number
  z: number
}

export interface StructureOptimizeRequest {
  atoms: StructureOptimizeAtomPayload[]
  latticeMatrix?: number[][] | null
  pbc?: boolean[] | null
  forceField?: string
  optimizer?: string
  steps?: number
  fmax?: number
  optimizationTarget?: string
  includeTrajectory?: boolean
}

export interface StructureOptimizeResponse {
  atoms: StructureOptimizeAtomPayload[]
  lattice: { matrix: number[][] } | null
  converged: boolean
  stepsCompleted: number
  energy: number | null
  forceFieldUsed?: string
  trajectory?: Array<Record<string, unknown>>
}

// ─── Marketplace (installed templates / tools surfaced in kit panels) ────────

export interface MarketplaceInstallationView {
  category: string
  itemId: string
  enabled: boolean
  config?: Record<string, unknown>
  installedAtIso?: string | null
  updatedAtIso?: string | null
}

export interface MarketplaceInstallRequest {
  category: string
  itemId: string
  enabled?: boolean
  config?: Record<string, unknown>
}

// ─── The contract ────────────────────────────────────────────────────────────

export interface BackendService {
  searchStructures(query: string, source?: StructureSearchSource): Promise<{ items: StructureSearchItem[] }>
  fetchStructure(payload: { id: string; source: string }): Promise<StructureFetchResponse>
  moleculeFromSmiles(payload: MoleculeFromSmilesRequest): Promise<MoleculeFromSmilesResponse>
  classifyExposedSites(payload: ExposedSitesRequest): Promise<ExposedSitesResponse>
  invokeComputeBuilder<T = Record<string, unknown>>(
    builderId: string,
    payload: ComputeBuilderInvokePayload,
  ): Promise<T>
  optimizeStructure(payload: StructureOptimizeRequest): Promise<StructureOptimizeResponse>
  analyzeSymmetry(payload: {
    atoms: StructureAtom[]
    latticeMatrix: number[][]
    symprec?: number
    angleTolerance?: number
  }): Promise<StructureSymmetryResponse>
  listMarketplaceInstallations(category?: string): Promise<MarketplaceInstallationView[]>
  installMarketplaceItem(payload: MarketplaceInstallRequest): Promise<MarketplaceInstallationView>
  uninstallMarketplaceItem(category: string, itemId: string): Promise<void>
}

// ─── Injection point ─────────────────────────────────────────────────────────

let backendClient: BackendService | null = null

/** Wired once by the host at bootstrap (apps/web) or by a standalone shell. */
export function setModelerBackendClient(client: BackendService | null): void {
  backendClient = client
}

/**
 * Mirrors the host's `getGlobalBackendClient` semantics: returns null when no
 * host has wired a client, so callers keep their existing null guards.
 */
export function getGlobalBackendClient(): BackendService | null {
  return backendClient
}
