/** Workspace read/write and structure validation tools. */

import type {
  HistorySnapshot,
  InspectionTarget,
  ValidationCheck,
  ZatomHistorySurface,
  ZatomStructure,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
  ZatomTrajectory,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA, ZATOM_TRAJECTORY_JSON_SCHEMA } from './contracts'
import { checkStructureSanity, type SanityReport } from '../lib/scene-grid/sanity'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import { fingerprintStructure } from './structure-math'
import { validateStructure, ZatomStructureInputError } from './structure-validation'
import { fingerprintTrajectory, parseZatomTrajectory } from './trajectory'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'
import { parseZatomStructure } from './structure-validation'
import { auditStructureHealth } from './structure-health'

const validateManifest: ZatomToolManifest = {
  name: 'structure_validate',
  title: 'Validate atomic structure',
  version: '2.0.0',
  description: 'Validate schema, finite Cartesian positions, element symbols, lattice volume, atom IDs, and exact small-system or complete cutoff-based large-system minimum distance, including certified skew-cell periodic images. Large scans fail closed when a declared budget is exhausted. Uses the active workspace when structure is omitted.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    overlapDistanceA: { type: 'number', minimum: 0, default: 0.35 },
    closePairWarningA: { type: 'number', minimum: 0, default: 0.60 },
    maxMinimumImageCandidateEvaluations: {
      type: 'integer',
      minimum: 1,
      maximum: 200000000,
      default: 50000000,
      description: 'Hard aggregate candidate budget for exact periodic self-image and distinct-pair searches',
    },
    maxClosePairCandidates: {
      type: 'integer',
      minimum: 1,
      maximum: 200000000,
      default: 50000000,
      description: 'Hard spatial candidate-pair budget for complete close-contact validation above the exact all-pairs atom limit',
    },
    requirePeriodic: { type: 'boolean', default: false },
  }),
  outputSchema: objectSchema({ verdict: { enum: ['pass', 'warn', 'fail'] }, checks: { type: 'array' } }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['structure', 'validation', 'position', 'agent'],
}

const structureValidateTool: ZatomToolDefinition = {
  manifest: validateManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const report = validateStructure(structure, {
        overlapDistanceA: numberOption(input, 'overlapDistanceA'),
        closePairWarningA: numberOption(input, 'closePairWarningA'),
        maxClosePairCandidates: numberOption(input, 'maxClosePairCandidates'),
        maxMinimumImageCandidateEvaluations: numberOption(input, 'maxMinimumImageCandidateEvaluations'),
        requirePeriodic: input.requirePeriodic === true,
      })
      return {
        ok: true,
        tool: validateManifest.name,
        summary: `Structure validation ${report.verdict}: ${report.atomCount.toLocaleString()} atoms; ${report.checks.find((check) => check.id === 'structure.minimum_distance')?.message ?? 'minimum-distance result unavailable'}`,
        data: report,
        checks: report.checks,
      }
    } catch (error) {
      return toolError(validateManifest.name, error)
    }
  },
}

