/**
 * Molecular packing for arbitrary species — solvation boxes, electrolytes,
 * mixtures, pore filling.
 *
 * ## Why this exists, and what it is not
 *
 * `water-layer.ts` already packs a periodic box by Monte-Carlo insertion, with
 * uniform SO(3) orientations, per-axis minimum-image distances and density
 * bookkeeping. That machinery is robust and this module reuses its shape. What
 * it cannot do is pack anything but water: the molecule, its mass and its
 * acceptance test are all hard-coded. An electrolyte, a solvent that is not
 * water, or a mixture had to be built by hand.
 *
 * ## The acceptance test, which is the part that was wrong
 *
 * The water packer accepts a trial molecule on one distance: O to O ≥ 2.5 Å.
 * With r(O–H) = 1.0 Å, two hydrogens pointing at each other across that contact
 * are 0.5 Å apart, and the criterion never looks. Measured on its own output —
 * 267 waters in a 20 Å cube at ρ = 1.0, seed 12345 — the true all-atom minimum
 * is **0.87 Å, H–H**. That is shorter than the bond in H₂ (0.74 Å). It is a hard
 * overlap, and any MD or DFT run started from it diverges on the first step.
 *
 * A representative-atom test cannot be repaired by raising its threshold,
 * because the geometry that produces the overlap is a rotation the test does not
 * see. So this module checks **every atom against every atom**, which is the
 * only criterion that means what "minimum distance" says.
 *
 * The cost is handled with a uniform spatial hash over the cell: neighbour
 * lookups are O(1) in the number of placed atoms, so packing stays linear.
 *
 * ## What is reported rather than assumed
 *
 * * `minSeparation` — the achieved all-atom minimum, measured on the result.
 *   Not the requested threshold; the number the structure actually has.
 * * `density` — computed from the masses actually placed, not from the target.
 * * `incomplete` / `placed` vs `requested` — a packer that cannot fit what it
 *   was asked for must say so. Returning a sparser box and calling it success
 *   is how a density ends up wrong by 20% with nothing in the record.
 */

import { ELEMENTS } from '../../crystal/elements'

import type { BuilderResult } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

export interface PackAtom {
  element: string
  /** Cartesian position in the molecule's own frame; any origin. */
  position: Vec3
}

export interface PackSpecies {
  /** Label used in the report, e.g. 'water', 'Li+', 'acetonitrile'. */
  name: string
  atoms: PackAtom[]
  /** Exact number to place. Mutually exclusive with `molFraction`. */
  count?: number
  /** Share of `totalCount`, when the caller specifies a total or a density. */
  molFraction?: number
}

export interface PackSoluteAtom {
  element: string
  cartesian: Vec3
}

export interface PackOptions {
  /** Periodic cell (row vectors a1, a2, a3). */
  lattice: Mat3
  species: PackSpecies[]
  /** Atoms already in the cell. Avoided during packing and kept in the output. */
  soluteAtoms?: PackSoluteAtom[]
  /**
  * Minimum centre-to-centre distance between atoms of different molecules (Å).
  * Default 2.0 — roughly a non-bonded contact between heavy atoms.
  */
  minDistance?: number
  /**
  * Per-element floor, applied as the larger of the two elements' entries.
  * Hydrogen wants a smaller value than carbon does; a single number forces
  * either loose heavy-atom contacts or an unpackably strict hydrogen one.
  */
  minDistanceByElement?: Record<string, number>
  /** Total molecules across all species; combined with each `molFraction`. */
  totalCount?: number
  /** Target mass density in g/cm³; converted to a count using the mixture mass. */
  targetDensity?: number
  /** Per-axis periodicity for the minimum-image test. Default all true. */
  pbc?: [boolean, boolean, boolean]
  /** Insertion attempts per molecule before giving up on it. Default 200. */
  maxAttemptsPerMolecule?: number
  /** Deterministic when set; a packing nobody can reproduce is not a result. */
  seed?: number
  /** Random rigid-body orientation per molecule. Default true. */
  randomOrientation?: boolean
}

