/** Deterministic finite Voronoi polycrystal construction from any periodic canonical parent cell. */

import { generatePolycrystal, type BaseCell, type PolycrystalResult } from '../lib/polycrystal'
import type { InspectionTarget, ValidationCheck, Vec3, ZatomStructure } from './contracts'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import {
  boundsOfPositions,
  cartesianToFractional,
  determinant3,
  fingerprintStructure,
  wrapFractional,
} from './structure-math'
import { parseZatomStructure, validateStructure } from './structure-validation'

export const ZATOM_POLYCRYSTAL_METADATA_SCHEMA = 'zatom.polycrystal/v1' as const
export const ZATOM_POLYCRYSTAL_GRAIN_ID_PROPERTY = 'zatom.polycrystal.grainId' as const
export const ZATOM_POLYCRYSTAL_SOURCE_ATOM_ID_PROPERTY = 'zatom.polycrystal.sourceAtomId' as const
export const ZATOM_POLYCRYSTAL_SOURCE_BASIS_INDEX_PROPERTY = 'zatom.polycrystal.sourceBasisIndex' as const

const MAX_BASE_ATOMS = 4096

export class ZatomPolycrystalInputError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ZatomPolycrystalInputError'
    this.code = code
  }
}

export interface BuildZatomPolycrystalOptions {
  source: ZatomStructure
  boxSizeA: number
  grainCount: number
  minSeedDistanceA: number
  overlapDistanceA: number
  maxAtoms: number
  seed: number
  label?: string
}

export interface ZatomPolycrystalMetrics {
  sourceAtomCount: number
  atomCount: number
  grainCount: number
  realizedGrainCount: number
  boxSizeA: number
  sourceCellVolumeA3: number
  estimatedAtomCount: number
  minimumSeedDistanceA: number | null
  requestedMinimumSeedDistanceA: number
  requestedCrossGrainDistanceA: number
  minimumAuditedCrossGrainDistanceA: number | null
  crossGrainViolationCount: number
  maximumRotationOrthonormalError: number
  maximumRotationDeterminantError: number
}

export interface BuildZatomPolycrystalResult {
  structure: ZatomStructure
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  metrics: ZatomPolycrystalMetrics
  limitations: string[]
}

interface ContactAudit {
  violationCount: number
  minimumDistanceA: number | null
  closestPair: [number, number] | null
}

function finite(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ZatomPolycrystalInputError('invalid_polycrystal_input', `${field} must be finite from ${minimum} through ${maximum}`)
  }
  return value
}

