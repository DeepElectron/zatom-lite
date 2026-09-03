/** Deterministic smooth displacement fields with finite-difference strain audits. */

import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { boundsOfPositions, determinant3, distance } from './structure-math'
import { validateStructure } from './structure-validation'

export type SmoothDisplacementField =
  | {
    kind: 'gaussian'
    center: Vec3
    direction: Vec3
    amplitudeA: number
    sigmaA: number
  }
  | {
    kind: 'smooth-step'
    origin: Vec3
    normal: Vec3
    direction: Vec3
    amplitudeA: number
    widthA: number
  }
  | {
    kind: 'sinusoidal'
    origin: Vec3
    propagation: Vec3
    direction: Vec3
    amplitudeA: number
    wavelengthA: number
    phaseDeg: number
  }
  | {
    kind: 'torsion'
    origin: Vec3
    axis: Vec3
    angleRateDegPerA: number
  }

export interface SmoothFieldSelection {
  atomIds?: string[]
  elements?: string[]
}

export interface ApplySmoothFieldsOptions {
  structure: ZatomStructure
  fields: SmoothDisplacementField[]
  selection?: SmoothFieldSelection
  /** Required acknowledgement whenever the source carries a lattice. */
  dropLattice?: boolean
  maxPrincipalStrain?: number
  minJacobianDeterminant?: number
  maximumDisplacementA?: number
  minimumPairDistanceA?: number
  finiteDifferenceStepA?: number
  maxAuditAtoms?: number
}

export interface SmoothFieldAtomAudit {
  atomId: string
  jacobianDeterminant: number
  principalEngineeringStrains: [number, number, number]
  principalGreenLagrangeStrains: [number, number, number]
  maxAbsPrincipalStrain: number
  maxAbsGreenLagrangeStrain: number
}

export interface ApplySmoothFieldsResult {
  structure: ZatomStructure
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  audit: {
    selectedAtomCount: number
    auditedAtomCount: number
    auditTruncated: boolean
    maxDisplacementA: number
    maxDisplacementAtomId: string
    maxAbsPrincipalStrain: number
    maxAbsGreenLagrangeStrain: number
    maxStrainAtomId: string
    minJacobianDeterminant: number
    minJacobianAtomId: string
    maxJacobianDeterminant: number
    finiteDifferenceStepA: number
  }
  atomAudits: SmoothFieldAtomAudit[]
}

export class SmoothFieldInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SmoothFieldInputError'
    this.code = code
  }
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

