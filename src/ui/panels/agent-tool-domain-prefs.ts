/**
 * Which tool domains this install exposes to agents.
 *
 * WebMCP keeps a small system facade available and hot-plugs direct
 * collaboration tools with their domains. These preferences are the user's
 * persistent base allowlist; temporary once/session grants live in the access
 * broker and never alter this stored selection.
 *
 * Membership and summaries are NOT duplicated here — they stay in
 * `agent/domains`, which remains the single source of truth. This module only
 * stores a selection of domain names.
 */
import { useCallback, useSyncExternalStore } from 'react'

import { ZATOM_DEFAULT_TOOL_DOMAINS, zatomToolDomainNames } from '../../agent/domains'

// v3 applies the secure default that keeps bound local assets private from an
// Agent until the user exposes that domain explicitly.
export const AGENT_TOOL_DOMAIN_STORAGE_KEY = 'zatom:agent:tool-domains:v3'
/** Fires (window event) when the selection changes, so mounted panels reload. */
export const AGENT_TOOL_DOMAINS_CHANGED = 'zatom:agent-tool-domains-changed'
export const AGENT_WEBMCP_ENABLED_STORAGE_KEY = 'zatom:agent:webmcp-enabled:v1'
export const AGENT_WEBMCP_ENABLED_CHANGED = 'zatom:agent-webmcp-enabled-changed'

/**
 * `session` is unconditional because it carries core discovery and routing
 * tools. This mirrors the same invariant in `resolveZatomToolDomains`.
 */
export function normalizeAgentToolDomains(input: readonly string[]): string[] {
  const known = new Set(zatomToolDomainNames())
  const next = ['session']
  for (const name of input) {
    if (known.has(name) && !next.includes(name)) next.push(name)
  }
  return next
}

export function loadAgentToolDomains(): string[] {
  if (typeof window === 'undefined') return [...ZATOM_DEFAULT_TOOL_DOMAINS]
  try {
    const raw = window.localStorage.getItem(AGENT_TOOL_DOMAIN_STORAGE_KEY)
    // A missing key means "never chosen", which must fall back to the registry
    // defaults rather than to `session` alone; an empty array is a real choice.
    if (raw === null) return [...ZATOM_DEFAULT_TOOL_DOMAINS]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...ZATOM_DEFAULT_TOOL_DOMAINS]
    return normalizeAgentToolDomains(parsed.filter((name): name is string => typeof name === 'string'))
  } catch {
    return [...ZATOM_DEFAULT_TOOL_DOMAINS]
  }
}

export function saveAgentToolDomains(names: readonly string[]): string[] {
  const normalized = normalizeAgentToolDomains(names)
  if (typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(AGENT_TOOL_DOMAIN_STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new CustomEvent(AGENT_TOOL_DOMAINS_CHANGED))
  } catch {
    // A full or blocked quota must not break the toggle; the in-memory
    // selection returned below still applies to this session.
  }
  return normalized
}

export function loadAgentWebMcpEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(AGENT_WEBMCP_ENABLED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveAgentWebMcpEnabled(enabled: boolean): boolean {
  if (typeof window === 'undefined') return enabled
  try {
    window.localStorage.setItem(AGENT_WEBMCP_ENABLED_STORAGE_KEY, enabled ? '1' : '0')
    window.dispatchEvent(new CustomEvent(AGENT_WEBMCP_ENABLED_CHANGED))
  } catch {
    // An unavailable preference store must not prevent this page from applying
    // the user's choice for the current render.
  }
  return enabled
}

/**
 * `useSyncExternalStore` needs a referentially stable snapshot or it re-renders
 * forever, but `loadAgentToolDomains` parses JSON into a fresh array each call.
 * Cache the array and only replace it when the stored value actually differs.
 */
let cachedSelection: string[] = loadAgentToolDomains()
let cachedKey = cachedSelection.join(',')

function readSelectionSnapshot(): string[] {
  const next = loadAgentToolDomains()
  const key = next.join(',')
  if (key !== cachedKey) {
    cachedSelection = next
    cachedKey = key
  }
  return cachedSelection
}

function subscribeToSelection(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(AGENT_TOOL_DOMAINS_CHANGED, onChange)
  // `storage` covers the same install open in a second tab, which shares one
  // localStorage but not the in-page custom event.
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(AGENT_TOOL_DOMAINS_CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

let cachedWebMcpEnabled = loadAgentWebMcpEnabled()

function readWebMcpEnabledSnapshot(): boolean {
  const next = loadAgentWebMcpEnabled()
  if (next !== cachedWebMcpEnabled) cachedWebMcpEnabled = next
  return cachedWebMcpEnabled
}

function subscribeToWebMcpEnabled(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(AGENT_WEBMCP_ENABLED_CHANGED, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(AGENT_WEBMCP_ENABLED_CHANGED, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Reads the persisted selection and re-renders when it changes. */
export function useAgentToolDomains(): {
  domains: readonly string[]
  setDomains: (names: readonly string[]) => void
} {
  const domains = useSyncExternalStore(subscribeToSelection, readSelectionSnapshot, readSelectionSnapshot)
  const setDomains = useCallback((names: readonly string[]) => {
    saveAgentToolDomains(names)
  }, [])
  return { domains, setDomains }
}

/** Master switch for the in-page WebMCP surface. Disabling it unregisters every page tool. */
export function useAgentWebMcpEnabled(): {
  enabled: boolean
  setEnabled: (enabled: boolean) => void
} {
  const enabled = useSyncExternalStore(
    subscribeToWebMcpEnabled,
    readWebMcpEnabledSnapshot,
    readWebMcpEnabledSnapshot,
  )
  const setEnabled = useCallback((next: boolean) => {
    cachedWebMcpEnabled = saveAgentWebMcpEnabled(next)
  }, [])
  return { enabled, setEnabled }
}
