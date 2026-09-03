/**
 * Residue index — aggregates atoms into biomolecular entities.
 *
 * Reads the `zatom.bio.*` properties the PDB/mmCIF readers attach (key names
 * imported from `agent/biomolecular-identity`, never hardcoded here) and groups
 * atoms into residues, then classifies each residue into an *entity class*.
 *
 * The entity class is what a grid cell reports at biomolecular scale: for a
 * 4779-atom protein, "chain A" / "ligand" / "water" / "metal" carries structure,
 * whereas "carbon" does not — protein atom composition is nearly uniform, so a
 * per-atom element symbol is close to a constant-distribution random draw.
 *
 * Three things here are deliberately more careful than a naive grouping:
 *
 *   - Secondary structure prefers the file's own HELIX/SHEET assignment and only
 *     falls back to C-alpha geometry, reporting which one it used. A geometric
 *     estimate presented as an assignment is a quiet lie.
 *   - Alternate conformations are resolved to one primary conformer per atom
 *     name. Counting both halves of a double conformation would inflate atom
 *     counts and composition, and every contact through that residue twice.
 *   - Nucleic residues are traced through P (or C4'), not C-alpha, which they do
 *     not have. Without this a DNA chain reports no fold at all.
 *
 * Pure module: plain data in, plain data out.
 */

import type { ZatomStructure, ZatomStructureAtom } from '../../agent/contracts'
import {
  ZATOM_BIOMOLECULAR_ANNOTATION_PROPERTIES as ANNOT,
  ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO,
} from '../../agent/biomolecular-identity'
import {
  estimateSecondaryStructureFromCaTrace,
  type CaTraceAssignment,
  type CaTracePoint,
} from '../biomolecule/secondary-structure'

/** What a residue *is*, at the granularity that matters for modeling decisions. */
export type EntityClass = 'polymer' | 'ligand' | 'water' | 'metal' | 'ion' | 'unknown'

/** Which biopolymer a polymer residue belongs to. Decides the backbone trace. */
export type PolymerKind = 'protein' | 'nucleic' | 'none'

/** Where a residue's secondary structure came from. Never left implicit. */
export type SecondaryStructureSource = 'record' | 'estimated' | 'none'

export interface ResidueEntity {
  /** Stable key: chain + residue id + insertion code. */
  key: string
  chainId: string
  residueName: string
  residueId: string
  entityClass: EntityClass
  /** Which biopolymer this is, for polymer residues; 'none' otherwise. */
  polymerKind: PolymerKind
  /**
  * Every atom of this residue, including alternate conformations. This is the
  * focus set: asking for a residue must select all of it.
  */
  atomIds: string[]
  /**
  * One conformer per atom name — the set that composition, counts and geometry
  * are computed over, so a double conformation is not counted twice.
  */
  primaryAtomIds: string[]
  /** Primary-conformer atom count. */
  atomCount: number
  /** Atoms belonging to a non-primary alternate conformation. */
  alternateAtomCount: number
  /** Distinct altLoc codes present, e.g. ["A", "B"]; empty when single-conformer. */
  altLocs: string[]
  /** Elements present, most frequent first — e.g. "C34 N4 O4 Fe". */
  composition: string
  /** Numeric part of the residue id, used to order the backbone trace. */
  residueSeq: number
  /**
  * Backbone representative: C-alpha for protein, P (falling back to C4') for
  * nucleic. Null for non-polymer residues and for residues missing it.
  */
  tracePosition: CaTracePoint | null
  /**
  * Coarse geometry estimate or the file's own assignment, null when neither is
  * available. Read `ResidueIndex.secondaryStructureSource` to know which.
  */
  secondaryStructure: CaTraceAssignment | null
  /** Mean B-factor over primary atoms, or null when the file carries none. */
  meanBFactor: number | null
  /** Lowest occupancy over primary atoms, or null when the file carries none. */
  minOccupancy: number | null
}

/** A break in a chain's residue numbering — an unmodelled loop. */
export interface NumberingGap {
  chainId: string
  /** Last residue id before the break. */
  afterResidueId: string
  /** First residue id after the break. */
  beforeResidueId: string
  /** How many residue numbers are unaccounted for. */
  missingCount: number
}

