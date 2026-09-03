/**
 * Resolve conversational molecule/component pose requests into the canonical
 * structure-operation pipeline.  This module deliberately plans operations;
 * rigid-body math remains owned by applyStructureOperations.
 */

import { resolveSurfaceNormal } from '../lib/scene-grid/system-semantics'
import type {
  StructureOperation,
} from './operations'
import {
  applyStructureOperations,
  type ApplyStructureOperationsResult,
} from './operations'
import type { ValidationCheck, Vec3, ZatomStructure } from './contracts'
import { createCertifiedMinimumImageCalculator, distance } from './structure-math'

const VECTOR_EPSILON = 1e-8
const POSITION_EPSILON_A = 1e-6

export type SemanticPoseDirectionMode = 'centroid' | 'bisector'

export type SemanticPoseTarget =
  | { kind: 'atom'; atomId: string; relation?: 'toward' | 'away' }
  | { kind: 'point'; point: Vec3; relation?: 'toward' | 'away' }
  | { kind: 'vector'; vector: Vec3; relation?: 'along' | 'against' }
  | { kind: 'surface'; relation: 'toward' | 'away' }

export interface SemanticComponentPoseOptions {
  structure: ZatomStructure
  /** Every atom in the rigid finite molecule/component. */
  componentAtomIds: readonly string[]
  /** Rotation pivot. It stays fixed unless translationA is non-zero. */
  anchorAtomId: string
  /** One atom gives an axis; several give their centroid or angular bisector. */
  directionAtomIds: readonly string[]
  directionMode?: SemanticPoseDirectionMode
  target: SemanticPoseTarget
  /** Set false for translation/roll without changing the current tilt. */
  alignDirection?: boolean
  /** Rotation around the resolved target axis after alignment. */
  rollDeg?: number
  /** Signed translation along the resolved target direction, in Angstrom. */
  translationA?: number
}

export interface SemanticComponentPoseResult extends ApplyStructureOperationsResult {
  semanticPose: {
    componentAtomIds: string[]
    anchorAtomId: string
    directionAtomIds: string[]
    directionMode: SemanticPoseDirectionMode
    target: SemanticPoseTarget
    sourceDirection: Vec3
    targetDirection: Vec3
    alignDirection: boolean
    rollDeg: number
    translationA: number
    operations: StructureOperation[]
  }
}

export class SemanticPoseInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SemanticPoseInputError'
    this.code = code
  }
}

function finiteNumber(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved)) {
    throw new SemanticPoseInputError('invalid_semantic_pose_number', `${field} must be finite`)
  }
  return resolved
}

