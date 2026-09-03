/**
 * Brillouin Zone Construction Library
 * Based on the seekpath algorithm (https://github.com/materialscloud-org/seekpath)
 * 
 * Implements:
 * - Reciprocal lattice vector calculation
 * - First Brillouin zone construction via Voronoi tessellation
 * - High-symmetry k-point identification
 */

import * as THREE from 'three'

// Types for Brillouin zone data
export interface BrillouinZoneData {
  reciprocalLattice: {
    b1: [number, number, number]
    b2: [number, number, number]
    b3: [number, number, number]
  }
  vertices: [number, number, number][]
  faces: number[][]  // Each face is an array of vertex indices
  edges: [number, number][]  // Each edge is a pair of vertex indices
  volume: number
}

export interface KPoint {
  label: string
  coords: [number, number, number]  // In reciprocal lattice coordinates
  cartesian: [number, number, number]  // In Cartesian coordinates (1/Angstrom)
}

export interface KPath {
  points: KPoint[]
  segments: [string, string][]  // Pairs of k-point labels forming the path
}

/**
 * Calculate reciprocal lattice vectors from real-space lattice vectors
 * b_i = 2π * (a_j × a_k) / (a_i · (a_j × a_k))
 */
export function calculateReciprocalLattice(
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number]
): { b1: [number, number, number]; b2: [number, number, number]; b3: [number, number, number] } {
  const va1 = new THREE.Vector3(...a1)
  const va2 = new THREE.Vector3(...a2)
  const va3 = new THREE.Vector3(...a3)
  
  // Volume = a1 · (a2 × a3)
  const cross23 = new THREE.Vector3().crossVectors(va2, va3)
  const volume = va1.dot(cross23)
  
  if (Math.abs(volume) < 1e-10) {
    throw new Error('Lattice vectors are coplanar or zero')
  }
  
  // b1 = 2π * (a2 × a3) / V
  const b1 = cross23.multiplyScalar(2 * Math.PI / volume)
  
  // b2 = 2π * (a3 × a1) / V
  const cross31 = new THREE.Vector3().crossVectors(va3, va1)
  const b2 = cross31.multiplyScalar(2 * Math.PI / volume)
  
  // b3 = 2π * (a1 × a2) / V
  const cross12 = new THREE.Vector3().crossVectors(va1, va2)
  const b3 = cross12.multiplyScalar(2 * Math.PI / volume)
  
  return {
    b1: [b1.x, b1.y, b1.z],
    b2: [b2.x, b2.y, b2.z],
    b3: [b3.x, b3.y, b3.z],
  }
}

/**
 * Convert fractional k-point coordinates to Cartesian coordinates
 */
export function kpointToCartesian(
  kfrac: [number, number, number],
  b1: [number, number, number],
  b2: [number, number, number],
  b3: [number, number, number]
): [number, number, number] {
  return [
    kfrac[0] * b1[0] + kfrac[1] * b2[0] + kfrac[2] * b3[0],
    kfrac[0] * b1[1] + kfrac[1] * b2[1] + kfrac[2] * b3[1],
    kfrac[0] * b1[2] + kfrac[1] * b2[2] + kfrac[2] * b3[2],
  ]
}

export interface BrillouinDisplayTransform {
  origin: [number, number, number]
  scale: number
  reciprocalRadius: number
}

export function conventionalToPrimitiveLattice(
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number],
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R',
): [[number, number, number], [number, number, number], [number, number, number]] {
  const combine = (
    x: number,
    y: number,
    z: number,
  ): [number, number, number] => [
    x * a1[0] + y * a2[0] + z * a3[0],
    x * a1[1] + y * a2[1] + z * a3[1],
    x * a1[2] + y * a2[2] + z * a3[2],
  ]

  switch (centeringType) {
    case 'F':
      return [combine(0, 0.5, 0.5), combine(0.5, 0, 0.5), combine(0.5, 0.5, 0)]
    case 'I':
      return [combine(-0.5, 0.5, 0.5), combine(0.5, -0.5, 0.5), combine(0.5, 0.5, -0.5)]
    case 'C':
      return [combine(0.5, 0.5, 0), combine(-0.5, 0.5, 0), a3]
    case 'A':
      return [a1, combine(0, 0.5, 0.5), combine(0, -0.5, 0.5)]
    default:
      return [a1, a2, a3]
  }
}

