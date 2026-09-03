// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import { ZATOM_DEFAULT_TOOL_DOMAINS, zatomToolDomainNames } from '../agent/domains'
import {
  AGENT_TOOL_DOMAIN_STORAGE_KEY,
  loadAgentToolDomains,
  normalizeAgentToolDomains,
  saveAgentToolDomains,
} from '../ui/panels/agent-tool-domain-prefs'

describe('agent tool domain preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('always keeps session, so an agent can never be stranded without discovery', () => {
    // session carries zatom_domains / zatom_enable_domains. If a stored
    // selection could drop it, the agent would lose the only tools capable of
    // widening its own access, and could not recover on its own.
    expect(normalizeAgentToolDomains([])).toEqual(['session'])
    expect(normalizeAgentToolDomains(['build'])).toContain('session')

    saveAgentToolDomains([])
    expect(loadAgentToolDomains()).toContain('session')
  })

  it('distinguishes "never chosen" from "chose nothing"', () => {
    // An absent key must fall back to the registry defaults. Collapsing it to
    // session-only would silently strip a fresh install down to 6 tools.
    expect(loadAgentToolDomains()).toEqual([...ZATOM_DEFAULT_TOOL_DOMAINS])

    // An explicitly emptied selection is a real user decision and must survive
    // the reload rather than snapping back to the defaults.
    saveAgentToolDomains([])
    expect(loadAgentToolDomains()).toEqual(['session'])
  })

  it('drops unknown domain names instead of forwarding them to the registry', () => {
    // Stored names outlive renames. Passing a stale name through would make the
    // adapter register a domain that no longer exists.
    const known = new Set(zatomToolDomainNames())
    const normalized = normalizeAgentToolDomains(['build', 'not-a-domain', 'build'])
    expect(normalized.every((name) => known.has(name))).toBe(true)
    // Duplicates collapse, so the adapter cannot double-register a domain.
    expect(normalized.filter((name) => name === 'build')).toHaveLength(1)
  })

  it('survives corrupt storage rather than throwing during render', () => {
    // This runs inside useSyncExternalStore's snapshot, so a throw here would
    // break the whole panel instead of one setting.
    window.localStorage.setItem(AGENT_TOOL_DOMAIN_STORAGE_KEY, '{not json')
    expect(loadAgentToolDomains()).toEqual([...ZATOM_DEFAULT_TOOL_DOMAINS])

    window.localStorage.setItem(AGENT_TOOL_DOMAIN_STORAGE_KEY, '{"a":1}')
    expect(loadAgentToolDomains()).toEqual([...ZATOM_DEFAULT_TOOL_DOMAINS])

    window.localStorage.setItem(AGENT_TOOL_DOMAIN_STORAGE_KEY, '[1,2,"build"]')
    expect(loadAgentToolDomains()).toEqual(['session', 'build'])
  })
})
