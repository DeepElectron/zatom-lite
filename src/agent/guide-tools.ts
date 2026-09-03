/**
 * Guide tools — how the agent narrates its work to the human.
 *
 * `guide_set_plan` publishes the step list the user sees at the top of the
 * viewport ("Step 2 of 5 · Place adsorbate") plus a one-line caption;
 * `guide_annotate` pins labels onto atoms or points in 3D;
 * `guide_present_candidates` shows numbered options the user can pick by
 * number; `guide_clear` removes any of them. None of these touch the
 * structure, so they sit in the read tier and never trigger the review gate.
 */

import type {
  GuidanceAnnotationInput,
  GuidanceCandidateInput,
  GuidanceCandidateStatus,
  GuidanceClearScope,
  GuidanceSnapshot,
  ZatomToolContext,
  ZatomToolDefinition,
  ZatomToolManifest,
} from './contracts'
import { objectSchema, toolError } from './tool-helpers'

const vec3Schema = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }

const setPlanManifest: ZatomToolManifest = {
  name: 'guide_set_plan',
  title: 'Show the user your plan',
  version: '1.0.0',
  description:
    'Publish the step list and a one-line caption the user sees at the top of the viewport. Call it once at the start of a multi-step task with every step, then call again with `activeIndex` advanced (same steps) as you complete each one; set `activeIndex` past the last step to mark everything done. Use `caption` to say what you are doing right now or what you need the user to do (e.g. "Approve the ghosted atoms to continue"). Keep steps to 2–8 short imperative phrases.',
  inputSchema: objectSchema({
    steps: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 60 }, description: 'Ordered step labels.' },
    activeIndex: { type: 'integer', minimum: 0, default: 0, description: 'Zero-based index of the step in progress. Earlier steps are shown done.' },
    caption: { type: ['string', 'null'], maxLength: 140, description: 'One line under the step counter. null hides it.' },
  }, ['steps']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['guide', 'plan', 'narration', 'agent'],
}

const annotateManifest: ZatomToolManifest = {
  name: 'guide_annotate',
  title: 'Label points in the 3D view',
  version: '1.0.0',
  description:
    'Pin short text labels onto atoms or 3D points so the user can see what you are referring to ("adsorption site", "vacancy here", "will be removed"). Anchor with `atomIds` (label sits at their centroid) or an explicit `position` in Å. `kind` picks the colour: info (neutral), target (what to look at), warn (problem). By default new labels are merged by `id`; pass `replace: true` to clear the previous set first. Labels stay until guide_clear or a new structure is loaded.',
  inputSchema: objectSchema({
    annotations: {
      type: 'array', minItems: 1, maxItems: 24,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 40, description: 'Stable id to update a label in place. Auto-generated when omitted.' },
          atomIds: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string' } },
          position: vec3Schema,
          label: { type: 'string', minLength: 1, maxLength: 60 },
          kind: { type: 'string', enum: ['info', 'target', 'warn'], default: 'info' },
        },
        required: ['label'],
        oneOf: [{ required: ['atomIds'] }, { required: ['position'] }],
      },
    },
    replace: { type: 'boolean', default: false },
  }, ['annotations']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['guide', 'annotation', 'agent'],
}

const presentCandidatesManifest: ZatomToolManifest = {
  name: 'guide_present_candidates',
  title: 'Show numbered options to the user',
  version: '1.0.0',
  description:
    'When a reference is ambiguous, show numbered badges in the exact target viewport. Each item may anchor on atomIds, an explicit position, or both; use position for vacancy/periodic bridge/hollow sites where no atom or canonical centroid marks the target. Clicking a badge previews it: atom-backed targets become the real selection, point-only targets preserve the selection, and both fly the camera. The user then explicitly Confirms or Cancels. An unresolved or unread resolved set is never silently replaced; call guide_candidate_status and then guide_clear before presenting another. Prefer 2–6 items.',
  inputSchema: objectSchema({
    label: { type: 'string', minLength: 1, maxLength: 80, description: 'What is being chosen, e.g. "Which hollow site for CO?"' },
    items: {
      type: 'array', minItems: 1, maxItems: 9,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          atomIds: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string' } },
          position: vec3Schema,
          anchorPositions: { type: 'array', maxItems: 3, items: vec3Schema },
          label: { type: 'string', minLength: 1, maxLength: 40 },
          detail: { type: 'string', maxLength: 80 },
        },
        required: ['label'],
        anyOf: [{ required: ['atomIds'] }, { required: ['position'] }],
      },
    },
  }, ['label', 'items']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['guide', 'candidates', 'disambiguation', 'agent'],
}

