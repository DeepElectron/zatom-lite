/**
 * CIF (Crystallographic Information File) Parser
 * Parses CIF 1.1 format files to extract crystal structure data
 */

import type { CrystalSystem, LatticeParams, CenteringType } from './types'
import { parseSpaceGroupSymbol, getSpaceGroupOperations } from './spacegroup-data'
import { wrapFractional } from './lattice'

export interface ParsedCIFAtom {
  id?: string
  element: string
  /**
   * Fractional coordinates [fx, fy, fz].
   */
  position: [number, number, number]
  /**
   * Cartesian coordinates [x, y, z].
   */
  cartesian: [number, number, number]
  occupancy?: number
  /** Original asymmetric-unit row index, preserved through symmetry expansion. */
  siteIndex?: number
}

/**
 * Extract centering type from space group symbol
 * P = Primitive, F = Face-centered, I = Body-centered, C/A/B = Base-centered, R = Rhombohedral
 */
export function extractCenteringType(spaceGroupSymbol: string | undefined | null): CenteringType | undefined {
  if (!spaceGroupSymbol) return undefined
  
  // Clean up the symbol
  const cleaned = spaceGroupSymbol.trim().replace(/['"]/g, '')
  
  // Check for explicit rhombohedral notation (R-3m, R3m, etc.)
  if (/^R[\s-]?[0-9-]/i.test(cleaned)) {
    return 'R'
  }
  
  // First character of H-M symbol is typically the centering type
  const firstChar = cleaned.charAt(0).toUpperCase()
  
  switch (firstChar) {
    case 'P': return 'P'
    case 'F': return 'F'
    case 'I': return 'I'
    case 'C': return 'C'
    case 'A': return 'A'
    case 'B': return 'C' // B-centered treated as C-centered
    case 'R': return 'R'
    default: return undefined
  }
}

export interface SymmetryOperation {
  /** Original string like 'x, y, z' or '-x+1/2, y, -z+1/4' */
  raw: string
  /** Transformation function */
  transform: (fx: number, fy: number, fz: number) => { fx: number; fy: number; fz: number }
}

export interface CIFParseResult {
  name: string
  latticeParams: LatticeParams
  crystalSystem: CrystalSystem
  atoms: ParsedCIFAtom[]
  spaceGroup?: string
  spaceGroupNumber?: number
  centeringType?: CenteringType
  chemicalFormula?: string
  symmetryOperations?: SymmetryOperation[]
}

export interface CIFParseError {
  type: 'parse_error' | 'missing_data' | 'invalid_format' | 'unsupported_symmetry'
  message: string
  line?: number
}

/** P1 needs no expansion: identity is the whole group. */
function isP1Symbol(raw: string): boolean {
  const normalized = raw.trim().replace(/\s+/g, '').toLowerCase()
  return normalized === 'p1' || normalized === '1'
}

/**
 * Parse a CIF file content string into crystal structure data
 */
export function parseCIF(content: string): { success: true; data: CIFParseResult } | { success: false; error: CIFParseError } {
  try {
    const lines = content.split(/\r?\n/)
    
    // Extract data block name
    let name = 'Imported Crystal'
    const dataBlockMatch = content.match(/^data_(.+)$/m)
    if (dataBlockMatch) {
      name = dataBlockMatch[1].replace(/_/g, ' ').trim()
    }
    
    // Parse lattice parameters
    const latticeParams = parseLatticeParams(lines)
    if (!latticeParams) {
      return {
        success: false,
        error: { type: 'missing_data', message: 'Could not find lattice parameters (_cell_length_a, _cell_length_b, _cell_length_c)' }
      }
    }
    
    // Detect crystal system from lattice parameters
    const crystalSystem = detectCrystalSystem(latticeParams)
    
    // Parse space group info first (needed for symmetry operations fallback)
    const spaceGroupRaw = parseTag(lines, '_symmetry_space_group_name_H-M') || 
                          parseTag(lines, '_space_group_name_H-M_alt') ||
                          parseTag(lines, '_symmetry_Int_Tables_number')
    
    // Try to get space group number
    const spaceGroupNumber = spaceGroupRaw ? parseSpaceGroupSymbol(spaceGroupRaw) : null
    
    // Extract centering type from space group symbol
    const centeringType = extractCenteringType(spaceGroupRaw)
    
    // Operations shipped in the file always win.
    let symmetryOperations = parseSymmetryOperations(lines)

    // No usable symop loop: the file relies on its space group to expand the
    // asymmetric unit. Either we can do that from the built-in table, or we
    // must refuse. Importing only the asymmetric unit would produce a cell that
    // looks complete and is wrong.
    if (symmetryOperations.length <= 1 && spaceGroupRaw && !isP1Symbol(spaceGroupRaw)) {
      const dbOps = spaceGroupNumber ? getSpaceGroupOperations(spaceGroupNumber) : null
      if (!dbOps) {
        return {
          success: false,
          error: {
            type: 'unsupported_symmetry',
            message: spaceGroupNumber
              ? `Space group ${spaceGroupRaw} (No. ${spaceGroupNumber}) is not in the built-in symmetry table and the file has no _symmetry_equiv_pos_as_xyz loop. Re-export the CIF with symmetry operations (most tools do by default), or as P1 with the full cell.`
              : `Space group symbol "${spaceGroupRaw}" is not recognised and the file has no _symmetry_equiv_pos_as_xyz loop, so the asymmetric unit cannot be expanded. Re-export the CIF with symmetry operations, or as P1 with the full cell.`,
          },
        }
      }
      symmetryOperations = dbOps
        .map((opStr) => parseSymmetryString(opStr))
        .filter((op): op is SymmetryOperation => op !== null)
    }
    
    // Parse atom positions (asymmetric unit)
    const asymmetricAtoms = parseAtomSites(lines, latticeParams)
    
    // Apply symmetry operations to generate all atoms
    const atoms = applySymmetryOperations(asymmetricAtoms, symmetryOperations, latticeParams)
    
    // Parse optional metadata
    const chemicalFormula = parseTag(lines, '_chemical_formula_sum') ||
                           parseTag(lines, '_chemical_formula_structural')
    
    return {
      success: true,
      data: {
        name,
        latticeParams,
        crystalSystem,
        atoms,
        spaceGroup: spaceGroupRaw || undefined,
        spaceGroupNumber: spaceGroupNumber || undefined,
        centeringType,
        chemicalFormula: chemicalFormula || undefined,
        symmetryOperations: symmetryOperations.length > 0 ? symmetryOperations : undefined,
      }
    }
  } catch (err) {
    return {
      success: false,
      error: { 
        type: 'parse_error', 
        message: err instanceof Error ? err.message : 'Unknown parsing error' 
      }
    }
  }
}

/**
 * Parse a simple CIF tag value
 */
function parseTag(lines: string[], tag: string): string | null {
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith(tag.toLowerCase())) {
      const value = trimmed.substring(tag.length).trim()
      // Remove quotes if present
      if ((value.startsWith("'") && value.endsWith("'")) || 
          (value.startsWith('"') && value.endsWith('"'))) {
        return value.slice(1, -1)
      }
      return value || null
    }
  }
  return null
}

