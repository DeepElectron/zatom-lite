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
  analyzeTrajectoryHydrogenBonds,
  TRAJECTORY_HYDROGEN_BOND_VERSION,
  TrajectoryHydrogenBondInputError,
  type TrajectoryHydrogenBondResult,
} from './trajectory-hydrogen-bonds'
import { objectSchema, resolveStructure, toolError } from './tool-helpers'

async function resolveTrajectory(
  input: Record<string, unknown>,
  context: ZatomToolContext,
  structure: ZatomStructure,
): Promise<ZatomTrajectory> {
  const raw = input.trajectory ?? await context.readTrajectory?.()
  if (!raw) {
    throw new TrajectoryHydrogenBondInputError(
      'no_active_trajectory',
      'No trajectory was supplied and the active workspace has no readable trajectory',
    )
  }
  return parseZatomTrajectory(raw, { structure })
}

const atomIdsSchema = {
  type: 'array',
  minItems: 1,
  maxItems: 100000,
  uniqueItems: true,
  items: { type: 'string', minLength: 1 },
}

const hydrogenBondManifest: ZatomToolManifest = {
  name: 'trajectory_analyze_hydrogen_bonds',
  title: 'Analyze topology-bound hydrogen bonds',
  version: TRAJECTORY_HYDROGEN_BOND_VERSION,
  description: 'Detect caller-declared donor/acceptor hydrogen bonds over an exact structure-bound trajectory. Donor-hydrogen identity comes only from explicit structure bonds; finite versus periodic semantics are explicit, and periodic triplets use one hydrogen-centered donor image plus complete acceptor-image enumeration so distance and D-H-A angle refer to the same geometry. Return every frame observation, occurrence and continuous sampled runs, donor-bond gates, hard budgets, exact fingerprints, and frame targets. Geometric detection is not electronic proof or a lifetime autocorrelation.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    donorAtomIds: {
      ...atomIdsSchema,
      description: 'Exact non-hydrogen donor atoms; every donor must have at least one explicit bond to H',
    },
    acceptorAtomIds: {
      ...atomIdsSchema,
      description: 'Exact caller-validated non-hydrogen acceptor atoms; chemical acceptor identity is never guessed from element alone',
    },
    periodic: {
      type: 'boolean',
      description: 'Explicitly use declared lattice periodic axes for consistent triplet geometry',
    },
    donorAcceptorCutoffA: { type: 'number', exclusiveMinimum: 0, maximum: 100, default: 3 },
    minimumDhaAngleDeg: { type: 'number', minimum: 0, maximum: 180, default: 150 },
    maximumDonorHydrogenDistanceA: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 10,
      default: 1.5,
      description: 'Hard gate on every explicit donor-H bond in every selected frame',
    },
    startFrameIndex: { type: 'integer', minimum: 0, description: 'First selected frame; default 0' },
    endFrameIndex: { type: 'integer', minimum: 0, description: 'Inclusive last selected frame; default trajectory end' },
    frameStride: { type: 'integer', minimum: 1, maximum: 10000, default: 1 },
    maxTripleEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 100000000,
      default: 5000000,
      description: 'Hard selected-frame × explicit donor-H pair × acceptor budget after direct covalent exclusions',
    },
    maxPeriodicImageCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 1000000000,
      default: 50000000,
      description: 'Hard aggregate closest-donor plus complete acceptor-image candidate budget',
    },
  }, ['donorAtomIds', 'acceptorAtomIds', 'periodic']),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['trajectory', 'hydrogen-bond', 'topology', 'periodic', 'lifetime', 'inspection', 'agent'],
}

const hydrogenBondTool: ZatomToolDefinition<TrajectoryHydrogenBondResult> = {
  manifest: hydrogenBondManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const trajectory = await resolveTrajectory(input, context, structure)
      const result = analyzeTrajectoryHydrogenBonds({
        structure,
        trajectory,
        donorAtomIds: (input.donorAtomIds as unknown[]).map(String),
        acceptorAtomIds: (input.acceptorAtomIds as unknown[]).map(String),
        periodic: input.periodic === true,
        ...(input.donorAcceptorCutoffA === undefined
          ? {}
          : { donorAcceptorCutoffA: Number(input.donorAcceptorCutoffA) }),
        ...(input.minimumDhaAngleDeg === undefined
          ? {}
          : { minimumDhaAngleDeg: Number(input.minimumDhaAngleDeg) }),
        ...(input.maximumDonorHydrogenDistanceA === undefined
          ? {}
          : { maximumDonorHydrogenDistanceA: Number(input.maximumDonorHydrogenDistanceA) }),
        ...(input.startFrameIndex === undefined ? {} : { startFrameIndex: Number(input.startFrameIndex) }),
        ...(input.endFrameIndex === undefined ? {} : { endFrameIndex: Number(input.endFrameIndex) }),
        ...(input.frameStride === undefined ? {} : { frameStride: Number(input.frameStride) }),
        ...(input.maxTripleEvaluations === undefined
          ? {}
          : { maxTripleEvaluations: Number(input.maxTripleEvaluations) }),
        ...(input.maxPeriodicImageCandidates === undefined
          ? {}
          : { maxPeriodicImageCandidates: Number(input.maxPeriodicImageCandidates) }),
      })
      return {
        ok: true,
        tool: hydrogenBondManifest.name,
        summary: `Hydrogen-bond analysis ${result.verdict}: ${result.eventCount.toLocaleString()} observations across ${result.hydrogenBonds.length} exact triples, fingerprint ${result.fingerprint}`,
        data: result,
        checks: result.checks,
      }
    } catch (error) {
      return toolError(hydrogenBondManifest.name, error)
    }
  },
}

export const TRAJECTORY_HYDROGEN_BOND_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [hydrogenBondTool]