const focusCandidateManifest: ZatomToolManifest = {
  name: 'guide_focus_candidate',
  title: 'Highlight one candidate',
  version: '1.0.0',
  description:
    'Highlight candidate number `index` (1-based) from the current guide_present_candidates set, e.g. after the user says "the second one" or while you walk through options. Pass null to un-highlight. Returns the candidate\'s atomIds so you can pass them straight into the next operation.',
  inputSchema: objectSchema({
    index: { type: ['integer', 'null'], minimum: 1 },
  }, ['index']),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['guide', 'candidates', 'agent'],
}

const candidateStatusManifest: ZatomToolManifest = {
  name: 'guide_candidate_status',
  title: 'Wait for the user\'s candidate choice',
  version: '1.0.0',
  description:
    'Read one exact guide_present_candidates decision. A badge click only previews/focuses; the user then explicitly Confirms or Cancels in the viewport. Set waitMs (up to 30000) to long-poll without repeated calls: it returns immediately on confirmed, cancelled, or stale, and returns pending with timedOut=true when the wait expires. Cancellation through the tool AbortSignal returns immediately.',
  inputSchema: objectSchema({
    candidateSetId: { type: 'string', minLength: 1, description: 'The candidates.id returned by guide_present_candidates.' },
    waitMs: { type: 'integer', minimum: 0, maximum: 30_000, default: 0 },
  }, ['candidateSetId']),
  effects: { structure: 'none', workspace: 'read', visual: 'read' },
  tags: ['guide', 'candidates', 'decision', 'agent'],
}

const clearManifest: ZatomToolManifest = {
  name: 'guide_clear',
  title: 'Clear plan, labels or candidates',
  version: '1.0.0',
  description: 'Remove guidance overlays. scope: all (default) | plan | annotations | candidates | caption. Call with candidates once the user has chosen, and with all when the task is finished or abandoned so stale guidance does not linger.',
  inputSchema: objectSchema({
    scope: { type: 'string', enum: ['all', 'plan', 'annotations', 'candidates', 'caption'], default: 'all' },
  }),
  effects: { structure: 'none', workspace: 'none', visual: 'write' },
  tags: ['guide', 'agent'],
}

function requireGuidance(context: ZatomToolContext) {
  if (!context.guidance) {
    const error = new Error('This host did not provide user guidance surfaces') as Error & { code: string }
    error.code = 'guidance_unavailable'
    throw error
  }
  return context.guidance
}

