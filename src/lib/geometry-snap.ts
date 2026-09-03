/**
 * Camera-independent geometry primitives for context-sensitive snapping. Bonds
 * and lattice edges become line features; each line exposes division and
 * extension points, and pairs expose their closest 3D approach. Screen-space
 * picking lives in the view layer so only one active feature competes at a time.
 */

import { isSupercellBoundaryEdge } from './render/lattice-visibility'

export type SnapKind = 'midpoint' | 'third' | 'quarter' | 'extension' | 'endpoint'
export type SnapLineKind = 'bond' | 'lattice'

export type Vec3 = [number, number, number]

/** Chemical-bond or lattice-edge line with Cartesian endpoints. */
export interface SnapLine {
  /**
  * Stable unique id - the view determines active based on this / draw the only extended auxiliary line
  */
  id: string
  p1: Vec3
  p2: Vec3
  kind: SnapLineKind
}

/** Discrete snap point on a line feature. */
export interface SnapPoint {
  pos: Vec3
  /**
  * Parameter t:0=p1,1=p2;<0 or >1 represents the extended segment falling outside the line segment
  */
  t: number
  kind: SnapKind
  label: string
  /**
  * true=falls within the line segment (1/2 equal point), false=extended point outside the line segment
  */
  withinSegment: boolean
  /**
  * Source line id (facilitates the view to assign points to the active line)
  */
  lineId: string
}

interface MinimalAtom {
  id: string
  cartesian?: [number, number, number]
  position: [number, number, number]
}

interface MinimalBond {
  atom1Id: string
  atom2Id: string
}

type Lattice = { a: number[]; b: number[]; c: number[] } | null | undefined

/**
 * The bisecting point inside the line segment** (0<t<1)
 */
const INTERIOR_SAMPLES: ReadonlyArray<{ t: number; kind: SnapKind; label: string }> = [
  { t: 0.5, kind: 'midpoint', label: '1/2' },
  { t: 1 / 3, kind: 'third', label: '1/3' },
  { t: 2 / 3, kind: 'third', label: '2/3' },
  { t: 1 / 4, kind: 'quarter', label: '1/4' },
  { t: 3 / 4, kind: 'quarter', label: '3/4' },
]

/**
 * Line segment **External** extension points at both ends (t<0 or t>1)
 */
const EXTENSION_SAMPLES: ReadonlyArray<{ t: number; label: string }> = [
  { t: -0.5, label: 'ext -1/2' },
  { t: -1, label: 'ext -1' },
  { t: 1.5, label: 'ext 3/2' },
  { t: 2, label: 'ext 2' },
]

const MAX_BOND_LINES = 4000
const MAX_LATTICE_EDGES = 600

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function coord(a: MinimalAtom): Vec3 | null {
  return (a.cartesian ?? a.position ?? null) as Vec3 | null
}

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function scale(a: Vec3, s: number): Vec3 { return [a[0] * s, a[1] * s, a[2] * s] }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]) }

/**
 * Abstract chemical bonds + lattice edges into a collection of "line features".
 * - When **exactly 2 atoms** are selected: only this "selected bond" line is output (forced focus, in line with "two atoms are determined by the user").
 * - Otherwise: all chemical bonds + lattice edges (if any).
 * lattice may be null (molecule) → guard, only bond lines are output.
 */
/**
 * Lattice visibility used to keep snap features identical to rendered edges.
 * Hidden lattice yields no edge snaps; a hidden cell grid retains only the
 * supercell boundary. Omission enables the full grid for pure geometry tests.
 */
export interface LatticeSnapView {
  supercell?: { nx: number; ny: number; nz: number } | null
  visible: boolean
  showCellGrid: boolean
}

export function buildSnapLines(
  atoms: MinimalAtom[],
  bonds: MinimalBond[],
  lattice: Lattice,
  selectedAtomIds: Set<string>,
  latticeView?: LatticeSnapView,
): SnapLine[] {
  const byId = new Map<string, MinimalAtom>()
  for (const a of atoms) byId.set(a.id, a)

  const out: SnapLine[] = []

  // Select exactly two atoms → focus only on this connecting line (ignore other bonds/lattice lines, completely eliminating competition)
  if (selectedAtomIds.size === 2) {
    const sel = atoms.filter((a) => selectedAtomIds.has(a.id))
    if (sel.length === 2) {
      const a = coord(sel[0]); const b = coord(sel[1])
      if (a && b) out.push({ id: `sel-${sel[0].id}-${sel[1].id}`, p1: a, p2: b, kind: 'bond' })
    }
    return out
  }

  // all chemical bonds
  for (let i = 0; i < bonds.length && i < MAX_BOND_LINES; i++) {
    const a1 = byId.get(bonds[i].atom1Id); const a2 = byId.get(bonds[i].atom2Id)
    if (!a1 || !a2) continue
    const a = coord(a1); const b = coord(a2)
    if (!a || !b) continue
    out.push({ id: `bond-${bonds[i].atom1Id}-${bonds[i].atom2Id}-${i}`, p1: a, p2: b, kind: 'bond' })
  }

  // Lattice edges. Skip if lattice is null.
  out.push(...latticeEdges(lattice, latticeView))

  return out
}

