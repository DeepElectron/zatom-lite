/** Agent tool for conversational rigid poses of an existing finite component. */

import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import type {
  Vec3,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import {
  poseStructureComponentSemantically,
  SemanticPoseInputError,
  type SemanticComponentPoseResult,
  type SemanticPoseTarget,
} from './semantic-pose'
import { fingerprintStructure } from './structure-math'
import { buildStructureChangeSet } from './operations'
import { ZATOM_STRUCTURE_SCHEMA } from './contracts'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

const semanticTargetSchema = {
  oneOf: [
    objectSchema({
      kind: { const: 'atom' },
      atomId: { type: 'string', minLength: 1 },
      relation: { enum: ['toward', 'away'], default: 'toward' },
    }, ['kind', 'atomId']),
    objectSchema({
      kind: { const: 'point' },
      point: vec3Schema,
      relation: { enum: ['toward', 'away'], default: 'toward' },
    }, ['kind', 'point']),
    objectSchema({
      kind: { const: 'vector' },
      vector: vec3Schema,
      relation: { enum: ['along', 'against'], default: 'along' },
    }, ['kind', 'vector']),
    objectSchema({
      kind: { const: 'surface' },
      relation: {
        enum: ['toward', 'away'],
      },
    }, ['kind', 'relation']),
  ],
}

const semanticPoseManifest: ZatomToolManifest = {
  name: 'structure_pose_component',
  title: 'Pose an existing component by spatial meaning',
  version: '1.1.0',
  description:
    'Rigidly pose an existing molecule/adsorbate. Name every movable component atom, a fixed rotation anchor, and direction atoms defining a centroid/bisector axis; aim it toward/away from an external atom, point, vector, or surface. rollDeg turns around that target axis; translationA moves along it (surface/away + alignDirection=false means “farther from the surface”). To adjust a ghost that is already awaiting Apply, pass proposalId plus its expectedPreviewRevision and expectedCandidateFingerprint: the same proposal is revised in place, the active structure stays untouched, and the user still applies only once. Otherwise the default is a detached candidate and applyToWorkspace=true uses proposal/review. Resolve ambiguous atoms first.',
  inputSchema: objectSchema({
    componentAtomIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100000,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    anchorAtomId: {
      type: 'string',
      minLength: 1,
    },
    directionAtomIds: {
      type: 'array',
      minItems: 1,
      maxItems: 100000,
      uniqueItems: true,
      items: { type: 'string', minLength: 1 },
    },
    directionMode: {
      enum: ['centroid', 'bisector'],
      default: 'centroid',
    },
    target: semanticTargetSchema,
    alignDirection: {
      type: 'boolean',
      default: true,
    },
    rollDeg: {
      type: 'number',
      minimum: -36000,
      maximum: 36000,
      default: 0,
    },
    translationA: {
      type: 'number',
      minimum: -1000,
      maximum: 1000,
      default: 0,
    },
    expectedFingerprint: {
      type: 'string',
    },
    proposalId: {
      type: 'string',
      minLength: 1,
      description: 'Pending proposal to adjust in place. Requires both preview guards returned by that proposal.',
    },
    expectedPreviewRevision: {
      type: 'integer',
      minimum: 1,
      description: 'Current previewRevision from structure_proposal_status.',
    },
    expectedCandidateFingerprint: {
      type: 'string',
      minLength: 1,
      description: 'Current candidateFingerprint from structure_proposal_status.',
    },
    applyToWorkspace: { type: 'boolean', default: false },
  }, ['componentAtomIds', 'anchorAtomId', 'directionAtomIds', 'target']),
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'component', 'adsorbate', 'pose', 'semantic', 'rotation', 'alignment', 'surface', 'proposal', 'agent'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function vec3(value: unknown, field: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new SemanticPoseInputError('invalid_semantic_pose_vector', `${field} must contain three numbers`)
  }
  const parsed: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (parsed.some((item) => !Number.isFinite(item))) {
    throw new SemanticPoseInputError('invalid_semantic_pose_vector', `${field} must contain three finite numbers`)
  }
  return parsed
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new SemanticPoseInputError('invalid_semantic_pose_atom_id', `${field} must be an atom-ID array`)
  }
  return value.map((item) => item.trim())
}

function throwIfSemanticPoseCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new SemanticPoseInputError('tool_execution_aborted', 'The component pose was cancelled.')
}

function proposalRefinementGuard(input: Record<string, unknown>): {
  id: string
  expectedPreviewRevision: number
  expectedCandidateFingerprint: string
} | null {
  const fields = [input.proposalId, input.expectedPreviewRevision, input.expectedCandidateFingerprint]
  if (fields.every((value) => value === undefined)) return null
  if (typeof input.proposalId !== 'string' || !input.proposalId.trim()
    || typeof input.expectedPreviewRevision !== 'number'
    || !Number.isInteger(input.expectedPreviewRevision)
    || input.expectedPreviewRevision < 1
    || typeof input.expectedCandidateFingerprint !== 'string'
    || !input.expectedCandidateFingerprint) {
    throw new SemanticPoseInputError(
      'invalid_proposal_revision_guard',
      'Refining a ghost requires proposalId, expectedPreviewRevision, and expectedCandidateFingerprint from the latest proposal status.',
    )
  }
  if (input.structure !== undefined) {
    throw new SemanticPoseInputError(
      'ambiguous_proposal_refinement_source',
      'Do not pass structure while refining a proposal; the pose must start from the exact ghost candidate.',
    )
  }
  return {
    id: input.proposalId.trim(),
    expectedPreviewRevision: input.expectedPreviewRevision,
    expectedCandidateFingerprint: input.expectedCandidateFingerprint,
  }
}

function parseTarget(value: unknown): SemanticPoseTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new SemanticPoseInputError('invalid_semantic_pose_target', 'target must be an atom, point, vector, or surface target')
  }
  switch (value.kind) {
    case 'atom':
      return {
        kind: 'atom',
        atomId: String(value.atomId),
        ...(value.relation === undefined ? {} : { relation: value.relation as 'toward' | 'away' }),
      }
    case 'point':
      return {
        kind: 'point',
        point: vec3(value.point, 'target.point'),
        ...(value.relation === undefined ? {} : { relation: value.relation as 'toward' | 'away' }),
      }
    case 'vector':
      return {
        kind: 'vector',
        vector: vec3(value.vector, 'target.vector'),
        ...(value.relation === undefined ? {} : { relation: value.relation as 'along' | 'against' }),
      }
    case 'surface':
      return { kind: 'surface', relation: value.relation as 'toward' | 'away' }
    default:
      throw new SemanticPoseInputError('invalid_semantic_pose_target', `Unsupported target kind "${value.kind}"`)
  }
}

type SemanticPoseToolData = CandidateEnvelope<SemanticComponentPoseResult>

