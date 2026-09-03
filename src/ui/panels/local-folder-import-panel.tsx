"use client"

/**
 * Persistent local-folder source for Assets. Directories load lazily when
 * expanded so large trees do not block the interface or read unopened folders.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, CheckCircle, ChevronRight, FileText, Folder, FolderOpen, Loader2, Plug, Unplug } from "lucide-react"
import {
  bindLocalDirectory,
  clearLocalDirectoryBinding,
  createSessionLocalDirectoryBinding,
  getActiveLocalDirectoryBinding,
  isLocalDirectoryBindingSupported,
  isPersistentLocalDirectoryBindingSupported,
  isSessionLocalDirectoryBindingSupported,
  listLocalDirectory,
  readRememberedBinding,
  reconnectLocalDirectory,
  setActiveLocalDirectoryBinding,
  type LocalDirectoryBinding,
  type LocalDirectoryListing,
} from "../../host/localDirectoryBinding"
import { mountLocalStructureFile } from "../../services/local-structure-file"
import { writeActiveViewportStructure } from "../../agent/viewer-context"
import { useStructureAssetRecorder } from "../structure-asset-context"

type Notice = { type: "idle" } | { type: "success" | "error"; message: string }

const DIRECTORY_INPUT_ATTRIBUTES = { webkitdirectory: "" } as Record<string, string>

function localFileBadge(fileName: string, route: string): string {
  if (route === "poscar") return "VASP"
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".cub") || lower.endsWith(".cube")) return "CUBE"
  if (lower.endsWith(".molden") || lower.endsWith(".mld")) return "MOLDEN"
  if (lower.endsWith(".cif") || lower.endsWith(".mcif")) return "CIF"
  if (lower.endsWith(".xyz") || lower.endsWith(".extxyz")) return "XYZ"
  if (lower.endsWith(".mol")) return "MOL"
  if (lower.endsWith(".pdb") || lower.endsWith(".ent")) return "PDB"
  return "TRAJ"
}

function NoticeBar({ notice }: { notice: Notice }) {
  if (notice.type === "idle") return null
  const ok = notice.type === "success"
  return (
    <div
      role={ok ? "status" : "alert"}
      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11px]"
      style={{
        backgroundColor: ok ? "var(--status-green-bg)" : "var(--status-red-bg)",
        color: ok ? "var(--status-green)" : "var(--status-red)",
      }}
    >
      {ok ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 break-words">{notice.message}</span>
    </div>
  )
}

/** One directory level, loaded on expansion and cached after collapse. */
function DirectoryLevel({
  handle,
  depth,
  onMount,
  mountingPath,
  pathPrefix,
}: {
  handle: FileSystemDirectoryHandle
  depth: number
  onMount: (fileHandle: FileSystemFileHandle, path: string) => void
  mountingPath: string | null
  pathPrefix: string
}) {
  const [listing, setListing] = useState<LocalDirectoryListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listLocalDirectory(handle)
      .then((next) => {
        if (!cancelled) {
          setListing(next)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [handle])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-2 text-[10px] text-[var(--panel-text-tertiary)]">
        <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
        <span>Reading folder…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="py-1.5 pl-2 text-[10px]" style={{ color: "var(--status-red)" }}>
        {error}
      </div>
    )
  }

  if (!listing) return null

  const empty = listing.directories.length === 0 && listing.files.length === 0

  return (
    <ul className="list-none" style={{ paddingLeft: depth === 0 ? 0 : 10 }}>
      {listing.directories.map((directory) => {
        const open = expanded[directory.name] ?? false
        return (
          <li key={`dir:${directory.name}`}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded((current) => ({ ...current, [directory.name]: !open }))}
              className="zatom-pressable flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[11px] text-[var(--panel-text-secondary)]"
            >
              <ChevronRight
                className="h-3 w-3 shrink-0 text-[var(--panel-text-tertiary)] transition-transform duration-150 ease-out motion-reduce:transition-none"
                style={{ transform: open ? "rotate(90deg)" : "none" }}
              />
              {open
                ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--panel-accent)]" />
                : <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--panel-text-tertiary)]" />}
              <span className="min-w-0 truncate">{directory.name}</span>
            </button>
            {open ? (
              <DirectoryLevel
                handle={directory.handle}
                depth={depth + 1}
                onMount={onMount}
                mountingPath={mountingPath}
                pathPrefix={`${pathPrefix}${directory.name}/`}
              />
            ) : null}
          </li>
        )
      })}

      {listing.files.map((file) => {
        const path = `${pathPrefix}${file.name}`
        const busy = mountingPath === path
        return (
          <li key={`file:${file.name}`}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMount(file.handle, path)}
              className="zatom-pressable flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[11px] text-[var(--panel-text-primary)] disabled:opacity-60"
            >
              <span className="w-3 shrink-0" />
              {busy
                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-[var(--panel-accent)]" />
                : <FileText className="h-3.5 w-3.5 shrink-0 text-[var(--panel-text-tertiary)]" />}
              <span className="min-w-0 truncate">{file.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[8px] uppercase tracking-wide text-[var(--panel-text-tertiary)]">
                {localFileBadge(file.name, file.route)}
              </span>
            </button>
          </li>
        )
      })}

      {empty ? (
        <li className="py-1.5 pl-2 text-[10px] text-[var(--panel-text-tertiary)]">No structure files here</li>
      ) : null}

      {listing.skippedFileCount > 0 ? (
        <li className="py-1 pl-2 text-[9px] text-[var(--panel-text-tertiary)]">
          {listing.skippedFileCount} other file{listing.skippedFileCount === 1 ? "" : "s"} hidden
        </li>
      ) : null}
    </ul>
  )
}

