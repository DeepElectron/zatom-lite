/** Composable, JSON-safe structure mutation DSL for agent workflows. */

import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import { resolveSurfaceNormal } from '../lib/scene-grid/system-semantics'
import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  StructureAddedEntry,
  StructureChangeEntry,
  StructureChangeSet,
  StructureMovedEntry,
  StructureProvenance,
  StructureRemovedEntry,
  ValidationCheck,
  Vec3,
  ZatomBondOrder,
  ZatomStructure,
  ZatomStructureAtom,
} from './contracts'
import {
  boundsOfPositions,
  canonicalJsonIdentity,
  cartesianToFractional,
  createCertifiedMinimumImageCalculator,
  createDistanceCalculator,
  determinant3,
  distance,
  fingerprintStructure,
  fractionalToCartesian,
  invert3,
  scaleLattice,
  wrapFractional,
} from './structure-math'
import { validateStructure } from './structure-validation'
import {
  applyRigidTransform,
  RigidTransformInputError,
  type RigidTransformOperation,
} from './rigid-transform'

const PARENT_ATOM_ID_PROPERTY = 'zatom.parentAtomId'
const CELL_INDEX_PROPERTY = 'zatom.cellIndex'
const MAX_SELECTION_COMBINATIONS = 32
export const STRUCTURE_OPERATIONS_VERSION = '7.0.0'

export interface StructureSelectionClause {
  /** Select every atom; cannot be combined with other selectors. */
  all?: boolean
  /** Exact IDs in the current intermediate artifact. */
  atomIds?: string[]
  /** IDs in the pre-replication parent artifact. */
  parentAtomIds?: string[]
  elements?: string[]
  cartesianBox?: { min: Vec3; max: Vec3 }
  /** Inclusive cell-basis bounds; periodic components are wrapped into [0, 1). */
  fractionalBox?: { min: Vec3; max: Vec3 }
  /** Inclusive Cartesian plane side with a normalized normal. */
  cartesianHalfSpace?: { origin: Vec3; normal: Vec3; side: 'positive' | 'negative' }
  sphere?: { center: Vec3; radius: number; periodic?: boolean }
  /** Infinite Cartesian cylinder around one arbitrary axis. */
  cylinder?: { axisPoint: Vec3; axis: Vec3; radius: number }
  invert?: boolean
}

export type StructureSelectionCombinationOperator = 'union' | 'subtract' | 'intersect' | 'xor'

export type StructureLatticeCoordinateMode = 'preserve-cartesian' | 'preserve-fractional'

export interface StructureSelectionCombination {
  operator: StructureSelectionCombinationOperator
  selection: StructureSelectionClause
}

export interface StructureSelectionSpec extends StructureSelectionClause {
  /** Apply bounded set operations from left to right after resolving the base clause. */
  combine?: StructureSelectionCombination[]
}

/**
 * A direction the agent can name without knowing coordinates: an explicit
 * vector, the slab surface normal (resolved from the vacuum gap at execution
 * time; fails closed when there is none), or the line from one atom to another.
 */
export type StructureDirectionSpec =
  | Vec3
  | 'surface-normal'
  | { fromAtomId: string; toAtomId: string }

export type StructureOperation =
  | { op: 'supercell'; scaling: [number, number, number] }
  | { op: 'substitute'; selection: StructureSelectionSpec; element: string; count?: number; fraction?: number; seed?: number }
  | { op: 'vacancy'; selection: StructureSelectionSpec; count?: number; fraction?: number; seed?: number }
  | { op: 'interstitial'; atoms: Array<{ id?: string; element: string; position: Vec3; properties?: Record<string, JsonValue> }> }
  | { op: 'set_positions'; positions: Array<{ atomId: string; position: Vec3 }> }
  | { op: 'set_lattice'; vectors: Mat3; periodic: [boolean, boolean, boolean]; coordinateMode: StructureLatticeCoordinateMode }
  | { op: 'bond_add'; bonds: Array<{ id?: string; atomIds: [string, string]; order: ZatomBondOrder; properties?: Record<string, JsonValue> }> }
  | { op: 'bond_remove'; bondIds: string[] }
  | { op: 'bond_set_order'; bondIds: string[]; order: ZatomBondOrder }
  | { op: 'translate'; selection: StructureSelectionSpec; vector: Vec3 }
  | { op: 'translate_along'; selection: StructureSelectionSpec; direction: StructureDirectionSpec; distanceA: number }
  | (RigidTransformOperation & { selection: StructureSelectionSpec })
  | {
      op: 'rotate_about_axis_through'
      selection: StructureSelectionSpec
      axis: StructureDirectionSpec
      angleDeg: number
      /** Defaults to the selection centroid; for a bond axis, to the bond's first atom. */
      pivot?: Vec3 | { atomId: string }
    }
  | { op: 'affine'; selection: StructureSelectionSpec; matrix: Mat3; origin?: Vec3; deformLattice?: boolean }
  | { op: 'set_periodicity'; periodic: [boolean, boolean, boolean] }
  | { op: 'wrap'; selection: StructureSelectionSpec }

export interface ApplyStructureOperationsOptions {
  structure: ZatomStructure
  operations: StructureOperation[]
  seed?: number
  maxOutputAtoms?: number
  maxChangeDetails?: number
}

export interface StructureOperationReport {
  index: number
  op: StructureOperation['op']
  selectedAtomCount: number
  changedAtomCount: number
  selectedBondCount?: number
  changedBondCount?: number
  seed?: number
  beforeFingerprint: string
  afterFingerprint: string
}

export interface ApplyStructureOperationsResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  operations: StructureOperationReport[]
  inspectionTargets: InspectionTarget[]
}

interface SelectionResult {
  indices: number[]
  missingAtomIds: string[]
  missingParentAtomIds: string[]
}

export interface StructureSelectionEvaluation {
  indices: number[]
  atomIds: string[]
  elementCounts: Record<string, number>
  bounds: ReturnType<typeof boundsOfPositions>
}

export class StructureOperationInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StructureOperationInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finiteVec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new StructureOperationInputError('invalid_vector', `${field} must contain three finite numbers`)
  }
  const out: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (out.some((item) => !Number.isFinite(item))) {
    throw new StructureOperationInputError('invalid_vector', `${field} must contain three finite numbers`)
  }
  return out
}

function finiteMat3(value: unknown, field: string): Mat3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new StructureOperationInputError('invalid_matrix', `${field} must contain three row vectors`)
  }
  return value.map((row, index) => finiteVec3(row, `${field}[${index}]`)) as Mat3
}

function unitVec3(value: unknown, field: string): Vec3 {
  const vector = finiteVec3(value, field)
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length < 1e-12) {
    throw new StructureOperationInputError('invalid_direction', `${field} must have non-zero length`)
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function parseDirectionSpec(value: unknown, field: string): StructureDirectionSpec {
  if (value === 'surface-normal') return 'surface-normal'
  if (isRecord(value)) {
    const from = typeof value.fromAtomId === 'string' ? value.fromAtomId.trim() : ''
    const to = typeof value.toAtomId === 'string' ? value.toAtomId.trim() : ''
    if (!from || !to) throw new StructureOperationInputError('invalid_direction', `${field} needs fromAtomId and toAtomId`)
    if (from === to) throw new StructureOperationInputError('invalid_direction', `${field} fromAtomId and toAtomId must differ`)
    return { fromAtomId: from, toAtomId: to }
  }
  return unitVec3(value, field)
}

/** Resolve a named direction against the structure as it is at that pipeline step. */
function resolveDirectionSpec(structure: ZatomStructure, spec: StructureDirectionSpec, field: string): Vec3 {
  if (spec === 'surface-normal') {
    const resolved = resolveSurfaceNormal(structure)
    if (!resolved) {
      throw new StructureOperationInputError(
        'no_surface_normal',
        `${field}: "surface-normal" needs a slab with a vacuum gap; this structure has none. Pass an explicit vector instead.`,
      )
    }
    return resolved.normal
  }
  if (Array.isArray(spec)) return spec
  const from = structure.atoms.find((atom) => atom.id === spec.fromAtomId)
  const to = structure.atoms.find((atom) => atom.id === spec.toAtomId)
  if (!from) throw new StructureOperationInputError('unknown_atom_id', `${field}.fromAtomId "${spec.fromAtomId}" not found`)
  if (!to) throw new StructureOperationInputError('unknown_atom_id', `${field}.toAtomId "${spec.toAtomId}" not found`)
  const rawDelta: Vec3 = [
    to.position[0] - from.position[0],
    to.position[1] - from.position[1],
    to.position[2] - from.position[2],
  ]
  const delta = structure.lattice
    ? createCertifiedMinimumImageCalculator(structure.lattice)(rawDelta).vector
    : rawDelta
  const length = Math.hypot(delta[0], delta[1], delta[2])
  if (length < 1e-6) throw new StructureOperationInputError('degenerate_direction', `${field}: atoms coincide`)
  return [delta[0] / length, delta[1] / length, delta[2] / length]
}

function resolveRotationPivot(
  structure: ZatomStructure,
  operation: Extract<StructureOperation, { op: 'rotate_about_axis_through' }>,
  field: string,
): Vec3 | undefined {
  const pivot = operation.pivot
  if (pivot === undefined) {
    // A bond axis pivots on the bond itself; otherwise fall back to the
    // selection centroid, which applyRigidTransform uses when origin is absent.
    const axis = operation.axis
    if (typeof axis === 'object' && !Array.isArray(axis)) {
      const atom = structure.atoms.find((candidate) => candidate.id === axis.fromAtomId)
      return atom ? [...atom.position] as Vec3 : undefined
    }
    return undefined
  }
  if (Array.isArray(pivot)) return pivot
  const atom = structure.atoms.find((candidate) => candidate.id === pivot.atomId)
  if (!atom) throw new StructureOperationInputError('unknown_atom_id', `${field}.atomId "${pivot.atomId}" not found`)
  return [...atom.position] as Vec3
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new StructureOperationInputError('invalid_number', `${field} must be finite and in [${minimum}, ${maximum}]`)
  }
  return parsed
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new StructureOperationInputError('invalid_boolean', `${field} must be boolean`)
  return value
}