export interface ResidueIndex {
  /** atom id -> residue key. */
  residueByAtomId: Map<string, string>
  /** residue key -> entity. */
  residues: Map<string, ResidueEntity>
  /** Distinct chain ids, sorted. */
  chainIds: string[]
  residueCount: number
  /** chain id -> residue keys in backbone order. Drives the outline. */
  chainResidueOrder: Map<string, string[]>
  /** True when at least one residue carries a secondary-structure assignment. */
  hasSecondaryStructure: boolean
  /** Whether that assignment is the file's or a geometric estimate. */
  secondaryStructureSource: SecondaryStructureSource
  /** Numbering breaks per chain — where residues are missing from the model. */
  numberingGaps: NumberingGap[]
  /** Residues carrying more than one conformation. */
  alternateConformerResidues: number
  /** Distinct MODEL numbers seen, when the file is multi-model. */
  modelNumbers: number[]
  /** chain id -> mmCIF entity id, when the file carries one. */
  entityByChain: Map<string, string>
}

/* ------------------------------------------------------------------ */
/* Residue classification                                              */
/* ------------------------------------------------------------------ */

const AMINO_ACIDS = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY', 'HIS', 'ILE',
  'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER', 'THR', 'TRP', 'TYR', 'VAL',
  'SEC', 'PYL', 'MSE', 'HSD', 'HSE', 'HSP', 'HID', 'HIE', 'HIP',
])

export const NUCLEOTIDES = new Set([
  'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU',
  'RA', 'RC', 'RG', 'RU', '5MC', '7MG', 'PSU',
])

const WATERS = new Set(['HOH', 'WAT', 'H2O', 'DOD', 'TIP', 'SOL'])

/** Monoatomic metal ions common in structural biology. */
const METALS = new Set([
  'FE', 'FE2', 'FE3', 'ZN', 'MG', 'MN', 'CA', 'CU', 'CU1', 'NI', 'CO',
  'CD', 'HG', 'MO', 'W', 'V', 'NA', 'K',
])

/** Monoatomic non-metal ions. */
const IONS = new Set(['CL', 'BR', 'IOD', 'F', 'SO4', 'PO4', 'NO3', 'ACT', 'EDO'])

const classifyResidue = (residueName: string, atomCount: number): EntityClass => {
  const name = residueName.toUpperCase().trim()
  if (WATERS.has(name)) return 'water'
  if (AMINO_ACIDS.has(name) || NUCLEOTIDES.has(name)) return 'polymer'
  // A monoatomic residue whose name is a metal symbol is a coordinated ion.
  if (atomCount === 1 && METALS.has(name)) return 'metal'
  if (IONS.has(name)) return 'ion'
  if (name.length > 0) return 'ligand'
  return 'unknown'
}

const polymerKindOf = (residueName: string): PolymerKind => {
  const name = residueName.toUpperCase().trim()
  if (AMINO_ACIDS.has(name)) return 'protein'
  if (NUCLEOTIDES.has(name)) return 'nucleic'
  return 'none'
}

/** Single-character entity marker used in the ASCII grid. */
export const ENTITY_MARKER: Record<EntityClass, string> = {
  polymer: 'P', // overridden by chain letter when available
  ligand: 'h',
  water: 'w',
  metal: 'm',
  ion: 'i',
  unknown: '?',
}

const readProp = (atom: ZatomStructureAtom, key: string): string | undefined => {
  const value = atom.properties?.[key]
  if (value === undefined || value === null) return undefined
  return String(value)
}

