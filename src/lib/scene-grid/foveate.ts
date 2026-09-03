/**
 * Foveation — turns a focus into a budget allocation.
 *
 * The problem this solves is not resolution, it is *distribution*. A uniform
 * 24x24 grid bills 576 cells at equal cost, but the answer to "why does the
 * heme bind like this" lives in about six residues. Raising the resolution buys
 * more cells at the same flat rate; it does not move the budget to where the
 * information is.
 *
 * So the focus becomes the allocator. Two uniform grids are emitted instead of
 * one non-uniform grid: an overview that keeps global bearings, and an inset
 * covering a ~10x smaller window. Both stay rectangular — a genuine quadtree
 * cannot be rendered as a character matrix without ambiguity, because the
 * reader cannot recover how much space a given character covers.
 *
 * The inset is what makes element symbols informative again: once the window is
 * small enough that a cell holds roughly one atom, the symbol stops being a draw
 * from a fixed marginal distribution and starts identifying a specific atom.
 *
 * Pure module: plain data in, plain data out.
 */

import type { SceneRegime } from './regime'

/**
 * A square window in screen space, in world units (A).
 *
 * Defined here rather than in scene-grid.ts so the dependency runs one way:
 * scene-grid imports foveate, never the reverse.
 */
export interface ScreenWindow {
  uCenter: number
  vCenter: number
  /** Half-extent of the square window, in A. */
  half: number
}

/**
 * Minimal structural shape foveation needs from a projected atom. `ProjectedAtom`
 * satisfies it, which keeps this module free of any import from scene-grid.
 */
export interface ScreenPoint {
  atomId: string
  u: number
  v: number
}

/**
 * Where the focus came from — reported so the reader never has to guess.
 *
 * `unmatched` is distinct from `none`: "you asked for something and it does not
 * exist here" and "you asked for nothing" are different facts, and collapsing
 * them would swallow the diagnostic for a failed request.
 */
export type FocusOrigin = 'explicit_atoms' | 'residue' | 'selection' | 'none' | 'unmatched'

export interface FocusResolution {
  atomIds: ReadonlySet<string>
  origin: FocusOrigin
  /** Label for the focus, e.g. "HEM C142" or "selection (43 atoms)". */
  label: string
}

/** What a caller can ask to focus on, in precedence order. */
export interface FocusRequest {
  focusAtomIds?: ReadonlySet<string>
  focusResidue?: string
  selectedAtomIds?: ReadonlySet<string>
}

/**
 * Resolve a focus request to a concrete atom set.
 *
 * Precedence is explicit atoms > residue label > user selection: a per-call
 * focus is the agent steering its own attention, and that must not silently
 * lose to (or overwrite) what the user has selected.
 *
 * The residue lookup is injected rather than imported so this module stays
 * independent of the residue index.
 */
export const resolveFocus = (
  request: FocusRequest,
  residueLookup: (label: string) => { atomIds: readonly string[]; label: string } | null,
): FocusResolution => {
  const explicit = request.focusAtomIds
  if (explicit && explicit.size > 0) {
    return { atomIds: explicit, origin: 'explicit_atoms', label: `${explicit.size} atoms` }
  }

  const residueQuery = request.focusResidue?.trim()
  if (residueQuery) {
    const hit = residueLookup(residueQuery)
    // An unmatched label resolves to no focus rather than falling back to the
    // selection: silently focusing something else would be a wrong answer to
    // an explicit request.
    if (hit) {
      return { atomIds: new Set(hit.atomIds), origin: 'residue', label: hit.label }
    }
    return { atomIds: new Set(), origin: 'unmatched', label: `no match for "${residueQuery}"` }
  }

  const selected = request.selectedAtomIds
  if (selected && selected.size > 0) {
    return { atomIds: selected, origin: 'selection', label: `selection (${selected.size} atoms)` }
  }
  return { atomIds: new Set(), origin: 'none', label: 'none' }
}

/* ------------------------------------------------------------------ */
/* Focus window                                                        */
/* ------------------------------------------------------------------ */

/**
 * Minimum half-extent, in A. A focus tighter than this gets padded so the
 * coordination shell stays visible instead of being cropped at the edge —
 * a bare ligand window would cut off exactly the residues that explain it.
 */
const MIN_FOCUS_HALF_A = 4

/**
 * Context padding around the focus, in A.
 *
 * Additive rather than multiplicative on purpose. The thing that has to stay in
 * frame is the contact shell, and its thickness is a physical constant of about
 * 4.5 A — it does not scale with the size of the focus. A multiplicative margin
 * fails in exactly the common case: a heme or a lone metal has a small bounding
 * box, so a 1.5x margin still crops every residue that lines it, and the inset
 * renders the ligand floating in an empty field. Measured on a heme focus that
 * produced eighteen `h1` cells and no protein at all.
 */
