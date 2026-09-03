/** Browser-safe canonical contract for OVITO PTM per-atom annotations. */

import type { JsonValue, ZatomStructure } from './contracts'

export const ZATOM_OVITO_PTM_ANNOTATION_SCHEMA = 'zatom.ovito-ptm-annotation/v2' as const
export const ZATOM_OVITO_PTM_PROPERTY_PREFIX = 'zatom.analysis.ptm' as const
export const ZATOM_OVITO_PTM_METADATA_KEY = 'zatom.analysis.ptm' as const

export const ZATOM_OVITO_PTM_STRUCTURE_TYPES = [
  'fcc',
  'hcp',
  'bcc',
  'ico',
  'sc',
  'cubic-diamond',
  'hexagonal-diamond',
  'graphene',
] as const

export type ZatomOvitoPtmStructureType = typeof ZATOM_OVITO_PTM_STRUCTURE_TYPES[number]

export const ZATOM_OVITO_PTM_TYPE_BY_ID = [
  'other',
  ...ZATOM_OVITO_PTM_STRUCTURE_TYPES,
] as const

export type ZatomOvitoPtmClassification = typeof ZATOM_OVITO_PTM_TYPE_BY_ID[number]

export const ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID = [
  'other',
  'pure',
  'l10',
  'l12-a',
  'l12-b',
  'b2',
  'zincblende-wurtzite',
  'boron-nitride',
] as const

export type ZatomOvitoPtmOrderingType = typeof ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID[number]

export type ZatomOvitoPtmOrientation = [number, number, number, number]
export type ZatomOvitoPtmElasticDeformationGradient = [
  number, number, number,
  number, number, number,
  number, number, number,
]

export interface ZatomOvitoPtmElasticMetrics {
  greenLagrangeStrainMagnitude: number
  volumeRatio: number
}

export interface ZatomOvitoPtmAtomAnnotation {
  analyzed: boolean
  structureTypeId: number
  structureType: ZatomOvitoPtmClassification
  rmsd: number
  interatomicDistanceA: number | null
  orientationXyzw: ZatomOvitoPtmOrientation | null
  orderingTypeId: number | null
  orderingType: ZatomOvitoPtmOrderingType | null
  elasticDeformationGradientColumnMajor: ZatomOvitoPtmElasticDeformationGradient | null
  elasticGreenLagrangeStrainMagnitude: number | null
  elasticVolumeRatio: number | null
}

export interface ZatomOvitoPtmAnnotationSummary {
  schemaVersion: typeof ZATOM_OVITO_PTM_ANNOTATION_SCHEMA
  engineVersion: string
  numpyVersion: string
  rmsdCutoff: number
  enabledStructureTypes: ZatomOvitoPtmStructureType[]
  analyzedAtomCount: number
  totalAtomCount: number
  counts: Record<ZatomOvitoPtmClassification, number>
  otherFraction: number
  maximumOtherFraction: number
  orderingEnabled: boolean
  orderingCounts: Record<ZatomOvitoPtmOrderingType, number> | null
  deformationGradientEnabled: boolean
  deformationGradientAtomCount: number
  maximumElasticStrainMagnitude: number | null
  maximumElasticStrainAtomId: string | null
  scopeWarning: string
}

export interface ParsedZatomOvitoPtmAnnotation {
  summary: ZatomOvitoPtmAnnotationSummary
  atoms: Map<string, ZatomOvitoPtmAtomAnnotation>
}

export class ZatomOvitoPtmAnnotationInputError extends Error {
  readonly code = 'invalid_ovito_ptm_annotation'
}

const ANNOTATION_FIELDS = [
  'schemaVersion',
  'engine',
  'engineVersion',
  'numpyVersion',
  'packageSha256',
  'rmsdCutoff',
  'enabledStructureTypes',
  'analyzedAtomCount',
  'counts',
  'recognizedFraction',
  'otherFraction',
  'maximumOtherFraction',
  'orderingEnabled',
  'orderingCounts',
  'deformationGradientEnabled',
  'deformationGradientAtomCount',
  'maximumElasticStrainMagnitude',
  'maximumElasticStrainAtomId',
  'scopeWarning',
  'citations',
] as const

