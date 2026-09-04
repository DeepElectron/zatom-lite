import { create } from 'zustand'

export type WebMcpAccessDecision = 'once' | 'session' | 'always' | 'deny'
export type WebMcpAccessRequestDecision = WebMcpAccessDecision | 'timeout' | 'cancelled'

export interface WebMcpAccessRequestInput {
  domain: string
  tool: string
  reason: string
  /** Adapter-computed digest of exact sensitive tool input + workspace identity. */
  inputDigest?: string
  /** Adapter-generated, non-secret facts shown beside the Agent's free-form reason. */
  details?: readonly string[]
}

export interface WebMcpAccessRequestOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** Ignore broad domain grants and ask for a fresh exact-tool decision. */
  forcePrompt?: boolean
}

export interface WebMcpAccessRequestResult {
  decision: WebMcpAccessRequestDecision
  domain: string
}

export interface PendingWebMcpAccessRequest extends WebMcpAccessRequestInput {
  id: string
  requestedAt: number
  expiresAt: number
  waitingCallCount: number
}

export interface WebMcpDomainLease {
  release(): void
}

export interface WebMcpDomainAcquireInput {
  domain: string
  tool: string
  inputDigest?: string
  /** Accept only an exact one-call ticket, even when the domain is persistent. */
  requireOnce?: boolean
}

export interface WebMcpAccessBroker {
  setBaseDomains(names: Iterable<string>): void
  getExposedDomains(): readonly string[]
  subscribe(listener: () => void): () => void
  isAllowed(domain: string): boolean
  requiresInputDigest(input: WebMcpDomainAcquireInput): boolean
  acquire(input: WebMcpDomainAcquireInput): WebMcpDomainLease | null
  request(
    input: WebMcpAccessRequestInput,
    options?: WebMcpAccessRequestOptions,
  ): Promise<WebMcpAccessRequestResult>
  resolve(requestId: string, decision: WebMcpAccessDecision): void
  revoke(domain: string): void
  clearSession(): void
}

export interface WebMcpAccessState {
  revision: number
  baseDomains: readonly string[]
  sessionDomains: readonly string[]
  alwaysDomains: readonly string[]
  onceDomains: readonly string[]
  activeOnceDomains: readonly string[]
  exposedDomains: readonly string[]
  pendingRequests: readonly PendingWebMcpAccessRequest[]
}

const EMPTY_STATE: WebMcpAccessState = {
  revision: 0,
  baseDomains: [],
  sessionDomains: [],
  alwaysDomains: [],
  onceDomains: [],
  activeOnceDomains: [],
  exposedDomains: [],
  pendingRequests: [],
}

/** Reactive, serializable view of access decisions for permission UI. */
export const useWebMcpAccess = create<WebMcpAccessState>(() => EMPTY_STATE)

// Stay below common browser-host tool-call deadlines. A timed-out request is
// safe to repeat and never leaves a latent grant behind.
export const WEBMCP_ACCESS_REQUEST_TIMEOUT_MS = 15_000
export const WEBMCP_ACCESS_REQUEST_MAX_TIMEOUT_MS = 30_000
export const WEBMCP_MAX_PENDING_ACCESS_REQUESTS = 4
export const WEBMCP_MAX_WAITERS_PER_ACCESS_REQUEST = 8

interface RequestWaiter {
  expiresAt: number
  resolve: (result: WebMcpAccessRequestResult) => void
  cleanup: () => void
}

interface PendingRequestGroup {
  id: string
  key: string
  input: WebMcpAccessRequestInput
  requestedAt: number
  forcePrompt: boolean
  waiters: Map<number, RequestWaiter>
}

let nextRequestId = 0
let nextWaiterId = 0

function normalizeDomain(domain: string): string {
  return domain.trim()
}

function normalizedDomainSet(names: Iterable<string>): Set<string> {
  const result = new Set<string>()
  for (const candidate of names) {
    const name = normalizeDomain(candidate)
    if (name) result.add(name)
  }
  return result
}

function sameSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

function requestKey(input: WebMcpAccessRequestInput, forcePrompt: boolean): string {
  return JSON.stringify([input.domain, input.tool, input.inputDigest ?? '', forcePrompt])
}

const ONCE_GRANT_SEPARATOR = '\u0000'

