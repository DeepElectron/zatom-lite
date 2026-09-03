/**
 * Secondary Building Unit (SBU) detection for MOF analysis.
 *
 * The algorithm operates on the *Cartesian* image of the structure
 * supplied by the caller and on the pre-computed bond list. It does NOT
 * perform any periodic-image expansion. Callers that need to capture
 * SBUs spanning unit-cell boundaries should pre-supercell the structure
 * (e.g. 2×2×2) before calling. We emit a warning when we suspect a
 * cell-spanning SBU was missed.
 *
 * The pipeline is:
 *
 *   1. Build a bond adjacency map.
 *   2. Label atoms as metal / non-metal via `isMetal`.
 *   3. Union-find on metals: two metals are merged if
 *        (a) their Cartesian distance ≤ `metal_metal_cutoff`, or
 *        (b) they share a bridging donor (O/N/S/...) within
 *            `oxo_bridge_cutoff` of both.
 *   4. Union-find on non-metals along ordinary bonds (excluding
 *      metal–donor edges). Each connected non-metal component becomes a
 *      candidate linker / capping group.
 *   5. Capping detection: small (<=3 atoms) or only-H/O groups are
 *      relabelled as `capping`.
 *   6. Classify each metal cluster: monomer / paddle-wheel / oxocluster /
 *      generic cluster.
 *   7. Points of extension: atoms with at least one bond into a
 *      different SBU.
 *   8. Formula: per-element atom count, formatted with Hill ordering
 *      (metals first, then C, then H, then alphabetical).
 *
 * License note: this is an independent reimplementation. No code was
 * copied from the CatGo AGPL Rust implementation; only the high-level
 * algorithm shape (which is described in the published literature) is
 * shared.
 */

import { isCommonDonor, isMetal } from './metal-table'
import type { SBU, SBUKind, SbuDetectionResult } from './types'

type Vec3 = [number, number, number]

interface InputAtom {
  id: string
  element: string
  cartesian: Vec3
}

interface InputBond {
  atom1Id: string
  atom2Id: string
}

export interface SbuDetectionOptions {
  /** Bond cutoff factor × sum-of-covalent-radii. Default 1.2. */
  bond_cutoff_factor?: number
  /** Treat M-M distance ≤ this (Å) as metal-metal bond. Default 3.5. */
  metal_metal_cutoff?: number
  /**
  * When two metal centres share a bridging non-metal donor within this
  * distance of both, group them. Default 2.6 Å — wide enough for μ-O,
  * μ-OH, μ-OH₂ bridges but tight enough to avoid spurious matches.
  */
  oxo_bridge_cutoff?: number
}

const DEFAULT_OPTS: Required<SbuDetectionOptions> = {
  bond_cutoff_factor: 1.2,
  metal_metal_cutoff: 3.5,
  oxo_bridge_cutoff: 2.6,
}

// --- Disjoint set (union-find) -------------------------------------------------

