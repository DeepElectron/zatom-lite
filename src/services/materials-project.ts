import { exportToCIF } from '../lib/crystal/cif-parser'
import { ELEMENTS, getAllElementSymbols } from '../lib/crystal/elements'
import type { BackendService } from '../host'
import { getGlobalBackendClient } from '../host'
import type { StructureFetchResponse, StructureSearchItem } from '../contracts/structures'

type MaterialsProjectBackend = Pick<BackendService, 'searchStructures' | 'fetchStructure'>

function getMaterialsProjectBackend(): MaterialsProjectBackend {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error('BackendService unavailable for Materials Project')
  }
  return backend
}

const ELEMENT_SYMBOL_LIST = getAllElementSymbols()
const ELEMENT_SYMBOLS = new Set(ELEMENT_SYMBOL_LIST)
const ELEMENT_SYMBOL_BY_ATOMIC_NUMBER = new Map(
  Object.values(ELEMENTS).map((element) => [element.atomicNumber, element.symbol]),
)

type MaterialsProjectSearchKind = "material_ids" | "formula" | "elements"

export interface MaterialsProjectSearchSpec {
  kind: MaterialsProjectSearchKind
  value?: string
  elements?: string[]
  stableOnly?: boolean
  limit?: number
}

export interface MaterialsProjectSearchResult {
  materialId: string
  formulaPretty: string
  crystalSystem: string | null
  spacegroupSymbol: string | null
  bandGap: number | null
  isStable: boolean | null
}

export interface MaterialsProjectStructureSite {
  element: string
  abc: [number, number, number]
  label?: string | null
}

export interface MaterialsProjectStructure {
  lattice: {
    a: number
    b: number
    c: number
    alpha: number
    beta: number
    gamma: number
  }
  sites: MaterialsProjectStructureSite[]
}

export interface MaterialsProjectMaterial {
  materialId: string
  structure: MaterialsProjectStructure
}

function materialIdFromStructureId(id: string): string {
  const trimmed = id.trim()
  return trimmed.startsWith('mp:') ? trimmed.slice(3) : trimmed
}

function formulaFromSearchLabel(label: string, fallback: string): string {
  const formula = label.replace(/\s*\([^)]*\)\s*$/, '').trim()
  return formula || fallback
}

