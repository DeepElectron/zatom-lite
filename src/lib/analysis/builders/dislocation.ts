/**
 * Dislocations — the line defect the platform could not build.
 *
 * Everything else on the plasticity side was already here: grain boundaries via
 * coincidence-site lattices, polycrystals via Voronoi, point defects, stacking
 * faults implied by the partials below. The line defect that carries plastic
 * flow was not, so nothing built here could be used to ask why a material
 * yields — only what it looks like once it has.
 *
 * ## What a dislocation is, operationally
 *
 * Volterra's construction: cut the crystal on a half-plane bounded by a line ξ,
 * displace the two faces by a lattice translation **b**, and weld them back.
 * Away from the line the crystal is perfect again — that is what makes **b** a
 * lattice vector rather than an arbitrary offset — and all the deformation is
 * concentrated in the elastic field and the core.
 *
 * The displacement fields below are the isotropic-elasticity solutions, in a
 * frame with ξ along z:
 *
 *     screw   u_z = (b/2π)·θ
 *     edge    u_x = (b/2π)·[θ + xy / (2(1−ν)r²)]
 *             u_y = −(b/2π)·[(1−2ν)/(4(1−ν))·ln(r²/b²) + (x²−y²)/(4(1−ν)r²)]
 *
 * Two things about them are worth stating because they are what make the
 * construction work at all:
 *
 * * **The multivaluedness is the point.** `θ` jumps by 2π on one circuit, so `u`
 *   jumps by exactly **b**. Since **b** is a lattice translation, the lattice
 *   maps onto itself across that jump and the crystal reconnects. Applying the
 *   field to a perfect crystal therefore *creates* the dislocation — no atoms
 *   need be added or removed, and the "extra half-plane" of the edge case
 *   emerges from the field rather than being inserted by hand.
 * * **Which is also why a partial leaves a fault.** A Shockley partial
 *   a/6⟨112⟩ is not a lattice translation, so the two faces do *not* register
 *   and a stacking fault trails behind. `burgersScale` below allows it, and
 *   says so in the description, because that fault is a real feature and not an
 *   error — but the caller has to know it is there.
 *
 * ## Isotropic, and where that costs
 *
 * Real crystals are elastically anisotropic and the correct treatment is
 * Stroh's sextic formalism, which needs the full c_ijkl. This module takes
 * Poisson's ratio only. The field is then wrong by a few percent in the
 * far field for a mildly anisotropic metal (Al, ν≈0.35, A≈1.2) and by rather
 * more for a strongly anisotropic one (Cu A≈3.2, Fe A≈2.4). For a starting
 * configuration that will be relaxed, that error is irrelevant — the relaxation
 * removes it. For an unrelaxed elastic-energy estimate it is not, and this
 * module does not offer one.
 *
 * The core itself is outside linear elasticity in any formalism: within ~2|b| of
 * the line the field diverges and the atoms it predicts are unphysically close.
 * `coreRadius` excises that region for the cylinder geometry; `minSeparation` in
 * the result reports what actually survived, so a caller can see rather than
 * assume.
 */

import { latticeRepeatAlong, type CubicLatticeType } from '../../crystal/lattice-period'

import type { BuilderResult } from './types'

type Vec3 = [number, number, number]
type Mat3 = [Vec3, Vec3, Vec3]

export interface DislocationAtomInput {
  element: string
  /** Cartesian coordinates (Å). */
  cartesian: Vec3
}

/** Derived from **b** and ξ, never declared — see `characterOf`. */
export type DislocationCharacter = 'screw' | 'edge' | 'mixed'

export interface BuildDislocationOptions {
  /** Lattice of the source crystal (row vectors a1, a2, a3). */
  lattice: Mat3
  atoms: DislocationAtomInput[]
  /** Burgers direction as integer Miller indices, e.g. [1, 1, 0] for FCC. */
  burgers: Vec3
  /** Line direction as integer Miller indices. */
  lineDirection: Vec3
  /** Cubic lattice constant (Å). Taken from `lattice[0]` length when omitted. */
  latticeConstant?: number
  /** Which cubic lattice, for the shortest-repeat rule. Default 'fcc'. */
  latticeType?: CubicLatticeType
  /**
  * Scale on |b|. 1 = a perfect dislocation (the default). Use 1/3 with
  * `burgers: [1,1,2]` for an FCC Shockley partial — which is *not* a lattice
  * translation and therefore trails a stacking fault. See the module note.
  */
  burgersScale?: number
  /** Poisson's ratio for the edge component. Default 0.33. */
  poissonRatio?: number
  /** Cylinder radius (Å). Default: 80% of the smallest in-plane cell extent. */
  radius?: number
  /** Vacuum around the cylinder (Å). Default 10. */
  vacuum?: number
  /**
  * Atoms closer than this to the line are removed (Å). The elastic field
  * diverges there and would otherwise place atoms on top of each other.
  * Default 0 — keep everything, and let `minSeparation` report the damage.
  */
  coreRadius?: number
}