class DSU {
  parent: Map<string, string> = new Map()

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id)
  }

  find(id: string): string {
    let p = this.parent.get(id) ?? id
    if (p === id) return id
    const root = this.find(p)
    this.parent.set(id, root)
    return root
  }

  union(a: string, b: string): void {
    this.add(a)
    this.add(b)
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

// --- Geometry helpers ---------------------------------------------------------

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// --- Main detector ------------------------------------------------------------

/**
 * Group atoms into SBUs given a Cartesian structure and a bond list.
 *
 * Edge cases:
 *   - An empty input returns an empty result with no warnings.
 *   - Atoms with no bonds and no group assignment land in their own
 *     trivial SBU (capping for non-metals, monomer for metals).
 *   - PBC-spanning bonds are honoured if present in the `bonds` array,
 *     but we never *guess* PBC bonds ourselves — if your bond list was
 *     pre-filtered to a single image, supercell first.
 */
export function detectSbus(
  atoms: InputAtom[],
  bonds: InputBond[],
  options: SbuDetectionOptions = {},
): SbuDetectionResult {
  const opts: Required<SbuDetectionOptions> = { ...DEFAULT_OPTS, ...options }
  const warnings: string[] = []

  if (atoms.length === 0) {
    return { sbus: [], atom_to_sbu: {}, warnings }
  }

  const atomById = new Map<string, InputAtom>(atoms.map((a) => [a.id, a]))

  // Build adjacency: id → list of neighbour ids.
  const adj = new Map<string, string[]>()
  for (const a of atoms) adj.set(a.id, [])
  for (const b of bonds) {
    if (!atomById.has(b.atom1Id) || !atomById.has(b.atom2Id)) continue
    adj.get(b.atom1Id)!.push(b.atom2Id)
    adj.get(b.atom2Id)!.push(b.atom1Id)
  }

  const isMetalAtom = new Map<string, boolean>()
  for (const a of atoms) isMetalAtom.set(a.id, isMetal(a.element))

  const metalIds = atoms.filter((a) => isMetalAtom.get(a.id)).map((a) => a.id)
  const nonMetalIds = atoms.filter((a) => !isMetalAtom.get(a.id)).map((a) => a.id)

  // --- Step 3: union-find on metals -----------------------------------------
  const dsuMetal = new DSU()
  for (const m of metalIds) dsuMetal.add(m)

  // 3a: short M-M distance.
  for (let i = 0; i < metalIds.length; i++) {
    for (let j = i + 1; j < metalIds.length; j++) {
      const a = atomById.get(metalIds[i])!
      const b = atomById.get(metalIds[j])!
      if (dist(a.cartesian, b.cartesian) <= opts.metal_metal_cutoff) {
        dsuMetal.union(metalIds[i], metalIds[j])
      }
    }
  }

  // 3b: bridging donor. For each non-metal donor atom, find all metals
  // within `oxo_bridge_cutoff` Å and union them together.
  for (const donorId of nonMetalIds) {
    const donor = atomById.get(donorId)!
    if (!isCommonDonor(donor.element)) continue
    const closeMetals: string[] = []
    for (const m of metalIds) {
      const ma = atomById.get(m)!
      if (dist(donor.cartesian, ma.cartesian) <= opts.oxo_bridge_cutoff) {
        closeMetals.push(m)
      }
    }
    for (let i = 1; i < closeMetals.length; i++) {
      dsuMetal.union(closeMetals[0], closeMetals[i])
    }
  }

  // --- Step 4: union-find on non-metals along organic bonds -----------------
  const dsuNonMetal = new DSU()
  for (const nm of nonMetalIds) dsuNonMetal.add(nm)
  for (const b of bonds) {
    const a1 = atomById.get(b.atom1Id)
    const a2 = atomById.get(b.atom2Id)
    if (!a1 || !a2) continue
    const m1 = isMetalAtom.get(b.atom1Id)
    const m2 = isMetalAtom.get(b.atom2Id)
    if (m1 || m2) continue // skip metal-anything bonds (donor edges)
    dsuNonMetal.union(b.atom1Id, b.atom2Id)
  }

  // --- Aggregate groups -----------------------------------------------------
  const metalGroups = new Map<string, string[]>()
  for (const m of metalIds) {
    const r = dsuMetal.find(m)
    if (!metalGroups.has(r)) metalGroups.set(r, [])
    metalGroups.get(r)!.push(m)
  }

  const nonMetalGroups = new Map<string, string[]>()
  for (const nm of nonMetalIds) {
    const r = dsuNonMetal.find(nm)
    if (!nonMetalGroups.has(r)) nonMetalGroups.set(r, [])
    nonMetalGroups.get(r)!.push(nm)
  }

  // --- Step 6: classify metal clusters --------------------------------------
  const sbus: SBU[] = []
  const atomToSbu: Record<string, string> = {}

  let sbuCounter = 0
  const nextId = (prefix: string) => `${prefix}-${++sbuCounter}`

  for (const groupAtoms of metalGroups.values()) {
    const kind: SBUKind = classifyMetalCluster(groupAtoms, atomById, bonds)
    const id = nextId('sbu-metal')
    sbus.push({
      id,
      kind,
      atom_ids: [...groupAtoms],
      formula: '', // filled after step 8
      points_of_extension: [], // filled after step 7
    })
    for (const a of groupAtoms) atomToSbu[a] = id
  }

  // --- Step 5: capping detection for non-metal groups -----------------------
  for (const groupAtoms of nonMetalGroups.values()) {
    const els = groupAtoms.map((id) => atomById.get(id)!.element)
    const onlyHO = els.every((e) => e === 'H' || e === 'O')
    const small = groupAtoms.length <= 3
    const kind: SBUKind = (onlyHO || small) ? 'capping' : 'linker'
    const id = nextId(kind === 'capping' ? 'sbu-cap' : 'sbu-link')
    sbus.push({
      id,
      kind,
      atom_ids: [...groupAtoms],
      formula: '',
      points_of_extension: [],
    })
    for (const a of groupAtoms) atomToSbu[a] = id
  }

  // --- Step 7: points of extension ------------------------------------------
  for (const sbu of sbus) {
    const inSet = new Set(sbu.atom_ids)
    const poe = new Set<string>()
    for (const a of sbu.atom_ids) {
      const neighbours = adj.get(a) ?? []
      for (const n of neighbours) {
        if (!inSet.has(n)) {
          poe.add(a)
          break
        }
      }
    }
    sbu.points_of_extension = [...poe]
  }

  // --- Step 8: composition formulas -----------------------------------------
  for (const sbu of sbus) {
    sbu.formula = composeFormula(sbu.atom_ids.map((id) => atomById.get(id)!.element))
  }

  // --- PBC heuristic warning ------------------------------------------------
  // If a "metal monomer" SBU's only neighbour over the bond list is itself
  // a single-atom group AND a metal sits at fractional ≈ 1.0 image of
  // another, we can't tell from Cartesian alone — flag the suggestion.
  // Heuristic: a SBU labelled metal_monomer whose only bonded neighbour
  // belongs to a different metal_monomer SBU (and they are close enough
  // that they "should" be a cluster) is a strong PBC hint.
  for (const sbu of sbus) {
    if (sbu.kind !== 'metal_monomer') continue
    const metalId = sbu.atom_ids[0]
    const metal = atomById.get(metalId)!
    for (const other of sbus) {
      if (other.id === sbu.id) continue
      if (other.kind !== 'metal_monomer') continue
      const otherMetal = atomById.get(other.atom_ids[0])!
      const d = dist(metal.cartesian, otherMetal.cartesian)
      if (d > opts.metal_metal_cutoff && d < opts.metal_metal_cutoff * 1.5) {
        warnings.push(
          `metals ${metalId} and ${other.atom_ids[0]} are close to the M-M cutoff (${d.toFixed(2)} Å); consider supercelling for PBC-spanning SBUs`,
        )
        break
      }
    }
  }

  return { sbus, atom_to_sbu: atomToSbu, warnings }
}

/**
 * Classify a connected group of metal atoms.
 *
 * - 1 metal                                      → metal_monomer
 * - 2 metals + 4 carboxylate carbons within 3 Å  → metal_paddlewheel
 * - ≥3 metals sharing a μ-O within 2.0 Å of all  → metal_oxocluster
 * - otherwise                                    → metal_cluster
 */
function classifyMetalCluster(
  groupAtoms: string[],
  atomById: Map<string, InputAtom>,
  bonds: InputBond[],
): SBUKind {
  const n = groupAtoms.length
  if (n === 1) return 'metal_monomer'

  if (n === 2) {
    // Paddle-wheel: count carboxylate-like carbons within 3 Å of either metal.
    // A carbon counts if it is bonded to at least 2 oxygens.
    const adj = buildAdj(bonds)
    const carbonCounts = new Set<string>()
    const m1 = atomById.get(groupAtoms[0])!
    const m2 = atomById.get(groupAtoms[1])!
    for (const [id, a] of atomById) {
      if (a.element !== 'C') continue
      const dC1 = dist(a.cartesian, m1.cartesian)
      const dC2 = dist(a.cartesian, m2.cartesian)
      if (dC1 > 3.0 && dC2 > 3.0) continue
      const oxoNeighbours = (adj.get(id) ?? []).filter((nid) => atomById.get(nid)?.element === 'O')
      if (oxoNeighbours.length >= 2) carbonCounts.add(id)
    }
    if (carbonCounts.size >= 4) return 'metal_paddlewheel'
    return 'metal_cluster'
  }

  if (n >= 3) {
    // Oxocluster: find a μ_n-O within 2.0 Å of EVERY metal in the group.
    for (const [, a] of atomById) {
      if (a.element !== 'O') continue
      let bridgesAll = true
      for (const m of groupAtoms) {
        const ma = atomById.get(m)!
        if (dist(a.cartesian, ma.cartesian) > 2.0) {
          bridgesAll = false
          break
        }
      }
      if (bridgesAll) return 'metal_oxocluster'
    }
    return 'metal_cluster'
  }

  return 'metal_cluster'
}

function buildAdj(bonds: InputBond[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const b of bonds) {
    if (!adj.has(b.atom1Id)) adj.set(b.atom1Id, [])
    if (!adj.has(b.atom2Id)) adj.set(b.atom2Id, [])
    adj.get(b.atom1Id)!.push(b.atom2Id)
    adj.get(b.atom2Id)!.push(b.atom1Id)
  }
  return adj
}

/**
 * Format an element-count list as a Hill-like formula. Examples:
 *   ['Cu', 'Cu', 'O', 'O', 'O', 'O', 'C'] → "Cu2C1O4"
 * For MOF-friendly output we list metals first, then C, then H, then
 * alphabetical for everything else.
 */
function composeFormula(elements: string[]): string {
  const counts: Record<string, number> = {}
  for (const e of elements) counts[e] = (counts[e] ?? 0) + 1
  const keys = Object.keys(counts)
  // metals first (any element flagged metal), then C, then H, then a-z.
  keys.sort((a, b) => {
    const ma = isMetal(a) ? 0 : a === 'C' ? 1 : a === 'H' ? 2 : 3
    const mb = isMetal(b) ? 0 : b === 'C' ? 1 : b === 'H' ? 2 : 3
    if (ma !== mb) return ma - mb
    return a.localeCompare(b)
  })
  return keys.map((k) => `${k}${counts[k]}`).join('')
}
