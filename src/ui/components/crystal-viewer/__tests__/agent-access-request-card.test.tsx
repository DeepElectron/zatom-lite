// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  useWebMcpAccess,
  webMcpAccessBroker,
} from '../../../../orchestration/webMcpAccessStore'
import { AgentAccessRequestCard } from '../agent-access-request-card'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  webMcpAccessBroker.clearSession()
  webMcpAccessBroker.setBaseDomains(['session'])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  webMcpAccessBroker.clearSession()
  webMcpAccessBroker.setBaseDomains([])
})

describe('AgentAccessRequestCard', () => {
  it('shows the exact requested tool and grants only that next call', async () => {
    const decision = webMcpAccessBroker.request(
      {
        domain: 'surface',
        tool: 'structure_build_miller_slab',
        reason: 'Prepare a reviewable (111) slab.',
        details: ['Viewport: vp-1 · r4 · fnv1a64:1234', 'Input: 48 bytes · fields miller'],
      },
      { timeoutMs: 5_000 },
    )

    await act(async () => {
      root.render(<AgentAccessRequestCard />)
    })

    expect(container.textContent).toContain('Agent requests Surface modeling')
    expect(container.textContent).toContain('structure_build_miller_slab')
    expect(container.textContent).toContain('Prepare a reviewable (111) slab.')
    expect(container.textContent).toContain('Verified request details')
    expect(container.textContent).toContain('Viewport: vp-1 · r4')
    const allowOnce = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Allow once')
    expect(allowOnce).toBeDefined()

    await act(async () => {
      allowOnce!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await decision
    })

    await expect(decision).resolves.toEqual({ decision: 'once', domain: 'surface' })
    expect(useWebMcpAccess.getState().pendingRequests).toHaveLength(0)
    expect(webMcpAccessBroker.acquire({
      domain: 'surface',
      tool: 'surface_prepare_adsorption',
    })).toBeNull()
    const exactLease = webMcpAccessBroker.acquire({
      domain: 'surface',
      tool: 'structure_build_miller_slab',
    })
    expect(exactLease).not.toBeNull()
    exactLease?.release()
  })
})
