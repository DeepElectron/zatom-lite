/**
 * Dev-server half of the CLI bridge: a loopback MCP endpoint whose tool calls
 * operate on the *live browser viewport* instead of a connection-local copy.
 *
 * This bridge binds a local Codex or Claude Code client directly to the browser
 * page through the same fingerprint-checked viewport operations used by
 * in-page tools.
 *
 * Node <-> page transport is SSE downstream (`/stream`) plus a POST writeback
 * (`/result`), because the page is the client here and cannot be dialled.
 */

import { createMcpHandler } from '@modelcontextprotocol/server'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  bearerMatches,
  isLoopbackAddress,
  jsonResponse,
  originAllowed,
  requestBody,
  sendWebResponse,
  webRequestFromBody,
} from '../agent/loopback-http'
import type { ZatomAppInstanceView } from '../agent/contracts'
import { ZatomMcpArtifactStore } from '../agent/mcp-artifact-store'
import { createZatomMcpServer } from '../agent/mcp-server'
import {
  createViewportBridgeToolContext,
  type ZatomViewportBridgeInvoker,
} from './viewport-tool-context'
import {
  parseZatomViewportBridgeResponse,
  ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
  type ZatomViewportBridgeOperation,
  type ZatomViewportBridgeRequest,
} from './viewport-contracts'
import {
  ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA,
  ZATOM_CLI_BRIDGE_EVENTS,
  ZATOM_CLI_BRIDGE_PATHS,
  ZATOM_CLI_BRIDGE_SESSION_SCHEMA,
  zatomCliBridgeRegisterCommands,
  type ZatomCliBridgeActivity,
  type ZatomCliBridgeSession,
} from './contracts'

const DEFAULT_VIEWPORT_TIMEOUT_MS = 30_000
const MAX_BRIDGE_REQUEST_BYTES = 128 * 1024 * 1024
const SSE_KEEPALIVE_MS = 15_000

/** Per-MCP-call telemetry, gathered without threading a parameter through every tool. */
interface CallScope {
  viewportOps: number
  atomCount?: number
  viewportId?: string
}

export interface ZatomDevMcpBridge {
  middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void
  session(port: number): ZatomCliBridgeSession
  /** True while a page holds the viewport-host SSE slot. */
  pageBound(): boolean
  close(): Promise<void>
}

function summarizeArgs(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'object' || Array.isArray(value)) return String(value).slice(0, 120)
  const parts: string[] = []
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (parts.length === 4) { parts.push('…'); break }
    if (entry === null || entry === undefined) continue
    if (typeof entry === 'string') parts.push(`${key}=${entry.length > 24 ? `${entry.slice(0, 24)}…` : entry}`)
    else if (typeof entry === 'number' || typeof entry === 'boolean') parts.push(`${key}=${entry}`)
    else if (Array.isArray(entry)) parts.push(`${key}[${entry.length}]`)
    else parts.push(`${key}{}`)
  }
  return parts.join(' ')
}

/**
 * Returns a failure message when the JSON-RPC reply carries one, else undefined.
 * Accepts a bare JSON body or an SSE frame stream, since the MCP transport picks
 * between them based on the client's `accept` header.
 */
interface CallOutcome {
  error: string
  /** The tool's own error code when the failure came from the registry, e.g. host_policy_denied. */
  code?: string
}

function readOutcome(body: string): CallOutcome | undefined {
  const payloads = body.trimStart().startsWith('{')
    ? [body]
    : body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim())
  for (const payload of payloads) {
    let message: {
      error?: { message?: unknown }
      result?: { isError?: unknown; content?: unknown; structuredContent?: { error?: { code?: unknown } } }
    } | null
    try {
      message = JSON.parse(payload || 'null')
    } catch {
      continue
    }
    if (message?.error) return { error: String(message.error.message ?? 'MCP error') }
    if (message?.result?.isError === true) {
      const first = Array.isArray(message.result.content)
        ? (message.result.content[0] as { text?: unknown } | undefined)
        : undefined
      const code = message.result.structuredContent?.error?.code
      return {
        error: typeof first?.text === 'string' ? first.text : 'Tool reported an error',
        ...(typeof code === 'string' ? { code } : {}),
      }
    }
  }
  return undefined
}