function describe(snapshot: GuidanceSnapshot): string {
  const plan = snapshot.plan
  const parts: string[] = []
  if (plan) {
    const active = plan.steps.findIndex((s) => s.status === 'active')
    parts.push(active >= 0 ? `step ${active + 1}/${plan.steps.length}: ${plan.steps[active].label}` : `all ${plan.steps.length} steps done`)
    if (plan.caption) parts.push(`caption "${plan.caption}"`)
  } else {
    parts.push('no plan')
  }
  parts.push(`${snapshot.annotations.length} label(s)`)
  if (snapshot.candidates) {
    parts.push(`${snapshot.candidates.items.length} candidate(s) "${snapshot.candidates.label}"${snapshot.candidates.focusedIndex ? `, #${snapshot.candidates.focusedIndex} focused` : ''}`)
  }
  return parts.join('; ')
}

const guideSetPlanTool: ZatomToolDefinition<GuidanceSnapshot> = {
  manifest: setPlanManifest,
  execute: async (input, context) => {
    try {
      const steps = input.steps as string[]
      const activeIndex = typeof input.activeIndex === 'number' ? input.activeIndex : 0
      const caption = typeof input.caption === 'string' ? input.caption : null
      const snapshot = await requireGuidance(context).setPlan(steps, activeIndex, caption)
      return { ok: true, tool: setPlanManifest.name, summary: describe(snapshot), data: snapshot }
    } catch (error) {
      return toolError(setPlanManifest.name, error)
    }
  },
}

const guideAnnotateTool: ZatomToolDefinition<GuidanceSnapshot> = {
  manifest: annotateManifest,
  execute: async (input, context) => {
    try {
      const snapshot = await requireGuidance(context).annotate(
        input.annotations as GuidanceAnnotationInput[],
        input.replace === true,
      )
      return { ok: true, tool: annotateManifest.name, summary: describe(snapshot), data: snapshot }
    } catch (error) {
      return toolError(annotateManifest.name, error)
    }
  },
}

const guidePresentCandidatesTool: ZatomToolDefinition<GuidanceSnapshot> = {
  manifest: presentCandidatesManifest,
  execute: async (input, context) => {
    try {
      const snapshot = await requireGuidance(context).presentCandidates(
        input.label as string,
        input.items as GuidanceCandidateInput[],
      )
      const items = snapshot.candidates?.items ?? []
      const candidateSetId = snapshot.candidates?.id ?? 'unknown'
      return {
        ok: true,
        tool: presentCandidatesManifest.name,
        summary: `Showing ${items.length} candidates in ${candidateSetId}: ${items.map((c) => `#${c.index} ${c.label}`).join(', ')}. Wait with guide_candidate_status until the user Confirms or Cancels.`,
        data: snapshot,
      }
    } catch (error) {
      return toolError(presentCandidatesManifest.name, error)
    }
  },
}

type FocusedCandidate = { index: number; atomIds: string[]; label: string } | null

const guideFocusCandidateTool: ZatomToolDefinition<GuidanceSnapshot & { focused: FocusedCandidate }> = {
  manifest: focusCandidateManifest,
  execute: async (input, context) => {
    try {
      const index = typeof input.index === 'number' ? input.index : null
      const snapshot = await requireGuidance(context).focusCandidate(index)
      const item = snapshot.candidates?.items.find((c) => c.index === index) ?? null
      const focused: FocusedCandidate = item ? { index: item.index, atomIds: item.atomIds, label: item.label } : null
      return {
        ok: true,
        tool: focusCandidateManifest.name,
        summary: focused ? `focused #${focused.index} ${focused.label} → atoms ${focused.atomIds.join(',')}` : 'no candidate focused',
        data: { ...snapshot, focused },
      }
    } catch (error) {
      return toolError(focusCandidateManifest.name, error)
    }
  },
}

const guideCandidateStatusTool: ZatomToolDefinition<GuidanceCandidateStatus> = {
  manifest: candidateStatusManifest,
  execute: async (input, context) => {
    try {
      const candidateSetId = String(input.candidateSetId)
      const waitMs = typeof input.waitMs === 'number' ? input.waitMs : 0
      const status = await requireGuidance(context).candidateStatus(candidateSetId, waitMs, context.signal)
      const summary = status.status === 'confirmed' && status.choice
        ? `User confirmed #${status.choice.index} ${status.choice.label} (${status.choice.atomIds.length ? `atoms ${status.choice.atomIds.join(',')}` : 'point target'}).`
        : status.status === 'pending'
          ? `Candidate set ${candidateSetId} is still pending${status.timedOut ? ' after the requested wait' : ''}.`
          : status.status === 'cancelled'
            ? `User cancelled candidate set ${candidateSetId}. Do not act on any of its candidates.`
            : `Candidate set ${candidateSetId} became stale after the viewport or structure changed. Re-observe before presenting new choices.`
      return { ok: true, tool: candidateStatusManifest.name, summary, data: status }
    } catch (error) {
      return toolError<GuidanceCandidateStatus>(candidateStatusManifest.name, error)
    }
  },
}

const guideClearTool: ZatomToolDefinition<GuidanceSnapshot> = {
  manifest: clearManifest,
  execute: async (input, context) => {
    try {
      const scope = (typeof input.scope === 'string' ? input.scope : 'all') as GuidanceClearScope
      const snapshot = await requireGuidance(context).clear(scope)
      return { ok: true, tool: clearManifest.name, summary: `guidance cleared (${scope})`, data: snapshot }
    } catch (error) {
      return toolError(clearManifest.name, error)
    }
  },
}

export const GUIDE_ZATOM_AGENT_TOOLS: readonly ZatomToolDefinition[] = [
  guideSetPlanTool,
  guideAnnotateTool,
  guidePresentCandidatesTool,
  guideFocusCandidateTool,
  guideCandidateStatusTool,
  guideClearTool,
]
