/** Strict, host-neutral structure text import/export for Agent and MCP calls. */

import { atomicNumberToSymbol, symbolToAtomicNumber } from '../chemistry/periodic-table'
import { calculateLatticeVectors } from '../lib/crystal/lattice'
import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomStructureAtom,
  ZatomStructureBond,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA, ZATOM_TRAJECTORY_SCHEMA } from './contracts'
import {
  boundsOfPositions,
  cartesianToFractional,
  createFnv1a64Hasher,
  determinant3,
  fingerprintStructure,
  fractionalToCartesian,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'

export const ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS = [
  'cif',
  'poscar',
  'xdatcar',
  'xyz',
  'extxyz',
  'mol-v2000',
] as const
export type ZatomStructureTextImportFormat = typeof ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS[number]

export const ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS = ['cif', 'poscar', 'xyz', 'extxyz', 'mol-v2000'] as const
export type ZatomStructureTextExportFormat = typeof ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS[number]

/** VASP selective-dynamics flags, ordered along the three direct lattice axes; true means movable. */
export const ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY = 'zatom.vasp.selectiveDynamics' as const

export const ZATOM_STRUCTURE_TEXT_MAX_BYTES = 16 * 1024 * 1024
export const ZATOM_STRUCTURE_TEXT_MAX_ATOMS = 500_000
export const ZATOM_STRUCTURE_TEXT_MAX_FRAMES = 10_000
export const ZATOM_STRUCTURE_TEXT_MAX_ATOM_FRAMES = 2_000_000

const TEXT_IO_VERSION = 'zatom.structure-text-io/v1'

export class ZatomStructureTextIoError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomStructureTextIoError'
    this.code = code
  }
}

export interface ImportStructureTextOptions {
  format: ZatomStructureTextImportFormat
  text: string
  label?: string
  /** Required when an extXYZ lattice does not carry an explicit pbc field. */
  periodic?: [boolean, boolean, boolean]
  /** Required for multi-frame extXYZ so physical time is never invented. */
  frameTimeStepPs?: number
}

export interface StructureTextImportResult {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  format: ZatomStructureTextImportFormat
  sourceTextFingerprint: string
  structureFingerprint: string
  trajectoryFingerprint?: string
  validation: ReturnType<typeof validateStructure>
  inspectionTargets: ReturnType<typeof validateStructure>['inspectionTargets']
  checks: ValidationCheck[]
  limitations: string[]
}

export interface ExportStructureTextOptions {
  structure: ZatomStructure
  format: ZatomStructureTextExportFormat
}

export interface StructureTextExportResult {
  format: ZatomStructureTextExportFormat
  text: string
  mediaType: string
  extension: string
  byteCount: number
  sourceStructureFingerprint: string
  outputTextFingerprint: string
  limitations: string[]
  checks: ValidationCheck[]
}

interface ParsedText {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  checks: ValidationCheck[]
  limitations: string[]
}

interface ExtxyzPropertyColumn {
  name: string
  type: 'S' | 'R' | 'I' | 'L'
  count: number
  offset: number
}

interface ParsedXyzFrame {
  elements: string[]
  positions: Vec3[]
  ids?: string[]
  properties: Array<Record<string, JsonValue> | undefined>
  lattice?: ZatomLattice
  comment: string
}

function fail(code: string, message: string): never {
  throw new ZatomStructureTextIoError(code, message)
}

function byteCount(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function textFingerprint(text: string): string {
  const hasher = createFnv1a64Hasher()
  hasher.feed(text)
  return hasher.digest()
}

function ensureInputBudget(text: string): number {
  if (!text.trim()) fail('empty_structure_text', 'text must contain a structure')
  if (text.includes('\0')) fail('invalid_structure_text', 'text must not contain NUL bytes')
  const bytes = byteCount(text)
  if (bytes > ZATOM_STRUCTURE_TEXT_MAX_BYTES) {
    fail(
      'structure_text_budget_exceeded',
      `Structure text uses ${bytes} bytes above the ${ZATOM_STRUCTURE_TEXT_MAX_BYTES}-byte limit`,
    )
  }
  return bytes
}

function normalizeElement(value: string, field: string): string {
  const trimmed = value.trim()
  const number = symbolToAtomicNumber(trimmed)
  if (!Number.isSafeInteger(number) || number < 1 || number > 103) {
    fail('unknown_element', `${field} contains unsupported element ${JSON.stringify(value)}`)
  }
  const symbol = atomicNumberToSymbol(number)
  if (trimmed.toLowerCase() !== symbol.toLowerCase() && !/^\d+$/.test(trimmed)) {
    fail('unknown_element', `${field} contains unsupported element ${JSON.stringify(value)}`)
  }
  return symbol
}

function finiteNumber(value: string, field: string): number {
  if (!value.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    fail('invalid_structure_number', `${field} must be a finite decimal number`)
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) fail('invalid_structure_number', `${field} must be finite`)
  return parsed
}

function cifNumber(value: string, field: string): number {
  if (value === '?' || value === '.') fail('missing_cif_value', `${field} must be explicit`)
  return finiteNumber(value.replace(/\(\d+\)$/, ''), field)
}

function quotedTokens(line: string, field: string, comments = false): string[] {
  const tokens: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  const flush = () => {
    if (token.length) {
      tokens.push(token)
      token = ''
    }
  }
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (escaped) {
      token += char
      escaped = false
      continue
    }
    if (quote && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else token += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (comments && char === '#') break
    if (/\s/.test(char)) flush()
    else token += char
  }
  if (quote || escaped) fail('invalid_quoted_text', `${field} contains an unterminated quoted value`)
  flush()
  return tokens
}

function assignment(comment: string, key: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, 'i')
  const match = comment.match(pattern)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

function parsePeriodic(value: string, field: string): [boolean, boolean, boolean] {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean)
  if (tokens.length !== 3) fail('invalid_periodicity', `${field} must contain three boolean flags`)
  const parse = (token: string): boolean => {
    if (/^(?:t|true|1)$/i.test(token)) return true
    if (/^(?:f|false|0)$/i.test(token)) return false
    return fail('invalid_periodicity', `${field} contains invalid flag ${JSON.stringify(token)}`)
  }
  return [parse(tokens[0]), parse(tokens[1]), parse(tokens[2])]
}

function samePeriodic(left: readonly boolean[], right: readonly boolean[]): boolean {
  return left.every((value, index) => value === right[index])
}

function sameLattice(left: ZatomLattice, right: ZatomLattice): boolean {
  return samePeriodic(left.periodic, right.periodic)
    && left.vectors.every((row, rowIndex) => row.every((value, axis) => (
      Math.abs(value - right.vectors[rowIndex][axis]) <= 1e-10
    )))
}

function parseExtxyzColumns(comment: string, frameIndex: number): ExtxyzPropertyColumn[] {
  const descriptor = assignment(comment, 'Properties')
  if (!descriptor) fail('missing_extxyz_properties', `extXYZ frame ${frameIndex + 1} requires Properties=`)
  const parts = descriptor.split(':')
  if (parts.length < 6 || parts.length % 3 !== 0) {
    fail('invalid_extxyz_properties', `extXYZ frame ${frameIndex + 1} has an invalid Properties descriptor`)
  }
  const columns: ExtxyzPropertyColumn[] = []
  const names = new Set<string>()
  let offset = 0
  for (let index = 0; index < parts.length; index += 3) {
    const name = parts[index]
    const type = parts[index + 1] as ExtxyzPropertyColumn['type']
    const count = Number(parts[index + 2])
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || names.has(name)
      || !['S', 'R', 'I', 'L'].includes(type) || !Number.isSafeInteger(count) || count < 1) {
      fail('invalid_extxyz_properties', `extXYZ frame ${frameIndex + 1} has an invalid Properties descriptor`)
    }
    names.add(name)
    columns.push({ name, type, count, offset })
    offset += count
  }
  const species = columns.find((column) => column.name === 'species')
  const position = columns.find((column) => column.name === 'pos')
  if (!species || species.type !== 'S' || species.count !== 1
    || !position || position.type !== 'R' || position.count !== 3) {
    fail('invalid_extxyz_properties', 'extXYZ Properties must contain species:S:1 and pos:R:3')
  }
  const idColumn = columns.find((column) => column.name === 'zatom_id')
  if (idColumn && (idColumn.type !== 'S' || idColumn.count !== 1)) {
    fail('invalid_extxyz_properties', 'extXYZ zatom_id must be declared as zatom_id:S:1')
  }
  return columns
}

function parseExtxyzValue(type: ExtxyzPropertyColumn['type'], value: string, field: string): JsonValue {
  if (type === 'S') return value
  if (type === 'R') return finiteNumber(value, field)
  if (type === 'I') {
    if (!/^[+-]?\d+$/.test(value)) fail('invalid_extxyz_value', `${field} must be an integer`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) fail('invalid_extxyz_value', `${field} must be a safe integer`)
    return parsed
  }
  if (/^(?:t|true|1)$/i.test(value)) return true
  if (/^(?:f|false|0)$/i.test(value)) return false
  return fail('invalid_extxyz_value', `${field} must be a logical value`)
}

