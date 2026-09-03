/**
 * Twisted-bilayer Moiré builder — COMMENSURATE construction.
 *
 * An arbitrary rectangular clip is not periodic except at special angles and
 * therefore cannot tile or form correct boundary bonds. This builder instead
 * creates the exact commensurate Moiré supercell for a pair of
 * integers (m, n): the twist angle is fixed by (m,n) and BOTH layers fill the
 * SAME rhombic superlattice (t1, t2), so the cell tiles seamlessly.
 *
 *   a1 = [a, 0],  a2 = [a/2, a√3/2]            (hexagonal primitive, 60°)
 *   cos θ = (n² + 4nm + m²) / (2(n² + nm + m²))
 *   t1 = m·a1 + n·a2 ,  t2 = −n·a1 + (m+n)·a2  (the Moiré lattice; |t1|=|t2|, 60° apart)
 *   N  = 4(m² + mn + n²)                        atoms in the bilayer cell (gcd(m,n)=1)
 *
 * The user gives a TARGET twist angle in the full [0, 60] degree orientation
 * window; we pick the commensurate (m,n) whose angle is closest (subject to a
 * maximum atom count) and report the exact angle realised.  Keeping the full
 * window matters for binary honeycombs such as hBN, where 0° and 60° exchange
 * sublattices and are not generally equivalent.  Rotation is about the AA
 * lattice point at the Cartesian origin; both layers are projected with the
 * same [t1 t2]⁻¹ and clipped half-open in fractional coords so every atom is
 * counted once.
 */

import type { BuilderResult } from './types'

const A_CC_GRAPHENE = 1.42

export interface MoireOptions {
  /** Target twist angle in [0, 60] deg. The builder snaps to the nearest commensurate angle. */
  twist_angle_deg: number
  /** Inter-layer spacing in Å. */
  interlayer?: number
  bond_length?: number
  elements?: [string, string]
  /** Vacuum gap along z above the bilayer (Å). */
  vacuum?: number
  /** Hard cap on bilayer atom count (small angles → very large cells). */
  maxAtoms?: number
  /** Optional exact reduced commensurate pair. Both values are integers, m≥n≥0. */
  commensurate?: { m: number; n: number }
  // NOTE: nx/ny are gone — the commensurate cell size is fixed by (m,n).
}

export interface CommensurateMoireCell {
  m: number
  n: number
  thetaRad: number
  thetaDeg: number
  atoms: number
}

/** Structured measurements consumed by agent/provider validation gates. */
export interface MoireResult extends BuilderResult {
  m: number
  n: number
  targetTwistDeg: number
  realizedTwistDeg: number
  twistErrorDeg: number
  expectedAtomCount: number
  layerAtomCounts: [number, number]
  layerIndices: number[]
  sublatticeIndices: number[]
  bondLengthA: number
  latticeConstantA: number
  interlayerA: number
  vacuumA: number
  moireLatticeLengthA: number
  cellAreaA2: number
  cellAngleDeg: number
  periodicSeamResidualA: number
}

type Vec2 = [number, number]

function gcd(a: number, b: number): number {
  a = Math.abs(a); b = Math.abs(b)
  while (b) { [a, b] = [b, a % b] }
  return a
}

function rotate2d(x: number, y: number, c: number, s: number): Vec2 {
  return [c * x - s * y, s * x + c * y]
}

function commensurateCell(m: number, n: number): CommensurateMoireCell {
  const q = m * m + m * n + n * n
  const cos = (n * n + 4 * n * m + m * m) / (2 * q)
  const thetaRad = Math.acos(Math.max(-1, Math.min(1, cos)))
  return { m, n, thetaRad, thetaDeg: thetaRad * 180 / Math.PI, atoms: 4 * q }
}

function assertCommensuratePair(pair: { m: number; n: number }, maxAtoms: number): CommensurateMoireCell {
  const { m, n } = pair
  if (!Number.isInteger(m) || !Number.isInteger(n) || m < 1 || n < 0 || n > m || gcd(m, n) !== 1) {
    throw new Error('commensurate must be a reduced integer pair with m≥1 and 0≤n≤m')
  }
  const cell = commensurateCell(m, n)
  if (cell.atoms > maxAtoms) {
    throw new Error(`Exact commensurate pair (${m},${n}) needs ${cell.atoms} atoms, above maxAtoms ${maxAtoms}.`)
  }
  return cell
}

/** Pick the commensurate (m,n) whose twist angle is closest to the target,
 *  among reduced pairs (gcd=1, m>n≥0) with ≤ maxAtoms atoms.  (1,1) is
 *  included as the exact 0° construction; it is deliberately non-minimal but
 *  preserves the two-sublattice orientation for binary honeycombs. */
