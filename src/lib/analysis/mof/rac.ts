/**
 * Revised Autocorrelation (RAC) descriptors for MOF analysis.
 *
 * Reference: Janet, J. P. & Kulik, H. J. — "Resolving Transition Metal
 * Chemical Space: Feature Selection for Machine Learning and Structure-
 * Property Relationships." J. Phys. Chem. A 2017, 121, 8939-8954.
 *
 * This is a *simplified* implementation: we expose the metal-centred
 * (mc) and linker-centred (lc) scopes only; we do not split f-node /
 * f-linker / functional-group descriptors. That is enough for the
 * Inspector preview in the current UI integration.
 *
 * Given a centring atom A and a property `P`, for each depth d:
 *   - Product (P):       sum_{j @ depth d} prop(A) · prop(j)
 *   - Squared diff (D):  sum_{j @ depth d} (prop(A) - prop(j))²
 *
 * "Depth d" is the bond-graph shortest-path distance from A computed by
 * BFS over the bond list. Atoms unreachable from A do not contribute.
 *
 * Algorithm independently reimplemented from the published paper — no
 * code copied from molSimplify or any other RAC implementation.
 */

import { ELEMENTS, getElement } from '../../crystal/elements'
import { isMetal } from './metal-table'
import type { RacFeature, RacVector } from './types'

interface InputAtom {
  id: string
  element: string
  cartesian: [number, number, number]
}

interface InputBond {
  atom1Id: string
  atom2Id: string
}

type RacProperty = 'Z' | 'chi' | 'T' | 'I' | 'S' | 'alpha'
type RacKind = 'P' | 'D'

export interface RacOptions {
  /** Bond-graph depths to include. Default [1, 2, 3]. */
  depths?: number[]
  /** Properties to autocorrelate. Default all 6. */
  properties?: RacProperty[]
}

const DEFAULT_DEPTHS = [1, 2, 3]
const DEFAULT_PROPERTIES: RacProperty[] = ['Z', 'chi', 'T', 'I', 'S', 'alpha']

// ---------------------------------------------------------------------------
// Atomic property tables
//
// Sources:
//   - chi (Pauling EN):  Allred 1961 revisions and CRC Handbook;
//                         standard textbook values.
//   - alpha (atomic polarizability, Å³): Schwerdtfeger & Nagle 2019
//                         compilation of atomic dipole polarizabilities
//                         (Mol. Phys. 117, 1200).
//   - S (Mendeleev group): IUPAC 1-18 group numbering.
//
// Values are deliberately rounded to 3 sig figs — RAC vectors are coarse
// descriptors and the underlying experimental scatter is larger than the
// rounding error.
// ---------------------------------------------------------------------------

interface AtomicProps {
  chi: number       // Pauling electronegativity
  alpha: number     // Polarizability in Å³
  S: number         // Mendeleev / IUPAC group 1-18
}

const ATOMIC_PROPS: Record<string, AtomicProps> = {
  H:  { chi: 2.20, alpha: 0.667, S: 1 },
  Li: { chi: 0.98, alpha: 24.3,  S: 1 },
  Be: { chi: 1.57, alpha: 5.60,  S: 2 },
  B:  { chi: 2.04, alpha: 3.03,  S: 13 },
  C:  { chi: 2.55, alpha: 1.76,  S: 14 },
  N:  { chi: 3.04, alpha: 1.10,  S: 15 },
  O:  { chi: 3.44, alpha: 0.802, S: 16 },
  F:  { chi: 3.98, alpha: 0.557, S: 17 },
  Na: { chi: 0.93, alpha: 24.1,  S: 1 },
  Mg: { chi: 1.31, alpha: 10.6,  S: 2 },
  Al: { chi: 1.61, alpha: 6.80,  S: 13 },
  Si: { chi: 1.90, alpha: 5.38,  S: 14 },
  P:  { chi: 2.19, alpha: 3.63,  S: 15 },
  S:  { chi: 2.58, alpha: 2.90,  S: 16 },
  Cl: { chi: 3.16, alpha: 2.18,  S: 17 },
  K:  { chi: 0.82, alpha: 43.4,  S: 1 },
  Ca: { chi: 1.00, alpha: 22.8,  S: 2 },
  Sc: { chi: 1.36, alpha: 17.8,  S: 3 },
  Ti: { chi: 1.54, alpha: 14.6,  S: 4 },
  V:  { chi: 1.63, alpha: 12.4,  S: 5 },
  Cr: { chi: 1.66, alpha: 11.6,  S: 6 },
  Mn: { chi: 1.55, alpha: 9.40,  S: 7 },
  Fe: { chi: 1.83, alpha: 8.40,  S: 8 },
  Co: { chi: 1.88, alpha: 7.50,  S: 9 },
  Ni: { chi: 1.91, alpha: 6.80,  S: 10 },
  Cu: { chi: 1.90, alpha: 6.20,  S: 11 },
  Zn: { chi: 1.65, alpha: 5.75,  S: 12 },
  Ga: { chi: 1.81, alpha: 8.12,  S: 13 },
  Ge: { chi: 2.01, alpha: 5.84,  S: 14 },
  As: { chi: 2.18, alpha: 4.31,  S: 15 },
  Se: { chi: 2.55, alpha: 3.77,  S: 16 },
  Br: { chi: 2.96, alpha: 3.05,  S: 17 },
  Rb: { chi: 0.82, alpha: 47.3,  S: 1 },
  Sr: { chi: 0.95, alpha: 27.6,  S: 2 },
  Y:  { chi: 1.22, alpha: 22.7,  S: 3 },
  Zr: { chi: 1.33, alpha: 17.9,  S: 4 },
  Nb: { chi: 1.60, alpha: 15.7,  S: 5 },
  Mo: { chi: 2.16, alpha: 12.8,  S: 6 },
  Tc: { chi: 1.90, alpha: 11.4,  S: 7 },
  Ru: { chi: 2.20, alpha: 9.60,  S: 8 },
  Rh: { chi: 2.28, alpha: 8.60,  S: 9 },
  Pd: { chi: 2.20, alpha: 4.80,  S: 10 },
  Ag: { chi: 1.93, alpha: 7.20,  S: 11 },
  Cd: { chi: 1.69, alpha: 7.36,  S: 12 },
  I:  { chi: 2.66, alpha: 4.70,  S: 17 },
}