export interface PackResult extends BuilderResult {
  placed: Record<string, number>
  requested: Record<string, number>
  /** From the masses actually placed, g/cm³. */
  density: number
  /**
   * Achieved minimum **intermolecular** separation under PBC, Å — measured.
   *
   * Intermolecular, not all-atom: a molecule's own bonds are shorter than any
   * packing floor and always would be, so an all-pairs minimum for a water box
   * just reports r(O–H) = 0.96 Å every time and says nothing about whether the
   * packing is valid.
   */
  minSeparation: number
  /**
   * Which molecule each emitted atom belongs to, in the order of `xyz`.
   * −1 marks a solute atom the packer did not place. Exposed because
   * "intermolecular" is not recoverable from an XYZ file, so a caller that
   * wants to re-measure the packing needs it.
   */
  moleculeIndex: number[]
  totalAttempts: number
  /** True when any species fell short of its request. */
  incomplete: boolean
}

const AVOGADRO = 6.02214076e23

function massOf(symbol: string): number {
  const e = ELEMENTS[symbol]
  if (!e) throw new Error(`pack: unknown element ${JSON.stringify(symbol)}`)
  return e.mass
}

function sub(u: Vec3, v: Vec3): Vec3 { return [u[0] - v[0], u[1] - v[1], u[2] - v[2]] }
function add(u: Vec3, v: Vec3): Vec3 { return [u[0] + v[0], u[1] + v[1], u[2] + v[2]] }

