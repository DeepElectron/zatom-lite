/** Deterministic lattice-compatible polarization-domain-wall geometry from two explicit endpoint domains. */

import type {
  InspectionTarget,
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
  canonicalJsonIdentity,
  cartesianToFractional,
  createCertifiedMinimumImageCalculator,
  determinant3,
  fingerprintStructure,
  fractionalToCartesian,
} from './structure-math'
import {
  auditStructureCloseContacts,
  type StructureCloseContactAudit,
} from './structure-close-contact'
import { parseZatomStructure, validateStructure } from './structure-validation'

export const ZATOM_POLARIZATION_DOMAIN_WALL_METADATA_SCHEMA = 'zatom.polarization-domain-wall/v1' as const
export const ZATOM_DOMAIN_WALL_SOURCE_ATOM_ID_PROPERTY = 'zatom.polarizationDomainWall.sourceAtomId' as const
export const ZATOM_DOMAIN_WALL_CELL_INDEX_PROPERTY = 'zatom.polarizationDomainWall.cellIndex' as const
export const ZATOM_DOMAIN_WALL_WEIGHT_B_PROPERTY = 'zatom.polarizationDomainWall.domainBWeight' as const
export const ZATOM_DOMAIN_WALL_SEGMENT_PROPERTY = 'zatom.polarizationDomainWall.segment' as const

export type PolarizationDomainWallAxis = 'a' | 'b' | 'c'
export type PolarizationDomainWallBoundaryMode = 'periodic-pair' | 'finite-single'
export type PolarizationDomainWallElectrostaticClass = 'neutral' | 'charged'
export type PolarizationDomainWallSegment = 'domain-a' | 'a-to-b' | 'domain-b' | 'b-to-a'

const AXIS_INDEX: Record<PolarizationDomainWallAxis, 0 | 1 | 2> = { a: 0, b: 1, c: 2 }
const MAX_ENDPOINT_ATOMS = 10_000
const MAX_OUTPUT_ATOMS = 500_000
const MAX_PROPERTY_BYTES = 32 * 1024 * 1024
const MAX_CONTACT_PAIR_CANDIDATES = 50_000_000
const MAX_MINIMUM_IMAGE_CANDIDATES = 50_000_000
const LATTICE_MATCH_TOLERANCE_A = 1e-7
const RESERVED_PROPERTY_PREFIX = 'zatom.polarizationDomainWall.'

export class ZatomPolarizationDomainWallInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPolarizationDomainWallInputError'
    this.code = code
  }
}

export interface BuildPolarizationDomainWallOptions {
  domainA: ZatomStructure
  domainB: ZatomStructure
  polarizationA_CPerM2: Vec3
  polarizationB_CPerM2: Vec3
  stackingAxis: PolarizationDomainWallAxis
  boundaryMode: PolarizationDomainWallBoundaryMode
  expectedElectrostaticClass: PolarizationDomainWallElectrostaticClass
  domainACells?: number
  domainBCells?: number
  transitionCells?: number
  neutralToleranceCPerM2?: number
  maximumEndpointDisplacementA?: number
  minimumPairDistanceA?: number
  closePairWarningA?: number
  surfacePaddingA?: number
  maxOutputAtoms?: number
  label?: string
}

export interface PolarizationDomainWallCellProfile {
  cellIndex: number
  domainBWeight: number
  segment: PolarizationDomainWallSegment
}

export interface PolarizationDomainWallMetrics {
  endpointAtomCount: number
  outputAtomCount: number
  cellCount: number
  wallCount: number
  wallAreaA2: number
  layerHeightA: number
  transitionWidthA: number
  polarizationAngleDeg: number
  boundChargeAB_CPerM2: number
  electrostaticClass: PolarizationDomainWallElectrostaticClass
  maximumEndpointDisplacementA: number
  endpointImageTieCount: number
  contactMinimumDistanceA: number | null
  contactDistanceLowerBoundA: number
  contactPairCandidates: number
  minimumImageCandidateEvaluations: number
  projectedAtomPropertyBytes: number
}

export interface BuildPolarizationDomainWallResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  metrics: PolarizationDomainWallMetrics
  profile: PolarizationDomainWallCellProfile[]
  limitations: string[]
}

interface AlignedEndpointAtom {
  source: ZatomStructureAtom
  canonicalA: Vec3
  displacementToB: Vec3
  displacementA: number
  fractionalDisplacement: Vec3
}

function finite(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must be finite from ${minimum} through ${maximum}`,
    )
  }
  return Object.is(parsed, -0) ? 0 : parsed
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must be an integer from ${minimum} through ${maximum}`,
    )
  }
  return parsed
}

function vector(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3
    || value.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must contain three finite Cartesian components`,
    )
  }
  const parsed: Vec3 = [value[0], value[1], value[2]]
  if (Math.hypot(...parsed) <= 1e-12) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must have non-zero magnitude`,
    )
  }
  return parsed
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function cross(left: readonly number[], right: readonly number[]): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ]
}

