/** Structure selection DSL inspection and the composable operation pipeline. */

import type {
  InspectionTarget,
  ValidationCheck,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { ZATOM_STRUCTURE_JSON_SCHEMA } from './contracts'
import { finalizeStructureCandidate, type CandidateEnvelope } from './candidate-tool'
import {
  applyStructureOperations,
  evaluateStructureSelection,
  parseStructureSelection,
  parseStructureOperations,
  STRUCTURE_OPERATIONS_VERSION,
  StructureOperationInputError,
} from './operations'
import { fingerprintStructure } from './structure-math'
import { numberOption, objectSchema, resolveStructure, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }
const selectionClauseProperties = {
  all: { type: 'boolean' },
  atomIds: { type: 'array', minItems: 1, items: { type: 'string' } },
  parentAtomIds: { type: 'array', minItems: 1, items: { type: 'string' } },
  elements: { type: 'array', minItems: 1, items: { type: 'string' } },
  cartesianBox: objectSchema({ min: vec3Schema, max: vec3Schema }, ['min', 'max']),
  fractionalBox: objectSchema({ min: vec3Schema, max: vec3Schema }, ['min', 'max']),
  cartesianHalfSpace: objectSchema({
    origin: vec3Schema,
    normal: vec3Schema,
    side: { enum: ['positive', 'negative'] },
  }, ['origin', 'normal', 'side']),
  sphere: objectSchema({ center: vec3Schema, radius: { type: 'number', minimum: 0 }, periodic: { type: 'boolean' } }, ['center', 'radius']),
  cylinder: objectSchema({
    axisPoint: vec3Schema,
    axis: vec3Schema,
    radius: { type: 'number', minimum: 0 },
  }, ['axisPoint', 'axis', 'radius']),
  invert: { type: 'boolean' },
}
const selectionClauseSchema = objectSchema(selectionClauseProperties)
const selectionSchema = objectSchema({
  ...selectionClauseProperties,
  combine: {
    type: 'array',
    minItems: 1,
    maxItems: 32,
    items: objectSchema({
      operator: { enum: ['union', 'subtract', 'intersect', 'xor'] },
      selection: selectionClauseSchema,
    }, ['operator', 'selection']),
  },
})
/**
 * Reference to the shared selection schema, for use inside `operationSchema`.
 *
 * The selection DSL is ~3.6 KB of JSON Schema and appears in 7 operation
 * variants. Inlining it at every use site put ~22 KB of pure duplication into
 * each tool listing the model reads. The definition this points at is published
 * once under `$defs` on the root of the structure_apply_operations input schema,
 * which is what a `#/$defs/...` fragment resolves against.
 *
 * Valid only inside that one tool's schema. structure_select_atoms has its own
 * schema root, so it still inlines `selectionSchema` directly.
 */
const selectionRef = { $ref: '#/$defs/selection' } as const

const matrixSchema = { type: 'array', minItems: 3, maxItems: 3, items: vec3Schema }
/** A direction named without coordinates: vector, slab surface normal, or the line from one atom to another. */
const directionSchema = {
  anyOf: [
    vec3Schema,
    { const: 'surface-normal', description: 'Outward slab normal, resolved from the vacuum gap; fails if there is none.' },
    objectSchema({ fromAtomId: { type: 'string', minLength: 1 }, toAtomId: { type: 'string', minLength: 1 } }, ['fromAtomId', 'toAtomId']),
  ],
}
const operationSchema = {
  oneOf: [
    objectSchema({ op: { const: 'supercell' }, scaling: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 1, maximum: 64 } } }, ['op', 'scaling']),
    objectSchema({
      op: { const: 'substitute' },
      selection: selectionRef,
      element: { type: 'string' },
      count: { type: 'integer', minimum: 1 },
      fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      seed: { type: 'integer', minimum: 0 },
    }, ['op', 'selection', 'element']),
    objectSchema({
      op: { const: 'vacancy' },
      selection: selectionRef,
      count: { type: 'integer', minimum: 1 },
      fraction: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      seed: { type: 'integer', minimum: 0 },
    }, ['op', 'selection']),
    objectSchema({
      op: { const: 'interstitial' },
      atoms: {
        type: 'array',
        minItems: 1,
        items: objectSchema({ id: { type: 'string' }, element: { type: 'string' }, position: vec3Schema, properties: { type: 'object' } }, ['element', 'position']),
      },
    }, ['op', 'atoms']),
    objectSchema({
      op: { const: 'bond_add' },
      bonds: {
        type: 'array',
        minItems: 1,
        items: objectSchema({
          id: { type: 'string' },
          atomIds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
          order: { enum: [1, 1.5, 2, 3] },
          properties: { type: 'object' },
        }, ['atomIds', 'order']),
      },
    }, ['op', 'bonds']),
    objectSchema({
      op: { const: 'bond_remove' },
      bondIds: { type: 'array', minItems: 1, items: { type: 'string' } },
    }, ['op', 'bondIds']),
    objectSchema({
      op: { const: 'bond_set_order' },
      bondIds: { type: 'array', minItems: 1, items: { type: 'string' } },
      order: { enum: [1, 1.5, 2, 3] },
    }, ['op', 'bondIds', 'order']),
    objectSchema({ op: { const: 'translate' }, selection: selectionRef, vector: vec3Schema }, ['op', 'selection', 'vector']),
    objectSchema({
      op: { const: 'translate_along' },
      selection: selectionRef,
      direction: directionSchema,
      distanceA: { type: 'number', minimum: -1000, maximum: 1000, description: 'Signed distance in Å along direction.' },
    }, ['op', 'selection', 'direction', 'distanceA']),
    objectSchema({
      op: { const: 'rotate_about_axis_through' },
      selection: selectionRef,
      axis: directionSchema,
      angleDeg: { type: 'number', minimum: -36000, maximum: 36000 },
      pivot: {
        anyOf: [vec3Schema, objectSchema({ atomId: { type: 'string', minLength: 1 } }, ['atomId'])],
        description: 'Defaults to the selection centroid, or to fromAtomId when axis is a bond.',
      },
    }, ['op', 'selection', 'axis', 'angleDeg']),
    objectSchema({
      op: { const: 'set_positions' },
      positions: {
        type: 'array',
        minItems: 1,
        maxItems: 100000,
        items: objectSchema({
          atomId: { type: 'string', minLength: 1 },
          position: vec3Schema,
        }, ['atomId', 'position']),
      },
    }, ['op', 'positions']),
    objectSchema({
      op: { const: 'set_lattice' },
      vectors: matrixSchema,
      periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
      coordinateMode: { enum: ['preserve-cartesian', 'preserve-fractional'] },
    }, ['op', 'vectors', 'periodic', 'coordinateMode']),
    objectSchema({
      op: { const: 'rotate' },
      selection: selectionRef,
      axis: vec3Schema,
      angleDeg: { type: 'number', minimum: -36000, maximum: 36000 },
      origin: vec3Schema,
      rotateLattice: { type: 'boolean' },
    }, ['op', 'axis', 'angleDeg']),
    objectSchema({
      op: { const: 'align' },
      selection: selectionRef,
      fromVector: vec3Schema,
      toVector: vec3Schema,
      origin: vec3Schema,
      antiparallelAxis: vec3Schema,
      rotateLattice: { type: 'boolean' },
    }, ['op', 'fromVector', 'toVector']),
    objectSchema({
      op: { const: 'affine' },
      selection: selectionRef,
      matrix: matrixSchema,
      origin: vec3Schema,
      deformLattice: { type: 'boolean' },
    }, ['op', 'matrix']),
    objectSchema({
      op: { const: 'set_periodicity' },
      periodic: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'boolean' } },
    }, ['op', 'periodic']),
    objectSchema({ op: { const: 'wrap' }, selection: selectionRef }, ['op']),
  ],
}

