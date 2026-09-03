/**
 * agentGuidanceStore exposes the agent's current work, next step, and visual focus.
 *
 * All three data groups are **presentation state**, not structure data, and do not
 * participate in undo history:
 *
 *   plan        Step list, current step, and caption for the top status strip.
 *   annotations 3D info, target, or warning points rendered as viewport HTML labels.
 *   candidates  Numbered choices rendered as badges; users can refer to one by
 *               number and the agent highlights it with guide_focus_candidate.
 *
 * This remains separate from choreographyNarration: that caption follows a
 * **replay animation** and clears when it ends, while this plan persists for the
 * task until the agent explicitly advances or clears it.
 *
 * Manual control does not clear the plan because it still communicates agent
 * intent. Only guide_clear or a new task's guide_set_plan replaces it.
 */

import { create } from 'zustand'

import type { GuidanceCandidateDecision, Vec3 } from '../agent/contracts'

export type GuidanceStepStatus = 'pending' | 'active' | 'done'

export interface GuidanceStep {
  label: string
  status: GuidanceStepStatus
}

export interface GuidancePlan {
  steps: GuidanceStep[]
  /** One-line caption explaining the current step or requesting user action. */
  caption: string | null
}

export type GuidanceAnnotationKind = 'info' | 'target' | 'warn'

export interface GuidanceAnnotation {
  id: string
  position: Vec3
  label: string
  kind: GuidanceAnnotationKind
  viewportKey: object
  viewportId: string
  workspaceRevision: number
}

export interface GuidanceCandidate {
  index: number
  atomIds: string[]
  position: Vec3
  anchorPositions: Vec3[]
  label: string
  detail: string | null
  viewportKey: object
}

export interface GuidanceCandidates {
  id: string
  label: string
  items: GuidanceCandidate[]
  focusedIndex: number | null
  decision: GuidanceCandidateDecision
  viewportKey: object
  viewportId: string
  workspaceRevision: number
  /** Selection that existed before the first candidate focus; renderer-only rollback state. */
  selectionBefore: string[]
}

export type GuidanceClearScope = 'all' | 'plan' | 'annotations' | 'candidates' | 'caption'

interface AgentGuidanceState {
  plan: GuidancePlan | null
  annotations: GuidanceAnnotation[]
  candidates: GuidanceCandidates | null

  setPlan: (steps: string[], activeIndex: number, caption: string | null) => void
  /** Advances to a step and marks earlier ones done; an out-of-range index completes all steps. */
  advance: (activeIndex: number, caption?: string | null) => void
  setCaption: (caption: string | null) => void
  setAnnotations: (annotations: GuidanceAnnotation[], replace: boolean) => void
  /** A live or resolved choice is cleared explicitly; it is never silently overwritten. */
  setCandidates: (candidates: GuidanceCandidates | null) => void
  focusCandidate: (index: number | null) => void
  resolveCandidate: (decision: Exclude<GuidanceCandidateDecision, { status: 'pending' }>) => void
  /** Workspace changes invalidate pending and already-confirmed spatial answers alike. */
  invalidateCandidate: () => void
  clear: (scope?: GuidanceClearScope) => void
}

function buildSteps(labels: string[], activeIndex: number): GuidanceStep[] {
  return labels.map((label, index) => ({
    label,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }))
}

export const useAgentGuidance = create<AgentGuidanceState>((set, get) => ({
  plan: null,
  annotations: [],
  candidates: null,

  setPlan: (steps, activeIndex, caption) =>
    set({ plan: { steps: buildSteps(steps, activeIndex), caption } }),

  advance: (activeIndex, caption) => {
    const plan = get().plan
    if (!plan) return
    set({
      plan: {
        steps: buildSteps(plan.steps.map((s) => s.label), activeIndex),
        caption: caption === undefined ? plan.caption : caption,
      },
    })
  },

  setCaption: (caption) => {
    const plan = get().plan
    if (!plan) return
    set({ plan: { ...plan, caption } })
  },

  setAnnotations: (annotations, replace) =>
    set((state) => {
      if (replace) return { annotations }
      const byId = new Map(state.annotations.map((a) => [a.id, a]))
      for (const a of annotations) byId.set(a.id, a)
      return { annotations: [...byId.values()] }
    }),

  setCandidates: (candidates) => {
    const current = get().candidates
    if (candidates && current) {
      throw new Error(
        `Candidate set ${current.id} is ${current.decision.status}. Clear it before presenting another choice.`,
      )
    }
    set({ candidates })
  },

  focusCandidate: (index) => {
    const candidates = get().candidates
    if (!candidates || candidates.decision.status !== 'pending') return
    const valid = index !== null && candidates.items.some((c) => c.index === index)
    set({ candidates: { ...candidates, focusedIndex: valid ? index : null } })
  },

  resolveCandidate: (decision) => {
    const candidates = get().candidates
    if (!candidates || candidates.decision.status !== 'pending') return
    set({
      candidates: {
        ...candidates,
        focusedIndex: decision.status === 'confirmed' ? decision.index : null,
        decision,
      },
    })
  },

  invalidateCandidate: () => {
    const candidates = get().candidates
    if (!candidates || candidates.decision.status === 'stale') return
    set({
      candidates: {
        ...candidates,
        focusedIndex: null,
        decision: { status: 'stale', index: null, at: Date.now() },
      },
    })
  },

  clear: (scope = 'all') => {
    switch (scope) {
      case 'plan':
        return set({ plan: null })
      case 'annotations':
        return set({ annotations: [] })
      case 'candidates':
        return set({ candidates: null })
      case 'caption': {
        const plan = get().plan
        return plan ? set({ plan: { ...plan, caption: null } }) : undefined
      }
      default:
        return set({ plan: null, annotations: [], candidates: null })
    }
  },
}))

export const selectGuidancePlan = (s: AgentGuidanceState) => s.plan
export const selectGuidanceAnnotations = (s: AgentGuidanceState) => s.annotations
export const selectGuidanceCandidates = (s: AgentGuidanceState) => s.candidates