export interface DislocationResult extends BuilderResult {
  character: DislocationCharacter
  /** |b| in Å. */
  burgersMagnitude: number
  /** Angle between **b** and ξ, degrees. 0 = screw, 90 = edge. */
  characterAngleDeg: number
  /** Closest approach between any two atoms after displacement (Å). */
  minSeparation: number
  /** True when |b| is not a lattice translation, so a fault trails the line. */
  leavesStackingFault: boolean
}

const TAU = Math.PI * 2

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function unit(v: Vec3): Vec3 {
  const n = norm(v)
  if (!(n > 0)) throw new Error('dislocation: cannot normalise a zero vector')
  return scale(v, 1 / n)
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/**
 * The fields in polar form, with θ passed in rather than recovered from the
 * point. This is the primitive; the Cartesian wrappers below supply
 * θ = atan2(y, x).
 *
 * The split matters, and it is not a style choice. The whole of a dislocation
 * lives in the fact that u is *multivalued* in θ: one circuit adds 2π, and the
 * field therefore adds **b**. `Math.atan2` is single-valued on (−π, π], so a
 * caller who wants to walk a full circuit and see that jump cannot use it — the
 * branch it drops is exactly the quantity being measured. Taking θ as an
 * argument lets `burgersCircuitClosure` advance it continuously past π and
 * recover **b**, while `screwDisplacement`/`edgeDisplacement` keep the
 * single-valued branch that is correct for placing atoms.
 */
export function screwDisplacementPolar(_r: number, theta: number, b: number): Vec3 {
  return [0, 0, (b / TAU) * theta]
}

export function edgeDisplacementPolar(r: number, theta: number, b: number, nu: number): Vec3 {
  if (!(r > 0)) return [0, 0, 0]
  const k = b / TAU
  const c = 1 / (2 * (1 - nu))
  // xy/r² = sinθcosθ, (x²−y²)/r² = cos2θ — the r dependence survives only in
  // the logarithm, which is the long-range part.
  const ux = k * (theta + Math.sin(theta) * Math.cos(theta) * c)
  // ln(r²/b²) rather than ln(r²): the b² makes the argument dimensionless, so
  // u_y does not depend on whether the caller works in Å or nm. It differs from
  // ln(r²) by a constant, which is a rigid translation and therefore not a
  // different dislocation — but it is the difference between a result that
  // changes with the unit choice and one that does not.
  const uy = -k * (((1 - 2 * nu) * c) / 2 * Math.log((r * r) / (b * b)) + (Math.cos(2 * theta) * c) / 2)
  return [ux, uy, 0]
}

/** Screw displacement, line along z, in the dislocation frame. */
export function screwDisplacement(x: number, y: number, b: number): Vec3 {
  return screwDisplacementPolar(Math.hypot(x, y), Math.atan2(y, x), b)
}

/** Edge displacement, line along z, **b** along x, in the dislocation frame. */
export function edgeDisplacement(x: number, y: number, b: number, nu: number): Vec3 {
  return edgeDisplacementPolar(Math.hypot(x, y), Math.atan2(y, x), b, nu)
}

/**
 * Character from geometry, not from a parameter.
 *
 * A caller that passes `character: 'screw'` alongside a **b** perpendicular to ξ
 * has described two different dislocations and one of them is going to be
 * silently ignored. So it is derived.
 */
export function characterOf(burgersDir: Vec3, lineDir: Vec3, tolDeg = 1): {
  character: DislocationCharacter
  angleDeg: number
} {
  const cosang = Math.abs(dot(unit(burgersDir), unit(lineDir)))
  const angleDeg = (Math.acos(Math.min(1, Math.max(0, cosang))) * 180) / Math.PI
  if (angleDeg <= tolDeg) return { character: 'screw', angleDeg }
  if (Math.abs(angleDeg - 90) <= tolDeg) return { character: 'edge', angleDeg }
  return { character: 'mixed', angleDeg }
}

/**
 * Orthonormal dislocation frame (x̂, ŷ, ẑ) with ẑ along the line.
 *
 * x̂ is the glide direction: the component of **b** perpendicular to ξ,
 * normalised. For a pure screw that component vanishes and any perpendicular
 * will do, so one is chosen deterministically — the edge displacement is zero
 * in that case and the choice cannot affect the result.
 */
export function dislocationFrame(burgersDir: Vec3, lineDir: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = unit(lineDir)
  const bParallel = scale(z, dot(burgersDir, z))
  const bPerp = sub(burgersDir, bParallel)
  let x: Vec3
  if (norm(bPerp) > 1e-9 * Math.max(1, norm(burgersDir))) {
    x = unit(bPerp)
  } else {
    // Pure screw. Pick the axis least aligned with ξ so the cross product is
    // well conditioned; the answer does not depend on which, but a stable
    // choice keeps repeated builds byte-identical.
    const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    let best = axes[0]
    let bestDot = Infinity
    for (const ax of axes) {
      const d = Math.abs(dot(ax, z))
      if (d < bestDot) { bestDot = d; best = ax }
    }
    x = unit(sub(best, scale(z, dot(best, z))))
  }
  const y = cross(z, x)
  return { x, y, z }
}

/**
 * |b| in Å for a Miller direction in a cubic lattice.
 *
 * This is the shortest lattice translation along that direction — exactly what
 * `latticeRepeatAlong` computes for the region-extrusion problem, and the same
 * quantity for the same reason: a Burgers vector has to be a translation that
 * maps the lattice onto itself, or the crystal does not reconnect across the
 * cut.
 */
export function burgersMagnitude(
  direction: Vec3,
  latticeConstant: number,
  latticeType: CubicLatticeType = 'fcc',
): number {
  return latticeRepeatAlong(direction, latticeConstant, latticeType)
}

/** Cartesian direction for a Miller index triple in a cubic cell. */
function millerToCartesian(m: Vec3): Vec3 {
  return unit(m)
}

/**
 * Total displacement at a point, for one dislocation at `core` in the frame.
 * Screw and edge components superpose — they are solutions of the same linear
 * equations with orthogonal boundary data.
 */
function displacementAt(
  p: Vec3,
  core: Vec3,
  frame: { x: Vec3; y: Vec3; z: Vec3 },
  bEdge: number,
  bScrew: number,
  nu: number,
  sign: number,
): Vec3 {
  const d = sub(p, core)
  const x = dot(d, frame.x)
  const y = dot(d, frame.y)
  const uScrew = bScrew !== 0 ? screwDisplacement(x, y, sign * bScrew) : ([0, 0, 0] as Vec3)
  const uEdge = bEdge !== 0 ? edgeDisplacement(x, y, sign * bEdge, nu) : ([0, 0, 0] as Vec3)
  const ux = uEdge[0]
  const uy = uEdge[1]
  const uz = uScrew[2]
  return [
    frame.x[0] * ux + frame.y[0] * uy + frame.z[0] * uz,
    frame.x[1] * ux + frame.y[1] * uy + frame.z[1] * uz,
    frame.x[2] * ux + frame.y[2] * uy + frame.z[2] * uz,
  ]
}

/**
 * Closure failure of a Burgers circuit — the operational definition of **b**.
 *
 * Walk a circle of radius `radius` about the line, advancing θ continuously
 * from 0 to 2π, and sum the displacement increments. In a perfect crystal the
 * circuit closes; around a dislocation it fails to close, and the failure *is*
 * **b**.
 *
 * θ advances as a parameter rather than being read back from each point with
 * `atan2`, which would reset it by −2π at the branch cut and cancel the very
 * quantity being measured. That is not a subtlety to be worked around with an
 * unwrapping heuristic: the multivaluedness in θ is the dislocation, so the
 * measurement has to be made on the continuous branch.
 *
 * Exported because it is the check that a displacement field really is a
 * dislocation, and that belongs to callers as much as to the tests.
 */
export function burgersCircuitClosure(
  _core: Vec3,
  frame: { x: Vec3; y: Vec3; z: Vec3 },
  bEdge: number,
  bScrew: number,
  nu: number,
  radius: number,
  steps = 2048,
): Vec3 {
  const at = (theta: number): Vec3 => {
    const uScrew = bScrew !== 0 ? screwDisplacementPolar(radius, theta, bScrew) : ([0, 0, 0] as Vec3)
    const uEdge = bEdge !== 0 ? edgeDisplacementPolar(radius, theta, bEdge, nu) : ([0, 0, 0] as Vec3)
    const ux = uEdge[0]
    const uy = uEdge[1]
    const uz = uScrew[2]
    return [
      frame.x[0] * ux + frame.y[0] * uy + frame.z[0] * uz,
      frame.x[1] * ux + frame.y[1] * uy + frame.z[1] * uz,
      frame.x[2] * ux + frame.y[2] * uy + frame.z[2] * uz,
    ]
  }
  let total: Vec3 = [0, 0, 0]
  let prev = at(0)
  for (let i = 1; i <= steps; i++) {
    const u = at((i / steps) * TAU)
    total = add(total, sub(u, prev))
    prev = u
  }
  return total
}

function cellExtents(lattice: Mat3): Vec3 {
  return [norm(lattice[0]), norm(lattice[1]), norm(lattice[2])]
}

function formatExtxyz(
  atoms: { element: string; cartesian: Vec3 }[],
  lattice: Mat3,
  comment: string,
): string {
  const lat = lattice.flat().map((v) => v.toFixed(8)).join(' ')
  const lines = [
    String(atoms.length),
    `Lattice="${lat}" Properties=species:S:1:pos:R:3 ${comment}`,
    ...atoms.map(
      (a) =>
        `${a.element} ${a.cartesian[0].toFixed(8)} ${a.cartesian[1].toFixed(8)} ${a.cartesian[2].toFixed(8)}`,
    ),
  ]
  return lines.join('\n')
}

function minPairSeparation(atoms: { cartesian: Vec3 }[], cap = 4000): number {
  // O(n²) over a capped sample. The number this reports is a lower bound on the
  // true minimum only when every atom is sampled; past `cap` it is a spot check,
  // which is stated here rather than in a comment nobody reads at the call site.
  const n = Math.min(atoms.length, cap)
  let best = Infinity
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = norm(sub(atoms[i].cartesian, atoms[j].cartesian))
      if (d < best) best = d
    }
  }
  return Number.isFinite(best) ? best : 0
}

