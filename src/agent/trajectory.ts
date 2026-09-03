/** Canonical bounded trajectory parsing, validation, and replay fingerprinting. */

import type { JsonValue, Mat3, Vec3, ZatomStructure, ZatomTrajectory } from './contracts'
import { ZATOM_TRAJECTORY_SCHEMA } from './contracts'
import {
  canonicalJsonIdentity,
  compareCanonicalText,
  createFnv1a64Hasher,
  determinant3,
} from './structure-math'

export class ZatomTrajectoryInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomTrajectoryInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function rejectUnsupportedFields(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const supported = new Set(allowed)
  const unsupported = Object.keys(value).filter((key) => !supported.has(key)).sort()
  if (unsupported.length) {
    throw new ZatomTrajectoryInputError(
      'unsupported_trajectory_field',
      `${field} contains unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`,
    )
  }
}

function vec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} must contain three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

function parseLattice(value: unknown, field: string): NonNullable<ZatomTrajectory['lattice']> {
  if (!isRecord(value) || !Array.isArray(value.vectors) || value.vectors.length !== 3
    || !Array.isArray(value.periodic) || value.periodic.length !== 3
    || value.periodic.some((item) => typeof item !== 'boolean')) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} is invalid`)
  }
  rejectUnsupportedFields(value, ['vectors', 'periodic'], field)
  const vectors = value.vectors.map((row, index) => vec3(row, `${field}.vectors[${index}]`)) as Mat3
  if (determinant3(vectors) <= 1e-8) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} must be right-handed and nonsingular`)
  }
  return { vectors, periodic: [...value.periodic] as [boolean, boolean, boolean] }
}

function latticeMatches(
  left: NonNullable<ZatomTrajectory['lattice']>,
  right: NonNullable<ZatomTrajectory['lattice']>,
): boolean {
  const vectorError = Math.max(...left.vectors.flatMap((row, rowIndex) => (
    row.map((item, axis) => Math.abs(item - right.vectors[rowIndex][axis]))
  )))
  return vectorError <= 1e-8 && left.periodic.every((item, index) => item === right.periodic[index])
}