/**
 * Fit reciprocal-space geometry into the first real-space cell for display.
 *
 * The transform is deliberately uniform: using the real-space lattice vectors
 * as three independent display axes distorts the Brillouin-zone shape and can
 * turn a reciprocal-space cube into an arbitrary parallelepiped.  A single
 * scale preserves angles and relative lengths while the real-cell center gives
 * the overlay a stable, predictable anchor in the structure viewport.
 */
export function fitBrillouinZoneToCell(
  reciprocalVertices: [number, number, number][],
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number],
): BrillouinDisplayTransform {
  if (reciprocalVertices.length === 0) {
    throw new Error('Cannot fit an empty Brillouin zone')
  }

  const reciprocalRadius = Math.max(...reciprocalVertices.map(([x, y, z]) => Math.hypot(x, y, z)))
  if (!Number.isFinite(reciprocalRadius) || reciprocalRadius <= 1e-10) {
    throw new Error('Brillouin-zone vertices must define a finite volume')
  }

  const origin: [number, number, number] = [
    (a1[0] + a2[0] + a3[0]) / 2,
    (a1[1] + a2[1] + a3[1]) / 2,
    (a1[2] + a2[2] + a3[2]) / 2,
  ]

  let cellRadius = 0
  for (const i of [-0.5, 0.5]) {
    for (const j of [-0.5, 0.5]) {
      for (const k of [-0.5, 0.5]) {
        cellRadius = Math.max(cellRadius, Math.hypot(
          i * a1[0] + j * a2[0] + k * a3[0],
          i * a1[1] + j * a2[1] + k * a3[1],
          i * a1[2] + j * a2[2] + k * a3[2],
        ))
      }
    }
  }

  if (!Number.isFinite(cellRadius) || cellRadius <= 1e-10) {
    throw new Error('Real-space lattice vectors must define a finite cell')
  }

  return {
    origin,
    scale: cellRadius * 0.68 / reciprocalRadius,
    reciprocalRadius,
  }
}

/**
 * Generate reciprocal lattice points for BZ construction
 * Returns a grid of G vectors: n1*b1 + n2*b2 + n3*b3
 */
function generateReciprocalLatticePoints(
  b1: [number, number, number],
  b2: [number, number, number],
  b3: [number, number, number],
  range: number = 2
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  
  for (let n1 = -range; n1 <= range; n1++) {
    for (let n2 = -range; n2 <= range; n2++) {
      for (let n3 = -range; n3 <= range; n3++) {
        if (n1 === 0 && n2 === 0 && n3 === 0) continue // Skip origin
        
        const point = new THREE.Vector3(
          n1 * b1[0] + n2 * b2[0] + n3 * b3[0],
          n1 * b1[1] + n2 * b2[1] + n3 * b3[1],
          n1 * b1[2] + n2 * b2[2] + n3 * b3[2]
        )
        points.push(point)
      }
    }
  }
  
  return points
}

/**
 * Calculate the perpendicular bisector plane between origin and a point
 */
function getBisectorPlane(point: THREE.Vector3): THREE.Plane {
  const midpoint = point.clone().multiplyScalar(0.5)
  const normal = point.clone().normalize()
  return new THREE.Plane(normal, -midpoint.dot(normal))
}

/**
 * Check if a point is inside all bisector planes (inside the first BZ)
 */
