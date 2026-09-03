/**
 * Wire contract between the dev-server CLI bridge (Node) and the page (browser).
 *
 * Viewport requests and responses use the closed browser bridge contract. The
 * activity record reports each CLI tool call back into the page UI.
 */

export const ZATOM_CLI_BRIDGE_BASE_PATH = '/__zatom-cli' as const
export const ZATOM_CLI_BRIDGE_PATHS = {
  health: `${ZATOM_CLI_BRIDGE_BASE_PATH}/health`,
  mcp: `${ZATOM_CLI_BRIDGE_BASE_PATH}/mcp`,
  stream: `${ZATOM_CLI_BRIDGE_BASE_PATH}/stream`,
  result: `${ZATOM_CLI_BRIDGE_BASE_PATH}/result`,
  session: `${ZATOM_CLI_BRIDGE_BASE_PATH}/session`,
} as const

export const ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA = 'zatom.cli-bridge-activity/v1' as const
export const ZATOM_CLI_BRIDGE_SESSION_SCHEMA = 'zatom.cli-bridge-session/v1' as const

/** SSE event names on `/stream`. */
export const ZATOM_CLI_BRIDGE_EVENTS = {
  viewportRequest: 'viewport-request',
  viewportCancel: 'viewport-cancel',
  activity: 'activity',
  session: 'session',
} as const

export interface ZatomCliBridgeActivity {
  schemaVersion: typeof ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA
  id: string
  at: string
  /** MCP method for non-`tools/call` traffic, otherwise the tool name. */
  tool: string
  argsSummary: string
  ok: boolean
  error?: string
  /** True when the registry refused the call under the host's write mode. */
  deniedByPolicy?: boolean
  durationMs: number
  viewportOps: number
  atomCount?: number
  viewportId?: string
}

export interface ZatomCliBridgeSession {
  schemaVersion: typeof ZATOM_CLI_BRIDGE_SESSION_SCHEMA
  endpoint: string
  /** Present only on the loopback `/session` response consumed by the page. */
  token: string
  registerCodex: string
  registerClaude: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseZatomCliBridgeActivity(value: unknown): ZatomCliBridgeActivity {
  if (!isRecord(value)
    || value.schemaVersion !== ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA
    || typeof value.id !== 'string' || !value.id
    || typeof value.at !== 'string' || !value.at
    || typeof value.tool !== 'string' || !value.tool
    || typeof value.argsSummary !== 'string'
    || typeof value.ok !== 'boolean'
    || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs)
    || typeof value.viewportOps !== 'number' || !Number.isInteger(value.viewportOps)
    || (value.error !== undefined && typeof value.error !== 'string')
    || (value.deniedByPolicy !== undefined && typeof value.deniedByPolicy !== 'boolean')
    || (value.atomCount !== undefined && !Number.isInteger(value.atomCount))
    || (value.viewportId !== undefined && typeof value.viewportId !== 'string')) {
    throw new Error(`CLI bridge activity must use ${ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA}`)
  }
  return value as unknown as ZatomCliBridgeActivity
}

export function parseZatomCliBridgeSession(value: unknown): ZatomCliBridgeSession {
  if (!isRecord(value)
    || value.schemaVersion !== ZATOM_CLI_BRIDGE_SESSION_SCHEMA
    || typeof value.endpoint !== 'string' || !value.endpoint
    || typeof value.token !== 'string' || !value.token
    || typeof value.registerCodex !== 'string' || !value.registerCodex
    || typeof value.registerClaude !== 'string' || !value.registerClaude) {
    throw new Error(`CLI bridge session must use ${ZATOM_CLI_BRIDGE_SESSION_SCHEMA}`)
  }
  return value as unknown as ZatomCliBridgeSession
}

export function zatomCliBridgeRegisterCommands(endpoint: string, token: string): {
  registerCodex: string
  registerClaude: string
} {
  const header = `Authorization: Bearer ${token}`
  return {
    registerCodex: `codex mcp add zatom --transport http --url ${endpoint} --header "${header}"`,
    registerClaude: `claude mcp add --transport http zatom ${endpoint} --header "${header}"`,
  }
}
