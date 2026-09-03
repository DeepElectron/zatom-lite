/** Agent/MCP tool for explicit-port finite linear polymer construction. */

import { finalizeStructureCandidate } from './candidate-tool'
import type {
  ZatomBondOrder,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import {
  buildLinearPolymer,
  PolymerInputError,
  type PolymerPort,
} from './polymer'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function numberOption(input: Record<string, unknown>, name: string): number | undefined {
  if (input[name] === undefined) return undefined
  const value = Number(input[name])
  if (!Number.isFinite(value)) throw new PolymerInputError('invalid_polymer_number', `${name} must be finite`)
  return value
}

function requiredNumber(input: Record<string, unknown>, name: string): number {
  const value = numberOption(input, name)
  if (value === undefined) throw new PolymerInputError('missing_polymer_parameter', `${name} is required`)
  return value
}

function parsePort(value: unknown, field: string): PolymerPort {
  if (!isRecord(value) || typeof value.anchorAtomId !== 'string' || typeof value.directionAtomId !== 'string'
    || !Array.isArray(value.removeAtomIds) || value.removeAtomIds.some((id) => typeof id !== 'string')) {
    throw new PolymerInputError(
      'invalid_polymer_port',
      `${field} requires anchorAtomId, directionAtomId, and removeAtomIds strings`,
    )
  }
  return {
    anchorAtomId: value.anchorAtomId,
    directionAtomId: value.directionAtomId,
    removeAtomIds: value.removeAtomIds,
  }
}

const portSchema = objectSchema({
  anchorAtomId: {
    type: 'string',
    minLength: 1,
    description: 'Retained atom that forms each inter-repeat bond.',
  },
  directionAtomId: {
    type: 'string',
    minLength: 1,
    description: 'Directly bonded leaving atom whose anchor-to-atom vector defines the port direction.',
  },
  removeAtomIds: {
    type: 'array',
    minItems: 1,
    uniqueItems: true,
    items: { type: 'string', minLength: 1 },
    description: 'Complete connected leaving group; it must attach to the retained repeat only through anchor-direction.',
  },
}, ['anchorAtomId', 'directionAtomId', 'removeAtomIds'])

const buildLinearPolymerManifest: ZatomToolManifest = {
  name: 'molecule_build_linear_polymer',
  title: 'Build an explicit-port finite linear polymer',
  version: '2.0.0',
  description: 'Repeat one finite explicitly bonded molecule head-to-tail, remove declared internal leaving groups, retain capped termini, place rigid repeats from port axes plus a declared twist, create stable junction bonds, and gate identity, topology, junction geometry, charge, contacts, and workspace readback.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    head: portSchema,
    tail: portSchema,
    repeatCount: { type: 'integer', minimum: 1, maximum: 1024 },
    bondOrder: { enum: [1, 1.5, 2, 3], default: 1 },
    targetBondLengthA: { type: 'number', minimum: 0.4, maximum: 5, default: 1.5 },
    twistDeg: {
      type: 'number',
      minimum: -36000,
      maximum: 36000,
      default: 180,
      description: 'Rigid relative rotation about each new tail-to-head bond axis; this is not an automatically chosen tacticity or equilibrium dihedral.',
    },
    minimumInterrepeatDistanceA: { type: 'number', minimum: 0, maximum: 100, default: 0.65 },
    interrepeatWarningDistanceA: { type: 'number', minimum: 0, maximum: 100, default: 0.9 },
    maxInterrepeatPairChecks: { type: 'integer', minimum: 1, maximum: 5_000_000, default: 1_000_000 },
    maxAtoms: { type: 'integer', minimum: 1, maximum: 100_000, default: 20_000 },
    bondLengthToleranceFraction: { type: 'number', minimum: 0, maximum: 10, default: 0.35 },
    label: { type: 'string', maxLength: 256 },
    applyToWorkspace: {
      type: 'boolean',
      default: false,
      description: 'Apply only when explicitly true.',
    },
    captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host.' },
  }, ['head', 'tail', 'repeatCount']),
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['molecule', 'polymer', 'repeat-unit', 'topology', 'leaving-group', 'junction', 'validation', 'agent'],
}

const buildLinearPolymerTool: ZatomToolDefinition = {
  manifest: buildLinearPolymerManifest,
  execute: async (input, context) => {
    try {
      const result = buildLinearPolymer({
        structure: await resolveStructure(input, context),
        head: parsePort(input.head, 'head'),
        tail: parsePort(input.tail, 'tail'),
        repeatCount: requiredNumber(input, 'repeatCount'),
        bondOrder: numberOption(input, 'bondOrder') as ZatomBondOrder | undefined,
        targetBondLengthA: numberOption(input, 'targetBondLengthA'),
        twistDeg: numberOption(input, 'twistDeg'),
        minimumInterrepeatDistanceA: numberOption(input, 'minimumInterrepeatDistanceA'),
        interrepeatWarningDistanceA: numberOption(input, 'interrepeatWarningDistanceA'),
        maxInterrepeatPairChecks: numberOption(input, 'maxInterrepeatPairChecks'),
        maxAtoms: numberOption(input, 'maxAtoms'),
        bondLengthToleranceFraction: numberOption(input, 'bondLengthToleranceFraction'),
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: buildLinearPolymerManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Built a capped ${result.repeats.length}-repeat linear polymer with ${result.structure.atoms.length} atoms and ${result.junctions.length} explicit junction(s); closest nonbonded cross-repeat pair ${result.minimumInterrepeatDistanceA === null ? 'n/a' : `${result.minimumInterrepeatDistanceA.toFixed(4)} Å`}${applied ? verified === true ? ' and fingerprint-verified workspace readback' : verified === false ? '; workspace readback diverged' : ' and applied without readback' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError(buildLinearPolymerManifest.name, error)
    }
  },
}

export const POLYMER_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [buildLinearPolymerTool]
