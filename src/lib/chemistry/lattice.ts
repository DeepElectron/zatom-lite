// Crystal Lattice System
// Supports 7 crystal systems and 14 Bravais lattices

import type { Vector3 } from './types'

export type CrystalSystem =
  | 'cubic'
  | 'tetragonal'
  | 'orthorhombic'
  | 'hexagonal'
  | 'trigonal'
  | 'monoclinic'
  | 'triclinic'

export type BravaisLattice =
  | 'simple-cubic'
  | 'body-centered-cubic'
  | 'face-centered-cubic'
  | 'simple-tetragonal'
  | 'body-centered-tetragonal'
  | 'simple-orthorhombic'
  | 'body-centered-orthorhombic'
  | 'face-centered-orthorhombic'
  | 'base-centered-orthorhombic'
  | 'hexagonal'
  | 'trigonal'
  | 'simple-monoclinic'
  | 'base-centered-monoclinic'
  | 'triclinic'

export interface LatticeParameters {
  a: number // Lattice constant a (Angstroms)
  b: number // Lattice constant b
  c: number // Lattice constant c
  alpha: number // Angle alpha (degrees)
  beta: number // Angle beta
  gamma: number // Angle gamma
}

export interface CrystalSystemInfo {
  name: string
  constraints: string
  defaultParams: LatticeParameters
}

// Crystal system definitions with constraints
export const CRYSTAL_SYSTEMS: Record<CrystalSystem, CrystalSystemInfo> = {
  cubic: {
    name: 'Cubic',
    constraints: 'a = b = c, α = β = γ = 90°',
    defaultParams: { a: 3.5, b: 3.5, c: 3.5, alpha: 90, beta: 90, gamma: 90 },
  },
  tetragonal: {
    name: 'Tetragonal',
    constraints: 'a = b ≠ c, α = β = γ = 90°',
    defaultParams: { a: 3.5, b: 3.5, c: 5.0, alpha: 90, beta: 90, gamma: 90 },
  },
  orthorhombic: {
    name: 'Orthorhombic',
    constraints: 'a ≠ b ≠ c, α = β = γ = 90°',
    defaultParams: { a: 3.0, b: 4.0, c: 5.0, alpha: 90, beta: 90, gamma: 90 },
  },
  hexagonal: {
    name: 'Hexagonal',
    constraints: 'a = b ≠ c, α = β = 90°, γ = 120°',
    defaultParams: { a: 3.5, b: 3.5, c: 5.7, alpha: 90, beta: 90, gamma: 120 },
  },
  trigonal: {
    name: 'Trigonal',
    constraints: 'a = b = c, α = β = γ ≠ 90°',
    defaultParams: { a: 4.0, b: 4.0, c: 4.0, alpha: 80, beta: 80, gamma: 80 },
  },
  monoclinic: {
    name: 'Monoclinic',
    constraints: 'a ≠ b ≠ c, α = γ = 90° ≠ β',
    defaultParams: { a: 3.0, b: 4.0, c: 5.0, alpha: 90, beta: 100, gamma: 90 },
  },
  triclinic: {
    name: 'Triclinic',
    constraints: 'a ≠ b ≠ c, α ≠ β ≠ γ ≠ 90°',
    defaultParams: { a: 3.0, b: 4.0, c: 5.0, alpha: 80, beta: 85, gamma: 95 },
  },
}

// Bravais lattice definitions
export const BRAVAIS_LATTICES: Record<
  BravaisLattice,
  { name: string; system: CrystalSystem; basisPositions: Vector3[] }
