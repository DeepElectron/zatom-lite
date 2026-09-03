/**
 * Outline — a hierarchical, named rendering of the scene.
 *
 * This is the channel a language model reads most reliably: an ordered list of
 * named entities with counts, not a 2D character field. Judging that cell (7,12)
 * neighbours (7,13) requires counting characters and aligning two independent
 * token sequences; reading "chain A - 153 res - 8 helices" requires neither.
 *
 * For a protein it is also the highest-density structural description available.
 * One line summarises what a grid would spend forty cells failing to convey,
 * because per-atom element symbols in a 95%-C/N/O composition carry almost no
 * information, while fold topology carries most of it.
 *
 * Pure module: plain data in, plain data out.
 */

import type { ZatomStructure } from '../../agent/contracts'
import { residueOneLetterCode } from '../biomolecule/residue-codes'
import type { CaTraceAssignment } from '../biomolecule/secondary-structure'
import { findContacts } from './contacts'
import type { OutlineDetail } from './foveate'
import {
  type EntityClass,
  type ResidueEntity,
  type ResidueIndex,
  residueLabel,
} from './residue-index'

/** One non-polymer entity and the polymer residues lining it. */
export interface PocketReport {
  /** The ligand, metal, or ion the pocket belongs to. */
  entity: ResidueEntity
  /** Lining residue labels with the closest approach, nearest first. */
  lining: { label: string; distance: number }[]
  /** True when the contact search hit its cap, so the lining is partial. */
  truncated: boolean
}

/** One run of consecutive residues sharing a secondary-structure assignment. */
export interface StructureSegment {
  kind: CaTraceAssignment
  chainId: string
  startResidueId: string
  endResidueId: string
  length: number
}

export interface ChainOutline {
  chainId: string
  residueCount: number
  atomCount: number
  firstResidueId: string
  lastResidueId: string
  segments: StructureSegment[]
  helixCount: number
  sheetCount: number
  /** One-letter sequence in backbone order. Lowercase marks nucleotides. */
  sequence: string
  /** Residue number of the first sequence position, for indexing into it. */
  sequenceStart: number
  /**
  * True when the residue numbering has gaps, so sequence position and residue
  * id do not correspond by simple offset.
  */
  hasNumberingGaps: boolean
}

export interface OutlineResult {
  chains: ChainOutline[]
  /** Non-polymer entities worth naming individually. */
  ligands: ResidueEntity[]
  metals: ResidueEntity[]
  ions: ResidueEntity[]
  waterCount: number
  waterAtomCount: number
  /**
  * Lining residues for each non-polymer entity. Empty when no structure was
  * supplied, since the pocket is a geometric question the index cannot answer.
  */
  pockets: PocketReport[]
  /** Rendered text, already trimmed to the requested detail level. */
  text: string
  /** True when secondary structure is a geometry estimate, not from the file. */
  secondaryStructureEstimated: boolean
}

/**
 * Segments shorter than this are dropped from the segment listing.
 *
 * A two-residue "helix" is noise from the geometric estimator rather than a
 * structural feature, and listing it would spend budget lowering precision.
 */
const MIN_SEGMENT_LENGTH = 3

/**
 * Pocket search radius, in Angstrom.
 *
 * Wider than the 4.0 A bond-contact default: a binding pocket is defined by the
 * residues enclosing the entity, which includes second-shell residues making
 * van der Waals rather than hydrogen-bonded contact.
 */
const POCKET_CUTOFF = 4.5

/**
 * Max lining residues reported per entity.
 *
 * A real pocket is lined by roughly 8-15 residues. Beyond that the list stops
 * describing a pocket and starts describing a surface.
 */
const POCKET_LINING_LIMIT = 14

/** Residue names that denote solvent water in deposited structures. */
const WATER_NAMES = new Set(['HOH', 'WAT', 'DOD', 'H2O', 'TIP3', 'SOL'])

/** True when a contact label names a water molecule. */
const isWaterLabel = (label: string): boolean => {
  const first = label.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
  return WATER_NAMES.has(first)
}

/** Sequence block width. Ten is the convention deposited files and UniProt use. */
const SEQUENCE_BLOCK = 10

/** Sequence blocks per rendered line. */
const SEQUENCE_BLOCKS_PER_LINE = 6

/**
 * Render a sequence with residue-number anchors at the start of each line.
 *
 * Without the anchors a sequence is unusable for reasoning about a specific
 * position: locating residue 93 would mean counting 93 characters, which is
 * exactly the operation that fails silently.
 */
