/**
 * Uniform-grid spatial hash over atom positions — the true-3D-distance channel.
 *
 * The SceneGrid projection deliberately collapses depth, so two atoms in one
 * cell can be 40 A apart. Almost every modeling question ("what occupies Fe's
 * sixth coordination site?") is a proximity question, so proximity needs its own
 * channel that never goes through the projection.
 *
 * Bucket edge = cutoff, so a neighbor query touches 27 buckets and the whole
 * scan is O(N) in atoms with O(1) expected work per query.
 *
 * Periodic scenes search every lattice translation that can bring an image
 * within the cutoff. The image range per axis is ceil(cutoff / perpendicular
 * cell width), so a primitive fcc cell (2.56 A) or a 1x1 slab is searched as
 * thoroughly as a big supercell: a fixed +-1 range silently undercounted
 * coordination for any cell thinner than the cutoff. Each distinct image of a
 * neighbor is a separate hit, which is what a coordination count needs.
 */

import type { Mat3, Vec3, ZatomStructure } from '../../agent/contracts'
import {
  type LatticeLike,
  invert3x3,
  isValidLattice,
  latticeShift,
} from '../crystal/lattice-math'

export interface NeighborGridOptions {
  /** Neighbor search radius in Angstrom. */
  cutoff: number
  /** Honour periodic boundaries when the structure has a lattice. Default true. */
  periodic?: boolean
}

export interface NeighborHit {
  atomIndex: number
  atomId: string
  element: string
  /** True 3D distance in Angstrom (minimum image when periodic). */
  distance: number
  /** Integer lattice translation applied to the neighbor, or null when none. */
  latticeOffset: [number, number, number] | null
}

/** Row-vector Mat3 -> the {a,b,c} shape `lattice-math` expects. */
const toLatticeLike = (vectors: Mat3): LatticeLike => ({
  a: [vectors[0][0], vectors[0][1], vectors[0][2]],
  b: [vectors[1][0], vectors[1][1], vectors[1][2]],
  c: [vectors[2][0], vectors[2][1], vectors[2][2]],
})

const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
]
const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
const norm = (u: Vec3): number => Math.sqrt(dot(u, u))

/**
 * Perpendicular width of the cell along each axis: V / |b x c| etc. This, not
 * the axis length, is the distance between opposite cell faces, so it decides
 * how many images along that axis can lie within the cutoff.
 */
const perpendicularWidths = (lattice: LatticeLike): Vec3 => {
  const volume = Math.abs(dot(lattice.a, cross(lattice.b, lattice.c)))
  return [
    volume / norm(cross(lattice.b, lattice.c)),
    volume / norm(cross(lattice.c, lattice.a)),
    volume / norm(cross(lattice.a, lattice.b)),
  ]
}

/** Guard against a degenerate lattice turning the image loop into a runaway. */
const MAX_IMAGES_PER_AXIS = 12

/** Every lattice translation that can place an image within the cutoff. */
const buildImageShifts = (
  lattice: LatticeLike,
  periodicMask: [boolean, boolean, boolean],
  cutoff: number,
): { shift: Vec3; offset: [number, number, number] }[] => {
  const widths = perpendicularWidths(lattice)
  const range = (enabled: boolean, width: number): number[] => {
    if (!enabled) return [0]
    const n = Math.min(MAX_IMAGES_PER_AXIS, Math.max(1, Math.ceil(cutoff / width)))
    const out = [0]
    for (let k = 1; k <= n; k++) out.push(-k, k)
    return out
  }
  const shifts: { shift: Vec3; offset: [number, number, number] }[] = []
  for (const na of range(periodicMask[0], widths[0])) {
    for (const nb of range(periodicMask[1], widths[1])) {
      for (const nc of range(periodicMask[2], widths[2])) {
        shifts.push({
          shift: latticeShift(lattice, na, nb, nc),
          offset: na === 0 && nb === 0 && nc === 0 ? [0, 0, 0] : [na, nb, nc],
        })
      }
    }
  }
  return shifts
}

