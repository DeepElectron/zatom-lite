/** General 2D HNF/off-diagonal coincidence matching and interface construction. */

import type {
  InspectionTarget,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomStructureAtom,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import {
  boundsOfPositions,
  cartesianToFractional,
  createDistanceCalculator,
  fractionalToCartesian,
} from './structure-math'
import { validateStructure } from './structure-validation'

export type IntMat2 = [[number, number], [number, number]]
export type Mat2 = [[number, number], [number, number]]

export interface General2DMatchCandidate {
  id: string
  bottomMatrix: IntMat2
  topMatrix: IntMat2
  bottomAreaMultiple: number
  topAreaMultiple: number
  bottomAtomCount: number
  topAtomCount: number
  totalAtomCount: number
  bottomVectorsA: [Vec3, Vec3]
  topVectorsA: [Vec3, Vec3]
  targetVectors2D: Mat2
  bottomPrincipalStrains: [number, number]
  topPrincipalStrains: [number, number]
  bottomGreenLagrange: Mat2
  topGreenLagrange: Mat2
  bottomAreaStrain: number
  topAreaStrain: number
  maxAbsPrincipalStrain: number
  alignmentRotationDeg: number
  rotationErrorDeg: number | null
  bottomAspectRatio: number
  topAspectRatio: number
  geometricScore: number
  rankScore: number
  withinTolerance: boolean
}

export interface FindGeneral2DMatchesOptions {
  bottom: ZatomStructure
  top: ZatomStructure
  maxAreaMultiple?: number
  maxOutputAtoms?: number
  maxPrincipalStrain?: number
  strainShareTop?: number
  targetRotationDeg?: number
  maxRotationErrorDeg?: number
  maxAspectRatio?: number
  maxCandidatePairs?: number
  limit?: number
}

export interface FindGeneral2DMatchesResult {
  candidates: General2DMatchCandidate[]
  recommended: General2DMatchCandidate
  bottomCellCount: number
  topCellCount: number
  totalCandidateCount: number
  acceptedCandidateCount: number
  paretoCandidateCount: number
  truncated: boolean
  checks: ValidationCheck[]
}

export interface BuildGeneral2DInterfaceOptions extends FindGeneral2DMatchesOptions {
  bottomMatrix?: IntMat2
  topMatrix?: IntMat2
  gapA?: number
  vacuumA?: number
  registryOffsetFractional?: [number, number]
  collisionDistanceA?: number
  maxCrossPairs?: number
}

export interface BuildGeneral2DInterfaceResult {
  structure: ZatomStructure
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  match: General2DMatchCandidate
  search: FindGeneral2DMatchesResult | null
  metrics: {
    requestedGapA: number
    measuredGapA: number
    requestedVacuumA: number
    measuredVacuumA: number
    bottomThicknessA: number
    topThicknessA: number
    minimumCrossInterfaceDistanceA: number | null
    crossPairScanSkipped: boolean
    bottomBondCount: number | null
    topBondCount: number | null
  }
}

export class GeneralInterfaceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeneralInterfaceInputError'
    this.code = code
  }
}

interface ReducedCell {
  matrix: IntMat2
  multiple: number
  vectors: [Vec3, Vec3]
  local: Mat2
  orientationDeg: number
  aspectRatio: number
}

interface StrainMetrics {
  principal: [number, number]
  green: Mat2
  areaStrain: number
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function unit(value: readonly number[], name: string): Vec3 {
  const length = norm(value)
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new GeneralInterfaceInputError('degenerate_inplane_cell', `${name} must be non-degenerate`)
  }
  return [value[0] / length, value[1] / length, value[2] / length]
}

function combine2(a: Vec3, x: number, b: Vec3, y: number): Vec3 {
  return [a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y]
}

function combine3(a: Vec3, x: number, b: Vec3, y: number, c: Vec3, z: number): Vec3 {
  return [
    a[0] * x + b[0] * y + c[0] * z,
    a[1] * x + b[1] * y + c[1] * z,
    a[2] * x + b[2] * y + c[2] * z,
  ]
}

function determinant2(matrix: Mat2 | IntMat2): number {
  return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
}

function inverse2(matrix: Mat2 | IntMat2): Mat2 {
  const determinant = determinant2(matrix)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) {
    throw new GeneralInterfaceInputError('singular_inplane_matrix', '2D matrix is singular')
  }
  return [
    [matrix[1][1] / determinant, -matrix[0][1] / determinant],
    [-matrix[1][0] / determinant, matrix[0][0] / determinant],
  ]
}

function multiply2(left: Mat2, right: Mat2): Mat2 {
  return [
    [left[0][0] * right[0][0] + left[0][1] * right[1][0], left[0][0] * right[0][1] + left[0][1] * right[1][1]],
    [left[1][0] * right[0][0] + left[1][1] * right[1][0], left[1][0] * right[0][1] + left[1][1] * right[1][1]],
  ]
}

function rowTimesMatrix(row: [number, number], matrix: Mat2): [number, number] {
  return [
    row[0] * matrix[0][0] + row[1] * matrix[1][0],
    row[0] * matrix[0][1] + row[1] * matrix[1][1],
  ]
}

function wrap01(value: number): number {
  const wrapped = value - Math.floor(value)
  return Math.abs(wrapped - 1) < 1e-10 || Math.abs(wrapped) < 1e-10 ? 0 : wrapped
}

function finiteNumber(value: number, name: string, minimum?: number): number {
  if (!Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new GeneralInterfaceInputError('invalid_parameter', `${name} is outside its finite allowed range`)
  }
  return value
}

