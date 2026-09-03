/** Provider adapter for composable analytic smooth displacement fields. */

import { symbolToAtomicNumber } from '../chemistry/periodic-table'
import {
  applySmoothDisplacementFields,
  SmoothFieldInputError,
  smoothFieldBoundsCenter,
  type SmoothDisplacementField,
} from './continuous-field'
import type { JsonValue, Vec3 } from './contracts'
import { ZATOM_PROVIDER_SCHEMA, ZatomProviderError, type ZatomModelingProvider } from './provider'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) }
}

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }
const gaussianSchema = objectSchema({
  kind: { const: 'gaussian' },
  center: vec3Schema,
  direction: vec3Schema,
  amplitudeA: { type: 'number' },
  sigmaA: { type: 'number', exclusiveMinimum: 0 },
}, ['kind', 'direction', 'amplitudeA', 'sigmaA'])
const smoothStepSchema = objectSchema({
  kind: { const: 'smooth-step' },
  origin: vec3Schema,
  normal: vec3Schema,
  direction: vec3Schema,
  amplitudeA: { type: 'number' },
  widthA: { type: 'number', exclusiveMinimum: 0 },
}, ['kind', 'normal', 'direction', 'amplitudeA', 'widthA'])
const sinusoidalSchema = objectSchema({
  kind: { const: 'sinusoidal' },
  origin: vec3Schema,
  propagation: vec3Schema,
  direction: vec3Schema,
  amplitudeA: { type: 'number' },
  wavelengthA: { type: 'number', exclusiveMinimum: 0 },
  phaseDeg: { type: 'number', default: 0 },
}, ['kind', 'propagation', 'direction', 'amplitudeA', 'wavelengthA'])
const torsionSchema = objectSchema({
  kind: { const: 'torsion' },
  origin: vec3Schema,
  axis: vec3Schema,
  angleRateDegPerA: { type: 'number' },
}, ['kind', 'axis', 'angleRateDegPerA'])

const smoothFieldInputSchema = objectSchema({
  fields: {
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: { oneOf: [gaussianSchema, smoothStepSchema, sinusoidalSchema, torsionSchema] },
  },
  selection: objectSchema({
    atomIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    elements: { type: 'array', minItems: 1, items: { type: 'string' } },
  }),
  dropLattice: { type: 'boolean', description: 'Required acknowledgement when the source has a lattice' },
  maxPrincipalStrain: { type: 'number', minimum: 0, default: 0.15 },
  minJacobianDeterminant: { type: 'number', minimum: 0, default: 0.1 },
  maximumDisplacementA: { type: 'number', minimum: 0 },
  minimumPairDistanceA: { type: 'number', minimum: 0, default: 0.35 },
  finiteDifferenceStepA: { type: 'number', exclusiveMinimum: 0, default: 1e-4 },
  maxAuditAtoms: { type: 'integer', minimum: 1, maximum: 10000, default: 2000 },
  maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 100000 },
}, ['fields'])

function finiteNumber(
  record: Record<string, unknown>,
  name: string,
  fallback?: number,
  options: { min?: number; max?: number; integer?: boolean; required?: boolean } = {},
): number {
  if (record[name] === undefined && fallback === undefined) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} is required`)
  }
  const value = record[name] === undefined ? fallback! : Number(record[name])
  if (!Number.isFinite(value) || (options.integer && !Number.isInteger(value))
    || (options.min !== undefined && value < options.min)
    || (options.max !== undefined && value > options.max)) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} is outside its finite allowed range`)
  }
  return value
}

function finiteOptionalNumber(record: Record<string, unknown>, name: string, min = -Infinity): number | undefined {
  if (record[name] === undefined) return undefined
  return finiteNumber(record, name, undefined, { min })
}