export class NeighborGrid {
  private readonly positions: Vec3[]
  private readonly atomIds: string[]
  private readonly elements: string[]
  private readonly cutoff: number
  private readonly cutoffSq: number
  private readonly buckets = new Map<string, number[]>()
  private readonly imageShifts: { shift: Vec3; offset: [number, number, number] }[]

  constructor(structure: ZatomStructure, options: NeighborGridOptions) {
    const cutoff = options.cutoff
    if (!Number.isFinite(cutoff) || cutoff <= 0) {
      throw new Error(`Neighbor cutoff must be a positive number, got ${cutoff}.`)
    }
    this.cutoff = cutoff
    this.cutoffSq = cutoff * cutoff

    const atoms = structure.atoms
    this.positions = atoms.map((a) => a.position)
    this.atomIds = atoms.map((a) => a.id)
    this.elements = atoms.map((a) => a.element)

    const usePeriodic = options.periodic !== false && structure.lattice !== undefined
    if (usePeriodic && structure.lattice) {
      const lattice = toLatticeLike(structure.lattice.vectors)
      this.imageShifts = isValidLattice(lattice)
        ? buildImageShifts(lattice, structure.lattice.periodic, cutoff)
        : [{ shift: [0, 0, 0], offset: [0, 0, 0] }]
    } else {
      this.imageShifts = [{ shift: [0, 0, 0], offset: [0, 0, 0] }]
    }

    // Bucket edge = cutoff, so any neighbor lies in one of the 27 adjacent cells.
    for (let i = 0; i < this.positions.length; i++) {
      const key = this.bucketKey(this.positions[i])
      const list = this.buckets.get(key)
      if (list) list.push(i)
      else this.buckets.set(key, [i])
    }
  }

  private bucketKey(p: Vec3): string {
    const c = this.cutoff
    return `${Math.floor(p[0] / c)},${Math.floor(p[1] / c)},${Math.floor(p[2] / c)}`
  }

  /** Atom count this grid was built over. */
  get atomCount(): number {
    return this.positions.length
  }