function parseXyz(options: ImportStructureTextOptions): ParsedText {
  if (options.format === 'xyz' && (options.periodic !== undefined || options.frameTimeStepPs !== undefined)) {
    fail('unsupported_xyz_option', 'Plain XYZ does not accept periodic or frameTimeStepPs inputs')
  }
  const lines = options.text.replace(/\r\n?/g, '\n').split('\n')
  const frames: ParsedXyzFrame[] = []
  let cursor = 0
  let atomFrames = 0
  while (cursor < lines.length) {
    while (cursor < lines.length && !lines[cursor].trim()) cursor++
    if (cursor >= lines.length) break
    if (frames.length >= ZATOM_STRUCTURE_TEXT_MAX_FRAMES) {
      fail('structure_text_budget_exceeded', `XYZ exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_FRAMES}-frame limit`)
    }
    const countText = lines[cursor].trim()
    if (!/^\d+$/.test(countText)) fail('invalid_xyz_count', `XYZ frame ${frames.length + 1} atom count must be a positive integer`)
    const atomCount = Number(countText)
    if (!Number.isSafeInteger(atomCount) || atomCount < 1 || atomCount > ZATOM_STRUCTURE_TEXT_MAX_ATOMS) {
      fail('structure_text_budget_exceeded', `XYZ frame ${frames.length + 1} has unsupported atom count ${countText}`)
    }
    atomFrames += atomCount
    if (atomFrames > ZATOM_STRUCTURE_TEXT_MAX_ATOM_FRAMES) {
      fail('structure_text_budget_exceeded', `XYZ exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_ATOM_FRAMES}-atom-frame limit`)
    }
    if (cursor + 1 >= lines.length) fail('truncated_xyz_frame', `XYZ frame ${frames.length + 1} is missing its comment line`)
    const comment = lines[cursor + 1]
    const atomStart = cursor + 2
    if (atomStart + atomCount > lines.length) {
      fail('truncated_xyz_frame', `XYZ frame ${frames.length + 1} declares ${atomCount} atoms but its atom block is truncated`)
    }
    const columns = options.format === 'extxyz' ? parseExtxyzColumns(comment, frames.length) : undefined
    if (options.format === 'xyz' && /(?:^|\s)(?:Properties|Lattice|pbc)\s*=/i.test(comment)) {
      fail('wrong_structure_text_format', 'Extended XYZ metadata requires format="extxyz"')
    }
    const totalColumns = columns?.reduce((sum, column) => sum + column.count, 0) ?? 4
    const elements: string[] = []
    const positions: Vec3[] = []
    const ids: string[] = []
    const properties: Array<Record<string, JsonValue> | undefined> = []
    for (let atomIndex = 0; atomIndex < atomCount; atomIndex++) {
      const lineIndex = atomStart + atomIndex
      if (!lines[lineIndex].trim()) fail('invalid_xyz_atom', `XYZ frame ${frames.length + 1} atom ${atomIndex + 1} is blank`)
      const tokens = quotedTokens(lines[lineIndex], `XYZ frame ${frames.length + 1} atom ${atomIndex + 1}`)
      if (tokens.length !== totalColumns) {
        fail(
          'invalid_xyz_atom',
          `XYZ frame ${frames.length + 1} atom ${atomIndex + 1} has ${tokens.length} columns; expected ${totalColumns}`,
        )
      }
      if (!columns) {
        elements.push(normalizeElement(tokens[0], `XYZ frame ${frames.length + 1} atom ${atomIndex + 1}`))
        positions.push([
          finiteNumber(tokens[1], `XYZ frame ${frames.length + 1} atom ${atomIndex + 1} x`),
          finiteNumber(tokens[2], `XYZ frame ${frames.length + 1} atom ${atomIndex + 1} y`),
          finiteNumber(tokens[3], `XYZ frame ${frames.length + 1} atom ${atomIndex + 1} z`),
        ])
        properties.push(undefined)
        continue
      }
      const values = new Map<string, JsonValue>()
      for (const column of columns) {
        const parsed = Array.from({ length: column.count }, (_, component) => parseExtxyzValue(
          column.type,
          tokens[column.offset + component],
          `extXYZ frame ${frames.length + 1} atom ${atomIndex + 1} ${column.name}`,
        ))
        values.set(column.name, column.count === 1 ? parsed[0] : parsed)
      }
      const species = values.get('species')
      const position = values.get('pos')
      if (typeof species !== 'string' || !Array.isArray(position) || position.length !== 3
        || position.some((value) => typeof value !== 'number')) {
        fail('invalid_extxyz_atom', `extXYZ frame ${frames.length + 1} atom ${atomIndex + 1} has invalid species or pos data`)
      }
      elements.push(normalizeElement(species, `extXYZ frame ${frames.length + 1} atom ${atomIndex + 1}`))
      positions.push([Number(position[0]), Number(position[1]), Number(position[2])])
      const sourceId = values.get('zatom_id')
      if (sourceId !== undefined) {
        if (typeof sourceId !== 'string' || !sourceId.trim()) {
          fail('invalid_extxyz_atom_id', `extXYZ frame ${frames.length + 1} atom ${atomIndex + 1} has an empty zatom_id`)
        }
        ids.push(sourceId)
      }
      values.delete('species')
      values.delete('pos')
      values.delete('zatom_id')
      properties.push(values.size ? Object.fromEntries(values) : undefined)
    }
    const latticeText = assignment(comment, 'Lattice')
    const pbcText = assignment(comment, 'pbc')
    let lattice: ZatomLattice | undefined
    if (latticeText) {
      const values = latticeText.trim().split(/\s+/).map((value, index) => finiteNumber(value, `extXYZ Lattice[${index}]`))
      if (values.length !== 9) fail('invalid_extxyz_lattice', 'extXYZ Lattice must contain nine row-vector values')
      const periodic = pbcText ? parsePeriodic(pbcText, 'extXYZ pbc') : options.periodic
      if (!periodic) fail('missing_extxyz_periodicity', 'extXYZ Lattice requires pbc= or the periodic input field')
      if (pbcText && options.periodic && !samePeriodic(periodic, options.periodic)) {
        fail('periodicity_mismatch', 'The extXYZ pbc field does not match the periodic input field')
      }
      lattice = {
        vectors: [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)] as Mat3,
        periodic: [...periodic],
      }
      if (determinant3(lattice.vectors) <= 1e-8) {
        fail('invalid_extxyz_lattice', 'extXYZ Lattice must be right-handed and nonsingular')
      }
    } else {
      if (pbcText && parsePeriodic(pbcText, 'extXYZ pbc').some(Boolean)) {
        fail('missing_extxyz_lattice', 'extXYZ cannot declare periodic axes without Lattice')
      }
      if (options.periodic !== undefined) fail('missing_extxyz_lattice', 'periodic input requires an extXYZ Lattice')
    }
    if (ids.length && ids.length !== atomCount) {
      fail('invalid_extxyz_atom_id', 'extXYZ zatom_id must be present on every atom or none')
    }
    if (ids.length && new Set(ids).size !== ids.length) fail('duplicate_extxyz_atom_id', 'extXYZ zatom_id values must be unique')
    frames.push({ elements, positions, ...(ids.length ? { ids } : {}), properties, lattice, comment })
    cursor = atomStart + atomCount
  }
  if (!frames.length) fail('invalid_xyz', 'No XYZ frames were found')
  if (options.format === 'xyz' && frames.length !== 1) {
    fail('unsupported_xyz_trajectory', 'Plain XYZ import accepts one frame; use extxyz with frameTimeStepPs for trajectories')
  }
  const reference = frames[0]
  for (let frameIndex = 1; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]
    if (frame.elements.length !== reference.elements.length
      || frame.elements.some((element, atomIndex) => element !== reference.elements[atomIndex])) {
      fail('extxyz_identity_drift', `extXYZ frame ${frameIndex + 1} changes atom count or element order`)
    }
    if (reference.ids && (!frame.ids || frame.ids.some((id, atomIndex) => id !== reference.ids![atomIndex]))) {
      fail('extxyz_identity_drift', `extXYZ frame ${frameIndex + 1} changes zatom_id order`)
    }
    if (!reference.ids && frame.ids) fail('extxyz_identity_drift', `extXYZ frame ${frameIndex + 1} introduces zatom_id values`)
    if (!!reference.lattice !== !!frame.lattice) {
      fail('extxyz_lattice_drift', 'extXYZ trajectories must provide Lattice on every frame or none')
    }
    if (reference.lattice && frame.lattice && !samePeriodic(reference.lattice.periodic, frame.lattice.periodic)) {
      fail('extxyz_periodicity_drift', 'extXYZ periodic flags must remain constant across frames')
    }
  }
  if (frames.length > 1 && (!Number.isFinite(options.frameTimeStepPs) || options.frameTimeStepPs! <= 0)) {
    fail('missing_extxyz_time_step', 'Multi-frame extXYZ import requires a positive frameTimeStepPs')
  }
  if (frames.length === 1 && options.frameTimeStepPs !== undefined) {
    fail('unused_extxyz_time_step', 'frameTimeStepPs is only valid for multi-frame extXYZ')
  }
  const finalFrame = frames[frames.length - 1]
  const atomIds = reference.ids ?? reference.elements.map((_, index) => `atom-${String(index + 1).padStart(6, '0')}`)
  const atoms: ZatomStructureAtom[] = finalFrame.elements.map((element, index) => ({
    id: atomIds[index],
    element,
    position: [...finalFrame.positions[index]],
    ...(finalFrame.properties[index] ? { properties: finalFrame.properties[index] } : {}),
  }))
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    ...(finalFrame.lattice ? { lattice: finalFrame.lattice } : {}),
    label: options.label?.trim() || (options.format === 'extxyz' ? 'Imported extXYZ' : finalFrame.comment.trim() || 'Imported XYZ'),
  }
  let trajectory: ZatomTrajectory | undefined
  if (frames.length > 1) {
    const lattices = frames.map((frame) => frame.lattice)
    const fixedLattice = lattices[0] && lattices.every((lattice) => lattice && sameLattice(lattices[0]!, lattice))
      ? lattices[0]
      : undefined
    const rawTrajectory: ZatomTrajectory = {
      schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
      atomIds,
      coordinateMode: 'cartesian',
      frames: frames.map((frame, index) => ({
        step: index,
        timePs: index * options.frameTimeStepPs!,
        positions: frame.positions,
        ...(!fixedLattice && frame.lattice ? { lattice: frame.lattice } : {}),
      })),
      ...(fixedLattice ? { lattice: fixedLattice } : {}),
      label: `${structure.label ?? 'Imported extXYZ'} trajectory`,
      metadata: {
        'zatom.textImport.frameStepSemantics': 'source-frame-ordinal',
        'zatom.textImport.frameTimeStepPs': options.frameTimeStepPs!,
      },
    }
    trajectory = parseZatomTrajectory(rawTrajectory, { structure })
  }
  return {
    structure,
    ...(trajectory ? { trajectory } : {}),
    checks: [
      {
        id: 'structure_text.declared_counts',
        status: 'pass',
        message: `Parsed exactly ${atomFrames} declared atom rows across ${frames.length} frame${frames.length === 1 ? '' : 's'}`,
        metrics: { frameCount: frames.length, atomFrames },
      },
      {
        id: 'structure_text.trajectory_time',
        status: frames.length > 1 ? 'pass' : 'skipped',
        message: frames.length > 1
          ? `Physical frame spacing was explicitly supplied as ${options.frameTimeStepPs} ps; source frame ordinals are canonical steps`
          : 'Single-frame input does not require trajectory time',
      },
    ],
    limitations: options.format === 'xyz'
      ? ['Plain XYZ carries geometry only; bond topology, periodicity, stable source IDs, and atom properties are unavailable.']
      : [
          'Free-form extXYZ comments and frame scalar metadata are not mapped into canonical trajectory observables.',
          ...(frames.length > 1 && frames.some((frame) => frame.properties.some(Boolean))
            ? ['Per-frame auxiliary atom properties are retained on the final canonical structure only; trajectory frames carry positions and lattice evidence.']
            : []),
        ],
  }
}