function onceGrantKey(domain: string, tool: string, inputDigest = ''): string {
  return `${domain}${ONCE_GRANT_SEPARATOR}${tool}${ONCE_GRANT_SEPARATOR}${inputDigest}`
}

function onceGrantDomain(key: string): string {
  const separatorIndex = key.indexOf(ONCE_GRANT_SEPARATOR)
  return separatorIndex < 0 ? key : key.slice(0, separatorIndex)
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
    return WEBMCP_ACCESS_REQUEST_TIMEOUT_MS
  }
  return Math.min(
    WEBMCP_ACCESS_REQUEST_MAX_TIMEOUT_MS,
    Math.max(0, Math.floor(timeoutMs)),
  )
}

class DefaultWebMcpAccessBroker implements WebMcpAccessBroker {
  private baseDomains = new Set<string>()
  private sessionDomains = new Set<string>()
  private alwaysDomains = new Set<string>()
  private onceGrants = new Map<string, number>()
  private activeOnceLeases = new Map<string, number>()
  private pendingById = new Map<string, PendingRequestGroup>()
  private pendingByKey = new Map<string, PendingRequestGroup>()
  private revision = 0

  setBaseDomains(names: Iterable<string>): void {
    const next = normalizedDomainSet(names)
    if (sameSet(this.baseDomains, next)) return

    this.baseDomains = next
    for (const domain of next) {
      this.sessionDomains.delete(domain)
      this.alwaysDomains.delete(domain)
    }

    const newlyAuthorized = [...this.pendingById.values()]
      .filter((request) => !request.forcePrompt && next.has(request.input.domain))
    const settlements = newlyAuthorized.map((request) =>
      this.removePendingGroup(request, 'always'))
    this.publish()
    this.deliverSettlements(settlements)
  }

  getExposedDomains(): readonly string[] {
    return this.collectExposedDomains()
  }

  subscribe(listener: () => void): () => void {
    return useWebMcpAccess.subscribe(() => listener())
  }

  isAllowed(domain: string): boolean {
    const normalized = normalizeDomain(domain)
    if (!normalized) return false
    return this.baseDomains.has(normalized)
      || this.sessionDomains.has(normalized)
      || this.alwaysDomains.has(normalized)
      || [...this.onceGrants].some(([key, count]) => onceGrantDomain(key) === normalized && count > 0)
  }

  requiresInputDigest(input: WebMcpDomainAcquireInput): boolean {
    const prefix = `${normalizeDomain(input.domain)}${ONCE_GRANT_SEPARATOR}${input.tool}${ONCE_GRANT_SEPARATOR}`
    return [...this.onceGrants].some(([key, count]) => (
      count > 0 && key.startsWith(prefix) && key.slice(prefix.length).length > 0
    ))
  }

  acquire(input: WebMcpDomainAcquireInput): WebMcpDomainLease | null {
    const normalized = normalizeDomain(input.domain)
    if (!normalized) return null

    const grantKey = onceGrantKey(normalized, input.tool, input.inputDigest)
    const available = this.onceGrants.get(grantKey) ?? 0
    if (available > 0) {
      if (available === 1) this.onceGrants.delete(grantKey)
      else this.onceGrants.set(grantKey, available - 1)
      this.activeOnceLeases.set(grantKey, (this.activeOnceLeases.get(grantKey) ?? 0) + 1)
      this.publish()

      let released = false
      return {
        release: () => {
          if (released) return
          released = true
          const active = this.activeOnceLeases.get(grantKey) ?? 0
          if (active <= 1) this.activeOnceLeases.delete(grantKey)
          else this.activeOnceLeases.set(grantKey, active - 1)
          this.publish()
        },
      }
    }

    if (input.requireOnce) return null
    if (
      this.baseDomains.has(normalized)
      || this.alwaysDomains.has(normalized)
      || this.sessionDomains.has(normalized)
    ) return { release: () => undefined }
    return null
  }

