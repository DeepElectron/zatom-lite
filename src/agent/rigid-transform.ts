/** Proper rigid rotations and direction alignment for the structure operation DSL. */

import type { Mat3, ValidationCheck, Vec3, ZatomStructure } from './contracts'
import {
  applyMatrix3,
  determinant3,
  distance,
  rotationBetweenVectors,
  rotationMatrixAroundAxis,
} from './structure-math'

export type RigidTransformOperation =
  | { op: 'rotate'; axis: Vec3; angleDeg: number; origin?: Vec3; rotateLattice?: boolean }
  | { op: 'align'; fromVector: Vec3; toVector: Vec3; origin?: Vec3; antiparallelAxis?: Vec3; rotateLattice?: boolean }

export interface ApplyRigidTransformOptions {
  structure: ZatomStructure
  selectedAtomIndices: readonly number[]
  selectionAll: boolean
  operation: RigidTransformOperation
  operationIndex: number
}

export interface ApplyRigidTransformResult {
  structure: ZatomStructure
  changedAtomCount: number
  boundaryAtomIds: string[]
  checks: ValidationCheck[]
}

export class RigidTransformInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RigidTransformInputError'
    this.code = code
  }
}

function centroidOfSelection(structure: ZatomStructure, indices: readonly number[]): Vec3 {
  const center: Vec3 = [0, 0, 0]
  for (const index of indices) {
    const position = structure.atoms[index].position
    center[0] += position[0] / indices.length
    center[1] += position[1] / indices.length
    center[2] += position[2] / indices.length
  }
  return center
}

function transpose3(matrix: Mat3): Mat3 {
  return [
    [matrix[0][0], matrix[1][0], matrix[2][0]],
    [matrix[0][1], matrix[1][1], matrix[2][1]],
    [matrix[0][2], matrix[1][2], matrix[2][2]],
  ]
}

function maximumRotationOrthonormalityError(matrix: Mat3): number {
  let maximum = 0
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let value = 0
      for (let inner = 0; inner < 3; inner++) value += matrix[inner][row] * matrix[inner][column]
      maximum = Math.max(maximum, Math.abs(value - (row === column ? 1 : 0)))
    }
  }
  return maximum
}

function angleBetweenDeg(left: readonly number[], right: readonly number[]): number {
  const dot = left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  const leftLength = Math.hypot(left[0], left[1], left[2])
  const rightLength = Math.hypot(right[0], right[1], right[2])
  const cosine = Math.max(-1, Math.min(1, dot / (leftLength * rightLength)))
  return Math.acos(cosine) * 180 / Math.PI
}