interface StructureSelectionToolData {
  structureFingerprint: string
  selection: ReturnType<typeof parseStructureSelection>
  selectedAtomCount: number
  atomIds: string[]
  elementCounts: Record<string, number>
  bounds: ReturnType<typeof evaluateStructureSelection>['bounds']
  inspectionTargets: InspectionTarget[]
}

const selectionManifest: ZatomToolManifest = {
  name: 'structure_select_atoms',
  title: 'Resolve and inspect an atom selection',
  version: '2.0.0',
  description: 'Resolve a selection (atom ids, element, box, half-space, sphere, cylinder, with union/subtract/intersect/xor) against the active structure and return the matching atom ids, composition and bounds without changing anything. Set applyToViewportSelection=true to highlight them in the viewport and fly the camera there so the user sees exactly which atoms you mean. Use it to dry-run a selection before proposing an edit.',
  inputSchema: objectSchema({
    structure: ZATOM_STRUCTURE_JSON_SCHEMA,
    selection: selectionSchema,
    maxSelectedAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
    applyToViewportSelection: {
      type: 'boolean',
      default: false,
      description: 'When true and the selection was resolved against the ACTIVE workspace, make it the viewport\'s real selection (same state as manual clicking) and fly the camera to it, so the user sees the highlighted atoms and can take over immediately. Ignored for explicit structures whose atom IDs need not match the viewport.',
    },
  }, ['selection']),
  // Visual write: opting in updates the live viewport selection and moves the camera.
  effects: { structure: 'read', workspace: 'read', visual: 'write' },
  tags: ['structure', 'selection', 'inspection', 'constraint', 'agent'],
}

