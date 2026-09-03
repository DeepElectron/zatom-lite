/** Validated adapters for analytic continuous deformation fields. */

import {
  cylindricalBend,
  cylindricalBendWrapsArc,
  type CylindricalBendParams,
} from '../lib/deformation/cylindrical-bend'
import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
} from './contracts'
import { buildStructureChangeSet } from './operations'
import { boundsOfPositions, distance, fingerprintStructure } from './structure-math'
import { validateStructure } from './structure-validation'

export interface ApplyCylindricalBendOptions {
  structure: ZatomStructure
  radiusA: number
  tangent: Vec3
  radial: Vec3
  axis?: Vec3
  bendOrigin?: Vec3
  maxFiberStrain?: number
  maxGreenStrain?: number
  dropLattice?: boolean
}

export interface ApplyCylindricalBendResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  frame: CylindricalBendParams
  metrics: {
    sRangeA: [number, number]
    radialRangeA: [number, number]
    angleRangeRad: [number, number]
    maxAbsFiberStrain: number
    maxAbsGreenStrain: number
    maxInverseRoundTripErrorA: number
    wrapsHalfTurn: boolean
    latticeDropped: boolean
  }
}

export class DeformationInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DeformationInputError'
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

function unit(value: Vec3, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new DeformationInputError('invalid_axis', `${field} must contain three finite numbers`)
  }
  const length = Math.hypot(...value)
  if (length < 1e-12) throw new DeformationInputError('invalid_axis', `${field} must be non-zero`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function finiteNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new DeformationInputError('invalid_parameter', `${field} must be finite and non-negative`)
  return value
}

