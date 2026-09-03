/** Agent/MCP tools for validated analytic continuous deformation fields. */

import { finalizeStructureCandidate } from './candidate-tool'
import type {
  Vec3,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { applyCylindricalBend, DeformationInputError } from './deformation'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

function requiredNumber(input: Record<string, unknown>, name: string): number {
  const value = Number(input[name])
  if (!Number.isFinite(value)) throw new DeformationInputError('invalid_number', `${name} must be a finite number`)
  return value
}

function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  if (input[name] === undefined) return undefined
  return requiredNumber(input, name)
}

function vec3(value: unknown, field: string, required = false): Vec3 | undefined {
  if (value === undefined && !required) return undefined
  if (!Array.isArray(value) || value.length !== 3) throw new DeformationInputError('invalid_vector', `${field} must contain three finite numbers`)
  const result: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (result.some((item) => !Number.isFinite(item))) throw new DeformationInputError('invalid_vector', `${field} must contain three finite numbers`)
  return result
}

const bendManifest: ZatomToolManifest = {
  name: 'structure_apply_cylindrical_bend',
  title: 'Apply an analytic cylindrical bend field',
  version: '1.0.0',
  description: 'Map a finite structure through a compatible cylindrical pure-bend field and gate fiber strain, Green–Lagrange strain, half-turn wrapping, inverse-map accuracy, and final distances.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    radiusA: { type: 'number', exclusiveMinimum: 0 },
    tangent: vec3Schema,
    radial: vec3Schema,
    axis: vec3Schema,
    bendOrigin: vec3Schema,
    maxFiberStrain: { type: 'number', minimum: 0, default: 0.02 },
    maxGreenStrain: { type: 'number', minimum: 0, default: 0.0202 },
    dropLattice: { type: 'boolean', description: 'Required acknowledgement when the source has a lattice/PBC' },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
  }, ['radiusA', 'tangent', 'radial']),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'deformation', 'strain', 'bend', 'continuous-field', 'validation', 'agent'],
}

const cylindricalBendTool: ZatomToolDefinition = {
  manifest: bendManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const result = applyCylindricalBend({
        structure,
        radiusA: requiredNumber(input, 'radiusA'),
        tangent: vec3(input.tangent, 'tangent', true)!,
        radial: vec3(input.radial, 'radial', true)!,
        axis: vec3(input.axis, 'axis'),
        bendOrigin: vec3(input.bendOrigin, 'bendOrigin'),
        maxFiberStrain: numberOption(input, 'maxFiberStrain'),
        maxGreenStrain: numberOption(input, 'maxGreenStrain'),
        dropLattice: input.dropLattice === true,
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: bendManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked) => `Applied R=${result.frame.R.toFixed(3)} Å cylindrical field; max fiber strain ${(100 * result.metrics.maxAbsFiberStrain).toFixed(4)}%, inverse error ${result.metrics.maxInverseRoundTripErrorA.toExponential(2)} Å${applied ? ' and wrote it to the active workspace' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(bendManifest.name, error)
    }
  },
}

export const DEFORMATION_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [cylindricalBendTool]
