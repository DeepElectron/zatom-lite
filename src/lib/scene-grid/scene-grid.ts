/**
 * SceneGrid — a low-resolution 2.5D semantic grid projection of an atomic scene.
 *
 * Instead of RGB pixels, every cell holds a depth-sorted stack of atom entities
 * `[atomId, element, depthBin]`. An LLM uses the grid for spatial gestalt
 * reasoning (the "reasoning frame") and the stable atom ids for exact tool
 * operations (the "execution frame").
 *
 * Pure module: plain data in, plain data out. No store, no three.js — vector
 * math is handwritten (same precedent as autoVacuumSlab / heterostructure).
 * Projections are orthographic onto atom centers; at 24x24 resolution the
 * perspective error of a viewer camera is below one cell, so the `current`
 * view reuses the same orthographic pipeline with the user's camera
 * orientation (including roll).
 */

import type { Mat3, Vec3, ZatomStructure } from '../../agent/contracts'
import {
  type BudgetPlan,
  type FocusOrigin,
  type OutlineDetail,
  type ScreenWindow,
  DEFAULT_SCENE_BUDGET,
  degradePlan,
  focusWindow,
  planBudget,
  resolveFocus,
} from './foveate'
import { type OutlineResult, buildOutline } from './outline'
import { type SceneRegime, type SceneRegimeInfo, detectSceneRegime } from './regime'
import {
  type ResidueEntity,
  type ResidueIndex,
  buildResidueIndex,
  lookupResidue,
  residueLabel,
  residueMarker,
} from './residue-index'
import {
  type SiteClass,
  type SiteDeviationResult,
  SITE_MARKER,
  SITE_RANK,
  classifySiteDeviation,
  siteDeviationLines,
  siteDeviationSummary,
} from './site-deviation'
import {
  type MolecularAssembly,
  type MolecularTopology,
  buildMolecularTopology,
  describeMolecularAssembly,
} from './molecular-topology'
import { detectLayers, resolveSurfaceNormal } from './system-semantics'

export type SceneGridView =
  | 'current'
  | 'top'
  | 'front'
  | 'right'
  | 'along_a'
  | 'along_b'
  | 'along_c'
  | 'principal_xy'
  | 'principal_xz'
  | 'principal_yz'

export const SCENE_GRID_VIEWS: SceneGridView[] = [
  'current',
  'top',
  'front',
  'right',
  'along_a',
  'along_b',
  'along_c',
  'principal_xy',
  'principal_xz',
  'principal_yz',
]

export interface ViewerPoseLike {
  position: Vec3
  lookAt: Vec3
  /** Camera world-up; preserves user-authored roll in the current view. */
  up?: Vec3
}

export interface SceneGridOptions {
  view: SceneGridView
  /** Grid width/height in cells. Default 24, clamped to 8..64. */
  resolution?: number
  /** Number of depth buckets. Default 8, clamped to 2..16. */
  depthBins?: number
  /** Max stack entries kept per cell. Default 3, clamped to 1..6. */
  topK?: number
  /** Keep only atoms whose normalized depth falls in [lo, hi] (0 = nearest). */
  depthRange?: [number, number]
  /** Required when view === 'current'. */
  pose?: ViewerPoseLike | null
  /**
  * Force the semantic unit instead of detecting it. Detection is the default
  * because the correct unit follows from the structure, not the caller.
  */
  regime?: SceneRegime | null
  /**
  * Atoms the user has selected. The strongest intent signal in the scene, so
  * it gets its own channel rather than being folded into cell contents.
  */
  selectedAtomIds?: ReadonlySet<string>
  /**
  * Focus for this call, highest precedence. Lets the agent steer its own
  * attention without mutating what the user has selected.
  */
  focusAtomIds?: ReadonlySet<string>
  /** Focus a residue by label, e.g. "HEM C142" or "A93". */
  focusResidue?: string
  /**
  * Hard character ceiling for the whole rendering. Detail is spent where the
  * focus is, so raising this buys resolution near the focus, not everywhere.
  */
  budget?: number
  /**
  * Emit the hierarchical outline. Default true for residue scenes, where a
  * per-atom grid is mostly noise and the outline carries the topology.
  */
  outline?: boolean
}

/** [atomId, element, depthBin] — depthBin 0 is nearest to the viewer. */
export type SceneGridStackEntry = [string, string, number]

export interface SceneGridCell {
  xy: [number, number]
  stack: SceneGridStackEntry[]
  /** Atoms actually occupying this cell, before topK truncation. */
  atomCount: number
  /**
  * Two-character cell code: entity marker + density digit ('*' = 10 or more).
  * Density is per-cell so truncation can never hide behind a bare '+'.
  */
  code: string
  /** Entity label for the dominant occupant, e.g. "HEM C142" or "Fe". */
  label: string
  /** True when any atom in this cell is selected. */
  selected: boolean
}

/** Where the user's selection lands, so the LLM sees the current intent. */
export interface SceneGridFocus {
  atomCount: number
  /** Grid cells the selection occupies. */
  cells: [number, number][]
  /** Entity summaries, e.g. "HEM C142 (ligand, 43 atoms, C34 N4 O4 Fe)". */
  entities: string[]
  /** How the focus was chosen — never left implicit. */
  origin: FocusOrigin
  label: string
}

/**
 * A second grid over a small window around the focus. Same character cost as
 * the overview but ~10x the spatial resolution, which is what turns a crowded
 * cell into an atom-level one.
 */
export interface SceneGridInset {
  resolution: [number, number]
  /** Window in screen A, so the LLM can convert cell steps to distances. */
  window: ScreenWindow
  /** A per cell — the scale bar that makes the grid metric, not just topological. */
  angstromsPerCell: number
  cells: SceneGridCell[]
  /** Overview cells the inset covers, for cross-referencing the two layers. */
  overviewRect: [number, number, number, number]
  atomsProjected: number
}

/** What the budget was spent on, so an over-budget scene degrades visibly. */
export interface SceneBudgetReport {
  requested: number
  used: number
  overviewResolution: number
  insetResolution: number
  outlineDetail: OutlineDetail
  /** Degradation steps applied to fit the budget. */
  degraded: number
}