const workspaceGetStructureManifest: ZatomToolManifest = {
  name: 'workspace_get_active_structure',
  title: 'Read active workspace structure',
  version: '1.0.0',
  description: 'Read the structure currently in the active viewport: atom ids, elements, Cartesian positions in Å, bonds, lattice, composition and the structure fingerprint. Paginated for large structures. Call this before any edit and again after any change lands — atom ids and the fingerprint are what every other structure tool expects.',
  inputSchema: objectSchema({
    offset: { type: 'integer', minimum: 0, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 2000, default: 500 },
    bondOffset: { type: 'integer', minimum: 0, default: 0 },
    bondLimit: { type: 'integer', minimum: 1, maximum: 4000, default: 1000 },
    elements: { type: 'array', items: { type: 'string' } },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['workspace', 'structure', 'position', 'agent'],
}

const workspaceGetStructureTool: ZatomToolDefinition = {
  manifest: workspaceGetStructureManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure({}, context)
      const report = validateStructure(structure)
      const workspaceIdentity = await context.workspaceIdentity?.()
      const activeTrajectory = await context.readTrajectory?.() ?? null
      const trajectory = activeTrajectory ? parseZatomTrajectory(activeTrajectory) : null
      const metadata = structure.metadata
        ? Object.fromEntries(Object.entries(structure.metadata).filter(([key]) => key !== 'viewer'))
        : undefined
      const wanted = Array.isArray(input.elements) ? new Set(input.elements.map((value) => String(value).toLowerCase())) : null
      const offset = Math.max(0, Math.trunc(numberOption(input, 'offset') ?? 0))
      const limit = Math.max(1, Math.min(2000, Math.trunc(numberOption(input, 'limit') ?? 500)))
      const matched = structure.atoms
        .map((atom, index) => ({ index, atom }))
        .filter(({ atom }) => !wanted || wanted.has(atom.element.toLowerCase()))
      const page = matched.slice(offset, offset + limit).map(({ index, atom }) => ({ index, ...atom }))
      const bondOffset = Math.max(0, Math.trunc(numberOption(input, 'bondOffset') ?? 0))
      const bondLimit = Math.max(1, Math.min(4000, Math.trunc(numberOption(input, 'bondLimit') ?? 1000)))
      const bondPage = structure.bonds?.slice(bondOffset, bondOffset + bondLimit)
      return {
        ok: true,
        tool: workspaceGetStructureManifest.name,
        summary: `Active workspace: ${structure.atoms.length.toLocaleString()} atoms; returned ${page.length} from offset ${offset}`,
        data: {
          schemaVersion: structure.schemaVersion,
          structureFingerprint: fingerprintStructure(structure),
          ...(workspaceIdentity ? {
            viewportId: workspaceIdentity.viewportId,
            workspaceRevision: workspaceIdentity.revision,
          } : {}),
          label: structure.label,
          metadata,
          atomCount: structure.atoms.length,
          bondCount: structure.bonds?.length ?? null,
          returnedCount: page.length,
          matchedCount: matched.length,
          truncated: offset + page.length < matched.length,
          lattice: structure.lattice,
          elementCounts: report.elementCounts,
          bounds: report.bounds,
          validationVerdict: report.verdict,
          trajectory: trajectory ? {
            fingerprint: fingerprintTrajectory(trajectory),
            atomCount: trajectory.atomIds.length,
            frameCount: trajectory.frames.length,
            coordinateMode: trajectory.coordinateMode,
            firstStep: trajectory.frames[0].step,
            finalStep: trajectory.frames[trajectory.frames.length - 1].step,
            firstTimePs: trajectory.frames[0].timePs,
            finalTimePs: trajectory.frames[trajectory.frames.length - 1].timePs,
          } : null,
          inspectionTargets: report.inspectionTargets,
          atoms: page,
          ...(bondPage ? {
            bonds: bondPage,
            returnedBondCount: bondPage.length,
            bondsTruncated: bondOffset + bondPage.length < structure.bonds!.length,
          } : {}),
        },
        checks: report.checks,
      }
    } catch (error) {
      return toolError(workspaceGetStructureManifest.name, error)
    }
  },
}

interface WorkspaceSetCandidate {
  structure: ZatomStructure
  trajectory?: ZatomTrajectory
  checks: ValidationCheck[]
  inspectionTargets: InspectionTarget[]
  provenance: {
    engine: string
    engineVersion: string
    sourceFingerprint: string
    resultFingerprint: string
    trajectoryFingerprint?: string
    parameters: { trajectoryIncluded: boolean }
  }
}

const workspaceSetStructureManifest: ZatomToolManifest = {
  name: 'workspace_set_active_structure',
  title: 'Set active workspace structure',
  version: '1.0.0',
  description: 'Replace the active viewport structure wholesale (optionally with a matching trajectory). Use for loading a structure you built or imported; for editing the current one prefer structure_propose_operations. Returns the new fingerprint.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    trajectory: ZATOM_TRAJECTORY_JSON_SCHEMA,
    captureAfter: { type: 'boolean', default: false },
  }, ['structure']),
  effects: { structure: 'read', workspace: 'write', visual: 'read' },
  tags: ['workspace', 'structure', 'trajectory', 'validation', 'agent'],
}

type WorkspaceSetStructureData = CandidateEnvelope<WorkspaceSetCandidate>