function unit(value: Vec3, name: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new SmoothFieldInputError('invalid_field_vector', `${name} must contain three finite numbers`)
  }
  const length = Math.hypot(...value)
  if (length < 1e-12) throw new SmoothFieldInputError('invalid_field_vector', `${name} must not be zero`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function finite(value: number, name: string, options: { min?: number; strictlyPositive?: boolean } = {}): number {
  if (!Number.isFinite(value)
    || (options.strictlyPositive && value <= 0)
    || (options.min !== undefined && value < options.min)) {
    throw new SmoothFieldInputError('invalid_field_parameter', `${name} is outside its finite allowed range`)
  }
  return value
}

function addScaled(point: Vec3, vector: Vec3, scale: number): Vec3 {
  return [point[0] + scale * vector[0], point[1] + scale * vector[1], point[2] + scale * vector[2]]
}

function compileField(field: SmoothDisplacementField, index: number): (position: Vec3) => Vec3 {
  if (field.kind === 'gaussian') {
    const direction = unit(field.direction, `fields[${index}].direction`)
    const amplitudeA = finite(field.amplitudeA, `fields[${index}].amplitudeA`)
    const sigmaA = finite(field.sigmaA, `fields[${index}].sigmaA`, { strictlyPositive: true })
    const denominator = 2 * sigmaA * sigmaA
    return (position) => {
      const dx = position[0] - field.center[0]
      const dy = position[1] - field.center[1]
      const dz = position[2] - field.center[2]
      return addScaled(position, direction, amplitudeA * Math.exp(-(dx * dx + dy * dy + dz * dz) / denominator))
    }
  }
  if (field.kind === 'smooth-step') {
    const normal = unit(field.normal, `fields[${index}].normal`)
    const direction = unit(field.direction, `fields[${index}].direction`)
    const amplitudeA = finite(field.amplitudeA, `fields[${index}].amplitudeA`)
    const widthA = finite(field.widthA, `fields[${index}].widthA`, { strictlyPositive: true })
    return (position) => {
      const relative: Vec3 = [
        position[0] - field.origin[0],
        position[1] - field.origin[1],
        position[2] - field.origin[2],
      ]
      return addScaled(position, direction, 0.5 * amplitudeA * Math.tanh(dot(relative, normal) / widthA))
    }
  }
  if (field.kind === 'sinusoidal') {
    const propagation = unit(field.propagation, `fields[${index}].propagation`)
    const direction = unit(field.direction, `fields[${index}].direction`)
    const amplitudeA = finite(field.amplitudeA, `fields[${index}].amplitudeA`)
    const wavelengthA = finite(field.wavelengthA, `fields[${index}].wavelengthA`, { strictlyPositive: true })
    const phase = finite(field.phaseDeg, `fields[${index}].phaseDeg`) * Math.PI / 180
    return (position) => {
      const relative: Vec3 = [
        position[0] - field.origin[0],
        position[1] - field.origin[1],
        position[2] - field.origin[2],
      ]
      const wave = 2 * Math.PI * dot(relative, propagation) / wavelengthA + phase
      return addScaled(position, direction, amplitudeA * Math.sin(wave))
    }
  }
  const axis = unit(field.axis, `fields[${index}].axis`)
  const rate = finite(field.angleRateDegPerA, `fields[${index}].angleRateDegPerA`) * Math.PI / 180
  return (position) => {
    const relative: Vec3 = [
      position[0] - field.origin[0],
      position[1] - field.origin[1],
      position[2] - field.origin[2],
    ]
    const angle = rate * dot(relative, axis)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const axial = dot(relative, axis)
    const axialVector: Vec3 = [axis[0] * axial, axis[1] * axial, axis[2] * axial]
    const radial: Vec3 = [relative[0] - axialVector[0], relative[1] - axialVector[1], relative[2] - axialVector[2]]
    const tangent = cross(axis, radial)
    return [
      field.origin[0] + axialVector[0] + cosine * radial[0] + sine * tangent[0],
      field.origin[1] + axialVector[1] + cosine * radial[1] + sine * tangent[1],
      field.origin[2] + axialVector[2] + cosine * radial[2] + sine * tangent[2],
    ]
  }
}

/** Map a point through the fields in array order. */
export function mapSmoothFields(fields: SmoothDisplacementField[], position: Vec3): Vec3 {
  const compiled = fields.map(compileField)
  return compiled.reduce((current, map) => map(current), [...position] as Vec3)
}

function composeFields(fields: SmoothDisplacementField[]): (position: Vec3) => Vec3 {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new SmoothFieldInputError('fields_required', 'fields must contain at least one smooth displacement field')
  }
  if (fields.length > 32) throw new SmoothFieldInputError('too_many_fields', 'At most 32 smooth fields may be composed')
  const compiled = fields.map(compileField)
  return (position) => compiled.reduce((current, map) => map(current), [...position] as Vec3)
}

function finiteDifferenceJacobian(map: (position: Vec3) => Vec3, position: Vec3, stepA: number): Mat3 {
  const result: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let column = 0; column < 3; column++) {
    const plus = [...position] as Vec3
    const minus = [...position] as Vec3
    plus[column] += stepA
    minus[column] -= stepA
    const mappedPlus = map(plus)
    const mappedMinus = map(minus)
    for (let row = 0; row < 3; row++) result[row][column] = (mappedPlus[row] - mappedMinus[row]) / (2 * stepA)
  }
  return result
}

function rightCauchyGreen(fieldGradient: Mat3): Mat3 {
  return [0, 1, 2].map((row) => [0, 1, 2].map((column) => (
    fieldGradient[0][row] * fieldGradient[0][column]
    + fieldGradient[1][row] * fieldGradient[1][column]
    + fieldGradient[2][row] * fieldGradient[2][column]
  )) as Vec3) as Mat3
}

