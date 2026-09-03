import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import type {
  JsonValue,
  Mat3,
  StructureValidationReport,
  ValidationCheck,
  Vec3,
  ZatomLattice,
  ZatomStructure,
  ZatomStructureAtom,
  ZatomStructureBond,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import {
  boundsOfPositions,
  certifiedShortestPeriodicTranslation,
  createCertifiedMinimumImageCalculator,
  determinant3,
  distance,
} from './structure-math'
import { auditStructureCloseContacts } from './structure-close-contact'

export class ZatomStructureInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomStructureInputError'
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
    throw new ZatomStructureInputError(
      'unsupported_structure_field',
      `${field} contains unsupported field${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`,
    )
  }
}

function jsonValue(value: unknown, field: string, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ZatomStructureInputError('invalid_structure_json', `${field} must be finite`)
    }
    return value
  }
  if (!value || typeof value !== 'object') {
    throw new ZatomStructureInputError('invalid_structure_json', `${field} is not JSON-safe`)
  }
  if (ancestors.has(value)) {
    throw new ZatomStructureInputError('invalid_structure_json', `${field} contains a cycle`)
  }
  const next = new Set(ancestors)
  next.add(value)
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${field}[${index}]`, next))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ZatomStructureInputError('invalid_structure_json', `${field} must be a plain JSON object`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, `${field}.${key}`, next)]))
}

function jsonRecord(value: unknown, field: string): Record<string, JsonValue> {
  if (!isRecord(value)) {
    throw new ZatomStructureInputError('invalid_structure_json', `${field} must be a JSON object`)
  }
  return jsonValue(value, field) as Record<string, JsonValue>
}

function parseVec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new ZatomStructureInputError('invalid_vector', `${field} must contain three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

function parseLattice(value: unknown): ZatomLattice | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ZatomStructureInputError('invalid_lattice', 'structure.lattice must be an object')
  rejectUnsupportedFields(value, ['vectors', 'periodic'], 'structure.lattice')
  const rows = value.vectors
  if (!Array.isArray(rows) || rows.length !== 3) {
    throw new ZatomStructureInputError('invalid_lattice', 'structure.lattice.vectors must contain row vectors a, b, c')
  }
  const periodic = value.periodic
  if (!Array.isArray(periodic) || periodic.length !== 3 || periodic.some((v) => typeof v !== 'boolean')) {
    throw new ZatomStructureInputError('invalid_lattice', 'structure.lattice.periodic must contain three booleans')
  }
  return {
    vectors: rows.map((row, i) => parseVec3(row, `structure.lattice.vectors[${i}]`)) as Mat3,
    periodic: [periodic[0], periodic[1], periodic[2]],
  }
}

