/** Deterministic periodic crystal construction from one explicit fractional basis. */

import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import { getLatticeVectors } from '../lib/chemistry/lattice'
import type {
  InspectionTarget,
  JsonValue,
  Mat3,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomStructure,
  ZatomStructureAtom,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import {
  boundsOfPositions,
  determinant3,
  fingerprintStructure,
  fractionalToCartesian,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

const MAX_PROJECTED_ATOM_PROPERTY_BYTES = 32 * 1024 * 1024

export interface PeriodicCrystalCellParameters {
  aA: number
  bA: number
  cA: number
  alphaDeg: number
  betaDeg: number
  gammaDeg: number
}

export interface PeriodicCrystalBasisSite {
  id: string
  element: string
  fractionalPosition: Vec3
  properties?: Record<string, JsonValue>
}

export interface BuildPeriodicCrystalOptions {
  label?: string
  cell: PeriodicCrystalCellParameters
  basis: PeriodicCrystalBasisSite[]
  supercell?: [number, number, number]
  minimumPairDistanceA?: number
  maxOutputAtoms?: number
  maxMinimumImageCandidateEvaluations?: number
}

export interface PeriodicCrystalMetrics {
  basisSiteCount: number
  atomCount: number
  supercell: [number, number, number]
  primitiveVolumeA3: number
  resultVolumeA3: number
  primitiveMinimumDistanceA: number | null
  primitiveClosestPair: [string, string] | null
  projectedAtomPropertyBytes: number
}

export interface BuildPeriodicCrystalResult {
  structure: ZatomStructure
  primitiveStructure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  primitiveValidation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  metrics: PeriodicCrystalMetrics
}

export class PeriodicCrystalInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PeriodicCrystalInputError'
    this.code = code
  }
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_parameter', `${field} must be finite and in [${minimum}, ${maximum}]`)
  }
  return Object.is(parsed, -0) ? 0 : parsed
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_parameter', `${field} must be an integer from 1 through ${maximum}`)
  }
  return parsed
}

function canonicalElement(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_element', `${field} must be a known element symbol`)
  }
  const trimmed = value.trim()
  const element = `${trimmed[0].toUpperCase()}${trimmed.slice(1).toLowerCase()}`
  if (symbolToAtomicNumber(element) <= 0) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_element', `${field} must be an element from H through Lr`)
  }
  return element
}

function cellAngle(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 180) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_cell', `${field} must be strictly between 0 and 180 degrees`)
  }
  return parsed
}

function boundedSiteId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || value.includes('\0')) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_site_id', `${field} must be non-empty text of at most 128 characters`)
  }
  return value.trim()
}

function fractionalPosition(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_fractional_position', `${field} must contain three values in [0, 1)`)
  }
  const parsed = value.map((component, axis) => finiteNumber(component, `${field}[${axis}]`, 0, 1)) as Vec3
  if (parsed.some((component) => component >= 1)) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_fractional_position', `${field} components must be smaller than 1; periodic wrapping is never implicit`)
  }
  return parsed
}

function parseCell(value: PeriodicCrystalCellParameters): { cell: PeriodicCrystalCellParameters; vectors: Mat3; volumeA3: number } {
  if (!value || typeof value !== 'object') {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_cell', 'cell is required')
  }
  const cell: PeriodicCrystalCellParameters = {
    aA: finiteNumber(value.aA, 'cell.aA', 1e-6, 1_000_000),
    bA: finiteNumber(value.bA, 'cell.bA', 1e-6, 1_000_000),
    cA: finiteNumber(value.cA, 'cell.cA', 1e-6, 1_000_000),
    alphaDeg: cellAngle(value.alphaDeg, 'cell.alphaDeg'),
    betaDeg: cellAngle(value.betaDeg, 'cell.betaDeg'),
    gammaDeg: cellAngle(value.gammaDeg, 'cell.gammaDeg'),
  }
  const vectors = getLatticeVectors({
    a: cell.aA,
    b: cell.bA,
    c: cell.cA,
    alpha: cell.alphaDeg,
    beta: cell.betaDeg,
    gamma: cell.gammaDeg,
  }) as Mat3
  const volumeA3 = determinant3(vectors)
  if (!vectors.flat().every(Number.isFinite) || !Number.isFinite(volumeA3) || volumeA3 <= 1e-8) {
    throw new PeriodicCrystalInputError(
      'invalid_periodic_crystal_cell',
      'Cell lengths and angles do not define a finite nonsingular right-handed crystallographic cell',
    )
  }
  return { cell, vectors, volumeA3 }
}