/** Stable closed-form eigenvalues for a real symmetric 3×3 matrix. */
function symmetricEigenvalues(matrix: Mat3): [number, number, number] {
  const offDiagonalSquare = matrix[0][1] ** 2 + matrix[0][2] ** 2 + matrix[1][2] ** 2
  let values: number[]
  if (offDiagonalSquare < 1e-30) {
    values = [matrix[0][0], matrix[1][1], matrix[2][2]]
  } else {
    const mean = (matrix[0][0] + matrix[1][1] + matrix[2][2]) / 3
    const spread = Math.sqrt((
      (matrix[0][0] - mean) ** 2
      + (matrix[1][1] - mean) ** 2
      + (matrix[2][2] - mean) ** 2
      + 2 * offDiagonalSquare
    ) / 6)
    const normalized = matrix.map((row, i) => row.map((value, j) => (
      (value - (i === j ? mean : 0)) / spread
    )) as Vec3) as Mat3
    const halfDeterminant = determinant3(normalized) / 2
    const angle = Math.acos(Math.max(-1, Math.min(1, halfDeterminant))) / 3
    const largest = mean + 2 * spread * Math.cos(angle)
    const smallest = mean + 2 * spread * Math.cos(angle + 2 * Math.PI / 3)
    values = [largest, 3 * mean - largest - smallest, smallest]
  }
  values.sort((a, b) => b - a)
  return [values[0], values[1], values[2]]
}

function auditPoint(atomId: string, position: Vec3, map: (position: Vec3) => Vec3, stepA: number): SmoothFieldAtomAudit {
  const gradient = finiteDifferenceJacobian(map, position, stepA)
  const eigenvalues = symmetricEigenvalues(rightCauchyGreen(gradient)).map((value) => Math.max(0, value))
  const engineering = eigenvalues.map((value) => Math.sqrt(value) - 1) as [number, number, number]
  const green = eigenvalues.map((value) => 0.5 * (value - 1)) as [number, number, number]
  return {
    atomId,
    jacobianDeterminant: determinant3(gradient),
    principalEngineeringStrains: engineering,
    principalGreenLagrangeStrains: green,
    maxAbsPrincipalStrain: Math.max(...engineering.map(Math.abs)),
    maxAbsGreenLagrangeStrain: Math.max(...green.map(Math.abs)),
  }
}

function sampleIndices(indices: number[], limit: number, requiredIndex: number): number[] {
  if (indices.length <= limit) return [...indices]
  const sampled = new Set<number>()
  for (let i = 0; i < limit; i++) sampled.add(indices[Math.floor(i * indices.length / limit)])
  sampled.add(requiredIndex)
  if (sampled.size > limit) {
    for (const value of [...sampled].reverse()) {
      if (value !== requiredIndex) { sampled.delete(value); break }
    }
  }
  return [...sampled].sort((a, b) => a - b)
}

function selectedAtomIndices(structure: ZatomStructure, selection?: SmoothFieldSelection): number[] {
  const requestedIds = selection?.atomIds ? new Set(selection.atomIds) : null
  const elements = selection?.elements ? new Set(selection.elements) : null
  if (requestedIds) {
    const present = new Set(structure.atoms.map((atom) => atom.id))
    const missing = [...requestedIds].filter((id) => !present.has(id))
    if (missing.length) {
      throw new SmoothFieldInputError('selection_atom_ids_missing', `Selection references absent atom IDs: ${missing.slice(0, 8).join(', ')}`)
    }
  }
  const indices = structure.atoms
    .map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => (!requestedIds || requestedIds.has(atom.id)) && (!elements || elements.has(atom.element)))
    .map(({ index }) => index)
  if (indices.length === 0) throw new SmoothFieldInputError('empty_field_selection', 'Smooth-field selection matched no atoms')
  return indices
}

function targetForAtom(structure: ZatomStructure, atomId: string, id: string, reason: string, radius: number): InspectionTarget {
  const atom = structure.atoms.find((candidate) => candidate.id === atomId)!
  return { id, reason, center: [...atom.position] as Vec3, radius, atomIds: [atomId] }
}