/** Parse an unknown MCP payload into the canonical JSON-safe structure shape. */
export function parseZatomStructure(value: unknown): ZatomStructure {
  if (!isRecord(value)) throw new ZatomStructureInputError('invalid_structure', 'structure must be an object')
  if (value.schemaVersion !== ZATOM_STRUCTURE_SCHEMA) {
    throw new ZatomStructureInputError(
      'unsupported_structure_schema',
      `structure.schemaVersion must be "${ZATOM_STRUCTURE_SCHEMA}"`,
    )
  }
  rejectUnsupportedFields(value, ['schemaVersion', 'label', 'atoms', 'bonds', 'lattice', 'metadata'], 'structure')
  if (!Array.isArray(value.atoms) || value.atoms.length === 0) {
    throw new ZatomStructureInputError('empty_structure', 'structure.atoms must be a non-empty array')
  }
  const atoms: ZatomStructureAtom[] = value.atoms.map((raw, index) => {
    if (!isRecord(raw)) throw new ZatomStructureInputError('invalid_atom', `structure.atoms[${index}] must be an object`)
    rejectUnsupportedFields(raw, ['id', 'element', 'position', 'properties'], `structure.atoms[${index}]`)
    if (typeof raw.id !== 'string' || !raw.id.trim()) {
      throw new ZatomStructureInputError('invalid_atom_id', `structure.atoms[${index}].id must be a non-empty string`)
    }
    if (typeof raw.element !== 'string' || !raw.element.trim()) {
      throw new ZatomStructureInputError('invalid_element', `structure.atoms[${index}].element must be a non-empty string`)
    }
    const properties = raw.properties === undefined
      ? undefined
      : jsonRecord(raw.properties, `structure.atoms[${index}].properties`)
    return {
      id: raw.id,
      element: raw.element,
      position: parseVec3(raw.position, `structure.atoms[${index}].position`),
      ...(properties ? { properties } : {}),
    }
  })
  let bonds: ZatomStructureBond[] | undefined
  if (value.bonds !== undefined) {
    if (!Array.isArray(value.bonds)) throw new ZatomStructureInputError('invalid_bonds', 'structure.bonds must be an array when supplied')
    bonds = value.bonds.map((raw, index) => {
      if (!isRecord(raw)) throw new ZatomStructureInputError('invalid_bond', `structure.bonds[${index}] must be an object`)
      rejectUnsupportedFields(raw, ['id', 'atomIds', 'order', 'properties'], `structure.bonds[${index}]`)
      if (typeof raw.id !== 'string' || !raw.id.trim()) {
        throw new ZatomStructureInputError('invalid_bond_id', `structure.bonds[${index}].id must be a non-empty string`)
      }
      if (!Array.isArray(raw.atomIds) || raw.atomIds.length !== 2
        || raw.atomIds.some((id) => typeof id !== 'string' || !id.trim())) {
        throw new ZatomStructureInputError('invalid_bond_atoms', `structure.bonds[${index}].atomIds must contain two non-empty atom IDs`)
      }
      if (raw.order !== 1 && raw.order !== 1.5 && raw.order !== 2 && raw.order !== 3) {
        throw new ZatomStructureInputError('invalid_bond_order', `structure.bonds[${index}].order must be 1, 1.5, 2, or 3`)
      }
      const properties = raw.properties === undefined
        ? undefined
        : jsonRecord(raw.properties, `structure.bonds[${index}].properties`)
      return {
        id: raw.id,
        atomIds: [raw.atomIds[0], raw.atomIds[1]],
        order: raw.order,
        ...(properties ? { properties } : {}),
      }
    })
  }
  if (value.label !== undefined && typeof value.label !== 'string') {
    throw new ZatomStructureInputError('invalid_structure_label', 'structure.label must be a string')
  }
  const metadata = value.metadata === undefined ? undefined : jsonRecord(value.metadata, 'structure.metadata')
  const lattice = parseLattice(value.lattice)
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    ...(bonds ? { bonds } : {}),
    ...(lattice ? { lattice } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    ...(metadata ? { metadata } : {}),
  }
}

export interface ValidateStructureOptions {
  /** Distances below this are a hard overlap failure. Default 0.35 Å. */
  overlapDistanceA?: number
  /** Distances below this but above the failure threshold are warnings. Default 0.60 Å. */
  closePairWarningA?: number
  /** Largest structure receiving an exact all-pairs minimum. Larger structures use a complete cutoff spatial audit. Default 2,000 atoms. */
  maxPairScanAtoms?: number
  /** Hard candidate-pair budget for the large-structure spatial cutoff audit. Default 50,000,000. */
  maxClosePairCandidates?: number
  /** Hard aggregate search budget for exact skew-cell minimum-image and self-image checks. Default 50,000,000. */
  maxMinimumImageCandidateEvaluations?: number
  requirePeriodic?: boolean
}

