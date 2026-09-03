/**
 * Contact list — the true-3D-distance channel.
 *
 * The SceneGrid projection collapses depth by construction, so two atoms in one
 * cell can be 40 A apart and 8 depth bins over a 40 A protein is ~5 A per bin,
 * coarser than a hydrogen bond. Proximity therefore cannot be recovered from the
 * grid at any resolution — it needs its own channel that never goes through the
 * projection.
 *
 * This module answers "what is next to what, and how far", the form almost every
 * modeling decision actually takes:
 *
 *   HIS A93 NE2 - Fe C142  2.10 A
 *
 * Pure module: structure + focus in, ranked contacts out.
 */

import type { ZatomStructure, ZatomStructureAtom } from '../../agent/contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PROPERTIES as BIO } from '../../agent/biomolecular-identity'
import { NeighborGrid } from './neighbor-grid'
import { type ResidueIndex, buildResidueIndex, residueLabel } from './residue-index'

/** Default contact cutoff: covers hydrogen bonds, salt bridges, coordination. */
export const DEFAULT_CONTACT_CUTOFF = 4.0

/** Hard cap so a large focus set cannot produce an unreadable wall of text. */
export const MAX_CONTACTS = 60

export interface ContactQuery {
  /** Atoms to treat as the focus. Contacts are reported *from* these atoms. */
  focusAtomIds: ReadonlySet<string>
  /** Search radius in Angstrom. */
  cutoff?: number
  /** Max contacts returned, closest first. */
  limit?: number
  /**
  * Collapse per-atom contacts to one row per partner residue, keeping the
  * closest atom pair. Default true at biomolecular scale: 43 ligand atoms
  * against a protein produce hundreds of rows otherwise.
  */
  groupByResidue?: boolean
}

export interface Contact {
  fromAtomId: string
  fromLabel: string
  toAtomId: string
  toLabel: string
  distance: number
  /** Lattice translation applied to the partner, when periodic. */
  latticeOffset: [number, number, number] | null
}

export interface ContactResult {
  contacts: Contact[]
  focusAtomCount: number
  cutoff: number
  /** True when the limit clipped the list, so the caller knows it is partial. */
  truncated: boolean
  /** Total contacts found before the limit. */
  totalFound: number
  /** Rendered table the LLM reads. */
  text: string
}

const readProp = (atom: ZatomStructureAtom, key: string): string | undefined => {
  const value = atom.properties?.[key]
  if (value === undefined || value === null) return undefined
  return String(value)
}

/**
 * Atom label with as much identity as the structure carries: full biomolecular
 * form when available, otherwise element + id so the label is always actionable.
 */
const atomLabel = (
  atom: ZatomStructureAtom,
  residueIndex: ResidueIndex | null,
): string => {
  const atomName = readProp(atom, BIO.atomName)
  if (residueIndex) {
    const key = residueIndex.residueByAtomId.get(atom.id)
    if (key !== undefined) {
      const residue = residueIndex.residues.get(key)
      if (residue) {
        const base = residueLabel(residue)
        return atomName ? `${base} ${atomName}` : `${base} ${atom.element}`
      }
    }
  }
  return `${atom.element} ${atom.id}`
}

/** Residue key for grouping, falling back to the atom id when non-biomolecular. */
const groupKeyOf = (atomId: string, residueIndex: ResidueIndex | null): string =>
  residueIndex?.residueByAtomId.get(atomId) ?? atomId

/**
 * Contacts from the focus set to everything else within the cutoff.
 *
 * Atoms inside the focus are excluded as partners: a ligand's internal bonds are
 * already known from the structure and would crowd out the environment, which is
 * what the query is actually asking about.
 */