export function applySmoothDisplacementFields(options: ApplySmoothFieldsOptions): ApplySmoothFieldsResult {
  const sourceValidation = validateStructure(options.structure)
  const sourceFailures = sourceValidation.checks.filter((check) => check.status === 'fail')
  if (sourceFailures.length) {
    throw new SmoothFieldInputError('invalid_source_structure', sourceFailures.map((check) => check.message).join('; '))
  }
  if (options.structure.lattice && options.dropLattice !== true) {
    throw new SmoothFieldInputError(
      'drop_lattice_acknowledgement_required',
      'A general non-affine field does not preserve the source translation lattice; set dropLattice=true to create a finite non-periodic artifact',
    )
  }
  const map = composeFields(options.fields)
  const selected = selectedAtomIndices(options.structure, options.selection)
  const selectedSet = new Set(selected)
  const maxPrincipalStrain = finite(options.maxPrincipalStrain ?? 0.15, 'maxPrincipalStrain', { min: 0 })
  const minJacobianDeterminant = finite(options.minJacobianDeterminant ?? 0.1, 'minJacobianDeterminant', { min: 0 })
  const minimumPairDistanceA = finite(options.minimumPairDistanceA ?? 0.35, 'minimumPairDistanceA', { min: 0 })
  const finiteDifferenceStepA = finite(options.finiteDifferenceStepA ?? 1e-4, 'finiteDifferenceStepA', { strictlyPositive: true })
  const rawMaxAuditAtoms = finite(options.maxAuditAtoms ?? 2000, 'maxAuditAtoms', { strictlyPositive: true })
  if (!Number.isInteger(rawMaxAuditAtoms)) {
    throw new SmoothFieldInputError('invalid_field_parameter', 'maxAuditAtoms must be an integer')
  }
  const maxAuditAtoms = rawMaxAuditAtoms
  const maximumDisplacementA = options.maximumDisplacementA === undefined
    ? null
    : finite(options.maximumDisplacementA, 'maximumDisplacementA', { min: 0 })

  let maxDisplacementA = -Infinity
  let maxDisplacementIndex = selected[0]
  const atoms = options.structure.atoms.map((atom, index) => {
    if (!selectedSet.has(index)) {
      return { ...atom, position: [...atom.position] as Vec3, ...(atom.properties ? { properties: { ...atom.properties } } : {}) }
    }
    const mapped = map(atom.position)
    if (mapped.some((value) => !Number.isFinite(value))) {
      throw new SmoothFieldInputError('non_finite_field_output', `Field mapping produced non-finite coordinates for atom ${atom.id}`)
    }
    const displacementVector: Vec3 = [
      mapped[0] - atom.position[0],
      mapped[1] - atom.position[1],
      mapped[2] - atom.position[2],
    ]
    const displacementA = Math.hypot(...displacementVector)
    if (displacementA > maxDisplacementA) {
      maxDisplacementA = displacementA
      maxDisplacementIndex = index
    }
    return {
      ...atom,
      position: mapped,
      properties: {
        ...(atom.properties ?? {}),
        'zatom.field.deformed': true,
        'zatom.field.displacementA': displacementA,
        'zatom.field.displacement': displacementVector,
      },
    }
  })

  const auditedIndices = sampleIndices(selected, maxAuditAtoms, maxDisplacementIndex)
  const atomAudits = auditedIndices.map((index) => auditPoint(
    options.structure.atoms[index].id,
    options.structure.atoms[index].position,
    map,
    finiteDifferenceStepA,
  ))
  let maxAbsPrincipal = -Infinity
  let maxAbsGreen = -Infinity
  let minDeterminant = Infinity
  let maxDeterminant = -Infinity
  let maxStrainAtomId = atomAudits[0].atomId
  let minJacobianAtomId = atomAudits[0].atomId
  for (const audit of atomAudits) {
    if (audit.maxAbsPrincipalStrain > maxAbsPrincipal) {
      maxAbsPrincipal = audit.maxAbsPrincipalStrain
      maxStrainAtomId = audit.atomId
    }
    maxAbsGreen = Math.max(maxAbsGreen, audit.maxAbsGreenLagrangeStrain)
    if (audit.jacobianDeterminant < minDeterminant) {
      minDeterminant = audit.jacobianDeterminant
      minJacobianAtomId = audit.atomId
    }
    maxDeterminant = Math.max(maxDeterminant, audit.jacobianDeterminant)
  }

  const structure: ZatomStructure = {
    ...options.structure,
    label: `${options.structure.label ?? 'structure'} smooth displacement fields`,
    atoms,
    ...(options.structure.bonds ? {
      bonds: options.structure.bonds.map((bond) => ({
        ...bond,
        atomIds: [...bond.atomIds] as [string, string],
        ...(bond.properties ? { properties: { ...bond.properties } } : {}),
      })),
    } : {}),
    metadata: {
      ...(options.structure.metadata ?? {}),
      ...(options.structure.lattice ? { 'zatom.field.sourceLattice': options.structure.lattice as unknown as JsonValue } : {}),
      'zatom.field.kind': 'smooth-composition',
      'zatom.field.count': options.fields.length,
      'zatom.field.selectedAtomCount': selected.length,
      'zatom.field.auditTruncated': auditedIndices.length < selected.length,
    },
  }
  if (options.structure.lattice) delete structure.lattice
  const validation = validateStructure(structure, {
    overlapDistanceA: minimumPairDistanceA,
    closePairWarningA: Math.max(0.6, minimumPairDistanceA),
  })
  const minimumDistanceCheck = validation.checks.find((check) => check.id === 'structure.minimum_distance')
  const selectionIsPartial = selected.length !== options.structure.atoms.length
  const checks: ValidationCheck[] = [
    {
      id: 'field.mapping_completeness',
      status: atoms.length === options.structure.atoms.length ? 'pass' : 'fail',
      message: `Mapped ${selected.length}/${options.structure.atoms.length} selected atoms through ${options.fields.length} ordered smooth field${options.fields.length === 1 ? '' : 's'}`,
      metrics: { selectedAtomCount: selected.length, atomCount: atoms.length, fieldCount: options.fields.length },
    },
    {
      id: 'field.jacobian_orientation',
      status: minDeterminant >= minJacobianDeterminant ? 'pass' : 'fail',
      message: `Audited Jacobian determinant range is ${minDeterminant.toFixed(6)} to ${maxDeterminant.toFixed(6)} (minimum allowed ${minJacobianDeterminant.toFixed(6)})`,
      metrics: { minJacobianDeterminant: minDeterminant, maxJacobianDeterminant: maxDeterminant, requiredMinimum: minJacobianDeterminant },
      atomIds: [minJacobianAtomId],
    },
    {
      id: 'field.principal_strain',
      status: maxAbsPrincipal <= maxPrincipalStrain + 1e-12 ? 'pass' : 'fail',
      message: `Maximum audited absolute principal engineering strain is ${(100 * maxAbsPrincipal).toFixed(5)}% (limit ${(100 * maxPrincipalStrain).toFixed(5)}%)`,
      metrics: { maxAbsPrincipalStrain: maxAbsPrincipal, maxAbsGreenLagrangeStrain: maxAbsGreen, limit: maxPrincipalStrain },
      atomIds: [maxStrainAtomId],
    },
    {
      id: 'field.displacement_limit',
      status: maximumDisplacementA === null ? 'skipped' : maxDisplacementA <= maximumDisplacementA + 1e-12 ? 'pass' : 'fail',
      message: maximumDisplacementA === null
        ? `Maximum displacement is ${maxDisplacementA.toFixed(6)} Å; no displacement limit was supplied`
        : `Maximum displacement is ${maxDisplacementA.toFixed(6)} Å (limit ${maximumDisplacementA.toFixed(6)} Å)`,
      metrics: { maxDisplacementA, maximumDisplacementA },
      atomIds: [options.structure.atoms[maxDisplacementIndex].id],
    },
    {
      id: 'field.minimum_distance',
      status: minimumDistanceCheck?.status === 'fail'
        ? 'fail'
        : minimumDistanceCheck?.status === 'pass'
          ? 'pass'
          : 'warn',
      message: minimumDistanceCheck?.message ?? 'No independent final-distance check was available',
      metrics: minimumDistanceCheck?.metrics,
      atomIds: minimumDistanceCheck?.atomIds,
    },
    {
      id: 'field.topology_preserved',
      status: options.structure.bonds === undefined ? 'skipped' : 'pass',
      message: options.structure.bonds === undefined
        ? 'Source had no explicit bonds; the field did not invent topology'
        : `Preserved all ${options.structure.bonds.length} explicit bond IDs, endpoints, and orders`,
      metrics: { sourceBondCount: options.structure.bonds?.length ?? null, resultBondCount: structure.bonds?.length ?? null },
    },
    {
      id: 'field.periodicity_truthful',
      status: options.structure.lattice ? 'warn' : 'pass',
      message: options.structure.lattice
        ? 'Source lattice/PBC were explicitly removed because a general non-affine field is not translationally periodic'
        : 'Finite source had no translation lattice to invalidate',
    },
    {
      id: 'field.audit_coverage',
      status: auditedIndices.length === selected.length ? 'pass' : 'warn',
      message: auditedIndices.length === selected.length
        ? `Finite-difference strain/Jacobian audit covered all ${selected.length} selected atoms`
        : `Finite-difference audit sampled ${auditedIndices.length}/${selected.length} selected atoms deterministically`,
      metrics: { auditedAtomCount: auditedIndices.length, selectedAtomCount: selected.length, finiteDifferenceStepA },
    },
    ...(selectionIsPartial ? [{
      id: 'field.selection_boundary',
      status: 'warn' as const,
      message: 'Only a subset was mapped; atom-ID/element selection creates a discrete boundary not represented by the smooth-field Jacobian audit',
    }] : []),
    {
      id: 'field.physical_scope',
      status: 'warn',
      message: 'The displacement field is a geometric/continuum seed. Stress, force balance, material constitutive response, and stability require an appropriate relaxation or mechanics provider',
    },
  ]
  const maxDisplacementAtomId = options.structure.atoms[maxDisplacementIndex].id
  const inspectionTargets: InspectionTarget[] = [
    targetForAtom(
      structure,
      maxDisplacementAtomId,
      'field-maximum-displacement',
      `Inspect maximum displacement (${maxDisplacementA.toFixed(5)} Å)`,
      Math.max(2, Math.min(10, maxDisplacementA + 1)),
    ),
    ...(maxStrainAtomId === maxDisplacementAtomId ? [] : [targetForAtom(
      structure,
      maxStrainAtomId,
      'field-maximum-principal-strain',
      `Inspect maximum audited principal strain (${(100 * maxAbsPrincipal).toFixed(5)}%)`,
      2,
    )]),
    ...validation.inspectionTargets,
  ]
  return {
    structure,
    checks,
    inspectionTargets,
    audit: {
      selectedAtomCount: selected.length,
      auditedAtomCount: auditedIndices.length,
      auditTruncated: auditedIndices.length < selected.length,
      maxDisplacementA,
      maxDisplacementAtomId,
      maxAbsPrincipalStrain: maxAbsPrincipal,
      maxAbsGreenLagrangeStrain: maxAbsGreen,
      maxStrainAtomId,
      minJacobianDeterminant: minDeterminant,
      minJacobianAtomId,
      maxJacobianDeterminant: maxDeterminant,
      finiteDifferenceStepA,
    },
    atomAudits,
  }
}

export function smoothFieldBoundsCenter(structure: ZatomStructure): Vec3 {
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  if (!bounds) throw new SmoothFieldInputError('empty_structure', 'Smooth fields require at least one atom')
  return bounds.center
}

export function displacementBetween(source: ZatomStructure, result: ZatomStructure, atomId: string): number {
  const a = source.atoms.find((atom) => atom.id === atomId)
  const b = result.atoms.find((atom) => atom.id === atomId)
  if (!a || !b) throw new SmoothFieldInputError('atom_not_found', `Cannot measure displacement for absent atom ${atomId}`)
  return distance(a.position, b.position)
}