function integer(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ZatomPolycrystalInputError('invalid_polycrystal_input', `${field} must be an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function minimumSeedDistance(seeds: Float32Array): number | null {
  if (seeds.length < 6) return null
  let minimum = Infinity
  for (let left = 0; left < seeds.length / 3; left++) {
    for (let right = left + 1; right < seeds.length / 3; right++) {
      minimum = Math.min(minimum, Math.hypot(
        seeds[left * 3] - seeds[right * 3],
        seeds[left * 3 + 1] - seeds[right * 3 + 1],
        seeds[left * 3 + 2] - seeds[right * 3 + 2],
      ))
    }
  }
  return minimum
}

function rotationErrors(rotations: Float64Array): {
  maximumOrthonormalError: number
  maximumDeterminantError: number
} {
  let maximumOrthonormalError = 0
  let maximumDeterminantError = 0
  for (let offset = 0; offset < rotations.length; offset += 9) {
    const rows: [Vec3, Vec3, Vec3] = [
      [rotations[offset], rotations[offset + 1], rotations[offset + 2]],
      [rotations[offset + 3], rotations[offset + 4], rotations[offset + 5]],
      [rotations[offset + 6], rotations[offset + 7], rotations[offset + 8]],
    ]
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        const dot = rows[row][0] * rows[column][0]
          + rows[row][1] * rows[column][1]
          + rows[row][2] * rows[column][2]
        maximumOrthonormalError = Math.max(maximumOrthonormalError, Math.abs(dot - (row === column ? 1 : 0)))
      }
    }
    maximumDeterminantError = Math.max(maximumDeterminantError, Math.abs(determinant3(rows) - 1))
  }
  return { maximumOrthonormalError, maximumDeterminantError }
}

function auditCrossGrainContacts(result: PolycrystalResult, thresholdA: number): ContactAudit {
  if (thresholdA <= 0 || result.count < 2) {
    return { violationCount: 0, minimumDistanceA: null, closestPair: null }
  }
  const buckets = new Map<string, number[]>()
  const cellIndex = (value: number) => Math.floor(value / thresholdA)
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let index = 0; index < result.count; index++) {
    const bucketKey = key(
      cellIndex(result.positions[index * 3]),
      cellIndex(result.positions[index * 3 + 1]),
      cellIndex(result.positions[index * 3 + 2]),
    )
    const bucket = buckets.get(bucketKey)
    if (bucket) bucket.push(index)
    else buckets.set(bucketKey, [index])
  }
  let violationCount = 0
  let minimumDistanceA = Infinity
  let closestPair: [number, number] | null = null
  const thresholdSquared = thresholdA * thresholdA
  for (let left = 0; left < result.count; left++) {
    const x = result.positions[left * 3]
    const y = result.positions[left * 3 + 1]
    const z = result.positions[left * 3 + 2]
    const bx = cellIndex(x), by = cellIndex(y), bz = cellIndex(z)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const candidates = buckets.get(key(bx + dx, by + dy, bz + dz))
      if (!candidates) continue
      for (const right of candidates) {
        if (right <= left || result.grainId[right] === result.grainId[left]) continue
        const distanceSquared = (result.positions[right * 3] - x) ** 2
          + (result.positions[right * 3 + 1] - y) ** 2
          + (result.positions[right * 3 + 2] - z) ** 2
        if (distanceSquared < minimumDistanceA * minimumDistanceA) {
          minimumDistanceA = Math.sqrt(distanceSquared)
          closestPair = [left, right]
        }
        if (distanceSquared < thresholdSquared) violationCount++
      }
    }
  }
  return {
    violationCount,
    minimumDistanceA: Number.isFinite(minimumDistanceA) ? minimumDistanceA : null,
    closestPair,
  }
}

function grainTargets(
  structure: ZatomStructure,
  result: PolycrystalResult,
  closestPair: [number, number] | null,
): InspectionTarget[] {
  const bounds = boundsOfPositions(structure.atoms.map((atom) => atom.position))
  const targets: InspectionTarget[] = bounds ? [{
    id: 'polycrystal-overview',
    reason: 'Inspect the complete finite Voronoi polycrystal and its free box surfaces',
    center: bounds.center,
    radius: Math.max(bounds.radius, 1),
    atomIds: structure.atoms.slice(0, 256).map((atom) => atom.id),
    ...(structure.atoms.length > 256 ? { atomIdsTruncated: true } : {}),
  }] : []
  const atomsByGrain = Array.from({ length: result.seeds.length / 3 }, () => [] as string[])
  for (let index = 0; index < structure.atoms.length; index++) {
    const ids = atomsByGrain[result.grainId[index]]
    if (ids.length < 32) ids.push(structure.atoms[index].id)
  }
  const targetGrains = Math.min(atomsByGrain.length, 12)
  const grainRadius = Math.max(2, result.bbox.max[0] / Math.cbrt(Math.max(1, atomsByGrain.length)) * 0.6)
  for (let grain = 0; grain < targetGrains; grain++) {
    targets.push({
      id: `polycrystal-grain-${String(grain + 1).padStart(4, '0')}`,
      reason: `Inspect grain ${grain + 1}, its seed neighborhood, orientation, and boundary contacts`,
      center: [result.seeds[grain * 3], result.seeds[grain * 3 + 1], result.seeds[grain * 3 + 2]],
      radius: grainRadius,
      atomIds: atomsByGrain[grain],
      ...(atomsByGrain[grain].length === 32 ? { atomIdsTruncated: true } : {}),
    })
  }
  if (closestPair) {
    const left = structure.atoms[closestPair[0]]
    const right = structure.atoms[closestPair[1]]
    targets.push({
      id: 'polycrystal-closest-cross-grain-contact',
      reason: 'Inspect the closest audited atom pair belonging to different grains',
      center: [
        (left.position[0] + right.position[0]) / 2,
        (left.position[1] + right.position[1]) / 2,
        (left.position[2] + right.position[2]) / 2,
      ],
      radius: Math.max(1, Math.hypot(
        left.position[0] - right.position[0],
        left.position[1] - right.position[1],
        left.position[2] - right.position[2],
      )),
      atomIds: [left.id, right.id],
    })
  }
  return targets
}

export function buildZatomPolycrystal(options: BuildZatomPolycrystalOptions): BuildZatomPolycrystalResult {
  const source = parseZatomStructure(options.source)
  const boxSizeA = finite(options.boxSizeA, 'boxSizeA', 1, 1000)
  const grainCount = integer(options.grainCount, 'grainCount', 1, 256)
  const minSeedDistanceA = finite(options.minSeedDistanceA, 'minSeedDistanceA', 0, 1000)
  const overlapDistanceA = finite(options.overlapDistanceA, 'overlapDistanceA', 0, 20)
  const maxAtoms = integer(options.maxAtoms, 'maxAtoms', 1, 500_000)
  const seed = integer(options.seed, 'seed', 0, 0xffffffff)
  if (!source.lattice || !source.lattice.periodic.every(Boolean)) {
    throw new ZatomPolycrystalInputError('polycrystal_periodic_parent_required', 'Polycrystal construction requires a fully periodic parent cell')
  }
  if (source.atoms.length > MAX_BASE_ATOMS) {
    throw new ZatomPolycrystalInputError(
      'polycrystal_parent_budget_exceeded',
      `Parent cell has ${source.atoms.length} atoms above the ${MAX_BASE_ATOMS}-site basis limit`,
    )
  }
  const sourceValidation = validateStructure(source, {
    requirePeriodic: true,
    overlapDistanceA: 1e-6,
    closePairWarningA: 1e-5,
    maxPairScanAtoms: MAX_BASE_ATOMS,
  })
  if (sourceValidation.checks.some((check) => check.status === 'fail')) {
    throw new ZatomPolycrystalInputError('invalid_polycrystal_parent', 'Parent structure has failing geometric validation checks')
  }
  if (sourceValidation.minPairDistanceA !== null && sourceValidation.minPairDistanceA < 1e-5) {
    throw new ZatomPolycrystalInputError('duplicate_polycrystal_parent_site', 'Parent cell contains duplicate periodic atom sites')
  }
  const sourceCellVolumeA3 = determinant3(source.lattice.vectors)
  const basis = source.atoms.map((atom) => {
    const fractional = cartesianToFractional(atom.position, source.lattice!.vectors)
    if (!fractional) throw new ZatomPolycrystalInputError('invalid_polycrystal_parent', 'Parent lattice cannot be inverted')
    return { element: atom.element, frac: wrapFractional(fractional, [true, true, true]) }
  })
  const base: BaseCell = {
    latticeVectors: {
      a: [...source.lattice.vectors[0]],
      b: [...source.lattice.vectors[1]],
      c: [...source.lattice.vectors[2]],
    },
    basis,
  }
  let generated: PolycrystalResult
  try {
    generated = generatePolycrystal({
      baseTemplateKey: fingerprintStructure(source),
      boxSize: boxSizeA,
      grainCount,
      minSeedDistance: minSeedDistanceA,
      overlapDmin: overlapDistanceA,
      maxAtoms,
      seed,
    }, base)
  } catch (error) {
    throw new ZatomPolycrystalInputError(
      'polycrystal_generation_failed',
      error instanceof Error ? error.message : String(error),
    )
  }
  if (!generated.count) throw new ZatomPolycrystalInputError('polycrystal_generation_failed', 'Polycrystal generation produced no atoms')
  if (generated.basisIndex.length !== generated.count || generated.rotations.length !== grainCount * 9) {
    throw new ZatomPolycrystalInputError('invalid_polycrystal_result', 'Generator omitted source-site or grain-orientation identity')
  }
  const atoms = Array.from({ length: generated.count }, (_, index) => {
    const sourceIndex = generated.basisIndex[index]
    const sourceAtom = source.atoms[sourceIndex]
    if (!sourceAtom) throw new ZatomPolycrystalInputError('invalid_polycrystal_result', `Generated atom ${index} has invalid source basis index`)
    const grain = generated.grainId[index]
    return {
      id: `grain-${String(grain + 1).padStart(4, '0')}-atom-${String(index + 1).padStart(8, '0')}`,
      element: sourceAtom.element,
      position: [
        Number(generated.positions[index * 3]),
        Number(generated.positions[index * 3 + 1]),
        Number(generated.positions[index * 3 + 2]),
      ] as Vec3,
      properties: {
        ...(sourceAtom.properties ?? {}),
        [ZATOM_POLYCRYSTAL_GRAIN_ID_PROPERTY]: grain,
        [ZATOM_POLYCRYSTAL_SOURCE_ATOM_ID_PROPERTY]: sourceAtom.id,
        [ZATOM_POLYCRYSTAL_SOURCE_BASIS_INDEX_PROPERTY]: sourceIndex,
      },
    }
  })
  const grainSeeds = Array.from({ length: grainCount }, (_, grain) => [
    Number(generated.seeds[grain * 3]),
    Number(generated.seeds[grain * 3 + 1]),
    Number(generated.seeds[grain * 3 + 2]),
  ] as Vec3)
  const grainRotations = Array.from({ length: grainCount }, (_, grain) => (
    Array.from(generated.rotations.slice(grain * 9, grain * 9 + 9))
  ))
  const structure = parseZatomStructure({
    schemaVersion: ZATOM_STRUCTURE_SCHEMA,
    atoms,
    lattice: {
      vectors: [[boxSizeA, 0, 0], [0, boxSizeA, 0], [0, 0, boxSizeA]],
      periodic: [false, false, false],
    },
    label: options.label?.trim() || `${source.label ?? 'Parent cell'} · ${grainCount}-grain finite polycrystal`,
    metadata: {
      'zatom.polycrystal': {
        schemaVersion: ZATOM_POLYCRYSTAL_METADATA_SCHEMA,
        method: 'finite-euclidean-voronoi-random-shoemake-so3',
        sourceStructureFingerprint: fingerprintStructure(source),
        sourceAtomIds: source.atoms.map((atom) => atom.id),
        boxSizeA,
        grainCount,
        minSeedDistanceA,
        overlapDistanceA,
        maxAtoms,
        seed,
        grainSeeds,
        grainRotations,
        coordinateStorage: 'float32-generator-to-canonical-number',
      },
    },
  })
  const realizedCounts = Array<number>(grainCount).fill(0)
  for (const grain of generated.grainId) realizedCounts[grain]++
  const realizedGrainCount = realizedCounts.filter((count) => count > 0).length
  const measuredSeedDistanceA = minimumSeedDistance(generated.seeds)
  const rotations = rotationErrors(generated.rotations)
  const contactAudit = auditCrossGrainContacts(generated, overlapDistanceA)
  const containmentToleranceA = Math.max(1e-5, boxSizeA * 1e-7)
  const outsideCount = atoms.filter((atom) => atom.position.some((coordinate) => (
    coordinate < -containmentToleranceA || coordinate > boxSizeA + containmentToleranceA
  ))).length
  const seedToleranceA = Math.max(1e-5, minSeedDistanceA * 1e-6)
  const seedSeparationPass = grainCount === 1 || minSeedDistanceA === 0
    || (measuredSeedDistanceA !== null && measuredSeedDistanceA + seedToleranceA >= minSeedDistanceA)
  const crossGrainPass = contactAudit.violationCount === 0
  const estimatedAtomCount = source.atoms.length * boxSizeA ** 3 / sourceCellVolumeA3
  const limitations = [
    'The result is a finite Euclidean Voronoi polycrystal with free box surfaces; opposite faces do not tile periodically.',
    'Grains are rigidly rotated parent lattices with deterministic cross-grain overlap deletion; grain-boundary reconstruction, chemistry, relaxation, segregation, and energy are not modeled.',
    'Shoemake-uniform random SO(3) orientations do not impose a texture, target misorientation distribution, CSL boundary, or experimental grain-size distribution.',
    'Parent atom properties follow their source basis sites, but parent bond topology is omitted because cross-cell and cross-grain bonding is not inferred.',
    'Generated coordinates pass through the existing Float32 polycrystal core before canonical number conversion; this is a geometry seed rather than precision-relaxed evidence.',
  ]
  const outputValidation = validateStructure(structure, {
    overlapDistanceA: 1e-5,
    closePairWarningA: 1e-4,
    maxPairScanAtoms: Math.min(structure.atoms.length, 2000),
  })
  const checks: ValidationCheck[] = [
    {
      id: 'polycrystal.parent_cell',
      status: 'pass',
      message: `Wrapped ${source.atoms.length} unique sites from a fully periodic ${sourceCellVolumeA3.toFixed(6)} Å³ parent cell`,
      metrics: { sourceAtomCount: source.atoms.length, sourceCellVolumeA3, sourceStructureFingerprint: fingerprintStructure(source) },
    },
    {
      id: 'polycrystal.atom_budget',
      status: generated.count <= maxAtoms ? 'pass' : 'fail',
      message: `Generated ${generated.count.toLocaleString()} atoms within the hard ${maxAtoms.toLocaleString()}-atom budget`,
      metrics: { atomCount: generated.count, maxAtoms, estimatedAtomCount },
    },
    {
      id: 'polycrystal.seed_separation',
      status: seedSeparationPass ? 'pass' : 'fail',
      message: grainCount === 1
        ? 'A single grain has no seed pair to separate'
        : minSeedDistanceA === 0
        ? 'Minimum seed separation was explicitly disabled'
        : `Measured minimum seed separation ${measuredSeedDistanceA?.toFixed(6) ?? 'unknown'} Å against ${minSeedDistanceA} Å`,
      metrics: { requestedMinimumSeedDistanceA: minSeedDistanceA, measuredMinimumSeedDistanceA: measuredSeedDistanceA },
    },
    {
      id: 'polycrystal.grain_coverage',
      status: realizedGrainCount === grainCount ? 'pass' : 'fail',
      message: `${realizedGrainCount}/${grainCount} requested grains contain at least one atom`,
      metrics: { requestedGrainCount: grainCount, realizedGrainCount, minimumAtomsPerGrain: Math.min(...realizedCounts) },
    },
    {
      id: 'polycrystal.rotation_invariants',
      status: rotations.maximumOrthonormalError <= 1e-12 && rotations.maximumDeterminantError <= 1e-12 ? 'pass' : 'fail',
      message: `All ${grainCount} grain transforms are proper SO(3) rotations`,
      metrics: {
        maximumOrthonormalError: rotations.maximumOrthonormalError,
        maximumDeterminantError: rotations.maximumDeterminantError,
      },
    },
    {
      id: 'polycrystal.cross_grain_contacts',
      status: overlapDistanceA === 0 ? 'skipped' : crossGrainPass ? 'pass' : 'fail',
      message: overlapDistanceA === 0
        ? 'Cross-grain overlap pruning was explicitly disabled'
        : `${contactAudit.violationCount} cross-grain pairs remain below ${overlapDistanceA} Å`,
      metrics: {
        requestedMinimumDistanceA: overlapDistanceA,
        minimumAuditedCrossGrainDistanceA: contactAudit.minimumDistanceA,
        violationCount: contactAudit.violationCount,
      },
      atomIds: contactAudit.closestPair
        ? contactAudit.closestPair.map((index) => structure.atoms[index].id)
        : [],
    },
    {
      id: 'polycrystal.box_containment',
      status: outsideCount === 0 ? 'pass' : 'fail',
      message: outsideCount === 0
        ? `Every atom lies inside the finite 0-${boxSizeA} Å cube`
        : `${outsideCount} atoms lie outside the finite box tolerance`,
      metrics: { outsideCount, containmentToleranceA },
    },
    {
      id: 'polycrystal.model_scope',
      status: 'warn',
      message: limitations.join(' '),
    },
    ...outputValidation.checks,
  ]
  return {
    structure,
    checks,
    inspectionTargets: grainTargets(structure, generated, contactAudit.closestPair),
    metrics: {
      sourceAtomCount: source.atoms.length,
      atomCount: generated.count,
      grainCount,
      realizedGrainCount,
      boxSizeA,
      sourceCellVolumeA3,
      estimatedAtomCount,
      minimumSeedDistanceA: measuredSeedDistanceA,
      requestedMinimumSeedDistanceA: minSeedDistanceA,
      requestedCrossGrainDistanceA: overlapDistanceA,
      minimumAuditedCrossGrainDistanceA: contactAudit.minimumDistanceA,
      crossGrainViolationCount: contactAudit.violationCount,
      maximumRotationOrthonormalError: rotations.maximumOrthonormalError,
      maximumRotationDeterminantError: rotations.maximumDeterminantError,
    },
    limitations,
  }
}
