// Lattice calculation utilities
import type { CrystalSystem, LatticeParameters, LatticeVectors } from './types'

// Convert degrees to radians
function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Wrap fractional coordinates to the interval [0, 1). Handles negative numbers (e.g. -0.3 → 0.7) and values greater than 1
 * (e.g. 1.7 → 0.7). Equivalent to `((x % 1) + 1) % 1`, formerly scattered in cif-parser/
 * Assembly-panel / extensions-panel are inlined in many places and unified here.
 */
export function wrapFractional(x: number): number {
  return ((x % 1) + 1) % 1
}

// Get default lattice parameters for each crystal system
export function getDefaultLatticeParams(system: CrystalSystem): LatticeParameters {
  switch (system) {
    case 'cubic':
      return { a: 4.0, b: 4.0, c: 4.0, alpha: 90, beta: 90, gamma: 90 }
    case 'tetragonal':
      return { a: 4.0, b: 4.0, c: 6.0, alpha: 90, beta: 90, gamma: 90 }
    case 'orthorhombic':
      return { a: 4.0, b: 5.0, c: 6.0, alpha: 90, beta: 90, gamma: 90 }
    case 'hexagonal':
      return { a: 4.0, b: 4.0, c: 6.0, alpha: 90, beta: 90, gamma: 120 }
    case 'trigonal':
      return { a: 4.0, b: 4.0, c: 4.0, alpha: 80, beta: 80, gamma: 80 }
    case 'monoclinic':
      return { a: 4.0, b: 5.0, c: 6.0, alpha: 90, beta: 100, gamma: 90 }
    case 'triclinic':
      return { a: 4.0, b: 5.0, c: 6.0, alpha: 80, beta: 85, gamma: 95 }
    case 'custom':
    default:
      return { a: 4.0, b: 4.0, c: 4.0, alpha: 90, beta: 90, gamma: 90 }
  }
}

// Apply crystal system constraints to lattice parameters
export function applySystemConstraints(
  params: LatticeParameters,
  system: CrystalSystem
): LatticeParameters {
  switch (system) {
    case 'cubic':
      return { a: params.a, b: params.a, c: params.a, alpha: 90, beta: 90, gamma: 90 }
    case 'tetragonal':
      return { a: params.a, b: params.a, c: params.c, alpha: 90, beta: 90, gamma: 90 }
    case 'orthorhombic':
      return { ...params, alpha: 90, beta: 90, gamma: 90 }
    case 'hexagonal':
      return { a: params.a, b: params.a, c: params.c, alpha: 90, beta: 90, gamma: 120 }
    case 'trigonal':
      return { a: params.a, b: params.a, c: params.a, alpha: params.alpha, beta: params.alpha, gamma: params.alpha }
    case 'monoclinic':
      return { ...params, alpha: 90, gamma: 90 }
    case 'triclinic':
    case 'custom':
    default:
      return params
  }
}

/** A unit cell must have finite positive edges and a non-zero 3D volume. */
export function isValidLatticeParameters(params: LatticeParameters): boolean {
  const { a, b, c, alpha, beta, gamma } = params
  if (![a, b, c, alpha, beta, gamma].every(Number.isFinite)) return false
  if (a <= 0 || b <= 0 || c <= 0) return false
  if (alpha <= 0 || alpha >= 180 || beta <= 0 || beta >= 180 || gamma <= 0 || gamma >= 180) return false
  return calculateVolume(calculateLatticeVectors(params)) > 1e-9
}

/**
 * Inverse of `calculateLatticeVectors`: recover a/b/c and the angles from the
 * three cell vectors.
 *
 * Needed wherever a stored structure carries its cell as a matrix but a
 * consumer speaks in parameters (CIF being the main one). Returns `null` for a
 * degenerate cell rather than NaN-laden parameters, so callers must decide what
 * a missing cell means instead of silently propagating an unusable one.
 */
export function latticeParamsFromMatrix(
  matrix: readonly (readonly number[])[],
): LatticeParameters | null {
  if (matrix.length !== 3) return null
  const rows = matrix.map((row) =>
    row.length === 3 && row.every((value) => Number.isFinite(value))
      ? [row[0], row[1], row[2]]
      : null,
  )
  if (rows.some((row) => row === null)) return null
  const [va, vb, vc] = rows as number[][]

  const length = (v: number[]) => Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const angle = (u: number[], v: number[]) => {
    const denominator = length(u) * length(v)
    if (denominator === 0) return 90
    // Clamp guards acos against floating-point overshoot past ±1.
    return (Math.acos(Math.max(-1, Math.min(1, dot(u, v) / denominator))) * 180) / Math.PI
  }

  const params: LatticeParameters = {
    a: length(va),
    b: length(vb),
    c: length(vc),
    alpha: angle(vb, vc),
    beta: angle(va, vc),
    gamma: angle(va, vb),
  }
  return isValidLatticeParameters(params) ? params : null
}