/**
 * Parse a numeric CIF tag value (handles uncertainty notation like "5.123(4)")
 */
function parseNumericTag(lines: string[], tag: string): number | null {
  const value = parseTag(lines, tag)
  if (!value) return null
  // Remove uncertainty in parentheses: "5.123(4)" -> "5.123"
  const cleaned = value.replace(/\([^)]*\)/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Parse lattice parameters from CIF
 */
function parseLatticeParams(lines: string[]): LatticeParams | null {
  const a = parseNumericTag(lines, '_cell_length_a')
  const b = parseNumericTag(lines, '_cell_length_b')
  const c = parseNumericTag(lines, '_cell_length_c')
  const alpha = parseNumericTag(lines, '_cell_angle_alpha') ?? 90
  const beta = parseNumericTag(lines, '_cell_angle_beta') ?? 90
  const gamma = parseNumericTag(lines, '_cell_angle_gamma') ?? 90
  
  if (a === null || b === null || c === null) {
    return null
  }
  
  return { a, b, c, alpha, beta, gamma }
}

/**
 * Detect crystal system from lattice parameters
 * Uses relative tolerance for length comparisons and absolute tolerance for angles
 */
function detectCrystalSystem(params: LatticeParams): CrystalSystem {
  const { a, b, c, alpha, beta, gamma } = params
  
  // Use relative tolerance (1%) for lengths and absolute tolerance (0.5 degrees) for angles
  const relTol = 0.01
  const angTol = 0.5
  
  const eqLen = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y, 0.001) < relTol
  const eqAng = (x: number, y: number) => Math.abs(x - y) < angTol
  const is90 = (x: number) => Math.abs(x - 90) < angTol
  const is120 = (x: number) => Math.abs(x - 120) < angTol
  
  // Cubic: a = b = c, alpha = beta = gamma = 90
  if (eqLen(a, b) && eqLen(b, c) && is90(alpha) && is90(beta) && is90(gamma)) {
    return 'cubic'
  }
  
  // Hexagonal: a = b != c, alpha = beta = 90, gamma = 120
  // Note: Trigonal space groups (like R-3m) in hexagonal setting also have this metric
  if (eqLen(a, b) && !eqLen(a, c) && is90(alpha) && is90(beta) && is120(gamma)) {
    return 'hexagonal'
  }
  
  // Trigonal (rhombohedral setting): a = b = c, alpha = beta = gamma != 90
  if (eqLen(a, b) && eqLen(b, c) && eqAng(alpha, beta) && eqAng(beta, gamma) && !is90(alpha)) {
    return 'trigonal'
  }
  
  // Tetragonal: a = b != c, alpha = beta = gamma = 90
  if (eqLen(a, b) && !eqLen(a, c) && is90(alpha) && is90(beta) && is90(gamma)) {
    return 'tetragonal'
  }
  
  // Orthorhombic: a != b != c, alpha = beta = gamma = 90
  if (!eqLen(a, b) && !eqLen(b, c) && is90(alpha) && is90(beta) && is90(gamma)) {
    return 'orthorhombic'
  }
  
  // Monoclinic: alpha = gamma = 90, beta != 90
  if (is90(alpha) && !is90(beta) && is90(gamma)) {
    return 'monoclinic'
  }
  
  // Monoclinic (alternative setting): alpha = beta = 90, gamma != 90 (but not 120)
  if (is90(alpha) && is90(beta) && !is90(gamma) && !is120(gamma)) {
    return 'monoclinic'
  }
  
  // Default to triclinic (most general case)
  return 'triclinic'
}