const semanticPoseTool: ZatomToolDefinition<SemanticPoseToolData> = {
  manifest: semanticPoseManifest,
  execute: async (input, context) => {
    try {
      throwIfSemanticPoseCancelled(context.signal)
      const refinement = proposalRefinementGuard(input)
      if (refinement && (!context.proposal?.readCandidate || !context.proposal.revise || !context.readStructure)) {
        throw new SemanticPoseInputError(
          'proposal_refinement_unavailable',
          'This host cannot read and atomically revise a pending proposal candidate.',
        )
      }
      const pending = refinement
        ? await context.proposal!.readCandidate({ ...refinement, signal: context.signal })
        : null
      throwIfSemanticPoseCancelled(context.signal)
      const source = pending?.candidate ?? await resolveStructure(input, context)
      throwIfSemanticPoseCancelled(context.signal)
      const sourceFingerprint = fingerprintStructure(source)
      if (refinement && sourceFingerprint !== refinement.expectedCandidateFingerprint) {
        throw new SemanticPoseInputError(
          'stale_proposal_preview',
          `Proposal ${refinement.id} candidate is ${sourceFingerprint}, not ${refinement.expectedCandidateFingerprint}. Read its latest status before adjusting it.`,
        )
      }
      if (!refinement && typeof input.expectedFingerprint === 'string' && input.expectedFingerprint !== sourceFingerprint) {
        throw new SemanticPoseInputError(
          'stale_fingerprint',
          `Active structure fingerprint is ${sourceFingerprint}, not ${input.expectedFingerprint}. Re-observe before posing the component.`,
        )
      }
      const result = poseStructureComponentSemantically({
        structure: source,
        componentAtomIds: stringList(input.componentAtomIds, 'componentAtomIds'),
        anchorAtomId: String(input.anchorAtomId),
        directionAtomIds: stringList(input.directionAtomIds, 'directionAtomIds'),
        directionMode: input.directionMode as 'centroid' | 'bisector' | undefined,
        target: parseTarget(input.target),
        alignDirection: input.alignDirection === undefined ? undefined : input.alignDirection === true,
        rollDeg: numberOption(input, 'rollDeg'),
        translationA: numberOption(input, 'translationA'),
      })
      const requestedApply = input.applyToWorkspace === true
      const targetLabel = result.semanticPose.target.kind === 'atom'
        ? `${result.semanticPose.target.relation ?? 'toward'} atom ${result.semanticPose.target.atomId}`
        : result.semanticPose.target.kind === 'surface'
          ? `${result.semanticPose.target.relation} from the surface`
          : result.semanticPose.target.kind === 'point'
            ? `${result.semanticPose.target.relation ?? 'toward'} target point`
            : `${result.semanticPose.target.relation ?? 'along'} target vector`
      const intent = `Pose ${result.semanticPose.componentAtomIds.length}-atom component around ${result.semanticPose.anchorAtomId}: ${targetLabel}`
      if (refinement) {
        const failed = result.checks.filter((check) => check.status === 'fail')
        if (failed.length) {
          throw new SemanticPoseInputError(
            'proposal_refinement_failed_checks',
            `The adjusted ghost failed validation and was not published: ${failed.map((check) => check.message).join('; ')}`,
          )
        }
        // Recompute the visible diff from the untouched active baseline, not
        // from the previous ghost. Otherwise refining a newly placed molecule
        // would turn its "added" atoms into mere "moved" atoms in the card.
        const baseline = await context.readStructure!()
        throwIfSemanticPoseCancelled(context.signal)
        const revised = await context.proposal!.revise({
          ...refinement,
          intent,
          candidate: result.structure,
          changeSet: buildStructureChangeSet(
            baseline ?? { schemaVersion: ZATOM_STRUCTURE_SCHEMA, atoms: [] },
            result.structure,
          ),
          checks: result.checks,
          inspectionTargets: result.inspectionTargets,
          signal: context.signal,
        })
        throwIfSemanticPoseCancelled(context.signal)
        const checks = [
          ...result.checks,
          {
            id: 'candidate.application_gate',
            status: 'pass' as const,
            message: `Revised preview ${revised.id} to r${revised.previewRevision}; the active structure is unchanged until the user presses Apply.`,
          },
        ]
        return {
          ok: true,
          tool: semanticPoseManifest.name,
          summary: `${intent}; revised ${revised.id} in place to preview r${revised.previewRevision}. The user can inspect the new ghost and Apply once.`,
          data: {
            result: { ...result, checks },
            appliedToWorkspace: false,
            applicationBlocked: false,
            applicationVerified: null,
            visualEvidence: null,
            proposal: revised,
          },
          checks,
        }
      }
      return await finalizeStructureCandidate({
        tool: semanticPoseManifest.name,
        result,
        requestedApply,
        captureAfter: requestedApply,
        context,
        proposalIntent: intent,
        summary: (applied, blocked, verified) => (
          `${intent}; ${result.changeSet.movedCount ?? 0} atom(s) changed in the resolved rigid pose`
          + `${applied ? verified === true ? ' and workspace readback was verified' : ' and the workspace was updated' : blocked ? '; workspace application was blocked' : '; returned as a candidate'}`
        ),
      })
    } catch (error) {
      return toolError<SemanticPoseToolData>(semanticPoseManifest.name, error)
    }
  },
}

export const SEMANTIC_POSE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [semanticPoseTool]