// Calculate lattice vectors from parameters
export function calculateLatticeVectors(params: LatticeParameters): LatticeVectors {
  const { a, b, c, alpha, beta, gamma } = params
  
  const alphaRad = toRadians(alpha)
  const betaRad = toRadians(beta)
  const gammaRad = toRadians(gamma)

  // Vector a along x-axis
  const ax = a
  const ay = 0
  const az = 0

  // Vector b in xy-plane
  const bx = b * Math.cos(gammaRad)
  const by = b * Math.sin(gammaRad)
  const bz = 0

  // Vector c
  const cx = c * Math.cos(betaRad)
  const cy = c * (Math.cos(alphaRad) - Math.cos(betaRad) * Math.cos(gammaRad)) / Math.sin(gammaRad)
  const cz = Math.sqrt(c * c - cx * cx - cy * cy)

  return {
    a: [ax, ay, az],
    b: [bx, by, bz],
    c: [cx, cy, isNaN(cz) ? 0 : cz],
  }
}

// Convert fractional coordinates to Cartesian
export function fractionalToCartesian(
  fractional: [number, number, number],
  latticeVectors: LatticeVectors
): [number, number, number] {
  const [fx, fy, fz] = fractional
  const { a, b, c } = latticeVectors

  const x = fx * a[0] + fy * b[0] + fz * c[0]
  const y = fx * a[1] + fy * b[1] + fz * c[1]
  const z = fx * a[2] + fy * b[2] + fz * c[2]

  return [x, y, z]
}

// Convert Cartesian coordinates to fractional
export function cartesianToFractional(
  cartesian: [number, number, number],
  latticeVectors: LatticeVectors
): [number, number, number] {
  const { a, b, c } = latticeVectors
  const [x, y, z] = cartesian

  // Build the transformation matrix (inverse of lattice vectors)
  const det = 
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])

  if (Math.abs(det) < 1e-10) {
    return [0, 0, 0]
  }

  const invDet = 1 / det

  const fx = invDet * (
    x * (b[1] * c[2] - b[2] * c[1]) +
    y * (b[2] * c[0] - b[0] * c[2]) +
    z * (b[0] * c[1] - b[1] * c[0])
  )

  const fy = invDet * (
    x * (a[2] * c[1] - a[1] * c[2]) +
    y * (a[0] * c[2] - a[2] * c[0]) +
    z * (a[1] * c[0] - a[0] * c[1])
  )

  const fz = invDet * (
    x * (a[1] * b[2] - a[2] * b[1]) +
    y * (a[2] * b[0] - a[0] * b[2]) +
    z * (a[0] * b[1] - a[1] * b[0])
  )

  return [fx, fy, fz]
}

/**
 * Wrap Cartesian coordinates back to the unit cell [0,1) fractional range (periodic mirror equivalent).
 *
 * Strict PBC for "Show whole molecules" **off**: drag atoms across the periodic boundary and turn back from the opposite side,
 * The coordinates always remain inside the cell - instead of being dragged out of the cell and then delayed by an algorithm to change the position, causing "jumping". Does not wrap when turned on,
 * Allows the entire molecule to be dragged out of the cell for continuous observation.
 *
 * Degenerate lattice (volume ≈ 0) is returned as is (cartesianToFractional will return [0,0,0] for singular matrices,
 * If not guarded, the atoms will collapse to the original point). The triclinic lattice is also correct (reusing the universal conversion of cartesian↔fractional).
 */
export function wrapCartesianIntoCell(
  cartesian: [number, number, number],
  latticeVectors: LatticeVectors
): [number, number, number] {
  if (calculateVolume(latticeVectors) < 1e-9) return cartesian
  const [fx, fy, fz] = cartesianToFractional(cartesian, latticeVectors)
  return fractionalToCartesian(
    [wrapFractional(fx), wrapFractional(fy), wrapFractional(fz)],
    latticeVectors,
  )
}