export function pickCommensurateMoireCell(
  targetDeg: number,
  maxAtoms: number,
  exact?: { m: number; n: number },
): CommensurateMoireCell | null {
  if (exact) return assertCommensuratePair(exact, maxAtoms)
  let best: CommensurateMoireCell | null = null
  const maxM = Math.ceil(Math.sqrt(maxAtoms / 4)) + 2
  const consider = (candidate: CommensurateMoireCell) => {
    if (candidate.atoms > maxAtoms) return
    const dist = Math.abs(candidate.thetaDeg - targetDeg)
    const bestDist = best ? Math.abs(best.thetaDeg - targetDeg) : Infinity
    if (!best || dist < bestDist - 1e-12 || (Math.abs(dist - bestDist) <= 1e-12 && candidate.atoms < best.atoms)) {
      best = candidate
    }
  }
  if (maxAtoms >= 12) consider(commensurateCell(1, 1))
  for (let m = 1; m <= maxM; m++) {
    for (let n = 0; n < m; n++) {
      if (gcd(m, n) !== 1) continue
      consider(commensurateCell(m, n))
    }
  }
  return best
}

function finitePositive(value: number, name: string, allowZero = false): number {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${name} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`)
  }
  return value
}

function primitiveTranslationResidual(vector: Vec2, a1: Vec2, a2: Vec2): number {
  const [x, y] = primitiveCoordinates(vector, a1, a2)
  const dx = x - Math.round(x)
  const dy = y - Math.round(y)
  return Math.hypot(dx * a1[0] + dy * a2[0], dx * a1[1] + dy * a2[1])
}

function primitiveCoordinates(vector: Vec2, a1: Vec2, a2: Vec2): Vec2 {
  const det = a1[0] * a2[1] - a1[1] * a2[0]
  return [
    (a2[1] * vector[0] - a2[0] * vector[1]) / det,
    (-a1[1] * vector[0] + a1[0] * vector[1]) / det,
  ]
}

export function buildMoire(opts: MoireOptions): MoireResult {
  if (!Number.isFinite(opts.twist_angle_deg) || opts.twist_angle_deg < 0 || opts.twist_angle_deg > 60) {
    throw new Error('twist_angle_deg must be a finite angle from 0 through 60 degrees')
  }
  const interlayer = opts.interlayer ?? 3.35
  const bondLength = opts.bond_length ?? A_CC_GRAPHENE
  finitePositive(interlayer, 'interlayer')
  finitePositive(bondLength, 'bond_length')
  const a = bondLength * Math.sqrt(3)
  const [elA, elB] = opts.elements ?? ['C', 'C']
  const vacuum = opts.vacuum ?? 12
  finitePositive(vacuum, 'vacuum', true)
  if (!elA.trim() || !elB.trim()) throw new Error('elements must contain two non-empty symbols')
  const rawMaxAtoms = opts.maxAtoms ?? 6000
  if (!Number.isFinite(rawMaxAtoms) || !Number.isInteger(rawMaxAtoms) || rawMaxAtoms < 4) {
    throw new Error('maxAtoms must be an integer of at least 4')
  }
  const maxAtoms = rawMaxAtoms

  const pick = pickCommensurateMoireCell(opts.twist_angle_deg, maxAtoms, opts.commensurate)
  if (!pick) {
    throw new Error(`No commensurate Moiré cell ≤ ${maxAtoms} atoms near ${opts.twist_angle_deg}°. Raise maxAtoms or pick a larger angle.`)
  }
  const { m, n, thetaRad, thetaDeg, atoms: expectAtoms } = pick

  const a1: Vec2 = [a, 0]
  const a2: Vec2 = [a / 2, (a * Math.sqrt(3)) / 2]
  const basis = [
    { el: elA, frac: [0, 0] as Vec2 },
    { el: elB, frac: [1 / 3, 1 / 3] as Vec2 },
  ]

  // Moiré superlattice vectors (shared by both layers).
  const t1: Vec2 = [m * a1[0] + n * a2[0], m * a1[1] + n * a2[1]]
  const t2: Vec2 = [-n * a1[0] + (m + n) * a2[0], -n * a1[1] + (m + n) * a2[1]]
  // Inverse of [t1 t2] (column vectors) for the Cartesian→fractional projection.
  const det = t1[0] * t2[1] - t1[1] * t2[0]
  const inv = [
    [t2[1] / det, -t2[0] / det],
    [-t1[1] / det, t1[0] / det],
  ]
  const toFrac = (x: number, y: number): Vec2 => [inv[0][0] * x + inv[0][1] * y, inv[1][0] * x + inv[1][1] * y]

  const cTheta = Math.cos(thetaRad)
  const sTheta = Math.sin(thetaRad)
  const EPS = 1e-7
  const out: Array<{ el: string; x: number; y: number; z: number; layer: number; sublattice: number }> = []
  const fillLayer = (rotate: boolean, zLayer: number, layer: number) => {
    // Derive a complete enumeration range by mapping all four supercell
    // corners back into this layer's primitive basis.  A symmetric m+n guess
    // misses a wedge of the rotated layer for small-angle, large (m,n) cells.
    const corners: Vec2[] = [[0, 0], t1, t2, [t1[0] + t2[0], t1[1] + t2[1]]]
    const primitiveCorners = corners.map((corner) => {
      const layerVector = rotate ? rotate2d(corner[0], corner[1], cTheta, sTheta) : corner
      return primitiveCoordinates(layerVector, a1, a2)
    })
    const iMin = Math.floor(Math.min(...primitiveCorners.map((corner) => corner[0]))) - 2
    const iMax = Math.ceil(Math.max(...primitiveCorners.map((corner) => corner[0]))) + 2
    const jMin = Math.floor(Math.min(...primitiveCorners.map((corner) => corner[1]))) - 2
    const jMax = Math.ceil(Math.max(...primitiveCorners.map((corner) => corner[1]))) + 2
    for (let i = iMin; i <= iMax; i++) {
      for (let j = jMin; j <= jMax; j++) {
        for (let sublattice = 0; sublattice < basis.length; sublattice++) {
          const b = basis[sublattice]
          const fx = i + b.frac[0]
          const fy = j + b.frac[1]
          let x = fx * a1[0] + fy * a2[0]
          let y = fx * a1[1] + fy * a2[1]
          if (rotate) {
            // This (t1,t2) convention maps the top lattice into the shared
            // supercell under a clockwise rotation by θ.  The reported twist
            // is its positive magnitude.
            const r = rotate2d(x, y, cTheta, -sTheta) // about the AA origin
            x = r[0]; y = r[1]
          }
          const projected = toFrac(x, y) // same [t1 t2]⁻¹ for both layers
          // Snap floating-point boundary noise before applying the exact
          // half-open [0,1) rule.  Merely accepting values down to -EPS keeps
          // both representatives of a periodic boundary and adds one atom.
          const s = Math.abs(projected[0]) <= EPS ? 0 : Math.abs(projected[0] - 1) <= EPS ? 1 : projected[0]
          const u = Math.abs(projected[1]) <= EPS ? 0 : Math.abs(projected[1] - 1) <= EPS ? 1 : projected[1]
          if (s < 0 || s >= 1) continue
          if (u < 0 || u >= 1) continue
          out.push({ el: b.el, x, y, z: zLayer, layer, sublattice })
        }
      }
    }
  }
  fillLayer(false, 0, 0)          // bottom layer (unrotated)
  fillLayer(true, interlayer, 1)  // top layer (rotated by θ)

  const layerAtomCounts: [number, number] = [
    out.filter((atom) => atom.layer === 0).length,
    out.filter((atom) => atom.layer === 1).length,
  ]

  // Self-check: a correct commensurate fill yields exactly 4(m²+mn+n²) atoms.
  // A mismatch means a range/epsilon bug (and the boundary-connectivity issue
  // we are fixing), so fail loudly rather than ship a broken cell.
  if (out.length !== expectAtoms) {
    throw new Error(`Moiré fill produced ${out.length} atoms (${layerAtomCounts.join(' + ')}), expected ${expectAtoms} for (m,n)=(${m},${n}). Internal range/epsilon error.`)
  }

  const cellZ = interlayer + vacuum
  const t1Length = Math.hypot(...t1)
  const t2Length = Math.hypot(...t2)
  const cellAngleDeg = Math.acos(Math.max(-1, Math.min(1, (t1[0] * t2[0] + t1[1] * t2[1]) / (t1Length * t2Length)))) * 180 / Math.PI
  const inverseRotatedT1 = rotate2d(t1[0], t1[1], cTheta, sTheta)
  const inverseRotatedT2 = rotate2d(t2[0], t2[1], cTheta, sTheta)
  const periodicSeamResidualA = Math.max(
    primitiveTranslationResidual(t1, a1, a2),
    primitiveTranslationResidual(t2, a1, a2),
    primitiveTranslationResidual(inverseRotatedT1, a1, a2),
    primitiveTranslationResidual(inverseRotatedT2, a1, a2),
  )
  // Full 3×3 lattice (t1, t2 are NOT axis-aligned — a proper rhombic Moiré cell).
  const lat = [t1[0], t1[1], 0, t2[0], t2[1], 0, 0, 0, cellZ].map((v) => v.toFixed(6)).join(' ')
  const lines: string[] = [String(out.length), `Lattice="${lat}" Twist=${thetaDeg.toFixed(3)} commensurate Moiré (m=${m},n=${n})`]
  for (const atom of out) {
    lines.push(`${atom.el} ${atom.x.toFixed(6)} ${atom.y.toFixed(6)} ${(atom.z + vacuum / 2).toFixed(6)}`)
  }
  return {
    xyz: lines.join('\n'),
    description: `Commensurate Moiré · θ = ${thetaDeg.toFixed(3)}° · (m,n)=(${m},${n}) · ${out.length} atoms`,
    n_atoms: out.length,
    m,
    n,
    targetTwistDeg: opts.twist_angle_deg,
    realizedTwistDeg: thetaDeg,
    twistErrorDeg: Math.abs(thetaDeg - opts.twist_angle_deg),
    expectedAtomCount: expectAtoms,
    layerAtomCounts,
    layerIndices: out.map((atom) => atom.layer),
    sublatticeIndices: out.map((atom) => atom.sublattice),
    bondLengthA: bondLength,
    latticeConstantA: a,
    interlayerA: interlayer,
    vacuumA: vacuum,
    moireLatticeLengthA: t1Length,
    cellAreaA2: Math.abs(det),
    cellAngleDeg,
    periodicSeamResidualA,
  }
}
