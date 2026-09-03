"use client"

import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { AlertCircle, CheckCircle, Loader2, Plus, Search, Trash2, Upload, X } from "lucide-react"
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui-kit/context-menu"
import { BIOMOLECULE_TRAJECTORY_EXAMPLES, RCSB_BIOMOLECULE_EXAMPLES } from "../../lib/biomolecule/examples"
import { parseMolfile, molfileToCrystalStructure } from "../../lib/molecule/molfile"
import {
  badgeColor,
  catalogRemoval,
  filterModelCatalog,
  loadModelCatalogEntry,
  useModelCatalog,
} from "./model-catalog"
import { useInstalledTemplatesStore } from "../../orchestration/installedTemplatesStore"
import { useActiveCrystalStore as useCrystalStore } from "../../orchestration/ViewportContext"
import {
  loadMaterialsProjectMaterial,
  materialsProjectMaterialToCIF,
  searchMaterialsProject,
  type MaterialsProjectSearchResult,
} from "../../services/materials-project"
import {
  loadPubChemCompound,
  searchPubChemCompounds,
  type PubChemSearchResult,
} from "../../services/pubchem"
import { useStructureAssetRecorder } from "../structure-asset-context"
import { SlidingSegmented, type SlidingSegmentedOption } from "./panel-ui"
import {
  STRUCTURE_IMPORT_CATEGORIES,
  type StructureImportCategory,
} from "./structure-import-categories"

/** Load prediction services only after the user opens Predict & design. */
const BoltzPanel = lazy(() =>
  import("./boltz-panel").then((module) => ({ default: module.BoltzPanel }))
)

type ImportStatus = { type: "idle" | "success" | "error"; message?: string }

const MATERIAL_EXTENSIONS = [".cif", ".poscar"] as const
const MOLECULE_EXTENSIONS = [".xyz", ".mol"] as const
const BIOMOLECULE_EXTENSIONS = [".pdb"] as const
const ALL_IMPORT_EXTENSIONS = [...MATERIAL_EXTENSIONS, ...MOLECULE_EXTENSIONS, ...BIOMOLECULE_EXTENSIONS] as const

function StatusNotice({ status }: { status: ImportStatus }) {
  if (status.type === "idle") return null
  return (
    <div
      role={status.type === "error" ? "alert" : "status"}
      className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[11px]"
      style={{
        backgroundColor: status.type === "success" ? "var(--status-green-bg)" : "var(--status-red-bg)",
        color: status.type === "success" ? "var(--status-green)" : "var(--status-red)",
      }}
    >
      {status.type === "success"
        ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
        : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
      <span>{status.message}</span>
    </div>
  )
}

function FileImportDropzone({
  extensions,
  setStatus,
}: {
  extensions: readonly string[]
  setStatus: (status: ImportStatus) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordStructureAsset = useStructureAssetRecorder()
  const accept = extensions.join(",")

  const handleFile = useCallback(async (file: File) => {
    const lowerName = file.name.toLowerCase()
    if (!extensions.some((extension) => lowerName.endsWith(extension))) {
      setStatus({ type: "error", message: `Choose ${extensions.join(", ")} for this category.` })
      return
    }
    setStatus({ type: "idle" })
    try {
      const { importUnifiedStructureFile } = await import("../../services/unified-file-import")
      const result = await importUnifiedStructureFile(file)
      if (!result.success) {
        setStatus({ type: "error", message: result.error })
        return
      }
      setStatus({ type: "success", message: result.message })
      recordStructureAsset(file.name, "import")
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Read failed" })
    }
  }, [extensions, recordStructureAsset, setStatus])

  return (
    <>
      <button
        type="button"
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
        onClick={() => fileInputRef.current?.click()}
        className="group w-full cursor-pointer rounded-xl p-4 text-center transition-[background-color,border-color] duration-150 ease-out"
        style={{
          backgroundColor: isDragging ? "var(--control-selected-bg)" : "var(--panel-elevated)",
          border: `1px ${isDragging ? "solid" : "dashed"} ${isDragging ? "var(--control-selected-border)" : "var(--panel-border)"}`,
        }}
      >
        <Upload className="mx-auto mb-1.5 h-4 w-4 text-[var(--panel-text-tertiary)] transition-colors group-hover:text-[var(--control-selected-text)]" />
        <span className="block text-[11px] text-[var(--panel-text-secondary)]">Drop file or click to browse</span>
        <span className="mt-1 block font-mono text-[9px] text-[var(--panel-text-tertiary)]">{extensions.join("  ")}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleFile(file)
          event.target.value = ""
        }}
      />
    </>
  )
}

