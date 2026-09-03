import type {
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import { parseZatomTrajectory } from './trajectory'
import {
  analyzeTrajectoryRdf,
  TRAJECTORY_RDF_VERSION,
  TrajectoryRdfInputError,
  type TrajectoryRdfResult,
} from './trajectory-rdf'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
  structure: ZatomStructure,
): Promise<ZatomTrajectory> {
  const raw = input.trajectory ?? await context.readTrajectory?.()
  if (!raw) {
    throw new TrajectoryRdfInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(raw, { structure })
}

const elementListSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 118,
  uniqueItems: true,
  items: { type: 'string', minLength: 1 },
}

const trajectoryRdfManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_rdf',
  title: 'Analyze radial distribution function',
  version: TRAJECTORY_RDF_VERSION,
  description: 'Compute an element-filtered, fully periodic 3D radial distribution function over an exact structure-bound trajectory. Each selected frame receives a complete skew-cell periodic-image histogram, exact spherical-shell and number-density normalization, and then arithmetic time averaging at uniform cadence. Return g(r), cumulative coordination, full fingerprints, hard pair/image budgets, and closest/maximum-bin frame targets. This finite trace does not prove equilibration or convergence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    cutoffA: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 },
    binCount: { type: 'integer', minimum: 1, maximum: 4096, default: 200 },
    centerElements: {
      ...elementListSchema,
      description: 'Elements at r=0; omit to use every structure element in first-occurrence order',
    },
    neighborElements: {
      ...elementListSchema,
      description: 'Elements counted around each center; omit to use every structure element',
    },
    startFrameIndex: { type: 'integer', minimum: 0, description: 'First selected frame; default 0' },
    endFrameIndex: { type: 'integer', minimum: 0, description: 'Inclusive last selected frame; default trajectory end' },
    frameStride: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    maxPairEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 100000000,
      default: 5000000,
      description: 'Hard selected-frame × center × neighbor comparison budget',
    },
    maxPeriodicImageCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000000,
      default: 50000000,
      description: 'Hard aggregate complete periodic-image candidate budget',
    },
  }, ['cutoffA']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'rdf', 'coordination', 'structure-analysis', 'periodic', 'inspection', 'agent'],
}

const trajectoryRdfTool: ZatomToolDefinition<TrajectoryRdfResult> = {
  manifest: trajectoryRdfManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const trajectory = await resolveTrajectory(input, context, structure)
      const result = analyzeTrajectoryRdf({
        structure,
        trajectory,
        cutoffA: Number(input.cutoffA),
        ...(input.binCount === undefined ? {} : { binCount: Number(input.binCount) }),
        ...(Array.isArray(input.centerElements) ? { centerElements: input.centerElements.map(String) } : {}),
        ...(Array.isArray(input.neighborElements) ? { neighborElements: input.neighborElements.map(String) } : {}),
        ...(input.startFrameIndex === undefined ? {} : { startFrameIndex: Number(input.startFrameIndex) }),
        ...(input.endFrameIndex === undefined ? {} : { endFrameIndex: Number(input.endFrameIndex) }),
        ...(input.frameStride === undefined ? {} : { frameStride: Number(input.frameStride) }),
        ...(input.maxPairEvaluations === undefined
          ? {}
          : { maxPairEvaluations: Number(input.maxPairEvaluations) }),
        ...(input.maxPeriodicImageCandidates === undefined
          ? {}
          : { maxPeriodicImageCandidates: Number(input.maxPeriodicImageCandidates) }),
      })
      return {
        ok: true,
        tool: trajectoryRdfManifest.name,
        summary: `RDF analysis ${result.verdict}: ${result.frameRange.frameCount} frames, ${result.totalPairImageCount.toLocaleString()} pair images, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(trajectoryRdfManifest.name, error)
    }
  },
}

export const TRAJECTORY_RDF_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [trajectoryRdfTool]
