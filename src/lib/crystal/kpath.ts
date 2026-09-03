/**
 * K-Path Determination Library
 * Based on the HPKOT convention (Hinuma, Pizzi, Kumagai, Oba, Tanaka)
 * Reference: Computational Materials Science 128 (2017) 140-184
 * 
 * Implements standard k-point paths for all 24 extended Bravais lattice types
 * as defined in the SeeK-path algorithm.
 */

import { kpointToCartesian, getLatticeParameters, calculateReciprocalLattice, hexagonalToRhombohedralPrimitive } from './brillouin-zone'
import {
  HPKOT_DATA,
  type ExtendedBravaisType,
  type KExpressionScope,
  evaluateKExpression,
  getExtendedBravaisForSpaceGroup
} from './hpkot-data'

// K-point and K-path types (defined here to avoid circular imports)
export interface KPoint {
  label: string
  coords: [number, number, number]  // In reciprocal lattice coordinates
  cartesian: [number, number, number]  // In Cartesian coordinates (1/Angstrom)
}

export interface KPath {
  points: KPoint[]
  segments: [string, string][]  // Pairs of k-point labels forming the path
}

// Greek letter labels for display
export const KPOINT_LABELS: Record<string, string> = {
  'GAMMA': 'Γ',
  'Gamma': 'Γ',
  'G': 'Γ',
  'SIGMA': 'Σ',
  'DELTA': 'Δ',
  'LAMBDA': 'Λ',
  'PI': 'Π',
}

/**
 * Determine the extended Bravais lattice type from lattice parameters and space group
 */
export function determineExtendedBravais(
  a: number,
  b: number,
  c: number,
  alpha: number,  // in degrees
  beta: number,
  gamma: number,
  spaceGroupNumber?: number,
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R'
): ExtendedBravaisType {
  const cosalpha = Math.cos(alpha * Math.PI / 180)
  const cosbeta = Math.cos(beta * Math.PI / 180)
  const cosgamma = Math.cos(gamma * Math.PI / 180)
  const sinbeta = Math.sqrt(1 - cosbeta * cosbeta)
  
  // If space group is known, use it for accurate determination
  if (spaceGroupNumber && spaceGroupNumber >= 1 && spaceGroupNumber <= 230) {
    return getExtendedBravaisForSpaceGroup(spaceGroupNumber, a, b, c, cosalpha, cosbeta, cosgamma)
  }
  
  // Otherwise, infer from lattice parameters and centering type
  const tol = 0.01
  const angTol = 1.0
  
  const eq = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y, 1e-10) < tol
  const angEq = (x: number, y: number) => Math.abs(x - y) < angTol
  
  // Cubic: a=b=c, alpha=beta=gamma=90
  if (eq(a, b) && eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    if (centeringType === 'F') return 'cF2'
    if (centeringType === 'I') return 'cI1'
    return 'cP2'
  }
  
  // Hexagonal or Rhombohedral (in hexagonal setting)
  if (eq(a, b) && !eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 120)) {
    if (centeringType === 'R') {
      // Rhombohedral: check sqrt(3)*a vs sqrt(2)*c
      if (Math.sqrt(3) * a <= Math.sqrt(2) * c) {
        return 'hR1'
      }
      return 'hR2'
    }
    return 'hP2'
  }
  
  // Tetragonal: a=b!=c, alpha=beta=gamma=90
  if (eq(a, b) && !eq(b, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    if (centeringType === 'I') {
      return c < a ? 'tI1' : 'tI2'
    }
    return 'tP1'
  }
  
  // Rhombohedral in primitive setting: a=b=c, alpha=beta=gamma!=90
  if (eq(a, b) && eq(b, c) && angEq(alpha, beta) && angEq(beta, gamma) && !angEq(alpha, 90)) {
    // Convert to hexagonal setting comparison sqrt(3)*a_hex vs sqrt(2)*c_hex (HPKOT criterion)
    // Calculate hexagonal parameters from α_rhom: a_hex = 2*a*sin(alpha/2), c_hex = a*sqrt(3(1+2cos(alpha)))
    const alphaRad = alpha * Math.PI / 180
    const aHex = 2 * a * Math.sin(alphaRad / 2)
    const cosA = Math.cos(alphaRad)
    const cHex = a * Math.sqrt(3 * (1 + 2 * cosA))
    return Math.sqrt(3) * aHex <= Math.sqrt(2) * cHex ? 'hR1' : 'hR2'
  }
  
  // Orthorhombic: a!=b!=c, alpha=beta=gamma=90
  if (!eq(a, b) && !eq(b, c) && !eq(a, c) && angEq(alpha, 90) && angEq(beta, 90) && angEq(gamma, 90)) {
    if (centeringType === 'F') {
      if (1/(a*a) > 1/(b*b) + 1/(c*c)) return 'oF1'
      if (1/(c*c) > 1/(a*a) + 1/(b*b)) return 'oF2'
      return 'oF3'
    }
    if (centeringType === 'I') {
      if (c >= a && c >= b) return 'oI1'
      if (a >= b && a >= c) return 'oI2'
      return 'oI3'
    }
    if (centeringType === 'C') {
      return a <= b ? 'oC1' : 'oC2'
    }
    if (centeringType === 'A') {
      return b <= c ? 'oA1' : 'oA2'
    }
    return 'oP1'
  }
  
  // Monoclinic: alpha=gamma=90, beta!=90
  if (angEq(alpha, 90) && angEq(gamma, 90) && !angEq(beta, 90)) {
    if (centeringType === 'C') {
      if (b < a * sinbeta) return 'mC1'
      const condition = -a * cosbeta / c + a * a * sinbeta * sinbeta / b / b
      if (condition <= 1) return 'mC2'
      return 'mC3'
    }
    return 'mP1'
  }
  
  // Triclinic: everything else
  // Need to check reciprocal cell angles for aP2 vs aP3
  // For simplicity, default to aP2 (all-obtuse)
  return 'aP2'
}