export interface SceneGridResult {
  view: SceneGridView
  resolution: [number, number]
  depthBins: number
  topK: number
  /** Which semantic lens produced this grid — never left implicit. */
  regime: SceneRegimeInfo
  /** Sparse: only non-empty cells, ordered row-major (y, then x). */
  cells: SceneGridCell[]
  /** Human/LLM-readable row rendering with legend. */
  ascii: string
  /** Cell marker (element@x,y of the stack top) -> atom id. */
  legend: Record<string, string>
  /** Cells whose stack lost entries to topK truncation. */
  truncatedCells: number
  /** Selection channel; null when nothing is selected. */
  focus: SceneGridFocus | null
  /** High-resolution second layer around the focus; null when unfocused. */
  inset: SceneGridInset | null
  /** Hierarchical entity outline; null outside residue scenes. */
  outline: OutlineResult | null
  /** Where the character budget went. */
  budget: SceneBudgetReport
  /** Distinct entities visible at this scale (chains, ligands, waters). */
  entityCounts: Record<string, number>
  atomsProjected: number
  atomsTotal: number
}

export interface SceneProbeAtom {
  atomId: string
  element: string
  depthBin: number
  /** Normalized depth in 0..1 (0 = nearest). */
  depth: number
  worldPosition: Vec3
  fractional: Vec3 | null
  selected: boolean
}

export interface SceneProbeResult {
  xy: [number, number]
  view: SceneGridView
  /** Full stack, depth ascending, never truncated by topK. */
  stack: SceneProbeAtom[]
}

export interface SceneGridViewAvailability {
  view: SceneGridView
  available: boolean
  reason?: string
}

/* ------------------------------------------------------------------ */
/* Vector math                                                         */
/* ------------------------------------------------------------------ */

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

const norm = (a: Vec3): number => Math.sqrt(dot(a, a))

const normalize = (a: Vec3): Vec3 => {
  const n = norm(a)
  if (n < 1e-12) return [0, 0, 1]
  return [a[0] / n, a[1] / n, a[2] / n]
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

interface ScreenBasis {
  right: Vec3
  up: Vec3
  /** Unit view direction, pointing into the screen. */
  forward: Vec3
}

/** Standard camera basis (gluLookAt convention): right = f x up, up = right x f. */
const basisFromForward = (forward: Vec3, upHint?: Vec3): ScreenBasis => {
  const f = normalize(forward)
  let hint: Vec3 = upHint ?? [0, 0, 1]
  if (Math.abs(dot(f, normalize(hint))) > 0.95) hint = Math.abs(f[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0]
  const right = normalize(cross(f, hint))
  const up = normalize(cross(right, f))
  return { right, up, forward: f }
}

/* ------------------------------------------------------------------ */
/* Principal axes (Jacobi eigen decomposition of the covariance)       */
/* ------------------------------------------------------------------ */

/** Eigenvectors of a symmetric 3x3 matrix, columns sorted by eigenvalue desc. */
const symmetricEigenvectors = (m: number[][]): { values: number[]; vectors: Vec3[] } => {
  // Jacobi rotation; matrices here are tiny so convergence is immediate.
  const a = m.map((row) => [...row])
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q]
    if (off < 1e-18) break
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        const app = a[p][p]
        const aqq = a[q][q]
        const apq = a[p][q]
        a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq
        a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq
        a[p][q] = 0
        a[q][p] = 0
        for (let k = 0; k < 3; k++) {
          if (k !== p && k !== q) {
            const akp = a[k][p]
            const akq = a[k][q]
            a[k][p] = c * akp - s * akq
            a[p][k] = a[k][p]
            a[k][q] = s * akp + c * akq
            a[q][k] = a[k][q]
          }
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i])
  const vectors = order.map((i) => [v[0][i], v[1][i], v[2][i]] as Vec3)
  return { values: order.map((i) => a[i][i]), vectors }
}

const principalAxes = (positions: Vec3[]): Vec3[] => {
  const n = positions.length
  const c: Vec3 = [0, 0, 0]
  for (const p of positions) {
    c[0] += p[0] / n
    c[1] += p[1] / n
    c[2] += p[2] / n
  }
  const centered = positions.map((p) => sub(p, c))
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const d of centered) {
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (d[i] * d[j]) / n
  }
  const vectors = symmetricEigenvectors(cov).vectors
  // Deterministic, rotation-invariant sign: orient each axis so the point
  // cloud's third moment (skewness) along it is positive. A world-axis rule
  // would flip axes under rigid rotation and mirror the grid pattern.
  return vectors.map((vec) => {
    let skew = 0
    for (const d of centered) {
      const t = dot(d, vec)
      skew += t * t * t
    }
    if (Math.abs(skew) > 1e-9) return skew < 0 ? ([-vec[0], -vec[1], -vec[2]] as Vec3) : vec
    // Symmetric distribution along this axis: fall back to a fixed world rule.
    let maxIdx = 0
    for (let k = 1; k < 3; k++) if (Math.abs(vec[k]) > Math.abs(vec[maxIdx])) maxIdx = k
    return vec[maxIdx] < 0 ? ([-vec[0], -vec[1], -vec[2]] as Vec3) : vec
  })
}

/* ------------------------------------------------------------------ */
/* View resolution                                                     */
/* ------------------------------------------------------------------ */

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

interface ResolvedOptions {
  resolution: number
  /** True when the caller pinned the resolution, which outranks the budget plan. */
  resolutionExplicit: boolean
  depthBins: number
  topK: number
  depthRange: [number, number]
}

const resolveOptions = (options: SceneGridOptions): ResolvedOptions => {
  const resolutionExplicit = options.resolution !== undefined
  const resolution = clamp(Math.round(options.resolution ?? 24), 8, 64)
  const depthBins = clamp(Math.round(options.depthBins ?? 8), 2, 16)
  const topK = clamp(Math.round(options.topK ?? 3), 1, 6)
  let depthRange: [number, number] = [0, 1]
  if (options.depthRange) {
    const lo = clamp(options.depthRange[0], 0, 1)
    const hi = clamp(options.depthRange[1], 0, 1)
    depthRange = lo <= hi ? [lo, hi] : [hi, lo]
  }
  return { resolution, resolutionExplicit, depthBins, topK, depthRange }
}

export class SceneGridError extends Error {}