function propValueFor(element: string, prop: RacProperty, degree: number): number | null {
  if (prop === 'I') return 1
  if (prop === 'T') return degree
  if (prop === 'Z') {
    const ed = ELEMENTS[element]
    if (ed) return ed.atomicNumber
    const fallback = getElement(element)
    return fallback.atomicNumber > 0 ? fallback.atomicNumber : null
  }
  const entry = ATOMIC_PROPS[element]
  if (!entry) return null
  if (prop === 'chi') return entry.chi
  if (prop === 'alpha') return entry.alpha
  if (prop === 'S') return entry.S
  return null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the RAC feature vector centred on one atom.
 *
 * Unknown elements are SKIPPED at the contribution level — they don't
 * throw, they just don't add to the running sum. The output vector still
 * has the full {properties × depths × 2} cardinality so downstream code
 * can stack them.
 */
export function computeRac(
  atoms: InputAtom[],
  bonds: InputBond[],
  metal_atom_id: string,
  options: RacOptions = {},
): RacVector {
  const depths = options.depths ?? DEFAULT_DEPTHS
  const properties = options.properties ?? DEFAULT_PROPERTIES
  const kinds: RacKind[] = ['P', 'D']

  const atomById = new Map<string, InputAtom>(atoms.map((a) => [a.id, a]))
  const adj = buildAdjacency(atoms, bonds)
  const degree = computeDegrees(adj)

  const centre = atomById.get(metal_atom_id)
  if (!centre) {
    return { metal_atom_id, features: emptyFeatures(properties, depths, kinds) }
  }

  const distMap = bfsDistances(metal_atom_id, adj)
  const centrePropCache = new Map<RacProperty, number | null>()
  for (const p of properties) {
    centrePropCache.set(p, propValueFor(centre.element, p, degree.get(centre.id) ?? 0))
  }

  const features: RacFeature[] = []
  for (const property of properties) {
    for (const depth of depths) {
      const partners = [...distMap.entries()].filter(([, d]) => d === depth).map(([id]) => id)
      const centreVal = centrePropCache.get(property)

      let product = 0
      let diffSq = 0
      if (centreVal != null) {
        for (const pid of partners) {
          const p = atomById.get(pid)
          if (!p) continue
          const pv = propValueFor(p.element, property, degree.get(pid) ?? 0)
          if (pv == null) continue
          product += centreVal * pv
          const diff = centreVal - pv
          diffSq += diff * diff
        }
      }

      features.push({ property, depth, kind: 'P', scope: 'mc', value: product })
      features.push({ property, depth, kind: 'D', scope: 'mc', value: diffSq })
    }
  }

  return { metal_atom_id, features }
}

/**
 * Run `computeRac` for every metal atom in the structure (according to
 * the same metal-table the SBU detector uses). Returns one vector per
 * metal.
 */
export function computeAllMetalRacs(
  atoms: InputAtom[],
  bonds: InputBond[],
  options: RacOptions = {},
): RacVector[] {
  const result: RacVector[] = []
  for (const a of atoms) {
    if (isMetal(a.element)) {
      result.push(computeRac(atoms, bonds, a.id, options))
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAdjacency(atoms: InputAtom[], bonds: InputBond[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const a of atoms) adj.set(a.id, [])
  for (const b of bonds) {
    if (!adj.has(b.atom1Id)) adj.set(b.atom1Id, [])
    if (!adj.has(b.atom2Id)) adj.set(b.atom2Id, [])
    adj.get(b.atom1Id)!.push(b.atom2Id)
    adj.get(b.atom2Id)!.push(b.atom1Id)
  }
  return adj
}

function computeDegrees(adj: Map<string, string[]>): Map<string, number> {
  const deg = new Map<string, number>()
  for (const [k, v] of adj) deg.set(k, v.length)
  return deg
}

function bfsDistances(start: string, adj: Map<string, string[]>): Map<string, number> {
  const dist = new Map<string, number>()
  dist.set(start, 0)
  const queue: string[] = [start]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const d = dist.get(cur)!
    for (const nb of adj.get(cur) ?? []) {
      if (dist.has(nb)) continue
      dist.set(nb, d + 1)
      queue.push(nb)
    }
  }
  return dist
}

function emptyFeatures(properties: RacProperty[], depths: number[], kinds: RacKind[]): RacFeature[] {
  const out: RacFeature[] = []
  for (const property of properties) {
    for (const depth of depths) {
      for (const kind of kinds) {
        out.push({ property, depth, kind, scope: 'mc', value: 0 })
      }
    }
  }
  return out
}
