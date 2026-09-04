/**
 * agentActivityStore tracks what the agent is doing **now** (in flight),
 * complementing cliBridgeActivity.
 *
 * cliBridgeActivity records what just finished (ok / durationMs / error), making
 * it a retrospective log. During a long animation or slow tool, users instead
 * need to know whether the UI is waiting for the model, computing, or playing a
 * skippable sequence. Otherwise any multi-second operation looks frozen.
 *
 * This is separate from choreographyNarrationStore because captions describe
 * **choreography** (for example, "Building… 12/300") and exist only during replay,
 * while the activity stack covers every tool call, including nonanimated observe
 * and compute calls. Their distinct lifetimes must not be conflated.
 *
 * A stack is required because a mutate tool can trigger a replay internally
 * (commit → reveal), leaving both activities in flight. The UI displays the most
 * specific top entry, while skippability considers the entire stack: an inner
 * sequence may still be skippable even when its outer tool is not interruptible.
 */

import { create } from 'zustand'

/** Mirrors ToolRiskTier in domains.ts to keep orchestration independent of the agent layer. */
export type AgentActivityTier = 'observe' | 'compute' | 'mutate'

export interface RunningAgentActivity {
  id: string
  /** Human-readable status text, not a tool name; prefer a plain action over "structure_read". */
  label: string
  tier: AgentActivityTier
  startedAt: number
  /**
   * True only for replay animations.
   *
   * This means "skippable," not "pausable": abortChoreography() immediately settles
   * at the target state without rollback or partial output. Tool calls themselves
   * are not interruptible because aborting a structure write could leave inconsistent state.
  */
  interruptible: boolean
  /** Cancels a safe tool call. Structure commits intentionally omit this. */
  cancel?: () => void
  host?: 'webmcp' | 'cli-bridge'
  tool?: string
  viewportId?: string
  workspaceRevision?: number
}

interface AgentActivityState {
  running: RunningAgentActivity[]
  /** Returns a finish function. Call it in try/finally so errors cannot leak a lit indicator. */
  begin: (activity: Omit<RunningAgentActivity, 'id' | 'startedAt'>) => () => void
}

let seq = 0

export const useAgentActivity = create<AgentActivityState>((set) => ({
  running: [],
  begin: (activity) => {
    const id = `activity-${++seq}`
    const entry: RunningAgentActivity = { ...activity, id, startedAt: Date.now() }
    set((state) => ({ running: [...state.running, entry] }))
    let ended = false
    return () => {
      // Idempotent: overlapping explicit and finally calls must not remove a same-named entry.
      if (ended) return
      ended = true
      set((state) => ({ running: state.running.filter((a) => a.id !== id) }))
    }
  },
}))

/** The top activity is the most specific layer and supplies the displayed label. */
export function selectCurrentActivity(state: AgentActivityState): RunningAgentActivity | null {
  return state.running.length ? state.running[state.running.length - 1] : null
}

/**
 * Whether the stack contains a skippable animation.
 *
 * Scan the entire stack because a noninterruptible mutate tool can contain a
 * skippable replay. Once that replay ends while the tool continues, the skip
 * button must disappear. some() handles either nesting order.
 */
export function selectHasSkippableAnimation(state: AgentActivityState): boolean {
  return state.running.some((a) => a.interruptible && !a.cancel)
}
