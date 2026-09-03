// Display-only periodic unwrapping for finite molecules. Canonical coordinates
// remain in-cell for export and computation; bonded fragments crossing a boundary
// are reconstructed only for rendering.

import type { Atom, Bond } from '../crystal/types'
import {
  FULLY_PERIODIC,
  invert3x3,
  isFiniteVec3,
  isValidLattice,
  toFractional,
  type LatticeLike,
  type PeriodicMask,
  type Vec3,
} from '../crystal/lattice-math'

export type { PeriodicMask } from '../crystal/lattice-math'

/**
 * Access limit: defensive cap to avoid pathological topology (loop + repeated adjacency) that will cause BFS to explode.
 */
const MAX_VISIT = 2_000_000

/** Place a child in the minimum-image position nearest its parent. */
function placeNearestImage(parent: Vec3, child: Vec3, inv: number[][], lattice: LatticeLike, mask: PeriodicMask): Vec3 {
  const dx = child[0] - parent[0]
  const dy = child[1] - parent[1]
  const dz = child[2] - parent[2]

  // fractional delta = inv · cartesian delta
  const [fa, fb, fc] = toFractional(inv, dx, dy, dz)

  // round to the nearest integer = the number of mirrors that should be deducted; non-periodic axes are not allowed to cross the boundary (the number of mirrors is forced to 0).
  const na = mask.a ? Math.round(fa) : 0
  const nb = mask.b ? Math.round(fb) : 0
  const nc = mask.c ? Math.round(fc) : 0

  const { a, b, c } = lattice
  // child_unwrapped = child − (na·a + nb·b + nc·c)
  return [
    child[0] - (na * a[0] + nb * b[0] + nc * c[0]),
    child[1] - (na * a[1] + nb * b[1] + nc * c[1]),
    child[2] - (na * a[2] + nb * b[2] + nc * c[2]),
  ]
}

/**
 * Reconstruct finite connected molecules by minimum-image BFS. Non-tree edges
 * detect lattice-winding cycles; extended periodic networks fall back to
 * canonical coordinates rather than unwrapping indefinitely. `excludeAtomId`
 * omits an actively dragged atom so its cursor position remains authoritative.
 */
export function computeUnwrappedDisplayPositions(
  atoms: Atom[],
  bonds: Bond[],
  lattice: LatticeLike | null | undefined,
  periodicMask: PeriodicMask = FULLY_PERIODIC,
  excludeAtomId?: string | null,
): Map<string, Vec3> {
  const result = new Map<string, Vec3>()
  if (!isValidLattice(lattice)) return result

  const inv = invert3x3(lattice)
  if (!inv) return result

  // canonical cartesian index (atoms with missing cartesian do not participate; atoms in drag are excluded).
  const canonical = new Map<string, Vec3>()
  for (const atom of atoms) {
    if (atom.id === excludeAtomId) continue
    if (isFiniteVec3(atom.cartesian)) canonical.set(atom.id, atom.cartesian)
  }
  if (canonical.size === 0) return result

  // Adjacency list: only keep keys with canonical coordinates on both ends.
  const adjacency = new Map<string, string[]>()
  const addEdge = (from: string, to: string) => {
    const list = adjacency.get(from)
    if (list) list.push(to)
    else adjacency.set(from, [to])
  }
  for (const bond of bonds) {
    if (!canonical.has(bond.atom1Id) || !canonical.has(bond.atom2Id)) continue
    if (bond.atom1Id === bond.atom2Id) continue
    addEdge(bond.atom1Id, bond.atom2Id)
    addEdge(bond.atom2Id, bond.atom1Id)
  }

  // A 0.5 Å closure tolerance separates numerical noise from lattice winding.
  const PERIODIC_TOL_SQ = 0.25

  const visited = new Set<string>()
  let visits = 0
  // Seed each atom; visited skips → naturally traverse all connected components.
  for (const seedId of canonical.keys()) {
    if (visited.has(seedId)) continue

    // Build one component locally while detecting periodic winding cycles.
    const componentPos = new Map<string, Vec3>()
    componentPos.set(seedId, canonical.get(seedId)!)
    const queue: string[] = [seedId]
    let extended = false

    while (queue.length > 0) {
      if (++visits > MAX_VISIT) {
        // Pathological traversal falls back to canonical coordinates.
        extended = true
        break
      }
      const parentId = queue.shift()!
      const parentPos = componentPos.get(parentId)!
      const neighbors = adjacency.get(parentId)
      if (!neighbors) continue
      for (const childId of neighbors) {
        const childCanonical = canonical.get(childId)
        if (!childCanonical) continue
        const placed = placeNearestImage(parentPos, childCanonical, inv, lattice, periodicMask)
        const existing = componentPos.get(childId)
        if (existing) {
          // A non-tree edge with nonzero minimum-image closure marks a periodic network.
          const ex = existing[0] - placed[0]
          const ey = existing[1] - placed[1]
          const ez = existing[2] - placed[2]
          if (ex * ex + ey * ey + ez * ez > PERIODIC_TOL_SQ) extended = true
          continue // Already placed atoms are not re-placed (the first time they are placed) - to prevent runaway.
        }
        componentPos.set(childId, placed)
        queue.push(childId)
      }
    }

    // Commit only finite components; omitted periodic networks render canonically.
    for (const [id, pos] of componentPos) {
      visited.add(id)
      if (!extended) result.set(id, pos)
    }
  }

  return result
}