function jsonValue(value: unknown, field: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} must be finite`)
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`)]))
  throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} is not JSON-safe`)
}

export interface ParseZatomTrajectoryOptions {
  structure?: ZatomStructure
  maxFrames?: number
  maxAtomFrames?: number
}

export function parseZatomTrajectory(value: unknown, options: ParseZatomTrajectoryOptions = {}): ZatomTrajectory {
  if (!isRecord(value) || value.schemaVersion !== ZATOM_TRAJECTORY_SCHEMA) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.schemaVersion must be ${ZATOM_TRAJECTORY_SCHEMA}`)
  }
  rejectUnsupportedFields(value, ['schemaVersion', 'atomIds', 'coordinateMode', 'frames', 'lattice', 'label', 'metadata'], 'trajectory')
  const maxFrames = options.maxFrames ?? 10_000
  const maxAtomFrames = options.maxAtomFrames ?? 10_000_000
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 2 || !Number.isSafeInteger(maxAtomFrames) || maxAtomFrames < 2) {
    throw new ZatomTrajectoryInputError('invalid_trajectory_budget', 'Trajectory parser budgets must be positive safe integers')
  }
  if (!Array.isArray(value.atomIds) || !value.atomIds.length
    || value.atomIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.atomIds must be a non-empty string array')
  }
  const atomIds = value.atomIds.map(String)
  if (new Set(atomIds).size !== atomIds.length) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.atomIds must be unique')
  }
  if (options.structure) {
    const expected = options.structure.atoms.map((atom) => atom.id)
    if (atomIds.length !== expected.length || atomIds.some((id, index) => id !== expected[index])) {
      throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.atomIds must exactly match result structure atom order')
    }
  }
  if (value.coordinateMode !== 'cartesian' && value.coordinateMode !== 'unwrapped-cartesian') {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.coordinateMode must be cartesian or unwrapped-cartesian')
  }
  if (!Array.isArray(value.frames) || value.frames.length < 2 || value.frames.length > maxFrames) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.frames must contain 2-${maxFrames} frames`)
  }
  if (atomIds.length * value.frames.length > maxAtomFrames) {
    throw new ZatomTrajectoryInputError(
      'invalid_trajectory_budget',
      `Trajectory has ${atomIds.length * value.frames.length} atom-frames above budget ${maxAtomFrames}`,
    )
  }
  let previousStep = -1
  let previousTimePs = -Infinity
  const frames = value.frames.map((raw, frameIndex) => {
    if (!isRecord(raw)) throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.frames[${frameIndex}] must be an object`)
    rejectUnsupportedFields(
      raw,
      ['step', 'timePs', 'positions', 'velocitiesAperPs', 'forcesEvPerA', 'lattice', 'scalars'],
      `trajectory.frames[${frameIndex}]`,
    )
    const step = Number(raw.step)
    const timePs = Number(raw.timePs)
    if (!Number.isSafeInteger(step) || step < 0 || step <= previousStep) {
      throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.frames[${frameIndex}].step must be a strictly increasing non-negative safe integer`)
    }
    if (!Number.isFinite(timePs) || timePs < 0 || timePs <= previousTimePs) {
      throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.frames[${frameIndex}].timePs must be finite, non-negative, and strictly increasing`)
    }
    previousStep = step
    previousTimePs = timePs
    const parseVectors = (rawVectors: unknown, field: string): Vec3[] => {
      if (!Array.isArray(rawVectors) || rawVectors.length !== atomIds.length) {
        throw new ZatomTrajectoryInputError('invalid_trajectory', `${field} must align to all ${atomIds.length} atoms`)
      }
      return rawVectors.map((item, atomIndex) => vec3(item, `${field}[${atomIndex}]`))
    }
    const positions = parseVectors(raw.positions, `trajectory.frames[${frameIndex}].positions`)
    const velocitiesAperPs = raw.velocitiesAperPs === undefined
      ? undefined
      : parseVectors(raw.velocitiesAperPs, `trajectory.frames[${frameIndex}].velocitiesAperPs`)
    const forcesEvPerA = raw.forcesEvPerA === undefined
      ? undefined
      : parseVectors(raw.forcesEvPerA, `trajectory.frames[${frameIndex}].forcesEvPerA`)
    const lattice = raw.lattice === undefined
      ? undefined
      : parseLattice(raw.lattice, `trajectory.frames[${frameIndex}].lattice`)
    let scalars: Record<string, number> | undefined
    if (raw.scalars !== undefined) {
      if (!isRecord(raw.scalars) || Object.entries(raw.scalars).some(([key, item]) => (
        !key.trim() || typeof item !== 'number' || !Number.isFinite(item)
      ))) {
        throw new ZatomTrajectoryInputError('invalid_trajectory', `trajectory.frames[${frameIndex}].scalars must contain finite numeric values`)
      }
      scalars = Object.fromEntries(Object.entries(raw.scalars).map(([key, item]) => [key, Number(item)]))
    }
    return {
      step,
      timePs,
      positions,
      ...(velocitiesAperPs ? { velocitiesAperPs } : {}),
      ...(forcesEvPerA ? { forcesEvPerA } : {}),
      ...(lattice ? { lattice } : {}),
      ...(scalars ? { scalars } : {}),
    }
  })
  if (options.structure) {
    const finalPositions = frames[frames.length - 1].positions
    const maxFinalPositionErrorA = Math.max(...finalPositions.map((position, index) => Math.hypot(
      position[0] - options.structure!.atoms[index].position[0],
      position[1] - options.structure!.atoms[index].position[1],
      position[2] - options.structure!.atoms[index].position[2],
    )))
    if (maxFinalPositionErrorA > 1e-8) {
      throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory final frame must match result structure positions')
    }
  }

  const lattice = value.lattice === undefined ? undefined : parseLattice(value.lattice, 'trajectory.lattice')
  const frameLatticeCount = frames.filter((frame) => frame.lattice !== undefined).length
  if (lattice && frameLatticeCount > 0) {
    throw new ZatomTrajectoryInputError(
      'invalid_trajectory',
      'trajectory must use either one fixed lattice or a lattice on every frame, never both',
    )
  }
  if (frameLatticeCount !== 0 && frameLatticeCount !== frames.length) {
    throw new ZatomTrajectoryInputError(
      'invalid_trajectory',
      'variable-cell trajectories must provide a lattice on every frame',
    )
  }
  if (frameLatticeCount === frames.length) {
    const firstPeriodic = frames[0].lattice!.periodic
    if (frames.some((frame) => frame.lattice!.periodic.some((item, index) => item !== firstPeriodic[index]))) {
      throw new ZatomTrajectoryInputError(
        'invalid_trajectory',
        'variable-cell trajectory periodic boundary flags must remain constant across frames',
      )
    }
  }
  const finalLattice = lattice ?? frames[frames.length - 1].lattice
  if (options.structure?.lattice) {
    if (!finalLattice) {
      throw new ZatomTrajectoryInputError(
        'invalid_trajectory',
        'periodic trajectory must carry one fixed lattice or a lattice on every frame',
      )
    }
    if (!latticeMatches(finalLattice, options.structure.lattice)) {
      throw new ZatomTrajectoryInputError(
        'invalid_trajectory',
        'trajectory final lattice must match the result structure lattice',
      )
    }
  } else if (options.structure && finalLattice) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory supplies lattice evidence but the result structure does not')
  }

  if (value.label !== undefined && typeof value.label !== 'string') {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.label must be a string')
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw new ZatomTrajectoryInputError('invalid_trajectory', 'trajectory.metadata must be an object')
  }
  return {
    schemaVersion: ZATOM_TRAJECTORY_SCHEMA,
    atomIds,
    coordinateMode: value.coordinateMode,
    frames,
    ...(lattice ? { lattice } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    ...(value.metadata === undefined ? {} : { metadata: jsonValue(value.metadata, 'trajectory.metadata') as Record<string, JsonValue> }),
  }
}