const COMMON_ATOM_PROPERTY_SUFFIXES = [
  'analyzed',
  'structureTypeId',
  'structureType',
  'rmsd',
] as const

function isRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function fail(message: string): never {
  throw new ZatomOvitoPtmAnnotationInputError(message)
}

function finiteNumber(value: JsonValue | undefined, field: string, minimum = -Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    fail(`${field} must be a finite number${Number.isFinite(minimum) ? ` >= ${minimum}` : ''}`)
  }
  return value
}

function finiteArray(value: JsonValue | undefined, length: number, field: string): number[] {
  if (!Array.isArray(value) || value.length !== length
    || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    fail(`${field} must contain ${length} finite numbers`)
  }
  return value as number[]
}

function exactFields(value: Record<string, JsonValue>, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(`${field} must contain exactly ${sortedExpected.join(', ')}`)
  }
}

function exactPtmAtomProperties(
  properties: Record<string, JsonValue>,
  expectedSuffixes: readonly string[],
  atomId: string,
): void {
  const prefix = `${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.`
  const actual = Object.keys(properties).filter((key) => key.startsWith(prefix)).sort()
  const expected = expectedSuffixes.map((suffix) => `${prefix}${suffix}`).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`Atom ${atomId} PTM properties must contain exactly ${expected.join(', ')}`)
  }
}

function close(actual: number, expected: number, tolerance = 1e-12): boolean {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(actual), Math.abs(expected))
}

/**
 * Derive rotation-invariant strain magnitude and local volume ratio from OVITO's
 * documented column-major elastic deformation gradient. The strain measure is
 * ||E||_F for E=(F^T F-I)/2.
 */
export function deriveOvitoPtmElasticMetrics(
  gradient: readonly number[],
): ZatomOvitoPtmElasticMetrics {
  if (gradient.length !== 9 || gradient.some((value) => !Number.isFinite(value))) {
    throw new Error('Elastic deformation gradient must contain nine finite column-major components')
  }
  const matrix = [
    [gradient[0], gradient[3], gradient[6]],
    [gradient[1], gradient[4], gradient[7]],
    [gradient[2], gradient[5], gradient[8]],
  ]
  const c = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
    matrix[0][row] * matrix[0][column]
    + matrix[1][row] * matrix[1][column]
    + matrix[2][row] * matrix[2][column]
  )))
  const e00 = (c[0][0] - 1) / 2
  const e11 = (c[1][1] - 1) / 2
  const e22 = (c[2][2] - 1) / 2
  const e01 = c[0][1] / 2
  const e02 = c[0][2] / 2
  const e12 = c[1][2] / 2
  const greenLagrangeStrainMagnitude = Math.sqrt(
    e00 * e00 + e11 * e11 + e22 * e22
    + 2 * (e01 * e01 + e02 * e02 + e12 * e12),
  )
  const volumeRatio = (
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  )
  return {
    greenLagrangeStrainMagnitude: Object.is(greenLagrangeStrainMagnitude, -0) ? 0 : greenLagrangeStrainMagnitude,
    volumeRatio: Object.is(volumeRatio, -0) ? 0 : volumeRatio,
  }
}

function parseCounts<T extends string>(
  value: JsonValue | undefined,
  types: readonly T[],
  field: string,
): Record<T, number> {
  if (!isRecord(value)) fail(`${field} must be an object`)
  exactFields(value, types, field)
  return Object.fromEntries(types.map((type) => {
    const count = value[type]
    if (!Number.isSafeInteger(count) || Number(count) < 0) fail(`${field}.${type} must be a non-negative safe integer`)
    return [type, Number(count)]
  })) as Record<T, number>
}