function cifTag(lines: string[], tag: string): string | undefined {
  const lower = tag.toLowerCase()
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim()
    if (!trimmed.toLowerCase().startsWith(lower)) continue
    const boundary = trimmed[lower.length]
    if (boundary && !/\s/.test(boundary)) continue
    const values = quotedTokens(trimmed.slice(lower.length).trim(), `${tag} value`, true)
    if (values.length !== 1) fail('unsupported_cif_syntax', `${tag} must have one inline scalar value`)
    return values[0]
  }
  return undefined
}

interface CifLoop { headers: string[]; rows: string[][] }

function cifLoops(lines: string[]): CifLoop[] {
  const loops: CifLoop[] = []
  for (let cursor = 0; cursor < lines.length; cursor++) {
    if (lines[cursor].trim().toLowerCase() !== 'loop_') continue
    const headers: string[] = []
    let rowCursor = cursor + 1
    while (rowCursor < lines.length && lines[rowCursor].trim().startsWith('_')) {
      const tokens = quotedTokens(lines[rowCursor].trim(), `CIF loop header line ${rowCursor + 1}`, true)
      if (tokens.length !== 1) fail('unsupported_cif_syntax', `CIF loop header line ${rowCursor + 1} is not supported`)
      headers.push(tokens[0].toLowerCase())
      rowCursor++
    }
    if (!headers.length) fail('invalid_cif_loop', `CIF loop at line ${cursor + 1} has no headers`)
    const rows: string[][] = []
    while (rowCursor < lines.length) {
      const trimmed = lines[rowCursor].trim()
      if (!trimmed || trimmed === '#' || /^loop_|^data_|^save_|^stop_|^_/i.test(trimmed)) break
      if (trimmed.startsWith(';')) fail('unsupported_cif_syntax', 'CIF semicolon text fields are outside the strict P1 geometry scope')
      const values = quotedTokens(trimmed, `CIF loop row ${rowCursor + 1}`, true)
      if (values.length !== headers.length) {
        fail('invalid_cif_loop', `CIF loop row ${rowCursor + 1} has ${values.length} values; expected ${headers.length}`)
      }
      rows.push(values)
      rowCursor++
    }
    loops.push({ headers, rows })
  }
  return loops
}

function parseCif(options: ImportStructureTextOptions): ParsedText {
  if (options.periodic || options.frameTimeStepPs !== undefined) {
    fail('unsupported_cif_option', 'CIF defines full periodicity and does not accept periodic or frameTimeStepPs inputs')
  }
  const lines = options.text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.some((line) => line.startsWith(';'))) {
    fail('unsupported_cif_syntax', 'CIF semicolon text fields are outside the strict P1 geometry scope')
  }
  const loops = cifLoops(lines)
  const spaceGroup = cifTag(lines, '_space_group_name_h-m_alt') ?? cifTag(lines, '_symmetry_space_group_name_h-m')
  const spaceGroupNumber = cifTag(lines, '_space_group_it_number') ?? cifTag(lines, '_symmetry_int_tables_number')
  const symLoop = loops.find((loop) => loop.headers.some((header) => (
    header === '_space_group_symop_operation_xyz' || header === '_symmetry_equiv_pos_as_xyz'
  )))
  const identitySymmetry = !!symLoop && symLoop.rows.length === 1 && symLoop.rows.every((row) => {
    const index = symLoop.headers.findIndex((header) => (
      header === '_space_group_symop_operation_xyz' || header === '_symmetry_equiv_pos_as_xyz'
    ))
    return row[index].toLowerCase().replace(/\s/g, '') === 'x,y,z'
  })
  if (spaceGroup && spaceGroup.toUpperCase().replace(/[\s']/g, '') !== 'P1') {
    fail('unsupported_cif_symmetry', `Strict CIF import accepts P1 only; found ${spaceGroup}`)
  }
  if (spaceGroupNumber && Number(spaceGroupNumber) !== 1) {
    fail('unsupported_cif_symmetry', `Strict CIF import accepts space-group number 1 only; found ${spaceGroupNumber}`)
  }
  if (symLoop && !identitySymmetry) fail('unsupported_cif_symmetry', 'Strict CIF import accepts only the identity symmetry operation')
  if (!spaceGroup && !spaceGroupNumber && !identitySymmetry) {
    fail('ambiguous_cif_symmetry', 'CIF must explicitly declare P1 or an identity-only symmetry loop')
  }
  const requiredCellTags = [
    '_cell_length_a', '_cell_length_b', '_cell_length_c',
    '_cell_angle_alpha', '_cell_angle_beta', '_cell_angle_gamma',
  ] as const
  const cellValues = requiredCellTags.map((tag) => {
    const value = cifTag(lines, tag)
    if (value === undefined) fail('missing_cif_cell', `CIF requires ${tag}`)
    return cifNumber(value, tag)
  })
  const [a, b, c, alpha, beta, gamma] = cellValues
  if (a <= 0 || b <= 0 || c <= 0 || [alpha, beta, gamma].some((angle) => angle <= 0 || angle >= 180)) {
    fail('invalid_cif_cell', 'CIF cell lengths must be positive and angles must lie strictly between 0 and 180 degrees')
  }
  const rawVectors = calculateLatticeVectors({ a, b, c, alpha, beta, gamma })
  const vectors: Mat3 = [rawVectors.a, rawVectors.b, rawVectors.c]
  if (determinant3(vectors) <= 1e-8) fail('invalid_cif_cell', 'CIF cell must be right-handed and nonsingular')
  const atomLoops = loops.filter((loop) => (
    loop.headers.includes('_atom_site_fract_x')
    || loop.headers.includes('_atom_site_cartn_x')
  ))
  if (atomLoops.length !== 1) fail('missing_cif_atoms', 'CIF requires exactly one coordinate-bearing atom-site loop')
  const atomLoop = atomLoops[0]
  if (!atomLoop.rows.length) fail('missing_cif_atoms', 'CIF requires a non-empty atom-site loop')
  if (atomLoop.rows.length > ZATOM_STRUCTURE_TEXT_MAX_ATOMS) {
    fail('structure_text_budget_exceeded', `CIF exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_ATOMS}-atom limit`)
  }
  const find = (...names: string[]) => atomLoop.headers.findIndex((header) => names.includes(header))
  const labelIndex = find('_atom_site_label')
  const typeIndex = find('_atom_site_type_symbol')
  const xIndex = find('_atom_site_fract_x')
  const yIndex = find('_atom_site_fract_y')
  const zIndex = find('_atom_site_fract_z')
  const occupancyIndex = find('_atom_site_occupancy')
  const chargeIndex = find('_atom_site_charge')
  if (typeIndex < 0 && labelIndex < 0) fail('missing_cif_atoms', 'CIF atom sites require type_symbol or label')
  if ([xIndex, yIndex, zIndex].some((index) => index < 0)) {
    fail('unsupported_cif_coordinates', 'Strict CIF import requires explicit fractional coordinates')
  }
  const supportedHeaders = new Set([
    '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y',
    '_atom_site_fract_z', '_atom_site_occupancy', '_atom_site_charge',
  ])
  const ignoredHeaders = atomLoop.headers.filter((header) => !supportedHeaders.has(header))
  const usedIds = new Set<string>()
  const atoms = atomLoop.rows.map((row, index): ZatomStructureAtom => {
    const rawElement = typeIndex >= 0 ? row[typeIndex] : row[labelIndex].match(/^[A-Za-z]{1,2}/)?.[0] ?? ''
    const element = normalizeElement(rawElement, `CIF atom ${index + 1}`)
    const fractional: Vec3 = [
      cifNumber(row[xIndex], `CIF atom ${index + 1} fract_x`),
      cifNumber(row[yIndex], `CIF atom ${index + 1} fract_y`),
      cifNumber(row[zIndex], `CIF atom ${index + 1} fract_z`),
    ]
    if (occupancyIndex >= 0) {
      const occupancy = cifNumber(row[occupancyIndex], `CIF atom ${index + 1} occupancy`)
      if (Math.abs(occupancy - 1) > 1e-12) {
        fail('unsupported_cif_occupancy', `CIF atom ${index + 1} has occupancy ${occupancy}; strict import requires full occupancy`)
      }
    }
    let id = labelIndex >= 0 ? row[labelIndex].trim() : ''
    if (!id || usedIds.has(id)) id = `atom-${String(index + 1).padStart(6, '0')}`
    if (usedIds.has(id)) fail('duplicate_cif_atom_id', `CIF atom label ${JSON.stringify(id)} is duplicated`)
    usedIds.add(id)
    let properties: Record<string, JsonValue> | undefined
    if (chargeIndex >= 0) {
      const charge = cifNumber(row[chargeIndex], `CIF atom ${index + 1} charge`)
      if (!Number.isSafeInteger(charge)) fail('invalid_cif_charge', `CIF atom ${index + 1} charge must be an integer`)
      properties = { formalCharge: charge }
    }
    return { id, element, position: fractionalToCartesian(fractional, vectors), ...(properties ? { properties } : {}) }
  })
  const dataLine = lines.find((line) => /^\s*data_/i.test(line))?.trim().slice(5).replace(/_/g, ' ').trim()
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: { vectors, periodic: [true, true, true] },
    label: options.label?.trim() || dataLine || 'Imported P1 CIF',
  }
  const limitations = [
    'CIF import is intentionally limited to explicit, fully occupied P1 atom-site geometry; non-identity symmetry and disorder are rejected.',
    'Non-geometric CIF data-block metadata is not copied into the canonical structure.',
    ...(ignoredHeaders.length ? [`Ignored non-geometric atom-site columns: ${ignoredHeaders.join(', ')}.`] : []),
  ]
  return {
    structure,
    checks: [
      {
        id: 'structure_text.cif_scope',
        status: ignoredHeaders.length ? 'warn' : 'pass',
        message: ignoredHeaders.length
          ? `Parsed full-occupancy P1 geometry and ignored ${ignoredHeaders.length} non-geometric atom-site columns`
          : 'Parsed explicit full-occupancy P1 geometry without symmetry expansion',
        metrics: { atomCount: atoms.length, ignoredAtomSiteColumnCount: ignoredHeaders.length },
      },
    ],
    limitations,
  }
}

