// Shared periodic display contract for atoms and bonds.
// A displayed atom instance is `(atom id, integer image offset)`. A bond segment
// exists only when both endpoint instances are present. This prevents dangling
// bonds outside the display box and lets visible periodic images carry bonds.

import type { Bond } from '../../contracts/crystal'
import {
  type LatticeLike,
  type PeriodicMask,
  type Vec3,
  invert3x3,
  latticeShift,
  toFractional,
} from './lattice-math'

export type ImageOffset = readonly [number, number, number]

export const HOME_IMAGE: ImageOffset = [0, 0, 0]

export function isHomeImage(off: ImageOffset): boolean {
  return off[0] === 0 && off[1] === 0 && off[2] === 0
}

export function imageOffsetKey(off: ImageOffset): string {
  return `${off[0]},${off[1]},${off[2]}`
}

/** Atom id to rendered image offsets, always including `[0,0,0]`. */
export type DisplayImageOffsets = ReadonlyMap<string, readonly ImageOffset[]>

/** Fractional tolerance for detecting atoms on display-box boundaries. */
const EDGE_EPS = 1e-3

/**
 * Return boundary-equivalent images in displayed-supercell units. Coordinates
 * near 0 produce a +1 image and coordinates near 1 produce a -1 image; hits on
 * several axes produce all combinations. Aperiodic axes produce no images.
 */
export function edgeImageOffsets(
  atoms: readonly { id: string; cartesian?: readonly number[]; position?: readonly number[] }[],
  displayBox: LatticeLike,
  mask: PeriodicMask,
): Map<string, ImageOffset[]> {
  const out = new Map<string, ImageOffset[]>()
  const inv = invert3x3(displayBox)
  if (!inv) return out
  const axisPeriodic = [mask.a, mask.b, mask.c]
  for (const atom of atoms) {
    const cart = atom.cartesian ?? atom.position
    if (!cart) continue
    const frac = toFractional(inv, cart[0], cart[1], cart[2])
    const axisShifts = frac.map((f, axis) => {
      if (!axisPeriodic[axis]) return [0]
      if (Math.abs(f) <= EDGE_EPS) return [0, 1]
      if (Math.abs(f - 1) <= EDGE_EPS) return [0, -1]
      return [0]
    })
    let list: ImageOffset[] | undefined
    for (const da of axisShifts[0]) {
      for (const db of axisShifts[1]) {
        for (const dc of axisShifts[2]) {
          if (da === 0 && db === 0 && dc === 0) continue
          if (!list) {
            list = out.get(atom.id) ?? []
            out.set(atom.id, list)
          }
          list.push([da, db, dc])
        }
      }
    }
  }
  return out
}

// Do not synthesize images solely to close bonds. Only boundary images inside
// the display box are visible; unconstrained closure would grow images outward.

/** Merge optional image offsets into the canonical origin instance set. */
export function buildDisplayImageOffsets(
  atomIds: readonly string[],
  extra: readonly ReadonlyMap<string, readonly ImageOffset[]>[],
): Map<string, ImageOffset[]> {
  const out = new Map<string, ImageOffset[]>()
  for (const id of atomIds) out.set(id, [HOME_IMAGE])
  for (const source of extra) {
    for (const [id, offsets] of source) {
      const list = out.get(id)
      if (!list) continue // Atoms that are not in the current rendering set (such as those filtered out by the layer) do not participate
      for (const off of offsets) {
        if (isHomeImage(off)) continue
        if (list.some((o) => o[0] === off[0] && o[1] === off[1] && o[2] === off[2])) continue
        list.push(off)
      }
    }
  }
  return out
}

/** Bond segment whose endpoints both belong to displayed atom instances. */
export interface BondSegment {
  bond: Bond
  /** Stable React/instance key for this displayed segment. */
  key: string
  /** Image offset of the first endpoint, used by focus and selection. */
  image: ImageOffset
  p1: Vec3
  p2: Vec3
}

interface BondSegmentInput {
  bonds: readonly Bond[]
  /** Main-layer atom position after unwrap, drag, and image displacement. */
  positionOf: (atomId: string) => readonly number[] | undefined
  /** Displayed-supercell lattice used by both bond and atom image offsets. */
  lattice: LatticeLike | null | undefined
  /** Null for an aperiodic layer, where each bond is emitted once as supplied. */
  instances: DisplayImageOffsets | null
}

/** Expand canonical bonds into segments whose atom images are visible. */
export function buildBondSegments({ bonds, positionOf, lattice, instances }: BondSegmentInput): BondSegment[] {
  const out: BondSegment[] = []
  const shiftCache = new Map<string, Vec3>()
  const shiftFor = (off: ImageOffset): Vec3 => {
    if (isHomeImage(off) || !lattice) return [0, 0, 0]
    const k = imageOffsetKey(off)
    let s = shiftCache.get(k)
    if (!s) {
      s = latticeShift(lattice, off[0], off[1], off[2])
      shiftCache.set(k, s)
    }
    return s
  }

  // Membership must be O(1); a linear scan would make each bond proportional to the number of rendered atom images.
  let member: Set<string> | null = null
  if (instances) {
    member = new Set<string>()
    for (const [id, offsets] of instances) {
      for (const off of offsets) member.add(`${id}|${imageOffsetKey(off)}`)
    }
  }

  for (const bond of bonds) {
    const base1 = positionOf(bond.atom1Id)
    const base2 = positionOf(bond.atom2Id)
    if (!base1 || !base2) continue

    // Aperiodic layers emit one direct segment and ignore synthetic-cell offsets.
    if (!instances || !member || !lattice) {
      out.push({
        bond,
        key: bond.id,
        image: HOME_IMAGE,
        p1: [base1[0], base1[1], base1[2]],
        p2: [base2[0], base2[1], base2[2]],
      })
      continue
    }

    const off = bond.latticeOffset
    const da = off?.[0] ?? 0
    const db = off?.[1] ?? 0
    const dc = off?.[2] ?? 0

    for (const i of instances.get(bond.atom1Id) ?? []) {
      const target: ImageOffset = [i[0] + da, i[1] + db, i[2] + dc]
      // Both endpoints must belong to rendered atom images; otherwise the bond
      // would form a dangling segment outside the displayed periodic region.
      if (!member.has(`${bond.atom2Id}|${imageOffsetKey(target)}`)) continue
      const s1 = shiftFor(i)
      const s2 = shiftFor(target)
      out.push({
        bond,
        key: isHomeImage(i) && isHomeImage(target) ? bond.id : `${bond.id}@${imageOffsetKey(i)}`,
        image: i,
        p1: [base1[0] + s1[0], base1[1] + s1[1], base1[2] + s1[2]],
        p2: [base2[0] + s2[0], base2[1] + s2[1], base2[2] + s2[2]],
      })
    }
  }

  return out
}