const latticeAxis = (lattice: Mat3 | undefined, index: 0 | 1 | 2, view: string): Vec3 => {
  if (!lattice) {
    throw new SceneGridError(
      `View "${view}" projects along a lattice axis, but this structure has no lattice. ` +
        'Use top/front/right or a principal_* view for molecules and clusters.',
    )
  }
  const axis = lattice[index]
  if (norm(axis) < 1e-9) throw new SceneGridError(`Lattice axis ${'abc'[index]} is degenerate.`)
  return axis
}

const resolveBasis = (structure: ZatomStructure, options: SceneGridOptions): ScreenBasis => {
  const view = options.view
  const lattice = structure.lattice?.vectors
  switch (view) {
    case 'top':
      return basisFromForward([0, 0, -1], [0, 1, 0])
    case 'front':
      return basisFromForward([0, 1, 0], [0, 0, 1])
    case 'right':
      return basisFromForward([-1, 0, 0], [0, 0, 1])
    case 'along_a':
      return basisFromForward(latticeAxis(lattice, 0, view))
    case 'along_b':
      return basisFromForward(latticeAxis(lattice, 1, view))
    case 'along_c':
      return basisFromForward(latticeAxis(lattice, 2, view))
    case 'current': {
      const pose = options.pose
      if (!pose) {
        throw new SceneGridError(
          'View "current" needs the live viewer pose, which is unavailable here. ' +
            'Use a canonical view (top/front/right/along_*/principal_*) instead.',
        )
      }
      const forward = sub(pose.lookAt, pose.position)
      if (norm(forward) < 1e-9) throw new SceneGridError('Viewer pose is degenerate (position equals lookAt).')
      return basisFromForward(forward, pose.up)
    }
    case 'principal_xy':
    case 'principal_xz':
    case 'principal_yz': {
      if (structure.atoms.length < 3) {
        throw new SceneGridError('Principal-axis views need at least 3 atoms to define an inertia frame.')
      }
      const [e1, e2, e3] = principalAxes(structure.atoms.map((a) => a.position))
      if (view === 'principal_xy') return { right: e1, up: e2, forward: e3 }
      if (view === 'principal_xz') return { right: e1, up: e3, forward: e2 }
      return { right: e2, up: e3, forward: e1 }
    }
    default:
      throw new SceneGridError(`Unknown view "${String(view)}".`)
  }
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

interface ProjectedAtom {
  atomId: string
  element: string
  cellX: number
  cellY: number
  depth: number
  depthBin: number
  worldPosition: Vec3
  /** Screen-space coordinates (Å) along the basis right/up axes. */
  u: number
  v: number
}

export interface ProjectionResult {
  projected: ProjectedAtom[]
  basis: ScreenBasis
  /** The window actually mapped — auto-fit when the caller passed none. */
  window: ScreenWindow
  /**
  * World length one cell spans. Without this, "adjacent in the grid" could
  * mean 2 Å or 20 Å and the reader has no way to tell.
  */
  angstromsPerCell: number
  /** Atoms dropped for falling outside an explicit window. */
  clipped: number
}

const projectAtoms = (
  structure: ZatomStructure,
  options: SceneGridOptions,
  resolved: ResolvedOptions,
  window?: ScreenWindow,
): ProjectionResult => {
  const basis = resolveBasis(structure, options)
  const atoms = structure.atoms
  const emptyWindow: ScreenWindow = window ?? { uCenter: 0, vCenter: 0, half: 1e-9 }
  if (atoms.length === 0) {
    return {
      projected: [],
      basis,
      window: emptyWindow,
      angstromsPerCell: (2 * emptyWindow.half) / resolved.resolution,
      clipped: 0,
    }
  }

  const us: number[] = new Array(atoms.length)
  const vs: number[] = new Array(atoms.length)
  const ds: number[] = new Array(atoms.length)
  let uMin = Infinity
  let uMax = -Infinity
  let vMin = Infinity
  let vMax = -Infinity
  let dMin = Infinity
  let dMax = -Infinity
  for (let i = 0; i < atoms.length; i++) {
    const p = atoms[i].position
    const u = dot(p, basis.right)
    const v = dot(p, basis.up)
    const d = dot(p, basis.forward)
    us[i] = u
    vs[i] = v
    ds[i] = d
    if (u < uMin) uMin = u
    if (u > uMax) uMax = u
    if (v < vMin) vMin = v
    if (v > vMax) vMax = v
    if (d < dMin) dMin = d
    if (d > dMax) dMax = d
  }

  // One shared scale for u and v keeps the aspect ratio of the scene.
  // Depth normalization always spans the whole scene so depth bins stay
  // comparable between an overview and an inset cut from it.
  const res = resolved.resolution
  const autoHalf = Math.max(uMax - uMin, vMax - vMin, 1e-9) / 2
  const mapped: ScreenWindow = window ?? {
    uCenter: (uMin + uMax) / 2,
    vCenter: (vMin + vMax) / 2,
    half: autoHalf,
  }
  const half = Math.max(mapped.half, 1e-9)
  const extent = 2 * half
  const depthSpan = Math.max(dMax - dMin, 1e-9)

  const projected: ProjectedAtom[] = []
  let clipped = 0
  for (let i = 0; i < atoms.length; i++) {
    const depthT = (ds[i] - dMin) / depthSpan
    if (depthT < resolved.depthRange[0] - 1e-9 || depthT > resolved.depthRange[1] + 1e-9) continue

    const uOffset = us[i] - (mapped.uCenter - half)
    const vOffset = mapped.vCenter + half - vs[i]
    // An explicit window clips; the auto-fit window cannot, so clamping there
    // only guards floating-point edges and keeps existing behavior identical.
    if (window !== undefined) {
      if (uOffset < 0 || uOffset > extent || vOffset < 0 || vOffset > extent) {
        clipped++
        continue
      }
    }
    const cellX = clamp(Math.floor((uOffset / extent) * res), 0, res - 1)
    // Grid y grows downward (row 0 at the top of the view).
    const cellY = clamp(Math.floor((vOffset / extent) * res), 0, res - 1)
    projected.push({
      atomId: atoms[i].id,
      element: atoms[i].element,
      cellX,
      cellY,
      depth: depthT,
      depthBin: Math.min(resolved.depthBins - 1, Math.floor(depthT * resolved.depthBins)),
      worldPosition: atoms[i].position,
      u: us[i],
      v: vs[i],
    })
  }
  return { projected, basis, window: mapped, angstromsPerCell: extent / res, clipped }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Density digit: 1..9 literal, '*' for 10 or more. Never hides a count. */
const densityDigit = (count: number): string => (count >= 10 ? '*' : String(count))

/**
 * Entity marker for one cell's dominant occupant.
 *
 * At biomolecular scale the dominant occupant is the residue with the most
 * atoms in the cell — a chain letter for polymers, a class marker for ligands,
 * waters and metals. At molecular scale it stays the element symbol, which is
 * the correct variable when atom count is small.
 */
const cellEntity = (
  atoms: ProjectedAtom[],
  regime: SceneRegime,
  residueIndex: ResidueIndex | null,
  siteDeviation: Map<string, SiteClass> | null,
): { marker: string; label: string } => {
  if (regime === 'periodic' && siteDeviation) {
    // A perfect crystal is redundant per-atom: the information lives in where
    // atoms depart from bulk coordination. Report the most notable departure in
    // the cell, so defects and terminations surface instead of uniform symbols.
    let worst: SiteClass = 'bulk'
    let worstAtom = atoms[0]
    for (const atom of atoms) {
      const cls = siteDeviation.get(atom.atomId) ?? 'bulk'
      if (SITE_RANK[cls] > SITE_RANK[worst]) {
        worst = cls
        worstAtom = atom
      }
    }
    return {
      marker: worst === 'bulk' ? worstAtom.element : SITE_MARKER[worst],
      label: worst === 'bulk' ? `${worstAtom.element} (bulk)` : `${worstAtom.element} (${worst})`,
    }
  }

  if (regime === 'molecular' || !residueIndex || residueIndex.residueCount === 0) {
    // Nearest atom's element: the stack is already depth-sorted.
    const nearest = atoms[0]
    return { marker: nearest.element, label: nearest.element }
  }

  // Dominant residue by atom count within this cell; ties break on depth so the
  // result is deterministic and favours what the viewer sees first.
  const counts = new Map<string, number>()
  for (const atom of atoms) {
    const key = residueIndex.residueByAtomId.get(atom.atomId)
    if (key === undefined) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size === 0) {
    const nearest = atoms[0]
    return { marker: nearest.element, label: nearest.element }
  }

  let bestKey = ''
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  const residue = residueIndex.residues.get(bestKey)
  if (!residue) {
    const nearest = atoms[0]
    return { marker: nearest.element, label: nearest.element }
  }
  return { marker: residueMarker(residue), label: residueLabel(residue) }
}

/** Entity summary line for the focus channel. */
const entitySummary = (residue: ResidueEntity): string =>
  `${residueLabel(residue)} (${residue.entityClass}, ${residue.atomCount} atoms, ${residue.composition})`

interface AssembledLayer {
  cells: SceneGridCell[]
  legend: Record<string, string>
  entityCounts: Record<string, number>
  truncatedCells: number
  markedCells: [number, number][]
}

/**
 * Bin projected atoms into one uniform grid layer.
 *
 * Shared by the overview and the inset: the layers differ only in the window
 * they were projected through, never in how a cell is encoded, so a given code
 * means the same thing in both and the reader can cross-reference them.
 */
const assembleLayer = (
  projected: readonly ProjectedAtom[],
  resolution: number,
  topK: number,
  regime: SceneRegime,
  residueIndex: ResidueIndex | null,
  siteByAtomId: Map<string, SiteClass> | null,
  markedAtomIds: ReadonlySet<string>,
): AssembledLayer => {
  const byCell = new Map<number, ProjectedAtom[]>()
  for (const atom of projected) {
    const key = atom.cellY * resolution + atom.cellX
    const list = byCell.get(key)
    if (list) list.push(atom)
    else byCell.set(key, [atom])
  }

  const cells: SceneGridCell[] = []
  const legend: Record<string, string> = {}
  const entityCounts: Record<string, number> = {}
  const markedCells: [number, number][] = []
  let truncatedCells = 0

  for (const key of [...byCell.keys()].sort((a, b) => a - b)) {
    const list = byCell.get(key)!
    list.sort((a, b) => a.depth - b.depth)
    if (list.length > topK) truncatedCells++
    const kept = list.slice(0, topK)
    const x = key % resolution
    const y = Math.floor(key / resolution)

    const { marker, label } = cellEntity(list, regime, residueIndex, siteByAtomId)
    const selected = list.some((a) => markedAtomIds.has(a.atomId))
    if (selected) markedCells.push([x, y])
    entityCounts[marker] = (entityCounts[marker] ?? 0) + 1

    cells.push({
      xy: [x, y],
      stack: kept.map((a) => [a.atomId, a.element, a.depthBin]),
      atomCount: list.length,
      code: `${marker}${densityDigit(list.length)}`,
      label,
      selected,
    })
    legend[`${kept[0].element}@${x},${y}`] = kept[0].atomId
  }
  return { cells, legend, entityCounts, truncatedCells, markedCells }
}

/** Map a screen coordinate to a cell index inside a projected window. */
const cellIndexFor = (value: number, center: number, half: number, resolution: number): number =>
  clamp(Math.floor(((value - (center - half)) / (2 * half)) * resolution), 0, resolution - 1)

export const buildSceneGrid = (structure: ZatomStructure, options: SceneGridOptions): SceneGridResult => {
  const resolved = resolveOptions(options)
  const regime = detectSceneRegime(structure, options.regime ?? null)
  const residueIndex = regime.unit === 'residue' ? buildResidueIndex(structure) : null
  // Deviation classification is the periodic regime's whole point, so it is
  // computed only there — an O(N) neighbor pass we skip for other lenses.
  //
  // A periodic cell full of small bonded fragments (a water box, a molecular
  // crystal, a solvated ion) has molecules for units, not lattice sites: its
  // "site classes" would be factually right (O bulkCN=2) and conceptually
  // wrong. Such a scene keeps the periodic lens for the grid but takes the
  // molecular channel (formula per fragment, fragment count) for its frame.
  const assembly = regime.unit === 'site' ? describeMolecularAssembly(structure) : null
  const siteDeviation = regime.unit === 'site' && !assembly ? classifySiteDeviation(structure) : null
  // A degenerate (no shell) or disordered (no dominant CN) classification still
  // gets its summary line in the header, but must not drive markers: an empty
  // map would label every cell "(bulk)" and tell a lattice story about a gas.
  const siteMarkers =
    siteDeviation && !siteDeviation.degenerate && !siteDeviation.disordered ? siteDeviation.byAtomId : null
  const selectedAtomIds = options.selectedAtomIds ?? new Set<string>()

  // Focus is resolved before anything is drawn, because it decides how the
  // character budget is split rather than merely being highlighted.
  const focusInfo = resolveFocus(
    {
      focusAtomIds: options.focusAtomIds,
      focusResidue: options.focusResidue,
      selectedAtomIds,
    },
    (label) => lookupResidue(residueIndex, label),
  )
  const focusAtomIds = focusInfo.atomIds
  const hasFocus = focusAtomIds.size > 0
  const wantOutline = options.outline ?? regime.unit === 'residue'
  const outlineSource = wantOutline && residueIndex ? residueIndex : null

  const requestedBudget = options.budget ?? DEFAULT_SCENE_BUDGET
  let plan = planBudget(requestedBudget, hasFocus, regime.regime)
  // An explicitly pinned resolution outranks the plan: the caller asked for a
  // specific grid and silently shrinking it would be a wrong answer. The pin is
  // recorded in the plan so degradation skips that step; re-applying it after
  // each step instead would undo the step and spin the loop below forever.
  if (resolved.resolutionExplicit) {
    plan = { ...plan, overviewResolution: resolved.resolution, overviewPinned: true }
  }

  const plannerNotes: PlannerNotes = { insetSkipped: null, uniformBulk: null, assembly }

  // Foveation invariant: an inset exists to be finer than the overview. On a
  // small scene the padded focus window can span the whole overview, and the
  // planner would then have shrunk the overview to pay for a zoom that shows
  // the same field at the same or coarser scale. Probe once and, if so, fold the
  // inset's budget back into a single grid; the focus stays marked.
  const probe = projectAtoms(structure, options, { ...resolved, resolution: plan.overviewResolution })
  const sceneExtent = 2 * probe.window.half
  if (hasFocus && plan.insetResolution > 0) {
    const window = focusWindow(probe.projected, focusAtomIds)
    const singleGrid = planBudget(requestedBudget, false, regime.regime)
    const singleScale = sceneExtent / singleGrid.overviewResolution
    const insetScale = window ? (2 * window.half) / plan.insetResolution : Infinity
    if (insetScale > singleScale / MIN_INSET_GAIN) {
      plan = resolved.resolutionExplicit
        ? { ...singleGrid, overviewResolution: resolved.resolution, overviewPinned: true }
        : singleGrid
      plannerNotes.insetSkipped =
        `# inset skipped: focus window (${(2 * (window?.half ?? 0)).toFixed(0)} A) covers the whole ` +
        `${sceneExtent.toFixed(0)} A scene, so one grid is the finer rendering`
    }
  }

  // Cells finer than an atom buy nothing: at 0.2 A/cell a benzene ring is six
  // symbols in a field of 570 dots, and the budget spent on the dots is taken
  // from the legend. Cap the grid so a cell is never smaller than MIN_CELL_A.
  if (!resolved.resolutionExplicit) {
    const maxResolution = Math.max(MIN_PLANNED_RESOLUTION, Math.ceil(sceneExtent / MIN_CELL_A))
    if (plan.overviewResolution > maxResolution) {
      plan = { ...plan, overviewResolution: maxResolution }
    }
  }

  // A perfect crystal carries its information in the deviations, and there are
  // none: 2000 characters of "Cu1" cells say only "every atom is bulk". The grid
  // drops to its floor as a bearings anchor and the lattice line carries the
  // structure. A focus or a pinned resolution means the caller wants to see
  // cells, so the collapse is skipped.
  if (
    siteDeviation &&
    !siteDeviation.degenerate &&
    !hasFocus &&
    !resolved.resolutionExplicit &&
    siteDeviation.counts.bulk === structure.atoms.length
  ) {
    plan = { ...plan, overviewResolution: UNIFORM_BULK_RESOLUTION }
    plannerNotes.uniformBulk =
      `# uniform bulk: all ${structure.atoms.length} atoms at bulk coordination; ` +
      `grid reduced to ${UNIFORM_BULK_RESOLUTION}x${UNIFORM_BULK_RESOLUTION} (no deviations to show) — read the lattice line`
  }

  const compose = (current: BudgetPlan) => {
    const overviewOptions: ResolvedOptions = { ...resolved, resolution: current.overviewResolution }
    const overviewProjection = projectAtoms(structure, options, overviewOptions)
    const overview = assembleLayer(
      overviewProjection.projected,
      current.overviewResolution,
      resolved.topK,
      regime.regime,
      residueIndex,
      siteMarkers,
      focusAtomIds,
    )

    // Inset: same camera, a ~10x smaller window. That is what turns a crowded
    // cell into a roughly one-atom cell, making the symbol identify a specific
    // atom instead of sampling a fixed elemental distribution.
    let inset: SceneGridInset | null = null
    if (hasFocus && current.insetResolution > 0) {
      const window = focusWindow(overviewProjection.projected, focusAtomIds)
      if (window) {
        const insetOptions: ResolvedOptions = { ...resolved, resolution: current.insetResolution }
        const insetProjection = projectAtoms(structure, options, insetOptions, window)
        const layer = assembleLayer(
          insetProjection.projected,
          current.insetResolution,
          resolved.topK,
          regime.regime,
          residueIndex,
          siteMarkers,
          focusAtomIds,
        )
        const ov = overviewProjection.window
        const res = current.overviewResolution
        inset = {
          resolution: [current.insetResolution, current.insetResolution],
          window,
          angstromsPerCell: insetProjection.angstromsPerCell,
          cells: layer.cells,
          overviewRect: [
            cellIndexFor(window.uCenter - window.half, ov.uCenter, ov.half, res),
            cellIndexFor(window.vCenter - window.half, ov.vCenter, ov.half, res),
            cellIndexFor(window.uCenter + window.half, ov.uCenter, ov.half, res),
            cellIndexFor(window.vCenter + window.half, ov.vCenter, ov.half, res),
          ],
          atomsProjected: insetProjection.projected.length,
        }
      }
    }

    const outline = outlineSource
      ? buildOutline(outlineSource, current.outlineDetail, { structure })
      : null
    // The molecular regime's "outline" is the bond graph; it degrades through
    // the same outlineDetail steps so one plan drives every channel.
    const topology =
      regime.regime === 'molecular' ? buildMolecularTopology(structure, current.outlineDetail) : null
    return { overviewProjection, overview, inset, outline, topology }
  }

  let composed = compose(plan)
  let ascii = renderScene(
    composed,
    resolved,
    options.view,
    regime,
    structure,
    residueIndex,
    focusInfo,
    siteDeviation,
    plan,
    plannerNotes,
  )
  // The budget is a ceiling, so it is checked against the real string rather
  // than estimated, and degradation repeats until it fits or nothing is left.
  // The richest rendering is kept so it can be restored: a pinned resolution can
  // make the overview alone exceed the ceiling, and then every step — including
  // dropping the inset — spends information without ever reaching the budget.
  const richest = { plan, composed, ascii }
  let degraded = 0
  while (ascii.length > plan.budget) {
    const next = degradePlan(plan)
    if (!next) break
    plan = next
    degraded++
    composed = compose(plan)
    ascii = renderScene(
      composed,
      resolved,
      options.view,
      regime,
      structure,
      residueIndex,
      focusInfo,
      siteDeviation,
      plan,
      plannerNotes,
    )
  }
  // Never pay information for a ceiling that was not reached.
  if (degraded > 0 && ascii.length > plan.budget) {
    plan = richest.plan
    composed = richest.composed
    ascii = richest.ascii
    degraded = 0
  }

  const focus: SceneGridFocus | null = hasFocus
    ? {
        atomCount: focusAtomIds.size,
        cells: composed.overview.markedCells,
        entities: focusEntities(residueIndex, focusAtomIds),
        origin: focusInfo.origin,
        label: focusInfo.label,
      }
    : null

  return {
    view: options.view,
    resolution: [plan.overviewResolution, plan.overviewResolution],
    depthBins: resolved.depthBins,
    topK: resolved.topK,
    regime,
    cells: composed.overview.cells,
    ascii,
    legend: composed.overview.legend,
    truncatedCells: composed.overview.truncatedCells,
    focus,
    inset: composed.inset,
    outline: composed.outline,
    budget: {
      requested: requestedBudget,
      used: ascii.length,
      overviewResolution: plan.overviewResolution,
      insetResolution: composed.inset ? plan.insetResolution : 0,
      outlineDetail: plan.outlineDetail,
      degraded,
    },
    entityCounts: composed.overview.entityCounts,
    atomsProjected: composed.overviewProjection.projected.length,
    atomsTotal: structure.atoms.length,
  }
}

/** Entity summaries for the focused atoms, deduplicated by residue. */
const focusEntities = (index: ResidueIndex | null, atomIds: ReadonlySet<string>): string[] => {
  if (!index) return []
  const entities: string[] = []
  const seen = new Set<string>()
  for (const atomId of atomIds) {
    const key = index.residueByAtomId.get(atomId)
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    const residue = index.residues.get(key)
    if (residue) entities.push(entitySummary(residue))
  }
  return entities
}

interface ComposedScene {
  overviewProjection: ProjectionResult
  overview: AssembledLayer
  inset: SceneGridInset | null
  outline: OutlineResult | null
  /** Bond graph channel; molecular regime only. */
  topology: MolecularTopology | null
}

/**
 * Notes about what the planner decided *not* to draw. Each is printed in the
 * header: an absence the model cannot see is an absence it will misread.
 */
interface PlannerNotes {
  /** Set when a focus was given but an inset would not have been finer than the overview. */
  insetSkipped: string | null
  /** Set when every site is bulk and the grid was shrunk to its floor. */
  uniformBulk: string | null
  /** Set when a periodic cell holds molecules rather than lattice sites. */
  assembly: MolecularAssembly | null
}

/** Marker for empty overview cells the inset covers, so the zoom is locatable. */
const INSET_COVER = '\u2593'

/**
 * Render one uniform layer as a character matrix.
 *
 * Every cell occupies the same width, because the reader locates a cell by
 * counting fixed-width columns — a ragged grid would make column arithmetic
 * unreliable, which is the whole reason a genuine quadtree is not used here.
 */
const renderLayer = (
  cells: readonly SceneGridCell[],
  resolution: number,
  coverRect: [number, number, number, number] | null,
): string[] => {
  const marks = new Map<number, string>()
  let width = 1
  for (const cell of cells) {
    const [x, y] = cell.xy
    // Focus is bracketed so the attended region is visible in the grid itself.
    const mark = cell.selected ? `[${cell.code}]` : cell.code
    marks.set(y * resolution + x, mark)
    if (mark.length > width) width = mark.length
  }
  const pad = (s: string): string => s.padEnd(width, ' ')
  const rows: string[] = []
  for (let y = 0; y < resolution; y++) {
    const row: string[] = []
    for (let x = 0; x < resolution; x++) {
      const mark = marks.get(y * resolution + x)
      if (mark !== undefined) {
        row.push(pad(mark))
        continue
      }
      // Empty cells inside the inset rect are marked instead of overwriting
      // occupied ones, so showing the zoom region never costs information.
      const covered =
        coverRect !== null &&
        x >= coverRect[0] &&
        x <= coverRect[2] &&
        y >= coverRect[1] &&
        y <= coverRect[3]
      row.push(pad(covered ? INSET_COVER : '.'))
    }
    rows.push(row.join(' '))
  }
  return rows
}

const renderScene = (
  composed: ComposedScene,
  resolved: ResolvedOptions,
  view: SceneGridView,
  regime: SceneRegimeInfo,
  structure: ZatomStructure,
  residueIndex: ResidueIndex | null,
  focusInfo: FocusResolutionLike,
  siteDeviation: SiteDeviationResult | null,
  plan: BudgetPlan,
  plannerNotes: PlannerNotes,
): string => {
  const { overview, overviewProjection, inset, outline, topology } = composed
  const atomsTotal = structure.atoms.length
  const res = plan.overviewResolution
  const atomsProjected = overviewProjection.projected.length

  const header =
    `# scene-grid regime=${regime.regime} unit=${regime.unit} view=${view} ` +
    `resolution=${res}x${res} scale=${overviewProjection.angstromsPerCell.toFixed(2)}A/cell ` +
    `depthBins=${resolved.depthBins} atoms=${atomsProjected}/${atomsTotal} ` +
    `focus=${focusInfo.origin}`

  const terse = plan.notesDetail === 'terse'

  const codeNote =
    regime.unit === 'residue'
      ? '# cell = [chain letter | h=ligand w=water m=metal i=ion] + atom count ("*" = 10+)'
      : '# cell = element symbol + atom count in cell ("*" = 10+)'

  // Under a tight ceiling only the legend that makes cells decodable survives;
  // the rest is recoverable from the tool description, the grid content is not.
  const notes = terse
    ? [codeNote, '# "." = empty; "[..]" = focused; y down; count is exact']
    : [
        `# lens: ${regime.reason}${regime.overridden ? ' [caller override]' : ''}`,
        codeNote,
        '# "." = empty; "[..]" = focused atoms; y grows downward',
        '# density is per-cell, so a cell never hides atoms: trust the digit',
        '# scene_probe_cell(x, y) -> exact atom ids; scene_contacts(...) -> true 3D distances',
      ]

  if (!terse && residueIndex && residueIndex.residueCount > 0) {
    notes.push(
      `# entities: ${residueIndex.residueCount} residues across chains [${residueIndex.chainIds.join(' ')}]`,
    )
  }
  if (siteDeviation || plannerNotes.assembly) {
    // The lattice is the periodic regime's structural summary: what the grid
    // cannot show (the third axis, the angles) and what a uniform-bulk scene
    // reduces to entirely.
    const lattice = latticeLine(structure)
    if (lattice) notes.push(lattice)
    const slab = slabLine(structure)
    if (slab) notes.push(slab)
  }
  if (plannerNotes.assembly) notes.push(plannerNotes.assembly.text)
  if (siteDeviation) {
    notes.push(`# sites: ${siteDeviationSummary(siteDeviation)}`)
    if (!terse && !siteDeviation.degenerate && !siteDeviation.disordered) {
      notes.push('# markers: # bulk, : subsurface, S surface, E edge, A adatom, X foreign element')
    }
    // The executive frame for the periodic regime: which ids deviate, and what
    // each adsorbate is bonded to. These ship even under `terse` because they
    // are what the model acts on; only the legend is optional.
    notes.push(...siteDeviationLines(siteDeviation))
  }
  if (plannerNotes.uniformBulk) notes.push(plannerNotes.uniformBulk)
  if (plannerNotes.insetSkipped) notes.push(plannerNotes.insetSkipped)
  if (focusInfo.origin === 'unmatched') {
    // A failed focus request is reported even under a tight ceiling: the caller
    // asked for a region and got the whole scene instead, and must not read the
    // result as if the request had been honoured.
    notes.push(`# FOCUS REQUEST FAILED: ${focusInfo.label} — showing whole scene`)
    if (residueIndex && residueIndex.residueCount > 0) {
      notes.push('# use a label exactly as the outline prints it, e.g. "HEM A201", or a bare name "HEM"')
    }
  } else if (focusInfo.origin !== 'none') {
    notes.push(`# focus: ${focusInfo.label} (via ${focusInfo.origin})`)
    for (const entity of focusEntitiesFor(residueIndex, focusInfo).slice(0, terse ? 2 : 6)) {
      notes.push(`#   ${entity}`)
    }
  } else if (!terse) {
    notes.push('# no focus: pass focusResidue or focusAtomIds to spend detail on a region')
  }

  const overviewBlock: string[] = plan.overviewIncluded
    ? [
        `# --- overview ${res}x${res} · ${overviewProjection.angstromsPerCell.toFixed(2)} A/cell ` +
          `· truncatedStacks=${overview.truncatedCells}` +
          // A protein overview is a silhouette, not a reading: say so where the
          // number is, so the density is never mistaken for resolvable detail.
          (plan.outlinePrimary ? ' · bearings only, read the outline for structure' : '') +
          ' ---',
        ...renderLayer(overview.cells, res, inset?.overviewRect ?? null),
      ]
    : // Omission is stated, never implied. Silence here would read as an empty
      // scene rather than as a block that was traded away for the outline.
      [`# --- overview omitted (budget ${plan.budget}); ${atomsProjected} atoms are present ---`]

  const insetBlock: string[] = []
  if (inset) {
    const [x0, y0, x1, y1] = inset.overviewRect
    insetBlock.push(
      `# --- inset ${inset.resolution[0]}x${inset.resolution[1]} · ` +
        `${inset.angstromsPerCell.toFixed(2)} A/cell · covers overview x${x0}-${x1} y${y0}-${y1} ` +
        `(marked ${INSET_COVER}) · atoms=${inset.atomsProjected} ---`,
      ...renderLayer(inset.cells, inset.resolution[0], null),
    )
  }

  // `outlineDetail: 'none'` returns a populated object with empty text, so guard
  // on the text itself; otherwise the last degradation step still pays for a header.
  const outlineBlock: string[] = []
  if (outline && outline.text.length > 0) {
    outlineBlock.push(
      `# --- outline (${plan.outlineDetail})` +
        (outline.secondaryStructureEstimated ? ' · secondary structure = geometry estimate, not DSSP' : '') +
        ' ---',
      outline.text,
    )
  }

  // Order is priority. Attention is front-loaded in a token sequence, so the
  // channel that actually answers the question goes first. For a protein that
  // is the outline: the overview grid resolves ~2 residues per cell and can
  // only report which chain dominates, while the outline names the helices.
  // For a crystal or a small molecule the grid is the finding and leads.
  //
  // For a small molecule the bond graph leads for the same reason the outline
  // leads for a protein: it is the channel that names the structure; the grid
  // then only has to place it.
  const topologyBlock: string[] = topology ? [topology.text] : []
  const blocks = plan.outlinePrimary
    ? [...outlineBlock, ...insetBlock, ...overviewBlock]
    : [...topologyBlock, ...overviewBlock, ...insetBlock, ...outlineBlock]

  return [header, ...notes, ...blocks].join('\n')
}

/**
 * An inset must be at least this much finer (A/cell) than the single-grid
 * alternative to be worth paying for. Below it the zoom is a re-rendering.
 */
const MIN_INSET_GAIN = 1.5

/** Floor the overview drops to when every site is bulk: bearings, not detail. */
const UNIFORM_BULK_RESOLUTION = 8

/**
 * Smallest useful cell. Bonded atoms sit >= 0.9 A apart, so at 0.5 A/cell two
 * bonded atoms already land in different cells; anything finer is empty space.
 */
const MIN_CELL_A = 0.5
/** The scale cap never pushes a grid below the planner's own floor. */
const MIN_PLANNED_RESOLUTION = 8

/** Layers listed in full before the line falls back to a count. */
const MAX_LAYERS_LISTED = 8

/**
 * Slab summary: surface normal, layers from the vacuum side down with their
 * composition, and the interlayer spacings. "How many layers, what is on top,
 * how far above the surface does the adsorbate sit" are the three questions a
 * top-view grid cannot answer, because they all live along the collapsed axis.
 */
const slabLine = (structure: ZatomStructure): string | null => {
  const surface = resolveSurfaceNormal(structure)
  if (!surface) return null
  const analysis = detectLayers(structure, surface.normal)
  if (analysis.layers.length < 2) return null
  const composition = (counts: Record<string, number>): string =>
    Object.entries(counts)
      .sort((p, q) => q[1] - p[1])
      .map(([el, n]) => `${el}${n > 1 ? n : ''}`)
      .join('')
  const listed = analysis.layers.slice(0, MAX_LAYERS_LISTED)
  const layers = listed
    .map((layer) => `L${layer.index}=${composition(layer.elementCounts)}`)
    .join(' ')
  const more = analysis.layers.length - listed.length
  const spacings = analysis.spacingsA
    .slice(0, MAX_LAYERS_LISTED - 1)
    .map((s) => s.toFixed(2))
    .join(' ')
  return (
    `# slab: normal=${'abc'[surface.axis]} layers=${analysis.layers.length} (L0 = vacuum side) ` +
    `${layers}${more > 0 ? ` +${more} more` : ''} · spacingA=[${spacings}]`
  )
}

/** `a b c / alpha beta gamma` of the cell, with which axes are periodic. */
const latticeLine = (structure: ZatomStructure): string | null => {
  const lattice = structure.lattice
  if (!lattice) return null
  const [a, b, c] = lattice.vectors
  const len = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2])
  const angle = (u: readonly number[], v: readonly number[]): number =>
    (Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v))) * 180) / Math.PI
  const periodic = lattice.periodic.map((p, i) => (p ? 'abc'[i] : '-')).join('')
  return (
    `# lattice: a=${len(a).toFixed(3)} b=${len(b).toFixed(3)} c=${len(c).toFixed(3)} A · ` +
    `alpha=${angle(b, c).toFixed(1)} beta=${angle(a, c).toFixed(1)} gamma=${angle(a, b).toFixed(1)} deg · ` +
    `periodic=${periodic}`
  )
}

