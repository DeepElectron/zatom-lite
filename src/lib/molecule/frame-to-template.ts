/**
 * Save a workspace asset (a batch frame) into the user's structure library, so
 * it becomes a searchable, loadable catalog entry alongside the bundled models.
 *
 * This is the third of three storage islands joining the catalog. The other two
 * needed geometry work — a 2D sketch has no z axis at all, so `planar-to-3d`
 * has to perturb and relax it before the coordinates mean anything. A batch
 * frame is different: it was captured *from* the 3D editor, so its coordinates
 * are already the real thing. Promoting it is metadata only, and deliberately
 * does not touch the force field: re-relaxing here would silently discard the
 * geometry the user built and is looking at.
 *
 * Naming is the substance of this module. A frame's `label` defaults to
 * whatever the producing loader called it ("HCP (Mg)"), which is a statement
 * about where it came from, not a name for this particular structure — capture
 * the same template twice and both rows read identically. A library entry keyed
 * by such a label is unfindable, so a name is required here and collisions are
 * resolved rather than accepted.
 */

import { atomicNumberToSymbol } from '../../chemistry/periodic-table'
import {
  fragmentNameExists,
  saveCustomFragment,
  type CustomFragment,
} from './custom-fragments'

/** The frame fields this module reads. Structural, so `WorkspaceFrame` fits. */
export interface TemplateSourceFrame {
  label: string
  atoms: readonly {
    element: number
    position: [number, number, number]
  }[]
  bonds?: readonly {
    from: number
    to: number
    type: 'single' | 'double' | 'triple' | 'aromatic' | 'partial'
  }[]
  /** Unit cell of a periodic frame; absent on molecular ones. */
  latticeMatrix?: readonly (readonly number[])[]
  periodicity?: 'periodic' | 'molecular'
}

/**
 * A lattice is usable only if it spans a real volume. A singular or
 * near-degenerate matrix cannot be inverted to fractional coordinates, so
 * storing one would produce an entry that fails at load time instead of here.
 */
function readLatticeMatrix(
  frame: TemplateSourceFrame,
): [number, number, number][] | undefined {
  const rows = frame.latticeMatrix
  if (!rows || rows.length !== 3) return undefined
  const matrix = rows.map((row) => {
    if (row.length !== 3 || row.some((value) => !Number.isFinite(value))) return null
    return [row[0], row[1], row[2]] as [number, number, number]
  })
  if (matrix.some((row) => row === null)) return undefined
  const [a, b, c] = matrix as [number, number, number][]
  const determinant =
    a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0])
  if (Math.abs(determinant) < 1e-9) return undefined
  return matrix as [number, number, number][]
}

/**
 * Hill-ish empirical formula: carbon and hydrogen first, then the rest
 * alphabetically. Feeds the catalog row's second line and its search haystack,
 * so a user who forgot what they named something can still find it by
 * composition.
 */
export function frameFormula(frame: TemplateSourceFrame): string {
  const counts = new Map<string, number>()
  for (const atom of frame.atoms) {
    const symbol = atomicNumberToSymbol(atom.element)
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
  }
  const ordered = [...counts.keys()].sort((a, b) => {
    if (a === b) return 0
    if (a === 'C') return -1
    if (b === 'C') return 1
    if (a === 'H') return -1
    if (b === 'H') return 1
    return a.localeCompare(b)
  })
  return ordered
    .map((symbol) => {
      const count = counts.get(symbol) ?? 0
      return count === 1 ? symbol : `${symbol}${count}`
    })
    .join('')
}

/**
 * First free name in the `name`, `name 2`, `name 3` … series.
 *
 * Two assets showing the same text is a cosmetic annoyance in a batch list, but
 * in a searchable library it makes a hit ambiguous — you cannot tell which of
 * two identical rows is the one you wanted. Suffixing keeps the user's chosen
 * word while restoring a one-to-one map between name and structure.
 */
export function uniqueTemplateName(preferred: string): string {
  const base = preferred.trim() || 'Untitled structure'
  if (!fragmentNameExists(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base} ${suffix}`
    if (!fragmentNameExists(candidate)) return candidate
  }
  return `${base} ${Date.now()}`
}

export interface FrameTemplateResult {
  ok: boolean
  fragment?: CustomFragment
  /** Final stored name, which may carry a dedupe suffix. */
  name?: string
  error?: string
}

/**
 * Promote a frame into the user library.
 *
 * `name` is required and not defaulted to `frame.label`: accepting the inherited
 * source label is exactly how unfindable duplicates get created, so the caller
 * must have asked the user for a name first.
 */
export function saveFrameAsTemplate(
  frame: TemplateSourceFrame,
  name: string,
): FrameTemplateResult {
  if (frame.atoms.length === 0) {
    return { ok: false, error: 'This asset has no atoms to save' }
  }
  const requested = name.trim()
  if (!requested) return { ok: false, error: 'A name is required' }

  const finalName = uniqueTemplateName(requested)
  const atoms = frame.atoms.map((atom) => ({
    element: atomicNumberToSymbol(atom.element),
    position: [atom.position[0], atom.position[1], atom.position[2]] as [number, number, number],
  }))

  /**
  * Bonds are dropped when absent rather than inferred. The loader re-derives
  * bonds from distance when a structure carries none, which is the same result
  * a guess here would produce — except a guess would also be persisted as if
  * it were measured topology.
  */
  const bonds = frame.bonds
    ?.filter((bond) => (
      bond.from >= 0 && bond.from < atoms.length
      && bond.to >= 0 && bond.to < atoms.length
    ))
    .map((bond) => ({ from: bond.from, to: bond.to, type: bond.type }))

  /**
  * Periodicity is derived from the cell, not copied from `frame.periodicity`.
  * A frame can claim to be periodic while carrying no usable cell (or a
  * degenerate one), and trusting the flag over the geometry is what lets a
  * crystal land in the library as an un-loadable "periodic" entry with nothing
  * to be periodic about. The cell is the evidence; the flag only labels it.
  */
  const latticeMatrix = readLatticeMatrix(frame)

  const fragment = saveCustomFragment({
    name: finalName,
    formula: frameFormula(frame),
    atoms,
    ...(bonds && bonds.length > 0 ? { bonds } : {}),
    ...(latticeMatrix
      ? { latticeMatrix, periodicity: 'periodic' as const }
      : { periodicity: 'molecular' as const }),
  })

  return { ok: true, fragment, name: finalName }
}
