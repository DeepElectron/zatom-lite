/**
 * Pseudo-hydrogen passivation of slab dangling bonds.
 *
 * Pipeline:
 *   1. Detect top/bottom surface atoms by binning along z within `surface_tol`.
 *   2. For each surface atom, count existing real bonds (within
 *      bond_cutoff_factor × (r_cov(A) + r_cov(B))).
 *   3. If coordination < expected_coordination[element], place pseudo-H atoms
 *      along inverted bond directions. We compute the "missing" direction as
 *      the negative of the sum of existing bond unit-vectors (so the new H
 *      occupies the "void" hemisphere). When that direction has near-zero
 *      magnitude (atom is symmetric), we fall back to ±z (surface normal).
 *   4. Pseudo-H atoms are placed at `pseudo_h_bond_length` from the host atom.
 *
 * Partial charges:
 *   The partial charge per pseudo-H depends on the host atom's group + bulk
 *   coordination. For Si (group IV, 4 e-, bulk z = 4) each pseudo-H carries
 *   `group_valence / bulk_coordination = 1` electron of partial charge.
 *   For III–V like GaAs the host coordination is 4 too but the group valence
 *   differs (Ga=3 → q=0.75; As=5 → q=1.25). Extended XYZ has no native field
 *   for partial charges so we put them in a `pseudo_h_charges=` comment for
 *   downstream tools.
 *
 * No CatGo / AGPL source consulted.
 */

import { ELEMENTS } from '../../crystal/elements'
import type { BuilderResult } from './types'

type Vec3 = [number, number, number]

export interface PassivationAtomInput {
  element: string
  cartesian: Vec3
}

export interface PassivationOptions {
  atoms: PassivationAtomInput[]
  /** Optional lattice for the slab — preserved in the output. */
  lattice?: [Vec3, Vec3, Vec3]
  /** Which surface to passivate (top = max z, bottom = min z). Default 'both'. */
  side?: 'top' | 'bottom' | 'both'
  /** Tolerance (Å) for grouping atoms into top/bottom layers. Default 0.5 Å. */
  surface_tol?: number
  /** Expected coordination per element. Falls back to BULK_COORDINATION. */
  expected_coordination?: Record<string, number>
  /** Bond cutoff scaling factor (× Σr_cov). Default 1.2. */
  bond_cutoff_factor?: number
  /** Pseudo-H bond length (Å). Default 1.0 Å. */
  pseudo_h_bond_length?: number
}

export interface PassivationResult extends BuilderResult {
  /** Number of pseudo-H atoms added. */
  added_count: number
  /** Per-pseudo-H partial-charge list (same order as the added atoms). */
  partial_charges: number[]
}

/** Common bulk coordination for elements typically passivated in slab DFT. */
const BULK_COORDINATION: Record<string, number> = {
  Si: 4, Ge: 4, C: 4, Sn: 4,
  Ga: 4, As: 4, In: 4, Sb: 4,
  Al: 4, P: 4,
  B: 3, N: 3,
  O: 2, S: 2,
  H: 1,
}

/** Valence-electron count per group (used for pseudo-H partial charges). */
const GROUP_VALENCE: Record<string, number> = {
  H: 1, Li: 1, Na: 1, K: 1,
  Be: 2, Mg: 2, Ca: 2,
  B: 3, Al: 3, Ga: 3, In: 3,
  C: 4, Si: 4, Ge: 4, Sn: 4,
  N: 5, P: 5, As: 5, Sb: 5,
  O: 6, S: 6, Se: 6, Te: 6,
  F: 7, Cl: 7, Br: 7, I: 7,
}

function covalentRadius(el: string): number {
  return ELEMENTS[el]?.radius ?? 0.8
}