/**
 * Parse one complete v2 PTM annotation. Missing metadata returns null; any
 * present v1 or inconsistent property set fails closed.
 */
export function parseZatomOvitoPtmAnnotation(
  structure: ZatomStructure,
): ParsedZatomOvitoPtmAnnotation | null {
  const raw = structure.metadata?.[ZATOM_OVITO_PTM_METADATA_KEY]
  if (raw === undefined) return null
  if (!isRecord(raw)) fail(`${ZATOM_OVITO_PTM_METADATA_KEY} metadata must be an object`)
  exactFields(raw, ANNOTATION_FIELDS, ZATOM_OVITO_PTM_METADATA_KEY)
  if (raw.schemaVersion !== ZATOM_OVITO_PTM_ANNOTATION_SCHEMA) {
    fail(`Unsupported OVITO PTM annotation schema ${String(raw.schemaVersion)}`)
  }
  if (raw.engine !== 'OVITO') fail('OVITO PTM annotation engine must be OVITO')
  if (typeof raw.engineVersion !== 'string' || !raw.engineVersion.trim()) fail('OVITO engineVersion is required')
  if (typeof raw.numpyVersion !== 'string' || !raw.numpyVersion.trim()) fail('OVITO NumPy version is required')
  if (typeof raw.packageSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(raw.packageSha256)) {
    fail('OVITO packageSha256 must be one lowercase SHA-256 identity')
  }
  const rmsdCutoff = finiteNumber(raw.rmsdCutoff, 'rmsdCutoff', Number.EPSILON)
  const maximumOtherFraction = finiteNumber(raw.maximumOtherFraction, 'maximumOtherFraction', 0)
  if (maximumOtherFraction > 1) fail('maximumOtherFraction must be <= 1')
  if (typeof raw.scopeWarning !== 'string' || !raw.scopeWarning.trim()) fail('scopeWarning is required')
  if (!Array.isArray(raw.citations) || !raw.citations.length
    || raw.citations.some((item) => typeof item !== 'string' || !item.trim())) {
    fail('citations must contain one or more non-empty strings')
  }

  if (!Array.isArray(raw.enabledStructureTypes) || !raw.enabledStructureTypes.length) {
    fail('enabledStructureTypes must be a non-empty array')
  }
  const enabledStructureTypes = raw.enabledStructureTypes.map((value) => {
    if (typeof value !== 'string' || !ZATOM_OVITO_PTM_STRUCTURE_TYPES.includes(value as ZatomOvitoPtmStructureType)) {
      fail(`Unsupported enabled PTM structure type ${String(value)}`)
    }
    return value as ZatomOvitoPtmStructureType
  })
  const canonicalEnabled = ZATOM_OVITO_PTM_STRUCTURE_TYPES.filter((type) => enabledStructureTypes.includes(type))
  if (canonicalEnabled.length !== enabledStructureTypes.length
    || canonicalEnabled.some((type, index) => type !== enabledStructureTypes[index])) {
    fail('enabledStructureTypes must be unique and use canonical PTM type order')
  }

  if (!Number.isSafeInteger(raw.analyzedAtomCount) || Number(raw.analyzedAtomCount) < 0) {
    fail('analyzedAtomCount must be a non-negative safe integer')
  }
  const analyzedAtomCount = Number(raw.analyzedAtomCount)
  const declaredCounts = parseCounts(raw.counts, ZATOM_OVITO_PTM_TYPE_BY_ID, 'counts')
  if (Object.values(declaredCounts).reduce((sum, count) => sum + count, 0) !== analyzedAtomCount) {
    fail('PTM counts do not sum to analyzedAtomCount')
  }
  const declaredOtherFraction = finiteNumber(raw.otherFraction, 'otherFraction', 0)
  const declaredRecognizedFraction = finiteNumber(raw.recognizedFraction, 'recognizedFraction', 0)
  if (declaredOtherFraction > 1 || declaredRecognizedFraction > 1
    || !close(declaredOtherFraction + declaredRecognizedFraction, 1)) {
    fail('PTM recognized/Other fractions must be complementary values in [0, 1]')
  }

  if (typeof raw.orderingEnabled !== 'boolean') fail('orderingEnabled must be boolean')
  const orderingEnabled = raw.orderingEnabled
  const sourceElementCount = new Set(structure.atoms.map((atom) => atom.element)).size
  if (orderingEnabled && analyzedAtomCount !== structure.atoms.length) {
    fail('Chemical-ordering annotations must analyze the complete source structure')
  }
  if (orderingEnabled && sourceElementCount > 2) {
    fail(`Chemical-ordering annotations support at most two source elements, received ${sourceElementCount}`)
  }
  const declaredOrderingCounts = orderingEnabled
    ? parseCounts(raw.orderingCounts, ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID, 'orderingCounts')
    : null
  if (!orderingEnabled && raw.orderingCounts !== null) fail('orderingCounts must be null when ordering is disabled')
  if (declaredOrderingCounts
    && Object.values(declaredOrderingCounts).reduce((sum, count) => sum + count, 0) !== analyzedAtomCount) {
    fail('PTM orderingCounts do not sum to analyzedAtomCount')
  }

  if (typeof raw.deformationGradientEnabled !== 'boolean') fail('deformationGradientEnabled must be boolean')
  const deformationGradientEnabled = raw.deformationGradientEnabled
  if (!Number.isSafeInteger(raw.deformationGradientAtomCount)
    || Number(raw.deformationGradientAtomCount) < 0) {
    fail('deformationGradientAtomCount must be a non-negative safe integer')
  }
  const declaredDeformationCount = Number(raw.deformationGradientAtomCount)
  if (!deformationGradientEnabled && declaredDeformationCount !== 0) {
    fail('deformationGradientAtomCount must be zero when deformation output is disabled')
  }
  const declaredMaximumStrain = raw.maximumElasticStrainMagnitude === null
    ? null
    : finiteNumber(raw.maximumElasticStrainMagnitude, 'maximumElasticStrainMagnitude', 0)
  const declaredMaximumAtomId = raw.maximumElasticStrainAtomId
  if (declaredMaximumAtomId !== null
    && (typeof declaredMaximumAtomId !== 'string' || !declaredMaximumAtomId)) {
    fail('maximumElasticStrainAtomId must be null or a non-empty atom ID')
  }
  if ((declaredMaximumStrain === null) !== (declaredMaximumAtomId === null)) {
    fail('maximum elastic strain value and atom ID must either both be null or both be present')
  }

  const atoms = new Map<string, ZatomOvitoPtmAtomAnnotation>()
  const actualCounts = Object.fromEntries(
    ZATOM_OVITO_PTM_TYPE_BY_ID.map((type) => [type, 0]),
  ) as Record<ZatomOvitoPtmClassification, number>
  const actualOrderingCounts = orderingEnabled
    ? Object.fromEntries(ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID.map((type) => [type, 0])) as Record<ZatomOvitoPtmOrderingType, number>
    : null
  let actualAnalyzedCount = 0
  let actualDeformationCount = 0
  let actualMaximumStrain: number | null = null
  let actualMaximumAtomId: string | null = null

  for (const atom of structure.atoms) {
    const properties = atom.properties ?? {}
    const analyzed = properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.analyzed`]
    const structureTypeId = properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.structureTypeId`]
    const structureType = properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.structureType`]
    const rmsd = properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.rmsd`]
    if (typeof analyzed !== 'boolean') fail(`Atom ${atom.id} has no canonical PTM analyzed flag`)
    if (!Number.isSafeInteger(structureTypeId) || Number(structureTypeId) < 0
      || Number(structureTypeId) >= ZATOM_OVITO_PTM_TYPE_BY_ID.length) {
      fail(`Atom ${atom.id} has an invalid PTM structureTypeId`)
    }
    const typeId = Number(structureTypeId)
    const expectedType = ZATOM_OVITO_PTM_TYPE_BY_ID[typeId]
    if (structureType !== expectedType) fail(`Atom ${atom.id} PTM type ID/name do not agree`)
    const finiteRmsd = finiteNumber(rmsd, `Atom ${atom.id} PTM RMSD`, 0)
    if (!analyzed && typeId !== 0) fail(`Unanalyzed atom ${atom.id} must have PTM type Other`)
    if (analyzed && typeId > 0 && !enabledStructureTypes.includes(expectedType as ZatomOvitoPtmStructureType)) {
      fail(`Atom ${atom.id} uses disabled PTM type ${expectedType}`)
    }

    const recognized = analyzed && typeId > 0
    const expectedSuffixes: string[] = [...COMMON_ATOM_PROPERTY_SUFFIXES]
    let interatomicDistanceA: number | null = null
    let orientationXyzw: ZatomOvitoPtmOrientation | null = null
    if (recognized) {
      expectedSuffixes.push('interatomicDistanceA', 'orientationXyzw')
      interatomicDistanceA = finiteNumber(
        properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.interatomicDistanceA`],
        `Atom ${atom.id} PTM interatomic distance`,
        Number.EPSILON,
      )
      orientationXyzw = finiteArray(
        properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.orientationXyzw`],
        4,
        `Atom ${atom.id} PTM orientation`,
      ) as ZatomOvitoPtmOrientation
      if (!close(Math.hypot(...orientationXyzw), 1, 1e-5)) {
        fail(`Atom ${atom.id} PTM orientation must be a unit quaternion`)
      }
    }

    let orderingTypeId: number | null = null
    let orderingType: ZatomOvitoPtmOrderingType | null = null
    if (orderingEnabled) {
      expectedSuffixes.push('orderingTypeId', 'orderingType')
      const rawOrderingId = properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.orderingTypeId`]
      if (!Number.isSafeInteger(rawOrderingId) || Number(rawOrderingId) < 0
        || Number(rawOrderingId) >= ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID.length) {
        fail(`Atom ${atom.id} has an invalid PTM orderingTypeId`)
      }
      orderingTypeId = Number(rawOrderingId)
      orderingType = ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID[orderingTypeId]
      if (properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.orderingType`] !== orderingType) {
        fail(`Atom ${atom.id} PTM ordering ID/name do not agree`)
      }
      if (!recognized && orderingTypeId !== 0) {
        fail(`Atom ${atom.id} cannot have chemical ordering without a recognized PTM structure`)
      }
      if (sourceElementCount === 1 && orderingTypeId > 1) {
        fail(`Single-element atom ${atom.id} cannot have compound chemical ordering`)
      }
    }

    let elasticDeformationGradientColumnMajor: ZatomOvitoPtmElasticDeformationGradient | null = null
    let elasticGreenLagrangeStrainMagnitude: number | null = null
    let elasticVolumeRatio: number | null = null
    if (deformationGradientEnabled && recognized) {
      expectedSuffixes.push(
        'elasticDeformationGradientColumnMajor',
        'elasticGreenLagrangeStrainMagnitude',
        'elasticVolumeRatio',
      )
      elasticDeformationGradientColumnMajor = finiteArray(
        properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.elasticDeformationGradientColumnMajor`],
        9,
        `Atom ${atom.id} PTM elastic deformation gradient`,
      ) as ZatomOvitoPtmElasticDeformationGradient
      const derived = deriveOvitoPtmElasticMetrics(elasticDeformationGradientColumnMajor)
      if (!(derived.volumeRatio > 0)) fail(`Atom ${atom.id} PTM elastic deformation gradient must preserve orientation`)
      elasticGreenLagrangeStrainMagnitude = finiteNumber(
        properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.elasticGreenLagrangeStrainMagnitude`],
        `Atom ${atom.id} PTM elastic strain magnitude`,
        0,
      )
      elasticVolumeRatio = finiteNumber(
        properties[`${ZATOM_OVITO_PTM_PROPERTY_PREFIX}.elasticVolumeRatio`],
        `Atom ${atom.id} PTM elastic volume ratio`,
        Number.EPSILON,
      )
      if (!close(elasticGreenLagrangeStrainMagnitude, derived.greenLagrangeStrainMagnitude)
        || !close(elasticVolumeRatio, derived.volumeRatio)) {
        fail(`Atom ${atom.id} PTM elastic deformation invariants do not replay from F`)
      }
      actualDeformationCount++
      if (actualMaximumStrain === null || elasticGreenLagrangeStrainMagnitude > actualMaximumStrain) {
        actualMaximumStrain = elasticGreenLagrangeStrainMagnitude
        actualMaximumAtomId = atom.id
      }
    }
    exactPtmAtomProperties(properties, expectedSuffixes, atom.id)

    if (analyzed) {
      actualAnalyzedCount++
      actualCounts[expectedType]++
      if (actualOrderingCounts && orderingType) actualOrderingCounts[orderingType]++
    }
    atoms.set(atom.id, {
      analyzed,
      structureTypeId: typeId,
      structureType: expectedType,
      rmsd: finiteRmsd,
      interatomicDistanceA,
      orientationXyzw,
      orderingTypeId,
      orderingType,
      elasticDeformationGradientColumnMajor,
      elasticGreenLagrangeStrainMagnitude,
      elasticVolumeRatio,
    })
  }

  if (actualAnalyzedCount !== analyzedAtomCount) fail('Per-atom PTM analyzed flags disagree with metadata')
  for (const type of ZATOM_OVITO_PTM_TYPE_BY_ID) {
    if (actualCounts[type] !== declaredCounts[type]) fail(`Per-atom PTM ${type} count disagrees with metadata`)
  }
  if (actualOrderingCounts && declaredOrderingCounts) {
    for (const type of ZATOM_OVITO_PTM_ORDERING_TYPE_BY_ID) {
      if (actualOrderingCounts[type] !== declaredOrderingCounts[type]) {
        fail(`Per-atom PTM ordering ${type} count disagrees with metadata`)
      }
    }
  }
  if (actualDeformationCount !== declaredDeformationCount) {
    fail('Per-atom PTM deformation-gradient count disagrees with metadata')
  }
  if (actualMaximumAtomId !== declaredMaximumAtomId
    || (actualMaximumStrain === null) !== (declaredMaximumStrain === null)
    || (actualMaximumStrain !== null && declaredMaximumStrain !== null
      && !close(actualMaximumStrain, declaredMaximumStrain))) {
    fail('Per-atom PTM maximum elastic strain disagrees with metadata')
  }
  const actualOtherFraction = analyzedAtomCount ? actualCounts.other / analyzedAtomCount : 0
  const actualRecognizedFraction = analyzedAtomCount ? 1 - actualOtherFraction : 0
  if (!close(actualOtherFraction, declaredOtherFraction)
    || !close(actualRecognizedFraction, declaredRecognizedFraction)) {
    fail('Per-atom PTM classification fractions disagree with metadata')
  }

  return {
    summary: {
      schemaVersion: ZATOM_OVITO_PTM_ANNOTATION_SCHEMA,
      engineVersion: raw.engineVersion,
      numpyVersion: raw.numpyVersion,
      rmsdCutoff,
      enabledStructureTypes,
      analyzedAtomCount,
      totalAtomCount: structure.atoms.length,
      counts: actualCounts,
      otherFraction: actualOtherFraction,
      maximumOtherFraction,
      orderingEnabled,
      orderingCounts: actualOrderingCounts,
      deformationGradientEnabled,
      deformationGradientAtomCount: actualDeformationCount,
      maximumElasticStrainMagnitude: actualMaximumStrain,
      maximumElasticStrainAtomId: actualMaximumAtomId,
      scopeWarning: raw.scopeWarning,
    },
    atoms,
  }
}
