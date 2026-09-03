/**
 * Conservative non-covalent-contact heuristics for structures without residue
 * annotations. Candidate hydrogen bonds are N/O/F heavy-atom pairs separated
 * by 2.4–3.5 Å, excluding bonded 1–2 and shared-neighbor 1–3 pairs. A uniform
 * grid avoids an O(N²) scan.
 */

import type { Atom, Bond } from '../crystal/types'

export interface GenericContactCandidate {
  type: 'hydrogen-bond-candidate'
  atomId1: string
  atomId2: string
  start: [number, number, number]
  end: [number, number, number]
  distance: number
  qualification: 'distance-and-atom-type-only'
}

const POLAR_ELEMENTS = new Set(['N', 'O', 'F'])
const MIN_DISTANCE = 2.4
const MAX_DISTANCE = 3.5

function atomPosition(atom: Atom): [number, number, number] | null {
  const p = atom.cartesian ?? atom.position
  if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return null
  return [p[0], p[1], p[2]]
}

/**
 * Detect candidate hydrogen bonding contacts between N/O/F heavy atoms.
 * A nonempty `restrictToAtomIds` keeps only contacts touching the selection.
 */
export function detectGenericContactCandidates(
  atoms: readonly Atom[],
  bonds: readonly Bond[],
  restrictToAtomIds?: ReadonlySet<string>,
): GenericContactCandidate[] {
  // Bond adjacency also supports 1–3 exclusion.
  const neighbors = new Map<string, Set<string>>()
  for (const bond of bonds) {
    let set1 = neighbors.get(bond.atom1Id)
    if (!set1) { set1 = new Set(); neighbors.set(bond.atom1Id, set1) }
    set1.add(bond.atom2Id)
    let set2 = neighbors.get(bond.atom2Id)
    if (!set2) { set2 = new Set(); neighbors.set(bond.atom2Id, set2) }
    set2.add(bond.atom1Id)
  }

  interface Entry { id: string; position: [number, number, number] }
  const polar: Entry[] = []
  for (const atom of atoms) {
    if (!POLAR_ELEMENTS.has(atom.element)) continue
    const position = atomPosition(atom)
    if (!position) continue
    polar.push({ id: atom.id, position })
  }
  if (polar.length < 2) return []

  // Uniform grid: cell = MAX_DISTANCE, check 27 neighbourhoods.
  const cell = MAX_DISTANCE
  const grid = new Map<string, Entry[]>()
  for (const entry of polar) {
    const key = `${Math.floor(entry.position[0] / cell)},${Math.floor(entry.position[1] / cell)},${Math.floor(entry.position[2] / cell)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(entry)
    else grid.set(key, [entry])
  }

  const results: GenericContactCandidate[] = []
  const seen = new Set<string>()
  for (const entry of polar) {
    const cx = Math.floor(entry.position[0] / cell)
    const cy = Math.floor(entry.position[1] / cell)
    const cz = Math.floor(entry.position[2] / cell)
    const entryNeighbors = neighbors.get(entry.id)
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
          if (!bucket) continue
          for (const other of bucket) {
            if (other.id <= entry.id) continue // Process each unordered pair once.
            const pairKey = `${entry.id}|${other.id}`
            if (seen.has(pairKey)) continue
            seen.add(pairKey)
            // Exclude bonded 1–2 pairs.
            if (entryNeighbors?.has(other.id)) continue
            // Exclude 1–3 pairs that share a bonded neighbor.
            const otherNeighbors = neighbors.get(other.id)
            if (entryNeighbors && otherNeighbors) {
              let shared = false
              for (const n of entryNeighbors) {
                if (otherNeighbors.has(n)) { shared = true; break }
              }
              if (shared) continue
            }
            if (restrictToAtomIds && restrictToAtomIds.size > 0
              && !restrictToAtomIds.has(entry.id) && !restrictToAtomIds.has(other.id)) continue
            const d = Math.hypot(
              entry.position[0] - other.position[0],
              entry.position[1] - other.position[1],
              entry.position[2] - other.position[2],
            )
            if (d < MIN_DISTANCE || d > MAX_DISTANCE) continue
            results.push({
              type: 'hydrogen-bond-candidate',
              atomId1: entry.id,
              atomId2: other.id,
              start: entry.position,
              end: other.position,
              distance: d,
              qualification: 'distance-and-atom-type-only',
            })
          }
        }
      }
    }
  }
  return results
}