const FOCUS_CONTEXT_PAD_A = 5.5

/**
 * Screen-space window covering the focus atoms, padded for context.
 *
 * Returns null when no focus atom was projected, which the caller must treat as
 * "no inset" rather than falling back to an arbitrary window.
 */
export const focusWindow = (
  points: readonly ScreenPoint[],
  focusAtomIds: ReadonlySet<string>,
): ScreenWindow | null => {
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  let found = 0

  for (const point of points) {
    if (!focusAtomIds.has(point.atomId)) continue
    found++
    if (point.u < uMin) uMin = point.u
    if (point.u > uMax) uMax = point.u
    if (point.v < vMin) vMin = point.v
    if (point.v > vMax) vMax = point.v
  }
  if (found === 0) return null

  const halfExtent = Math.max(uMax - uMin, vMax - vMin) / 2
  return {
    uCenter: (uMin + uMax) / 2,
    vCenter: (vMin + vMax) / 2,
    half: Math.max(halfExtent + FOCUS_CONTEXT_PAD_A, MIN_FOCUS_HALF_A),
  }
}

/* ------------------------------------------------------------------ */
/* Budget                                                             */
/* ------------------------------------------------------------------ */

/**
 * Outline verbosity. `none` exists only as the last degradation step: at a very
 * tight ceiling, two grids at their floor plus a legend already exceed the
 * budget, so a whole block has to go rather than the ceiling being breached.
 */
export type OutlineDetail = 'full' | 'compact' | 'minimal' | 'none'

export type NotesDetail = 'full' | 'terse'

export interface BudgetPlan {
  /** Hard character ceiling for the whole rendering. */
  budget: number
  overviewResolution: number
  /**
  * True when the caller pinned the overview resolution explicitly. Degradation
  * must then skip that step: the pin is re-applied on every iteration, so a
  * step that only lowers `overviewResolution` would be undone and the caller's
  * "shrink until it fits" loop would never terminate.
  */
  overviewPinned: boolean
  /** 0 when there is no focus, meaning no inset is emitted. */
  insetResolution: number
  outlineDetail: OutlineDetail
  /**
  * Legend verbosity. The header block is a fixed cost of roughly 600-900
  * characters, so a tight budget cannot be met by shrinking grids alone —
  * the prose has to shrink too, or the ceiling is silently breached.
  */
  notesDetail: NotesDetail
  /**
  * True when the outline is the load-bearing channel and the grids are the
  * expendable ones. Carried in the plan rather than re-derived from the regime
  * so degradation has a single input and stays a pure function of the plan.
  */
  outlinePrimary: boolean
  /**
  * False once the overview block has been surrendered. The overview layer is
  * still computed — it supplies the inset window and the entity counts — but
  * its grid is left out of the rendering.
  */
  overviewIncluded: boolean
}

/** Characters one grid cell costs: two-character code plus a separator. */
const CHARS_PER_CELL = 3

/**
 * Share of the budget each block gets before any degradation, per regime.
 *
 * These weights are not taste, they follow from what each channel measurably
 * carries at each scale.
 *
 * For a protein the overview grid is close to empty. A 320-residue chain
 * projected onto 144 cells puts ~2.2 residues in every cell, so the encoder can
 * only emit the dominant entity plus an overflow mark. Measured on a 2240-atom
 * dimer that produced six distinct codes, mostly `A*` and `I*` — "chain A here,
 * chain I there", about one bit. Raising resolution raises token count without
 * raising information. The outline carries the fold instead, so it takes the
 * largest share and the overview is demoted to a bearings anchor.
 *
 * For a crystal or a small molecule the opposite holds: spatial regularity is
 * the signal, deviation from it is the finding, and there is no residue
 * hierarchy to summarise. The grid keeps the majority there.
 */
const SHARES: Record<SceneRegime, { outline: number; overview: number; inset: number }> = {
  biomolecular: { outline: 0.45, overview: 0.15, inset: 0.4 },
  molecular: { outline: 0.2, overview: 0.35, inset: 0.45 },
  periodic: { outline: 0.1, overview: 0.45, inset: 0.45 },
}

export const DEFAULT_SCENE_BUDGET = 2400
const MIN_BUDGET = 200
const MAX_BUDGET = 20000

const MIN_RESOLUTION = 8
const MAX_RESOLUTION = 24

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

