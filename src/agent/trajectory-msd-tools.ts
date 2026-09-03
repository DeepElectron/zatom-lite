import type {
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import {
  analyzeTrajectoryMsd,
  TRAJECTORY_MSD_VERSION,
  TrajectoryMsdInputError,
  type TrajectoryMsdResult,
} from './trajectory-msd'
import { parseZatomTrajectory } from './trajectory'
import type { MsdDirections } from '../lib/analysis/trajectory/md-postprocess/msd'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
  structure: ZatomStructure,
): Promise<ZatomTrajectory> {
  const raw = input.trajectory ?? await context.readTrajectory?.()
  if (!raw) {
    throw new TrajectoryMsdInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(raw, { structure })
}

const trajectoryMsdManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_msd',
  title: 'Analyze mean-square displacement',
  version: TRAJECTORY_MSD_VERSION,
  description: 'Compute per-element windowed all-time-origin mean-square displacement and an ordinary-least-squares Einstein slope on an exact structure-bound trajectory. Require uniform physical cadence and explicit unwrapped Cartesian coordinates for periodic motion; return Å²/ps diffusion estimates only for non-negative fits, optional R² gates, hard work budgets, exact fingerprints, and maximum-displacement frame targets. A fit is finite-window evidence, not proof of diffusion or convergence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    species: {
      type: 'array',
      minItems: 1,
      maxItems: 118,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
      description: 'Element symbols to analyze; omit to analyze every element in first-occurrence order',
    },
    directions: { enum: ['xyz', 'xy', 'xz', 'yz', 'x', 'y', 'z'], default: 'xyz' },
    maxLagFrames: {
      type: 'integer',
      minimum: 1,
      maximum: 9999,
      description: 'Largest time-origin lag; defaults to floor(frameCount/2)',
    },
    fitLagRangeFrames: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'integer', minimum: 1 },
      description: 'Inclusive [start,end] lag indices for the linear fit; at least three points are required to pass a linearity gate',
    },
    minimumFitRSquared: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Optional hard linear-fit acceptance gate; no universal default is assumed',
    },
    maxDisplacementEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000000,
      default: 50000000,
      description: 'Hard all-time-origin estimator plus localization displacement budget',
    },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'msd', 'diffusion', 'dynamics', 'analysis', 'inspection', 'agent'],
}

const trajectoryMsdTool: ZatomToolDefinition<TrajectoryMsdResult> = {
  manifest: trajectoryMsdManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const trajectory = await resolveTrajectory(input, context, structure)
      const result = analyzeTrajectoryMsd({
        structure,
        trajectory,
        ...(Array.isArray(input.species) ? { species: input.species.map(String) } : {}),
        ...(typeof input.directions === 'string' ? { directions: input.directions as MsdDirections } : {}),
        ...(input.maxLagFrames === undefined ? {} : { maxLagFrames: Number(input.maxLagFrames) }),
        ...(Array.isArray(input.fitLagRangeFrames)
          ? { fitLagRangeFrames: input.fitLagRangeFrames.map(Number) as [number, number] }
          : {}),
        ...(input.minimumFitRSquared === undefined
          ? {}
          : { minimumFitRSquared: Number(input.minimumFitRSquared) }),
        ...(input.maxDisplacementEvaluations === undefined
          ? {}
          : { maxDisplacementEvaluations: Number(input.maxDisplacementEvaluations) }),
      })
      return {
        ok: true,
        tool: trajectoryMsdManifest.name,
        summary: `MSD analysis ${result.verdict}: ${result.species.length} species over ${result.frameCount} frames, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(trajectoryMsdManifest.name, error)
    }
  },
}

export const TRAJECTORY_MSD_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [trajectoryMsdTool]