function periodicity(value: unknown, field: string): [boolean, boolean, boolean] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'boolean')) {
    throw new StructureOperationInputError('invalid_periodicity', `${field} must contain exactly three booleans`)
  }
  return [value[0], value[1], value[2]]
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new StructureOperationInputError('invalid_string_list', `${field} must be a non-empty-string array`)
  }
  return value.map((item) => item.trim())
}

function canonicalElement(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StructureOperationInputError('invalid_element', `${field} must be an element symbol`)
  }
  const text = value.trim()
  const symbol = text[0].toUpperCase() + text.slice(1).toLowerCase()
  if (symbolToAtomicNumber(symbol) <= 0) {
    throw new StructureOperationInputError('unknown_element', `${field} uses unknown element "${value}"`)
  }
  return symbol
}

function integerOption(value: unknown, field: string, minimum = 0): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new StructureOperationInputError('invalid_integer', `${field} must be an integer >= ${minimum}`)
  }
  return parsed
}

function fractionOption(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new StructureOperationInputError('invalid_fraction', `${field} must be in (0, 1]`)
  }
  return parsed
}

function bondOrder(value: unknown, field: string): ZatomBondOrder {
  const parsed = Number(value)
  if (parsed !== 1 && parsed !== 1.5 && parsed !== 2 && parsed !== 3) {
    throw new StructureOperationInputError('invalid_bond_order', `${field} must be 1, 1.5, 2, or 3`)
  }
  return parsed
}

function atomIdPair(value: unknown, field: string): [string, string] {
  const ids = stringList(value, field)
  if (!ids || ids.length !== 2) throw new StructureOperationInputError('invalid_bond_atoms', `${field} must contain exactly two atom IDs`)
  if (ids[0] === ids[1]) throw new StructureOperationInputError('self_bond', `${field} cannot reference the same atom twice`)
  return [ids[0], ids[1]]
}

function parseSelectionClause(
  value: unknown,
  field: string,
  defaultAll = false,
  allowCombination = false,
): StructureSelectionClause {
  if (value === undefined && defaultAll) return { all: true }
  if (!isRecord(value)) throw new StructureOperationInputError('invalid_selection', `${field} must be an object`)
  if (!allowCombination && value.combine !== undefined) {
    throw new StructureOperationInputError(
      'nested_selection_combination',
      `${field}.combine is not allowed inside a combination operand`,
    )
  }
  const atomIds = stringList(value.atomIds, `${field}.atomIds`)
  const parentAtomIds = stringList(value.parentAtomIds, `${field}.parentAtomIds`)
  const elements = stringList(value.elements, `${field}.elements`)?.map((item) => canonicalElement(item, `${field}.elements`))
  let cartesianBox: StructureSelectionClause['cartesianBox']
  if (value.cartesianBox !== undefined) {
    if (!isRecord(value.cartesianBox)) throw new StructureOperationInputError('invalid_box', `${field}.cartesianBox must be an object`)
    const min = finiteVec3(value.cartesianBox.min, `${field}.cartesianBox.min`)
    const max = finiteVec3(value.cartesianBox.max, `${field}.cartesianBox.max`)
    if (min.some((item, axis) => item > max[axis])) {
      throw new StructureOperationInputError('invalid_box', `${field}.cartesianBox min must not exceed max`)
    }
    cartesianBox = { min, max }
  }
  let fractionalBox: StructureSelectionClause['fractionalBox']
  if (value.fractionalBox !== undefined) {
    if (!isRecord(value.fractionalBox)) {
      throw new StructureOperationInputError('invalid_fractional_box', `${field}.fractionalBox must be an object`)
    }
    const min = finiteVec3(value.fractionalBox.min, `${field}.fractionalBox.min`)
    const max = finiteVec3(value.fractionalBox.max, `${field}.fractionalBox.max`)
    if (min.some((item, axis) => item > max[axis])) {
      throw new StructureOperationInputError('invalid_fractional_box', `${field}.fractionalBox min must not exceed max`)
    }
    fractionalBox = { min, max }
  }
  let cartesianHalfSpace: StructureSelectionClause['cartesianHalfSpace']
  if (value.cartesianHalfSpace !== undefined) {
    if (!isRecord(value.cartesianHalfSpace)) {
      throw new StructureOperationInputError('invalid_half_space', `${field}.cartesianHalfSpace must be an object`)
    }
    if (value.cartesianHalfSpace.side !== 'positive' && value.cartesianHalfSpace.side !== 'negative') {
      throw new StructureOperationInputError(
        'invalid_half_space',
        `${field}.cartesianHalfSpace.side must be positive or negative`,
      )
    }
    cartesianHalfSpace = {
      origin: finiteVec3(value.cartesianHalfSpace.origin, `${field}.cartesianHalfSpace.origin`),
      normal: unitVec3(value.cartesianHalfSpace.normal, `${field}.cartesianHalfSpace.normal`),
      side: value.cartesianHalfSpace.side,
    }
  }
  let sphere: StructureSelectionClause['sphere']
  if (value.sphere !== undefined) {
    if (!isRecord(value.sphere)) throw new StructureOperationInputError('invalid_sphere', `${field}.sphere must be an object`)
    const radius = Number(value.sphere.radius)
    if (!Number.isFinite(radius) || radius < 0) {
      throw new StructureOperationInputError('invalid_sphere', `${field}.sphere.radius must be finite and non-negative`)
    }
    sphere = {
      center: finiteVec3(value.sphere.center, `${field}.sphere.center`),
      radius,
      ...(value.sphere.periodic === true ? { periodic: true } : {}),
    }
  }
  let cylinder: StructureSelectionClause['cylinder']
  if (value.cylinder !== undefined) {
    if (!isRecord(value.cylinder)) throw new StructureOperationInputError('invalid_cylinder', `${field}.cylinder must be an object`)
    const radius = Number(value.cylinder.radius)
    if (!Number.isFinite(radius) || radius < 0) {
      throw new StructureOperationInputError('invalid_cylinder', `${field}.cylinder.radius must be finite and non-negative`)
    }
    cylinder = {
      axisPoint: finiteVec3(value.cylinder.axisPoint, `${field}.cylinder.axisPoint`),
      axis: unitVec3(value.cylinder.axis, `${field}.cylinder.axis`),
      radius,
    }
  }
  const all = value.all === true
  const selectorCount = Number(!!atomIds) + Number(!!parentAtomIds) + Number(!!elements)
    + Number(!!cartesianBox) + Number(!!fractionalBox) + Number(!!cartesianHalfSpace)
    + Number(!!sphere) + Number(!!cylinder)
  if (all && selectorCount) throw new StructureOperationInputError('ambiguous_selection', `${field}.all cannot be combined with other selectors`)
  if (!all && selectorCount === 0) throw new StructureOperationInputError('empty_selection', `${field} requires all=true or at least one selector`)
  return {
    ...(all ? { all: true } : {}),
    ...(atomIds ? { atomIds } : {}),
    ...(parentAtomIds ? { parentAtomIds } : {}),
    ...(elements ? { elements } : {}),
    ...(cartesianBox ? { cartesianBox } : {}),
    ...(fractionalBox ? { fractionalBox } : {}),
    ...(cartesianHalfSpace ? { cartesianHalfSpace } : {}),
    ...(sphere ? { sphere } : {}),
    ...(cylinder ? { cylinder } : {}),
    ...(value.invert === true ? { invert: true } : {}),
  }
}

