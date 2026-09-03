/** Surface/slab and adsorption adapters over zatom's existing geometry engines. */

import {
  buildSlabFromMiller,
  type BuildSlabFromMillerOptions,
} from '../lib/analysis/builders/slab'
import {
  assessSurface,
  FRAGMENTS,
  placeFragment,
  siteFromManualSelection,
  type DetectedSite,
} from '../lib/analysis/builders/adsorbate'
import { ELEMENTS } from '../lib/crystal/elements'
import { parseXYZ } from '../lib/crystal/xyz-parser'
import type {
  InspectionTarget,
  JsonValue,
  StructureChangeSet,
  StructureProvenance,
  ValidationCheck,
  Vec3,
  ZatomBondOrder,
  ZatomStructure,
} from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { buildStructureChangeSet } from './operations'
import { detectPeriodicAdsorptionSites } from './periodic-adsorption-sites'
import {
  boundsOfPositions,
  cartesianToFractional,
  createCertifiedMinimumImageCalculator,
  distance,
  fingerprintStructure,
} from './structure-math'
import { validateStructure } from './structure-validation'

export const BUILTIN_ADSORBATE_FRAGMENTS = Object.keys(FRAGMENTS).sort()

const FRAGMENT_BONDS: Record<string, Array<{ from: number; to: number; order: 1 | 2 | 3 }>> = {
  H: [],
  O: [],
  OH: [{ from: 0, to: 1, order: 1 }],
  OOH: [{ from: 0, to: 1, order: 1 }, { from: 1, to: 2, order: 1 }],
  H2O: [{ from: 0, to: 1, order: 1 }, { from: 0, to: 2, order: 1 }],
  CO: [{ from: 0, to: 1, order: 3 }],
  CO2: [{ from: 0, to: 1, order: 2 }, { from: 1, to: 2, order: 2 }],
  N2: [{ from: 0, to: 1, order: 3 }],
  NH3: [{ from: 0, to: 1, order: 1 }, { from: 0, to: 2, order: 1 }, { from: 0, to: 3, order: 1 }],
  CH3: [{ from: 0, to: 1, order: 1 }, { from: 0, to: 2, order: 1 }, { from: 0, to: 3, order: 1 }],
}

export interface BuildMillerSlabOptions {
  structure: ZatomStructure
  miller: [number, number, number]
  layers?: number
  vacuumA?: number
  searchMax?: number
  reverse?: boolean
  center?: boolean
}

export interface BuildMillerSlabResult {
  structure: ZatomStructure
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  metrics: {
    miller: [number, number, number]
    layers: number
    requestedVacuumA: number
    measuredVacuumA: number
    slabThicknessA: number
    fractionalBounds: { min: Vec3; max: Vec3 } | null
  }
}

export interface AdsorptionSite {
  id: string
  kind: 'top' | 'bridge' | 'hollow'
  position: Vec3
  bindingPosition: Vec3
  normal: Vec3
  atomIds: string[]
  atomImages: Array<[number, number, number]>
}

export interface DetectAdsorptionSitesOptions {
  structure: ZatomStructure
  surfaceUp?: Vec3
  layerToleranceA?: number
  bondCutoffA?: number
  triangleCutoffA?: number
  maxSurfaceAtoms?: number
  maxExpandedSurfacePoints?: number
}

export interface DetectAdsorptionSitesResult {
  sites: AdsorptionSite[]
  /**
   * Fingerprint of the structure these site IDs were derived from. Site IDs are
   * positional, so they are only meaningful against this exact structure. Pass it
   * back as `expectSourceFingerprint` when placing to reject stale site IDs.
   */
  sourceFingerprint: string
  surfaceAtomIds: string[]
  surfaceMeanProjectionA: number
  normal: Vec3
  inPlanePeriodicAxes: number[]
  expandedSurfacePointCount: number
  delaunayTriangleCount: number
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
}

export interface PlaceAdsorbateOptions extends Omit<DetectAdsorptionSitesOptions, 'maxSurfaceAtoms'> {
  fragment: string
  siteId?: string
  /**
   * The `sourceFingerprint` returned alongside the site IDs. Site IDs are positional,
   * so a `siteId` observed against an older structure must not silently resolve to a
   * different site here. Required whenever `siteId` is used.
   */
  expectedSourceFingerprint?: string
  siteAtomIds?: string[]
  /** Internal pre-resolved site for bounded enumeration without repeating Delaunay detection. */
  resolvedSite?: AdsorptionSite
  bondLengthA?: number
  collisionFactor?: number
  tiltDeg?: number
  azimuthDeg?: number
  surfaceBondPolicy?: 'none' | 'anchor-to-site-atoms'
  surfaceBondOrder?: ZatomBondOrder
  maxSurfaceAtoms?: number
}

