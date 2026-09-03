import { ELEMENTS } from '../lib/crystal/elements'
import { parseMolfile } from '../lib/molecule/molfile'
import type { BackendService } from '../host'
import { getGlobalBackendClient } from '../host'
import type { StructureAtom, StructureFetchResponse, StructureSearchItem } from '../contracts/structures'

type PubChemBackend = Pick<BackendService, 'searchStructures' | 'fetchStructure'>

function getPubChemBackend(): PubChemBackend {
  const backend = getGlobalBackendClient()
  if (!backend) {
    throw new Error('BackendService unavailable for PubChem')
  }
  return backend
}

const ELEMENT_SYMBOL_BY_ATOMIC_NUMBER = new Map(
  Object.values(ELEMENTS).map((element) => [element.atomicNumber, element.symbol]),
)

export interface PubChemSearchResult {
  cid: number
  title: string
  formula: string | null
  smiles: string | null
}

export interface PubChemCompound {
  cid: number
  title: string
  formula: string | null
  smiles: string | null
  molfile: string
}

function cidFromStructureId(id: string): number | null {
  const value = id.startsWith('pubchem:') ? id.slice('pubchem:'.length) : id
  const cid = Number.parseInt(value.trim(), 10)
  return Number.isFinite(cid) ? cid : null
}

function parseDetails(details: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!details) return result
  for (const part of details.split('|')) {
    const trimmed = part.trim()
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (key && value) result[key] = value
  }
  return result
}

function parseLabel(label: string): { title: string | null; formula: string | null } {
  const parts = label.split(' · ').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { formula: parts[0], title: parts.slice(1).join(' · ') }
  }
  const single = parts[0] || label.trim()
  if (!single || /^CID\s+\d+$/i.test(single)) {
    return { title: single || null, formula: null }
  }
  return { title: single, formula: null }
}

function normalizePubChemSearchItem(item: StructureSearchItem): PubChemSearchResult | null {
  const cid = cidFromStructureId(item.id)
  if (cid === null) return null
  const details = parseDetails(item.details)
  const label = parseLabel(item.label)
  return {
    cid,
    title: details.name || label.title || `CID ${cid}`,
    formula: details.formula || label.formula,
    smiles: details.smiles || null,
  }
}

function atomicNumberToSymbol(element: number): string {
  return ELEMENT_SYMBOL_BY_ATOMIC_NUMBER.get(element) || 'C'
}

function formatMolNumber(value: number): string {
  const normalized = Number.isFinite(value) ? value : 0
  return normalized.toFixed(4).padStart(10, ' ')
}

function formatMolCount(value: number): string {
  return String(Math.max(0, Math.min(999, Math.trunc(value)))).padStart(3, ' ')
}

function atomToMolfileLine(atom: StructureAtom): string {
  const symbol = atomicNumberToSymbol(Number(atom.element))
  return `${formatMolNumber(Number(atom.x))}${formatMolNumber(Number(atom.y))}${formatMolNumber(Number(atom.z))} ${symbol.padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`
}

function structureToMolfile(structure: StructureFetchResponse, title: string): string {
  const atoms = structure.atoms.slice(0, 999)
  const lines = [
    title || structure.label || structure.id,
    '  Zatom',
    '',
    `${formatMolCount(atoms.length)}${formatMolCount(0)}  0  0  0  0            999 V2000`,
    ...atoms.map(atomToMolfileLine),
    'M  END',
  ]
  return `${lines.join('\n')}\n`
}

export async function searchPubChemCompounds(query: string, limit = 6): Promise<PubChemSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const { items } = await getPubChemBackend().searchStructures(trimmedQuery, 'pubchem')
  return items
    .map(normalizePubChemSearchItem)
    .filter((value): value is PubChemSearchResult => value !== null)
    .slice(0, limit)
}

export async function loadPubChemCompound(cid: number): Promise<PubChemCompound> {
  const backend = getPubChemBackend()
  const [structure, metadataResult] = await Promise.all([
    backend.fetchStructure({ id: String(cid), source: 'pubchem' }),
    backend.searchStructures(String(cid), 'pubchem').catch(() => ({ items: [] as StructureSearchItem[] })),
  ])
  const metadata = metadataResult.items
    .map(normalizePubChemSearchItem)
    .find((item): item is PubChemSearchResult => item !== null && item.cid === cid)
  const title = metadata?.title || structure.label || `CID ${cid}`
  const molfile = structureToMolfile(structure, title)

  parseMolfile(molfile)

  return {
    cid,
    title,
    formula: metadata?.formula || null,
    smiles: metadata?.smiles || null,
    molfile,
  }
}
