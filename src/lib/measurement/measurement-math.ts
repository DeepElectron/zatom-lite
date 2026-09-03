/** Pure distance, angle, and signed right-handed dihedral calculations. */

type Vec3 = [number, number, number]

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
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

function magnitude(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/** Distance |b - a| in input units (typically Angstrom). */
export function computeDistance(a: Vec3, b: Vec3): number {
  const d = sub(b, a)
  return magnitude(d)
}

/** Angle a-b-c in degrees (b is vertex). */
export function computeAngle(a: Vec3, b: Vec3, c: Vec3): number {
  const v1 = sub(a, b)
  const v2 = sub(c, b)
  const m1 = magnitude(v1)
  const m2 = magnitude(v2)
  if (m1 === 0 || m2 === 0) return 0
  return Math.acos(Math.max(-1, Math.min(1, dot(v1, v2) / (m1 * m2)))) * (180 / Math.PI)
}

/** Dihedral a-b-c-d in degrees, signed by right-hand rule, range (-180, 180]. */
export function computeDihedral(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a)
  const b2 = sub(c, b)
  const b3 = sub(d, c)
  const n1 = cross(b1, b2)
  const n2 = cross(b2, b3)
  const m1 = magnitude(n1)
  const m2 = magnitude(n2)
  if (m1 === 0 || m2 === 0) return 0

  let value = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2) / (m1 * m2)))) * (180 / Math.PI)
  // signed by checking n1 × b2 · n2 (right-hand sense)
  const m1b2 = cross(n1, b2)
  if (dot(m1b2, n2) < 0) value = -value
  return value
}