export function applyCylindricalBend(options: ApplyCylindricalBendOptions): ApplyCylindricalBendResult {
  const sourceValidation = validateStructure(options.structure)
  if (sourceValidation.verdict === 'fail') throw new DeformationInputError('invalid_source_structure', 'Cylindrical bending requires a valid source structure')
  if (!Number.isFinite(options.radiusA) || options.radiusA <= 0) throw new DeformationInputError('invalid_radius', 'radiusA must be finite and greater than zero')
  if (options.structure.lattice && options.dropLattice !== true) {
    throw new DeformationInputError(
      'drop_lattice_acknowledgement_required',
      'A cylindrical bend is not translationally periodic along the curved direction; set dropLattice=true to acknowledge conversion to a finite non-periodic artifact',
    )
  }
  const tangent = unit(options.tangent, 'tangent')
  const radialInput = unit(options.radial, 'radial')
  if (Math.abs(dot(tangent, radialInput)) > 1e-6) {
    throw new DeformationInputError('nonorthogonal_frame', 'tangent and radial must be mutually orthogonal')
  }
  const derivedAxis = unit(cross(tangent, radialInput), 'tangent×radial')
  const axis = options.axis ? unit(options.axis, 'axis') : derivedAxis
  if (dot(axis, derivedAxis) < 1 - 1e-6) {
    throw new DeformationInputError('nonorthogonal_frame', 'axis must equal the right-handed tangent×radial direction')
  }
  const bounds = boundsOfPositions(options.structure.atoms.map((atom) => atom.position))
  if (!bounds) throw new DeformationInputError('empty_structure', 'Cylindrical bending requires at least one atom')
  const bendOrigin = options.bendOrigin ? unitlessFinite(options.bendOrigin, 'bendOrigin') : bounds.center
  const maxFiberStrain = finiteNonNegative(options.maxFiberStrain ?? 0.02, 'maxFiberStrain')
  const maxGreenStrain = finiteNonNegative(options.maxGreenStrain ?? 0.0202, 'maxGreenStrain')
  const frame: CylindricalBendParams = {
    R: options.radiusA,
    tangent,
    radial: radialInput,
    axis,
    bendOrigin,
  }

  let sMin = Infinity
  let sMax = -Infinity
  let rMin = Infinity
  let rMax = -Infinity
  let maxAbsFiber = 0
  let maxAbsGreen = 0
  let maxStrainAtomId = options.structure.atoms[0].id
  for (const atom of options.structure.atoms) {
    const q: Vec3 = [
      atom.position[0] - bendOrigin[0],
      atom.position[1] - bendOrigin[1],
      atom.position[2] - bendOrigin[2],
    ]
    const s = dot(q, tangent)
    const r = dot(q, radialInput)
    sMin = Math.min(sMin, s)
    sMax = Math.max(sMax, s)
    rMin = Math.min(rMin, r)
    rMax = Math.max(rMax, r)
    const fiber = r / options.radiusA
    const green = fiber + 0.5 * fiber * fiber
    if (Math.abs(fiber) > maxAbsFiber) {
      maxAbsFiber = Math.abs(fiber)
      maxStrainAtomId = atom.id
    }
    maxAbsGreen = Math.max(maxAbsGreen, Math.abs(green))
  }
  if (options.radiusA + rMin <= 0) {
    throw new DeformationInputError('folds_through_bend_axis', 'At least one atom has radiusA + radialCoordinate <= 0')
  }
  const wrapsHalfTurn = cylindricalBendWrapsArc(options.radiusA, sMin, sMax)
  const field = cylindricalBend(frame)
  let maxInverseRoundTripErrorA = 0
  const atoms = options.structure.atoms.map((atom) => {
    const mapped = field.map(atom.position)
    maxInverseRoundTripErrorA = Math.max(maxInverseRoundTripErrorA, distance(atom.position, field.inverseMap(mapped)))
    return { ...atom, position: mapped }
  })
  const structure: ZatomStructure = {
    ...options.structure,
    label: `${options.structure.label ?? 'structure'} cylindrical bend R=${options.radiusA} Å`,
    atoms,
    ...(options.structure.bonds ? {
      bonds: options.structure.bonds.map((bond) => ({ ...bond, atomIds: [...bond.atomIds] as [string, string] })),
    } : {}),
    lattice: undefined,
    metadata: {
      ...(options.structure.metadata ?? {}),
      ...(options.structure.lattice ? { 'zatom.deformation.sourceLattice': options.structure.lattice as unknown as JsonValue } : {}),
      'zatom.deformation.kind': 'cylindrical-bend',
    },
  }
  delete structure.lattice
  const validation = validateStructure(structure)
  const checks: ValidationCheck[] = [
    {
      id: 'bend.frame_orthonormal',
      status: 'pass',
      message: 'Bend frame is finite, unit length, mutually orthogonal, and right-handed',
    },
    {
      id: 'bend.arc_single_valued',
      status: wrapsHalfTurn ? 'fail' : 'pass',
      message: wrapsHalfTurn
        ? 'Reference arc reaches or crosses ±πR; inverse mapping is multi-valued'
        : `Reference arc remains inside the single-valued interval (${sMin.toFixed(4)} to ${sMax.toFixed(4)} Å)`,
      metrics: { sMinA: sMin, sMaxA: sMax, halfTurnA: Math.PI * options.radiusA },
    },
    {
      id: 'bend.fiber_strain',
      status: maxAbsFiber <= maxFiberStrain + 1e-12 ? 'pass' : 'fail',
      message: `Maximum |r/R| fiber strain is ${(100 * maxAbsFiber).toFixed(4)}% (limit ${(100 * maxFiberStrain).toFixed(4)}%)`,
      metrics: { maxAbsFiberStrain: maxAbsFiber, limit: maxFiberStrain },
      atomIds: [maxStrainAtomId],
    },
    {
      id: 'bend.green_lagrange_strain',
      status: maxAbsGreen <= maxGreenStrain + 1e-12 ? 'pass' : 'fail',
      message: `Maximum analytic Green–Lagrange fiber strain is ${(100 * maxAbsGreen).toFixed(4)}% (limit ${(100 * maxGreenStrain).toFixed(4)}%)`,
      metrics: { maxAbsGreenStrain: maxAbsGreen, limit: maxGreenStrain },
      atomIds: [maxStrainAtomId],
    },
    {
      id: 'bend.inverse_round_trip',
      status: maxInverseRoundTripErrorA <= 1e-8 ? 'pass' : 'fail',
      message: `Maximum analytic map→inverseMap round-trip error is ${maxInverseRoundTripErrorA.toExponential(3)} Å`,
      metrics: { maxInverseRoundTripErrorA },
    },
    ...(options.structure.lattice ? [{
      id: 'bend.periodicity_removed',
      status: 'warn' as const,
      message: 'Source lattice/PBC were intentionally removed because the finite curved artifact is not translationally periodic along the bend',
    }] : []),
    {
      id: 'bend.seed_requires_relaxation',
      status: 'warn',
      message: 'The analytic field is a compatible low-strain seed, not a traction-free relaxed structure; use a suitable atomistic solver before energetic claims',
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const maxStrainAtom = structure.atoms.find((atom) => atom.id === maxStrainAtomId)!
  const inspectionTargets: InspectionTarget[] = [{
    id: 'maximum-bend-strain',
    reason: `Inspect the atom at maximum analytic fiber strain (${(100 * maxAbsFiber).toFixed(4)}%)`,
    center: [...maxStrainAtom.position] as Vec3,
    radius: Math.max(2, options.radiusA * 0.02),
    atomIds: [maxStrainAtomId],
  }, ...validation.inspectionTargets]
  const provenance: StructureProvenance = {
    engine: 'zatom-analytic-cylindrical-bend',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      radiusA: options.radiusA,
      tangent,
      radial: radialInput,
      axis,
      bendOrigin,
      maxFiberStrain,
      maxGreenStrain,
      dropLattice: options.dropLattice ?? false,
    },
  }
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    frame,
    metrics: {
      sRangeA: [sMin, sMax],
      radialRangeA: [rMin, rMax],
      angleRangeRad: [sMin / options.radiusA, sMax / options.radiusA],
      maxAbsFiberStrain: maxAbsFiber,
      maxAbsGreenStrain: maxAbsGreen,
      maxInverseRoundTripErrorA,
      wrapsHalfTurn,
      latticeDropped: !!options.structure.lattice,
    },
  }
}

function unitlessFinite(value: Vec3, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new DeformationInputError('invalid_vector', `${field} must contain three finite numbers`)
  }
  return [...value] as Vec3
}