export function buildDislocation(options: BuildDislocationOptions): DislocationResult {
  const {
    lattice,
    atoms,
    burgers,
    lineDirection,
    latticeType = 'fcc',
    burgersScale = 1,
    poissonRatio = 0.33,
    vacuum = 10,
    coreRadius = 0,
  } = options

  if (!atoms.length) throw new Error('dislocation: no atoms to displace')
  if (!(burgersScale > 0)) {
    throw new Error(`dislocation: burgersScale must be positive (got ${burgersScale})`)
  }
  if (!(poissonRatio > -1 && poissonRatio < 0.5)) {
    // ν = 0.5 divides by zero in the edge field (incompressible limit); ν ≤ −1
    // is not a stable isotropic solid. Refusing beats producing a field of NaN.
    throw new Error(
      `dislocation: Poisson's ratio must be in (−1, 0.5), got ${poissonRatio}. ` +
        `The edge displacement has 1/(1−ν) factors that diverge at 0.5.`,
    )
  }

  const a0 = options.latticeConstant ?? norm(lattice[0])
  if (!(a0 > 0)) throw new Error('dislocation: lattice constant must be positive')

  const bFull = burgersMagnitude(burgers, a0, latticeType)
  const bMag = bFull * burgersScale
  const leavesStackingFault = Math.abs(burgersScale - 1) > 1e-9

  const bDir = millerToCartesian(burgers)
  const lDir = millerToCartesian(lineDirection)
  const { character, angleDeg } = characterOf(bDir, lDir)
  const frame = dislocationFrame(bDir, lDir)

  // Split |b| into the components the two fields solve for.
  const cosang = dot(bDir, frame.z)
  const bScrew = bMag * cosang
  const bEdge = bMag * Math.sqrt(Math.max(0, 1 - cosang * cosang))

  const extents = cellExtents(lattice)
  const centre: Vec3 = [
    (lattice[0][0] + lattice[1][0] + lattice[2][0]) / 2,
    (lattice[0][1] + lattice[1][1] + lattice[2][1]) / 2,
    (lattice[0][2] + lattice[1][2] + lattice[2][2]) / 2,
  ]

  const cores: { core: Vec3; sign: number }[] = [{ core: centre, sign: +1 }]

  const displaced: { element: string; cartesian: Vec3 }[] = []
  for (const atom of atoms) {
    let u: Vec3 = [0, 0, 0]
    let tooClose = false
    for (const { core, sign } of cores) {
      const d = sub(atom.cartesian, core)
      const rx = dot(d, frame.x)
      const ry = dot(d, frame.y)
      if (coreRadius > 0 && Math.hypot(rx, ry) < coreRadius) { tooClose = true; break }
      u = add(u, displacementAt(atom.cartesian, core, frame, bEdge, bScrew, poissonRatio, sign))
    }
    if (tooClose) continue
    displaced.push({ element: atom.element, cartesian: add(atom.cartesian, u) })
  }
  if (!displaced.length) {
    throw new Error(
      `dislocation: coreRadius ${coreRadius} Å removed every atom; the cell is smaller ` +
        `than the excised core`,
    )
  }

  // A cylinder about the line, free surfaces around it, periodic only along ξ.
  // The single-dislocation field is not cell-periodic in x and y — nothing can
  // make it so, since the net **b** is not zero — so those directions get
  // vacuum instead of a periodicity that would be a lie.
  const radiusUsed = options.radius ?? 0.4 * Math.min(extents[0], extents[1])
  if (!(radiusUsed > 0)) throw new Error('dislocation: cylinder radius must be positive')
  let kept = displaced.filter((atom) => {
    const d = sub(atom.cartesian, centre)
    return Math.hypot(dot(d, frame.x), dot(d, frame.y)) <= radiusUsed
  })
  if (!kept.length) {
    throw new Error(
      `dislocation: radius ${radiusUsed.toFixed(2)} Å kept no atoms; the cylinder ` +
        `falls outside the supplied cell`,
    )
  }
  const side = 2 * (radiusUsed + vacuum)
  // Line length = the cell repeat along ξ, so the cylinder stays periodic in
  // the one direction where periodicity is meaningful.
  const along = Math.abs(dot(lattice[0], frame.z)) + Math.abs(dot(lattice[1], frame.z)) +
    Math.abs(dot(lattice[2], frame.z))
  const outLattice: Mat3 = [
    scale(frame.x, side) as Vec3,
    scale(frame.y, side) as Vec3,
    scale(frame.z, along) as Vec3,
  ]
  // Re-express every atom in the cylinder's own frame: (x, y) measured from
  // the line and shifted to the middle of the new box, ξ wrapped into
  // [0, along) so the cell actually contains what it says it does.
  kept = kept.map((atom) => {
    const d = sub(atom.cartesian, centre)
    const cx = dot(d, frame.x) + side / 2
    const cy = dot(d, frame.y) + side / 2
    const cz = ((dot(d, frame.z) % along) + along) % along
    return {
      element: atom.element,
      cartesian: add(
        add(scale(frame.x, cx), scale(frame.y, cy)),
        scale(frame.z, cz),
      ),
    }
  })

  const composition: Record<string, number> = {}
  for (const atom of kept) composition[atom.element] = (composition[atom.element] ?? 0) + 1

  const faultNote = leavesStackingFault
    ? ` PARTIAL (|b| = ${burgersScale.toFixed(4)}× the lattice translation): not a lattice ` +
      `vector, so the cut faces do not register and a stacking fault trails the line.`
    : ''
  const description =
    `${character} dislocation, b = ${bMag.toFixed(4)} Å along [${burgers.join('')}], ` +
    `ξ = [${lineDirection.join('')}], ${angleDeg.toFixed(1)}° between them; ` +
    `free-surface cylinder r = ${radiusUsed.toFixed(1)} Å; ` +
    `isotropic elasticity, ν = ${poissonRatio}.${faultNote}`

  return {
    xyz: formatExtxyz(kept, outLattice, `dislocation="${character}"`),
    description,
    n_atoms: kept.length,
    composition,
    character,
    burgersMagnitude: bMag,
    characterAngleDeg: angleDeg,
    minSeparation: minPairSeparation(kept),
    leavesStackingFault,
  }
}