export function parseStructureSelection(value: unknown, field = 'selection', defaultAll = false): StructureSelectionSpec {
  if (value === undefined && defaultAll) return { all: true }
  const selection = parseSelectionClause(value, field, defaultAll, true)
  const raw = value as Record<string, unknown>
  if (raw.combine === undefined) return selection
  if (!Array.isArray(raw.combine) || raw.combine.length === 0 || raw.combine.length > MAX_SELECTION_COMBINATIONS) {
    throw new StructureOperationInputError(
      'invalid_selection_combination',
      `${field}.combine must contain 1-${MAX_SELECTION_COMBINATIONS} ordered set operations`,
    )
  }
  const combine = raw.combine.map((entry, index): StructureSelectionCombination => {
    const entryField = `${field}.combine[${index}]`
    if (!isRecord(entry)) {
      throw new StructureOperationInputError('invalid_selection_combination', `${entryField} must be an object`)
    }
    if (entry.operator !== 'union' && entry.operator !== 'subtract'
      && entry.operator !== 'intersect' && entry.operator !== 'xor') {
      throw new StructureOperationInputError(
        'invalid_selection_combination',
        `${entryField}.operator must be union, subtract, intersect, or xor`,
      )
    }
    return {
      operator: entry.operator,
      selection: parseSelectionClause(entry.selection, `${entryField}.selection`),
    }
  })
  return { ...selection, combine }
}

/** Parse and validate an unknown JSON/MCP operation array. */
export function parseStructureOperations(value: unknown): StructureOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new StructureOperationInputError('missing_operations', 'operations must be a non-empty array')
  }
  return value.map((raw, index): StructureOperation => {
    const field = `operations[${index}]`
    if (!isRecord(raw) || typeof raw.op !== 'string') {
      throw new StructureOperationInputError('invalid_operation', `${field} requires an op string`)
    }
    switch (raw.op) {
      case 'supercell': {
        const scaling = finiteVec3(raw.scaling, `${field}.scaling`)
        if (scaling.some((item) => !Number.isInteger(item) || item < 1 || item > 64)) {
          throw new StructureOperationInputError('invalid_supercell', `${field}.scaling must contain integers in [1, 64]`)
        }
        return { op: 'supercell', scaling }
      }
      case 'substitute': {
        const count = integerOption(raw.count, `${field}.count`, 1)
        const fraction = fractionOption(raw.fraction, `${field}.fraction`)
        const seed = integerOption(raw.seed, `${field}.seed`)
        if (count !== undefined && fraction !== undefined) {
          throw new StructureOperationInputError('ambiguous_subset', `${field} cannot specify both count and fraction`)
        }
        return {
          op: 'substitute',
          selection: parseStructureSelection(raw.selection, `${field}.selection`),
          element: canonicalElement(raw.element, `${field}.element`),
          ...(count !== undefined ? { count } : {}),
          ...(fraction !== undefined ? { fraction } : {}),
          ...(seed !== undefined ? { seed } : {}),
        }
      }
      case 'vacancy': {
        const count = integerOption(raw.count, `${field}.count`, 1)
        const fraction = fractionOption(raw.fraction, `${field}.fraction`)
        const seed = integerOption(raw.seed, `${field}.seed`)
        if (count !== undefined && fraction !== undefined) {
          throw new StructureOperationInputError('ambiguous_subset', `${field} cannot specify both count and fraction`)
        }
        return {
          op: 'vacancy',
          selection: parseStructureSelection(raw.selection, `${field}.selection`),
          ...(count !== undefined ? { count } : {}),
          ...(fraction !== undefined ? { fraction } : {}),
          ...(seed !== undefined ? { seed } : {}),
        }
      }
      case 'interstitial': {
        if (!Array.isArray(raw.atoms) || raw.atoms.length === 0) {
          throw new StructureOperationInputError('missing_interstitials', `${field}.atoms must be a non-empty array`)
        }
        return {
          op: 'interstitial',
          atoms: raw.atoms.map((atom, atomIndex) => {
            if (!isRecord(atom)) throw new StructureOperationInputError('invalid_interstitial', `${field}.atoms[${atomIndex}] must be an object`)
            return {
              ...(typeof atom.id === 'string' && atom.id.trim() ? { id: atom.id.trim() } : {}),
              element: canonicalElement(atom.element, `${field}.atoms[${atomIndex}].element`),
              position: finiteVec3(atom.position, `${field}.atoms[${atomIndex}].position`),
              ...(isRecord(atom.properties) ? { properties: atom.properties as Record<string, JsonValue> } : {}),
            }
          }),
        }
      }
      case 'set_positions': {
        if (!Array.isArray(raw.positions) || raw.positions.length === 0) {
          throw new StructureOperationInputError('missing_positions', `${field}.positions must be a non-empty array`)
        }
        const atomIds = new Set<string>()
        return {
          op: 'set_positions',
          positions: raw.positions.map((entry, positionIndex) => {
            const entryField = `${field}.positions[${positionIndex}]`
            if (!isRecord(entry) || typeof entry.atomId !== 'string' || !entry.atomId.trim()) {
              throw new StructureOperationInputError('invalid_position_atom_id', `${entryField}.atomId must be a non-empty string`)
            }
            if (atomIds.has(entry.atomId)) {
              throw new StructureOperationInputError('duplicate_position_atom_ids', `${field}.positions repeats atom ID ${JSON.stringify(entry.atomId)}`)
            }
            atomIds.add(entry.atomId)
            return {
              atomId: entry.atomId,
              position: finiteVec3(entry.position, `${entryField}.position`),
            }
          }),
        }
      }
      case 'set_lattice': {
        if (raw.coordinateMode !== 'preserve-cartesian' && raw.coordinateMode !== 'preserve-fractional') {
          throw new StructureOperationInputError(
            'invalid_lattice_coordinate_mode',
            `${field}.coordinateMode must be preserve-cartesian or preserve-fractional`,
          )
        }
        const vectors = finiteMat3(raw.vectors, `${field}.vectors`)
        const signedVolumeA3 = determinant3(vectors)
        if (!Number.isFinite(signedVolumeA3) || signedVolumeA3 <= 1e-8) {
          throw new StructureOperationInputError(
            'invalid_lattice',
            `${field}.vectors must define a finite, nonsingular, right-handed lattice`,
          )
        }
        return {
          op: 'set_lattice',
          vectors,
          periodic: periodicity(raw.periodic, `${field}.periodic`),
          coordinateMode: raw.coordinateMode,
        }
      }
      case 'bond_add': {
        if (!Array.isArray(raw.bonds) || raw.bonds.length === 0) {
          throw new StructureOperationInputError('missing_bonds', `${field}.bonds must be a non-empty array`)
        }
        return {
          op: 'bond_add',
          bonds: raw.bonds.map((bond, bondIndex) => {
            if (!isRecord(bond)) throw new StructureOperationInputError('invalid_bond', `${field}.bonds[${bondIndex}] must be an object`)
            return {
              ...(typeof bond.id === 'string' && bond.id.trim() ? { id: bond.id.trim() } : {}),
              atomIds: atomIdPair(bond.atomIds, `${field}.bonds[${bondIndex}].atomIds`),
              order: bondOrder(bond.order, `${field}.bonds[${bondIndex}].order`),
              ...(isRecord(bond.properties) ? { properties: bond.properties as Record<string, JsonValue> } : {}),
            }
          }),
        }
      }
      case 'bond_remove': {
        const bondIds = stringList(raw.bondIds, `${field}.bondIds`)
        if (!bondIds?.length) throw new StructureOperationInputError('missing_bond_ids', `${field}.bondIds must be non-empty`)
        return { op: 'bond_remove', bondIds }
      }
      case 'bond_set_order': {
        const bondIds = stringList(raw.bondIds, `${field}.bondIds`)
        if (!bondIds?.length) throw new StructureOperationInputError('missing_bond_ids', `${field}.bondIds must be non-empty`)
        return { op: 'bond_set_order', bondIds, order: bondOrder(raw.order, `${field}.order`) }
      }
      case 'translate':
        return {
          op: 'translate',
          selection: parseStructureSelection(raw.selection, `${field}.selection`),
          vector: finiteVec3(raw.vector, `${field}.vector`),
        }
      case 'translate_along':
        return {
          op: 'translate_along',
          selection: parseStructureSelection(raw.selection, `${field}.selection`),
          direction: parseDirectionSpec(raw.direction, `${field}.direction`),
          distanceA: finiteNumber(raw.distanceA, `${field}.distanceA`, -1_000, 1_000),
        }
      case 'rotate_about_axis_through': {
        let pivot: Vec3 | { atomId: string } | undefined
        if (raw.pivot !== undefined) {
          if (isRecord(raw.pivot) && typeof raw.pivot.atomId === 'string' && raw.pivot.atomId.trim()) {
            pivot = { atomId: raw.pivot.atomId.trim() }
          } else {
            pivot = finiteVec3(raw.pivot, `${field}.pivot`)
          }
        }
        return {
          op: 'rotate_about_axis_through',
          selection: parseStructureSelection(raw.selection, `${field}.selection`),
          axis: parseDirectionSpec(raw.axis, `${field}.axis`),
          angleDeg: finiteNumber(raw.angleDeg, `${field}.angleDeg`, -36_000, 36_000),
          ...(pivot ? { pivot } : {}),
        }
      }
      case 'rotate':
        return {
          op: 'rotate',
          selection: parseStructureSelection(raw.selection, `${field}.selection`, true),
          axis: unitVec3(raw.axis, `${field}.axis`),
          angleDeg: finiteNumber(raw.angleDeg, `${field}.angleDeg`, -36_000, 36_000),
          ...(raw.origin !== undefined ? { origin: finiteVec3(raw.origin, `${field}.origin`) } : {}),
          ...(raw.rotateLattice === undefined ? {} : {
            rotateLattice: booleanValue(raw.rotateLattice, `${field}.rotateLattice`),
          }),
        }
      case 'align':
        return {
          op: 'align',
          selection: parseStructureSelection(raw.selection, `${field}.selection`, true),
          fromVector: unitVec3(raw.fromVector, `${field}.fromVector`),
          toVector: unitVec3(raw.toVector, `${field}.toVector`),
          ...(raw.origin !== undefined ? { origin: finiteVec3(raw.origin, `${field}.origin`) } : {}),
          ...(raw.antiparallelAxis !== undefined ? {
            antiparallelAxis: unitVec3(raw.antiparallelAxis, `${field}.antiparallelAxis`),
          } : {}),
          ...(raw.rotateLattice === undefined ? {} : {
            rotateLattice: booleanValue(raw.rotateLattice, `${field}.rotateLattice`),
          }),
        }
      case 'affine':
        return {
          op: 'affine',
          selection: parseStructureSelection(raw.selection, `${field}.selection`, true),
          matrix: finiteMat3(raw.matrix, `${field}.matrix`),
          ...(raw.origin !== undefined ? { origin: finiteVec3(raw.origin, `${field}.origin`) } : {}),
          ...(typeof raw.deformLattice === 'boolean' ? { deformLattice: raw.deformLattice } : {}),
        }
      case 'set_periodicity': {
        return { op: 'set_periodicity', periodic: periodicity(raw.periodic, `${field}.periodic`) }
      }
      case 'wrap':
        return { op: 'wrap', selection: parseStructureSelection(raw.selection, `${field}.selection`, true) }
      default:
        throw new StructureOperationInputError('unknown_operation', `${field}.op "${raw.op}" is not supported`)
    }
  })
}