const structureSelectAtomsTool: ZatomToolDefinition<StructureSelectionToolData> = {
  manifest: selectionManifest,
  execute: async (input, context) => {
    try {
      const structure = await resolveStructure(input, context)
      const selection = parseStructureSelection(input.selection)
      const evaluated = evaluateStructureSelection(structure, selection)
      const maxSelectedAtoms = Math.trunc(numberOption(input, 'maxSelectedAtoms') ?? 20_000)
      if (evaluated.atomIds.length > maxSelectedAtoms) {
        throw new StructureOperationInputError(
          'selection_too_large',
          `Selection matched ${evaluated.atomIds.length.toLocaleString()} atoms above maxSelectedAtoms=${maxSelectedAtoms.toLocaleString()}`,
        )
      }
      const structureFingerprint = fingerprintStructure(structure)
      const inspectionTargets: InspectionTarget[] = evaluated.bounds ? [{
        id: 'structure-selection-region',
        reason: `Inspect ${evaluated.atomIds.length.toLocaleString()} atoms resolved by the selection DSL`,
        center: evaluated.bounds.center,
        radius: Math.max(1, evaluated.bounds.radius),
        atomIds: evaluated.atomIds.slice(0, 80),
        ...(evaluated.atomIds.length > 80 ? { atomIdsTruncated: true } : {}),
      }] : []
      // Apply highlights only when the selection came from the active workspace.
      // Atom IDs in an explicit structure may not match the viewport. Fail closed
      // for the visual side effect while still returning the selection result and
      // an explanatory check so the agent can retry against the workspace.
      const wantViewportSelection = input.applyToViewportSelection === true
      let viewportSelectionCheck: ValidationCheck | null = null
      if (wantViewportSelection) {
        const fromWorkspace = input.structure == null
        if (!fromWorkspace) {
          viewportSelectionCheck = {
            id: 'selection.viewport_apply',
            status: 'fail',
            message: 'applyToViewportSelection ignored: selection was resolved against an explicit structure, not the active workspace. Re-run without `structure` to select in the viewport.',
          }
        } else if (!context.applyViewerSelection) {
          viewportSelectionCheck = {
            id: 'selection.viewport_apply',
            status: 'fail',
            message: 'applyToViewportSelection ignored: this host has no interactive viewport.',
          }
        } else {
          await context.applyViewerSelection(evaluated.atomIds)
          viewportSelectionCheck = {
            id: 'selection.viewport_apply',
            status: 'pass',
            message: `Applied ${evaluated.atomIds.length.toLocaleString()} atoms as the live viewport selection and flew the camera to it — the user sees them highlighted and can take over directly.`,
          }
        }
      }
      const checks: ValidationCheck[] = [{
        id: 'selection.nonempty',
        status: evaluated.atomIds.length ? 'pass' : 'fail',
        message: evaluated.atomIds.length
          ? `Selection resolved ${evaluated.atomIds.length.toLocaleString()} atoms in canonical structure order`
          : 'Selection resolved no atoms',
        metrics: { selectedAtomCount: evaluated.atomIds.length },
        atomIds: evaluated.atomIds.slice(0, 80),
      }, ...(viewportSelectionCheck ? [viewportSelectionCheck] : []), {
        id: 'selection.result_budget',
        status: 'pass',
        message: `Returned all ${evaluated.atomIds.length.toLocaleString()} selected atom IDs within maxSelectedAtoms=${maxSelectedAtoms.toLocaleString()}`,
        metrics: { selectedAtomCount: evaluated.atomIds.length, maxSelectedAtoms },
      }]
      return {
        ok: true,
        tool: selectionManifest.name,
        summary: evaluated.atomIds.length
          ? `Selected ${evaluated.atomIds.length.toLocaleString()} atoms (${Object.entries(evaluated.elementCounts).map(([element, count]) => `${element}${count}`).join(' ')}) from ${structureFingerprint}`
          : `Selection matched no atoms in ${structureFingerprint}`,
        data: {
          structureFingerprint,
          selection,
          selectedAtomCount: evaluated.atomIds.length,
          atomIds: evaluated.atomIds,
          elementCounts: evaluated.elementCounts,
          bounds: evaluated.bounds,
          inspectionTargets,
        },
        checks,
      }
    } catch (error) {
      return toolError<StructureSelectionToolData>(selectionManifest.name, error)
    }
  },
}

