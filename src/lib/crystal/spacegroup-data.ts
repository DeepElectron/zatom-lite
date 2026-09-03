/**
 * Space group symmetry operations, ITA standard setting, 'x,y,z' notation.
 *
 * This is a PARTIAL table: only the groups listed in SPACE_GROUPS are
 * available offline. It is used solely to expand a CIF that names a space
 * group but ships no `_symmetry_equiv_pos_as_xyz` loop. A CIF that carries
 * its own operations never consults this table, whatever its group.
 */

export interface SpaceGroupData {
  number: number
  symbol: string
  hallSymbol?: string
  crystalSystem: string
  operations: string[]
}

/**
 * Parse a space group symbol to get the space group number
 * Handles various formats: "Fd-3m", "F d -3 m", "227", etc.
 */
export function parseSpaceGroupSymbol(symbol: string): number | null {
  const trimmed = symbol.trim()
  
  // Check if it's a number
  const num = parseInt(trimmed)
  if (!isNaN(num) && num >= 1 && num <= 230) {
    return num
  }
  
  // Normalize the symbol: remove spaces, convert to standard form
  const normalized = trimmed.replace(/\s+/g, '').toLowerCase()
  
  // Look up in the map
  for (const [sgNum, data] of Object.entries(SPACE_GROUPS)) {
    const dataSymbol = data.symbol.replace(/\s+/g, '').toLowerCase()
    if (dataSymbol === normalized) {
      return parseInt(sgNum)
    }
    // Also check Hall symbol if present
    if (data.hallSymbol) {
      const hallNorm = data.hallSymbol.replace(/\s+/g, '').toLowerCase()
      if (hallNorm === normalized) {
        return parseInt(sgNum)
      }
    }
  }
  
  // Common alternative notations
  const alternatives: Record<string, number> = {
    'fd-3m': 227,
    'fd3m': 227,
    'fm-3m': 225,
    'fm3m': 225,
    'pm-3m': 221,
    'pm3m': 221,
    'p63/mmc': 194,
    'p6_3/mmc': 194,
    'i4/mmm': 139,
    'r-3m': 166,
    'r3m': 160,
    'pnma': 62,
    'p21/c': 14,
    'p-1': 2,
    'c2/m': 12,
    'c2/c': 15,
    'pbca': 61,
    'cmcm': 63,
    'i-43m': 217,
    'f-43m': 216,
    'p-43m': 215,
  }
  
  if (alternatives[normalized]) {
    return alternatives[normalized]
  }
  
  return null
}

/**
 * Symmetry operations for a space group, or null when the group is not in the
 * table. Callers must not substitute identity: an asymmetric unit expanded
 * with identity alone renders fine and is silently wrong.
 */
export function getSpaceGroupOperations(spaceGroupNumber: number): string[] | null {
  return SPACE_GROUPS[spaceGroupNumber]?.operations ?? null
}

/** Space group numbers whose operations are available offline, ascending. */
export function listBuiltInSpaceGroups(): number[] {
  return Object.keys(SPACE_GROUPS).map(Number).sort((a, b) => a - b)
}

/**
 * Space group database
 * Key: space group number (1-230)
 * Value: space group data including symmetry operations
 * 
 * Partial: the groups most often written without an explicit symop loop.
 * Adding a group means adding its full operation list here; nothing is
 * generated at runtime.
 */