function integer(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new GeneralInterfaceInputError('invalid_parameter', `${name} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function validateMatrix(value: IntMat2, name: string, maxAreaMultiple: number): IntMat2 {
  if (!Array.isArray(value) || value.length !== 2 || value.some((row) => (
    !Array.isArray(row) || row.length !== 2 || row.some((item) => !Number.isInteger(item) || Math.abs(item) > 512)
  ))) {
    throw new GeneralInterfaceInputError('invalid_supercell_matrix', `${name} must be a 2×2 integer matrix with coefficients in [-512,512]`)
  }
  const determinant = determinant2(value)
  if (determinant <= 0 || determinant > maxAreaMultiple) {
    throw new GeneralInterfaceInputError('invalid_supercell_matrix', `${name} determinant must be positive and no larger than maxAreaMultiple=${maxAreaMultiple}`)
  }
  return [[value[0][0], value[0][1]], [value[1][0], value[1][1]]]
}

function requireSlab(structure: ZatomStructure, name: string): NonNullable<ZatomStructure['lattice']> {
  const validation = validateStructure(structure, { requirePeriodic: true })
  const failures = validation.checks.filter((check) => check.status === 'fail')
  if (!structure.lattice || failures.length) {
    throw new GeneralInterfaceInputError('invalid_source_structure', `${name} must be a numerically valid periodic slab`)
  }
  if (!structure.lattice.periodic[0] || !structure.lattice.periodic[1]) {
    throw new GeneralInterfaceInputError('inplane_periodicity_required', `${name} must be periodic along lattice axes a and b`)
  }
  unit(cross(structure.lattice.vectors[0], structure.lattice.vectors[1]), `${name} a×b`)
  return structure.lattice
}

function matrixVectors(matrix: IntMat2, primitiveA: Vec3, primitiveB: Vec3): [Vec3, Vec3] {
  return [
    combine2(primitiveA, matrix[0][0], primitiveB, matrix[0][1]),
    combine2(primitiveA, matrix[1][0], primitiveB, matrix[1][1]),
  ]
}

function matrixLexicallyNegative(row: [number, number]): boolean {
  return row[0] < 0 || (row[0] === 0 && row[1] < 0)
}

/** Lagrange-Gauss reduction while retaining the exact integer transform. */
function reduceCellMatrix(input: IntMat2, primitiveA: Vec3, primitiveB: Vec3): IntMat2 {
  const rows: IntMat2 = [[...input[0]], [...input[1]]]
  for (let iteration = 0; iteration < 64; iteration++) {
    let [v0, v1] = matrixVectors(rows, primitiveA, primitiveB)
    if (dot(v1, v1) < dot(v0, v0) - 1e-12) {
      ;[rows[0], rows[1]] = [rows[1], rows[0]]
      ;[v0, v1] = [v1, v0]
    }
    const quotient = Math.round(dot(v0, v1) / dot(v0, v0))
    if (quotient === 0) break
    rows[1] = [rows[1][0] - quotient * rows[0][0], rows[1][1] - quotient * rows[0][1]]
  }
  if (determinant2(rows) < 0) rows[1] = [-rows[1][0], -rows[1][1]]
  if (matrixLexicallyNegative(rows[0])) {
    rows[0] = [-rows[0][0], -rows[0][1]]
    rows[1] = [-rows[1][0], -rows[1][1]]
  }
  return rows
}

function normalizeAngle180(value: number): number {
  let normalized = ((value + 90) % 180 + 180) % 180 - 90
  if (Math.abs(normalized + 90) < 1e-10) normalized = 90
  return normalized
}

function angularDistance180(a: number, b: number): number {
  return Math.abs(normalizeAngle180(a - b))
}

function signedAngleDeg(from: Vec3, to: Vec3, normal: Vec3): number {
  const fromUnit = unit(from, 'orientation reference')
  const toUnit = unit(to, 'orientation vector')
  return Math.atan2(dot(normal, cross(fromUnit, toUnit)), dot(fromUnit, toUnit)) * 180 / Math.PI
}

function localCell(vectors: [Vec3, Vec3], normal: Vec3): Mat2 {
  const e1 = unit(vectors[0], 'cell vector a')
  const e2 = unit(cross(normal, e1), 'cell transverse axis')
  const transverse = dot(vectors[1], e2)
  if (transverse <= 1e-12) throw new GeneralInterfaceInputError('left_handed_cell', 'Reduced 2D cell must preserve positive orientation')
  return [[norm(vectors[0]), dot(vectors[1], e1)], [0, transverse]]
}

function cellFromMatrix(structure: ZatomStructure, matrix: IntMat2, maxAreaMultiple: number): ReducedCell {
  const lattice = requireSlab(structure, 'structure')
  const valid = validateMatrix(matrix, 'supercell matrix', maxAreaMultiple)
  const vectors = matrixVectors(valid, lattice.vectors[0], lattice.vectors[1])
  const primitiveNormal = unit(cross(lattice.vectors[0], lattice.vectors[1]), 'primitive a×b')
  const area = norm(cross(vectors[0], vectors[1]))
  const maximumLength = Math.max(norm(vectors[0]), norm(vectors[1]))
  return {
    matrix: valid,
    multiple: determinant2(valid),
    vectors,
    local: localCell(vectors, primitiveNormal),
    orientationDeg: normalizeAngle180(signedAngleDeg(lattice.vectors[0], vectors[0], primitiveNormal)),
    aspectRatio: maximumLength * maximumLength / area,
  }
}

function multiplyInteger2(left: IntMat2, right: IntMat2): IntMat2 {
  return [
    [left[0][0] * right[0][0] + left[0][1] * right[1][0], left[0][0] * right[0][1] + left[0][1] * right[1][1]],
    [left[1][0] * right[0][0] + left[1][1] * right[1][0], left[1][0] * right[0][1] + left[1][1] * right[1][1]],
  ]
}

const SMALL_UNIMODULAR_BASIS_CHANGES: readonly IntMat2[] = (() => {
  const out: IntMat2[] = []
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    for (let c = -1; c <= 1; c++) for (let d = -1; d <= 1; d++) {
      const matrix: IntMat2 = [[a, b], [c, d]]
      if (determinant2(matrix) === 1) out.push(matrix)
    }
  }
  return out
})()

function enumerateReducedCells(
  structure: ZatomStructure,
  maxAreaMultiple: number,
  maxAspectRatio: number,
  includeBasisVariants: boolean,
): ReducedCell[] {
  const lattice = requireSlab(structure, 'structure')
  const byMatrix = new Map<string, ReducedCell>()
  for (let area = 1; area <= maxAreaMultiple; area++) {
    for (let first = 1; first <= area; first++) {
      if (area % first !== 0) continue
      const second = area / first
      for (let offDiagonal = 0; offDiagonal < second; offDiagonal++) {
        const reduced = reduceCellMatrix([[first, offDiagonal], [0, second]], lattice.vectors[0], lattice.vectors[1])
        const variants = includeBasisVariants
          ? SMALL_UNIMODULAR_BASIS_CHANGES.map((change) => multiplyInteger2(change, reduced))
          : [reduced]
        for (const variant of variants) {
          const cell = cellFromMatrix(structure, variant, maxAreaMultiple)
          if (cell.aspectRatio > maxAspectRatio + 1e-12) continue
          const key = cell.matrix.flat().join(',')
          if (!byMatrix.has(key)) byMatrix.set(key, cell)
        }
      }
    }
  }
  return [...byMatrix.values()]
}

function interpolateTarget(bottom: Mat2, top: Mat2, strainShareTop: number): Mat2 {
  const shareBottom = 1 - strainShareTop
  return [
    [strainShareTop * bottom[0][0] + shareBottom * top[0][0], strainShareTop * bottom[0][1] + shareBottom * top[0][1]],
    [strainShareTop * bottom[1][0] + shareBottom * top[1][0], strainShareTop * bottom[1][1] + shareBottom * top[1][1]],
  ]
}

function strainMetrics(source: Mat2, target: Mat2): StrainMetrics {
  const gradient = multiply2(target, inverse2(source))
  const c00 = gradient[0][0] ** 2 + gradient[1][0] ** 2
  const c01 = gradient[0][0] * gradient[0][1] + gradient[1][0] * gradient[1][1]
  const c11 = gradient[0][1] ** 2 + gradient[1][1] ** 2
  const trace = c00 + c11
  const discriminant = Math.sqrt(Math.max(0, (c00 - c11) ** 2 + 4 * c01 * c01))
  const eigenvalues: [number, number] = [(trace + discriminant) / 2, (trace - discriminant) / 2]
  const principal = eigenvalues.map((value) => Math.sqrt(Math.max(0, value)) - 1) as [number, number]
  return {
    principal,
    green: [[0.5 * (c00 - 1), 0.5 * c01], [0.5 * c01, 0.5 * (c11 - 1)]],
    areaStrain: determinant2(target) / determinant2(source) - 1,
  }
}

function candidateFromCells(options: {
  bottom: ZatomStructure
  top: ZatomStructure
  bottomCell: ReducedCell
  topCell: ReducedCell
  maxPrincipalStrain: number
  strainShareTop: number
  targetRotationDeg?: number
  maxRotationErrorDeg: number
  maxOutputAtoms: number
}): General2DMatchCandidate {
  const target = interpolateTarget(options.bottomCell.local, options.topCell.local, options.strainShareTop)
  const bottomStrain = strainMetrics(options.bottomCell.local, target)
  const topStrain = strainMetrics(options.topCell.local, target)
  const maxAbsPrincipalStrain = Math.max(
    ...bottomStrain.principal.map(Math.abs),
    ...topStrain.principal.map(Math.abs),
  )
  const alignmentRotationDeg = normalizeAngle180(options.bottomCell.orientationDeg - options.topCell.orientationDeg)
  const rotationErrorDeg = options.targetRotationDeg === undefined
    ? null
    : angularDistance180(alignmentRotationDeg, options.targetRotationDeg)
  const rotationPass = rotationErrorDeg === null || rotationErrorDeg <= options.maxRotationErrorDeg + 1e-12
  const bottomAtomCount = options.bottom.atoms.length * options.bottomCell.multiple
  const topAtomCount = options.top.atoms.length * options.topCell.multiple
  const totalAtomCount = bottomAtomCount + topAtomCount
  const geometricScore = maxAbsPrincipalStrain + (rotationErrorDeg ?? 0) * Math.PI / 180
  const matrixId = (matrix: IntMat2) => matrix.map((row) => row.join('_')).join('__').replaceAll('-', 'm')
  return {
    id: `b-${matrixId(options.bottomCell.matrix)}-t-${matrixId(options.topCell.matrix)}`,
    bottomMatrix: options.bottomCell.matrix,
    topMatrix: options.topCell.matrix,
    bottomAreaMultiple: options.bottomCell.multiple,
    topAreaMultiple: options.topCell.multiple,
    bottomAtomCount,
    topAtomCount,
    totalAtomCount,
    bottomVectorsA: options.bottomCell.vectors,
    topVectorsA: options.topCell.vectors,
    targetVectors2D: target,
    bottomPrincipalStrains: bottomStrain.principal,
    topPrincipalStrains: topStrain.principal,
    bottomGreenLagrange: bottomStrain.green,
    topGreenLagrange: topStrain.green,
    bottomAreaStrain: bottomStrain.areaStrain,
    topAreaStrain: topStrain.areaStrain,
    maxAbsPrincipalStrain,
    alignmentRotationDeg,
    rotationErrorDeg,
    bottomAspectRatio: options.bottomCell.aspectRatio,
    topAspectRatio: options.topCell.aspectRatio,
    geometricScore,
    rankScore: geometricScore + 0.002 * totalAtomCount / options.maxOutputAtoms,
    withinTolerance: maxAbsPrincipalStrain <= options.maxPrincipalStrain + 1e-12 && rotationPass,
  }
}

function normalizedSearchOptions(options: FindGeneral2DMatchesOptions) {
  return {
    maxAreaMultiple: integer(options.maxAreaMultiple ?? 12, 'maxAreaMultiple', 1, 32),
    maxOutputAtoms: integer(options.maxOutputAtoms ?? 20_000, 'maxOutputAtoms', 2, 100_000),
    maxPrincipalStrain: finiteNumber(options.maxPrincipalStrain ?? 0.05, 'maxPrincipalStrain', 0),
    strainShareTop: finiteNumber(options.strainShareTop ?? 1, 'strainShareTop', 0),
    targetRotationDeg: options.targetRotationDeg === undefined ? undefined : finiteNumber(options.targetRotationDeg, 'targetRotationDeg'),
    maxRotationErrorDeg: finiteNumber(options.maxRotationErrorDeg ?? 1, 'maxRotationErrorDeg', 0),
    maxAspectRatio: finiteNumber(options.maxAspectRatio ?? 6, 'maxAspectRatio', 1),
    maxCandidatePairs: integer(options.maxCandidatePairs ?? 1_000_000, 'maxCandidatePairs', 1, 10_000_000),
    limit: integer(options.limit ?? 20, 'limit', 1, 100),
  }
}

export function findGeneral2DInterfaceMatches(options: FindGeneral2DMatchesOptions): FindGeneral2DMatchesResult {
  requireSlab(options.bottom, 'bottom')
  requireSlab(options.top, 'top')
  const normalized = normalizedSearchOptions(options)
  if (normalized.strainShareTop > 1) throw new GeneralInterfaceInputError('invalid_parameter', 'strainShareTop must be from 0 through 1')
  const bottomCells = enumerateReducedCells(options.bottom, normalized.maxAreaMultiple, normalized.maxAspectRatio, false)
    .filter((cell) => options.bottom.atoms.length * cell.multiple < normalized.maxOutputAtoms)
  const topCells = enumerateReducedCells(
    options.top,
    normalized.maxAreaMultiple,
    normalized.maxAspectRatio,
    normalized.targetRotationDeg !== undefined,
  )
    .filter((cell) => options.top.atoms.length * cell.multiple < normalized.maxOutputAtoms)
  const candidatePairCount = bottomCells.length * topCells.length
  if (candidatePairCount > normalized.maxCandidatePairs) {
    throw new GeneralInterfaceInputError(
      'search_budget_exceeded',
      `HNF search would compare ${candidatePairCount.toLocaleString()} cell pairs (limit ${normalized.maxCandidatePairs.toLocaleString()}); lower maxAreaMultiple/maxAspectRatio or explicitly raise maxCandidatePairs`,
    )
  }
  const all: General2DMatchCandidate[] = []
  let acceptedCandidateCount = 0
  for (const bottomCell of bottomCells) for (const topCell of topCells) {
    const total = options.bottom.atoms.length * bottomCell.multiple + options.top.atoms.length * topCell.multiple
    if (total > normalized.maxOutputAtoms) continue
    const candidate = candidateFromCells({
      bottom: options.bottom,
      top: options.top,
      bottomCell,
      topCell,
      maxPrincipalStrain: normalized.maxPrincipalStrain,
      strainShareTop: normalized.strainShareTop,
      targetRotationDeg: normalized.targetRotationDeg,
      maxRotationErrorDeg: normalized.maxRotationErrorDeg,
      maxOutputAtoms: normalized.maxOutputAtoms,
    })
    if (candidate.withinTolerance) acceptedCandidateCount++
    all.push(candidate)
  }
  if (!all.length) throw new GeneralInterfaceInputError('no_match_candidates', 'No 2D integer-supercell pair fits the atom/area/aspect budgets')
  const bySize = [...all].sort((a, b) => a.totalAtomCount - b.totalAtomCount || a.geometricScore - b.geometricScore)
  const pareto: General2DMatchCandidate[] = []
  let bestGeometry = Infinity
  for (const candidate of bySize) {
    if (candidate.geometricScore < bestGeometry - 1e-12) {
      pareto.push(candidate)
      bestGeometry = candidate.geometricScore
    }
  }
  pareto.sort((a, b) => {
    if (a.withinTolerance !== b.withinTolerance) return a.withinTolerance ? -1 : 1
    return a.rankScore - b.rankScore || a.totalAtomCount - b.totalAtomCount
  })
  const candidates = pareto.slice(0, normalized.limit)
  const recommended = candidates[0]
  const checks: ValidationCheck[] = [
    {
      id: 'general_interface.match_found',
      status: acceptedCandidateCount ? 'pass' : 'fail',
      message: acceptedCandidateCount
        ? `Found ${acceptedCandidateCount.toLocaleString()} HNF/off-diagonal pairs within principal-strain${normalized.targetRotationDeg === undefined ? '' : '/rotation'} gates`
        : 'No HNF/off-diagonal pair satisfies the requested principal-strain/rotation gates',
      metrics: {
        acceptedCandidateCount,
        totalCandidateCount: all.length,
        maxPrincipalStrain: normalized.maxPrincipalStrain,
        targetRotationDeg: normalized.targetRotationDeg ?? null,
        maxRotationErrorDeg: normalized.maxRotationErrorDeg,
      },
    },
    {
      id: 'general_interface.match_recommendation',
      status: recommended.withinTolerance ? 'pass' : 'warn',
      message: `Recommended ${recommended.id}: max principal strain ${(100 * recommended.maxAbsPrincipalStrain).toFixed(4)}%, alignment ${recommended.alignmentRotationDeg.toFixed(4)}°, ${recommended.totalAtomCount} atoms`,
      metrics: {
        maxAbsPrincipalStrain: recommended.maxAbsPrincipalStrain,
        alignmentRotationDeg: recommended.alignmentRotationDeg,
        rotationErrorDeg: recommended.rotationErrorDeg,
        totalAtomCount: recommended.totalAtomCount,
      },
    },
    {
      id: 'general_interface.search_scope',
      status: 'warn',
      message: 'Search covers bounded 2D HNF sublattices with Gauss-reduced bases and homogeneous strain sharing; it does not optimize atomic registry, reconstruct, or relax either material',
    },
  ]
  return {
    candidates,
    recommended,
    bottomCellCount: bottomCells.length,
    topCellCount: topCells.length,
    totalCandidateCount: all.length,
    acceptedCandidateCount,
    paretoCandidateCount: pareto.length,
    truncated: candidates.length < pareto.length,
    checks,
  }
}

function cosetRepresentatives(matrix: IntMat2): Array<[number, number]> {
  const multiple = determinant2(matrix)
  const inverse = inverse2(matrix)
  const representatives: Array<[number, number]> = []
  const keys = new Set<string>()
  for (let i = 0; i < multiple && representatives.length < multiple; i++) {
    for (let j = 0; j < multiple && representatives.length < multiple; j++) {
      const coefficients = rowTimesMatrix([i, j], inverse)
      const key = `${wrap01(coefficients[0]).toFixed(10)},${wrap01(coefficients[1]).toFixed(10)}`
      if (keys.has(key)) continue
      keys.add(key)
      representatives.push([i, j])
    }
  }
  if (representatives.length !== multiple) {
    throw new GeneralInterfaceInputError('coset_enumeration_failed', `Resolved ${representatives.length}/${multiple} supercell cosets`)
  }
  return representatives
}

export function buildInteger2DSupercell(
  structure: ZatomStructure,
  matrix: IntMat2,
  maxOutputAtoms = 100_000,
): ZatomStructure {
  const lattice = requireSlab(structure, 'structure')
  const multiple = determinant2(matrix)
  if (multiple <= 0) throw new GeneralInterfaceInputError('invalid_supercell_matrix', 'Supercell matrix determinant must be positive')
  if (structure.atoms.length * multiple > maxOutputAtoms) {
    throw new GeneralInterfaceInputError('output_too_large', `2D supercell would contain ${structure.atoms.length * multiple} atoms (limit ${maxOutputAtoms})`)
  }
  const inverse = inverse2(matrix)
  const [newA, newB] = matrixVectors(matrix, lattice.vectors[0], lattice.vectors[1])
  const newLattice: Mat3 = [newA, newB, [...lattice.vectors[2]] as Vec3]
  const representatives = cosetRepresentatives(matrix)
  const atoms: ZatomStructureAtom[] = []
  for (let group = 0; group < representatives.length; group++) {
    const representative = representatives[group]
    for (const atom of structure.atoms) {
      const sourceFractional = cartesianToFractional(atom.position, lattice.vectors)
      if (!sourceFractional) throw new GeneralInterfaceInputError('singular_lattice', 'Could not invert source lattice')
      const inPlane = rowTimesMatrix([
        wrap01(sourceFractional[0]) + representative[0],
        wrap01(sourceFractional[1]) + representative[1],
      ], inverse)
      const fractional: Vec3 = [
        wrap01(inPlane[0]),
        wrap01(inPlane[1]),
        lattice.periodic[2] ? wrap01(sourceFractional[2]) : sourceFractional[2],
      ]
      atoms.push({
        ...atom,
        id: `${atom.id}@g${group}`,
        position: fractionalToCartesian(fractional, newLattice),
        properties: {
          ...(atom.properties ?? {}),
          'zatom.parentAtomId': atom.properties?.['zatom.parentAtomId'] ?? atom.id,
          'zatom.interface.cosetIndex': group,
          'zatom.interface.cosetRepresentative': representative,
        },
      })
    }
  }
  const bonds = structure.bonds?.flatMap((bond) => representatives.map((_, group) => ({
    ...bond,
    id: `${bond.id}@g${group}`,
    atomIds: [`${bond.atomIds[0]}@g${group}`, `${bond.atomIds[1]}@g${group}`] as [string, string],
    ...(bond.properties ? { properties: { ...bond.properties } } : {}),
  })))
  if (atoms.length !== structure.atoms.length * multiple) {
    throw new GeneralInterfaceInputError('supercell_count_mismatch', `Generated ${atoms.length}/${structure.atoms.length * multiple} matrix-supercell atoms`)
  }
  return {
    ...structure,
    label: `${structure.label ?? 'structure'} 2D matrix supercell`,
    atoms,
    ...(bonds ? { bonds } : {}),
    lattice: { vectors: newLattice, periodic: [...lattice.periodic] as [boolean, boolean, boolean] },
  }
}

function projectionRange(atoms: readonly ZatomStructureAtom[], normal: Vec3): { min: number; max: number; thickness: number } {
  const values = atoms.map((atom) => dot(atom.position, normal))
  const min = Math.min(...values)
  const max = Math.max(...values)
  return { min, max, thickness: max - min }
}

function targetVectorsFromLocal(bottomCell: ReducedCell, target: Mat2): { a: Vec3; b: Vec3; normal: Vec3 } {
  const normal = unit(cross(bottomCell.vectors[0], bottomCell.vectors[1]), 'bottom supercell normal')
  const e1 = unit(bottomCell.vectors[0], 'bottom supercell a')
  const e2 = unit(cross(normal, e1), 'bottom in-plane transverse')
  return {
    a: combine2(e1, target[0][0], e2, target[1][0]),
    b: combine2(e1, target[0][1], e2, target[1][1]),
    normal,
  }
}

function mapLayer(options: {
  atoms: readonly ZatomStructureAtom[]
  sourceA: Vec3
  sourceB: Vec3
  sourceNormal: Vec3
  targetA: Vec3
  targetB: Vec3
  targetNormal: Vec3
  startHeightA: number
  offset: [number, number]
  prefix: 'bottom' | 'top'
}): ZatomStructureAtom[] {
  const sourceBasis: Mat3 = [options.sourceA, options.sourceB, options.sourceNormal]
  const range = projectionRange(options.atoms, options.sourceNormal)
  return options.atoms.map((atom) => {
    const coefficients = cartesianToFractional(atom.position, sourceBasis)
    if (!coefficients) throw new GeneralInterfaceInputError('singular_inplane_basis', `Could not invert ${options.prefix} supercell basis`)
    const fa = wrap01(coefficients[0] + options.offset[0])
    const fb = wrap01(coefficients[1] + options.offset[1])
    const height = dot(atom.position, options.sourceNormal) - range.min
    return {
      ...atom,
      id: `${options.prefix}:${atom.id}`,
      position: combine3(options.targetA, fa, options.targetB, fb, options.targetNormal, options.startHeightA + height),
      properties: {
        ...(atom.properties ?? {}),
        'zatom.interfaceLayer': options.prefix,
        'zatom.sourceAtomId': atom.id,
      },
    }
  })
}

function prefixBonds(structure: ZatomStructure, prefix: 'bottom' | 'top') {
  return structure.bonds?.map((bond) => ({
    ...bond,
    id: `${prefix}:${bond.id}`,
    atomIds: [`${prefix}:${bond.atomIds[0]}`, `${prefix}:${bond.atomIds[1]}`] as [string, string],
    ...(bond.properties ? { properties: { ...bond.properties } } : {}),
  })) ?? []
}

function minimumCrossDistance(
  bottomAtoms: readonly ZatomStructureAtom[],
  topAtoms: readonly ZatomStructureAtom[],
  lattice: NonNullable<ZatomStructure['lattice']>,
  maxPairs: number,
): { distanceA: number | null; skipped: boolean } {
  if (bottomAtoms.length * topAtoms.length > maxPairs) return { distanceA: null, skipped: true }
  const distanceBetween = createDistanceCalculator({ ...lattice, periodic: [true, true, false] })
  let best = Infinity
  for (const bottom of bottomAtoms) for (const top of topAtoms) {
    best = Math.min(best, distanceBetween(bottom.position, top.position))
  }
  return { distanceA: Number.isFinite(best) ? best : null, skipped: false }
}

export function buildGeneral2DInterface(options: BuildGeneral2DInterfaceOptions): BuildGeneral2DInterfaceResult {
  requireSlab(options.bottom, 'bottom')
  requireSlab(options.top, 'top')
  const normalized = normalizedSearchOptions(options)
  if (normalized.strainShareTop > 1) throw new GeneralInterfaceInputError('invalid_parameter', 'strainShareTop must be from 0 through 1')
  if ((options.bottomMatrix === undefined) !== (options.topMatrix === undefined)) {
    throw new GeneralInterfaceInputError('ambiguous_match', 'Provide both bottomMatrix and topMatrix, or neither for automatic HNF matching')
  }
  let search: FindGeneral2DMatchesResult | null = null
  let match: General2DMatchCandidate
  let bottomCell: ReducedCell
  let topCell: ReducedCell
  if (options.bottomMatrix && options.topMatrix) {
    bottomCell = cellFromMatrix(options.bottom, validateMatrix(options.bottomMatrix, 'bottomMatrix', normalized.maxAreaMultiple), normalized.maxAreaMultiple)
    topCell = cellFromMatrix(options.top, validateMatrix(options.topMatrix, 'topMatrix', normalized.maxAreaMultiple), normalized.maxAreaMultiple)
    match = candidateFromCells({
      bottom: options.bottom,
      top: options.top,
      bottomCell,
      topCell,
      maxPrincipalStrain: normalized.maxPrincipalStrain,
      strainShareTop: normalized.strainShareTop,
      targetRotationDeg: normalized.targetRotationDeg,
      maxRotationErrorDeg: normalized.maxRotationErrorDeg,
      maxOutputAtoms: normalized.maxOutputAtoms,
    })
  } else {
    search = findGeneral2DInterfaceMatches(options)
    match = search.recommended
    bottomCell = cellFromMatrix(options.bottom, match.bottomMatrix, normalized.maxAreaMultiple)
    topCell = cellFromMatrix(options.top, match.topMatrix, normalized.maxAreaMultiple)
  }
  if (match.totalAtomCount > normalized.maxOutputAtoms) {
    throw new GeneralInterfaceInputError('output_too_large', `Interface would contain ${match.totalAtomCount} atoms (limit ${normalized.maxOutputAtoms})`)
  }
  const gapA = finiteNumber(options.gapA ?? 3, 'gapA', Number.EPSILON)
  const vacuumA = finiteNumber(options.vacuumA ?? 12, 'vacuumA', 0)
  const collisionDistanceA = finiteNumber(options.collisionDistanceA ?? 0.6, 'collisionDistanceA', Number.EPSILON)
  const maxCrossPairs = integer(options.maxCrossPairs ?? 2_000_000, 'maxCrossPairs', 1, 100_000_000)
  const offset = options.registryOffsetFractional ?? [0, 0]
  if (!Array.isArray(offset) || offset.length !== 2 || offset.some((value) => !Number.isFinite(value))) {
    throw new GeneralInterfaceInputError('invalid_registry_offset', 'registryOffsetFractional must contain two finite values')
  }
  const bottomSupercell = buildInteger2DSupercell(options.bottom, bottomCell.matrix, normalized.maxOutputAtoms)
  const topSupercell = buildInteger2DSupercell(options.top, topCell.matrix, normalized.maxOutputAtoms)
  const target = targetVectorsFromLocal(bottomCell, match.targetVectors2D)
  const bottomNormal = unit(cross(bottomCell.vectors[0], bottomCell.vectors[1]), 'bottom normal')
  const topNormal = unit(cross(topCell.vectors[0], topCell.vectors[1]), 'top normal')
  const bottomRange = projectionRange(bottomSupercell.atoms, bottomNormal)
  const topRange = projectionRange(topSupercell.atoms, topNormal)
  const bottomStartA = vacuumA / 2
  const topStartA = bottomStartA + bottomRange.thickness + gapA
  const bottomAtoms = mapLayer({
    atoms: bottomSupercell.atoms,
    sourceA: bottomCell.vectors[0],
    sourceB: bottomCell.vectors[1],
    sourceNormal: bottomNormal,
    targetA: target.a,
    targetB: target.b,
    targetNormal: target.normal,
    startHeightA: bottomStartA,
    offset: [0, 0],
    prefix: 'bottom',
  })
  const topAtoms = mapLayer({
    atoms: topSupercell.atoms,
    sourceA: topCell.vectors[0],
    sourceB: topCell.vectors[1],
    sourceNormal: topNormal,
    targetA: target.a,
    targetB: target.b,
    targetNormal: target.normal,
    startHeightA: topStartA,
    offset,
    prefix: 'top',
  })
  const bottomBonds = prefixBonds(bottomSupercell, 'bottom')
  const topBonds = prefixBonds(topSupercell, 'top')
  const bonds = bottomSupercell.bonds !== undefined || topSupercell.bonds !== undefined
    ? [...bottomBonds, ...topBonds]
    : undefined
  const cellHeightA = bottomRange.thickness + gapA + topRange.thickness + vacuumA
  const lattice = {
    vectors: [target.a, target.b, [target.normal[0] * cellHeightA, target.normal[1] * cellHeightA, target.normal[2] * cellHeightA]] as Mat3,
    periodic: [true, true, true] as [boolean, boolean, boolean],
  }
  const structure: ZatomStructure = {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${options.bottom.label ?? 'bottom'} | ${options.top.label ?? 'top'} general 2D interface`,
    lattice,
    atoms: [...bottomAtoms, ...topAtoms],
    ...(bonds ? { bonds } : {}),
    metadata: {
      'zatom.provider': 'zatom.general-2d-interface',
      'zatom.interface.bottomMatrix': match.bottomMatrix,
      'zatom.interface.topMatrix': match.topMatrix,
      'zatom.interface.alignmentRotationDeg': match.alignmentRotationDeg,
      'zatom.interface.strainShareTop': normalized.strainShareTop,
    },
  }
  const bottomProjection = projectionRange(bottomAtoms, target.normal)
  const topProjection = projectionRange(topAtoms, target.normal)
  const measuredGapA = topProjection.min - bottomProjection.max
  const measuredVacuumA = cellHeightA - (topProjection.max - bottomProjection.min)
  const crossDistance = minimumCrossDistance(bottomAtoms, topAtoms, lattice, maxCrossPairs)
  const validation = validateStructure(structure, { requirePeriodic: true })
  const expectedBottomBonds = (options.bottom.bonds?.length ?? 0) * match.bottomAreaMultiple
  const expectedTopBonds = (options.top.bonds?.length ?? 0) * match.topAreaMultiple
  const topologyKnown = options.bottom.bonds !== undefined && options.top.bonds !== undefined
  const rotationPass = match.rotationErrorDeg === null || match.rotationErrorDeg <= normalized.maxRotationErrorDeg + 1e-12
  const checks: ValidationCheck[] = [
    {
      id: 'general_interface.supercell_counts',
      status: bottomAtoms.length === match.bottomAtomCount && topAtoms.length === match.topAtomCount ? 'pass' : 'fail',
      message: `Generated exact matrix-supercell counts: bottom ${bottomAtoms.length}/${match.bottomAtomCount}, top ${topAtoms.length}/${match.topAtomCount}`,
      metrics: { bottomAtomCount: bottomAtoms.length, expectedBottomAtoms: match.bottomAtomCount, topAtomCount: topAtoms.length, expectedTopAtoms: match.topAtomCount },
    },
    {
      id: 'general_interface.inplane_strain',
      status: match.maxAbsPrincipalStrain <= normalized.maxPrincipalStrain + 1e-12 ? 'pass' : 'fail',
      message: `Maximum shared-cell principal strain is ${(100 * match.maxAbsPrincipalStrain).toFixed(5)}% (limit ${(100 * normalized.maxPrincipalStrain).toFixed(5)}%)`,
      metrics: {
        maxAbsPrincipalStrain: match.maxAbsPrincipalStrain,
        maxPrincipalStrain: normalized.maxPrincipalStrain,
        bottomPrincipalMax: Math.max(...match.bottomPrincipalStrains.map(Math.abs)),
        topPrincipalMax: Math.max(...match.topPrincipalStrains.map(Math.abs)),
        bottomAreaStrain: match.bottomAreaStrain,
        topAreaStrain: match.topAreaStrain,
      },
    },
    {
      id: 'general_interface.rotation',
      status: match.rotationErrorDeg === null ? 'skipped' : rotationPass ? 'pass' : 'fail',
      message: match.rotationErrorDeg === null
        ? `Alignment rotation is ${match.alignmentRotationDeg.toFixed(5)}°; no target rotation was supplied`
        : `Alignment rotation is ${match.alignmentRotationDeg.toFixed(5)}° for target ${normalized.targetRotationDeg!.toFixed(5)}° (error ${match.rotationErrorDeg.toFixed(5)}°)`,
      metrics: { alignmentRotationDeg: match.alignmentRotationDeg, targetRotationDeg: normalized.targetRotationDeg ?? null, rotationErrorDeg: match.rotationErrorDeg, maxRotationErrorDeg: normalized.maxRotationErrorDeg },
    },
    {
      id: 'general_interface.gap',
      status: Math.abs(measuredGapA - gapA) <= 1e-6 ? 'pass' : 'fail',
      message: `Measured outer-plane gap is ${measuredGapA.toFixed(6)} Å (requested ${gapA.toFixed(6)} Å)`,
      metrics: { measuredGapA, requestedGapA: gapA },
    },
    {
      id: 'general_interface.cross_distance',
      status: crossDistance.skipped ? 'warn' : crossDistance.distanceA !== null && crossDistance.distanceA >= collisionDistanceA ? 'pass' : 'fail',
      message: crossDistance.skipped
        ? `Cross-interface scan exceeds ${maxCrossPairs.toLocaleString()} pairs; collision safety is unassessed`
        : `Closest cross-interface pair is ${crossDistance.distanceA?.toFixed(6) ?? 'unavailable'} Å (minimum ${collisionDistanceA.toFixed(6)} Å)`,
      metrics: { minimumCrossInterfaceDistanceA: crossDistance.distanceA, collisionDistanceA, maxCrossPairs },
    },
    {
      id: 'general_interface.vacuum',
      status: measuredVacuumA + 1e-6 >= vacuumA ? 'pass' : 'fail',
      message: `Measured outer vacuum is ${measuredVacuumA.toFixed(6)} Å (requested ${vacuumA.toFixed(6)} Å)`,
      metrics: { measuredVacuumA, requestedVacuumA: vacuumA },
    },
    {
      id: 'general_interface.topology',
      status: topologyKnown
        ? bottomBonds.length === expectedBottomBonds && topBonds.length === expectedTopBonds ? 'pass' : 'fail'
        : 'warn',
      message: topologyKnown
        ? `Replicated ${bottomBonds.length + topBonds.length}/${expectedBottomBonds + expectedTopBonds} explicit intralayer bonds`
        : 'One or both slabs omit explicit bonds; interface topology remains partially or wholly unknown',
      metrics: { bottomBondCount: bottomBonds.length, expectedBottomBonds, topBondCount: topBonds.length, expectedTopBonds },
    },
    {
      id: 'general_interface.physical_scope',
      status: 'warn',
      message: 'HNF matching applies homogeneous in-plane strain and a chosen registry/gap; atomic reconstruction, adhesion, electronic contact, and relaxation require a material-specific solver',
    },
    ...validation.checks,
  ]
  const interfaceAtoms = [
    ...bottomAtoms.filter((atom) => dot(atom.position, target.normal) >= bottomProjection.max - 0.75),
    ...topAtoms.filter((atom) => dot(atom.position, target.normal) <= topProjection.min + 0.75),
  ]
  const interfaceBounds = boundsOfPositions(interfaceAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = interfaceBounds ? [{
    id: 'general-interface-contact',
    reason: 'Inspect off-diagonal registry, gap, and close contacts at the matched interface',
    center: interfaceBounds.center,
    radius: Math.max(2, interfaceBounds.radius),
    atomIds: interfaceAtoms.slice(0, 80).map((atom) => atom.id),
    atomIdsTruncated: interfaceAtoms.length > 80,
  }] : []
  inspectionTargets.push(...validation.inspectionTargets)
  return {
    structure,
    checks,
    inspectionTargets,
    match,
    search,
    metrics: {
      requestedGapA: gapA,
      measuredGapA,
      requestedVacuumA: vacuumA,
      measuredVacuumA,
      bottomThicknessA: bottomRange.thickness,
      topThicknessA: topRange.thickness,
      minimumCrossInterfaceDistanceA: crossDistance.distanceA,
      crossPairScanSkipped: crossDistance.skipped,
      bottomBondCount: bottomSupercell.bonds?.length ?? null,
      topBondCount: topSupercell.bonds?.length ?? null,
    },
  }
}