function det3(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function invert3(m: Mat3): Mat3 {
  const d = det3(m)
  if (Math.abs(d) < 1e-12) throw new Error('pack: the lattice is singular — no cell to fill')
  const i = 1 / d
  return [
    [
      (m[1][1] * m[2][2] - m[1][2] * m[2][1]) * i,
      (m[0][2] * m[2][1] - m[0][1] * m[2][2]) * i,
      (m[0][1] * m[1][2] - m[0][2] * m[1][1]) * i,
    ],
    [
      (m[1][2] * m[2][0] - m[1][0] * m[2][2]) * i,
      (m[0][0] * m[2][2] - m[0][2] * m[2][0]) * i,
      (m[0][2] * m[1][0] - m[0][0] * m[1][2]) * i,
    ],
    [
      (m[1][0] * m[2][1] - m[1][1] * m[2][0]) * i,
      (m[0][1] * m[2][0] - m[0][0] * m[2][1]) * i,
      (m[0][0] * m[1][1] - m[0][1] * m[1][0]) * i,
    ],
  ]
}

/** Row-vector lattice convention: cart = frac[0]a + frac[1]b + frac[2]c.
 *  With `inverseRows = inverse(lattice)`, fractional coordinates are therefore
 *  `inverseRows^T * cart`, not `inverseRows * cart`. */
function inverseRowsToFractional(inverseRows: Mat3, v: Vec3): Vec3 {
  return [
    inverseRows[0][0] * v[0] + inverseRows[1][0] * v[1] + inverseRows[2][0] * v[2],
    inverseRows[0][1] * v[0] + inverseRows[1][1] * v[1] + inverseRows[2][1] * v[2],
    inverseRows[0][2] * v[0] + inverseRows[1][2] * v[1] + inverseRows[2][2] * v[2],
  ]
}

/** Deterministic PRNG (mulberry32) — same generator the polycrystal builder uses. */
function makeRng(seed?: number): () => number {
  let a = (seed ?? 0x9e3779b9) >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Uniform random rotation in SO(3), via Rz(α)·Ry(β)·Rz(γ) with cos β sampled
 * uniformly. Sampling β itself uniformly instead would concentrate orientations
 * near the poles — the classic way to get a "random" packing whose molecules
 * all point roughly the same way.
 */
export function randomRotation(rng: () => number): Mat3 {
  const a = 2 * Math.PI * rng()
  const b = Math.acos(2 * rng() - 1)
  const c = 2 * Math.PI * rng()
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cc = Math.cos(c), sc = Math.sin(c)
  return [
    [ca * cb * cc - sa * sc, -ca * cb * sc - sa * cc, ca * sb],
    [sa * cb * cc + ca * sc, -sa * cb * sc + ca * cc, sa * sb],
    [-sb * cc, sb * sc, cb],
  ]
}

/**
 * Uniform spatial hash over the cell, in fractional coordinates.
 *
 * The all-atom acceptance test is the whole point of this module and it is also
 * the expensive part: without an index it is O(N²) in placed atoms, which for a
 * few thousand atoms is seconds per box. Bucketing by fractional cell keeps each
 * query to the 27 neighbouring buckets.
 */
class CellGrid {
  private readonly buckets = new Map<number, number[]>()
  private readonly n: [number, number, number]
  // Declared and assigned rather than written as constructor parameter
  // properties: this repo builds with `erasableSyntaxOnly`, and parameter
  // properties emit runtime assignments, so they are not type-erasable.
  private readonly invLattice: Mat3
  private readonly pbc: [boolean, boolean, boolean]

  constructor(
    invLattice: Mat3,
    pbc: [boolean, boolean, boolean],
    cutoff: number,
  ) {
    this.invLattice = invLattice
    this.pbc = pbc
    // A Cartesian displacement d changes fractional component i by g_i·d,
    // where g_i is column i of inverse(lattice). Choose bucket widths at least
    // cutoff*|g_i| so a close pair is always in the same/adjacent bucket even
    // for acute and triclinic cells.
    const safeCutoff = Math.max(cutoff, 1e-6)
    this.n = [0, 1, 2].map((axis) => {
      const reciprocalNorm = Math.hypot(
        invLattice[0][axis],
        invLattice[1][axis],
        invLattice[2][axis],
      )
      return Math.max(1, Math.floor(1 / Math.max(safeCutoff * reciprocalNorm, 1e-12)))
    }) as [number, number, number]
  }

  private key(i: number, j: number, k: number): number {
    return (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
  }

  private cellOf(p: Vec3): [number, number, number] {
    const f = inverseRowsToFractional(this.invLattice, p)
    return [0, 1, 2].map((d) => {
      const t = this.pbc[d] ? f[d] - Math.floor(f[d]) : f[d]
      let idx = Math.floor(t * this.n[d])
      if (this.pbc[d] && idx >= this.n[d]) idx = this.n[d] - 1
      if (this.pbc[d] && idx < 0) idx = 0
      return idx
    }) as [number, number, number]
  }

  insert(p: Vec3, id: number): void {
    const [i, j, k] = this.cellOf(p)
    const key = this.key(i, j, k)
    const bucket = this.buckets.get(key)
    if (bucket) bucket.push(id)
    else this.buckets.set(key, [id])
  }

  /** Ids in the 27 buckets around `p`. May contain duplicates when n < 3. */
  near(p: Vec3): number[] {
    const [ci, cj, ck] = this.cellOf(p)
    const out: number[] = []
    const seen = new Set<number>()
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (let dk = -1; dk <= 1; dk++) {
          const i = this.pbc[0] ? ((ci + di) % this.n[0] + this.n[0]) % this.n[0] : ci + di
          const j = this.pbc[1] ? ((cj + dj) % this.n[1] + this.n[1]) % this.n[1] : cj + dj
          const k = this.pbc[2] ? ((ck + dk) % this.n[2] + this.n[2]) % this.n[2] : ck + dk
          if (i < 0 || j < 0 || k < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) continue
          const key = this.key(i, j, k)
          if (seen.has(key)) continue
          seen.add(key)
          const bucket = this.buckets.get(key)
          if (bucket) out.push(...bucket)
        }
    return out
  }
}

function minimumImageSq(p: Vec3, q: Vec3, lattice: Mat3, inv: Mat3, pbc: [boolean, boolean, boolean]): number {
  const d = sub(p, q)
  if (!pbc[0] && !pbc[1] && !pbc[2]) return d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
  const f = inverseRowsToFractional(inv, d)
  for (let i = 0; i < 3; i++) if (pbc[i]) f[i] -= Math.round(f[i])
  const cx = f[0] * lattice[0][0] + f[1] * lattice[1][0] + f[2] * lattice[2][0]
  const cy = f[0] * lattice[0][1] + f[1] * lattice[1][1] + f[2] * lattice[2][1]
  const cz = f[0] * lattice[0][2] + f[1] * lattice[1][2] + f[2] * lattice[2][2]
  return cx * cx + cy * cy + cz * cz
}

/** Centre of a molecule's atoms, so a trial position places the centre. */
function centroid(atoms: PackAtom[]): Vec3 {
  const c: Vec3 = [0, 0, 0]
  for (const a of atoms) { c[0] += a.position[0]; c[1] += a.position[1]; c[2] += a.position[2] }
  return [c[0] / atoms.length, c[1] / atoms.length, c[2] / atoms.length]
}

function speciesMass(s: PackSpecies): number {
  return s.atoms.reduce((sum, a) => sum + massOf(a.element), 0)
}

export function packMolecules(options: PackOptions): PackResult {
  const {
    lattice,
    species,
    soluteAtoms = [],
    minDistance = 2.0,
    minDistanceByElement,
    totalCount,
    targetDensity,
    pbc = [true, true, true],
    maxAttemptsPerMolecule = 200,
    seed,
    randomOrientation = true,
  } = options

  if (!species.length) throw new Error('pack: no species to place')
  for (const s of species) {
    if (!s.atoms.length) throw new Error(`pack: species ${JSON.stringify(s.name)} has no atoms`)
  }
  if (!(minDistance > 0)) throw new Error(`pack: minDistance must be positive (got ${minDistance})`)

  const inv = invert3(lattice)
  const volumeA3 = Math.abs(det3(lattice))
  if (!(volumeA3 > 0)) throw new Error('pack: the cell has no volume')

  // ── how many of each ─────────────────────────────────────────────────────
  const requested: Record<string, number> = {}
  const explicit = species.every((s) => typeof s.count === 'number')
  if (explicit) {
    for (const s of species) requested[s.name] = Math.max(0, Math.floor(s.count as number))
  } else {
    const fractions = species.map((s) => s.molFraction ?? 1 / species.length)
    const fracSum = fractions.reduce((a, b) => a + b, 0)
    if (!(fracSum > 0)) throw new Error('pack: mole fractions sum to zero')
    let total: number
    if (typeof totalCount === 'number') {
      total = Math.max(0, Math.floor(totalCount))
    } else if (typeof targetDensity === 'number') {
      // Mixture mass per "average molecule", weighted by mole fraction — the
      // right denominator for a mixture, where using one species' mass would
      // scale the whole box by the ratio of the two masses.
      const avgMass = species.reduce((sum, s, i) => sum + (fractions[i] / fracSum) * speciesMass(s), 0)
      if (!(avgMass > 0)) throw new Error('pack: mixture has zero mass')
      total = Math.round((targetDensity * volumeA3 * 1e-24 * AVOGADRO) / avgMass)
    } else {
      throw new Error('pack: give each species a count, or a totalCount, or a targetDensity')
    }
    let assigned = 0
    species.forEach((s, i) => {
      const n = i === species.length - 1
        ? total - assigned
        : Math.round((fractions[i] / fracSum) * total)
      requested[s.name] = Math.max(0, n)
      assigned += requested[s.name]
    })
  }

  // ── acceptance thresholds ────────────────────────────────────────────────
  const floorFor = (a: string, b: string): number => {
    if (!minDistanceByElement) return minDistance
    const ea = minDistanceByElement[a]
    const eb = minDistanceByElement[b]
    if (ea === undefined && eb === undefined) return minDistance
    // The larger of the two elements' floors: a pair is only as permissive as
    // its stricter member, and taking the smaller would let the loose element
    // decide contacts the strict one was meant to prevent.
    return Math.max(ea ?? minDistance, eb ?? minDistance)
  }
  const maxFloor = minDistanceByElement
    ? Math.max(minDistance, ...Object.values(minDistanceByElement))
    : minDistance

  // ── the growing structure ────────────────────────────────────────────────
  const outElements: string[] = []
  const outPositions: Vec3[] = []
  const outMolecule: number[] = []
  const grid = new CellGrid(inv, pbc, maxFloor)
  for (const s of soluteAtoms) {
    outElements.push(s.element)
    outPositions.push([...s.cartesian] as Vec3)
    outMolecule.push(-1)
    grid.insert(s.cartesian, outPositions.length - 1)
  }
  let moleculeCounter = 0

  const rng = makeRng(seed)
  const identity: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const placed: Record<string, number> = {}
  let totalAttempts = 0

  for (const s of species) {
    const want = requested[s.name] ?? 0
    placed[s.name] = 0
    const c = centroid(s.atoms)
    const local = s.atoms.map((a) => sub(a.position, c))
    const budget = Math.max(1, maxAttemptsPerMolecule) * Math.max(1, want)
    let attempts = 0

    while (placed[s.name] < want && attempts < budget) {
      attempts++
      totalAttempts++
      const f: Vec3 = [rng(), rng(), rng()]
      const origin: Vec3 = [
        f[0] * lattice[0][0] + f[1] * lattice[1][0] + f[2] * lattice[2][0],
        f[0] * lattice[0][1] + f[1] * lattice[1][1] + f[2] * lattice[2][1],
        f[0] * lattice[0][2] + f[1] * lattice[1][2] + f[2] * lattice[2][2],
      ]
      const R = randomOrientation ? randomRotation(rng) : identity
      const trial: Vec3[] = local.map((v) => add(origin, [
        R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
        R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
        R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
      ] as Vec3))

      // A non-periodic axis is a physical wall rather than a wrapping
      // direction. Reject a rigid molecule that protrudes through it; wrapping
      // individual atoms would tear the molecule apart.
      const contained = trial.every((p) => {
        const frac = inverseRowsToFractional(inv, p)
        return [0, 1, 2].every((axis) => (
          pbc[axis] || (frac[axis] >= -1e-10 && frac[axis] < 1 - 1e-10)
        ))
      })
      if (!contained) continue

      // Every atom of the trial molecule against every nearby placed atom —
      // the criterion this module exists for.
      let ok = true
      for (let ai = 0; ai < trial.length && ok; ai++) {
        const p = trial[ai]
        const elemA = s.atoms[ai].element
        for (const id of grid.near(p)) {
          const floor = floorFor(elemA, outElements[id])
          if (minimumImageSq(p, outPositions[id], lattice, inv, pbc) < floor * floor) {
            ok = false
            break
          }
        }
      }
      if (!ok) continue

      for (let ai = 0; ai < trial.length; ai++) {
        outElements.push(s.atoms[ai].element)
        outPositions.push(trial[ai])
        outMolecule.push(moleculeCounter)
        grid.insert(trial[ai], outPositions.length - 1)
      }
      moleculeCounter++
      placed[s.name]++
    }
  }

  // ── report what actually came out ────────────────────────────────────────
  let placedMass = 0
  for (const s of species) placedMass += (placed[s.name] ?? 0) * speciesMass(s)
  const density = (placedMass / AVOGADRO) / (volumeA3 * 1e-24)

  // Intermolecular pairs only. Two atoms of the same molecule are held at their
  // bond length by construction and are not what the packing floor governs;
  // including them makes this field report r(O–H) forever. Solute–solute pairs
  // are excluded for the same reason — the packer did not place them and has no
  // say over how close they are.
  let minSepSq = Infinity
  const probeGrid = new CellGrid(inv, pbc, maxFloor)
  for (let i = 0; i < outPositions.length; i++) probeGrid.insert(outPositions[i], i)
  for (let i = 0; i < outPositions.length; i++) {
    for (const j of probeGrid.near(outPositions[i])) {
      if (j <= i) continue
      if (outMolecule[i] === outMolecule[j]) continue
      const d2 = minimumImageSq(outPositions[i], outPositions[j], lattice, inv, pbc)
      if (d2 < minSepSq) minSepSq = d2
    }
  }
  const minSeparation = Number.isFinite(minSepSq) ? Math.sqrt(minSepSq) : 0

  const incomplete = species.some((s) => (placed[s.name] ?? 0) < (requested[s.name] ?? 0))
  const shortfall = species
    .filter((s) => (placed[s.name] ?? 0) < (requested[s.name] ?? 0))
    .map((s) => `${s.name} ${placed[s.name]}/${requested[s.name]}`)
    .join(', ')

  const composition: Record<string, number> = {}
  for (const el of outElements) composition[el] = (composition[el] ?? 0) + 1

  const lat = lattice.flat().map((v) => v.toFixed(8)).join(' ')
  const xyz = [
    String(outElements.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 packed_density="${density.toFixed(4)}"`,
    ...outElements.map((el, i) =>
      `${el} ${outPositions[i][0].toFixed(8)} ${outPositions[i][1].toFixed(8)} ${outPositions[i][2].toFixed(8)}`),
  ].join('\n')

  const description =
    `packed ${species.map((s) => `${placed[s.name]}× ${s.name}`).join(' + ')} ` +
    `into ${volumeA3.toFixed(0)} Å³ — ρ = ${density.toFixed(3)} g/cm³, ` +
    `closest contact ${minSeparation.toFixed(2)} Å (floor ${minDistance} Å)` +
    (incomplete ? `. INCOMPLETE: ${shortfall} — the box would not take the rest.` : '')

  return {
    xyz,
    description,
    n_atoms: outElements.length,
    composition,
    placed,
    requested,
    density,
    minSeparation,
    moleculeIndex: outMolecule,
    totalAttempts,
    incomplete,
  }
}