export function validateStructure(
  structure: ZatomStructure,
  options: ValidateStructureOptions = {},
): StructureValidationReport {
  const overlapDistanceA = Math.max(0, options.overlapDistanceA ?? 0.35)
  const closePairWarningA = Math.max(overlapDistanceA, options.closePairWarningA ?? 0.60)
  const maxPairScanAtoms = Math.max(2, Math.trunc(options.maxPairScanAtoms ?? 2_000))
  const requestedClosePairBudget = options.maxClosePairCandidates ?? 50_000_000
  const maxClosePairCandidates = Number.isFinite(requestedClosePairBudget)
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(requestedClosePairBudget)))
    : 50_000_000
  const requestedMinimumImageBudget = options.maxMinimumImageCandidateEvaluations ?? 50_000_000
  const maxMinimumImageCandidateEvaluations = Number.isFinite(requestedMinimumImageBudget)
    ? Math.max(1, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(requestedMinimumImageBudget)))
    : 50_000_000
  const checks: ValidationCheck[] = []
  const elementCounts: Record<string, number> = {}
  const duplicateIds: string[] = []
  const unknownElementIds: string[] = []
  const invalidCoordinateIds: string[] = []
  const ids = new Set<string>()

  for (const atom of structure.atoms) {
    elementCounts[atom.element] = (elementCounts[atom.element] ?? 0) + 1
    if (ids.has(atom.id)) duplicateIds.push(atom.id)
    ids.add(atom.id)
    if (symbolToAtomicNumber(atom.element) <= 0) unknownElementIds.push(atom.id)
    if (atom.position.some((v) => !Number.isFinite(v))) invalidCoordinateIds.push(atom.id)
  }

  checks.push({
    id: 'structure.non_empty',
    status: structure.atoms.length ? 'pass' : 'fail',
    message: structure.atoms.length ? `${structure.atoms.length} atoms present` : 'Structure contains no atoms',
    metrics: { atomCount: structure.atoms.length },
  })

  if (structure.bonds === undefined) {
    checks.push({ id: 'structure.explicit_bond_topology', status: 'skipped', message: 'No explicit bond topology supplied' })
  } else {
    const bondIds = new Set<string>()
    const duplicateBondIds: string[] = []
    const missingEndpointBonds: string[] = []
    const missingEndpointAtomIds = new Set<string>()
    const selfBonds: string[] = []
    const duplicatePairs: string[] = []
    const pairs = new Set<string>()
    const supportedOrders: string[] = []
    for (const bond of structure.bonds) {
      if (bondIds.has(bond.id)) duplicateBondIds.push(bond.id)
      bondIds.add(bond.id)
      if (!ids.has(bond.atomIds[0]) || !ids.has(bond.atomIds[1])) {
        missingEndpointBonds.push(bond.id)
        for (const atomId of bond.atomIds) if (!ids.has(atomId)) missingEndpointAtomIds.add(atomId)
      }
      if (bond.atomIds[0] === bond.atomIds[1]) selfBonds.push(bond.id)
      const pair = [...bond.atomIds].sort().join('\u0000')
      if (pairs.has(pair)) duplicatePairs.push(bond.id)
      pairs.add(pair)
      if (bond.order !== 1 && bond.order !== 1.5 && bond.order !== 2 && bond.order !== 3) supportedOrders.push(bond.id)
    }
    checks.push({
      id: 'structure.bond_ids_unique',
      status: duplicateBondIds.length ? 'fail' : 'pass',
      message: duplicateBondIds.length ? `${duplicateBondIds.length} duplicate bond IDs` : `Every explicit bond ID is unique (${structure.bonds.length} bonds)`,
    })
    checks.push({
      id: 'structure.bond_endpoints_present',
      status: missingEndpointBonds.length ? 'fail' : 'pass',
      message: missingEndpointBonds.length ? `${missingEndpointBonds.length} bonds reference absent atoms` : 'Every explicit bond endpoint is present',
      atomIds: [...missingEndpointAtomIds].slice(0, 20),
    })
    checks.push({
      id: 'structure.bond_pairs_valid',
      status: selfBonds.length || duplicatePairs.length ? 'fail' : 'pass',
      message: selfBonds.length || duplicatePairs.length
        ? `${selfBonds.length} self-bonds and ${duplicatePairs.length} duplicate atom pairs`
        : 'Explicit bonds contain no self-bonds or duplicate atom pairs',
    })
    checks.push({
      id: 'structure.bond_orders_supported',
      status: supportedOrders.length ? 'fail' : 'pass',
      message: supportedOrders.length ? `${supportedOrders.length} unsupported bond orders` : 'Every explicit bond order is supported',
    })
  }
  checks.push({
    id: 'structure.atom_ids_unique',
    status: duplicateIds.length ? 'fail' : 'pass',
    message: duplicateIds.length ? `${duplicateIds.length} duplicate atom IDs` : 'Every atom ID is unique',
    atomIds: duplicateIds.slice(0, 20),
  })
  checks.push({
    id: 'structure.coordinates_finite',
    status: invalidCoordinateIds.length ? 'fail' : 'pass',
    message: invalidCoordinateIds.length ? `${invalidCoordinateIds.length} atoms have non-finite coordinates` : 'Every Cartesian coordinate is finite',
    atomIds: invalidCoordinateIds.slice(0, 20),
  })
  checks.push({
    id: 'structure.elements_known',
    status: unknownElementIds.length ? 'warn' : 'pass',
    message: unknownElementIds.length ? `${unknownElementIds.length} atoms use unknown element symbols` : 'Every element symbol is in Z=1..103',
    atomIds: unknownElementIds.slice(0, 20),
  })

  let latticeUsable = true
  if (structure.lattice) {
    const det = determinant3(structure.lattice.vectors)
    latticeUsable = Number.isFinite(det) && det > 1e-8
    checks.push({
      id: 'structure.lattice_nonsingular',
      status: latticeUsable ? 'pass' : 'fail',
      message: latticeUsable ? `Right-handed lattice volume is ${det.toFixed(6)} Å³` : 'Lattice vectors must be finite, nonsingular, and right-handed',
      metrics: { signedVolumeA3: Number.isFinite(det) ? det : null },
    })
  } else if (options.requirePeriodic) {
    latticeUsable = false
    checks.push({ id: 'structure.periodic_lattice', status: 'fail', message: 'This operation requires a periodic lattice' })
  } else {
    checks.push({ id: 'structure.periodic_lattice', status: 'skipped', message: 'No lattice supplied; validating as a non-periodic structure' })
  }

  const finitePositions = structure.atoms
    .filter((atom) => atom.position.every(Number.isFinite))
    .map((atom) => atom.position)
  const bounds = boundsOfPositions(finitePositions)
  let minPairDistanceA: number | null = null
  let closestPair: [string, string] | null = null
  let closestVector: Vec3 | null = null
  let closestPairKind: 'distinct-atoms' | 'periodic-self-image' | null = null
  let closestFractionalImage: [number, number, number] | null = null
  let minimumImageCandidateEvaluations = 0
  let periodicSelfImage: ReturnType<typeof certifiedShortestPeriodicTranslation> = null
  const hasPeriodicAxes = !!structure.lattice?.periodic.some(Boolean)

  if (!hasPeriodicAxes) {
    checks.push({
      id: 'structure.periodic_self_image_distance',
      status: 'skipped',
      message: 'No periodic lattice axes require a self-image contact check',
    })
  } else if (!latticeUsable) {
    checks.push({
      id: 'structure.periodic_self_image_distance',
      status: 'fail',
      message: 'Periodic self-image contact could not be resolved because the lattice is invalid',
    })
  } else {
    try {
      periodicSelfImage = certifiedShortestPeriodicTranslation(
        structure.lattice!,
        maxMinimumImageCandidateEvaluations,
      )
      if (!periodicSelfImage) throw new Error('No periodic translation was returned')
      minimumImageCandidateEvaluations += periodicSelfImage.candidateEvaluations
      const status = periodicSelfImage.distance < overlapDistanceA
        ? 'fail'
        : periodicSelfImage.distance < closePairWarningA ? 'warn' : 'pass'
      checks.push({
        id: 'structure.periodic_self_image_distance',
        status,
        message: `Shortest certified periodic self-image translation is ${periodicSelfImage.distance.toFixed(4)} Å`,
        metrics: {
          distanceA: periodicSelfImage.distance,
          fractionalImage: periodicSelfImage.fractionalImage.join(','),
          candidateEvaluations: periodicSelfImage.candidateEvaluations,
          overlapDistanceA,
          closePairWarningA,
        },
        atomIds: structure.atoms.length ? [structure.atoms[0].id] : undefined,
      })
    } catch (error) {
      checks.push({
        id: 'structure.periodic_self_image_distance',
        status: 'fail',
        message: `Certified periodic self-image contact is unresolved: ${error instanceof Error ? error.message : String(error)}`,
        metrics: { maxMinimumImageCandidateEvaluations },
      })
    }
  }

  if (invalidCoordinateIds.length || !latticeUsable) {
    checks.push({ id: 'structure.minimum_distance', status: 'skipped', message: 'Pair scan skipped because coordinates or lattice are invalid' })
  } else if (structure.atoms.length > maxPairScanAtoms) {
    if (closePairWarningA <= 0) {
      checks.push({
        id: 'structure.minimum_distance',
        status: 'pass',
        message: 'Close-contact thresholds are zero; no non-negative distance can violate them',
        metrics: {
          atomCount: structure.atoms.length,
          maxPairScanAtoms,
          scanMode: 'complete-spatial-threshold',
          distanceLowerBoundA: 0,
          coverageComplete: true,
        },
      })
    } else {
      try {
        const remainingMinimumImageBudget = maxMinimumImageCandidateEvaluations - minimumImageCandidateEvaluations
        if (hasPeriodicAxes && remainingMinimumImageBudget < 1) {
          throw new Error(`Aggregate certified minimum-image budget ${maxMinimumImageCandidateEvaluations} was exhausted`)
        }
        const audit = auditStructureCloseContacts(structure, {
          cutoffA: closePairWarningA,
          violationFloorA: overlapDistanceA,
          maxPairCandidates: maxClosePairCandidates,
          maxMinimumImageCandidateEvaluations: Math.max(1, remainingMinimumImageBudget),
          precomputedPeriodicSelfImage: periodicSelfImage,
        })
        minimumImageCandidateEvaluations += audit.minimumImageCandidateEvaluations
        minPairDistanceA = audit.minimumDistanceA
        closestVector = audit.closestVector
        if (audit.closestPair) {
          closestPair = [
            structure.atoms[audit.closestPair[0]].id,
            structure.atoms[audit.closestPair[1]].id,
          ]
          closestPairKind = audit.closestPair[0] === audit.closestPair[1]
            ? 'periodic-self-image'
            : 'distinct-atoms'
        }
        const status = minPairDistanceA !== null && minPairDistanceA < overlapDistanceA
          ? 'fail'
          : minPairDistanceA !== null && minPairDistanceA < closePairWarningA ? 'warn' : 'pass'
        checks.push({
          id: 'structure.minimum_distance',
          status,
          message: minPairDistanceA === null
            ? `Complete spatial audit certifies no atom pair below ${closePairWarningA.toFixed(4)} Å`
            : `Closest ${closestPairKind === 'periodic-self-image' ? 'periodic self-image pair' : 'atom pair'} within the audited cutoff is ${minPairDistanceA.toFixed(4)} Å`,
          metrics: {
            minPairDistanceA,
            distanceLowerBoundA: audit.distanceLowerBoundA,
            overlapDistanceA,
            closePairWarningA,
            pairEvaluations: audit.pairCandidates,
            maxClosePairCandidates,
            minimumImageCandidateEvaluations,
            maxMinimumImageCandidateEvaluations,
            maxPairScanAtoms,
            scanMode: 'complete-spatial-threshold',
            coverageComplete: true,
            closestPairKind: closestPairKind ?? 'none',
          },
          atomIds: closestPair ? [...closestPair] : undefined,
        })
      } catch (error) {
        checks.push({
          id: 'structure.minimum_distance',
          status: 'fail',
          message: `Large-structure close-contact audit is unresolved: ${error instanceof Error ? error.message : String(error)}`,
          metrics: {
            atomCount: structure.atoms.length,
            maxPairScanAtoms,
            maxClosePairCandidates,
            minimumImageCandidateEvaluations,
            maxMinimumImageCandidateEvaluations,
            scanMode: 'spatial-threshold',
            coverageComplete: false,
          },
        })
      }
    }
  } else {
    let best = periodicSelfImage?.distance ?? Infinity
    if (periodicSelfImage && structure.atoms.length) {
      closestPair = [structure.atoms[0].id, structure.atoms[0].id]
      closestVector = periodicSelfImage.vector
      closestPairKind = 'periodic-self-image'
      closestFractionalImage = periodicSelfImage.fractionalImage
    }
    let scanError: string | null = null
    let pairEvaluations = 0
    const certifiedDistance = hasPeriodicAxes && structure.lattice
      ? createCertifiedMinimumImageCalculator(structure.lattice)
      : null
    try {
      for (let i = 0; i < structure.atoms.length; i++) {
        for (let j = i + 1; j < structure.atoms.length; j++) {
          pairEvaluations += 1
          const direct: Vec3 = [
            structure.atoms[j].position[0] - structure.atoms[i].position[0],
            structure.atoms[j].position[1] - structure.atoms[i].position[1],
            structure.atoms[j].position[2] - structure.atoms[i].position[2],
          ]
          let vector = direct
          let d: number
          let fractionalImage: [number, number, number] | null = null
          if (certifiedDistance) {
            const remaining = maxMinimumImageCandidateEvaluations - minimumImageCandidateEvaluations
            if (remaining < 1) {
              throw new Error(`Aggregate certified minimum-image budget ${maxMinimumImageCandidateEvaluations} was exhausted`)
            }
            const resolved = certifiedDistance(direct, remaining)
            minimumImageCandidateEvaluations += resolved.candidateEvaluations
            vector = resolved.vector
            d = resolved.distance
            fractionalImage = resolved.fractionalImage
          } else {
            d = distance(structure.atoms[i].position, structure.atoms[j].position)
          }
          if (d < best) {
            best = d
            closestPair = [structure.atoms[i].id, structure.atoms[j].id]
            closestVector = vector
            closestPairKind = 'distinct-atoms'
            closestFractionalImage = fractionalImage
          }
        }
      }
    } catch (error) {
      scanError = error instanceof Error ? error.message : String(error)
    }
    minPairDistanceA = !scanError && Number.isFinite(best) ? best : null
    const status = scanError
      ? 'fail'
      : minPairDistanceA === null ? 'skipped'
        : minPairDistanceA < overlapDistanceA ? 'fail'
          : minPairDistanceA < closePairWarningA ? 'warn' : 'pass'
    checks.push({
      id: 'structure.minimum_distance',
      status,
      message: scanError
        ? `Certified minimum-distance scan is unresolved: ${scanError}`
        : minPairDistanceA === null
        ? 'No atom pair was available for a distance check'
        : `Closest ${closestPairKind === 'periodic-self-image' ? 'periodic self-image pair' : 'atom pair'} is ${minPairDistanceA.toFixed(4)} Å`,
      metrics: {
        minPairDistanceA,
        overlapDistanceA,
        closePairWarningA,
        pairEvaluations,
        minimumImageCandidateEvaluations,
        maxMinimumImageCandidateEvaluations,
        closestPairKind: closestPairKind ?? 'none',
        closestFractionalImage: closestFractionalImage?.join(',') ?? null,
      },
      atomIds: closestPair ? [...closestPair] : undefined,
    })
  }

  const inspectionTargets: StructureValidationReport['inspectionTargets'] = []
  if (closestPair && minPairDistanceA !== null && minPairDistanceA < closePairWarningA) {
    const a = structure.atoms.find((atom) => atom.id === closestPair![0])!
    const targetAtomIds = closestPairKind === 'periodic-self-image' ? [a.id] : [...closestPair]
    inspectionTargets.push({
      id: 'closest-pair',
      reason: closestPairKind === 'periodic-self-image'
        ? `Inspect the site whose nearest periodic copy is ${minPairDistanceA.toFixed(4)} Å away`
        : `Inspect the closest atom pair (${minPairDistanceA.toFixed(4)} Å)`,
      center: closestVector
        ? [
            a.position[0] + closestVector[0] / 2,
            a.position[1] + closestVector[1] / 2,
            a.position[2] + closestVector[2] / 2,
          ] as Vec3
        : [...a.position],
      radius: Math.max(1, minPairDistanceA * 2),
      atomIds: targetAtomIds,
    })
  }

  const verdict = checks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.some((check) => check.status === 'warn')
      ? 'warn'
      : 'pass'

  return {
    verdict,
    checks,
    atomCount: structure.atoms.length,
    bondCount: structure.bonds?.length ?? null,
    elementCounts,
    bounds,
    minPairDistanceA,
    closestPair,
    inspectionTargets,
  }
}
