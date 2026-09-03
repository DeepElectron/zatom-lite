/**
 * Water-layer / box-fill builder (PR-H).
 *
 * Pure-TS Monte-Carlo packing of rigid-water molecules into either:
 *
 *   Mode A — Box fill (Packmol-style, periodic):
 *     Given a periodic lattice and (optionally) solute atoms inside it, place
 *     `target_count` water molecules at random positions / orientations until
 *     either the target is reached or the attempt budget is exhausted.
 *
 *   Mode B — Surface layer (slab + water on top):
 *     Given a slab whose surface normal is `surface_up` (default +z), grow a
 *     water layer of thickness `layer_thickness` Å above (and/or below) the
 *     topmost slab atom, separated by `surface_offset`.
 *
 * Acceptance / rejection:
 *   - O–solute distance ≥ `min_solute_distance` (default 2.3 Å).
 *   - O–O distance to all previously placed waters ≥ `min_water_water_distance`
 *     (default 2.5 Å). PBC-aware: minimum-image convention is used along any
 *     cell vector that is fully populated (in surface mode the c-axis is open,
 *     so we skip wrapping there).
 *
 * Water geometry presets (SPC/E default):
 *   - SPC/E: r_OH = 1.0     Å, ∠HOH = 109.47°
 *   - TIP3P: r_OH = 0.9572  Å, ∠HOH = 104.52°
 *   - TIP4P: r_OH = 0.9572  Å, ∠HOH = 104.52°  (same H positions; no M-site)
 *
 * The output is extended-XYZ ready for `crystalStore.loadFromXYZ`, with
 * `Lattice="..."` derived from the input lattice (Mode A) or the slab lattice
 * plus an extended c-axis to enclose the new water layer (Mode B).
 *
 * Determinism: pass `seed` to drive a Mulberry32 PRNG; the same seed yields the
 * same placements.
 *
 * No CatGo / AGPL source consulted — algorithm is the standard random-sampling
 * MC packing approach.
 */

import type { BuilderResult } from './types'

export type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

export type WaterModel = 'SPC/E' | 'TIP3P' | 'TIP4P'

export interface WaterSoluteAtom {
  element: string
  cartesian: Vec3
}

export interface WaterFillOptions {
  mode: 'box' | 'surface'
  /** Periodic lattice for 'box' mode, OR the slab lattice for 'surface' mode. */
  lattice: Mat3
  /** Solute / slab atoms (kept verbatim in the output). */
  solute_atoms?: WaterSoluteAtom[]
  /** Surface mode only: surface up vector (default +z). */
  surface_up?: Vec3
  /** Surface mode only: water layer thickness in Å above top of slab. */
  layer_thickness?: number
  /** Surface mode only: which side of the slab to add water to. */
  side?: 'top' | 'bottom' | 'both'
  /** Surface mode only: separation from topmost slab atom to closest water O. */
  surface_offset?: number
  /** Target density g/cm³, default 1.0. */
  density?: number
  /** Force a specific count (overrides density if set). */
  target_count?: number
  /** Min O-to-solute distance (Å); default 2.3. */
  min_solute_distance?: number
  /** Min water O-O distance (Å); default 2.5. */
  min_water_water_distance?: number
  /**
  * Min distance between ANY two atoms of different waters, or between a water
  * atom and a solute atom (Å); default 1.6.
  *
  * The O–O criterion alone does not bound this. With r(O–H) = 1 Å, two
  * hydrogens pointing at each other across an O–O contact of 2.5 Å are 0.5 Å
  * apart, and nothing looked. Measured on this builder's own output before the
  * fix — 267 waters in a 20 Å cube at ρ = 1.0, seed 12345 — the true minimum
  * was 0.87 Å H–H, shorter than the bond in H₂. Any MD or DFT run started from
  * that diverges immediately.
  *
  * 1.6 Å is permissive: real water has H···O ≈ 1.8 Å in a hydrogen bond and
  * H···H ≈ 2.3 Å. It is set low enough that liquid density is still reachable,
  * and only excludes contacts that are not structures.
  */
  min_atom_atom_distance?: number
  /** Water model preset. */
  water_model?: WaterModel
  /** Max placement attempts as a multiplier of target_count; default 50. */
  max_attempts?: number
  /** Optional RNG seed for reproducibility. */
  seed?: number
}