const renderSequence = (chain: ChainOutline): string[] => {
  const lines: string[] = []
  const perLine = SEQUENCE_BLOCK * SEQUENCE_BLOCKS_PER_LINE
  for (let offset = 0; offset < chain.sequence.length; offset += perLine) {
    const slice = chain.sequence.slice(offset, offset + perLine)
    const blocks: string[] = []
    for (let b = 0; b < slice.length; b += SEQUENCE_BLOCK) {
      blocks.push(slice.slice(b, b + SEQUENCE_BLOCK))
    }
    // The anchor is a sequence ordinal, not a residue id, whenever numbering has
    // gaps — labelling it as a residue id would be a quiet lie.
    const anchor = chain.hasNumberingGaps ? offset + 1 : chain.sequenceStart + offset
    lines.push(`  ${String(anchor).padStart(5)} ${blocks.join(' ')}`)
  }
  return lines
}

/** Group a chain's residues into runs of equal secondary structure. */
const buildSegments = (
  chainId: string,
  residues: readonly ResidueEntity[],
): StructureSegment[] => {
  const segments: StructureSegment[] = []
  let run: { kind: CaTraceAssignment; start: ResidueEntity; end: ResidueEntity } | null = null

  const flush = (): void => {
    if (run === null) return
    const length = Number(run.end.residueSeq) - Number(run.start.residueSeq) + 1
    if (run.kind !== 'coil' && length >= MIN_SEGMENT_LENGTH) {
      segments.push({
        kind: run.kind,
        chainId,
        startResidueId: run.start.residueId,
        endResidueId: run.end.residueId,
        length,
      })
    }
    run = null
  }

  for (const residue of residues) {
    const kind = residue.secondaryStructure
    if (kind === null) {
      flush()
      continue
    }
    // Break the run on a sequence gap: residues 40 and 55 are not contiguous
    // even when both are helical, and merging them would invent a segment.
    const contiguous =
      run !== null && run.kind === kind && Number(residue.residueSeq) === Number(run.end.residueSeq) + 1
    if (contiguous && run !== null) {
      run.end = residue
    } else {
      flush()
      run = { kind, start: residue, end: residue }
    }
  }
  flush()
  return segments
}

const CLASS_ORDER: EntityClass[] = ['ligand', 'metal', 'ion']

/**
 * Build the outline. `detail` controls how much is rendered, not how much is
 * computed, so the structured fields stay complete for programmatic callers.
 */