function isInsideBZ(
  point: THREE.Vector3,
  bisectorPlanes: THREE.Plane[],
  tolerance: number = 1e-8
): boolean {
  for (const plane of bisectorPlanes) {
    if (plane.distanceToPoint(point) > tolerance) {
      return false
    }
  }
  return true
}

/**
 * Find intersection of three planes
 */
function intersectThreePlanes(
  p1: THREE.Plane,
  p2: THREE.Plane,
  p3: THREE.Plane
): THREE.Vector3 | null {
  const n1 = p1.normal
  const n2 = p2.normal
  const n3 = p3.normal
  
  const det = n1.dot(new THREE.Vector3().crossVectors(n2, n3))
  
  if (Math.abs(det) < 1e-10) {
    return null // Planes are parallel or nearly so
  }
  
  const d1 = -p1.constant
  const d2 = -p2.constant
  const d3 = -p3.constant
  
  const cross23 = new THREE.Vector3().crossVectors(n2, n3)
  const cross31 = new THREE.Vector3().crossVectors(n3, n1)
  const cross12 = new THREE.Vector3().crossVectors(n1, n2)
  
  const point = new THREE.Vector3()
    .addScaledVector(cross23, d1)
    .addScaledVector(cross31, d2)
    .addScaledVector(cross12, d3)
    .divideScalar(det)
  
  return point
}

/**
 * Construct the first Brillouin zone using Voronoi tessellation
 * The BZ is the Wigner-Seitz cell of the reciprocal lattice
 */
