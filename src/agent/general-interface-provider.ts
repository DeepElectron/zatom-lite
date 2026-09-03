/** Provider adapter for general 2D integer-supercell interface construction. */

import { ZATOM_STRUCTURE_JSON_SCHEMA, type JsonValue } from './contracts'
import {
  buildGeneral2DInterface,
  GeneralInterfaceInputError,
  type IntMat2,
} from './general-interface'
import { ZATOM_PROVIDER_SCHEMA, ZatomProviderError, type ZatomModelingProvider } from './provider'
import { fingerprintStructure } from './structure-math'
import { parseZatomStructure } from './structure-validation'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) }
}

const matrix2Schema = {
  type: 'array',
  minItems: 2,
  maxItems: 2,
  items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: -512, maximum: 512 } },
}
const pairSchema = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } }

const generalInterfaceInputSchema = objectSchema({
  top: ZATOM_STRUCTURE_JSON_SCHEMA,
  bottomMatrix: matrix2Schema,
  topMatrix: matrix2Schema,
  maxAreaMultiple: { type: 'integer', minimum: 1, maximum: 32, default: 12 },
  maxOutputAtoms: { type: 'integer', minimum: 2, maximum: 100000, default: 20000 },
  maxPrincipalStrain: { type: 'number', minimum: 0, default: 0.05 },
  strainShareTop: { type: 'number', minimum: 0, maximum: 1, default: 1 },
  targetRotationDeg: { type: 'number', description: 'Optional intrinsic top-to-bottom alignment target, modulo 180 degrees' },
  maxRotationErrorDeg: { type: 'number', minimum: 0, default: 1 },
  maxAspectRatio: { type: 'number', minimum: 1, default: 6 },
  maxCandidatePairs: { type: 'integer', minimum: 1, maximum: 10000000, default: 1000000 },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  gapA: { type: 'number', exclusiveMinimum: 0, default: 3 },
  vacuumA: { type: 'number', minimum: 0, default: 12 },
  registryOffsetFractional: pairSchema,
  collisionDistanceA: { type: 'number', exclusiveMinimum: 0, default: 0.6 },
  maxCrossPairs: { type: 'integer', minimum: 1, maximum: 100000000, default: 2000000 },
}, ['top'])

function optionalNumber(record: Record<string, unknown>, name: string): number | undefined {
  if (record[name] === undefined) return undefined
  const value = Number(record[name])
  if (!Number.isFinite(value)) throw new ZatomProviderError('invalid_provider_parameters', `${name} must be finite`)
  return value
}

function matrix2(value: unknown, name: string): IntMat2 | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 2 || value.some((row) => (
    !Array.isArray(row) || row.length !== 2 || row.some((item) => !Number.isInteger(item))
  ))) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must be a 2×2 integer matrix`)
  }
  return [[Number(value[0][0]), Number(value[0][1])], [Number(value[1][0]), Number(value[1][1])]]
}

function pair(value: unknown, name: string): [number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must contain two finite numbers`)
  }
  return [value[0], value[1]]
}