const operationsManifest: ZatomToolManifest = {
  name: 'structure_apply_operations',
  title: 'Apply a composable structure operation pipeline',
  version: STRUCTURE_OPERATIONS_VERSION,
  description: 'Run an ordered structure-edit pipeline (supercell, substitute, vacancy, interstitial, set positions, set lattice, add/remove bonds, translate, translate_along (direction = vector | "surface-normal" | {fromAtomId,toAtomId}), rotate, rotate_about_axis_through (axis = same direction forms, pivot = point or atom), align, strain, periodic-boundary, wrap) on the active structure or a supplied one. Selections: atom ids, element, box, half-space, sphere, cylinder, plus union/subtract/intersect/xor. Default is a dry run that returns the candidate and a change set; set applyToWorkspace=true to write it (opens the review card). Prefer structure_propose_operations when a human is watching — it previews the same pipeline as ghosts first. Unknown atom ids fail closed.',
  inputSchema: {
    // Publishes the single selection definition that the operation variants
    // reference via `#/$defs/selection`. It must live on the root of this input
    // schema, because that root is what `$ref` fragments resolve against.
    $defs: { selection: selectionSchema },
    ...objectSchema({
      structure: ZATOM_STRUCTURE_JSON_SCHEMA,
      operations: { type: 'array', minItems: 1, maxItems: 64, items: operationSchema },
      seed: { type: 'integer', minimum: 0, default: 42 },
      maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
      applyToWorkspace: { type: 'boolean', default: false, description: 'Apply only when explicitly true' },
      captureAfter: { type: 'boolean', description: 'Default true only when applying to the active workspace in a visual host' },
      expectedFingerprint: { type: 'string', description: 'Fingerprint of the active structure you inspected (from workspace_get_active_structure / workspace_history). Mismatch = the structure changed under you (user edit, revert, undo); the call fails closed so you re-read instead of editing a stale view. Only checked when operating on the active structure.' },
    }, ['operations']),
  },
  effects: { structure: 'replace', workspace: 'write', visual: 'read' },
  tags: ['structure', 'dsl', 'mutation', 'rotation', 'alignment', 'defect', 'strain', 'validation', 'agent'],
}

type OperationsToolData = CandidateEnvelope<ReturnType<typeof applyStructureOperations>>

