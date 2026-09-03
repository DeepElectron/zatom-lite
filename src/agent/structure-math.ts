import type { Mat3, Vec3, ZatomLattice, ZatomStructure } from './contracts'

export function determinant3(m: Mat3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

export function invert3(m: Mat3): Mat3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const det = determinant3(m)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const s = 1 / det
  return [
    [(e * i - f * h) * s, (c * h - b * i) * s, (b * f - c * e) * s],
    [(f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s],
    [(d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s],
  ]
}

/** Row-vector lattice: cart = frac[0]a + frac[1]b + frac[2]c. */
export function fractionalToCartesian(frac: readonly number[], lattice: Mat3): Vec3 {
  return [
    frac[0] * lattice[0][0] + frac[1] * lattice[1][0] + frac[2] * lattice[2][0],
    frac[0] * lattice[0][1] + frac[1] * lattice[1][1] + frac[2] * lattice[2][1],
    frac[0] * lattice[0][2] + frac[1] * lattice[1][2] + frac[2] * lattice[2][2],
  ]
}

export function cartesianToFractional(cart: readonly number[], lattice: Mat3): Vec3 | null {
  const inv = invert3(lattice)
  if (!inv) return null
  // frac = cart * inverse(lattice rows)^T
  return [
    inv[0][0] * cart[0] + inv[1][0] * cart[1] + inv[2][0] * cart[2],
    inv[0][1] * cart[0] + inv[1][1] * cart[1] + inv[2][1] * cart[2],
    inv[0][2] * cart[0] + inv[1][2] * cart[1] + inv[2][2] * cart[2],
  ]
}

export function wrapFractional(frac: Vec3, periodic: readonly boolean[]): Vec3 {
  return [
    periodic[0] ? frac[0] - Math.floor(frac[0]) : frac[0],
    periodic[1] ? frac[1] - Math.floor(frac[1]) : frac[1],
    periodic[2] ? frac[2] - Math.floor(frac[2]) : frac[2],
  ]
}

export function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function applyMatrix3(matrix: Mat3, vector: readonly number[]): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

function normalizedVector3(value: readonly number[], field: string): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (!Number.isFinite(length) || length < 1e-12) throw new Error(`${field} must have non-zero finite length`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function dot3(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross3(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

/** Right-handed Rodrigues rotation for Cartesian column vectors. */
export function rotationMatrixAroundAxis(axisValue: readonly number[], angleRad: number): Mat3 {
  if (!Number.isFinite(angleRad)) throw new Error('rotation angle must be finite')
  const [x, y, z] = normalizedVector3(axisValue, 'rotation axis')
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)
  const oneMinusCosine = 1 - cosine
  return [
    [cosine + x * x * oneMinusCosine, x * y * oneMinusCosine - z * sine, x * z * oneMinusCosine + y * sine],
    [y * x * oneMinusCosine + z * sine, cosine + y * y * oneMinusCosine, y * z * oneMinusCosine - x * sine],
    [z * x * oneMinusCosine - y * sine, z * y * oneMinusCosine + x * sine, cosine + z * z * oneMinusCosine],
  ]
}

export interface VectorAlignmentRotation {
  matrix: Mat3
  axis: Vec3 | null
  angleRad: number
}

/** Smallest right-handed rotation mapping one direction onto another. */
export function rotationBetweenVectors(
  fromValue: readonly number[],
  toValue: readonly number[],
  antiparallelAxis?: readonly number[],
): VectorAlignmentRotation {
  const from = normalizedVector3(fromValue, 'alignment source vector')
  const to = normalizedVector3(toValue, 'alignment target vector')
  const cosine = Math.max(-1, Math.min(1, dot3(from, to)))
  const cross = cross3(from, to)
  const sine = Math.hypot(cross[0], cross[1], cross[2])
  if (sine >= 1e-12) {
    const axis: Vec3 = [cross[0] / sine, cross[1] / sine, cross[2] / sine]
    const angleRad = Math.atan2(sine, cosine)
    return { matrix: rotationMatrixAroundAxis(axis, angleRad), axis, angleRad }
  }
  if (cosine > 0) {
    return {
      matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      axis: null,
      angleRad: 0,
    }
  }
  let axis: Vec3
  if (antiparallelAxis) {
    axis = normalizedVector3(antiparallelAxis, 'antiparallel alignment axis')
    if (Math.abs(dot3(axis, from)) > 1e-10) {
      throw new Error('antiparallel alignment axis must be perpendicular to the source vector')
    }
  } else {
    const basis: Vec3 = Math.abs(from[0]) <= Math.abs(from[1]) && Math.abs(from[0]) <= Math.abs(from[2])
      ? [1, 0, 0]
      : Math.abs(from[1]) <= Math.abs(from[2]) ? [0, 1, 0] : [0, 0, 1]
    axis = normalizedVector3(cross3(from, basis), 'deterministic antiparallel alignment axis')
  }
  return { matrix: rotationMatrixAroundAxis(axis, Math.PI), axis, angleRad: Math.PI }
}

/** Build once for hot pair loops so the lattice inverse is not recomputed per pair. */
export function createDistanceCalculator(lattice?: ZatomLattice): (a: readonly number[], b: readonly number[]) => number {
  if (!lattice || !lattice.periodic.some(Boolean)) return distance
  const inverse = invert3(lattice.vectors)
  if (!inverse) return () => Number.NaN
  const fractional = (cart: readonly number[]): Vec3 => [
    inverse[0][0] * cart[0] + inverse[1][0] * cart[1] + inverse[2][0] * cart[2],
    inverse[0][1] * cart[0] + inverse[1][1] * cart[1] + inverse[2][1] * cart[2],
    inverse[0][2] * cart[0] + inverse[1][2] * cart[1] + inverse[2][2] * cart[2],
  ]
  const xs = lattice.periodic[0] ? [-1, 0, 1] : [0]
  const ys = lattice.periodic[1] ? [-1, 0, 1] : [0]
  const zs = lattice.periodic[2] ? [-1, 0, 1] : [0]
  return (a, b) => {
    const fa = fractional(a)
    const fb = fractional(b)
    const baseDelta: Vec3 = [fb[0] - fa[0], fb[1] - fa[1], fb[2] - fa[2]]
    for (let axis = 0; axis < 3; axis++) {
      if (lattice.periodic[axis]) baseDelta[axis] -= Math.round(baseDelta[axis])
    }
    let best2 = Number.POSITIVE_INFINITY
    for (const ix of xs) for (const iy of ys) for (const iz of zs) {
      const d = fractionalToCartesian([baseDelta[0] + ix, baseDelta[1] + iy, baseDelta[2] + iz], lattice.vectors)
      const d2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      if (d2 < best2) best2 = d2
    }
    return Math.sqrt(best2)
  }
}

export interface CertifiedMinimumImageVector {
  vector: Vec3
  distance: number
  fractionalImage: [number, number, number]
  candidateEvaluations: number
}

export interface CertifiedPeriodicTranslation {
  vector: Vec3
  distance: number
  fractionalImage: [number, number, number]
  candidateEvaluations: number
}

export interface PeriodicImageWithinCutoff {
  vector: Vec3
  distance: number
  fractionalImage: [number, number, number]
}

export interface PeriodicImagesWithinCutoff {
  images: PeriodicImageWithinCutoff[]
  candidateEvaluations: number
}

function symmetricEigenvalues3(matrix: Mat3): [number, number, number] {
  const work = matrix.map((row) => [...row] as Vec3) as Mat3
  for (let sweep = 0; sweep < 32; sweep++) {
    let p: 0 | 1 | 2 = 0
    let q: 0 | 1 | 2 = 1
    let largest = Math.abs(work[0][1])
    for (const [row, column] of [[0, 2], [1, 2]] as const) {
      const value = Math.abs(work[row][column])
      if (value > largest) {
        largest = value
        p = row
        q = column
      }
    }
    if (largest <= 1e-14 * Math.max(1, Math.abs(work[0][0]), Math.abs(work[1][1]), Math.abs(work[2][2]))) break
    const angle = 0.5 * Math.atan2(2 * work[p][q], work[q][q] - work[p][p])
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const app = work[p][p]
    const aqq = work[q][q]
    const apq = work[p][q]
    work[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq
    work[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq
    work[p][q] = 0
    work[q][p] = 0
    for (const index of [0, 1, 2] as const) {
      if (index === p || index === q) continue
      const aip = work[index][p]
      const aiq = work[index][q]
      work[index][p] = cosine * aip - sine * aiq
      work[p][index] = work[index][p]
      work[index][q] = sine * aip + cosine * aiq
      work[q][index] = work[index][q]
    }
  }
  return [work[0][0], work[1][1], work[2][2]].sort((left, right) => right - left) as [number, number, number]
}

function latticeMinimumSingularValue(lattice: ZatomLattice): number {
  const gram = lattice.vectors.map((left) => lattice.vectors.map((right) => (
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  )) as Vec3) as Mat3
  const minimumEigenvalue = symmetricEigenvalues3(gram)[2]
  if (!Number.isFinite(minimumEigenvalue) || minimumEigenvalue <= 1e-20) {
    throw new Error('Lattice is singular or too ill-conditioned for certified minimum-image calculation')
  }
  return Math.sqrt(minimumEigenvalue)
}

function periodicSubspaceMinimumSingularValue(lattice: ZatomLattice): number | null {
  const vectors = lattice.vectors.filter((_, axis) => lattice.periodic[axis])
  if (!vectors.length) return null
  if (vectors.length === 1) {
    const length = Math.hypot(vectors[0][0], vectors[0][1], vectors[0][2])
    if (!Number.isFinite(length) || length <= 1e-10) {
      throw new Error('Periodic lattice vector is singular or too ill-conditioned')
    }
    return length
  }
  if (vectors.length === 2) {
    const aa = dot3(vectors[0], vectors[0])
    const bb = dot3(vectors[1], vectors[1])
    const ab = dot3(vectors[0], vectors[1])
    const discriminant = Math.hypot(aa - bb, 2 * ab)
    const minimumEigenvalue = (aa + bb - discriminant) / 2
    if (!Number.isFinite(minimumEigenvalue) || minimumEigenvalue <= 1e-20) {
      throw new Error('Periodic lattice subspace is singular or too ill-conditioned')
    }
    return Math.sqrt(minimumEigenvalue)
  }
  return latticeMinimumSingularValue(lattice)
}

interface PreparedCertifiedMinimumImageLattice {
  inverse: Mat3
  minimumSingularValue: number
}

function prepareCertifiedMinimumImageLattice(lattice: ZatomLattice): PreparedCertifiedMinimumImageLattice {
  const inverse = invert3(lattice.vectors)
  if (!inverse) throw new Error('Cannot invert lattice for certified minimum-image calculation')
  return { inverse, minimumSingularValue: latticeMinimumSingularValue(lattice) }
}

function certifiedMinimumImageVectorPrepared(
  deltaCartesian: readonly number[],
  lattice: ZatomLattice,
  prepared: PreparedCertifiedMinimumImageLattice,
  maxCandidateEvaluations: number,
): CertifiedMinimumImageVector {
  if (!Number.isSafeInteger(maxCandidateEvaluations) || maxCandidateEvaluations < 1) {
    throw new Error('maxCandidateEvaluations must be a positive safe integer')
  }
  const { inverse, minimumSingularValue } = prepared
  const fractional: Vec3 = [
    inverse[0][0] * deltaCartesian[0] + inverse[1][0] * deltaCartesian[1] + inverse[2][0] * deltaCartesian[2],
    inverse[0][1] * deltaCartesian[0] + inverse[1][1] * deltaCartesian[1] + inverse[2][1] * deltaCartesian[2],
    inverse[0][2] * deltaCartesian[0] + inverse[1][2] * deltaCartesian[1] + inverse[2][2] * deltaCartesian[2],
  ]
  const initialImage: [number, number, number] = [0, 1, 2].map((axis) => (
    lattice.periodic[axis] ? -Math.round(fractional[axis]) : 0
  )) as [number, number, number]
  const vectorFor = (image: readonly number[]): Vec3 => fractionalToCartesian([
    fractional[0] + image[0],
    fractional[1] + image[1],
    fractional[2] + image[2],
  ], lattice.vectors)
  let bestImage = initialImage
  let bestVector = vectorFor(initialImage)
  let bestSquared = bestVector[0] ** 2 + bestVector[1] ** 2 + bestVector[2] ** 2
  const radius = Math.sqrt(bestSquared) / minimumSingularValue + 1e-12
  const ranges = ([0, 1, 2] as const).map((axis): [number, number] => {
    if (!lattice.periodic[axis]) return [0, 0]
    return [Math.ceil(-fractional[axis] - radius), Math.floor(-fractional[axis] + radius)]
  })
  const candidateCount = ranges.reduce((product, [minimum, maximum]) => (
    product * Math.max(0, maximum - minimum + 1)
  ), 1)
  if (!Number.isSafeInteger(candidateCount) || candidateCount > maxCandidateEvaluations) {
    throw new Error(`Certified minimum-image search requires ${candidateCount} candidates above budget ${maxCandidateEvaluations}`)
  }
  const tieTolerance = Math.max(1e-24, bestSquared * 1e-14)
  let evaluations = 0
  for (let first = ranges[0][0]; first <= ranges[0][1]; first++) {
    for (let second = ranges[1][0]; second <= ranges[1][1]; second++) {
      for (let third = ranges[2][0]; third <= ranges[2][1]; third++) {
        evaluations += 1
        const image: [number, number, number] = [first, second, third]
        const vector = vectorFor(image)
        const squared = vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2
        const lexicographicallyEarlier = image[0] < bestImage[0]
          || (image[0] === bestImage[0] && image[1] < bestImage[1])
          || (image[0] === bestImage[0] && image[1] === bestImage[1] && image[2] < bestImage[2])
        if (squared < bestSquared - tieTolerance || (Math.abs(squared - bestSquared) <= tieTolerance && lexicographicallyEarlier)) {
          bestSquared = squared
          bestVector = vector
          bestImage = image
        }
      }
    }
  }
  return {
    vector: bestVector,
    distance: Math.sqrt(Math.max(0, bestSquared)),
    fractionalImage: bestImage,
    candidateEvaluations: evaluations,
  }
}

/** Prepare the lattice inverse and singular-value bound once for a hot exact pair loop. */
export function createCertifiedMinimumImageCalculator(
  lattice: ZatomLattice,
): (deltaCartesian: readonly number[], maxCandidateEvaluations?: number) => CertifiedMinimumImageVector {
  const prepared = prepareCertifiedMinimumImageLattice(lattice)
  return (deltaCartesian, maxCandidateEvaluations = 1_000_000) => certifiedMinimumImageVectorPrepared(
    deltaCartesian,
    lattice,
    prepared,
    maxCandidateEvaluations,
  )
}

/**
 * Solve the periodic closest-vector problem with a singular-value-bounded
 * finite enumeration. Unlike component-wise fractional rounding or a fixed
 * 3x3x3 neighborhood, this remains exact for arbitrarily skewed nonsingular
 * cells until the caller's explicit candidate budget is exhausted.
 */
export function certifiedMinimumImageVector(
  deltaCartesian: readonly number[],
  lattice: ZatomLattice,
  maxCandidateEvaluations = 1_000_000,
): CertifiedMinimumImageVector {
  return createCertifiedMinimumImageCalculator(lattice)(deltaCartesian, maxCandidateEvaluations)
}

/**
 * Find the exact shortest nonzero translation generated by the declared
 * periodic lattice axes. This closes the self-image contact hole present in
 * ordinary distinct-atom minimum-image scans.
 */
export function certifiedShortestPeriodicTranslation(
  lattice: ZatomLattice,
  maxCandidateEvaluations = 1_000_000,
): CertifiedPeriodicTranslation | null {
  if (!Number.isSafeInteger(maxCandidateEvaluations) || maxCandidateEvaluations < 1) {
    throw new Error('maxCandidateEvaluations must be a positive safe integer')
  }
  const minimumSingularValue = periodicSubspaceMinimumSingularValue(lattice)
  if (minimumSingularValue === null) return null
  let bestImage: [number, number, number] | null = null
  let bestVector: Vec3 | null = null
  let bestSquared = Number.POSITIVE_INFINITY
  for (const axis of [0, 1, 2] as const) {
    if (!lattice.periodic[axis]) continue
    const image: [number, number, number] = [0, 0, 0]
    image[axis] = 1
    const vector = fractionalToCartesian(image, lattice.vectors)
    const squared = dot3(vector, vector)
    if (squared < bestSquared) {
      bestImage = image
      bestVector = vector
      bestSquared = squared
    }
  }
  if (!bestImage || !bestVector || !Number.isFinite(bestSquared)) {
    throw new Error('Periodic lattice translation could not be initialized')
  }
  const radius = Math.sqrt(bestSquared) / minimumSingularValue + 1e-12
  const limit = Math.max(1, Math.ceil(radius))
  const ranges = ([0, 1, 2] as const).map((axis): [number, number] => (
    lattice.periodic[axis] ? [-limit, limit] : [0, 0]
  ))
  const candidateCount = ranges.reduce((product, [minimum, maximum]) => (
    product * (maximum - minimum + 1)
  ), 1) - 1
  if (!Number.isSafeInteger(candidateCount) || candidateCount > maxCandidateEvaluations) {
    throw new Error(`Certified shortest-translation search requires ${candidateCount} candidates above budget ${maxCandidateEvaluations}`)
  }
  const tieTolerance = Math.max(1e-24, bestSquared * 1e-14)
  let evaluations = 0
  for (let first = ranges[0][0]; first <= ranges[0][1]; first++) {
    for (let second = ranges[1][0]; second <= ranges[1][1]; second++) {
      for (let third = ranges[2][0]; third <= ranges[2][1]; third++) {
        if (first === 0 && second === 0 && third === 0) continue
        evaluations += 1
        const image: [number, number, number] = [first, second, third]
        const vector = fractionalToCartesian(image, lattice.vectors)
        const squared = dot3(vector, vector)
        const lexicographicallyEarlier = image[0] < bestImage[0]
          || (image[0] === bestImage[0] && image[1] < bestImage[1])
          || (image[0] === bestImage[0] && image[1] === bestImage[1] && image[2] < bestImage[2])
        if (squared < bestSquared - tieTolerance || (Math.abs(squared - bestSquared) <= tieTolerance && lexicographicallyEarlier)) {
          bestSquared = squared
          bestVector = vector
          bestImage = image
        }
      }
    }
  }
  return {
    vector: bestVector,
    distance: Math.sqrt(Math.max(0, bestSquared)),
    fractionalImage: bestImage,
    candidateEvaluations: evaluations,
  }
}

/**
 * Enumerate every declared-periodic image whose Cartesian displacement lies
 * inside one cutoff sphere. A singular-value bound makes the integer search
 * finite and complete for any nonsingular skew cell; the caller controls the
 * hard candidate budget.
 */
export function enumeratePeriodicImagesWithinCutoff(
  deltaCartesian: readonly number[],
  lattice: ZatomLattice,
  cutoffA: number,
  maxCandidateEvaluations = 1_000_000,
): PeriodicImagesWithinCutoff {
  if (!Number.isFinite(cutoffA) || cutoffA < 0) throw new Error('cutoffA must be finite and non-negative')
  if (!Number.isSafeInteger(maxCandidateEvaluations) || maxCandidateEvaluations < 1) {
    throw new Error('maxCandidateEvaluations must be a positive safe integer')
  }
  const fractional = cartesianToFractional(deltaCartesian, lattice.vectors)
  if (!fractional) throw new Error('Cannot invert lattice for periodic-image enumeration')
  const gram = lattice.vectors.map((left) => lattice.vectors.map((right) => (
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  )) as Vec3) as Mat3
  const minimumEigenvalue = symmetricEigenvalues3(gram)[2]
  if (!Number.isFinite(minimumEigenvalue) || minimumEigenvalue <= 1e-20) {
    throw new Error('Lattice is singular or too ill-conditioned for periodic-image enumeration')
  }
  const toleranceA = Math.max(1e-12, cutoffA * 1e-12)
  const radiusFractional = (cutoffA + toleranceA) / Math.sqrt(minimumEigenvalue)
  const ranges = ([0, 1, 2] as const).map((axis): [number, number] => {
    if (!lattice.periodic[axis]) return [0, 0]
    return [
      Math.ceil(-fractional[axis] - radiusFractional),
      Math.floor(-fractional[axis] + radiusFractional),
    ]
  })
  const candidateEvaluations = ranges.reduce((product, [minimum, maximum]) => (
    product * Math.max(0, maximum - minimum + 1)
  ), 1)
  if (!Number.isSafeInteger(candidateEvaluations) || candidateEvaluations > maxCandidateEvaluations) {
    throw new Error(
      `Periodic-image enumeration requires ${candidateEvaluations} candidates above budget ${maxCandidateEvaluations}`,
    )
  }
  const maximumSquared = (cutoffA + toleranceA) ** 2
  const images: PeriodicImageWithinCutoff[] = []
  for (let first = ranges[0][0]; first <= ranges[0][1]; first++) {
    for (let second = ranges[1][0]; second <= ranges[1][1]; second++) {
      for (let third = ranges[2][0]; third <= ranges[2][1]; third++) {
        const fractionalImage: [number, number, number] = [first, second, third]
        const vector = fractionalToCartesian([
          fractional[0] + first,
          fractional[1] + second,
          fractional[2] + third,
        ], lattice.vectors)
        const squared = vector[0] ** 2 + vector[1] ** 2 + vector[2] ** 2
        if (squared <= maximumSquared) {
          images.push({ vector, distance: Math.sqrt(Math.max(0, squared)), fractionalImage })
        }
      }
    }
  }
  images.sort((left, right) => (
    left.distance - right.distance
    || left.fractionalImage[0] - right.fractionalImage[0]
    || left.fractionalImage[1] - right.fractionalImage[1]
    || left.fractionalImage[2] - right.fractionalImage[2]
  ))
  return { images, candidateEvaluations }
}

/**
 * Exact over the nearest 3x3x3 image neighborhood.  This is safer than
 * component-wise fractional wrapping for skewed cells and is sufficient for
 * reduced atomistic cells; callers report a warning for pathological cells.
 */
export function periodicDistance(a: readonly number[], b: readonly number[], lattice?: ZatomLattice): number {
  return createDistanceCalculator(lattice)(a, b)
}

export function boundsOfPositions(positions: readonly Vec3[]): { min: Vec3; max: Vec3; center: Vec3; radius: number } | null {
  if (!positions.length) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k]
      if (p[k] > max[k]) max[k] = p[k]
    }
  }
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  let radius = 0
  for (const p of positions) radius = Math.max(radius, distance(p, center))
  return { min, max, center, radius }
}

export function scaleLattice(lattice: ZatomLattice, scaling: readonly number[]): ZatomLattice {
  return {
    vectors: [
      lattice.vectors[0].map((v) => v * scaling[0]) as Vec3,
      lattice.vectors[1].map((v) => v * scaling[1]) as Vec3,
      lattice.vectors[2].map((v) => v * scaling[2]) as Vec3,
    ],
    periodic: [...lattice.periodic] as [boolean, boolean, boolean],
  }
}

function feedCanonicalJson(feed: (text: string) => void, value: unknown): void {
  if (value === null) {
    feed('null;')
    return
  }
  if (typeof value === 'string') {
    feed(`s${value.length}:${value};`)
    return
  }
  if (typeof value === 'number') {
    feed(`n:${Object.is(value, -0) ? '0' : value.toString()};`)
    return
  }
  if (typeof value === 'boolean') {
    feed(value ? 'true;' : 'false;')
    return
  }
  if (Array.isArray(value)) {
    feed(`a${value.length}[`)
    for (const item of value) feedCanonicalJson(feed, item)
    feed('];')
    return
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (
      compareCanonicalText(left, right)
    ))
    feed(`o${entries.length}{`)
    for (const [key, item] of entries) {
      feedCanonicalJson(feed, key)
      feedCanonicalJson(feed, item)
    }
    feed('};')
    return
  }
  // Canonical structures are JSON-safe, so reaching this marker exposes an
  // invalid in-memory artifact instead of silently colliding with valid data.
  feed(`invalid:${typeof value};`)
}

/** Locale-independent UTF-16 code-unit ordering for canonical identities. */
export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Key-order-independent identity text for a JSON-safe value. */
export function canonicalJsonIdentity(value: unknown): string {
  let result = ''
  feedCanonicalJson((text) => { result += text }, value)
  return result
}

/** Incremental standard FNV-1a 64-bit hash over UTF-8 without BigInt overhead. */
export function createFnv1a64Hasher(): { feed(text: string): void; digest(): string } {
  let high = 0xcbf29ce4
  let low = 0x84222325
  const encoder = new TextEncoder()
  return {
    feed: (text) => {
      for (const byte of encoder.encode(text)) {
        low = (low ^ byte) >>> 0
        const lowProduct = low * 0x1b3
        const carry = Math.floor(lowProduct / 0x1_0000_0000)
        high = (high * 0x1b3 + carry + low * 0x100) >>> 0
        low = lowProduct >>> 0
      }
    },
    digest: () => `fnv1a64:${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`,
  }
}

/** Stable UTF-8 FNV-1a identity for a canonical JSON-safe value. */
export function fingerprintCanonicalJson(value: unknown): string {
  const hasher = createFnv1a64Hasher()
  hasher.feed(canonicalJsonIdentity(value))
  return hasher.digest()
}

/** Stable, non-cryptographic artifact fingerprint used for replay/provenance. */
export function fingerprintStructure(structure: ZatomStructure): string {
  const hasher = createFnv1a64Hasher()
  const feed = hasher.feed
  feedCanonicalJson(feed, structure.schemaVersion)
  feed(structure.lattice ? 'lattice:1|' : 'lattice:0|')
  if (structure.lattice) {
    for (const row of structure.lattice.vectors) for (const v of row) feed(`${Math.round(v * 1e8)};`)
    feed(structure.lattice.periodic.map((v) => (v ? '1' : '0')).join(''))
  }
  feed(`atoms:${structure.atoms.length}|`)
  for (const atom of structure.atoms) {
    feedCanonicalJson(feed, atom.id)
    feedCanonicalJson(feed, atom.element)
    for (const v of atom.position) feed(`${Math.round(v * 1e8)};`)
    feed(atom.properties ? 'properties:1|' : 'properties:0|')
    if (atom.properties) feedCanonicalJson(feed, atom.properties)
  }
  feed(structure.bonds ? `bonds:${structure.bonds.length}|` : 'bonds:unknown|')
  for (const bond of structure.bonds ?? []) {
    feedCanonicalJson(feed, bond.id)
    feedCanonicalJson(feed, bond.atomIds[0])
    feedCanonicalJson(feed, bond.atomIds[1])
    feed(`${bond.order};`)
    feed(bond.properties ? 'properties:1|' : 'properties:0|')
    if (bond.properties) feedCanonicalJson(feed, bond.properties)
  }
  // `metadata.viewer` is ephemeral selection/render state created on readback,
  // not model identity. Every other JSON-safe metadata field is replay state.
  if (structure.metadata) {
    const persistentMetadata = Object.fromEntries(
      Object.entries(structure.metadata).filter(([key]) => key !== 'viewer'),
    )
    feed(Object.keys(persistentMetadata).length ? 'metadata:1|' : 'metadata:0|')
    if (Object.keys(persistentMetadata).length) feedCanonicalJson(feed, persistentMetadata)
  } else {
    feed('metadata:0|')
  }
  return hasher.digest()
}