interface ParsedVaspHeader {
  title: string
  scaleFactors: Vec3
  scaleMode: 'universal' | 'target-volume' | 'cartesian-components'
  targetVolumeA3?: number
  vectors: Mat3
  volumeA3: number
  species: string[]
  counts: number[]
  elements: string[]
  atomCount: number
  nextLine: number
}

function parseVaspHeader(lines: string[], startLine: number, format: 'POSCAR' | 'XDATCAR'): ParsedVaspHeader {
  const lower = format.toLowerCase()
  if (startLine + 7 > lines.length) {
    fail(`invalid_${lower}`, `${format} requires a comment, scale, three lattice vectors, species, and counts`)
  }
  const title = lines[startLine].trim()
  const scaleTokens = lines[startLine + 1].trim().split(/\s+/).filter(Boolean)
  if (scaleTokens.length !== 1 && scaleTokens.length !== 3) {
    fail(`invalid_${lower}_scale`, `${format} scale line must contain one universal/volume value or three Cartesian component factors`)
  }
  const scaleValues = scaleTokens.map((value, index) => finiteNumber(value, `${format} scale[${index}]`))
  const rawVectors = [startLine + 2, startLine + 3, startLine + 4].map((lineIndex): Vec3 => {
    const tokens = lines[lineIndex].trim().split(/\s+/).filter(Boolean)
    if (tokens.length !== 3) fail(`invalid_${lower}_lattice`, `${format} lattice line ${lineIndex + 1} must contain exactly three numbers`)
    return tokens.map((value, axis) => finiteNumber(value, `${format} lattice[${lineIndex - startLine - 2}][${axis}]`)) as Vec3
  }) as Mat3
  const rawDeterminant = determinant3(rawVectors)
  if (!Number.isFinite(rawDeterminant) || rawDeterminant <= 1e-12) {
    fail(`invalid_${lower}_lattice`, `${format} unscaled lattice must be right-handed and nonsingular`)
  }
  let scaleFactors: Vec3
  let scaleMode: 'universal' | 'target-volume' | 'cartesian-components'
  let targetVolumeA3: number | undefined
  if (scaleValues.length === 1) {
    const scale = scaleValues[0]
    if (scale === 0) fail(`invalid_${lower}_scale`, `${format} universal scale must be nonzero`)
    if (scale < 0) {
      targetVolumeA3 = Math.abs(scale)
      const factor = Math.cbrt(targetVolumeA3 / rawDeterminant)
      scaleFactors = [factor, factor, factor]
      scaleMode = 'target-volume'
    } else {
      scaleFactors = [scale, scale, scale]
      scaleMode = 'universal'
    }
  } else {
    if (scaleValues.some((value) => value <= 0)) {
      fail(`invalid_${lower}_scale`, `All three ${format} Cartesian component scale factors must be positive`)
    }
    scaleFactors = [scaleValues[0], scaleValues[1], scaleValues[2]]
    scaleMode = 'cartesian-components'
  }
  const vectors = rawVectors.map((row) => row.map((value, axis) => value * scaleFactors[axis]) as Vec3) as Mat3
  const volumeA3 = determinant3(vectors)
  if (!Number.isFinite(volumeA3) || volumeA3 <= 1e-8) {
    fail(`invalid_${lower}_lattice`, `Scaled ${format} lattice must be right-handed and nonsingular`)
  }
  if (targetVolumeA3 !== undefined && Math.abs(volumeA3 - targetVolumeA3) > Math.max(1e-8, targetVolumeA3 * 1e-10)) {
    fail(`invalid_${lower}_scale`, `${format} target-volume scaling could not reproduce the requested cell volume`)
  }

  const speciesTokens = lines[startLine + 5].trim().split(/\s+/).filter(Boolean)
  if (!speciesTokens.length) fail(`missing_${lower}_species`, `${format} species line must be non-empty`)
  if (speciesTokens.every((token) => /^\d+$/.test(token))) {
    fail(`unsupported_${lower}_vasp4`, `VASP 4 ${format} omits species names; canonical import requires an explicit VASP 5 species line`)
  }
  const species = speciesTokens.map((token, index) => normalizeElement(token, `${format} species[${index}]`))
  if (new Set(species).size !== species.length) {
    fail(`duplicate_${lower}_species`, `${format} species names must be unique because canonical elements cannot distinguish repeated POTCAR groups`)
  }
  const countTokens = lines[startLine + 6].trim().split(/\s+/).filter(Boolean)
  if (countTokens.length !== species.length) fail(`invalid_${lower}_counts`, `${format} species and count columns must have equal length`)
  const counts = countTokens.map((token, index) => {
    if (!/^\d+$/.test(token)) fail(`invalid_${lower}_counts`, `${format} count[${index}] must be a positive integer`)
    const count = Number(token)
    if (!Number.isSafeInteger(count) || count < 1) fail(`invalid_${lower}_counts`, `${format} count[${index}] must be a positive safe integer`)
    return count
  })
  const atomCount = counts.reduce((sum, count) => sum + count, 0)
  if (atomCount > ZATOM_STRUCTURE_TEXT_MAX_ATOMS) {
    fail('structure_text_budget_exceeded', `${format} exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_ATOMS}-atom limit`)
  }
  return {
    title,
    scaleFactors,
    scaleMode,
    ...(targetVolumeA3 === undefined ? {} : { targetVolumeA3 }),
    vectors,
    volumeA3,
    species,
    counts,
    elements: species.flatMap((element, speciesIndex) => Array<string>(counts[speciesIndex]).fill(element)),
    atomCount,
    nextLine: startLine + 7,
  }
}

