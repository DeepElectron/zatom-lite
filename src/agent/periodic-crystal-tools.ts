/** MCP tool for explicit-cell, explicit-fractional-basis periodic construction. */

import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import type {
  JsonValue,
  Vec3,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import {
  buildPeriodicCrystal,
  PeriodicCrystalInputError,
  type BuildPeriodicCrystalResult,
  type PeriodicCrystalBasisSite,
  type PeriodicCrystalCellParameters,
} from './periodic-crystal'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

const fractionalVec3Schema = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: { type: 'number', minimum: 0, exclusiveMaximum: 1 },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cellOption(value: unknown): PeriodicCrystalCellParameters {
  if (!isRecord(value)) throw new PeriodicCrystalInputError('invalid_periodic_crystal_cell', 'cell is required')
  return {
    aA: Number(value.aA),
    bA: Number(value.bA),
    cA: Number(value.cA),
    alphaDeg: Number(value.alphaDeg),
    betaDeg: Number(value.betaDeg),
    gammaDeg: Number(value.gammaDeg),
  }
}

function basisOption(value: unknown): PeriodicCrystalBasisSite[] {
  if (!Array.isArray(value)) throw new PeriodicCrystalInputError('invalid_periodic_crystal_basis', 'basis must be an array')
  return value.map((raw, index) => {
    if (!isRecord(raw)) throw new PeriodicCrystalInputError('invalid_periodic_crystal_basis', `basis[${index}] must be an object`)
    return {
      id: typeof raw.id === 'string' ? raw.id : '',
      element: typeof raw.element === 'string' ? raw.element : '',
      fractionalPosition: Array.isArray(raw.fractionalPosition)
        ? raw.fractionalPosition.map(Number) as Vec3
        : [] as unknown as Vec3,
      ...(isRecord(raw.properties) ? { properties: raw.properties as Record<string, JsonValue> } : {}),
    }
  })
}

function supercellOption(value: unknown): [number, number, number] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) {
    throw new PeriodicCrystalInputError('invalid_periodic_crystal_supercell', 'supercell must contain three positive integers')
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])]
}

function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  if (input[name] === undefined) return undefined
  const value = Number(input[name])
  if (!Number.isFinite(value)) throw new PeriodicCrystalInputError('invalid_periodic_crystal_parameter', `${name} must be finite`)
  return value
}

const buildManifest: ZatomToolManifest = {
  name: 'structure_build_periodic_crystal',
  title: 'Build a periodic crystal from an explicit fractional basis',
  version: '1.0.0',
  description: 'Build a deterministic fully periodic P1 crystal from six crystallographic cell parameters and explicit fractional basis sites, optionally replicate it, preserve stable site/cell identity, and certify primitive infinite-lattice contacts before candidate application. This does not expand space-group symmetry or occupancy disorder.',
  inputSchema: objectSchema({
    label: { type: 'string', minLength: 1, maxLength: 256 },
    cell: objectSchema({
      aA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
      bA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
      cA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
      alphaDeg: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 },
      betaDeg: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 },
      gammaDeg: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 },
    }, ['aA', 'bA', 'cA', 'alphaDeg', 'betaDeg', 'gammaDeg']),
    basis: {
      type: 'array',
      minItems: 1,
      maxItems: 2000,
      items: objectSchema({
        id: { type: 'string', minLength: 1, maxLength: 128 },
        element: { type: 'string', minLength: 1, maxLength: 3 },
        fractionalPosition: fractionalVec3Schema,
        properties: { type: 'object' },
      }, ['id', 'element', 'fractionalPosition']),
    },
    supercell: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'integer', minimum: 1, maximum: 256 },
      default: [1, 1, 1],
    },
    minimumPairDistanceA: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 0.35 },
    maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 250000, default: 100000 },
    maxMinimumImageCandidateEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 200000000,
      default: 50000000,
    },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to a visual workspace' },
  }, ['cell', 'basis']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'crystal', 'periodic', 'fractional', 'basis', 'supercell', 'validation', 'agent'],
}

type PeriodicCrystalToolData = CandidateEnvelope<BuildPeriodicCrystalResult>

const buildPeriodicCrystalTool: ZatomToolDefinition<PeriodicCrystalToolData> = {
  manifest: buildManifest,
  execute: async (input, context) => {
    try {
      const result = buildPeriodicCrystal({
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
        cell: cellOption(input.cell),
        basis: basisOption(input.basis),
        supercell: supercellOption(input.supercell),
        minimumPairDistanceA: numberOption(input, 'minimumPairDistanceA'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
        maxMinimumImageCandidateEvaluations: numberOption(input, 'maxMinimumImageCandidateEvaluations'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: buildManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Built ${result.metrics.atomCount.toLocaleString()} atoms from ${result.metrics.basisSiteCount} explicit basis sites in a ${result.metrics.supercell.join('×')} fully periodic cell${applied ? verified === true ? ' and fingerprint-verified it in the active workspace' : ' and applied it without verified readback' : blocked ? '; workspace application was blocked by validation' : ''}`,
      })
    } catch (error) {
      return toolError<PeriodicCrystalToolData>(buildManifest.name, error)
    }
  },
}

export const PERIODIC_CRYSTAL_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [buildPeriodicCrystalTool]
