import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  BadgeInfo,
  Check,
  ExternalLink,
  FileText,
  Scale,
  ShieldCheck,
} from 'lucide-react'

import zatomMarkUrl from '../../assets/zatom-mark-180.png'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui-kit/dialog'
import { acknowledgeLegalNotice } from './legal-notice-state'

type LegalDocumentKey = 'software' | 'branding' | 'third-party'

const LEGAL_DOCUMENTS: Record<LegalDocumentKey, { title: string; path: string }> = {
  software: { title: 'GNU Affero General Public License', path: 'legal/AGPL-3.0.txt' },
  branding: { title: 'Zatom brand asset terms', path: 'legal/BRANDING.txt' },
  'third-party': { title: 'Third-party software notices', path: 'legal/THIRD_PARTY_NOTICES.txt' },
}

function legalDocumentUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`
}

interface LegalDocumentViewerProps {
  documentKey: LegalDocumentKey
  onBack: () => void
}

function LegalDocumentViewer({ documentKey, onBack }: LegalDocumentViewerProps) {
  const document = LEGAL_DOCUMENTS[documentKey]
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setContent(null)
    setError(null)
    void fetch(legalDocumentUrl(document.path), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Document unavailable (${response.status})`)
        return response.text()
      })
      .then(setContent)
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => controller.abort()
  }, [document.path])

  return (
    <div className="min-h-0">
      <button
        type="button"
        onClick={onBack}
        className="zatom-pressable mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium"
        style={{ color: 'var(--panel-text-secondary)' }}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        About Zatom
      </button>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--panel-text)' }}>{document.title}</h3>
      <div
        className="mt-3 h-[min(52vh,440px)] overflow-auto rounded-xl border p-4"
        style={{ background: 'var(--panel-elevated)', borderColor: 'var(--panel-border)' }}
      >
        {content ? (
          <pre
            className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed"
            style={{ color: 'var(--panel-text-secondary)' }}
            tabIndex={0}
          >
            {content}
          </pre>
        ) : error ? (
          <p role="alert" className="text-xs" style={{ color: 'var(--status-red)' }}>{error}</p>
        ) : (
          <p role="status" className="text-xs" style={{ color: 'var(--panel-text-secondary)' }}>
            Loading document…
          </p>
        )}
      </div>
    </div>
  )
}

function LegalItem({
  icon,
  title,
  children,
  onOpen,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="zatom-pressable flex w-full items-start gap-3 rounded-xl border p-3 text-left"
      style={{ background: 'var(--panel-elevated)', borderColor: 'var(--panel-border)' }}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'var(--panel-accent-bg)', color: 'var(--panel-accent)' }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold" style={{ color: 'var(--panel-text)' }}>{title}</span>
        <span className="mt-1 block text-[10px] leading-relaxed" style={{ color: 'var(--panel-text-secondary)' }}>
          {children}
        </span>
      </span>
      <FileText className="mt-1 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--panel-text-tertiary)' }} aria-hidden />
    </button>
  )
}

export interface AboutAndLicensesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: 'about' | 'first-run'
  appVersion?: string
  onAcknowledged?: (persisted: boolean) => void
}

/**
 * Shared About/legal surface for the first-run acknowledgement and the logo
 * entry point. It reads distributable documents from public/legal, which also
 * works inside the packaged zatom:// renderer.
 */
export function AboutAndLicensesDialog({
  open,
  onOpenChange,
  mode = 'about',
  appVersion,
  onAcknowledged,
}: AboutAndLicensesDialogProps) {
  const [activeDocument, setActiveDocument] = useState<LegalDocumentKey | null>(null)
  const firstRun = mode === 'first-run'

  useEffect(() => {
    if (!open) setActiveDocument(null)
  }, [open])

  const acknowledge = () => {
    const persisted = acknowledgeLegalNotice()
    onAcknowledged?.(persisted)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && firstRun) return
        onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl"
        showCloseButton={!firstRun}
        onEscapeKeyDown={(event) => { if (firstRun) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (firstRun) event.preventDefault() }}
      >
        {activeDocument ? (
          <LegalDocumentViewer documentKey={activeDocument} onBack={() => setActiveDocument(null)} />
        ) : (
          <>
            <DialogHeader>
              <div className="mb-1 flex items-center gap-3 text-left">
                <img src={zatomMarkUrl} alt="" draggable={false} className="h-11 w-11 select-none object-contain" />
                <div>
                  <DialogTitle>{firstRun ? 'Before you begin' : 'About Zatom'}</DialogTitle>
                  <div className="mt-1 text-[10px]" style={{ color: 'var(--panel-text-tertiary)' }}>
                    Zatom{appVersion ? ` ${appVersion}` : ''} · Copyright © 2026 zauq tech
                  </div>
                </div>
              </div>
              <DialogDescription className="text-left leading-relaxed">
                Zatom is free software under AGPL-3.0-or-later, without warranty. The Zatom name,
                logo, and listed brand assets are licensed separately. Third-party components keep
                their own licenses.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 sm:grid-cols-3">
              <LegalItem
                icon={<Scale className="h-4 w-4" aria-hidden />}
                title="Software license"
                onOpen={() => setActiveDocument('software')}
              >
                Read your rights and responsibilities under the GNU Affero General Public License.
              </LegalItem>
              <LegalItem
                icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
                title="Name & logo"
                onOpen={() => setActiveDocument('branding')}
              >
                Official marks and listed artwork remain reserved brand assets of zauq tech.
              </LegalItem>
              <LegalItem
                icon={<BadgeInfo className="h-4 w-4" aria-hidden />}
                title="Third parties"
                onOpen={() => setActiveDocument('third-party')}
              >
                Inspect the dependency inventory and the upstream notices shipped with this build.
              </LegalItem>
            </div>

            <div
              className="rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed"
              style={{
                color: 'var(--panel-text-secondary)',
                background: 'var(--status-neutral-bg)',
                borderColor: 'var(--status-neutral-border)',
              }}
            >
              This notice shows where the terms are available; it is not a separate EULA. The AGPL
              does not require acceptance merely to receive or run an unmodified copy. Modifying,
              operating a modified network version, or redistributing the software carries license
              obligations described in the full text.
            </div>

            <a
              href="https://github.com/DeepElectron/zatom-lite"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-[11px] font-medium underline-offset-4 hover:underline"
              style={{ color: 'var(--panel-accent)' }}
            >
              Source code
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>

            <DialogFooter>
              {firstRun ? (
                <button
                  type="button"
                  onClick={acknowledge}
                  className="zatom-pressable inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-4 text-xs font-semibold"
                  style={{ background: 'var(--control-primary-bg)', color: 'var(--control-primary-text)' }}
                >
                  <Check className="h-4 w-4" aria-hidden />
                  I understand, continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="zatom-pressable min-h-9 rounded-lg px-4 text-xs font-semibold"
                  style={{ background: 'var(--control-primary-bg)', color: 'var(--control-primary-text)' }}
                >
                  Done
                </button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