// ── small linalg ───────────────────────────────────────────────────────────

function sub(u: Vec3, v: Vec3): Vec3 { return [u[0] - v[0], u[1] - v[1], u[2] - v[2]] }
function add(u: Vec3, v: Vec3): Vec3 { return [u[0] + v[0], u[1] + v[1], u[2] + v[2]] }
function scale(v: Vec3, s: number): Vec3 { return [v[0] * s, v[1] * s, v[2] * s] }
function dot(u: Vec3, v: Vec3): number { return u[0] * v[0] + u[1] * v[1] + u[2] * v[2] }
function cross(u: Vec3, v: Vec3): Vec3 {
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
}
function norm(v: Vec3): number { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) }
function det3(m: Mat3): number {
  const [a, b, c] = m
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  )
}
function invert3(m: Mat3): Mat3 | null {
  const d = det3(m)
  if (Math.abs(d) < 1e-12) return null
  const [a, b, c] = m
  return [
    [
      (b[1] * c[2] - b[2] * c[1]) / d,
      (a[2] * c[1] - a[1] * c[2]) / d,
      (a[1] * b[2] - a[2] * b[1]) / d,
    ],
    [
      (b[2] * c[0] - b[0] * c[2]) / d,
      (a[0] * c[2] - a[2] * c[0]) / d,
      (a[2] * b[0] - a[0] * b[2]) / d,
    ],
    [
      (b[0] * c[1] - b[1] * c[0]) / d,
      (a[1] * c[0] - a[0] * c[1]) / d,
      (a[0] * b[1] - a[1] * b[0]) / d,
    ],
  ]
}
function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function transpose3(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ]
}

function makePbcContext(lattice: Mat3, wrap: [boolean, boolean, boolean]): PbcCtx {
  const inv = invert3(lattice)
  return {
    wrap,
    lattice,
    // Lattice rows are real-space basis vectors and cart = f0*a + f1*b + f2*c.
    // matVec() treats vectors as columns, so use (L^-1)^T to compute fractional
    // coordinates from a cartesian delta.
    invLattice: inv ? transpose3(inv) : null,
  }
}

// ── RNG (Mulberry32) ───────────────────────────────────────────────────────