const structureApplyOperationsTool: ZatomToolDefinition<OperationsToolData> = {
  manifest: operationsManifest,
  execute: async (input, context) => {
    try {
      const source = await resolveStructure(input, context)
      const requestedApply = input.applyToWorkspace === true
      if (typeof input.expectedFingerprint === 'string' && input.structure === undefined) {
        const baseFingerprint = fingerprintStructure(source)
        if (input.expectedFingerprint !== baseFingerprint) {
          throw new StructureOperationInputError(
            'stale_fingerprint',
            `Active structure fingerprint is ${baseFingerprint}, not ${input.expectedFingerprint}. Re-read with workspace_get_active_structure.`,
          )
        }
      }
      const result = applyStructureOperations({
        structure: source,
        operations: parseStructureOperations(input.operations),
        seed: numberOption(input, 'seed'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
      })
      const captureAfter = typeof input.captureAfter === 'boolean' ? input.captureAfter : requestedApply
      return await finalizeStructureCandidate({
        tool: operationsManifest.name,
        result,
        requestedApply,
        captureAfter,
        context,
        summary: (applied, blocked, verified) => `Applied ${result.operations.length} structure operations to produce ${result.structure.atoms.length.toLocaleString()} atoms${applied ? verified === true ? ' and fingerprint-verified the active workspace' : verified === false ? '; workspace readback does not match the candidate' : ' and updated the active workspace without readback' : blocked ? '; workspace application was blocked' : ''}`,
      })
    } catch (error) {
      return toolError<OperationsToolData>(operationsManifest.name, error)
    }
  },
}

// ---------------------------------------------------------------------------
// Propose: same pipeline, but the result is ghosted for the user to approve.
// ---------------------------------------------------------------------------

const proposeManifest: ZatomToolManifest = {
  name: 'structure_propose_operations',
  title: 'Propose a structure edit for user approval',
  version: STRUCTURE_OPERATIONS_VERSION,
  description:
    'Run the same edit pipeline as structure_apply_operations on the active structure, but instead of writing it, show the result in the viewport as translucent ghosts (added/moved atoms) with an Apply / Discard card, and fly the camera to the changed region. Nothing changes until the user presses Apply. Returns a proposalId — use structure_proposal_status to wait for the decision. Pass expectedFingerprint (from workspace_get_active_structure) so a stale view fails instead of proposing against the wrong structure. A pending decision is never replaced: finish it or call structure_cancel_proposal before proposing again.',
  inputSchema: {
    $defs: { selection: selectionSchema },
    ...objectSchema({
      intent: { type: 'string', minLength: 3, maxLength: 160, description: 'One sentence the user will read on the card, e.g. "Replace the top-layer O with S".' },
      operations: { type: 'array', minItems: 1, maxItems: 64, items: operationSchema },
      expectedFingerprint: { type: 'string', description: 'Fingerprint of the structure you inspected. Mismatch = the structure changed under you; re-read and try again.' },
      seed: { type: 'integer', minimum: 0, default: 42 },
      maxOutputAtoms: { type: 'integer', minimum: 1, maximum: 100000, default: 20000 },
      flyTo: { type: 'boolean', default: true, description: 'Fly the camera to the changed region after ghosting.' },
    }, ['intent', 'operations']),
  },
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['structure', 'dsl', 'proposal', 'preview', 'guide', 'agent'],
}

interface ProposeToolData {
  proposalId: string
  status: string
  baseFingerprint: string
  candidateFingerprint: string
  previewRevision: number
  diff: ReturnType<typeof applyStructureOperations>['changeSet']
  summary: string
  viewportId: string
  workspaceRevision: number
}

const structureProposeOperationsTool: ZatomToolDefinition<ProposeToolData> = {
  manifest: proposeManifest,
  execute: async (input, context) => {
    try {
      if (!context.proposal) {
        throw new StructureOperationInputError('no_viewer', 'The current context cannot preview proposals; use structure_apply_operations.')
      }
      const source = await resolveStructure({}, context)
      const baseFingerprint = fingerprintStructure(source)
      const workspaceIdentity = await context.workspaceIdentity?.()
      if (!workspaceIdentity || workspaceIdentity.structureFingerprint !== baseFingerprint) {
        throw new StructureOperationInputError(
          'workspace_identity_unavailable',
          'The proposal host could not bind this candidate to an exact viewport revision. Re-observe the workspace and try again.',
        )
      }
      const expectedWorkspace = context.expectedWorkspace
      if (expectedWorkspace && (
        workspaceIdentity.viewportId !== expectedWorkspace.viewportId
        || workspaceIdentity.revision !== expectedWorkspace.revision
        || workspaceIdentity.structureFingerprint !== expectedWorkspace.structureFingerprint
        || workspaceIdentity.trajectoryFingerprint !== expectedWorkspace.trajectoryFingerprint
      )) {
        throw new StructureOperationInputError(
          'workspace_conflict',
          `The workspace changed from ${expectedWorkspace.viewportId}@r${expectedWorkspace.revision} while the proposal was being prepared. Re-observe and retry.`,
        )
      }
      if (typeof input.expectedFingerprint === 'string' && input.expectedFingerprint !== baseFingerprint) {
        throw new StructureOperationInputError(
          'stale_fingerprint',
          `Active structure fingerprint is ${baseFingerprint}, not ${input.expectedFingerprint}. Re-read with workspace_get_active_structure.`,
        )
      }
      const result = applyStructureOperations({
        structure: source,
        operations: parseStructureOperations(input.operations),
        seed: numberOption(input, 'seed'),
        maxOutputAtoms: numberOption(input, 'maxOutputAtoms'),
      })
      const proposal = await context.proposal.propose({
        intent: String(input.intent),
        baseFingerprint,
        viewportId: workspaceIdentity.viewportId,
        workspaceRevision: workspaceIdentity.revision,
        candidate: result.structure,
        changeSet: result.changeSet,
        checks: result.checks,
        inspectionTargets: result.inspectionTargets,
        signal: context.signal,
      })
      if (context.signal?.aborted) {
        // The host may have completed publication at the same moment the
        // caller cancelled. Withdraw without the cancelled signal so an
        // orphan Apply/Discard card cannot outlive the failed tool call.
        await Promise.resolve(context.proposal.withdraw(proposal.id)).catch(() => null)
        throw new StructureOperationInputError(
          'tool_execution_aborted',
          context.signal.reason instanceof Error ? context.signal.reason.message : 'Proposal creation was cancelled.',
        )
      }
      if (input.flyTo !== false && context.camera && proposal.diff.bounds) {
        void context.camera.lookAt({
          target: { point: proposal.diff.bounds.center, radius: Math.max(proposal.diff.bounds.radius, 2) },
        }, context.signal).catch(() => undefined)
      }
      return {
        ok: true,
        tool: proposeManifest.name,
        summary: `Proposed "${proposal.intent}" (${proposal.diff.summary}); waiting for Apply or Discard. Call structure_proposal_status with proposalId=${proposal.id} and waitMs up to 30000.`,
        data: {
          proposalId: proposal.id,
          status: proposal.status,
          baseFingerprint,
          candidateFingerprint: proposal.candidateFingerprint,
          previewRevision: proposal.previewRevision,
          diff: result.changeSet,
          summary: proposal.diff.summary,
          viewportId: proposal.viewportId,
          workspaceRevision: proposal.workspaceRevision,
        },
      }
    } catch (error) {
      return toolError<ProposeToolData>(proposeManifest.name, error)
    }
  },
}

const proposalStatusManifest: ZatomToolManifest = {
  name: 'structure_proposal_status',
  title: 'Check a proposal decision',
  version: STRUCTURE_OPERATIONS_VERSION,
  description:
    'Read a proposal decision and the exact previewRevision/candidateFingerprint guards required to refine its current ghost. Set waitMs (up to 30 seconds) to return as soon as the user applies or discards it instead of polling repeatedly. Status is pending, applying, applied, discarded, or superseded.',
  inputSchema: objectSchema({
    proposalId: { type: 'string' },
    waitMs: { type: 'integer', minimum: 0, maximum: 30000, default: 0 },
  }, ['proposalId']),
  effects: { structure: 'none', workspace: 'none', visual: 'none' },
  tags: ['structure', 'proposal', 'guide', 'agent'],
}

interface ProposalStatusData {
  proposalId: string
  status: string
  intent: string
  diffSummary: string
  viewportId: string
  workspaceRevision: number
  previewRevision: number
  candidateFingerprint: string
}

const TERMINAL_PROPOSAL_STATUSES = new Set(['applied', 'discarded', 'superseded'])

function throwIfProposalDecisionCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw new StructureOperationInputError('tool_execution_aborted', 'The proposal request was cancelled.')
}