function parsePoscar(options: ImportStructureTextOptions): ParsedText {
  if (options.periodic !== undefined || options.frameTimeStepPs !== undefined) {
    fail('unsupported_poscar_option', 'POSCAR defines full periodicity and does not accept periodic or frameTimeStepPs inputs')
  }
  const lines = options.text.replace(/\r\n?/g, '\n').split('\n')
  const header = parseVaspHeader(lines, 0, 'POSCAR')
  const { atomCount, elements, scaleFactors, scaleMode, targetVolumeA3, title, vectors, volumeA3 } = header

  let cursor = header.nextLine
  const selective = /^s/i.test(lines[cursor]?.trim() ?? '')
  if (selective) cursor++
  const coordinateMode = lines[cursor]?.trim() ?? ''
  if (!coordinateMode) fail('missing_poscar_coordinate_mode', 'POSCAR coordinate mode is missing')
  const modeInitial = coordinateMode[0].toLowerCase()
  const cartesian = modeInitial === 'c' || modeInitial === 'k'
  if (!cartesian && modeInitial !== 'd') {
    fail('invalid_poscar_coordinate_mode', 'Strict POSCAR import accepts Direct, Cartesian, or K-point-style Cartesian mode explicitly')
  }
  cursor++
  if (cursor + atomCount > lines.length) {
    fail('truncated_poscar_positions', `POSCAR declares ${atomCount} atoms but its position block is truncated`)
  }
  const atoms: ZatomStructureAtom[] = []
  const constrainedAtomIds: string[] = []
  let fullyFixedCount = 0
  for (let atomIndex = 0; atomIndex < atomCount; atomIndex++) {
    const tokens = lines[cursor + atomIndex].trim().split(/\s+/).filter(Boolean)
    const expectedColumns = selective ? 6 : 3
    if (tokens.length !== expectedColumns) {
      fail('invalid_poscar_position', `POSCAR atom ${atomIndex + 1} has ${tokens.length} columns; expected ${expectedColumns}`)
    }
    const sourcePosition: Vec3 = [
      finiteNumber(tokens[0], `POSCAR atom ${atomIndex + 1} x`),
      finiteNumber(tokens[1], `POSCAR atom ${atomIndex + 1} y`),
      finiteNumber(tokens[2], `POSCAR atom ${atomIndex + 1} z`),
    ]
    const position: Vec3 = cartesian
      ? sourcePosition.map((value, axis) => value * scaleFactors[axis]) as Vec3
      : fractionalToCartesian(sourcePosition, vectors)
    const id = `atom-${String(atomIndex + 1).padStart(6, '0')}`
    let properties: Record<string, JsonValue> | undefined
    if (selective) {
      const flags = tokens.slice(3).map((token) => {
        if (/^t$/i.test(token)) return true
        if (/^f$/i.test(token)) return false
        return fail('invalid_poscar_selective_dynamics', `POSCAR atom ${atomIndex + 1} selective-dynamics flags must be T or F`)
      }) as [boolean, boolean, boolean]
      properties = { [ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY]: flags }
      if (flags.some((flag) => !flag)) constrainedAtomIds.push(id)
      if (flags.every((flag) => !flag)) fullyFixedCount++
    }
    atoms.push({ id, element: elements[atomIndex], position, ...(properties ? { properties } : {}) })
  }
  cursor += atomCount
  if (lines.slice(cursor).some((line) => line.trim())) {
    fail('unsupported_poscar_tail', 'POSCAR lattice velocities, ion velocities, predictor-corrector data, and unknown trailing sections are not imported')
  }
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: { vectors, periodic: [true, true, true] },
    label: options.label?.trim() || title || 'Imported POSCAR',
  }
  return {
    structure,
    checks: [
      {
        id: 'structure_text.poscar_scaling',
        status: 'pass',
        message: `Applied ${scaleMode} POSCAR scaling to a ${volumeA3.toFixed(6)} Å³ right-handed cell`,
        metrics: {
          scaleMode,
          scaleFactors: scaleFactors.map(decimal).join(' '),
          volumeA3,
          targetVolumeA3: targetVolumeA3 ?? null,
        },
      },
      {
        id: 'structure_text.poscar_selective_dynamics',
        status: selective ? 'pass' : 'skipped',
        message: selective
          ? `Preserved direct-axis selective-dynamics flags for ${atoms.length} atoms (${constrainedAtomIds.length} constrained, ${fullyFixedCount} fully fixed)`
          : 'POSCAR does not declare selective dynamics',
        metrics: { selectiveDynamics: selective, constrainedAtomCount: constrainedAtomIds.length, fullyFixedAtomCount: fullyFixedCount },
        atomIds: constrainedAtomIds.slice(0, 80),
      },
    ],
    limitations: [
      'POSCAR species names are interpreted as elements, but the actual VASP calculation identity and pseudopotentials remain defined by the matching POTCAR.',
      'Lattice/ion velocities, predictor-corrector data, and unknown CONTCAR tail sections are rejected rather than discarded.',
    ],
  }
}

interface ParsedXdatcarFrame {
  sourceConfiguration: number
  positions: Vec3[]
  lattice: ZatomLattice
}

function parseXdatcar(options: ImportStructureTextOptions): ParsedText {
  if (options.periodic !== undefined) {
    fail('unsupported_xdatcar_option', 'XDATCAR defines full periodicity and does not accept periodic input')
  }
  const lines = options.text.replace(/\r\n?/g, '\n').split('\n')
  const firstHeader = parseVaspHeader(lines, 0, 'XDATCAR')
  let currentHeader = firstHeader
  let cursor = firstHeader.nextLine
  let headerCount = 1
  let atomFrames = 0
  const frames: ParsedXdatcarFrame[] = []
  const configurationPattern = /^Direct\s+configuration\s*=\s*(\d+)\s*$/i
  const skipBlankLines = () => {
    while (cursor < lines.length && !lines[cursor].trim()) cursor++
  }
  skipBlankLines()
  while (cursor < lines.length) {
    if (frames.length >= ZATOM_STRUCTURE_TEXT_MAX_FRAMES) {
      fail('structure_text_budget_exceeded', `XDATCAR exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_FRAMES}-frame limit`)
    }
    const configurationMatch = lines[cursor].trim().match(configurationPattern)
    if (!configurationMatch) {
      fail('invalid_xdatcar_configuration', `XDATCAR line ${cursor + 1} must be a Direct configuration header`)
    }
    const sourceConfiguration = Number(configurationMatch[1])
    if (!Number.isSafeInteger(sourceConfiguration) || sourceConfiguration < 1) {
      fail('invalid_xdatcar_configuration', `XDATCAR configuration ${configurationMatch[1]} must be a positive safe integer`)
    }
    const previousConfiguration = frames.at(-1)?.sourceConfiguration
    if (previousConfiguration !== undefined && sourceConfiguration <= previousConfiguration) {
      fail('invalid_xdatcar_configuration', 'XDATCAR configuration numbers must be strictly increasing')
    }
    cursor++
    if (cursor + currentHeader.atomCount > lines.length) {
      fail('truncated_xdatcar_positions', `XDATCAR configuration ${sourceConfiguration} declares ${currentHeader.atomCount} atoms but its coordinate block is truncated`)
    }
    atomFrames += currentHeader.atomCount
    if (atomFrames > ZATOM_STRUCTURE_TEXT_MAX_ATOM_FRAMES) {
      fail('structure_text_budget_exceeded', `XDATCAR exceeds the ${ZATOM_STRUCTURE_TEXT_MAX_ATOM_FRAMES}-atom-frame limit`)
    }
    const positions = Array.from({ length: currentHeader.atomCount }, (_, atomIndex): Vec3 => {
      const tokens = lines[cursor + atomIndex].trim().split(/\s+/).filter(Boolean)
      if (tokens.length !== 3) {
        fail('invalid_xdatcar_position', `XDATCAR configuration ${sourceConfiguration} atom ${atomIndex + 1} must contain exactly three direct coordinates`)
      }
      const fractional: Vec3 = [
        finiteNumber(tokens[0], `XDATCAR configuration ${sourceConfiguration} atom ${atomIndex + 1} x`),
        finiteNumber(tokens[1], `XDATCAR configuration ${sourceConfiguration} atom ${atomIndex + 1} y`),
        finiteNumber(tokens[2], `XDATCAR configuration ${sourceConfiguration} atom ${atomIndex + 1} z`),
      ]
      return fractionalToCartesian(fractional, currentHeader.vectors)
    })
    frames.push({
      sourceConfiguration,
      positions,
      lattice: { vectors: currentHeader.vectors, periodic: [true, true, true] },
    })
    cursor += currentHeader.atomCount
    skipBlankLines()
    if (cursor >= lines.length || configurationPattern.test(lines[cursor].trim())) continue

    const nextHeader = parseVaspHeader(lines, cursor, 'XDATCAR')
    if (nextHeader.elements.length !== firstHeader.elements.length
      || nextHeader.elements.some((element, atomIndex) => element !== firstHeader.elements[atomIndex])) {
      fail('xdatcar_identity_drift', `XDATCAR header ${headerCount + 1} changes atom count or element order`)
    }
    currentHeader = nextHeader
    headerCount++
    cursor = nextHeader.nextLine
    skipBlankLines()
  }
  if (!frames.length) fail('invalid_xdatcar', 'XDATCAR does not contain any Direct configuration blocks')
  if (frames.length > 1 && (!Number.isFinite(options.frameTimeStepPs) || options.frameTimeStepPs! <= 0)) {
    fail('missing_xdatcar_time_step', 'Multi-frame XDATCAR import requires a positive frameTimeStepPs between stored configurations')
  }
  if (frames.length === 1 && options.frameTimeStepPs !== undefined) {
    fail('unused_xdatcar_time_step', 'frameTimeStepPs is only valid for multi-frame XDATCAR')
  }

  const atomIds = firstHeader.elements.map((_, index) => `atom-${String(index + 1).padStart(6, '0')}`)
  const finalFrame = frames[frames.length - 1]
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms: firstHeader.elements.map((element, index) => ({
      id: atomIds[index],
      element,
      position: [...finalFrame.positions[index]],
    })),
    lattice: finalFrame.lattice,
    label: options.label?.trim() || firstHeader.title || 'Imported XDATCAR',
  }
  let trajectory: ZatomTrajectory | undefined
  const fixedLattice = frames.every((frame) => sameLattice(frames[0].lattice, frame.lattice))
    ? frames[0].lattice
    : undefined
  if (frames.length > 1) {
    trajectory = parseZatomTrajectory({
      schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
      atomIds,
      coordinateMode: 'cartesian',
      frames: frames.map((frame, index) => ({
        step: frame.sourceConfiguration,
        timePs: index * options.frameTimeStepPs!,
        positions: frame.positions,
        ...(!fixedLattice ? { lattice: frame.lattice } : {}),
      })),
      ...(fixedLattice ? { lattice: fixedLattice } : {}),
      label: `${structure.label ?? 'Imported XDATCAR'} trajectory`,
      metadata: {
        'zatom.textImport.frameStepSemantics': 'source-xdatcar-configuration-number',
        'zatom.textImport.frameTimeSemantics': 'caller-supplied-stored-configuration-spacing',
        'zatom.textImport.frameTimeStepPs': options.frameTimeStepPs!,
      },
    }, { structure })
  }
  return {
    structure,
    ...(trajectory ? { trajectory } : {}),
    checks: [
      {
        id: 'structure_text.xdatcar_counts',
        status: 'pass',
        message: `Parsed ${frames.length} ordered configuration${frames.length === 1 ? '' : 's'} with ${atomFrames} exact atom rows`,
        metrics: { frameCount: frames.length, atomFrames, headerCount, atomCount: firstHeader.atomCount },
      },
      {
        id: 'structure_text.xdatcar_identity',
        status: 'pass',
        message: 'Every repeated header preserves the initial VASP 5 species and atom order',
        metrics: { headerCount, speciesCount: firstHeader.species.length },
      },
      {
        id: 'structure_text.xdatcar_lattice',
        status: 'pass',
        message: fixedLattice
          ? 'All configurations share one fixed right-handed periodic lattice'
          : 'Every configuration carries a right-handed periodic lattice and the canonical trajectory preserves variable cells',
        metrics: { fixedLattice: fixedLattice !== undefined, headerCount },
      },
      {
        id: 'structure_text.trajectory_time',
        status: frames.length > 1 ? 'pass' : 'skipped',
        message: frames.length > 1
          ? `Physical spacing between stored configurations was explicitly supplied as ${options.frameTimeStepPs} ps`
          : 'Single-configuration XDATCAR does not require trajectory time',
      },
    ],
    limitations: [
      'XDATCAR species names are interpreted as elements, but calculation identity and pseudopotentials remain defined by the matching POTCAR.',
      'XDATCAR does not preserve velocities, forces, energies, stress, selective-dynamics flags, or constraints.',
      ...(frames.length > 1
        ? ['Physical time is caller-supplied spacing between stored configurations because XDATCAR alone cannot establish POTIM or NBLOCK.']
        : []),
    ],
  }
}