export interface PlaceAdsorbateResult {
  structure: ZatomStructure
  site: AdsorptionSite
  addedAtomIds: string[]
  surfaceBondIds: string[]
  validation: ReturnType<typeof validateStructure>
  checks: ValidationCheck[]
  changeSet: StructureChangeSet
  provenance: StructureProvenance
  inspectionTargets: InspectionTarget[]
  collision: { addedAtomId: string; existingAtomId: string; distanceA: number; thresholdA: number } | null
  anchorDistanceA: number
  orientation: { tiltDeg: number; azimuthDeg: number }
}

export class SurfaceInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SurfaceInputError'
    this.code = code
  }
}

function norm(value: readonly number[]): number {
  return Math.hypot(value[0], value[1], value[2])
}

function unit(value: Vec3, field: string): Vec3 {
  const length = norm(value)
  if (!Number.isFinite(length) || length < 1e-12) throw new SurfaceInputError('invalid_normal', `${field} must be non-zero and finite`)
  return [value[0] / length, value[1] / length, value[2] / length]
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * The surface normal of a slab cell: perpendicular to the in-plane vectors
 * a and b, oriented along +c. Slab cells are often oblique (c is not
 * perpendicular to the a–b plane), so `unit(c)` is NOT the normal; using it
 * places adsorbates tilted off the true surface. Without a lattice the
 * conventional +z is used.
 */
function latticeSurfaceUp(structure: ZatomStructure): Vec3 {
  const lattice = structure.lattice
  if (!lattice) return [0, 0, 1]
  const [a, b, c] = lattice.vectors
  const n: Vec3 = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  if (norm(n) < 1e-12) return [0, 0, 1]
  const up = unit(n, 'lattice normal')
  return dot(up, c) >= 0 ? up : [-up[0], -up[1], -up[2]]
}

/**
 * Rigidly rotate a slab so that a lies along +x, b in the xy plane, and the
 * surface normal points along +z. The frame (â, n̂×â, n̂) is right-handed, so
 * this is a proper rotation: bond lengths, angles and cell metrics are
 * unchanged, only the Cartesian embedding. Mutates atoms and lattice in place.
 */
function rotateToStandardSlabFrame(structure: ZatomStructure): void {
  const lattice = structure.lattice
  if (!lattice) return
  const xAxis = unit([...lattice.vectors[0]] as Vec3, 'lattice a')
  const zAxis = latticeSurfaceUp(structure)
  const yAxis: Vec3 = [
    zAxis[1] * xAxis[2] - zAxis[2] * xAxis[1],
    zAxis[2] * xAxis[0] - zAxis[0] * xAxis[2],
    zAxis[0] * xAxis[1] - zAxis[1] * xAxis[0],
  ]
  const rotate = (v: readonly number[]): Vec3 => [dot(v, xAxis), dot(v, yAxis), dot(v, zAxis)]
  lattice.vectors = lattice.vectors.map((v) => rotate(v)) as typeof lattice.vectors
  for (const atom of structure.atoms) atom.position = rotate(atom.position)
}

function normalizedMiller(miller: readonly number[]): [number, number, number] {
  if (miller.length !== 3 || miller.some((value) => !Number.isFinite(value) || !Number.isInteger(value))) {
    throw new SurfaceInputError('invalid_miller', 'Miller indices must be three finite integers')
  }
  let [h, k, l] = miller as [number, number, number]
  if (h === 0 && k === 0 && l === 0) throw new SurfaceInputError('invalid_miller', 'Miller indices (0,0,0) are invalid')
  const gcd = (a: number, b: number): number => b === 0 ? Math.abs(a) : gcd(b, a % b)
  const divisor = gcd(gcd(h, k), l)
  if (divisor > 1) {
    h /= divisor
    k /= divisor
    l /= divisor
  }
  return [h, k, l]
}

function requirePositiveFinite(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new SurfaceInputError('invalid_parameter', `${field} must be finite and greater than zero`)
  }
}

function finiteInRange(value: number | undefined, field: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = value ?? fallback
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new SurfaceInputError('invalid_parameter', `${field} must be finite from ${minimum} through ${maximum}`)
  }
  return Object.is(parsed, -0) ? 0 : parsed
}

function requireIntegerInRange(value: number, field: string, minimum: number, maximum: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new SurfaceInputError('invalid_parameter', `${field} must be an integer from ${minimum} through ${maximum}`)
  }
}

function validateDetectionParameters(options: DetectAdsorptionSitesOptions): void {
  requirePositiveFinite(options.layerToleranceA, 'layerToleranceA')
  requirePositiveFinite(options.bondCutoffA, 'bondCutoffA')
  requirePositiveFinite(options.triangleCutoffA, 'triangleCutoffA')
  if (options.maxSurfaceAtoms !== undefined) {
    requireIntegerInRange(options.maxSurfaceAtoms, 'maxSurfaceAtoms', 1, 1000)
  }
  if (options.maxExpandedSurfacePoints !== undefined) {
    requireIntegerInRange(options.maxExpandedSurfacePoints, 'maxExpandedSurfacePoints', 1, 100_000)
  }
}