/**
 * Get the appropriate k-points for a given lattice using HPKOT convention
 */
export function getKPointsForLattice(
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number],
  b1: [number, number, number],
  b2: [number, number, number],
  b3: [number, number, number],
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R',
  spaceGroupNumber?: number
): KPoint[] {
  const params = getLatticeParameters(a1, a2, a3)
  
  // Determine extended Bravais lattice type
  const extBravais = determineExtendedBravais(
    params.a, params.b, params.c,
    params.alpha, params.beta, params.gamma,
    spaceGroupNumber,
    centeringType
  )
  
  // Get HPKOT data for this lattice type
  const data = HPKOT_DATA[extBravais]
  if (!data) {
    // Every value determineExtendedBravais can return has a table entry; a
    // miss is a data bug. Never substitute another lattice's k-points.
    throw new Error(`No HPKOT band-path data for lattice type ${extBravais}`)
  }

  // One scope for k-parameters and k-point coordinates. The table lists
  // k-parameters in dependency order, so each one can see its predecessors.
  const rad = Math.PI / 180
  const scope: KExpressionScope = {
    a: params.a, b: params.b, c: params.c,
    cosalpha: Math.cos(params.alpha * rad), cosbeta: Math.cos(params.beta * rad), cosgamma: Math.cos(params.gamma * rad),
    sinalpha: Math.sin(params.alpha * rad), sinbeta: Math.sin(params.beta * rad), singamma: Math.sin(params.gamma * rad),
  }
  for (const { name, expr } of data.kparams) {
    scope[name] = evaluateKExpression(expr, scope)
  }
  
  // For rhombohedral in hexagonal setting, we need to use the primitive rhombohedral
  // reciprocal lattice for k-point coordinates
  let effectiveB1 = b1
  let effectiveB2 = b2
  let effectiveB3 = b3
  
  if (extBravais === 'hR1' || extBravais === 'hR2') {
    // The HPKOT k-points for hR are given in the primitive rhombohedral basis
    // We need to calculate the primitive rhombohedral cell and its reciprocal lattice
    const rhomPrim = hexagonalToRhombohedralPrimitive(params.a, params.c)
    const primRecip = calculateReciprocalLattice(
      rhomPrim.latticeVectors[0],
      rhomPrim.latticeVectors[1],
      rhomPrim.latticeVectors[2]
    )
    effectiveB1 = primRecip.b1
    effectiveB2 = primRecip.b2
    effectiveB3 = primRecip.b3
  }
  
  // Generate k-points with evaluated coordinates
  const kpoints: KPoint[] = []
  for (const [label, coordExprs] of Object.entries(data.points)) {
    const coords: [number, number, number] = [
      evaluateKExpression(coordExprs[0], scope),
      evaluateKExpression(coordExprs[1], scope),
      evaluateKExpression(coordExprs[2], scope)
    ]
    
    const cartesian = kpointToCartesian(coords, effectiveB1, effectiveB2, effectiveB3)
    
    kpoints.push({
      label,
      coords,
      cartesian,
    })
  }
  
  return kpoints
}

