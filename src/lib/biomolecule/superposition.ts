import type {
  BioAtom,
  BioFrame,
  BioResidueIdentity,
  BioStructure,
  BioVector3,
} from "./types"

export type BioRotationMatrix = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
]

export interface BioRigidTransform {
  /** Row-major, proper rotation matrix mapping moving coordinates to reference coordinates. */
  rotation: BioRotationMatrix
  translation: BioVector3
}

export interface BioSuperpositionPair {
  identity: BioResidueIdentity
  referenceResidueIndex: number
  movingResidueIndex: number
  referenceAtomIndex: number
  movingAtomIndex: number
}

export interface BioSuperpositionResult {
  /** This is an identity-based pairing count, not a sequence-alignment score. */
  pairCount: number
  rmsd: number
  transform: BioRigidTransform
  pairs: readonly BioSuperpositionPair[]
  /** A transformed copy. Neither input structure is mutated. */
  transformedStructure: BioStructure
}

export class BioSuperpositionError extends Error {
  readonly code: "INSUFFICIENT_PAIRS" | "DEGENERATE_POINTS"

  constructor(
    code: "INSUFFICIENT_PAIRS" | "DEGENERATE_POINTS",
    message: string,
  ) {
    super(message)
    this.name = "BioSuperpositionError"
    this.code = code
  }
}

const DEGENERACY_TOLERANCE = 1e-10

function identityKey(identity: BioResidueIdentity): string {
  return `${identity.chainId}\u0000${identity.sequenceNumber}\u0000${identity.insertionCode}`
}

/**
 * Pair representative atoms by exact PDB residue identity. This deliberately
 * does not perform sequence alignment, chain remapping, or gap handling.
 */
export function pairBioRepresentativeAtoms(
  reference: BioStructure,
  moving: BioStructure,
): BioSuperpositionPair[] {
  const movingByIdentity = new Map(
    moving.residues.map((residue) => [identityKey(residue.identity), residue] as const),
  )
  const pairs: BioSuperpositionPair[] = []

  for (const referenceResidue of reference.residues) {
    if (!referenceResidue.isStandard || referenceResidue.representativeAtomIndex === null) continue
    const movingResidue = movingByIdentity.get(identityKey(referenceResidue.identity))
    if (!movingResidue?.isStandard || movingResidue.representativeAtomIndex === null) continue
    pairs.push({
      identity: { ...referenceResidue.identity },
      referenceResidueIndex: referenceResidue.index,
      movingResidueIndex: movingResidue.index,
      referenceAtomIndex: referenceResidue.representativeAtomIndex,
      movingAtomIndex: movingResidue.representativeAtomIndex,
    })
  }

  return pairs
}

function centroid(points: readonly BioVector3[]): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0]
  for (const point of points) {
    result[0] += point[0]
    result[1] += point[1]
    result[2] += point[2]
  }
  result[0] /= points.length
  result[1] /= points.length
  result[2] /= points.length
  return result
}

function centered(points: readonly BioVector3[], center: BioVector3): [number, number, number][] {
  return points.map((point) => [
    point[0] - center[0],
    point[1] - center[1],
    point[2] - center[2],
  ])
}

/** Eigenvalues of a real symmetric matrix, computed by cyclic Jacobi rotations. */
function symmetricEigenvalues(input: readonly (readonly number[])[]): number[] {
  const matrix = input.map((row) => [...row])
  const size = matrix.length
  for (let sweep = 0; sweep < 48; sweep += 1) {
    let changed = false
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const offDiagonal = matrix[p][q]
        const scale = Math.abs(matrix[p][p]) + Math.abs(matrix[q][q]) + 1
        if (Math.abs(offDiagonal) <= Number.EPSILON * scale) continue
        changed = true
        const angle = 0.5 * Math.atan2(2 * offDiagonal, matrix[q][q] - matrix[p][p])
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)

        for (let index = 0; index < size; index += 1) {
          if (index === p || index === q) continue
          const ip = matrix[index][p]
          const iq = matrix[index][q]
          matrix[index][p] = matrix[p][index] = cosine * ip - sine * iq
          matrix[index][q] = matrix[q][index] = sine * ip + cosine * iq
        }
        const pp = matrix[p][p]
        const qq = matrix[q][q]
        matrix[p][p] = cosine * cosine * pp - 2 * sine * cosine * offDiagonal + sine * sine * qq
        matrix[q][q] = sine * sine * pp + 2 * sine * cosine * offDiagonal + cosine * cosine * qq
        matrix[p][q] = matrix[q][p] = 0
      }
    }
    if (!changed) break
  }
  return matrix.map((row, index) => row[index])
}