export const GENERAL_2D_INTERFACE_PROVIDER: ZatomModelingProvider = {
  manifest: {
    schemaVersion: ZATOM_PROVIDER_SCHEMA,
    id: 'zatom.general-2d-interface',
    title: 'zatom general 2D coincidence-interface builder',
    description: 'Search HNF/off-diagonal integer supercells, share homogeneous in-plane strain, and construct a validated stacked interface.',
    adapterVersion: '1.0.0',
    engine: { name: 'zatom-hnf-2d-matcher', version: '1.0.0' },
    execution: 'browser',
    capabilities: [{
      id: 'interface.build.hnf2d',
      title: 'Build an HNF/off-diagonal matched interface',
      description: 'Match arbitrary 2D slab lattices with bounded integer matrices, optional intrinsic rotation targeting and strain sharing, then stack with exact gap/vacuum and collision checks.',
      fidelity: 'geometric',
      source: 'required',
      deterministic: true,
      inputSchema: generalInterfaceInputSchema,
      requiredCheckIds: [
        'general_interface.supercell_counts',
        'general_interface.inplane_strain',
        'general_interface.rotation',
        'general_interface.gap',
        'general_interface.cross_distance',
        'general_interface.vacuum',
        'general_interface.topology',
      ],
      tags: ['interface', 'heterostructure', 'coincidence-lattice', 'hnf', 'off-diagonal', 'strain-sharing'],
    }],
  },
  execute: async (request) => {
    if (!request.source) throw new ZatomProviderError('source_required', 'General 2D interface matching requires a bottom source slab')
    const input = request.parameters
    if (input.top === undefined) throw new ZatomProviderError('invalid_provider_parameters', 'top structure is required')
    const top = parseZatomStructure(input.top)
    const bottomMatrix = matrix2(input.bottomMatrix, 'bottomMatrix')
    const topMatrix = matrix2(input.topMatrix, 'topMatrix')
    if ((bottomMatrix === undefined) !== (topMatrix === undefined)) {
      throw new ZatomProviderError('invalid_provider_parameters', 'bottomMatrix and topMatrix must be supplied together')
    }
    let result
    try {
      result = buildGeneral2DInterface({
        bottom: request.source,
        top,
        ...(bottomMatrix && topMatrix ? { bottomMatrix, topMatrix } : {}),
        maxAreaMultiple: optionalNumber(input, 'maxAreaMultiple'),
        maxOutputAtoms: optionalNumber(input, 'maxOutputAtoms'),
        maxPrincipalStrain: optionalNumber(input, 'maxPrincipalStrain'),
        strainShareTop: optionalNumber(input, 'strainShareTop'),
        targetRotationDeg: optionalNumber(input, 'targetRotationDeg'),
        maxRotationErrorDeg: optionalNumber(input, 'maxRotationErrorDeg'),
        maxAspectRatio: optionalNumber(input, 'maxAspectRatio'),
        maxCandidatePairs: optionalNumber(input, 'maxCandidatePairs'),
        limit: optionalNumber(input, 'limit'),
        gapA: optionalNumber(input, 'gapA'),
        vacuumA: optionalNumber(input, 'vacuumA'),
        registryOffsetFractional: pair(input.registryOffsetFractional, 'registryOffsetFractional'),
        collisionDistanceA: optionalNumber(input, 'collisionDistanceA'),
        maxCrossPairs: optionalNumber(input, 'maxCrossPairs'),
      })
    } catch (error) {
      if (error instanceof GeneralInterfaceInputError) throw new ZatomProviderError(error.code, error.message)
      throw error
    }
    return {
      structure: result.structure,
      checks: result.checks,
      inspectionTargets: result.inspectionTargets,
      summary: `Built ${result.structure.atoms.length}-atom HNF interface using det ${result.match.bottomAreaMultiple}/${result.match.topAreaMultiple}; max principal strain ${(100 * result.match.maxAbsPrincipalStrain).toFixed(5)}%, gap ${result.metrics.measuredGapA.toFixed(5)} Å`,
      details: {
        match: result.match as unknown as JsonValue,
        metrics: result.metrics as unknown as JsonValue,
        search: (result.search ? {
          bottomCellCount: result.search.bottomCellCount,
          topCellCount: result.search.topCellCount,
          totalCandidateCount: result.search.totalCandidateCount,
          acceptedCandidateCount: result.search.acceptedCandidateCount,
          paretoCandidateCount: result.search.paretoCandidateCount,
          truncated: result.search.truncated,
          candidates: result.search.candidates,
        } : null) as unknown as JsonValue,
      },
      provenanceParameters: {
        topFingerprint: fingerprintStructure(top),
        bottomMatrix: result.match.bottomMatrix,
        topMatrix: result.match.topMatrix,
        maxAreaMultiple: input.maxAreaMultiple === undefined ? 12 : Number(input.maxAreaMultiple),
        maxOutputAtoms: input.maxOutputAtoms === undefined ? 20000 : Number(input.maxOutputAtoms),
        maxPrincipalStrain: input.maxPrincipalStrain === undefined ? 0.05 : Number(input.maxPrincipalStrain),
        strainShareTop: input.strainShareTop === undefined ? 1 : Number(input.strainShareTop),
        targetRotationDeg: input.targetRotationDeg === undefined ? null : Number(input.targetRotationDeg),
        maxRotationErrorDeg: input.maxRotationErrorDeg === undefined ? 1 : Number(input.maxRotationErrorDeg),
        maxAspectRatio: input.maxAspectRatio === undefined ? 6 : Number(input.maxAspectRatio),
        maxCandidatePairs: input.maxCandidatePairs === undefined ? 1000000 : Number(input.maxCandidatePairs),
        gapA: input.gapA === undefined ? 3 : Number(input.gapA),
        vacuumA: input.vacuumA === undefined ? 12 : Number(input.vacuumA),
        registryOffsetFractional: pair(input.registryOffsetFractional, 'registryOffsetFractional') ?? [0, 0],
        collisionDistanceA: input.collisionDistanceA === undefined ? 0.6 : Number(input.collisionDistanceA),
        maxCrossPairs: input.maxCrossPairs === undefined ? 2000000 : Number(input.maxCrossPairs),
      },
    }
  },
}