export function StructureFileImportDropzone() {
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" })
  return (
    <div className="space-y-2">
      <FileImportDropzone extensions={ALL_IMPORT_EXTENSIONS} setStatus={setStatus} />
      <StatusNotice status={status} />
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--panel-text-tertiary)]">{children}</div>
}

function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder,
  searching,
  label,
  canSubmit = Boolean(value.trim()),
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder: string
  searching: boolean
  label: string
  canSubmit?: boolean
}) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); onSubmit() }} className="relative">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--panel-text-tertiary)]" />
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        disabled={searching}
        className="zatom-field w-full rounded-xl py-2.5 pl-9 pr-9 text-[11px] disabled:opacity-60"
      />
      {searching
        ? <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin motion-reduce:animate-none text-[var(--panel-accent)]" />
        : <button type="submit" disabled={!canSubmit} className="zatom-pressable absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-[9px] font-semibold text-[var(--panel-text-secondary)] disabled:opacity-30">Go</button>}
    </form>
  )
}

function BlankStructureButton({ periodic, label }: { periodic: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        const store = useCrystalStore.getState()
        store.clearStructure()
        store.setBuilderMode("structure")
        store.setPeriodic(periodic)
        store.setToolMode("add-atom")
      }}
      className="zatom-pressable flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[11px] transition-colors duration-150 ease-out hover:bg-[var(--panel-elevated)]"
      style={{ border: "1px dashed var(--panel-border-focus)", color: "var(--panel-text-secondary)" }}
    >
      <Plus className="h-3.5 w-3.5" /> {label}
    </button>
  )
}

/**
 * One model in a Templates grid.
 *
 * The remove affordance is a sibling of the load button rather than nested
 * inside it: a button inside a button is invalid markup, and the browser would
 * fire the load click on its way to the ✕. So the card is a plain container and
 * the two actions sit side by side, each with its own hit area.
 *
 * The ✕ appears on hover and on keyboard focus (`focus-within`), never
 * hover-only — otherwise removal would be unreachable without a pointer.
 */
function TemplateCard({
  badge,
  badgeKey = badge,
  title,
  format,
  onClick,
  disabled = false,
  tooltip,
  wideBadge = false,
  onRemove,
  removeLabel,
  confirmWord,
}: {
  badge: string
  badgeKey?: string
  title: string
  format: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
  wideBadge?: boolean
  onRemove?: () => void
  removeLabel?: string
  confirmWord?: string
}) {
  /**
   * The confirm step lives inside the card, replacing its own face for the one
   * card being removed. It used to be a full-screen modal over a dimmed grid:
   * an overlay, a sentence of prose and two buttons to dismiss one 20px ✕. That
   * cost the whole panel's composure for a single-cell decision, and the dimming
   * hid the very card you were trying to identify.
   *
   * In-card is also more honest about scope: the thing that will disappear is
   * what is asking, so the target needs no describing. That is why the copy is
   * one word — the card supplies the noun, the button supplies the verb.
   */
  const [confirming, setConfirming] = useState(false)

  return (
    <ContextMenuRoot>
    <ContextMenuTrigger asChild>
    <div
      className="group relative flex min-w-0 rounded-xl transition-colors duration-150 ease-out focus-within:border-[var(--panel-border-focus)] hover:bg-[var(--panel-hover)]"
      style={{
        backgroundColor: confirming ? "var(--status-red-bg)" : "var(--panel-elevated)",
        border: `1px solid ${confirming ? "var(--status-red)" : "var(--panel-border)"}`,
      }}
      // Escape backs out, matching the modal it replaces.
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming) {
          event.stopPropagation()
          setConfirming(false)
        }
      }}
    >
      {confirming && onRemove ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 p-2.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--status-red)]">
            {confirmWord ?? "Delete"}?
          </span>
          {/* Focus starts on the safe choice, so a stray Enter cannot destroy anything. */}
          <button
            type="button"
            autoFocus
            onClick={() => setConfirming(false)}
            className="zatom-pressable shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-[var(--panel-text-secondary)] hover:bg-[var(--panel-elevated)]"
          >
            Cancel
          </button>
          <button
            type="button"
            aria-label={removeLabel ?? `Remove ${title}`}
            onClick={() => {
              setConfirming(false)
              onRemove()
            }}
            className="zatom-pressable shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: "var(--status-red)", color: "var(--badge-fg)" }}
          >
            {confirmWord ?? "Delete"}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            title={tooltip}
            disabled={disabled}
            onClick={onClick}
            className="zatom-pressable flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2.5 text-left disabled:opacity-40"
          >
            <span
              className={`flex h-7 ${wideBadge ? "w-10 text-[9px]" : "w-7 text-[11px]"} shrink-0 items-center justify-center rounded-lg font-bold`}
              style={{ backgroundColor: badgeColor(badgeKey), color: "var(--badge-fg)" }}
            >
              {badge}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-[var(--panel-text)]">{title}</span>
              <span className="mt-0.5 block truncate font-mono text-[8px] text-[var(--panel-text-tertiary)]">{format}</span>
            </span>
          </button>
          {onRemove && (
            <button
              type="button"
              aria-label={removeLabel ?? `Remove ${title}`}
              title={removeLabel ?? `Remove ${title}`}
              onClick={() => setConfirming(true)}
              className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md text-[var(--panel-text-tertiary)] opacity-0 transition-[opacity,color,background-color] duration-150 ease-out hover:bg-[var(--status-red-bg)] hover:text-[var(--status-red)] focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </>
      )}
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuLabel>{format}</ContextMenuLabel>
      <ContextMenuItem icon={<Upload />} disabled={disabled} onSelect={onClick}>
        {tooltip ?? "Load structure"}
      </ContextMenuItem>
      {onRemove && (
        <>
          <ContextMenuSeparator />
          {/* Routes into the same in-card confirm the ✕ uses. A context-menu
              click is deliberate but not undoable, so it must not get a weaker
              safety rail than the button sitting two pixels away. */}
          <ContextMenuItem icon={<Trash2 />} destructive onSelect={() => setConfirming(true)}>
            {confirmWord ?? "Delete"}
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
    </ContextMenuRoot>
  )
}

