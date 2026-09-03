/**
 * Cylindrical pure-bend deformation field for a curved crystalline body.
 *
 * Maps a straight reference body into a developable cylindrical bend:
 * x = bendOrigin + t̂·(ρ sinφ) +
 * r̂·(ρ cosφ − R) + ẑ·z, with s=q·t̂, r=q·r̂, z=q·ẑ, φ=s/R, ρ=R+r. This is the standard
 * Euler–Bernoulli plane-sections embedding; the neutral fibre (r=0) preserves arc length.
 *
 * Scientific status: a low-strain COMPATIBLE seed, not a final traction-free elastic solution (it
 * imposes zero transverse strain; a relaxed Si nanowire shows anisotropic Poisson relaxation +
 * surface reconstruction). The honest accuracy regime is a/R ≪ 1 and max|r|/R ≤ 0.02; above that,
 * the structure should be relaxed and treated as experimental. The analytic deformation gradient
 * below avoids the precision loss of finite-differencing Float32 output positions. Green strain:
 * E_ss = r/R + ½(r/R)², off-diagonals 0, transverse 0.
 *
 * Refs: OVITO atomic-strain (per-atom F → E=½(FᵀF−I)); Si NW bending MD (linear-elastic <~5%,
 * collapse ~13%); Gauss–Bonnet applies to closed/boundary-constrained 2D crystalline shells — an
 * open 3D bent body can be defect-free while elastically strained.
 */

export type Vec3 = [number, number, number]
/** Row-major 3×3: M[i*3+j]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export interface CylindricalBendParams {
  /** neutral-fibre radius of curvature (Å) */
  R: number
  /** unit arc/axial direction (the fibre that bends) in the reference frame */
  tangent: Vec3
  /** unit transverse (curvature) direction in the bending plane */
  radial: Vec3
  /** unit bend-axis direction (unchanged by the bend) */
  axis: Vec3
  /** reference-frame point on the neutral fibre that stays fixed (φ=0, r=0) */
  bendOrigin: Vec3
}