function assertNonCollinear(points: readonly BioVector3[], label: string): void {
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (const [x, y, z] of points) {
    covariance[0][0] += x * x
    covariance[0][1] += x * y
    covariance[0][2] += x * z
    covariance[1][1] += y * y
    covariance[1][2] += y * z
    covariance[2][2] += z * z
  }
  covariance[1][0] = covariance[0][1]
  covariance[2][0] = covariance[0][2]
  covariance[2][1] = covariance[1][2]
  const eigenvalues = symmetricEigenvalues(covariance).map(Math.abs).sort((left, right) => right - left)
  if (eigenvalues[0] === 0 || eigenvalues[1] <= eigenvalues[0] * DEGENERACY_TOLERANCE) {
    throw new BioSuperpositionError(
      "DEGENERATE_POINTS",
      `Cannot superpose ${label}: representative atoms are collinear or coincident`,
    )
  }
}

/** Largest-eigenvalue eigenvector of a small real symmetric matrix. */
function largestSymmetricEigenvector(input: readonly (readonly number[])[]): number[] {
  const matrix = input.map((row) => [...row])
  const size = matrix.length
  const vectors: number[][] = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (__, column) => (row === column ? 1 : 0)),
  )
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let changed = false
    for (let p = 0; p < size - 1; p += 1) {
      for (let q = p + 1; q < size; q += 1) {
        const offDiagonal = matrix[p][q]
        const scale = Math.abs(matrix[p][p]) + Math.abs(matrix[q][q]) + 1
        if (Math.abs(offDiagonal) <= Number.EPSILON * scale) continue
        changed = true
        const angle = 0.5 * Math.atan2(2 * offDiagonal, matrix[q][q] - matrix[p][p])
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)
        for (let index = 0; index < size; index += 1) {
          if (index === p || index === q) continue
          const ip = matrix[index][p]
          const iq = matrix[index][q]
          matrix[index][p] = matrix[p][index] = cosine * ip - sine * iq
          matrix[index][q] = matrix[q][index] = sine * ip + cosine * iq
        }
        const pp = matrix[p][p]
        const qq = matrix[q][q]
        matrix[p][p] = cosine * cosine * pp - 2 * sine * cosine * offDiagonal + sine * sine * qq
        matrix[q][q] = sine * sine * pp + 2 * sine * cosine * offDiagonal + cosine * cosine * qq
        matrix[p][q] = matrix[q][p] = 0
        for (let row = 0; row < size; row += 1) {
          const vp = vectors[row][p]
          const vq = vectors[row][q]
          vectors[row][p] = cosine * vp - sine * vq
          vectors[row][q] = sine * vp + cosine * vq
        }
      }
    }
    if (!changed) break
  }
  let largestIndex = 0
  for (let index = 1; index < size; index += 1) {
    if (matrix[index][index] > matrix[largestIndex][largestIndex]) largestIndex = index
  }
  const vector = vectors.map((row) => row[largestIndex])
  const norm = Math.hypot(...vector)
  return vector.map((value) => value / norm)
}

function quaternionRotation([w, x, y, z]: readonly number[]): BioRotationMatrix {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ]
}

function rotate(rotation: BioRotationMatrix, point: BioVector3): [number, number, number] {
  return [
    rotation[0] * point[0] + rotation[1] * point[1] + rotation[2] * point[2],
    rotation[3] * point[0] + rotation[4] * point[1] + rotation[5] * point[2],
    rotation[6] * point[0] + rotation[7] * point[1] + rotation[8] * point[2],
  ]
}

export function applyBioRigidTransformToPoint(
  transform: BioRigidTransform,
  point: BioVector3,
): [number, number, number] {
  const rotated = rotate(transform.rotation, point)
  return [
    rotated[0] + transform.translation[0],
    rotated[1] + transform.translation[1],
    rotated[2] + transform.translation[2],
  ]
}