function cloneStructure(structure: ZatomStructure): ZatomStructure {
  return {
    ...structure,
    atoms: structure.atoms.map((atom) => ({
      ...atom,
      position: [...atom.position] as Vec3,
      ...(atom.properties ? { properties: { ...atom.properties } } : {}),
    })),
    ...(structure.bonds ? {
      bonds: structure.bonds.map((bond) => ({
        ...bond,
        atomIds: [...bond.atomIds] as [string, string],
        ...(bond.properties ? { properties: { ...bond.properties } } : {}),
      })),
    } : {}),
    ...(structure.lattice ? {
      lattice: {
        vectors: structure.lattice.vectors.map((row) => [...row] as Vec3) as Mat3,
        periodic: [...structure.lattice.periodic] as [boolean, boolean, boolean],
      },
    } : {}),
    ...(structure.metadata ? { metadata: { ...structure.metadata } } : {}),
  }
}

function parentAtomId(atom: ZatomStructureAtom): string {
  const value = atom.properties?.[PARENT_ATOM_ID_PROPERTY]
  return typeof value === 'string' ? value : atom.id.replace(/(?:@\d+,\d+,\d+)+$/, '')
}

function selectClause(structure: ZatomStructure, selection: StructureSelectionClause): SelectionResult {
  const exactIds = selection.atomIds ? new Set(selection.atomIds) : null
  const parentIds = selection.parentAtomIds ? new Set(selection.parentAtomIds) : null
  const elements = selection.elements ? new Set(selection.elements) : null
  if (selection.sphere?.periodic && (!structure.lattice || !structure.lattice.periodic.some(Boolean))) {
    throw new StructureOperationInputError(
      'periodic_lattice_required',
      'A periodic sphere selection requires a lattice with at least one periodic axis',
    )
  }
  const cylinderAxis = selection.cylinder ? unitVec3(selection.cylinder.axis, 'selection.cylinder.axis') : undefined
  if (selection.cylinder && (!Number.isFinite(selection.cylinder.radius) || selection.cylinder.radius < 0)) {
    throw new StructureOperationInputError('invalid_cylinder', 'selection.cylinder.radius must be finite and non-negative')
  }
  let fractionalPosition: ((position: Vec3) => Vec3) | undefined
  if (selection.fractionalBox) {
    const lattice = structure.lattice
    if (!lattice) {
      throw new StructureOperationInputError('lattice_required', 'A fractional box selection requires a lattice')
    }
    const inverse = invert3(lattice.vectors)
    if (!inverse) throw new StructureOperationInputError('singular_lattice', 'Cannot select in a singular lattice basis')
    for (let axis = 0; axis < 3; axis++) {
      if (lattice.periodic[axis]
        && (selection.fractionalBox.min[axis] < 0 || selection.fractionalBox.max[axis] > 1)) {
        throw new StructureOperationInputError(
          'invalid_fractional_box',
          `Fractional bounds on periodic axis ${axis} must stay inside [0, 1]`,
        )
      }
    }
    fractionalPosition = (position) => wrapFractional([
      inverse[0][0] * position[0] + inverse[1][0] * position[1] + inverse[2][0] * position[2],
      inverse[0][1] * position[0] + inverse[1][1] * position[1] + inverse[2][1] * position[2],
      inverse[0][2] * position[0] + inverse[1][2] * position[1] + inverse[2][2] * position[2],
    ], lattice.periodic)
  }
  const sphereDistance = selection.sphere?.periodic ? createDistanceCalculator(structure.lattice) : distance
  const availableIds = new Set(structure.atoms.map((atom) => atom.id))
  const availableParentIds = new Set(structure.atoms.map(parentAtomId))
  const indices: number[] = []
  structure.atoms.forEach((atom, index) => {
    const fractional = fractionalPosition?.(atom.position)
    const halfSpaceDistance = selection.cartesianHalfSpace
      ? (atom.position[0] - selection.cartesianHalfSpace.origin[0]) * selection.cartesianHalfSpace.normal[0]
        + (atom.position[1] - selection.cartesianHalfSpace.origin[1]) * selection.cartesianHalfSpace.normal[1]
        + (atom.position[2] - selection.cartesianHalfSpace.origin[2]) * selection.cartesianHalfSpace.normal[2]
      : undefined
    const cylinderDistance = selection.cylinder ? (() => {
      const relative: Vec3 = [
        atom.position[0] - selection.cylinder!.axisPoint[0],
        atom.position[1] - selection.cylinder!.axisPoint[1],
        atom.position[2] - selection.cylinder!.axisPoint[2],
      ]
      const projection = relative[0] * cylinderAxis![0]
        + relative[1] * cylinderAxis![1]
        + relative[2] * cylinderAxis![2]
      const radialSquared = Math.max(0,
        relative[0] * relative[0] + relative[1] * relative[1] + relative[2] * relative[2]
        - projection * projection)
      return Math.sqrt(radialSquared)
    })() : undefined
    let matches = selection.all === true
      || ((!exactIds || exactIds.has(atom.id))
        && (!parentIds || parentIds.has(parentAtomId(atom)))
        && (!elements || elements.has(atom.element))
        && (!selection.cartesianBox || atom.position.every((value, axis) => value >= selection.cartesianBox!.min[axis] && value <= selection.cartesianBox!.max[axis]))
        && (!selection.fractionalBox || fractional!.every((value, axis) => value >= selection.fractionalBox!.min[axis] - 1e-12 && value <= selection.fractionalBox!.max[axis] + 1e-12))
        && (!selection.cartesianHalfSpace || (selection.cartesianHalfSpace.side === 'positive'
          ? halfSpaceDistance! >= -1e-12
          : halfSpaceDistance! <= 1e-12))
        && (!selection.sphere || sphereDistance(atom.position, selection.sphere.center) <= selection.sphere.radius)
        && (!selection.cylinder || cylinderDistance! <= selection.cylinder.radius + 1e-12))
    if (selection.invert) matches = !matches
    if (matches) indices.push(index)
  })
  return {
    indices,
    missingAtomIds: selection.atomIds?.filter((id) => !availableIds.has(id)) ?? [],
    missingParentAtomIds: selection.parentAtomIds?.filter((id) => !availableParentIds.has(id)) ?? [],
  }
}

