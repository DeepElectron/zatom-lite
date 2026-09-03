/** Fingerprint-bound viewport capture and inspection-target focus tools. */

import type {
  CapturedImage,
  InspectionTarget,
  ValidationCheck,
  Vec3,
  ViewportTargetPlacement,
  ZatomStructure,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { boundsOfPositions, fingerprintStructure } from './structure-math'
import { validateStructure, ZatomStructureInputError } from './structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'
import { numberOption, objectSchema, toolError } from './tool-helpers'

function parseVec3Option(value: unknown, name: string): Vec3 | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== 3) {
    throw new ZatomStructureInputError('invalid_vector', `${name} must contain three finite numbers`)
  }
  const parsed: Vec3 = [Number(value[0]), Number(value[1]), Number(value[2])]
  if (parsed.some((item) => !Number.isFinite(item))) {
    throw new ZatomStructureInputError('invalid_vector', `${name} must contain three finite numbers`)
  }
  return parsed
}

const captureManifest: ZatomToolManifest = {
  name: 'viewer_capture',
  title: 'Capture active 3D viewport',
  version: '2.0.0',
  description: 'Capture the active 3D viewport as an image, plus the structure fingerprint and camera pose. Use after a change lands to confirm what the user actually sees.',
  inputSchema: objectSchema({
    expectedStructureFingerprint: { type: 'string', minLength: 1 },
    expectedTrajectoryFingerprint: { type: 'string', minLength: 1 },
    maxDim: { type: 'integer', minimum: 64, maximum: 2048, default: 768 },
    format: { enum: ['jpeg', 'png'], default: 'jpeg' },
  }, ['expectedStructureFingerprint']),
  effects: { structure: 'read', workspace: 'read', visual: 'read' },
  tags: ['viewer', 'capture', 'visual-validation', 'agent'],
}

const viewerCaptureTool: ZatomToolDefinition = {
  manifest: captureManifest,
  execute: async (input, context) => {
    try {
      if (!context.captureViewport) throw new ZatomStructureInputError('capture_unavailable', 'This host did not provide viewport capture')
      const expectedStructureFingerprint = String(input.expectedStructureFingerprint)
      const expectedTrajectoryFingerprint = typeof input.expectedTrajectoryFingerprint === 'string'
        ? input.expectedTrajectoryFingerprint
        : undefined
      const verifyIdentity = async (phase: string) => {
        const structure = await context.readStructure?.()
        const structureFingerprint = structure ? fingerprintStructure(structure) : null
        if (structureFingerprint !== expectedStructureFingerprint) {
          throw new ZatomStructureInputError(
            'visual_structure_identity_mismatch',
            `Active workspace fingerprint ${structureFingerprint ?? 'null'} does not match expected ${expectedStructureFingerprint} ${phase}`,
          )
        }
        let trajectoryFingerprint: string | undefined
        if (expectedTrajectoryFingerprint) {
          const trajectory = await context.readTrajectory?.()
          trajectoryFingerprint = trajectory ? fingerprintTrajectory(parseZatomTrajectory(trajectory)) : undefined
          if (trajectoryFingerprint !== expectedTrajectoryFingerprint) {
            throw new ZatomStructureInputError(
              'visual_trajectory_identity_mismatch',
              `Active trajectory fingerprint ${trajectoryFingerprint ?? 'null'} does not match expected ${expectedTrajectoryFingerprint} ${phase}`,
            )
          }
        }
        return { structure: structure!, structureFingerprint, trajectoryFingerprint }
      }
      await verifyIdentity('before capture')
      const image = await context.captureViewport({
        maxDim: numberOption(input, 'maxDim'),
        format: input.format === 'png' ? 'png' : 'jpeg',
      })
      if (!image) throw new ZatomStructureInputError('viewport_not_ready', 'The 3D viewport is not mounted or has not rendered a non-empty frame')
      const identity = await verifyIdentity('after capture')
      const validation = validateStructure(identity.structure)
      const identityChecks: ValidationCheck[] = [{
        id: 'visual.structure_identity',
        status: 'pass',
        message: `Captured fingerprint-bound workspace ${identity.structureFingerprint}`,
        metrics: { structureFingerprint: identity.structureFingerprint },
      }, ...(identity.trajectoryFingerprint ? [{
        id: 'visual.trajectory_identity',
        status: 'pass' as const,
        message: `Captured fingerprint-bound trajectory ${identity.trajectoryFingerprint}`,
        metrics: { trajectoryFingerprint: identity.trajectoryFingerprint },
      }] : [])]
      return {
        ok: true,
        tool: captureManifest.name,
        summary: `Captured ${image.width}×${image.height} ${image.mimeType}`,
        data: {
          image,
          structureFingerprint: identity.structureFingerprint,
          trajectoryFingerprint: identity.trajectoryFingerprint ?? null,
          atomCount: identity.structure.atoms.length,
          bondCount: identity.structure.bonds?.length ?? null,
          elementCounts: validation.elementCounts,
          bounds: validation.bounds,
          inspectionTargets: validation.inspectionTargets,
        },
        checks: [...identityChecks, ...validation.checks],
      }
    } catch (error) {
      return toolError(captureManifest.name, error)
    }
  },
}

