/**
 * Lifecycle wrapper around `registerZatomWebMcpTools`.
 *
 * The adapter is a plain function so registration remains directly testable;
 * this hook exists only to bind a registration pass to a component's lifetime.
 * Two details are the reason it is a hook rather than a call in `main.tsx`:
 *
 * - Registration must not outlive the mount. WebMCP unregisters via
 *   `AbortSignal`, so cleanup aborts the pass. Without that, StrictMode's
 *   double-invoke would leave a duplicate registration behind.
 * - `registerTool` is async. An unmount can land while a pass is still awaiting,
 *   so cleanup aborts a signal the pass already observes instead of trying to
 *   cancel a promise.
 *
 * The curated core plus three facade descriptors are stable for the document
 * lifetime. Domain changes update their call-time gate in place instead of
 * unregistering and re-registering them; Chromium disables a page after too
 * many tool snapshot changes, so a user toggle must not consume that budget.
 */

import { useEffect, useRef } from 'react'

import { activeViewportToolContext } from '../agent/viewer-context'
import { isWebMcpAvailable, registerZatomWebMcpTools, type ZatomWebMcpRegistration } from '../agent/webmcp-adapter'
import { readHostWriteMode, summarizeToolArgs, useHostAccess } from '../orchestration/hostAccessStore'
import { useAgentActivity } from '../orchestration/agentActivityStore'

export interface UseZatomWebMcpToolsOptions {
  /** Set false to expose nothing, e.g. behind a user-facing setting. */
  enabled?: boolean
  /** Domains callable through the facade. Defaults to the registry's default domains. */
  domains?: readonly string[]
  /** Origins allowed to call these tools. Omitted means same-origin only. */
  exposedTo?: readonly string[]
}

export function useZatomWebMcpTools(options: UseZatomWebMcpToolsOptions = {}): void {
  const { enabled = true, domains, exposedTo } = options
  // Depend on contents, not identity: a caller passing an inline array literal
  // would otherwise re-register on every render.
  const domainKey = domains ? [...domains].join(',') : ''
  const originKey = exposedTo ? [...exposedTo].join(',') : ''
  const registrationRef = useRef<ZatomWebMcpRegistration | null>(null)
  const activityEndersRef = useRef(new Map<string, () => void>())
  const domainsRef = useRef<readonly string[] | undefined>(domains)
  domainsRef.current = domains

  useEffect(() => {
    if (!enabled || !isWebMcpAvailable()) {
      useHostAccess.getState().setWebMcpRegistration({
        state: 'unavailable', registeredTools: 0, updatedAt: new Date().toISOString(), error: null,
      })
      return
    }
    useHostAccess.getState().setWebMcpRegistration({
      state: 'registering', registeredTools: 0, updatedAt: new Date().toISOString(), error: null,
    })
    const controller = new AbortController()
    void registerZatomWebMcpTools({
      ...(domainsRef.current ? { domains: domainsRef.current } : {}),
      ...(originKey ? { exposedTo: originKey.split(',') } : {}),
      signal: controller.signal,
      // The in-page agent runs in this tab, so it reads the mode directly; the
      // registry consults it per call, so a panel change applies immediately.
      context: {
        ...activeViewportToolContext,
        access: { host: 'webmcp', mode: () => readHostWriteMode('webmcp') },
      },
      onToolCallStart: ({ id, tool, title, tier, workspace }) => {
        const verb = tier === 'read' ? 'Checking' : tier === 'compute' ? 'Preparing' : 'Applying'
        const end = useAgentActivity.getState().begin({
          label: `${verb} ${title.toLowerCase()}`,
          tier: tier === 'read' ? 'observe' : tier,
          interruptible: false,
          host: 'webmcp',
          tool,
          ...(workspace ? { viewportId: workspace.viewportId, workspaceRevision: workspace.revision } : {}),
        })
        activityEndersRef.current.set(id, end)
      },
      onToolCall: ({ id, tool, input, result, durationMs }) => {
        activityEndersRef.current.get(id)?.()
        activityEndersRef.current.delete(id)
        useHostAccess.getState().recordActivity({
          id: `webmcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          host: 'webmcp',
          at: new Date().toISOString(),
          tool,
          argsSummary: summarizeToolArgs(input),
          ok: result.ok,
          ...(result.ok || !result.error ? {} : { error: result.error.message }),
          durationMs,
          ...(!result.ok && result.error?.code === 'host_policy_denied' ? { deniedByPolicy: true } : {}),
        })
      },
    }).then((registration) => {
      if (controller.signal.aborted) {
        registration.unregister()
        return
      }
      registration.setDomains(domainsRef.current)
      registrationRef.current = registration
      useHostAccess.getState().setWebMcpRegistration({
        state: 'registered',
        registeredTools: registration.registered.length,
        updatedAt: new Date().toISOString(),
        error: null,
      })
    }).catch((cause: unknown) => {
      // A failed agent surface must not take down the modeler: the app is fully
      // usable without WebMCP, so this is reported and swallowed.
      if (!controller.signal.aborted) {
        console.warn('[zatom] WebMCP tool registration failed:', cause)
        useHostAccess.getState().setWebMcpRegistration({
          state: 'error',
          registeredTools: 0,
          updatedAt: new Date().toISOString(),
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    })
    return () => {
      controller.abort()
      for (const end of activityEndersRef.current.values()) end()
      activityEndersRef.current.clear()
      registrationRef.current?.unregister()
      registrationRef.current = null
    }
  }, [enabled, originKey])

  useEffect(() => {
    registrationRef.current?.setDomains(domainsRef.current)
  }, [domainKey])
}
