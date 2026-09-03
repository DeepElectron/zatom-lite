/**
 * XYZ File Parser
 * 
 * Supports standard XYZ format and extended XYZ format
 * 
 * Standard XYZ format:
 * Line 1: Number of atoms
 * Line 2: Comment/title line
 * Line 3+: Element X Y Z
 * 
 * Extended XYZ format includes lattice information in the comment line:
 * Lattice="a1x a1y a1z a2x a2y a2z a3x a3y a3z"
 */

import { atomicNumberToSymbol } from '../../chemistry/periodic-table'

/** A per-atom extended-XYZ auxiliary value: a scalar (charge, per-atom energy…)
 *  or a 3D vector (forces, displacement, magmom…). */
export type AuxValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'vector'; value: [number, number, number] }

export interface XYZAtom {
  // The stable ID generated during parsing can be used by downstream (crystalStore, etc.) as a key for selection/transformation
  id: string
  element: string
  // Fractional coordinate occupancy; XYZ itself only gives Cartesian coordinates, and the lattice transformation is filled in by the consumer on demand
  position: [number, number, number]
  // Cartesian coordinates in the original XYZ file
  cartesian: [number, number, number]
  /** Extended-XYZ per-atom auxiliary columns (forces, charge, magmom, …), keyed
  *  by the `Properties=` column name. Absent for plain XYZ. */
  props?: Record<string, AuxValue>
}

export interface XYZFrame {
  atoms: XYZAtom[]
  comment?: string
  /** Lattice vectors if provided in extended XYZ format */
  latticeVectors?: {
    a: [number, number, number]
    b: [number, number, number]
    c: [number, number, number]
  }
  /** Lattice parameters calculated from lattice vectors */
  latticeParams?: {
    a: number
    b: number
    c: number
    alpha: number
    beta: number
    gamma: number
  }
  /** Per-atom column schema parsed from the extended-XYZ `Properties=` header.
  *  Lists only the auxiliary (non species/pos) numeric columns. UI selectors
  *  read this to populate "color by" / "arrows" menus. Absent for plain XYZ. */
  propSchema?: Array<{ name: string; kind: 'scalar' | 'vector'; cols: number }>
  /** Numeric key=value scalars harvested from the comment line (energy, etc.). */
  frameScalars?: Record<string, number>
}

export interface XYZParseResult {
  name: string
  frames: XYZFrame[]
  /** First frame's atoms for backward compatibility */
  atoms: XYZAtom[]
  comment?: string
  /** First frame's lattice vectors */
  latticeVectors?: XYZFrame['latticeVectors']
  /** First frame's lattice parameters */
  latticeParams?: XYZFrame['latticeParams']
  /** Whether this is a multi-frame trajectory */
  isTrajectory: boolean
}

interface PropColumn { name: string; type: 'S' | 'R' | 'I' | 'L'; count: number; start: number }
interface PropSpec { columns: PropColumn[]; speciesStart: number; posStart: number }

/**
 * Parse an extended-XYZ `Properties=` descriptor into an ordered, offset-mapped
 * column spec — e.g. `species:S:1:pos:R:3:forces:R:3:charge:R:1`. Order-agnostic
 * (uses running offsets, never fixed indices) and tolerant of the unquoted ASE
 * form and a quoted form. Returns null if absent/malformed so the caller falls
 * back to plain-XYZ parsing without changing its byte-level behavior.
 */
function parseExtxyzProperties(comment: string): PropSpec | null {
  const m = comment.match(/Properties\s*=\s*"?([A-Za-z0-9_:]+)"?/)
  if (!m) return null
  const tok = m[1].split(':')
  if (tok.length < 3 || tok.length % 3 !== 0) return null
  const columns: PropColumn[] = []
  let start = 0
  for (let i = 0; i < tok.length; i += 3) {
    const name = tok[i]
    const type = tok[i + 1] as PropColumn['type']
    const count = parseInt(tok[i + 2], 10)
    if (!name || !['S', 'R', 'I', 'L'].includes(type) || isNaN(count) || count <= 0) return null
    columns.push({ name, type, count, start })
    start += count
  }
  const pos = columns.find(c => c.name === 'pos')
  if (!pos) return null
  const species = columns.find(c => c.name === 'species')
  return { columns, speciesStart: species ? species.start : 0, posStart: pos.start }
}

/**
 * Harvest numeric `key=value` scalars from an extended-XYZ comment line
 * (energy=…, etc.). Quoted / colon-list values (Lattice, Properties, pbc) are
 * non-numeric and are naturally skipped.
 */
function parseFrameScalars(comment: string): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  const re = /([A-Za-z_][\w]*)\s*=\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(comment)) !== null) out[m[1].toLowerCase()] = parseFloat(m[2])
  return Object.keys(out).length ? out : undefined
}

/**
 * Parse a single XYZ frame starting at the given line index
 * Returns the parsed frame and the next line index
 */