function parseBasis(value: PeriodicCrystalBasisSite[]): PeriodicCrystalBasisSite[] {
  if (!Array.isArray(value) || !value.length || value.length > 2_000) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_basis', 'basis must contain 1 through 2,000 explicit sites')
  }
  const ids = new Set<string>()
  return value.map((site, index) => {
    if (!site || typeof site !== 'object') {
      throw new PeriodicCrystalInputError('invalid_periodic_crystal_basis', `basis[${index}] must be an object`)
    }
    const id = boundedSiteId(site.id, `basis[${index}].id`)
    if (ids.has(id)) throw new PeriodicCrystalInputError('duplicate_periodic_crystal_site_id', `basis site ID ${id} is duplicated`)
    ids.add(id)
    if (site.properties !== undefined && (!site.properties || typeof site.properties !== 'object' || Array.isArray(site.properties))) {
      throw new PeriodicCrystalInputError('invalid_periodic_crystal_properties', `basis[${index}].properties must be a JSON object`)
    }
    if (site.properties && Object.keys(site.properties).some((key) => key.startsWith('zatom.crystal.'))) {
      throw new PeriodicCrystalInputError(
        'reserved_periodic_crystal_property',
        `basis[${index}].properties cannot define reserved zatom.crystal.* keys`,
      )
    }
    return {
      id,
      element: canonicalElement(site.element, `basis[${index}].element`),
      fractionalPosition: fractionalPosition(site.fractionalPosition, `basis[${index}].fractionalPosition`),
      ...(site.properties ? { properties: { ...site.properties } } : {}),
    }
  })
}

function scaleVectors(vectors: Mat3, scaling: readonly number[]): Mat3 {
  return vectors.map((row, axis) => row.map((component) => component * scaling[axis]) as Vec3) as Mat3
}