function parseMolV2000(options: ImportStructureTextOptions): ParsedText {
  if (options.periodic || options.frameTimeStepPs !== undefined) {
    fail('unsupported_mol_option', 'MOL V2000 is finite and does not accept periodic or frameTimeStepPs inputs')
  }
  const lines = options.text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length < 5 || !lines[3]?.includes('V2000')) fail('invalid_mol_v2000', 'MOL requires a V2000 counts line at line 4')
  if (lines[3].includes('V3000')) fail('unsupported_mol_version', 'V3000 MOL is not supported')
  const unsupportedCountsFlags = [6, 9, 12, 15, 18, 21, 24, 27]
    .map((start) => Number(lines[3].slice(start, start + 3).trim() || '0'))
  if (unsupportedCountsFlags.some((value) => !Number.isSafeInteger(value) || value !== 0)) {
    fail('unsupported_mol_counts_flags', 'MOL V2000 chiral, property-count, and legacy counts flags are not supported')
  }
  const atomCount = Number(lines[3].slice(0, 3).trim())
  const bondCount = Number(lines[3].slice(3, 6).trim())
  if (!Number.isSafeInteger(atomCount) || atomCount < 1 || atomCount > Math.min(999, ZATOM_STRUCTURE_TEXT_MAX_ATOMS)
    || !Number.isSafeInteger(bondCount) || bondCount < 0 || bondCount > 999) {
    fail('invalid_mol_counts', 'MOL V2000 counts must contain 1-999 atoms and 0-999 bonds')
  }
  const atomStart = 4
  const bondStart = atomStart + atomCount
  if (bondStart + bondCount > lines.length) fail('truncated_mol_v2000', 'MOL atom or bond block is truncated')
  const chargeCodes = new Map<number, number>()
  const atoms: ZatomStructureAtom[] = []
  for (let index = 0; index < atomCount; index++) {
    const line = lines[atomStart + index] ?? ''
    if (line.length < 39) fail('invalid_mol_atom', `MOL atom ${index + 1} is shorter than the V2000 fixed-width atom record`)
    const massDifference = Number(line.slice(34, 36).trim() || '0')
    const chargeCode = Number(line.slice(36, 39).trim() || '0')
    const stereoParity = Number(line.slice(39, 42).trim() || '0')
    const unsupportedFlags = [42, 45, 48, 51, 54, 57, 60, 63, 66]
      .map((start) => Number(line.slice(start, start + 3).trim() || '0'))
    if (![massDifference, chargeCode, stereoParity].every(Number.isSafeInteger)) fail('invalid_mol_atom', `MOL atom ${index + 1} flags are invalid`)
    if (massDifference !== 0) fail('unsupported_mol_isotope', 'MOL atom mass-difference fields are not supported')
    if (stereoParity !== 0) fail('unsupported_mol_stereo', 'MOL atom stereo parity is not supported')
    if (unsupportedFlags.some((value) => !Number.isSafeInteger(value) || value !== 0)) {
      fail('unsupported_mol_atom_flags', `MOL atom ${index + 1} uses unsupported query, valence, mapping, or reaction flags`)
    }
    if (chargeCode === 4 || chargeCode < 0 || chargeCode > 7) fail('unsupported_mol_charge_code', `MOL atom ${index + 1} uses unsupported charge/radical code ${chargeCode}`)
    const chargeMap: Record<number, number> = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 }
    if (chargeMap[chargeCode] !== undefined) chargeCodes.set(index, chargeMap[chargeCode])
    atoms.push({
      id: `atom-${String(index + 1).padStart(6, '0')}`,
      element: normalizeElement(line.slice(31, 34), `MOL atom ${index + 1}`),
      position: [
        finiteNumber(line.slice(0, 10), `MOL atom ${index + 1} x`),
        finiteNumber(line.slice(10, 20), `MOL atom ${index + 1} y`),
        finiteNumber(line.slice(20, 30), `MOL atom ${index + 1} z`),
      ],
    })
  }
  const bonds: ZatomStructureBond[] = []
  const pairs = new Set<string>()
  for (let index = 0; index < bondCount; index++) {
    const line = lines[bondStart + index] ?? ''
    if (line.length < 12) fail('invalid_mol_bond', `MOL bond ${index + 1} is shorter than the V2000 fixed-width bond record`)
    const first = Number(line.slice(0, 3).trim()) - 1
    const second = Number(line.slice(3, 6).trim()) - 1
    const sourceOrder = Number(line.slice(6, 9).trim())
    const stereo = Number(line.slice(9, 12).trim() || '0')
    const unsupportedFlags = [12, 15, 18].map((start) => Number(line.slice(start, start + 3).trim() || '0'))
    if (![first, second, sourceOrder, stereo].every(Number.isSafeInteger)
      || first < 0 || second < 0 || first >= atomCount || second >= atomCount || first === second) {
      fail('invalid_mol_bond', `MOL bond ${index + 1} has invalid endpoints or flags`)
    }
    if (stereo !== 0) fail('unsupported_mol_stereo', 'MOL bond stereo is not supported')
    if (unsupportedFlags.some((value) => !Number.isSafeInteger(value) || value !== 0)) {
      fail('unsupported_mol_bond_flags', `MOL bond ${index + 1} uses unsupported topology or reaction flags`)
    }
    if (![1, 2, 3, 4].includes(sourceOrder)) fail('unsupported_mol_bond_order', `MOL bond ${index + 1} uses unsupported order ${sourceOrder}`)
    const pair = first < second ? `${first}:${second}` : `${second}:${first}`
    if (pairs.has(pair)) fail('duplicate_mol_bond', `MOL contains duplicate bond pair ${first + 1}-${second + 1}`)
    pairs.add(pair)
    bonds.push({
      id: `bond-${String(index + 1).padStart(6, '0')}`,
      atomIds: [atoms[first].id, atoms[second].id],
      order: sourceOrder === 4 ? 1.5 : sourceOrder as 1 | 2 | 3,
    })
  }
  let cursor = bondStart + bondCount
  let foundEnd = false
  while (cursor < lines.length) {
    const line = lines[cursor]
    if (line.startsWith('M  END')) {
      foundEnd = true
      cursor++
      break
    }
    if (line.startsWith('M  CHG')) {
      const tokens = line.trim().split(/\s+/)
      const count = Number(tokens[2])
      if (!Number.isSafeInteger(count) || count < 1 || count > 8 || tokens.length !== 3 + count * 2) {
        fail('invalid_mol_charge_record', 'M  CHG record is malformed')
      }
      for (let index = 0; index < count; index++) {
        const atomIndex = Number(tokens[3 + index * 2]) - 1
        const charge = Number(tokens[4 + index * 2])
        if (!Number.isSafeInteger(atomIndex) || atomIndex < 0 || atomIndex >= atomCount
          || !Number.isSafeInteger(charge) || charge < -15 || charge > 15 || charge === 0) {
          fail('invalid_mol_charge_record', 'M  CHG record contains an invalid atom index or charge')
        }
        chargeCodes.set(atomIndex, charge)
      }
      cursor++
      continue
    }
    if (!line.trim()) {
      cursor++
      continue
    }
    if (line.startsWith('M  ')) fail('unsupported_mol_record', `Unsupported MOL record ${line.slice(0, 6).trim()}`)
    fail('invalid_mol_v2000', `Unexpected MOL content before M  END at line ${cursor + 1}`)
  }
  if (!foundEnd) fail('truncated_mol_v2000', 'MOL is missing M  END')
  if (lines.slice(cursor).some((line) => line.trim())) {
    fail('unsupported_sdf_data', 'SDF data fields or multiple records are not accepted by format="mol-v2000"')
  }
  for (const [index, charge] of chargeCodes) atoms[index].properties = { formalCharge: charge }
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    bonds,
    label: options.label?.trim() || lines[0].trim() || 'Imported MOL V2000',
  }
  return {
    structure,
    checks: [{
      id: 'structure_text.mol_topology',
      status: 'pass',
      message: `Parsed ${atoms.length} atoms, ${bonds.length} explicit bonds, and ${chargeCodes.size} nonzero formal charges`,
      metrics: { atomCount: atoms.length, bondCount: bonds.length, chargedAtomCount: chargeCodes.size },
    }],
    limitations: [
      'MOL V2000 stereo, isotope, radical, query, and SDF data semantics are rejected rather than discarded.',
      'The MOL program and comment header lines are not copied into canonical metadata.',
    ],
  }
}