export const findContacts = (
  structure: ZatomStructure,
  query: ContactQuery,
): ContactResult => {
  const cutoff = query.cutoff ?? DEFAULT_CONTACT_CUTOFF
  const limit = query.limit ?? MAX_CONTACTS
  const groupByResidue = query.groupByResidue !== false

  const atoms = structure.atoms
  const indexById = new Map<string, number>()
  for (let i = 0; i < atoms.length; i++) indexById.set(atoms[i].id, i)

  const focusIndices = new Set<number>()
  for (const id of query.focusAtomIds) {
    const idx = indexById.get(id)
    if (idx !== undefined) focusIndices.add(idx)
  }

  if (focusIndices.size === 0) {
    return {
      contacts: [],
      focusAtomCount: 0,
      cutoff,
      truncated: false,
      totalFound: 0,
      text: '# scene-contacts: focus set is empty (no matching atom ids in the scene)',
    }
  }

  const residueIndex = buildResidueIndex(structure)
  const useResidues = residueIndex.residueCount > 0
  const effectiveIndex = useResidues ? residueIndex : null

  const grid = new NeighborGrid(structure, { cutoff })
  const found: Contact[] = []

  for (const fromIdx of focusIndices) {
    const fromAtom = atoms[fromIdx]
    // Exclude the whole focus set so only the environment is reported.
    for (const hit of grid.neighborsOf(fromAtom.position, focusIndices)) {
      found.push({
        fromAtomId: fromAtom.id,
        fromLabel: atomLabel(fromAtom, effectiveIndex),
        toAtomId: hit.atomId,
        toLabel: atomLabel(atoms[hit.atomIndex], effectiveIndex),
        distance: hit.distance,
        latticeOffset: hit.latticeOffset,
      })
    }
  }

  found.sort((a, b) => a.distance - b.distance)

  // Collapse to the closest pair per partner group; `found` is already sorted,
  // so the first occurrence of a group is its closest contact.
  let collapsed = found
  if (groupByResidue && useResidues) {
    const seen = new Set<string>()
    collapsed = []
    for (const contact of found) {
      const key = `${groupKeyOf(contact.fromAtomId, effectiveIndex)}->${groupKeyOf(contact.toAtomId, effectiveIndex)}`
      if (seen.has(key)) continue
      seen.add(key)
      collapsed.push(contact)
    }
  }

  const totalFound = collapsed.length
  const contacts = collapsed.slice(0, limit)
  const truncated = totalFound > contacts.length

  return {
    contacts,
    focusAtomCount: focusIndices.size,
    cutoff,
    truncated,
    totalFound,
    text: renderContacts(contacts, {
      cutoff,
      focusAtomCount: focusIndices.size,
      totalFound,
      truncated,
      grouped: groupByResidue && useResidues,
    }),
  }
}

const renderContacts = (
  contacts: Contact[],
  meta: {
    cutoff: number
    focusAtomCount: number
    totalFound: number
    truncated: boolean
    grouped: boolean
  },
): string => {
  const header =
    `# scene-contacts focusAtoms=${meta.focusAtomCount} cutoff=${meta.cutoff.toFixed(2)}A ` +
    `contacts=${contacts.length}/${meta.totalFound}${meta.truncated ? ' (truncated)' : ''}` +
    `${meta.grouped ? ' grouped=byResidue' : ''}`

  if (contacts.length === 0) {
    return [
      header,
      `# no atoms within ${meta.cutoff.toFixed(2)} A of the focus set`,
    ].join('\n')
  }

  const notes = [
    '# true 3D distances, not projected: this channel bypasses the grid entirely',
    meta.grouped
      ? '# one row per partner residue, keeping the closest atom pair'
      : '# one row per atom pair',
    '# columns: focus atom | partner | distance | lattice image',
  ]

  const rows = contacts.map((c) => {
    const image = c.latticeOffset ? ` [${c.latticeOffset.join(',')}]` : ''
    return `${c.fromLabel}  ->  ${c.toLabel}  ${c.distance.toFixed(2)} A${image}`
  })

  return [header, ...notes, ...rows].join('\n')
}