const workspaceSetStructureTool: ZatomToolDefinition<WorkspaceSetStructureData> = {
  manifest: workspaceSetStructureManifest,
  execute: async (input, context) => {
    try {
      const structure = parseZatomStructure(input.structure)
      const validation = validateStructure(structure)
      const trajectory = input.trajectory === undefined
        ? undefined
        : parseZatomTrajectory(input.trajectory, { structure })
      if (trajectory && (!context.writeTrajectory || !context.readTrajectory)) {
        throw new ZatomStructureInputError(
          'trajectory_workspace_unavailable',
          'This host cannot write and verify the supplied active trajectory',
        )
      }
      const structureFingerprint = fingerprintStructure(structure)
      const candidate: WorkspaceSetCandidate = {
        structure,
        ...(trajectory ? { trajectory } : {}),
        checks: validation.checks,
        inspectionTargets: validation.inspectionTargets,
        provenance: {
          engine: 'zatom.workspace',
          engineVersion: '1.0.0',
          sourceFingerprint: structureFingerprint,
          resultFingerprint: structureFingerprint,
          ...(trajectory ? { trajectoryFingerprint: fingerprintTrajectory(trajectory) } : {}),
          parameters: { trajectoryIncluded: !!trajectory },
        },
      }
      return await finalizeStructureCandidate({
        tool: workspaceSetStructureManifest.name,
        result: candidate,
        requestedApply: true,
        captureAfter: input.captureAfter === true,
        context,
        summary: (applied, blocked, verified) => applied
          ? verified === true
            ? `Set and fingerprint-verified ${structure.atoms.length.toLocaleString()} active workspace atoms${trajectory ? ` with ${trajectory.frames.length} trajectory frames` : ''}`
            : 'Set the active workspace, but readback identity did not verify'
          : blocked
            ? 'Active workspace update was blocked by validation or host checks'
            : 'Active workspace was not updated',
      })
    } catch (error) {
      return toolError<WorkspaceSetStructureData>(workspaceSetStructureManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* structure_check_sanity — chemistry-aware "does this look right?"    */
/* ------------------------------------------------------------------ */

const sanityManifest: ZatomToolManifest = {
  name: 'structure_check_sanity',
  title: 'Check chemical sanity',
  version: '1.1.0',
  description:
    'Unified post-edit health check used by both Agent and review card. Flags overlaps/too-close contacts, floating adsorbates, atoms in vacuum, abnormal or image-closing bonds, insufficient slab vacuum, periodic wrapping, and schema/minimum-distance failures. Returns pair-scan completeness; incomplete coverage always warns and never proves safety. Uses the active workspace when structure is omitted.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    focusAtomIds: { type: 'array', items: { type: 'string' }, maxItems: 5000 },
    overlapRatio: { type: 'number', minimum: 0.1, maximum: 1, default: 0.6 },
    tooCloseRatio: { type: 'number', minimum: 0.1, maximum: 1.5, default: 0.8 },
    maxPairs: {
      type: 'integer',
      minimum: 1,
      maximum: 2000000,
      default: 2000000,
      description: 'Hard budget for unique focus-to-structure pairs; exhausting it returns an incomplete warning, never a pass',
    },
  }),
  outputSchema: objectSchema({
    status: { enum: ['pass', 'warn', 'fail'] },
    complete: { type: 'boolean' },
    scannedPairs: { type: 'integer', minimum: 0 },
    maxPairs: { type: 'integer', minimum: 1 },
    budgetExhausted: { type: 'boolean' },
    checks: { type: 'array' },
    inspectionTargets: { type: 'array' },
  }),
  effects: { structure: 'read', workspace: 'read', visual: 'none' },
  tags: ['structure', 'validation', 'chemistry', 'agent'],
}

const structureCheckSanityTool: ZatomToolDefinition<SanityReport & { health: ReturnType<typeof auditStructureHealth> }> = {
  manifest: sanityManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const report = checkStructureSanity(structure, {
        focusAtomIds: Array.isArray(input.focusAtomIds)
          ? input.focusAtomIds.filter((id): id is string => typeof id === 'string')
          : undefined,
        overlapRatio: numberOption(input, 'overlapRatio'),
        tooCloseRatio: numberOption(input, 'tooCloseRatio'),
        maxPairs: numberOption(input, 'maxPairs'),
      })
      const health = auditStructureHealth(structure)
      // Keep the structural validator in the same top-level decision surface as
      // chemistry sanity. In particular, the large-system spatial audit can
      // find a collision after the caller's focus-pair budget has ended; hiding
      // it inside `health` would leave `status` at warn instead of fail.
      const checks = [...report.checks, ...health.checks]
      const status = checks.some((check) => check.status === 'fail')
        ? 'fail' as const
        : checks.some((check) => check.status === 'warn') ? 'warn' as const : 'pass' as const
      const data = {
        ...report,
        status,
        checks,
        inspectionTargets: [...report.inspectionTargets, ...health.validation.inspectionTargets],
        health,
      }
      const problems = checks
        .filter((check) => check.status !== 'pass' && check.status !== 'skipped')
        .sort((left, right) => Number(right.status === 'fail') - Number(left.status === 'fail'))
      const summary = problems.length
        ? `${status.toUpperCase()}: ${problems.slice(0, 3).map((c) => c.message).join('; ')}${problems.length > 3 ? ` (+${problems.length - 3} more)` : ''}; ${report.scannedPairs.toLocaleString()} pair(s) scanned${report.complete ? '' : ' (incomplete)'}`
        : `pass: ${checks.length} check(s), ${report.scannedPairs.toLocaleString()} pairs scanned, no problems`
      if (context.guidance) {
        const guidance = await context.guidance.read()
        const verifyIndex = guidance.plan?.steps.findIndex((step) => /verify/i.test(step.label)) ?? -1
        if (verifyIndex >= 0 && guidance.plan) {
          await context.guidance.advance(
            status === 'pass' ? guidance.plan.steps.length : verifyIndex,
            status === 'pass'
              ? `Verification passed: ${report.scannedPairs.toLocaleString()} pairs checked.`
              : `${status.toUpperCase()}: review the reported structure issues before continuing.`,
          )
        }
      }
      return { ok: true, tool: sanityManifest.name, summary, data, checks }
    } catch (error) {
      return toolError<SanityReport & { health: ReturnType<typeof auditStructureHealth> }>(sanityManifest.name, error)
    }
  },
}