const focusManifest: ZatomToolManifest = {
  name: 'viewer_focus_target',
  title: 'Focus and verify an inspection target',
  version: '3.0.0',
  description: 'Focus the camera on atom ids or a 3D point and optionally capture a screenshot with a reticle on the target. Use when you need visual evidence of a specific site; for plain "show the user X" use viewer_look_at instead. Optionally seeks a trajectory frame first.',
  inputSchema: objectSchema({
    inspectionTarget: objectSchema({
      id: { type: 'string' },
      reason: { type: 'string' },
      center: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
      radius: { type: 'number', minimum: 0 },
      atomIds: { type: 'array', items: { type: 'string' } },
      atomIdsTruncated: { type: 'boolean' },
      trajectoryFrameIndex: { type: 'integer', minimum: 0 },
    }, ['id', 'reason', 'center', 'radius', 'atomIds']),
    atomIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    center: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
    radius: { type: 'number', minimum: 0, default: 2 },
    reason: { type: 'string' },
    expectedStructureFingerprint: { type: 'string', minLength: 1 },
    expectedTrajectoryFingerprint: { type: 'string', minLength: 1 },
    captureAfter: { type: 'boolean', default: true },
    maxDim: { type: 'integer', minimum: 64, maximum: 2048, default: 768 },
  }, ['expectedStructureFingerprint']),
  effects: { structure: 'read', workspace: 'read', visual: 'write' },
  tags: ['viewer', 'focus', 'position', 'visual-validation', 'agent'],
}

interface FocusToolData {
  target: InspectionTarget
  matchedAtomCount: number
  missingAtomIds: string[]
  placement: ViewportTargetPlacement | null
  visualEvidence: CapturedImage | null
}

function validViewportTargetPlacement(value: unknown): value is ViewportTargetPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const placement = value as Record<string, unknown>
  const finiteTuple = (candidate: unknown, size: number) => Array.isArray(candidate)
    && candidate.length === size
    && candidate.every((item) => typeof item === 'number' && Number.isFinite(item))
  return finiteTuple(placement.centerNdc, 3)
    && finiteTuple(placement.centerPx, 2)
    && finiteTuple(placement.viewportSizePx, 2)
    && (placement.viewportSizePx as number[]).every((item) => item > 0)
    && typeof placement.projectedRadiusPx === 'number'
    && Number.isFinite(placement.projectedRadiusPx)
    && placement.projectedRadiusPx >= 0
    && typeof placement.centerVisible === 'boolean'
    && typeof placement.regionVisible === 'boolean'
}