function selectAtoms(structure: ZatomStructure, selection: StructureSelectionSpec): SelectionResult {
  const { combine = [], invert = false, ...baseClause } = selection
  if (combine.length > MAX_SELECTION_COMBINATIONS) {
    throw new StructureOperationInputError(
      'invalid_selection_combination',
      `Selection combines more than ${MAX_SELECTION_COMBINATIONS} set operations`,
    )
  }
  const base = selectClause(structure, baseClause)
  let indices = new Set(base.indices)
  const missingAtomIds = [...base.missingAtomIds]
  const missingParentAtomIds = [...base.missingParentAtomIds]

  for (const combination of combine) {
    const operand = selectClause(structure, combination.selection)
    const operandIndices = new Set(operand.indices)
    missingAtomIds.push(...operand.missingAtomIds)
    missingParentAtomIds.push(...operand.missingParentAtomIds)
    if (combination.operator === 'union') {
      for (const index of operandIndices) indices.add(index)
    } else if (combination.operator === 'subtract') {
      for (const index of operandIndices) indices.delete(index)
    } else if (combination.operator === 'intersect') {
      indices = new Set([...indices].filter((index) => operandIndices.has(index)))
    } else {
      const symmetricDifference = new Set(indices)
      for (const index of operandIndices) {
        if (symmetricDifference.has(index)) symmetricDifference.delete(index)
        else symmetricDifference.add(index)
      }
      indices = symmetricDifference
    }
  }
  if (invert) {
    const inverted = new Set<number>()
    for (let index = 0; index < structure.atoms.length; index++) {
      if (!indices.has(index)) inverted.add(index)
    }
    indices = inverted
  }
  return {
    indices: [...indices].sort((left, right) => left - right),
    missingAtomIds: [...new Set(missingAtomIds)],
    missingParentAtomIds: [...new Set(missingParentAtomIds)],
  }
}

/** Resolve one selection in canonical structure order without mutating the structure. */
export function evaluateStructureSelection(
  structure: ZatomStructure,
  selection: StructureSelectionSpec,
): StructureSelectionEvaluation {
  if (new Set(structure.atoms.map((atom) => atom.id)).size !== structure.atoms.length) {
    throw new StructureOperationInputError('duplicate_atom_ids', 'Selection requires unique canonical atom IDs')
  }
  const selected = selectAtoms(structure, selection)
  const missingSelectionIds = [...selected.missingAtomIds, ...selected.missingParentAtomIds]
  if (missingSelectionIds.length) {
    throw new StructureOperationInputError(
      'missing_selector_ids',
      `Selection references absent current/parent atom IDs: ${missingSelectionIds.join(', ')}`,
    )
  }
  const atoms = selected.indices.map((index) => structure.atoms[index])
  const elementCounts = new Map<string, number>()
  for (const atom of atoms) elementCounts.set(atom.element, (elementCounts.get(atom.element) ?? 0) + 1)
  return {
    indices: selected.indices,
    atomIds: atoms.map((atom) => atom.id),
    elementCounts: Object.fromEntries([...elementCounts].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
    bounds: boundsOfPositions(atoms.map((atom) => atom.position)),
  }
}

function rngForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function chooseSubset(indices: number[], count: number | undefined, fraction: number | undefined, seed: number): number[] {
  const requested = count ?? (fraction === undefined ? indices.length : Math.round(indices.length * fraction))
  if (requested > indices.length) {
    throw new StructureOperationInputError('subset_too_large', `Requested ${requested} atoms from a ${indices.length}-atom selection`)
  }
  if (requested < 1) {
    throw new StructureOperationInputError('empty_random_subset', 'The requested fraction rounds to zero atoms; enlarge the selection or provide count')
  }
  if (requested === indices.length) return [...indices]
  const shuffled = [...indices]
  const random = rngForSeed(seed)
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, requested).sort((a, b) => a - b)
}

function selectionChecks(index: number, op: string, selection: Pick<StructureSelectionEvaluation, 'indices'>): ValidationCheck[] {
  return [{
    id: `operation.${index}.selection`,
    status: 'pass',
    message: `${op} matched ${selection.indices.length.toLocaleString()} atoms`,
    metrics: { matchedAtomCount: selection.indices.length },
  }]
}

function replicate(structure: ZatomStructure, scaling: [number, number, number], maxOutputAtoms: number): ZatomStructure {
  if (!structure.lattice || !structure.lattice.periodic.some(Boolean)) {
    throw new StructureOperationInputError('periodic_lattice_required', 'supercell requires a periodic lattice')
  }
  for (let axis = 0; axis < 3; axis++) {
    if (!structure.lattice.periodic[axis] && scaling[axis] !== 1) {
      throw new StructureOperationInputError('invalid_nonperiodic_scaling', `Cannot replicate non-periodic axis ${axis}`)
    }
  }
  const product = scaling[0] * scaling[1] * scaling[2]
  if (structure.atoms.length * product > maxOutputAtoms) {
    throw new StructureOperationInputError('output_too_large', `supercell would exceed maxOutputAtoms=${maxOutputAtoms.toLocaleString()}`)
  }
  if (product === 1) return structure
  const atoms: ZatomStructureAtom[] = []
  for (let ia = 0; ia < scaling[0]; ia++) for (let ib = 0; ib < scaling[1]; ib++) for (let ic = 0; ic < scaling[2]; ic++) {
    const shift = fractionalToCartesian([ia, ib, ic], structure.lattice.vectors)
    for (const atom of structure.atoms) {
      const fractional = cartesianToFractional(atom.position, structure.lattice.vectors)
      if (!fractional) throw new StructureOperationInputError('singular_lattice', 'Cannot invert lattice for supercell replication')
      const base = fractionalToCartesian(wrapFractional(fractional, structure.lattice.periodic), structure.lattice.vectors)
      atoms.push({
        ...atom,
        id: `${atom.id}@${ia},${ib},${ic}`,
        position: [base[0] + shift[0], base[1] + shift[1], base[2] + shift[2]],
        properties: {
          ...(atom.properties ?? {}),
          [PARENT_ATOM_ID_PROPERTY]: parentAtomId(atom),
          [CELL_INDEX_PROPERTY]: [ia, ib, ic],
        },
      })
    }
  }
  const bonds = structure.bonds?.flatMap((bond) => {
    const copies = [] as NonNullable<ZatomStructure['bonds']>
    for (let ia = 0; ia < scaling[0]; ia++) for (let ib = 0; ib < scaling[1]; ib++) for (let ic = 0; ic < scaling[2]; ic++) {
      const suffix = `@${ia},${ib},${ic}`
      copies.push({
        ...bond,
        id: `${bond.id}${suffix}`,
        atomIds: [`${bond.atomIds[0]}${suffix}`, `${bond.atomIds[1]}${suffix}`],
        ...(bond.properties ? { properties: { ...bond.properties } } : {}),
      })
    }
    return copies
  })
  return {
    ...structure,
    atoms,
    ...(bonds ? { bonds } : {}),
    lattice: scaleLattice(structure.lattice, scaling),
    label: `${structure.label ?? 'structure'} ${scaling.join('×')} supercell`,
  }
}

function applyLinear(matrix: Mat3, vector: readonly number[]): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ]
}

function latticeMateriallyChanged(source: ZatomStructure, result: ZatomStructure): boolean {
  if (!source.lattice || !result.lattice) return source.lattice !== result.lattice
  if (source.lattice.periodic.some((value, axis) => value !== result.lattice!.periodic[axis])) return true
  return source.lattice.vectors.some((row, rowIndex) => row.some((value, columnIndex) => (
    Math.abs(value - result.lattice!.vectors[rowIndex][columnIndex]) > 1e-10
  )))
}