  request(
    rawInput: WebMcpAccessRequestInput,
    options: WebMcpAccessRequestOptions = {},
  ): Promise<WebMcpAccessRequestResult> {
    const input: WebMcpAccessRequestInput = {
      domain: normalizeDomain(rawInput.domain),
      tool: typeof rawInput.tool === 'string' ? rawInput.tool.trim() : '',
      reason: rawInput.reason.trim(),
      ...(rawInput.inputDigest ? { inputDigest: rawInput.inputDigest } : {}),
      ...(rawInput.details?.length ? {
        details: rawInput.details
          .filter((detail): detail is string => typeof detail === 'string' && detail.trim().length > 0)
          .slice(0, 6)
          .map((detail) => detail.trim().slice(0, 180)),
      } : {}),
    }
    if (!input.domain) return Promise.reject(new Error('A WebMCP access request requires a domain'))
    if (!input.tool) return Promise.reject(new Error('A WebMCP access request requires the next tool'))
    if (!input.reason) return Promise.reject(new Error('A WebMCP access request requires a reason'))
    if (input.inputDigest && !/^sha256:[0-9a-f]{64}$/.test(input.inputDigest)) {
      return Promise.reject(new Error('A WebMCP access input digest must be lowercase sha256:<64 hex>'))
    }
    if (options.signal?.aborted) {
      return Promise.resolve({ decision: 'cancelled', domain: input.domain })
    }

    const existingOnceGrant = this.onceGrants.get(onceGrantKey(input.domain, input.tool, input.inputDigest)) ?? 0
    if (existingOnceGrant > 0) {
      return Promise.resolve({ decision: 'once', domain: input.domain })
    }
    if (!options.forcePrompt && (this.baseDomains.has(input.domain) || this.alwaysDomains.has(input.domain))) {
      return Promise.resolve({ decision: 'always', domain: input.domain })
    }
    if (!options.forcePrompt && this.sessionDomains.has(input.domain)) {
      return Promise.resolve({ decision: 'session', domain: input.domain })
    }

    const timeoutMs = boundedTimeout(options.timeoutMs)
    if (timeoutMs === 0) {
      return Promise.resolve({ decision: 'timeout', domain: input.domain })
    }

    const forcePrompt = options.forcePrompt === true
    const key = requestKey(input, forcePrompt)
    const pendingForDomain = [...this.pendingById.values()].find((request) => (
      request.input.domain === input.domain && request.key !== key
    ))
    if (pendingForDomain) {
      return Promise.reject(new Error(
        `${input.domain} already has an access request waiting for ${pendingForDomain.input.tool}`,
      ))
    }
    if (!this.pendingByKey.has(key) && this.pendingById.size >= WEBMCP_MAX_PENDING_ACCESS_REQUESTS) {
      return Promise.reject(new Error('Too many WebMCP access requests are already waiting for the user'))
    }
    let group = this.pendingByKey.get(key)
    if (!group) {
      group = {
        id: `webmcp-access-${Date.now().toString(36)}-${(++nextRequestId).toString(36)}`,
        key,
        input,
        requestedAt: Date.now(),
        forcePrompt,
        waiters: new Map(),
      }
      this.pendingById.set(group.id, group)
      this.pendingByKey.set(key, group)
    }
    if (group.waiters.size >= WEBMCP_MAX_WAITERS_PER_ACCESS_REQUEST) {
      return Promise.reject(new Error('Too many callers are already waiting on this WebMCP access request'))
    }

    const pendingGroup = group
    return new Promise<WebMcpAccessRequestResult>((resolve) => {
      const waiterId = ++nextWaiterId
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const finish = (decision: 'timeout' | 'cancelled') => {
        if (settled) return
        settled = true
        cleanup()
        pendingGroup.waiters.delete(waiterId)
        if (pendingGroup.waiters.size === 0) this.deletePendingGroup(pendingGroup)
        this.publish()
        resolve({ decision, domain: input.domain })
      }
      const onAbort = () => finish('cancelled')
      const expiresAt = Date.now() + timeoutMs
      pendingGroup.waiters.set(waiterId, { expiresAt, resolve, cleanup })
      timer = setTimeout(() => finish('timeout'), timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.publish()
      if (options.signal?.aborted) onAbort()
    })
  }

  resolve(requestId: string, decision: WebMcpAccessDecision): void {
    const group = this.pendingById.get(requestId)
    if (!group) return

    const effectiveDecision = group.forcePrompt && (decision === 'session' || decision === 'always')
      ? 'once'
      : decision
    const domain = group.input.domain
    if (effectiveDecision === 'once') {
      const grantKey = onceGrantKey(domain, group.input.tool, group.input.inputDigest)
      this.onceGrants.set(grantKey, (this.onceGrants.get(grantKey) ?? 0) + 1)
    } else if (effectiveDecision === 'session') {
      this.sessionDomains.add(domain)
    } else if (effectiveDecision === 'always') {
      this.alwaysDomains.add(domain)
    }

    const settlement = this.removePendingGroup(group, effectiveDecision)
    this.publish()
    this.deliverSettlements([settlement])
  }

  revoke(rawDomain: string): void {
    const domain = normalizeDomain(rawDomain)
    if (!domain) return
    const removedSession = this.sessionDomains.delete(domain)
    const removedAlways = this.alwaysDomains.delete(domain)
    let removedOnce = false
    for (const key of [...this.onceGrants.keys()]) {
      if (onceGrantDomain(key) !== domain) continue
      this.onceGrants.delete(key)
      removedOnce = true
    }
    let removedActiveOnce = false
    for (const key of [...this.activeOnceLeases.keys()]) {
      if (onceGrantDomain(key) !== domain) continue
      this.activeOnceLeases.delete(key)
      removedActiveOnce = true
    }
    const changed = removedSession || removedAlways || removedOnce || removedActiveOnce

    const settlements = [...this.pendingById.values()]
      .filter((request) => request.input.domain === domain)
      .map((request) => this.removePendingGroup(request, 'cancelled'))
    if (changed || settlements.length > 0) this.publish()
    this.deliverSettlements(settlements)
  }

  clearSession(): void {
    const settlements = [...this.pendingById.values()]
      .map((request) => this.removePendingGroup(request, 'cancelled'))
    const changed = this.sessionDomains.size > 0
      || this.alwaysDomains.size > 0
      || this.onceGrants.size > 0
      || this.activeOnceLeases.size > 0
      || settlements.length > 0
    this.sessionDomains.clear()
    this.alwaysDomains.clear()
    this.onceGrants.clear()
    this.activeOnceLeases.clear()
    if (changed) this.publish()
    this.deliverSettlements(settlements)
  }

  private collectExposedDomains(): string[] {
    const result = new Set<string>(this.baseDomains)
    for (const domain of this.sessionDomains) result.add(domain)
    for (const domain of this.alwaysDomains) result.add(domain)
    for (const [key, count] of this.onceGrants) {
      if (count > 0) result.add(onceGrantDomain(key))
    }
    for (const [key, count] of this.activeOnceLeases) {
      if (count > 0) result.add(onceGrantDomain(key))
    }
    return [...result]
  }

  private deletePendingGroup(group: PendingRequestGroup): void {
    this.pendingById.delete(group.id)
    if (this.pendingByKey.get(group.key) === group) this.pendingByKey.delete(group.key)
  }

  private removePendingGroup(
    group: PendingRequestGroup,
    decision: WebMcpAccessRequestDecision,
  ): Array<() => void> {
    this.deletePendingGroup(group)
    const deliveries = [...group.waiters.values()].map((waiter) => () => {
      waiter.cleanup()
      waiter.resolve({ decision, domain: group.input.domain })
    })
    group.waiters.clear()
    return deliveries
  }

  private deliverSettlements(settlements: Array<Array<() => void>>): void {
    for (const settlement of settlements) {
      for (const deliver of settlement) deliver()
    }
  }

  private publish(): void {
    this.revision += 1
    const pendingRequests = [...this.pendingById.values()].map((request) => ({
      ...request.input,
      id: request.id,
      requestedAt: request.requestedAt,
      expiresAt: Math.min(...[...request.waiters.values()].map((waiter) => waiter.expiresAt)),
      waitingCallCount: request.waiters.size,
    }))
    useWebMcpAccess.setState({
      revision: this.revision,
      baseDomains: [...this.baseDomains],
      sessionDomains: [...this.sessionDomains],
      alwaysDomains: [...this.alwaysDomains],
      onceDomains: [...new Set([...this.onceGrants.entries()]
        .filter(([, count]) => count > 0)
        .map(([key]) => onceGrantDomain(key)))],
      activeOnceDomains: [...new Set([...this.activeOnceLeases.entries()]
        .filter(([, count]) => count > 0)
        .map(([key]) => onceGrantDomain(key)))],
      exposedDomains: this.collectExposedDomains(),
      pendingRequests,
    })
  }
}

export const webMcpAccessBroker: WebMcpAccessBroker = new DefaultWebMcpAccessBroker()