function add(u: Vec3, v: Vec3): Vec3 { return [u[0] + v[0], u[1] + v[1], u[2] + v[2]] }
function sub(u: Vec3, v: Vec3): Vec3 { return [u[0] - v[0], u[1] - v[1], u[2] - v[2]] }
function scale(v: Vec3, s: number): Vec3 { return [v[0] * s, v[1] * s, v[2] * s] }
function norm(v: Vec3): number { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) }
function unit(v: Vec3): Vec3 {
  const n = norm(v)
  if (n < 1e-9) return [0, 0, 1]
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** Detect the topmost and bottommost layer indices, grouped by surface_tol. */
function detectSurfaceLayers(
  atoms: PassivationAtomInput[],
  tol: number,
): { top: number[]; bottom: number[] } {
  if (atoms.length === 0) return { top: [], bottom: [] }
  let zMin = Infinity, zMax = -Infinity
  for (const a of atoms) {
    if (a.cartesian[2] < zMin) zMin = a.cartesian[2]
    if (a.cartesian[2] > zMax) zMax = a.cartesian[2]
  }
  const top: number[] = []
  const bottom: number[] = []
  for (let i = 0; i < atoms.length; i++) {
    const z = atoms[i].cartesian[2]
    if (Math.abs(z - zMax) <= tol) top.push(i)
    if (Math.abs(z - zMin) <= tol) bottom.push(i)
  }
  return { top, bottom }
}

/** Compute bond neighbours for each atom. Returns an array per atom with the
 *  unit vectors of existing bonds (pointing from the atom outward). */
function computeBondVectors(
  atoms: PassivationAtomInput[],
  bondCutoffFactor: number,
): Vec3[][] {
  const N = atoms.length
  const out: Vec3[][] = Array.from({ length: N }, () => [])
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const ri = covalentRadius(atoms[i].element)
      const rj = covalentRadius(atoms[j].element)
      const cutoff = bondCutoffFactor * (ri + rj)
      const dv = sub(atoms[j].cartesian, atoms[i].cartesian)
      const d = norm(dv)
      if (d < cutoff && d > 1e-6) {
        out[i].push(unit(dv))
        out[j].push(unit(scale(dv, -1)))
      }
    }
  }
  return out
}

/** Place k pseudo-H atoms around a single host atom to bring it up to
 *  expected coordination. Chooses placement directions by finding the
 *  "void" hemisphere(s) — invert the sum of existing bond vectors. */