function structureFromXyz(xyz: string, label: string, idPrefix: string): ZatomStructure {
  const parsed = parseXYZ(xyz)
  if (!parsed.success) throw new SurfaceInputError('builder_output_invalid', parsed.error)
  const lattice = parsed.data.latticeVectors
  return {
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    label,
    atoms: parsed.data.atoms.map((atom, index) => ({
      id: `${idPrefix}-${index + 1}`,
      element: atom.element,
      position: [...atom.cartesian] as Vec3,
      ...(atom.props ? { properties: atom.props as unknown as Record<string, JsonValue> } : {}),
    })),
    ...(lattice ? {
      lattice: {
        vectors: [[...lattice.a], [...lattice.b], [...lattice.c]],
        // Slab builders retain a vacuum-padded c repeat, matching common
        // plane-wave input semantics and the current all-or-none browser PBC.
        periodic: [true, true, true],
      },
    } : {}),
  }
}

function fractionalBounds(structure: ZatomStructure): { min: Vec3; max: Vec3 } | null {
  if (!structure.lattice || !structure.atoms.length) return null
  const fractions = structure.atoms.map((atom) => cartesianToFractional(atom.position, structure.lattice!.vectors))
  if (fractions.some((value) => !value)) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const fraction of fractions as Vec3[]) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], fraction[axis])
    max[axis] = Math.max(max[axis], fraction[axis])
  }
  return { min, max }
}

