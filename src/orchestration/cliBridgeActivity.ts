/**
 * The CLI bridge session as seen by the page: connection state and the
 * registration snippets. What the CLI actually did is recorded, together with
 * every other host, in `hostAccessStore`.
 */

import { create } from 'zustand'

export type ZatomCliBridgeConnection = 'unsupported' | 'connecting' | 'connected' | 'error'

interface CliBridgeActivityState {
  connection: ZatomCliBridgeConnection
  endpoint: string | null
  registerCodex: string | null
  registerClaude: string | null
  token: string | null
  setConnection: (connection: ZatomCliBridgeConnection) => void
  setSession: (session: {
    endpoint: string
    token: string
    registerCodex: string
    registerClaude: string
  }) => void
}

export const useCliBridgeActivity = create<CliBridgeActivityState>((set) => ({
  connection: 'unsupported',
  endpoint: null,
  registerCodex: null,
  registerClaude: null,
  token: null,
  setConnection: (connection) => set({ connection }),
  setSession: (session) => set({
    endpoint: session.endpoint,
    token: session.token,
    registerCodex: session.registerCodex,
    registerClaude: session.registerClaude,
  }),
}))