function placePseudoHForAtom(
  hostPos: Vec3,
  bondDirs: Vec3[],
  needed: number,
  hBond: number,
  defaultUp: Vec3,
): Vec3[] {
  if (needed <= 0) return []
  // Sum of existing bond vectors → "occupied direction".
  let sumX = 0, sumY = 0, sumZ = 0
  for (const v of bondDirs) { sumX += v[0]; sumY += v[1]; sumZ += v[2] }
  const sumLen = Math.sqrt(sumX * sumX + sumY * sumY + sumZ * sumZ)

  // Primary opposite direction: -sum / |sum| if non-degenerate, else defaultUp.
  let primary: Vec3
  if (sumLen > 0.1) {
    primary = [-sumX / sumLen, -sumY / sumLen, -sumZ / sumLen]
  } else {
    primary = unit(defaultUp)
  }

  const out: Vec3[] = []
  if (needed === 1) {
    out.push(add(hostPos, scale(primary, hBond)))
    return out
  }
  // For multiple needed bonds, distribute around primary direction.
  // Construct a basis (primary, u, v) and place tetrahedrally if needed = 2..4.
  // We pick u perpendicular to primary, v = primary × u.
  const ref: Vec3 = Math.abs(primary[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const dotR = primary[0] * ref[0] + primary[1] * ref[1] + primary[2] * ref[2]
  const u = unit([
    ref[0] - primary[0] * dotR,
    ref[1] - primary[1] * dotR,
    ref[2] - primary[2] * dotR,
  ])
  const v: Vec3 = [
    primary[1] * u[2] - primary[2] * u[1],
    primary[2] * u[0] - primary[0] * u[2],
    primary[0] * u[1] - primary[1] * u[0],
  ]
  // Tetrahedral-cone half-angle ≈ 54.7° from primary; arrange `needed` H atoms
  // around the cone evenly.
  const halfAngle = (Math.PI / 180) * 54.7
  const cosA = Math.cos(halfAngle)
  const sinA = Math.sin(halfAngle)
  for (let i = 0; i < needed; i++) {
    const phi = (2 * Math.PI * i) / needed
    const dir: Vec3 = [
      primary[0] * cosA + (Math.cos(phi) * u[0] + Math.sin(phi) * v[0]) * sinA,
      primary[1] * cosA + (Math.cos(phi) * u[1] + Math.sin(phi) * v[1]) * sinA,
      primary[2] * cosA + (Math.cos(phi) * u[2] + Math.sin(phi) * v[2]) * sinA,
    ]
    out.push(add(hostPos, scale(dir, hBond)))
  }
  return out
}

// ── main entry ─────────────────────────────────────────────────────────────

export function passivateSlab(opts: PassivationOptions): PassivationResult {
  const side = opts.side ?? 'both'
  const tol = opts.surface_tol ?? 0.5
  const bondFactor = opts.bond_cutoff_factor ?? 1.2
  const hBond = opts.pseudo_h_bond_length ?? 1.0
  const expectedTable = opts.expected_coordination ?? {}

  const { top, bottom } = detectSurfaceLayers(opts.atoms, tol)
  const bondDirs = computeBondVectors(opts.atoms, bondFactor)

  const surfaceTargets = new Set<number>()
  if (side === 'top' || side === 'both') {
    for (const i of top) surfaceTargets.add(i)
  }
  if (side === 'bottom' || side === 'both') {
    for (const i of bottom) surfaceTargets.add(i)
  }

  const added: PassivationAtomInput[] = []
  const partialCharges: number[] = []
  const unsupportedElements = new Set<string>()
  let fullyCoordinated = 0

  for (const idx of surfaceTargets) {
    const host = opts.atoms[idx]
    const expected = expectedTable[host.element] ?? BULK_COORDINATION[host.element] ?? 0
    if (expected === 0) {
      unsupportedElements.add(host.element)
      continue  // no rule for this element
    }
    const currentBonds = bondDirs[idx].length
    const missing = Math.max(0, expected - currentBonds)
    if (missing === 0) {
      fullyCoordinated++
      continue
    }
    // Choose "default up" direction based on side: top → +z, bottom → -z.
    const isTop = top.includes(idx)
    const defaultUp: Vec3 = isTop ? [0, 0, 1] : [0, 0, -1]
    const newPositions = placePseudoHForAtom(host.cartesian, bondDirs[idx], missing, hBond, defaultUp)
    const valence = GROUP_VALENCE[host.element] ?? 4
    const q = valence / expected
    for (const p of newPositions) {
      added.push({ element: 'H', cartesian: p })
      partialCharges.push(q)
    }
  }

  // Emit extended-XYZ.
  const allAtoms: PassivationAtomInput[] = [...opts.atoms, ...added]
  const lines: string[] = []
  lines.push(String(allAtoms.length))
  let header = 'Properties=species:S:1:pos:R:3'
  if (opts.lattice) {
    const latStr = opts.lattice.flatMap((r) => r.map((x) => x.toFixed(6))).join(' ')
    header = `Lattice="${latStr}" ${header}`
  }
  // Embed partial-charge list as a comment field for downstream consumers.
  const qStr = partialCharges.map((q) => q.toFixed(3)).join(',')
  header = `${header} Passivation side=${side} added=${added.length} pseudo_h_charges=${qStr}`
  lines.push(header)
  for (const a of allAtoms) {
    lines.push(`${a.element} ${a.cartesian[0].toFixed(6)} ${a.cartesian[1].toFixed(6)} ${a.cartesian[2].toFixed(6)}`)
  }

  let desc =
    `Passivated slab · side=${side} · added ${added.length} pseudo-H · ` +
    `${allAtoms.length} atoms total`
  if (added.length === 0) {
    if (unsupportedElements.size > 0) {
      desc += ` · no passivation rules for ${[...unsupportedElements].sort().join(', ')} (covalent semiconductors only: Si, Ge, C, III-V, ...)`
    } else if (fullyCoordinated > 0) {
      desc += ` · all ${fullyCoordinated} surface atoms already fully coordinated (generate a slab with vacuum first)`
    } else {
      desc += ' · no surface atoms detected'
    }
  }
  return {
    xyz: lines.join('\n'),
    description: desc,
    n_atoms: allAtoms.length,
    added_count: added.length,
    partial_charges: partialCharges,
  }
}
