import { useRef, useState } from 'react'
import {
  Activity,
  Archive,
  Box,
  Download,
  Loader2,
  ShieldCheck,
  Upload,
  Workflow,
} from 'lucide-react'

import { listZatomAgentTools } from '../../agent/tools'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui-kit/dialog'
import {
  parseAgentModelingProjectBundle,
  ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES,
  type AgentModelingProjectBundle,
} from './agent-modeling-project-bundle'
import {
  captureAgentModelingProjectBundle,
  replaceAgentModelingProjectBundle,
} from './agent-modeling-project-runtime'

interface PendingProject {
  project: AgentModelingProjectBundle
  fileName: string
}

export function AgentModelingProjectTransfer({
  activeAtomCount,
  busy,
}: {
  activeAtomCount: number
  busy: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingProject | null>(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const exportProject = () => {
    try {
      const project = captureAgentModelingProjectBundle()
      const payload = JSON.stringify(project)
      const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `zatom-project-${project.fingerprint.replace(':', '-')}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      setNotice(`Exported ${project.workspace.structure.atoms.length.toLocaleString()} atoms, ${project.history?.runs.length ?? 0} runs, and ${project.task ? 'one stable Task' : 'no Task'}.`)
      setError(null)
    } catch (cause) {
      setNotice(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const stageProject = async (file: File) => {
    setNotice(null)
    setError(null)
    try {
      if (file.size > ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES) {
        throw new Error(`Project is ${file.size} bytes; the limit is ${ZATOM_AGENT_MODELING_PROJECT_BUNDLE_MAX_BYTES} bytes`)
      }
      const project = parseAgentModelingProjectBundle(
        JSON.parse(await file.text()) as unknown,
        listZatomAgentTools(),
      )
      setPending({ project, fileName: file.name })
    } catch (cause) {
      setPending(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importProject = async () => {
    if (!pending || importing) return
    setImporting(true)
    try {
      const imported = await replaceAgentModelingProjectBundle(pending.project)
      setNotice(`Restored ${imported.workspace.structure.atoms.length.toLocaleString()} atoms, ${imported.history?.runs.length ?? 0} runs, and ${imported.task ? imported.task.plan.title : 'no active Task'} from ${pending.fileName}.`)
      setError(null)
      setPending(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <section aria-labelledby="agent-project-transfer-title" className="rounded-xl p-3" style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-elevated)' }}>
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ color: 'var(--control-selected-text)', background: 'var(--control-selected-bg)', border: '1px solid var(--control-selected-border)' }}>
            <Archive className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 id="agent-project-transfer-title" style={{ fontSize: 12, fontWeight: 650, color: 'var(--panel-text)' }}>Modeling project</h3>
            <p className="mt-1" style={{ fontSize: 10, lineHeight: 1.5, color: 'var(--panel-text-secondary)' }}>
              Carry the active canonical structure and trajectory together with exact runs, visual evidence, and one stable Task.
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Choose zatom modeling project"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) void stageProject(file)
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy || importing}
            onClick={() => inputRef.current?.click()}
            className="zatom-pressable flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
          >
            <Upload className="h-3.5 w-3.5" /> Import project
          </button>
          <button
            type="button"
            disabled={busy || importing || activeAtomCount === 0}
            onClick={exportProject}
            className="zatom-pressable flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: 'var(--panel-text)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            title={activeAtomCount ? 'Export the complete verified project boundary' : 'Load or build a structure first'}
          >
            <Download className="h-3.5 w-3.5" /> Export project
          </button>
        </div>
        {notice ? (
          <p className="mt-3 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" role="status" aria-live="polite" style={{ color: 'var(--status-green)', background: 'var(--status-green-bg)', border: '1px solid var(--status-green-border)' }}>{notice}</p>
        ) : null}
        {error ? (
          <p className="mt-3 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" role="alert" style={{ color: 'var(--status-red)', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)' }}>{error}</p>
        ) : null}
      </section>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !importing) setPending(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace the current modeling project?</DialogTitle>
            <DialogDescription>
              This project passed complete fingerprint and nested-artifact replay. Import replaces the active canonical workspace, saved runs, and current stable Task. It never merges or rewrites identities.
            </DialogDescription>
          </DialogHeader>
          {pending ? (
            <div className="grid grid-cols-2 gap-2 py-1">
              <div className="rounded-lg p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--panel-text-tertiary)' }}><Box className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold uppercase">Workspace</span></div>
                <div className="mt-1.5 text-[11px] font-semibold" style={{ color: 'var(--panel-text)' }}>{pending.project.workspace.structure.atoms.length.toLocaleString()} atoms</div>
                <div className="mt-0.5 text-[9px]" style={{ color: 'var(--panel-text-secondary)' }}>{pending.project.workspace.trajectory?.frames.length ?? 0} trajectory frames</div>
              </div>
              <div className="rounded-lg p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--panel-text-tertiary)' }}><Activity className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold uppercase">Evidence</span></div>
                <div className="mt-1.5 text-[11px] font-semibold" style={{ color: 'var(--panel-text)' }}>{pending.project.history?.runs.length ?? 0} complete runs</div>
                <div className="mt-0.5 text-[9px]" style={{ color: 'var(--panel-text-secondary)' }}>Images remain identity-bound</div>
              </div>
              <div className="col-span-2 rounded-lg p-2.5" style={{ background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}>
                <div className="flex items-center gap-1.5" style={{ color: 'var(--panel-text-tertiary)' }}><Workflow className="h-3.5 w-3.5" /><span className="text-[9px] font-semibold uppercase">Task</span></div>
                <div className="mt-1.5 truncate text-[11px] font-semibold" title={pending.project.task?.plan.title} style={{ color: 'var(--panel-text)' }}>{pending.project.task?.plan.title ?? 'No active Task'}</div>
                <div className="mt-0.5 text-[9px]" style={{ color: 'var(--panel-text-secondary)' }}>{pending.project.task?.status ?? 'workspace only'} · {pending.fileName}</div>
              </div>
              <code className="col-span-2 truncate rounded-lg px-2.5 py-2 text-[9px]" title={pending.project.fingerprint} style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)' }}>
                {pending.project.fingerprint}
              </code>
            </div>
          ) : null}
          <div className="flex items-start gap-2 rounded-lg p-2.5 text-[10px] leading-relaxed" style={{ color: 'var(--status-amber)', background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' }}>
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Current unsaved workspace state is replaced only after you confirm.
          </div>
          <DialogFooter>
            <button
              type="button"
              disabled={importing}
              onClick={() => { setPending(null);  }}
              className="zatom-pressable min-h-10 rounded-lg px-4 text-[12px] font-semibold disabled:opacity-40"
              style={{ color: 'var(--panel-text-secondary)', background: 'var(--panel-elevated)', border: '1px solid var(--panel-border)' }}
            >
              Keep current project
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => { void importProject() }}
              className="zatom-pressable flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-4 text-[12px] font-semibold disabled:cursor-wait disabled:opacity-70"
              style={{ color: 'var(--status-amber)', background: 'var(--status-amber-bg)', border: '1px solid var(--status-amber-border)' }}
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {importing ? 'Replacing…' : 'Replace project'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