/**
 * Parse atom sites from CIF loop structure
 */
function parseAtomSites(lines: string[], latticeParams: LatticeParams): ParsedCIFAtom[] {
  const atoms: ParsedCIFAtom[] = []
  
  // Find atom_site loop
  let inLoop = false
  let inAtomSiteLoop = false
  const columnNames: string[] = []
  const dataRows: string[][] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    if (line === 'loop_') {
      inLoop = true
      inAtomSiteLoop = false
      columnNames.length = 0
      dataRows.length = 0
      continue
    }
    
    if (inLoop) {
      if (line.startsWith('_atom_site_')) {
        inAtomSiteLoop = true
        columnNames.push(line.toLowerCase())
      } else if (inAtomSiteLoop && line.startsWith('_')) {
        // Another loop started, we're done with atom_site
        break
      } else if (inAtomSiteLoop && line && !line.startsWith('#') && !line.startsWith('_')) {
        // This is a data row
        const tokens = tokenizeCIFLine(line)
        if (tokens.length > 0) {
          dataRows.push(tokens)
        }
      } else if (inAtomSiteLoop && (line === '' || line.startsWith('loop_'))) {
        // Empty line or new loop ends current loop
        if (dataRows.length > 0) break
      }
    }
  }
  
  if (dataRows.length === 0) {
    return atoms
  }
  
  // Find column indices
  const labelIdx = columnNames.findIndex(c => c.includes('label') || c.includes('type_symbol'))
  const typeIdx = columnNames.findIndex(c => c === '_atom_site_type_symbol')
  const xIdx = columnNames.findIndex(c => c.includes('fract_x'))
  const yIdx = columnNames.findIndex(c => c.includes('fract_y'))
  const zIdx = columnNames.findIndex(c => c.includes('fract_z'))
  
  // Also check for Cartesian coordinates
  const cartXIdx = columnNames.findIndex(c => c.includes('cartn_x'))
  const cartYIdx = columnNames.findIndex(c => c.includes('cartn_y'))
  const cartZIdx = columnNames.findIndex(c => c.includes('cartn_z'))
  
  const useFractional = xIdx >= 0 && yIdx >= 0 && zIdx >= 0
  const useCartesian = !useFractional && cartXIdx >= 0 && cartYIdx >= 0 && cartZIdx >= 0
  
  if (!useFractional && !useCartesian) {
    return atoms
  }
  
  // Parse each data row
  for (const row of dataRows) {
    const elementLabel = typeIdx >= 0 ? row[typeIdx] : (labelIdx >= 0 ? row[labelIdx] : null)
    if (!elementLabel) continue
    
    // Extract element symbol (first 1-2 letters)
    const element = extractElement(elementLabel)
    if (!element) continue
    
    let fx: number, fy: number, fz: number
    let cx: number, cy: number, cz: number
    
    if (useFractional) {
      const parsedFx = parseNumericValue(row[xIdx])
      const parsedFy = parseNumericValue(row[yIdx])
      const parsedFz = parseNumericValue(row[zIdx])
      
      if (parsedFx === null || parsedFy === null || parsedFz === null) continue
      
      fx = parsedFx
      fy = parsedFy
      fz = parsedFz
      
      // Convert fractional to Cartesian coordinates
      const coords = fractionalToCartesian(fx, fy, fz, latticeParams)
      cx = coords.x
      cy = coords.y
      cz = coords.z
    } else {
      cx = parseNumericValue(row[cartXIdx]) ?? 0
      cy = parseNumericValue(row[cartYIdx]) ?? 0
      cz = parseNumericValue(row[cartZIdx]) ?? 0
      
      // For Cartesian input, estimate fractional coords (simplified - assumes orthogonal)
      fx = cx / latticeParams.a
      fy = cy / latticeParams.b
      fz = cz / latticeParams.c
    }
    
    atoms.push({
      id: `cif-${atoms.length}`,
      element,
      position: [fx, fy, fz] as [number, number, number],
      cartesian: [cx, cy, cz] as [number, number, number],
      siteIndex: atoms.length,
    })
  }
  
  return atoms
}