/** Below this count the grid is scannable at a glance and a filter is just clutter. */
const TEMPLATE_FILTER_THRESHOLD = 6

/**
 * Both template grids read the shared catalog and load through
 * `loadModelCatalogEntry`, the same path Assets ▸ Store uses. The grids differ
 * from the Store only in what they show: the Model Market's installed subset
 * rather than the whole library.
 *
 * Two things the Store does not do. First, the molecule grid also lists
 * structures the user saved from the 2D editor: those are `kind: "user"` and
 * carry no `installedId`, so the installed-subset test below deliberately does
 * not apply to them — the Model Market curates what ships with the app, not the
 * user's own work. Second, the catalog now comes from `useModelCatalog` rather
 * than the static constant, so a structure saved in the 2D editor appears here
 * immediately instead of on the next remount.
 */
function TemplateGrid({ kind }: { kind: "crystal" | "molecule" }) {
  const catalog = useModelCatalog()
  const installed = useInstalledTemplatesStore((state) => state.installed)
  const recordStructureAsset = useStructureAssetRecorder()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" })

  const available = catalog.filter((item) => {
    if (item.kind === "user") return kind === "molecule"
    return item.kind === kind && item.installedId !== undefined && installed.has(item.installedId)
  })
  const entries = filterModelCatalog(available, query)

  return (
    <div className="space-y-2">
      {available.length > TEMPLATE_FILTER_THRESHOLD && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--panel-text-tertiary)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={`Filter ${available.length} templates…`}
            aria-label={`Filter ${kind} templates`}
            className="zatom-field w-full rounded-lg py-1.5 pl-7 pr-2 text-[10px]"
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {entries.map((item) => {
          const removal = catalogRemoval(item)
          return (
            <TemplateCard
              key={item.id}
              badge={item.badge}
              badgeKey={item.badgeKey}
              title={item.name}
              format={item.format}
              onClick={() => {
                void (async () => {
                  const outcome = await loadModelCatalogEntry(item)
                  if (!outcome.ok || !outcome.asset) return
                  recordStructureAsset(outcome.asset.name, outcome.asset.source)
                })()
              }}
              onRemove={
                removal
                  ? () => {
                      removal.apply()
                      setStatus({ type: "success", message: removal.done })
                    }
                  : undefined
              }
              removeLabel={
                item.origin === "user" ? `Delete ${item.name}` : `Hide ${item.name} from Templates`
              }
              // A bundled model is only hidden and can be reinstalled; a saved
              // structure is the user's only copy. The verb carries that.
              confirmWord={item.origin === "user" ? "Delete" : "Hide"}
            />
          )
        })}
      </div>
      {entries.length === 0 && (
        <p className="px-1 text-[10px] text-[var(--panel-text-tertiary)]">
          {query ? `No template matches “${query}”.` : "No templates installed."}
        </p>
      )}
      <StatusNotice status={status} />
    </div>
  )
}