function finiteVec3(value: readonly number[], field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new SemanticPoseInputError('invalid_semantic_pose_vector', `${field} must contain three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

function unit(vector: readonly number[], field: string): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2])
  if (length < VECTOR_EPSILON) {
    throw new SemanticPoseInputError('degenerate_semantic_pose_direction', `${field} has no resolvable direction`)
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function negate(vector: Vec3): Vec3 {
  return [-vector[0], -vector[1], -vector[2]]
}

function deltaBetween(structure: ZatomStructure, from: Vec3, to: Vec3): Vec3 {
  const raw: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  return structure.lattice
    ? createCertifiedMinimumImageCalculator(structure.lattice)(raw).vector
    : raw
}

function stablePerpendicular(direction: Vec3): Vec3 {
  const basis: Vec3 = Math.abs(direction[0]) <= Math.abs(direction[1]) && Math.abs(direction[0]) <= Math.abs(direction[2])
    ? [1, 0, 0]
    : Math.abs(direction[1]) <= Math.abs(direction[2])
      ? [0, 1, 0]
      : [0, 0, 1]
  return unit([
    direction[1] * basis[2] - direction[2] * basis[1],
    direction[2] * basis[0] - direction[0] * basis[2],
    direction[0] * basis[1] - direction[1] * basis[0],
  ], 'antiparallel rotation axis')
}

function assertUniqueIds(ids: readonly string[], field: string): string[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new SemanticPoseInputError('missing_semantic_pose_atoms', `${field} must contain at least one atom ID`)
  }
  const normalized = ids.map((id) => typeof id === 'string' ? id.trim() : '')
  if (normalized.some((id) => !id)) {
    throw new SemanticPoseInputError('invalid_semantic_pose_atom_id', `${field} must contain non-empty atom IDs`)
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new SemanticPoseInputError('duplicate_semantic_pose_atom_id', `${field} must not contain duplicate atom IDs`)
  }
  return normalized
}

function resolveSourceDirection(
  anchorPosition: Vec3,
  directionPositions: readonly Vec3[],
  mode: SemanticPoseDirectionMode,
): Vec3 {
  const vectors = directionPositions.map((position): Vec3 => [
    position[0] - anchorPosition[0],
    position[1] - anchorPosition[1],
    position[2] - anchorPosition[2],
  ])
  const sum: Vec3 = [0, 0, 0]
  for (const vector of vectors) {
    const contribution = mode === 'bisector' ? unit(vector, 'anchor-to-direction-atom vector') : vector
    sum[0] += contribution[0]
    sum[1] += contribution[1]
    sum[2] += contribution[2]
  }
  return unit(sum, mode === 'bisector' ? 'direction-atom bisector' : 'anchor-to-direction-atoms centroid')
}

function resolveTargetDirection(
  structure: ZatomStructure,
  anchorPosition: Vec3,
  target: SemanticPoseTarget,
  atomById: ReadonlyMap<string, ZatomStructure['atoms'][number]>,
  componentIds: ReadonlySet<string>,
): Vec3 {
  if (target.kind === 'surface') {
    const normal = resolveSurfaceNormal(structure)?.normal
    if (!normal) {
      throw new SemanticPoseInputError(
        'no_surface_normal',
        'A toward/away-from-surface pose needs a slab with one aperiodic axis or a detectable vacuum gap',
      )
    }
    return target.relation === 'away' ? normal : negate(normal)
  }
  if (target.kind === 'vector') {
    const vector = unit(finiteVec3(target.vector, 'target.vector'), 'target.vector')
    return target.relation === 'against' ? negate(vector) : vector
  }

  let raw: Vec3
  if (target.kind === 'atom') {
    const targetAtomId = typeof target.atomId === 'string' ? target.atomId.trim() : ''
    const targetAtom = atomById.get(targetAtomId)
    if (!targetAtom) {
      throw new SemanticPoseInputError('unknown_semantic_pose_atom', `Target atom "${targetAtomId}" was not found`)
    }
    if (componentIds.has(targetAtomId)) {
      throw new SemanticPoseInputError(
        'target_atom_inside_component',
        'An atom target must be outside componentAtomIds; use it as a direction atom or pass an explicit vector instead',
      )
    }
    raw = deltaBetween(structure, anchorPosition, targetAtom.position)
  } else {
    const point = finiteVec3(target.point, 'target.point')
    raw = [
      point[0] - anchorPosition[0],
      point[1] - anchorPosition[1],
      point[2] - anchorPosition[2],
    ]
  }
  const toward = unit(raw, `direction ${target.kind === 'atom' ? 'to target atom' : 'to target point'}`)
  return target.relation === 'away' ? negate(toward) : toward
}

function unwrapFiniteComponent(
  structure: ZatomStructure,
  anchorAtomId: string,
  componentAtomIds: readonly string[],
  atomById: ReadonlyMap<string, ZatomStructure['atoms'][number]>,
): { positions: Map<string, Vec3>; changed: Array<{ atomId: string; position: Vec3 }> } {
  const positions = new Map<string, Vec3>()
  const anchorPosition = atomById.get(anchorAtomId)!.position
  positions.set(anchorAtomId, [...anchorPosition] as Vec3)
  if (!structure.lattice || !structure.lattice.periodic.some(Boolean)) {
    for (const atomId of componentAtomIds) {
      positions.set(atomId, [...atomById.get(atomId)!.position] as Vec3)
    }
    return { positions, changed: [] }
  }

  const minimumImage = createCertifiedMinimumImageCalculator(structure.lattice)
  const componentSet = new Set(componentAtomIds)
  const neighbors = new Map<string, string[]>()
  for (const atomId of componentAtomIds) neighbors.set(atomId, [])
  for (const bond of structure.bonds ?? []) {
    const [left, right] = bond.atomIds
    if (!componentSet.has(left) || !componentSet.has(right)) continue
    neighbors.get(left)!.push(right)
    neighbors.get(right)!.push(left)
  }

  const queue = [anchorAtomId]
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const atomId = queue[cursor]
    const unwrappedPosition = positions.get(atomId)!
    const originalPosition = atomById.get(atomId)!.position
    for (const neighborId of neighbors.get(atomId) ?? []) {
      const neighborOriginal = atomById.get(neighborId)!.position
      const edge = minimumImage([
        neighborOriginal[0] - originalPosition[0],
        neighborOriginal[1] - originalPosition[1],
        neighborOriginal[2] - originalPosition[2],
      ]).vector
      const candidate: Vec3 = [
        unwrappedPosition[0] + edge[0],
        unwrappedPosition[1] + edge[1],
        unwrappedPosition[2] + edge[2],
      ]
      const existing = positions.get(neighborId)
      if (existing) {
        if (distance(existing, candidate) > POSITION_EPSILON_A) {
          throw new SemanticPoseInputError(
            'component_is_periodic_network',
            `Selected atoms contain a periodic winding cycle through bond ${bondLabel(atomId, neighborId)}; they are not one finite component that can be rigidly posed`,
          )
        }
        continue
      }
      positions.set(neighborId, candidate)
      queue.push(neighborId)
    }
  }

  // Explicit bonds are optional in Zatom structures. Reimage any disconnected
  // selected atoms directly around the anchor; compact unbonded clusters and
  // imported molecules then still behave correctly.
  for (const atomId of componentAtomIds) {
    if (positions.has(atomId)) continue
    const original = atomById.get(atomId)!.position
    const edge = minimumImage([
      original[0] - anchorPosition[0],
      original[1] - anchorPosition[1],
      original[2] - anchorPosition[2],
    ]).vector
    positions.set(atomId, [
      anchorPosition[0] + edge[0],
      anchorPosition[1] + edge[1],
      anchorPosition[2] + edge[2],
    ])
  }

  const changed = componentAtomIds.flatMap((atomId) => {
    const position = positions.get(atomId)!
    return distance(position, atomById.get(atomId)!.position) > POSITION_EPSILON_A
      ? [{ atomId, position: [...position] as Vec3 }]
      : []
  })
  return { positions, changed }
}

function bondLabel(left: string, right: string): string {
  return `${left}–${right}`
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

/**
 * Plan and execute one semantic finite-component pose through the shared DSL.
 * The returned structure is still a candidate; workspace policy is handled by
 * finalizeStructureCandidate in the tool adapter.
 */
export function poseStructureComponentSemantically(
  options: SemanticComponentPoseOptions,
): SemanticComponentPoseResult {
  const componentAtomIds = assertUniqueIds(options.componentAtomIds, 'componentAtomIds')
  const directionAtomIds = assertUniqueIds(options.directionAtomIds, 'directionAtomIds')
  const componentSet = new Set(componentAtomIds)
  const anchorAtomId = typeof options.anchorAtomId === 'string' ? options.anchorAtomId.trim() : ''
  if (!anchorAtomId || !componentSet.has(anchorAtomId)) {
    throw new SemanticPoseInputError('anchor_outside_component', 'anchorAtomId must name an atom in componentAtomIds')
  }
  if (directionAtomIds.some((atomId) => !componentSet.has(atomId))) {
    throw new SemanticPoseInputError('direction_atom_outside_component', 'Every directionAtomId must belong to componentAtomIds')
  }
  if (directionAtomIds.includes(anchorAtomId)) {
    throw new SemanticPoseInputError('anchor_used_as_direction_atom', 'directionAtomIds must not contain anchorAtomId')
  }

  const atomById = new Map(options.structure.atoms.map((atom) => [atom.id, atom] as const))
  const missing = componentAtomIds.filter((atomId) => !atomById.has(atomId))
  if (missing.length) {
    throw new SemanticPoseInputError('unknown_semantic_pose_atom', `Component atom(s) not found: ${missing.join(', ')}`)
  }
  const anchor = atomById.get(anchorAtomId)!
  const unwrapped = unwrapFiniteComponent(options.structure, anchorAtomId, componentAtomIds, atomById)

  const directionMode = options.directionMode ?? 'centroid'
  if (directionMode !== 'centroid' && directionMode !== 'bisector') {
    throw new SemanticPoseInputError('invalid_semantic_pose_direction_mode', 'directionMode must be centroid or bisector')
  }
  const sourceDirection = resolveSourceDirection(
    anchor.position,
    directionAtomIds.map((atomId) => unwrapped.positions.get(atomId)!),
    directionMode,
  )
  const targetDirection = resolveTargetDirection(
    options.structure,
    anchor.position,
    options.target,
    atomById,
    componentSet,
  )
  const alignDirection = options.alignDirection !== false
  const rollDeg = finiteNumber(options.rollDeg, 0, 'rollDeg')
  const translationA = finiteNumber(options.translationA, 0, 'translationA')
  if (Math.abs(rollDeg) > 36_000) {
    throw new SemanticPoseInputError('invalid_semantic_pose_number', 'rollDeg must be within ±36000°')
  }
  if (Math.abs(translationA) > 1_000) {
    throw new SemanticPoseInputError('invalid_semantic_pose_number', 'translationA must be within ±1000 Å')
  }
  if (!alignDirection && Math.abs(rollDeg) <= 1e-12 && Math.abs(translationA) <= 1e-12) {
    throw new SemanticPoseInputError(
      'empty_semantic_pose',
      'No pose change was requested: enable alignment, set rollDeg, or set translationA',
    )
  }

  const selection = { atomIds: componentAtomIds }
  const operations: StructureOperation[] = []
  if (unwrapped.changed.length) {
    operations.push({ op: 'set_positions', positions: unwrapped.changed })
  }
  if (alignDirection) {
    operations.push({
      op: 'align',
      selection,
      fromVector: sourceDirection,
      toVector: targetDirection,
      origin: [...anchor.position] as Vec3,
      antiparallelAxis: stablePerpendicular(sourceDirection),
      rotateLattice: false,
    })
  }
  if (Math.abs(rollDeg) > 1e-12) {
    operations.push({
      op: 'rotate_about_axis_through',
      selection,
      axis: targetDirection,
      angleDeg: rollDeg,
      pivot: { atomId: anchorAtomId },
    })
  }
  if (Math.abs(translationA) > 1e-12) {
    operations.push({
      op: 'translate',
      selection,
      vector: [
        targetDirection[0] * translationA,
        targetDirection[1] * translationA,
        targetDirection[2] * translationA,
      ],
    })
  }
  const applied = applyStructureOperations({ structure: options.structure, operations })
  const resultById = new Map(applied.structure.atoms.map((atom) => [atom.id, atom] as const))
  const finalAnchor = resultById.get(anchorAtomId)!
  const expectedAnchor: Vec3 = [
    anchor.position[0] + targetDirection[0] * translationA,
    anchor.position[1] + targetDirection[1] * translationA,
    anchor.position[2] + targetDirection[2] * translationA,
  ]
  const semanticChecks: ValidationCheck[] = [{
    id: 'semantic_pose.component_scope',
    status: 'pass',
    message: `Resolved an explicit ${componentAtomIds.length}-atom component with anchor ${anchorAtomId}`,
    metrics: { componentAtomCount: componentAtomIds.length, directionAtomCount: directionAtomIds.length },
    atomIds: componentAtomIds.slice(0, 80),
  }, {
    id: 'semantic_pose.periodic_reimaging',
    status: 'pass',
    message: unwrapped.changed.length
      ? `Reimaged ${unwrapped.changed.length} component atom(s) into one continuous periodic copy before the rigid pose`
      : 'The component was already stored as one continuous Cartesian copy',
    metrics: { reimagedAtomCount: unwrapped.changed.length },
    atomIds: unwrapped.changed.map((entry) => entry.atomId).slice(0, 80),
  }, {
    id: 'semantic_pose.anchor_motion',
    status: distance(finalAnchor.position, expectedAnchor) <= POSITION_EPSILON_A ? 'pass' : 'fail',
    message: Math.abs(translationA) <= 1e-12
      ? `Anchor ${anchorAtomId} stayed fixed during orientation and roll`
      : `Anchor ${anchorAtomId} moved ${Math.abs(translationA).toFixed(4)} Å along the resolved semantic direction`,
    metrics: {
      expectedTranslationA: translationA,
      anchorPositionErrorA: distance(finalAnchor.position, expectedAnchor),
    },
    atomIds: [anchorAtomId],
  }]
  if (alignDirection) {
    const finalDirection = resolveSourceDirection(
      finalAnchor.position,
      directionAtomIds.map((atomId) => resultById.get(atomId)!.position),
      directionMode,
    )
    const cosine = Math.max(-1, Math.min(1, dot(finalDirection, targetDirection)))
    const errorDeg = Math.acos(cosine) * 180 / Math.PI
    semanticChecks.push({
      id: 'semantic_pose.direction_alignment',
      status: errorDeg <= 1e-5 ? 'pass' : 'fail',
      message: `Aligned the ${directionMode} direction to the semantic target with ${errorDeg.toExponential(2)}° angular error`,
      metrics: { angularErrorDeg: errorDeg },
      atomIds: [anchorAtomId, ...directionAtomIds].slice(0, 80),
    })
  } else {
    semanticChecks.push({
      id: 'semantic_pose.direction_alignment',
      status: 'skipped',
      message: 'Kept the current tilt because alignDirection=false',
    })
  }

  return {
    ...applied,
    checks: [...semanticChecks, ...applied.checks],
    semanticPose: {
      componentAtomIds,
      anchorAtomId,
      directionAtomIds,
      directionMode,
      target: options.target,
      sourceDirection,
      targetDirection,
      alignDirection,
      rollDeg,
      translationA,
      operations,
    },
  }
}