function parseXYZFrame(lines: string[], startIndex: number): { frame: XYZFrame; nextIndex: number } | null {
  if (startIndex >= lines.length) return null
  
  // Line 1: Number of atoms
  const numAtoms = parseInt(lines[startIndex], 10)
  if (isNaN(numAtoms) || numAtoms <= 0) return null
  
  if (startIndex + 1 >= lines.length) return null
  
  // Line 2: Comment line (may contain extended XYZ properties)
  const comment = lines[startIndex + 1]
  const latticeVectors = parseLatticeFromComment(comment)
  const propSpec = parseExtxyzProperties(comment)   // extended-XYZ aux columns (null ⇒ plain XYZ)
  const frameScalars = parseFrameScalars(comment)   // energy=… etc. harvested from the comment

  // Parse atoms
  const atoms: XYZAtom[] = []
  for (let i = startIndex + 2; i < Math.min(startIndex + 2 + numAtoms, lines.length); i++) {
    const parts = lines[i].split(/\s+/)
    if (parts.length < 4) continue

    let element: string
    let x: number, y: number, z: number
    let props: Record<string, AuxValue> | undefined
    if (propSpec) {
      // Schema-driven: locate species/pos by name, unpack remaining numeric columns.
      element = normalizeElement(parts[propSpec.speciesStart])
      x = parseFloat(parts[propSpec.posStart])
      y = parseFloat(parts[propSpec.posStart + 1])
      z = parseFloat(parts[propSpec.posStart + 2])
      for (const col of propSpec.columns) {
        if (col.name === 'species' || col.name === 'pos') continue
        if (col.type !== 'R' && col.type !== 'I') continue   // only numeric aux columns
        if (col.count === 1) {
          const v = parseFloat(parts[col.start])
          if (!isNaN(v)) (props ??= {})[col.name] = { kind: 'scalar', value: v }
        } else if (col.count === 3) {
          const vx = parseFloat(parts[col.start])
          const vy = parseFloat(parts[col.start + 1])
          const vz = parseFloat(parts[col.start + 2])
          if (!isNaN(vx) && !isNaN(vy) && !isNaN(vz)) {
            (props ??= {})[col.name] = { kind: 'vector', value: [vx, vy, vz] }
          }
        }
      }
    } else {
      // Plain XYZ: element x y z.
      element = normalizeElement(parts[0])
      x = parseFloat(parts[1])
      y = parseFloat(parts[2])
      z = parseFloat(parts[3])
    }

    if (isNaN(x) || isNaN(y) || isNaN(z)) continue

    atoms.push({
      id: `xyz-${atoms.length}`,
      element,
      position: [0, 0, 0] as [number, number, number], // Will be converted later if lattice provided
      cartesian: [x, y, z] as [number, number, number],
      ...(props ? { props } : {}),
    })
  }

  if (atoms.length === 0) return null

  // Calculate lattice params if we have lattice vectors
  let latticeParams: XYZFrame['latticeParams']
  if (latticeVectors) {
    latticeParams = calculateLatticeParams(latticeVectors)
  }

  // Aux column schema (numeric, non species/pos) for UI "color by" / "arrows" menus.
  const propSchema = propSpec
    ? propSpec.columns
        .filter(c => c.name !== 'species' && c.name !== 'pos' && (c.type === 'R' || c.type === 'I'))
        .map(c => ({ name: c.name, kind: (c.count === 3 ? 'vector' : 'scalar') as 'scalar' | 'vector', cols: c.count }))
    : undefined

  return {
    frame: {
      atoms,
      comment,
      latticeVectors,
      latticeParams,
      ...(propSchema && propSchema.length ? { propSchema } : {}),
      ...(frameScalars ? { frameScalars } : {}),
    },
    nextIndex: startIndex + 2 + numAtoms
  }
}

/**
 * Parse XYZ file content (supports multi-frame trajectory files)
 */
export function parseXYZ(content: string): { success: true; data: XYZParseResult } | { success: false; error: string } {
  try {
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
    
    if (lines.length < 3) {
      return { success: false, error: 'XYZ file must have at least 3 lines' }
    }
    
    // Parse all frames
    const frames: XYZFrame[] = []
    let currentIndex = 0
    
    while (currentIndex < lines.length) {
      const result = parseXYZFrame(lines, currentIndex)
      if (!result) break
      
      frames.push(result.frame)
      currentIndex = result.nextIndex
    }
    
    if (frames.length === 0) {
      return { success: false, error: 'No valid frames found in XYZ file' }
    }
    
    // Use first frame for backward compatibility
    const firstFrame = frames[0]
    
    // Extract name from first frame's comment or use default
    const name = extractNameFromComment(firstFrame.comment || '') || 'Molecule'
    
    return {
      success: true,
      data: {
        name,
        frames,
        atoms: firstFrame.atoms,
        comment: firstFrame.comment,
        latticeVectors: firstFrame.latticeVectors,
        latticeParams: firstFrame.latticeParams,
        isTrajectory: frames.length > 1
      }
    }
  } catch (error) {
    return { success: false, error: `Failed to parse XYZ file: ${error}` }
  }
}

/**
 * Parse lattice vectors from extended XYZ comment line
 * Format: Lattice="a1x a1y a1z a2x a2y a2z a3x a3y a3z"
 */
