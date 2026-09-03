import {
  computeAngle,
  computeDihedral,
  computeDistance,
} from '../lib/measurement/measurement-math'
import type {
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomStructureAtom,
} from './contracts'
import {
  boundsOfPositions,
  certifiedMinimumImageVector,
  fingerprintCanonicalJson,
  fingerprintStructure,
} from './structure-math'

export const GEOMETRY_MEASUREMENT_VERSION = '1.0.0'

interface GeometryMeasurementBase {
  id: string
  atomIds: string[]
  periodic: boolean
}

export interface DistanceMeasurementRequest extends GeometryMeasurementBase {
  kind: 'distance'
  minimumA?: number
  maximumA?: number
}

export interface AngleMeasurementRequest extends GeometryMeasurementBase {
  kind: 'angle'
  minimumDeg?: number
  maximumDeg?: number
}

export interface DihedralMeasurementRequest extends GeometryMeasurementBase {
  kind: 'dihedral'
  minimumDeg?: number
  maximumDeg?: number
}

export type GeometryMeasurementRequest =
  | DistanceMeasurementRequest
  | AngleMeasurementRequest
  | DihedralMeasurementRequest

export interface GeometryMeasurementValue {
  id: string
  kind: GeometryMeasurementRequest['kind']
  atomIds: string[]
  periodic: boolean
  value: number
  unit: 'angstrom' | 'degree'
  minimum?: number
  maximum?: number
  passed: boolean
  unwrappedPositions: Vec3[]
  minimumImageCandidateEvaluations: number
}

export interface GeometryMeasurementResult {
  structureFingerprint: string
  fingerprint: string
  method: {
    engine: 'zatom-geometry-measurement'
    engineVersion: typeof GEOMETRY_MEASUREMENT_VERSION
    periodicVectorMethod: 'certified-singular-value-bounded-closest-vector'
  }
  measurements: GeometryMeasurementValue[]
  totalMinimumImageCandidateEvaluations: number
  verdict: 'pass' | 'fail'
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export class GeometryMeasurementInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'GeometryMeasurementInputError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function exactFields(value: Record<string, unknown>, allowed: string[], field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key)).sort()
  if (unexpected.length) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement',
      `${field} contains unsupported fields: ${unexpected.join(', ')}`,
    )
  }
}

function finiteOptional(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement_bound',
      `${field} must be finite and in [${minimum}, ${maximum}]`,
    )
  }
  return parsed
}

function atomIds(value: unknown, count: number, field: string): string[] {
  if (!Array.isArray(value) || value.length !== count
    || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement_atoms',
      `${field} must contain exactly ${count} non-empty atom IDs`,
    )
  }
  const ids = value.map((item) => String(item).trim())
  if (new Set(ids).size !== ids.length) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement_atoms',
      `${field} must reference distinct atoms`,
    )
  }
  return ids
}

/** Parse a closed, bounded distance/angle/dihedral request array. */
export function parseGeometryMeasurements(value: unknown): GeometryMeasurementRequest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurements',
      'measurements must contain 1 to 256 requests',
    )
  }
  const seenIds = new Set<string>()
  return value.map((raw, index): GeometryMeasurementRequest => {
    const field = `measurements[${index}]`
    if (!isRecord(raw)) {
      throw new GeometryMeasurementInputError('invalid_geometry_measurement', `${field} must be an object`)
    }
    if (typeof raw.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(raw.id)) {
      throw new GeometryMeasurementInputError(
        'invalid_geometry_measurement_id',
        `${field}.id must be a stable 1-128 character token`,
      )
    }
    if (seenIds.has(raw.id)) {
      throw new GeometryMeasurementInputError('duplicate_geometry_measurement_id', `Duplicate measurement ID ${raw.id}`)
    }
    seenIds.add(raw.id)
    if (typeof raw.periodic !== 'boolean') {
      throw new GeometryMeasurementInputError(
        'invalid_geometry_measurement_periodicity',
        `${field}.periodic must explicitly state whether minimum-image vectors are required`,
      )
    }
    if (raw.kind === 'distance') {
      exactFields(raw, ['id', 'kind', 'atomIds', 'periodic', 'minimumA', 'maximumA'], field)
      const minimumA = finiteOptional(raw.minimumA, `${field}.minimumA`, 0, 1_000_000)
      const maximumA = finiteOptional(raw.maximumA, `${field}.maximumA`, 0, 1_000_000)
      if (minimumA !== undefined && maximumA !== undefined && minimumA > maximumA) {
        throw new GeometryMeasurementInputError('invalid_geometry_measurement_bound', `${field} minimumA exceeds maximumA`)
      }
      return {
        id: raw.id,
        kind: 'distance',
        atomIds: atomIds(raw.atomIds, 2, `${field}.atomIds`),
        periodic: raw.periodic,
        ...(minimumA === undefined ? {} : { minimumA }),
        ...(maximumA === undefined ? {} : { maximumA }),
      }
    }
    if (raw.kind === 'angle' || raw.kind === 'dihedral') {
      exactFields(raw, ['id', 'kind', 'atomIds', 'periodic', 'minimumDeg', 'maximumDeg'], field)
      const lowerLimit = raw.kind === 'angle' ? 0 : -180
      const minimumDeg = finiteOptional(raw.minimumDeg, `${field}.minimumDeg`, lowerLimit, 180)
      const maximumDeg = finiteOptional(raw.maximumDeg, `${field}.maximumDeg`, lowerLimit, 180)
      if (minimumDeg !== undefined && maximumDeg !== undefined && minimumDeg > maximumDeg) {
        throw new GeometryMeasurementInputError(
          'invalid_geometry_measurement_bound',
          `${field} minimumDeg exceeds maximumDeg`,
        )
      }
      return {
        id: raw.id,
        kind: raw.kind,
        atomIds: atomIds(raw.atomIds, raw.kind === 'angle' ? 3 : 4, `${field}.atomIds`),
        periodic: raw.periodic,
        ...(minimumDeg === undefined ? {} : { minimumDeg }),
        ...(maximumDeg === undefined ? {} : { maximumDeg }),
      }
    }
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement_kind',
      `${field}.kind must be distance, angle, or dihedral`,
    )
  })
}

