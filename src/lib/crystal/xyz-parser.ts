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
import { splitQuotedText } from './text-tokens'
import { validateXyzSourceIds, xyzFramePermutation } from './xyz-identity'
import { parseXyzReal } from './xyz-numbers'
import { latticeParamsFromMatrix } from './lattice'
import { readXyzHeader, xyzHeaderValue, type XyzHeaderEntry } from './xyz-header'

/** A per-atom extended-XYZ auxiliary value: a scalar (charge, per-atom energy…)
 *  or a 3D vector (forces, displacement, magmom…). */
export type AuxValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'vector'; value: [number, number, number] }

export interface XYZAtom {
  // Source zatom_id when supplied; otherwise only a frame-local row label.
  id: string
  element: string

  position: [number, number, number]

  cartesian: [number, number, number]
  /** Extended-XYZ per-atom auxiliary columns (forces, charge, magmom, …), keyed
   *  by the `Properties=` column name. Absent for plain XYZ (back-compat). */
  props?: Record<string, AuxValue>
}

export interface XYZFrame {
  atoms: XYZAtom[]
  /** Source IDs come from the file/canonical producer; document IDs are assigned
   *  at installation. Neither authorizes matching an unrelated document.
   *  Absent on unbound/index-only frames returned by other parsers. */
  atomIdentity?: 'source' | 'document'
  comment?: string
  /** Boundary conditions along the three lattice vectors, not Cartesian axes. */
  periodic?: [boolean, boolean, boolean]
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
  /** First frame's explicit or format-default boundary conditions. */
  periodic?: XYZFrame['periodic']
  /** Whether this is a multi-frame trajectory */
  isTrajectory: boolean
}

interface PropColumn { name: string; type: 'S' | 'R' | 'I' | 'L'; count: number; start: number }
interface PropSpec { columns: PropColumn[]; speciesStart: number; posStart: number }

/**
 * Parse an extended-XYZ `Properties=` descriptor into an ordered, offset-mapped
 * column spec — e.g. `species:S:1:pos:R:3:forces:R:3:charge:R:1`. Order-agnostic
 * (uses running offsets, never fixed indices) and tolerant of the unquoted ASE
 * form and a quoted form. An absent schema means plain XYZ; a malformed declared
 * schema is an error, never permission to discard the producer's identity.
 */
function parseExtxyzProperties(header: readonly XyzHeaderEntry[]): PropSpec | null {
  const descriptor = xyzHeaderValue(header, 'Properties')
  if (descriptor === undefined) return null
  if (!descriptor) throw new Error('extXYZ Properties descriptor is missing')
  const tok = descriptor.split(':')
  if (tok.length < 3 || tok.length % 3 !== 0) throw new Error('Invalid extXYZ Properties descriptor')
  const columns: PropColumn[] = []
  const names = new Set<string>()
  let start = 0
  for (let i = 0; i < tok.length; i += 3) {
    const name = tok[i]
    const type = tok[i + 1] as PropColumn['type']
    const count = Number(tok[i + 2])
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || names.has(name)
      || !['S', 'R', 'I', 'L'].includes(type) || !Number.isSafeInteger(count) || count <= 0) {
      throw new Error('Invalid extXYZ Properties descriptor')
    }
    names.add(name)
    columns.push({ name, type, count, start })
    start += count
  }
  const pos = columns.find(c => c.name === 'pos')
  if (!pos || pos.type !== 'R' || pos.count !== 3) throw new Error('extXYZ Properties requires pos:R:3')
  const species = columns.find(c => c.name === 'species')
  if (!species || species.type !== 'S' || species.count !== 1) throw new Error('extXYZ Properties requires species:S:1')
  const id = columns.find(c => c.name === 'zatom_id')
  if (id && (id.type !== 'S' || id.count !== 1)) throw new Error('extXYZ zatom_id must be declared as zatom_id:S:1')
  return { columns, speciesStart: species.start, posStart: pos.start }
}

/**
 * Harvest numeric `key=value` scalars from an extended-XYZ comment line
 * (energy=…, etc.). Quoted / colon-list values (Lattice, Properties, pbc) are
 * non-numeric and are naturally skipped.
 */
function parseFrameScalars(header: readonly XyzHeaderEntry[]): Record<string, number> | undefined {
  const out: Record<string, number> = {}
  for (const entry of header) {
    if (entry.quoted) continue
    const value = parseXyzReal(entry.value)
    if (value !== undefined) out[entry.key] = value
  }
  return Object.keys(out).length ? out : undefined
}