> = {
  'simple-cubic': {
    name: 'Simple Cubic (P)',
    system: 'cubic',
    basisPositions: [[0, 0, 0]],
  },
  'body-centered-cubic': {
    name: 'Body-Centered Cubic (I)',
    system: 'cubic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
  },
  'face-centered-cubic': {
    name: 'Face-Centered Cubic (F)',
    system: 'cubic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ],
  },
  'simple-tetragonal': {
    name: 'Simple Tetragonal (P)',
    system: 'tetragonal',
    basisPositions: [[0, 0, 0]],
  },
  'body-centered-tetragonal': {
    name: 'Body-Centered Tetragonal (I)',
    system: 'tetragonal',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
  },
  'simple-orthorhombic': {
    name: 'Simple Orthorhombic (P)',
    system: 'orthorhombic',
    basisPositions: [[0, 0, 0]],
  },
  'body-centered-orthorhombic': {
    name: 'Body-Centered Orthorhombic (I)',
    system: 'orthorhombic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0.5],
    ],
  },
  'face-centered-orthorhombic': {
    name: 'Face-Centered Orthorhombic (F)',
    system: 'orthorhombic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0],
      [0.5, 0, 0.5],
      [0, 0.5, 0.5],
    ],
  },
  'base-centered-orthorhombic': {
    name: 'Base-Centered Orthorhombic (C)',
    system: 'orthorhombic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0],
    ],
  },
  hexagonal: {
    name: 'Hexagonal (P)',
    system: 'hexagonal',
    basisPositions: [[0, 0, 0]],
  },
  trigonal: {
    name: 'Trigonal (R)',
    system: 'trigonal',
    basisPositions: [[0, 0, 0]],
  },
  'simple-monoclinic': {
    name: 'Simple Monoclinic (P)',
    system: 'monoclinic',
    basisPositions: [[0, 0, 0]],
  },
  'base-centered-monoclinic': {
    name: 'Base-Centered Monoclinic (C)',
    system: 'monoclinic',
    basisPositions: [
      [0, 0, 0],
      [0.5, 0.5, 0],
    ],
  },
  triclinic: {
    name: 'Triclinic (P)',
    system: 'triclinic',
    basisPositions: [[0, 0, 0]],
  },
}

// Convert fractional coordinates to Cartesian coordinates
export function fractionalToCartesian(
  fractional: Vector3,
  params: LatticeParameters
): Vector3 {
  const { a, b, c, alpha, beta, gamma } = params
  const alphaRad = (alpha * Math.PI) / 180
  const betaRad = (beta * Math.PI) / 180
  const gammaRad = (gamma * Math.PI) / 180

  // Transformation matrix components
  const cosAlpha = Math.cos(alphaRad)
  const cosBeta = Math.cos(betaRad)
  const cosGamma = Math.cos(gammaRad)
  const sinGamma = Math.sin(gammaRad)

  const v = Math.sqrt(
    1 -
      cosAlpha * cosAlpha -
      cosBeta * cosBeta -
      cosGamma * cosGamma +
      2 * cosAlpha * cosBeta * cosGamma
  )

  const [u, v2, w] = fractional

  const x = a * u + b * cosGamma * v2 + c * cosBeta * w
  const y = b * sinGamma * v2 + (c * (cosAlpha - cosBeta * cosGamma)) / sinGamma * w
  const z = (c * v) / sinGamma * w

  return [x, y, z]
}

// Calculate lattice vectors from parameters
export function getLatticeVectors(params: LatticeParameters): [Vector3, Vector3, Vector3] {
  const aVec = fractionalToCartesian([1, 0, 0], params)
  const bVec = fractionalToCartesian([0, 1, 0], params)
  const cVec = fractionalToCartesian([0, 0, 1], params)
  return [aVec, bVec, cVec]
}

// Generate supercell positions
export function generateSupercell(
  basisPositions: Vector3[],
  params: LatticeParameters,
  nx: number,
  ny: number,
  nz: number
): Vector3[] {
  const positions: Vector3[] = []

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        for (const basis of basisPositions) {
          const fractional: Vector3 = [basis[0] + i, basis[1] + j, basis[2] + k]
          const cartesian = fractionalToCartesian(fractional, params)
          positions.push(cartesian)
        }
      }
    }
  }

  return positions
}

// Apply lattice constraints based on crystal system
export function applySystemConstraints(
  system: CrystalSystem,
  params: LatticeParameters
): LatticeParameters {
  const { a, b, c, alpha, beta, gamma } = params

  switch (system) {
    case 'cubic':
      return { a, b: a, c: a, alpha: 90, beta: 90, gamma: 90 }
    case 'tetragonal':
      return { a, b: a, c, alpha: 90, beta: 90, gamma: 90 }
    case 'orthorhombic':
      return { a, b, c, alpha: 90, beta: 90, gamma: 90 }
    case 'hexagonal':
      return { a, b: a, c, alpha: 90, beta: 90, gamma: 120 }
    case 'trigonal':
      return { a, b: a, c: a, alpha, beta: alpha, gamma: alpha }
    case 'monoclinic':
      return { a, b, c, alpha: 90, beta, gamma: 90 }
    case 'triclinic':
      return { a, b, c, alpha, beta, gamma }
    default:
      return params
  }
}