const readNumber = (atom: ZatomStructureAtom, key: string): number | undefined => {
  const value = atom.properties?.[key]
  if (value === undefined || value === null) return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const composition = (elements: string[]): string => {
  const counts = new Map<string, number>()
  for (const el of elements) counts.set(el, (counts.get(el) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([el, n]) => (n > 1 ? `${el}${n}` : el))
    .join(' ')
}

/** Backbone trace atom names, by polymer kind and preference order. */
const TRACE_ATOM_NAMES: Record<Exclude<PolymerKind, 'none'>, string[]> = {
  protein: ['CA'],
  // P is the standard nucleic trace; C4' carries the 5'-terminal residue, which
  // has no phosphate and would otherwise drop out of the trace.
  nucleic: ['P', "C4'", 'C4*'],
}

/** Per-atom working record, before alternate conformations are resolved. */
interface AtomRecord {
  atom: ZatomStructureAtom
  atomName: string
  altLoc: string
  occupancy: number | undefined
  bFactor: number | undefined
}

/**
 * Build the residue index. Returns an empty index when the structure carries no
 * residue identity, so callers can fall back to atom-level encoding.
 */
export const buildResidueIndex = (structure: ZatomStructure): ResidueIndex => {
  const residueByAtomId = new Map<string, string>()
  const residues = new Map<string, ResidueEntity>()
  const recordsByResidue = new Map<string, AtomRecord[]>()
  const chains = new Set<string>()
  const modelNumbers = new Set<number>()
  const entityByChain = new Map<string, string>()
  /** residue key -> assignment from the file, when the reader supplied one. */
  const recordedStructure = new Map<string, CaTraceAssignment>()

  for (const atom of structure.atoms) {
    const residueName = readProp(atom, BIO.residueName)
    if (residueName === undefined) continue

    const chainId = readProp(atom, BIO.chainId) ?? '_'
    const residueId = readProp(atom, BIO.residueId) ?? '0'
    const insertion = readProp(atom, BIO.insertionCode) ?? ''
    const key = `${chainId}:${residueId}${insertion}:${residueName}`

    residueByAtomId.set(atom.id, key)
    chains.add(chainId)

    const model = readNumber(atom, ANNOT.modelNumber)
    if (model !== undefined) modelNumbers.add(model)
    const entityId = readProp(atom, ANNOT.entityId)
    if (entityId !== undefined && !entityByChain.has(chainId)) {
      entityByChain.set(chainId, entityId)
    }

    const assignment = readProp(atom, ANNOT.secondaryStructure)?.toLowerCase()
    if (assignment === 'helix' || assignment === 'sheet' || assignment === 'coil') {
      recordedStructure.set(key, assignment)
    }

    const record: AtomRecord = {
      atom,
      atomName: readProp(atom, BIO.atomName)?.trim().toUpperCase() ?? '',
      altLoc: (readProp(atom, ANNOT.alternateLocation) ?? '').trim(),
      occupancy: readNumber(atom, ANNOT.occupancy),
      bFactor: readNumber(atom, ANNOT.bFactor),
    }

    const existing = recordsByResidue.get(key)
    if (existing) {
      existing.push(record)
      residues.get(key)!.atomIds.push(atom.id)
    } else {
      recordsByResidue.set(key, [record])
      residues.set(key, {
        key,
        chainId,
        residueName,
        residueId: `${residueId}${insertion}`,
        entityClass: 'unknown',
        polymerKind: 'none',
        atomIds: [atom.id],
        primaryAtomIds: [],
        atomCount: 0,
        alternateAtomCount: 0,
        altLocs: [],
        composition: '',
        residueSeq: Number.parseInt(residueId, 10) || 0,
        tracePosition: null,
        secondaryStructure: null,
        meanBFactor: null,
        minOccupancy: null,
      })
    }
  }

  let alternateConformerResidues = 0
  for (const [key, residue] of residues) {
    const records = recordsByResidue.get(key) ?? []
    const primary = resolvePrimaryConformer(records)
    residue.primaryAtomIds = primary.map((r) => r.atom.id)
    residue.atomCount = primary.length
    residue.alternateAtomCount = records.length - primary.length
    residue.altLocs = [...new Set(records.map((r) => r.altLoc).filter((code) => code !== ''))].sort()
    if (residue.alternateAtomCount > 0) alternateConformerResidues++

    residue.entityClass = classifyResidue(residue.residueName, residue.atomCount)
    residue.polymerKind =
      residue.entityClass === 'polymer' ? polymerKindOf(residue.residueName) : 'none'
    residue.composition = composition(primary.map((r) => r.atom.element))

    const bFactors = primary.map((r) => r.bFactor).filter((b): b is number => b !== undefined)
    residue.meanBFactor =
      bFactors.length > 0 ? bFactors.reduce((sum, b) => sum + b, 0) / bFactors.length : null
    const occupancies = primary.map((r) => r.occupancy).filter((o): o is number => o !== undefined)
    residue.minOccupancy = occupancies.length > 0 ? Math.min(...occupancies) : null

    residue.tracePosition = traceOf(primary, residue.polymerKind)
  }

  const chainResidueOrder = buildChainOrder(residues)
  const secondaryStructureSource = assignSecondaryStructure(
    residues,
    chainResidueOrder,
    recordedStructure,
  )

  return {
    residueByAtomId,
    residues,
    chainIds: [...chains].sort(),
    residueCount: residues.size,
    chainResidueOrder,
    hasSecondaryStructure: secondaryStructureSource !== 'none',
    secondaryStructureSource,
    numberingGaps: findNumberingGaps(residues, chainResidueOrder),
    alternateConformerResidues,
    modelNumbers: [...modelNumbers].sort((a, b) => a - b),
    entityByChain,
  }
}

/**
 * One conformer per atom name.
 *
 * A blank altLoc always wins (it is the single-conformer case), then the highest
 * occupancy, then the lowest altLoc code so the choice is deterministic. This is
 * the same precedence the PDB reader applies, so the two agree on which
 * conformer is "the" structure.
 */
const resolvePrimaryConformer = (records: readonly AtomRecord[]): AtomRecord[] => {
  const hasAlternates = records.some((r) => r.altLoc !== '')
  if (!hasAlternates) return [...records]

  const byName = new Map<string, AtomRecord[]>()
  for (const record of records) {
    // An unnamed atom cannot be matched to its own alternate, so it is kept as is
    // rather than being collapsed with unrelated unnamed atoms.
    const name = record.atomName || `\0${record.atom.id}`
    const list = byName.get(name)
    if (list) list.push(record)
    else byName.set(name, [record])
  }

  const primary: AtomRecord[] = []
  for (const group of byName.values()) {
    if (group.length === 1) {
      primary.push(group[0])
      continue
    }
    const best = [...group].sort((a, b) => {
      const aBlank = a.altLoc === ''
      const bBlank = b.altLoc === ''
      if (aBlank !== bBlank) return aBlank ? -1 : 1
      const aOcc = a.occupancy ?? 1
      const bOcc = b.occupancy ?? 1
      if (aOcc !== bOcc) return bOcc - aOcc
      return a.altLoc.localeCompare(b.altLoc)
    })[0]
    primary.push(best)
  }
  return primary
}

/** Backbone representative for a residue, by polymer kind. */
const traceOf = (records: readonly AtomRecord[], kind: PolymerKind): CaTracePoint | null => {
  if (kind === 'none') return null
  for (const wanted of TRACE_ATOM_NAMES[kind]) {
    const hit = records.find((r) => r.atomName === wanted)
    if (hit) {
      const p = hit.atom.position
      return [p[0], p[1], p[2]] as const
    }
  }
  return null
}

/** Order each chain's residues by sequence number so the trace follows the backbone. */
const buildChainOrder = (residues: Map<string, ResidueEntity>): Map<string, string[]> => {
  const byChain = new Map<string, ResidueEntity[]>()
  for (const residue of residues.values()) {
    const list = byChain.get(residue.chainId)
    if (list) list.push(residue)
    else byChain.set(residue.chainId, [residue])
  }

  const ordered = new Map<string, string[]>()
  for (const [chainId, list] of byChain) {
    list.sort((a, b) => a.residueSeq - b.residueSeq || a.residueId.localeCompare(b.residueId))
    ordered.set(
      chainId,
      list.map((residue) => residue.key),
    )
  }
  return ordered
}

/**
 * Write secondary structure onto each residue, preferring the file's assignment.
 *
 * When the reader supplied any HELIX/SHEET-derived assignment, that is
 * authoritative structure-wide and residues it does not cover are explicitly
 * coil — mixing an authoritative record with a geometric guess in one chain
 * would produce a description that is true nowhere. Only a file with no
 * assignment at all falls back to the C-alpha kernel.
 */
const assignSecondaryStructure = (
  residues: Map<string, ResidueEntity>,
  chainResidueOrder: Map<string, string[]>,
  recorded: Map<string, CaTraceAssignment>,
): SecondaryStructureSource => {
  if (recorded.size > 0) {
    for (const residue of residues.values()) {
      if (residue.entityClass !== 'polymer') continue
      residue.secondaryStructure = recorded.get(residue.key) ?? 'coil'
    }
    return 'record'
  }

  let assigned = false
  for (const keys of chainResidueOrder.values()) {
    const traceKeys: string[] = []
    const tracePositions: CaTracePoint[] = []

    for (const key of keys) {
      const residue = residues.get(key)
      // The C-alpha kernel is a protein kernel: a nucleic trace has a ~6 A rise
      // per residue and would be scored as coil throughout, so it is excluded
      // rather than fed in and misreported.
      if (!residue || residue.polymerKind !== 'protein' || residue.tracePosition === null) continue
      traceKeys.push(key)
      tracePositions.push(residue.tracePosition)
    }
    if (tracePositions.length < 5) continue

    const assignment = estimateSecondaryStructureFromCaTrace(tracePositions)
    traceKeys.forEach((key, offset) => {
      residues.get(key)!.secondaryStructure = assignment[offset]
    })
    assigned = true
  }

  return assigned ? 'estimated' : 'none'
}

/**
 * Numbering breaks per chain — the positions of unmodelled loops.
 *
 * A single boolean ("this chain has gaps") tells a model that sequence positions
 * cannot be trusted but not where the problem is, which is the difference
 * between "do not use the sequence" and "residues 41-54 are missing, so that
 * loop is absent from the model, not disordered".
 */
const findNumberingGaps = (
  residues: Map<string, ResidueEntity>,
  chainResidueOrder: Map<string, string[]>,
): NumberingGap[] => {
  const gaps: NumberingGap[] = []
  for (const [chainId, keys] of chainResidueOrder) {
    let previous: ResidueEntity | null = null
    for (const key of keys) {
      const residue = residues.get(key)
      if (!residue || residue.entityClass !== 'polymer') continue
      if (previous !== null) {
        const step = residue.residueSeq - previous.residueSeq
        if (step > 1) {
          gaps.push({
            chainId,
            afterResidueId: previous.residueId,
            beforeResidueId: residue.residueId,
            missingCount: step - 1,
          })
        }
      }
      previous = residue
    }
  }
  return gaps
}

/**
 * Entity marker for a residue: polymer residues use their chain letter so that
 * chain topology is visible in the grid; everything else uses its class marker.
 */
export const residueMarker = (residue: ResidueEntity): string => {
  if (residue.entityClass === 'polymer') {
    const letter = residue.chainId.trim()
    if (letter.length === 1 && /[A-Za-z0-9]/.test(letter)) return letter.toUpperCase()
    return ENTITY_MARKER.polymer
  }
  return ENTITY_MARKER[residue.entityClass]
}

/** Human-readable residue label, e.g. "HEM C142". */
export const residueLabel = (residue: ResidueEntity): string =>
  `${residue.residueName} ${residue.chainId}${residue.residueId}`

/**
 * Find a residue by label — the single lookup both `scene_grid` and
 * `scene_contacts` use, so a label a model reads in one tool always resolves
 * the same way in the other.
 *
 * Accepted forms, in order: the full label ("HEM C142"), the internal key,
 * chain+id ("C142"), the bare residue id ("142"), and the bare residue name
 * ("HEM"). The bare-name form is last because it is ambiguous: it matches every
 * copy of that residue, which is what you want for a unique ligand and not what
 * you want for "HIS".
 *
 * Returns null on no match. Callers must not fall back to another focus — a
 * silent substitution answers a question the caller did not ask.
 */
export const lookupResidue = (
  index: ResidueIndex | null,
  query: string,
): { atomIds: readonly string[]; label: string } | null => {
  if (!index) return null
  const wanted = query.trim().toLowerCase()
  if (!wanted) return null

  for (const residue of index.residues.values()) {
    const label = residueLabel(residue)
    if (
      label.toLowerCase() === wanted ||
      residue.key.toLowerCase() === wanted ||
      `${residue.chainId}${residue.residueId}`.toLowerCase() === wanted ||
      residue.residueId.toLowerCase() === wanted
    ) {
      return { atomIds: residue.atomIds, label }
    }
  }

  // Bare residue name: union every copy, so "HEM" focuses the ligand even when
  // the caller does not know its chain and number.
  const byName: string[] = []
  let firstLabel = ''
  for (const residue of index.residues.values()) {
    if (residue.residueName.toLowerCase() === wanted) {
      if (!firstLabel) firstLabel = residueLabel(residue)
      byName.push(...residue.atomIds)
    }
  }
  if (byName.length > 0) {
    return { atomIds: byName, label: firstLabel }
  }
  return null
}