function parseNumberDetail(details: string | undefined, key: string): number | null {
  if (!details) return null
  const match = details.match(new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`))
  return match ? Number(match[1]) : null
}

function parseStableDetail(details: string | undefined): boolean | null {
  if (!details) return null
  const parts = details.split('|').map((part) => part.trim().toLowerCase())
  if (parts.includes('stable')) return true
  if (parts.includes('metastable')) return false
  return null
}

function parseSpacegroupDetail(details: string | undefined): string | null {
  if (!details) return null
  const part = details.split('|').map((value) => value.trim()).find((value) => value.startsWith('SG='))
  return part ? part.slice(3).trim() || null : null
}

function normalizeBackendSearchItem(item: StructureSearchItem): MaterialsProjectSearchResult {
  const materialId = materialIdFromStructureId(item.id)
  return {
    materialId,
    formulaPretty: formulaFromSearchLabel(item.label, materialId),
    crystalSystem: null,
    spacegroupSymbol: parseSpacegroupDetail(item.details),
    bandGap: parseNumberDetail(item.details, 'band_gap'),
    isStable: parseStableDetail(item.details),
  }
}

function searchSpecToBackendQuery(search: MaterialsProjectSearchSpec): string {
  if (search.kind === 'elements' && search.elements?.length) {
    return `elements:${search.elements.join('-')}`
  }
  if (search.value) {
    return search.value
  }
  throw new Error('Invalid Materials Project search query')
}

function isFinite3x3(matrix: unknown): matrix is number[][] {
  return Array.isArray(matrix)
    && matrix.length === 3
    && matrix.every((row) =>
      Array.isArray(row)
      && row.length === 3
      && row.every((value) => typeof value === 'number' && Number.isFinite(value)),
    )
}

function latticeMatrixToParams(matrix: number[][]): MaterialsProjectStructure['lattice'] {
  const len = (v: number[]) => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const angle = (u: number[], v: number[]) => {
    const denom = len(u) * len(v)
    if (denom === 0) return 90
    return Math.acos(Math.max(-1, Math.min(1, dot(u, v) / denom))) * 180 / Math.PI
  }
  const [a, b, c] = matrix
  return {
    a: len(a),
    b: len(b),
    c: len(c),
    alpha: angle(b, c),
    beta: angle(a, c),
    gamma: angle(a, b),
  }
}

function cartesianToFractional(cartesian: [number, number, number], matrix: number[][]): [number, number, number] {
  const m = matrix
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  if (Math.abs(det) < 1e-12) {
    throw new Error('Materials Project structure has a singular lattice matrix')
  }
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
  ]
  const [cx, cy, cz] = cartesian
  return [
    inv[0][0] * cx + inv[1][0] * cy + inv[2][0] * cz,
    inv[0][1] * cx + inv[1][1] * cy + inv[2][1] * cz,
    inv[0][2] * cx + inv[1][2] * cy + inv[2][2] * cz,
  ]
}

function atomicNumberToSymbol(element: number): string {
  return ELEMENT_SYMBOL_BY_ATOMIC_NUMBER.get(element) || 'X'
}

function normalizeBackendMaterial(data: StructureFetchResponse): MaterialsProjectMaterial {
  const matrix = data.lattice?.matrix
  if (!isFinite3x3(matrix)) {
    throw new Error(`Materials Project structure "${data.id}" is missing a valid lattice matrix`)
  }
  return {
    materialId: materialIdFromStructureId(data.id),
    structure: {
      lattice: latticeMatrixToParams(matrix),
      sites: data.atoms.map((atom, index) => {
        const element = atomicNumberToSymbol(Number(atom.element))
        return {
          element,
          abc: cartesianToFractional([Number(atom.x), Number(atom.y), Number(atom.z)], matrix),
          label: `${element}${index + 1}`,
        }
      }),
    },
  }
}

function normalizeElementToken(token: string): string {
  const trimmed = token.trim()
  if (!trimmed) {
    return ""
  }

  return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase()
}

export function parseMaterialsProjectSearch(query: string, options?: { limit?: number; stableOnly?: boolean }): MaterialsProjectSearchSpec {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    throw new Error("Enter an mp-id, formula, or element list")
  }

  const limit = options?.limit ?? 8
  const stableOnly = options?.stableOnly ?? false
  const commaOrSpaceTokens = trimmedQuery
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (commaOrSpaceTokens.length > 0 && commaOrSpaceTokens.every((token) => /^mp-\d+$/i.test(token))) {
    return {
      kind: "material_ids",
      value: commaOrSpaceTokens.map((token) => token.toLowerCase()).join(","),
      limit,
      stableOnly,
    }
  }

  const elementTokens = trimmedQuery
    .split(/[\s,-]+/)
    .map(normalizeElementToken)
    .filter(Boolean)

  if (elementTokens.length > 1 && elementTokens.every((token) => ELEMENT_SYMBOLS.has(token))) {
    return {
      kind: "elements",
      elements: Array.from(new Set(elementTokens)),
      limit,
      stableOnly,
    }
  }

  return {
    kind: "formula",
    value: trimmedQuery.replace(/\s+/g, ""),
    limit,
    stableOnly,
  }
}

export async function searchMaterialsProject(query: string, options?: { limit?: number; stableOnly?: boolean }) {
  const search = parseMaterialsProjectSearch(query, options)

  const { items } = await getMaterialsProjectBackend().searchStructures(searchSpecToBackendQuery(search), 'materials_project')
  const results = items.map(normalizeBackendSearchItem)
  const filtered = search.stableOnly ? results.filter((item) => item.isStable !== false) : results
  return filtered.slice(0, search.limit ?? options?.limit ?? 8)
}

export async function loadMaterialsProjectMaterial(materialId: string): Promise<MaterialsProjectMaterial> {
  const cleanMaterialId = materialId.trim()

  if (!cleanMaterialId) {
    throw new Error("Missing Materials Project material id")
  }

  const response = await getMaterialsProjectBackend().fetchStructure({
    id: cleanMaterialId,
    source: 'materials_project',
  })
  return normalizeBackendMaterial(response)
}

export function materialsProjectMaterialToCIF(
  material: MaterialsProjectMaterial,
  options?: {
    name?: string
    spaceGroup?: string | null
  },
) {
  return exportToCIF({
    name: options?.name || material.materialId,
    latticeParams: material.structure.lattice,
    atoms: material.structure.sites.map((site) => ({
      element: site.element,
      position: site.abc,
    })),
    spaceGroup: options?.spaceGroup || "P 1",
  })
}
