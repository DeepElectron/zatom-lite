/** MCP-facing lattice-compatible polarization-domain-wall construction. */

import type {
  Vec3,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import {
  buildPolarizationDomainWall,
  type BuildPolarizationDomainWallResult,
  type PolarizationDomainWallAxis,
  type PolarizationDomainWallBoundaryMode,
  type PolarizationDomainWallElectrostaticClass,
  ZatomPolarizationDomainWallInputError,
} from './polarization-domain-wall'
import { parseZatomStructure, ZatomStructureInputError } from './structure-validation'
import { toolError } from './tool-helpers'

const TOOL_NAME = 'structure_build_polarization_domain_wall'

async function resolveDomainA(input: Record<string, unknown>, context: ZatomToolContext): Promise<ZatomStructure> {
  if (input.structure !== undefined) return parseZatomStructure(input.structure)
  const structure = await context.readStructure?.()
  if (!structure) {
    throw new ZatomStructureInputError(
      'no_active_structure',
      'No domain-A structure was supplied and the active workspace is empty',
    )
  }
  return parseZatomStructure(structure)
}

function numberValue(input: Record<string, unknown>, field: string, fallback: number): number {
  if (input[field] === undefined) return fallback
  if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must be a finite number`,
    )
  }
  return input[field]
}

function vectorValue(input: Record<string, unknown>, field: string): Vec3 {
  const value = input[field]
  if (!Array.isArray(value) || value.length !== 3
    || value.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new ZatomPolarizationDomainWallInputError(
      'invalid_polarization_domain_wall_input',
      `${field} must contain three finite Cartesian components`,
    )
  }
  return [value[0], value[1], value[2]]
}

const vectorSchema = {
  type: 'array',
  minItems: 3,
  maxItems: 3,
  items: { type: 'number' },
}

const manifest: ZatomToolManifest = {
  name: TOOL_NAME,
  title: 'Build a polarization domain wall',
  version: '1.0.0',
  description: 'Stack two explicit, lattice-compatible periodic domain endpoints by stable atom ID; construct either a finite single wall or a periodic wall pair; interpolate exact minimum-image site displacements; audit user-declared Cartesian polarization discontinuity, bound charge, contacts, containment, and visual targets. Returns an unrelaxed geometry seed and never infers polarization, symmetry variants, reconstruction, energy, or stability.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'domainB',
      'polarizationA_CPerM2',
      'polarizationB_CPerM2',
      'stackingAxis',
      'boundaryMode',
      'expectedElectrostaticClass',
    ],
    properties: {
      structure: ZATOM_STRUCTURE_JSON_SCHEMA,
      domainB: ZATOM_STRUCTURE_JSON_SCHEMA,
      polarizationA_CPerM2: {
        ...vectorSchema,
        description: 'Declared domain-A polarization in Cartesian C/m²; this tool does not calculate it',
      },
      polarizationB_CPerM2: {
        ...vectorSchema,
        description: 'Declared domain-B polarization in Cartesian C/m²; this tool does not calculate it',
      },
      stackingAxis: { enum: ['a', 'b', 'c'], description: 'Source-cell axis normal to the stacked wall planes' },
      boundaryMode: { enum: ['periodic-pair', 'finite-single'] },
      expectedElectrostaticClass: { enum: ['neutral', 'charged'] },
      domainACells: { type: 'integer', minimum: 1, maximum: 256, default: 2 },
      domainBCells: { type: 'integer', minimum: 1, maximum: 256, default: 2 },
      transitionCells: {
        type: 'integer', minimum: 0, maximum: 256, default: 0,
        description: 'Linearly interpolated cells per A→B wall direction; zero creates an atomically sharp seed',
      },
      neutralToleranceCPerM2: { type: 'number', minimum: 0, maximum: 100, default: 1e-6 },
      maximumEndpointDisplacementA: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 2 },
      minimumPairDistanceA: { type: 'number', exclusiveMinimum: 0, maximum: 20, default: 0.35 },
      closePairWarningA: { type: 'number', exclusiveMinimum: 0, maximum: 20, default: 0.6 },
      surfacePaddingA: {
        type: 'number', minimum: 0, maximum: 10_000,
        description: 'Finite-single only; defaults to 5 Å. Must be zero for periodic-pair.',
      },
      maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 500_000, default: 100_000 },
      label: { type: 'string', minLength: 1, maxLength: 512 },
      applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when every numeric construction gate passes' },
      captureAfter: { type: 'boolean', description: 'Default true only when applying in a viewport-enabled host' },
    },
  },
  effects: { structure: 'create', workspace: 'write', visual: 'read' },
  tags: ['structure', 'domain-wall', 'polarization', 'ferroelectric', 'defect', 'interface', 'visual-validation'],
}

type ToolData = CandidateEnvelope<BuildPolarizationDomainWallResult>

const tool: ZatomToolDefinition<ToolData> = {
  manifest,
  execute: async (input, context) => {
    try {
      const boundaryMode = input.boundaryMode as PolarizationDomainWallBoundaryMode
      const result = buildPolarizationDomainWall({
        domainA: await resolveDomainA(input, context),
        domainB: parseZatomStructure(input.domainB),
        polarizationA_CPerM2: vectorValue(input, 'polarizationA_CPerM2'),
        polarizationB_CPerM2: vectorValue(input, 'polarizationB_CPerM2'),
        stackingAxis: input.stackingAxis as PolarizationDomainWallAxis,
        boundaryMode,
        expectedElectrostaticClass: input.expectedElectrostaticClass as PolarizationDomainWallElectrostaticClass,
        domainACells: numberValue(input, 'domainACells', 2),
        domainBCells: numberValue(input, 'domainBCells', 2),
        transitionCells: numberValue(input, 'transitionCells', 0),
        neutralToleranceCPerM2: numberValue(input, 'neutralToleranceCPerM2', 1e-6),
        maximumEndpointDisplacementA: numberValue(input, 'maximumEndpointDisplacementA', 2),
        minimumPairDistanceA: numberValue(input, 'minimumPairDistanceA', 0.35),
        closePairWarningA: numberValue(input, 'closePairWarningA', 0.6),
        surfacePaddingA: numberValue(input, 'surfacePaddingA', boundaryMode === 'finite-single' ? 5 : 0),
        maxOutputAtoms: numberValue(input, 'maxOutputAtoms', 100_000),
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: TOOL_NAME,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => (
          `Built a ${result.metrics.outputAtomCount.toLocaleString()}-atom ${result.metrics.electrostaticClass} polarization-domain-wall ${result.metrics.wallCount === 1 ? 'seed' : 'pair'}`
          + `${applied ? verified === true ? ' and fingerprint-verified workspace readback' : ' and applied without verified readback' : blocked ? '; workspace application was blocked' : ''}`
        ),
      })
    } catch (error) {
      return toolError<ToolData>(TOOL_NAME, error)
    }
  },
}

export const POLARIZATION_DOMAIN_WALL_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [tool]
