/**
 * Reactive biomolecular hierarchy view. Drilling preserves breadcrumbs and visual
 * focus, expands searched ancestors, and yields immediately to manual camera input.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useStore } from "zustand"
import { X, ChevronRight, Crosshair, Search } from "lucide-react"
import { useViewportManager, type ChartSlot } from "../../../orchestration/viewportManager"
import type { createCrystalStore } from "../../../orchestration/crystalStore"
import type { CrystalStore } from "../../../orchestration/crystal-store-types"
import {
  buildStructureLadder,
  ladderNode,
  ladderNodeAtomIds,
  ladderNodesBounds,
  ladderPath,
  type LadderNode,
} from "../../../lib/biomolecule/structure-ladder"
import { searchLadder } from "../../../lib/biomolecule/ladder-search"
import { drillEmphasisForLevel } from "../../../lib/biomolecule/drill-emphasis"
import { runDrillFlight } from "../../../orchestration/drillNavigator"
import type { StoreApi } from "zustand"

type CrystalStoreHook = ReturnType<typeof createCrystalStore>

const LEVEL_ACCENT: Record<LadderNode["level"], string> = {
  assembly: "var(--panel-accent)",
  chain: "#0A84FF",
  element: "#5E5CE6",
  residue: "#FF9F0A",
  atom: "#32D74B",
}

const LEVEL_NAME: Record<LadderNode["level"], string> = {
  assembly: "assembly",
  chain: "chain",
  element: "element",
  residue: "residue",
  atom: "atom",
}

const LEVEL_DEPTH: Record<LadderNode["level"], number> = {
  assembly: 0,
  chain: 1,
  element: 2,
  residue: 3,
  atom: 4,
}

interface LadderRowProps {
  node: LadderNode
  depth: number
  expanded: boolean
  isCurrent: boolean
  isSelected: boolean
  pathHint: string | null
  onDrill: (node: LadderNode, additive: boolean) => void
  onToggle: ((node: LadderNode) => void) | null
}

function LadderRow({
  node,
  depth,
  expanded,
  isCurrent,
  isSelected,
  pathHint,
  onDrill,
  onToggle,
}: LadderRowProps) {
  const hasChildren = node.childIds.length > 0
  return (
    <div
      className="flex items-center gap-1 rounded pr-1 text-[11px] transition-colors"
      style={{
        paddingLeft: depth * 12 + 4,
        backgroundColor: isSelected ? "var(--panel-elevated)" : undefined,
        boxShadow: isCurrent ? `inset 2px 0 0 0 ${LEVEL_ACCENT[node.level]}` : undefined,
      }}
    >
      {/* Leaf rows use a noninteractive spacer so screen readers never announce a false expander. */}
      {hasChildren && onToggle ? (
        <button
          onClick={() => onToggle(node)}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
          style={{ color: "var(--panel-text-tertiary)" }}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded={expanded}
        >
          <ChevronRight
            className="h-3 w-3 transition-transform"
            style={{ transform: expanded ? "rotate(90deg)" : undefined }}
          />
        </button>
      ) : (
        <span className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}

      <span
        className="h-3 w-[2px] shrink-0 rounded-full"
        style={{ backgroundColor: LEVEL_ACCENT[node.level] }}
        aria-hidden="true"
      />

      <button
        onClick={(event) => onDrill(node, event.shiftKey)}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] text-left"
        style={{ color: "var(--panel-text)" }}
        title={`Fly to ${node.label}${node.detail ? ` · ${node.detail}` : ""} — shift-click to add to selection`}
        aria-pressed={isSelected}
      >
        <span className="max-w-[62%] shrink-0 truncate font-medium">{node.label}</span>
        {node.detail && (
          <span className="min-w-0 truncate text-[9px]" style={{ color: "var(--panel-text-tertiary)" }}>
            {node.detail}
          </span>
        )}
        {node.secondaryStructureSource
          && node.secondaryStructureSource !== "pdb-record" && (
          <span
            className="shrink-0 rounded px-1 text-[8px]"
            style={{ backgroundColor: "var(--panel-elevated)", color: "var(--panel-text-tertiary)" }}
            title="Geometry estimate, not a DSSP assignment"
          >
            est
          </span>
        )}
        {pathHint && (
          <span
            className="ml-auto min-w-0 shrink truncate pl-1 text-[9px]"
            style={{ color: "var(--panel-text-tertiary)" }}
          >
            {pathHint}
          </span>
        )}
        {isCurrent && (
          <Crosshair className="h-3 w-3 shrink-0" style={{ color: LEVEL_ACCENT[node.level] }} />
        )}
      </button>
    </div>
  )
}