/**
 * Clamp fractional coordinates to the displayed cell as a soft drag boundary.
 * Unlike wrapping, this stops at a face instead of jumping to the opposite side.
 * Callers must supply displayed-supercell vectors; degenerate cells pass through.
 */
export function clampCartesianToCell(
  cartesian: [number, number, number],
  latticeVectors: LatticeVectors
): [number, number, number] {
  if (calculateVolume(latticeVectors) < 1e-9) return cartesian
  const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  const [fx, fy, fz] = cartesianToFractional(cartesian, latticeVectors)
  return fractionalToCartesian([clamp01(fx), clamp01(fy), clamp01(fz)], latticeVectors)
}

// Calculate lattice volume
export function calculateVolume(latticeVectors: LatticeVectors): number {
  const { a, b, c } = latticeVectors
  
  // Volume = a · (b × c)
  const crossX = b[1] * c[2] - b[2] * c[1]
  const crossY = b[2] * c[0] - b[0] * c[2]
  const crossZ = b[0] * c[1] - b[1] * c[0]
  
  return Math.abs(a[0] * crossX + a[1] * crossY + a[2] * crossZ)
}

// Generate lattice grid lines for visualization
export function generateLatticeGridLines(
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number }
): Array<{ start: [number, number, number]; end: [number, number, number] }> {
  const lines: Array<{ start: [number, number, number]; end: [number, number, number] }> = []
  const { a, b, c } = latticeVectors
  const { nx, ny, nz } = supercell

  // Generate lines along a direction
  for (let j = 0; j <= ny; j++) {
    for (let k = 0; k <= nz; k++) {
      const start: [number, number, number] = [
        j * b[0] + k * c[0],
        j * b[1] + k * c[1],
        j * b[2] + k * c[2],
      ]
      const end: [number, number, number] = [
        nx * a[0] + j * b[0] + k * c[0],
        nx * a[1] + j * b[1] + k * c[1],
        nx * a[2] + j * b[2] + k * c[2],
      ]
      lines.push({ start, end })
    }
  }

  // Generate lines along b direction
  for (let i = 0; i <= nx; i++) {
    for (let k = 0; k <= nz; k++) {
      const start: [number, number, number] = [
        i * a[0] + k * c[0],
        i * a[1] + k * c[1],
        i * a[2] + k * c[2],
      ]
      const end: [number, number, number] = [
        i * a[0] + ny * b[0] + k * c[0],
        i * a[1] + ny * b[1] + k * c[1],
        i * a[2] + ny * b[2] + k * c[2],
      ]
      lines.push({ start, end })
    }
  }

  // Generate lines along c direction
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const start: [number, number, number] = [
        i * a[0] + j * b[0],
        i * a[1] + j * b[1],
        i * a[2] + j * b[2],
      ]
      const end: [number, number, number] = [
        i * a[0] + j * b[0] + nz * c[0],
        i * a[1] + j * b[1] + nz * c[1],
        i * a[2] + j * b[2] + nz * c[2],
      ]
      lines.push({ start, end })
    }
  }

  return lines
}

// Calculate the center of the supercell
export function calculateSupercellCenter(
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number }
): [number, number, number] {
  const { a, b, c } = latticeVectors
  const { nx, ny, nz } = supercell

  return [
    (nx * a[0] + ny * b[0] + nz * c[0]) / 2,
    (nx * a[1] + ny * b[1] + nz * c[1]) / 2,
    (nx * a[2] + ny * b[2] + nz * c[2]) / 2,
  ]
}