function overviewTarget(structure: ZatomStructure): InspectionTarget[] {
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  if (!bounds) return []
  const atomIds = structure.atoms.slice(0, 256).map((atom) => atom.id)
  return [{
    id: 'structure-text-import-overview',
    reason: 'Inspect the complete imported geometry before accepting the candidate',
    center: bounds.center,
    radius: Math.max(bounds.radius, 1),
    atomIds,
    ...(structure.atoms.length > atomIds.length ? { atomIdsTruncated: true } : {}),
  }]
}

function trajectoryEndpointTargets(trajectory: ZatomTrajectory): InspectionTarget[] {
  const frameIndexes = [0, trajectory.frames.length - 1]
  return frameIndexes.map((frameIndex): InspectionTarget | null => {
    const bounds = boundsOfPositions(trajectory.frames[frameIndex].positions)
    if (!bounds) return null
    const atomIds = trajectory.atomIds.slice(0, 256)
    return {
      id: frameIndex === 0 ? 'structure-text-trajectory-first-frame' : 'structure-text-trajectory-final-frame',
      reason: frameIndex === 0
        ? 'Inspect the first imported trajectory frame against the source geometry'
        : 'Inspect the final imported trajectory frame and its canonical result structure',
      center: bounds.center,
      radius: Math.max(bounds.radius, 1),
      atomIds,
      ...(trajectory.atomIds.length > atomIds.length ? { atomIdsTruncated: true } : {}),
      trajectoryFrameIndex: frameIndex,
    }
  }).filter((target): target is InspectionTarget => target !== null)
}

export function importStructureText(options: ImportStructureTextOptions): StructureTextImportResult {
  const bytes = ensureInputBudget(options.text)
  if (!ZATOM_STRUCTURE_TEXT_IMPORT_FORMATS.includes(options.format)) fail('unsupported_structure_text_format', `Unsupported import format ${options.format}`)
  if (options.label !== undefined && !options.label.trim()) fail('invalid_structure_label', 'label must be non-empty when supplied')
  const parsed = options.format === 'cif'
    ? parseCif(options)
    : options.format === 'poscar'
      ? parsePoscar(options)
    : options.format === 'xdatcar'
      ? parseXdatcar(options)
    : options.format === 'mol-v2000'
      ? parseMolV2000(options)
      : parseXyz(options)
  const sourceFingerprint = textFingerprint(options.text)
  parsed.structure.metadata = {
    ...(parsed.structure.metadata ?? {}),
    'zatom.textImport': {
      schemaVersion: TEXT_IO_VERSION,
      format: options.format,
      sourceTextFingerprint: sourceFingerprint,
    },
  }
  const structure = parseZatomStructure(parsed.structure)
  const validation = validateStructure(structure)
  const inspectionTargets = [
    ...overviewTarget(structure),
    ...(parsed.trajectory ? trajectoryEndpointTargets(parsed.trajectory) : []),
    ...validation.inspectionTargets,
  ]
  const checks: ValidationCheck[] = [
    {
      id: 'structure_text.input_budget',
      status: 'pass',
      message: `Input uses ${bytes} bytes within the ${ZATOM_STRUCTURE_TEXT_MAX_BYTES}-byte limit`,
      metrics: { bytes, maximumBytes: ZATOM_STRUCTURE_TEXT_MAX_BYTES },
    },
    ...parsed.checks,
    {
      id: 'structure_text.import_scope',
      status: parsed.limitations.length ? 'warn' : 'pass',
      message: parsed.limitations.length
        ? `Import completed with ${parsed.limitations.length} explicit format limitation${parsed.limitations.length === 1 ? '' : 's'}`
        : 'Input semantics are fully represented by the canonical result',
      metrics: { limitationCount: parsed.limitations.length },
    },
    ...validation.checks,
  ]
  return {
    structure,
    ...(parsed.trajectory ? { trajectory: parseZatomTrajectory(parsed.trajectory, { structure }) } : {}),
    format: options.format,
    sourceTextFingerprint: sourceFingerprint,
    structureFingerprint: fingerprintStructure(structure),
    ...(parsed.trajectory ? { trajectoryFingerprint: fingerprintTrajectory(parsed.trajectory) } : {}),
    validation,
    inspectionTargets,
    checks,
    limitations: parsed.limitations,
  }
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) fail('invalid_structure_number', 'Cannot export non-finite coordinates')
  return value.toPrecision(15).replace(/(?:\.0+|(?:(\.\d*?)0+))(?=e|$)/, '$1')
}

function vectorNorm(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function latticeParameters(vectors: Mat3) {
  const [aVector, bVector, cVector] = vectors
  const a = vectorNorm(aVector)
  const b = vectorNorm(bVector)
  const c = vectorNorm(cVector)
  const angle = (left: readonly number[], right: readonly number[], leftNorm: number, rightNorm: number) => {
    const cosine = Math.max(-1, Math.min(1, (
      left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
    ) / (leftNorm * rightNorm)))
    return Math.acos(cosine) * 180 / Math.PI
  }
  return {
    a, b, c,
    alpha: angle(bVector, cVector, b, c),
    beta: angle(aVector, cVector, a, c),
    gamma: angle(aVector, bVector, a, b),
  }
}

function atomPropertyLosses(structure: ZatomStructure, preserved: ReadonlySet<string> = new Set()): string[] {
  const keys = new Set<string>()
  for (const atom of structure.atoms) for (const key of Object.keys(atom.properties ?? {})) if (!preserved.has(key)) keys.add(key)
  return keys.size ? [`Atom properties not represented: ${[...keys].sort().join(', ')}.`] : []
}

function commonLosses(structure: ZatomStructure, options: { ids?: boolean; bonds?: boolean; metadata?: boolean } = {}): string[] {
  const losses: string[] = []
  if (!options.ids) losses.push('Canonical atom and bond IDs are not represented by this format.')
  if (!options.bonds && structure.bonds !== undefined) losses.push('Explicit bond topology is not represented by this format.')
  if (!options.metadata && structure.metadata && Object.keys(structure.metadata).length) losses.push('Canonical structure metadata is not represented by this format.')
  return losses
}

/**
 * CIF and POSCAR have no periodicity flags: a slab is written as its full
 * cell, and the vacuum gap along the aperiodic axis is what encodes the
 * surface. Re-importing yields a fully periodic lattice; that loss is reported.
 */
function periodicityLoss(lattice: ZatomLattice, format: string): string[] {
  const aperiodic = lattice.periodic.map((flag, axis) => (flag ? null : 'abc'[axis])).filter((axis): axis is string => axis !== null)
  return aperiodic.length
    ? [`${format} has no periodicity flags: axis ${aperiodic.join(', ')} is written as periodic; the vacuum gap encodes the slab and re-import yields a fully periodic lattice.`]
    : []
}

function exportCif(structure: ZatomStructure): { text: string; limitations: string[] } {
  if (!structure.lattice) fail('cif_requires_lattice', 'CIF export requires a lattice')
  const params = latticeParameters(structure.lattice.vectors)
  const name = (structure.label?.trim() || 'zatom_structure').replace(/[^A-Za-z0-9_.-]+/g, '_')
  const lines = [
    `data_${name}`,
    "_space_group_name_H-M_alt 'P 1'",
    '_space_group_IT_number 1',
    `_cell_length_a ${decimal(params.a)}`,
    `_cell_length_b ${decimal(params.b)}`,
    `_cell_length_c ${decimal(params.c)}`,
    `_cell_angle_alpha ${decimal(params.alpha)}`,
    `_cell_angle_beta ${decimal(params.beta)}`,
    `_cell_angle_gamma ${decimal(params.gamma)}`,
    'loop_',
    '_atom_site_label',
    '_atom_site_type_symbol',
    '_atom_site_fract_x',
    '_atom_site_fract_y',
    '_atom_site_fract_z',
    '_atom_site_occupancy',
  ]
  const counts = new Map<string, number>()
  for (const atom of structure.atoms) {
    const count = (counts.get(atom.element) ?? 0) + 1
    counts.set(atom.element, count)
    const fractional = cartesianToFractional(atom.position, structure.lattice.vectors)
    if (!fractional) fail('invalid_cif_cell', 'Cannot invert the structure lattice for CIF export')
    // Wrap periodic coordinates into [0, 1). `_atom_site_fract_*` is fractional by
    // definition, and values such as 1.37 or 3.14 would be read as atoms several
    // cells away. Tile-images mode can produce such coordinates. Do not wrap a
    // nonperiodic vacuum axis because no equivalent periodic position exists there.
    const periodic = structure.lattice.periodic
    const canonical = fractional.map((value, axis) => {
      if (!periodic[axis]) return value
      const wrapped = value - Math.floor(value)
      // Tiny negative values can wrap to 1; clamp them to the half-open interval at 0.
      return wrapped >= 1 ? 0 : wrapped
    })
    lines.push(`${atom.element}${count} ${atom.element} ${canonical.map(decimal).join(' ')} 1`)
  }
  const limitations = [
    'CIF export writes an explicit P1 cell and does not infer crystallographic symmetry.',
    ...periodicityLoss(structure.lattice, 'CIF'),
    ...commonLosses(structure),
    ...atomPropertyLosses(structure),
    ...(structure.bonds?.some((bond) => bond.properties && Object.keys(bond.properties).length)
      ? ['Bond properties are not represented by CIF geometry export.'] : []),
  ]
  return { text: `${lines.join('\n')}\n`, limitations }
}

function exportPoscar(structure: ZatomStructure): { text: string; limitations: string[] } {
  if (!structure.lattice) fail('poscar_requires_lattice', 'POSCAR export requires a lattice')
  const species: string[] = []
  const grouped = new Map<string, ZatomStructureAtom[]>()
  for (const atom of structure.atoms) {
    const element = normalizeElement(atom.element, `Atom ${atom.id}`)
    if (!grouped.has(element)) {
      species.push(element)
      grouped.set(element, [])
    }
    grouped.get(element)!.push(atom)
  }
  const orderedAtoms = species.flatMap((element) => grouped.get(element)!)
  const reordered = orderedAtoms.some((atom, index) => atom.id !== structure.atoms[index].id)
  const selective = orderedAtoms.some((atom) => atom.properties?.[ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY] !== undefined)
  const flagsFor = (atom: ZatomStructureAtom): [boolean, boolean, boolean] => {
    const value = atom.properties?.[ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY]
    if (value === undefined) return [true, true, true]
    if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'boolean')) {
      fail(
        'invalid_poscar_selective_dynamics',
        `Atom ${atom.id} ${ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY} must contain three booleans`,
      )
    }
    return [Boolean(value[0]), Boolean(value[1]), Boolean(value[2])]
  }
  const title = (structure.label?.trim() || 'zatom structure').replace(/[\r\n]+/g, ' ').slice(0, 40)
  const lines = [
    title,
    '1.0',
    ...structure.lattice.vectors.map((row) => row.map(decimal).join(' ')),
    species.join(' '),
    species.map((element) => String(grouped.get(element)!.length)).join(' '),
    ...(selective ? ['Selective dynamics'] : []),
    'Direct',
  ]
  for (const atom of orderedAtoms) {
    const fractional = cartesianToFractional(atom.position, structure.lattice.vectors)
    if (!fractional) fail('invalid_poscar_lattice', 'Cannot invert the structure lattice for POSCAR export')
    const flags = selective ? ` ${flagsFor(atom).map((value) => value ? 'T' : 'F').join(' ')}` : ''
    lines.push(`${fractional.map(decimal).join(' ')}${flags}`)
  }
  const limitations = [
    'POSCAR species labels do not select or fingerprint POTCAR pseudopotentials; the exported structure is not a complete VASP calculation input.',
    ...periodicityLoss(structure.lattice, 'POSCAR'),
    ...commonLosses(structure),
    ...atomPropertyLosses(structure, new Set([ZATOM_VASP_SELECTIVE_DYNAMICS_PROPERTY])),
    ...(reordered ? ['Atoms were deterministically regrouped by element because POSCAR coordinates are ordered by species counts.'] : []),
    ...(structure.bonds?.some((bond) => bond.properties && Object.keys(bond.properties).length)
      ? ['Bond properties are not represented by POSCAR.'] : []),
  ]
  return { text: `${lines.join('\n')}\n`, limitations }
}