function subtract(to: readonly number[], from: readonly number[]): Vec3 {
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
}

function add(position: readonly number[], vector: readonly number[]): Vec3 {
  return [position[0] + vector[0], position[1] + vector[1], position[2] + vector[2]]
}

function norm(vector: readonly number[]): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function boundsFor(request: GeometryMeasurementRequest): { minimum?: number; maximum?: number } {
  if (request.kind === 'distance') return { minimum: request.minimumA, maximum: request.maximumA }
  return { minimum: request.minimumDeg, maximum: request.maximumDeg }
}

export function measureStructureGeometry(options: {
  structure: ZatomStructure
  measurements: unknown
  maxMinimumImageCandidates?: number
}): GeometryMeasurementResult {
  const maxMinimumImageCandidates = options.maxMinimumImageCandidates ?? 1_000_000
  if (!Number.isSafeInteger(maxMinimumImageCandidates) || maxMinimumImageCandidates < 1
    || maxMinimumImageCandidates > 10_000_000) {
    throw new GeometryMeasurementInputError(
      'invalid_geometry_measurement_budget',
      'maxMinimumImageCandidates must be an integer in [1, 10000000]',
    )
  }
  const measurements = parseGeometryMeasurements(options.measurements)
  const structureIds = new Set(options.structure.atoms.map((atom) => atom.id))
  if (structureIds.size !== options.structure.atoms.length) {
    throw new GeometryMeasurementInputError('duplicate_atom_ids', 'Geometry measurement requires unique atom IDs')
  }
  const atomById = new Map(options.structure.atoms.map((atom) => [atom.id, atom]))
  const structureFingerprint = fingerprintStructure(options.structure)
  let totalMinimumImageCandidateEvaluations = 0

  const linkVector = (
    from: ZatomStructureAtom,
    to: ZatomStructureAtom,
    periodic: boolean,
  ): Vec3 => {
    const direct = subtract(to.position, from.position)
    if (!periodic) return direct
    if (!options.structure.lattice || !options.structure.lattice.periodic.some(Boolean)) {
      throw new GeometryMeasurementInputError(
        'periodic_lattice_required',
        'A periodic geometry measurement requires a lattice with at least one periodic axis',
      )
    }
    const remaining = maxMinimumImageCandidates - totalMinimumImageCandidateEvaluations
    if (remaining < 1) {
      throw new GeometryMeasurementInputError(
        'geometry_measurement_budget_exceeded',
        `Minimum-image candidate budget ${maxMinimumImageCandidates} is exhausted`,
      )
    }
    try {
      const resolved = certifiedMinimumImageVector(direct, options.structure.lattice, remaining)
      totalMinimumImageCandidateEvaluations += resolved.candidateEvaluations
      return resolved.vector
    } catch (error) {
      throw new GeometryMeasurementInputError(
        'geometry_measurement_minimum_image_unresolved',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const inspectionTargets: InspectionTarget[] = []
  const checks: ValidationCheck[] = [{
    id: 'geometry_measurement.structure_identity',
    status: 'pass',
    message: `Measurements bind exact structure ${structureFingerprint}`,
    metrics: { structureFingerprint, atomCount: options.structure.atoms.length },
  }]
  const results = measurements.map((request): GeometryMeasurementValue => {
    const atoms = request.atomIds.map((atomId) => atomById.get(atomId))
    const missing = request.atomIds.filter((_, index) => !atoms[index])
    if (missing.length) {
      throw new GeometryMeasurementInputError(
        'geometry_measurement_atoms_missing',
        `Measurement ${request.id} references absent atom IDs: ${missing.join(', ')}`,
      )
    }
    const selected = atoms as ZatomStructureAtom[]
    const beforeCandidates = totalMinimumImageCandidateEvaluations
    let unwrappedPositions: Vec3[]
    if (request.kind === 'distance') {
      unwrappedPositions = [selected[0].position, add(selected[0].position, linkVector(selected[0], selected[1], request.periodic))]
    } else if (request.kind === 'angle') {
      const firstToSecond = linkVector(selected[0], selected[1], request.periodic)
      const second = add(selected[0].position, firstToSecond)
      unwrappedPositions = [
        selected[0].position,
        second,
        add(second, linkVector(selected[1], selected[2], request.periodic)),
      ]
      if (norm(subtract(unwrappedPositions[0], unwrappedPositions[1])) < 1e-12
        || norm(subtract(unwrappedPositions[2], unwrappedPositions[1])) < 1e-12) {
        throw new GeometryMeasurementInputError(
          'degenerate_geometry_measurement',
          `Angle ${request.id} is undefined because a vertex vector has zero length`,
        )
      }
    } else {
      const second = add(selected[0].position, linkVector(selected[0], selected[1], request.periodic))
      const third = add(second, linkVector(selected[1], selected[2], request.periodic))
      unwrappedPositions = [
        selected[0].position,
        second,
        third,
        add(third, linkVector(selected[2], selected[3], request.periodic)),
      ]
      const firstBond = subtract(unwrappedPositions[1], unwrappedPositions[0])
      const centerBond = subtract(unwrappedPositions[2], unwrappedPositions[1])
      const lastBond = subtract(unwrappedPositions[3], unwrappedPositions[2])
      if (norm(centerBond) < 1e-12 || norm(cross(firstBond, centerBond)) < 1e-12
        || norm(cross(centerBond, lastBond)) < 1e-12) {
        throw new GeometryMeasurementInputError(
          'degenerate_geometry_measurement',
          `Dihedral ${request.id} is undefined for a zero-length or collinear bond path`,
        )
      }
    }
    const rawValue = request.kind === 'distance'
      ? computeDistance(unwrappedPositions[0], unwrappedPositions[1])
      : request.kind === 'angle'
        ? computeAngle(unwrappedPositions[0], unwrappedPositions[1], unwrappedPositions[2])
        : computeDihedral(unwrappedPositions[0], unwrappedPositions[1], unwrappedPositions[2], unwrappedPositions[3])
    const value = Math.abs(rawValue) < 1e-12 ? 0 : rawValue
    if (!Number.isFinite(value)) {
      throw new GeometryMeasurementInputError('degenerate_geometry_measurement', `Measurement ${request.id} is not finite`)
    }
    const { minimum, maximum } = boundsFor(request)
    const tolerance = 1e-10 * Math.max(1, Math.abs(value), Math.abs(minimum ?? 0), Math.abs(maximum ?? 0))
    const passed = (minimum === undefined || value >= minimum - tolerance)
      && (maximum === undefined || value <= maximum + tolerance)
    const unit = request.kind === 'distance' ? 'angstrom' : 'degree'
    checks.push({
      id: `geometry_measurement.${request.id}`,
      status: passed ? 'pass' : 'fail',
      message: passed
        ? `${request.kind} ${request.id} = ${value.toFixed(8)} ${unit}`
        : `${request.kind} ${request.id} = ${value.toFixed(8)} ${unit} is outside the requested bounds`,
      metrics: {
        value,
        unit,
        periodic: request.periodic,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      },
      atomIds: request.atomIds,
    })
    const rawBounds = boundsOfPositions(selected.map((atom) => atom.position))!
    inspectionTargets.push({
      id: `geometry-measurement-${request.id}`,
      reason: `Inspect ${request.kind} ${request.id}: ${value.toFixed(8)} ${unit}${passed ? '' : ' outside its gate'}`,
      center: rawBounds.center,
      radius: Math.max(1, rawBounds.radius),
      atomIds: request.atomIds,
    })
    return {
      id: request.id,
      kind: request.kind,
      atomIds: request.atomIds,
      periodic: request.periodic,
      value,
      unit,
      ...(minimum === undefined ? {} : { minimum }),
      ...(maximum === undefined ? {} : { maximum }),
      passed,
      unwrappedPositions,
      minimumImageCandidateEvaluations: totalMinimumImageCandidateEvaluations - beforeCandidates,
    }
  })
  checks.push({
    id: 'geometry_measurement.minimum_image_budget',
    status: 'pass',
    message: `Certified periodic vectors used ${totalMinimumImageCandidateEvaluations.toLocaleString()} of ${maxMinimumImageCandidates.toLocaleString()} candidate evaluations`,
    metrics: { totalMinimumImageCandidateEvaluations, maxMinimumImageCandidates },
  })
  const method = {
    engine: 'zatom-geometry-measurement',
    engineVersion: GEOMETRY_MEASUREMENT_VERSION,
    periodicVectorMethod: 'certified-singular-value-bounded-closest-vector',
  } as const
  const fingerprint = fingerprintCanonicalJson({
    structureFingerprint,
    method,
    measurements: results,
    maxMinimumImageCandidates,
  })
  return {
    structureFingerprint,
    fingerprint,
    method,
    measurements: results,
    totalMinimumImageCandidateEvaluations,
    verdict: results.every((measurement) => measurement.passed) ? 'pass' : 'fail',
    checks,
    inspectionTargets,
  }
}
