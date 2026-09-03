/** Deterministic head-to-tail polymer construction from explicit molecular ports. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomBondOrder,
  ZatomStructure,
  ZatomStructureBond,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { ZATOM_BIOMOLECULAR_IDENTITY_PREFIX } from './biomolecular-identity'
import { validateMolecularTopology, type MolecularTopologyReport } from './molecule'
import { buildStructureChangeSet } from './operations'
import { boundsOfPositions, fingerprintStructure } from './structure-math'
import { validateStructure } from './structure-validation'

const MAX_REPEATS = 1024
const MAX_ATOMS = 100_000
const MAX_PAIR_CHECKS = 5_000_000
const MAX_JUNCTION_TARGETS = 24
const GEOMETRY_TOLERANCE = 1e-8

export class PolymerInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PolymerInputError'
    this.code = code
  }
}

export interface PolymerPort {
  /** Retained atom that forms the new inter-repeat bond. */
  anchorAtomId: string
  /** Directly bonded leaving atom whose direction defines the port axis. */
  directionAtomId: string
  /** Complete connected leaving group; it must attach only through anchor-direction. */
  removeAtomIds: string[]
}

export interface BuildLinearPolymerOptions {
  structure: ZatomStructure
  head: PolymerPort
  tail: PolymerPort
  repeatCount: number
  bondOrder?: ZatomBondOrder
  targetBondLengthA?: number
  twistDeg?: number
  minimumInterrepeatDistanceA?: number
  interrepeatWarningDistanceA?: number
  maxInterrepeatPairChecks?: number
  maxAtoms?: number
  bondLengthToleranceFraction?: number
  label?: string
}

export interface PolymerRepeatManifest {
  repeatIndex: number
  repeatNumber: number
  retainedAtomCount: number
  removedAtomIds: string[]
  outputAtomIds: string[]
  outputAtomIdsTruncated: boolean
  rotation: Mat3
  translationA: Vec3
  bounds: { min: Vec3; max: Vec3; center: Vec3; radius: number }
}

export interface PolymerJunction {
  index: number
  bondId: string
  tailRepeatIndex: number
  headRepeatIndex: number
  tailAtomId: string
  headAtomId: string
  bondLengthA: number
  tailPortAngleErrorDeg: number
  headPortAngleErrorDeg: number
}

export interface BuildLinearPolymerResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  topology: MolecularTopologyReport
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  repeats: PolymerRepeatManifest[]
  junctions: PolymerJunction[]
  removedAtomCount: number
  retainedTerminalLeavingGroups: { head: string[]; tail: string[] }
  interrepeatPairCount: number
  minimumInterrepeatDistanceA: number | null
  closestInterrepeatPair: [string, string] | null
  formalCharge: number | null
}

interface Transform {
  rotation: Mat3
  translation: Vec3
}

interface ValidatedPort extends PolymerPort {
  removeSet: Set<string>
  direction: Vec3
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]))
}

function cloneJsonRecord(value: Record<string, JsonValue> | undefined): Record<string, JsonValue> | undefined {
  return value ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)])) : undefined
}

function finiteNumber(value: number | undefined, fallback: number, field: string, minimum: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < minimum || resolved > maximum) {
    throw new PolymerInputError('invalid_polymer_number', `${field} must be finite from ${minimum} through ${maximum}`)
  }
  return resolved
}