export function buildStructureChangeSet(
  source: ZatomStructure,
  result: ZatomStructure,
  detailLimit = 500,
): StructureChangeSet {
  const sourceById = new Map(source.atoms.map((atom) => [atom.id, atom]))
  const resultById = new Map(result.atoms.map((atom) => [atom.id, atom]))
  const addedAll: StructureAddedEntry[] = []
  const removedAll: StructureRemovedEntry[] = []
  const movedAll: StructureMovedEntry[] = []
  const relabeledAll: StructureChangeEntry[] = []
  const changedAtomPropertiesAll: NonNullable<StructureChangeSet['changedAtomProperties']> = []
  const sourceBonds = new Map((source.bonds ?? []).map((bond) => [bond.id, bond]))
  const resultBonds = new Map((result.bonds ?? []).map((bond) => [bond.id, bond]))
  const addedBonds = (result.bonds ?? []).filter((bond) => !sourceBonds.has(bond.id))
  const removedBonds = (source.bonds ?? []).filter((bond) => !resultBonds.has(bond.id))
  const changedBonds = (result.bonds ?? []).flatMap((bond) => {
    const before = sourceBonds.get(bond.id)
    if (!before || canonicalJsonIdentity(before) === canonicalJsonIdentity(bond)) return []
    return [{ bondId: bond.id, before, after: bond }]
  })
  const changedPositions: Vec3[] = []

  for (const atom of result.atoms) {
    const before = sourceById.get(atom.id)
    if (!before) {
      addedAll.push({ atomId: atom.id, element: atom.element, position: [...atom.position] as Vec3 })
      changedPositions.push(atom.position)
      continue
    }
    if (before.element !== atom.element) {
      relabeledAll.push({ atomId: atom.id, fromElement: before.element, toElement: atom.element, position: [...atom.position] as Vec3 })
      changedPositions.push(atom.position)
    }
    if (canonicalJsonIdentity(before.properties ?? null) !== canonicalJsonIdentity(atom.properties ?? null)) {
      changedAtomPropertiesAll.push({
        atomId: atom.id,
        ...(before.properties ? { before: before.properties } : {}),
        ...(atom.properties ? { after: atom.properties } : {}),
      })
      changedPositions.push(atom.position)
    }
    const displacementA = distance(before.position, atom.position)
    if (displacementA > 1e-10) {
      movedAll.push({
        atomId: atom.id,
        element: atom.element,
        fromPosition: [...before.position] as Vec3,
        toPosition: [...atom.position] as Vec3,
        displacementA,
      })
      changedPositions.push(before.position, atom.position)
    }
  }
  for (const atom of source.atoms) {
    if (resultById.has(atom.id)) continue
    removedAll.push({ atomId: atom.id, element: atom.element, position: [...atom.position] as Vec3 })
    changedPositions.push(atom.position)
  }
  const changedBounds = boundsOfPositions(changedPositions)
  const hasOnlyRelabel = relabeledAll.length > 0 && !addedAll.length && !removedAll.length && !movedAll.length
    && !addedBonds.length && !removedBonds.length && !changedBonds.length && !changedAtomPropertiesAll.length
  return {
    kind: result.atoms.length !== source.atoms.length && (addedAll.length === result.atoms.length || removedAll.length === source.atoms.length)
      ? 'create'
      : hasOnlyRelabel ? 'relabel' : 'mutate',
    sourceAtomCount: source.atoms.length,
    resultAtomCount: result.atoms.length,
    addedCount: addedAll.length,
    added: addedAll.slice(0, detailLimit),
    addedTruncated: addedAll.length > detailLimit,
    removedCount: removedAll.length,
    removed: removedAll.slice(0, detailLimit),
    removedTruncated: removedAll.length > detailLimit,
    movedCount: movedAll.length,
    moved: movedAll.slice(0, detailLimit),
    movedTruncated: movedAll.length > detailLimit,
    relabeledCount: relabeledAll.length,
    relabeled: relabeledAll.slice(0, detailLimit),
    relabeledTruncated: relabeledAll.length > detailLimit,
    addedBondCount: addedBonds.length,
    addedBonds: addedBonds.slice(0, detailLimit),
    addedBondsTruncated: addedBonds.length > detailLimit,
    removedBondCount: removedBonds.length,
    removedBonds: removedBonds.slice(0, detailLimit),
    removedBondsTruncated: removedBonds.length > detailLimit,
    changedBondCount: changedBonds.length,
    changedBonds: changedBonds.slice(0, detailLimit),
    changedBondsTruncated: changedBonds.length > detailLimit,
    changedAtomPropertiesCount: changedAtomPropertiesAll.length,
    changedAtomProperties: changedAtomPropertiesAll.slice(0, detailLimit),
    changedAtomPropertiesTruncated: changedAtomPropertiesAll.length > detailLimit,
    structureMetadataChanged: canonicalJsonIdentity(source.metadata ?? null) !== canonicalJsonIdentity(result.metadata ?? null),
    latticeChanged: latticeMateriallyChanged(source, result),
    maxPositionDisplacementA: movedAll.reduce((max, item) => Math.max(max, item.displacementA), 0),
    changedBounds,
  }
}

