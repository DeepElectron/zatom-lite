/**
 * The user's per-host write mode, and the cross-host record of what every
 * agent host actually did.
 *
 * One store for both because they are read together: the panel shows the mode
 * next to the host's live calls, and a denied call is only intelligible beside
 * the mode that denied it. The page owns the choice; the development CLI
 * bridge reads it through a viewport request.
 */

import { create } from 'zustand'

import {
  ZATOM_DEFAULT_HOST_WRITE_MODE,
  type ZatomAgentHost,
  type ZatomHostWriteMode,
} from '../agent/host-access-policy'

const MAX_ACTIVITIES = 200

export interface ZatomHostActivity {
  id: string
  host: ZatomAgentHost
  at: string
  /** MCP method for non-`tools/call` traffic, otherwise the tool name. */
  tool: string
  argsSummary: string
  ok: boolean
  error?: string
  durationMs: number
  /** True when the registry refused the call under the host's write mode. */
  deniedByPolicy?: boolean
  atomCount?: number
  /** Viewport round trips the call made; only out-of-process hosts have any. */
  viewportOps?: number
}

interface HostAccessState {
  modes: Record<ZatomAgentHost, ZatomHostWriteMode>
  activities: ZatomHostActivity[]
  webMcpRegistration: {
    state: 'unavailable' | 'registering' | 'registered' | 'error'
    registeredTools: number
    updatedAt: string
    error: string | null
  }
  setMode: (host: ZatomAgentHost, mode: ZatomHostWriteMode) => void
  recordActivity: (activity: ZatomHostActivity) => void
  setWebMcpRegistration: (registration: HostAccessState['webMcpRegistration']) => void
}

export const useHostAccess = create<HostAccessState>((set) => ({
  modes: { ...ZATOM_DEFAULT_HOST_WRITE_MODE },
  activities: [],
  webMcpRegistration: {
    state: 'unavailable',
    registeredTools: 0,
    updatedAt: new Date(0).toISOString(),
    error: null,
  },
  setMode: (host, mode) => set((state) => ({ modes: { ...state.modes, [host]: mode } })),
  recordActivity: (activity) => set((state) => ({
    activities: [activity, ...state.activities].slice(0, MAX_ACTIVITIES),
  })),
  setWebMcpRegistration: (webMcpRegistration) => set({ webMcpRegistration }),
}))

export function readHostWriteMode(host: ZatomAgentHost): ZatomHostWriteMode {
  return useHostAccess.getState().modes[host]
}

/** Summarize tool arguments for the activity list without leaking whole structures. */
export function summarizeToolArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}=${value.length > 24 ? `${value.slice(0, 24)}…` : value}`
      if (typeof value === 'number' || typeof value === 'boolean') return `${key}=${String(value)}`
      if (Array.isArray(value)) return `${key}=[${value.length}]`
      if (value === null) return `${key}=null`
      return `${key}={…}`
    })
    .join(' ')
}
