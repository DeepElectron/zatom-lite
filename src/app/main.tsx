/**
 * Browser entry point for the local workspace and native WebMCP surface.
 * The error boundary keeps non-WebGL controls available when 3D initialization fails.
 */
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ModelerView } from '../ui/ModelerView'
import { setWorkspaceLayersHook } from '../host'
import { initializeLocalWorkspace, useLocalWorkspaceLayers } from '../host/localWorkspace'
import { initializeAgentModelingRunHistory } from '../ui/panels/agent-modeling-history-db'
import { initializeAgentModelingTaskPersistence } from '../ui/panels/agent-modeling-task-db'
import { installScrollOverlay } from '../ui/scroll-overlay'
import { useZatomWebMcpTools } from '../ui/use-zatom-webmcp-tools'
import { useAgentToolDomains, useAgentWebMcpEnabled } from '../ui/panels/agent-tool-domain-prefs'
import { AboutAndLicensesDialog } from '../ui/components/about-and-licenses-dialog'
import { requiresLegalNoticeAcknowledgement } from '../ui/components/legal-notice-state'

import { AppErrorBoundary } from './AppErrorBoundary'
import { StartupScreen, type StartupStage } from './StartupScreen'

import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('zatom: #root is missing from index.html')

/** Startup-safe agent surface: every `session` tool is read-only. */
const SESSION_ONLY_DOMAINS = ['session'] as const

function ZatomApp() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [startupStage, setStartupStage] = useState<StartupStage>('workspace')
  const [legalDialogMode, setLegalDialogMode] = useState<'first-run' | 'about' | null>(null)
  const [showBrandCoachmark, setShowBrandCoachmark] = useState(false)
  const { domains: agentDomains } = useAgentToolDomains()
  const { enabled: webMcpEnabled } = useAgentWebMcpEnabled()

  // Install once at the capture phase so individual scroll containers do not
  // need their own overlay integration.
  useEffect(() => installScrollOverlay(), [])

  // In-page agent surface, registered in two phases.
  //
  // Pre-ready: `session` only. Every tool in that domain is read-only, so an
  // agent probing during startup learns what zatom is and that no instance is
  // connected yet. Registering nothing instead would be indistinguishable from
  // "this page exposes no tools", which is the wrong conclusion to leave an
  // agent with for the duration of workspace startup.
  //
  // Ready: the registry's default domains. Withheld until now because those
  // tools write through the workspace ports, which are only wired once the
  // local workspace opens.
  // Ready: the domains this install exposes, as chosen in Agent Access → Tools
  // and persisted across reloads. Defaults to the registry's default domains.
  useZatomWebMcpTools(ready
    ? { enabled: webMcpEnabled, domains: agentDomains }
    : { enabled: webMcpEnabled, domains: SESSION_ONLY_DOMAINS })

  useEffect(() => {
    let active = true
    let closeCliBridge: (() => void) | null = null
    Promise.all([initializeLocalWorkspace(), initializeAgentModelingRunHistory()])
      .then(() => {
        if (active) setStartupStage('task')
        return initializeAgentModelingTaskPersistence()
      })
      .then(async () => {
        if (!active) return
        setStartupStage('interface')
        setWorkspaceLayersHook(useLocalWorkspaceLayers)
        if (import.meta.env.DEV) {
          // The optional development bridge never enters the deployed Web app.
          const { installZatomDevCliBridgeHost } = await import('../devbridge/browser-viewport-host')
          if (!active) return
          closeCliBridge = installZatomDevCliBridgeHost()
        }
        setReady(true)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error(String(cause)))
      })
    return () => {
      active = false
      closeCliBridge?.()
    }
  }, [])

  useEffect(() => {
    if (ready && requiresLegalNoticeAcknowledgement()) setLegalDialogMode('first-run')
  }, [ready])

  if (error) throw error
  if (!ready) return <StartupScreen stage={startupStage} />
  return (
    <>
      <ModelerView
        onOpenAbout={() => setLegalDialogMode('about')}
        showBrandCoachmark={showBrandCoachmark}
        onBrandCoachmarkDismiss={() => setShowBrandCoachmark(false)}
      />
      <AboutAndLicensesDialog
        open={legalDialogMode !== null}
        mode={legalDialogMode ?? 'about'}
        onOpenChange={(open) => {
          if (!open) setLegalDialogMode(null)
        }}
        onAcknowledged={() => setShowBrandCoachmark(true)}
      />
    </>
  )
}

createRoot(container).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <ZatomApp />
    </AppErrorBoundary>
  </React.StrictMode>,
)