function resolveRotation(operation: RigidTransformOperation): {
  matrix: Mat3
  axis: Vec3 | null
  angleRad: number
} {
  if (operation.op === 'rotate') {
    const angleRad = operation.angleDeg * Math.PI / 180
    return {
      matrix: rotationMatrixAroundAxis(operation.axis, angleRad),
      axis: operation.axis,
      angleRad,
    }
  }
  try {
    const alignment = rotationBetweenVectors(
      operation.fromVector,
      operation.toVector,
      operation.antiparallelAxis,
    )
    if (Math.abs(alignment.angleRad - Math.PI) < 1e-12 && !operation.antiparallelAxis) {
      throw new RigidTransformInputError(
        'ambiguous_antiparallel_alignment',
        'Exactly antiparallel vectors require antiparallelAxis to choose the 180° rotation plane',
      )
    }
    return alignment
  } catch (error) {
    if (error instanceof RigidTransformInputError) throw error
    throw new RigidTransformInputError(
      'invalid_alignment',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export function applyRigidTransform(options: ApplyRigidTransformOptions): ApplyRigidTransformResult {
  const { structure, selectedAtomIndices, selectionAll, operation, operationIndex } = options
  if (!selectedAtomIndices.length) {
    throw new RigidTransformInputError('empty_rigid_selection', 'Rigid transformation requires at least one selected atom')
  }
  const rotateLattice = operation.rotateLattice ?? (selectionAll && structure.lattice !== undefined)
  if (rotateLattice && !selectionAll) {
    throw new RigidTransformInputError('partial_lattice_rotation', 'rotateLattice=true requires selection.all=true')
  }
  if (rotateLattice && !structure.lattice) {
    throw new RigidTransformInputError('lattice_required', 'rotateLattice=true requires a lattice')
  }
  const resolved = resolveRotation(operation)
  const origin = operation.origin ?? centroidOfSelection(structure, selectedAtomIndices)
  const inverseRotation = transpose3(resolved.matrix)
  const selectedIndices = new Set(selectedAtomIndices)
  const selectedIds = new Set(selectedAtomIndices.map((atomIndex) => structure.atoms[atomIndex].id))
  const beforePositionById = new Map(selectedAtomIndices.map((atomIndex) => {
    const atom = structure.atoms[atomIndex]
    return [atom.id, atom.position] as const
  }))
  let changedAtomCount = 0
  let maximumRadiusA = 0
  let maximumRoundTripErrorA = 0
  let maximumRadialErrorA = 0
  const rotatedAtoms = structure.atoms.map((atom, atomIndex) => {
    if (!selectedIndices.has(atomIndex)) return atom
    const relative: Vec3 = [
      atom.position[0] - origin[0],
      atom.position[1] - origin[1],
      atom.position[2] - origin[2],
    ]
    const rotatedRelative = applyMatrix3(resolved.matrix, relative)
    const next: Vec3 = [
      origin[0] + rotatedRelative[0],
      origin[1] + rotatedRelative[1],
      origin[2] + rotatedRelative[2],
    ]
    const recoveredRelative = applyMatrix3(inverseRotation, rotatedRelative)
    maximumRoundTripErrorA = Math.max(maximumRoundTripErrorA, Math.hypot(
      recoveredRelative[0] - relative[0],
      recoveredRelative[1] - relative[1],
      recoveredRelative[2] - relative[2],
    ))
    const beforeRadius = Math.hypot(relative[0], relative[1], relative[2])
    const afterRadius = Math.hypot(rotatedRelative[0], rotatedRelative[1], rotatedRelative[2])
    maximumRadiusA = Math.max(maximumRadiusA, beforeRadius)
    maximumRadialErrorA = Math.max(maximumRadialErrorA, Math.abs(afterRadius - beforeRadius))
    if (distance(atom.position, next) > 1e-10) changedAtomCount++
    return { ...atom, position: next }
  })
  const originalLattice = structure.lattice
  const result: ZatomStructure = {
    ...structure,
    atoms: rotatedAtoms,
    ...(rotateLattice && originalLattice ? {
      lattice: {
        ...originalLattice,
        vectors: originalLattice.vectors.map((vector) => applyMatrix3(resolved.matrix, vector)) as Mat3,
      },
    } : {}),
  }
  const afterPositionById = new Map(result.atoms.map((atom) => [atom.id, atom.position]))
  let internalBondCount = 0
  let boundaryBondCount = 0
  let maximumInternalBondLengthErrorA = 0
  const boundaryAtomIds = new Set<string>()
  for (const bond of result.bonds ?? []) {
    const firstSelected = selectedIds.has(bond.atomIds[0])
    const secondSelected = selectedIds.has(bond.atomIds[1])
    if (firstSelected !== secondSelected) {
      boundaryBondCount++
      if (changedAtomCount) {
        boundaryAtomIds.add(bond.atomIds[0])
        boundaryAtomIds.add(bond.atomIds[1])
      }
    } else if (firstSelected && secondSelected) {
      internalBondCount++
      maximumInternalBondLengthErrorA = Math.max(
        maximumInternalBondLengthErrorA,
        Math.abs(
          distance(afterPositionById.get(bond.atomIds[0])!, afterPositionById.get(bond.atomIds[1])!)
          - distance(beforePositionById.get(bond.atomIds[0])!, beforePositionById.get(bond.atomIds[1])!),
        ),
      )
    }
  }
  const determinant = determinant3(resolved.matrix)
  const maximumOrthonormalityError = maximumRotationOrthonormalityError(resolved.matrix)
  const maximumRigidErrorA = Math.max(
    1e-10,
    Math.max(1, maximumRadiusA) * Number.EPSILON * 128,
  )
  const rigidInvariantPassed = Math.abs(determinant - 1) <= 1e-12
    && maximumOrthonormalityError <= 1e-12
    && maximumRoundTripErrorA <= maximumRigidErrorA
    && maximumRadialErrorA <= maximumRigidErrorA
    && maximumInternalBondLengthErrorA <= maximumRigidErrorA
  const axis = resolved.axis ?? [0, 0, 0]
  const checks: ValidationCheck[] = [{
    id: `operation.${operationIndex}.rigid_rotation`,
    status: rigidInvariantPassed ? 'pass' : 'fail',
    message: rigidInvariantPassed
      ? `${operation.op} resolved a proper rigid rotation of ${(resolved.angleRad * 180 / Math.PI).toFixed(8)}° with inverse/radial/topology error ≤ ${maximumRigidErrorA.toExponential(3)} Å`
      : `${operation.op} failed a rigid-rotation numeric invariant`,
    metrics: {
      angleDeg: resolved.angleRad * 180 / Math.PI,
      axisX: axis[0], axisY: axis[1], axisZ: axis[2],
      originX: origin[0], originY: origin[1], originZ: origin[2],
      determinant,
      maximumOrthonormalityError,
      maximumRoundTripErrorA,
      maximumRadialErrorA,
      maximumInternalBondLengthErrorA,
      maximumRigidErrorA,
      rotateLattice,
    },
  }]
  if (operation.op === 'align') {
    const alignedVector = applyMatrix3(resolved.matrix, operation.fromVector)
    const alignmentErrorDeg = angleBetweenDeg(alignedVector, operation.toVector)
    checks.push({
      id: `operation.${operationIndex}.direction_alignment`,
      status: alignmentErrorDeg <= 1e-6 ? 'pass' : 'fail',
      message: `Rotated source direction onto target with ${alignmentErrorDeg.toExponential(3)}° angular error`,
      metrics: { alignmentErrorDeg, maximumAlignmentErrorDeg: 1e-6 },
    })
  }
  checks.push({
    id: `operation.${operationIndex}.rotation_boundary_bonds`,
    status: !result.bonds?.length ? 'skipped' : boundaryBondCount && changedAtomCount ? 'warn' : 'pass',
    message: !result.bonds?.length
      ? 'No explicit topology was supplied for rotation-boundary auditing'
      : boundaryBondCount && changedAtomCount
        ? `${boundaryBondCount} explicit bonds cross the rotated/fixed selection boundary; inspect their final geometry`
        : `No moved rotation boundary cuts an explicit bond; ${internalBondCount} selected internal bonds preserve length`,
    metrics: { internalBondCount, boundaryBondCount },
    ...(boundaryBondCount ? { atomIds: [...boundaryAtomIds].slice(0, 80) } : {}),
  })
  const periodic = originalLattice?.periodic.some(Boolean) === true
  checks.push({
    id: `operation.${operationIndex}.rotation_cell_scope`,
    status: rotateLattice ? 'pass' : periodic && changedAtomCount ? 'warn' : 'skipped',
    message: rotateLattice
      ? 'Rotated the complete atom set and lattice together as one Cartesian frame change'
      : periodic && changedAtomCount
        ? 'Rotated atoms relative to a fixed periodic lattice; contact validation does not prove commensurate periodic seams'
        : 'No periodic cell rotation scope applies',
    metrics: { rotateLattice, periodic },
  })
  return { structure: result, changedAtomCount, boundaryAtomIds: [...boundaryAtomIds], checks }
}