async function waitForProposalDecision(
  proposal: NonNullable<ZatomToolContext['proposal']>,
  proposalId: string,
  waitMs: number,
  signal: AbortSignal | undefined,
) {
  const deadline = Date.now() + waitMs
  let snapshot = await proposal.status(proposalId, signal)
  throwIfProposalDecisionCancelled(signal)
  while (snapshot && !TERMINAL_PROPOSAL_STATUSES.has(snapshot.status) && Date.now() < deadline) {
    if (signal?.aborted) {
      throw new StructureOperationInputError('tool_execution_aborted', 'Waiting for the proposal decision was cancelled.')
    }
    const remaining = deadline - Date.now()
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(new StructureOperationInputError('tool_execution_aborted', 'Waiting for the proposal decision was cancelled.'))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort)
        resolve()
      }, Math.min(200, Math.max(1, remaining)))
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    })
    snapshot = await proposal.status(proposalId, signal)
    throwIfProposalDecisionCancelled(signal)
  }
  return snapshot
}

const structureProposalStatusTool: ZatomToolDefinition<ProposalStatusData> = {
  manifest: proposalStatusManifest,
  execute: async (input, context) => {
    try {
      if (!context.proposal) {
        throw new StructureOperationInputError('no_viewer', 'This host has no proposal surface.')
      }
      const proposalId = String(input.proposalId)
      const waitMs = Math.max(0, Math.min(30_000, Math.trunc(numberOption(input, 'waitMs') ?? 0)))
      const snapshot = await waitForProposalDecision(context.proposal, proposalId, waitMs, context.signal)
      if (!snapshot) {
        throw new StructureOperationInputError('unknown_proposal', `No proposal ${String(input.proposalId)}.`)
      }
      const hint = snapshot.status === 'pending'
        ? 'still waiting on the user'
        : snapshot.status === 'applying'
          ? 'the user accepted and the atomic workspace commit is in progress'
        : snapshot.status === 'applied'
          ? 'applied — re-read the structure for the new fingerprint'
          : snapshot.status === 'discarded'
            ? 'discarded by the user; ask what they would prefer before proposing again'
            : 'superseded by a newer proposal'
      return {
        ok: true,
        tool: proposalStatusManifest.name,
        summary: `Proposal ${snapshot.id} is ${snapshot.status}: ${hint}`,
        data: {
          proposalId: snapshot.id,
          status: snapshot.status,
          intent: snapshot.intent,
          diffSummary: snapshot.diff.summary,
          viewportId: snapshot.viewportId,
          workspaceRevision: snapshot.workspaceRevision,
          previewRevision: snapshot.previewRevision,
          candidateFingerprint: snapshot.candidateFingerprint,
        },
      }
    } catch (error) {
      return toolError<ProposalStatusData>(proposalStatusManifest.name, error)
    }
  },
}

