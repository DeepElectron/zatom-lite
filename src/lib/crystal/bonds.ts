// Chemical bond calculation and utilities
import type { Atom, Bond, LatticeVectors } from './types'
import { getElement } from './elements'
import { fractionalToCartesian } from './lattice'
import { isValidLattice, latticeShift, type Vec3 } from './lattice-math'

// Typical covalent bond lengths in Angstroms for common bond types
// Data from: CRC Handbook of Chemistry and Physics, and NIST Chemistry WebBook
export const BOND_LENGTHS: Record<string, { single: number; double?: number; triple?: number }> = {
  // Carbon bonds
  'C-C': { single: 1.54, double: 1.34, triple: 1.20 },
  'C-H': { single: 1.09 },
  'C-O': { single: 1.43, double: 1.23 },
  'C-N': { single: 1.47, double: 1.29, triple: 1.16 },
  'C-S': { single: 1.82, double: 1.60 },
  'C-F': { single: 1.35 },
  'C-Cl': { single: 1.77 },
  'C-Br': { single: 1.94 },
  'C-I': { single: 2.14 },
  // Nitrogen bonds
  'N-N': { single: 1.45, double: 1.25, triple: 1.10 },
  'N-H': { single: 1.01 },
  'N-O': { single: 1.40, double: 1.21 },
  // Oxygen bonds
  'O-O': { single: 1.48, double: 1.21 },
  'O-H': { single: 0.96 },
  'O-S': { single: 1.58, double: 1.43 },
  // Sulfur bonds
  'S-S': { single: 2.05, double: 1.89 },
  'S-H': { single: 1.34 },
  // Phosphorus bonds
  'P-O': { single: 1.63, double: 1.50 },
  'P-N': { single: 1.77 },
  'P-C': { single: 1.87 },
  'P-H': { single: 1.44 },
  // Silicon bonds
  'Si-O': { single: 1.63 },
  'Si-C': { single: 1.89 },
  'Si-H': { single: 1.48 },
  'Si-Si': { single: 2.35 },
  // Metal-related bonds
  'Fe-O': { single: 2.10 },
  'Fe-N': { single: 2.10 },
  'Fe-C': { single: 1.92 },
  'Cu-O': { single: 1.96 },
  'Cu-N': { single: 2.02 },
  'Zn-O': { single: 2.10 },
  'Zn-N': { single: 2.10 },
}

// Get bond length data for a pair of elements
function getBondLengthData(element1: string, element2: string): { single: number; double?: number; triple?: number } | null {
  // Try both orderings
  const key1 = `${element1}-${element2}`
  const key2 = `${element2}-${element1}`
  return BOND_LENGTHS[key1] || BOND_LENGTHS[key2] || null
}