function cellOverviewTarget(structure: ZatomStructure): InspectionTarget {
  const lattice = structure.lattice!
  const center = fractionalToCartesian([0.5, 0.5, 0.5], lattice.vectors)
  let radius = 1
  for (const first of [-0.5, 0.5]) for (const second of [-0.5, 0.5]) for (const third of [-0.5, 0.5]) {
    const corner = fractionalToCartesian([first, second, third], lattice.vectors)
    radius = Math.max(radius, Math.hypot(corner[0], corner[1], corner[2]))
  }
  return {
    id: 'periodic-crystal-cell-overview',
    reason: 'Inspect the complete generated periodic cell, basis replication, and cell boundaries',
    center,
    radius,
    atomIds: structure.atoms.slice(0, 256).map((atom) => atom.id),
    ...(structure.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }
}

function mappedPrimitiveTarget(
  target: InspectionTarget,
  atomByBasisSite: ReadonlyMap<string, ZatomStructureAtom>,
): InspectionTarget | null {
  const atoms = [...new Set(target.atomIds)]
    .map((id) => atomByBasisSite.get(id))
    .filter((atom): atom is ZatomStructureAtom => !!atom)
  if (!atoms.length) return null
  const bounds = boundsOfPositions(atoms.map((atom) => atom.position))!
  return {
    id: 'periodic-crystal-primitive-closest-pair',
    reason: target.reason.replace('atom pair', 'primitive-basis periodic pair'),
    center: bounds.center,
    radius: Math.max(1, bounds.radius + 1),
    atomIds: atoms.map((atom) => atom.id),
  }
}

export function buildPeriodicCrystal(options: BuildPeriodicCrystalOptions): BuildPeriodicCrystalResult {
  const parsedCell = parseCell(options.cell)
  const basis = parseBasis(options.basis)
  if (options.label !== undefined && (
    typeof options.label !== 'string' || !options.label.trim() || options.label.length > 256 || options.label.includes('\0')
  )) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_label', 'label must be non-empty text of at most 256 characters')
  }
  const supercellRaw = options.supercell ?? [1, 1, 1]
  if (!Array.isArray(supercellRaw) || supercellRaw.length !== 3) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_supercell', 'supercell must contain three positive integers')
  }
  const supercell: [number, number, number] = [
    positiveInteger(supercellRaw[0], 'supercell[0]', 256),
    positiveInteger(supercellRaw[1], 'supercell[1]', 256),
    positiveInteger(supercellRaw[2], 'supercell[2]', 256),
  ]
  const minimumPairDistanceA = finiteNumber(options.minimumPairDistanceA ?? 0.35, 'minimumPairDistanceA', 1e-9, 100)
  const maxOutputAtoms = positiveInteger(options.maxOutputAtoms ?? 100_000, 'maxOutputAtoms', 250_000)
  const maxMinimumImageCandidateEvaluations = positiveInteger(
    options.maxMinimumImageCandidateEvaluations ?? 50_000_000,
    'maxMinimumImageCandidateEvaluations',
    200_000_000,
  )
  const repeatCount = supercell[0] * supercell[1] * supercell[2]
  const atomCount = basis.length * repeatCount
  if (!Number.isSafeInteger(atomCount) || atomCount > maxOutputAtoms) {
    throw new PeriodicCrystalInputError(
      'periodic_crystal_atom_budget_exceeded',
      `${basis.length} basis sites × ${supercell.join('×')} repeats produces ${atomCount} atoms above maxOutputAtoms ${maxOutputAtoms}`,
    )
  }

  const primitiveStructure = parseZatomStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: `${options.label?.trim() || 'Periodic crystal'} primitive basis`,
    atoms: basis.map((site) => ({
      id: site.id,
      element: site.element,
      position: fractionalToCartesian(site.fractionalPosition, parsedCell.vectors),
      properties: {
        ...(site.properties ?? {}),
        'zatom.crystal.basisSiteId': site.id,
        'zatom.crystal.basisFractionalPosition': [...site.fractionalPosition],
      },
    })),
    lattice: { vectors: parsedCell.vectors, periodic: [true, true, true] },
    metadata: {
      'zatom.crystal.builder': 'explicit-fractional-basis',
      'zatom.crystal.cellParameters': { ...parsedCell.cell },
      'zatom.crystal.supercell': [1, 1, 1],
    },
  })
  const validationOptions = {
    overlapDistanceA: minimumPairDistanceA,
    closePairWarningA: Math.max(0.6, minimumPairDistanceA),
    maxPairScanAtoms: 2_000,
    maxMinimumImageCandidateEvaluations,
    requirePeriodic: true,
  }
  const primitiveValidation = validateStructure(primitiveStructure, validationOptions)
  const replicatedCellPropertyBytes = new TextEncoder().encode(JSON.stringify(
    primitiveStructure.atoms.map((atom) => ({
      ...(atom.properties ?? {}),
      'zatom.crystal.cellIndex': supercell.map((count) => count - 1),
    })),
  )).length
  const projectedAtomPropertyBytes = replicatedCellPropertyBytes * repeatCount
  if (!Number.isSafeInteger(projectedAtomPropertyBytes) || projectedAtomPropertyBytes > MAX_PROJECTED_ATOM_PROPERTY_BYTES) {
    throw new PeriodicCrystalInputError(
      'periodic_crystal_property_budget_exceeded',
      `Replicated atom properties project to ${projectedAtomPropertyBytes} UTF-8 bytes above the fixed ${MAX_PROJECTED_ATOM_PROPERTY_BYTES}-byte budget`,
    )
  }

  const atoms: ZatomStructureAtom[] = []
  for (let first = 0; first < supercell[0]; first++) {
    for (let second = 0; second < supercell[1]; second++) {
      for (let third = 0; third < supercell[2]; third++) {
        for (const site of basis) {
          const cellIndex: [number, number, number] = [first, second, third]
          atoms.push({
            id: `${site.id}@${cellIndex.join(',')}`,
            element: site.element,
            position: fractionalToCartesian([
              site.fractionalPosition[0] + first,
              site.fractionalPosition[1] + second,
              site.fractionalPosition[2] + third,
            ], parsedCell.vectors),
            properties: {
              ...(site.properties ?? {}),
              'zatom.crystal.basisSiteId': site.id,
              'zatom.crystal.basisFractionalPosition': [...site.fractionalPosition],
              'zatom.crystal.cellIndex': cellIndex,
            },
          })
        }
      }
    }
  }
  const structure = parseZatomStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: options.label?.trim() || 'Periodic crystal from explicit fractional basis',
    atoms,
    lattice: { vectors: scaleVectors(parsedCell.vectors, supercell), periodic: [true, true, true] },
    metadata: {
      'zatom.crystal.builder': 'explicit-fractional-basis',
      'zatom.crystal.cellParameters': { ...parsedCell.cell },
      'zatom.crystal.supercell': [...supercell],
      'zatom.crystal.basisSiteCount': basis.length,
    },
  })
  const validation = validateStructure(structure, validationOptions)
  const primitiveContacts = primitiveValidation.checks.filter((check) => (
    check.id === 'structure.periodic_self_image_distance' || check.id === 'structure.minimum_distance'
  ))
  const primitiveContactStatus = primitiveContacts.some((check) => check.status === 'fail')
    ? 'fail'
    : primitiveContacts.some((check) => check.status === 'warn' || check.status === 'skipped') ? 'warn' : 'pass'
  const resultVolumeA3 = determinant3(structure.lattice!.vectors)
  const checks: ValidationCheck[] = [
    {
      id: 'periodic_crystal.cell',
      status: 'pass',
      message: `Cell parameters define a right-handed ${parsedCell.volumeA3.toFixed(6)} Å³ primitive cell and ${resultVolumeA3.toFixed(6)} Å³ result cell`,
      metrics: { primitiveVolumeA3: parsedCell.volumeA3, resultVolumeA3 },
    },
    {
      id: 'periodic_crystal.basis_identity',
      status: 'pass',
      message: `${basis.length} explicit fractional basis sites have unique stable identities and known elements`,
      metrics: { basisSiteCount: basis.length },
    },
    {
      id: 'periodic_crystal.replication',
      status: 'pass',
      message: `Exact ${supercell.join('×')} replication produced ${atomCount} atoms with stable basis-site and cell-index properties`,
      metrics: { atomCount, repeatCount, maxOutputAtoms, projectedAtomPropertyBytes },
    },
    {
      id: 'periodic_crystal.primitive_contact_equivalence',
      status: primitiveContactStatus,
      message: primitiveContactStatus === 'pass'
        ? `The complete primitive infinite lattice has certified minimum distance ${primitiveValidation.minPairDistanceA?.toFixed(6)} Å; exact supercell replication preserves that contact set`
        : `Primitive infinite-lattice contact validation is ${primitiveContactStatus}; exact supercell replication cannot repair it`,
      metrics: {
        primitiveMinimumDistanceA: primitiveValidation.minPairDistanceA,
        minimumPairDistanceA,
        maxMinimumImageCandidateEvaluations,
      },
      atomIds: primitiveValidation.closestPair
        ? [...new Set(primitiveValidation.closestPair)].map((id) => `${id}@0,0,0`)
        : undefined,
    },
    ...validation.checks,
  ]
  const source: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const changeSet = buildStructureChangeSet(source, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-periodic-basis',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(source),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      cell: { ...parsedCell.cell },
      basis: basis.map((site) => ({
        id: site.id,
        element: site.element,
        fractionalPosition: [...site.fractionalPosition],
        ...(site.properties ? { properties: site.properties } : {}),
      })),
      supercell: [...supercell],
      minimumPairDistanceA,
      maxOutputAtoms,
      projectedAtomPropertyBytes,
      maxMinimumImageCandidateEvaluations,
      primitiveStructureFingerprint: fingerprintStructure(primitiveStructure),
    },
  }
  const atomByBasisSite = new Map<string, ZatomStructureAtom>()
  for (const atom of structure.atoms) {
    if ((atom.properties?.['zatom.crystal.cellIndex'] as JsonValue[] | undefined)?.every((value) => value === 0)) {
      atomByBasisSite.set(String(atom.properties?.['zatom.crystal.basisSiteId']), atom)
    }
  }
  const primitiveTarget = primitiveValidation.inspectionTargets[0]
    ? mappedPrimitiveTarget(primitiveValidation.inspectionTargets[0], atomByBasisSite)
    : null
  const inspectionTargets = [
    cellOverviewTarget(structure),
    ...(primitiveTarget ? [primitiveTarget] : []),
    ...validation.inspectionTargets,
  ]
  return {
    structure,
    primitiveStructure,
    validation,
    primitiveValidation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    metrics: {
      basisSiteCount: basis.length,
      atomCount,
      supercell,
      primitiveVolumeA3: parsedCell.volumeA3,
      resultVolumeA3,
      primitiveMinimumDistanceA: primitiveValidation.minPairDistanceA,
      primitiveClosestPair: primitiveValidation.closestPair,
      projectedAtomPropertyBytes,
    },
  }
}