/**
 * Tokenize a CIF data line (handles quoted strings)
 */
function tokenizeCIFLine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    
    if (!inQuote && (char === "'" || char === '"')) {
      inQuote = true
      quoteChar = char
    } else if (inQuote && char === quoteChar) {
      inQuote = false
      quoteChar = ''
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else if (!inQuote && /\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }
  
  if (current) {
    tokens.push(current)
  }
  
  return tokens
}

/**
 * Parse a numeric value from CIF (handles uncertainty notation)
 */
function parseNumericValue(value: string | undefined): number | null {
  if (!value || value === '?' || value === '.') return null
  const cleaned = value.replace(/\([^)]*\)/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

/**
 * Extract element symbol from atom label (e.g., "Fe1" -> "Fe", "O2" -> "O")
 */
function extractElement(label: string): string | null {
  // Common element symbols (1-2 characters, first uppercase, second lowercase if present)
  const match = label.match(/^([A-Z][a-z]?)/)
  return match ? match[1] : null
}

/**
 * Convert fractional coordinates to Cartesian
 */
function fractionalToCartesian(
  fx: number, 
  fy: number, 
  fz: number, 
  params: LatticeParams
): { x: number; y: number; z: number } {
  const { a, b, c, alpha, beta, gamma } = params
  
  // Convert angles to radians
  const alphaRad = (alpha * Math.PI) / 180
  const betaRad = (beta * Math.PI) / 180
  const gammaRad = (gamma * Math.PI) / 180
  
  // Calculate transformation matrix components
  const cosAlpha = Math.cos(alphaRad)
  const cosBeta = Math.cos(betaRad)
  const cosGamma = Math.cos(gammaRad)
  const sinGamma = Math.sin(gammaRad)
  
  // Volume factor
  const v = Math.sqrt(1 - cosAlpha * cosAlpha - cosBeta * cosBeta - cosGamma * cosGamma 
                      + 2 * cosAlpha * cosBeta * cosGamma)
  
  // Transformation matrix (fractional to Cartesian)
  // a along x-axis
  const ax = a
  const ay = 0
  const az = 0
  
  // b in xy-plane
  const bx = b * cosGamma
  const by = b * sinGamma
  const bz = 0
  
  // c general direction
  const cx = c * cosBeta
  const cy = c * (cosAlpha - cosBeta * cosGamma) / sinGamma
  const cz = c * v / sinGamma
  
  return {
    x: fx * ax + fy * bx + fz * cx,
    y: fx * ay + fy * by + fz * cy,
    z: fx * az + fy * bz + fz * cz
  }
}

/**
 * Validate if a string looks like CIF content
 */
export function isCIFContent(content: string): boolean {
  // Check for CIF markers
  return content.includes('data_') || 
         content.includes('_cell_length') ||
         content.includes('_atom_site')
}

/**
 * Parse symmetry operations from CIF
 * Looks for _symmetry_equiv_pos_as_xyz loop
 */
function parseSymmetryOperations(lines: string[]): SymmetryOperation[] {
  const operations: SymmetryOperation[] = []
  
  let inLoop = false
  let inSymmetryLoop = false
  const columnNames: string[] = []
  const dataRows: string[][] = []
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    
    if (line === 'loop_') {
      // Check if this is a symmetry loop
      const nextLines = lines.slice(i + 1, i + 5).map(l => l.trim())
      const hasSymmetryCol = nextLines.some(l => 
        l.includes('_symmetry_equiv_pos') || l.includes('_space_group_symop')
      )
      
      if (hasSymmetryCol) {
        inLoop = true
        inSymmetryLoop = true
        columnNames.length = 0
        dataRows.length = 0
      }
      continue
    }
    
    if (inLoop && inSymmetryLoop) {
      if (line.startsWith('_symmetry_equiv_pos') || line.startsWith('_space_group_symop')) {
        columnNames.push(line.toLowerCase())
      } else if (line.startsWith('_') || line === 'loop_') {
        // Another section started
        inLoop = false
        inSymmetryLoop = false
      } else if (line && !line.startsWith('#')) {
        // Data row
        const tokens = tokenizeCIFLine(line)
        if (tokens.length > 0) {
          dataRows.push(tokens)
        }
      } else if (line === '' && dataRows.length > 0) {
        // Empty line ends the loop
        break
      }
    }
  }
  
  // Find the xyz column
  const xyzIdx = columnNames.findIndex(c => c.includes('_as_xyz') || c.includes('_xyz'))
  
  for (const row of dataRows) {
    // The xyz operation might be in different columns
    // Often it's the second column (after site_id) or could be combined
    let xyzStr = ''
    
    if (xyzIdx >= 0 && row[xyzIdx]) {
      xyzStr = row[xyzIdx]
    } else if (row.length >= 2) {
      // Try second column (common format: "1 'x, y, z'")
      xyzStr = row[1]
    } else if (row.length === 1) {
      // Single column - might be just the operation
      xyzStr = row[0]
    }
    
    // Clean up the string
    xyzStr = xyzStr.replace(/['"]/g, '').trim()
    
    if (xyzStr && xyzStr.includes(',')) {
      const op = parseSymmetryString(xyzStr)
      if (op) {
        operations.push(op)
      }
    }
  }
  
  // If no symmetry operations found, add identity
  if (operations.length === 0) {
    operations.push({
      raw: 'x, y, z',
      transform: (fx, fy, fz) => ({ fx, fy, fz })
    })
  }
  
  return operations
}

/**
 * Parse a symmetry operation string like 'x, y, z' or '-x+1/2, y+1/4, -z'
 */
export function parseSymmetryString(str: string): SymmetryOperation | null {
  try {
    const parts = str.split(',').map(s => s.trim().toLowerCase())
    if (parts.length !== 3) return null
    
    const transforms = parts.map(parseSymmetryComponent)
    if (transforms.some(t => t === null)) return null
    
    return {
      raw: str,
      transform: (fx, fy, fz) => {
        const coords = { x: fx, y: fy, z: fz }
        return {
          fx: transforms[0]!(coords),
          fy: transforms[1]!(coords),
          fz: transforms[2]!(coords)
        }
      }
    }
  } catch {
    console.warn("[zatom] Failed to parse symmetry operation:", str)
    return null
  }
}

/**
 * Parse a single symmetry component like 'x', '-y+1/2', 'z+3/4'
 */
function parseSymmetryComponent(str: string): ((coords: { x: number; y: number; z: number }) => number) | null {
  // Pattern: optional sign, optional coefficient, variable (x/y/z), optional fraction
  // Examples: x, -x, x+1/2, -y+1/4, z+3/4, 1/2+x, -x+1/2
  
  let component = str.trim().replace(/\s+/g, '')
  
  // Track coefficients for x, y, z
  let xCoef = 0
  let yCoef = 0
  let zCoef = 0
  let constant = 0
  
  // Parse terms separated by + or -
  // First, normalize: replace - with +- for easier splitting
  component = component.replace(/-/g, '+-')
  const terms = component.split('+').filter(t => t.length > 0)
  
  for (const term of terms) {
    if (term.includes('x')) {
      // Handle cases like 'x', '-x', '2x', '-2x'
      const coef = term.replace('x', '') || '1'
      xCoef += coef === '-' ? -1 : parseFloat(coef)
    } else if (term.includes('y')) {
      const coef = term.replace('y', '') || '1'
      yCoef += coef === '-' ? -1 : parseFloat(coef)
    } else if (term.includes('z')) {
      const coef = term.replace('z', '') || '1'
      zCoef += coef === '-' ? -1 : parseFloat(coef)
    } else {
      // This is a constant (like 1/2, 1/4, 3/4)
      constant += parseFraction(term)
    }
  }
  
  return (coords: { x: number; y: number; z: number }) => {
    const result = xCoef * coords.x + yCoef * coords.y + zCoef * coords.z + constant
    // Wrap to [0, 1) range
    return wrapFractional(result)
  }
}

/**
 * Parse a fraction like '1/2', '3/4', or a decimal
 */
function parseFraction(str: string): number {
  str = str.trim()
  if (str.includes('/')) {
    const [num, denom] = str.split('/')
    return parseFloat(num) / parseFloat(denom)
  }
  return parseFloat(str) || 0
}

/**
 * Apply symmetry operations to generate all equivalent atom positions
 */
function applySymmetryOperations(
  asymmetricAtoms: ParsedCIFAtom[],
  symmetryOps: SymmetryOperation[],
  latticeParams: LatticeParams
): ParsedCIFAtom[] {
  const allAtoms: ParsedCIFAtom[] = []
  const tolerance = 0.001 // Tolerance for duplicate detection

  for (const atom of asymmetricAtoms) {
    for (const op of symmetryOps) {
      const newFrac = op.transform(atom.position[0], atom.position[1], atom.position[2])

      // Wrap to [0, 1) range
      const fx = wrapFractional(newFrac.fx)
      const fy = wrapFractional(newFrac.fy)
      const fz = wrapFractional(newFrac.fz)

      // Check for duplicates
      const isDuplicate = allAtoms.some(existing => {
        // Calculate distance in fractional coordinates (with periodic boundary)
        const dx = Math.min(Math.abs(existing.position[0] - fx), 1 - Math.abs(existing.position[0] - fx))
        const dy = Math.min(Math.abs(existing.position[1] - fy), 1 - Math.abs(existing.position[1] - fy))
        const dz = Math.min(Math.abs(existing.position[2] - fz), 1 - Math.abs(existing.position[2] - fz))
        return existing.element === atom.element &&
               dx < tolerance && dy < tolerance && dz < tolerance
      })

      if (!isDuplicate) {
        // Convert to Cartesian
        const cartesian = fractionalToCartesian(fx, fy, fz, latticeParams)

        allAtoms.push({
          id: `cif-sym-${allAtoms.length}`,
          element: atom.element,
          position: [fx, fy, fz] as [number, number, number],
          cartesian: [cartesian.x, cartesian.y, cartesian.z] as [number, number, number],
          siteIndex: atom.siteIndex,
        })
      }
    }
  }

  return allAtoms
}

/**
 * Export crystal structure to CIF format
 */
export interface CIFExportOptions {
  name?: string
  latticeParams: LatticeParams
  crystalSystem?: CrystalSystem
  atoms: Array<{
    element: string
    position?: [number, number, number] // fractional coordinates
    cartesian?: [number, number, number] // Cartesian coordinates
  }>
  spaceGroup?: string
}

export function exportToCIF(options: CIFExportOptions): string {
  const {
    name = 'exported_structure',
    latticeParams,
    atoms,
    spaceGroup = 'P 1'
  } = options

  const lines: string[] = []
  
  // Data block header
  lines.push(`data_${name.replace(/\s+/g, '_')}`)
  lines.push('')
  
  // Crystal system and space group
  lines.push(`_symmetry_space_group_name_H-M   '${spaceGroup}'`)
  lines.push(`_symmetry_Int_Tables_number      1`)
  lines.push('')
  
  // Lattice parameters
  lines.push(`_cell_length_a                   ${latticeParams.a.toFixed(6)}`)
  lines.push(`_cell_length_b                   ${latticeParams.b.toFixed(6)}`)
  lines.push(`_cell_length_c                   ${latticeParams.c.toFixed(6)}`)
  lines.push(`_cell_angle_alpha                ${latticeParams.alpha.toFixed(4)}`)
  lines.push(`_cell_angle_beta                 ${latticeParams.beta.toFixed(4)}`)
  lines.push(`_cell_angle_gamma                ${latticeParams.gamma.toFixed(4)}`)
  lines.push('')
  
  // Atom sites loop
  lines.push('loop_')
  lines.push('_atom_site_label')
  lines.push('_atom_site_type_symbol')
  lines.push('_atom_site_fract_x')
  lines.push('_atom_site_fract_y')
  lines.push('_atom_site_fract_z')
  lines.push('_atom_site_occupancy')
  
  // Track element counts for labeling
  const elementCounts: Record<string, number> = {}
  
  for (const atom of atoms) {
    const element = atom.element
    elementCounts[element] = (elementCounts[element] || 0) + 1
    const label = `${element}${elementCounts[element]}`
    
    // `position` is fractional by contract; only `cartesian` needs conversion.
    let rawX: number, rawY: number, rawZ: number
    if (atom.position) {
      rawX = atom.position[0]
      rawY = atom.position[1]
      rawZ = atom.position[2]
    } else if (atom.cartesian) {
      const frac = cartesianToFractional(atom.cartesian[0], atom.cartesian[1], atom.cartesian[2], latticeParams)
      rawX = frac.fx
      rawY = frac.fy
      rawZ = frac.fz
    } else {
      continue // Atoms without coordinates are skipped
    }

    // CIF fractional coordinates use the canonical half-open [0, 1) interval.
    // Tile-image editing may place an atom outside the visible unit cell; wrapping
    // it on export is a periodic-equivalent transform and preserves the structure.
    const wrap = (value: number): number => {
      const wrapped = value - Math.floor(value)
      // Clamp floating-point values that land on the excluded upper boundary.
      return wrapped >= 1 ? 0 : wrapped
    }
    const fx = wrap(rawX)
    const fy = wrap(rawY)
    const fz = wrap(rawZ)

    lines.push(`${label.padEnd(8)} ${element.padEnd(4)} ${fx.toFixed(6).padStart(10)} ${fy.toFixed(6).padStart(10)} ${fz.toFixed(6).padStart(10)}  1.0000`)
  }
  
  lines.push('')
  lines.push('# Exported from zatom')
  
  return `${lines.join('\n')}\n`
}

/**
 * Convert Cartesian coordinates to fractional
 */
function cartesianToFractional(
  x: number,
  y: number,
  z: number,
  params: LatticeParams
): { fx: number; fy: number; fz: number } {
  const { a, b, c, alpha, beta, gamma } = params
  
  // Convert angles to radians
  const alphaRad = (alpha * Math.PI) / 180
  const betaRad = (beta * Math.PI) / 180
  const gammaRad = (gamma * Math.PI) / 180
  
  const cosAlpha = Math.cos(alphaRad)
  const cosBeta = Math.cos(betaRad)
  const cosGamma = Math.cos(gammaRad)
  const sinGamma = Math.sin(gammaRad)
  
  // Volume factor
  const v = Math.sqrt(1 - cosAlpha * cosAlpha - cosBeta * cosBeta - cosGamma * cosGamma 
                      + 2 * cosAlpha * cosBeta * cosGamma)
  
  // Inverse transformation (Cartesian to fractional)
  const fx = x / a - y * cosGamma / (a * sinGamma) + z * (cosAlpha * cosGamma - cosBeta) / (a * v * sinGamma)
  const fy = y / (b * sinGamma) + z * (cosBeta * cosGamma - cosAlpha) / (b * v * sinGamma)
  const fz = z * sinGamma / (c * v)
  
  return { fx, fy, fz }
}