function normalize(value: readonly number[]): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2])
  return [value[0] / length, value[1] / length, value[2] / length]
}

function scaleVector(value: readonly number[], scale: number): Vec3 {
  return [value[0] * scale, value[1] * scale, value[2] * scale]
}

function add(left: readonly number[], right: readonly number[]): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}

function scaleLatticeAxis(vectors: Mat3, axis: number, scale: number): Mat3 {
  return vectors.map((row, index) => (
    index === axis ? scaleVector(row, scale) : [...row] as Vec3
  )) as Mat3
}

function assertEndpointStructure(value: ZatomStructure, field: string): ZatomStructure {
  const structure = parseZatomStructure(value)
  if (!structure.lattice || !structure.lattice.periodic.every(Boolean)) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_periodic_endpoint_required',
      `${field} must have a fully periodic lattice`,
    )
  }
  const volumeA3 = determinant3(structure.lattice.vectors)
  if (!Number.isFinite(volumeA3) || volumeA3 <= 1e-8) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_endpoint',
      `${field} lattice must be finite, nonsingular, and right-handed`,
    )
  }
  if (structure.atoms.length > MAX_ENDPOINT_ATOMS) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_endpoint_budget_exceeded',
      `${field} has ${structure.atoms.length.toLocaleString()} atoms above the ${MAX_ENDPOINT_ATOMS.toLocaleString()}-site endpoint limit`,
    )
  }
  if (structure.bonds?.length) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_explicit_bonds_unsupported',
      `${field} has explicit bonds; crystalline cross-cell bonding cannot be replicated without a complete periodic topology`,
    )
  }
  const ids = new Set<string>()
  for (const atom of structure.atoms) {
    if (ids.has(atom.id)) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_endpoint_identity_mismatch',
        `${field} repeats atom ID ${atom.id}`,
      )
    }
    ids.add(atom.id)
    const reserved = Object.keys(atom.properties ?? {}).find((key) => key.startsWith(RESERVED_PROPERTY_PREFIX))
    if (reserved) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_reserved_property',
        `${field} atom ${atom.id} already defines reserved property ${reserved}`,
      )
    }
  }
  return structure
}

function latticeMismatchA(left: Mat3, right: Mat3): number {
  let maximum = 0
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    maximum = Math.max(maximum, Math.abs(left[row][column] - right[row][column]))
  }
  return maximum
}