const viewerFocusTargetTool: ZatomToolDefinition<FocusToolData> = {
  manifest: focusManifest,
  execute: async (input, context) => {
    try {
      if (!context.focusInspectionTarget) {
        throw new ZatomStructureInputError('focus_unavailable', 'This host did not provide viewport focusing')
      }
      const supplied = input.inspectionTarget && typeof input.inspectionTarget === 'object' && !Array.isArray(input.inspectionTarget)
        ? input.inspectionTarget as Record<string, unknown>
        : null
      const requestedAtomIds = (Array.isArray(supplied?.atomIds) ? supplied!.atomIds : Array.isArray(input.atomIds) ? input.atomIds : [])
        .map(String)
      let center = parseVec3Option(supplied?.center ?? input.center, 'center')
      let radius = numberOption(supplied ?? input, 'radius')
      const structure = await context.readStructure?.()
      if (!structure) throw new ZatomStructureInputError('no_active_structure', 'Cannot focus a target without an active workspace structure')
      const expectedStructureFingerprint = String(input.expectedStructureFingerprint)
      const activeStructureFingerprint = fingerprintStructure(structure)
      if (activeStructureFingerprint !== expectedStructureFingerprint) {
        throw new ZatomStructureInputError(
          'visual_structure_identity_mismatch',
          `Active workspace fingerprint ${activeStructureFingerprint} does not match expected ${expectedStructureFingerprint}`,
        )
      }
      const byId = new Map((structure?.atoms ?? []).map((atom) => [atom.id, atom]))
      const matchedAtoms = requestedAtomIds.map((id) => byId.get(id)).filter((atom): atom is ZatomStructure['atoms'][number] => !!atom)
      const missingAtomIds = requestedAtomIds.filter((id) => !byId.has(id))
      if (missingAtomIds.length) {
        throw new ZatomStructureInputError(
          'visual_target_atom_ids_missing',
          `${missingAtomIds.length} requested target atom IDs are absent from the fingerprint-bound active workspace`,
        )
      }
      if (!center && matchedAtoms.length) {
        const bounds = boundsOfPositions(matchedAtoms.map((atom) => atom.position))
        center = bounds?.center
        radius ??= bounds ? Math.max(1, bounds.radius) : undefined
      }
      if (!center) {
        throw new ZatomStructureInputError('missing_focus_target', 'Provide inspectionTarget, center, or atomIds present in the active structure')
      }
      let trajectoryFrameIndex: number | undefined
      if (supplied?.trajectoryFrameIndex !== undefined) {
        trajectoryFrameIndex = Number(supplied.trajectoryFrameIndex)
        if (!Number.isSafeInteger(trajectoryFrameIndex) || trajectoryFrameIndex < 0) {
          throw new ZatomStructureInputError('invalid_focus_target', 'inspectionTarget.trajectoryFrameIndex must be a non-negative integer')
        }
      }
      const expectedTrajectoryFingerprint = typeof input.expectedTrajectoryFingerprint === 'string'
        ? input.expectedTrajectoryFingerprint
        : undefined
      if (trajectoryFrameIndex !== undefined && !expectedTrajectoryFingerprint) {
        throw new ZatomStructureInputError(
          'missing_visual_trajectory_identity',
          'A trajectoryFrameIndex requires expectedTrajectoryFingerprint',
        )
      }
      let activeTrajectoryFingerprint: string | undefined
      if (expectedTrajectoryFingerprint) {
        const activeTrajectory = await context.readTrajectory?.()
        if (!activeTrajectory) {
          throw new ZatomStructureInputError('no_active_trajectory', 'The fingerprint-bound visual target requires an active trajectory')
        }
        const parsedTrajectory = parseZatomTrajectory(activeTrajectory)
        activeTrajectoryFingerprint = fingerprintTrajectory(parsedTrajectory)
        if (activeTrajectoryFingerprint !== expectedTrajectoryFingerprint) {
          throw new ZatomStructureInputError(
            'visual_trajectory_identity_mismatch',
            `Active trajectory fingerprint ${activeTrajectoryFingerprint} does not match expected ${expectedTrajectoryFingerprint}`,
          )
        }
        if (trajectoryFrameIndex !== undefined && trajectoryFrameIndex >= parsedTrajectory.frames.length) {
          throw new ZatomStructureInputError(
            'visual_trajectory_frame_unavailable',
            `Trajectory frame ${trajectoryFrameIndex} is outside ${parsedTrajectory.frames.length} active frames`,
          )
        }
      }
      const target: InspectionTarget = {
        id: typeof supplied?.id === 'string' ? supplied.id : 'agent-focus-target',
        reason: typeof (supplied?.reason ?? input.reason) === 'string'
          ? String(supplied?.reason ?? input.reason)
          : 'Agent-requested visual inspection',
        center,
        radius: Math.max(0.1, radius ?? 2),
        atomIds: matchedAtoms.map((atom) => atom.id),
        ...(supplied?.atomIdsTruncated === true ? { atomIdsTruncated: true } : {}),
        ...(trajectoryFrameIndex === undefined ? {} : { trajectoryFrameIndex }),
      }
      const requireIdentityStillMatches = async (phase: string) => {
        const currentStructure = await context.readStructure?.()
        const currentStructureFingerprint = currentStructure ? fingerprintStructure(currentStructure) : null
        if (currentStructureFingerprint !== expectedStructureFingerprint) {
          throw new ZatomStructureInputError(
            'visual_structure_identity_changed',
            `Active workspace identity changed ${phase}; expected ${expectedStructureFingerprint}, received ${currentStructureFingerprint ?? 'null'}`,
          )
        }
        if (expectedTrajectoryFingerprint) {
          const currentTrajectory = await context.readTrajectory?.()
          const currentTrajectoryFingerprint = currentTrajectory
            ? fingerprintTrajectory(parseZatomTrajectory(currentTrajectory))
            : null
          if (currentTrajectoryFingerprint !== expectedTrajectoryFingerprint) {
            throw new ZatomStructureInputError(
              'visual_trajectory_identity_changed',
              `Active trajectory identity changed ${phase}; expected ${expectedTrajectoryFingerprint}, received ${currentTrajectoryFingerprint ?? 'null'}`,
            )
          }
        }
      }
      const rawPlacement = await context.focusInspectionTarget(target)
      if (rawPlacement !== null && !validViewportTargetPlacement(rawPlacement)) {
        throw new ZatomStructureInputError(
          'invalid_visual_target_placement',
          'The visual host returned an invalid screen-space target placement',
        )
      }
      const placement = rawPlacement ?? null
      if (placement && (!placement.centerVisible || !placement.regionVisible)) {
        throw new ZatomStructureInputError(
          'visual_target_outside_viewport',
          'The fingerprint-bound target region is not fully inside the active capture camera after focusing',
        )
      }
      await requireIdentityStillMatches('while focusing the target')

      const captureAfter = input.captureAfter !== false
      let visualEvidence: CapturedImage | null = null
      if (captureAfter && context.captureViewport) {
        visualEvidence = await context.captureViewport({ maxDim: numberOption(input, 'maxDim') ?? 768, format: 'jpeg' })
        await requireIdentityStillMatches('while capturing the target')
      }
      const checks: ValidationCheck[] = [
        {
          id: 'visual.structure_identity',
          status: 'pass',
          message: `Active workspace fingerprint ${activeStructureFingerprint} matches the requested visual target`,
          metrics: { structureFingerprint: activeStructureFingerprint },
        },
        ...(activeTrajectoryFingerprint ? [{
          id: 'visual.trajectory_identity',
          status: 'pass' as const,
          message: `Active trajectory fingerprint ${activeTrajectoryFingerprint} matches the requested visual target`,
          metrics: { trajectoryFingerprint: activeTrajectoryFingerprint },
        }] : []),
        {
          id: 'visual.target_position_resolved',
          status: 'pass',
          message: `Resolved inspection center (${center.map((value) => value.toFixed(3)).join(', ')}) Å and radius ${target.radius.toFixed(3)} Å`,
          metrics: {
            matchedAtomCount: matchedAtoms.length,
            requestedAtomCount: requestedAtomIds.length,
            ...(trajectoryFrameIndex === undefined ? {} : { trajectoryFrameIndex }),
          },
          atomIds: target.atomIds.slice(0, 80),
        },
        {
          id: 'visual.target_screen_placement',
          status: placement ? 'pass' : 'skipped',
          message: placement
            ? `Target center is visible at (${placement.centerPx[0].toFixed(1)}, ${placement.centerPx[1].toFixed(1)}) px in the exact ${placement.viewportSizePx[0]}×${placement.viewportSizePx[1]} capture camera`
            : 'The host focused the target but did not expose screen-space camera placement evidence',
          ...(placement ? {
            metrics: {
              centerNdcX: placement.centerNdc[0],
              centerNdcY: placement.centerNdc[1],
              centerNdcZ: placement.centerNdc[2],
              centerPxX: placement.centerPx[0],
              centerPxY: placement.centerPx[1],
              viewportWidthPx: placement.viewportSizePx[0],
              viewportHeightPx: placement.viewportSizePx[1],
              projectedRadiusPx: placement.projectedRadiusPx,
              regionVisible: placement.regionVisible,
            },
          } : {}),
        },
        {
          id: 'visual.target_atom_ids_present',
          status: 'pass',
          message: `All ${requestedAtomIds.length} requested target atom IDs are present`,
          atomIds: requestedAtomIds.slice(0, 80),
        },
        ...(captureAfter ? [{
          id: 'visual.viewport_capture',
          status: visualEvidence ? 'pass' as const : 'warn' as const,
          message: visualEvidence
            ? `Captured ${visualEvidence.width}×${visualEvidence.height} focused visual evidence`
            : 'The target was focused, but no non-empty viewport image was available',
        }] : []),
      ]
      return {
        ok: true,
        tool: focusManifest.name,
        summary: `Focused inspection target at (${center.map((value) => value.toFixed(3)).join(', ')}) Å${placement ? ', verified its screen placement' : ''}${visualEvidence ? ', and captured visual evidence' : ''}`,
        data: { target, matchedAtomCount: matchedAtoms.length, missingAtomIds, placement, visualEvidence },
        checks,
      }
    } catch (error) {
      return toolError<FocusToolData>(focusManifest.name, error)
    }
  },
}

export const VIEWER_EVIDENCE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  viewerFocusTargetTool,
  viewerCaptureTool,
]