/**
 * Generate Cartesian lattice-edge segments identical to `LatticeGrid`. Each
 * segment spans one lattice vector at every integer supercell grid position;
 * visibility filtering uses the shared boundary predicate.
 */
function latticeEdges(lattice: Lattice, latticeView?: LatticeSnapView): SnapLine[] {
  if (latticeView && !latticeView.visible) return []
  if (!lattice || !Array.isArray(lattice.a) || !Array.isArray(lattice.b) || !Array.isArray(lattice.c)) return []
  const a = lattice.a as Vec3; const b = lattice.b as Vec3; const c = lattice.c as Vec3
  if (a.length < 3 || b.length < 3 || c.length < 3) return []
  if (typeof a[0] !== 'number' || typeof b[0] !== 'number' || typeof c[0] !== 'number') return []

  const supercell = latticeView?.supercell
  const nx = Math.max(1, Math.floor(supercell?.nx ?? 1))
  const ny = Math.max(1, Math.floor(supercell?.ny ?? 1))
  const nz = Math.max(1, Math.floor(supercell?.nz ?? 1))
  const gridShown = latticeView?.showCellGrid ?? true

  const corner = (i: number, j: number, k: number): Vec3 =>
    add(add(scale(a, i), scale(b, j)), scale(c, k))

  const out: SnapLine[] = []
  const push = (dir: 'a' | 'b' | 'c', i: number, j: number, k: number, p1: Vec3, p2: Vec3) => {
    // Reuse the renderer's supercell-boundary predicate.
    if (!gridShown && !isSupercellBoundaryEdge({ cellIndex: [i, j, k], direction: dir }, { nx, ny, nz })) return
    if (out.length >= MAX_LATTICE_EDGES) return
    out.push({ id: `lat-${out.length}`, p1, p2, kind: 'lattice' as const })
  }
  // Take all grid positions along a:i∈[0,nx),(j,k) (including outer boundary j=ny / k=nz)
  for (let i = 0; i < nx; i++)
    for (let j = 0; j <= ny; j++)
      for (let k = 0; k <= nz; k++) push('a', i, j, k, corner(i, j, k), corner(i + 1, j, k))
  // along b
  for (let j = 0; j < ny; j++)
    for (let i = 0; i <= nx; i++)
      for (let k = 0; k <= nz; k++) push('b', i, j, k, corner(i, j, k), corner(i, j + 1, k))
  // along c
  for (let k = 0; k < nz; k++)
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= ny; j++) push('c', i, j, k, corner(i, j, k), corner(i, j, k + 1))
  return out
}

/** Return standard division points and two extension levels at each line end. */
export function pointsOnLine(line: SnapLine): SnapPoint[] {
  const out: SnapPoint[] = []
  for (const s of INTERIOR_SAMPLES) {
    out.push({
      pos: lerp(line.p1, line.p2, s.t), t: s.t, kind: s.kind, label: s.label,
      withinSegment: true, lineId: line.id,
    })
  }
  for (const s of EXTENSION_SAMPLES) {
    out.push({
      pos: lerp(line.p1, line.p2, s.t), t: s.t, kind: 'extension', label: s.label,
      withinSegment: false, lineId: line.id,
    })
  }
  return out
}

export interface ClosestApproach {
  /** Midpoint of the closest points on the two lines. */
  pos: Vec3
  /** Separation of the closest points; below tolerance counts as intersection. */
  gap: number
  /**
  * The closest point parameter t on l1 (can be <0 or >1 → falls on the extension)
  */
  t1: number
  /**
  * Closest point parameter t on l2
  */
  t2: number
}

/** Return closest approach of two infinite 3D lines, or null when parallel. */
export function line3DClosestPoint(l1: SnapLine, l2: SnapLine): ClosestApproach | null {
  const p1 = l1.p1; const d1 = sub(l1.p2, l1.p1)
  const p2 = l2.p1; const d2 = sub(l2.p2, l2.p1)
  const d1len = len(d1); const d2len = len(d2)
  if (d1len < 1e-9 || d2len < 1e-9) return null

  const n = cross(d1, d2)
  const nLen = len(n)
  // Parallel (or nearly parallel) → no clear single intersection point
  if (nLen < 1e-6 * d1len * d2len) return null

  // Solution |p1 + t1 d1 - (p2 + t2 d2)| Minimal standard system of linear equations
  const r = sub(p1, p2)
  const a = dot(d1, d1)
  const b = dot(d1, d2)
  const c = dot(d2, d2)
  const d = dot(d1, r)
  const e = dot(d2, r)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-12) return null

  const t1 = (b * e - c * d) / denom
  const t2 = (a * e - b * d) / denom

  const c1 = add(p1, scale(d1, t1)) // nearest point on l1
  const c2 = add(p2, scale(d2, t2)) // nearest point on l2
  const gap = len(sub(c1, c2))
  const pos: Vec3 = scale(add(c1, c2), 0.5)
  return { pos, gap, t1, t2 }
}