// Calculate distance between two atoms
export function calculateDistance(
  pos1: [number, number, number],
  pos2: [number, number, number]
): number {
  const dx = pos2[0] - pos1[0]
  const dy = pos2[1] - pos1[1]
  const dz = pos2[2] - pos1[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Calculate midpoint between two positions
export function calculateMidpoint(
  pos1: [number, number, number],
  pos2: [number, number, number]
): [number, number, number] {
  return [
    (pos1[0] + pos2[0]) / 2,
    (pos1[1] + pos2[1]) / 2,
    (pos1[2] + pos2[2]) / 2,
  ]
}

// Get maximum bonding distance for two elements
/** Default tolerance in Å added to the covalent-radius sum. */
export const DEFAULT_BOND_TOLERANCE = 0.4

export function getMaxBondDistance(
  element1: string,
  element2: string,
  tolerance: number = DEFAULT_BOND_TOLERANCE,
): number {
  const e1 = getElement(element1)
  const e2 = getElement(element2)
  // The configurable tolerance is the only empirical term in this criterion.
  return e1.radius + e2.radius + tolerance
}

// Determine bond type based on distance and element pair
function determineBondType(
  element1: string, 
  element2: string, 
  distance: number
): 'single' | 'double' | 'triple' {
  const bondData = getBondLengthData(element1, element2)
  
  if (bondData) {
    // Use known bond length data with tolerance
    const tolerance = 0.10 // 0.10 Angstrom tolerance
    
    // Check triple bond first (shortest)
    if (bondData.triple && Math.abs(distance - bondData.triple) < tolerance) {
      return 'triple'
    }
    
    // Check double bond
    if (bondData.double && Math.abs(distance - bondData.double) < tolerance) {
      return 'double'
    }
    
    // For ambiguous cases, use midpoint thresholds
    if (bondData.triple && bondData.double) {
      const tripleMid = (bondData.triple + bondData.double) / 2
      if (distance < tripleMid) return 'triple'
    }
    
    if (bondData.double && bondData.single) {
      const doubleMid = (bondData.double + bondData.single) / 2
      if (distance < doubleMid) return 'double'
    }
    
    return 'single'
  }
  
  // Fallback: Use covalent radii-based heuristic for unknown pairs
  // This is less accurate but provides reasonable defaults
  const e1 = getElement(element1)
  const e2 = getElement(element2)
  const expectedSingle = e1.radius + e2.radius
  
  // Rough approximations: double ~86% of single, triple ~78% of single
  const expectedDouble = expectedSingle * 0.86
  const expectedTriple = expectedSingle * 0.78
  
  const tolerance = 0.12
  
  if (Math.abs(distance - expectedTriple) < tolerance && distance < expectedDouble - 0.05) {
    return 'triple'
  }
  
  if (Math.abs(distance - expectedDouble) < tolerance && distance < expectedSingle - 0.08) {
    return 'double'
  }
  
  return 'single'
}

/** Optional behavior for automatic bond detection. */
export interface AutoDetectBondOptions {
  /**
  * Search periodic images. This is opt-in because molecular inputs may carry a
  * synthetic 1 Å cell that must not create periodic bonds.
  */
  periodic?: boolean
  /** Extra tolerance in Å when no element-pair override exists. */
  tolerance?: number
  /**
  * Lattice used to search periodic images. For a supercell this must be the
  * displayed supercell box, so search offsets and rendered image offsets share
  * the same unit.
  */
  periodicLattice?: LatticeVectors
}

/**
 * Number of periodic-image layers required to cover a cutoff. Small cells may
 * require more than ±1; a defensive cap prevents pathological search cost.
 */
function imageRangeForAxis(axis: Vec3, cutoff: number): number {
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (!Number.isFinite(len) || len < 1e-6) return 0
  return Math.min(3, Math.max(1, Math.ceil(cutoff / len)))
}

// Auto-detect bonds based on distance criteria
export function autoDetectBonds(
  atoms: Atom[],
  latticeVectors: LatticeVectors,
  maxBondLength: number = 3.0,
  elementPairRadii: Readonly<Record<string, number>> = {},
  restrictToConfiguredPairs = false,
  options: AutoDetectBondOptions = {},
): Bond[] {
  const bonds: Bond[] = []
  const bondSet = new Set<string>()
  const tolerance = options.tolerance

  // Convert all atoms to cartesian coordinates
  const cartesianAtoms = atoms.map(atom => ({
    ...atom,
    cartesian: atom.cartesian || fractionalToCartesian(atom.position, latticeVectors),
  }))

  // Cartesian conversion still uses the primitive lattice; only the periodic
  // search offset uses the displayed supercell box.
  const imageLattice = options.periodicLattice ?? latticeVectors

  // A missing or degenerate lattice disables periodic-image search.
  const usePeriodic = options.periodic === true && isValidLattice(imageLattice)
  const ra = usePeriodic ? imageRangeForAxis(imageLattice.a as Vec3, maxBondLength) : 0
  const rb = usePeriodic ? imageRangeForAxis(imageLattice.b as Vec3, maxBondLength) : 0
  const rc = usePeriodic ? imageRangeForAxis(imageLattice.c as Vec3, maxBondLength) : 0

  // Precompute image displacements outside the atom-pair loop.
  const images: { off: [number, number, number]; shift: Vec3 }[] = []
  for (let na = -ra; na <= ra; na++) {
    for (let nb = -rb; nb <= rb; nb++) {
      for (let nc = -rc; nc <= rc; nc++) {
        images.push({
        off: [na, nb, nc],
        // `latticeOffset` is expressed in displayed-box units throughout
        // detection and rendering; mixing primitive-cell units creates long bonds.
        shift: na === 0 && nb === 0 && nc === 0
          ? [0, 0, 0]
          : latticeShift(imageLattice, na, nb, nc),
        })
      }
    }
  }

  // Spatial cell list. A naive O(N²) scan is prohibitive for tens of thousands
  // of atoms. The global distance cutoff bounds the search to 27 neighboring
  // cells per atom, reducing work to O(N × images × local density).
  let cutoffBound = maxBondLength
  for (const key in elementPairRadii) {
    const v = elementPairRadii[key]
    if (Number.isFinite(v) && v > cutoffBound) cutoffBound = v
  }
  const cellSize = Math.max(cutoffBound, 0.1)
  const grid = new Map<string, number[]>()
  for (let j = 0; j < cartesianAtoms.length; j++) {
    const c = cartesianAtoms[j].cartesian!
    const key = `${Math.floor(c[0] / cellSize)},${Math.floor(c[1] / cellSize)},${Math.floor(c[2] / cellSize)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(j)
    else grid.set(key, [j])
  }

  // Element combinations are few, so cache their distance criteria once.
  const maxDistCache = new Map<string, number>()
  const pairMaxDist = (el1: string, el2: string): number => {
    const pairKey = el1 <= el2 ? `${el1}-${el2}` : `${el2}-${el1}`
    let d = maxDistCache.get(pairKey)
    if (d === undefined) {
      const pairOverride = elementPairRadii[pairKey]
      if (pairOverride !== undefined) d = pairOverride
      else if (restrictToConfiguredPairs) d = -1 // This combination is not allowed to be a key
      else d = Math.min(getMaxBondDistance(el1, el2, tolerance), maxBondLength)
      maxDistCache.set(pairKey, d)
    }
    return d
  }

  for (let i = 0; i < cartesianAtoms.length; i++) {
    const atom1 = cartesianAtoms[i]
    const c1 = atom1.cartesian!

    for (const image of images) {
      const [na, nb, nc] = image.off
      const isHome = na === 0 && nb === 0 && nc === 0
      // |c2 + shift - c1| < cutoff is equivalent to searching for c2 around
      // `c1 - shift` in the 27 neighboring spatial cells.
      const [sx, sy, sz] = image.shift
      const tx = c1[0] - sx, ty = c1[1] - sy, tz = c1[2] - sz
      const cx = Math.floor(tx / cellSize), cy = Math.floor(ty / cellSize), cz = Math.floor(tz / cellSize)

      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (let gz = cz - 1; gz <= cz + 1; gz++) {
            const bucket = grid.get(`${gx},${gy},${gz}`)
            if (!bucket) continue
            for (const j of bucket) {
              // Visit each unordered pair once. For self-images, +offset and
              // -offset describe the same bond, so retain one canonical half.
              if (j < i) continue
              if (i === j) {
                if (isHome) continue
                const lead = na !== 0 ? na : nb !== 0 ? nb : nc
                if (lead < 0) continue
              }
              const atom2 = cartesianAtoms[j]
              const maxDist = pairMaxDist(atom1.element, atom2.element)
              if (maxDist <= 0) continue

              const c2 = atom2.cartesian!
              const dx = c2[0] - tx
              const dy = c2[1] - ty
              const dz = c2[2] - tz
              const distance = Math.hypot(dx, dy, dz)
              if (distance >= maxDist || distance <= 0.5) continue

              // Periodic offset is part of bond identity; one atom pair may have
              // several physically distinct image bonds, as in BCC coordination.
              const idPair = atom1.id <= atom2.id ? `${atom1.id}-${atom2.id}` : `${atom2.id}-${atom1.id}`
              const bondKey = isHome ? idPair : `${idPair}|${na},${nb},${nc}`
              if (bondSet.has(bondKey)) continue
              bondSet.add(bondKey)

              bonds.push({
                id: `bond-${bondKey}`,
                atom1Id: atom1.id,
                atom2Id: atom2.id,
                type: determineBondType(atom1.element, atom2.element, distance),
                length: distance,
                ...(isHome ? {} : { latticeOffset: [na, nb, nc] as [number, number, number] }),
              })
            }
          }
        }
      }
    }
  }

  return bonds
}

// Calculate bond direction vector (normalized)
export function calculateBondDirection(
  pos1: [number, number, number],
  pos2: [number, number, number]
): [number, number, number] {
  const dx = pos2[0] - pos1[0]
  const dy = pos2[1] - pos1[1]
  const dz = pos2[2] - pos1[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
  
  if (length === 0) return [0, 1, 0]
  
  return [dx / length, dy / length, dz / length]
}

// Calculate rotation quaternion for bond cylinder
export function calculateBondRotation(
  pos1: [number, number, number],
  pos2: [number, number, number]
): [number, number, number, number] {
  const direction = calculateBondDirection(pos1, pos2)
  
  // Default cylinder is along Y axis
  const up: [number, number, number] = [0, 1, 0]
  
  // Calculate rotation axis (cross product)
  const crossX = up[1] * direction[2] - up[2] * direction[1]
  const crossY = up[2] * direction[0] - up[0] * direction[2]
  const crossZ = up[0] * direction[1] - up[1] * direction[0]
  
  // Calculate rotation angle (dot product)
  const dot = up[0] * direction[0] + up[1] * direction[1] + up[2] * direction[2]
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  
  // Handle parallel/anti-parallel cases
  const crossLength = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ)
  
  if (crossLength < 0.0001) {
    if (dot > 0) {
      return [0, 0, 0, 1] // No rotation needed
    } else {
      return [1, 0, 0, 0] // 180 degree rotation around X
    }
  }
  
  // Normalize rotation axis
  const nx = crossX / crossLength
  const ny = crossY / crossLength
  const nz = crossZ / crossLength
  
  // Convert to quaternion
  const halfAngle = angle / 2
  const sinHalf = Math.sin(halfAngle)
  
  return [
    nx * sinHalf,
    ny * sinHalf,
    nz * sinHalf,
    Math.cos(halfAngle),
  ]
}

// Get bond rendering parameters for ball-and-stick model
export function getBondRenderParams(
  atom1Pos: [number, number, number],
  atom2Pos: [number, number, number],
  bondType: 'single' | 'double' | 'triple'
) {
  const midpoint = calculateMidpoint(atom1Pos, atom2Pos)
  const length = calculateDistance(atom1Pos, atom2Pos)
  const rotation = calculateBondRotation(atom1Pos, atom2Pos)
  
  const baseRadius = 0.08
  const spacing = 0.2
  
  switch (bondType) {
    case 'single':
      return [{
        position: midpoint,
        length,
        rotation,
        radius: baseRadius,
        offset: [0, 0, 0] as [number, number, number],
      }]
    case 'double':
      return [
        {
          position: midpoint,
          length,
          rotation,
          radius: baseRadius * 0.8,
          offset: [-spacing / 2, 0, 0] as [number, number, number],
        },
        {
          position: midpoint,
          length,
          rotation,
          radius: baseRadius * 0.8,
          offset: [spacing / 2, 0, 0] as [number, number, number],
        },
      ]
    case 'triple':
      return [
        {
          position: midpoint,
          length,
          rotation,
          radius: baseRadius * 0.7,
          offset: [0, 0, 0] as [number, number, number],
        },
        {
          position: midpoint,
          length,
          rotation,
          radius: baseRadius * 0.7,
          offset: [-spacing, 0, 0] as [number, number, number],
        },
        {
          position: midpoint,
          length,
          rotation,
          radius: baseRadius * 0.7,
          offset: [spacing, 0, 0] as [number, number, number],
        },
      ]
  }
}