const cancelProposalManifest: ZatomToolManifest = {
  name: 'structure_cancel_proposal',
  title: 'Cancel a pending structure preview',
  version: STRUCTURE_OPERATIONS_VERSION,
  description:
    'Immediately discard one pending ghost proposal without changing the structure. Safe and idempotent after a previous discard. If the atomic Apply commit has started, cancellation fails closed; wait for it to finish, then review or undo.',
  inputSchema: objectSchema({
    proposalId: { type: 'string', minLength: 1 },
  }, ['proposalId']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['structure', 'proposal', 'cancel', 'guide', 'agent'],
}

const structureCancelProposalTool: ZatomToolDefinition<ProposalStatusData> = {
  manifest: cancelProposalManifest,
  execute: async (input, context) => {
    try {
      if (!context.proposal) {
        throw new StructureOperationInputError('no_viewer', 'This host has no proposal surface.')
      }
      const proposalId = String(input.proposalId)
      const current = await context.proposal.status(proposalId, context.signal)
      throwIfProposalDecisionCancelled(context.signal)
      if (!current) {
        throw new StructureOperationInputError('unknown_proposal', `No proposal ${proposalId}.`)
      }
      if (current.status === 'applying') {
        throw new StructureOperationInputError(
          'proposal_commit_in_progress',
          `Proposal ${proposalId} is already being applied. Let the atomic commit finish, then use the review card or workspace_undo.`,
        )
      }
      if (current.status === 'applied') {
        throw new StructureOperationInputError(
          'proposal_already_applied',
          `Proposal ${proposalId} is already applied. Use the review card or workspace_undo instead of cancelling its old preview.`,
        )
      }
      const snapshot = current.status === 'pending'
        ? await context.proposal.withdraw(proposalId, context.signal)
        : current
      throwIfProposalDecisionCancelled(context.signal)
      if (!snapshot) {
        throw new StructureOperationInputError(
          'proposal_decision_race',
          `Proposal ${proposalId} changed while cancellation was being processed. Read its status again.`,
        )
      }
      return {
        ok: true,
        tool: cancelProposalManifest.name,
        summary: snapshot.status === 'discarded'
          ? `Proposal ${proposalId} is discarded; the active structure was not changed.`
          : `Proposal ${proposalId} was already ${snapshot.status}; nothing changed.`,
        data: {
          proposalId: snapshot.id,
          status: snapshot.status,
          intent: snapshot.intent,
          diffSummary: snapshot.diff.summary,
          viewportId: snapshot.viewportId,
          workspaceRevision: snapshot.workspaceRevision,
          previewRevision: snapshot.previewRevision,
          candidateFingerprint: snapshot.candidateFingerprint,
        },
      }
    } catch (error) {
      return toolError<ProposalStatusData>(cancelProposalManifest.name, error)
    }
  },
}

export const STRUCTURE_SELECTION_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [structureSelectAtomsTool]

export const STRUCTURE_OPERATIONS_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  structureProposeOperationsTool,
  structureProposalStatusTool,
  structureCancelProposalTool,
  structureApplyOperationsTool,
]