function vec3(value: unknown, name: string, fallback?: Vec3): Vec3 {
  if (value === undefined && fallback) return [...fallback] as Vec3
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must contain three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

function canonicalElement(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} must be an element symbol`)
  }
  const normalized = value.trim()[0].toUpperCase() + value.trim().slice(1).toLowerCase()
  if (symbolToAtomicNumber(normalized) <= 0) {
    throw new ZatomProviderError('invalid_provider_parameters', `${name} uses unknown element ${JSON.stringify(value)}`)
  }
  return normalized
}

function parseFields(value: unknown, defaultOrigin: Vec3): SmoothDisplacementField[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new ZatomProviderError('invalid_provider_parameters', 'fields must contain from 1 through 32 field objects')
  }
  return value.map((raw, index) => {
    if (!isRecord(raw) || typeof raw.kind !== 'string') {
      throw new ZatomProviderError('invalid_provider_parameters', `fields[${index}] must be a field object with kind`)
    }
    if (raw.kind === 'gaussian') {
      return {
        kind: 'gaussian',
        center: vec3(raw.center, `fields[${index}].center`, defaultOrigin),
        direction: vec3(raw.direction, `fields[${index}].direction`),
        amplitudeA: finiteNumber(raw, 'amplitudeA'),
        sigmaA: finiteNumber(raw, 'sigmaA', undefined, { min: Number.EPSILON }),
      }
    }
    if (raw.kind === 'smooth-step') {
      return {
        kind: 'smooth-step',
        origin: vec3(raw.origin, `fields[${index}].origin`, defaultOrigin),
        normal: vec3(raw.normal, `fields[${index}].normal`),
        direction: vec3(raw.direction, `fields[${index}].direction`),
        amplitudeA: finiteNumber(raw, 'amplitudeA'),
        widthA: finiteNumber(raw, 'widthA', undefined, { min: Number.EPSILON }),
      }
    }
    if (raw.kind === 'sinusoidal') {
      return {
        kind: 'sinusoidal',
        origin: vec3(raw.origin, `fields[${index}].origin`, defaultOrigin),
        propagation: vec3(raw.propagation, `fields[${index}].propagation`),
        direction: vec3(raw.direction, `fields[${index}].direction`),
        amplitudeA: finiteNumber(raw, 'amplitudeA'),
        wavelengthA: finiteNumber(raw, 'wavelengthA', undefined, { min: Number.EPSILON }),
        phaseDeg: finiteNumber(raw, 'phaseDeg', 0),
      }
    }
    if (raw.kind === 'torsion') {
      return {
        kind: 'torsion',
        origin: vec3(raw.origin, `fields[${index}].origin`, defaultOrigin),
        axis: vec3(raw.axis, `fields[${index}].axis`),
        angleRateDegPerA: finiteNumber(raw, 'angleRateDegPerA'),
      }
    }
    throw new ZatomProviderError('invalid_provider_parameters', `fields[${index}].kind must be gaussian, smooth-step, sinusoidal, or torsion`)
  })
}

function parseSelection(value: unknown): { atomIds?: string[]; elements?: string[] } | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ZatomProviderError('invalid_provider_parameters', 'selection must be an object')
  let atomIds: string[] | undefined
  if (value.atomIds !== undefined) {
    if (!Array.isArray(value.atomIds) || value.atomIds.length === 0 || value.atomIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ZatomProviderError('invalid_provider_parameters', 'selection.atomIds must contain non-empty strings')
    }
    atomIds = value.atomIds.map((id) => id.trim())
    if (new Set(atomIds).size !== atomIds.length) {
      throw new ZatomProviderError('invalid_provider_parameters', 'selection.atomIds must be unique')
    }
  }
  let elements: string[] | undefined
  if (value.elements !== undefined) {
    if (!Array.isArray(value.elements) || value.elements.length === 0) {
      throw new ZatomProviderError('invalid_provider_parameters', 'selection.elements must be a non-empty array')
    }
    elements = value.elements.map((element, index) => canonicalElement(element, `selection.elements[${index}]`))
  }
  if (!atomIds && !elements) throw new ZatomProviderError('invalid_provider_parameters', 'selection must include atomIds or elements')
  return { ...(atomIds ? { atomIds } : {}), ...(elements ? { elements } : {}) }
}

export const SMOOTH_DISPLACEMENT_FIELD_PROVIDER: ZatomModelingProvider = {
  manifest: {
    schemaVersion: ZATOM_PROVIDER_SCHEMA,
    id: 'zatom.smooth-displacement-fields',
    title: 'zatom smooth displacement-field composer',
    description: 'Compose analytic Gaussian, smooth-step, sinusoidal, and torsional coordinate fields with an independent finite-difference Jacobian/strain audit.',
    adapterVersion: '1.0.0',
    engine: { name: 'zatom-analytic-fields', version: '1.0.0' },
    execution: 'browser',
    capabilities: [{
      id: 'deformation.field.smooth',
      title: 'Apply composable smooth displacement fields',
      description: 'Create corrugation, local indentation, smooth domain-wall-like shear, or torsional seeds while preserving identity/topology and gating foldover, strain, displacement, and contacts.',
      fidelity: 'continuum',
      source: 'required',
      deterministic: true,
      inputSchema: smoothFieldInputSchema,
      requiredCheckIds: [
        'field.mapping_completeness',
        'field.jacobian_orientation',
        'field.principal_strain',
        'field.minimum_distance',
        'field.topology_preserved',
        'field.periodicity_truthful',
      ],
      tags: ['deformation', 'strain', 'continuous-field', 'torsion', 'corrugation', 'domain-wall-seed'],
    }],
  },
  execute: async (request) => {
    if (!request.source) throw new ZatomProviderError('source_required', 'Smooth displacement fields require a source structure')
    const input = request.parameters
    const maxOutputAtoms = finiteNumber(input, 'maxOutputAtoms', 100000, { min: 1, max: 100000, integer: true })
    if (request.source.atoms.length > maxOutputAtoms) {
      throw new ZatomProviderError('output_too_large', `Source has ${request.source.atoms.length} atoms, above maxOutputAtoms ${maxOutputAtoms}`)
    }
    const defaultOrigin = smoothFieldBoundsCenter(request.source)
    const fields = parseFields(input.fields, defaultOrigin)
    const selection = parseSelection(input.selection)
    const maxPrincipalStrain = finiteNumber(input, 'maxPrincipalStrain', 0.15, { min: 0 })
    const minJacobianDeterminant = finiteNumber(input, 'minJacobianDeterminant', 0.1, { min: 0 })
    const maximumDisplacementA = finiteOptionalNumber(input, 'maximumDisplacementA', 0)
    const minimumPairDistanceA = finiteNumber(input, 'minimumPairDistanceA', 0.35, { min: 0 })
    const finiteDifferenceStepA = finiteNumber(input, 'finiteDifferenceStepA', 1e-4, { min: Number.EPSILON })
    const maxAuditAtoms = finiteNumber(input, 'maxAuditAtoms', 2000, { min: 1, max: 10000, integer: true })
    let result
    try {
      result = applySmoothDisplacementFields({
        structure: request.source,
        fields,
        ...(selection ? { selection } : {}),
        dropLattice: input.dropLattice === true,
        maxPrincipalStrain,
        minJacobianDeterminant,
        ...(maximumDisplacementA === undefined ? {} : { maximumDisplacementA }),
        minimumPairDistanceA,
        finiteDifferenceStepA,
        maxAuditAtoms,
      })
    } catch (error) {
      if (error instanceof SmoothFieldInputError) throw new ZatomProviderError(error.code, error.message)
      throw error
    }
    return {
      structure: result.structure,
      checks: result.checks,
      inspectionTargets: result.inspectionTargets,
      summary: `Applied ${fields.length} smooth field${fields.length === 1 ? '' : 's'} to ${result.audit.selectedAtomCount} atoms; max displacement ${result.audit.maxDisplacementA.toFixed(5)} Å, max principal strain ${(100 * result.audit.maxAbsPrincipalStrain).toFixed(5)}%`,
      details: {
        fieldKinds: fields.map((field) => field.kind),
        fieldCount: fields.length,
        ...result.audit,
      },
      provenanceParameters: {
        fields: fields as unknown as JsonValue,
        selection: (selection ?? null) as unknown as JsonValue,
        dropLattice: input.dropLattice === true,
        maxPrincipalStrain,
        minJacobianDeterminant,
        maximumDisplacementA: maximumDisplacementA ?? null,
        minimumPairDistanceA,
        finiteDifferenceStepA,
        maxAuditAtoms,
        maxOutputAtoms,
      },
    }
  },
}