/** Stable non-cryptographic fingerprint for replay and viewport handoff checks. */
export function fingerprintTrajectory(trajectory: ZatomTrajectory): string {
  const hasher = createFnv1a64Hasher()
  const feed = hasher.feed
  feed(canonicalJsonIdentity(trajectory.schemaVersion))
  feed(canonicalJsonIdentity(trajectory.coordinateMode))
  feed(`atoms:${trajectory.atomIds.length}|`)
  for (const atomId of trajectory.atomIds) feed(canonicalJsonIdentity(atomId))
  feed(trajectory.lattice ? 'lattice:1|' : 'lattice:0|')
  if (trajectory.lattice) {
    for (const row of trajectory.lattice.vectors) for (const value of row) feed(`${Math.round(value * 1e8)};`)
    feed(trajectory.lattice.periodic.map((value) => value ? '1' : '0').join(''))
  }
  feed(`frames:${trajectory.frames.length}|`)
  for (const frame of trajectory.frames) {
    feed(`${frame.step}|${Math.round(frame.timePs * 1e12)}|`)
    feed(frame.lattice ? 'l1|' : 'l0|')
    if (frame.lattice) {
      for (const row of frame.lattice.vectors) for (const value of row) feed(`${Math.round(value * 1e8)};`)
      feed(frame.lattice.periodic.map((value) => value ? '1' : '0').join(''))
    }
    for (const position of frame.positions) for (const value of position) feed(`${Math.round(value * 1e8)};`)
    feed(frame.velocitiesAperPs ? 'v1|' : 'v0|')
    for (const velocity of frame.velocitiesAperPs ?? []) for (const value of velocity) feed(`${Math.round(value * 1e8)};`)
    feed(frame.forcesEvPerA ? 'f1|' : 'f0|')
    for (const force of frame.forcesEvPerA ?? []) for (const value of force) feed(`${Math.round(value * 1e8)};`)
    const scalarEntries = Object.entries(frame.scalars ?? {}).sort(([left], [right]) => (
      compareCanonicalText(left, right)
    ))
    feed(`scalars:${scalarEntries.length}|`)
    for (const [key, value] of scalarEntries) {
      feed(canonicalJsonIdentity(key))
      feed(`${Math.round(value * 1e12)};`)
    }
  }
  feed(trajectory.metadata ? 'metadata:1|' : 'metadata:0|')
  if (trajectory.metadata) feed(canonicalJsonIdentity(trajectory.metadata))
  return hasher.digest()
}