export const buildOutline = (
  index: ResidueIndex,
  detail: OutlineDetail = 'full',
  options: {
    /**
    * Supplying the structure enables pocket lining. Without it the outline
    * still describes composition and fold, but not what surrounds a ligand —
    * which is usually the question actually being asked.
    */
    structure?: ZatomStructure
    /** Search radius for pocket lining, in Angstrom. */
    pocketCutoff?: number
  } = {},
): OutlineResult => {
  const chains: ChainOutline[] = []
  const ligands: ResidueEntity[] = []
  const metals: ResidueEntity[] = []
  const ions: ResidueEntity[] = []
  let waterCount = 0
  let waterAtomCount = 0

  for (const chainId of index.chainIds) {
    const keys = index.chainResidueOrder.get(chainId) ?? []
    const polymer: ResidueEntity[] = []

    for (const key of keys) {
      const residue = index.residues.get(key)
      if (residue === undefined) continue
      switch (residue.entityClass) {
        case 'polymer':
          polymer.push(residue)
          break
        case 'water':
          waterCount++
          waterAtomCount += residue.atomCount
          break
        case 'ligand':
          ligands.push(residue)
          break
        case 'metal':
          metals.push(residue)
          break
        case 'ion':
          ions.push(residue)
          break
        default:
          ligands.push(residue)
          break
      }
    }

    if (polymer.length === 0) continue
    const segments = buildSegments(chainId, polymer)
    const expectedSpan = Number(polymer[polymer.length - 1].residueSeq) - Number(polymer[0].residueSeq) + 1
    chains.push({
      chainId,
      residueCount: polymer.length,
      atomCount: polymer.reduce((sum, r) => sum + r.atomCount, 0),
      firstResidueId: polymer[0].residueId,
      lastResidueId: polymer[polymer.length - 1].residueId,
      segments,
      helixCount: segments.filter((s) => s.kind === 'helix').length,
      sheetCount: segments.filter((s) => s.kind === 'sheet').length,
      sequence: polymer.map((r) => residueOneLetterCode(r.residueName)).join(''),
      sequenceStart: Number(polymer[0].residueSeq),
      hasNumberingGaps: expectedSpan !== polymer.length,
    })
  }

  const byClass: Record<string, ResidueEntity[]> = { ligand: ligands, metal: metals, ion: ions }

  // Pocket lining: what surrounds each non-polymer entity. This is the question
  // a grid can never answer, because projection collapses the depth axis that
  // separates "lining the pocket" from "20 A away on the far face".
  const pockets: PocketReport[] = []
  if (options.structure !== undefined) {
    for (const entity of [...ligands, ...metals, ...ions]) {
      const result = findContacts(options.structure, {
        focusAtomIds: new Set(entity.atomIds),
        cutoff: options.pocketCutoff ?? POCKET_CUTOFF,
        limit: POCKET_LINING_LIMIT,
        groupByResidue: true,
      })
      // Water is excluded: it lines almost every surface pocket and would crowd
      // out the residues that explain why this entity binds here.
      const lining = result.contacts
        .filter((contact) => !isWaterLabel(contact.toLabel))
        .map((contact) => ({ label: contact.toLabel, distance: contact.distance }))
      if (lining.length > 0) {
        pockets.push({ entity, lining, truncated: result.truncated })
      }
    }
  }

  const lines: string[] = []

  // `none` is the last degradation step: the structured fields stay complete
  // for programmatic callers, only the rendered text is dropped.
  if (detail === 'none') {
    return {
      chains,
      ligands,
      metals,
      ions,
      waterCount,
      waterAtomCount,
      pockets,
      text: '',
      secondaryStructureEstimated: index.hasSecondaryStructure,
    }
  }

  for (const chain of chains) {
    const range = `${chain.firstResidueId}-${chain.lastResidueId}`
    const fold =
      index.hasSecondaryStructure && (chain.helixCount > 0 || chain.sheetCount > 0)
        ? ` | ${chain.helixCount}H ${chain.sheetCount}E`
        : ''
    lines.push(
      `chain ${chain.chainId}: ${chain.residueCount} res ${range}, ${chain.atomCount} atoms${fold}`,
    )
    // Fold topology survives into `compact`: a segment list costs tens of
    // characters and carries the chain's architecture, which is a far better
    // rate than the sequence it sits next to. The sequence is what gets cut.
    if (detail !== 'minimal' && chain.segments.length > 0) {
      const parts = chain.segments.map(
        (s) => `${s.kind === 'helix' ? 'H' : 'E'} ${s.startResidueId}-${s.endResidueId}`,
      )
      lines.push(`  ${parts.join('  ')}`)
    }
    if (detail === 'full' && chain.sequence.length > 0) {
      lines.push(...renderSequence(chain))
      if (chain.hasNumberingGaps) {
        lines.push('  (numbering has gaps; anchors above are sequence positions)')
      }
    }
  }

  for (const entityClass of CLASS_ORDER) {
    const group = byClass[entityClass]
    if (group.length === 0) continue
    const parts = group.map((residue) =>
      detail === 'minimal'
        ? residueLabel(residue)
        : `${residueLabel(residue)} (${residue.atomCount} atoms, ${residue.composition})`,
    )
    lines.push(`${entityClass}: ${parts.join(' | ')}`)
  }

  if (waterCount > 0) lines.push(`water: ${waterCount} (${waterAtomCount} atoms)`)

  // Pocket lining last: it is the most specific claim here, and reading it is
  // only meaningful once the chains and entities it references are named above.
  if (pockets.length > 0 && detail !== 'minimal') {
    for (const pocket of pockets) {
      const shown = detail === 'full' ? pocket.lining : pocket.lining.slice(0, 6)
      const parts = shown.map((c) => `${c.label} ${c.distance.toFixed(2)}`)
      const more = pocket.lining.length > shown.length ? ` +${pocket.lining.length - shown.length}` : ''
      const partial = pocket.truncated ? ' (capped)' : ''
      lines.push(
        `pocket ${residueLabel(pocket.entity)} <=${(options.pocketCutoff ?? POCKET_CUTOFF).toFixed(1)}A: ${parts.join(' | ')}${more}${partial}`,
      )
    }
  }

  return {
    chains,
    ligands,
    metals,
    ions,
    waterCount,
    waterAtomCount,
    pockets,
    text: lines.join('\n'),
    secondaryStructureEstimated: index.hasSecondaryStructure,
  }
}
