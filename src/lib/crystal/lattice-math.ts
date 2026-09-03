// Dependency-free lattice primitives shared by wrapping and unwrapping paths.

/** Cartesian or fractional triplet. */
export type Vec3 = [number, number, number]

/** Structural equivalent of the store's lattice-vector object. */
export interface LatticeLike {
  a: Vec3
  b: Vec3
  c: Vec3
}

/** Per-axis periodicity; false marks a physical, nonwrapping boundary. */
export interface PeriodicMask {
  a: boolean
  b: boolean
  c: boolean
}

export const FULLY_PERIODIC: PeriodicMask = { a: true, b: true, c: true }

export function isFiniteVec3(v: unknown): v is Vec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  )
}

export function isValidLattice(lattice: LatticeLike | null | undefined): lattice is LatticeLike {
  if (!lattice) return false
  if (!isFiniteVec3(lattice.a) || !isFiniteVec3(lattice.b) || !isFiniteVec3(lattice.c)) return false
  // Degenerate lattice (any vector is close to 0) is treated as aperiodic.
  const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2])
  return len(lattice.a) > 1e-9 && len(lattice.b) > 1e-9 && len(lattice.c) > 1e-9
}

/**
 * Invert the Cartesian-to-fractional lattice matrix, returning null for a
 * singular cell. Lattice vectors are matrix columns in `cart = M · frac`;
 * treating them as rows fails for nonorthogonal cells.
 */
export function invert3x3(lattice: LatticeLike): number[][] | null {
  // M[i][j] is component i of lattice vector j.
  const [a, b, c] = [lattice.a[0], lattice.b[0], lattice.c[0]]
  const [d, e, f] = [lattice.a[1], lattice.b[1], lattice.c[1]]
  const [g, h, i] = [lattice.a[2], lattice.b[2], lattice.c[2]]
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const invDet = 1 / det
  // inverse matrix = adj / det
  return [
    [(e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet],
    [(f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet],
    [(d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet],
  ]
}

/** Convert Cartesian coordinates with the result of `invert3x3`. */
export function toFractional(inv: number[][], x: number, y: number, z: number): Vec3 {
  return [
    inv[0][0] * x + inv[0][1] * y + inv[0][2] * z,
    inv[1][0] * x + inv[1][1] * y + inv[1][2] * z,
    inv[2][0] * x + inv[2][1] * y + inv[2][2] * z,
  ]
}

/** Return the integer lattice shift `na·a + nb·b + nc·c`. */
export function latticeShift(lattice: LatticeLike, na: number, nb: number, nc: number): Vec3 {
  const { a, b, c } = lattice
  return [
    na * a[0] + nb * b[0] + nc * c[0],
    na * a[1] + nb * b[1] + nc * c[1],
    na * a[2] + nb * b[2] + nc * c[2],
  ]
}