function alignEndpointAtoms(domainA: ZatomStructure, domainB: ZatomStructure): {
  atoms: AlignedEndpointAtom[]
  maximumDisplacementA: number
  maximumDisplacementAtomId: string
  endpointImageTieCount: number
  minimumImageCandidateEvaluations: number
} {
  if (domainA.atoms.length !== domainB.atoms.length) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_endpoint_identity_mismatch',
      `Endpoint atom counts differ (${domainA.atoms.length} versus ${domainB.atoms.length})`,
    )
  }
  const mismatchA = latticeMismatchA(domainA.lattice!.vectors, domainB.lattice!.vectors)
  if (mismatchA > LATTICE_MATCH_TOLERANCE_A) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_lattice_mismatch',
      `Endpoint lattices differ by up to ${mismatchA.toExponential(6)} Å; this builder requires one lattice-compatible wall cell`,
    )
  }
  const byId = new Map(domainB.atoms.map((atom) => [atom.id, atom]))
  const exactMinimumImage = createCertifiedMinimumImageCalculator(domainA.lattice!)
  let maximumDisplacementA = -1
  let maximumDisplacementAtomId = domainA.atoms[0].id
  let endpointImageTieCount = 0
  let minimumImageCandidateEvaluations = 0
  const atoms = domainA.atoms.map((source): AlignedEndpointAtom => {
    const target = byId.get(source.id)
    if (!target) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_endpoint_identity_mismatch',
        `domainB is missing atom ID ${source.id}`,
      )
    }
    if (source.element !== target.element) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_endpoint_identity_mismatch',
        `Atom ${source.id} changes element from ${source.element} to ${target.element}`,
      )
    }
    if (canonicalJsonIdentity(source.properties ?? null) !== canonicalJsonIdentity(target.properties ?? null)) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_endpoint_property_mismatch',
        `Atom ${source.id} has different endpoint properties; non-geometric state interpolation is not defined`,
      )
    }
    const fractionalA = cartesianToFractional(source.position, domainA.lattice!.vectors)!
    const fractionalB = cartesianToFractional(target.position, domainA.lattice!.vectors)!
    const wrappedA = fractionalA.map((component) => component - Math.floor(component)) as Vec3
    const wrappedB = fractionalB.map((component) => component - Math.floor(component)) as Vec3
    const canonicalA = fractionalToCartesian(wrappedA, domainA.lattice!.vectors)
    const canonicalB = fractionalToCartesian(wrappedB, domainA.lattice!.vectors)
    const remaining = MAX_MINIMUM_IMAGE_CANDIDATES - minimumImageCandidateEvaluations
    if (remaining < 1) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_image_budget_exceeded',
        'Endpoint minimum-image alignment exhausted its fixed candidate budget',
      )
    }
    let resolved: ReturnType<typeof exactMinimumImage>
    try {
      resolved = exactMinimumImage([
        canonicalB[0] - canonicalA[0],
        canonicalB[1] - canonicalA[1],
        canonicalB[2] - canonicalA[2],
      ], remaining)
    } catch (error) {
      throw new ZatomPolarizationDomainWallInputError(
        'polarization_domain_wall_image_budget_exceeded',
        `Endpoint image alignment failed for ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    minimumImageCandidateEvaluations += resolved.candidateEvaluations
    const fractionalDisplacement = cartesianToFractional(resolved.vector, domainA.lattice!.vectors)!
    if (fractionalDisplacement.some((component) => Math.abs(Math.abs(component) - 0.5) <= 1e-10)) {
      endpointImageTieCount += 1
    }
    if (resolved.distance > maximumDisplacementA) {
      maximumDisplacementA = resolved.distance
      maximumDisplacementAtomId = source.id
    }
    return {
      source,
      canonicalA,
      displacementToB: resolved.vector,
      displacementA: resolved.distance,
      fractionalDisplacement,
    }
  })
  if (byId.size !== atoms.length) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_endpoint_identity_mismatch',
      'domainB contains atom identities that are absent from domainA',
    )
  }
  return {
    atoms,
    maximumDisplacementA,
    maximumDisplacementAtomId,
    endpointImageTieCount,
    minimumImageCandidateEvaluations,
  }
}

function buildProfile(
  boundaryMode: PolarizationDomainWallBoundaryMode,
  domainACells: number,
  domainBCells: number,
  transitionCells: number,
): PolarizationDomainWallCellProfile[] {
  const profile: PolarizationDomainWallCellProfile[] = []
  const append = (domainBWeight: number, segment: PolarizationDomainWallSegment): void => {
    profile.push({ cellIndex: profile.length, domainBWeight, segment })
  }
  for (let index = 0; index < domainACells; index++) append(0, 'domain-a')
  for (let index = 0; index < transitionCells; index++) append((index + 1) / (transitionCells + 1), 'a-to-b')
  for (let index = 0; index < domainBCells; index++) append(1, 'domain-b')
  if (boundaryMode === 'periodic-pair') {
    for (let index = 0; index < transitionCells; index++) append(1 - (index + 1) / (transitionCells + 1), 'b-to-a')
  }
  return profile
}

function axisNormal(vectors: Mat3, axis: 0 | 1 | 2): { normal: Vec3; areaA2: number; layerHeightA: number } {
  const first = vectors[(axis + 1) % 3]
  const second = vectors[(axis + 2) % 3]
  const areaVector = cross(first, second)
  const areaA2 = Math.hypot(...areaVector)
  const normal = normalize(areaVector)
  const layerHeightA = dot(vectors[axis], normal)
  if (!Number.isFinite(layerHeightA) || layerHeightA <= 1e-10) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_endpoint',
      'Stacking-axis layer height is not finite and positive',
    )
  }
  return { normal, areaA2, layerHeightA }
}

function auditDomainWallContacts(
  structure: ZatomStructure,
  cutoffA: number,
  violationFloorA: number,
): StructureCloseContactAudit {
  try {
    return auditStructureCloseContacts(structure, {
      cutoffA,
      violationFloorA,
      maxPairCandidates: MAX_CONTACT_PAIR_CANDIDATES,
      maxMinimumImageCandidateEvaluations: MAX_MINIMUM_IMAGE_CANDIDATES,
    })
  } catch (error) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_contact_budget_exceeded',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function contactCheck(
  id: string,
  subject: string,
  audit: StructureCloseContactAudit,
  minimumPairDistanceA: number,
  closePairWarningA: number,
  structure: ZatomStructure,
): ValidationCheck {
  const minimum = audit.minimumDistanceA
  const status = audit.selfImageViolation || audit.distinctPairViolations > 0
    ? 'fail'
    : minimum !== null && minimum < closePairWarningA ? 'warn' : 'pass'
  const message = minimum === null
    ? `${subject} has no certified atom or self-image contact below ${closePairWarningA} Å`
    : `${subject} closest audited contact is ${minimum.toFixed(6)} Å against ${minimumPairDistanceA} Å floor`
  return {
    id,
    status,
    message,
    metrics: {
      minimumDistanceA: minimum,
      certifiedDistanceLowerBoundA: audit.distanceLowerBoundA,
      minimumPairDistanceA,
      closePairWarningA,
      distinctPairViolations: audit.distinctPairViolations,
      selfImageViolation: audit.selfImageViolation,
      pairCandidates: audit.pairCandidates,
      minimumImageCandidateEvaluations: audit.minimumImageCandidateEvaluations,
    },
    atomIds: audit.closestPair
      ? [...new Set(audit.closestPair.map((index) => structure.atoms[index].id))]
      : undefined,
  }
}

function profileWallCoordinates(
  boundaryMode: PolarizationDomainWallBoundaryMode,
  domainACells: number,
  domainBCells: number,
  transitionCells: number,
): number[] {
  const first = domainACells + transitionCells / 2
  if (boundaryMode === 'finite-single') return [first]
  return [first, domainACells + transitionCells + domainBCells + transitionCells / 2]
}

function selectedCellAtomIds(structure: ZatomStructure, cells: ReadonlySet<number>, maximum = 256): string[] {
  const result: string[] = []
  for (const atom of structure.atoms) {
    if (cells.has(Number(atom.properties?.[ZATOM_DOMAIN_WALL_CELL_INDEX_PROPERTY]))) result.push(atom.id)
    if (result.length >= maximum) break
  }
  return result
}

function buildInspectionTargets(options: {
  structure: ZatomStructure
  profile: PolarizationDomainWallCellProfile[]
  wallCoordinates: number[]
  boundaryMode: PolarizationDomainWallBoundaryMode
  axis: 0 | 1 | 2
  normalShiftCells: number
  normalSpanCells: number
  maximumDisplacementAtomId: string
  outputContact: StructureCloseContactAudit
}): InspectionTarget[] {
  const { structure, profile, wallCoordinates, boundaryMode, axis } = options
  const targets: InspectionTarget[] = []
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))!
  targets.push({
    id: 'polarization-domain-wall-overview',
    reason: 'Inspect the complete unrelaxed polarization-domain-wall geometry and declared cell boundaries',
    center: bounds.center,
    radius: Math.max(1, bounds.radius),
    atomIds: structure.atoms.slice(0, 256).map((atom) => atom.id),
    ...(structure.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  })
  for (let wallIndex = 0; wallIndex < wallCoordinates.length; wallIndex++) {
    const rawCoordinate = wallCoordinates[wallIndex]
    const coordinate = boundaryMode === 'periodic-pair'
      ? ((rawCoordinate % profile.length) + profile.length) % profile.length
      : rawCoordinate + options.normalShiftCells
    const fractional: Vec3 = [0.5, 0.5, 0.5]
    fractional[axis] = boundaryMode === 'periodic-pair'
      ? coordinate / profile.length
      : coordinate / options.normalSpanCells
    const relevantCells = new Set<number>()
    for (const cell of profile) {
      const direct = Math.abs(cell.cellIndex + 0.5 - rawCoordinate)
      const separation = boundaryMode === 'periodic-pair'
        ? Math.min(direct, Math.abs(direct - profile.length), Math.abs(direct + profile.length))
        : direct
      if (separation <= 1 + profile.filter((item) => item.segment === 'a-to-b').length / 2) {
        relevantCells.add(cell.cellIndex)
      }
    }
    const atomIds = selectedCellAtomIds(structure, relevantCells)
    targets.push({
      id: `polarization-domain-wall-${String(wallIndex + 1).padStart(2, '0')}`,
      reason: `Inspect wall ${wallIndex + 1}/${wallCoordinates.length}, its transition cells, and cross-wall contacts`,
      center: fractionalToCartesian(fractional, structure.lattice!.vectors),
      radius: Math.max(2, bounds.radius / 3),
      atomIds,
      ...(relevantCells.size * (structure.atoms.length / profile.length) > atomIds.length ? { atomIdsTruncated: true } : {}),
    })
  }
  for (const segment of ['domain-a', 'domain-b'] as const) {
    const cells = profile.filter((item) => item.segment === segment)
    const representative = cells[Math.floor(cells.length / 2)]
    const atomIds = selectedCellAtomIds(structure, new Set([representative.cellIndex]))
    const atoms = atomIds.map((id) => structure.atoms.find((atom) => atom.id === id)!).filter(Boolean)
    const localBounds = boundsOfPositions(atoms.map((atom) => atom.position))!
    targets.push({
      id: `polarization-domain-wall-${segment}`,
      reason: `Inspect a representative unchanged ${segment === 'domain-a' ? 'A' : 'B'} plateau cell`,
      center: localBounds.center,
      radius: Math.max(1, localBounds.radius + 0.5),
      atomIds,
    })
  }
  const displacementAtom = structure.atoms.find((atom) => (
    atom.properties?.[ZATOM_DOMAIN_WALL_SOURCE_ATOM_ID_PROPERTY] === options.maximumDisplacementAtomId
    && Number(atom.properties?.[ZATOM_DOMAIN_WALL_WEIGHT_B_PROPERTY]) > 0
  ))
  if (displacementAtom) {
    targets.push({
      id: 'polarization-domain-wall-maximum-endpoint-displacement',
      reason: `Inspect mapped endpoint atom ${options.maximumDisplacementAtomId}, which has the largest A-to-B displacement`,
      center: [...displacementAtom.position],
      radius: 2,
      atomIds: [displacementAtom.id],
    })
  }
  if (options.outputContact.closestPair) {
    const [leftIndex, rightIndex] = options.outputContact.closestPair
    const left = structure.atoms[leftIndex]
    const right = structure.atoms[rightIndex]
    const vector = options.outputContact.closestVector
    targets.push({
      id: 'polarization-domain-wall-closest-contact',
      reason: `Inspect the closest contact resolved within the ${options.outputContact.distanceLowerBoundA.toFixed(4)} Å audit radius`,
      center: vector
        ? [left.position[0] + vector[0] / 2, left.position[1] + vector[1] / 2, left.position[2] + vector[2] / 2]
        : [...left.position],
      radius: Math.max(1, (options.outputContact.minimumDistanceA ?? 1) * 2),
      atomIds: [...new Set([left.id, right.id])],
    })
  }
  return targets
}

export function buildPolarizationDomainWall(
  rawOptions: BuildPolarizationDomainWallOptions,
): BuildPolarizationDomainWallResult {
  const domainA = assertEndpointStructure(rawOptions.domainA, 'domainA')
  const domainB = assertEndpointStructure(rawOptions.domainB, 'domainB')
  if (!(rawOptions.stackingAxis in AXIS_INDEX)) {
    throw new ZatomPolarizationDomainWallInputError('invalid_polarization_domain_wall_input', 'stackingAxis must be a, b, or c')
  }
  if (rawOptions.boundaryMode !== 'periodic-pair' && rawOptions.boundaryMode !== 'finite-single') {
    throw new ZatomPolarizationDomainWallInputError('invalid_polarization_domain_wall_input', 'boundaryMode must be periodic-pair or finite-single')
  }
  if (rawOptions.expectedElectrostaticClass !== 'neutral' && rawOptions.expectedElectrostaticClass !== 'charged') {
    throw new ZatomPolarizationDomainWallInputError('invalid_polarization_domain_wall_input', 'expectedElectrostaticClass must be neutral or charged')
  }
  const polarizationA_CPerM2 = vector(rawOptions.polarizationA_CPerM2, 'polarizationA_CPerM2')
  const polarizationB_CPerM2 = vector(rawOptions.polarizationB_CPerM2, 'polarizationB_CPerM2')
  const domainACells = integer(rawOptions.domainACells ?? 2, 'domainACells', 1, 256)
  const domainBCells = integer(rawOptions.domainBCells ?? 2, 'domainBCells', 1, 256)
  const transitionCells = integer(rawOptions.transitionCells ?? 0, 'transitionCells', 0, 256)
  const neutralToleranceCPerM2 = finite(rawOptions.neutralToleranceCPerM2 ?? 1e-6, 'neutralToleranceCPerM2', 0, 100)
  const endpointDisplacementGateA = finite(rawOptions.maximumEndpointDisplacementA ?? 2, 'maximumEndpointDisplacementA', 1e-6, 100)
  const minimumPairDistanceA = finite(rawOptions.minimumPairDistanceA ?? 0.35, 'minimumPairDistanceA', 1e-6, 20)
  const closePairWarningA = finite(rawOptions.closePairWarningA ?? 0.6, 'closePairWarningA', minimumPairDistanceA, 20)
  const defaultPaddingA = rawOptions.boundaryMode === 'finite-single' ? 5 : 0
  const surfacePaddingA = finite(rawOptions.surfacePaddingA ?? defaultPaddingA, 'surfacePaddingA', 0, 10_000)
  if (rawOptions.boundaryMode === 'periodic-pair' && surfacePaddingA !== 0) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      'surfacePaddingA must be zero for periodic-pair geometry',
    )
  }
  const maxOutputAtoms = integer(rawOptions.maxOutputAtoms ?? 100_000, 'maxOutputAtoms', 1, MAX_OUTPUT_ATOMS)
  const profile = buildProfile(rawOptions.boundaryMode, domainACells, domainBCells, transitionCells)
  const outputAtomCount = profile.length * domainA.atoms.length
  if (!Number.isSafeInteger(outputAtomCount) || outputAtomCount > maxOutputAtoms) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_atom_budget_exceeded',
      `Requested wall contains ${outputAtomCount.toLocaleString()} atoms above maxOutputAtoms=${maxOutputAtoms.toLocaleString()}`,
    )
  }
  const axis = AXIS_INDEX[rawOptions.stackingAxis]
  const { normal, areaA2: wallAreaA2, layerHeightA } = axisNormal(domainA.lattice!.vectors, axis)
  const aligned = alignEndpointAtoms(domainA, domainB)
  const endpointAAudit = auditDomainWallContacts(domainA, closePairWarningA, minimumPairDistanceA)
  const endpointBAudit = auditDomainWallContacts(domainB, closePairWarningA, minimumPairDistanceA)

  const periodicOutput = rawOptions.boundaryMode === 'periodic-pair'
  const rawAtoms: Array<{ atom: Omit<ZatomStructureAtom, 'position'>; fractionalInSource: Vec3 }> = []
  for (const cell of profile) for (const endpoint of aligned.atoms) {
    const position = add(
      add(endpoint.canonicalA, scaleVector(endpoint.displacementToB, cell.domainBWeight)),
      scaleVector(domainA.lattice!.vectors[axis], cell.cellIndex),
    )
    const fractional = cartesianToFractional(position, domainA.lattice!.vectors)!
    for (const lateralAxis of [0, 1, 2]) {
      if (lateralAxis !== axis) fractional[lateralAxis] -= Math.floor(fractional[lateralAxis])
    }
    rawAtoms.push({
      atom: {
        id: `domain-wall-cell-${String(cell.cellIndex + 1).padStart(4, '0')}:${endpoint.source.id}`,
        element: endpoint.source.element,
        properties: {
          ...(endpoint.source.properties ?? {}),
          [ZATOM_DOMAIN_WALL_SOURCE_ATOM_ID_PROPERTY]: endpoint.source.id,
          [ZATOM_DOMAIN_WALL_CELL_INDEX_PROPERTY]: cell.cellIndex,
          [ZATOM_DOMAIN_WALL_WEIGHT_B_PROPERTY]: cell.domainBWeight,
          [ZATOM_DOMAIN_WALL_SEGMENT_PROPERTY]: cell.segment,
        },
      },
      fractionalInSource: fractional,
    })
  }
  let normalShiftCells = 0
  let normalSpanCells = profile.length
  if (!periodicOutput) {
    const minimumNormal = Math.min(0, ...rawAtoms.map((entry) => entry.fractionalInSource[axis]))
    const maximumNormal = Math.max(profile.length, ...rawAtoms.map((entry) => entry.fractionalInSource[axis]))
    const paddingCells = surfacePaddingA / layerHeightA
    normalShiftCells = paddingCells - minimumNormal
    normalSpanCells = maximumNormal - minimumNormal + 2 * paddingCells
  }
  const outputVectors = scaleLatticeAxis(domainA.lattice!.vectors, axis, normalSpanCells)
  const periodic: [boolean, boolean, boolean] = [true, true, true]
  if (!periodicOutput) periodic[axis] = false
  const atoms: ZatomStructureAtom[] = rawAtoms.map((entry) => {
    const fractional = [...entry.fractionalInSource] as Vec3
    if (periodicOutput) {
      fractional[axis] = ((fractional[axis] % profile.length) + profile.length) % profile.length
    } else {
      fractional[axis] += normalShiftCells
    }
    return { ...entry.atom, position: fractionalToCartesian(fractional, domainA.lattice!.vectors) }
  })
  const projectedAtomPropertyBytes = new TextEncoder().encode(JSON.stringify(atoms.map((atom) => atom.properties))).length
  if (projectedAtomPropertyBytes > MAX_PROPERTY_BYTES) {
    throw new ZatomPolarizationDomainWallInputError(
      'polarization_domain_wall_property_budget_exceeded',
      `Replicated atom properties occupy ${projectedAtomPropertyBytes.toLocaleString()} UTF-8 bytes above the fixed ${MAX_PROPERTY_BYTES.toLocaleString()}-byte budget`,
    )
  }
  const wallCoordinates = profileWallCoordinates(rawOptions.boundaryMode, domainACells, domainBCells, transitionCells)
  const polarizationAngleDeg = Math.acos(Math.max(-1, Math.min(1, (
    dot(polarizationA_CPerM2, polarizationB_CPerM2)
    / (Math.hypot(...polarizationA_CPerM2) * Math.hypot(...polarizationB_CPerM2))
  )))) * 180 / Math.PI
  const boundChargeAB_CPerM2 = dot([
    polarizationA_CPerM2[0] - polarizationB_CPerM2[0],
    polarizationA_CPerM2[1] - polarizationB_CPerM2[1],
    polarizationA_CPerM2[2] - polarizationB_CPerM2[2],
  ], normal)
  const electrostaticClass: PolarizationDomainWallElectrostaticClass = Math.abs(boundChargeAB_CPerM2) <= neutralToleranceCPerM2
    ? 'neutral'
    : 'charged'
  const structure = parseZatomStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label: rawOptions.label?.trim() || `${domainA.label ?? 'Domain A'} ↔ ${domainB.label ?? 'Domain B'} polarization wall`,
    atoms,
    lattice: { vectors: outputVectors, periodic },
    metadata: {
      'zatom.polarizationDomainWall': {
        schemaVersion: ZATOM_POLARIZATION_DOMAIN_WALL_METADATA_SCHEMA,
        method: 'explicit-endpoints-linear-minimum-image-interpolation',
        domainAFingerprint: fingerprintStructure(domainA),
        domainBFingerprint: fingerprintStructure(domainB),
        sourceAtomIds: domainA.atoms.map((atom) => atom.id),
        stackingAxis: rawOptions.stackingAxis,
        boundaryMode: rawOptions.boundaryMode,
        expectedElectrostaticClass: rawOptions.expectedElectrostaticClass,
        electrostaticClass,
        polarizationA_CPerM2: [...polarizationA_CPerM2],
        polarizationB_CPerM2: [...polarizationB_CPerM2],
        wallNormalCartesian: [...normal],
        boundChargeConvention: 'sigma_AB=(P_A-P_B) dot n_AB',
        boundChargeAB_CPerM2,
        profile: profile.map((cell) => ({ ...cell })),
        wallCoordinatesInSourceCells: [...wallCoordinates],
        normalShiftCells,
        normalSpanCells,
        surfacePaddingA,
        endpointImageConvention: 'exact-minimum-image-with-lexicographic-tie-break',
      },
    },
  })
  const outputAudit = auditDomainWallContacts(structure, closePairWarningA, minimumPairDistanceA)
  const validation = validateStructure(structure, {
    overlapDistanceA: minimumPairDistanceA,
    closePairWarningA,
    maxPairScanAtoms: 2,
  })
  const filteredValidationChecks = validation.checks.filter((check) => (
    check.id !== 'structure.minimum_distance' && check.id !== 'structure.periodic_self_image_distance'
  ))
  const containmentTolerance = 1e-9
  let outsideCount = 0
  for (const atom of structure.atoms) {
    const fractional = cartesianToFractional(atom.position, structure.lattice!.vectors)!
    for (let coordinate = 0; coordinate < 3; coordinate++) {
      if (fractional[coordinate] < -containmentTolerance || fractional[coordinate] >= 1 + containmentTolerance) {
        outsideCount += 1
        break
      }
    }
  }
  const limitations = [
    'The two explicit endpoints must already share one lattice, stable atom IDs, elements, and atom properties; this builder does not infer symmetry variants, polarization, or atom mapping.',
    'Transition cells use deterministic linear interpolation along each atom\'s exact minimum-image endpoint displacement; this is an unrelaxed geometry seed, not a predicted wall profile or width.',
    'The bound-charge audit uses user-supplied Cartesian polarization vectors. It does not calculate Berry-phase polarization, Born charges, screening, charge compensation, or electrostatic stability.',
    'No energy, force, reconstruction, termination search, bond formation, ferroelastic strain accommodation, topology, kinetics, or thermodynamic stability is inferred.',
  ]
  const electrostaticMatches = electrostaticClass === rawOptions.expectedElectrostaticClass
  const checks: ValidationCheck[] = [
    {
      id: 'polarization_domain_wall.endpoint_contract',
      status: 'pass',
      message: `${domainA.atoms.length} endpoint sites have exact ID, element, property, lattice, and bond-free topology compatibility`,
      metrics: {
        endpointAtomCount: domainA.atoms.length,
        maximumLatticeMismatchA: latticeMismatchA(domainA.lattice!.vectors, domainB.lattice!.vectors),
        latticeMatchToleranceA: LATTICE_MATCH_TOLERANCE_A,
      },
    },
    contactCheck('polarization_domain_wall.domain_a_contacts', 'Domain A endpoint', endpointAAudit, minimumPairDistanceA, closePairWarningA, domainA),
    contactCheck('polarization_domain_wall.domain_b_contacts', 'Domain B endpoint', endpointBAudit, minimumPairDistanceA, closePairWarningA, domainB),
    {
      id: 'polarization_domain_wall.endpoint_displacement',
      status: aligned.maximumDisplacementA <= endpointDisplacementGateA ? (aligned.endpointImageTieCount ? 'warn' : 'pass') : 'fail',
      message: aligned.maximumDisplacementA <= endpointDisplacementGateA
        ? `Largest mapped A-to-B site displacement is ${aligned.maximumDisplacementA.toFixed(6)} Å${aligned.endpointImageTieCount ? `; ${aligned.endpointImageTieCount} site paths touch a half-cell image tie` : ''}`
        : `Largest mapped A-to-B site displacement ${aligned.maximumDisplacementA.toFixed(6)} Å exceeds ${endpointDisplacementGateA} Å`,
      metrics: {
        maximumEndpointDisplacementA: aligned.maximumDisplacementA,
        maximumAllowedEndpointDisplacementA: endpointDisplacementGateA,
        endpointImageTieCount: aligned.endpointImageTieCount,
        minimumImageCandidateEvaluations: aligned.minimumImageCandidateEvaluations,
      },
      atomIds: [aligned.maximumDisplacementAtomId],
    },
    {
      id: 'polarization_domain_wall.polarization_discontinuity',
      status: electrostaticMatches ? 'pass' : 'fail',
      message: `Declared ${rawOptions.expectedElectrostaticClass} wall resolves as ${electrostaticClass}: sigma_AB=${boundChargeAB_CPerM2.toExponential(6)} C/m² at ${polarizationAngleDeg.toFixed(6)}°`,
      metrics: {
        polarizationAngleDeg,
        boundChargeAB_CPerM2,
        absoluteBoundChargeCPerM2: Math.abs(boundChargeAB_CPerM2),
        neutralToleranceCPerM2,
        expectedElectrostaticClass: rawOptions.expectedElectrostaticClass,
        resolvedElectrostaticClass: electrostaticClass,
      },
    },
    {
      id: 'polarization_domain_wall.profile',
      status: 'pass',
      message: `${profile.length} source-cell layers realize ${rawOptions.boundaryMode === 'periodic-pair' ? 2 : 1} wall(s), ${transitionCells} interpolated cell(s) per wall direction, and exact A/B plateaus`,
      metrics: {
        cellCount: profile.length,
        wallCount: wallCoordinates.length,
        domainACells,
        domainBCells,
        transitionCells,
        transitionWidthA: transitionCells * layerHeightA,
      },
    },
    {
      id: 'polarization_domain_wall.boundary_conditions',
      status: 'pass',
      message: periodicOutput
        ? 'All axes are periodic and the A→B profile closes through a second B→A wall'
        : `The wall-normal ${rawOptions.stackingAxis} axis is finite with ${surfacePaddingA} Å surface padding; lateral axes remain periodic`,
      metrics: {
        periodicA: periodic[0], periodicB: periodic[1], periodicC: periodic[2],
        surfacePaddingA, normalSpanCells, wallAreaA2, layerHeightA,
      },
    },
    contactCheck('polarization_domain_wall.output_contacts', 'Constructed wall', outputAudit, minimumPairDistanceA, closePairWarningA, structure),
    {
      id: 'polarization_domain_wall.containment',
      status: outsideCount ? 'fail' : 'pass',
      message: outsideCount ? `${outsideCount} atoms lie outside the declared output cell` : 'Every generated atom lies inside the declared output cell',
      metrics: { outsideCount, containmentTolerance },
    },
    {
      id: 'polarization_domain_wall.model_scope',
      status: 'warn',
      message: limitations.join(' '),
    },
    ...filteredValidationChecks,
  ]
  const emptySource: ZatomStructure = { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] }
  const changeSet = buildStructureChangeSet(emptySource, structure)
  const provenance: StructureProvenance = {
    engine: 'zatom-polarization-domain-wall',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(domainA),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      domainBFingerprint: fingerprintStructure(domainB),
      polarizationA_CPerM2: [...polarizationA_CPerM2],
      polarizationB_CPerM2: [...polarizationB_CPerM2],
      stackingAxis: rawOptions.stackingAxis,
      boundaryMode: rawOptions.boundaryMode,
      expectedElectrostaticClass: rawOptions.expectedElectrostaticClass,
      domainACells,
      domainBCells,
      transitionCells,
      neutralToleranceCPerM2,
      maximumEndpointDisplacementA: endpointDisplacementGateA,
      minimumPairDistanceA,
      closePairWarningA,
      surfacePaddingA,
      maxOutputAtoms,
      projectedAtomPropertyBytes,
    },
  }
  const inspectionTargets = buildInspectionTargets({
    structure,
    profile,
    wallCoordinates,
    boundaryMode: rawOptions.boundaryMode,
    axis,
    normalShiftCells,
    normalSpanCells,
    maximumDisplacementAtomId: aligned.maximumDisplacementAtomId,
    outputContact: outputAudit,
  })
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    profile,
    limitations,
    metrics: {
      endpointAtomCount: domainA.atoms.length,
      outputAtomCount,
      cellCount: profile.length,
      wallCount: wallCoordinates.length,
      wallAreaA2,
      layerHeightA,
      transitionWidthA: transitionCells * layerHeightA,
      polarizationAngleDeg,
      boundChargeAB_CPerM2,
      electrostaticClass,
      maximumEndpointDisplacementA: aligned.maximumDisplacementA,
      endpointImageTieCount: aligned.endpointImageTieCount,
      contactMinimumDistanceA: outputAudit.minimumDistanceA,
      contactDistanceLowerBoundA: outputAudit.distanceLowerBoundA,
      contactPairCandidates: outputAudit.pairCandidates,
      minimumImageCandidateEvaluations: aligned.minimumImageCandidateEvaluations
        + endpointAAudit.minimumImageCandidateEvaluations
        + endpointBAudit.minimumImageCandidateEvaluations
        + outputAudit.minimumImageCandidateEvaluations,
      projectedAtomPropertyBytes,
    },
  }
}
