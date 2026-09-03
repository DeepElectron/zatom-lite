/**
 * Browser transport for Boltz. Direct cross-origin requests are blocked by the
 * upstream CORS policy and this application's CSP, so development and deployed
 * builds both use the fixed same-origin proxy routes. API keys stay in request
 * headers and are never written to URLs or local storage.
 */

import {
  BOLTZ_API_PROXY_PREFIX,
  BOLTZ_API_VERSION_PATH,
  BOLTZ_ARTIFACT_ORIGIN,
  BOLTZ_ARTIFACT_PROXY_PREFIX,
} from './boltz-endpoints'

export class BoltzApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'BoltzApiError'
    this.status = status
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
}

function describeHttpFailure(status: number, detail: string): BoltzApiError {
  let message = detail
  try {
    const parsed = JSON.parse(detail) as { message?: string; error?: { message?: string }; detail?: unknown }
    message = parsed.error?.message
      ?? parsed.message
      // Validation details may be an array; preserve every item so the invalid field is visible.
      ?? (Array.isArray(parsed.detail) ? JSON.stringify(parsed.detail) : undefined)
      ?? detail
  } catch {
    /* Preserve non-JSON gateway responses verbatim. */
  }
  if (status === 401 || status === 403) {
    return new BoltzApiError('Boltz rejected the API key (401/403). Check the key and try again.', status)
  }
  if (status === 429) {
    return new BoltzApiError('Boltz is rate limiting this workspace (429). Retry in a moment.', status)
  }
  return new BoltzApiError(
    message ? `Boltz API ${status}: ${message.slice(0, 400)}` : `Boltz API ${status}`,
    status,
  )
}

/**
 * Call a Boltz job API path relative to /compute/v1, such as
 * `/predictions/structure-and-binding`.
 */
export async function boltzApi<T>(path: string, apiKey: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const versionedPath = `${BOLTZ_API_VERSION_PATH}${path}`

  let httpResponse: Response
  try {
    httpResponse = await fetch(`${BOLTZ_API_PROXY_PREFIX}${versionedPath}`, {
      method,
      headers: {
        'x-api-key': apiKey,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new BoltzApiError(
      'Cannot reach the Boltz API through the same-origin web proxy.',
    )
  }

  if (!httpResponse.ok) {
    throw describeHttpFailure(httpResponse.status, await httpResponse.text().catch(() => ''))
  }
  return (await httpResponse.json()) as T
}

/**
 * Rewrite a presigned artifact URL through the same-origin proxy. Reject unexpected hosts
 * explicitly so a storage migration is not misdiagnosed as a network failure.
 */
function artifactProxyUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BoltzApiError('Boltz returned a malformed artifact URL')
  }
  const expected = new URL(BOLTZ_ARTIFACT_ORIGIN)
  if (parsed.origin !== expected.origin) {
    throw new BoltzApiError(
      `Boltz artifact host changed to ${parsed.host}; the local proxy only forwards ${expected.host}. `
      + 'Update BOLTZ_ARTIFACT_ORIGIN in src/services/boltz-endpoints.ts.',
    )
  }
  return `${BOLTZ_ARTIFACT_PROXY_PREFIX}${parsed.pathname}${parsed.search}`
}

/** Download an mmCIF artifact as text. */
export async function fetchBoltzArtifactText(url: string, signal?: AbortSignal): Promise<string> {
  const httpResponse = await fetch(artifactProxyUrl(url), signal ? { signal } : {})
  if (!httpResponse.ok) {
    throw new BoltzApiError(`Could not download artifact (${httpResponse.status})`, httpResponse.status)
  }
  return await httpResponse.text()
}

/** Download a tar.gz artifact; PAE matrices are available only through this archive. */
export async function fetchBoltzArtifactBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const httpResponse = await fetch(artifactProxyUrl(url), signal ? { signal } : {})
  if (!httpResponse.ok) {
    throw new BoltzApiError(`Could not download archive (${httpResponse.status})`, httpResponse.status)
  }
  return new Uint8Array(await httpResponse.arrayBuffer())
}