/** Largest square resolution whose grid fits in `chars`. */
const resolutionForQuota = (chars: number): number =>
  clamp(Math.floor(Math.sqrt(Math.max(chars, 0) / CHARS_PER_CELL)), MIN_RESOLUTION, MAX_RESOLUTION)

/**
 * Initial allocation. Without a focus the inset's share folds back into the
 * overview, so an unfocused call degrades to exactly one grid — the behavior
 * that existed before foveation.
 *
 * The regime decides which channel is load-bearing, so it decides the shares
 * and the degradation order. Passing it here rather than branching at the call
 * site keeps one canonical allocation policy.
 */
export const planBudget = (
  budget: number,
  hasFocus: boolean,
  regime: SceneRegime = 'molecular',
): BudgetPlan => {
  const total = clamp(Math.floor(budget), MIN_BUDGET, MAX_BUDGET)
  const share = SHARES[regime]
  const gridShare = hasFocus ? share.overview : share.overview + share.inset
  const outlineQuota = total * share.outline
  return {
    budget: total,
    overviewResolution: resolutionForQuota(total * gridShare),
    overviewPinned: false,
    insetResolution: hasFocus ? resolutionForQuota(total * share.inset) : 0,
    outlineDetail: outlineQuota >= 300 ? 'full' : 'compact',
    // Below this the legend alone would eat the whole ceiling.
    notesDetail: total >= 1200 ? 'full' : 'terse',
    // In a biomolecular scene the outline is the only channel that carries the
    // fold, so it is defended to the very end and the grids are surrendered
    // first. Elsewhere the grid is the finding and the order reverses.
    outlinePrimary: regime === 'biomolecular',
    overviewIncluded: true,
  }
}

/**
 * One degradation step, in the order that preserves the most information.
 *
 * Prose goes first: the legend is re-derivable from the tool description,
 * whereas grid cells and outline entries are the only carriers of scene
 * content. Then overview resolution (it supplies bearings only), then inset
 * resolution (atom-level truth, defended longest), then outline detail.
 *
 * Returns null when nothing can be given up, so the caller stops instead of
 * looping forever.
 */
export const degradePlan = (plan: BudgetPlan): BudgetPlan | null => {
  // Prose first in every regime: the legend is re-derivable from the tool
  // description, so it is the only block whose loss costs no scene content.
  if (plan.notesDetail === 'full') return { ...plan, notesDetail: 'terse' }

  const shrinkOverview = (): BudgetPlan | null =>
    !plan.overviewPinned && plan.overviewResolution > MIN_RESOLUTION
      ? { ...plan, overviewResolution: Math.max(MIN_RESOLUTION, plan.overviewResolution - 2) }
      : null
  const shrinkInset = (): BudgetPlan | null =>
    plan.insetResolution > MIN_RESOLUTION
      ? { ...plan, insetResolution: Math.max(MIN_RESOLUTION, plan.insetResolution - 2) }
      : null
  const coarsenOutline = (): BudgetPlan | null => {
    if (plan.outlineDetail === 'full') return { ...plan, outlineDetail: 'compact' }
    if (plan.outlineDetail === 'compact') return { ...plan, outlineDetail: 'minimal' }
    return null
  }
  const dropInset = (): BudgetPlan | null =>
    plan.insetResolution > 0 ? { ...plan, insetResolution: 0 } : null
  const dropOverview = (): BudgetPlan | null =>
    plan.overviewIncluded ? { ...plan, overviewIncluded: false } : null
  const dropOutline = (): BudgetPlan | null =>
    plan.outlineDetail !== 'none' ? { ...plan, outlineDetail: 'none' } : null

  // Two grids at their floor plus a legend still cost ~1300 characters, so a
  // tight ceiling is only reachable by dropping a whole block. Which block goes
  // depends on which one carries the answer.
  //
  // Biomolecular: surrender both grids entirely before touching the outline.
  // A protein overview at any resolution says "chain A here, chain I there";
  // the outline says which residues form which helix. Keeping the grid at the
  // outline's expense would trade the fold for a silhouette.
  //
  // Otherwise: the grid *is* the finding, so it is defended and the outline —
  // which for a crystal is a single line — goes first.
  const order = plan.outlinePrimary
    ? [shrinkOverview, shrinkInset, dropInset, dropOverview, coarsenOutline, dropOutline]
    : [shrinkOverview, shrinkInset, coarsenOutline, dropInset, dropOutline, dropOverview]

  for (const step of order) {
    const next = step()
    if (next !== null) return next
  }
  return null
}
