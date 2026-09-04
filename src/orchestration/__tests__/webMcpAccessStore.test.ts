import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  useWebMcpAccess,
  webMcpAccessBroker,
} from '../webMcpAccessStore'

function resetBroker(): void {
  webMcpAccessBroker.clearSession()
  webMcpAccessBroker.setBaseDomains([])
}

afterEach(() => {
  vi.useRealTimers()
  resetBroker()
})
describe('WebMCP access broker', () => {
  it('publishes base domains and acquires them without consuming access', () => {
    webMcpAccessBroker.setBaseDomains(['session', 'viewport', 'viewport', ' '])

    expect(webMcpAccessBroker.getExposedDomains()).toEqual(['session', 'viewport'])
    expect(useWebMcpAccess.getState().baseDomains).toEqual(['session', 'viewport'])
    expect(webMcpAccessBroker.isAllowed('viewport')).toBe(true)

    const first = webMcpAccessBroker.acquire({ domain: 'viewport', tool: 'viewer_observe' })
    const second = webMcpAccessBroker.acquire({ domain: 'viewport', tool: 'scene_observe' })
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    first?.release()
    second?.release()
    expect(webMcpAccessBroker.isAllowed('viewport')).toBe(true)
  })

  it('queues one reactive request and coalesces identical callers', async () => {
    const first = webMcpAccessBroker.request(
      { domain: 'build', tool: 'structure_build_miller_slab', reason: 'Build a slab candidate' },
      { timeoutMs: 5_000 },
    )
    const second = webMcpAccessBroker.request(
      { domain: 'build', tool: 'structure_build_miller_slab', reason: 'Build a slab candidate' },
      { timeoutMs: 5_000 },
    )

    const [pending] = useWebMcpAccess.getState().pendingRequests
    expect(pending).toMatchObject({
      domain: 'build',
      tool: 'structure_build_miller_slab',
      reason: 'Build a slab candidate',
      waitingCallCount: 2,
    })
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(1)

    webMcpAccessBroker.resolve(pending.id, 'session')
    await expect(first).resolves.toEqual({ decision: 'session', domain: 'build' })
    await expect(second).resolves.toEqual({ decision: 'session', domain: 'build' })
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(0)
    expect(webMcpAccessBroker.isAllowed('build')).toBe(true)
  })

  it('coalesces copy changes but refuses competing tools in one domain', async () => {
    const first = webMcpAccessBroker.request(
      { domain: 'build', tool: 'structure_build_metal_cluster', reason: 'Build a Pt cluster' },
      { timeoutMs: 5_000 },
    )
    const sameTool = webMcpAccessBroker.request(
      { domain: 'build', tool: 'structure_build_metal_cluster', reason: 'Prepare the cluster requested by the user' },
      { timeoutMs: 5_000 },
    )
    await expect(webMcpAccessBroker.request(
      { domain: 'build', tool: 'structure_build_interface', reason: 'Build an interface instead' },
      { timeoutMs: 5_000 },
    )).rejects.toThrow(/already has an access request/)

    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(1)
    expect(useWebMcpAccess.getState().pendingRequests[0].waitingCallCount).toBe(2)
    webMcpAccessBroker.resolve(useWebMcpAccess.getState().pendingRequests[0].id, 'deny')
    await expect(first).resolves.toMatchObject({ decision: 'deny' })
    await expect(sameTool).resolves.toMatchObject({ decision: 'deny' })
  })

  it('consumes a once grant atomically and exposes it only through the active lease', async () => {
    const requested = webMcpAccessBroker.request(
      { domain: 'surface', tool: 'surface_prepare_adsorption', reason: 'Inspect adsorption sites' },
      { timeoutMs: 5_000 },
    )
    const requestId = useWebMcpAccess.getState().pendingRequests[0].id
    webMcpAccessBroker.resolve(requestId, 'once')
    await expect(requested).resolves.toEqual({ decision: 'once', domain: 'surface' })

    expect(webMcpAccessBroker.isAllowed('surface')).toBe(true)
    expect(webMcpAccessBroker.acquire({
      domain: 'surface',
      tool: 'surface_detect_adsorption_sites',
    })).toBeNull()
    const lease = webMcpAccessBroker.acquire({
      domain: 'surface',
      tool: 'surface_prepare_adsorption',
    })
    expect(lease).not.toBeNull()
    expect(webMcpAccessBroker.isAllowed('surface')).toBe(false)
    expect(webMcpAccessBroker.getExposedDomains()).toContain('surface')
    expect(useWebMcpAccess.getState().activeOnceDomains).toEqual(['surface'])

    lease?.release()
    lease?.release()
    expect(webMcpAccessBroker.getExposedDomains()).not.toContain('surface')
    expect(useWebMcpAccess.getState().activeOnceDomains).toEqual([])
  })

  it('settles an aborted waiter without cancelling a coalesced caller', async () => {
    const controller = new AbortController()
    const cancelled = webMcpAccessBroker.request(
      { domain: 'provider', tool: 'modeling_run_provider', reason: 'Run an external provider' },
      { signal: controller.signal, timeoutMs: 5_000 },
    )
    const remaining = webMcpAccessBroker.request(
      { domain: 'provider', tool: 'modeling_run_provider', reason: 'Run an external provider' },
      { timeoutMs: 5_000 },
    )
    controller.abort()

    await expect(cancelled).resolves.toEqual({ decision: 'cancelled', domain: 'provider' })
    const [pending] = useWebMcpAccess.getState().pendingRequests
    expect(pending.waitingCallCount).toBe(1)
    webMcpAccessBroker.resolve(pending.id, 'deny')
    await expect(remaining).resolves.toEqual({ decision: 'deny', domain: 'provider' })
  })

  it('linearizes an approval before a later cancellation signal', async () => {
    const controller = new AbortController()
    const requested = webMcpAccessBroker.request(
      { domain: 'surface', tool: 'surface_prepare_adsorption', reason: 'Prepare adsorption sites' },
      { signal: controller.signal, timeoutMs: 5_000 },
    )
    const requestId = useWebMcpAccess.getState().pendingRequests[0].id
    webMcpAccessBroker.resolve(requestId, 'once')
    controller.abort()

    await expect(requested).resolves.toEqual({ decision: 'once', domain: 'surface' })
    expect(webMcpAccessBroker.acquire({
      domain: 'surface',
      tool: 'surface_prepare_adsorption',
    })).not.toBeNull()
  })

  it('can require a fresh exact-tool ticket inside a persistently enabled domain', async () => {
    const inputDigest = `sha256:${'a'.repeat(64)}`
    webMcpAccessBroker.setBaseDomains(['session', 'provider'])
    const requested = webMcpAccessBroker.request(
      {
        domain: 'provider',
        tool: 'compute_prepare_boltz_job',
        reason: 'Send this model to Boltz for an exact estimate',
        inputDigest,
      },
      { forcePrompt: true, timeoutMs: 5_000 },
    )
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(1)
    webMcpAccessBroker.setBaseDomains(['session', 'provider', 'build'])
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(1)
    // Even a buggy UI cannot widen a forced exact-call request to a broad grant.
    webMcpAccessBroker.resolve(useWebMcpAccess.getState().pendingRequests[0].id, 'always')
    await expect(requested).resolves.toEqual({ decision: 'once', domain: 'provider' })

    expect(webMcpAccessBroker.acquire({
      domain: 'provider',
      tool: 'modeling_run_provider',
      inputDigest,
      requireOnce: true,
    })).toBeNull()
    expect(webMcpAccessBroker.acquire({
      domain: 'provider',
      tool: 'compute_prepare_boltz_job',
      inputDigest: `sha256:${'b'.repeat(64)}`,
      requireOnce: true,
    })).toBeNull()
    const estimateLease = webMcpAccessBroker.acquire({
      domain: 'provider',
      tool: 'compute_prepare_boltz_job',
      inputDigest,
      requireOnce: true,
    })
    expect(estimateLease).not.toBeNull()
    estimateLease?.release()
    expect(webMcpAccessBroker.acquire({
      domain: 'provider',
      tool: 'compute_prepare_boltz_job',
      inputDigest,
      requireOnce: true,
    })).toBeNull()
    // Broad provider access still applies to ordinary provider discovery/run
    // paths; only the network-estimate boundary is forced through one-call consent.
    expect(webMcpAccessBroker.acquire({
      domain: 'provider',
      tool: 'modeling_run_provider',
    })).not.toBeNull()
  })

  it('bounds request timeouts and removes expired requests', async () => {
    vi.useFakeTimers()
    const requested = webMcpAccessBroker.request(
      { domain: 'trajectory', tool: 'trajectory_analyze_rdf', reason: 'Analyze a trajectory' },
      { timeoutMs: 25 },
    )
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(25)
    await expect(requested).resolves.toEqual({ decision: 'timeout', domain: 'trajectory' })
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(0)
  })

  it('revokes temporary grants and clears pending session work', async () => {
    const sessionRequest = webMcpAccessBroker.request(
      { domain: 'chemstate', tool: 'microstate_scan_titration', reason: 'Analyze chemical states' },
      { timeoutMs: 5_000 },
    )
    webMcpAccessBroker.resolve(useWebMcpAccess.getState().pendingRequests[0].id, 'always')
    await sessionRequest
    expect(webMcpAccessBroker.isAllowed('chemstate')).toBe(true)

    webMcpAccessBroker.revoke('chemstate')
    expect(webMcpAccessBroker.isAllowed('chemstate')).toBe(false)

    const pending = webMcpAccessBroker.request(
      { domain: 'evidence', tool: 'reaction_validate_path_evidence', reason: 'Validate evidence' },
      { timeoutMs: 5_000 },
    )
    webMcpAccessBroker.clearSession()
    await expect(pending).resolves.toEqual({ decision: 'cancelled', domain: 'evidence' })
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(0)
    expect(useWebMcpAccess.getState().sessionDomains).toEqual([])
    expect(useWebMcpAccess.getState().alwaysDomains).toEqual([])
    expect(useWebMcpAccess.getState().onceDomains).toEqual([])
  })
})
