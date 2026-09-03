/**
 * Uniform random rotation on SO(3) via Shoemake's method, returned as a
 * row-major 3x3 matrix (length 9). `rng` yields [0,1).
 */
export function randomRotationMatrix(rng: () => number): number[] {
  const u1 = rng(), u2 = rng(), u3 = rng()
  const sq1 = Math.sqrt(1 - u1), sq2 = Math.sqrt(u1)
  const t1 = 2 * Math.PI * u2, t2 = 2 * Math.PI * u3
  // quaternion (x,y,z,w)
  const x = sq1 * Math.sin(t1)
  const y = sq1 * Math.cos(t1)
  const z = sq2 * Math.sin(t2)
  const w = sq2 * Math.cos(t2)
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]
}

/** Apply a row-major 3x3 matrix to a 3-vector. */
export function applyMatrix(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}