function boundedInteger(value: number | undefined, fallback: number, field: string, minimum: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new PolymerInputError('invalid_polymer_integer', `${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return resolved
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(value: Vec3, field: string): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new PolymerInputError('degenerate_polymer_port', `${field} must define a non-zero direction`)
  }
  return [value[0] / length, value[1] / length, value[2] / length]
}

function identityMatrix(): Mat3 {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
}

function applyMatrix(matrix: Mat3, vector: Vec3): Vec3 {
  return [
    dot(matrix[0], vector),
    dot(matrix[1], vector),
    dot(matrix[2], vector),
  ]
}

function multiplyMatrices(left: Mat3, right: Mat3): Mat3 {
  const column = (index: number): Vec3 => [right[0][index], right[1][index], right[2][index]]
  return [
    [dot(left[0], column(0)), dot(left[0], column(1)), dot(left[0], column(2))],
    [dot(left[1], column(0)), dot(left[1], column(1)), dot(left[1], column(2))],
    [dot(left[2], column(0)), dot(left[2], column(1)), dot(left[2], column(2))],
  ]
}

function transpose(matrix: Mat3): Mat3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ]
}

function rotationAroundAxis(axisValue: Vec3, angleRad: number): Mat3 {
  const axis = normalize(axisValue, 'rotation axis')
  const [x, y, z] = axis
  const cosine = Math.cos(angleRad)
  const sine = Math.sin(angleRad)
  const oneMinus = 1 - cosine
  return [
    [cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine],
    [y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine],
    [z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus],
  ]
}

function rotationBetween(fromValue: Vec3, toValue: Vec3): Mat3 {
  const from = normalize(fromValue, 'port alignment source')
  const to = normalize(toValue, 'port alignment target')
  const cosine = Math.max(-1, Math.min(1, dot(from, to)))
  const axisCandidate = cross(from, to)
  const sine = Math.hypot(axisCandidate[0], axisCandidate[1], axisCandidate[2])
  if (sine < 1e-12 && cosine > 0) return identityMatrix()
  if (sine < 1e-12) {
    const basis: Vec3 = Math.abs(from[0]) <= Math.abs(from[1]) && Math.abs(from[0]) <= Math.abs(from[2])
      ? [1, 0, 0]
      : Math.abs(from[1]) <= Math.abs(from[2]) ? [0, 1, 0] : [0, 0, 1]
    return rotationAroundAxis(normalize(cross(from, basis), 'antiparallel port alignment axis'), Math.PI)
  }
  return rotationAroundAxis(scale(axisCandidate, 1 / sine), Math.atan2(sine, cosine))
}

function transformed(position: Vec3, transform: Transform): Vec3 {
  return add(applyMatrix(transform.rotation, position), transform.translation)
}

function angleErrorDeg(first: Vec3, second: Vec3): number {
  const normalizedFirst = normalize(first, 'junction direction')
  const normalizedSecond = normalize(second, 'junction direction')
  return Math.acos(Math.max(-1, Math.min(1, dot(normalizedFirst, normalizedSecond)))) * 180 / Math.PI
}

function connectedCount(atomIds: Set<string>, bonds: ZatomStructureBond[]): number {
  if (!atomIds.size) return 0
  const adjacency = new Map([...atomIds].map((id) => [id, new Set<string>()]))
  for (const bond of bonds) {
    if (!atomIds.has(bond.atomIds[0]) || !atomIds.has(bond.atomIds[1])) continue
    adjacency.get(bond.atomIds[0])!.add(bond.atomIds[1])
    adjacency.get(bond.atomIds[1])!.add(bond.atomIds[0])
  }
  const visited = new Set<string>()
  let count = 0
  for (const id of atomIds) {
    if (visited.has(id)) continue
    count++
    const stack = [id]
    visited.add(id)
    while (stack.length) {
      for (const neighbor of adjacency.get(stack.pop()!) ?? []) {
        if (visited.has(neighbor)) continue
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }
  }
  return count
}

function validateSource(structure: ZatomStructure, bondLengthToleranceFraction: number): void {
  if (structure.schemaVersion !== ZATOM_STRUCTURE_SCHEMA || !structure.atoms.length) {
    throw new PolymerInputError('invalid_polymer_source', `Polymer source must be a non-empty ${ZATOM_STRUCTURE_SCHEMA} artifact`)
  }
  if (structure.lattice) throw new PolymerInputError('polymer_source_must_be_finite', 'Linear polymer construction requires a finite source without a lattice')
  if (structure.bonds === undefined) {
    throw new PolymerInputError('polymer_topology_required', 'Polymer construction requires explicit source bonds')
  }
  const validationFailures = validateStructure(structure).checks.filter((check) => check.status === 'fail')
  if (validationFailures.length) {
    throw new PolymerInputError('invalid_polymer_source', `Source validation failed: ${validationFailures.map((check) => check.message).join('; ')}`)
  }
  const topologyFailures = validateMolecularTopology(structure, { bondLengthToleranceFraction }).checks
    .filter((check) => check.status === 'fail')
  if (topologyFailures.length) {
    throw new PolymerInputError('invalid_polymer_source_topology', `Source topology failed: ${topologyFailures.map((check) => check.message).join('; ')}`)
  }
}

function normalizedId(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new PolymerInputError('invalid_polymer_port', `${field} must be a non-empty atom ID without NUL bytes`)
  }
  return value.trim()
}

function validatePort(structure: ZatomStructure, raw: PolymerPort, name: 'head' | 'tail'): ValidatedPort {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.removeAtomIds) || !raw.removeAtomIds.length) {
    throw new PolymerInputError('invalid_polymer_port', `${name} must include a non-empty removeAtomIds array`)
  }
  const atomById = new Map(structure.atoms.map((atom) => [atom.id, atom]))
  const anchorAtomId = normalizedId(raw.anchorAtomId, `${name}.anchorAtomId`)
  const directionAtomId = normalizedId(raw.directionAtomId, `${name}.directionAtomId`)
  const removeAtomIds = raw.removeAtomIds.map((id, index) => normalizedId(id, `${name}.removeAtomIds[${index}]`))
  const removeSet = new Set(removeAtomIds)
  if (removeSet.size !== removeAtomIds.length) throw new PolymerInputError('invalid_polymer_port', `${name}.removeAtomIds must not repeat atom IDs`)
  if (!atomById.has(anchorAtomId) || !atomById.has(directionAtomId)) {
    throw new PolymerInputError('polymer_port_atom_missing', `${name} anchor or direction atom is absent from the source`)
  }
  if (removeSet.has(anchorAtomId) || !removeSet.has(directionAtomId)) {
    throw new PolymerInputError('invalid_polymer_port', `${name} must retain anchorAtomId and include directionAtomId in removeAtomIds`)
  }
  for (const id of removeSet) if (!atomById.has(id)) {
    throw new PolymerInputError('polymer_port_atom_missing', `${name}.removeAtomIds references absent atom ${JSON.stringify(id)}`)
  }
  if (connectedCount(removeSet, structure.bonds!) !== 1) {
    throw new PolymerInputError('disconnected_polymer_leaving_group', `${name} removeAtomIds must be one connected leaving group`)
  }
  const boundary = structure.bonds!.filter((bond) => removeSet.has(bond.atomIds[0]) !== removeSet.has(bond.atomIds[1]))
  const expectedPair = new Set([anchorAtomId, directionAtomId])
  if (boundary.length !== 1 || !boundary[0].atomIds.every((id) => expectedPair.has(id))) {
    throw new PolymerInputError(
      'invalid_polymer_port_boundary',
      `${name} leaving group must attach to the retained source through exactly one anchor-direction bond`,
    )
  }
  const anchor = atomById.get(anchorAtomId)!
  const directionAtom = atomById.get(directionAtomId)!
  return {
    anchorAtomId,
    directionAtomId,
    removeAtomIds,
    removeSet,
    direction: normalize(subtract(directionAtom.position, anchor.position), `${name} port direction`),
  }
}

function outputAtomId(repeatIndex: number, sourceAtomId: string): string {
  return `repeat-${String(repeatIndex + 1).padStart(4, '0')}::${sourceAtomId}`
}

function outputBondId(repeatIndex: number, sourceBondId: string): string {
  return `repeat-${String(repeatIndex + 1).padStart(4, '0')}::${sourceBondId}`
}

function pairKey(first: string, second: string): string {
  return first < second ? `${first}\0${second}` : `${second}\0${first}`
}

/**
 * Build a finite, capped, head-to-tail linear polymer. Internal copies lose both
 * declared leaving groups; the first head and last tail groups remain as caps.
 * Repeat units are rigidly placed from their port axes and an explicit twist.
 */
export function buildLinearPolymer(options: BuildLinearPolymerOptions): BuildLinearPolymerResult {
  const bondLengthToleranceFraction = finiteNumber(
    options.bondLengthToleranceFraction,
    0.35,
    'bondLengthToleranceFraction',
    0,
    10,
  )
  validateSource(options.structure, bondLengthToleranceFraction)
  const source = options.structure
  const head = validatePort(source, options.head, 'head')
  const tail = validatePort(source, options.tail, 'tail')
  for (const id of head.removeSet) if (tail.removeSet.has(id)) {
    throw new PolymerInputError('overlapping_polymer_ports', `Head and tail leaving groups overlap at atom ${JSON.stringify(id)}`)
  }
  if (head.removeSet.has(tail.anchorAtomId) || tail.removeSet.has(head.anchorAtomId)) {
    throw new PolymerInputError('overlapping_polymer_ports', 'A polymer anchor cannot belong to the opposite leaving group')
  }
  const sourceIds = new Set(source.atoms.map((atom) => atom.id))
  const coreIds = new Set([...sourceIds].filter((id) => !head.removeSet.has(id) && !tail.removeSet.has(id)))
  if (!coreIds.size || connectedCount(coreIds, source.bonds!) !== 1) {
    throw new PolymerInputError('disconnected_polymer_core', 'Removing both declared leaving groups must leave one non-empty connected repeat core')
  }

  const repeatCount = boundedInteger(options.repeatCount, 1, 'repeatCount', 1, MAX_REPEATS)
  const maxAtoms = boundedInteger(options.maxAtoms, 20_000, 'maxAtoms', 1, MAX_ATOMS)
  const pairBudget = boundedInteger(
    options.maxInterrepeatPairChecks,
    1_000_000,
    'maxInterrepeatPairChecks',
    1,
    MAX_PAIR_CHECKS,
  )
  const targetBondLengthA = finiteNumber(options.targetBondLengthA, 1.5, 'targetBondLengthA', 0.4, 5)
  const twistDeg = finiteNumber(options.twistDeg, 180, 'twistDeg', -36_000, 36_000)
  const minimumDistanceA = finiteNumber(
    options.minimumInterrepeatDistanceA,
    0.65,
    'minimumInterrepeatDistanceA',
    0,
    100,
  )
  const warningDistanceA = finiteNumber(
    options.interrepeatWarningDistanceA,
    Math.max(0.9, minimumDistanceA),
    'interrepeatWarningDistanceA',
    0,
    100,
  )
  if (warningDistanceA < minimumDistanceA) {
    throw new PolymerInputError('invalid_polymer_distances', 'interrepeatWarningDistanceA must be at least minimumInterrepeatDistanceA')
  }
  const bondOrder = options.bondOrder ?? 1
  if (bondOrder !== 1 && bondOrder !== 1.5 && bondOrder !== 2 && bondOrder !== 3) {
    throw new PolymerInputError('invalid_polymer_bond_order', 'bondOrder must be 1, 1.5, 2, or 3')
  }
  const projectedAtomCount = repeatCount === 1
    ? source.atoms.length
    : source.atoms.length * repeatCount
      - head.removeSet.size * (repeatCount - 1)
      - tail.removeSet.size * (repeatCount - 1)
  if (projectedAtomCount > maxAtoms) {
    throw new PolymerInputError(
      'polymer_atom_budget_exceeded',
      `Polymer requires ${projectedAtomCount} atoms after leaving-group removal; request cap is ${maxAtoms}`,
    )
  }

  const atomById = new Map(source.atoms.map((atom) => [atom.id, atom]))
  const transforms: Transform[] = [{ rotation: identityMatrix(), translation: [0, 0, 0] }]
  const headAnchorSource = atomById.get(head.anchorAtomId)!.position
  const tailAnchorSource = atomById.get(tail.anchorAtomId)!.position
  for (let repeatIndex = 1; repeatIndex < repeatCount; repeatIndex++) {
    const previous = transforms[repeatIndex - 1]
    const tailDirectionWorld = normalize(applyMatrix(previous.rotation, tail.direction), 'transformed tail direction')
    const inheritedHeadDirection = normalize(applyMatrix(previous.rotation, head.direction), 'inherited head direction')
    const desiredHeadDirection = scale(tailDirectionWorld, -1)
    const alignment = rotationBetween(inheritedHeadDirection, desiredHeadDirection)
    const alignedRotation = multiplyMatrices(alignment, previous.rotation)
    const twist = rotationAroundAxis(tailDirectionWorld, twistDeg * Math.PI / 180)
    const rotation = multiplyMatrices(twist, alignedRotation)
    const previousTailAnchor = transformed(tailAnchorSource, previous)
    const desiredHeadAnchor = add(previousTailAnchor, scale(tailDirectionWorld, targetBondLengthA))
    const translation = subtract(desiredHeadAnchor, applyMatrix(rotation, headAnchorSource))
    transforms.push({ rotation, translation })
  }

  const atoms: ZatomStructure['atoms'] = []
  const bonds: ZatomStructureBond[] = []
  const atomsByRepeat: ZatomStructure['atoms'][] = []
  const idMaps: Array<Map<string, string>> = []
  const repeats: PolymerRepeatManifest[] = []
  let maxRoundTripErrorA = 0
  let maxInternalBondLengthErrorA = 0
  let overwrittenPolymerAnnotationCount = 0
  let removedAtomCount = 0
  for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex++) {
    const removed = new Set<string>()
    if (repeatIndex > 0) for (const id of head.removeSet) removed.add(id)
    if (repeatIndex < repeatCount - 1) for (const id of tail.removeSet) removed.add(id)
    removedAtomCount += removed.size
    const transform = transforms[repeatIndex]
    const inverseRotation = transpose(transform.rotation)
    const idMap = new Map<string, string>()
    idMaps.push(idMap)
    const repeatAtoms = source.atoms.filter((atom) => !removed.has(atom.id)).map((atom) => {
      const id = outputAtomId(repeatIndex, atom.id)
      idMap.set(atom.id, id)
      const position = transformed(atom.position, transform)
      const roundTrip = applyMatrix(inverseRotation, subtract(position, transform.translation))
      maxRoundTripErrorA = Math.max(maxRoundTripErrorA, Math.hypot(
        roundTrip[0] - atom.position[0],
        roundTrip[1] - atom.position[1],
        roundTrip[2] - atom.position[2],
      ))
      if (atom.properties?.['zatom.polymer.repeatIndex'] !== undefined
        || atom.properties?.['zatom.polymer.sourceAtomId'] !== undefined) {
        overwrittenPolymerAnnotationCount++
      }
      return {
        id,
        element: atom.element,
        position,
        properties: {
          ...(cloneJsonRecord(atom.properties) ?? {}),
          'zatom.polymer.repeatIndex': repeatIndex,
          'zatom.polymer.repeatNumber': repeatIndex + 1,
          'zatom.polymer.sourceAtomId': atom.id,
        },
      }
    })
    const repeatAtomById = new Map(repeatAtoms.map((atom) => [atom.id, atom]))
    atoms.push(...repeatAtoms)
    atomsByRepeat.push(repeatAtoms)
    for (const bond of source.bonds!) {
      if (removed.has(bond.atomIds[0]) || removed.has(bond.atomIds[1])) continue
      const sourceFirst = atomById.get(bond.atomIds[0])!
      const sourceSecond = atomById.get(bond.atomIds[1])!
      const first = repeatAtomById.get(idMap.get(bond.atomIds[0])!)!
      const second = repeatAtomById.get(idMap.get(bond.atomIds[1])!)!
      const sourceLength = Math.hypot(...subtract(sourceFirst.position, sourceSecond.position))
      const outputLength = Math.hypot(...subtract(first.position, second.position))
      maxInternalBondLengthErrorA = Math.max(maxInternalBondLengthErrorA, Math.abs(outputLength - sourceLength))
      bonds.push({
        id: outputBondId(repeatIndex, bond.id),
        atomIds: [first.id, second.id],
        order: bond.order,
        properties: {
          ...(cloneJsonRecord(bond.properties) ?? {}),
          'zatom.polymer.repeatIndex': repeatIndex,
          'zatom.polymer.sourceBondId': bond.id,
        },
      })
    }
    const repeatBounds = boundsOfPositions(repeatAtoms.map((atom) => atom.position))!
    repeats.push({
      repeatIndex,
      repeatNumber: repeatIndex + 1,
      retainedAtomCount: repeatAtoms.length,
      removedAtomIds: [...removed].sort(),
      outputAtomIds: repeatAtoms.slice(0, 80).map((atom) => atom.id),
      outputAtomIdsTruncated: repeatAtoms.length > 80,
      rotation: transform.rotation.map((row) => [...row]) as Mat3,
      translationA: [...transform.translation] as Vec3,
      bounds: repeatBounds,
    })
  }
  const outputAtomById = new Map(atoms.map((atom) => [atom.id, atom]))

  const junctions: PolymerJunction[] = []
  const linkedPairs = new Set<string>()
  let maximumBondLengthErrorA = 0
  let maximumPortAngleErrorDeg = 0
  for (let index = 0; index < repeatCount - 1; index++) {
    const tailAtomId = idMaps[index].get(tail.anchorAtomId)!
    const headAtomId = idMaps[index + 1].get(head.anchorAtomId)!
    const tailPosition = outputAtomById.get(tailAtomId)!.position
    const headPosition = outputAtomById.get(headAtomId)!.position
    const bondVector = subtract(headPosition, tailPosition)
    const bondLengthA = Math.hypot(...bondVector)
    const tailDirectionWorld = applyMatrix(transforms[index].rotation, tail.direction)
    const headDirectionWorld = applyMatrix(transforms[index + 1].rotation, head.direction)
    const tailPortAngleErrorDeg = angleErrorDeg(tailDirectionWorld, bondVector)
    const headPortAngleErrorDeg = angleErrorDeg(headDirectionWorld, scale(bondVector, -1))
    maximumBondLengthErrorA = Math.max(maximumBondLengthErrorA, Math.abs(bondLengthA - targetBondLengthA))
    maximumPortAngleErrorDeg = Math.max(maximumPortAngleErrorDeg, tailPortAngleErrorDeg, headPortAngleErrorDeg)
    const bondId = `polymer-link-${String(index + 1).padStart(4, '0')}`
    bonds.push({
      id: bondId,
      atomIds: [tailAtomId, headAtomId],
      order: bondOrder,
      properties: {
        'zatom.polymer.role': 'repeat-link',
        'zatom.polymer.junctionIndex': index,
      },
    })
    linkedPairs.add(pairKey(tailAtomId, headAtomId))
    junctions.push({
      index,
      bondId,
      tailRepeatIndex: index,
      headRepeatIndex: index + 1,
      tailAtomId,
      headAtomId,
      bondLengthA,
      tailPortAngleErrorDeg,
      headPortAngleErrorDeg,
    })
  }

  let interrepeatPairCount = 0
  for (let left = 0; left < atomsByRepeat.length; left++) {
    for (let right = left + 1; right < atomsByRepeat.length; right++) {
      interrepeatPairCount += atomsByRepeat[left].length * atomsByRepeat[right].length
    }
  }
  const pairBudgetSufficient = interrepeatPairCount <= pairBudget
  let minimumInterrepeatDistanceA = Number.POSITIVE_INFINITY
  let closestInterrepeatPair: [string, string] | null = null
  if (pairBudgetSufficient) {
    for (let left = 0; left < atomsByRepeat.length; left++) {
      for (let right = left + 1; right < atomsByRepeat.length; right++) {
        for (const first of atomsByRepeat[left]) for (const second of atomsByRepeat[right]) {
          if (linkedPairs.has(pairKey(first.id, second.id))) continue
          const measured = Math.hypot(...subtract(first.position, second.position))
          if (measured < minimumInterrepeatDistanceA) {
            minimumInterrepeatDistanceA = measured
            closestInterrepeatPair = [first.id, second.id]
          }
        }
      }
    }
  }
  const resolvedMinimumDistanceA = Number.isFinite(minimumInterrepeatDistanceA)
    ? minimumInterrepeatDistanceA
    : null

  const sourceChargeValues = source.atoms.map((atom) => atom.properties?.formalCharge)
  const sourceHasAnyFormalCharge = sourceChargeValues.some((value) => value !== undefined)
  const sourceHasCompleteIntegerFormalCharge = sourceChargeValues.every((value) => Number.isInteger(value))
  const outputChargeValues = atoms.map((atom) => atom.properties?.formalCharge)
  const formalCharge = outputChargeValues.every((value) => Number.isInteger(value))
    ? (outputChargeValues as number[]).reduce((sum, value) => sum + value, 0)
    : null
  const hasBiomolecularIdentity = source.atoms.some((atom) => (
    Object.keys(atom.properties ?? {}).some((key) => key.startsWith(ZATOM_BIOMOLECULAR_IDENTITY_PREFIX))
  ))

  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: options.label?.trim() || `${source.label ?? 'repeat unit'} × ${repeatCount} linear polymer`,
    atoms,
    bonds,
    metadata: {
      ...(cloneJsonRecord(source.metadata) ?? {}),
      'zatom.polymer.kind': 'finite-linear-head-to-tail',
      'zatom.polymer.sourceFingerprint': fingerprintStructure(source),
      'zatom.polymer.repeatCount': repeatCount,
      'zatom.polymer.targetBondLengthA': targetBondLengthA,
      'zatom.polymer.twistDeg': twistDeg,
      'zatom.polymer.headPort': {
        anchorAtomId: head.anchorAtomId,
        directionAtomId: head.directionAtomId,
        removeAtomIds: [...head.removeAtomIds],
      },
      'zatom.polymer.tailPort': {
        anchorAtomId: tail.anchorAtomId,
        directionAtomId: tail.directionAtomId,
        removeAtomIds: [...tail.removeAtomIds],
      },
    },
  }
  const validation = validateStructure(structure)
  const topology = validateMolecularTopology(structure, { bondLengthToleranceFraction })
  const checks: ValidationCheck[] = [
    {
      id: 'polymer.source_contract',
      status: 'pass',
      message: `Accepted one finite connected repeat unit with ${source.atoms.length} atoms and ${source.bonds!.length} explicit bonds`,
      metrics: { sourceAtomCount: source.atoms.length, sourceBondCount: source.bonds!.length },
    },
    {
      id: 'polymer.port_contract',
      status: 'pass',
      message: 'Head and tail leaving groups are disjoint, connected, single-boundary subgraphs and leave one connected repeat core',
      metrics: {
        headLeavingAtomCount: head.removeSet.size,
        tailLeavingAtomCount: tail.removeSet.size,
        coreAtomCount: coreIds.size,
      },
    },
    {
      id: 'polymer.atom_budget',
      status: 'pass',
      message: `Constructed ${atoms.length} atoms under request cap ${maxAtoms}`,
      metrics: { atomCount: atoms.length, maxAtoms, repeatCount, removedAtomCount },
    },
    {
      id: 'polymer.identity_mapping',
      status: maxRoundTripErrorA <= GEOMETRY_TOLERANCE ? 'pass' : 'fail',
      message: `Every retained source atom maps to one namespaced repeat atom; maximum rigid-transform round-trip error is ${maxRoundTripErrorA.toExponential(4)} Å`,
      metrics: { maxRoundTripErrorA, toleranceA: GEOMETRY_TOLERANCE },
    },
    {
      id: 'polymer.internal_topology',
      status: maxInternalBondLengthErrorA <= GEOMETRY_TOLERANCE ? 'pass' : 'fail',
      message: `Preserved every retained internal bond ID/order/property with maximum length error ${maxInternalBondLengthErrorA.toExponential(4)} Å`,
      metrics: { internalBondCount: bonds.length - junctions.length, maxInternalBondLengthErrorA, toleranceA: GEOMETRY_TOLERANCE },
    },
    {
      id: 'polymer.link_topology',
      status: junctions.length === Math.max(0, repeatCount - 1) ? 'pass' : 'fail',
      message: `Created exactly ${junctions.length} explicit head-to-tail link bond(s) for ${repeatCount} repeats`,
      metrics: { junctionCount: junctions.length, expectedJunctionCount: Math.max(0, repeatCount - 1), bondOrder },
    },
    {
      id: 'polymer.junction_geometry',
      status: maximumBondLengthErrorA <= GEOMETRY_TOLERANCE && maximumPortAngleErrorDeg <= 1e-5 ? 'pass' : 'fail',
      message: `Junctions target ${targetBondLengthA.toFixed(6)} Å with maximum length error ${maximumBondLengthErrorA.toExponential(4)} Å and port-axis error ${maximumPortAngleErrorDeg.toExponential(4)}°`,
      metrics: {
        targetBondLengthA,
        maximumBondLengthErrorA,
        maximumPortAngleErrorDeg,
        lengthToleranceA: GEOMETRY_TOLERANCE,
        angleToleranceDeg: 1e-5,
        twistDeg,
      },
    },
    {
      id: 'polymer.interrepeat_pair_budget',
      status: pairBudgetSufficient ? 'pass' : 'fail',
      message: pairBudgetSufficient
        ? `Exhaustively considered ${interrepeatPairCount} cross-repeat atom pairs under budget ${pairBudget}`
        : `Cross-repeat pair count ${interrepeatPairCount} exceeds request budget ${pairBudget}; steric validation is unresolved`,
      metrics: { interrepeatPairCount, maxInterrepeatPairChecks: pairBudget },
    },
    {
      id: 'polymer.minimum_interrepeat_distance',
      status: !pairBudgetSufficient
        ? 'skipped'
        : resolvedMinimumDistanceA === null
          ? 'skipped'
          : resolvedMinimumDistanceA < minimumDistanceA
            ? 'fail'
            : resolvedMinimumDistanceA < warningDistanceA ? 'warn' : 'pass',
      message: !pairBudgetSufficient
        ? 'Cross-repeat minimum distance was not computed because the exact pair budget failed'
        : resolvedMinimumDistanceA === null
          ? 'No nonbonded cross-repeat pair exists for a single repeat'
          : `Closest nonbonded cross-repeat pair is ${resolvedMinimumDistanceA.toFixed(6)} Å; fail below ${minimumDistanceA.toFixed(6)} Å and warn below ${warningDistanceA.toFixed(6)} Å`,
      metrics: {
        minimumInterrepeatDistanceA: resolvedMinimumDistanceA,
        requiredMinimumDistanceA: minimumDistanceA,
        warningDistanceA,
      },
      ...(closestInterrepeatPair ? { atomIds: closestInterrepeatPair } : {}),
    },
    {
      id: 'polymer.formal_charge',
      status: sourceHasAnyFormalCharge && !sourceHasCompleteIntegerFormalCharge ? 'fail' : formalCharge === null ? 'skipped' : 'pass',
      message: sourceHasAnyFormalCharge && !sourceHasCompleteIntegerFormalCharge
        ? 'Source formal-charge annotations are partial or non-integer'
        : formalCharge === null
          ? 'No complete source formal-charge map was supplied; polymer total charge is unassessed'
          : `Retained atom formal charges sum to ${formalCharge}; leaving-group charges were removed exactly with their atoms`,
      metrics: { formalCharge },
    },
    {
      id: 'polymer.biomolecular_identity_scope',
      status: hasBiomolecularIdentity ? 'warn' : 'pass',
      message: hasBiomolecularIdentity
        ? 'Copied source biomolecular annotations repeat residue keys and are not a valid assembled identity map; reassign identity on the final atom order before force-field matching'
        : 'No source biomolecular identity annotations require reassignment',
    },
    {
      id: 'polymer.source_annotation_scope',
      status: overwrittenPolymerAnnotationCount ? 'warn' : 'pass',
      message: overwrittenPolymerAnnotationCount
        ? `Replaced prior zatom polymer-source annotations on ${overwrittenPolymerAnnotationCount} retained atom copy/copies`
        : 'No prior polymer-source annotations needed replacement',
      metrics: { overwrittenPolymerAnnotationCount },
    },
    {
      id: 'polymer.model_scope',
      status: 'warn',
      message: 'This is a deterministic rigid head-to-tail geometry/topology seed with capped termini; it does not choose tacticity beyond the declared twist, infer polymerization chemistry, parameterize, relax, sample conformations, estimate molecular-weight distributions, or establish material stability',
    },
    ...validation.checks,
    ...topology.checks,
  ]

  const overviewBounds = boundsOfPositions(atoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = [
    ...(overviewBounds ? [{
      id: 'polymer-overview',
      reason: `Inspect the complete ${repeatCount}-repeat finite linear polymer`,
      center: overviewBounds.center,
      radius: Math.max(1.5, overviewBounds.radius + 0.5),
      atomIds: atoms.slice(0, 80).map((atom) => atom.id),
      atomIdsTruncated: atoms.length > 80,
    }] : []),
    ...junctions.slice(0, MAX_JUNCTION_TARGETS).map((junction) => {
      const first = outputAtomById.get(junction.tailAtomId)!
      const second = outputAtomById.get(junction.headAtomId)!
      return {
        id: `polymer-junction-${junction.index + 1}`,
        reason: `Inspect explicit repeat junction ${junction.index + 1} at ${junction.bondLengthA.toFixed(4)} Å`,
        center: scale(add(first.position, second.position), 0.5),
        radius: Math.max(1.5, junction.bondLengthA + 0.75),
        atomIds: [first.id, second.id],
      }
    }),
    ...(closestInterrepeatPair && resolvedMinimumDistanceA !== null ? (() => {
      const first = outputAtomById.get(closestInterrepeatPair[0])!
      const second = outputAtomById.get(closestInterrepeatPair[1])!
      return [{
        id: 'polymer-closest-interrepeat-pair',
        reason: `Inspect closest nonbonded cross-repeat pair at ${resolvedMinimumDistanceA.toFixed(4)} Å`,
        center: scale(add(first.position, second.position), 0.5),
        radius: Math.max(1.5, resolvedMinimumDistanceA + 0.75),
        atomIds: closestInterrepeatPair,
      }]
    })() : []),
    ...topology.inspectionTargets,
    ...validation.inspectionTargets,
  ]
  if (junctions.length > MAX_JUNCTION_TARGETS) {
    checks.push({
      id: 'polymer.junction_target_coverage',
      status: 'warn',
      message: `Returned individual visual targets for the first ${MAX_JUNCTION_TARGETS} of ${junctions.length} junctions; all junction metrics and stable IDs remain available`,
      metrics: { targetCount: MAX_JUNCTION_TARGETS, junctionCount: junctions.length },
    })
  }

  const changeSet = buildStructureChangeSet(source, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-explicit-port-polymer',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      head: {
        anchorAtomId: head.anchorAtomId,
        directionAtomId: head.directionAtomId,
        removeAtomIds: [...head.removeAtomIds],
      },
      tail: {
        anchorAtomId: tail.anchorAtomId,
        directionAtomId: tail.directionAtomId,
        removeAtomIds: [...tail.removeAtomIds],
      },
      repeatCount,
      bondOrder,
      targetBondLengthA,
      twistDeg,
      minimumInterrepeatDistanceA: minimumDistanceA,
      interrepeatWarningDistanceA: warningDistanceA,
      maxInterrepeatPairChecks: pairBudget,
      maxAtoms,
      bondLengthToleranceFraction,
      transforms: transforms.map((transform, repeatIndex) => ({
        repeatIndex,
        rotation: transform.rotation.map((row) => [...row]),
        translationA: [...transform.translation],
      })),
    },
  }
  return {
    structure,
    validation,
    topology,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    repeats,
    junctions,
    removedAtomCount,
    retainedTerminalLeavingGroups: {
      head: repeatCount ? head.removeAtomIds.map((id) => outputAtomId(0, id)) : [],
      tail: repeatCount ? tail.removeAtomIds.map((id) => outputAtomId(repeatCount - 1, id)) : [],
    },
    interrepeatPairCount,
    minimumInterrepeatDistanceA: resolvedMinimumDistanceA,
    closestInterrepeatPair,
    formalCharge,
  }
}