function exportXyz(structure: ZatomStructure, extended: boolean): { text: string; limitations: string[] } {
  const header: string[] = []
  if (extended) {
    if (structure.lattice) {
      header.push(`Lattice="${structure.lattice.vectors.flat().map(decimal).join(' ')}"`)
      header.push(`pbc="${structure.lattice.periodic.map((value) => value ? 'T' : 'F').join(' ')}"`)
    }
    header.push('Properties=species:S:1:pos:R:3:zatom_id:S:1')
  } else {
    header.push((structure.label ?? 'zatom structure').replace(/[\r\n]+/g, ' '))
  }
  const lines = [String(structure.atoms.length), header.join(' ')]
  for (const atom of structure.atoms) {
    const base = `${atom.element} ${atom.position.map(decimal).join(' ')}`
    if (extended && /[\u0000-\u001f]/.test(atom.id)) {
      fail('unsupported_extxyz_atom_id', `Atom ${JSON.stringify(atom.id)} contains control characters that extXYZ cannot round-trip`)
    }
    lines.push(extended ? `${base} ${JSON.stringify(atom.id)}` : base)
  }
  const limitations = [
    ...(extended
      ? [...commonLosses(structure, { ids: true }), ...atomPropertyLosses(structure)]
      : [
          ...commonLosses(structure),
          ...atomPropertyLosses(structure),
          ...(structure.lattice ? ['Lattice vectors and periodic boundary flags are not represented by plain XYZ.'] : []),
        ]),
    ...(structure.bonds?.some((bond) => bond.properties && Object.keys(bond.properties).length)
      ? ['Bond properties are not represented by XYZ.'] : []),
  ]
  return { text: `${lines.join('\n')}\n`, limitations }
}

function molCoordinate(value: number, field: string): string {
  const formatted = value.toFixed(4)
  if (formatted.length > 10) fail('mol_coordinate_out_of_range', `${field} does not fit the MOL V2000 10-column coordinate field`)
  return formatted.padStart(10)
}

function exportMolV2000(structure: ZatomStructure): { text: string; limitations: string[] } {
  if (structure.lattice) fail('mol_requires_finite_structure', 'MOL V2000 export requires a structure without a lattice')
  if (structure.bonds === undefined) fail('mol_requires_explicit_topology', 'MOL V2000 export requires explicit bonds; omitted bonds mean unknown topology')
  if (structure.atoms.length > 999 || structure.bonds.length > 999) fail('mol_v2000_budget_exceeded', 'MOL V2000 supports at most 999 atoms and 999 bonds')
  const atomIndex = new Map(structure.atoms.map((atom, index) => [atom.id, index + 1]))
  const chargeEntries: Array<[number, number]> = []
  const lines = [
    (structure.label?.trim() || 'zatom structure').slice(0, 80),
    `  zatom  ${TEXT_IO_VERSION}`,
    '',
    `${String(structure.atoms.length).padStart(3)}${String(structure.bonds.length).padStart(3)}  0  0  0  0            999 V2000`,
  ]
  structure.atoms.forEach((atom, index) => {
    const charge = atom.properties?.formalCharge
    if (charge !== undefined) {
      if (typeof charge !== 'number' || !Number.isSafeInteger(charge) || charge < -15 || charge > 15) {
        fail('unsupported_mol_formal_charge', `Atom ${atom.id} formalCharge must be an integer from -15 through 15`)
      }
      if (charge !== 0) chargeEntries.push([index + 1, charge])
    }
    lines.push(
      `${molCoordinate(atom.position[0], `${atom.id}.x`)}${molCoordinate(atom.position[1], `${atom.id}.y`)}`
      + `${molCoordinate(atom.position[2], `${atom.id}.z`)} ${atom.element.padEnd(3).slice(0, 3)} 0  0  0  0  0  0  0  0  0  0  0  0`,
    )
  })
  structure.bonds.forEach((bond) => {
    const first = atomIndex.get(bond.atomIds[0])
    const second = atomIndex.get(bond.atomIds[1])
    if (!first || !second) fail('invalid_mol_bond', `Bond ${bond.id} references an absent atom`)
    const order = bond.order === 1.5 ? 4 : bond.order
    lines.push(`${String(first).padStart(3)}${String(second).padStart(3)}${String(order).padStart(3)}  0  0  0  0`)
  })
  for (let offset = 0; offset < chargeEntries.length; offset += 8) {
    const chunk = chargeEntries.slice(offset, offset + 8)
    lines.push(`M  CHG${String(chunk.length).padStart(3)}${chunk.map(([index, charge]) => (
      `${String(index).padStart(4)}${String(charge).padStart(4)}`
    )).join('')}`)
  }
  lines.push('M  END')
  const limitations = [
    ...commonLosses(structure, { bonds: true }),
    ...atomPropertyLosses(structure, new Set(['formalCharge'])),
    ...(structure.bonds.some((bond) => bond.properties && Object.keys(bond.properties).length)
      ? ['Bond properties are not represented by MOL V2000.'] : []),
    'MOL V2000 export preserves explicit bond order and integer formalCharge, but canonical IDs are regenerated on import.',
  ]
  return { text: `${lines.join('\n')}\n`, limitations }
}

export function exportStructureText(options: ExportStructureTextOptions): StructureTextExportResult {
  if (!ZATOM_STRUCTURE_TEXT_EXPORT_FORMATS.includes(options.format)) fail('unsupported_structure_text_format', `Unsupported export format ${options.format}`)
  const structure = parseZatomStructure(options.structure)
  const validation = validateStructure(structure)
  if (validation.checks.some((check) => check.status === 'fail')) {
    fail('invalid_export_structure', 'Structure has failing validation checks and cannot be exported')
  }
  const output = options.format === 'cif'
    ? exportCif(structure)
    : options.format === 'poscar'
      ? exportPoscar(structure)
    : options.format === 'mol-v2000'
      ? exportMolV2000(structure)
      : exportXyz(structure, options.format === 'extxyz')
  const bytes = byteCount(output.text)
  if (bytes > ZATOM_STRUCTURE_TEXT_MAX_BYTES) {
    fail('structure_text_budget_exceeded', `Export uses ${bytes} bytes above the ${ZATOM_STRUCTURE_TEXT_MAX_BYTES}-byte limit`)
  }
  const formats: Record<ZatomStructureTextExportFormat, { mediaType: string; extension: string }> = {
    cif: { mediaType: 'chemical/x-cif', extension: '.cif' },
    poscar: { mediaType: 'chemical/x-vasp-poscar', extension: '.vasp' },
    xyz: { mediaType: 'chemical/x-xyz', extension: '.xyz' },
    extxyz: { mediaType: 'chemical/x-extxyz', extension: '.extxyz' },
    'mol-v2000': { mediaType: 'chemical/x-mdl-molfile', extension: '.mol' },
  }
  const checks: ValidationCheck[] = [
    ...validation.checks,
    {
      id: 'structure_text.export_scope',
      status: output.limitations.length ? 'warn' : 'pass',
      message: output.limitations.length
        ? `Export completed with ${output.limitations.length} explicit format limitation${output.limitations.length === 1 ? '' : 's'}`
        : 'Export represents every canonical field used by this structure',
      metrics: { limitationCount: output.limitations.length, byteCount: bytes },
    },
  ]
  return {
    format: options.format,
    text: output.text,
    ...formats[options.format],
    byteCount: bytes,
    sourceStructureFingerprint: fingerprintStructure(structure),
    outputTextFingerprint: textFingerprint(output.text),
    limitations: output.limitations,
    checks,
  }
}