/** Structural minimum the renderer needs from a resolved focus. */
interface FocusResolutionLike {
  atomIds: ReadonlySet<string>
  origin: FocusOrigin
  label: string
}

const focusEntitiesFor = (index: ResidueIndex | null, focus: FocusResolutionLike): string[] =>
  focusEntities(index, focus.atomIds)

/** Invert a row-vector lattice and return fractional coordinates, or null. */
const toFractional = (lattice: Mat3 | undefined, p: Vec3): Vec3 | null => {
  if (!lattice) return null
  const [a, b, c] = lattice
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
  if (Math.abs(det) < 1e-12) return null
  // Inverse of M (rows a,b,c); fractional f solves f·M = p, i.e. f = p·M⁻¹.
  const inv: Mat3 = [
    [
      (b[1] * c[2] - b[2] * c[1]) / det,
      (a[2] * c[1] - a[1] * c[2]) / det,
      (a[1] * b[2] - a[2] * b[1]) / det,
    ],
    [
      (b[2] * c[0] - b[0] * c[2]) / det,
      (a[0] * c[2] - a[2] * c[0]) / det,
      (a[2] * b[0] - a[0] * b[2]) / det,
    ],
    [
      (b[0] * c[1] - b[1] * c[0]) / det,
      (a[1] * c[0] - a[0] * c[1]) / det,
      (a[0] * b[1] - a[1] * b[0]) / det,
    ],
  ]
  return [
    p[0] * inv[0][0] + p[1] * inv[1][0] + p[2] * inv[2][0],
    p[0] * inv[0][1] + p[1] * inv[1][1] + p[2] * inv[2][1],
    p[0] * inv[0][2] + p[1] * inv[1][2] + p[2] * inv[2][2],
  ]
}