export const SPACE_GROUPS: Record<number, SpaceGroupData> = {
  // Triclinic
  1: {
    number: 1,
    symbol: 'P1',
    crystalSystem: 'triclinic',
    operations: ['x,y,z']
  },
  2: {
    number: 2,
    symbol: 'P-1',
    crystalSystem: 'triclinic',
    operations: ['x,y,z', '-x,-y,-z']
  },
  
  // Monoclinic
  14: {
    number: 14,
    symbol: 'P21/c',
    crystalSystem: 'monoclinic',
    operations: [
      'x,y,z',
      '-x,y+1/2,-z+1/2',
      '-x,-y,-z',
      'x,-y+1/2,z+1/2'
    ]
  },
  15: {
    number: 15,
    symbol: 'C2/c',
    crystalSystem: 'monoclinic',
    operations: [
      'x,y,z',
      '-x,y,-z+1/2',
      '-x,-y,-z',
      'x,-y,z+1/2',
      'x+1/2,y+1/2,z',
      '-x+1/2,y+1/2,-z+1/2',
      '-x+1/2,-y+1/2,-z',
      'x+1/2,-y+1/2,z+1/2'
    ]
  },
  
  // Orthorhombic
  62: {
    number: 62,
    symbol: 'Pnma',
    crystalSystem: 'orthorhombic',
    operations: [
      'x,y,z',
      '-x+1/2,-y,z+1/2',
      '-x,y+1/2,-z',
      'x+1/2,-y+1/2,-z+1/2',
      '-x,-y,-z',
      'x+1/2,y,-z+1/2',
      'x,-y+1/2,z',
      '-x+1/2,y+1/2,z+1/2'
    ]
  },
  
  // Tetragonal
  139: {
    number: 139,
    symbol: 'I4/mmm',
    crystalSystem: 'tetragonal',
    operations: [
      'x,y,z', '-x,-y,z', '-y,x,z', 'y,-x,z',
      '-x,y,-z', 'x,-y,-z', 'y,x,-z', '-y,-x,-z',
      '-x,-y,-z', 'x,y,-z', 'y,-x,-z', '-y,x,-z',
      'x,-y,z', '-x,y,z', '-y,-x,z', 'y,x,z',
      'x+1/2,y+1/2,z+1/2', '-x+1/2,-y+1/2,z+1/2', '-y+1/2,x+1/2,z+1/2', 'y+1/2,-x+1/2,z+1/2',
      '-x+1/2,y+1/2,-z+1/2', 'x+1/2,-y+1/2,-z+1/2', 'y+1/2,x+1/2,-z+1/2', '-y+1/2,-x+1/2,-z+1/2',
      '-x+1/2,-y+1/2,-z+1/2', 'x+1/2,y+1/2,-z+1/2', 'y+1/2,-x+1/2,-z+1/2', '-y+1/2,x+1/2,-z+1/2',
      'x+1/2,-y+1/2,z+1/2', '-x+1/2,y+1/2,z+1/2', '-y+1/2,-x+1/2,z+1/2', 'y+1/2,x+1/2,z+1/2'
    ]
  },
  
  // Trigonal/Rhombohedral
  166: {
    number: 166,
    symbol: 'R-3m',
    crystalSystem: 'trigonal',
    operations: [
      'x,y,z', '-y,x-y,z', '-x+y,-x,z',
      'y,x,-z', 'x-y,-y,-z', '-x,-x+y,-z',
      '-x,-y,-z', 'y,-x+y,-z', 'x-y,x,-z',
      '-y,-x,z', '-x+y,y,z', 'x,x-y,z',
      'x+2/3,y+1/3,z+1/3', '-y+2/3,x-y+1/3,z+1/3', '-x+y+2/3,-x+1/3,z+1/3',
      'y+2/3,x+1/3,-z+1/3', 'x-y+2/3,-y+1/3,-z+1/3', '-x+2/3,-x+y+1/3,-z+1/3',
      '-x+2/3,-y+1/3,-z+1/3', 'y+2/3,-x+y+1/3,-z+1/3', 'x-y+2/3,x+1/3,-z+1/3',
      '-y+2/3,-x+1/3,z+1/3', '-x+y+2/3,y+1/3,z+1/3', 'x+2/3,x-y+1/3,z+1/3',
      'x+1/3,y+2/3,z+2/3', '-y+1/3,x-y+2/3,z+2/3', '-x+y+1/3,-x+2/3,z+2/3',
      'y+1/3,x+2/3,-z+2/3', 'x-y+1/3,-y+2/3,-z+2/3', '-x+1/3,-x+y+2/3,-z+2/3',
      '-x+1/3,-y+2/3,-z+2/3', 'y+1/3,-x+y+2/3,-z+2/3', 'x-y+1/3,x+2/3,-z+2/3',
      '-y+1/3,-x+2/3,z+2/3', '-x+y+1/3,y+2/3,z+2/3', 'x+1/3,x-y+2/3,z+2/3'
    ]
  },
  
  // Hexagonal
  194: {
    number: 194,
    symbol: 'P63/mmc',
    crystalSystem: 'hexagonal',
    operations: [
      'x,y,z', '-y,x-y,z', '-x+y,-x,z',
      '-x,-y,z+1/2', 'y,-x+y,z+1/2', 'x-y,x,z+1/2',
      'y,x,-z', 'x-y,-y,-z', '-x,-x+y,-z',
      '-y,-x,-z+1/2', '-x+y,y,-z+1/2', 'x,x-y,-z+1/2',
      '-x,-y,-z', 'y,-x+y,-z', 'x-y,x,-z',
      'x,y,-z+1/2', '-y,x-y,-z+1/2', '-x+y,-x,-z+1/2',
      '-y,-x,z', '-x+y,y,z', 'x,x-y,z',
      'y,x,z+1/2', 'x-y,-y,z+1/2', '-x,-x+y,z+1/2'
    ]
  },
  
  // Cubic - FCC
  225: {
    number: 225,
    symbol: 'Fm-3m',
    crystalSystem: 'cubic',
    operations: [
      'x,y,z', '-x,-y,z', '-x,y,-z', 'x,-y,-z',
      'z,x,y', 'z,-x,-y', '-z,-x,y', '-z,x,-y',
      'y,z,x', '-y,z,-x', 'y,-z,-x', '-y,-z,x',
      'y,x,-z', '-y,-x,-z', 'y,-x,z', '-y,x,z',
      'x,z,-y', '-x,z,y', '-x,-z,-y', 'x,-z,y',
      'z,y,-x', 'z,-y,x', '-z,y,x', '-z,-y,-x',
      '-x,-y,-z', 'x,y,-z', 'x,-y,z', '-x,y,z',
      '-z,-x,-y', '-z,x,y', 'z,x,-y', 'z,-x,y',
      '-y,-z,-x', 'y,-z,x', '-y,z,x', 'y,z,-x',
      '-y,-x,z', 'y,x,z', '-y,x,-z', 'y,-x,-z',
      '-x,-z,y', 'x,-z,-y', 'x,z,y', '-x,z,-y',
      '-z,-y,x', '-z,y,-x', 'z,-y,-x', 'z,y,x',
      'x,y+1/2,z+1/2', '-x,-y+1/2,z+1/2', '-x,y+1/2,-z+1/2', 'x,-y+1/2,-z+1/2',
      'z,x+1/2,y+1/2', 'z,-x+1/2,-y+1/2', '-z,-x+1/2,y+1/2', '-z,x+1/2,-y+1/2',
      'y,z+1/2,x+1/2', '-y,z+1/2,-x+1/2', 'y,-z+1/2,-x+1/2', '-y,-z+1/2,x+1/2',
      'y,x+1/2,-z+1/2', '-y,-x+1/2,-z+1/2', 'y,-x+1/2,z+1/2', '-y,x+1/2,z+1/2',
      'x,z+1/2,-y+1/2', '-x,z+1/2,y+1/2', '-x,-z+1/2,-y+1/2', 'x,-z+1/2,y+1/2',
      'z,y+1/2,-x+1/2', 'z,-y+1/2,x+1/2', '-z,y+1/2,x+1/2', '-z,-y+1/2,-x+1/2',
      '-x,-y+1/2,-z+1/2', 'x,y+1/2,-z+1/2', 'x,-y+1/2,z+1/2', '-x,y+1/2,z+1/2',
      '-z,-x+1/2,-y+1/2', '-z,x+1/2,y+1/2', 'z,x+1/2,-y+1/2', 'z,-x+1/2,y+1/2',
      '-y,-z+1/2,-x+1/2', 'y,-z+1/2,x+1/2', '-y,z+1/2,x+1/2', 'y,z+1/2,-x+1/2',
      '-y,-x+1/2,z+1/2', 'y,x+1/2,z+1/2', '-y,x+1/2,-z+1/2', 'y,-x+1/2,-z+1/2',
      '-x,-z+1/2,y+1/2', 'x,-z+1/2,-y+1/2', 'x,z+1/2,y+1/2', '-x,z+1/2,-y+1/2',
      '-z,-y+1/2,x+1/2', '-z,y+1/2,-x+1/2', 'z,-y+1/2,-x+1/2', 'z,y+1/2,x+1/2',
      'x+1/2,y,z+1/2', '-x+1/2,-y,z+1/2', '-x+1/2,y,-z+1/2', 'x+1/2,-y,-z+1/2',
      'z+1/2,x,y+1/2', 'z+1/2,-x,-y+1/2', '-z+1/2,-x,y+1/2', '-z+1/2,x,-y+1/2',
      'y+1/2,z,x+1/2', '-y+1/2,z,-x+1/2', 'y+1/2,-z,-x+1/2', '-y+1/2,-z,x+1/2',
      'y+1/2,x,-z+1/2', '-y+1/2,-x,-z+1/2', 'y+1/2,-x,z+1/2', '-y+1/2,x,z+1/2',
      'x+1/2,z,-y+1/2', '-x+1/2,z,y+1/2', '-x+1/2,-z,-y+1/2', 'x+1/2,-z,y+1/2',
      'z+1/2,y,-x+1/2', 'z+1/2,-y,x+1/2', '-z+1/2,y,x+1/2', '-z+1/2,-y,-x+1/2',
      '-x+1/2,-y,-z+1/2', 'x+1/2,y,-z+1/2', 'x+1/2,-y,z+1/2', '-x+1/2,y,z+1/2',
      '-z+1/2,-x,-y+1/2', '-z+1/2,x,y+1/2', 'z+1/2,x,-y+1/2', 'z+1/2,-x,y+1/2',
      '-y+1/2,-z,-x+1/2', 'y+1/2,-z,x+1/2', '-y+1/2,z,x+1/2', 'y+1/2,z,-x+1/2',
      '-y+1/2,-x,z+1/2', 'y+1/2,x,z+1/2', '-y+1/2,x,-z+1/2', 'y+1/2,-x,-z+1/2',
      '-x+1/2,-z,y+1/2', 'x+1/2,-z,-y+1/2', 'x+1/2,z,y+1/2', '-x+1/2,z,-y+1/2',
      '-z+1/2,-y,x+1/2', '-z+1/2,y,-x+1/2', 'z+1/2,-y,-x+1/2', 'z+1/2,y,x+1/2',
      'x+1/2,y+1/2,z', '-x+1/2,-y+1/2,z', '-x+1/2,y+1/2,-z', 'x+1/2,-y+1/2,-z',
      'z+1/2,x+1/2,y', 'z+1/2,-x+1/2,-y', '-z+1/2,-x+1/2,y', '-z+1/2,x+1/2,-y',
      'y+1/2,z+1/2,x', '-y+1/2,z+1/2,-x', 'y+1/2,-z+1/2,-x', '-y+1/2,-z+1/2,x',
      'y+1/2,x+1/2,-z', '-y+1/2,-x+1/2,-z', 'y+1/2,-x+1/2,z', '-y+1/2,x+1/2,z',
      'x+1/2,z+1/2,-y', '-x+1/2,z+1/2,y', '-x+1/2,-z+1/2,-y', 'x+1/2,-z+1/2,y',
      'z+1/2,y+1/2,-x', 'z+1/2,-y+1/2,x', '-z+1/2,y+1/2,x', '-z+1/2,-y+1/2,-x',
      '-x+1/2,-y+1/2,-z', 'x+1/2,y+1/2,-z', 'x+1/2,-y+1/2,z', '-x+1/2,y+1/2,z',
      '-z+1/2,-x+1/2,-y', '-z+1/2,x+1/2,y', 'z+1/2,x+1/2,-y', 'z+1/2,-x+1/2,y',
      '-y+1/2,-z+1/2,-x', 'y+1/2,-z+1/2,x', '-y+1/2,z+1/2,x', 'y+1/2,z+1/2,-x',
      '-y+1/2,-x+1/2,z', 'y+1/2,x+1/2,z', '-y+1/2,x+1/2,-z', 'y+1/2,-x+1/2,-z',
      '-x+1/2,-z+1/2,y', 'x+1/2,-z+1/2,-y', 'x+1/2,z+1/2,y', '-x+1/2,z+1/2,-y',
      '-z+1/2,-y+1/2,x', '-z+1/2,y+1/2,-x', 'z+1/2,-y+1/2,-x', 'z+1/2,y+1/2,x'
    ]
  },
  
  // Cubic - Diamond (Fd-3m) - Silicon, Diamond, Germanium
  227: {
    number: 227,
    symbol: 'Fd-3m',
    crystalSystem: 'cubic',
    operations: [
      // 48 operations for origin choice 2 (at -3m)
      'x,y,z', '-x+1/4,-y+1/4,z', '-x+1/4,y,-z+1/4', 'x,-y+1/4,-z+1/4',
      'z,x,y', 'z,-x+1/4,-y+1/4', '-z+1/4,-x+1/4,y', '-z+1/4,x,-y+1/4',
      'y,z,x', '-y+1/4,z,-x+1/4', 'y,-z+1/4,-x+1/4', '-y+1/4,-z+1/4,x',
      'y+3/4,x+1/4,-z+1/2', '-y,x+1/4,z+1/4', 'y+3/4,-x,z+1/4', '-y,-x,-z',
      'x+3/4,z+1/4,-y+1/2', 'x+3/4,-z,y+1/4', '-x,z+1/4,y+1/4', '-x,-z,-y',
      'z+3/4,y+1/4,-x+1/2', '-z,y+1/4,x+1/4', '-z,-y,-x', 'z+3/4,-y,x+1/4',
      '-x,-y,-z', 'x+3/4,y+3/4,-z', 'x+3/4,-y,z+3/4', '-x,y+3/4,z+3/4',
      '-z,-x,-y', '-z,x+3/4,y+3/4', 'z+3/4,x+3/4,-y', 'z+3/4,-x,y+3/4',
      '-y,-z,-x', 'y+3/4,-z,x+3/4', '-y,z+3/4,x+3/4', 'y+3/4,z+3/4,-x',
      '-y+1/4,-x+3/4,z+1/2', 'y,-x+3/4,-z+3/4', '-y+1/4,x,-z+3/4', 'y,x,z',
      '-x+1/4,-z+3/4,y+1/2', '-x+1/4,z,-y+3/4', 'x,-z+3/4,-y+3/4', 'x,z,y',
      '-z+1/4,-y+3/4,x+1/2', 'z,-y+3/4,-x+3/4', 'z,y,x', '-z+1/4,y,-x+3/4',
      // Face-centered translations
      'x,y+1/2,z+1/2', '-x+1/4,-y+3/4,z+1/2', '-x+1/4,y+1/2,-z+3/4', 'x,-y+3/4,-z+3/4',
      'z,x+1/2,y+1/2', 'z,-x+3/4,-y+3/4', '-z+1/4,-x+3/4,y+1/2', '-z+1/4,x+1/2,-y+3/4',
      'y,z+1/2,x+1/2', '-y+1/4,z+1/2,-x+3/4', 'y,-z+3/4,-x+3/4', '-y+1/4,-z+3/4,x+1/2',
      'y+3/4,x+3/4,-z', '-y,x+3/4,z+3/4', 'y+3/4,-x+1/2,z+3/4', '-y,-x+1/2,-z+1/2',
      'x+3/4,z+3/4,-y', 'x+3/4,-z+1/2,y+3/4', '-x,z+3/4,y+3/4', '-x,-z+1/2,-y+1/2',
      'z+3/4,y+3/4,-x', '-z,y+3/4,x+3/4', '-z,-y+1/2,-x+1/2', 'z+3/4,-y+1/2,x+3/4',
      '-x,-y+1/2,-z+1/2', 'x+3/4,y+1/4,-z+1/2', 'x+3/4,-y+1/2,z+1/4', '-x,y+1/4,z+1/4',
      '-z,-x+1/2,-y+1/2', '-z,x+1/4,y+1/4', 'z+3/4,x+1/4,-y+1/2', 'z+3/4,-x+1/2,y+1/4',
      '-y,-z+1/2,-x+1/2', 'y+3/4,-z+1/2,x+1/4', '-y,z+1/4,x+1/4', 'y+3/4,z+1/4,-x+1/2',
      '-y+1/4,-x+1/4,z', 'y,-x+1/4,-z+1/4', '-y+1/4,x+1/2,-z+1/4', 'y,x+1/2,z+1/2',
      '-x+1/4,-z+1/4,y', '-x+1/4,z+1/2,-y+1/4', 'x,-z+1/4,-y+1/4', 'x,z+1/2,y+1/2',
      '-z+1/4,-y+1/4,x', 'z,-y+1/4,-x+1/4', 'z,y+1/2,x+1/2', '-z+1/4,y+1/2,-x+1/4',
      'x+1/2,y,z+1/2', '-x+3/4,-y+1/4,z+1/2', '-x+3/4,y,-z+3/4', 'x+1/2,-y+1/4,-z+3/4',
      'z+1/2,x,y+1/2', 'z+1/2,-x+1/4,-y+3/4', '-z+3/4,-x+1/4,y+1/2', '-z+3/4,x,-y+3/4',
      'y+1/2,z,x+1/2', '-y+3/4,z,-x+3/4', 'y+1/2,-z+1/4,-x+3/4', '-y+3/4,-z+1/4,x+1/2',
      'y+1/4,x+1/4,-z', '-y+1/2,x+1/4,z+3/4', 'y+1/4,-x,z+3/4', '-y+1/2,-x,-z+1/2',
      'x+1/4,z+1/4,-y', 'x+1/4,-z,y+3/4', '-x+1/2,z+1/4,y+3/4', '-x+1/2,-z,-y+1/2',
      'z+1/4,y+1/4,-x', '-z+1/2,y+1/4,x+3/4', '-z+1/2,-y,-x+1/2', 'z+1/4,-y,x+3/4',
      '-x+1/2,-y,-z+1/2', 'x+1/4,y+3/4,-z+1/2', 'x+1/4,-y,z+1/4', '-x+1/2,y+3/4,z+1/4',
      '-z+1/2,-x,-y+1/2', '-z+1/2,x+3/4,y+1/4', 'z+1/4,x+3/4,-y+1/2', 'z+1/4,-x,y+1/4',
      '-y+1/2,-z,-x+1/2', 'y+1/4,-z,x+1/4', '-y+1/2,z+3/4,x+1/4', 'y+1/4,z+3/4,-x+1/2',
      '-y+3/4,-x+3/4,z', 'y+1/2,-x+3/4,-z+1/4', '-y+3/4,x,-z+1/4', 'y+1/2,x,z+1/2',
      '-x+3/4,-z+3/4,y', '-x+3/4,z,-y+1/4', 'x+1/2,-z+3/4,-y+1/4', 'x+1/2,z,y+1/2',
      '-z+3/4,-y+3/4,x', 'z+1/2,-y+3/4,-x+1/4', 'z+1/2,y,x+1/2', '-z+3/4,y,-x+1/4',
      'x+1/2,y+1/2,z', '-x+3/4,-y+3/4,z', '-x+3/4,y+1/2,-z+1/4', 'x+1/2,-y+3/4,-z+1/4',
      'z+1/2,x+1/2,y', 'z+1/2,-x+3/4,-y+1/4', '-z+3/4,-x+3/4,y', '-z+3/4,x+1/2,-y+1/4',
      'y+1/2,z+1/2,x', '-y+3/4,z+1/2,-x+1/4', 'y+1/2,-z+3/4,-x+1/4', '-y+3/4,-z+3/4,x',
      'y+1/4,x+3/4,-z+1/2', '-y+1/2,x+3/4,z+1/4', 'y+1/4,-x+1/2,z+1/4', '-y+1/2,-x+1/2,-z',
      'x+1/4,z+3/4,-y+1/2', 'x+1/4,-z+1/2,y+1/4', '-x+1/2,z+3/4,y+1/4', '-x+1/2,-z+1/2,-y',
      'z+1/4,y+3/4,-x+1/2', '-z+1/2,y+3/4,x+1/4', '-z+1/2,-y+1/2,-x', 'z+1/4,-y+1/2,x+1/4',
      '-x+1/2,-y+1/2,-z', 'x+1/4,y+1/4,-z', 'x+1/4,-y+1/2,z+3/4', '-x+1/2,y+1/4,z+3/4',
      '-z+1/2,-x+1/2,-y', '-z+1/2,x+1/4,y+3/4', 'z+1/4,x+1/4,-y', 'z+1/4,-x+1/2,y+3/4',
      '-y+1/2,-z+1/2,-x', 'y+1/4,-z+1/2,x+3/4', '-y+1/2,z+1/4,x+3/4', 'y+1/4,z+1/4,-x',
      '-y+3/4,-x+1/4,z+1/2', 'y+1/2,-x+1/4,-z+3/4', '-y+3/4,x+1/2,-z+3/4', 'y+1/2,x+1/2,z',
      '-x+3/4,-z+1/4,y+1/2', '-x+3/4,z+1/2,-y+3/4', 'x+1/2,-z+1/4,-y+3/4', 'x+1/2,z+1/2,y',
      '-z+3/4,-y+1/4,x+1/2', 'z+1/2,-y+1/4,-x+3/4', 'z+1/2,y+1/2,x', '-z+3/4,y+1/2,-x+3/4'
    ]
  },
  
  // Cubic - BCC
  229: {
    number: 229,
    symbol: 'Im-3m',
    crystalSystem: 'cubic',
    operations: [
      'x,y,z', '-x,-y,z', '-x,y,-z', 'x,-y,-z',
      'z,x,y', 'z,-x,-y', '-z,-x,y', '-z,x,-y',
      'y,z,x', '-y,z,-x', 'y,-z,-x', '-y,-z,x',
      'y,x,-z', '-y,-x,-z', 'y,-x,z', '-y,x,z',
      'x,z,-y', '-x,z,y', '-x,-z,-y', 'x,-z,y',
      'z,y,-x', 'z,-y,x', '-z,y,x', '-z,-y,-x',
      '-x,-y,-z', 'x,y,-z', 'x,-y,z', '-x,y,z',
      '-z,-x,-y', '-z,x,y', 'z,x,-y', 'z,-x,y',
      '-y,-z,-x', 'y,-z,x', '-y,z,x', 'y,z,-x',
      '-y,-x,z', 'y,x,z', '-y,x,-z', 'y,-x,-z',
      '-x,-z,y', 'x,-z,-y', 'x,z,y', '-x,z,-y',
      '-z,-y,x', '-z,y,-x', 'z,-y,-x', 'z,y,x',
      'x+1/2,y+1/2,z+1/2', '-x+1/2,-y+1/2,z+1/2', '-x+1/2,y+1/2,-z+1/2', 'x+1/2,-y+1/2,-z+1/2',
      'z+1/2,x+1/2,y+1/2', 'z+1/2,-x+1/2,-y+1/2', '-z+1/2,-x+1/2,y+1/2', '-z+1/2,x+1/2,-y+1/2',
      'y+1/2,z+1/2,x+1/2', '-y+1/2,z+1/2,-x+1/2', 'y+1/2,-z+1/2,-x+1/2', '-y+1/2,-z+1/2,x+1/2',
      'y+1/2,x+1/2,-z+1/2', '-y+1/2,-x+1/2,-z+1/2', 'y+1/2,-x+1/2,z+1/2', '-y+1/2,x+1/2,z+1/2',
      'x+1/2,z+1/2,-y+1/2', '-x+1/2,z+1/2,y+1/2', '-x+1/2,-z+1/2,-y+1/2', 'x+1/2,-z+1/2,y+1/2',
      'z+1/2,y+1/2,-x+1/2', 'z+1/2,-y+1/2,x+1/2', '-z+1/2,y+1/2,x+1/2', '-z+1/2,-y+1/2,-x+1/2',
      '-x+1/2,-y+1/2,-z+1/2', 'x+1/2,y+1/2,-z+1/2', 'x+1/2,-y+1/2,z+1/2', '-x+1/2,y+1/2,z+1/2',
      '-z+1/2,-x+1/2,-y+1/2', '-z+1/2,x+1/2,y+1/2', 'z+1/2,x+1/2,-y+1/2', 'z+1/2,-x+1/2,y+1/2',
      '-y+1/2,-z+1/2,-x+1/2', 'y+1/2,-z+1/2,x+1/2', '-y+1/2,z+1/2,x+1/2', 'y+1/2,z+1/2,-x+1/2',
      '-y+1/2,-x+1/2,z+1/2', 'y+1/2,x+1/2,z+1/2', '-y+1/2,x+1/2,-z+1/2', 'y+1/2,-x+1/2,-z+1/2',
      '-x+1/2,-z+1/2,y+1/2', 'x+1/2,-z+1/2,-y+1/2', 'x+1/2,z+1/2,y+1/2', '-x+1/2,z+1/2,-y+1/2',
      '-z+1/2,-y+1/2,x+1/2', '-z+1/2,y+1/2,-x+1/2', 'z+1/2,-y+1/2,-x+1/2', 'z+1/2,y+1/2,x+1/2'
    ]
  },
  
  // Cubic - Simple cubic
  221: {
    number: 221,
    symbol: 'Pm-3m',
    crystalSystem: 'cubic',
    operations: [
      'x,y,z', '-x,-y,z', '-x,y,-z', 'x,-y,-z',
      'z,x,y', 'z,-x,-y', '-z,-x,y', '-z,x,-y',
      'y,z,x', '-y,z,-x', 'y,-z,-x', '-y,-z,x',
      'y,x,-z', '-y,-x,-z', 'y,-x,z', '-y,x,z',
      'x,z,-y', '-x,z,y', '-x,-z,-y', 'x,-z,y',
      'z,y,-x', 'z,-y,x', '-z,y,x', '-z,-y,-x',
      '-x,-y,-z', 'x,y,-z', 'x,-y,z', '-x,y,z',
      '-z,-x,-y', '-z,x,y', 'z,x,-y', 'z,-x,y',
      '-y,-z,-x', 'y,-z,x', '-y,z,x', 'y,z,-x',
      '-y,-x,z', 'y,x,z', '-y,x,-z', 'y,-x,-z',
      '-x,-z,y', 'x,-z,-y', 'x,z,y', '-x,z,-y',
      '-z,-y,x', '-z,y,-x', 'z,-y,-x', 'z,y,x'
    ]
  },
}