export function LocalFolderImportPanel() {
  const persistentSupported = isPersistentLocalDirectoryBindingSupported()
  const sessionSupported = isSessionLocalDirectoryBindingSupported()
  const supported = isLocalDirectoryBindingSupported()
  const [binding, setBinding] = useState<LocalDirectoryBinding | null>(() => getActiveLocalDirectoryBinding())
  const [rememberedName, setRememberedName] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>({ type: "idle" })
  const [mountingPath, setMountingPath] = useState<string | null>(null)
  const recordStructureAsset = useStructureAssetRecorder()
  const sessionFolderInputRef = useRef<HTMLInputElement | null>(null)
  const folderChoiceRevisionRef = useRef(0)

  useEffect(() => {
    if (!persistentSupported || getActiveLocalDirectoryBinding()) return
    let cancelled = false
    const choiceRevision = folderChoiceRevisionRef.current
    void readRememberedBinding().then((state) => {
      if (cancelled || choiceRevision !== folderChoiceRevisionRef.current || getActiveLocalDirectoryBinding()) return
      if (state.status === "granted") setBinding(state.binding)
      else if (state.status === "needs-reconnect") setRememberedName(state.name)
    })
    return () => {
      cancelled = true
    }
  }, [persistentSupported])

  // Publish to the module registry the agent tools read. Done in one effect
  // keyed on `binding` so every path that changes it — initial restore, bind,
  // reconnect, unbind — stays in sync without each call site remembering to.
  // Deliberately not cleared on panel unmount. Switching from Assets > Folder
  // to the viewport must not revoke a permission the user just granted; the
  // explicit Unbind action below is the revocation boundary. The module itself
  // goes away on document navigation, matching WebMCP's lifetime.
  useEffect(() => {
    setActiveLocalDirectoryBinding(binding)
  }, [binding])

  const handleMount = useCallback(
    (fileHandle: FileSystemFileHandle, path: string) => {
      setMountingPath(path)
      setNotice({ type: "idle" })
      void (async () => {
        try {
          const file = await fileHandle.getFile()
          const result = await mountLocalStructureFile(file, writeActiveViewportStructure)
          if (!result.ok) {
            setNotice({ type: "error", message: result.message })
            return
          }
          setNotice({ type: "success", message: result.message })
          recordStructureAsset(file.name, "import")
        } catch (cause) {
          setNotice({ type: "error", message: cause instanceof Error ? cause.message : String(cause) })
        } finally {
          setMountingPath(null)
        }
      })()
    },
    [recordStructureAsset],
  )

  const choosePersistentFolder = () => {
    const choiceRevision = ++folderChoiceRevisionRef.current
    void (async () => {
      try {
        const next = rememberedName ? await reconnectLocalDirectory() : await bindLocalDirectory()
        if (choiceRevision !== folderChoiceRevisionRef.current) return
        if (!next) {
          setNotice({ type: "error", message: "Folder access was not granted. Choose a folder for this tab instead." })
          return
        }
        setBinding(next)
        setRememberedName(null)
        setNotice(next.persistence === "session"
          ? { type: "success", message: "Folder opened for this tab; browser storage could not remember it." }
          : { type: "idle" })
      } catch (cause) {
        // User cancellation is not a failure and must preserve any existing binding.
        if (cause instanceof DOMException && cause.name === "AbortError") return
        setNotice({
          type: "error",
          message: `${cause instanceof Error ? cause.message : String(cause)} Choose a folder for this tab instead.`,
        })
      }
    })()
  }

  if (!supported) {
    return (
      <div className="space-y-2">
        <div
          className="rounded-xl px-3 py-3 text-[11px] leading-relaxed text-[var(--panel-text-secondary)]"
          style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}
        >
          This browser cannot select a local folder. Use the single-file import in the other tabs instead.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {binding ? (
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-[var(--panel-text-primary)]">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--panel-accent)]" />
            <span className="min-w-0 truncate font-medium">{binding.name}</span>
            <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-[var(--panel-text-tertiary)]" style={{ background: "var(--panel-bg)" }}>
              {binding.persistence === "persistent" ? "remembered" : "this tab"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const current = binding
              folderChoiceRevisionRef.current += 1
              void (async () => {
                let forgetWarning: string | null = null
                try {
                  if (current.persistence === "session") {
                    setActiveLocalDirectoryBinding(null)
                  } else {
                    await clearLocalDirectoryBinding()
                  }
                } catch {
                  // clearLocalDirectoryBinding drops the live handle before it
                  // touches IndexedDB. Keep the UI truthful even if forgetting
                  // the cross-visit record failed.
                  setActiveLocalDirectoryBinding(null)
                  forgetWarning = "Folder disconnected from this tab, but the browser could not remove its remembered entry."
                }
                setBinding(null)
                const remembered = current.persistence === "session"
                  ? await readRememberedBinding().catch(() => ({ status: "none" as const }))
                  : { status: "none" as const }
                setRememberedName(remembered.status === "needs-reconnect"
                  ? remembered.name
                  : remembered.status === "granted" ? remembered.binding.name : null)
                setNotice(forgetWarning ? { type: "error", message: forgetWarning } : { type: "idle" })
              })()
            }}
            className="zatom-pressable flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-[var(--panel-text-secondary)]"
          >
            <Unplug className="h-3 w-3" />
            Unbind
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            ref={sessionFolderInputRef}
            type="file"
            multiple
            {...DIRECTORY_INPUT_ATTRIBUTES}
            className="hidden"
            aria-label="Choose a local folder for this tab"
            onChange={(event) => {
              folderChoiceRevisionRef.current += 1
              const files = event.currentTarget.files
              const selectedCount = files?.length ?? 0
              const next = files ? createSessionLocalDirectoryBinding(files) : null
              event.currentTarget.value = ""
              if (!next) {
                if (selectedCount > 0) setNotice({ type: "error", message: "That folder contains no supported Zatom files." })
                return
              }
              setBinding(next)
              setRememberedName(null)
              setNotice({
                type: "success",
                message: `${next.supportedFileCount ?? 0} supported files are available to Zatom in this tab.`,
              })
            }}
          />
          <button
            type="button"
            onClick={() => sessionSupported ? sessionFolderInputRef.current?.click() : choosePersistentFolder()}
            className="group w-full cursor-pointer rounded-xl p-4 text-center transition-[background-color,border-color] duration-150 ease-out"
            style={{
              backgroundColor: "var(--panel-elevated)",
              border: "1px dashed var(--panel-border)",
            }}
          >
            <Folder className="mx-auto mb-1.5 h-4 w-4 text-[var(--panel-text-tertiary)] transition-colors group-hover:text-[var(--control-selected-text)]" />
            <span className="block text-[11px] text-[var(--panel-text-secondary)]">Choose a local folder</span>
            <span className="mt-1 block text-[9px] text-[var(--panel-text-tertiary)]">Works in this tab without persistent folder permission</span>
            <span className="mt-1.5 block font-mono text-[8px] leading-4 text-[var(--panel-text-tertiary)]">
              CIF · XYZ · MOL · PDB · VASP · CUBE · MOLDEN · TRAJECTORY
            </span>
          </button>
          {persistentSupported ? (
            <button
              type="button"
              onClick={choosePersistentFolder}
              className="zatom-pressable flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg px-2 text-[10px] text-[var(--panel-text-secondary)]"
              style={{ border: "1px solid var(--panel-border)", background: "var(--panel-bg)" }}
            >
              <Plug className="h-3 w-3" />
              {rememberedName ? `Reconnect ${rememberedName}` : "Remember a folder between visits"}
            </button>
          ) : null}
        </div>
      )}

      {binding ? (
        <div
          className="max-h-64 overflow-y-auto rounded-xl px-1.5 py-1"
          style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}
        >
          <DirectoryLevel
            handle={binding.handle}
            depth={0}
            onMount={handleMount}
            mountingPath={mountingPath}
            pathPrefix=""
          />
        </div>
      ) : null}

      <NoticeBar notice={notice} />
    </div>
  )
}
