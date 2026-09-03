/**
 * Shortest lattice repeat along a Miller direction — what an extruded region's length
 * has to be a multiple of if the cell is to be periodic along that direction.
 *
 * When a periodic region is extruded along a lattice direction, the extrusion depth
 * cannot be arbitrary: it has to be an integer number of lattice repeats, or the two faces that
 * meet across the boundary do not register and the seam is a plane of wrong bond
 * lengths. Nothing reports that — the cell builds, the run starts, and the artefact
 * sits in the middle of the property being measured.
 *
 * For a cubic Bravais lattice the answer is closed-form. Reduce [hkl] to coprime
 * integers; then the shortest lattice vector along it is
 *
 *   simple cubic   a·(h,k,l)                                    always
 *   FCC / diamond  a/2·(h,k,l) when h+k+l is even, else a·(h,k,l)
 *   BCC            a/2·(h,k,l) when h, k, l are all odd, else a·(h,k,l)
 *
 * because FCC's lattice points are (n₁,n₂,n₃)·a/2 with n₁+n₂+n₃ even, and BCC's are
 * the integer points plus the all-half-integer ones.
 *
 * Reducing the direction first also avoids oversized but technically commensurate cells.
 * For example, the shortest FCC repeat along [211] is a·√6/2 rather than a·√6.
 */

export type CubicLatticeType = 'sc' | 'fcc' | 'bcc' | 'diamond'

/** Greatest common divisor of two non-negative integers. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

/**
 * Reduce a Miller direction to coprime integers, preserving sign and direction.
 * Throws on the zero direction rather than returning something that looks like an
 * answer.
 */
export function reduceMillerDirection(dir: readonly [number, number, number]): [number, number, number] {
  const rounded = dir.map((v) => Math.round(v)) as [number, number, number]
  if (rounded.some((v, i) => Math.abs(v - dir[i]) > 1e-6)) {
    throw new Error(
      `lattice period: [${dir}] is not a integer Miller direction; a repeat length is ` +
        `only defined along a lattice direction`,
    )
  }
  const g = rounded.reduce((acc, v) => gcd(acc, v), 0)
  if (g === 0) throw new Error('lattice period: the zero direction has no repeat length')
  return [rounded[0] / g, rounded[1] / g, rounded[2] / g]
}

/**
 * Shortest lattice repeat (Å) along `dir` for a cubic lattice of constant `a`.
 *
 * `diamond` behaves as `fcc`: the two-atom basis rides on every FCC lattice point, so
 * the translation that maps the lattice onto itself maps the crystal onto itself.
 */
export function latticeRepeatAlong(
  dir: readonly [number, number, number],
  a: number,
  lattice: CubicLatticeType = 'diamond',
): number {
  if (!(a > 0)) throw new Error(`lattice period: lattice constant must be positive (got ${a})`)
  const [h, k, l] = reduceMillerDirection(dir)
  const length = Math.hypot(h, k, l)

  let halves: boolean
  switch (lattice) {
    case 'sc':
      halves = false
      break
    case 'fcc':
    case 'diamond':
      halves = (Math.abs(h) + Math.abs(k) + Math.abs(l)) % 2 === 0
      break
    case 'bcc':
      halves = [h, k, l].every((v) => Math.abs(v) % 2 === 1)
      break
    default: {
      const never: never = lattice
      throw new Error(`lattice period: unknown lattice type ${String(never)}`)
    }
  }
  return halves ? (a * length) / 2 : a * length
}

export interface CommensurateLength {
  /** the length to build, in Å — an exact integer multiple of the repeat */
  length: number
  /** how many repeats that is */
  repeats: number
  /** the shortest repeat along this direction, in Å */
  repeat: number
  /** requested minus built, in Å; negative means the cell grew to reach one repeat */
  residual: number
}

/**
 * Round `target` to the nearest whole number of lattice repeats along `dir`, never to
 * zero.
 *
 * Returned rather than silently applied: the caller asked for a length, and a cell that
 * is 2 Å shorter than requested is a different cell from the one described. Handing
 * back the residual lets the caller report it.
 */
export function commensurateLengthAlong(
  target: number,
  dir: readonly [number, number, number],
  a: number,
  lattice: CubicLatticeType = 'diamond',
): CommensurateLength {
  if (!(target > 0)) throw new Error(`lattice period: target length must be positive (got ${target})`)
  const repeat = latticeRepeatAlong(dir, a, lattice)
  const repeats = Math.max(1, Math.round(target / repeat))
  const length = repeats * repeat
  return { length, repeats, repeat, residual: target - length }
}