/**
 * Get the recommended k-path for a given lattice using HPKOT convention
 */
export function getKPathForLattice(
  a1: [number, number, number],
  a2: [number, number, number],
  a3: [number, number, number],
  b1: [number, number, number],
  b2: [number, number, number],
  b3: [number, number, number],
  centeringType?: 'P' | 'F' | 'I' | 'C' | 'A' | 'R',
  spaceGroupNumber?: number
): KPath {
  const params = getLatticeParameters(a1, a2, a3)
  
  // Determine extended Bravais lattice type
  const extBravais = determineExtendedBravais(
    params.a, params.b, params.c,
    params.alpha, params.beta, params.gamma,
    spaceGroupNumber,
    centeringType
  )
  
  // Get k-points
  const kpoints = getKPointsForLattice(a1, a2, a3, b1, b2, b3, centeringType, spaceGroupNumber)
  
  // Get HPKOT path
  const data = HPKOT_DATA[extBravais]
  const segments = data?.path || [['GAMMA', 'X']]
  
  return {
    points: kpoints,
    segments,
  }
}

/**
 * Generate interpolated k-points along a path for band structure calculations
 */
export function interpolateKPath(
  kpath: KPath,
  pointsPerSegment: number = 20
): { points: [number, number, number][]; distances: number[]; ticks: { label: string; distance: number }[] } {
  const points: [number, number, number][] = []
  const distances: number[] = []
  const ticks: { label: string; distance: number }[] = []
  
  let totalDistance = 0
  const kpointMap = new Map(kpath.points.map(p => [p.label, p]))
  
  for (const [startLabel, endLabel] of kpath.segments) {
    const startPoint = kpointMap.get(startLabel)
    const endPoint = kpointMap.get(endLabel)
    
    if (!startPoint || !endPoint) continue
    
    // Add tick for start point
    if (ticks.length === 0 || ticks[ticks.length - 1].label !== startLabel) {
      ticks.push({ label: startLabel, distance: totalDistance })
    }
    
    // Calculate segment length in reciprocal space
    const dx = endPoint.cartesian[0] - startPoint.cartesian[0]
    const dy = endPoint.cartesian[1] - startPoint.cartesian[1]
    const dz = endPoint.cartesian[2] - startPoint.cartesian[2]
    const segmentLength = Math.sqrt(dx * dx + dy * dy + dz * dz)
    
    // Interpolate points along this segment
    for (let i = 0; i < pointsPerSegment; i++) {
      const t = i / (pointsPerSegment - 1)
      const x = startPoint.coords[0] + t * (endPoint.coords[0] - startPoint.coords[0])
      const y = startPoint.coords[1] + t * (endPoint.coords[1] - startPoint.coords[1])
      const z = startPoint.coords[2] + t * (endPoint.coords[2] - startPoint.coords[2])
      
      points.push([x, y, z])
      distances.push(totalDistance + t * segmentLength)
    }
    
    totalDistance += segmentLength
    
    // Add tick for end point
    ticks.push({ label: endLabel, distance: totalDistance })
  }
  
  return { points, distances, ticks }
}

/**
 * Format k-point coordinates for display
 */
export function formatKPointCoords(coords: [number, number, number]): string {
  const format = (n: number): string => {
    // Check for common fractions
    if (Math.abs(n) < 1e-6) return '0'
    if (Math.abs(n - 0.5) < 1e-6) return '1/2'
    if (Math.abs(n + 0.5) < 1e-6) return '-1/2'
    if (Math.abs(n - 1/3) < 1e-6) return '1/3'
    if (Math.abs(n - 2/3) < 1e-6) return '2/3'
    if (Math.abs(n - 0.25) < 1e-6) return '1/4'
    if (Math.abs(n - 0.75) < 1e-6) return '3/4'
    if (Math.abs(n - 0.375) < 1e-6) return '3/8'
    if (Math.abs(n - 0.625) < 1e-6) return '5/8'
    if (Math.abs(n - 1/6) < 1e-6) return '1/6'
    if (Math.abs(n - 5/6) < 1e-6) return '5/6'
    return n.toFixed(3)
  }
  
  return `(${format(coords[0])}, ${format(coords[1])}, ${format(coords[2])})`
}

/**
 * Get display label for k-point (with Greek letters)
 */
export function getKPointDisplayLabel(label: string): string {
  return KPOINT_LABELS[label] || label
}