function makeRng(seed?: number): () => number {
  // Default seed: time-derived but stable per build call.
  let s = (seed === undefined ? (Math.random() * 0xffffffff) >>> 0 : seed >>> 0) || 1
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Water geometry ─────────────────────────────────────────────────────────

interface WaterGeom { rOH: number; angleDeg: number }
function waterGeometry(model: WaterModel): WaterGeom {
  switch (model) {
    case 'SPC/E': return { rOH: 1.0, angleDeg: 109.47 }
    case 'TIP3P': return { rOH: 0.9572, angleDeg: 104.52 }
    case 'TIP4P': return { rOH: 0.9572, angleDeg: 104.52 }
    default: {
      const exhaustive: never = model
      throw new Error(`Unknown water_model '${exhaustive as string}'`)
    }
  }
}

/** Reference water in its own frame: O at origin, two Hs in the +x/+y plane
 *  symmetric about +y. Returns [O, H1, H2]. */
function referenceWater(geom: WaterGeom): Vec3[] {
  const halfRad = (geom.angleDeg * Math.PI) / 180 / 2
  const dx = geom.rOH * Math.sin(halfRad)
  const dy = geom.rOH * Math.cos(halfRad)
  return [
    [0, 0, 0],
    [dx, dy, 0],
    [-dx, dy, 0],
  ]
}

/** Random rotation matrix from Euler ZYX using uniform-in-sphere angles. */
function randomRotation(rng: () => number): Mat3 {
  const a = 2 * Math.PI * rng()
  const b = Math.acos(2 * rng() - 1) // uniform cosθ ∈ [-1, 1]
  const c = 2 * Math.PI * rng()
  const ca = Math.cos(a), sa = Math.sin(a)
  const cb = Math.cos(b), sb = Math.sin(b)
  const cc = Math.cos(c), sc = Math.sin(c)
  // Rz(a) · Ry(b) · Rz(c) — yields a uniformly random rotation in SO(3).
  return [
    [ca * cb * cc - sa * sc, -ca * cb * sc - sa * cc, ca * sb],
    [sa * cb * cc + ca * sc, -sa * cb * sc + ca * cc, sa * sb],
    [-sb * cc, sb * sc, cb],
  ]
}

function rotate(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

// ── PBC helpers ────────────────────────────────────────────────────────────

interface PbcCtx {
  /** True per-axis: should distance check wrap with min-image? */
  wrap: [boolean, boolean, boolean]
  /** Lattice as row vectors (used for fractional wrap). */
  lattice: Mat3
  /** Inverse lattice (cart -> frac). */
  invLattice: Mat3 | null
}

/** Cartesian distance between two points under (optional per-axis) PBC. */
function pbcDistanceSq(p: Vec3, q: Vec3, ctx: PbcCtx): number {
  if (!ctx.invLattice || (!ctx.wrap[0] && !ctx.wrap[1] && !ctx.wrap[2])) {
    const d = sub(p, q)
    return d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
  }
  // Convert to fractional, fold each wrapped axis into [-0.5, 0.5).
  const diffCart = sub(p, q)
  const fDiff = matVec(ctx.invLattice, diffCart)
  for (let i = 0; i < 3; i++) {
    if (ctx.wrap[i]) fDiff[i] -= Math.round(fDiff[i])
  }
  // Back to cartesian. Lattice rows are a1, a2, a3 so cart = sum f_i * a_i.
  const cx = fDiff[0] * ctx.lattice[0][0] + fDiff[1] * ctx.lattice[1][0] + fDiff[2] * ctx.lattice[2][0]
  const cy = fDiff[0] * ctx.lattice[0][1] + fDiff[1] * ctx.lattice[1][1] + fDiff[2] * ctx.lattice[2][1]
  const cz = fDiff[0] * ctx.lattice[0][2] + fDiff[1] * ctx.lattice[1][2] + fDiff[2] * ctx.lattice[2][2]
  return cx * cx + cy * cy + cz * cz
}

// ── Density bookkeeping ────────────────────────────────────────────────────

/** Water molar mass in g/mol (15.999 + 2×1.008). */
const WATER_MOLAR_MASS = 18.015
const AVOGADRO = 6.02214076e23

/** Number of waters at the given density (g/cm³) in `volume_A3`. */
function moleculesForDensity(density: number, volume_A3: number): number {
  // density [g/cm^3] * volume[A^3] * 1e-24 [cm^3/A^3] / (M / N_A) [g] = molecules
  return Math.round((density * volume_A3 * 1e-24 * AVOGADRO) / WATER_MOLAR_MASS)
}

// ── Main builder ───────────────────────────────────────────────────────────

const VALID_MODELS: WaterModel[] = ['SPC/E', 'TIP3P', 'TIP4P']

export function buildWaterLayer(opts: WaterFillOptions): BuilderResult {
  // Validation up front.
  const model: WaterModel = opts.water_model ?? 'SPC/E'
  if (!VALID_MODELS.includes(model)) {
    throw new Error(`Unknown water_model '${model}'. Valid: ${VALID_MODELS.join(', ')}`)
  }
  if (opts.mode !== 'box' && opts.mode !== 'surface') {
    throw new Error(`Unknown mode '${opts.mode as string}'. Valid: 'box' | 'surface'`)
  }
  const lattice = opts.lattice
  if (Math.abs(det3(lattice)) < 1e-9) {
    throw new Error('Lattice is degenerate (zero volume)')
  }

  const density = opts.density ?? 1.0
  const minSoluteD = opts.min_solute_distance ?? 2.3
  const minOOD = opts.min_water_water_distance ?? 2.5
  const minAA = opts.min_atom_atom_distance ?? 1.6
  const minAASq = minAA * minAA
  const minSoluteDSq = minSoluteD * minSoluteD
  const minOODSq = minOOD * minOOD
  const maxAttemptsMul = Math.max(1, opts.max_attempts ?? 50)
  const rng = makeRng(opts.seed)
  const geom = waterGeometry(model)
  const refWater = referenceWater(geom)
  const solute = opts.solute_atoms ?? []

  let placedOxygens: Vec3[] = []
  let placedTriples: Array<{ O: Vec3; H1: Vec3; H2: Vec3 }> = []
  let finalLattice: Mat3 = lattice
  let pbc: PbcCtx
  let regionVolume = 0
  let targetCount = 0
  let warning = ''
  let modeTag = ''

  if (opts.mode === 'box') {
    // ── Box fill: place into the periodic box itself.
    pbc = makePbcContext(lattice, [true, true, true])
    regionVolume = Math.abs(det3(lattice))
    targetCount = opts.target_count != null && opts.target_count >= 0
      ? Math.floor(opts.target_count)
      : moleculesForDensity(density, regionVolume)
    modeTag = 'box'

    const maxAttempts = Math.max(1, targetCount * maxAttemptsMul)
    let attempts = 0
    while (placedOxygens.length < targetCount && attempts < maxAttempts) {
      attempts++
      const f1 = rng(), f2 = rng(), f3 = rng()
      const O: Vec3 = [
        f1 * lattice[0][0] + f2 * lattice[1][0] + f3 * lattice[2][0],
        f1 * lattice[0][1] + f2 * lattice[1][1] + f3 * lattice[2][1],
        f1 * lattice[0][2] + f2 * lattice[1][2] + f3 * lattice[2][2],
      ]
      if (!checkSolute(O, solute, minSoluteDSq, pbc)) continue
      if (!checkWaterWater(O, placedOxygens, minOODSq, pbc)) continue
      // The rotation has to come BEFORE the acceptance test. It used to be
      // generated after, which is the whole reason the hydrogens went unchecked:
      // at the moment the test ran, their positions did not exist yet.
      const R = randomRotation(rng)
      const H1 = add(O, rotate(R, refWater[1]))
      const H2 = add(O, rotate(R, refWater[2]))
      if (!checkAllAtoms([O, H1, H2], placedTriples, solute, minAASq, pbc)) continue
      placedOxygens.push(O)
      placedTriples.push({ O, H1, H2 })
    }
    if (placedOxygens.length < targetCount) {
      warning = ` · only placed ${placedOxygens.length}/${targetCount} after ${attempts} attempts`
    }
  } else {
    // ── Surface fill: water above (and/or below) a slab.
    if (solute.length === 0) {
      throw new Error('Surface mode requires solute_atoms (the slab) — got none')
    }
    const side = opts.side ?? 'top'
    const thickness = Math.max(0.5, opts.layer_thickness ?? 8)
    const surfaceOffset = opts.surface_offset ?? 2.5
    const up = opts.surface_up ?? ([0, 0, 1] as Vec3)
    const upLen = norm(up)
    if (upLen < 1e-9) throw new Error('surface_up vector has zero length')
    const upUnit: Vec3 = scale(up, 1 / upLen)

    // Find slab extent along upUnit.
    let pMin = Infinity, pMax = -Infinity
    for (const a of solute) {
      const p = dot(a.cartesian, upUnit)
      if (p < pMin) pMin = p
      if (p > pMax) pMax = p
    }
    if (!isFinite(pMin) || !isFinite(pMax)) {
      throw new Error('Could not determine slab extent from solute atoms')
    }

    // We sample inside the periodic in-plane lattice (no wrap on the surface
    // axis). We project the input lattice onto the surface plane: keep the
    // in-plane components of a1, a2, a3 by removing the upUnit projection.
    // For lattices where one axis is already ‖ upUnit, that axis becomes
    // the c-vector we extend.
    //
    // Strategy: pick the lattice axis with the largest |dot(a_i, upUnit)| as
    // the "out-of-plane" axis. The other two are in-plane.
    const dotsAbs = [
      Math.abs(dot(lattice[0], upUnit)),
      Math.abs(dot(lattice[1], upUnit)),
      Math.abs(dot(lattice[2], upUnit)),
    ]
    let outAxis = 0
    if (dotsAbs[1] > dotsAbs[outAxis]) outAxis = 1
    if (dotsAbs[2] > dotsAbs[outAxis]) outAxis = 2
    const inAxes = [0, 1, 2].filter((i) => i !== outAxis)
    const aIn = lattice[inAxes[0]]
    const bIn = lattice[inAxes[1]]
    // Cross-section area = |aIn × bIn| projected. For an orthorhombic cell
    // with up = z, this is just |a × b|.
    const xs = cross(aIn, bIn)
    const area = norm(xs)
    if (area < 1e-9) {
      throw new Error('In-plane lattice vectors are degenerate (zero cross-section area)')
    }

    // Compute the water region(s) along upUnit:
    //   top:    [pMax + surfaceOffset, pMax + surfaceOffset + thickness]
    //   bottom: [pMin - surfaceOffset - thickness, pMin - surfaceOffset]
    interface SurfaceRegion { lo: number; hi: number }
    const regions: SurfaceRegion[] = []
    if (side === 'top' || side === 'both') {
      regions.push({ lo: pMax + surfaceOffset, hi: pMax + surfaceOffset + thickness })
    }
    if (side === 'bottom' || side === 'both') {
      regions.push({ lo: pMin - surfaceOffset - thickness, hi: pMin - surfaceOffset })
    }
    regionVolume = regions.reduce((s, r) => s + (r.hi - r.lo) * area, 0)

    targetCount = opts.target_count != null && opts.target_count >= 0
      ? Math.floor(opts.target_count)
      : moleculesForDensity(density, regionVolume)
    modeTag = `surface(${side})`

    // Build the final (extended) lattice: extend the out-of-plane axis to
    // enclose the slab + new water regions, plus a thin vacuum buffer.
    const slabMin = pMin
    const slabMax = pMax
    const waterMin = regions.length > 0 ? Math.min(...regions.map((r) => r.lo)) : slabMin
    const waterMax = regions.length > 0 ? Math.max(...regions.map((r) => r.hi)) : slabMax
    const allMin = Math.min(slabMin, waterMin)
    const allMax = Math.max(slabMax, waterMax)
    const cellSpan = (allMax - allMin) + 2 * 1.0  // 1 Å buffer each side
    // New out-of-plane vector along upUnit with magnitude cellSpan.
    const newOut: Vec3 = scale(upUnit, cellSpan)
    const newLattice: Mat3 = [lattice[0].slice() as Vec3, lattice[1].slice() as Vec3, lattice[2].slice() as Vec3]
    newLattice[outAxis] = newOut
    finalLattice = newLattice

    // For PBC distance checks: wrap in-plane only.
    const wrap: [boolean, boolean, boolean] = [false, false, false]
    wrap[inAxes[0]] = true
    wrap[inAxes[1]] = true
    pbc = makePbcContext(finalLattice, wrap)

    const maxAttempts = Math.max(1, targetCount * maxAttemptsMul)
    let attempts = 0
    while (placedOxygens.length < targetCount && attempts < maxAttempts) {
      attempts++
      // Random region (if both sides), uniform by volume.
      const region = regions.length === 1
        ? regions[0]
        : regions[rng() < 0.5 ? 0 : 1]
      const u = rng(), v = rng()  // in-plane fractional
      const t = region.lo + rng() * (region.hi - region.lo)
      // Reconstruct cartesian: u·aIn + v·bIn + t·upUnit, then shift so origin
      // is at the lattice origin. Note the slab atoms are already at their
      // global cartesian coords, so we don't shift them.
      const O: Vec3 = [
        u * aIn[0] + v * bIn[0] + t * upUnit[0],
        u * aIn[1] + v * bIn[1] + t * upUnit[1],
        u * aIn[2] + v * bIn[2] + t * upUnit[2],
      ]
      if (!checkSolute(O, solute, minSoluteDSq, pbc)) continue
      if (!checkWaterWater(O, placedOxygens, minOODSq, pbc)) continue
      const R = randomRotation(rng)
      const H1 = add(O, rotate(R, refWater[1]))
      const H2 = add(O, rotate(R, refWater[2]))
      if (!checkAllAtoms([O, H1, H2], placedTriples, solute, minAASq, pbc)) continue
      placedOxygens.push(O)
      placedTriples.push({ O, H1, H2 })
    }
    if (placedOxygens.length < targetCount) {
      warning = ` · only placed ${placedOxygens.length}/${targetCount} after ${attempts} attempts`
    }
  }

  // ── Emit extxyz ───────────────────────────────────────────────────────────
  const lines: string[] = []
  const nWaterAtoms = placedTriples.length * 3
  const totalAtoms = solute.length + nWaterAtoms
  lines.push(String(totalAtoms))
  const latStr = finalLattice
    .flatMap((v) => v.map((x) => x.toFixed(6)))
    .join(' ')
  lines.push(
    `Lattice="${latStr}" Properties=species:S:1:pos:R:3 ` +
      `WaterFill=${modeTag} model=${model} n_water=${placedTriples.length} ` +
      `density=${density.toFixed(3)}`,
  )
  for (const a of solute) {
    lines.push(
      `${a.element} ${a.cartesian[0].toFixed(6)} ${a.cartesian[1].toFixed(6)} ${a.cartesian[2].toFixed(6)}`,
    )
  }
  for (const w of placedTriples) {
    lines.push(`O ${w.O[0].toFixed(6)} ${w.O[1].toFixed(6)} ${w.O[2].toFixed(6)}`)
    lines.push(`H ${w.H1[0].toFixed(6)} ${w.H1[1].toFixed(6)} ${w.H1[2].toFixed(6)}`)
    lines.push(`H ${w.H2[0].toFixed(6)} ${w.H2[1].toFixed(6)} ${w.H2[2].toFixed(6)}`)
  }

  const description =
    `Water fill (${modeTag}) · ${placedTriples.length} ${model} molecules · ` +
    `region ${regionVolume.toFixed(1)} Å³ · density target ${density.toFixed(2)} g/cm³` +
    warning

  return {
    xyz: lines.join('\n'),
    description,
    n_atoms: totalAtoms,
  }
}

// ── Distance-rejection helpers ─────────────────────────────────────────────

function checkSolute(O: Vec3, solute: WaterSoluteAtom[], minSq: number, pbc: PbcCtx): boolean {
  for (const a of solute) {
    if (pbcDistanceSq(O, a.cartesian, pbc) < minSq) return false
  }
  return true
}

function checkWaterWater(O: Vec3, placed: Vec3[], minSq: number, pbc: PbcCtx): boolean {
  for (const p of placed) {
    if (pbcDistanceSq(O, p, pbc) < minSq) return false
  }
  return true
}

/**
 * Every atom of the trial water against every atom already in the cell.
 *
 * Intramolecular pairs are not considered — the trial water's own O–H bonds are
 * 1 Å by construction and are not what a packing floor governs. What this does
 * catch, and the O–O test cannot, is the hydrogen of one water sitting inside
 * another.
 *
 * O(n) per trial, which is the same order the O–O test already was. For the
 * counts this builder handles (a few hundred waters) that is not worth an index;
 * `pack.ts` uses a spatial hash for the general case.
 */
function checkAllAtoms(
  trial: Vec3[],
  placed: { O: Vec3; H1: Vec3; H2: Vec3 }[],
  solute: WaterSoluteAtom[],
  minSq: number,
  pbc: PbcCtx,
): boolean {
  for (const a of trial) {
    for (const w of placed) {
      if (pbcDistanceSq(a, w.O, pbc) < minSq) return false
      if (pbcDistanceSq(a, w.H1, pbc) < minSq) return false
      if (pbcDistanceSq(a, w.H2, pbc) < minSq) return false
    }
    for (const s of solute) {
      if (pbcDistanceSq(a, s.cartesian, pbc) < minSq) return false
    }
  }
  return true
}

export const __internal__ = { makePbcContext, pbcDistanceSq }