export const probeSceneCell = (
  structure: ZatomStructure,
  options: SceneGridOptions,
  x: number,
  y: number,
  selectedAtomIds: ReadonlySet<string> = new Set(),
): SceneProbeResult => {
  const resolved = resolveOptions(options)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= resolved.resolution || y >= resolved.resolution) {
    throw new SceneGridError(
      `Cell (${x}, ${y}) is outside the ${resolved.resolution}x${resolved.resolution} grid.`,
    )
  }
  const { projected } = projectAtoms(structure, options, resolved)
  const stack = projected
    .filter((a) => a.cellX === x && a.cellY === y)
    .sort((a, b) => a.depth - b.depth)
    .map((a) => ({
      atomId: a.atomId,
      element: a.element,
      depthBin: a.depthBin,
      depth: Number(a.depth.toFixed(4)),
      worldPosition: a.worldPosition,
      fractional: toFractional(structure.lattice?.vectors, a.worldPosition),
      selected: selectedAtomIds.has(a.atomId),
    }))
  return { xy: [x, y], view: options.view, stack }
}

export const listSceneGridViews = (
  structure: ZatomStructure,
  hasPose: boolean,
): SceneGridViewAvailability[] => {
  const hasLattice = Boolean(structure.lattice)
  const enough = structure.atoms.length >= 3
  return SCENE_GRID_VIEWS.map((view) => {
    if (view === 'current') {
      return hasPose
        ? { view, available: true }
        : { view, available: false, reason: 'no live viewer pose' }
    }
    if (view.startsWith('along_')) {
      return hasLattice
        ? { view, available: true }
        : { view, available: false, reason: 'structure has no lattice' }
    }
    if (view.startsWith('principal_')) {
      return enough
        ? { view, available: true }
        : { view, available: false, reason: 'needs at least 3 atoms' }
    }
    return { view, available: true }
  })
}