function parseLatticeFromComment(comment: string): XYZParseResult['latticeVectors'] | undefined {
  // Look for Lattice="..." pattern
  const latticeMatch = comment.match(/Lattice\s*=\s*"([^"]+)"/i)
  if (!latticeMatch) return undefined
  
  const values = latticeMatch[1].split(/\s+/).map(parseFloat)
  if (values.length !== 9 || values.some(isNaN)) return undefined
  
  return {
    a: [values[0], values[1], values[2]],
    b: [values[3], values[4], values[5]],
    c: [values[6], values[7], values[8]]
  }
}

/**
 * Calculate lattice parameters from lattice vectors
 */
function calculateLatticeParams(vectors: NonNullable<XYZParseResult['latticeVectors']>) {
  const { a: va, b: vb, c: vc } = vectors
  
  const length = (v: [number, number, number]) => Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
  const dot = (u: [number, number, number], v: [number, number, number]) => u[0]*v[0] + u[1]*v[1] + u[2]*v[2]
  
  const a = length(va)
  const b = length(vb)
  const c = length(vc)
  
  const alpha = Math.acos(dot(vb, vc) / (b * c)) * 180 / Math.PI
  const beta = Math.acos(dot(va, vc) / (a * c)) * 180 / Math.PI
  const gamma = Math.acos(dot(va, vb) / (a * b)) * 180 / Math.PI
  
  return { a, b, c, alpha, beta, gamma }
}

/**
 * Extract name from comment line
 */
function extractNameFromComment(comment: string): string | undefined {
  // Remove Lattice="..." and Properties="..." patterns
  let name = comment
    .replace(/Lattice\s*=\s*"[^"]*"/gi, '')
    .replace(/Properties\s*=\s*"[^"]*"/gi, '')
    .replace(/pbc\s*=\s*"[^"]*"/gi, '')
    .trim()
  
  return name || undefined
}

/**
 * Normalize element symbol (capitalize first letter, lowercase rest)
 */
function normalizeElement(elem: string): string {
  if (!elem) return 'X'
  // Handle numeric atomic numbers
  if (/^\d+$/.test(elem)) {
    return atomicNumberToSymbol(parseInt(elem, 10))
  }
  // Normal element symbol
  return elem.charAt(0).toUpperCase() + elem.slice(1).toLowerCase()
}

/**
 * Check if content looks like XYZ format
 */
export function isXYZContent(content: string): boolean {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length < 3) return false
  
  // First line should be a number (atom count)
  const firstLine = parseInt(lines[0], 10)
  if (isNaN(firstLine) || firstLine <= 0) return false
  
  // Third line should have element and 3 coordinates
  const thirdLine = lines[2].split(/\s+/)
  if (thirdLine.length < 4) return false
  
  // Check if last 3 items are numbers
  const x = parseFloat(thirdLine[1])
  const y = parseFloat(thirdLine[2])
  const z = parseFloat(thirdLine[3])

  return !isNaN(x) && !isNaN(y) && !isNaN(z)
}

/** One relaxation step from POST /structure/optimize `trajectory[]`. */
export interface OptTrajectorySnapshot {
  step: number
  energy?: number | null
  maxForce?: number | null
  forces?: number[][] | null
  atoms: { element: number; x: number; y: number; z: number }[]
  lattice?: { matrix: number[][] } | null
}

/**
 * Serialize an optimize trajectory (per-ionic-step snapshots) into a multi-frame
 * extended-XYZ string the modeler loads directly via loadFromXYZ → parseXYZ.
 * Each frame carries `forces` as an extended-XYZ aux column (→ atom.props.forces,
 * drives the force-arrow glyphs) and `energy`/`max_force`/`step` as comment-line
 * scalars (→ frameScalars, drives the E/F convergence chart). Round-trips with
 * parseExtxyzProperties + parseFrameScalars above.
 */
export function optTrajectoryToExtxyz(trajectory: OptTrajectorySnapshot[]): string {
  return trajectory.map((snap) => {
    const mat = snap.lattice?.matrix
    const latPart = mat && mat.length === 3
      ? `Lattice="${mat.flat().map((v) => v.toFixed(6)).join(' ')}" `
      : ''
    const hasForces = Array.isArray(snap.forces) && snap.forces.length === snap.atoms.length
    const propsDecl = hasForces ? 'species:S:1:pos:R:3:forces:R:3' : 'species:S:1:pos:R:3'
    const scalars = [
      `step=${snap.step}`,
      snap.energy != null ? `energy=${snap.energy.toFixed(6)}` : '',
      snap.maxForce != null ? `max_force=${snap.maxForce.toFixed(6)}` : '',
    ].filter(Boolean).join(' ')
    const comment = `${latPart}Properties=${propsDecl} ${scalars}`.trim()
    const body = snap.atoms.map((a, i) => {
      const base = `${atomicNumberToSymbol(a.element)} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`
      if (!hasForces) return base
      const f = snap.forces![i]
      return `${base} ${f[0].toFixed(6)} ${f[1].toFixed(6)} ${f[2].toFixed(6)}`
    })
    return [String(snap.atoms.length), comment, ...body].join('\n')
  }).join('\n')
}