/* ------------------------------------------------------------------ */
/* workspace_history / undo / redo                                     */
/* ------------------------------------------------------------------ */

function requireHistory(context: ZatomToolContext): ZatomHistorySurface {
  if (!context.history) {
    throw new ZatomStructureInputError('history_unavailable', 'The current context has no edit history.')
  }
  return context.history
}

const historySummary = (snapshot: HistorySnapshot) =>
  `${snapshot.undoDepth} undoable, ${snapshot.redoDepth} redoable${snapshot.structureFingerprint ? `; fingerprint ${snapshot.structureFingerprint.slice(0, 12)}` : ''}`

const historyManifest: ZatomToolManifest = {
  name: 'workspace_history',
  title: 'Read undo/redo state',
  version: '1.0.0',
  description: 'How many edits can be undone or redone in the active workspace, plus the current structure fingerprint. Read before workspace_undo/redo.',
  inputSchema: objectSchema({}),
  effects: { structure: 'none', workspace: 'read', visual: 'none' },
  tags: ['workspace', 'history', 'agent'],
}

const undoManifest: ZatomToolManifest = {
  name: 'workspace_undo',
  title: 'Undo the last edit',
  version: '1.0.0',
  description: 'Undo the most recent structure edit in the active workspace (yours or the user\'s). Use when the user says "undo that" / "go back", or when structure_check_sanity fails after your own edit. Goes through the same review gate as any structure mutation. steps defaults to 1.',
  inputSchema: objectSchema({ steps: { type: 'integer', minimum: 1, maximum: 50, default: 1 } }),
  effects: { structure: 'replace', workspace: 'write', visual: 'write' },
  tags: ['workspace', 'history', 'agent'],
}

const redoManifest: ZatomToolManifest = {
  name: 'workspace_redo',
  title: 'Redo an undone edit',
  version: '1.0.0',
  description: 'Redo the most recently undone structure edit in the active workspace. steps defaults to 1.',
  inputSchema: objectSchema({ steps: { type: 'integer', minimum: 1, maximum: 50, default: 1 } }),
  effects: { structure: 'replace', workspace: 'write', visual: 'write' },
  tags: ['workspace', 'history', 'agent'],
}

const workspaceHistoryTool: ZatomToolDefinition<HistorySnapshot> = {
  manifest: historyManifest,
  execute: async (_input, context) => {
    try {
      const snapshot = requireHistory(context).read()
      return { ok: true, tool: historyManifest.name, summary: historySummary(snapshot), data: snapshot }
    } catch (error) {
      return toolError<HistorySnapshot>(historyManifest.name, error)
    }
  },
}

type HistoryStepData = HistorySnapshot & { stepsApplied: number }

function historyStepTool(manifest: ZatomToolManifest, direction: 'undo' | 'redo'): ZatomToolDefinition<HistoryStepData> {
  return {
    manifest,
    execute: async (input, context) => {
      try {
        const history = requireHistory(context)
        const steps = Math.max(1, Math.min(50, Math.trunc(numberOption(input, 'steps') ?? 1)))
        let snapshot = history.read()
        let applied = 0
        for (; applied < steps; applied++) {
          if (direction === 'undo' ? !snapshot.canUndo : !snapshot.canRedo) break
          snapshot = await history[direction]()
        }
        if (applied === 0) {
          throw new ZatomStructureInputError(`nothing_to_${direction}`, `Nothing to ${direction}.`)
        }
        return {
          ok: true,
          tool: manifest.name,
          summary: `${direction} ×${applied}${applied < steps ? ` (only ${applied} available)` : ''}; now ${historySummary(snapshot)}`,
          data: { ...snapshot, stepsApplied: applied },
        }
      } catch (error) {
        return toolError<HistoryStepData>(manifest.name, error)
      }
    },
  }
}

export const STRUCTURE_VALIDATE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  structureValidateTool,
  structureCheckSanityTool,
]

export const WORKSPACE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  workspaceGetStructureTool,
  workspaceSetStructureTool,
  workspaceHistoryTool,
  historyStepTool(undoManifest, 'undo'),
  historyStepTool(redoManifest, 'redo'),
]