function solveProperRigidTransform(reference: readonly BioVector3[], moving: readonly BioVector3[]): BioRigidTransform {
  const referenceCentroid = centroid(reference)
  const movingCentroid = centroid(moving)
  const referenceCentered = centered(reference, referenceCentroid)
  const movingCentered = centered(moving, movingCentroid)
  assertNonCollinear(referenceCentered, "reference structure")
  assertNonCollinear(movingCentered, "moving structure")

  let xx = 0
  let xy = 0
  let xz = 0
  let yx = 0
  let yy = 0
  let yz = 0
  let zx = 0
  let zy = 0
  let zz = 0
  for (let index = 0; index < movingCentered.length; index += 1) {
    const movingPoint = movingCentered[index]
    const referencePoint = referenceCentered[index]
    xx += movingPoint[0] * referencePoint[0]
    xy += movingPoint[0] * referencePoint[1]
    xz += movingPoint[0] * referencePoint[2]
    yx += movingPoint[1] * referencePoint[0]
    yy += movingPoint[1] * referencePoint[1]
    yz += movingPoint[1] * referencePoint[2]
    zx += movingPoint[2] * referencePoint[0]
    zy += movingPoint[2] * referencePoint[1]
    zz += movingPoint[2] * referencePoint[2]
  }
  const trace = xx + yy + zz
  const horn = [
    [trace, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]
  const rotation = quaternionRotation(largestSymmetricEigenvector(horn))
  const rotatedMovingCentroid = rotate(rotation, movingCentroid)
  return {
    rotation,
    translation: [
      referenceCentroid[0] - rotatedMovingCentroid[0],
      referenceCentroid[1] - rotatedMovingCentroid[1],
      referenceCentroid[2] - rotatedMovingCentroid[2],
    ],
  }
}

function transformFrame(frame: BioFrame, transform: BioRigidTransform): BioFrame {
  const positions = new Float32Array(frame.positions.length)
  for (let index = 0; index < frame.positions.length; index += 3) {
    const point = applyBioRigidTransformToPoint(transform, [
      frame.positions[index],
      frame.positions[index + 1],
      frame.positions[index + 2],
    ])
    positions[index] = point[0]
    positions[index + 1] = point[1]
    positions[index + 2] = point[2]
  }
  return { ...frame, positions }
}

export function applyBioRigidTransform(structure: BioStructure, transform: BioRigidTransform): BioStructure {
  const atoms: BioAtom[] = structure.atoms.map((atom) => ({
    ...atom,
    position: applyBioRigidTransformToPoint(transform, atom.position),
  }))
  const boundsCenter = centroid(atoms.map((atom) => atom.position))
  const radius = atoms.reduce((maximum, atom) => {
    const dx = atom.position[0] - boundsCenter[0]
    const dy = atom.position[1] - boundsCenter[1]
    const dz = atom.position[2] - boundsCenter[2]
    return Math.max(maximum, Math.hypot(dx, dy, dz))
  }, 0)
  return {
    ...structure,
    atoms,
    residues: structure.residues.map((residue) => ({
      ...residue,
      identity: { ...residue.identity },
      atomIndices: [...residue.atomIndices],
    })),
    chains: structure.chains.map((chain) => ({ ...chain, residueIndices: [...chain.residueIndices] })),
    bonds: structure.bonds.map((bond) => ({ ...bond })),
    frames: structure.frames.map((frame) => transformFrame(frame, transform)),
    ligands: structure.ligands.map((ligand) => ({
      ...ligand,
      atomIndices: [...ligand.atomIndices],
      centroid: applyBioRigidTransformToPoint(transform, ligand.centroid),
    })),
    center: boundsCenter,
    radius,
    warnings: [...structure.warnings],
  }
}

export function superposeBioStructures(reference: BioStructure, moving: BioStructure): BioSuperpositionResult {
  const pairs = pairBioRepresentativeAtoms(reference, moving)
  if (pairs.length < 3) {
    throw new BioSuperpositionError(
      "INSUFFICIENT_PAIRS",
      `At least 3 matching representative atoms are required; found ${pairs.length}`,
    )
  }
  const referencePoints = pairs.map((pair) => reference.atoms[pair.referenceAtomIndex].position)
  const movingPoints = pairs.map((pair) => moving.atoms[pair.movingAtomIndex].position)
  const transform = solveProperRigidTransform(referencePoints, movingPoints)
  let squaredError = 0
  for (let index = 0; index < pairs.length; index += 1) {
    const transformed = applyBioRigidTransformToPoint(transform, movingPoints[index])
    const target = referencePoints[index]
    squaredError +=
      (transformed[0] - target[0]) ** 2 +
      (transformed[1] - target[1]) ** 2 +
      (transformed[2] - target[2]) ** 2
  }
  return {
    pairCount: pairs.length,
    rmsd: Math.sqrt(squaredError / pairs.length),
    transform,
    pairs,
    transformedStructure: applyBioRigidTransform(moving, transform),
  }
}
