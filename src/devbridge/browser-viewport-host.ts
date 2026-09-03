/**
 * Page half of the dev CLI bridge.
 *
 * Executes viewport requests through the page's validated, fingerprint-guarded
 * workspace path. Requests arrive from the Vite dev server over SSE.
 */

import { useCliBridgeActivity } from '../orchestration/cliBridgeActivity'
import { useHostAccess } from '../orchestration/hostAccessStore'
import { handleZatomViewportBridgeRequest } from './page-viewport-host'
import type { ZatomViewportBridgeRequest } from './viewport-contracts'

import {
  parseZatomCliBridgeActivity,
  parseZatomCliBridgeSession,
  ZATOM_CLI_BRIDGE_EVENTS,
  ZATOM_CLI_BRIDGE_PATHS,
} from './contracts'

const INSTANCE_STORAGE_KEY = 'zatom.cli-bridge.instance-id'

let cachedInstanceId: string | null = null

/**
 * Identifies this tab to the bridge. The id lives in `sessionStorage` so a
 * reload re-registers the same instance — an agent that recorded an instanceId
 * keeps addressing the same window — while a new tab gets its own id and a
 * closed tab's id disappears with it.
 */
export function zatomBridgeInstanceId(): string {
  if (cachedInstanceId) return cachedInstanceId
  const generated = `app-${Math.random().toString(36).slice(2, 8)}`
  try {
    const stored = window.sessionStorage.getItem(INSTANCE_STORAGE_KEY)
    if (stored) {
      cachedInstanceId = stored
    } else {
      window.sessionStorage.setItem(INSTANCE_STORAGE_KEY, generated)
      cachedInstanceId = generated
    }
  } catch {
    // Private-mode storage denial: fall back to a per-load id. The instance is
    // still addressable, it just will not survive a reload.
    cachedInstanceId = generated
  }
  return cachedInstanceId
}

function instanceQuery(): string {
  const params = new URLSearchParams({ instanceId: zatomBridgeInstanceId() })
  if (document.title) params.set('label', document.title.slice(0, 64))
  return params.toString()
}

async function submitResult(request: ZatomViewportBridgeRequest, signal: AbortSignal): Promise<void> {
  const result = await handleZatomViewportBridgeRequest(request, signal)
  await fetch(ZATOM_CLI_BRIDGE_PATHS.result, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result),
  })
}

/**
 * Registers this tab as the bridge's viewport host. Returns a teardown, or null
 * when the bridge is not applicable because production builds have no dev server.
 */
export function installZatomDevCliBridgeHost(): (() => void) | null {
  if (!import.meta.env.DEV) return null
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return null

  const activity = useCliBridgeActivity.getState()
  activity.setConnection('connecting')

  void fetch(ZATOM_CLI_BRIDGE_PATHS.session)
    .then((response) => (response.ok ? response.json() : null))
    .then((value: unknown) => {
      if (!value) return
      useCliBridgeActivity.getState().setSession(parseZatomCliBridgeSession(value))
    })
    .catch(() => { /* The panel simply shows no endpoint. */ })

  const source = new EventSource(`${ZATOM_CLI_BRIDGE_PATHS.stream}?${instanceQuery()}`)
  const viewportControllers = new Map<string, AbortController>()

  source.addEventListener('open', () => { useCliBridgeActivity.getState().setConnection('connected') })
  source.addEventListener('error', () => {
    // EventSource reconnects on its own; the label reflects the current attempt.
    useCliBridgeActivity.getState().setConnection(source.readyState === EventSource.CLOSED ? 'error' : 'connecting')
  })
  source.addEventListener(ZATOM_CLI_BRIDGE_EVENTS.viewportRequest, (event) => {
    const request = JSON.parse((event as MessageEvent<string>).data) as ZatomViewportBridgeRequest
    const controller = new AbortController()
    viewportControllers.set(request.requestId, controller)
    void submitResult(request, controller.signal).finally(() => {
      viewportControllers.delete(request.requestId)
    })
  })
  source.addEventListener(ZATOM_CLI_BRIDGE_EVENTS.viewportCancel, (event) => {
    const value = JSON.parse((event as MessageEvent<string>).data) as { requestId?: unknown }
    if (typeof value.requestId !== 'string') return
    viewportControllers.get(value.requestId)?.abort(new Error('Viewport operation was cancelled by its caller'))
  })
  source.addEventListener(ZATOM_CLI_BRIDGE_EVENTS.activity, (event) => {
    try {
      const record = parseZatomCliBridgeActivity(JSON.parse((event as MessageEvent<string>).data))
      // Calls from every host share one timeline, tagged by origin.
      useHostAccess.getState().recordActivity({
        id: record.id,
        host: 'cli-bridge',
        at: record.at,
        tool: record.tool,
        argsSummary: record.argsSummary,
        ok: record.ok,
        ...(record.error === undefined ? {} : { error: record.error }),
        durationMs: record.durationMs,
        viewportOps: record.viewportOps,
        ...(record.deniedByPolicy ? { deniedByPolicy: true } : {}),
        ...(record.atomCount === undefined ? {} : { atomCount: record.atomCount }),
      })
    } catch {
      // A malformed record is dropped rather than corrupting the activity list.
    }
  })

  return () => {
    for (const controller of viewportControllers.values()) {
      controller.abort(new Error('Viewport bridge disconnected'))
    }
    viewportControllers.clear()
    source.close()
    useCliBridgeActivity.getState().setConnection('unsupported')
  }
}