export interface DeformationField {
  map: (X: Vec3) => Vec3
  /** Zero-allocation map: write the deformed coords of (px,py,pz) into out[off..off+2].
  *  Bulk transforms use this to avoid a per-point input tuple. */
  mapInto: (px: number, py: number, pz: number, out: Float32Array, off: number) => void
  /** Analytic inverse: recover the straight reference point from a deformed point. Single-valued
  *  only without angular wrap (|s/R| < π); callers can use it to recover reference X from stored
  *  final positions without retaining a second position array. */
  inverseMap: (x: Vec3) => Vec3
  /** F = ∂x/∂X (reference frame), analytic. */
  deformationGradient: (X: Vec3) => Mat3
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function cylindricalBend({ R, tangent, radial, axis, bendOrigin }: CylindricalBendParams): DeformationField {
  // The deformation gradient F = Σ (∂x/∂localₖ) ⊗ dirₖ is the chain rule for s=q·t̂, r=q·r̂, z=q·ẑ
  // ONLY when {t̂,r̂,ẑ} are orthonormal and R is a finite positive radius — validate, else F (and the
  // strain gate built on it) is silently wrong.
  const TOL = 1e-6
  const isUnit = (v: Vec3) => Math.abs(Math.hypot(v[0], v[1], v[2]) - 1) < TOL
  if (!Number.isFinite(R) || R <= 0) throw new Error('cylindricalBend: R must be a finite positive radius')
  if (!bendOrigin.every(Number.isFinite)) throw new Error('cylindricalBend: bendOrigin must be finite')
  if (!isUnit(tangent) || !isUnit(radial) || !isUnit(axis)) throw new Error('cylindricalBend: tangent/radial/axis must be unit vectors')
  if (Math.abs(dot(tangent, radial)) > TOL || Math.abs(dot(tangent, axis)) > TOL || Math.abs(dot(radial, axis)) > TOL)
    throw new Error('cylindricalBend: tangent/radial/axis must be mutually orthogonal')
  // ρ = R + r ≤ 0 folds the body through the bend axis (inverseMap can't recover it). Guard per point.
  const requirePositiveRho = (rho: number) => {
    if (!(rho > 0)) throw new Error('cylindricalBend: point folds through the bend axis (R + r ≤ 0)')
  }

  const mapInto = (px: number, py: number, pz: number, out: Float32Array, off: number): void => {
    const qx = px - bendOrigin[0], qy = py - bendOrigin[1], qz = pz - bendOrigin[2]
    const s = qx * tangent[0] + qy * tangent[1] + qz * tangent[2]
    const r = qx * radial[0] + qy * radial[1] + qz * radial[2]
    const z = qx * axis[0] + qy * axis[1] + qz * axis[2]
    const phi = s / R, rho = R + r
    requirePositiveRho(rho)
    const a = rho * Math.sin(phi), b = rho * Math.cos(phi) - R
    out[off] = bendOrigin[0] + tangent[0] * a + radial[0] * b + axis[0] * z
    out[off + 1] = bendOrigin[1] + tangent[1] * a + radial[1] * b + axis[1] * z
    out[off + 2] = bendOrigin[2] + tangent[2] * a + radial[2] * b + axis[2] * z
  }

  // Float64 map for analysis/QA (mapInto truncates to the Float32 fill buffer; keep full precision here).
  const map = (X: Vec3): Vec3 => {
    const qx = X[0] - bendOrigin[0], qy = X[1] - bendOrigin[1], qz = X[2] - bendOrigin[2]
    const s = qx * tangent[0] + qy * tangent[1] + qz * tangent[2]
    const r = qx * radial[0] + qy * radial[1] + qz * radial[2]
    const z = qx * axis[0] + qy * axis[1] + qz * axis[2]
    const phi = s / R, rho = R + r
    requirePositiveRho(rho)
    const a = rho * Math.sin(phi), b = rho * Math.cos(phi) - R
    return [
      bendOrigin[0] + tangent[0] * a + radial[0] * b + axis[0] * z,
      bendOrigin[1] + tangent[1] * a + radial[1] * b + axis[1] * z,
      bendOrigin[2] + tangent[2] * a + radial[2] * b + axis[2] * z,
    ]
  }

  // Inverse: p=(x−o)·t̂=ρsinφ, w=(x−o)·r̂=ρcosφ−R, z=(x−o)·ẑ. So ρ=√(p²+(w+R)²), φ=atan2(p,w+R),
  // r=ρ−R, s=Rφ. Single-valued for |φ|<π (no arc wrap).
  const inverseMap = (x: Vec3): Vec3 => {
    const qx = x[0] - bendOrigin[0], qy = x[1] - bendOrigin[1], qz = x[2] - bendOrigin[2]
    const p = qx * tangent[0] + qy * tangent[1] + qz * tangent[2]
    const w = qx * radial[0] + qy * radial[1] + qz * radial[2]
    const z = qx * axis[0] + qy * axis[1] + qz * axis[2]
    const rho = Math.hypot(p, w + R)
    const phi = Math.atan2(p, w + R)
    const s = R * phi, r = rho - R
    return [
      bendOrigin[0] + tangent[0] * s + radial[0] * r + axis[0] * z,
      bendOrigin[1] + tangent[1] * s + radial[1] * r + axis[1] * z,
      bendOrigin[2] + tangent[2] * s + radial[2] * r + axis[2] * z,
    ]
  }

  const deformationGradient = (X: Vec3): Mat3 => {
    const qx = X[0] - bendOrigin[0], qy = X[1] - bendOrigin[1], qz = X[2] - bendOrigin[2]
    const s = qx * tangent[0] + qy * tangent[1] + qz * tangent[2]
    const r = qx * radial[0] + qy * radial[1] + qz * radial[2]
    const phi = s / R, c = Math.cos(phi), sn = Math.sin(phi), f = 1 + r / R
    requirePositiveRho(R * f) // ρ = R(1+r/R) = R+r
    // deformed basis vectors: ∂x/∂s, ∂x/∂r, ∂x/∂z (reference frame)
    const dxds: Vec3 = [f * (c * tangent[0] - sn * radial[0]), f * (c * tangent[1] - sn * radial[1]), f * (c * tangent[2] - sn * radial[2])]
    const dxdr: Vec3 = [sn * tangent[0] + c * radial[0], sn * tangent[1] + c * radial[1], sn * tangent[2] + c * radial[2]]
    const dxdz = axis
    // F[i][j] = ∂x_i/∂X_j = dxds_i·t̂_j + dxdr_i·r̂_j + dxdz_i·ẑ_j (chain rule through local coords)
    const F = new Array(9) as Mat3
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        F[i * 3 + j] = dxds[i] * tangent[j] + dxdr[i] * radial[j] + dxdz[i] * axis[j]
    return F
  }

  return { map, mapInto, inverseMap, deformationGradient }
}

/**
 * True if the reference arc s∈[sMin,sMax] (s = projection onto tangent relative to bendOrigin) spans
 * past a half-turn (|s| ≥ πR), where `inverseMap`'s principal atan2 branch cut makes recovery
 * multi-valued. Callers must reject a (field, reference shape) pair for which this is true
 * before filling — compute sMin/sMax from the shape's bbox corners projected onto `tangent`.
 */
export function cylindricalBendWrapsArc(R: number, sMin: number, sMax: number): boolean {
  return sMin <= -Math.PI * R || sMax >= Math.PI * R
}

/**
 * Pre-FILL wrap guard: does the straight reference body (its bbox) span past a half-turn under this
 * bend? Project the 8 bbox corners onto `tangent` (relative to bendOrigin) to get the arc s-range, then
 * test `cylindricalBendWrapsArc`. This is the ONLY valid place to detect wrap — after the build,
 * `inverseMap`'s principal atan2 has already folded a wrapped s back into (−πR, πR), so a post-build
 * guard cannot see it. Call this before filling and reject a wrapping pair.
 */
export function bentReferenceArcWraps(params: CylindricalBendParams, bboxMin: Vec3, bboxMax: Vec3): boolean {
  const { R, tangent, bendOrigin } = params
  let sMin = Infinity, sMax = -Infinity
  for (const cx of [bboxMin[0], bboxMax[0]])
    for (const cy of [bboxMin[1], bboxMax[1]])
      for (const cz of [bboxMin[2], bboxMax[2]]) {
        const s = (cx - bendOrigin[0]) * tangent[0] + (cy - bendOrigin[1]) * tangent[1] + (cz - bendOrigin[2]) * tangent[2]
        if (s < sMin) sMin = s
        if (s > sMax) sMax = s
      }
  return cylindricalBendWrapsArc(R, sMin, sMax)
}

/** Green–Lagrange strain E = ½(FᵀF − I), row-major 3×3 (symmetric). */
export function greenStrainLagrange(F: Mat3): Mat3 {
  const E = new Array(9) as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      // C_ij = Σ_k F_ki F_kj
      let c = 0
      for (let k = 0; k < 3; k++) c += F[k * 3 + i] * F[k * 3 + j]
      E[i * 3 + j] = 0.5 * (c - (i === j ? 1 : 0))
    }
  return E
}
