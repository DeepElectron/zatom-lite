"use client"

import { useMemo, useState } from "react"
import { AlertCircle, CheckCircle, Loader2, Search, X } from "lucide-react"
import {
  MODEL_CATALOG,
  MODEL_CATALOG_KIND_LABELS,
  badgeColor,
  filterModelCatalog,
  loadModelCatalogEntry,
  type ModelCatalogEntry,
  type ModelCatalogKind,
} from "./model-catalog"
import { useInstalledTemplatesStore } from "../../orchestration/installedTemplatesStore"
import { useStructureAssetRecorder } from "../structure-asset-context"

/**
 * Assets ▸ Store — a browsable shelf of every bundled model.
 *
 * The Structure panel's Templates grids show only what the Model Market has
 * installed, which makes the rest of the library invisible. This lists all of
 * it, one row after another, and loads on click through the shared
 * `loadModelCatalogEntry` so a model behaves the same here as in Templates.
 */

const KIND_ORDER: readonly ModelCatalogKind[] = ["crystal", "molecule", "biomolecule", "trajectory"]

type CategoryValue = "all" | ModelCatalogKind

type LoadStatus =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string }

export function ModelStorePanel() {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<CategoryValue>("all")
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [status, setStatus] = useState<LoadStatus>({ type: "idle" })
  const installed = useInstalledTemplatesStore((state) => state.installed)
  const recordStructureAsset = useStructureAssetRecorder()

  const categories = useMemo(() => ([
    { value: "all" as const, label: "All", count: MODEL_CATALOG.length },
    ...KIND_ORDER.map((kind) => ({
      value: kind,
      label: MODEL_CATALOG_KIND_LABELS[kind],
      count: MODEL_CATALOG.filter((item) => item.kind === kind).length,
    })),
  ]), [])

  const visible = useMemo(() => {
    const scoped = category === "all"
      ? MODEL_CATALOG
      : MODEL_CATALOG.filter((item) => item.kind === category)
    return filterModelCatalog(scoped, query)
  }, [category, query])

  /**
   * Grouped only in the "All" view — once a category chip is active the chip
   * already names the group, so headings would just repeat it.
   */
  const groups = useMemo(() => {
    if (category !== "all") return [{ kind: null as ModelCatalogKind | null, entries: visible }]
    return KIND_ORDER
      .map((kind) => ({ kind, entries: visible.filter((item) => item.kind === kind) }))
      .filter((group) => group.entries.length > 0)
  }, [category, visible])

  const load = async (catalogEntry: ModelCatalogEntry) => {
    setLoadingId(catalogEntry.id)
    setStatus({ type: "idle" })
    const outcome = await loadModelCatalogEntry(catalogEntry)
    if (outcome.ok && outcome.asset) {
      recordStructureAsset(outcome.asset.name, outcome.asset.source)
      setStatus({ type: "success", message: outcome.message ?? `Loaded ${catalogEntry.name}` })
    } else {
      setStatus({ type: "error", message: outcome.error ?? "Model load failed" })
    }
    setLoadingId(null)
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 px-5 pt-5 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <span style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--panel-text-secondary)" }}>
            Store
          </span>
          <span className="font-mono text-[9px] text-[var(--panel-text-tertiary)]">
            {visible.length}/{MODEL_CATALOG.length}
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--panel-text-tertiary)", marginTop: 2 }}>
          Click any model to load it into the viewport
        </p>
      </div>

      <div className="shrink-0 space-y-2 px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--panel-text-tertiary)]" />
          <input
            aria-label="Search the model store"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Name · formula · PDB ID…"
            className="zatom-field w-full rounded-xl py-2.5 pl-9 pr-9 text-[11px]"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="zatom-pressable absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--panel-text-secondary)]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Wrap category chips in a narrow panel so no category is hidden behind horizontal scrolling. */}
        <div
          role="tablist"
          aria-label="Model category"
          className="flex flex-wrap gap-1 pb-1"
        >
          {categories.map((item) => {
            const active = item.value === category
            return (
              <button
                key={item.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(item.value)}
                className="zatom-pressable flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium"
                style={{
                  backgroundColor: active ? "var(--control-selected-bg)" : "var(--panel-elevated)",
                  color: active ? "var(--control-selected-text)" : "var(--panel-text-secondary)",
                  border: `1px solid ${active ? "var(--control-selected-border)" : "var(--panel-border)"}`,
                }}
              >
                {item.label}
                <span className="font-mono text-[9px] opacity-60">{item.count}</span>
              </button>
            )
          })}
        </div>

        {status.type !== "idle" && (
          <div
            role={status.type === "error" ? "alert" : "status"}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]"
            style={{
              backgroundColor: status.type === "success" ? "var(--status-green-bg)" : "var(--status-red-bg)",
              color: status.type === "success" ? "var(--status-green)" : "var(--status-red)",
            }}
          >
            {status.type === "success"
              ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 truncate">{status.message}</span>
          </div>
        )}
      </div>

      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {visible.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: "var(--panel-border)" }}>
            <p className="text-[11px] text-[var(--panel-text-secondary)]">No models match this search.</p>
            <button
              type="button"
              onClick={() => { setQuery(""); setCategory("all") }}
              className="zatom-choice zatom-pressable mt-2 rounded px-2 py-1 text-[10px]"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.kind ?? "flat"} className="space-y-1.5">
                {group.kind && (
                  <div className="px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--panel-text-tertiary)]">
                    {MODEL_CATALOG_KIND_LABELS[group.kind]}
                  </div>
                )}
                {group.entries.map((item) => (
                  <ModelStoreRow
                    key={item.id}
                    entry={item}
                    loading={loadingId === item.id}
                    disabled={loadingId !== null}
                    inTemplates={Boolean(item.installedId && installed.has(item.installedId))}
                    onClick={() => void load(item)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelStoreRow({
  entry,
  loading,
  disabled,
  inTemplates,
  onClick,
}: {
  entry: ModelCatalogEntry
  loading: boolean
  disabled: boolean
  inTemplates: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={`${entry.name} · ${entry.detail}`}
      className="zatom-pressable flex w-full min-w-0 items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors duration-150 ease-out hover:bg-[var(--panel-hover)] disabled:opacity-40"
      style={{ backgroundColor: "var(--panel-elevated)", border: "1px solid var(--panel-border)" }}
    >
      <span
        className={`flex h-7 ${entry.wideBadge ? "w-10 text-[9px]" : "w-7 text-[11px]"} shrink-0 items-center justify-center rounded-lg font-bold`}
        style={{ backgroundColor: badgeColor(entry.badgeKey), color: "var(--badge-fg)" }}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : entry.badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-[var(--panel-text)]">{entry.name}</span>
        <span className="mt-0.5 block truncate text-[9px] text-[var(--panel-text-tertiary)]">{entry.detail}</span>
      </span>
      {/* Mark items already installed in Templates. */}
      {inTemplates && (
        <span
          aria-label="Already in Templates"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: "var(--control-selected-text)" }}
        />
      )}
      <span className="shrink-0 font-mono text-[8px] uppercase text-[var(--panel-text-tertiary)]">
        {entry.format.split(" · ")[0]}
      </span>
    </button>
  )
}