export function LadderViewport({
  slot,
  sourceStore,
}: {
  slot: ChartSlot
  sourceStore: CrystalStoreHook
}) {
  const closeChartSlot = useViewportManager((s) => s.closeChartSlot)
  const bioStructure = useStore(sourceStore, (s) => s.bioStructure)

  const ladder = useMemo(
    () => (bioStructure ? buildStructureLadder(bioStructure) : null),
    [bioStructure],
  )

  const [currentId, setCurrentId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set(["assembly"]))
  const [flying, setFlying] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setCurrentId(ladder ? ladder.rootId : null)
    setExpandedIds(new Set(ladder ? [ladder.rootId] : []))
    setQuery("")
    setSelectedIds(new Set())
  }, [ladder])

  const searching = query.trim().length > 0
  const results = useMemo(
    () => (ladder && searching ? searchLadder(ladder, query) : []),
    [ladder, searching, query],
  )

  const flightRef = useRef(0)

  const breadcrumb = useMemo(() => {
    if (!bioStructure || !ladder || !currentId) return []
    return ladderPath(bioStructure, ladder, currentId)
  }, [bioStructure, ladder, currentId])

  const drillTo = async (node: LadderNode, additive = false) => {
    if (!bioStructure || !ladder) return
    const api = sourceStore as unknown as StoreApi<CrystalStore>
    const fromPath = currentId ? ladderPath(bioStructure, ladder, currentId) : []
    const toPath = ladderPath(bioStructure, ladder, node.id)
    if (toPath.length === 0) return

    const nextSelected = new Set(additive ? selectedIds : [])
    if (nextSelected.has(node.id)) nextSelected.delete(node.id)
    else nextSelected.add(node.id)
    setSelectedIds(nextSelected)

    if (nextSelected.size === 0) {
      setCurrentId(ladder.rootId)
      api.setState({ focusedAtomIds: new Set(), bioDrillLevel: null })
      api.getState().setBioDrillGhost(null)
      return
    }

    const selectedNodes = [...nextSelected]
      .map((id) => ladderNode(bioStructure, ladder, id))
      .filter((n): n is LadderNode => n !== null)

    const merged = selectedNodes.length > 1 ? ladderNodesBounds(selectedNodes) : null
    const target = merged
      ? { center: merged.center, radius: merged.radius, label: `${selectedNodes.length} items` }
      : (() => {
          const leaf = toPath[toPath.length - 1]
          return { center: leaf.center, radius: leaf.radius, label: leaf.label }
        })()

    const from = fromPath.length > 0 ? fromPath[fromPath.length - 1] : toPath[0]
    const stops = [{ center: from.center, radius: from.radius, label: from.label }, target]

    const parent = toPath.length >= 2 ? toPath[toPath.length - 2] : null

    setCurrentId(node.id)
    setExpandedIds((previous) => {
      const next = new Set(previous)
      for (const ancestor of toPath.slice(0, -1)) next.add(ancestor.id)
      return next
    })

    const focused = new Set<string>()
    for (const selected of selectedNodes) {
      for (const atomId of ladderNodeAtomIds(bioStructure, selected)) focused.add(atomId)
    }
    const deepestLevel = selectedNodes.reduce(
      (deepest, candidate) =>
        LEVEL_DEPTH[candidate.level] > LEVEL_DEPTH[deepest] ? candidate.level : deepest,
      selectedNodes[0].level,
    )
    api.setState({ focusedAtomIds: focused, bioDrillLevel: deepestLevel })
    const anchored = parent && drillEmphasisForLevel(deepestLevel).spatialAnchor
    api.getState().setBioDrillGhost(
      anchored
        ? {
            center: [parent.center[0], parent.center[1], parent.center[2]],
            radius: parent.radius,
          }
        : null,
    )

    const flightId = flightRef.current + 1
    flightRef.current = flightId
    setFlying(true)
    try {
      await runDrillFlight(api, { path: stops })
    } finally {
      if (flightRef.current === flightId) setFlying(false)
    }
  }

  const pathHintFor = (node: LadderNode): string | null => {
    if (!bioStructure || !ladder) return null
    const ancestors = ladderPath(bioStructure, ladder, node.id).slice(1, -1)
    return ancestors.length > 0 ? ancestors.map((ancestor) => ancestor.label).join(" / ") : null
  }

  const toggle = (node: LadderNode) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(node.id)) next.delete(node.id)
      else next.add(node.id)
      return next
    })
  }

  const visibleRows = useMemo(() => {
    if (!bioStructure || !ladder) return []
    const rows: { node: LadderNode; depth: number }[] = []
    const walk = (nodeId: string, depth: number) => {
      const node = ladderNode(bioStructure, ladder, nodeId)
      if (!node) return
      rows.push({ node, depth })
      if (!expandedIds.has(nodeId)) return
      for (const childId of node.childIds) walk(childId, depth + 1)
    }
    walk(ladder.rootId, 0)
    return rows
  }, [bioStructure, ladder, expandedIds])

  return (
    <div className="flex h-full w-full flex-col" style={{ backgroundColor: "var(--panel-bg)" }}>
      <div
        className="shrink-0"
        style={{ borderBottom: "1px solid var(--panel-border)", backgroundColor: "var(--panel-bg)" }}
      >
        <div className="relative flex min-h-[38px] items-center justify-center px-16 py-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-md bg-emerald-500/80 px-2 py-1 text-[10px] font-medium text-white">
              Ladder
            </span>
            <span className="text-[11px] font-medium" style={{ color: "var(--panel-text)" }}>
              Structure ladder
            </span>
            {flying && (
              <span className="text-[9px] opacity-70" style={{ color: "var(--panel-text-tertiary)" }}>
                flying
              </span>
            )}
            {/* Report the multi-selection count and provide a clear exit. */}
            {selectedIds.size > 1 && (
              <button
                onClick={() => {
                  setSelectedIds(new Set())
                  const api = sourceStore as unknown as StoreApi<CrystalStore>
                  api.setState({ focusedAtomIds: new Set(), bioDrillLevel: null })
                  api.getState().setBioDrillGhost(null)
                }}
                className="rounded px-1.5 py-0.5 text-[9px]"
                style={{ backgroundColor: "var(--panel-elevated)", color: "var(--panel-text-secondary)" }}
                title="Clear multi-selection"
              >
                {selectedIds.size} selected · clear
              </button>
            )}
          </div>
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
            <button
              onClick={() => { closeChartSlot(slot.id);  }}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors"
              style={{ color: "var(--panel-text-tertiary)" }}
              title="Close ladder"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Breadcrumbs preserve context and provide direct navigation after drilling in. */}
        {breadcrumb.length > 0 && (
          <nav
            className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-3 pb-2 text-[10px]"
            aria-label="Ladder path"
          >
            {breadcrumb.map((node, index) => (
              <span key={node.id} className="flex items-center gap-1">
                {index > 0 && (
                  <ChevronRight
                    className="h-2.5 w-2.5 shrink-0"
                    style={{ color: "var(--panel-text-tertiary)" }}
                    aria-hidden="true"
                  />
                )}
                <button
                  onClick={() => drillTo(node)}
                  className="rounded px-1 py-0.5 transition-colors"
                  style={{
                    color: index === breadcrumb.length - 1
                      ? "var(--panel-text)"
                      : "var(--panel-text-secondary)",
                    backgroundColor: index === breadcrumb.length - 1
                      ? "var(--panel-elevated)"
                      : undefined,
                  }}
                  title={`Back to ${LEVEL_NAME[node.level]} ${node.label}`}
                >
                  {node.label}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* Fuzzy search is the practical entry point for deeply nested structures. */}
        {bioStructure && (
          <div className="px-3 pb-2">
            {/* Local focus styling avoids the automatic theme resolving the global accent to black. */}
            <div className="ladder-search flex items-center gap-1.5 rounded px-1.5">
              <Search
                className="h-3 w-3 shrink-0"
                style={{ color: "var(--panel-text-tertiary)" }}
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("")
                }}
                placeholder="Search chains, elements, residues…"
                aria-label="Search structure ladder"
                className="min-w-0 flex-1 bg-transparent py-1 text-[10px] outline-none"
                style={{ color: "var(--panel-text)" }}
              />
              {searching && (
                <button
                  onClick={() => setQuery("")}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
                  style={{ color: "var(--panel-text-tertiary)" }}
                  aria-label="Clear search"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!bioStructure ? (
          <div
            className="flex h-full items-center justify-center px-6 text-center text-[11px]"
            style={{ color: "var(--panel-text-tertiary)" }}
          >
            Load a biomolecular structure (PDB / mmCIF) to drill through
            assembly &rarr; chain &rarr; element &rarr; residue &rarr; atom.
          </div>
        ) : searching ? (
          results.length === 0 ? (
            <div
              className="flex h-full items-center justify-center px-6 text-center text-[11px]"
              style={{ color: "var(--panel-text-tertiary)" }}
            >
              No ladder entries match &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <div className="flex flex-col gap-[1px]">
              {results.map((node) => (
                <LadderRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={false}
                  isCurrent={node.id === currentId}
                  isSelected={selectedIds.has(node.id)}
                  pathHint={pathHintFor(node)}
                  onDrill={drillTo}
                  onToggle={null}
                />
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-[1px]">
            {visibleRows.map(({ node, depth }) => (
              <LadderRow
                key={node.id}
                node={node}
                depth={depth}
                expanded={expandedIds.has(node.id)}
                isCurrent={node.id === currentId}
                isSelected={selectedIds.has(node.id)}
                pathHint={null}
                onDrill={drillTo}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