function CrystalGrid() {
  return <TemplateGrid kind="crystal" />
}

function MoleculeGrid() {
  return <TemplateGrid kind="molecule" />
}

function MaterialsImportPanel() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MaterialsProjectSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" })
  const recordStructureAsset = useStructureAssetRecorder()

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    setStatus({ type: "idle" })
    try {
      setResults(await searchMaterialsProject(query.trim()))
    } catch (error) {
      setResults([])
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Materials Project search failed" })
    } finally {
      setSearching(false)
    }
  }

  const load = async (materialId: string) => {
    setSearching(true)
    setStatus({ type: "idle" })
    try {
      const material = await loadMaterialsProjectMaterial(materialId)
      if (!material) throw new Error(`Material ${materialId} was not returned`)
      const store = useCrystalStore.getState()
      store.setBuilderMode("structure")
      store.setPeriodic(true)
      const result = await store.loadFromCIF(materialsProjectMaterialToCIF(material))
      if (!result.success) throw new Error(result.error)
      recordStructureAsset(material.materialId, "search")
      setStatus({ type: "success", message: `Loaded ${material.materialId}` })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Material import failed" })
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-3">
      <SectionHeading>Materials Project</SectionHeading>
      <SearchField value={query} onChange={setQuery} onSubmit={() => void search()} placeholder="Formula · Si, Fe2O3…" searching={searching} label="Search Materials Project" />
      {searched && !searching && results.length === 0 && status.type !== "error" && <p className="px-1 text-[10px] text-[var(--panel-text-tertiary)]">No materials found.</p>}
      {results.length > 0 && (
        <ul className="max-h-52 space-y-1 overflow-y-auto" aria-label="Materials Project results">
          {results.map((result) => (
            <li key={result.materialId}>
              <button type="button" disabled={searching} onClick={() => void load(result.materialId)} className="zatom-pressable flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--panel-elevated)] disabled:opacity-50">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--control-selected-text)]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-[var(--panel-text)]">{result.formulaPretty}</span><span className="block text-[9px] text-[var(--panel-text-tertiary)]">{result.materialId}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <StatusNotice status={status} />
      <SectionHeading>Templates</SectionHeading>
      <CrystalGrid />
      <BlankStructureButton periodic label="Blank material" />
    </div>
  )
}

function MoleculesImportPanel() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PubChemSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" })
  const recordStructureAsset = useStructureAssetRecorder()

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    setStatus({ type: "idle" })
    try {
      setResults(await searchPubChemCompounds(query.trim()))
    } catch (error) {
      setResults([])
      setStatus({ type: "error", message: error instanceof Error ? error.message : "PubChem search failed" })
    } finally {
      setSearching(false)
    }
  }

  const load = async (cid: number) => {
    setSearching(true)
    setStatus({ type: "idle" })
    try {
      const compound = await loadPubChemCompound(cid)
      if (!compound?.molfile) throw new Error(`CID ${cid} has no 3D molfile`)
      const structure = molfileToCrystalStructure(parseMolfile(compound.molfile))
      const store = useCrystalStore.getState()
      store.setBuilderMode("structure")
      store.setPeriodic(false)
      store.replaceAtomsDirectly(structure.atoms)
      store.setBondsDirectly(structure.bonds)
      store.autoDetectBonds()
      recordStructureAsset(compound.title || `CID ${cid}`, "search")
      setStatus({ type: "success", message: `Loaded ${compound.title || `CID ${cid}`}` })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Compound import failed" })
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-3">
      <SectionHeading>PubChem</SectionHeading>
      <SearchField value={query} onChange={setQuery} onSubmit={() => void search()} placeholder="Name · aspirin, benzene…" searching={searching} label="Search PubChem" />
      {searched && !searching && results.length === 0 && status.type !== "error" && <p className="px-1 text-[10px] text-[var(--panel-text-tertiary)]">No compounds found.</p>}
      {results.length > 0 && (
        <ul className="max-h-52 space-y-1 overflow-y-auto" aria-label="PubChem results">
          {results.map((result) => (
            <li key={result.cid}>
              <button type="button" disabled={searching} onClick={() => void load(result.cid)} className="zatom-pressable flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--panel-elevated)] disabled:opacity-50">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--control-selected-text)]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-[var(--panel-text)]">{result.title || result.formula}</span><span className="block text-[9px] text-[var(--panel-text-tertiary)]">CID {result.cid}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <StatusNotice status={status} />
      <SectionHeading>Templates</SectionHeading>
      <MoleculeGrid />
      <BlankStructureButton periodic={false} label="Blank molecule" />
    </div>
  )
}

type MacromoleculeMode = "fetch" | "predict"

/** Parallel actions: retrieve an existing structure or predict a new one. */
const MACROMOLECULE_MODES: readonly SlidingSegmentedOption<MacromoleculeMode>[] = [
  { value: "fetch", label: "Fetch" },
  { value: "predict", label: "Predict & design" },
]

/**
 * Switches macromolecule acquisition modes. Render only the active child so
 * prediction code remains lazy; ResizeObserver handles the resulting height change.
 */
function MacromoleculesImportPanel() {
  const [mode, setMode] = useState<MacromoleculeMode>("fetch")

  return (
    <div className="space-y-3">
      <SlidingSegmented
        options={MACROMOLECULE_MODES}
        value={mode}
        onChange={setMode}
        ariaLabel="Macromolecule workflow"
        semantics="tabs"
        gentleMotion
      />
      {mode === "fetch" ? (
        <MacromoleculesFetchPanel />
      ) : (
        <Suspense
          fallback={
            <p className="flex items-center gap-2 px-1 text-[10px] text-[var(--panel-text-tertiary)]">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Loading prediction tools…
            </p>
          }
        >
          <BoltzPanel />
        </Suspense>
      )}
    </div>
  )
}

function MacromoleculesFetchPanel() {
  const [pdbId, setPdbId] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<ImportStatus>({ type: "idle" })
  const recordStructureAsset = useStructureAssetRecorder()

  const loadRcsb = useCallback(async (requestedId = pdbId) => {
    setLoading(true)
    setStatus({ type: "idle" })
    try {
      const { importRcsbPdb } = await import("../../services/unified-file-import")
      const result = await importRcsbPdb(requestedId)
      if (!result.success) throw new Error(result.error)
      const normalizedId = requestedId.trim().toUpperCase()
      recordStructureAsset(`${normalizedId}.pdb`, "import")
      setStatus({ type: "success", message: result.message })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "RCSB download failed" })
    } finally {
      setLoading(false)
    }
  }, [pdbId, recordStructureAsset])

  const loadTrajectory = useCallback(async (example: (typeof BIOMOLECULE_TRAJECTORY_EXAMPLES)[number]) => {
    const sourcePath = "src" in example ? example.src : undefined
    if (!sourcePath) {
      await loadRcsb(example.id)
      return
    }
    setLoading(true)
    setStatus({ type: "idle" })
    try {
      const { importBundledBiomoleculePdb } = await import("../../services/unified-file-import")
      const result = await importBundledBiomoleculePdb(sourcePath, example.id)
      if (!result.success) throw new Error(result.error)
      recordStructureAsset(`${example.id}.pdb`, "template")
      setStatus({ type: "success", message: result.message })
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : "Trajectory import failed" })
    } finally {
      setLoading(false)
    }
  }, [loadRcsb, recordStructureAsset])

  return (
    <div className="space-y-3">
      <SectionHeading>RCSB Protein Data Bank</SectionHeading>
      <SearchField
        value={pdbId}
        onChange={(value) => setPdbId(value.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase())}
        onSubmit={() => void loadRcsb()}
        placeholder="PDB ID · 1CRN"
        searching={loading}
        label="Load RCSB PDB ID"
        canSubmit={pdbId.length === 4}
      />
      <p className="px-1 text-[9px] leading-4 text-[var(--panel-text-tertiary)]">Download a legacy PDB entry from RCSB into this workspace.</p>
      <div className="grid grid-cols-2 gap-2" aria-label="RCSB biomolecule examples">
        {RCSB_BIOMOLECULE_EXAMPLES.map((example) => (
          <TemplateCard
            key={example.id}
            badge={example.id}
            title={example.label}
            format="PDB"
            tooltip={`${example.label} · ${example.description}`}
            disabled={loading}
            wideBadge
            onClick={() => { setPdbId(example.id); void loadRcsb(example.id) }}
          />
        ))}
      </div>
      <SectionHeading>Multi-model trajectories</SectionHeading>
      <div className="grid grid-cols-2 gap-2" aria-label="Multi-MODEL trajectory examples">
        {BIOMOLECULE_TRAJECTORY_EXAMPLES.map((example) => (
          <TemplateCard
            key={example.id}
            badge={`${example.frames}f`}
            badgeKey={example.id}
            title={`${example.id} · ${example.label}`}
            format="PDB · multi-MODEL"
            tooltip={`${example.label} · ${example.description}`}
            disabled={loading}
            wideBadge
            onClick={() => void loadTrajectory(example)}
          />
        ))}
      </div>
      <StatusNotice status={status} />
    </div>
  )
}

// Match the outer 720ms exponential-out expansion rhythm.
const IMPORT_PANEL_TRANSITION = {
  duration: .36,
  ease: [0.16, 1, 0.3, 1],
} as const

const IMPORT_PANEL_HEIGHT_TRANSITION = {
  duration: .5,
  ease: [0.16, 1, 0.3, 1],
} as const

const IMPORT_PANEL_CONTENT: Record<StructureImportCategory, React.ReactNode> = {
  materials: <MaterialsImportPanel />,
  molecules: <MoleculesImportPanel />,
  macromolecules: <MacromoleculesImportPanel />,
}

export function StructureImportWorkspace() {
  const [category, setCategory] = useState<StructureImportCategory>("materials")
  const [panelHeights, setPanelHeights] = useState<Partial<Record<StructureImportCategory, number>>>({})
  // Apply the first measured height immediately to avoid a second expansion stage.
  // Animate only subsequent page changes.
  const [heightsPrimed, setHeightsPrimed] = useState(false)
  const panelRefs = useRef<Partial<Record<StructureImportCategory, HTMLDivElement>>>({})
  const reduceMotion = useReducedMotion()
  const panelId = (value: StructureImportCategory) => `structure-import-panel-${value}`
  const tabId = (value: StructureImportCategory) => `structure-import-tab-${value}`
  const activeIndex = STRUCTURE_IMPORT_CATEGORIES.findIndex((item) => item.value === category)

  useLayoutEffect(() => {
    const measure = (value: StructureImportCategory, element: HTMLDivElement) => {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height)
      setPanelHeights((current) => current[value] === nextHeight
        ? current
        : { ...current, [value]: nextHeight })
    }
    const observers = STRUCTURE_IMPORT_CATEGORIES.flatMap(({ value }) => {
      const element = panelRefs.current[value]
      if (!element) return []
      measure(value, element)
      if (typeof ResizeObserver === "undefined") return []
      const observer = new ResizeObserver(() => measure(value, element))
      observer.observe(element)
      return [observer]
    })
    setHeightsPrimed(true)
    return () => observers.forEach((observer) => observer.disconnect())
  }, [])

  const selectCategory = (next: StructureImportCategory) => {
    if (next === category) return
    const currentPanel = panelRefs.current[category]
    if (currentPanel?.contains(document.activeElement)) {
      document.getElementById(tabId(next))?.focus()
    }
    setCategory(next)
  }

  return (
    <div className="space-y-3">
      <SlidingSegmented
        options={STRUCTURE_IMPORT_CATEGORIES}
        value={category}
        onChange={selectCategory}
        ariaLabel="Structure import category"
        semantics="tabs"
        selectOnPointerEnter={140}
        gentleMotion
        getOptionId={tabId}
        getPanelId={panelId}
      />
      <motion.div
        data-structure-import-panel-stack
        className="relative overflow-hidden"
        initial={false}
        animate={{ height: panelHeights[category] ?? 0 }}
          transition={reduceMotion || !heightsPrimed ? { duration: 0 } : IMPORT_PANEL_HEIGHT_TRANSITION}
      >
        {STRUCTURE_IMPORT_CATEGORIES.map(({ value }, index) => {
          const active = value === category
          return (
            <motion.div
              key={value}
              ref={(element) => {
                if (element) {
                  panelRefs.current[value] = element
                } else delete panelRefs.current[value]
              }}
              id={panelId(value)}
              role="tabpanel"
              aria-labelledby={tabId(value)}
              aria-hidden={!active}
              {...(!active ? { inert: "" } : {})}
              className="absolute inset-x-0 top-0"
              style={{ pointerEvents: active ? "auto" : "none" }}
              initial={false}
              animate={{
                opacity: active ? 1 : 0,
                x: reduceMotion ? 0 : active ? 0 : index < activeIndex ? -10 : 10,
              }}
              transition={reduceMotion ? { duration: 0 } : IMPORT_PANEL_TRANSITION}
            >
              {IMPORT_PANEL_CONTENT[value]}
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}