// Generate lattice edges with IDs for selection
export function generateLatticeEdges(
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number }
): Array<{
  id: string
  start: [number, number, number]
  end: [number, number, number]
  cellIndex: [number, number, number]
  direction: 'a' | 'b' | 'c'
}> {
  const edges: Array<{
    id: string
    start: [number, number, number]
    end: [number, number, number]
    cellIndex: [number, number, number]
    direction: 'a' | 'b' | 'c'
  }> = []
  
  const { a, b, c } = latticeVectors
  const { nx, ny, nz } = supercell

  // Generate edges along a direction
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k <= nz; k++) {
        const start: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        const end: [number, number, number] = [
          (i + 1) * a[0] + j * b[0] + k * c[0],
          (i + 1) * a[1] + j * b[1] + k * c[1],
          (i + 1) * a[2] + j * b[2] + k * c[2],
        ]
        edges.push({
          id: `edge-a-${i}-${j}-${k}`,
          start,
          end,
          cellIndex: [i, j, k],
          direction: 'a'
        })
      }
    }
  }

  // Generate edges along b direction
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k <= nz; k++) {
        const start: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        const end: [number, number, number] = [
          i * a[0] + (j + 1) * b[0] + k * c[0],
          i * a[1] + (j + 1) * b[1] + k * c[1],
          i * a[2] + (j + 1) * b[2] + k * c[2],
        ]
        edges.push({
          id: `edge-b-${i}-${j}-${k}`,
          start,
          end,
          cellIndex: [i, j, k],
          direction: 'b'
        })
      }
    }
  }

  // Generate edges along c direction
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k < nz; k++) {
        const start: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        const end: [number, number, number] = [
          i * a[0] + j * b[0] + (k + 1) * c[0],
          i * a[1] + j * b[1] + (k + 1) * c[1],
          i * a[2] + j * b[2] + (k + 1) * c[2],
        ]
        edges.push({
          id: `edge-c-${i}-${j}-${k}`,
          start,
          end,
          cellIndex: [i, j, k],
          direction: 'c'
        })
      }
    }
  }

  return edges
}

// Generate lattice faces with IDs for selection
export function generateLatticeFaces(
  latticeVectors: LatticeVectors,
  supercell: { nx: number; ny: number; nz: number }
): Array<{
  id: string
  vertices: [number, number, number][]
  cellIndex: [number, number, number]
  normal: [number, number, number]
  plane: 'ab' | 'bc' | 'ac'
}> {
  const faces: Array<{
    id: string
    vertices: [number, number, number][]
    cellIndex: [number, number, number]
    normal: [number, number, number]
    plane: 'ab' | 'bc' | 'ac'
  }> = []
  
  const { a, b, c } = latticeVectors
  const { nx, ny, nz } = supercell

  // Calculate normal vectors for each plane
  const normalAB: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const normalBC: [number, number, number] = [
    b[1] * c[2] - b[2] * c[1],
    b[2] * c[0] - b[0] * c[2],
    b[0] * c[1] - b[1] * c[0],
  ]
  const normalAC: [number, number, number] = [
    a[1] * c[2] - a[2] * c[1],
    a[2] * c[0] - a[0] * c[2],
    a[0] * c[1] - a[1] * c[0],
  ]

  // AB faces (parallel to ab plane, at different c levels)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k <= nz; k++) {
        const base: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        faces.push({
          id: `face-ab-${i}-${j}-${k}`,
          vertices: [
            base,
            [base[0] + a[0], base[1] + a[1], base[2] + a[2]],
            [base[0] + a[0] + b[0], base[1] + a[1] + b[1], base[2] + a[2] + b[2]],
            [base[0] + b[0], base[1] + b[1], base[2] + b[2]],
          ],
          cellIndex: [i, j, k],
          normal: normalAB,
          plane: 'ab'
        })
      }
    }
  }

  // BC faces (parallel to bc plane, at different a levels)
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const base: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        faces.push({
          id: `face-bc-${i}-${j}-${k}`,
          vertices: [
            base,
            [base[0] + b[0], base[1] + b[1], base[2] + b[2]],
            [base[0] + b[0] + c[0], base[1] + b[1] + c[1], base[2] + b[2] + c[2]],
            [base[0] + c[0], base[1] + c[1], base[2] + c[2]],
          ],
          cellIndex: [i, j, k],
          normal: normalBC,
          plane: 'bc'
        })
      }
    }
  }

  // AC faces (parallel to ac plane, at different b levels)
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j <= ny; j++) {
      for (let k = 0; k < nz; k++) {
        const base: [number, number, number] = [
          i * a[0] + j * b[0] + k * c[0],
          i * a[1] + j * b[1] + k * c[1],
          i * a[2] + j * b[2] + k * c[2],
        ]
        faces.push({
          id: `face-ac-${i}-${j}-${k}`,
          vertices: [
            base,
            [base[0] + a[0], base[1] + a[1], base[2] + a[2]],
            [base[0] + a[0] + c[0], base[1] + a[1] + c[1], base[2] + a[2] + c[2]],
            [base[0] + c[0], base[1] + c[1], base[2] + c[2]],
          ],
          cellIndex: [i, j, k],
          normal: normalAC,
          plane: 'ac'
        })
      }
    }
  }

  return faces
}