export function applyStructureOperations(options: ApplyStructureOperationsOptions): ApplyStructureOperationsResult {
  if (!Array.isArray(options.operations) || options.operations.length === 0) {
    throw new StructureOperationInputError('missing_operations', 'At least one structure operation is required')
  }
  const sourceValidation = validateStructure(options.structure)
  if (sourceValidation.verdict === 'fail') {
    throw new StructureOperationInputError('invalid_source_structure', 'Source structure failed numeric validation')
  }
  const source = cloneStructure(options.structure)
  let structure = cloneStructure(options.structure)
  const baseSeed = (options.seed ?? 42) >>> 0
  const maxOutputAtoms = Math.max(1, Math.trunc(options.maxOutputAtoms ?? 20_000))
  const detailLimit = Math.max(1, Math.trunc(options.maxChangeDetails ?? 500))
  const checks: ValidationCheck[] = []
  const reports: StructureOperationReport[] = []
  const rotationBoundaryAtomIds = new Set<string>()

  options.operations.forEach((operation, zeroIndex) => {
    const index = zeroIndex + 1
    const beforeFingerprint = fingerprintStructure(structure)
    let selectedAtomCount = 0
    let changedAtomCount = 0
    let selectedBondCount = 0
    let changedBondCount = 0
    let operationSeed: number | undefined

    if (operation.op === 'supercell') {
      selectedAtomCount = structure.atoms.length
      const beforeCount = structure.atoms.length
      structure = replicate(structure, operation.scaling, maxOutputAtoms)
      changedAtomCount = structure.atoms.length === beforeCount ? 0 : structure.atoms.length
      checks.push({
        id: `operation.${index}.supercell`,
        status: changedAtomCount ? 'pass' : 'skipped',
        message: changedAtomCount
          ? `Replicated ${beforeCount.toLocaleString()} atoms to ${structure.atoms.length.toLocaleString()}`
          : 'Identity supercell left the structure unchanged',
        metrics: { sourceAtomCount: beforeCount, resultAtomCount: structure.atoms.length },
      })
    } else if (operation.op === 'set_periodicity') {
      if (!structure.lattice) {
        throw new StructureOperationInputError('lattice_required', 'set_periodicity requires an existing lattice')
      }
      selectedAtomCount = structure.atoms.length
      const previous = [...structure.lattice.periodic] as [boolean, boolean, boolean]
      const changed = previous.some((value, axis) => value !== operation.periodic[axis])
      if (changed) {
        structure = {
          ...structure,
          lattice: {
            ...structure.lattice,
            periodic: [...operation.periodic] as [boolean, boolean, boolean],
          },
        }
      }
      checks.push({
        id: `operation.${index}.periodicity`,
        status: changed ? 'pass' : 'skipped',
        message: changed
          ? `Changed periodic boundaries from [${previous.join(', ')}] to [${operation.periodic.join(', ')}]`
          : `Periodic boundaries already equal [${operation.periodic.join(', ')}]`,
        metrics: {
          previousPeriodicAxisCount: previous.filter(Boolean).length,
          resultPeriodicAxisCount: operation.periodic.filter(Boolean).length,
        },
      })
    } else if (operation.op === 'set_lattice') {
      const vectors = finiteMat3(operation.vectors, `operations[${zeroIndex}].vectors`)
      const periodic = periodicity(operation.periodic, `operations[${zeroIndex}].periodic`)
      if (operation.coordinateMode !== 'preserve-cartesian' && operation.coordinateMode !== 'preserve-fractional') {
        throw new StructureOperationInputError(
          'invalid_lattice_coordinate_mode',
          `operations[${zeroIndex}].coordinateMode must be preserve-cartesian or preserve-fractional`,
        )
      }
      const signedVolumeA3 = determinant3(vectors)
      if (!Number.isFinite(signedVolumeA3) || signedVolumeA3 <= 1e-8) {
        throw new StructureOperationInputError(
          'invalid_lattice',
          `operations[${zeroIndex}].vectors must define a finite, nonsingular, right-handed lattice`,
        )
      }
      selectedAtomCount = structure.atoms.length
      let atoms = structure.atoms
      if (operation.coordinateMode === 'preserve-fractional') {
        if (!structure.lattice) {
          throw new StructureOperationInputError(
            'lattice_required',
            'set_lattice coordinateMode=preserve-fractional requires an existing lattice',
          )
        }
        atoms = structure.atoms.map((atom) => {
          const fractional = cartesianToFractional(atom.position, structure.lattice!.vectors)
          if (!fractional) {
            throw new StructureOperationInputError('singular_lattice', 'Cannot preserve fractional coordinates from a singular lattice')
          }
          const position = fractionalToCartesian(fractional, vectors)
          if (distance(atom.position, position) > 1e-10) changedAtomCount++
          return { ...atom, position }
        })
      }
      const previousVolumeA3 = structure.lattice ? determinant3(structure.lattice.vectors) : null
      structure = {
        ...structure,
        atoms,
        lattice: { vectors, periodic },
      }
      checks.push({
        id: `operation.${index}.lattice`,
        status: 'pass',
        message: `Set a right-handed ${signedVolumeA3.toFixed(6)} Å³ lattice while ${operation.coordinateMode === 'preserve-cartesian' ? 'preserving Cartesian positions' : 'preserving fractional positions'}`,
        metrics: {
          coordinateMode: operation.coordinateMode,
          previousSignedVolumeA3: previousVolumeA3,
          signedVolumeA3,
          movedAtomCount: changedAtomCount,
        },
      })
    } else if (operation.op === 'set_positions') {
      if (!Array.isArray(operation.positions) || operation.positions.length === 0) {
        throw new StructureOperationInputError('missing_positions', `operations[${zeroIndex}].positions must be a non-empty array`)
      }
      const positions = new Map<string, Vec3>()
      for (let positionIndex = 0; positionIndex < operation.positions.length; positionIndex++) {
        const entry = operation.positions[positionIndex]
        const entryField = `operations[${zeroIndex}].positions[${positionIndex}]`
        if (!entry || typeof entry.atomId !== 'string' || !entry.atomId.trim()) {
          throw new StructureOperationInputError('invalid_position_atom_id', `${entryField}.atomId must be a non-empty string`)
        }
        if (positions.has(entry.atomId)) {
          throw new StructureOperationInputError(
            'duplicate_position_atom_ids',
            `operations[${zeroIndex}].positions repeats atom ID ${JSON.stringify(entry.atomId)}`,
          )
        }
        positions.set(entry.atomId, finiteVec3(entry.position, `${entryField}.position`))
      }
      const availableAtomIds = new Set(structure.atoms.map((atom) => atom.id))
      const missingAtomIds = [...positions.keys()].filter((atomId) => !availableAtomIds.has(atomId))
      if (missingAtomIds.length) {
        throw new StructureOperationInputError(
          'position_atom_ids_missing',
          `set_positions references absent atom IDs: ${missingAtomIds.join(', ')}`,
        )
      }
      selectedAtomCount = positions.size
      structure = {
        ...structure,
        atoms: structure.atoms.map((atom) => {
          const position = positions.get(atom.id)
          if (!position) return atom
          if (distance(atom.position, position) > 1e-10) changedAtomCount++
          return { ...atom, position: [...position] as Vec3 }
        }),
      }
      checks.push({
        id: `operation.${index}.absolute_positions`,
        status: changedAtomCount ? 'pass' : 'skipped',
        message: changedAtomCount
          ? `Set absolute Cartesian positions for ${changedAtomCount.toLocaleString()} of ${selectedAtomCount.toLocaleString()} requested atoms`
          : `All ${selectedAtomCount.toLocaleString()} requested atoms already had the supplied Cartesian positions`,
        metrics: { selectedAtomCount, changedAtomCount },
        atomIds: [...positions.keys()].slice(0, 80),
      })
    } else if (operation.op === 'interstitial') {
      selectedAtomCount = operation.atoms.length
      const ids = new Set(structure.atoms.map((atom) => atom.id))
      const additions = operation.atoms.map((atom, atomIndex): ZatomStructureAtom => {
        const id = atom.id ?? `interstitial-${index}-${atomIndex + 1}`
        if (ids.has(id)) throw new StructureOperationInputError('duplicate_atom_id', `Interstitial atom ID "${id}" already exists`)
        ids.add(id)
        return { ...atom, id, position: [...atom.position] as Vec3 }
      })
      if (structure.atoms.length + additions.length > maxOutputAtoms) {
        throw new StructureOperationInputError('output_too_large', `interstitial operation would exceed maxOutputAtoms=${maxOutputAtoms.toLocaleString()}`)
      }
      structure = { ...structure, atoms: [...structure.atoms, ...additions] }
      changedAtomCount = additions.length
      checks.push({
        id: `operation.${index}.interstitial`,
        status: 'pass',
        message: `Added ${additions.length.toLocaleString()} interstitial atoms; final distance validation remains authoritative`,
        metrics: { addedAtomCount: additions.length },
        atomIds: additions.slice(0, 80).map((atom) => atom.id),
      })
    } else if (operation.op === 'bond_add') {
      const atomIds = new Set(structure.atoms.map((atom) => atom.id))
      const existing = structure.bonds ?? []
      const bondIds = new Set(existing.map((bond) => bond.id))
      const pairKeys = new Set(existing.map((bond) => [...bond.atomIds].sort().join('\u0000')))
      const additions = operation.bonds.map((bond, bondIndex) => {
        const missing = bond.atomIds.filter((atomId) => !atomIds.has(atomId))
        if (missing.length) throw new StructureOperationInputError('bond_atoms_missing', `Bond endpoints are missing: ${missing.join(', ')}`)
        const id = bond.id ?? `bond-${index}-${bondIndex + 1}`
        if (bondIds.has(id)) throw new StructureOperationInputError('duplicate_bond_id', `Bond ID "${id}" already exists`)
        const pairKey = [...bond.atomIds].sort().join('\u0000')
        if (pairKeys.has(pairKey)) throw new StructureOperationInputError('duplicate_bond_pair', `A bond already connects ${bond.atomIds.join(' and ')}`)
        bondIds.add(id)
        pairKeys.add(pairKey)
        return {
          ...bond,
          id,
          atomIds: [...bond.atomIds] as [string, string],
          ...(bond.properties ? { properties: { ...bond.properties } } : {}),
        }
      })
      selectedAtomCount = new Set(additions.flatMap((bond) => bond.atomIds)).size
      selectedBondCount = additions.length
      changedBondCount = additions.length
      structure = { ...structure, bonds: [...existing, ...additions] }
      checks.push({
        id: `operation.${index}.changed_bonds`,
        status: 'pass',
        message: `Added ${additions.length} explicit bonds`,
        metrics: { selectedAtomCount, changedBondCount },
        atomIds: [...new Set(additions.flatMap((bond) => bond.atomIds))].slice(0, 80),
      })
    } else if (operation.op === 'bond_remove' || operation.op === 'bond_set_order') {
      const existing = structure.bonds
      if (!existing) throw new StructureOperationInputError('topology_required', `${operation.op} requires explicit bonds`)
      const requested = new Set(operation.bondIds)
      if (requested.size !== operation.bondIds.length) throw new StructureOperationInputError('duplicate_bond_ids', `${operation.op}.bondIds must not contain duplicates`)
      const available = new Set(existing.map((bond) => bond.id))
      const missing = operation.bondIds.filter((id) => !available.has(id))
      if (missing.length) throw new StructureOperationInputError('bond_ids_missing', `Bond IDs are missing: ${missing.join(', ')}`)
      selectedBondCount = requested.size
      const affected = existing.filter((bond) => requested.has(bond.id))
      selectedAtomCount = new Set(affected.flatMap((bond) => bond.atomIds)).size
      if (operation.op === 'bond_remove') {
        structure = { ...structure, bonds: existing.filter((bond) => !requested.has(bond.id)) }
        changedBondCount = requested.size
      } else {
        structure = {
          ...structure,
          bonds: existing.map((bond) => {
            if (!requested.has(bond.id) || bond.order === operation.order) return bond
            changedBondCount++
            return { ...bond, order: operation.order }
          }),
        }
      }
      checks.push({
        id: `operation.${index}.changed_bonds`,
        status: changedBondCount ? 'pass' : 'warn',
        message: changedBondCount
          ? `${operation.op} changed ${changedBondCount} explicit bonds`
          : `${operation.op} matched bonds but did not change their topology`,
        metrics: { selectedBondCount, changedBondCount },
        atomIds: [...new Set(affected.flatMap((bond) => bond.atomIds))].slice(0, 80),
      })
    } else {
      const selection = evaluateStructureSelection(structure, operation.selection)
      if (!selection.indices.length) {
        throw new StructureOperationInputError('selection_matched_zero', `Operation ${index} (${operation.op}) selected no atoms`)
      }
      selectedAtomCount = selection.indices.length
      const selectionAll = selection.indices.length === structure.atoms.length
      checks.push(...selectionChecks(index, operation.op, selection))

      if (operation.op === 'substitute') {
        operationSeed = (operation.seed ?? (baseSeed + Math.imul(index, 0x9e3779b1))) >>> 0
        const chosen = chooseSubset(selection.indices, operation.count, operation.fraction, operationSeed)
        const chosenSet = new Set(chosen)
        structure = {
          ...structure,
          atoms: structure.atoms.map((atom, atomIndex) => {
            if (!chosenSet.has(atomIndex) || atom.element === operation.element) return atom
            changedAtomCount++
            return { ...atom, element: operation.element }
          }),
        }
      } else if (operation.op === 'vacancy') {
        operationSeed = (operation.seed ?? (baseSeed + Math.imul(index, 0x9e3779b1))) >>> 0
        const chosen = chooseSubset(selection.indices, operation.count, operation.fraction, operationSeed)
        if (chosen.length >= structure.atoms.length) {
          throw new StructureOperationInputError('empty_result', 'vacancy operation cannot remove every atom')
        }
        const chosenSet = new Set(chosen)
        const atoms = structure.atoms.filter((_, atomIndex) => !chosenSet.has(atomIndex))
        const remainingIds = new Set(atoms.map((atom) => atom.id))
        structure = {
          ...structure,
          atoms,
          ...(structure.bonds ? {
            bonds: structure.bonds.filter((bond) => remainingIds.has(bond.atomIds[0]) && remainingIds.has(bond.atomIds[1])),
          } : {}),
        }
        changedAtomCount = chosen.length
      } else if (operation.op === 'translate' || operation.op === 'translate_along') {
        const vector: Vec3 = operation.op === 'translate'
          ? operation.vector
          : (() => {
              const direction = resolveDirectionSpec(structure, operation.direction, `operations[${index}].direction`)
              return [
                direction[0] * operation.distanceA,
                direction[1] * operation.distanceA,
                direction[2] * operation.distanceA,
              ]
            })()
        const chosenSet = new Set(selection.indices)
        structure = {
          ...structure,
          atoms: structure.atoms.map((atom, atomIndex) => {
            if (!chosenSet.has(atomIndex)) return atom
            const next: Vec3 = [
              atom.position[0] + vector[0],
              atom.position[1] + vector[1],
              atom.position[2] + vector[2],
            ]
            if (distance(atom.position, next) > 1e-10) changedAtomCount++
            return { ...atom, position: next }
          }),
        }
      } else if (operation.op === 'rotate' || operation.op === 'align' || operation.op === 'rotate_about_axis_through') {
        try {
          const rigid: RigidTransformOperation = operation.op === 'rotate_about_axis_through'
            ? {
                op: 'rotate',
                axis: resolveDirectionSpec(structure, operation.axis, `operations[${index}].axis`),
                angleDeg: operation.angleDeg,
                origin: resolveRotationPivot(structure, operation, `operations[${index}].pivot`),
                rotateLattice: false,
              }
            : operation
          const transformed = applyRigidTransform({
            structure,
            selectedAtomIndices: selection.indices,
            selectionAll,
            operation: rigid,
            operationIndex: index,
          })
          structure = transformed.structure
          changedAtomCount = transformed.changedAtomCount
          checks.push(...transformed.checks)
          for (const atomId of transformed.boundaryAtomIds) rotationBoundaryAtomIds.add(atomId)
        } catch (error) {
          if (error instanceof RigidTransformInputError) {
            throw new StructureOperationInputError(error.code, error.message)
          }
          throw error
        }
      } else if (operation.op === 'affine') {
        const deformLattice = operation.deformLattice
          ?? (selectionAll && structure.lattice !== undefined)
        if (deformLattice && !selectionAll) {
          throw new StructureOperationInputError('partial_cell_deformation', 'deformLattice=true requires a complete atom selection')
        }
        if (deformLattice && !structure.lattice) {
          throw new StructureOperationInputError('lattice_required', 'deformLattice=true requires a lattice')
        }
        if (deformLattice && Math.abs(determinant3(operation.matrix)) < 1e-10) {
          throw new StructureOperationInputError('singular_deformation', 'Affine matrix must be nonsingular when deforming the lattice')
        }
        const origin = operation.origin ?? [0, 0, 0]
        const chosenSet = new Set(selection.indices)
        structure = {
          ...structure,
          atoms: structure.atoms.map((atom, atomIndex) => {
            if (!chosenSet.has(atomIndex)) return atom
            const relative: Vec3 = [atom.position[0] - origin[0], atom.position[1] - origin[1], atom.position[2] - origin[2]]
            const transformed = applyLinear(operation.matrix, relative)
            const next: Vec3 = [transformed[0] + origin[0], transformed[1] + origin[1], transformed[2] + origin[2]]
            if (distance(atom.position, next) > 1e-10) changedAtomCount++
            return { ...atom, position: next }
          }),
          ...(deformLattice && structure.lattice ? {
            lattice: {
              ...structure.lattice,
              vectors: structure.lattice.vectors.map((row) => applyLinear(operation.matrix, row)) as Mat3,
            },
          } : {}),
        }
        checks.push({
          id: `operation.${index}.affine_determinant`,
          status: determinant3(operation.matrix) > 1e-10 ? 'pass' : 'warn',
          message: `Affine determinant is ${determinant3(operation.matrix).toFixed(8)}${deformLattice ? ' and lattice vectors were transformed' : ''}`,
          metrics: { determinant: determinant3(operation.matrix), deformLattice },
        })
      } else if (operation.op === 'wrap') {
        if (!structure.lattice || !structure.lattice.periodic.some(Boolean)) {
          throw new StructureOperationInputError('periodic_lattice_required', 'wrap requires a periodic lattice')
        }
        const chosenSet = new Set(selection.indices)
        structure = {
          ...structure,
          atoms: structure.atoms.map((atom, atomIndex) => {
            if (!chosenSet.has(atomIndex)) return atom
            const fractional = cartesianToFractional(atom.position, structure.lattice!.vectors)
            if (!fractional) throw new StructureOperationInputError('singular_lattice', 'Cannot wrap with a singular lattice')
            const next = fractionalToCartesian(wrapFractional(fractional, structure.lattice!.periodic), structure.lattice!.vectors)
            if (distance(atom.position, next) > 1e-10) changedAtomCount++
            return { ...atom, position: next }
          }),
        }
      }
      checks.push({
        id: `operation.${index}.changed_atoms`,
        status: changedAtomCount ? 'pass' : 'warn',
        message: changedAtomCount
          ? `${operation.op} changed ${changedAtomCount.toLocaleString()} atoms`
          : `${operation.op} completed but did not change any atom`,
        metrics: { selectedAtomCount, changedAtomCount },
      })
    }

    reports.push({
      index,
      op: operation.op,
      selectedAtomCount,
      changedAtomCount,
      ...(selectedBondCount ? { selectedBondCount } : {}),
      ...(changedBondCount ? { changedBondCount } : {}),
      ...(operationSeed !== undefined ? { seed: operationSeed } : {}),
      beforeFingerprint,
      afterFingerprint: fingerprintStructure(structure),
    })
  })

  const validation = validateStructure(structure)
  const changeSet = buildStructureChangeSet(source, structure, detailLimit)
  const changedCurrentIds = [
    ...(changeSet.added ?? []).map((item) => item.atomId),
    ...(changeSet.moved ?? []).map((item) => item.atomId),
    ...changeSet.relabeled.map((item) => item.atomId),
  ]
  const inspectionTargets: InspectionTarget[] = changeSet.changedBounds
    ? [{
        id: 'structure-operation-region',
        reason: `Inspect changes from ${options.operations.length} structure operations`,
        center: changeSet.changedBounds.center,
        radius: Math.max(1, changeSet.changedBounds.radius),
        atomIds: [...new Set(changedCurrentIds)].slice(0, 80),
        atomIdsTruncated: changedCurrentIds.length > 80 || !!changeSet.addedTruncated || !!changeSet.movedTruncated || changeSet.relabeledTruncated,
      }]
    : []
  const rotationBoundaryAtoms = structure.atoms.filter((atom) => rotationBoundaryAtomIds.has(atom.id))
  const rotationBoundaryBounds = boundsOfPositions(rotationBoundaryAtoms.map((atom) => atom.position))
  if (rotationBoundaryBounds) {
    inspectionTargets.push({
      id: 'structure-operation-rotation-boundary-bonds',
      reason: 'Inspect explicit bonds crossing a rotated/fixed atom-selection boundary',
      center: rotationBoundaryBounds.center,
      radius: Math.max(1, rotationBoundaryBounds.radius),
      atomIds: rotationBoundaryAtoms.slice(0, 80).map((atom) => atom.id),
      ...(rotationBoundaryAtoms.length > 80 ? { atomIdsTruncated: true } : {}),
    })
  }
  if (changeSet.latticeChanged && validation.bounds) {
    inspectionTargets.push({
      id: 'structure-operation-cell-overview',
      reason: 'Inspect the structure after its lattice vectors or periodic boundaries changed',
      center: validation.bounds.center,
      radius: Math.max(1, validation.bounds.radius),
      atomIds: structure.atoms.slice(0, 80).map((atom) => atom.id),
      ...(structure.atoms.length > 80 ? { atomIdsTruncated: true } : {}),
    })
  }
  inspectionTargets.push(...validation.inspectionTargets)
  const changeSetNonempty = !!(
    changeSet.addedCount || changeSet.removedCount || changeSet.movedCount || changeSet.relabeledCount
    || changeSet.addedBondCount || changeSet.removedBondCount || changeSet.changedBondCount
    || changeSet.changedAtomPropertiesCount || changeSet.structureMetadataChanged || changeSet.latticeChanged
  )
  const allChecks: ValidationCheck[] = [
    ...checks,
    ...validation.checks,
    {
      id: 'operations.change_set_nonempty',
      status: changeSetNonempty ? 'pass' : 'warn',
      message: changeSetNonempty
        ? `Change set: atoms +${changeSet.addedCount ?? 0} / -${changeSet.removedCount ?? 0} / moved ${changeSet.movedCount ?? 0} / relabeled ${changeSet.relabeledCount}; bonds +${changeSet.addedBondCount ?? 0} / -${changeSet.removedBondCount ?? 0} / changed ${changeSet.changedBondCount ?? 0}; lattice ${changeSet.latticeChanged ? 'changed' : 'unchanged'}; metadata ${changeSet.structureMetadataChanged ? 'changed' : 'unchanged'}`
        : 'Operation pipeline produced an artifact identical to the source',
    },
  ]
  const provenance: StructureProvenance = {
    engine: 'zatom-structure-operations',
    engineVersion: STRUCTURE_OPERATIONS_VERSION,
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    seed: baseSeed,
    parameters: {
      operations: options.operations as unknown as JsonValue,
      maxOutputAtoms,
    },
  }

  return {
    structure,
    validation,
    checks: allChecks,
    changeSet,
    provenance,
    operations: reports,
    inspectionTargets,
  }
}
