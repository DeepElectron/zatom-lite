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
  analyzeTrajectoryDensityProfile,
  TRAJECTORY_DENSITY_PROFILE_VERSION,
  TrajectoryDensityProfileInputError,
  type LatticeAxis,
  type TrajectoryDensityProfileResult,
} from './trajectory-density-profile'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
  structure: ZatomStructure,
): Promise<ZatomTrajectory> {
  const raw = input.trajectory ?? await context.readTrajectory?.()
  if (!raw) {
    throw new TrajectoryDensityProfileInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(raw, { structure })
}

const densityProfileManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_density_profile',
  title: 'Analyze lattice-axis density profile',
  version: TRAJECTORY_DENSITY_PROFILE_VERSION,
  description: 'Compute a time-averaged element-resolved number-density profile on a fixed cell-aligned 1D grid. Bins follow lattice axis a, b, or c even for a skew cell; both lateral axes must be periodic, each bin uses exact cell volume/binCount, periodic profile coordinates wrap, finite profile coordinates must stay inside the cell, and uniform selected-frame cadence plus a hard atom-frame budget are required. Return density integration evidence, exact fingerprints, and the maximum-density frame target.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    latticeAxis: {
      enum: ['a', 'b', 'c'],
      description: 'Cell vector normal direction for the 1D grid; bins remain aligned to the skew simulation cell',
    },
    binCount: { type: 'integer', minimum: 1, maximum: 4096, default: 100 },
    species: {
      type: 'array',
      minItems: 1,
      maxItems: 118,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
      description: 'Elements included in counts and normalization; omit to include all',
    },
    startFrameIndex: { type: 'integer', minimum: 0, description: 'First selected frame; default 0' },
    endFrameIndex: { type: 'integer', minimum: 0, description: 'Inclusive last selected frame; default trajectory end' },
    frameStride: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    maxAtomFrameAssignments: {
      type: 'integer',
      minimum: 1,
      maximum: 100000000,
      default: 10000000,
      description: 'Hard selected atom × selected frame assignment budget',
    },
  }, ['latticeAxis']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'density', 'profile', 'interface', 'surface', 'periodic', 'inspection', 'agent'],
}

const densityProfileTool: ZatomToolDefinition<TrajectoryDensityProfileResult> = {
  manifest: densityProfileManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const trajectory = await resolveTrajectory(input, context, structure)
      const result = analyzeTrajectoryDensityProfile({
        structure,
        trajectory,
        latticeAxis: String(input.latticeAxis) as LatticeAxis,
        ...(input.binCount === undefined ? {} : { binCount: Number(input.binCount) }),
        ...(Array.isArray(input.species) ? { species: input.species.map(String) } : {}),
        ...(input.startFrameIndex === undefined ? {} : { startFrameIndex: Number(input.startFrameIndex) }),
        ...(input.endFrameIndex === undefined ? {} : { endFrameIndex: Number(input.endFrameIndex) }),
        ...(input.frameStride === undefined ? {} : { frameStride: Number(input.frameStride) }),
        ...(input.maxAtomFrameAssignments === undefined
          ? {}
          : { maxAtomFrameAssignments: Number(input.maxAtomFrameAssignments) }),
      })
      return {
        ok: true,
        tool: densityProfileManifest.name,
        summary: `Density-profile analysis ${result.verdict}: ${result.frameRange.frameCount} frames, ${result.binCount} bins along ${result.latticeAxis}, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(densityProfileManifest.name, error)
    }
  },
}

export const TRAJECTORY_DENSITY_PROFILE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [densityProfileTool]
