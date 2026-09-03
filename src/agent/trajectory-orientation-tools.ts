import type {
  Vec3,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import { parseZatomTrajectory } from './trajectory'
import {
  analyzeTrajectoryOrientation,
  TRAJECTORY_ORIENTATION_VERSION,
  TrajectoryOrientationInputError,
  type TrajectoryOrientationDirectorInput,
  type TrajectoryOrientationResult,
} from './trajectory-orientation'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
  structure: ZatomStructure,
): Promise<ZatomTrajectory> {
  const raw = input.trajectory ?? await context.readTrajectory?.()
  if (!raw) {
    throw new TrajectoryOrientationInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(raw, { structure })
}

const orientationManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_orientation',
  title: 'Analyze explicit director orientation',
  version: TRAJECTORY_ORIENTATION_VERSION,
  description: 'Analyze caller-declared ordered atom-pair directors over an exact structure-bound trajectory. Computes signed cos(theta), head-tail-symmetric P2 relative to one explicit Cartesian reference axis, and the independent second-rank orientation tensor/principal director with degeneracy detection. Finite versus exact minimum-image PBC semantics, equal-director/equal-frame weighting, hard budgets, length gates, exact fingerprints, and extremal frame targets are explicit. It never guesses molecule identity from proximity and does not prove equilibrium or convergence.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    directors: {
      type: 'array',
      minItems: 1,
      maxItems: 100000,
      items: objectSchema({
        id: { type: 'string', minLength: 1 },
        fromAtomId: { type: 'string', minLength: 1 },
        toAtomId: { type: 'string', minLength: 1 },
      }, ['id', 'fromAtomId', 'toAtomId']),
      description: 'Distinct explicitly ordered atom pairs. from/to order controls signed cos(theta); P2 and the tensor are head-tail symmetric.',
    },
    referenceAxis: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: { type: 'number' },
      description: 'Nonzero Cartesian reference axis; normalized by the analyzer.',
    },
    periodic: {
      type: 'boolean',
      description: 'Explicitly use the lattice periodic axes and certified minimum-image vectors for every atom pair.',
    },
    maximumDirectorLengthA: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 1000000,
      default: 10,
      description: 'Hard gate on every selected atom-pair director length.',
    },
    minimumMeanReferenceP2: {
      type: 'number',
      minimum: -0.5,
      maximum: 1,
      description: 'Optional lower acceptance gate on the equally weighted global mean P2.',
    },
    maximumMeanReferenceP2: {
      type: 'number',
      minimum: -0.5,
      maximum: 1,
      description: 'Optional upper acceptance gate on the equally weighted global mean P2.',
    },
    startFrameIndex: { type: 'integer', minimum: 0, description: 'First selected frame; default 0.' },
    endFrameIndex: { type: 'integer', minimum: 0, description: 'Inclusive last selected frame; default trajectory end.' },
    frameStride: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    maxDirectorFrameEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 100000000,
      default: 5000000,
      description: 'Hard selected-frame × explicit-director evaluation budget.',
    },
    maxPeriodicImageCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000000,
      default: 50000000,
      description: 'Hard aggregate certified minimum-image candidate budget.',
    },
  }, ['directors', 'referenceAxis', 'periodic']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'orientation', 'director', 'nematic', 'p2', 'tensor', 'periodic', 'inspection', 'agent'],
}

const orientationTool: ZatomToolDefinition<TrajectoryOrientationResult> = {
  manifest: orientationManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const trajectory = await resolveTrajectory(input, context, structure)
      const result = analyzeTrajectoryOrientation({
        structure,
        trajectory,
        directors: input.directors as TrajectoryOrientationDirectorInput[],
        referenceAxis: input.referenceAxis as Vec3,
        periodic: input.periodic === true,
        ...(input.maximumDirectorLengthA === undefined
          ? {}
          : { maximumDirectorLengthA: Number(input.maximumDirectorLengthA) }),
        ...(input.minimumMeanReferenceP2 === undefined
          ? {}
          : { minimumMeanReferenceP2: Number(input.minimumMeanReferenceP2) }),
        ...(input.maximumMeanReferenceP2 === undefined
          ? {}
          : { maximumMeanReferenceP2: Number(input.maximumMeanReferenceP2) }),
        ...(input.startFrameIndex === undefined ? {} : { startFrameIndex: Number(input.startFrameIndex) }),
        ...(input.endFrameIndex === undefined ? {} : { endFrameIndex: Number(input.endFrameIndex) }),
        ...(input.frameStride === undefined ? {} : { frameStride: Number(input.frameStride) }),
        ...(input.maxDirectorFrameEvaluations === undefined
          ? {}
          : { maxDirectorFrameEvaluations: Number(input.maxDirectorFrameEvaluations) }),
        ...(input.maxPeriodicImageCandidates === undefined
          ? {}
          : { maxPeriodicImageCandidates: Number(input.maxPeriodicImageCandidates) }),
      })
      return {
        ok: true,
        tool: orientationManifest.name,
        summary: `Orientation analysis ${result.verdict}: mean reference P2 ${result.meanReferenceP2.toFixed(6)}, principal order ${result.tensor.principalOrder.toFixed(6)}, ${result.directorFrameEvaluations.toLocaleString()} director-frame samples, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(orientationManifest.name, error)
    }
  },
}

export const TRAJECTORY_ORIENTATION_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [orientationTool]