function real(value: string, field: string): number {
  const parsed = parseXyzReal(value)
  if (parsed === undefined) throw new Error(`${field} must be a finite XYZ real number`)
  return parsed
}

function parsePeriodicity(header: readonly XyzHeaderEntry[], hasLattice: boolean): [boolean, boolean, boolean] {
  const value = xyzHeaderValue(header, 'pbc')
  if (value === undefined) {
    return hasLattice ? [true, true, true] : [false, false, false]
  }
  const values = value.trim().split(/\s+/)
  if (values.length !== 3 || values.some(value => !/^(?:t|f|true|false)$/i.test(value))) {
    throw new Error('extXYZ pbc must contain exactly three boolean flags (T/F).')
  }
  const periodic = values.map(value => /^(?:t|true)$/i.test(value)) as [boolean, boolean, boolean]
  if (!hasLattice && periodic.some(Boolean)) throw new Error('Periodic extXYZ requires Lattice vectors.')
  return periodic
}

/**
 * Parse a single XYZ frame starting at the given line index
 * Returns the parsed frame and the next line index
 */
function parseXYZFrame(lines: string[], startIndex: number): { frame: XYZFrame; nextIndex: number } | null {
  if (startIndex >= lines.length) return null

  // Line 1: Number of atoms
  const countText = lines[startIndex].trim()
  const numAtoms = Number(countText)
  if (!/^\d+$/.test(countText) || !Number.isSafeInteger(numAtoms) || numAtoms <= 0) {
    throw new Error('XYZ atom count must be a positive integer')
  }

  if (startIndex + 1 >= lines.length) return null

  // Line 2: Comment line (may contain extended XYZ properties)
  const comment = lines[startIndex + 1]
  const header = readXyzHeader(comment)
  const latticeVectors = parseLatticeFromComment(header)
  const periodic = parsePeriodicity(header, Boolean(latticeVectors))
  const propSpec = parseExtxyzProperties(header)   // extended-XYZ aux columns (null ⇒ plain XYZ)
  const idColumn = propSpec?.columns.find(col => col.name === 'zatom_id')
  const totalColumns = propSpec?.columns.reduce((sum, col) => sum + col.count, 0)
  const frameScalars = parseFrameScalars(header)   // energy=… etc. harvested from the comment

  // Parse atoms
  const atoms: XYZAtom[] = []
  if (startIndex + 2 + numAtoms > lines.length) throw new Error('XYZ atom block is truncated')
  for (let i = startIndex + 2; i < startIndex + 2 + numAtoms; i++) {
    const parts = propSpec ? splitQuotedText(lines[i], `extXYZ atom row ${i + 1}`) : lines[i].trim().split(/\s+/)
    if (parts.length < 4 || (totalColumns !== undefined && parts.length !== totalColumns)) {
      throw new Error(`XYZ atom row ${i + 1} has an invalid number of columns`)
    }

    let element: string
    let x: number, y: number, z: number
    let props: Record<string, AuxValue> | undefined
    if (propSpec) {
      // Schema-driven: locate species/pos by name, unpack remaining numeric columns.
      element = normalizeElement(parts[propSpec.speciesStart])
      x = real(parts[propSpec.posStart], `XYZ atom row ${i + 1} x`)
      y = real(parts[propSpec.posStart + 1], `XYZ atom row ${i + 1} y`)
      z = real(parts[propSpec.posStart + 2], `XYZ atom row ${i + 1} z`)
      for (const col of propSpec.columns) {
        if (col.name === 'species' || col.name === 'pos') continue
        if (col.type !== 'R' && col.type !== 'I') continue   // only numeric aux columns
        const values = parts.slice(col.start, col.start + col.count).map((token, component) => {
          const field = `extXYZ atom row ${i + 1} ${col.name}[${component}]`
          if (col.type === 'R') return real(token, field)
          if (!/^[+-]?\d+$/.test(token) || !Number.isSafeInteger(Number(token))) {
            throw new Error(`${field} must be a safe integer`)
          }
          return Number(token)
        })
        if (col.count === 1) (props ??= {})[col.name] = { kind: 'scalar', value: values[0] }
        else if (col.count === 3) (props ??= {})[col.name] = { kind: 'vector', value: values as [number, number, number] }
      }
    } else {
      // Plain XYZ: element x y z; trailing columns have no declared schema.
      element = normalizeElement(parts[0])
      x = real(parts[1], `XYZ atom row ${i + 1} x`)
      y = real(parts[2], `XYZ atom row ${i + 1} y`)
      z = real(parts[3], `XYZ atom row ${i + 1} z`)
    }

    if (![x, y, z].every(Number.isFinite)) throw new Error(`XYZ atom row ${i + 1} has invalid coordinates`)

    atoms.push({
      id: idColumn ? parts[idColumn.start] : `xyz-${atoms.length}`,
      element,
      position: [0, 0, 0] as [number, number, number], // Will be converted later if lattice provided
      cartesian: [x, y, z] as [number, number, number],
      ...(props ? { props } : {}),
    })
  }

  if (idColumn) validateXyzSourceIds(atoms.map(atom => atom.id), 'extXYZ frame')

  // Calculate lattice params if we have lattice vectors
  let latticeParams: XYZFrame['latticeParams']
  if (latticeVectors) {
    const params = latticeParamsFromMatrix([latticeVectors.a, latticeVectors.b, latticeVectors.c])
    if (!params) throw new Error('extXYZ Lattice must define a finite nonsingular cell')
    latticeParams = params
  }

  // Aux column schema (numeric, non species/pos) for UI "color by" / "arrows" menus.
  const propSchema = propSpec
    ? propSpec.columns
        .filter(c => c.name !== 'species' && c.name !== 'pos' && (c.type === 'R' || c.type === 'I') && (c.count === 1 || c.count === 3))
        .map(c => ({ name: c.name, kind: (c.count === 3 ? 'vector' : 'scalar') as 'scalar' | 'vector', cols: c.count }))
    : undefined

  return {
    frame: {
      atoms,
      ...(idColumn ? { atomIdentity: 'source' as const } : {}),
      comment,
      latticeVectors,
      latticeParams,
      periodic,
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
    // Keep the mandatory comment row even when it is empty.
    const lines = content.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim())

    if (lines.length < 3) {
      return { success: false, error: 'XYZ file must have at least 3 lines' }
    }

    // Parse all frames
    const frames: XYZFrame[] = []
    let currentIndex = 0

    while (currentIndex < lines.length) {
      while (currentIndex < lines.length && !lines[currentIndex]) currentIndex++
      if (currentIndex >= lines.length) break
      const result = parseXYZFrame(lines, currentIndex)
      if (!result) throw new Error('XYZ frame is incomplete')

      frames.push(result.frame)
      currentIndex = result.nextIndex
    }

    if (frames.length === 0) {
      return { success: false, error: 'No valid frames found in XYZ file' }
    }

    // Use first frame for backward compatibility
    const firstFrame = frames[0]
    const identity = (frame: XYZFrame) => ({
      elements: frame.atoms.map(atom => atom.element),
      ...(frame.atomIdentity === 'source' ? { ids: frame.atoms.map(atom => atom.id) } : {}),
    })
    const reference = identity(firstFrame)
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i]
      const order = xyzFramePermutation(reference, identity(frame), `XYZ frame ${i + 1}`)
      // Normalize complete rows together: coordinates and auxiliary properties
      // must follow the ID, not the file's changing row order.
      frame.atoms = order.map(row => frame.atoms[row])
    }

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
        periodic: firstFrame.periodic,
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
function parseLatticeFromComment(header: readonly XyzHeaderEntry[]): XYZParseResult['latticeVectors'] | undefined {
  const value = xyzHeaderValue(header, 'Lattice')
  if (value === undefined) return undefined
  const tokens = value.trim().split(/\s+/)
  if (tokens.length !== 9) throw new Error('extXYZ Lattice must contain nine real values')
  const values = tokens.map((token, i) => real(token, `extXYZ Lattice[${i}]`))

  return {
    a: [values[0], values[1], values[2]],
    b: [values[3], values[4], values[5]],
    c: [values[6], values[7], values[8]]
  }
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
  const lines = content.replace(/\r\n?/g, '\n').trimStart().split('\n')
  const count = Number(lines[0]?.trim())
  if (!/^\d+$/.test(lines[0]?.trim() ?? '') || !Number.isSafeInteger(count) || count < 1 || lines.length < count + 2) return false
  try {
    const spec = parseExtxyzProperties(readXyzHeader(lines[1]))
    const row = spec ? splitQuotedText(lines[2], 'extXYZ first atom') : lines[2].trim().split(/\s+/)
    const required = spec?.columns.reduce((sum, col) => sum + col.count, 0)
    if (row.length < 4 || (required !== undefined && row.length !== required)) return false
    const start = spec?.posStart ?? 1
    return row.slice(start, start + 3).length === 3
      && row.slice(start, start + 3).every(token => parseXyzReal(token) !== undefined)
  } catch { return false }
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
