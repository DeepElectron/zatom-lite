/**
 * Loopback HTTP plumbing for the development MCP bridge. It provides
 * constant-time bearer comparison, a Node -> Web `Request` adaptation for
 * `@modelcontextprotocol/server`, a streaming Web `Response` -> Node writeback
 * with backpressure, and loopback Host/Origin gating.
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

export const LOOPBACK_HOST = '127.0.0.1' as const
export const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]']
export const MAX_LOOPBACK_REQUEST_BYTES = 128 * 1024 * 1024

export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(token, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function webHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((entry) => result.append(name, entry))
    else if (value !== undefined) result.set(name, value)
  }
  return result
}

export async function requestBody(
  request: IncomingMessage,
  maxBytes = MAX_LOOPBACK_REQUEST_BYTES,
): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)
    size += chunk.byteLength
    if (size > maxBytes) throw new Error(`MCP request exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * `origin` must be a fully-qualified origin, e.g. `http://127.0.0.1:5173`.
 * Callers that already consumed the body (to inspect it) pass it back in here
 * instead of re-reading a drained stream.
 */
export function webRequestFromBody(
  request: IncomingMessage,
  origin: string,
  signal: AbortSignal,
  body: Buffer | undefined,
): Request {
  const path = request.url?.startsWith('/') ? request.url : '/'
  return new Request(`${origin}${path}`, {
    method: request.method,
    headers: webHeaders(request.headers),
    ...(body === undefined ? {} : { body }),
    signal,
    ...(body === undefined ? {} : { duplex: 'half' }),
  } as RequestInit)
}

export async function toWebRequest(
  request: IncomingMessage,
  origin: string,
  signal: AbortSignal,
  maxBytes = MAX_LOOPBACK_REQUEST_BYTES,
): Promise<Request> {
  return webRequestFromBody(request, origin, signal, await requestBody(request, maxBytes))
}

export async function sendWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status
  response.headers.forEach((value, name) => target.setHeader(name, value))
  if (!response.body) {
    target.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!target.write(Buffer.from(chunk.value))) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            target.off('drain', onDrain)
            target.off('close', onClose)
            target.off('error', onError)
          }
          const onDrain = () => { cleanup(); resolve() }
          const onClose = () => { cleanup(); reject(new Error('MCP client disconnected during response backpressure')) }
          const onError = (error: Error) => { cleanup(); reject(error) }
          target.once('drain', onDrain)
          target.once('close', onClose)
          target.once('error', onError)
        })
      }
    }
    target.end()
  } finally {
    if (target.destroyed) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.')
}

export function hostAllowed(host: string | undefined, ports: readonly number[]): boolean {
  if (!host) return false
  return ports.some((port) => host === `${LOOPBACK_HOST}:${port}` || host === `localhost:${port}`)
}

/** Absent Origin is allowed (CLI clients send none); a present one must be loopback. */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.includes(parsed.hostname)
  } catch {
    return false
  }
}