export function constructBrillouinZone(
  b1: [number, number, number],
  b2: [number, number, number],
  b3: [number, number, number]
): BrillouinZoneData {
  // Generate reciprocal lattice points
  const gPoints = generateReciprocalLatticePoints(b1, b2, b3, 2)
  
  // Sort by distance from origin to prioritize closer planes
  gPoints.sort((a, b) => a.lengthSq() - b.lengthSq())
  
  // Create bisector planes for each G vector
  const bisectorPlanes: THREE.Plane[] = gPoints.map(g => getBisectorPlane(g))
  
  // Find all vertices by intersecting triplets of planes
  const vertices: THREE.Vector3[] = []
  const vertexSet = new Set<string>()
  
  const tolerance = 1e-6
  const maxPlanes = Math.min(bisectorPlanes.length, 26) // Use closest planes
  
  for (let i = 0; i < maxPlanes; i++) {
    for (let j = i + 1; j < maxPlanes; j++) {
      for (let k = j + 1; k < maxPlanes; k++) {
        const intersection = intersectThreePlanes(
          bisectorPlanes[i],
          bisectorPlanes[j],
          bisectorPlanes[k]
        )
        
        if (intersection && isInsideBZ(intersection, bisectorPlanes.slice(0, maxPlanes), tolerance)) {
          // Round to avoid numerical duplicates
          const key = `${intersection.x.toFixed(6)},${intersection.y.toFixed(6)},${intersection.z.toFixed(6)}`
          if (!vertexSet.has(key)) {
            vertexSet.add(key)
            vertices.push(intersection)
          }
        }
      }
    }
  }
  
  // Find edges: pairs of vertices that share two planes
  const edges: [number, number][] = []
  const edgeSet = new Set<string>()
  
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      // Check if these two vertices share an edge (both lie on same two planes)
      let sharedPlanes = 0
      for (const plane of bisectorPlanes.slice(0, maxPlanes)) {
        const d1 = Math.abs(plane.distanceToPoint(vertices[i]))
        const d2 = Math.abs(plane.distanceToPoint(vertices[j]))
        if (d1 < tolerance && d2 < tolerance) {
          sharedPlanes++
        }
      }
      
      if (sharedPlanes >= 2) {
        const key = `${Math.min(i, j)}-${Math.max(i, j)}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push([i, j])
        }
      }
    }
  }
  
  // Find faces: sets of vertices that share one plane
  const faces: number[][] = []
  
  for (let planeIdx = 0; planeIdx < maxPlanes; planeIdx++) {
    const faceVertices: number[] = []
    
    for (let i = 0; i < vertices.length; i++) {
      const dist = Math.abs(bisectorPlanes[planeIdx].distanceToPoint(vertices[i]))
      if (dist < tolerance) {
        faceVertices.push(i)
      }
    }
    
    if (faceVertices.length >= 3) {
      // Sort vertices by angle around face center for proper polygon ordering
      const center = new THREE.Vector3()
      for (const idx of faceVertices) {
        center.add(vertices[idx])
      }
      center.divideScalar(faceVertices.length)
      
      const normal = bisectorPlanes[planeIdx].normal.clone()
      
      // Create a local coordinate system on the face
      let u = new THREE.Vector3()
      if (Math.abs(normal.x) < 0.9) {
        u.crossVectors(new THREE.Vector3(1, 0, 0), normal)
      } else {
        u.crossVectors(new THREE.Vector3(0, 1, 0), normal)
      }
      u.normalize()
      const v = new THREE.Vector3().crossVectors(normal, u)
      
      // Sort by angle
      faceVertices.sort((a, b) => {
        const da = vertices[a].clone().sub(center)
        const db = vertices[b].clone().sub(center)
        const angleA = Math.atan2(da.dot(v), da.dot(u))
        const angleB = Math.atan2(db.dot(v), db.dot(u))
        return angleA - angleB
      })
      
      faces.push(faceVertices)
    }
  }
  
  // Calculate volume using divergence theorem
  let volume = 0
  for (const face of faces) {
    if (face.length < 3) continue
    
    const v0 = vertices[face[0]]
    for (let i = 1; i < face.length - 1; i++) {
      const v1 = vertices[face[i]]
      const v2 = vertices[face[i + 1]]
      
      // Volume contribution from this triangle
      volume += v0.dot(new THREE.Vector3().crossVectors(v1, v2)) / 6
    }
  }
  volume = Math.abs(volume)
  
  return {
    reciprocalLattice: { b1, b2, b3 },
    vertices: vertices.map(v => [v.x, v.y, v.z] as [number, number, number]),
    faces,
    edges,
    volume,
  }
}

/**
 * Identify the Bravais lattice type from lattice parameters
 * 
 * @param centeringType - Optional centering type from space group (P, F, I, C, A, R)
 */
export function identifyBravaisLattice(
  a: number, b: number, c: number,
  alpha: number, beta: number, gamma: number,
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R'
): string {
  const tol = 0.01 // 1% tolerance
  const angTol = 1.0 // 1 degree tolerance
  
  const eq = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y) < tol
  const angEq = (x: number, y: number) => Math.abs(x - y) < angTol
  
  // Cubic: a=b=c, alpha=beta=gamma=90
  if (eq(a, b) && eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    return 'cubic'
  }
  
  // Check for rhombohedral in hexagonal setting FIRST (before hexagonal)
  // hR lattice: a=b, gamma=120, alpha=beta=90, but with R centering
  // OR when we detect the structure has rhombohedral symmetry
  if (eq(a, b) && !eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 120)) {
    // If centering type is R, it's definitely rhombohedral
    if (centeringType === 'R') {
      return 'rhombohedral'
    }
    // Otherwise it's simple hexagonal
    return 'hexagonal'
  }
  
  // Tetragonal: a=b!=c, alpha=beta=gamma=90
  if (eq(a, b) && !eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    return 'tetragonal'
  }
  
  // Rhombohedral/Trigonal in primitive setting: a=b=c, alpha=beta=gamma!=90
  if (eq(a, b) && eq(b, c) && angEq(alpha, beta) && angEq(beta, gamma) && !angEq(alpha, 90)) {
    return 'rhombohedral'
  }
  
  // Orthorhombic: a!=b!=c, alpha=beta=gamma=90
  if (!eq(a, b) && !eq(b, c) && !eq(a, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    return 'orthorhombic'
  }
  
  // Monoclinic: a!=b!=c, alpha=gamma=90, beta!=90
  if (angEq(alpha, 90) && angEq(gamma, 90) && !angEq(beta, 90)) {
    return 'monoclinic'
  }
  
  // Triclinic: everything else
  return 'triclinic'
}

/**
 * Convert hexagonal cell to rhombohedral primitive cell
 * For R-centered hexagonal, the primitive rhombohedral cell has:
 * - a_r = sqrt(a^2/3 + c^2/9)  
 * - alpha_r = 2*arcsin(3/(2*sqrt(3 + (c/a)^2)))
 */
export function hexagonalToRhombohedralPrimitive(
  a: number, c: number
): { aR: number; alphaR: number; latticeVectors: [[number,number,number], [number,number,number], [number,number,number]] } {
  // The transformation from hexagonal to rhombohedral primitive
  // Using the obverse setting (standard)
  const ratio = c / a
  
  // Calculate primitive rhombohedral lattice parameter
  const aR = Math.sqrt(a * a / 3 + c * c / 9)
  
  // Alternative formula that's more stable
  const alphaR = 2 * Math.asin(3 / (2 * Math.sqrt(3 + ratio * ratio))) * 180 / Math.PI
  
  // Calculate the actual primitive lattice vectors
  // Using the standard transformation matrix from hex to rhombohedral
  const sin120 = Math.sin(2 * Math.PI / 3)
  const cos120 = Math.cos(2 * Math.PI / 3)
  
  // Hexagonal lattice vectors
  const a1_hex: [number, number, number] = [a, 0, 0]
  const a2_hex: [number, number, number] = [a * cos120, a * sin120, 0]
  const a3_hex: [number, number, number] = [0, 0, c]
  
  // Transformation to primitive rhombohedral: a_r = (2a1 + a2 + a3)/3, etc.
  const ar1: [number, number, number] = [
    (2 * a1_hex[0] + a2_hex[0] + a3_hex[0]) / 3,
    (2 * a1_hex[1] + a2_hex[1] + a3_hex[1]) / 3,
    (2 * a1_hex[2] + a2_hex[2] + a3_hex[2]) / 3
  ]
  
  const ar2: [number, number, number] = [
    (-a1_hex[0] + a2_hex[0] + a3_hex[0]) / 3,
    (-a1_hex[1] + a2_hex[1] + a3_hex[1]) / 3,
    (-a1_hex[2] + a2_hex[2] + a3_hex[2]) / 3
  ]
  
  const ar3: [number, number, number] = [
    (-a1_hex[0] - 2 * a2_hex[0] + a3_hex[0]) / 3,
    (-a1_hex[1] - 2 * a2_hex[1] + a3_hex[1]) / 3,
    (-a1_hex[2] - 2 * a2_hex[2] + a3_hex[2]) / 3
  ]
  
  return {
    aR,
    alphaR,
    latticeVectors: [ar1, ar2, ar3]
  }
}

/**
 * Calculate lattice parameters from lattice vectors
 */
export function getLatticeParameters(
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number]
): { a: number; b: number; c: number; alpha: number; beta: number; gamma: number } {
  const va1 = new THREE.Vector3(...a1)
  const va2 = new THREE.Vector3(...a2)
  const va3 = new THREE.Vector3(...a3)
  
  const a = va1.length()
  const b = va2.length()
  const c = va3.length()
  
  // Angles in degrees
  const alpha = THREE.MathUtils.radToDeg(Math.acos(va2.dot(va3) / (b * c)))
  const beta = THREE.MathUtils.radToDeg(Math.acos(va1.dot(va3) / (a * c)))
  const gamma = THREE.MathUtils.radToDeg(Math.acos(va1.dot(va2) / (a * b)))
  
  return { a, b, c, alpha, beta, gamma }
}

// Alias for backwards compatibility
export const generateBrillouinZone = constructBrillouinZone
