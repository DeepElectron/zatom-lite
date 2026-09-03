import type { ZatomToolDefinition, ZatomToolManifest } from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  GEOMETRY_MEASUREMENT_VERSION,
  measureStructureGeometry,
  type GeometryMeasurementResult,
} from './geometry-measurement'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

const atomIdsSchema = (count: number) => ({
  type: 'array',
  minItems: count,
  maxItems: count,
  uniqueItems: true,
  items: { type: 'string', minLength: 1 },
})

const commonMeasurementFields = {
  id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' },
  periodic: { type: 'boolean' },
}

const geometryMeasurementManifest: ZatomToolManifest = {
  name: 'structure_measure_geometry',
  title: 'Measure and gate atom geometry',
  version: GEOMETRY_MEASUREMENT_VERSION,
  description: 'Measure distances (2 atoms), angles (3) and dihedrals (4) between atom ids, with optional min/max acceptance bounds. Handles periodic images correctly when the structure has a lattice. Read-only; returns values in Å / degrees plus focusable targets you can pass to viewer_look_at.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    measurements: {
      type: 'array',
      minItems: 1,
      maxItems: 256,
      items: {
        oneOf: [
          objectSchema({
            ...commonMeasurementFields,
            kind: { const: 'distance' },
            atomIds: atomIdsSchema(2),
            minimumA: { type: 'number', minimum: 0, maximum: 1000000 },
            maximumA: { type: 'number', minimum: 0, maximum: 1000000 },
          }, ['id', 'kind', 'atomIds', 'periodic']),
          objectSchema({
            ...commonMeasurementFields,
            kind: { const: 'angle' },
            atomIds: atomIdsSchema(3),
            minimumDeg: { type: 'number', minimum: 0, maximum: 180 },
            maximumDeg: { type: 'number', minimum: 0, maximum: 180 },
          }, ['id', 'kind', 'atomIds', 'periodic']),
          objectSchema({
            ...commonMeasurementFields,
            kind: { const: 'dihedral' },
            atomIds: atomIdsSchema(4),
            minimumDeg: { type: 'number', minimum: -180, maximum: 180 },
            maximumDeg: { type: 'number', minimum: -180, maximum: 180 },
          }, ['id', 'kind', 'atomIds', 'periodic']),
        ],
      },
    },
    maxMinimumImageCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 10000000,
      default: 1000000,
      description: 'Hard aggregate candidate budget for every certified minimum-image bond vector',
    },
  }, ['measurements']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['structure', 'measurement', 'distance', 'angle', 'dihedral', 'validation', 'inspection', 'agent'],
}

const geometryMeasurementTool: ZatomToolDefinition<GeometryMeasurementResult> = {
  manifest: geometryMeasurementManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const maxMinimumImageCandidates = input.maxMinimumImageCandidates === undefined
        ? undefined
        : Number(input.maxMinimumImageCandidates)
      const result = measureStructureGeometry({
        structure,
        measurements: input.measurements,
        ...(maxMinimumImageCandidates === undefined ? {} : { maxMinimumImageCandidates }),
      })
      return {
        ok: true,
        tool: geometryMeasurementManifest.name,
        summary: `Geometry measurement ${result.verdict}: ${result.measurements.length} value(s), fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(geometryMeasurementManifest.name, error)
    }
  },
}

export const GEOMETRY_MEASUREMENT_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [geometryMeasurementTool]
