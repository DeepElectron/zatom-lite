/** Closed wire contract between the Vite CLI bridge and the browser viewport. */

export const ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA = 'zatom.viewport-bridge-request/v1' as const
export const ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA = 'zatom.viewport-bridge-response/v1' as const

/**
 * Single source of truth for bridge operations. The runtime parser derives its
 * whitelist from this list so adding an operation cannot leave validation stale.
 */
export const ZATOM_VIEWPORT_BRIDGE_OPERATIONS = [
  'read-structure',
  'read-trajectory',
  'read-workspace-identity',
  'commit-structure',
  'commit-workspace',
  'write-trajectory',
  'focus-target',
  'apply-viewer-selection',
  'capture-viewport',
  'read-viewer-scene',
  'camera-look-at',
  'camera-set-view',
  'guidance-read',
  'guidance-set-plan',
  'guidance-advance',
  'guidance-set-caption',
  'guidance-annotate',
  'guidance-present-candidates',
  'guidance-focus-candidate',
  'guidance-candidate-status',
  'guidance-clear',
  'viewer-style-read',
  'viewer-style-apply',
  'proposal-propose',
  'proposal-read-candidate',
  'proposal-revise',
  'proposal-status',
  'proposal-withdraw',
  'viewport-describe',
  'viewport-activate',
  'viewport-set-layout',
  'viewport-clear',
  'viewport-mount',
  'assets-list-batches',
  'assets-create-batch',
  'assets-rename-batch',
  'assets-move-frames',
  'read-host-write-mode',
] as const

export type ZatomViewportBridgeOperation = typeof ZATOM_VIEWPORT_BRIDGE_OPERATIONS[number]

export interface ZatomViewportBridgeRequest {
  schemaVersion: typeof ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA
  requestId: string
  operation: ZatomViewportBridgeOperation
  payload?: unknown
}

export interface ZatomViewportBridgeResponse {
  schemaVersion: typeof ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA
  requestId: string
  ok: boolean
  value?: unknown
  error?: string
  /** Stable lowercase domain code preserved across the bridge boundary. */
  errorCode?: string
}

export interface ZatomViewportCaptureRequest {
  options?: { maxDim?: number; format?: 'jpeg' | 'png' }
  expectedViewportId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  return actual.length === expected.length && actual.every((field, index) => field === expected[index])
}

function parseRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error('Viewport bridge requestId must use 1-128 ASCII token characters')
  }
  return value
}

export function parseZatomViewportBridgeRequest(value: unknown): ZatomViewportBridgeRequest {
  if (!isRecord(value)
    || !hasExactFields(value, value.payload === undefined
      ? ['schemaVersion', 'requestId', 'operation']
      : ['schemaVersion', 'requestId', 'operation', 'payload'])
    || value.schemaVersion !== ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA
    || typeof value.operation !== 'string'
    || !(ZATOM_VIEWPORT_BRIDGE_OPERATIONS as readonly string[]).includes(value.operation)) {
    throw new Error(`Viewport bridge request must use ${ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA}`)
  }
  return {
    schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
    requestId: parseRequestId(value.requestId),
    operation: value.operation as ZatomViewportBridgeOperation,
    ...(value.payload === undefined ? {} : { payload: value.payload }),
  }
}

export function parseZatomViewportBridgeResponse(
  value: unknown,
  expectedRequestId: string,
): ZatomViewportBridgeResponse {
  if (!isRecord(value)
    || value.schemaVersion !== ZATOM_VIEWPORT_BRIDGE_RESPONSE_SCHEMA
    || value.requestId !== expectedRequestId
    || typeof value.ok !== 'boolean'
    || (value.error !== undefined && typeof value.error !== 'string')
    || (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(value.errorCode)))
    || (value.ok && (value.error !== undefined || value.errorCode !== undefined))
    || (!value.ok && typeof value.error !== 'string')
    || Object.keys(value).some((field) => !['schemaVersion', 'requestId', 'ok', 'value', 'error', 'errorCode'].includes(field))) {
    throw new Error('Viewport bridge response does not match its request')
  }
  return value as unknown as ZatomViewportBridgeResponse
}