  /**
  * Neighbors of a world position within the cutoff, sorted by distance.
  *
  * `excludeIndices` drops same-entity atoms from the result. `selfIndex` drops
  * exactly one atom without allocating a set for it, which matters when the
  * caller is iterating every atom in the scene.
  */
  neighborsOf(
    origin: Vec3,
    excludeIndices?: ReadonlySet<number>,
    selfIndex?: number,
  ): NeighborHit[] {
    const hits: NeighborHit[] = []
    const c = this.cutoff

    for (const image of this.imageShifts) {
      // Translate the *probe* by -shift, equivalent to translating neighbors by
      // +shift, so a single bucket index serves every image.
      const probe: Vec3 = [
        origin[0] - image.shift[0],
        origin[1] - image.shift[1],
        origin[2] - image.shift[2],
      ]
      const bx = Math.floor(probe[0] / c)
      const by = Math.floor(probe[1] / c)
      const bz = Math.floor(probe[2] / c)

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = this.buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
            if (!list) continue
            for (const idx of list) {
              if (idx === selfIndex) continue
              if (excludeIndices?.has(idx)) continue
              const p = this.positions[idx]
              const ex = p[0] - probe[0]
              const ey = p[1] - probe[1]
              const ez = p[2] - probe[2]
              const dSq = ex * ex + ey * ey + ez * ez
              if (dSq > this.cutoffSq || dSq < 1e-12) continue
              hits.push({
                atomIndex: idx,
                atomId: this.atomIds[idx],
                element: this.elements[idx],
                distance: Math.sqrt(dSq),
                latticeOffset:
                  image.offset[0] === 0 && image.offset[1] === 0 && image.offset[2] === 0
                    ? null
                    : image.offset,
              })
            }
          }
        }
      }
    }

    // One hit per atom (its closest image): callers build per-atom graphs and
    // contact lists from this. Coordination, which must count every image of a
    // neighbor in a thin cell, goes through `coordinationNumbers` instead.
    const closest = new Map<number, NeighborHit>()
    for (const hit of hits) {
      const prior = closest.get(hit.atomIndex)
      if (!prior || hit.distance < prior.distance) closest.set(hit.atomIndex, hit)
    }
    return [...closest.values()].sort((a, b) => a.distance - b.distance)
  }

  /**
  * Neighbor count for every atom — coordination number.
  *
  * Every lattice image within range counts as its own neighbor: in a primitive
  * fcc cell all twelve neighbors are images of the one atom. `pairCutoff`, when
  * given, narrows the grid's search radius per element pair (Ti-O and O-O have
  * different first shells); it must never exceed the grid cutoff.
  *
  * Counts inline instead of going through `neighborsOf`, which would allocate a
  * hit object, a `Map` and a sorted array per atom; this routine runs over every
  * atom in the scene.
  */
  /**
  * Visit every neighbor image of atom `i` within the cutoff, unsorted and
  * without allocating hits. Used to sample the pair-distance distribution.
  */
  forEachNeighborImage(i: number, visit: (atomIndex: number, distance: number) => void): void {
    const origin = this.positions[i]
    const c = this.cutoff
    for (const image of this.imageShifts) {
      const px = origin[0] - image.shift[0]
      const py = origin[1] - image.shift[1]
      const pz = origin[2] - image.shift[2]
      const bx = Math.floor(px / c)
      const by = Math.floor(py / c)
      const bz = Math.floor(pz / c)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = this.buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
            if (!list) continue
            for (const idx of list) {
              const p = this.positions[idx]
              const ex = p[0] - px
              const ey = p[1] - py
              const ez = p[2] - pz
              const dSq = ex * ex + ey * ey + ez * ez
              if (dSq > this.cutoffSq || dSq < 1e-12) continue
              visit(idx, Math.sqrt(dSq))
            }
          }
        }
      }
    }
  }

  coordinationNumbers(pairCutoff?: (elementA: string, elementB: string) => number): number[] {
    const n = this.positions.length
    const counts = new Array<number>(n).fill(0)
    const c = this.cutoff

    for (let i = 0; i < n; i++) {
      const origin = this.positions[i]
      const elementI = this.elements[i]
      let count = 0

      for (const image of this.imageShifts) {
        const px = origin[0] - image.shift[0]
        const py = origin[1] - image.shift[1]
        const pz = origin[2] - image.shift[2]
        const bx = Math.floor(px / c)
        const by = Math.floor(py / c)
        const bz = Math.floor(pz / c)

        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const list = this.buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
              if (!list) continue
              for (const idx of list) {
                const p = this.positions[idx]
                const ex = p[0] - px
                const ey = p[1] - py
                const ez = p[2] - pz
                const dSq = ex * ex + ey * ey + ez * ez
                // dSq ~ 0 is the atom itself under the identity image; any other
                // image of the same atom is a genuine neighbor.
                if (dSq > this.cutoffSq || dSq < 1e-12) continue
                if (pairCutoff) {
                  const limit = pairCutoff(elementI, this.elements[idx])
                  if (dSq > limit * limit) continue
                }
                count++
              }
            }
          }
        }
      }
      counts[i] = count
    }
    return counts
  }
}

/**
 * Fractional coordinates for every atom, or null without a usable lattice.
 * Kept here so callers share one inversion instead of inverting per atom.
 */
export const fractionalCoordinates = (structure: ZatomStructure): Vec3[] | null => {
  if (!structure.lattice) return null
  const lattice = toLatticeLike(structure.lattice.vectors)
  if (!isValidLattice(lattice)) return null
  const inv = invert3x3(lattice)
  if (!inv) return null
  return structure.atoms.map((atom) => {
    const [x, y, z] = atom.position
    // Row-vector convention: f = p · M⁻¹, matching `toFractional`'s inverse.
    return [
      inv[0][0] * x + inv[0][1] * y + inv[0][2] * z,
      inv[1][0] * x + inv[1][1] * y + inv[1][2] * z,
      inv[2][0] * x + inv[2][1] * y + inv[2][2] * z,
    ] as Vec3
  })
}