export function buildMillerSlab(options: BuildMillerSlabOptions): BuildMillerSlabResult {
  const sourceValidation = validateStructure(options.structure, { requirePeriodic: true })
  if (sourceValidation.verdict === 'fail' || !options.structure.lattice) {
    throw new SurfaceInputError('invalid_source_structure', 'Miller slab generation requires a valid periodic source structure')
  }
  const miller = normalizedMiller(options.miller)
  const layers = options.layers ?? 4
  const vacuumA = options.vacuumA ?? 10
  const searchMax = options.searchMax ?? 4
  requireIntegerInRange(layers, 'layers', 1, 256)
  requireIntegerInRange(searchMax, 'searchMax', 2, 16)
  if (!Number.isFinite(vacuumA) || vacuumA < 0) throw new SurfaceInputError('invalid_vacuum', 'vacuumA must be finite and non-negative')

  let built
  try {
    const builderOptions: BuildSlabFromMillerOptions = {
      lattice: options.structure.lattice.vectors,
      atoms: options.structure.atoms.map((atom) => ({ element: atom.element, cartesian: atom.position })),
      h: miller[0],
      k: miller[1],
      l: miller[2],
      layers,
      vacuum: vacuumA,
      search_max: searchMax,
      reverse: options.reverse,
      center: options.center,
    }
    built = buildSlabFromMiller(builderOptions)
  } catch (error) {
    throw new SurfaceInputError('slab_builder_failed', error instanceof Error ? error.message : String(error))
  }
  if (built.n_atoms < 1) throw new SurfaceInputError('empty_slab', 'Slab builder produced no atoms')
  const structure = structureFromXyz(
    built.xyz,
    `${options.structure.label ?? 'structure'} (${miller.join('')}) slab`,
    `slab-${miller.join('_')}`,
  )
  // A vacuum slab repeats in-plane only; the c axis is the surface normal.
  // Downstream perception (layers, adsorption sites, regime detection) keys
  // off this flag to know which direction is "up" and which images to skip.
  if (structure.lattice) structure.lattice.periodic = [true, true, false]
  // The builder leaves the cut in the bulk Cartesian frame, so a (111) slab
  // stands along [111]. Rotate into the standard slab frame (a along +x, the
  // surface normal along +z) that cameras, plane-wave inputs and every other
  // slab tool assume. A rigid rotation changes no distance or angle.
  rotateToStandardSlabFrame(structure)
  const normal = latticeSurfaceUp(structure)
  const projections = structure.atoms.map((atom) => dot(atom.position, normal))
  const minProjection = Math.min(...projections)
  const maxProjection = Math.max(...projections)
  const slabThicknessA = maxProjection - minProjection
  // Cell height along the true normal, not |c| (c may be oblique).
  const measuredVacuumA = dot(structure.lattice!.vectors[2], normal) - slabThicknessA
  const fracBounds = fractionalBounds(structure)
  const insideCell = !!fracBounds
    && fracBounds.min.every((value) => value >= -1e-5)
    && fracBounds.max.every((value) => value <= 1 + 1e-5)
  const validation = validateStructure(structure, { requirePeriodic: true })
  const checks: ValidationCheck[] = [
    {
      id: 'slab.miller_orientation',
      status: 'pass',
      message: `Built normalized Miller orientation (${miller.join(',')}) with ${layers} repeats`,
      metrics: { h: miller[0], k: miller[1], l: miller[2], layers },
    },
    {
      id: 'slab.vacuum',
      status: measuredVacuumA + 1e-4 >= vacuumA ? 'pass' : 'fail',
      message: `Measured vacuum is ${measuredVacuumA.toFixed(4)} Å (requested ${vacuumA.toFixed(4)} Å)`,
      metrics: { requestedVacuumA: vacuumA, measuredVacuumA, slabThicknessA },
    },
    {
      id: 'slab.atoms_inside_cell',
      status: insideCell ? 'pass' : 'fail',
      message: insideCell ? 'Every slab atom lies inside the generated cell bounds' : 'At least one slab atom lies outside the generated fractional cell bounds',
      metrics: fracBounds ? {
        minFractional: Math.min(...fracBounds.min),
        maxFractional: Math.max(...fracBounds.max),
      } : undefined,
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const topThreshold = maxProjection - 0.5
  const topAtoms = structure.atoms.filter((atom) => dot(atom.position, normal) >= topThreshold)
  const topBounds = boundsOfPositions(topAtoms.map((atom) => atom.position))
  const inspectionTargets: InspectionTarget[] = topBounds ? [{
    id: 'slab-top-surface',
    reason: `Inspect the top surface of the (${miller.join('')}) slab`,
    center: topBounds.center,
    radius: Math.max(1, topBounds.radius),
    atomIds: topAtoms.slice(0, 80).map((atom) => atom.id),
    atomIdsTruncated: topAtoms.length > 80,
  }] : []
  inspectionTargets.push(...validation.inspectionTargets)
  const provenance: StructureProvenance = {
    engine: 'zatom-slab-builder',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      miller,
      layers,
      vacuumA,
      searchMax,
      reverse: options.reverse ?? false,
      center: options.center ?? true,
    },
  }
  return {
    structure,
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    metrics: { miller, layers, requestedVacuumA: vacuumA, measuredVacuumA, slabThicknessA, fractionalBounds: fracBounds },
  }
}

function adsorptionInputs(structure: ZatomStructure) {
  return structure.atoms.map((atom) => ({ element: atom.element, cartesian: atom.position }))
}

function adsorptionSurfaceLattice(structure: ZatomStructure) {
  const vectors = structure.lattice?.vectors
  return vectors ? { a: vectors[0], b: vectors[1], c: vectors[2] } : undefined
}

function canonicalSite(site: DetectedSite, structure: ZatomStructure): AdsorptionSite {
  return {
    id: site.id,
    kind: site.kind,
    position: [...site.position] as Vec3,
    bindingPosition: [...(site.bindingPosition ?? site.position)] as Vec3,
    normal: [...site.normal] as Vec3,
    atomIds: site.atomIndices.map((index) => structure.atoms[index]?.id).filter((id): id is string => !!id),
    atomImages: site.atomIndices.map((_, index) => [...(site.atomImages?.[index] ?? [0, 0, 0])] as [number, number, number]),
  }
}

export function detectAdsorptionSites(options: DetectAdsorptionSitesOptions): DetectAdsorptionSitesResult {
  const validation = validateStructure(options.structure)
  if (validation.verdict === 'fail') throw new SurfaceInputError('invalid_source_structure', 'Adsorption-site detection requires a valid source structure')
  validateDetectionParameters(options)
  const assessment = assessSurface(
    adsorptionSurfaceLattice(options.structure),
    options.structure.atoms.map((atom) => atom.position),
  )
  if (!assessment.ok) {
    throw new SurfaceInputError(
      assessment.reason === 'bulk' ? 'bulk_has_no_surface' : 'surface_has_no_atoms',
      assessment.message,
    )
  }
  // The canonical surface assessment already found the vacuum frame. Reuse
  // its outward normal instead of assuming a×b/+c: imported slabs may put
  // vacuum along a or b, and an oblique cell need not align with Cartesian z.
  const surfaceUp = options.surfaceUp ? unit(options.surfaceUp, 'surfaceUp') : assessment.frame.up
  const maxSurfaceAtoms = options.maxSurfaceAtoms ?? 200
  const topology = detectPeriodicAdsorptionSites({
    structure: options.structure,
    surfaceUp,
    layerToleranceA: options.layerToleranceA ?? 0.5,
    bondCutoffA: options.bondCutoffA ?? 3.5,
    triangleCutoffA: options.triangleCutoffA ?? 3.5,
    maxSurfaceAtoms,
    maxExpandedSurfacePoints: options.maxExpandedSurfacePoints ?? 50_000,
  })
  const sites = topology.sites.map((site) => canonicalSite(site, options.structure))
  const surfaceAtomIds = topology.surfaceAtomIndices.map((index) => options.structure.atoms[index].id)
  const surfaceBounds = boundsOfPositions(topology.surfaceAtomIndices.map((index) => options.structure.atoms[index].position))
  const checks: ValidationCheck[] = [
    {
      id: 'surface.exposed_surface',
      status: 'pass',
      message: Number.isFinite(assessment.vacuumA)
        ? `Confirmed an exposed surface with ${assessment.vacuumA.toFixed(2)} Å vacuum`
        : 'Confirmed a finite non-periodic structure',
      metrics: { vacuumA: Number.isFinite(assessment.vacuumA) ? assessment.vacuumA : null },
    },
    {
      id: 'surface.layer_found',
      status: surfaceAtomIds.length ? 'pass' : 'fail',
      message: surfaceAtomIds.length ? `Detected ${surfaceAtomIds.length} atoms in the outward surface layer` : 'No surface layer was detected',
      metrics: { surfaceAtomCount: surfaceAtomIds.length },
      atomIds: surfaceAtomIds.slice(0, 80),
    },
    {
      id: 'surface.adsorbates_excluded',
      status: topology.excludedAdsorbateAtomCount ? 'pass' : 'skipped',
      message: topology.excludedAdsorbateAtomCount
        ? `Excluded ${topology.excludedAdsorbateAtomCount} explicitly tagged adsorbate atoms before detecting the host surface layer`
        : 'No explicitly tagged adsorbate atoms needed exclusion from host surface detection',
      metrics: { excludedAdsorbateAtomCount: topology.excludedAdsorbateAtomCount },
    },
    {
      id: 'surface.adsorption_sites_found',
      status: sites.length ? 'pass' : 'fail',
      message: `Detected ${sites.length} top/bridge/hollow candidates`,
      metrics: {
        siteCount: sites.length,
        topCount: sites.filter((site) => site.kind === 'top').length,
        bridgeCount: sites.filter((site) => site.kind === 'bridge').length,
        hollowCount: sites.filter((site) => site.kind === 'hollow').length,
      },
    },
    {
      id: 'surface.delaunay_topology',
      status: topology.projectionDuplicateCount ? 'fail' : 'pass',
      message: topology.projectionDuplicateCount
        ? `${topology.projectionDuplicateCount} projected surface-point duplicates make the two-dimensional Delaunay topology ambiguous`
        : `Built ${topology.delaunayTriangleCount} Delaunay triangles from ${topology.expandedSurfacePointCount} finite/periodic surface-mesh points`,
      metrics: {
        expandedSurfacePointCount: topology.expandedSurfacePointCount,
        delaunayTriangleCount: topology.delaunayTriangleCount,
        projectionDuplicateCount: topology.projectionDuplicateCount,
      },
    },
    {
      id: 'surface.periodic_edge_sites',
      status: options.structure.lattice?.periodic.some(Boolean)
        ? topology.inPlanePeriodicAxes.length ? 'pass' : 'warn'
        : 'skipped',
      message: topology.inPlanePeriodicAxes.length
        ? `Extended and deduplicated adsorption topology across lattice axis/axes ${topology.inPlanePeriodicAxes.join(',')}`
        : options.structure.lattice?.periodic.some(Boolean)
          ? 'No declared periodic lattice axis is coplanar with surfaceUp; topology is finite in plane'
          : 'The source declares no periodic surface edge',
      metrics: { inPlanePeriodicAxisCount: topology.inPlanePeriodicAxes.length },
    },
  ]
  const inspectionTargets: InspectionTarget[] = surfaceBounds ? [{
    id: 'detected-surface-layer',
    reason: 'Inspect the atom layer used for adsorption-site enumeration',
    center: surfaceBounds.center,
    radius: Math.max(1, surfaceBounds.radius),
    atomIds: surfaceAtomIds.slice(0, 80),
    atomIdsTruncated: surfaceAtomIds.length > 80,
  }] : []
  return {
    sites,
    sourceFingerprint: fingerprintStructure(options.structure),
    surfaceAtomIds,
    surfaceMeanProjectionA: topology.surfaceMeanProjectionA,
    normal: surfaceUp,
    inPlanePeriodicAxes: topology.inPlanePeriodicAxes,
    expandedSurfacePointCount: topology.expandedSurfacePointCount,
    delaunayTriangleCount: topology.delaunayTriangleCount,
    checks,
    inspectionTargets,
  }
}

function uniqueAddedId(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix++
  return `${base}-${suffix}`
}

function covalentRadius(element: string): number {
  return ELEMENTS[element]?.radius ?? 0.8
}

function auditAdsorbateSurfaceCollision(
  source: ZatomStructure,
  addedAtoms: Array<{ id: string; element: string; position: Vec3 }>,
  collisionFactor: number,
): {
  collision: { addedAtomId: string; existingAtomId: string; distanceA: number; thresholdA: number } | null
  minimumDistanceA: number | null
  pairCount: number
  minimumImageCandidateEvaluations: number
} {
  const exactMinimumImage = source.lattice?.periodic.some(Boolean)
    ? createCertifiedMinimumImageCalculator(source.lattice)
    : null
  const maxMinimumImageCandidateEvaluations = 20_000_000
  let minimumImageCandidateEvaluations = 0
  let minimumDistanceA = Infinity
  let collision: { addedAtomId: string; existingAtomId: string; distanceA: number; thresholdA: number } | null = null
  let collisionRatio = Infinity
  let pairCount = 0
  try {
    for (const added of addedAtoms) for (const existing of source.atoms) {
      pairCount += 1
      const direct: Vec3 = [
        added.position[0] - existing.position[0],
        added.position[1] - existing.position[1],
        added.position[2] - existing.position[2],
      ]
      let distanceA = Math.hypot(...direct)
      if (exactMinimumImage) {
        const remaining = maxMinimumImageCandidateEvaluations - minimumImageCandidateEvaluations
        if (remaining < 1) throw new Error('Minimum-image candidate budget exhausted')
        const resolved = exactMinimumImage(direct, remaining)
        minimumImageCandidateEvaluations += resolved.candidateEvaluations
        distanceA = resolved.distance
      }
      minimumDistanceA = Math.min(minimumDistanceA, distanceA)
      const thresholdA = collisionFactor * (covalentRadius(added.element) + covalentRadius(existing.element))
      const ratio = distanceA / thresholdA
      if (distanceA < thresholdA && ratio < collisionRatio) {
        collisionRatio = ratio
        collision = { addedAtomId: added.id, existingAtomId: existing.id, distanceA, thresholdA }
      }
    }
  } catch (error) {
    throw new SurfaceInputError(
      'adsorbate_collision_budget_exceeded',
      `Exact adsorbate/surface collision audit failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return {
    collision,
    minimumDistanceA: Number.isFinite(minimumDistanceA) ? minimumDistanceA : null,
    pairCount,
    minimumImageCandidateEvaluations,
  }
}

export function placeAdsorbate(options: PlaceAdsorbateOptions): PlaceAdsorbateResult {
  const sourceValidation = validateStructure(options.structure)
  if (sourceValidation.verdict === 'fail') {
    throw new SurfaceInputError('invalid_source_structure', 'Adsorbate placement requires a valid source structure')
  }
  validateDetectionParameters(options)
  requirePositiveFinite(options.bondLengthA, 'bondLengthA')
  requirePositiveFinite(options.collisionFactor, 'collisionFactor')
  const tiltDeg = finiteInRange(options.tiltDeg, 'tiltDeg', 0, 180, 0)
  const azimuthDeg = finiteInRange(options.azimuthDeg, 'azimuthDeg', 0, 360, 0)
  if (azimuthDeg === 360) throw new SurfaceInputError('invalid_parameter', 'azimuthDeg must be smaller than 360')
  const surfaceBondPolicy = options.surfaceBondPolicy ?? 'none'
  if (surfaceBondPolicy !== 'none' && surfaceBondPolicy !== 'anchor-to-site-atoms') {
    throw new SurfaceInputError('invalid_surface_bond_policy', 'surfaceBondPolicy must be none or anchor-to-site-atoms')
  }
  const surfaceBondOrder = options.surfaceBondOrder ?? 1
  if (![1, 1.5, 2, 3].includes(surfaceBondOrder)) {
    throw new SurfaceInputError('invalid_surface_bond_order', 'surfaceBondOrder must be 1, 1.5, 2, or 3')
  }
  const fragment = FRAGMENTS[options.fragment]
  if (!fragment) throw new SurfaceInputError('unknown_fragment', `Unknown built-in adsorbate fragment "${options.fragment}"`)
  const siteSelectorCount = Number(!!options.siteId) + Number(!!options.siteAtomIds) + Number(!!options.resolvedSite)
  if (siteSelectorCount === 0) {
    throw new SurfaceInputError(
      'missing_site',
      'No site selected. Run surface_detect_adsorption_sites first and pass one of its site IDs as siteId (with its sourceFingerprint as expectedSourceFingerprint), or name one to three surface atoms in siteAtomIds.',
    )
  }
  if (siteSelectorCount > 1) {
    throw new SurfaceInputError('ambiguous_site', 'Provide exactly one of siteId or siteAtomIds, not both')
  }
  const atoms = adsorptionInputs(options.structure)
  let detectedSite: DetectedSite | null = null
  let detectionChecks: ValidationCheck[] = []
  if (options.resolvedSite) {
    const byId = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
    const missing = options.resolvedSite.atomIds.filter((id) => !byId.has(id))
    if (missing.length) throw new SurfaceInputError('site_atoms_missing', `Resolved site atom IDs are missing: ${missing.join(', ')}`)
    if (options.resolvedSite.atomImages.length !== options.resolvedSite.atomIds.length) {
      throw new SurfaceInputError('invalid_resolved_site', 'Resolved site atomImages must align with atomIds')
    }
    detectedSite = {
      id: options.resolvedSite.id,
      kind: options.resolvedSite.kind,
      position: [...options.resolvedSite.position],
      bindingPosition: [...options.resolvedSite.bindingPosition],
      normal: [...options.resolvedSite.normal],
      atomIndices: options.resolvedSite.atomIds.map((id) => byId.get(id)!),
      atomImages: options.resolvedSite.atomImages.map((image) => [...image]),
    }
  } else if (options.siteId) {
    if (!options.expectedSourceFingerprint) {
      throw new SurfaceInputError(
        'unbound_site_id',
        'Placing by siteId requires expectedSourceFingerprint from the detection that produced the ID. Call surface_detect_adsorption_sites first and pass back its sourceFingerprint, or select the site by siteAtomIds.',
      )
    }
    const detection = detectAdsorptionSites(options)
    if (detection.sourceFingerprint !== options.expectedSourceFingerprint) {
      throw new SurfaceInputError(
        'stale_site_id',
        `Adsorption site "${options.siteId}" was enumerated against a different structure (expected ${options.expectedSourceFingerprint}, current ${detection.sourceFingerprint}). Re-detect sites on the current structure before placing.`,
      )
    }
    detectionChecks = detection.checks
    const canonical = detection.sites.find((site) => site.id === options.siteId)
    if (!canonical) throw new SurfaceInputError('site_not_found', `Adsorption site "${options.siteId}" was not detected`)
    const byId = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
    detectedSite = {
      id: canonical.id,
      kind: canonical.kind,
      position: canonical.position,
      normal: canonical.normal,
      atomIndices: canonical.atomIds.map((id) => byId.get(id)).filter((index): index is number => index !== undefined),
      bindingPosition: canonical.bindingPosition,
      atomImages: canonical.atomImages,
    }
  } else {
    const ids = options.siteAtomIds ?? []
    if (ids.length < 1 || ids.length > 3) throw new SurfaceInputError('invalid_manual_site', 'siteAtomIds must contain one, two, or three IDs')
    if (new Set(ids).size !== ids.length) throw new SurfaceInputError('invalid_manual_site', 'siteAtomIds must not contain duplicates')
    const byId = new Map(options.structure.atoms.map((atom, index) => [atom.id, index]))
    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length) throw new SurfaceInputError('site_atoms_missing', `Site atom IDs are missing: ${missing.join(', ')}`)
    detectedSite = siteFromManualSelection(atoms, ids.map((id) => byId.get(id)!), {
      surface_up: options.surfaceUp ? unit(options.surfaceUp, 'surfaceUp') : latticeSurfaceUp(options.structure),
      lattice: adsorptionSurfaceLattice(options.structure),
    })
  }
  if (!detectedSite) throw new SurfaceInputError('site_not_found', 'Could not construct the requested adsorption site')

  const placement = placeFragment({
    atoms,
    site: detectedSite,
    fragment,
    bond_length: options.bondLengthA,
    collision_factor: options.collisionFactor,
    tilt_deg: tiltDeg,
    azimuth_deg: azimuthDeg,
  })
  const site = canonicalSite(detectedSite, options.structure)
  if (surfaceBondPolicy === 'anchor-to-site-atoms' && new Set(site.atomIds).size !== site.atomIds.length) {
    throw new SurfaceInputError(
      'periodic_surface_bond_unrepresentable',
      'This site binds multiple periodic images of one canonical surface atom; enlarge the surface cell before declaring explicit anchor-to-site bonds',
    )
  }
  const usedIds = new Set(options.structure.atoms.map((atom) => atom.id))
  const safeFragment = fragment.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const addedAtoms = placement.newAtoms.map((atom, index) => {
    const id = uniqueAddedId(`adsorbate-${safeFragment}-${detectedSite!.id}-${index + 1}`, usedIds)
    usedIds.add(id)
    return {
      id,
      element: atom.element,
      position: [...atom.cartesian] as Vec3,
      properties: {
        'zatom.role': 'adsorbate',
        'zatom.fragment': fragment.id,
        'zatom.anchor': index === fragment.anchor,
      },
    }
  })
  const usedBondIds = new Set((options.structure.bonds ?? []).map((bond) => bond.id))
  const addedBonds = (FRAGMENT_BONDS[fragment.id] ?? []).map((bond, index) => {
    const id = uniqueAddedId(`adsorbate-${safeFragment}-${detectedSite!.id}-bond-${index + 1}`, usedBondIds)
    usedBondIds.add(id)
    return {
      id,
      atomIds: [addedAtoms[bond.from].id, addedAtoms[bond.to].id] as [string, string],
      order: bond.order,
      properties: { 'zatom.role': 'adsorbate-internal-bond' },
    }
  })
  const surfaceBonds = surfaceBondPolicy === 'anchor-to-site-atoms'
    ? site.atomIds.map((surfaceAtomId, index) => {
        const id = uniqueAddedId(`adsorbate-${safeFragment}-${detectedSite!.id}-surface-bond-${index + 1}`, usedBondIds)
        usedBondIds.add(id)
        return {
          id,
          atomIds: [addedAtoms[fragment.anchor].id, surfaceAtomId] as [string, string],
          order: surfaceBondOrder,
          properties: {
            'zatom.role': 'declared-adsorbate-surface-bond',
            'zatom.adsorption.siteId': site.id,
            'zatom.adsorption.surfaceAtomImage': [...site.atomImages[index]],
          },
        }
      })
    : []
  const structure: ZatomStructure = {
    ...options.structure,
    label: `${options.structure.label ?? 'surface'} + ${fragment.label}@${detectedSite.id}`,
    atoms: [...options.structure.atoms.map((atom) => ({ ...atom, position: [...atom.position] as Vec3 })), ...addedAtoms],
    ...((options.structure.bonds || addedBonds.length || surfaceBonds.length) ? {
      bonds: [...(options.structure.bonds ?? []), ...addedBonds, ...surfaceBonds],
    } : {}),
  }
  const siteCenter = [...(detectedSite.bindingPosition ?? site.bindingPosition)] as Vec3
  const anchorDistanceA = distance(addedAtoms[fragment.anchor].position, siteCenter)
  const collisionAudit = auditAdsorbateSurfaceCollision(options.structure, addedAtoms, options.collisionFactor ?? 0.8)
  const collision = collisionAudit.collision
  const validation = validateStructure(structure)
  const checks: ValidationCheck[] = [
    ...detectionChecks,
    {
      id: 'adsorbate.site_resolved',
      status: 'pass',
      message: `Resolved ${site.kind} site ${site.id} from ${site.atomIds.length} surface atoms`,
      atomIds: site.atomIds,
    },
    {
      id: 'adsorbate.collision',
      status: collision ? 'fail' : 'pass',
      message: collision
        ? `Adsorbate collision: ${collision.addedAtomId}–${collision.existingAtomId} is ${collision.distanceA.toFixed(4)} Å (threshold ${collision.thresholdA.toFixed(4)} Å)`
        : 'Placed fragment passes exact periodic covalent-radius collision screening',
      metrics: {
        minimumAdsorbateSurfaceDistanceA: collisionAudit.minimumDistanceA,
        pairCount: collisionAudit.pairCount,
        minimumImageCandidateEvaluations: collisionAudit.minimumImageCandidateEvaluations,
        ...(collision ? { distanceA: collision.distanceA, thresholdA: collision.thresholdA } : {}),
      },
      atomIds: collision ? [collision.addedAtomId, collision.existingAtomId] : addedAtoms.map((atom) => atom.id),
    },
    {
      id: 'adsorbate.orientation',
      status: 'pass',
      message: `Applied local tilt ${tiltDeg.toFixed(6)}° and azimuth ${azimuthDeg.toFixed(6)}° before aligning fragment +z to the surface normal`,
      metrics: { tiltDeg, azimuthDeg },
      atomIds: addedAtoms.map((atom) => atom.id),
    },
    {
      id: 'adsorbate.surface_bonds',
      status: surfaceBondPolicy === 'none' ? 'skipped' : 'pass',
      message: surfaceBondPolicy === 'none'
        ? 'No adsorbate-surface bond topology was requested'
        : `Added ${surfaceBonds.length} explicitly declared anchor-to-site bond(s) of order ${surfaceBondOrder}; this records modeling intent rather than inferred bond formation`,
      metrics: { surfaceBondCount: surfaceBonds.length, surfaceBondOrder },
      atomIds: [addedAtoms[fragment.anchor].id, ...site.atomIds],
    },
    {
      id: 'adsorbate.anchor_distance',
      status: 'pass',
      message: `Fragment anchor is ${anchorDistanceA.toFixed(4)} Å from the defining site center`,
      metrics: { anchorDistanceA },
      atomIds: [addedAtoms[fragment.anchor].id, ...site.atomIds],
    },
    {
      id: 'adsorbate.model_scope',
      status: 'warn',
      message: 'Site, height, tilt, azimuth, and optional surface bonds define an unrelaxed geometric/topological hypothesis. No bond order, reconstruction, adsorption energy, preferred pose, reaction, relaxation, or stability is inferred.',
    },
    ...validation.checks,
  ]
  const changeSet = buildStructureChangeSet(options.structure, structure)
  const addedBounds = boundsOfPositions(addedAtoms.map((atom) => atom.position))!
  const inspectionTargets: InspectionTarget[] = [{
    id: 'placed-adsorbate',
    reason: `Inspect ${fragment.label} at ${site.kind} site ${site.id}`,
    center: addedBounds.center,
    radius: Math.max(1.5, addedBounds.radius + 1),
    atomIds: [...site.atomIds, ...addedAtoms.map((atom) => atom.id)].slice(0, 80),
    atomIdsTruncated: site.atomIds.length + addedAtoms.length > 80,
  }]
  inspectionTargets.push(...validation.inspectionTargets)
  const provenance: StructureProvenance = {
    engine: 'zatom-adsorbate-builder',
    engineVersion: '1.0.0',
    sourceFingerprint: fingerprintStructure(options.structure),
    resultFingerprint: fingerprintStructure(structure),
    parameters: {
      fragment: fragment.id,
      siteId: site.id,
      siteAtomIds: site.atomIds,
      surfaceUp: options.surfaceUp ?? latticeSurfaceUp(options.structure),
      bondLengthA: options.bondLengthA ?? null,
      collisionFactor: options.collisionFactor ?? 0.8,
      tiltDeg,
      azimuthDeg,
      surfaceBondPolicy,
      surfaceBondOrder,
    },
  }
  return {
    structure,
    site,
    addedAtomIds: addedAtoms.map((atom) => atom.id),
    surfaceBondIds: surfaceBonds.map((bond) => bond.id),
    validation,
    checks,
    changeSet,
    provenance,
    inspectionTargets,
    collision,
    anchorDistanceA,
    orientation: { tiltDeg, azimuthDeg },
  }
}
