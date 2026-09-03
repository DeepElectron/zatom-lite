/** MCP-facing canonical trajectory segment stitcher. */

import type {
  ZatomTrajectory,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import { applyTrajectoryCandidate, type CandidateEnvelope } from './candidate-tool'
import {
  stitchZatomTrajectories,
  ZatomTrajectoryStitchInputError,
  type ZatomTrajectoryStitchResult,
} from './trajectory-stitch'
import { toolError } from './tool-helpers'

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  }
}

function numberOption(input: Record<string, unknown>, field: string): number | undefined {
  if (input[field] === undefined) return undefined
  if (typeof input[field] !== 'number' || !Number.isFinite(input[field])) {
    throw new ZatomTrajectoryStitchInputError('invalid_trajectory_stitch_parameter', `${field} must be finite`)
  }
  return input[field]
}

function booleanOption(input: Record<string, unknown>, field: string): boolean | undefined {
  if (input[field] === undefined) return undefined
  if (typeof input[field] !== 'boolean') {
    throw new ZatomTrajectoryStitchInputError('invalid_trajectory_stitch_parameter', `${field} must be boolean`)
  }
  return input[field]
}

const stitchManifest: ZatomToolManifest = {
  name: 'trajectory_stitch_segments',
  title: 'Stitch validated continuation trajectory segments',
  version: '1.0.0',
  description: 'Combine 2-64 canonical parent/child trajectory segments only after ordered atom identity, coordinate mode, duplicate boundary step/time, Cartesian positions, optional velocities, effective lattice, resource budgets, and broker parent-fingerprint links are audited. Exactly one duplicate frame per boundary is removed; no interpolation or hidden checkpoint state is invented.',
  inputSchema: objectSchema({
    segments: {
      type: 'array',
      minItems: 2,
      maxItems: 64,
      items: ZATOM_TRAJECTORY_JSON_SCHEMA,
    },
    label: { type: 'string', minLength: 1, maxLength: 512 },
    maximumBoundaryPositionErrorA: { type: 'number', minimum: 0, maximum: 100, default: 1e-6 },
    maximumBoundaryVelocityErrorAperPs: { type: 'number', minimum: 0, maximum: 1e9, default: 1e-6 },
    maximumBoundaryLatticeErrorA: { type: 'number', minimum: 0, maximum: 100, default: 1e-8 },
    maximumBoundaryTimeErrorPs: { type: 'number', minimum: 0, maximum: 1, default: 1e-12 },
    requireBoundaryVelocities: {
      type: 'boolean',
      default: true,
      description: 'Fail unless both sides of every duplicate boundary carry matching velocity vectors.',
    },
    requireParentFingerprintChain: {
      type: 'boolean',
      default: true,
      description: 'Fail unless every child declares the exact preceding fingerprint in zatom.provider.sourceTrajectoryFingerprint metadata.',
    },
    maxFrames: { type: 'integer', minimum: 2, maximum: 10_000, default: 10_000 },
    maxAtomFrames: { type: 'integer', minimum: 2, maximum: 10_000_000, default: 10_000_000 },
    applyToWorkspace: { type: 'boolean', default: false },
    captureAfter: { type: 'boolean', description: 'Default true when applying the stitched trajectory.' },
  }, ['segments']),
  effects: { structure: 'none', workspace: 'write', visual: 'read' },
  tags: ['trajectory', 'continuation', 'stitch', 'fingerprint', 'boundary', 'validation', 'visual-validation', 'agent'],
}

type StitchToolData = CandidateEnvelope<ZatomTrajectoryStitchResult>

const stitchTool: ZatomToolDefinition<StitchToolData> = {
  manifest: stitchManifest,
  execute: async (input, context) => {
    try {
      if (!Array.isArray(input.segments)) {
        throw new ZatomTrajectoryStitchInputError('invalid_trajectory_segments', 'segments must be an array')
      }
      if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim())) {
        throw new ZatomTrajectoryStitchInputError('invalid_trajectory_stitch_parameter', 'label must be a non-empty string')
      }
      const result = stitchZatomTrajectories({
        segments: input.segments as ZatomTrajectory[],
        label: typeof input.label === 'string' ? input.label : undefined,
        maximumBoundaryPositionErrorA: numberOption(input, 'maximumBoundaryPositionErrorA'),
        maximumBoundaryVelocityErrorAperPs: numberOption(input, 'maximumBoundaryVelocityErrorAperPs'),
        maximumBoundaryLatticeErrorA: numberOption(input, 'maximumBoundaryLatticeErrorA'),
        maximumBoundaryTimeErrorPs: numberOption(input, 'maximumBoundaryTimeErrorPs'),
        requireBoundaryVelocities: booleanOption(input, 'requireBoundaryVelocities'),
        requireParentFingerprintChain: booleanOption(input, 'requireParentFingerprintChain'),
        maxFrames: numberOption(input, 'maxFrames'),
        maxAtomFrames: numberOption(input, 'maxAtomFrames'),
      })
      const requestedApply = input.applyToWorkspace === true
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      const envelope = await applyTrajectoryCandidate({ result, requestedApply, captureAfter, context })
      const failed = envelope.result.checks.filter((check) => check.status === 'fail').length
      return {
        ok: true,
        tool: stitchManifest.name,
        summary: `Stitched ${input.segments.length} segments into ${result.trajectory.frames.length} frames; ${failed} gate(s) failed${envelope.appliedToWorkspace ? envelope.applicationVerified === true ? '; applied and fingerprint-verified' : '; applied without verified identity' : envelope.applicationBlocked ? '; workspace application blocked' : '; artifact only'}`,
        data: envelope,
        checks: envelope.result.checks,
      }
    } catch (error) {
      return toolError<StitchToolData>(stitchManifest.name, error)
    }
  },
}

export const TRAJECTORY_STITCH_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [stitchTool]