/** Browsers set these on same-origin fetch/EventSource; a bare CLI does not. */
function fromSameOriginPage(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'same-origin') return true
  const referer = request.headers.referer
  if (!referer) return false
  try {
    const parsed = new URL(referer)
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
  } catch {
    return false
  }
}

export function createZatomDevMcpBridge(options: {
  onerror?: (error: Error) => void
  /**
   * Tool domains exposed at connect time. Omit for the default set; agents widen
   * it at runtime with `zatom_enable_domains`, so this only sets the starting
   * surface and keeps the initial tool list small.
   */
  domains?: readonly string[]
} = {}): ZatomDevMcpBridge {
  const token = randomBytes(32).toString('base64url')
  const artifacts = new ZatomMcpArtifactStore()
  const callScope = new AsyncLocalStorage<CallScope>()
  const pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout | null
    /** Instance the request was dispatched to, so a disconnect only fails its own calls. */
    instanceId: string
  }>()
  const activityListeners = new Set<ServerResponse>()
  /**
   * Connected app instances, keyed by the id the page reports. Several tabs may
   * share one dev server, and each is an independent viewport, so a write has to
   * name its target rather than land on whichever page connected last.
   */
  type PageInstance = {
    stream: ServerResponse
    label: string | null
    connectedAt: number
    /** Origin the page was served from, used to tell an agent where to open another window. */
    origin: string | null
  }
  const instances = new Map<string, PageInstance>()
  let keepalive: NodeJS.Timeout | null = null
  let closed = false

  /** Live instances, oldest first so the default pick is stable across reconnects. */
  const liveInstances = (): ({ id: string } & PageInstance)[] => {
    const live: ({ id: string } & PageInstance)[] = []
    for (const [id, entry] of instances) {
      if (entry.stream.writableEnded) instances.delete(id)
      else live.push({ id, ...entry })
    }
    return live.sort((a, b) => a.connectedAt - b.connectedAt)
  }

  const writeEvent = (target: ServerResponse, event: string, data: unknown): void => {
    if (target.writableEnded) return
    target.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  /** Fails pending calls, scoped to one instance unless `instanceId` is omitted. */
  const rejectPending = (reason: string, instanceId?: string): void => {
    for (const [requestId, entry] of pending) {
      if (instanceId !== undefined && entry.instanceId !== instanceId) continue
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new Error(reason))
      pending.delete(requestId)
    }
  }

  const releaseInstance = (target: ServerResponse, reason: string): void => {
    for (const [id, entry] of instances) {
      if (entry.stream !== target) continue
      instances.delete(id)
      rejectPending(reason, id)
    }
    if (instances.size === 0 && keepalive) { clearInterval(keepalive); keepalive = null }
  }

  /**
   * Picks the instance a call targets. With one instance connected the choice is
   * unambiguous; with several, a write must name its target rather than silently
   * landing on an arbitrary tab, so this fails closed and lists the options.
   */
  const resolveTarget = (requested: string | undefined): { id: string; stream: ServerResponse } => {
    const live = liveInstances()
    if (live.length === 0) throw new Error('No zatom page is connected to the CLI bridge')
    if (requested !== undefined) {
      const match = live.find((entry) => entry.id === requested)
      if (!match) {
        throw new Error(
          `Unknown app instance "${requested}". Connected: ${live.map((entry) => entry.id).join(', ')}`,
        )
      }
      return match
    }
    if (live.length > 1) {
      throw new Error(
        `${live.length} zatom instances are connected; pass instanceId to choose one. ` +
        `Connected: ${live.map((entry) => `${entry.id}${entry.label ? ` (${entry.label})` : ''}`).join(', ')}. ` +
        'Call app_instances for details.',
      )
    }
    return live[0]
  }

  const invokeViewport: ZatomViewportBridgeInvoker = (
    operation: ZatomViewportBridgeOperation,
    payload?: unknown,
    timeoutMs?: number | null,
    signal?: AbortSignal,
  ) => new Promise<unknown>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`Viewport operation ${operation} was cancelled`))
      return
    }
    const requestedInstance = (payload as { instanceId?: unknown } | undefined)?.instanceId
    let target: { id: string; stream: ServerResponse }
    try {
      target = resolveTarget(typeof requestedInstance === 'string' ? requestedInstance : undefined)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const host = target.stream
    const scope = callScope.getStore()
    if (scope) scope.viewportOps++
    const requestId = randomUUID()
    const limit = timeoutMs === null ? null : (timeoutMs ?? DEFAULT_VIEWPORT_TIMEOUT_MS)
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const onAbort = () => {
      const entry = pending.get(requestId)
      if (!entry) return
      pending.delete(requestId)
      if (entry.timer) clearTimeout(entry.timer)
      cleanup()
      writeEvent(host, ZATOM_CLI_BRIDGE_EVENTS.viewportCancel, { requestId })
      reject(signal?.reason instanceof Error ? signal.reason : new Error(`Viewport operation ${operation} was cancelled`))
    }
    const timer = limit === null ? null : setTimeout(() => {
      pending.delete(requestId)
      cleanup()
      reject(new Error(`Viewport operation ${operation} timed out after ${limit}ms`))
    }, limit)
    pending.set(requestId, {
      resolve: (value) => {
        cleanup()
        if (scope && (operation === 'commit-structure' || operation === 'commit-workspace')) {
          const structure = (payload as { structure?: { atoms?: unknown[] } } | undefined)?.structure
          if (Array.isArray(structure?.atoms)) scope.atomCount = structure.atoms.length
          const returned = value as { viewportId?: unknown } | null
          if (returned && typeof returned.viewportId === 'string') scope.viewportId = returned.viewportId
        }
        // A page handler does not know which bridge instance it is, so it either
        // omits the id or reports a placeholder. The bridge resolved the real
        // target, so stamp every viewport view it returns — otherwise a caller
        // cannot tell which window answered, and feeding that id back fails as
        // unknown. Views are recognised by their layout + slots shape.
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const view = value as Record<string, unknown>
          if (typeof view.layout === 'string' && Array.isArray(view.slots)) {
            resolve({ ...view, instanceId: target.id })
            return
          }
        }
        resolve(value)
      },
      reject: (error) => { cleanup(); reject(error) },
      timer,
      instanceId: target.id,
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    const request: ZatomViewportBridgeRequest = {
      schemaVersion: ZATOM_VIEWPORT_BRIDGE_REQUEST_SCHEMA,
      requestId,
      operation,
      ...(payload === undefined ? {} : { payload }),
    }
    writeEvent(host, ZATOM_CLI_BRIDGE_EVENTS.viewportRequest, request)
  })

  /**
   * Layout and slot occupancy live in each page, so this asks every instance in
   * parallel. A tab that fails or times out is still reported, with unknown
   * counts, so one wedged window cannot hide the rest of the list.
   */
  const listInstanceViews = async (): Promise<ZatomAppInstanceView[]> => {
    const live = liveInstances()
    const sole = live.length === 1
    return Promise.all(live.map(async (entry): Promise<ZatomAppInstanceView> => {
      const base = {
        instanceId: entry.id,
        label: entry.label,
        // With one instance connected it is unambiguously the call's target;
        // with several the bridge requires an explicit instanceId, so none is.
        current: sole,
        // Where to open another window; the agent visits this and the new tab
        // registers itself as its own instance.
        openUrl: entry.origin,
      }
      try {
        const described = await invokeViewport('viewport-describe', { instanceId: entry.id }, 5_000)
        const view = described as { layout?: unknown; slots?: { structureLabel?: unknown }[] } | null
        const slots = Array.isArray(view?.slots) ? view.slots : []
        return {
          ...base,
          layout: typeof view?.layout === 'string' ? view.layout : 'unknown',
          occupiedSlots: slots.filter((slot) => slot?.structureLabel != null).length,
          totalSlots: slots.length,
        }
      } catch {
        return { ...base, layout: 'unknown', occupiedSlots: 0, totalSlots: 0 }
      }
    }))
  }

  let workspaceQueue = Promise.resolve()
  const enqueueWorkspaceCall = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = workspaceQueue.then(operation, operation)
    workspaceQueue = result.then(() => undefined, () => undefined)
    return result
  }

  // One protocol instance per request; the enabled-domain set must outlive them
  // or zatom_enable_domains is forgotten by the very next call.
  const enabledDomains = new Set<string>()
  const handler = createMcpHandler(
    () => createZatomMcpServer(createViewportBridgeToolContext(invokeViewport, listInstanceViews), {
      artifacts,
      enqueueWorkspaceCall,
      enabledDomains,
      ...(options.domains ? { domains: options.domains } : {}),
    }),
    { onerror: options.onerror },
  )

  const broadcastActivity = (activity: ZatomCliBridgeActivity): void => {
    for (const listener of activityListeners) writeEvent(listener, ZATOM_CLI_BRIDGE_EVENTS.activity, activity)
  }

  const openStream = (
    request: IncomingMessage,
    response: ServerResponse,
    instance: { id: string; label: string | null; origin: string | null } | null,
  ): void => {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.write(': zatom cli bridge\n\n')
    activityListeners.add(response)
    if (instance) {
      const previous = instances.get(instance.id)
      instances.set(instance.id, {
        stream: response,
        label: instance.label,
        connectedAt: Date.now(),
        origin: instance.origin,
      })
      if (previous && previous.stream !== response) {
        // A reload re-registers the same id; newest stream wins and the orphaned
        // requests fail closed rather than resolving against a dead tab.
        rejectPending('The zatom page reconnected to the CLI bridge', instance.id)
        previous.stream.end()
      }
      keepalive ??= setInterval(() => {
        for (const entry of [...instances.values()]) {
          if (entry.stream.writableEnded) continue
          // A tab killed without a clean shutdown leaves a half-open socket, so
          // neither `close` fires nor `writableEnded` flips, and the instance
          // would stay registered forever — making every later call ambiguous.
          // The keepalive write is the only thing that notices, so a failed
          // write releases the instance.
          entry.stream.write(': keepalive\n\n', (error) => {
            if (error) releaseInstance(entry.stream, 'The zatom page stopped responding to the CLI bridge')
          })
        }
      }, SSE_KEEPALIVE_MS)
    }
    const cleanup = () => {
      activityListeners.delete(response)
      releaseInstance(response, 'The zatom page disconnected from the CLI bridge')
    }
    request.on('close', cleanup)
    response.on('close', cleanup)
  }

  const handleResult = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const body = await requestBody(request, MAX_BRIDGE_REQUEST_BYTES)
    const raw: unknown = JSON.parse((body ?? Buffer.alloc(0)).toString('utf8') || 'null')
    const requestId = (raw as { requestId?: unknown } | null)?.requestId
    if (typeof requestId !== 'string' || !pending.has(requestId)) {
      jsonResponse(response, 409, { error: 'unknown_request' })
      return
    }
    const entry = pending.get(requestId)!
    pending.delete(requestId)
    if (entry.timer) clearTimeout(entry.timer)
    try {
      const parsed = parseZatomViewportBridgeResponse(raw, requestId)
      if (parsed.ok) entry.resolve(parsed.value)
      else {
        const failure = new Error(parsed.error ?? 'Viewport operation failed') as Error & { code?: string }
        if (parsed.errorCode) failure.code = parsed.errorCode
        entry.reject(failure)
      }
    } catch (error) {
      entry.reject(error instanceof Error ? error : new Error(String(error)))
    }
    jsonResponse(response, 202, { accepted: true })
  }

  const handleMcp = async (request: IncomingMessage, response: ServerResponse, port: number): Promise<void> => {
    if (!bearerMatches(request.headers.authorization, token)) {
      response.setHeader('www-authenticate', 'Bearer realm="zatom-cli-bridge"')
      jsonResponse(response, 401, { error: 'unauthorized' })
      return
    }
    if (liveInstances().length === 0) {
      jsonResponse(response, 503, { error: 'viewport_unavailable' })
      return
    }
    const body = await requestBody(request, MAX_BRIDGE_REQUEST_BYTES)
    let method = request.method ?? 'POST'
    let tool = method
    let argsSummary = ''
    try {
      const rpc = JSON.parse((body ?? Buffer.alloc(0)).toString('utf8') || 'null') as {
        method?: unknown
        params?: { name?: unknown; arguments?: unknown }
      } | null
      if (rpc && typeof rpc.method === 'string') {
        method = rpc.method
        tool = rpc.method === 'tools/call' && typeof rpc.params?.name === 'string' ? rpc.params.name : rpc.method
        if (rpc.method === 'tools/call') argsSummary = summarizeArgs(rpc.params?.arguments)
      }
    } catch {
      // Malformed JSON is the MCP handler's error to report; activity still records the attempt.
    }

    const abort = new AbortController()
    response.on('close', () => { if (!response.writableEnded) abort.abort() })
    const scope: CallScope = { viewportOps: 0 }
    const startedAt = Date.now()
    let ok = true
    let error: string | undefined
    let deniedByPolicy = false
    try {
      const handled = await callScope.run(scope, async () => {
        const webRequest = webRequestFromBody(request, `http://127.0.0.1:${port}`, abort.signal, body)
        return handler.fetch(webRequest)
      })
      if (handled.status >= 400) { ok = false; error = `HTTP ${handled.status}` }
      // The transport answers either a JSON body or an SSE frame stream depending
      // on the client. Tee it so the CLI still gets the bytes verbatim while the
      // activity row reports the real tool outcome rather than just HTTP 200.
      let captured: Promise<string> | null = null
      let forwarded = handled.body
      if (handled.body) {
        const [toClient, toActivity] = handled.body.tee()
        forwarded = toClient
        captured = new Response(toActivity).text()
      }
      const headers = new Headers(handled.headers)
      headers.set('cache-control', 'no-store')
      await sendWebResponse(new Response(forwarded, { status: handled.status, headers }), response)
      const verdict = readOutcome(captured ? await captured : '')
      if (verdict) {
        ok = false
        error = verdict.error
        deniedByPolicy = verdict.code === 'host_policy_denied'
      }
    } catch (failure) {
      ok = false
      error = failure instanceof Error ? failure.message : String(failure)
      throw failure
    } finally {
      if (method !== 'initialize' && method !== 'notifications/initialized') {
        broadcastActivity({
          schemaVersion: ZATOM_CLI_BRIDGE_ACTIVITY_SCHEMA,
          id: randomUUID(),
          at: new Date().toISOString(),
          tool,
          argsSummary,
          ok,
          ...(error === undefined ? {} : { error }),
          ...(deniedByPolicy ? { deniedByPolicy: true } : {}),
          durationMs: Date.now() - startedAt,
          viewportOps: scope.viewportOps,
          ...(scope.atomCount === undefined ? {} : { atomCount: scope.atomCount }),
          ...(scope.viewportId === undefined ? {} : { viewportId: scope.viewportId }),
        })
      }
    }
  }

  const session = (port: number): ZatomCliBridgeSession => {
    const endpoint = `http://127.0.0.1:${port}${ZATOM_CLI_BRIDGE_PATHS.mcp}`
    return {
      schemaVersion: ZATOM_CLI_BRIDGE_SESSION_SCHEMA,
      endpoint,
      token,
      ...zatomCliBridgeRegisterCommands(endpoint, token),
    }
  }

  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void): void => {
    const path = (request.url ?? '').split('?')[0]
    if (!path.startsWith('/__zatom-cli')) {
      next()
      return
    }
    void (async () => {
      if (closed) {
        jsonResponse(response, 503, { error: 'bridge_closed' })
        return
      }
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        jsonResponse(response, 403, { error: 'non_loopback' })
        return
      }
      // A same-origin browser request is trusted on the strength of `sec-fetch-site`
      // rather than the literal Origin value: a dev server reached through a proxy
      // (v0 preview, SSH tunnel, container port map) legitimately reports the
      // external host there, and rejecting it would lock the page out of its own
      // bridge. Non-browser callers still have to be loopback and present the token.
      if (!fromSameOriginPage(request) && !originAllowed(request.headers.origin)) {
        jsonResponse(response, 403, { error: 'invalid_origin' })
        return
      }
      const port = (request.socket.localPort ?? 0)

      if (path === ZATOM_CLI_BRIDGE_PATHS.health && request.method === 'GET') {
        jsonResponse(response, 200, {
          status: liveInstances().length > 0 ? 'ready' : 'viewport-unavailable',
          transport: 'streamable-http',
          pendingViewportRequests: pending.size,
          instances: liveInstances().map((entry) => ({
            instanceId: entry.id,
            label: entry.label,
            openUrl: entry.origin,
          })),
        })
        return
      }
      if (path === ZATOM_CLI_BRIDGE_PATHS.mcp) {
        await handleMcp(request, response, port)
        return
      }
      // Everything below is the page's half of the bridge and never carries the
      // CLI token, so it is gated on same-origin browser traffic instead.
      if (!fromSameOriginPage(request)) {
        jsonResponse(response, 403, { error: 'page_only' })
        return
      }
      if (path === ZATOM_CLI_BRIDGE_PATHS.session && request.method === 'GET') {
        jsonResponse(response, 200, session(port))
        return
      }
      if (path === ZATOM_CLI_BRIDGE_PATHS.stream && request.method === 'GET') {
        // The page names itself so a reload re-registers the same instance
        // instead of accumulating dead entries.
        const query = new URLSearchParams((request.url ?? '').split('?')[1] ?? '')
        const id = query.get('instanceId')?.trim()
        const label = query.get('label')?.trim()
        // The page's own request tells us where it is served from, which is the
        // URL an agent needs in order to open another instance.
        const forwarded = request.headers.origin
        const host = request.headers.host
        openStream(request, response, {
          id: id && id.length > 0 ? id.slice(0, 64) : randomUUID(),
          label: label && label.length > 0 ? label.slice(0, 64) : null,
          origin: forwarded ?? (host ? `http://${host}` : null),
        })
        return
      }
      if (path === ZATOM_CLI_BRIDGE_PATHS.result && request.method === 'POST') {
        await handleResult(request, response)
        return
      }
      jsonResponse(response, 404, { error: 'not_found' })
    })().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error))
      options.onerror?.(failure)
      if (!response.headersSent) {
        jsonResponse(response, failure.message.includes('exceeds') ? 413 : 500, { error: failure.message })
      } else {
        response.destroy(failure)
      }
    })
  }

  return {
    middleware,
    session,
    pageBound: () => liveInstances().length > 0,
    close: async () => {
      closed = true
      rejectPending('The CLI bridge is shutting down')
      if (keepalive) { clearInterval(keepalive); keepalive = null }
      for (const listener of activityListeners) listener.end()
      activityListeners.clear()
      instances.clear()
      await handler.close()
    },
  }
}
